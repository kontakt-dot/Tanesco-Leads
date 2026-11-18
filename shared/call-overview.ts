/**
 * Übersicht über die Gespräche eines Zeitraums („Anzeigetafel“ über der Gesprächsliste).
 *
 * Eine Rechnung für Server und Demo: Zahlen je Ampel-Farbe, Gesprächszeit, der Verlauf (jedes Gespräch ein Balken) und
 * wer wie viele Gespräche geführt hat. Der Agent-Filter gilt für Zahlen und Verlauf – die Liste der Agenten zeigt immer alle,
 * damit man zwischen ihnen wechseln kann.
 */
export type Mood = "gruen" | "gelb" | "rot" | "offen";
/** Ampel eines Gesprächs: grün = passt (freigegeben), orange = reinhören (zur Prüfung), rot = passt nicht (zurückgewiesen), grau = noch nicht bewertet. */
export function moodOf(call: { decision?: string | null; verdict?: string | null; status?: string | null; score?: number | null }): Mood {
  if (call.decision === "freigegeben") return "gruen"; if (call.decision === "zurueckgewiesen") return "rot"; if (call.decision === "pruefen") return "gelb";
  if (call.verdict === "verkaufbar") return "gruen"; if (call.verdict === "nicht_verkaufbar") return "rot"; if (call.verdict === "nachfassen" || call.verdict === "unklar") return "gelb";
  if (call.status === "bewertet" && typeof call.score === "number") return call.score >= 70 ? "gruen" : call.score >= 40 ? "gelb" : "rot";
  return "offen";
}

export type OverviewRow = { id: number; status: string; decision: string | null; verdict?: string | null; score: number | null; agentName: string | null; startedAt: Date | string | null; durationSeconds: number | null; /** Kriterien-Punkte fehlen noch → zählt nicht in die Durchschnittsnote */ unscored?: boolean };
export type CallDecision = "freigegeben" | "pruefen" | "zurueckgewiesen" | "offen";
/** Entscheidung eines Gesprächs – alles, was noch nicht entschieden ist, zählt als „offen“. */
export const decisionOf = (value: string | null | undefined): CallDecision => (value === "freigegeben" || value === "pruefen" || value === "zurueckgewiesen" ? value : "offen");
export type TimelineEntry = { id: number; at: string | null; seconds: number | null; mood: Mood; /** wonach die Zähler rechts filtern */ decision: CallDecision; agent: string | null };
export type AgentTally = { name: string; total: number; approved: number; review: number; rejected: number; open: number; talkSeconds: number };
export type CallOverview = {
  total: number; evaluated: number; approved: number; review: number; rejected: number; open: number; noConsent: number; failed: number;
  averageScore: number | null; /** Anteil freigegebener an den entschiedenen Gesprächen (0–100), null ohne entschiedene */ approvalRate: number | null;
  talkSeconds: number; averageSeconds: number | null;
  /** Verlauf: die jüngsten Gespräche des Zeitraums in zeitlicher Reihenfolge (ältestes zuerst), höchstens TIMELINE_LIMIT */
  timeline: TimelineEntry[]; timelineHidden: number;
  byAgent: AgentTally[];
};
export const TIMELINE_LIMIT = 240;
export const AGENT_LIMIT = 12;
const timeOf = (value: Date | string | null) => (value ? new Date(value).getTime() : 0);

export function summarizeCalls(all: OverviewRow[], filter: { agentName?: string | null } = {}): CallOverview {
  const rows = filter.agentName ? all.filter((row) => row.agentName === filter.agentName) : all;
  let approved = 0; let review = 0; let rejected = 0; let evaluated = 0; let noConsent = 0; let failed = 0; let talkSeconds = 0; let timed = 0; let scoreSum = 0; let scoreCount = 0;
  for (const row of rows) {
    if (row.decision === "freigegeben") approved += 1; else if (row.decision === "pruefen") review += 1; else if (row.decision === "zurueckgewiesen") rejected += 1;
    if (row.status === "bewertet") evaluated += 1; if (row.status === "ohne_einwilligung") noConsent += 1; if (row.status === "fehlgeschlagen") failed += 1;
    if (typeof row.durationSeconds === "number" && row.durationSeconds > 0) { talkSeconds += row.durationSeconds; timed += 1; }
    if (typeof row.score === "number" && !row.unscored) { scoreSum += row.score; scoreCount += 1; }
  }
  const decided = approved + review + rejected;
  const sorted = [...rows].sort((a, b) => timeOf(a.startedAt) - timeOf(b.startedAt) || a.id - b.id);
  const shown = sorted.slice(Math.max(0, sorted.length - TIMELINE_LIMIT));
  const tallies = new Map<string, AgentTally>();
  for (const row of all) {
    const name = (row.agentName ?? "").trim(); if (!name) continue;
    const tally = tallies.get(name) ?? { name, total: 0, approved: 0, review: 0, rejected: 0, open: 0, talkSeconds: 0 };
    tally.total += 1; if (row.decision === "freigegeben") tally.approved += 1; else if (row.decision === "pruefen") tally.review += 1; else if (row.decision === "zurueckgewiesen") tally.rejected += 1; else tally.open += 1;
    if (typeof row.durationSeconds === "number" && row.durationSeconds > 0) tally.talkSeconds += row.durationSeconds;
    tallies.set(name, tally);
  }
  return {
    total: rows.length, evaluated, approved, review, rejected, open: rows.length - decided, noConsent, failed,
    averageScore: scoreCount ? Math.round(scoreSum / scoreCount) : null,
    approvalRate: decided ? Math.round((approved / decided) * 100) : null,
    talkSeconds, averageSeconds: timed ? Math.round(talkSeconds / timed) : null,
    timeline: shown.map((row) => ({ id: row.id, at: row.startedAt ? new Date(row.startedAt).toISOString() : null, seconds: row.durationSeconds ?? null, mood: moodOf(row), decision: decisionOf(row.decision), agent: row.agentName ?? null })),
    timelineHidden: sorted.length - shown.length,
    byAgent: Array.from(tallies.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "de")).slice(0, AGENT_LIMIT),
  };
}

/** Gesprächszeit in Worten: 4320 → „1 Std 12 Min“, 185 → „3 Min“, 40 → „40 Sek“. */
export function talkTimeText(seconds: number | null | undefined): string {
  const value = Math.max(0, Math.round(seconds ?? 0));
  if (value < 60) return `${value} Sek`;
  const hours = Math.floor(value / 3600); const minutes = Math.round((value % 3600) / 60);
  if (!hours) return `${minutes} Min`;
  return minutes === 60 ? `${hours + 1} Std` : minutes ? `${hours} Std ${minutes} Min` : `${hours} Std`;
}
/** Dauer eines Gesprächs: 133 → „2:13“. */
export const clockText = (seconds: number | null | undefined): string => { if (seconds === null || seconds === undefined) return "–"; const value = Math.max(0, Math.round(seconds)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`; };
/** Höhe eines Verlauf-Balkens (0–1): Wurzel-Skala, damit auch kurze Gespräche sichtbar bleiben; ohne Dauer ein kleiner Stummel. */
export function barHeight(seconds: number | null | undefined, longest: number): number {
  if (!seconds || seconds <= 0 || longest <= 0) return 0.16;
  return Math.min(1, 0.16 + 0.84 * Math.sqrt(Math.min(seconds, longest) / longest));
}

/* ───────── Zeitraum, Beschriftung und Anordnung des Verlaufs (ohne Oberfläche – damit es sich prüfen lässt) ───────── */
export type CallRange = { period: "heute" | "gestern" | "7" | "30" | "alle"; from: string; to: string };
export const CALL_PERIODS: Array<[CallRange["period"], string]> = [["heute", "Heute"], ["gestern", "Gestern"], ["7", "7 Tage"], ["30", "30 Tage"], ["alle", "Gesamt"]];
export type DecisionFilter = "" | CallDecision;
export const DECISION_LABEL: Record<CallDecision, string> = { freigegeben: "Freigegeben", pruefen: "Zur Prüfung", zurueckgewiesen: "Zurückgewiesen", offen: "Offen" };

const WEEKDAY = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const pad = (value: number) => String(value).padStart(2, "0");
export const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** „Heute“, „Gestern“ oder „Mo 16.11.“ */
export function dayLabel(date: Date, now = new Date()): string {
  const key = dayKey(date); if (key === dayKey(now)) return "Heute";
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1); if (key === dayKey(yesterday)) return "Gestern";
  return `${WEEKDAY[date.getDay()]} ${pad(date.getDate())}.${pad(date.getMonth() + 1)}.`;
}
export const timeText = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const shortDate = (value: string) => { const [year, month, day] = value.split("-"); return day && month ? `${day}.${month}.${year ?? ""}` : value; };
/** Zeitraum in Worten für die Überschrift: „heute“, „in den letzten 7 Tagen“, „vom 01.11.2026 bis 18.11.2026“. */
export function periodPhrase(range: CallRange): string {
  if (range.from && range.to) return range.from === range.to ? `am ${shortDate(range.from)}` : `vom ${shortDate(range.from)} bis ${shortDate(range.to)}`;
  if (range.from) return `seit dem ${shortDate(range.from)}`; if (range.to) return `bis zum ${shortDate(range.to)}`;
  return range.period === "heute" ? "heute" : range.period === "gestern" ? "gestern" : range.period === "7" ? "in den letzten 7 Tagen" : range.period === "30" ? "in den letzten 30 Tagen" : "insgesamt";
}

export type WaveGroup = { key: string; label: string; short: string; entries: TimelineEntry[] };
/** Verlauf in Abschnitte teilen: an einem einzigen Tag nach Stunden („9 Uhr“), über mehrere Tage nach Tagen („16.11.“, „Gestern“, „Heute“). */
export function groupTimeline(entries: TimelineEntry[], now = new Date()): { groups: WaveGroup[]; byHour: boolean } {
  const days = new Set<string>(); for (const entry of entries) if (entry.at) days.add(dayKey(new Date(entry.at)));
  const byHour = days.size <= 1; const groups: WaveGroup[] = [];
  for (const entry of entries) {
    const date = entry.at ? new Date(entry.at) : null;
    const key = !date ? "ohne" : byHour ? `h${date.getHours()}` : dayKey(date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) { last.entries.push(entry); continue; }
    const near = date && !byHour ? dayLabel(date, now) : "";
    groups.push({ key, label: !date ? "ohne Uhrzeit" : byHour ? `${date.getHours()} Uhr` : near === "Heute" || near === "Gestern" ? near : `${date.getDate()}.${date.getMonth() + 1}.`, short: !date ? "" : byHour ? String(date.getHours()) : `${date.getDate()}.`, entries: [entry] });
  }
  return { groups, byHour };
}

/** Der eine Tag, den der Zeitraum meint (Heute, Gestern, von = bis) – sonst null. */
export function singleDayOf(range: CallRange, now = new Date()): Date | null {
  if (range.from || range.to) { if (!range.from || range.from !== range.to) return null; const [year, month, day] = range.from.split("-").map(Number); return year && month && day ? new Date(year, month - 1, day) : null; }
  if (range.period === "heute") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range.period === "gestern") return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return null;
}
export const CLOCK_UNITS = 1000; export const CLOCK_LIMIT = 60;
export type ClockLayout = { start: number; end: number; width: number; bars: Array<{ entry: TimelineEntry; x: number }>; ticks: Array<{ hour: number; x: number; label: boolean }>; nowX: number | null; untimed: number };
/**
 * Tagesverlauf auf einer Uhrzeit-Achse: Jedes Gespräch steht dort, wo es begonnen hat – Lücken zeigen, wann nicht telefoniert wurde.
 * Die Achse reicht mindestens von 8 bis 18 Uhr und wächst, wenn früher oder später telefoniert wurde. Striche, die sich
 * überdecken würden, rücken ein Stück nach rechts.
 */
export function clockLayout(entries: TimelineEntry[], day: Date, now = new Date()): ClockLayout {
  const timed = entries.filter((entry) => entry.at).map((entry) => { const date = new Date(entry.at as string); return { entry, from: date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600 }; }).sort((a, b) => a.from - b.from || a.entry.id - b.entry.id);
  let start = 8; let end = 18;
  for (const { entry, from } of timed) { start = Math.min(start, Math.floor(from)); end = Math.max(end, Math.ceil(from + (entry.seconds ?? 0) / 3600 + 0.02)); }
  const isToday = dayKey(day) === dayKey(now); const nowHour = now.getHours() + now.getMinutes() / 60;
  if (isToday) { end = Math.max(end, Math.ceil(nowHour + 0.02)); start = Math.min(start, Math.floor(nowHour)); } // heute gehört „jetzt“ immer auf die Achse
  start = Math.max(0, start); end = Math.min(24, Math.max(end, start + 1)); const span = end - start;
  const width = timed.length > 40 ? 5 : timed.length > 20 ? 7 : 10; const gap = 2.5; let edge = -Infinity;
  const bars = timed.map(({ entry, from }) => { let x = ((from - start) / span) * CLOCK_UNITS; if (x < edge) x = edge; x = Math.max(0, Math.min(CLOCK_UNITS - width, x)); edge = x + width + gap; return { entry, x: Math.round(x * 10) / 10 }; });
  const step = span <= 11 ? 1 : span <= 16 ? 2 : 3; const ticks: ClockLayout["ticks"] = [];
  for (let hour = start; hour <= end; hour += 1) ticks.push({ hour, x: ((hour - start) / span) * 100, label: hour < end && (hour - start) % step === 0 });
  return { start, end, width, bars, ticks, nowX: isToday && nowHour >= start && nowHour <= end ? Math.round(((nowHour - start) / span) * 1000) / 10 : null, untimed: entries.length - timed.length };
}
