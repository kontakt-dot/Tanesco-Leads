import { describe, expect, it } from "vitest";
import { globalSearchFeedback, retryGlobalSearch, shouldShowGlobalSearchRetry } from "../client/src/lib/globalSearchState";
import { vi } from "vitest";

describe("Globaler Suchstatus", () => {
  it("liefert eine verständliche und wiederholbare Fehlerhinweisgrundlage", () => {
    expect(globalSearchFeedback("Mira", { isLoading: false, isError: true, hasResults: false })).toBe("Die Suche konnte nicht geladen werden. Bitte versuchen Sie es erneut.");
  });

  it("macht die Wiederholung nur im sichtbaren Fehlerzustand verfügbar und löst die Abfrage erneut aus", () => {
    const refetch = vi.fn();
    expect(shouldShowGlobalSearchRetry("Mira", true)).toBe(true);
    expect(shouldShowGlobalSearchRetry("M", true)).toBe(false);
    retryGlobalSearch(refetch);
    expect(refetch).toHaveBeenCalledOnce();
  });
});
