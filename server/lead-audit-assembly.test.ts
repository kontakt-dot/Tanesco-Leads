import { describe, expect, it } from "vitest";
import { buildLeadAuditLog } from "./lead-audit-assembly";

describe("kombiniertes Lead Log", () => {
  it("vereint alle Auditquellen, zeigt API-Rückmeldung und sortiert neue Ereignisse zuerst", () => {
    const at = (second: number) => new Date(`2026-08-18T10:00:0${second}.000Z`);
    const events = buildLeadAuditLog({
      lead: { id: 11, categoryId: 150001, status: "neu", createdAt: at(1) },
      deliveries: [{ id: 21, occurredAt: at(2), result: "angeboten", buyerName: "Solar Nord", unitPrice: "52.00" }],
      claimRows: [{ id: 31, createdAt: at(3), reason: "Doppelter Kontakt" }],
      claimEventRows: [{ claimId: 31, occurredAt: at(4), eventType: "frist_gesetzt", previousStatus: "offen", nextStatus: "in_pruefung", note: "Prüfung bis 25.08." }],
      statusRows: [{ id: 41, occurredAt: at(5), previousStatus: "neu", nextStatus: "zugewiesen", note: "Auslieferung an Solar Nord" }],
      integrationRows: [{ occurredAt: at(6), eventType: "geliefert", integrationName: "PV-Partner", externalReference: "OUT-4711", responseStatus: 201, responseBody: "accepted" }],
      automationRows: [{ occurredAt: at(7), result: "ausgeführt", ruleName: "PV-Duplikat", summary: "Zusatzlead erstellt" }],
    });
    expect(events.map((event) => event.type)).toEqual(["automatisierung", "integration", "status", "reklamation", "reklamation", "auslieferung", "erfasst"]);
    expect(events.find((event) => event.type === "integration")).toMatchObject({ title: "API-Übergabe erfolgreich", detail: "Ziel: PV-Partner · Vorgang: OUT-4711 · HTTP 201 · Rückmeldung: accepted" });
    expect(events.find((event) => event.type === "status")).toMatchObject({ detail: "Auslieferung an Solar Nord" });
  });
});
