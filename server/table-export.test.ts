import { describe, expect, it } from "vitest";
import { exportFileName, tableCsv, tableTsv } from "../shared/table-export";

describe("Export des Reiters „Kontakte“ (CSV und Google Sheets)", () => {
  const columns = ["Firma", "Telefon", "PLZ", "Notiz"];
  it("CSV: Semikolon, Anführungszeichen nur wo nötig, Formeln entschärft – Telefonnummern bleiben", () => {
    const csv = tableCsv(columns, [["Solar; Müller", "+49 30 1234567", "01067", "=HYPERLINK(\"x\")"], ["Brandt \"Heizung\"", "0171 2345678", "80331", "-Rabatt"]]);
    const [head, first, second] = csv.split("\r\n");
    expect(head).toBe("Firma;Telefon;PLZ;Notiz");
    expect(first).toBe("\"Solar; Müller\";+49 30 1234567;01067;\"'=HYPERLINK(\"\"x\"\")\"");
    expect(second).toBe("\"Brandt \"\"Heizung\"\"\";0171 2345678;80331;'-Rabatt");
  });
  it("Google Sheets: Tabulator, Zeilenumbrüche raus, Telefonnummer/PLZ mit 0 und Formeln als Text (Apostroph)", () => {
    const tsv = tableTsv(columns, [["Solar\tMüller", "+49 30 1234567", "01067", "Zeile 1\nZeile 2"], ["Brandt", "0171 2345678", "80331", "@mention"]]);
    const [head, first, second] = tsv.split("\n");
    expect(head).toBe("Firma\tTelefon\tPLZ\tNotiz");
    expect(first).toBe("Solar Müller\t'+49 30 1234567\t'01067\tZeile 1 Zeile 2");
    expect(second).toBe("Brandt\t'0171 2345678\t80331\t'@mention");
  });
  it("Dateiname ohne verbotene Zeichen", () => {
    expect(exportFileName("Kontakte 2026-11-03")).toBe("Kontakte 2026-11-03");
    expect(exportFileName("PV/WP: Liste*?")).toBe("PV-WP- Liste-");
    expect(exportFileName("  ")).toBe("Export");
  });
});
