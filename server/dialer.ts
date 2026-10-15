/**
 * Dialer: manuell, Power (alle Nummern nacheinander) und Predictive (mehrere Anrufe gleichzeitig, Verbindung an freie Agenten).
 * Anrufe laufen über den Telefonie-Anbieter (sipgate oder Simulation); Ereignisse (klingelt, verbunden, beendet,
 * Anrufbeantworter, Aufzeichnung) kommen als Webhooks zurück und werden hier verarbeitet.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { agentSessions, callRecords, dialerCalls, dialerCampaigns, dialerQueueItems, leadStatusEvents, leadTagAssignments, leads, phoneNumbers, rawBatches, rawContacts, telephonySettings, users, type AgentSession, type DialerCall, type DialerCampaign, type TelephonySettings } from "../drizzle/schema";
import { batchCategoryIds, convertRawContact } from "./raw-data";
import { ingestInternalCall } from "./call-qa";
import { autoNotesForCall, writeCallNote } from "./call-notes";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./integration-secrets";
import { triggerLeadAutomations, type Db } from "./lead-pipeline";
import { SimulationProvider, simulationFor, type NumberSearch, type TelephonyProvider } from "./telephony-provider";
import { SipgateProvider, parseSipgateEvent, sameNumber, sipgateStatusOf, type SipgateCredentials, type SipgateEvent, type SipgateSystem } from "./sipgate-provider";

export { DISPOSITIONS } from "../shared/dialer";
import { DISPOSITIONS } from "../shared/dialer";
import { annotateActivity, logActivity } from "./activity";
export type DispositionKey = (typeof DISPOSITIONS)[number]["key"];
const RETRY_RESULTS = new Set(["besetzt", "keine_antwort", "anrufbeantworter", "abgebrochen", "fehlgeschlagen", "nicht_erreicht", "wiedervorlage"]);
const FINAL_STATUSES = new Set<string>(["beendet", "besetzt", "keine_antwort", "anrufbeantworter", "abgebrochen", "fehlgeschlagen"]);
const DEFAULT_WINDOW = { weekdays: [1, 2, 3, 4, 5], from: "09:00", to: "19:00" };

export const normalizePhone = (value: string) => { const digits = value.replace(/[^\d+]/g, ""); if (digits.startsWith("+")) return digits; if (digits.startsWith("00")) return `+${digits.slice(2)}`; if (digits.startsWith("0")) return `+49${digits.slice(1)}`; return `+${digits}`; };

/* ------------------------------------------------------------------ Einstellungen & Anbieter */

export async function ensureTelephonySettings(db: Db, tenantId: number): Promise<TelephonySettings> {
  const existing = (await db.select().from(telephonySettings).where(eq(telephonySettings.tenantId, tenantId)).limit(1))[0];
  if (existing) return existing;
  await db.insert(telephonySettings).values({ tenantId, webhookSecret: nanoid(32), announcement: "Guten Tag. Dieses Gespräch wird zur Qualitätssicherung aufgezeichnet. Wenn Sie damit nicht einverstanden sind, sagen Sie es bitte.", callWindow: DEFAULT_WINDOW });
  return (await db.select().from(telephonySettings).where(eq(telephonySettings.tenantId, tenantId)).limit(1))[0];
}

function sipgateCredentialsOf(settings: TelephonySettings): SipgateCredentials | null { if (!settings.sipgateEncrypted) return null; try { const parsed = JSON.parse(decryptIntegrationSecret(settings.sipgateEncrypted)) as SipgateCredentials; return parsed.tokenId && parsed.token ? parsed : null; } catch { return null; } }
/** Tests können den Netzwerkzugriff des sipgate-Anbieters ersetzen (kein echter Aufruf gegen api.sipgate.com). */
export const sipgateTestHooks: { fetchImpl?: typeof fetch } = {};
function sipgateFor(settings: TelephonySettings, fetchImpl?: typeof fetch) {
  const credentials = sipgateCredentialsOf(settings); if (!credentials) throw new Error("sipgate-Token fehlt (Telefonie → Einstellungen → sipgate: Token-ID und Token eintragen).");
  return new SipgateProvider(credentials, { userId: settings.sipgateUserId, system: (settings.sipgateSystem as SipgateSystem | null) ?? null, deviceId: settings.sipgateDeviceId, smsId: settings.sipgateSmsId, fetchImpl: fetchImpl ?? sipgateTestHooks.fetchImpl });
}

export async function providerFor(db: Db, tenantId: number, fetchImpl?: typeof fetch): Promise<{ provider: TelephonyProvider; settings: TelephonySettings }> {
  const settings = await ensureTelephonySettings(db, tenantId);
  if (settings.provider === "sipgate") return { provider: sipgateFor(settings, fetchImpl), settings };
  return { provider: simulationFor(tenantId), settings };
}

export async function getTelephonySettings(db: Db, tenantId: number, appUrl: string) {
  const settings = await ensureTelephonySettings(db, tenantId);
  const numbers = await db.select().from(phoneNumbers).where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "aktiv"))).orderBy(asc(phoneNumbers.id));
  const base = appUrl.replace(/\/+$/, "");
  const sipgate = sipgateCredentialsOf(settings);
  return { ...settings, credentialsEncrypted: undefined, sipgateEncrypted: undefined, provider: settings.provider === "sipgate" ? "sipgate" as const : "simulation" as const, callWindow: { ...DEFAULT_WINDOW, ...((settings.callWindow ?? {}) as Record<string, unknown>) }, numbers, webhooks: { sipgateEvents: sipgateWebhookUrl(base, tenantId, settings.webhookSecret) }, dispositions: DISPOSITIONS,
    sipgate: { tokenId: sipgate?.tokenId ?? "", token: sipgate?.token ? "••••••••" : "", userId: settings.sipgateUserId ?? "", system: (settings.sipgateSystem as SipgateSystem | null) ?? null, smsId: settings.sipgateSmsId ?? "s0", deviceId: settings.sipgateDeviceId ?? "", webhookAt: settings.sipgateWebhookAt ?? null } };
}
export const sipgateWebhookUrl = (base: string, tenantId: number, secret: string) => `${base}/api/telephony/sipgate/events?tenant=${tenantId}&secret=${secret}`;

export async function saveTelephonySettings(db: Db, tenantId: number, input: { provider: "simulation" | "sipgate"; sipgate?: { tokenId: string; token: string; smsId?: string | null; deviceId?: string | null } | null; defaultNumberId: number | null; agentConnection?: "browser" | "telefon" | "sipgate" | null; autoCallNotes?: boolean; recordWithoutConsent?: boolean; announcement: string; consentMode: "ansage" | "agent_button" | "keine"; recordCalls: boolean; amdEnabled: boolean; maxAttempts: number; retryMinutes: number; wrapUpSeconds: number; pacingRatio: number; maxAbandonRate: number; callWindow: { weekdays: number[]; from: string; to: string } }) {
  const settings = await ensureTelephonySettings(db, tenantId);
  const previousSipgate = sipgateCredentialsOf(settings);
  const sipgate: SipgateCredentials | null = input.sipgate && (input.sipgate.tokenId.trim() || input.sipgate.token.trim()) ? { tokenId: input.sipgate.tokenId.trim(), token: input.sipgate.token === "••••••••" ? previousSipgate?.token ?? "" : input.sipgate.token.trim() } : previousSipgate; // leere Felder = nichts ändern
  const sipgateChanged = Boolean(sipgate && (sipgate.tokenId !== previousSipgate?.tokenId || sipgate.token !== previousSipgate?.token));
  if (input.provider === "sipgate" && (!sipgate?.tokenId || !sipgate.token)) throw new Error("Für sipgate bitte Token-ID und Token eintragen (sipgate → Konto → Personal Access Token).");
  await db.update(telephonySettings).set({ provider: input.provider, autoCallNotes: input.autoCallNotes ?? settings.autoCallNotes, recordWithoutConsent: input.recordWithoutConsent ?? settings.recordWithoutConsent,
    sipgateEncrypted: sipgate?.tokenId && sipgate.token ? encryptIntegrationSecret(JSON.stringify(sipgate)) : null, sipgateSmsId: input.sipgate ? (input.sipgate.smsId?.trim() || "s0") : settings.sipgateSmsId, sipgateDeviceId: input.sipgate ? (input.sipgate.deviceId?.trim() || null) : settings.sipgateDeviceId, ...(sipgateChanged ? { sipgateUserId: null, sipgateSystem: null } : {}),
    defaultNumberId: input.defaultNumberId, agentConnection: input.provider === "sipgate" ? "sipgate" : "browser", announcement: input.announcement, consentMode: input.consentMode, recordCalls: input.recordCalls, amdEnabled: input.amdEnabled, maxAttempts: input.maxAttempts, retryMinutes: input.retryMinutes, wrapUpSeconds: input.wrapUpSeconds, pacingRatio: input.pacingRatio.toFixed(2), maxAbandonRate: input.maxAbandonRate.toFixed(2), callWindow: input.callWindow }).where(eq(telephonySettings.id, settings.id));
  return { success: true as const };
}

export async function softphoneToken(db: Db, tenantId: number, userId: number) {
  const { provider, settings } = await providerFor(db, tenantId);
  const identity = `agent-${tenantId}-${userId}`;
  const token = await provider.accessToken(identity);
  return { provider: provider.name, identity, token, connection: settings.agentConnection };
}

/* ------------------------------------------------------------------ Rufnummern */

export async function searchNumbers(db: Db, tenantId: number, search: NumberSearch) { const { provider } = await providerFor(db, tenantId); return provider.searchNumbers(search); }

export async function purchaseNumber(db: Db, tenantId: number, input: { e164: string; country: "DE" | "AT" | "CH"; type: NumberSearch["type"]; friendlyName?: string; region?: string | null; monthlyPrice?: number | null; currency?: string }, appUrl: string) {
  const { provider, settings } = await providerFor(db, tenantId);
  const base = appUrl.replace(/\/+$/, "");
  const bought = await provider.purchaseNumber(input.e164, { friendlyName: input.friendlyName || `Tanesco ${input.country}`, voiceUrl: `${base}/api/telephony/voice/inbound?tenant=${tenantId}`, statusCallbackUrl: `${base}/api/telephony/status`, country: input.country, addressSid: null, bundleSid: null });
  const inserted = await db.insert(phoneNumbers).values({ tenantId, provider: provider.name, providerSid: bought.providerSid, e164: bought.e164, country: input.country, numberType: input.type, friendlyName: bought.friendlyName, region: input.region ?? null, monthlyPrice: input.monthlyPrice === null || input.monthlyPrice === undefined ? null : input.monthlyPrice.toFixed(2), currency: input.currency ?? "EUR" });
  const id = Number(inserted[0]?.insertId) || 0;
  if (!settings.defaultNumberId) await db.update(telephonySettings).set({ defaultNumberId: id }).where(eq(telephonySettings.id, settings.id));
  return { id, e164: bought.e164 };
}

export async function releaseNumber(db: Db, tenantId: number, id: number) {
  const number = (await db.select().from(phoneNumbers).where(and(eq(phoneNumbers.id, id), eq(phoneNumbers.tenantId, tenantId))).limit(1))[0];
  if (!number) throw new Error("Rufnummer wurde nicht gefunden.");
  const { provider, settings } = await providerFor(db, tenantId);
  if (number.providerSid && number.provider === provider.name) await provider.releaseNumber(number.providerSid);
  await db.update(phoneNumbers).set({ status: "gekuendigt", releasedAt: new Date() }).where(eq(phoneNumbers.id, id));
  if (settings.defaultNumberId === id) await db.update(telephonySettings).set({ defaultNumberId: null }).where(eq(telephonySettings.id, settings.id));
  return { success: true as const };
}

/* ------------------------------------------------------------------ Kampagnen & Wähllisten */

export type LeadFilter = { categoryIds?: number[]; statuses?: string[]; tagIds?: number[]; supplierIds?: number[]; notCalledDays?: number | null; onlyWithoutCall?: boolean; rawBatchIds?: number[]; leadsEnabled?: boolean; leadIds?: number[]; kind?: "verkauf" | "vertrieb" };

export async function listCampaigns(db: Db, tenantId: number) {
  const campaigns = await db.select().from(dialerCampaigns).where(eq(dialerCampaigns.tenantId, tenantId)).orderBy(desc(dialerCampaigns.createdAt));
  const items = await db.select({ campaignId: dialerQueueItems.campaignId, status: dialerQueueItems.status }).from(dialerQueueItems).where(eq(dialerQueueItems.tenantId, tenantId));
  const calls = await db.select({ campaignId: dialerCalls.campaignId, status: dialerCalls.status, talkSeconds: dialerCalls.talkSeconds, disposition: dialerCalls.disposition }).from(dialerCalls).where(eq(dialerCalls.tenantId, tenantId));
  const sessions = await db.select({ campaignId: agentSessions.campaignId, status: agentSessions.status }).from(agentSessions).where(and(eq(agentSessions.tenantId, tenantId), isNull(agentSessions.endedAt)));
  return campaigns.map((campaign) => { const queue = items.filter((item) => item.campaignId === campaign.id); const own = calls.filter((call) => call.campaignId === campaign.id); const dialed = own.filter((call) => !["initiiert", "klingelt", "wartet"].includes(call.status)); return { ...campaign, stats: { queue: queue.length, open: queue.filter((item) => item.status === "offen" || item.status === "wiederholen").length, done: queue.filter((item) => item.status === "erledigt").length, calls: dialed.length, connected: own.filter((call) => ["verbunden", "beendet"].includes(call.status) && (call.talkSeconds ?? 0) > 0).length, sold: own.filter((call) => call.disposition === "verkauft" || call.disposition === "interessiert").length, abandoned: own.filter((call) => call.status === "abgebrochen").length, talkMinutes: Math.round(own.reduce((sum, call) => sum + (call.talkSeconds ?? 0), 0) / 60), agents: sessions.filter((session) => session.campaignId === campaign.id).length } }; });
}

export async function saveCampaign(db: Db, tenantId: number, userId: number, input: { id?: number; name: string; mode: "manuell" | "power" | "predictive"; leadFilter: LeadFilter; callerNumberId: number | null; maxAttempts: number | null; retryMinutes: number | null; wrapUpSeconds: number | null; pacingRatio: number | null; autoNotes?: boolean | null; callWindow: { weekdays: number[]; from: string; to: string } | null; script: string }) {
  const values = { tenantId, name: input.name.trim(), mode: input.mode, leadFilter: input.leadFilter, callerNumberId: input.callerNumberId, maxAttempts: input.maxAttempts, retryMinutes: input.retryMinutes, wrapUpSeconds: input.wrapUpSeconds, pacingRatio: input.pacingRatio === null ? null : input.pacingRatio.toFixed(2), autoNotes: input.autoNotes === undefined ? null : input.autoNotes, callWindow: input.callWindow, script: input.script, createdByUserId: userId };
  if (input.id) { await db.update(dialerCampaigns).set(values).where(and(eq(dialerCampaigns.id, input.id), eq(dialerCampaigns.tenantId, tenantId))); return { id: input.id }; }
  const inserted = await db.insert(dialerCampaigns).values(values); return { id: Number(inserted[0]?.insertId) || 0 };
}

export async function setCampaignStatus(db: Db, tenantId: number, id: number, status: "entwurf" | "aktiv" | "pausiert" | "beendet") { await db.update(dialerCampaigns).set({ status }).where(and(eq(dialerCampaigns.id, id), eq(dialerCampaigns.tenantId, tenantId))); return { success: true as const }; }

export async function deleteCampaign(db: Db, tenantId: number, id: number) { await db.delete(dialerQueueItems).where(and(eq(dialerQueueItems.tenantId, tenantId), eq(dialerQueueItems.campaignId, id))); await db.delete(dialerCampaigns).where(and(eq(dialerCampaigns.id, id), eq(dialerCampaigns.tenantId, tenantId))); return { success: true as const }; }

/** Füllt die Wählliste aus dem Lead-Filter (nur Leads mit Telefonnummer, ohne Doppel). */
export async function buildQueue(db: Db, tenantId: number, campaignId: number) {
  const campaign = (await db.select().from(dialerCampaigns).where(and(eq(dialerCampaigns.id, campaignId), eq(dialerCampaigns.tenantId, tenantId))).limit(1))[0];
  if (!campaign) throw new Error("Kampagne wurde nicht gefunden.");
  const filter = (campaign.leadFilter ?? {}) as LeadFilter;
  const conditions = [eq(leads.tenantId, tenantId), sql`${leads.phone} IS NOT NULL AND ${leads.phone} <> ''`];
  if (filter.leadIds?.length) conditions.push(inArray(leads.id, filter.leadIds)); else conditions.push(eq(leads.kind, filter.kind ?? "verkauf")); // Dialer aus der Pipeline: genau diese Karten – Callcenter-Kampagnen nur Leads zum Verkauf, Kaltakquise-Listen (kind=vertrieb) nur Vertriebskontakte
  if (filter.categoryIds?.length) conditions.push(inArray(leads.categoryId, filter.categoryIds));
  if (filter.statuses?.length) conditions.push(inArray(leads.status, filter.statuses as Array<typeof leads.$inferSelect["status"]>));
  if (filter.supplierIds?.length) conditions.push(inArray(leads.supplierId, filter.supplierIds));
  let rows = await db.select().from(leads).where(and(...conditions)).orderBy(asc(leads.id)).limit(5000); // älteste zuerst, feste Reihenfolge
  if (filter.tagIds?.length) { const tagged = new Set((await db.select({ leadId: leadTagAssignments.leadId }).from(leadTagAssignments).where(inArray(leadTagAssignments.tagId, filter.tagIds))).map((row) => row.leadId)); rows = rows.filter((row) => tagged.has(row.id)); }
  if (filter.onlyWithoutCall || (filter.notCalledDays && filter.notCalledDays > 0)) { const since = filter.notCalledDays ? new Date(Date.now() - filter.notCalledDays * 24 * 3_600_000) : new Date(0); const called = new Set((await db.select({ leadId: dialerCalls.leadId }).from(dialerCalls).where(and(eq(dialerCalls.tenantId, tenantId), gte(dialerCalls.startedAt, since)))).map((row) => row.leadId)); rows = rows.filter((row) => !called.has(row.id)); }
  if (filter.leadsEnabled === false) rows = [];
  const existingItems = await db.select({ leadId: dialerQueueItems.leadId, rawContactId: dialerQueueItems.rawContactId }).from(dialerQueueItems).where(eq(dialerQueueItems.campaignId, campaignId));
  const existing = new Set(existingItems.map((row) => row.leadId).filter((id): id is number => id !== null)); const existingRaw = new Set(existingItems.map((row) => row.rawContactId).filter((id): id is number => id !== null));
  const values: Array<{ tenantId: number; campaignId: number; leadId: number | null; rawContactId: number | null; phone: string; status: "offen"; nextAttemptAt: null }> = rows.filter((row) => !existing.has(row.id)).map((row) => ({ tenantId, campaignId, leadId: row.id, rawContactId: null, phone: normalizePhone(row.phone!), status: "offen" as const, nextAttemptAt: null })); // sofort fällig (kein Sekundenrunden der Datenbank)
  // Rohdaten-Listen: noch keine Leads – sie werden erst nach dem Gespräch übernommen
  if (filter.rawBatchIds?.length) {
    const contacts = await db.select().from(rawContacts).where(and(eq(rawContacts.tenantId, tenantId), inArray(rawContacts.batchId, filter.rawBatchIds), inArray(rawContacts.status, ["neu", "in_liste"]), sql`${rawContacts.phone} IS NOT NULL AND ${rawContacts.phone} <> ''`)).orderBy(asc(rawContacts.id)).limit(5000);
    for (const contact of contacts) if (!existingRaw.has(contact.id)) values.push({ tenantId, campaignId, leadId: null, rawContactId: contact.id, phone: normalizePhone(contact.phone!), status: "offen", nextAttemptAt: null });
    const ids = contacts.map((contact) => contact.id); if (ids.length) await db.update(rawContacts).set({ status: "in_liste" }).where(and(inArray(rawContacts.id, ids), eq(rawContacts.status, "neu")));
  }
  for (let index = 0; index < values.length; index += 500) await db.insert(dialerQueueItems).values(values.slice(index, index + 500));
  return { added: values.length, total: existingItems.length + values.length };
}

export async function listQueue(db: Db, tenantId: number, campaignId: number, limit = 300) {
  const rows = await db.select({ item: dialerQueueItems, publicId: leads.publicId, firstName: leads.firstName, lastName: leads.lastName, city: leads.city, leadStatus: leads.status, rawFirst: rawContacts.firstName, rawLast: rawContacts.lastName, rawCompany: rawContacts.company, rawCity: rawContacts.city }).from(dialerQueueItems).leftJoin(leads, eq(leads.id, dialerQueueItems.leadId)).leftJoin(rawContacts, eq(rawContacts.id, dialerQueueItems.rawContactId)).where(and(eq(dialerQueueItems.tenantId, tenantId), eq(dialerQueueItems.campaignId, campaignId))).orderBy(asc(dialerQueueItems.status), asc(dialerQueueItems.nextAttemptAt)).limit(limit);
  return rows.map(({ item, publicId, firstName, lastName, city, leadStatus, rawFirst, rawLast, rawCompany, rawCity }) => ({ ...item, publicId: publicId ?? (item.rawContactId ? `Rohdaten #${item.rawContactId}` : ""), name: [firstName ?? rawFirst, lastName ?? rawLast].filter(Boolean).join(" ") || rawCompany || "", city: city ?? rawCity ?? null, leadStatus: leadStatus ?? null, source: item.rawContactId ? "rohdaten" : "lead" }));
}

/* ------------------------------------------------------------------ Agenten-Sitzungen */

export async function startSession(db: Db, tenantId: number, userId: number, input: { campaignId: number | null; mode: "manuell" | "power" | "predictive"; connection: "browser" | "telefon" | "sipgate"; agentPhone?: string | null; agentDeviceId?: string | null }) {
  const existing = (await db.select().from(agentSessions).where(eq(agentSessions.userId, userId)).limit(1))[0];
  const settings = await ensureTelephonySettings(db, tenantId);
  if (settings.provider === "sipgate" && input.mode === "predictive") throw new Error("Der Predictive-Dialer geht mit sipgate nicht – sipgate kann keine Anrufe parallel aufbauen und durchstellen. Bitte „Manuell“ oder „Power-Dialer“ wählen.");
  const connection = settings.provider === "sipgate" ? "sipgate" as const : input.connection === "sipgate" ? "browser" as const : input.connection;
  const agentDeviceId = settings.provider === "sipgate" ? (input.agentDeviceId?.trim() || settings.sipgateDeviceId || null) : null;
  if (settings.provider === "sipgate" && !agentDeviceId) throw new Error("Bitte dein sipgate-Gerät wählen (z. B. e0 – die sipgate-App oder dein Tischtelefon).");
  const values = { tenantId, userId, campaignId: input.campaignId, mode: input.mode, status: "bereit" as const, connection, agentPhone: input.agentPhone ? normalizePhone(input.agentPhone) : null, agentDeviceId, currentCallId: null, lastActivityAt: new Date(), startedAt: new Date(), endedAt: null };
  if (existing) { await db.update(agentSessions).set(values).where(eq(agentSessions.id, existing.id)); return currentSession(db, tenantId, userId); }
  await db.insert(agentSessions).values(values);
  return currentSession(db, tenantId, userId);
}

export async function updateSession(db: Db, tenantId: number, userId: number, status: "bereit" | "pause" | "offline" | "nachbereitung") {
  const session = (await db.select().from(agentSessions).where(and(eq(agentSessions.userId, userId), eq(agentSessions.tenantId, tenantId))).limit(1))[0];
  if (!session) throw new Error("Keine aktive Sitzung.");
  await db.update(agentSessions).set({ status: status === "offline" ? "offline" : status, lastActivityAt: new Date(), endedAt: status === "offline" ? new Date() : null, currentCallId: status === "bereit" ? null : session.currentCallId }).where(eq(agentSessions.id, session.id));
  return currentSession(db, tenantId, userId);
}

export async function currentSession(db: Db, tenantId: number, userId: number) {
  const session = (await db.select().from(agentSessions).where(and(eq(agentSessions.userId, userId), eq(agentSessions.tenantId, tenantId))).limit(1))[0];
  if (!session || session.endedAt) return null;
  const call = session.currentCallId ? await callDetail(db, tenantId, session.currentCallId) : null;
  const campaign = session.campaignId ? (await db.select().from(dialerCampaigns).where(eq(dialerCampaigns.id, session.campaignId)).limit(1))[0] ?? null : null;
  const autoNotes = call ? Boolean(call.autoNotes) : await autoNotesForCall(db, tenantId, session.campaignId);
  return { ...session, call, autoNotes, campaign: campaign ? { id: campaign.id, name: campaign.name, mode: campaign.mode, status: campaign.status, script: campaign.script, autoNotes: campaign.autoNotes ?? null } : null };
}

export async function listSessions(db: Db, tenantId: number) {
  const rows = await db.select({ session: agentSessions, name: users.name, campaign: dialerCampaigns.name }).from(agentSessions).innerJoin(users, eq(users.id, agentSessions.userId)).leftJoin(dialerCampaigns, eq(dialerCampaigns.id, agentSessions.campaignId)).where(and(eq(agentSessions.tenantId, tenantId), isNull(agentSessions.endedAt)));
  return rows.map(({ session, name, campaign }) => ({ ...session, agentName: name, campaignName: campaign }));
}

/* ------------------------------------------------------------------ Anrufe */

function withinWindow(window: unknown, now: Date) {
  const config = { ...DEFAULT_WINDOW, ...((window ?? {}) as Partial<typeof DEFAULT_WINDOW>) };
  if (!config.weekdays.includes(now.getDay())) return false;
  const minutes = now.getHours() * 60 + now.getMinutes(); const [fh, fm] = config.from.split(":").map(Number); const [th, tm] = config.to.split(":").map(Number);
  return minutes >= fh * 60 + fm && minutes <= th * 60 + tm;
}

async function callerNumber(db: Db, tenantId: number, settings: TelephonySettings, campaign?: DialerCampaign | null) {
  const id = campaign?.callerNumberId ?? settings.defaultNumberId;
  const number = id ? (await db.select().from(phoneNumbers).where(and(eq(phoneNumbers.id, id), eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "aktiv"))).limit(1))[0] : (await db.select().from(phoneNumbers).where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "aktiv"))).limit(1))[0];
  if (!number) throw new Error("Keine aktive Rufnummer vorhanden – bitte zuerst eine Rufnummer kaufen (Telefonie → Rufnummern).");
  return number;
}

export type ConnectInstruction = { callId: number; mode: "manuell" | "power" | "predictive"; connection: "browser" | "telefon" | "simulation" | "sipgate"; params: Record<string, string> };

/** Baut den Anruf für einen Agenten auf (manuell oder nächster Eintrag der Wählliste). */
async function createAgentCall(db: Db, tenantId: number, session: AgentSession, target: { leadId: number | null; rawContactId?: number | null; phone: string; queueItemId: number | null; campaign: DialerCampaign | null }, appUrl: string): Promise<ConnectInstruction> {
  const { provider, settings } = await providerFor(db, tenantId);
  const number = await callerNumber(db, tenantId, settings, target.campaign);
  const autoNotes = await autoNotesForCall(db, tenantId, target.campaign?.id ?? null);
  const inserted = await db.insert(dialerCalls).values({ tenantId, campaignId: target.campaign?.id ?? null, queueItemId: target.queueItemId, leadId: target.leadId, rawContactId: target.rawContactId ?? null, agentUserId: session.userId, mode: session.mode, provider: provider.name, fromNumber: number.e164, toNumber: target.phone, autoNotes, status: "initiiert" });
  const callId = Number(inserted[0]?.insertId) || 0;
  if (target.queueItemId) await db.update(dialerQueueItems).set({ status: "waehlt", attempts: sql`${dialerQueueItems.attempts} + 1`, lockedByUserId: session.userId, lastCallId: callId }).where(eq(dialerQueueItems.id, target.queueItemId));
  await db.update(agentSessions).set({ status: "waehlt", currentCallId: callId, lastActivityAt: new Date() }).where(eq(agentSessions.id, session.id));
  void appUrl;
  if (provider.name === "simulation") {
    const result = await provider.originateCall({ to: target.phone, from: number.e164, answerUrl: "", statusCallbackUrl: "", amd: settings.amdEnabled, reference: String(callId) });
    await db.update(dialerCalls).set({ providerCallSid: result.providerCallSid }).where(eq(dialerCalls.id, callId));
    await processSimulationEvents(db, tenantId);
    return { callId, mode: session.mode, connection: "simulation", params: { callId: String(callId) } };
  }
  if (provider.name === "sipgate") {
    // sipgate: Click-to-Dial – erst klingelt das Gerät des Agenten, dann der Kunde. Status kommt per Webhook oder Abgleich (syncSipgateCalls).
    const deviceId = session.agentDeviceId || settings.sipgateDeviceId; if (!deviceId) throw new Error("Kein sipgate-Gerät gewählt – bitte die Sitzung neu starten und dein Gerät wählen.");
    // Angezeigte Rufnummer muss zum sipgate-Konto gehören: steht als Standard noch eine Twilio-/Simulationsnummer, nimmt die Software die erste sipgate-Nummer.
    const sipgateNumber = number.provider === "sipgate" ? number : (await db.select().from(phoneNumbers).where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "aktiv"), eq(phoneNumbers.provider, "sipgate"))).orderBy(asc(phoneNumbers.id)).limit(1))[0] ?? number;
    if (sipgateNumber.id !== number.id) await db.update(dialerCalls).set({ fromNumber: sipgateNumber.e164 }).where(eq(dialerCalls.id, callId));
    const result = await provider.originateCall({ to: target.phone, from: sipgateNumber.e164, answerUrl: "", statusCallbackUrl: "", amd: false, reference: String(callId), deviceId, timeoutSeconds: 0 }) /* nicht warten – die callId holt der Abgleich oder der Webhook nach */.catch(async (error: Error) => { await finishCall(db, tenantId, callId, { status: "fehlgeschlagen", note: error.message.slice(0, 200) }); throw error; });
    await db.update(dialerCalls).set({ providerCallSid: result.providerCallSid, providerSessionId: result.providerSessionId ?? null, status: result.providerCallSid.startsWith("session:") || result.providerCallSid.startsWith("pending:") ? "initiiert" : "klingelt" }).where(eq(dialerCalls.id, callId));
    return { callId, mode: session.mode, connection: "sipgate", params: { callId: String(callId), device: deviceId } };
  }
  throw new Error("Kein Telefonie-Anbieter eingerichtet – bitte unter Telefonie → Einstellungen sipgate einrichten (oder die Simulation wählen).");
}

export async function placeManualCall(db: Db, tenantId: number, userId: number, input: { publicId?: string | null; phone?: string | null }, appUrl: string) {
  const session = (await db.select().from(agentSessions).where(and(eq(agentSessions.userId, userId), eq(agentSessions.tenantId, tenantId))).limit(1))[0];
  if (!session || session.endedAt) throw new Error("Bitte zuerst eine Dialer-Sitzung starten.");
  if (session.currentCallId) throw new Error("Es läuft bereits ein Anruf.");
  const lead = input.publicId ? (await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.publicId, input.publicId))).limit(1))[0] : undefined; // Lead-ID aus dem Callcenter (Verkauf) oder Karte aus der Pipeline (Vertrieb)
  const phone = lead?.phone ?? input.phone; if (!phone) throw new Error("Keine Telefonnummer angegeben.");
  const campaign = session.campaignId ? (await db.select().from(dialerCampaigns).where(eq(dialerCampaigns.id, session.campaignId)).limit(1))[0] ?? null : null;
  return createAgentCall(db, tenantId, session, { leadId: lead?.id ?? null, phone: normalizePhone(phone), queueItemId: null, campaign }, appUrl);
}

/** Power-Dialer: nächster fälliger Eintrag der Wählliste für diesen Agenten. */
export async function nextQueueCall(db: Db, tenantId: number, userId: number, appUrl: string) {
  const session = (await db.select().from(agentSessions).where(and(eq(agentSessions.userId, userId), eq(agentSessions.tenantId, tenantId))).limit(1))[0];
  if (!session || session.endedAt || !session.campaignId) throw new Error("Bitte zuerst eine Sitzung mit Kampagne starten.");
  if (session.currentCallId) throw new Error("Es läuft bereits ein Anruf.");
  const campaign = (await db.select().from(dialerCampaigns).where(eq(dialerCampaigns.id, session.campaignId)).limit(1))[0];
  if (!campaign || campaign.status !== "aktiv") throw new Error("Die Kampagne ist nicht aktiv.");
  const settings = await ensureTelephonySettings(db, tenantId);
  if (!withinWindow(campaign.callWindow ?? settings.callWindow, new Date())) throw new Error("Außerhalb des Anrufzeitfensters der Kampagne.");
  const item = (await db.select().from(dialerQueueItems).where(and(eq(dialerQueueItems.campaignId, campaign.id), inArray(dialerQueueItems.status, ["offen", "wiederholen"]), or(isNull(dialerQueueItems.nextAttemptAt), lte(dialerQueueItems.nextAttemptAt, new Date())))).orderBy(desc(dialerQueueItems.priority), asc(dialerQueueItems.nextAttemptAt), asc(dialerQueueItems.id)).limit(1))[0];
  if (!item) return { done: true as const, instruction: null };
  return { done: false as const, instruction: await createAgentCall(db, tenantId, session, { leadId: item.leadId, rawContactId: item.rawContactId, phone: item.phone, queueItemId: item.id, campaign }, appUrl) };
}

/** Predictive-Dialer: wählt für aktive Kampagnen so viele Nummern gleichzeitig, wie freie Agenten × Wählfaktor ergeben. */
export async function predictiveTick(db: Db, tenantId: number, appUrl: string, now = new Date()) {
  const settings = await ensureTelephonySettings(db, tenantId);
  const campaigns = await db.select().from(dialerCampaigns).where(and(eq(dialerCampaigns.tenantId, tenantId), eq(dialerCampaigns.mode, "predictive"), eq(dialerCampaigns.status, "aktiv")));
  const summary = { dialed: 0, connected: 0, abandoned: 0, campaigns: campaigns.length };
  const base = appUrl.replace(/\/+$/, "");
  for (const campaign of campaigns) {
    if (!withinWindow(campaign.callWindow ?? settings.callWindow, now)) continue;
    const ready = await db.select().from(agentSessions).where(and(eq(agentSessions.tenantId, tenantId), eq(agentSessions.campaignId, campaign.id), eq(agentSessions.status, "bereit"), isNull(agentSessions.endedAt)));
    // Wartende Kunden zuerst an freie Agenten vermitteln
    const waiting = await db.select().from(dialerCalls).where(and(eq(dialerCalls.campaignId, campaign.id), eq(dialerCalls.status, "wartet"))).orderBy(asc(dialerCalls.answeredAt));
    for (const call of waiting) {
      const agent = ready.shift();
      if (!agent) { if (call.answeredAt && now.getTime() - call.answeredAt.getTime() > 5000) { await abandonCall(db, tenantId, call, base); summary.abandoned += 1; } continue; }
      await connectWaitingCall(db, tenantId, call, agent, base); summary.connected += 1;
    }
    if (!ready.length) continue;
    const inFlight = (await db.select({ id: dialerCalls.id }).from(dialerCalls).where(and(eq(dialerCalls.campaignId, campaign.id), inArray(dialerCalls.status, ["initiiert", "klingelt"])))).length;
    const recent = await db.select({ status: dialerCalls.status }).from(dialerCalls).where(and(eq(dialerCalls.campaignId, campaign.id), gte(dialerCalls.startedAt, new Date(now.getTime() - 60 * 60_000))));
    const answered = recent.filter((call) => ["verbunden", "beendet", "abgebrochen", "wartet"].includes(call.status)).length; const abandoned = recent.filter((call) => call.status === "abgebrochen").length;
    const abandonRate = answered ? (abandoned / answered) * 100 : 0;
    const configured = Number(campaign.pacingRatio ?? settings.pacingRatio) || 1.5;
    const ratio = abandonRate > Number(settings.maxAbandonRate) ? Math.max(1, configured - 0.5) : configured;
    const target = Math.max(0, Math.ceil(ready.length * ratio) - inFlight);
    if (!target) continue;
    const items = await db.select().from(dialerQueueItems).where(and(eq(dialerQueueItems.campaignId, campaign.id), inArray(dialerQueueItems.status, ["offen", "wiederholen"]), or(isNull(dialerQueueItems.nextAttemptAt), lte(dialerQueueItems.nextAttemptAt, now)))).orderBy(desc(dialerQueueItems.priority), asc(dialerQueueItems.nextAttemptAt), asc(dialerQueueItems.id)).limit(target);
    const { provider } = await providerFor(db, tenantId);
    const number = await callerNumber(db, tenantId, settings, campaign).catch(() => null); if (!number) continue;
    const campaignAutoNotes = await autoNotesForCall(db, tenantId, campaign.id);
    for (const item of items) {
      const inserted = await db.insert(dialerCalls).values({ tenantId, campaignId: campaign.id, queueItemId: item.id, leadId: item.leadId, rawContactId: item.rawContactId, agentUserId: null, mode: "predictive", provider: provider.name, fromNumber: number.e164, toNumber: item.phone, status: "initiiert", autoNotes: campaignAutoNotes });
      const callId = Number(inserted[0]?.insertId) || 0;
      await db.update(dialerQueueItems).set({ status: "waehlt", attempts: sql`${dialerQueueItems.attempts} + 1`, lastCallId: callId }).where(eq(dialerQueueItems.id, item.id));
      try {
        const result = await provider.originateCall({ to: item.phone, from: number.e164, answerUrl: "", statusCallbackUrl: "", amd: settings.amdEnabled, reference: String(callId) });
        await db.update(dialerCalls).set({ providerCallSid: result.providerCallSid }).where(eq(dialerCalls.id, callId)); summary.dialed += 1;
      } catch (error) { await finishCall(db, tenantId, callId, { status: "fehlgeschlagen", note: error instanceof Error ? error.message : "Fehler" }); }
    }
    if (provider.name === "simulation") await processSimulationEvents(db, tenantId);
  }
  return summary;
}

async function connectWaitingCall(db: Db, tenantId: number, call: DialerCall, agent: AgentSession, base: string) {
  await db.update(dialerCalls).set({ agentUserId: agent.userId, status: "verbunden", connectedAt: new Date() }).where(eq(dialerCalls.id, call.id));
  await db.update(agentSessions).set({ status: "im_gespraech", currentCallId: call.id, lastActivityAt: new Date() }).where(eq(agentSessions.id, agent.id));
  if (call.queueItemId) await db.update(dialerQueueItems).set({ status: "verbunden", lockedByUserId: agent.userId }).where(eq(dialerQueueItems.id, call.queueItemId));
  void base; // Predictive läuft nur noch in der Simulation – der Kunde gilt mit der Zuteilung als verbunden
}

async function abandonCall(db: Db, tenantId: number, call: DialerCall, base: string) {
  void base;
  await finishCall(db, tenantId, call.id, { status: "abgebrochen", note: "Kein Agent frei – Anruf beendet, Wiedervorlage mit Vorrang." });
}

/* ------------------------------------------------------------------ Ereignisse vom Anbieter */

const mapStatus = (status: string): DialerCall["status"] | null => ({ initiated: "initiiert", queued: "initiiert", ringing: "klingelt", "in-progress": "verbunden", answered: "verbunden", completed: "beendet", busy: "besetzt", "no-answer": "keine_antwort", failed: "fehlgeschlagen", canceled: "abgebrochen" } as Record<string, DialerCall["status"]>)[status] ?? null;

export async function handleStatusEvent(db: Db, input: { providerCallSid?: string | null; callId?: number | null; status: string; durationSeconds?: number | null; leg?: "customer" | "agent" }) {
  const call = await findCall(db, input); if (!call) return null;
  const status = mapStatus(input.status); if (!status) return call;
  if (input.leg === "agent") { if (status === "beendet" || status === "fehlgeschlagen" || status === "keine_antwort" || status === "besetzt") { if (call.status !== "beendet" && (call.mode !== "predictive" || call.status === "verbunden")) return finishCall(db, call.tenantId, call.id, { status: call.status === "verbunden" ? "beendet" : "abgebrochen", durationSeconds: input.durationSeconds ?? null }); } return call; }
  if (status === "klingelt") { await db.update(dialerCalls).set({ status: "klingelt" }).where(eq(dialerCalls.id, call.id)); return call; }
  if (status === "verbunden") {
    const settings = await ensureTelephonySettings(db, call.tenantId);
    if (call.mode === "predictive") { await db.update(dialerCalls).set({ status: settings.amdEnabled ? "klingelt" : "wartet", answeredAt: new Date() }).where(eq(dialerCalls.id, call.id)); if (!settings.amdEnabled) await assignWaitingCall(db, call.tenantId, call.id); }
    else { await db.update(dialerCalls).set({ status: "verbunden", answeredAt: new Date(), connectedAt: new Date() }).where(eq(dialerCalls.id, call.id)); if (call.agentUserId) await db.update(agentSessions).set({ status: "im_gespraech", lastActivityAt: new Date() }).where(eq(agentSessions.userId, call.agentUserId)); if (call.queueItemId) await db.update(dialerQueueItems).set({ status: "verbunden" }).where(eq(dialerQueueItems.id, call.queueItemId)); }
    return call;
  }
  return finishCall(db, call.tenantId, call.id, { status, durationSeconds: input.durationSeconds ?? null });
}

export async function handleAmdEvent(db: Db, input: { providerCallSid?: string | null; callId?: number | null; answeredBy: string }) {
  const call = await findCall(db, input); if (!call) return null;
  const machine = /machine|fax/.test(input.answeredBy);
  await db.update(dialerCalls).set({ amdResult: input.answeredBy }).where(eq(dialerCalls.id, call.id));
  if (machine) return finishCall(db, call.tenantId, call.id, { status: "anrufbeantworter" });
  if (call.mode === "predictive") { await db.update(dialerCalls).set({ status: "wartet", answeredAt: call.answeredAt ?? new Date() }).where(eq(dialerCalls.id, call.id)); await assignWaitingCall(db, call.tenantId, call.id); }
  return call;
}

async function assignWaitingCall(db: Db, tenantId: number, callId: number) {
  const call = (await db.select().from(dialerCalls).where(eq(dialerCalls.id, callId)).limit(1))[0]; if (!call || call.status !== "wartet") return;
  const agent = (await db.select().from(agentSessions).where(and(eq(agentSessions.tenantId, tenantId), eq(agentSessions.campaignId, call.campaignId ?? 0), eq(agentSessions.status, "bereit"), isNull(agentSessions.endedAt))).limit(1))[0];
  if (!agent) return;
  const settings = await ensureTelephonySettings(db, tenantId);
  await connectWaitingCall(db, tenantId, call, agent, (process.env.APP_URL ?? "").replace(/\/+$/, "") || "");
  void settings;
}

export async function handleRecordingEvent(db: Db, input: { providerCallSid?: string | null; callId?: number | null; recordingSid?: string | null; recordingUrl: string; durationSeconds?: number | null }) {
  const call = await findCall(db, input); if (!call) return null;
  await db.update(dialerCalls).set({ recordingSid: input.recordingSid ?? null, recordingUrl: input.recordingUrl }).where(eq(dialerCalls.id, call.id));
  return handOffToEvaluation(db, call.tenantId, call.id);
}

/** Übergabe an die Gesprächsbewertung, sobald Aufzeichnung und Gesprächsende vorliegen. */
async function handOffToEvaluation(db: Db, tenantId: number, callId: number) {
  const call = (await db.select().from(dialerCalls).where(eq(dialerCalls.id, callId)).limit(1))[0]; if (!call || call.callRecordId || !call.recordingUrl || call.status !== "beendet") return call ?? null;
  const settings = await ensureTelephonySettings(db, tenantId);
  const consent = settings.recordWithoutConsent ? true : settings.consentMode === "ansage" ? true : settings.consentMode === "agent_button" ? Boolean(call.consentAt) : false; // „ohne Abfrage“: Einwilligung liegt laut Einstellung bereits vor
  const agent = call.agentUserId ? (await db.select({ name: users.name }).from(users).where(eq(users.id, call.agentUserId)).limit(1))[0] : undefined;
  const campaign = call.campaignId ? (await db.select({ name: dialerCampaigns.name }).from(dialerCampaigns).where(eq(dialerCampaigns.id, call.campaignId)).limit(1))[0] : undefined;
  const result = await ingestInternalCall(db, tenantId, { externalCallId: `dialer-${call.id}`, leadId: call.leadId, rawContactId: call.rawContactId, phone: call.toNumber, agentName: agent?.name ?? null, campaign: campaign?.name ?? `Dialer ${call.mode}`, startedAt: call.startedAt, durationSeconds: call.talkSeconds ?? call.durationSeconds ?? null, recordingUrl: call.recordingUrl, consent, consentSource: consent ? (settings.recordWithoutConsent ? "Einstellung: Aufzeichnung ohne Abfrage (Einwilligung liegt vorab vor)" : settings.consentMode === "ansage" ? "Ansage zu Gesprächsbeginn" : "Agent hat Einwilligung bestätigt") : null, provider: "dialer" });
  if (result?.callId) await db.update(dialerCalls).set({ callRecordId: result.callId, ...(result.leadId && !call.leadId ? { leadId: result.leadId } : {}) }).where(eq(dialerCalls.id, call.id));
  return call;
}

async function findCall(db: Db, input: { providerCallSid?: string | null; callId?: number | null }) {
  if (input.callId) return (await db.select().from(dialerCalls).where(eq(dialerCalls.id, input.callId)).limit(1))[0] ?? null;
  if (input.providerCallSid) return (await db.select().from(dialerCalls).where(eq(dialerCalls.providerCallSid, input.providerCallSid)).limit(1))[0] ?? null;
  return null;
}

/** Schließt einen Anruf ab: Status, Dauer, Wählliste (erledigt/wiederholen), Agent in die Nachbereitung, Bewertung anstoßen. */
export async function finishCall(db: Db, tenantId: number, callId: number, input: { status: DialerCall["status"]; durationSeconds?: number | null; note?: string }) {
  const call = (await db.select().from(dialerCalls).where(eq(dialerCalls.id, callId)).limit(1))[0]; if (!call) return null;
  const now = new Date();
  const talkSeconds = call.connectedAt ? Math.max(0, Math.round((now.getTime() - call.connectedAt.getTime()) / 1000)) : null;
  await db.update(dialerCalls).set({ status: input.status, endedAt: now, durationSeconds: input.durationSeconds ?? Math.round((now.getTime() - call.startedAt.getTime()) / 1000), talkSeconds: input.status === "beendet" ? (input.durationSeconds ?? talkSeconds) : talkSeconds, notes: input.note ? `${call.notes ? `${call.notes}\n` : ""}${input.note}` : call.notes }).where(eq(dialerCalls.id, call.id));
  const settings = await ensureTelephonySettings(db, tenantId);
  if (call.queueItemId) {
    const item = (await db.select().from(dialerQueueItems).where(eq(dialerQueueItems.id, call.queueItemId)).limit(1))[0];
    if (item) {
      const campaign = call.campaignId ? (await db.select().from(dialerCampaigns).where(eq(dialerCampaigns.id, call.campaignId)).limit(1))[0] : undefined;
      const maxAttempts = campaign?.maxAttempts ?? settings.maxAttempts; const retryMinutes = campaign?.retryMinutes ?? settings.retryMinutes;
      if (input.status === "beendet") await db.update(dialerQueueItems).set({ status: "erledigt", lastResult: "gespräch", lockedByUserId: null }).where(eq(dialerQueueItems.id, item.id));
      else if (RETRY_RESULTS.has(input.status) && item.attempts < maxAttempts) await db.update(dialerQueueItems).set({ status: "wiederholen", lastResult: input.status, nextAttemptAt: new Date(now.getTime() + retryMinutes * 60_000), lockedByUserId: null, priority: input.status === "abgebrochen" ? item.priority + 10 : item.priority }).where(eq(dialerQueueItems.id, item.id));
      else await db.update(dialerQueueItems).set({ status: "erledigt", lastResult: input.status, lockedByUserId: null }).where(eq(dialerQueueItems.id, item.id));
    }
  }
  if (call.agentUserId) await db.update(agentSessions).set({ status: input.status === "beendet" ? "nachbereitung" : "bereit", currentCallId: input.status === "beendet" ? call.id : null, lastActivityAt: now }).where(and(eq(agentSessions.userId, call.agentUserId), eq(agentSessions.currentCallId, call.id)));
  if (call.leadId && input.status !== "beendet") await db.insert(leadStatusEvents).values({ tenantId, leadId: call.leadId, previousStatus: null, nextStatus: (await db.select({ status: leads.status }).from(leads).where(eq(leads.id, call.leadId)).limit(1))[0]?.status ?? "neu", actorUserId: call.agentUserId, note: `Anrufversuch (${call.mode}): ${input.status.replace("_", " ")}${input.note ? ` – ${input.note}` : ""}` });
  await handOffToEvaluation(db, tenantId, call.id);
  if (input.status === "beendet") await writeCallNote(db, tenantId, call.id, "ende").catch(() => null); // automatische Gesprächsnotiz (sofern eingeschaltet)
  // Glocke: jeder Anruf ein Eintrag – das Ergebnis kommt später per setDisposition dazu
  { const minutes = Math.round(((input.status === "beendet" ? (input.durationSeconds ?? talkSeconds) : null) ?? 0) / 60); const agent = call.agentUserId ? (await db.select({ name: users.name }).from(users).where(eq(users.id, call.agentUserId)).limit(1))[0]?.name ?? null : null; const statusText: Record<string, string> = { beendet: "Gespräch geführt", besetzt: "besetzt", keine_antwort: "keine Antwort", anrufbeantworter: "Anrufbeantworter", abgebrochen: "abgebrochen", fehlgeschlagen: "fehlgeschlagen" }; await logActivity(db, tenantId, { kind: "anruf", title: `Anruf an ${call.toNumber}: ${statusText[input.status] ?? input.status}${minutes ? ` (${minutes} Min.)` : ""}`, detail: agent ? `${agent} · ${call.mode}` : call.mode, leadId: call.leadId ?? null, actorUserId: call.agentUserId ?? null, refType: "dialerCall", refId: call.id }); }
  return (await db.select().from(dialerCalls).where(eq(dialerCalls.id, call.id)).limit(1))[0] ?? null;
}

/** Simulation: Ereignisse des simulierten Anbieters wie Webhooks verarbeiten. */
export async function processSimulationEvents(db: Db, tenantId: number) {
  const simulation = simulationFor(tenantId);
  for (const event of simulation.drainEvents()) {
    if (event.kind === "status") await handleStatusEvent(db, { providerCallSid: event.providerCallSid, status: String(event.payload.CallStatus), durationSeconds: event.payload.CallDuration ? Number(event.payload.CallDuration) : null });
    else if (event.kind === "amd") await handleAmdEvent(db, { providerCallSid: event.providerCallSid, answeredBy: String(event.payload.AnsweredBy) });
    else if (event.kind === "recording") await handleRecordingEvent(db, { providerCallSid: event.providerCallSid, recordingSid: String(event.payload.RecordingSid), recordingUrl: String(event.payload.RecordingUrl), durationSeconds: Number(event.payload.RecordingDuration) || null });
  }
}

/** Agent legt auf (Browser/Simulation) oder das Gespräch ist zu Ende. */
export async function endCall(db: Db, tenantId: number, userId: number, callId: number, options: { durationSeconds?: number | null } = {}) {
  const call = (await db.select().from(dialerCalls).where(and(eq(dialerCalls.id, callId), eq(dialerCalls.tenantId, tenantId))).limit(1))[0];
  if (!call) throw new Error("Anruf wurde nicht gefunden.");
  const { provider, settings } = await providerFor(db, tenantId);
  if (provider.name === "simulation") { (provider as SimulationProvider).finishCall(call.providerCallSid ?? "", { durationSeconds: options.durationSeconds ?? undefined, withRecording: settings.recordCalls && call.status === "verbunden" }); await processSimulationEvents(db, tenantId); }
  else if (provider.name === "sipgate") {
    // sipgate: auflegen und den Anruf gleich abschließen – ein später eintreffendes hangup-Ereignis wird ignoriert (Anruf ist dann schon abgeschlossen).
    if (call.providerCallSid && !FINAL_STATUSES.has(call.status)) await provider.hangupCall(call.providerCallSid).catch(() => undefined);
    if (!FINAL_STATUSES.has(call.status)) await finishCall(db, tenantId, call.id, { status: call.status === "verbunden" ? "beendet" : "abgebrochen", durationSeconds: options.durationSeconds ?? null });
  }
  else if (call.providerCallSid && !["beendet", "besetzt", "keine_antwort", "anrufbeantworter", "abgebrochen", "fehlgeschlagen"].includes(call.status)) await provider.hangupCall(call.providerCallSid).catch(() => undefined);
  void userId;
  return callDetail(db, tenantId, callId);
}

export async function markConsent(db: Db, tenantId: number, callId: number, appUrl: string) {
  const call = (await db.select().from(dialerCalls).where(and(eq(dialerCalls.id, callId), eq(dialerCalls.tenantId, tenantId))).limit(1))[0];
  if (!call) throw new Error("Anruf wurde nicht gefunden.");
  await db.update(dialerCalls).set({ consentAt: new Date() }).where(eq(dialerCalls.id, callId));
  const { provider, settings } = await providerFor(db, tenantId);
  if (settings.recordCalls && settings.consentMode === "agent_button" && provider.name !== "simulation" && call.providerCallSid && !call.recordingSid) { const recording = await provider.startRecording(call.providerCallSid, `${appUrl.replace(/\/+$/, "")}/api/telephony/recording?callId=${callId}`, { announcement: false }); await db.update(dialerCalls).set({ recordingSid: recording.recordingSid }).where(eq(dialerCalls.id, callId)); }
  return { success: true as const };
}

export async function setDisposition(db: Db, tenantId: number, userId: number, input: { callId: number; disposition: DispositionKey; notes?: string | null; followUpMinutes?: number | null; categoryId?: number | null }) {
  const call = (await db.select().from(dialerCalls).where(and(eq(dialerCalls.id, input.callId), eq(dialerCalls.tenantId, tenantId))).limit(1))[0];
  if (!call) throw new Error("Anruf wurde nicht gefunden.");
  const definition = DISPOSITIONS.find((item) => item.key === input.disposition)!;
  await db.update(dialerCalls).set({ disposition: input.disposition, notes: input.notes?.trim() || call.notes }).where(eq(dialerCalls.id, call.id));
  // Glocke: Ergebnis an den Anruf-Eintrag hängen (oder anlegen, falls der Anruf ohne Ende-Ereignis lief)
  if (!(await annotateActivity(db, tenantId, { refType: "dialerCall", refId: call.id }, { detail: `Ergebnis: ${definition.label}${input.notes ? ` – ${input.notes.trim().slice(0, 120)}` : ""}`, leadId: call.leadId ?? null }))) await logActivity(db, tenantId, { kind: "anruf", title: `Anruf an ${call.toNumber}: ${definition.label}`, detail: input.notes?.trim().slice(0, 200) || null, leadId: call.leadId ?? null, actorUserId: userId, refType: "dialerCall", refId: call.id });
  // Rohdaten-Kontakt: erst jetzt entscheidet sich, ob daraus ein Lead wird
  if (call.rawContactId && !call.leadId) {
    if (definition.leadStatus === "genehmigt") { const converted = await convertRawContact(db, tenantId, call.rawContactId, { actorUserId: userId, initialStatus: "genehmigt", note: `Anruf-Ergebnis: ${definition.label}`, categoryId: input.categoryId ?? null }); call.leadId = converted.leadId; await db.update(dialerCalls).set({ leadId: converted.leadId }).where(eq(dialerCalls.id, call.id)); if (call.callRecordId) await db.update(callRecords).set({ leadId: converted.leadId }).where(eq(callRecords.id, call.callRecordId)); }
    else if (definition.leadStatus === "deaktiviert" || definition.leadStatus === "fehlerhaft") await db.update(rawContacts).set({ status: "verworfen", note: `Anruf-Ergebnis: ${definition.label}` }).where(eq(rawContacts.id, call.rawContactId));
  }
  if (call.queueItemId) {
    const settings = await ensureTelephonySettings(db, tenantId);
    if (input.disposition === "wiedervorlage" || input.disposition === "nicht_erreicht") await db.update(dialerQueueItems).set({ status: "wiederholen", lastResult: input.disposition, nextAttemptAt: new Date(Date.now() + (input.followUpMinutes ?? settings.retryMinutes) * 60_000), lockedByUserId: null }).where(eq(dialerQueueItems.id, call.queueItemId));
    else await db.update(dialerQueueItems).set({ status: input.disposition === "nicht_anrufen" || input.disposition === "falsche_nummer" ? "ausgeschlossen" : "erledigt", lastResult: input.disposition, lockedByUserId: null }).where(eq(dialerQueueItems.id, call.queueItemId));
  }
  if (call.leadId) {
    const lead = (await db.select().from(leads).where(eq(leads.id, call.leadId)).limit(1))[0];
    if (lead) {
      const nextStatus = definition.leadStatus && !["zugewiesen", "reklamiert"].includes(lead.status) ? definition.leadStatus : lead.status;
      const meta = lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata) ? (lead.metadata as Record<string, unknown>) : {};
      await db.update(leads).set({ status: nextStatus as typeof lead.status, metadata: { ...meta, lastCallDisposition: input.disposition, lastCallAt: new Date().toISOString(), ...(input.disposition === "nicht_anrufen" ? { doNotCall: true } : {}) } }).where(eq(leads.id, lead.id));
      await db.insert(leadStatusEvents).values({ tenantId, leadId: lead.id, previousStatus: lead.status, nextStatus: nextStatus as typeof lead.status, actorUserId: userId, note: `Anruf-Ergebnis: ${definition.label}${input.notes ? ` – ${input.notes.slice(0, 200)}` : ""}` });
      if (nextStatus !== lead.status && nextStatus === "genehmigt") await triggerLeadAutomations(db, { tenantId, actorUserId: userId, leadId: lead.id, triggerType: "status_geändert" });
      // Pipeline-Automatik: Wiedervorlage/Aufgabe anlegen, Serie je Anruf-Ergebnis (z. B. „Interessiert“ → Angebots-Mail)
      try { const { onDisposition } = await import("./pipeline-extras"); await onDisposition(db, tenantId, { leadId: lead.id, disposition: input.disposition, followUpMinutes: input.followUpMinutes ?? null, actorUserId: userId }); } catch (error) { console.error("[Pipeline] Automatik nach Anruf-Ergebnis:", error instanceof Error ? error.message : error); }
    }
  }
  await db.update(agentSessions).set({ status: "bereit", currentCallId: null, lastActivityAt: new Date() }).where(and(eq(agentSessions.userId, userId), eq(agentSessions.tenantId, tenantId)));
  await writeCallNote(db, tenantId, call.id, "ergebnis").catch(() => null); // Notiz um Ergebnis und Agenten-Notiz ergänzen
  return callDetail(db, tenantId, call.id);
}

export async function callDetail(db: Db, tenantId: number, callId: number) {
  const row = (await db.select({ call: dialerCalls, publicId: leads.publicId, firstName: leads.firstName, lastName: leads.lastName, city: leads.city, leadStatus: leads.status, metadata: leads.metadata, agent: users.name, evaluation: callRecords, rawFirst: rawContacts.firstName, rawLast: rawContacts.lastName, rawCompany: rawContacts.company, rawCity: rawContacts.city, rawStatus: rawContacts.status }).from(dialerCalls).leftJoin(leads, eq(leads.id, dialerCalls.leadId)).leftJoin(users, eq(users.id, dialerCalls.agentUserId)).leftJoin(callRecords, eq(callRecords.id, dialerCalls.callRecordId)).leftJoin(rawContacts, eq(rawContacts.id, dialerCalls.rawContactId)).where(and(eq(dialerCalls.id, callId), eq(dialerCalls.tenantId, tenantId))).limit(1))[0];
  if (!row) return null;
  const rawBatch = row.call.rawContactId ? (await db.select({ batch: rawBatches }).from(rawContacts).innerJoin(rawBatches, eq(rawBatches.id, rawContacts.batchId)).where(eq(rawContacts.id, row.call.rawContactId)).limit(1))[0]?.batch : undefined;
  const rawContactCategoryId = row.call.rawContactId ? (await db.select({ categoryId: rawContacts.categoryId }).from(rawContacts).where(eq(rawContacts.id, row.call.rawContactId)).limit(1))[0]?.categoryId ?? null : null;
  return { ...row.call, lead: row.publicId ? { publicId: row.publicId, name: [row.firstName, row.lastName].filter(Boolean).join(" "), city: row.city, status: row.leadStatus, metadata: row.metadata } : null, rawContact: row.call.rawContactId ? { id: row.call.rawContactId, name: [row.rawFirst, row.rawLast].filter(Boolean).join(" ") || row.rawCompany || "Rohdaten-Kontakt", company: row.rawCompany, city: row.rawCity, status: row.rawStatus, categoryId: rawContactCategoryId, categoryIds: rawBatch ? batchCategoryIds(rawBatch) : [] } : null, agentName: row.agent, evaluation: row.evaluation ? { id: row.evaluation.id, score: row.evaluation.score, verdict: row.evaluation.verdict, decision: row.evaluation.decision, status: row.evaluation.status } : null };
}

export async function listCalls(db: Db, tenantId: number, filter: { campaignId?: number | null; limit?: number } = {}) {
  const conditions = [eq(dialerCalls.tenantId, tenantId)]; if (filter.campaignId) conditions.push(eq(dialerCalls.campaignId, filter.campaignId));
  const rows = await db.select({ call: dialerCalls, publicId: leads.publicId, firstName: leads.firstName, lastName: leads.lastName, agent: users.name, campaign: dialerCampaigns.name, score: callRecords.score, verdict: callRecords.verdict, rawFirst: rawContacts.firstName, rawLast: rawContacts.lastName, rawCompany: rawContacts.company }).from(dialerCalls).leftJoin(leads, eq(leads.id, dialerCalls.leadId)).leftJoin(users, eq(users.id, dialerCalls.agentUserId)).leftJoin(dialerCampaigns, eq(dialerCampaigns.id, dialerCalls.campaignId)).leftJoin(callRecords, eq(callRecords.id, dialerCalls.callRecordId)).leftJoin(rawContacts, eq(rawContacts.id, dialerCalls.rawContactId)).where(and(...conditions)).orderBy(desc(dialerCalls.startedAt)).limit(filter.limit ?? 200);
  return rows.map(({ call, publicId, firstName, lastName, agent, campaign, score, verdict, rawFirst, rawLast, rawCompany }) => ({ ...call, leadPublicId: publicId, leadName: [firstName, lastName].filter(Boolean).join(" ") || (call.rawContactId ? `${[rawFirst, rawLast].filter(Boolean).join(" ") || rawCompany || "Rohdaten"} (Rohdaten)` : null), agentName: agent, campaignName: campaign, score, verdict }));
}

/** Nachbereitung abgelaufen → Agent wieder bereit (Zeitplaner). */
export async function releaseWrapUps(db: Db, tenantId: number, now = new Date()) {
  const settings = await ensureTelephonySettings(db, tenantId);
  const sessions = await db.select().from(agentSessions).where(and(eq(agentSessions.tenantId, tenantId), eq(agentSessions.status, "nachbereitung"), isNull(agentSessions.endedAt)));
  let released = 0;
  for (const session of sessions) { if (now.getTime() - session.lastActivityAt.getTime() >= settings.wrapUpSeconds * 1000) { await db.update(agentSessions).set({ status: "bereit", currentCallId: null, lastActivityAt: now }).where(eq(agentSessions.id, session.id)); released += 1; } }
  return { released };
}

/* ------------------------------------------------------------------ sipgate */
const SIPGATE_OPEN = ["initiiert", "klingelt", "verbunden"] as const;
const sipgateEventSeen = new Map<number, number>(); // Mandant → Zeitpunkt des letzten Webhook-Ereignisses
const sipgateMisses = new Map<number, number>();    // Anruf-ID → wie oft er in Folge nicht mehr in der Liste der aktiven Anrufe war
const sipgateReconciledAt = new Map<number, number>();
const sipgateWebhooksActive = (settings: TelephonySettings, tenantId: number) => Boolean(settings.sipgateWebhookAt) || Date.now() - (sipgateEventSeen.get(tenantId) ?? 0) < 24 * 60 * 60_000;

/** Verbindung prüfen: Token testen, System (classic/neo) und Benutzer-ID merken, Geräte, Rufnummern und den Stand der Webhooks zeigen. */
export async function sipgateCheck(db: Db, tenantId: number, appUrl: string) {
  const settings = await ensureTelephonySettings(db, tenantId);
  const probe = sipgateFor(settings);
  const info = await probe.userInfo();
  const system = await probe.detectSystem();
  await db.update(telephonySettings).set({ sipgateUserId: info.userId, sipgateSystem: system }).where(eq(telephonySettings.id, settings.id));
  const provider = sipgateFor({ ...settings, sipgateUserId: info.userId, sipgateSystem: system });
  const problems: string[] = [];
  const devices = await provider.devices(info.userId).catch((error: Error) => { problems.push(`Geräte: ${error.message}`); return []; });
  const numbers = await provider.numbers().catch((error: Error) => { problems.push(`Rufnummern: ${error.message}`); return []; });
  const webhooks = await provider.webhookSettings().catch((error: Error) => { problems.push(`Webhooks: ${error.message}`); return null; });
  const known = new Set((await db.select({ e164: phoneNumbers.e164 }).from(phoneNumbers).where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "aktiv")))).map((row) => row.e164));
  const webhookUrl = sipgateWebhookUrl(appUrl.replace(/\/+$/, ""), tenantId, settings.webhookSecret);
  return {
    ok: true as const, userId: info.userId, masterSipId: info.masterSipId, system,
    devices, numbers: numbers.map((number) => ({ ...number, imported: known.has(number.e164) })),
    webhooks: webhooks ? { configured: webhooks.outgoingUrl === webhookUrl, outgoingUrl: webhooks.outgoingUrl, incomingUrl: webhooks.incomingUrl } : null,
    webhookUrl, problems,
  };
}

/** Rufnummern des sipgate-Kontos in die Software übernehmen (als Absender für Anrufe und SMS). */
export async function sipgateImportNumbers(db: Db, tenantId: number) {
  const settings = await ensureTelephonySettings(db, tenantId);
  const provider = sipgateFor(settings);
  const numbers = await provider.numbers();
  const existing = await db.select().from(phoneNumbers).where(eq(phoneNumbers.tenantId, tenantId));
  let imported = 0;
  for (const number of numbers) {
    const country = number.e164.startsWith("+43") ? "AT" : number.e164.startsWith("+41") ? "CH" : "DE";
    const found = existing.find((row) => row.e164 === number.e164);
    if (found) { if (found.status !== "aktiv" || found.provider !== "sipgate") await db.update(phoneNumbers).set({ status: "aktiv", releasedAt: null, provider: "sipgate", providerSid: number.id, friendlyName: number.localized, region: number.endpointAlias }).where(eq(phoneNumbers.id, found.id)); continue; }
    await db.insert(phoneNumbers).values({ tenantId, provider: "sipgate", providerSid: number.id, e164: number.e164, country, numberType: number.type === "MOBILE" ? "mobil" : "lokal", friendlyName: number.localized, region: number.endpointAlias, monthlyPrice: null, currency: "EUR", status: "aktiv" });
    imported += 1;
  }
  // Standard-Rufnummer: bei sipgate muss die angezeigte Nummer zum sipgate-Konto gehören – sonst nimmt sipgate den Anruf nicht an.
  const currentDefault = settings.defaultNumberId ? (await db.select({ provider: phoneNumbers.provider, status: phoneNumbers.status }).from(phoneNumbers).where(eq(phoneNumbers.id, settings.defaultNumberId)).limit(1))[0] : undefined;
  if (!currentDefault || currentDefault.provider !== "sipgate" || currentDefault.status !== "aktiv") { const firstNumber = (await db.select({ id: phoneNumbers.id }).from(phoneNumbers).where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "aktiv"), eq(phoneNumbers.provider, "sipgate"))).orderBy(asc(phoneNumbers.id)).limit(1))[0]; if (firstNumber) await db.update(telephonySettings).set({ defaultNumberId: firstNumber.id }).where(eq(telephonySettings.id, settings.id)); }
  return { imported, total: numbers.length };
}

/** Geräte des sipgate-Benutzers (für die Auswahl beim Start der Dialer-Sitzung). */
export async function sipgateDevices(db: Db, tenantId: number) {
  const settings = await ensureTelephonySettings(db, tenantId);
  if (settings.provider !== "sipgate") return [];
  return sipgateFor(settings).devices(settings.sipgateUserId ?? "w0");
}

/** Webhook-Adresse der Software bei sipgate eintragen (Push-API: Ereignisse für ein- und ausgehende Anrufe). */
export async function sipgateSetupWebhooks(db: Db, tenantId: number, appUrl: string) {
  const settings = await ensureTelephonySettings(db, tenantId);
  const url = sipgateWebhookUrl(appUrl.replace(/\/+$/, ""), tenantId, settings.webhookSecret);
  if (!/^https:\/\//.test(url)) throw new Error("sipgate nimmt nur https-Adressen an – die Software muss öffentlich über https erreichbar sein (APP_URL).");
  await sipgateFor(settings).saveWebhookSettings({ incomingUrl: url, outgoingUrl: url, log: true, whitelist: null });
  await db.update(telephonySettings).set({ sipgateWebhookAt: new Date() }).where(eq(telephonySettings.id, settings.id));
  return { url };
}

/** Aufzeichnung über sipgate starten, wenn die Einstellungen das vorsehen (Ansage oder „ohne Abfrage“); per Klick läuft über markConsent. */
async function startSipgateRecordingIfWanted(db: Db, settings: TelephonySettings, call: DialerCall) {
  if (!settings.recordCalls || call.recordingSid || !call.providerCallSid || /^(session|pending):/.test(call.providerCallSid)) return;
  if (!(settings.recordWithoutConsent || settings.consentMode === "ansage")) return;
  const provider = sipgateFor(settings);
  const recording = await provider.startRecording(call.providerCallSid, "", { announcement: !settings.recordWithoutConsent && settings.consentMode === "ansage" }).catch((error: Error) => { console.error(`[sipgate] Aufzeichnung für Anruf ${call.id} nicht gestartet:`, error.message); return null; });
  if (recording) await db.update(dialerCalls).set({ recordingSid: recording.recordingSid }).where(eq(dialerCalls.id, call.id));
}

/** Push-API-Ereignis von sipgate (newCall/answer/hangup) auf unseren Anruf abbilden. Antwort ist das XML für sipgate. */
export async function handleSipgateEvent(db: Db, tenantId: number, body: Record<string, unknown>, base: string): Promise<{ xml: string; event: SipgateEvent; callId: number | null }> {
  const { parseSipgateEvent: parse, sipgateResponseXml, sipgateEmptyXml } = await import("./sipgate-provider");
  const event = parse(body);
  const settings = await ensureTelephonySettings(db, tenantId);
  sipgateEventSeen.set(tenantId, Date.now());
  const eventUrl = sipgateWebhookUrl(base.replace(/\/+$/, ""), tenantId, settings.webhookSecret);
  if (event.event === "newCall" && event.direction === "in") return { xml: sipgateEmptyXml(), event, callId: null }; // eingehende Anrufe laufen bei sipgate wie gewohnt
  let call = event.callId ? (await db.select().from(dialerCalls).where(and(eq(dialerCalls.tenantId, tenantId), eq(dialerCalls.providerCallSid, event.callId))).limit(1))[0] ?? null : null;
  if (!call) {
    const candidates = await db.select().from(dialerCalls).where(and(eq(dialerCalls.tenantId, tenantId), eq(dialerCalls.provider, "sipgate"), inArray(dialerCalls.status, [...SIPGATE_OPEN]), gte(dialerCalls.startedAt, new Date(Date.now() - 30 * 60_000)))).orderBy(desc(dialerCalls.id)).limit(10);
    call = candidates.find((row) => sameNumber(row.toNumber, event.to) || sameNumber(row.toNumber, event.answeringNumber)) ?? null;
    if (call && event.callId) { await db.update(dialerCalls).set({ providerCallSid: event.callId }).where(eq(dialerCalls.id, call.id)); call = { ...call, providerCallSid: event.callId }; }
  }
  if (!call) return { xml: sipgateEmptyXml(), event, callId: null }; // nicht unser Anruf (z. B. direkt vom Telefon gewählt)
  const xml = event.event === "newCall" ? sipgateResponseXml({ onAnswer: eventUrl, onHangup: eventUrl }) : sipgateEmptyXml();
  if (FINAL_STATUSES.has(call.status)) return { xml, event, callId: call.id };
  const status = sipgateStatusOf(event); if (!status) return { xml, event, callId: call.id };
  await handleStatusEvent(db, { callId: call.id, status, durationSeconds: null });
  if (status === "in-progress") await startSipgateRecordingIfWanted(db, settings, { ...call, providerCallSid: event.callId || call.providerCallSid });
  return { xml, event, callId: call.id };
}

/**
 * Abgleich ohne Webhooks (alle paar Sekunden): Welche unserer sipgate-Anrufe stehen in der Liste der aktiven Anrufe?
 * Taucht ein Anruf auf, kennen wir seine callId; verschwindet er, ist er zu Ende. Ohne Push-API gilt „in der Liste“ als
 * verbunden (sipgate meldet dann nicht, ob der Kunde schon abgenommen hat).
 */
export async function syncSipgateCalls(db: Db, tenantId: number, now = new Date()) {
  const settings = await ensureTelephonySettings(db, tenantId);
  if (settings.provider !== "sipgate") return { checked: 0 };
  const open = await db.select().from(dialerCalls).where(and(eq(dialerCalls.tenantId, tenantId), eq(dialerCalls.provider, "sipgate"), inArray(dialerCalls.status, [...SIPGATE_OPEN]), gte(dialerCalls.startedAt, new Date(now.getTime() - 2 * 60 * 60_000))));
  if (!open.length) return { checked: 0 };
  const provider = sipgateFor(settings);
  const active = await provider.activeCalls().catch(() => null); if (!active) return { checked: 0 };
  const webhooks = sipgateWebhooksActive(settings, tenantId);
  for (const call of open) {
    const match = active.find((item) => (call.providerCallSid && item.callId === call.providerCallSid) || item.participants.some((number) => sameNumber(number, call.toNumber)));
    if (match) {
      sipgateMisses.delete(call.id);
      const patch: Partial<typeof dialerCalls.$inferInsert> = {};
      if (!call.providerCallSid || /^(session|pending):/.test(call.providerCallSid)) patch.providerCallSid = match.callId;
      if (call.status === "initiiert") patch.status = "klingelt";
      if (!webhooks && call.status !== "verbunden") { patch.status = "verbunden"; patch.answeredAt = now; patch.connectedAt = now; if (call.agentUserId) await db.update(agentSessions).set({ status: "im_gespraech", lastActivityAt: now }).where(eq(agentSessions.userId, call.agentUserId)); if (call.queueItemId) await db.update(dialerQueueItems).set({ status: "verbunden" }).where(eq(dialerQueueItems.id, call.queueItemId)); }
      if (Object.keys(patch).length) await db.update(dialerCalls).set(patch).where(eq(dialerCalls.id, call.id));
      if (patch.status === "verbunden" || patch.providerCallSid) await startSipgateRecordingIfWanted(db, settings, { ...call, ...patch, providerCallSid: patch.providerCallSid ?? call.providerCallSid } as DialerCall);
      continue;
    }
    if (call.status === "initiiert") { if (now.getTime() - call.startedAt.getTime() > 90_000) await finishCall(db, tenantId, call.id, { status: "abgebrochen", note: "sipgate: dein Gerät hat nicht abgenommen oder der Anruf kam nicht zustande" }); continue; }
    const misses = (sipgateMisses.get(call.id) ?? 0) + 1; sipgateMisses.set(call.id, misses);
    if (misses >= 2) { sipgateMisses.delete(call.id); await finishCall(db, tenantId, call.id, { status: call.status === "verbunden" ? "beendet" : "keine_antwort" }); }
  }
  return { checked: open.length };
}

/** Fertige Aufzeichnungen aus dem sipgate-Verlauf nachtragen (jede Minute): Datei liegt bei sipgate, die Software reicht sie über eine eigene Adresse weiter. */
export async function reconcileSipgateRecordings(db: Db, tenantId: number, appUrl: string, now = new Date()) {
  const settings = await ensureTelephonySettings(db, tenantId);
  if (settings.provider !== "sipgate") return { updated: 0 };
  if (now.getTime() - (sipgateReconciledAt.get(tenantId) ?? 0) < 55_000) return { updated: 0 };
  sipgateReconciledAt.set(tenantId, now.getTime());
  const pending = (await db.select().from(dialerCalls).where(and(eq(dialerCalls.tenantId, tenantId), eq(dialerCalls.provider, "sipgate"), eq(dialerCalls.status, "beendet"), isNull(dialerCalls.recordingUrl), gte(dialerCalls.startedAt, new Date(now.getTime() - 3 * 60 * 60_000))))).filter((call) => call.recordingSid && call.endedAt && now.getTime() - call.endedAt.getTime() > 20_000);
  if (!pending.length) return { updated: 0 };
  const provider = sipgateFor(settings);
  const since = new Date(Math.min(...pending.map((call) => call.startedAt.getTime())) - 2 * 60_000);
  const entries = await provider.history({ since, until: new Date(now.getTime() + 60_000) }).catch((error: Error) => { console.error("[sipgate] Verlauf nicht lesbar:", error.message); return null; });
  if (!entries) return { updated: 0 };
  const base = appUrl.replace(/\/+$/, ""); let updated = 0;
  for (const call of pending) {
    const entry = entries.filter((item) => item.recordingUrl && sameNumber(item.target, call.toNumber) && Math.abs(item.createdAt.getTime() - call.startedAt.getTime()) < 10 * 60_000).sort((a, b) => Math.abs(a.createdAt.getTime() - call.startedAt.getTime()) - Math.abs(b.createdAt.getTime() - call.startedAt.getTime()))[0];
    if (!entry?.recordingUrl) continue;
    await db.update(dialerCalls).set({ providerRecordingUrl: entry.recordingUrl, ...(entry.durationSeconds && !call.talkSeconds ? { talkSeconds: entry.durationSeconds } : {}) }).where(eq(dialerCalls.id, call.id));
    await handleRecordingEvent(db, { callId: call.id, recordingSid: call.recordingSid, recordingUrl: `${base}/api/telephony/sipgate/recording/${call.id}?secret=${settings.webhookSecret}`, durationSeconds: entry.durationSeconds });
    updated += 1;
  }
  return { updated };
}

/** Aufzeichnung einer sipgate-Datei mit den Zugangsdaten holen (für Wiedergabe und Transkription über die eigene Adresse). */
export async function sipgateRecordingResponse(db: Db, callId: number, secret: string) {
  const call = (await db.select().from(dialerCalls).where(eq(dialerCalls.id, callId)).limit(1))[0]; if (!call?.providerRecordingUrl) return null;
  const settings = await ensureTelephonySettings(db, call.tenantId);
  if (!secret || secret !== settings.webhookSecret) return null;
  return sipgateFor(settings).fetchRecording(call.providerRecordingUrl);
}

/* ------------------------------------------------------------------ Live-Bild für viele Agenten */
/**
 * Alles, was ein Teamleiter braucht, auf einen Blick: wer ist angemeldet, wer spricht gerade mit wem (und wie lange),
 * was haben die Agenten heute geschafft, wie weit sind die Kampagnen – und die zuletzt beendeten Gespräche zum
 * Reinhören (Aufzeichnung und Bewertung). Wird alle paar Sekunden abgefragt.
 */
export async function liveBoard(db: Db, tenantId: number, now = new Date()) {
  const settings = await ensureTelephonySettings(db, tenantId);
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sessions = await listSessions(db, tenantId);
  const today = await db.select({ call: dialerCalls, score: callRecords.score, verdict: callRecords.verdict, agent: users.name, firstName: leads.firstName, lastName: leads.lastName, publicId: leads.publicId, rawFirst: rawContacts.firstName, rawLast: rawContacts.lastName, rawCompany: rawContacts.company, campaign: dialerCampaigns.name })
    .from(dialerCalls).leftJoin(callRecords, eq(callRecords.id, dialerCalls.callRecordId)).leftJoin(users, eq(users.id, dialerCalls.agentUserId)).leftJoin(leads, eq(leads.id, dialerCalls.leadId)).leftJoin(rawContacts, eq(rawContacts.id, dialerCalls.rawContactId)).leftJoin(dialerCampaigns, eq(dialerCampaigns.id, dialerCalls.campaignId))
    .where(and(eq(dialerCalls.tenantId, tenantId), gte(dialerCalls.startedAt, startOfDay))).orderBy(desc(dialerCalls.startedAt)).limit(2000);
  const nameOf = (row: (typeof today)[number]) => [row.firstName, row.lastName].filter(Boolean).join(" ") || [row.rawFirst, row.rawLast].filter(Boolean).join(" ") || row.rawCompany || row.call.toNumber;
  const statsFor = (userId: number) => {
    const mine = today.filter((row) => row.call.agentUserId === userId);
    const reached = mine.filter((row) => row.call.status === "beendet");
    const scored = mine.filter((row) => typeof row.score === "number");
    return { calls: mine.length, reached: reached.length, talkSeconds: mine.reduce((sum, row) => sum + (row.call.talkSeconds ?? 0), 0), appointments: mine.filter((row) => row.call.disposition === "verkauft").length, interested: mine.filter((row) => row.call.disposition === "interessiert").length, averageScore: scored.length ? Math.round(scored.reduce((sum, row) => sum + (row.score ?? 0), 0) / scored.length) : null };
  };
  const agents = await Promise.all(sessions.map(async (session) => {
    const call = session.currentCallId ? today.find((row) => row.call.id === session.currentCallId) ?? null : null;
    const since = session.lastActivityAt;
    return {
      userId: session.userId, name: session.agentName ?? "Agent", initials: (session.agentName ?? "A").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(), status: session.status, mode: session.mode, campaignId: session.campaignId, campaignName: session.campaignName, connection: session.connection, device: session.agentDeviceId ?? session.agentPhone ?? null, startedAt: session.startedAt, sinceSeconds: Math.max(0, Math.round((now.getTime() - since.getTime()) / 1000)),
      call: call ? { id: call.call.id, status: call.call.status, toNumber: call.call.toNumber, contactName: nameOf(call), leadPublicId: call.publicId, startedAt: call.call.startedAt, connectedAt: call.call.connectedAt, seconds: Math.max(0, Math.round((now.getTime() - (call.call.connectedAt ?? call.call.startedAt).getTime()) / 1000)), recording: Boolean(call.call.recordingSid), campaignName: call.campaign } : null,
      today: statsFor(session.userId),
    };
  }));
  // Agenten, die heute telefoniert haben, aber gerade nicht angemeldet sind – damit die Tageszahlen vollständig bleiben
  const offline = Array.from(new Map(today.filter((row) => row.call.agentUserId && !sessions.some((session) => session.userId === row.call.agentUserId)).map((row) => [row.call.agentUserId!, row.agent ?? "Agent"])).entries()).map(([userId, name]) => ({ userId, name, initials: name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(), status: "offline" as const, mode: null, campaignId: null, campaignName: null, connection: null, device: null, startedAt: null, sinceSeconds: 0, call: null, today: statsFor(userId) }));
  const queueRows = await db.select({ campaignId: dialerQueueItems.campaignId, status: dialerQueueItems.status }).from(dialerQueueItems).where(eq(dialerQueueItems.tenantId, tenantId));
  const campaignRows = await db.select().from(dialerCampaigns).where(and(eq(dialerCampaigns.tenantId, tenantId), inArray(dialerCampaigns.status, ["aktiv", "pausiert"])));
  const campaigns = campaignRows.map((campaign) => { const items = queueRows.filter((row) => row.campaignId === campaign.id); const count = (status: string) => items.filter((row) => row.status === status).length; return { id: campaign.id, name: campaign.name, mode: campaign.mode, status: campaign.status, total: items.length, open: count("offen") + count("wiederholen"), dialing: count("waehlt") + count("verbunden"), done: count("erledigt") + count("ausgeschlossen"), agents: sessions.filter((session) => session.campaignId === campaign.id).length }; });
  const recent = today.filter((row) => FINAL_STATUSES.has(row.call.status)).slice(0, 15).map((row) => ({ id: row.call.id, agentName: row.agent, contactName: nameOf(row), leadPublicId: row.publicId, toNumber: row.call.toNumber, status: row.call.status, endedAt: row.call.endedAt, talkSeconds: row.call.talkSeconds, disposition: row.call.disposition, recordingUrl: row.call.recordingUrl, recordingPending: Boolean(row.call.recordingSid && !row.call.recordingUrl), score: row.score, verdict: row.verdict, campaignName: row.campaign, summary: row.call.summary }));
  const totals = { agents: sessions.length, talking: sessions.filter((session) => session.status === "im_gespraech").length, ready: sessions.filter((session) => session.status === "bereit").length, dialing: sessions.filter((session) => session.status === "waehlt").length, paused: sessions.filter((session) => session.status === "pause" || session.status === "nachbereitung").length, callsToday: today.length, reachedToday: today.filter((row) => row.call.status === "beendet").length, appointmentsToday: today.filter((row) => row.call.disposition === "verkauft").length, talkSecondsToday: today.reduce((sum, row) => sum + (row.call.talkSeconds ?? 0), 0) };
  return { now, provider: settings.provider, agents: [...agents, ...offline], campaigns, recent, totals };
}

/** Teamleiter steuert einen Agenten: Pause, wieder bereit, abmelden (nicht während eines Gesprächs), Kampagne wechseln. */
export async function superviseAgent(db: Db, tenantId: number, input: { userId: number; action: "pause" | "bereit" | "offline" | "kampagne"; campaignId?: number | null }) {
  const session = (await db.select().from(agentSessions).where(and(eq(agentSessions.userId, input.userId), eq(agentSessions.tenantId, tenantId), isNull(agentSessions.endedAt))).limit(1))[0];
  if (!session) throw new Error("Dieser Agent hat gerade keine Sitzung.");
  if (input.action === "kampagne") { const campaign = input.campaignId ? (await db.select({ id: dialerCampaigns.id }).from(dialerCampaigns).where(and(eq(dialerCampaigns.tenantId, tenantId), eq(dialerCampaigns.id, input.campaignId))).limit(1))[0] : null; if (input.campaignId && !campaign) throw new Error("Kampagne nicht gefunden."); await db.update(agentSessions).set({ campaignId: campaign?.id ?? null, lastActivityAt: new Date() }).where(eq(agentSessions.id, session.id)); return { success: true as const }; }
  if (session.status === "im_gespraech" || session.status === "waehlt") throw new Error("Der Agent telefoniert gerade – bitte warten, bis das Gespräch zu Ende ist.");
  await db.update(agentSessions).set({ status: input.action === "offline" ? "offline" : input.action, lastActivityAt: new Date(), endedAt: input.action === "offline" ? new Date() : null, currentCallId: input.action === "bereit" ? null : session.currentCallId }).where(eq(agentSessions.id, session.id));
  return { success: true as const };
}
