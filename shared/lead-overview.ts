/**
 * Zahlen über der Leads-Tabelle und im Lead-Puls – eine Rechnung für Server und Vorschau.
 *  - Übersicht: der Weg der Leads auf einen Blick – alle Leads und wo sie stehen, heute neu (verglichen mit gestern um dieselbe Zeit),
 *    bereit zum Ausliefern (und wie alt der älteste ist), ausgeliefert (heute, 7 Tage, zu welchem Preis), reklamiert – und die letzten 14 Tage je Tag.
 *  - Hinweise: was als Nächstes zu tun ist, wenn Leads nicht rausgehen.
 *  - Lead-Puls: wie viele Leads es im gewählten Zeitraum gibt und wie viele davon in den letzten 24 Stunden kamen.
 * Tage sind Kalendertage in Berlin.
 */
import { berlinDay } from "./agent-ranking";

export type LeadStatusKey = "neu" | "genehmigt" | "zugewiesen" | "reklamiert" | "fehlerhaft" | "deaktiviert" | "hängend";
export type LeadCounts = Record<LeadStatusKey | "alle" | "dubletten", number>;
export const emptyLeadCounts = (): LeadCounts => ({ alle: 0, neu: 0, genehmigt: 0, zugewiesen: 0, reklamiert: 0, fehlerhaft: 0, deaktiviert: 0, hängend: 0, dubletten: 0 });

/** Was als Nächstes zu tun ist: Leads, die nicht rausgehen können (keine Lieferkette), hängen geblieben sind oder nicht von selbst rausgehen. */
export type OverviewHint = { kind: "keine_kette" | "fehler" | "nicht_von_selbst"; leads: number; categories: string[]; categoryIds: number[] };
export type LeadsOverview = {
  total: number; today: number; yesterday: number; week: number; open: number; ready: number; delivered: number; days: Array<{ day: string; count: number }>;
  /** Zahl je Status – für die Leiste „wo stehen alle Leads“ und die Fußzeilen der Kacheln */
  status: Record<LeadStatusKey, number>;
  /** gestern bis zur selben Uhrzeit · derselbe Wochentag vor einer Woche (ganzer Tag) · die 7 Tage vor den letzten 7 */
  yesterdaySoFar: number; sameDayLastWeek: number; previousWeek: number;
  /** Eingang des ältesten Leads, der freigegeben ist und noch wartet */
  oldestReadyAt: string | null;
  /** Leads, die heute / in den letzten 7 Tagen an einen Käufer gingen, und die Summe ihrer Preise (7 Tage) */
  deliveredToday: number; deliveredWeek: number; valueWeek: number;
  /** Reklamationen, die noch auf eine Entscheidung warten */
  claimsOpen: number;
  hints: OverviewHint[];
};
/** Was der Server zusätzlich zu den Zahlen je Status und den Eingangszeiten liefert. Fehlt etwas (Partner-Zugang), bleibt es bei 0 und ohne Hinweise. */
export type OverviewExtras = { oldestReadyAt?: Date | string | number | null; deliveries?: Array<{ leadId: number; unitPrice: string | number | null; occurredAt: Date | string | number }>; claimsOpen?: number; hints?: OverviewHint[] };
export const OVERVIEW_DAYS = 14;
/** Kalendertag in Berlin, n Tage vor dem Tag von `now` (als JJJJ-MM-TT). */
export function berlinDayBefore(now: Date, back: number): string {
  const [year, month, day] = berlinDay(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - back, 12)).toISOString().slice(0, 10);
}
/**
 * Übersicht aus den Zahlen je Status und den Eingangszeiten der letzten Tage.
 * „Offen“ = noch nicht ausgeliefert (neu, genehmigt, hängend); „bereit“ = genehmigt, wartet auf die Auslieferung. Die 14 Tage laufen von alt nach neu, heute steht rechts.
 * Der Vergleich für heute ist fair: gestern bis zur selben Uhrzeit (nicht der ganze gestrige Tag gegen einen angebrochenen).
 */
export function leadsOverview(statusCounts: Array<{ status: string; count: number }>, createdAts: Array<Date | string | number>, now: Date = new Date(), extras: OverviewExtras = {}): LeadsOverview {
  const byStatus = new Map<string, number>(); for (const row of statusCounts) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + (Number(row.count) || 0));
  const todayKey = berlinDay(now); const yesterdayKey = berlinDayBefore(now, 1); const dayAgo = now.getTime() - 86_400_000;
  const perDay = new Map<string, number>(); let yesterdaySoFar = 0;
  for (const value of createdAts) { const day = berlinDay(value); perDay.set(day, (perDay.get(day) ?? 0) + 1); if (day === yesterdayKey && new Date(value).getTime() <= dayAgo) yesterdaySoFar += 1; }
  const days = Array.from({ length: OVERVIEW_DAYS }, (_, index) => { const day = berlinDayBefore(now, OVERVIEW_DAYS - 1 - index); return { day, count: perDay.get(day) ?? 0 }; });
  const sum = (list: Array<{ count: number }>) => list.reduce((total, item) => total + item.count, 0);
  const count = (key: LeadStatusKey) => byStatus.get(key) ?? 0;
  // Zustellungen: ein Lead zählt einmal (auch wenn er an zwei Käufer ging), sein Preis je Zustellung
  const weekKeys = new Set(days.slice(-7).map((day) => day.day)); const leadsToday = new Set<number>(); const leadsWeek = new Set<number>(); let valueWeek = 0;
  for (const row of extras.deliveries ?? []) { const day = berlinDay(row.occurredAt); if (!weekKeys.has(day)) continue; leadsWeek.add(row.leadId); valueWeek += Number(row.unitPrice) || 0; if (day === todayKey) leadsToday.add(row.leadId); }
  return {
    total: Array.from(byStatus.values()).reduce((total, value) => total + value, 0),
    today: days[days.length - 1].count, yesterday: days[days.length - 2].count, week: sum(days.slice(-7)),
    open: count("neu") + count("genehmigt") + count("hängend"),
    ready: count("genehmigt"), delivered: count("zugewiesen"), days,
    status: { neu: count("neu"), genehmigt: count("genehmigt"), zugewiesen: count("zugewiesen"), reklamiert: count("reklamiert"), fehlerhaft: count("fehlerhaft"), deaktiviert: count("deaktiviert"), hängend: count("hängend") },
    yesterdaySoFar, sameDayLastWeek: days[days.length - 8].count, previousWeek: sum(days.slice(-14, -7)),
    oldestReadyAt: extras.oldestReadyAt ? new Date(extras.oldestReadyAt).toISOString() : null,
    deliveredToday: leadsToday.size, deliveredWeek: leadsWeek.size, valueWeek: Math.round(valueWeek * 100) / 100,
    claimsOpen: Math.max(0, Number(extras.claimsOpen) || 0), hints: extras.hints ?? [],
  };
}
export const emptyLeadsOverview = (now: Date = new Date()): LeadsOverview => leadsOverview([], [], now);

/* ───────────── Was die Kacheln dazu sagen (ein Wortlaut für Oberfläche und Tests) ───────────── */

const de = (value: number) => value.toLocaleString("de-DE");
const leadWord = (count: number) => (count === 1 ? "Lead" : "Leads");
export type OverviewTone = "gut" | "achtung" | "ruhig";

/**
 * Heute gegen gestern bis zur selben Uhrzeit: „4 mehr als gestern“. Mehr ist gut; weniger bleibt sachlich (am Wochenende ist das normal –
 * und an dieser Stelle lässt es sich nicht ändern). Achtung-Farbe gibt es nur dort, wo etwas zu tun ist.
 */
export function todayComparison(today: number, yesterdaySoFar: number): { tone: OverviewTone; arrow: "↑" | "↓" | "="; text: string } {
  const diff = today - yesterdaySoFar;
  if (diff > 0) return { tone: "gut", arrow: "↑", text: `${de(diff)} mehr als gestern` };
  if (diff < 0) return { tone: "ruhig", arrow: "↓", text: `${de(-diff)} weniger als gestern` };
  return { tone: "ruhig", arrow: "=", text: today ? "so viele wie gestern" : "wie gestern" };
}
/** Die letzten 7 Tage gegen die 7 Tage davor: „63 % mehr“. Kam davor nichts, gibt es keinen Vergleich (kein Prozent von 0). */
export function weekComparison(week: number, previousWeek: number): { tone: OverviewTone; arrow: "↑" | "↓" | "="; text: string } | null {
  if (!previousWeek) return null;
  if (week === previousWeek) return { tone: "ruhig", arrow: "=", text: "gleich viele" };
  const percent = Math.round((Math.abs(week - previousWeek) / previousWeek) * 100); const amount = percent ? `${de(percent)} %` : "unter 1 %";
  return week > previousWeek ? { tone: "gut", arrow: "↑", text: `${amount} mehr` } : { tone: "ruhig", arrow: "↓", text: `${amount} weniger` };
}
/** Wie alt der älteste wartende Lead ist – in ganzen Stunden oder Tagen. Ab zwei Tagen ist es ein Hinweis, ab fünf ein deutlicher. */
export function waitingAge(oldestReadyAt: string | null, now: Date = new Date()): { tone: OverviewTone; text: string } | null {
  if (!oldestReadyAt) return null;
  const hours = Math.max(0, (now.getTime() - new Date(oldestReadyAt).getTime()) / 3_600_000);
  if (hours < 1) return { tone: "ruhig", text: "ältester kam gerade erst" };
  if (hours < 24) { const whole = Math.floor(hours); return { tone: "ruhig", text: `ältester ist ${whole} ${whole === 1 ? "Stunde" : "Stunden"} alt` }; }
  const days = Math.floor(hours / 24);
  return { tone: days >= 2 ? "achtung" : "ruhig", text: `ältester ist ${de(days)} ${days === 1 ? "Tag" : "Tage"} alt` };
}
/** Anteil reklamierter Leads an allen, die je ausgeliefert wurden (ausgeliefert + reklamiert). Ohne Auslieferung gibt es keine Quote. */
export function claimRate(delivered: number, claimed: number): number | null {
  const base = delivered + claimed; return base > 0 ? Math.round((claimed / base) * 100) : null;
}
/** Wo alle Leads stehen – vier Teile in fester Reihenfolge: bereit, ausgeliefert, reklamiert, alles Übrige (neu, hängend, fehlerhaft, deaktiviert). */
export function statusSplit(status: Record<LeadStatusKey, number>): Array<{ key: "bereit" | "ausgeliefert" | "reklamiert" | "uebrige"; label: string; count: number; share: number }> {
  const parts = [
    { key: "bereit" as const, label: "bereit zum Ausliefern", count: status.genehmigt },
    { key: "ausgeliefert" as const, label: "ausgeliefert", count: status.zugewiesen },
    { key: "reklamiert" as const, label: "reklamiert", count: status.reklamiert },
    { key: "uebrige" as const, label: "übrige (neu, hängend, fehlerhaft, deaktiviert)", count: status.neu + status.hängend + status.fehlerhaft + status.deaktiviert },
  ];
  const total = parts.reduce((all, part) => all + part.count, 0);
  return parts.map((part) => ({ ...part, share: total ? Math.round((part.count / total) * 100) : 0 }));
}

const quoted = (names: string[]) => { const list = names.map((name) => `„${name}“`); return list.length <= 2 ? list.join(" und ") : `${de(list.length)} Kategorien`; };
/**
 * Hinweise aus dem, was wartet: je Kategorie die freigegebenen Leads – und ob sie überhaupt rausgehen können.
 *  - keine_kette: Für die Kategorie ist keine Lieferkette mit Kunde eingeschaltet (und keine offene Bestellung) → diese Leads können nicht ausgeliefert werden.
 *  - fehler: Leads, bei denen die Auslieferung hakt (Seite „API-Fehler“).
 *  - nicht_von_selbst: Eine Kette gibt es, aber keine eingeschaltete Automation liefert Leads dieser Kategorie aus → sie warten, bis sie jemand von Hand ausliefert.
 * Reihenfolge = Dringlichkeit.
 */
export function overviewHints(input: { waiting: Array<{ categoryId: number; count: number }>; categoryName: (categoryId: number) => string; deliverable: Iterable<number>; automatic: Iterable<number>; problems: number }): OverviewHint[] {
  const deliverable = new Set(input.deliverable); const automatic = new Set(input.automatic);
  const rows = input.waiting.filter((row) => row.count > 0).slice().sort((a, b) => b.count - a.count || a.categoryId - b.categoryId);
  const total = (list: typeof rows) => list.reduce((all, row) => all + row.count, 0);
  const blocked = rows.filter((row) => !deliverable.has(row.categoryId)); const manual = rows.filter((row) => deliverable.has(row.categoryId) && !automatic.has(row.categoryId));
  const hints: OverviewHint[] = [];
  const of = (kind: OverviewHint["kind"], list: typeof rows): OverviewHint => ({ kind, leads: total(list), categories: list.map((row) => input.categoryName(row.categoryId)), categoryIds: list.map((row) => row.categoryId) });
  if (blocked.length) hints.push(of("keine_kette", blocked));
  if (input.problems > 0) hints.push({ kind: "fehler", leads: input.problems, categories: [], categoryIds: [] });
  if (manual.length) hints.push(of("nicht_von_selbst", manual));
  return hints;
}
/** Aktionen, die einen Lead zum Käufer bringen (direkt oder über eine Zuordnung). */
export const DELIVERING_ACTIONS = ["lead_ausliefern", "lead_lieferkette_zuordnen", "lead_bestellung_zuordnen"] as const;
/** Auslöser, die erst nach dem Verkauf greifen – so eine Automation bringt neue Leads nicht von selbst raus. */
const AFTER_SALE_TRIGGERS = ["reklamation_genehmigt", "nach_erstattung"];
/** Status, die ein Lead erst nach dem Verkauf (oder nach dem Aussortieren) hat – eine Bedingung darauf trifft keinen neuen Lead. */
const NOT_WAITING = ["zugewiesen", "reklamiert", "fehlerhaft", "deaktiviert"];
/**
 * Bringt diese (eingeschaltete) Automation neue Leads ihrer Kategorie von selbst zum Käufer?
 * Ja, wenn sie ausliefert oder zuordnet – und nicht erst nach dem Verkauf greift (Auslöser „Reklamation genehmigt“ / „nach Erstattung“
 * oder eine Bedingung wie „Status ist reklamiert“).
 */
export function deliversByItself(rule: { triggerType?: string | null; actionType?: string | null; falseActionType?: string | null; conditions?: unknown }): boolean {
  if (rule.triggerType && AFTER_SALE_TRIGGERS.includes(rule.triggerType)) return false;
  const onStatus = (Array.isArray(rule.conditions) ? rule.conditions : []).filter((item): item is { field: string; operator: string; value: unknown } => Boolean(item) && typeof item === "object" && (item as { field?: unknown }).field === "status" && (item as { operator?: unknown }).operator === "gleich");
  if (onStatus.length && onStatus.every((item) => NOT_WAITING.includes(String(item.value)))) return false;
  const delivers = (action: string | null | undefined) => Boolean(action && (DELIVERING_ACTIONS as readonly string[]).includes(action));
  return delivers(rule.actionType) || delivers(rule.falseActionType);
}
/**
 * Der Satz zu einem Hinweis und wohin der Knopf führt. Die Zahl steht vorn, der Grund dahinter.
 * `showLeads` = ein zweiter Knopf zeigt genau diese Leads in der Tabelle (bei einer einzelnen Kategorie auch nach ihr gefiltert).
 */
export function hintText(hint: OverviewHint): { text: string; action: string; page: "Lieferkette" | "API-Fehler" | "Automatisierung"; showLeads: boolean } {
  const n = hint.leads; const count = `${de(n)} ${n === 1 ? "freigegebener Lead" : "freigegebene Leads"}`;
  if (hint.kind === "keine_kette") return { text: `${count} ${n === 1 ? "kann" : "können"} nicht raus: Für ${quoted(hint.categories)} ist keine Lieferkette eingeschaltet.`, action: "Lieferkette einrichten", page: "Lieferkette", showLeads: true };
  if (hint.kind === "fehler") return { text: `Bei ${de(n)} ${leadWord(n)} hakt die Auslieferung.`, action: "API-Fehler ansehen", page: "API-Fehler", showLeads: false };
  return { text: `${count} ${n === 1 ? "wartet" : "warten"}: Für ${quoted(hint.categories)} liefert keine Automation von selbst aus.`, action: "Automation einrichten", page: "Automatisierung", showLeads: true };
}

/** Lead-Puls: höchstens so viele Leads gehen auf einmal an die Oberfläche – das Fenster rollt, die Zahl darüber nennt alle. */
export const PULSE_LIMIT = 300;
