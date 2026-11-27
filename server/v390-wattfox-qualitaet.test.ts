import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { internationalPhone, isBrokenPhone, nationalPhone, repairedPhone } from "../shared/phone";
import { WATTFOX, WATTFOX_TEMPLATE, isMobilePhone, wattfoxAcquisition, wattfoxExtraAllowed, wattfoxGas, wattfoxHeatingAge, wattfoxOrigin, wattfoxOriginCheck, wattfoxPayload, wattfoxPitch, wattfoxSouth, wattfoxTemplateWithAgreedOrigin, wattfoxTestLeads } from "../shared/wattfox";
import { PLACEHOLDERS, buildEndpointBody, leadTemplateValues } from "./outbound-templates";
import { buildLeadExportPayload, buildProviderPayload } from "./lead-integration-export";

/**
 * Version 390 – Rückmeldung der Qualitätskontrolle von Wattfox (27.11.2026, zu einer anderen Software), bei uns ausgeschlossen:
 *  1. Telefonnummern kamen mit „49…“ statt „+49…“ oder „0…“ → kein automatischer Anruf möglich.
 *  2. „Schickt gerne alle Infos mit – am besten direkt in die Felder“ (alles Übrige landet im Freitext).
 *  3. Tippfehler in utm_campaign („Hauskompass: Meta- Vorqualifierzung“).
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const pv = wattfoxTestLeads()[0].values; // erfundener Photovoltaik-Testlead
const lead = (phone: string | null, metadata: Record<string, unknown> = {}, country = "DE") => ({ id: 11, publicId: "L-0011", firstName: "Laura", lastName: "Stein", email: "laura.stein@example.com", phone, postcode: "79115", city: "Freiburg", country, createdAt: new Date("2026-11-27T10:00:00Z"), metadata: { anrede: "Frau", street: "Probeweg 9", umsetzung: "1-3 Monate", ...metadata } });

describe("1. Telefonnummer: nie „49…“ ohne Plus", () => {
  it("international und ohne Leerzeichen – aus jeder Schreibweise", () => {
    const cases: Array<[string, string | null, string]> = [
      ["4917012345678", "DE", "+4917012345678"], // der gemeldete Fehler: Ländervorwahl ohne Plus
      ["49 170 1234567", "DE", "+491701234567"], ["+49 170 1234567", "DE", "+491701234567"], ["0049 170 1234567", "DE", "+491701234567"],
      ["0170/1234567", "DE", "+491701234567"], ["0170-123 45 67", "DE", "+491701234567"], ["(0761) 0000001", "DE", "+497610000001"],
      ["+49 (0) 170 1234567", "DE", "+491701234567"], ["+49 0170 1234567", "DE", "+491701234567"], ["1701234567", "DE", "+491701234567"],
      ["0664 1234567", "AT", "+436641234567"], ["436641234567", "AT", "+436641234567"], ["079 123 45 67", "CH", "+41791234567"], ["0049 761 0000003", "AT", "+497610000003"],
      ["49112345", "DE", "+4949112345"], // Leer (0491) ohne Null – kurze Nummer, keine Ländervorwahl
      ["0170 1234567 / 0761 0000002", "DE", "+491701234567"], // zwei Nummern im Feld → die erste
    ];
    for (const [raw, country, expected] of cases) expect(internationalPhone(raw, country), raw).toBe(expected);
    for (const raw of ["", "keine Angabe", "12", "n/a"]) expect(internationalPhone(raw, "DE"), raw).toBeNull();
    expect(nationalPhone("4917012345678", "DE")).toBe("017012345678"); expect(nationalPhone("+41 79 123 45 67", "DE")).toBe("+41791234567"); // Ausland bleibt international
  });
  it("kaputte Formen erkennen; für die übrigen Käufer nur diese reparieren – „0170 …“ und „+49 170 …“ bleiben, wie sie sind", () => {
    for (const raw of ["4917012345678", "0049 170 1234567", "+49 0170 1234567", "0043 664 1234567", "41791234567"]) expect(isBrokenPhone(raw), raw).toBe(true);
    for (const raw of ["0170 1234567", "+49 170 1234567", "07611234567", "+41 79 123 45 67", ""]) expect(isBrokenPhone(raw), raw).toBe(false);
    expect(repairedPhone("4917012345678", "DE")).toBe("+4917012345678"); expect(repairedPhone("0170 1234567", "DE")).toBe("0170 1234567"); expect(repairedPhone("+49 170 1234567", "DE")).toBe("+49 170 1234567");
  });
  it("an Wattfox immer international – auch wenn die Nummer am Lead als „49…“, „0…“ oder mit „(0)“ steht; alle Testleads ohne Leerzeichen", () => {
    for (const raw of ["4917012345678", "017012345678", "+49 (0)170 12345678", "0049 170 12345678"]) expect(wattfoxPayload({ ...pv, phone: raw }).payload.phone, raw).toBe(raw === "017012345678" ? "+4917012345678" : "+4917012345678");
    for (const test of wattfoxTestLeads({ all: true })) expect(String(wattfoxPayload(test.values).payload.phone), test.label).toMatch(/^\+49\d{8,13}$/);
    // keine Nummer am Lead, aber in den Angaben (z. B. „Handy“) → die geht raus, international
    expect(wattfoxPayload({ ...pv, phone: "", "custom_data.handy": "0170 7654321" }).payload.phone).toBe("+491707654321");
    // eine zweite Nummer des Kunden steht im Freitext, ebenfalls international
    const notes = String(wattfoxPayload({ ...pv, phone: "4917012345678", "custom_data.festnetz": "0761 0000009", "custom_data.mobil": "+49 170 12345678" }).payload.notes);
    expect(notes).toContain("Weitere Rufnummer: +497610000009"); expect(notes).not.toContain("+4917012345678"); // die Hauptnummer nicht doppelt
  });
  it("Vorlagen der übrigen Käufer: {{phone}} repariert, dazu {{phone_e164}} und {{phone_national}}; Export an Käufer-Schnittstellen ebenso", () => {
    expect(PLACEHOLDERS).toContain("phone_e164"); expect(PLACEHOLDERS).toContain("phone_national");
    const values = leadTemplateValues(lead("4917012345678"), { name: "Photovoltaik", shortcode: "PV" });
    expect(values).toMatchObject({ phone: "+4917012345678", phone_e164: "+4917012345678", phone_national: "017012345678" });
    expect(leadTemplateValues(lead("0170 1234567"), null)).toMatchObject({ phone: "0170 1234567", phone_e164: "+491701234567", phone_national: "01701234567" });
    const body = JSON.parse(buildEndpointBody({ bodyTemplate: '{"tel": "{{phone}}", "e164": "{{phone_e164}}"}', omitAutoFields: true, valueMappings: [] }, values).body);
    expect(body).toEqual({ tel: "+4917012345678", e164: "+4917012345678" });
    const exportable = { publicId: "L-0011", categoryId: 1, firstName: "Laura", lastName: "Stein", email: null, phone: "4917012345678", postcode: "79115", city: "Freiburg", country: "DE", metadata: {} };
    expect(buildLeadExportPayload(exportable as never).lead.phone).toBe("+4917012345678");
    expect(buildProviderPayload(exportable as never, { phone: "phone" }).phone).toBe("+4917012345678");
  });
});

describe("2. Alles mitschicken – wo möglich direkt in die Felder, sonst in den Freitext", () => {
  it("Felder von Wattfox bleiben Felder; alles Übrige über den Kunden steht als „Bezeichnung: Wert“ im Freitext", () => {
    const { payload } = wattfoxPayload({ ...pv, "custom_data.kundenalter": "58", "custom_data.wie_viele_angebote": "3", "custom_data.personen_im_haushalt": "4", "custom_data.installationsort": "Keller", "custom_data.strompreis": "38 Cent", "custom_data.waermequelle": "Luft", "custom_data.e_auto": true });
    expect(payload).toMatchObject({ ph_ausrichtungderflaeche: "Süd", ph_dachflaeche: "60", ph_stromspeicher: "Ja", stromverbrauch: 5000, implementation: "1 bis 3 Monate" }); // direkt in den Feldern
    const notes = String(payload.notes);
    for (const line of ["Kundenalter: 58", "Wie viele Angebote: 3", "Personen im Haushalt: 4", "Installationsort: Keller", "Strompreis: 38 Cent", "Wärmequelle: Luft", "E-Auto: Ja"]) expect(notes, line).toContain(line); // Bezeichnungen wie in den Lead-Kategorien
    expect(String(wattfoxPayload({ ...pv, "custom_data.pv_wie_viele_angebote": "2" }).payload.notes)).toContain("Wie viele Angebote: 2"); // Feld von OnDialer mit „pv_“
    // Angaben, die schon in einem Feld stehen, nicht noch einmal im Freitext
    expect(notes).not.toMatch(/^Dachausrichtung:|^Dachfläche:|^Stromspeicher:|^Hausart:/m);
  });
  it("mehr Felder von Wattfox direkt gefüllt – mit genau den Werten aus der Beschreibung (Handy, Dachneigung, Süddach, Gasanschluss, Nutzung, Alter der Heizung, Kauf/Miete)", () => {
    expect(isMobilePhone("+4917012345678")).toBe(true); expect(isMobilePhone("+497610000001")).toBe(false); expect(isMobilePhone("+436641234567")).toBe(true); expect(isMobilePhone("+41791234567")).toBe(true);
    expect(wattfoxPayload({ ...pv, phone: "4917012345678" }).payload).toMatchObject({ phone: "+4917012345678", mobile: "+4917012345678" }); // Handy auch im Feld „mobile“
    expect(wattfoxPayload({ ...pv, phone: "0761 0000001", "custom_data.handy": "0151 2223344" }).payload).toMatchObject({ phone: "+497610000001", mobile: "+491512223344" }); // Festnetz + Handy
    expect(String(wattfoxPayload({ ...pv, phone: "0761 0000001", "custom_data.handy": "0151 2223344" }).payload.notes)).not.toContain("Weitere Rufnummer");
    expect(["Flachdach", "12°", "20 Grad", "35", "50°", "20-40", "weiß nicht", "70°"].map((value) => wattfoxPitch(value, null)?.value)).toEqual(["0° bis 15°", "0° bis 15°", "16° bis 30°", "31° bis 45°", "46° bis 60°", "16° bis 30°", "weiß nicht", "weiß nicht"]);
    expect(wattfoxPitch(null, "Flachdach")).toEqual({ value: "0° bis 15°", exact: true }); expect(wattfoxPitch(null, "Satteldach")).toBeNull();
    expect(["Süd", "Südwest", "SO", "West", "Ost-West", "Nord", "weiß nicht", "teilweise Süd"].map(wattfoxSouth)).toEqual(["Ja", "Ja", "Ja", "Nein", "Nein", "Nein", "Bin nicht sicher", "Teilweise"]);
    expect([wattfoxGas("Ja", null), wattfoxGas("liegt in der Straße", null), wattfoxGas("Nein", null), wattfoxGas(null, "Erdgas"), wattfoxGas(null, "Flüssiggas"), wattfoxGas(null, "Heizöl")]).toEqual(["Ja, im Haus", "Ja, in Straße", "Nein", "Ja, im Haus", null, null]);
    expect([wattfoxHeatingAge("15 Jahre", new Date(2026, 10, 27)), wattfoxHeatingAge("2005", new Date(2026, 10, 27)), wattfoxHeatingAge("weiß nicht")]).toEqual([15, 21, null]);
    expect([wattfoxAcquisition("Kauf", "pv"), wattfoxAcquisition("Miete", "pv"), wattfoxAcquisition("Kauf oder Miete", "pv"), wattfoxAcquisition("unsicher", "pv"), wattfoxAcquisition("Contracting", "wp"), wattfoxAcquisition("Kauf", "wp")]).toEqual(["Kauf", "Miete", "Miete / Kauf", "Weiß nicht / Beratung erwünscht", "Contracting", "Kauf"]);
    const roof = wattfoxPayload({ ...pv, "custom_data.dachart": "Flachdach" }).payload;
    expect(roof).toMatchObject({ ph_neigungderflaeche: "0° bis 15°", ph_ausrichtungsued: "Ja" }); expect(String(roof.notes)).toContain("Dachart: Flachdach");
    const heat = wattfoxPayload(wattfoxTestLeads()[1].values).payload; // Wärmepumpe, heizt mit Erdgas
    expect(heat).toMatchObject({ hz_gasanschluss: "Ja, im Haus", wp_nutzung: ["zum Heizen"] });
    expect(wattfoxPayload({ ...wattfoxTestLeads()[1].values, "custom_data.aktuelles_heizsystem": "Heizöl" }).payload.hz_gasanschluss).toBeUndefined();
  });

  it("nie im Freitext: Aufnahme, Transkript, Agent, Bewertung, Einwilligung, Herkunft der Anzeige, Lieferant, Preise, interne Nummern, Links", () => {
    const hidden = { "custom_data.recording_1": "https://download.voicefile.de/a.mp3", "custom_data.record_file": "a.mp3", "custom_data.sprachaufzeichnung": "ja", "custom_data.transcript": "Agent: Guten Tag …", "custom_data.agentName": "Agent Muster", "custom_data.callScore": 87, "custom_data.consent": "ja", "custom_data.optInProof": "SMS", "custom_data.utm_campaign": "Herbst", "custom_data.utm_source": "facebook", "custom_data.lieferant": "OnDialer", "custom_data.ghl_id": "abc123", "custom_data.preis": "29", "custom_data.partnerDuplicate": "x", "custom_data.lead_quelle": "Meta", "custom_data.fb_form_id": "991", "custom_data.webseite": "https://beispiel.example", "custom_data.zusammenfassung": "Kunde will …", "custom_data.kampagne": "FB PV & WP - FOX", "custom_data.callExtractedAt": "2026-11-27", "custom_data.platform": "fb", "custom_data.created_time": "2026-11-27T08:00", "custom_data.notiz_intern": "schwieriger Kunde" };
    const notes = String(wattfoxPayload({ ...pv, ...hidden }).payload.notes);
    for (const word of ["voicefile", "a.mp3", "Guten Tag", "Muster", "87", "Herbst", "facebook", "OnDialer", "abc123", "Meta", "991", "beispiel.example", "Kunde will", "FOX", "SMS", "Platform", "08:00", "schwieriger"]) expect(notes, word).not.toContain(word);
    for (const [key, value] of [["kundenalter", "58"], ["waermequelle", "Luft"], ["strompreis", "38"], ["lebenspartner_entscheidet_mit", "ja"]] as const) expect(wattfoxExtraAllowed(key, value), key).toBe(true);
    for (const [key, value] of [["quelle", "Meta"], ["preis", "29"], ["partner", "x"], ["agent", "x"], ["notiz", "siehe https://x.example"], ["id", "5"], ["telefon", "0170"]] as const) expect(wattfoxExtraAllowed(key, value), key).toBe(false);
  });
});

describe("3. Herkunft ohne Tippfehler", () => {
  it("der vereinbarte Wert ist richtig geschrieben – kein „Vorqualifierzung“ irgendwo", () => {
    expect(WATTFOX.utm).toEqual({ utm_source: "Tanesco Digital GbR", utm_medium: "affiliate", utm_campaign: "Hauskompass, Meta vorqualifiziert" });
    expect(JSON.parse(WATTFOX_TEMPLATE)).toEqual({ vorlage: "wattfox", ...WATTFOX.utm });
    for (const file of ["../shared/wattfox.ts", "../client/src/components/IntegrationTab.tsx", "../shared/help-knowledge.ts"]) expect(read(file), file).not.toMatch(/vorqualifier|Meta-\s+Vorqual/i);
  });
  it("utm_source und utm_medium gehen immer wie vereinbart raus; kleine Tippfehler in utm_campaign werden zum vereinbarten Wert, eine andere Marke bleibt, leer geht nichts mit", () => {
    expect(wattfoxOrigin({ utm_source: "Tanesco Digital", utm_medium: "Affiliate ", utm_campaign: "hauskompass meta vorqualifizert", extra: "bleibt" })).toEqual({ utm_source: "Tanesco Digital GbR", utm_medium: "affiliate", utm_campaign: "Hauskompass, Meta vorqualifiziert", extra: "bleibt" });
    expect(wattfoxOrigin({ ...WATTFOX.utm, utm_campaign: "Hauskompass ,  Meta  vorqualifiziert" }).utm_campaign).toBe("Hauskompass, Meta vorqualifiziert");
    expect(wattfoxOrigin({ ...WATTFOX.utm, utm_campaign: "Solarprofi, Google vorqualifiziert" }).utm_campaign).toBe("Solarprofi, Google vorqualifiziert"); // andere Marke nach Rücksprache
    expect(wattfoxOrigin({ ...WATTFOX.utm, utm_campaign: "  " }).utm_campaign).toBeUndefined();
  });
  it("beim Senden: die Herkunft aus dem Body wird abgesichert – der Lead geht mit den vereinbarten Werten raus", () => {
    const template = JSON.stringify({ vorlage: "wattfox", utm_source: "Tanesco Digtal GbR", utm_medium: "affiliate", utm_campaign: "Hauskompas, Meta vorqualifiziert" });
    const payload = JSON.parse(buildEndpointBody({ bodyTemplate: template, omitAutoFields: true, valueMappings: [] }, leadTemplateValues(lead("4917012345678"), { name: "Photovoltaik", shortcode: "PV" })).body);
    expect(payload).toMatchObject({ utm_source: "Tanesco Digital GbR", utm_medium: "affiliate", utm_campaign: "Hauskompass, Meta vorqualifiziert", phone: "+4917012345678" });
  });
  it("Endpoint-Editor: grün „Herkunft geprüft“ – oder was abweicht, mit „Vereinbarte Herkunft einsetzen“", () => {
    expect(wattfoxOriginCheck(WATTFOX_TEMPLATE)).toMatchObject({ ok: true, problems: [] });
    expect(wattfoxOriginCheck('{"first_name": "{{first_name}}"}')).toBeNull();
    const typo = wattfoxOriginCheck(JSON.stringify({ vorlage: "wattfox", ...WATTFOX.utm, utm_campaign: "Hauskompass, Meta vorqualifizirt" }))!;
    expect(typo.ok).toBe(false); expect(typo.problems[0]).toContain("falsch geschrieben"); expect(typo.sent.utm_campaign).toBe(WATTFOX.utm.utm_campaign);
    const other = wattfoxOriginCheck(JSON.stringify({ vorlage: "wattfox", ...WATTFOX.utm, utm_campaign: "Hauskompass: Meta- Vorqualifierzung" }))!;
    expect(other.problems[0]).toContain("weicht vom vereinbarten Wert ab");
    expect(wattfoxOriginCheck(JSON.stringify({ vorlage: "wattfox", utm_source: "x", utm_medium: "affiliate" }))!.problems).toHaveLength(2); // Quelle falsch, Kampagne fehlt
    const fixed = wattfoxTemplateWithAgreedOrigin(JSON.stringify({ vorlage: "wattfox", utm_campaign: "falsch", external_lead_price: "29,90" }));
    expect(JSON.parse(fixed)).toEqual({ vorlage: "wattfox", external_lead_price: "29,90", ...WATTFOX.utm }); expect(wattfoxOriginCheck(fixed)!.ok).toBe(true);
    const editor = read("../client/src/components/IntegrationTab.tsx");
    expect(editor).toContain("Herkunft geprüft: genau wie mit Wattfox vereinbart"); expect(editor).toContain(">Vereinbarte Herkunft einsetzen</Button>");
    expect(editor).toContain("Die Telefonnummer geht immer international raus („+49…“), nie als „49…“.");
  });
});
