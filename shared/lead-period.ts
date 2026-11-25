/**
 * Kacheln über der Leads-Tabelle folgen dem gewählten Zeitraum (seit Version 366).
 *
 *  - Ist „Gestern“ gewählt, heißt die zweite Kachel „Gestern“ (statt „Heute neu“) und zeigt die Leads von gestern – verglichen mit vorgestern.
 *  - „Bereit zum Ausliefern“, „Ausgeliefert“ und „Reklamiert“ zählen dann nur die Leads aus diesem Zeitraum.
 *
 * Die Tabelle filtert ganze Tage (von 00:00 bis 23:59). Läuft ein Zeitraum noch (heute, diese Woche, dieser Monat, ab einem Tag),
 * wird mit demselben Stück davor verglichen – bis zur selben Uhrzeit. Abgeschlossene Zeiträume werden mit dem gleich langen Stück davor verglichen.
 */
import type { OverviewTone } from "./lead-overview";

/** Zeitraum der Leads-Tabelle (wie im Auswahlfeld „Zeitraum“) – leer = nur über die Felder „Erstellt ab/bis“ der Filter gesetzt */
export type LeadPeriodKind = "today" | "yesterday" | "week" | "last_week" | "last_two_weeks" | "month" | "last_month" | "all" | "custom" | "since" | "before" | "";

export type TilePeriod = {
  /** Name der Kachel: „Gestern“, „Diese Woche“, „10.11.–24.11.“ */
  label: string;
  /** Zusatz unter den anderen Kacheln: „von gestern“, „aus dieser Woche“ */
  scope: string;
  from: Date | null; to: Date | null;
  /** Vergleichsspanne – fehlt bei „Erstellt vor …“ (davor gibt es nichts Gleiches) */
  previousFrom: Date | null; previousTo: Date | null;
  /** womit verglichen wird: „vorgestern“ → „3 mehr als vorgestern“, „so viele wie vorgestern“ */
  versus: string | null;
  /** läuft noch (bis jetzt) – verglichen wird bis zur selben Uhrzeit */
  running: boolean;
};

const startOf = (value: string) => new Date(`${value}T00:00:00`);
const endOf = (value: string) => new Date(`${value}T23:59:59.999`);
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
/** Tage verschieben – im Kalender, damit die Uhrzeit auch über die Zeitumstellung gleich bleibt */
function addDays(date: Date, days: number): Date { const result = new Date(date); result.setDate(result.getDate() + days); return result; }
/** Monate verschieben; gibt es den Tag im Zielmonat nicht (31. → November), gilt der letzte Tag */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date); const day = result.getDate(); result.setDate(1); result.setMonth(result.getMonth() + months);
  const last = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate(); result.setDate(Math.min(day, last)); return result;
}
/** „10.11.“ – mit Jahr („10.11.25“), wenn es nicht dieses Jahr ist */
function shortDay(date: Date, now: Date): string {
  const text = `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.`;
  return date.getFullYear() === now.getFullYear() ? text : `${text}${String(date.getFullYear()).slice(-2)}`;
}
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const daysBetween = (from: Date, to: Date) => Math.max(1, Math.round((startOf(dayKey(to)).getTime() - startOf(dayKey(from)).getTime()) / 86_400_000) + 1);

/**
 * Kachel-Zeitraum aus dem Zeitraum der Tabelle. `createdFrom`/`createdTo` sind die Tage der Tabelle (JJJJ-MM-TT, beide eingeschlossen).
 * Ohne Tage (gesamter Zeitraum) gibt es keinen – dann zeigen die Kacheln alles wie bisher.
 */
export function tilePeriod(kind: LeadPeriodKind, createdFrom: string, createdTo: string, now: Date = new Date()): TilePeriod | null {
  if (!createdFrom && !createdTo) return null;
  const from = createdFrom ? startOf(createdFrom) : null; const to = createdTo ? endOf(createdTo) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from > to)) return null;
  const todayKey = dayKey(now); const yesterdayKey = dayKey(addDays(now, -1));
  const running = !to || to.getTime() >= now.getTime();
  const base = { from, to, running };
  const shift = (days: number) => ({ previousFrom: from ? addDays(from, -days) : null, previousTo: addDays(running ? now : to!, -days) });
  /** ein einzelner Tag (auch aus einer Säule) – „Diese Woche“ am Montag und „Dieser Monat“ am Ersten bleiben, was sie sind */
  const single = Boolean(createdFrom) && createdFrom === createdTo && kind !== "week" && kind !== "month";
  if (kind === "today" || (single && createdFrom === todayKey)) return { ...base, label: "Heute neu", scope: "von heute", ...shift(1), versus: "gestern" };
  if (kind === "yesterday" || (single && createdFrom === yesterdayKey)) return { ...base, label: "Gestern", scope: "von gestern", ...shift(1), versus: "vorgestern" };
  if (kind === "week" && from) return { ...base, label: "Diese Woche", scope: "aus dieser Woche", ...shift(7), versus: "letzte Woche" };
  if (kind === "last_week" && from && to) return { ...base, label: "Letzte Woche", scope: "aus der letzten Woche", ...shift(7), versus: "die Woche davor" };
  if (kind === "last_two_weeks" && from && to) return { ...base, label: "Letzte 2 Wochen", scope: "aus den letzten 2 Wochen", ...shift(14), versus: "die 2 Wochen davor" };
  if (kind === "month" && from) return { ...base, label: "Dieser Monat", scope: "aus diesem Monat", previousFrom: addMonths(from, -1), previousTo: addMonths(running ? now : to!, -1), versus: "letzten Monat" };
  if (kind === "last_month" && from && to) { const previousFrom = addMonths(from, -1); return { ...base, label: "Letzter Monat", scope: "aus dem letzten Monat", previousFrom, previousTo: new Date(from.getTime() - 1), versus: "im Monat davor" }; }
  if (single) return { ...base, label: `${WEEKDAYS[from!.getDay()]}, ${shortDay(from!, now)}`, scope: `vom ${shortDay(from!, now)}`, ...shift(1), versus: "am Tag davor" };
  // Erstellt vor …: alles bis zu einem Tag – davor gibt es nichts gleich Langes zum Vergleichen
  if (!from && to) { const before = addDays(to, 1); return { ...base, label: `Vor ${shortDay(before, now)}`, scope: `vor dem ${shortDay(before, now)}`, previousFrom: null, previousTo: null, versus: null }; }
  // Erstellt ab … (bis heute) oder Erstellt zwischen …: so viele Tage davor
  const days = daysBetween(from!, running ? now : to!);
  const versus = days === 1 ? "am Tag davor" : `die ${days} Tage davor`;
  if (!to) return { ...base, label: `Ab ${shortDay(from!, now)}`, scope: `seit dem ${shortDay(from!, now)}`, ...shift(days), versus };
  return { ...base, label: `${shortDay(from!, now)}–${shortDay(to, now)}`, scope: "aus dem Zeitraum", ...shift(days), versus };
}

const de = (value: number) => value.toLocaleString("de-DE");
/** „3 mehr als vorgestern“ / „2 weniger als die Woche davor“ / „so viele wie gestern“ – ohne Vergleichsspanne keine Aussage */
export function periodComparison(total: number, previous: number | null | undefined, versus: string | null): { tone: OverviewTone; arrow: "↑" | "↓" | "="; text: string } | null {
  if (previous === null || previous === undefined || !versus) return null;
  const diff = total - previous;
  if (diff > 0) return { tone: "gut", arrow: "↑", text: `${de(diff)} mehr als ${versus}` };
  if (diff < 0) return { tone: "ruhig", arrow: "↓", text: `${de(-diff)} weniger als ${versus}` };
  return { tone: "ruhig", arrow: "=", text: total ? `so viele wie ${versus}` : `wie ${versus}` };
}

/** Wo die Leads des Zeitraums stehen – aus den Zahlen je Status */
export function periodSplit(statuses: Record<string, number> | null | undefined) {
  const count = (status: string) => Number(statuses?.[status] ?? 0);
  const total = Object.values(statuses ?? {}).reduce((sum, value) => sum + Number(value || 0), 0);
  return { total, ready: count("genehmigt"), delivered: count("zugewiesen"), claimed: count("reklamiert") };
}
