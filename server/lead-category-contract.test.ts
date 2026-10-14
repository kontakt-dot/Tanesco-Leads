import { describe, expect, it } from "vitest";
import { buildCategoryCsvHeaders, buildCategoryParameterSheet, categoryOperationalTools, categoryWorkspaceTabLabels, resolveCategoryWorkspaceRoute } from "../client/src/components/lead-category-contract";

describe("PV-Kategorie-UI-Vertrag", () => {
  it("löst die geschützte PV-Direktansicht mit dem gewünschten Tab auf", () => {
    const route = resolveCategoryWorkspaceRoute("?page=Lead-Kategorien&category=PV&tab=mapping", [{ shortcode: "PV", name: "Photovoltaik" }, { shortcode: "WP", name: "Wärmepumpe" }]);
    expect(route).toEqual({ category: { shortcode: "PV", name: "Photovoltaik" }, tab: "mapping" });
  });

  it("löst eine numerische Kategorie-ID für stabile Direktlinks auf", () => {
    const route = resolveCategoryWorkspaceRoute("?categoryId=120001&tab=fields", [{ id: 120001, shortcode: "PV", name: "Photovoltaik" }]);
    expect(route.category?.shortcode).toBe("PV");
    expect(route.tab).toBe("fields");
  });

  it("erstellt die operativen CSV- und Parameterwerkzeuge aus der Feldbibliothek", () => {
    const fields = [{ label: "Stromverbrauch", fieldKey: "stromverbrauch", fieldType: "zahl" }, { label: "Recording", fieldKey: "recording", fieldType: "text" }];
    expect(buildCategoryCsvHeaders(fields)).toEqual(["vorname", "nachname", "email", "telefon", "plz", "ort", "stromverbrauch", "recording"]);
    expect(buildCategoryParameterSheet({ name: "Photovoltaik", shortcode: "PV", priority: "1", pipeline: "Sales-Pipeline", fields, mappings: [{ sourceField: "record_file", targetFieldKey: "recording", mode: "umschreiben" }], labelForFieldType: (type) => type === "zahl" ? "Zahl" : "Text" })).toContain("record_file → recording (umschreiben)");
  });

  it("definiert alle sichtbaren PV-Tabs und Betriebswerkzeuge", () => {
    expect(Object.values(categoryWorkspaceTabLabels)).toEqual(["Grundeinstellungen", "Benutzerdefinierte Felder", "Datenharmonisierung"]);
    expect(categoryOperationalTools).toEqual(["CSV-Vorlage", "Parameterblatt"]);
  });
});
