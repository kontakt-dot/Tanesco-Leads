import { describe, expect, it } from "vitest";
import { selectMembershipByDeepLink, selectOrderByDeepLink } from "../client/src/lib/detailDeepLinks";

describe("Detail-Deep-Links", () => {
  it("wählt die konkrete Bestellung über ihre Bestellnummer", () => {
    const orders = [{ id: 3, orderNumber: "ORD-003" }, { id: 4, orderNumber: "ORD-004" }];
    expect(selectOrderByDeepLink(orders, "ORD-004", null)).toEqual({ id: 4, orderNumber: "ORD-004" });
  });

  it("wählt das konkrete Mitglied über seine Mandantenmitgliedschaft", () => {
    const members = [{ membershipId: 1, name: "A" }, { membershipId: 2, name: "B" }];
    expect(selectMembershipByDeepLink(members, 2, 1)).toEqual({ membershipId: 2, name: "B" });
  });
});
