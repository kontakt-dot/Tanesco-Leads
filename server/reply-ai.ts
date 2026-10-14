/**
 * Antworten im Posteingang einordnen – mit ANTHROPIC_API_KEY über die KI (kurze, günstige Anfrage je Antwort),
 * sonst oder bei Fehlern über die Regeln aus shared/reply-ai.ts. Timeout 12 s, damit das Abholen nie hängen bleibt.
 */
import { invokeLLM } from "./_core/llm";
import { assessReplyByRules, parseReplyAssessment, replyAssessmentPrompt, type ReplyAiSettings, type ReplyAssessment } from "../shared/reply-ai";

const SYSTEM = "Du bist ein sorgfältiger Assistent für den Vertriebs-Posteingang einer deutschen Firma. Du antwortest ausschließlich mit JSON. Eine Beschwerde oder ein Abmeldewunsch muss eindeutig aus dem Text hervorgehen – im Zweifel eine niedrigere Sicherheit angeben.";

export async function assessReply(subject: string | null | undefined, body: string | null | undefined, settings: ReplyAiSettings, deps: { llm?: typeof invokeLLM; apiKey?: string | null } = {}): Promise<ReplyAssessment> {
  const rules = assessReplyByRules(subject, body);
  const apiKey = deps.apiKey === undefined ? process.env.ANTHROPIC_API_KEY : deps.apiKey;
  if (!settings.enabled || !apiKey) return rules;
  try {
    const call = (deps.llm ?? invokeLLM)({ model: "fast", maxTokens: 300, temperature: 0, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: replyAssessmentPrompt(subject, body) }] });
    const response = await Promise.race([call, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("KI-Zeitüberschreitung")), 12_000))]);
    const parsed = parseReplyAssessment(response.choices?.[0]?.message?.content ?? "");
    if (!parsed) return rules;
    // Sicherheitsnetz: eine von den Regeln sicher erkannte Abmeldung bleibt eine Abmeldung, auch wenn die KI „sonstiges“ sagt
    if ((rules.kind === "abmeldung" || rules.kind === "beschwerde") && rules.confidence >= 85 && parsed.kind !== "beschwerde" && parsed.kind !== "abmeldung") return { ...rules, reason: `${rules.reason ?? ""} (KI sah „${parsed.kind}“, Regeln waren eindeutig)`.trim() };
    return parsed;
  } catch { return rules; }
}
