/**
 * Dialer: manuell, Power (alle Nummern nacheinander) und Predictive (mehrere Anrufe gleichzeitig, Verbindung an freie Agenten).
 * Anrufe laufen über den Telefonie-Anbieter (Twilio oder Simulation); Ereignisse (klingelt, verbunden, beendet,
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
import { SimulationProvider, TwilioProvider, simulationFor, type NumberSearch, type TelephonyProvider, type TwilioCredentials } from "./telephony-provider";

export { DISPOSITIONS } from "../shared/dialer";
import { DISPOSITIONS } from "../shared/dialer";
export type DispositionKey = (typeof DISPOSITIONS)[number]["key"];
const RETRY_RESULTS = new Set(["besetzt", "keine_antwort", "anrufbeantworter", "abgebrochen", "fehlgeschlagen", "nicht_erreicht", "wiedervorlage"]);
const DEFAULT_WINDOW = { weekdays: [1, 2, 3, 4, 5], from: "09:00", to: "19:00" };

export const normalizePhone = (value: string) => { const digits = value.replace(/[^\d+]/g, ""); if (digits.startsWith("+")) return digits; if (digits.startsWith("00")) return `+${digits.slice(2)}`; if (digits.startsWith("0")) return `+49${digits.slice(1)}`; return `+${digits}`; };

/* ------------------------------------------------------------------ Einstellungen & Anbieter */

export async function ensureTelephonySettings(db: Db, tenantId: number): Promise<TelephonySettings> {
  const existing = (await db.select().from(telephonySettings).where(eq(telephonySettings.tenantId, tenantId)).limit(1))[0];
  if (existing) return existing;
  await db.insert(telephonySettings).values({ tenantId, webhookSecret: nanoid(32), announcement: "Guten Tag. Dieses Gespräch wird zur Qualitätssicherung aufgezeichnet. Wenn Sie damit nicht einverstanden sind, sagen Sie es bitte.", callWindow: DEFAULT_WINDOW });
  return (await db.select().from(telephonySettings).where(eq(telephonySettings.tenantId, tenantId)).limit(1))[0];
}

function credentialsOf(settings: TelephonySettings): TwilioCredentials | null { if (!settings.credentialsEncrypted) return null; try { return JSON.parse(decryptIntegrationSecret(settings.credentialsEncrypted)) as TwilioCredentials; } catch { return null; } }

export async function providerFor(db: Db, tenantId: number, fetchImpl?: typeof fetch): Promise<{ provider: TelephonyProvider; settings: TelephonySettings }> {
  const settings = await ensureTelephonySettings(db, tenantId);
  if (settings.provider === "twilio") { const credentials = credentialsOf(settings); if (!credentials?.accountSid || !credentials.authToken) throw new Error("Twilio-Zugangsdaten fehlen (Telefonie → Einstellungen)."); return { provider: new TwilioProvider(credentials, fetchImpl), settings }; }
  return { provider: simulationFor(tenantId), settings };
}

export async function getTelephonySettings(db: Db, tenantId: number, appUrl: string) {
  const settings = await ensureTelephonySettings(db, tenantId);
  const credentials = credentialsOf(settings);
  const numbers = await db.select().from(phoneNumbers).where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "aktiv"))).orderBy(asc(phoneNumbers.id));
  const base = appUrl.replace(/\/+$/, "");
  return { ...settings, credentialsEncrypted: undefined, credentials: { accountSid: credentials?.accountSid ?? settings.accountSid ?? "", authToken: credentials?.authToken ? "••••••••" : "", apiKeySid: credentials?.apiKeySid ?? "", apiKeySecret: credentials?.apiKeySecret ? "••••••••" : "", twimlAppSid: credentials?.twimlAppSid ?? settings.twimlAppSid ?? "" }, bundleSids: { DE: "", AT: "", CH: "", ...((settings.bundleSids ?? {}) as Record<string, string>) }, callWindow: { ...DEFAULT_WINDOW, ...((settings.callWindow ?? {}) as Record<string, unknown>) }, numbers, webhooks: { voiceAgent: `${base}/api/telephony/voice/agent`, voiceInbound: `${base}/api/telephony/voice/inbound`, status: `${base}/api/telephony/status` }, dispositions: DISPOSITIONS };
}

export async function saveTelephonySettings(db: Db, tenantId: number, input: { provider: "simulation" | "twilio"; credentials: { accountSid: string; authToken: string; apiKeySid: string; apiKeySecret: string; twimlAppSid: string }; addressSid: string; bundleSids: Record<string, string>; defaultNumberId: number | null; agentConnection: "browser" | "telefon"; autoCallNotes?: boolean; recordWithoutConsent?: boolean; announcement: string; consentMode: "ansage" | "agent_button" | "keine"; recordCalls: boolean; amdEnabled: boolean; maxAttempts: number; retryMinutes: number; wrapUpSeconds: number; pacingRatio: number; maxAbandonRate: number; callWindow: { weekdays: number[]; from: string; to: string } }) {
  const settings = await ensureTelephonySettings(db, tenantId);
  const previous = credentialsOf(settings);
  const credentials: TwilioCredentials = { accountSid: input.credentials.accountSid.trim(), authToken: input.credentials.authToken === "••••••••" ? previous?.authToken ?? "" : input.credentials.authToken.trim(), apiKeySid: input.credentials.apiKeySid.trim() || undefined, apiKeySecret: input.credentials.apiKeySecret === "••••••••" ? previous?.apiKeySecret : input.credentials.apiKeySecret.trim() || undefined, twimlAppSid: input.credentials.twimlAppSid.trim() || undefined };
  await db.update(telephonySettings).set({ provider: input.provider, autoCallNotes: input.autoCallNotes ?? settings.autoCallNotes, recordWithoutConsent: input.recordWithoutConsent ?? settings.recordWithoutConsent, accountSid: credentials.accountSid || null, credentialsEncrypted: credentials.accountSid || credentials.authToken ? encryptIntegrationSecret(JSON.stringify(credentials)) : null, twimlAppSid: credentials.twimlAppSid ?? null, addressSid: input.addressSid.trim() || null, bundleSids: input.bundleSids, defaultNumberId: input.defaultNumberId, agentConnection: input.agentConnection, announcement: input.announcement, consentMode: input.consentMode, recordCalls: input.recordCalls, amdEnabled: input.amdEnabled, maxAttempts: input.maxAttempts, retryMinutes: input.retryMinutes, wrapUpSeconds: input.wrapUpSeconds, pacingRatio: input.pacingRatio.toFixed(2), maxAbandonRate: input.maxAbandonRate.toFixed(2), callWindow: input.callWindow }).where(eq(telephonySettings.id, settings.id));
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
  const bundles = (settings.bundleSids ?? {}) as Record<string, string>;
  if (provider.name === "twilio" && !bundles[input.country]) throw new Error(`Für ${input.country} fehlt das regulatorische Bundle (Bundle-SID) in den Telefonie-Einstellungen. Ohne Bundle vergibt der Anbieter keine ${input.country}-Rufnummern.`);
  if (provider.name === "twilio" && !settings.addressSid) throw new Error("Für den Kauf einer Rufnummer ist die Adresse (Address-SID) des Mandanten beim Anbieter nötig.");
  const base = appUrl.replace(/\/+$/, "");
  const bought = await provider.purchaseNumber(input.e164, { friendlyName: input.friendlyName || `Tanesco ${input.country}`, voiceUrl: `${base}/api/telephony/voice/inbound?tenant=${tenantId}`, statusCallbackUrl: `${base}/api/telephony/status`, country: input.country, addressSid: settings.addressSid, bundleSid: bundles[input.country] });
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

export async function startSession(db: Db, tenantId: number, userId: number, input: { campaignId: number | null; mode: "manuell" | "power" | "predictive"; connection: "browser" | "telefon"; agentPhone?: string | null }) {
  const existing = (await db.select().from(agentSessions).where(eq(agentSessions.userId, userId)).limit(1))[0];
  const values = { tenantId, userId, campaignId: input.campaignId, mode: input.mode, status: "bereit" as const, connection: input.connection, agentPhone: input.agentPhone ? normalizePhone(input.agentPhone) : null, currentCallId: null, lastActivityAt: new Date(), startedAt: new Date(), endedAt: null };
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

export type ConnectInstruction = { callId: number; mode: "manuell" | "power" | "predictive"; connection: "browser" | "telefon" | "simulation"; params: Record<string, string> };

/** Baut den Anruf für einen Agenten auf (manuell oder nächster Eintrag der Wählliste). */
async function createAgentCall(db: Db, tenantId: number, session: AgentSession, target: { leadId: number | null; rawContactId?: number | null; phone: string; queueItemId: number | null; campaign: DialerCampaign | null }, appUrl: string): Promise<ConnectInstruction> {
  const { provider, settings } = await providerFor(db, tenantId);
  const number = await callerNumber(db, tenantId, settings, target.campaign);
  const autoNotes = await autoNotesForCall(db, tenantId, target.campaign?.id ?? null);
  const inserted = await db.insert(dialerCalls).values({ tenantId, campaignId: target.campaign?.id ?? null, queueItemId: target.queueItemId, leadId: target.leadId, rawContactId: target.rawContactId ?? null, agentUserId: session.userId, mode: session.mode, provider: provider.name, fromNumber: number.e164, toNumber: target.phone, autoNotes, status: "initiiert" });
  const callId = Number(inserted[0]?.insertId) || 0;
  if (target.queueItemId) await db.update(dialerQueueItems).set({ status: "waehlt", attempts: sql`${dialerQueueItems.attempts} + 1`, lockedByUserId: session.userId, lastCallId: callId }).where(eq(dialerQueueItems.id, target.queueItemId));
  await db.update(agentSessions).set({ status: "waehlt", currentCallId: callId, lastActivityAt: new Date() }).where(eq(agentSessions.id, session.id));
  const base = appUrl.replace(/\/+$/, "");
  if (provider.name === "simulation") {
    const result = await provider.originateCall({ to: target.phone, from: number.e164, answerUrl: "", statusCallbackUrl: "", amd: settings.amdEnabled, reference: String(callId) });
    await db.update(dialerCalls).set({ providerCallSid: result.providerCallSid }).where(eq(dialerCalls.id, callId));
    await processSimulationEvents(db, tenantId);
    return { callId, mode: session.mode, connection: "simulation", params: { callId: String(callId) } };
  }
  if (session.connection === "telefon") {
    if (!session.agentPhone) throw new Error("Für die Verbindung über Telefon fehlt die Rufnummer des Agenten.");
    const result = await provider.originateCall({ to: session.agentPhone, from: number.e164, answerUrl: `${base}/api/telephony/voice/agent?callId=${callId}&secret=${settings.webhookSecret}`, statusCallbackUrl: `${base}/api/telephony/status?leg=agent&callId=${callId}`, amd: false, reference: String(callId) });
    await db.update(dialerCalls).set({ providerCallSid: result.providerCallSid }).where(eq(dialerCalls.id, callId));
    return { callId, mode: session.mode, connection: "telefon", params: { callId: String(callId) } };
  }
  // Browser: das Softphone ruft die TwiML-App auf, der Server antwortet in /voice/agent mit dem Kundenwahlvorgang
  return { callId, mode: session.mode, connection: "browser", params: { callId: String(callId), secret: settings.webhookSecret } };
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
        const result = await provider.originateCall({ to: item.phone, from: number.e164, answerUrl: `${base}/api/telephony/voice/customer?callId=${callId}&secret=${settings.webhookSecret}`, statusCallbackUrl: `${base}/api/telephony/status?callId=${callId}`, amd: settings.amdEnabled, amdCallbackUrl: `${base}/api/telephony/amd?callId=${callId}`, reference: String(callId) });
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
  const { provider, settings } = await providerFor(db, tenantId);
  if (provider.name === "twilio" && call.campaignId) {
    // Agent in die Warteschlange der Kampagne holen (Browser-Client oder Telefon), der wartende Kunde wird verbunden
    const target = agent.connection === "telefon" && agent.agentPhone ? agent.agentPhone : `client:agent-${tenantId}-${agent.userId}`;
    await provider.originateCall({ to: target, from: call.fromNumber ?? "", answerUrl: `${base}/api/telephony/voice/agent-queue?callId=${call.id}&secret=${settings.webhookSecret}`, statusCallbackUrl: `${base}/api/telephony/status?leg=agent&callId=${call.id}`, amd: false, reference: `${call.id}-agent` });
  }
}

async function abandonCall(db: Db, tenantId: number, call: DialerCall, base: string) {
  const { provider, settings } = await providerFor(db, tenantId);
  if (call.providerCallSid && provider.name === "twilio") await provider.redirectCall(call.providerCallSid, `${base}/api/telephony/voice/abandon?secret=${settings.webhookSecret}`).catch(() => undefined);
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
  if (machine) { const { provider } = await providerFor(db, call.tenantId); if (call.providerCallSid && provider.name === "twilio") await provider.hangupCall(call.providerCallSid).catch(() => undefined); return finishCall(db, call.tenantId, call.id, { status: "anrufbeantworter" }); }
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
  else if (call.providerCallSid && !["beendet", "besetzt", "keine_antwort", "anrufbeantworter", "abgebrochen", "fehlgeschlagen"].includes(call.status)) await provider.hangupCall(call.providerCallSid).catch(() => undefined);
  void userId;
  return callDetail(db, tenantId, callId);
}

export async function markConsent(db: Db, tenantId: number, callId: number, appUrl: string) {
  const call = (await db.select().from(dialerCalls).where(and(eq(dialerCalls.id, callId), eq(dialerCalls.tenantId, tenantId))).limit(1))[0];
  if (!call) throw new Error("Anruf wurde nicht gefunden.");
  await db.update(dialerCalls).set({ consentAt: new Date() }).where(eq(dialerCalls.id, callId));
  const { provider, settings } = await providerFor(db, tenantId);
  if (settings.recordCalls && settings.consentMode === "agent_button" && provider.name === "twilio" && call.providerCallSid && !call.recordingSid) { const recording = await provider.startRecording(call.providerCallSid, `${appUrl.replace(/\/+$/, "")}/api/telephony/recording?callId=${callId}`); await db.update(dialerCalls).set({ recordingSid: recording.recordingSid }).where(eq(dialerCalls.id, callId)); }
  return { success: true as const };
}

export async function setDisposition(db: Db, tenantId: number, userId: number, input: { callId: number; disposition: DispositionKey; notes?: string | null; followUpMinutes?: number | null; categoryId?: number | null }) {
  const call = (await db.select().from(dialerCalls).where(and(eq(dialerCalls.id, input.callId), eq(dialerCalls.tenantId, tenantId))).limit(1))[0];
  if (!call) throw new Error("Anruf wurde nicht gefunden.");
  const definition = DISPOSITIONS.find((item) => item.key === input.disposition)!;
  await db.update(dialerCalls).set({ disposition: input.disposition, notes: input.notes?.trim() || call.notes }).where(eq(dialerCalls.id, call.id));
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
