/**
 * KI-Einordnung von Antworten im Posteingang: Beschwerde, Abmeldewunsch, Interessiert, Frage, Abwesenheitsnotiz oder Sonstiges.
 * Die eigentliche Einordnung macht die KI (Server: Anthropic, Chat-Demo: „sample“-Laufzeit); ohne KI greifen die Regeln hier.
 * Aus Einordnung + Einstellungen folgt die Entscheidung: automatisch sperren, zur Prüfung markieren, nur markieren oder nichts.
 * Gemeinsam für Server und Chat-Demo.
 */
import { detectOptOut } from "./email-campaigns";

export type ReplyKind = "beschwerde" | "abmeldung" | "interessiert" | "frage" | "abwesenheit" | "sonstiges";
export type ReplyAssessment = { kind: ReplyKind; confidence: number; quote: string | null; reason: string | null; source: "ki" | "regeln" };
export type ReplyAiSettings = { enabled: boolean; autoBlock: boolean; markInterest: boolean };
export type ReplyAction = "gesperrt" | "pruefen" | "markiert" | "geprueft" | null;
export type ReplyDecision = { action: ReplyAction; reason: "beschwerde" | "abgemeldet" | null };

export const DEFAULT_REPLY_AI: ReplyAiSettings = { enabled: true, autoBlock: true, markInterest: true };
export const REPLY_KINDS: ReplyKind[] = ["beschwerde", "abmeldung", "interessiert", "frage", "abwesenheit", "sonstiges"];
export const REPLY_KIND_LABEL: Record<ReplyKind, string> = { beschwerde: "Beschwerde", abmeldung: "Abmeldewunsch", interessiert: "Interessiert", frage: "Frage", abwesenheit: "Abwesenheitsnotiz", sonstiges: "Sonstiges" };
/** Ab dieser Sicherheit wird automatisch gesperrt; darunter (ab PRUEFEN) nur zur Prüfung markiert. */
export const BLOCK_CONFIDENCE = 80;
export const REVIEW_CONFIDENCE = 45;
export const MARK_CONFIDENCE = 60;

/** Nur der eigene Text der Antwort (ohne zitierte Vornachricht, ohne „>“-Zeilen), höchstens 1.500 Zeichen. */
export function ownReplyText(text: string | null | undefined, subject?: string | null) {
  const lines = (text ?? "").split("\n"); const own: string[] = [];
  for (const line of lines) { const trimmed = line.trim(); if (/^(am .* schrieb|on .* wrote|-{3,} ?(ursprüngliche|original)|von: |from: )/i.test(trimmed) || trimmed.startsWith(">")) break; own.push(line); }
  return `${subject ?? ""}\n${own.join("\n")}`.trim().slice(0, 1500);
}
const firstMatchLine = (text: string, pattern: RegExp) => text.split("\n").map((line) => line.trim()).find((line) => line && pattern.test(line)) ?? null;
const quoteOf = (text: string, pattern: RegExp) => { const line = firstMatchLine(text, pattern); return line ? line.slice(0, 160) : null; };

const COMPLAINT_STRONG = /(\bspam\b|abmahnung|anwalt|rechtsanwalt|unterlassen|unterlassungs|(hören|hört) sie (endlich |sofort |bitte )?auf|lassen sie mich in ruhe|in ruhe lassen|belästig|ich (werde|habe) .*(melden|anzeige|beschwer|gemeldet)|wie kommen sie an meine (daten|adresse|e-?mail)|woher haben sie meine|dsgvo|datenschutzbeschwerde|unverschämt|frechheit|dreist|ich verbitte mir|verbiete ihnen|nie wieder (schreiben|kontaktieren|anschreiben)|bombardier|zumüll|beschwerde)/i;
const COMPLAINT_WEAK = /(unerwünscht|nicht erwünscht|datenschutz|ohne meine (zustimmung|einwilligung)|keine einwilligung|nie zugestimmt|nicht angefordert|nervig|nervt|lästig|aufdringlich|ärgerlich|genervt|woher (stammen|kommen|haben sie|haben) (eigentlich |denn )?meine|meine (kontakt|adress)?daten|(nicht|kaum) in ordnung|rechtens|zulässig|erlaubt ist)/i;
const OUT_OF_OFFICE = /(abwesenheitsnotiz|abwesenheitsnachricht|out of office|out-of-office|außer haus|nicht im (büro|haus|hause)|im urlaub|in urlaub|bin (ab|bis|erst|vom) .*(wieder|zurück|erreichbar)|automatische antwort|automatic reply|auto-?reply|autoreply|in meiner abwesenheit|wird nicht weitergeleitet|erreichen sie meine vertretung|vertretung erreichen|derzeit nicht erreichbar|elternzeit)/i;
const INTEREST_STRONG = /(klingt (gut|interessant|spannend)|sehr interessant|(gerne|gern) (ein )?(angebot|termin|gespräch|telefonat|mehr)|angebot (schicken|senden|zukommen|zusenden|machen)|schicken sie (mir )?(ein|das) angebot|termin (vereinbaren|machen|ausmachen|vorschlagen)|rufen sie (mich )?(gerne )?an|können wir (telefonieren|sprechen|reden)|haben interesse|hätten interesse|habe interesse|hätte interesse|wären interessiert|wäre interessiert|sind interessiert|bin interessiert|melden sie sich|weitere (infos|informationen|details) (bitte|wären)|preisliste|konditionen)/i;
const INTEREST_WEAK = /(interess|angebot|termin|rückruf|gerne|preis|kosten|kapazität|wie viele|unterlagen|mehr (infos|informationen|details))/i;
const NOT_INTERESTED = /(kein (interesse|bedarf)|keinen bedarf|nicht interessiert|nicht interessant|aktuell nicht|derzeit nicht|im moment (nicht|kein))/i;

/** Regelbasierte Einordnung – läuft ohne KI oder wenn die KI nicht antwortet. */
export function assessReplyByRules(subject: string | null | undefined, body: string | null | undefined): ReplyAssessment {
  const text = ownReplyText(body, subject); const lower = text.toLowerCase();
  if (!lower.trim()) return { kind: "sonstiges", confidence: 30, quote: null, reason: "Kein eigener Text in der Antwort.", source: "regeln" };
  if (OUT_OF_OFFICE.test(lower)) return { kind: "abwesenheit", confidence: 90, quote: quoteOf(text, OUT_OF_OFFICE), reason: "Typische Abwesenheitsnotiz.", source: "regeln" };
  const strong = COMPLAINT_STRONG.test(lower); const weak = COMPLAINT_WEAK.test(lower); const optOut = detectOptOut(body, subject);
  if (strong) return { kind: "beschwerde", confidence: optOut || weak ? 95 : 85, quote: quoteOf(text, COMPLAINT_STRONG), reason: "Deutliche Beschwerde oder Drohung in der Antwort.", source: "regeln" };
  if (optOut) return { kind: "abmeldung", confidence: weak ? 92 : 90, quote: quoteOf(text, /(abmelden|abbestellen|austragen|unsubscribe|remove me|kein(e)? (weiteren? )?(e-?mails?|nachrichten|werbung|newsletter|mails?)|nicht mehr (anschreiben|kontaktieren|schreiben|anrufen|belästigen)|verteiler|streichen|löschen|entfernen|stop)/i), reason: "Bittet darum, keine E-Mails mehr zu bekommen.", source: "regeln" };
  if (weak) return { kind: "beschwerde", confidence: 60, quote: quoteOf(text, COMPLAINT_WEAK), reason: "Könnte eine Beschwerde sein – bitte prüfen.", source: "regeln" };
  const notInterested = NOT_INTERESTED.test(lower);
  if (!notInterested && INTEREST_STRONG.test(lower)) return { kind: "interessiert", confidence: 82, quote: quoteOf(text, INTEREST_STRONG), reason: "Will ein Angebot, einen Termin oder ein Gespräch.", source: "regeln" };
  if (!notInterested && INTEREST_WEAK.test(lower) && lower.includes("?")) return { kind: "interessiert", confidence: 65, quote: quoteOf(text, INTEREST_WEAK), reason: "Fragt nach Angebot, Preis oder Details.", source: "regeln" };
  if (lower.includes("?")) return { kind: "frage", confidence: 60, quote: quoteOf(text, /\?/), reason: "Enthält eine Rückfrage.", source: "regeln" };
  if (notInterested) return { kind: "sonstiges", confidence: 70, quote: quoteOf(text, NOT_INTERESTED), reason: "Aktuell kein Bedarf – kein Abmeldewunsch.", source: "regeln" };
  return { kind: "sonstiges", confidence: 50, quote: null, reason: null, source: "regeln" };
}

/** Prompt für die KI – Antwort als JSON in genau dieser Form. */
export function replyAssessmentPrompt(subject: string | null | undefined, body: string | null | undefined) {
  return `Du ordnest Antworten auf Vertriebs-E-Mails einer deutschen Firma ein (B2B, Lead-Vermittlung). Lies die Antwort und entscheide, worum es geht.

Mögliche Einordnungen (genau eine):
- "beschwerde": Der Absender beschwert sich, droht (Anwalt, Abmahnung, Meldung, Spam), fühlt sich belästigt oder verbittet sich weitere Nachrichten in scharfem Ton.
- "abmeldung": Der Absender möchte keine weiteren E-Mails (höflich oder neutral), z. B. "bitte austragen", "kein Interesse, keine weiteren Mails".
- "interessiert": Der Absender möchte ein Angebot, einen Termin, einen Rückruf oder mehr Informationen.
- "frage": Eine Rückfrage ohne klares Interesse oder Ablehnung.
- "abwesenheit": Automatische Abwesenheitsnotiz / Out of Office.
- "sonstiges": Alles andere, z. B. "aktuell kein Bedarf, später nochmal" (das ist KEINE Abmeldung).

Antworte nur mit JSON: {"art": "beschwerde|abmeldung|interessiert|frage|abwesenheit|sonstiges", "sicherheit": 0-100, "zitat": "kurzes wörtliches Zitat aus der Antwort (max. 160 Zeichen) oder null", "begruendung": "ein kurzer Satz auf Deutsch"}

Betreff: ${(subject ?? "").slice(0, 200)}
Antwort:
"""
${ownReplyText(body, null).slice(0, 1500)}
"""`;
}

const KIND_ALIASES: Record<string, ReplyKind> = { beschwerde: "beschwerde", complaint: "beschwerde", abmeldung: "abmeldung", abmeldewunsch: "abmeldung", unsubscribe: "abmeldung", optout: "abmeldung", "opt-out": "abmeldung", interessiert: "interessiert", interesse: "interessiert", interested: "interessiert", frage: "frage", question: "frage", abwesenheit: "abwesenheit", abwesenheitsnotiz: "abwesenheit", "out of office": "abwesenheit", ooo: "abwesenheit", autoreply: "abwesenheit", sonstiges: "sonstiges", other: "sonstiges", neutral: "sonstiges" };
/** KI-Antwort tolerant lesen (deutsche/englische Schlüssel, Prozent als Zahl oder Text). null = unbrauchbar. */
export function parseReplyAssessment(raw: unknown): ReplyAssessment | null {
  let value: unknown = raw;
  if (typeof raw === "string") { const match = raw.match(/\{[\s\S]*\}/); if (!match) return null; try { value = JSON.parse(match[0]); } catch { return null; } }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const kindRaw = String(record.art ?? record.kind ?? record.einordnung ?? record.category ?? "").trim().toLowerCase();
  let kind: ReplyKind | null = KIND_ALIASES[kindRaw] ?? null;
  if (!kind) for (const [alias, mapped] of Object.entries(KIND_ALIASES)) if (kindRaw.includes(alias)) { kind = mapped; break; }
  if (!kind) return null;
  const confidenceRaw = record.sicherheit ?? record.confidence ?? record.wahrscheinlichkeit ?? 70;
  let confidence = typeof confidenceRaw === "number" ? confidenceRaw : Number(String(confidenceRaw).replace(/[^0-9.]/g, "")); if (!Number.isFinite(confidence)) confidence = 70; if (confidence > 0 && confidence <= 1) confidence *= 100;
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));
  const quoteRaw = record.zitat ?? record.quote ?? null; const reasonRaw = record.begruendung ?? record.begründung ?? record.reason ?? null;
  return { kind, confidence, quote: quoteRaw && typeof quoteRaw === "string" && quoteRaw.trim() && quoteRaw.trim().toLowerCase() !== "null" ? quoteRaw.trim().slice(0, 160) : null, reason: reasonRaw && typeof reasonRaw === "string" ? reasonRaw.trim().slice(0, 200) : null, source: "ki" };
}

/** Aus Einordnung + Einstellungen die Entscheidung ableiten. */
export function decideReply(assessment: ReplyAssessment | null, settings: ReplyAiSettings = DEFAULT_REPLY_AI): ReplyDecision {
  if (!assessment) return { action: null, reason: null };
  const critical = assessment.kind === "beschwerde" || assessment.kind === "abmeldung";
  if (critical) {
    const reason = assessment.kind === "beschwerde" ? "beschwerde" : "abgemeldet";
    if (!settings.enabled) return assessment.kind === "abmeldung" && assessment.confidence >= BLOCK_CONFIDENCE ? { action: "gesperrt", reason } : { action: null, reason: null }; // ohne KI: nur die klare Abmeldung (Wortliste) wie bisher
    if (assessment.confidence >= BLOCK_CONFIDENCE) return settings.autoBlock ? { action: "gesperrt", reason } : { action: "pruefen", reason };
    if (assessment.confidence >= REVIEW_CONFIDENCE) return { action: "pruefen", reason };
    return { action: null, reason: null };
  }
  if (!settings.enabled) return { action: null, reason: null };
  if (assessment.kind === "sonstiges") return { action: null, reason: null };
  return assessment.confidence >= MARK_CONFIDENCE ? { action: "markiert", reason: null } : { action: null, reason: null };
}

/** Kurztext für Protokoll, Sperrliste und Posteingang, z. B. „KI: Beschwerde (95 %) – „Hören Sie auf …““. */
export function describeAssessment(assessment: ReplyAssessment) {
  const who = assessment.source === "ki" ? "KI" : "Regeln";
  return `${who}: ${REPLY_KIND_LABEL[assessment.kind]} (${assessment.confidence} %)${assessment.quote ? ` – „${assessment.quote}“` : ""}`;
}

/** Zeitraum-Filter des Posteingangs → von/bis. */
export type InboxPeriod = "alle" | "heute" | "gestern" | "7tage" | "30tage" | "eigener";
export function periodRange(period: InboxPeriod, now: Date, custom?: { from?: string | null; to?: string | null }): { from: Date | null; to: Date | null } {
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = 86_400_000; const today = start(now);
  if (period === "heute") return { from: today, to: new Date(today.getTime() + day) };
  if (period === "gestern") return { from: new Date(today.getTime() - day), to: today };
  if (period === "7tage") return { from: new Date(today.getTime() - 6 * day), to: null };
  if (period === "30tage") return { from: new Date(today.getTime() - 29 * day), to: null };
  if (period === "eigener") { const from = custom?.from ? new Date(`${custom.from}T00:00:00`) : null; const to = custom?.to ? new Date(new Date(`${custom.to}T00:00:00`).getTime() + day) : null; return { from: from && !Number.isNaN(from.getTime()) ? from : null, to: to && !Number.isNaN(to.getTime()) ? to : null }; }
  return { from: null, to: null };
}

/** Filter nach KI-Einordnung im Posteingang: eine Art, automatisch gesperrt, zu prüfen oder ohne Einordnung. */
export type InboxAiFilter = ReplyKind | "auto-gesperrt" | "pruefen" | "ohne";
export const INBOX_AI_FILTERS: Array<{ key: InboxAiFilter; label: string }> = [
  { key: "beschwerde", label: "Beschwerde" }, { key: "abmeldung", label: "Abmeldewunsch" }, { key: "interessiert", label: "Interessiert" }, { key: "frage", label: "Frage" }, { key: "abwesenheit", label: "Abwesenheitsnotiz" }, { key: "sonstiges", label: "Sonstiges" },
  { key: "auto-gesperrt", label: "Automatisch gesperrt" }, { key: "pruefen", label: "Zu prüfen" }, { key: "ohne", label: "Ohne Einordnung" },
];
export function matchesAiFilter(ai: { kind: ReplyKind; action: ReplyAction } | null | undefined, filter: InboxAiFilter) {
  if (filter === "ohne") return !ai;
  if (!ai) return false;
  if (filter === "auto-gesperrt") return ai.action === "gesperrt";
  if (filter === "pruefen") return ai.action === "pruefen";
  return ai.kind === filter;
}
export const inboxAiFilterLabel = (filter: InboxAiFilter) => INBOX_AI_FILTERS.find((item) => item.key === filter)?.label ?? filter;
