/**
 * KI-Verbrauch und Tagesbudget.
 * Jede KI-Anfrage zählt mit (Zweck, Tokens, Kosten) – je Tag in deutscher Zeit, gespeichert in aiUsageDays.
 * Das Tagesbudget (mailSettings.aiDailyBudgetCents, Standard 10 €) gilt für die KI im Hintergrund: Vorschreiben, Kategorie-Nachprüfung,
 * Ansatz-Umstellung und das Schreiben im Versandlauf. Was du selbst anklickst (Entwurf schreiben, zweite Fassung), geht immer.
 * Preise (Anthropic, USD je 1 Mio. Tokens, umgerechnet mit 0,92 €/$): Sonnet 3 / 15 (Cache lesen 0,30, Cache schreiben 3,75), Haiku 1 / 5 (0,10 / 1,25).
 */
import { and, eq, sql } from "drizzle-orm";
import { aiUsageDays, mailSettings } from "../drizzle/schema";
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
const PURPOSE_LABEL: Record<string, string> = { vorschlaege: "E-Mail-Entwürfe", kategoriepruefung: "Kategorie-Prüfung", webseite: "Webseiten lesen", sonstiges: "Sonstiges (Hilfe, Auswertungen)" };
/** KI heute: Kosten, Budget und Aufteilung nach Zweck – für die Anzeige. */
export async function aiUsageToday(db: Db, tenantId: number) {
  const day = dayKey(); const rows = await db.select().from(aiUsageDays).where(and(eq(aiUsageDays.day, day)));
  const spentCents = Math.round(rows.reduce((sum, row) => sum + row.costMilliCents, 0) / 1000);
  const budgetCents = await aiBudgetCents(db, tenantId);
  const parts = rows.map((row) => ({ purpose: row.purpose, label: PURPOSE_LABEL[row.purpose] ?? row.purpose, calls: row.calls, cents: Math.round(row.costMilliCents / 1000) })).sort((a, b) => b.cents - a.cents);
  return { day, spentCents, budgetCents, reached: spentCents >= budgetCents, calls: rows.reduce((sum, row) => sum + row.calls, 0), parts };
}
