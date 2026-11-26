/**
 * Zeitraum der Gespräche und der Bestenliste: Kurzwahl („heute“, „diese Woche“, „letzter Monat“ …) oder von/bis als JJJJ-MM-TT
 * (deutsche Zeit, bis einschließlich). Aus dem Zeitraum entstehen die Kalendertage (Spanne), die Grenzen für die Datenbank
 * und die Worte dafür – an einer Stelle, damit Liste, Bestenliste, Server und Vorschau dasselbe meinen.
 */
export const CALL_PERIOD_KEYS = ["heute", "gestern", "7", "30", "woche", "letzte_woche", "letzte_2_wochen", "monat", "letzter_monat", "alle"] as const;
export type CallPeriodKey = (typeof CALL_PERIOD_KEYS)[number];
export type CallPeriod = { period?: CallPeriodKey | null; from?: string | null; to?: string | null };
/** Die schnellen Zeiträume – als Knöpfe. */
export const CALL_QUICK_PERIODS: Array<[CallPeriodKey, string]> = [["heute", "Heute"], ["gestern", "Gestern"], ["7", "7 Tage"], ["30", "30 Tage"], ["alle", "Gesamt"]];
/** Die festen Zeiträume der Auswahlliste „Weitere Zeiträume“ – dieselben wie auf der Leads-Seite. */
export const CALL_MORE_PERIODS: Array<[CallPeriodKey, string]> = [["woche", "Diese Woche"], ["letzte_woche", "Letzte Woche"], ["letzte_2_wochen", "Letzte 2 Wochen"], ["monat", "Dieser Monat"], ["letzter_monat", "Letzter Monat"]];
/** Eigener Zeitraum: zwischen zwei Tagen, ab einem Tag oder vor einem Tag (ohne ihn). */
export type CallOpenMode = "zwischen" | "ab" | "vor";
export const CALL_OPEN_MODES: Array<[CallOpenMode, string]> = [["zwischen", "Zwischen …"], ["ab", "Ab …"], ["vor", "Vor …"]];

const isDay = (value: string | null | undefined): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
const dayNumber = (day: string) => { const [y, m, d] = day.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86_400_000); };
/** Tage zwischen zwei Kalendertagen (b − a). */
export const daysBetween = (a: string, b: string) => dayNumber(b) - dayNumber(a);
/** Kalendertag um n Tage verschieben. */
export const shiftDay = (day: string, by: number) => new Date((dayNumber(day) + by) * 86_400_000).toISOString().slice(0, 10);
/** Erster Tag des Monats, n Monate verschoben. */
export const monthStart = (day: string, by = 0) => { const [y, m] = day.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 10); };
/** Montag der Woche, in der der Tag liegt. */
export const weekStart = (day: string) => shiftDay(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
/** Mitternacht deutscher Zeit an diesem Kalendertag (Sommer- und Winterzeit stimmen). */
export function berlinDayStart(day: string): Date { const [y, m, d] = day.split("-").map(Number); const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0)); const offsetMinutes = (new Date(guess.toLocaleString("en-US", { timeZone: "Europe/Berlin" })).getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime()) / 60_000; return new Date(guess.getTime() - offsetMinutes * 60_000); }

/**
 * Die Kalendertage eines Zeitraums: erster und letzter Tag (beide einschließlich); null heißt offen.
 * `kind` sagt, was gemeint ist – eine Kurzwahl oder ein eigener Zeitraum („zwischen“, „ab“, „vor“: bis einschließlich `toDay`).
 */
export type CallSpan = { kind: CallPeriodKey | CallOpenMode; fromDay: string | null; toDay: string | null };
export function callPeriodSpan(input: CallPeriod | undefined, today: string): CallSpan {
  if (!input) return { kind: "alle", fromDay: null, toDay: null };
  // von/bis schlägt die Kurzwahl; kaputte Angaben werden ignoriert (dann gilt kein Filter)
  if (input.from || input.to) { const fromDay = isDay(input.from) ? input.from : null; const toDay = isDay(input.to) ? input.to : null; return { kind: fromDay && toDay ? "zwischen" : fromDay ? "ab" : toDay ? "vor" : "alle", fromDay, toDay }; }
  const monday = weekStart(today);
  switch (input.period) {
    case "heute": return { kind: "heute", fromDay: today, toDay: null };
    case "gestern": return { kind: "gestern", fromDay: shiftDay(today, -1), toDay: shiftDay(today, -1) };
    case "7": return { kind: "7", fromDay: shiftDay(today, -6), toDay: null };
    case "30": return { kind: "30", fromDay: shiftDay(today, -29), toDay: null };
    case "woche": return { kind: "woche", fromDay: monday, toDay: null };
    case "letzte_woche": return { kind: "letzte_woche", fromDay: shiftDay(monday, -7), toDay: shiftDay(monday, -1) };
    case "letzte_2_wochen": return { kind: "letzte_2_wochen", fromDay: shiftDay(monday, -14), toDay: shiftDay(monday, -1) };
    case "monat": return { kind: "monat", fromDay: monthStart(today), toDay: null };
    case "letzter_monat": return { kind: "letzter_monat", fromDay: monthStart(today, -1), toDay: shiftDay(monthStart(today), -1) };
    default: return { kind: "alle", fromDay: null, toDay: null };
  }
}
/** Grenzen für die Datenbank: ab `from` (einschließlich) bis vor `to`. Zeiträume, die noch laufen, haben kein Ende. */
export function callPeriodRange(input: CallPeriod | undefined, now = new Date()): { from: Date | null; to: Date | null } {
  const span = callPeriodSpan(input, now.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }));
  return { from: span.fromDay ? berlinDayStart(span.fromDay) : null, to: span.toDay ? berlinDayStart(shiftDay(span.toDay, 1)) : null };
}

const dm = (day: string) => { const [, m, d] = day.split("-"); return `${d}.${m}.`; };
const dmy = (day: string) => { const [y, m, d] = day.split("-"); return `${d}.${m}.${y}`; };
/** Ein einzelner Tag: heute, gestern oder ein eigener Zeitraum von einem Tag. („Diese Woche“ am Montag bleibt eine Woche.) */
export const isSingleDaySpan = (span: CallSpan, today: string) => Boolean(span.fromDay) && (span.kind === "heute" || span.kind === "gestern" || span.kind === "zwischen" || span.kind === "ab") && span.fromDay === (span.toDay ?? today);
/** Liegt der heutige Tag im Zeitraum? (Nur dann passen Hinweise wie „+2 heute“.) */
export const spanHasToday = (span: CallSpan, today: string) => (!span.fromDay || span.fromDay <= today) && (!span.toDay || span.toDay >= today);
/** So viele Tage hat der Zeitraum bis heute (oder bis zu seinem Ende) – null, wenn er keinen Anfang hat. */
export function spanLength(span: CallSpan, today: string): number | null { if (!span.fromDay) return null; const end = span.toDay && span.toDay < today ? span.toDay : today; return Math.max(0, daysBetween(span.fromDay, end) + 1); }

export type CallSpanTexts = {
  /** Überschrift: „Diese Woche“, „01.11.–18.11.2026“ */ label: string;
  /** im Satz: „diese Woche“, „vom 01.11. bis 18.11.2026“ */ inText: string;
  /** womit verglichen wird, im Satz: „in der Woche davor“ – leer ohne Vergleich */ before: string;
  /** nach der Prozentzahl: „zur Woche davor“ – leer ohne Vergleich */ versus: string;
  /** ein einzelner Tag: Der Vergleich steht dann als Zahl da, nicht in Prozent */ single: boolean;
};
/** Die Worte zu einem Zeitraum – für Überschrift, Sätze und den Vergleich mit dem Abschnitt davor. */
export function callSpanTexts(span: CallSpan, today: string): CallSpanTexts {
  const single = isSingleDaySpan(span, today); const length = spanLength(span, today) ?? 0; const daysBefore = length === 1 ? "am Tag davor" : `in den ${length} Tagen davor`; const versusDays = length === 1 ? "zum Tag davor" : `zu den ${length} Tagen davor`;
  switch (span.kind) {
    case "heute": return { label: "Heute", inText: "heute", before: "am letzten Tag mit Gesprächen", versus: "", single: true };
    case "gestern": return { label: "Gestern", inText: "gestern", before: "am Tag mit Gesprächen davor", versus: "", single: true };
    case "7": return { label: "7 Tage", inText: "in 7 Tagen", before: "in den 7 Tagen davor", versus: "zu den 7 Tagen davor", single: false };
    case "30": return { label: "30 Tage", inText: "in 30 Tagen", before: "in den 30 Tagen davor", versus: "zu den 30 Tagen davor", single: false };
    case "woche": return { label: "Diese Woche", inText: "diese Woche", before: "in der letzten Woche bis zum selben Wochentag", versus: "zur letzten Woche", single: false };
    case "letzte_woche": return { label: "Letzte Woche", inText: "letzte Woche", before: "in der Woche davor", versus: "zur Woche davor", single: false };
    case "letzte_2_wochen": return { label: "Letzte 2 Wochen", inText: "in den letzten 2 Wochen", before: "in den 2 Wochen davor", versus: "zu den 2 Wochen davor", single: false };
    case "monat": return { label: "Dieser Monat", inText: "diesen Monat", before: "im letzten Monat bis zum selben Tag", versus: "zum letzten Monat", single: false };
    case "letzter_monat": return { label: "Letzter Monat", inText: "letzten Monat", before: "im Monat davor", versus: "zum Monat davor", single: false };
    case "zwischen": {
      const from = span.fromDay!; const to = span.toDay!;
      if (from === to) return { label: dmy(from), inText: `am ${dmy(from)}`, before: "am Tag mit Gesprächen davor", versus: "", single: true };
      return { label: `${from.slice(0, 4) === to.slice(0, 4) ? dm(from) : dmy(from)}–${dmy(to)}`, inText: `vom ${from.slice(0, 4) === to.slice(0, 4) ? dm(from) : dmy(from)} bis ${dmy(to)}`, before: daysBefore, versus: versusDays, single: false };
    }
    case "ab": return { label: `ab ${dmy(span.fromDay!)}`, inText: `seit dem ${dmy(span.fromDay!)}`, before: single ? "am Tag mit Gesprächen davor" : daysBefore, versus: single ? "" : versusDays, single };
    case "vor": { const day = dmy(shiftDay(span.toDay!, 1)); return { label: `vor ${day}`, inText: `vor dem ${day}`, before: "", versus: "", single: false }; }
    default: return { label: "Gesamt", inText: "insgesamt", before: "", versus: "", single: false };
  }
}
