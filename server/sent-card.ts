/**
 * Pipeline „E-Mail-Kampagne“, Spalte „Versendet“: Sobald eine Kampagnen-E-Mail an einen Kontakt rausgeht, kommt er
 * automatisch dorthin – aber nur neue: Kontakte, die noch in keiner Pipeline stehen, oder Karten, die noch in „Neu“ liegen.
 * Karten, die schon weitergeschoben wurden (oder in einer anderen Pipeline stehen), bleiben, wo sie sind.
 * Gibt es die Spalte noch nicht, wird sie einmal angelegt (direkt nach „Neu“). Löscht man sie später, kommt sie nicht wieder.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { emailCampaignEvents, emailCampaignRecipients, emailSuppressions, leads, pipelineEvents } from "../drizzle/schema";
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

/**
 * Nachtrag (einmal): Kontakte, an die schon vorher eine Kampagnen-E-Mail tatsächlich rausging (Ereignis „gesendet“),
 * kommen nach denselben Regeln nach „Versendet“ – nur neue: noch in keiner Pipeline oder noch in „Neu“.
 * Unzustellbare, Abgemeldete und Kontakte auf der Sperrliste bleiben draußen. Mit Rückgängig-Eintrag.
 */
export async function backfillSentCards(db: Db, tenantId: number, options: { force?: boolean } = {}) {
  const { loadSettings, saveSettings } = await import("./pipeline-extras");
  if ((await loadSettings(db, tenantId)).sentBackfillDone && !options.force) return { moved: 0, intake: 0, done: false as const };
  const to = await ensureSentStage(db, tenantId); if (!to) return { moved: 0, intake: 0, done: false as const }; // ohne Spalte nichts nachtragen
  const { pipelineStageSets } = await import("./meta-ads"); const stages = stagesOf(await pipelineStageSets(db, tenantId), "email");
  const sentRows = await db.selectDistinct({ leadId: emailCampaignRecipients.leadId }).from(emailCampaignEvents).innerJoin(emailCampaignRecipients, eq(emailCampaignRecipients.id, emailCampaignEvents.recipientId))
    .where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.kind, "gesendet"), isNotNull(emailCampaignRecipients.leadId)));
  const sentIds = Array.from(new Set(sentRows.map((row) => row.leadId).filter((id): id is number => typeof id === "number")));
  const badIds = new Set((await db.select({ leadId: emailCampaignRecipients.leadId }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), inArray(emailCampaignRecipients.status, ["bounce", "abgemeldet"])))).map((row) => row.leadId));
  const suppressed = new Set((await db.select({ email: emailSuppressions.email }).from(emailSuppressions).where(eq(emailSuppressions.tenantId, tenantId))).map((row) => row.email.trim().toLowerCase()));
  const rows = sentIds.length ? await db.select({ id: leads.id, kind: leads.kind, email: leads.email, inPipeline: leads.inPipeline, adPlatform: leads.adPlatform, pipelineStage: leads.pipelineStage }).from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, sentIds))) : [];
  const chosen = rows.flatMap((row) => { if (row.kind !== "vertrieb" || badIds.has(row.id) || (row.email && suppressed.has(row.email.trim().toLowerCase()))) return []; const move = sentCardMove(row, stages); return move ? [{ row, move }] : []; });
  const { captureLeads, recordUndo } = await import("./undo"); const { autoAssign } = await import("./pipeline-extras");
  const startedAt = new Date(); const before = await captureLeads(db, tenantId, { leadIds: chosen.map((item) => item.row.id) });
  for (const { row, move } of chosen) {
    await db.update(leads).set({ inPipeline: true, adPlatform: "email", pipelineStage: move.to, pipelineUpdatedAt: new Date() }).where(eq(leads.id, row.id));
    await db.insert(pipelineEvents).values({ tenantId, leadId: row.id, fromStage: move.from, toStage: move.to, actorUserId: null, note: move.intake ? "Bereits versendete Kampagnen-E-Mail – automatisch aus der E-Mail-Akquise in die Pipeline „E-Mail-Kampagne“ übernommen" : "Bereits versendete Kampagnen-E-Mail – automatisch nach „Versendet“" });
    if (move.intake) await autoAssign(db, tenantId, row.id);
  }
  const count = chosen.length; const intake = chosen.filter((item) => item.move.intake).length;
  if (count) {
    await recordUndo(db, tenantId, { kind: "pipeline", title: `${count} ${count === 1 ? "Kontakt" : "Kontakte"} mit bereits versendeter E-Mail nach „Versendet“ geholt`, count, actorUserId: null,
      payload: { startedAt: startedAt.toISOString(), items: before.map((row) => ({ leadId: row.id, adPlatform: row.adPlatform, pipelineStage: row.pipelineStage, inPipeline: row.inPipeline, ownerUserId: row.ownerUserId })) } });
    const { logActivity } = await import("./activity"); await logActivity(db, tenantId, { kind: "pipeline_uebernommen", title: `${count} ${count === 1 ? "Kontakt" : "Kontakte"} mit bereits versendeter E-Mail in die Spalte „Versendet“ (Pipeline „E-Mail-Kampagne“)`, count, actorUserId: null });
  }
  await saveSettings(db, tenantId, { ...(await loadSettings(db, tenantId)), sentBackfillDone: true });
  return { moved: count, intake, done: true as const };
}
/** Einmal je Programmstart anstoßen (Versand-Takt); der Merker in den Einstellungen sorgt dafür, dass es nur einmal passiert. */
const backfills = new Map<number, Promise<unknown>>();
export function backfillSentCardsOnce(db: Db, tenantId: number) {
  if (!backfills.has(tenantId)) backfills.set(tenantId, backfillSentCards(db, tenantId).catch((error) => { backfills.delete(tenantId); console.error("[versendet] Nachtrag:", error instanceof Error ? error.message : error); }));
  return backfills.get(tenantId)!;
}
