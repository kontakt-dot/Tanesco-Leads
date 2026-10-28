import { describe, expect, it } from "vitest";
import { blocksToPlainText, dayStartIn, draftToBlocks, firstSendNode, type EmailTree } from "../shared/email-campaigns";
import { messageIdsIn, normalizeMessageId } from "../shared/message-id";

const tree: EmailTree = { start: "w1", nodes: [
  { id: "w1", type: "wait", hours: 1, next: "c1" },
  { id: "c1", type: "condition", check: "opened", yes: "s1", no: "s2" },
  { id: "s1", type: "send", label: "Erste", subject: "Hallo {{firma}}", blocks: [{ id: "b1", type: "heading", text: "Mehr Anfragen für {{firma}}" }, { id: "b2", type: "text", text: "Guten Tag {{anrede}} {{nachname}},\n\nkurze Frage." }, { id: "b3", type: "bullets", items: ["Punkt A", "Punkt {{stadt}}"] }, { id: "b4", type: "button", text: "Termin", url: "https://x.example" }, { id: "b5", type: "signature", name: "Thomas" }], next: null },
  { id: "s2", type: "send", label: "Zweite", subject: "Zweite", blocks: [], next: null },
] };

describe("Erst-E-Mail einzeln freigeben – Helfer", () => {
  it("Grußformel am Ende wird entfernt – die Signatur bringt „Mit freundlichen Grüßen“ und den Namen schon mit", async () => {
    const { stripClosing } = await import("./campaign-review"); const { thirdPartyTemplate } = await import("../shared/email-campaigns");
    expect(stripClosing("Hallo,\n\nkurzer Text.\n\nMit freundlichen Grüßen")).toBe("Hallo,\n\nkurzer Text.");
    expect(stripClosing("Hallo,\n\nkurzer Text.\n\nViele Grüße\n")).toBe("Hallo,\n\nkurzer Text.");
    expect(stripClosing("Text endet mit Frage: Passt Donnerstag?")).toBe("Text endet mit Frage: Passt Donnerstag?");
    expect(stripClosing("Wir grüßen die Kollegen im Text, nicht am Ende.")).toBe("Wir grüßen die Kollegen im Text, nicht am Ende."); // nur ganze Schlusszeilen
    expect(thirdPartyTemplate({ firma: "Koppen GmbH" }).text).not.toMatch(/Grüßen\s*$/); // feste Vorlage ohne doppelte Grußformel
  });
  it("findet die erste E-Mail des Ablaufs über Warten und Abfragen hinweg", () => { expect(firstSendNode(tree)?.id).toBe("s1"); expect(firstSendNode({ start: null, nodes: [] })).toBeNull(); expect(firstSendNode({ start: "x", nodes: [{ id: "x", type: "end" }] })).toBeNull(); });
  it("macht aus den Bausteinen Fließtext mit gefüllten Platzhaltern – ohne Überschrift, Knopf und Signatur", () => {
    const text = blocksToPlainText(firstSendNode(tree)!.blocks, { firma: "Koppen GmbH", anrede: "Herr", nachname: "Koppen", stadt: "Kassel" });
    expect(text).toBe("Guten Tag Herr Koppen,\n\nkurze Frage.\n\n• Punkt A\n• Punkt Kassel"); expect(text).not.toContain("Termin"); expect(text).not.toContain("Mehr Anfragen");
  });
  it("freigegebener Text ersetzt Überschrift/Text/Aufzählung – nur die Signatur bleibt, kein Knopf", () => {
    const blocks = draftToBlocks("Hallo,\n\npersönlicher Text.", firstSendNode(tree)!.blocks);
    expect(blocks.map((block) => block.type)).toEqual(["text", "signature"]); expect((blocks[0] as { text: string }).text).toBe("Hallo,\n\npersönlicher Text.");
  });
  it("Entwurf-Regeln: nie „Hallo“, Pflichtinhalte, Schluss mit Kontaktweg + Telefon und „Vielen Dank“", async () => {
    const { fixGreeting, finishDraft } = await import("./campaign-review");
    const greeting = "Sehr geehrte Damen und Herren";
    expect(fixGreeting("Hallo Herr Wiebe,\n\nText.", greeting)).toBe("Sehr geehrter Herr Wiebe,\n\nText.");
    expect(fixGreeting("Hallo Frau Kurz,\nText.", greeting)).toBe("Sehr geehrte Frau Kurz,\n\nText.");
    expect(fixGreeting("Hallo Max Muster,\n\nText.", greeting)).toBe("Sehr geehrte Damen und Herren,\n\nText."); // „Guten Tag Max Muster“ gibt es nicht
    expect(fixGreeting("Guten Tag Max Muster,\n\nText.", "Sehr geehrter Herr Muster")).toBe("Sehr geehrter Herr Muster,\n\nText.");
    expect(fixGreeting("Sehr geehrter Max Muster,\n\nText.", greeting)).toBe("Sehr geehrte Damen und Herren,\n\nText.");
    expect(fixGreeting("Hallo,\n\nText.", greeting)).toBe("Sehr geehrte Damen und Herren,\n\nText.");
    expect(fixGreeting("Guten Tag Herr Roth,\n\nText.", greeting)).toBe("Sehr geehrter Herr Roth,\n\nText.");
    expect(fixGreeting("Sehr geehrte Frau Dr. Lenz,\n\nText.", greeting)).toBe("Sehr geehrte Frau Dr. Lenz,\n\nText."); // förmliche Anrede der KI (z. B. aus dem Impressum) bleibt
    expect(fixGreeting("Text ohne Anrede.", "Sehr geehrter Herr Muster")).toBe("Sehr geehrter Herr Muster,\n\nText ohne Anrede.");
    const thin = "Sehr geehrter Herr Wiebe,\n\nauf Ihrer Webseite steht etwas Konkretes.\n\nHätten Sie diese Woche 15 Minuten für ein Gespräch?";
    const done = finishDraft(thin, { greeting, phone: "0611 123456", followUp: false });
    expect(done).toContain("20 Test-Leads kostenlos"); expect(done).toContain("anhand von zehn Fragen telefonisch vorqualifiziert"); expect(done).not.toMatch(/Firmenname/); // Pflichtinhalte ergänzt – ohne Firmennamen-Behauptung
    expect(done).toMatch(/0611 123456/); expect(done.trim().endsWith("Vielen Dank")).toBe(true); expect(done).not.toMatch(/Grüßen/);
    expect(done.indexOf("20 Test-Leads")).toBeLessThan(done.indexOf("15 Minuten")); // Fakten vor dem Schluss
    // Schon vollständig → bleibt bis auf den Schluss unverändert; keine doppelte Nummer, kein doppeltes „Vielen Dank“
    const full = "Sehr geehrte Frau Kurz,\n\nText mit 20 Test-Leads kostenlos, telefonisch qualifiziert über 10 Fragen. Auf Wunsch nennen wir dabei Ihren Firmennamen, sodass der Interessent weiß, dass Sie sich melden.\n\nWenn das für Sie interessant ist, antworten Sie einfach auf diese E-Mail oder rufen Sie mich gerne an unter 0611 123456.\n\nVielen Dank\n\nMit freundlichen Grüßen\nMax";
    const kept = finishDraft(full, { greeting, phone: "0611 123456", followUp: false });
    expect(kept.match(/0611 123456/g)).toHaveLength(1); expect(kept.match(/Vielen Dank/g)).toHaveLength(1); expect(kept).not.toContain("Max"); expect(kept.trim().endsWith("Vielen Dank")).toBe(true);
    expect(kept).not.toMatch(/Firmenname/); expect(kept).toContain("anhand von zehn Fragen telefonisch vorqualifiziert."); // Firmennamen-Satz entfernt, Rest bleibt sauber
    // Ohne Telefon: nur „antworten Sie einfach auf diese E-Mail“; Nachfass-Mail braucht nur das Test-Angebot
    const noPhone = finishDraft("Hallo,\n\nkurzer Nachfass ohne Angebot.", { greeting, phone: "", followUp: true });
    expect(noPhone).toContain("antworten Sie einfach auf diese E-Mail"); expect(noPhone).not.toContain("rufen Sie"); expect(noPhone).toContain("20 Test-Leads"); expect(noPhone).not.toContain("zehn Fragen");
    // Die KI schreibt „Vielen Dank“ schon selbst: das ergänzte Test-Angebot kommt VOR den Schluss, „Vielen Dank“ steht genau einmal ganz unten
    const ki = "Sehr geehrte Damen und Herren,\n\nSie planen Alarmanlagen nach DIN EN 50131. Wir qualifizieren jeden Kontakt in der Regel anhand von acht Fragen telefonisch vor.\n\nWenn Sie das testen möchten, antworten Sie einfach auf diese E-Mail oder rufen Sie mich an unter 0611 123456.\n\nVielen Dank";
    const ordered = finishDraft(ki, { greeting, phone: "0611 123456", followUp: false });
    expect(ordered.indexOf("20 Test-Leads")).toBeLessThan(ordered.indexOf("Wenn Sie das testen möchten")); expect(ordered.match(/Vielen Dank/g)).toHaveLength(1); expect(ordered.trim().endsWith("Vielen Dank")).toBe(true);
  });
  it("Tagesbeginn in Berlin (Sommer- und Winterzeit)", () => {
    expect(dayStartIn(new Date("2026-07-15T10:30:00Z")).toISOString()).toBe("2026-07-14T22:00:00.000Z");
    expect(dayStartIn(new Date("2026-01-15T10:30:00Z")).toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(dayStartIn(new Date("2026-07-15T21:59:59Z")).toISOString()).toBe("2026-07-14T22:00:00.000Z");
    expect(dayStartIn(new Date("2026-07-15T22:00:01Z")).toISOString()).toBe("2026-07-15T22:00:00.000Z");
  });
});

describe("Message-IDs", () => {
  it("vereinheitlicht und zerlegt References", () => {
    expect(normalizeMessageId("<ABC@x.de>")).toBe("abc@x.de"); expect(normalizeMessageId("  ")).toBeNull(); expect(normalizeMessageId(null)).toBeNull();
    expect(messageIdsIn("<a@x.de> <B@y.de>")).toEqual(["a@x.de", "b@y.de"]); expect(messageIdsIn(["<a@x.de>", "c@z.de"])).toEqual(["a@x.de", "c@z.de"]); expect(messageIdsIn("c@z.de")).toEqual(["c@z.de"]); expect(messageIdsIn("")).toEqual([]);
  });
});

describe("Webseite des Kontakts", () => {
  it("nimmt das Feld aus der Liste, sonst die Firmen-Domain der E-Mail – nie Gmail & Co.", async () => {
    const { websiteOf } = await import("./campaign-review");
    expect(websiteOf({ felder: { Webseite: "www.koppen-solar.de" } }, "info@koppen.de")).toBe("www.koppen-solar.de");
    expect(websiteOf({ website: "https://firma.de" }, null)).toBe("https://firma.de");
    expect(websiteOf({}, "info@koppen.de")).toBe("koppen.de");
    expect(websiteOf({}, "max@gmail.com")).toBeNull();
    expect(websiteOf({ felder: { Homepage: "keine" } }, "hans@web.de")).toBeNull();
  });
});

describe("Webseite lesen", () => {
  it("liest Startseite und Leistungen-Seite als Text, blockt interne Adressen", async () => {
    const { vi } = await import("vitest");
    const pages: Record<string, string> = {
      "https://koppen-solar.de/": `<html><head><title>Koppen Solar – PV aus Kassel</title><meta name="description" content="Photovoltaik und Speicher für Privat und Gewerbe"></head><body><nav><a href="/leistungen">Leistungen</a><a href="/impressum">Impressum</a></nav><h1>Ihr Solarteur in Nordhessen</h1><p>Seit 2009 planen und montieren wir Photovoltaikanlagen mit eigenem Montageteam.</p><script>var x=1</script></body></html>`,
      "https://koppen-solar.de/leistungen": `<html><body><h2>Leistungen</h2><ul><li>PV-Anlagen</li><li>Batteriespeicher</li><li>Wallboxen</li></ul></body></html>`,
      "https://koppen-solar.de/impressum": `<html><body><h1>Impressum</h1><p>Koppen Solar GmbH, Kassel. Geschäftsführer: Stefan Koppen. HRB 12345.</p></body></html>`,
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { const html = pages[url]; return html ? new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("nope", { status: 404 }); }));
    try {
      const { readWebsiteText } = await import("./lead-finder");
      const site = await readWebsiteText("koppen-solar.de");
      expect(site?.url).toBe("https://koppen-solar.de/"); expect(site?.pages).toBe(3); // Startseite + Impressum + Leistungen
      expect(site?.text).toContain("Koppen Solar – PV aus Kassel"); expect(site?.text).toContain("eigenem Montageteam"); expect(site?.text).toContain("Batteriespeicher"); expect(site?.text).not.toContain("var x");
      expect(site?.text).toContain("Impressum:"); expect(site?.text).toContain("Geschäftsführer: Stefan Koppen"); // daraus nimmt die KI die Anrede, wenn die Liste keinen Ansprechpartner hat
      expect(await readWebsiteText("localhost:3000")).toBeNull(); expect(await readWebsiteText("192.168.0.1")).toBeNull(); expect(await readWebsiteText("gibts-nicht.de")).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });
});
