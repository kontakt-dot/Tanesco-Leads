import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("./_core/llm", () => ({ invokeLLM: invoke }));
const answer = (content: Record<string, unknown>) => ({ id: "stub", created: 0, model: "stub", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(content) }, finish_reason: "stop" }] });

const template = { subject: "Mehr qualifizierte Anfragen für Notruf Nord GmbH", text: "Sehr geehrte Damen und Herren,\n\nwir von Tanesco Digital gehören zu den größten Lead-Lieferanten in Deutschland für Hausnotruf. Unsere Anfragen gehen exklusiv und in Echtzeit an Sie, damit Ihr Vertrieb ohne Umwege mit den Interessenten sprechen kann.\n\n20 Test-Leads kostenlos – individuell für Ihren Betrieb.\n\nVielen Dank" };
const info = { Firma: "Notruf Nord GmbH", Ort: "Kassel", Webseite: "notruf-nord.de" };
const site = { url: "https://notruf-nord.de", text: "Notruf Nord – Ihr Hausnotruf in Kassel. Installation am Tag nach der Bestellung. Über 2.000 Kunden in Nordhessen." };
const own = "Sehr geehrte Damen und Herren,\n\nauf Ihrer Webseite steht, dass der Hausnotruf bei Ihnen schon am Tag nach der Bestellung installiert ist. Genau diese Geschwindigkeit erwarten die Familien, die sich bei uns melden – meist Kinder, die für ihre Eltern in Kassel und Nordhessen eine Lösung suchen. Viele Lead-Anbieter verkaufen dieselbe Anfrage an mehrere Betriebe; bei uns geht jede nur an Sie.\n\nZum Kennenlernen: 20 Test-Leads kostenlos, in der Regel anhand von sechs Fragen telefonisch vorqualifiziert.";

describe("Freier Vorschlag: wirklich auf die Firma geschrieben – schwache Texte werden neu geschrieben, nie durch die Vorlage ersetzt", () => {
  const before = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => { invoke.mockReset(); process.env.ANTHROPIC_API_KEY = "test-key"; });
  afterAll(() => { if (before === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = before; });
  it("ein eigener Text mit konkreten Bezügen bleibt – auch wenn er allgemein über Lead-Anbieter klagt", async () => {
    const { aiDrafts } = await import("./campaign-review"); const { resolveSparte } = await import("../shared/lead-sparte");
    invoke.mockResolvedValueOnce(answer({ frei: { subject: "Installation am Tag nach der Bestellung", text: own, bezuege: ["Installation am Tag nach der Bestellung (Webseite)", "Kassel und Nordhessen"] } }));
    const result = await aiDrafts(template, info, site, { approaches: ["frei"], sparte: resolveSparte("Hausnotruf")! });
    expect(result?.map((item) => item.key)).toEqual(["frei"]); expect(result?.[0].text).toContain("am Tag nach der Bestellung"); expect(result?.[0].issues).toEqual([]);
    // was die KI zu hören bekommt: Sparte, sechs Fragen, keine Sätze aus der Vorlage, Bezüge nennen
    const call = invoke.mock.calls[0][0] as { messages: Array<{ role: string; content: string }>; outputSchema: { schema: { properties: Record<string, { required: string[] }> } } };
    const system = call.messages[0].content; const user = call.messages[1].content;
    expect(system).toContain("in der Regel anhand von sechs Fragen telefonisch vorqualifiziert – abgefragt werden beispielsweise die Krankenkasse, der Pflegegrad, die Wohnsituation des Interessenten usw."); expect(system).not.toContain("zehn Fragen");
    expect(system).toContain("ohne Klammern: „Abgefragt werden beispielsweise die Krankenkasse, der Pflegegrad, die Wohnsituation des Interessenten usw.“"); expect(system).toContain("Nie Klammern für die Beispiele"); // Beispiele als eigener Satz
    expect(system).toContain("„Der Interessent weiß danach, dass sich ein Anbieter bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet also auf Ihren Anruf.“"); // Logik-Kette
    expect(system).not.toMatch(/Meta-Kampagnen|\(Facebook/); expect(system).toContain("selbst online generieren"); expect(system).toContain("nenne NIE Meta, Facebook, Instagram"); // online statt Meta
    expect(system).toContain("je Absatz ein bis drei Sätze"); // kurze Absätze
    expect(system).toContain("Übernimm KEINEN Satz aus der Vorlage"); expect(system).toContain("mindestens zwei konkrete Punkte"); expect(system).toContain("Geschäftsführung laut Impressum"); expect(system).toContain("kreative Idee");
    expect(system).not.toContain("\"individuell\""); expect(system).not.toMatch(/individuelle[nr]? Ansatz/); expect(system).toContain("Regeln für beide"); // nur noch Drittanbieter und frei
    expect(user).toContain("bezuege"); expect(call.outputSchema.schema.properties.frei.required).toContain("bezuege"); expect(Object.keys(call.outputSchema.schema.properties)).toEqual(["frei"]);
    // beide Vorschläge auf einmal: genau Drittanbieter und frei
    invoke.mockResolvedValueOnce(answer({ drittanbieter: { subject: "Direkt statt über Zwischenhändler", text: `${own}\n\nSehr wahrscheinlich kommen bei Ihnen Leads an, die ohnehin von uns stammen – über Zwischenhändler.`, bezuege: ["Kassel"] }, frei: { subject: "Installation am Tag nach der Bestellung", text: own, bezuege: ["Installation am Tag nach der Bestellung", "Nordhessen"] } }));
    const both = await aiDrafts(template, info, site, { sparte: resolveSparte("Hausnotruf")! });
    expect(both?.map((item) => item.key)).toEqual(["drittanbieter", "frei"]);
    const second = invoke.mock.calls[1][0] as { messages: Array<{ content: string }>; outputSchema: { schema: { required: string[] } } };
    expect(second.outputSchema.schema.required).toEqual(["drittanbieter", "frei"]); expect(second.messages[1].content).toContain("Schreibe beide Vorschläge");
  });
  it("neue Leadsparte: die KI nennt drei passende Punkte als Beispiele (ohne Klammern) – bekannte Sparten haben feste Punkte", async () => {
    const { aiDrafts } = await import("./campaign-review"); const { resolveSparte } = await import("../shared/lead-sparte");
    invoke.mockResolvedValueOnce(answer({ frei: { subject: "Pools in Kassel", text: own, bezuege: ["Kassel", "Webseite"] } }));
    await aiDrafts(template, info, site, { approaches: ["frei"], sparte: resolveSparte("Pool-Bau")! });
    const system = (invoke.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0].content;
    expect(system).toContain("drei typischen Punkten, die bei Anfragen zu Pool-Bau am Telefon abgefragt werden – ohne Klammern"); expect(system).toContain("„Abgefragt werden beispielsweise …, …, … usw.“"); expect(system).toContain("anhand gezielter Fragen telefonisch vorqualifiziert");
  });
  it("abgeschriebene Vorlage oder ohne Bezüge auf die Firma → als schwach markiert (die KI schreibt ihn mit genauem Hinweis neu) – nie weggeworfen", async () => {
    const { aiDrafts, retryNoteFor } = await import("./campaign-review"); const { resolveSparte } = await import("../shared/lead-sparte");
    const sparte = resolveSparte("Hausnotruf")!;
    invoke.mockResolvedValueOnce(answer({ frei: { subject: "Mehr Anfragen", text: template.text.replace("Sehr geehrte Damen und Herren", "Sehr geehrter Herr Wiebe"), bezuege: ["Firma", "Ort"] } }));
    expect((await aiDrafts(template, info, site, { approaches: ["frei"], sparte }))?.[0].issues).toEqual(["vorlage"]); // nur die Vorlage mit anderem Namen
    invoke.mockResolvedValueOnce(answer({ frei: { subject: "Kurze Frage", text: own, bezuege: [] } }));
    expect((await aiDrafts(template, info, site, { approaches: ["frei"], sparte }))?.[0].issues).toEqual(["bezuege"]); // keine Bezüge genannt
    invoke.mockResolvedValueOnce(answer({ frei: { subject: "Kurze Frage", text: own, bezuege: ["Kassel"] } }));
    expect((await aiDrafts(template, info, null, { approaches: ["frei"], sparte }))?.[0].issues).toEqual([]); // ohne Webseite reicht ein Bezug
    expect(retryNoteFor("frei", ["bezuege"])).toContain("Impressum"); expect(retryNoteFor("frei", ["vorlage"])).toContain("kein Satz aus der Vorlage"); expect(retryNoteFor("frei", null)).toContain("freien Vorschlag");
    // der Drittanbieter-Ansatz hat seine eigenen Regeln (Kernbotschaft) – dort keine Bezugs- oder Vorlagen-Prüfung
    invoke.mockResolvedValueOnce(answer({ drittanbieter: { subject: "Direkte Zusammenarbeit", text: `${own}\n\nSehr wahrscheinlich kommen bei Ihnen Leads an, die ohnehin von uns stammen.`, bezuege: [] } }));
    expect((await aiDrafts(template, info, site, { approaches: ["drittanbieter"], sparte }))?.[0]).toMatchObject({ key: "drittanbieter", issues: [] });
    // zweiter Versuch mit Hinweis
    invoke.mockResolvedValueOnce(answer({ frei: { subject: "Installation am Tag nach der Bestellung", text: own, bezuege: ["Webseite", "Region"] } }));
    const retry = await aiDrafts(template, info, site, { approaches: ["frei"], sparte, retryNote: "Wichtig: Der vorige Entwurf war zu allgemein." });
    expect(retry?.[0].key).toBe("frei"); expect(String((invoke.mock.calls.at(-1)![0] as { messages: Array<{ content: string }> }).messages[1].content)).toContain("Der vorige Entwurf war zu allgemein");
  });
  it("Wärmepumpen-Leads an eine Hausnotruf-Firma → verworfen; Drittanbieter-Kernbotschaft im freien Vorschlag → nur dieser Satz raus", async () => {
    const { aiDrafts } = await import("./campaign-review"); const { resolveSparte } = await import("../shared/lead-sparte");
    const sparte = resolveSparte("Hausnotruf")!;
    invoke.mockResolvedValueOnce(answer({ frei: { subject: "Mehr Anfragen", text: own.replace("Zum Kennenlernen", "Unsere Wärmepumpen-Leads sind geprüft. Zum Kennenlernen"), bezuege: ["Webseite", "Region"] } }));
    expect(await aiDrafts(template, info, site, { approaches: ["frei"], sparte })).toBeNull(); // falsches Thema
    invoke.mockResolvedValueOnce(answer({ frei: { subject: "Außensirene mit Solarpanel", text: own.replace("Viele Lead-Anbieter", "Auch Ihre Außensirenen mit Solarpanel kennen wir. Viele Lead-Anbieter"), bezuege: ["Webseite", "Region"] } }));
    expect((await aiDrafts(template, info, site, { approaches: ["frei"], sparte }))?.[0].issues).toEqual([]); // ein Detail von der Webseite ist kein falsches Thema
    invoke.mockResolvedValueOnce(answer({ frei: { subject: "Installation am Tag nach der Bestellung", text: `${own}\n\nSehr wahrscheinlich stammen Ihre Anfragen ohnehin von uns.`, bezuege: ["Webseite", "Region"] } }));
    const cleaned = await aiDrafts(template, info, site, { approaches: ["frei"], sparte });
    expect(cleaned?.[0].text).toContain("am Tag nach der Bestellung"); expect(cleaned?.[0].text).not.toContain("ohnehin von uns");
    invoke.mockResolvedValueOnce(answer({ frei: { subject: "Unsere Leads", text: "Sehr geehrte Damen und Herren,\n\nSehr wahrscheinlich stammen Ihre Anfragen ohnehin von uns – nur über Zwischenhändler. Darüber sollten wir sprechen, finden Sie nicht?", bezuege: ["Webseite", "Region"] } }));
    expect(await aiDrafts(template, info, site, { approaches: ["frei"], sparte })).toBeNull(); // fast nur die Kernbotschaft – dann lieber neu schreiben
  });
});
