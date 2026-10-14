/**
 * Reine Template-, Filter- und Mapping-Logik der ausgehenden API-Calls – ohne Node-/Datenbankabhängigkeiten,
 * damit Server und Browser-Demo dieselben Regeln nutzen.
 */
export type TemplateLead = { id: number; publicId: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; postcode: string | null; city: string | null; country: string | null; metadata: unknown; createdAt: Date | string };
export type EndpointLike = { id: number; enabled: boolean; url: string; sourceFilterMode: "alle" | "nur" | "ausser"; sourceSupplierIds: unknown; fieldFilters: unknown; rotate: boolean; sentCount: number; position: number; bodyTemplate: string | null; omitAutoFields: boolean; valueMappings: unknown };
export type RuleLike = { id: number; source: "body" | "status"; field: string | null; op: "gleich" | "beginnt" | "enthaelt"; value: string; active: boolean; position: number };

export type HeaderPair = { name: string; value: string };
export type AuthConfig = { loginUrl: string; credentials: HeaderPair[]; tokenPath: string; headerName: string; prefix?: string; ttlMinutes?: number | null };
export type FieldFilter = { field: string; op: "gleich" | "enthaelt"; value: string };
export type ValueMapping = { field: string; ourValue: string; customerCode: string };

export const PLACEHOLDERS = ["lead_id", "lead_number", "salutation", "first_name", "last_name", "email", "phone", "street", "street_name", "house_number", "postal_code", "city", "country_code", "lead_type", "lead_type_shortcode", "date"] as const;

/* ------------------------------------------------------------------ Vorlagen */

export function leadTemplateValues(lead: TemplateLead, category?: { name: string; shortcode: string } | null, extra: Record<string, unknown> = {}) {
  const custom = lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata) ? (lead.metadata as Record<string, unknown>) : {};
  const street = String(custom.street ?? custom.strasse ?? "");
  const match = /^(.*?)[\s,]*(\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?)\s*$/.exec(street);
  const values: Record<string, unknown> = { lead_id: lead.publicId, lead_number: lead.id, salutation: String(custom.salutation ?? custom.anrede ?? ""), first_name: lead.firstName ?? "", last_name: lead.lastName ?? "", email: lead.email ?? "", phone: lead.phone ?? "", street, street_name: match ? match[1].trim() : street, house_number: match ? match[2] : "", postal_code: lead.postcode ?? "", city: lead.city ?? "", country_code: lead.country ?? "DE", lead_type: category?.name ?? "", lead_type_shortcode: category?.shortcode ?? "", date: new Date(lead.createdAt).toISOString(), ...extra };
  for (const [key, value] of Object.entries(custom)) values[`custom_data.${key}`] = value;
  return values;
}

const jsonEscape = (value: unknown) => JSON.stringify(value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value)).slice(1, -1);

/** Ersetzt {{platzhalter}} in einem JSON-Template; Werte werden JSON-sicher eingesetzt, unbekannte Platzhalter bleiben stehen. */
export function renderTemplate(template: string, values: Record<string, unknown>, valueMappings: ValueMapping[] = []) {
  const mapped: Record<string, unknown> = { ...values };
  for (const mapping of valueMappings) { const key = mapping.field.startsWith("custom_data.") ? mapping.field : `custom_data.${mapping.field}`; if (String(mapped[key] ?? "") === mapping.ourValue) mapped[key] = mapping.customerCode; }
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (whole, key: string) => (key in mapped ? jsonEscape(mapped[key]) : whole));
}

/** Baut den Request-Body: gerendertes Template (JSON) + automatische Felder lead_id/lead_number, sofern nicht abgeschaltet. */
export function buildEndpointBody(endpoint: Pick<EndpointLike, "bodyTemplate" | "omitAutoFields" | "valueMappings">, values: Record<string, unknown>) {
  const mappings = Array.isArray(endpoint.valueMappings) ? (endpoint.valueMappings as ValueMapping[]) : [];
  const rendered = endpoint.bodyTemplate?.trim() ? renderTemplate(endpoint.bodyTemplate, values, mappings) : JSON.stringify({ first_name: values.first_name, last_name: values.last_name, email: values.email, phone: values.phone, postal_code: values.postal_code, city: values.city, country_code: values.country_code, custom_data: Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith("custom_data.")).map(([key, value]) => [key.slice(12), value])) });
  let payload: unknown;
  try { payload = JSON.parse(rendered); } catch { return { body: rendered, json: false as const }; }
  if (!endpoint.omitAutoFields && payload && typeof payload === "object" && !Array.isArray(payload)) payload = { lead_id: values.lead_id, lead_number: values.lead_number, ...(payload as Record<string, unknown>) };
  return { body: JSON.stringify(payload), json: true as const, payload };
}

/* ------------------------------------------------------------------ Filter & Auswahl */

export function matchesFieldFilters(filters: FieldFilter[] | null | undefined, values: Record<string, unknown>) {
  if (!Array.isArray(filters) || !filters.length) return true;
  return filters.every((filter) => { const key = filter.field.startsWith("custom_data.") || filter.field in values ? filter.field : `custom_data.${filter.field}`; const actual = String(values[key] ?? "").toLowerCase(); const expected = filter.value.toLowerCase(); return filter.op === "enthaelt" ? actual.includes(expected) : actual === expected; });
}

export function matchesSourceFilter(endpoint: Pick<EndpointLike, "sourceFilterMode" | "sourceSupplierIds">, supplierId: number | null) {
  const ids = Array.isArray(endpoint.sourceSupplierIds) ? (endpoint.sourceSupplierIds as unknown[]).map(Number) : [];
  if (endpoint.sourceFilterMode === "nur") return supplierId !== null && ids.includes(supplierId);
  if (endpoint.sourceFilterMode === "ausser") return supplierId === null || !ids.includes(supplierId);
  return true;
}

/** Wählt die Endpoints, die einen Lead erhalten: alle passenden festen Calls plus genau einer der Round-Robin-Calls (reihum). */
export function selectEndpoints<T extends EndpointLike>(endpoints: T[], supplierId: number | null, values: Record<string, unknown>) {
  const eligible = endpoints.filter((endpoint) => endpoint.enabled && endpoint.url && matchesSourceFilter(endpoint, supplierId) && matchesFieldFilters(endpoint.fieldFilters as FieldFilter[] | null, values)).sort((a, b) => a.position - b.position || a.id - b.id);
  const fixed = eligible.filter((endpoint) => !endpoint.rotate);
  const rotating = eligible.filter((endpoint) => endpoint.rotate).sort((a, b) => a.sentCount - b.sentCount || a.position - b.position || a.id - b.id);
  return rotating.length ? [...fixed, rotating[0]] : fixed;
}

export const readPath = (value: unknown, path: string): unknown => path.split(".").filter(Boolean).reduce<unknown>((current, segment) => (current && typeof current === "object" ? (current as Record<string, unknown>)[segment] : undefined), value);

/** Referenz des Partners aus der Antwort (uuid, id, lead_id, reference, inquiry_id, data.id …). */
export function extractPartnerReference(text: string): string | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    for (const path of ["uuid", "id", "lead_id", "leadId", "reference", "inquiry_id", "inquiryId", "contact.id", "data.id", "data.uuid", "result.id"]) { const value = readPath(parsed, path); if (typeof value === "string" || typeof value === "number") return String(value).slice(0, 160); }
  } catch { /* keine JSON-Antwort */ }
  return null;
}

export function evaluateResponseRules<T extends RuleLike>(rules: T[], result: { status: number | undefined; body: string }) {
  let parsed: unknown = null; try { parsed = JSON.parse(result.body); } catch { parsed = null; }
  for (const rule of rules.filter((item) => item.active).sort((a, b) => a.position - b.position || a.id - b.id)) {
    const actual = rule.source === "status" ? String(result.status ?? "") : String(readPath(parsed, rule.field ?? "") ?? "");
    if (!actual) continue;
    const expected = rule.value; const a = actual.toLowerCase(); const e = expected.toLowerCase();
    if (rule.op === "gleich" ? a === e : rule.op === "beginnt" ? a.startsWith(e) : a.includes(e)) return rule;
  }
  return null;
}

