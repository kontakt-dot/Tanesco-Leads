import { describe, expect, it } from "vitest";
import { API_ERROR_GUIDE, API_ERROR_KIND_LABEL, buildApiErrorOverview, emailProblem, explainApiError, explainNoBuyer, fieldFromError, hostOf, isValidEmail, leadDataProblems, noBuyerReasons, phoneProblem, plainReason, postcodeProblem, suggestEmail, type ApiEventRow, type ApiLeadRow } from "../shared/api-errors";

describe("API-Fehler – Angaben eines Leads prüfen", () => {
  it("erkennt falsche E-Mail-Adressen und sagt in einem Satz, was nicht stimmt", () => {
    expect(emailProblem("p.hansen@.de")).toBe("Nach dem @ fehlt der Name des Anbieters (zum Beispiel gmx.de).");
    expect(emailProblem("p.hansen.example.de")).toBe("Es fehlt das @-Zeichen.");
    expect(emailProblem("p@hansen@example.de")).toBe("Die Adresse enthält mehr als ein @-Zeichen.");
    expect(emailProblem("@example.de")).toBe("Vor dem @ fehlt der Name.");
    expect(emailProblem("p.hansen@")).toBe("Nach dem @ fehlt die Adresse des Anbieters (zum Beispiel gmx.de).");
    expect(emailProblem("p.hansen@example")).toBe("Nach dem @ fehlt die Endung (zum Beispiel .de).");
    expect(emailProblem("p.hansen@example.de.")).toBe("Die Adresse endet mit einem Punkt.");
    expect(emailProblem("p..hansen@example.de")).toBe("In der Adresse stehen zwei Punkte hintereinander.");
    expect(emailProblem("p hansen@example.de")).toBe("Die Adresse enthält ein Leerzeichen.");
    expect(emailProblem(".hansen@example.de")).toBe("Vor dem @ steht ein Punkt an der falschen Stelle.");
    expect(emailProblem("p(hansen)@example.de")).toBe("Vor dem @ steht ein Zeichen, das nicht erlaubt ist.");
    expect(emailProblem("p.hansen@exa_mple.de")).toBe("Nach dem @ steht ein Zeichen, das nicht erlaubt ist.");
    expect(emailProblem("p.hansen@-example.de")).toBe("Nach dem @ steht ein Zeichen, das nicht erlaubt ist.");
    expect(emailProblem("p.hansen@example.d")).toBe("Die Endung nach dem letzten Punkt stimmt nicht (zum Beispiel .de oder .com).");
    expect(emailProblem("p.hansen@example.123")).toBe("Die Endung nach dem letzten Punkt stimmt nicht (zum Beispiel .de oder .com).");
    for (const fine of ["p.hansen@example.de", "Anna.Muster+leads@mail.firma-nord.co.uk", "a_b-c@x1.io", "  p.hansen@example.de  "]) expect(emailProblem(fine)).toBeNull();
    expect(emailProblem("")).toBeNull(); expect(emailProblem(null)).toBeNull(); // leer ist kein Formfehler
    expect(isValidEmail("p.hansen@example.de")).toBe(true); expect(isValidEmail("p.hansen@.de")).toBe(false); expect(isValidEmail("")).toBe(false);
  });

  it("schlägt für offensichtliche Tippfehler die richtige Adresse vor – sonst nichts", () => {
    expect(suggestEmail("anna.muster@gmial.com")).toBe("anna.muster@gmail.com");
    expect(suggestEmail("anna.muster@web,de")).toBe("anna.muster@web.de");
    expect(suggestEmail("anna muster@gmx.d")).toBe("annamuster@gmx.de");
    expect(suggestEmail("anna.muster@@t-online.de.")).toBe("anna.muster@t-online.de");
    expect(suggestEmail("anna.muster(at)web.de")).toBe("anna.muster@web.de");
    expect(suggestEmail("anna.muster@Hotmail.con")).toBe("anna.muster@hotmail.com");
    expect(suggestEmail("p.hansen@.de")).toBeNull(); // hier lässt sich nichts raten
    expect(suggestEmail("p.hansen@example.de")).toBeNull(); expect(suggestEmail("")).toBeNull();
  });

  it("prüft Rufnummer und PLZ", () => {
    expect(phoneProblem("+49 151 12340071")).toBeNull(); expect(phoneProblem("0151/1234-0071")).toBeNull(); expect(phoneProblem("")).toBeNull();
    expect(phoneProblem("12345")).toBe("Die Rufnummer ist zu kurz."); expect(phoneProblem("+49 151 1234 0071 9999 000")).toBe("Die Rufnummer ist zu lang.");
    expect(phoneProblem("0151 abc 123456")).toBe("Die Rufnummer enthält Buchstaben."); expect(phoneProblem("0000000000")).toBe("Die Rufnummer besteht nur aus derselben Ziffer.");
    expect(postcodeProblem("48249", "DE")).toBeNull(); expect(postcodeProblem("4824", "DE")).toBe("Eine deutsche PLZ hat 5 Ziffern."); expect(postcodeProblem("D-48249", null)).toBe("Eine deutsche PLZ hat 5 Ziffern.");
    expect(postcodeProblem("8001", "CH")).toBeNull(); expect(postcodeProblem("80010", "CH")).toBe("Eine PLZ in der Schweiz hat 4 Ziffern."); expect(postcodeProblem("1010", "AT")).toBeNull(); expect(postcodeProblem("101", "AT")).toBe("Eine PLZ in Österreich hat 4 Ziffern.");
    expect(postcodeProblem("SW1A 1AA", "GB")).toBeNull(); expect(postcodeProblem("", "DE")).toBeNull(); // andere Länder und leere Felder werden nicht bemängelt
  });

  it("sammelt, was ein Empfänger an einem Lead sehr wahrscheinlich ablehnt", () => {
    expect(leadDataProblems({ email: "p.hansen@example.de", phone: "+4915112340071", postcode: "48249", country: "DE" })).toEqual([]);
    expect(leadDataProblems({ email: "p.hansen@.de", phone: "+4915112340071", postcode: "48249", country: "DE" })).toEqual([{ field: "email", title: "Die E-Mail-Adresse ist nicht gültig.", hint: "Nach dem @ fehlt der Name des Anbieters (zum Beispiel gmx.de).", suggestion: null }]);
    expect(leadDataProblems({ email: "anna@gmial,com", phone: "123", postcode: "482", country: "DE" }).map((problem) => [problem.field, problem.suggestion ?? null])).toEqual([["email", "anna@gmail.com"], ["phone", null], ["postcode", null]]);
    expect(leadDataProblems({ email: "anna@gmial.com", phone: "+4915112340071" })).toEqual([]); // der Form nach gültig – ein Dreher im Anbieter allein gilt nicht als Fehler
    expect(leadDataProblems({ email: "", phone: null, postcode: "48249", country: "DE" })).toEqual([{ field: "phone", title: "Weder Rufnummer noch E-Mail-Adresse.", hint: "Ohne Kontaktweg kann kein Käufer den Kunden erreichen." }]);
    expect(leadDataProblems({ email: "<UNKNOWN>", phone: "+4915112340071", postcode: "unbekannt" })).toEqual([]); // Platzhalter sind leer, kein Formfehler
    expect(leadDataProblems({ email: null, phone: "+4915112340071" })).toEqual([]); // eine fehlende E-Mail ist kein Fehler, solange es eine Rufnummer gibt
  });
});

describe("API-Fehler – Antwort des Empfängers in einfachen Worten", () => {
  it("findet das gemeinte Feld im Text der Antwort", () => {
    expect(fieldFromError('{"errors":{"email":["is invalid"]}}')).toBe("email"); expect(fieldFromError("Ungültige E-Mail-Adresse")).toBe("email");
    expect(fieldFromError("Invalid phone number")).toBe("phone"); expect(fieldFromError("Telefon fehlt")).toBe("phone");
    expect(fieldFromError("zip_code is required")).toBe("postcode"); expect(fieldFromError("PLZ außerhalb des Gebiets")).toBe("postcode");
    expect(fieldFromError("first_name too long")).toBe("firstName"); expect(fieldFromError("Nachname fehlt")).toBe("lastName");
    expect(fieldFromError("street must not be empty")).toBe("street"); expect(fieldFromError("city unknown")).toBe("city");
    expect(fieldFromError("Internal error")).toBeNull(); expect(fieldFromError("")).toBeNull(); expect(fieldFromError(null)).toBeNull();
  });

  it("erklärt jeden Code: was passiert ist, was zu tun ist und wer es lösen kann", () => {
    expect(explainApiError({ status: 422, body: '{"error":"email invalid"}' })).toMatchObject({ kind: "daten", fix: "lead", field: "email", title: "Der Empfänger lehnt die Angabe „E-Mail-Adresse“ ab." });
    expect(explainApiError({ status: 400, body: "Bad Request" })).toMatchObject({ kind: "abgelehnt", fix: "lead", field: null });
    expect(explainApiError({ status: 401, body: "Unauthorized" })).toMatchObject({ kind: "zugang", fix: "schnittstelle" }); expect(explainApiError({ status: 403 })).toMatchObject({ kind: "zugang" });
    expect(explainApiError({ status: 402 })).toMatchObject({ kind: "zugang", title: "Das Konto beim Empfänger ist gesperrt oder ohne Guthaben." });
    expect(explainApiError({ status: 404 })).toMatchObject({ kind: "adresse", fix: "schnittstelle" }); expect(explainApiError({ status: 405 })).toMatchObject({ kind: "adresse" }); expect(explainApiError({ status: 301 })).toMatchObject({ kind: "adresse" });
    expect(explainApiError({ status: 409, body: "Conflict" })).toMatchObject({ kind: "dublette", fix: "keine" }); expect(explainApiError({ status: 422, body: "Lead already exists" })).toMatchObject({ kind: "dublette" }); expect(explainApiError({ status: 400, body: "Kontakt bereits vorhanden" })).toMatchObject({ kind: "dublette" });
    expect(explainApiError({ status: 413 })).toMatchObject({ kind: "abgelehnt", title: "Zu viele Daten für den Empfänger." });
    expect(explainApiError({ status: 429 })).toMatchObject({ kind: "limit", fix: "warten" });
    for (const status of [500, 502, 503]) expect(explainApiError({ status })).toMatchObject({ kind: "stoerung", fix: "warten" });
    for (const status of [408, 504]) expect(explainApiError({ status })).toMatchObject({ kind: "zeit", fix: "warten" });
    expect(explainApiError({ status: 200, body: '{"success":false,"reason":"phone invalid"}' })).toMatchObject({ kind: "daten", field: "phone", fix: "lead" }); // „angekommen“, aber abgelehnt: der Grund steht im Text
    expect(explainApiError({ status: 200, body: '{"success":false}' })).toMatchObject({ kind: "abgelehnt", field: null, title: "Der Empfänger hat geantwortet, den Lead aber nicht angenommen." });
    expect(explainApiError({ status: 418 })).toMatchObject({ kind: "unbekannt" });
  });

  it("unterscheidet, warum der Empfänger ablehnt: Gebiet, Sperrliste, kein Platz, Angabe fehlt", () => {
    expect(explainApiError({ status: 422, body: '{"error":"postal_code_not_serviceable"}' })).toMatchObject({ kind: "abgelehnt", fix: "lieferkette", field: null, title: "Der Empfänger nimmt keine Leads aus diesem Gebiet." }); // die PLZ ist richtig – nur nicht sein Gebiet
    expect(explainApiError({ status: 400, body: "PLZ liegt außerhalb des Liefergebiets" })).toMatchObject({ fix: "lieferkette" }); expect(explainApiError({ status: 200, body: '{"accepted":false,"reason":"out_of_area"}' })).toMatchObject({ fix: "lieferkette" });
    expect(explainApiError({ status: 422, body: "value outside allowed range for roof_size" })).toMatchObject({ kind: "abgelehnt", fix: "lead" }); // „outside“ allein heißt nicht „Gebiet“
    expect(explainApiError({ status: 422, body: '{"code":6,"message":"email on blacklist"}' })).toMatchObject({ kind: "abgelehnt", fix: "keine", title: "Der Empfänger hat diesen Kontakt gesperrt." });
    expect(explainApiError({ status: 422, body: '{"code":4,"message":"no partner available"}' })).toMatchObject({ kind: "abgelehnt", fix: "warten", title: "Der Empfänger hat gerade keinen Platz für diesen Lead." }); expect(explainApiError({ status: 400, body: "Tageskontingent ausgeschöpft" })).toMatchObject({ fix: "warten" });
    expect(explainApiError({ status: 422, body: '{"errors":{"phone":["is required"]}}' })).toMatchObject({ kind: "daten", field: "phone", title: "Dem Empfänger fehlt die Angabe „Rufnummer“." });
    expect(explainApiError({ status: 400, body: "Vorname fehlt" })).toMatchObject({ kind: "daten", field: "firstName", title: "Dem Empfänger fehlt die Angabe „Vorname“." });
  });

  it("erklärt Fehler ohne Antwort: Zeit abgelaufen, Adresse gibt es nicht, Zertifikat, keine Verbindung, nicht eingerichtet", () => {
    expect(explainApiError({ body: "The operation was aborted due to timeout" })).toMatchObject({ kind: "zeit", fix: "warten" });
    expect(explainApiError({ status: null, body: "getaddrinfo ENOTFOUND api.kunde.example" })).toMatchObject({ kind: "adresse", fix: "schnittstelle" });
    expect(explainApiError({ body: "certificate has expired" })).toMatchObject({ kind: "verbindung", fix: "schnittstelle" });
    expect(explainApiError({ body: "fetch failed" })).toMatchObject({ kind: "verbindung", fix: "warten" }); expect(explainApiError({})).toMatchObject({ kind: "verbindung" });
    expect(explainApiError({ body: "Für diese Integration fehlt ein Zugangsschlüssel." })).toMatchObject({ kind: "einrichtung", fix: "schnittstelle", advice: "Für diese Integration fehlt ein Zugangsschlüssel." });
    expect(explainApiError({ body: "Die Integration ist nicht aktiv." })).toMatchObject({ kind: "einrichtung" }); expect(explainApiError({ body: "Für diese aktive Partnerintegration ist keine Exportadresse hinterlegt." })).toMatchObject({ kind: "einrichtung" });
  });

  it("liest Vermerke „ohne Abnehmer“: Art des Problems und der Grund je Käufer oder Kette", () => {
    expect(explainNoBuyer("Auslieferung nicht möglich: Keine aktive Lieferkette mit Stop für diese Lead-Kategorie verfügbar.")).toMatchObject({ kind: "einrichtung", fix: "lieferkette" });
    expect(explainNoBuyer("Auslieferung nicht möglich: Keine aktive Lieferkette mit Stop für diese Lead-Kategorie verfügbar (Kette Nord: Tageshöchstgrenze erreicht).")).toMatchObject({ kind: "kein_abnehmer", title: "Keine Lieferkette kann den Lead gerade annehmen." });
    expect(explainNoBuyer("Auslieferung an Bestellung ORD-1 nach 3 Versuchen aufgegeben – bitte manuell prüfen.")).toMatchObject({ kind: "kein_abnehmer", title: "Nach mehreren Versuchen aufgegeben." });
    expect(explainNoBuyer("Auslieferung nicht möglich: Die zugeordnete Bestellung kann den Lead gerade nicht annehmen (Kette A: Bestellung ORD-1 ist pausiert).")).toMatchObject({ title: "Die zugeordnete Kette kann den Lead gerade nicht annehmen." });
    expect(explainNoBuyer("Auslieferung ohne Abnehmer: Solar Nord: Dublette")).toMatchObject({ kind: "kein_abnehmer", title: "Kein Käufer hat den Lead genommen." });
    expect(noBuyerReasons('Auslieferung ohne Abnehmer: Solar Nord: Dublette: Kontakt liegt bereits bei diesem Käufer; Aurora Home: API-Calls (a.example/x: HTTP 500; b.example/y: HTTP 200) hat abgelehnt (HTTP 500: {"error":"down; retry"})')).toEqual([
      { who: "Solar Nord", why: "Er hat diesen Kontakt schon bekommen" },
      { who: "Aurora Home", why: "Beim Empfänger gibt es gerade eine Störung (Antwort 500)" }, // „;“ in Klammern trennt nicht – und die Antwort steht in einfachen Worten da
    ]);
    expect(noBuyerReasons("Auslieferung nicht möglich: Keine aktive Lieferkette mit Stop für diese Lead-Kategorie verfügbar (Kette Nord: Tageshöchstgrenze erreicht; Kette Süd: Lieferant nicht in dieser Kette freigegeben).")).toEqual([{ who: "Kette Nord", why: "Die Tagesgrenze der Kette ist erreicht" }, { who: "Kette Süd", why: "Die Kette nimmt keine Leads von diesem Lieferanten" }]);
    expect(noBuyerReasons("Auslieferung nicht möglich: Keine aktive Lieferkette mit Stop für diese Lead-Kategorie verfügbar.")).toEqual([]);
    expect(noBuyerReasons("Auslieferung an Bestellung ORD-1 nach 3 Versuchen aufgegeben – bitte manuell prüfen.")).toEqual([]);
    expect(noBuyerReasons("Auslieferung ohne Abnehmer: kein passender Stop")).toEqual([{ who: "", why: "Kein Kunde der Kette passt zu diesem Lead" }]);
    // der Name einer Kette enthält oft selbst einen Doppelpunkt – getrennt wird dort, wo der Grund beginnt
    expect(noBuyerReasons("Auslieferung nicht möglich: Keine aktive Lieferkette mit Stop für diese Lead-Kategorie verfügbar (Photovoltaik: OnDialer → Solar Nord: Kette nur für Land AT; PV: Rest: Lieferant nicht in dieser Kette freigegeben).")).toEqual([{ who: "Photovoltaik: OnDialer → Solar Nord", why: "Die Kette nimmt nur Leads aus AT" }, { who: "PV: Rest", why: "Die Kette nimmt keine Leads von diesem Lieferanten" }]);
    expect(noBuyerReasons("Auslieferung ohne Abnehmer: Solar Nord: Partner West hat abgelehnt (HTTP 401); Aurora Home: Geo-Targeting: PLZ passt nicht; Haus & Dach: ein ganz eigener Grund: mit Doppelpunkt")).toEqual([{ who: "Solar Nord", why: "Der Empfänger lässt uns nicht hinein (Antwort 401)" }, { who: "Aurora Home", why: "Die PLZ liegt nicht in seinem Gebiet" }, { who: "Haus & Dach", why: "ein ganz eigener Grund: mit Doppelpunkt" }]);
  });

  it("macht aus den Stichworten des Protokolls ganze Sätze – unbekannte Texte bleiben, wie sie sind", () => {
    const plain: Array<[string, string]> = [
      ["Geo-Targeting: PLZ passt nicht", "Die PLZ liegt nicht in seinem Gebiet"], ["Geo-Targeting: Bundesland passt nicht", "Das Bundesland gehört nicht zu seinem Gebiet"], ["Geo-Targeting: nur AT", "Er nimmt nur Leads aus AT"],
      ["Maximale Leads für diesen Käufer erreicht", "Seine Höchstzahl an Leads ist erreicht"], ["Feld-Filter: heizungsart", "Das Feld „heizungsart“ passt nicht zu seinem Filter"], ["Lieferant für diesen Stop ausgeschlossen", "Er nimmt keine Leads von diesem Lieferanten"],
      ["Konflikt-Käufer: Kontakt liegt bereits bei einem ausgeschlossenen Käufer", "Der Kontakt liegt schon bei einem Käufer, den er ausschließt"], ["Automation-Duplikat ausgeschlossen", "Er nimmt keine Leads, die eine Regel kopiert hat"],
      ["Telefonfilter: Nummer ungültig", "Die Rufnummer ist ungültig"], ["Telefonfilter: Nummer nicht bestätigt gültig", "Die Rufnummer ist nicht als gültig bestätigt"], ["Lead zu alt für diesen Stop", "Der Lead ist ihm zu alt"],
      ["Dublette: Kontakt liegt bereits bei diesem Käufer", "Er hat diesen Kontakt schon bekommen"], ["Dublettenschutz: Kontakt wurde bereits an diesen Käufer geliefert", "Er hat diesen Kontakt schon bekommen"],
      ["Lieferkette hat keinen aktiven Stop", "Die Kette hat keinen eingeschalteten Kunden"], ["Kette nur für Land DE", "Die Kette nimmt nur Leads aus DE"], ["Lieferant für diese Kette ausgeschlossen", "Die Kette nimmt keine Leads von diesem Lieferanten"], ["Maximale Leads insgesamt erreicht", "Die Höchstzahl der Kette ist erreicht"],
      ["Käufer-Zugang ist nicht aktiv", "Sein Zugang ist nicht eingeschaltet"], ["Auslieferung für diesen Käufer pausiert", "Die Auslieferung an ihn ist pausiert"], ["Käufer ist gesperrt (Zahlungsmodus)", "Er ist gesperrt"], ["Lead-Kategorie für diesen Käufer deaktiviert", "Diese Kategorie ist für ihn ausgeschaltet"],
      ['API-Call (crm.kunde.example/api: HTTP 422) hat abgelehnt (HTTP 422: {"errors":{"email":["is invalid"]}})', "Der Empfänger lehnt die Angabe „E-Mail-Adresse“ ab (Antwort 422)"], ["Partner West hat abgelehnt (HTTP 401)", "Der Empfänger lässt uns nicht hinein (Antwort 401)"], ["Partner West hat abgelehnt (HTTP –: fetch failed)", "Keine Verbindung zum Empfänger"],
      ["abgelehnt", "Hat den Lead nicht genommen"], ["Bestellung ORD-1 ist pausiert", "Bestellung ORD-1 ist pausiert"], ["Etwas ganz anderes", "Etwas ganz anderes"],
    ];
    for (const [raw, expected] of plain) expect(plainReason(raw)).toBe(expected);
  });

  it("hat für jede Art von Fehler einen Namen und einen Eintrag zum Nachschlagen", () => {
    const kinds = Object.keys(API_ERROR_KIND_LABEL).filter((kind) => kind !== "unbekannt");
    expect(API_ERROR_GUIDE.map((row) => row.kind).sort()).toEqual(kinds.sort());
    expect(API_ERROR_GUIDE.every((row) => row.what.length > 20 && row.todo.length > 10)).toBe(true);
    expect(hostOf("https://api.kunde.example/v1/leads?x=1")).toBe("api.kunde.example"); expect(hostOf("kein link")).toBe("kein link"); expect(hostOf(null)).toBeNull();
  });
});

describe("API-Fehler – Übersicht", () => {
  const now = new Date("2026-11-21T12:00:00Z"); const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const lead = (id: number, values: Partial<ApiLeadRow> = {}): ApiLeadRow => ({ id, publicId: `L${id}`, firstName: "Vor", lastName: `Nach${id}`, email: `lead${id}@example.de`, phone: "+4915112340071", postcode: "48249", city: "Dülmen", country: "DE", status: "genehmigt", categoryId: 1, supplierName: "OnDialer", metadata: {}, createdAt: ago(600), ...values });
  let eventId = 0;
  const event = (values: Partial<ApiEventRow>): ApiEventRow => ({ id: (eventId += 1), leadId: null, integrationId: null, endpointId: null, eventType: "abgelehnt", responseStatus: null, responseBody: null, externalReference: null, occurredAt: ago(60), ...values });
  const base = { now, days: 30, categories: [{ id: 1, name: "Photovoltaik" }], endpoints: [{ id: 10, url: "https://crm.solar-nord.example/api/leads", enabled: true, buyerName: "Solar Nord", categoryName: "Photovoltaik", membershipId: 77 }, { id: 11, url: "https://alt.example/api", enabled: false, buyerName: "Alt", categoryName: null, membershipId: 78 }], integrations: [{ id: 20, name: "Partner West", status: "aktiv", callbackUrl: "https://partner-west.example/hook" }, { id: 21, name: "Aus", status: "inaktiv", callbackUrl: null }] };

  it("zeigt je Lead das offene Problem – mit Empfänger, Feld, Antwort und Zahl der Versuche; Erledigtes steht getrennt", () => {
    const overview = buildApiErrorOverview({
      ...base,
      leads: [
        lead(1, { email: "p.hansen@.de" }), // Empfänger lehnt die E-Mail ab
        lead(2, { status: "zugewiesen" }), // scheiterte, kam danach an → erledigt
        lead(3), // kein Abnehmer
        lead(4, { status: "neu", email: "anna@gmial,com" }), // noch nicht versucht, aber die Adresse stimmt nicht
        lead(5, { status: "neu", email: "kaputt@", metadata: { apiErrorsDismissedAt: ago(30).toISOString() } }), // abgehakt
        lead(6, { status: "hängend", metadata: { apiErrorsDismissedAt: ago(90).toISOString(), street: "Lindenweg 14" } }), // abgehakt, danach wieder gescheitert
        lead(7, { status: "deaktiviert" }), // nicht mehr im Spiel
        lead(8), // alles gut
      ],
      events: [
        event({ leadId: 1, endpointId: 10, responseStatus: 422, responseBody: '{"errors":{"email":["is invalid"]}}', occurredAt: ago(50) }),
        event({ leadId: 1, endpointId: 10, responseStatus: 422, responseBody: '{"errors":{"email":["is invalid"]}}', occurredAt: ago(20) }),
        event({ leadId: 2, integrationId: 20, responseStatus: 503, responseBody: "Service Unavailable", occurredAt: ago(300) }),
        event({ leadId: 2, integrationId: 20, eventType: "geliefert", responseStatus: 200, occurredAt: ago(200) }),
        event({ leadId: 6, integrationId: 20, responseStatus: 401, responseBody: "Unauthorized", occurredAt: ago(120) }), // vor dem Abhaken
        event({ leadId: 6, integrationId: 20, responseStatus: 401, responseBody: "Unauthorized", occurredAt: ago(10) }), // danach
        event({ leadId: 7, endpointId: 10, responseStatus: 500, occurredAt: ago(40) }),
        event({ integrationId: 20, externalReference: "healthcheck", eventType: "offen", responseStatus: 204, responseBody: "Endpunkt erreichbar · HTTP 204", occurredAt: ago(5) }),
        event({ leadId: 3, externalReference: "Rückgabe/L3", responseStatus: 500, responseBody: "down", occurredAt: ago(44) }),
      ],
      deliveries: [{ leadId: 2, buyerName: "Partner West", result: "angenommen", occurredAt: ago(200) }, { leadId: 1, buyerName: "Solar Nord", result: "abgelehnt", occurredAt: ago(20) }],
      notes: [{ leadId: 3, note: "Auslieferung ohne Abnehmer: Solar Nord: Geo-Targeting: PLZ passt nicht; Aurora Home: Maximale Leads für diesen Käufer erreicht", occurredAt: ago(45) }],
    });
    expect(overview.problems.map((problem) => problem.publicId)).toEqual(["L6", "L1", "L3", "L4"]); // neueste zuerst; L5 abgehakt, L7 deaktiviert, L8 ohne Problem
    const [six, one, three, four] = overview.problems;
    expect(one).toMatchObject({ kind: "daten", fix: "lead", field: "email", target: "Solar Nord", targetLink: { kind: "kaeufer", membershipId: 77 }, httpStatus: 422, attempts: 2, categoryName: "Photovoltaik", name: "Vor Nach1", status: "genehmigt" });
    expect(one.detail).toContain("is invalid"); expect(one.dataProblems.map((problem) => problem.field)).toEqual(["email"]); expect(one.lead).toMatchObject({ email: "p.hansen@.de", postcode: "48249", country: "DE" }); expect(one.reasons).toHaveLength(2);
    expect(six).toMatchObject({ kind: "zugang", fix: "schnittstelle", target: "Partner West", targetLink: { kind: "integration" }, attempts: 1, httpStatus: 401 }); expect(six.lead.street).toBe("Lindenweg 14"); // nur der Fehler nach dem Abhaken zählt
    expect(three).toMatchObject({ kind: "kein_abnehmer", fix: "lieferkette", target: null, httpStatus: null, attempts: 1 }); expect(three.parts).toEqual([{ who: "Solar Nord", why: "Die PLZ liegt nicht in seinem Gebiet" }, { who: "Aurora Home", why: "Seine Höchstzahl an Leads ist erreicht" }]); expect(three.reasons[0].parts).toEqual(three.parts); expect(one.parts).toEqual([]);
    expect(four).toMatchObject({ kind: "daten", fix: "lead", field: "email", attempts: 0, title: "Die E-Mail-Adresse ist nicht gültig." }); expect(four.dataProblems[0].suggestion).toBe("anna@gmail.com"); expect(four.reasons).toEqual([]);
    expect(overview.resolved).toEqual([expect.objectContaining({ publicId: "L2", buyerName: "Partner West", title: "Beim Empfänger gibt es gerade eine Störung." })]);
    expect(overview.counts).toMatchObject({ open: 4, daten: 2, keinAbnehmer: 1, empfaenger: 1, byKind: { daten: 2, zugang: 1, kein_abnehmer: 1 } });
  });

  it("ein Käufer lehnt ab, der nächste nimmt: kein Problem und nichts „Gelöstes“ – auch nicht, wenn der Lead später reklamiert wird; ein gescheiterter Durchlauf (Vermerk) zählt immer", () => {
    const sec = (seconds: number) => new Date(now.getTime() - seconds * 1000);
    const overview = buildApiErrorOverview({
      ...base,
      leads: [
        lead(1, { status: "zugewiesen" }), // derselbe Durchlauf: Solar Nord lehnt ab, Partner West nimmt zwei Sekunden später
        lead(2, { status: "reklamiert" }), // Solar Nord lehnte ab, ein Käufer ohne Schnittstelle nahm – später reklamiert, nicht weitergegeben
        lead(3, { status: "reklamiert" }), // ohne Schnittstelle zugestellt, reklamiert, 80 Sekunden später weitergegeben: niemand nahm ihn → offen
        lead(4, { status: "zugewiesen" }), // erst keine Lieferkette (Vermerk), eine Stunde später zugestellt → gelöst, auch ohne Antwort eines Empfängers
        lead(5, { status: "zugewiesen" }), // gestern gescheitert (Antwort 503 + Vermerk), heute angekommen → gelöst, der Grund ist die Antwort
        lead(6, { status: "reklamiert" }), // dieselbe Sekunde: erst angekommen, dann lehnt ein zweiter Käufer ab (Verkaufsziel 2) – später reklamiert
      ],
      events: [
        event({ leadId: 1, endpointId: 10, responseStatus: 422, responseBody: '{"errors":{"email":["is invalid"]}}', occurredAt: sec(3600) }), event({ leadId: 1, integrationId: 20, eventType: "geliefert", responseStatus: 200, occurredAt: sec(3598) }),
        event({ leadId: 2, endpointId: 10, responseStatus: 422, responseBody: "nope", occurredAt: sec(7198) }),
        event({ leadId: 3, endpointId: 10, responseStatus: 503, responseBody: "Service Unavailable", occurredAt: sec(620) }),
        event({ leadId: 5, endpointId: 10, responseStatus: 503, responseBody: "Service Unavailable", occurredAt: ago(1500) }), event({ leadId: 5, endpointId: 10, eventType: "geliefert", responseStatus: 200, occurredAt: ago(30) }),
        event({ leadId: 6, integrationId: 20, eventType: "geliefert", responseStatus: 200, occurredAt: sec(5000) }), event({ leadId: 6, endpointId: 10, responseStatus: 422, responseBody: "nope", occurredAt: sec(5000) }),
      ],
      deliveries: [
        { leadId: 1, buyerName: "Solar Nord", result: "abgelehnt", occurredAt: sec(3601) }, { leadId: 1, buyerName: "Partner West", result: "angenommen", occurredAt: sec(3601) },
        { leadId: 2, buyerName: "Solar Nord", result: "abgelehnt", occurredAt: sec(7200) }, { leadId: 2, buyerName: "Kunde Hand", result: "reklamiert", occurredAt: sec(7200) },
        { leadId: 3, buyerName: "Kunde Hand", result: "reklamiert", occurredAt: sec(700) }, { leadId: 3, buyerName: "Solar Nord", result: "abgelehnt", occurredAt: sec(621) },
        { leadId: 4, buyerName: "Kunde Hand", result: "angeboten", occurredAt: ago(60) },
        { leadId: 5, buyerName: "Solar Nord", result: "abgelehnt", occurredAt: ago(1500) }, { leadId: 5, buyerName: "Solar Nord", result: "angenommen", occurredAt: ago(30) },
        { leadId: 6, buyerName: "Partner West", result: "reklamiert", occurredAt: sec(5001) }, { leadId: 6, buyerName: "Solar Nord", result: "abgelehnt", occurredAt: sec(5001) },
      ],
      notes: [
        { leadId: 3, note: "Auslieferung ohne Abnehmer: Solar Nord: API-Call (crm.solar-nord.example/api/leads: HTTP 503) hat abgelehnt (HTTP 503: Service Unavailable)", occurredAt: sec(619) },
        { leadId: 4, note: "Auslieferung nicht möglich: Keine aktive Lieferkette mit Stop für diese Lead-Kategorie verfügbar.", occurredAt: ago(120) },
        { leadId: 5, note: "Auslieferung ohne Abnehmer: Solar Nord: API-Call (crm.solar-nord.example/api/leads: HTTP 503) hat abgelehnt (HTTP 503: Service Unavailable)", occurredAt: new Date(ago(1500).getTime() + 1000) },
      ],
    });
    expect(overview.problems.map((problem) => problem.publicId)).toEqual(["L3"]);
    expect(overview.problems[0]).toMatchObject({ kind: "stoerung", fix: "warten", target: "Solar Nord", httpStatus: 503, attempts: 1, status: "reklamiert" }); expect(overview.problems[0].reasons).toHaveLength(2); // die Antwort und der Vermerk des Durchlaufs
    expect(overview.resolved.map((row) => [row.publicId, row.title, row.buyerName, row.failedAt])).toEqual([
      ["L5", "Beim Empfänger gibt es gerade eine Störung.", "Solar Nord", ago(1500).toISOString()],
      ["L4", "Für diese Kategorie gibt es keine aktive Lieferkette.", "Kunde Hand", ago(120).toISOString()],
    ]);
    expect(overview.counts.open).toBe(1);
  });

  it("stimmen die Angaben nicht, zeigt die Zeile auf das Feld – auch wenn der Empfänger nur „abgelehnt“ sagt oder kein Käufer zugriff", () => {
    const overview = buildApiErrorOverview({
      ...base, deliveries: [],
      leads: [lead(1, { phone: "123" }), lead(2, { postcode: "482" }), lead(3, { email: "p.hansen@.de" })],
      events: [event({ leadId: 1, endpointId: 10, responseStatus: 400, responseBody: "Bad Request", occurredAt: ago(3) }), event({ leadId: 3, integrationId: 20, responseStatus: 401, occurredAt: ago(1) })],
      notes: [{ leadId: 2, note: "Auslieferung ohne Abnehmer: Solar Nord: abgelehnt", occurredAt: ago(2) }, { leadId: 1, note: "Auslieferung ohne Abnehmer: Solar Nord: API-Call hat abgelehnt (HTTP 400: Bad Request)", occurredAt: ago(3) }],
    });
    const byId = new Map(overview.problems.map((problem) => [problem.publicId, problem]));
    expect(byId.get("L1")).toMatchObject({ kind: "abgelehnt", fix: "lead", field: "phone", attempts: 1, target: "Solar Nord" }); // Antwort des Empfängers und Sammelvermerk „ohne Abnehmer“ sind ein Versuch – die Antwort führt
    expect(byId.get("L1")!.reasons).toHaveLength(2); expect(byId.get("L1")!.parts).toEqual([{ who: "Solar Nord", why: "Der Empfänger lehnt die Angaben des Leads ab (Antwort 400)" }]);
    expect(byId.get("L2")).toMatchObject({ kind: "kein_abnehmer", fix: "lead", field: "postcode" });
    expect(byId.get("L3")).toMatchObject({ kind: "zugang", fix: "schnittstelle", field: null }); // ein gesperrter Zugang liegt nicht am Lead – die falsche Adresse steht trotzdem dabei
    expect(byId.get("L3")!.dataProblems).toHaveLength(1);
  });

  it("API-Gesundheit: Zustand je Schnittstelle aus echten Übergaben und der letzten Probe", () => {
    const overview = buildApiErrorOverview({
      ...base, leads: [], deliveries: [], notes: [],
      endpoints: [...base.endpoints, { id: 12, url: "https://gut.example/api", enabled: true, buyerName: "Gut GmbH", categoryName: "Photovoltaik", membershipId: 79 }, { id: 13, url: "https://neu.example/api", enabled: true, buyerName: "Neu GmbH", categoryName: null, membershipId: 80 }, { id: 14, url: "https://wackel.example/api", enabled: true, buyerName: "Wackel AG", categoryName: null, membershipId: 81 }],
      events: [
        // Solar Nord: die letzten drei gescheitert → gestört
        event({ leadId: 1, endpointId: 10, eventType: "geliefert", responseStatus: 200, occurredAt: ago(500) }), event({ leadId: 2, endpointId: 10, responseStatus: 401, occurredAt: ago(30) }), event({ leadId: 3, endpointId: 10, responseStatus: 401, occurredAt: ago(20) }), event({ leadId: 4, endpointId: 10, responseStatus: 401, occurredAt: ago(10) }),
        // Gut GmbH: alles angekommen
        ...[1, 2, 3, 4, 5].map((id) => event({ leadId: id, endpointId: 12, eventType: "geliefert", responseStatus: 201, occurredAt: ago(id * 7) })),
        // Wackel AG: eine von fünf gescheitert, die letzte kam an → Warnung (20 %)
        ...[1, 2, 3, 4].map((id) => event({ leadId: id, endpointId: 14, eventType: "geliefert", responseStatus: 200, occurredAt: ago(id * 5) })), event({ leadId: 5, endpointId: 14, responseStatus: 500, occurredAt: ago(70) }),
        // Partner West: nur eine Probe, erreichbar
        event({ integrationId: 20, externalReference: "healthcheck", eventType: "offen", responseStatus: 204, responseBody: "Endpunkt erreichbar · HTTP 204", occurredAt: ago(5) }),
        // Rückmeldungen an Lieferanten
        event({ leadId: 9, externalReference: "Rückgabe/L9", eventType: "geliefert", responseStatus: 200, occurredAt: ago(15) }),
        // zu alt für den Zeitraum
        event({ leadId: 1, endpointId: 13, responseStatus: 500, occurredAt: ago(60 * 24 * 40) }),
      ],
    });
    const rows = new Map(overview.health.map((row) => [row.name, row]));
    expect(overview.health.map((row) => row.name)).toEqual(["Solar Nord", "Wackel AG", "Gut GmbH", "Rückmeldungen an Lieferanten", "Partner West", "Neu GmbH"]); // gestört zuerst, dann Warnung, gut (mehr Übergaben zuerst), unbekannt; „Alt“ (aus, ohne Übergaben) und „Aus“ fehlen
    expect(rows.get("Solar Nord")).toMatchObject({ state: "gestoert", sent: 4, failed: 3, rate: 25, host: "crm.solar-nord.example", kind: "kaeufer", membershipId: 77, lastError: { httpStatus: 401, title: "Der Empfänger lässt uns nicht hinein." } });
    expect(rows.get("Gut GmbH")).toMatchObject({ state: "gut", sent: 5, failed: 0, rate: 100, lastErrorAt: null, stateText: "Alle Übergaben angekommen" });
    expect(rows.get("Wackel AG")).toMatchObject({ state: "warnung", sent: 5, failed: 1, rate: 80 });
    expect(rows.get("Partner West")).toMatchObject({ state: "gut", sent: 0, rate: null, kind: "partner", lastCheck: { ok: true, text: "Endpunkt erreichbar · HTTP 204" }, stateText: "Erreichbar – noch keine Übergabe im Zeitraum" });
    expect(rows.get("Neu GmbH")).toMatchObject({ state: "unbekannt", sent: 0, lastCheck: null });
    expect(rows.get("Rückmeldungen an Lieferanten")).toMatchObject({ kind: "rueckgabe", state: "gut", sent: 1 });
    expect(overview.counts.schnittstellenGestoert).toBe(1);
    // eine gescheiterte Probe ohne echte Übergaben heißt „gestört“
    const down = buildApiErrorOverview({ ...base, leads: [], deliveries: [], notes: [], events: [event({ integrationId: 20, externalReference: "healthcheck", responseBody: "Endpunkt nicht erreichbar: fetch failed", occurredAt: ago(2) })] });
    expect(down.health.find((row) => row.name === "Partner West")).toMatchObject({ state: "gestoert", stateText: "Bei der letzten Probe nicht erreichbar", lastCheck: { ok: false } });
    // Lehnt der Empfänger einen Lead wegen seiner Angaben ab, hat die Schnittstelle geantwortet – das ist keine Störung
    const refusing = (events: Array<Partial<ApiEventRow>>) => buildApiErrorOverview({ ...base, leads: [], deliveries: [], notes: [], events: events.map((values, index) => event({ leadId: index + 1, endpointId: 10, occurredAt: ago(60 - index), ...values })) }).health.find((row) => row.name === "Solar Nord")!;
    const badMail = { responseStatus: 422, responseBody: '{"errors":{"email":["is invalid"]}}' }; const arrived = { eventType: "geliefert", responseStatus: 200 };
    expect(refusing([badMail])).toMatchObject({ state: "gut", stateText: "Erreichbar – ein Lead wurde abgelehnt", sent: 1, failed: 1, refused: 1, rate: 0 });
    expect(refusing([arrived, arrived, arrived, { responseStatus: 409, responseBody: "duplicate" }, badMail])).toMatchObject({ state: "gut", stateText: "Erreichbar – 2 Leads wurden abgelehnt", sent: 5, failed: 2, refused: 2, rate: 60 });
    expect(refusing([badMail, badMail, badMail])).toMatchObject({ state: "warnung", stateText: "Erreichbar – der Empfänger lehnt jeden Lead ab", refused: 3 }); // fast alles abgelehnt → meist stimmt die Zuordnung der Felder nicht
    expect(refusing([arrived, badMail, badMail, badMail])).toMatchObject({ state: "warnung", stateText: "Erreichbar – der Empfänger lehnt viele Leads ab" });
    // eine Absage nach einer Störung zeigt: Die Schnittstelle antwortet wieder
    expect(refusing([{ responseStatus: 503 }, badMail])).toMatchObject({ state: "warnung", stateText: "Viele Übergaben fehlgeschlagen – zuletzt hat der Empfänger wieder geantwortet", failed: 2, refused: 1 });
    expect(refusing([badMail, { responseStatus: 503 }])).toMatchObject({ state: "warnung", stateText: "Die letzte Übergabe ist fehlgeschlagen" });
    expect(refusing([{ responseStatus: 401 }, { responseStatus: null, responseBody: "fetch failed" }])).toMatchObject({ state: "gestoert", stateText: "Keine Übergabe ist angekommen", refused: 0 });
    // Übergaben in derselben Sekunde: Die Reihenfolge der Einträge entscheidet, welche die letzte war
    const sameSecond = (first: Partial<ApiEventRow>, second: Partial<ApiEventRow>) => buildApiErrorOverview({ ...base, leads: [], deliveries: [], notes: [], events: [event({ leadId: 1, endpointId: 10, occurredAt: ago(9), ...first }), event({ leadId: 2, endpointId: 10, occurredAt: ago(9), ...second })] }).health.find((row) => row.name === "Solar Nord")!;
    expect(sameSecond({ eventType: "geliefert", responseStatus: 200 }, { responseStatus: 500 })).toMatchObject({ state: "warnung", stateText: "Die letzte Übergabe ist fehlgeschlagen" });
    expect(sameSecond({ responseStatus: 500 }, { eventType: "geliefert", responseStatus: 200 })).toMatchObject({ state: "warnung", stateText: "Viele Übergaben fehlgeschlagen – die letzte kam an" });
  });
});
