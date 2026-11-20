/**
 * Alias-Namen der Agenten (Server): lernen, anwenden, von Hand pflegen.
 * Die Rechnung steht in shared/agent-alias.ts; hier wird sie mit der Datenbank verbunden:
 *  1. Bei Gesprächen mit echtem Namen vom Dialer wird der Name der Vorstellung im Gespräch gemerkt (callRecords.agentAlias).
 *  2. Aus diesen Paaren entsteht die Zuordnung Alias → echter Name (callQaConfigs.agentAliases), von Hand Eingetragenes gilt vor.
 *  3. Alle Gespräche, die noch unter einem Alias laufen, bekommen den echten Namen – rückwirkend. Der Alias bleibt am Gespräch stehen
 *     („am Telefon: …“). Auch der Verlauf der Leads („· Agent: …“) wird umgeschrieben.
 */
import { and, desc, eq, gte, inArray, isNull, like, ne, or, sql } from "drizzle-orm";
import { callQaConfigs, callRecords, leadStatusEvents } from "../drizzle/schema";
import { aliasKey, aliasProblem, learnAliases, mergeAliases, readAliases, resolveAlias, sameSpelling, tidyAgentName, type AgentAlias, type AliasPair } from "../shared/agent-alias";
import { cleanAgentName, detectAgent, isJunkAgentName } from "../shared/agent-names";
import type { Db } from "./lead-pipeline";

/** Quellen, bei denen der Name feststeht und nie „verbessert“ wird: von Hand, vom Dialer, über einen Alias zugeordnet. */
export const FIXED_AGENT_SOURCES = ["manuell", "dialer", "alias"];
const configOf = async (db: Db, tenantId: number) => (await db.select({ id: callQaConfigs.id, agentAliases: callQaConfigs.agentAliases }).from(callQaConfigs).where(eq(callQaConfigs.tenantId, tenantId)).limit(1))[0];
export async function agentAliases(db: Db, tenantId: number): Promise<AgentAlias[]> { return readAliases((await configOf(db, tenantId))?.agentAliases); }
const saveAliases = async (db: Db, tenantId: number, list: AgentAlias[]) => { const config = await configOf(db, tenantId); if (config) await db.update(callQaConfigs).set({ agentAliases: list }).where(eq(callQaConfigs.id, config.id)); };

/**
 * Name der Vorstellung zu einem Gespräch mit echtem Namen vom Dialer merken: die eindeutige Vorstellung aus dem Gespräch, sonst der Name,
 * den die KI als Mitarbeiter erkannt hat. Weicht er vom echten Namen ab, steht er als Alias am Gespräch; sonst ist das Gespräch „geprüft“ (leer).
 */
export function spokenAliasFor(realName: string | null | undefined, transcript: string | null | undefined, aiName?: string | null): string {
  const real = tidyAgentName(realName); if (!real) return "";
  const formula = transcript ? detectAgent(transcript, []) : null; const candidate = formula?.sure ? formula.name : cleanAgentName(String(aiName ?? "")) ?? ""; // eine unsichere Fundstelle zählt nicht – sonst würde der Name eines Kunden zum Alias
  const spoken = tidyAgentName(candidate); if (!spoken || isJunkAgentName(spoken) || spoken.split(" ").length < 2 || sameSpelling(real, spoken)) return "";
  return spoken;
}

const checking = new Map<number, number>(); let running = false;
/**
 * Gespräche mit Namen vom Dialer, bei denen der Name der Vorstellung noch nicht geprüft ist: ein paar pro Lauf nachholen.
 * Erst die Formel („hier ist …“), sonst fragt die KI (nur der Gesprächsanfang – billig). Ohne KI bleibt es bei der Formel.
 */
export async function backfillSpokenNames(db: Db, options: { tenantId?: number; max?: number; ask?: (transcript: string) => Promise<string | null> } = {}): Promise<{ checked: number; found: number }> {
  const since = new Date(Date.now() - 90 * 24 * 3_600_000);
  const rows = await db.select({ id: callRecords.id, agentName: callRecords.agentName, transcript: callRecords.transcript }).from(callRecords).where(and(eq(callRecords.agentSource, "dialer"), isNull(callRecords.agentAlias), gte(callRecords.createdAt, since), inArray(callRecords.status, ["bewertet", "transkribiert"] as const), ...(options.tenantId ? [eq(callRecords.tenantId, options.tenantId)] : []))).orderBy(desc(callRecords.id)).limit(300);
  const todo = rows.filter((row) => row.transcript && (checking.get(row.id) ?? 0) < 2).slice(0, options.max ?? 12); let found = 0;
  const ask = options.ask ?? (async (transcript: string) => { const { askAgentName } = await import("./call-qa"); return askAgentName(transcript); });
  for (const row of todo) {
    checking.set(row.id, (checking.get(row.id) ?? 0) + 1);
    try {
      const formula = detectAgent(row.transcript!, []); let alias: string;
      if (formula?.sure) alias = spokenAliasFor(row.agentName, row.transcript, null); // eindeutige Vorstellung („hier ist …“)
      else { const fromAi = await ask(row.transcript!).catch(() => null); if (fromAi === null) continue; alias = spokenAliasFor(row.agentName, null, fromAi); } // keine KI erreichbar: später noch einmal
      await db.update(callRecords).set({ agentAlias: alias }).where(eq(callRecords.id, row.id)); if (alias) found += 1;
    } catch (error) { console.error("[Gespräche] Alias-Name prüfen:", row.id, error instanceof Error ? error.message : error); }
  }
  return { checked: todo.length, found };
}

/** Paare (echter Name laut Dialer, Name der Vorstellung) aus den Gesprächen – und die Namen, unter denen ältere Gespräche laufen. */
async function evidence(db: Db, tenantId: number) {
  const pairRows = await db.select({ name: callRecords.agentName, alias: callRecords.agentAlias, calls: sql<number>`count(*)` }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.agentSource, "dialer"), sql`${callRecords.agentAlias} is not null and ${callRecords.agentAlias} <> ''`)).groupBy(callRecords.agentName, callRecords.agentAlias);
  const pairs: AliasPair[] = pairRows.filter((row) => row.name && row.alias).map((row) => ({ name: row.name!, alias: row.alias!, calls: Number(row.calls) }));
  const nameRows = await db.select({ name: callRecords.agentName, source: callRecords.agentSource, calls: sql<number>`count(*)` }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), sql`${callRecords.agentName} is not null and ${callRecords.agentName} <> ''`)).groupBy(callRecords.agentName, callRecords.agentSource);
  const real = Array.from(new Set(nameRows.filter((row) => row.source === "dialer").map((row) => row.name!)));
  const spoken = Array.from(new Set(nameRows.filter((row) => row.source !== "dialer" && row.source !== "alias").map((row) => row.name!)));
  return { pairs, real, spoken, names: nameRows.map((row) => ({ name: row.name!, source: row.source, calls: Number(row.calls) })) };
}

/**
 * Zuordnung anwenden: Gespräche, die unter einem Alias laufen (nicht vom Dialer benannt), bekommen den echten Namen. Der bisherige Name
 * bleibt als Alias am Gespräch. Dazu der Verlauf der Leads. Liefert die Zahl der umgeschriebenen Gespräche.
 */
export async function applyAgentAliases(db: Db, tenantId: number, aliases?: AgentAlias[]): Promise<number> {
  const list = (aliases ?? await agentAliases(db, tenantId)).filter((item) => item.name); if (!list.length) return 0;
  const names = await db.selectDistinct({ name: callRecords.agentName }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), sql`${callRecords.agentName} is not null and ${callRecords.agentName} <> ''`, or(isNull(callRecords.agentSource), ne(callRecords.agentSource, "dialer"))));
  let changed = 0;
  for (const row of names) {
    const current = row.name!; const real = resolveAlias(current, list); if (!real || aliasKey(real) === aliasKey(current)) continue;
    const result = await db.update(callRecords).set({ agentName: real, agentAlias: current, agentSource: sql`case when ${callRecords.agentSource} = 'manuell' then 'manuell' else 'alias' end` }).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.agentName, current), or(isNull(callRecords.agentSource), ne(callRecords.agentSource, "dialer"))));
    changed += Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
    await renameInLeadHistory(db, tenantId, current, real);
  }
  return changed;
}
/** Im Verlauf der Leads steht „· Agent: <Name>“ – dort den Alias durch den echten Namen ersetzen (nur der ganze Name, nicht ein Teil davon). */
async function renameInLeadHistory(db: Db, tenantId: number, from: string, to: string) {
  const marker = `· Agent: ${from}`; const rows = await db.select({ id: leadStatusEvents.id, note: leadStatusEvents.note }).from(leadStatusEvents).where(and(eq(leadStatusEvents.tenantId, tenantId), like(leadStatusEvents.note, `%${marker.replace(/[%_\\]/g, "\\$&")}%`))).limit(5000);
  const pattern = new RegExp(`· Agent: ${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?= – |$)`, "g");
  for (const row of rows) { const next = (row.note ?? "").replace(pattern, `· Agent: ${to}`); if (next !== row.note) await db.update(leadStatusEvents).set({ note: next.slice(0, 500) }).where(eq(leadStatusEvents.id, row.id)); }
}

/** Lernen und anwenden für einen Mandanten. */
export async function learnAgentAliases(db: Db, tenantId: number): Promise<{ aliases: AgentAlias[]; learned: number; renamed: number }> {
  const stored = await agentAliases(db, tenantId); const found = await evidence(db, tenantId);
  const learned = learnAliases(found.pairs, { spoken: found.spoken, real: found.real }); const merged = mergeAliases(stored, learned);
  if (JSON.stringify(merged) !== JSON.stringify(stored)) await saveAliases(db, tenantId, merged);
  const renamed = await applyAgentAliases(db, tenantId, merged);
  return { aliases: merged, learned: learned.length, renamed };
}
/** Hintergrund-Lauf (jede Minute): Vorstellungen nachprüfen, dann je Mandant lernen und anwenden. */
export async function syncAgentAliases(db: Db, options: { max?: number } = {}): Promise<{ checked: number; renamed: number }> {
  if (running) return { checked: 0, renamed: 0 }; running = true;
  try {
    const done = await backfillSpokenNames(db, { max: options.max });
    const tenants = (await db.selectDistinct({ tenantId: callRecords.tenantId }).from(callRecords).where(eq(callRecords.agentSource, "dialer"))).map((row) => row.tenantId);
    let renamed = 0; for (const tenantId of tenants) renamed += (await learnAgentAliases(db, tenantId)).renamed;
    return { checked: done.checked, renamed };
  } finally { running = false; }
}

/** Übersicht für die Einstellungen: die Zuordnungen mit der Zahl der Gespräche je echtem Namen – und Namen ohne Zuordnung (mögliche Alias-Namen). */
export async function agentAliasOverview(db: Db, tenantId: number) {
  const aliases = await agentAliases(db, tenantId); const found = await evidence(db, tenantId);
  const callsOf = (name: string) => found.names.filter((row) => aliasKey(row.name) === aliasKey(name)).reduce((sum, row) => sum + row.calls, 0);
  const aliasCalls = await db.select({ alias: callRecords.agentAlias, calls: sql<number>`count(*)` }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), sql`${callRecords.agentAlias} is not null and ${callRecords.agentAlias} <> ''`)).groupBy(callRecords.agentAlias);
  const underAlias = (alias: string) => aliasCalls.filter((row) => row.alias && aliasKey(row.alias) === aliasKey(alias)).reduce((sum, row) => sum + Number(row.calls), 0);
  // Namen aus dem Gespräch, die noch niemandem gehören – wahrscheinlich Alias-Namen, deren echter Name noch nicht bekannt ist
  const open = found.names.filter((row) => row.source !== "dialer" && row.source !== "alias" && !isJunkAgentName(row.name) && !resolveAlias(row.name, aliases) && !found.real.some((real) => sameSpelling(real, row.name))).reduce<Array<{ name: string; calls: number }>>((list, row) => { const known = list.find((item) => aliasKey(item.name) === aliasKey(row.name)); if (known) known.calls += row.calls; else list.push({ name: row.name, calls: row.calls }); return list; }, []).sort((a, b) => b.calls - a.calls).slice(0, 60);
  return { aliases: aliases.map((item) => ({ ...item, realCalls: item.name ? callsOf(item.name) : 0, aliasCalls: underAlias(item.alias) })), real: found.real.sort((a, b) => a.localeCompare(b, "de")), open, dialerNames: found.real.length };
}

/** Zuordnung von Hand eintragen oder ändern – gilt sofort, auch rückwirkend. */
export async function setAgentAlias(db: Db, tenantId: number, input: { alias: string; name: string }) {
  const alias = tidyAgentName(input.alias); const name = tidyAgentName(input.name); const problem = aliasProblem(alias, name); if (problem) throw new Error(problem);
  const stored = await agentAliases(db, tenantId);
  if (stored.some((item) => item.name && aliasKey(item.alias) === aliasKey(name))) throw new Error(`„${name}“ ist selbst als Alias eingetragen. Bitte den echten Namen wählen.`);
  const next = [...stored.filter((item) => aliasKey(item.alias) !== aliasKey(alias)), { alias, name, source: "manuell" as const }];
  await saveAliases(db, tenantId, mergeAliases(next, [])); const renamed = await applyAgentAliases(db, tenantId);
  return { success: true as const, renamed };
}
/**
 * Zuordnung entfernen: Die Gespräche, die darüber ihren echten Namen bekommen haben, laufen wieder unter dem Alias.
 * Der Eintrag bleibt als „kein Alias“ stehen, damit er nicht gleich wieder gelernt wird.
 */
export async function removeAgentAlias(db: Db, tenantId: number, input: { alias: string }) {
  const alias = tidyAgentName(input.alias); const stored = await agentAliases(db, tenantId); const entry = stored.find((item) => aliasKey(item.alias) === aliasKey(alias)); if (!entry) throw new Error("Diese Zuordnung gibt es nicht.");
  let restored = 0;
  if (entry.name) {
    const result = await db.update(callRecords).set({ agentName: sql`${callRecords.agentAlias}`, agentAlias: null, agentSource: null }).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.agentSource, "alias"), eq(callRecords.agentAlias, entry.alias)));
    restored = Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
    await db.update(callRecords).set({ agentAlias: "" }).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.agentSource, "dialer"), eq(callRecords.agentAlias, entry.alias))); // Beleg verwerfen – sonst würde das Paar gleich wieder gelernt
  }
  await saveAliases(db, tenantId, mergeAliases([...stored.filter((item) => aliasKey(item.alias) !== aliasKey(alias)), ...(entry.name ? [{ alias: entry.alias, name: "", source: "manuell" as const }] : [])], []));
  return { success: true as const, restored };
}

/**
 * Nach einer Bewertung: Nennt der Dialer den echten Namen, wird der Name der Vorstellung gemerkt – fällt dabei ein neuer Alias an, wird
 * gleich gelernt und angewendet. Läuft das Gespräch selbst unter einem Alias (Name aus dem Gespräch), bekommt es den echten Namen.
 */
export async function aliasAfterEvaluation(db: Db, callId: number, transcript: string, aiName: string | null | undefined): Promise<void> {
  const call = (await db.select({ id: callRecords.id, tenantId: callRecords.tenantId, agentName: callRecords.agentName, agentSource: callRecords.agentSource, agentAlias: callRecords.agentAlias }).from(callRecords).where(eq(callRecords.id, callId)).limit(1))[0]; if (!call) return;
  if (call.agentSource === "dialer") {
    if (call.agentAlias !== null) return; // schon geprüft
    const alias = spokenAliasFor(call.agentName, transcript, aiName); await db.update(callRecords).set({ agentAlias: alias }).where(eq(callRecords.id, call.id));
    if (alias) await learnAgentAliases(db, call.tenantId);
    return;
  }
  if (call.agentSource === "alias" || !call.agentName) return;
  const real = resolveAlias(call.agentName, await agentAliases(db, call.tenantId)); if (!real || aliasKey(real) === aliasKey(call.agentName)) return;
  await db.update(callRecords).set({ agentName: real, agentAlias: call.agentName, agentSource: call.agentSource === "manuell" ? "manuell" : "alias" }).where(eq(callRecords.id, call.id));
}
/** „Jetzt abgleichen“: mehr Gespräche auf einmal nachprüfen, dann lernen und anwenden. */
export async function syncAgentAliasesNow(db: Db, tenantId: number): Promise<{ checked: number; learned: number; renamed: number }> {
  const done = await backfillSpokenNames(db, { tenantId, max: 60 }); const result = await learnAgentAliases(db, tenantId);
  return { checked: done.checked, learned: result.aliases.filter((item) => item.name).length, renamed: result.renamed };
}
