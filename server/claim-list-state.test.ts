import { describe, expect, it, vi } from "vitest";
import { getClaimListQueryState, retryClaimList } from "../client/src/lib/claimListState";

describe("Reklamationslistenstatus", () => {
  it("unterscheidet Laden, Fehler und verfügbaren Listeninhalt", () => {
    expect(getClaimListQueryState({ isLoading: true, isError: false })).toBe("loading");
    expect(getClaimListQueryState({ isLoading: false, isError: true })).toBe("error");
    expect(getClaimListQueryState({ isLoading: false, isError: false })).toBe("ready");
  });

  it("löst die Wiederholungsaktion einer fehlgeschlagenen Listenabfrage aus", () => {
    const refetch = vi.fn();
    retryClaimList(refetch);
    expect(refetch).toHaveBeenCalledOnce();
  });
});
