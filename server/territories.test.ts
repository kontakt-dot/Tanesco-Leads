import { describe, expect, it } from "vitest";
import { computeOverlaps, describePostcodes, groupOverlapsByRegion, overlapsCsv, parsePostcodeText, topPlaces, type Territory } from "../shared/territories";

const universe = new Set(["60311", "60313", "60316", "61118", "61130", "61169", "63065", "63067", "63450", "65183", "20095", "20097", "80331"]);
const placeOf = (plz: string) => ({ "60311": "Frankfurt am Main", "60313": "Frankfurt am Main", "60316": "Frankfurt am Main", "61118": "Bad Vilbel", "61130": "Nidderau", "61169": "Friedberg", "63065": "Offenbach", "63067": "Offenbach", "63450": "Hanau", "65183": "Wiesbaden", "20095": "Hamburg", "20097": "Hamburg", "80331": "München" } as Record<string, string>)[plz] ?? null;

describe("Gebietskarte: PLZ-Listen lesen, Überschneidungen rechnen", () => {
  it("liest 5-stellige PLZ, Vorwahl-Bereiche und Bereiche – unbekannte und Text werden gemeldet", () => {
    const parsed = parsePostcodeText("PLZ;Ort\n60311;Frankfurt\n60313, 60313\n61 (ganz)\n63000-63099\n65000 bis 65199\nD-20095\n99999\nabc", universe);
    expect(parsed.postcodes).toEqual(["20095", "60311", "60313", "61118", "61130", "61169", "63065", "63067", "65183"]);
    expect(parsed.direct).toBe(3); expect(parsed.fromPrefixes).toBe(3); expect(parsed.prefixes).toEqual(["61"]); expect(parsed.fromRanges).toBe(3); expect(parsed.ranges).toEqual([["63000", "63099"], ["65000", "65199"]]);
    expect(parsed.unknown).toEqual(["99999"]); expect(parsed.ignored).toBeGreaterThanOrEqual(2); // „PLZ“, „Ort“, „Frankfurt“, „(ganz)“, „abc“
    expect(parsePostcodeText("", universe).postcodes).toEqual([]); expect(parsePostcodeText("12", universe).unknown).toEqual(["12"]);
  });
  it("findet PLZ, die bei mehreren Kunden derselben Sparte liegen – je Sparte, mit Kundenpaaren und Region", () => {
    const territories: Territory[] = [
      { id: 1, customerName: "Aurora", categoryId: 1, color: "#e2583e", postcodes: ["60311", "60313", "60316", "61118", "63065"] },
      { id: 2, customerName: "Helios", categoryId: 1, color: "#13a37a", postcodes: ["60311", "60313", "63065", "63067", "65183"] },
      { id: 3, customerName: "Sonne", categoryId: 1, color: "#d9a21b", postcodes: ["60311", "20095"] },
      { id: 4, customerName: "Vektor", categoryId: 2, color: "#8b5cf6", postcodes: ["60311", "60313", "80331"] }, // andere Sparte → keine Überschneidung mit PV
      { id: 5, customerName: "Ohne", categoryId: null, color: "#64748b", postcodes: ["60311"] },
    ];
    const result = computeOverlaps(territories, [{ id: 1, name: "Photovoltaik" }, { id: 2, name: "Wärmepumpe" }]);
    expect(result.totalCoveredPlz).toBe(9); expect(result.totalOverlapPlz).toBe(3);
    const pv = result.groups.find((group) => group.categoryId === 1)!;
    expect(pv).toMatchObject({ categoryName: "Photovoltaik", customers: 3, coveredPlz: 8, overlapPlz: 3, maxCustomers: 3 });
    expect(pv.items[0]).toMatchObject({ plz: "60311", count: 3 }); expect(pv.items.map((item) => item.plz)).toEqual(["60311", "60313", "63065"]);
    expect(pv.pairs[0]).toMatchObject({ shared: 3 }); expect(pv.pairs.map((pair) => `${pair.a.customerName}+${pair.b.customerName}:${pair.shared}`)).toEqual(["Aurora+Helios:3", "Aurora+Sonne:1", "Helios+Sonne:1"]);
    expect(result.groups.find((group) => group.categoryId === 2)?.overlapPlz).toBe(0); expect(result.groups.find((group) => group.categoryId === null)?.categoryName).toBe("Ohne Sparte");
    const regions = groupOverlapsByRegion(pv.items, placeOf);
    expect(regions.map((region) => [region.region, region.plzCount, region.maxCustomers])).toEqual([["60", 2, 3], ["63", 1, 2]]); expect(regions[0].places).toEqual(["Frankfurt am Main"]); expect(regions[0].customers.map((customer) => customer.customerName).sort()).toEqual(["Aurora", "Helios", "Sonne"]);
    const csv = overlapsCsv(result.groups, placeOf); expect(csv.split("\n")[0]).toBe("Sparte;PLZ;Ort;Anzahl Kunden;Kunden"); expect(csv).toContain("Photovoltaik;60311;Frankfurt am Main;3;Aurora + Helios + Sonne");
  });
  it("beschreibt Gebiete mit den häufigsten Orten – Ausreißer dominieren nicht", () => {
    expect(topPlaces(["60311", "60313", "60316", "65183"], placeOf, 2)).toEqual(["Frankfurt am Main", "Wiesbaden"]);
    expect(describePostcodes(["20095", "20097", "60311", "80331", "61118"], placeOf, 2)).toBe("5 PLZ · Hamburg, Bad Vilbel …");
  });
});
