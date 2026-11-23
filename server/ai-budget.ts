/**
 * KI-Verbrauch und Tagesbudget.
 * Jede KI-Anfrage zählt mit (Zweck, Tokens, Kosten) – je Tag in deutscher Zeit, gespeichert in aiUsageDays.
 * Das Tagesbudget (mailSettings.aiDailyBudgetCents, Standard 10 €) gilt für die KI im Hintergrund: Vorschreiben, Kategorie-Nachprüfung,
 * Ansatz-Umstellung und das Schreiben im Versandlauf. Was du selbst anklickst (Entwurf schreiben, zweite Fassung), geht immer.
 * Das Mitschreiben der Gespräche (Abschrift) zählt nach Minuten mit: OpenAI Whisper 0,006 $/Min, Deepgram Nova-2 0,0043 $/Min.
 * Gespräche haben eine eigene Obergrenze je Tag (callQaConfigs.aiDailyCapCents, 0 = keine): Ist sie erreicht, warten neue Gespräche.
 * Preise (Anthropic, USD je 1 Mio. Tokens, umgerechnet mit 0,92 €/$): Sonnet 3 / 15 (Cache lesen 0,30, Cache schreiben 3,75), Haiku 1 / 5 (0,10 / 1,25).
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { aiUsageHistory as buildAiUsageHistory, purposeInfo } from "../shared/ai-usage";
import { aiUsageDays, callQaConfigs, mailSettings } from "../drizzle/schema";
import type { Db } from "./lead-pipeline";

export const DEFAULT_AI_BUDGET_CENTS = 1000;
const EUR_PER_USD = 0.92;
const dayKey = (now = new Date()) => now.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }); // JJJJ-MM-TT

export type UsageNote = { model: string; purpose: string; input: number; output: number; cacheRead: number; cacheWrite: number };
/** Kosten einer Anfrage in Tausendstel-Cent. */
export function costMilliCents(note: UsageNote): number {
  const haiku = /haiku/i.test(note.model);
  const [inp, out, read, write] = haiku ? [1, 5, 0.1, 1.25] : [3, 15, 0.3, 3.75]; // USD je 1 Mio. Tokens
  const usd = (note.input * inp + note.output * out + note.cacheRead * read + note.cacheWrite * write) / 1_000_000;
  return Math.round(usd * EUR_PER_USD * 100 * 1000);
}

let spentCache: { day: string; at: number; cents: number } | null = null;
/** Anfrage verbuchen (läuft nebenbei – ein Fehler hier hält die KI nie auf). */
export async function recordAiUsage(db: Db, note: UsageNote) {
  const cost = costMilliCents(note); const day = dayKey();
  await db.insert(aiUsageDays).values({ day, purpose: note.purpose.slice(0, 40), calls: 1, inputTokens: note.input + note.cacheWrite, outputTokens: note.output, cachedTokens: note.cacheRead, costMilliCents: cost })
    .onDuplicateKeyUpdate({ set: { calls: sql`${aiUsageDays.calls} + 1`, inputTokens: sql`${aiUsageDays.inputTokens} + ${note.input + note.cacheWrite}`, outputTokens: sql`${aiUsageDays.outputTokens} + ${note.output}`, cachedTokens: sql`${aiUsageDays.cachedTokens} + ${note.cacheRead}`, costMilliCents: sql`${aiUsageDays.costMilliCents} + ${cost}` } });
  if (spentCache && spentCache.day === day) spentCache = { ...spentCache, cents: spentCache.cents + cost / 1000 };
}

/** Preis fürs Mitschreiben einer Aufnahme (USD je Minute) – je Dienst. */
export const TRANSCRIPTION_USD_PER_MINUTE: Record<string, number> = { openai: 0.006, deepgram: 0.0043 };
/** Kosten einer Abschrift in Tausendstel-Cent. */
export function transcriptionMilliCents(service: string, seconds: number): number {
  const rate = TRANSCRIPTION_USD_PER_MINUTE[service] ?? 0; const minutes = Math.max(0, Number(seconds) || 0) / 60;
  return Math.round(minutes * rate * EUR_PER_USD * 100 * 1000);
}
/** Abschrift verbuchen (Zweck „abschrift“, Bereich Gespräche). Ohne bekannte Dauer zählt nur die Anfrage. */
export async function recordTranscriptionUsage(db: Db, note: { service: string; seconds: number | null | undefined }) {
  const cost = transcriptionMilliCents(note.service, note.seconds ?? 0); const day = dayKey();
  await db.insert(aiUsageDays).values({ day, purpose: "abschrift", calls: 1, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costMilliCents: cost })
    .onDuplicateKeyUpdate({ set: { calls: sql`${aiUsageDays.calls} + 1`, costMilliCents: sql`${aiUsageDays.costMilliCents} + ${cost}` } });
  if (spentCache && spentCache.day === day) spentCache = { ...spentCache, cents: spentCache.cents + cost / 1000 };
}
/** Was die Gespräche heute gekostet haben: Abschrift, Bewertung, Zahl der bewerteten Gespräche (immer frisch gelesen – daran hängt die Obergrenze). */
export async function callAiSpentToday(db: Db): Promise<{ cents: number; transcriptCents: number; ratingCents: number; evaluated: number; transcribed: number }> {
  const rows = await db.select({ purpose: aiUsageDays.purpose, calls: aiUsageDays.calls, cost: aiUsageDays.costMilliCents }).from(aiUsageDays).where(eq(aiUsageDays.day, dayKey()));
  let transcript = 0; let rating = 0; let evaluated = 0; let transcribed = 0;
  for (const row of rows) { if (purposeInfo(row.purpose).area !== "gespraeche") continue; if (row.purpose === "abschrift") { transcript += row.cost; transcribed += row.calls; } else { rating += row.cost; if (row.purpose === "gespraechsbewertung") evaluated += row.calls; } }
  return { cents: (transcript + rating) / 1000, transcriptCents: transcript / 1000, ratingCents: rating / 1000, evaluated, transcribed };
}
/** Ist die Obergrenze der Gespräche für heute erreicht? (0 = keine Grenze) */
export async function callAiCapReached(db: Db, capCents: number | null | undefined): Promise<boolean> {
  if (!capCents || capCents <= 0) return false;
  return (await callAiSpentToday(db)).cents >= capCents;
}

/** Zwischenspeicher der Kosten verwerfen (z. B. nach dem Ändern des Budgets oder in Tests). */
export const forgetSpentCache = () => { spentCache = null; };
/** KI-Kosten heute in Cent (alle Zwecke). */
export async function aiSpentTodayCents(db: Db): Promise<number> {
  const day = dayKey(); if (spentCache && spentCache.day === day && Date.now() - spentCache.at < 30_000) return spentCache.cents;
  const rows = await db.select({ cost: aiUsageDays.costMilliCents }).from(aiUsageDays).where(eq(aiUsageDays.day, day));
  const cents = rows.reduce((sum, row) => sum + row.cost, 0) / 1000; spentCache = { day, at: Date.now(), cents };
  return cents;
}
export async function aiBudgetCents(db: Db, tenantId: number): Promise<number> {
  const row = (await db.select({ budget: mailSettings.aiDailyBudgetCents }).from(mailSettings).where(eq(mailSettings.tenantId, tenantId)).limit(1))[0];
  return row?.budget && row.budget > 0 ? row.budget : DEFAULT_AI_BUDGET_CENTS;
}
/** Darf die KI im Hintergrund heute noch arbeiten? (Budget nicht erreicht) */
export async function backgroundAiAllowed(db: Db, tenantId: number): Promise<boolean> {
  return (await aiSpentTodayCents(db).catch(() => 0)) < (await aiBudgetCents(db, tenantId).catch(() => DEFAULT_AI_BUDGET_CENTS));
}
export async function setAiDailyBudget(db: Db, tenantId: number, euros: number) {
  const cents = Math.max(100, Math.min(100_000, Math.round(euros * 100)));
  const existing = (await db.select({ id: mailSettings.id }).from(mailSettings).where(eq(mailSettings.tenantId, tenantId)).limit(1))[0];
  if (existing) await db.update(mailSettings).set({ aiDailyBudgetCents: cents }).where(eq(mailSettings.id, existing.id));
  else await db.insert(mailSettings).values({ tenantId, aiDailyBudgetCents: cents });
  forgetSpentCache();
  return { budgetCents: cents };
}
/** KI heute: Kosten, Budget und Aufteilung nach Zweck – für die Anzeige. */
export async function aiUsageToday(db: Db, tenantId: number) {
  const day = dayKey(); const rows = await db.select().from(aiUsageDays).where(and(eq(aiUsageDays.day, day)));
  const spentCents = Math.round(rows.reduce((sum, row) => sum + row.costMilliCents, 0) / 1000);
  const budgetCents = await aiBudgetCents(db, tenantId);
  const parts = rows.map((row) => ({ purpose: row.purpose, label: purposeInfo(row.purpose).label, calls: row.calls, cents: Math.round(row.costMilliCents / 1000) })).sort((a, b) => b.cents - a.cents);
  return { day, spentCents, budgetCents, reached: spentCents >= budgetCents, calls: rows.reduce((sum, row) => sum + row.calls, 0), parts };
}

/** KI-Verbrauch der letzten Tage: je Tag die Kosten, aufgeteilt nach Bereich und Zweck – dazu das Tagesbudget. */
export async function aiUsageHistory(db: Db, tenantId: number, count = 30) {
  const today = dayKey(); const span = Math.max(1, Math.min(92, Math.round(count)));
  const from = new Date(`${today}T12:00:00Z`); from.setUTCDate(from.getUTCDate() - (span - 1)); const first = from.toISOString().slice(0, 10);
  const rows = await db.select({ day: aiUsageDays.day, purpose: aiUsageDays.purpose, calls: aiUsageDays.calls, costMilliCents: aiUsageDays.costMilliCents }).from(aiUsageDays).where(gte(aiUsageDays.day, first));
  const history = buildAiUsageHistory(rows, today, span); const budgetCents = await aiBudgetCents(db, tenantId);
  const callCapCents = (await db.select({ cap: callQaConfigs.aiDailyCapCents }).from(callQaConfigs).where(eq(callQaConfigs.tenantId, tenantId)).limit(1))[0]?.cap ?? 0;
  return { ...history, budgetCents, callCapCents, todayCents: history.days[history.days.length - 1]?.cents ?? 0 };
}
