import { describe, expect, it } from "vitest";
import { offerStatusAfterApprovedClaim } from "./marketplace";

describe("marketplace reclamation rule", () => {
  it("relistet erstattete Kontakte nur bei aktiver Wiedervermarktungsregel", () => {
    expect(offerStatusAfterApprovedClaim("relist")).toBe("aktiv");
    expect(offerStatusAfterApprovedClaim("keep")).toBe("entfernt");
  });
});
