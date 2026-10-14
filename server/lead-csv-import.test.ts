import { describe, expect, it } from "vitest";
import { parseLeadCsv } from "../client/src/lib/leadCsvImport";

describe("Lead-CSV-Import", () => {
  it("verarbeitet Anführungszeichen, Standardspalten und zusätzliche Fachfelder", () => {
    const result = parseLeadCsv('Vorname;Nachname;E-Mail;Ort;dachausrichtung\n"Anna";"Muster";anna@example.de;"Köln, Innenstadt";Süd');
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([expect.objectContaining({ rowNumber: 2, firstName: "Anna", lastName: "Muster", city: "Köln, Innenstadt", metadata: { dachausrichtung: "Süd" } })]);
  });

  it("liefert präzise Zeilenfehler und importiert valide Zeilen weiter", () => {
    const result = parseLeadCsv("Vorname;E-Mail\n;ohne@example.de\nMira;ungueltig\nLeon;leon@example.de");
    expect(result.errors).toEqual(["Zeile 2: Vorname oder Nachname fehlt.", "Zeile 3: E-Mail-Adresse ist ungültig."]);
    expect(result.rows).toHaveLength(1);
  });

  it("behält ursprüngliche Werte fehlerhafter Zeilen für Vorschau und Korrekturexport bei", () => {
    const result = parseLeadCsv("Vorname;Nachname;E-Mail;Telefon\n;;ungueltig;0999");
    expect(result.errorRows).toEqual([{ rowNumber: 2, reason: "Vorname oder Nachname fehlt.", values: { vorname: "", nachname: "", "e-mail": "ungueltig", telefon: "0999" } }]);
  });
});
