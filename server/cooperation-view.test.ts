import { describe, expect, it } from "vitest";
import { COOP_DIRECTIONS, COOP_STATUS, coopCounts, coopDirectionLabel, coopDirectionShort, coopFieldLabel, coopMatches, coopNameIssue, coopNextStep, coopStatusLabel, coopStatusTone, coopSummary, type CoopRow } from "../shared/cooperation-view";

const row = (values: Partial<CoopRow>): CoopRow => ({ id: 1, partnerTenantName: "Solarnetz Bayern", partnerTenantId: null, direction: "beidseitig", status: "aktiv", categories: [], fields: [], ...values });

describe("Kooperationen: Worte für Stand und Richtung", () => {
  it("Stand: aktiv, angefragt, pausiert – in dieser Reihenfolge; Farbe nur, wo etwas zu klären ist", () => {
    expect(COOP_STATUS.map((item) => [item.key, item.label])).toEqual([["aktiv", "Aktiv"], ["angefragt", "Angefragt"], ["inaktiv", "Pausiert"]]);
    expect(["aktiv", "angefragt", "inaktiv", "anders"].map(coopStatusLabel)).toEqual(["Aktiv", "Angefragt", "Pausiert", "anders"]);
    expect(["aktiv", "angefragt", "inaktiv"].map(coopStatusTone)).toEqual(["good", "warn", "mute"]);
  });
  it("Richtung in ganzen Sätzen – wer an wen liefert", () => {
    expect(COOP_DIRECTIONS.map((item) => item.key)).toEqual(["ausgehend", "eingehend", "beidseitig"]);
    expect(coopDirectionLabel("ausgehend")).toBe("Wir liefern Leads an den Partner"); expect(coopDirectionLabel("eingehend")).toBe("Der Partner liefert Leads an uns"); expect(coopDirectionLabel("beidseitig")).toBe("Leads gehen in beide Richtungen");
    expect(["ausgehend", "eingehend", "beidseitig", "quer"].map(coopDirectionShort)).toEqual(["Wir liefern", "Partner liefert", "Beide Richtungen", "quer"]);
  });
  it("der Hauptknopf: angefragt → aktivieren, aktiv → pausieren, pausiert → wieder aktivieren", () => {
    expect(coopNextStep("angefragt")).toEqual({ status: "aktiv", label: "Aktivieren", done: "Kooperation ist aktiv." });
    expect(coopNextStep("aktiv")).toEqual({ status: "inaktiv", label: "Pausieren", done: "Kooperation pausiert." });
    expect(coopNextStep("inaktiv")).toEqual({ status: "aktiv", label: "Wieder aktivieren", done: "Kooperation ist wieder aktiv." });
  });
  it("Felder: „Vorname“ statt „firstName“ – unbekannte Namen bleiben, wie sie eingetragen wurden", () => {
    expect(["firstName", "lastName", "email", "phone", "postcode", "city", "FIRSTNAME", " phone "].map(coopFieldLabel)).toEqual(["Vorname", "Nachname", "E-Mail", "Telefon", "PLZ", "Ort", "Vorname", "Telefon"]);
    expect(coopFieldLabel("dachflaeche_m2")).toBe("dachflaeche_m2");
  });
});

describe("Kooperationen: Zahlen der Leiste und die Zeile je Partner", () => {
  const rows = [
    row({ id: 1, status: "aktiv", categories: [{ sourceCategoryId: 1, partnerCategoryName: "Solar" }, { sourceCategoryId: 2, partnerCategoryName: "Heizung" }], fields: [{ sourceField: "phone", partnerField: "telefon" }] }),
    row({ id: 2, status: "angefragt" }),
    row({ id: 3, status: "inaktiv", fields: [{ sourceField: "email", partnerField: "mail" }] }),
    row({ id: 4, status: "aktiv" }),
  ];
  it("zählt je Stand, alle Zuordnungen zusammen und die Partner ohne Zuordnung", () => {
    expect(coopCounts(rows)).toEqual({ alle: 4, aktiv: 2, angefragt: 1, inaktiv: 1, zuordnungen: 4, ohneZuordnung: 2 });
    expect(coopCounts([])).toEqual({ alle: 0, aktiv: 0, angefragt: 0, inaktiv: 0, zuordnungen: 0, ohneZuordnung: 0 });
  });
  it("„2 Kategorien · 1 Feld zugeordnet“ – Einzahl und Mehrzahl stimmen; ohne Zuordnung steht das da", () => {
    expect(rows.map(coopSummary)).toEqual(["2 Kategorien · 1 Feld zugeordnet", "noch nichts zugeordnet", "1 Feld zugeordnet", "noch nichts zugeordnet"]);
    expect(coopSummary({ categories: [{ sourceCategoryId: 1, partnerCategoryName: "Solar" }], fields: [{ sourceField: "a", partnerField: "b" }, { sourceField: "c", partnerField: "d" }] })).toBe("1 Kategorie · 2 Felder zugeordnet");
  });
});

describe("Kooperationen: Suche", () => {
  const names: Record<number, string> = { 1: "Photovoltaik", 2: "Wärmepumpe" };
  const partner = row({ partnerTenantName: "Solarnetz Bayern", direction: "beidseitig", status: "aktiv", categories: [{ sourceCategoryId: 1, partnerCategoryName: "Solar Privat" }, { sourceCategoryId: 2, partnerCategoryName: "Heizung Wärmepumpe" }], fields: [{ sourceField: "postcode", partnerField: "zip" }] });
  const find = (query: string) => coopMatches(partner, query, (id) => names[id] ?? null);
  it("findet über den Namen, die Richtung, den Stand – ohne auf Groß-/Kleinschreibung und Umlaute zu achten", () => {
    expect(find("")).toBe(true); expect(find("   ")).toBe(true);
    expect(find("solarnetz")).toBe(true); expect(find("BAYERN solar")).toBe(true); expect(find("beide richtungen")).toBe(true); expect(find("aktiv")).toBe(true);
    expect(find("nord")).toBe(false); expect(find("solarnetz nord")).toBe(false); // jedes Wort muss vorkommen
  });
  it("findet über Kategorien (unser Name und der beim Partner) und über Felder (unser Name, lesbarer Name, Name beim Partner)", () => {
    expect(find("photovoltaik")).toBe(true); expect(find("waermepumpe")).toBe(true); expect(find("Wärmepumpe")).toBe(true); expect(find("solar privat")).toBe(true);
    expect(find("plz")).toBe(true); expect(find("postcode")).toBe(true); expect(find("zip")).toBe(true); expect(find("telefon")).toBe(false);
    expect(coopMatches(partner, "photovoltaik")).toBe(false); // ohne die Namen der Kategorien ist nur der Name beim Partner bekannt
  });
});

describe("Kooperationen: Name prüfen", () => {
  const others = [{ id: 1, partnerTenantName: "Solarnetz Bayern" }, { id: 2, partnerTenantName: "EnergieHaus Nord" }];
  it("zu kurz, zu lang, schon vergeben (auch anders geschrieben) – der eigene Eintrag zählt nicht als doppelt", () => {
    expect(coopNameIssue(" ", others)).toBe("Bitte den Namen des Partners eintragen (mindestens zwei Zeichen)."); expect(coopNameIssue("A", others)).toContain("mindestens zwei Zeichen");
    expect(coopNameIssue("x".repeat(161), others)).toBe("Der Name ist zu lang (höchstens 160 Zeichen)."); expect(coopNameIssue("x".repeat(160), others)).toBeNull();
    expect(coopNameIssue("solarnetz bayern ", others)).toBe("Einen Partner mit diesem Namen gibt es schon.");
    expect(coopNameIssue("Solarnetz Bayern", others, 1)).toBeNull(); expect(coopNameIssue("EnergieHaus Nord", others, 1)).toBe("Einen Partner mit diesem Namen gibt es schon.");
    expect(coopNameIssue("Wärme Süd GmbH", others)).toBeNull(); expect(coopNameIssue("Neu")).toBeNull();
  });
});
