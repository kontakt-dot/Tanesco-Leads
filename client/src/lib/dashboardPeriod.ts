/** „since“ = „Erstellt ab“ (ab einem Tag bis jetzt), „before“ = „Erstellt vor“ (alles vor einem Tag) – seit v377 auch im Dashboard, wie auf der Leads-Seite. */
export type DashboardPeriod = "today" | "yesterday" | "week" | "month" | "last_month" | "last_week" | "last_two_weeks" | "all" | "custom" | "since" | "before";

export type DashboardRange = {
  from: Date;
  until: Date;
  label: string;
  valid: boolean;
  /** Nur bei „Eigener Zeitraum“, „Erstellt ab“ und „Erstellt vor“: warum die Auswahl (noch) nicht gültig ist. */
  problem?: "missing" | "order";
  /** Offener Zeitraum: „since“ reicht bis jetzt, „before“ hat keinen Anfang (wie „Gesamt“ – ohne Schnitt je Tag). */
  open?: "since" | "before";
};

/** Schnellwahl im eigenen Zeitraum – füllt Von/Bis, bleibt danach frei änderbar. */
export type CustomRangePreset = "last7" | "last30" | "last90" | "last_month" | "this_quarter" | "this_year";
export const CUSTOM_RANGE_PRESETS: Array<[CustomRangePreset, string]> = [["last7", "Letzte 7 Tage"], ["last30", "Letzte 30 Tage"], ["last90", "Letzte 90 Tage"], ["last_month", "Letzter Monat"], ["this_quarter", "Dieses Quartal"], ["this_year", "Dieses Jahr"]];

function atStartOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function atEndOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function fromInput(value: string, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const result = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
  return Number.isNaN(result.getTime()) ? undefined : result;
}

/** Datum → Wert für <input type="date"> (lokale Zeit, kein UTC-Versatz). */
export function toDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatRangeDate(date: Date) {
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Anzahl Kalendertage einer Spanne (Von und Bis eingeschlossen). */
export function rangeDayCount(from: Date, until: Date) {
  return Math.max(1, Math.round((atStartOfDay(until).getTime() - atStartOfDay(from).getTime()) / 86_400_000) + 1);
}

export function customRangePreset(preset: CustomRangePreset, now = new Date()): { from: string; to: string } {
  const today = atStartOfDay(now);
  const daysBack = (days: number) => { const from = new Date(today); from.setDate(from.getDate() - (days - 1)); return { from: toDateInput(from), to: toDateInput(today) }; };
  if (preset === "last7") return daysBack(7);
  if (preset === "last30") return daysBack(30);
  if (preset === "last90") return daysBack(90);
  if (preset === "last_month") { const from = new Date(today.getFullYear(), today.getMonth() - 1, 1); const to = new Date(today.getFullYear(), today.getMonth(), 0); return { from: toDateInput(from), to: toDateInput(to) }; }
  if (preset === "this_quarter") { const from = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1); return { from: toDateInput(from), to: toDateInput(today) }; }
  return { from: toDateInput(new Date(today.getFullYear(), 0, 1)), to: toDateInput(today) };
}

export function dashboardRange(period: DashboardPeriod, customFrom: string, customTo: string, now = new Date()): DashboardRange {
  const today = atStartOfDay(now);
  if (period === "today") return { from: today, until: now, label: "Heute", valid: true };
  if (period === "yesterday") { const from = atStartOfDay(now); from.setDate(from.getDate() - 1); return { from, until: atEndOfDay(from), label: "Gestern", valid: true }; }
  if (period === "week") { const from = atStartOfDay(now); from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); return { from, until: now, label: "Diese Woche", valid: true }; }
  if (period === "month") { const from = atStartOfDay(now); from.setDate(1); return { from, until: now, label: "Dieser Monat", valid: true }; }
  if (period === "last_month") { const from = new Date(now.getFullYear(), now.getMonth() - 1, 1); const until = atEndOfDay(new Date(now.getFullYear(), now.getMonth(), 0)); return { from, until, label: "Letzter Monat", valid: true }; } // der ganze Vormonat
  if (period === "last_week") { const until = atStartOfDay(now); until.setDate(until.getDate() - ((until.getDay() + 6) % 7) - 1); const from = atStartOfDay(until); from.setDate(from.getDate() - 6); return { from, until: atEndOfDay(until), label: "Letzte Woche", valid: true }; }
  if (period === "last_two_weeks") { const until = atStartOfDay(now); until.setDate(until.getDate() - ((until.getDay() + 6) % 7) - 1); const from = atStartOfDay(until); from.setDate(from.getDate() - 13); return { from, until: atEndOfDay(until), label: "Letzte 2 Wochen", valid: true }; }
  if (period === "all") return { from: new Date(0), until: now, label: "Gesamte Zeitspanne", valid: true };
  if (period === "since") {
    // „Erstellt ab“: ab dem gewählten Tag (customFrom) bis jetzt. Liegt der Tag in der Zukunft, ist der Zeitraum gültig, aber leer.
    const from = fromInput(customFrom);
    if (!from) return { from: today, until: now, label: "Erstellt ab …", valid: false, problem: "missing", open: "since" };
    return { from, until: from > now ? atEndOfDay(from) : now, label: `ab ${formatRangeDate(from)}`, valid: true, open: "since" };
  }
  if (period === "before") {
    // „Erstellt vor“: alles vor dem gewählten Tag (customTo) – der Tag selbst zählt nicht mit.
    const day = fromInput(customTo);
    if (!day) return { from: today, until: now, label: "Erstellt vor …", valid: false, problem: "missing", open: "before" };
    return { from: new Date(0), until: new Date(day.getTime() - 1), label: `vor ${formatRangeDate(day)}`, valid: true, open: "before" };
  }
  const from = fromInput(customFrom);
  const until = fromInput(customTo, true);
  if (!from || !until) return { from: today, until: now, label: "Eigener Zeitraum", valid: false, problem: "missing" };
  if (from > until) return { from: today, until: now, label: "Eigener Zeitraum", valid: false, problem: "order" };
  return { from, until, label: `${formatRangeDate(from)} – ${formatRangeDate(until)}`, valid: true };
}

export function precedingRange(range: DashboardRange): DashboardRange {
  const duration = range.until.getTime() - range.from.getTime() + 1;
  const until = new Date(range.from.getTime() - 1);
  return { from: new Date(until.getTime() - duration + 1), until, label: "Vorheriger Vergleichszeitraum", valid: range.valid };
}

export function relativeChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}
