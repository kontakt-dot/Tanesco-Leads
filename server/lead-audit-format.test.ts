import { describe, expect, it } from "vitest";
import { formatIntegrationAuditEvent } from "./lead-audit-format";

describe("API-Auditformat", () => {
  it("zeigt Vorgangsreferenz, HTTP-Status und Rückmeldung einer erfolgreichen Übergabe", () => {
    expect(formatIntegrationAuditEvent({ eventType: "geliefert", integrationName: "PV-Partner", externalReference: "OUT-4711", responseStatus: 201, responseBody: "accepted" })).toEqual({ title: "API-Übergabe erfolgreich", detail: "Ziel: PV-Partner · Vorgang: OUT-4711 · HTTP 201 · Rückmeldung: accepted", tone: "gruen" });
  });

  it("zeichnet abgelehnte API-Übergaben eindeutig aus", () => {
    expect(formatIntegrationAuditEvent({ eventType: "abgelehnt", integrationName: null, externalReference: null, responseStatus: 422, responseBody: "validation failed" })).toMatchObject({ title: "API-Übergabe abgelehnt", tone: "rot" });
  });
});
