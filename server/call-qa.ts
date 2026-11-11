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
import { and, asc, desc, eq, gte, inArray, like, lt, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { callQaConfigs, callRecords, leadCategories, leadStatusEvents, leads, optIns, rawContacts, users, type CallQaConfig, type CallRecord } from "../drizzle/schema";
import { convertRawContact, normalizeRawPhone } from "./raw-data";
import { invokeLLM } from "./_core/llm";
import { noteAfterEvaluation } from "./call-notes";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./integration-secrets";
import { triggerLeadAutomations, type Db } from "./lead-pipeline";
import { readPath } from "./outbound-templates";

export type Criterion = { key: string; label: string; weight: number; description: string };
import { callQaCampaigns } from "../drizzle/schema";
import { CALL_QA_PRESETS, presetByKey } from "../shared/call-qa-presets";
import { callPeriodRange, type CallPeriod } from "../shared/call-period";
import { detectTopic } from "../shared/call-topic";
export { callPeriodRange, detectTopic, type CallPeriod };
import { answerQuestionsHeuristically, decideByQuestions, DEFAULT_QUALIFICATION_QUESTIONS, normalizeQuestions, summarizeAnswers, type QualificationAnswer, type QualificationQuestion } from "../shared/call-qualification";

/** Kampagnen mit eigenen Qualifizierungsfragen. Fehlt eine Kampagne, gilt der Standardfragensatz. */
export async function listCampaigns(db: Db, tenantId: number) {
  const rows = await db.select().from(callQaCampaigns).where(eq(callQaCampaigns.tenantId, tenantId)).orderBy(asc(callQaCampaigns.name));
  const fromCalls = await db.select({ campaign: callRecords.campaign }).from(callRecords).where(eq(callRecords.tenantId, tenantId));
  const names = new Set(rows.map((row) => row.name)); const extra = Array.from(new Set(fromCalls.map((row) => row.campaign).filter((name): name is string => Boolean(name) && !names.has(name!))));
  const defaults = await defaultQuestionsFor(db, tenantId);
  const campaignCriteria = (row: { criteria: unknown }) => (Array.isArray(row.criteria) && row.criteria.length ? row.criteria as Criterion[] : null);
  return [...rows.map((row) => ({ id: row.id, name: row.name, questions: normalizeQuestions(row.questions as QualificationQuestion[] | null), criteria: campaignCriteria(row), instructions: row.instructions ?? null, custom: true })), ...extra.map((name) => ({ id: null as number | null, name, questions: defaults, criteria: null as Criterion[] | null, instructions: null as string | null, custom: false }))];
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
/** Standardfragen des Mandanten (aus einer Vorlage übernommen) – sonst die eingebauten Standardfragen. */
export async function defaultQuestionsFor(db: Db, tenantId: number): Promise<QualificationQuestion[]> {
  const row = (await db.select({ defaultQuestions: callQaConfigs.defaultQuestions }).from(callQaConfigs).where(eq(callQaConfigs.tenantId, tenantId)).limit(1))[0];
  const questions = normalizeQuestions((row?.defaultQuestions as QualificationQuestion[] | null) ?? null); return questions.length ? questions : DEFAULT_QUALIFICATION_QUESTIONS;
}
export async function questionsForCampaign(db: Db, tenantId: number, campaign: string | null | undefined): Promise<QualificationQuestion[]> {
  if (!campaign) return defaultQuestionsFor(db, tenantId);
  const row = (await db.select().from(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, tenantId), eq(callQaCampaigns.name, campaign))).limit(1))[0];
  const questions = row ? normalizeQuestions(row.questions as QualificationQuestion[] | null) : []; return questions.length ? questions : defaultQuestionsFor(db, tenantId);
}
/** Bewertungskriterien einer Kampagne: eigene, wenn gesetzt – sonst die Standard-Kriterien aus den Einstellungen (zusammen mit der Standard-Anweisung). */
export async function criteriaForCampaign(db: Db, tenantId: number, campaign: string | null | undefined, config?: Pick<CallQaConfig, "criteria" | "instructions">): Promise<{ criteria: Criterion[]; instructions: string | null; custom: boolean }> {
  const base = config ?? (await ensureCallQaConfig(db, tenantId));
  const standard = { criteria: (Array.isArray(base.criteria) && base.criteria.length ? base.criteria : DEFAULT_CRITERIA) as Criterion[], instructions: base.instructions ?? null, custom: false };
  if (!campaign) return standard;
  const row = (await db.select({ criteria: callQaCampaigns.criteria, instructions: callQaCampaigns.instructions }).from(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, tenantId), eq(callQaCampaigns.name, campaign))).limit(1))[0];
  const own = Array.isArray(row?.criteria) && row.criteria.length ? (row.criteria as Criterion[]) : null;
  if (!own) return standard;
  return { criteria: own, instructions: [standard.instructions, row?.instructions].filter((text): text is string => Boolean(text && text.trim())).join("\n") || null, custom: true };
}
/** Eigene Kriterien (und Zusatz-Anweisung) für eine Kampagne speichern; leere Liste = wieder die Standard-Kriterien. */
export async function saveCampaignCriteria(db: Db, tenantId: number, input: { name: string; criteria: Array<Partial<Criterion>>; instructions?: string | null }) {
  const name = input.name.trim(); if (!name) throw new Error("Bitte eine Kampagne wählen.");
  const used = new Set<string>();
  const criteria: Criterion[] = input.criteria.map((item, index) => { const label = String(item.label ?? "").trim(); let key = String(item.key ?? "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || label.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || `kriterium_${index + 1}`; while (used.has(key)) key += "_2"; used.add(key); return { key, label, description: String(item.description ?? "").trim(), weight: Math.max(0, Math.min(100, Math.round(Number(item.weight ?? 0)))) }; }).filter((item) => item.label);
  if (criteria.length && criteria.reduce((sum, item) => sum + item.weight, 0) <= 0) throw new Error("Mindestens ein Kriterium braucht ein Gewicht größer als 0.");
  const instructions = (input.instructions ?? "").trim().slice(0, 4000) || null;
  const own = (await db.select({ id: callQaCampaigns.id }).from(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, tenantId), eq(callQaCampaigns.name, name))).limit(1))[0];
  const values = { criteria: criteria.length ? criteria : null, instructions };
  if (own) await db.update(callQaCampaigns).set(values).where(eq(callQaCampaigns.id, own.id)); else await db.insert(callQaCampaigns).values({ tenantId, name, questions: await defaultQuestionsFor(db, tenantId), ...values });
  return { success: true as const, criteria: criteria.length, custom: criteria.length > 0 };
}
/** Vorlage anwenden: Kriterien + Anweisung in die Einstellungen, Prüffragen als Standard – und auf Wunsch in alle vorhandenen Kampagnen-Fragensätze. */
export async function applyCallQaPreset(db: Db, tenantId: number, input: { preset: string; allCampaigns: boolean }) {
  const preset = presetByKey(input.preset); if (!preset) throw new Error("Diese Vorlage gibt es nicht.");
  await ensureCallQaConfig(db, tenantId);
  await db.update(callQaConfigs).set({ criteria: preset.criteria, instructions: preset.instructions, defaultQuestions: preset.questions }).where(eq(callQaConfigs.tenantId, tenantId));
  let campaigns = 0;
  if (input.allCampaigns) { const result = await db.update(callQaCampaigns).set({ questions: preset.questions }).where(eq(callQaCampaigns.tenantId, tenantId)); campaigns = Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0); }
  return { success: true as const, preset: preset.key, campaigns };
}
/** Antworten je Frage: KI (wenn verfügbar) – sonst Stichwort-Regeln. */
export async function answerQualification(questions: QualificationQuestion[], transcript: string): Promise<Record<string, QualificationAnswer>> {
  const heuristic = answerQuestionsHeuristically(questions, transcript);
  if (!process.env.ANTHROPIC_API_KEY) return heuristic;
  try {
    const schema = { name: "qualifizierung", schema: { type: "object", additionalProperties: false, required: ["answers"], properties: { answers: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "answer", "note"], properties: { key: { type: "string" }, answer: { type: "string", enum: ["ja", "nein", "unklar"] }, note: { type: "string" } } } } } } };
    const response = await invokeLLM({ model: "fast", maxTokens: 900, messages: [{ role: "system", content: `Beantworte die folgenden Fragen zu einem Verkaufsgespräch ausschließlich anhand des Transkripts mit ja, nein oder unklar und einem kurzen Beleg (note). Erfinde nichts.\n${questions.map((question) => `- ${question.key}: ${question.label}${question.hint ? ` (Hinweis: ${question.hint})` : ""}`).join("\n")}` }, { role: "user", content: `Transkript:\n"""\n${transcript.slice(0, 40_000)}\n"""` }], outputSchema: schema });
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
  const own = await criteriaForCampaign(db, tenantId, campaign);
  const ownRow = campaign ? (await db.select({ instructions: callQaCampaigns.instructions }).from(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, tenantId), eq(callQaCampaigns.name, campaign))).limit(1))[0] : undefined;
  return { questions, calls: rows.length, summary: summarizeAnswers(rows.map((row) => row.answers as Record<string, QualificationAnswer> | null), questions), criteria: own.criteria, criteriaCustom: own.custom, instructions: ownRow?.instructions ?? null };
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

/** Welcher Transkriptionsdienst würde greifen? (für die Prüf-Antwort an den Dialer-Entwickler) */
const transcriptionService = (config: CallQaConfig) => config.transcriptionProvider === "auto" ? (process.env.OPENAI_API_KEY ? "openai" : process.env.DEEPGRAM_API_KEY ? "deepgram" : "nur Transkript im Webhook") : config.transcriptionProvider;
/**
 * GET auf die Webhook-Adresse: Prüf-Antwort für den Dialer-Entwickler – ist die Adresse richtig, ist die Bewertung an, welche Felder werden erwartet,
 * wird eine Einwilligung verlangt, gibt es einen Transkriptionsdienst. Speichert nichts.
 */
export async function describeDialerWebhook(db: Db, token: string) {
  const config = (await db.select().from(callQaConfigs).where(eq(callQaConfigs.webhookToken, token)).limit(1))[0];
  if (!config) return { status: 404, body: { ok: false, error: "unknown webhook token" } };
  const mapping = { ...DEFAULT_MAPPING, ...((config.fieldMapping ?? {}) as Record<string, string>) };
  return { status: 200, body: { ok: true, service: "Gesprächsbewertung", method: "POST", content_type: "application/json", enabled: config.enabled, consent_required: config.consentRequired, transcription: transcriptionService(config), recording_auth_header: Boolean(config.recordingAuthHeader), expected_fields: mapping, required: [mapping.callId, mapping.phone, mapping.recordingUrl], test_mode: "POST mit \"test\": true prüft die Felder und den Aufnahme-Link, ohne etwas zu speichern" } };
}
/** Rohdaten-Kontakt zur Rufnummer (noch nicht Lead) – damit eine Freigabe ihn zum Lead macht und eine Ablehnung ihn verwirft. */
async function rawContactByPhone(db: Db, tenantId: number, phone: string) {
  const normalized = normalizeRawPhone(phone); if (!normalized) return undefined; // Rohdaten speichern Nummern als +49…
  const national = `0${normalized.replace(/^\+49/, "")}`;
  const variants = Array.from(new Set([phone, normalized, normalized.replace(/^\+/, "00"), national]));
  const rows = await db.select({ id: rawContacts.id, phone: rawContacts.phone, status: rawContacts.status, leadId: rawContacts.leadId }).from(rawContacts).where(and(eq(rawContacts.tenantId, tenantId), inArray(rawContacts.status, ["neu", "in_liste"]), or(...variants.map((value) => eq(rawContacts.phone, value))))).orderBy(desc(rawContacts.createdAt)).limit(5);
  return rows.find((row) => row.phone && normalizeRawPhone(row.phone) === normalized && !row.leadId) ?? rows.find((row) => !row.leadId);
}
export async function ingestDialerCall(db: Db, token: string, payload: Record<string, unknown>, options: { fetchImpl?: typeof fetch } = {}) {
  const config = (await db.select().from(callQaConfigs).where(eq(callQaConfigs.webhookToken, token)).limit(1))[0];
  if (!config) return { status: 404, body: { error: "unknown webhook token" } };
  const mapping = { ...DEFAULT_MAPPING, ...((config.fieldMapping ?? {}) as Record<string, string>) };
  const get = (key: keyof typeof DEFAULT_MAPPING) => readPath(payload, mapping[key]) ?? payload[key];
  // Testmodus: "test": true → Felder und Aufnahme-Link prüfen, nichts speichern (für den Dialer-Entwickler beim Einrichten)
  if (truthy(payload.test) || truthy(payload.dry_run)) {
    const found: string[] = []; const missing: string[] = [];
    for (const key of Object.keys(DEFAULT_MAPPING) as Array<keyof typeof DEFAULT_MAPPING>) { if (text(get(key)) || typeof get(key) === "boolean") found.push(mapping[key]); else missing.push(mapping[key]); }
    const required = (["callId", "phone", "recordingUrl"] as const).filter((key) => !text(get(key))).map((key) => mapping[key]);
    const recordingUrl = text(get("recordingUrl")); let recording: Record<string, unknown> = { checked: false };
    if (recordingUrl) {
      const headers: Record<string, string> = {}; if (config.recordingAuthHeader) { const raw = decryptIntegrationSecret(config.recordingAuthHeader); const [name, ...rest] = raw.split(":"); if (rest.length) headers[name.trim().toLowerCase()] = rest.join(":").trim(); else headers.authorization = raw; }
      try { const response = await (options.fetchImpl ?? fetch)(recordingUrl, { method: "GET", headers: { ...headers, range: "bytes=0-1023" } }); recording = { checked: true, reachable: response.ok, http_status: response.status, content_type: response.headers.get("content-type") }; }
      catch (error) { recording = { checked: true, reachable: false, error: error instanceof Error ? error.message : String(error) }; }
    }
    const consent = truthy(get("consent")) || !config.consentRequired;
    return { status: 200, body: { ok: required.length === 0 && (recording.reachable !== false), test: true, stored: false, enabled: config.enabled, fields_found: found, fields_missing: missing, required_missing: required, recording, would_evaluate: config.enabled && consent && required.length === 0 && recording.reachable !== false, reason: !config.enabled ? "Gesprächsbewertung ist in der App ausgeschaltet" : required.length ? `Pflichtfelder fehlen: ${required.join(", ")}` : recording.reachable === false ? "Aufnahme-Link nicht abrufbar" : !consent ? `Einwilligung erforderlich – Feld „${mapping.consent}“ muss true sein` : "alles in Ordnung", transcription: transcriptionService(config) } };
  }
  if (!config.enabled) return { status: 403, body: { error: "call evaluation disabled" } };
  const externalCallId = text(get("callId")) || null;
  if (externalCallId) { const existing = (await db.select({ id: callRecords.id, status: callRecords.status }).from(callRecords).where(and(eq(callRecords.tenantId, config.tenantId), eq(callRecords.externalCallId, externalCallId))).limit(1))[0]; if (existing) return { status: 200, body: { ok: true, call_id: existing.id, duplicate: true, status: existing.status } }; }
  const phone = text(get("phone")); const leadRef = text(get("leadId"));
  let lead = leadRef ? (await db.select().from(leads).where(and(eq(leads.tenantId, config.tenantId), eq(leads.kind, "verkauf"), or(eq(leads.publicId, leadRef), ...(Number.isInteger(Number(leadRef)) && Number(leadRef) > 0 ? [eq(leads.id, Number(leadRef))] : [])))).limit(1))[0] : undefined;
  if (!lead && phone) { const digits = normalizePhone(phone); const candidates = await db.select().from(leads).where(and(eq(leads.tenantId, config.tenantId), eq(leads.kind, "verkauf"), or(eq(leads.phone, phone), eq(leads.phone, `+${digits}`), eq(leads.phone, `0${digits.replace(/^49/, "")}`)))).orderBy(desc(leads.createdAt)).limit(5); lead = candidates.find((row) => row.phone && normalizePhone(row.phone) === digits) ?? candidates[0]; }
  // Kein Lead zur Nummer, aber ein Rohdaten-Kontakt (hochgeladene Callcenter-Liste): merken – „freigegeben“ macht ihn zum Lead, „zurückgewiesen“ verwirft ihn
  const rawContact = !lead && phone ? await rawContactByPhone(db, config.tenantId, phone) : undefined;
  const consent = truthy(get("consent")) || !config.consentRequired;
  const startedAtRaw = text(get("startedAt")); const startedAt = startedAtRaw && !Number.isNaN(new Date(startedAtRaw).getTime()) ? new Date(startedAtRaw) : new Date();
  const inserted = await db.insert(callRecords).values({ tenantId: config.tenantId, provider: config.provider, externalCallId, leadId: lead?.id ?? null, rawContactId: rawContact?.id ?? null, phone: phone || lead?.phone || null, agentName: text(get("agent")) || null, campaign: text(get("campaign")) || null, direction: /in|eingehend/i.test(text(get("direction"))) ? "eingehend" : "ausgehend", startedAt, durationSeconds: Number(get("duration")) || null, recordingUrl: text(get("recordingUrl")) || null, consent, consentSource: truthy(get("consent")) ? `Dialer-Feld ${mapping.consent}` : config.consentRequired ? null : "Einstellung: keine Einwilligung erforderlich", transcript: text(get("transcript")) || null, status: consent ? "eingegangen" : "ohne_einwilligung", payload: payload as never });
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
  if (call.recordingUrl.startsWith("file:")) { // hochgeladene Datei (Aufnahmen per Datei testen)
    const local = await readLocalRecording(call.recordingUrl); return transcribeAudio(config, local.audio, local.contentType, fetchImpl, provider);
  }
  const headers: Record<string, string> = {};
  if (config.recordingAuthHeader) { const raw = decryptIntegrationSecret(config.recordingAuthHeader); const [name, ...rest] = raw.split(":"); if (rest.length) headers[name.trim().toLowerCase()] = rest.join(":").trim(); else headers.authorization = raw; }
  let audioResponse: Response;
  try { audioResponse = await fetchImpl(call.recordingUrl, { headers }); }
  catch (error) { throw Object.assign(new Error(`Aufzeichnung konnte nicht geladen werden (${error instanceof Error ? error.message : String(error)}).`), { retryable: true }); }
  if (!audioResponse.ok) throw Object.assign(new Error(`Aufzeichnung konnte nicht geladen werden (HTTP ${audioResponse.status}).`), { retryable: audioResponse.status !== 401 && audioResponse.status !== 403 }); // 404/425/5xx: Datei meist noch nicht fertig – später noch einmal
  let contentType = (audioResponse.headers.get("content-type") ?? "audio/mpeg").split(";")[0].trim() || "audio/mpeg";
  let audio: Uint8Array<ArrayBuffer>;
  if (/^text\/html|^application\/xhtml/i.test(contentType)) {
    // Der Link öffnet eine Player-Seite: darin den eigentlichen Datei-Link suchen (<audio src>, <source src>, Download-Link, .mp3/.wav im Quelltext)
    const html = await audioResponse.text(); const mediaUrl = findMediaUrl(html, call.recordingUrl);
    if (!mediaUrl) throw new Error("Der Aufnahme-Link liefert eine Webseite (Player) und darin ist kein Datei-Link zu finden. Bitte die Aufnahme als Datei herunterladen und hochladen – oder den direkten mp3/wav-Link verwenden.");
    let mediaResponse: Response;
    try { mediaResponse = await fetchImpl(mediaUrl, { headers: { ...headers, referer: call.recordingUrl } }); } catch (error) { throw Object.assign(new Error(`Aufnahme-Datei hinter der Player-Seite konnte nicht geladen werden (${error instanceof Error ? error.message : String(error)}).`), { retryable: true }); }
    if (!mediaResponse.ok) throw new Error(`Aufnahme-Datei hinter der Player-Seite konnte nicht geladen werden (HTTP ${mediaResponse.status}, ${mediaUrl.slice(0, 120)}).`);
    contentType = (mediaResponse.headers.get("content-type") ?? "audio/mpeg").split(";")[0].trim() || "audio/mpeg";
    if (/^text\/html|^application\/(xhtml|json)/i.test(contentType)) throw new Error("Hinter der Player-Seite kam wieder eine Webseite statt einer Audiodatei. Bitte die Aufnahme als Datei herunterladen und hochladen.");
    audio = new Uint8Array(await mediaResponse.arrayBuffer());
  } else if (/^application\/json/i.test(contentType)) throw new Error("Der Aufnahme-Link liefert keine Audiodatei (JSON). Bitte den direkten Datei-Link verwenden oder die Datei hochladen.");
  else audio = new Uint8Array(await audioResponse.arrayBuffer());
  return transcribeAudio(config, audio, contentType, fetchImpl, provider);
}

/** Datei-Link aus einer Player-Seite herauslesen. */
export function findMediaUrl(html: string, pageUrl: string): string | null {
  const candidates: string[] = [];
  const push = (raw: string | undefined) => { if (!raw) return; const value = raw.replace(/&amp;/g, "&").trim(); if (!value || value.startsWith("data:") || value.startsWith("javascript:")) return; try { candidates.push(new URL(value, pageUrl).toString()); } catch { /* ignorieren */ } };
  for (const match of Array.from(html.matchAll(/<(?:audio|source|video)[^>]+src=["']([^"']+)["']/gi))) push(match[1]);
  for (const match of Array.from(html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>(?:[^<]*(?:download|herunterladen|indir|mp3|wav)[^<]*)<\/a>/gi))) push(match[1]);
  for (const match of Array.from(html.matchAll(/<a[^>]+download[^>]*href=["']([^"']+)["']/gi))) push(match[1]);
  for (const match of Array.from(html.matchAll(/["'(]([^"'()\s]+\.(?:mp3|wav|m4a|ogg|mp4|webm)(?:\?[^"'()\s]*)?)["')]/gi))) push(match[1]);
  for (const match of Array.from(html.matchAll(/["']([^"']*(?:download|getfile|getsound|stream)[^"']*)["']/gi))) { const value = match[1]; if (/^https?:|^\//.test(value) && value !== pageUrl) push(value); }
  const unique = Array.from(new Set(candidates)).filter((url) => url !== pageUrl);
  return unique[0] ?? null;
}

async function readLocalRecording(ref: string): Promise<{ audio: Uint8Array<ArrayBuffer>; contentType: string }> {
  const name = ref.slice("file:".length).replace(/[^a-zA-Z0-9._-]/g, ""); const file = path.resolve(recordingsDir(), name);
  const audio = new Uint8Array(await fs.readFile(file)) as Uint8Array<ArrayBuffer>; const ext = path.extname(name).toLowerCase().replace(".", "");
  return { audio, contentType: ({ mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", webm: "audio/webm", mp4: "audio/mp4" } as Record<string, string>)[ext] ?? "audio/mpeg" };
}
/** Ablage hochgeladener Aufnahmen – NICHT unter uploads/ (das ist öffentlich), sondern daneben; Abruf nur angemeldet über /api/aufnahmen/:id. */
export const recordingsDir = () => path.resolve(process.env.RECORDINGS_DIR ?? path.resolve(process.env.UPLOAD_DIR ?? "uploads", "..", "aufnahmen"));
const AUDIO_EXT: Record<string, string> = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/ogg": "ogg", "audio/webm": "webm", "video/mp4": "mp4" };
/** Hochgeladene Aufnahme ablegen und als Gespräch anlegen; Verarbeitung im Hintergrund. */
export async function importRecordingFile(db: Db, tenantId: number, input: { fileName: string; mimeType: string; base64: string; agentName?: string | null; campaign?: string | null; phone?: string | null; note?: string | null }, options: { fetchImpl?: typeof fetch; waitFor?: boolean } = {}) {
  const byName = ({ mp3: "mp3", wav: "wav", m4a: "m4a", ogg: "ogg", webm: "webm", mp4: "mp4" } as Record<string, string>)[input.fileName.toLowerCase().split(".").pop() ?? ""];
  const ext = AUDIO_EXT[input.mimeType.toLowerCase()] ?? byName; if (!ext) throw new Error("Bitte eine Audiodatei hochladen (mp3, wav, m4a, ogg oder webm).");
  const buffer = Buffer.from(input.base64.replace(/^data:[^;]+;base64,/, ""), "base64"); if (!buffer.length) throw new Error("Die Datei ist leer."); if (buffer.length > 24 * 1024 * 1024) throw new Error("Die Datei ist größer als 24 MB – bitte kürzen oder als mp3 speichern.");
  const digest = createHash("sha1").update(buffer).digest("hex"); const externalCallId = `DATEI-${digest.slice(0, 16)}`;
  const existing = (await db.select({ id: callRecords.id, status: callRecords.status }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.externalCallId, externalCallId))).limit(1))[0];
  if (existing && existing.status !== "fehlgeschlagen") return { callId: existing.id, duplicate: true as const };
  const dir = recordingsDir(); await fs.mkdir(dir, { recursive: true }); const name = `${tenantId}-${digest.slice(0, 20)}.${ext}`; await fs.writeFile(path.join(dir, name), buffer);
  const phone = input.phone?.trim() || null;
  const lead = phone ? (await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "verkauf"), eq(leads.phone, phone))).limit(1))[0] : undefined;
  let callId = existing?.id ?? 0;
  if (existing) await db.update(callRecords).set({ status: "eingegangen", error: null, recordingUrl: `file:${name}` }).where(eq(callRecords.id, existing.id));
  else { const inserted = await db.insert(callRecords).values({ tenantId, provider: "datei", externalCallId, leadId: lead?.id ?? null, phone, agentName: input.agentName?.trim() || null, campaign: input.campaign?.trim() || "Aufnahmen-Test", direction: "ausgehend", startedAt: new Date(), durationSeconds: null, recordingUrl: `file:${name}`, consent: true, consentSource: "Datei hochgeladen", status: "eingegangen", payload: { file: input.fileName.slice(0, 200), size: buffer.length, note: input.note ?? null } }); callId = Number(inserted[0]?.insertId) || 0; }
  const run = processCall(db, callId, options).catch((error) => console.warn("[call-qa] Datei-Import", callId, error instanceof Error ? error.message : error));
  if (options.waitFor) await run;
  return { callId, duplicate: false as const };
}
/** Hochgeladene Aufnahme zum Abspielen – nur für Gespräche des eigenen Mandanten. */
export async function localRecordingFile(db: Db, tenantId: number, callId: number): Promise<{ file: string; contentType: string } | null> {
  const row = (await db.select({ recordingUrl: callRecords.recordingUrl }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.id, callId))).limit(1))[0];
  if (!row?.recordingUrl?.startsWith("file:")) return null;
  const name = row.recordingUrl.slice("file:".length).replace(/[^a-zA-Z0-9._-]/g, ""); const ext = path.extname(name).toLowerCase().replace(".", "");
  return { file: path.resolve(recordingsDir(), name), contentType: ({ mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", webm: "audio/webm", mp4: "video/mp4" } as Record<string, string>)[ext] ?? "application/octet-stream" };
}

/** Gesprächsdauer aus der letzten Transkription (Whisper „duration“ bzw. Deepgram-Metadaten) – processCall trägt sie ein, wenn der Dialer keine geliefert hat. */
let lastTranscriptionDuration: number | null = null;
async function transcribeAudio(config: CallQaConfig, audio: Uint8Array<ArrayBuffer>, contentType: string, fetchImpl: typeof fetch, provider: string): Promise<string> {
  lastTranscriptionDuration = null;
  if (provider === "openai") {
    const form = new FormData(); form.append("file", new Blob([audio], { type: contentType }), "aufzeichnung.mp3"); form.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1"); form.append("language", config.transcriptionLanguage || "de"); form.append("response_format", "verbose_json");
    const response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
    const body = await response.text(); if (!response.ok) throw new Error(`Transkription (OpenAI) fehlgeschlagen: HTTP ${response.status} ${body.slice(0, 200)}`);
    try { const parsed = JSON.parse(body) as { text?: string; duration?: number; segments?: Array<{ end?: number }> }; if (typeof parsed.duration === "number" && parsed.duration > 0) lastTranscriptionDuration = Math.round(parsed.duration); else if (parsed.segments?.length) lastTranscriptionDuration = Math.round(Number(parsed.segments[parsed.segments.length - 1]?.end ?? 0)) || null; if (typeof parsed.text === "string") return parsed.text.trim(); } catch { /* kein JSON (z. B. Test-Stub mit reinem Text) */ }
    return body.trim();
  }
  const response = await fetchImpl(`https://api.deepgram.com/v1/listen?model=nova-2&language=${encodeURIComponent(config.transcriptionLanguage || "de")}&smart_format=true&diarize=true&utterances=true`, { method: "POST", headers: { authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "content-type": contentType }, body: audio });
  const body = await response.text(); if (!response.ok) throw new Error(`Transkription (Deepgram) fehlgeschlagen: HTTP ${response.status} ${body.slice(0, 200)}`);
  try { const parsed = JSON.parse(body) as { metadata?: { duration?: number }; results?: { utterances?: Array<{ speaker: number; transcript: string }>; channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } }; if (typeof parsed.metadata?.duration === "number" && parsed.metadata.duration > 0) lastTranscriptionDuration = Math.round(parsed.metadata.duration); const utterances = parsed.results?.utterances; if (utterances?.length) return utterances.map((item) => `Sprecher ${item.speaker + 1}: ${item.transcript}`).join("\n"); return parsed.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ""; } catch { return body; }
}

/* ------------------------------------------------------------------ Bewertung */

export type Evaluation = { agentName?: string | null; topic?: string | null; score: number; verdict: "verkaufbar" | "nachfassen" | "nicht_verkaufbar" | "unklar"; criteria: Array<{ key: string; score: number; evidence: string }>; summary: string; redFlags: string[]; nextStep: string; extracted: Record<string, string> };

/** Name des Mitarbeiters aus der Vorstellung am Gesprächsanfang: „hier ist/spricht Maya Becker“, „mein Name ist …“, „ich bin … von HausKompass“, „Maya Becker von …“. */
export function detectAgentName(transcript: string): string | null {
  const head = transcript.slice(0, 1500).replace(/\s+/g, " ");
  const name = "([A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?(?: [A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?){1,2})";
  const patterns = [new RegExp(`(?:hier ist|hier spricht|am apparat ist|mein name ist|ich bin|ich heiße|sie sprechen mit)\\s+(?:der |die |frau |herr )?${name}`, "i"), new RegExp(`${name}\\s+(?:von|vom|aus dem hause|im auftrag von)\\s+[A-ZÄÖÜ]`)];
  for (const pattern of patterns) { const match = head.match(pattern); if (match) { const cleaned = cleanAgentName(match[1]); if (cleaned) return cleaned; } }
  return null;
}
const NOT_NAMES = /^(guten|hallo|schönen|ja|nein|vielen|danke|herr|frau|agent|kunde|sprecher|photovoltaik|angebotsvergleich|hauskompass|firma)$/i;
export function cleanAgentName(raw: string): string | null {
  const all = raw.replace(/[^A-Za-zÄÖÜäöüß\- ]/g, " ").trim().split(/\s+/).filter(Boolean);
  const words: string[] = []; for (const word of all) { if (!/^[A-ZÄÖÜ]/.test(word) || NOT_NAMES.test(word)) { if (words.length) break; continue; } words.push(word); } // nur großgeschriebene Wörter am Stück („Maya Becker“, nicht „von“)
  if (words.length < 1 || words.length > 3) return null; const value = words.join(" "); return value.length >= 3 && value.length <= 60 ? value : null;
}
/** Thema → Lead-Kategorie des Mandanten: vorhandene Kategorie mit passendem Namen, sonst neu anlegen (z. B. KI erkennt „Treppenlift“). */
export async function resolveCallCategory(db: Db, tenantId: number, topic: string | null | undefined): Promise<number | null> {
  const wanted = (topic ?? "").trim(); if (!wanted) return null;
  const norm = (value: string) => value.toLowerCase().replace(/[^a-zäöüß&]+/g, " ").replace(/\s+/g, " ").trim();
  const rows = await db.select({ id: leadCategories.id, name: leadCategories.name, status: leadCategories.status }).from(leadCategories).where(and(eq(leadCategories.tenantId, tenantId), eq(leadCategories.isTemplate, false)));
  const target = norm(wanted); const parts = target.split(" & ").map((part) => part.trim()).filter(Boolean);
  const exact = rows.find((row) => norm(row.name) === target); if (exact) return exact.id;
  // Gleiche Bestandteile in anderer Reihenfolge/Schreibweise („Photovoltaik & Wärmepumpe“ ~ „Wärmepumpe & Photovoltaik“, „PV & WP“ bleibt außen vor)
  const sameParts = rows.find((row) => { const own = norm(row.name).split(" & ").map((part) => part.trim()).filter(Boolean); return own.length === parts.length && parts.every((part) => own.some((candidate) => candidate === part || candidate.startsWith(part) || part.startsWith(candidate))); });
  if (sameParts) return sameParts.id;
  if (parts.length === 1) { const contains = rows.find((row) => norm(row.name).split(" & ").some((part) => part === parts[0])); if (contains && norm(contains.name).split(" & ").length === 1) return contains.id; }
  const { createCategoryForSparte } = await import("./vertrieb-category");
  const created = await createCategoryForSparte(db, tenantId, wanted, { detail: "Automatisch aus einem Gespräch: Die KI hat erkannt, worum es ging, und eine passende Lead-Kategorie angelegt – Name, Kürzel und Emoji kannst du unter Lead-Kategorien anpassen." });
  return created.id;
}
export async function evaluateTranscript(config: Pick<CallQaConfig, "criteria" | "instructions"> & Partial<Pick<CallQaConfig, "examples" | "extractFields">>, transcript: string, context: { leadCategory?: string | null; leadName?: string | null }): Promise<Evaluation> {
  const criteria = (Array.isArray(config.criteria) && config.criteria.length ? config.criteria : DEFAULT_CRITERIA) as Criterion[];
  const examples = (Array.isArray(config.examples) ? config.examples : []) as ExampleCase[];
  const extractFields = (Array.isArray(config.extractFields) ? config.extractFields : []) as ExtractField[];
  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0) || 1;
  const schema = { name: "gespraechsbewertung", schema: { type: "object", additionalProperties: false, required: ["criteria", "summary", "redFlags", "nextStep", "verdict", "extracted", "agentName", "topic"], properties: { agentName: { type: "string", description: "Name, mit dem sich der Mitarbeiter/Agent am Anfang vorstellt (z. B. „Maya Becker“); leer, wenn er nicht genannt wird" }, topic: { type: "string", description: "Worum geht es im Gespräch – das Produkt/Thema als kurzer Begriff in der Einzahl, z. B. „Photovoltaik“, „Wärmepumpe“, „Alarmanlage“, „Treppenlift“; geht es um zwei Themen, beide mit „ & “ verbinden (z. B. „Photovoltaik & Wärmepumpe“); leer, wenn unklar" }, criteria: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "score", "evidence"], properties: { key: { type: "string" }, score: { type: "integer", minimum: 0, maximum: 10 }, evidence: { type: "string" } } } }, summary: { type: "string" }, redFlags: { type: "array", items: { type: "string" } }, nextStep: { type: "string" }, verdict: { type: "string", enum: ["verkaufbar", "nachfassen", "nicht_verkaufbar", "unklar"] }, extracted: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "value"], properties: { key: { type: "string" }, value: { type: "string" } } } } } } };
  const system = `Du bewertest Verkaufsgespräche eines Callcenters, das Anfragen (Leads) für Fachbetriebe qualifiziert. Bewerte NUR anhand des Transkripts, erfinde nichts. Bewertungskriterien (0 = gar nicht erfüllt, 10 = vollständig erfüllt), jeweils mit wörtlichem Beleg aus dem Gespräch:\n${criteria.map((criterion) => `- ${criterion.key}: ${criterion.label} – ${criterion.description}`).join("\n")}\nWarnsignale (redFlags), die den Lead unverkäuflich machen: Kunde will nicht kontaktiert werden, widerruft, Daten sind falsch, Gespräch war unzulässig (Werbeanruf ohne Einwilligung), Kunde ist Minderjähriger, Agent hat Druck ausgeübt oder Falsches versprochen.\nUrteil: verkaufbar = Kunde will ein Angebot und die Weitergabe ist erlaubt; nachfassen = Interesse, aber offene Punkte; nicht_verkaufbar = kein Interesse oder Warnsignal; unklar = Transkript unvollständig.${extractFields.length ? `\nZusätzlich beantworte diese Fragen aus dem Gespräch (extracted, leer lassen wenn nicht genannt):\n${extractFields.map((field) => `- ${field.key}: ${field.question}`).join("\n")}` : "\nextracted bleibt eine leere Liste."}\nAntworte ausschließlich auf Deutsch.${config.instructions ? `\nZusätzliche Vorgaben des Mandanten: ${config.instructions}` : ""}${examples.length ? `\nBeispiele für die gewünschte Einordnung:\n${examples.slice(0, 8).map((example, index) => `Beispiel ${index + 1} (${example.title}): Auszug: "${example.transcript.slice(0, 600)}" → Urteil: ${example.verdict}. Begründung: ${example.reason}`).join("\n")}` : ""}`;
  const user = `${context.leadCategory ? `Lead-Kategorie: ${context.leadCategory}\n` : ""}${context.leadName ? `Kunde laut Lead: ${context.leadName}\n` : ""}Transkript:\n"""\n${transcript.slice(0, 60_000)}\n"""`;
  const response = await invokeLLM({ messages: [{ role: "system", content: system }, { role: "user", content: user }], outputSchema: schema, maxTokens: 2500 });
  const parsed = JSON.parse(response.choices[0]?.message.content ?? "{}") as Partial<Omit<Evaluation, "extracted">> & { extracted?: Array<{ key: string; value: string }> | Record<string, string> };
  // Die KI liefert „criteria“ meist als Liste – manchmal aber als Objekt {key: {score, evidence}} oder {key: score}; beides annehmen
  const rawCriteria = parsed.criteria as unknown; const criteriaList: Array<{ key: string; score: number; evidence: string }> = Array.isArray(rawCriteria) ? rawCriteria as Array<{ key: string; score: number; evidence: string }> : rawCriteria && typeof rawCriteria === "object" ? Object.entries(rawCriteria as Record<string, unknown>).map(([key, value]) => (value && typeof value === "object" ? { key, score: Number((value as { score?: unknown }).score ?? 0), evidence: String((value as { evidence?: unknown }).evidence ?? "") } : { key, score: Number(value ?? 0), evidence: "" })) : [];
  const scored = criteria.map((criterion) => { const found = criteriaList.find((item) => item.key === criterion.key); return { key: criterion.key, score: Math.max(0, Math.min(10, Number(found?.score ?? 0))), evidence: String(found?.evidence ?? "").slice(0, 500) }; });
  const score = Math.round(criteria.reduce((sum, criterion) => sum + (scored.find((item) => item.key === criterion.key)?.score ?? 0) / 10 * criterion.weight, 0) / totalWeight * 100);
  const redFlags = Array.isArray(parsed.redFlags) ? parsed.redFlags.map(String).filter(Boolean).slice(0, 10) : [];
  const verdict = redFlags.length ? "nicht_verkaufbar" : (["verkaufbar", "nachfassen", "nicht_verkaufbar", "unklar"].includes(parsed.verdict ?? "") ? parsed.verdict! : score >= 70 ? "verkaufbar" : score >= 40 ? "nachfassen" : "nicht_verkaufbar");
  const extracted: Record<string, string> = {};
  const rawExtracted = parsed.extracted; if (Array.isArray(rawExtracted)) for (const item of rawExtracted) if (item?.key && extractFields.some((field) => field.key === item.key) && String(item.value ?? "").trim()) extracted[item.key] = String(item.value).slice(0, 500); else if (rawExtracted && typeof rawExtracted === "object") for (const [key, value] of Object.entries(rawExtracted)) if (extractFields.some((field) => field.key === key) && String(value ?? "").trim()) extracted[key] = String(value).slice(0, 500);
  const agentName = cleanAgentName(String((parsed as { agentName?: unknown }).agentName ?? ""));
  const topic = String((parsed as { topic?: unknown }).topic ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || null;
  return { score, verdict, criteria: scored, summary: String(parsed.summary ?? "").slice(0, 2000), redFlags, nextStep: String(parsed.nextStep ?? "").slice(0, 320), extracted, agentName, topic };
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

const RECORDING_RETRIES = 8;
const retrying = new Set<number>();
/**
 * Gespräche, deren Aufnahme beim Eingang noch nicht abrufbar war, später noch einmal holen: Versuch n wartet 2^n Minuten (2, 4, 8 … höchstens 60),
 * insgesamt bis zu 8 Versuche über etwa 4 Stunden. Läuft im Minutentakt aus dem Zeitplaner.
 */
export async function retryWaitingRecordings(db: Db, options: { fetchImpl?: typeof fetch; max?: number } = {}): Promise<{ retried: number; done: number }> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const rows = await db.select({ id: callRecords.id, error: callRecords.error, updatedAt: callRecords.updatedAt }).from(callRecords).where(and(eq(callRecords.status, "fehlgeschlagen"), gte(callRecords.createdAt, since), like(callRecords.error, "%Neuer Versuch folgt automatisch%"))).orderBy(asc(callRecords.updatedAt)).limit(options.max ?? 10);
  let retried = 0; let done = 0;
  for (const row of rows) {
    const attempt = Number(/Versuch (\d+)\//.exec(row.error ?? "")?.[1]) || 1; const waitMs = Math.min(60, 2 ** attempt) * 60_000;
    if (Date.now() - new Date(row.updatedAt).getTime() < waitMs || retrying.has(row.id)) continue;
    retrying.add(row.id);
    try { const result = await processCall(db, row.id, options); retried += 1; if (result.status === "bewertet") done += 1; } catch { /* bleibt fehlgeschlagen */ } finally { retrying.delete(row.id); }
  }
  return { retried, done };
}
export async function processCall(db: Db, callId: number, options: { fetchImpl?: typeof fetch } = {}) {
  const call = (await db.select().from(callRecords).where(eq(callRecords.id, callId)).limit(1))[0];
  if (!call) throw new Error("Gespräch wurde nicht gefunden.");
  const config = await ensureCallQaConfig(db, call.tenantId);
  try {
    const freshTranscript = call.status === "eingegangen" || !call.transcript;
    const transcript = freshTranscript ? await transcribe(config, call, options.fetchImpl ?? fetch) : call.transcript!;
    if (!transcript.trim()) throw new Error("Transkript ist leer.");
    // Dauer aus der Transkription und Name des Mitarbeiters aus der Vorstellung („hier ist Maya Becker …“) – nur, wenn der Dialer nichts geliefert hat
    const durationSeconds = call.durationSeconds ?? (freshTranscript ? lastTranscriptionDuration : null) ?? null;
    const agentName = call.agentName?.trim() || detectAgentName(transcript);
    await db.update(callRecords).set({ transcript, status: "transkribiert", error: null, ...(durationSeconds !== null && call.durationSeconds === null ? { durationSeconds } : {}), ...(agentName && !call.agentName ? { agentName } : {}) }).where(eq(callRecords.id, callId));
    const lead = call.leadId ? (await db.select().from(leads).where(eq(leads.id, call.leadId)).limit(1))[0] : undefined;
    const own = await criteriaForCampaign(db, call.tenantId, call.campaign, config); // Kriterien der Kampagne (sonst Standard)
    const evaluation = await evaluateTranscript({ ...config, criteria: own.criteria, instructions: own.instructions }, transcript, { leadName: lead ? `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() : null });
    if (!agentName && evaluation.agentName) await db.update(callRecords).set({ agentName: evaluation.agentName }).where(eq(callRecords.id, callId));
    // Lead-Kategorie: Thema laut KI (sonst Stichwörter) → vorhandene Kategorie oder neue
    if (!call.leadCategoryId) { const categoryId = await resolveCallCategory(db, call.tenantId, evaluation.topic || detectTopic(transcript)).catch(() => null); if (categoryId) await db.update(callRecords).set({ leadCategoryId: categoryId }).where(eq(callRecords.id, callId)); }
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
    // Aufnahme (noch) nicht abrufbar: Dialer melden das Gespräch oft, bevor die Datei fertig ist – bis zu 8 Versuche mit wachsendem Abstand (2 min … 60 min)
    const attempt = (Number(/Versuch (\d+)\//.exec(call.error ?? "")?.[1]) || 0) + 1;
    const retryable = Boolean((error as { retryable?: boolean }).retryable) && attempt <= RECORDING_RETRIES;
    await db.update(callRecords).set({ status: "fehlgeschlagen", error: retryable ? `${message} Neuer Versuch folgt automatisch (Versuch ${attempt}/${RECORDING_RETRIES}).` : message }).where(eq(callRecords.id, callId));
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
  // Freigabe = Opt-in-Nachweis: die Einwilligungsstelle aus der Abschrift herausgesucht (sofern es noch keine gültige für den Fachbetrieb gibt)
  if (decision === "freigegeben") { try { const { optInFromCallRecord } = await import("./opt-in"); await optInFromCallRecord(db, config.tenantId, callId, actorUserId); } catch (error) { console.error("[Opt-in] aus Gesprächsfreigabe nicht angelegt:", error instanceof Error ? error.message : error); } }
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

/** Prototyp: Aufnahme-Links von Hand einfügen (eine Zeile je Aufnahme, optional „Link | Rufnummer | Notiz“). Jede Aufnahme wird wie ein Dialer-Gespräch geholt, transkribiert und bewertet – im Hintergrund, die Liste füllt sich nach und nach. */
export async function importRecordingLinks(db: Db, tenantId: number, input: { text: string; agentName?: string | null; campaign?: string | null }, options: { fetchImpl?: typeof fetch; waitFor?: boolean } = {}) {
  const lines = input.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const created: number[] = []; const skipped: string[] = []; const duplicates: number[] = []; const retried: number[] = []; // retried: schon da, aber fehlgeschlagen → noch einmal holen
  for (const line of lines.slice(0, 50)) {
    const match = line.match(/https?:\/\/\S+/); if (!match) { skipped.push(line.slice(0, 80)); continue; }
    const url = match[0].replace(/[),.;]+$/, ""); const rest = line.replace(match[0], "").split("|").map((part) => part.trim()).filter(Boolean);
    const phone = rest.find((part) => /\+?\d[\d\s/()-]{5,}/.test(part)) ?? null; const note = rest.find((part) => part !== phone) ?? null;
    const externalCallId = `LINK-${createHash("sha1").update(url).digest("hex").slice(0, 16)}`;
    const existing = (await db.select({ id: callRecords.id, status: callRecords.status }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.externalCallId, externalCallId))).limit(1))[0];
    if (existing) { if (existing.status === "fehlgeschlagen" || existing.status === "eingegangen") { await db.update(callRecords).set({ status: "eingegangen", error: null }).where(eq(callRecords.id, existing.id)); retried.push(existing.id); } else duplicates.push(existing.id); continue; }
    const lead = phone ? (await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "verkauf"), eq(leads.phone, phone))).limit(1))[0] : undefined;
    const inserted = await db.insert(callRecords).values({ tenantId, provider: "link", externalCallId, leadId: lead?.id ?? null, phone, agentName: input.agentName?.trim() || null, campaign: input.campaign?.trim() || "Aufnahmen-Test", direction: "ausgehend", startedAt: new Date(), durationSeconds: null, recordingUrl: url, consent: true, consentSource: "manuell eingefügt", status: "eingegangen", payload: { link: true, note } });
    created.push(Number(inserted[0]?.insertId) || 0);
  }
  const run = (async () => { for (const callId of [...created, ...retried]) { try { await processCall(db, callId, options); } catch (error) { console.warn("[call-qa] Link-Import", callId, error instanceof Error ? error.message : error); } } })();
  if (options.waitFor) await run;
  return { created: created.length, retried: retried.length, duplicates: duplicates.length, skipped, callIds: [...created, ...retried] };
}

/** Kampagne umbenennen: alle Gespräche mit dem alten Namen und der Fragensatz bekommen den neuen Namen (gibt es den schon, werden die Gespräche dort einsortiert). */
export async function renameCallCampaign(db: Db, tenantId: number, input: { from: string; to: string }) {
  const from = input.from.trim(); const to = input.to.trim().slice(0, 160);
  if (!from || !to) throw new Error("Bitte alten und neuen Namen angeben."); if (from === to) return { calls: 0, merged: false };
  const existing = (await db.select({ id: callQaCampaigns.id }).from(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, tenantId), eq(callQaCampaigns.name, to))).limit(1))[0];
  const own = (await db.select({ id: callQaCampaigns.id }).from(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, tenantId), eq(callQaCampaigns.name, from))).limit(1))[0];
  if (own) { if (existing) await db.delete(callQaCampaigns).where(eq(callQaCampaigns.id, own.id)); else await db.update(callQaCampaigns).set({ name: to }).where(eq(callQaCampaigns.id, own.id)); }
  const result = await db.update(callRecords).set({ campaign: to }).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.campaign, from)));
  const calls = Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
  return { calls, merged: Boolean(existing) };
}

/** Vorlage aktualisieren: Mandanten, die eine Vorlage übernommen haben (Kriterienschlüssel passen), bekommen beim Start die aktuelle Fassung (Texte, Anweisung, Fragen) – Gewichte bleiben, wenn der Mandant sie geändert hat. */
export async function refreshPresetConfigs(db: Db): Promise<number> {
  const rows = await db.select({ id: callQaConfigs.id, tenantId: callQaConfigs.tenantId, criteria: callQaConfigs.criteria, instructions: callQaConfigs.instructions }).from(callQaConfigs);
  let changed = 0;
  for (const row of rows) {
    const current = (Array.isArray(row.criteria) ? row.criteria : []) as Criterion[]; const keys = new Set(current.map((c) => c.key));
    const preset = CALL_QA_PRESETS.find((candidate) => candidate.criteria.every((c) => keys.has(c.key)) && keys.size === candidate.criteria.length); if (!preset) continue;
    const merged = preset.criteria.map((c) => ({ ...c, weight: current.find((item) => item.key === c.key)?.weight ?? c.weight }));
    const same = JSON.stringify(merged) === JSON.stringify(current) && row.instructions === preset.instructions; if (same) continue;
    await db.update(callQaConfigs).set({ criteria: merged, instructions: preset.instructions, defaultQuestions: preset.questions }).where(eq(callQaConfigs.id, row.id));
    const presetKeys = new Set(preset.questions.map((question) => question.key));
    for (const campaign of await db.select({ id: callQaCampaigns.id, questions: callQaCampaigns.questions }).from(callQaCampaigns).where(eq(callQaCampaigns.tenantId, row.tenantId))) {
      const qs = normalizeQuestions(campaign.questions as QualificationQuestion[] | null); if (qs.length && qs.every((question) => presetKeys.has(question.key))) await db.update(callQaCampaigns).set({ questions: preset.questions }).where(eq(callQaCampaigns.id, campaign.id));
    }
    changed += 1;
  }
  return changed;
}

/** Einmalige Einrichtung (gewünscht): Kampagne „Wattfox PV und WP“ mit den Regeln der Vorlage – Gespräche aus „Wattfox PV“ hängen um. Nur bei Mandanten, die die Vorlage nutzen. */
export const WATTFOX_CAMPAIGN = "Wattfox PV und WP";
export async function ensureWattfoxCampaign(db: Db): Promise<number> {
  const preset = presetByKey("pv-hauskompass")!; let changed = 0;
  for (const row of await db.select({ tenantId: callQaConfigs.tenantId, criteria: callQaConfigs.criteria }).from(callQaConfigs)) {
    const keys = new Set(((Array.isArray(row.criteria) ? row.criteria : []) as Criterion[]).map((c) => c.key)); if (!preset.criteria.every((c) => keys.has(c.key))) continue;
    const existing = (await db.select({ id: callQaCampaigns.id }).from(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, row.tenantId), eq(callQaCampaigns.name, WATTFOX_CAMPAIGN))).limit(1))[0];
    if (existing) continue; // schon eingerichtet – ab hier macht der Mandant es selbst
    const oldNames = ["Wattfox PV", "Wattfox", "Wattfox WP", "Wattfox PV & WP"];
    for (const old of oldNames) { const own = (await db.select({ id: callQaCampaigns.id }).from(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, row.tenantId), eq(callQaCampaigns.name, old))).limit(1))[0]; if (own) await db.delete(callQaCampaigns).where(eq(callQaCampaigns.id, own.id)); await db.update(callRecords).set({ campaign: WATTFOX_CAMPAIGN }).where(and(eq(callRecords.tenantId, row.tenantId), eq(callRecords.campaign, old))); }
    await db.insert(callQaCampaigns).values({ tenantId: row.tenantId, name: WATTFOX_CAMPAIGN, questions: preset.questions });
    changed += 1;
  }
  return changed;
}
/** Vorlage nur für eine Kampagne übernehmen (eigene Regeln je Kampagne). */
export async function applyPresetToCampaign(db: Db, tenantId: number, input: { preset: string; campaign: string }) {
  const preset = presetByKey(input.preset); if (!preset) throw new Error("Diese Vorlage gibt es nicht."); const name = input.campaign.trim(); if (!name) throw new Error("Bitte eine Kampagne wählen.");
  const own = (await db.select({ id: callQaCampaigns.id }).from(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, tenantId), eq(callQaCampaigns.name, name))).limit(1))[0];
  if (own) await db.update(callQaCampaigns).set({ questions: preset.questions, criteria: preset.criteria, instructions: null }).where(eq(callQaCampaigns.id, own.id)); else await db.insert(callQaCampaigns).values({ tenantId, name, questions: preset.questions, criteria: preset.criteria });
  return { success: true as const, questions: preset.questions.length, criteria: preset.criteria.length };
}

/** Kampagne löschen: Fragensatz und ALLE Gespräche dieser Kampagne (samt hochgeladener Dateien). Leads/Kontakte bleiben. */
export async function deleteCallCampaign(db: Db, tenantId: number, input: { name: string }) {
  const name = input.name.trim(); if (!name) throw new Error("Bitte eine Kampagne wählen.");
  const ids = (await db.select({ id: callRecords.id }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.campaign, name)))).map((row) => row.id);
  const { deleted } = await deleteCalls(db, tenantId, ids);
  await db.delete(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, tenantId), eq(callQaCampaigns.name, name)));
  return { deletedCalls: deleted };
}

export async function listCalls(db: Db, tenantId: number, filter: { decision?: string | null; status?: string | null; campaign?: string | null; agentName?: string | null; categoryId?: number | null; limit?: number } & CallPeriod = {}) {
  const conditions = [eq(callRecords.tenantId, tenantId)];
  const range = callPeriodRange(filter); if (range.from) conditions.push(gte(callRecords.startedAt, range.from)); if (range.to) conditions.push(lt(callRecords.startedAt, range.to));
  if (filter.categoryId) conditions.push(eq(callRecords.leadCategoryId, filter.categoryId));
  if (filter.decision) conditions.push(eq(callRecords.decision, filter.decision as CallRecord["decision"]));
  if (filter.agentName) conditions.push(eq(callRecords.agentName, filter.agentName));
  if (filter.status) conditions.push(eq(callRecords.status, filter.status as CallRecord["status"]));
  if (filter.campaign) conditions.push(eq(callRecords.campaign, filter.campaign));
  const rows = await db.select({ call: callRecords, leadPublicId: leads.publicId, leadName: leads.firstName, leadLastName: leads.lastName, leadStatus: leads.status, reviewer: users.name, rawFirst: rawContacts.firstName, rawLast: rawContacts.lastName, rawCompany: rawContacts.company, categoryName: leadCategories.name, categoryEmoji: leadCategories.emoji }).from(callRecords).leftJoin(leads, eq(leads.id, callRecords.leadId)).leftJoin(users, eq(users.id, callRecords.reviewedByUserId)).leftJoin(rawContacts, eq(rawContacts.id, callRecords.rawContactId)).leftJoin(leadCategories, eq(leadCategories.id, callRecords.leadCategoryId)).where(and(...conditions)).orderBy(desc(callRecords.createdAt)).limit(filter.limit ?? 200);
  // Opt-in je Gespräch: der beste Nachweis für den Fachbetrieb zum Lead (gültig > unvollständig > offen)
  const leadIds = Array.from(new Set(rows.map((row) => row.call.leadId).filter((id): id is number => typeof id === "number")));
  const optInRows = leadIds.length ? await db.select({ id: optIns.id, leadId: optIns.leadId, status: optIns.status, kind: optIns.kind, number: optIns.number, buyerName: optIns.buyerName, missing: optIns.missing, callRecordId: optIns.callRecordId }).from(optIns).where(and(eq(optIns.tenantId, tenantId), inArray(optIns.leadId, leadIds), eq(optIns.grantedTo, "kaeufer"))).orderBy(desc(optIns.id)) : [];
  const rank: Record<string, number> = { gueltig: 0, offen: 1, unvollstaendig: 2, abgelehnt: 3, widerrufen: 4 };
  const optInOf = (leadId: number | null, callId: number) => { if (!leadId) return null; const own = optInRows.filter((row) => row.leadId === leadId).sort((a, b) => (a.callRecordId === callId ? -1 : 0) - (b.callRecordId === callId ? -1 : 0) || (rank[a.status] ?? 9) - (rank[b.status] ?? 9)); const best = own[0]; return best ? { id: best.id, status: best.status, kind: best.kind, number: best.number, buyerName: best.buyerName, missing: (best.missing as string[] | null) ?? [] } : null; };
  return rows.map(({ call, leadPublicId, leadName, leadLastName, leadStatus, reviewer, rawFirst, rawLast, rawCompany, categoryName, categoryEmoji }) => ({ id: call.id, optIn: optInOf(call.leadId, call.id), leadCategoryId: call.leadCategoryId, category: categoryName ? { id: call.leadCategoryId!, name: categoryName, emoji: categoryEmoji ?? null } : null, externalCallId: call.externalCallId, provider: call.provider, leadId: call.leadId, rawContactId: call.rawContactId, rawContactName: call.rawContactId ? [rawFirst, rawLast].filter(Boolean).join(" ") || rawCompany || "Rohdaten-Kontakt" : null, leadPublicId, leadName: [leadName, leadLastName].filter(Boolean).join(" ") || null, leadStatus, phone: call.phone, agentName: call.agentName, campaign: call.campaign, direction: call.direction, startedAt: call.startedAt, durationSeconds: call.durationSeconds, consent: call.consent, status: call.status, score: call.score, verdict: call.verdict, decision: call.decision, decidedBy: call.decidedBy, reviewer, reviewedAt: call.reviewedAt, summary: call.summary, nextStep: call.nextStep, error: call.error, createdAt: call.createdAt, qualificationAnswers: (call.qualificationAnswers ?? null) as Record<string, QualificationAnswer> | null }));
}

export async function getCall(db: Db, tenantId: number, callId: number) {
  const row = (await db.select({ call: callRecords, leadPublicId: leads.publicId, leadName: leads.firstName, leadLastName: leads.lastName, leadStatus: leads.status, reviewer: users.name, rawFirst: rawContacts.firstName, rawLast: rawContacts.lastName, rawCompany: rawContacts.company, rawStatus: rawContacts.status, categoryName: leadCategories.name, categoryEmoji: leadCategories.emoji }).from(callRecords).leftJoin(leads, eq(leads.id, callRecords.leadId)).leftJoin(users, eq(users.id, callRecords.reviewedByUserId)).leftJoin(rawContacts, eq(rawContacts.id, callRecords.rawContactId)).leftJoin(leadCategories, eq(leadCategories.id, callRecords.leadCategoryId)).where(and(eq(callRecords.id, callId), eq(callRecords.tenantId, tenantId))).limit(1))[0];
  if (!row) throw new Error("Gespräch wurde nicht gefunden.");
  const config = await ensureCallQaConfig(db, tenantId);
  const own = await criteriaForCampaign(db, tenantId, row.call.campaign, config); const criteria = own.criteria;
  const scores = Array.isArray(row.call.criteriaScores) ? (row.call.criteriaScores as Evaluation["criteria"]) : [];
  const questions = await questionsForCampaign(db, tenantId, row.call.campaign);
  return { ...row.call, category: row.categoryName ? { id: row.call.leadCategoryId!, name: row.categoryName, emoji: row.categoryEmoji ?? null } : null, criteriaCustom: own.custom, recordingUrl: row.call.recordingUrl?.startsWith("file:") ? `/api/aufnahmen/${row.call.id}` : row.call.recordingUrl, recordingSource: row.call.recordingUrl?.startsWith("file:") ? "datei" as const : row.call.recordingUrl ? "link" as const : null, payload: undefined, questions, qualificationAnswers: (row.call.qualificationAnswers ?? {}) as Record<string, QualificationAnswer>, leadPublicId: row.leadPublicId, leadName: [row.leadName, row.leadLastName].filter(Boolean).join(" ") || null, leadStatus: row.leadStatus, rawContact: row.call.rawContactId ? { id: row.call.rawContactId, name: [row.rawFirst, row.rawLast].filter(Boolean).join(" ") || row.rawCompany || "Rohdaten-Kontakt", status: row.rawStatus } : null, reviewer: row.reviewer, criteria: criteria.map((criterion) => ({ ...criterion, score: scores.find((item) => item.key === criterion.key)?.score ?? null, evidence: scores.find((item) => item.key === criterion.key)?.evidence ?? "" })), redFlags: Array.isArray(row.call.redFlags) ? (row.call.redFlags as string[]) : [] };
}

export async function callStatistics(db: Db, tenantId: number, filter: CallPeriod & { campaign?: string | null; agentName?: string | null; categoryId?: number | null } = {}) {
  const conditions = [eq(callRecords.tenantId, tenantId)]; const range = callPeriodRange(filter); if (range.from) conditions.push(gte(callRecords.startedAt, range.from)); if (range.to) conditions.push(lt(callRecords.startedAt, range.to)); if (filter.campaign) conditions.push(eq(callRecords.campaign, filter.campaign)); if (filter.agentName) conditions.push(eq(callRecords.agentName, filter.agentName)); if (filter.categoryId) conditions.push(eq(callRecords.leadCategoryId, filter.categoryId));
  const rows = await db.select({ status: callRecords.status, decision: callRecords.decision, score: callRecords.score }).from(callRecords).where(and(...conditions));
  const scored = rows.filter((row) => typeof row.score === "number");
  return { total: rows.length, evaluated: rows.filter((row) => row.status === "bewertet").length, approved: rows.filter((row) => row.decision === "freigegeben").length, review: rows.filter((row) => row.decision === "pruefen").length, rejected: rows.filter((row) => row.decision === "zurueckgewiesen").length, noConsent: rows.filter((row) => row.status === "ohne_einwilligung").length, failed: rows.filter((row) => row.status === "fehlgeschlagen").length, averageScore: scored.length ? Math.round(scored.reduce((sum, row) => sum + (row.score ?? 0), 0) / scored.length) : null };
}

/** Lead-Kategorien, die in Gesprächen vorkommen (für den Filter) – mit Anzahl. */
export async function callCategoryOptions(db: Db, tenantId: number) {
  const rows = await db.select({ id: leadCategories.id, name: leadCategories.name, emoji: leadCategories.emoji, count: sql<number>`count(${callRecords.id})` }).from(callRecords).innerJoin(leadCategories, eq(leadCategories.id, callRecords.leadCategoryId)).where(eq(callRecords.tenantId, tenantId)).groupBy(leadCategories.id, leadCategories.name, leadCategories.emoji).orderBy(asc(leadCategories.name));
  return rows.map((row) => ({ id: row.id, name: row.name, emoji: row.emoji ?? null, count: Number(row.count) }));
}
/** Aufbewahrung: Transkripte, Aufzeichnungs-Links und Rohdaten älter als retentionDays werden entfernt (Bewertung bleibt). */
/** Gespräch löschen: Datensatz weg, hochgeladene Datei weg, Opt-in-Verweis gelöst. Der Lead selbst bleibt. */
export async function deleteCall(db: Db, tenantId: number, callId: number) {
  const row = (await db.select({ id: callRecords.id, recordingUrl: callRecords.recordingUrl }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.id, callId))).limit(1))[0];
  if (!row) throw new Error("Gespräch wurde nicht gefunden.");
  if (row.recordingUrl?.startsWith("file:")) { const name = row.recordingUrl.slice("file:".length).replace(/[^a-zA-Z0-9._-]/g, ""); await fs.unlink(path.resolve(recordingsDir(), name)).catch(() => undefined); }
  await db.update(optIns).set({ callRecordId: null }).where(and(eq(optIns.tenantId, tenantId), eq(optIns.callRecordId, callId)));
  await db.delete(callRecords).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.id, callId)));
  return { success: true as const };
}
export async function deleteCalls(db: Db, tenantId: number, callIds: number[]) { let deleted = 0; for (const id of callIds.slice(0, 5000)) { try { await deleteCall(db, tenantId, id); deleted += 1; } catch { /* schon weg */ } } return { deleted }; }

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
