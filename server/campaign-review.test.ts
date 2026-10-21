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
