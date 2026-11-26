import { describe, expect, it } from "vitest";
import { createParameterPdf, sampleValue } from "../client/src/lib/parameterPdf";

const types: Record<string, string> = { text: "Freitext", zahl: "Zahl", auswahl: "Vorgefertigte Antworten", ja_nein: "Ja / Nein", datum: "Datum", notiz: "Notiz" };
const field = (label: string, fieldKey: string, fieldType: string, options: unknown = null, required = false) => ({ label, fieldKey, fieldType, options, required });
const textOf = (pdf: { output: (kind: "arraybuffer") => ArrayBuffer }) => Buffer.from(pdf.output("arraybuffer")).toString("latin1");

describe("Parameterblatt als PDF (v374)", () => {
  it("Beispielwerte folgen der Antwortart, feste Antworten gehen vor", () => {
    expect(sampleValue(field("A", "a", "auswahl", ["Eigentümer", "Mieter"]))).toBe("Eigentümer");
    expect(sampleValue(field("B", "b", "zahl"))).toBe(120); expect(sampleValue(field("C", "c", "ja_nein"))).toBe("Ja");
    expect(sampleValue(field("D", "d", "datum"))).toBe("2026-12-01"); expect(sampleValue(field("E", "e", "text"))).toBe("Text");
  });
  it("eine Seite für wenige Felder – mit Kopf, Kennzahlen, Tabelle, Beispiel und Seitenzahl", () => {
    const pdf = createParameterPdf({ name: "Photovoltaik", shortcode: "pv", color: "#f59e0b", fields: [field("Eigentum", "eigentum", "auswahl", ["Eigentümer", "Mieter"], true), field("Stromverbrauch", "stromverbrauch_kwh", "zahl")], labelForFieldType: (type) => types[type] ?? type, date: new Date("2026-11-26T12:00:00Z") });
    expect(pdf.getNumberOfPages()).toBe(1); const text = textOf(pdf);
    for (const part of ["PARAMETERBLATT", "Photovoltaik", "(PV)", "Felder der Kategorie", "TECHNISCHER PARAMETER", "stromverbrauch_kwh", "Pflicht", "optional", "Seite 1 von 1", "Stand 26.11.2026"]) expect(text).toContain(part);
    expect(text).not.toContain("(Datenharmonisierung) Tj"); // ohne Zuordnungen kein eigener Abschnitt
  });
  it("viele Felder brechen um: Tabellenkopf auf jeder Seite, Zuordnungen und Beispiel folgen, jede Seite ist nummeriert", () => {
    const fields = Array.from({ length: 40 }, (_, index) => field(`Feld ${index + 1}`, `feld_${index + 1}`, index % 2 ? "text" : "auswahl", index % 2 ? null : ["Antwort A", "Antwort B", "Antwort C"], index % 5 === 0));
    const pdf = createParameterPdf({ name: "Wärmepumpe", shortcode: "WP", color: null, fields, mappings: [{ sourceField: "annual_usage", targetFieldKey: "feld_2", mode: "uebernehmen" }], labelForFieldType: (type) => types[type] ?? type });
    const pages = pdf.getNumberOfPages(); expect(pages).toBeGreaterThan(2); const text = textOf(pdf);
    expect(text.split("TECHNISCHER PARAMETER").length - 1).toBeGreaterThanOrEqual(2); expect(text).toContain("annual_usage"); expect(text).toContain("feld_40");
    for (let page = 1; page <= pages; page += 1) expect(text).toContain(`Seite ${page} von ${pages}`);
  });
  it("leere Kategorie: Hinweis statt Tabelle, kein Beispiel", () => {
    const text = textOf(createParameterPdf({ name: "Neu", shortcode: "NEU", fields: [], labelForFieldType: (type) => type }));
    expect(text).toContain("noch keine eigenen Felder"); expect(text).not.toContain("TECHNISCHER PARAMETER"); expect(text).not.toContain("Beispiel f");
  });
});
