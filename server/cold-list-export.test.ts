import { describe, expect, it } from "vitest";
import { coldListCsv, parseColdList } from "../shared/cold-list";

describe("Liste herunterladen (für „Liste aktualisieren“)", () => {
  const rows = [
    { firstName: "Anna", lastName: "Kraft", company: "Kraft Wärmepumpen GmbH", phone: "+49 170 1234567", email: "anna@kraft-wp.de", postcode: "34117", city: "Kassel", metadata: { salutation: "frau", felder: { branche: "Wärmepumpen", anzahl_bewertungen: "128" } } },
    { firstName: null, lastName: "Solar; Dach & Co", company: "Solar; Dach & Co", phone: null, email: "info@solar-dach.de", postcode: null, city: "Ulm", metadata: { felder: { webseite: "solar-dach.de" } } },
    { firstName: "Max", lastName: "Test", company: "=HYPERLINK(\"x\")", phone: "0561 99887", email: "max@test-wp.de", postcode: "34119", city: "Kassel", metadata: null },
  ];
  it("schreibt die Spalten, die das Hochladen wieder erkennt – plus Zusatzspalten; Formeln werden entschärft", () => {
    const csv = coldListCsv(rows); const [head, ...lines] = csv.split("\r\n");
    expect(head).toBe("Anrede;Vorname;Nachname;Firma;Telefon;E-Mail;PLZ;Ort;Branche;Anzahl bewertungen;Webseite"); // lesbare Spaltennamen
    expect(lines[0]).toBe("Frau;Anna;Kraft;Kraft Wärmepumpen GmbH;+49 170 1234567;anna@kraft-wp.de;34117;Kassel;Wärmepumpen;128;"); // Telefon mit + bleibt
    expect(lines[1]).toBe(';;;"Solar; Dach & Co";;info@solar-dach.de;;Ulm;;;solar-dach.de'); // Firma ohne Ansprechpartner: kein doppelter Nachname
    expect(lines[2]).toContain(";\"'=HYPERLINK('x')\";"); // keine Formel in Excel
  });
  it("lässt sich unverändert wieder einlesen – gleiche Kontakte, gleiche Zusatzspalten", () => {
    const parsed = parseColdList(coldListCsv(rows), null);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]).toMatchObject({ firstName: "Anna", lastName: "Kraft", company: "Kraft Wärmepumpen GmbH", phone: "+49 170 1234567", email: "anna@kraft-wp.de", postcode: "34117", city: "Kassel" });
    expect(parsed.rows[0].extra).toEqual({ branche: "Wärmepumpen", anzahl_bewertungen: "128" }); // dieselben Platzhalter wie vorher
    expect(parsed.rows[1]).toMatchObject({ company: "Solar; Dach & Co", email: "info@solar-dach.de", city: "Ulm" }); expect(parsed.rows[1].extra).toEqual({ webseite: "solar-dach.de" });
  });
});
