import { describe, expect, it } from "vitest";
import { byChainOrder, chainAcceptsSupplier, chainPlaces, chainsOverlap, parsePrice, reorderedPriorities, ruleSentence, suggestChainName, supplierText, type ChainRule } from "../shared/chain-rules";

const chain = (id: number, values: Partial<ChainRule> = {}): ChainRule => ({ id, name: `Kette ${id}`, categoryId: 1, priority: 1, status: "aktiv", supplierFilterMode: "all", supplierIds: [], ...values });

describe("Lieferketten – feste Verteilung", () => {
  it("ordnet Ketten fest: kleinere Zahl zuerst, bei gleicher Zahl die ältere", () => {
    const rows = [chain(5, { priority: 2 }), chain(9, { priority: 1 }), chain(3, { priority: 1 }), chain(7, { priority: 3 })];
    expect(rows.slice().sort(byChainOrder).map((row) => row.id)).toEqual([3, 9, 5, 7]);
  });

  it("weiß, welche Lieferanten eine Kette annimmt – „nur diese“, „alle außer“ oder alle", () => {
    expect(chainAcceptsSupplier(chain(1), 4)).toBe(true); expect(chainAcceptsSupplier(chain(1), null)).toBe(true);
    const only = chain(2, { supplierFilterMode: "include", supplierIds: [4, 5] });
    expect(chainAcceptsSupplier(only, 4)).toBe(true); expect(chainAcceptsSupplier(only, 6)).toBe(false); expect(chainAcceptsSupplier(only, null)).toBe(false); // Lead ohne Lieferant passt nicht zu „nur diese“
    const except = chain(3, { supplierFilterMode: "exclude", supplierIds: [4] });
    expect(chainAcceptsSupplier(except, 4)).toBe(false); expect(chainAcceptsSupplier(except, 6)).toBe(true); expect(chainAcceptsSupplier(except, null)).toBe(true);
  });

  it("erkennt, ob zwei Ketten denselben Lead bekommen könnten", () => {
    const a = chain(1, { supplierFilterMode: "include", supplierIds: [4] }); const b = chain(2, { supplierFilterMode: "include", supplierIds: [5] }); const c = chain(3, { supplierFilterMode: "include", supplierIds: [4, 5] });
    expect(chainsOverlap(a, b)).toBe(false); expect(chainsOverlap(a, c)).toBe(true); expect(chainsOverlap(c, b)).toBe(true);
    expect(chainsOverlap(a, chain(4))).toBe(true); // „alle Lieferanten“ überschneidet sich mit jeder Kette derselben Kategorie
    expect(chainsOverlap(a, chain(5, { supplierFilterMode: "exclude", supplierIds: [4] }))).toBe(false); expect(chainsOverlap(c, chain(5, { supplierFilterMode: "exclude", supplierIds: [4] }))).toBe(true);
    expect(chainsOverlap(chain(6, { supplierFilterMode: "exclude", supplierIds: [4] }), chain(7, { supplierFilterMode: "exclude", supplierIds: [5] }))).toBe(true);
    expect(chainsOverlap(a, chain(8, { categoryId: 2 }))).toBe(false); // andere Kategorie
    expect(chainsOverlap(a, a)).toBe(false);
    expect(chainsOverlap(chain(9, { supplierFilterMode: "include", supplierIds: [] }), chain(4))).toBe(false); // „nur diese“ ohne Auswahl nimmt nichts an
  });

  it("vergibt je Kategorie feste Plätze und nennt die Ketten, die bei demselben Lead vorher drankommen", () => {
    const rows = [chain(1, { priority: 2 }), chain(2, { priority: 1, supplierFilterMode: "include", supplierIds: [4] }), chain(3, { priority: 3, supplierFilterMode: "include", supplierIds: [5] }), chain(4, { priority: 1, categoryId: 2 }), chain(5, { priority: 1, status: "inaktiv" })];
    const places = chainPlaces(rows);
    expect(rows.filter((row) => row.categoryId === 1).sort(byChainOrder).map((row) => [row.id, places.get(row.id)!.place])).toEqual([[2, 1], [5, 2], [1, 3], [3, 4]]);
    expect(places.get(4)).toEqual({ place: 1, overlapsWith: [], before: [] });
    expect(places.get(1)).toEqual({ place: 3, overlapsWith: [2, 3], before: [2] }); // „alle Lieferanten“ teilt sich Leads mit beiden; Kette 2 kommt vorher
    expect(places.get(3)).toEqual({ place: 4, overlapsWith: [1], before: [1] }); // Kette 2 nimmt nur Lieferant 4 – keine Überschneidung mit Kette 3
    expect(places.get(2)).toEqual({ place: 1, overlapsWith: [1], before: [] });
    expect(places.get(5)).toEqual({ place: 2, overlapsWith: [], before: [] }); // inaktiv: bekommt keine Leads, also auch keine Überschneidung
  });

  it("schreibt Lieferanten in Worten und schlägt einen Namen für die Kette vor", () => {
    expect(supplierText("all", [])).toBe("Alle Lieferanten"); expect(supplierText("include", ["OnDialer", "Leadquelle Nord"])).toBe("OnDialer, Leadquelle Nord");
    expect(supplierText("include", [])).toBe("Kein Lieferant gewählt"); expect(supplierText("exclude", ["Leadquelle Nord"])).toBe("Alle außer Leadquelle Nord"); expect(supplierText("exclude", [])).toBe("Alle Lieferanten");
    expect(suggestChainName("Photovoltaik", ["OnDialer"], ["Nordlicht Energie", "Aurora Home"])).toBe("Photovoltaik: OnDialer → Nordlicht Energie → Aurora Home");
    expect(suggestChainName("Wärmepumpe", [], [])).toBe("Wärmepumpe: Alle Lieferanten → noch kein Kunde");
    expect(suggestChainName("PV", ["A", "B", "C", "D"], ["K1", "K2", "K3", "K4"])).toBe("PV: A + B + 2 → K1 → K2 → K3 → …");
    expect(suggestChainName("X".repeat(200), [], []).length).toBe(160);
  });

  it("sagt die Regel einer Kette in einem Satz", () => {
    expect(ruleSentence(["Photovoltaik"], "OnDialer", ["Solar Nord", "Aurora Home"])).toBe("Leads aus Photovoltaik von OnDialer gehen zuerst an Solar Nord. Nimmt Solar Nord einen Lead nicht, geht er an Aurora Home.");
    expect(ruleSentence(["Photovoltaik", "Wärmepumpe", "Fenster"], "Alle Lieferanten", ["Solar Nord", "Aurora Home", "Haus & Dach"])).toBe("Leads aus Photovoltaik, Wärmepumpe und Fenster von allen Lieferanten gehen zuerst an Solar Nord. Nimmt Solar Nord einen Lead nicht, geht er an Aurora Home, danach an Haus & Dach.");
    expect(ruleSentence(["Photovoltaik"], "Alle außer Leadquelle Nord", ["Solar Nord"])).toBe("Leads aus Photovoltaik von allen Lieferanten außer Leadquelle Nord gehen zuerst an Solar Nord.");
    expect(ruleSentence(["Photovoltaik"], "OnDialer, Leadquelle Nord", [])).toBe("Leads aus Photovoltaik von OnDialer, Leadquelle Nord: Es ist noch kein Kunde eingetragen.");
    expect(ruleSentence([], "Kein Lieferant gewählt", ["Solar Nord"])).toBe("Leads (noch kein Lieferant gewählt) gehen zuerst an Solar Nord.");
  });

  it("nummeriert eine neue Reihenfolge fortlaufend durch – doppelte Nennungen zählen einmal", () => {
    expect(reorderedPriorities([7, 3, 9])).toEqual([{ id: 7, priority: 1 }, { id: 3, priority: 2 }, { id: 9, priority: 3 }]);
    expect(reorderedPriorities([4, 4, 2])).toEqual([{ id: 4, priority: 1 }, { id: 2, priority: 2 }]);
  });
});

describe("Preis aus dem Feld (v370)", () => {
  it("liest Komma und Punkt, Tausenderpunkte mit Komma, nie negativ", () => {
    expect(parsePrice("44,50")).toBe(44.5); expect(parsePrice("44.50")).toBe(44.5); expect(parsePrice("1.250,00")).toBe(1250); expect(parsePrice(" 39 ")).toBe(39);
    expect(parsePrice("")).toBe(0); expect(parsePrice("abc")).toBe(0); expect(parsePrice("-5")).toBe(0);
  });
});
