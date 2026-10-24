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
  it("freigegebener Text ersetzt Überschrift/Text/Aufzählung – Knopf und Signatur bleiben", () => {
    const blocks = draftToBlocks("Hallo,\n\npersönlicher Text.", firstSendNode(tree)!.blocks);
    expect(blocks.map((block) => block.type)).toEqual(["text", "button", "signature"]); expect((blocks[0] as { text: string }).text).toBe("Hallo,\n\npersönlicher Text.");
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
