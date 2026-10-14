import { describe, expect, it } from "vitest";
import { computeGeoFlows, PLZ2_STATE } from "../shared/plz-regions";

describe("Lead-Karte: Ströme nach Postleitzone", () => {
  it("gruppiert Auslieferungen je PLZ-Gebiet und Bundesland mit Lieferant → Kunde je Sparte", () => {
    const base = { occurredAt: new Date("2026-09-10T10:00:00"), unitPrice: "40.00", categoryId: 1, categoryName: "Photovoltaik", supplierName: "Flux Ads", buyerName: "Nordlicht Energie" };
    const result = computeGeoFlows([
      { ...base, postcode: "10115", result: "angenommen" }, { ...base, postcode: "12163", result: "angenommen" }, { ...base, postcode: "12167", result: "angeboten", buyerName: "Aurora Home" },
      { ...base, postcode: "80331", result: "angenommen", supplierName: "Orbit", categoryId: 2, categoryName: "Wärmepumpe" }, { ...base, postcode: "8001", country: "CH", result: "angenommen" }, { ...base, postcode: "20095", result: "abgelehnt" },
    ]);
    expect(result.totals).toMatchObject({ delivered: 4, offered: 1, areas: 3 });
    expect(result.areas[0]).toMatchObject({ plz2: "12", state: "BE", stateName: "Berlin", delivered: 1, offered: 1 });
    expect(result.areas.find((area) => area.plz2 === "80")?.rows[0]).toMatchObject({ supplierName: "Orbit", buyerName: "Nordlicht Energie", categoryName: "Wärmepumpe", delivered: 1 });
    expect(result.areas.find((area) => area.plz2 === "--")).toMatchObject({ delivered: 1 }); // Schweiz ohne deutsche PLZ
    expect(result.byState.map((row) => row.state)).toEqual(["BE", "BY"]);
    expect(PLZ2_STATE["44"]).toBe("NW");
  });
});
