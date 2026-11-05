import { describe, expect, it } from "vitest";
import { categoryBadgeCode, shortCategoryCode } from "../shared/category-code";

describe("Kurze Kategorie-Kürzel", () => {
  it("bildet kurze Kürzel aus dem Namen", () => {
    expect(shortCategoryCode("Alarmanlage")).toBe("ALA");
    expect(shortCategoryCode("Pool-Bau Nord")).toBe("PBN");
    expect(shortCategoryCode("Wärmepumpe")).toBe("WAE");
    expect(shortCategoryCode("")).toBe("KAT");
  });
  it("zeigt im Kreis kurze Kürzel unverändert, lange als Kurzform", () => {
    expect(categoryBadgeCode("PV", "Photovoltaik")).toBe("PV");
    expect(categoryBadgeCode("PVWP", "Photovoltaik & Wärmepumpe")).toBe("PVWP");
    expect(categoryBadgeCode("ALARMANL", "Alarmanlage")).toBe("ALA");
    expect(categoryBadgeCode("HAUSNOTR", "Hausnotruf")).toBe("HAU");
    expect(categoryBadgeCode("", "Elektrorollstuhl")).toBe("ELE");
  });
});
