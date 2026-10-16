/**
 * Gesprächsbewertung (Callcenter ↔ Dialer, z. B. OnDialer).
 *
 *  1. Der Dialer meldet jedes beendete Gespräch per Webhook (POST /api/partner/dialer/<token>) mit Aufzeichnung.
 *  2. Ohne dokumentierte Einwilligung wird nichts transkribiert (Einstellung „Einwilligung erforderlich“).
 *  3. Aufzeichnung → Transkript (Transkript aus dem Payload, OpenAI oder Deepgram).
 *  4. Transkript → Bewertung durch Claude nach den Kriterien des Mandanten (Punkte, Urteil, Warnsignale, nächster Schritt).
 *  5. Entscheidung: ab Freigabe-Schwelle Lead freigeben (und über die Automatisierung ausliefern/verkaufen),
 *     unter Ablehnungs-Schwelle sperren, dazwischen zur manuellen Prüfung.
 */
import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { callQaConfigs, callRecords, leadStatusEvents, leads, rawContacts, users, type CallQaConfig, type CallRecord } from "../drizzle/schema";
import { convertRawContact } from "./raw-data";
import { invokeLLM } from "./_core/llm";
import { noteAfterEvaluation } from "./call-notes";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./integration-secrets";
import { triggerLeadAutomations, type Db } from "./lead-pipeline";
import { readPath } from "./outbound-templates";

export type Criterion = { key: string; label: string; weight: number; description: string };
import { callQaCampaigns } from "../drizzle/schema";
import { answerQuestionsHeuristically, decideByQuestions, DEFAULT_QUALIFICATION_QUESTIONS, normalizeQuestions, summarizeAnswers, type QualificationAnswer, type QualificationQuestion } from "../shared/call-qualification";

/** Kampagnen mit eigenen Qualifizierungsfragen. Fehlt eine Kampagne, gilt der Standardfragensatz. */
export async function listCampaigns(db: Db, tenantId: number) {
  const rows = await db.select().from(callQaCampaigns).where(eq(callQaCampaigns.tenantId, tenantId)).orderBy(asc(callQaCampaigns.name));
  const fromCalls = await db.select({ campaign: callRecords.campaign }).from(callRecords).where(eq(callRecords.tenantId, tenantId));
  const names = new Set(rows.map((row) => row.name)); const extra = Array.from(new Set(fromCalls.map((row) => row.campaign).filter((name): name is string => Boolean(name) && !names.has(name!))));
  return [...rows.map((row) => ({ id: row.id, name: row.name, questions: normalizeQuestions(row.questions as QualificationQuestion[] | null), custom: true })), ...extra.map((name) => ({ id: null as number | null, name, questions: DEFAULT_QUALIFICATION_QUESTIONS, custom: false }))];
}
export async function saveCampaign(db: Db, tenantId: number, input: { id?: number | null; name: string; questions: Array<Partial<QualificationQuestion>> }) {
  const name = input.name.trim(); if (!name) throw new Error("Bitte einen Kampagnennamen angeben.");
  const questions = normalizeQuestions(input.questions); if (!questions.length) throw new Error("Bitte mindestens eine Frage angeben.");
  if (input.id) { await db.update(callQaCampaigns).set({ name, questions }).where(and(eq(callQaCampaigns.id, input.id), eq(callQaCampaigns.tenantId, tenantId))); return { id: input.id, questions }; }
  const existing = (await db.select({ id: callQaCampaigns.id }).from(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, tenantId), eq(callQaCampaigns.name, name))).limit(1))[0];
  if (existing) { await db.update(callQaCampaigns).set({ questions }).where(eq(callQaCampaigns.id, existing.id)); return { id: existing.id, questions }; }
  const inserted = await db.insert(callQaCampaigns).values({ tenantId, name, questions }); return { id: Number(inserted[0]?.insertId) || 0, questions };
}
export async function deleteCampaign(db: Db, tenantId: number, id: number) { await db.delete(callQaCampaigns).where(and(eq(callQaCampaigns.id, id), eq(callQaCampaigns.tenantId, tenantId))); return { success: true as const }; }
export async function questionsForCampaign(db: Db, tenantId: number, campaign: string | null | undefined): Promise<QualificationQuestion[]> {
  if (!campaign) return DEFAULT_QUALIFICATION_QUESTIONS;
  const row = (await db.select().from(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, tenantId), eq(callQaCampaigns.name, campaign))).limit(1))[0];
  const questions = row ? normalizeQuestions(row.questions as QualificationQuestion[] | null) : []; return questions.length ? questions : DEFAULT_QUALIFICATION_QUESTIONS;
}
/** Antworten je Frage: KI (wenn verfügbar) – sonst Stichwort-Regeln. */
export async function answerQualification(questions: QualificationQuestion[], transcript: string): Promise<Record<string, QualificationAnswer>> {
  const heuristic = answerQuestionsHeuristically(questions, transcript);
  if (!process.env.ANTHROPIC_API_KEY) return heuristic;
  try {
    const schema = { name: "qualifizierung", schema: { type: "object", additionalProperties: false, required: ["answers"], properties: { answers: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "answer", "note"], properties: { key: { type: "string" }, answer: { type: "string", enum: ["ja", "nein", "unklar"] }, note: { type: "string" } } } } } } };
    const response = await invokeLLM({ model: "fast", maxTokens: 900, messages: [{ role: "system", content: `Beantworte die folgenden Fragen zu einem Verkaufsgespräch ausschließlich anhand des Transkripts mit ja, nein oder unklar und einem kurzen Beleg (note). Erfinde nichts.\n${questions.map((question) => `- ${question.key}: ${question.label}`).join("\n")}` }, { role: "user", content: `Transkript:\n"""\n${transcript.slice(0, 40_000)}\n"""` }], outputSchema: schema });
    const parsed = JSON.parse(response.choices[0]?.message.content ?? "{}") as { answers?: Array<{ key: string; answer: string; note?: string }> };
    const out: Record<string, QualificationAnswer> = { ...heuristic };
    for (const item of parsed.answers ?? []) if (questions.some((question) => question.key === item.key) && ["ja", "nein", "unklar"].includes(item.answer)) out[item.key] = { answer: item.answer as QualificationAnswer["answer"], note: String(item.note ?? "").slice(0, 240) };
    return out;
  } catch { return heuristic; }
}
export async function campaignSummary(db: Db, tenantId: number, campaign: string | null | undefined) {
  const questions = await questionsForCampaign(db, tenantId, campaign);
  const conditions = [eq(callRecords.tenantId, tenantId), eq(callRecords.status, "bewertet")]; if (campaign) conditions.push(eq(callRecords.campaign, campaign));
  const rows = await db.select({ answers: callRecords.qualificationAnswers }).from(callRecords).where(and(...conditions));
  return { questions, calls: rows.length, summary: summarizeAnswers(rows.map((row) => row.answers as Record<string, QualificationAnswer> | null), questions) };
}
export async function setQualificationAnswer(db: Db, tenantId: number, callId: number, key: string, answer: QualificationAnswer["answer"], note?: string | null) {
  const record = (await db.select().from(callRecords).where(and(eq(callRecords.id, callId), eq(callRecords.tenantId, tenantId))).limit(1))[0]; if (!record) throw new Error("Gespräch nicht gefunden.");
  const current = (record.qualificationAnswers && typeof record.qualificationAnswers === "object" ? record.qualificationAnswers : {}) as Record<string, QualificationAnswer>;
  const next = { ...current, [key]: { answer, ...(note ? { note } : {}) } };
  const byQuestions = record.decidedBy === "manuell" ? null : decideByQuestions(await questionsForCampaign(db, tenantId, record.campaign), next);
  await db.update(callRecords).set({ qualificationAnswers: next, ...(byQuestions ? { decision: byQuestions.decision, decidedBy: "automatisch" as const, nextStep: byQuestions.reason.slice(0, 320) } : {}) }).where(eq(callRecords.id, callId));
  return { success: true as const, answers: next, decision: byQuestions?.decision ?? record.decision, reason: byQuestions?.reason ?? null };
}

export const DEFAULT_CRITERIA: Criterion[] = [
  { key: "bedarf", label: "Bedarf & Interesse", weight: 25, description: "Der Kunde hat ein konkretes Anliegen und echtes Interesse an einem Angebot." },
  { key: "entscheider", label: "Entscheidungsbefugnis", weight: 15, description: "Der Gesprächspartner entscheidet selbst (Eigentümer, Geschäftsführer) oder benennt den Entscheider." },
  { key: "zeitrahmen", label: "Zeitrahmen", weight: 15, description: "Umsetzung ist zeitnah geplant (in den nächsten Monaten), nicht nur unverbindlich." },
  { key: "budget", label: "Budget / Finanzierung", weight: 15, description: "Budget oder Finanzierung sind vorhanden oder realistisch besprochen." },
  { key: "kontaktdaten", label: "Kontaktdaten bestätigt", weight: 15, description: "Name, Telefonnummer, Adresse und Erreichbarkeit wurden bestätigt oder korrigiert." },
  { key: "einwilligung", label: "Weitergabe erlaubt", weight: 15, description: "Der Kunde ist ausdrücklich einverstanden, dass ein Fachbetrieb/Partner ihn kontaktiert." },
];
export type DecisionRule = { id: string; label: string; field: "score" | "verdict" | "redFlags" | "transcript" | `criterion:${string}`; op: "gte" | "lte" | "eq" | "contains" | "any"; value: string; decision: "freigegeben" | "pruefen" | "zurueckgewiesen"; active: boolean };
export type ExampleCase = { title: string; transcript: string; verdict: "verkaufbar" | "nachfassen" | "nicht_verkaufbar"; reason: string };
export type ExtractField = { key: string; label: string; question: string };
export const DEFAULT_MAPPING = { callId: "call_id", leadId: "lead_id", phone: "phone", agent: "agent", campaign: "campaign", direction: "direction", startedAt: "started_at", duration: "duration", recordingUrl: "recording_url", transcript: "transcript", consent: "consent" };

const normalizePhone = (value: string) => value.replace(/[^\d+]/g, "").replace(/^\+/, "00").replace(/^0049/, "0").replace(/^00/, "");

export async function ensureCallQaConfig(db: Db, tenantId: number): Promise<CallQaConfig> {
  const existing = (await db.select().from(callQaConfigs).where(eq(callQaConfigs.tenantId, tenantId)).limit(1))[0];
  if (existing) return existing;
  await db.insert(callQaConfigs).values({ tenantId, webhookToken: nanoid(40), criteria: DEFAULT_CRITERIA, fieldMapping: DEFAULT_MAPPING });
  return (await db.select().from(callQaConfigs).where(eq(callQaConfigs.tenantId, tenantId)).limit(1))[0];
}

export async function getCallQaSettings(db: Db, tenantId: number, appUrl: string) {
  const config = await ensureCallQaConfig(db, tenantId);
  return { ...config, recordingAuthHeader: config.recordingAuthHeader ? "••••••••" : "", webhookUrl: `${appUrl.replace(/\/+$/, "")}/api/partner/dialer/${config.webhookToken}`, criteria: (Array.isArray(config.criteria) ? config.criteria : DEFAULT_CRITERIA) as Criterion[], fieldMapping: { ...DEFAULT_MAPPING, ...((config.fieldMapping ?? {}) as Record<string, string>) }, decisionRules: (Array.isArray(config.decisionRules) ? config.decisionRules : []) as DecisionRule[], examples: (Array.isArray(config.examples) ? config.examples : []) as ExampleCase[], extractFields: (Array.isArray(config.extractFields) ? config.extractFields : []) as ExtractField[], transcriptionAvailable: { openai: Boolean(process.env.OPENAI_API_KEY), deepgram: Boolean(process.env.DEEPGRAM_API_KEY) } };
}

export async function saveCallQaSettings(db: Db, tenantId: number, input: { enabled: boolean; consentRequired: boolean; autoApproveThreshold: number; autoRejectThreshold: number; autoDeliver: boolean; criteria: Criterion[]; instructions: string; fieldMapping: Record<string, string>; recordingAuthHeader: string; transcriptionProvider: "auto" | "payload" | "openai" | "deepgram"; transcriptionLanguage: string; retentionDays: number; decisionRules?: DecisionRule[]; examples?: ExampleCase[]; extractFields?: ExtractField[] }) {
  const config = await ensureCallQaConfig(db, tenantId);
  if (input.autoRejectThreshold >= input.autoApproveThreshold) throw new Error("Die Ablehnungs-Schwelle muss unter der Freigabe-Schwelle liegen.");
  const totalWeight = input.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (!input.criteria.length || totalWeight <= 0) throw new Error("Mindestens ein Kriterium mit Gewicht ist nötig.");
  const authHeader = input.recordingAuthHeader === "••••••••" ? config.recordingAuthHeader : input.recordingAuthHeader.trim() ? encryptIntegrationSecret(input.recordingAuthHeader.trim()) : null;
  await db.update(callQaConfigs).set({ enabled: input.enabled, consentRequired: input.consentRequired, autoApproveThreshold: input.autoApproveThreshold, autoRejectThreshold: input.autoRejectThreshold, autoDeliver: input.autoDeliver, criteria: input.criteria, instructions: input.instructions, fieldMapping: input.fieldMapping, recordingAuthHeader: authHeader, transcriptionProvider: input.transcriptionProvider, transcriptionLanguage: input.transcriptionLanguage, retentionDays: input.retentionDays, ...(input.decisionRules ? { decisionRules: input.decisionRules } : {}), ...(input.examples ? { examples: input.examples } : {}), ...(input.extractFields ? { extractFields: input.extractFields.filter((field) => field.key && field.question) } : {}) }).where(eq(callQaConfigs.id, config.id));
  return { success: true as const };
}

export async function rotateCallQaToken(db: Db, tenantId: number) {
  const config = await ensureCallQaConfig(db, tenantId);
  const webhookToken = nanoid(40);
  await db.update(callQaConfigs).set({ webhookToken }).where(eq(callQaConfigs.id, config.id));
  return { webhookToken };
}

/* ------------------------------------------------------------------ Eingang vom Dialer */

const text = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const truthy = (value: unknown) => value === true || ["true", "1", "yes", "ja", "y"].includes(String(value ?? "").toLowerCase());

export async function ingestDialerCall(db: Db, token: string, payload: Record<string, unknown>, options: { fetchImpl?: typeof fetch } = {}) {
  const config = (await db.select().from(callQaConfigs).where(eq(callQaConfigs.webhookToken, token)).limit(1))[0];
  if (!config) return { status: 404, body: { error: "unknown webhook token" } };
  if (!config.enabled) return { status: 403, body: { error: "call evaluation disabled" } };
  const mapping = { ...DEFAULT_MAPPING, ...((config.fieldMapping ?? {}) as Record<string, string>) };
  const get = (key: keyof typeof DEFAULT_MAPPING) => readPath(payload, mapping[key]) ?? payload[key];
  const externalCallId = text(get("callId")) || null;
  if (externalCallId) { const existing = (await db.select({ id: callRecords.id, status: callRecords.status }).from(callRecords).where(and(eq(callRecords.tenantId, config.tenantId), eq(callRecords.externalCallId, externalCallId))).limit(1))[0]; if (existing) return { status: 200, body: { ok: true, call_id: existing.id, duplicate: true, status: existing.status } }; }
  const phone = text(get("phone")); const leadRef = text(get("leadId"));
  let lead = leadRef ? (await db.select().from(leads).where(and(eq(leads.tenantId, config.tenantId), eq(leads.kind, "verkauf"), or(eq(leads.publicId, leadRef), ...(Number.isInteger(Number(leadRef)) && Number(leadRef) > 0 ? [eq(leads.id, Number(leadRef))] : [])))).limit(1))[0] : undefined;
  if (!lead && phone) { const digits = normalizePhone(phone); const candidates = await db.select().from(leads).where(and(eq(leads.tenantId, config.tenantId), eq(leads.kind, "verkauf"), or(eq(leads.phone, phone), eq(leads.phone, `+${digits}`), eq(leads.phone, `0${digits.replace(/^49/, "")}`)))).orderBy(desc(leads.createdAt)).limit(5); lead = candidates.find((row) => row.phone && normalizePhone(row.phone) === digits) ?? candidates[0]; }
  const consent = truthy(get("consent")) || !config.consentRequired;
  const startedAtRaw = text(get("startedAt")); const startedAt = startedAtRaw && !Number.isNaN(new Date(startedAtRaw).getTime()) ? new Date(startedAtRaw) : new Date();
  const inserted = await db.insert(callRecords).values({ tenantId: config.tenantId, provider: config.provider, externalCallId, leadId: lead?.id ?? null, phone: phone || lead?.phone || null, agentName: text(get("agent")) || null, campaign: text(get("campaign")) || null, direction: /in|eingehend/i.test(text(get("direction"))) ? "eingehend" : "ausgehend", startedAt, durationSeconds: Number(get("duration")) || null, recordingUrl: text(get("recordingUrl")) || null, consent, consentSource: truthy(get("consent")) ? `Dialer-Feld ${mapping.consent}` : config.consentRequired ? null : "Einstellung: keine Einwilligung erforderlich", transcript: text(get("transcript")) || null, status: consent ? "eingegangen" : "ohne_einwilligung", payload: payload as never });
  const callId = Number(inserted[0]?.insertId) || 0;
  if (!consent) { if (lead) await db.insert(leadStatusEvents).values({ tenantId: config.tenantId, leadId: lead.id, previousStatus: lead.status, nextStatus: lead.status, actorUserId: null, note: "Gespräch eingegangen, aber ohne dokumentierte Einwilligung – nicht ausgewertet." }); return { status: 202, body: { ok: true, call_id: callId, lead_id: lead?.publicId ?? null, evaluated: false, reason: "no consent" } }; }
  const result = await processCall(db, callId, options);
  return { status: 200, body: { ok: true, call_id: callId, lead_id: lead?.publicId ?? null, evaluated: result.status === "bewertet", score: result.score, verdict: result.verdict, decision: result.decision, error: result.error } };
}

/** Eingang aus dem eigenen Dialer (kein Webhook-Token nötig). */
export async function ingestInternalCall(db: Db, tenantId: number, input: { externalCallId: string; leadId: number | null; rawContactId?: number | null; phone: string | null; agentName: string | null; campaign: string | null; startedAt: Date; durationSeconds: number | null; recordingUrl: string; consent: boolean; consentSource: string | null; provider: string }, options: { fetchImpl?: typeof fetch } = {}) {
  const config = await ensureCallQaConfig(db, tenantId);
  const existing = (await db.select({ id: callRecords.id }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.externalCallId, input.externalCallId))).limit(1))[0];
  if (existing) return { callId: existing.id, evaluated: false };
  const consent = input.consent || !config.consentRequired;
  const inserted = await db.insert(callRecords).values({ tenantId, provider: input.provider, externalCallId: input.externalCallId, leadId: input.leadId, rawContactId: input.rawContactId ?? null, phone: input.phone, agentName: input.agentName, campaign: input.campaign, direction: "ausgehend", startedAt: input.startedAt, durationSeconds: input.durationSeconds, recordingUrl: input.recordingUrl, consent, consentSource: consent ? input.consentSource ?? (config.consentRequired ? null : "Einstellung: keine Einwilligung erforderlich") : null, status: consent ? "eingegangen" : "ohne_einwilligung", payload: { source: input.provider } });
  const callId = Number(inserted[0]?.insertId) || 0;
  if (!consent || !config.enabled) return { callId, evaluated: false, leadId: null };
  const result = await processCall(db, callId, options);
  const record = (await db.select({ leadId: callRecords.leadId }).from(callRecords).where(eq(callRecords.id, callId)).limit(1))[0];
  return { callId, evaluated: result.status === "bewertet", decision: result.decision, leadId: record?.leadId ?? null };
}

/* ------------------------------------------------------------------ Transkription */

async function transcribe(config: CallQaConfig, call: CallRecord, fetchImpl: typeof fetch): Promise<string> {
  const provider = config.transcriptionProvider === "auto" ? (call.transcript ? "payload" : process.env.OPENAI_API_KEY ? "openai" : process.env.DEEPGRAM_API_KEY ? "deepgram" : "payload") : config.transcriptionProvider;
  if (provider === "payload") { if (call.transcript) return call.transcript; throw new Error("Kein Transkript im Payload und kein Transkriptionsdienst konfiguriert (OPENAI_API_KEY oder DEEPGRAM_API_KEY)."); }
  if (!call.recordingUrl) throw new Error("Keine Aufzeichnungs-URL übergeben.");
  const headers: Record<string, string> = {};
  if (config.recordingAuthHeader) { const raw = decryptIntegrationSecret(config.recordingAuthHeader); const [name, ...rest] = raw.split(":"); if (rest.length) headers[name.trim().toLowerCase()] = rest.join(":").trim(); else headers.authorization = raw; }
  const audioResponse = await fetchImpl(call.recordingUrl, { headers });
  if (!audioResponse.ok) throw new Error(`Aufzeichnung konnte nicht geladen werden (HTTP ${audioResponse.status}).`);
  const audio = new Uint8Array(await audioResponse.arrayBuffer());
  const contentType = audioResponse.headers.get("content-type") ?? "audio/mpeg";
  if (provider === "openai") {
    const form = new FormData(); form.append("file", new Blob([audio], { type: contentType }), "aufzeichnung.mp3"); form.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1"); form.append("language", config.transcriptionLanguage || "de"); form.append("response_format", "text");
    const response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
    const body = await response.text(); if (!response.ok) throw new Error(`Transkription (OpenAI) fehlgeschlagen: HTTP ${response.status} ${body.slice(0, 200)}`);
    return body.trim();
  }
  const response = await fetchImpl(`https://api.deepgram.com/v1/listen?model=nova-2&language=${encodeURIComponent(config.transcriptionLanguage || "de")}&smart_format=true&diarize=true&utterances=true`, { method: "POST", headers: { authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "content-type": contentType }, body: audio });
  const body = await response.text(); if (!response.ok) throw new Error(`Transkription (Deepgram) fehlgeschlagen: HTTP ${response.status} ${body.slice(0, 200)}`);
  try { const parsed = JSON.parse(body) as { results?: { utterances?: Array<{ speaker: number; transcript: string }>; channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } }; const utterances = parsed.results?.utterances; if (utterances?.length) return utterances.map((item) => `Sprecher ${item.speaker + 1}: ${item.transcript}`).join("\n"); return parsed.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ""; } catch { return body; }
}

/* ------------------------------------------------------------------ Bewertung */

export type Evaluation = { score: number; verdict: "verkaufbar" | "nachfassen" | "nicht_verkaufbar" | "unklar"; criteria: Array<{ key: string; score: number; evidence: string }>; summary: string; redFlags: string[]; nextStep: string; extracted: Record<string, string> };

export async function evaluateTranscript(config: Pick<CallQaConfig, "criteria" | "instructions"> & Partial<Pick<CallQaConfig, "examples" | "extractFields">>, transcript: string, context: { leadCategory?: string | null; leadName?: string | null }): Promise<Evaluation> {
  const criteria = (Array.isArray(config.criteria) && config.criteria.length ? config.criteria : DEFAULT_CRITERIA) as Criterion[];
  const examples = (Array.isArray(config.examples) ? config.examples : []) as ExampleCase[];
  const extractFields = (Array.isArray(config.extractFields) ? config.extractFields : []) as ExtractField[];
  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0) || 1;
  const schema = { name: "gespraechsbewertung", schema: { type: "object", additionalProperties: false, required: ["criteria", "summary", "redFlags", "nextStep", "verdict", "extracted"], properties: { criteria: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "score", "evidence"], properties: { key: { type: "string" }, score: { type: "integer", minimum: 0, maximum: 10 }, evidence: { type: "string" } } } }, summary: { type: "string" }, redFlags: { type: "array", items: { type: "string" } }, nextStep: { type: "string" }, verdict: { type: "string", enum: ["verkaufbar", "nachfassen", "nicht_verkaufbar", "unklar"] }, extracted: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "value"], properties: { key: { type: "string" }, value: { type: "string" } } } } } } };
  const system = `Du bewertest Verkaufsgespräche eines Callcenters, das Anfragen (Leads) für Fachbetriebe qualifiziert. Bewerte NUR anhand des Transkripts, erfinde nichts. Bewertungskriterien (0 = gar nicht erfüllt, 10 = vollständig erfüllt), jeweils mit wörtlichem Beleg aus dem Gespräch:\n${criteria.map((criterion) => `- ${criterion.key}: ${criterion.label} – ${criterion.description}`).join("\n")}\nWarnsignale (redFlags), die den Lead unverkäuflich machen: Kunde will nicht kontaktiert werden, widerruft, Daten sind falsch, Gespräch war unzulässig (Werbeanruf ohne Einwilligung), Kunde ist Minderjähriger, Agent hat Druck ausgeübt oder Falsches versprochen.\nUrteil: verkaufbar = Kunde will ein Angebot und die Weitergabe ist erlaubt; nachfassen = Interesse, aber offene Punkte; nicht_verkaufbar = kein Interesse oder Warnsignal; unklar = Transkript unvollständig.${extractFields.length ? `\nZusätzlich beantworte diese Fragen aus dem Gespräch (extracted, leer lassen wenn nicht genannt):\n${extractFields.map((field) => `- ${field.key}: ${field.question}`).join("\n")}` : "\nextracted bleibt eine leere Liste."}\nAntworte ausschließlich auf Deutsch.${config.instructions ? `\nZusätzliche Vorgaben des Mandanten: ${config.instructions}` : ""}${examples.length ? `\nBeispiele für die gewünschte Einordnung:\n${examples.slice(0, 8).map((example, index) => `Beispiel ${index + 1} (${example.title}): Auszug: "${example.transcript.slice(0, 600)}" → Urteil: ${example.verdict}. Begründung: ${example.reason}`).join("\n")}` : ""}`;
  const user = `${context.leadCategory ? `Lead-Kategorie: ${context.leadCategory}\n` : ""}${context.leadName ? `Kunde laut Lead: ${context.leadName}\n` : ""}Transkript:\n"""\n${transcript.slice(0, 60_000)}\n"""`;
  const response = await invokeLLM({ messages: [{ role: "system", content: system }, { role: "user", content: user }], outputSchema: schema, maxTokens: 2500 });
  const parsed = JSON.parse(response.choices[0]?.message.content ?? "{}") as Partial<Omit<Evaluation, "extracted">> & { extracted?: Array<{ key: string; value: string }> | Record<string, string> };
  const scored = criteria.map((criterion) => { const found = parsed.criteria?.find((item) => item.key === criterion.key); return { key: criterion.key, score: Math.max(0, Math.min(10, Number(found?.score ?? 0))), evidence: String(found?.evidence ?? "").slice(0, 500) }; });
  const score = Math.round(criteria.reduce((sum, criterion) => sum + (scored.find((item) => item.key === criterion.key)?.score ?? 0) / 10 * criterion.weight, 0) / totalWeight * 100);
  const redFlags = Array.isArray(parsed.redFlags) ? parsed.redFlags.map(String).filter(Boolean).slice(0, 10) : [];
  const verdict = redFlags.length ? "nicht_verkaufbar" : (["verkaufbar", "nachfassen", "nicht_verkaufbar", "unklar"].includes(parsed.verdict ?? "") ? parsed.verdict! : score >= 70 ? "verkaufbar" : score >= 40 ? "nachfassen" : "nicht_verkaufbar");
  const extracted: Record<string, string> = {};
  const rawExtracted = parsed.extracted; if (Array.isArray(rawExtracted)) for (const item of rawExtracted) if (item?.key && extractFields.some((field) => field.key === item.key) && String(item.value ?? "").trim()) extracted[item.key] = String(item.value).slice(0, 500); else if (rawExtracted && typeof rawExtracted === "object") for (const [key, value] of Object.entries(rawExtracted)) if (extractFields.some((field) => field.key === key) && String(value ?? "").trim()) extracted[key] = String(value).slice(0, 500);
  return { score, verdict, criteria: scored, summary: String(parsed.summary ?? "").slice(0, 2000), redFlags, nextStep: String(parsed.nextStep ?? "").slice(0, 320), extracted };
}

/** Entscheidungsregeln des Mandanten (erste passende Regel gewinnt), sonst Schwellenwerte. */
export function decideCall(config: Pick<CallQaConfig, "autoApproveThreshold" | "autoRejectThreshold" | "decisionRules">, evaluation: Evaluation, transcript: string): { decision: "freigegeben" | "pruefen" | "zurueckgewiesen"; rule: DecisionRule | null } {
  const rules = (Array.isArray(config.decisionRules) ? config.decisionRules : []) as DecisionRule[];
  for (const rule of rules.filter((item) => item.active)) {
    let actual: string | number = "";
    if (rule.field === "score") actual = evaluation.score; else if (rule.field === "verdict") actual = evaluation.verdict; else if (rule.field === "redFlags") actual = evaluation.redFlags.join(" | "); else if (rule.field === "transcript") actual = transcript; else if (rule.field.startsWith("criterion:")) actual = evaluation.criteria.find((item) => item.key === rule.field.slice(10))?.score ?? 0;
    const expectedNumber = Number(rule.value); const actualText = String(actual).toLowerCase(); const expectedText = rule.value.toLowerCase();
    const hit = rule.op === "gte" ? Number(actual) >= expectedNumber : rule.op === "lte" ? Number(actual) <= expectedNumber : rule.op === "eq" ? actualText === expectedText : rule.op === "contains" ? actualText.includes(expectedText) : rule.op === "any" ? actualText.trim().length > 0 : false;
    if (hit) return { decision: rule.decision, rule };
  }
  const decision = evaluation.redFlags.length || evaluation.score <= config.autoRejectThreshold ? "zurueckgewiesen" : evaluation.score >= config.autoApproveThreshold && evaluation.verdict === "verkaufbar" ? "freigegeben" : "pruefen";
  return { decision, rule: null };
}

/* ------------------------------------------------------------------ Verarbeitung & Entscheidung */

export async function processCall(db: Db, callId: number, options: { fetchImpl?: typeof fetch } = {}) {
  const call = (await db.select().from(callRecords).where(eq(callRecords.id, callId)).limit(1))[0];
  if (!call) throw new Error("Gespräch wurde nicht gefunden.");
  const config = await ensureCallQaConfig(db, call.tenantId);
  try {
    const transcript = call.status === "eingegangen" || !call.transcript ? await transcribe(config, call, options.fetchImpl ?? fetch) : call.transcript;
    if (!transcript.trim()) throw new Error("Transkript ist leer.");
    await db.update(callRecords).set({ transcript, status: "transkribiert", error: null }).where(eq(callRecords.id, callId));
    const lead = call.leadId ? (await db.select().from(leads).where(eq(leads.id, call.leadId)).limit(1))[0] : undefined;
    const evaluation = await evaluateTranscript(config, transcript, { leadName: lead ? `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() : null });
    const decided = decideCall(config, evaluation, transcript); let decision = decided.decision; const rule = decided.rule;
    const questions = await questionsForCampaign(db, call.tenantId, call.campaign);
    const qualificationAnswers = await answerQualification(questions, transcript);
    const byQuestions = decideByQuestions(questions, qualificationAnswers);
    const strictness = { freigegeben: 0, pruefen: 1, zurueckgewiesen: 2 } as const;
    if (byQuestions) { decision = byQuestions.decision; if (rule && strictness[decided.decision] > strictness[decision]) decision = decided.decision; } // Kampagnenfragen entscheiden; eine ausdrücklich angelegte Entscheidungsregel darf nur strenger machen
    const nextStep = [byQuestions?.reason, rule ? `Regel: ${rule.label}` : null, evaluation.nextStep].filter(Boolean).join(" · ").slice(0, 320);
    await db.update(callRecords).set({ status: "bewertet", score: evaluation.score, verdict: evaluation.verdict, criteriaScores: evaluation.criteria, qualificationAnswers, summary: evaluation.summary, redFlags: evaluation.redFlags, nextStep, decision, decidedBy: "automatisch", error: null }).where(eq(callRecords.id, callId));
    let target = lead;
    if (!target && call.rawContactId) {
      // Rohdaten-Kontakt: die Freigabe macht ihn zum Lead (mit Auslieferung über die Regeln), Ablehnung verwirft ihn
      if (decision === "freigegeben") { const converted = await convertRawContact(db, call.tenantId, call.rawContactId, { actorUserId: null, initialStatus: "genehmigt", note: `Gesprächsbewertung ${evaluation.score}/100` }); await db.update(callRecords).set({ leadId: converted.leadId }).where(eq(callRecords.id, callId)); target = (await db.select().from(leads).where(eq(leads.id, converted.leadId)).limit(1))[0]; }
      else if (decision === "zurueckgewiesen") await db.update(rawContacts).set({ status: "verworfen", note: `Gesprächsbewertung ${evaluation.score}/100: ${evaluation.verdict}` }).where(and(eq(rawContacts.id, call.rawContactId), eq(rawContacts.status, "in_liste")));
    }
    if (target) {
      if (Object.keys(evaluation.extracted).length) { const meta = target.metadata && typeof target.metadata === "object" && !Array.isArray(target.metadata) ? (target.metadata as Record<string, unknown>) : {}; await db.update(leads).set({ metadata: { ...meta, ...evaluation.extracted, callExtractedAt: new Date().toISOString() } }).where(eq(leads.id, target.id)); }
      await applyDecision(db, config, callId, target, decision, evaluation, null);
    }
    await noteAfterEvaluation(db, call.tenantId, callId); // automatische Gesprächsnotiz mit Transkript (Dialer-Anrufe)
    return { status: "bewertet" as const, score: evaluation.score, verdict: evaluation.verdict, decision, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    await db.update(callRecords).set({ status: "fehlgeschlagen", error: message }).where(eq(callRecords.id, callId));
    return { status: "fehlgeschlagen" as const, score: null, verdict: null, decision: "offen" as const, error: message };
  }
}

async function applyDecision(db: Db, config: CallQaConfig, callId: number, lead: typeof leads.$inferSelect, decision: "freigegeben" | "pruefen" | "zurueckgewiesen", evaluation: Pick<Evaluation, "score" | "verdict" | "summary">, actorUserId: number | null) {
  const label = `Gesprächsbewertung ${evaluation.score}/100 (${evaluation.verdict.replace("_", " ")})`;
  const current = (await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1))[0] ?? lead;
  let nextStatus = current.status;
  if (decision === "freigegeben" && ["neu", "hängend", "fehlerhaft"].includes(current.status)) nextStatus = "genehmigt";
  if (decision === "zurueckgewiesen" && !["zugewiesen", "reklamiert", "deaktiviert"].includes(current.status)) nextStatus = "fehlerhaft";
  if (decision === "pruefen" && current.status === "neu") nextStatus = "hängend";
  const meta = current.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata) ? (current.metadata as Record<string, unknown>) : {};
  await db.update(leads).set({ status: nextStatus, metadata: { ...meta, callScore: evaluation.score, callVerdict: evaluation.verdict, callDecision: decision, callRecordId: callId } }).where(eq(leads.id, lead.id));
  await db.insert(leadStatusEvents).values({ tenantId: config.tenantId, leadId: lead.id, previousStatus: current.status, nextStatus, actorUserId, note: `${label}: ${decision === "freigegeben" ? "freigegeben" : decision === "pruefen" ? "zur Prüfung" : "zurückgewiesen"}${evaluation.summary ? ` – ${evaluation.summary.slice(0, 200)}` : ""}` });
  if (decision === "freigegeben" && config.autoDeliver && nextStatus !== current.status) await triggerLeadAutomations(db, { tenantId: config.tenantId, actorUserId, leadId: lead.id, triggerType: "status_geändert" });
}

export async function reviewCall(db: Db, tenantId: number, userId: number, input: { callId: number; decision: "freigegeben" | "pruefen" | "zurueckgewiesen"; note?: string }) {
  const call = (await db.select().from(callRecords).where(and(eq(callRecords.id, input.callId), eq(callRecords.tenantId, tenantId))).limit(1))[0];
  if (!call) throw new Error("Gespräch wurde nicht gefunden.");
  const config = await ensureCallQaConfig(db, tenantId);
  await db.update(callRecords).set({ decision: input.decision, decidedBy: "manuell", reviewedByUserId: userId, reviewedAt: new Date(), reviewNote: input.note?.slice(0, 500) ?? null }).where(eq(callRecords.id, call.id));
  let lead = call.leadId ? (await db.select().from(leads).where(eq(leads.id, call.leadId)).limit(1))[0] : undefined;
  if (!lead && call.rawContactId) {
    if (input.decision === "freigegeben") { const converted = await convertRawContact(db, tenantId, call.rawContactId, { actorUserId: userId, initialStatus: "genehmigt", note: `Manuelle Freigabe${input.note ? `: ${input.note}` : ""}` }); await db.update(callRecords).set({ leadId: converted.leadId }).where(eq(callRecords.id, call.id)); lead = (await db.select().from(leads).where(eq(leads.id, converted.leadId)).limit(1))[0]; }
    else if (input.decision === "zurueckgewiesen") await db.update(rawContacts).set({ status: "verworfen", note: `Manuell zurückgewiesen${input.note ? `: ${input.note}` : ""}` }).where(and(eq(rawContacts.id, call.rawContactId), inArray(rawContacts.status, ["neu", "in_liste"])));
  }
  if (lead) await applyDecision(db, config, call.id, lead, input.decision, { score: call.score ?? 0, verdict: call.verdict ?? "unklar", summary: input.note ?? call.summary ?? "" }, userId);
  return { success: true as const };
}

export async function linkCallToLead(db: Db, tenantId: number, callId: number, publicId: string) {
  const call = (await db.select().from(callRecords).where(and(eq(callRecords.id, callId), eq(callRecords.tenantId, tenantId))).limit(1))[0];
  const lead = (await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "verkauf"), eq(leads.publicId, publicId))).limit(1))[0];
  if (!call || !lead) throw new Error("Gespräch oder Lead wurde nicht gefunden.");
  await db.update(callRecords).set({ leadId: lead.id }).where(eq(callRecords.id, call.id));
  return { success: true as const };
}

/** „Bewertung testen“: bewertet ein eingegebenes Transkript ohne Dialer (optional an einen Lead gebunden). */
export async function simulateCall(db: Db, tenantId: number, input: { transcript: string; publicId?: string | null; agentName?: string | null }, options: { fetchImpl?: typeof fetch } = {}) {
  const config = await ensureCallQaConfig(db, tenantId);
  const lead = input.publicId ? (await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "verkauf"), eq(leads.publicId, input.publicId))).limit(1))[0] : undefined;
  const inserted = await db.insert(callRecords).values({ tenantId, provider: "test", externalCallId: `TEST-${nanoid(8)}`, leadId: lead?.id ?? null, phone: lead?.phone ?? null, agentName: input.agentName ?? "Test", campaign: "Bewertung testen", startedAt: new Date(), durationSeconds: Math.round(input.transcript.split(/\s+/).length / 2.5), consent: true, consentSource: "Test", transcript: input.transcript, status: "transkribiert", payload: { test: true } });
  const callId = Number(inserted[0]?.insertId) || 0;
  const result = await processCall(db, callId, options);
  return { callId, ...result };
}

export async function listCalls(db: Db, tenantId: number, filter: { decision?: string | null; status?: string | null; campaign?: string | null; agentName?: string | null; limit?: number } = {}) {
  const conditions = [eq(callRecords.tenantId, tenantId)];
  if (filter.decision) conditions.push(eq(callRecords.decision, filter.decision as CallRecord["decision"]));
  if (filter.agentName) conditions.push(eq(callRecords.agentName, filter.agentName));
  if (filter.status) conditions.push(eq(callRecords.status, filter.status as CallRecord["status"]));
  if (filter.campaign) conditions.push(eq(callRecords.campaign, filter.campaign));
  const rows = await db.select({ call: callRecords, leadPublicId: leads.publicId, leadName: leads.firstName, leadLastName: leads.lastName, leadStatus: leads.status, reviewer: users.name, rawFirst: rawContacts.firstName, rawLast: rawContacts.lastName, rawCompany: rawContacts.company }).from(callRecords).leftJoin(leads, eq(leads.id, callRecords.leadId)).leftJoin(users, eq(users.id, callRecords.reviewedByUserId)).leftJoin(rawContacts, eq(rawContacts.id, callRecords.rawContactId)).where(and(...conditions)).orderBy(desc(callRecords.createdAt)).limit(filter.limit ?? 200);
  return rows.map(({ call, leadPublicId, leadName, leadLastName, leadStatus, reviewer, rawFirst, rawLast, rawCompany }) => ({ id: call.id, externalCallId: call.externalCallId, provider: call.provider, leadId: call.leadId, rawContactId: call.rawContactId, rawContactName: call.rawContactId ? [rawFirst, rawLast].filter(Boolean).join(" ") || rawCompany || "Rohdaten-Kontakt" : null, leadPublicId, leadName: [leadName, leadLastName].filter(Boolean).join(" ") || null, leadStatus, phone: call.phone, agentName: call.agentName, campaign: call.campaign, direction: call.direction, startedAt: call.startedAt, durationSeconds: call.durationSeconds, consent: call.consent, status: call.status, score: call.score, verdict: call.verdict, decision: call.decision, decidedBy: call.decidedBy, reviewer, reviewedAt: call.reviewedAt, summary: call.summary, nextStep: call.nextStep, error: call.error, createdAt: call.createdAt, qualificationAnswers: (call.qualificationAnswers ?? null) as Record<string, QualificationAnswer> | null }));
}

export async function getCall(db: Db, tenantId: number, callId: number) {
  const row = (await db.select({ call: callRecords, leadPublicId: leads.publicId, leadName: leads.firstName, leadLastName: leads.lastName, leadStatus: leads.status, reviewer: users.name, rawFirst: rawContacts.firstName, rawLast: rawContacts.lastName, rawCompany: rawContacts.company, rawStatus: rawContacts.status }).from(callRecords).leftJoin(leads, eq(leads.id, callRecords.leadId)).leftJoin(users, eq(users.id, callRecords.reviewedByUserId)).leftJoin(rawContacts, eq(rawContacts.id, callRecords.rawContactId)).where(and(eq(callRecords.id, callId), eq(callRecords.tenantId, tenantId))).limit(1))[0];
  if (!row) throw new Error("Gespräch wurde nicht gefunden.");
  const config = await ensureCallQaConfig(db, tenantId);
  const criteria = (Array.isArray(config.criteria) ? config.criteria : DEFAULT_CRITERIA) as Criterion[];
  const scores = Array.isArray(row.call.criteriaScores) ? (row.call.criteriaScores as Evaluation["criteria"]) : [];
  const questions = await questionsForCampaign(db, tenantId, row.call.campaign);
  return { ...row.call, payload: undefined, questions, qualificationAnswers: (row.call.qualificationAnswers ?? {}) as Record<string, QualificationAnswer>, leadPublicId: row.leadPublicId, leadName: [row.leadName, row.leadLastName].filter(Boolean).join(" ") || null, leadStatus: row.leadStatus, rawContact: row.call.rawContactId ? { id: row.call.rawContactId, name: [row.rawFirst, row.rawLast].filter(Boolean).join(" ") || row.rawCompany || "Rohdaten-Kontakt", status: row.rawStatus } : null, reviewer: row.reviewer, criteria: criteria.map((criterion) => ({ ...criterion, score: scores.find((item) => item.key === criterion.key)?.score ?? null, evidence: scores.find((item) => item.key === criterion.key)?.evidence ?? "" })), redFlags: Array.isArray(row.call.redFlags) ? (row.call.redFlags as string[]) : [] };
}

export async function callStatistics(db: Db, tenantId: number) {
  const rows = await db.select({ status: callRecords.status, decision: callRecords.decision, score: callRecords.score }).from(callRecords).where(eq(callRecords.tenantId, tenantId));
  const scored = rows.filter((row) => typeof row.score === "number");
  return { total: rows.length, evaluated: rows.filter((row) => row.status === "bewertet").length, approved: rows.filter((row) => row.decision === "freigegeben").length, review: rows.filter((row) => row.decision === "pruefen").length, rejected: rows.filter((row) => row.decision === "zurueckgewiesen").length, noConsent: rows.filter((row) => row.status === "ohne_einwilligung").length, failed: rows.filter((row) => row.status === "fehlgeschlagen").length, averageScore: scored.length ? Math.round(scored.reduce((sum, row) => sum + (row.score ?? 0), 0) / scored.length) : null };
}

/** Aufbewahrung: Transkripte, Aufzeichnungs-Links und Rohdaten älter als retentionDays werden entfernt (Bewertung bleibt). */
export async function purgeExpiredCalls(db: Db) {
  const configs = await db.select().from(callQaConfigs);
  let purged = 0;
  for (const config of configs) {
    if (!config.retentionDays || config.retentionDays <= 0) continue;
    const cutoff = new Date(Date.now() - config.retentionDays * 24 * 3_600_000);
    const stale = await db.select({ id: callRecords.id }).from(callRecords).where(and(eq(callRecords.tenantId, config.tenantId), lt(callRecords.createdAt, cutoff), or(eq(callRecords.status, "bewertet"), eq(callRecords.status, "fehlgeschlagen"), eq(callRecords.status, "ohne_einwilligung"))));
    for (const row of stale) { const current = (await db.select({ transcript: callRecords.transcript, recordingUrl: callRecords.recordingUrl }).from(callRecords).where(eq(callRecords.id, row.id)).limit(1))[0]; if (!current?.transcript && !current?.recordingUrl) continue; await db.update(callRecords).set({ transcript: null, recordingUrl: null, payload: null }).where(eq(callRecords.id, row.id)); purged += 1; }
  }
  return { purged };
}
