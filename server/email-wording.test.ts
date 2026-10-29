import { describe, expect, it } from "vitest";
import { cleanDraftText, dropAdPlatforms, fixTreeQuestions, modernizeTree, shortParagraphs, splitSentences, starterTree, TEST_LEADS, thirdPartyTemplate, withTestOffer, type EmailTree } from "../shared/email-campaigns";
import { starterBlocks } from "../shared/email-design";
import { polishBlocks, sanitizeDraft, heuristicEmailDraft } from "../shared/email-ai";
import { resolveSparte } from "../shared/lead-sparte";

describe("E-Mail-Texte: online statt Meta, kurze Absätze", () => {
  it("wie wir Leads gewinnen: „online“ – nie Meta, Facebook, Instagram oder Social Media", () => {
    expect(dropAdPlatforms("• Eigene Leadgenerierung über Meta-Kampagnen (Facebook und Instagram)")).toBe("• Eigene Online-Leadgenerierung");
    expect(dropAdPlatforms("Interessenten aus eigener Generierung über Meta-Kampagnen (Facebook/Instagram), telefonisch vorqualifiziert.")).toBe("Interessenten aus eigener Online-Generierung, telefonisch vorqualifiziert.");
    expect(dropAdPlatforms("Wir generieren unsere Leads über eigene Meta-Kampagnen auf Facebook und Instagram.")).toBe("Wir generieren unsere Leads online.");
    expect(dropAdPlatforms("Über Meta-Kampagnen gewinnen wir täglich neue Interessenten.")).toBe("Online gewinnen wir täglich neue Interessenten.");
    expect(dropAdPlatforms("Unsere Facebook- und Instagram-Kampagnen erreichen Senioren.")).toBe("Unsere Online-Kampagnen erreichen Senioren.");
    expect(dropAdPlatforms("Wir gewinnen die Interessenten über Social-Media-Kampagnen in Ihrer Region.")).toBe("Wir gewinnen die Interessenten online in Ihrer Region.");
    // Webseite der Firma oder Google-Bewertungen bleiben unberührt
    for (const text of ["Auf Ihrer Facebook-Seite zeigen Sie viele Projekte.", "Ihre Google-Bewertungen sind stark.", "Metallbau seit 1990."]) expect(dropAdPlatforms(text)).toBe(text);
    expect(cleanDraftText("Sehr geehrte Damen und Herren,\n\nunsere Leads gewinnen wir über Meta-Kampagnen.\n\nVielen Dank")).toBe("Sehr geehrte Damen und Herren,\n\nunsere Leads gewinnen wir online.\n\nVielen Dank");
  });
  it("Sätze: „z. B.“, „u. a.“, Datum und Klammern trennen keinen Satz", () => {
    expect(splitSentences("Wir prüfen z. B. die Krankenkasse. Am 28. Oktober geht es los (u. a. in Kassel). Danach melden wir uns!")).toEqual(["Wir prüfen z. B. die Krankenkasse.", "Am 28. Oktober geht es los (u. a. in Kassel).", "Danach melden wir uns!"]);
    expect(splitSentences("Abgefragt werden beispielsweise die Krankenkasse, der Pflegegrad usw. Der Interessent weiß danach Bescheid.")).toEqual(["Abgefragt werden beispielsweise die Krankenkasse, der Pflegegrad usw.", "Der Interessent weiß danach Bescheid."]); // „usw.“ am Satzende
  });
  it("kurze Absätze: lange Absätze werden an Satzgrenzen geteilt – zwei bis drei Zeilen, dann eine Leerzeile", () => {
    const long = "wir von Tanesco Digital gehören zu den größten Lead-Lieferanten in Deutschland für Hausnotruf. Die Interessenten gewinnen wir selbst online. Unsere Anfragen werden in der Regel anhand von sechs Fragen (z. B. Krankenkasse, Pflegegrad und Wohnsituation) telefonisch vorqualifiziert, sodass der Interessent weiß, dass sich der Anbieter bei ihm meldet. Die Übergabe läuft in Echtzeit per Schnittstelle, ohne Vorkasse und ohne lange Bindung.";
    const text = `Sehr geehrte Damen und Herren,\n\n${long}\n\n• Punkt eins\n• Punkt zwei\n\nVielen Dank`;
    const out = shortParagraphs(text); const paragraphs = out.split("\n\n");
    expect(paragraphs.length).toBeGreaterThan(4); expect(paragraphs.every((part) => part.length <= 260 || /\n/.test(part))).toBe(true);
    expect(out.replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " ")); // kein Wort verloren, kein Satz zerschnitten
    expect(out).toContain("• Punkt eins\n• Punkt zwei"); expect(out.endsWith("Vielen Dank")).toBe(true); // Aufzählung und Schluss bleiben
    expect(shortParagraphs(out)).toBe(out); // mehrfach ohne Nebenwirkung
    expect(shortParagraphs("Kurzer Absatz.\n\nNoch einer.")).toBe("Kurzer Absatz.\n\nNoch einer.");
    // Qualifizierung und Beispiele bleiben zusammen, die Logik-Kette bekommt einen eigenen Absatz
    const qualify = "Unsere Anfragen werden in der Regel anhand von sechs Fragen telefonisch vorqualifiziert. Abgefragt werden beispielsweise die Krankenkasse, bei der der Interessent versichert ist, der Pflegegrad, die Wohnsituation usw.";
    const chain = "Der Interessent weiß danach, dass sich ein Anbieter bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet also auf Ihren Anruf.";
    expect(shortParagraphs(`Wir sind Tanesco Digital. ${qualify} ${chain}`)).toBe(`Wir sind Tanesco Digital. ${qualify}\n\n${chain}`);
    expect(shortParagraphs(`${qualify}\n\n${chain}`)).toBe(`${qualify}\n\n${chain}`);
  });
  it("feste Vorlagen: online, kurze Absätze, Fragen mit Beispielen (ohne Klammern) und Logik-Kette", () => {
    const third = thirdPartyTemplate({ firma: "Notruf Nord GmbH" }, resolveSparte("Hausnotruf")!).text;
    expect(third).not.toMatch(/Meta|Facebook|Instagram/); expect(third).toContain("Eigene Online-Leadgenerierung"); expect(third).not.toMatch(/\(z\. ?B\./);
    expect(third).toContain("• Telefonische Vorqualifizierung jedes Interessenten anhand von in der Regel sechs Fragen – beispielsweise die Krankenkasse, bei der der Interessent versichert ist, der Pflegegrad, die Wohnsituation usw.\n• Der Interessent weiß, dass sich ein Anbieter bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet auf Ihren Anruf\n");
    expect(third.split("\n\n").every((part) => part.length <= 260 || /\n/.test(part))).toBe(true);
    for (const kind of ["kaltakquise", "nachfassen", "angebot", "aufwecken"] as const) {
      const texts = starterBlocks(kind).flatMap((block) => block.type === "text" ? [block.text] : []);
      expect(texts.join(" ")).not.toMatch(/Meta|Facebook|Instagram/);
      expect(texts.every((text) => text.split("\n\n").every((part) => part.length <= 260))).toBe(true);
    }
    expect(starterBlocks("kaltakquise").map((block) => (block.type === "text" ? block.text : "")).join(" ")).toContain("selbst online");
  });
  it("gespeicherte Vorlagen werden aufgefrischt: Meta raus, lange Absätze geteilt", () => {
    const tree = starterTree({ first: [{ id: "t", type: "text", text: "{{begruessung}},\n\nwir sind Tanesco Digital und gewinnen unsere Leads über Meta-Kampagnen (Facebook und Instagram) in ganz Deutschland. Jede Anfrage wird in der Regel anhand von zehn Fragen telefonisch vorqualifiziert, sodass der Interessent weiß, dass sich der Betrieb bei ihm meldet. Die Übergabe läuft exklusiv und in Echtzeit." }, { id: "b", type: "bullets", items: ["Eigene Leadgenerierung über Meta-Kampagnen (Facebook und Instagram)"] }], followUp: [{ id: "f", type: "text", text: "Kurz nachgefragt." }] }) as EmailTree;
    const fresh = modernizeTree(tree)!; const json = JSON.stringify(fresh);
    expect(json).not.toMatch(/Meta|Facebook|Instagram/); expect(json).toContain("Eigene Online-Leadgenerierung"); expect(json).toContain("gewinnen unsere Leads online in ganz Deutschland");
    const send = fresh.nodes.find((node) => node.type === "send") as Extract<EmailTree["nodes"][number], { type: "send" }>;
    const text = send.blocks.find((block) => block.type === "text") as { text: string }; expect(text.text.split("\n\n").length).toBeGreaterThan(2);
    expect(modernizeTree(fresh)).toBeNull(); // nichts mehr zu ändern
  });
  it("Test-Angebot: 10 statt 20 Test-Leads – in festen Vorlagen, gespeicherten Abläufen (auch Betreff), Entwürfen; andere Zahlen bleiben", () => {
    expect(TEST_LEADS).toBe(10);
    expect(JSON.stringify(starterTree({ first: starterBlocks("kaltakquise"), followUp: starterBlocks("nachfassen") }))).not.toMatch(/\b20\b/); // feste Vorlagen nennen nur noch 10
    expect(thirdPartyTemplate({ firma: "Muster GmbH" }, resolveSparte("Hausnotruf")!).text).toContain("10 Test-Leads kostenlos");
    for (const [input, output] of [
      ["Zum Kennenlernen: 20 Test-Leads kostenlos, individuell für Ihren Betrieb.", "Zum Kennenlernen: 10 Test-Leads kostenlos, individuell für Ihren Betrieb."],
      ["Wir bieten Ihnen 20 kostenlose Test-Leads an.", "Wir bieten Ihnen 10 kostenlose Test-Leads an."],
      ["Die ersten 20 Leads sind kostenlos.", "Die ersten 10 Leads sind kostenlos."],
      ["Zwanzig Test-Leads gratis – ohne Risiko.", "Zehn Test-Leads gratis – ohne Risiko."],
      ["Sie zahlen 20 € je Lead, 20 Test-Leads kostenlos.", "Sie zahlen 20 € je Lead, 10 Test-Leads kostenlos."], // nur das Angebot
      ["Wir liefern monatlich 20 Leads in Ihre Region.", "Wir liefern monatlich 20 Leads in Ihre Region."], // andere Zahl bleibt
    ]) { expect(withTestOffer(input)).toBe(output); expect(withTestOffer(output)).toBe(output); }
    // gespeicherter Ablauf von früher: Text, Aufzählung, Nachfass-Mail und Betreff
    const old = starterTree({ first: [{ id: "t", type: "text", text: "{{begruessung}},\n\nZum Kennenlernen: 20 Test-Leads kostenlos." }, { id: "b", type: "bullets", items: ["20 Test-Leads kostenlos – individuell für Ihren Betrieb"] }], followUp: [{ id: "f", type: "text", text: "Das Angebot steht weiterhin: 20 Test-Leads kostenlos." }] }) as EmailTree;
    const first = old.nodes[0]; if (first.type === "send") first.subject = "20 Test-Leads kostenlos für {{firma}}";
    const fresh = JSON.stringify(modernizeTree(old)); expect(fresh).not.toMatch(/\b20\b/); expect(fresh.match(/10 Test-Leads/g)).toHaveLength(5); // Betreff, Text, Aufzählung und die Nachfass-Mail in beiden Zweigen
    expect(JSON.stringify(fixTreeQuestions(old, resolveSparte("Hausnotruf")!))).not.toMatch(/20 Test-Leads/); // auch beim Speichern/Start über die Sparten-Anpassung
    expect(cleanDraftText("Zum Kennenlernen bekommen Sie 20 Test-Leads kostenlos.")).toBe("Zum Kennenlernen bekommen Sie 10 Test-Leads kostenlos."); // offene Entwürfe
  });
  it("KI-Vorlagen-Builder: Texte in kurzen Absätzen, nie Meta", () => {
    const fallback = heuristicEmailDraft({ brief: "Hausnotruf-Anbieter ansprechen", goal: "frei", tone: "freundlich", length: "mittel" } as never);
    const draft = sanitizeDraft({ subject: "Leads über Meta-Kampagnen", preheader: "", blocks: [{ type: "text", text: "{{begruessung}},\n\nwir gewinnen Interessenten über Meta-Kampagnen auf Facebook und Instagram. Jede Anfrage wird telefonisch vorqualifiziert und geht exklusiv an Sie. Sie zahlen keine Vorkasse und gehen keine lange Bindung ein. Zum Kennenlernen gibt es 20 Test-Leads kostenlos, individuell für Ihren Betrieb." }] }, fallback);
    expect(draft.subject).toBe("Leads online"); expect(JSON.stringify(draft.blocks)).not.toMatch(/Meta|Facebook|Instagram/);
    expect(polishBlocks([{ id: "x", type: "bullets", items: ["über Meta-Kampagnen"] }])).toEqual([{ id: "x", type: "bullets", items: ["online"] }]);
    const heuristic = fallback.blocks.find((block) => block.type === "text") as { text: string } | undefined; expect(heuristic?.text.split("\n\n").length).toBeGreaterThanOrEqual(3); // Anrede, Einstieg, Inhalt – getrennte Absätze
  });
});
