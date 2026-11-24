import { describe, expect, it } from "vitest";
import { campaignBuyerSkip, campaignDeliverySkip, pickRulesSource, rulesSourceFor, campaignKey, campaignName, dialerCampaignOf, dialerNamesOf, leadCampaignCall, resolveDialerCampaign } from "../shared/dialer-campaign";
import { decideByQuestions, recheckReasonLabel } from "../shared/call-qualification";
import { contactParts } from "../shared/dialer-intake";
import { realSignIn, signedInAfter } from "../shared/signed-in";

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

describe("v358: Kampagne in „Das schickt der Dialer mit“ und echte Anmeldung", () => {
  it("zeigt, ob die letzte Meldung einen Kampagnennamen hatte – auch unter anderem Feldnamen oder mit eigener Zuordnung", () => {
    expect(contactParts({ phone: "1", campaign: "PV Herbst" }).campaign).toBe(true);
    expect(contactParts({ phone: "1", kampanya: "WP Kuzey" }).campaign).toBe(true);
    expect(contactParts({ phone: "1", contact: { fields: { campaign_name: "Solar Süd" } } }).campaign).toBe(true);
    expect(contactParts({ phone: "1" }).campaign).toBe(false);
    expect(contactParts({ phone: "1", campaign: "   " }).campaign).toBe(false);
    expect(contactParts({ phone: "1", meta: { liste: "PV Nord" } }, { campaign: "meta.liste" }).campaign).toBe(true);
  });
  it("Anlegen zählt nicht als Anmeldung – erst eine Anmeldung danach (eine Minute Spielraum)", () => {
    const created = new Date("2026-11-24T20:56:00Z");
    expect(signedInAfter(created, created)).toBe(false);
    expect(signedInAfter(new Date(created.getTime() + 1_000), created)).toBe(false); // Rundung der Sekunden
    expect(signedInAfter(new Date(created.getTime() + 120_000), created)).toBe(true);
    expect(signedInAfter(null, created)).toBe(false);
    expect(signedInAfter("2026-11-25T08:00:00Z", "2026-11-24T20:56:00Z")).toBe(true);
    expect(signedInAfter("kaputt", created)).toBe(false);
    expect(realSignIn(created, created)).toBeNull();
    expect(realSignIn("2026-11-25T08:00:00Z", created)).toBe("2026-11-25T08:00:00Z");
  });
  it("liest die Frage, wegen der die Nachprüfung strenger entschieden hat – auch mit Anführungszeichen im Text", () => {
    const ko = { key: "eigentuemer", label: "Ist der Kunde Eigentümer?", rule: "ko" as const };
    const handover = { key: "uebergabe", label: "Weiß der Kunde, dass sich „Photovoltaik Angebotsvergleich“ meldet?", rule: "required" as const };
    const reasonOf = (questions: Array<{ key: string; label: string; rule: "ko" | "required" }>, answer: "nein" | "unklar") => `Nachprüfung: ${decideByQuestions(questions, Object.fromEntries(questions.map((question) => [question.key, { answer }])))!.reason}`;
    expect(recheckReasonLabel(reasonOf([ko], "nein"))).toBe("Ist der Kunde Eigentümer?");
    expect(recheckReasonLabel(reasonOf([handover], "nein"))).toBe("Weiß der Kunde, dass sich „Photovoltaik Angebotsvergleich“ meldet?");
    expect(recheckReasonLabel(reasonOf([handover], "unklar"))).toBe("Weiß der Kunde, dass sich „Photovoltaik Angebotsvergleich“ meldet?");
    expect(recheckReasonLabel("K.-o.: „Ist der Kunde Eigentümer?“ = Nein")).toBeNull(); // Erstbewertung, keine Nachprüfung
    expect(recheckReasonLabel("Nachprüfung zurückgenommen: „X“ gehört nicht zur Kampagne")).toBeNull();
    expect(recheckReasonLabel(null)).toBeNull();
  });
  it("Käufer je Kampagne in beide Richtungen: nur der eigene Käufer – und gebundene Käufer keine Leads aus anderen Kampagnen", () => {
    const bindings = [{ campaign: "Test Wattfox", buyerUserId: 7, buyerName: "Wattfox" }, { campaign: "Aroundhome Solar", buyerUserId: 9, buyerName: "Aroundhome" }];
    expect(campaignDeliverySkip({ campaign: "Test Wattfox", bindings }, 7)).toBeNull();
    expect(campaignDeliverySkip({ campaign: "test wattfox", bindings }, 12)).toBe("Kampagne „Test Wattfox“ liefert nur an Wattfox");
    expect(campaignDeliverySkip({ campaign: "FB PV & WP - FOX", bindings }, 7)).toBe("Wattfox bekommt nur Leads aus „Test Wattfox“");
    expect(campaignDeliverySkip({ campaign: "FB PV & WP - FOX", bindings }, 12)).toBeNull(); // nicht gebunden: wie bisher
    expect(campaignDeliverySkip({ campaign: "FB PV & WP - FOX", bindings }, null)).toBeNull();
    expect(campaignDeliverySkip({ campaign: "FB PV & WP - FOX", bindings: [...bindings, { campaign: "Google PV", buyerUserId: 7, buyerName: "Wattfox" }] }, 7)).toBe("Wattfox bekommt nur Leads aus „Test Wattfox“, „Google PV“");
    expect(campaignDeliverySkip(null, 7)).toBeNull(); // Lead ohne Gespräch
  });
  it("Reparatur: Regeln kommen aus der Kampagne für neue Dialer-Gespräche – sonst aus der mit den meisten Gesprächen ohne Kampagnennamen, nie aus einer kaputten", () => {
    const rows = [{ id: 1, name: "Test Wattfox", ruled: true }, { id: 2, name: "Aroundhome", ruled: true }, { id: 3, name: "FB PV & WP - FOX", ruled: true }, { id: 4, name: "Ohne Regeln", ruled: false }];
    const broken = new Set([3]); const recent = [{ campaign: "Aroundhome", n: 2 }, { campaign: "Ohne Regeln", n: 40 }, { campaign: "Test Wattfox", n: 9 }, { campaign: "FB PV & WP - FOX", n: 99 }];
    expect(pickRulesSource(rows, broken, "Test Wattfox", recent)?.name).toBe("Test Wattfox");
    expect(pickRulesSource(rows, broken, "FB PV & WP - FOX", recent)?.name).toBe("Test Wattfox"); // Standard zeigt auf die kaputte → meiste Gespräche
    expect(pickRulesSource(rows, broken, null, recent)?.name).toBe("Test Wattfox");
    expect(pickRulesSource(rows, broken, "Gibt es nicht", [{ campaign: "Aroundhome", n: 1 }])?.name).toBe("Aroundhome");
    expect(pickRulesSource(rows, broken, null, [])).toBeUndefined();
  });
  it("„Neue Kampagne …“ übernimmt die Regeln von dort, wo die meisten Gespräche liegen – sonst wo neue landen; ohne eigene Regeln die Standard-Regeln", () => {
    const ruled = new Set(["Test Wattfox", "PV Q4"]);
    expect(rulesSourceFor(new Map([["Test Wattfox", 5], ["PV Q4", 2]]), "FB PV & WP - FOX", "Test Wattfox", ruled)).toBe("Test Wattfox");
    expect(rulesSourceFor(new Map([["PV Q4", 7], ["Test Wattfox", 2]]), "FB PV & WP - FOX", "Test Wattfox", ruled)).toBe("PV Q4");
    expect(rulesSourceFor(new Map(), "FB PV & WP - FOX", "Test Wattfox", ruled)).toBe("Test Wattfox"); // noch keine Gespräche: wo neue landen
    expect(rulesSourceFor(new Map([["Ohne Regeln", 3]]), "FB PV & WP - FOX", "Test Wattfox", ruled)).toBeNull(); // dort galten die Standard-Regeln
    expect(rulesSourceFor(new Map([["FB PV & WP - FOX", 4]]), "FB PV & WP - FOX", "FB PV & WP - FOX", ruled)).toBeNull();
  });
});
