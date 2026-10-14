/**
 * Einstellungen → Integrationen: Partner-Statusrückmeldungen.
 *  - Aroundhome: Konten (Publisher-ID, Zugangstoken/Export-Link), Abgleich der Vorgänge, Reklamation bei Storno.
 *  - WattFox: Tracking-URL je Konto, eingehende Statusmeldungen → Reklamation nach Code-Zuordnung.
 *  - hlrlookup: Telefonnummern-Prüfung beim Import (Zugangsdaten, Verbindungstest).
 *  - Storno-Zuordnungsregeln je Partner (Text/Code → Reklamationsgrund, erste passende Regel gewinnt).
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { claimEvents, claims, leadDeliveries, leadStatusEvents, leads, partnerAccounts, partnerCallbacks, partnerCancelRules, reclamationReasons, type PartnerAccount } from "../drizzle/schema";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./integration-secrets";
import type { Db } from "./lead-pipeline";
import { upsertDailyStats } from "./d2d";

export const SECRET_MASK = "••••••••";
type Credentials = { accessToken?: string; exportUrl?: string; apiKey?: string; apiSecret?: string };

const readCredentials = (account: Pick<PartnerAccount, "credentialsEncrypted">): Credentials => { if (!account.credentialsEncrypted) return {}; try { return JSON.parse(decryptIntegrationSecret(account.credentialsEncrypted)) as Credentials; } catch { return {}; } };
const mask = (value: string | undefined) => (value ? `${SECRET_MASK}${value.slice(-4)}` : "");

export async function listPartnerAccounts(db: Db, tenantId: number, appUrl: string) {
  const [accounts, rules, reasons] = await Promise.all([
    db.select().from(partnerAccounts).where(eq(partnerAccounts.tenantId, tenantId)).orderBy(asc(partnerAccounts.id)),
    db.select().from(partnerCancelRules).where(eq(partnerCancelRules.tenantId, tenantId)).orderBy(asc(partnerCancelRules.provider), asc(partnerCancelRules.position), asc(partnerCancelRules.id)),
    db.select({ id: reclamationReasons.id, name: reclamationReasons.name, active: reclamationReasons.active }).from(reclamationReasons).where(eq(reclamationReasons.tenantId, tenantId)).orderBy(asc(reclamationReasons.sortOrder)),
  ]);
  const hlr = accounts.find((account) => account.provider === "hlrlookup");
  const hlrCredentials = hlr ? readCredentials(hlr) : {};
  return {
    aroundhome: accounts.filter((account) => account.provider === "aroundhome").map((account) => { const credentials = readCredentials(account); return { id: account.id, label: account.label ?? "", publisherId: account.publisherId ?? "", accessToken: mask(credentials.accessToken), exportUrl: credentials.exportUrl ?? "", reclaimOnCancel: account.reclaimOnCancel, reclaimReasonId: account.reclaimReasonId, enabled: account.enabled, lastSyncAt: account.lastSyncAt, lastSyncSummary: account.lastSyncSummary }; }),
    wattfox: accounts.filter((account) => account.provider === "wattfox").map((account) => ({ id: account.id, label: account.label ?? "", trackingUrl: `${appUrl.replace(/\/+$/, "")}/api/partner/wattfox/${account.trackingToken}`, reclaimOnCancel: account.reclaimOnCancel, reclaimReasonId: account.reclaimReasonId, enabled: account.enabled, lastSyncAt: account.lastSyncAt, lastSyncSummary: account.lastSyncSummary })),
    hlrlookup: { id: hlr?.id ?? null, enabled: hlr?.enabled ?? false, apiKey: mask(hlrCredentials.apiKey), apiSecret: hlrCredentials.apiSecret ? SECRET_MASK : "", lastTestAt: hlr?.lastSyncAt ?? null, lastTestSummary: hlr?.lastSyncSummary ?? null },
    cancelRules: rules.map((rule) => ({ id: rule.id, provider: rule.provider, matchOp: rule.matchOp, matchValue: rule.matchValue, reasonId: rule.reasonId })),
    reasons,
  };
}

export async function saveAroundhomeAccount(db: Db, tenantId: number, input: { id?: number; label: string; publisherId: string; accessToken: string; exportUrl: string; reclaimOnCancel: boolean; reclaimReasonId: number | null; enabled: boolean }) {
  const existing = input.id ? (await db.select().from(partnerAccounts).where(and(eq(partnerAccounts.id, input.id), eq(partnerAccounts.tenantId, tenantId), eq(partnerAccounts.provider, "aroundhome"))).limit(1))[0] : undefined;
  if (input.id && !existing) throw new Error("Aroundhome-Konto wurde nicht gefunden.");
  const previous = existing ? readCredentials(existing) : {};
  const accessToken = input.accessToken.startsWith(SECRET_MASK) ? previous.accessToken ?? "" : input.accessToken.trim();
  const credentials = encryptIntegrationSecret(JSON.stringify({ accessToken, exportUrl: input.exportUrl.trim() }));
  const values = { tenantId, provider: "aroundhome" as const, label: input.label.trim() || "Aroundhome", publisherId: input.publisherId.trim() || null, credentialsEncrypted: credentials, reclaimOnCancel: input.reclaimOnCancel, reclaimReasonId: input.reclaimReasonId, enabled: input.enabled };
  if (existing) { await db.update(partnerAccounts).set(values).where(eq(partnerAccounts.id, existing.id)); return { id: existing.id }; }
  const inserted = await db.insert(partnerAccounts).values(values);
  return { id: Number(inserted[0]?.insertId) || 0 };
}

export async function createWattfoxAccount(db: Db, tenantId: number, input: { label: string; reclaimOnCancel: boolean; reclaimReasonId: number | null }) {
  const inserted = await db.insert(partnerAccounts).values({ tenantId, provider: "wattfox", label: input.label.trim() || "WattFox", trackingToken: nanoid(32), reclaimOnCancel: input.reclaimOnCancel, reclaimReasonId: input.reclaimReasonId, enabled: true });
  return { id: Number(inserted[0]?.insertId) || 0 };
}

export async function updatePartnerAccount(db: Db, tenantId: number, input: { id: number; label?: string; reclaimOnCancel?: boolean; reclaimReasonId?: number | null; enabled?: boolean }) {
  const { id, ...values } = input;
  await db.update(partnerAccounts).set(values).where(and(eq(partnerAccounts.id, id), eq(partnerAccounts.tenantId, tenantId)));
  return { success: true as const };
}

export async function deletePartnerAccount(db: Db, tenantId: number, id: number) {
  await db.delete(partnerAccounts).where(and(eq(partnerAccounts.id, id), eq(partnerAccounts.tenantId, tenantId)));
  return { success: true as const };
}

export async function saveCancelRules(db: Db, tenantId: number, provider: "aroundhome" | "wattfox", rules: Array<{ matchOp: "enthaelt" | "gleich" | "beginnt"; matchValue: string; reasonId: number }>) {
  await db.delete(partnerCancelRules).where(and(eq(partnerCancelRules.tenantId, tenantId), eq(partnerCancelRules.provider, provider)));
  const rows = rules.filter((rule) => rule.matchValue.trim() && rule.reasonId > 0).map((rule, index) => ({ tenantId, provider, matchOp: rule.matchOp, matchValue: rule.matchValue.trim(), reasonId: rule.reasonId, position: index }));
  if (rows.length) await db.insert(partnerCancelRules).values(rows);
  return { count: rows.length };
}

export async function saveHlrLookup(db: Db, tenantId: number, input: { apiKey: string; apiSecret: string; enabled: boolean }) {
  const existing = (await db.select().from(partnerAccounts).where(and(eq(partnerAccounts.tenantId, tenantId), eq(partnerAccounts.provider, "hlrlookup"))).limit(1))[0];
  const previous = existing ? readCredentials(existing) : {};
  const apiKey = input.apiKey.startsWith(SECRET_MASK) ? previous.apiKey ?? "" : input.apiKey.trim();
  const apiSecret = input.apiSecret === SECRET_MASK ? previous.apiSecret ?? "" : input.apiSecret.trim();
  const values = { tenantId, provider: "hlrlookup" as const, label: "hlrlookup.com", credentialsEncrypted: encryptIntegrationSecret(JSON.stringify({ apiKey, apiSecret })), enabled: input.enabled };
  if (existing) await db.update(partnerAccounts).set(values).where(eq(partnerAccounts.id, existing.id)); else await db.insert(partnerAccounts).values(values);
  return { success: true as const };
}

/** Telefonnummern-Prüfung über hlrlookup.com (REST). Antwortformat des Anbieters kann abweichen – Ergebnis wird tolerant gelesen. */
export async function checkPhoneNumber(db: Db, tenantId: number, phone: string, fetchImpl: typeof fetch = fetch): Promise<{ checked: boolean; valid: boolean | null; network?: string | null; raw?: string }> {
  const account = (await db.select().from(partnerAccounts).where(and(eq(partnerAccounts.tenantId, tenantId), eq(partnerAccounts.provider, "hlrlookup"), eq(partnerAccounts.enabled, true))).limit(1))[0];
  if (!account) return { checked: false, valid: null };
  const { apiKey, apiSecret } = readCredentials(account);
  const msisdn = phone.replace(/[^\d]/g, "").replace(/^00/, "");
  if (!apiKey || !apiSecret || msisdn.length < 8) return { checked: false, valid: null };
  try {
    const url = `https://www.hlrlookup.com/api/hlr/?apikey=${encodeURIComponent(apiKey)}&password=${encodeURIComponent(apiSecret)}&msisdn=${encodeURIComponent(msisdn)}`;
    const response = await fetchImpl(url); const text = await response.text();
    let parsed: Record<string, unknown> = {}; try { parsed = JSON.parse(text); } catch { /* Klartext */ }
    if (!response.ok || parsed.error) return { checked: true, valid: null, raw: text.slice(0, 300) };
    const status = String(parsed.status ?? parsed.result ?? parsed.hlr_status ?? "").toLowerCase();
    const valid = status ? !/invalid|unknown|absent|failed|undeliverable|not_valid|error/.test(status) : null;
    return { checked: true, valid, network: typeof parsed.network === "string" ? parsed.network : typeof parsed.original_network === "string" ? parsed.original_network : null, raw: text.slice(0, 300) };
  } catch (error) {
    return { checked: true, valid: null, raw: error instanceof Error ? error.message : "Fehler" };
  }
}

export async function testHlrLookup(db: Db, tenantId: number, fetchImpl: typeof fetch = fetch) {
  const account = (await db.select().from(partnerAccounts).where(and(eq(partnerAccounts.tenantId, tenantId), eq(partnerAccounts.provider, "hlrlookup"))).limit(1))[0];
  if (!account) throw new Error("Bitte zuerst API-Schlüssel und Passwort speichern.");
  const result = await checkPhoneNumber(db, tenantId, "+49 170 0000000", fetchImpl);
  const summary = !result.checked ? "Zugangsdaten unvollständig" : result.valid === null ? `Antwort nicht verwertbar: ${result.raw ?? ""}` : `Verbindung ok (${result.valid ? "Nummer gültig" : "Nummer ungültig"}${result.network ? `, Netz ${result.network}` : ""})`;
  await db.update(partnerAccounts).set({ lastSyncAt: new Date(), lastSyncSummary: summary }).where(eq(partnerAccounts.id, account.id));
  return { ok: result.checked && result.valid !== null, summary };
}

/* ------------------------------------------------------------------ Storno → Reklamation */

async function resolveCancelReason(db: Db, tenantId: number, provider: "aroundhome" | "wattfox", reasonText: string, fallbackReasonId: number | null) {
  const rules = await db.select().from(partnerCancelRules).where(and(eq(partnerCancelRules.tenantId, tenantId), eq(partnerCancelRules.provider, provider))).orderBy(asc(partnerCancelRules.position), asc(partnerCancelRules.id));
  const needle = reasonText.toLowerCase();
  const rule = rules.find((item) => { const value = item.matchValue.toLowerCase(); return item.matchOp === "gleich" ? needle === value : item.matchOp === "beginnt" ? needle.startsWith(value) : needle.includes(value); });
  const reasonId = rule?.reasonId ?? fallbackReasonId;
  if (!reasonId) return null;
  return (await db.select().from(reclamationReasons).where(and(eq(reclamationReasons.id, reasonId), eq(reclamationReasons.tenantId, tenantId))).limit(1))[0] ?? null;
}

async function findLeadForPartner(db: Db, tenantId: number, reference: { partnerReference?: string; leadPublicId?: string; leadNumber?: number }) {
  if (reference.leadNumber && Number.isInteger(reference.leadNumber)) { const row = (await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "verkauf"), eq(leads.id, reference.leadNumber))).limit(1))[0]; if (row) return row; }
  if (reference.leadPublicId) { const row = (await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "verkauf"), eq(leads.publicId, reference.leadPublicId))).limit(1))[0]; if (row) return row; }
  if (reference.partnerReference) { const row = (await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "verkauf"), sql`JSON_UNQUOTE(JSON_EXTRACT(${leads.metadata}, '$.partnerReference')) = ${reference.partnerReference}`)).limit(1))[0]; if (row) return row; }
  return undefined;
}

/** Legt bei Storno des Partners eine Reklamation an (offen zur Prüfung), sofern noch keine besteht. */
export async function recordPartnerCancellation(db: Db, tenantId: number, account: PartnerAccount, input: { lead: typeof leads.$inferSelect; status: string; reasonText: string; payload: unknown }) {
  const existing = (await db.select({ id: claims.id, status: claims.status }).from(claims).where(and(eq(claims.tenantId, tenantId), eq(claims.leadId, input.lead.id))).orderBy(desc(claims.createdAt)).limit(1))[0];
  let claimId: number | null = null;
  if (account.reclaimOnCancel && !(existing && ["offen", "in_prüfung", "genehmigt"].includes(existing.status))) {
    const reason = await resolveCancelReason(db, tenantId, account.provider as "aroundhome" | "wattfox", input.reasonText, account.reclaimReasonId);
    const delivery = (await db.select({ unitPrice: leadDeliveries.unitPrice }).from(leadDeliveries).where(and(eq(leadDeliveries.tenantId, tenantId), eq(leadDeliveries.leadId, input.lead.id))).orderBy(desc(leadDeliveries.occurredAt)).limit(1))[0];
    const inserted = await db.insert(claims).values({ tenantId, leadId: input.lead.id, reason: reason?.name ?? `Partner-Storno (${account.provider})`, details: `${account.label ?? account.provider}: ${input.status}${input.reasonText ? ` – ${input.reasonText}` : ""}`, status: "offen", refundAmount: delivery?.unitPrice ?? null, dueAt: new Date(Date.now() + 7 * 24 * 3_600_000) });
    claimId = Number(inserted[0]?.insertId) || null;
    if (claimId) await db.insert(claimEvents).values({ tenantId, claimId, eventType: "erstellt", nextStatus: "offen", actorUserId: null, note: `Automatisch angelegt aus Partner-Storno (${account.label ?? account.provider}).` });
    await db.insert(leadStatusEvents).values({ tenantId, leadId: input.lead.id, previousStatus: input.lead.status, nextStatus: input.lead.status, actorUserId: null, note: `Partner-Storno (${account.label ?? account.provider}): ${input.reasonText || input.status}${reason ? ` → ${reason.name}` : ""}` });
  }
  await db.insert(partnerCallbacks).values({ tenantId, provider: account.provider as "aroundhome" | "wattfox", accountId: account.id, leadId: input.lead.id, status: input.status.slice(0, 80), reasonText: input.reasonText.slice(0, 255) || null, payload: input.payload as never, claimId });
  return { claimId };
}

const CANCEL_PATTERN = /storn|cancel|abgelehnt|rejected|declined|widerruf|zurückgezogen/i;
const QUALIFIED_PATTERN = /qualif|accept|confirm|sold|success|erfolgreich|angenommen|bestätigt|verkauft|closed|won/i;

/** WattFox-Tracking-URL: GET/POST mit lead_id|external_id|uuid, status und code|reason. */
export async function handleWattfoxCallback(db: Db, token: string, params: Record<string, unknown>) {
  const account = (await db.select().from(partnerAccounts).where(and(eq(partnerAccounts.provider, "wattfox"), eq(partnerAccounts.trackingToken, token))).limit(1))[0];
  if (!account) return { status: 404, body: { error: "unknown tracking url" } };
  if (!account.enabled) return { status: 403, body: { error: "tracking disabled" } };
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
  const leadPublicId = text(params.lead_id ?? params.external_id ?? params.publisher_lead_id); const partnerReference = text(params.uuid ?? params.id ?? params.reference);
  const lead = await findLeadForPartner(db, account.tenantId, { leadPublicId, partnerReference, leadNumber: Number(params.lead_number) || undefined });
  if (!lead) { await db.insert(partnerCallbacks).values({ tenantId: account.tenantId, provider: "wattfox", accountId: account.id, status: text(params.status).slice(0, 80) || "unbekannt", reasonText: text(params.reason ?? params.code).slice(0, 255) || null, payload: params as never }); return { status: 404, body: { error: "lead not found" } }; }
  const status = text(params.status ?? params.event ?? "");
  const reasonText = text(params.reason ?? params.code ?? params.reason_code ?? "");
  if (CANCEL_PATTERN.test(status) || CANCEL_PATTERN.test(reasonText) || params.cancelled === true) { const result = await recordPartnerCancellation(db, account.tenantId, account, { lead, status: status || "storniert", reasonText, payload: params }); return { status: 200, body: { ok: true, lead_id: lead.publicId, cancelled: true, reclamation_id: result.claimId } }; }
  await db.insert(partnerCallbacks).values({ tenantId: account.tenantId, provider: "wattfox", accountId: account.id, leadId: lead.id, status: status.slice(0, 80) || "info", reasonText: reasonText.slice(0, 255) || null, payload: params as never });
  await db.insert(leadStatusEvents).values({ tenantId: account.tenantId, leadId: lead.id, previousStatus: lead.status, nextStatus: lead.status, actorUserId: null, note: `WattFox-Status: ${status || "Rückmeldung"}${reasonText ? ` (${reasonText})` : ""}` });
  return { status: 200, body: { ok: true, lead_id: lead.publicId, cancelled: false } };
}

/** Aroundhome-Abgleich: Vorgänge vom Export-Link laden (JSON oder CSV), Stornos zuordnen, Reklamationen anlegen. */
export async function syncAroundhomeAccount(db: Db, tenantId: number, id: number, fetchImpl: typeof fetch = fetch) {
  const account = (await db.select().from(partnerAccounts).where(and(eq(partnerAccounts.id, id), eq(partnerAccounts.tenantId, tenantId), eq(partnerAccounts.provider, "aroundhome"))).limit(1))[0];
  if (!account) throw new Error("Aroundhome-Konto wurde nicht gefunden.");
  const { accessToken, exportUrl } = readCredentials(account);
  if (!exportUrl) throw new Error("Für dieses Konto ist kein Export-Link hinterlegt.");
  const headers: Record<string, string> = { accept: "application/json, text/csv;q=0.9, */*;q=0.8" };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  const response = await fetchImpl(exportUrl, { headers });
  const text = await response.text();
  if (!response.ok) { const summary = `Abruf fehlgeschlagen (HTTP ${response.status})`; await db.update(partnerAccounts).set({ lastSyncAt: new Date(), lastSyncSummary: summary }).where(eq(partnerAccounts.id, account.id)); throw new Error(summary); }
  const rows = parseTransactions(text);
  let matched = 0; let cancelled = 0; let claimsCreated = 0;
  for (const row of rows) {
    const lead = await findLeadForPartner(db, tenantId, { partnerReference: row.reference, leadPublicId: row.leadPublicId });
    if (!lead) continue; matched += 1;
    if (!CANCEL_PATTERN.test(row.status)) continue; cancelled += 1;
    const alreadyLogged = (await db.select({ id: partnerCallbacks.id }).from(partnerCallbacks).where(and(eq(partnerCallbacks.tenantId, tenantId), eq(partnerCallbacks.provider, "aroundhome"), eq(partnerCallbacks.leadId, lead.id))).limit(1))[0];
    if (alreadyLogged) continue;
    const result = await recordPartnerCancellation(db, tenantId, account, { lead, status: row.status, reasonText: row.reason, payload: row.raw });
    if (result.claimId) claimsCreated += 1;
  }
  // Haustür-Erfassung: Abgleich je Sub-ID und Tag (Aroundhome liefert keine Kontaktdaten)
  const daily = rows.filter((row) => row.subId).map((row) => { const parsed = row.date ? new Date(row.date) : null; const day = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10); const status = CANCEL_PATTERN.test(row.status) ? "cancelled" as const : QUALIFIED_PATTERN.test(row.status) ? "qualified" as const : "open" as const; return { subId: row.subId.slice(0, 64), day, status }; });
  const dailyResult = daily.length ? await upsertDailyStats(db, tenantId, account.id, daily) : { days: 0 };
  const summary = `${rows.length} Vorgänge gelesen, ${matched} zugeordnet, ${cancelled} storniert, ${claimsCreated} Reklamationen angelegt${dailyResult.days ? `, ${dailyResult.days} Sub-ID-Tage abgeglichen` : ""}`;
  await db.update(partnerAccounts).set({ lastSyncAt: new Date(), lastSyncSummary: summary }).where(eq(partnerAccounts.id, account.id));
  return { rows: rows.length, matched, cancelled, claimsCreated, dailyDays: dailyResult.days, summary };
}

type Transaction = { reference: string; leadPublicId: string; status: string; reason: string; subId: string; date: string; raw: unknown };

const pick = (row: Record<string, unknown>, keys: string[]) => { for (const key of keys) { const hit = Object.keys(row).find((item) => item.toLowerCase() === key.toLowerCase()); if (hit && row[hit] !== undefined && row[hit] !== null && row[hit] !== "") return String(row[hit]); } return ""; };

/** Liest JSON (Array oder { data: [...] }) oder CSV mit Kopfzeile; Spaltennamen werden tolerant erkannt. */
export function parseTransactions(text: string): Transaction[] {
  let records: Record<string, unknown>[] = [];
  try { const parsed = JSON.parse(text); const list = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { data?: unknown[] }).data) ? (parsed as { data: unknown[] }).data : Array.isArray((parsed as { transactions?: unknown[] }).transactions) ? (parsed as { transactions: unknown[] }).transactions : []; records = list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object"); }
  catch {
    const lines = text.split(/\r?\n/).filter((line) => line.trim()); if (lines.length < 2) return [];
    const delimiter = lines[0].includes(";") ? ";" : ","; const header = lines[0].split(delimiter).map((cell) => cell.replace(/^"|"$/g, "").trim());
    records = lines.slice(1).map((line) => { const cells = line.split(delimiter).map((cell) => cell.replace(/^"|"$/g, "").trim()); return Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""])); });
  }
  return records.map((row) => ({ reference: pick(row, ["uuid", "inquiry_id", "inquiryId", "vorgangsnummer", "transaction_id", "id"]), leadPublicId: pick(row, ["lead_id", "external_id", "publisher_lead_id", "reference", "external_reference"]), status: pick(row, ["status", "state", "transaction_status"]), reason: pick(row, ["cancellation_reason", "cancel_reason", "storno_grund", "reason", "reason_text", "stornogrund"]), subId: pick(row, ["sub_id", "subid", "sub-id", "publisher_sub_id", "subId", "channel", "tracking_id"]), date: pick(row, ["created_at", "createdAt", "date", "created", "timestamp", "datum", "transaction_date"]), raw: row }));
}
