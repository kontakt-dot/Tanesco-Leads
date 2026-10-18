import { describe, expect, it } from "vitest";
import { parseColdList, sanitizeColdRow } from "../shared/cold-list";
import { workbookToCsv } from "../client/src/lib/list-file";

describe("Kaltakquise-Liste: Zellen mit mehreren Nummern/Adressen, alle Tabellenblätter", () => {
  it("nimmt die erste Telefonnummer und E-Mail, behält das Original als Zusatzfeld und scheitert nie an zu langen Zellen", () => {
    const row = sanitizeColdRow({ company: "Taptap Home", phone: "040 209316970 (Geschäftskunden); 040 60946842 (Endkunden)", email: "account@taptaphome.com (Geschäftskunden); anfrage@taptaphome.com", notes: "x".repeat(1500) });
    expect(row).toMatchObject({ phone: "040 209316970", email: "account@taptaphome.com" });
    expect(row.extra).toEqual({ "Telefon (Original)": "040 209316970 (Geschäftskunden); 040 60946842 (Endkunden)", "E-Mail (Original)": "account@taptaphome.com (Geschäftskunden); anfrage@taptaphome.com" });
    expect(row.notes).toHaveLength(1000);
    expect(sanitizeColdRow({ company: "Priwatt", phone: "(derzeit keine Hotline)" }).phone).toBeUndefined();
    expect(sanitizeColdRow({ company: "ENWEA", email: "(nur Kontaktformular)", phone: "0228 377368-0" })).toMatchObject({ phone: "0228 377368-0", extra: { "E-Mail (Original)": "(nur Kontaktformular)" } });
    expect(sanitizeColdRow({ company: "A", phone: "+49 5204 874990", email: "Info@Firma.de" })).toEqual({ company: "A", phone: "+49 5204 874990", email: "info@firma.de" });
  });
  it("liest alle Blätter einer Excel-Datei, legt gleiche Spalten zusammen und erkennt „Firmen“ als Firma", () => {
    const csv = workbookToCsv([
      [["Firmen", "Telefon", "Notizen"], ["Musterhaus", "040 554471500", "Zeile 1\nZeile 2"], ["", "", ""]],
      [["Firmen", "Kontakt", "Telefon"], ["Sonnenmacher", "info@sonnenmacher.de", "089 23751723"]],
    ]);
    expect(csv.split("\n")[0]).toBe("Firmen;Telefon;Notizen;Kontakt");
    const parsed = parseColdList(csv);
    expect(parsed.rows.map((row) => [row.company, row.phone, row.notes ?? null])).toEqual([["Musterhaus", "040 554471500", "Zeile 1 Zeile 2"], ["Sonnenmacher", "089 23751723", null]]);
  });
});
