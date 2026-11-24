import { describe, expect, it } from "vitest";
import { campaignBuyerSkip, campaignKey, campaignName, dialerCampaignOf, dialerNamesOf, leadCampaignCall, resolveDialerCampaign } from "../shared/dialer-campaign";

describe("Kampagnen vom Dialer", () => {
  it("liest den Kampagnennamen aus der Meldung – auch unter anderen Feldnamen und beim Kontakt", () => {
    expect(dialerCampaignOf({ campaign: "  Wattfox   PV " })).toBe("Wattfox PV");
    expect(dialerCampaignOf({ campaign_name: "Aroundhome Solar" })).toBe("Aroundhome Solar");
    expect(dialerCampaignOf({ kampanya: "WP Kuzey" })).toBe("WP Kuzey");
    expect(dialerCampaignOf({ campaign: { id: 7, name: "Wattfox WP" } })).toBe("Wattfox WP");
    expect(dialerCampaignOf({ campaign: 4711 })).toBe("4711");
    expect(dialerCampaignOf({ contact: { fields: { campaign: "PV Nord" } } })).toBe("PV Nord");
    expect(dialerCampaignOf({ data: { kampagne: "Eigenes Feld" } }, "data.kampagne")).toBe("Eigenes Feld");
    expect(dialerCampaignOf({ campaign: "   " })).toBeNull(); expect(dialerCampaignOf({ phone: "+49 30 1" })).toBeNull(); expect(dialerCampaignOf(null)).toBeNull();
    expect(campaignName("x".repeat(200))).toHaveLength(160);
    expect(campaignKey(" Wattfox  PV ")).toBe(campaignKey("wattfox pv"));
  });

  it("Gespräch landet: Zuordnung → gleicher Name → Standard → Name laut Dialer", () => {
    const campaigns = [{ name: "Wattfox", dialerNames: ["Wattfox PV", "wattfox wp"] }, { name: "Aroundhome", dialerNames: null }, { name: "PV Q4" }];
    expect(resolveDialerCampaign("WATTFOX WP", campaigns, "Wattfox")).toEqual({ campaign: "Wattfox", via: "zuordnung" });
    expect(resolveDialerCampaign("aroundhome", campaigns, "Wattfox")).toEqual({ campaign: "Aroundhome", via: "name" });
    expect(resolveDialerCampaign("Neue Kampagne", campaigns, "Wattfox")).toEqual({ campaign: "Wattfox", via: "standard" });
    expect(resolveDialerCampaign("Neue Kampagne", campaigns, null)).toEqual({ campaign: "Neue Kampagne", via: "dialer" });
    expect(resolveDialerCampaign(null, campaigns, "Wattfox")).toEqual({ campaign: "Wattfox", via: "standard" });
    expect(resolveDialerCampaign(null, campaigns, "  ")).toEqual({ campaign: null, via: "keine" });
    expect(dialerNamesOf(["Wattfox PV", "wattfox pv", " ", 12, null])).toEqual(["Wattfox PV", "12"]); expect(dialerNamesOf("Wattfox")).toEqual([]);
  });

  it("Kampagne mit eigenem Käufer: nur er bekommt die Leads; es zählt das neueste freigegebene Gespräch", () => {
    const rule = { campaign: "Aroundhome", buyerUserId: 12, buyerName: "Aroundhome GmbH" };
    expect(campaignBuyerSkip(rule, 12)).toBeNull();
    expect(campaignBuyerSkip(rule, 7)).toBe("Kampagne „Aroundhome“ liefert nur an Aroundhome GmbH");
    expect(campaignBuyerSkip(rule, null)).toBe("Kampagne „Aroundhome“ liefert nur an Aroundhome GmbH");
    expect(campaignBuyerSkip(null, 7)).toBeNull();
    const calls = [{ id: 1, campaign: "Wattfox", decision: "freigegeben" }, { id: 2, campaign: "Aroundhome", decision: "zurueckgewiesen" }, { id: 3, campaign: null, decision: "freigegeben" }];
    expect(leadCampaignCall(calls)?.campaign).toBe("Wattfox");
    expect(leadCampaignCall([{ id: 4, campaign: "Aroundhome", decision: "pruefen" }, { id: 2, campaign: "Wattfox", decision: "offen" }])?.campaign).toBe("Aroundhome");
    expect(leadCampaignCall([])).toBeNull();
  });
});
