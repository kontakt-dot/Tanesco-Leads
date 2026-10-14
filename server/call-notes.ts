/**
 * Automatische Gesprächsnotizen (alle Dialer): nach einem Gespräch entsteht eine Notiz am Lead
 * (Pipeline-Notiz, Verlauf) und am Anruf (Telefonie → Anrufe). Grundlage ist das Transkript der
 * Gesprächsbewertung – mit ANTHROPIC_API_KEY fasst die KI zusammen, sonst gibt es eine Kurzfassung;
 * ohne Transkript (keine Aufzeichnung/Einwilligung) besteht die Notiz aus Ergebnis, Dauer und Agenten-Notiz.
 * Ein-/Ausschalten: Telefonie-Einstellungen (Standard), je Kampagne, direkt im Dialer (Schnappschuss am Anruf).
 */
import { and, eq } from "drizzle-orm";
import { callRecords, dialerCalls, dialerCampaigns, leads, leadStatusEvents, pipelineNotes, telephonySettings, users } from "../drizzle/schema";
import { effectiveAutoNotes, formatCallNote, heuristicCallSummary, type CallSummary } from "../shared/call-notes";
import { CALL_STATUS_LABELS, dispositionLabel } from "../shared/dialer";
import { invokeLLM } from "./_core/llm";
import type { Db } from "./lead-pipeline";

export type NoteStage = "ende" | "ergebnis" | "transkript";

/** Zusammenfassung je Transkript nur einmal von der KI holen (Notiz wird bei Ergebnis/Transkript mehrfach neu geschrieben). */
const summaryCache = new Map<string, CallSummary>();
const cacheKey = (callId: number, transcript: string) => `${callId}:${transcript.length}:${transcript.slice(0, 80)}`;

export async function summarizeTranscript(transcript: string, context: { leadName?: string | null; category?: string | null; campaign?: string | null } = {}): Promise<CallSummary> {
  if (!process.env.ANTHROPIC_API_KEY) return heuristicCallSummary(transcript);
  try {
    const schema = { name: "gespraechsnotiz", schema: { type: "object", additionalProperties: false, required: ["summary", "points", "nextStep"], properties: { summary: { type: "string", description: "2–3 Sätze: Anliegen des Kunden, Verlauf, Ergebnis" }, points: { type: "array", maxItems: 6, items: { type: "string" }, description: "Wichtige Fakten, Einwände und Zusagen als kurze Stichpunkte" }, nextStep: { type: ["string", "null"], description: "Ein Satz: was als Nächstes zu tun ist – oder null" } } } };
    const system = "Du schreibst kurze, sachliche Gesprächsnotizen für den Vertrieb eines Lead-Anbieters. Nutze ausschließlich das Transkript, erfinde nichts, keine Bewertung der Person. Deutsch, knapp, keine Anrede. summary: 2–3 Sätze. points: höchstens 6 Stichpunkte (Anliegen, Eigentum/Zeitrahmen, Einwände, Zusagen, Wünsche). nextStep: ein Satz oder null.";
    const user = `${context.category ? `Lead-Kategorie: ${context.category}\n` : ""}${context.leadName ? `Kunde laut Lead: ${context.leadName}\n` : ""}${context.campaign ? `Kampagne: ${context.campaign}\n` : ""}Transkript:\n"""\n${transcript.slice(0, 40_000)}\n"""`;
    const response = await invokeLLM({ model: "fast", maxTokens: 700, messages: [{ role: "system", content: system }, { role: "user", content: user }], outputSchema: schema });
    const parsed = JSON.parse(response.choices[0]?.message.content ?? "{}") as { summary?: unknown; points?: unknown; nextStep?: unknown };
    const summary = String(parsed.summary ?? "").trim();
    if (!summary) return heuristicCallSummary(transcript);
    return { summary: summary.slice(0, 1200), points: Array.isArray(parsed.points) ? parsed.points.map((item) => String(item).trim()).filter(Boolean).slice(0, 6) : [], nextStep: parsed.nextStep ? String(parsed.nextStep).slice(0, 320) : null, source: "ki" };
  } catch {
    return heuristicCallSummary(transcript);
  }
}

/** Gilt für diesen Anruf die automatische Notiz? (Schnappschuss beim Anrufaufbau: Kampagne vor Einstellung.) */
export async function autoNotesForCall(db: Db, tenantId: number, campaignId: number | null) {
  const settings = (await db.select({ autoCallNotes: telephonySettings.autoCallNotes }).from(telephonySettings).where(eq(telephonySettings.tenantId, tenantId)).limit(1))[0];
  const campaign = campaignId ? (await db.select({ autoNotes: dialerCampaigns.autoNotes }).from(dialerCampaigns).where(and(eq(dialerCampaigns.id, campaignId), eq(dialerCampaigns.tenantId, tenantId))).limit(1))[0] : undefined;
  return effectiveAutoNotes(settings?.autoCallNotes ?? true, campaign?.autoNotes ?? null);
}

/** Schalter: global (Telefonie-Einstellungen), je Kampagne (null = Standard) oder für den laufenden Anruf. */
export async function setAutoNotes(db: Db, tenantId: number, input: { scope: "global" | "kampagne" | "anruf"; campaignId?: number | null; callId?: number | null; enabled: boolean | null }) {
  if (input.scope === "global") { await db.update(telephonySettings).set({ autoCallNotes: input.enabled !== false }).where(eq(telephonySettings.tenantId, tenantId)); }
  else if (input.scope === "kampagne") { if (!input.campaignId) throw new Error("Kampagne fehlt."); await db.update(dialerCampaigns).set({ autoNotes: input.enabled }).where(and(eq(dialerCampaigns.id, input.campaignId), eq(dialerCampaigns.tenantId, tenantId))); }
  else { if (!input.callId) throw new Error("Anruf fehlt."); await db.update(dialerCalls).set({ autoNotes: input.enabled !== false }).where(and(eq(dialerCalls.id, input.callId), eq(dialerCalls.tenantId, tenantId))); }
  return { success: true as const };
}

/**
 * Notiz für einen beendeten Anruf schreiben oder aktualisieren (eine Notiz je Anruf):
 * Stufe „ende“ (Gespräch vorbei), „ergebnis“ (Agent hat das Ergebnis gesetzt), „transkript“ (Bewertung/Transkript liegt vor).
 */
export async function writeCallNote(db: Db, tenantId: number, callId: number, stage: NoteStage, options: { callRecordId?: number | null } = {}) {
  const call = (await db.select().from(dialerCalls).where(and(eq(dialerCalls.id, callId), eq(dialerCalls.tenantId, tenantId))).limit(1))[0];
  if (!call || !call.autoNotes || call.status !== "beendet") return null;
  const recordId = call.callRecordId ?? options.callRecordId ?? null;
  const record = recordId ? (await db.select().from(callRecords).where(eq(callRecords.id, recordId)).limit(1))[0] : undefined;
  const transcript = record?.transcript?.trim() || null;
  const lead = call.leadId ? (await db.select().from(leads).where(eq(leads.id, call.leadId)).limit(1))[0] : undefined;
  const agent = call.agentUserId ? (await db.select({ name: users.name }).from(users).where(eq(users.id, call.agentUserId)).limit(1))[0] : undefined;
  const campaign = call.campaignId ? (await db.select({ name: dialerCampaigns.name }).from(dialerCampaigns).where(eq(dialerCampaigns.id, call.campaignId)).limit(1))[0] : undefined;
  let summary: CallSummary | null = null;
  if (transcript) {
    const key = cacheKey(call.id, transcript);
    summary = summaryCache.get(key) ?? (await summarizeTranscript(transcript, { leadName: lead ? `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() : null, campaign: campaign?.name ?? null }));
    summaryCache.set(key, summary);
    if (summaryCache.size > 500) summaryCache.delete(summaryCache.keys().next().value as string);
  }
  const text = formatCallNote({ startedAt: call.startedAt, talkSeconds: call.talkSeconds ?? call.durationSeconds ?? null, agentName: agent?.name ?? null, campaignName: campaign?.name ?? null, mode: call.mode, statusLabel: CALL_STATUS_LABELS[call.status] ?? call.status, dispositionLabel: dispositionLabel(call.disposition), agentNotes: call.notes }, summary);
  const source = summary?.source ?? "anrufdaten";
  if (call.summary === text) return { text, source, changed: false, stage };
  const firstWrite = !call.summary;
  await db.update(dialerCalls).set({ summary: text, summarySource: source, summaryAt: new Date() }).where(eq(dialerCalls.id, call.id));
  if (lead) {
    const existing = (await db.select({ id: pipelineNotes.id }).from(pipelineNotes).where(and(eq(pipelineNotes.tenantId, tenantId), eq(pipelineNotes.dialerCallId, call.id))).limit(1))[0];
    if (existing) await db.update(pipelineNotes).set({ text }).where(eq(pipelineNotes.id, existing.id));
    else await db.insert(pipelineNotes).values({ tenantId, leadId: lead.id, authorUserId: call.agentUserId, text, source: "gespraech", dialerCallId: call.id });
    // Verlauf am Lead: einmal beim Anlegen und noch einmal, wenn die Transkript-Zusammenfassung dazukommt
    if (firstWrite || (summary && call.summarySource === "anrufdaten")) await db.insert(leadStatusEvents).values({ tenantId, leadId: lead.id, previousStatus: null, nextStatus: lead.status, actorUserId: call.agentUserId, note: text.slice(0, 2000) });
  }
  return { text, source, changed: true, stage };
}

/** Hook nach der Gesprächsbewertung: gehört das Gespräch zu einem Dialer-Anruf, Notiz mit Transkript nachziehen. */
export async function noteAfterEvaluation(db: Db, tenantId: number, callRecordId: number) {
  const record = (await db.select({ externalCallId: callRecords.externalCallId }).from(callRecords).where(eq(callRecords.id, callRecordId)).limit(1))[0];
  const match = /^dialer-(\d+)$/.exec(record?.externalCallId ?? "");
  if (!match) return null;
  return writeCallNote(db, tenantId, Number(match[1]), "transkript", { callRecordId }).catch(() => null);
}
