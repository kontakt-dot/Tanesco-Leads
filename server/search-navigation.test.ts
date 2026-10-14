import { describe, expect, it } from "vitest";
import { searchTargetUrl } from "../client/src/lib/searchNavigation";

describe("Globale Suchnavigation", () => {
  it("erzeugt datensatzgenaue Detail-Deep-Links für Leads, Bestellungen und Mitglieder", () => {
    expect(searchTargetUrl({ page: "Leads", param: "leadId", value: "LX-100" })).toBe("/?page=Leads&leadId=LX-100");
    expect(searchTargetUrl({ page: "Bestellungen", param: "orderId", value: "ORD-100" })).toBe("/?page=Bestellungen&orderId=ORD-100");
    expect(searchTargetUrl({ page: "Benutzer", param: "memberId", value: 8 })).toBe("/?page=Benutzer&memberId=8");
  });
});
