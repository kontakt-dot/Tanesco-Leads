import { describe, expect, it } from "vitest";
import { normalizePostcode } from "../shared/postcode";
import { extractDialerContact } from "../shared/dialer-contact";
import { cleanSpokenContact, withSpokenContact } from "../shared/dialer-intake";
import { leadDataProblems, postcodeSuggestion } from "../shared/api-errors";
import { leadTemplateValues } from "./outbound-templates";

/**
 * Version 363 – PLZ mit führender Null: Der Dialer schickte „9633“ statt „09633“ (er speichert die PLZ als Zahl, Excel-Listen verlieren die Null ebenso).
 * In Deutschland hat jede PLZ 5 Ziffern – eine 4-stellige bekommt ihre Null zurück. Österreich und die Schweiz bleiben 4-stellig.
 */
describe("PLZ mit führender Null (v363)", () => {
  it("normalizePostcode: 4 Ziffern in Deutschland → führende Null; „D-“ und Leerzeichen fallen weg; AT/CH unverändert", () => {
    expect(normalizePostcode("1067")).toBe("01067"); expect(normalizePostcode(1067)).toBe("01067"); expect(normalizePostcode("4109", "DE")).toBe("04109"); expect(normalizePostcode(" 4109 ", "de")).toBe("04109");
    expect(normalizePostcode("01067")).toBe("01067"); expect(normalizePostcode("D-01067")).toBe("01067"); expect(normalizePostcode("01 067")).toBe("01067"); expect(normalizePostcode("DE-1067")).toBe("01067");
    expect(normalizePostcode("1010", "AT")).toBe("1010"); expect(normalizePostcode("8001", "CH")).toBe("8001");
    expect(normalizePostcode("123")).toBe("123"); expect(normalizePostcode("123456")).toBe("123456"); expect(normalizePostcode("abc")).toBe("abc"); // nicht eindeutig zu richten → bleibt (die Prüfung meldet es)
    expect(normalizePostcode("")).toBeNull(); expect(normalizePostcode("  ")).toBeNull(); expect(normalizePostcode(null)).toBeNull(); expect(normalizePostcode(undefined)).toBeNull();
  });

  it("Dialer: PLZ als Zahl oder ohne Null kommt mit Null an – nur in Deutschland", () => {
    expect(extractDialerContact({ phone: "+49 351 0000001", contact: { first_name: "Test", last_name: "Kunde", postcode: 1067, city: "Dresden" } }).postcode).toBe("01067");
    expect(extractDialerContact({ phone: "+49 341 0000002", plz: "4109", ort: "Leipzig", vorname: "Test", nachname: "Kundin" }).postcode).toBe("04109");
    expect(extractDialerContact({ phone: "+43 1 0000003", plz: "1010", ort: "Wien", land: "Österreich", vorname: "Test", nachname: "Wien" }).postcode).toBe("1010");
    // aus dem Gespräch (KI), wenn der Dialer keine PLZ hat: die Null kommt beim Zusammenführen zurück
    const spoken = cleanSpokenContact({ firstName: "Test", lastName: "Kunde", postcode: 1067, city: "Dresden" }); expect(spoken.postcode).toBe("1067");
    const contact = extractDialerContact({ phone: "+49 351 0000004" });
    expect(withSpokenContact(contact, spoken).postcode).toBe("01067");
  });

  it("API-Fehler: Vorschlag mit Null; Auslieferung: postal_code immer mit 5 Ziffern (auch für ältere Leads)", () => {
    expect(postcodeSuggestion("9633", "DE")).toBe("09633"); expect(postcodeSuggestion("123", "DE")).toBeNull(); expect(postcodeSuggestion("1010", "AT")).toBeNull();
    expect(leadDataProblems({ firstName: "Test", lastName: "Kunde", phone: "+49 351 0000005", postcode: "1067", country: "DE" })).toEqual([expect.objectContaining({ field: "postcode", suggestion: "01067" })]);
    const values = leadTemplateValues({ id: 1, publicId: "PLZ-1", firstName: "Test", lastName: "Kunde", email: "test@example.com", phone: "+49 351 0000006", postcode: "1067", city: "Dresden", country: "DE", metadata: {}, createdAt: new Date() }, { name: "Wärmepumpe", shortcode: "WP" });
    expect(values.postal_code).toBe("01067");
    expect(leadTemplateValues({ id: 2, publicId: "PLZ-2", firstName: "Test", lastName: "Wien", email: "wien@example.com", phone: "+43 1 0000007", postcode: "1010", city: "Wien", country: "AT", metadata: {}, createdAt: new Date() }, null).postal_code).toBe("1010");
  });
});
