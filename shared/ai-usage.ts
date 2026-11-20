/**
 * KI-Verbrauch: wofür die KI an welchem Tag wie viel gekostet hat.
 * Jede Anfrage wird mit ihrem Zweck verbucht (aiUsageDays: Tag, Zweck, Anfragen, Kosten). Hier stehen die Namen der Zwecke in
 * einfachen Wörtern, die Bereiche, zu denen sie gehören, und die Rechnung für die Übersicht – Server und Vorschau nutzen dieselbe.
 */
export type AiArea = "gespraeche" | "kampagnen" | "firmen" | "assistenten" | "sonstiges";
/** Bereiche in fester Reihenfolge – daran hängt auch die Farbe im Schaubild (nie nach Rang umsortieren). */
export const AI_AREAS: Array<{ key: AiArea; label: string; hint: string }> = [
  { key: "gespraeche", label: "Gespräche", hint: "Telefonate bewerten, Prüffragen, Agent und Kontakt erkennen" },
  { key: "kampagnen", label: "E-Mail-Kampagnen", hint: "E-Mails vorschreiben, Kategorien prüfen" },
  { key: "firmen", label: "Firmen und Webseiten", hint: "Webseiten lesen, Firmenprofile für den Lead-Finder" },
  { key: "assistenten", label: "Assistenten", hint: "Kategorie, Integration oder Automatisierung per KI anlegen" },
  { key: "sonstiges", label: "Sonstiges", hint: "Hilfe und einzelne Auswertungen" },
];
const PURPOSES: Record<string, { label: string; area: AiArea }> = {
  gespraechsbewertung: { label: "Gespräche bewerten", area: "gespraeche" },
  qualifizierung: { label: "Prüffragen der Kampagne beantworten", area: "gespraeche" },
  zeitmarken: { label: "Stellen im Gespräch finden", area: "gespraeche" },
  agentenname: { label: "Agent erkennen", area: "gespraeche" },
  gespraechsnotiz: { label: "Gesprächsnotiz schreiben", area: "gespraeche" },
  kontakt_aus_gespraech: { label: "Kontakt aus dem Gespräch lesen", area: "gespraeche" },
  kunde: { label: "Kontakt aus dem Gespräch lesen", area: "gespraeche" },
  vorschlaege: { label: "E-Mail-Entwürfe", area: "kampagnen" },
  email_entwurf: { label: "E-Mail schreiben lassen", area: "kampagnen" },
  email_serie: { label: "E-Mail-Serie schreiben lassen", area: "kampagnen" },
  nachricht: { label: "Antwort schreiben lassen", area: "kampagnen" },
  kategoriepruefung: { label: "Kategorie-Prüfung", area: "kampagnen" },
  webseite: { label: "Webseiten lesen", area: "firmen" },
  firmenprofil: { label: "Firmenprofil erstellen", area: "firmen" },
  lead_category_builder_draft: { label: "Lead-Kategorie anlegen", area: "assistenten" },
  integration_builder_draft: { label: "Integration anlegen", area: "assistenten" },
  automation_builder_draft: { label: "Automatisierung anlegen", area: "assistenten" },
  sonstiges: { label: "Sonstiges (Hilfe, Auswertungen)", area: "sonstiges" },
};
/** Name und Bereich eines Zwecks; unbekannte Zwecke stehen mit ihrem Kürzel unter „Sonstiges“. */
export function purposeInfo(purpose: string): { label: string; area: AiArea } {
  return PURPOSES[purpose] ?? { label: purpose.replace(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase()) || "Sonstiges", area: "sonstiges" };
}

export type AiUsageRow = { day: string; purpose: string; calls: number; costMilliCents: number };
export type AiUsagePart = { purpose: string; label: string; area: AiArea; calls: number; cents: number };
export type AiUsageDay = { day: string; cents: number; calls: number; areas: Record<AiArea, number>; parts: AiUsagePart[] };
export type AiUsageHistory = { today: string; days: AiUsageDay[]; totalCents: number; totalCalls: number; weekCents: number; areas: Record<AiArea, number>; maxCents: number };
const zeroAreas = (): Record<AiArea, number> => ({ gespraeche: 0, kampagnen: 0, firmen: 0, assistenten: 0, sonstiges: 0 });
const shiftDay = (day: string, by: number) => { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + by); return date.toISOString().slice(0, 10); };
/**
 * Übersicht der letzten `count` Tage bis einschließlich heute – auch Tage ohne Verbrauch stehen drin (0 €), damit das Schaubild keine Lücken überspringt.
 * Beträge in Cent (auf zwei Stellen), die Summen werden aus den genauen Kosten gerechnet und erst dann gerundet.
 */
export function aiUsageHistory(rows: AiUsageRow[], today: string, count = 30): AiUsageHistory {
  const first = shiftDay(today, -(count - 1)); const byDay = new Map<string, AiUsageRow[]>();
  for (const row of rows) { if (row.day < first || row.day > today) continue; byDay.set(row.day, [...(byDay.get(row.day) ?? []), row]); }
  const days: AiUsageDay[] = []; const areasMilli = zeroAreas(); let totalMilli = 0; let weekMilli = 0; let totalCalls = 0; const weekStart = shiftDay(today, -6);
  for (let index = 0; index < count; index += 1) {
    const day = shiftDay(first, index); const list = byDay.get(day) ?? []; const merged = new Map<string, { calls: number; milli: number; area: AiArea; label: string }>();
    for (const row of list) { const info = purposeInfo(row.purpose); const key = info.label; const entry = merged.get(key) ?? { calls: 0, milli: 0, area: info.area, label: info.label }; entry.calls += row.calls; entry.milli += row.costMilliCents; merged.set(key, entry); } // „kunde“ und „kontakt_aus_gespraech“ sind derselbe Zweck
    const dayAreas = zeroAreas(); let dayMilli = 0; let dayCalls = 0;
    for (const entry of Array.from(merged.values())) { dayAreas[entry.area] += entry.milli; areasMilli[entry.area] += entry.milli; dayMilli += entry.milli; dayCalls += entry.calls; }
    totalMilli += dayMilli; totalCalls += dayCalls; if (day >= weekStart) weekMilli += dayMilli;
    const parts = Array.from(merged.entries()).map(([key, entry]) => ({ purpose: key, label: entry.label, area: entry.area, calls: entry.calls, cents: Math.round(entry.milli / 1000) })).sort((a, b) => b.cents - a.cents || b.calls - a.calls || a.label.localeCompare(b.label, "de"));
    days.push({ day, cents: Math.round(dayMilli / 1000), calls: dayCalls, areas: Object.fromEntries(AI_AREAS.map((area) => [area.key, Math.round(dayAreas[area.key] / 1000)])) as Record<AiArea, number>, parts });
  }
  return { today, days, totalCents: Math.round(totalMilli / 1000), totalCalls, weekCents: Math.round(weekMilli / 1000), areas: Object.fromEntries(AI_AREAS.map((area) => [area.key, Math.round(areasMilli[area.key] / 1000)])) as Record<AiArea, number>, maxCents: days.reduce((max, day) => Math.max(max, day.cents), 0) };
}
/** Runde obere Grenze für die Skala (in Cent): 1 €, 2 €, 5 €, 10 €, 20 €, 50 € … – mindestens 1 €. */
export function niceCeilCents(cents: number): number {
  const euros = Math.max(1, cents / 100); const power = 10 ** Math.floor(Math.log10(euros)); const step = [1, 2, 5, 10].find((factor) => factor * power >= euros) ?? 10;
  return Math.round(step * power * 100);
}
