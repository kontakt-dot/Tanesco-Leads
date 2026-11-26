/**
 * Bestenliste der Agenten: Reihenfolge, Auf- und Abstieg, Serien, Stufen, Bestwerte.
 * Server und Vorschau liefern dieselben Bausteine (Zahlen je Agent im Zeitraum, je Agent und Tag, insgesamt, zuletzt erreichte
 * Leads) – hier entsteht daraus die Liste. Ein „Lead“ ist ein freigegebenes (grünes) Gespräch.
 */
import { callPeriodSpan, daysBetween, isSingleDaySpan, monthStart, shiftDay, type CallPeriodKey, type CallSpan } from "./call-period";
export { daysBetween, shiftDay } from "./call-period";
/** Zeitraum der Bestenliste: dieselben Kurzwahlen wie in der Gesprächsliste (dazu kommt ein eigener Zeitraum über von/bis). */
export type AgentReportPeriod = CallPeriodKey;

/** Zahlen eines Agenten im Zeitraum (aus Anrufen im eigenen Dialer und aus Gesprächen). */
export type AgentBucket = { userId: number | null; name: string; calls: number; reached: number; talkSeconds: number; dispositions: Record<string, number>; evaluated: number; scoreSum: number; approved: number; review: number; rejected: number; verkaufbar: number; nachfassen: number; nichtVerkaufbar: number; lastCallAt: Date | string | null };
/** Gespräche eines Agenten an einem Tag (deutsche Zeit, JJJJ-MM-TT). */
export type AgentDay = { name: string; day: string; calls: number; approved: number; /** bewertete Gespräche – für den Grün-Anteil im Abschnitt davor */ evaluated?: number };
/** Zahlen eines Agenten in einem anderen Zeitraum (davor) – für Auf- und Abstieg. */
export type AgentCount = { name: string; calls: number; approved: number; evaluated: number };
/** Ein zuletzt erreichter Lead. */
export type AgentWin = { callId: number; name: string | null; at: Date | string | null; campaign: string | null };

export const NO_AGENT = "Ohne Agent";
export const isNoAgent = (name: string | null | undefined) => !name || !name.trim() || /^ohne agent$/i.test(name.trim());
/** Schlüssel eines Namens: ohne Groß-/Kleinschreibung und Akzente – so fasst auch die Datenbank Namen zusammen („Jose“ = „José“ = „JOSE“). „Ohne Agent“ hat den leeren Schlüssel. */
export const nameKey = (name: string | null | undefined) => (isNoAgent(name) ? "" : name!.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("de"));
export const emptyBucket = (userId: number | null, name: string): AgentBucket => ({ userId, name, calls: 0, reached: 0, talkSeconds: 0, dispositions: {}, evaluated: 0, scoreSum: 0, approved: 0, review: 0, rejected: 0, verkaufbar: 0, nachfassen: 0, nichtVerkaufbar: 0, lastCallAt: null });

/** Tag in deutscher Zeit als JJJJ-MM-TT. */
export const berlinDay = (value: Date | string | number) => new Date(value).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
/** So viele Minuten liegt die deutsche Zeit gerade vor der Weltzeit (60 im Winter, 120 im Sommer). */
export function berlinOffsetMinutes(now: Date = new Date()): number { const wall = (zone: string) => new Date(now.toLocaleString("en-US", { timeZone: zone })).getTime(); return Math.round((wall("Europe/Berlin") - wall("UTC")) / 60_000); }
const dayNumber = (day: string) => { const [y, m, d] = day.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86_400_000); };

/* ------------------------------------------------------------------ Stufen: was ein Agent insgesamt erreicht hat */
export const AGENT_LEVELS = [{ name: "Neuling", from: 0 }, { name: "Talent", from: 10 }, { name: "Profi", from: 25 }, { name: "Experte", from: 50 }, { name: "Meister", from: 100 }, { name: "Champion", from: 250 }, { name: "Legende", from: 500 }] as const;
export type AgentLevel = { index: number; name: string; from: number; /** nächste Stufe – null ganz oben */ next: { name: string; at: number; missing: number } | null; /** Weg zur nächsten Stufe, 0 bis 1 */ progress: number };
export function agentLevel(leadsAllTime: number): AgentLevel {
  const leads = Math.max(0, Math.floor(Number.isFinite(leadsAllTime) ? leadsAllTime : 0));
  let index = 0; for (let i = 0; i < AGENT_LEVELS.length; i += 1) if (leads >= AGENT_LEVELS[i].from) index = i;
  const level = AGENT_LEVELS[index]; const next = AGENT_LEVELS[index + 1] ?? null;
  return { index, name: level.name, from: level.from, next: next ? { name: next.name, at: next.from, missing: next.from - leads } : null, progress: next ? Math.min(1, (leads - level.from) / (next.from - level.from)) : 1 };
}

/* ------------------------------------------------------------------ Serie und bester Tag */
/**
 * Serie: so viele Arbeitstage in Folge mit mindestens einem Lead. Tage ohne Gespräche (frei, Wochenende) unterbrechen nicht;
 * der heutige Tag unterbricht erst, wenn er ohne Lead zu Ende ist. Liegt der letzte Arbeitstag mehr als eine Woche zurück, ist die Serie vorbei.
 */
export function streakOf(days: AgentDay[], today: string): number {
  const active = days.filter((item) => item.calls > 0 && item.day <= today).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  let index = active[0]?.day === today && active[0].approved === 0 ? 1 : 0; // heute läuft noch
  if (!active[index] || daysBetween(active[index].day, today) > 7) return 0;
  let streak = 0; for (; index < active.length; index += 1) { if (active[index].approved > 0) streak += 1; else break; }
  return streak;
}
/** Bester Tag im Zeitraum: die meisten Leads an einem Tag (bei Gleichstand der jüngere). */
export function bestDayOf(days: AgentDay[], fromDay: string | null, toDay: string | null = null): { day: string; approved: number } | null {
  let best: { day: string; approved: number } | null = null;
  for (const item of days) { if (item.approved <= 0 || (fromDay && item.day < fromDay) || (toDay && item.day > toDay)) continue; if (!best || item.approved > best.approved || (item.approved === best.approved && item.day > best.day)) best = { day: item.day, approved: item.approved }; }
  return best;
}

/* ------------------------------------------------------------------ Der Abschnitt davor (für Auf- und Abstieg) */
export type AgentSpan = { /** erster Tag */ fromDay: string; /** Tag danach (nicht mehr dabei) */ beforeDay: string };
/** Längere Zeiträume als ein Vierteljahr werden nicht mehr mit dem Abschnitt davor verglichen – und nichts, was länger als ein Jahr zurückliegt. */
export const COMPARE_MAX_DAYS = 92; const WINDOW_MAX_DAYS = 366; const WINDOW_MIN_DAYS = 62;
/** Der Abschnitt davor, soweit er ohne Daten feststeht (alles außer einem einzelnen Tag). */
function fixedPrevious(span: CallSpan, today: string): AgentSpan | null {
  if (!span.fromDay) return null;
  const end = span.toDay && span.toDay < today ? span.toDay : today; if (end < span.fromDay) return null; // reicht der Zeitraum in die Zukunft, zählt er bis heute
  if (span.kind === "woche") return { fromDay: shiftDay(span.fromDay, -7), beforeDay: shiftDay(end, -6) }; // letzte Woche bis zum selben Wochentag
  if (span.kind === "monat") { const first = monthStart(span.fromDay, -1); const last = shiftDay(span.fromDay, -1); const same = `${first.slice(0, 8)}${end.slice(8)}`; return { fromDay: first, beforeDay: shiftDay(same > last ? last : same, 1) }; } // letzter Monat bis zum selben Tag
  if (span.kind === "letzter_monat") return { fromDay: monthStart(span.fromDay, -1), beforeDay: span.fromDay };
  const length = daysBetween(span.fromDay, end) + 1; if (length > COMPARE_MAX_DAYS) return null;
  return { fromDay: shiftDay(span.fromDay, -length), beforeDay: span.fromDay }; // genauso viele Tage direkt davor
}
/**
 * Womit verglichen wird: bei einem einzelnen Tag (heute, gestern, ein eigener Tag) der letzte Tag mit Gesprächen davor (höchstens eine
 * Woche zurück – so zählt am Montag der Freitag); bei „Diese Woche“ die letzte Woche bis zum selben Wochentag, bei „Dieser Monat“ der
 * letzte Monat bis zum selben Tag, bei „Letzter Monat“ der Monat davor – sonst genauso viele Tage direkt davor.
 * Keinen Vergleich haben „Gesamt“, „vor …“ und Zeiträume über ein Vierteljahr.
 */
export function previousSpan(period: AgentReportPeriod | CallSpan, today: string, days: AgentDay[]): AgentSpan | null {
  const span = typeof period === "string" ? callPeriodSpan({ period }, today) : period; if (!span.fromDay) return null;
  let result: AgentSpan | null;
  if (isSingleDaySpan(span, today)) { let last: string | null = null; for (const item of days) if (item.calls > 0 && item.day < span.fromDay && (!last || item.day > last)) last = item.day; result = last && daysBetween(last, span.fromDay) <= 7 ? { fromDay: last, beforeDay: shiftDay(last, 1) } : null; }
  else result = fixedPrevious(span, today);
  return result && result.fromDay >= shiftDay(today, -(WINDOW_MAX_DAYS - 1)) ? result : null;
}
/**
 * Ab welchem Tag die Tageszeilen gebraucht werden: 62 Tage für Serie und „neu dabei“, dazu der Zeitraum selbst (bester Tag) und der
 * Abschnitt davor – höchstens ein Jahr. „Gesamt“ und „vor …“ schauen ein Jahr zurück.
 */
export function dayWindowStart(span: CallSpan, today: string): string {
  const limit = shiftDay(today, -(WINDOW_MAX_DAYS - 1)); if (!span.fromDay) return limit;
  const before = isSingleDaySpan(span, today) ? shiftDay(span.fromDay, -7) : fixedPrevious(span, today)?.fromDay ?? span.fromDay;
  const first = [shiftDay(today, -(WINDOW_MIN_DAYS - 1)), span.fromDay, before].sort()[0];
  return first < limit ? limit : first;
}
/** Tageszeilen eines Abschnitts je Agent zusammenzählen („Ohne Agent“ bleibt dabei – für die Summe). */
export function countFromDays(days: AgentDay[], span: AgentSpan): AgentCount[] {
  const map = new Map<string, AgentCount>();
  for (const item of days) { if (item.day < span.fromDay || item.day >= span.beforeDay) continue; const key = nameKey(item.name); const row = map.get(key) ?? { name: key ? item.name.trim() : NO_AGENT, calls: 0, approved: 0, evaluated: 0 }; row.calls += item.calls; row.approved += item.approved; row.evaluated += item.evaluated ?? 0; map.set(key, row); }
  return Array.from(map.values());
}
/** Doppelte Zeilen (derselbe Agent in anderer Schreibweise, derselbe Tag) zusammenlegen – sonst zählte ein Tag in der Serie zweimal. */
function mergeDays(days: AgentDay[]): AgentDay[] {
  const map = new Map<string, AgentDay>();
  for (const item of days) { const name = isNoAgent(item.name) ? NO_AGENT : item.name.trim(); const key = `${nameKey(name)}|${item.day}`; const row = map.get(key); if (row) { row.calls += item.calls; row.approved += item.approved; row.evaluated = (row.evaluated ?? 0) + (item.evaluated ?? 0); } else map.set(key, { name, day: item.day, calls: item.calls, approved: item.approved, evaluated: item.evaluated ?? 0 }); }
  return Array.from(map.values());
}

/* ------------------------------------------------------------------ Reihenfolge */
const share = (item: { approved: number; evaluated: number }) => (item.evaluated ? item.approved / item.evaluated : -1);
/** Wer steht oben? Meiste Leads, dann der höhere Grün-Anteil, Termine, Interessenten, Gespräche, Ø-Punkte – zuletzt der Name. „Ohne Agent“ steht immer unten. */
export function compareAgents(a: { name: string; userId?: number | null; approved: number; evaluated: number; calls: number; appointments?: number; interested?: number; averageScore?: number | null }, b: typeof a): number {
  const none = (item: typeof a) => ((item.userId ?? null) === null && isNoAgent(item.name) ? 1 : 0);
  return none(a) - none(b) || b.approved - a.approved || share(b) - share(a) || (b.appointments ?? 0) - (a.appointments ?? 0) || (b.interested ?? 0) - (a.interested ?? 0) || b.calls - a.calls || (b.averageScore ?? -1) - (a.averageScore ?? -1) || a.name.localeCompare(b.name, "de");
}

export type AgentRow = {
  userId: number | null; name: string; initials: string;
  calls: number; reached: number; reachRate: number | null; talkSeconds: number; averageTalkSeconds: number | null;
  appointments: number; interested: number; followUps: number; noInterest: number; notReached: number; wrongNumber: number; doNotCall: number; successRate: number | null;
  evaluated: number; averageScore: number | null; approved: number; review: number; rejected: number; verkaufbar: number; nachfassen: number; nichtVerkaufbar: number; lastCallAt: Date | string | null;
  /** Platz im Zeitraum (1 = oben); null für „Ohne Agent“ */ rank: number | null;
  /** Platz im Abschnitt davor – null, wenn der Agent dort keine Gespräche hatte oder es keinen Vergleich gibt („Gesamt“) */ previousRank: number | null;
  /** Plätze gutgemacht (+) oder verloren (−) gegenüber dem Abschnitt davor */ rankChange: number | null;
  /** neu dabei: vor dem Zeitraum gab es (im betrachteten Fenster) noch kein Gespräch */ isNew: boolean;
  /** Anteil grüner an den bewerteten Gesprächen (0–100) */ greenRate: number | null;
  /** Leads heute – unabhängig vom gewählten Zeitraum */ approvedToday: number;
  /** Arbeitstage in Folge mit mindestens einem Lead */ streak: number;
  /** die meisten Leads an einem Tag im Zeitraum */ bestDay: { day: string; approved: number } | null;
  /** Leads insgesamt – daraus die Stufe */ approvedAllTime: number; level: AgentLevel;
  /** Abstand zum Platz davor: so viele Leads fehlen (0 = gleich viele, der Grün-Anteil entscheidet) */ gap: { rank: number; name: string; missing: number } | null;
};
export type AgentAwardKey = "quote" | "serie" | "tag" | "aufsteiger" | "gespraeche" | "telefon" | "termine";
/** Bestwert im Zeitraum: wer, wie viel – und je nach Art eine Zusatzangabe (bewertete Gespräche, Tag, alter Platz …). */
export type AgentAward = { key: AgentAwardKey; name: string; userId: number | null; value: number; extra: number | string | null };
export type AgentTotals = { agents: number; calls: number; reached: number; reachRate: number | null; talkSeconds: number; appointments: number; interested: number; successRate: number | null; evaluated: number; approved: number; review: number; rejected: number; averageScore: number | null; /** Leads und Gespräche heute – unabhängig vom Zeitraum */ approvedToday: number; callsToday: number; /** Leads im Zeitraum davor – null bei „Gesamt“ */ approvedBefore: number | null };

const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : null);
const initialsOf = (name: string) => name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
/** Mindestens so viele bewertete Gespräche braucht es für den Bestwert „Beste Quote“ – sonst gewinnt, wer ein einziges grünes Gespräch hat. */
export const QUOTE_MIN_CALLS = 5;

/**
 * Aus den Bausteinen die fertige Bestenliste: Reihenfolge und Plätze, Auf- und Abstieg gegenüber dem Zeitraum davor, Serie,
 * bester Tag, Stufe, Abstand zum Platz davor – dazu die Summen und die Bestwerte.
 */
export function finishAgentReport(input: { buckets: AgentBucket[]; /** je Agent und Tag – reicht weiter zurück als der Zeitraum (für Serie und den Abschnitt davor) */ days: AgentDay[]; allTime: Array<{ name: string; approved: number }>; /** Abschnitt, mit dem verglichen wird – null bei „Gesamt“ */ previous: AgentSpan | null; today: string; fromDay: string | null; /** letzter Tag des Zeitraums – null, wenn er noch läuft */ toDay?: string | null }): { agents: AgentRow[]; totals: AgentTotals; awards: AgentAward[] } {
  const allDays = mergeDays(input.days);
  // Zuordnung über den Schlüssel des Namens: Die Datenbank liefert je Abfrage eine der Schreibweisen – sie müssen trotzdem zusammenfinden
  const daysBy = new Map<string, AgentDay[]>(); for (const item of allDays) { const key = nameKey(item.name); if (!key) continue; const list = daysBy.get(key); if (list) list.push(item); else daysBy.set(key, [item]); }
  const allTime = new Map<string, number>(); for (const item of input.allTime) { const key = nameKey(item.name); if (!key) continue; allTime.set(key, (allTime.get(key) ?? 0) + (Number(item.approved) || 0)); }
  // Plätze im Abschnitt davor – nach derselben Regel
  const previousRows = input.previous ? countFromDays(allDays, input.previous) : null;
  const before = previousRows ? previousRows.filter((item) => !isNoAgent(item.name) && item.calls > 0).sort((a, b) => compareAgents(a, b)) : null;
  const beforeRank = new Map((before ?? []).map((item, index) => [nameKey(item.name), index + 1]));
  const sorted = input.buckets.map((bucket) => {
    const appointments = bucket.dispositions.verkauft ?? 0; const interested = bucket.dispositions.interessiert ?? 0;
    return { bucket, appointments, interested, averageScore: bucket.evaluated ? Math.round(bucket.scoreSum / bucket.evaluated) : null };
  }).sort((a, b) => compareAgents({ ...a.bucket, appointments: a.appointments, interested: a.interested, averageScore: a.averageScore }, { ...b.bucket, appointments: b.appointments, interested: b.interested, averageScore: b.averageScore }));
  let place = 0; const ranked: AgentRow[] = [];
  for (const { bucket, appointments, interested, averageScore } of sorted) {
    const none = bucket.userId === null && isNoAgent(bucket.name); const key = nameKey(bucket.name); const days = none ? [] : daysBy.get(key) ?? [];
    const rank = none ? null : (place += 1); const previousRank = none || !before ? null : beforeRank.get(key) ?? null;
    const leadsAllTime = none ? 0 : Math.max(allTime.get(key) ?? 0, bucket.approved);
    const ahead = rank && rank > 1 ? ranked[ranked.length - 1] : null;
    ranked.push({
      userId: bucket.userId, name: bucket.name, initials: initialsOf(bucket.name),
      calls: bucket.calls, reached: bucket.reached, reachRate: pct(bucket.reached, bucket.calls), talkSeconds: bucket.talkSeconds, averageTalkSeconds: bucket.reached ? Math.round(bucket.talkSeconds / bucket.reached) : null,
      appointments, interested, followUps: bucket.dispositions.wiedervorlage ?? 0, noInterest: bucket.dispositions.kein_interesse ?? 0, notReached: bucket.dispositions.nicht_erreicht ?? 0, wrongNumber: bucket.dispositions.falsche_nummer ?? 0, doNotCall: bucket.dispositions.nicht_anrufen ?? 0,
      successRate: pct(appointments + interested, bucket.reached), evaluated: bucket.evaluated, averageScore,
      approved: bucket.approved, review: bucket.review, rejected: bucket.rejected, verkaufbar: bucket.verkaufbar, nachfassen: bucket.nachfassen, nichtVerkaufbar: bucket.nichtVerkaufbar, lastCallAt: bucket.lastCallAt,
      rank, previousRank, rankChange: rank && previousRank ? previousRank - rank : null, isNew: Boolean(rank && input.fromDay && !days.some((item) => item.day < input.fromDay! && item.calls > 0)),
      greenRate: pct(bucket.approved, bucket.evaluated), approvedToday: days.find((item) => item.day === input.today)?.approved ?? 0, streak: none ? 0 : streakOf(days, input.today), bestDay: none ? null : bestDayOf(days, input.fromDay, input.toDay ?? null),
      approvedAllTime: leadsAllTime, level: agentLevel(leadsAllTime),
      gap: ahead && rank ? { rank: rank - 1, name: ahead.name, missing: Math.max(0, ahead.approved - bucket.approved) } : null,
    });
  }
  const sum = (key: "calls" | "reached" | "talkSeconds" | "appointments" | "interested" | "evaluated" | "approved" | "rejected" | "review" | "approvedToday") => ranked.reduce((total, agent) => total + agent[key], 0);
  const scored = ranked.filter((agent) => agent.averageScore !== null);
  const todayRows = allDays.filter((item) => item.day === input.today);
  const totals: AgentTotals = {
    agents: ranked.length, calls: sum("calls"), reached: sum("reached"), reachRate: pct(sum("reached"), sum("calls")), talkSeconds: sum("talkSeconds"), appointments: sum("appointments"), interested: sum("interested"), successRate: pct(sum("appointments") + sum("interested"), sum("reached")),
    evaluated: sum("evaluated"), approved: sum("approved"), review: sum("review"), rejected: sum("rejected"), averageScore: scored.length ? Math.round(scored.reduce((total, agent) => total + (agent.averageScore ?? 0) * agent.evaluated, 0) / Math.max(1, sum("evaluated"))) : null,
    approvedToday: todayRows.reduce((total, item) => total + item.approved, 0), callsToday: todayRows.reduce((total, item) => total + item.calls, 0), approvedBefore: previousRows ? previousRows.reduce((total, item) => total + item.approved, 0) : null,
  };
  // Bestwerte – nur echte Agenten; jeder Bestwert braucht eine Mindestleistung, sonst gibt es ihn nicht
  const real = ranked.filter((agent) => agent.rank !== null); const awards: AgentAward[] = [];
  const top = <T,>(list: T[], value: (item: T) => number, tie: (item: T) => number = () => 0) => list.reduce<T | null>((best, item) => (!best || value(item) > value(best) || (value(item) === value(best) && tie(item) > tie(best)) ? item : best), null);
  const award = (key: AgentAwardKey, agent: AgentRow | null, value: number, extra: number | string | null) => { if (agent) awards.push({ key, name: agent.name, userId: agent.userId, value, extra }); };
  const quote = top(real.filter((agent) => agent.evaluated >= QUOTE_MIN_CALLS && agent.approved > 0), (agent) => agent.approved / agent.evaluated, (agent) => agent.evaluated); award("quote", quote, quote?.greenRate ?? 0, quote?.evaluated ?? null);
  const serie = top(real.filter((agent) => agent.streak >= 2), (agent) => agent.streak, (agent) => agent.approved); award("serie", serie, serie?.streak ?? 0, null);
  const day = top(real.filter((agent) => (agent.bestDay?.approved ?? 0) >= 2), (agent) => agent.bestDay!.approved, (agent) => dayNumber(agent.bestDay!.day)); award("tag", day, day?.bestDay?.approved ?? 0, day?.bestDay?.day ?? null);
  const climber = top(real.filter((agent) => (agent.rankChange ?? 0) >= 1), (agent) => agent.rankChange!, (agent) => agent.approved); award("aufsteiger", climber, climber?.rankChange ?? 0, climber?.previousRank ?? null);
  const busy = top(real.filter((agent) => agent.calls > 0), (agent) => agent.calls, (agent) => agent.approved); award("gespraeche", busy, busy?.calls ?? 0, null);
  const talker = top(real.filter((agent) => agent.talkSeconds > 0), (agent) => agent.talkSeconds, (agent) => agent.approved); award("telefon", talker, talker?.talkSeconds ?? 0, null);
  const dates = top(real.filter((agent) => agent.appointments > 0), (agent) => agent.appointments, (agent) => agent.approved); award("termine", dates, dates?.appointments ?? 0, null);
  return { agents: ranked, totals, awards };
}

/* ------------------------------------------------------------------ Bausteine aus einzelnen Gesprächen (Vorschau; der Server zählt in der Datenbank) */
export type AgentCallFact = { name: string | null; at: Date | string | null; approved: boolean; evaluated: boolean };
/** Gespräche je Agent und Tag zählen („Ohne Agent“ bleibt als eigene Zeile – für die Summen). */
export function countAgentDays(facts: AgentCallFact[]): AgentDay[] {
  const map = new Map<string, AgentDay>();
  for (const fact of facts) { if (!fact.at) continue; const name = isNoAgent(fact.name) ? NO_AGENT : fact.name!.trim(); const day = berlinDay(fact.at); const key = `${nameKey(name)}|${day}`; const row = map.get(key) ?? { name, day, calls: 0, approved: 0, evaluated: 0 }; row.calls += 1; if (fact.approved) row.approved += 1; if (fact.evaluated) row.evaluated = (row.evaluated ?? 0) + 1; map.set(key, row); }
  return Array.from(map.values());
}
/** Gespräche je Agent zählen (für „insgesamt“). */
export function countAgents(facts: AgentCallFact[]): AgentCount[] {
  const map = new Map<string, AgentCount>();
  for (const fact of facts) { const key = nameKey(fact.name); if (!key) continue; const row = map.get(key) ?? { name: fact.name!.trim(), calls: 0, approved: 0, evaluated: 0 }; row.calls += 1; if (fact.approved) row.approved += 1; if (fact.evaluated) row.evaluated += 1; map.set(key, row); }
  return Array.from(map.values());
}

/* ------------------------------------------------------------------ Von Hand gelöschte Agenten */
/** Ein Agent, der von Hand aus der Bestenliste genommen wurde – seine Gespräche bleiben erhalten, er lässt sich zurückholen. */
export type HiddenAgent = { name: string; /** wann gelöscht (ISO) */ at: string; /** von wem */ by: string | null };
/** Was ein gelöschter Agent im Zeitraum hatte – für den Hinweis unter der Rangliste. */
export type HiddenAgentRow = HiddenAgent & { calls: number; approved: number };
export const HIDDEN_AGENT_LIMIT = 500;
/** Gespeicherte Liste lesen (beliebiges JSON): kaputte Einträge fallen weg, jeder Name steht nur einmal da. */
export function readHiddenAgents(value: unknown): HiddenAgent[] {
  if (!Array.isArray(value)) return []; const seen = new Set<string>(); const list: HiddenAgent[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue; const raw = item as Record<string, unknown>; const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 160) : ""; const key = nameKey(name);
    if (!key || seen.has(key)) continue; seen.add(key);
    list.push({ name, at: typeof raw.at === "string" && !Number.isNaN(new Date(raw.at).getTime()) ? raw.at : new Date(0).toISOString(), by: typeof raw.by === "string" && raw.by.trim() ? raw.by.trim().slice(0, 160) : null });
  }
  return list.slice(0, HIDDEN_AGENT_LIMIT);
}
/** Schlüssel aller gelöschten Namen – „José“ und „JOSE“ sind derselbe Agent. */
export const hiddenAgentKeys = (list: HiddenAgent[]) => new Set(list.map((item) => nameKey(item.name)).filter(Boolean));
/** Agent auf die Liste setzen (steht er schon dort, bleibt der erste Eintrag). „Ohne Agent“ ist kein Agent. */
export function hideAgentIn(list: HiddenAgent[], name: string, by: string | null, now: Date = new Date()): HiddenAgent[] {
  const clean = name.trim().slice(0, 160); const key = nameKey(clean); if (!key || hiddenAgentKeys(list).has(key)) return list;
  return [...list, { name: clean, at: now.toISOString(), by: by?.trim() || null }].slice(-HIDDEN_AGENT_LIMIT);
}
/** Agent wieder von der Liste nehmen. */
export const restoreAgentIn = (list: HiddenAgent[], name: string): HiddenAgent[] => { const key = nameKey(name); return key ? list.filter((item) => nameKey(item.name) !== key) : list; };
/**
 * Gelöschte Agenten aus den Bausteinen der Bestenliste nehmen – überall gleich (Zahlen im Zeitraum, Tageszeilen, insgesamt, zuletzt
 * erreichte Leads). Zurück kommt, was übrig bleibt, und je gelöschtem Agenten, was er im Zeitraum hatte.
 */
export function withoutHiddenAgents<D extends { name: string }, A extends { name: string }, W extends { name: string | null }>(input: { hidden: HiddenAgent[]; buckets: AgentBucket[]; days: D[]; allTime: A[]; wins: W[] }): { buckets: AgentBucket[]; days: D[]; allTime: A[]; wins: W[]; hiddenAgents: HiddenAgentRow[] } {
  const keys = hiddenAgentKeys(input.hidden); if (!keys.size) return { buckets: input.buckets, days: input.days, allTime: input.allTime, wins: input.wins, hiddenAgents: [] };
  const gone = (name: string | null | undefined) => keys.has(nameKey(name)); const counts = new Map<string, { calls: number; approved: number }>();
  for (const bucket of input.buckets) { if (!gone(bucket.name)) continue; const key = nameKey(bucket.name); const row = counts.get(key) ?? { calls: 0, approved: 0 }; row.calls += bucket.calls; row.approved += bucket.approved; counts.set(key, row); }
  return {
    buckets: input.buckets.filter((bucket) => !gone(bucket.name)), days: input.days.filter((item) => !gone(item.name)), allTime: input.allTime.filter((item) => !gone(item.name)), wins: input.wins.filter((item) => !gone(item.name)),
    hiddenAgents: input.hidden.map((item) => ({ ...item, calls: counts.get(nameKey(item.name))?.calls ?? 0, approved: counts.get(nameKey(item.name))?.approved ?? 0 })).sort((a, b) => a.name.localeCompare(b.name, "de")),
  };
}
