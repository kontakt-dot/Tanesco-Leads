/**
 * Meta Lead Ads ohne Zapier: Verbindung per Facebook-Login (OAuth) oder eingefügtem Seiten-Token, Webhook für neue Leads
 * (Graph API „leadgen“), Formular-Zuordnung zu Lead-Kategorien, Kampagnen-Kennzahlen (Marketing API) und die Vertriebspipeline.
 *
 * Nötige Umgebungsvariablen für den Facebook-Login: META_APP_ID, META_APP_SECRET, APP_URL (Rückrufadresse APP_URL/api/meta/oauth/callback).
 * Webhook-Adresse (bei Meta eintragen): APP_URL/api/meta/webhook – Verify-Token steht in der Plattform.
 */
import { extraFieldsOf } from "../shared/cold-list";
import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import crypto from "node:crypto";
import { adInsights, emailCampaignRecipients, inboxMessages, leadCategories, leadStatusEvents, leadTagAssignments, leads, memberships, metaConnections, pipelineEvents, pipelineNotes, tags, teams, users, type MetaConnection, pipelineStageConfigs } from "../drizzle/schema";
import { buildStageSets, stagesOf, entryStage, funnel, isStage, mapMetaFieldData, normalizeStages, pipelineSourceOf, stageLabel, stagesForLead, summarizeCampaigns, wonStage, type PipelineSource, type PipelineStage, type StageDef, type StageSets } from "../shared/sales-pipeline";
import type { Db } from "./lead-pipeline";
import { triggerLeadAutomations } from "./lead-pipeline";
import { autoAssign, cardExtras, onStageChanged } from "./pipeline-extras";
import { pipelineValueSummary } from "../shared/pipeline-extras";
import { ownerSequence, type OwnerShare, type ShareMode } from "../shared/pipeline-extras";
import { logActivity } from "./activity";
import { requireVertriebCategoryId, vertriebCategoryId } from "./vertrieb-category";

const GRAPH = "https://graph.facebook.com/v21.0";
export const META_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_manage_ads", "leads_retrieval", "ads_read", "business_management"];
export type FormMapping = { formId: string; formName?: string; categoryId: number | null; supplierName?: string | null };

export async function ensureConnection(db: Db, tenantId: number): Promise<MetaConnection> {
  const existing = (await db.select().from(metaConnections).where(eq(metaConnections.tenantId, tenantId)).limit(1))[0];
  if (existing) return existing;
  await db.insert(metaConnections).values({ tenantId, verifyToken: `tanesco-${crypto.randomBytes(12).toString("hex")}`, status: "nicht_verbunden" });
  return (await db.select().from(metaConnections).where(eq(metaConnections.tenantId, tenantId)).limit(1))[0];
}
const mask = (token: string | null | undefined) => (token ? `${token.slice(0, 6)}…${token.slice(-4)}` : null);
export async function connectionStatus(db: Db, tenantId: number, appUrl: string) {
  const connection = await ensureConnection(db, tenantId);
  const mappings = (Array.isArray(connection.formMappings) ? connection.formMappings : []) as FormMapping[];
  return { status: connection.status, pageId: connection.pageId, pageName: connection.pageName, adAccountId: connection.adAccountId, adAccountName: connection.adAccountName, webhookSubscribed: connection.webhookSubscribed, tokenHint: mask(connection.pageAccessToken), tokenExpiresAt: connection.tokenExpiresAt, lastLeadAt: connection.lastLeadAt, lastSyncAt: connection.lastSyncAt, lastError: connection.lastError, verifyToken: connection.verifyToken, webhookUrl: `${appUrl.replace(/\/+$/, "")}/api/meta/webhook`, oauthReady: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET), formMappings: mappings };
}

/* ---------- Graph API ---------- */
async function graph<T>(path: string, token: string, params: Record<string, string> = {}, init: RequestInit = {}): Promise<T> {
  const url = new URL(`${GRAPH}/${path.replace(/^\//, "")}`); url.searchParams.set("access_token", token); for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, init); const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!response.ok || json.error) throw new Error(json.error?.message ?? `Meta antwortet mit ${response.status}`);
  return json;
}

/** Schritt 1 des Facebook-Logins: Adresse, auf die der Browser geschickt wird. */
export function oauthUrl(tenantId: number, appUrl: string) {
  const appId = process.env.META_APP_ID; if (!appId || !process.env.META_APP_SECRET) throw new Error("Facebook-Login ist nicht eingerichtet (META_APP_ID / META_APP_SECRET beim Hosting setzen). Alternativ Seiten-Token einfügen.");
  const state = Buffer.from(JSON.stringify({ tenantId, nonce: crypto.randomBytes(8).toString("hex") })).toString("base64url");
  const redirect = `${appUrl.replace(/\/+$/, "")}/api/meta/oauth/callback`;
  return { url: `https://www.facebook.com/v21.0/dialog/oauth?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirect)}&state=${state}&scope=${encodeURIComponent(META_SCOPES.join(","))}&response_type=code`, state };
}
/** Schritt 2: Code gegen Token tauschen, Seite + Werbekonto übernehmen, Webhook abonnieren. */
export async function completeOauth(db: Db, code: string, state: string, appUrl: string) {
  const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as { tenantId: number };
  const redirect = `${appUrl.replace(/\/+$/, "")}/api/meta/oauth/callback`;
  const short = await fetch(`${GRAPH}/oauth/access_token?client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&redirect_uri=${encodeURIComponent(redirect)}&code=${encodeURIComponent(code)}`).then((r) => r.json()) as { access_token?: string; error?: { message?: string } };
  if (!short.access_token) throw new Error(short.error?.message ?? "Facebook hat keinen Zugang ausgestellt.");
  const long = await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&fb_exchange_token=${short.access_token}`).then((r) => r.json()) as { access_token?: string; expires_in?: number };
  const userToken = long.access_token ?? short.access_token; const expiresAt = long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null;
  return connectWithUserToken(db, parsed.tenantId, userToken, expiresAt);
}
/** Mit einem Nutzer-Token: erste Seite und erstes Werbekonto übernehmen (weitere wählbar), Webhook abonnieren. */
export async function connectWithUserToken(db: Db, tenantId: number, userToken: string, expiresAt: Date | null, choice: { pageId?: string; adAccountId?: string } = {}) {
  const connection = await ensureConnection(db, tenantId);
  try {
    const pages = await graph<{ data: Array<{ id: string; name: string; access_token: string }> }>("me/accounts", userToken, { fields: "id,name,access_token", limit: "50" });
    if (!pages.data?.length) throw new Error("Dieser Facebook-Zugang verwaltet keine Seite.");
    const page = pages.data.find((item) => item.id === choice.pageId) ?? pages.data[0];
    const accounts = await graph<{ data: Array<{ id: string; name: string; account_id: string }> }>("me/adaccounts", userToken, { fields: "id,name,account_id", limit: "50" }).catch(() => ({ data: [] as Array<{ id: string; name: string; account_id: string }> }));
    const account = accounts.data.find((item) => item.id === choice.adAccountId || item.account_id === choice.adAccountId) ?? accounts.data[0];
    let subscribed = false; try { await graph(`${page.id}/subscribed_apps`, page.access_token, { subscribed_fields: "leadgen" }, { method: "POST" }); subscribed = true; } catch { subscribed = false; }
    await db.update(metaConnections).set({ pageId: page.id, pageName: page.name, pageAccessToken: page.access_token, userAccessToken: userToken, tokenExpiresAt: expiresAt, adAccountId: account?.id ?? null, adAccountName: account?.name ?? null, webhookSubscribed: subscribed, status: "verbunden", lastError: null }).where(eq(metaConnections.id, connection.id));
    const forms = await listForms(db, tenantId).catch(() => []);
    return { pageName: page.name, adAccountName: account?.name ?? null, webhookSubscribed: subscribed, forms, pages: pages.data.map((item) => ({ id: item.id, name: item.name })), adAccounts: accounts.data.map((item) => ({ id: item.id, name: item.name })) };
  } catch (error) { const message = error instanceof Error ? error.message : "Verbindung fehlgeschlagen"; await db.update(metaConnections).set({ status: "fehler", lastError: message }).where(eq(metaConnections.id, connection.id)); throw new Error(message); }
}
/** Ohne Facebook-Login: Seiten-ID + Seiten-Token (aus dem Meta Business Manager) einfügen. */
export async function connectWithPageToken(db: Db, tenantId: number, input: { pageId: string; pageAccessToken: string; adAccountId?: string | null }) {
  const connection = await ensureConnection(db, tenantId);
  try {
    const page = await graph<{ id: string; name: string }>(input.pageId.trim(), input.pageAccessToken.trim(), { fields: "id,name" });
    let subscribed = false; try { await graph(`${page.id}/subscribed_apps`, input.pageAccessToken.trim(), { subscribed_fields: "leadgen" }, { method: "POST" }); subscribed = true; } catch { subscribed = false; }
    let adAccountName: string | null = null; if (input.adAccountId?.trim()) { const id = input.adAccountId.trim().startsWith("act_") ? input.adAccountId.trim() : `act_${input.adAccountId.trim()}`; adAccountName = (await graph<{ name?: string }>(id, input.pageAccessToken.trim(), { fields: "name" }).catch(() => ({ name: null }))).name ?? null; }
    await db.update(metaConnections).set({ pageId: page.id, pageName: page.name, pageAccessToken: input.pageAccessToken.trim(), adAccountId: input.adAccountId?.trim() ? (input.adAccountId.trim().startsWith("act_") ? input.adAccountId.trim() : `act_${input.adAccountId.trim()}`) : null, adAccountName, webhookSubscribed: subscribed, status: "verbunden", lastError: null }).where(eq(metaConnections.id, connection.id));
    return { pageName: page.name, webhookSubscribed: subscribed, forms: await listForms(db, tenantId).catch(() => []) };
  } catch (error) { const message = error instanceof Error ? error.message : "Verbindung fehlgeschlagen"; await db.update(metaConnections).set({ status: "fehler", lastError: message }).where(eq(metaConnections.id, connection.id)); throw new Error(message); }
}
export async function disconnect(db: Db, tenantId: number) { const connection = await ensureConnection(db, tenantId); await db.update(metaConnections).set({ pageId: null, pageName: null, pageAccessToken: null, userAccessToken: null, tokenExpiresAt: null, adAccountId: null, adAccountName: null, webhookSubscribed: false, status: "nicht_verbunden", lastError: null }).where(eq(metaConnections.id, connection.id)); return { success: true as const }; }

export async function listForms(db: Db, tenantId: number) {
  const connection = await ensureConnection(db, tenantId); if (!connection.pageId || !connection.pageAccessToken) return [];
  const result = await graph<{ data: Array<{ id: string; name: string; status?: string; leads_count?: number }> }>(`${connection.pageId}/leadgen_forms`, connection.pageAccessToken, { fields: "id,name,status,leads_count", limit: "100" });
  const mappings = (Array.isArray(connection.formMappings) ? connection.formMappings : []) as FormMapping[];
  return result.data.map((form) => ({ id: form.id, name: form.name, status: form.status ?? null, leadsCount: form.leads_count ?? null, categoryId: mappings.find((item) => item.formId === form.id)?.categoryId ?? null }));
}
export async function saveFormMappings(db: Db, tenantId: number, mappings: FormMapping[]) { const connection = await ensureConnection(db, tenantId); await db.update(metaConnections).set({ formMappings: mappings }).where(eq(metaConnections.id, connection.id)); return { success: true as const }; }

/* ---------- Webhook: neuer Lead ---------- */
export function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  const secret = process.env.META_APP_SECRET; if (!secret) return true; // ohne App-Secret keine Prüfung möglich (Token-Modus)
  if (!signature?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(signature.slice(7)), Buffer.from(expected)); } catch { return false; }
}
export type LeadgenChange = { leadgen_id: string; page_id: string; form_id?: string; ad_id?: string; adgroup_id?: string; campaign_id?: string; created_time?: number };
/** Lead abholen und als Lead anlegen (Dublette per leadgen_id); Kampagne/Anzeigengruppe/Anzeige nachladen. */
export async function importLeadgen(db: Db, change: LeadgenChange, options: { rawPayload?: unknown } = {}) {
  const connection = (await db.select().from(metaConnections).where(eq(metaConnections.pageId, change.page_id)).limit(1))[0];
  if (!connection?.pageAccessToken) return { ok: false as const, reason: "Seite nicht verbunden" };
  const tenantId = connection.tenantId;
  const twin = (await db.select({ id: leads.id, publicId: leads.publicId }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.leadgenId, change.leadgen_id))).limit(1))[0];
  if (twin) return { ok: true as const, duplicate: true, leadId: twin.id, publicId: twin.publicId };
  const lead = await graph<{ id: string; created_time?: string; field_data: Array<{ name: string; values: unknown[] }>; ad_id?: string; ad_name?: string; adset_id?: string; adset_name?: string; campaign_id?: string; campaign_name?: string; form_id?: string; platform?: string; is_organic?: boolean }>(change.leadgen_id, connection.pageAccessToken, { fields: "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic" });
  const mapped = mapMetaFieldData(lead.field_data ?? []);
  const mappings = (Array.isArray(connection.formMappings) ? connection.formMappings : []) as FormMapping[];
  const mapping = mappings.find((item) => item.formId === (lead.form_id ?? change.form_id));
  const categoryId = await vertriebCategoryId(db, tenantId, mapping?.categoryId); // ohne Zuordnung: „Photovoltaik & Wärmepumpe“ (Vertriebspipeline), sonst die erste aktive Kategorie
  if (!categoryId) return { ok: false as const, reason: "Keine Lead-Kategorie vorhanden" };
  let formName: string | null = mapping?.formName ?? null; if (!formName && (lead.form_id ?? change.form_id)) formName = (await graph<{ name?: string }>(lead.form_id ?? change.form_id!, connection.pageAccessToken, { fields: "name" }).catch(() => ({ name: null }))).name ?? null;
  const publicId = `META-${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  const inserted = await db.insert(leads).values({ tenantId, publicId, categoryId, kind: "vertrieb", firstName: mapped.firstName, lastName: mapped.lastName, email: mapped.email, phone: mapped.phone, postcode: mapped.postcode, city: mapped.city, country: "DE", supplierName: mapping?.supplierName ?? "Meta Ads", metadata: { ...mapped.answers, street: mapped.street, meta: { leadgenId: lead.id, formId: lead.form_id ?? change.form_id ?? null, campaignId: lead.campaign_id ?? change.campaign_id ?? null, adsetId: lead.adset_id ?? change.adgroup_id ?? null, adId: lead.ad_id ?? change.ad_id ?? null, platform: lead.platform ?? null, organic: Boolean(lead.is_organic), createdTime: lead.created_time ?? null } }, status: "neu", cost: "0.00", pipelineStage: "neu", pipelineUpdatedAt: new Date(), adCampaignId: lead.campaign_id ?? change.campaign_id ?? null, adCampaignName: lead.campaign_name ?? null, adsetName: lead.adset_name ?? null, adName: lead.ad_name ?? null, adFormName: formName, adPlatform: lead.platform ?? "facebook", leadgenId: lead.id });
  const leadId = Number(inserted[0]?.insertId) || 0;
  await db.insert(leadStatusEvents).values({ tenantId, leadId, previousStatus: null, nextStatus: "neu", actorUserId: null, note: `Meta Lead Ads: ${lead.campaign_name ?? "Kampagne"} › ${lead.adset_name ?? "Anzeigengruppe"} › ${lead.ad_name ?? "Anzeige"}${formName ? ` · Formular ${formName}` : ""}` });
  await db.insert(pipelineEvents).values({ tenantId, leadId, fromStage: null, toStage: "neu", actorUserId: null, note: "Aus Meta-Kampagne eingegangen" });
  await logActivity(db, tenantId, { kind: "lead_neu", title: `Neuer Lead aus Meta Ads: ${[mapped.firstName, mapped.lastName].filter(Boolean).join(" ") || publicId}`, detail: `${lead.campaign_name ?? "Kampagne"}${mapped.city ? ` · ${mapped.city}` : ""}`, leadId, refType: "lead", refId: leadId });
  await db.update(metaConnections).set({ lastLeadAt: new Date() }).where(eq(metaConnections.id, connection.id));
  try { await triggerLeadAutomations(db, { tenantId, actorUserId: null, leadId, triggerType: "lead_erstellt" }); } catch { /* Automatik optional */ }
  await autoAssign(db, tenantId, leadId); // Verteilregeln (Region/Kategorie/Auslastung), wenn eingeschaltet
  return { ok: true as const, duplicate: false, leadId, publicId };
}

/* ---------- Kampagnen-Kennzahlen ---------- */
export async function syncInsights(db: Db, tenantId: number, options: { days?: number } = {}) {
  const connection = await ensureConnection(db, tenantId);
  const token = connection.userAccessToken ?? connection.pageAccessToken; if (!connection.adAccountId || !token) throw new Error("Kein Werbekonto verbunden.");
  const days = options.days ?? 30; const until = new Date(); const since = new Date(until.getTime() - (days - 1) * 86_400_000);
  const toDay = (date: Date) => date.toISOString().slice(0, 10);
  const result = await graph<{ data: Array<{ date_start: string; campaign_id: string; campaign_name: string; adset_id: string; adset_name: string; ad_id: string; ad_name: string; spend: string; impressions: string; clicks: string; actions?: Array<{ action_type: string; value: string }> }> }>(`${connection.adAccountId}/insights`, token, { level: "ad", time_increment: "1", fields: "date_start,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,actions", time_range: JSON.stringify({ since: toDay(since), until: toDay(until) }), limit: "500" });
  let rows = 0;
  for (const item of result.data ?? []) {
    const results = Number(item.actions?.find((action) => action.action_type === "lead" || action.action_type === "onsite_conversion.lead_grouped")?.value ?? 0);
    await db.delete(adInsights).where(and(eq(adInsights.tenantId, tenantId), eq(adInsights.day, item.date_start), eq(adInsights.campaignId, item.campaign_id), eq(adInsights.adsetId, item.adset_id), eq(adInsights.adId, item.ad_id)));
    await db.insert(adInsights).values({ tenantId, day: item.date_start, campaignId: item.campaign_id, campaignName: item.campaign_name, adsetId: item.adset_id, adsetName: item.adset_name, adId: item.ad_id, adName: item.ad_name, spend: Number(item.spend ?? 0).toFixed(2), impressions: Number(item.impressions ?? 0), clicks: Number(item.clicks ?? 0), results });
    rows += 1;
  }
  await db.update(metaConnections).set({ lastSyncAt: new Date(), lastError: null }).where(eq(metaConnections.id, connection.id));
  return { rows, since: toDay(since), until: toDay(until) };
}

/* ---------- Pipeline ---------- */
export type PipelineOverviewOptions = { from?: Date; until?: Date; campaignId?: string | null; source?: PipelineSource | "alle"; ownerUserId?: number | "ohne" | null; tagId?: number | null; listName?: string | null; categoryId?: number | null; limitPerStage?: number };
export async function pipelineOverview(db: Db, tenantId: number, options: PipelineOverviewOptions = {}) {
  // Pipeline „E-Mail-Kampagne“: Spalte „Versendet“ einmal anlegen, falls es sie noch nicht gibt (neue Kontakte kommen beim Versand automatisch dorthin)
  if (options.source === "email") { const { ensureSentStageOnce, backfillSentCardsOnce } = await import("./sent-card"); await ensureSentStageOnce(db, tenantId); void backfillSentCardsOnce(db, tenantId); }
  const conditions = [eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb")]; if (options.from) conditions.push(gte(leads.createdAt, options.from)); if (options.until) conditions.push(lte(leads.createdAt, options.until));
  const rows = await db.select({ id: leads.id, publicId: leads.publicId, inPipeline: leads.inPipeline, firstName: leads.firstName, lastName: leads.lastName, createdAt: leads.createdAt, pipelineStage: leads.pipelineStage, pipelineUpdatedAt: leads.pipelineUpdatedAt, adCampaignId: leads.adCampaignId, adCampaignName: leads.adCampaignName, adsetName: leads.adsetName, adName: leads.adName, adFormName: leads.adFormName, adPlatform: leads.adPlatform, categoryId: leads.categoryId, categoryName: leadCategories.name, categoryColor: leadCategories.color, categoryEmoji: leadCategories.emoji, categoryShortcode: leadCategories.shortcode, city: leads.city, postcode: leads.postcode, phone: leads.phone, email: leads.email, status: leads.status, ownerUserId: leads.ownerUserId, ownerName: users.name, company: leads.company, listName: leads.listName, followUpAt: leads.followUpAt, appointmentAt: leads.appointmentAt, dealValue: leads.dealValue, metadata: leads.metadata }).from(leads).leftJoin(leadCategories, eq(leadCategories.id, leads.categoryId)).leftJoin(users, eq(users.id, leads.ownerUserId)).where(and(...conditions)).orderBy(desc(leads.createdAt));
  const source = options.source ?? "alle";
  // Kontakte, die nur in der E-Mail-Akquise stecken (inPipeline = false), gehören noch nicht aufs Board.
  const pipelineLeads = rows.filter((row) => (row as { inPipeline?: boolean }).inPipeline !== false).filter((row) => row.adCampaignId || row.adPlatform || row.pipelineStage).filter((row) => source === "alle" ? true : pipelineSourceOf(row.adPlatform) === source).map((row) => ({ ...row, name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || row.publicId }));
  // Smarte Listen (E-Mail-Kampagne): „Interesse“ = Antwort im Posteingang, die die KI als interessiert einstuft; „Geöffnet“ = Kampagnen-Mail geöffnet/geklickt/beantwortet
  const leadIdsAll = pipelineLeads.map((lead) => lead.id);
  const interestIds = new Set<number>(); const openedIds = new Set<number>(); const clickedIds = new Set<number>();
  if (leadIdsAll.length) {
    for (const row of await db.select({ leadId: inboxMessages.leadId, recipientId: inboxMessages.campaignRecipientId }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.aiKind, "interessiert"), eq(inboxMessages.blocked, false)))) if (row.leadId) interestIds.add(row.leadId);
    const recipientRows = await db.select({ id: emailCampaignRecipients.id, leadId: emailCampaignRecipients.leadId, openedAt: emailCampaignRecipients.openedAt, clickedAt: emailCampaignRecipients.clickedAt, repliedAt: emailCampaignRecipients.repliedAt }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), isNotNull(emailCampaignRecipients.leadId)));
    const recipientLead = new Map(recipientRows.map((row) => [row.id, row.leadId]));
    for (const row of await db.select({ recipientId: inboxMessages.campaignRecipientId }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.aiKind, "interessiert"), isNotNull(inboxMessages.campaignRecipientId)))) { const leadId = row.recipientId ? recipientLead.get(row.recipientId) : null; if (leadId) interestIds.add(leadId); }
    for (const row of recipientRows) if (row.leadId && (row.openedAt || row.clickedAt || row.repliedAt)) openedIds.add(row.leadId);
    for (const row of recipientRows) if (row.leadId && row.clickedAt) clickedIds.add(row.leadId); // „Webseite geklickt“: Link in einer Kampagnen-E-Mail angeklickt
  }
  const smartLists = { interesse: pipelineLeads.filter((lead) => interestIds.has(lead.id)).length, geoeffnet: pipelineLeads.filter((lead) => openedIds.has(lead.id)).length, geklickt: pipelineLeads.filter((lead) => clickedIds.has(lead.id)).length };
  const byCampaign = options.campaignId === "__interesse" ? pipelineLeads.filter((lead) => interestIds.has(lead.id)) : options.campaignId === "__geoeffnet" ? pipelineLeads.filter((lead) => openedIds.has(lead.id)) : options.campaignId === "__geklickt" ? pipelineLeads.filter((lead) => clickedIds.has(lead.id)) : options.campaignId ? pipelineLeads.filter((lead) => (lead.adCampaignId ?? "ohne-kampagne") === options.campaignId) : pipelineLeads;
  const byOwner = options.ownerUserId === "ohne" ? byCampaign.filter((lead) => !lead.ownerUserId) : options.ownerUserId ? byCampaign.filter((lead) => lead.ownerUserId === options.ownerUserId) : byCampaign;
  // Liste (Upload) als Auswahl: alle Listen im aktuellen Ausschnitt mit Anzahl – die gewählte bleibt sichtbar
  const listCounts = new Map<string, number>(); for (const lead of byOwner) if (lead.listName) listCounts.set(lead.listName, (listCounts.get(lead.listName) ?? 0) + 1);
  if (options.listName && !listCounts.has(options.listName)) listCounts.set(options.listName, 0);
  const lists = Array.from(listCounts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, "de"));
  const scopedByOwner = options.listName ? byOwner.filter((lead) => lead.listName === options.listName) : byOwner;
  // Tags der Karten: Chips zum Filtern (z. B. „PV“, „Hessen“) – die Liste zeigt alle Tags im aktuellen Ausschnitt mit Anzahl.
  const tagRows = await db.select({ leadId: leadTagAssignments.leadId, id: tags.id, name: tags.name, color: tags.color }).from(leadTagAssignments).innerJoin(tags, eq(tags.id, leadTagAssignments.tagId)).where(eq(tags.tenantId, tenantId));
  const tagsByLead = new Map<number, Array<{ id: number; name: string; color: string | null }>>();
  for (const row of tagRows) { const list = tagsByLead.get(row.leadId) ?? []; list.push({ id: row.id, name: row.name, color: row.color }); tagsByLead.set(row.leadId, list); }
  const tagCounts = new Map<number, { id: number; name: string; color: string | null; count: number }>();
  for (const lead of scopedByOwner) for (const tag of tagsByLead.get(lead.id) ?? []) { const entry = tagCounts.get(tag.id) ?? { ...tag, count: 0 }; entry.count += 1; tagCounts.set(tag.id, entry); }
  const tagList = Array.from(tagCounts.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"));
  const scopedByTag = options.tagId ? scopedByOwner.filter((lead) => (tagsByLead.get(lead.id) ?? []).some((tag) => tag.id === options.tagId)) : scopedByOwner;
  // Lead-Kategorien im aktuellen Ausschnitt (alle Karten, nicht nur die ersten je Spalte) – als Auswahl zum Filtern; die gewählte bleibt sichtbar, auch wenn gerade keine Karte dazu da ist
  const categoryCounts = new Map<number, { id: number; name: string; emoji: string | null; color: string | null; count: number }>();
  for (const lead of scopedByTag) { if (lead.categoryId == null) continue; const entry = categoryCounts.get(lead.categoryId) ?? { id: lead.categoryId, name: lead.categoryName ?? "Ohne Namen", emoji: lead.categoryEmoji ?? null, color: lead.categoryColor ?? null, count: 0 }; entry.count += 1; categoryCounts.set(lead.categoryId, entry); }
  if (options.categoryId && !categoryCounts.has(options.categoryId)) { const row = (await db.select({ id: leadCategories.id, name: leadCategories.name, emoji: leadCategories.emoji, color: leadCategories.color }).from(leadCategories).where(and(eq(leadCategories.id, options.categoryId), eq(leadCategories.tenantId, tenantId))).limit(1))[0]; if (row) categoryCounts.set(row.id, { ...row, count: 0 }); }
  const categories = Array.from(categoryCounts.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"));
  const scoped = options.categoryId ? scopedByTag.filter((lead) => lead.categoryId === options.categoryId) : scopedByTag;
  const insightConditions = [eq(adInsights.tenantId, tenantId)]; if (options.from) insightConditions.push(gte(adInsights.day, options.from.toISOString().slice(0, 10))); if (options.until) insightConditions.push(lte(adInsights.day, options.until.toISOString().slice(0, 10)));
  const insights = await db.select().from(adInsights).where(and(...insightConditions));
  const stagesDef = await pipelineStages(db, tenantId, source === "alle" ? "alle" : source); // Stufen der gewählten Pipeline
  const campaigns = summarizeCampaigns(pipelineLeads, source === "ads" || source === "alle" ? insights : [], stagesDef);
  const notes = await noteCounts(db, tenantId, scoped.map((lead) => lead.id));
  const { extras, settings } = await cardExtras(db, tenantId, scoped.map((lead) => ({ ...lead, noteCount: notes.get(lead.id)?.count ?? 0 })), stagesDef);
  const limit = options.limitPerStage ?? 60;
  // je Spalte: wie viele Karten es insgesamt sind (gezeigt werden höchstens „limit“ – „Weitere anzeigen“ lädt mehr)
  const stageOfLead = (lead: { pipelineStage: string | null }) => (isStage(lead.pipelineStage, stagesDef) ? lead.pipelineStage : entryStage(stagesDef));
  const stageTotals = new Map<string, number>(); for (const lead of scoped) { const key = stageOfLead(lead); stageTotals.set(key, (stageTotals.get(key) ?? 0) + 1); }
  const stages = stagesDef.map((stage) => ({ ...stage, total: stageTotals.get(stage.key) ?? 0, leads: scoped.filter((lead) => stageOfLead(lead) === stage.key).slice(0, limit).map((lead) => { const { metadata, ...rest } = lead; const extra = extras.get(lead.id); const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as { lastCallDisposition?: string; salutation?: string }) : {}; return { ...rest, dealValue: lead.dealValue === null ? null : Number(lead.dealValue), noteCount: notes.get(lead.id)?.count ?? 0, latestNote: notes.get(lead.id)?.latest ?? null, lastCallDisposition: meta.lastCallDisposition ?? null, salutation: meta.salutation ?? null, fields: extraFieldsOf(metadata), openTasks: extra?.openTasks ?? 0, nextTask: extra?.nextTask ?? null, lastActivityAt: extra?.lastActivityAt ?? lead.pipelineUpdatedAt ?? lead.createdAt, staleDays: extra?.staleDays ?? 0, stale: extra?.stale ?? false, score: extra?.score ?? 0, temperature: extra?.temperature ?? "kalt", scoreLabel: extra?.scoreLabel ?? "Kalt", scoreReasons: extra?.scoreReasons ?? [], calls: extra?.calls ?? { count: 0, reached: 0, lastAt: null, lastResult: null, lastBy: null }, blocked: extra?.blocked ?? false }; }) }));
  const totals = { leads: scoped.length, customers: scoped.filter((lead) => lead.pipelineStage === wonStage(stagesDef)).length, spend: (options.campaignId ? campaigns.filter((c) => c.campaignId === options.campaignId) : campaigns).reduce((sum, c) => sum + c.spend, 0) };
  const value = pipelineValueSummary(scoped.map((lead) => ({ pipelineStage: isStage(lead.pipelineStage, stagesDef) ? lead.pipelineStage : entryStage(stagesDef), dealValue: lead.dealValue, ownerUserId: lead.ownerUserId, ownerName: lead.ownerName })), stagesDef);
  const staleCount = Array.from(extras.values()).filter((extra) => extra.stale).length; const hotCount = scoped.filter((lead) => { const extra = extras.get(lead.id); return extra?.temperature === "heiss" && lead.pipelineStage !== wonStage(stagesDef); }).length; const dueToday = scoped.filter((lead) => lead.followUpAt && lead.followUpAt < new Date(new Date().setHours(24, 0, 0, 0))).length;
  return { campaigns, smartLists, lists, categories, stages, stageDefs: stagesDef, tags: tagList, funnel: funnel(scoped, stagesDef), totals: { ...totals, costPerLead: totals.leads ? totals.spend / totals.leads : null, costPerCustomer: totals.customers ? totals.spend / totals.customers : null }, value, staleCount, hotCount, staleDays: settings.staleDays, dueToday };
}
export async function moveStage(db: Db, tenantId: number, input: { publicId: string; stage: PipelineStage; note?: string | null; actorUserId: number | null }) {
  const lead = (await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.publicId, input.publicId))).limit(1))[0]; if (!lead) throw new Error("Lead nicht gefunden.");
  const stagesDef = stagesForLead(await pipelineStageSets(db, tenantId), lead); if (!isStage(input.stage, stagesDef)) throw new Error("Unbekannte Stufe.");
  const from = isStage(lead.pipelineStage, stagesDef) ? lead.pipelineStage : entryStage(stagesDef);
  await db.update(leads).set({ pipelineStage: input.stage, pipelineUpdatedAt: new Date() }).where(eq(leads.id, lead.id));
  await db.insert(pipelineEvents).values({ tenantId, leadId: lead.id, fromStage: from, toStage: input.stage, actorUserId: input.actorUserId, note: input.note?.trim() || null });
  if (from !== input.stage) await logActivity(db, tenantId, { kind: "pipeline_stufe", title: `${[lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.company || lead.publicId}: ${stagesDef.find((item) => item.key === from)?.label ?? from} → ${stagesDef.find((item) => item.key === input.stage)?.label ?? input.stage}`, detail: input.note?.trim().slice(0, 200) || null, leadId: lead.id, actorUserId: input.actorUserId, refType: "lead", refId: lead.id });
  if (input.stage === wonStage(stagesDef)) await db.insert(leadStatusEvents).values({ tenantId, leadId: lead.id, previousStatus: lead.status, nextStatus: lead.status, actorUserId: input.actorUserId, note: "Vertriebspipeline: Lead ist Kunde geworden" });
  let series: string | null = null; if (from !== input.stage) { const result = await onStageChanged(db, tenantId, { leadId: lead.id, toStage: input.stage }).catch(() => null); if (result?.enrolled) series = result.campaignName ?? null; }
  return { success: true as const, from, to: input.stage, series };
}
export async function pipelineHistory(db: Db, tenantId: number, publicId: string) {
  const lead = (await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.publicId, publicId))).limit(1))[0]; if (!lead) return [];
  const rows = await db.select({ event: pipelineEvents, actor: users.name }).from(pipelineEvents).leftJoin(users, eq(users.id, pipelineEvents.actorUserId)).where(and(eq(pipelineEvents.tenantId, tenantId), eq(pipelineEvents.leadId, lead.id))).orderBy(desc(pipelineEvents.createdAt), desc(pipelineEvents.id));
  return rows.map(({ event, actor }) => ({ id: event.id, fromStage: event.fromStage, toStage: event.toStage, note: event.note, actor: actor ?? "Automatisch", createdAt: event.createdAt }));
}
/** Testlead ohne Facebook (Demo/Abnahme): verhält sich wie ein Webhook-Lead. */
export async function createTestLead(db: Db, tenantId: number, input: { campaignName: string; adsetName?: string | null; adName?: string | null; formName?: string | null; categoryId?: number | null; firstName: string; lastName: string; email?: string | null; phone?: string | null; postcode?: string | null; city?: string | null }) {
  const categoryId = await requireVertriebCategoryId(db, tenantId, input.categoryId);
  const publicId = `META-${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`; const campaignId = `test-${input.campaignName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const inserted = await db.insert(leads).values({ tenantId, publicId, categoryId, kind: "vertrieb", firstName: input.firstName, lastName: input.lastName, email: input.email ?? undefined, phone: input.phone ?? undefined, postcode: input.postcode ?? undefined, city: input.city ?? undefined, country: "DE", supplierName: "Meta Ads", metadata: { meta: { test: true, campaignId } }, status: "neu", cost: "0.00", pipelineStage: "neu", pipelineUpdatedAt: new Date(), adCampaignId: campaignId, adCampaignName: input.campaignName, adsetName: input.adsetName ?? null, adName: input.adName ?? null, adFormName: input.formName ?? null, adPlatform: "facebook", leadgenId: `test-${crypto.randomUUID().slice(0, 12)}` });
  const leadId = Number(inserted[0]?.insertId) || 0;
  await db.insert(leadStatusEvents).values({ tenantId, leadId, previousStatus: null, nextStatus: "neu", actorUserId: null, note: `Meta Lead Ads (Test): ${input.campaignName}` });
  await db.insert(pipelineEvents).values({ tenantId, leadId, fromStage: null, toStage: "neu", actorUserId: null, note: "Testlead aus Meta-Kampagne" });
  await logActivity(db, tenantId, { kind: "lead_neu", title: `Testlead angelegt: ${input.firstName} ${input.lastName}`, detail: input.campaignName, leadId, refType: "lead", refId: leadId });
  try { await triggerLeadAutomations(db, { tenantId, actorUserId: null, leadId, triggerType: "lead_erstellt" }); } catch { /* optional */ }
  await autoAssign(db, tenantId, leadId);
  return { leadId, publicId };
}
export async function leadsByCampaignIds(db: Db, tenantId: number, campaignIds: string[]) { if (!campaignIds.length) return []; return db.select({ id: leads.id, adCampaignId: leads.adCampaignId }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), inArray(leads.adCampaignId, campaignIds))); }

/** Vertriebler, denen Leads gehören können: interne Mitglieder (Admin/Team) des Mandanten. */
export async function pipelineOwners(db: Db, tenantId: number) {
  const rows = await db.select({ userId: users.id, name: users.name, email: users.email, partnerType: memberships.partnerType, role: memberships.role, team: teams.name }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).leftJoin(teams, eq(teams.id, memberships.teamId)).where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "aktiv")));
  const internal = rows.filter((row) => row.partnerType === "intern"); const sales = internal.filter((row) => row.role === "vertrieb" || /vertrieb|sales/i.test(row.team ?? ""));
  return (sales.length ? sales : internal).map((row) => { const first = (row.name ?? row.email ?? `Benutzer ${row.userId}`).split(/\s+/)[0]; return { userId: row.userId, name: first, initials: first.slice(0, 2).toUpperCase() }; });
}
export async function assignOwner(db: Db, tenantId: number, input: { publicIds: string[]; ownerUserId: number | null; actorUserId: number | null }) {
  const rows = await db.select({ id: leads.id, publicId: leads.publicId, ownerUserId: leads.ownerUserId }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), inArray(leads.publicId, input.publicIds)));
  const owner = input.ownerUserId ? (await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, input.ownerUserId)).limit(1))[0] : null;
  for (const row of rows) { await db.update(leads).set({ ownerUserId: input.ownerUserId }).where(eq(leads.id, row.id)); await db.insert(pipelineEvents).values({ tenantId, leadId: row.id, fromStage: null, toStage: "besitzer", actorUserId: input.actorUserId, note: owner ? `Zugeteilt an ${owner.name ?? "Vertriebler"}` : "Zuteilung entfernt" }); }
  return { updated: rows.length, ownerName: owner?.name ?? null };
}
/** Verteilt Leads reihum (z. B. 50/50) auf die angegebenen Vertriebler. */
export async function distributeOwners(db: Db, tenantId: number, input: { leadIds: number[]; userIds: number[]; actorUserId: number | null; shares?: OwnerShare[] | null; mode?: ShareMode | null }) {
  if (!input.leadIds.length) return { updated: 0 };
  // Gewichtet (Prozent/Anzahl aus dem Listen-Upload) oder gleichmäßig reihum
  const sequence = input.shares?.length ? ownerSequence(input.leadIds.length, input.shares, input.mode ?? "prozent") : null;
  const userIds = sequence ? Array.from(new Set(sequence.filter((id): id is number => id !== null))) : input.userIds;
  if (!userIds.length) return { updated: 0 };
  const owners = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds));
  let index = 0; let updated = 0;
  for (const leadId of input.leadIds) { const wanted = sequence ? sequence[index] : owners[index % owners.length]?.id ?? null; index += 1; const owner = wanted === null ? null : owners.find((row) => row.id === wanted) ?? null; if (!owner) continue; updated += 1; await db.update(leads).set({ ownerUserId: owner.id }).where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId))); await db.insert(pipelineEvents).values({ tenantId, leadId, fromStage: null, toStage: "besitzer", actorUserId: input.actorUserId, note: `Zugeteilt an ${owner.name ?? "Vertriebler"} (Verteilung)` }); }
  return { updated };
}

/* ---------- Notizen an Karten ---------- */
export async function listNotes(db: Db, tenantId: number, publicId: string) {
  const lead = (await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.publicId, publicId))).limit(1))[0]; if (!lead) return []; // Notizen gibt es an Pipeline-Karten und an Leads zum Verkauf (Gesprächsnotizen aus dem Callcenter)
  const rows = await db.select({ note: pipelineNotes, author: users.name }).from(pipelineNotes).leftJoin(users, eq(users.id, pipelineNotes.authorUserId)).where(and(eq(pipelineNotes.tenantId, tenantId), eq(pipelineNotes.leadId, lead.id))).orderBy(desc(pipelineNotes.createdAt), desc(pipelineNotes.id));
  return rows.map(({ note, author }) => ({ id: note.id, text: note.text, source: note.source, author: author?.split(" ")[0] ?? "–", createdAt: note.createdAt }));
}
export async function addNote(db: Db, tenantId: number, input: { publicId: string; text: string; source: "text" | "sprache"; authorUserId: number | null }) {
  const lead = (await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.publicId, input.publicId))).limit(1))[0]; if (!lead) throw new Error("Lead nicht gefunden."); // Notizen gibt es an Pipeline-Karten und an Leads zum Verkauf (Gesprächsnotizen aus dem Callcenter)
  const text = input.text.trim(); if (!text) throw new Error("Die Notiz ist leer.");
  const inserted = await db.insert(pipelineNotes).values({ tenantId, leadId: lead.id, authorUserId: input.authorUserId, text: text.slice(0, 4000), source: input.source });
  return { id: Number(inserted[0]?.insertId) || 0 };
}
/** Notiz nachträglich ändern (Tippfehler, Ergänzung) – nur der Text, Zeitpunkt und Autor bleiben. */
export async function updateNote(db: Db, tenantId: number, id: number, text: string) {
  const value = text.trim(); if (!value) throw new Error("Die Notiz darf nicht leer sein – zum Entfernen bitte löschen.");
  const row = (await db.select({ id: pipelineNotes.id }).from(pipelineNotes).where(and(eq(pipelineNotes.id, id), eq(pipelineNotes.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Notiz nicht gefunden.");
  await db.update(pipelineNotes).set({ text: value.slice(0, 5000) }).where(and(eq(pipelineNotes.id, id), eq(pipelineNotes.tenantId, tenantId)));
  return { success: true as const };
}
export async function deleteNote(db: Db, tenantId: number, id: number) { await db.delete(pipelineNotes).where(and(eq(pipelineNotes.id, id), eq(pipelineNotes.tenantId, tenantId))); return { success: true as const }; }
export async function noteCounts(db: Db, tenantId: number, leadIds: number[]) { if (!leadIds.length) return new Map<number, { count: number; latest: string | null }>(); const rows = await db.select({ leadId: pipelineNotes.leadId, text: pipelineNotes.text, createdAt: pipelineNotes.createdAt }).from(pipelineNotes).where(and(eq(pipelineNotes.tenantId, tenantId), inArray(pipelineNotes.leadId, leadIds))).orderBy(desc(pipelineNotes.createdAt)); const map = new Map<number, { count: number; latest: string | null }>(); for (const row of rows) { const entry = map.get(row.leadId) ?? { count: 0, latest: null }; entry.count += 1; if (!entry.latest) entry.latest = row.text.slice(0, 80); map.set(row.leadId, entry); } return map; }

/**
 * Stufen je Pipeline: jede der drei Pipelines (Meta Ads, Kaltakquise, E-Mail-Kampagne) kann eigene Stufen haben.
 * „alle“ ist der gemeinsame Standard – er gilt für jede Pipeline ohne eigene Zeile (so bleiben bestehende Mandanten unverändert).
 */
export async function pipelineStageSets(db: Db, tenantId: number): Promise<StageSets> {
  const rows = await db.select({ source: pipelineStageConfigs.source, stages: pipelineStageConfigs.stages }).from(pipelineStageConfigs).where(eq(pipelineStageConfigs.tenantId, tenantId));
  return buildStageSets(rows);
}
/** Stufen einer Pipeline (ohne Angabe: der Standard). */
export async function pipelineStages(db: Db, tenantId: number, source?: PipelineSource | "alle" | null): Promise<StageDef[]> {
  const sets = await pipelineStageSets(db, tenantId); return stagesOf(sets, source ?? "alle");
}
/** Für die Einstellungen: Stufen der Pipeline plus ob sie eigene hat oder den Standard nutzt. */
export async function pipelineStageSetup(db: Db, tenantId: number, source: PipelineSource | "alle") {
  const rows = await db.select({ source: pipelineStageConfigs.source }).from(pipelineStageConfigs).where(eq(pipelineStageConfigs.tenantId, tenantId));
  const sets = buildStageSets(await db.select({ source: pipelineStageConfigs.source, stages: pipelineStageConfigs.stages }).from(pipelineStageConfigs).where(eq(pipelineStageConfigs.tenantId, tenantId)));
  return { source, stages: stagesOf(sets, source), own: source === "alle" ? rows.some((row) => row.source === "alle") : rows.some((row) => row.source === source), defaultStages: sets.alle, customized: rows.map((row) => row.source) };
}
/** Karten in Stufen, die es nicht mehr gibt, auf den Eingang ihrer Pipeline setzen – mit Vermerk im Verlauf (damit „Früheren Stand wiederherstellen“ es sieht). */
async function moveOrphanedLeads(db: Db, tenantId: number, before: StageSets, after: StageSets, only?: PipelineSource) {
  const rows = await db.select({ id: leads.id, stage: leads.pipelineStage, adPlatform: leads.adPlatform }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), isNotNull(leads.pipelineStage)));
  let moved = 0;
  for (const lead of rows) {
    if (only && pipelineSourceOf(lead.adPlatform) !== only) continue;
    const own = stagesForLead(after, lead); if (!lead.stage || own.some((stage) => stage.key === lead.stage)) continue;
    const entry = entryStage(own); const was = stageLabel(lead.stage, stagesForLead(before, lead));
    await db.update(leads).set({ pipelineStage: entry, pipelineUpdatedAt: new Date() }).where(eq(leads.id, lead.id));
    await db.insert(pipelineEvents).values({ tenantId, leadId: lead.id, fromStage: lead.stage, toStage: entry, actorUserId: null, note: `Stufe „${was}“ gibt es nicht mehr – auf „${stageLabel(entry, own)}“ gesetzt` });
    moved += 1;
  }
  return moved;
}
export async function savePipelineStages(db: Db, tenantId: number, input: Array<Partial<StageDef>>, source: PipelineSource | "alle" = "alle") {
  const { stages, issues } = normalizeStages(input); if (issues.length) throw new Error(issues.join(" "));
  const before = await pipelineStageSets(db, tenantId);
  const existing = (await db.select({ id: pipelineStageConfigs.id }).from(pipelineStageConfigs).where(and(eq(pipelineStageConfigs.tenantId, tenantId), eq(pipelineStageConfigs.source, source))).limit(1))[0];
  if (existing) await db.update(pipelineStageConfigs).set({ stages }).where(eq(pipelineStageConfigs.id, existing.id)); else await db.insert(pipelineStageConfigs).values({ tenantId, source, stages });
  // Leads gelöschter Stufen zurück auf den Eingang – nur in den Pipelines, für die dieser Satz gilt (mit Vermerk im Verlauf)
  await moveOrphanedLeads(db, tenantId, before, await pipelineStageSets(db, tenantId));
  return { stages, source };
}
/** Eigene Stufen einer Pipeline verwerfen – sie nutzt danach wieder den Standard. */
export async function resetPipelineStages(db: Db, tenantId: number, source: PipelineSource) {
  const before = await pipelineStageSets(db, tenantId);
  await db.delete(pipelineStageConfigs).where(and(eq(pipelineStageConfigs.tenantId, tenantId), eq(pipelineStageConfigs.source, source)));
  const sets = await pipelineStageSets(db, tenantId);
  await moveOrphanedLeads(db, tenantId, before, sets, source);
  return { stages: stagesOf(sets, source), source };
}
