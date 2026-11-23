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
import { and, asc, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, like, lt, ne, or, sql } from "drizzle-orm";
import { callAiCapReached, callAiSpentToday, recordTranscriptionUsage } from "./ai-budget";
import { phoneFragment, searchWords } from "../shared/call-search";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { callQaConfigs, callRecords, leadCategories, leadStatusEvents, leads, optIns, rawBatches, rawContacts, users, type CallQaConfig, type CallRecord } from "../drizzle/schema";
import { batchCategoryIds, convertRawContact, normalizeRawPhone } from "./raw-data";
import { CONTACT_MAPPING, dialerInfo, extractDialerContact, matchDialerCategory, mergeDialerData, type DialerContact } from "../shared/dialer-contact";
import { invokeLLM } from "./_core/llm";
import { cleanSpokenContact, contactFromTranscript, contactParts, EMPTY_INTAKE, intakeVerdict, payloadFieldNames, withSpokenContact, type IntakeCounts, type SpokenContact } from "../shared/dialer-intake";
import { berlinDay } from "../shared/agent-ranking";
import { noteAfterEvaluation } from "./call-notes";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./integration-secrets";
import { triggerLeadAutomations, type Db } from "./lead-pipeline";
import { readPath } from "./outbound-templates";
import { describeShape, fieldNames, looseItems, looseStrings, readAnswers, readCriteriaScores } from "./llm-shape";

export type Criterion = { key: string; label: string; weight: number; description: string };
import { callQaCampaigns, categoryFieldMappings, categoryFields } from "../drizzle/schema";
import { dialerFieldMatches, type LeadFieldDef } from "../shared/lead-fields";
import { CALL_QA_PRESETS, presetByKey } from "../shared/call-qa-presets";
import { callPeriodRange, type CallPeriod } from "../shared/call-period";
import { detectTopic } from "../shared/call-topic";
import { summarizeCalls } from "../shared/call-overview";
import { locateByWords, markItems, normalizeSegments, parseClock, readTimeline, snapToSegment, timedTranscript, timelineStateOf, type CallSegment, type CallTimeline, type MarkItem, type TimelineState } from "../shared/call-timeline";
export { markItems, timelineStateOf, type MarkItem, type TimelineState };
import { agentNameMerges, canonicalAgentName, cleanAgentName, detectAgent, detectAgentName, isJunkAgentName, sameAgentName } from "../shared/agent-names";
export { cleanAgentName, detectAgentName };
export { callPeriodRange, detectTopic, type CallPeriod };
import { answerQuestionsHeuristically, decideByQuestions, DEFAULT_QUALIFICATION_QUESTIONS, normalizeQuestions, summarizeAnswers, type QualificationAnswer, type QualificationQuestion, applyQuestionScope, softenGasHeatPumpNo, isCallback, questionFulfilment, SCOPE_LABEL } from "../shared/call-qualification";

/** Kampagnen mit eigenen Qualifizierungsfragen. Fehlt eine Kampagne, gilt der Standardfragensatz. */
export async function listCampaigns(db: Db, tenantId: number) {
  const rows = await db.select().from(callQaCampaigns).where(eq(callQaCampaigns.tenantId, tenantId)).orderBy(asc(callQaCampaigns.name));
  const fromCalls = await db.select({ campaign: callRecords.campaign }).from(callRecords).where(eq(callRecords.tenantId, tenantId));
  const names = new Set(rows.map((row) => row.name)); const extra = Array.from(new Set(fromCalls.map((row) => row.campaign).filter((name): name is string => Boolean(name) && !names.has(name!))));
  const defaults = await defaultQuestionsFor(db, tenantId);
  const campaignCriteria = (row: { criteria: unknown }) => (Array.isArray(row.criteria) && row.criteria.length ? row.criteria as Criterion[] : null);
  return [...rows.map((row) => ({ id: row.id, name: row.name, questions: normalizeQuestions(row.questions as QualificationQuestion[] | null), criteria: campaignCriteria(row), instructions: row.instructions ?? null, custom: true })), ...extra.map((name) => ({ id: null as number | null, name, questions: defaults, criteria: null as Criterion[] | null, instructions: null as string | null, custom: false }))];
}
/*
 * Vorlagen-Bezug („presetKey“): Regeln, die unverändert aus einer Vorlage stammen, bekommen deren spätere Verbesserungen automatisch.
 * Sobald der Mandant selbst etwas ändert und speichert, ist der Bezug weg – eigene Einstellungen werden nie wieder überschrieben.
 */
const criteriaTextsEqual = (own: Criterion[], preset: Criterion[]) => own.length === preset.length && preset.every((criterion) => { const mine = own.find((item) => item.key === criterion.key); return Boolean(mine) && mine!.label === criterion.label && (mine!.description ?? "") === (criterion.description ?? ""); });
const questionsEqual = (own: unknown, preset: unknown) => JSON.stringify(normalizeQuestions(own as QualificationQuestion[] | null)) === JSON.stringify(normalizeQuestions(preset as QualificationQuestion[] | null));
/** Bleibt der Vorlagen-Bezug nach dem Speichern von Fragen bestehen? Nur, wenn sie noch genau der Vorlage entsprechen. */
const keptPresetKey = (presetKey: string | null | undefined, questions: QualificationQuestion[]) => { const preset = presetKey ? presetByKey(presetKey) : undefined; return preset && questionsEqual(questions, preset.questions) ? preset.key : null; };

export async function saveCampaign(db: Db, tenantId: number, input: { id?: number | null; name: string; questions: Array<Partial<QualificationQuestion>> }) {
  const name = input.name.trim(); if (!name) throw new Error("Bitte einen Kampagnennamen angeben.");
  const questions = normalizeQuestions(input.questions); if (!questions.length) throw new Error("Bitte mindestens eine Frage angeben.");
  if (input.id) { const own = (await db.select({ presetKey: callQaCampaigns.presetKey }).from(callQaCampaigns).where(and(eq(callQaCampaigns.id, input.id), eq(callQaCampaigns.tenantId, tenantId))).limit(1))[0]; await db.update(callQaCampaigns).set({ name, questions, presetKey: keptPresetKey(own?.presetKey, questions) }).where(and(eq(callQaCampaigns.id, input.id), eq(callQaCampaigns.tenantId, tenantId))); return { id: input.id, questions }; }
  const existing = (await db.select({ id: callQaCampaigns.id, presetKey: callQaCampaigns.presetKey }).from(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, tenantId), eq(callQaCampaigns.name, name))).limit(1))[0];
  if (existing) { await db.update(callQaCampaigns).set({ questions, presetKey: keptPresetKey(existing.presetKey, questions) }).where(eq(callQaCampaigns.id, existing.id)); return { id: existing.id, questions }; }
  const inserted = await db.insert(callQaCampaigns).values({ tenantId, name, questions }); return { id: Number(inserted[0]?.insertId) || 0, questions };
}
/** Standard-Prüffragen (für Kampagnen ohne eigene Fragen) speichern. */
export async function saveDefaultQuestions(db: Db, tenantId: number, input: Array<Partial<QualificationQuestion>>) {
  const questions = normalizeQuestions(input); if (!questions.length) throw new Error("Bitte mindestens eine Frage angeben.");
  const config = await ensureCallQaConfig(db, tenantId);
  await db.update(callQaConfigs).set({ defaultQuestions: questions, presetKey: keptPresetKey(config.presetKey, questions) }).where(eq(callQaConfigs.id, config.id));
  return { success: true as const, questions };
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
  return { criteria: own, instructions: row?.instructions?.trim() ? row.instructions : standard.instructions, custom: true }; // eigene Vorgaben der Kampagne ersetzen die Standard-Vorgaben
}
/** Eigene Kriterien (und Zusatz-Anweisung) für eine Kampagne speichern; leere Liste = wieder die Standard-Kriterien. */
export async function saveCampaignCriteria(db: Db, tenantId: number, input: { name: string; criteria: Array<Partial<Criterion>>; instructions?: string | null }) {
  const name = input.name.trim(); if (!name) throw new Error("Bitte eine Kampagne wählen.");
  const used = new Set<string>();
  const criteria: Criterion[] = input.criteria.map((item, index) => { const label = String(item.label ?? "").trim(); let key = String(item.key ?? "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || label.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || `kriterium_${index + 1}`; while (used.has(key)) key += "_2"; used.add(key); return { key, label, description: String(item.description ?? "").trim(), weight: Math.max(0, Math.min(100, Math.round(Number(item.weight ?? 0)))) }; }).filter((item) => item.label);
  if (criteria.length && criteria.reduce((sum, item) => sum + item.weight, 0) <= 0) throw new Error("Mindestens ein Kriterium braucht ein Gewicht größer als 0.");
  const instructions = (input.instructions ?? "").trim().slice(0, 4000) || null;
  const own = (await db.select({ id: callQaCampaigns.id }).from(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, tenantId), eq(callQaCampaigns.name, name))).limit(1))[0];
  const values = { criteria: criteria.length ? criteria : null, instructions, ...(criteria.length ? { presetKey: null } : {}) }; // eigene Kriterien: ab jetzt keine automatische Angleichung an eine Vorlage mehr
  if (own) await db.update(callQaCampaigns).set(values).where(eq(callQaCampaigns.id, own.id)); else await db.insert(callQaCampaigns).values({ tenantId, name, questions: await defaultQuestionsFor(db, tenantId), ...values });
  return { success: true as const, criteria: criteria.length, custom: criteria.length > 0 };
}
/** Vorlage anwenden: Kriterien + Anweisung in die Einstellungen, Prüffragen als Standard – und auf Wunsch in alle vorhandenen Kampagnen-Fragensätze. */
export async function applyCallQaPreset(db: Db, tenantId: number, input: { preset: string; allCampaigns: boolean }) {
  const preset = presetByKey(input.preset); if (!preset) throw new Error("Diese Vorlage gibt es nicht.");
  await ensureCallQaConfig(db, tenantId);
  await db.update(callQaConfigs).set({ criteria: preset.criteria, instructions: preset.instructions, defaultQuestions: preset.questions, presetKey: preset.key }).where(eq(callQaConfigs.tenantId, tenantId));
  let campaigns = 0;
  if (input.allCampaigns) { const result = await db.update(callQaCampaigns).set({ questions: preset.questions, presetKey: preset.key }).where(eq(callQaCampaigns.tenantId, tenantId)); campaigns = Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0); }
  return { success: true as const, preset: preset.key, campaigns };
}
/** Antworten je Frage: KI (wenn verfügbar) – sonst Stichwort-Regeln. */
export async function answerQualification(questions: QualificationQuestion[], transcript: string, options: { /** KI-Fehler werfen statt auf Stichworte auszuweichen */ strict?: boolean } = {}): Promise<Record<string, QualificationAnswer>> {
  const heuristic = answerQuestionsHeuristically(questions, transcript);
  if (!process.env.ANTHROPIC_API_KEY || !questions.length) return heuristic;
  try {
    // Antwort und Beleg je Frage als einzelne Felder (antwort_<schlüssel> / notiz_<schlüssel>) – eine verschachtelte Liste kam gelegentlich als Text zurück und wurde dann still ignoriert
    const answerFields = fieldNames(questions.map((question) => question.key), "antwort"); const noteFields = fieldNames(questions.map((question) => question.key), "notiz");
    const properties: Record<string, unknown> = {};
    questions.forEach((question, index) => { properties[answerFields[index]] = { type: "string", enum: ["ja", "nein", "unklar"], description: `Antwort auf: ${question.label}` }; properties[noteFields[index]] = { type: "string", description: "Beleg zu dieser Antwort in ein bis drei vollständigen Sätzen" }; });
    const schema = { name: "qualifizierung", schema: { type: "object", additionalProperties: false, required: Object.keys(properties), properties } };
    const system = `Beantworte die folgenden Fragen zu einem Verkaufsgespräch ausschließlich anhand des Transkripts mit ja, nein oder unklar und einem Beleg (note) in ein bis drei vollständigen Sätzen – nie mitten im Satz abbrechen. Erfinde nichts. Handelt es sich erkennbar um einen Rückruf (Kunde und Mitarbeiter hatten schon Kontakt, z. B. „wie besprochen“, „ich rufe zurück“, „wir hatten ja schon telefoniert“), muss ein Firmenname nicht noch einmal genannt werden – die Frage danach dann mit ja beantworten (note: Rückruf). Fragen mit dem Zusatz [gilt nur bei …] betreffen nur dieses Produkt: Geht es im Gespräch nicht darum, antworte ja mit note „Entfällt“. Das Transkript stammt aus automatischer Spracherkennung: Firmen- und Eigennamen sind darin oft falsch geschrieben. Wird nach einem Namen gefragt und im Transkript steht etwas, das sich ähnlich anhört (z. B. „Haus Campus“ oder „Hauskompas“ statt „HausKompass“), gilt der Name als genannt – der Gesprächspartner versteht, was gemeint ist. Wird nach einem Zeitrahmen gefragt, muss der Kunde kein genaues Datum nennen: sinngemäße Zusagen wie „so schnell wie möglich“ oder „zeitnah“ zählen als ja.\nTrage die Antwort je Frage in das genannte Antwort-Feld und den Beleg in das Notiz-Feld ein – als einzelne Felder, nicht als Liste oder Text:\n${questions.map((question, index) => `- ${question.key}: ${question.label}${question.onlyFor ? ` [gilt nur bei ${SCOPE_LABEL[question.onlyFor]}]` : ""}${question.hint ? ` (Hinweis: ${question.hint})` : ""} → Felder ${answerFields[index]} und ${noteFields[index]}`).join("\n")}`;
    const ask = async (maxTokens: number): Promise<Record<string, unknown>> => {
      const response = await invokeLLM({ model: "fast", maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: `Transkript:\n"""\n${transcript.slice(0, 40_000)}\n"""` }], outputSchema: schema });
      let value: unknown; try { value = JSON.parse(response.choices[0]?.message.content ?? "{}"); } catch { value = {}; }
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    };
    let read = readAnswers(await ask(3000), questions);
    if (read.length < questions.length) { const again = readAnswers(await ask(6000).catch(() => ({})), questions); if (again.length > read.length) read = again; } // Antworten fehlen (z. B. abgeschnitten): ein zweiter Anlauf mit mehr Platz – was dann noch fehlt, beantworten die Stichwort-Regeln
    const out: Record<string, QualificationAnswer> = { ...heuristic };
    for (const item of read) out[item.key] = { answer: item.answer, note: item.note };
    return softenGasHeatPumpNo(questions, applyQuestionScope(questions, out, transcript), transcript); // Erdgas-Wärmepumpe: „Nein“ nur bei ausdrücklicher Nennung – sonst unklar (Zur Prüfung)
  } catch (error) { if (options.strict) throw error; return heuristic; }
}
export async function campaignSummary(db: Db, tenantId: number, campaign: string | null | undefined) {
  const questions = await questionsForCampaign(db, tenantId, campaign);
  const conditions = [eq(callRecords.tenantId, tenantId), eq(callRecords.status, "bewertet")]; if (campaign) conditions.push(eq(callRecords.campaign, campaign));
  const rows = await db.select({ answers: callRecords.qualificationAnswers }).from(callRecords).where(and(...conditions));
  const own = await criteriaForCampaign(db, tenantId, campaign);
  const summaryConfig = await ensureCallQaConfig(db, tenantId);
  const ownRow = campaign ? (await db.select({ instructions: callQaCampaigns.instructions, presetKey: callQaCampaigns.presetKey }).from(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, tenantId), eq(callQaCampaigns.name, campaign))).limit(1))[0] : undefined;
  return { questions, calls: rows.length, summary: summarizeAnswers(rows.map((row) => row.answers as Record<string, QualificationAnswer> | null), questions), criteria: own.criteria, criteriaCustom: own.custom, instructions: ownRow?.instructions ?? null, defaultCampaign: summaryConfig.defaultCampaign ?? null, presetLabel: presetByKey((campaign ? ownRow?.presetKey : summaryConfig.presetKey) ?? "")?.label ?? null };
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
export type DecisionRule = { id: string; label: string; field: "score" | "verdict" | "redFlags" | "transcript" | "dialerResult" | `criterion:${string}`; op: "gte" | "lte" | "eq" | "contains" | "any"; value: string; decision: "freigegeben" | "pruefen" | "zurueckgewiesen"; active: boolean };
export type ExampleCase = { title: string; transcript: string; verdict: "verkaufbar" | "nachfassen" | "nicht_verkaufbar"; reason: string };
export type ExtractField = { key: string; label: string; question: string };
/** Felder zum Gespräch – und (seit der Dialer den ganzen Kontakt mitschicken kann) die Felder zum Kontakt. */
const CALL_MAPPING = { callId: "call_id", leadId: "lead_id", phone: "phone", agent: "agent", campaign: "campaign", direction: "direction", startedAt: "started_at", duration: "duration", recordingUrl: "recording_url", transcript: "transcript", consent: "consent" };
export const DEFAULT_MAPPING = { ...CALL_MAPPING, ...CONTACT_MAPPING };

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
  const followed = config.presetKey ? presetByKey(config.presetKey) : undefined; // Texte von Hand geändert → Vorlage wird nicht mehr automatisch nachgezogen
  const presetKey = followed && criteriaTextsEqual(input.criteria, followed.criteria) && (input.instructions ?? "") === followed.instructions ? followed.key : null;
  await db.update(callQaConfigs).set({ presetKey, enabled: input.enabled, consentRequired: input.consentRequired, autoApproveThreshold: input.autoApproveThreshold, autoRejectThreshold: input.autoRejectThreshold, autoDeliver: input.autoDeliver, criteria: input.criteria, instructions: input.instructions, fieldMapping: input.fieldMapping, recordingAuthHeader: authHeader, transcriptionProvider: input.transcriptionProvider, transcriptionLanguage: input.transcriptionLanguage, retentionDays: input.retentionDays, ...(input.decisionRules ? { decisionRules: input.decisionRules } : {}), ...(input.examples ? { examples: input.examples } : {}), ...(input.extractFields ? { extractFields: input.extractFields.filter((field) => field.key && field.question) } : {}) }).where(eq(callQaConfigs.id, config.id));
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
  return { status: 200, body: { ok: true, service: "Gesprächsbewertung", method: "POST", content_type: "application/json", enabled: config.enabled, consent_required: config.consentRequired, transcription: transcriptionService(config), recording_auth_header: Boolean(config.recordingAuthHeader), expected_fields: mapping, required: [mapping.callId, mapping.phone, mapping.recordingUrl, mapping.agent], recommended: [mapping.category], category_values: ["PV", "WP", "PV+WP"], test_mode: "POST mit \"test\": true prüft die Felder und den Aufnahme-Link, ohne etwas zu speichern" } };
}
/** Rohdaten-Kontakt zur Rufnummer (noch nicht Lead) – damit eine Freigabe ihn zum Lead macht und eine Ablehnung ihn verwirft. */
async function rawContactByPhone(db: Db, tenantId: number, phone: string) {
  const normalized = normalizeRawPhone(phone); if (!normalized) return undefined; // Rohdaten speichern Nummern als +49…
  const national = `0${normalized.replace(/^\+49/, "")}`;
  const variants = Array.from(new Set([phone, normalized, normalized.replace(/^\+/, "00"), national]));
  const rows = await db.select({ id: rawContacts.id, phone: rawContacts.phone, status: rawContacts.status, leadId: rawContacts.leadId }).from(rawContacts).where(and(eq(rawContacts.tenantId, tenantId), inArray(rawContacts.status, ["neu", "in_liste"]), or(...variants.map((value) => eq(rawContacts.phone, value))))).orderBy(desc(rawContacts.createdAt)).limit(5);
  return rows.find((row) => row.phone && normalizeRawPhone(row.phone) === normalized && !row.leadId) ?? rows.find((row) => !row.leadId);
}
/** Lead oder Rohdaten-Kontakt zur Meldung: erst unsere Lead-Nummer, dann die Rufnummer. */
async function findDialerTarget(db: Db, tenantId: number, leadRef: string, phone: string) {
  let lead = leadRef ? (await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "verkauf"), or(eq(leads.publicId, leadRef), ...(Number.isInteger(Number(leadRef)) && Number(leadRef) > 0 ? [eq(leads.id, Number(leadRef))] : [])))).limit(1))[0] : undefined;
  if (!lead && phone) {
    // Rufnummern stehen in vielen Schreibweisen im Bestand (+49 40 …, 040-…, 0049…) – verglichen wird ohne Trennzeichen, in jeder gängigen Form
    const digits = normalizePhone(phone); const e164 = normalizeRawPhone(phone);
    const forms = e164 ? Array.from(new Set([e164, e164.replace(/^\+/, "00"), e164.replace(/^\+49/, "0"), e164.replace(/^\+/, "")])) : [];
    const bare = sql`REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${leads.phone}, ' ', ''), '-', ''), '/', ''), '(', ''), ')', ''), '.', '')`;
    const candidates = await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "verkauf"), or(eq(leads.phone, phone), eq(leads.phone, `+${digits}`), eq(leads.phone, `0${digits.replace(/^49/, "")}`), ...(forms.length ? [inArray(bare, forms)] : [])))).orderBy(desc(leads.createdAt)).limit(5);
    lead = candidates.find((row) => row.phone && normalizePhone(row.phone) === digits) ?? candidates[0];
  }
  // Kein Lead zur Nummer, aber ein Rohdaten-Kontakt (hochgeladene Callcenter-Liste): merken – „freigegeben“ macht ihn zum Lead, „zurückgewiesen“ verwirft ihn
  const rawContact = !lead && phone ? await rawContactByPhone(db, tenantId, phone) : undefined;
  return { lead, rawContact };
}

/* Der Dialer schickt den ganzen Kontakt mit: unbekannte Rufnummern werden als Kontakt in einer eigenen Liste angelegt (Freigabe macht ihn zum Lead),
   bekannte Kontakte und Leads werden ergänzt – vorhandene Angaben bleiben stehen. */
const DIALER_BATCH_MARK = "dialer";
const plainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isDialerBatch = (batch: { mapping: unknown }) => plainObject(batch.mapping) && batch.mapping.auto === DIALER_BATCH_MARK;
/** Die Liste, in der Kontakte aus Meldungen des Dialers landen – wird beim ersten Kontakt angelegt (alle Kategorien erlaubt). */
async function ensureDialerBatch(db: Db, config: Pick<CallQaConfig, "tenantId" | "provider">) {
  const existing = (await db.select().from(rawBatches).where(eq(rawBatches.tenantId, config.tenantId))).find(isDialerBatch); if (existing) return existing;
  const categories = await db.select({ id: leadCategories.id }).from(leadCategories).where(eq(leadCategories.tenantId, config.tenantId)).orderBy(asc(leadCategories.id));
  if (!categories.length) return null; // ohne Kategorie kann kein Lead entstehen
  const inserted = await db.insert(rawBatches).values({ tenantId: config.tenantId, name: "Kontakte vom Dialer", categoryId: categories[0].id, categoryIds: categories.map((item) => item.id), sourceName: config.provider === "ondialer" ? "OnDialer" : "Dialer", mapping: { auto: DIALER_BATCH_MARK }, rowCount: 0, createdByUserId: null });
  return (await db.select().from(rawBatches).where(eq(rawBatches.id, Number(inserted[0]?.insertId) || 0)).limit(1))[0] ?? null;
}
async function allowBatchCategory(db: Db, batch: { id: number; categoryId: number; categoryIds: unknown }, categoryId: number) {
  const ids = batchCategoryIds(batch); if (!ids.includes(categoryId)) await db.update(rawBatches).set({ categoryIds: [...ids, categoryId] }).where(eq(rawBatches.id, batch.id));
}
/** Kategorie für einen Kontakt vom Dialer: ausdrücklich genannt (Name oder Kürzel) – sonst die eine Kategorie, deren Name oder Kürzel als ganzes Wort im Kampagnennamen steht. */
async function dialerCategoryId(db: Db, tenantId: number, contact: DialerContact, campaign: string | null): Promise<number | null> {
  const categories = await db.select({ id: leadCategories.id, name: leadCategories.name, shortcode: leadCategories.shortcode }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId));
  const named = matchDialerCategory(categories, contact.category); if (named) return named.id; // „PV“, „WP“, „PV+WP“ oder genauer Name bzw. Kürzel
  const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").trim(); const haystack = ` ${words(campaign ?? "")} `; if (!haystack.trim()) return null;
  const hits = categories.filter((item) => [item.name, item.shortcode].some((label) => { const needle = words(label); return needle.length >= 2 && haystack.includes(` ${needle} `); }));
  return hits.length === 1 ? hits[0].id : null;
}
/** Leadsparte, die der Dialer ausdrücklich nennt (Feld `category`): die passende Kategorie – oder null, wenn nichts genannt oder nichts Eindeutiges gefunden wird. */
async function namedDialerCategory(db: Db, tenantId: number, contact: DialerContact): Promise<{ id: number; name: string } | null> {
  if (!contact.category) return null;
  const categories = await db.select({ id: leadCategories.id, name: leadCategories.name, shortcode: leadCategories.shortcode }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId));
  const hit = matchDialerCategory(categories, contact.category); return hit ? { id: hit.id, name: hit.name } : null;
}
async function createDialerContact(db: Db, config: Pick<CallQaConfig, "tenantId" | "provider">, input: { phone: string; campaign: string | null; contact: DialerContact }, note = "Vom Dialer gemeldet") {
  const batch = await ensureDialerBatch(db, config); if (!batch) return undefined;
  const categoryId = await dialerCategoryId(db, config.tenantId, input.contact, input.campaign); if (categoryId) await allowBatchCategory(db, batch, categoryId);
  const phone = normalizeRawPhone(input.phone) ?? input.phone;
  const inserted = await db.insert(rawContacts).values({ tenantId: config.tenantId, batchId: batch.id, categoryId, firstName: input.contact.firstName, lastName: input.contact.lastName, company: input.contact.company, phone, email: input.contact.email, postcode: input.contact.postcode, city: input.contact.city, country: input.contact.country, data: mergeDialerData({}, input.contact).data, status: "in_liste", note });
  await db.update(rawBatches).set({ rowCount: sql`${rawBatches.rowCount} + 1` }).where(eq(rawBatches.id, batch.id));
  return { id: Number(inserted[0]?.insertId) || 0, phone, status: "in_liste" as const, leadId: null };
}
/** Fehlende Angaben am Lead ergänzen (nichts überschreiben); Zusatzfelder, Ergebnis und Notiz des Dialers dazu. */
async function fillLeadFromDialer(db: Db, lead: typeof leads.$inferSelect, contact: DialerContact): Promise<boolean> {
  const patch: Partial<typeof leads.$inferInsert> = {};
  if (!lead.firstName && contact.firstName) patch.firstName = contact.firstName; if (!lead.lastName && contact.lastName) patch.lastName = contact.lastName; if (!lead.company && contact.company) patch.company = contact.company;
  if (!lead.email && contact.email) patch.email = contact.email; if (!lead.postcode && contact.postcode) patch.postcode = contact.postcode; if (!lead.city && contact.city) patch.city = contact.city;
  const merged = mergeDialerData(plainObject(lead.metadata) ? lead.metadata : {}, contact);
  // Felder unter eigenen Namen des Dialers („pv_dachart“) den Feldern der Kategorie zuordnen
  const defs = await db.select({ fieldKey: categoryFields.fieldKey, label: categoryFields.label, fieldType: categoryFields.fieldType, options: categoryFields.options }).from(categoryFields).where(and(eq(categoryFields.tenantId, lead.tenantId), eq(categoryFields.categoryId, lead.categoryId)));
  const categoryName = (await db.select({ name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.id, lead.categoryId)).limit(1))[0]?.name ?? null;
  const mappings = await db.select().from(categoryFieldMappings).where(and(eq(categoryFieldMappings.tenantId, lead.tenantId), eq(categoryFieldMappings.categoryId, lead.categoryId))).orderBy(asc(categoryFieldMappings.sortOrder), asc(categoryFieldMappings.id));
  const mapped = dialerFieldMatches(defs as LeadFieldDef[], merged.data, categoryName, mappings);
  if (merged.changed || mapped.sources.length) { const next: Record<string, unknown> = { ...merged.data, ...mapped.values }; for (const key of mapped.sources) delete next[key]; patch.metadata = next; }
  if (!Object.keys(patch).length) return false;
  await db.update(leads).set(patch).where(eq(leads.id, lead.id)); return true;
}
async function fillRawContactFromDialer(db: Db, rawContactId: number, contact: DialerContact): Promise<boolean> {
  const row = (await db.select().from(rawContacts).where(eq(rawContacts.id, rawContactId)).limit(1))[0]; if (!row) return false;
  const patch: Partial<typeof rawContacts.$inferInsert> = {};
  if (!row.firstName && contact.firstName) patch.firstName = contact.firstName; if (!row.lastName && contact.lastName) patch.lastName = contact.lastName; if (!row.company && contact.company) patch.company = contact.company;
  if (!row.email && contact.email) patch.email = contact.email; if (!row.postcode && contact.postcode) patch.postcode = contact.postcode; if (!row.city && contact.city) patch.city = contact.city;
  const merged = mergeDialerData(plainObject(row.data) ? row.data : {}, contact); if (merged.changed) patch.data = merged.data;
  if (!Object.keys(patch).length) return false;
  await db.update(rawContacts).set(patch).where(eq(rawContacts.id, row.id)); return true;
}
/** Kontakt aus der Dialer-Liste ohne eigene Kategorie: die Kategorie des Gesprächs (Thema laut KI) nehmen und für die Liste freigeben. */
async function dialerContactCategory(db: Db, tenantId: number, rawContactId: number, callId: number): Promise<number | null> {
  const contact = (await db.select({ categoryId: rawContacts.categoryId, batchId: rawContacts.batchId }).from(rawContacts).where(and(eq(rawContacts.id, rawContactId), eq(rawContacts.tenantId, tenantId))).limit(1))[0];
  if (!contact || contact.categoryId) return null;
  const batch = (await db.select().from(rawBatches).where(eq(rawBatches.id, contact.batchId)).limit(1))[0]; if (!batch || !isDialerBatch(batch)) return null;
  const call = (await db.select({ leadCategoryId: callRecords.leadCategoryId }).from(callRecords).where(eq(callRecords.id, callId)).limit(1))[0]; if (!call?.leadCategoryId) return null;
  await allowBatchCategory(db, batch, call.leadCategoryId); return call.leadCategoryId;
}

export async function ingestDialerCall(db: Db, token: string, payload: Record<string, unknown>, options: { fetchImpl?: typeof fetch } = {}) {
  const config = (await db.select().from(callQaConfigs).where(eq(callQaConfigs.webhookToken, token)).limit(1))[0];
  if (!config) return { status: 404, body: { error: "unknown webhook token" } };
  const mapping = { ...DEFAULT_MAPPING, ...((config.fieldMapping ?? {}) as Record<string, string>) };
  const get = (key: keyof typeof CALL_MAPPING) => readPath(payload, mapping[key]) ?? payload[key];
  const contact = extractDialerContact(payload, mapping); // Kontakt, Ergebnis und Notiz – falls der Dialer sie mitschickt
  const recordingOf = () => text(get("recordingUrl")) || contact.recordingUrl || ""; // Link zur Aufnahme – auch, wenn er unter den Feldern steht („pv_recording_1“)
  const phone = text(get("phone")) || contact.phone || ""; const leadRef = text(get("leadId"));
  // Testmodus: "test": true → Felder und Aufnahme-Link prüfen, nichts speichern (für den Dialer-Entwickler beim Einrichten)
  if (truthy(payload.test) || truthy(payload.dry_run)) {
    const found: string[] = []; const missing: string[] = [];
    for (const key of Object.keys(CALL_MAPPING) as Array<keyof typeof CALL_MAPPING>) { if (text(get(key)) || typeof get(key) === "boolean") found.push(mapping[key]); else missing.push(mapping[key]); }
    // Pflicht: Gesprächs-ID, Rufnummer, Aufnahme-Link – und der Agent (wir werten aus, wer die Leads bringt). Ohne Agent nehmen wir ein echtes Gespräch trotzdem an; der Testmodus meldet ihn aber als fehlend.
    const technical = (["callId", "phone", "recordingUrl"] as const).filter((key) => !(key === "phone" ? phone : key === "recordingUrl" ? recordingOf() : text(get(key)))).map((key) => mapping[key]);
    const agentGiven = Boolean(text(get("agent"))) && !isJunkAgentName(text(get("agent")));
    const required = agentGiven ? technical : [...technical, mapping.agent];
    const namedCategory = await namedDialerCategory(db, config.tenantId, contact);
    const recordingUrl = recordingOf(); let recording: Record<string, unknown> = { checked: false };
    if (recordingUrl) {
      const headers: Record<string, string> = {}; if (config.recordingAuthHeader) { const raw = decryptIntegrationSecret(config.recordingAuthHeader); const [name, ...rest] = raw.split(":"); if (rest.length) headers[name.trim().toLowerCase()] = rest.join(":").trim(); else headers.authorization = raw; }
      try { const response = await (options.fetchImpl ?? fetch)(recordingUrl, { method: "GET", headers: { ...headers, range: "bytes=0-1023" } }); recording = { checked: true, reachable: response.ok, http_status: response.status, content_type: response.headers.get("content-type") }; }
      catch (error) { recording = { checked: true, reachable: false, error: error instanceof Error ? error.message : String(error) }; }
    }
    const consent = truthy(get("consent")) || !config.consentRequired;
    const known = phone || leadRef ? await findDialerTarget(db, config.tenantId, leadRef, phone) : { lead: undefined, rawContact: undefined };
    const would = known.lead || known.rawContact ? (contact.hasData ? "updated" : "matched") : phone && contact.hasIdentity ? "created" : "none";
    return { status: 200, body: { ok: required.length === 0 && (recording.reachable !== false), test: true, stored: false, enabled: config.enabled, fields_found: found, fields_missing: missing, required_missing: required, recording, contact: { found: contact.found, would }, agent: agentGiven ? text(get("agent")) : null, category: contact.category ? { value: contact.category, recognised: Boolean(namedCategory), as: namedCategory?.name ?? null } : null, recommended_missing: contact.category ? [] : [mapping.category], would_evaluate: config.enabled && consent && technical.length === 0 && recording.reachable !== false, reason: !config.enabled ? "Gesprächsbewertung ist in der App ausgeschaltet" : required.length ? `Pflichtfelder fehlen: ${required.join(", ")}` : recording.reachable === false ? "Aufnahme-Link nicht abrufbar" : !consent ? `Einwilligung erforderlich – Feld „${mapping.consent}“ muss true sein` : "alles in Ordnung", transcription: transcriptionService(config) } };
  }
  if (!config.enabled) return { status: 403, body: { error: "call evaluation disabled" } };
  const externalCallId = text(get("callId")) || null;
  if (externalCallId) { const existing = (await db.select({ id: callRecords.id, status: callRecords.status }).from(callRecords).where(and(eq(callRecords.tenantId, config.tenantId), eq(callRecords.externalCallId, externalCallId))).limit(1))[0]; if (existing) return { status: 200, body: { ok: true, call_id: existing.id, duplicate: true, status: existing.status } }; }
  const target = await findDialerTarget(db, config.tenantId, leadRef, phone); const lead = target.lead; let rawContact = target.rawContact;
  const campaign = config.defaultCampaign?.trim() || text(get("campaign")) || null;
  // Kontakt-Daten übernehmen: bekannten Lead oder Kontakt ergänzen – oder (Rufnummer unbekannt, Name oder Firma da) den Kontakt anlegen
  let contactState: "created" | "updated" | "matched" | "none" = lead || rawContact ? "matched" : "none";
  try {
    if (lead) { if (contact.hasData && await fillLeadFromDialer(db, lead, contact)) contactState = "updated"; }
    else if (rawContact) { if (contact.hasData && await fillRawContactFromDialer(db, rawContact.id, contact)) contactState = "updated"; }
    else if (phone && contact.hasIdentity) { const created = await createDialerContact(db, config, { phone, campaign, contact }); if (created) { rawContact = created; contactState = "created"; } }
  } catch (error) { console.error("[Dialer] Kontakt-Daten nicht übernommen:", error instanceof Error ? error.message : error); } // das Gespräch geht deshalb nie verloren
  const consent = truthy(get("consent")) || !config.consentRequired;
  const namedCategory = await namedDialerCategory(db, config.tenantId, contact).catch(() => null); // Leadsparte laut Dialer („PV“, „WP“, „PV+WP“) – sonst erkennt die Software sie aus dem Gespräch
  // Agent laut Dialer: Er weiß sicher, wer telefoniert hat – dieser Name gilt und wird nicht mehr aus dem Gespräch „verbessert“. Reine Nummern und Füllwörter zählen nicht als Name.
  const agentRaw = text(get("agent")).replace(/\s+/g, " ").trim().slice(0, 160);
  const agentNamed = agentRaw && !isJunkAgentName(agentRaw) && /[A-Za-z\u00C0-\u024F]{2,}/.test(agentRaw) ? agentRaw : null;
  const dialerAgent = agentNamed ? (agentNamed.split(" ").length === 1 ? canonicalAgentName(agentNamed, await knownAgentNames(db, config.tenantId).catch(() => [])) || agentNamed : agentNamed) : null; // nur der Vorname: den bekannten vollen Namen nehmen
  const startedAtRaw = text(get("startedAt")); const startedAt = startedAtRaw && !Number.isNaN(new Date(startedAtRaw).getTime()) ? new Date(startedAtRaw) : new Date();
  const inserted = await db.insert(callRecords).values({ tenantId: config.tenantId, provider: config.provider, externalCallId, leadId: lead?.id ?? null, rawContactId: rawContact?.id ?? null, phone: phone || lead?.phone || null, agentName: dialerAgent ?? (isJunkAgentName(agentRaw) ? null : agentRaw || null), agentSource: dialerAgent ? "dialer" : null, leadCategoryId: namedCategory?.id ?? null, campaign, direction: /in|eingehend/i.test(text(get("direction"))) ? "eingehend" : "ausgehend", startedAt, durationSeconds: Number(get("duration")) || null, recordingUrl: recordingOf() || null, consent, consentSource: truthy(get("consent")) ? `Dialer-Feld ${mapping.consent}` : config.consentRequired ? null : "Einstellung: keine Einwilligung erforderlich", transcript: text(get("transcript")) || null, status: consent ? "eingegangen" : "ohne_einwilligung", payload: payload as never });
  const callId = Number(inserted[0]?.insertId) || 0;
  if (!consent) { if (lead) await db.insert(leadStatusEvents).values({ tenantId: config.tenantId, leadId: lead.id, previousStatus: lead.status, nextStatus: lead.status, actorUserId: null, note: "Gespräch eingegangen, aber ohne dokumentierte Einwilligung – nicht ausgewertet." }); return { status: 202, body: { ok: true, call_id: callId, lead_id: lead?.publicId ?? null, contact: contactState, evaluated: false, reason: "no consent" } }; }
  const result = await processCall(db, callId, { ...options, auto: true });
  // Lead-Nummer auch dann nennen, wenn der Kontakt erst durch die Freigabe zum Lead wurde
  const leadPublicId = lead?.publicId ?? (await db.select({ publicId: leads.publicId }).from(callRecords).innerJoin(leads, eq(leads.id, callRecords.leadId)).where(eq(callRecords.id, callId)).limit(1))[0]?.publicId ?? null;
  return { status: 200, body: { ok: true, call_id: callId, lead_id: leadPublicId, contact: contactState, evaluated: result.status === "bewertet", score: result.score, verdict: result.verdict, decision: result.decision, error: result.error } };
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
  const result = await processCall(db, callId, { ...options, auto: true });
  const record = (await db.select({ leadId: callRecords.leadId }).from(callRecords).where(eq(callRecords.id, callId)).limit(1))[0];
  return { callId, evaluated: result.status === "bewertet", decision: result.decision, leadId: record?.leadId ?? null };
}

/* ------------------------------------------------------------------ Transkription */

/** Ergebnis der Umwandlung in Text: der Text, die Dauer (wenn der Dienst sie nennt) und die Abschnitte mit ihrer Zeit. */
export type Transcription = { text: string; duration: number | null; segments: CallSegment[]; /** Dienst, der mitgeschrieben hat – daran hängen die Kosten */ service?: "openai" | "deepgram" };
/** Vermerk am Gespräch, solange es wegen der Tagesgrenze der KI wartet (shared: der Anfang steht auch in der Oberfläche). */
export const CAP_WAIT_NOTE = "Tagesgrenze der KI erreicht – das Gespräch wird von selbst bewertet, sobald wieder Budget frei ist.";
async function transcribe(config: CallQaConfig, call: CallRecord, fetchImpl: typeof fetch): Promise<Transcription> {
  const provider = config.transcriptionProvider === "auto" ? (call.transcript ? "payload" : process.env.OPENAI_API_KEY ? "openai" : process.env.DEEPGRAM_API_KEY ? "deepgram" : "payload") : config.transcriptionProvider;
  if (provider === "payload") { if (call.transcript) return { text: call.transcript, duration: null, segments: [] }; throw new Error("Kein Transkript im Payload und kein Transkriptionsdienst konfiguriert (OPENAI_API_KEY oder DEEPGRAM_API_KEY)."); }
  const { audio, contentType } = await loadRecording(config, call, fetchImpl);
  return { ...(await transcribeAudio(config, audio, contentType, fetchImpl, provider)), service: provider };
}
/** Aufnahme eines Gesprächs holen: die hochgeladene Datei oder der Link des Dialers – auch, wenn dahinter erst eine Player-Seite liegt. */
export async function loadRecording(config: Pick<CallQaConfig, "recordingAuthHeader">, call: Pick<CallRecord, "recordingUrl">, fetchImpl: typeof fetch): Promise<{ audio: Uint8Array<ArrayBuffer>; contentType: string }> {
  if (!call.recordingUrl) throw new Error("Keine Aufzeichnungs-URL übergeben.");
  if (call.recordingUrl.startsWith("file:")) return readLocalRecording(call.recordingUrl); // hochgeladene Datei (Aufnahmen per Datei testen)
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
    if (!mediaUrl) {
      // Direkt nach dem Gespräch ist die Aufnahme beim Anbieter oft noch nicht fertig – die Seite enthält dann noch keine Datei. Deshalb später automatisch erneut versuchen.
      const pageText = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
      throw Object.assign(new Error(`Die Aufnahme ist unter dem Link noch nicht abrufbar: Die Seite enthält (noch) keine Audio-Datei${pageText ? ` – dort steht: „${pageText}“` : ""}. Meist ist die Aufnahme kurz nach dem Gespräch noch nicht fertig.`), { retryable: true });
    }
    let mediaResponse: Response;
    try { mediaResponse = await fetchImpl(mediaUrl, { headers: { ...headers, referer: call.recordingUrl } }); } catch (error) { throw Object.assign(new Error(`Aufnahme-Datei hinter der Player-Seite konnte nicht geladen werden (${error instanceof Error ? error.message : String(error)}).`), { retryable: true }); }
    if (!mediaResponse.ok) throw new Error(`Aufnahme-Datei hinter der Player-Seite konnte nicht geladen werden (HTTP ${mediaResponse.status}, ${mediaUrl.slice(0, 120)}).`);
    contentType = (mediaResponse.headers.get("content-type") ?? "audio/mpeg").split(";")[0].trim() || "audio/mpeg";
    if (/^text\/html|^application\/(xhtml|json)/i.test(contentType)) throw new Error("Hinter der Player-Seite kam wieder eine Webseite statt einer Audiodatei. Bitte die Aufnahme als Datei herunterladen und hochladen.");
    audio = new Uint8Array(await mediaResponse.arrayBuffer());
  } else if (/^application\/json/i.test(contentType)) throw new Error("Der Aufnahme-Link liefert keine Audiodatei (JSON). Bitte den direkten Datei-Link verwenden oder die Datei hochladen.");
  else audio = new Uint8Array(await audioResponse.arrayBuffer());
  return { audio, contentType };
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

const PLAYBACK_EXT: Record<string, string> = { ...AUDIO_EXT, "audio/aac": "aac", "video/webm": "webm" };
const AUDIO_TYPE: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", webm: "audio/webm", mp4: "video/mp4" };
/** Zwischenablage für Aufnahmen, die beim Dialer liegen: nur zum Anhören, höchstens einen Tag. */
export const playbackDir = () => path.join(recordingsDir(), "abspielen");
export const PLAYBACK_KEEP_MS = 24 * 3_600_000;
const playbackLoads = new Map<string, Promise<{ file: string; contentType: string }>>();
let playbackPruned = 0;
/** Abgelaufene Kopien entfernen (höchstens einmal je Stunde geprüft; `force` für Tests und den Zeitplan). */
export async function prunePlaybackCache(options: { force?: boolean; now?: number } = {}): Promise<number> {
  const now = options.now ?? Date.now(); if (!options.force && now - playbackPruned < 3_600_000) return 0; playbackPruned = now;
  let removed = 0;
  for (const name of await fs.readdir(playbackDir()).catch(() => [] as string[])) { const file = path.join(playbackDir(), name); const stat = await fs.stat(file).catch(() => null); if (stat && now - stat.mtimeMs > PLAYBACK_KEEP_MS) { await fs.unlink(file).catch(() => undefined); removed += 1; } }
  return removed;
}
const playbackCopy = async (tenantId: number, callId: number) => { const prefix = `${tenantId}-${callId}.`; const name = (await fs.readdir(playbackDir()).catch(() => [] as string[])).find((item) => item.startsWith(prefix) && !item.endsWith(".teil")); return name ? path.join(playbackDir(), name) : null; };
/** Kopie eines Gesprächs aus der Zwischenablage entfernen (Gespräch gelöscht oder Aufbewahrung abgelaufen). */
export async function dropPlaybackCopy(tenantId: number, callId: number) { const file = await playbackCopy(tenantId, callId); if (file) await fs.unlink(file).catch(() => undefined); }
/**
 * Aufnahme zum Anhören – für hochgeladene Dateien die Datei selbst, für Links des Dialers eine Kopie bei uns.
 * Die Kopie braucht es, damit man in der Aufnahme vor- und zurückspulen kann: Viele Dialer liefern die Datei nur am Stück
 * oder hinter einer Player-Seite aus. Sie wird beim ersten Anhören geholt (mit dem hinterlegten Zugang), liegt nicht öffentlich
 * und wird nach einem Tag wieder entfernt. Nur für Gespräche des eigenen Mandanten.
 */
export async function recordingForPlayback(db: Db, tenantId: number, callId: number, options: { fetchImpl?: typeof fetch } = {}): Promise<{ file: string; contentType: string } | null> {
  const row = (await db.select({ recordingUrl: callRecords.recordingUrl }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.id, callId))).limit(1))[0];
  if (!row?.recordingUrl) return null;
  if (row.recordingUrl.startsWith("file:")) return localRecordingFile(db, tenantId, callId);
  await prunePlaybackCache().catch(() => 0);
  const existing = await playbackCopy(tenantId, callId);
  if (existing) return { file: existing, contentType: AUDIO_TYPE[path.extname(existing).slice(1)] ?? "audio/mpeg" };
  const key = `${tenantId}-${callId}`; const running = playbackLoads.get(key); if (running) return running; // der Browser fragt oft mehrfach gleichzeitig – nur einmal holen
  const load = (async () => {
    const config = await ensureCallQaConfig(db, tenantId);
    const { audio, contentType } = await loadRecording(config, { recordingUrl: row.recordingUrl }, options.fetchImpl ?? fetch);
    const ext = PLAYBACK_EXT[contentType.toLowerCase()] ?? (/\.(mp3|wav|m4a|aac|ogg|webm|mp4)(\?|#|$)/i.exec(row.recordingUrl ?? "")?.[1]?.toLowerCase() ?? "mp3");
    await fs.mkdir(playbackDir(), { recursive: true }); const file = path.join(playbackDir(), `${key}.${ext}`);
    await fs.writeFile(`${file}.teil`, audio); await fs.rename(`${file}.teil`, file); // erst vollständig schreiben, dann sichtbar machen
    return { file, contentType: AUDIO_TYPE[ext] ?? "audio/mpeg" };
  })();
  playbackLoads.set(key, load);
  try { return await load; } finally { playbackLoads.delete(key); }
}

/** Aufnahme in Text umwandeln. Whisper („verbose_json“) und Deepgram („utterances“) liefern die Abschnitte mit ihrer Zeit gleich mit – daraus entstehen die Zeitmarken im Gespräch. */
export async function transcribeAudio(config: Pick<CallQaConfig, "transcriptionLanguage">, audio: Uint8Array<ArrayBuffer>, contentType: string, fetchImpl: typeof fetch, provider: string): Promise<Transcription> {
  if (provider === "openai") {
    const form = new FormData(); form.append("file", new Blob([audio], { type: contentType }), "aufzeichnung.mp3"); form.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1"); form.append("language", config.transcriptionLanguage || "de"); form.append("response_format", "verbose_json");
    const response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
    const body = await response.text(); if (!response.ok) throw new Error(`Transkription (OpenAI) fehlgeschlagen: HTTP ${response.status} ${body.slice(0, 200)}`);
    try {
      const parsed = JSON.parse(body) as { text?: string; duration?: number; segments?: Array<{ start?: number; end?: number; text?: string }> };
      const segments = normalizeSegments(parsed.segments);
      const duration = typeof parsed.duration === "number" && parsed.duration > 0 ? Math.round(parsed.duration) : Array.isArray(parsed.segments) && parsed.segments.length ? Math.round(Number(parsed.segments[parsed.segments.length - 1]?.end ?? 0)) || null : null;
      if (typeof parsed.text === "string") return { text: parsed.text.trim(), duration, segments };
    } catch { /* kein JSON (z. B. Test-Stub mit reinem Text) */ }
    return { text: body.trim(), duration: null, segments: [] };
  }
  const response = await fetchImpl(`https://api.deepgram.com/v1/listen?model=nova-2&language=${encodeURIComponent(config.transcriptionLanguage || "de")}&smart_format=true&diarize=true&utterances=true`, { method: "POST", headers: { authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "content-type": contentType }, body: audio });
  const body = await response.text(); if (!response.ok) throw new Error(`Transkription (Deepgram) fehlgeschlagen: HTTP ${response.status} ${body.slice(0, 200)}`);
  try {
    const parsed = JSON.parse(body) as { metadata?: { duration?: number }; results?: { utterances?: Array<{ start?: number; end?: number; speaker: number; transcript: string }>; channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } };
    const duration = typeof parsed.metadata?.duration === "number" && parsed.metadata.duration > 0 ? Math.round(parsed.metadata.duration) : null;
    const utterances = parsed.results?.utterances;
    if (utterances?.length) return { text: utterances.map((item) => `Sprecher ${item.speaker + 1}: ${item.transcript}`).join("\n"), duration, segments: normalizeSegments(utterances) };
    return { text: parsed.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "", duration, segments: [] };
  } catch { return { text: body, duration: null, segments: [] }; }
}

/* ------------------------------------------------------------------ Zeitmarken: Stelle im Gespräch je Prüffrage und Kriterium */

/**
 * Stelle im Gespräch je Punkt: Die KI bekommt die Abschrift mit Zeitmarke am Zeilenanfang und nennt je Punkt die Zeile, in der die
 * entscheidende Stelle beginnt. Die Zeit wird an den Anfang ihres Abschnitts gezogen; was außerhalb des Gesprächs liegt, fällt weg.
 * Ohne KI (oder wenn sie nichts liefert) entscheiden die Wörter des Belegs. Gibt es keine einzelne Stelle, bleibt der Punkt ohne Zeit.
 * Die Bewertung selbst wird davon nicht berührt – die Suche läuft danach und getrennt.
 */
export async function locateMarks(segments: CallSegment[], items: MarkItem[]): Promise<Record<string, number>> {
  const marks: Record<string, number> = {}; if (!segments.length || !items.length) return marks;
  const byWords = () => { for (const item of items) { const at = locateByWords(segments, item.note); if (at !== null) marks[item.id] = at; } return marks; };
  if (!process.env.ANTHROPIC_API_KEY) return byWords();
  try {
    const fields = items.map((_, index) => `zeit_${index + 1}`);
    const properties: Record<string, unknown> = {}; fields.forEach((field, index) => { properties[field] = { type: "string", description: `Zeitmarke zu Punkt ${index + 1}, genau wie in der Abschrift (z. B. 1:31) – leer, wenn es keine einzelne Stelle gibt` }; });
    const schema = { name: "zeitmarken", schema: { type: "object", additionalProperties: false, required: fields, properties } };
    const system = `Du bekommst die Abschrift eines Telefonats. Jede Zeile beginnt mit ihrer Zeitmarke in eckigen Klammern, z. B. [1:31]. Dazu bekommst du Punkte aus der Bewertung dieses Gesprächs – jeweils mit Ergebnis und Begründung.\nNenne für jeden Punkt die Zeitmarke der Zeile, in der die entscheidende Stelle für dieses Ergebnis beginnt: dort, wo danach gefragt wird oder wo der Kunde zustimmt, ablehnt oder ausweicht. Übernimm die Zeitmarke genau so, wie sie in der Abschrift steht (z. B. 1:31). Gibt es keine einzelne Stelle – etwa weil etwas im ganzen Gespräch nicht vorkommt –, trage einen leeren Text ein. Erfinde keine Zeitmarken.\nPunkte:\n${items.map((item, index) => `- ${fields[index]}: ${item.kind} „${item.label}“ – Ergebnis: ${item.result}${item.note ? ` – Begründung: ${item.note.slice(0, 420)}` : ""}`).join("\n")}`;
    const response = await invokeLLM({ model: "fast", maxTokens: 900, messages: [{ role: "system", content: system }, { role: "user", content: `Abschrift:\n"""\n${timedTranscript(segments).slice(0, 44_000)}\n"""` }], outputSchema: schema });
    let value: unknown; try { value = JSON.parse(response.choices[0]?.message.content ?? "{}"); } catch { value = {}; }
    const read = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    if (!fields.some((field) => typeof read[field] === "string")) return byWords(); // gar nichts Verwertbares zurückgekommen
    items.forEach((item, index) => { const at = snapToSegment(segments, parseClock(read[fields[index]])); if (at !== null) marks[item.id] = at; });
    return marks;
  } catch { return byWords(); }
}

/**
 * Zeitmarken nachholen (ältere Gespräche oder Text vom Dialer): Die Aufnahme wird noch einmal in Text umgewandelt – nur, um die
 * Abschnitte mit ihrer Zeit zu bekommen. Text, Bewertung und Entscheidung des Gesprächs bleiben, wie sie sind; danach wird je
 * Prüffrage und Kriterium die Stelle gesucht. Geht es nicht (keine Aufnahme mehr, kein Dienst), wird der Grund vermerkt, damit
 * nicht bei jedem Öffnen neu versucht wird – `force` versucht es trotzdem noch einmal.
 */
export async function ensureCallTimeline(db: Db, tenantId: number, callId: number, options: { fetchImpl?: typeof fetch; force?: boolean } = {}): Promise<{ state: TimelineState; segments: number; marks: number; note: string | null }> {
  const call = (await db.select().from(callRecords).where(and(eq(callRecords.id, callId), eq(callRecords.tenantId, tenantId))).limit(1))[0];
  if (!call) throw new Error("Gespräch wurde nicht gefunden.");
  const stored = readTimeline(call.timeline);
  if (stored?.segments.length) return { state: "ok", segments: stored.segments.length, marks: Object.keys(stored.marks).length, note: null };
  if (stored && !options.force) return { state: "ohne", segments: 0, marks: 0, note: stored.note ?? null };
  const without = async (note: string) => { await db.update(callRecords).set({ timeline: { segments: [], marks: {}, note } satisfies CallTimeline }).where(eq(callRecords.id, callId)); return { state: "ohne" as const, segments: 0, marks: 0, note }; };
  if (!call.transcript) return { state: "ohne", segments: 0, marks: 0, note: "Zu diesem Gespräch gibt es noch keinen Text." }; // nichts vermerken: die Auswertung läuft vielleicht noch
  if (!call.recordingUrl) return without("Zu diesem Gespräch liegt keine Aufnahme vor.");
  const config = await ensureCallQaConfig(db, tenantId);
  if (config.consentRequired && !call.consent) return without("Ohne dokumentierte Einwilligung wird die Aufnahme nicht ausgewertet.");
  const provider = config.transcriptionProvider === "openai" || config.transcriptionProvider === "deepgram" ? config.transcriptionProvider : process.env.OPENAI_API_KEY ? "openai" : process.env.DEEPGRAM_API_KEY ? "deepgram" : null;
  if (!provider) return without("Für die Zeiten braucht es den Dienst, der Aufnahmen in Text umwandelt – er ist nicht eingerichtet.");
  let segments: CallSegment[] = [];
  try { const fetchImpl = options.fetchImpl ?? fetch; const { audio, contentType } = await loadRecording(config, call, fetchImpl); const again = await transcribeAudio(config, audio, contentType, fetchImpl, provider); segments = again.segments; void recordTranscriptionUsage(db, { service: provider, seconds: again.duration ?? call.durationSeconds }).catch(() => undefined); }
  catch (error) { return without(`Die Aufnahme ließ sich nicht auswerten: ${(error instanceof Error ? error.message : String(error)).slice(0, 160)}`); }
  if (!segments.length) return without("Der Dienst hat zu dieser Aufnahme keine Zeiten geliefert.");
  const marks = await storeCallMarks(db, call, segments, config);
  return { state: "ok", segments: segments.length, marks: Object.keys(marks).length, note: null };
}
/** Stellen je Prüffrage und Kriterium aus dem aktuellen Stand des Gesprächs suchen und zusammen mit den Abschnitten speichern. */
async function storeCallMarks(db: Db, call: CallRecord, segments: CallSegment[], config: CallQaConfig): Promise<Record<string, number>> {
  const questions = await questionsForCampaign(db, call.tenantId, call.campaign); const own = await criteriaForCampaign(db, call.tenantId, call.campaign, config);
  const scores = (Array.isArray(call.criteriaScores) ? (call.criteriaScores as Evaluation["criteria"]) : []).filter((item) => item.key !== CRITERIA_NOTE_KEY);
  const marks = await locateMarks(segments, markItems(questions, call.qualificationAnswers as Record<string, QualificationAnswer> | null, own.criteria, scores)).catch(() => ({} as Record<string, number>));
  await db.update(callRecords).set({ timeline: { segments, marks } satisfies CallTimeline }).where(eq(callRecords.id, call.id));
  return marks;
}

/* ------------------------------------------------------------------ Bewertung */

/**
 * „criteria“ enthält nur Kriterien, für die die KI wirklich Punkte geliefert hat.
 * „unscored“: Die KI hat (auch im zweiten Anlauf) gar keine Punkte geliefert – dann wird nichts als 0 gespeichert, sondern „nicht bewertet“
 * (die Entscheidung läuft trotzdem über die Prüffragen; die Punkte holt rescoreUnscoredCalls nach).
 */
export type Evaluation = { agentName?: string | null; topic?: string | null; score: number; verdict: "verkaufbar" | "nachfassen" | "nicht_verkaufbar" | "unklar"; criteria: Array<{ key: string; score: number; evidence: string }>; summary: string; redFlags: string[]; nextStep: string; extracted: Record<string, string>; unscored?: boolean; note?: string | null };
/** Eintrag in criteriaScores, der keinen Kriterien-Wert trägt, sondern den Hinweis, warum nichts bewertet wurde. */
export const CRITERIA_NOTE_KEY = "_hinweis";

/** Bekannte Agenten-Namen des Mandanten mit Anzahl Gespräche. */
async function knownAgentNames(db: Db, tenantId: number) {
  const rows = await db.select({ name: callRecords.agentName, count: sql<number>`count(*)` }).from(callRecords).where(eq(callRecords.tenantId, tenantId)).groupBy(callRecords.agentName);
  return rows.filter((row): row is { name: string; count: number } => Boolean(row.name && row.name.trim()) && !isJunkAgentName(row.name)).map((row) => ({ name: row.name, count: Number(row.count) })); // „Mein Name“ & Co. sind keine Agenten
}
/** Aufräumen (beim Start und nach jeder Bewertung): ähnlich klingende Agenten-Namen je Mandant zusammenführen – der häufigste Name bleibt. Von Hand gesetzte und vom Dialer genannte Namen werden dabei nicht umgeschrieben. */
export async function mergeSimilarAgentNames(db: Db, onlyTenantId?: number): Promise<number> {
  const tenants = onlyTenantId ? [onlyTenantId] : (await db.selectDistinct({ tenantId: callRecords.tenantId }).from(callRecords)).map((row) => row.tenantId);
  let changed = 0;
  for (const tenantId of tenants) for (const merge of agentNameMerges(await knownAgentNames(db, tenantId))) { await db.update(callRecords).set({ agentName: merge.to }).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.agentName, merge.from), or(isNull(callRecords.agentSource), and(ne(callRecords.agentSource, "manuell"), ne(callRecords.agentSource, "dialer"), ne(callRecords.agentSource, "alias"))))) /* von Hand gesetzte, vom Dialer genannte und über einen Alias zugeordnete Namen bleiben, wie sie sind */; changed += 1; }
  return changed;
}
/**
 * Alle vorhandenen Gespräche noch einmal gegen ihr Transkript prüfen: Stellt sich der Mitarbeiter dort eindeutig vor, gilt dieser Name
 * (auch wenn vorher ein anderer eingetragen war). Von Hand gesetzte und vom Dialer genannte Agenten bleiben. Danach werden ähnliche Namen zusammengeführt.
 */
export async function reassignAgentsFromTranscripts(db: Db, onlyTenantId?: number): Promise<number> {
  const tenants = onlyTenantId ? [onlyTenantId] : (await db.selectDistinct({ tenantId: callRecords.tenantId }).from(callRecords)).map((row) => row.tenantId);
  let changed = 0;
  for (const tenantId of tenants) {
    const known = await knownAgentNames(db, tenantId); const names = known.map((item) => item.name);
    const rows = await db.select({ id: callRecords.id, agentName: callRecords.agentName, agentSource: callRecords.agentSource, transcript: callRecords.transcript }).from(callRecords).where(eq(callRecords.tenantId, tenantId));
    for (const row of rows) {
      if (row.agentSource === "manuell" || row.agentSource === "dialer" || row.agentSource === "alias") continue; // von Hand gesetzt, vom Dialer genannt oder über einen Alias zugeordnet: gilt
      const stored = row.agentName?.trim() || null; const junk = Boolean(stored) && isJunkAgentName(stored); const current = junk ? null : stored; // „Mein Name“, „Woche“ … zählen als „kein Agent“
      const detected = row.transcript ? detectAgent(row.transcript, names) : null;
      const usable = detected?.sure ? canonicalAgentName(detected.name, known) : null; // nur eindeutige Vorstellungen zählen hier – alles andere prüft die KI (verifyAgentsWithAi)
      if (!usable) {
        if (junk) { await db.update(callRecords).set({ agentName: null, agentSource: null }).where(eq(callRecords.id, row.id)); changed += 1; }
        else if (row.agentSource === "transkript") await db.update(callRecords).set({ agentSource: null }).where(eq(callRecords.id, row.id)); // früher als „aus dem Transkript“ vermerkt, aus heutiger Sicht nicht eindeutig → die KI prüft den Namen nach
        continue;
      }
      const source = "transkript"; // eindeutig aus der Vorstellung – braucht keine KI-Nachprüfung mehr
      if (current && (usable === current || sameAgentName(current, usable))) { if (source !== (row.agentSource ?? null)) await db.update(callRecords).set({ agentSource: source }).where(eq(callRecords.id, row.id)); continue; } // gleiche Person (andere Schreibweise regelt das Zusammenführen)
      await db.update(callRecords).set({ agentName: usable, agentSource: source }).where(eq(callRecords.id, row.id)); changed += 1;
    }
  }
  return changed;
}
/** Die KI nach dem Namen des anrufenden Mitarbeiters fragen (nur der Gesprächsanfang). null = nicht fragbar (keine KI), "" = die KI findet keinen Namen. */
export async function askAgentName(transcript: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const schema = { name: "agentenname", schema: { type: "object", additionalProperties: false, required: ["agentName"], properties: { agentName: { type: "string", description: "Vor- und Nachname des anrufenden Mitarbeiters, so wie er sich vorstellt – leer, wenn er seinen Namen nicht nennt" } } } };
  const response = await invokeLLM({ model: "fast", maxTokens: 300, messages: [{ role: "system", content: "Du liest den Anfang eines Telefongesprächs (automatisch transkribiert, ohne Kennzeichnung der Sprecher). Ein Callcenter-Mitarbeiter ruft einen Kunden an. Nenne den Namen, mit dem sich der ANRUFENDE MITARBEITER vorstellt: Vor- und Nachname, wenn beide fallen, sonst den genannten Teil. Nicht den Namen des Kunden (der wird meist mit „Herr …“ oder „Frau …“ angesprochen oder meldet sich nur kurz mit seinem Nachnamen) und keinen Firmennamen. Nennt der Mitarbeiter seinen Namen nicht, bleibt das Feld leer – nichts raten." }, { role: "user", content: `Gesprächsanfang:\n"""\n${transcript.slice(0, 3500)}\n"""` }], outputSchema: schema });
  let parsed: unknown; try { parsed = JSON.parse(response.choices[0]?.message.content ?? "{}"); } catch { parsed = {}; }
  return cleanAgentName(String((parsed as { agentName?: unknown } | null)?.agentName ?? "")) ?? "";
}
const agentCheckAttempts = new Map<number, number>(); let agentCheckRunning = false;
/**
 * Gespräche, deren Agent noch nicht eindeutig aus der Vorstellung stammt (kein Name, Füllwort oder Name aus der früheren Erkennung),
 * von der KI prüfen lassen – ein paar pro Minute, bis alle durch sind. Von Hand gesetzte und eindeutig erkannte Agenten bleiben.
 */
export async function verifyAgentsWithAi(db: Db, options: { max?: number; tenantId?: number } = {}): Promise<{ checked: number; changed: number }> {
  if (agentCheckRunning || !process.env.ANTHROPIC_API_KEY) return { checked: 0, changed: 0 }; agentCheckRunning = true;
  try {
    const since = new Date(Date.now() - 60 * 24 * 3_600_000);
    const rows = await db.select({ id: callRecords.id, tenantId: callRecords.tenantId, agentName: callRecords.agentName, transcript: callRecords.transcript }).from(callRecords).where(and(isNull(callRecords.agentSource), gte(callRecords.createdAt, since), inArray(callRecords.status, ["bewertet", "transkribiert"] as const), ...(options.tenantId ? [eq(callRecords.tenantId, options.tenantId)] : []))).orderBy(desc(callRecords.id)).limit(400);
    const capped = await cappedCallTenants(db).catch(() => new Set<number>());
    const todo = rows.filter((row) => row.transcript && !capped.has(row.tenantId) && (agentCheckAttempts.get(row.id) ?? 0) < 2).slice(0, options.max ?? 8);
    let changed = 0; const touched = new Set<number>();
    for (const row of todo) {
      agentCheckAttempts.set(row.id, (agentCheckAttempts.get(row.id) ?? 0) + 1);
      try {
        const found = await askAgentName(row.transcript!); if (found === null) break;
        const stored = row.agentName?.trim() || null; const current = stored && !isJunkAgentName(stored) ? stored : null;
        const resolved = found ? canonicalAgentName(found, await knownAgentNames(db, row.tenantId)) : null;
        const next = resolved || current; // findet die KI keinen Namen, bleibt ein vorhandener echter Name stehen
        await db.update(callRecords).set({ agentName: next, agentSource: "ki" }).where(eq(callRecords.id, row.id));
        if (next !== stored) { changed += 1; touched.add(row.tenantId); }
      } catch (error) { console.error("[Gespräche] Agent per KI prüfen:", row.id, error instanceof Error ? error.message : error); }
    }
    for (const tenantId of Array.from(touched)) await mergeSimilarAgentNames(db, tenantId).catch(() => 0);
    return { checked: todo.length, changed };
  } finally { agentCheckRunning = false; }
}
/** Agent eines Gesprächs von Hand festlegen (bleibt bei neuer Bewertung und beim Zusammenführen erhalten); leer = wieder automatisch. */
export async function setCallAgent(db: Db, tenantId: number, callId: number, agentName: string | null) {
  const call = (await db.select({ id: callRecords.id }).from(callRecords).where(and(eq(callRecords.id, callId), eq(callRecords.tenantId, tenantId))).limit(1))[0];
  if (!call) throw new Error("Gespräch wurde nicht gefunden.");
  const name = (agentName ?? "").replace(/\s+/g, " ").trim().slice(0, 160) || null;
  await db.update(callRecords).set({ agentName: name, agentSource: name ? "manuell" : null, agentAlias: null }).where(eq(callRecords.id, callId));
  // Wurde von Hand ein Alias eingetragen, gilt der echte Name dazu (der Alias bleibt am Gespräch stehen)
  if (name) { try { const { applyAgentAliases } = await import("./agent-alias"); await applyAgentAliases(db, tenantId); } catch { /* bleibt beim eingetragenen Namen */ } }
  const final = (await db.select({ agentName: callRecords.agentName }).from(callRecords).where(eq(callRecords.id, callId)).limit(1))[0]?.agentName ?? name;
  return { success: true as const, agentName: final };
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
  // Punkte und Belege als einzelne, fest benannte Felder (punkte_<schlüssel> / beleg_<schlüssel>): Eine verschachtelte Liste hat die KI
  // gelegentlich als Text oder mit eigenen Kennungen geliefert – dann standen alle Kriterien auf 0 %.
  const scoreFields = fieldNames(criteria.map((criterion) => criterion.key), "punkte"); const evidenceFields = fieldNames(criteria.map((criterion) => criterion.key), "beleg");
  const properties: Record<string, unknown> = {
    agentName: { type: "string", description: "Name, mit dem sich der anrufende Mitarbeiter/Agent vorstellt (z. B. „Maya Becker“) – Vor- und Nachname, wenn beide fallen, sonst der genannte Teil. NICHT der Name des Kunden/Angerufenen und kein Firmenname. Leer, wenn der Mitarbeiter seinen Namen nicht nennt" },
    topic: { type: "string", description: "Worum geht es im Gespräch – das Produkt/Thema als kurzer Begriff in der Einzahl, z. B. „Photovoltaik“, „Wärmepumpe“, „Alarmanlage“, „Treppenlift“; geht es um zwei Themen, beide mit „ & “ verbinden (z. B. „Photovoltaik & Wärmepumpe“); leer, wenn unklar" },
  };
  criteria.forEach((criterion, index) => {
    properties[scoreFields[index]] = { type: "integer", minimum: 0, maximum: 10, description: `Punkte 0–10 für das Kriterium „${criterion.label}“` };
    properties[evidenceFields[index]] = { type: "string", description: `Beleg aus dem Gespräch für „${criterion.label}“ in ein bis drei vollständigen Sätzen` };
  });
  Object.assign(properties, { summary: { type: "string" }, redFlags: { type: "array", items: { type: "string" } }, nextStep: { type: "string" }, verdict: { type: "string", enum: ["verkaufbar", "nachfassen", "nicht_verkaufbar", "unklar"] }, extracted: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "value"], properties: { key: { type: "string" }, value: { type: "string" } } } } });
  const schema = { name: "gespraechsbewertung", schema: { type: "object", additionalProperties: false, required: Object.keys(properties), properties } };
  const system = `Du bewertest Verkaufsgespräche eines Callcenters, das Anfragen (Leads) für Fachbetriebe qualifiziert. Bewerte NUR anhand des Transkripts, erfinde nichts. Das Transkript stammt aus automatischer Spracherkennung: Firmen- und Eigennamen sind darin oft falsch geschrieben. Wird nach einem Namen gefragt und im Transkript steht etwas, das sich ähnlich anhört (z. B. „Haus Campus“ oder „Hauskompas“ statt „HausKompass“), gilt der Name als genannt – der Gesprächspartner versteht, was gemeint ist. Handelt es sich erkennbar um einen Rückruf (Kunde und Mitarbeiter hatten schon Kontakt), muss ein Firmenname nicht noch einmal genannt werden – kein Mangel. Schreibe Belege (evidence) vollständig aus, nie mitten im Satz abbrechen. Dass der Service für den Kunden kostenlos und unverbindlich ist, stimmt immer – sagt der Mitarbeiter das, ist es kein Mangel und kein Warnhinweis (redFlag). Bewertungskriterien (0 = gar nicht erfüllt, 10 = vollständig erfüllt). Trage für JEDES Kriterium die Punkte und einen wörtlichen Beleg aus dem Gespräch in die beiden genannten Felder ein – als einzelne Felder, nicht als Liste oder Text:\n${criteria.map((criterion, index) => `- ${criterion.key}: ${criterion.label} – ${criterion.description} → Felder ${scoreFields[index]} und ${evidenceFields[index]}`).join("\n")}\nWarnsignale (redFlags), die den Lead unverkäuflich machen: Kunde will nicht kontaktiert werden, widerruft, Daten sind falsch, Gespräch war unzulässig (Werbeanruf ohne Einwilligung), Kunde ist Minderjähriger, Agent hat Druck ausgeübt oder Falsches versprochen.\nUrteil: verkaufbar = Kunde will ein Angebot und die Weitergabe ist erlaubt; nachfassen = Interesse, aber offene Punkte; nicht_verkaufbar = kein Interesse oder Warnsignal; unklar = Transkript unvollständig.${extractFields.length ? `\nZusätzlich beantworte diese Fragen aus dem Gespräch (extracted, leer lassen wenn nicht genannt):\n${extractFields.map((field) => `- ${field.key}: ${field.question}`).join("\n")}` : "\nextracted bleibt eine leere Liste."}\nAntworte ausschließlich auf Deutsch.${config.instructions ? `\nZusätzliche Vorgaben des Mandanten: ${config.instructions}` : ""}${examples.length ? `\nBeispiele für die gewünschte Einordnung:\n${examples.slice(0, 8).map((example, index) => `Beispiel ${index + 1} (${example.title}): Auszug: "${example.transcript.slice(0, 600)}" → Urteil: ${example.verdict}. Begründung: ${example.reason}`).join("\n")}` : ""}`;
  const user = `${context.leadCategory ? `Lead-Kategorie: ${context.leadCategory}\n` : ""}${context.leadName ? `Kunde laut Lead: ${context.leadName}\n` : ""}Transkript:\n"""\n${transcript.slice(0, 60_000)}\n"""`;
  const ask = async (extra: string | null, maxTokens: number): Promise<{ value: Record<string, unknown>; truncated: boolean }> => {
    const response = await invokeLLM({ messages: [{ role: "system", content: system }, { role: "user", content: extra ? `${user}\n\n${extra}` : user }], outputSchema: schema, maxTokens });
    let value: unknown; try { value = JSON.parse(response.choices[0]?.message.content ?? "{}"); } catch { value = {}; }
    return { value: value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}, truncated: response.choices[0]?.finish_reason === "max_tokens" }; // „max_tokens“ = die Antwort wurde mittendrin abgeschnitten
  };
  const first = await ask(null, 4000);
  let parsed = first.value;
  let scored = readCriteriaScores(parsed, criteria);
  if (first.truncated || scored.length < criteria.length) {
    // Punkte fehlen (ganz oder teilweise) oder die Antwort wurde abgeschnitten: einmal ausdrücklich und mit doppelt so viel Platz nachfragen –
    // erst wenn auch dann nichts kommt, gilt das Gespräch als „nicht bewertet“
    const second = await ask(`Wichtig: Fülle für jedes Kriterium die einzelnen Felder aus (${scoreFields.slice(0, 2).join(", ")} … und ${evidenceFields.slice(0, 2).join(", ")} …) und fasse dich bei den Belegen kurz (ein bis zwei Sätze).`, 8000).catch(() => null);
    if (second) { const again = readCriteriaScores(second.value, criteria); if (again.length > scored.length || (again.length === scored.length && first.truncated && !second.truncated) || !Object.keys(parsed).length) { parsed = second.value; scored = again; } }
  }
  const unscored = scored.length === 0;
  // Gewichtete Note nur über die Kriterien, für die Punkte da sind (ein fehlendes Kriterium zählt nicht als 0)
  const scoredWeight = criteria.reduce((sum, criterion) => sum + (scored.some((item) => item.key === criterion.key) ? criterion.weight : 0), 0);
  const score = unscored || !scoredWeight ? 0 : Math.round(scored.reduce((sum, item) => sum + item.score / 10 * (criteria.find((criterion) => criterion.key === item.key)?.weight ?? 0), 0) / scoredWeight * 100);
  const redFlags = looseStrings(parsed.redFlags).slice(0, 10);
  const givenVerdict = String(parsed.verdict ?? "").trim().toLowerCase();
  const verdict = (redFlags.length ? "nicht_verkaufbar" : ["verkaufbar", "nachfassen", "nicht_verkaufbar", "unklar"].includes(givenVerdict) ? givenVerdict : unscored ? "unklar" : score >= 70 ? "verkaufbar" : score >= 40 ? "nachfassen" : "nicht_verkaufbar") as Evaluation["verdict"];
  const extracted: Record<string, string> = {};
  for (const item of looseItems(parsed.extracted)) { const key = String(item.key ?? ""); const value = String(item.value ?? "").trim(); if (key && value && extractFields.some((field) => field.key === key)) extracted[key] = value.slice(0, 500); }
  const agentName = cleanAgentName(String(parsed.agentName ?? ""));
  const topic = String(parsed.topic ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || null;
  return { score, verdict, criteria: scored, summary: String(parsed.summary ?? "").slice(0, 2000), redFlags, nextStep: String(parsed.nextStep ?? "").slice(0, 320), extracted, agentName, topic, unscored, note: unscored ? `Die KI hat für die Kriterien keine lesbaren Punkte geliefert (${describeShape(parsed)}).` : null };
}

/** Note als Text für Notizen: ohne Kriterien-Punkte steht dort nicht „0/100“. */
const scoreText = (evaluation: Pick<Evaluation, "score" | "unscored">) => (evaluation.unscored ? "ohne Kriterien-Punkte" : `${evaluation.score}/100`);
/** Entscheidungsregeln des Mandanten (erste passende Regel gewinnt), sonst Schwellenwerte. */
export function decideCall(config: Pick<CallQaConfig, "autoApproveThreshold" | "autoRejectThreshold" | "decisionRules">, evaluation: Evaluation, transcript: string, context: { dialerResult?: string | null } = {}): { decision: "freigegeben" | "pruefen" | "zurueckgewiesen"; rule: DecisionRule | null } {
  const rules = (Array.isArray(config.decisionRules) ? config.decisionRules : []) as DecisionRule[];
  for (const rule of rules.filter((item) => item.active)) {
    let actual: string | number = "";
    if (evaluation.unscored && (rule.field === "score" || rule.field.startsWith("criterion:"))) continue; // ohne Punkte greift keine Punkte-Regel
    if (rule.field === "score") actual = evaluation.score; else if (rule.field === "verdict") actual = evaluation.verdict; else if (rule.field === "redFlags") actual = evaluation.redFlags.join(" | "); else if (rule.field === "transcript") actual = transcript; else if (rule.field === "dialerResult") actual = context.dialerResult ?? ""; else if (rule.field.startsWith("criterion:")) actual = evaluation.criteria.find((item) => item.key === rule.field.slice(10))?.score ?? 0;
    const expectedNumber = Number(rule.value); const actualText = String(actual).toLowerCase(); const expectedText = rule.value.toLowerCase();
    const hit = rule.op === "gte" ? Number(actual) >= expectedNumber : rule.op === "lte" ? Number(actual) <= expectedNumber : rule.op === "eq" ? actualText === expectedText : rule.op === "contains" ? actualText.includes(expectedText) : rule.op === "any" ? actualText.trim().length > 0 : false;
    if (hit) return { decision: rule.decision, rule };
  }
  const decision = evaluation.redFlags.length ? "zurueckgewiesen" : evaluation.unscored ? "pruefen" : evaluation.score <= config.autoRejectThreshold ? "zurueckgewiesen" : evaluation.score >= config.autoApproveThreshold && evaluation.verdict === "verkaufbar" ? "freigegeben" : "pruefen";
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
  const rows = await db.select({ id: callRecords.id, error: callRecords.error, updatedAt: callRecords.updatedAt }).from(callRecords).where(and(eq(callRecords.status, "fehlgeschlagen"), gte(callRecords.createdAt, since), or(like(callRecords.error, "%Neuer Versuch folgt automatisch%"), like(callRecords.error, "%liefert eine Webseite (Player)%")))).orderBy(asc(callRecords.updatedAt)).limit(options.max ?? 10);
  let retried = 0; let done = 0;
  for (const row of rows) {
    const attempt = Number(/Versuch (\d+)\//.exec(row.error ?? "")?.[1]) || 1; const waitMs = Math.min(60, 2 ** attempt) * 60_000;
    if (Date.now() - new Date(row.updatedAt).getTime() < waitMs || retrying.has(row.id)) continue;
    retrying.add(row.id);
    try { const result = await processCall(db, row.id, { ...options, auto: true }); retried += 1; if (result.status === "bewertet") done += 1; } catch { /* bleibt fehlgeschlagen */ } finally { retrying.delete(row.id); }
  }
  return { retried, done };
}
/** Mandanten, bei denen die Tagesgrenze der KI für Gespräche gerade erreicht ist – dort ruht auch die KI im Hintergrund (Nachbewerten, Agenten prüfen, Felder nachtragen). */
export async function cappedCallTenants(db: Db): Promise<Set<number>> {
  const configs = await db.select({ tenantId: callQaConfigs.tenantId, cap: callQaConfigs.aiDailyCapCents }).from(callQaConfigs).where(gt(callQaConfigs.aiDailyCapCents, 0));
  if (!configs.length) return new Set(); const spent = (await callAiSpentToday(db)).cents;
  return new Set(configs.filter((row) => spent >= row.cap).map((row) => row.tenantId));
}
/** Gespräche, die wegen der Tagesgrenze gewartet haben, der Reihe nach bewerten – sobald wieder Budget frei ist (neuer Tag oder höhere Grenze). */
export async function resumeCappedCalls(db: Db, options: { fetchImpl?: typeof fetch; max?: number } = {}): Promise<{ resumed: number; done: number }> {
  const rows = await db.select({ id: callRecords.id, tenantId: callRecords.tenantId }).from(callRecords).where(and(inArray(callRecords.status, ["eingegangen", "transkribiert"] as const), like(callRecords.error, "Tagesgrenze der KI erreicht%"))).orderBy(asc(callRecords.createdAt)).limit(options.max ?? 5);
  if (!rows.length) return { resumed: 0, done: 0 };
  let resumed = 0; let done = 0;
  for (const row of rows) {
    if (retrying.has(row.id)) continue; retrying.add(row.id);
    try { const result = await processCall(db, row.id, { ...options, auto: true }); if (result.status === "wartet") break; resumed += 1; if (result.status === "bewertet") done += 1; } catch { /* bleibt liegen */ } finally { retrying.delete(row.id); }
  }
  return { resumed, done };
}
/** KI bei Gesprächen heute: Kosten (Abschrift und Bewertung), Obergrenze und was gerade wartet – für den Knopf „KI heute“ auf der Seite Gespräche. */
export async function callAiToday(db: Db, tenantId: number) {
  const config = await ensureCallQaConfig(db, tenantId); const spent = await callAiSpentToday(db); const capCents = config.aiDailyCapCents ?? 0;
  const waiting = (await db.select({ total: sql<number>`count(*)` }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), inArray(callRecords.status, ["eingegangen", "transkribiert"] as const), like(callRecords.error, "Tagesgrenze der KI erreicht%"))))[0]?.total ?? 0;
  const spentCents = Math.round(spent.cents); const count = Math.max(spent.evaluated, spent.transcribed);
  return { spentCents, transcriptCents: Math.round(spent.transcriptCents), ratingCents: Math.round(spent.ratingCents), calls: count, perCallCents: count ? Math.round((spent.cents / count) * 10) / 10 : null, capCents, reached: capCents > 0 && spent.cents >= capCents, waiting: Number(waiting) };
}
/** Obergrenze je Tag für die KI bei Gesprächen setzen (Euro; 0 = keine Grenze). */
export async function setCallAiCap(db: Db, tenantId: number, euros: number) {
  const config = await ensureCallQaConfig(db, tenantId); const cents = euros > 0 ? Math.max(100, Math.min(100_000, Math.round(euros * 100))) : 0;
  await db.update(callQaConfigs).set({ aiDailyCapCents: cents }).where(eq(callQaConfigs.id, config.id));
  return { capCents: cents };
}
export async function processCall(db: Db, callId: number, options: { fetchImpl?: typeof fetch; /** von selbst angestoßen (Dialer, Nachholen) – dann gilt die Tagesgrenze; was jemand anklickt, läuft immer */ auto?: boolean } = {}) {
  const call = (await db.select().from(callRecords).where(eq(callRecords.id, callId)).limit(1))[0];
  if (!call) throw new Error("Gespräch wurde nicht gefunden.");
  const config = await ensureCallQaConfig(db, call.tenantId);
  // Tagesgrenze der KI für Gespräche: Ist sie erreicht, wartet das Gespräch (es geht nichts verloren) und wird später von selbst bewertet
  if (options.auto && await callAiCapReached(db, config.aiDailyCapCents).catch(() => false)) {
    if (call.status !== "bewertet") await db.update(callRecords).set({ status: call.transcript ? "transkribiert" : "eingegangen", error: CAP_WAIT_NOTE }).where(eq(callRecords.id, callId));
    return { status: "wartet" as const, score: null, verdict: null, decision: "offen" as const, error: CAP_WAIT_NOTE };
  }
  try {
    const freshTranscript = call.status === "eingegangen" || !call.transcript;
    const transcription = freshTranscript ? await transcribe(config, call, options.fetchImpl ?? fetch) : null;
    const transcript = transcription ? transcription.text : call.transcript!;
    if (transcription?.service) void recordTranscriptionUsage(db, { service: transcription.service, seconds: transcription.duration ?? call.durationSeconds }).catch(() => undefined); // Abschrift zählt beim KI-Verbrauch mit
    // Zeitmarken: frische Abschnitte aus der Umwandlung in Text – sonst die schon gespeicherten (z. B. bei „Neu bewerten“)
    const segments = transcription?.segments.length ? transcription.segments : readTimeline(call.timeline)?.segments ?? [];
    if (!transcript.trim()) throw new Error("Transkript ist leer.");
    // Dauer aus der Transkription und Name des Mitarbeiters aus der Vorstellung („hier ist Maya Becker …“) – nur, wenn der Dialer nichts geliefert hat
    const durationSeconds = call.durationSeconds ?? transcription?.duration ?? null;
    // Agent: Die Vorstellung im Transkript gilt (auch gegenüber einem schon eingetragenen Namen) – außer der Agent wurde von Hand gesetzt oder der Dialer hat ihn genannt
    const agentManual = call.agentSource === "manuell" || call.agentSource === "dialer" || call.agentSource === "alias"; const knownAgents = agentManual ? [] : await knownAgentNames(db, call.tenantId).catch(() => []);
    const detectedAgent = agentManual ? null : detectAgent(transcript, knownAgents.map((item) => item.name));
    let agentName = call.agentName?.trim() || null; let agentSource = call.agentSource ?? null;
    if (!agentManual && isJunkAgentName(agentName)) agentName = null; // „Mein Name“ & Co. sind kein Agent
    if (detectedAgent?.sure) { const resolved = canonicalAgentName(detectedAgent.name, knownAgents); if (resolved) { agentName = resolved; agentSource = "transkript"; } } // nur eine eindeutige Vorstellung zählt sofort – sonst entscheidet gleich die KI
    await db.update(callRecords).set({ transcript, status: "transkribiert", error: null, ...(transcription?.segments.length ? { timeline: { segments, marks: {} } satisfies CallTimeline } : {}), ...(durationSeconds !== null && call.durationSeconds === null ? { durationSeconds } : {}), ...(agentName !== (call.agentName ?? null) || agentSource !== (call.agentSource ?? null) ? { agentName, agentSource } : {}) }).where(eq(callRecords.id, callId));
    const lead = call.leadId ? (await db.select().from(leads).where(eq(leads.id, call.leadId)).limit(1))[0] : undefined;
    const own = await criteriaForCampaign(db, call.tenantId, call.campaign, config); // Kriterien der Kampagne (sonst Standard)
    const evaluation = await evaluateTranscript({ ...config, criteria: own.criteria, instructions: own.instructions }, transcript, { leadName: lead ? `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() : null });
    // Keine eindeutige Vorstellung per Formel gefunden: Dann gilt der Name, den die KI im Gespräch als Mitarbeiter erkannt hat
    if (!agentManual && !detectedAgent?.sure) { const fromAi = evaluation.agentName ? canonicalAgentName(evaluation.agentName, knownAgents) : null; await db.update(callRecords).set({ agentName: fromAi || agentName, agentSource: "ki" }).where(eq(callRecords.id, callId)); } // „ki“ = von der KI geprüft (findet sie keinen Namen, bleibt ein vorhandener echter Name stehen)
    // Lead-Kategorie: Thema laut KI (sonst Stichwörter) → vorhandene Kategorie oder neue
    if (!call.leadCategoryId) { const categoryId = await resolveCallCategory(db, call.tenantId, evaluation.topic || detectTopic(transcript)).catch(() => null); if (categoryId) await db.update(callRecords).set({ leadCategoryId: categoryId }).where(eq(callRecords.id, callId)); }
    const dialer = extractDialerContact(call.payload, { ...DEFAULT_MAPPING, ...((config.fieldMapping ?? {}) as Record<string, string>) }); // Ergebnis im Dialer – für eigene Regeln
    const decided = decideCall(config, evaluation, transcript, { dialerResult: dialer.result }); let decision = decided.decision; const rule = decided.rule;
    const questions = await questionsForCampaign(db, call.tenantId, call.campaign);
    const qualificationAnswers = await answerQualification(questions, transcript);
    const byQuestions = decideByQuestions(questions, qualificationAnswers);
    const strictness = { freigegeben: 0, pruefen: 1, zurueckgewiesen: 2 } as const;
    if (byQuestions) { decision = byQuestions.decision; if (rule && strictness[decided.decision] > strictness[decision]) decision = decided.decision; } // Kampagnenfragen entscheiden; eine ausdrücklich angelegte Entscheidungsregel darf nur strenger machen
    const nextStep = [byQuestions?.reason, rule ? `Regel: ${rule.label}` : null, evaluation.nextStep].filter(Boolean).join(" · ").slice(0, 320);
    // Stelle im Gespräch je Prüffrage und Kriterium („bei 1:31“) – nur, wenn es Abschnitte mit Zeit gibt; ein Fehler dabei hält die Bewertung nicht auf
    const marks = segments.length ? await locateMarks(segments, markItems(questions, qualificationAnswers, own.criteria, evaluation.unscored ? [] : evaluation.criteria)).catch(() => ({} as Record<string, number>)) : {};
    await db.update(callRecords).set({ status: "bewertet", score: evaluation.unscored ? null : evaluation.score, verdict: evaluation.verdict, criteriaScores: evaluation.unscored ? (evaluation.note ? [{ key: CRITERIA_NOTE_KEY, score: 0, evidence: evaluation.note }] : []) : evaluation.criteria, qualificationAnswers, summary: evaluation.summary, redFlags: evaluation.redFlags, nextStep, decision, decidedBy: "automatisch", recheckFrom: null, error: null, ...(segments.length ? { timeline: { segments, marks } satisfies CallTimeline } : {}) }).where(eq(callRecords.id, callId));
    let target = lead; const fresh = { created: false }; // neu angelegter Lead: Die Regeln laufen erst, wenn die Felder aus dem Gespräch drin sind
    if (!target && call.rawContactId) {
      // Rohdaten-Kontakt: die Freigabe macht ihn zum Lead, Ablehnung verwirft ihn. Über die Regeln ausgeliefert wird nur, wenn die Auslieferung eingeschaltet ist – sonst bleibt der Lead liegen („nur empfangen“)
      if (decision === "freigegeben") { const categoryId = await dialerContactCategory(db, call.tenantId, call.rawContactId, callId); const converted = await convertRawContact(db, call.tenantId, call.rawContactId, { actorUserId: null, initialStatus: "genehmigt", note: `Gesprächsbewertung ${scoreText(evaluation)}`, skipAutomations: true, ...(categoryId ? { categoryId } : {}) }); fresh.created = !converted.alreadyConverted; await db.update(callRecords).set({ leadId: converted.leadId }).where(eq(callRecords.id, callId)); target = (await db.select().from(leads).where(eq(leads.id, converted.leadId)).limit(1))[0]; }
      else if (decision === "zurueckgewiesen") await db.update(rawContacts).set({ status: "verworfen", note: `Gesprächsbewertung ${scoreText(evaluation)}: ${evaluation.verdict}` }).where(and(eq(rawContacts.id, call.rawContactId), eq(rawContacts.status, "in_liste")));
    }
    // Grün, aber der Dialer hat keinen Kontakt mitgeschickt: Der Lead entsteht trotzdem – Name und Ort kommen aus dem Gespräch
    if (!target && !call.rawContactId && decision === "freigegeben") target = await leadFromApprovedCall(db, config, callId, { actorUserId: null, note: `Gesprächsbewertung ${scoreText(evaluation)}`, out: fresh });
    if (target) {
      if (Object.keys(evaluation.extracted).length) { const meta = target.metadata && typeof target.metadata === "object" && !Array.isArray(target.metadata) ? (target.metadata as Record<string, unknown>) : {}; await db.update(leads).set({ metadata: { ...meta, ...evaluation.extracted, callExtractedAt: new Date().toISOString() } }).where(eq(leads.id, target.id)); }
      // Freigegeben: erst die Felder der Kategorie und fehlende Kontaktangaben aus dem Gespräch in den Lead – dann erst darf er weitergeleitet werden
      if (decision === "freigegeben") await fillApprovedLead(db, call.tenantId, target.id, callId, null);
      await applyDecision(db, config, callId, target, decision, evaluation, null);
      if (fresh.created && config.autoDeliver) await runNewLeadAutomations(db, call.tenantId, target.id, null);
    }
    // Alias-Namen: Nennt der Dialer den echten Namen, wird der Name der Vorstellung gemerkt (daraus lernt die Zuordnung). Läuft das Gespräch unter einem Alias, bekommt es den echten Namen.
    try { const { aliasAfterEvaluation } = await import("./agent-alias"); await aliasAfterEvaluation(db, callId, transcript, evaluation.agentName); } catch (error) { console.error("[Gespräche] Alias-Namen:", error instanceof Error ? error.message : error); }
    await noteAfterEvaluation(db, call.tenantId, callId); // automatische Gesprächsnotiz mit Transkript (Dialer-Anrufe)
    return { status: "bewertet" as const, score: evaluation.unscored ? null : evaluation.score, verdict: evaluation.verdict, decision, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    // Aufnahme (noch) nicht abrufbar: Dialer melden das Gespräch oft, bevor die Datei fertig ist – bis zu 8 Versuche mit wachsendem Abstand (2 min … 60 min)
    const attempt = (Number(/Versuch (\d+)\//.exec(call.error ?? "")?.[1]) || 0) + 1;
    const retryable = Boolean((error as { retryable?: boolean }).retryable) && attempt <= RECORDING_RETRIES;
    await db.update(callRecords).set({ status: "fehlgeschlagen", error: retryable ? `${message} Neuer Versuch folgt automatisch (Versuch ${attempt}/${RECORDING_RETRIES}).` : message }).where(eq(callRecords.id, callId));
    return { status: "fehlgeschlagen" as const, score: null, verdict: null, decision: "offen" as const, error: message };
  }
}

async function applyDecision(db: Db, config: CallQaConfig, callId: number, lead: typeof leads.$inferSelect, decision: "freigegeben" | "pruefen" | "zurueckgewiesen", evaluation: Pick<Evaluation, "score" | "verdict" | "summary" | "unscored">, actorUserId: number | null) {
  const label = `Gesprächsbewertung ${scoreText(evaluation)} (${evaluation.verdict.replace("_", " ")})`;
  const current = (await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1))[0] ?? lead;
  let nextStatus = current.status;
  if (decision === "freigegeben" && ["neu", "hängend", "fehlerhaft"].includes(current.status)) nextStatus = "genehmigt";
  if (decision === "zurueckgewiesen" && !["zugewiesen", "reklamiert", "deaktiviert"].includes(current.status)) nextStatus = "fehlerhaft";
  if (decision === "pruefen" && current.status === "neu") nextStatus = "hängend";
  const meta = current.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata) ? (current.metadata as Record<string, unknown>) : {};
  await db.update(leads).set({ status: nextStatus, metadata: { ...meta, callScore: evaluation.score, callVerdict: evaluation.verdict, callDecision: decision, callRecordId: callId } }).where(eq(leads.id, lead.id));
  // Im Verlauf des Leads steht, welcher Agent das Gespräch geführt hat (nur intern – nicht in den Angaben, die an Käufer gehen)
  const agent = (await db.select({ agentName: callRecords.agentName }).from(callRecords).where(eq(callRecords.id, callId)).limit(1))[0]?.agentName?.trim() || null; const agentNote = agent && !isJunkAgentName(agent) ? ` · Agent: ${agent.slice(0, 80)}` : "";
  await db.insert(leadStatusEvents).values({ tenantId: config.tenantId, leadId: lead.id, previousStatus: current.status, nextStatus, actorUserId, note: `${label}: ${decision === "freigegeben" ? "freigegeben" : decision === "pruefen" ? "zur Prüfung" : "zurückgewiesen"}${agentNote}${evaluation.summary ? ` – ${evaluation.summary.slice(0, 200)}` : ""}` });
  // Freigabe = Opt-in-Nachweis: die Einwilligungsstelle aus der Abschrift herausgesucht (sofern es noch keine gültige für den Fachbetrieb gibt)
  if (decision === "freigegeben") { try { const { optInFromCallRecord } = await import("./opt-in"); await optInFromCallRecord(db, config.tenantId, callId, actorUserId); } catch (error) { console.error("[Opt-in] aus Gesprächsfreigabe nicht angelegt:", error instanceof Error ? error.message : error); } }
  if (decision === "freigegeben" && config.autoDeliver && nextStatus !== current.status) await triggerLeadAutomations(db, { tenantId: config.tenantId, actorUserId, leadId: lead.id, triggerType: "status_geändert" });
}

/* ------------------------------------------------------------------ Grünes Gespräch → Lead, auch ohne Kontakt vom Dialer */

/** Felder der Lead-Kategorie und fehlende Kontaktangaben aus dem Gespräch in den Lead schreiben. Ein Fehler (oder eine zu langsame KI) hält die Freigabe nie auf – das Nachholen im Hintergrund versucht es wieder. */
async function fillApprovedLead(db: Db, tenantId: number, leadId: number, callId: number, actorUserId: number | null, limitMs = 0): Promise<void> {
  try {
    const { fillLeadFromCall } = await import("./lead-from-call");
    const work = fillLeadFromCall(db, tenantId, leadId, { callId, actorUserId }).then(() => undefined);
    if (!limitMs) return await work;
    work.catch(() => undefined); // läuft nach der Zeitgrenze zu Ende, ohne die Freigabe aufzuhalten
    await Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, limitMs))]);
  } catch (error) { console.error("[Gespräche] Felder aus dem Gespräch nicht übernommen:", error instanceof Error ? error.message : error); }
}
/** Neuer Lead aus einem Gespräch: Die Regeln („Lead erstellt“, „Status geändert“) laufen erst jetzt – nachdem die Felder aus dem Gespräch drin sind. */
async function runNewLeadAutomations(db: Db, tenantId: number, leadId: number, actorUserId: number | null): Promise<void> {
  await triggerLeadAutomations(db, { tenantId, actorUserId, leadId, triggerType: "lead_erstellt" });
  await triggerLeadAutomations(db, { tenantId, actorUserId, leadId, triggerType: "status_geändert" });
}
/** Gespräche aus diesen Quellen sind Proben (Text eingefügt, Datei oder Link hochgeladen) – daraus entsteht von selbst kein Lead. */
const TRIAL_PROVIDERS = ["test", "datei", "link"];
/** Die KI nach dem Kunden fragen: Name, Anschrift und E-Mail, so wie sie im Gespräch fallen. Ohne KI greift die einfache Erkennung über Wörter. */
export async function askCustomerContact(transcript: string): Promise<SpokenContact> {
  const fallback = contactFromTranscript(transcript);
  if (!process.env.ANTHROPIC_API_KEY || !transcript.trim()) return fallback;
  // Sparsam: Name und Anschrift fallen am Anfang (Begrüßung) und am Ende (Daten bestätigen) – bei langen Gesprächen reichen diese beiden Stücke
  const excerpt = transcript.length > 10_000 ? `${transcript.slice(0, 4_000)}\n[…]\n${transcript.slice(-6_000)}` : transcript;
  const field = (description: string) => ({ type: "string", description });
  const schema = { name: "kunde", schema: { type: "object", additionalProperties: false, required: ["salutation", "firstName", "lastName", "street", "postcode", "city", "email"], properties: { salutation: { type: "string", enum: ["Herr", "Frau", ""], description: "Anrede des Kunden, wenn er mit „Herr …“ oder „Frau …“ angesprochen wird – sonst leer" }, firstName: field("Vorname des Kunden – leer, wenn er nicht fällt (nie „Herr“ oder „Frau“)"), lastName: field("Nachname des Kunden (ohne „Herr“/„Frau“)"), street: field("Straße mit Hausnummer des Kunden – leer, wenn nicht genannt"), postcode: field("Postleitzahl des Kunden (5 Ziffern) – leer, wenn nicht genannt"), city: field("Wohnort des Kunden – leer, wenn nicht genannt"), email: field("E-Mail-Adresse des Kunden – leer, wenn nicht genannt") } } };
  try {
    const response = await invokeLLM({ model: "fast", maxTokens: 400, messages: [{ role: "system", content: "Du liest ein Telefongespräch (automatisch transkribiert, ohne Kennzeichnung der Sprecher). Ein Callcenter-Mitarbeiter ruft einen Kunden an. Nenne die Angaben zum KUNDEN (dem Angerufenen), so wie sie im Gespräch fallen: Vorname, Nachname, Straße mit Hausnummer, Postleitzahl, Ort, E-Mail. Der Kunde wird meist mit „Herr …“ oder „Frau …“ angesprochen. Nicht den Namen des Mitarbeiters und keinen Firmennamen des Callcenters. Was nicht genannt wird, bleibt leer (leerer Text) – nichts raten, nichts ergänzen, nie „unbekannt“ oder einen Platzhalter schreiben." }, { role: "user", content: `Gespräch:\n"""\n${excerpt}\n"""` }], outputSchema: schema, purpose: "kontakt_aus_gespraech" });
    let parsed: unknown; try { parsed = JSON.parse(response.choices[0]?.message.content ?? "{}"); } catch { parsed = {}; }
    const spoken = cleanSpokenContact(parsed);
    return { ...spoken, lastName: spoken.lastName ?? (spoken.firstName ? null : fallback.lastName), postcode: spoken.postcode ?? fallback.postcode, city: spoken.city ?? fallback.city, ...(spoken.salutation ?? fallback.salutation ? { salutation: spoken.salutation ?? fallback.salutation } : {}) };
  } catch (error) { console.error("[Gespräche] Kunde aus dem Gespräch nicht gelesen:", error instanceof Error ? error.message : error); return fallback; }
}
/**
 * Ein freigegebenes Gespräch ohne Lead und ohne Kontakt bekommt seinen Lead: schon bekannte Rufnummer → dieser Lead; sonst wird der Kontakt
 * in „Kontakte vom Dialer“ angelegt (Angaben des Dialers, ergänzt um Name und Ort aus dem Gespräch) und zum Lead gemacht.
 * Fehler halten die Bewertung nie auf – das Gespräch bleibt grün, der Lead wird später nachgeholt.
 */
export async function leadFromApprovedCall(db: Db, config: CallQaConfig, callId: number, options: { actorUserId: number | null; note: string; quiet?: boolean; out?: { created: boolean } }): Promise<typeof leads.$inferSelect | undefined> {
  try {
    const call = (await db.select().from(callRecords).where(and(eq(callRecords.id, callId), eq(callRecords.tenantId, config.tenantId))).limit(1))[0];
    if (!call || call.decision !== "freigegeben" || TRIAL_PROVIDERS.includes(call.provider)) return undefined;
    if (call.leadId) return (await db.select().from(leads).where(eq(leads.id, call.leadId)).limit(1))[0];
    const phone = call.phone?.trim() || ""; if (!phone && !call.rawContactId) return undefined; // ohne Rufnummer gibt es niemanden, den man erreichen könnte
    let rawContactId = call.rawContactId;
    if (!rawContactId) {
      const known = await findDialerTarget(db, config.tenantId, "", phone);
      if (known.lead) { await db.update(callRecords).set({ leadId: known.lead.id }).where(eq(callRecords.id, call.id)); return known.lead; } // dieselbe Rufnummer: kein zweiter Lead
      if (known.rawContact) rawContactId = known.rawContact.id;
      else {
        const mapping = { ...DEFAULT_MAPPING, ...((config.fieldMapping ?? {}) as Record<string, string>) }; const fromDialer = extractDialerContact(call.payload, mapping);
        const contact = fromDialer.hasIdentity ? fromDialer : withSpokenContact(fromDialer, await askCustomerContact(call.transcript ?? ""));
        const created = await createDialerContact(db, config, { phone, campaign: call.campaign, contact }, fromDialer.hasIdentity ? "Vom Dialer gemeldet" : "Aus dem Gespräch gelesen"); if (!created) return undefined;
        rawContactId = created.id;
      }
      await db.update(callRecords).set({ rawContactId }).where(eq(callRecords.id, call.id));
    }
    const categoryId = await dialerContactCategory(db, config.tenantId, rawContactId, call.id);
    // Die Regeln („Lead erstellt“) laufen hier noch nicht: Der Aufrufer füllt erst die Felder aus dem Gespräch und leitet dann weiter (siehe out.created)
    const converted = await convertRawContact(db, config.tenantId, rawContactId, { actorUserId: options.actorUserId, initialStatus: "genehmigt", note: options.note, skipAutomations: true, ...(categoryId ? { categoryId } : {}) });
    await db.update(callRecords).set({ leadId: converted.leadId }).where(eq(callRecords.id, call.id));
    if (!converted.alreadyConverted) {
      if (options.out) options.out.created = true;
      // Nachgeholt (leise): Der Lead gehört zum Tag des Gesprächs – sonst zählten alle nachgeholten Leads als „heute neu“
      const callAt = call.startedAt ?? call.createdAt;
      if (options.quiet && callAt && callAt.getTime() < Date.now() - 30 * 60_000) await db.update(leads).set({ createdAt: callAt }).where(eq(leads.id, converted.leadId));
    }
    return (await db.select().from(leads).where(eq(leads.id, converted.leadId)).limit(1))[0];
  } catch (error) { console.error("[Gespräche] Lead aus grünem Gespräch nicht angelegt:", error instanceof Error ? error.message : error); return undefined; }
}
/** Nachholen: grüne Gespräche vom Dialer, die noch keinen Lead haben (z. B. weil der Dialer keinen Kontakt mitgeschickt hat). Leise – es wird nichts weitergeleitet. */
export async function leadsFromApprovedCalls(db: Db, options: { tenantId?: number; days?: number; max?: number } = {}): Promise<{ checked: number; leads: number }> {
  const since = new Date(Date.now() - (options.days ?? 30) * 86_400_000);
  const rows = await db.select({ id: callRecords.id, tenantId: callRecords.tenantId }).from(callRecords).where(and(eq(callRecords.decision, "freigegeben"), isNull(callRecords.leadId), gte(callRecords.createdAt, since), ...(options.tenantId ? [eq(callRecords.tenantId, options.tenantId)] : []))).orderBy(desc(callRecords.id)).limit(options.max ?? 400);
  let made = 0; const configs = new Map<number, CallQaConfig>();
  for (const row of rows) {
    const config = configs.get(row.tenantId) ?? await ensureCallQaConfig(db, row.tenantId); configs.set(row.tenantId, config);
    const call = (await db.select().from(callRecords).where(eq(callRecords.id, row.id)).limit(1))[0]; if (!call || call.leadId) continue;
    const lead = await leadFromApprovedCall(db, config, row.id, { actorUserId: null, note: "Grünes Gespräch – Lead nachgeholt", quiet: true }); if (!lead) continue;
    if (!call.rawContactId || lead.status === "genehmigt") await applyDecision(db, { ...config, autoDeliver: false }, row.id, lead, "freigegeben", { score: call.score ?? 0, unscored: call.score === null, verdict: call.verdict ?? "unklar", summary: call.summary ?? "" }, null).catch(() => undefined);
    made += 1;
  }
  return { checked: rows.length, leads: made };
}
/** Was kommt vom Dialer an? Zahlen für heute und 7 Tage, die Felder der letzten Meldung und ein Urteil in einem Satz. */
export async function dialerIntake(db: Db, tenantId: number, now: Date = new Date()) {
  const config = await ensureCallQaConfig(db, tenantId);
  const weekStart = new Date(now.getTime() - 7 * 86_400_000); const today = berlinDay(now);
  const rows = await db.select({ id: callRecords.id, createdAt: callRecords.createdAt, status: callRecords.status, decision: callRecords.decision, leadId: callRecords.leadId, rawContactId: callRecords.rawContactId }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.provider, config.provider), gte(callRecords.createdAt, weekStart))).orderBy(desc(callRecords.id)).limit(20_000);
  const count = (list: typeof rows): IntakeCounts => ({ ...EMPTY_INTAKE, received: list.length, withContact: list.filter((row) => row.rawContactId || row.leadId).length, noConsent: list.filter((row) => row.status === "ohne_einwilligung").length, failed: list.filter((row) => row.status === "fehlgeschlagen").length, approved: list.filter((row) => row.decision === "freigegeben").length, review: list.filter((row) => row.decision === "pruefen").length, rejected: list.filter((row) => row.decision === "zurueckgewiesen").length, leads: list.filter((row) => row.decision === "freigegeben" && row.leadId).length, approvedNoLead: list.filter((row) => row.decision === "freigegeben" && !row.leadId).length });
  const week = count(rows); const day = count(rows.filter((row) => berlinDay(new Date(row.createdAt)) === today));
  const last = (await db.select({ createdAt: callRecords.createdAt, payload: callRecords.payload }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.provider, config.provider))).orderBy(desc(callRecords.id)).limit(1))[0];
  const mapping = { ...DEFAULT_MAPPING, ...((config.fieldMapping ?? {}) as Record<string, string>) };
  const openEver = Number((await db.select({ n: sql<number>`count(*)` }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.decision, "freigegeben"), isNull(callRecords.leadId), sql`${callRecords.phone} is not null and ${callRecords.phone} <> ''`, ne(callRecords.provider, "test"), ne(callRecords.provider, "datei"), ne(callRecords.provider, "link"))))[0]?.n ?? 0);
  return { enabled: config.enabled, today: day, week, lastAt: last?.createdAt ?? null, fields: last ? payloadFieldNames(last.payload) : [], contact: last ? contactParts(last.payload, mapping) : null, approvedWithoutLead: openEver, verdict: intakeVerdict({ enabled: config.enabled, today: day, week, lastAt: last?.createdAt ?? null }) };
}

export async function reviewCall(db: Db, tenantId: number, userId: number, input: { callId: number; decision: "freigegeben" | "pruefen" | "zurueckgewiesen"; note?: string }) {
  const call = (await db.select().from(callRecords).where(and(eq(callRecords.id, input.callId), eq(callRecords.tenantId, tenantId))).limit(1))[0];
  if (!call) throw new Error("Gespräch wurde nicht gefunden.");
  const config = await ensureCallQaConfig(db, tenantId);
  await db.update(callRecords).set({ decision: input.decision, decidedBy: "manuell", reviewedByUserId: userId, reviewedAt: new Date(), reviewNote: input.note?.slice(0, 500) ?? null, recheckFrom: null }).where(eq(callRecords.id, call.id));
  let lead = call.leadId ? (await db.select().from(leads).where(eq(leads.id, call.leadId)).limit(1))[0] : undefined; const fresh = { created: false };
  if (!lead && call.rawContactId) {
    if (input.decision === "freigegeben") { const categoryId = await dialerContactCategory(db, tenantId, call.rawContactId, call.id); const converted = await convertRawContact(db, tenantId, call.rawContactId, { actorUserId: userId, initialStatus: "genehmigt", note: `Manuelle Freigabe${input.note ? `: ${input.note}` : ""}`, skipAutomations: true, ...(categoryId ? { categoryId } : {}) }); fresh.created = !converted.alreadyConverted; await db.update(callRecords).set({ leadId: converted.leadId }).where(eq(callRecords.id, call.id)); lead = (await db.select().from(leads).where(eq(leads.id, converted.leadId)).limit(1))[0]; }
    else if (input.decision === "zurueckgewiesen") await db.update(rawContacts).set({ status: "verworfen", note: `Manuell zurückgewiesen${input.note ? `: ${input.note}` : ""}` }).where(and(eq(rawContacts.id, call.rawContactId), inArray(rawContacts.status, ["neu", "in_liste"])));
  }
  if (!lead && !call.rawContactId && input.decision === "freigegeben") lead = await leadFromApprovedCall(db, config, call.id, { actorUserId: userId, note: `Manuelle Freigabe${input.note ? `: ${input.note}` : ""}`, out: fresh });
  if (lead) {
    // Freigabe von Hand: Felder aus dem Gespräch übernehmen (höchstens 12 Sekunden warten – sonst holt der Hintergrund es nach), dann erst weiterleiten
    if (input.decision === "freigegeben") await fillApprovedLead(db, tenantId, lead.id, call.id, userId, 12_000);
    await applyDecision(db, config, call.id, lead, input.decision, { score: call.score ?? 0, unscored: call.score === null, verdict: call.verdict ?? "unklar", summary: input.note ?? call.summary ?? "" }, userId);
    if (fresh.created && config.autoDeliver) await runNewLeadAutomations(db, tenantId, lead.id, userId);
  }
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
  // Landen neue Gespräche vom Dialer in dieser Kampagne, gilt das auch unter dem neuen Namen
  await db.update(callQaConfigs).set({ defaultCampaign: to }).where(and(eq(callQaConfigs.tenantId, tenantId), eq(callQaConfigs.defaultCampaign, from)));
  return { calls, merged: Boolean(existing) };
}

/**
 * Vorlagen nachziehen: Einstellungen, die unverändert aus einer Vorlage stammen (presetKey), bekommen beim Start die aktuelle Fassung
 * (Texte, Vorgaben, Fragen) – Gewichte bleiben. Was der Mandant selbst geändert hat, wird nie überschrieben.
 * Fehlt der Bezug noch (ältere Daten), wird er einmalig gesetzt, wenn der Inhalt genau einer Vorlage entspricht.
 */
export async function refreshPresetConfigs(db: Db): Promise<number> {
  const rows = await db.select({ id: callQaConfigs.id, criteria: callQaConfigs.criteria, instructions: callQaConfigs.instructions, defaultQuestions: callQaConfigs.defaultQuestions, presetKey: callQaConfigs.presetKey }).from(callQaConfigs);
  let changed = 0;
  for (const row of rows) {
    const current = (Array.isArray(row.criteria) ? row.criteria : []) as Criterion[];
    let preset = row.presetKey ? presetByKey(row.presetKey) : undefined;
    if (!row.presetKey) {
      preset = CALL_QA_PRESETS.find((candidate) => criteriaTextsEqual(current, candidate.criteria) && (row.instructions ?? "") === candidate.instructions && (row.defaultQuestions === null || row.defaultQuestions === undefined || questionsEqual(row.defaultQuestions, candidate.questions)));
      if (preset) await db.update(callQaConfigs).set({ presetKey: preset.key }).where(eq(callQaConfigs.id, row.id));
    }
    if (!preset) continue;
    const merged = preset.criteria.map((criterion) => ({ ...criterion, weight: current.find((item) => item.key === criterion.key)?.weight ?? criterion.weight }));
    if (JSON.stringify(merged) === JSON.stringify(current) && row.instructions === preset.instructions && questionsEqual(row.defaultQuestions, preset.questions)) continue;
    await db.update(callQaConfigs).set({ criteria: merged, instructions: preset.instructions, defaultQuestions: preset.questions }).where(eq(callQaConfigs.id, row.id));
    changed += 1;
  }
  return changed + (await refreshCampaignPresets(db));
}
/** Dasselbe für Kampagnen: Fragen, Kriterien-Texte und Vorgaben folgen der Vorlage, solange der Mandant sie nicht selbst geändert hat. */
export async function refreshCampaignPresets(db: Db): Promise<number> {
  let changed = 0;
  for (const campaign of await db.select({ id: callQaCampaigns.id, questions: callQaCampaigns.questions, criteria: callQaCampaigns.criteria, instructions: callQaCampaigns.instructions, presetKey: callQaCampaigns.presetKey }).from(callQaCampaigns)) {
    const qs = normalizeQuestions(campaign.questions as QualificationQuestion[] | null);
    const own = (Array.isArray(campaign.criteria) ? campaign.criteria : []) as Criterion[];
    let preset = campaign.presetKey ? presetByKey(campaign.presetKey) : undefined;
    if (!campaign.presetKey) {
      preset = CALL_QA_PRESETS.find((candidate) => questionsEqual(qs, candidate.questions) && (!own.length || criteriaTextsEqual(own, candidate.criteria)) && (!campaign.instructions || campaign.instructions === candidate.instructions));
      if (preset) await db.update(callQaCampaigns).set({ presetKey: preset.key }).where(eq(callQaCampaigns.id, campaign.id));
    }
    if (!preset) continue;
    const update: { questions?: QualificationQuestion[]; criteria?: Criterion[]; instructions?: string } = {};
    if (!questionsEqual(qs, preset.questions)) update.questions = preset.questions;
    // Kriterien nur anfassen, wenn sie aus dieser Vorlage stammen (gestrichene dürfen noch dabei sein und fallen weg – dann gelten die Gewichte der Vorlage)
    const presetKeys = new Set(preset.criteria.map((criterion) => criterion.key)); const retired = new Set(preset.retiredCriteriaKeys ?? []);
    if (own.length && own.every((criterion) => presetKeys.has(criterion.key) || retired.has(criterion.key))) {
      const dropped = own.some((criterion) => retired.has(criterion.key));
      const merged = preset.criteria.map((criterion) => ({ ...criterion, weight: dropped ? criterion.weight : own.find((item) => item.key === criterion.key)?.weight ?? criterion.weight }));
      if (JSON.stringify(merged) !== JSON.stringify(own)) update.criteria = merged;
      if (campaign.instructions && campaign.instructions !== preset.instructions) update.instructions = preset.instructions;
    }
    if (Object.keys(update).length) { await db.update(callQaCampaigns).set(update).where(eq(callQaCampaigns.id, campaign.id)); changed += 1; }
  }
  return changed;
}
/** „Bewertet“, aber ohne Kriterien-Punkte: Note fehlt – oder alle Kriterien stehen ohne Beleg auf 0 (so sah der frühere Lesefehler aus). */
export function criteriaUnscored(row: { score: number | null; criteriaScores: unknown }): boolean {
  if (row.score === null) return true;
  const entries = (Array.isArray(row.criteriaScores) ? row.criteriaScores : []).filter((item): item is { key?: string; score?: unknown; evidence?: unknown } => Boolean(item) && typeof item === "object" && (item as { key?: string }).key !== CRITERIA_NOTE_KEY);
  return row.score === 0 && entries.every((item) => !Number(item.score) && !String(item.evidence ?? "").trim());
}
const rescoreAttempts = new Map<number, number>(); let rescoreRunning = false;
/**
 * Kriterien-Punkte nachholen: nur Note und Kriterien werden neu berechnet – Entscheidung, Prüffragen und Auslieferung bleiben unberührt.
 * Läuft im Minutentakt mit ein paar Gesprächen, bis alle nachgezogen sind (höchstens 3 Anläufe je Gespräch).
 */
export async function rescoreUnscoredCalls(db: Db, options: { max?: number; tenantId?: number } = {}): Promise<{ tried: number; rescored: number }> {
  if (rescoreRunning) return { tried: 0, rescored: 0 }; rescoreRunning = true;
  try {
    const since = new Date(Date.now() - 30 * 24 * 3_600_000);
    const rows = await db.select({ id: callRecords.id, tenantId: callRecords.tenantId, campaign: callRecords.campaign, transcript: callRecords.transcript, score: callRecords.score, criteriaScores: callRecords.criteriaScores }).from(callRecords).where(and(eq(callRecords.status, "bewertet"), gte(callRecords.createdAt, since), or(isNull(callRecords.score), eq(callRecords.score, 0)), ...(options.tenantId ? [eq(callRecords.tenantId, options.tenantId)] : []))).orderBy(desc(callRecords.id)).limit(500);
    const capped = await cappedCallTenants(db).catch(() => new Set<number>());
    const todo = rows.filter((row) => row.transcript && !capped.has(row.tenantId) && criteriaUnscored(row) && (rescoreAttempts.get(row.id) ?? 0) < 3).slice(0, options.max ?? 6);
    let rescored = 0;
    for (const row of todo) {
      rescoreAttempts.set(row.id, (rescoreAttempts.get(row.id) ?? 0) + 1);
      try {
        const config = await ensureCallQaConfig(db, row.tenantId); const own = await criteriaForCampaign(db, row.tenantId, row.campaign, config);
        const evaluation = await evaluateTranscript({ ...config, criteria: own.criteria, instructions: own.instructions }, row.transcript!, {});
        if (evaluation.unscored) { await db.update(callRecords).set({ score: null, criteriaScores: evaluation.note ? [{ key: CRITERIA_NOTE_KEY, score: 0, evidence: evaluation.note }] : [] }).where(eq(callRecords.id, row.id)); continue; }
        await db.update(callRecords).set({ score: evaluation.score, criteriaScores: evaluation.criteria }).where(eq(callRecords.id, row.id)); rescored += 1;
        // die Kriterien sind jetzt da: ihre Stellen im Gespräch nachtragen (nur, wenn es Abschnitte mit Zeit gibt)
        const fresh = (await db.select().from(callRecords).where(eq(callRecords.id, row.id)).limit(1))[0]; const segments = fresh ? readTimeline(fresh.timeline)?.segments ?? [] : [];
        if (fresh && segments.length) await storeCallMarks(db, fresh, segments, config).catch(() => undefined);
      } catch (error) { console.error("[Gespräche] Kriterien nachbewerten:", row.id, error instanceof Error ? error.message : error); }
    }
    return { tried: todo.length, rescored };
  } finally { rescoreRunning = false; }
}
/** Mehrere Gespräche neu bewerten (z. B. nach geänderten Regeln): läuft nacheinander im Hintergrund, die Liste zeigt den Fortschritt. */
/* ------------------------------------------------------------------ Prüffragen bei älteren Gesprächen nachholen */

/**
 * Kommt eine Prüffrage dazu (z. B. „bis zu 3 Angebote von Fachpartnern“ in der Vorlage HausKompass) oder bekommt eine Kampagne andere Fragen,
 * fehlt älteren Gesprächen die Antwort darauf. Der Zeitplaner holt sie nach und nach nach – nur die fehlenden Fragen, ein kleiner KI-Aufruf je Gespräch.
 * Regeln: Die Entscheidung wird dabei nur strenger, nie lockerer. Von Hand entschiedene Gespräche bekommen die Antwort, behalten aber ihre Entscheidung.
 * Ändert sich die Entscheidung, folgt der Lead: zurückgewiesen → „Fehlerhaft“, zur Prüfung → „Hängend“. Schon ausgelieferte Leads bleiben, wie sie sind (nur ein Vermerk im Verlauf).
 */
export const RECHECK_PER_RUN = 12;
let rechecking = false; const recheckFailures = new Map<number, number>();
const DECISION_RANK: Record<string, number> = { offen: 0, freigegeben: 0, pruefen: 1, zurueckgewiesen: 2 };
const DECISION_WORD: Record<string, string> = { freigegeben: "freigegeben", pruefen: "zur Prüfung", zurueckgewiesen: "zurückgewiesen", offen: "offen" };
const LEAD_STATUS_WORD: Record<string, string> = { fehlerhaft: "Fehlerhaft", hängend: "Hängend" };
type RecheckCandidate = { id: number; tenantId: number; questions: QualificationQuestion[]; missing: QualificationQuestion[] };
const answersOf = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, QualificationAnswer> : {});
/** Bewertete Gespräche (mit Text), denen die Antwort auf eine heute gültige Prüffrage ihrer Kampagne fehlt – neueste zuerst. */
export async function callsMissingAnswers(db: Db, options: { tenantId?: number; limit?: number } = {}): Promise<RecheckCandidate[]> {
  const conditions = [eq(callRecords.status, "bewertet"), isNotNull(callRecords.transcript)]; if (options.tenantId) conditions.push(eq(callRecords.tenantId, options.tenantId));
  const rows = await db.select({ id: callRecords.id, tenantId: callRecords.tenantId, campaign: callRecords.campaign, answers: callRecords.qualificationAnswers }).from(callRecords).where(and(...conditions)).orderBy(desc(callRecords.id));
  const sets = new Map<number, { defaults: QualificationQuestion[]; campaigns: Map<string, QualificationQuestion[]> }>();
  const out: RecheckCandidate[] = [];
  for (const row of rows) {
    let set = sets.get(row.tenantId);
    if (!set) { const campaigns = new Map<string, QualificationQuestion[]>(); for (const item of await db.select({ name: callQaCampaigns.name, questions: callQaCampaigns.questions }).from(callQaCampaigns).where(eq(callQaCampaigns.tenantId, row.tenantId))) { const qs = normalizeQuestions(item.questions as QualificationQuestion[] | null); if (qs.length) campaigns.set(item.name, qs); } set = { defaults: await defaultQuestionsFor(db, row.tenantId), campaigns }; sets.set(row.tenantId, set); }
    const questions = (row.campaign ? set.campaigns.get(row.campaign) : undefined) ?? set.defaults; const answers = answersOf(row.answers);
    const missing = questions.filter((question) => !answers[question.key]);
    if (missing.length) { out.push({ id: row.id, tenantId: row.tenantId, questions, missing }); if (options.limit && out.length >= options.limit) break; }
  }
  return out;
}
/** Ein Gespräch nachprüfen: fehlende Antworten holen, Entscheidung höchstens strenger machen, den Lead nachziehen. */
async function recheckCall(db: Db, candidate: RecheckCandidate, strict: boolean): Promise<{ changed: boolean }> {
  const call = (await db.select().from(callRecords).where(eq(callRecords.id, candidate.id)).limit(1))[0]; if (!call || call.status !== "bewertet" || !call.transcript) return { changed: false };
  const answered = await answerQualification(candidate.missing, call.transcript, { strict });
  // frisch lesen: Während die KI gelesen hat, kann jemand das Gespräch von Hand entschieden oder eine Antwort geändert haben – dann gilt das
  const fresh = (await db.select().from(callRecords).where(eq(callRecords.id, candidate.id)).limit(1))[0]; if (!fresh || fresh.status !== "bewertet") return { changed: false };
  const current = answersOf(fresh.qualificationAnswers); const next: Record<string, QualificationAnswer> = { ...current };
  for (const question of candidate.missing) if (!next[question.key] && answered[question.key]) next[question.key] = answered[question.key];
  // Nur die neu beantworteten Fragen entscheiden mit – die alten Antworten und die Entscheidung daraus bleiben, wie sie waren
  const added = candidate.missing.filter((question) => !current[question.key] && next[question.key]);
  const by = fresh.decidedBy === "manuell" || !added.length ? null : decideByQuestions(added, next);
  const stricter = Boolean(by && (DECISION_RANK[by.decision] ?? 0) > (DECISION_RANK[fresh.decision] ?? 0));
  const decision = stricter ? by!.decision : fresh.decision;
  await db.update(callRecords).set({ qualificationAnswers: next, recheckedAt: new Date(), ...(stricter ? { decision, decidedBy: "automatisch" as const, recheckFrom: fresh.decision, nextStep: `Nachprüfung: ${by!.reason}`.slice(0, 320) } : {}) }).where(eq(callRecords.id, fresh.id));
  if (!stricter) return { changed: false };
  if (fresh.leadId) {
    const lead = (await db.select().from(leads).where(eq(leads.id, fresh.leadId)).limit(1))[0];
    if (lead) {
      const delivered = ["zugewiesen", "reklamiert"].includes(lead.status);
      let nextStatus = lead.status;
      if (!delivered && lead.status !== "deaktiviert") { if (decision === "zurueckgewiesen") nextStatus = "fehlerhaft"; else if (decision === "pruefen" && ["neu", "genehmigt"].includes(lead.status)) nextStatus = "hängend"; }
      const meta = lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata) ? (lead.metadata as Record<string, unknown>) : {};
      await db.update(leads).set({ status: nextStatus, metadata: { ...meta, callDecision: decision } }).where(eq(leads.id, lead.id));
      const tail = delivered ? " – der Lead war schon ausgeliefert und bleibt unverändert" : nextStatus !== lead.status ? ` – Lead jetzt „${LEAD_STATUS_WORD[nextStatus] ?? nextStatus}“` : "";
      await db.insert(leadStatusEvents).values({ tenantId: fresh.tenantId, leadId: lead.id, previousStatus: lead.status, nextStatus, actorUserId: null, note: `Nachprüfung des Gesprächs: ${by!.reason} → ${DECISION_WORD[decision]}${tail}`.slice(0, 500) });
    }
  } else if (fresh.rawContactId && decision === "zurueckgewiesen") {
    await db.update(rawContacts).set({ status: "verworfen", note: `Nachprüfung des Gesprächs: ${by!.reason}`.slice(0, 500) }).where(and(eq(rawContacts.id, fresh.rawContactId), eq(rawContacts.status, "in_liste")));
  }
  return { changed: true };
}
/** Läuft im Minutentakt: ein paar Gespräche je Lauf. Bei erreichter Tagesgrenze der KI ruht es. Klappt die KI nicht, wird es später noch einmal versucht – nach zwei Fehlversuchen gelten die Stichwort-Regeln. */
export async function recheckCallAnswers(db: Db, options: { tenantId?: number; max?: number } = {}): Promise<{ checked: number; changed: number }> {
  if (rechecking) return { checked: 0, changed: 0 }; rechecking = true;
  try {
    const capped = await cappedCallTenants(db).catch(() => new Set<number>()); const max = options.max ?? RECHECK_PER_RUN;
    const todo = (await callsMissingAnswers(db, { tenantId: options.tenantId, limit: max + capped.size * 200 + 50 })).filter((item) => !capped.has(item.tenantId)).slice(0, max);
    let checked = 0; let changed = 0;
    for (const item of todo) {
      try { const result = await recheckCall(db, item, (recheckFailures.get(item.id) ?? 0) < 2); checked += 1; if (result.changed) changed += 1; recheckFailures.delete(item.id); }
      catch (error) { recheckFailures.set(item.id, (recheckFailures.get(item.id) ?? 0) + 1); console.error("[Gespräche] Prüffragen nachholen:", item.id, error instanceof Error ? error.message : error); }
    }
    return { checked, changed };
  } finally { rechecking = false; }
}
/** Stand der Nachprüfung für die Seite Gespräche: was noch wartet (und welche Fragen), was sich geändert hat. */
export async function callRecheckStatus(db: Db, tenantId: number) {
  const waiting = await callsMissingAnswers(db, { tenantId });
  const counts = new Map<string, number>(); for (const item of waiting) for (const question of item.missing) counts.set(question.label, (counts.get(question.label) ?? 0) + 1);
  const questions = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, calls]) => ({ label, calls }));
  const changedRows = await db.select({ decision: callRecords.decision, leadStatus: leads.status }).from(callRecords).leftJoin(leads, eq(leads.id, callRecords.leadId)).where(and(eq(callRecords.tenantId, tenantId), isNotNull(callRecords.recheckFrom)));
  const capped = (await cappedCallTenants(db).catch(() => new Set<number>())).has(tenantId);
  return {
    waiting: waiting.length, questions, questionCount: counts.size, perMinute: RECHECK_PER_RUN, paused: capped,
    changed: { total: changedRows.length, rejected: changedRows.filter((row) => row.decision === "zurueckgewiesen").length, review: changedRows.filter((row) => row.decision === "pruefen").length, leadsHeld: changedRows.filter((row) => row.leadStatus === "fehlerhaft" || row.leadStatus === "hängend").length, delivered: changedRows.filter((row) => row.leadStatus === "zugewiesen" || row.leadStatus === "reklamiert").length },
  };
}
export async function reevaluateCalls(db: Db, tenantId: number, callIds: number[], options: { fetchImpl?: typeof fetch; waitFor?: boolean } = {}) {
  const ids = Array.from(new Set(callIds)).slice(0, 300); if (!ids.length) return { queued: 0 };
  const rows = await db.select({ id: callRecords.id, transcript: callRecords.transcript, status: callRecords.status }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), inArray(callRecords.id, ids)));
  const todo = rows.filter((row) => row.status !== "ohne_einwilligung");
  for (const row of todo) await db.update(callRecords).set({ status: row.transcript ? "transkribiert" : "eingegangen", error: null }).where(eq(callRecords.id, row.id));
  const run = async () => { for (const row of todo) { try { await processCall(db, row.id, options); } catch (error) { console.error("[Gespräche] Neu bewerten:", row.id, error instanceof Error ? error.message : error); } } };
  if (options.waitFor) await run(); else void run();
  return { queued: todo.length };
}
/**
 * Einmaliges Nachziehen: Früher wurden Begründungen nach 240 (Fragen) bzw. 500 Zeichen (Kriterien) abgeschnitten gespeichert.
 * Solche Gespräche werden neu bewertet, damit der Text vollständig ist – nur automatisch entschiedene Gespräche ohne Lead/Kontakt (keine Auslieferung möglich).
 */
export async function refillTruncatedCalls(db: Db, options: { fetchImpl?: typeof fetch; waitFor?: boolean; max?: number } = {}): Promise<number> {
  const since = new Date(Date.now() - 21 * 24 * 3_600_000);
  const rows = await db.select({ id: callRecords.id, tenantId: callRecords.tenantId, answers: callRecords.qualificationAnswers, scores: callRecords.criteriaScores, decidedBy: callRecords.decidedBy, leadId: callRecords.leadId, rawContactId: callRecords.rawContactId, transcript: callRecords.transcript }).from(callRecords).where(and(eq(callRecords.status, "bewertet"), gte(callRecords.createdAt, since)));
  const cut = (text: unknown, limit: number) => typeof text === "string" && text.length >= limit - 2 && text.length <= limit;
  const todo = rows.filter((row) => row.transcript && row.decidedBy !== "manuell" && !row.leadId && !row.rawContactId && (Object.values((row.answers ?? {}) as Record<string, QualificationAnswer>).some((answer) => cut(answer?.note, 240)) || (Array.isArray(row.scores) ? row.scores as Array<{ evidence?: string }> : []).some((score) => cut(score?.evidence, 500)))).slice(0, options.max ?? 80);
  const run = async () => { for (const row of todo) { try { await processCall(db, row.id, { ...options, auto: true }); } catch (error) { console.error("[Gespräche] Begründung nachziehen:", row.id, error instanceof Error ? error.message : error); } } };
  if (options.waitFor) await run(); else void run();
  return todo.length;
}
/** In welche Kampagne neue Gespräche vom Dialer einsortiert werden (leer = Kampagne, die der Dialer mitschickt). */
export async function setDefaultCampaign(db: Db, tenantId: number, campaign: string | null) {
  const config = await ensureCallQaConfig(db, tenantId); const name = (campaign ?? "").trim().slice(0, 160) || null;
  await db.update(callQaConfigs).set({ defaultCampaign: name }).where(eq(callQaConfigs.id, config.id));
  return { success: true as const, defaultCampaign: name };
}

/**
 * Einmalige Einrichtung (gewünscht, 19.11.2026): Leads vom Dialer erst einmal nur empfangen. Bei jeder Gesprächsbewertung, die es an
 * diesem Tag schon gab, wird die Auslieferung nach der Freigabe einmal ausgeschaltet – freigegebene Leads bleiben liegen, bis sie von Hand
 * weitergegeben werden. Danach gehört der Schalter dem Mandanten: Wieder einschalten bleibt (Merker `receiveOnly`). Später angelegte
 * Mandanten sind nicht betroffen.
 */
export const RECEIVE_ONLY_BEFORE = new Date("2026-11-21T00:00:00Z");
export async function ensureReceiveOnly(db: Db, before: Date = RECEIVE_ONLY_BEFORE): Promise<number> {
  let changed = 0;
  for (const row of await db.select({ id: callQaConfigs.id, autoDeliver: callQaConfigs.autoDeliver, setupMarks: callQaConfigs.setupMarks, createdAt: callQaConfigs.createdAt }).from(callQaConfigs)) {
    const marks = (row.setupMarks && typeof row.setupMarks === "object" && !Array.isArray(row.setupMarks) ? row.setupMarks : {}) as Record<string, string>;
    if (marks.receiveOnly || row.createdAt.getTime() >= before.getTime()) continue;
    await db.update(callQaConfigs).set({ autoDeliver: false, setupMarks: { ...marks, receiveOnly: new Date().toISOString() } }).where(eq(callQaConfigs.id, row.id));
    if (row.autoDeliver) changed += 1;
  }
  return changed;
}

/** Einmalige Einrichtung (gewünscht): Kampagne „Wattfox PV und WP“ mit den Regeln der Vorlage – Gespräche aus „Wattfox PV“ hängen um. Nur bei Mandanten, die die Vorlage nutzen. */
export const WATTFOX_CAMPAIGN = "Wattfox PV und WP";
export async function ensureWattfoxCampaign(db: Db): Promise<number> {
  const old = presetByKey("pv-hauskompass")!; const preset = presetByKey("wattfox-pv-wp")!; let changed = 0;
  const oldKeys = new Set(old.questions.map((question) => question.key));
  for (const row of await db.select({ id: callQaConfigs.id, tenantId: callQaConfigs.tenantId, provider: callQaConfigs.provider, criteria: callQaConfigs.criteria, defaultCampaign: callQaConfigs.defaultCampaign, setupMarks: callQaConfigs.setupMarks }).from(callQaConfigs)) {
    // Einmalig je Mandant: Danach gehört die Kampagne ihm – umbenennen, ändern oder löschen wird nie wieder rückgängig gemacht
    const marks = (row.setupMarks && typeof row.setupMarks === "object" && !Array.isArray(row.setupMarks) ? row.setupMarks : {}) as Record<string, string>;
    if (marks.wattfox) continue;
    const done = async () => { await db.update(callQaConfigs).set({ setupMarks: { ...marks, wattfox: new Date().toISOString() } }).where(eq(callQaConfigs.id, row.id)); };
    const keys = new Set(((Array.isArray(row.criteria) ? row.criteria : []) as Criterion[]).map((c) => c.key)); if (!old.criteria.every((c) => keys.has(c.key))) continue; // nur Mandanten mit der HausKompass-Vorlage
    const campaigns = await db.select({ id: callQaCampaigns.id, name: callQaCampaigns.name, questions: callQaCampaigns.questions, presetKey: callQaCampaigns.presetKey }).from(callQaCampaigns).where(eq(callQaCampaigns.tenantId, row.tenantId));
    const existing = campaigns.find((campaign) => campaign.name === WATTFOX_CAMPAIGN);
    const rules = { questions: preset.questions, criteria: preset.criteria, instructions: preset.instructions, presetKey: preset.key };
    if (existing) {
      // Schon eingerichtet: nur umstellen, solange die Kampagne noch die alten Vorlagen-Fragen hat (danach macht der Mandant es selbst)
      const qs = normalizeQuestions(existing.questions as QualificationQuestion[] | null); const stillOld = qs.length > 0 && qs.every((question) => oldKeys.has(question.key)) && qs.some((question) => !preset.questions.some((item) => item.key === question.key));
      if (!stillOld) { await done(); continue; }
      await db.update(callQaCampaigns).set(rules).where(eq(callQaCampaigns.id, existing.id));
    } else {
      // Bereits unter anderem Namen eingerichtet (umbenannt) oder eine Ziel-Kampagne gewählt? Dann nichts mehr anlegen oder verschieben.
      const renamed = campaigns.filter((campaign) => campaign.presetKey === preset.key || questionsEqual(campaign.questions, preset.questions));
      if (row.defaultCampaign === WATTFOX_CAMPAIGN && renamed.length === 1) {
        // Reparatur: Früher nahm das Umbenennen das Ziel für neue Dialer-Gespräche nicht mit – sie landeten weiter unter dem alten Namen (ohne Regeln).
        // Ziel auf den neuen Namen stellen und die seither eingegangenen Gespräche dorthin holen; automatisch entschiedene ohne Lead werden nach den richtigen Regeln neu bewertet.
        const target = renamed[0].name;
        const stray = await db.select({ id: callRecords.id, leadId: callRecords.leadId, rawContactId: callRecords.rawContactId, decidedBy: callRecords.decidedBy }).from(callRecords).where(and(eq(callRecords.tenantId, row.tenantId), eq(callRecords.campaign, WATTFOX_CAMPAIGN)));
        await db.update(callQaConfigs).set({ defaultCampaign: target }).where(eq(callQaConfigs.id, row.id));
        if (stray.length) { await db.update(callRecords).set({ campaign: target }).where(and(eq(callRecords.tenantId, row.tenantId), eq(callRecords.campaign, WATTFOX_CAMPAIGN))); void reevaluateCalls(db, row.tenantId, stray.filter((call) => !call.leadId && !call.rawContactId && call.decidedBy !== "manuell").map((call) => call.id)).catch(() => undefined); }
        changed += 1; await done(); continue;
      }
      if (row.defaultCampaign || renamed.length) { await done(); continue; }
      const oldNames = ["Wattfox PV", "Wattfox", "Wattfox WP", "Wattfox PV & WP"];
      for (const name of oldNames) { const own = campaigns.find((campaign) => campaign.name === name); if (own) await db.delete(callQaCampaigns).where(eq(callQaCampaigns.id, own.id)); await db.update(callRecords).set({ campaign: WATTFOX_CAMPAIGN }).where(and(eq(callRecords.tenantId, row.tenantId), eq(callRecords.campaign, name))); }
      await db.insert(callQaCampaigns).values({ tenantId: row.tenantId, name: WATTFOX_CAMPAIGN, ...rules });
    }
    // Alles, was vom Dialer kommt, gehört in diese Kampagne: künftige Gespräche (Voreinstellung) und die schon vorhandenen
    if (!row.defaultCampaign) await db.update(callQaConfigs).set({ defaultCampaign: WATTFOX_CAMPAIGN }).where(eq(callQaConfigs.id, row.id));
    await db.update(callRecords).set({ campaign: WATTFOX_CAMPAIGN }).where(and(eq(callRecords.tenantId, row.tenantId), eq(callRecords.provider, row.provider)));
    await done();
    changed += 1;
  }
  return changed;
}
/** Vorlage nur für eine Kampagne übernehmen (eigene Regeln je Kampagne). */
export async function applyPresetToCampaign(db: Db, tenantId: number, input: { preset: string; campaign: string }) {
  const preset = presetByKey(input.preset); if (!preset) throw new Error("Diese Vorlage gibt es nicht."); const name = input.campaign.trim(); if (!name) throw new Error("Bitte eine Kampagne wählen.");
  const own = (await db.select({ id: callQaCampaigns.id }).from(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, tenantId), eq(callQaCampaigns.name, name))).limit(1))[0];
  if (own) await db.update(callQaCampaigns).set({ questions: preset.questions, criteria: preset.criteria, instructions: preset.instructions, presetKey: preset.key }).where(eq(callQaCampaigns.id, own.id)); else await db.insert(callQaCampaigns).values({ tenantId, name, questions: preset.questions, criteria: preset.criteria, instructions: preset.instructions, presetKey: preset.key });
  return { success: true as const, questions: preset.questions.length, criteria: preset.criteria.length };
}

/** Kampagne löschen: Fragensatz und ALLE Gespräche dieser Kampagne (samt hochgeladener Dateien). Leads/Kontakte bleiben. */
export async function deleteCallCampaign(db: Db, tenantId: number, input: { name: string }) {
  const name = input.name.trim(); if (!name) throw new Error("Bitte eine Kampagne wählen.");
  const ids = (await db.select({ id: callRecords.id }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.campaign, name)))).map((row) => row.id);
  const { deleted } = await deleteCalls(db, tenantId, ids);
  await db.delete(callQaCampaigns).where(and(eq(callQaCampaigns.tenantId, tenantId), eq(callQaCampaigns.name, name)));
  await db.update(callQaConfigs).set({ defaultCampaign: null }).where(and(eq(callQaConfigs.tenantId, tenantId), eq(callQaConfigs.defaultCampaign, name))); // sonst legt das nächste Gespräch die gelöschte Kampagne wieder an
  return { deletedCalls: deleted };
}

/** Spalten für die Liste: ohne Text, Roh-Meldung und Zeitmarken – die sind groß und werden erst im einzelnen Gespräch gebraucht. */
const CALL_LIST_COLUMNS = (() => { const { transcript, payload, timeline, ...rest } = getTableColumns(callRecords); void transcript; void payload; void timeline; return rest; })();
/** Suche über die Gespräche: jedes Wort muss vorkommen – beim Kunden (Lead oder Kontakt der Liste), in der Rufnummer, beim Agenten (auch Alias), in Kampagne, Kurzfassung oder im Text des Gesprächs. */
function callSearchCondition(search: string | null | undefined) {
  const words = searchWords(search); if (!words.length) return undefined;
  return and(...words.map((word) => {
    const q = `%${word.replace(/[\\%_]/g, "\\$&")}%`; const digits = phoneFragment(word);
    return or(
      like(callRecords.phone, q), like(callRecords.agentName, q), like(callRecords.agentAlias, q), like(callRecords.campaign, q), like(callRecords.summary, q), like(callRecords.transcript, q), like(callRecords.externalCallId, q),
      ...(digits ? [sql`REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${callRecords.phone}, ''), ' ', ''), '-', ''), '/', ''), '+', '') LIKE ${`%${digits}%`}`] : []),
      sql`EXISTS (SELECT 1 FROM ${leads} WHERE ${leads.id} = ${callRecords.leadId} AND (CONCAT_WS(' ', ${leads.firstName}, ${leads.lastName}) LIKE ${q} OR ${leads.publicId} LIKE ${q} OR ${leads.city} LIKE ${q} OR ${leads.postcode} LIKE ${q} OR ${leads.email} LIKE ${q}))`,
      sql`EXISTS (SELECT 1 FROM ${rawContacts} WHERE ${rawContacts.id} = ${callRecords.rawContactId} AND (CONCAT_WS(' ', ${rawContacts.firstName}, ${rawContacts.lastName}) LIKE ${q} OR ${rawContacts.company} LIKE ${q} OR ${rawContacts.city} LIKE ${q}))`,
    )!;
  }))!;
}
export async function listCalls(db: Db, tenantId: number, filter: { decision?: string | null; status?: string | null; campaign?: string | null; agentName?: string | null; categoryId?: number | null; search?: string | null; limit?: number; /** nur Gespräche, deren Entscheidung die Nachprüfung geändert hat */ rechecked?: boolean | null } & CallPeriod = {}) {
  const conditions = [eq(callRecords.tenantId, tenantId)]; if (filter.rechecked) conditions.push(isNotNull(callRecords.recheckFrom));
  const found = callSearchCondition(filter.search); if (found) conditions.push(found);
  const range = callPeriodRange(filter); if (range.from) conditions.push(gte(callRecords.startedAt, range.from)); if (range.to) conditions.push(lt(callRecords.startedAt, range.to));
  if (filter.categoryId) conditions.push(eq(callRecords.leadCategoryId, filter.categoryId));
  if (filter.decision) conditions.push(eq(callRecords.decision, filter.decision as CallRecord["decision"]));
  if (filter.agentName) conditions.push(eq(callRecords.agentName, filter.agentName));
  if (filter.status) conditions.push(eq(callRecords.status, filter.status as CallRecord["status"]));
  if (filter.campaign) conditions.push(eq(callRecords.campaign, filter.campaign));
  const rows = await db.select({ call: CALL_LIST_COLUMNS, leadPublicId: leads.publicId, leadName: leads.firstName, leadLastName: leads.lastName, leadStatus: leads.status, reviewer: users.name, rawFirst: rawContacts.firstName, rawLast: rawContacts.lastName, rawCompany: rawContacts.company, categoryName: leadCategories.name, categoryEmoji: leadCategories.emoji }).from(callRecords).leftJoin(leads, eq(leads.id, callRecords.leadId)).leftJoin(users, eq(users.id, callRecords.reviewedByUserId)).leftJoin(rawContacts, eq(rawContacts.id, callRecords.rawContactId)).leftJoin(leadCategories, eq(leadCategories.id, callRecords.leadCategoryId)).where(and(...conditions)).orderBy(desc(callRecords.createdAt)).limit(filter.limit ?? 200);
  // Opt-in je Gespräch: der beste Nachweis für den Fachbetrieb zum Lead (gültig > unvollständig > offen)
  const leadIds = Array.from(new Set(rows.map((row) => row.call.leadId).filter((id): id is number => typeof id === "number")));
  const optInRows = leadIds.length ? await db.select({ id: optIns.id, leadId: optIns.leadId, status: optIns.status, kind: optIns.kind, number: optIns.number, buyerName: optIns.buyerName, missing: optIns.missing, callRecordId: optIns.callRecordId }).from(optIns).where(and(eq(optIns.tenantId, tenantId), inArray(optIns.leadId, leadIds), eq(optIns.grantedTo, "kaeufer"))).orderBy(desc(optIns.id)) : [];
  const rank: Record<string, number> = { gueltig: 0, offen: 1, unvollstaendig: 2, abgelehnt: 3, widerrufen: 4 };
  const optInOf = (leadId: number | null, callId: number) => { if (!leadId) return null; const own = optInRows.filter((row) => row.leadId === leadId).sort((a, b) => (a.callRecordId === callId ? -1 : 0) - (b.callRecordId === callId ? -1 : 0) || (rank[a.status] ?? 9) - (rank[b.status] ?? 9)); const best = own[0]; return best ? { id: best.id, status: best.status, kind: best.kind, number: best.number, buyerName: best.buyerName, missing: (best.missing as string[] | null) ?? [] } : null; };
  // Erfüllung der Prüffragen je Gespräch (Zahl unter dem Smiley): Fragen je Kampagne einmal laden
  const defaults = await defaultQuestionsFor(db, tenantId); const questionSets = new Map<string, QualificationQuestion[]>();
  for (const row of await db.select({ name: callQaCampaigns.name, questions: callQaCampaigns.questions }).from(callQaCampaigns).where(eq(callQaCampaigns.tenantId, tenantId))) { const qs = normalizeQuestions(row.questions as QualificationQuestion[] | null); if (qs.length) questionSets.set(row.name, qs); }
  const questionsOf = (campaign: string | null) => (campaign ? questionSets.get(campaign) : undefined) ?? defaults;
  return rows.map(({ call, leadPublicId, leadName, leadLastName, leadStatus, reviewer, rawFirst, rawLast, rawCompany, categoryName, categoryEmoji }) => ({ id: call.id, recheckFrom: (call.recheckFrom ?? null) as CallRecord["decision"] | null, fulfilment: questionFulfilment(questionsOf(call.campaign), call.qualificationAnswers as Record<string, QualificationAnswer> | null), optIn: optInOf(call.leadId, call.id), leadCategoryId: call.leadCategoryId, category: categoryName ? { id: call.leadCategoryId!, name: categoryName, emoji: categoryEmoji ?? null } : null, externalCallId: call.externalCallId, provider: call.provider, leadId: call.leadId, rawContactId: call.rawContactId, rawContactName: call.rawContactId ? [rawFirst, rawLast].filter(Boolean).join(" ") || rawCompany || "Rohdaten-Kontakt" : null, leadPublicId, leadName: [leadName, leadLastName].filter(Boolean).join(" ") || null, leadStatus, phone: call.phone, agentName: call.agentName, campaign: call.campaign, direction: call.direction, startedAt: call.startedAt, durationSeconds: call.durationSeconds, consent: call.consent, status: call.status, score: call.score, verdict: call.verdict, decision: call.decision, decidedBy: call.decidedBy, reviewer, reviewedAt: call.reviewedAt, summary: call.summary, nextStep: call.nextStep, error: call.error, createdAt: call.createdAt, qualificationAnswers: (call.qualificationAnswers ?? null) as Record<string, QualificationAnswer> | null }));
}

export async function getCall(db: Db, tenantId: number, callId: number) {
  const row = (await db.select({ call: callRecords, leadPublicId: leads.publicId, leadName: leads.firstName, leadLastName: leads.lastName, leadStatus: leads.status, reviewer: users.name, rawFirst: rawContacts.firstName, rawLast: rawContacts.lastName, rawCompany: rawContacts.company, rawStatus: rawContacts.status, categoryName: leadCategories.name, categoryEmoji: leadCategories.emoji }).from(callRecords).leftJoin(leads, eq(leads.id, callRecords.leadId)).leftJoin(users, eq(users.id, callRecords.reviewedByUserId)).leftJoin(rawContacts, eq(rawContacts.id, callRecords.rawContactId)).leftJoin(leadCategories, eq(leadCategories.id, callRecords.leadCategoryId)).where(and(eq(callRecords.id, callId), eq(callRecords.tenantId, tenantId))).limit(1))[0];
  if (!row) throw new Error("Gespräch wurde nicht gefunden.");
  const config = await ensureCallQaConfig(db, tenantId);
  const own = await criteriaForCampaign(db, tenantId, row.call.campaign, config); const criteria = own.criteria;
  const scores = Array.isArray(row.call.criteriaScores) ? (row.call.criteriaScores as Evaluation["criteria"]) : [];
  const questions = await questionsForCampaign(db, tenantId, row.call.campaign);
  const unscored = row.call.status === "bewertet" && criteriaUnscored(row.call); // Kriterien-Punkte fehlen (werden automatisch nachgeholt) – nicht als 0 % zeigen
  const timeline = readTimeline(row.call.timeline); const timelineState = timelineStateOf(row.call);
  return { ...row.call, timeline: undefined, segments: timeline?.segments ?? [], marks: timeline?.marks ?? {}, timelineState: timelineState.state, timelineNote: timelineState.note, category: row.categoryName ? { id: row.call.leadCategoryId!, name: row.categoryName, emoji: row.categoryEmoji ?? null } : null, criteriaCustom: own.custom, callback: Boolean(row.call.transcript && isCallback(row.call.transcript)), recordingUrl: row.call.recordingUrl ? `/api/aufnahmen/${row.call.id}` : null /* immer über die eigene Adresse: nur so lässt sich spulen, und Zugangsdaten im Link des Dialers bleiben bei uns */, recordingSource: row.call.recordingUrl?.startsWith("file:") ? "datei" as const : row.call.recordingUrl ? "link" as const : null, payload: undefined, autoDeliver: config.autoDeliver, dialer: dialerInfo(row.call.payload, { ...DEFAULT_MAPPING, ...((config.fieldMapping ?? {}) as Record<string, string>) }), questions, fulfilment: questionFulfilment(questions, row.call.qualificationAnswers as Record<string, QualificationAnswer> | null), qualificationAnswers: (row.call.qualificationAnswers ?? {}) as Record<string, QualificationAnswer>, leadPublicId: row.leadPublicId, leadName: [row.leadName, row.leadLastName].filter(Boolean).join(" ") || null, leadStatus: row.leadStatus, rawContact: row.call.rawContactId ? { id: row.call.rawContactId, name: [row.rawFirst, row.rawLast].filter(Boolean).join(" ") || row.rawCompany || "Rohdaten-Kontakt", status: row.rawStatus } : null, reviewer: row.reviewer, criteriaUnscored: unscored, criteriaNote: scores.find((item) => item.key === CRITERIA_NOTE_KEY)?.evidence ?? null, score: unscored ? null : row.call.score, criteria: criteria.map((criterion) => ({ ...criterion, score: unscored ? null : scores.find((item) => item.key === criterion.key)?.score ?? null, evidence: unscored ? "" : scores.find((item) => item.key === criterion.key)?.evidence ?? "" })), redFlags: Array.isArray(row.call.redFlags) ? (row.call.redFlags as string[]) : [] };
}

export async function callStatistics(db: Db, tenantId: number, filter: CallPeriod & { campaign?: string | null; agentName?: string | null; categoryId?: number | null; search?: string | null } = {}) {
  // Der Agent-Filter wird erst beim Zusammenzählen angewandt: Zahlen und Verlauf gelten für den gewählten Agenten, die Agenten-Leiste zeigt weiter alle
  const conditions = [eq(callRecords.tenantId, tenantId)]; const range = callPeriodRange(filter); if (range.from) conditions.push(gte(callRecords.startedAt, range.from)); if (range.to) conditions.push(lt(callRecords.startedAt, range.to)); if (filter.campaign) conditions.push(eq(callRecords.campaign, filter.campaign)); if (filter.categoryId) conditions.push(eq(callRecords.leadCategoryId, filter.categoryId));
  const found = callSearchCondition(filter.search); if (found) conditions.push(found); // die Zahlen über der Liste gelten für dieselbe Suche
  // Die Kriterien-Punkte (großes JSON) braucht es nur bei Note 0: dort ist zu klären, ob wirklich 0 Punkte vergeben wurden oder die Punkte noch fehlen. Die Tafel lädt sich regelmäßig neu – deshalb so schlank wie möglich.
  const zeroScores = sql<unknown>`case when ${callRecords.score} = 0 then ${callRecords.criteriaScores} else null end`;
  const rows = await db.select({ id: callRecords.id, status: callRecords.status, decision: callRecords.decision, verdict: callRecords.verdict, score: callRecords.score, criteriaScores: zeroScores, agentName: callRecords.agentName, startedAt: callRecords.startedAt, durationSeconds: callRecords.durationSeconds }).from(callRecords).where(and(...conditions));
  const asList = (value: unknown): unknown[] | null => { if (Array.isArray(value)) return value; if (typeof value !== "string" || !value) return null; try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed : null; } catch { return null; } };
  return summarizeCalls(rows.map(({ criteriaScores, ...row }) => { const scores = asList(criteriaScores); return { ...row, unscored: row.status === "bewertet" && Boolean(scores?.length) && criteriaUnscored({ score: row.score, criteriaScores: scores }) }; }), { agentName: filter.agentName ?? null }); // ohne Kriterien-Punkte (werden nachgeholt) nicht als 0 in den Schnitt
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
  await dropPlaybackCopy(tenantId, callId); // Kopie zum Anhören
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
    for (const row of stale) { const current = (await db.select({ transcript: callRecords.transcript, recordingUrl: callRecords.recordingUrl }).from(callRecords).where(eq(callRecords.id, row.id)).limit(1))[0]; if (!current?.transcript && !current?.recordingUrl) continue; if (current.recordingUrl?.startsWith("file:")) await fs.unlink(path.resolve(recordingsDir(), current.recordingUrl.slice("file:".length).replace(/[^a-zA-Z0-9._-]/g, ""))).catch(() => undefined); /* hochgeladene Aufnahme */ await dropPlaybackCopy(config.tenantId, row.id); /* Kopie zum Anhören */ await db.update(callRecords).set({ transcript: null, recordingUrl: null, payload: null, timeline: null /* die Abschnitte enthalten den Text des Gesprächs */ }).where(eq(callRecords.id, row.id)); purged += 1; }
  }
  return { purged };
}
