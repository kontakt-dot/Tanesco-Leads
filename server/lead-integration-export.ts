export type ExportableLead = {
  publicId: string;
  categoryId: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  postcode: string | null;
  city: string | null;
  country: string;
  metadata: unknown;
};

export function assertSafeExportUrl(callbackUrl: string) {
  const url = new URL(callbackUrl);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:") throw new Error("Die Exportadresse muss HTTPS verwenden.");
  if (host === "localhost" || host === "::1" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error("Die Exportadresse darf nicht auf ein internes Netzwerk zeigen.");
  return url.toString();
}

export function buildLeadExportPayload(lead: ExportableLead) {
  return { lead: { publicId: lead.publicId, categoryId: lead.categoryId, firstName: lead.firstName, lastName: lead.lastName, email: lead.email, phone: lead.phone, postcode: lead.postcode, city: lead.city, country: lead.country, fields: lead.metadata ?? {} } };
}

export type IntegrationExportConfig = { authMethod?: "api_key" | "bearer" | "basic" | "ohne"; headers?: Record<string, string>; payloadMapping?: Record<string, string>; [key: string]: unknown };

/**
 * Provider-Mapping der Integrationsvorlagen (z. B. GoHighLevel: `{ firstName: "firstName", locationId: "publisherId", customFields: "metadata" }`):
 * Zielschlüssel ← Quellfeld des Leads, "publisherId" (Partner-/Location-ID der Integration) oder "metadata" (alle Zusatzfelder).
 */
export function buildProviderPayload(lead: ExportableLead, mapping: Record<string, string>, publisherId?: string | null, provider?: string) {
  const fields = lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata) ? (lead.metadata as Record<string, unknown>) : {};
  const source: Record<string, unknown> = { ...fields, publicId: lead.publicId, categoryId: lead.categoryId, firstName: lead.firstName, lastName: lead.lastName, email: lead.email, phone: lead.phone, postcode: lead.postcode, city: lead.city, country: lead.country, publisherId: publisherId ?? null, metadata: fields };
  const payload: Record<string, unknown> = {};
  for (const [target, key] of Object.entries(mapping)) {
    if (!key) continue; const value = source[key]; if (value === undefined || value === null || value === "") continue;
    // GoHighLevel erwartet benutzerdefinierte Felder als Liste { key, field_value } (key = Feldschlüssel des Custom Fields im Sub-Account)
    payload[target] = provider === "gohighlevel" && target === "customFields" && key === "metadata" ? Object.entries(fields).filter(([, item]) => item !== null && item !== undefined && item !== "").map(([fieldKey, item]) => ({ key: fieldKey, field_value: typeof item === "object" ? JSON.stringify(item) : String(item) })) : value;
  }
  if (provider === "gohighlevel" && !payload.source) payload.source = "Tanesco Leads";
  return payload;
}

/** Entfernt leere Werte (null, undefined, "") rekursiv – Einstellung „Leere API-Felder auslassen“. */
export function stripEmptyValues<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripEmptyValues(item)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) { if (item === null || item === undefined || item === "") continue; result[key] = stripEmptyValues(item); }
    return result as T;
  }
  return value;
}

export async function dispatchLeadExport(input: { callbackUrl: string; lead: ExportableLead; externalReference?: string; authMethod?: "api_key" | "bearer" | "basic" | "ohne"; credential?: string; fetchImpl?: typeof fetch; provider?: string; publisherId?: string | null; config?: IntegrationExportConfig; skipEmptyFields?: boolean }) {
  const callbackUrl = assertSafeExportUrl(input.callbackUrl);
  const headers: Record<string, string> = { "content-type": "application/json", "x-fluxora-lead-reference": input.externalReference ?? input.lead.publicId };
  if (input.authMethod === "api_key" && input.credential) headers["x-api-key"] = input.credential;
  if (input.authMethod === "bearer" && input.credential) headers.authorization = `Bearer ${input.credential}`;
  if (input.authMethod === "basic" && input.credential) headers.authorization = input.credential.startsWith("Basic ") ? input.credential : `Basic ${Buffer.from(input.credential).toString("base64")}`;
  for (const [key, value] of Object.entries(input.config?.headers ?? {})) if (typeof value === "string" && value) headers[key.toLowerCase()] = value;
  const mapping = input.config?.payloadMapping && typeof input.config.payloadMapping === "object" ? input.config.payloadMapping : undefined;
  const rawPayload = mapping && Object.keys(mapping).length ? buildProviderPayload(input.lead, mapping, input.publisherId, input.provider) : buildLeadExportPayload(input.lead);
  const payload = input.skipEmptyFields ? stripEmptyValues(rawPayload) : rawPayload;
  const response = await (input.fetchImpl ?? fetch)(callbackUrl, { method: "POST", headers, body: JSON.stringify(payload) });
  const responseBody = (await response.text()).slice(0, 5000);
  return { eventType: response.ok ? "geliefert" as const : "abgelehnt" as const, externalReference: response.headers.get("x-request-id") ?? input.externalReference ?? input.lead.publicId, responseStatus: response.status, responseBody: responseBody || null };
}
