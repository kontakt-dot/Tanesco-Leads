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
