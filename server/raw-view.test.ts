import { describe, expect, it } from "vitest";
import { RAW_STATUS, emptyRawCounts, rawDoneText, rawOpen, rawSegments, rawShare, rawStatusLabel, rawTotals, type RawCounts } from "../shared/raw-view";

const counts = (values: Partial<RawCounts>): RawCounts => { const filled = { ...emptyRawCounts(), ...values }; return { ...filled, total: values.total ?? filled.neu + filled.in_liste + filled.konvertiert + filled.verworfen + filled.duplikat }; };

describe("Rohdaten: Zahlen der Listen", () => {
  it("alle Listen zusammen; offen = neu + in Wählliste", () => {
    const totals = rawTotals([{ counts: counts({ neu: 4, verworfen: 1, duplikat: 1 }) }, { counts: counts({ in_liste: 6, konvertiert: 8, verworfen: 4, duplikat: 2 }) }, { counts: counts({ konvertiert: 3 }) }]);
    expect(totals).toEqual({ total: 29, neu: 4, in_liste: 6, konvertiert: 11, verworfen: 5, duplikat: 3 });
    expect(rawOpen(totals)).toBe(10); expect(rawShare(totals.konvertiert, totals.total)).toBe(38);
    expect(rawTotals([])).toEqual(emptyRawCounts()); expect(rawShare(3, 0)).toBe(0);
  });
  it("Reiter in fester Reihenfolge, mit deutschen Namen", () => {
    expect(RAW_STATUS.map(([key]) => key)).toEqual(["neu", "in_liste", "konvertiert", "verworfen", "duplikat"]);
    expect(["neu", "in_liste", "konvertiert", "verworfen", "duplikat", "anders"].map(rawStatusLabel)).toEqual(["Neu", "In Wählliste", "Lead", "Verworfen", "Doppelt", "anders"]);
  });
});

describe("Rohdaten: Balken einer Liste", () => {
  it("fünf Teile von „geschafft“ bis „fällt weg“; die Anteile ergeben zusammen 100", () => {
    const segments = rawSegments(counts({ in_liste: 6, konvertiert: 8, verworfen: 4, duplikat: 2 }));
    expect(segments.map((segment) => `${segment.key}:${segment.count}:${segment.label}`)).toEqual(["konvertiert:8:Leads", "in_liste:6:in Wählliste", "neu:0:neu", "verworfen:4:verworfen", "duplikat:2:doppelt"]);
    expect(segments.map((segment) => segment.share)).toEqual([40, 30, 0, 20, 10]); expect(segments.reduce((sum, segment) => sum + segment.share, 0)).toBe(100);
  });
  it("ein einzelner Lead heißt „Lead“; eine leere Liste hat keine Anteile", () => {
    expect(rawSegments(counts({ konvertiert: 1, neu: 2 }))[0].label).toBe("Lead");
    expect(rawSegments(emptyRawCounts()).every((segment) => segment.count === 0 && segment.share === 0)).toBe(true);
  });
});

describe("Rohdaten: Liste ohne offene Kontakte", () => {
  it("solange Kontakte offen sind oder die Liste leer ist, steht nichts da", () => {
    expect(rawDoneText(counts({ neu: 1, konvertiert: 5 }))).toBeNull(); expect(rawDoneText(counts({ in_liste: 2 }))).toBeNull(); expect(rawDoneText(emptyRawCounts())).toBeNull();
  });
  it("alles Leads: ein Satz – auch für einen einzelnen Kontakt", () => {
    expect(rawDoneText(counts({ konvertiert: 3 }))).toBe("Alle 3 Kontakte sind schon Leads – hier gibt es nichts mehr zu übernehmen.");
    expect(rawDoneText(counts({ konvertiert: 1 }))).toBe("Der Kontakt ist schon ein Lead – hier gibt es nichts mehr zu übernehmen.");
  });
  it("gemischt: steht da, was aus den Kontakten wurde", () => {
    expect(rawDoneText(counts({ konvertiert: 2, verworfen: 3, duplikat: 1 }))).toBe("Kein Kontakt mehr offen (2 sind schon Leads, 3 verworfen, 1 doppelt) – hier gibt es nichts mehr zu übernehmen.");
    expect(rawDoneText(counts({ konvertiert: 1, verworfen: 1 }))).toBe("Kein Kontakt mehr offen (1 ist schon ein Lead, 1 verworfen) – hier gibt es nichts mehr zu übernehmen.");
    expect(rawDoneText(counts({ duplikat: 4 }))).toBe("Kein Kontakt mehr offen (4 doppelt) – hier gibt es nichts mehr zu übernehmen.");
  });
});
