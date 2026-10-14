import { describe, expect, it } from "vitest";
import { reorderCategoryFields } from "./category-field-ordering";

describe("Kategorie-Feldreihenfolge", () => {
  const fields = [{ id: 1 }, { id: 2 }, { id: 3 }];

  it("tauscht ein Feld beim Verschieben nach oben und unten mit seinem Nachbarn", () => {
    expect(reorderCategoryFields(fields, 2, "up")).toEqual({ moved: true, fields: [{ id: 2 }, { id: 1 }, { id: 3 }] });
    expect(reorderCategoryFields(fields, 2, "down")).toEqual({ moved: true, fields: [{ id: 1 }, { id: 3 }, { id: 2 }] });
  });

  it("belässt Randfelder unverändert", () => {
    expect(reorderCategoryFields(fields, 1, "up")).toEqual({ moved: false, fields });
    expect(reorderCategoryFields(fields, 3, "down")).toEqual({ moved: false, fields });
  });
});
