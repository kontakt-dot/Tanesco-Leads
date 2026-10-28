import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("./_core/llm", () => ({ invokeLLM: invoke }));
const answer = (content: Record<string, unknown>) => ({ id: "stub", created: 0, model: "stub", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(content) }, finish_reason: "stop" }] });

const template = { subject: "Mehr qualifizierte Anfragen für Notruf Nord GmbH", text: "Sehr geehrte Damen und Herren,\n\nwir von Tanesco Digital gehören zu den größten Lead-Lieferanten in Deutschland für Hausnotruf. Unsere Anfragen gehen exklusiv und in Echtzeit an Sie, damit Ihr Vertrieb ohne Umwege mit den Interessenten sprechen kann.\n\n20 Test-Leads kostenlos – individuell für Ihren Betrieb.\n\nVielen Dank" };
const info = { Firma: "Notruf Nord GmbH", Ort: "Kassel", Webseite: "notruf-nord.de" };
const site = { url: "https://notruf-nord.de", text: "Notruf Nord – Ihr Hausnotruf in Kassel. Installation am Tag nach der Bestellung. Über 2.000 Kunden in Nordhessen." };
const own = "Sehr geehrte Damen und Herren,\n\nauf Ihrer Webseite steht, dass der Hausnotruf bei Ihnen schon am Tag nach der Bestellung installiert ist. Genau diese Geschwindigkeit erwarten die Familien, die sich bei uns melden – meist Kinder, die für ihre Eltern in Kassel und Nordhessen eine Lösung suchen. Viele Lead-Anbieter verkaufen dieselbe Anfrage an mehrere Betriebe; bei uns geht jede nur an Sie.\n\nZum Kennenlernen: 20 Test-Leads kostenlos, in der Regel anhand von sechs Fragen telefonisch vorqualifiziert.";

describe("Individueller Ansatz: wirklich auf die Firma geschrieben – sonst verworfen und neu geschrieben", () => {
  const before = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => { invoke.mockReset(); process.env.ANTHROPIC_API_KEY = "test-key"; });
  afterAll(() => { if (before === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = before; });
  it("ein eigener Text mit konkreten Bezügen bleibt – auch wenn er allgemein über Lead-Anbieter klagt", async () => {
    const { aiDrafts } = await import("./campaign-review"); const { resolveSparte } = await import("../shared/lead-sparte");
    invoke.mockResolvedValueOnce(answer({ individuell: { subject: "Installation am Tag nach der Bestellung", text: own, bezuege: ["Installation am Tag nach der Bestellung (Webseite)", "Kassel und Nordhessen"] } }));
    const result = await aiDrafts(template, info, site, { approaches: ["individuell"], sparte: resolveSparte("Hausnotruf")! });
    expect(result?.map((item) => item.key)).toEqual(["individuell"]); expect(result?.[0].text).toContain("am Tag nach der Bestellung");
    // was die KI zu hören bekommt: Sparte, sechs Fragen, keine Sätze aus der Vorlage, Bezüge nennen
    const call = invoke.mock.calls[0][0] as { messages: Array<{ role: string; content: string }>; outputSchema: { schema: { properties: Record<string, { required: string[] }> } } };
    const system = call.messages[0].content; const user = call.messages[1].content;
    expect(system).toContain("in der Regel anhand von sechs Fragen telefonisch vorqualifiziert"); expect(system).not.toContain("zehn Fragen telefonisch");
    expect(system).toContain("Übernimm KEINEN Satz aus der Vorlage"); expect(system).toContain("Mindestens drei konkrete Bezüge");
    expect(user).toContain("bezuege"); expect(call.outputSchema.schema.properties.individuell.required).toContain("bezuege");
  });
  it("abgeschriebene Vorlage oder ohne Bezüge auf die Firma → kein KI-Text (die KI schreibt ihn neu)", async () => {
    const { aiDrafts } = await import("./campaign-review"); const { resolveSparte } = await import("../shared/lead-sparte");
    const sparte = resolveSparte("Hausnotruf")!;
    invoke.mockResolvedValueOnce(answer({ individuell: { subject: "Mehr Anfragen", text: template.text.replace("Sehr geehrte Damen und Herren", "Sehr geehrter Herr Wiebe"), bezuege: ["Firma", "Ort"] } }));
    expect(await aiDrafts(template, info, site, { approaches: ["individuell"], sparte })).toBeNull(); // nur die Vorlage mit anderem Namen
    invoke.mockResolvedValueOnce(answer({ individuell: { subject: "Kurze Frage", text: own, bezuege: [] } }));
    expect(await aiDrafts(template, info, site, { approaches: ["individuell"], sparte })).toBeNull(); // keine Bezüge genannt
    // der freie Vorschlag bleibt die eigene Idee der KI – geprüft wird auch dort nur, dass er nicht die Vorlage abschreibt
    invoke.mockResolvedValueOnce(answer({ frei: { subject: "Eine Frage zu Nordhessen", text: own.replace("auf Ihrer Webseite steht", "kurze Frage:"), bezuege: [] } }));
    expect((await aiDrafts(template, info, site, { approaches: ["frei"], sparte }))?.[0].key).toBe("frei");
    // zweiter Versuch mit Hinweis
    invoke.mockResolvedValueOnce(answer({ individuell: { subject: "Installation am Tag nach der Bestellung", text: own, bezuege: ["Webseite", "Region"] } }));
    const retry = await aiDrafts(template, info, site, { approaches: ["individuell"], sparte, retryNote: "Wichtig: Der vorige Entwurf war zu allgemein." });
    expect(retry?.[0].key).toBe("individuell"); expect(String((invoke.mock.calls.at(-1)![0] as { messages: Array<{ content: string }> }).messages[1].content)).toContain("Der vorige Entwurf war zu allgemein");
  });
  it("Wärmepumpen-Text an eine Hausnotruf-Firma oder die Drittanbieter-Kernbotschaft im individuellen Ansatz → verworfen", async () => {
    const { aiDrafts } = await import("./campaign-review"); const { resolveSparte } = await import("../shared/lead-sparte");
    const sparte = resolveSparte("Hausnotruf")!;
    invoke.mockResolvedValueOnce(answer({ individuell: { subject: "Wärmepumpen-Leads", text: own.replace("Hausnotruf", "Wärmepumpen"), bezuege: ["Webseite", "Region"] } }));
    expect(await aiDrafts(template, info, site, { approaches: ["individuell"], sparte })).toBeNull();
    invoke.mockResolvedValueOnce(answer({ individuell: { subject: "Direkt statt Umweg", text: `${own}\n\nSehr wahrscheinlich stammen Ihre Anfragen ohnehin von uns.`, bezuege: ["Webseite", "Region"] } }));
    expect(await aiDrafts(template, info, site, { approaches: ["individuell"], sparte })).toBeNull();
  });
});
