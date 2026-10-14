import { describe, expect, it } from "vitest";
import { completeDraft, draftIsComplete, draftToNode, draftWordCount, guessGoal, heuristicEmailDraft, heuristicMessageDraft, heuristicSeriesDraft, proposalBrief, sanitizeDraft, seriesToTree, singleToTree, TEMPLATE_PROPOSALS, templateName } from "../shared/email-ai";
import { validateTree } from "../shared/email-campaigns";
import { renderEmailHtml } from "../shared/email-design";
import { extractPhone } from "../shared/pipeline-extras";
import { draftEmail, draftMessage, draftSeries } from "./email-ai";

describe("KI-Vorlagen-Builder (regelbasierter Entwurf)", () => {
  it("errät das Ziel aus der Beschreibung und baut eine vollständige E-Mail mit Platzhaltern", () => {
    expect(guessGoal("Nachfass-Mail nach dem Angebot für Dachdecker")).toBe("angebot"); expect(guessGoal("Kontakte, die lange nichts gesagt haben, aufwecken")).toBe("reaktivierung"); expect(guessGoal("Bitte um Rückruf wegen Wärmepumpe")).toBe("rueckruf"); expect(guessGoal("Erstgespräch für PV anbieten")).toBe("termin");
    const draft = heuristicEmailDraft({ brief: "Nachfass-Mail nach Angebot für Dachdecker, freundlich, mit Terminlink", abTest: true, ctaUrl: "https://tanesco.digital/termin", sender: "Taner Yildiz" });
    expect(draft.subject).toContain("Angebot"); expect(draft.subjectB).toBeTruthy(); expect(draft.blocks.map((block) => block.type)).toEqual(["heading", "text", "bullets", "button", "text", "signature"]);
    const text = draft.blocks.find((block) => block.type === "text"); expect(text && text.type === "text" ? text.text : "").toMatch(/^Guten Tag \{\{anrede\}\} \{\{nachname\}\},/);
    expect(renderEmailHtml(draft.blocks, { primaryColor: "#000", textColor: "#000", background: "#fff", cardBackground: "#fff", font: "Arial" }, { anrede: "Herr", nachname: "Hansen", vorname: "Peter", firma: "Hansen GmbH" })).toContain("Guten Tag Herr Hansen");
    const short = heuristicEmailDraft({ brief: "Kurz Rückruf anbieten", length: "kurz", tone: "locker" }); expect(short.blocks.some((block) => block.type === "bullets")).toBe(false); expect((short.blocks[1] as { text: string }).text).toMatch(/^Hallo \{\{vorname\}\},/);
  });
  it("baut eine Serie als gültigen Ablauf-Baum mit Wartezeiten und Ende bei Antwort", () => {
    const series = heuristicSeriesDraft({ brief: "Erstkontakt für PV-Betriebe in Bayern", count: 3, waitDays: 4, stopWhen: "replied", audience: "PV-Betriebe Bayern" });
    expect(series.mails).toHaveLength(3); expect(series.name).toContain("PV-Betriebe Bayern");
    const tree = seriesToTree(series); expect(validateTree(tree)).toEqual([]);
    expect(tree.nodes.filter((node) => node.type === "send")).toHaveLength(3); expect(tree.nodes.filter((node) => node.type === "wait").every((node) => node.type === "wait" && node.hours === 96)).toBe(true); expect(tree.nodes.filter((node) => node.type === "condition").every((node) => node.type === "condition" && node.check === "replied")).toBe(true);
    const never = seriesToTree(heuristicSeriesDraft({ brief: "Infos", count: 2, stopWhen: "never" })); expect(never.nodes.some((node) => node.type === "condition")).toBe(false); expect(validateTree(never)).toEqual([]);
    const node = draftToNode(series.mails[0], { id: "keep", next: "n2" }); expect(node).toMatchObject({ id: "keep", type: "send", next: "n2" });
  });
  it("bereinigt KI-Antworten und fällt bei Unsinn auf den Entwurf zurück", () => {
    const fallback = heuristicEmailDraft({ brief: "Infos" });
    const cleaned = sanitizeDraft({ subject: "Hallo {{vorname}}", preheader: "x", blocks: [{ type: "heading", text: "Titel" }, { type: "text", text: "Guten Tag {{anrede}} {{nachname}}," }, { type: "bullets", items: ["a", "", "b"] }, { type: "button", text: "", url: "" }, { type: "unbekannt", text: "weg" }, { type: "signature", name: "Taner" }] }, fallback);
    expect(cleaned.subject).toBe("Hallo {{vorname}}"); expect(cleaned.blocks.map((block) => block.type)).toEqual(["heading", "text", "bullets", "button", "signature"]); expect((cleaned.blocks[2] as { items: string[] }).items).toEqual(["a", "b"]); expect((cleaned.blocks[3] as { url: string }).url).toContain("tanesco.digital");
    expect(sanitizeDraft({ subject: "", blocks: [] }, fallback)).toBe(fallback); expect(sanitizeDraft(null, fallback)).toBe(fallback);
  });
  it("liefert kurze Texte für SMS/WhatsApp und E-Mail", () => {
    const sms = heuristicMessageDraft({ brief: "Rückruf wegen Angebot", channel: "sms", sender: "Taner" }); expect(sms.subject).toBeNull(); expect(sms.text.length).toBeLessThanOrEqual(480); expect(sms.text).toMatch(/^Guten Tag \{\{anrede\}\} \{\{nachname\}\}/); expect(sms.text).toContain("Taner");
    const mail = heuristicMessageDraft({ brief: "Termin für Hörtest anbieten", channel: "email" }); expect(mail.subject).toBeTruthy(); expect(mail.text).toContain("Mit freundlichen Grüßen");
  });
  it("nutzt ohne KI-Schlüssel den Entwurf (Server-Funktionen)", async () => {
    const saved = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    try {
      expect((await draftEmail({ brief: "Willkommensmail nach Anfrage" })).source).toBe("vorlage");
      const series = await draftSeries({ brief: "Aufwecken", count: 2 }); expect(series.source).toBe("vorlage"); expect(validateTree(series.tree)).toEqual([]);
      expect((await draftMessage({ brief: "Rückruf", channel: "whatsapp" })).source).toBe("vorlage");
    } finally { if (saved) process.env.ANTHROPIC_API_KEY = saved; }
  });
});

describe("Telefonnummer aus E-Mail-Text", () => {
  it("findet Nummern in Signaturen und ignoriert Datum/PLZ", () => {
    expect(extractPhone("Beste Grüße\nMarkus Mayer\nSolartechnik Mayer GmbH\n0911 5550199")).toBe("+499115550199");
    expect(extractPhone("Tel.: +49 (0)69 555-0101\nFax: 069 5550102")).toBe("+49695550101");
    expect(extractPhone("Mobil: 0160 1234567")).toBe("+491601234567");
    expect(extractPhone("Am 12.10.2026 um 10:15 schrieb Tanesco: Hallo aus 60311 Frankfurt")).toBeNull();
    expect(extractPhone("")).toBeNull(); expect(extractPhone(null)).toBeNull();
  });
});

describe("Vorlagen-Vorschläge (Builder schreibt Vorlagen vor)", () => {
  it("liefert für jeden Vorschlag einen gültigen Ablauf mit passendem Namen – auch zugeschnitten auf eine Kategorie", () => {
    expect(TEMPLATE_PROPOSALS.length).toBeGreaterThanOrEqual(8); expect(new Set(TEMPLATE_PROPOSALS.map((item) => item.key)).size).toBe(TEMPLATE_PROPOSALS.length);
    for (const proposal of TEMPLATE_PROPOSALS) {
      const brief = proposalBrief(proposal, "Photovoltaik"); expect(brief.category).toBe("Photovoltaik"); expect(brief.goal).toBe(proposal.goal);
      const tree = proposal.kind === "serie" ? seriesToTree(heuristicSeriesDraft(brief)) : singleToTree(heuristicEmailDraft(brief));
      expect(validateTree(tree)).toEqual([]); const sends = tree.nodes.filter((node) => node.type === "send"); expect(sends.length).toBe(proposal.kind === "serie" ? proposal.count : 1);
      expect(templateName(proposal, "Photovoltaik")).toBe(`Vorlage: ${proposal.name} – Photovoltaik`); expect(templateName(proposal, null)).toBe(`Vorlage: ${proposal.name}`);
      const first = sends[0]; if (first.type === "send") { expect(first.subject.length).toBeGreaterThan(5); const intro = first.blocks.find((block) => block.type === "text"); expect(intro && intro.type === "text" ? intro.text : "").not.toMatch(/wir Kurzes|zu Zusammenarbeit|Nachfassen nach Angebot:/); }
    }
  });
  it("nimmt Zielgruppe/Thema nur hinter für/an/zu/über/wegen/bei aus der Beschreibung", () => {
    expect(heuristicSeriesDraft({ brief: "Erstkontakt für PV-Betriebe in Bayern", count: 3 }).name).toBe("Termin bekommen – PV-Betriebe in Bayern");
    expect(heuristicSeriesDraft({ brief: "Nachfassen nach Angebot für eine Wärmepumpe, freundlich", count: 2 }).name).toBe("Angebot nachfassen – Wärmepumpe");
    expect(heuristicSeriesDraft({ brief: "Kurzes Erstgespräch anbieten: 15 Minuten, online oder vor Ort", count: 2 }).name).toBe("Termin bekommen");
    expect(heuristicSeriesDraft({ brief: "Kontakte, die seit Wochen nicht reagieren, kurz und locker aufwecken", count: 2 }).name).toBe("Aufwecken");
  });
});

describe("KI-Antwort → ganze E-Mail (nie nur eine Zeile)", () => {
  const brief = { brief: "Nachfassen nach Angebot für Dachdecker, freundlich", goal: "angebot" as const, length: "mittel" as const };
  it("erkennt zu kurze Antworten und füllt sie aus dem Gerüst auf", () => {
    const fallback = heuristicEmailDraft(brief);
    const oneLiner = sanitizeDraft({ subject: "Kurze Frage zum Angebot", preheader: "", blocks: [{ type: "text", text: "Guten Tag {{anrede}} {{nachname}}, haben Sie unser Angebot gesehen?" }] }, fallback);
    expect(oneLiner).not.toBe(fallback); expect(draftIsComplete(oneLiner, "mittel")).toBe(false);
    const full = completeDraft(oneLiner, fallback);
    expect(full.subject).toBe("Kurze Frage zum Angebot"); expect(draftIsComplete(full, "mittel")).toBe(true);
    expect(full.blocks.map((block) => block.type)).toEqual(["heading", "text", "text", "bullets", "button", "text", "signature"]);
    const first = full.blocks[1]; expect(first.type === "text" && first.text.startsWith("Guten Tag {{anrede}} {{nachname}}, haben Sie")).toBe(true); expect(draftWordCount(full.blocks)).toBeGreaterThanOrEqual(45);
    expect(validateTree(singleToTree(full))).toEqual([]);
  });
  it("übersetzt abweichende KI-Formen (Fließtext, Absätze als Strings, Felder statt Bausteine) in Bausteine", () => {
    const fallback = heuristicEmailDraft(brief);
    const asBody = sanitizeDraft({ subject: "Ihr Angebot", body: "Guten Tag {{anrede}} {{nachname}},\n\nvor ein paar Tagen haben Sie unser Angebot erhalten und wir möchten gern wissen, ob noch Fragen offen sind.\n\nGern besprechen wir alles in einem kurzen Telefonat.\n\nMit freundlichen Grüßen\nTaner", bullets: ["Festpreis", "Start in 14 Tagen", "Fester Ansprechpartner"], button: { text: "Termin wählen", url: "https://tanesco.digital/termin" } }, fallback);
    expect(asBody).not.toBe(fallback); expect(asBody.blocks.filter((block) => block.type === "text")).toHaveLength(3); expect(asBody.blocks.some((block) => block.type === "bullets")).toBe(true); expect(asBody.blocks.some((block) => block.type === "button")).toBe(true);
    const asStrings = sanitizeDraft({ betreff: "Noch Fragen?", blocks: ["Guten Tag {{vorname}},\n\nhier der erste Absatz mit genug Text für eine echte E-Mail an Sie.", "Zweiter Absatz mit weiteren Sätzen und einem klaren nächsten Schritt.", { type: "knopf", text: "Rückruf", url: "https://tanesco.digital/termin" }, { typ: "signatur", name: "Taner" }] }, fallback);
    expect(asStrings.subject).toBe("Noch Fragen?"); expect(asStrings.blocks.map((block) => block.type)).toEqual(["text", "text", "button", "signature"]);
    const asText = sanitizeDraft("Guten Tag {{anrede}} {{nachname}},\n\nerster Absatz.\n\nViele Grüße\nTaner", fallback); expect(asText).toBe(fallback); // ohne Betreff bleibt das Gerüst
    const completed = completeDraft(asStrings, fallback); expect(draftIsComplete(completed, "mittel")).toBe(true); expect(completed.blocks[0].type).toBe("heading");
  });
});
