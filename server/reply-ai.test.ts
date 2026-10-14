import { describe, expect, it } from "vitest";
import { assessReplyByRules, decideReply, DEFAULT_REPLY_AI, describeAssessment, ownReplyText, parseReplyAssessment, periodRange } from "../shared/reply-ai";
import { assessReply } from "./reply-ai";

const llmSaying = (content: string) => (async () => ({ id: "x", created: 0, model: "fast", choices: [{ index: 0, message: { role: "assistant" as const, content }, finish_reason: "stop" as const }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })) as never;

describe("KI-Einordnung von Antworten (Regeln)", () => {
  it("erkennt eine deutliche Beschwerde mit hoher Sicherheit", () => {
    const result = assessReplyByRules("Re: Mehr Anfragen", "Hören Sie sofort auf, mir zu schreiben! Das ist Spam, beim nächsten Mal melde ich das.");
    expect(result.kind).toBe("beschwerde"); expect(result.confidence).toBeGreaterThanOrEqual(85); expect(result.quote).toContain("Hören Sie"); expect(result.source).toBe("regeln");
  });
  it("erkennt einen höflichen Abmeldewunsch als Abmeldung, nicht als Beschwerde", () => {
    const result = assessReplyByRules("Re: Serie", "Vielen Dank, aber bitte keine weiteren E-Mails an uns.\n\nMfG");
    expect(result.kind).toBe("abmeldung"); expect(result.confidence).toBeGreaterThanOrEqual(85);
  });
  it("stuft eine vorsichtige Datenschutz-Nachfrage nur als möglichen Fall ein", () => {
    const result = assessReplyByRules("Re: Frage", "Guten Tag, woher stammen eigentlich meine Kontaktdaten? Ich bin mir nicht sicher, ob das so in Ordnung ist. Aktuell kein Bedarf.");
    expect(result.kind).toBe("beschwerde"); expect(result.confidence).toBeLessThan(80); expect(result.confidence).toBeGreaterThanOrEqual(45);
  });
  it("erkennt Abwesenheitsnotizen, Interesse, Rückfragen und „kein Bedarf“ (keine Abmeldung)", () => {
    expect(assessReplyByRules("Automatische Antwort", "Ich bin bis zum 20.10. im Urlaub und erst danach wieder erreichbar.").kind).toBe("abwesenheit");
    expect(assessReplyByRules("Re: Angebot", "Klingt gut, schicken Sie mir gerne ein Angebot.").kind).toBe("interessiert");
    expect(assessReplyByRules("Re: Angebot", "Was kostet das pro Anfrage?").kind).toMatch(/frage|interessiert/);
    const none = assessReplyByRules("Re: Angebot", "Aktuell kein Bedarf, vielleicht im Frühjahr wieder."); expect(none.kind).toBe("sonstiges");
    expect(assessReplyByRules("Re", "Hallo\n\nAm 02.10. schrieb Tanesco:\n> Hören Sie auf, bitte keine E-Mails").kind).toBe("sonstiges"); // zitierter Text zählt nicht
  });
  it("schneidet zitierte Vornachrichten ab", () => { expect(ownReplyText("Danke!\n\nAm 02.10. schrieb Tanesco:\n> alte Mail", "Re: Test")).toBe("Re: Test\nDanke!"); });
});

describe("Entscheidung aus Einordnung + Einstellungen", () => {
  const sure = { kind: "beschwerde" as const, confidence: 95, quote: null, reason: null, source: "ki" as const };
  it("sperrt eindeutige Beschwerden automatisch, markiert unsichere zur Prüfung", () => {
    expect(decideReply(sure)).toEqual({ action: "gesperrt", reason: "beschwerde" });
    expect(decideReply({ ...sure, confidence: 60 })).toEqual({ action: "pruefen", reason: "beschwerde" });
    expect(decideReply({ ...sure, confidence: 30 })).toEqual({ action: null, reason: null });
    expect(decideReply({ ...sure, kind: "abmeldung" })).toEqual({ action: "gesperrt", reason: "abgemeldet" });
  });
  it("ohne Auto-Sperre nur „Prüfen“, ohne KI nur die klare Abmeldung wie bisher", () => {
    expect(decideReply(sure, { ...DEFAULT_REPLY_AI, autoBlock: false })).toEqual({ action: "pruefen", reason: "beschwerde" });
    expect(decideReply(sure, { ...DEFAULT_REPLY_AI, enabled: false })).toEqual({ action: null, reason: null });
    expect(decideReply({ ...sure, kind: "abmeldung", source: "regeln" }, { ...DEFAULT_REPLY_AI, enabled: false })).toEqual({ action: "gesperrt", reason: "abgemeldet" });
  });
  it("markiert Interesse und Abwesenheit nur, Sonstiges gar nicht", () => {
    expect(decideReply({ ...sure, kind: "interessiert", confidence: 82 }).action).toBe("markiert");
    expect(decideReply({ ...sure, kind: "abwesenheit", confidence: 90 }).action).toBe("markiert");
    expect(decideReply({ ...sure, kind: "interessiert", confidence: 40 }).action).toBeNull();
    expect(decideReply({ ...sure, kind: "sonstiges", confidence: 99 }).action).toBeNull();
    expect(decideReply(null).action).toBeNull();
  });
});

describe("KI-Antwort lesen", () => {
  it("versteht deutsche und englische Schlüssel, Prozent als Bruch oder Text, JSON im Fließtext", () => {
    expect(parseReplyAssessment('{"art":"beschwerde","sicherheit":92,"zitat":"Das ist Spam","begruendung":"Droht mit Meldung"}')).toMatchObject({ kind: "beschwerde", confidence: 92, quote: "Das ist Spam", source: "ki" });
    expect(parseReplyAssessment({ kind: "unsubscribe", confidence: 0.8, quote: null })).toMatchObject({ kind: "abmeldung", confidence: 80, quote: null });
    expect(parseReplyAssessment('Hier die Einordnung: {"art": "Abwesenheitsnotiz", "sicherheit": "95 %"}')).toMatchObject({ kind: "abwesenheit", confidence: 95 });
    expect(parseReplyAssessment("keine Ahnung")).toBeNull(); expect(parseReplyAssessment({ art: "unbekannt" })).toBeNull();
  });
  it("beschreibt die Einordnung kurz", () => { expect(describeAssessment({ kind: "beschwerde", confidence: 95, quote: "Spam!", reason: null, source: "ki" })).toBe("KI: Beschwerde (95 %) – „Spam!“"); });
});

describe("assessReply auf dem Server", () => {
  const polite = "Vielen Dank – aktuell kein Bedarf, wir melden uns bei Interesse.";
  it("nutzt die KI, wenn ein Schlüssel da ist, sonst die Regeln", async () => {
    const viaAi = await assessReply("Re", polite, DEFAULT_REPLY_AI, { apiKey: "test", llm: llmSaying('{"art":"sonstiges","sicherheit":88,"zitat":null,"begruendung":"Kein Bedarf, keine Abmeldung."}') });
    expect(viaAi).toMatchObject({ kind: "sonstiges", confidence: 88, source: "ki" });
    expect((await assessReply("Re", polite, DEFAULT_REPLY_AI, { apiKey: null })).source).toBe("regeln");
    expect((await assessReply("Re", polite, { ...DEFAULT_REPLY_AI, enabled: false }, { apiKey: "test", llm: llmSaying("{}") })).source).toBe("regeln");
  });
  it("fällt bei Fehlern oder unbrauchbaren Antworten auf die Regeln zurück", async () => {
    const failing = (async () => { throw new Error("kaputt"); }) as never;
    expect((await assessReply("Re", "Hören Sie auf, mir zu schreiben!", DEFAULT_REPLY_AI, { apiKey: "test", llm: failing })).kind).toBe("beschwerde");
    expect((await assessReply("Re", polite, DEFAULT_REPLY_AI, { apiKey: "test", llm: llmSaying("Ich bin mir nicht sicher.") })).source).toBe("regeln");
  });
  it("lässt eine eindeutige Regel-Abmeldung nicht von der KI überstimmen", async () => {
    const result = await assessReply("Re", "Bitte keine weiteren E-Mails an uns.", DEFAULT_REPLY_AI, { apiKey: "test", llm: llmSaying('{"art":"frage","sicherheit":70}') });
    expect(result.kind).toBe("abmeldung"); expect(result.source).toBe("regeln"); expect(result.reason).toContain("KI sah");
  });
});

describe("Zeitraum-Filter des Posteingangs", () => {
  const now = new Date(2026, 9, 13, 14, 30);
  it("rechnet Heute, Gestern, 7/30 Tage und eigene Zeiträume in von/bis um", () => {
    expect(periodRange("heute", now)).toEqual({ from: new Date(2026, 9, 13), to: new Date(2026, 9, 14) });
    expect(periodRange("gestern", now)).toEqual({ from: new Date(2026, 9, 12), to: new Date(2026, 9, 13) });
    expect(periodRange("7tage", now)).toEqual({ from: new Date(2026, 9, 7), to: null });
    expect(periodRange("30tage", now).from).toEqual(new Date(2026, 8, 14));
    expect(periodRange("eigener", now, { from: "2026-10-01", to: "2026-10-05" })).toEqual({ from: new Date(2026, 9, 1), to: new Date(2026, 9, 6) });
    expect(periodRange("eigener", now, { from: "quatsch", to: null })).toEqual({ from: null, to: null });
    expect(periodRange("alle", now)).toEqual({ from: null, to: null });
  });
});
