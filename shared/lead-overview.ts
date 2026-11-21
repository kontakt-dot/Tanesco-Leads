/**
 * Zahlen über der Leads-Tabelle und im Lead-Puls – eine Rechnung für Server und Vorschau.
 *  - Übersicht: alle Leads, heute neu (mit gestern zum Vergleich), die letzten 7 Tage, noch offen, ausgeliefert, und die letzten 14 Tage je Tag.
 *  - Lead-Puls: wie viele Leads es im gewählten Zeitraum gibt und wie viele davon in den letzten 24 Stunden kamen.
 * Tage sind Kalendertage in Berlin.
 */
import { berlinDay } from "./agent-ranking";

export type LeadStatusKey = "neu" | "genehmigt" | "zugewiesen" | "reklamiert" | "fehlerhaft" | "deaktiviert" | "hängend";
export type LeadCounts = Record<LeadStatusKey | "alle" | "dubletten", number>;
export const emptyLeadCounts = (): LeadCounts => ({ alle: 0, neu: 0, genehmigt: 0, zugewiesen: 0, reklamiert: 0, fehlerhaft: 0, deaktiviert: 0, hängend: 0, dubletten: 0 });

export type LeadsOverview = { total: number; today: number; yesterday: number; week: number; open: number; ready: number; delivered: number; days: Array<{ day: string; count: number }> };
export const OVERVIEW_DAYS = 14;
/** Kalendertag in Berlin, n Tage vor dem Tag von `now` (als JJJJ-MM-TT). */
export function berlinDayBefore(now: Date, back: number): string {
  const [year, month, day] = berlinDay(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - back, 12)).toISOString().slice(0, 10);
}
/**
 * Übersicht aus den Zahlen je Status und den Eingangszeiten der letzten Tage.
 * „Offen“ = noch nicht ausgeliefert (neu, genehmigt, hängend); „bereit“ = genehmigt, wartet auf die Auslieferung. Die 14 Tage laufen von alt nach neu, heute steht rechts.
 */
export function leadsOverview(statusCounts: Array<{ status: string; count: number }>, createdAts: Array<Date | string | number>, now: Date = new Date()): LeadsOverview {
  const byStatus = new Map<string, number>(); for (const row of statusCounts) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + (Number(row.count) || 0));
  const perDay = new Map<string, number>(); for (const value of createdAts) { const day = berlinDay(value); perDay.set(day, (perDay.get(day) ?? 0) + 1); }
  const days = Array.from({ length: OVERVIEW_DAYS }, (_, index) => { const day = berlinDayBefore(now, OVERVIEW_DAYS - 1 - index); return { day, count: perDay.get(day) ?? 0 }; });
  const sum = (list: Array<{ count: number }>) => list.reduce((total, item) => total + item.count, 0);
  return {
    total: Array.from(byStatus.values()).reduce((total, count) => total + count, 0),
    today: days[days.length - 1].count, yesterday: days[days.length - 2].count, week: sum(days.slice(-7)),
    open: (byStatus.get("neu") ?? 0) + (byStatus.get("genehmigt") ?? 0) + (byStatus.get("hängend") ?? 0),
    ready: byStatus.get("genehmigt") ?? 0, delivered: byStatus.get("zugewiesen") ?? 0, days,
  };
}
export const emptyLeadsOverview = (now: Date = new Date()): LeadsOverview => leadsOverview([], [], now);

/** Lead-Puls: höchstens so viele Leads gehen auf einmal an die Oberfläche – das Fenster rollt, die Zahl darüber nennt alle. */
export const PULSE_LIMIT = 300;
