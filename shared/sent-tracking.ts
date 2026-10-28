import type { SentSource } from "./email-campaigns";
/**
 * Tracking je gesendeter E-Mail: Was ist mit genau dieser Mail passiert?
 *
 * Die Kampagnen schreiben je Empfänger Ereignisse (gesendet, geöffnet, geklickt, Antwort, Bounce, abgemeldet).
 * Für den Ordner „Gesendet“ wird jede „gesendet“-Zeile mit den Reaktionen verknüpft, die danach kamen –
 * bis zur nächsten Mail an denselben Empfänger. So sieht man je Mail: wann geöffnet, wann geklickt, wann geantwortet.
 * Server (MySQL) und Chat-Demo nutzen dieselbe Logik.
 */
export type SentReaction = "bounce" | "abgemeldet" | "geantwortet" | "geklickt" | "geoeffnet" | "ohne";

export type TrackEvent = { recipientId: number; kind: string; note?: string | null; createdAt: Date | string };

export type SentTracking = {
  openedAt: Date | null;
  clickedAt: Date | null;
  repliedAt: Date | null;
  bouncedAt: Date | null;
  unsubscribedAt: Date | null;
  reaction: SentReaction;
};

export const REACTION_LABEL: Record<SentReaction, string> = {
  bounce: "Unzustellbar",
  abgemeldet: "Abgemeldet",
  geantwortet: "Geantwortet",
  geklickt: "Geklickt",
  geoeffnet: "Geöffnet",
  ohne: "Noch nicht geöffnet",
};

const at = (value: Date | string) => new Date(value).getTime();

/** Antworten werden technisch als „geöffnet“-Ereignis mit Hinweis „Antwort …“ gespeichert. */
const isReplyEvent = (event: TrackEvent) => event.kind === "geoeffnet" && /^antwort/i.test(event.note ?? "");

export function reactionOf(tracking: Omit<SentTracking, "reaction">): SentReaction {
  if (tracking.bouncedAt) return "bounce";
  if (tracking.unsubscribedAt) return "abgemeldet";
  if (tracking.repliedAt) return "geantwortet";
  if (tracking.clickedAt) return "geklickt";
  if (tracking.openedAt) return "geoeffnet";
  return "ohne";
}

/**
 * Reaktionen auf eine Mail: alle Ereignisse des Empfängers ab Versandzeit bis zur nächsten Mail an ihn.
 * `sends` sind die Versandzeiten aller Mails an diesen Empfänger (die eigene darf dabei sein).
 * Die Zeitstempel am Empfänger-Datensatz (openedAt, clickedAt, repliedAt, bouncedAt) dienen als Rückfallebene,
 * falls eine Reaktion ohne eigenes Ereignis festgehalten wurde – sie zählen nur, wenn sie ins Zeitfenster dieser Mail fallen.
 */
export type RecipientStamps = { openedAt?: Date | string | null; clickedAt?: Date | string | null; repliedAt?: Date | string | null; bouncedAt?: Date | string | null };

export function trackingForSend(sentAt: Date | string, events: TrackEvent[], sends: Array<Date | string>, recipient?: RecipientStamps | null): SentTracking {
  const start = at(sentAt);
  const later = sends.map(at).filter((time) => time > start);
  const end = later.length ? Math.min(...later) : Number.POSITIVE_INFINITY;
  const inWindow = (value: Date | string) => { const time = at(value); return time >= start && time < end; };
  const first = (match: (event: TrackEvent) => boolean) => {
    const hits = events.filter((event) => match(event) && inWindow(event.createdAt)).sort((a, b) => at(a.createdAt) - at(b.createdAt));
    return hits.length ? new Date(hits[0].createdAt) : null;
  };
  const fallback = (value: Date | string | null | undefined) => (value && inWindow(value) ? new Date(value) : null);
  const base = {
    openedAt: first((event) => event.kind === "geoeffnet" && !isReplyEvent(event)) ?? fallback(recipient?.openedAt),
    clickedAt: first((event) => event.kind === "geklickt") ?? fallback(recipient?.clickedAt),
    repliedAt: first(isReplyEvent) ?? fallback(recipient?.repliedAt),
    bouncedAt: first((event) => event.kind === "bounce") ?? fallback(recipient?.bouncedAt),
    unsubscribedAt: first((event) => event.kind === "abgemeldet"),
  };
  return { ...base, reaction: reactionOf(base) };
}

/** Zählt die Reaktionen einer Liste – für die Filterknöpfe über dem Ordner „Gesendet“. */
export function countReactions(items: Array<{ tracking: SentTracking | null }>): Record<SentReaction, number> {
  const counts: Record<SentReaction, number> = { bounce: 0, abgemeldet: 0, geantwortet: 0, geklickt: 0, geoeffnet: 0, ohne: 0 };
  for (const item of items) if (item.tracking) counts[item.tracking.reaction] += 1;
  return counts;
}

/**
 * Zahlen je E-Mail (nicht je Person) für eine Kampagne: wie viele Mails gingen raus, wie viele davon wurden
 * geöffnet / geklickt / beantwortet. Gleiche Logik wie der Ordner „Gesendet“ – dadurch stimmen beide Ansichten überein.
 * Beispiel: 4 Personen haben geöffnet, eine davon zwei verschiedene Mails → 4 Personen, 5 geöffnete Mails.
 */
export function campaignMailStats(events: TrackEvent[], stamps: Map<number, RecipientStamps> = new Map()) {
  const byRecipient = new Map<number, TrackEvent[]>();
  for (const event of events) byRecipient.set(event.recipientId, [...(byRecipient.get(event.recipientId) ?? []), event]);
  let sent = 0; let opened = 0; let clicked = 0; let replied = 0;
  for (const [recipientId, list] of Array.from(byRecipient.entries())) {
    const sends = list.filter((event) => event.kind === "gesendet").map((event) => event.createdAt);
    for (const sentAt of sends) { const tracking = trackingForSend(sentAt, list, sends, stamps.get(recipientId) ?? null); sent += 1; if (tracking.openedAt || tracking.clickedAt || tracking.repliedAt) opened += 1; if (tracking.clickedAt) clicked += 1; if (tracking.repliedAt) replied += 1; }
  }
  return { sent, opened, clicked, replied };
}

/**
 * Uhrzeit (Europe/Berlin) eines Zeitpunkts in einem Tages-Fenster „von–bis“ (z. B. 09:00–11:30), egal an welchem Tag.
 * „bis“ zählt mit: 09:00–11:30 enthält auch eine Mail um 11:30 Uhr. Über Mitternacht geht auch (22:00–06:00).
 */
export function inTimeOfDay(at: Date, timeFrom?: string | null, timeTo?: string | null): boolean {
  if (!timeFrom && !timeTo) return true;
  const parts = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at);
  const minutes = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24 * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const toMinutes = (value?: string | null) => { if (!value) return null; const [h, m] = value.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  const start = toMinutes(timeFrom) ?? 0; const end = toMinutes(timeTo) ?? 23 * 60 + 59;
  return start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end;
}

export type SentFilter = { search?: string | null; from?: Date | string | null; to?: Date | string | null; campaignId?: number | null; kind?: string | null; reaction?: SentReaction | null; timeFrom?: string | null; timeTo?: string | null; leadId?: number | null; email?: string | null };
type SentRow = { kind: string; campaignId?: number | null; campaignName?: string | null; leadId?: number | null; at: Date | string; to: string; name?: string | null; subject: string; tracking: SentTracking | null; origin?: { source: SentSource } | null };
/** Gehört eine gesendete Mail zu diesem Kontakt? Über die Kontakt-Nummer oder – falls die fehlt – über die Adresse. */
export const sentToContact = (item: { leadId?: number | null; to: string }, filter: { leadId?: number | null; email?: string | null }) => {
  if (!filter.leadId && !filter.email) return true;
  const address = (filter.email ?? "").trim().toLowerCase();
  return (Boolean(filter.leadId) && item.leadId === filter.leadId) || (Boolean(address) && item.to.trim().toLowerCase() === address);
};

/**
 * Ordner „Gesendet“ filtern und zählen – Server und Chat-Demo nutzen dieselbe Logik.
 * Zeitraum (Datum + Uhrzeit, „bis“ ausschließlich), Uhrzeit an jedem Tag und Kampagne bestimmen den Bereich:
 * Darauf beziehen sich alle Zähler (Art, Reaktion, Kampagnen). Art, Reaktion und Suche filtern danach nur die Liste.
 * `overview` = alle Kampagnen-Sendungen (Kampagne, Name, Zeit) für die Kampagnen-Auswahl, wenn `items` schon auf eine Kampagne beschränkt sind.
 */
export function summarizeSent<T extends SentRow>(items: T[], filter: SentFilter, options: { limit?: number; overview?: Array<{ campaignId: number; name: string; at: Date | string }> } = {}) {
  const date = (value?: Date | string | null) => { if (!value) return null; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed; };
  const from = date(filter.from); const to = date(filter.to);
  const inPeriod = (at: Date | string) => { const when = new Date(at); return (!from || when >= from) && (!to || when < to) && inTimeOfDay(when, filter.timeFrom, filter.timeTo); };
  const scoped = items.filter((item) => inPeriod(item.at) && (!filter.campaignId || item.campaignId === filter.campaignId) && sentToContact(item, filter));
  const search = (filter.search ?? "").trim().toLowerCase();
  const filtered = scoped.filter((item) => (!filter.kind || item.kind === filter.kind) && (!filter.reaction || item.tracking?.reaction === filter.reaction)
    && (!search || `${item.to} ${item.name ?? ""} ${item.subject} ${item.campaignName ?? ""}`.toLowerCase().includes(search)));
  const pool = options.overview ?? items.flatMap((item) => item.campaignId && item.campaignName ? [{ campaignId: item.campaignId, name: item.campaignName, at: item.at }] : []);
  const byCampaign = new Map<number, { id: number; name: string; count: number }>();
  for (const row of pool) if (inPeriod(row.at)) { const entry = byCampaign.get(row.campaignId) ?? { id: row.campaignId, name: row.name, count: 0 }; entry.count += 1; byCampaign.set(row.campaignId, entry); }
  const kindCount = (kind: string) => scoped.filter((item) => item.kind === kind).length;
  const origins = { ki: 0, hand: 0, "entwurf-vorlage": 0, vorlage: 0 } as Record<SentSource, number>; for (const item of filtered) if (item.origin) origins[item.origin.source] += 1;
  return { items: filtered.slice(0, options.limit ?? 200), total: filtered.length, counts: { alle: scoped.length, kampagne: kindCount("kampagne"), antwort: kindCount("antwort"), einzel: kindCount("einzel") }, reactions: countReactions(scoped), campaigns: Array.from(byCampaign.values()).sort((a, b) => b.count - a.count), origins };
}
/** Je Kampagne: wie viele E-Mails persönlich rausgingen (KI-Text oder selbst geschrieben), wie viele als Vorlage, wie viele ohne Angabe (vor der Speicherung). */
export function sentOriginCounts(rows: Array<{ source: string | null | undefined; count: number }>) {
  let personal = 0; let template = 0; let unknown = 0;
  for (const row of rows) { if (row.source === "ki" || row.source === "hand") personal += row.count; else if (row.source === "vorlage" || row.source === "entwurf-vorlage") template += row.count; else unknown += row.count; }
  return { personal, template, unknown };
}
