import { beforeAll, describe, expect, it } from "vitest";
import { WATTFOX, WATTFOX_TEMPLATE, isTestAddress, isWattfoxTemplate, wattfoxArea, wattfoxConsumption, wattfoxHeating, wattfoxImplementation, wattfoxOrientation, wattfoxPayload, wattfoxRoofAge, wattfoxTestLeads } from "../shared/wattfox";
import { buildEndpointBody, extractPartnerReference, leadTemplateValues } from "./outbound-templates";

const tests = wattfoxTestLeads({ all: true }); // die 9 aus der früheren Mail von Wattfox
const byLabel = (label: string) => tests.find((item) => item.label === label)!.values;

describe("Wattfox: Leads im Format von Wattfox", () => {
  it("PV-Lead: Produkt 2, Werte von Wattfox, ungefähre Werte zusätzlich im Hinweis", () => {
    const { payload, products, missing } = wattfoxPayload(byLabel("PV 1"));
    expect(products).toEqual({ main: "pv", extra: null });
    expect(missing).toEqual([]);
    expect(payload).toMatchObject({ productId: 2, salutation: "Herr", firstname: "Max", lastname: "Testmann", street: "Teststraße 1", zip: "79110", city: "Freiburg", country: "DE", implementation: "1 bis 3 Monate", ph_artdesgebaeude: "Ein-/Zweifamilienhaus", ph_ausrichtungderflaeche: "Süd", ph_alterderflaeche: "bis 25 Jahre alt", ph_dachflaeche: "60", ph_stromspeicher: "Ja", stromverbrauch: 5000 });
    expect(payload.childinterests).toBeUndefined(); expect(payload.otherinterests).toBeUndefined();
    expect(String(payload.notes)).toContain("TESTLEAD"); expect(String(payload.notes)).toContain("Dachalter laut Gespräch: Unter 30 Jahre"); expect(String(payload.notes)).toContain("Erreichbarkeit: nachmittags");
    expect(Object.keys(payload).some((key) => key.startsWith("hz_") || key.startsWith("wp_"))).toBe(false);
  });

  it("Wärmepumpe: Heizung 20 mit Unterprodukt 6, Heizung als Liste, Fläche als Zahl", () => {
    const { payload, products, missing } = wattfoxPayload(byLabel("WP 1"));
    expect(products).toEqual({ main: "wp", extra: null }); expect(missing).toEqual([]);
    expect(payload).toMatchObject({ productId: 20, childinterests: [6], implementation: "1 bis 3 Monate", hz_gebaeudetyp: "Ein- / Zweifamilienhaus", hz_bisherigeheizung: ["Gasheizung"], hz_taetigkeit: "Austausch / Modernisierung", hz_groessederflaeche: 161, hz_personen: "3-4 Personen", wp_artderpumpe: "Luft-Wärmepumpe", wp_waermeabgabesystem: ["Fußbodenheizung"] });
    expect(payload.otherinterests).toBeUndefined();
    expect(String(payload.notes)).toContain("Beheizte Fläche laut Gespräch: 141-180 qm");
    expect(Object.keys(payload).some((key) => key.startsWith("ph_"))).toBe(false);
  });

  it("Ein Lead je Person: PV mit Wärmepumpe und Wärmepumpe mit PV über das Zusatzinteresse", () => {
    const pvWp = wattfoxPayload(byLabel("PV mit Wärmepumpe 1")).payload;
    expect(pvWp).toMatchObject({ productId: 2, otherinterests: [20], childinterests: [6], ph_ausrichtungderflaeche: "Süd", hz_bisherigeheizung: ["Gasheizung"], wp_artderpumpe: "Luft-Wärmepumpe" });
    const wpPv = wattfoxPayload(byLabel("Wärmepumpe mit PV")).payload;
    expect(wpPv).toMatchObject({ productId: 20, childinterests: [6], otherinterests: [2], ph_ausrichtungderflaeche: "Süd-West", ph_stromspeicher: "Ja", wp_artderpumpe: "Luft-Wärmepumpe" });
    // Kategorie für beides („PV + Wärmepumpe“) → PV als Hauptprodukt, Wärmepumpe als Zusatz
    expect(wattfoxPayload({ ...byLabel("PV 2"), lead_type: "PV + Wärmepumpe", lead_type_shortcode: "PVWP" }).products).toEqual({ main: "pv", extra: "wp" });
    // Felder mit der Vorsilbe von OnDialer (nicht zugeordnet) zählen genauso
    expect(wattfoxPayload({ ...byLabel("WP 2"), "custom_data.wp_interesse_photovolatikanalge": "Ja" }).products).toEqual({ main: "wp", extra: "pv" });
    expect(wattfoxPayload({ ...byLabel("PV 3"), "custom_data.pv_waermepumpe": "Nein" }).products).toEqual({ main: "pv", extra: null });
  });

  it("Testleads: einer je Sparte (Photovoltaik, Wärmepumpe, beides) – auf Wunsch alle 9", () => {
    const one = wattfoxTestLeads();
    expect(one.map((item) => item.label)).toEqual(["Photovoltaik", "Wärmepumpe", "PV mit Wärmepumpe"]);
    expect(one.map((item) => wattfoxPayload(item.values).products)).toEqual([{ main: "pv", extra: null }, { main: "wp", extra: null }, { main: "pv", extra: "wp" }]);
    expect(one.every((item) => wattfoxPayload(item.values).missing.length === 0)).toBe(true);
    expect(one.map((item) => item.values)).toEqual([byLabel("PV 1"), byLabel("WP 1"), byLabel("PV mit Wärmepumpe 1")]); // dieselben erfundenen Personen wie in den 9
    expect(wattfoxTestLeads({ all: true })).toHaveLength(9);
  });

  it("Alle 9 Testleads sind vollständig: je 3 PV und Wärmepumpe, 3 mit Zusatzinteresse", () => {
    expect(tests).toHaveLength(9);
    const built = tests.map((item) => wattfoxPayload(item.values));
    expect(built.every((item) => item.missing.length === 0)).toBe(true);
    expect(built.filter((item) => item.products.main === "pv" && !item.products.extra)).toHaveLength(3);
    expect(built.filter((item) => item.products.main === "wp" && !item.products.extra)).toHaveLength(3);
    expect(built.filter((item) => item.products.extra)).toHaveLength(3);
    expect(new Set(built.map((item) => item.payload.email)).size).toBe(9);
    expect(built.every((item) => String(item.payload.email).endsWith("@example.com") && /^\+49 761 0+\d$/.test(String(item.payload.phone)))).toBe(true);
  });

  it("Pflichtangaben: Anrede nur bei PV, sonst Name, Anschrift, Telefon, E-Mail – PLZ mit 5 Ziffern", () => {
    const pv = wattfoxPayload({ ...byLabel("PV 1"), salutation: "", email: "", postal_code: "791" });
    expect(pv.missing).toEqual(["Anrede (Herr/Frau)", "E-Mail", "PLZ mit 5 Ziffern"]);
    expect(wattfoxPayload({ ...byLabel("WP 1"), salutation: "" }).missing).toEqual([]);
    expect(wattfoxPayload({ ...byLabel("WP 1"), street: "", phone: "" }).missing).toEqual(["Straße", "Telefon"]);
    expect(wattfoxPayload({ ...byLabel("PV 1"), salutation: "frau" }).payload.salutation).toBe("Frau");
  });

  it("Übersetzung einzelner Angaben", () => {
    expect(["So schnell wie möglich", "sofort", "1-3 Monate", "4-6 Monate", "Mehr als 6 Monate", "7-12 Monate", "später als 12 Monate", "weiß nicht", "irgendwas"].map((value) => wattfoxImplementation(value).value)).toEqual(["bis in 1 Monat", "bis in 1 Monat", "1 bis 3 Monate", "3 bis 6 Monate", "mehr als 6 Monate", "mehr als 6 Monate", "mehr als 6 Monate", "weiß nicht", "weiß nicht"]);
    expect(wattfoxImplementation(null)).toEqual({ value: "weiß nicht", exact: false });
    expect(["Süd", "Südwest", "Süd-Ost", "SW", "West", "Ost", "Ost-West", "Nord"].map((value) => wattfoxOrientation(value)?.value)).toEqual(["Süd", "Süd-West", "Süd-Ost", "Süd-West", "West", "Ost", "weiß nicht", "weiß nicht"]);
    expect(["Unter 30 Jahre", "30-70 Jahre", "Über 70 Jahre", "25 bis 75", "15 Jahre"].map((value) => wattfoxRoofAge(value, null)?.value)).toEqual(["bis 25 Jahre alt", "25 bis 75 Jahre alt", "älter als 75 Jahre", "25 bis 75 Jahre alt", "bis 25 Jahre alt"]);
    expect(wattfoxRoofAge(null, "Ja")).toEqual({ value: "25 bis 75 Jahre alt", exact: false });
    expect(wattfoxHeating("Erdgas, Holz/Pellets")).toEqual({ values: ["Gasheizung", "Pellet-/Holzheizung"], exact: true, firstInstall: false });
    expect(wattfoxHeating("Flüssiggas").exact).toBe(false);
    expect(wattfoxArea("bis 100 qm")).toEqual({ value: 100, exact: false });
    expect(wattfoxArea("135")).toEqual({ value: 135, exact: true });
    const firstInstall = wattfoxPayload({ ...byLabel("WP 1"), "custom_data.aktuelles_heizsystem": "Erstinstallation/neubauprojekt" }).payload;
    expect(firstInstall.hz_taetigkeit).toBe("Neuinstallation"); expect(firstInstall.hz_bisherigeheizung).toBeUndefined();
  });
});

describe("Wattfox-Vorlage im Body der Lieferadresse", () => {
  const endpoint = { bodyTemplate: WATTFOX_TEMPLATE, omitAutoFields: true, valueMappings: [] as unknown };
  const lead = { id: 7, publicId: "L-0007", firstName: "Laura", lastName: "Stein", email: "laura.stein@example.com", phone: "+49 761 0000010", postcode: "79115", city: "Freiburg", country: "DE", createdAt: new Date("2026-11-24T10:00:00Z"), metadata: { anrede: "Frau", street: "Probeweg 9", umsetzung: "1-3 Monate", hausart: "Ein-/Zweifamilienhaus", dachausrichtung: "Süd", utm_source: "facebook", utm_campaign: "Herbst" } };

  it("baut den Lead selbst – mit der Herkunft aus der Vorlage, ohne unsere lead_id", () => {
    expect(isWattfoxTemplate(WATTFOX_TEMPLATE)).toBe(true); expect(isWattfoxTemplate('{"first_name": "{{first_name}}"}')).toBe(false);
    const built = buildEndpointBody(endpoint, leadTemplateValues(lead, { name: "Photovoltaik", shortcode: "PV" }));
    expect(built.json).toBe(true); expect(built.missing).toEqual([]);
    const payload = JSON.parse(built.body);
    expect(payload).toMatchObject({ productId: 2, salutation: "Frau", firstname: "Laura", street: "Probeweg 9", zip: "79115", implementation: "1 bis 3 Monate", utm_source: "Tanesco Digital GbR", utm_medium: "affiliate" });
    expect(payload.utm_source).toBe("Tanesco Digital GbR"); // nicht die Herkunft des Leads (facebook)
    expect(payload.utm_campaign).toBe("Hauskompass, Meta vorqualifiziert"); // Wert laut Wattfox (Marke für die Callagents) – nie der des Leads („Herbst“)
    const blank = JSON.parse(buildEndpointBody({ ...endpoint, bodyTemplate: JSON.stringify({ vorlage: "wattfox", ...WATTFOX.utm, utm_campaign: "" }) }, leadTemplateValues(lead, { name: "Photovoltaik", shortcode: "PV" })).body);
    expect(blank.utm_campaign).toBeUndefined(); // leer geht es gar nicht mit
    expect(WATTFOX_TEMPLATE).not.toContain("Hyper");
    expect(payload.lead_id).toBeUndefined(); expect(payload.lead_number).toBeUndefined(); expect(payload.vorlage).toBeUndefined();
  });

  it("eigene Zusätze im Body gelten, das Werte-Mapping auch", () => {
    const own = { ...endpoint, bodyTemplate: JSON.stringify({ vorlage: "wattfox", ...WATTFOX.utm, utm_campaign: "Wert von Wattfox", external_lead_price: "29,90" }), valueMappings: [{ field: "hausart", ourValue: "Ein-/Zweifamilienhaus", customerCode: "Mehrfamilienhaus" }] };
    const payload = JSON.parse(buildEndpointBody(own, leadTemplateValues(lead, { name: "Photovoltaik", shortcode: "PV" })).body);
    expect(payload).toMatchObject({ utm_campaign: "Wert von Wattfox", external_lead_price: "29,90", ph_artdesgebaeude: "Mehrfamilienhaus" });
  });

  it("die Nummer von Wattfox („wf_leadid“) wird die Partner-Referenz", () => {
    expect(extractPartnerReference(JSON.stringify({ id: 5, wf_leadid: 4711, firstname: "Laura" }))).toBe("4711");
    expect(extractPartnerReference(JSON.stringify([{ wf_leadid: "WF-9" }]))).toBe("WF-9");
    expect(extractPartnerReference(JSON.stringify({ id: 5 }))).toBe("5");
  });

  it("Testumgebung erkennen – Testleads nie aus Versehen ins Live-System", () => {
    expect(isTestAddress(WATTFOX.leadsUrl)).toBe(true);
    expect(isTestAddress("https://entwicklung.photovoltaik-angebotsvergleich.de/system/modules/wattfoxAPI/v1/leads")).toBe(true);
    expect(isTestAddress("https://api-v1.photovoltaik-angebotsvergleich.de/v1/leads")).toBe(false);
    expect(isTestAddress("https://api.wattfox.net/v1/leads")).toBe(false);
  });
});

describe("Wattfox: Anmeldung und Senden", () => {
  beforeAll(() => { process.env.JWT_SECRET = process.env.JWT_SECRET || "wattfox-test-secret"; });

  it("meldet sich einmal an, schickt den Schlüssel in X-AUTH-TOKEN und hält Leads ohne Pflichtangaben zurück", async () => {
    const { encryptJson, sendToEndpoint } = await import("./outbound-endpoints");
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, headers: init.headers, body: init.body });
      if (url === WATTFOX.loginUrl) return new Response(JSON.stringify({ auth_token: "tok-123" }), { status: 200 });
      return new Response(JSON.stringify({ wf_leadid: 9000 + calls.length, status: "neu" }), { status: 200 });
    }) as unknown as typeof fetch;
    const endpoint = { id: 99001, url: WATTFOX.leadsUrl, method: "POST", headersEncrypted: null, authEnabled: true, authConfigEncrypted: encryptJson({ loginUrl: WATTFOX.loginUrl, credentials: [{ name: "user", value: "testfirma" }, { name: "pass", value: "geheim" }], tokenPath: "auth_token", headerName: "X-AUTH-TOKEN", prefix: "", ttlMinutes: 1380 }), bodyTemplate: WATTFOX_TEMPLATE, omitAutoFields: true, valueMappings: [] } as never;
    const first = await sendToEndpoint(endpoint, byLabel("PV 1"), { fetchImpl });
    const second = await sendToEndpoint(endpoint, byLabel("WP 1"), { fetchImpl });
    expect(first.ok && second.ok).toBe(true);
    expect(calls.filter((call) => call.url === WATTFOX.loginUrl)).toHaveLength(1);
    expect(JSON.parse(calls[0].body)).toEqual({ user: "testfirma", pass: "geheim" });
    const sent = calls.filter((call) => call.url === WATTFOX.leadsUrl);
    expect(sent.map((call) => call.headers["x-auth-token"])).toEqual(["tok-123", "tok-123"]);
    expect(sent.map((call) => JSON.parse(call.body).productId)).toEqual([2, 20]);
    expect(first.partnerReference).toBe("9002");
    // Ohne Anrede und E-Mail: gar nicht erst senden – klarer Grund für „API-Fehler“
    const before = calls.length;
    const held = await sendToEndpoint(endpoint, { ...byLabel("PV 2"), salutation: "", email: "" }, { fetchImpl });
    expect(calls.length).toBe(before);
    expect(held).toMatchObject({ ok: false, status: 422, error: "Für Wattfox fehlt: Anrede (Herr/Frau), E-Mail – nicht gesendet" });
  });
});

describe("Anrede vom Dialer", () => {
  it("„contact.salutation“ aus der Meldung von OnDialer landet am Lead und geht an Wattfox", async () => {
    const { extractDialerContact, mergeDialerData } = await import("../shared/dialer-contact");
    const contact = extractDialerContact({ call_id: "c-1", phone: "+49 761 0000012", contact: { first_name: "Karin", last_name: "Wolff", salutation: "Frau", street: "Probeweg 4", postcode: "79100", city: "Freiburg", email: "karin.wolff@example.com", fields: { pv_umsetzung: "1-3 Monate" } } });
    expect(contact.fields.salutation).toBe("Frau");
    const merged = mergeDialerData({}, contact).data;
    const values = leadTemplateValues({ id: 1, publicId: "L-1", firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: "+49 761 0000012" /* Rufnummer des Gesprächs */, postcode: contact.postcode, city: contact.city, country: "DE", metadata: merged, createdAt: new Date() }, { name: "Photovoltaik", shortcode: "PV" });
    const built = wattfoxPayload(values);
    expect(built.payload).toMatchObject({ salutation: "Frau", firstname: "Karin", street: "Probeweg 4", implementation: "1 bis 3 Monate" });
    expect(built.missing).toEqual([]);
  });
});

describe("Interesse an beidem aus dem anderen Fragebogen (v356)", () => {
  // Wie bei OnDialer: PV-Lead, beide Fragebögen ausgefüllt, nur „Interesse Photovoltaikanlage: Ja“ (WP-Fragen) – kein „Wärmepumpe: Ja“
  const lead = { lead_type: "Photovoltaik", lead_type_shortcode: "PV", salutation: "Herr", first_name: "Peter", last_name: "Hansen", street: "Probeweg 7", postal_code: "79100", city: "Freiburg", phone: "+49 761 0000020", email: "peter.hansen@example.com",
    ...Object.fromEntries(Object.entries({ pv_dachart: "Satteldach", pv_hausart: "Ein-/Zweifamilienhaus", pv_gebaeudetyp: "Freistehendes", pv_stromspeicher: "Ja", pv_stromverbrauch: "4000", pv_dachausrichtung: "Süd", pv_dach_aelter_als_30_jahre: "ja", pv_personen_im_haushalt: "3", wp_ist_neubau: "Nein", wp_gebaeudetyp: "Ein-/Zweifamilienhaus", wp_beheizte_flaeche: "101-140 qm", wp_aktuelles_heizsystem: "Erdgas", wp_installationszeitraum: "sofort", wp_bevorzugte_waermepumpe: "Luftwärmepumpe", wp_aktuelle_waermeverteilung: "heizkörper & Fußbodenheizung", wp_interesse_photovolatikanalge: "Ja" }).map(([key, value]) => [`custom_data.${key}`, value])) };

  it("PV-Lead mit Wärmepumpen-Fragen → ein Lead: PV mit Zusatzinteresse Wärmepumpe und den Feldern beider Produkte", () => {
    const { payload, products, missing } = wattfoxPayload(lead);
    expect(products).toEqual({ main: "pv", extra: "wp" }); expect(missing).toEqual([]);
    expect(payload).toMatchObject({ productId: 2, otherinterests: [20], childinterests: [6], implementation: "bis in 1 Monat", ph_artdesgebaeude: "Ein-/Zweifamilienhaus", ph_ausrichtungderflaeche: "Süd", ph_alterderflaeche: "25 bis 75 Jahre alt", ph_stromspeicher: "Ja", stromverbrauch: 4000, hz_gebaeudetyp: "Ein- / Zweifamilienhaus", hz_bisherigeheizung: ["Gasheizung"], hz_taetigkeit: "Austausch / Modernisierung", hz_groessederflaeche: 121, hz_personen: "3-4 Personen", wp_artderpumpe: "Luft-Wärmepumpe", wp_waermeabgabesystem: ["Heizkörper", "Fußbodenheizung"] });
    // derselbe Kunde als Wärmepumpen-Lead → Wärmepumpe mit Zusatzinteresse PV
    expect(wattfoxPayload({ ...lead, lead_type: "Wärmepumpe", lead_type_shortcode: "WP" }).products).toEqual({ main: "wp", extra: "pv" });
    // ohne jedes Zeichen für beides bleibt es ein Produkt
    expect(wattfoxPayload({ ...lead, "custom_data.wp_interesse_photovolatikanalge": "Nein" }).products).toEqual({ main: "pv", extra: null });
  });

  it("„Freistehendes“ zählt als Ein-/Zweifamilienhaus; nur Stromkosten im Monat → kein Stromverbrauch, die Kosten mit Einheit im Hinweisfeld", () => {
    const { payload } = wattfoxPayload({ ...lead, "custom_data.pv_hausart": "", "custom_data.pv_stromverbrauch": "", "custom_data.pv_monatliche_stromkosten": "120" });
    expect(payload.ph_artdesgebaeude).toBe("Ein-/Zweifamilienhaus"); expect(String(payload.notes)).toContain("Gebäude laut Gespräch: Freistehendes");
    expect(payload.stromverbrauch).toBeUndefined(); expect(String(payload.notes)).toContain("Monatliche Stromkosten: 120 € im Monat"); // als Zahl hielte Wattfox 120 für kWh
  });
});

describe("Stromverbrauch als Zahl (v362)", () => {
  // Testumgebung von Wattfox am 25.11.: „4034: stromverbrauch: 4.000 - 6.000 kWh is not a valid digit“ – die Beschreibung sagt „String“, geprüft wird auf Ziffern
  it("unsere Stufen → Mitte, „Über …“ → die Zahl, nur eine Zahl → genau diese; der genaue Wert steht im Hinweisfeld", () => {
    expect(["0 - 3.000 kWh", "3.000 - 4.000 kWh", "4.000 - 6.000 kWh", "Über 6.000 kWh"].map(wattfoxConsumption)).toEqual([{ value: 1500, exact: false }, { value: 3500, exact: false }, { value: 5000, exact: false }, { value: 6000, exact: false }]);
    expect(wattfoxConsumption("4500")).toEqual({ value: 4500, exact: true }); expect(wattfoxConsumption("4.500 kWh")).toEqual({ value: 4500, exact: true }); expect(wattfoxConsumption("4000 kWh im Jahr")).toEqual({ value: 4000, exact: true });
    expect(wattfoxConsumption("ca. 4000")).toEqual({ value: 4000, exact: false }); expect(wattfoxConsumption("3,5 - 4,5")).toEqual({ value: 4, exact: false });
    expect(wattfoxConsumption("weiß nicht")).toBeNull(); expect(wattfoxConsumption("")).toBeNull(); expect(wattfoxConsumption(null)).toBeNull();
    const { payload } = wattfoxPayload(byLabel("PV 1"));
    expect(payload.stromverbrauch).toBe(5000); expect(String(payload.notes)).toContain("Stromverbrauch laut Gespräch: 4.000 - 6.000 kWh");
    const unknown = wattfoxPayload({ ...byLabel("PV 1"), "custom_data.stromverbrauch": "weiß nicht" }).payload;
    expect(unknown.stromverbrauch).toBeUndefined(); expect(String(unknown.notes)).toContain("Stromverbrauch laut Gespräch: weiß nicht");
  });

  it("alle Testleads: Zahlenfelder sind ganze Zahlen (so nimmt die Testumgebung von Wattfox sie an)", () => {
    for (const test of tests) {
      const { payload } = wattfoxPayload(test.values);
      for (const key of ["productId", "stromverbrauch", "hz_groessederflaeche", "hz_baujahrgebaeude"]) if (key in payload) expect(Number.isInteger(payload[key]), `${test.label}: ${key} = ${String(payload[key])}`).toBe(true);
    }
  });
});
