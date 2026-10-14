/**
 * Telefonie-Webhooks des Anbieters (Twilio). Alle Antworten sind TwiML oder leer; Signaturen werden geprüft.
 */
import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { agentSessions, dialerCalls, phoneNumbers, telephonySettings } from "../drizzle/schema";
import { getDb } from "./db";
import { ensureTelephonySettings, handleAmdEvent, handleRecordingEvent, handleStatusEvent, providerFor } from "./dialer";
import { decryptIntegrationSecret } from "./integration-secrets";
import { twiml, verifyTwilioSignature } from "./telephony-provider";

const params = (req: Request) => ({ ...(req.query as Record<string, unknown>), ...((req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>) });
const text = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const xml = (res: Response, body: string) => res.status(200).type("text/xml").send(body);
const baseUrl = (req: Request) => (process.env.APP_URL ?? `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");

async function authenticated(req: Request, res: Response, tenantId: number) {
  const db = await getDb(); if (!db) { res.status(503).end(); return null; }
  const settings = await ensureTelephonySettings(db, tenantId);
  if (settings.provider === "twilio") {
    let authToken = ""; try { authToken = settings.credentialsEncrypted ? (JSON.parse(decryptIntegrationSecret(settings.credentialsEncrypted)) as { authToken?: string }).authToken ?? "" : ""; } catch { /* leer */ }
    const url = `${baseUrl(req)}${req.originalUrl}`;
    if (!authToken || !verifyTwilioSignature(authToken, url, (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>, req.header("x-twilio-signature"))) {
      const secret = text(req.query.secret); if (!secret || secret !== settings.webhookSecret) { res.status(403).end(); return null; }
    }
  } else if (text(req.query.secret) !== settings.webhookSecret) { res.status(403).end(); return null; }
  return { db, settings };
}

export function registerTelephonyRoutes(app: Express) {
  /** Agentenleg (Browser-Softphone oder Telefon des Agenten): Kunden anwählen und verbinden. */
  const agentTwiml = async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).end();
    const callId = Number(params(req).callId); const call = callId ? (await db.select().from(dialerCalls).where(eq(dialerCalls.id, callId)).limit(1))[0] : undefined;
    if (!call) return xml(res, twiml.hangup("Der Anruf konnte nicht zugeordnet werden."));
    const auth = await authenticated(req, res, call.tenantId); if (!auth) return;
    const base = baseUrl(req); const record = auth.settings.recordCalls && (auth.settings.recordWithoutConsent || auth.settings.consentMode === "ansage"); // ohne Abfrage: ab Gesprächsbeginn, keine Ansage
    return xml(res, twiml.dialNumber({ to: call.toNumber, callerId: call.fromNumber ?? "", record, recordingCallbackUrl: `${base}/api/telephony/recording?callId=${call.id}`, statusCallbackUrl: `${base}/api/telephony/status?callId=${call.id}`, announcement: !auth.settings.recordWithoutConsent && auth.settings.consentMode === "ansage" ? auth.settings.announcement ?? undefined : undefined }));
  };
  app.post("/api/telephony/voice/agent", agentTwiml); app.get("/api/telephony/voice/agent", agentTwiml);

  /** Predictive: der angerufene Kunde nimmt ab → Ansage, dann in die Warteschlange der Kampagne. */
  const customerTwiml = async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).end();
    const callId = Number(params(req).callId); const call = callId ? (await db.select().from(dialerCalls).where(eq(dialerCalls.id, callId)).limit(1))[0] : undefined;
    if (!call) return xml(res, twiml.hangup());
    const auth = await authenticated(req, res, call.tenantId); if (!auth) return;
    return xml(res, twiml.enqueue({ queueName: `kampagne-${call.campaignId ?? 0}`, announcement: !auth.settings.recordWithoutConsent && auth.settings.consentMode === "ansage" ? auth.settings.announcement ?? undefined : "Einen Moment bitte, Sie werden verbunden.", waitUrl: `${baseUrl(req)}/api/telephony/voice/hold?secret=${auth.settings.webhookSecret}` }));
  };
  app.post("/api/telephony/voice/customer", customerTwiml); app.get("/api/telephony/voice/customer", customerTwiml);

  /** Agent wird zur Warteschlange gerufen (Predictive): verbindet mit dem wartenden Kunden. */
  const agentQueueTwiml = async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).end();
    const callId = Number(params(req).callId); const call = callId ? (await db.select().from(dialerCalls).where(eq(dialerCalls.id, callId)).limit(1))[0] : undefined;
    if (!call) return xml(res, twiml.hangup());
    const auth = await authenticated(req, res, call.tenantId); if (!auth) return;
    return xml(res, twiml.dialQueue({ queueName: `kampagne-${call.campaignId ?? 0}`, record: auth.settings.recordCalls && (auth.settings.recordWithoutConsent || auth.settings.consentMode === "ansage"), recordingCallbackUrl: `${baseUrl(req)}/api/telephony/recording?callId=${call.id}` }));
  };
  app.post("/api/telephony/voice/agent-queue", agentQueueTwiml); app.get("/api/telephony/voice/agent-queue", agentQueueTwiml);

  app.all("/api/telephony/voice/hold", (_req, res) => xml(res, twiml.hold()));
  app.all("/api/telephony/voice/abandon", (_req, res) => xml(res, twiml.hangup("Leider ist gerade kein Mitarbeiter frei. Wir melden uns in Kürze bei Ihnen. Auf Wiederhören.")));

  /** Eingehende Anrufe auf gekaufte Rufnummern: an einen freien Agenten im Browser, sonst Hinweis. */
  const inboundTwiml = async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).end();
    const to = text(params(req).To); const number = to ? (await db.select().from(phoneNumbers).where(eq(phoneNumbers.e164, to)).limit(1))[0] : undefined;
    const tenantId = number?.tenantId ?? (Number(req.query.tenant) || 0); if (!tenantId) return xml(res, twiml.hangup());
    const settings = (await db.select().from(telephonySettings).where(eq(telephonySettings.tenantId, tenantId)).limit(1))[0];
    const agent = (await db.select().from(agentSessions).where(and(eq(agentSessions.tenantId, tenantId), eq(agentSessions.status, "bereit"))).limit(1))[0];
    if (!agent) return xml(res, twiml.hangup("Vielen Dank für Ihren Anruf. Zurzeit ist niemand erreichbar, wir rufen Sie gerne zurück."));
    return xml(res, twiml.dialClient({ identity: `agent-${tenantId}-${agent.userId}`, announcement: !settings?.recordWithoutConsent && settings?.consentMode === "ansage" ? settings.announcement ?? undefined : undefined, timeout: 20, record: Boolean(settings?.recordCalls) && (Boolean(settings?.recordWithoutConsent) || settings?.consentMode === "ansage"), recordingCallbackUrl: `${baseUrl(req)}/api/telephony/recording` }));
  };
  app.post("/api/telephony/voice/inbound", inboundTwiml); app.get("/api/telephony/voice/inbound", inboundTwiml);

  app.post("/api/telephony/status", async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).end();
    const body = params(req);
    await handleStatusEvent(db, { providerCallSid: text(body.CallSid) || null, callId: Number(body.callId) || null, status: text(body.CallStatus), durationSeconds: body.CallDuration ? Number(body.CallDuration) : null, leg: text(body.leg) === "agent" ? "agent" : "customer" });
    return res.status(204).end();
  });
  app.post("/api/telephony/amd", async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).end();
    const body = params(req);
    await handleAmdEvent(db, { providerCallSid: text(body.CallSid) || null, callId: Number(body.callId) || null, answeredBy: text(body.AnsweredBy) || "unknown" });
    return res.status(204).end();
  });
  app.post("/api/telephony/recording", async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).end();
    const body = params(req);
    if (text(body.RecordingStatus) && text(body.RecordingStatus) !== "completed") return res.status(204).end();
    await handleRecordingEvent(db, { providerCallSid: text(body.CallSid) || null, callId: Number(body.callId) || null, recordingSid: text(body.RecordingSid) || null, recordingUrl: `${text(body.RecordingUrl)}${text(body.RecordingUrl).endsWith(".mp3") ? "" : ".mp3"}`, durationSeconds: body.RecordingDuration ? Number(body.RecordingDuration) : null });
    return res.status(204).end();
  });
  void providerFor;
}
