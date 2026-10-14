/**
 * Ausgehende API-Calls (Benutzer → Integration), Partner-Response-Mapping und Lieferanten-Rückgabe-Webhooks.
 *
 *  - Endpoints je Käufer und Lead-Kategorie: Methode, URL, Quell-/Feld-Filter, Header, Anmeldung per Token,
 *    Body-Template mit Platzhaltern {{first_name}} … {{custom_data.<key>}}, Werte-Mapping, Round-Robin.
 *  - Antworten werden protokolliert (integrationEvents.endpointId), die Partner-Referenz im Lead gespeichert.
 *  - Fehlerantworten laufen durch das Response-Mapping → Reklamationsgrund (siehe evaluateResponseRules).
 */
import { and, eq } from "drizzle-orm";
import { deliveryEndpoints, integrationEvents, leadCategories, leads, memberOperationalSettings, memberships, partnerResponseRules, reclamationReasons, supplierReturnWebhooks, type DeliveryEndpoint, type PartnerResponseRule } from "../drizzle/schema";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./integration-secrets";
import type { Db, LeadRow } from "./lead-pipeline";

export { PLACEHOLDERS, leadTemplateValues, renderTemplate, buildEndpointBody, matchesFieldFilters, matchesSourceFilter, selectEndpoints, extractPartnerReference, evaluateResponseRules, type FieldFilter, type ValueMapping, type HeaderPair, type AuthConfig } from "./outbound-templates";
import { buildEndpointBody, evaluateResponseRules, leadTemplateValues, readPath, selectEndpoints, extractPartnerReference, type AuthConfig, type HeaderPair } from "./outbound-templates";

/* ------------------------------------------------------------------ Anmeldung per Token */

const tokenCache = new Map<number, { token: string; expiresAt: number }>();


async function obtainToken(endpoint: DeliveryEndpoint, auth: AuthConfig, fetchImpl: typeof fetch, force = false) {
  const cached = tokenCache.get(endpoint.id);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.token;
  const credentials = Object.fromEntries(auth.credentials.filter((pair) => pair.name).map((pair) => [pair.name, pair.value]));
  const response = await fetchImpl(auth.loginUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(credentials) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Anmeldung beim Partner fehlgeschlagen (HTTP ${response.status})`);
  let parsed: unknown = text; try { parsed = JSON.parse(text); } catch { /* Token als Klartext */ }
  const token = String(readPath(parsed, auth.tokenPath) ?? (typeof parsed === "string" ? parsed : "")).trim();
  if (!token) throw new Error(`Token nicht in der Anmelde-Antwort gefunden (${auth.tokenPath})`);
  const ttl = auth.ttlMinutes && auth.ttlMinutes > 0 ? auth.ttlMinutes * 60_000 : 0;
  tokenCache.set(endpoint.id, { token, expiresAt: ttl ? Date.now() + ttl : 0 });
  return token;
}

export function decryptHeaders(encrypted: string | null): HeaderPair[] { if (!encrypted) return []; try { const parsed = JSON.parse(decryptIntegrationSecret(encrypted)); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
export function decryptAuth(encrypted: string | null): AuthConfig | null { if (!encrypted) return null; try { return JSON.parse(decryptIntegrationSecret(encrypted)) as AuthConfig; } catch { return null; } }
export const encryptJson = (value: unknown) => encryptIntegrationSecret(JSON.stringify(value));

/* ------------------------------------------------------------------ Senden */

export type EndpointSendResult = { endpointId: number; url: string; status: number | undefined; ok: boolean; body: string; partnerReference: string | null; error?: string; requestBody?: string };

export async function sendToEndpoint(endpoint: DeliveryEndpoint, values: Record<string, unknown>, options: { fetchImpl?: typeof fetch; skipEmptyFields?: boolean } = {}): Promise<EndpointSendResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const built = buildEndpointBody(endpoint, values);
  const body = options.skipEmptyFields && built.json ? JSON.stringify(stripEmpty(built.payload)) : built.body;
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  for (const pair of decryptHeaders(endpoint.headersEncrypted)) if (pair.name) headers[pair.name.toLowerCase()] = pair.value;
  const auth = endpoint.authEnabled ? decryptAuth(endpoint.authConfigEncrypted) : null;
  const attempt = async (forceLogin: boolean) => {
    if (auth?.loginUrl) { const token = await obtainToken(endpoint, auth, fetchImpl, forceLogin); headers[(auth.headerName || "authorization").toLowerCase()] = `${auth.prefix ? `${auth.prefix} ` : ""}${token}`; }
    const response = await fetchImpl(endpoint.url, { method: endpoint.method, headers, body });
    const text = await response.text().catch(() => "");
    return { response, text };
  };
  try {
    let { response, text } = await attempt(false);
    if ((response.status === 401 || response.status === 403) && auth?.loginUrl) ({ response, text } = await attempt(true));
    return { endpointId: endpoint.id, url: endpoint.url, status: response.status, ok: response.ok, body: text.slice(0, 5000), partnerReference: extractPartnerReference(text), requestBody: body };
  } catch (error) {
    return { endpointId: endpoint.id, url: endpoint.url, status: undefined, ok: false, body: "", partnerReference: null, error: error instanceof Error ? error.message : "Unbekannter Fehler", requestBody: body };
  }
}

function stripEmpty(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripEmpty);
  if (value && typeof value === "object") { const out: Record<string, unknown> = {}; for (const [key, item] of Object.entries(value as Record<string, unknown>)) { if (item === null || item === undefined || item === "") continue; out[key] = stripEmpty(item); } return out; }
  return value;
}

/* ------------------------------------------------------------------ Laden je Käufer */

export async function loadBuyerEndpoints(db: Db, tenantId: number, buyerUserId: number, categoryId: number) {
  const membership = (await db.select({ id: memberships.id, status: memberships.status }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, buyerUserId))).limit(1))[0];
  if (!membership) return { membership: null, endpoints: [] as DeliveryEndpoint[], rules: [] as PartnerResponseRule[], mappingEnabled: false };
  const [endpoints, settings, rules] = await Promise.all([
    db.select().from(deliveryEndpoints).where(and(eq(deliveryEndpoints.tenantId, tenantId), eq(deliveryEndpoints.membershipId, membership.id), eq(deliveryEndpoints.categoryId, categoryId))),
    db.select({ responseMappingEnabled: memberOperationalSettings.responseMappingEnabled }).from(memberOperationalSettings).where(eq(memberOperationalSettings.membershipId, membership.id)).limit(1),
    db.select().from(partnerResponseRules).where(and(eq(partnerResponseRules.tenantId, tenantId), eq(partnerResponseRules.membershipId, membership.id))),
  ]);
  return { membership, endpoints, rules, mappingEnabled: settings[0]?.responseMappingEnabled ?? false };
}

export type BuyerHandOver = { attempted: boolean; ok: boolean; status: number | undefined; results: EndpointSendResult[]; partnerReference: string | null; matchedRule: (PartnerResponseRule & { reasonName: string; forwardToNextStop: boolean }) | null; summary: string };

/** Übergabe eines Leads an alle passenden Endpoints des Käufers; protokolliert jede Antwort und speichert die Partner-Referenz. */
export async function handOverToBuyerEndpoints(db: Db, input: { tenantId: number; buyerUserId: number; lead: LeadRow; extraValues?: Record<string, unknown>; skipEmptyFields?: boolean; fetchImpl?: typeof fetch }): Promise<BuyerHandOver> {
  const loaded = await loadBuyerEndpoints(db, input.tenantId, input.buyerUserId, input.lead.categoryId);
  const category = (await db.select({ name: leadCategories.name, shortcode: leadCategories.shortcode }).from(leadCategories).where(eq(leadCategories.id, input.lead.categoryId)).limit(1))[0];
  const values = leadTemplateValues(input.lead, category, input.extraValues);
  const targets = selectEndpoints(loaded.endpoints, input.lead.supplierId, values);
  if (!targets.length) return { attempted: false, ok: false, status: undefined, results: [], partnerReference: null, matchedRule: null, summary: "kein passender Endpoint" };
  const results: EndpointSendResult[] = [];
  for (const endpoint of targets) {
    const result = await sendToEndpoint(endpoint, values, { fetchImpl: input.fetchImpl, skipEmptyFields: input.skipEmptyFields });
    results.push(result);
    await db.update(deliveryEndpoints).set({ sentCount: endpoint.sentCount + 1 }).where(eq(deliveryEndpoints.id, endpoint.id));
    await db.insert(integrationEvents).values({ tenantId: input.tenantId, endpointId: endpoint.id, leadId: input.lead.id, categoryId: input.lead.categoryId, eventType: result.ok ? "geliefert" : "abgelehnt", externalReference: result.partnerReference ?? input.lead.publicId, responseStatus: result.status, responseBody: result.error ?? result.body });
  }
  const failed = results.find((result) => !result.ok);
  const partnerReference = results.find((result) => result.partnerReference)?.partnerReference ?? null;
  if (partnerReference) { const meta = input.lead.metadata && typeof input.lead.metadata === "object" && !Array.isArray(input.lead.metadata) ? (input.lead.metadata as Record<string, unknown>) : {}; await db.update(leads).set({ metadata: { ...meta, partnerReference, partnerReferenceAt: new Date().toISOString() } }).where(eq(leads.id, input.lead.id)); }
  let matchedRule: BuyerHandOver["matchedRule"] = null;
  if (failed && loaded.mappingEnabled && loaded.rules.length) {
    const rule = evaluateResponseRules(loaded.rules, failed);
    if (rule) { const reason = (await db.select().from(reclamationReasons).where(eq(reclamationReasons.id, rule.reasonId)).limit(1))[0]; if (reason) matchedRule = { ...rule, reasonName: reason.name, forwardToNextStop: reason.forwardToNextStop }; }
  }
  const summary = results.map((result) => `${result.url.replace(/^https?:\/\//, "").slice(0, 40)}: HTTP ${result.status ?? "–"}${result.error ? ` (${result.error})` : ""}`).join("; ");
  return { attempted: true, ok: !failed, status: (failed ?? results[0]).status, results, partnerReference, matchedRule, summary };
}

/* ------------------------------------------------------------------ Rückgabe-Webhooks (Lieferant) */

export async function notifySupplierReturn(db: Db, input: { tenantId: number; supplierUserId: number; lead: LeadRow; reason: string | null; fetchImpl?: typeof fetch }) {
  const membership = (await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.userId, input.supplierUserId))).limit(1))[0];
  if (!membership) return null;
  const hook = (await db.select().from(supplierReturnWebhooks).where(and(eq(supplierReturnWebhooks.tenantId, input.tenantId), eq(supplierReturnWebhooks.membershipId, membership.id), eq(supplierReturnWebhooks.categoryId, input.lead.categoryId))).limit(1))[0];
  if (!hook?.enabled || !hook.url) return null;
  const category = (await db.select({ name: leadCategories.name, shortcode: leadCategories.shortcode }).from(leadCategories).where(eq(leadCategories.id, input.lead.categoryId)).limit(1))[0];
  const values = leadTemplateValues(input.lead, category, { returned: true, return_reason: input.reason ?? "", reclaim_reason: input.reason ?? "", reclaim_reason_label: input.reason ?? "", reclaim_reason_labels: input.reason ?? "" });
  const pseudo = { bodyTemplate: hook.bodyTemplate, omitAutoFields: hook.omitAutoFields, valueMappings: null } as Pick<DeliveryEndpoint, "bodyTemplate" | "omitAutoFields" | "valueMappings">;
  const built = buildEndpointBody(pseudo, values);
  const payload = built.json && built.payload && typeof built.payload === "object" ? { ...(built.payload as Record<string, unknown>), returned: true } : built.body;
  const headers: Record<string, string> = { "content-type": "application/json" };
  for (const pair of decryptHeaders(hook.headersEncrypted)) if (pair.name) headers[pair.name.toLowerCase()] = pair.value;
  try {
    const response = await (input.fetchImpl ?? fetch)(hook.url, { method: hook.method, headers, body: typeof payload === "string" ? payload : JSON.stringify(payload) });
    const text = await response.text().catch(() => "");
    await db.insert(integrationEvents).values({ tenantId: input.tenantId, leadId: input.lead.id, categoryId: input.lead.categoryId, eventType: response.ok ? "geliefert" : "abgelehnt", externalReference: `Rückgabe/${input.lead.publicId}`, responseStatus: response.status, responseBody: text.slice(0, 5000) });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    await db.insert(integrationEvents).values({ tenantId: input.tenantId, leadId: input.lead.id, categoryId: input.lead.categoryId, eventType: "abgelehnt", externalReference: `Rückgabe/${input.lead.publicId}`, responseStatus: undefined, responseBody: error instanceof Error ? error.message : "Unbekannter Fehler" });
    return { ok: false, status: 0 };
  }
}
