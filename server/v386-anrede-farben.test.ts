import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { salutationFromSummary } from "../shared/dialer-intake";
import { leadSalutation, salutationValue } from "../shared/lead-fields";
import { hintText } from "../shared/lead-overview";
import { wattfoxPayload } from "../shared/wattfox";
import { leadTemplateValues } from "./outbound-templates";

/**
 * Version 386 – Anrede für Wattfox sicher ergänzt, dezentes Grau statt Rosa, Kopf der Auslieferung im Rot der Knöpfe, Ampel-Balken in den
 * Gesprächen, Menüpunkt „Lieferkette“ raus. Alle Namen sind erfunden.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const lead = (metadata: Record<string, unknown>) => ({ id: 1, publicId: "TEST0001", firstName: "Bernd", lastName: "Beispiel", email: "b@example.org", phone: "+491701234567", postcode: "12345", city: "Musterstadt", country: "DE", createdAt: new Date("2026-11-27T10:00:00Z"), status: "genehmigt", categoryId: 1, supplierId: null, metadata: { street: "Musterweg 1", umsetzung: "1-3 Monate", ...metadata } });

describe("Anrede: aus „salutation“ ODER „anrede“ – ein leerer Wert verdeckt sie nicht mehr", () => {
  it("erkennt auch die Schreibweisen von Dialer und Listen", () => {
    for (const value of ["Herr", "herrn", "Hr.", "m", "männlich", "Bay", "Mr"]) expect(salutationValue(value), value).toBe("Herr");
    for (const value of ["Frau", "fr", "w", "weiblich", "Bayan", "Mrs"]) expect(salutationValue(value), value).toBe("Frau");
    for (const value of ["", "  ", "<UNKNOWN>", "-", "divers", null, 3]) expect(salutationValue(value)).toBeNull();
  });
  it("bis v385 nahm die Vorlage nur das erste Feld – stand dort etwas Leeres, fehlte die Anrede für Wattfox", () => {
    for (const meta of [{ salutation: "", anrede: "Herr" }, { salutation: "<UNKNOWN>", anrede: "Herr" }, { salutation: null, anrede: "herr" }, { anrede: "m" }]) {
      expect(leadSalutation(meta), JSON.stringify(meta)).toBe("Herr");
      const values = leadTemplateValues(lead(meta), { name: "Photovoltaik", shortcode: "PV" });
      expect(values.salutation).toBe("Herr");
      expect(wattfoxPayload({ ...values, lead_type: "Photovoltaik" }).missing).not.toContain("Anrede (Herr/Frau)");
    }
    expect(leadTemplateValues(lead({ salutation: "", anrede: "" }), { name: "Photovoltaik", shortcode: "PV" }).salutation).toBe("");
  });
});

describe("Anrede aus der Kurzfassung des Gesprächs", () => {
  it("„Herr/Herrn <Name>“, „Frau <Name>“, „die Kundin“ – „seine Frau“ zählt nicht, beides zusammen gibt keine Antwort", () => {
    expect(salutationFromSummary("Die Agentin ruft Herrn Albers an und stellt das Thema Photovoltaik vor.")).toBe("Herr");
    expect(salutationFromSummary("Frau Brandt aus Musterstadt hat Interesse an einer Wärmepumpe.")).toBe("Frau");
    expect(salutationFromSummary("Die Kundin wohnt im eigenen Haus und möchte ein Angebot.")).toBe("Frau");
    expect(salutationFromSummary("Herr Kranz ist Miteigentümer mit seiner Frau und will beides.")).toBe("Herr");
    expect(salutationFromSummary("Frau Ost verbindet zu Herrn West.")).toBeNull();
    expect(salutationFromSummary("")).toBeNull(); expect(salutationFromSummary(null)).toBeNull();
  });
});

describe("Anrede wird ergänzt – beim Senden, im Hintergrund und beim Füllen aus dem Gespräch", () => {
  const fromCall = read("./lead-from-call.ts"); const endpoints = read("./outbound-endpoints.ts"); const scheduler = read("./delivery-scheduler.ts");
  it("Reihenfolge: Gespräch → Kurzfassung → Vorname; im Lead-Log steht, woher sie kommt", () => {
    expect(fromCall).toContain("export async function ensureLeadSalutation");
    const body = fromCall.slice(fromCall.indexOf("export async function ensureLeadSalutation"), fromCall.indexOf("export async function salutationsFromFirstNames"));
    expect(body.indexOf("salutationFromTranscript(call.transcript, lead.lastName)")).toBeLessThan(body.indexOf("salutationFromSummary(call.summary)"));
    expect(body.indexOf("salutationFromSummary(call.summary)")).toBeLessThan(body.indexOf("salutationForFirstName(lead.firstName)"));
    expect(fromCall).toContain('"Vorname": "aus dem Vornamen geschlossen"');
  });
  it("die Auswahl im Hintergrund prüft die Angaben im Programm, nicht mit „IS NULL“ in der Datenbank", () => {
    const body = fromCall.slice(fromCall.indexOf("export async function salutationsFromFirstNames"), fromCall.indexOf("/** Vorhandene Leads ohne E-Mail-Adresse"));
    expect(body).toContain("!leadSalutation(row.metadata)"); expect(body).not.toContain("IS NULL");
    expect(scheduler).toContain("mod.salutationsFromFirstNames(db, { max: 300 })");
  });
  it("vor dem Senden an eine Wattfox-Schnittstelle wird eine fehlende Anrede ergänzt", () => {
    expect(endpoints).toContain("if (!leadSalutation(input.lead.metadata) && targets.some((endpoint) => isWattfoxTemplate(endpoint.bodyTemplate)))");
    expect(endpoints).toContain("ensureLeadSalutation(db, input.lead");
  });
  it("dieselbe Frage an die KI je Vorname nur einmal", () => { expect(fromCall).toContain("FIRST_NAME_ANSWERS"); });
});

describe("Farben: dezentes Grau statt Rosa, Kopf im Rot der Knöpfe", () => {
  const styles = read("../client/src/bausteine.css"); const calls = read("../client/src/gespraeche.css");
  it("Zeilen, Kachel, Lead-Puls, Bestellung und Gespräche: grau hervorgehoben", () => {
    for (const token of ["--lt-hover:#f7f8fa", "--lt-on:#eff1f4", "--lt-tile-on:#f2f4f7", "--pu-hover:#f7f8fa", "--ov-hover:#f7f8fa"]) expect(styles, token).toContain(token);
    for (const token of ["--gl-row:#f7f8fa", "--gl-row-on:#eff1f4"]) expect(calls, token).toContain(token);
    for (const pink of ["--lt-hover:#fff5f6", "--lt-on:#ffe8eb", "--lt-tile-on:#fff1f2", "--ov-hover:#fff7f8"]) expect(styles).not.toContain(pink);
  });
  it("Gespräche: links ein Balken in der Farbe der Ampel", () => {
    expect(calls).toContain('.gq-call::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--mood)');
    expect(calls).toContain(".gq-call:hover::before,.gq-call:focus-visible::before,.gq-call.is-selected::before{opacity:1}");
    expect(calls).toContain(".gq-call.is-selected{background:var(--gl-row-on)}");
  });
  it("Kopf der Auslieferung: genau der Verlauf des Hauptknopfs; die Zahlen rot mit weißer Schrift", () => {
    expect(styles).toContain("--head-red:linear-gradient(90deg,#bc001d,#fb2c36)");
    expect(read("../client/src/theme-light.css")).toContain("html:not(.dark) .flux-button, html:not(.dark) .flux-button:hover, html:not(.dark) button[class*=\"bg-primary\"], html:not(.dark) .bg-primary, html:not(.dark) .app-confirm-ok { background: linear-gradient(90deg, #bc001d, #fb2c36)");
    expect(styles).toContain("html:not(.dark) .order-overview-head .order-kpis{border-color:rgba(255,255,255,.34)!important;background:rgba(90,0,12,.2)!important");
    expect(styles).toContain("html:not(.dark) .order-overview-head .order-kpis b,html:not(.dark) .order-overview-head .order-kpis .is-active b{color:#ffffff!important}");
    // Weiß auf dem abgedunkelten hellen Ende (#fb2c36 unter 20 % Dunkelrot): mindestens 4,5 : 1
    const mix = [251, 44, 54].map((channel, index) => Math.round(channel * 0.8 + [90, 0, 12][index] * 0.2));
    const lum = (rgb: number[]) => { const [r, g, b] = rgb.map((value) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    expect((1 + 0.05) / (lum(mix) + 0.05)).toBeGreaterThan(4.5);
  });
});

describe("Menüpunkt „Lieferkette“ ist raus", () => {
  it("nicht mehr im Menü; Hinweise führen zur Auslieferung; alte Links öffnen die Seite weiter", () => {
    const shell = read("../client/src/components/FluxoraWorkspace.tsx");
    expect(shell).toContain('{ label: "LEAD-OPERATIONS", pages: ["Leads", "Lead-Kategorien", "Tags", "Bestellungen", "Automatisierung", "Reklamationen"] }');
    expect(shell).toContain('page === "Lieferkette"'); // die Seite selbst bleibt erreichbar
    expect(hintText({ kind: "keine_kette", leads: 3, categories: ["Photovoltaik"], categoryIds: [1] })).toMatchObject({ action: "Auslieferung öffnen", page: "Bestellungen" });
    expect(read("../client/src/components/ApiErrorsWorkspace.tsx")).toContain('href="/?page=Bestellungen">Auslieferung öffnen');
  });
});
