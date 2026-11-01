import { describe, expect, it } from "vitest";
import { allChecked, canonicalOptIn, checkConsentText, consentQuote, consentScript, countYes, DEFAULT_OPT_IN_SETTINGS, fnvHash, missingOf, newOptInNumber, normalizeOptInSettings, retainUntil, smsText, statusFromChecks } from "../shared/opt-in";
import { buildOptInPdf } from "../shared/opt-in-pdf";

const settings = normalizeOptInSettings({ companyName: "Tanesco Digital GbR", companyAddress: "Schultheißweg 44, 55252 Wiesbaden", revokeEmail: "kontakt@tanescodigital.de", privacyUrl: "https://www.tanescodigital.de/datenschutz" });
const values = { now: new Date("2026-11-01T13:20:00Z"), name: "Max Mustermann", firstName: "Max", phone: "0171 2345678", city: "Frankfurt", category: "Photovoltaik", buyerName: "Müller Solartechnik, Frankfurt" };

describe("Opt-in: Skript, Prüfung, Aufbewahrung, Nachweis", () => {
  it("Skript in drei Schritten: Aufnahme-Erlaubnis (ohne Aufnahme), Einwilligung mit Datum, Uhrzeit, Name, Firma, Fachbetrieb, Kanälen, Abschluss mit Widerruf und 5 Jahren", () => {
    const script = consentScript(settings, values);
    expect(script.steps.map((step) => step.key)).toEqual(["aufnahme", "einwilligung", "abschluss"]);
    expect(script.steps[0].text).toMatch(/Max Mustermann, damit der Fachbetrieb Sie kontaktieren darf/); expect(script.steps[0].text).toMatch(/aufzeichne\?$/);
    const consent = script.steps[1].text;
    expect(consent).toContain("1. November 2026"); expect(consent).toContain("14:20 Uhr"); expect(consent).toContain("Max Mustermann"); expect(consent).toContain("0171 2345678"); expect(consent).toContain("für Ihr Haus in Frankfurt"); expect(consent).toContain("zum Thema Photovoltaik"); expect(consent).toContain("Tanesco Digital GbR"); expect(consent).toContain("an Müller Solartechnik, Frankfurt weitergibt"); expect(consent).toContain("telefonisch und per E-Mail");
    expect(script.steps[2].text).toContain("jederzeit widerrufen"); expect(script.steps[2].text).toContain("kontakt@tanescodigital.de"); expect(script.steps[2].text).toContain("5 Jahre"); expect(script.steps[2].text).toContain("datenschutz");
    // ohne Fachbetrieb: Ersatzformulierung; ohne Ort: kein „für Ihr Haus in“
    const fallback = consentScript(settings, { ...values, buyerName: null, city: null }).steps[1].text;
    expect(fallback).toContain("einen Fachbetrieb aus Ihrer Region, dessen Namen wir Ihnen per SMS mitteilen"); expect(fallback).not.toContain("für Ihr Haus");
  });
  it("Einstellungen: Vorgabetexte, Grenzen, eigener Text mit Platzhaltern; SMS-Text mit Link und Firmenname", () => {
    expect(normalizeOptInSettings(null)).toEqual(DEFAULT_OPT_IN_SETTINGS);
    const own = normalizeOptInSettings({ companyName: "  Firma X ", consentTemplate: "Hallo {{name}}, {{firma}} gibt an {{kaeufer}} weiter – ok?", autoSms: true });
    expect(own.companyName).toBe("Firma X"); expect(own.autoSms).toBe(true);
    expect(consentScript(own, values).steps[1].text).toBe("Hallo Max Mustermann, Firma X gibt an Müller Solartechnik, Frankfurt weiter – ok?");
    const sms = smsText(settings, { ...values, link: "https://app.example/opt-in/abc" });
    expect(sms).toMatch(/^Tanesco Digital GbR: Hallo Max, /); expect(sms).toContain("Müller Solartechnik, Frankfurt"); expect(sms).toContain("https://app.example/opt-in/abc"); expect(sms).toContain("Widerruf jederzeit möglich");
  });
  it("Regelprüfung der Abschrift: alle sechs Pflichtbestandteile; „Mhm“ oder Verneinung zählen nicht als Ja", () => {
    const script = consentScript(settings, values);
    const good = `${script.steps[0].text}\nKunde: Ja.\n${script.steps[1].text}\nKunde: Ja, einverstanden.\n${script.steps[2].text}`;
    const checks = checkConsentText(good, { buyerName: values.buyerName, companyName: settings.companyName });
    expect(allChecked(checks)).toBe(true); expect(checks.by).toBe("regeln"); expect(statusFromChecks(checks)).toBe("gueltig"); expect(missingOf(checks)).toEqual([]);
    expect(countYes(good)).toBeGreaterThanOrEqual(2);
    // nur ein Ja (für die Aufnahme), danach „Mhm“ → kein eindeutiges Ja
    const weak = `${script.steps[0].text}\nKunde: Ja.\n${script.steps[1].text}\nKunde: Mhm.\n${script.steps[2].text}`;
    const weakChecks = checkConsentText(weak, { buyerName: values.buyerName }); expect(weakChecks.ja).toBe(false); expect(statusFromChecks(weakChecks)).toBe("unvollstaendig"); expect(missingOf(weakChecks)).toEqual(["Eindeutiges „Ja“"]);
    // Verneinung
    expect(countYes("Nein, ich bin nicht einverstanden. Nein.")).toBe(0);
    // anderer Fachbetrieb genannt als erwartet → Firma fehlt
    const other = checkConsentText(good, { buyerName: "Schmidt Energie, Kassel" }); expect(other.firma).toBe(false); expect(missingOf(other)).toEqual(["Fachbetrieb genannt"]);
    // ohne Widerrufshinweis
    const noRevoke = checkConsentText(`${script.steps[0].text}\nKunde: Ja.\n${script.steps[1].text}\nKunde: Ja.`, { buyerName: values.buyerName }); expect(noRevoke.widerruf).toBe(false);
    // leer
    expect(statusFromChecks(checkConsentText("", { buyerName: null }))).toBe("unvollstaendig"); expect(statusFromChecks(null)).toBe("offen");
  });
  it("Zitierte Stelle: von der Aufnahmefrage bis zum letzten Ja, gekürzt", () => {
    const script = consentScript(settings, values);
    const transcript = `Vorgespräch über Dächer und Preise, lange Erklärung.\n${script.steps[0].text}\nKunde: Ja.\n${script.steps[1].text}\nKunde: Ja, einverstanden.\n${script.steps[2].text}`;
    const quote = consentQuote(transcript)!; expect(quote.startsWith("Max Mustermann, damit der Fachbetrieb")).toBe(true); expect(quote).toContain("Ja, einverstanden"); expect(quote).not.toContain("Vorgespräch"); expect(quote.length).toBeLessThanOrEqual(905);
    expect(consentQuote("")).toBeNull();
  });
  it("Aufbewahrung 5 Jahre ab Erteilung, nach jeder Verwendung neu; Nummern; Prüfsumme ändert sich mit dem Inhalt", () => {
    expect(retainUntil("2026-11-01T12:00:00Z")?.toISOString()).toBe("2031-11-01T12:00:00.000Z");
    expect(retainUntil("2026-11-01T12:00:00Z", "2027-03-15T09:00:00Z")?.toISOString()).toBe("2032-03-15T09:00:00.000Z");
    expect(retainUntil(null)).toBeNull();
    expect(newOptInNumber(7, new Date("2026-11-01T00:00:00Z"))).toBe("OPT-2026-000007");
    const base = { number: "OPT-2026-000001", leadId: 5, kind: "sprache", grantedTo: "kaeufer", buyerName: "Müller", consentText: "Text", givenAt: "2026-11-01T12:00:00Z", collectedBy: "Taner", quote: "Ja", recordingUrl: null, confirmedAt: null, source: { via: "dialer" } };
    expect(fnvHash(canonicalOptIn(base))).toBe(fnvHash(canonicalOptIn({ ...base })));
    expect(fnvHash(canonicalOptIn(base))).not.toBe(fnvHash(canonicalOptIn({ ...base, consentText: "Text geändert" })));
  });
  it("Nachweis-PDF: eine A4-Datei mit Nummer, Beteiligten, Text, Prüfung und Prüfsumme", () => {
    const script = consentScript(settings, values);
    const checks = checkConsentText(`${script.steps[0].text} Ja. ${script.steps[1].text} Ja, einverstanden. ${script.steps[2].text}`, { buyerName: values.buyerName });
    const buffer = buildOptInPdf({ optIn: { number: "OPT-2026-000001", kind: "sprache", status: "gueltig", grantedTo: "kaeufer", buyerName: values.buyerName, companyName: settings.companyName, consentText: script.fullText, channels: settings.channels, givenAt: values.now, collectedBy: "Taner Yildiz", source: { via: "dialer" }, recordingUrl: "https://example.test/a.mp3", recordingStartSec: 0, recordingEndSec: 41, quote: "Sind Sie damit einverstanden … Ja, einverstanden.", checks, missing: [], warning: null, attest: { aufnahme: true, ja: true }, smsPhone: null, smsSentAt: null, confirmedAt: null, confirmIp: null, revokedAt: null, revokeNote: null, usages: [{ at: "2026-11-01T14:00:00Z", kind: "zustellung", buyerName: values.buyerName, buyerUserId: null, orderId: 1 }], lastUsedAt: "2026-11-01T14:00:00Z", retainUntil: retainUntil(values.now, "2026-11-01T14:00:00Z"), hash: "abc123", createdAt: values.now }, lead: { name: values.name, publicId: "KALT-R0003", phone: values.phone, email: "max@example.org", street: "Hauptstraße 1", postcode: "60311", city: "Frankfurt", category: "Photovoltaik" }, company: { name: settings.companyName, address: settings.companyAddress, revokeEmail: settings.revokeEmail, privacyUrl: settings.privacyUrl } });
    const bytes = Buffer.from(buffer); expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-"); expect(bytes.length).toBeGreaterThan(3000);
  });
});
