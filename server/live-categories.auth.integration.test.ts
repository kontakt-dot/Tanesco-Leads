/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

const category = { id: 55, tenantId: 41, shortcode: "PV", name: "Photovoltaik", multisaleMax: 1, defaultLeadPrice: "60.00", pipelineType: "Partner-Pipeline", offerDescription: "", marketplaceEnabled: true, status: "aktiv" };
const existingTemplate = { id: 56, tenantId: 41, shortcode: "PV_VORLAGE", name: "Bestehende PV Vorlage", defaultLeadPrice: "60.00", offerDescription: "", marketplaceEnabled: true, status: "aktiv", isTemplate: true };
const field = { id: 1, tenantId: 41, categoryId: 55, label: "Stromverbrauch", fieldKey: "stromverbrauch", fieldType: "zahl", options: [], required: false, visible: true, sortOrder: 0 };
const mapping = { id: 2, tenantId: 41, categoryId: 55, sourceField: "record_file", targetFieldKey: "recording", mode: "umschreiben", searchValue: "leadshome.ondialer.com", replaceValue: "download.voicefile.de", sortOrder: 0 };
const mutation = () => ({ mutate: vi.fn(), isPending: false });
const saveTemplate = vi.fn();

vi.mock("../client/src/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ leadops: new Proxy({}, { get: () => ({ invalidate: vi.fn() }) }) }),
    leadops: new Proxy({}, { get: (_target, key: string) => {
      if (key === "listCategories") return { useQuery: () => ({ data: [category], isLoading: false, error: null }) };
      if (key === "listCategoryTemplates") return { useQuery: () => ({ data: [existingTemplate], isLoading: false, error: null }) };
      if (key === "listCategoryFields") return { useQuery: () => ({ data: [field], isLoading: false, error: null }) };
      if (key === "listCategoryFieldMappings") return { useQuery: () => ({ data: [mapping], isLoading: false, error: null }) };
      if (key === "createCategoryTemplate") return { useMutation: (options: { onSuccess: (result: { id: number; fieldCount: number; mappingCount: number }, variables: { shortcode: string; name: string; saveAsTemplate: boolean }) => void }) => ({ mutate: (variables: { shortcode: string; name: string; saveAsTemplate: boolean }) => { saveTemplate(variables); options.onSuccess({ id: 57, fieldCount: 1, mappingCount: 1 }, variables); }, isPending: false }) };
      return { useMutation: mutation };
    } }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import LiveCategories from "../client/src/components/LiveCategories";

describe("Geschützter PV-Kategoriearbeitsbereich", () => {
  beforeEach(() => { saveTemplate.mockClear(); window.history.replaceState({}, "", "/?page=Lead-Kategorien&categoryId=55&tab=settings"); });
  it("lädt den PV-Direktlink im Mandantenkontext mit Grundeinstellungen, Feldbibliothek, Mapping und sichtbaren Betriebswerkzeugen", async () => {
    render(createElement(LiveCategories));
    await waitFor(() => expect(screen.getAllByText("Photovoltaik").length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: "CSV-Vorlage" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Parameterblatt" })).toBeVisible();
    expect(screen.getByPlaceholderText("Name, z. B. Photovoltaik")).toHaveValue("Photovoltaik");
    fireEvent.click(screen.getByRole("button", { name: /Benutzerdefinierte Felder/ }));
    expect(await screen.findByText("Stromverbrauch")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Datenharmonisierung/ }));
    expect(await screen.findByText("record_file")).toBeVisible();
  });

  it("vergibt für eine eigene Vorlage einen freien Shortcode, speichert sie und öffnet die Bibliothek", async () => {
    render(createElement(LiveCategories));
    await screen.findByDisplayValue("Photovoltaik");
    fireEvent.click(screen.getAllByRole("button", { name: "Vorlagen öffnen" })[0]);
    await screen.findByText("VORLAGENBIBLIOTHEK · AKTIV");
    fireEvent.click(screen.getByRole("button", { name: "Neue Vorlage" }));
    expect(screen.getByDisplayValue("NEUE_VORLAGE")).toBeVisible();
    const assistant = screen.getByText("VORLAGEN-ASSISTENT").closest("section");
    expect(assistant).not.toBeNull();
    fireEvent.click(within(assistant!).getByRole("button", { name: "Vorlage speichern" }));
    await waitFor(() => expect(saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ shortcode: "NEUE_VORLAGE", saveAsTemplate: true })));
    expect(screen.getByText("VORLAGENBIBLIOTHEK · AKTIV")).toBeVisible();
    expect(screen.getAllByRole("button", { name: /Zurück zu Lead-Kategorien/ }).length).toBeGreaterThan(0);
  });
});
