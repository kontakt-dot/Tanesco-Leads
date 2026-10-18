import { describe, expect, it } from "vitest";
import { buildTerritoryDrafts, fixExcelPlz, splitCategoryCell, describePlan, detectHeaderRow, detectTerritoryLayout, matchCategory, parseTerritoryPlan, territoryPlanPrompt, trimTable } from "../shared/territory-import";
import { analyzeTerritoryFile } from "./territories";

const categories = [{ id: 1, name: "Photovoltaik" }, { id: 2, name: "Wärmepumpe" }, { id: 3, name: "Fenster & Türen" }];
const zeilen = [
  ["Kunde", "Kategorie", "PLZ", "Ort", "Umkreis km", "Bemerkung"],
  ["Nordlicht Solar GmbH", "PV", "20095", "Hamburg", "", "Bestandskunde"],
  ["", "", "20097", "", "", ""],
  ["Aurora Energie", "Wärmepumpen", "", "Frankfurt am Main", "25", ""],
  ["Aurora Energie", "Wärmepumpen", "61118", "", "", "Zusatzgebiet"],
  ["Helios Dach", "Dach", "63065", "Offenbach", "", ""],
];
const spalten = [["Nordlicht", "Aurora", "Helios"], ["20095", "60311", "63065"], ["20097", "60313", "63067"], ["", "61118", ""]];
const einKunde = [["60311"], ["60313"], ["61 (ganz)"], ["63000-63099"]];

describe("KI-Erkennung für Gebietslisten: Regeln", () => {
  it("erkennt Kopfzeile, Spaltenrollen und das Zeilen-Layout – leere Kundenzellen gehören zum Kunden darüber", () => {
    expect(detectHeaderRow(zeilen)).toBe(0);
    const plan = detectTerritoryLayout(zeilen, categories);
    expect(plan.layout).toBe("zeilen"); expect(plan.headerRow).toBe(0);
    expect(plan.columns.map((column) => column.role)).toEqual(["kunde", "kategorie", "plz", "ort", "umkreis", "notiz"]);
    const drafts = buildTerritoryDrafts(zeilen, plan, { categories });
    expect(drafts.map((draft) => draft.customerName)).toEqual(["Nordlicht Solar GmbH", "Aurora Energie", "Helios Dach"]);
    expect(drafts[0]).toMatchObject({ categoryId: 1, categoryName: "Photovoltaik", lines: ["20095", "Hamburg", "20097"], rowCount: 2, warnings: [] }); // PV → Photovoltaik, zweite Zeile ohne Namen zählt mit
    expect(drafts[1]).toMatchObject({ categoryId: 2, categoryName: "Wärmepumpe", lines: ["Frankfurt am Main 25 km Umkreis", "61118"] }); // Umkreis-Spalte wird zur Umkreis-Zeile
    expect(drafts[2].categoryId).toBeNull(); expect(drafts[2].categoryName).toBe("Dach"); expect(drafts[2].warnings[0]).toContain("Kategorie „Dach“ gibt es noch nicht");
    expect(describePlan(plan, zeilen)).toContain("Jede Zeile gehört zu dem Kunden in der Kunden-Spalte."); expect(describePlan(plan, zeilen)).toContain("PLZ: „PLZ“ (C)");
  });
  it("erkennt Kunden als Spaltenköpfe und Listen für einen einzigen Kunden (Name aus dem Dateinamen)", () => {
    const plan = detectTerritoryLayout(spalten, categories); expect(plan.layout).toBe("kunden-als-spalten"); expect(plan.headerRow).toBe(0);
    const drafts = buildTerritoryDrafts(spalten, plan, { categories });
    expect(drafts.map((draft) => [draft.customerName, draft.lines])).toEqual([["Nordlicht", ["20095", "20097"]], ["Aurora", ["60311", "60313", "61118"]], ["Helios", ["63065", "63067"]]]);
    const single = detectTerritoryLayout(einKunde, categories); expect(single.layout).toBe("ein-kunde"); expect(single.headerRow).toBeNull(); expect(single.columns[0].role).toBe("plz");
    const draft = buildTerritoryDrafts(einKunde, single, { categories, fileName: "Muster_GmbH-Gebiete.xlsx" })[0];
    expect(draft.customerName).toBe("Muster GmbH Gebiete"); expect(draft.lines).toEqual(["60311", "60313", "61 (ganz)", "63000-63099"]);
    expect(buildTerritoryDrafts([["Ort", "km"], ["München", "100"]], detectTerritoryLayout([["Ort", "km"], ["München", "100"]]), { fileName: "Süd.csv" })[0].lines).toEqual(["München 100 km Umkreis"]);
    expect(buildTerritoryDrafts([["x"]], { layout: "ein-kunde", headerRow: null, columns: [{ index: 0, role: "plz" }] })[0].warnings).toEqual(["Keine PLZ, Orte oder Umkreise gefunden."]);
  });
  it("ordnet Kategorien weich zu, prüft die KI-Antwort und dampft große Tabellen ein", () => {
    expect(matchCategory("photovoltaik", categories)?.id).toBe(1); expect(matchCategory("PV", categories)?.id).toBe(1); expect(matchCategory("WP", categories)?.id).toBe(2); expect(matchCategory("Fenster", categories)?.id).toBe(3); expect(matchCategory("Treppenlift", categories)).toBeNull(); expect(matchCategory("", categories)).toBeNull();
    expect(parseTerritoryPlan("kein json", 3)).toBeNull(); expect(parseTerritoryPlan("{\"layout\":\"zeilen\",\"headerRow\":0,\"columns\":[]}", 3)).toBeNull();
    const parsed = parseTerritoryPlan("Ergebnis: {\"layout\":\"zeilen\",\"headerRow\":0,\"columns\":[{\"index\":0,\"role\":\"kunde\"},{\"index\":7,\"role\":\"plz\"},{\"index\":2,\"role\":\"unsinn\"},{\"index\":1,\"role\":\"plz\"}],\"singleCustomerName\":null}", 3);
    expect(parsed).toEqual({ layout: "zeilen", headerRow: 0, columns: [{ index: 0, role: "kunde" }, { index: 1, role: "plz" }], singleCustomerName: null, notes: null }); // Spalte 7 gibt es nicht, Rolle „unsinn“ fliegt raus
    const big = trimTable(Array.from({ length: 900 }, () => Array.from({ length: 50 }, () => "x".repeat(200))));
    expect(big).toHaveLength(400); expect(big[0]).toHaveLength(30); expect(big[0][0]).toHaveLength(80);
    const prompt = territoryPlanPrompt(zeilen, "gebiete.xlsx", categories); expect(prompt).toContain("Photovoltaik, Wärmepumpe, Fenster & Türen"); expect(prompt).toContain("0: Kunde | Kategorie | PLZ"); expect(prompt).toContain("gebiete.xlsx");
  });
});

describe("Excel-PLZ ohne führende Null", () => {
  it("macht aus 1067 / 1067.0 wieder 01067 – in PLZ-Spalten, Kunden-Spalten und Ein-Kunde-Listen", () => {
    expect(fixExcelPlz("1067")).toBe("01067"); expect(fixExcelPlz("1067.0")).toBe("01067"); expect(fixExcelPlz("60311")).toBe("60311"); expect(fixExcelPlz("60")).toBe("60"); expect(fixExcelPlz("Hamburg")).toBe("Hamburg");
    const rows = [["Kunde", "PLZ"], ["Ost GmbH", "1067"], ["Ost GmbH", "4109.0"]];
    expect(buildTerritoryDrafts(rows, detectTerritoryLayout(rows))[0].lines).toEqual(["01067", "04109"]);
    expect(buildTerritoryDrafts([["Ost"], ["1067"]], { layout: "kunden-als-spalten", headerRow: 0, columns: [{ index: 0, role: "plz" }] })[0].lines).toEqual(["01067"]);
    expect(buildTerritoryDrafts([["1067"], ["60311"]], { layout: "ein-kunde", headerRow: null, columns: [{ index: 0, role: "plz" }] }, { fileName: "x.xlsx" })[0].lines).toEqual(["01067", "60311"]);
  });
});

describe("Echte Kundendateien: alle Zeilen, Sparte je Zeile, PLZ als Umkreis-Mitte", () => {
  it("liest 1.653 Zeilen vollständig (nicht nur die ersten 400) und teilt „PV + WP“ / „Nicht angegeben“ richtig auf", () => {
    const musterhaus = [["PLZ"], ...Array.from({ length: 1653 }, (_, index) => [String(10000 + index)])];
    const plan = detectTerritoryLayout(musterhaus.slice(0, 61)); // die KI sieht nur eine Stichprobe …
    expect(buildTerritoryDrafts(musterhaus, plan)[0].lines).toHaveLength(1653); // … die Gebiete entstehen aus allen Zeilen
    expect(splitCategoryCell("PV + WP")).toEqual(["PV", "WP"]); expect(splitCategoryCell("Nicht angegeben")).toEqual([null]); expect(splitCategoryCell("")).toEqual([null]); expect(splitCategoryCell("WP")).toEqual(["WP"]);
    const younes = [["PLZ", "Umkreis (km)", "Sparte"], ["55128", "30", "PV"], ["28325", "100", "WP"], ["14532", "15", "PV + WP"], ["45133", "35", "Nicht angegeben"]];
    const drafts = buildTerritoryDrafts(younes, detectTerritoryLayout(younes, categories), { categories, fileName: "Younes.xlsx" });
    expect(drafts.map((draft) => [draft.categoryName, draft.lines])).toEqual([["Photovoltaik", ["55128 30 km Umkreis", "14532 15 km Umkreis"]], ["Wärmepumpe", ["28325 100 km Umkreis", "14532 15 km Umkreis"]], [null, ["45133 35 km Umkreis"]]]);
    const nox = [["PLZ", "Ort", "Umkreis (km)"], ["67434", "Neustadt an der Weinstraße", "30"]];
    expect(buildTerritoryDrafts(nox, detectTerritoryLayout(nox))[0].lines).toEqual(["67434 30 km Umkreis"]); // PLZ ist der Mittelpunkt, der Ortsname wird nicht zusätzlich gesucht
  });
});

describe("KI-Erkennung für Gebietslisten: Server mit und ohne KI", () => {
  const db = { select: () => ({ from: () => ({ where: async () => categories }) }) } as never;
  it("nutzt die KI-Struktur, wenn sie brauchbar ist, und sagt die Quelle", async () => {
    const llm = async () => ({ choices: [{ message: { content: JSON.stringify({ layout: "zeilen", headerRow: 0, columns: [{ index: 0, role: "kunde" }, { index: 1, role: "kategorie" }, { index: 2, role: "plz" }, { index: 3, role: "ort" }, { index: 4, role: "umkreis" }, { index: 5, role: "ignorieren" }], singleCustomerName: null, notes: "Kopfzeile in Zeile 0" }) } }] });
    const result = await analyzeTerritoryFile(db, 1, { fileName: "gebiete.xlsx", rows: zeilen }, { llm: llm as never, apiKey: "test" });
    expect(result.source).toBe("ki"); expect(result.aiError).toBeNull(); expect(result.plan.notes).toBe("Kopfzeile in Zeile 0"); expect(result.drafts).toHaveLength(3); expect(result.drafts[1].lines).toEqual(["Frankfurt am Main 25 km Umkreis", "61118"]);
  });
  it("fällt auf die Regeln zurück: ohne Schlüssel, bei Fehlern, bei Zeitüberschreitung und wenn die KI-Struktur keine PLZ ergibt", async () => {
    const ohne = await analyzeTerritoryFile(db, 1, { rows: zeilen }, { apiKey: null }); expect(ohne.source).toBe("regeln"); expect(ohne.aiError).toContain("ANTHROPIC_API_KEY fehlt"); expect(ohne.drafts).toHaveLength(3);
    const kaputt = await analyzeTerritoryFile(db, 1, { rows: zeilen }, { llm: (async () => { throw new Error("HTTP 500"); }) as never, apiKey: "test" }); expect(kaputt.source).toBe("regeln"); expect(kaputt.aiError).toContain("HTTP 500");
    const unsinn = await analyzeTerritoryFile(db, 1, { rows: zeilen }, { llm: (async () => ({ choices: [{ message: { content: "{\"layout\":\"zeilen\",\"headerRow\":0,\"columns\":[{\"index\":5,\"role\":\"kunde\"},{\"index\":1,\"role\":\"notiz\"}]}" } }] })) as never, apiKey: "test" });
    expect(unsinn.source).toBe("regeln"); expect(unsinn.aiError).toContain("ergab keine PLZ"); expect(unsinn.drafts.map((draft) => draft.customerName)).toEqual(["Nordlicht Solar GmbH", "Aurora Energie", "Helios Dach"]);
    await expect(analyzeTerritoryFile(db, 1, { rows: [["", ""], [""]] }, { apiKey: null })).rejects.toThrow("Die Datei ist leer");
  });
});
