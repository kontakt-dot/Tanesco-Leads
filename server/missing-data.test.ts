import { describe, expect, it } from "vitest";
import { buildApiErrorOverview, leadDataProblems, type ApiLeadRow } from "../shared/api-errors";
import { emailFromFields, extractDialerContact } from "../shared/dialer-contact";
import { WATTFOX, WATTFOX_TEMPLATE } from "../shared/wattfox";
import { endpointNeeds, type NeedEndpoint } from "./outbound-templates";

/** Version 371 – ein Lead ohne E-Mail-Adresse: die Adresse vom Dialer auch unter eigenem Namen finden, und was fehlt, steht unter „API-Fehler“, bevor der Lead rausgeht. */
describe("E-Mail-Adresse vom Dialer – auch unter eigenem Namen", () => {
  it("„pv_email“, „wp_email“ und „E-Mail-Adresse“ im Kontakt gelten als E-Mail des Kontakts – nicht als Zusatzfeld", () => {
    const pv = extractDialerContact({ call_id: "1", phone: "+49 30 1", contact: { first_name: "Laura", last_name: "Sommer", pv_email: "Laura.Sommer@example.de", pv_dachart: "Satteldach" } });
    expect(pv.email).toBe("laura.sommer@example.de"); expect(Object.keys(pv.fields)).toEqual(["pv_dachart"]); expect(pv.found).toContain("contact.email");
    expect(extractDialerContact({ phone: "1", contact: { last_name: "Sommer", "E-Mail-Adresse": "l.sommer@example.de" } }).email).toBe("l.sommer@example.de");
    expect(extractDialerContact({ phone: "1", wp_email: "l.sommer@example.de", wp_plz: "9633", wp_ort: "Halsbrücke", wp_nachname: "Sommer" })).toMatchObject({ email: "l.sommer@example.de", postcode: "09633", city: "Halsbrücke", lastName: "Sommer" });
  });
  it("bei den weiteren Feldern: die Adresse wird E-Mail des Kontakts und steht nicht doppelt da", () => {
    const contact = extractDialerContact({ phone: "1", contact: { last_name: "Sommer", fields: { pv_email: "l.sommer@example.de", pv_dachart: "Satteldach" } } });
    expect(contact.email).toBe("l.sommer@example.de"); expect(contact.fields).toEqual({ pv_dachart: "Satteldach" }); expect(contact.found).toContain("contact.email (aus den Feldern)");
    expect(extractDialerContact({ phone: "1", contact: { fields: { "E-Posta": "l.sommer@example.de" } } }).email).toBe("l.sommer@example.de");
  });
  it("letzter Versuch: genau eine Adresse irgendwo in der Meldung – nie die des Agenten", () => {
    expect(extractDialerContact({ phone: "1", contact: { last_name: "Sommer", kontaktweg: "l.sommer@example.de" } }).email).toBe("l.sommer@example.de");
    expect(extractDialerContact({ phone: "1", agent: "Deniz Kaya", agent_email: "deniz@dialer.example", contact: { last_name: "Sommer" } }).email).toBeNull();
    expect(extractDialerContact({ phone: "1", contact: { last_name: "Sommer", a: "eins@example.de", b: "zwei@example.de" } }).email).toBeNull(); // zwei verschiedene: nicht raten
    expect(extractDialerContact({ phone: "1", contact: { last_name: "Sommer", email: "keine" } }).email).toBeNull();
  });
  it("gespeicherte Angaben eines Leads: Adresse unter einem Namen des Dialers finden", () => {
    expect(emailFromFields({ rawContactId: 4, pv_email: " L.Sommer@Example.de ", dialerNote: "ruft zurück" })).toEqual({ key: "pv_email", email: "l.sommer@example.de" });
    expect(emailFromFields({ agent_email: "deniz@dialer.example", dialerNote: "schreibt an x@example.de" })).toBeNull();
    expect(emailFromFields({ pv_email: "kommt noch" })).toBeNull(); expect(emailFromFields(null)).toBeNull();
  });
});

describe("API-Fehler – was fehlt, steht da, bevor der Lead rausgeht", () => {
  const phone = "+4915112340071";
  it("fehlende E-Mail-Adresse wird gemeldet (mit Option „missing“), ohne die Option bleibt alles wie bisher", () => {
    expect(leadDataProblems({ email: null, phone })).toEqual([]);
    expect(leadDataProblems({ email: null, phone }, { missing: true })).toEqual([{ field: "email", missing: true, title: "Die E-Mail-Adresse fehlt.", hint: "Ohne E-Mail-Adresse nehmen viele Käufer den Lead nicht an." }]);
    expect(leadDataProblems({ email: "<UNKNOWN>", phone }, { missing: true }).map((problem) => problem.field)).toEqual(["email"]);
    expect(leadDataProblems({ email: "l.sommer@example.de", phone }, { missing: true })).toEqual([]);
    expect(leadDataProblems({ email: "", phone: "" }, { missing: true }).map((problem) => problem.title)).toEqual(["Weder Rufnummer noch E-Mail-Adresse."]); // nicht doppelt
  });
  it("Pflichtangaben einer Schnittstelle: je fehlendem Feld ein Eintrag mit dem Namen des Käufers", () => {
    const problems = leadDataProblems({ firstName: "Laura", lastName: "Sommer", email: null, phone, postcode: "48249", city: "Dülmen", country: "DE" }, { missing: true, needs: [{ buyer: "Wattfox", missing: ["Anrede (Herr/Frau)", "Straße", "E-Mail"] }] });
    expect(problems.map((problem) => [problem.field, problem.title, problem.hint])).toEqual([
      ["salutation", "Die Anrede fehlt (Herr oder Frau).", "Wattfox nimmt den Lead nur damit an."],
      ["street", "Die Straße fehlt.", "Wattfox nimmt den Lead nur damit an."],
      ["email", "Die E-Mail-Adresse fehlt.", "Wattfox nimmt den Lead nur damit an."],
    ]);
    // zwei Käufer brauchen dasselbe; was da ist, wird nicht als fehlend gemeldet
    const two = leadDataProblems({ email: null, phone, street: "Hauptstraße 12", salutation: "Frau" }, { missing: true, needs: [{ buyer: "Wattfox", missing: ["E-Mail", "Straße", "Anrede (Herr/Frau)"] }, { buyer: "Helios Solar", missing: ["E-Mail"] }] });
    expect(two).toEqual([{ field: "email", missing: true, title: "Die E-Mail-Adresse fehlt.", hint: "Wattfox und Helios Solar nehmen den Lead nur damit an." }]);
  });
  it("Wattfox-Vorlage: was dem Lead für die Schnittstelle seiner Kategorie fehlt – gerechnet wie beim Senden", () => {
    const endpoint: NeedEndpoint = { enabled: true, categoryId: 1, bodyTemplate: WATTFOX_TEMPLATE, omitAutoFields: false, valueMappings: null, sourceFilterMode: "alle", sourceSupplierIds: null, fieldFilters: null, buyerName: "Wattfox" };
    const lead = { id: 7, publicId: "L7", firstName: "Laura", lastName: "Sommer", email: null, phone, postcode: "48249", city: "Dülmen", country: "DE", metadata: { street: "Hauptstraße 12" }, createdAt: new Date(), categoryId: 1, supplierId: null };
    const pv = { name: "Photovoltaik", shortcode: "PV" };
    expect(endpointNeeds(lead, [endpoint], pv)).toEqual([{ buyer: "Wattfox", missing: ["Anrede (Herr/Frau)", "E-Mail"] }]);
    expect(endpointNeeds({ ...lead, email: "l.sommer@example.de", metadata: { street: "Hauptstraße 12", anrede: "Frau" } }, [endpoint], pv)).toEqual([]);
    expect(endpointNeeds(lead, [endpoint], { name: "Wärmepumpe", shortcode: "WP" })).toEqual([{ buyer: "Wattfox", missing: ["E-Mail"] }]); // Anrede ist nur bei PV Pflicht
    expect(endpointNeeds(lead, [{ ...endpoint, enabled: false }], pv)).toEqual([]); expect(endpointNeeds(lead, [{ ...endpoint, categoryId: 2 }], pv)).toEqual([]);
    expect(endpointNeeds(lead, [{ ...endpoint, bodyTemplate: "{\"email\":\"{{email}}\"}" }], pv)).toEqual([]); // eigene Vorlagen kennen keine Pflichtangaben
    expect(endpointNeeds(lead, [{ ...endpoint, sourceFilterMode: "nur", sourceSupplierIds: [9] }], pv)).toEqual([]); // diese Schnittstelle bekommt den Lead gar nicht
    expect(WATTFOX.tokenHeader).toBe("X-AUTH-TOKEN");
  });
  it("Übersicht: freigegebener Lead ohne E-Mail steht als „Angaben“ da – alte Leads und abgehakte nicht", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    const base: ApiLeadRow = { id: 1, publicId: "AAAA1111", firstName: "Laura", lastName: "Sommer", email: null, phone, postcode: "48249", city: "Dülmen", country: "DE", status: "genehmigt", categoryId: 1, supplierName: "OnDialer", metadata: { street: "Hauptstraße 12" }, createdAt: new Date("2026-11-26T11:20:00Z") };
    const build = (leads: ApiLeadRow[], needs: Array<{ leadId: number; buyer: string; missing: string[] }> = []) => buildApiErrorOverview({ now, days: 30, leads, events: [], deliveries: [], notes: [], endpoints: [], integrations: [], categories: [{ id: 1, name: "Photovoltaik" }], needs });
    const overview = build([base, { ...base, id: 2, publicId: "BBBB2222", createdAt: new Date("2026-08-01T10:00:00Z") }, { ...base, id: 3, publicId: "CCCC3333", metadata: { apiErrorsDismissedAt: "2026-11-26T11:30:00Z" } }, { ...base, id: 4, publicId: "DDDD4444", email: "l.sommer@example.de" }, { ...base, id: 5, publicId: "EEEE5555", status: "zugewiesen" }]);
    expect(overview.problems.map((problem) => problem.publicId)).toEqual(["AAAA1111"]); expect(overview.counts).toMatchObject({ open: 1, daten: 1 });
    expect(overview.problems[0]).toMatchObject({ kind: "daten", fix: "lead", field: "email", title: "Die E-Mail-Adresse fehlt.", advice: "Vor dem Ausliefern nachtragen (zum Beispiel nach einem Rückruf beim Kunden) – sonst nimmt der Käufer den Lead nicht an." });
    expect(overview.problems[0].lead).toMatchObject({ salutation: "", email: "" });
    // mit Wattfox: Anrede und E-Mail – die Anrede aus den Angaben des Leads zählt
    const wattfox = build([base, { ...base, id: 6, publicId: "FFFF6666", metadata: { anrede: "frau" } }], [{ leadId: 1, buyer: "Wattfox", missing: ["Anrede (Herr/Frau)", "E-Mail"] }, { leadId: 6, buyer: "Wattfox", missing: ["E-Mail"] }]);
    expect(wattfox.problems.find((problem) => problem.leadId === 1)!.dataProblems.map((item) => item.field)).toEqual(["salutation", "email"]);
    expect(wattfox.problems.find((problem) => problem.leadId === 6)!.lead.salutation).toBe("Frau");
  });
});

describe("Anrede aus dem Gespräch (v372)", () => {
  it("zählt „Herr/Frau <Nachname des Leads>“ – andere Namen (Agent) zählen nicht; Schreibweisen der Spracherkennung gelten als derselbe Name", async () => {
    const { salutationFromTranscript } = await import("../shared/dialer-intake");
    expect(salutationFromTranscript("Guten Tag, Frau Sommer? Hier ist Herr Kaya. Frau Sommer, es geht um …", "Sommer")).toBe("Frau");
    expect(salutationFromTranscript("Spreche ich mit Herrn Meyer? Ja. Herr Dr. Meier, kurz zu Ihrem Dach.", "Meier")).toBe("Herr");
    expect(salutationFromTranscript("Herr Hofmann, guten Tag.", "Hoffmann")).toBe("Herr"); // ein Buchstabe Unterschied
    expect(salutationFromTranscript("Guten Tag Frau Berg-Lindner.", "Lindner")).toBe("Frau"); expect(salutationFromTranscript("Frau Lindner, hallo.", "Berg-Lindner")).toBe("Frau");
    expect(salutationFromTranscript("Hier ist Herr Kaya vom Service.", "Sommer")).toBeNull();
    expect(salutationFromTranscript("Herr Sommer? Nein, hier ist Frau Sommer.", "Sommer")).toBeNull(); // unklar: lieber nichts
    expect(salutationFromTranscript("Herr Sommer", "")).toBeNull(); expect(salutationFromTranscript(null, "Sommer")).toBeNull(); expect(salutationFromTranscript("Herr Li, hallo", "Li")).toBeNull(); // zu kurz für eine sichere Zuordnung
  });
});
