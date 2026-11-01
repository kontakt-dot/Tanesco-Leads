/**
 * Opt-in-Nachweise (§ 7a UWG): Einwilligungen je Lead anlegen, prüfen, bestätigen, widerrufen, verwenden und als Nachweis ausgeben.
 *  - Formular: beim Eingang eines Meta-Leads aus Hinweistext + Häkchen des Formulars (Einwilligung für unseren eigenen Anruf).
 *  - Sprache (Voice-Opt-in): im App-Dialer startet „Opt-in aufnehmen“ die Aufzeichnung nur für den Einwilligungsabschnitt
 *    (sipgate: Aufnahme an/aus während des Gesprächs); der Agent bestätigt die beiden „Ja“, die Abschrift wird – sobald da –
 *    nach Regeln bzw. mit KI geprüft. Aus einer Gesamtaufnahme (externer Dialer) wird die Stelle bei der Freigabe herausgesucht.
 *  - SMS: Bestätigungslink mit Firmennamen (Bundesnetzagentur: SMS ja, E-Mail-Double-Opt-in für Telefon-Einwilligungen nein).
 *  - Widerruf → Sperrliste (E-Mail) und „nicht anrufen“ am Lead; Verwendungen (Zustellung an Käufer) verlängern die Aufbewahrung.
 *  - Nachweis: PDF (jsPDF, wie Verträge) mit Prüfsumme, öffentlich über einen Nachweis-Link für den Käufer.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { callQaConfigs, callRecords, deliveryChains, deliveryStops, dialerCalls, emailSuppressions, leadCategories, leads, optIns, pipelineEvents, rawBatches, rawContacts, tenants, users, type OptInRow } from "../drizzle/schema";
import { allChecked, canonicalOptIn, checkConsentText, consentQuote, consentScript, countYes, DEFAULT_OPT_IN_SETTINGS, EMPTY_CHECKS, missingOf, newOptInNumber, normalizeOptInSettings, retainUntil, smsText, statusFromChecks, type OptInChecks, type OptInGrantee, type OptInKind, type OptInSettings, type OptInStatus, type OptInUsage, type ScriptValues } from "../shared/opt-in";
import { logActivity } from "./activity";
import type { Db } from "./lead-pipeline";

/* ---------------------------------------------------------------- Einstellungen */
export async function optInSettingsFor(db: Db, tenantId: number): Promise<OptInSettings> {
  const row = (await db.select({ optInSettings: callQaConfigs.optInSettings }).from(callQaConfigs).where(eq(callQaConfigs.tenantId, tenantId)).limit(1))[0];
  const settings = normalizeOptInSettings(row?.optInSettings ?? null);
  if (!settings.companyName) { // Vorgabe: Firmenzeile aus der E-Mail-Signatur, sonst der Name des Mandanten
    try { const { signatureFor } = await import("./mail-settings"); const { companyLines } = await import("../shared/email-signature"); const { context } = await signatureFor(db, tenantId, null); const first = companyLines(context.companyFooter)[0]; if (first) { settings.companyName = first; settings.companyAddress ||= companyLines(context.companyFooter).slice(1, 3).join(", "); } } catch { /* ohne Signatur */ }
    if (!settings.companyName) { const tenant = (await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0]; if (tenant?.name) settings.companyName = tenant.name; }
  }
  return settings;
}
export async function saveOptInSettings(db: Db, tenantId: number, input: unknown): Promise<OptInSettings> {
  const { ensureCallQaConfig } = await import("./call-qa"); const config = await ensureCallQaConfig(db, tenantId);
  const settings = normalizeOptInSettings(input);
  await db.update(callQaConfigs).set({ optInSettings: settings }).where(eq(callQaConfigs.id, config.id));
  return settings;
}

/* ---------------------------------------------------------------- Hilfen */
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const metaOf = (lead: { metadata?: unknown }) => (lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata) ? (lead.metadata as Record<string, unknown>) : {});
const nameOf = (lead: { firstName?: string | null; lastName?: string | null; company?: string | null; publicId?: string }) => [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || lead.company || lead.publicId || "";
const usagesOf = (row: Pick<OptInRow, "usages">): OptInUsage[] => (Array.isArray(row.usages) ? (row.usages as OptInUsage[]) : []);
async function leadFor(db: Db, tenantId: number, ref: { leadId?: number | null; publicId?: string | null }) {
  const where = ref.leadId ? eq(leads.id, ref.leadId) : eq(leads.publicId, String(ref.publicId ?? ""));
  const lead = (await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), where)).limit(1))[0]; if (!lead) throw new Error("Lead nicht gefunden."); return lead;
}
async function categoryName(db: Db, categoryId: number | null | undefined) { if (!categoryId) return null; return (await db.select({ name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.id, categoryId)).limit(1))[0]?.name ?? null; }
async function nextNumber(db: Db, tenantId: number) {
  const row = (await db.select({ count: sql<number>`count(*)` }).from(optIns).where(eq(optIns.tenantId, tenantId)))[0];
  let seq = Number(row?.count ?? 0) + 1; const year = new Date().getFullYear();
  for (let tries = 0; tries < 50; tries += 1) { const number = newOptInNumber(seq); const taken = (await db.select({ id: optIns.id }).from(optIns).where(and(eq(optIns.tenantId, tenantId), eq(optIns.number, number))).limit(1))[0]; if (!taken) return number; seq += 1; }
  return `OPT-${year}-${nanoid(6).toUpperCase()}`;
}
const hashOf = (row: OptInRow) => sha256(canonicalOptIn({ number: row.number, leadId: row.leadId, kind: row.kind, grantedTo: row.grantedTo, buyerName: row.buyerName, consentText: row.consentText, givenAt: row.givenAt, collectedBy: row.collectedBy, quote: row.quote, recordingUrl: row.recordingUrl, confirmedAt: row.confirmedAt, source: row.source }));
async function reseal(db: Db, id: number) { const row = (await db.select().from(optIns).where(eq(optIns.id, id)).limit(1))[0]; if (!row) return null; const hash = hashOf(row); const retain = retainUntil(row.givenAt ?? row.createdAt, row.lastUsedAt); await db.update(optIns).set({ hash, retainUntil: retain }).where(eq(optIns.id, id)); return { ...row, hash, retainUntil: retain }; }
export const optInProofUrl = (appUrl: string, token: string) => `${appUrl.replace(/\/+$/, "")}/api/opt-in/nachweis/${token}.pdf`;
export const optInConfirmUrl = (appUrl: string, token: string) => `${appUrl.replace(/\/+$/, "")}/opt-in/${token}`;

/** Ansicht für die Oberfläche/API – ohne Abschrift, mit Fehlendem und Verwendungen. */
export function optInView(row: OptInRow, appUrl?: string | null) {
  const checks = (row.checks as OptInChecks | null) ?? null;
  return { id: row.id, number: row.number, leadId: row.leadId, kind: row.kind as OptInKind, status: row.status as OptInStatus, grantedTo: row.grantedTo as OptInGrantee, buyerUserId: row.buyerUserId, buyerName: row.buyerName, companyName: row.companyName, consentText: row.consentText, channels: row.channels, givenAt: row.givenAt, collectedBy: row.collectedBy, source: row.source, callRecordId: row.callRecordId, dialerCallId: row.dialerCallId, recordingUrl: row.recordingUrl, recordingStartSec: row.recordingStartSec, recordingEndSec: row.recordingEndSec, hasTranscript: Boolean(row.transcript), quote: row.quote, checks, missing: (row.missing as string[] | null) ?? missingOf(checks), warning: row.warning, attest: row.attest as { aufnahme?: boolean; ja?: boolean; note?: string | null } | null, smsPhone: row.smsPhone, smsSentAt: row.smsSentAt, confirmedAt: row.confirmedAt, confirmIp: row.confirmIp, revokedAt: row.revokedAt, revokeNote: row.revokeNote, usages: usagesOf(row), lastUsedAt: row.lastUsedAt, retainUntil: row.retainUntil, hash: row.hash, proofUrl: row.proofToken && appUrl ? optInProofUrl(appUrl, row.proofToken) : null, createdAt: row.createdAt };
}
export type OptInView = ReturnType<typeof optInView>;
export async function listOptIns(db: Db, tenantId: number, leadRef: { leadId?: number | null; publicId?: string | null }, appUrl?: string | null) {
  const lead = await leadFor(db, tenantId, leadRef);
  const rows = await db.select().from(optIns).where(and(eq(optIns.tenantId, tenantId), eq(optIns.leadId, lead.id))).orderBy(desc(optIns.id));
  return rows.map((row) => optInView(row, appUrl));
}
/** Gibt es für diesen Lead eine gültige Einwilligung für den Fachbetrieb (optional: genau diesen Käufer)? */
export async function validBuyerOptIn(db: Db, tenantId: number, leadId: number, buyer?: { buyerUserId?: number | null; buyerName?: string | null }) {
  const rows = await db.select().from(optIns).where(and(eq(optIns.tenantId, tenantId), eq(optIns.leadId, leadId), eq(optIns.status, "gueltig"), eq(optIns.grantedTo, "kaeufer"))).orderBy(desc(optIns.id));
  if (!buyer || (!buyer.buyerUserId && !buyer.buyerName)) return rows[0] ?? null;
  return rows.find((row) => (buyer.buyerUserId && row.buyerUserId === buyer.buyerUserId) || (buyer.buyerName && row.buyerName && row.buyerName.trim().toLowerCase() === buyer.buyerName.trim().toLowerCase())) ?? null;
}
/** Kurzfassung für Käufer (API, Zustellung): die beste Einwilligung für den Fachbetrieb, sonst die fürs Formular. */
export async function optInSummaryFor(db: Db, tenantId: number, leadId: number, appUrl: string | null, buyer?: { buyerUserId?: number | null; buyerName?: string | null }) {
  const rows = await db.select().from(optIns).where(and(eq(optIns.tenantId, tenantId), eq(optIns.leadId, leadId))).orderBy(desc(optIns.id));
  const forBuyer = buyer ? rows.find((row) => row.grantedTo === "kaeufer" && row.status === "gueltig" && ((buyer.buyerUserId && row.buyerUserId === buyer.buyerUserId) || (buyer.buyerName && row.buyerName?.trim().toLowerCase() === buyer.buyerName.trim().toLowerCase()))) : null;
  const best = forBuyer ?? rows.find((row) => row.grantedTo === "kaeufer" && row.status === "gueltig") ?? rows.find((row) => row.status === "gueltig") ?? rows[0] ?? null;
  if (!best) return null;
  return { number: best.number, kind: best.kind as OptInKind, status: best.status as OptInStatus, grantedTo: best.grantedTo as OptInGrantee, buyerName: best.buyerName, givenAt: best.givenAt, confirmedAt: best.confirmedAt, proofUrl: best.proofToken && appUrl ? optInProofUrl(appUrl, best.proofToken) : null };
}

/* ---------------------------------------------------------------- Käufer-Vorschlag und Skript */
/** Welcher Fachbetrieb bekommt diesen Lead voraussichtlich? Aus den Lieferketten der Kategorie (Priorität, Position), passend zur PLZ. */
export async function suggestedBuyersFor(db: Db, tenantId: number, lead: typeof leads.$inferSelect): Promise<Array<{ buyerUserId: number | null; buyerName: string; chainName: string }>> {
  const chains = await db.select().from(deliveryChains).where(and(eq(deliveryChains.tenantId, tenantId), eq(deliveryChains.categoryId, lead.categoryId))).orderBy(asc(deliveryChains.priority), asc(deliveryChains.id));
  if (!chains.length) return [];
  const stops = await db.select().from(deliveryStops).where(and(inArray(deliveryStops.chainId, chains.map((chain) => chain.id)), eq(deliveryStops.active, true))).orderBy(asc(deliveryStops.position), asc(deliveryStops.id));
  const { stopSkipReason } = await import("./lead-pipeline");
  const context = { now: new Date(), suppliersDelivered: new Set<number>(), conflictBuyerIds: new Set<number>(), stopDeliveries: 0 };
  const out: Array<{ buyerUserId: number | null; buyerName: string; chainName: string }> = []; const seen = new Set<string>();
  for (const chain of chains) for (const stop of stops.filter((item) => item.chainId === chain.id)) {
    if (stopSkipReason(stop as never, lead as never, context)) continue;
    const key = `${stop.buyerUserId ?? ""}|${stop.buyerName.toLowerCase()}`; if (seen.has(key)) continue; seen.add(key);
    out.push({ buyerUserId: stop.buyerUserId ?? null, buyerName: stop.buyerName, chainName: chain.name });
  }
  return out;
}
/** Alle Käufer zur Auswahl: aus allen Lieferketten (Name, ggf. Firma des Nutzers). */
export async function buyerChoices(db: Db, tenantId: number): Promise<Array<{ buyerUserId: number | null; buyerName: string }>> {
  const rows = await db.select({ buyerUserId: deliveryStops.buyerUserId, buyerName: deliveryStops.buyerName, company: users.company }).from(deliveryStops).innerJoin(deliveryChains, eq(deliveryChains.id, deliveryStops.chainId)).leftJoin(users, eq(users.id, deliveryStops.buyerUserId)).where(eq(deliveryChains.tenantId, tenantId));
  const map = new Map<string, { buyerUserId: number | null; buyerName: string }>();
  for (const row of rows) { const name = (row.company?.trim() || row.buyerName).trim(); const key = `${row.buyerUserId ?? ""}|${name.toLowerCase()}`; if (!map.has(key)) map.set(key, { buyerUserId: row.buyerUserId ?? null, buyerName: name }); }
  return Array.from(map.values()).sort((a, b) => a.buyerName.localeCompare(b.buyerName, "de"));
}
async function scriptValuesFor(db: Db, lead: typeof leads.$inferSelect, buyerName: string | null, now = new Date()): Promise<ScriptValues> {
  return { now, name: nameOf(lead), firstName: lead.firstName, phone: lead.phone ?? "", city: lead.city, category: (await categoryName(db, lead.categoryId)) ?? "Ihre Anfrage", buyerName };
}
type LeadRow = typeof leads.$inferSelect;
type OptInTarget = { lead: LeadRow | null; raw: typeof rawContacts.$inferSelect | null; call: typeof dialerCalls.$inferSelect | null };
/**
 * Wen betrifft das Opt-in? Entweder ein Lead (publicId) oder der laufende Anruf im Callcenter-Dialer: dort hängt am Anruf ein Lead –
 * oder nur ein Rohdaten-Kontakt (Liste aus „Rohdaten“), aus dem erst beim Start des Opt-ins ein Lead wird.
 */
async function optInTarget(db: Db, tenantId: number, input: { publicId?: string | null; dialerCallId?: number | null }): Promise<OptInTarget> {
  const call = input.dialerCallId ? (await db.select().from(dialerCalls).where(and(eq(dialerCalls.id, input.dialerCallId), eq(dialerCalls.tenantId, tenantId))).limit(1))[0] ?? null : null;
  if (input.publicId) return { lead: await leadFor(db, tenantId, { publicId: input.publicId }), raw: null, call };
  if (!call) throw new Error("Kein Lead und kein Anruf angegeben.");
  if (call.leadId) return { lead: await leadFor(db, tenantId, { leadId: call.leadId }), raw: null, call };
  const raw = call.rawContactId ? (await db.select().from(rawContacts).where(and(eq(rawContacts.id, call.rawContactId), eq(rawContacts.tenantId, tenantId))).limit(1))[0] ?? null : null;
  if (!raw) throw new Error("Zu diesem Anruf gibt es keinen Kontakt – ein Opt-in braucht einen Lead oder einen Rohdaten-Kontakt.");
  if (raw.leadId) return { lead: await leadFor(db, tenantId, { leadId: raw.leadId }), raw, call };
  return { lead: null, raw, call };
}
/** Rohdaten-Kontakt wie einen Lead behandeln (für Skript und Käufer-Vorschlag), ohne ihn schon anzulegen. */
async function pseudoLeadFromRaw(db: Db, tenantId: number, raw: typeof rawContacts.$inferSelect): Promise<LeadRow> {
  const batch = (await db.select().from(rawBatches).where(eq(rawBatches.id, raw.batchId)).limit(1))[0];
  const categoryId = raw.categoryId ?? batch?.categoryId ?? 0;
  return { id: 0, tenantId, publicId: `Rohdaten #${raw.id}`, firstName: raw.firstName, lastName: raw.lastName, company: raw.company, phone: raw.phone, email: raw.email, postcode: raw.postcode, city: raw.city, country: raw.country, categoryId, status: "neu", metadata: {} } as unknown as LeadRow;
}
/** Rohdaten-Kontakt beim Start des Opt-ins zum Lead machen (Stufe „neu“) und am Anruf verknüpfen – das spätere Anruf-Ergebnis setzt den Status weiter. */
async function leadForOptIn(db: Db, tenantId: number, userId: number | null, target: OptInTarget): Promise<LeadRow> {
  if (target.lead) return target.lead;
  const { convertRawContact } = await import("./raw-data");
  const converted = await convertRawContact(db, tenantId, target.raw!.id, { actorUserId: userId, initialStatus: "neu", note: "Opt-in im Gespräch aufgenommen", deferAutomations: true });
  if (target.call) { await db.update(dialerCalls).set({ leadId: converted.leadId }).where(eq(dialerCalls.id, target.call.id)); if (target.call.callRecordId) await db.update(callRecords).set({ leadId: converted.leadId }).where(eq(callRecords.id, target.call.callRecordId)); }
  return leadFor(db, tenantId, { leadId: converted.leadId });
}
/** Skript-Vorschau für den Dialer: Text mit eingesetztem Käufer, Käufer-Vorschläge aus der Lieferkette, vorhandene Einwilligungen. Ohne Lead (Rohdaten-Kontakt im Callcenter) kommt das Skript aus den Kontaktdaten; `lead.pending` sagt, dass der Lead erst beim Start angelegt wird. */
export async function optInScript(db: Db, tenantId: number, input: { publicId?: string | null; dialerCallId?: number | null; buyerUserId?: number | null; buyerName?: string | null }, appUrl?: string | null) {
  const target = await optInTarget(db, tenantId, input); const settings = await optInSettingsFor(db, tenantId);
  const lead = target.lead ?? await pseudoLeadFromRaw(db, tenantId, target.raw!);
  const suggestions = await suggestedBuyersFor(db, tenantId, lead);
  const chosen = input.buyerName ? { buyerUserId: input.buyerUserId ?? null, buyerName: input.buyerName } : suggestions[0] ?? null;
  const script = consentScript(settings, await scriptValuesFor(db, lead, chosen?.buyerName ?? null));
  const existing = target.lead ? await listOptIns(db, tenantId, { leadId: target.lead.id }, appUrl) : [];
  return { lead: { publicId: target.lead?.publicId ?? null, name: nameOf(lead), phone: lead.phone, city: lead.city, pending: !target.lead }, buyer: chosen, suggestions, choices: await buyerChoices(db, tenantId), settings: { companyName: settings.companyName, revokeEmail: settings.revokeEmail, privacyUrl: settings.privacyUrl, missingCompany: !settings.companyName }, script, existing };
}

/* ---------------------------------------------------------------- Formular (Meta Lead Ads) */
export type FormConsentInput = { formId?: string | null; formName?: string | null; leadgenId?: string | null; createdTime?: Date | string | null; disclaimerResponses?: Array<{ checkbox_key?: string; is_checked?: string | boolean }> | null; legalText?: string | null; privacyUrl?: string | null; platform?: string | null };
/** Einwilligung aus dem Online-Formular: Hinweistext, gesetzte Häkchen und Zeitpunkt – für unseren eigenen Anruf. Ohne Hinweistext/Häkchen: unvollständig (dann steht nur „Anfrage gestellt“). */
export async function createFormOptIn(db: Db, tenantId: number, leadId: number, input: FormConsentInput) {
  const lead = await leadFor(db, tenantId, { leadId }); const settings = await optInSettingsFor(db, tenantId);
  const responses = (input.disclaimerResponses ?? []).map((item) => ({ key: String(item.checkbox_key ?? ""), checked: item.is_checked === true || String(item.is_checked ?? "").toLowerCase() === "true" || String(item.is_checked ?? "") === "1" }));
  const checked = responses.filter((item) => item.checked);
  const legal = (input.legalText ?? "").trim();
  const consentText = legal || (checked.length ? `Häkchen im Formular „${input.formName ?? input.formId ?? "Lead-Formular"}“ gesetzt: ${checked.map((item) => item.key).join(", ")}` : `Anfrage über das Formular „${input.formName ?? input.formId ?? "Lead-Formular"}“ gestellt (kein eigener Einwilligungstext übermittelt).`);
  const complete = Boolean(legal) || checked.length > 0;
  const checks: OptInChecks = { aufnahme: true, firma: Boolean(settings.companyName) || /tanesco|firma|gmbh|gbr|ug\b/i.test(consentText), zweck: /anfrage|kontakt|angebot/i.test(consentText) || complete, kanaele: /telefon|anruf|e-?mail|whatsapp/i.test(consentText) || checked.length > 0, widerruf: /widerruf|jederzeit/i.test(consentText) || complete, ja: complete, by: "regeln" };
  const givenAt = input.createdTime ? new Date(input.createdTime) : new Date();
  const number = await nextNumber(db, tenantId);
  const inserted = await db.insert(optIns).values({ tenantId, leadId: lead.id, number, kind: "formular", status: complete ? (allChecked(checks) ? "gueltig" : "unvollstaendig") : "unvollstaendig", grantedTo: "eigen", companyName: settings.companyName || null, consentText, channels: settings.channels, givenAt, collectedBy: input.platform ?? "Meta Lead Ads", source: { via: "formular", platform: input.platform ?? "facebook", formId: input.formId ?? null, formName: input.formName ?? null, leadgenId: input.leadgenId ?? null, responses, privacyUrl: input.privacyUrl ?? null }, checks, missing: complete ? missingOf(checks) : ["Einwilligungstext oder Häkchen im Formular"], proofToken: nanoid(32), usages: [] });
  const id = Number(inserted[0]?.insertId) || 0; await reseal(db, id);
  return { id, number, status: complete ? "gueltig" : "unvollstaendig" };
}

/* ---------------------------------------------------------------- Sprache: Voice-Opt-in im App-Dialer */
/** „Opt-in aufnehmen“: Datensatz anlegen und – bei sipgate – die Aufzeichnung nur für diesen Abschnitt starten. Läuft das Gespräch schon aufgezeichnet, wird nur die Stelle (Sekunde ab Gesprächsbeginn) gemerkt. */
export async function startVoiceOptIn(db: Db, tenantId: number, userId: number, input: { publicId?: string | null; dialerCallId?: number | null; buyerUserId?: number | null; buyerName?: string | null; appUrl: string }) {
  const settings = await optInSettingsFor(db, tenantId);
  if (!settings.companyName) throw new Error("Bitte zuerst unter Telefonie → Einstellungen → Opt-in den Firmennamen eintragen – er wird im Einwilligungstext vorgelesen.");
  const target = await optInTarget(db, tenantId, input); const lead = await leadForOptIn(db, tenantId, userId, target);
  const buyerName = (input.buyerName ?? "").trim() || null; const now = new Date();
  const script = consentScript(settings, await scriptValuesFor(db, lead, buyerName, now));
  const agent = (await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1))[0]?.name ?? null;
  const call = target.call;
  let recording: { own: boolean; sid: string | null; provider: string; startSec: number | null; note: string | null } = { own: false, sid: null, provider: "keine", startSec: null, note: call ? null : "Kein aktiver Anruf im Dialer – es wird nichts aufgezeichnet; Bestätigung bitte per SMS einholen." };
  if (call) {
    const { providerFor } = await import("./dialer"); const { provider, settings: tel } = await providerFor(db, tenantId);
    const startedAt = call.answeredAt ?? call.startedAt ?? now; const startSec = Math.max(0, Math.round((now.getTime() - new Date(startedAt).getTime()) / 1000));
    if (call.recordingSid) recording = { own: false, sid: call.recordingSid, provider: provider.name, startSec, note: "Das Gespräch wird schon aufgezeichnet – die Stelle wird in der Aufnahme markiert." };
    else if (provider.name !== "simulation" && call.providerCallSid && !/^(session|pending):/.test(call.providerCallSid)) {
      try { const started = await provider.startRecording(call.providerCallSid, `${input.appUrl.replace(/\/+$/, "")}/api/telephony/recording?callId=${call.id}`, { announcement: false }); await db.update(dialerCalls).set({ recordingSid: started.recordingSid, consentAt: now }).where(eq(dialerCalls.id, call.id)); recording = { own: true, sid: started.recordingSid, provider: provider.name, startSec: 0, note: null }; }
      catch (error) { recording = { own: false, sid: null, provider: provider.name, startSec: null, note: `Aufzeichnung konnte nicht gestartet werden: ${error instanceof Error ? error.message : "unbekannt"}. Bitte per SMS bestätigen lassen.` }; }
    } else if (provider.name === "simulation") { recording = { own: true, sid: `REsim-optin-${call.id}`, provider: "simulation", startSec: 0, note: null }; await db.update(dialerCalls).set({ recordingSid: recording.sid, consentAt: now }).where(eq(dialerCalls.id, call.id)); }
    else recording = { own: false, sid: null, provider: provider.name, startSec: null, note: "Der Anruf läuft nicht über sipgate – keine Aufzeichnung möglich. Bitte per SMS bestätigen lassen." };
    void tel;
  }
  const number = await nextNumber(db, tenantId);
  const inserted = await db.insert(optIns).values({ tenantId, leadId: lead.id, number, kind: "sprache", status: "offen", grantedTo: "kaeufer", buyerUserId: input.buyerUserId ?? null, buyerName, companyName: settings.companyName, consentText: script.fullText, channels: settings.channels, givenAt: now, collectedBy: agent, collectedByUserId: userId, source: { via: "dialer", dialerCallId: call?.id ?? null, recording }, dialerCallId: call?.id ?? null, recordingStartSec: recording.startSec, checks: EMPTY_CHECKS, missing: missingOf(EMPTY_CHECKS), proofToken: nanoid(32), usages: [] });
  const id = Number(inserted[0]?.insertId) || 0;
  return { id, number, script, recording: { active: Boolean(recording.sid), own: recording.own, note: recording.note }, buyerName, lead: { publicId: lead.publicId, created: !target.lead } };
}
/** „Aufnahme beenden“: Aufzeichnung stoppen (wenn wir sie gestartet haben), die Bestätigung des Agenten festhalten und den Status setzen. Die Abschrift kommt nach dem Auflegen dazu und wird dann geprüft. */
export async function finishVoiceOptIn(db: Db, tenantId: number, userId: number, input: { optInId: number; attest: { aufnahme: boolean; ja: boolean }; note?: string | null; cancel?: boolean }) {
  const row = (await db.select().from(optIns).where(and(eq(optIns.id, input.optInId), eq(optIns.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Opt-in nicht gefunden.");
  const source = (row.source ?? {}) as { recording?: { own?: boolean; sid?: string | null } };
  const now = new Date(); let endSec: number | null = null;
  if (row.dialerCallId) {
    const call = (await db.select().from(dialerCalls).where(eq(dialerCalls.id, row.dialerCallId)).limit(1))[0];
    if (call) { const startedAt = call.answeredAt ?? call.startedAt ?? now; endSec = Math.max(0, Math.round((now.getTime() - new Date(startedAt).getTime()) / 1000)); }
    if (call && source.recording?.own && call.providerCallSid && !/^(session|pending):/.test(call.providerCallSid)) { try { const { providerFor } = await import("./dialer"); const { provider } = await providerFor(db, tenantId); if (provider.name !== "simulation" && provider.stopRecording) await provider.stopRecording(call.providerCallSid); } catch (error) { console.error("[Opt-in] Aufzeichnung nicht gestoppt:", error instanceof Error ? error.message : error); } }
  }
  if (input.cancel) { await db.update(optIns).set({ status: "abgelehnt", attest: { aufnahme: input.attest.aufnahme, ja: false, note: input.note ?? "abgebrochen" }, recordingEndSec: endSec, warning: "Abgebrochen – keine Einwilligung." }).where(eq(optIns.id, row.id)); await reseal(db, row.id); return { id: row.id, status: "abgelehnt" as OptInStatus }; }
  // Bestätigung des Agenten: beide Ja gehört → vorläufig gültig (Regeln/KI prüfen die Abschrift, sobald sie da ist)
  const attested = input.attest.aufnahme && input.attest.ja;
  const checks: OptInChecks = attested ? { aufnahme: true, firma: true, zweck: true, kanaele: true, widerruf: true, ja: true, by: "agent" } : { ...EMPTY_CHECKS, aufnahme: input.attest.aufnahme, ja: input.attest.ja, by: "agent" };
  const status: OptInStatus = attested ? "gueltig" : "unvollstaendig";
  await db.update(optIns).set({ status, attest: { aufnahme: input.attest.aufnahme, ja: input.attest.ja, note: input.note?.trim().slice(0, 400) || null, at: now.toISOString(), byUserId: userId }, checks, missing: attested ? [] : missingOf(checks), recordingEndSec: endSec, warning: attested ? (source.recording?.sid ? "Abschrift noch nicht geprüft – kommt nach dem Auflegen." : "Ohne Aufnahme – nur Bestätigung des Agenten. Bitte zusätzlich per SMS bestätigen lassen.") : null }).where(eq(optIns.id, row.id));
  await reseal(db, row.id);
  await logActivity(db, tenantId, { kind: "opt_in", title: `Opt-in ${row.number}: ${status === "gueltig" ? "aufgenommen" : "unvollständig"}${row.buyerName ? ` – für ${row.buyerName}` : ""}`, detail: attested ? "Zustimmung zur Aufnahme und Einwilligung bestätigt" : "Nicht beide Ja bestätigt", leadId: row.leadId, actorUserId: userId, refType: "lead", refId: row.leadId });
  await db.insert(pipelineEvents).values({ tenantId, leadId: row.leadId, fromStage: null, toStage: "opt_in", actorUserId: userId, note: `Opt-in ${row.number} (${status === "gueltig" ? "gültig" : "unvollständig"})${row.buyerName ? ` für ${row.buyerName}` : ""}` });
  return { id: row.id, status };
}

/* ---------------------------------------------------------------- Prüfung einer Abschrift (Regeln, mit KI wenn möglich) */
async function checkWithAi(transcript: string, expect: { buyerName: string | null; companyName: string | null }): Promise<{ checks: OptInChecks; quote: string | null } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const { invokeLLM } = await import("./_core/llm");
    const system = `Du prüfst die Abschrift eines Telefonats auf eine wirksame Werbeeinwilligung nach deutschem Recht (§ 7 Abs. 2 Nr. 1, § 7a UWG). Antworte NUR mit JSON: {"aufnahme":bool,"firma":bool,"zweck":bool,"kanaele":bool,"widerruf":bool,"ja":bool,"quote":string}. Bedeutung: aufnahme = der Kunde hat der Aufzeichnung zugestimmt; firma = der Fachbetrieb ${expect.buyerName ? `„${expect.buyerName}“` : "(oder ein Fachbetrieb als Ersatzformulierung)"} wurde als Empfänger genannt; zweck = Weitergabe der Daten zur Anfrage genannt; kanaele = telefonische und E-Mail-Kontaktaufnahme genannt; widerruf = Hinweis auf jederzeitigen Widerruf; ja = der KUNDE hat eindeutig und ausdrücklich zugestimmt (ein klares Ja/einverstanden, kein Mhm, keine Verneinung). quote = die Textstelle (max. 600 Zeichen) von der Frage bis zum Ja des Kunden. Erfinde nichts.`;
    const response = await invokeLLM({ maxTokens: 500, temperature: 0, messages: [{ role: "system", content: system }, { role: "user", content: `Abschrift:\n${transcript.slice(0, 12000)}` }] });
    const text = String(response.choices[0]?.message.content ?? "").trim(); const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1); const parsed = JSON.parse(json) as Record<string, unknown>;
    const bool = (key: string) => parsed[key] === true;
    return { checks: { aufnahme: bool("aufnahme"), firma: bool("firma"), zweck: bool("zweck"), kanaele: bool("kanaele"), widerruf: bool("widerruf"), ja: bool("ja"), by: "ki" }, quote: typeof parsed.quote === "string" && parsed.quote.trim() ? parsed.quote.trim().slice(0, 900) : null };
  } catch (error) { console.error("[Opt-in] KI-Prüfung fehlgeschlagen:", error instanceof Error ? error.message : error); return null; }
}
export async function checkTranscript(transcript: string, expect: { buyerName: string | null; companyName: string | null }) {
  const ai = await checkWithAi(transcript, expect);
  const rules = checkConsentText(transcript, expect);
  return { checks: ai?.checks ?? rules, quote: ai?.quote ?? consentQuote(transcript), rules };
}
/** Abschrift zu einem Voice-Opt-in ist da (nach dem Auflegen): prüfen, Stelle zitieren, Status setzen – eine Bestätigung des Agenten wird nicht stillschweigend überschrieben, sondern mit Warnung versehen. */
export async function evaluateOptInsForDialerCall(db: Db, tenantId: number, dialerCallId: number, callRecordId: number | null, transcript: string | null, recordingUrl: string | null) {
  const rows = await db.select().from(optIns).where(and(eq(optIns.tenantId, tenantId), eq(optIns.dialerCallId, dialerCallId), eq(optIns.kind, "sprache")));
  let evaluated = 0;
  for (const row of rows) {
    if (row.status === "abgelehnt" || row.status === "widerrufen") continue;
    const patch: Partial<typeof optIns.$inferInsert> = { callRecordId: callRecordId ?? row.callRecordId, recordingUrl: recordingUrl ?? row.recordingUrl };
    if (transcript && transcript.trim()) {
      const { checks, quote } = await checkTranscript(transcript, { buyerName: row.buyerName, companyName: row.companyName });
      const attested = (row.attest as { aufnahme?: boolean; ja?: boolean } | null)?.aufnahme && (row.attest as { ja?: boolean } | null)?.ja;
      const ok = allChecked(checks); const missing = missingOf(checks);
      patch.transcript = transcript.slice(0, 60000); patch.quote = quote; patch.checks = checks; patch.missing = missing;
      if (ok) { patch.status = "gueltig"; patch.warning = null; }
      else if (attested) { patch.status = "gueltig"; patch.warning = `Prüfung der Abschrift: ${missing.join(", ")} nicht gefunden – bitte anhören.`; }
      else { patch.status = "unvollstaendig"; patch.warning = null; }
      evaluated += 1;
    } else if (row.warning?.startsWith("Abschrift noch nicht")) patch.warning = recordingUrl ? "Aufnahme vorhanden, keine Abschrift (kein Transkriptionsdienst) – Bestätigung des Agenten gilt." : row.warning;
    await db.update(optIns).set(patch).where(eq(optIns.id, row.id)); await reseal(db, row.id);
  }
  return { optIns: rows.length, evaluated };
}
/** Bei der Freigabe eines Gesprächs (externer Dialer, Gesamtaufnahme): die Einwilligungsstelle in der Abschrift suchen und als Nachweis anlegen – wenn es noch keine gültige für den Fachbetrieb gibt. */
export async function optInFromCallRecord(db: Db, tenantId: number, callRecordId: number, actorUserId: number | null) {
  const call = (await db.select().from(callRecords).where(and(eq(callRecords.id, callRecordId), eq(callRecords.tenantId, tenantId))).limit(1))[0]; if (!call?.leadId) return null;
  const existing = await validBuyerOptIn(db, tenantId, call.leadId); if (existing) return { id: existing.id, number: existing.number, status: existing.status as OptInStatus, created: false };
  const already = (await db.select({ id: optIns.id, number: optIns.number, status: optIns.status }).from(optIns).where(and(eq(optIns.tenantId, tenantId), eq(optIns.callRecordId, callRecordId))).limit(1))[0]; if (already) return { ...already, status: already.status as OptInStatus, created: false };
  const lead = await leadFor(db, tenantId, { leadId: call.leadId }); const settings = await optInSettingsFor(db, tenantId);
  const transcript = (call.transcript ?? "").trim();
  const suggestions = await suggestedBuyersFor(db, tenantId, lead); const named = suggestions.find((item) => transcript && checkConsentText(transcript, { buyerName: item.buyerName }).firma) ?? null;
  const { checks, quote } = transcript ? await checkTranscript(transcript, { buyerName: named?.buyerName ?? null, companyName: settings.companyName }) : { checks: { ...EMPTY_CHECKS, by: "regeln" as const }, quote: null };
  const script = consentScript(settings, await scriptValuesFor(db, lead, named?.buyerName ?? null, call.startedAt ?? new Date()));
  const status = statusFromChecks(checks);
  const number = await nextNumber(db, tenantId);
  const inserted = await db.insert(optIns).values({ tenantId, leadId: lead.id, number, kind: "sprache", status, grantedTo: "kaeufer", buyerUserId: named?.buyerUserId ?? null, buyerName: named?.buyerName ?? null, companyName: settings.companyName || null, consentText: quote ?? script.fullText, channels: settings.channels, givenAt: call.startedAt ?? new Date(), collectedBy: call.agentName, source: { via: "gespraech", provider: call.provider, externalCallId: call.externalCallId, campaign: call.campaign, wholeRecording: true }, callRecordId: call.id, recordingUrl: call.recordingUrl, transcript: transcript ? transcript.slice(0, 60000) : null, quote, checks, missing: missingOf(checks), warning: transcript ? (status === "gueltig" ? null : "Aus der Gesamtaufnahme abgeleitet – bitte die Stelle anhören oder per SMS bestätigen lassen.") : "Keine Abschrift – kein Opt-in aus dem Gespräch ableitbar. Bitte per SMS bestätigen lassen.", proofToken: nanoid(32), usages: [] });
  const id = Number(inserted[0]?.insertId) || 0; await reseal(db, id);
  await logActivity(db, tenantId, { kind: "opt_in", title: `Opt-in ${number} aus Gespräch: ${status === "gueltig" ? "gültig" : "unvollständig"}`, detail: missingOf(checks).length ? `Fehlt: ${missingOf(checks).join(", ")}` : null, leadId: lead.id, actorUserId, refType: "lead", refId: lead.id });
  return { id, number, status, created: true };
}

/* ---------------------------------------------------------------- SMS-Bestätigung */
export async function sendOptInSms(db: Db, tenantId: number, userId: number | null, input: { publicId?: string | null; leadId?: number | null; buyerUserId?: number | null; buyerName: string; appUrl: string; auto?: boolean }) {
  const lead = await leadFor(db, tenantId, { publicId: input.publicId, leadId: input.leadId }); const settings = await optInSettingsFor(db, tenantId);
  if (!settings.companyName) throw new Error("Bitte zuerst unter Telefonie → Einstellungen → Opt-in den Firmennamen eintragen.");
  const buyerName = input.buyerName.trim(); if (!buyerName) throw new Error("Bitte den Fachbetrieb angeben, der genannt werden soll.");
  if (!lead.phone) throw new Error("Der Kontakt hat keine Telefonnummer.");
  const token = nanoid(24); const link = optInConfirmUrl(input.appUrl, token);
  const values = await scriptValuesFor(db, lead, buyerName); const text = smsText(settings, { ...values, link });
  const consentText = `Bestätigung per SMS-Link: „${buyerName}“ darf ${nameOf(lead)} zur Anfrage (${values.category}) telefonisch und per E-Mail kontaktieren; Daten (Name, Adresse, Telefon, Anfrage) werden dafür von ${settings.companyName} weitergegeben. Widerruf jederzeit.`;
  const number = await nextNumber(db, tenantId);
  const inserted = await db.insert(optIns).values({ tenantId, leadId: lead.id, number, kind: "sms", status: "offen", grantedTo: "kaeufer", buyerUserId: input.buyerUserId ?? null, buyerName, companyName: settings.companyName, consentText, channels: settings.channels, collectedBy: input.auto ? "automatisch nach Zuteilung" : null, collectedByUserId: userId, source: { via: "sms", auto: Boolean(input.auto), text }, smsToken: token, smsPhone: lead.phone, smsSentAt: new Date(), checks: EMPTY_CHECKS, missing: ["Bestätigung per Klick"], proofToken: nanoid(32), usages: [] });
  const id = Number(inserted[0]?.insertId) || 0;
  const { sendLeadMessage } = await import("./pipeline-extras");
  await sendLeadMessage(db, tenantId, { publicId: lead.publicId, channel: "sms", text, templateKey: `optin:${id}`, actorUserId: userId, appUrl: input.appUrl, anyKind: true });
  await reseal(db, id);
  return { id, number, link, text };
}
export async function optInByToken(db: Db, token: string) {
  const row = (await db.select().from(optIns).where(eq(optIns.smsToken, token)).limit(1))[0]; if (!row) return null;
  const lead = (await db.select({ firstName: leads.firstName, lastName: leads.lastName, categoryId: leads.categoryId }).from(leads).where(eq(leads.id, row.leadId)).limit(1))[0];
  const settings = await optInSettingsFor(db, row.tenantId); // Datenschutz-Link und Widerruf-Adresse für die öffentliche Seite (gestufte Information)
  return { row, name: lead ? [lead.firstName, lead.lastName].filter(Boolean).join(" ") : "", category: lead ? await categoryName(db, lead.categoryId) : null, privacyUrl: settings.privacyUrl || null, revokeEmail: settings.revokeEmail || null, channels: settings.channels };
}
export async function confirmOptIn(db: Db, token: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const found = await optInByToken(db, token); if (!found) throw new Error("Dieser Link ist nicht (mehr) gültig.");
  const row = found.row; if (row.status === "widerrufen") throw new Error("Diese Einwilligung wurde widerrufen.");
  if (row.confirmedAt) return { number: row.number, buyerName: row.buyerName, already: true };
  const checks: OptInChecks = { aufnahme: true, firma: true, zweck: true, kanaele: true, widerruf: true, ja: true, by: "regeln" };
  const now = new Date();
  await db.update(optIns).set({ status: "gueltig", givenAt: now, confirmedAt: now, confirmIp: meta.ip?.slice(0, 64) ?? null, confirmUserAgent: meta.userAgent?.slice(0, 300) ?? null, checks, missing: [], warning: null }).where(eq(optIns.id, row.id));
  await reseal(db, row.id);
  await db.insert(pipelineEvents).values({ tenantId: row.tenantId, leadId: row.leadId, fromStage: null, toStage: "opt_in", actorUserId: null, note: `Opt-in ${row.number} per SMS bestätigt${row.buyerName ? ` – für ${row.buyerName}` : ""}` });
  await logActivity(db, row.tenantId, { kind: "opt_in", title: `Opt-in ${row.number} per SMS bestätigt`, detail: row.buyerName ? `für ${row.buyerName}` : null, leadId: row.leadId, actorUserId: null, refType: "lead", refId: row.leadId });
  return { number: row.number, buyerName: row.buyerName, already: false };
}
export async function declineOptIn(db: Db, token: string) {
  const found = await optInByToken(db, token); if (!found) throw new Error("Dieser Link ist nicht (mehr) gültig.");
  if (found.row.status === "gueltig") return revokeOptIn(db, found.row.tenantId, null, { optInId: found.row.id, note: "Über den SMS-Link abgelehnt" });
  await db.update(optIns).set({ status: "abgelehnt", warning: "Über den SMS-Link abgelehnt." }).where(eq(optIns.id, found.row.id)); await reseal(db, found.row.id);
  await db.insert(pipelineEvents).values({ tenantId: found.row.tenantId, leadId: found.row.leadId, fromStage: null, toStage: "opt_in", actorUserId: null, note: `Opt-in ${found.row.number}: Bestätigung abgelehnt` });
  return { number: found.row.number, status: "abgelehnt" as OptInStatus };
}

/* ---------------------------------------------------------------- Widerruf, Verwendung */
export async function revokeOptIn(db: Db, tenantId: number, userId: number | null, input: { optInId: number; note?: string | null }) {
  const row = (await db.select().from(optIns).where(and(eq(optIns.id, input.optInId), eq(optIns.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Opt-in nicht gefunden.");
  const now = new Date(); const note = input.note?.trim().slice(0, 400) || null;
  await db.update(optIns).set({ status: "widerrufen", revokedAt: now, revokeNote: note }).where(eq(optIns.id, row.id)); await reseal(db, row.id);
  const lead = await leadFor(db, tenantId, { leadId: row.leadId });
  await db.update(leads).set({ metadata: { ...metaOf(lead), doNotCall: true, optInRevokedAt: now.toISOString() } }).where(eq(leads.id, lead.id));
  if (lead.email) { const existing = (await db.select({ id: emailSuppressions.id }).from(emailSuppressions).where(and(eq(emailSuppressions.tenantId, tenantId), eq(emailSuppressions.email, lead.email.toLowerCase()))).limit(1))[0]; if (!existing) await db.insert(emailSuppressions).values({ tenantId, email: lead.email.toLowerCase(), reason: "abgemeldet", source: "widerruf", note: `Widerruf der Einwilligung (Opt-in ${row.number})` }); }
  await db.insert(pipelineEvents).values({ tenantId, leadId: lead.id, fromStage: null, toStage: "opt_in", actorUserId: userId, note: `Opt-in ${row.number} widerrufen${note ? `: ${note}` : ""} – nicht mehr anrufen` });
  await logActivity(db, tenantId, { kind: "opt_in", title: `Opt-in ${row.number} widerrufen`, detail: note, leadId: lead.id, actorUserId: userId, refType: "lead", refId: lead.id });
  return { number: row.number, status: "widerrufen" as OptInStatus };
}
/** Jede Zustellung an einen Käufer ist eine „Verwendung“: Frist von 5 Jahren beginnt neu; fehlt für diesen Käufer eine gültige Einwilligung, geht auf Wunsch automatisch die SMS-Bestätigung raus. */
export async function recordOptInUsage(db: Db, tenantId: number, leadId: number, usage: { kind: OptInUsage["kind"]; buyerName: string | null; buyerUserId: number | null; orderId: number | null }, appUrl?: string | null) {
  const rows = await db.select().from(optIns).where(and(eq(optIns.tenantId, tenantId), eq(optIns.leadId, leadId), eq(optIns.status, "gueltig")));
  const now = new Date(); const entry: OptInUsage = { at: now.toISOString(), kind: usage.kind, buyerName: usage.buyerName, buyerUserId: usage.buyerUserId, orderId: usage.orderId };
  for (const row of rows) { await db.update(optIns).set({ usages: [...usagesOf(row), entry].slice(-200), lastUsedAt: now }).where(eq(optIns.id, row.id)); await reseal(db, row.id); }
  const forBuyer = await validBuyerOptIn(db, tenantId, leadId, { buyerUserId: usage.buyerUserId, buyerName: usage.buyerName });
  let smsSent = false;
  if (!forBuyer && usage.buyerName) {
    const settings = await optInSettingsFor(db, tenantId);
    const pending = (await db.select({ id: optIns.id }).from(optIns).where(and(eq(optIns.tenantId, tenantId), eq(optIns.leadId, leadId), eq(optIns.kind, "sms"), eq(optIns.status, "offen"))).limit(1))[0];
    if (settings.autoSms && settings.companyName && appUrl && !pending) { try { await sendOptInSms(db, tenantId, null, { leadId, buyerUserId: usage.buyerUserId, buyerName: usage.buyerName, appUrl, auto: true }); smsSent = true; } catch (error) { console.error("[Opt-in] SMS-Bestätigung nach Zuteilung nicht gesendet:", error instanceof Error ? error.message : error); } }
  }
  return { used: rows.length, coveredForBuyer: Boolean(forBuyer), smsSent };
}

/* ---------------------------------------------------------------- Nachweis (PDF) */
export async function optInProof(db: Db, ref: { tenantId?: number; optInId?: number; proofToken?: string }) {
  const where = ref.proofToken ? eq(optIns.proofToken, ref.proofToken) : and(eq(optIns.id, ref.optInId ?? 0), eq(optIns.tenantId, ref.tenantId ?? 0));
  const row = (await db.select().from(optIns).where(where).limit(1))[0]; if (!row) return null;
  const lead = (await db.select().from(leads).where(eq(leads.id, row.leadId)).limit(1))[0]; if (!lead) return null;
  const settings = await optInSettingsFor(db, row.tenantId);
  const { buildOptInPdf } = await import("../shared/opt-in-pdf");
  const buffer = buildOptInPdf({ optIn: optInView(row, null), lead: { name: nameOf(lead), publicId: lead.publicId, phone: lead.phone, email: lead.email, street: (lead as { street?: string | null }).street ?? (metaOf(lead).street as string | undefined) ?? null, postcode: lead.postcode, city: lead.city, category: await categoryName(db, lead.categoryId) }, company: { name: settings.companyName || row.companyName || "", address: settings.companyAddress, revokeEmail: settings.revokeEmail, privacyUrl: settings.privacyUrl } });
  return { buffer, fileName: `${row.number}-Einwilligungsnachweis.pdf`, number: row.number };
}
export const OPT_IN_DEFAULTS = DEFAULT_OPT_IN_SETTINGS;
export { countYes };
