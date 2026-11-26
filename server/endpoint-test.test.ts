import { describe, expect, it } from "vitest";
import { endpointHost, endpointTestKind, endpointTestLabel, endpointTestNote, endpointTestTargets, type EndpointTestRow } from "../shared/endpoint-test";
import { WATTFOX, WATTFOX_TEMPLATE } from "../shared/wattfox";

/** Leads → „Testlead senden“ (v377): die Schnittstellen der Käufer als Ziele – was in der Auswahl steht und was beim Senden passiert. */
const row = (patch: Partial<EndpointTestRow>): EndpointTestRow => ({ id: 1, membershipId: 10, categoryId: 3, url: "https://crm.beispiel.example/api/leads?key=geheim", bodyTemplate: "", position: 0, buyerName: "Petra Sommer", company: null, memberStatus: "aktiv", categoryName: "Photovoltaik", ...patch });

describe("Testlead: Schnittstellen der Käufer", () => {
  it("Ziel: nur der Rechnername – nie Pfad oder Parameter (dort können Schlüssel stehen)", () => {
    expect(endpointHost("https://crm.beispiel.example/api/leads?key=geheim")).toBe("crm.beispiel.example");
    expect(endpointHost(" https://partner.example:8443/v1 ")).toBe("partner.example:8443");
    expect(endpointHost("kein link")).toBe(""); expect(endpointHost(null)).toBe("");
    const [target] = endpointTestTargets([row({})]);
    expect(Object.keys(target).sort()).toEqual(["buyerName", "categoryId", "categoryName", "host", "id", "kind", "membershipId"]);
    expect(JSON.stringify(target)).not.toContain("geheim"); expect(JSON.stringify(target)).not.toContain("/api/leads");
  });

  it("Art des Tests: Wattfox-Vorlage auf der Live-Adresse prüft nur die Anmeldung, die Testumgebung und alle anderen bekommen einen erfundenen Lead", () => {
    expect(endpointTestKind({ url: WATTFOX.liveLeadsUrl, bodyTemplate: WATTFOX_TEMPLATE })).toBe("wattfox-live");
    expect(endpointTestKind({ url: WATTFOX.leadsUrl, bodyTemplate: WATTFOX_TEMPLATE })).toBe("wattfox-test");
    expect(endpointTestKind({ url: WATTFOX.liveLeadsUrl, bodyTemplate: "{\"first_name\":\"{{first_name}}\"}" })).toBe("standard"); // ohne die Vorlage ist es eine gewöhnliche Schnittstelle
    expect(endpointTestKind({ url: null, bodyTemplate: null })).toBe("standard");
    expect(endpointTestNote("wattfox-live")).toContain("kein erfundener Lead"); expect(endpointTestNote("wattfox-live")).toContain("nur die Anmeldung");
    expect(endpointTestNote("wattfox-test")).toContain("Testumgebung"); expect(endpointTestNote("standard")).toContain("erfundener Lead ohne Kundendaten");
  });

  it("Auswahl: deaktivierte Käufer fehlen; sortiert nach Käufer, Kategorie, Reihenfolge; Firma steht vor der Ansprechperson", () => {
    const targets = endpointTestTargets([
      row({ id: 4, membershipId: 12, buyerName: "Zoe Zander", categoryName: "Wärmepumpe" }),
      row({ id: 3, membershipId: 11, buyerName: "Karl Abel", company: "Abel Energie GmbH", categoryName: "Wärmepumpe", position: 1 }),
      row({ id: 2, membershipId: 11, buyerName: "Karl Abel", company: "Abel Energie GmbH", categoryName: "Photovoltaik" }),
      row({ id: 5, membershipId: 13, buyerName: "Weg Damit", memberStatus: "deaktiviert" }),
      row({ id: 6, membershipId: 14, buyerName: "  ", company: null, categoryName: null }),
      row({ id: 7, membershipId: 15, buyerName: "Solo GmbH", company: "Solo GmbH" }),
    ]);
    expect(targets.map((item) => item.id)).toEqual([2, 3, 6, 7, 4]);
    expect(targets.map((item) => item.buyerName)).toEqual(["Abel Energie GmbH (Karl Abel)", "Abel Energie GmbH (Karl Abel)", "Käufer #14", "Solo GmbH", "Zoe Zander"]);
    expect(targets[2].categoryName).toBe("ohne Kategorie");
  });

  it("Beschriftung: „Käufer · Kategorie“ – Wattfox mit dem System, doppelte mit dem Ziel", () => {
    const targets = endpointTestTargets([
      row({ id: 1, url: WATTFOX.liveLeadsUrl, bodyTemplate: WATTFOX_TEMPLATE }),
      row({ id: 2, membershipId: 20, buyerName: "Zwei Wege", url: "https://a.example/x", position: 0 }),
      row({ id: 3, membershipId: 20, buyerName: "Zwei Wege", url: "https://b.example/y", position: 1 }),
    ]);
    const label = (id: number) => endpointTestLabel(targets.find((item) => item.id === id)!, targets);
    expect(label(1)).toBe("Petra Sommer · Photovoltaik – Wattfox live");
    expect(label(2)).toBe("Zwei Wege · Photovoltaik (a.example)"); expect(label(3)).toBe("Zwei Wege · Photovoltaik (b.example)");
    const test = endpointTestTargets([row({ url: WATTFOX.leadsUrl, bodyTemplate: WATTFOX_TEMPLATE })]);
    expect(endpointTestLabel(test[0], test)).toBe("Petra Sommer · Photovoltaik – Wattfox Testumgebung");
  });
});
