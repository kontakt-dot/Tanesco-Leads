import { describe, expect, it } from "vitest";
import { computeOverlaps, describePostcodes, distanceKm, groupOverlapsByRegion, overlapsCsv, parsePostcodeText, topPlaces, type Territory } from "../shared/territories";

const universe = new Set(["60311", "60313", "60316", "61118", "61130", "61169", "63065", "63067", "63450", "65183", "20095", "20097", "80331"]);
const COORDS: Record<string, [number, number]> = { "60311": [50.1109, 8.6821], "60313": [50.1167, 8.6833], "60316": [50.1222, 8.7009], "61118": [50.1787, 8.7376], "61130": [50.2366, 8.8667], "61169": [50.3351, 8.7545], "63065": [50.1055, 8.7636], "63067": [50.0947, 8.7478], "63450": [50.1328, 8.9169], "65183": [50.0826, 8.2416], "20095": [53.5503, 10.0006], "20097": [53.5461, 10.0117], "80331": [48.1371, 11.5754] };
const lookup = { place: (name: string) => Array.from(universe).filter((plz) => placeOf(plz)?.toLowerCase() === name.trim().toLowerCase()).map((plz) => ({ plz, place: placeOf(plz)!, lat: COORDS[plz][0], lng: COORDS[plz][1] })), coords: (plz: string) => COORDS[plz] ? { lat: COORDS[plz][0], lng: COORDS[plz][1] } : null, all: () => Array.from(universe).map((plz) => ({ plz, lat: COORDS[plz][0], lng: COORDS[plz][1] })) };
const placeOf = (plz: string) => ({ "60311": "Frankfurt am Main", "60313": "Frankfurt am Main", "60316": "Frankfurt am Main", "61118": "Bad Vilbel", "61130": "Nidderau", "61169": "Friedberg", "63065": "Offenbach", "63067": "Offenbach", "63450": "Hanau", "65183": "Wiesbaden", "20095": "Hamburg", "20097": "Hamburg", "80331": "München" } as Record<string, string>)[plz] ?? null;

describe("Gebietskarte: PLZ-Listen lesen, Überschneidungen rechnen", () => {
  it("liest 5-stellige PLZ, Vorwahl-Bereiche und Bereiche – unbekannte und Text werden gemeldet", () => {
    const parsed = parsePostcodeText("PLZ;Ort\n60311;Frankfurt\n60313, 60313\n61 (ganz)\n63000-63099\n65000 bis 65199\nD-20095\n99999\nabc", universe);
    expect(parsed.postcodes).toEqual(["20095", "60311", "60313", "61118", "61130", "61169", "63065", "63067", "65183"]);
    expect(parsed.direct).toBe(3); expect(parsed.fromPrefixes).toBe(3); expect(parsed.prefixes).toEqual(["61"]); expect(parsed.fromRanges).toBe(3); expect(parsed.ranges).toEqual([["63000", "63099"], ["65000", "65199"]]);
    expect(parsed.unknown).toEqual(["99999"]); expect(parsed.ignored).toBeGreaterThanOrEqual(2); // „PLZ“, „Ort“, „Frankfurt“, „(ganz)“, „abc“
    expect(parsePostcodeText("", universe).postcodes).toEqual([]); expect(parsePostcodeText("12", universe).unknown).toEqual(["12"]);
  });
  it("erkennt Orte und Umkreise: „Frankfurt 20 km Umkreis“, „Offenbach“, „60311 5km“ – Unbekanntes wird gemeldet", () => {
    const parsed = parsePostcodeText("Frankfurt 20 km Umkreis\nOffenbach\nHamburg\nAtlantis 30 km\n80331", universe, { lookup });
    expect(parsed.radii).toEqual([{ center: "Frankfurt am Main", km: 20, count: 8 }]); // Rhein-Main-PLZ ohne Wiesbaden (≈ 32 km) und Friedberg (≈ 25 km) – Offenbach/Hanau/Bad Vilbel/Nidderau drin
    expect(parsed.postcodes).toContain("63450"); expect(parsed.postcodes).not.toContain("65183"); expect(parsed.postcodes).not.toContain("61169");
    expect(parsed.places).toEqual([{ name: "Offenbach", count: 0 }, { name: "Hamburg", count: 2 }]); // Offenbach lag schon im Umkreis → 0 neu
    expect(parsed.fromPlaces).toBe(2); expect(parsed.direct).toBe(1); expect(parsed.unknownPlaces).toEqual(["Atlantis"]);
    const around = parsePostcodeText("60311 5km", universe, { lookup }); expect(around.radii[0]).toMatchObject({ center: "60311", km: 5 }); expect(around.postcodes).toEqual(["60311", "60313", "60316"]);
    expect(parsePostcodeText("100 km um Hamburg", universe, { lookup }).postcodes).toEqual(["20095", "20097"]);
    expect(parsePostcodeText("PLZ;Ort\n60311;Frankfurt", universe, { lookup }).postcodes).toEqual(["60311"]); // Kopfzeile und Ortsspalte stören nicht
    expect(parsePostcodeText("Frankfurt 20 km", universe).radii).toEqual([]); // ohne Ortssuche: Zeile wird als normale PLZ-Zeile gelesen (nichts erkannt)
    expect(Math.round(distanceKm({ lat: 50.1109, lng: 8.6821 }, { lat: 53.5503, lng: 10.0006 }))).toBe(393); // Frankfurt – Hamburg
  });
  it("findet PLZ, die bei mehreren Kunden derselben Kategorie liegen – je Kategorie, mit Kundenpaaren und Region", () => {
    const territories: Territory[] = [
      { id: 1, customerName: "Aurora", categoryId: 1, color: "#e2583e", postcodes: ["60311", "60313", "60316", "61118", "63065"] },
      { id: 2, customerName: "Helios", categoryId: 1, color: "#13a37a", postcodes: ["60311", "60313", "63065", "63067", "65183"] },
      { id: 3, customerName: "Sonne", categoryId: 1, color: "#d9a21b", postcodes: ["60311", "20095"] },
      { id: 4, customerName: "Vektor", categoryId: 2, color: "#8b5cf6", postcodes: ["60311", "60313", "80331"] }, // andere Kategorie → keine Überschneidung mit PV
      { id: 5, customerName: "Ohne", categoryId: null, color: "#64748b", postcodes: ["60311"] },
    ];
    const result = computeOverlaps(territories, [{ id: 1, name: "Photovoltaik" }, { id: 2, name: "Wärmepumpe" }]);
    expect(result.totalCoveredPlz).toBe(9); expect(result.totalOverlapPlz).toBe(3);
    const pv = result.groups.find((group) => group.categoryId === 1)!;
    expect(pv).toMatchObject({ categoryName: "Photovoltaik", customers: 3, coveredPlz: 8, overlapPlz: 3, maxCustomers: 3 });
    expect(pv.items[0]).toMatchObject({ plz: "60311", count: 3 }); expect(pv.items.map((item) => item.plz)).toEqual(["60311", "60313", "63065"]);
    expect(pv.pairs[0]).toMatchObject({ shared: 3 }); expect(pv.pairs.map((pair) => `${pair.a.customerName}+${pair.b.customerName}:${pair.shared}`)).toEqual(["Aurora+Helios:3", "Aurora+Sonne:1", "Helios+Sonne:1"]);
    expect(result.groups.find((group) => group.categoryId === 2)?.overlapPlz).toBe(0); expect(result.groups.find((group) => group.categoryId === null)?.categoryName).toBe("Ohne Kategorie");
    const regions = groupOverlapsByRegion(pv.items, placeOf);
    expect(regions.map((region) => [region.region, region.plzCount, region.maxCustomers])).toEqual([["60", 2, 3], ["63", 1, 2]]); expect(regions[0].places).toEqual(["Frankfurt am Main"]); expect(regions[0].customers.map((customer) => customer.customerName).sort()).toEqual(["Aurora", "Helios", "Sonne"]);
    const csv = overlapsCsv(result.groups, placeOf); expect(csv.split("\n")[0]).toBe("Kategorie;PLZ;Ort;Anzahl Kunden;Kunden"); expect(csv).toContain("Photovoltaik;60311;Frankfurt am Main;3;Aurora + Helios + Sonne");
  });
  it("beschreibt Gebiete mit den häufigsten Orten – Ausreißer dominieren nicht", () => {
    expect(topPlaces(["60311", "60313", "60316", "65183"], placeOf, 2)).toEqual(["Frankfurt am Main", "Wiesbaden"]);
    expect(describePostcodes(["20095", "20097", "60311", "80331", "61118"], placeOf, 2)).toBe("5 PLZ · Hamburg, Bad Vilbel …");
  });
  it("ein Kunde ist ein Verkauf: zwei Gebiete desselben Kunden in einer Kategorie zählen als EIN Kunde", () => {
    const list: Territory[] = [
      { id: 1, customerName: "Younes", categoryId: 1, color: "#111111", postcodes: ["60311", "60313"] },
      { id: 2, customerName: "younes ", categoryId: 1, color: "#111111", postcodes: ["60311", "61118"] },
      { id: 3, customerName: "Musterhaus", categoryId: 1, color: "#222222", postcodes: ["60311"] },
      { id: 4, customerName: "Younes", categoryId: 2, color: "#111111", postcodes: ["60311"] },
    ];
    const result = computeOverlaps(list, [{ id: 1, name: "Photovoltaik" }, { id: 2, name: "Wärmepumpe" }]);
    const pv = result.groups.find((group) => group.categoryId === 1)!;
    expect(pv.items).toEqual([{ plz: "60311", count: 2, customers: [{ id: 1, customerName: "Younes", color: "#111111" }, { id: 3, customerName: "Musterhaus", color: "#222222" }] }]); // nicht 3×
    expect(pv.customers).toBe(2); expect(pv.coveredPlz).toBe(3);
    expect(result.groups.find((group) => group.categoryId === 2)!.items).toEqual([]); // andere Kategorie zählt nicht mit
  });
});
