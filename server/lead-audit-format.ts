export type IntegrationAuditEvent = {
  eventType: "geliefert" | "abgelehnt" | "angenommen" | "offen" | "anerkannt" | "storniert";
  integrationName: string | null;
  externalReference: string | null;
  responseStatus: number | null;
  responseBody: string | null;
};

export function formatIntegrationAuditEvent(event: IntegrationAuditEvent) {
  const detail = [
    event.integrationName ? `Ziel: ${event.integrationName}` : "Zielintegration",
    event.externalReference ? `Vorgang: ${event.externalReference}` : null,
    event.responseStatus ? `HTTP ${event.responseStatus}` : null,
    event.responseBody ? `Rückmeldung: ${event.responseBody}` : null,
  ].filter(Boolean).join(" · ");
  return {
    title: event.eventType === "geliefert" || event.eventType === "angenommen" ? "API-Übergabe erfolgreich" : event.eventType === "abgelehnt" ? "API-Übergabe abgelehnt" : `API-Übergabe ${event.eventType}`,
    detail,
    tone: event.eventType === "abgelehnt" ? "rot" : event.eventType === "geliefert" || event.eventType === "angenommen" ? "gruen" : "blau",
  };
}
