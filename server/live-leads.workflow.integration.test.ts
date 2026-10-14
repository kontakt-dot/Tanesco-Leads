/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const lead = { id: 101, publicId: "PV-1001", categoryId: 150001, firstName: "Anna", lastName: "Muster", email: "anna@example.de", phone: "01234", postcode: "50667", city: "Köln", status: "neu", cost: "60.00", supplierName: "Fluxora", buyerName: "Tanesco Digital", metadata: { dachausrichtung: "Süd" }, createdAt: new Date("2026-08-18T08:00:00.000Z") };
const secondLead = { ...lead, id: 102, publicId: "PV-1002", firstName: "Ben", lastName: "Muster", email: "ben@example.de" };
const category = { id: 150001, shortcode: "PV", name: "Photovoltaik" };
const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})), isPending: false });
const importLeadMutateAsync = vi.fn(async () => ({ publicId: "PV-1003" }));
const listInput = vi.fn();

vi.mock("../client/src/lib/trpc", () => ({
  trpc: { useUtils: () => ({ leadops: new Proxy({}, { get: () => ({ invalidate: vi.fn() }) }) }), leadops: new Proxy({}, { get: (_target, key: string) => {
    if (key === "listLeadsPaged") return { useQuery: (input: unknown) => { listInput(input); return { data: { rows: [lead, secondLead], total: 2, page: 1, pageCount: 1, duplicateIds: [] }, isLoading: false, error: null }; } };
    if (key === "listCategories") return { useQuery: () => ({ data: [category], isLoading: false, error: null }) };
    if (key === "listCategoryFields") return { useQuery: () => ({ data: [{ id: 9, label: "Dachausrichtung", fieldKey: "dachausrichtung", fieldType: "auswahl", options: ["Süd", "Ost"], required: false }], isLoading: false, error: null }) };
    if (key === "listSuppliers" || key === "listMembers" || key === "listAutomationRules" || key === "listDeliveryChains" || key === "listOrders" || key === "listPartnerIntegrations" || key === "listLeadImportBatches") return { useQuery: () => ({ data: [], isLoading: false, error: null }) };
    if (key === "getLeadAuditLog") return { useQuery: () => ({ data: [{ id: "status-1", type: "status", title: "Status geändert", detail: "neu → zugewiesen", tone: "violett", occurredAt: new Date("2026-08-18T08:01:00.000Z") }], isLoading: false, isError: false, error: null }) };
    if (key === "getLeadDetail") return { useQuery: () => ({ data: { id: 1, publicId: lead.id, firstName: "Anna", lastName: "Muster", email: lead.email, phone: lead.phone, postcode: "50667", city: "Köln", country: "DE", status: "neu", cost: "12.00", createdAt: new Date("2026-08-18T08:00:00.000Z"), updatedAt: new Date("2026-08-18T08:00:00.000Z"), assignedAt: null, category: { id: 1, name: "Photovoltaik", shortcode: "PV" }, supplier: { id: 1, name: "Solar Quelle", email: null, status: "aktiv" }, fields: [{ key: "dachausrichtung", label: "Dachausrichtung", type: "auswahl", value: "Süd" }], metadata: { dachausrichtung: "Süd" }, deliveries: [], claims: [], tags: [] }, isLoading: false, error: null }) };
    if (key === "importLead") return { useMutation: () => ({ mutate: vi.fn(), mutateAsync: importLeadMutateAsync, isPending: false }) };
    if (key === "startLeadImportBatch") return { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => ({ batchId: 1 })), isPending: false }) };
    return { useMutation: mutation };
  } }) },
}));
vi.mock("../client/src/components/LeadTagManager", () => ({ default: () => createElement("div", null, "Tags verwalten") }));
vi.mock("../client/src/components/LeadClaimForm", () => ({ default: () => createElement("div", null, "Reklamation erfassen") }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import LiveLeads from "../client/src/components/LiveLeads";

describe("Lead-Verwaltung – UI-Gesamtfluss", () => {
  it("zeigt Liste und Quick View, legt einen Lead an und importiert eine CSV mit Zeilenreport", async () => {
    render(createElement(LiveLeads));
    expect(screen.getByText(/Anna Muster/)).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Käufer" })).toBeVisible();
    expect(screen.getAllByText("Tanesco Digital").length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Ort filtern"), { target: { value: "Köln" } });
    await waitFor(() => expect(listInput).toHaveBeenLastCalledWith(expect.objectContaining({ city: "Köln" })));
    // Leads pro Seite: „Eigene Anzahl …“ nur im Dropdown, Zahlenfeld erscheint erst nach Auswahl
    fireEvent.change(screen.getByLabelText("Leads pro Seite"), { target: { value: "eigene_neu" } });
    const customPageSize = screen.getByLabelText("Eigene Anzahl pro Seite");
    fireEvent.change(customPageSize, { target: { value: "2" } }); fireEvent.blur(customPageSize);
    await waitFor(() => expect(listInput).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 2 })));
    expect(screen.getByDisplayValue("2 (eigene Anzahl)")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Leads pro Seite"), { target: { value: "-1" } });
    expect(screen.getByDisplayValue("Alle Leads")).toBeVisible();
    fireEvent.click(screen.getByLabelText(/Lead .*Anna Muster auswählen/));
    fireEvent.click(screen.getByLabelText(/Lead .*Ben Muster auswählen/));
    expect(screen.getByText("SAMMELAKTION")).toBeVisible();
    expect(screen.getByText("2 Leads ausgewählt")).toBeVisible();
    const actionSelect = screen.getByLabelText("Lead-Aktion auswählen");
    fireEvent.change(actionSelect, { target: { value: "chain" } });
    expect(screen.getByLabelText("Lieferkette auswählen")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sammelaktion ausführen" })).toBeVisible();
    // Spalte „Ansicht“: beschrifteter Quick-View-Knopf je Zeile (das Lead-Log ist darin und auf der Lead-Seite erreichbar)
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Quick View für .*Anna Muster öffnen/ }).length).toBeGreaterThan(0));
    expect(screen.getAllByRole("button", { name: /Quick View für .*Anna Muster öffnen/ })[0].querySelector("svg")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /Quick View für .*Anna Muster öffnen/ })[0]);
    expect(screen.getByRole("dialog", { name: /Quick View für .*Anna Muster/ })).toBeVisible();
    expect(screen.getByText("Letzte Ereignisse")).toBeVisible();
    expect(screen.getByText("Status geändert")).toBeVisible();
    expect(screen.getByText("neu → zugewiesen")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Quick View schließen" }));
    // Lead-Seite: Klick auf den Namen öffnet die eigene Seite mit allen Informationen, zurück zur Liste
    fireEvent.click(screen.getByText(/Anna Muster/).closest("button")!);
    expect(screen.getByRole("heading", { level: 1, name: /Anna Muster/ })).toBeVisible();
    expect(screen.getByText("Kontakt")).toBeVisible(); expect(screen.getByText("Fachfelder")).toBeVisible(); expect(screen.getByText("Süd")).toBeVisible(); expect(screen.getByText("Solar Quelle")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "← Zurück zu den Leads" }));
    expect(screen.getByRole("heading", { level: 1, name: "Leads" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Lead anlegen/ }));
    expect(screen.getByText("Neuen Lead anlegen")).toBeVisible();
    expect(screen.getByRole("button", { name: "Lead speichern" })).toBeVisible();
    fireEvent.change(screen.getByDisplayValue("Lead-Kategorie auswählen"), { target: { value: "150001" } });
    expect(await screen.findByText("Dachausrichtung")).toBeVisible();
    fireEvent.change(screen.getByPlaceholderText("Vorname"), { target: { value: "Mara" } });
    fireEvent.change(screen.getByPlaceholderText("Nachname"), { target: { value: "Solar" } });
    fireEvent.click(screen.getByRole("button", { name: "Lead speichern" }));
    await waitFor(() => expect(importLeadMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 150001, firstName: "Mara", lastName: "Solar" })));
    fireEvent.click(screen.getByRole("button", { name: /Leads importieren/ }));
    expect(screen.getByText("Leads aus CSV importieren")).toBeVisible();
    expect(screen.getByText(/Zusätzliche Spalten werden als Kategorie-Fachfelder übernommen/)).toBeVisible();
    fireEvent.change(screen.getByDisplayValue("Lead-Kategorie auswählen"), { target: { value: "150001" } });
    const file = new File(["Vorname;Nachname;Dachausrichtung\nClara;Solar;Süd"], "leads.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "Vorname;Nachname;Dachausrichtung\nClara;Solar;Süd" });
    fireEvent.change(document.querySelector("input[type=file]")!, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("1 gültige Zeilen erkannt")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "1 Leads importieren" }));
    await waitFor(() => expect(importLeadMutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({ categoryId: 150001, firstName: "Clara", lastName: "Solar", metadata: { dachausrichtung: "Süd" } })));
  });
});
