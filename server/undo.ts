/**
 * Rückgängig & Papierkorb für die Vertriebspipeline.
 *
 * Jede Operation, die man zurücknehmen können soll, schreibt einen Eintrag in `undoLog` – mit genau den Daten,
 * die zum Zurücknehmen nötig sind:
 *  - stufe       Karten in eine andere Stufe verschoben            → vorherige Stufe je Karte
 *  - zuteilung   Vertriebler zugeteilt/entfernt/verteilt           → vorheriger Vertriebler je Karte
 *  - pipeline    Karten in eine andere Pipeline verschoben         → vorherige Pipeline + Stufe je Karte
 *  - anruf       Anruf-Ergebnis festgehalten                       → Versuch, Verlaufseintrag, ggf. Stufe und Aufgabe
 *  - anruf_weg   Anruf-Ergebnis gelöscht                           → der gelöschte Versuch
 *  - notiz_neu / notiz_text / notiz_weg                            → Notiz löschen / alten Text / Notiz wiederherstellen
 *  - kontakt_neu Kontakt von Hand angelegt                         → Kontakt wieder löschen
 *  - loeschen    Kontakte/Listen gelöscht (auch Upload rückgängig) → kompletter Schnappschuss aller Daten (Papierkorb)
 * Zurücknehmen markiert den Eintrag als erledigt; gelöschte Kontakte kommen mit ihren alten IDs zurück,
 * damit Verlauf, Anrufe, Kampagnen und Posteingang wieder dranhängen.
 */
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { dialerCalls, dialerQueueItems, emailCampaignEvents, emailCampaignRecipients, inboxMessages, leadCallAttempts, leadStatusEvents, leadTagAssignments, leads, pipelineEvents, pipelineNotes, pipelineTasks, outboundMessages, undoLog, users } from "../drizzle/schema";
import type { Db } from "./lead-pipeline";

export type UndoKind = "stufe" | "zuteilung" | "pipeline" | "anruf" | "anruf_weg" | "notiz_neu" | "notiz_text" | "notiz_weg" | "kontakt_neu" | "loeschen" | "serie";
export const UNDO_LABEL: Record<UndoKind, string> = { stufe: "Stufe", zuteilung: "Zuteilung", pipeline: "Pipeline", anruf: "Anruf", anruf_weg: "Anruf gelöscht", notiz_neu: "Notiz", notiz_text: "Notiz geändert", notiz_weg: "Notiz gelöscht", kontakt_neu: "Kontakt angelegt", loeschen: "Gelöscht", serie: "E-Mail-Funnel" };
type Row = Record<string, unknown>;
export type LeadSnapshot = { leads: Row[]; pipelineTasks: Row[]; pipelineEvents: Row[]; pipelineNotes: Row[]; outboundMessages: Row[]; emailCampaignRecipients: Row[]; emailCampaignEvents: Row[]; dialerQueueItems: Row[]; leadStatusEvents: Row[]; leadTagAssignments: Row[]; leadCallAttempts: Row[]; inboxLinks: Array<{ id: number; leadId: number | null; campaignRecipientId: number | null }>; dialerLinks: Array<{ id: number; leadId: number | null }> };

export async function recordUndo(db: Db, tenantId: number, entry: { kind: UndoKind; title: string; payload: unknown; actorUserId?: number | null; count?: number }) {
  const inserted = await db.insert(undoLog).values({ tenantId, kind: entry.kind, title: entry.title.slice(0, 300), payload: entry.payload as object, actorUserId: entry.actorUserId ?? null, count: Math.max(1, entry.count ?? 1) });
  // Aufräumen: Einträge älter als 60 Tage fallen raus (Papierkorb hält 60 Tage)
  await db.delete(undoLog).where(and(eq(undoLog.tenantId, tenantId), lt(undoLog.createdAt, new Date(Date.now() - 60 * 86_400_000)))).catch(() => null);
  return Number((inserted as unknown as Array<{ insertId?: number }>)[0]?.insertId) || 0;
}

/** Alles, was an Kontakten hängt, als Schnappschuss – vor dem Löschen. */
export async function snapshotLeads(db: Db, tenantId: number, ids: number[]): Promise<LeadSnapshot> {
  const empty: LeadSnapshot = { leads: [], pipelineTasks: [], pipelineEvents: [], pipelineNotes: [], outboundMessages: [], emailCampaignRecipients: [], emailCampaignEvents: [], dialerQueueItems: [], leadStatusEvents: [], leadTagAssignments: [], leadCallAttempts: [], inboxLinks: [], dialerLinks: [] };
  if (!ids.length) return empty;
  const recipients = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), inArray(emailCampaignRecipients.leadId, ids)));
  const recipientIds = recipients.map((row) => row.id);
  return {
    leads: await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, ids))),
    pipelineTasks: await db.select().from(pipelineTasks).where(and(eq(pipelineTasks.tenantId, tenantId), inArray(pipelineTasks.leadId, ids))),
    pipelineEvents: await db.select().from(pipelineEvents).where(and(eq(pipelineEvents.tenantId, tenantId), inArray(pipelineEvents.leadId, ids))),
    pipelineNotes: await db.select().from(pipelineNotes).where(and(eq(pipelineNotes.tenantId, tenantId), inArray(pipelineNotes.leadId, ids))),
    outboundMessages: await db.select().from(outboundMessages).where(and(eq(outboundMessages.tenantId, tenantId), inArray(outboundMessages.leadId, ids))),
    emailCampaignRecipients: recipients,
    emailCampaignEvents: recipientIds.length ? await db.select().from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), inArray(emailCampaignEvents.recipientId, recipientIds))) : [],
    dialerQueueItems: await db.select().from(dialerQueueItems).where(and(eq(dialerQueueItems.tenantId, tenantId), inArray(dialerQueueItems.leadId, ids))),
    leadStatusEvents: await db.select().from(leadStatusEvents).where(and(eq(leadStatusEvents.tenantId, tenantId), inArray(leadStatusEvents.leadId, ids))),
    leadTagAssignments: await db.select().from(leadTagAssignments).where(inArray(leadTagAssignments.leadId, ids)),
    leadCallAttempts: await db.select().from(leadCallAttempts).where(and(eq(leadCallAttempts.tenantId, tenantId), inArray(leadCallAttempts.leadId, ids))),
    inboxLinks: [
      ...(await db.select({ id: inboxMessages.id, leadId: inboxMessages.leadId, campaignRecipientId: inboxMessages.campaignRecipientId }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), inArray(inboxMessages.leadId, ids)))),
      ...(recipientIds.length ? await db.select({ id: inboxMessages.id, leadId: inboxMessages.leadId, campaignRecipientId: inboxMessages.campaignRecipientId }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), inArray(inboxMessages.campaignRecipientId, recipientIds))) : []),
    ],
    dialerLinks: await db.select({ id: dialerCalls.id, leadId: dialerCalls.leadId }).from(dialerCalls).where(and(eq(dialerCalls.tenantId, tenantId), inArray(dialerCalls.leadId, ids))),
  };
}

/** JSON hat aus Datumswerten Texte gemacht – vor dem Einfügen wieder in Datumswerte verwandeln. */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const revive = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" && ISO.test(value) ? new Date(value) : value]));
async function insertMissing(db: Db, table: Parameters<Db["insert"]>[0], rows: Row[]) {
  for (const row of rows) { try { await db.insert(table).values(revive(row) as never); } catch { /* gibt es schon (z. B. doppelt wiederhergestellt) */ } }
}
/** Schnappschuss zurückspielen: Kontakte mit alten IDs, dann alles, was daran hing; Posteingang und Dialer wieder verknüpfen. */
export async function restoreSnapshot(db: Db, tenantId: number, snapshot: LeadSnapshot) {
  const existing = new Set((await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, snapshot.leads.map((row) => Number(row.id)).concat([0]))))).map((row) => row.id));
  const missing = snapshot.leads.filter((row) => !existing.has(Number(row.id)));
  const publicTaken = new Set((await db.select({ publicId: leads.publicId }).from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.publicId, missing.map((row) => String(row.publicId)).concat(["-"]))))).map((row) => row.publicId));
  for (const row of missing) { const copy = { ...row }; if (publicTaken.has(String(copy.publicId))) copy.publicId = `${String(copy.publicId).slice(0, 8)}-W${Math.floor(Math.random() * 90 + 10)}`; await insertMissing(db, leads, [copy]); }
  await insertMissing(db, pipelineTasks, snapshot.pipelineTasks);
  await insertMissing(db, pipelineEvents, snapshot.pipelineEvents);
  await insertMissing(db, pipelineNotes, snapshot.pipelineNotes);
  await insertMissing(db, outboundMessages, snapshot.outboundMessages);
  await insertMissing(db, emailCampaignRecipients, snapshot.emailCampaignRecipients);
  await insertMissing(db, emailCampaignEvents, snapshot.emailCampaignEvents);
  await insertMissing(db, dialerQueueItems, snapshot.dialerQueueItems);
  await insertMissing(db, leadStatusEvents, snapshot.leadStatusEvents);
  await insertMissing(db, leadTagAssignments, snapshot.leadTagAssignments);
  await insertMissing(db, leadCallAttempts, snapshot.leadCallAttempts);
  for (const link of snapshot.inboxLinks) await db.update(inboxMessages).set({ leadId: link.leadId, campaignRecipientId: link.campaignRecipientId }).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.id, link.id))).catch(() => null);
  for (const link of snapshot.dialerLinks) await db.update(dialerCalls).set({ leadId: link.leadId }).where(and(eq(dialerCalls.tenantId, tenantId), eq(dialerCalls.id, link.id))).catch(() => null);
  return { restored: missing.length };
}

/** Liste der letzten Operationen (für „Rückgängig & Papierkorb“). Der Schnappschuss selbst wird nicht mitgeschickt. */
export async function listUndo(db: Db, tenantId: number, options: { limit?: number; kind?: UndoKind | "alle" | null } = {}) {
  const rows = await db.select({ id: undoLog.id, kind: undoLog.kind, title: undoLog.title, count: undoLog.count, createdAt: undoLog.createdAt, undoneAt: undoLog.undoneAt, actor: users.name }).from(undoLog).leftJoin(users, eq(users.id, undoLog.actorUserId)).where(and(eq(undoLog.tenantId, tenantId), ...(options.kind && options.kind !== "alle" ? [eq(undoLog.kind, options.kind)] : []))).orderBy(desc(undoLog.createdAt), desc(undoLog.id)).limit(Math.min(300, options.limit ?? 150));
  return rows.map((row) => ({ ...row, label: UNDO_LABEL[row.kind as UndoKind] ?? row.kind, actor: row.actor?.split(/\s+/)[0] ?? null }));
}

type StageItem = { leadId: number; from: string | null; to?: string | null };
type OwnerItem = { leadId: number; from: number | null };
type PipelineItem = { leadId: number; adPlatform?: string | null; pipelineStage?: string | null; inPipeline?: boolean | null; ownerUserId?: number | null };

/** Eine Operation zurücknehmen. Gibt einen kurzen Satz zurück, was passiert ist. */
export async function undoOperation(db: Db, tenantId: number, id: number, actorUserId: number | null) {
  const entry = (await db.select().from(undoLog).where(and(eq(undoLog.id, id), eq(undoLog.tenantId, tenantId))).limit(1))[0];
  if (!entry) throw new Error("Diesen Eintrag gibt es nicht mehr.");
  if (entry.undoneAt) throw new Error("Das wurde schon rückgängig gemacht.");
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  const now = new Date(); let message = "Rückgängig gemacht.";
  const leadExists = async (leadId: number) => Boolean((await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId))).limit(1))[0]);
  switch (entry.kind as UndoKind) {
    case "stufe": {
      const items = (payload.items ?? []) as StageItem[]; let done = 0;
      for (const item of items) { if (!item.from || !(await leadExists(item.leadId))) continue; await db.update(leads).set({ pipelineStage: item.from, pipelineUpdatedAt: now }).where(and(eq(leads.tenantId, tenantId), eq(leads.id, item.leadId))); await db.insert(pipelineEvents).values({ tenantId, leadId: item.leadId, fromStage: item.to ?? null, toStage: item.from, actorUserId, note: "Rückgängig gemacht" }); done += 1; }
      message = `${done} ${done === 1 ? "Karte steht" : "Karten stehen"} wieder in der alten Stufe.`; break;
    }
    case "zuteilung": {
      const items = (payload.items ?? []) as OwnerItem[]; let done = 0;
      for (const item of items) { if (!(await leadExists(item.leadId))) continue; await db.update(leads).set({ ownerUserId: item.from }).where(and(eq(leads.tenantId, tenantId), eq(leads.id, item.leadId))); await db.insert(pipelineEvents).values({ tenantId, leadId: item.leadId, fromStage: null, toStage: "besitzer", actorUserId, note: "Zuteilung rückgängig gemacht" }); done += 1; }
      message = `Zuteilung von ${done} ${done === 1 ? "Karte" : "Karten"} zurückgesetzt.`; break;
    }
    case "pipeline": {
      const items = (payload.items ?? []) as PipelineItem[]; let done = 0;
      // Vertriebler nur, wenn er festgehalten wurde („In die Vertriebspipeline übernommen“ teilt automatisch zu; „Zurücksetzen“ ebenso)
      for (const item of items) { if (!(await leadExists(item.leadId))) continue; await db.update(leads).set({ ...("adPlatform" in item ? { adPlatform: item.adPlatform ?? null } : {}), ...("pipelineStage" in item ? { pipelineStage: item.pipelineStage ?? null } : {}), ...(typeof item.inPipeline === "boolean" ? { inPipeline: item.inPipeline } : {}), ...("ownerUserId" in item ? { ownerUserId: item.ownerUserId ?? null } : {}), pipelineUpdatedAt: now }).where(and(eq(leads.tenantId, tenantId), eq(leads.id, item.leadId))); done += 1; }
      message = `${done} ${done === 1 ? "Karte ist" : "Karten sind"} wieder in der alten Pipeline.`; break;
    }
    case "anruf": {
      const attemptId = Number(payload.attemptId) || 0; const eventId = Number(payload.eventId) || 0; const taskId = Number(payload.taskId) || 0; const leadId = Number(payload.leadId) || 0;
      if (attemptId) await db.delete(leadCallAttempts).where(and(eq(leadCallAttempts.tenantId, tenantId), eq(leadCallAttempts.id, attemptId)));
      if (eventId) await db.delete(pipelineEvents).where(and(eq(pipelineEvents.tenantId, tenantId), eq(pipelineEvents.id, eventId)));
      if (taskId) await db.delete(pipelineTasks).where(and(eq(pipelineTasks.tenantId, tenantId), eq(pipelineTasks.id, taskId), isNull(pipelineTasks.doneAt)));
      if (payload.movedFrom && leadId && (await leadExists(leadId))) { const current = (await db.select({ stage: leads.pipelineStage }).from(leads).where(eq(leads.id, leadId)).limit(1))[0]?.stage; if (current === payload.movedTo) { await db.update(leads).set({ pipelineStage: String(payload.movedFrom), pipelineUpdatedAt: now }).where(eq(leads.id, leadId)); await db.insert(pipelineEvents).values({ tenantId, leadId, fromStage: String(payload.movedTo), toStage: String(payload.movedFrom), actorUserId, note: "Anruf rückgängig gemacht" }); } }
      message = "Anruf-Ergebnis entfernt."; break;
    }
    case "anruf_weg": {
      const attempt = payload.attempt as Row | undefined; const event = payload.event as Row | undefined;
      if (attempt && (await leadExists(Number(attempt.leadId)))) { await insertMissing(db, leadCallAttempts, [attempt]); if (event) await insertMissing(db, pipelineEvents, [event]); }
      message = "Anruf-Ergebnis wiederhergestellt."; break;
    }
    case "notiz_neu": { const noteId = Number(payload.noteId) || 0; if (noteId) await db.delete(pipelineNotes).where(and(eq(pipelineNotes.tenantId, tenantId), eq(pipelineNotes.id, noteId))); message = "Notiz entfernt."; break; }
    case "notiz_text": { const noteId = Number(payload.noteId) || 0; if (noteId) await db.update(pipelineNotes).set({ text: String(payload.text ?? "") }).where(and(eq(pipelineNotes.tenantId, tenantId), eq(pipelineNotes.id, noteId))); message = "Alter Notiz-Text ist wieder da."; break; }
    case "notiz_weg": { const note = payload.note as Row | undefined; if (note && (await leadExists(Number(note.leadId)))) await insertMissing(db, pipelineNotes, [note]); message = "Notiz wiederhergestellt."; break; }
    case "kontakt_neu": { const leadId = Number(payload.leadId) || 0; if (leadId && (await leadExists(leadId))) { const { removeLeadsCascade } = await import("./sales-outreach"); await removeLeadsCascade(db, tenantId, [leadId], { actorUserId, reason: "Anlegen rückgängig gemacht", undo: false }); } message = "Kontakt wieder entfernt."; break; }
    case "serie": {
      const items = (payload.items ?? []) as Array<{ recipientId: number; status: string; nodeId: string | null; nextActionAt: string | null; eventId: number }>; let done = 0;
      for (const item of items) { await db.update(emailCampaignRecipients).set({ status: item.status as "wartet", nodeId: item.nodeId, nextActionAt: item.nextActionAt ? new Date(item.nextActionAt) : null }).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.id, item.recipientId), eq(emailCampaignRecipients.status, "fertig"))); if (item.eventId) await db.delete(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.id, item.eventId))); done += 1; }
      message = `${done === 1 ? "Der Kontakt ist" : `${done} Einträge sind`} wieder im E-Mail-Funnel.`; break;
    }
    case "loeschen": { const result = await restoreSnapshot(db, tenantId, payload as unknown as LeadSnapshot); message = `${result.restored} ${result.restored === 1 ? "Kontakt" : "Kontakte"} wiederhergestellt – mit Verlauf, Notizen, Anrufen und Kampagnen.`; break; }
    default: throw new Error("Dieser Eintrag lässt sich nicht zurücknehmen.");
  }
  await db.update(undoLog).set({ undoneAt: now, undoneByUserId: actorUserId }).where(eq(undoLog.id, entry.id));
  return { success: true as const, message, kind: entry.kind };
}

/** Ein festgehaltenes Anruf-Ergebnis löschen (z. B. Test) – lässt sich selbst wieder rückgängig machen. */
export async function deleteCallAttempt(db: Db, tenantId: number, attemptId: number, actorUserId: number | null) {
  const attempt = (await db.select().from(leadCallAttempts).where(and(eq(leadCallAttempts.tenantId, tenantId), eq(leadCallAttempts.id, attemptId))).limit(1))[0];
  if (!attempt) throw new Error("Diesen Anruf gibt es nicht mehr.");
  // passender Verlaufseintrag „Anruf n: …“ zur selben Zeit
  const event = (await db.select().from(pipelineEvents).where(and(eq(pipelineEvents.tenantId, tenantId), eq(pipelineEvents.leadId, attempt.leadId), eq(pipelineEvents.toStage, "anruf"), eq(pipelineEvents.createdAt, attempt.at))).limit(1))[0] ?? null;
  await db.delete(leadCallAttempts).where(eq(leadCallAttempts.id, attempt.id));
  if (event) await db.delete(pipelineEvents).where(eq(pipelineEvents.id, event.id));
  const lead = (await db.select({ firstName: leads.firstName, lastName: leads.lastName, company: leads.company }).from(leads).where(eq(leads.id, attempt.leadId)).limit(1))[0];
  const name = [lead?.firstName, lead?.lastName].filter(Boolean).join(" ") || lead?.company || "Kontakt";
  const undoId = await recordUndo(db, tenantId, { kind: "anruf_weg", title: `${name}: Anruf-Ergebnis gelöscht`, payload: { attempt, event }, actorUserId });
  return { success: true as const, undoId };
}

/* ---------- Vorher/Nachher festhalten (für Stufe, Zuteilung, Pipeline) ---------- */
export type LeadState = { id: number; publicId: string; name: string; pipelineStage: string | null; ownerUserId: number | null; adPlatform: string | null; inPipeline: boolean | null };
export async function captureLeads(db: Db, tenantId: number, by: { publicIds?: string[]; leadIds?: number[] }): Promise<LeadState[]> {
  const condition = by.publicIds ? inArray(leads.publicId, by.publicIds.length ? by.publicIds : ["-"]) : inArray(leads.id, by.leadIds?.length ? by.leadIds : [0]);
  const rows = await db.select({ id: leads.id, publicId: leads.publicId, firstName: leads.firstName, lastName: leads.lastName, company: leads.company, pipelineStage: leads.pipelineStage, ownerUserId: leads.ownerUserId, adPlatform: leads.adPlatform, inPipeline: leads.inPipeline }).from(leads).where(and(eq(leads.tenantId, tenantId), condition));
  return rows.map((row) => ({ id: row.id, publicId: row.publicId, name: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.company || row.publicId, pipelineStage: row.pipelineStage, ownerUserId: row.ownerUserId, adPlatform: row.adPlatform, inPipeline: row.inPipeline }));
}
async function stageLabelOf(db: Db, tenantId: number) {
  const { pipelineStageSets } = await import("./meta-ads"); const sets = await pipelineStageSets(db, tenantId);
  const labels = new Map<string, string>(); for (const set of Object.values(sets)) for (const stage of set ?? []) if (!labels.has(stage.key)) labels.set(stage.key, stage.label);
  return (key: string | null | undefined) => (key ? labels.get(key) ?? key : "–");
}
export async function recordStageChanges(db: Db, tenantId: number, before: LeadState[], actorUserId: number | null) {
  const after = new Map((await captureLeads(db, tenantId, { leadIds: before.map((row) => row.id) })).map((row) => [row.id, row]));
  const changed = before.filter((row) => after.get(row.id) && after.get(row.id)!.pipelineStage !== row.pipelineStage);
  if (!changed.length) return 0; const label = await stageLabelOf(db, tenantId); const to = after.get(changed[0].id)!.pipelineStage;
  const title = changed.length === 1 ? `${changed[0].name}: ${label(changed[0].pipelineStage)} → ${label(to)}` : `${changed.length} Karten → ${label(to)}`;
  return recordUndo(db, tenantId, { kind: "stufe", title, count: changed.length, actorUserId, payload: { items: changed.map((row) => ({ leadId: row.id, from: row.pipelineStage, to: after.get(row.id)!.pipelineStage })) } });
}
export async function recordOwnerChanges(db: Db, tenantId: number, before: LeadState[], actorUserId: number | null, what = "zugeteilt") {
  const after = new Map((await captureLeads(db, tenantId, { leadIds: before.map((row) => row.id) })).map((row) => [row.id, row]));
  const changed = before.filter((row) => after.get(row.id) && after.get(row.id)!.ownerUserId !== row.ownerUserId);
  if (!changed.length) return 0;
  const ownerIds = Array.from(new Set(changed.map((row) => after.get(row.id)!.ownerUserId).filter((id): id is number => typeof id === "number")));
  const names = ownerIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ownerIds)) : [];
  const target = ownerIds.length === 1 ? names[0]?.name?.split(/\s+/)[0] ?? "Vertriebler" : ownerIds.length ? `${ownerIds.length} Vertriebler` : "niemand";
  const title = changed.length === 1 ? `${changed[0].name}: ${what} an ${target}` : `${changed.length} Karten ${what} an ${target}`;
  return recordUndo(db, tenantId, { kind: "zuteilung", title, count: changed.length, actorUserId, payload: { items: changed.map((row) => ({ leadId: row.id, from: row.ownerUserId })) } });
}
export async function recordPipelineChanges(db: Db, tenantId: number, before: LeadState[], actorUserId: number | null, targetLabel: string) {
  const after = new Map((await captureLeads(db, tenantId, { leadIds: before.map((row) => row.id) })).map((row) => [row.id, row]));
  const changed = before.filter((row) => { const now = after.get(row.id); return now && (now.adPlatform !== row.adPlatform || now.pipelineStage !== row.pipelineStage || now.inPipeline !== row.inPipeline); });
  if (!changed.length) return 0;
  const title = changed.length === 1 ? `${changed[0].name}: in Pipeline „${targetLabel}“ verschoben` : `${changed.length} Karten in Pipeline „${targetLabel}“ verschoben`;
  return recordUndo(db, tenantId, { kind: "pipeline", title, count: changed.length, actorUserId, payload: { items: changed.map((row) => ({ leadId: row.id, adPlatform: row.adPlatform, pipelineStage: row.pipelineStage, inPipeline: row.inPipeline })) } });
}
