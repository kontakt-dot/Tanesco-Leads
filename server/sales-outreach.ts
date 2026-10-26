/**
 * Vertrieb: Kaltakquise-Listen (CSV → Leads in der Pipeline, Anrufkampagne manuell/power/predictive über den Dialer)
 * und E-Mail-Kampagnen mit Ablauf-Baum (Senden → Warten → Wenn geöffnet/geklickt → Dann/Sonst), Tracking per Pixel/Link.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, lte, or, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { isColdLike, isCustomSource, platformForSource, type PipelineSource } from "../shared/sales-pipeline";
import { dialerCalls, dialerQueueItems, emailCampaignEvents, emailCampaignRecipients, emailCampaigns, emailSuppressions, inboxMessages, leadCategories, leadStatusEvents, leadTagAssignments, leads, listImports, outboundMessages, pipelineEvents, pipelineNotes, pipelineTasks, tags, tenantSettings, users, type EmailCampaign } from "../drizzle/schema";
import { draftToBlocks, modernizeTree, smoothQualifyPhrase, cleanDraftText, sentSourceOf, type SentSource, dripBudget, resolveDrip, SUPPRESSION_LABELS, type DripSettings, type SuppressionReason, abVariantFor, advanceRecipient, audienceLists, canEnroll, listAudience, DEFAULT_SEND_WINDOW, eventLabel, followUpTree, resolveSendWindow, hasAbTest, maxRunsLabel, maxRunsOf, OPEN_RECIPIENT_STATUSES, kiAnsatzOf, kiModusOf, recipientPath, recipientValues, renderNode, REPLY_STOP_NOTE, resolveWaiting, starterTree, stopsOnReply, summarizeCampaign, validateTree, waitingText, type EmailNode, type EmailTree, type RecipientState, type SendDay, type SendWindow, SEND_WINDOW_PRESET} from "../shared/email-campaigns";
import { addSuppression, autoAssign, suppressedSet } from "./pipeline-extras";
import { companyFooterText, DEFAULT_DESIGN, starterBlocks, type EmailDesign } from "../shared/email-design";
import { buildQueue, saveCampaign as saveDialerCampaign, setCampaignStatus } from "./dialer";
import { deliverMail } from "./email-onboarding";
import { distributeOwners, pipelineStages } from "./meta-ads";
import { isMachineRequest, isTooSoonAfterSend } from "../shared/tracking-guard";
import { campaignMailStats, type RecipientStamps } from "../shared/sent-tracking";
import { bumpActivity, logActivity } from "./activity";
import { signatureFor } from "./mail-settings";
import { campaignDailyStatus, draftFitsNode, draftForRecipient } from "./campaign-review";
import { normalizeMessageId } from "../shared/message-id";
import type { Db } from "./lead-pipeline";
import type { OwnerShare, ShareMode } from "../shared/pipeline-extras";

/* ---------- Kaltakquise-Listen ---------- */
import { extraFieldsOf, parseColdList, type ColdRow } from "../shared/cold-list";
import { lostStage, PIPELINE_SOURCE_LABEL, pipelineSourceOf, stagesForLead, wonStage } from "../shared/sales-pipeline";
export { parseColdList };
/** Tag holen oder anlegen (Name wird auf 80 Zeichen gekürzt). */
async function tagByName(db: Db, tenantId: number, name: string, color: string) {
  const key = name.slice(0, 80);
  let row = (await db.select().from(tags).where(and(eq(tags.tenantId, tenantId), eq(tags.name, key))).limit(1))[0];
  if (!row) { await db.insert(tags).values({ tenantId, name: key, color }); row = (await db.select().from(tags).where(and(eq(tags.tenantId, tenantId), eq(tags.name, key))).limit(1))[0]; }
  return row;
}
/** Nur setzen, was wirklich dazukommt – vorhandene Angaben am Kontakt werden nie mit leeren Werten überschrieben. */
const fillIfEmpty = <T>(current: T | null | undefined, next: T | null | undefined) => (current ?? null) || (next ?? null);

export async function importColdList(db: Db, tenantId: number, input: { pipeline?: PipelineSource | null; listName: string; categoryId?: number | null; rows: ColdRow[]; ownerUserIds?: number[] | null; ownerShares?: OwnerShare[] | null; shareMode?: ShareMode | null; actorUserId?: number | null; tagNames?: string[] | null; duplicateMode?: "aktualisieren" | "ueberspringen" | null; toPipeline?: boolean }) {
  const listName = input.listName.trim(); if (!listName) throw new Error("Bitte einen Listennamen angeben.");
  const coldPlatform = input.pipeline && isColdLike(input.pipeline) ? platformForSource(input.pipeline) : "kaltakquise"; // eigene Pipeline: Kontakte landen dort if (!input.rows.length) throw new Error("Die Liste enthält keine verwertbaren Zeilen (Telefon oder E-Mail nötig).");
  // Kategorie ist freiwillig: ohne Angabe die erste aktive nehmen, sonst ohne Kategorie anlegen.
  const categoryId = input.categoryId ?? (await db.select({ id: leadCategories.id }).from(leadCategories).where(and(eq(leadCategories.tenantId, tenantId), eq(leadCategories.status, "aktiv"))).limit(1))[0]?.id ?? null;
  const tag = await tagByName(db, tenantId, `Liste: ${listName}`, "#f59e0b");
  const extraTags = [] as Array<{ id: number }>;
  for (const name of input.tagNames ?? []) { const clean = name.trim(); if (!clean) continue; const row = await tagByName(db, tenantId, clean, "#8178ff"); if (row && row.id !== tag.id) extraTags.push(row); }
  const mode = input.duplicateMode ?? "aktualisieren";
  // Aus dem Kampagnen-Editor hochgeladene Listen bleiben zunächst außerhalb der Pipeline – sie werden dort erst auf Knopfdruck übernommen.
  const toPipeline = input.toPipeline ?? true;
  const existing = await db.select({ id: leads.id, status: leads.status, phone: leads.phone, email: leads.email, firstName: leads.firstName, lastName: leads.lastName, company: leads.company, postcode: leads.postcode, city: leads.city, metadata: leads.metadata }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb")));
  type Known = typeof existing[number];
  const byPhone = new Map<string, Known>(); const byEmail = new Map<string, Known>();
  for (const row of existing) { const phone = (row.phone ?? "").replace(/\D/g, ""); const email = (row.email ?? "").toLowerCase(); if (phone) byPhone.set(phone, row); if (email) byEmail.set(email, row); }
  let created = 0; let duplicates = 0; let updated = 0; const leadIds: number[] = [];
  /** Tags an einen Kontakt hängen, ohne doppelte Zuordnung. */
  const assignTags = async (leadId: number) => { for (const item of [tag, ...extraTags]) { const already = (await db.select({ leadId: leadTagAssignments.leadId }).from(leadTagAssignments).where(and(eq(leadTagAssignments.leadId, leadId), eq(leadTagAssignments.tagId, item.id))).limit(1))[0]; if (!already) await db.insert(leadTagAssignments).values({ leadId, tagId: item.id }); } };
  for (const row of input.rows) {
    const phoneKey = (row.phone ?? "").replace(/\D/g, ""); const emailKey = (row.email ?? "").toLowerCase();
    const known = (emailKey && byEmail.get(emailKey)) || (phoneKey && byPhone.get(phoneKey)) || null;
    if (known) {
      duplicates += 1;
      if (mode === "ueberspringen") continue;
      // Denselben Kontakt nicht noch einmal anlegen, sondern ergänzen: leere Felder füllen, Zusatzspalten zusammenführen, Liste und Tags anhängen.
      const metadata = (known.metadata && typeof known.metadata === "object" && !Array.isArray(known.metadata) ? known.metadata : {}) as Record<string, unknown>;
      const felder = { ...extraFieldsOf(metadata), ...(row.extra ?? {}) };
      await db.update(leads).set({
        // Der Kontakt gehört ab jetzt zur zuletzt hochgeladenen Liste – sonst fehlt er in deren Zielgruppe.
        listName,
        firstName: fillIfEmpty(known.firstName, row.firstName), lastName: fillIfEmpty(known.lastName, row.lastName ?? row.company), company: fillIfEmpty(known.company, row.company),
        phone: fillIfEmpty(known.phone, row.phone), email: fillIfEmpty(known.email, emailKey || null), postcode: fillIfEmpty(known.postcode, row.postcode), city: fillIfEmpty(known.city, row.city),
        metadata: { ...metadata, salutation: metadata.salutation ?? row.salutation ?? undefined, kaltakquise: { liste: listName }, ...(Object.keys(felder).length ? { felder } : {}) },
      }).where(eq(leads.id, known.id));
      await assignTags(known.id);
      await db.insert(leadStatusEvents).values({ tenantId, leadId: known.id, previousStatus: known.status, nextStatus: known.status, actorUserId: input.actorUserId ?? null, note: `Aus Liste „${listName}“ aktualisiert (kein zweiter Eintrag angelegt)` });
      updated += 1; continue;
    }
    const publicId = `KALT-${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
    const inserted = await db.insert(leads).values({ tenantId, publicId, categoryId, kind: "vertrieb", firstName: row.firstName ?? null, lastName: row.lastName ?? row.company ?? null, email: emailKey || null, phone: row.phone ?? null, postcode: row.postcode ?? null, city: row.city ?? null, country: "DE", supplierName: "Kaltakquise", metadata: { salutation: row.salutation ?? undefined, notes: row.notes ?? undefined, kaltakquise: { liste: listName }, ...(websiteFromEmail(emailKey, row.extra) ? { website: websiteFromEmail(emailKey, row.extra) } : {}), ...(row.extra && Object.keys(row.extra).length ? { felder: row.extra } : {}) }, status: "neu", cost: "0.00", pipelineStage: "neu", pipelineUpdatedAt: new Date(), adCampaignId: `liste-${listName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, adCampaignName: `Liste: ${listName}`, adPlatform: coldPlatform, company: row.company ?? null, listName, inPipeline: toPipeline });
    const leadId = Number(inserted[0]?.insertId) || 0; leadIds.push(leadId); created += 1;
    const self = { id: leadId, status: "neu", phone: row.phone ?? null, email: emailKey || null, firstName: row.firstName ?? null, lastName: row.lastName ?? null, company: row.company ?? null, postcode: row.postcode ?? null, city: row.city ?? null, metadata: null } as Known;
    if (phoneKey) byPhone.set(phoneKey, self); if (emailKey) byEmail.set(emailKey, self);
    await assignTags(leadId);
    await db.insert(leadStatusEvents).values({ tenantId, leadId, previousStatus: null, nextStatus: "neu", actorUserId: null, note: `Kaltakquise-Liste „${listName}“ hochgeladen` });
    if (toPipeline) await db.insert(pipelineEvents).values({ tenantId, leadId, fromStage: null, toStage: "neu", actorUserId: null, note: `Aus Kaltakquise-Liste „${listName}“` });
  }
  if (toPipeline) {
    if (input.ownerShares?.length && leadIds.length) await distributeOwners(db, tenantId, { leadIds, userIds: [], shares: input.ownerShares, mode: input.shareMode ?? "prozent", actorUserId: input.actorUserId ?? null }); // Verteilung aus dem Upload: Prozent oder feste Anzahl je Vertriebler
    else if (input.ownerUserIds?.length && leadIds.length) await distributeOwners(db, tenantId, { leadIds, userIds: input.ownerUserIds, actorUserId: input.actorUserId ?? null });
    else for (const leadId of leadIds) await autoAssign(db, tenantId, leadId); // Verteilregeln, wenn eingeschaltet
  }
  // Upload-Verlauf festhalten – damit man später sieht, was wann hochgeladen wurde, und es rückgängig machen kann.
  await db.insert(listImports).values({ tenantId, listName, source: toPipeline ? "kaltakquise" : "kampagne", rowCount: input.rows.length, created, updated, duplicates, toPipeline, leadIds, actorUserId: input.actorUserId ?? null });
  if (created || updated) await logActivity(db, tenantId, { kind: "kontakt_neu", title: `Liste „${listName}“ hochgeladen: ${created} neue Kontakte${updated ? `, ${updated} aktualisiert` : ""}${duplicates ? `, ${duplicates} doppelt` : ""}`, detail: toPipeline ? "Kaltakquise – Kontakte stehen in der Vertriebspipeline" : "E-Mail-Kampagnen – Kontakte nur für den E-Mail-Versand", count: Math.max(1, created), actorUserId: input.actorUserId ?? null, refType: "listImport" });
  const campaigns = created || updated ? await enrollListIntoRunningCampaigns(db, tenantId, listName, process.env.APP_URL ?? "").catch((error) => { console.error("[E-Mail-Kampagnen] Nachaufnahme nach Upload:", error instanceof Error ? error.message : error); return [] as Array<{ id: number; name: string; added: number }>; }) : [];
  return { created, duplicates, updated, tagId: tag.id, listName, leadIds, toPipeline, campaigns };
}
export async function listColdLists(db: Db, tenantId: number, pipeline?: PipelineSource | null) {
  const all = await db.select({ listName: leads.listName, stage: leads.pipelineStage, phone: leads.phone, email: leads.email, metadata: leads.metadata, adPlatform: leads.adPlatform }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb")));
  // Listen der Kaltakquise und aller eigenen Pipelines – mit Pipeline-Angabe nur die dieser Pipeline
  const rows = all.filter((row) => pipeline && isColdLike(pipeline) ? row.adPlatform === platformForSource(pipeline) : isColdLike(row.adPlatform));
  const map = new Map<string, { listName: string; contacts: number; withPhone: number; withEmail: number; customers: number; lost: number; fields: Array<{ key: string; sample: string }> }>();
  for (const row of rows) {
    const name = row.listName ?? "Ohne Liste"; const entry = map.get(name) ?? { listName: name, contacts: 0, withPhone: 0, withEmail: 0, customers: 0, lost: 0, fields: [] };
    entry.contacts += 1; if (row.phone) entry.withPhone += 1; if (row.email) entry.withEmail += 1; if (row.stage === "kunde") entry.customers += 1; if (row.stage === "verloren") entry.lost += 1;
    for (const [key, sample] of Object.entries(extraFieldsOf(row.metadata))) if (!entry.fields.some((field) => field.key === key)) entry.fields.push({ key, sample }); // Zusatzspalten der Liste → Platzhalter {{key}}
    map.set(name, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.contacts - a.contacts);
}
/** Anrufkampagne wie im Callcenter (manuell/power/predictive) für eine Liste: Dialer-Kampagne + Warteschlange. */
export async function startCallCampaign(db: Db, tenantId: number, userId: number, input: { listName: string; mode: "manuell" | "power" | "predictive"; callerNumberId?: number | null; script?: string | null; autoNotes?: boolean | null }) {
  const tag = (await db.select().from(tags).where(and(eq(tags.tenantId, tenantId), eq(tags.name, `Liste: ${input.listName}`.slice(0, 80)))).limit(1))[0]; if (!tag) throw new Error("Zu dieser Liste gibt es kein Listen-Tag – bitte die Liste zuerst hochladen.");
  const saved = await saveDialerCampaign(db, tenantId, userId, { name: `Kaltakquise: ${input.listName}`, mode: input.mode, leadFilter: { tagIds: [tag.id], onlyWithoutCall: true, kind: "vertrieb" }, callerNumberId: input.callerNumberId ?? null, maxAttempts: 3, retryMinutes: 240, wrapUpSeconds: 20, pacingRatio: input.mode === "predictive" ? 1.5 : null, autoNotes: input.autoNotes ?? null, callWindow: { weekdays: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" }, script: input.script ?? `Guten Tag, hier ist … von Tanesco. Wir vermitteln geprüfte Kundenanfragen aus Ihrer Region – hätten Sie kurz Zeit?` });
  const queue = await buildQueue(db, tenantId, saved.id); await setCampaignStatus(db, tenantId, saved.id, "aktiv");
  return { campaignId: saved.id, queued: (queue as { queued?: number; added?: number }).queued ?? (queue as { added?: number }).added ?? 0, mode: input.mode };
}

/**
 * Einen Kontakt von Hand in eine Pipeline legen (Knopf „+ Kontakt“): Name/Firma, Telefon und/oder E-Mail, Adresse,
 * Kategorie, Stufe, Vertriebler, Angebotswert, erste Notiz. Gibt es Telefon oder E-Mail schon, wird nichts doppelt angelegt.
 */
export async function createPipelineContact(db: Db, tenantId: number, input: { source: PipelineSource; salutation?: string | null; firstName?: string | null; lastName?: string | null; company?: string | null; phone?: string | null; email?: string | null; street?: string | null; postcode?: string | null; city?: string | null; website?: string | null; categoryId?: number | null; stage?: string | null; ownerUserId?: number | null; dealValue?: number | null; note?: string | null; listName?: string | null }, actorUserId: number | null) {
  const clean = (value: string | null | undefined, max = 160) => (value ?? "").trim().slice(0, max) || null;
  const firstName = clean(input.firstName, 120); const lastName = clean(input.lastName, 120); const company = clean(input.company, 200);
  const phone = clean(input.phone, 48); const email = clean(input.email, 320)?.toLowerCase() ?? null;
  if (!firstName && !lastName && !company) throw new Error("Bitte einen Namen oder eine Firma angeben.");
  if (!phone && !email) throw new Error("Bitte Telefon oder E-Mail angeben – sonst lässt sich der Kontakt nicht erreichen.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Die E-Mail-Adresse sieht nicht gültig aus.");
  const samePhone = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "").replace(/^(0049|49|0)/, ""); // +49 89 …, 0049 89 … und 089 … sind dieselbe Nummer
  const phoneKey = samePhone(phone);
  const existing = await db.select({ id: leads.id, publicId: leads.publicId, firstName: leads.firstName, lastName: leads.lastName, company: leads.company, email: leads.email, phone: leads.phone }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb")));
  const twin = existing.find((row) => (email && (row.email ?? "").toLowerCase() === email) || (phoneKey.length >= 6 && samePhone(row.phone) === phoneKey));
  if (twin) throw new Error(`Diesen Kontakt gibt es schon: ${[twin.firstName, twin.lastName].filter(Boolean).join(" ") || twin.company || twin.email} (${twin.publicId}) – gleiche ${email && (twin.email ?? "").toLowerCase() === email ? "E-Mail" : "Telefonnummer"}.`);
  const categoryId = input.categoryId ?? (await db.select({ id: leadCategories.id }).from(leadCategories).where(and(eq(leadCategories.tenantId, tenantId), eq(leadCategories.status, "aktiv"))).limit(1))[0]?.id ?? null;
  const stage = clean(input.stage, 40) ?? "neu";
  const coldLike = isColdLike(input.source);
  const listName = coldLike ? (clean(input.listName) ?? "Eigene Kontakte") : null;
  const platform = platformForSource(input.source);
  const campaignId = coldLike ? `liste-${listName!.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : input.source === "email" ? "email-manuell" : "manuell";
  const campaignName = coldLike ? `Liste: ${listName}` : "Manuell angelegt";
  const felder: Record<string, string> = {}; if (clean(input.street, 200)) felder.strasse = clean(input.street, 200)!; if (clean(input.website, 300)) felder.webseite = clean(input.website, 300)!;
  const publicId = `${coldLike ? "KALT" : input.source === "email" ? "MAIL" : "LEAD"}-${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  const inserted = await db.insert(leads).values({ tenantId, publicId, categoryId, kind: "vertrieb", firstName, lastName: lastName ?? (firstName ? null : company), email, phone, postcode: clean(input.postcode, 24), city: clean(input.city, 120), country: "DE", supplierName: "Manuell", metadata: { salutation: clean(input.salutation, 40) ?? undefined, manuell: true, ...(listName ? { kaltakquise: { liste: listName } } : {}), ...(Object.keys(felder).length ? { felder } : {}) }, status: "neu", cost: "0.00", pipelineStage: stage, pipelineUpdatedAt: new Date(), adCampaignId: campaignId, adCampaignName: campaignName, adPlatform: platform, company, listName, inPipeline: true, ownerUserId: input.ownerUserId ?? null, dealValue: input.dealValue != null && Number.isFinite(input.dealValue) ? String(Math.max(0, input.dealValue).toFixed(2)) : null });
  const leadId = Number(inserted[0]?.insertId) || 0;
  await db.insert(pipelineEvents).values({ tenantId, leadId, fromStage: null, toStage: stage, actorUserId, note: "Von Hand angelegt" });
  await db.insert(leadStatusEvents).values({ tenantId, leadId, previousStatus: null, nextStatus: "neu", actorUserId, note: "Kontakt von Hand in der Vertriebspipeline angelegt" });
  if (clean(input.note, 5000)) await db.insert(pipelineNotes).values({ tenantId, leadId, authorUserId: actorUserId, text: clean(input.note, 5000)!, source: "text" });
  if (listName) { const tag = await tagByName(db, tenantId, `Liste: ${listName}`, "#f59e0b"); if (tag) await db.insert(leadTagAssignments).values({ leadId, tagId: tag.id }).catch(() => null); }
  if (!input.ownerUserId) await autoAssign(db, tenantId, leadId);
  const name = [firstName, lastName].filter(Boolean).join(" ") || company || email || "Kontakt";
  await logActivity(db, tenantId, { kind: "kontakt_neu", title: `Kontakt „${name}“ von Hand angelegt`, detail: coldLike ? campaignName : input.source === "email" ? "E-Mail-Kampagne" : "Meta Ads", count: 1, actorUserId, refType: "lead", refId: leadId }).catch(() => null);
  return { publicId, leadId, name, stage };
}

/**
 * Karten in eine andere Pipeline verschieben (z. B. Kaltakquise → eigene „Termin“-Pipeline). Die Stufe bleibt, wenn es sie
 * dort gibt, sonst landet die Karte im Eingang. Liste und Herkunft bleiben am Kontakt.
 */
export async function moveLeadsToPipeline(db: Db, tenantId: number, input: { publicIds: string[]; target: PipelineSource; actorUserId?: number | null }) {
  const { pipelineStageSets } = await import("./meta-ads"); const { stagesOf, entryStage, PIPELINE_SOURCE_LABEL } = await import("../shared/sales-pipeline"); const { loadSettings } = await import("./pipeline-extras");
  const settings = await loadSettings(db, tenantId);
  if (isCustomSource(input.target) && !settings.customPipelines.some((item) => item.key === input.target)) throw new Error("Diese Pipeline gibt es nicht mehr.");
  const label = isCustomSource(input.target) ? settings.customPipelines.find((item) => item.key === input.target)!.label : PIPELINE_SOURCE_LABEL[input.target as keyof typeof PIPELINE_SOURCE_LABEL];
  const sets = await pipelineStageSets(db, tenantId); const targetStages = stagesOf(sets, input.target); const platform = platformForSource(input.target);
  const rows = await db.select({ id: leads.id, adPlatform: leads.adPlatform, stage: leads.pipelineStage }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), inArray(leads.publicId, input.publicIds.slice(0, 2000))));
  let moved = 0;
  for (const row of rows) {
    if (row.adPlatform === platform) continue;
    const stage = row.stage && targetStages.some((item) => item.key === row.stage) ? row.stage : entryStage(targetStages);
    await db.update(leads).set({ adPlatform: platform, pipelineStage: stage, pipelineUpdatedAt: new Date(), inPipeline: true }).where(eq(leads.id, row.id));
    await db.insert(pipelineEvents).values({ tenantId, leadId: row.id, fromStage: row.stage, toStage: stage, actorUserId: input.actorUserId ?? null, note: `In die Pipeline „${label}“ verschoben` });
    moved += 1;
  }
  return { moved, skipped: rows.length - moved, label };
}

/* ---------- E-Mail-Kampagnen ---------- */
/** Zielgruppe einer Kampagne. „auswahl“ = nur von Hand aufgenommene Kontakte (aus „Kontakte“ oder „Einzeln hinzufügen“) – keine automatische Aufnahme. */
export type Audience = { source: "liste" | "stufe" | "tag" | "alle" | "auswahl"; listName?: string | null; listNames?: string[] | null; stage?: string | null; tagId?: number | null };
const isPickAudience = (audience: Audience | null | undefined) => audience?.source === "auswahl";
const tree = (campaign: EmailCampaign): EmailTree => (campaign.tree && typeof campaign.tree === "object" ? (campaign.tree as EmailTree) : { start: null, nodes: [] });
const design = (campaign: EmailCampaign): EmailDesign => ({ ...DEFAULT_DESIGN, ...((campaign.design ?? {}) as Partial<EmailDesign>) });
/** Verlauf von Empfängern, die es nicht mehr gibt, endgültig löschen – gelöschte Kontakte zählen in keiner Zahl mehr. */
export async function purgeOrphanCampaignEvents(db: Db, tenantId: number) {
  const result = await db.delete(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), sql`${emailCampaignEvents.recipientId} not in (select ${emailCampaignRecipients.id} from ${emailCampaignRecipients} where ${emailCampaignRecipients.tenantId} = ${tenantId})`));
  return Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
}
/**
 * Entwürfe mit Zielgruppe „Liste“ ohne Liste, in die schon Kontakte von Hand aufgenommen wurden (vor der Zielgruppe „auswahl“):
 * sie leben von diesen Kontakten → Zielgruppe wird „Nur ausgewählte Kontakte“, damit Anzeige und Start zusammenpassen.
 */
/** Alle Empfänger einer Kampagne als „von Hand aufgenommen“ markieren – wenn die Zielgruppe „auswahl“ verlassen wird, bleiben sie so Teil der Kampagne. */
async function markAllPicked(db: Db, tenantId: number, campaignId: number) {
  await db.update(emailCampaignRecipients).set({ pickedAt: new Date() }).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaignId), isNull(emailCampaignRecipients.pickedAt)));
}
/** Alte Vorlagen-Reste in gespeicherten Abläufen (Begrüßung „Guten Tag {{anrede}} {{nachname}}“, tote „Termin“-Knöpfe) einmalig auffrischen – Kampagnen und Vorlagen. */
async function repairCampaignTrees(db: Db, tenantId: number) {
  const rows = await db.select({ id: emailCampaigns.id, tree: emailCampaigns.tree, design: emailCampaigns.design, sendWindow: emailCampaigns.sendWindow, updatedAt: emailCampaigns.updatedAt }).from(emailCampaigns).where(eq(emailCampaigns.tenantId, tenantId));
  for (const row of rows) {
    const current = (row.tree ?? null) as EmailTree | null; const next = current?.nodes?.length ? modernizeTree(current) : null;
    // Fußzeile einmalig leeren: der alte Standardtext („Du erhältst diese E-Mail, weil …“ bzw. Anschrift + Abmelde-Satz) verschwindet überall; eigene Texte bleiben
    const design = (row.design ?? null) as Partial<EmailDesign> | null; const footer = design?.footerText ?? "";
    const clearFooter = !design?.footerReset && Boolean(footer.trim()) && (/Du erhältst diese E-Mail, weil/i.test(footer) || footer.trim() === companyFooterText().trim() || /^Tanesco Digital GbR/i.test(footer.trim())); // nur einmal – wer die Fußzeile danach bewusst setzt, behält sie
    // Versandzeiten einmalig auf die zwei Zeitfenster umstellen (9:00–11:30 und 14:00–16:30, Mo–Fr); spätere eigene Änderungen bleiben
    const stored = (row.sendWindow ?? null) as Partial<SendWindow> | null; const moveWindow = stored?.preset !== SEND_WINDOW_PRESET;
    const sendWindow = moveWindow ? { ...DEFAULT_SEND_WINDOW, timezone: stored?.timezone || DEFAULT_SEND_WINDOW.timezone, drip: stored?.drip ?? null } : null;
    if (next || clearFooter || sendWindow) await db.update(emailCampaigns).set({ ...(next ? { tree: next } : {}), ...(clearFooter ? { design: { ...(design ?? {}), footerText: "", footerReset: 1 } } : {}), ...(sendWindow ? { sendWindow } : {}), updatedAt: row.updatedAt }).where(eq(emailCampaigns.id, row.id)); // automatische Auffrischung zählt nicht als „bearbeitet“
   }
  // Gespeicherte KI-Entwürfe: Aroundhome-Erwähnungen raus, holprige Formulierung „qualifiziert über … Fragen“ glätten
  const drafts = await db.select({ id: emailCampaignRecipients.id, draftText: emailCampaignRecipients.draftText }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), or(like(emailCampaignRecipients.draftText, "%über%Fragen%"), like(emailCampaignRecipients.draftText, "%round%home%"))));
  for (const draft of drafts) { const smooth = cleanDraftText(draft.draftText ?? ""); if (smooth !== draft.draftText) await db.update(emailCampaignRecipients).set({ draftText: smooth }).where(eq(emailCampaignRecipients.id, draft.id)); }
}
/** Laufende Kampagnen ohne aktuelle Versandzeiten einmalig auf die zwei Zeitfenster (9:00–11:30, 14:00–16:30 Uhr) umstellen – auch ohne dass jemand die Seite öffnet. Drip-Einstellung bleibt. */
const windowsMigrated = new Set<number>();
export async function migrateSendWindows(db: Db, tenantId: number): Promise<number> {
  if (windowsMigrated.has(tenantId)) return 0; windowsMigrated.add(tenantId);
  const rows = await db.select({ id: emailCampaigns.id, sendWindow: emailCampaigns.sendWindow, updatedAt: emailCampaigns.updatedAt }).from(emailCampaigns).where(eq(emailCampaigns.tenantId, tenantId));
  let changed = 0;
  for (const row of rows) {
    const stored = (row.sendWindow ?? null) as Partial<SendWindow> | null; if (stored?.preset === SEND_WINDOW_PRESET) continue;
    await db.update(emailCampaigns).set({ sendWindow: { ...DEFAULT_SEND_WINDOW, timezone: stored?.timezone || DEFAULT_SEND_WINDOW.timezone, drip: stored?.drip ?? null }, updatedAt: row.updatedAt }).where(eq(emailCampaigns.id, row.id)); changed += 1; // „zuletzt bearbeitet“ bleibt
  }
  return changed;
}
async function repairPickedDrafts(db: Db, tenantId: number) {
  await repairCampaignTrees(db, tenantId);
  const drafts = await db.select({ id: emailCampaigns.id, audience: emailCampaigns.audience }).from(emailCampaigns).where(and(eq(emailCampaigns.tenantId, tenantId), eq(emailCampaigns.status, "entwurf"), eq(emailCampaigns.isTemplate, false)));
  const empty = drafts.filter((row) => { const audience = (row.audience ?? null) as Audience | null; return audience?.source === "liste" && !audienceLists(audience).length; });
  if (!empty.length) return;
  const counts = await db.select({ campaignId: emailCampaignRecipients.campaignId }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), inArray(emailCampaignRecipients.campaignId, empty.map((row) => row.id))));
  const withRecipients = new Set(counts.map((row) => row.campaignId));
  for (const row of empty) if (withRecipients.has(row.id)) { await db.update(emailCampaigns).set({ audience: { source: "auswahl" } }).where(eq(emailCampaigns.id, row.id)); await markAllPicked(db, tenantId, row.id); }
}
export async function listEmailCampaigns(db: Db, tenantId: number) {
  await purgeOrphanCampaignEvents(db, tenantId); await repairPickedDrafts(db, tenantId);
  const rows = await db.select().from(emailCampaigns).where(eq(emailCampaigns.tenantId, tenantId)).orderBy(desc(emailCampaigns.updatedAt));
  const recipients = await db.select({ campaignId: emailCampaignRecipients.campaignId, status: emailCampaignRecipients.status, sentCount: emailCampaignRecipients.sentCount, openedAt: emailCampaignRecipients.openedAt, clickedAt: emailCampaignRecipients.clickedAt, repliedAt: emailCampaignRecipients.repliedAt, variant: emailCampaignRecipients.variant, draftState: emailCampaignRecipients.draftState }).from(emailCampaignRecipients).where(eq(emailCampaignRecipients.tenantId, tenantId));
  const recipientEmails = await db.select({ id: emailCampaignRecipients.id, campaignId: emailCampaignRecipients.campaignId, email: emailCampaignRecipients.email, pickedAt: emailCampaignRecipients.pickedAt }).from(emailCampaignRecipients).where(eq(emailCampaignRecipients.tenantId, tenantId));
  const trackRows = await db.select({ campaignId: emailCampaignEvents.campaignId, recipientId: emailCampaignEvents.recipientId, kind: emailCampaignEvents.kind, note: emailCampaignEvents.note, createdAt: emailCampaignEvents.createdAt }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), inArray(emailCampaignEvents.kind, ["gesendet", "geoeffnet", "geklickt", "bounce", "abgemeldet"])));
  const stampRows = await db.select({ id: emailCampaignRecipients.id, openedAt: emailCampaignRecipients.openedAt, clickedAt: emailCampaignRecipients.clickedAt, repliedAt: emailCampaignRecipients.repliedAt, bouncedAt: emailCampaignRecipients.bouncedAt }).from(emailCampaignRecipients).where(eq(emailCampaignRecipients.tenantId, tenantId));
  const stamps = new Map<number, RecipientStamps>(stampRows.map((row) => [row.id, row]));
  const mailsOf = (campaignId: number) => campaignMailStats(trackRows.filter((row) => row.campaignId === campaignId), stamps);
  const blocked = await suppressedSet(db, tenantId);
  const infos = new Map<number, Awaited<ReturnType<typeof audienceInfo>>>();
  for (const row of rows) if (!row.isTemplate) infos.set(row.id, await audienceInfo(db, tenantId, (row.audience ?? { source: "alle" }) as Audience, recipientEmails.filter((item) => item.campaignId === row.id), blocked));
  return rows.map((row) => ({ id: row.id, name: row.name, status: row.status, fromName: row.fromName, fromEmail: row.fromEmail, audience: (row.isTemplate ? withoutLists(row.audience as Audience | null) : (row.audience ?? { source: "alle" })) as Audience, audienceInfo: infos.get(row.id) ?? null, steps: tree(row).nodes.filter((node) => node.type === "send").length, startedAt: row.startedAt, archivedAt: row.archivedAt ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt, isTemplate: row.isTemplate, abTest: hasAbTest(tree(row)), abSplit: row.abSplit, stopOnReply: stopsOnReply(row), maxRuns: maxRunsOf(row), reviewFirst: kiModusOf(row) === "freigabe", kiModus: kiModusOf(row), kiAnsatz: kiAnsatzOf(row), review: kiModusOf(row) === "freigabe" ? { zurFreigabe: recipients.filter((item) => item.campaignId === row.id && item.sentCount === 0 && (item.status === "wartet" || item.status === "laeuft") && item.draftState !== "freigegeben").length, freigegeben: recipients.filter((item) => item.campaignId === row.id && item.sentCount === 0 && (item.status === "wartet" || item.status === "laeuft") && item.draftState === "freigegeben").length } : null, sendWindow: sendWindowOf(row), stats: { ...summarizeCampaign(recipients.filter((item) => item.campaignId === row.id).map((item) => ({ ...item, variant: (item.variant ?? null) as "A" | "B" | null }))), mails: mailsOf(row.id) } }));
}
export async function getEmailCampaign(db: Db, tenantId: number, id: number) {
  await repairPickedDrafts(db, tenantId);
  const row = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Kampagne nicht gefunden.");
  const recipients = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, id))).orderBy(desc(emailCampaignRecipients.createdAt));
  const events = await db.select().from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.campaignId, id))).orderBy(desc(emailCampaignEvents.createdAt)).limit(200);
  const leadIds = Array.from(new Set(recipients.map((item) => item.leadId).filter((id): id is number => typeof id === "number")));
  const leadRows = leadIds.length ? await db.select({ id: leads.id, publicId: leads.publicId, pipelineStage: leads.pipelineStage, adPlatform: leads.adPlatform, ownerUserId: leads.ownerUserId, inPipeline: leads.inPipeline, listName: leads.listName }).from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, leadIds))) : [];
  const { pipelineStageSets } = await import("./meta-ads"); const sets = await pipelineStageSets(db, tenantId);
  const ownerIds = Array.from(new Set(leadRows.map((item) => item.ownerUserId).filter((id): id is number => typeof id === "number")));
  const owners = ownerIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ownerIds)) : [];
  const stageOf = (leadId: number | null) => { const lead = leadId ? leadRows.find((item) => item.id === leadId) : null; if (!lead) return null; const stages = stagesForLead(sets, lead); const def = stages.find((stage) => stage.key === lead.pipelineStage); return { publicId: lead.publicId, key: lead.pipelineStage, label: def?.label ?? lead.pipelineStage ?? "–", inPipeline: Boolean(lead.inPipeline), listName: lead.listName ?? null, ownerUserId: lead.ownerUserId ?? null, owner: owners.find((user) => user.id === lead.ownerUserId)?.name?.split(/\s+/)[0] ?? null, closed: lead.pipelineStage === wonStage(stages) || lead.pipelineStage === lostStage(stages) }; };
  const info = row.isTemplate ? null : await audienceInfo(db, tenantId, (row.audience ?? { source: "alle" }) as Audience, recipients, await suppressedSet(db, tenantId));
  const trackRows = await db.select({ recipientId: emailCampaignEvents.recipientId, kind: emailCampaignEvents.kind, note: emailCampaignEvents.note, createdAt: emailCampaignEvents.createdAt }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.campaignId, id), inArray(emailCampaignEvents.kind, ["gesendet", "geoeffnet", "geklickt", "bounce", "abgemeldet"])));
  return { ...row, kiModus: kiModusOf(row), kiAnsatz: kiAnsatzOf(row), reviewFirst: kiModusOf(row) === "freigabe", tree: tree(row), design: design(row), audience: (row.isTemplate ? withoutLists(row.audience as Audience | null) : (row.audience ?? { source: "alle" })) as Audience, audienceInfo: info, sendWindow: sendWindowOf(row), recipients: recipients.map((item) => ({ id: item.id, email: item.email, name: item.name, company: item.company, status: item.status, nodeId: item.nodeId, nextActionAt: item.nextActionAt, sentCount: item.sentCount, openedAt: item.openedAt, clickedAt: item.clickedAt, repliedAt: item.repliedAt, lead: stageOf(item.leadId), draftState: (item.draftState || null) as "entwurf" | "freigegeben" | null, draftNodeId: item.draftNodeId ?? null, picked: Boolean(item.pickedAt), variant: (item.variant ?? null) as "A" | "B" | null, clickedUrls: (Array.isArray(item.clickedUrls) ? item.clickedUrls : []) as string[], bouncedAt: item.bouncedAt, lastError: item.lastError })), events: events.map((event) => ({ id: event.id, recipientId: event.recipientId, kind: event.kind, subject: event.subject, note: event.note, createdAt: event.createdAt })), stats: { ...summarizeCampaign(recipients.map((item) => ({ ...item, variant: (item.variant ?? null) as "A" | "B" | null }))), mails: campaignMailStats(trackRows, new Map<number, RecipientStamps>(recipients.map((item) => [item.id, item]))) } };
}
const sendWindowOf = (campaign: Pick<EmailCampaign, "sendWindow">): SendWindow => resolveSendWindow(campaign.sendWindow as Partial<SendWindow> | null);
/** Abweichende Zeiten je Wochentag prüfen: nur „0“–„6“ mit gültigen Uhrzeiten, sonst nichts. */
function normalizeSendDays(input: unknown): Record<string, SendDay> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const time = (value: unknown) => (/^\d{2}:\d{2}$/.test(String(value ?? "")) ? String(value) : null);
  const out: Record<string, SendDay> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(key) || !value || typeof value !== "object") continue;
    const from = time((value as Record<string, unknown>).from); const to = time((value as Record<string, unknown>).to);
    if (from && to && from < to) out[key] = { from, to };
  }
  return Object.keys(out).length ? out : null;
}
export function normalizeSendWindow(input: unknown): SendWindow {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {}; const time = (value: unknown, fallback: string) => (/^\d{2}:\d{2}$/.test(String(value ?? "")) ? String(value) : fallback);
  return { enabled: Boolean(raw.enabled), weekdays: Array.isArray(raw.weekdays) ? (raw.weekdays as unknown[]).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : DEFAULT_SEND_WINDOW.weekdays, from: time(raw.from, DEFAULT_SEND_WINDOW.from), to: time(raw.to, DEFAULT_SEND_WINDOW.to), timezone: String(raw.timezone ?? DEFAULT_SEND_WINDOW.timezone).slice(0, 60) || DEFAULT_SEND_WINDOW.timezone, days: normalizeSendDays(raw.days), drip: resolveDrip(raw.drip as Partial<DripSettings> | null), pauseFrom: /^\d{2}:\d{2}$/.test(String(raw.pauseFrom ?? "")) ? String(raw.pauseFrom) : null, pauseTo: /^\d{2}:\d{2}$/.test(String(raw.pauseTo ?? "")) ? String(raw.pauseTo) : null, preset: SEND_WINDOW_PRESET }; // gespeichert = bewusst gewählt → wird von der einmaligen Umstellung nicht mehr angefasst
}
/**
 * Fußzeile des Mandanten (Einstellungen → Branding): Anschrift, Webseite und Terminlink.
 * Gilt als Vorgabe für neue Kampagnen; was in der Kampagne selbst steht, hat Vorrang.
 */
async function tenantDesign(db: Db, tenantId: number): Promise<Partial<EmailDesign>> {
  const row = (await db.select({ footer: tenantSettings.companyFooter, website: tenantSettings.websiteUrl, appointment: tenantSettings.appointmentUrl }).from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)).limit(1))[0];
  if (!row) return {};
  const text = companyFooterText({ footer: row.footer, website: row.website, appointment: row.appointment });
  return { footerText: `${text}\nDu erhältst diese E-Mail, weil du dich für unser Angebot interessiert hast. {{abmelden}}` };
}
export async function saveEmailCampaign(db: Db, tenantId: number, userId: number, input: { id?: number | null; name: string; fromName?: string | null; fromEmail?: string | null; replyTo?: string | null; audience: Audience; tree: EmailTree; design: Partial<EmailDesign>; sendWindow?: unknown; isTemplate?: boolean | null; abSplit?: number | null; stopOnReply?: boolean | null; maxRuns?: number | null; reviewFirst?: boolean | null; kiModus?: string | null; kiAnsatz?: string | null }) {
  const name = input.name.trim(); if (!name) throw new Error("Bitte einen Kampagnennamen angeben.");
  const values = { tenantId, name, fromName: input.fromName?.trim() || null, fromEmail: input.fromEmail?.trim().toLowerCase() || null, replyTo: input.replyTo?.trim() || null, audience: input.isTemplate ? withoutLists(input.audience) : input.audience, /* Vorlagen speichern nie Listen */ tree: input.tree, design: { ...DEFAULT_DESIGN, ...input.design } /* Fußzeile bleibt leer – wer sie will, wendet sie unter Einstellungen → Branding an */, createdByUserId: userId, ...(input.sendWindow !== undefined ? { sendWindow: normalizeSendWindow(input.sendWindow) } : {}), ...(input.isTemplate !== undefined && input.isTemplate !== null ? { isTemplate: input.isTemplate } : {}), ...(input.abSplit !== undefined && input.abSplit !== null ? { abSplit: Math.min(90, Math.max(10, Math.round(input.abSplit))) } : {}), ...(typeof input.stopOnReply === "boolean" ? { stopOnReply: input.stopOnReply } : {}), ...(typeof input.maxRuns === "number" ? { maxRuns: Math.max(0, Math.min(99, Math.round(input.maxRuns))) } : {}), ...(typeof input.reviewFirst === "boolean" ? { reviewFirst: input.reviewFirst } : {}), ...(input.kiModus === "aus" || input.kiModus === "freigabe" || input.kiModus === "auto" ? { kiModus: input.kiModus, reviewFirst: input.kiModus === "freigabe" } : {}), ...(input.kiAnsatz === "individuell" || input.kiAnsatz === "drittanbieter" ? { kiAnsatz: input.kiAnsatz } : {}) };
  if (input.id) {
    const before = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, input.id), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0];
    await db.update(emailCampaigns).set(values).where(and(eq(emailCampaigns.id, input.id), eq(emailCampaigns.tenantId, tenantId)));
    // Läuft die Kampagne schon, kommen Kontakte neu hinzugefügter Listen beim Speichern gleich mit hinein
    const previous = audienceLists((before?.audience ?? null) as Audience | null); const newLists = audienceLists(input.audience).filter((name) => !previous.includes(name));
    const droppedLists = input.audience.source === "liste" ? previous.filter((name) => !audienceLists(input.audience).includes(name)) : [];
    const dropped = before && droppedLists.length ? (await removeListsFromEmailCampaign(db, tenantId, { id: input.id, listNames: droppedLists, keepAudience: true })).removed : 0;
    if (before && newLists.length && before.status !== "entwurf" && !before.isTemplate) { const result = await addListsToEmailCampaign(db, tenantId, { id: input.id, listNames: newLists }, process.env.APP_URL ?? ""); return { id: input.id, enrolled: result.added, removed: dropped }; }
    return { id: input.id, enrolled: 0, removed: dropped };
  }
  const inserted = await db.insert(emailCampaigns).values({ ...values, ...(input.sendWindow === undefined ? { sendWindow: { ...DEFAULT_SEND_WINDOW, enabled: false } } : {}) }); return { id: Number(inserted[0]?.insertId) || 0, enrolled: 0, removed: 0 }; // ohne Angabe: kein Versandfenster (wie bisher), aber schon im neuen Schema – die einmalige Umstellung lässt sie in Ruhe
}
export function starterCampaign(kind: "kaltakquise" | "angebot" | "aufwecken" = "kaltakquise") {
  if (kind === "angebot") return { tree: followUpTree({ first: starterBlocks("angebot"), second: starterBlocks("nachfassen") }, { firstSubject: "Noch Fragen zu unserem Angebot, {{vorname}}?", secondSubject: "Kurz nachgefragt: unser Angebot für {{firma}}", waitHours: 96 }), design: DEFAULT_DESIGN, name: "Nachfassen nach Angebot" };
  if (kind === "aufwecken") return { tree: followUpTree({ first: starterBlocks("aufwecken"), second: starterBlocks("nachfassen") }, { firstSubject: "Passt es gerade nicht, {{vorname}}?", secondSubject: "Letzte Nachricht von mir, {{vorname}}", waitHours: 120 }), design: DEFAULT_DESIGN, name: "Eingeschlafene Kontakte aufwecken" };
  return { tree: starterTree({ first: starterBlocks("kaltakquise"), followUp: starterBlocks("nachfassen") }), design: DEFAULT_DESIGN, name: "" };
}
/** Kampagne oder Vorlage kopieren (Ablauf + Design, ohne Empfänger) – als neue Kampagne oder als Vorlage. */
export async function duplicateEmailCampaign(db: Db, tenantId: number, userId: number, input: { id: number; name?: string | null; asTemplate?: boolean }) {
  const row = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, input.id), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Kampagne nicht gefunden.");
  const name = (input.name?.trim() || `${row.name} ${input.asTemplate ? "(Vorlage)" : "(Kopie)"}`).slice(0, 160);
  const inserted = await db.insert(emailCampaigns).values({ tenantId, name, status: "entwurf", fromName: row.fromName, fromEmail: row.fromEmail, replyTo: row.replyTo, audience: withoutLists(row.audience as Audience | null), /* Listen der alten Kampagne werden nie mitkopiert – auch nicht in Vorlagen */ tree: row.tree, design: row.design, sendWindow: row.sendWindow, isTemplate: Boolean(input.asTemplate), abSplit: row.abSplit, stopOnReply: stopsOnReply(row), maxRuns: maxRunsOf(row), reviewFirst: row.reviewFirst, kiModus: row.kiModus, kiAnsatz: row.kiAnsatz, createdByUserId: userId });
  return { id: Number(inserted[0]?.insertId) || 0, name };
}
/** Listen gehören nie in Kopien oder Vorlagen – Stufe/Tag/Alle bleiben erhalten. */
export function withoutLists(audience: Audience | null | undefined): Audience { return !audience ? { source: "alle" } : audience.source === "liste" ? listAudience([]) : audience; }
export async function setEmailCampaignTemplate(db: Db, tenantId: number, id: number, isTemplate: boolean) { const row = (await db.select({ audience: emailCampaigns.audience }).from(emailCampaigns).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; await db.update(emailCampaigns).set({ isTemplate, audience: withoutLists((row?.audience ?? null) as Audience | null) }).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.tenantId, tenantId))); return { success: true as const }; }
const ARCHIVED_HINT = "Die Kampagne liegt im Archiv – bitte zuerst wiederherstellen.";
/**
 * Kampagne ins Archiv legen oder wieder herausholen. Archivierte Kampagnen bleiben mit allen Empfängern und Zahlen erhalten,
 * verschwinden aber aus der Übersicht und nehmen keine Kontakte mehr auf. Läuft die Kampagne noch, wird sie dabei beendet –
 * offene Empfänger bekommen keine weitere E-Mail. Wiederherstellen setzt sie als „Beendet“ zurück (Fortsetzen über „Weiterer Durchlauf“).
 */
export async function archiveEmailCampaign(db: Db, tenantId: number, id: number, archived: boolean) {
  const row = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Kampagne nicht gefunden.");
  if (row.isTemplate) throw new Error("Vorlagen lassen sich nicht archivieren – sie liegen schon im Vorlagen-Fenster.");
  if (archived === Boolean(row.archivedAt)) return { success: true as const, status: row.status, archived };
  const status = archived && (row.status === "aktiv" || row.status === "pausiert") ? "beendet" : row.status;
  await db.update(emailCampaigns).set({ archivedAt: archived ? new Date() : null, status }).where(eq(emailCampaigns.id, id));
  await logActivity(db, tenantId, { kind: "kampagne", title: archived ? `Kampagne „${row.name}“ archiviert` : `Kampagne „${row.name}“ aus dem Archiv geholt`, detail: archived && status !== row.status ? "Die Kampagne lief noch und wurde dabei beendet – offene Kontakte bekommen keine weitere E-Mail." : null, refType: "emailCampaign", refId: id });
  return { success: true as const, status, archived };
}
export async function deleteEmailCampaign(db: Db, tenantId: number, id: number) { await db.delete(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.campaignId, id))); await db.delete(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, id))); await db.delete(emailCampaigns).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.tenantId, tenantId))); return { success: true as const }; }
async function audienceContacts(db: Db, tenantId: number, audience: Audience) {
  const conditions = [eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb")]; // Zielgruppen bestehen nur aus Vertriebskontakten – nie aus Leads zum Verkauf
  if (isPickAudience(audience)) return []; // „Nur ausgewählte Kontakte“: niemand kommt automatisch dazu
  const lists = audienceLists(audience); if (audience.source === "liste" && !lists.length) return []; // Zielgruppe „Liste“ ohne Liste = niemand (nie „alle“)
  if (lists.length) conditions.push(inArray(leads.listName, lists));
  if (audience.source === "stufe" && audience.stage) conditions.push(eq(leads.pipelineStage, audience.stage));
  let rows = await db.select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, email: leads.email, company: leads.company, city: leads.city, metadata: leads.metadata }).from(leads).where(and(...conditions));
  if (audience.source === "tag" && audience.tagId) { const tagged = new Set((await db.select({ leadId: leadTagAssignments.leadId }).from(leadTagAssignments).where(eq(leadTagAssignments.tagId, audience.tagId))).map((row) => row.leadId)); rows = rows.filter((row) => tagged.has(row.id)); }
  return rows;
}
const validEmail = (email: string | null | undefined): email is string => Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
async function audienceLeads(db: Db, tenantId: number, audience: Audience) {
  const rows = await audienceContacts(db, tenantId, audience); const blocked = await suppressedSet(db, tenantId);
  return rows.filter((row) => validEmail(row.email) && !blocked.has(row.email!.toLowerCase()));
}
/**
 * Wie steht die Zielgruppe einer Kampagne? Kontakte gesamt, ohne gültige E-Mail, gesperrt – und wie viele noch nicht
 * aufgenommen sind („warten“), z. B. weil sie nach dem Start in die Liste kamen.
 */
/** Zielgruppe gegen die Empfänger abgleichen: wer fehlt noch, wer ist gar nicht mehr in der Zielgruppe (z. B. gelöschter Testkontakt). */
async function audienceInfo(db: Db, tenantId: number, audience: Audience, enrolled: Array<{ id: number; email: string; pickedAt?: Date | null }>, blocked: Set<string>) {
  if (isPickAudience(audience)) return { total: enrolled.length, noEmail: 0, blocked: 0, pending: 0, outside: 0, outsideIds: [] as number[], picked: true, handPicked: enrolled.length }; // von Hand aufgenommen = die Zielgruppe
  const rows = await audienceContacts(db, tenantId, audience);
  const enrolledEmails = new Set(enrolled.map((item) => item.email.toLowerCase()));
  let noEmail = 0; let suppressed = 0; let pending = 0; const seen = new Set<string>(); const inAudience = new Set<string>();
  for (const row of rows) { if (row.email) inAudience.add(row.email.toLowerCase()); if (!validEmail(row.email)) { noEmail += 1; continue; } const key = row.email.toLowerCase(); if (blocked.has(key)) { suppressed += 1; continue; } if (seen.has(key)) continue; seen.add(key); if (!enrolledEmails.has(key)) pending += 1; }
  const outsideIds = enrolled.filter((item) => !item.pickedAt && !inAudience.has(item.email.toLowerCase())).map((item) => item.id); // von Hand aufgenommene gehören dazu – nie „nicht mehr in der Liste“
  const handPicked = enrolled.filter((item) => item.pickedAt && !inAudience.has(item.email.toLowerCase())).length;
  return { total: rows.length, noEmail, blocked: suppressed, pending, outside: outsideIds.length, outsideIds, picked: false, handPicked };
}
/**
 * Zielgruppe prüfen: Anzahl und die ersten Empfänger – jeweils mit allen Platzhalter-Werten,
 * damit sich die E-Mail im Builder mit echten Daten ansehen lässt, bevor sie rausgeht.
 */
export async function previewAudience(db: Db, tenantId: number, audience: Audience & { campaignId?: number | null }) {
  if (isPickAudience(audience)) {
    if (!audience.campaignId) return { count: 0, sample: [] };
    const picked = await db.select({ email: emailCampaignRecipients.email, name: emailCampaignRecipients.name, company: emailCampaignRecipients.company, leadId: emailCampaignRecipients.leadId }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, audience.campaignId))).orderBy(desc(emailCampaignRecipients.createdAt));
    const leadIds = picked.slice(0, 5).map((row) => row.leadId).filter((id): id is number => typeof id === "number");
    const leadRows = leadIds.length ? await db.select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, email: leads.email, company: leads.company, city: leads.city, metadata: leads.metadata }).from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, leadIds))) : [];
    const sample = picked.slice(0, 5).map((row) => { const lead = leadRows.find((item) => item.id === row.leadId); return { name: lead ? `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() : row.name ?? "", email: row.email, company: lead?.company ?? row.company ?? null, values: recipientValues({ firstName: lead?.firstName, lastName: lead?.lastName, company: lead?.company ?? row.company, city: lead?.city, salutation: (lead?.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata) ? (lead.metadata as { salutation?: string }).salutation : null) ?? null, email: row.email, fields: extraFieldsOf(lead?.metadata ?? null) }, null) }; });
    return { count: picked.length, sample };
  }
  const rows = await audienceLeads(db, tenantId, audience);
  const sample = rows.slice(0, 5).map((row) => ({
    name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(), email: row.email, company: row.company,
    values: recipientValues({ firstName: row.firstName, lastName: row.lastName, company: row.company, city: row.city, salutation: (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as { salutation?: string }).salutation : null) ?? null, email: row.email, fields: extraFieldsOf(row.metadata) }, null),
  }));
  return { count: rows.length, sample };
}
/** Kontakte in eine Kampagne aufnehmen (ohne Doppelte, Mehrfach-Durchlauf beachten) – beim Start und beim Hinzufügen von Listen. */
async function enrollRecipients(db: Db, tenantId: number, campaign: EmailCampaign, rows: Awaited<ReturnType<typeof audienceLeads>>, options: { onlyNew?: boolean; picked?: boolean } = {}) {
  const id = campaign.id;
  const previousRows = await db.select({ email: emailCampaignRecipients.email, status: emailCampaignRecipients.status, repliedAt: emailCampaignRecipients.repliedAt }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, id)));
  const previousOf = new Map<string, Array<{ status: string; repliedAt: Date | null }>>(); for (const row of previousRows) { const key = row.email.toLowerCase(); previousOf.set(key, [...(previousOf.get(key) ?? []), row]); }
  const maxRuns = maxRunsOf(campaign); const abTest = hasAbTest(tree(campaign)); let index = previousRows.length;
  let added = 0; let skipped = 0; let repeated = 0;
  for (const row of rows) { const previous = previousOf.get(row.email!.toLowerCase()) ?? []; if ((options.onlyNew && previous.length) || !canEnroll(previous, maxRuns).ok) { skipped += 1; continue; } previousOf.set(row.email!.toLowerCase(), [...previous, { status: "wartet", repliedAt: null }]); if (previous.length) repeated += 1; const current = (await db.select({ platform: leads.adPlatform, stage: leads.pipelineStage }).from(leads).where(eq(leads.id, row.id)).limit(1))[0]; if (current && !current.platform) { await db.update(leads).set({ adPlatform: "email", adCampaignId: `email-${id}`, adCampaignName: campaign.name, pipelineStage: current.stage ?? "neu", pipelineUpdatedAt: new Date() }).where(eq(leads.id, row.id)); await db.insert(pipelineEvents).values({ tenantId, leadId: row.id, fromStage: null, toStage: current.stage ?? "neu", actorUserId: null, note: `In E-Mail-Kampagne „${campaign.name}“ aufgenommen` }); }
    await db.insert(emailCampaignRecipients).values({ tenantId, campaignId: id, leadId: row.id, email: row.email!, name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || null, company: row.company ?? null, token: crypto.randomBytes(16).toString("hex"), nodeId: tree(campaign).start, nextActionAt: new Date(Date.now() - 2000), status: "wartet", sentCount: 0, variant: abTest ? abVariantFor(index, campaign.abSplit) : null, pickedAt: options.picked ? new Date() : null }); index += 1; added += 1; } /* 2 s in der Vergangenheit: MySQL rundet Sekunden auf */
  return { added, skipped, repeated, maxRuns };
}
/** Empfänger wirklich aus einer Kampagne nehmen: Empfänger-Zeile und ihr Verlauf weg, keine weitere E-Mail. Der Kontakt selbst bleibt. */
async function deleteRecipients(db: Db, tenantId: number, campaignId: number, recipientIds: number[]) {
  if (!recipientIds.length) return 0;
  await db.update(inboxMessages).set({ campaignRecipientId: null }).where(and(eq(inboxMessages.tenantId, tenantId), inArray(inboxMessages.campaignRecipientId, recipientIds)));
  await db.delete(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.campaignId, campaignId), inArray(emailCampaignEvents.recipientId, recipientIds)));
  await db.delete(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaignId), inArray(emailCampaignRecipients.id, recipientIds)));
  return recipientIds.length;
}
/** Einzelne Empfänger aus einer Kampagne entfernen. */
/** Empfänger entfernen, die nicht mehr in der Zielgruppe sind (z. B. gelöschte Testkontakte) – damit die Zahlen nur echte Kontakte zählen. */
export async function pruneEmailCampaignRecipients(db: Db, tenantId: number, id: number) {
  const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!campaign) throw new Error("Kampagne nicht gefunden.");
  const enrolled = await db.select({ id: emailCampaignRecipients.id, email: emailCampaignRecipients.email, pickedAt: emailCampaignRecipients.pickedAt }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, id)));
  const info = await audienceInfo(db, tenantId, (campaign.audience ?? { source: "alle" }) as Audience, enrolled, await suppressedSet(db, tenantId));
  const removed = await deleteRecipients(db, tenantId, id, info.outsideIds); // von Hand aufgenommene sind nie dabei
  return { removed };
}
/**
 * Kontakte von Hand aus dem E-Mail-Funnel nehmen: laufende Serien stoppen (keine weitere E-Mail), Verlauf und Zahlen bleiben,
 * der Kontakt wird nicht wieder automatisch aufgenommen. Lässt sich über „Rückgängig“ zurücknehmen.
 */
export async function stopLeadsInCampaigns(db: Db, tenantId: number, input: { leadIds: number[]; campaignId?: number | null; actorUserId?: number | null }) {
  const ids = Array.from(new Set(input.leadIds)).slice(0, 5000); if (!ids.length) return { stopped: 0, undoId: 0 };
  const rows = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), inArray(emailCampaignRecipients.leadId, ids), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]), ...(input.campaignId ? [eq(emailCampaignRecipients.campaignId, input.campaignId)] : [])));
  return stopRecipientRows(db, tenantId, rows, input.actorUserId ?? null);
}
/** Einzelnen Empfänger (z. B. aus der Liste im E-Mail-Builder) aus dem Funnel nehmen. */
export async function stopRecipientInCampaign(db: Db, tenantId: number, recipientId: number, actorUserId: number | null) {
  const rows = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.id, recipientId), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"])));
  if (!rows.length) throw new Error("Dieser Kontakt steckt in keiner laufenden Serie mehr.");
  return stopRecipientRows(db, tenantId, rows, actorUserId);
}
async function stopRecipientRows(db: Db, tenantId: number, rows: Array<typeof emailCampaignRecipients.$inferSelect>, actorUserId: number | null) {
  const items: Array<{ recipientId: number; status: string; nodeId: string | null; nextActionAt: Date | null; eventId: number }> = [];
  for (const row of rows) {
    await db.update(emailCampaignRecipients).set({ status: "fertig", nodeId: null, nextActionAt: null }).where(eq(emailCampaignRecipients.id, row.id));
    const inserted = await db.insert(emailCampaignEvents).values({ tenantId, campaignId: row.campaignId, recipientId: row.id, nodeId: row.nodeId, kind: "beendet", note: "Von Hand aus dem E-Mail-Funnel genommen – keine weitere E-Mail" });
    items.push({ recipientId: row.id, status: row.status, nodeId: row.nodeId, nextActionAt: row.nextActionAt, eventId: Number(inserted[0]?.insertId) || 0 });
  }
  let undoId = 0;
  if (items.length) { const { recordUndo } = await import("./undo"); const names = rows.length === 1 ? (rows[0].name || rows[0].email) : `${new Set(rows.map((row) => row.leadId)).size} Kontakte`; undoId = await recordUndo(db, tenantId, { kind: "serie", title: `${names}: aus dem E-Mail-Funnel genommen`, count: items.length, actorUserId, payload: { items } }).catch(() => 0); }
  return { stopped: items.length, undoId };
}
export async function removeEmailRecipients(db: Db, tenantId: number, input: { campaignId: number; recipientIds: number[] }) {
  const campaign = (await db.select({ id: emailCampaigns.id, name: emailCampaigns.name }).from(emailCampaigns).where(and(eq(emailCampaigns.id, input.campaignId), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!campaign) throw new Error("Kampagne nicht gefunden.");
  const ids = (await db.select({ id: emailCampaignRecipients.id }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaign.id), inArray(emailCampaignRecipients.id, input.recipientIds)))).map((row) => row.id);
  const removed = await deleteRecipients(db, tenantId, campaign.id, ids);
  if (removed) await logActivity(db, tenantId, { kind: "kampagne", title: `Kampagne „${campaign.name}“: ${removed} Empfänger entfernt`, refType: "emailCampaign", refId: campaign.id });
  return { removed };
}
/**
 * Listen aus einer Kampagne nehmen: Zielgruppe ohne diese Listen, und alle Empfänger aus diesen Listen kommen raus
 * (außer sie stecken auch in einer Liste, die bleibt).
 */
export async function removeListsFromEmailCampaign(db: Db, tenantId: number, input: { id: number; listNames: string[]; keepAudience?: boolean }) {
  const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, input.id), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!campaign) throw new Error("Kampagne nicht gefunden.");
  const gone = Array.from(new Set(input.listNames.map((name) => name.trim()).filter(Boolean))); if (!gone.length) return { removed: 0, lists: audienceLists((campaign.audience ?? null) as Audience | null) };
  const remaining = audienceLists((campaign.audience ?? null) as Audience | null).filter((name) => !gone.includes(name));
  if (!input.keepAudience) await db.update(emailCampaigns).set({ audience: listAudience(remaining) }).where(eq(emailCampaigns.id, campaign.id));
  const recipients = await db.select({ id: emailCampaignRecipients.id, listName: leads.listName }).from(emailCampaignRecipients).innerJoin(leads, eq(leads.id, emailCampaignRecipients.leadId)).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaign.id)));
  const ids = recipients.filter((row) => row.listName && gone.includes(row.listName) && !remaining.includes(row.listName)).map((row) => row.id);
  const removed = await deleteRecipients(db, tenantId, campaign.id, ids);
  if (removed || !input.keepAudience) await logActivity(db, tenantId, { kind: "kampagne", title: `Kampagne „${campaign.name}“: ${gone.length === 1 ? `Liste „${gone[0]}“` : `${gone.length} Listen`} entfernt`, detail: `${removed} Empfänger herausgenommen`, refType: "emailCampaign", refId: campaign.id });
  return { removed, lists: remaining };
}
/**
 * Einzelne Kontakte (z. B. aus einer Liste) in eine Kampagne nehmen – unabhängig von der Zielgruppe. Läuft die Kampagne,
 * bekommen sie die Serie sofort; im Entwurf warten sie und starten mit der Kampagne. Ohne E-Mail, gesperrt oder schon drin → übersprungen.
 */
export async function addLeadsToEmailCampaign(db: Db, tenantId: number, input: { id: number; leadIds: number[] }, appUrl: string) {
  const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, input.id), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!campaign) throw new Error("Kampagne nicht gefunden.");
  if (campaign.isTemplate) throw new Error("Das ist eine Vorlage – bitte zuerst eine Kampagne daraus anlegen.");
  if (campaign.archivedAt) throw new Error(ARCHIVED_HINT);
  const ids = Array.from(new Set(input.leadIds)).slice(0, 5000); if (!ids.length) throw new Error("Bitte mindestens einen Kontakt auswählen.");
  // Entwurf mit Zielgruppe „Liste“, aber ohne Liste: die Kampagne lebt offensichtlich von Hand ausgewählten Kontakten → Zielgruppe „Nur ausgewählte Kontakte“
  const current = (campaign.audience ?? { source: "alle" }) as Audience;
  if (campaign.status === "entwurf" && current.source === "liste" && !audienceLists(current).length) await db.update(emailCampaigns).set({ audience: { source: "auswahl" } }).where(eq(emailCampaigns.id, campaign.id));
  const rows = await db.select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, email: leads.email, company: leads.company, city: leads.city, metadata: leads.metadata }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), inArray(leads.id, ids)));
  const blocked = await suppressedSet(db, tenantId);
  const noEmail = rows.filter((row) => !validEmail(row.email)).length; const suppressed = rows.filter((row) => validEmail(row.email) && blocked.has(row.email.toLowerCase())).length;
  const usable = rows.filter((row) => validEmail(row.email) && !blocked.has(row.email!.toLowerCase()));
  const result = await enrollRecipients(db, tenantId, campaign, usable, { onlyNew: true, picked: true });
  if (result.added) {
    if (campaign.status === "beendet") await db.update(emailCampaigns).set({ status: "aktiv" }).where(eq(emailCampaigns.id, campaign.id));
    await logActivity(db, tenantId, { kind: "kampagne", title: `Kampagne „${campaign.name}“: ${result.added} Kontakt${result.added === 1 ? "" : "e"} einzeln hinzugefügt`, refType: "emailCampaign", refId: campaign.id });
    if (campaign.status === "aktiv" || campaign.status === "beendet") void processEmailCampaigns(db, appUrl, { campaignId: campaign.id, limit: 25 }).catch((error) => console.error("[E-Mail-Kampagnen] Einzeln:", error instanceof Error ? error.message : error));
  }
  return { added: result.added, already: result.skipped, noEmail, blocked: suppressed, status: campaign.status };
}
/** Laufende Kampagne: alle Kontakte der Zielgruppe aufnehmen, die noch nie drin waren (z. B. nach dem Start in die Liste gekommen). */
export async function syncEmailCampaignAudience(db: Db, tenantId: number, id: number, appUrl: string) {
  const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!campaign) throw new Error("Kampagne nicht gefunden.");
  if (campaign.isTemplate) throw new Error("Das ist eine Vorlage."); if (campaign.status === "entwurf") throw new Error("Die Kampagne ist noch nicht gestartet – „Starten“ nimmt alle Kontakte auf."); if (campaign.archivedAt) throw new Error(ARCHIVED_HINT);
  const rows = await audienceLeads(db, tenantId, (campaign.audience ?? { source: "alle" }) as Audience);
  const result = await enrollRecipients(db, tenantId, campaign, rows, { onlyNew: true });
  if (result.added) {
    if (campaign.status === "beendet") await db.update(emailCampaigns).set({ status: "aktiv" }).where(eq(emailCampaigns.id, id));
    await logActivity(db, tenantId, { kind: "kampagne", title: `Kampagne „${campaign.name}“: ${result.added} neue Kontakte aufgenommen`, detail: "Kontakte, die nach dem Start in die Zielgruppe kamen", refType: "emailCampaign", refId: id });
    if (campaign.status !== "pausiert") void processEmailCampaigns(db, appUrl, { campaignId: id, limit: 1000 }).catch((error) => console.error("[E-Mail-Kampagnen] Nachaufnahme:", error instanceof Error ? error.message : error));
  }
  return { added: result.added, paused: campaign.status === "pausiert" };
}
/** Nach einem Listen-Upload: laufende Kampagnen mit dieser Liste nehmen die neuen Kontakte sofort auf. */
export async function enrollListIntoRunningCampaigns(db: Db, tenantId: number, listName: string, appUrl: string) {
  const running = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.tenantId, tenantId), inArray(emailCampaigns.status, ["aktiv", "pausiert"])))).filter((row) => !row.isTemplate && audienceLists((row.audience ?? null) as Audience | null).includes(listName));
  const out: Array<{ id: number; name: string; added: number }> = [];
  for (const campaign of running) {
    const rows = await audienceLeads(db, tenantId, listAudience([listName]));
    const result = await enrollRecipients(db, tenantId, campaign, rows, { onlyNew: true });
    if (!result.added) continue; out.push({ id: campaign.id, name: campaign.name, added: result.added });
    await logActivity(db, tenantId, { kind: "kampagne", title: `Kampagne „${campaign.name}“: ${result.added} neue Kontakte aus „${listName}“ aufgenommen`, detail: "Automatisch nach dem Listen-Upload", refType: "emailCampaign", refId: campaign.id });
    if (campaign.status === "aktiv") void processEmailCampaigns(db, appUrl, { campaignId: campaign.id, limit: 25 }).catch((error) => console.error("[E-Mail-Kampagnen] Upload:", error instanceof Error ? error.message : error));
  }
  return out;
}
/**
 * Hochgeladene Listen zu einer Kampagne hinzufügen. Die Zielgruppe wird um die Listen ergänzt; läuft die Kampagne schon
 * (aktiv/pausiert), werden die neuen Kontakte sofort aufgenommen – im Entwurf passiert das beim Start.
 */
export async function addListsToEmailCampaign(db: Db, tenantId: number, input: { id: number; listNames: string[] }, appUrl: string) {
  const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, input.id), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!campaign) throw new Error("Kampagne nicht gefunden.");
  if (campaign.archivedAt) throw new Error(ARCHIVED_HINT);
  const added = Array.from(new Set(input.listNames.map((name) => name.trim()).filter(Boolean))); if (!added.length) throw new Error("Bitte mindestens eine Liste wählen.");
  const before = (campaign.audience ?? { source: "alle" }) as Audience;
  if (isPickAudience(before)) await markAllPicked(db, tenantId, campaign.id); // bisher nur von Hand: diese Kontakte bleiben drin, die Listen kommen dazu
  const audience = listAudience([...audienceLists(before), ...added]);
  await db.update(emailCampaigns).set({ audience }).where(eq(emailCampaigns.id, campaign.id));
  const running = campaign.status === "aktiv" || campaign.status === "pausiert" || campaign.status === "beendet";
  let enrolled = { added: 0, skipped: 0, repeated: 0, maxRuns: maxRunsOf(campaign) };
  if (running && !campaign.isTemplate) {
    const rows = await audienceLeads(db, tenantId, listAudience(added));
    enrolled = await enrollRecipients(db, tenantId, { ...campaign, audience }, rows, { onlyNew: true });
    if (campaign.status === "beendet" && enrolled.added) await db.update(emailCampaigns).set({ status: "aktiv" }).where(eq(emailCampaigns.id, campaign.id));
    await logActivity(db, tenantId, { kind: "kampagne", title: `Kampagne „${campaign.name}“: ${added.length === 1 ? `Liste „${added[0]}“` : `${added.length} Listen`} hinzugefügt`, detail: `${enrolled.added} Empfänger aufgenommen${enrolled.skipped ? ` · ${enrolled.skipped} schon dabei oder gesperrt` : ""}`, refType: "emailCampaign", refId: campaign.id });
    if (enrolled.added && campaign.status !== "pausiert") void processEmailCampaigns(db, appUrl, { campaignId: campaign.id, limit: 25 }).catch((error) => console.error("[E-Mail-Kampagnen] Listen:", error instanceof Error ? error.message : error));
  }
  return { lists: audience.listNames, added: enrolled.added, skipped: enrolled.skipped, running, paused: campaign.status === "pausiert" };
}
/** Kampagne starten: Empfänger aus der Zielgruppe anlegen (ohne Doppelte) und sofort den ersten Schritt ausführen. */
export async function startEmailCampaign(db: Db, tenantId: number, id: number, appUrl: string) {
  const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!campaign) throw new Error("Kampagne nicht gefunden.");
  if (campaign.isTemplate) throw new Error("Das ist eine Vorlage – bitte zuerst „Aus Vorlage anlegen“ und dann die Kampagne starten.");
  if (campaign.archivedAt) throw new Error(ARCHIVED_HINT);
  let audience = (campaign.audience ?? { source: "alle" }) as Audience;
  const pickedCount = (await db.select({ id: emailCampaignRecipients.id }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, id)))).length;
  if (audience.source === "liste" && !audienceLists(audience).length) {
    if (!pickedCount) throw new Error("Bitte zuerst eine Liste als Zielgruppe wählen – oder unter „Kontakte“ Kontakte markieren und in die Kampagne aufnehmen.");
    audience = { source: "auswahl" }; await db.update(emailCampaigns).set({ audience }).where(eq(emailCampaigns.id, id)); // nur von Hand aufgenommene Kontakte – so bleibt es auch
  }
  const issues = validateTree(tree(campaign)); if (issues.length) throw new Error(issues.join(" "));
  const rows = await audienceLeads(db, tenantId, audience);
  if (!rows.length && !(isPickAudience(audience) && pickedCount)) throw new Error(isPickAudience(audience) ? "Noch keine Kontakte ausgewählt – unter „Kontakte“ Kontakte markieren und „In Kampagne aufnehmen“ wählen." : "Die Zielgruppe enthält keine Kontakte mit E-Mail-Adresse.");
  const waitingRows = await db.select({ email: emailCampaignRecipients.email }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, id), eq(emailCampaignRecipients.sentCount, 0), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]))); // schon drin (von Hand aufgenommen) – starten jetzt mit
  const audienceEmails = new Set(rows.map((row) => row.email!.toLowerCase())); const waitingInAudience = waitingRows.filter((row) => audienceEmails.has(row.email.toLowerCase())).length;
  const enrolled = await enrollRecipients(db, tenantId, campaign, rows);
  const { repeated, maxRuns } = enrolled; const added = enrolled.added + waitingRows.length; const skipped = Math.max(0, enrolled.skipped - waitingInAudience); // wer schon drin war und jetzt startet, zählt als aufgenommen, nicht als übersprungen
  await db.update(emailCampaigns).set({ status: "aktiv", startedAt: campaign.startedAt ?? new Date() }).where(eq(emailCampaigns.id, id));
  await logActivity(db, tenantId, { kind: "kampagne", title: `Kampagne „${campaign.name}“ gestartet`, detail: `${added} Empfänger aufgenommen${repeated ? ` (${repeated} erneut)` : ""}${skipped ? ` · ${skipped} übersprungen (${maxRunsLabel(maxRuns)})` : ""}`, refType: "emailCampaign", refId: id });
  // Versand läuft im Hintergrund (SMTP kann dauern) – die Anfrage kehrt sofort zurück; der Zeitplaner nimmt den Rest.
  const processed = await Promise.race([processEmailCampaigns(db, appUrl, { campaignId: id, limit: 1000 }).catch((error) => { console.error("[E-Mail-Kampagnen] Start:", error instanceof Error ? error.message : error); return 0; }), new Promise<number>((resolve) => setTimeout(() => resolve(-1), 4000))]);
  return { added, repeated, skipped, maxRuns, processed: Math.max(processed, 0), background: processed < 0 };
}
export async function setEmailCampaignStatus(db: Db, tenantId: number, id: number, status: "aktiv" | "pausiert" | "beendet") {
  if (status !== "beendet") { const row = (await db.select({ archivedAt: emailCampaigns.archivedAt }).from(emailCampaigns).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (row?.archivedAt) throw new Error(ARCHIVED_HINT); }
  await db.update(emailCampaigns).set({ status }).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.tenantId, tenantId))); return { success: true as const };
}
/** Zeitplaner: fällige Empfänger aller aktiven Kampagnen weiterführen. */
export async function processEmailCampaigns(db: Db, appUrl: string, options: { campaignId?: number; limit?: number; ignoreDrip?: boolean } = {}) {
  const now = new Date(); const horizon = new Date(now.getTime() + 1500); const base = appUrl.replace(/\/+$/, ""); /* horizon: Toleranz für Sekundenrundung der DB */
  const campaignConditions = [eq(emailCampaigns.status, "aktiv")]; if (options.campaignId) campaignConditions.push(eq(emailCampaigns.id, options.campaignId));
  let active = await db.select().from(emailCampaigns).where(and(...campaignConditions)); let processed = 0;
  let moved = 0; for (const tenantId of Array.from(new Set(active.map((campaign) => campaign.tenantId)))) moved += await migrateSendWindows(db, tenantId).catch(() => 0);
  if (moved) active = await db.select().from(emailCampaigns).where(and(...campaignConditions)); // neue Versandzeiten gelten sofort
  await enforceReplyStop(db, Array.from(new Set(active.map((campaign) => campaign.tenantId)))).catch((error) => console.error("[E-Mail-Kampagnen] Antwort-Stopp:", error instanceof Error ? error.message : error)); // Sicherheitsnetz: geantwortet → beendet, bevor etwas rausgeht
  const throttleOff = process.env.EMAIL_THROTTLE_OFF === "1"; // nur für Tests: kein Drip, kein Tageslimit
  // Zusätzliche Absender-Adressen: jeder Kontakt bekommt fest „seine" Adresse (Antworten bleiben im Faden), jede mit eigenem Tagesbudget
  const senderPools = new Map<number, Awaited<ReturnType<typeof import("./mail-health")["senderPoolFor"]>>>();
  const poolFor = async (tenantId: number) => { if (!senderPools.has(tenantId)) { const { senderPoolFor } = await import("./mail-health"); senderPools.set(tenantId, await senderPoolFor(db, tenantId).catch(() => null)); } return senderPools.get(tenantId) ?? null; };
  // Tageslimit für alle Kampagnen eines Mandanten zusammen (Standard 80/Tag) – schützt die Absender-Adresse
  const dayLeft = new Map<number, number>();
  const dailyLeft = async (tenantId: number) => { if (throttleOff) return Number.POSITIVE_INFINITY; if (!dayLeft.has(tenantId)) { const status = await campaignDailyStatus(db, tenantId); dayLeft.set(tenantId, status.left); } return dayLeft.get(tenantId) ?? 0; };
  for (const campaign of active) {
    let sentInRun = 0; let failedInRun = 0; let lastFailure: string | null = null;
    if ((await dailyLeft(campaign.tenantId)) <= 0) continue; // Tageslimit erreicht – morgen geht es weiter
    // Drip-Versand: verteilt statt alles auf einmal (Zustellbarkeit) – höchstens X pro Stunde, mit zufälligem Abstand
    const drip = resolveDrip(sendWindowOf(campaign).drip);
    let budget = Number.POSITIVE_INFINITY;
    if (drip.enabled && !options.ignoreDrip && !throttleOff) {
      const hourAgo = new Date(now.getTime() - 3_600_000);
      const [{ sent }] = await db.select({ sent: sql<number>`count(*)` }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.campaignId, campaign.id), eq(emailCampaignEvents.kind, "gesendet"), gte(emailCampaignEvents.createdAt, hourAgo)));
      const last = (await db.select({ at: emailCampaignRecipients.lastSentAt }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId, campaign.id), isNotNull(emailCampaignRecipients.lastSentAt))).orderBy(desc(emailCampaignRecipients.lastSentAt)).limit(1))[0]?.at ?? null;
      budget = dripBudget(drip, Number(sent) || 0, last, now);
      if (budget <= 0) continue;
    }
    const signature = await signatureFor(db, campaign.tenantId, base).then((result) => ({ html: result.html, text: result.text })).catch(() => null); // Signatur aus den E-Mail-Einstellungen – hängt an jeder Kampagnen-Mail
    // KI-Versand: „freigabe“ = jede E-Mail (jeder Schritt) braucht deine Freigabe – die Sperre sitzt direkt vor dem Senden (defer).
    // „auto“ = die KI schreibt jede E-Mail im Hintergrund direkt vor dem Versand. „aus“ = Vorlagen wie immer.
    const kiModus = kiModusOf(campaign); const kiAnsatz = kiAnsatzOf(campaign);
    let kiBudget = 4; // höchstens so viele KI-Entwürfe je Kampagne und Lauf (Webseite lesen + schreiben dauert) – der Rest ist in der nächsten Minute dran
    const campaignTree = tree(campaign);
    const due = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId, campaign.id), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]), or(isNull(emailCampaignRecipients.nextActionAt), lte(emailCampaignRecipients.nextActionAt, horizon)))).limit(options.limit ?? 100);
    for (const recipient of due) {
      if (sentInRun >= budget) break; // Drip: für diesen Durchlauf genug – der Rest folgt in den nächsten Minuten
      if (sentInRun >= (await dailyLeft(campaign.tenantId))) break; // Tageslimit (alle Kampagnen zusammen) für heute erreicht
      // Empfänger kurz „reservieren“: nur wer ihn hier bekommt, verschickt – zwei gleichzeitige Durchläufe (Start + Minutentakt, zwei Server) senden nie doppelt
      const claim = await db.update(emailCampaignRecipients).set({ nextActionAt: new Date(now.getTime() + 10 * 60_000) }).where(and(eq(emailCampaignRecipients.id, recipient.id), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]), recipient.nextActionAt ? eq(emailCampaignRecipients.nextActionAt, recipient.nextActionAt) : isNull(emailCampaignRecipients.nextActionAt)));
      const claimed = (claim as unknown as [{ affectedRows?: number }] | undefined)?.[0]?.affectedRows; if (claimed === 0) continue;
      const lead = recipient.leadId ? (await db.select().from(leads).where(eq(leads.id, recipient.leadId)).limit(1))[0] : null;
      const values = recipientValues({ firstName: lead?.firstName ?? recipient.name?.split(" ")[0], lastName: lead?.lastName ?? recipient.name?.split(" ").slice(1).join(" "), company: lead?.company ?? recipient.company, city: lead?.city, salutation: (lead?.metadata as { salutation?: string } | null)?.salutation ?? null, email: recipient.email, fields: extraFieldsOf(lead?.metadata) }, `${base}/api/mail/u/${recipient.token}`);
      // Verlauf des Empfängers: läuft gerade eine Wartezeit (dann steht er am Warten-Schritt) und welche E-Mails hat er schon – nie doppelt, Ablaufänderungen gelten auch für Wartende
      const history = await db.select({ id: emailCampaignEvents.id, kind: emailCampaignEvents.kind, nodeId: emailCampaignEvents.nodeId, createdAt: emailCampaignEvents.createdAt }).from(emailCampaignEvents).where(eq(emailCampaignEvents.recipientId, recipient.id));
      const waiting = resolveWaiting(campaignTree, recipient, history);
      const state: RecipientState = { nodeId: waiting.nodeId, waitingAt: waiting.waitingAt, sentNodeIds: waiting.sentNodeIds, nextActionAt: recipient.nextActionAt && recipient.nextActionAt <= horizon ? null : recipient.nextActionAt, status: recipient.status as RecipientState["status"], sentCount: recipient.sentCount, openedAt: recipient.openedAt, clickedAt: recipient.clickedAt, repliedAt: recipient.repliedAt, lastSentAt: recipient.lastSentAt, variant: (recipient.variant ?? null) as RecipientState["variant"], clickedUrls: (Array.isArray(recipient.clickedUrls) ? recipient.clickedUrls : []) as string[] };
      // Freigegebener Entwurf: ersetzt Betreff und Text der ersten E-Mail (Knopf und Signatur der Vorlage bleiben)
      // KI-Versand: der persönliche Text je Schritt – freigegebene Entwürfe für GENAU diesen Schritt, im Auto-Modus frisch von der KI geschrieben
      let draft: { subject: string; text: string } | null = null; let draftUsed = false;
      const sentBodies: Array<{ body: string | null; source: string }> = []; // was wirklich rausging: KI-Text (bzw. Ersatz-Entwurf) oder Vorlage – für „Gesendet“
      let draftSource: string | null = null;
      const sentIds: Array<string | null> = []; // Message-IDs der gesendeten Mails – damit Antworten sicher zugeordnet werden (In-Reply-To), egal von welcher Adresse
      const pool = await poolFor(campaign.tenantId); const sender = pool ? pool.pick(recipient.email) : null; // welche Absender-Adresse diesen Kontakt anschreibt
      const result = await advanceRecipient(campaignTree, state, now, async (nodeIn, subjectIn) => { let node = nodeIn; let subject = subjectIn; let usedNow = false;
        if ((kiModus === "freigabe" || kiModus === "auto") && draftUsed) return { ok: false, subject: subjectIn, defer: "Nächste E-Mail im nächsten Lauf – mit eigenem KI-Text" }; // nie eine Vorlage hinterher
        if (kiModus === "freigabe" && !draftUsed) {
          const freshDraft = (await db.select({ draftState: emailCampaignRecipients.draftState, draftNodeId: emailCampaignRecipients.draftNodeId, draftSubject: emailCampaignRecipients.draftSubject, draftText: emailCampaignRecipients.draftText, draftSource: emailCampaignRecipients.draftSource, sentCount: emailCampaignRecipients.sentCount }).from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, recipient.id)).limit(1))[0];
          const approved = freshDraft && freshDraft.draftState === "freigegeben" && freshDraft.draftSubject && freshDraft.draftText && draftFitsNode(freshDraft, nodeIn.id);
          if (!approved) { // noch keine Freigabe für DIESEN Schritt: Entwurf schreiben lassen (damit er unter „Freigeben“ liegt) und warten
            const hasDraft = freshDraft && freshDraft.draftState === "entwurf" && draftFitsNode(freshDraft, nodeIn.id);
            if (!hasDraft && kiBudget > 0) { kiBudget -= 1; await draftForRecipient(db, campaign.tenantId, recipient.id, { nodeId: nodeIn.id }).catch(() => null); }
            return { ok: false, subject: subjectIn, defer: "Wartet auf deine Freigabe" };
          }
          draft = { subject: freshDraft.draftSubject!, text: freshDraft.draftText! }; draftSource = freshDraft.draftSource ?? "ki";
        }
        if (kiModus === "auto" && !draftUsed) { // KI schreibt diese E-Mail jetzt – nur der gewählte Ansatz; klappt es nicht, geht die Vorlage raus
          const freshAuto = (await db.select({ draftState: emailCampaignRecipients.draftState, draftNodeId: emailCampaignRecipients.draftNodeId, draftSubject: emailCampaignRecipients.draftSubject, draftText: emailCampaignRecipients.draftText, draftSource: emailCampaignRecipients.draftSource, sentCount: emailCampaignRecipients.sentCount }).from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, recipient.id)).limit(1))[0];
          const usable = freshAuto && freshAuto.draftSubject && freshAuto.draftText && draftFitsNode(freshAuto, nodeIn.id) && (freshAuto.draftState === "freigegeben" || freshAuto.draftState === "entwurf") && freshAuto.draftSource !== "vorlage";
          if (usable) { draft = { subject: freshAuto.draftSubject!, text: freshAuto.draftText! }; draftSource = freshAuto.draftSource ?? "ki"; }
          else if (!process.env.ANTHROPIC_API_KEY) { await db.update(emailCampaignRecipients).set({ lastError: "KI ist auf dem Server nicht eingerichtet – die E-Mail wartet (keine Vorlage als Ersatz)" }).where(eq(emailCampaignRecipients.id, recipient.id)); return { ok: false, subject: subjectIn, defer: "KI ist nicht eingerichtet – keine Vorlage als Ersatz, die E-Mail wartet" }; }
          else if (kiBudget > 0) { kiBudget -= 1; const made = await draftForRecipient(db, campaign.tenantId, recipient.id, { nodeId: nodeIn.id, onlyApproach: kiAnsatz }).catch(() => null); if (made && (made.source === "ki" || made.source === "kiweb")) { draft = { subject: made.subject, text: made.text }; draftSource = made.source; } else return { ok: false, subject: subjectIn, defer: "KI konnte noch nicht schreiben – neuer Versuch im nächsten Lauf (keine Vorlage als Ersatz)" }; }
          else return { ok: false, subject: subjectIn, defer: "KI schreibt noch – nächster Lauf" };
        }
        if (draft && !draftUsed) { draftUsed = true; usedNow = true; node = { ...nodeIn, subject: draft.subject, subjectB: null, blocks: draftToBlocks(draft.text, nodeIn.blocks) }; subject = draft.subject; }
        const rendered = (() => { const d = design(campaign); // persönlicher Versand: kein Zählpixel, keine umgeschriebenen Links – nur der Abmelde-Link bleibt (gesetzlich nötig)
        return renderNode(node, d, values, d.plain ? { unsubscribeUrl: `${base}/api/mail/u/${recipient.token}`, logoBase: base, subject, signature } : { pixelUrl: `${base}/api/mail/o/${recipient.token}.gif`, wrapLink: (url) => `${base}/api/mail/c/${recipient.token}?u=${encodeURIComponent(url)}`, unsubscribeUrl: `${base}/api/mail/u/${recipient.token}`, logoBase: base, subject, signature }); })(); const fresh = (await db.select({ repliedAt: emailCampaignRecipients.repliedAt, status: emailCampaignRecipients.status }).from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, recipient.id)).limit(1))[0]; // Antwort-Stopp: direkt vor dem Senden noch einmal nachsehen
        if (fresh?.repliedAt && stopsOnReply(campaign)) return { ok: false, subject: rendered.subject, stopped: REPLY_STOP_NOTE }; if (fresh && !["wartet", "laeuft"].includes(fresh.status)) return { ok: false, subject: rendered.subject, stopped: "Empfänger inzwischen beendet – keine weitere E-Mail" };
        const sent = await deliverMail({ to: recipient.email, subject: rendered.subject, html: rendered.html, text: rendered.text, attachments: (node.attachments ?? []).map((file) => ({ filename: file.filename, content: file.contentBase64, contentType: file.contentType, encoding: "base64" as const })) }, { db, tenantId: campaign.tenantId, from: sender ? { name: sender.fromName, email: sender.fromEmail } : null }); if (!sent.ok) await db.update(emailCampaignRecipients).set({ lastError: sent.note ?? "Versand fehlgeschlagen" }).where(eq(emailCampaignRecipients.id, recipient.id)); if (sent.ok) { sentIds.push(normalizeMessageId(sent.messageId)); sentBodies.push(usedNow && draft ? { body: cleanDraftText(draft.text.trim()), source: draftSource === "vorlage" ? "entwurf-vorlage" : draftSource === "hand" ? "hand" : "ki" } : { body: null, source: "vorlage" }); } return { ok: sent.ok, subject: rendered.subject }; }, { window: sendWindowOf(campaign), stopOnReply: stopsOnReply(campaign) });
      await db.update(emailCampaignRecipients).set({ nodeId: result.state.nodeId, nextActionAt: result.state.nextActionAt, status: result.state.status, sentCount: result.state.sentCount, lastSentAt: result.state.lastSentAt, ...(draftUsed && result.state.sentCount > recipient.sentCount ? { draftState: null, draftNodeId: null } : {}) }).where(eq(emailCampaignRecipients.id, recipient.id)); // genutzter Entwurf ist verbraucht – der nächste Schritt bekommt einen frischen
      let sentIndex = 0;
      for (const event of result.events) { const at = event.kind === "gesendet" ? sentIndex++ : -1; await db.insert(emailCampaignEvents).values({ tenantId: campaign.tenantId, campaignId: campaign.id, recipientId: recipient.id, nodeId: event.nodeId, kind: event.kind, subject: event.subject ?? null, note: event.note, sender: at >= 0 ? sender?.fromEmail ?? null : null, messageId: at >= 0 ? sentIds[at] ?? null : null, body: at >= 0 ? sentBodies[at]?.body ?? null : null, bodySource: at >= 0 ? sentBodies[at]?.source ?? null : null }); }
      const sentNow = result.events.filter((event) => event.kind === "gesendet").length; sentInRun += sentNow; if (sentNow && dayLeft.has(campaign.tenantId)) dayLeft.set(campaign.tenantId, (dayLeft.get(campaign.tenantId) ?? 0) - sentNow);
      const failedNow = result.events.filter((event) => event.kind === "fehler"); if (failedNow.length) { failedInRun += failedNow.length; lastFailure = `${recipient.email}: ${(await db.select({ lastError: emailCampaignRecipients.lastError }).from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, recipient.id)).limit(1))[0]?.lastError ?? "Versand fehlgeschlagen"}`; }
      processed += 1;
    }
    // Glocke: E-Mails dieser Kampagne zusammengezählt (ein Eintrag je Stunde, nicht je Durchlauf)
    if (sentInRun) await bumpActivity(db, campaign.tenantId, { refType: "emailCampaign", refId: campaign.id, withinMinutes: 60 }, { kind: "email_gesendet", title: (count) => `Kampagne „${campaign.name}“: ${count} E-Mail${count === 1 ? "" : "s"} gesendet`, add: sentInRun });
    // Glocke: Fehler sofort sichtbar – mit dem Grund, Details im Lead-Log des Empfängers
    if (failedInRun) await bumpActivity(db, campaign.tenantId, { refType: "emailCampaignFehler", refId: campaign.id, withinMinutes: 60 }, { kind: "email_fehler", title: (count) => `Kampagne „${campaign.name}“: ${count} E-Mail${count === 1 ? "" : "s"} nicht gesendet – Lead-Log prüfen`, detail: lastFailure, add: failedInRun });
    const open = await db.select({ id: emailCampaignRecipients.id }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId, campaign.id), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]))).limit(1);
    if (!open.length && due.length) await db.update(emailCampaigns).set({ status: "beendet" }).where(eq(emailCampaigns.id, campaign.id));
  }
  return processed;
}
/**
 * Einmal nach dem Serverstart: Wartende aus der Zeit, als sie schon am Schritt NACH dem Warten standen, auf den Warten-Schritt
 * setzen. Fällige macht der Zeitplaner ohnehin richtig – hier geht es darum, dass die Anzeige stimmt („33 warten hier“) und
 * Änderungen am Ablauf sofort für alle Wartenden gelten. Nur Status „wartet“, mehrfach ausführbar ohne Nebenwirkung.
 */
export async function repairWaitingRecipients(db: Db) {
  const campaigns = await db.select().from(emailCampaigns).where(inArray(emailCampaigns.status, ["aktiv", "pausiert"])); let repaired = 0;
  for (const campaign of campaigns) {
    const campaignTree = tree(campaign); const byId = new Map(campaignTree.nodes.map((node) => [node.id, node]));
    const rows = await db.select({ id: emailCampaignRecipients.id, nodeId: emailCampaignRecipients.nodeId, status: emailCampaignRecipients.status }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId, campaign.id), eq(emailCampaignRecipients.status, "wartet")));
    const candidates = rows.filter((row) => !row.nodeId || byId.get(row.nodeId)?.type !== "wait");
    for (let offset = 0; offset < candidates.length; offset += 200) {
      const chunk = candidates.slice(offset, offset + 200);
      const events = await db.select({ id: emailCampaignEvents.id, recipientId: emailCampaignEvents.recipientId, kind: emailCampaignEvents.kind, nodeId: emailCampaignEvents.nodeId, createdAt: emailCampaignEvents.createdAt }).from(emailCampaignEvents).where(inArray(emailCampaignEvents.recipientId, chunk.map((row) => row.id)));
      for (const row of chunk) {
        const own = events.filter((event) => event.recipientId === row.id); if (!own.length) continue;
        const waiting = resolveWaiting(campaignTree, row, own); if (!waiting.waitingAt || waiting.nodeId === row.nodeId) continue;
        await db.update(emailCampaignRecipients).set({ nodeId: waiting.nodeId }).where(and(eq(emailCampaignRecipients.id, row.id), eq(emailCampaignRecipients.status, "wartet"))); repaired += 1;
      }
    }
  }
  return repaired;
}
/**
 * Lead-Log: alles, was mit einem Empfänger in einer Serie passiert ist – anklickbar aus der Kampagnen-Ansicht. Ereignisse in
 * Zeitfolge, der Weg durch den Ablauf (erledigt / aktuell / offen), wie lange er noch wartet, Fehler mit Grund, Pipeline-Stufe.
 */
export async function recipientLog(db: Db, tenantId: number, recipientId: number) {
  const recipient = (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.id, recipientId), eq(emailCampaignRecipients.tenantId, tenantId))).limit(1))[0]; if (!recipient) throw new Error("Empfänger nicht gefunden.");
  const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, recipient.campaignId), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!campaign) throw new Error("Kampagne nicht gefunden.");
  const events = await db.select().from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.recipientId, recipient.id))).orderBy(asc(emailCampaignEvents.createdAt), asc(emailCampaignEvents.id));
  const lead = recipient.leadId ? (await db.select({ id: leads.id, publicId: leads.publicId, pipelineStage: leads.pipelineStage, adPlatform: leads.adPlatform, ownerUserId: leads.ownerUserId, inPipeline: leads.inPipeline, firstName: leads.firstName, lastName: leads.lastName, company: leads.company, phone: leads.phone, listName: leads.listName }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, recipient.leadId))).limit(1))[0] ?? null : null;
  const { pipelineStageSets } = await import("./meta-ads"); const sets = await pipelineStageSets(db, tenantId);
  const stages = lead ? stagesForLead(sets, lead) : []; const stage = lead ? stages.find((item) => item.key === lead.pipelineStage) ?? null : null;
  const owner = lead?.ownerUserId ? (await db.select({ name: users.name }).from(users).where(eq(users.id, lead.ownerUserId)).limit(1))[0]?.name ?? null : null;
  const campaignTree = tree(campaign); const steps = recipientPath(campaignTree, recipient, events);
  const errors = events.filter((event) => event.kind === "fehler").map((event) => ({ at: event.createdAt, note: event.note ?? "Versand fehlgeschlagen" }));
  if (recipient.lastError && !errors.some((item) => item.note === recipient.lastError)) errors.push({ at: recipient.lastSentAt ?? recipient.createdAt, note: recipient.lastError });
  const sameContact = await db.select({ id: emailCampaignRecipients.id, campaignId: emailCampaignRecipients.campaignId, status: emailCampaignRecipients.status, sentCount: emailCampaignRecipients.sentCount, createdAt: emailCampaignRecipients.createdAt, name: emailCampaigns.name }).from(emailCampaignRecipients).innerJoin(emailCampaigns, eq(emailCampaigns.id, emailCampaignRecipients.campaignId)).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.email, recipient.email))).orderBy(desc(emailCampaignRecipients.createdAt));
  return {
    recipient: { id: recipient.id, email: recipient.email, name: recipient.name, company: recipient.company, status: recipient.status, nodeId: recipient.nodeId, nextActionAt: recipient.nextActionAt, sentCount: recipient.sentCount, lastSentAt: recipient.lastSentAt, openedAt: recipient.openedAt, clickedAt: recipient.clickedAt, repliedAt: recipient.repliedAt, bouncedAt: recipient.bouncedAt, lastError: recipient.lastError ?? null, variant: (recipient.variant ?? null) as "A" | "B" | null, createdAt: recipient.createdAt },
    campaign: { id: campaign.id, name: campaign.name, status: campaign.status, stopOnReply: stopsOnReply(campaign), maxRuns: campaign.maxRuns ?? 1 },
    lead: lead ? { publicId: lead.publicId, name: `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || lead.company || recipient.email, company: lead.company, phone: lead.phone, listName: lead.listName, stage: stage ? { key: stage.key, label: stage.label } : lead.pipelineStage ? { key: lead.pipelineStage, label: lead.pipelineStage } : null, inPipeline: Boolean(lead.inPipeline), owner: owner?.split(/\s+/)[0] ?? null } : null,
    waiting: waitingText(recipient.nextActionAt, recipient.status),
    currentStep: recipient.nodeId ? (campaignTree.nodes.find((node) => node.id === recipient.nodeId) ?? null) : null,
    steps, events: events.map((event) => ({ id: event.id, kind: event.kind, label: eventLabel(event), nodeId: event.nodeId, subject: event.subject, note: event.note, createdAt: event.createdAt })),
    errors, runs: sameContact.map((row) => ({ id: row.id, campaignId: row.campaignId, campaignName: row.name, status: row.status, sentCount: row.sentCount, createdAt: row.createdAt })),
  };
}
/** Tracking: Öffnung (Pixel), Klick (Weiterleitung), Abmeldung. */
export type TrackMeta = { userAgent?: string | null; method?: string | null };
/** Zählpixel: zählt nur echte Öffnungen – Scanner, Vorschau-Bots und Aufrufe direkt nach dem Versand nicht. */
export async function trackOpen(db: Db, token: string, meta?: TrackMeta) { const recipient = (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.token, token)).limit(1))[0]; if (!recipient) return false; if (meta && (isMachineRequest(meta) || isTooSoonAfterSend(recipient.lastSentAt))) return true; /* nur bei echten Web-Aufrufen prüfen */ if (!recipient.openedAt || (recipient.lastSentAt && recipient.openedAt < recipient.lastSentAt)) { await db.update(emailCampaignRecipients).set({ openedAt: new Date() }).where(eq(emailCampaignRecipients.id, recipient.id)); await db.insert(emailCampaignEvents).values({ tenantId: recipient.tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: "geoeffnet", note: "E-Mail geöffnet" }); } return true; }
/** Link-Klick: leitet immer weiter, zählt aber nur echte Klicks. Ein Klick beweist auch das Öffnen (falls Bilder blockiert waren). */
export async function trackClick(db: Db, token: string, url: string, meta?: TrackMeta) { const recipient = (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.token, token)).limit(1))[0]; if (!recipient) return null; const target = /^https?:\/\//.test(url) ? url : null; if (meta && (isMachineRequest(meta) || isTooSoonAfterSend(recipient.lastSentAt))) return target; const now = new Date(); const unopened = !recipient.openedAt || (recipient.lastSentAt && recipient.openedAt < recipient.lastSentAt); const urls = Array.from(new Set([...((Array.isArray(recipient.clickedUrls) ? recipient.clickedUrls : []) as string[]), url.slice(0, 400)])).slice(-20); await db.update(emailCampaignRecipients).set({ clickedAt: now, openedAt: unopened ? now : recipient.openedAt, clickedUrls: urls }).where(eq(emailCampaignRecipients.id, recipient.id)); if (unopened) await db.insert(emailCampaignEvents).values({ tenantId: recipient.tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: "geoeffnet", note: "E-Mail geöffnet (über Link-Klick erkannt)" }); await db.insert(emailCampaignEvents).values({ tenantId: recipient.tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: "geklickt", note: `Link geklickt: ${url.slice(0, 200)}` }); return target; }
export async function unsubscribe(db: Db, token: string) { const recipient = (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.token, token)).limit(1))[0]; if (!recipient) return false; await db.update(emailCampaignRecipients).set({ status: "abgemeldet", nextActionAt: null }).where(eq(emailCampaignRecipients.id, recipient.id)); const campaignName = (await db.select({ name: emailCampaigns.name }).from(emailCampaigns).where(eq(emailCampaigns.id, recipient.campaignId)).limit(1))[0]?.name ?? null; await addSuppression(db, recipient.tenantId, { email: recipient.email, reason: "abgemeldet", note: `Abmelde-Link geklickt${campaignName ? ` in „${campaignName}“` : ""}`, source: campaignName ? `Abmelde-Link „${campaignName}“` : "Abmelde-Link" }).catch(() => null); await db.insert(emailCampaignEvents).values({ tenantId: recipient.tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: "abgemeldet", note: "Empfänger hat sich abgemeldet" }); return true; }
/**
 * Antwort-Stopp (feste Regel, nicht abschaltbar): Hat ein Kontakt geantwortet, geht an ihn keine weitere E-Mail mehr raus –
 * aus keiner laufenden Serie. Alle offenen Empfänger-Einträge mit dieser Adresse (und, falls bekannt, dieser Karte) werden
 * sofort beendet und bekommen den Vermerk „Antwort erhalten – Serie gestoppt“. Wird von jedem Weg aufgerufen, auf dem eine
 * Antwort erkannt wird: Posteingang, IMAP-Abgleich, Knopf „als geantwortet markieren“.
 */
export async function stopSeriesForContact(db: Db, tenantId: number, input: { email?: string | null; leadId?: number | null; repliedAt?: Date | null; note?: string | null }) {
  const email = input.email?.trim().toLowerCase() || null; if (!email && !input.leadId) return { stopped: 0, recipientIds: [] as number[] };
  const match = [email ? eq(emailCampaignRecipients.email, email) : null, input.leadId ? eq(emailCampaignRecipients.leadId, input.leadId) : null].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const open = await db.select({ id: emailCampaignRecipients.id, campaignId: emailCampaignRecipients.campaignId, nodeId: emailCampaignRecipients.nodeId, repliedAt: emailCampaignRecipients.repliedAt, stopOnReply: emailCampaigns.stopOnReply }).from(emailCampaignRecipients)
    .innerJoin(emailCampaigns, eq(emailCampaigns.id, emailCampaignRecipients.campaignId))
    .where(and(eq(emailCampaignRecipients.tenantId, tenantId), inArray(emailCampaignRecipients.status, OPEN_RECIPIENT_STATUSES), match.length > 1 ? or(...match) : match[0]));
  const at = input.repliedAt ?? new Date(); const note = input.note ?? REPLY_STOP_NOTE; const stopped: number[] = [];
  for (const row of open) {
    if (!stopsOnReply(row)) { await db.update(emailCampaignRecipients).set({ repliedAt: row.repliedAt ?? at }).where(eq(emailCampaignRecipients.id, row.id)); await db.insert(emailCampaignEvents).values({ tenantId, campaignId: row.campaignId, recipientId: row.id, nodeId: row.nodeId, kind: "gewartet", note: "Antwort erhalten – Serie läuft weiter („Bei Antwort anhalten“ ist für diese Kampagne aus)" }); continue; } // Schalter bewusst aus
    await db.update(emailCampaignRecipients).set({ status: "fertig", nextActionAt: null, nodeId: null, repliedAt: row.repliedAt ?? at }).where(eq(emailCampaignRecipients.id, row.id));
    await db.insert(emailCampaignEvents).values({ tenantId, campaignId: row.campaignId, recipientId: row.id, nodeId: row.nodeId, kind: "beendet", note }); stopped.push(row.id);
  }
  return { stopped: stopped.length, recipientIds: stopped };
}
/**
 * Sicherheitsnetz vor jedem Zeitplaner-Lauf: offene Empfänger, deren Kontakt (gleiche Adresse im Mandanten) geantwortet
 * hat, bevor der Eintrag angelegt wurde – z. B. Daten aus der Zeit vor dem Antwort-Stopp oder ein nur gesetzter Zeitstempel –
 * werden beendet, sofern die Kampagne „Bei Antwort anhalten“ an hat. So ist der Stopp wirklich überall dabei.
 */
export async function enforceReplyStop(db: Db, tenantIds: number[]) {
  let stopped = 0; if (!tenantIds.length) return stopped;
  const replied = await db.select({ tenantId: emailCampaignRecipients.tenantId, email: emailCampaignRecipients.email, repliedAt: emailCampaignRecipients.repliedAt }).from(emailCampaignRecipients).where(and(inArray(emailCampaignRecipients.tenantId, tenantIds), isNotNull(emailCampaignRecipients.repliedAt)));
  const latest = new Map<string, Date>(); for (const row of replied) { if (!row.repliedAt) continue; const key = `${row.tenantId}:${row.email.toLowerCase()}`; const current = latest.get(key); if (!current || row.repliedAt > current) latest.set(key, row.repliedAt); }
  if (!latest.size) return stopped;
  const open = await db.select({ id: emailCampaignRecipients.id, tenantId: emailCampaignRecipients.tenantId, campaignId: emailCampaignRecipients.campaignId, nodeId: emailCampaignRecipients.nodeId, email: emailCampaignRecipients.email, repliedAt: emailCampaignRecipients.repliedAt, createdAt: emailCampaignRecipients.createdAt, stopOnReply: emailCampaigns.stopOnReply }).from(emailCampaignRecipients)
    .innerJoin(emailCampaigns, eq(emailCampaigns.id, emailCampaignRecipients.campaignId)).where(and(inArray(emailCampaignRecipients.tenantId, tenantIds), inArray(emailCampaignRecipients.status, OPEN_RECIPIENT_STATUSES)));
  for (const row of open) {
    if (!stopsOnReply(row)) continue;
    const at = latest.get(`${row.tenantId}:${row.email.toLowerCase()}`); const hit = Boolean(row.repliedAt) || Boolean(at && at >= row.createdAt); if (!hit) continue;
    await db.update(emailCampaignRecipients).set({ status: "fertig", nextActionAt: null, nodeId: null, repliedAt: row.repliedAt ?? at ?? new Date() }).where(eq(emailCampaignRecipients.id, row.id));
    await db.insert(emailCampaignEvents).values({ tenantId: row.tenantId, campaignId: row.campaignId, recipientId: row.id, nodeId: row.nodeId, kind: "beendet", note: REPLY_STOP_NOTE }); stopped += 1;
  }
  return stopped;
}
/** Von Hand „hat geantwortet“: Zeitstempel setzen, Vermerk im Verlauf – und alle Serien dieses Kontakts stoppen (Antwort-Stopp). */
export async function markReplied(db: Db, tenantId: number, recipientId: number) {
  const recipient = (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.id, recipientId), eq(emailCampaignRecipients.tenantId, tenantId))).limit(1))[0]; if (!recipient) throw new Error("Empfänger nicht gefunden.");
  const now = new Date();
  if (!recipient.repliedAt) { await db.update(emailCampaignRecipients).set({ repliedAt: now }).where(eq(emailCampaignRecipients.id, recipientId)); await db.insert(emailCampaignEvents).values({ tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: "geoeffnet", note: "Antwort von Hand vermerkt" }); }
  const stopped = await stopSeriesForContact(db, tenantId, { email: recipient.email, leadId: recipient.leadId, repliedAt: now });
  return { success: true as const, stopped: stopped.stopped };
}
export async function sendTestEmail(db: Db, tenantId: number, input: { to: string; node: Extract<EmailNode, { type: "send" }>; design: Partial<EmailDesign> }) {
  const signature = await signatureFor(db, tenantId, process.env.APP_URL ?? "").then((result) => ({ html: result.html, text: result.text })).catch(() => null);
  const rendered = renderNode(input.node, { ...DEFAULT_DESIGN, ...input.design }, recipientValues({ firstName: "Max", lastName: "Muster", company: "Muster GmbH", city: "Frankfurt", salutation: "herr", email: input.to }, null), { signature, logoBase: process.env.APP_URL ?? "", unsubscribeUrl: `${(process.env.APP_URL ?? "").replace(/\/+$/, "")}/api/mail/u/test` });
  const result = await deliverMail({ to: input.to, subject: `[Test] ${rendered.subject}`, html: rendered.html, text: rendered.text }, { db, tenantId }); return { status: result.status, note: result.note ?? null, messageId: result.messageId ?? null };
}
export const previewNodeHtml = (node: Extract<EmailNode, { type: "send" }>, designInput: Partial<EmailDesign>, signature?: { html: string; text: string } | null) => renderNode(node, { ...DEFAULT_DESIGN, ...designInput }, recipientValues({ firstName: "Max", lastName: "Muster", company: "Muster GmbH", city: "Frankfurt", salutation: "herr", email: "max@beispiel.de" }, "https://beispiel.de/abmelden"), { logoBase: process.env.APP_URL ?? "", unsubscribeUrl: "https://beispiel.de/abmelden", preview: true, signature }).html;
export { asc };

/** Bild für den E-Mail-Builder ablegen (öffentlich unter APP_URL/uploads/mail/…). */
export async function uploadMailImage(input: { fileName: string; mimeType: string; base64: string }) {
  const { default: fs } = await import("node:fs/promises"); const { default: path } = await import("node:path");
  const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" } as Record<string, string>)[input.mimeType]; if (!ext) throw new Error("Nur PNG, JPG, GIF, WebP oder SVG.");
  const buffer = Buffer.from(input.base64.replace(/^data:[^;]+;base64,/, ""), "base64"); if (!buffer.length) throw new Error("Leere Datei."); if (buffer.length > 5 * 1024 * 1024) throw new Error("Bild ist größer als 5 MB.");
  const dir = path.resolve(process.cwd(), "uploads", "mail"); await fs.mkdir(dir, { recursive: true }); const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`; await fs.writeFile(path.join(dir, name), buffer);
  const base = (process.env.APP_URL ?? "").replace(/\/+$/, ""); return { url: `${base}/uploads/mail/${name}`, path: `/uploads/mail/${name}`, size: buffer.length };
}

/**
 * Inhalt einer hochgeladenen Liste: die Kontakte mit Stammdaten, Stufe, Vertriebler und den Zusatzspalten
 * (den Platzhaltern aus der Datei). Für die Ansicht „Liste ansehen“ in der Pipeline und im Kampagnen-Editor.
 */
/** Webseite aus der Firmen-Adresse ableiten (info@koppen-solar.de → koppen-solar.de), wenn die Liste keine Webseiten-Spalte hat. */
function websiteFromEmail(email: string | null | undefined, extra?: Record<string, string> | null): string | null {
  if (!email) return null;
  if (extra && Object.keys(extra).some((key) => /^(web ?(site|seite)?|homepage|internet(seite)?|url|domain)$/i.test(key.trim()))) return null; // Liste bringt selbst eine Webseite mit
  const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  if (/^(gmail|googlemail|gmx|web|t-online|outlook|hotmail|live|yahoo|icloud|me|aol|freenet|posteo|mail|email|arcor|online|vodafone|magenta|proton|protonmail|1und1|unitybox)\./.test(domain)) return null;
  return domain;
}
/** Ansprechpartner aus der E-Mail-Adresse (max.mustermann@firma.de) – nur wenn beide Teile wie Namen aussehen. */
export function nameFromEmail(email: string | null | undefined): { firstName: string; lastName: string } | null {
  const local = (email ?? "").split("@")[0]?.toLowerCase() ?? "";
  const match = /^([a-zäöüß]{2,})[._-]([a-zäöüß][a-zäöüß-]{2,})$/.exec(local); if (!match) return null;
  const generic = new Set(["info", "kontakt", "mail", "office", "vertrieb", "service", "buero", "büro", "hallo", "post", "verwaltung", "team", "shop", "bewerbung", "rechnung", "zentrale", "empfang", "anfrage", "support", "kundenservice", "marketing", "presse", "jobs", "karriere", "no", "noreply", "reply", "e", "mail"]);
  if (generic.has(match[1]) || generic.has(match[2])) return null;
  const cap = (part: string) => part.split("-").map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1)).join("-");
  return { firstName: cap(match[1]), lastName: cap(match[2]) };
}
/** Geschäftsführer/Inhaber aus einem Impressum-Text herauslesen – ohne KI, über die üblichen Formulierungen. */
export function managerFromImpressum(text: string): { firstName: string; lastName: string } | null {
  const keyword = /(geschäftsführung|geschäftsführer(?:in)?|inhaber(?:in)?|vertretungsberechtigte?r?\s+geschäftsführer(?:in)?|vertreten\s+durch)\s*[:\-–]?\s*/i.exec(text);
  if (!keyword) return null;
  const rest = text.slice(keyword.index + keyword[0].length, keyword.index + keyword[0].length + 90).replace(/^\s+/, "");
  const name = /^((?:(?:Dipl\.-?[\w]*|Dr\.|Prof\.|Ing\.|[A-ZÄÖÜ][a-zäöüß]+)\s+){1,3}[A-ZÄÖÜ][a-zäöüß-]+)/.exec(rest)?.[1]?.trim();
  if (!name) return null;
  const parts = name.replace(/\b(Dipl\.?-?\w*|Dr\.?|Prof\.?|Ing\.?)\s*/g, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return null;
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}
/**
 * Fehlende Daten einer Liste ergänzen: Kontakte ohne Ansprechpartner bekommen – wenn eine Webseite bekannt ist –
 * den Geschäftsführer/Inhaber aus dem Impressum als Ansprechpartner (mit Vermerk im Verlauf). Läuft in kleinen Paketen.
 */
export async function enrichListContacts(db: Db, tenantId: number, input: { listName: string; limit?: number | null; actorUserId?: number | null }) {
  const limit = Math.max(1, Math.min(15, input.limit ?? 8));
  const { readWebsiteText } = await import("./lead-finder"); const { websiteOf } = await import("./campaign-review");
  const rows = await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.listName, input.listName)));
  const candidates = rows.filter((row) => { const meta = (row.metadata ?? {}) as Record<string, unknown>; const enriched = (meta.anreicherung as { geprueft?: boolean } | undefined)?.geprueft; const noContact = !(row.firstName ?? "").trim() || (row.lastName ?? "").trim() === (row.company ?? "").trim(); return !enriched && noContact && Boolean(websiteOf(row.metadata, row.email)); }).slice(0, limit);
  let found = 0; let checked = 0;
  for (const row of candidates) {
    checked += 1;
    const website = websiteOf(row.metadata, row.email)!;
    const fromEmail = nameFromEmail(row.email);
    const site = fromEmail ? null : await readWebsiteText(website, { maxPages: 2, maxChars: 7000 }).catch(() => null);
    const manager = fromEmail ?? (site ? managerFromImpressum(site.text) : null);
    const meta = (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {}) as Record<string, unknown>;
    const update: Record<string, unknown> = { metadata: { ...meta, anreicherung: { geprueft: true, am: new Date().toISOString().slice(0, 10), ...(manager ? { quelle: fromEmail ? "email" : "impressum" } : {}) } } };
    if (manager) { update.firstName = manager.firstName; update.lastName = manager.lastName; found += 1; await db.insert(pipelineEvents).values({ tenantId, leadId: row.id, fromStage: null, toStage: row.pipelineStage ?? "neu", actorUserId: input.actorUserId ?? null, note: `Ansprechpartner ergänzt: ${manager.firstName} ${manager.lastName} (${fromEmail ? "aus der E-Mail-Adresse" : `Impressum ${website}`})` }); }
    await db.update(leads).set(update).where(eq(leads.id, row.id));
  }
  return { checked, found, remaining: Math.max(0, rows.filter((row) => { const meta = (row.metadata ?? {}) as Record<string, unknown>; const enriched = (meta.anreicherung as { geprueft?: boolean } | undefined)?.geprueft; const noContact = !(row.firstName ?? "").trim() || (row.lastName ?? "").trim() === (row.company ?? "").trim(); return !enriched && noContact && Boolean(websiteOf(row.metadata, row.email)); }).length - candidates.length) };
}
export async function coldListContacts(db: Db, tenantId: number, input: { listName: string; limit?: number; search?: string | null }) {
  const limit = Math.min(500, Math.max(10, input.limit ?? 100));
  const rows = await db.select({ id: leads.id, publicId: leads.publicId, firstName: leads.firstName, lastName: leads.lastName, company: leads.company, phone: leads.phone, email: leads.email, postcode: leads.postcode, city: leads.city, stage: leads.pipelineStage, metadata: leads.metadata, createdAt: leads.createdAt })
    .from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.listName, input.listName))).orderBy(asc(leads.id)).limit(limit + 1);
  const search = (input.search ?? "").trim().toLowerCase();
  const mapped = rows.map((row) => ({ ...row, metadata: undefined, felder: extraFieldsOf(row.metadata) }));
  const filtered = search ? mapped.filter((row) => `${row.firstName ?? ""} ${row.lastName ?? ""} ${row.company ?? ""} ${row.email ?? ""} ${row.phone ?? ""} ${row.city ?? ""}`.toLowerCase().includes(search)) : mapped;
  const columns = Array.from(new Set(filtered.flatMap((row) => Object.keys(row.felder))));
  return { contacts: filtered.slice(0, limit), columns, more: rows.length > limit };
}

/**
 * Die Fußzeile aus den Einstellungen (Anschrift, Webseite, Terminlink) auf bestehende Kampagnen übertragen.
 * Neue Kampagnen bekommen sie ohnehin; das hier ist für die, die es schon gibt. Der Rest des Designs bleibt unverändert.
 */
/** Absender aus den E-Mail-Einstellungen auf alle Kampagnen übernehmen (z. B. nach Umzug auf ein eigenes Kampagnen-Postfach). */
export async function applySenderToCampaigns(db: Db, tenantId: number, input: { fromName: string | null; fromEmail: string; onlyActive?: boolean }) {
  const fromEmail = input.fromEmail.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) throw new Error("Bitte zuerst eine gültige Absenderadresse speichern.");
  const rows = await db.select({ id: emailCampaigns.id, status: emailCampaigns.status }).from(emailCampaigns).where(eq(emailCampaigns.tenantId, tenantId));
  const ids = rows.filter((row) => !input.onlyActive || row.status !== "beendet").map((row) => row.id);
  if (ids.length) await db.update(emailCampaigns).set({ fromEmail, ...(input.fromName?.trim() ? { fromName: input.fromName.trim() } : {}) }).where(and(eq(emailCampaigns.tenantId, tenantId), inArray(emailCampaigns.id, ids)));
  return { updated: ids.length, fromEmail };
}
export async function applyFooterToCampaigns(db: Db, tenantId: number, options: { includeTemplates?: boolean } = {}) {
  const patch = await tenantDesign(db, tenantId);
  if (!patch.footerText) return { updated: 0, footerText: null as string | null };
  const rows = await db.select({ id: emailCampaigns.id, design: emailCampaigns.design, isTemplate: emailCampaigns.isTemplate }).from(emailCampaigns).where(eq(emailCampaigns.tenantId, tenantId));
  let updated = 0;
  for (const row of rows) {
    if (row.isTemplate && options.includeTemplates === false) continue;
    const design = { ...DEFAULT_DESIGN, ...((row.design ?? {}) as Partial<EmailDesign>) };
    if (design.footerText === patch.footerText) continue;
    await db.update(emailCampaigns).set({ design: { ...design, footerText: patch.footerText, footerReset: 1 } }).where(eq(emailCampaigns.id, row.id)); // bewusst gesetzt – bleibt
    updated += 1;
  }
  return { updated, footerText: patch.footerText };
}


/** Vertriebskontakte samt allem, was an ihnen hängt, löschen – eine Stelle für Liste löschen, Upload rückgängig und Kontakte löschen. */
/** Was beim Löschen festgehalten wird: wer, warum – landet je Liste als Eintrag „gelöscht“ im Upload-Verlauf. */
export type DeletionMeta = { actorUserId?: number | null; reason?: string | null; undo?: boolean };
/**
 * Löschung im Upload-Verlauf festhalten: je Liste ein Eintrag (Art „loeschung“) mit Anzahl, wer, wann und Grund – damit man
 * später sieht, wann etwas aus einer Liste verschwunden ist. Kontakte ohne Liste laufen unter „ohne Liste“.
 */
export async function recordDeletion(db: Db, tenantId: number, ids: number[], meta: DeletionMeta = {}) {
  if (!ids.length) return 0;
  const rows = await db.select({ id: leads.id, listName: leads.listName, adPlatform: leads.adPlatform }).from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, ids)));
  const groups = new Map<string, { ids: number[]; email: number }>();
  for (const row of rows) { const key = row.listName?.trim() || "ohne Liste"; const group = groups.get(key) ?? { ids: [], email: 0 }; group.ids.push(row.id); if (row.adPlatform === "email") group.email += 1; groups.set(key, group); }
  for (const [listName, group] of Array.from(groups.entries())) await db.insert(listImports).values({ tenantId, listName, source: group.email > group.ids.length / 2 ? "kampagne" : "kaltakquise", kind: "loeschung", note: meta.reason?.slice(0, 240) ?? null, rowCount: group.ids.length, created: 0, updated: 0, duplicates: 0, toPipeline: false, leadIds: group.ids, actorUserId: meta.actorUserId ?? null });
  return groups.size;
}
export async function removeLeadsCascade(db: Db, tenantId: number, ids: number[], meta?: DeletionMeta): Promise<number> {
  if (!ids.length) return 0;
  // Papierkorb: vorher alles sichern, was an den Kontakten hängt – „Rückgängig“ holt es mit denselben IDs zurück
  let undoId = 0;
  if (meta?.undo !== false) { try { const { snapshotLeads, recordUndo } = await import("./undo"); const snapshot = await snapshotLeads(db, tenantId, ids); undoId = await recordUndo(db, tenantId, { kind: "loeschen", title: meta?.reason ?? `${ids.length === 1 ? "Ein Kontakt" : `${ids.length} Kontakte`} gelöscht`, count: snapshot.leads.length || ids.length, actorUserId: meta?.actorUserId ?? null, payload: snapshot }); } catch (error) { console.error("[Papierkorb] Sichern fehlgeschlagen:", error instanceof Error ? error.message : error); } }
  if (meta) await recordDeletion(db, tenantId, ids, meta).catch(() => null);
  await db.delete(pipelineTasks).where(and(eq(pipelineTasks.tenantId, tenantId), inArray(pipelineTasks.leadId, ids)));
  await db.delete(pipelineEvents).where(and(eq(pipelineEvents.tenantId, tenantId), inArray(pipelineEvents.leadId, ids)));
  await db.delete(pipelineNotes).where(and(eq(pipelineNotes.tenantId, tenantId), inArray(pipelineNotes.leadId, ids)));
  await db.delete(outboundMessages).where(and(eq(outboundMessages.tenantId, tenantId), inArray(outboundMessages.leadId, ids)));
  { const gone = (await db.select({ id: emailCampaignRecipients.id }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), inArray(emailCampaignRecipients.leadId, ids)))).map((row) => row.id); if (gone.length) { await db.update(inboxMessages).set({ campaignRecipientId: null }).where(and(eq(inboxMessages.tenantId, tenantId), inArray(inboxMessages.campaignRecipientId, gone))); await db.delete(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), inArray(emailCampaignEvents.recipientId, gone))); } } // gelöscht ist gelöscht: auch Öffnungen/Klicks weg
  await db.delete(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), inArray(emailCampaignRecipients.leadId, ids)));
  await db.delete(dialerQueueItems).where(and(eq(dialerQueueItems.tenantId, tenantId), inArray(dialerQueueItems.leadId, ids)));
  await db.delete(leadStatusEvents).where(and(eq(leadStatusEvents.tenantId, tenantId), inArray(leadStatusEvents.leadId, ids)));
  await db.delete(leadTagAssignments).where(inArray(leadTagAssignments.leadId, ids));
  await db.update(inboxMessages).set({ leadId: null }).where(and(eq(inboxMessages.tenantId, tenantId), inArray(inboxMessages.leadId, ids)));
  await db.update(dialerCalls).set({ leadId: null }).where(and(eq(dialerCalls.tenantId, tenantId), inArray(dialerCalls.leadId, ids)));
  await db.delete(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, ids)));
  return undoId;
}
/**
 * Ausgewählte Kontakte der E-Mail-Akquise löschen. Kunden bleiben erhalten und werden gezählt zurückgemeldet.
 */
export async function deleteEmailLeads(db: Db, tenantId: number, input: { leadIds: number[]; keepCustomers?: boolean; actorUserId?: number | null; reason?: string | null }) {
  const ids = Array.from(new Set(input.leadIds)).slice(0, 2000);
  if (!ids.length) throw new Error("Bitte mindestens einen Kontakt auswählen.");
  const rows = await db.select({ id: leads.id, stage: leads.pipelineStage }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), inArray(leads.id, ids)));
  const keep = (input.keepCustomers ?? true) ? rows.filter((row) => row.stage === "kunde").map((row) => row.id) : [];
  const weg = rows.filter((row) => !keep.includes(row.id)).map((row) => row.id);
  const undoId = await removeLeadsCascade(db, tenantId, weg, { actorUserId: input.actorUserId ?? null, reason: input.reason ?? `${weg.length === 1 ? "Ein Kontakt" : `${weg.length} Kontakte`} von Hand gelöscht (Reiter Kontakte)` });
  return { deleted: weg.length, keptCustomers: keep.length, undoId };
}
/**
 * Eine hochgeladene Liste löschen – mit allen Kontakten, die daraus entstanden sind.
 * Kunden bleiben standardmäßig erhalten (`keepCustomers`), damit kein Abschluss verloren geht;
 * sie verlieren nur die Zuordnung zur Liste. Alles, was an den gelöschten Kontakten hängt
 * (Aufgaben, Notizen, Nachrichten, Empfänger in Serien, Wählliste), wird mitgelöscht.
 */
export async function deleteColdList(db: Db, tenantId: number, input: { listName: string; keepCustomers?: boolean; actorUserId?: number | null }) {
  const listName = input.listName.trim(); if (!listName) throw new Error("Bitte eine Liste angeben.");
  const keepCustomers = input.keepCustomers ?? true;
  const rows = await db.select({ id: leads.id, stage: leads.pipelineStage }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.listName, listName)));
  if (!rows.length) throw new Error(`Zur Liste „${listName}“ gibt es keine Kontakte mehr.`);
  const keep = keepCustomers ? rows.filter((row) => row.stage === "kunde").map((row) => row.id) : [];
  const remove = rows.filter((row) => !keep.includes(row.id)).map((row) => row.id);
  let undoId = 0;
  if (remove.length) {
    undoId = await removeLeadsCascade(db, tenantId, remove, { actorUserId: input.actorUserId ?? null, reason: `Liste „${listName}“ komplett gelöscht${keep.length ? ` (${keep.length} Kunden behalten)` : ""}` });
  }
  if (keep.length) await db.update(leads).set({ listName: null }).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, keep)));
  // Das Tag „Liste: …“ nur entfernen, wenn es niemand mehr trägt.
  const tag = (await db.select().from(tags).where(and(eq(tags.tenantId, tenantId), eq(tags.name, `Liste: ${listName}`.slice(0, 80)))).limit(1))[0];
  if (tag) { const used = (await db.select({ leadId: leadTagAssignments.leadId }).from(leadTagAssignments).where(eq(leadTagAssignments.tagId, tag.id)).limit(1))[0]; if (!used) await db.delete(tags).where(eq(tags.id, tag.id)); }
  return { deleted: remove.length, keptCustomers: keep.length, listName, undoId };
}

/* ---------- Kontakte der E-Mail-Akquise ---------- */
export type EmailLeadActivity = "gesendet" | "geoeffnet" | "geklickt" | "geantwortet" | "abgemeldet" | "bounce" | "ohne";
/**
 * Eigene Lead-Übersicht für die E-Mail-Akquise: je Kontakt eine Zeile mit Herkunft (Liste), Anlage-Datum,
 * Stufe und Vertriebler, den Kampagnen, in denen er steckt, und dem, was zuletzt passiert ist
 * (gesendet, geöffnet, geklickt, geantwortet, abgemeldet, Bounce). Mit Suche und Filtern wie auf der Leads-Seite.
 */
export type { PipelineSource } from "../shared/sales-pipeline";
/** Zu welcher Pipeline gehört ein Kontakt? Dieselbe Regel wie im Board (meta-ads.pipelineOverview). */
export const matchesSource = (adPlatform: string | null | undefined, source: PipelineSource | null | undefined) => !source ? true : source === "kaltakquise" ? adPlatform === "kaltakquise" : source === "email" ? adPlatform === "email" : isCustomSource(source) ? adPlatform === source : adPlatform !== "kaltakquise" && adPlatform !== "email" && !isCustomSource(adPlatform);

export async function emailLeads(db: Db, tenantId: number, options: { search?: string | null; listName?: string | null; campaignId?: number | null; activity?: EmailLeadActivity | null; stage?: string | null; ownerUserId?: number | "ohne" | null; limit?: number; source?: PipelineSource | null; inPipeline?: boolean | null; withoutEmail?: boolean | null; blocked?: boolean | null } = {}) {
  const limit = Math.min(1000, Math.max(10, options.limit ?? 200));
  const rows = await db.select({
    id: leads.id, publicId: leads.publicId, firstName: leads.firstName, lastName: leads.lastName, company: leads.company,
    email: leads.email, phone: leads.phone, city: leads.city, postcode: leads.postcode, listName: leads.listName, stage: leads.pipelineStage, inPipeline: leads.inPipeline, adPlatform: leads.adPlatform, adCampaignName: leads.adCampaignName,
    createdAt: leads.createdAt, ownerUserId: leads.ownerUserId, ownerName: users.name, metadata: leads.metadata,
  }).from(leads).leftJoin(users, eq(users.id, leads.ownerUserId)).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb")));

  const recipients = await db.select({
    leadId: emailCampaignRecipients.leadId, email: emailCampaignRecipients.email, campaignId: emailCampaignRecipients.campaignId, campaignName: emailCampaigns.name,
    status: emailCampaignRecipients.status, sentCount: emailCampaignRecipients.sentCount, lastSentAt: emailCampaignRecipients.lastSentAt,
    openedAt: emailCampaignRecipients.openedAt, clickedAt: emailCampaignRecipients.clickedAt, repliedAt: emailCampaignRecipients.repliedAt, bouncedAt: emailCampaignRecipients.bouncedAt,
  }).from(emailCampaignRecipients).innerJoin(emailCampaigns, eq(emailCampaigns.id, emailCampaignRecipients.campaignId)).where(eq(emailCampaignRecipients.tenantId, tenantId));

  const byLead = new Map<string, typeof recipients>();
  for (const row of recipients) { const key = row.leadId ? `id:${row.leadId}` : `mail:${row.email.toLowerCase()}`; const list = byLead.get(key) ?? []; list.push(row); byLead.set(key, list); }
  // Sperrliste: gesperrte Adressen bekommen keine E-Mails – mit Grund (manuell, abgemeldet, Bounce, Beschwerde, Posteingang)
  const suppressions = new Map((await db.select({ email: emailSuppressions.email, reason: emailSuppressions.reason, note: emailSuppressions.note }).from(emailSuppressions).where(eq(emailSuppressions.tenantId, tenantId))).map((row) => [row.email.toLowerCase(), row]));

  /** Was ist zuletzt passiert? Die stärkste Reaktion gewinnt: geantwortet vor geklickt vor geöffnet vor gesendet. */
  const activityOf = (entries: typeof recipients): { activity: EmailLeadActivity; at: Date | null } => {
    if (!entries.length) return { activity: "ohne", at: null };
    if (entries.some((item) => item.status === "bounce")) return { activity: "bounce", at: entries.find((item) => item.bouncedAt)?.bouncedAt ?? null };
    if (entries.some((item) => item.status === "abgemeldet")) return { activity: "abgemeldet", at: null };
    const pick = (key: "repliedAt" | "clickedAt" | "openedAt" | "lastSentAt") => entries.map((item) => item[key]).filter(Boolean).sort((a, b) => new Date(b as Date).getTime() - new Date(a as Date).getTime())[0] ?? null;
    const replied = pick("repliedAt"); if (replied) return { activity: "geantwortet", at: replied as Date };
    const clicked = pick("clickedAt"); if (clicked) return { activity: "geklickt", at: clicked as Date };
    const opened = pick("openedAt"); if (opened) return { activity: "geoeffnet", at: opened as Date };
    const sent = pick("lastSentAt"); if (sent) return { activity: "gesendet", at: sent as Date };
    return { activity: "ohne", at: null };
  };

  // E-Mail-Akquise: nur Kontakte mit E-Mail-Adresse. Reiter „Kontakte“ der Pipeline: alle Kontakte der gewählten Pipeline, auch ohne E-Mail.
  const items = rows.filter((lead) => (options.withoutEmail ? true : Boolean(lead.email)) && matchesSource(lead.adPlatform, options.source ?? null) && (options.inPipeline === true ? lead.inPipeline !== false : options.inPipeline === false ? lead.inPipeline === false : true)).map((lead) => {
    const entries = byLead.get(`id:${lead.id}`) ?? (lead.email ? byLead.get(`mail:${lead.email.toLowerCase()}`) ?? [] : []);
    const { activity, at } = activityOf(entries);
    const campaigns = Array.from(new Map(entries.map((item) => [item.campaignId, { id: item.campaignId, name: item.campaignName }])).values());
    const { metadata, ...rest } = lead;
    const suppression = lead.email ? suppressions.get(lead.email.toLowerCase()) ?? null : null;
    return { ...rest, felder: extraFieldsOf(metadata), campaigns, activity, activityAt: at, mails: entries.reduce((sum, item) => sum + (item.sentCount ?? 0), 0), blocked: Boolean(suppression), blockedReason: suppression ? SUPPRESSION_LABELS[suppression.reason as SuppressionReason] ?? suppression.reason : null, blockedNote: suppression?.note ?? null };
  });

  const search = (options.search ?? "").trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (options.listName && item.listName !== options.listName) return false;
    if (options.campaignId && !item.campaigns.some((campaign) => campaign.id === options.campaignId)) return false;
    if (options.activity && item.activity !== options.activity) return false;
    if (options.blocked === true && !item.blocked) return false; if (options.blocked === false && item.blocked) return false;
    if (options.stage && item.stage !== options.stage) return false;
    if (options.ownerUserId === "ohne" && item.ownerUserId) return false;
    if (typeof options.ownerUserId === "number" && item.ownerUserId !== options.ownerUserId) return false;
    if (search && !`${item.firstName ?? ""} ${item.lastName ?? ""} ${item.company ?? ""} ${item.email ?? ""} ${item.phone ?? ""} ${item.city ?? ""} ${item.postcode ?? ""} ${item.listName ?? ""} ${item.adCampaignName ?? ""}`.toLowerCase().includes(search)) return false;
    return true;
  });
  const counts = { alle: items.length } as Record<string, number>;
  for (const key of ["gesendet", "geoeffnet", "geklickt", "geantwortet", "abgemeldet", "bounce", "ohne"] as EmailLeadActivity[]) counts[key] = items.filter((item) => item.activity === key).length;
  const lists = Array.from(new Set(items.map((item) => item.listName).filter((name): name is string => Boolean(name)))).sort((a, b) => a.localeCompare(b, "de"));
  const campaigns = Array.from(new Map(items.flatMap((item) => item.campaigns).map((campaign) => [campaign.id, campaign] as const)).values()).sort((a, b) => a.name.localeCompare(b.name, "de"));
  // Oben steht, was gerade zählt: zuerst die mit Reaktion (stärkste zuerst), danach der Rest nach Anlage-Datum.
  const rang: Record<EmailLeadActivity, number> = { geantwortet: 6, geklickt: 5, geoeffnet: 4, gesendet: 3, bounce: 2, abgemeldet: 1, ohne: 0 };
  const sortiert = filtered.sort((a, b) => rang[b.activity] - rang[a.activity] || new Date(b.activityAt ?? b.createdAt).getTime() - new Date(a.activityAt ?? a.createdAt).getTime());
  // Anrufzähler je Kontakt (Spalte „Anrufe“ im Reiter Kontakte)
  const page = sortiert.slice(0, limit); const { callCountsMap } = await import("./pipeline-extras"); const callMap = await callCountsMap(db, tenantId, page.map((item) => item.id));
  return { items: page.map((item) => ({ ...item, calls: callMap.get(item.id) ?? { count: 0, reached: 0, lastAt: null, lastResult: null, lastBy: null } })), total: filtered.length, counts, lists, campaigns, blocked: items.filter((item) => item.blocked).length };
}

/**
 * Kontakte aus der E-Mail-Akquise in die Vertriebspipeline übernehmen – von Hand, nicht automatisch.
 * Sie erscheinen dort in der gewählten Stufe; Kontakte ohne Vertriebler werden nach der Verteilung aus den
 * Einstellungen zugeteilt (reihum, nach Anteilen wie 50/50 oder nach Regeln – je Pipeline einstellbar).
 */
export async function pushLeadsToPipeline(db: Db, tenantId: number, input: { leadIds: number[]; stage?: string | null; target?: "email" | "kaltakquise" | null; actorUserId?: number | null }) {
  const ids = Array.from(new Set(input.leadIds)).slice(0, 2000);
  if (!ids.length) throw new Error("Bitte mindestens einen Kontakt auswählen.");
  // Kontakte aus der E-Mail-Akquise landen in der gewählten Pipeline („E-Mail-Kampagne“ oder „Kaltakquise“) – in der gewählten Stufe.
  // Das gilt auch für Kontakte, die schon in einer anderen Pipeline stehen: sie werden verschoben (ein vorhandener Vertriebler bleibt).
  const target: "email" | "kaltakquise" = input.target === "kaltakquise" ? "kaltakquise" : "email";
  const targetName = PIPELINE_SOURCE_LABEL[target];
  const stageDefs = await pipelineStages(db, tenantId, target);
  const wanted = (input.stage ?? "neu").trim() || "neu";
  const stage = stageDefs.some((item) => item.key === wanted) ? wanted : (stageDefs[0]?.key ?? "neu"); // unbekannte Stufe → erste Stufe der Ziel-Pipeline
  const rows = await db.select({ id: leads.id, inPipeline: leads.inPipeline, stage: leads.pipelineStage, adPlatform: leads.adPlatform }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), inArray(leads.id, ids)));
  const neu = rows.filter((row) => !row.inPipeline);                                        // noch in keiner Pipeline
  const verschoben = rows.filter((row) => row.inPipeline && row.adPlatform !== target);     // aus einer anderen Pipeline
  const umgestuft = rows.filter((row) => row.inPipeline && row.adPlatform === target && row.stage !== stage); // schon in der Ziel-Pipeline, andere Stufe
  const unveraendert = rows.length - neu.length - verschoben.length - umgestuft.length;
  const platformName = (platform: string | null) => { const source = pipelineSourceOf(platform); return isCustomSource(source) ? "eigene Pipeline" : PIPELINE_SOURCE_LABEL[source]; };
  const touched = [...neu, ...verschoben, ...umgestuft];
  if (touched.length) await db.update(leads).set({ inPipeline: true, adPlatform: target, pipelineStage: stage, pipelineUpdatedAt: new Date() }).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, touched.map((row) => row.id))));
  for (const row of neu) await db.insert(pipelineEvents).values({ tenantId, leadId: row.id, fromStage: null, toStage: stage, actorUserId: input.actorUserId ?? null, note: `Aus der E-Mail-Akquise in die Pipeline „${targetName}“ übernommen` });
  for (const row of verschoben) await db.insert(pipelineEvents).values({ tenantId, leadId: row.id, fromStage: row.stage, toStage: stage, actorUserId: input.actorUserId ?? null, note: `Aus der Pipeline „${platformName(row.adPlatform)}“ in die Pipeline „${targetName}“ verschoben` });
  for (const row of umgestuft) await db.insert(pipelineEvents).values({ tenantId, leadId: row.id, fromStage: row.stage, toStage: stage, actorUserId: input.actorUserId ?? null, note: "Stufe über die Kontakte der E-Mail-Akquise gesetzt" });
  // Verteilung aus den Einstellungen (Team → Verteilung neuer Leads): neue und verschobene Kontakte ohne Vertriebler bekommen einen – z. B. 50/50 in der Kaltakquise-Pipeline
  let assigned = 0; const assignedTo = new Map<number, number>();
  for (const row of [...neu, ...verschoben]) { const result = await autoAssign(db, tenantId, row.id); const userId = result?.details?.[0]?.userId ?? null; if (userId) { assigned += 1; assignedTo.set(userId, (assignedTo.get(userId) ?? 0) + 1); } }
  if (touched.length) await logActivity(db, tenantId, { kind: "pipeline_uebernommen", title: `${touched.length} ${touched.length === 1 ? "Kontakt" : "Kontakte"} in die Pipeline „${targetName}“ übernommen${verschoben.length ? ` (${verschoben.length} aus anderen Pipelines verschoben)` : ""}`, detail: `Stufe „${stageDefs.find((item) => item.key === stage)?.label ?? stage}“${assigned ? ` · ${assigned} an Vertriebler verteilt` : ""}`, count: touched.length, leadId: touched.length === 1 ? touched[0].id : null, actorUserId: input.actorUserId ?? null });
  return { moved: neu.length, switched: verschoben.length, restaged: umgestuft.length, already: unveraendert, stage, target, targetName, assigned, assignedTo: Array.from(assignedTo.entries()).map(([userId, count]) => ({ userId, count })) };
}

/* ---------- Upload-Verlauf ---------- */
/** Alle Uploads des Mandanten, neueste zuerst: Liste, Quelle, Anzahl, wer und wann – und ob der Upload schon zurückgenommen wurde. */
export async function listImportHistory(db: Db, tenantId: number, limit = 50) {
  const rows = await db.select({
    id: listImports.id, listName: listImports.listName, source: listImports.source, kind: listImports.kind, note: listImports.note, rowCount: listImports.rowCount,
    created: listImports.created, updated: listImports.updated, duplicates: listImports.duplicates, toPipeline: listImports.toPipeline,
    leadIds: listImports.leadIds, undoneAt: listImports.undoneAt, createdAt: listImports.createdAt, actorName: users.name,
  }).from(listImports).leftJoin(users, eq(users.id, listImports.actorUserId)).where(eq(listImports.tenantId, tenantId)).orderBy(desc(listImports.createdAt)).limit(Math.min(200, Math.max(5, limit)));
  const ids = rows.flatMap((row) => Array.isArray(row.leadIds) ? (row.leadIds as number[]) : []);
  const vorhanden = ids.length ? new Set((await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, Array.from(new Set(ids)))))).map((row) => row.id)) : new Set<number>();
  return rows.map((row) => { const eigene = Array.isArray(row.leadIds) ? (row.leadIds as number[]) : []; const { leadIds, ...rest } = row; return { ...rest, stillThere: eigene.filter((id) => vorhanden.has(id)).length }; });
}
/**
 * Einen Upload rückgängig machen: Es werden nur die Kontakte gelöscht, die bei genau diesem Upload neu entstanden sind.
 * Kontakte, die dabei nur aktualisiert wurden, bleiben – sie gab es ja vorher schon. Kunden bleiben ebenfalls erhalten.
 */
/** Liste eines Uploads umbenennen – z. B. wenn zwei Dateien versehentlich unter demselben Listennamen hochgeladen wurden. Nur die Kontakte dieses Uploads wandern in die neue Liste. */
export async function renameListImport(db: Db, tenantId: number, input: { id: number; listName: string }, actorUserId: number | null = null) {
  const listName = input.listName.trim().replace(/\s+/g, " ").slice(0, 160); if (!listName) throw new Error("Bitte einen Listennamen angeben.");
  const row = (await db.select().from(listImports).where(and(eq(listImports.tenantId, tenantId), eq(listImports.id, input.id))).limit(1))[0];
  if (!row) throw new Error("Diesen Upload gibt es nicht mehr.");
  if (row.undoneAt) throw new Error("Dieser Upload wurde zurückgenommen.");
  const ids = Array.isArray(row.leadIds) ? (row.leadIds as number[]) : [];
  if (ids.length) await db.update(leads).set({ listName, adCampaignId: `liste-${listName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, adCampaignName: `Liste: ${listName}` }).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, ids)));
  await db.update(listImports).set({ listName }).where(eq(listImports.id, row.id));
  await logActivity(db, tenantId, { kind: "sonstiges", title: `Liste umbenannt: „${row.listName}“ → „${listName}“ (${ids.length} Kontakte)`, actorUserId, refType: "listImport", refId: row.id });
  return { renamed: ids.length, from: row.listName, listName };
}

export async function undoListImport(db: Db, tenantId: number, importId: number, actorUserId: number | null = null) {
  const row = (await db.select().from(listImports).where(and(eq(listImports.tenantId, tenantId), eq(listImports.id, importId))).limit(1))[0];
  if (!row) throw new Error("Diesen Upload gibt es nicht mehr.");
  if (row.undoneAt) throw new Error("Dieser Upload wurde bereits zurückgenommen.");
  const ids = Array.isArray(row.leadIds) ? (row.leadIds as number[]) : [];
  const rows = ids.length ? await db.select({ id: leads.id, stage: leads.pipelineStage }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), inArray(leads.id, ids))) : [];
  const keep = rows.filter((item) => item.stage === "kunde").map((item) => item.id);
  const weg = rows.filter((item) => !keep.includes(item.id)).map((item) => item.id);
  let undoId = 0;
  if (weg.length) {
    undoId = await removeLeadsCascade(db, tenantId, weg, { actorUserId, reason: `Upload vom ${row.createdAt.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })} rückgängig gemacht` });
  }
  await db.update(listImports).set({ undoneAt: new Date() }).where(eq(listImports.id, row.id));
  await logActivity(db, tenantId, { kind: "upload_rueckgaengig", title: `Upload „${row.listName}“ rückgängig gemacht: ${weg.length} Kontakte entfernt${keep.length ? `, ${keep.length} Kunden behalten` : ""}`, count: 1, refType: "listImport", refId: row.id });
  return { deleted: weg.length, keptCustomers: keep.length, listName: row.listName, undoId };
}

/**
 * Eine gesendete E-Mail noch einmal so zeigen, wie sie rausging. Kampagnen-Mails werden aus dem damaligen
 * Schritt und den Daten des Empfängers neu aufgebaut (Kennung „k<Ereignis-ID>“); Antworten und Einzel-E-Mails
 * kommen aus dem gespeicherten Text (Kennung „e<Nachrichten-ID>“).
 */
export async function sentMailPreview(db: Db, tenantId: number, id: string) {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (id.startsWith("k")) {
    const eventId = Number(id.slice(1));
    const event = (await db.select().from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.id, eventId))).limit(1))[0];
    if (!event) throw new Error("Diese E-Mail gibt es nicht mehr.");
    const recipient = (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.id, event.recipientId))).limit(1))[0];
    const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.tenantId, tenantId), eq(emailCampaigns.id, event.campaignId))).limit(1))[0];
    if (!recipient || !campaign) throw new Error("Empfänger oder Kampagne gibt es nicht mehr.");
    const node = tree(campaign).nodes.find((item) => item.id === event.nodeId && item.type === "send") as Extract<EmailNode, { type: "send" }> | undefined;
    const lead = recipient.leadId ? (await db.select().from(leads).where(eq(leads.id, recipient.leadId)).limit(1))[0] : null;
    if (!node && event.body) return { kind: "kampagne" as const, to: recipient.email, name: recipient.name, subject: event.subject ?? "", at: event.createdAt, campaignName: campaign.name, html: `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#101828;max-width:600px;margin:0 auto;padding:18px 16px;white-space:pre-wrap">${escape(event.body)}</div>`, note: "genau so verschickt (der Schritt wurde inzwischen aus der Kampagne entfernt).", source: (event.bodySource === "hand" ? "hand" : event.bodySource === "entwurf-vorlage" ? "entwurf-vorlage" : "ki") as SentSource, exact: true };
    if (!node) return { kind: "kampagne" as const, to: recipient.email, name: recipient.name, subject: event.subject ?? "", at: event.createdAt, campaignName: campaign.name, html: `<p style="font-family:sans-serif;color:#475569">Der Schritt dieser E-Mail wurde inzwischen aus der Kampagne entfernt – der Inhalt lässt sich nicht mehr nachbauen. Betreff damals: „${escape(event.subject ?? "")}“.</p>`, note: "Schritt existiert nicht mehr" };
    const base = (process.env.APP_URL ?? "").replace(/\/+$/, "");
    const values = recipientValues({ firstName: lead?.firstName ?? recipient.name?.split(" ")[0], lastName: lead?.lastName ?? recipient.name?.split(" ").slice(1).join(" "), company: lead?.company ?? recipient.company, city: lead?.city, salutation: (lead?.metadata as { salutation?: string } | null)?.salutation ?? null, email: recipient.email, fields: extraFieldsOf(lead?.metadata) }, `${base}/api/mail/u/${recipient.token}`);
    const signature = await signatureFor(db, tenantId, base).then((result) => ({ html: result.html, text: result.text })).catch(() => null);
    // Was ging wirklich raus? Ab jetzt gespeichert (body/bodySource); bei älteren E-Mails aus dem letzten Entwurf und dem Betreff erschlossen
    const origin = sentSourceOf({ bodySource: event.bodySource, subject: event.subject, draftSubject: recipient.draftSubject, draftSource: recipient.draftSource, templateSubjects: [node.subject, node.subjectB], kiOn: kiModusOf(campaign) !== "aus" });
    const body = event.body ?? (recipient.draftText && recipient.draftSubject?.trim() && recipient.draftSubject.trim() === (event.subject ?? "").trim() ? recipient.draftText : null);
    const sentNode = body ? { ...node, subject: event.subject ?? node.subject, subjectB: null, blocks: draftToBlocks(body, node.blocks) } : node;
    const rendered = renderNode(sentNode, design(campaign), values, { unsubscribeUrl: `${base}/api/mail/u/${recipient.token}`, logoBase: base, subject: event.subject ?? undefined, preview: true, signature });
    const note = origin.source === "vorlage" ? "Vorlage des Schritts – diese E-Mail ging ohne KI-Text raus." : origin.source === "entwurf-vorlage" ? (body ? "Ersatz-Entwurf aus der Vorlage – die KI konnte für diesen Kontakt keinen eigenen Text schreiben. Genau so verschickt." : "Ersatz-Entwurf aus der Vorlage (Drittanbieter-Text) – die KI konnte für diesen Kontakt keinen eigenen Text schreiben.") : origin.source === "hand" ? "von Hand geändert – genau so verschickt." : body ? "genau so verschickt." : "Diese E-Mail ging mit KI-Text raus (der Betreff oben ist echt). Den genauen Text hat die Software bei älteren E-Mails nicht gespeichert – ab jetzt wird jeder Text gespeichert. Unten nur die Vorlage zur Orientierung.";
    return { kind: "kampagne" as const, to: recipient.email, name: recipient.name, subject: event.subject ?? rendered.subject, at: event.createdAt, campaignName: campaign.name, html: rendered.html, note, source: origin.source, exact: Boolean(body) || origin.source === "vorlage" };
  }
  const messageId = Number(id.slice(1));
  const row = (await db.select().from(outboundMessages).where(and(eq(outboundMessages.tenantId, tenantId), eq(outboundMessages.id, messageId))).limit(1))[0];
  if (!row) throw new Error("Diese Nachricht gibt es nicht mehr.");
  const html = `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#101828;max-width:600px;margin:0 auto;padding:18px 16px;white-space:pre-wrap">${escape(row.text ?? "")}</div>`;
  return { kind: (row.inboxMessageId ? "antwort" : "einzel") as "antwort" | "einzel", to: row.toAddress, name: null as string | null, subject: row.subject ?? "", at: row.createdAt, campaignName: null as string | null, html, note: row.status === "gesendet" ? null : `Status: ${row.status}` };
}
