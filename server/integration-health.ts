import { and, eq } from "drizzle-orm";
import { deliveryEndpoints, integrationEvents, partnerIntegrations } from "../drizzle/schema";
import { HEALTH_CHECK } from "../shared/api-errors";
import { getDb } from "./db";

/** Nur öffentliche HTTPS-Adressen werden geprüft – nie das eigene Netz (localhost, private Bereiche). */
export function isSafeHealthUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^0\./.test(host)) return false;
    if (host === "::1" || host === "::" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return false;
    const parts = host.match(/^172\.(\d+)\./); if (parts && Number(parts[1]) >= 16 && Number(parts[1]) <= 31) return false;
    return true;
  } catch { return false; }
}

export type ProbeResult = { ok: boolean; status: number | undefined; detail: string };
/**
 * Erreichbarkeit einer Adresse prüfen – ohne Daten zu senden (Anfrage „OPTIONS“).
 * `strict` (Partner-Schnittstellen): nur 2xx/3xx sowie 401/403/405 gelten als erreichbar.
 * Ohne `strict` (Adressen der Käufer): Jede Antwort unter 500 heißt „der Empfänger ist da“ – viele Adressen kennen nur „POST“ und antworten auf die Probe mit 404.
 */
export async function probeUrl(endpoint: string | null | undefined, options: { strict?: boolean; fetchImpl?: typeof fetch } = {}): Promise<ProbeResult> {
  if (!endpoint || !isSafeHealthUrl(endpoint)) return { ok: false, status: undefined, detail: "Gesundheitscheck übersprungen: Es fehlt eine sichere öffentliche HTTPS-Adresse." };
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, { method: "OPTIONS", redirect: "manual", signal: AbortSignal.timeout(12_000), headers: { "user-agent": "Tanesco-Leads-Healthcheck/1.0" } });
    const status = response.status;
    const reachable = options.strict ? (status >= 200 && status < 400) || status === 401 || status === 403 || status === 405 : status < 500;
    return reachable ? { ok: true, status, detail: `Endpunkt erreichbar · HTTP ${status}` } : { ok: false, status, detail: `Endpunkt antwortet mit HTTP ${status}` };
  } catch (error) { return { ok: false, status: undefined, detail: `Endpunkt nicht erreichbar: ${error instanceof Error ? error.message.slice(0, 400) : "Unbekannter Fehler"}` }; }
}

/**
 * Alle aktiven Schnittstellen prüfen: Partner-Schnittstellen und die Adressen der Käufer. Das Ergebnis steht als Ereignis „healthcheck“
 * im Protokoll und unter „API-Fehler“ → „API-Gesundheit“. Mit `tenantId` nur für einen Mandanten (Knopf „Jetzt prüfen“).
 */
export async function runIntegrationHealthChecks(tenantId?: number, fetchImpl?: typeof fetch) {
  const db = await getDb();
  if (!db) throw new Error("Die Datenbank ist nicht verfügbar.");
  const active = await db.select({ id: partnerIntegrations.id, tenantId: partnerIntegrations.tenantId, name: partnerIntegrations.name, callbackUrl: partnerIntegrations.callbackUrl }).from(partnerIntegrations).where(tenantId ? and(eq(partnerIntegrations.status, "aktiv"), eq(partnerIntegrations.tenantId, tenantId)) : eq(partnerIntegrations.status, "aktiv"));
  const endpoints = await db.select({ id: deliveryEndpoints.id, tenantId: deliveryEndpoints.tenantId, url: deliveryEndpoints.url }).from(deliveryEndpoints).where(tenantId ? and(eq(deliveryEndpoints.enabled, true), eq(deliveryEndpoints.tenantId, tenantId)) : eq(deliveryEndpoints.enabled, true));
  let healthy = 0; let warnings = 0;
  for (const integration of active) {
    const probe = await probeUrl(integration.callbackUrl, { strict: true, fetchImpl });
    if (probe.ok) healthy += 1; else warnings += 1;
    await db.insert(integrationEvents).values({ tenantId: integration.tenantId, integrationId: integration.id, eventType: probe.ok ? "offen" : "abgelehnt", externalReference: HEALTH_CHECK, responseStatus: probe.status, responseBody: probe.detail });
  }
  for (const endpoint of endpoints) {
    const probe = await probeUrl(endpoint.url, { fetchImpl });
    if (probe.ok) healthy += 1; else warnings += 1;
    await db.insert(integrationEvents).values({ tenantId: endpoint.tenantId, endpointId: endpoint.id, eventType: probe.ok ? "offen" : "abgelehnt", externalReference: HEALTH_CHECK, responseStatus: probe.status, responseBody: probe.detail });
  }
  return { checked: active.length + endpoints.length, healthy, warnings, checkedAt: new Date() };
}
