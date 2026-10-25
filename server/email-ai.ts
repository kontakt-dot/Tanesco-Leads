/**
 * KI-Vorlagen-Builder (Server): E-Mail oder ganze Serie aus einer Beschreibung – mit ANTHROPIC_API_KEY über Claude
 * (strukturierte Ausgabe), sonst regelbasierter Entwurf aus shared/email-ai.ts. Dazu: kurze Texte für SMS/WhatsApp/E-Mail.
 */
import { invokeLLM } from "./_core/llm";
import { completeDraft, draftIsComplete, heuristicEmailDraft, heuristicMessageDraft, heuristicSeriesDraft, proposalBrief, sanitizeDraft, seriesToTree, singleToTree, TEMPLATE_PROPOSALS, templateName, type DraftSource, type EmailBrief, type EmailDraft, type SeriesBrief, type SeriesDraft } from "../shared/email-ai";
import { DEFAULT_DESIGN } from "../shared/email-design";
import type { Db } from "./lead-pipeline";
import { saveEmailCampaign } from "./sales-outreach";
import { SMS_LIMIT } from "../shared/pipeline-extras";

const BLOCK_SCHEMA = { type: "array", maxItems: 12, items: { type: "object", properties: { type: { type: "string", enum: ["heading", "text", "bullets", "button", "divider", "spacer", "signature"] }, text: { type: "string" }, items: { type: "array", items: { type: "string" } }, url: { type: "string" }, name: { type: "string" }, role: { type: "string" }, phone: { type: "string" } }, required: ["type"] } };
const DRAFT_PROPERTIES = { label: { type: "string", description: "Kurze Bezeichnung im Ablauf, z. B. „1. E-Mail“" }, subject: { type: "string", description: "Betreff, max. 70 Zeichen, mit Platzhaltern erlaubt" }, subjectB: { type: ["string", "null"], description: "Zweiter Betreff für A/B-Test oder null" }, preheader: { type: "string", description: "Vorschautext, max. 90 Zeichen" }, blocks: BLOCK_SCHEMA, notes: { type: ["string", "null"], description: "Ein Satz Hinweis für den Vertrieb oder null" } };
const SYSTEM = `Du bist der E-Mail-Builder von Tanesco Leads (Lead-Vermittler für Handwerk, Energie und Gesundheit in Deutschland). Du schreibst verkaufsstarke, seriöse E-Mails auf Deutsch (Sie-Form, außer der Ton ist „locker“ → Du-Form).
Regeln: Keine erfundenen Zahlen, Preise, Namen oder Versprechen. Keine Floskeln wie „ich hoffe, diese E-Mail erreicht Sie gut“. Erster Textbaustein beginnt mit der Anrede als Platzhalter {{begruessung}} (das System setzt daraus „Sehr geehrte Frau …“, „Sehr geehrter Herr …“ oder „Sehr geehrte Damen und Herren“ – nie „Hallo“ schreiben), dann Komma und Leerzeile. Platzhalter erlaubt: {{begruessung}} {{nachname}} {{vorname}} {{firma}} {{stadt}} {{kontaktweg}}. Die Fußzeile mit Abmeldelink und die Signatur mit Gruß und Namen ergänzt das System – nicht schreiben.
Bausteine: heading (eine kurze Überschrift), text (Absätze, Zeilenumbrüche mit \\n), bullets (3–5 kurze Punkte), signature (name, role, phone). KEIN button – es gibt keine Terminbuchung und keine Links. Reihenfolge: heading, text, optional bullets, optional text, text (Schluss), signature. Der Schluss-Baustein lautet immer: ein Satz, der sagt, was zu tun ist, mit dem Platzhalter {{kontaktweg}} (z. B. „Wenn das für Sie interessant ist, {{kontaktweg}}.“) und danach in eigener Zeile „Vielen Dank“ – keine Grußformel wie „Mit freundlichen Grüßen“.
Länge: kurz = 60–90 Wörter, mittel = 110–170 Wörter, lang = 190–260 Wörter – immer eine komplette E-Mail mit ganzen Absätzen, nie nur eine Zeile. Betreff: konkret, neugierig machend, ohne Clickbait, max. 70 Zeichen.`;

function describeBrief(input: EmailBrief) {
  return [`Beschreibung: ${input.brief.trim()}`, input.goal && input.goal !== "frei" ? `Ziel: ${input.goal}` : null, `Ton: ${input.tone ?? "freundlich"}`, `Länge: ${input.length ?? "mittel"}`, input.audience ? `Zielgruppe: ${input.audience}` : null, input.category ? `Lead-Kategorie / Thema: ${input.category}` : null, `Absender: ${input.sender ?? "Ihr Team von Tanesco Digital"} (${input.company ?? "Tanesco Digital"})`, `Knopf: „${input.ctaText ?? "passend zum Ziel"}“ → ${input.ctaUrl ?? "https://tanesco.digital/termin"}`, input.abTest ? "A/B-Test: liefere einen zweiten, deutlich anderen Betreff in subjectB." : "subjectB: null"].filter(Boolean).join("\n");
}

export async function draftEmail(input: EmailBrief): Promise<{ draft: EmailDraft; source: DraftSource }> {
  const fallback = heuristicEmailDraft(input);
  if (!process.env.ANTHROPIC_API_KEY || !input.brief.trim()) return { draft: fallback, source: "vorlage" };
  try {
    const response = await invokeLLM({ maxTokens: 1800, temperature: 0.7, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `Schreibe genau eine E-Mail.\n${describeBrief(input)}` }], outputSchema: { name: "email_entwurf", schema: { type: "object", additionalProperties: false, required: ["subject", "preheader", "blocks"], properties: DRAFT_PROPERTIES } } });
    const parsed = JSON.parse(response.choices[0]?.message.content ?? "{}");
    let draft = sanitizeDraft(parsed, fallback); const length = input.length ?? "mittel";
    if (draft !== fallback && !draftIsComplete(draft, length)) {
      // Zu kurz (nur eine Zeile o. ä.): einmal nachfassen, dann Lücken aus dem Gerüst füllen
      try { const retry = await invokeLLM({ maxTokens: 2200, temperature: 0.7, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `Schreibe genau eine komplette E-Mail – die vorige Antwort war zu kurz. Pflicht: Überschrift, Anrede + zwei Absätze mit ganzen Sätzen, drei Aufzählungspunkte, Knopf, Grußformel, Signatur; Gesamtlänge laut Vorgabe.\n${describeBrief(input)}` }], outputSchema: { name: "email_entwurf", schema: { type: "object", additionalProperties: false, required: ["subject", "preheader", "blocks"], properties: DRAFT_PROPERTIES } } }); const again = sanitizeDraft(JSON.parse(retry.choices[0]?.message.content ?? "{}"), fallback); if (again !== fallback && draftIsComplete(again, length)) draft = again; } catch { /* unten ergänzen */ }
      if (!draftIsComplete(draft, length)) draft = completeDraft(draft, fallback, input.tone ?? "freundlich");
    }
    return { draft, source: draft === fallback ? "vorlage" : "ki" };
  } catch { return { draft: fallback, source: "vorlage" }; }
}

export async function draftSeries(input: SeriesBrief): Promise<{ series: SeriesDraft; tree: ReturnType<typeof seriesToTree>; source: DraftSource }> {
  const fallback = heuristicSeriesDraft(input);
  const finish = (series: SeriesDraft, source: DraftSource) => ({ series, tree: seriesToTree(series), source });
  if (!process.env.ANTHROPIC_API_KEY || !input.brief.trim()) return finish(fallback, "vorlage");
  try {
    const count = Math.min(4, Math.max(2, input.count ?? 3));
    const response = await invokeLLM({ maxTokens: 4000, temperature: 0.7, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `Schreibe eine Serie aus genau ${count} E-Mails, die im Abstand von ${input.waitDays ?? 3} Tagen verschickt werden und endet, sobald der Empfänger ${input.stopWhen === "clicked" ? "klickt" : input.stopWhen === "opened" ? "öffnet" : "antwortet"}. Jede Mail baut auf der vorherigen auf (1. Ansprache, dann Nachfassen mit neuem Aspekt, zuletzt eine freundliche letzte Nachricht). Gib auch einen Namen für die Serie (max. 60 Zeichen).\n${describeBrief(input)}` }], outputSchema: { name: "email_serie", schema: { type: "object", additionalProperties: false, required: ["name", "mails"], properties: { name: { type: "string" }, mails: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", required: ["subject", "preheader", "blocks"], properties: DRAFT_PROPERTIES } } } } } });
    const parsed = JSON.parse(response.choices[0]?.message.content ?? "{}") as { name?: unknown; mails?: unknown[] };
    const mails = Array.isArray(parsed.mails) ? parsed.mails.map((mail, index) => { const base = fallback.mails[index] ?? fallback.mails[fallback.mails.length - 1]; const draft = sanitizeDraft(mail, base); return draft === base ? base : draftIsComplete(draft, index === 0 ? (input.length ?? "mittel") : "kurz") ? draft : completeDraft(draft, base, input.tone ?? "freundlich"); }) : [];
    if (mails.length < 2) return finish(fallback, "vorlage");
    return finish({ name: String(parsed.name ?? fallback.name).trim().slice(0, 160) || fallback.name, mails: mails.map((mail, index) => ({ ...mail, label: mail.label || (index === 0 ? "1. E-Mail" : index === mails.length - 1 ? "Letzte Nachricht" : `Nachfassen ${index}`) })), waitDays: fallback.waitDays, stopWhen: fallback.stopWhen }, "ki");
  } catch { return finish(fallback, "vorlage"); }
}

/** Kurzer Text für SMS/WhatsApp oder eine Einzel-E-Mail (Betreff + Text) aus der Karte. */
export async function draftMessage(input: EmailBrief & { channel: "sms" | "whatsapp" | "email" }): Promise<{ text: string; subject: string | null; source: DraftSource }> {
  const fallback = heuristicMessageDraft(input);
  if (!process.env.ANTHROPIC_API_KEY || !input.brief.trim()) return { ...fallback, source: "vorlage" };
  try {
    const limit = input.channel === "email" ? 900 : SMS_LIMIT;
    const response = await invokeLLM({ model: "fast", maxTokens: 600, temperature: 0.7, messages: [{ role: "system", content: `Du schreibst kurze Vertriebsnachrichten auf Deutsch für Tanesco Digital. Kanal: ${input.channel === "email" ? "E-Mail (Betreff + Text, max. 900 Zeichen)" : `${input.channel.toUpperCase()} (ein Absatz, max. ${limit} Zeichen, keine Überschrift, keine Links außer der genannten)`}. Sie-Form (Ton „locker“ → Du). Platzhalter erlaubt: {{anrede}} {{nachname}} {{vorname}} {{firma}} {{termin}} {{absender}}. Beginne mit der Anrede, ende mit „{{absender}}“ als Unterschrift. Keine erfundenen Fakten.` }, { role: "user", content: describeBrief(input) }], outputSchema: { name: "nachricht", schema: { type: "object", additionalProperties: false, required: ["text"], properties: { subject: { type: ["string", "null"] }, text: { type: "string" } } } } });
    const parsed = JSON.parse(response.choices[0]?.message.content ?? "{}") as { subject?: unknown; text?: unknown };
    const text = String(parsed.text ?? "").trim().slice(0, limit); if (!text) return { ...fallback, source: "vorlage" };
    return { text, subject: input.channel === "email" ? String(parsed.subject ?? fallback.subject ?? "").trim().slice(0, 200) || fallback.subject : null, source: "ki" };
  } catch { return { ...fallback, source: "vorlage" }; }
}

/** Vorlagen „vorschreiben“: ausgewählte Vorschläge als fertige Vorlagen (E-Mail oder Serie) unter „Vorlagen“ ablegen – optional auf eine Lead-Kategorie zugeschnitten. */
export async function writeTemplates(db: Db, tenantId: number, userId: number, input: { keys: string[]; category?: string | null; sender?: string | null; fromName?: string | null; fromEmail?: string | null }) {
  const created: Array<{ id: number; name: string; mails: number; source: DraftSource }> = [];
  for (const key of input.keys) {
    const proposal = TEMPLATE_PROPOSALS.find((item) => item.key === key); if (!proposal) continue;
    const brief = { ...proposalBrief(proposal, input.category), sender: input.sender ?? null };
    const name = templateName(proposal, input.category);
    let tree; let source: DraftSource; let mails = 1;
    if (proposal.kind === "serie") { const result = await draftSeries(brief); tree = result.tree; source = result.source; mails = result.series.mails.length; }
    else { const result = await draftEmail(brief); tree = singleToTree(result.draft); source = result.source; }
    const saved = await saveEmailCampaign(db, tenantId, userId, { name, fromName: input.fromName ?? "Tanesco Digital", fromEmail: input.fromEmail ?? null, audience: proposal.stage ? { source: "stufe", stage: proposal.stage } : { source: "alle" }, tree, design: DEFAULT_DESIGN, isTemplate: true, abSplit: 50 });
    created.push({ id: saved.id, name, mails, source });
  }
  return { created, source: created.some((row) => row.source === "ki") ? "ki" as const : "vorlage" as const };
}
