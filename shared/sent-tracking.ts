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
