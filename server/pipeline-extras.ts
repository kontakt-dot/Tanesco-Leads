/**
 * Vertriebspipeline – Erweiterungen:
 *  - Wiedervorlagen & Aufgaben („Heute fällig“), Termine mit Einladung (ICS) und Erinnerung
 *  - eingeschlafene Karten → automatische Nachfass-Serie; Stufe/Anruf-Ergebnis → E-Mail-Serie; Antwort → Stufe
 *  - Nachrichten aus der Karte (SMS, WhatsApp, Einzel-E-Mail aus Vorlage)
 *  - Angebotswerte, Pipeline-Wert, Umsatz je Vertriebler; Verteilregeln & Tagesziele (Team)
 *  - Mehrfachauswahl (verschieben), CSV-Export
 * Die Regeln selbst liegen in shared/pipeline-extras.ts, damit Chat-Demo und Oberfläche dieselbe Logik nutzen.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";
import crypto from "node:crypto";
import { pipelineStageConfigs, dialerCalls, dialerQueueItems, emailCampaignEvents, emailCampaignRecipients, emailCampaigns, emailSuppressions, inboxMessages, leadCallAttempts, leadCategories, leads, outboundMessages, phoneNumbers, pipelineEvents, pipelineNotes, pipelineSettings, pipelineTasks, users, type PipelineTask } from "../drizzle/schema";
import { DEFAULT_DESIGN, type EmailDesign } from "../shared/email-design";
import { recipientValues, renderNode, type EmailNode, type EmailTree } from "../shared/email-campaigns";
import { extraFieldsOf } from "../shared/cold-list";
import { buildIcs, callResultLabel, CALL_RESULTS, CHANNEL_LABELS, DEFAULT_PIPELINE_SETTINGS, distributionActive, fillMessage, isCallResult, followUpDue, formatAppointment, leadScore, mailReactionOf, messageValues, normalizePhone, normalizePipelineSettings, pickOwner, pipelineCsv, SMS_LIMIT, staleInfo, type DistributionRules, type MessageChannel, type PipelineSettings, type TaskKind, type TaskSource, type Temperature } from "../shared/pipeline-extras";
import { newCustomSourceKey, stagesOf as stagesOfSets } from "../shared/sales-pipeline";
import { contactedStage, entryStage, isStage, lostStage, PIPELINE_STAGES, pipelineSourceOf, stageLabel, stagesForLead, unionStages, wonStage, workingStage, type PipelineSource, type StageDef, type StageSets } from "../shared/sales-pipeline";
import { deliverMail } from "./email-onboarding";
import type { Db } from "./lead-pipeline";

type LeadRow = typeof leads.$inferSelect;
const metaOf = (lead: { metadata: unknown }) => (lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata) ? (lead.metadata as Record<string, unknown>) : {});
/** Stufen je Pipeline: wo ein Lead bekannt ist, gelten die Stufen seiner Pipeline; ohne Lead der Standard („alle“). */
const stageSetsOf = async (db: Db, tenantId: number): Promise<StageSets> => { const { pipelineStageSets } = await import("./meta-ads"); return pipelineStageSets(db, tenantId); };
const stagesOf = async (db: Db, tenantId: number, source?: PipelineSource | "alle" | null): Promise<StageDef[]> => stagesOfSets(await stageSetsOf(db, tenantId), source ?? "alle");
const stagesOfLead = async (db: Db, tenantId: number, lead: { adPlatform?: string | null }) => stagesForLead(await stageSetsOf(db, tenantId), lead);
const leadByPublicId = async (db: Db, tenantId: number, publicId: string) => { const lead = (await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.publicId, publicId))).limit(1))[0]; if (!lead) throw new Error("Lead nicht gefunden."); return lead; };
const userName = async (db: Db, userId: number | null | undefined) => { if (!userId) return null; return (await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1))[0]?.name ?? null; };
const leadName = (lead: Pick<LeadRow, "firstName" | "lastName" | "company" | "publicId">) => `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || lead.company || lead.publicId;

/* ---------------------------------------------------------------- Einstellungen */
export async function loadSettings(db: Db, tenantId: number): Promise<PipelineSettings> {
  const row = (await db.select().from(pipelineSettings).where(eq(pipelineSettings.tenantId, tenantId)).limit(1))[0];
  return row ? normalizePipelineSettings(row.settings) : { ...DEFAULT_PIPELINE_SETTINGS };
}
export async function saveSettings(db: Db, tenantId: number, input: unknown) {
  // Eigene Pipelines werden über eigene Aktionen gepflegt – beim normalen Speichern der Einstellungen bleiben sie erhalten
  const raw = input && typeof input === "object" ? { ...(input as Record<string, unknown>) } : {};
  if (!("customPipelines" in raw)) raw.customPipelines = (await loadSettings(db, tenantId)).customPipelines;
  const settings = normalizePipelineSettings(raw);
  const existing = (await db.select({ id: pipelineSettings.id }).from(pipelineSettings).where(eq(pipelineSettings.tenantId, tenantId)).limit(1))[0];
  if (existing) await db.update(pipelineSettings).set({ settings }).where(eq(pipelineSettings.id, existing.id)); else await db.insert(pipelineSettings).values({ tenantId, settings });
  return settings;
}
/** Eigene Pipeline anlegen (funktioniert wie die Kaltakquise) – erscheint als weitere Karte oben in der Vertriebspipeline. */
export async function createCustomPipeline(db: Db, tenantId: number, label: string) {
  const name = label.trim().slice(0, 40); if (!name) throw new Error("Bitte einen Namen für die Pipeline angeben.");
  const settings = await loadSettings(db, tenantId);
  if (settings.customPipelines.length >= 20) throw new Error("Höchstens 20 eigene Pipelines.");
  if ([...settings.customPipelines.map((item) => item.label), "Kaltakquise", "E-Mail-Kampagne", "Meta Ads"].some((item) => item.toLowerCase() === name.toLowerCase())) throw new Error(`Eine Pipeline „${name}“ gibt es schon.`);
  let key = newCustomSourceKey(name); while (settings.customPipelines.some((item) => item.key === key)) key = newCustomSourceKey(name);
  await saveSettings(db, tenantId, { ...settings, customPipelines: [...settings.customPipelines, { key, label: name }], sourceOrder: [...settings.sourceOrder, key] });
  return { key, label: name };
}
export async function renameCustomPipeline(db: Db, tenantId: number, key: string, label: string) {
  const name = label.trim().slice(0, 40); if (!name) throw new Error("Bitte einen Namen angeben.");
  const settings = await loadSettings(db, tenantId); if (!settings.customPipelines.some((item) => item.key === key)) throw new Error("Diese Pipeline gibt es nicht.");
  await saveSettings(db, tenantId, { ...settings, customPipelines: settings.customPipelines.map((item) => item.key === key ? { ...item, label: name } : item) });
  return { key, label: name };
}
/** Eigene Pipeline löschen: ihre Karten wandern in die Kaltakquise (mit Liste und Verlauf), eigene Stufen werden entfernt. */
export async function deleteCustomPipeline(db: Db, tenantId: number, key: string, actorUserId: number | null) {
  const settings = await loadSettings(db, tenantId); const pipeline = settings.customPipelines.find((item) => item.key === key); if (!pipeline) throw new Error("Diese Pipeline gibt es nicht.");
  const rows = await db.select({ id: leads.id, stage: leads.pipelineStage }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.adPlatform, key)));
  const { pipelineStageSets } = await import("./meta-ads"); const sets = await pipelineStageSets(db, tenantId); const coldStages = stagesOfSets(sets, "kaltakquise");
  for (const row of rows) { const stage = row.stage && coldStages.some((item) => item.key === row.stage) ? row.stage : entryStage(coldStages); await db.update(leads).set({ adPlatform: "kaltakquise", pipelineStage: stage, pipelineUpdatedAt: new Date() }).where(eq(leads.id, row.id)); await db.insert(pipelineEvents).values({ tenantId, leadId: row.id, fromStage: row.stage, toStage: stage, actorUserId, note: `Pipeline „${pipeline.label}“ gelöscht – Karte in die Kaltakquise verschoben` }); }
  await db.delete(pipelineStageConfigs).where(and(eq(pipelineStageConfigs.tenantId, tenantId), eq(pipelineStageConfigs.source, key)));
  await saveSettings(db, tenantId, { ...settings, customPipelines: settings.customPipelines.filter((item) => item.key !== key), sourceOrder: settings.sourceOrder.filter((item) => item !== key) });
  return { key, moved: rows.length, label: pipeline.label };
}
async function nextCursor(db: Db, tenantId: number) {
  const existing = (await db.select({ id: pipelineSettings.id, cursor: pipelineSettings.distributionCursor }).from(pipelineSettings).where(eq(pipelineSettings.tenantId, tenantId)).limit(1))[0];
  if (!existing) { await db.insert(pipelineSettings).values({ tenantId, settings: DEFAULT_PIPELINE_SETTINGS, distributionCursor: 1 }); return 0; }
  await db.update(pipelineSettings).set({ distributionCursor: existing.cursor + 1 }).where(eq(pipelineSettings.id, existing.id)); return existing.cursor;
}

/* ---------------------------------------------------------------- Aufgaben & Wiedervorlagen */
export type TaskInput = { publicId?: string; leadId?: number; kind: TaskKind; title?: string | null; note?: string | null; dueAt: Date; ownerUserId?: number | null; source?: TaskSource; actorUserId: number | null };
/** Wiedervorlage-Datum am Lead = früheste offene Aufgabe. */
async function syncFollowUp(db: Db, tenantId: number, leadId: number) {
  const next = (await db.select({ dueAt: pipelineTasks.dueAt }).from(pipelineTasks).where(and(eq(pipelineTasks.tenantId, tenantId), eq(pipelineTasks.leadId, leadId), isNull(pipelineTasks.doneAt))).orderBy(asc(pipelineTasks.dueAt)).limit(1))[0];
  await db.update(leads).set({ followUpAt: next?.dueAt ?? null }).where(eq(leads.id, leadId));
}
export async function createTask(db: Db, tenantId: number, input: TaskInput) {
  const lead = input.publicId ? await leadByPublicId(db, tenantId, input.publicId) : (await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.id, input.leadId ?? 0))).limit(1))[0];
  if (!lead) throw new Error("Lead nicht gefunden.");
  const title = (input.title ?? "").trim().slice(0, 200) || `${input.kind === "anruf" ? "Anrufen" : input.kind === "email" ? "E-Mail schreiben" : input.kind === "termin" ? "Termin" : input.kind === "sms" ? "SMS senden" : input.kind === "whatsapp" ? "WhatsApp senden" : "Aufgabe"}: ${leadName(lead)}`;
  const inserted = await db.insert(pipelineTasks).values({ tenantId, leadId: lead.id, ownerUserId: input.ownerUserId ?? lead.ownerUserId ?? input.actorUserId ?? null, kind: input.kind, title, note: input.note?.trim().slice(0, 600) || null, dueAt: input.dueAt, source: input.source ?? "manuell", createdByUserId: input.actorUserId });
  const id = Number(inserted[0]?.insertId) || 0;
  await db.insert(pipelineEvents).values({ tenantId, leadId: lead.id, fromStage: null, toStage: "wiedervorlage", actorUserId: input.actorUserId, note: `${title} · fällig ${input.dueAt.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`.slice(0, 400) });
  await syncFollowUp(db, tenantId, lead.id);
  return { id, leadId: lead.id, title, dueAt: input.dueAt };
}
export async function completeTask(db: Db, tenantId: number, id: number, actorUserId: number | null, done = true) {
  const task = (await db.select().from(pipelineTasks).where(and(eq(pipelineTasks.id, id), eq(pipelineTasks.tenantId, tenantId))).limit(1))[0]; if (!task) throw new Error("Aufgabe nicht gefunden.");
  await db.update(pipelineTasks).set({ doneAt: done ? new Date() : null }).where(eq(pipelineTasks.id, id));
  if (done) await db.insert(pipelineEvents).values({ tenantId, leadId: task.leadId, fromStage: null, toStage: "erledigt", actorUserId, note: `Erledigt: ${task.title}`.slice(0, 400) });
  await syncFollowUp(db, tenantId, task.leadId);
  return { success: true as const };
}
export async function snoozeTask(db: Db, tenantId: number, id: number, dueAt: Date) {
  const task = (await db.select().from(pipelineTasks).where(and(eq(pipelineTasks.id, id), eq(pipelineTasks.tenantId, tenantId))).limit(1))[0]; if (!task) throw new Error("Aufgabe nicht gefunden.");
  await db.update(pipelineTasks).set({ dueAt }).where(eq(pipelineTasks.id, id)); await syncFollowUp(db, tenantId, task.leadId); return { success: true as const, dueAt };
}
export async function deleteTask(db: Db, tenantId: number, id: number) {
  const task = (await db.select().from(pipelineTasks).where(and(eq(pipelineTasks.id, id), eq(pipelineTasks.tenantId, tenantId))).limit(1))[0]; if (!task) return { success: true as const };
  await db.delete(pipelineTasks).where(eq(pipelineTasks.id, id)); await syncFollowUp(db, tenantId, task.leadId); return { success: true as const };
}
export type TaskListItem = { id: number; kind: TaskKind; title: string; note: string | null; dueAt: Date; doneAt: Date | null; source: string; ownerUserId: number | null; ownerName: string | null; lead: { id: number; publicId: string; name: string; company: string | null; phone: string | null; email: string | null; city: string | null; stage: string | null; categoryName: string | null } };
export async function listTasks(db: Db, tenantId: number, options: { ownerUserId?: number | "ohne" | null; publicId?: string | null; includeDone?: boolean; until?: Date | null; limit?: number } = {}): Promise<TaskListItem[]> {
  const conditions = [eq(pipelineTasks.tenantId, tenantId)];
  if (!options.includeDone) conditions.push(isNull(pipelineTasks.doneAt)); if (options.until) conditions.push(lte(pipelineTasks.dueAt, options.until));
  if (options.publicId) conditions.push(eq(leads.publicId, options.publicId));
  if (options.ownerUserId === "ohne") conditions.push(isNull(pipelineTasks.ownerUserId)); else if (options.ownerUserId) conditions.push(eq(pipelineTasks.ownerUserId, options.ownerUserId));
  const rows = await db.select({ task: pipelineTasks, lead: leads, ownerName: users.name, categoryName: leadCategories.name }).from(pipelineTasks).innerJoin(leads, eq(leads.id, pipelineTasks.leadId)).leftJoin(users, eq(users.id, pipelineTasks.ownerUserId)).leftJoin(leadCategories, eq(leadCategories.id, leads.categoryId)).where(and(...conditions)).orderBy(asc(pipelineTasks.dueAt)).limit(options.limit ?? 500);
  return rows.map(({ task, lead, ownerName, categoryName }) => ({ id: task.id, kind: task.kind, title: task.title, note: task.note, dueAt: task.dueAt, doneAt: task.doneAt, source: task.source, ownerUserId: task.ownerUserId, ownerName: ownerName?.split(" ")[0] ?? null, lead: { id: lead.id, publicId: lead.publicId, name: leadName(lead), company: lead.company, phone: lead.phone, email: lead.email, city: lead.city, stage: lead.pipelineStage, categoryName } }));
}
/** „Heute fällig“: offene Aufgaben nach Fälligkeit + Termine der nächsten Tage. */
export async function dueList(db: Db, tenantId: number, options: { ownerUserId?: number | "ohne" | null; now?: Date } = {}) {
  const now = options.now ?? new Date(); const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  const tasks = await listTasks(db, tenantId, { ownerUserId: options.ownerUserId, until: weekEnd });
  const appointmentConditions = [eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), gte(leads.appointmentAt, new Date(now.getFullYear(), now.getMonth(), now.getDate())), lte(leads.appointmentAt, weekEnd)];
  if (options.ownerUserId === "ohne") appointmentConditions.push(isNull(leads.ownerUserId)); else if (options.ownerUserId) appointmentConditions.push(eq(leads.ownerUserId, options.ownerUserId));
  const appointmentRows = await db.select({ lead: leads, ownerName: users.name }).from(leads).leftJoin(users, eq(users.id, leads.ownerUserId)).where(and(...appointmentConditions)).orderBy(asc(leads.appointmentAt));
  const appointments = appointmentRows.map(({ lead, ownerName }) => ({ leadId: lead.id, publicId: lead.publicId, name: leadName(lead), company: lead.company, phone: lead.phone, email: lead.email, city: lead.city, postcode: lead.postcode, appointmentAt: lead.appointmentAt!, ownerUserId: lead.ownerUserId, ownerName: ownerName?.split(" ")[0] ?? null, stage: lead.pipelineStage }));
  const laterCount = (await db.select({ id: pipelineTasks.id }).from(pipelineTasks).where(and(eq(pipelineTasks.tenantId, tenantId), isNull(pipelineTasks.doneAt), gte(pipelineTasks.dueAt, weekEnd)))).length;
  return { now, tasks, appointments, laterCount };
}

/* ---------------------------------------------------------------- Termine & Angebotswert */
export async function setAppointment(db: Db, tenantId: number, input: { publicId: string; appointmentAt: Date | null; note?: string | null; durationMinutes?: number | null; location?: string | null; sendInvitation?: boolean; moveToStage?: boolean; actorUserId: number | null; appUrl?: string }) {
  const lead = await leadByPublicId(db, tenantId, input.publicId); const stages = await stagesOfLead(db, tenantId, lead);
  await db.update(leads).set({ appointmentAt: input.appointmentAt, metadata: { ...metaOf(lead), appointmentNote: input.note?.trim() || null, appointmentLocation: input.location?.trim() || null, appointmentDuration: input.durationMinutes ?? 60, appointmentReminderSentAt: null } }).where(eq(leads.id, lead.id));
  if (!input.appointmentAt) { await db.insert(pipelineEvents).values({ tenantId, leadId: lead.id, fromStage: null, toStage: "termin_entfernt", actorUserId: input.actorUserId, note: "Termin entfernt" }); return { success: true as const, invitation: null as null | { status: string; note: string | null } }; }
  const when = formatAppointment(input.appointmentAt);
  await db.insert(pipelineEvents).values({ tenantId, leadId: lead.id, fromStage: null, toStage: "termin_gesetzt", actorUserId: input.actorUserId, note: `Termin ${when}${input.location ? ` · ${input.location}` : ""}${input.note ? ` · ${input.note}` : ""}`.slice(0, 400) });
  // offene Termin-Aufgabe ersetzen
  await db.delete(pipelineTasks).where(and(eq(pipelineTasks.tenantId, tenantId), eq(pipelineTasks.leadId, lead.id), eq(pipelineTasks.kind, "termin"), isNull(pipelineTasks.doneAt), eq(pipelineTasks.source, "termin")));
  await db.insert(pipelineTasks).values({ tenantId, leadId: lead.id, ownerUserId: lead.ownerUserId ?? input.actorUserId, kind: "termin", title: `Termin mit ${leadName(lead)}`, note: [input.location, input.note].filter(Boolean).join(" · ").slice(0, 600) || null, dueAt: input.appointmentAt, source: "termin", createdByUserId: input.actorUserId });
  await syncFollowUp(db, tenantId, lead.id);
  // Stufe „Termin“ (die Stufe vor „Angebot“ bzw. die mit „termin“ im Schlüssel) – nur vorwärts
  if (input.moveToStage !== false) { const target = stages.find((stage) => /termin/i.test(stage.key) || /termin/i.test(stage.label)); const order = stages.map((stage) => stage.key); const current = isStage(lead.pipelineStage, stages) ? lead.pipelineStage : entryStage(stages); if (target && order.indexOf(target.key) > order.indexOf(current) && current !== wonStage(stages) && current !== lostStage(stages)) { const { moveStage } = await import("./meta-ads"); await moveStage(db, tenantId, { publicId: lead.publicId, stage: target.key, note: `Termin vereinbart: ${when}`, actorUserId: input.actorUserId }); } }
  let invitation: { status: string; note: string | null } | null = null;
  if (input.sendInvitation && lead.email) {
    const sender = await userName(db, input.actorUserId ?? lead.ownerUserId);
    const ics = buildIcs({ uid: `${lead.publicId}-${input.appointmentAt.getTime()}@tanesco-leads`, start: input.appointmentAt, durationMinutes: input.durationMinutes ?? 60, title: `Termin mit Tanesco Digital`, description: input.note ?? null, location: input.location ?? null, organizerName: sender ?? "Tanesco Digital", organizerEmail: process.env.SMTP_FROM?.replace(/.*<([^>]+)>.*/, "$1") ?? null, attendeeEmail: lead.email, attendeeName: leadName(lead) });
    const values = messageValues({ ...lead, appointmentAt: input.appointmentAt }, sender);
    const text = fillMessage(`Guten Tag {{anrede}} {{nachname}},\n\nhiermit bestätige ich unseren Termin am {{termin}}${input.location ? ` (${input.location})` : ""}. Der Kalendereintrag liegt bei.\n\nViele Grüße\n{{absender}}, Tanesco Digital`, values);
    const result = await deliverMail({ to: lead.email, subject: `Terminbestätigung: ${when}`, html: `<p>${text.replace(/\n/g, "<br>")}</p>`, text, attachments: [{ filename: "termin.ics", content: ics, contentType: "text/calendar; method=REQUEST" }] }, { db, tenantId });
    await db.insert(outboundMessages).values({ tenantId, leadId: lead.id, channel: "email", toAddress: lead.email, subject: `Terminbestätigung: ${when}`, text, templateKey: "termin_einladung", status: result.status, provider: "smtp", providerSid: result.messageId ?? null, error: result.ok ? null : result.note ?? null, createdByUserId: input.actorUserId });
    await db.insert(pipelineEvents).values({ tenantId, leadId: lead.id, fromStage: null, toStage: "email", actorUserId: input.actorUserId, note: `Einladung mit Kalendereintrag ${result.status === "gesendet" ? "gesendet" : result.status === "simuliert" ? "simuliert (kein Versand eingerichtet)" : "fehlgeschlagen"}` });
    invitation = { status: result.status, note: result.note ?? null };
  }
  return { success: true as const, invitation };
}
/** Telefon/E-Mail an der Karte nachtragen (z. B. Lead aus dem Posteingang ohne Nummer → Dialer nutzbar). */
export async function setContact(db: Db, tenantId: number, input: { publicId: string; phone?: string | null; email?: string | null; actorUserId: number | null }) {
  const lead = await leadByPublicId(db, tenantId, input.publicId); const patch: Partial<typeof leads.$inferInsert> = {}; const notes: string[] = [];
  if (input.phone !== undefined) { const phone = input.phone?.trim() || null; if (phone && !normalizePhone(phone)) throw new Error("Bitte eine gültige Telefonnummer angeben."); patch.phone = phone; notes.push(phone ? `Telefon ${lead.phone ? "geändert" : "nachgetragen"}: ${phone}` : "Telefon entfernt"); }
  if (input.email !== undefined) { const email = input.email?.trim().toLowerCase() || null; if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Bitte eine gültige E-Mail-Adresse angeben."); patch.email = email; notes.push(email ? `E-Mail ${lead.email ? "geändert" : "nachgetragen"}: ${email}` : "E-Mail entfernt"); }
  if (!notes.length) return { success: true as const, phone: lead.phone, email: lead.email };
  await db.update(leads).set(patch).where(eq(leads.id, lead.id));
  await db.insert(pipelineEvents).values({ tenantId, leadId: lead.id, fromStage: null, toStage: "kontakt", actorUserId: input.actorUserId, note: notes.join(" · ").slice(0, 400) });
  return { success: true as const, phone: patch.phone ?? lead.phone, email: patch.email ?? lead.email };
}
export async function setDealValue(db: Db, tenantId: number, input: { publicId: string; dealValue: number | null; actorUserId: number | null }) {
  const lead = await leadByPublicId(db, tenantId, input.publicId); const value = input.dealValue === null ? null : Math.max(0, Math.round(input.dealValue * 100) / 100);
  await db.update(leads).set({ dealValue: value === null ? null : value.toFixed(2) }).where(eq(leads.id, lead.id));
  await db.insert(pipelineEvents).values({ tenantId, leadId: lead.id, fromStage: null, toStage: "angebotswert", actorUserId: input.actorUserId, note: value === null ? "Angebotswert entfernt" : `Angebotswert ${value.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}` });
  return { success: true as const, dealValue: value };
}

/* ---------------------------------------------------------------- Nachrichten (SMS / WhatsApp / Einzel-E-Mail) */
async function smsSender(db: Db, tenantId: number) {
  const { providerFor } = await import("./dialer"); const { provider, settings } = await providerFor(db, tenantId);
  const numbers = await db.select().from(phoneNumbers).where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "aktiv"))).orderBy(asc(phoneNumbers.id));
  const from = numbers.find((number) => number.id === settings.defaultNumberId) ?? numbers.find((number) => number.numberType === "mobil") ?? numbers[0];
  return { provider, from: from?.e164 ?? null };
}
export type MessageInput = { publicId: string; channel: MessageChannel; text: string; subject?: string | null; templateKey?: string | null; campaignId?: number | null; nodeId?: string | null; actorUserId: number | null; appUrl?: string };
export async function sendLeadMessage(db: Db, tenantId: number, input: MessageInput) {
  const lead = await leadByPublicId(db, tenantId, input.publicId);
  const category = (await db.select({ name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.id, lead.categoryId)).limit(1))[0];
  const sender = await userName(db, input.actorUserId ?? lead.ownerUserId);
  const values = { ...messageValues({ ...lead, categoryName: category?.name ?? null }, sender), ...recipientValues({ firstName: lead.firstName, lastName: lead.lastName, company: lead.company, city: lead.city, salutation: (metaOf(lead).salutation as string | undefined) ?? null, email: lead.email, fields: extraFieldsOf(lead.metadata) }) };
  let status: "gesendet" | "simuliert" | "fehlgeschlagen" | "link" = "simuliert"; let providerName: string | null = null; let providerSid: string | null = null; let error: string | null = null; let toAddress = ""; let text = fillMessage(input.text, values); let subject: string | null = null; let link: string | null = null;
  if (input.channel === "email") {
    if (!lead.email) throw new Error("Der Kontakt hat keine E-Mail-Adresse.");
    if (await isSuppressed(db, tenantId, lead.email)) throw new Error("Diese Adresse steht auf der Sperrliste (Bounce/Beschwerde/Abmeldung).");
    toAddress = lead.email; let html: string;
    if (input.campaignId && input.nodeId) {
      const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, input.campaignId), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!campaign) throw new Error("Vorlage nicht gefunden.");
      const node = ((campaign.tree as EmailTree | null)?.nodes ?? []).find((item): item is Extract<EmailNode, { type: "send" }> => item.id === input.nodeId && item.type === "send"); if (!node) throw new Error("E-Mail in der Vorlage nicht gefunden.");
      const { signatureFor: loadSignature } = await import("./mail-settings"); const campaignSignature = await loadSignature(db, tenantId, input.appUrl ?? null).then((result) => ({ html: result.html, text: result.text })).catch(() => null);
      const rendered = renderNode(node, { ...DEFAULT_DESIGN, ...((campaign.design ?? {}) as Partial<EmailDesign>) }, values, { logoBase: (input.appUrl ?? process.env.APP_URL ?? "").replace(/\/+$/, ""), unsubscribeUrl: null, signature: campaignSignature });
      subject = rendered.subject; html = rendered.html; text = rendered.text;
    } else { subject = fillMessage(input.subject?.trim() || "Nachricht von Tanesco Digital", values); if (!text) throw new Error("Bitte einen Text eingeben."); const { signatureFor } = await import("./mail-settings"); const signature = await signatureFor(db, tenantId, input.appUrl ?? null); html = `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">${text.replace(/\n/g, "<br>")}</p>${signature.html}`; text = `${text}${signature.text}`; } // freie E-Mail aus der Karte bekommt die Signatur wie eine Posteingangs-Antwort
    const result = await deliverMail({ to: lead.email, subject, html, text }, { db, tenantId }); status = result.status; providerName = "smtp"; providerSid = result.messageId ?? null; error = result.ok ? null : result.note ?? null;
  } else {
    const phone = normalizePhone(lead.phone); if (!phone) throw new Error("Der Kontakt hat keine gültige Telefonnummer.");
    if (!text) throw new Error("Bitte einen Text eingeben."); if (text.length > SMS_LIMIT) throw new Error(`Die Nachricht ist zu lang (max. ${SMS_LIMIT} Zeichen).`);
    toAddress = phone;
    if (input.channel === "whatsapp" && !input.campaignId) { // WhatsApp: Link öffnen, Nachricht ist vorausgefüllt (sipgate verschickt keine WhatsApp-Nachrichten)
      status = "link"; link = `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
    } else {
      const sender = await smsSender(db, tenantId); providerName = sender.provider.name;
      if (!sender.from) { status = "fehlgeschlagen"; error = "Keine eigene Rufnummer vorhanden (Telefonie → Rufnummern)."; }
      else { try { const result = await sender.provider.sendMessage({ channel: input.channel, from: sender.from, to: phone, body: text }); status = result.status; providerSid = result.providerMessageSid; } catch (caught) { status = "fehlgeschlagen"; error = caught instanceof Error ? caught.message.slice(0, 400) : "Versand fehlgeschlagen"; } }
    }
  }
  const inserted = await db.insert(outboundMessages).values({ tenantId, leadId: lead.id, channel: input.channel, toAddress, subject, text: text.slice(0, 20000), templateKey: input.templateKey ?? (input.nodeId ? `vorlage:${input.campaignId}/${input.nodeId}` : null), status, provider: providerName, providerSid, error, createdByUserId: input.actorUserId });
  const label = CHANNEL_LABELS[input.channel];
  await db.insert(pipelineEvents).values({ tenantId, leadId: lead.id, fromStage: null, toStage: input.channel, actorUserId: input.actorUserId, note: `${label} ${status === "gesendet" ? "gesendet" : status === "simuliert" ? "simuliert (kein Versand eingerichtet)" : status === "link" ? "vorbereitet (Link geöffnet)" : "fehlgeschlagen"}${subject ? `: „${subject}“` : `: „${text.slice(0, 80)}${text.length > 80 ? "…" : ""}“`}`.slice(0, 400) });
  // erste Nachricht = Kontakt aufgenommen → aus der Eingangsstufe heraus
  const stages = await stagesOfLead(db, tenantId, lead); const current = isStage(lead.pipelineStage, stages) ? lead.pipelineStage : entryStage(stages);
  // Erste Nachricht aus „Neu“ → „Kontaktiert“ (Kontakt hergestellt); gibt es die Stufe nicht, die nächste nach dem Eingang
  const firstTarget = contactedStage(stages) ?? (stages[1] && stages[1].fixed !== "lost" ? stages[1].key : null);
  if (status !== "fehlgeschlagen" && current === entryStage(stages) && firstTarget) { const { moveStage } = await import("./meta-ads"); await moveStage(db, tenantId, { publicId: lead.publicId, stage: firstTarget, note: `Erste Nachricht per ${label}`, actorUserId: input.actorUserId }); }
  if (status === "fehlgeschlagen") throw new Error(error ?? `${label} konnte nicht gesendet werden.`);
  return { id: Number(inserted[0]?.insertId) || 0, status, link, error, subject, text, to: toAddress };
}
export async function listMessages(db: Db, tenantId: number, publicId: string) {
  const lead = (await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.publicId, publicId))).limit(1))[0]; if (!lead) return [];
  const rows = await db.select({ message: outboundMessages, author: users.name }).from(outboundMessages).leftJoin(users, eq(users.id, outboundMessages.createdByUserId)).where(and(eq(outboundMessages.tenantId, tenantId), eq(outboundMessages.leadId, lead.id))).orderBy(desc(outboundMessages.createdAt)).limit(50);
  return rows.map(({ message, author }) => ({ id: message.id, channel: message.channel, to: message.toAddress, subject: message.subject, text: message.text, status: message.status, error: message.error, author: author?.split(" ")[0] ?? "Automatik", createdAt: message.createdAt }));
}
/** Ein Eintrag im E-Mail-Verlauf eines Leads: eingegangene Mail, unsere Antwort aus dem Posteingang, Einzel-E-Mail aus der Karte oder Versand aus einer E-Mail-Serie. */
export type EmailThreadItem = { key: string; kind: "eingang" | "antwort" | "einzel" | "serie"; direction: "ein" | "aus"; at: Date; subject: string | null; text: string | null; who: string | null; address: string | null; status: string | null; aiKind: string | null; blocked: boolean; campaignName: string | null };

/** E-Mail-Verlauf eines Leads: alles, was mit dieser Adresse per Mail hin- und herging – auch aus der Zeit vor dem Anlegen des Leads (über die E-Mail-Adresse zugeordnet). Älteste zuerst. */
export async function emailThread(db: Db, tenantId: number, publicId: string): Promise<{ items: EmailThreadItem[]; email: string | null; before: number; leadCreatedAt: Date | null }> {
  const lead = (await db.select({ id: leads.id, email: leads.email, createdAt: leads.createdAt }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.publicId, publicId))).limit(1))[0];
  if (!lead) return { items: [], email: null, before: 0, leadCreatedAt: null };
  const address = lead.email?.trim().toLowerCase() || null;
  const byLead = (col: MySqlColumn, addrCol: MySqlColumn) => address ? or(eq(col, lead.id), eq(addrCol, address)) : eq(col, lead.id);
  const [incoming, outgoing, sends] = await Promise.all([
    db.select().from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), byLead(inboxMessages.leadId, inboxMessages.fromEmail))).orderBy(asc(inboxMessages.receivedAt)).limit(200),
    db.select({ message: outboundMessages, author: users.name }).from(outboundMessages).leftJoin(users, eq(users.id, outboundMessages.createdByUserId)).where(and(eq(outboundMessages.tenantId, tenantId), eq(outboundMessages.channel, "email"), byLead(outboundMessages.leadId, outboundMessages.toAddress))).orderBy(asc(outboundMessages.createdAt)).limit(200),
    db.select({ event: emailCampaignEvents, campaignName: emailCampaigns.name, email: emailCampaignRecipients.email }).from(emailCampaignEvents).innerJoin(emailCampaignRecipients, eq(emailCampaignRecipients.id, emailCampaignEvents.recipientId)).innerJoin(emailCampaigns, eq(emailCampaigns.id, emailCampaignEvents.campaignId)).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.kind, "gesendet"), byLead(emailCampaignRecipients.leadId, emailCampaignRecipients.email))).orderBy(asc(emailCampaignEvents.createdAt)).limit(200),
  ]);
  const items: EmailThreadItem[] = [
    ...incoming.map((row): EmailThreadItem => ({ key: `ein-${row.id}`, kind: "eingang", direction: "ein", at: row.receivedAt, subject: row.subject, text: row.bodyText, who: row.fromName ?? row.fromEmail, address: row.fromEmail, status: row.isRead ? "gelesen" : "ungelesen", aiKind: row.aiKind, blocked: row.blocked, campaignName: null })),
    ...outgoing.map(({ message, author }): EmailThreadItem => ({ key: `aus-${message.id}`, kind: message.inboxMessageId ? "antwort" : "einzel", direction: "aus", at: message.createdAt, subject: message.subject, text: message.text, who: author ?? "Automatik", address: message.toAddress, status: message.status, aiKind: null, blocked: false, campaignName: null })),
    ...sends.map(({ event, campaignName, email }): EmailThreadItem => ({ key: `serie-${event.id}`, kind: "serie", direction: "aus", at: event.createdAt, subject: event.subject, text: event.note, who: campaignName, address: email, status: "gesendet", aiKind: null, blocked: false, campaignName })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  return { items, email: address, before: items.filter((item) => item.at < lead.createdAt).length, leadCreatedAt: lead.createdAt };
}

/** Alle E-Mails aus Kampagnen und Vorlagen – als Auswahl für die Einzel-E-Mail aus der Karte. */
export async function emailSendNodes(db: Db, tenantId: number) {
  const rows = await db.select({ id: emailCampaigns.id, name: emailCampaigns.name, tree: emailCampaigns.tree, isTemplate: emailCampaigns.isTemplate }).from(emailCampaigns).where(eq(emailCampaigns.tenantId, tenantId)).orderBy(desc(emailCampaigns.isTemplate), desc(emailCampaigns.updatedAt));
  return rows.flatMap((row) => (((row.tree as EmailTree | null)?.nodes ?? []).filter((node): node is Extract<EmailNode, { type: "send" }> => node.type === "send")).map((node) => ({ campaignId: row.id, campaignName: row.name, isTemplate: row.isTemplate, nodeId: node.id, label: node.label ?? node.subject, subject: node.subject })));
}

/* ---------------------------------------------------------------- Sperrliste (Bounces/Beschwerden/Abmeldungen/Posteingang) */
export type SuppressionReason = "bounce" | "beschwerde" | "abgemeldet" | "gesperrt" | "manuell";
const SUPPRESSION_SOURCES: Record<SuppressionReason, string> = { bounce: "Mail-Anbieter", beschwerde: "Mail-Anbieter", abgemeldet: "Abmelde-Link", gesperrt: "Posteingang", manuell: "Von Hand" };
export async function isSuppressed(db: Db, tenantId: number, email: string) { return Boolean((await db.select({ id: emailSuppressions.id }).from(emailSuppressions).where(and(eq(emailSuppressions.tenantId, tenantId), eq(emailSuppressions.email, email.toLowerCase()))).limit(1))[0]); }
export async function suppressedSet(db: Db, tenantId: number) { return new Set((await db.select({ email: emailSuppressions.email }).from(emailSuppressions).where(eq(emailSuppressions.tenantId, tenantId))).map((row) => row.email)); }
/** Sperrliste als Protokoll: alle Einträge (neueste zuerst) plus Zähler je Unterliste (Bounces, Abmeldungen, Beschwerden, Posteingang, Manuell). */
export async function listSuppressions(db: Db, tenantId: number) {
  const rows = await db.select().from(emailSuppressions).where(eq(emailSuppressions.tenantId, tenantId)).orderBy(desc(emailSuppressions.createdAt)).limit(2000);
  return { items: rows, counts: suppressionCounts(rows) };
}
export function suppressionCounts(rows: Array<{ reason: SuppressionReason }>) { const counts = { alle: rows.length, bounce: 0, abgemeldet: 0, beschwerde: 0, gesperrt: 0, manuell: 0 }; for (const row of rows) counts[row.reason] += 1; return counts; }
export async function addSuppression(db: Db, tenantId: number, input: { email: string; reason: SuppressionReason; note?: string | null; source?: string | null }) {
  const email = input.email.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Bitte eine gültige E-Mail-Adresse angeben.");
  const existing = (await db.select({ id: emailSuppressions.id }).from(emailSuppressions).where(and(eq(emailSuppressions.tenantId, tenantId), eq(emailSuppressions.email, email))).limit(1))[0];
  const source = input.source?.slice(0, 160) ?? SUPPRESSION_SOURCES[input.reason];
  if (existing) await db.update(emailSuppressions).set({ reason: input.reason, note: input.note?.slice(0, 400) ?? null, source, createdAt: new Date() }).where(eq(emailSuppressions.id, existing.id)); else await db.insert(emailSuppressions).values({ tenantId, email, reason: input.reason, note: input.note?.slice(0, 400) ?? null, source });
  // laufende Serien für diese Adresse stoppen
  const status = input.reason === "bounce" ? "bounce" : input.reason === "beschwerde" ? "beschwerde" : "abgemeldet";
  const open = await db.select({ id: emailCampaignRecipients.id }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.email, email), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"])));
  if (open.length) await db.update(emailCampaignRecipients).set({ status, nextActionAt: null, ...(input.reason === "bounce" || input.reason === "beschwerde" ? { bouncedAt: new Date() } : {}) }).where(inArray(emailCampaignRecipients.id, open.map((row) => row.id)));
  return { email, stopped: open.length };
}
export async function removeSuppressionByEmail(db: Db, tenantId: number, email: string) { await db.delete(emailSuppressions).where(and(eq(emailSuppressions.tenantId, tenantId), eq(emailSuppressions.email, email.trim().toLowerCase()))); return { success: true as const }; }
export async function removeSuppression(db: Db, tenantId: number, id: number) { await db.delete(emailSuppressions).where(and(eq(emailSuppressions.id, id), eq(emailSuppressions.tenantId, tenantId))); return { success: true as const }; }
/** Bounce/Beschwerde zu einem Empfänger (Knopf in der Kampagne oder Webhook des Mail-Anbieters): Empfänger stoppen, Adresse sperren. */
export async function markBounced(db: Db, tenantId: number, input: { recipientId?: number | null; email?: string | null; kind: "bounce" | "beschwerde"; note?: string | null }) {
  const recipient = input.recipientId ? (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.id, input.recipientId), eq(emailCampaignRecipients.tenantId, tenantId))).limit(1))[0] : input.email ? (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.email, input.email.toLowerCase()))).orderBy(desc(emailCampaignRecipients.createdAt)).limit(1))[0] : undefined;
  const email = recipient?.email ?? input.email?.toLowerCase(); if (!email) throw new Error("Empfänger nicht gefunden.");
  const campaignName = recipient ? (await db.select({ name: emailCampaigns.name }).from(emailCampaigns).where(eq(emailCampaigns.id, recipient.campaignId)).limit(1))[0]?.name ?? null : null;
  const result = await addSuppression(db, tenantId, { email, reason: input.kind, note: input.note ?? (input.kind === "bounce" ? "Unzustellbar gemeldet" : "Spam-Beschwerde gemeldet"), source: campaignName ? `Kampagne „${campaignName}“` : input.recipientId ? "Kampagne" : "Mail-Anbieter (Webhook)" });
  if (recipient) { await db.update(emailCampaignRecipients).set({ status: input.kind, nextActionAt: null, bouncedAt: new Date(), lastError: input.note ?? null }).where(eq(emailCampaignRecipients.id, recipient.id)); const { emailCampaignEvents } = await import("../drizzle/schema"); await db.insert(emailCampaignEvents).values({ tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: input.kind, note: input.kind === "bounce" ? "Unzustellbar – Adresse gesperrt" : "Beschwerde – Adresse gesperrt" }); }
  return { email, stopped: result.stopped + (recipient ? 1 : 0) };
}

/* ---------------------------------------------------------------- Automatik: Serien, Antworten, eingeschlafene Karten, Erinnerungen */
/** Lead in eine E-Mail-Kampagne aufnehmen (Nachfass-Serie); Entwürfe werden dabei aktiv. */
export async function enrollInCampaign(db: Db, tenantId: number, input: { leadId: number; campaignId: number; reason: string; appUrl?: string }) {
  const lead = (await db.select().from(leads).where(and(eq(leads.id, input.leadId), eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"))).limit(1))[0]; if (!lead?.email) return { enrolled: false, reason: "keine E-Mail" };
  const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, input.campaignId), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!campaign) return { enrolled: false, reason: "Kampagne fehlt" };
  const email = lead.email.toLowerCase(); if (await isSuppressed(db, tenantId, email)) return { enrolled: false, reason: "gesperrt" };
  const previous = await db.select({ status: emailCampaignRecipients.status, repliedAt: emailCampaignRecipients.repliedAt }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId, campaign.id), eq(emailCampaignRecipients.email, email)));
  const { canEnroll, maxRunsOf } = await import("../shared/email-campaigns"); const allowed = canEnroll(previous, maxRunsOf(campaign)); if (!allowed.ok) return { enrolled: false, reason: previous.length ? `bereits Empfänger (${allowed.reason})` : allowed.reason ?? "nicht erlaubt" };
  const count = (await db.select({ id: emailCampaignRecipients.id }).from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaign.id))).length;
  const { abVariantFor, hasAbTest } = await import("../shared/email-campaigns"); const tree = (campaign.tree ?? { start: null, nodes: [] }) as EmailTree;
  await db.insert(emailCampaignRecipients).values({ tenantId, campaignId: campaign.id, leadId: lead.id, email, name: leadName(lead), company: lead.company ?? null, token: crypto.randomBytes(16).toString("hex"), nodeId: tree.start, nextActionAt: new Date(Date.now() - 2000), status: "wartet", sentCount: 0, variant: hasAbTest(tree) ? abVariantFor(count, campaign.abSplit) : null });
  if (campaign.status !== "aktiv") await db.update(emailCampaigns).set({ status: "aktiv", startedAt: campaign.startedAt ?? new Date() }).where(eq(emailCampaigns.id, campaign.id));
  await db.insert(pipelineEvents).values({ tenantId, leadId: lead.id, fromStage: null, toStage: "serie", actorUserId: null, note: `In E-Mail-Serie „${campaign.name}“ aufgenommen (${input.reason})`.slice(0, 400) });
  const { processEmailCampaigns } = await import("./sales-outreach");
  void Promise.race([processEmailCampaigns(db, input.appUrl ?? process.env.APP_URL ?? "", { campaignId: campaign.id, limit: 10 }), new Promise((resolve) => setTimeout(resolve, 4000))]).catch(() => null);
  return { enrolled: true, reason: input.reason, campaignName: campaign.name };
}
/** Nach einem Stufenwechsel: Serie je Stufe (z. B. Angebot → Nachfass-Serie). */
export async function onStageChanged(db: Db, tenantId: number, input: { leadId: number; toStage: string; appUrl?: string }) {
  const settings = await loadSettings(db, tenantId); const campaignId = settings.stageCampaigns[input.toStage]; if (!campaignId) return null;
  const platform = (await db.select({ adPlatform: leads.adPlatform }).from(leads).where(eq(leads.id, input.leadId)).limit(1))[0]; const stages = await stagesOfLead(db, tenantId, { adPlatform: platform?.adPlatform ?? null }); return enrollInCampaign(db, tenantId, { leadId: input.leadId, campaignId, reason: `Stufe „${stageLabel(input.toStage, stages)}“`, appUrl: input.appUrl });
}
/** Nach einem Anruf-Ergebnis: Serie je Ergebnis + Wiedervorlage/Aufgabe. */
export async function onDisposition(db: Db, tenantId: number, input: { leadId: number; disposition: string; followUpMinutes?: number | null; actorUserId: number | null; appUrl?: string }) {
  const settings = await loadSettings(db, tenantId); const out: { enrolled?: string | null; task?: string | null } = {};
  const campaignId = settings.dispositionCampaigns[input.disposition]; if (campaignId) { const result = await enrollInCampaign(db, tenantId, { leadId: input.leadId, campaignId, reason: `Anruf-Ergebnis „${input.disposition}“`, appUrl: input.appUrl }); out.enrolled = result.enrolled ? result.campaignName ?? null : null; }
  if (settings.dispositionTasks) {
    const now = new Date();
    if (input.disposition === "wiedervorlage") { const task = await createTask(db, tenantId, { leadId: input.leadId, kind: "anruf", title: "Rückruf (Wiedervorlage aus dem Dialer)", dueAt: followUpDue(now, input.followUpMinutes), source: "dialer", actorUserId: input.actorUserId }); out.task = task.title; }
    else if (input.disposition === "interessiert") { const task = await createTask(db, tenantId, { leadId: input.leadId, kind: "email", title: "Angebot / Unterlagen schicken", dueAt: followUpDue(now, 24 * 60), source: "dialer", actorUserId: input.actorUserId }); out.task = task.title; }
    else if (input.disposition === "nicht_erreicht") { const task = await createTask(db, tenantId, { leadId: input.leadId, kind: "anruf", title: "Erneut versuchen (nicht erreicht)", dueAt: followUpDue(now, input.followUpMinutes ?? 240), source: "dialer", actorUserId: input.actorUserId }); out.task = task.title; }
  }
  return out;
}
/** Antwort im Posteingang: Karte auf die eingestellte Stufe (nur vorwärts, nie aus Kunde/Verloren). */
export async function onInboxReply(db: Db, tenantId: number, input: { leadId: number; subject?: string | null }) {
  const settings = await loadSettings(db, tenantId); if (!settings.replyStage) return null;
  const lead = (await db.select().from(leads).where(eq(leads.id, input.leadId)).limit(1))[0]; if (!lead) return null;
  const stages = await stagesOfLead(db, tenantId, lead); if (!isStage(settings.replyStage, stages)) return null;
  const current = isStage(lead.pipelineStage, stages) ? lead.pipelineStage : entryStage(stages); const order = stages.map((stage) => stage.key);
  if (current === wonStage(stages) || current === lostStage(stages) || order.indexOf(settings.replyStage) <= order.indexOf(current)) return null;
  const { moveStage } = await import("./meta-ads"); await moveStage(db, tenantId, { publicId: lead.publicId, stage: settings.replyStage, note: `Antwort auf E-Mail-Serie: „${(input.subject ?? "").slice(0, 120)}“`, actorUserId: null });
  return settings.replyStage;
}
/** Letzte Aktivität je Karte (Stufenwechsel, Notiz, erledigte Aufgabe, Nachricht). */
export async function lastActivityMap(db: Db, tenantId: number, leadIds: number[]) {
  const map = new Map<number, Date>(); if (!leadIds.length) return map; const bump = (id: number, at: Date | null | undefined) => { if (!at) return; const current = map.get(id); if (!current || at > current) map.set(id, at); };
  for (const row of await db.select({ leadId: pipelineEvents.leadId, createdAt: pipelineEvents.createdAt }).from(pipelineEvents).where(and(eq(pipelineEvents.tenantId, tenantId), inArray(pipelineEvents.leadId, leadIds)))) bump(row.leadId, row.createdAt);
  for (const row of await db.select({ leadId: pipelineNotes.leadId, createdAt: pipelineNotes.createdAt }).from(pipelineNotes).where(and(eq(pipelineNotes.tenantId, tenantId), inArray(pipelineNotes.leadId, leadIds)))) bump(row.leadId, row.createdAt);
  for (const row of await db.select({ leadId: pipelineTasks.leadId, doneAt: pipelineTasks.doneAt }).from(pipelineTasks).where(and(eq(pipelineTasks.tenantId, tenantId), inArray(pipelineTasks.leadId, leadIds)))) bump(row.leadId, row.doneAt);
  for (const row of await db.select({ leadId: outboundMessages.leadId, createdAt: outboundMessages.createdAt }).from(outboundMessages).where(and(eq(outboundMessages.tenantId, tenantId), inArray(outboundMessages.leadId, leadIds)))) { if (row.leadId != null) bump(row.leadId, row.createdAt); }
  for (const row of await db.select({ leadId: leadCallAttempts.leadId, at: leadCallAttempts.at }).from(leadCallAttempts).where(and(eq(leadCallAttempts.tenantId, tenantId), inArray(leadCallAttempts.leadId, leadIds)))) bump(row.leadId, row.at);
  return map;
}
/* ---------------------------------------------------------------- Anrufzähler (Anrufversuche je Karte) */
export type CallCounter = { count: number; reached: number; lastAt: Date | null; lastResult: string | null; lastBy: string | null };
const EMPTY_CALLS: CallCounter = { count: 0, reached: 0, lastAt: null, lastResult: null, lastBy: null };
/** Zähler je Kontakt: Anzahl, erreicht, letzter Versuch (wann, Ergebnis, wer). */
export async function callCountsMap(db: Db, tenantId: number, leadIds: number[]) {
  const map = new Map<number, CallCounter>(); if (!leadIds.length) return map;
  const rows = await db.select({ leadId: leadCallAttempts.leadId, result: leadCallAttempts.result, at: leadCallAttempts.at, user: users.name }).from(leadCallAttempts).leftJoin(users, eq(users.id, leadCallAttempts.userId)).where(and(eq(leadCallAttempts.tenantId, tenantId), inArray(leadCallAttempts.leadId, leadIds))).orderBy(desc(leadCallAttempts.at), desc(leadCallAttempts.id));
  for (const row of rows) {
    const current = map.get(row.leadId) ?? { ...EMPTY_CALLS };
    current.count += 1; if (CALL_RESULTS.find((item) => item.key === row.result)?.reached) current.reached += 1;
    if (!current.lastAt) { current.lastAt = row.at; current.lastResult = row.result; current.lastBy = row.user ? row.user.split(/\s+/)[0] : null; }
    map.set(row.leadId, current);
  }
  return map;
}
/** Liste der Versuche eines Kontakts (neueste zuerst) für die Lead-Seite. */
export async function callAttempts(db: Db, tenantId: number, publicId: string) {
  const lead = await leadByPublicId(db, tenantId, publicId);
  const rows = await db.select({ attempt: leadCallAttempts, user: users.name }).from(leadCallAttempts).leftJoin(users, eq(users.id, leadCallAttempts.userId)).where(and(eq(leadCallAttempts.tenantId, tenantId), eq(leadCallAttempts.leadId, lead.id))).orderBy(desc(leadCallAttempts.at), desc(leadCallAttempts.id)).limit(100);
  const counter = (await callCountsMap(db, tenantId, [lead.id])).get(lead.id) ?? EMPTY_CALLS;
  return { ...counter, attempts: rows.map(({ attempt, user }) => ({ id: attempt.id, at: attempt.at, result: attempt.result, label: callResultLabel(attempt.result), note: attempt.note, by: user ? user.split(/\s+/)[0] : null, fromDialer: Boolean(attempt.dialerCallId) })) };
}
/**
 * Anrufversuch festhalten („+ Anruf“ an der Karte): zählt hoch, steht im Verlauf, und die Karte rutscht von „Neu“ nach
 * „In Bearbeitung“ (beim ersten Versuch) bzw. nach „Kontaktiert“, sobald jemand erreicht wurde – ohne Hin- und Herschieben.
 * Ein Rückruf-Termin wird als Aufgabe angelegt. Dialer-Anrufe landen über recordDialerAttempt automatisch hier.
 */
export async function logCallAttempt(db: Db, tenantId: number, input: { publicId?: string; leadId?: number; result: string; note?: string | null; at?: Date | null; followUpAt?: Date | null; dialerCallId?: number | null; actorUserId: number | null; move?: boolean }) {
  if (!isCallResult(input.result)) throw new Error("Unbekanntes Anruf-Ergebnis.");
  const lead = input.publicId ? await leadByPublicId(db, tenantId, input.publicId) : (await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.id, input.leadId ?? 0))).limit(1))[0];
  if (!lead) throw new Error("Lead nicht gefunden.");
  const at = input.at ?? new Date(); const note = input.note?.trim().slice(0, 320) || null;
  const attemptInsert = await db.insert(leadCallAttempts).values({ tenantId, leadId: lead.id, userId: input.actorUserId, dialerCallId: input.dialerCallId ?? null, result: input.result, note, at }); const attemptId = Number(attemptInsert[0]?.insertId) || 0;
  const counter = (await callCountsMap(db, tenantId, [lead.id])).get(lead.id) ?? EMPTY_CALLS;
  const label = callResultLabel(input.result);
  const eventInsert = await db.insert(pipelineEvents).values({ tenantId, leadId: lead.id, fromStage: null, toStage: "anruf", actorUserId: input.actorUserId, note: `Anruf ${counter.count}: ${label}${note ? ` – ${note}` : ""}`.slice(0, 400), createdAt: at }); const eventId = Number(eventInsert[0]?.insertId) || 0;
  // Stufe automatisch: Neu → In Bearbeitung (erster Versuch), erreicht → Kontaktiert
  let moved: string | null = null;
  if (input.move !== false) {
    const stagesDef = await stagesOfLead(db, tenantId, lead); const current = isStage(lead.pipelineStage, stagesDef) ? lead.pipelineStage : entryStage(stagesDef);
    const working = workingStage(stagesDef); const contacted = contactedStage(stagesDef); const reached = CALL_RESULTS.find((item) => item.key === input.result)?.reached ?? false;
    // Erreicht → immer nach „Kontaktiert“/„In Kontakt“, solange die Karte noch davor steht (nie zurück, nie aus Kunde/Verloren)
    const position = (key: string | null) => stagesDef.findIndex((stage) => stage.key === key); const currentDef = stagesDef.find((stage) => stage.key === current);
    const beforeContacted = contacted !== null && !currentDef?.fixed?.match(/won|lost/) && position(current) < position(contacted);
    const target = reached && contacted && beforeContacted ? contacted : !reached && working && current === entryStage(stagesDef) ? working : null;
    if (target && target !== current) { const { moveStage } = await import("./meta-ads"); await moveStage(db, tenantId, { publicId: lead.publicId, stage: target, note: reached ? `Erreicht (Anruf ${counter.count})` : `Erster Anrufversuch (${label})`, actorUserId: input.actorUserId }); moved = target; }
  }
  const task = input.followUpAt ? await createTask(db, tenantId, { leadId: lead.id, kind: "anruf", title: input.result === "rueckruf" ? "Rückruf wie vereinbart" : "Erneut anrufen", note, dueAt: input.followUpAt, source: "manuell", actorUserId: input.actorUserId }) : null;
  const { recordUndo } = await import("./undo");
  const undoId = await recordUndo(db, tenantId, { kind: "anruf", title: `${leadName(lead)}: Anruf ${counter.count} – ${label}${moved ? " (Stufe geändert)" : ""}`, actorUserId: input.actorUserId, payload: { attemptId, eventId, leadId: lead.id, taskId: task?.id ?? null, movedFrom: moved ? (isStage(lead.pipelineStage, await stagesOfLead(db, tenantId, lead)) ? lead.pipelineStage : null) : null, movedTo: moved } }).catch(() => 0);
  return { count: counter.count, reached: counter.reached, result: input.result, moved, undoId };
}
/** Dialer-Anruf an einem Pipeline-Kontakt beendet → Versuch zählen (ohne doppelten Eintrag). */
export async function recordDialerAttempt(db: Db, tenantId: number, call: { id: number; leadId: number | null; agentUserId: number | null; status: string; disposition?: string | null; startedAt: Date }) {
  if (!call.leadId) return null;
  const { callResultOfDialer } = await import("../shared/pipeline-extras");
  const existing = (await db.select({ id: leadCallAttempts.id }).from(leadCallAttempts).where(and(eq(leadCallAttempts.tenantId, tenantId), eq(leadCallAttempts.dialerCallId, call.id))).limit(1))[0];
  const result = callResultOfDialer(call.status, call.disposition);
  if (existing) { await db.update(leadCallAttempts).set({ result }).where(eq(leadCallAttempts.id, existing.id)); return null; }
  return logCallAttempt(db, tenantId, { leadId: call.leadId, result, at: call.startedAt, dialerCallId: call.id, actorUserId: call.agentUserId, note: null }).catch(() => null);
}

/** Zusatzdaten je Karte für die Pipeline-Übersicht: Aufgaben, Aktivität, eingeschlafen – und die Temperatur („heiße Phasen“). */
export async function cardExtras(db: Db, tenantId: number, rows: Array<{ id: number; phone: string | null; email: string | null; company: string | null; pipelineStage: string | null; pipelineUpdatedAt: Date | null; createdAt: Date; ownerUserId: number | null; followUpAt: Date | null; appointmentAt: Date | null; dealValue: string | null; metadata: unknown; noteCount: number }>, stages: StageDef[], now = new Date()) {
  const settings = await loadSettings(db, tenantId); const ids = rows.map((row) => row.id); const activity = await lastActivityMap(db, tenantId, ids);
  const openTasks = ids.length ? await db.select({ leadId: pipelineTasks.leadId, dueAt: pipelineTasks.dueAt, title: pipelineTasks.title, kind: pipelineTasks.kind }).from(pipelineTasks).where(and(eq(pipelineTasks.tenantId, tenantId), inArray(pipelineTasks.leadId, ids), isNull(pipelineTasks.doneAt))).orderBy(asc(pipelineTasks.dueAt)) : [];
  // E-Mail-Reaktion je Kontakt: Serien-Einträge (geöffnet/geklickt/geantwortet/Bounce/abgemeldet) plus Antworten im Posteingang.
  const recipients = ids.length ? await db.select({ leadId: emailCampaignRecipients.leadId, openedAt: emailCampaignRecipients.openedAt, clickedAt: emailCampaignRecipients.clickedAt, repliedAt: emailCampaignRecipients.repliedAt, bouncedAt: emailCampaignRecipients.bouncedAt, status: emailCampaignRecipients.status }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), inArray(emailCampaignRecipients.leadId, ids))) : [];
  const replies = ids.length ? new Set((await db.select({ leadId: inboxMessages.leadId }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), inArray(inboxMessages.leadId, ids), eq(inboxMessages.blocked, false)))).map((row) => row.leadId)) : new Set<number | null>();
  const callMap = await callCountsMap(db, tenantId, ids);
  const out = new Map<number, { openTasks: number; nextTask: { title: string; dueAt: Date; kind: string } | null; lastActivityAt: Date; staleDays: number; stale: boolean; score: number; temperature: Temperature; scoreLabel: string; scoreReasons: string[]; calls: CallCounter }>();
  for (const row of rows) {
    const tasks = openTasks.filter((task) => task.leadId === row.id);
    const last = activity.get(row.id) ?? row.pipelineUpdatedAt ?? row.createdAt; const stale = staleInfo({ pipelineStage: row.pipelineStage, pipelineUpdatedAt: row.pipelineUpdatedAt, createdAt: row.createdAt, lastActivityAt: last }, now, settings.staleDays, stages);
    const meta = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as { lastCallDisposition?: unknown }) : {};
    const scored = leadScore({ phone: row.phone, email: row.email, company: row.company, pipelineStage: row.pipelineStage, stages, dealValue: row.dealValue, appointmentAt: row.appointmentAt, createdAt: row.createdAt, lastActivityAt: last, stale: stale.stale, staleDays: settings.staleDays, noteCount: row.noteCount, openTasks: tasks.length, mail: mailReactionOf(recipients.filter((item) => item.leadId === row.id), replies.has(row.id)), lastCallDisposition: typeof meta.lastCallDisposition === "string" ? meta.lastCallDisposition : null }, now);
    out.set(row.id, { openTasks: tasks.length, nextTask: tasks[0] ? { title: tasks[0].title, dueAt: tasks[0].dueAt, kind: tasks[0].kind } : null, lastActivityAt: last, staleDays: stale.days, stale: stale.stale, score: scored.score, temperature: scored.temperature, scoreLabel: scored.label, scoreReasons: scored.reasons, calls: callMap.get(row.id) ?? EMPTY_CALLS });
  }
  return { extras: out, settings };
}
/** Stammdaten eines Vertriebskontakts ändern (Lead-Seite): Anrede, Name, Firma, Telefon, E-Mail, PLZ/Ort, Kategorie – jede Änderung steht im Verlauf. */
export async function updateLead(db: Db, tenantId: number, input: { publicId: string; salutation?: string | null; firstName?: string | null; lastName?: string | null; company?: string | null; phone?: string | null; email?: string | null; postcode?: string | null; city?: string | null; categoryId?: number | null; actorUserId: number | null }) {
  const lead = await leadByPublicId(db, tenantId, input.publicId); const patch: Partial<typeof leads.$inferInsert> = {}; const notes: string[] = [];
  const text = (value: string | null | undefined, max: number) => (value ?? "").trim().slice(0, max) || null;
  if (input.phone !== undefined) { const phone = input.phone?.trim() || null; if (phone && !normalizePhone(phone)) throw new Error("Bitte eine gültige Telefonnummer angeben."); if (phone !== (lead.phone ?? null)) { patch.phone = phone; notes.push(phone ? `Telefon: ${phone}` : "Telefon entfernt"); } }
  if (input.email !== undefined) { const email = input.email?.trim().toLowerCase() || null; if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Bitte eine gültige E-Mail-Adresse angeben."); if (email !== (lead.email ?? null)) { patch.email = email; notes.push(email ? `E-Mail: ${email}` : "E-Mail entfernt"); } }
  if (input.firstName !== undefined || input.lastName !== undefined) { const firstName = input.firstName !== undefined ? text(input.firstName, 120) : lead.firstName; const lastName = input.lastName !== undefined ? text(input.lastName, 120) : lead.lastName; if (!firstName && !lastName) throw new Error("Bitte mindestens Vor- oder Nachname angeben."); if (firstName !== lead.firstName || lastName !== lead.lastName) { patch.firstName = firstName; patch.lastName = lastName; notes.push(`Name: ${[firstName, lastName].filter(Boolean).join(" ")}`); } }
  if (input.company !== undefined) { const company = text(input.company, 200); if (company !== (lead.company ?? null)) { patch.company = company; notes.push(company ? `Firma: ${company}` : "Firma entfernt"); } }
  if (input.postcode !== undefined || input.city !== undefined) { const postcode = input.postcode !== undefined ? text(input.postcode, 24) : lead.postcode; const city = input.city !== undefined ? text(input.city, 120) : lead.city; if (postcode !== lead.postcode || city !== lead.city) { patch.postcode = postcode; patch.city = city; notes.push(`Anschrift: ${[postcode, city].filter(Boolean).join(" ") || "–"}`); } }
  if (input.salutation !== undefined) { const salutation = input.salutation === "herr" || input.salutation === "frau" ? input.salutation : null; const meta = metaOf(lead); if ((meta.salutation ?? null) !== salutation) { patch.metadata = { ...meta, salutation }; notes.push(`Anrede: ${salutation === "herr" ? "Herr" : salutation === "frau" ? "Frau" : "–"}`); } }
  if (input.categoryId !== undefined && input.categoryId !== null && input.categoryId !== lead.categoryId) { const category = (await db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(and(eq(leadCategories.tenantId, tenantId), eq(leadCategories.id, input.categoryId))))[0]; if (!category) throw new Error("Kategorie nicht gefunden."); patch.categoryId = category.id; notes.push(`Kategorie: ${category.name}`); }
  if (!notes.length) return { success: true as const, changed: 0 };
  await db.update(leads).set(patch).where(eq(leads.id, lead.id));
  await db.insert(pipelineEvents).values({ tenantId, leadId: lead.id, fromStage: null, toStage: "kontakt", actorUserId: input.actorUserId, note: notes.join(" · ").slice(0, 400) });
  return { success: true as const, changed: notes.length };
}
/** Vertriebskontakt löschen (nur Art „vertrieb“): Aufgaben, Verlauf, Notizen, Nachrichten, Serien-Empfänger gehen mit; Posteingang und Anrufe verlieren nur die Verknüpfung. */
export async function deleteLead(db: Db, tenantId: number, publicId: string, actorUserId: number | null = null) {
  const lead = await leadByPublicId(db, tenantId, publicId);
  if (lead.kind !== "vertrieb") throw new Error("Nur Vertriebskontakte können hier gelöscht werden – Verkaufs-Leads bitte über die Leads-Seite.");
  // eine Stelle für alles: sichert vorher in den Papierkorb, löscht dann mit allem, was daran hängt
  const { removeLeadsCascade } = await import("./sales-outreach");
  const undoId = await removeLeadsCascade(db, tenantId, [lead.id], { actorUserId, reason: `${leadName(lead)} gelöscht` });
  return { success: true as const, name: leadName(lead), undoId };
}
/** Ausführliches Lead-Fenster: alle Infos zu einer Karte – Kontakt, Herkunft, Aufgaben, Termine, Nachrichten, Anrufe, Serien, Posteingang, Verlauf. */
export async function leadDetail(db: Db, tenantId: number, publicId: string, now = new Date()) {
  const lead = await leadByPublicId(db, tenantId, publicId);
  const stages = await stagesOfLead(db, tenantId, lead);
  const [category, owner, noteRows] = await Promise.all([
    lead.categoryId ? (await db.select({ name: leadCategories.name, emoji: leadCategories.emoji, color: leadCategories.color, shortcode: leadCategories.shortcode }).from(leadCategories).where(eq(leadCategories.id, lead.categoryId)).limit(1))[0] ?? null : null,
    userName(db, lead.ownerUserId),
    db.select({ id: pipelineNotes.id }).from(pipelineNotes).where(and(eq(pipelineNotes.tenantId, tenantId), eq(pipelineNotes.leadId, lead.id))),
  ]);
  const { extras } = await cardExtras(db, tenantId, [{ id: lead.id, phone: lead.phone, email: lead.email, company: lead.company, pipelineStage: lead.pipelineStage, pipelineUpdatedAt: lead.pipelineUpdatedAt, createdAt: lead.createdAt, ownerUserId: lead.ownerUserId, followUpAt: lead.followUpAt, appointmentAt: lead.appointmentAt, dealValue: lead.dealValue, metadata: lead.metadata, noteCount: noteRows.length }], stages, now);
  const extra = extras.get(lead.id)!;
  const [tasks, messages, calls, recipients, inbox, history] = await Promise.all([
    listTasks(db, tenantId, { publicId, includeDone: true, limit: 100 }),
    listMessages(db, tenantId, publicId),
    db.select({ call: dialerCalls, agent: users.name }).from(dialerCalls).leftJoin(users, eq(users.id, dialerCalls.agentUserId)).where(and(eq(dialerCalls.tenantId, tenantId), eq(dialerCalls.leadId, lead.id))).orderBy(desc(dialerCalls.startedAt)).limit(30),
    db.select({ recipient: emailCampaignRecipients, campaignName: emailCampaigns.name, campaignStatus: emailCampaigns.status }).from(emailCampaignRecipients).innerJoin(emailCampaigns, eq(emailCampaigns.id, emailCampaignRecipients.campaignId)).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.leadId, lead.id))).orderBy(desc(emailCampaignRecipients.createdAt)).limit(20),
    db.select({ id: inboxMessages.id, subject: inboxMessages.subject, receivedAt: inboxMessages.receivedAt, bodyText: inboxMessages.bodyText, blocked: inboxMessages.blocked }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.leadId, lead.id))).orderBy(desc(inboxMessages.receivedAt)).limit(20),
    (await import("./meta-ads")).pipelineHistory(db, tenantId, publicId),
  ]);
  const meta = metaOf(lead);
  return {
    publicId: lead.publicId, id: lead.id, name: leadName(lead), firstName: lead.firstName, lastName: lead.lastName, company: lead.company, email: lead.email, phone: lead.phone, postcode: lead.postcode, city: lead.city, country: lead.country, salutation: typeof meta.salutation === "string" ? meta.salutation : null, notesFromImport: typeof meta.notes === "string" ? meta.notes : null,
    categoryId: lead.categoryId, categoryName: category?.name ?? null, categoryEmoji: category?.emoji ?? null, categoryColor: category?.color ?? null, categoryShortcode: category?.shortcode ?? null,
    source: pipelineSourceOf(lead.adPlatform), stages, adPlatform: lead.adPlatform, adCampaignId: lead.adCampaignId, adCampaignName: lead.adCampaignName, adsetName: lead.adsetName, adName: lead.adName, adFormName: lead.adFormName, listName: lead.listName, supplierName: lead.supplierName,
    pipelineStage: lead.pipelineStage, pipelineUpdatedAt: lead.pipelineUpdatedAt, ownerUserId: lead.ownerUserId, ownerName: owner, dealValue: lead.dealValue, followUpAt: lead.followUpAt, appointmentAt: lead.appointmentAt, appointment: meta.appointment ?? null, createdAt: lead.createdAt, updatedAt: lead.updatedAt, lastCallDisposition: typeof meta.lastCallDisposition === "string" ? meta.lastCallDisposition : null,
    stale: extra.stale, staleDays: extra.staleDays, lastActivityAt: extra.lastActivityAt, openTasks: extra.openTasks, noteCount: noteRows.length, fields: extraFieldsOf(lead.metadata),
    score: extra.score, temperature: extra.temperature, scoreLabel: extra.scoreLabel, scoreReasons: extra.scoreReasons,
    tasks, messages, history,
    calls: calls.map(({ call, agent }) => ({ id: call.id, startedAt: call.startedAt, status: call.status, durationSeconds: call.durationSeconds, talkSeconds: call.talkSeconds, disposition: call.disposition, notes: call.notes, summary: call.summary, agent: agent?.split(" ")[0] ?? null, toNumber: call.toNumber })),
    campaigns: recipients.map(({ recipient, campaignName, campaignStatus }) => ({ id: recipient.id, campaignId: recipient.campaignId, campaignName, campaignStatus, status: recipient.status, sentCount: recipient.sentCount, lastSentAt: recipient.lastSentAt, openedAt: recipient.openedAt, clickedAt: recipient.clickedAt, repliedAt: recipient.repliedAt, variant: recipient.variant })),
    inbox: inbox.map((row) => ({ id: row.id, subject: row.subject, receivedAt: row.receivedAt, preview: (row.bodyText ?? "").slice(0, 160), blocked: row.blocked })),
  };
}
/** Zeitplaner: eingeschlafene Karten in die Aufweck-Serie, Terminerinnerungen verschicken. */
export async function processAutomations(db: Db, tenantId: number, options: { now?: Date; appUrl?: string } = {}) {
  const now = options.now ?? new Date(); const settings = await loadSettings(db, tenantId); const sets = await stageSetsOf(db, tenantId); const stages = unionStages(sets); let enrolled = 0; let reminders = 0;
  if (settings.staleCampaignId && settings.staleDays > 0) {
    const openKeys = Array.from(new Set(Object.values(sets).flatMap((list) => list.filter((stage) => stage.fixed !== "won" && stage.fixed !== "lost").map((stage) => stage.key))));
    const rows = (await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), inArray(leads.pipelineStage, openKeys)))).filter((row) => { const own = stagesForLead(sets, row); const def = own.find((stage) => stage.key === row.pipelineStage); return def && def.fixed !== "won" && def.fixed !== "lost"; });
    const candidates = rows.filter((row) => row.email && !(metaOf(row).staleEnrolledAt) && (row.adCampaignId || row.adPlatform));
    const activity = await lastActivityMap(db, tenantId, candidates.map((row) => row.id));
    for (const row of candidates) {
      const info = staleInfo({ pipelineStage: row.pipelineStage, pipelineUpdatedAt: row.pipelineUpdatedAt, createdAt: row.createdAt, lastActivityAt: activity.get(row.id) ?? null }, now, settings.staleDays, stagesForLead(sets, row)); if (!info.stale) continue;
      const result = await enrollInCampaign(db, tenantId, { leadId: row.id, campaignId: settings.staleCampaignId, reason: `${info.days} Tage ohne Bewegung`, appUrl: options.appUrl });
      await db.update(leads).set({ metadata: { ...metaOf(row), staleEnrolledAt: now.toISOString(), staleEnrolledResult: result.reason } }).where(eq(leads.id, row.id)); if (result.enrolled) enrolled += 1;
    }
  }
  if (settings.appointmentReminder !== "aus") {
    const horizon = new Date(now.getTime() + settings.appointmentReminderHours * 3_600_000);
    const due = await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), gte(leads.appointmentAt, now), lte(leads.appointmentAt, horizon)));
    for (const row of due) {
      if (metaOf(row).appointmentReminderSentAt) continue; const channel = settings.appointmentReminder;
      const ok = channel === "email" ? Boolean(row.email) : Boolean(normalizePhone(row.phone)); if (!ok) continue;
      const template = channel === "email" ? "Guten Tag {{anrede}} {{nachname}},\n\nkurze Erinnerung an unseren Termin am {{termin}}. Wir freuen uns auf das Gespräch!\n\nViele Grüße\n{{absender}}, Tanesco Digital" : "Guten Tag {{anrede}} {{nachname}}, kurze Erinnerung an unseren Termin am {{termin}}. Wir freuen uns auf das Gespräch! {{absender}}, Tanesco Digital";
      try { await sendLeadMessage(db, tenantId, { publicId: row.publicId, channel, text: template, subject: `Erinnerung: Termin am ${formatAppointment(row.appointmentAt!)}`, templateKey: "erinnerung", actorUserId: null, appUrl: options.appUrl }); reminders += 1; } catch { /* Fehler stehen im Nachrichtenprotokoll */ }
      await db.update(leads).set({ metadata: { ...metaOf(row), appointmentReminderSentAt: now.toISOString() } }).where(eq(leads.id, row.id));
    }
  }
  return { enrolled, reminders };
}

/* ---------------------------------------------------------------- Verteilung & Team */
async function ownerCandidates(db: Db, tenantId: number, stages: StageDef[]) {
  const { pipelineOwners } = await import("./meta-ads"); const owners = await pipelineOwners(db, tenantId);
  const open = await db.select({ ownerUserId: leads.ownerUserId, stage: leads.pipelineStage }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), inArray(leads.pipelineStage, stages.filter((stage) => stage.fixed !== "won" && stage.fixed !== "lost").map((stage) => stage.key))));
  return owners.map((owner) => ({ userId: owner.userId, name: owner.name, openCount: open.filter((row) => row.ownerUserId === owner.userId).length }));
}
/** Verteilregeln auf Leads anwenden (neue Leads automatisch oder per Knopf „Nach Regeln verteilen“). */
export async function distributeByRules(db: Db, tenantId: number, input: { leadIds: number[]; actorUserId: number | null; force?: boolean }) {
  const settings = await loadSettings(db, tenantId); if (!input.force && !distributionActive(settings.distribution)) return { assigned: 0, skipped: input.leadIds.length, details: [] as Array<{ leadId: number; userId: number | null; reason: string }> };
  const stages = unionStages(await stageSetsOf(db, tenantId)); const candidates = await ownerCandidates(db, tenantId, stages); const details: Array<{ leadId: number; userId: number | null; reason: string }> = []; let assigned = 0;
  for (const leadId of input.leadIds) {
    const lead = (await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"))).limit(1))[0]; if (!lead) continue;
    const source = pipelineSourceOf(lead.adPlatform);
    // „Nach Regeln verteilen“ per Knopf (force): eine ausgeschaltete Verteilung zählt dann als reihum – je Pipeline und allgemein
    const rules: DistributionRules = input.force ? { ...settings.distribution, mode: settings.distribution.mode === "aus" ? "reihum" : settings.distribution.mode, perPipeline: Object.fromEntries(Object.entries(settings.distribution.perPipeline ?? {}).map(([key, value]) => [key, value && value.mode === "aus" ? { ...value, mode: "reihum" as const } : value])) } : settings.distribution;
    const cursor = await nextCursor(db, tenantId); const pick = pickOwner(rules, { ...lead, source }, candidates, cursor); details.push({ leadId, ...pick });
    if (!pick.userId) continue; const candidate = candidates.find((item) => item.userId === pick.userId); if (candidate) candidate.openCount += 1;
    await db.update(leads).set({ ownerUserId: pick.userId }).where(eq(leads.id, leadId));
    await db.insert(pipelineEvents).values({ tenantId, leadId, fromStage: null, toStage: "besitzer", actorUserId: input.actorUserId, note: `Zugeteilt an ${candidate?.name ?? "Vertriebler"} (Regel: ${pick.reason})`.slice(0, 400) }); assigned += 1;
  }
  return { assigned, skipped: input.leadIds.length - assigned, details };
}
/** Neue Pipeline-Karte ohne Zuständigen automatisch verteilen (wenn Verteilung eingeschaltet). */
export async function autoAssign(db: Db, tenantId: number, leadId: number) { try { const settings = await loadSettings(db, tenantId); if (!distributionActive(settings.distribution)) return null; const lead = (await db.select({ ownerUserId: leads.ownerUserId }).from(leads).where(eq(leads.id, leadId)).limit(1))[0]; if (!lead || lead.ownerUserId) return null; return await distributeByRules(db, tenantId, { leadIds: [leadId], actorUserId: null }); } catch { return null; } }
/** Team-Übersicht: Tagesziele und Zählung je Vertriebler (heute / Zeitraum), Umsatz aus gewonnenen Karten. */
export async function teamOverview(db: Db, tenantId: number, options: { from?: Date; until?: Date; now?: Date } = {}) {
  const now = options.now ?? new Date(); const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()); const from = options.from ?? dayStart; const until = options.until ?? now;
  const settings = await loadSettings(db, tenantId); const sets = await stageSetsOf(db, tenantId); const wonKeys = new Set(Object.values(sets).map((list) => wonStage(list))); const lostKeys = new Set(Object.values(sets).map((list) => lostStage(list)));
  const { pipelineOwners } = await import("./meta-ads"); const owners = await pipelineOwners(db, tenantId);
  const calls = await db.select({ agentUserId: dialerCalls.agentUserId, startedAt: dialerCalls.startedAt, talkSeconds: dialerCalls.talkSeconds, disposition: dialerCalls.disposition, status: dialerCalls.status }).from(dialerCalls).where(and(eq(dialerCalls.tenantId, tenantId), gte(dialerCalls.startedAt, from), lte(dialerCalls.startedAt, until)));
  const events = await db.select({ actorUserId: pipelineEvents.actorUserId, toStage: pipelineEvents.toStage, createdAt: pipelineEvents.createdAt, leadId: pipelineEvents.leadId }).from(pipelineEvents).where(and(eq(pipelineEvents.tenantId, tenantId), gte(pipelineEvents.createdAt, from), lte(pipelineEvents.createdAt, until)));
  const cards = await db.select({ id: leads.id, ownerUserId: leads.ownerUserId, pipelineStage: leads.pipelineStage, dealValue: leads.dealValue, pipelineUpdatedAt: leads.pipelineUpdatedAt }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb")));
  const tasks = await db.select({ ownerUserId: pipelineTasks.ownerUserId, dueAt: pipelineTasks.dueAt, doneAt: pipelineTasks.doneAt }).from(pipelineTasks).where(eq(pipelineTasks.tenantId, tenantId));
  const rows = owners.map((owner) => {
    const mine = calls.filter((call) => call.agentUserId === owner.userId); const reached = mine.filter((call) => call.status === "beendet" && (call.talkSeconds ?? 0) > 0);
    const appointments = events.filter((event) => event.actorUserId === owner.userId && (event.toStage === "termin_gesetzt" || /termin/.test(event.toStage))).length;
    const deals = events.filter((event) => event.actorUserId === owner.userId && wonKeys.has(event.toStage)).length;
    const ownCards = cards.filter((card) => card.ownerUserId === owner.userId); const wonCards = ownCards.filter((card) => wonKeys.has(card.pipelineStage ?? "") && (!card.pipelineUpdatedAt || card.pipelineUpdatedAt >= from) && (!card.pipelineUpdatedAt || card.pipelineUpdatedAt <= until));
    const openCards = ownCards.filter((card) => !wonKeys.has(card.pipelineStage ?? "") && !lostKeys.has(card.pipelineStage ?? "")); const myTasks = tasks.filter((task) => task.ownerUserId === owner.userId && !task.doneAt);
    const target = settings.dailyTargets[String(owner.userId)] ?? { calls: 0, appointments: 0, deals: 0 };
    return { userId: owner.userId, name: owner.name, initials: owner.initials, calls: mine.length, reached: reached.length, talkMinutes: Math.round(mine.reduce((sum, call) => sum + (call.talkSeconds ?? 0), 0) / 60), appointments, deals, revenue: wonCards.reduce((sum, card) => sum + Number(card.dealValue ?? 0), 0), openCards: openCards.length, openValue: openCards.reduce((sum, card) => sum + Number(card.dealValue ?? 0), 0), overdueTasks: myTasks.filter((task) => task.dueAt < dayStart).length, todayTasks: myTasks.filter((task) => task.dueAt >= dayStart && task.dueAt < new Date(dayStart.getTime() + 86_400_000)).length, target };
  });
  return { from, until, rows, settings, unassigned: cards.filter((card) => !card.ownerUserId && card.pipelineStage && !wonKeys.has(card.pipelineStage) && !lostKeys.has(card.pipelineStage)).length };
}

/* ---------------------------------------------------------------- Mehrfachauswahl & Export */
export async function bulkMove(db: Db, tenantId: number, input: { publicIds: string[]; stage: string; note?: string | null; actorUserId: number | null }) {
  const stages = unionStages(await stageSetsOf(db, tenantId)); if (!isStage(input.stage, stages)) throw new Error("Unbekannte Stufe."); const { moveStage } = await import("./meta-ads"); let moved = 0;
  for (const publicId of input.publicIds) { try { await moveStage(db, tenantId, { publicId, stage: input.stage, note: input.note ?? "Mehrfachauswahl", actorUserId: input.actorUserId }); moved += 1; } catch { /* nächste */ } }
  return { moved, stage: input.stage, label: stageLabel(input.stage, stages) };
}
export async function exportCsv(db: Db, tenantId: number, options: Parameters<typeof import("./meta-ads")["pipelineOverview"]>[2] = {}) {
  const { pipelineOverview } = await import("./meta-ads"); const overview = await pipelineOverview(db, tenantId, { ...options, limitPerStage: 100000 });
  const rows = overview.stages.flatMap((stage) => stage.leads.map((lead) => ({ ...lead, pipelineStage: stage.key })));
  const stamp = new Date().toISOString().slice(0, 10);
  return { csv: pipelineCsv(rows, overview.stageDefs), fileName: `vertriebspipeline-${options.source ?? "alle"}-${stamp}.csv`, rows: rows.length };
}
export { PIPELINE_STAGES };
export type { PipelineTask };
