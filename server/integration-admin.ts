/**
 * Benutzer → Reiter „Integration“: ausgehende API-Calls, Partner-Response-Mapping, Lieferanten-Rückgabe-Webhooks.
 */
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { categoryFields, deliveryEndpoints, integrationPresets, leadCategories, memberOperationalSettings, partnerResponseRules, reclamationReasons, supplierReturnWebhooks, suppliers, users, type DeliveryEndpoint, type IntegrationPreset } from "../drizzle/schema";
import { decryptIntegrationSecret } from "./integration-secrets";
import type { Db } from "./lead-pipeline";
import { ensureMemberSettings, requireMembership } from "./member-admin";
import { PLACEHOLDERS, buildEndpointBody, decryptAuth, decryptHeaders, encryptJson, leadTemplateValues, sendToEndpoint, type AuthConfig, type FieldFilter, type HeaderPair, type ValueMapping } from "./outbound-endpoints";

export const SECRET_MASK = "••••••••";

/** Aroundhome-Preset für das Response-Mapping (Body-Feld code → Reklamationsgrund). */
export const AROUNDHOME_RESPONSE_PRESET: Array<{ value: string; label: string; reason: string }> = [
  { value: "2", label: "Ungültige Telefonnummer / Spam", reason: "Falsche Telefonnummer" },
  { value: "3", label: "Kontaktdaten fehlen / Land nicht unterstützt", reason: "Kontaktdaten fehlen" },
  { value: "4", label: "Kein Partner verfügbar", reason: "Kein Partner" },
  { value: "5", label: "Kunde existiert bereits (Duplikat)", reason: "Dublette" },
  { value: "6", label: "E-Mail auf Sperrliste", reason: "Sperrliste" },
];

function presentEndpoint(endpoint: DeliveryEndpoint) {
  const auth = decryptAuth(endpoint.authConfigEncrypted);
  return { id: endpoint.id, categoryId: endpoint.categoryId, enabled: endpoint.enabled, method: endpoint.method, url: endpoint.url, sourceFilterMode: endpoint.sourceFilterMode, sourceSupplierIds: Array.isArray(endpoint.sourceSupplierIds) ? (endpoint.sourceSupplierIds as number[]) : [], fieldFilters: Array.isArray(endpoint.fieldFilters) ? (endpoint.fieldFilters as FieldFilter[]) : [], headers: decryptHeaders(endpoint.headersEncrypted), authEnabled: endpoint.authEnabled, auth: auth ? { ...auth, credentials: auth.credentials.map((pair) => ({ name: pair.name, value: pair.value ? SECRET_MASK : "" })) } : null, bodyTemplate: endpoint.bodyTemplate ?? "", omitAutoFields: endpoint.omitAutoFields, rotate: endpoint.rotate, valueMappings: Array.isArray(endpoint.valueMappings) ? (endpoint.valueMappings as ValueMapping[]) : [], sentCount: endpoint.sentCount, position: endpoint.position };
}

export async function getMemberIntegration(db: Db, tenantId: number, membershipId: number) {
  await requireMembership(db, tenantId, membershipId);
  const settings = await ensureMemberSettings(db, tenantId, membershipId);
  const [endpoints, rules, hooks, categories, fields, supplierRows, reasons] = await Promise.all([
    db.select().from(deliveryEndpoints).where(and(eq(deliveryEndpoints.tenantId, tenantId), eq(deliveryEndpoints.membershipId, membershipId))).orderBy(asc(deliveryEndpoints.position), asc(deliveryEndpoints.id)),
    db.select().from(partnerResponseRules).where(and(eq(partnerResponseRules.tenantId, tenantId), eq(partnerResponseRules.membershipId, membershipId))).orderBy(asc(partnerResponseRules.position), asc(partnerResponseRules.id)),
    db.select().from(supplierReturnWebhooks).where(and(eq(supplierReturnWebhooks.tenantId, tenantId), eq(supplierReturnWebhooks.membershipId, membershipId))),
    db.select({ id: leadCategories.id, name: leadCategories.name, shortcode: leadCategories.shortcode }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId)),
    db.select({ categoryId: categoryFields.categoryId, fieldKey: categoryFields.fieldKey, label: categoryFields.label }).from(categoryFields),
    db.select({ id: suppliers.id, name: suppliers.name, email: suppliers.email }).from(suppliers).where(eq(suppliers.tenantId, tenantId)),
    db.select({ id: reclamationReasons.id, name: reclamationReasons.name, active: reclamationReasons.active, forwardToNextStop: reclamationReasons.forwardToNextStop }).from(reclamationReasons).where(eq(reclamationReasons.tenantId, tenantId)).orderBy(asc(reclamationReasons.sortOrder)),
  ]);
  const categoryIds = new Set(categories.map((category) => category.id));
  return {
    endpoints: endpoints.map(presentEndpoint),
    responseMappingEnabled: settings.responseMappingEnabled,
    rules: rules.map((rule) => ({ id: rule.id, source: rule.source, field: rule.field ?? "", op: rule.op, value: rule.value, label: rule.label ?? "", reasonId: rule.reasonId, active: rule.active })),
    returnWebhooks: hooks.map((hook) => ({ id: hook.id, categoryId: hook.categoryId, enabled: hook.enabled, method: hook.method, url: hook.url ?? "", headers: decryptHeaders(hook.headersEncrypted), bodyTemplate: hook.bodyTemplate ?? "", omitAutoFields: hook.omitAutoFields })),
    webhookUrl: settings.webhookUrl,
    categories,
    customFields: fields.filter((field) => categoryIds.has(field.categoryId)),
    suppliers: supplierRows,
    reasons,
    placeholders: [...PLACEHOLDERS],
    preset: AROUNDHOME_RESPONSE_PRESET,
  };
}

export type EndpointInput = { id?: number; categoryId: number; enabled: boolean; method: "POST" | "PUT" | "PATCH"; url: string; sourceFilterMode: "alle" | "nur" | "ausser"; sourceSupplierIds: number[]; fieldFilters: FieldFilter[]; headers: HeaderPair[]; authEnabled: boolean; auth: AuthConfig | null; bodyTemplate: string; omitAutoFields: boolean; rotate: boolean; valueMappings: ValueMapping[] };

export async function saveDeliveryEndpoint(db: Db, tenantId: number, membershipId: number, input: EndpointInput) {
  await requireMembership(db, tenantId, membershipId);
  const existing = input.id ? (await db.select().from(deliveryEndpoints).where(and(eq(deliveryEndpoints.id, input.id), eq(deliveryEndpoints.tenantId, tenantId), eq(deliveryEndpoints.membershipId, membershipId))).limit(1))[0] : undefined;
  if (input.id && !existing) throw new Error("Endpoint wurde nicht gefunden.");
  // Maskierte Zugangsdaten unverändert lassen
  let auth = input.auth;
  if (auth && existing) { const previous = decryptAuth(existing.authConfigEncrypted); auth = { ...auth, credentials: auth.credentials.map((pair) => ({ name: pair.name, value: pair.value === SECRET_MASK ? previous?.credentials.find((item) => item.name === pair.name)?.value ?? "" : pair.value })) }; }
  const values = { tenantId, membershipId, categoryId: input.categoryId, enabled: input.enabled, method: input.method, url: input.url.trim(), sourceFilterMode: input.sourceFilterMode, sourceSupplierIds: input.sourceSupplierIds, fieldFilters: input.fieldFilters.filter((filter) => filter.field && filter.value !== undefined), headersEncrypted: input.headers.filter((pair) => pair.name).length ? encryptJson(input.headers.filter((pair) => pair.name)) : null, authEnabled: input.authEnabled, authConfigEncrypted: auth ? encryptJson(auth) : null, bodyTemplate: input.bodyTemplate, omitAutoFields: input.omitAutoFields, rotate: input.rotate, valueMappings: input.valueMappings.filter((mapping) => mapping.field && mapping.ourValue) };
  if (existing) { await db.update(deliveryEndpoints).set(values).where(eq(deliveryEndpoints.id, existing.id)); return { id: existing.id }; }
  const siblings = await db.select({ position: deliveryEndpoints.position }).from(deliveryEndpoints).where(and(eq(deliveryEndpoints.membershipId, membershipId), eq(deliveryEndpoints.categoryId, input.categoryId)));
  const inserted = await db.insert(deliveryEndpoints).values({ ...values, position: siblings.length });
  return { id: Number(inserted[0]?.insertId) || 0 };
}

export async function deleteDeliveryEndpoint(db: Db, tenantId: number, membershipId: number, id: number) {
  await requireMembership(db, tenantId, membershipId);
  await db.delete(deliveryEndpoints).where(and(eq(deliveryEndpoints.id, id), eq(deliveryEndpoints.tenantId, tenantId), eq(deliveryEndpoints.membershipId, membershipId)));
  return { success: true as const };
}

export async function duplicateDeliveryEndpoint(db: Db, tenantId: number, membershipId: number, id: number) {
  await requireMembership(db, tenantId, membershipId);
  const source = (await db.select().from(deliveryEndpoints).where(and(eq(deliveryEndpoints.id, id), eq(deliveryEndpoints.tenantId, tenantId), eq(deliveryEndpoints.membershipId, membershipId))).limit(1))[0];
  if (!source) throw new Error("Endpoint wurde nicht gefunden.");
  const { id: _id, createdAt: _c, updatedAt: _u, sentCount: _s, ...rest } = source;
  const inserted = await db.insert(deliveryEndpoints).values({ ...rest, enabled: false, position: source.position + 1 });
  return { id: Number(inserted[0]?.insertId) || 0 };
}

/** „Test senden“: synthetischer Testlead mit Beispielwerten der Kategorie-Felder (test: true), Antwort wird nicht als Zustellung gewertet. */
export async function testDeliveryEndpoint(db: Db, tenantId: number, membershipId: number, id: number, fetchImpl?: typeof fetch) {
  await requireMembership(db, tenantId, membershipId);
  const endpoint = (await db.select().from(deliveryEndpoints).where(and(eq(deliveryEndpoints.id, id), eq(deliveryEndpoints.tenantId, tenantId), eq(deliveryEndpoints.membershipId, membershipId))).limit(1))[0];
  if (!endpoint) throw new Error("Endpoint wurde nicht gefunden.");
  const category = (await db.select({ name: leadCategories.name, shortcode: leadCategories.shortcode }).from(leadCategories).where(eq(leadCategories.id, endpoint.categoryId)).limit(1))[0];
  const fields = await db.select({ fieldKey: categoryFields.fieldKey, options: categoryFields.options }).from(categoryFields).where(eq(categoryFields.categoryId, endpoint.categoryId));
  const metadata: Record<string, unknown> = { salutation: "Herr", street: "Musterstraße 12", test: true };
  for (const field of fields) metadata[field.fieldKey] = Array.isArray(field.options) && (field.options as unknown[]).length ? String((field.options as unknown[])[0]) : `Beispiel ${field.fieldKey}`;
  const values = leadTemplateValues({ id: 0, publicId: `TEST-${nanoid(6).toUpperCase()}`, firstName: "Test", lastName: "Lead", email: "test@example.com", phone: "+49 30 0000000", postcode: "10115", city: "Berlin", country: "DE", metadata, createdAt: new Date() }, category, { test: true });
  const preview = buildEndpointBody(endpoint, values);
  const result = await sendToEndpoint(endpoint, values, { fetchImpl });
  return { ok: result.ok, status: result.status ?? 0, responseBody: result.error ?? result.body.slice(0, 1500), requestBody: preview.body };
}

export async function saveResponseMapping(db: Db, tenantId: number, membershipId: number, input: { enabled: boolean; rules: Array<{ source: "body" | "status"; field?: string | null; op: "gleich" | "beginnt" | "enthaelt"; value: string; label?: string | null; reasonId: number; active: boolean }> }) {
  await requireMembership(db, tenantId, membershipId);
  await ensureMemberSettings(db, tenantId, membershipId);
  await db.update(memberOperationalSettings).set({ responseMappingEnabled: input.enabled }).where(eq(memberOperationalSettings.membershipId, membershipId));
  await db.delete(partnerResponseRules).where(and(eq(partnerResponseRules.tenantId, tenantId), eq(partnerResponseRules.membershipId, membershipId)));
  const rows = input.rules.filter((rule) => rule.value.trim() && rule.reasonId > 0).map((rule, index) => ({ tenantId, membershipId, source: rule.source, field: rule.source === "body" ? (rule.field?.trim() || "code") : null, op: rule.op, value: rule.value.trim(), label: rule.label?.trim() || null, reasonId: rule.reasonId, active: rule.active, position: index }));
  if (rows.length) await db.insert(partnerResponseRules).values(rows);
  return { count: rows.length };
}

/** Legt die Aroundhome-Regeln an; fehlende Reklamationsgründe werden ergänzt. */
export async function applyAroundhomePreset(db: Db, tenantId: number, membershipId: number) {
  await requireMembership(db, tenantId, membershipId);
  const reasons = await db.select({ id: reclamationReasons.id, name: reclamationReasons.name }).from(reclamationReasons).where(eq(reclamationReasons.tenantId, tenantId));
  const byName = new Map(reasons.map((reason) => [reason.name.toLowerCase(), reason.id]));
  for (const item of AROUNDHOME_RESPONSE_PRESET) {
    if (byName.has(item.reason.toLowerCase())) continue;
    const inserted = await db.insert(reclamationReasons).values({ tenantId, name: item.reason, description: `Partner-Rückmeldung (${item.label})`, systemReason: item.reason === "Dublette", active: true, forwardToNextStop: true, sortOrder: reasons.length + byName.size });
    byName.set(item.reason.toLowerCase(), Number(inserted[0]?.insertId));
  }
  const existing = await db.select().from(partnerResponseRules).where(and(eq(partnerResponseRules.tenantId, tenantId), eq(partnerResponseRules.membershipId, membershipId)));
  const rules = [...existing.map((rule) => ({ source: rule.source, field: rule.field, op: rule.op, value: rule.value, label: rule.label, reasonId: rule.reasonId, active: rule.active }))];
  for (const item of AROUNDHOME_RESPONSE_PRESET) if (!rules.some((rule) => rule.source === "body" && rule.field === "code" && rule.value === item.value)) rules.push({ source: "body", field: "code", op: "gleich", value: item.value, label: item.label, reasonId: byName.get(item.reason.toLowerCase())!, active: true });
  return saveResponseMapping(db, tenantId, membershipId, { enabled: true, rules });
}

export async function saveSupplierReturnWebhook(db: Db, tenantId: number, membershipId: number, input: { categoryId: number; enabled: boolean; method: "POST" | "PUT" | "PATCH"; url: string; headers: HeaderPair[]; bodyTemplate: string; omitAutoFields: boolean }) {
  await requireMembership(db, tenantId, membershipId);
  const values = { tenantId, membershipId, categoryId: input.categoryId, enabled: input.enabled, method: input.method, url: input.url.trim() || null, headersEncrypted: input.headers.filter((pair) => pair.name).length ? encryptJson(input.headers.filter((pair) => pair.name)) : null, bodyTemplate: input.bodyTemplate, omitAutoFields: input.omitAutoFields };
  const existing = (await db.select({ id: supplierReturnWebhooks.id }).from(supplierReturnWebhooks).where(and(eq(supplierReturnWebhooks.membershipId, membershipId), eq(supplierReturnWebhooks.categoryId, input.categoryId))).limit(1))[0];
  if (existing) await db.update(supplierReturnWebhooks).set(values).where(eq(supplierReturnWebhooks.id, existing.id)); else await db.insert(supplierReturnWebhooks).values(values);
  return { success: true as const };
}

export async function testSupplierReturnWebhook(db: Db, tenantId: number, membershipId: number, categoryId: number, fetchImpl?: typeof fetch) {
  await requireMembership(db, tenantId, membershipId);
  const hook = (await db.select().from(supplierReturnWebhooks).where(and(eq(supplierReturnWebhooks.membershipId, membershipId), eq(supplierReturnWebhooks.categoryId, categoryId))).limit(1))[0];
  if (!hook?.url) throw new Error("Für diese Kategorie ist keine Rückgabe-URL hinterlegt.");
  const category = (await db.select({ name: leadCategories.name, shortcode: leadCategories.shortcode }).from(leadCategories).where(eq(leadCategories.id, categoryId)).limit(1))[0];
  const values = leadTemplateValues({ id: 0, publicId: `TEST-${nanoid(6).toUpperCase()}`, firstName: "Test", lastName: "Lead", email: "test@example.com", phone: "+49 30 0000000", postcode: "10115", city: "Berlin", country: "DE", metadata: { test: true }, createdAt: new Date() }, category, { returned: true, return_reason: "Test", reclaim_reason: "Test", reclaim_reason_label: "Test", reclaim_reason_labels: "Test", test: true });
  const pseudo = { id: hook.id, method: hook.method, url: hook.url, bodyTemplate: hook.bodyTemplate, omitAutoFields: hook.omitAutoFields, valueMappings: null, headersEncrypted: hook.headersEncrypted, authEnabled: false, authConfigEncrypted: null } as DeliveryEndpoint;
  const result = await sendToEndpoint(pseudo, values, { fetchImpl });
  return { ok: result.ok, status: result.status ?? 0, responseBody: result.error ?? result.body.slice(0, 1500), requestBody: result.requestBody ?? "" };
}

/** Standard-Body für neue Rückgabe-Webhooks (alle Standardfelder + Zusatzfelder der Kategorie). */
export function defaultReturnTemplate(fieldKeys: string[]) {
  const lines = ['  "lead_id": "{{lead_id}}"', '  "lead_number": "{{lead_number}}"', '  "returned": "{{returned}}"', '  "reclaim_reason": "{{reclaim_reason}}"', '  "salutation": "{{salutation}}"', '  "first_name": "{{first_name}}"', '  "last_name": "{{last_name}}"', '  "email": "{{email}}"', '  "phone": "{{phone}}"', '  "street": "{{street}}"', '  "postal_code": "{{postal_code}}"', '  "city": "{{city}}"', '  "country_code": "{{country_code}}"', '  "lead_type": "{{lead_type_shortcode}}"'];
  if (fieldKeys.length) lines.push(`  "custom_data": {\n${fieldKeys.map((key) => `    "${key}": "{{custom_data.${key}}}"`).join(",\n")}\n  }`);
  return `{\n${lines.join(",\n")}\n}`;
}


/* ------------------------------------------------------------------ Presets: einmal anlegen, bei anderen Benutzern hinzufügen */

type EndpointPresetPayload = { method: DeliveryEndpoint["method"]; url: string; sourceFilterMode: DeliveryEndpoint["sourceFilterMode"]; fieldFilters: FieldFilter[]; headers: HeaderPair[]; authEnabled: boolean; auth: AuthConfig | null; bodyTemplate: string; omitAutoFields: boolean; rotate: boolean; valueMappings: ValueMapping[] };
type MappingPresetPayload = { enabled: boolean; rules: Array<{ source: "body" | "status"; field: string | null; op: "gleich" | "beginnt" | "enthaelt"; value: string; label: string | null; reasonName: string; active: boolean }> };
type ReturnPresetPayload = { method: DeliveryEndpoint["method"]; url: string; headers: HeaderPair[]; bodyTemplate: string; omitAutoFields: boolean };

const readPreset = (preset: IntegrationPreset) => JSON.parse(decryptIntegrationSecret(preset.payloadEncrypted)) as EndpointPresetPayload | MappingPresetPayload | ReturnPresetPayload;

export async function listIntegrationPresets(db: Db, tenantId: number) {
  const rows = await db.select({ preset: integrationPresets, category: leadCategories.name, shortcode: leadCategories.shortcode, creator: users.name }).from(integrationPresets).leftJoin(leadCategories, eq(leadCategories.id, integrationPresets.categoryId)).leftJoin(users, eq(users.id, integrationPresets.createdByUserId)).where(eq(integrationPresets.tenantId, tenantId)).orderBy(asc(integrationPresets.kind), asc(integrationPresets.name));
  return rows.map(({ preset, category, shortcode, creator }) => { const payload = readPreset(preset); const summary = preset.kind === "endpoint" ? `${(payload as EndpointPresetPayload).method} ${(payload as EndpointPresetPayload).url}` : preset.kind === "response_mapping" ? `${(payload as MappingPresetPayload).rules.length} Regeln` : `${(payload as ReturnPresetPayload).method} ${(payload as ReturnPresetPayload).url}`; return { id: preset.id, name: preset.name, description: preset.description, kind: preset.kind, categoryId: preset.categoryId, categoryName: category, categoryShortcode: shortcode, usageCount: preset.usageCount, createdBy: creator, createdAt: preset.createdAt, summary, hasSecrets: preset.kind !== "response_mapping" && ((payload as EndpointPresetPayload).headers?.some((pair) => pair.value) || Boolean((payload as EndpointPresetPayload).auth?.credentials?.some((pair) => pair.value))) }; });
}

/** Endpoint eines Benutzers als Preset sichern (inklusive Header/Zugangsdaten, verschlüsselt). */
export async function saveEndpointPreset(db: Db, tenantId: number, userId: number, input: { membershipId: number; endpointId: number; name: string; description?: string | null; includeSecrets: boolean }) {
  await requireMembership(db, tenantId, input.membershipId);
  const endpoint = (await db.select().from(deliveryEndpoints).where(and(eq(deliveryEndpoints.id, input.endpointId), eq(deliveryEndpoints.tenantId, tenantId), eq(deliveryEndpoints.membershipId, input.membershipId))).limit(1))[0];
  if (!endpoint) throw new Error("Endpoint wurde nicht gefunden.");
  const auth = decryptAuth(endpoint.authConfigEncrypted);
  const payload: EndpointPresetPayload = { method: endpoint.method, url: endpoint.url, sourceFilterMode: "alle", fieldFilters: Array.isArray(endpoint.fieldFilters) ? (endpoint.fieldFilters as FieldFilter[]) : [], headers: decryptHeaders(endpoint.headersEncrypted).map((pair) => ({ name: pair.name, value: input.includeSecrets ? pair.value : "" })), authEnabled: endpoint.authEnabled, auth: auth ? { ...auth, credentials: auth.credentials.map((pair) => ({ name: pair.name, value: input.includeSecrets ? pair.value : "" })) } : null, bodyTemplate: endpoint.bodyTemplate ?? "", omitAutoFields: endpoint.omitAutoFields, rotate: endpoint.rotate, valueMappings: Array.isArray(endpoint.valueMappings) ? (endpoint.valueMappings as ValueMapping[]) : [] };
  const inserted = await db.insert(integrationPresets).values({ tenantId, name: input.name.trim(), description: input.description?.trim() || null, kind: "endpoint", categoryId: endpoint.categoryId, payloadEncrypted: encryptJson(payload), createdByUserId: userId });
  return { id: Number(inserted[0]?.insertId) || 0 };
}

export async function saveResponseMappingPreset(db: Db, tenantId: number, userId: number, input: { membershipId: number; name: string; description?: string | null }) {
  await requireMembership(db, tenantId, input.membershipId);
  const settings = await ensureMemberSettings(db, tenantId, input.membershipId);
  const rules = await db.select({ rule: partnerResponseRules, reasonName: reclamationReasons.name }).from(partnerResponseRules).innerJoin(reclamationReasons, eq(reclamationReasons.id, partnerResponseRules.reasonId)).where(and(eq(partnerResponseRules.tenantId, tenantId), eq(partnerResponseRules.membershipId, input.membershipId))).orderBy(asc(partnerResponseRules.position));
  if (!rules.length) throw new Error("Für diesen Benutzer sind keine Mapping-Regeln hinterlegt.");
  const payload: MappingPresetPayload = { enabled: settings.responseMappingEnabled, rules: rules.map(({ rule, reasonName }) => ({ source: rule.source, field: rule.field, op: rule.op, value: rule.value, label: rule.label, reasonName, active: rule.active })) };
  const inserted = await db.insert(integrationPresets).values({ tenantId, name: input.name.trim(), description: input.description?.trim() || null, kind: "response_mapping", categoryId: null, payloadEncrypted: encryptJson(payload), createdByUserId: userId });
  return { id: Number(inserted[0]?.insertId) || 0 };
}

export async function saveReturnWebhookPreset(db: Db, tenantId: number, userId: number, input: { membershipId: number; categoryId: number; name: string; description?: string | null; includeSecrets: boolean }) {
  await requireMembership(db, tenantId, input.membershipId);
  const hook = (await db.select().from(supplierReturnWebhooks).where(and(eq(supplierReturnWebhooks.membershipId, input.membershipId), eq(supplierReturnWebhooks.categoryId, input.categoryId))).limit(1))[0];
  if (!hook?.url) throw new Error("Für diese Kategorie ist kein Rückgabe-Webhook hinterlegt.");
  const payload: ReturnPresetPayload = { method: hook.method, url: hook.url, headers: decryptHeaders(hook.headersEncrypted).map((pair) => ({ name: pair.name, value: input.includeSecrets ? pair.value : "" })), bodyTemplate: hook.bodyTemplate ?? "", omitAutoFields: hook.omitAutoFields };
  const inserted = await db.insert(integrationPresets).values({ tenantId, name: input.name.trim(), description: input.description?.trim() || null, kind: "return_webhook", categoryId: input.categoryId, payloadEncrypted: encryptJson(payload), createdByUserId: userId });
  return { id: Number(inserted[0]?.insertId) || 0 };
}

/** Preset bei einem Benutzer hinzufügen; URL, Kategorie und Schlüssel können beim Hinzufügen überschrieben werden. */
export async function applyIntegrationPreset(db: Db, tenantId: number, userId: number, input: { presetId: number; membershipId: number; categoryId?: number | null; url?: string | null; headers?: HeaderPair[] | null; authCredentials?: HeaderPair[] | null }) {
  await requireMembership(db, tenantId, input.membershipId);
  const preset = (await db.select().from(integrationPresets).where(and(eq(integrationPresets.id, input.presetId), eq(integrationPresets.tenantId, tenantId))).limit(1))[0];
  if (!preset) throw new Error("Preset wurde nicht gefunden.");
  const payload = readPreset(preset);
  let result: { kind: IntegrationPreset["kind"]; id: number; count?: number };
  if (preset.kind === "endpoint") {
    const data = payload as EndpointPresetPayload; const categoryId = input.categoryId ?? preset.categoryId; if (!categoryId) throw new Error("Bitte eine Lead-Kategorie wählen.");
    const merge = (base: HeaderPair[], overrides: HeaderPair[] | null | undefined) => base.filter((pair) => pair.name).map((pair) => ({ name: pair.name, value: overrides?.find((item) => item.name === pair.name)?.value?.trim() || pair.value }));
    const headers = merge(data.headers ?? [], input.headers);
    const auth = data.auth ? { ...data.auth, credentials: merge(data.auth.credentials ?? [], input.authCredentials) } : null;
    if (headers.some((pair) => !pair.value) || (auth?.credentials ?? []).some((pair) => !pair.value)) throw new Error("Bitte die fehlenden Schlüssel bzw. Zugangsdaten für diesen Benutzer eintragen.");
    const saved = await saveDeliveryEndpoint(db, tenantId, input.membershipId, { categoryId, enabled: true, method: data.method, url: input.url?.trim() || data.url, sourceFilterMode: data.sourceFilterMode, sourceSupplierIds: [], fieldFilters: data.fieldFilters ?? [], headers, authEnabled: data.authEnabled, auth, bodyTemplate: data.bodyTemplate, omitAutoFields: data.omitAutoFields, rotate: data.rotate, valueMappings: data.valueMappings ?? [] });
    result = { kind: "endpoint", id: saved.id };
  } else if (preset.kind === "response_mapping") {
    const data = payload as MappingPresetPayload;
    const reasons = await db.select({ id: reclamationReasons.id, name: reclamationReasons.name }).from(reclamationReasons).where(eq(reclamationReasons.tenantId, tenantId));
    const existing = await db.select().from(partnerResponseRules).where(and(eq(partnerResponseRules.tenantId, tenantId), eq(partnerResponseRules.membershipId, input.membershipId)));
    const rules = existing.map((rule) => ({ source: rule.source, field: rule.field, op: rule.op, value: rule.value, label: rule.label, reasonId: rule.reasonId, active: rule.active }));
    let added = 0;
    for (const rule of data.rules) { let reason = reasons.find((item) => item.name.toLowerCase() === rule.reasonName.toLowerCase()); if (!reason) { const inserted = await db.insert(reclamationReasons).values({ tenantId, name: rule.reasonName, description: "Aus Integrations-Preset", systemReason: false, active: true, forwardToNextStop: true, sortOrder: reasons.length }); reason = { id: Number(inserted[0]?.insertId), name: rule.reasonName }; reasons.push(reason); } if (!rules.some((item) => item.source === rule.source && item.field === rule.field && item.value === rule.value)) { rules.push({ source: rule.source, field: rule.field, op: rule.op, value: rule.value, label: rule.label, reasonId: reason.id, active: rule.active }); added += 1; } }
    await saveResponseMapping(db, tenantId, input.membershipId, { enabled: data.enabled || true, rules });
    result = { kind: "response_mapping", id: input.membershipId, count: added };
  } else {
    const data = payload as ReturnPresetPayload; const categoryId = input.categoryId ?? preset.categoryId; if (!categoryId) throw new Error("Bitte eine Lead-Kategorie wählen.");
    const headers = (data.headers ?? []).filter((pair) => pair.name).map((pair) => ({ name: pair.name, value: input.headers?.find((item) => item.name === pair.name)?.value?.trim() || pair.value }));
    if (headers.some((pair) => !pair.value)) throw new Error("Bitte die fehlenden Schlüssel für diesen Benutzer eintragen.");
    await saveSupplierReturnWebhook(db, tenantId, input.membershipId, { categoryId, enabled: true, method: data.method, url: input.url?.trim() || data.url, headers, bodyTemplate: data.bodyTemplate, omitAutoFields: data.omitAutoFields });
    result = { kind: "return_webhook", id: categoryId };
  }
  await db.update(integrationPresets).set({ usageCount: preset.usageCount + 1 }).where(eq(integrationPresets.id, preset.id));
  void userId;
  return result;
}

export async function updateIntegrationPreset(db: Db, tenantId: number, input: { id: number; name?: string; description?: string | null }) {
  await db.update(integrationPresets).set({ ...(input.name ? { name: input.name.trim() } : {}), ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}) }).where(and(eq(integrationPresets.id, input.id), eq(integrationPresets.tenantId, tenantId)));
  return { success: true as const };
}

export async function deleteIntegrationPreset(db: Db, tenantId: number, id: number) {
  await db.delete(integrationPresets).where(and(eq(integrationPresets.id, id), eq(integrationPresets.tenantId, tenantId)));
  return { success: true as const };
}

/** Welche Felder ein Preset beim Hinzufügen noch braucht (fehlende Schlüssel). */
export async function integrationPresetRequirements(db: Db, tenantId: number, presetId: number) {
  const preset = (await db.select().from(integrationPresets).where(and(eq(integrationPresets.id, presetId), eq(integrationPresets.tenantId, tenantId))).limit(1))[0];
  if (!preset) throw new Error("Preset wurde nicht gefunden.");
  const payload = readPreset(preset);
  if (preset.kind === "response_mapping") return { kind: preset.kind, url: null, headers: [], authCredentials: [], categoryId: null };
  const data = payload as EndpointPresetPayload | ReturnPresetPayload;
  return { kind: preset.kind, url: data.url, headers: data.headers.map((pair) => ({ name: pair.name, missing: !pair.value })), authCredentials: preset.kind === "endpoint" && (data as EndpointPresetPayload).auth ? (data as EndpointPresetPayload).auth!.credentials.map((pair) => ({ name: pair.name, missing: !pair.value })) : [], categoryId: preset.categoryId };
}
