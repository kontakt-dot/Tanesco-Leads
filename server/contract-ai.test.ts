import { describe, expect, it } from "vitest";
import { aiDraftToContract, contractStarter, detailValues, fallbackContractFromPrompt, missingDetails, renderContractHtml } from "../shared/contracts";
import { draftContractWithAi } from "./contract-ai";

describe("Verträge: Vorlagen und KI", () => {
  it("Vorlagen: Kunde füllt nichts aus, Eckdaten sind eigene Angaben", () => {
    for (const kind of ["leadliefervertrag", "testphase"] as const) {
      const starter = contractStarter(kind); expect(starter.blocks.some((block) => block.type === "field")).toBe(false);
      expect(starter.blocks.filter((block) => block.type === "detail").length).toBeGreaterThan(2);
      expect(starter.blocks.some((block) => block.type === "signature" && block.party === "kunde")).toBe(true);
    }
    const lead = contractStarter("leadliefervertrag"); expect(missingDetails(lead.blocks)).toContain("Preis je Lead (netto)");
    const filled = lead.blocks.map((block) => block.type === "detail" && block.key === "preis" ? { ...block, value: "79 €" } : block);
    expect(detailValues(filled).preis).toBe("79 €");
    expect(renderContractHtml({ title: lead.title, blocks: filled }, { mode: "unterschreiben", values: {} })).toContain("Der Preis je geliefertem Lead beträgt 79 €");
  });
  it("KI-Antwort → Bausteine mit Rahmen (Logo, Parteien, Datum, Unterschriften), Schlüssel eindeutig", () => {
    const result = aiDraftToContract({ title: "Provisionsvereinbarung", sections: [{ type: "heading", text: "§ 1 Gegenstand" }, { type: "text", text: "Provision {{provision}}." }, { type: "detail", key: "Provision", label: "Provision", value: "5 %" }, { type: "detail", label: "Provision", value: "x" }, { type: "bullets", items: ["a", " ", "b"] }, { type: "bogus" as never }] });
    expect(result.blocks.map((block) => block.type)).toEqual(["logo", "heading", "parties", "heading", "text", "detail", "detail", "bullets", "date", "signature", "signature"]);
    const keys = result.blocks.filter((block) => block.type === "detail").map((block) => (block as { key: string }).key); expect(keys).toEqual(["provision", "provision_2"]);
    expect(() => aiDraftToContract({ title: "x", sections: [] })).toThrow(/keinen Vertragstext/);
  });
  it("ohne KI-Schlüssel: passende Vorlage nach Stichworten", async () => {
    const saved = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    try {
      const test = await draftContractWithAi({ prompt: "Testphase über vier Wochen für PV-Leads" }); expect(test.source).toBe("vorlage"); expect(test.title).toContain("Testphase");
      expect(fallbackContractFromPrompt("Leads für Wärmepumpen liefern, 30 im Monat").title).toBe("Leadliefervertrag");
      expect(fallbackContractFromPrompt("Wir vermieten einen Stellplatz an die Firma").blocks.some((block) => block.type === "text" && block.text.includes("Stellplatz"))).toBe(true);
      await expect(draftContractWithAi({ prompt: "kurz" })).rejects.toThrow(/beschreibe/);
    } finally { if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved; }
  });
});

import { CONTRACT_AI_SYSTEM, CONTRACT_CLAUSES, CONTRACT_PLACEHOLDERS, DETAIL_PRESETS, type ContractBlock } from "../shared/contracts";
describe("Verträge: Vorlagen sind vollständig und einfach geschrieben", () => {
  const partsOf = (blocks: ContractBlock[]) => blocks.flatMap((block) => block.type === "text" ? block.text.split(/\n{2,}/) : block.type === "bullets" ? block.items : block.type === "heading" ? [block.text] : []);
  const headings = (blocks: ContractBlock[]) => blocks.filter((block) => block.type === "heading").map((block) => (block as { text: string }).text);
  it("Leadliefervertrag regelt alles Nötige – in dieser Reihenfolge", () => {
    const { blocks } = contractStarter("leadliefervertrag");
    expect(headings(blocks)).toEqual(["Vertrag über die Lieferung qualifizierter Kundenanfragen (Leads)", "§ 1 Gegenstand des Vertrags", "§ 2 Was ein Lead ist", "§ 3 Leistungen des Anbieters", "§ 4 Liefergebiet, Menge und Übergabe", "§ 5 Preis und Abrechnung", "§ 6 Pflichten des Kunden", "§ 7 Reklamation", "§ 8 Datenschutz", "§ 9 Haftung", "§ 10 Laufzeit und Kündigung", "§ 11 Vertraulichkeit", "§ 12 Schlussbestimmungen"]);
    const all = partsOf(blocks).join("\n");
    for (const must of ["Der Kunde handelt als Unternehmer (§ 14 BGB) und nicht als Verbraucher.", "Er schuldet nicht, dass aus einem Lead ein Auftrag wird", "Die Menge ist ein Ziel, keine Garantie.", "Der Preis je geliefertem Lead beträgt {{preis}} zuzüglich gesetzlicher Umsatzsteuer.", "Vorkasse gibt es nicht.", "nur aus diesen Gründen reklamieren", "innerhalb von 7 Tagen nach der Lieferung in Textform", "eigene Verantwortliche nach der DSGVO", "Einwilligung des Interessenten", "Art. 14 DSGVO", "Vorsatz und grober Fahrlässigkeit", "wesentliche Pflicht", "typisch und vorhersehbar", "mit einer Frist von 14 Tagen zum Monatsende", "Eine Mindestabnahme gibt es nicht.", "Geschäftsbedingungen des Kunden gelten nicht", "Ist der Kunde Kaufmann, ist der Gerichtsstand der Sitz des Anbieters.", "Dieser Vertrag wird elektronisch geschlossen."]) expect(all).toContain(must);
    expect(all).not.toMatch(/Schriftform|schriftlich/); // E-Mail genügt (Textform) – eine Schriftform-Pflicht wäre in Vorlagen unwirksam oder unpraktisch
    expect(all).toMatch(/Vertragsstrafe in Höhe des dreifachen Lead-Preises/); expect(all).toMatch(/schuldhaft an Dritte weiter/); // Vertragsstrafe nur bei Verschulden und in maßvoller Höhe
  });
  it("Testphase: endet von selbst, keine Folgekosten ohne neue Vereinbarung – mit Datenschutz, Haftung und Schluss", () => {
    const { blocks } = contractStarter("testphase"); const all = partsOf(blocks).join("\n");
    expect(headings(blocks).slice(1)).toEqual(["§ 1 Gegenstand", "§ 2 Dauer und Umfang der Testphase", "§ 3 Nach der Testphase", "§ 4 Mitwirkung des Kunden", "§ 5 Vergütung und Abrechnung", "§ 6 Mängel und Ersatz", "§ 7 Datenschutz und Vertraulichkeit", "§ 8 Haftung", "§ 9 Schlussbestimmungen"]);
    for (const must of ["Die Testphase endet von selbst", "Eine Kündigung ist nicht nötig.", "keine Kosten und keine Pflicht zur Abnahme", CONTRACT_CLAUSES.unternehmer, CONTRACT_CLAUSES.haftung[0], "Diese Vereinbarung wird elektronisch geschlossen."]) expect(all).toContain(must);
  });
  it("jeder Platzhalter im Text hat eine Angabe – und Sätze bleiben kurz", () => {
    for (const kind of ["leadliefervertrag", "testphase"] as const) {
      const { blocks } = contractStarter(kind); const keys = new Set(blocks.filter((block) => block.type === "detail").map((block) => (block as { key: string }).key)); const known = new Set(CONTRACT_PLACEHOLDERS.map((item) => item.replace(/[{}]/g, "")));
      const parts = partsOf(blocks); const used = new Set(parts.flatMap((part) => Array.from(part.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)).map((match) => match[1])));
      for (const key of used) expect(keys.has(key) || known.has(key), `Platzhalter {{${key}}} in ${kind}`).toBe(true);
      const sentences = parts.flatMap((part) => part.replace(/^\(\d+\)\s*/, "").split(/(?<=[.!?:;])\s+/)).filter(Boolean); const words = sentences.map((sentence) => sentence.split(/\s+/).length);
      expect(Math.max(...words), `längster Satz in ${kind}`).toBeLessThanOrEqual(28); expect(words.reduce((sum, value) => sum + value, 0) / words.length).toBeLessThan(14); // einfache Sprache: kurze Sätze
      expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length); // jeder Baustein hat eine eigene Kennung
    }
    expect(DETAIL_PRESETS.abrechnung).toContain("monatlich"); expect(contractStarter("leadliefervertrag").blocks.find((block) => block.type === "detail" && block.key === "abrechnung")).toMatchObject({ value: "monatlich" });
  });
  it("dieselben Regeln gelten für die KI und für Verträge ohne KI", () => {
    expect(CONTRACT_AI_SYSTEM).toContain(CONTRACT_CLAUSES.unternehmer); expect(CONTRACT_AI_SYSTEM).toContain(CONTRACT_CLAUSES.haftung[1]); expect(CONTRACT_AI_SYSTEM).toContain("einfacher Sprache"); expect(CONTRACT_AI_SYSTEM).toContain("Dieser Vertrag wird elektronisch geschlossen.");
    const plain = fallbackContractFromPrompt("Wir vermieten einen Stellplatz an die Firma"); const text = plain.blocks.filter((block) => block.type === "text").map((block) => (block as { text: string }).text).join("\n");
    expect(text).toContain(CONTRACT_CLAUSES.unternehmer); expect(text).toContain(CONTRACT_CLAUSES.haftung[0]); expect(text).toContain("Geschäftsbedingungen des Kunden gelten nicht");
  });
});

import { smoothQualifyPhrase } from "../shared/email-campaigns";
describe("Formulierung Vorqualifizierung", () => {
  it("glättet „qualifiziert über … Fragen“ in allen Varianten", () => {
    expect(smoothQualifyPhrase("20 Test-Leads kostenlos an, telefonisch qualifiziert über rund zehn Fragen, sodass er weiß")).toBe("20 Test-Leads kostenlos an, in der Regel anhand von zehn Fragen telefonisch vorqualifiziert, sodass er weiß");
    expect(smoothQualifyPhrase("volle Transparenz – telefonisch qualifiziert über in der Regel 10 Fragen und in Echtzeit")).toBe("volle Transparenz – in der Regel anhand von zehn Fragen telefonisch vorqualifiziert und in Echtzeit");
    expect(smoothQualifyPhrase("Unsere Anfragen werden telefonisch qualifiziert – in der Regel über 10 Fragen, sodass")).toBe("Unsere Anfragen werden in der Regel anhand von zehn Fragen telefonisch vorqualifiziert, sodass");
    expect(smoothQualifyPhrase("• Telefonisch qualifiziert, in der Regel über 10 Fragen")).toBe("• In der Regel anhand von zehn Fragen telefonisch vorqualifiziert");
    expect(smoothQualifyPhrase("Telefonische Vorqualifizierung jedes Interessenten – in der Regel über 10 Fragen;")).toBe("Telefonische Vorqualifizierung jedes Interessenten anhand von in der Regel zehn Fragen;");
    expect(smoothQualifyPhrase("Lead wird telefonisch qualifiziert – in der Regel über 10 Fragen – und exklusiv")).toBe("Lead wird in der Regel anhand von zehn Fragen telefonisch vorqualifiziert und exklusiv");
    const clean = "in der Regel anhand von zehn Fragen telefonisch vorqualifiziert"; expect(smoothQualifyPhrase(clean)).toBe(clean);
  });
});

import { parsePlzList, regionText, BUNDESLAENDER } from "../shared/contracts";
describe("Liefergebiet im Vertrag", () => {
  it("Deutschlandweit, Bundesländer, PLZ mit Umkreis", () => {
    expect(regionText({ mode: "deutschland" })).toBe("Deutschlandweit");
    expect(regionText({ mode: "bundeslaender", states: ["Hessen", "Bayern"] })).toBe("Bundesländer: Bayern, Hessen");
    expect(regionText({ mode: "bundeslaender", states: ["Hessen"] })).toBe("Bundesland: Hessen");
    expect(regionText({ mode: "bundeslaender", states: [...BUNDESLAENDER] })).toBe("Deutschlandweit (alle Bundesländer)");
    expect(regionText({ mode: "bundeslaender", states: [] })).toBe("");
    expect(parsePlzList("60311, 65183;55116 60311 abc 123456")).toEqual(["60311", "65183", "55116"]);
    expect(regionText({ mode: "plz", plz: ["60311", "65183"], radiusKm: 25 })).toBe("PLZ 60311, 65183 – jeweils im Umkreis von 25 km");
    expect(regionText({ mode: "plz", plz: ["60", "61"], radiusKm: null })).toBe("PLZ-Gebiete 60, 61");
  });
});

import { cleanDraftText, dropPortalMentions } from "../shared/email-campaigns";
describe("Aroundhome nie in E-Mails", () => {
  it("entfernt Sätze mit Aroundhome (auch „Around Home“), Rest bleibt", () => {
    const text = "Sehr geehrter Herr Kurz,\n\nauf Aroundhome haben Sie 120 Bewertungen mit 4,8 Sternen. Das zeigt Qualität.\n\nIhre Google-Bewertungen sind stark. Bei Around Home sind Sie Partner.\n\nVielen Dank";
    const out = dropPortalMentions(text);
    expect(out).not.toMatch(/around\s*-?\s*home/i); expect(out).toContain("Das zeigt Qualität."); expect(out).toContain("Ihre Google-Bewertungen sind stark."); expect(out).toContain("Vielen Dank");
    expect(cleanDraftText("Text ohne Portal.")).toBe("Text ohne Portal.");
  });
});

import { sentSourceOf, subjectFromTemplate } from "../shared/email-campaigns";
describe("Gesendet: KI-Text oder Vorlage", () => {
  it("erkennt die Herkunft gespeichert und bei älteren E-Mails aus Betreff/Entwurf", () => {
    expect(subjectFromTemplate("Kurze Frage zu Ihrem Bedarf, {{vorname}}", "Kurze Frage zu Ihrem Bedarf, Peter")).toBe(true);
    expect(subjectFromTemplate("Mehr Anfragen für {{firma}} – ohne Risiko", "Ihre 12 Standorte und neue Anfragen")).toBe(false);
    expect(sentSourceOf({ bodySource: "ki" })).toEqual({ source: "ki", known: true });
    expect(sentSourceOf({ bodySource: "entwurf-vorlage" })).toEqual({ source: "entwurf-vorlage", known: true });
    expect(sentSourceOf({ subject: "Ihre 12 Standorte", draftSubject: "Ihre 12 Standorte", draftSource: "ki" })).toEqual({ source: "ki", known: true });
    expect(sentSourceOf({ subject: "Mehr Anfragen für Hansen", draftSubject: "Mehr Anfragen für Hansen", draftSource: "vorlage" })).toEqual({ source: "entwurf-vorlage", known: true });
    expect(sentSourceOf({ subject: "Mehr Anfragen für Hansen – ohne Risiko", templateSubjects: ["Mehr Anfragen für {{firma}} – ohne Risiko"] })).toEqual({ source: "vorlage", known: false });
    expect(sentSourceOf({ subject: "Direkte Zusammenarbeit statt Umweg über Zwischenhändler – Hansen" })).toEqual({ source: "entwurf-vorlage", known: false });
    expect(sentSourceOf({ subject: "Ihre Website verspricht 0 % Risiko", templateSubjects: ["Mehr Anfragen für {{firma}}"] })).toEqual({ source: "ki", known: false });
    expect(sentSourceOf({ subject: "Ihre Website verspricht 0 % Risiko", templateSubjects: ["Mehr Anfragen für {{firma}}"], kiOn: false })).toEqual({ source: "vorlage", known: false }); // Kampagne ohne KI → Vorlage
    expect(sentSourceOf({ bodySource: "hand" })).toEqual({ source: "hand", known: true });
  });
});

import { providerEventKind } from "./mail-events";
describe("Öffnungen vom Versanddienst", () => {
  it("erkennt Brevo-, Mailgun- und Postmark-Ereignisse, Apple-Proxy zählt nicht", () => {
    expect(providerEventKind("opened")).toBe("open"); expect(providerEventKind("unique_opened")).toBe("open"); expect(providerEventKind("Open")).toBe("open");
    expect(providerEventKind("click")).toBe("click"); expect(providerEventKind("clicked")).toBe("click"); expect(providerEventKind("Click")).toBe("click");
    expect(providerEventKind("proxy_open")).toBeNull(); expect(providerEventKind("loadedByProxy")).toBeNull(); expect(providerEventKind("hard_bounce")).toBeNull();
  });
});
