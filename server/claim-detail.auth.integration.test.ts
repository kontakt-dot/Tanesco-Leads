/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

const events = [
  { id: 1, eventType: "erfassung", previousStatus: null, nextStatus: "offen", note: "Reklamation erfasst", occurredAt: new Date("2026-08-17T08:00:00Z") },
  { id: 2, eventType: "frist_gesetzt", previousStatus: "offen", nextStatus: "offen", note: "Prüfungsfrist gesetzt", occurredAt: new Date("2026-08-17T09:00:00Z") },
  { id: 3, eventType: "genehmigt", previousStatus: "offen", nextStatus: "genehmigt", note: "Erstattung genehmigt", occurredAt: new Date("2026-08-17T10:00:00Z") },
];
vi.mock("../client/src/lib/trpc", () => ({ trpc: { leadops: { listClaimEvents: { useQuery: () => ({ data: events, isLoading: false }) } } } }));
import { ClaimDetail } from "../client/src/components/LiveServiceDesk";

describe("Geschützte Reklamationschronik", () => {
  it("rendert nur gespeicherte Erfassungs-, Frist- und Entscheidungsereignisse im Detail", () => {
    const onDeadlineChange = vi.fn();
    render(createElement(ClaimDetail, { claim: { id: 8, leadId: 19, reason: "Kontakt nicht erreichbar", details: "Mehrfach versucht", status: "in_prüfung", refundAmount: "60.00", dueAt: new Date("2026-08-18T10:00:00Z"), resolvedAt: null, createdAt: new Date("2026-08-17T08:00:00Z") }, onDeadlineChange }));
    expect(screen.getByText("GESPEICHERTE CHRONIK")).toBeVisible();
    expect(screen.getByText("erfassung")).toBeVisible();
    expect(screen.getByText("frist gesetzt")).toBeVisible();
    expect(screen.getAllByText("genehmigt").length).toBeGreaterThan(0);
    expect(screen.getByText("Reklamation erfasst")).toBeVisible();
    expect(screen.queryByText(/Vorprüfung|synthetisch/i)).not.toBeInTheDocument();
    const deadline = screen.getByLabelText("Prüfungsfrist ändern");
    fireEvent.change(deadline, { target: { value: "2026-09-03" } });
    fireEvent.click(screen.getByText("Frist speichern"));
    expect(onDeadlineChange).toHaveBeenCalledWith(new Date("2026-09-03T12:00:00"));
  });
});
