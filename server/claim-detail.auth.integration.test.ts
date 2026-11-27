/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const events = [
  { id: 3, eventType: "entschieden", previousStatus: "in_prüfung", nextStatus: "genehmigt", note: "Reklamation genehmigt.", occurredAt: new Date("2026-08-17T10:00:00Z") },
  { id: 2, eventType: "frist_gesetzt", previousStatus: "offen", nextStatus: "in_prüfung", note: "Prüfungsfrist aktualisiert: 18.08.2026", occurredAt: new Date("2026-08-17T09:00:00Z") },
  { id: 1, eventType: "erstellt", previousStatus: null, nextStatus: "offen", note: "Reklamation erfasst.", occurredAt: new Date("2026-08-17T08:00:00Z") },
];
vi.mock("../client/src/lib/trpc", () => ({ trpc: { leadops: { listClaimEvents: { useQuery: () => ({ data: events, isLoading: false, error: null }) } } } }));
import { ClaimDetail } from "../client/src/components/ClaimsDesk";

const claim = { id: 8, leadId: 19, reason: "Kontakt nicht erreichbar", details: "Mehrfach versucht", status: "in_prüfung" as const, refundAmount: "60.00", unitPrice: "75.00", buyerName: "Sonnendach GmbH", dueAt: new Date("2026-08-18T10:00:00Z"), resolvedAt: null, createdAt: new Date("2026-08-17T08:00:00Z"), leadPublicId: "AB12CD34", categoryId: 3, buyerId: null, supplierId: null, supplierName: "Quelle Nord", firstName: "Mara", lastName: "Sommer" };

describe("Geschützte Reklamationschronik", () => {
  afterEach(() => cleanup());
  it("zeigt die Angaben der Reklamation und im Verlauf nur gespeicherte Ereignisse – mit deutschen Namen und dem Wechsel des Stands", () => {
    const onDeadline = vi.fn(); const onResolve = vi.fn();
    render(createElement(ClaimDetail, { claim, categoryName: "Photovoltaik", busy: false, onResolve, onDeadline, savingDeadline: false }));
    expect(screen.getByText("Verlauf")).toBeVisible();
    expect(screen.getByText("Erfasst")).toBeVisible(); expect(screen.getByText("Frist gesetzt")).toBeVisible(); expect(screen.getByText("Entschieden")).toBeVisible();
    expect(screen.getByText("Reklamation erfasst.")).toBeVisible(); expect(screen.getByText("In Prüfung → Genehmigt")).toBeVisible(); expect(screen.getByText("Offen → In Prüfung")).toBeVisible();
    expect(screen.queryByText(/Vorprüfung|synthetisch|frist_gesetzt|in_prüfung/i)).not.toBeInTheDocument(); // keine erfundenen Einträge, keine technischen Namen
    // die Angaben: was der Käufer bezahlt hat, die Erstattung, der Lead mit Nummer, Kategorie und Lieferant
    expect(screen.getByText("Käufer hat bezahlt").nextElementSibling).toHaveTextContent("75,00"); expect(screen.getByText("Erstattung").nextElementSibling).toHaveTextContent("60,00"); expect(screen.getByText("Entscheidung").nextElementSibling).toHaveTextContent("steht aus");
    expect(screen.getByText("Mehrfach versucht")).toBeVisible(); expect(screen.getByText("Mara Sommer")).toBeVisible(); expect(screen.getByText("AB12CD34 · Photovoltaik · Lieferant: Quelle Nord")).toBeVisible();
    // Prüffrist ändern
    fireEvent.change(screen.getByLabelText("Prüffrist ändern"), { target: { value: "2026-09-03" } });
    fireEvent.click(screen.getByText("Frist speichern"));
    expect(onDeadline).toHaveBeenCalledWith(new Date("2026-09-03T12:00:00"));
    // entscheiden – mit dem Satz, was jeweils passiert
    expect(screen.getByText(/Die Lieferung gilt wieder als angenommen\./)).toBeVisible();
    fireEvent.click(screen.getByText("Ablehnen")); expect(onResolve).toHaveBeenLastCalledWith("abgelehnt"); fireEvent.click(screen.getByText("Genehmigen")); expect(onResolve).toHaveBeenLastCalledWith("genehmigt");
  });

  it("entschiedene Reklamation: keine Knöpfe mehr, die Entscheidung steht mit Datum da", () => {
    render(createElement(ClaimDetail, { claim: { ...claim, status: "abgelehnt" as const, resolvedAt: new Date("2026-08-19T09:00:00Z") }, categoryName: null, busy: false, onResolve: vi.fn(), onDeadline: vi.fn(), savingDeadline: false }));
    expect(screen.getByText("Entscheidung").nextElementSibling).toHaveTextContent("Abgelehnt am 19.08.2026");
    expect(screen.queryByText("Genehmigen")).not.toBeInTheDocument(); expect(screen.queryByText("Ablehnen")).not.toBeInTheDocument(); expect(screen.queryByLabelText("Prüffrist ändern")).not.toBeInTheDocument();
  });
});
