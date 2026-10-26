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
