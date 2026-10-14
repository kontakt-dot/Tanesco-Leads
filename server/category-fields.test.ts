import { describe, expect, it } from "vitest";
import { categoryFieldTypes, heatPumpCategoryFields, pvCategoryFieldMappings, pvCategoryFields } from "./category-fields";

describe("PV-Kategorievorlage", () => {
  it("enthält die vollständige, eindeutig referenzierbare Feldbibliothek", () => {
    expect(pvCategoryFields).toHaveLength(25);
    expect(new Set(pvCategoryFields.map((field) => field.fieldKey)).size).toBe(pvCategoryFields.length);
    expect(pvCategoryFields.map((field) => field.label)).toEqual(expect.arrayContaining(["Stromverbrauch", "Wärmepumpe", "Dachausrichtung", "Bestandsanlage", "GHL ID"]));
  });

  it("verwendet nur die Feldtypen der Kategoriearchitektur", () => {
    for (const field of pvCategoryFields) expect(categoryFieldTypes).toContain(field.fieldType);
  });

  it("liefert die dokumentierten Antwortkataloge für PV-Auswahlfelder", () => {
    expect(pvCategoryFields.find((field) => field.fieldKey === "stromverbrauch")?.options).toEqual(["0 - 3.000 kWh", "3.000 - 4.000 kWh", "4.000 - 6.000 kWh", "Über 6.000 kWh"]);
    expect(pvCategoryFields.find((field) => field.fieldKey === "umsetzung")?.options).toContain("So schnell wie möglich");
    expect(pvCategoryFields.find((field) => field.fieldKey === "bestandsanlage")?.options).toContain("Ja, soll mit der neuen kombiniert werden.");
    expect(pvCategoryFields.filter((field) => field.fieldType === "auswahl").every((field) => field.options?.length)).toBe(true);
  });

  it("enthält die Referenzregel für Recording-Dateien", () => {
    expect(pvCategoryFieldMappings).toEqual([{ sourceField: "record_file", targetFieldKey: "recording_1", mode: "umschreiben", searchValue: "leadshome.ondialer.com", replaceValue: "download.voicefile.de", sortOrder: 0 }]);
  });

  it("enthält die dokumentierte Wärmepumpen-Feldbibliothek", () => {
    expect(heatPumpCategoryFields).toHaveLength(20);
    expect(heatPumpCategoryFields.find((field) => field.fieldKey === "beheizte_flaeche")?.options).toContain("251-400 qm");
    expect(heatPumpCategoryFields.find((field) => field.fieldKey === "interesse_photovoltaikanlage")?.options).toEqual(["Ja", "Nein"]);
  });
});
