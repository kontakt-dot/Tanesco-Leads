import { formatIntegrationAuditEvent, type IntegrationAuditEvent } from "./lead-audit-format";

type DateStamped = { occurredAt: Date };
type AuditItem = DateStamped & { id: string; type: string; title: string; detail: string; tone: string };
/** Status in den Wörtern der Oberfläche („genehmigt“ heißt dort „Freigegeben“). */
const STATUS_LABEL: Record<string, string> = { neu: "Neu", genehmigt: "Freigegeben", zugewiesen: "Zugewiesen", reklamiert: "Reklamiert", fehlerhaft: "Fehlerhaft", deaktiviert: "Deaktiviert", hängend: "Hängend" };
const statusLabel = (status: string | null | undefined) => (status ? STATUS_LABEL[status] ?? status : "—");
/**
 * Eintrag aus dem Status-Verlauf. Ändert sich der Status, heißt er „Lead-Status: …“. Bleibt er gleich, ist es ein Vermerk
 * (z. B. „Aus dem Gespräch übernommen: 9 Felder“) – dann wird der Vermerk selbst zur Überschrift, statt so zu tun, als hätte sich der Status geändert.
 */
function statusItem(event: { id: number; occurredAt: Date; previousStatus: string | null; nextStatus: string; note: string | null }): AuditItem {
  const base = { id: `status-${event.id}`, occurredAt: event.occurredAt, type: "status", tone: "blau" };
  if (event.previousStatus !== event.nextStatus || !event.note) return { ...base, title: `Lead-Status: ${statusLabel(event.nextStatus)}`, detail: event.note ?? `${statusLabel(event.previousStatus)} → ${statusLabel(event.nextStatus)}` };
  const cut = event.note.indexOf(": "); const head = cut > 3 && cut <= 60 ? event.note.slice(0, cut) : "";
  return { ...base, title: head || "Vermerk", detail: head ? event.note.slice(cut + 2) : event.note };
}

export function buildLeadAuditLog(input: {
  lead: { id: number; categoryId: number; status: string; createdAt: Date; categoryName?: string | null };
  deliveries: Array<{ id: number; occurredAt: Date; result: string; buyerName: string; unitPrice: string }>;
  claimRows: Array<{ id: number; createdAt: Date; reason: string }>;
  claimEventRows: Array<{ claimId: number; occurredAt: Date; eventType: string; previousStatus: string | null; nextStatus: string | null; note: string | null }>;
  statusRows: Array<{ id: number; occurredAt: Date; previousStatus: string | null; nextStatus: string; note: string | null }>;
  integrationRows: Array<DateStamped & IntegrationAuditEvent>;
  automationRows: Array<{ occurredAt: Date; result: string; summary: string; ruleName: string | null }>;
}): AuditItem[] {
  const { lead, deliveries, claimRows, claimEventRows, statusRows, integrationRows, automationRows } = input;
  const events: AuditItem[] = [
    { id: `lead-${lead.id}`, occurredAt: lead.createdAt, type: "erfasst", title: "Lead im System erfasst", detail: `Kategorie ${lead.categoryName?.trim() || `#${lead.categoryId}`} · Status ${statusLabel(lead.status)}`, tone: "violett" },
    ...deliveries.map((delivery) => ({ id: `delivery-${delivery.id}`, occurredAt: delivery.occurredAt, type: "auslieferung", title: `Auslieferung ${delivery.result}`, detail: `${delivery.buyerName} · ${delivery.unitPrice} €`, tone: delivery.result === "angenommen" ? "gruen" : delivery.result === "abgelehnt" ? "rot" : "blau" })),
    ...claimRows.map((claim) => ({ id: `claim-${claim.id}`, occurredAt: claim.createdAt, type: "reklamation", title: "Reklamation erfasst", detail: claim.reason, tone: "orange" })),
    ...claimEventRows.map((event, index) => ({ id: `claim-event-${event.claimId}-${index}`, occurredAt: event.occurredAt, type: "reklamation", title: event.eventType === "erstellt" ? "Reklamation angelegt" : event.eventType === "frist_gesetzt" ? "Prüfungsfrist gesetzt" : event.eventType === "entschieden" ? `Reklamation ${event.nextStatus === "genehmigt" ? "genehmigt" : "abgelehnt"}` : (([first, ...rest]) => `${(first ?? "").toUpperCase()}${rest.join("")}`)(Array.from(event.eventType.replaceAll("_", " "))), detail: event.note ?? `${event.previousStatus ?? "—"} → ${event.nextStatus ?? "—"}`, tone: "orange" })),
    ...statusRows.map(statusItem),
    ...integrationRows.map((event, index) => ({ id: `integration-${index}`, occurredAt: event.occurredAt, type: "integration", ...formatIntegrationAuditEvent(event) })),
    ...automationRows.map((event, index) => ({ id: `automation-${index}`, occurredAt: event.occurredAt, type: "automatisierung", title: `Automatisierung ${event.result}`, detail: `${event.ruleName ?? "Regel"}: ${event.summary}`, tone: event.result === "ausgeführt" ? "gruen" : "orange" })),
  ];
  return events.sort((first, second) => second.occurredAt.getTime() - first.occurredAt.getTime());
}
