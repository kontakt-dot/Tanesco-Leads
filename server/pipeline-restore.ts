/**
 * Kontakte auf einen früheren Stand zurücksetzen – z. B. nach einem versehentlichen „In die Vertriebspipeline übernehmen“.
 * Die Rechnung steckt in shared/pipeline-restore.ts; hier wird geladen (Verlauf, Rückgängig-Einträge, Kontakte) und angewendet.
 * Zurücksetzen schreibt selbst einen Rückgängig-Eintrag – es lässt sich also wieder zurücknehmen.
 */
import { and, desc, eq, gt, inArray, lte } from "drizzle-orm";
import { leads, pipelineEvents, undoLog, users } from "../drizzle/schema";
import type { Db } from "./lead-pipeline";
import { describeRestore, reconstructStateAt, restoreStamp, type RestoreItem } from "../shared/pipeline-restore";
import { PIPELINE_SOURCE_LABEL } from "../shared/sales-pipeline";
import { recordUndo } from "./undo";

const MAX_DAYS = 60; // so lange hält auch der Rückgängig-Verlauf

async function reconstruct(db: Db, tenantId: number, at: Date) {
  if (Number.isNaN(at.getTime())) throw new Error("Bitte einen gültigen Zeitpunkt wählen.");
  if (at.getTime() > Date.now()) throw new Error("Der Zeitpunkt liegt in der Zukunft – bitte einen früheren wählen.");
  if (at.getTime() < Date.now() - MAX_DAYS * 86_400_000) throw new Error(`Weiter als ${MAX_DAYS} Tage zurück geht es nicht.`);
  const undoRows = await db.select({ id: undoLog.id, kind: undoLog.kind, title: undoLog.title, payload: undoLog.payload, actorUserId: undoLog.actorUserId, createdAt: undoLog.createdAt })
    .from(undoLog).where(and(eq(undoLog.tenantId, tenantId), inArray(undoLog.kind, ["stufe", "zuteilung", "pipeline"]), gt(undoLog.createdAt, at)));
  const events = await db.select({ id: pipelineEvents.id, leadId: pipelineEvents.leadId, fromStage: pipelineEvents.fromStage, toStage: pipelineEvents.toStage, note: pipelineEvents.note, actorUserId: pipelineEvents.actorUserId, createdAt: pipelineEvents.createdAt })
    .from(pipelineEvents).where(and(eq(pipelineEvents.tenantId, tenantId), gt(pipelineEvents.createdAt, at)));
  const ids = Array.from(new Set([...events.map((row) => row.leadId), ...undoRows.flatMap((row) => ((row.payload as { items?: Array<{ leadId?: unknown }> } | null)?.items ?? []).map((item) => Number(item.leadId)).filter((id) => id > 0))]));
  const { pipelineStageSets } = await import("./meta-ads"); const stageSets = await pipelineStageSets(db, tenantId);
  const { loadSettings } = await import("./pipeline-extras"); const customPipelines = (await loadSettings(db, tenantId)).customPipelines;
  if (!ids.length) return { items: [] as RestoreItem[], rows: [], stageSets, customPipelines };
  const rows = await db.select({ id: leads.id, publicId: leads.publicId, firstName: leads.firstName, lastName: leads.lastName, company: leads.company, email: leads.email, listName: leads.listName, createdAt: leads.createdAt, inPipeline: leads.inPipeline, adPlatform: leads.adPlatform, pipelineStage: leads.pipelineStage, ownerUserId: leads.ownerUserId })
    .from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, ids)));
  const stageKeys = new Set(Object.values(stageSets).flatMap((list) => (list ?? []).map((stage) => stage.key)));
  const isStage = (key: string | null | undefined) => Boolean(key && stageKeys.has(key));
  // Stufe bis zum Zeitpunkt: letzter echter Stufen-Eintrag davor (für Kontakte, die vorher nur in der E-Mail-Akquise waren)
  const prior = await db.select({ leadId: pipelineEvents.leadId, toStage: pipelineEvents.toStage }).from(pipelineEvents)
    .where(and(eq(pipelineEvents.tenantId, tenantId), inArray(pipelineEvents.leadId, ids), lte(pipelineEvents.createdAt, at))).orderBy(desc(pipelineEvents.createdAt), desc(pipelineEvents.id));
  const stageBefore = new Map<number, string>(); for (const row of prior) if (!stageBefore.has(row.leadId) && isStage(row.toStage)) stageBefore.set(row.leadId, row.toStage);
  // Vorher nur E-Mail-Akquise: welche Pipeline stand im Kontakt? Wie bei den übrigen Kontakten derselben Liste (Upload), sonst Kaltakquise
  const touched = new Set(ids); const listNames = Array.from(new Set(rows.map((row) => row.listName).filter((name): name is string => Boolean(name))));
  const listRows = listNames.length ? await db.select({ id: leads.id, listName: leads.listName, adPlatform: leads.adPlatform }).from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.listName, listNames))) : [];
  const listPlatform = new Map<string, string>();
  for (const name of listNames) {
    const counts = new Map<string, number>(); for (const row of listRows) if (row.listName === name && !touched.has(row.id) && row.adPlatform) counts.set(row.adPlatform, (counts.get(row.adPlatform) ?? 0) + 1);
    const best = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]; if (best) listPlatform.set(name, best[0]);
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const takenPlatform = (leadId: number) => { const name = byId.get(leadId)?.listName; return (name ? listPlatform.get(name) : undefined) ?? "kaltakquise"; };
  const platformFromLabel = (label: string) => {
    if (label === PIPELINE_SOURCE_LABEL.kaltakquise) return "kaltakquise";
    if (label === PIPELINE_SOURCE_LABEL.email) return "email";
    if (label === PIPELINE_SOURCE_LABEL.ads) return "facebook"; // Meta-Leads: Plattform steht nicht im Verlauf – Facebook führt sie in die Pipeline „Meta Ads“ zurück
    const custom = customPipelines.find((item) => item.label === label); if (custom) return custom.key;
    if (label === "eigene Pipeline" && customPipelines.length === 1) return customPipelines[0].key;
    return undefined; // nicht eindeutig → bleibt, wie es ist
  };
  const items = reconstructStateAt({
    at, leads: rows, isStage, platformFromLabel, takenPlatform, stageBefore: (leadId) => stageBefore.get(leadId),
    undo: undoRows.map((row) => ({ id: row.id, at: row.createdAt, kind: row.kind, title: row.title, actorUserId: row.actorUserId, payload: row.payload })),
    events: events.map((row) => ({ id: row.id, leadId: row.leadId, at: row.createdAt, fromStage: row.fromStage, toStage: row.toStage, note: row.note, actorUserId: row.actorUserId })),
  });
  return { items, rows, stageSets, customPipelines };
}

/** Vorschau: welche Kontakte sich seit dem Zeitpunkt verändert haben und wie sie damals standen (Pipeline, Stufe, Vertriebler). */
export async function pipelineStateAt(db: Db, tenantId: number, at: Date) {
  const { items, rows, stageSets, customPipelines } = await reconstruct(db, tenantId, at);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const userIds = Array.from(new Set(items.flatMap((item) => [item.now.ownerUserId, item.then.ownerUserId, item.cause.actorUserId]).filter((id): id is number => typeof id === "number")));
  const names = new Map((userIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : []).map((row) => [row.id, (row.name ?? "").split(/\s+/)[0] || null]));
  return describeRestore(items, {
    at, stageSets, customPipelines, userName: (id) => names.get(id) ?? null,
    info: (leadId) => { const row = byId.get(leadId); return row ? { publicId: row.publicId, name: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.company || row.email || row.publicId, company: row.company ?? null, email: row.email ?? null } : null; },
  });
}

/** Zurücksetzen für die ausgewählten Kontakte – frisch gerechnet, mit Verlaufseintrag je Kontakt und einem Rückgängig-Eintrag. */
export async function restorePipelineState(db: Db, tenantId: number, input: { at: Date; leadIds: number[]; actorUserId?: number | null }) {
  const wanted = new Set(input.leadIds);
  const { items } = await reconstruct(db, tenantId, input.at);
  const chosen = items.filter((item) => wanted.has(item.leadId));
  if (!chosen.length) throw new Error("Für diese Auswahl gibt es nichts zurückzusetzen – die Kontakte stehen schon so wie damals.");
  const now = new Date(); const stamp = restoreStamp(input.at);
  for (const item of chosen) {
    const set: Record<string, unknown> = { pipelineUpdatedAt: now };
    for (const key of item.changed) set[key] = item.then[key];
    await db.update(leads).set(set).where(and(eq(leads.tenantId, tenantId), eq(leads.id, item.leadId)));
    await db.insert(pipelineEvents).values({ tenantId, leadId: item.leadId, fromStage: item.now.pipelineStage, toStage: item.then.pipelineStage ?? item.now.pipelineStage ?? "neu", actorUserId: input.actorUserId ?? null, note: `Auf den Stand vom ${stamp} Uhr zurückgesetzt`.slice(0, 400) });
  }
  const count = chosen.length;
  const undoId = await recordUndo(db, tenantId, { kind: "pipeline", title: `${count} ${count === 1 ? "Kontakt" : "Kontakte"} auf den Stand vom ${stamp} Uhr zurückgesetzt`, count, actorUserId: input.actorUserId ?? null,
    payload: { items: chosen.map((item) => ({ leadId: item.leadId, adPlatform: item.now.adPlatform, pipelineStage: item.now.pipelineStage, inPipeline: item.now.inPipeline, ownerUserId: item.now.ownerUserId })) } });
  const { logActivity } = await import("./activity"); await logActivity(db, tenantId, { kind: "pipeline_uebernommen", title: `${count} ${count === 1 ? "Kontakt" : "Kontakte"} auf den Stand vom ${stamp} Uhr zurückgesetzt`, count, actorUserId: input.actorUserId ?? null });
  return { restored: count, undoId, at: input.at };
}
