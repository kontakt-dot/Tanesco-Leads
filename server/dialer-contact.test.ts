import { dialerFieldValues } from "../shared/lead-fields";
import { categoryFromFieldNames } from "../shared/dialer-contact";
import { describe, expect, it } from "vitest";
import { CONTACT_MAPPING, categoryProducts, dialerInfo, extractDialerContact, matchDialerCategory, mergeDialerData } from "../shared/dialer-contact";
import { dialerGuideText } from "../shared/dialer-guide";
import { DEFAULT_MAPPING, decideCall } from "./call-qa";

describe("Kontakt in der Meldung des Dialers", () => {
  it("liest den verschachtelten Kontakt samt weiteren Feldern, Ergebnis und Notiz", () => {
    const contact = extractDialerContact({ call_id: "x", phone: "+49 6151 5550103", result: "Termin", note: "  Dach nach Süden ", callback_at: "2026-11-21T10:00:00+01:00", contact: { id: "C-88412", first_name: "Murat", last_name: "Yilmaz", company: "", street: "Hauptstraße 12", postcode: 64283, city: "Darmstadt", country: "DE", email: "Murat@Example.de", fields: { "Dachfläche": "60 m²", "Eigentümer": true, Baujahr: 1998, leer: "", liste: ["a", "b"] }, geburtsjahr: 1975 } });
    expect(contact).toMatchObject({ externalId: "C-88412", firstName: "Murat", lastName: "Yilmaz", company: null, street: "Hauptstraße 12", postcode: "64283", city: "Darmstadt", country: "DE", email: "murat@example.de", result: "Termin", note: "Dach nach Süden", callbackAt: "2026-11-21T09:00:00.000Z", hasIdentity: true, hasData: true });
    expect(contact.fields).toEqual({ "Dachfläche": "60 m²", "Eigentümer": "ja", Baujahr: "1998", liste: "a, b", geburtsjahr: "1975" });
    expect(contact.found).toEqual(expect.arrayContaining(["contact.id", "contact.first_name", "contact.last_name", "contact.street", "contact.postcode", "contact.city", "contact.country", "contact.email", "contact.fields (5)", "result", "note", "callback_at"]));
    expect(contact.found).not.toContain("contact.company");
  });

  it("erkennt flache und deutsche Feldnamen, den ganzen Namen und die Hausnummer", () => {
    const flat = extractDialerContact({ call_id: "x", phone: "0171 1234567", vorname: "Anna", nachname: "Berg", firma: "Helios Solar", strasse: "Am Markt", hausnummer: "3a", plz: "35390", ort: "Gießen", land: "Österreich", "e-mail": "anna@helios.example", contact_id: 4711, ergebnis: "kein Interesse", kommentar: "nicht mehr anrufen" });
    expect(flat).toMatchObject({ firstName: "Anna", lastName: "Berg", company: "Helios Solar", street: "Am Markt 3a", postcode: "35390", city: "Gießen", country: "AT", email: "anna@helios.example", externalId: "4711", result: "kein Interesse", note: "nicht mehr anrufen" });
    const named = extractDialerContact({ phone: "1", kontakt: { name: "Dr. Jürgen Müller", telefon: "+49 30 1" } }); expect(named).toMatchObject({ firstName: "Dr. Jürgen", lastName: "Müller", phone: "+49 30 1", hasIdentity: true });
    expect(extractDialerContact({ customer: { name: "Müller" } })).toMatchObject({ firstName: null, lastName: "Müller" });
    expect(extractDialerContact({ contact_first_name: "Eva", contact_last_name: "Roth", customer_email: "eva@example.de" })).toMatchObject({ firstName: "Eva", lastName: "Roth", email: "eva@example.de" });
  });

  it("allgemeine Namen neben der Rufnummer zählen nicht als Kontakt – und ohne Angaben gibt es keinen", () => {
    const plain = extractDialerContact({ call_id: "c1", id: "777", name: "Kampagne Herbst", phone: "+49 30 1234567", agent: "Yilmaz", campaign: "PV", direction: "outbound", started_at: "2026-11-05T09:15:00+01:00", duration: 312, recording_url: "https://x/y.mp3", consent: true, data: { a: 1 }, lead_id: "API-1A2B3C4D" });
    expect(plain).toMatchObject({ externalId: null, firstName: null, lastName: null, phone: null, hasIdentity: false, hasData: false }); expect(plain.fields).toEqual({}); expect(plain.found).toEqual([]);
    expect(extractDialerContact(null).hasData).toBe(false); expect(extractDialerContact("text").hasData).toBe(false);
    expect(extractDialerContact({ contact: { email: "kein-at-zeichen" } })).toMatchObject({ email: null, hasData: false });
    expect(extractDialerContact({ result: "Termin" })).toMatchObject({ hasIdentity: false, hasData: true }); // nur ein Ergebnis: reicht zum Ergänzen, nicht zum Anlegen
  });

  it("eigene Zuordnung: Pfade aus den Einstellungen gehen vor", () => {
    const mapped = extractDialerContact({ kunde_daten: { vn: "Eva", nn: "Roth" }, abschluss_code: "TERMIN", meta: { felder: { Dach: "Süd" } } }, { ...CONTACT_MAPPING, firstName: "kunde_daten.vn", lastName: "kunde_daten.nn", result: "abschluss_code", contactFields: "meta.felder" });
    expect(mapped).toMatchObject({ firstName: "Eva", lastName: "Roth", result: "TERMIN" }); expect(mapped.fields).toEqual({ Dach: "Süd" });
  });

  it("zusammenführen: Vorhandenes bleibt, Ergebnis und Notiz gelten vom letzten Gespräch", () => {
    const contact = extractDialerContact({ result: "Termin", note: "neu", contact: { id: "C-1", first_name: "A", street: "Neue Str. 1", fields: { Dach: "Süd", Baujahr: "1998" } } });
    const first = mergeDialerData({ street: "Alte Str. 9", Baujahr: "", dialerResult: "Rückruf", fremd: 1 }, contact);
    expect(first.changed).toBe(true); expect(first.data).toEqual({ street: "Alte Str. 9", Baujahr: "1998", Dach: "Süd", dialerContactId: "C-1", dialerResult: "Termin", dialerNote: "neu", fremd: 1 });
    expect(mergeDialerData(first.data, contact).changed).toBe(false); // zweimal dasselbe ändert nichts
    expect(mergeDialerData(null, extractDialerContact({ phone: "1" }))).toEqual({ data: {}, changed: false });
  });

  it("Kurzfassung für die Anzeige im Gespräch", () => {
    expect(dialerInfo({ call_id: "x", phone: "1" })).toBeNull();
    expect(dialerInfo({ result: "Termin", contact: { first_name: "Murat", last_name: "Yilmaz", postcode: "64283", city: "Darmstadt", fields: { Dach: "Süd" } } })).toMatchObject({ result: "Termin", name: "Murat Yilmaz", place: "64283 Darmstadt", fields: [{ label: "Dach", value: "Süd" }] });
  });

  it("Regel auf das Ergebnis im Dialer", () => {
    const config = { autoApproveThreshold: 70, autoRejectThreshold: 30, decisionRules: [{ id: "r1", label: "Kein Interesse laut Dialer", field: "dialerResult", op: "contains", value: "kein interesse", decision: "zurueckgewiesen", active: true }] } as never;
    const evaluation = { score: 90, verdict: "verkaufbar", criteria: [], summary: "", redFlags: [], nextStep: "", extracted: {}, unscored: false } as never;
    expect(decideCall(config, evaluation, "…", { dialerResult: "Kein Interesse" })).toMatchObject({ decision: "zurueckgewiesen", rule: { id: "r1" } });
    expect(decideCall(config, evaluation, "…", { dialerResult: "Termin" })).toMatchObject({ decision: "freigegeben", rule: null });
    expect(decideCall(config, evaluation, "…")).toMatchObject({ decision: "freigegeben", rule: null }); // ohne Ergebnis greift die Regel nicht
  });

  it("die Anleitung für den Entwickler nennt die Kontakt-Felder, das Beispiel mit Kontakt und die Antwort", () => {
    const text = dialerGuideText({ webhookUrl: "https://app.example/api/partner/ondialer/geheim123", fieldMapping: DEFAULT_MAPPING, consentRequired: true, recordingAuthHeader: false });
    expect(text).toContain("## Kontakt mitschicken");
    for (const field of ["contact.id", "contact.first_name", "contact.last_name", "contact.company", "contact.street", "contact.postcode", "contact.city", "contact.country", "contact.email", "contact.fields", "result", "note", "callback_at"]) expect(text).toContain(`| \`${field}\` |`);
    expect(text).toContain("\"contact\": {\n    \"id\": \"C-88412\",\n    \"first_name\": \"Murat\""); expect(text).toContain("\"result\": \"Termin\"");
    expect(text).toContain("`\"contact\": \"created\"`"); expect(text).toContain("`would`"); expect(text).toContain("`vorname`");
    expect(text).not.toMatch(/tanesco|fluxora/i);
    // eigene Namen für die Kontakt-Felder erscheinen in Tabelle und Beispiel
    const own = dialerGuideText({ webhookUrl: "https://app.example/x", fieldMapping: { ...DEFAULT_MAPPING, firstName: "kunde.vorname", result: "abschluss" }, consentRequired: true, recordingAuthHeader: false });
    expect(own).toContain("| `kunde.vorname` | Vorname |"); expect(own).toContain("\"kunde\": {\n    \"vorname\": \"Murat\""); expect(own).toContain("\"abschluss\": \"Termin\"");
  });

  it("Leadsparte vom Dialer: „PV“, „WP“ und „PV+WP“ führen zur passenden Kategorie – genauer Name oder Kürzel gehen vor", () => {
    const categories = [{ id: 1, name: "Photovoltaik", shortcode: "PV" }, { id: 2, name: "Wärmepumpe", shortcode: "WP" }, { id: 3, name: "Photovoltaik & Wärmepumpe", shortcode: "PVWP" }, { id: 4, name: "Fenster", shortcode: "FEN" }];
    const id = (value: string | null) => matchDialerCategory(categories, value)?.id ?? null;
    for (const value of ["PV", "pv", " Pv ", "Photovoltaik", "photovoltaik", "Solar", "Solaranlage", "PV-Anlage"]) expect(id(value), value).toBe(1);
    for (const value of ["WP", "wp", "Wärmepumpe", "waermepumpe", "Wärmepumpen", "Heat Pump"]) expect(id(value), value).toBe(2);
    for (const value of ["PV+WP", "PV + WP", "PV/WP", "pv und wp", "PV & WP", "WP+PV", "PVWP", "Photovoltaik & Wärmepumpe", "Photovoltaik und Wärmepumpe", "beides", "both"]) expect(id(value), value).toBe(3);
    expect(id("Fenster")).toBe(4); expect(id("fen")).toBe(4); // jede andere Kategorie über Namen oder Kürzel
    for (const value of ["", "  ", null, "Dach", "Heizung", "Sonstiges"]) expect(id(value), String(value)).toBeNull(); // nichts erkannt: die Software erkennt die Kategorie aus dem Gespräch
    // ohne die Kategorie für beides gibt es für „PV+WP“ keinen eindeutigen Treffer; zwei Photovoltaik-Kategorien sind ebenfalls nicht eindeutig
    expect(matchDialerCategory(categories.slice(0, 2), "PV+WP")).toBeNull();
    expect(matchDialerCategory([...categories, { id: 5, name: "Photovoltaik Gewerbe", shortcode: "PVG" }], "Solar")).toBeNull(); expect(matchDialerCategory([...categories, { id: 5, name: "Photovoltaik Gewerbe", shortcode: "PVG" }], "PV")?.id).toBe(1); // das Kürzel passt genau
    expect(categoryProducts("PV+WP")).toEqual({ pv: true, wp: true }); expect(categoryProducts("Wärmepumpe")).toEqual({ pv: false, wp: true }); expect(categoryProducts("Fenster")).toEqual({ pv: false, wp: false }); expect(categoryProducts(null)).toEqual({ pv: false, wp: false });
  });

  it("liest die Leadsparte aus der Meldung: oben, im Kontakt, mit deutschem Namen oder über die eingestellte Zuordnung", () => {
    expect(extractDialerContact({ call_id: "x", phone: "+49 30 1", category: "PV" })).toMatchObject({ category: "PV", hasData: true, hasIdentity: false });
    expect(extractDialerContact({ call_id: "x", phone: "+49 30 1", category: "PV" }).found).toContain("category");
    expect(extractDialerContact({ phone: "+49 30 1", contact: { first_name: "Murat", category: "WP" } }).category).toBe("WP");
    expect(extractDialerContact({ phone: "+49 30 1", sparte: "PV+WP" }).category).toBe("PV+WP"); expect(extractDialerContact({ phone: "+49 30 1", kategorie: "Wärmepumpe" }).category).toBe("Wärmepumpe");
    expect(extractDialerContact({ phone: "+49 30 1", produkt: { name: "PV" } }, { category: "produkt.name" }).category).toBe("PV"); // eigener Feldname
    expect(extractDialerContact({ phone: "+49 30 1" }).category).toBeNull();
    expect(CONTACT_MAPPING.category).toBe("category"); expect(DEFAULT_MAPPING.category).toBe("category");
    expect(dialerInfo({ phone: "+49 30 1", category: "PV", contact: { first_name: "Murat" } })?.category).toBe("PV");
  });
});

import { cleanSpokenContact, contactFromTranscript, contactParts, EMPTY_INTAKE, intakeVerdict, payloadFieldNames, withSpokenContact } from "../shared/dialer-intake";
describe("Eingang vom Dialer: Kontakt aus dem Gespräch und Urteil", () => {
  it("erkennt türkische Feldnamen", () => {
    expect(extractDialerContact({ phone: "1", musteri: { ad: "Murat", soyad: "Yilmaz", "şehir": "Köln", "posta kodu": "50667", eposta: "m@example.de" } })).toMatchObject({ firstName: "Murat", lastName: "Yilmaz", city: "Köln", postcode: "50667", email: "m@example.de", hasIdentity: true });
    expect(extractDialerContact({ phone: "1", musteri_adi: "Deniz Kaya" })).toMatchObject({ hasIdentity: true });
    expect(extractDialerContact({ phone: "1", ad: "Kampagne" }).hasIdentity).toBe(false);
  });
  it("liest Name und Ort aus der Abschrift und ergänzt nur, was der Dialer nicht nennt", () => {
    const spoken = contactFromTranscript("Guten Tag Herr Wegner, hier ist Deniz Kaya. Sie wohnen in 50259 Pulheim, richtig? Ja. Danke Herr Wegner.");
    expect(spoken).toMatchObject({ lastName: "Wegner", postcode: "50259", city: "Pulheim" });
    const empty = extractDialerContact({ phone: "1" }); expect(withSpokenContact(empty, spoken)).toMatchObject({ lastName: "Wegner", city: "Pulheim", hasIdentity: true });
    expect(withSpokenContact(extractDialerContact({ contact: { last_name: "Berg" } }), spoken)).toMatchObject({ lastName: "Berg", city: "Pulheim" });
    expect(cleanSpokenContact({ firstName: " unbekannt ", lastName: "Roth", postcode: "5025", email: "x" })).toMatchObject({ firstName: null, lastName: "Roth", postcode: "5025", email: null });
    expect(contactFromTranscript(null)).toMatchObject({ lastName: null });
  });
  it("nennt die Felder ohne Werte und sagt in einem Satz, wo es hängt", () => {
    expect(payloadFieldNames({ call_id: "x", contact: { first_name: "A", fields: { Dach: "1" } } })).toEqual(["call_id", "contact.first_name", "contact.fields.Dach"]);
    expect(contactParts({ phone: "1" })).toMatchObject({ name: false, address: false }); expect(contactParts({ contact: { last_name: "B", city: "Ulm" } })).toMatchObject({ name: true, address: true });
    const day = { ...EMPTY_INTAKE, received: 25, approved: 18, leads: 0, approvedNoLead: 18, review: 1, rejected: 6 };
    expect(intakeVerdict({ enabled: true, today: day, week: day, lastAt: new Date() })).toMatchObject({ tone: "warn" }); expect(intakeVerdict({ enabled: true, today: day, week: day, lastAt: new Date() }).title).toContain("18 grüne Gespräche");
    expect(intakeVerdict({ enabled: false, today: day, week: day, lastAt: null }).tone).toBe("bad"); expect(intakeVerdict({ enabled: true, today: EMPTY_INTAKE, week: EMPTY_INTAKE, lastAt: null }).tone).toBe("idle");
    expect(intakeVerdict({ enabled: true, today: { ...day, leads: 18, approvedNoLead: 0, review: 0 }, week: day, lastAt: new Date() })).toMatchObject({ tone: "ok" });
  });
});

describe("Felder des Dialers mit Vorsilbe (pv_…, wp_…)", () => {
  const defs = [
    { fieldKey: "dachart", label: "Dachart", fieldType: "auswahl", options: ["Satteldach", "Flachdach", "Pultdach"] },
    { fieldKey: "dachflaeche", label: "Dachfläche (m²)", fieldType: "zahl" },
    { fieldKey: "stromverbrauch", label: "Stromverbrauch", fieldType: "zahl" },
    { fieldKey: "eigentuemer", label: "Eigentümer", fieldType: "ja_nein" },
    { fieldKey: "gebaeudetyp", label: "Gebäudetyp", fieldType: "text" },
    { fieldKey: "umsetzung", label: "Umsetzung", fieldType: "auswahl", options: ["sofort", "in 3 Monaten", "später"] },
  ];
  it("ordnet „pv_dachart“, „pv_dachflaeche“ usw. den Feldern der Kategorie zu und prüft die Antworten", () => {
    const meta = { pv_dachart: "satteldach", pv_dachflaeche: "60 m²", pv_stromverbrauch: "4.500 kWh", pv_umsetzung: "irgendwann mal", wp_ist_eigentuemer: "ja", pv_info: "Dach nach Süden" };
    expect(dialerFieldValues(defs, meta, "Photovoltaik")).toEqual({ dachart: "Satteldach", dachflaeche: "60", stromverbrauch: "4500" }); // „irgendwann mal“ passt zu keiner Auswahl → bleibt als eigene Angabe
  });
  it("füllt nur leere Felder; steht ein Feld mit pv_ und wp_ da, gilt das der eigenen Leadsparte", () => {
    expect(dialerFieldValues(defs, { dachart: "Flachdach", pv_dachart: "Satteldach" }, "Photovoltaik")).toEqual({});
    expect(dialerFieldValues(defs, { pv_gebaeudetyp: "Einfamilienhaus", wp_gebaeudetyp: "Doppelhaushälfte" }, "Photovoltaik")).toEqual({ gebaeudetyp: "Einfamilienhaus" });
    expect(dialerFieldValues(defs, { pv_gebaeudetyp: "Einfamilienhaus", wp_gebaeudetyp: "Doppelhaushälfte" }, "Wärmepumpe")).toEqual({ gebaeudetyp: "Doppelhaushälfte" });
  });
  it("Leadsparte aus den Feldnamen; Aufnahme-Links werden nie als Feld gespeichert", () => {
    expect(categoryFromFieldNames({ pv_dachart: "Satteldach", pv_hausart: "EFH", wp_info: "" })).toBe("PV");
    expect(categoryFromFieldNames({ wp_beheizte_flaeche: "140", wp_gebaeudetyp: "EFH" })).toBe("WP");
    expect(categoryFromFieldNames({ pv_dachart: "a", pv_hausart: "b", pv_dachalter: "c", wp_beheizte_flaeche: "d", wp_gebaeudetyp: "e", wp_ist_eigentuemer: "f" })).toBe("PV+WP");
    expect(categoryFromFieldNames({ dachart: "Satteldach" })).toBeNull();
    const contact = extractDialerContact({ call_id: "1", phone: "+49 30 1", contact: { first_name: "Laura", fields: { pv_dachart: "Satteldach", pv_hausart: "EFH", pv_recording_1: "https://aufnahmen.example/1.mp3", wp_record_file: "https://aufnahmen.example/2.mp3" } } });
    expect(contact.fields).toEqual({ pv_dachart: "Satteldach", pv_hausart: "EFH" }); expect(contact.recordingUrl).toBe("https://aufnahmen.example/1.mp3"); expect(contact.category).toBe("PV"); expect(contact.found).toContain("category (aus den Feldnamen)");
    expect(extractDialerContact({ phone: "1", category: "WP", fields: { pv_dachart: "x" } }).category).toBe("WP"); // eine genannte Leadsparte gilt
  });
});
