import { describe, expect, it } from "vitest";
import { categoryEmoji, EMOJI_CHOICES, isValidEmoji, suggestCategoryEmoji } from "../shared/category-emoji";

describe("Kategorie-Emojis", () => {
  it("schlägt aus dem Namen ein passendes Emoji vor", () => {
    expect(suggestCategoryEmoji("Photovoltaik")).toBe("☀️");
    expect(suggestCategoryEmoji("Wärmepumpe Endkunde")).toBe("♨️");
    expect(suggestCategoryEmoji("Fenster")).toBe("🪟");
    expect(suggestCategoryEmoji("Treppenlifte")).toBe("🛗");
    expect(suggestCategoryEmoji("Barrierefreie Bäder")).toBe("🛁");
    expect(suggestCategoryEmoji("Alarmanlagen")).toBe("🚨");
    expect(suggestCategoryEmoji("Wintergärten")).toBe("🌿");
    expect(suggestCategoryEmoji("Elektrorollstühle")).toBe("♿");
    expect(suggestCategoryEmoji("Rollatoren")).toBe("🚶");
    expect(suggestCategoryEmoji("Hörgeräte")).toBe("🦻");
    expect(suggestCategoryEmoji("Dachdecker")).toBe("🏠");
    expect(suggestCategoryEmoji("Irgendwas")).toBe("🏷️");
  });
  it("nimmt das eigene Emoji vor dem Vorschlag", () => {
    expect(categoryEmoji({ name: "Photovoltaik", emoji: "🔆" })).toBe("🔆");
    expect(categoryEmoji({ name: "Photovoltaik", emoji: "  " })).toBe("☀️");
    expect(categoryEmoji(null)).toBe("🏷️");
  });
  it("prüft Eingaben und bietet eine Auswahl", () => {
    expect(isValidEmoji("")).toBe(true); expect(isValidEmoji("🦻")).toBe(true); expect(isValidEmoji("abc")).toBe(false); expect(isValidEmoji("🏠🏠🏠🏠🏠🏠🏠🏠🏠")).toBe(false);
    expect(EMOJI_CHOICES.length).toBeGreaterThan(20); expect(new Set(EMOJI_CHOICES).size).toBe(EMOJI_CHOICES.length);
  });
});
