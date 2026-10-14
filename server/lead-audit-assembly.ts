import { formatIntegrationAuditEvent, type IntegrationAuditEvent } from "./lead-audit-format";

type DateStamped = { occurredAt: Date };
type AuditItem = DateStamped & { id: string; type: string; title: string; detail: string; tone: string };

export function buildLeadAuditLog(input: {
  lead: { id: number; categoryId: number; status: string; createdAt: Date };
  deliveries: Array<{ id: number; occurredAt: Date; result: string; buyerName: string; unitPrice: string }>;
  claimRows: Array<{ id: number; createdAt: Date; reason: string }>;
  claimEventRows: Array<{ claimId: number; occurredAt: Date; eventType: string; previousStatus: string | null; nextStatus: string | null; note: string | null }>;
  statusRows: Array<{ id: number; occurredAt: Date; previousStatus: string | null; nextStatus: string; note: string | null }>;
  integrationRows: Array<DateStamped & IntegrationAuditEvent>;
  automationRows: Array<{ occurredAt: Date; result: string; summary: string; ruleName: string | null }>;
}): AuditItem[] {
  const { lead, deliveries, claimRows, claimEventRows, statusRows, integrationRows, automationRows } = input;
  const events: AuditItem[] = [
    { id: `lead-${lead.id}`, occurredAt: lead.createdAt, type: "erfasst", title: "Lead im System erfasst", detail: `Kategorie-ID ${lead.categoryId} · Status ${lead.status}`, tone: "violett" },
    ...deliveries.map((delivery) => ({ id: `delivery-${delivery.id}`, occurredAt: delivery.occurredAt, type: "auslieferung", title: `Auslieferung ${delivery.result}`, detail: `${delivery.buyerName} · ${delivery.unitPrice} €`, tone: delivery.result === "angenommen" ? "gruen" : delivery.result === "abgelehnt" ? "rot" : "blau" })),
    ...claimRows.map((claim) => ({ id: `claim-${claim.id}`, occurredAt: claim.createdAt, type: "reklamation", title: "Reklamation erfasst", detail: claim.reason, tone: "orange" })),
    ...claimEventRows.map((event, index) => ({ id: `claim-event-${event.claimId}-${index}`, occurredAt: event.occurredAt, type: "reklamation", title: event.eventType === "erstellt" ? "Reklamation angelegt" : event.eventType === "frist_gesetzt" ? "Prüfungsfrist gesetzt" : event.eventType === "entschieden" ? `Reklamation ${event.nextStatus === "genehmigt" ? "genehmigt" : "abgelehnt"}` : event.eventType.replaceAll("_", " "), detail: event.note ?? `${event.previousStatus ?? "—"} → ${event.nextStatus ?? "—"}`, tone: "orange" })),
    ...statusRows.map((event) => ({ id: `status-${event.id}`, occurredAt: event.occurredAt, type: "status", title: `Lead-Status: ${event.nextStatus}`, detail: event.note ?? `${event.previousStatus ?? "—"} → ${event.nextStatus}`, tone: "blau" })),
    ...integrationRows.map((event, index) => ({ id: `integration-${index}`, occurredAt: event.occurredAt, type: "integration", ...formatIntegrationAuditEvent(event) })),
    ...automationRows.map((event, index) => ({ id: `automation-${index}`, occurredAt: event.occurredAt, type: "automatisierung", title: `Automatisierung ${event.result}`, detail: `${event.ruleName ?? "Regel"}: ${event.summary}`, tone: event.result === "ausgeführt" ? "gruen" : "orange" })),
  ];
  return events.sort((first, second) => second.occurredAt.getTime() - first.occurredAt.getTime());
}
