/**
 * Pipeline „E-Mail-Kampagne“, Spalte „Versendet“: Sobald eine Kampagnen-E-Mail an einen Kontakt rausgeht, kommt er
 * automatisch dorthin – aber nur neue: Kontakte, die noch in keiner Pipeline stehen, oder Karten, die noch in „Neu“ liegen.
 * Karten, die schon weitergeschoben wurden (oder in einer anderen Pipeline stehen), bleiben, wo sie sind.
 * Gibt es die Spalte noch nicht, wird sie einmal angelegt (direkt nach „Neu“). Löscht man sie später, kommt sie nicht wieder.
 */
import { and, eq } from "drizzle-orm";
import { leads, pipelineEvents } from "../drizzle/schema";
import type { Db } from "./lead-pipeline";
import { sentCardMove, sentStage, stagesOf, withSentStage } from "../shared/sales-pipeline";

export async function ensureSentStage(db: Db, tenantId: number): Promise<string | null> {
  const { pipelineStageSets, savePipelineStages } = await import("./meta-ads");
  const stages = stagesOf(await pipelineStageSets(db, tenantId), "email");
  const found = sentStage(stages); if (found) return found;
  const { loadSettings, saveSettings } = await import("./pipeline-extras"); const settings = await loadSettings(db, tenantId);
  if (settings.sentStageAdded || stages.length >= 12) return null; // schon einmal angelegt und wieder gelöscht – oder kein Platz mehr
  await savePipelineStages(db, tenantId, withSentStage(stages), "email");
  await saveSettings(db, tenantId, { ...settings, sentStageAdded: true });
  return sentStage(stagesOf(await pipelineStageSets(db, tenantId), "email"));
}

/** Einmal je Mandant und Programmstart prüfen (für das Board – die Spalte soll da sein, bevor die nächste E-Mail rausgeht). */
const checked = new Set<number>();
export async function ensureSentStageOnce(db: Db, tenantId: number) { if (checked.has(tenantId)) return; checked.add(tenantId); try { await ensureSentStage(db, tenantId); } catch (error) { checked.delete(tenantId); console.error("[versendet] Spalte nicht angelegt:", error instanceof Error ? error.message : error); } }

export async function fileSentCard(db: Db, tenantId: number, input: { leadId: number; campaignName: string }) {
  const lead = (await db.select({ id: leads.id, kind: leads.kind, inPipeline: leads.inPipeline, adPlatform: leads.adPlatform, pipelineStage: leads.pipelineStage }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, input.leadId))).limit(1))[0];
  if (!lead || lead.kind !== "vertrieb") return null;
  if (lead.inPipeline !== false && lead.adPlatform !== "email") return null; // andere Pipeline: bleibt, wo sie ist
  const to = await ensureSentStage(db, tenantId); if (!to) return null;
  const { pipelineStageSets } = await import("./meta-ads"); const stages = stagesOf(await pipelineStageSets(db, tenantId), "email");
  const move = sentCardMove(lead, stages); if (!move) return null;
  await db.update(leads).set({ inPipeline: true, adPlatform: "email", pipelineStage: move.to, pipelineUpdatedAt: new Date() }).where(eq(leads.id, lead.id));
  const name = input.campaignName.slice(0, 160);
  await db.insert(pipelineEvents).values({ tenantId, leadId: lead.id, fromStage: move.from, toStage: move.to, actorUserId: null, note: move.intake ? `E-Mail aus „${name}“ versendet – automatisch aus der E-Mail-Akquise in die Pipeline „E-Mail-Kampagne“ übernommen` : `E-Mail aus „${name}“ versendet` });
  if (move.intake) { const { autoAssign } = await import("./pipeline-extras"); await autoAssign(db, tenantId, lead.id); } // Verteilung wie beim Übernehmen von Hand
  return move;
}
