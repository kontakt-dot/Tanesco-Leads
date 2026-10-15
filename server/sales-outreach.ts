/**
 * Vertrieb: Kaltakquise-Listen (CSV → Leads in der Pipeline, Anrufkampagne manuell/power/predictive über den Dialer)
 * und E-Mail-Kampagnen mit Ablauf-Baum (Senden → Warten → Wenn geöffnet/geklickt → Dann/Sonst), Tracking per Pixel/Link.
 */
import { and, asc, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import crypto from "node:crypto";
import { dialerCalls, dialerQueueItems, emailCampaignEvents, emailCampaignRecipients, emailCampaigns, inboxMessages, leadCategories, leadStatusEvents, leadTagAssignments, leads, listImports, outboundMessages, pipelineEvents, pipelineNotes, pipelineTasks, tags, tenantSettings, users, type EmailCampaign } from "../drizzle/schema";
import { abVariantFor, advanceRecipient, DEFAULT_SEND_WINDOW, followUpTree, resolveSendWindow, hasAbTest, recipientValues, renderNode, starterTree, summarizeCampaign, validateTree, type EmailNode, type EmailTree, type RecipientState, type SendDay, type SendWindow } from "../shared/email-campaigns";
import { addSuppression, autoAssign, suppressedSet } from "./pipeline-extras";
import { companyFooterText, DEFAULT_DESIGN, starterBlocks, type EmailDesign } from "../shared/email-design";
import { buildQueue, saveCampaign as saveDialerCampaign, setCampaignStatus } from "./dialer";
import { deliverMail } from "./email-onboarding";
import { distributeOwners } from "./meta-ads";
import type { Db } from "./lead-pipeline";

/* ---------- Kaltakquise-Listen ---------- */
import { extraFieldsOf, parseColdList, type ColdRow } from "../shared/cold-list";
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

export async function importColdList(db: Db, tenantId: number, input: { listName: string; categoryId?: number | null; rows: ColdRow[]; ownerUserIds?: number[] | null; actorUserId?: number | null; tagNames?: string[] | null; duplicateMode?: "aktualisieren" | "ueberspringen" | null; toPipeline?: boolean }) {
  const listName = input.listName.trim(); if (!listName) throw new Error("Bitte einen Listennamen angeben."); if (!input.rows.length) throw new Error("Die Liste enthält keine verwertbaren Zeilen (Telefon oder E-Mail nötig).");
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
    const inserted = await db.insert(leads).values({ tenantId, publicId, categoryId, kind: "vertrieb", firstName: row.firstName ?? null, lastName: row.lastName ?? row.company ?? null, email: emailKey || null, phone: row.phone ?? null, postcode: row.postcode ?? null, city: row.city ?? null, country: "DE", supplierName: "Kaltakquise", metadata: { salutation: row.salutation ?? undefined, notes: row.notes ?? undefined, kaltakquise: { liste: listName }, ...(row.extra && Object.keys(row.extra).length ? { felder: row.extra } : {}) }, status: "neu", cost: "0.00", pipelineStage: "neu", pipelineUpdatedAt: new Date(), adCampaignId: `liste-${listName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, adCampaignName: `Liste: ${listName}`, adPlatform: "kaltakquise", company: row.company ?? null, listName, inPipeline: toPipeline });
    const leadId = Number(inserted[0]?.insertId) || 0; leadIds.push(leadId); created += 1;
    const self = { id: leadId, status: "neu", phone: row.phone ?? null, email: emailKey || null, firstName: row.firstName ?? null, lastName: row.lastName ?? null, company: row.company ?? null, postcode: row.postcode ?? null, city: row.city ?? null, metadata: null } as Known;
    if (phoneKey) byPhone.set(phoneKey, self); if (emailKey) byEmail.set(emailKey, self);
    await assignTags(leadId);
    await db.insert(leadStatusEvents).values({ tenantId, leadId, previousStatus: null, nextStatus: "neu", actorUserId: null, note: `Kaltakquise-Liste „${listName}“ hochgeladen` });
    if (toPipeline) await db.insert(pipelineEvents).values({ tenantId, leadId, fromStage: null, toStage: "neu", actorUserId: null, note: `Aus Kaltakquise-Liste „${listName}“` });
  }
  if (toPipeline) {
    if (input.ownerUserIds?.length && leadIds.length) await distributeOwners(db, tenantId, { leadIds, userIds: input.ownerUserIds, actorUserId: input.actorUserId ?? null });
    else for (const leadId of leadIds) await autoAssign(db, tenantId, leadId); // Verteilregeln, wenn eingeschaltet
  }
  // Upload-Verlauf festhalten – damit man später sieht, was wann hochgeladen wurde, und es rückgängig machen kann.
  await db.insert(listImports).values({ tenantId, listName, source: toPipeline ? "kaltakquise" : "kampagne", rowCount: input.rows.length, created, updated, duplicates, toPipeline, leadIds, actorUserId: input.actorUserId ?? null });
  return { created, duplicates, updated, tagId: tag.id, listName, leadIds, toPipeline };
}
export async function listColdLists(db: Db, tenantId: number) {
  const rows = await db.select({ listName: leads.listName, stage: leads.pipelineStage, phone: leads.phone, email: leads.email, metadata: leads.metadata }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.adPlatform, "kaltakquise")));
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

/* ---------- E-Mail-Kampagnen ---------- */
export type Audience = { source: "liste" | "stufe" | "tag" | "alle"; listName?: string | null; stage?: string | null; tagId?: number | null };
const tree = (campaign: EmailCampaign): EmailTree => (campaign.tree && typeof campaign.tree === "object" ? (campaign.tree as EmailTree) : { start: null, nodes: [] });
const design = (campaign: EmailCampaign): EmailDesign => ({ ...DEFAULT_DESIGN, ...((campaign.design ?? {}) as Partial<EmailDesign>) });
export async function listEmailCampaigns(db: Db, tenantId: number) {
  const rows = await db.select().from(emailCampaigns).where(eq(emailCampaigns.tenantId, tenantId)).orderBy(desc(emailCampaigns.updatedAt));
  const recipients = await db.select({ campaignId: emailCampaignRecipients.campaignId, status: emailCampaignRecipients.status, sentCount: emailCampaignRecipients.sentCount, openedAt: emailCampaignRecipients.openedAt, clickedAt: emailCampaignRecipients.clickedAt, repliedAt: emailCampaignRecipients.repliedAt, variant: emailCampaignRecipients.variant }).from(emailCampaignRecipients).where(eq(emailCampaignRecipients.tenantId, tenantId));
  return rows.map((row) => ({ id: row.id, name: row.name, status: row.status, fromName: row.fromName, fromEmail: row.fromEmail, audience: (row.audience ?? { source: "alle" }) as Audience, steps: tree(row).nodes.filter((node) => node.type === "send").length, startedAt: row.startedAt, updatedAt: row.updatedAt, isTemplate: row.isTemplate, abTest: hasAbTest(tree(row)), abSplit: row.abSplit, sendWindow: sendWindowOf(row), stats: summarizeCampaign(recipients.filter((item) => item.campaignId === row.id).map((item) => ({ ...item, variant: (item.variant ?? null) as "A" | "B" | null }))) }));
}
export async function getEmailCampaign(db: Db, tenantId: number, id: number) {
  const row = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Kampagne nicht gefunden.");
  const recipients = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, id))).orderBy(desc(emailCampaignRecipients.createdAt));
  const events = await db.select().from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.campaignId, id))).orderBy(desc(emailCampaignEvents.createdAt)).limit(200);
  return { ...row, tree: tree(row), design: design(row), audience: (row.audience ?? { source: "alle" }) as Audience, sendWindow: sendWindowOf(row), recipients: recipients.map((item) => ({ id: item.id, email: item.email, name: item.name, company: item.company, status: item.status, nodeId: item.nodeId, nextActionAt: item.nextActionAt, sentCount: item.sentCount, openedAt: item.openedAt, clickedAt: item.clickedAt, repliedAt: item.repliedAt, variant: (item.variant ?? null) as "A" | "B" | null, clickedUrls: (Array.isArray(item.clickedUrls) ? item.clickedUrls : []) as string[], bouncedAt: item.bouncedAt, lastError: item.lastError })), events: events.map((event) => ({ id: event.id, recipientId: event.recipientId, kind: event.kind, subject: event.subject, note: event.note, createdAt: event.createdAt })), stats: summarizeCampaign(recipients.map((item) => ({ ...item, variant: (item.variant ?? null) as "A" | "B" | null }))) };
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
  return { enabled: Boolean(raw.enabled), weekdays: Array.isArray(raw.weekdays) ? (raw.weekdays as unknown[]).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : DEFAULT_SEND_WINDOW.weekdays, from: time(raw.from, DEFAULT_SEND_WINDOW.from), to: time(raw.to, DEFAULT_SEND_WINDOW.to), timezone: String(raw.timezone ?? DEFAULT_SEND_WINDOW.timezone).slice(0, 60) || DEFAULT_SEND_WINDOW.timezone, days: normalizeSendDays(raw.days) };
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
export async function saveEmailCampaign(db: Db, tenantId: number, userId: number, input: { id?: number | null; name: string; fromName?: string | null; fromEmail?: string | null; replyTo?: string | null; audience: Audience; tree: EmailTree; design: Partial<EmailDesign>; sendWindow?: unknown; isTemplate?: boolean | null; abSplit?: number | null }) {
  const name = input.name.trim(); if (!name) throw new Error("Bitte einen Kampagnennamen angeben.");
  const values = { tenantId, name, fromName: input.fromName?.trim() || null, fromEmail: input.fromEmail?.trim().toLowerCase() || null, replyTo: input.replyTo?.trim() || null, audience: input.audience, tree: input.tree, design: { ...DEFAULT_DESIGN, ...(await tenantDesign(db, tenantId)), ...input.design }, createdByUserId: userId, ...(input.sendWindow !== undefined ? { sendWindow: normalizeSendWindow(input.sendWindow) } : {}), ...(input.isTemplate !== undefined && input.isTemplate !== null ? { isTemplate: input.isTemplate } : {}), ...(input.abSplit !== undefined && input.abSplit !== null ? { abSplit: Math.min(90, Math.max(10, Math.round(input.abSplit))) } : {}) };
  if (input.id) { await db.update(emailCampaigns).set(values).where(and(eq(emailCampaigns.id, input.id), eq(emailCampaigns.tenantId, tenantId))); return { id: input.id }; }
  const inserted = await db.insert(emailCampaigns).values(values); return { id: Number(inserted[0]?.insertId) || 0 };
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
  const inserted = await db.insert(emailCampaigns).values({ tenantId, name, status: "entwurf", fromName: row.fromName, fromEmail: row.fromEmail, replyTo: row.replyTo, audience: row.audience, tree: row.tree, design: row.design, sendWindow: row.sendWindow, isTemplate: Boolean(input.asTemplate), abSplit: row.abSplit, createdByUserId: userId });
  return { id: Number(inserted[0]?.insertId) || 0, name };
}
export async function setEmailCampaignTemplate(db: Db, tenantId: number, id: number, isTemplate: boolean) { await db.update(emailCampaigns).set({ isTemplate }).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.tenantId, tenantId))); return { success: true as const }; }
export async function deleteEmailCampaign(db: Db, tenantId: number, id: number) { await db.delete(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.campaignId, id))); await db.delete(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, id))); await db.delete(emailCampaigns).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.tenantId, tenantId))); return { success: true as const }; }
async function audienceLeads(db: Db, tenantId: number, audience: Audience) {
  const conditions = [eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb")]; // Zielgruppen bestehen nur aus Vertriebskontakten – nie aus Leads zum Verkauf
  if (audience.source === "liste" && audience.listName) conditions.push(eq(leads.listName, audience.listName));
  if (audience.source === "stufe" && audience.stage) conditions.push(eq(leads.pipelineStage, audience.stage));
  let rows = await db.select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, email: leads.email, company: leads.company, city: leads.city, metadata: leads.metadata }).from(leads).where(and(...conditions));
  if (audience.source === "tag" && audience.tagId) { const tagged = new Set((await db.select({ leadId: leadTagAssignments.leadId }).from(leadTagAssignments).where(eq(leadTagAssignments.tagId, audience.tagId))).map((row) => row.leadId)); rows = rows.filter((row) => tagged.has(row.id)); }
  const blocked = await suppressedSet(db, tenantId);
  return rows.filter((row) => row.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) && !blocked.has(row.email.toLowerCase()));
}
/**
 * Zielgruppe prüfen: Anzahl und die ersten Empfänger – jeweils mit allen Platzhalter-Werten,
 * damit sich die E-Mail im Builder mit echten Daten ansehen lässt, bevor sie rausgeht.
 */
export async function previewAudience(db: Db, tenantId: number, audience: Audience) {
  const rows = await audienceLeads(db, tenantId, audience);
  const sample = rows.slice(0, 5).map((row) => ({
    name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(), email: row.email, company: row.company,
    values: recipientValues({ firstName: row.firstName, lastName: row.lastName, company: row.company, city: row.city, salutation: (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as { salutation?: string }).salutation : null) ?? null, email: row.email, fields: extraFieldsOf(row.metadata) }, null),
  }));
  return { count: rows.length, sample };
}
/** Kampagne starten: Empfänger aus der Zielgruppe anlegen (ohne Doppelte) und sofort den ersten Schritt ausführen. */
export async function startEmailCampaign(db: Db, tenantId: number, id: number, appUrl: string) {
  const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!campaign) throw new Error("Kampagne nicht gefunden.");
  const issues = validateTree(tree(campaign)); if (issues.length) throw new Error(issues.join(" "));
  const rows = await audienceLeads(db, tenantId, (campaign.audience ?? { source: "alle" }) as Audience); if (!rows.length) throw new Error("Die Zielgruppe enthält keine Kontakte mit E-Mail-Adresse.");
  if (campaign.isTemplate) throw new Error("Das ist eine Vorlage – bitte zuerst „Aus Vorlage anlegen“ und dann die Kampagne starten.");
  const existing = new Set((await db.select({ email: emailCampaignRecipients.email }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, id)))).map((row) => row.email));
  const abTest = hasAbTest(tree(campaign)); let index = existing.size;
  let added = 0;
  for (const row of rows) { if (existing.has(row.email!)) continue; const current = (await db.select({ platform: leads.adPlatform, stage: leads.pipelineStage }).from(leads).where(eq(leads.id, row.id)).limit(1))[0]; if (current && !current.platform) { await db.update(leads).set({ adPlatform: "email", adCampaignId: `email-${id}`, adCampaignName: campaign.name, pipelineStage: current.stage ?? "neu", pipelineUpdatedAt: new Date() }).where(eq(leads.id, row.id)); await db.insert(pipelineEvents).values({ tenantId, leadId: row.id, fromStage: null, toStage: current.stage ?? "neu", actorUserId: null, note: `In E-Mail-Kampagne „${campaign.name}“ aufgenommen` }); }
    await db.insert(emailCampaignRecipients).values({ tenantId, campaignId: id, leadId: row.id, email: row.email!, name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || null, company: row.company ?? null, token: crypto.randomBytes(16).toString("hex"), nodeId: tree(campaign).start, nextActionAt: new Date(Date.now() - 2000), status: "wartet", sentCount: 0, variant: abTest ? abVariantFor(index, campaign.abSplit) : null }); index += 1; added += 1; } /* 2 s in der Vergangenheit: MySQL rundet Sekunden auf */
  await db.update(emailCampaigns).set({ status: "aktiv", startedAt: campaign.startedAt ?? new Date() }).where(eq(emailCampaigns.id, id));
  // Versand läuft im Hintergrund (SMTP kann dauern) – die Anfrage kehrt sofort zurück; der Zeitplaner nimmt den Rest.
  const processed = await Promise.race([processEmailCampaigns(db, appUrl, { campaignId: id, limit: 25 }).catch((error) => { console.error("[E-Mail-Kampagnen] Start:", error instanceof Error ? error.message : error); return 0; }), new Promise<number>((resolve) => setTimeout(() => resolve(-1), 4000))]);
  return { added, processed: Math.max(processed, 0), background: processed < 0 };
}
export async function setEmailCampaignStatus(db: Db, tenantId: number, id: number, status: "aktiv" | "pausiert" | "beendet") { await db.update(emailCampaigns).set({ status }).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.tenantId, tenantId))); return { success: true as const }; }
/** Zeitplaner: fällige Empfänger aller aktiven Kampagnen weiterführen. */
export async function processEmailCampaigns(db: Db, appUrl: string, options: { campaignId?: number; limit?: number } = {}) {
  const now = new Date(); const horizon = new Date(now.getTime() + 1500); const base = appUrl.replace(/\/+$/, ""); /* horizon: Toleranz für Sekundenrundung der DB */
  const campaignConditions = [eq(emailCampaigns.status, "aktiv")]; if (options.campaignId) campaignConditions.push(eq(emailCampaigns.id, options.campaignId));
  const active = await db.select().from(emailCampaigns).where(and(...campaignConditions)); let processed = 0;
  for (const campaign of active) {
    const due = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId, campaign.id), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]), or(isNull(emailCampaignRecipients.nextActionAt), lte(emailCampaignRecipients.nextActionAt, horizon)))).limit(options.limit ?? 100);
    for (const recipient of due) {
      const lead = recipient.leadId ? (await db.select().from(leads).where(eq(leads.id, recipient.leadId)).limit(1))[0] : null;
      const values = recipientValues({ firstName: lead?.firstName ?? recipient.name?.split(" ")[0], lastName: lead?.lastName ?? recipient.name?.split(" ").slice(1).join(" "), company: lead?.company ?? recipient.company, city: lead?.city, salutation: (lead?.metadata as { salutation?: string } | null)?.salutation ?? null, email: recipient.email, fields: extraFieldsOf(lead?.metadata) }, `${base}/api/mail/u/${recipient.token}`);
      const state: RecipientState = { nodeId: recipient.nodeId, nextActionAt: recipient.nextActionAt && recipient.nextActionAt <= horizon ? null : recipient.nextActionAt, status: recipient.status as RecipientState["status"], sentCount: recipient.sentCount, openedAt: recipient.openedAt, clickedAt: recipient.clickedAt, repliedAt: recipient.repliedAt, lastSentAt: recipient.lastSentAt, variant: (recipient.variant ?? null) as RecipientState["variant"], clickedUrls: (Array.isArray(recipient.clickedUrls) ? recipient.clickedUrls : []) as string[] };
      const result = await advanceRecipient(tree(campaign), state, now, async (node, subject) => { const rendered = (() => { const d = design(campaign); // persönlicher Versand: kein Zählpixel, keine umgeschriebenen Links – nur der Abmelde-Link bleibt (gesetzlich nötig)
        return renderNode(node, d, values, d.plain ? { unsubscribeUrl: `${base}/api/mail/u/${recipient.token}`, logoBase: base, subject } : { pixelUrl: `${base}/api/mail/o/${recipient.token}.gif`, wrapLink: (url) => `${base}/api/mail/c/${recipient.token}?u=${encodeURIComponent(url)}`, unsubscribeUrl: `${base}/api/mail/u/${recipient.token}`, logoBase: base, subject }); })(); const sent = await deliverMail({ to: recipient.email, subject: rendered.subject, html: rendered.html, text: rendered.text }, { db, tenantId: campaign.tenantId }); if (!sent.ok) await db.update(emailCampaignRecipients).set({ lastError: sent.note ?? "Versand fehlgeschlagen" }).where(eq(emailCampaignRecipients.id, recipient.id)); return { ok: sent.ok, subject: rendered.subject }; }, { window: sendWindowOf(campaign) });
      await db.update(emailCampaignRecipients).set({ nodeId: result.state.nodeId, nextActionAt: result.state.nextActionAt, status: result.state.status, sentCount: result.state.sentCount, lastSentAt: result.state.lastSentAt }).where(eq(emailCampaignRecipients.id, recipient.id));
      for (const event of result.events) await db.insert(emailCampaignEvents).values({ tenantId: campaign.tenantId, campaignId: campaign.id, recipientId: recipient.id, nodeId: event.nodeId, kind: event.kind, subject: event.subject ?? null, note: event.note });
      processed += 1;
    }
    const open = await db.select({ id: emailCampaignRecipients.id }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId, campaign.id), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]))).limit(1);
    if (!open.length && due.length) await db.update(emailCampaigns).set({ status: "beendet" }).where(eq(emailCampaigns.id, campaign.id));
  }
  return processed;
}
/** Tracking: Öffnung (Pixel), Klick (Weiterleitung), Abmeldung. */
export async function trackOpen(db: Db, token: string) { const recipient = (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.token, token)).limit(1))[0]; if (!recipient) return false; if (!recipient.openedAt || (recipient.lastSentAt && recipient.openedAt < recipient.lastSentAt)) { await db.update(emailCampaignRecipients).set({ openedAt: new Date() }).where(eq(emailCampaignRecipients.id, recipient.id)); await db.insert(emailCampaignEvents).values({ tenantId: recipient.tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: "geoeffnet", note: "E-Mail geöffnet" }); } return true; }
export async function trackClick(db: Db, token: string, url: string) { const recipient = (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.token, token)).limit(1))[0]; if (!recipient) return null; const urls = Array.from(new Set([...((Array.isArray(recipient.clickedUrls) ? recipient.clickedUrls : []) as string[]), url.slice(0, 400)])).slice(-20); await db.update(emailCampaignRecipients).set({ clickedAt: new Date(), openedAt: recipient.openedAt ?? new Date(), clickedUrls: urls }).where(eq(emailCampaignRecipients.id, recipient.id)); await db.insert(emailCampaignEvents).values({ tenantId: recipient.tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: "geklickt", note: `Link geklickt: ${url.slice(0, 200)}` }); return /^https?:\/\//.test(url) ? url : null; }
export async function unsubscribe(db: Db, token: string) { const recipient = (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.token, token)).limit(1))[0]; if (!recipient) return false; await db.update(emailCampaignRecipients).set({ status: "abgemeldet", nextActionAt: null }).where(eq(emailCampaignRecipients.id, recipient.id)); const campaignName = (await db.select({ name: emailCampaigns.name }).from(emailCampaigns).where(eq(emailCampaigns.id, recipient.campaignId)).limit(1))[0]?.name ?? null; await addSuppression(db, recipient.tenantId, { email: recipient.email, reason: "abgemeldet", note: `Abmelde-Link geklickt${campaignName ? ` in „${campaignName}“` : ""}`, source: campaignName ? `Abmelde-Link „${campaignName}“` : "Abmelde-Link" }).catch(() => null); await db.insert(emailCampaignEvents).values({ tenantId: recipient.tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: "abgemeldet", note: "Empfänger hat sich abgemeldet" }); return true; }
export async function markReplied(db: Db, tenantId: number, recipientId: number) { const recipient = (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.id, recipientId), eq(emailCampaignRecipients.tenantId, tenantId))).limit(1))[0]; if (!recipient) throw new Error("Empfänger nicht gefunden."); await db.update(emailCampaignRecipients).set({ repliedAt: new Date() }).where(eq(emailCampaignRecipients.id, recipientId)); return { success: true as const }; }
export async function sendTestEmail(db: Db, tenantId: number, input: { to: string; node: Extract<EmailNode, { type: "send" }>; design: Partial<EmailDesign> }) {
  const rendered = renderNode(input.node, { ...DEFAULT_DESIGN, ...input.design }, recipientValues({ firstName: "Max", lastName: "Muster", company: "Muster GmbH", city: "Frankfurt", salutation: "herr", email: input.to }, null), { logoBase: process.env.APP_URL ?? "", unsubscribeUrl: `${(process.env.APP_URL ?? "").replace(/\/+$/, "")}/api/mail/u/test` });
  const result = await deliverMail({ to: input.to, subject: `[Test] ${rendered.subject}`, html: rendered.html, text: rendered.text }, { db, tenantId }); return { status: result.status, note: result.note ?? null, messageId: result.messageId ?? null };
}
export const previewNodeHtml = (node: Extract<EmailNode, { type: "send" }>, designInput: Partial<EmailDesign>) => renderNode(node, { ...DEFAULT_DESIGN, ...designInput }, recipientValues({ firstName: "Max", lastName: "Muster", company: "Muster GmbH", city: "Frankfurt", salutation: "herr", email: "max@beispiel.de" }, "https://beispiel.de/abmelden"), { logoBase: process.env.APP_URL ?? "", unsubscribeUrl: "https://beispiel.de/abmelden", preview: true }).html;
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
export async function applyFooterToCampaigns(db: Db, tenantId: number, options: { includeTemplates?: boolean } = {}) {
  const patch = await tenantDesign(db, tenantId);
  if (!patch.footerText) return { updated: 0, footerText: null as string | null };
  const rows = await db.select({ id: emailCampaigns.id, design: emailCampaigns.design, isTemplate: emailCampaigns.isTemplate }).from(emailCampaigns).where(eq(emailCampaigns.tenantId, tenantId));
  let updated = 0;
  for (const row of rows) {
    if (row.isTemplate && options.includeTemplates === false) continue;
    const design = { ...DEFAULT_DESIGN, ...((row.design ?? {}) as Partial<EmailDesign>) };
    if (design.footerText === patch.footerText) continue;
    await db.update(emailCampaigns).set({ design: { ...design, footerText: patch.footerText } }).where(eq(emailCampaigns.id, row.id));
    updated += 1;
  }
  return { updated, footerText: patch.footerText };
}

/**
 * Eine hochgeladene Liste löschen – mit allen Kontakten, die daraus entstanden sind.
 * Kunden bleiben standardmäßig erhalten (`keepCustomers`), damit kein Abschluss verloren geht;
 * sie verlieren nur die Zuordnung zur Liste. Alles, was an den gelöschten Kontakten hängt
 * (Aufgaben, Notizen, Nachrichten, Empfänger in Serien, Wählliste), wird mitgelöscht.
 */
export async function deleteColdList(db: Db, tenantId: number, input: { listName: string; keepCustomers?: boolean }) {
  const listName = input.listName.trim(); if (!listName) throw new Error("Bitte eine Liste angeben.");
  const keepCustomers = input.keepCustomers ?? true;
  const rows = await db.select({ id: leads.id, stage: leads.pipelineStage }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.listName, listName)));
  if (!rows.length) throw new Error(`Zur Liste „${listName}“ gibt es keine Kontakte mehr.`);
  const keep = keepCustomers ? rows.filter((row) => row.stage === "kunde").map((row) => row.id) : [];
  const remove = rows.filter((row) => !keep.includes(row.id)).map((row) => row.id);
  if (remove.length) {
    await db.delete(pipelineTasks).where(and(eq(pipelineTasks.tenantId, tenantId), inArray(pipelineTasks.leadId, remove)));
    await db.delete(pipelineEvents).where(and(eq(pipelineEvents.tenantId, tenantId), inArray(pipelineEvents.leadId, remove)));
    await db.delete(pipelineNotes).where(and(eq(pipelineNotes.tenantId, tenantId), inArray(pipelineNotes.leadId, remove)));
    await db.delete(outboundMessages).where(and(eq(outboundMessages.tenantId, tenantId), inArray(outboundMessages.leadId, remove)));
    await db.delete(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), inArray(emailCampaignRecipients.leadId, remove)));
    await db.delete(dialerQueueItems).where(and(eq(dialerQueueItems.tenantId, tenantId), inArray(dialerQueueItems.leadId, remove)));
    await db.delete(leadStatusEvents).where(and(eq(leadStatusEvents.tenantId, tenantId), inArray(leadStatusEvents.leadId, remove)));
    await db.delete(leadTagAssignments).where(inArray(leadTagAssignments.leadId, remove));
    await db.update(inboxMessages).set({ leadId: null }).where(and(eq(inboxMessages.tenantId, tenantId), inArray(inboxMessages.leadId, remove)));
    await db.update(dialerCalls).set({ leadId: null }).where(and(eq(dialerCalls.tenantId, tenantId), inArray(dialerCalls.leadId, remove)));
    await db.delete(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, remove)));
  }
  if (keep.length) await db.update(leads).set({ listName: null }).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, keep)));
  // Das Tag „Liste: …“ nur entfernen, wenn es niemand mehr trägt.
  const tag = (await db.select().from(tags).where(and(eq(tags.tenantId, tenantId), eq(tags.name, `Liste: ${listName}`.slice(0, 80)))).limit(1))[0];
  if (tag) { const used = (await db.select({ leadId: leadTagAssignments.leadId }).from(leadTagAssignments).where(eq(leadTagAssignments.tagId, tag.id)).limit(1))[0]; if (!used) await db.delete(tags).where(eq(tags.id, tag.id)); }
  return { deleted: remove.length, keptCustomers: keep.length, listName };
}

/* ---------- Kontakte der E-Mail-Akquise ---------- */
export type EmailLeadActivity = "gesendet" | "geoeffnet" | "geklickt" | "geantwortet" | "abgemeldet" | "bounce" | "ohne";
/**
 * Eigene Lead-Übersicht für die E-Mail-Akquise: je Kontakt eine Zeile mit Herkunft (Liste), Anlage-Datum,
 * Stufe und Vertriebler, den Kampagnen, in denen er steckt, und dem, was zuletzt passiert ist
 * (gesendet, geöffnet, geklickt, geantwortet, abgemeldet, Bounce). Mit Suche und Filtern wie auf der Leads-Seite.
 */
export async function emailLeads(db: Db, tenantId: number, options: { search?: string | null; listName?: string | null; campaignId?: number | null; activity?: EmailLeadActivity | null; stage?: string | null; ownerUserId?: number | "ohne" | null; limit?: number } = {}) {
  const limit = Math.min(1000, Math.max(10, options.limit ?? 200));
  const rows = await db.select({
    id: leads.id, publicId: leads.publicId, firstName: leads.firstName, lastName: leads.lastName, company: leads.company,
    email: leads.email, phone: leads.phone, city: leads.city, listName: leads.listName, stage: leads.pipelineStage, inPipeline: leads.inPipeline,
    createdAt: leads.createdAt, ownerUserId: leads.ownerUserId, ownerName: users.name, metadata: leads.metadata,
  }).from(leads).leftJoin(users, eq(users.id, leads.ownerUserId)).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb")));

  const recipients = await db.select({
    leadId: emailCampaignRecipients.leadId, email: emailCampaignRecipients.email, campaignId: emailCampaignRecipients.campaignId, campaignName: emailCampaigns.name,
    status: emailCampaignRecipients.status, sentCount: emailCampaignRecipients.sentCount, lastSentAt: emailCampaignRecipients.lastSentAt,
    openedAt: emailCampaignRecipients.openedAt, clickedAt: emailCampaignRecipients.clickedAt, repliedAt: emailCampaignRecipients.repliedAt, bouncedAt: emailCampaignRecipients.bouncedAt,
  }).from(emailCampaignRecipients).innerJoin(emailCampaigns, eq(emailCampaigns.id, emailCampaignRecipients.campaignId)).where(eq(emailCampaignRecipients.tenantId, tenantId));

  const byLead = new Map<string, typeof recipients>();
  for (const row of recipients) { const key = row.leadId ? `id:${row.leadId}` : `mail:${row.email.toLowerCase()}`; const list = byLead.get(key) ?? []; list.push(row); byLead.set(key, list); }

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

  // Nur Kontakte mit E-Mail-Adresse – ohne die gibt es in der E-Mail-Akquise nichts zu sehen.
  const items = rows.filter((lead) => Boolean(lead.email)).map((lead) => {
    const entries = byLead.get(`id:${lead.id}`) ?? (lead.email ? byLead.get(`mail:${lead.email.toLowerCase()}`) ?? [] : []);
    const { activity, at } = activityOf(entries);
    const campaigns = Array.from(new Map(entries.map((item) => [item.campaignId, { id: item.campaignId, name: item.campaignName }])).values());
    const { metadata, ...rest } = lead;
    return { ...rest, felder: extraFieldsOf(metadata), campaigns, activity, activityAt: at, mails: entries.reduce((sum, item) => sum + (item.sentCount ?? 0), 0) };
  });

  const search = (options.search ?? "").trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (options.listName && item.listName !== options.listName) return false;
    if (options.campaignId && !item.campaigns.some((campaign) => campaign.id === options.campaignId)) return false;
    if (options.activity && item.activity !== options.activity) return false;
    if (options.stage && item.stage !== options.stage) return false;
    if (options.ownerUserId === "ohne" && item.ownerUserId) return false;
    if (typeof options.ownerUserId === "number" && item.ownerUserId !== options.ownerUserId) return false;
    if (search && !`${item.firstName ?? ""} ${item.lastName ?? ""} ${item.company ?? ""} ${item.email ?? ""} ${item.phone ?? ""} ${item.city ?? ""} ${item.listName ?? ""}`.toLowerCase().includes(search)) return false;
    return true;
  });
  const counts = { alle: items.length } as Record<string, number>;
  for (const key of ["gesendet", "geoeffnet", "geklickt", "geantwortet", "abgemeldet", "bounce", "ohne"] as EmailLeadActivity[]) counts[key] = items.filter((item) => item.activity === key).length;
  const lists = Array.from(new Set(items.map((item) => item.listName).filter((name): name is string => Boolean(name)))).sort((a, b) => a.localeCompare(b, "de"));
  const campaigns = Array.from(new Map(items.flatMap((item) => item.campaigns).map((campaign) => [campaign.id, campaign] as const)).values()).sort((a, b) => a.name.localeCompare(b.name, "de"));
  // Oben steht, was gerade zählt: zuerst die mit Reaktion (stärkste zuerst), danach der Rest nach Anlage-Datum.
  const rang: Record<EmailLeadActivity, number> = { geantwortet: 6, geklickt: 5, geoeffnet: 4, gesendet: 3, bounce: 2, abgemeldet: 1, ohne: 0 };
  const sortiert = filtered.sort((a, b) => rang[b.activity] - rang[a.activity] || new Date(b.activityAt ?? b.createdAt).getTime() - new Date(a.activityAt ?? a.createdAt).getTime());
  return { items: sortiert.slice(0, limit), total: filtered.length, counts, lists, campaigns };
}

/**
 * Kontakte aus der E-Mail-Akquise in die Vertriebspipeline übernehmen – von Hand, nicht automatisch.
 * Sie erscheinen dort in der Eingangsstufe; die Zuteilung an Vertriebler läuft wie beim Listen-Upload
 * (reihum auf mehrere, alles an einen, oder gar nicht und später von Hand).
 */
export async function pushLeadsToPipeline(db: Db, tenantId: number, input: { leadIds: number[]; ownerUserIds?: number[] | null; actorUserId?: number | null }) {
  const ids = Array.from(new Set(input.leadIds)).slice(0, 2000);
  if (!ids.length) throw new Error("Bitte mindestens einen Kontakt auswählen.");
  const rows = await db.select({ id: leads.id, inPipeline: leads.inPipeline, stage: leads.pipelineStage }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), inArray(leads.id, ids)));
  const offen = rows.filter((row) => !row.inPipeline).map((row) => row.id);
  if (!offen.length) return { moved: 0, already: rows.length };
  await db.update(leads).set({ inPipeline: true, pipelineStage: "neu", pipelineUpdatedAt: new Date() }).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, offen)));
  for (const leadId of offen) await db.insert(pipelineEvents).values({ tenantId, leadId, fromStage: null, toStage: "neu", actorUserId: input.actorUserId ?? null, note: "Aus der E-Mail-Akquise in die Pipeline übernommen" });
  if (input.ownerUserIds?.length) await distributeOwners(db, tenantId, { leadIds: offen, userIds: input.ownerUserIds, actorUserId: input.actorUserId ?? null });
  else for (const leadId of offen) await autoAssign(db, tenantId, leadId);
  return { moved: offen.length, already: rows.length - offen.length };
}

/* ---------- Upload-Verlauf ---------- */
/** Alle Uploads des Mandanten, neueste zuerst: Liste, Quelle, Anzahl, wer und wann – und ob der Upload schon zurückgenommen wurde. */
export async function listImportHistory(db: Db, tenantId: number, limit = 50) {
  const rows = await db.select({
    id: listImports.id, listName: listImports.listName, source: listImports.source, rowCount: listImports.rowCount,
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
export async function undoListImport(db: Db, tenantId: number, importId: number) {
  const row = (await db.select().from(listImports).where(and(eq(listImports.tenantId, tenantId), eq(listImports.id, importId))).limit(1))[0];
  if (!row) throw new Error("Diesen Upload gibt es nicht mehr.");
  if (row.undoneAt) throw new Error("Dieser Upload wurde bereits zurückgenommen.");
  const ids = Array.isArray(row.leadIds) ? (row.leadIds as number[]) : [];
  const rows = ids.length ? await db.select({ id: leads.id, stage: leads.pipelineStage }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), inArray(leads.id, ids))) : [];
  const keep = rows.filter((item) => item.stage === "kunde").map((item) => item.id);
  const weg = rows.filter((item) => !keep.includes(item.id)).map((item) => item.id);
  if (weg.length) {
    await db.delete(pipelineTasks).where(and(eq(pipelineTasks.tenantId, tenantId), inArray(pipelineTasks.leadId, weg)));
    await db.delete(pipelineEvents).where(and(eq(pipelineEvents.tenantId, tenantId), inArray(pipelineEvents.leadId, weg)));
    await db.delete(pipelineNotes).where(and(eq(pipelineNotes.tenantId, tenantId), inArray(pipelineNotes.leadId, weg)));
    await db.delete(outboundMessages).where(and(eq(outboundMessages.tenantId, tenantId), inArray(outboundMessages.leadId, weg)));
    await db.delete(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), inArray(emailCampaignRecipients.leadId, weg)));
    await db.delete(dialerQueueItems).where(and(eq(dialerQueueItems.tenantId, tenantId), inArray(dialerQueueItems.leadId, weg)));
    await db.delete(leadStatusEvents).where(and(eq(leadStatusEvents.tenantId, tenantId), inArray(leadStatusEvents.leadId, weg)));
    await db.delete(leadTagAssignments).where(inArray(leadTagAssignments.leadId, weg));
    await db.update(inboxMessages).set({ leadId: null }).where(and(eq(inboxMessages.tenantId, tenantId), inArray(inboxMessages.leadId, weg)));
    await db.update(dialerCalls).set({ leadId: null }).where(and(eq(dialerCalls.tenantId, tenantId), inArray(dialerCalls.leadId, weg)));
    await db.delete(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, weg)));
  }
  await db.update(listImports).set({ undoneAt: new Date() }).where(eq(listImports.id, row.id));
  return { deleted: weg.length, keptCustomers: keep.length, listName: row.listName };
}
