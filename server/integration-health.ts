import { and, eq } from "drizzle-orm";
import { integrationEvents, partnerIntegrations } from "../drizzle/schema";
import { getDb } from "./db";

export function isSafeHealthUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || host === "localhost" || host.endsWith(".local")) return false;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false;
    const parts = host.match(/^172\.(\d+)\./); if (parts && Number(parts[1]) >= 16 && Number(parts[1]) <= 31) return false;
    return true;
  } catch { return false; }
}

export async function runIntegrationHealthChecks() {
  const db = await getDb();
  if (!db) throw new Error("Die Datenbank ist nicht verfügbar.");
  const active = await db.select({ id: partnerIntegrations.id, tenantId: partnerIntegrations.tenantId, name: partnerIntegrations.name, callbackUrl: partnerIntegrations.callbackUrl }).from(partnerIntegrations).where(eq(partnerIntegrations.status, "aktiv"));
  let healthy = 0; let warnings = 0;
  for (const integration of active) {
    const endpoint = integration.callbackUrl;
    let status: number | undefined; let eventType: "offen" | "abgelehnt" = "offen"; let detail = "";
    if (!endpoint || !isSafeHealthUrl(endpoint)) { eventType = "abgelehnt"; detail = "Gesundheitscheck übersprungen: Es fehlt eine sichere öffentliche HTTPS-Adresse."; warnings += 1; }
    else {
      try {
        const response = await fetch(endpoint, { method: "OPTIONS", redirect: "manual", signal: AbortSignal.timeout(12_000), headers: { "user-agent": "Tanesco-Leads-Healthcheck/1.0" } });
        status = response.status;
        const reachable = (response.status >= 200 && response.status < 400) || response.status === 401 || response.status === 403 || response.status === 405;
        if (reachable) { healthy += 1; detail = `Endpunkt erreichbar · HTTP ${response.status}`; } else { eventType = "abgelehnt"; warnings += 1; detail = `Endpunkt antwortet mit HTTP ${response.status}`; }
      } catch (error) { eventType = "abgelehnt"; warnings += 1; detail = `Endpunkt nicht erreichbar: ${error instanceof Error ? error.message.slice(0, 400) : "Unbekannter Fehler"}`; }
    }
    await db.insert(integrationEvents).values({ tenantId: integration.tenantId, integrationId: integration.id, eventType, externalReference: "healthcheck", responseStatus: status, responseBody: detail });
  }
  return { checked: active.length, healthy, warnings, checkedAt: new Date() };
}
