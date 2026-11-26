/**
 * Agenten von Hand aus der Bestenliste löschen und zurückholen.
 * Gelöscht wird nur der Platz in der Bestenliste: Der Name steht auf einer Liste (callQaConfigs.hiddenAgents), seine Gespräche bleiben
 * in der Gesprächsliste erhalten. Solange er dort steht, zählt er in der Bestenliste nicht mit – auch mit neuen Gesprächen nicht.
 * Die Rechnung dazu (Namen vergleichen, aus den Bausteinen nehmen) steht in shared/agent-ranking.ts.
 */
import { eq } from "drizzle-orm";
import { callQaConfigs } from "../drizzle/schema";
import { hiddenAgentKeys, hideAgentIn, isNoAgent, nameKey, readHiddenAgents, restoreAgentIn, type HiddenAgent } from "../shared/agent-ranking";
import type { Db } from "./lead-pipeline";

export async function hiddenAgents(db: Db, tenantId: number): Promise<HiddenAgent[]> {
  const row = (await db.select({ hiddenAgents: callQaConfigs.hiddenAgents }).from(callQaConfigs).where(eq(callQaConfigs.tenantId, tenantId)).limit(1))[0];
  return readHiddenAgents(row?.hiddenAgents);
}
/** Agent aus der Bestenliste löschen. Zweimal löschen ändert nichts. */
export async function hideAgent(db: Db, tenantId: number, input: { name: string; by?: string | null; now?: Date }): Promise<{ success: true; name: string; hidden: number; changed: boolean }> {
  const name = input.name.trim(); if (isNoAgent(name)) throw new Error("„Ohne Agent“ ist kein Agent – diese Gespräche hat der Dialer ohne Namen gemeldet.");
  const { ensureCallQaConfig } = await import("./call-qa"); const config = await ensureCallQaConfig(db, tenantId);
  const before = readHiddenAgents(config.hiddenAgents); const list = hideAgentIn(before, name, input.by ?? null, input.now ?? new Date());
  if (list !== before) await db.update(callQaConfigs).set({ hiddenAgents: list }).where(eq(callQaConfigs.id, config.id));
  return { success: true, name, hidden: list.length, changed: list !== before };
}
/** Agent zurückholen: Er steht wieder mit allen Zahlen in der Bestenliste. */
export async function restoreAgent(db: Db, tenantId: number, input: { name: string }): Promise<{ success: true; name: string; hidden: number; changed: boolean }> {
  const before = await hiddenAgents(db, tenantId); const key = nameKey(input.name); const list = restoreAgentIn(before, input.name);
  const changed = hiddenAgentKeys(before).has(key) && list.length !== before.length;
  if (changed) await db.update(callQaConfigs).set({ hiddenAgents: list }).where(eq(callQaConfigs.tenantId, tenantId));
  return { success: true, name: input.name.trim(), hidden: list.length, changed };
}
