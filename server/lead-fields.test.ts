import { describe, expect, it } from "vitest";
import { callAnswerList, cleanFieldValue, cleanFieldValues, extraMetaFields, fieldsFromTranscript, fieldsToRead, isPlaceholder, isTechnicalMeta, leadDisplayName, metaLabel, realText, tidySalutation, type LeadFieldDef } from "../shared/lead-fields";
import { cleanSpokenContact, contactFromTranscript, withSpokenContact } from "../shared/dialer-intake";
import { extractDialerContact } from "../shared/dialer-contact";
import { berlinDayBefore, claimRate, deliversByItself, emptyLeadCounts, emptyLeadsOverview, hintText, leadsOverview, overviewHints, OVERVIEW_DAYS, statusSplit, todayComparison, waitingAge, weekComparison } from "../shared/lead-overview";
import { BASE_EXPORT_COLUMNS, leadExportTable } from "../shared/lead-export";
import { matchesCallSearch, phoneFragment, searchWords } from "../shared/call-search";
import { AUTO_HIDE_ORDER, DEFAULT_HIDDEN, fitLeadColumns, LEAD_COLUMN_KEYS, leadGridTemplate, readHiddenColumns } from "../client/src/lib/leadColumns";
import { buildLeadAuditLog } from "./lead-audit-assembly";
import { purposeInfo } from "../shared/ai-usage";

const FIELDS: LeadFieldDef[] = [
  { fieldKey: "hausart", label: "Hausart", fieldType: "auswahl", options: ["Ein-/Zweifamilienhaus", "Mehrfamilienhaus", "Firmengebäude", "Sonstiges"] },
  { fieldKey: "dachart", label: "Dachart", fieldType: "auswahl", options: ["Satteldach", "Pultdach", "Flachdach"] },
  { fieldKey: "stromspeicher", label: "Stromspeicher", fieldType: "ja_nein" },
  { fieldKey: "dachflaeche", label: "Dachfläche", fieldType: "zahl" },
  { fieldKey: "termin", label: "Wunschtermin", fieldType: "datum" },
  { fieldKey: "erreichbarkeit", label: "Erreichbarkeit", fieldType: "text" },
  { fieldKey: "recording_1", label: "Recording", fieldType: "text" },
  { fieldKey: "ghl_id", label: "GHL ID", fieldType: "text" },
  { fieldKey: "lieferant", label: "Lieferant", fieldType: "text" },
  { fieldKey: "info", label: "Info", fieldType: "text" },
];

describe("Platzhalter sind keine Angabe", () => {
  it("erkennt Platzhalter der KI und aus Listen – echte Namen bleiben", () => {
    for (const value of ["<UNKNOWN>", "<UNKNOWN> <UNKNOWN>", "[unbekannt]", "unbekannt", "Unbekannt unbekannt", "nicht genannt", "Keine Angabe", "n/a", "N. A.", "k. A.", "null", "none", "-", "–", "???", "", "   "]) expect(isPlaceholder(value), value).toBe(true);
    for (const value of ["Oliver", "Leer", "Herr Bade", "Müller-Lüdenscheidt", "Na dann", "07546", "max@beispiel.de"]) expect(isPlaceholder(value), value).toBe(false);
    expect(realText("  Rings-Lebener-Straße   1 ")).toBe("Rings-Lebener-Straße 1"); expect(realText("<UNKNOWN>")).toBeNull(); expect(realText(42)).toBe("42");
  });
  it("macht aus der Antwort der KI einen sauberen Kontakt: kein „<UNKNOWN>“, „Herr“ ist die Anrede und kein Vorname", () => {
    expect(cleanSpokenContact({ firstName: "<UNKNOWN>", lastName: "<UNKNOWN>", city: "Westerkoppel", postcode: "", email: "unbekannt" })).toEqual({ firstName: null, lastName: null, street: null, postcode: null, city: "Westerkoppel", email: null });
    expect(cleanSpokenContact({ firstName: "Herr", lastName: "Bade", postcode: "16798" })).toMatchObject({ firstName: null, lastName: "Bade", salutation: "Herr", postcode: "16798" });
    expect(cleanSpokenContact({ firstName: "", lastName: "Frau Sommer" })).toMatchObject({ firstName: null, lastName: "Sommer", salutation: "Frau" });
    expect(cleanSpokenContact({ salutation: "Frau", firstName: "Petra", lastName: "Sommer", email: "Petra.Sommer@Beispiel.de" })).toMatchObject({ firstName: "Petra", lastName: "Sommer", salutation: "Frau", email: "petra.sommer@beispiel.de" });
    expect(tidySalutation("herrn")).toBe("Herr"); expect(tidySalutation("Fr.")).toBe("Frau"); expect(tidySalutation("Familie")).toBeNull();
  });
  it("liest ohne KI Namen samt Anrede aus dem Text und gibt die Anrede als Zusatzfeld an den Kontakt", () => {
    const spoken = contactFromTranscript("Guten Tag Frau Sommer, hier ist Max Reuter. Frau Sommer, Ihre Anschrift ist 07546 Gera?");
    expect(spoken).toMatchObject({ lastName: "Sommer", salutation: "Frau", postcode: "07546", city: "Gera" });
    const merged = withSpokenContact(extractDialerContact({ phone: "+4915112340072" }, {}), spoken);
    expect(merged).toMatchObject({ lastName: "Sommer", hasIdentity: true }); expect(merged.fields.anrede).toBe("Frau");
  });
  it("zeigt den Namen eines Leads: Vor- und Nachname, sonst Anrede und Nachname – nie einen Platzhalter", () => {
    expect(leadDisplayName({ firstName: "Martin", lastName: "Albrecht", metadata: { anrede: "Herr" } })).toBe("Martin Albrecht");
    expect(leadDisplayName({ firstName: null, lastName: "Bade", metadata: { anrede: "Herr" } })).toBe("Herr Bade");
    expect(leadDisplayName({ firstName: null, lastName: "Bade", metadata: null })).toBe("Bade");
    expect(leadDisplayName({ firstName: "<UNKNOWN>", lastName: "<UNKNOWN>" })).toBe("");
  });
});

describe("Felder der Lead-Kategorie aus dem Gespräch", () => {
  it("liest nur leere Felder, die jemand am Telefon sagt – Aufnahme-Link, fremde Nummern, Lieferant und Info bleiben außen vor", () => {
    expect(fieldsToRead(FIELDS, { dachart: "Satteldach", erreichbarkeit: "<UNKNOWN>" }).map((field) => field.fieldKey)).toEqual(["hausart", "stromspeicher", "dachflaeche", "termin", "erreichbarkeit"]);
    expect(fieldsToRead(FIELDS, null)).toHaveLength(6);
  });
  it("prüft jede Antwort gegen ihr Feld: Auswahl nur mit einer der Antworten, Ja/Nein, Zahl, Datum – Unpassendes bleibt leer", () => {
    const of = (key: string) => FIELDS.find((field) => field.fieldKey === key)!;
    expect(cleanFieldValue(of("hausart"), "ein-/zweifamilienhaus")).toBe("Ein-/Zweifamilienhaus");
    expect(cleanFieldValue(of("hausart"), "Mehrfamilienhaus mit 6 Parteien")).toBe("Mehrfamilienhaus");
    expect(cleanFieldValue(of("hausart"), "Reihenhaus")).toBeNull();
    expect(cleanFieldValue(of("stromspeicher"), "ja, auf jeden Fall")).toBe("Ja"); expect(cleanFieldValue(of("stromspeicher"), "Nein")).toBe("Nein"); expect(cleanFieldValue(of("stromspeicher"), "vielleicht")).toBeNull();
    expect(cleanFieldValue(of("dachflaeche"), "ca. 4.500 qm")).toBe("4500"); expect(cleanFieldValue(of("dachflaeche"), "3,5")).toBe("3.5"); expect(cleanFieldValue(of("dachflaeche"), "groß")).toBeNull();
    expect(cleanFieldValue(of("termin"), "am 12.03.2027")).toBe("2027-03-12"); expect(cleanFieldValue(of("termin"), "2027-03-12")).toBe("2027-03-12"); expect(cleanFieldValue(of("termin"), "31.02.2027")).toBeNull(); expect(cleanFieldValue(of("termin"), "bald")).toBeNull();
    expect(cleanFieldValue(of("erreichbarkeit"), "  nachmittags   ab 15 Uhr ")).toBe("nachmittags ab 15 Uhr"); expect(cleanFieldValue(of("erreichbarkeit"), "nicht genannt")).toBeNull();
    expect(cleanFieldValues(FIELDS.slice(0, 3), { hausart: "Firmengebäude", dachart: "Kuppel", stromspeicher: "", unbekannt: "x" })).toEqual({ hausart: "Firmengebäude" });
  });
  it("nimmt ohne KI nur eine Auswahl-Antwort, die wörtlich und eindeutig im Gespräch fällt", () => {
    expect(fieldsFromTranscript(FIELDS, "Wir haben ein Mehrfamilienhaus mit Satteldach, ungefähr vierzig Quadratmeter.")).toEqual({ hausart: "Mehrfamilienhaus", dachart: "Satteldach" });
    expect(fieldsFromTranscript(FIELDS, "Erst war es ein Satteldach, jetzt ist es ein Flachdach geworden.")).toEqual({}); // zwei Antworten – nichts raten
    expect(fieldsFromTranscript(FIELDS, "ja")).toEqual({});
  });
  it("trennt Vermerke der Software von den Angaben des Kunden und gibt Zusatzfeldern lesbare Namen", () => {
    for (const key of ["rawContactId", "rawBatch", "source", "callScore", "callVerdict", "callDecision", "callRecordId", "callFieldsAt", "street", "assignedOrderId", "partnerReference"]) expect(isTechnicalMeta(key), key).toBe(true);
    expect(isTechnicalMeta("hausart")).toBe(false);
    const extras = extraMetaFields({ source: "OnDialer", rawBatch: "Kontakte vom Dialer", callScore: 98, callRecordId: 382, rawContactId: 119, street: "Lindenweg 14", anrede: "Herr", hausart: "Mehrfamilienhaus", monatliche_stromkosten: "140 €", leer: "", platz: "<UNKNOWN>", liste: ["a", "b"], tief: { x: 1 }, ok: true }, ["hausart"]);
    expect(extras).toEqual([{ key: "anrede", label: "Anrede", value: "Herr" }, { key: "monatliche_stromkosten", label: "Monatliche stromkosten", value: "140 €" }, { key: "liste", label: "Liste", value: "a, b" }, { key: "ok", label: "Ok", value: "Ja" }]);
    expect(metaLabel("dialerResult")).toBe("Ergebnis im Dialer"); expect(metaLabel("stromverbrauchKwh")).toBe("Stromverbrauch Kwh");
  });
  it("listet die Antworten auf die Prüffragen in der Reihenfolge der Fragen – ohne „Entfällt“ und ohne Unbeantwortetes", () => {
    const questions = [{ key: "eigentuemer", label: "Ist der Kunde Eigentümer?" }, { key: "gas", label: "Erdgas?" }, { key: "interesse", label: "Hat der Kunde Interesse?" }, { key: "offen", label: "Noch offen?" }];
    expect(callAnswerList(questions, { interesse: { answer: "ja", note: "Er will ein Angebot." }, eigentuemer: { answer: "JA" }, gas: { answer: "ja", note: "Entfällt" }, fremd: { answer: "nein" } })).toEqual([{ key: "eigentuemer", label: "Ist der Kunde Eigentümer?", answer: "ja", note: "" }, { key: "interesse", label: "Hat der Kunde Interesse?", answer: "ja", note: "Er will ein Angebot." }]);
    expect(callAnswerList(questions, null)).toEqual([]);
  });
  it("bucht den KI-Verbrauch für das Lesen der Felder unter „Gespräche“", () => {
    expect(purposeInfo("felder_aus_gespraech")).toEqual({ label: "Felder des Leads aus dem Gespräch lesen", area: "gespraeche" });
  });
});

describe("Zahlen über der Leads-Tabelle", () => {
  it("zählt alle Leads, heute, gestern, 7 Tage, bereit und ausgeliefert – Tage sind Kalendertage in Berlin", () => {
    const now = new Date("2026-11-20T19:55:00Z"); // 20:55 in Berlin
    const overview = leadsOverview([{ status: "genehmigt", count: 120 }, { status: "zugewiesen", count: 30 }, { status: "neu", count: 5 }, { status: "hängend", count: 2 }, { status: "deaktiviert", count: 3 }],
      ["2026-11-20T18:15:00Z", "2026-11-19T23:30:00Z" /* in Berlin schon der 20. */, "2026-11-19T12:00:00Z", "2026-11-14T08:00:00Z", "2026-11-07T10:00:00Z", "2026-11-01T10:00:00Z" /* älter als 14 Tage */], now);
    expect(overview).toMatchObject({ total: 160, today: 2, yesterday: 1, week: 4, open: 127, ready: 120, delivered: 30 });
    expect(overview.days).toHaveLength(OVERVIEW_DAYS); expect(overview.days[0]).toEqual({ day: "2026-11-07", count: 1 }); expect(overview.days[OVERVIEW_DAYS - 1]).toEqual({ day: "2026-11-20", count: 2 });
    expect(berlinDayBefore(new Date("2026-03-01T08:00:00Z"), 1)).toBe("2026-02-28");
    expect(emptyLeadCounts()).toEqual({ alle: 0, neu: 0, genehmigt: 0, zugewiesen: 0, reklamiert: 0, fehlerhaft: 0, deaktiviert: 0, hängend: 0, dubletten: 0 });
  });
  it("vergleicht fair: heute gegen gestern bis zur selben Uhrzeit, die letzten 7 Tage gegen die 7 davor, derselbe Wochentag vor einer Woche", () => {
    const now = new Date("2026-11-20T14:00:00Z"); // Freitag, 15:00 in Berlin
    const at = (day: string, time: string) => `2026-11-${day}T${time}:00Z`;
    const overview = leadsOverview([{ status: "genehmigt", count: 9 }], [
      at("20", "08:00"), at("20", "13:59"), // heute: 2
      at("19", "09:00"), at("19", "14:00") /* genau 24 Stunden her – zählt noch */, at("19", "14:01") /* gestern, aber später als jetzt */, at("19", "20:00"), // gestern: 4, bis jetzt 2
      at("18", "10:00"), at("14", "10:00"), // in den letzten 7 Tagen (14.–20.): zusammen 8
      at("13", "10:00"), at("13", "11:00"), at("13", "12:00") /* Freitag vor einer Woche: 3 */, at("08", "10:00"), at("07", "10:00"), // die 7 Tage davor (7.–13.): 5
      at("06", "10:00"), // älter als 14 Tage
    ], now);
    expect(overview).toMatchObject({ today: 2, yesterday: 4, yesterdaySoFar: 2, week: 8, previousWeek: 5, sameDayLastWeek: 3 });
    expect(overview.days.slice(-7).map((day) => day.count)).toEqual([1, 0, 0, 0, 1, 4, 2]); expect(overview.days.slice(0, 7).map((day) => day.count)).toEqual([1, 1, 0, 0, 0, 0, 3]);
    expect(todayComparison(2, 2)).toEqual({ tone: "ruhig", arrow: "=", text: "so viele wie gestern" }); expect(todayComparison(0, 0).text).toBe("wie gestern");
    expect(todayComparison(22, 11)).toEqual({ tone: "gut", arrow: "↑", text: "11 mehr als gestern" });
    expect(todayComparison(0, 1043)).toEqual({ tone: "ruhig", arrow: "↓", text: "1.043 weniger als gestern" }); // weniger bleibt sachlich – daran lässt sich hier nichts ändern
    expect(weekComparison(8, 5)).toEqual({ tone: "gut", arrow: "↑", text: "60 % mehr" }); expect(weekComparison(5, 8)).toEqual({ tone: "ruhig", arrow: "↓", text: "38 % weniger" }); expect(weekComparison(8, 8)?.text).toBe("gleich viele"); expect(weekComparison(1001, 1000)?.text).toBe("unter 1 % mehr");
    expect(weekComparison(120, 0)).toBeNull(); expect(weekComparison(0, 0)).toBeNull(); // kein Prozent von 0
  });
  it("zeigt, wo alle Leads stehen, wie alt der älteste wartende ist, was ausgeliefert wurde (ein Lead zählt einmal, sein Preis je Zustellung) und die Quote der Reklamationen", () => {
    const now = new Date("2026-11-20T19:55:00Z"); // 20:55 in Berlin
    const overview = leadsOverview([{ status: "genehmigt", count: 24 }, { status: "zugewiesen", count: 43 }, { status: "reklamiert", count: 6 }, { status: "neu", count: 7 }, { status: "hängend", count: 6 }, { status: "fehlerhaft", count: 6 }, { status: "deaktiviert", count: 5 }], [], now, {
      oldestReadyAt: new Date("2026-11-18T07:30:00Z"), claimsOpen: 3,
      deliveries: [
        { leadId: 1, unitPrice: "22.00", occurredAt: "2026-11-20T10:00:00Z" }, { leadId: 1, unitPrice: "18.50", occurredAt: "2026-11-20T10:00:05Z" }, // derselbe Lead an zwei Käufer: 1 Lead, 2 Preise
        { leadId: 2, unitPrice: 30, occurredAt: "2026-11-19T23:30:00Z" }, // in Berlin schon der 20.
        { leadId: 3, unitPrice: "24.00", occurredAt: "2026-11-14T08:00:00Z" }, // vor 6 Tagen – gehört noch zu den 7 Tagen
        { leadId: 4, unitPrice: "99.00", occurredAt: "2026-11-13T21:00:00Z" }, // vor 7 Tagen – nicht mehr
        { leadId: 5, unitPrice: null, occurredAt: "2026-11-17T09:00:00Z" }, // ohne Preis: zählt als Lead, nicht als Betrag
      ],
    });
    expect(overview).toMatchObject({ total: 97, ready: 24, delivered: 43, open: 37, deliveredToday: 2, deliveredWeek: 4, valueWeek: 94.5, claimsOpen: 3, oldestReadyAt: "2026-11-18T07:30:00.000Z", hints: [] });
    expect(overview.status).toEqual({ neu: 7, genehmigt: 24, zugewiesen: 43, reklamiert: 6, fehlerhaft: 6, deaktiviert: 5, hängend: 6 });
    // Leiste: vier Teile in fester Reihenfolge, die Anteile zusammen (gerundet) rund 100 %
    expect(statusSplit(overview.status).map((part) => [part.key, part.count, part.share])).toEqual([["bereit", 24, 25], ["ausgeliefert", 43, 44], ["reklamiert", 6, 6], ["uebrige", 24, 25]]);
    expect(statusSplit(emptyLeadsOverview(now).status).every((part) => part.count === 0 && part.share === 0)).toBe(true);
    // Alter des ältesten wartenden Leads: erst ab zwei Tagen ein Hinweis
    expect(waitingAge(overview.oldestReadyAt, now)).toEqual({ tone: "achtung", text: "ältester ist 2 Tage alt" });
    expect(waitingAge("2026-11-19T10:00:00Z", now)).toEqual({ tone: "ruhig", text: "ältester ist 1 Tag alt" }); expect(waitingAge("2026-11-20T16:40:00Z", now)).toEqual({ tone: "ruhig", text: "ältester ist 3 Stunden alt" });
    expect(waitingAge("2026-11-20T18:50:00Z", now)?.text).toBe("ältester ist 1 Stunde alt"); expect(waitingAge("2026-11-20T19:30:00Z", now)?.text).toBe("ältester kam gerade erst"); expect(waitingAge(null, now)).toBeNull();
    expect(waitingAge("2026-10-01T10:00:00Z", now)).toEqual({ tone: "achtung", text: "ältester ist 50 Tage alt" });
    // Quote: reklamiert von allen, die je ausgeliefert wurden
    expect(claimRate(43, 6)).toBe(12); expect(claimRate(0, 0)).toBeNull(); expect(claimRate(0, 3)).toBe(100); expect(claimRate(120, 0)).toBe(0);
    // ohne Zusatz (Partner-Zugang): die Zahlen der eigenen Leads, sonst nichts
    expect(leadsOverview([{ status: "zugewiesen", count: 3 }], [], now)).toMatchObject({ total: 3, delivered: 3, deliveredToday: 0, deliveredWeek: 0, valueWeek: 0, claimsOpen: 0, oldestReadyAt: null, hints: [] });
  });
  it("Hinweise: warum freigegebene Leads nicht rausgehen – keine Lieferkette, Auslieferung hakt, keine Automation liefert von selbst aus", () => {
    const names = new Map([[1, "Photovoltaik"], [2, "Wärmepumpe"], [3, "Fenster"], [4, "Treppenlifte"]]); const categoryName = (id: number) => names.get(id) ?? "ohne Kategorie";
    const waiting = [{ categoryId: 1, count: 120 }, { categoryId: 2, count: 8 }, { categoryId: 3, count: 1 }, { categoryId: 4, count: 0 }];
    // alles in Ordnung: jede Kategorie kann ausliefern und tut es von selbst
    expect(overviewHints({ waiting, categoryName, deliverable: [1, 2, 3], automatic: [1, 2, 3], problems: 0 })).toEqual([]);
    // der Fall des Bildschirmfotos: 120 freigegeben, 0 ausgeliefert – für Photovoltaik ist keine Kette eingeschaltet
    const blocked = overviewHints({ waiting: [{ categoryId: 1, count: 120 }], categoryName, deliverable: [], automatic: [], problems: 0 });
    expect(blocked).toEqual([{ kind: "keine_kette", leads: 120, categories: ["Photovoltaik"], categoryIds: [1] }]);
    expect(hintText(blocked[0])).toEqual({ text: "120 freigegebene Leads können nicht raus: Für „Photovoltaik“ ist keine Lieferkette eingeschaltet.", action: "Lieferkette einrichten", page: "Lieferkette", showLeads: true });
    // Kette da, aber keine Automation: Die Leads warten, bis sie jemand von Hand ausliefert (eine Automation ohne Kette hilft nicht – die Kette fehlt zuerst)
    const mixed = overviewHints({ waiting, categoryName, deliverable: [1, 2], automatic: [2, 3], problems: 9 });
    expect(mixed.map((hint) => [hint.kind, hint.leads, hint.categories, hint.categoryIds])).toEqual([["keine_kette", 1, ["Fenster"], [3]], ["fehler", 9, [], []], ["nicht_von_selbst", 120, ["Photovoltaik"], [1]]]); // nach Dringlichkeit
    expect(mixed.map((hint) => hintText(hint).text)).toEqual(["1 freigegebener Lead kann nicht raus: Für „Fenster“ ist keine Lieferkette eingeschaltet.", "Bei 9 Leads hakt die Auslieferung.", "120 freigegebene Leads warten: Für „Photovoltaik“ liefert keine Automation von selbst aus."]);
    expect(hintText(mixed[1])).toMatchObject({ action: "API-Fehler ansehen", page: "API-Fehler", showLeads: false }); expect(hintText(mixed[2])).toMatchObject({ action: "Automation einrichten", page: "Automatisierung", showLeads: true });
    expect(hintText({ kind: "fehler", leads: 1, categories: [], categoryIds: [] }).text).toBe("Bei 1 Lead hakt die Auslieferung."); expect(hintText({ kind: "nicht_von_selbst", leads: 1, categories: ["Fenster"], categoryIds: [3] }).text).toBe("1 freigegebener Lead wartet: Für „Fenster“ liefert keine Automation von selbst aus.");
    // mehrere Kategorien: zwei werden genannt, ab drei nur die Zahl; die größte steht vorn
    const many = overviewHints({ waiting, categoryName, deliverable: [], automatic: [], problems: 0 });
    expect(many).toEqual([{ kind: "keine_kette", leads: 129, categories: ["Photovoltaik", "Wärmepumpe", "Fenster"], categoryIds: [1, 2, 3] }]); expect(hintText(many[0]).text).toBe("129 freigegebene Leads können nicht raus: Für 3 Kategorien ist keine Lieferkette eingeschaltet.");
    expect(hintText({ kind: "keine_kette", leads: 1200, categories: ["Photovoltaik", "Wärmepumpe"], categoryIds: [1, 2] }).text).toBe("1.200 freigegebene Leads können nicht raus: Für „Photovoltaik“ und „Wärmepumpe“ ist keine Lieferkette eingeschaltet.");
    // Welche Automation bringt neue Leads von selbst raus? Ausliefern oder zuordnen – nicht, wenn sie erst nach dem Verkauf greift
    expect(deliversByItself({ triggerType: "lead_erstellt", actionType: "lead_ausliefern" })).toBe(true); expect(deliversByItself({ triggerType: "status_geändert", actionType: "lead_lieferkette_zuordnen" })).toBe(true);
    expect(deliversByItself({ triggerType: "lead_erstellt", actionType: "lead_tags_setzen", falseActionType: "lead_bestellung_zuordnen" })).toBe(true);
    expect(deliversByItself({ triggerType: "lead_erstellt", actionType: "lead_freigeben" })).toBe(false); expect(deliversByItself({ triggerType: "reklamation_genehmigt", actionType: "lead_ausliefern" })).toBe(false); expect(deliversByItself({ triggerType: "nach_erstattung", actionType: "lead_ausliefern" })).toBe(false);
    expect(deliversByItself({ triggerType: "status_geändert", actionType: "lead_ausliefern", conditions: [{ field: "status", operator: "gleich", value: "reklamiert" }] })).toBe(false); // gibt Reklamierte weiter – keine neuen Leads
    expect(deliversByItself({ triggerType: "status_geändert", actionType: "lead_bestellung_zuordnen", conditions: [{ field: "status", operator: "gleich", value: "genehmigt" }] })).toBe(true); expect(deliversByItself({ triggerType: "lead_erstellt", actionType: "lead_ausliefern", conditions: [{ field: "heizungsart", operator: "gleich", value: "Gas" }] })).toBe(true); expect(deliversByItself({ triggerType: "lead_erstellt", actionType: "lead_ausliefern", conditions: "kaputt" })).toBe(true);
  });
  it("baut die Tabelle für den Export: feste Spalten, dann die Felder der Kategorien mit ihrem Namen, dann weitere Zusatzfelder", () => {
    const table = leadExportTable([
      { publicId: "AB12CD34", categoryId: 1, status: "genehmigt", firstName: "Martin", lastName: "Albrecht", email: "martin.albrecht@beispiel.de", phone: "+4915112340071", postcode: "48249", city: "Dülmen", country: "DE", supplierName: "OnDialer", cost: "0.00", createdAt: new Date("2026-11-20T16:47:00Z"), metadata: { street: "Lindenweg 14", hausart: "Ein-/Zweifamilienhaus", status_wunsch: "sofort", callRecordId: 9, rawBatch: "Kontakte vom Dialer", anrede: "Herr" }, buyerName: null, deliveredAt: null },
      { publicId: "EF56GH78", categoryId: 2, status: "zugewiesen", firstName: "<UNKNOWN>", lastName: "Sommer", email: null, phone: "+4915112340072", postcode: "07546", city: "Gera", country: "DE", supplierName: "OnDialer", cost: 42.5, createdAt: "2026-11-19T10:00:00Z", metadata: { heizung: "Heizöl" }, buyerName: "Sabine Krüger", deliveredAt: new Date("2026-11-19T11:30:00Z") },
    ], [{ id: 1, name: "Photovoltaik" }, { id: 2, name: "Wärmepumpe" }, { id: 3, name: "Fenster" }], [{ categoryId: 1, fieldKey: "hausart", label: "Hausart" }, { categoryId: 1, fieldKey: "status_wunsch", label: "Status" }, { categoryId: 2, fieldKey: "heizung", label: "Aktuelles Heizsystem" }, { categoryId: 3, fieldKey: "glas", label: "Verglasung" }]);
    expect(table.columns).toEqual([...BASE_EXPORT_COLUMNS, "Hausart", "Status (Feld)", "Aktuelles Heizsystem", "Anrede"]); // „Verglasung“ gehört zu keiner der Kategorien; Vermerke der Software fehlen
    expect(table.rows[0]).toEqual(["AB12CD34", "Photovoltaik", "Genehmigt", "Martin", "Albrecht", "martin.albrecht@beispiel.de", "+4915112340071", "Lindenweg 14", "48249", "Dülmen", "DE", "OnDialer", "20.11.2026 17:47", "", "", "0,00", "Ein-/Zweifamilienhaus", "sofort", "", "Herr"]);
    expect(table.rows[1]).toEqual(["EF56GH78", "Wärmepumpe", "Zugewiesen", "", "Sommer", "", "+4915112340072", "", "07546", "Gera", "DE", "OnDialer", "19.11.2026 11:00", "Sabine Krüger", "19.11.2026 12:30", "42,50", "", "", "Heizöl", ""]);
    expect(leadExportTable([], [], [])).toEqual({ columns: [...BASE_EXPORT_COLUMNS], rows: [] });
  });
});

describe("Suche in den Gesprächen", () => {
  it("zerlegt die Eingabe in Wörter – eine Rufnummer mit Leerzeichen bleibt ein Suchwort", () => {
    expect(searchWords("  Oliver   Schüttert ")).toEqual(["Oliver", "Schüttert"]); expect(searchWords("0152 027 28987")).toEqual(["015202728987"]); expect(searchWords("a")).toEqual([]); expect(searchWords(null)).toEqual([]);
    expect(searchWords("eins zwei drei vier fünf sechs sieben")).toHaveLength(6);
    expect(phoneFragment("015202728987")).toBe("15202728987"); expect(phoneFragment("+49 152 0272")).toBe("1520272"); expect(phoneFragment("0049152")).toBe("152"); expect(phoneFragment("Oliver")).toBeNull(); expect(phoneFragment("12")).toBeNull();
  });
  it("findet ein Gespräch über Kunde, Rufnummer (mit und ohne Vorwahl), Agent, Alias, Kampagne oder ein Wort aus dem Text – jedes Wort muss vorkommen", () => {
    const texts = ["Deniz Kaya", "Laura Stein", "PV Q4", "Herr Albrecht will eine PV-Anlage mit Speicher.", "Guten Tag Herr Albrecht, hier ist Laura Stein.", "Martin Albrecht", "AB12CD34", "Dülmen"]; const phone = "+4915112340071";
    for (const search of ["albrecht", "ALBRECHT dülmen", "Laura", "deniz pv", "speicher", "0151 1234 0071", "+49 151 1234", "12340071", "ab12"]) expect(matchesCallSearch(search, texts, phone), search).toBe(true);
    for (const search of ["Sommer", "albrecht gera", "0160 111"]) expect(matchesCallSearch(search, texts, phone), search).toBe(false);
    expect(matchesCallSearch("", texts, phone)).toBe(true);
  });
});

describe("Spalten der Leads-Tabelle", () => {
  it("blendet bei wenig Platz Spalten in fester Reihenfolge aus – mit „alle zeigen“ keine", () => {
    expect(fitLeadColumns(2400, []).autoHidden).toEqual([]); expect(fitLeadColumns(2400, []).visible).toEqual(LEAD_COLUMN_KEYS);
    const narrow = fitLeadColumns(1000, []); expect(narrow.autoHidden).toEqual(AUTO_HIDE_ORDER.slice(0, narrow.autoHidden.length)); expect(narrow.autoHidden.length).toBeGreaterThan(1); expect(narrow.visible).toContain("category"); expect(narrow.visible).toContain("status"); expect(narrow.visible).toContain("price");
    expect(fitLeadColumns(1000, [], true)).toEqual({ visible: LEAD_COLUMN_KEYS, autoHidden: [] });
    expect(fitLeadColumns(2400, ["phone", "assigned"]).visible).toEqual(["category", "email", "status", "supplier", "delivered", "buyer", "price"]);
    expect(fitLeadColumns(0, ["phone"]).autoHidden).toEqual([]); // Handy: Karten statt Spalten
  });
  it("baut das Raster mit Auswahl, ID und Lead links und den Aktionen rechts und liest die gemerkte Auswahl", () => {
    expect(leadGridTemplate(["category", "price"])).toBe("34px 84px minmax(200px,1.6fr) minmax(150px,1.1fr) 88px 76px"); // seit v366: Lead mit Kreis breiter, Aktionen schmaler
    expect(leadGridTemplate(["category", "price"], true)).toBe("34px 84px minmax(200px,1.6fr) minmax(150px,1fr) minmax(88px,1fr) 76px");
    expect(readHiddenColumns(null)).toEqual(DEFAULT_HIDDEN); expect(readHiddenColumns('["phone","type","buyer"]')).toEqual(["phone", "buyer"]); expect(readHiddenColumns("kaputt")).toEqual(DEFAULT_HIDDEN); expect(readHiddenColumns("[]")).toEqual([]);
  });
});

describe("Lead-Log in einfachen Wörtern", () => {
  it("nennt die Kategorie beim Namen und macht aus einem Vermerk ohne Statuswechsel einen eigenen Eintrag", () => {
    const at = (second: number) => new Date(`2026-11-20T16:47:${String(second).padStart(2, "0")}.000Z`);
    const events = buildLeadAuditLog({ lead: { id: 5, categoryId: 2, status: "genehmigt", createdAt: at(1), categoryName: "Photovoltaik" }, deliveries: [], claimRows: [], claimEventRows: [], integrationRows: [], automationRows: [],
      statusRows: [{ id: 1, occurredAt: at(2), previousStatus: null, nextStatus: "genehmigt", note: "Aus Rohdaten übernommen (Kontakte vom Dialer)" }, { id: 2, occurredAt: at(3), previousStatus: "genehmigt", nextStatus: "genehmigt", note: "Aus dem Gespräch übernommen: 9 Felder (Hausart, Dachart) · E-Mail" }, { id: 3, occurredAt: at(4), previousStatus: "genehmigt", nextStatus: "zugewiesen", note: null }, { id: 4, occurredAt: at(5), previousStatus: "zugewiesen", nextStatus: "zugewiesen", note: "Kette erschöpft" }] });
    expect(events.map((event) => [event.title, event.detail])).toEqual([["Vermerk", "Kette erschöpft"], ["Lead-Status: Zugewiesen", "Freigegeben → Zugewiesen"], ["Aus dem Gespräch übernommen", "9 Felder (Hausart, Dachart) · E-Mail"], ["Lead-Status: Freigegeben", "Aus Rohdaten übernommen (Kontakte vom Dialer)"], ["Lead im System erfasst", "Kategorie Photovoltaik · Status Freigegeben"]]);
    expect(buildLeadAuditLog({ lead: { id: 6, categoryId: 150001, status: "neu", createdAt: at(1) }, deliveries: [], claimRows: [], claimEventRows: [], integrationRows: [], automationRows: [], statusRows: [] })[0].detail).toBe("Kategorie #150001 · Status Neu");
  });
});
