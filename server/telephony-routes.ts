/**
 * Telefonie-Webhooks: sipgate Push-API (Ereignisse zu unseren Anrufen) und die Weitergabe von sipgate-Aufzeichnungen.
 */
import type { Express, Request, Response } from "express";
import { getDb } from "./db";
import { ensureTelephonySettings, handleSipgateEvent, sipgateRecordingResponse } from "./dialer";

const text = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const baseUrl = (req: Request) => (process.env.APP_URL ?? `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");

export function registerTelephonyRoutes(app: Express) {
  /** sipgate Push-API: newCall / answer / hangup für unsere Anrufe (Mandant und Geheimnis stehen in der Adresse). */
  app.post("/api/telephony/sipgate/events", async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).end();
    const tenantId = Number(req.query.tenant) || 0; if (!tenantId) return res.status(403).end();
    const settings = await ensureTelephonySettings(db, tenantId);
    if (text(req.query.secret) !== settings.webhookSecret) return res.status(403).end();
    const result = await handleSipgateEvent(db, tenantId, (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>, baseUrl(req)).catch((error) => { console.error("[sipgate] Ereignis fehlgeschlagen:", error instanceof Error ? error.message : error); return null; });
    return res.status(200).type("application/xml").send(result?.xml ?? `<?xml version="1.0" encoding="UTF-8"?><Response />`);
  });
  /** Aufzeichnung eines sipgate-Anrufs: liegt bei sipgate, wird hier mit den Zugangsdaten geholt und durchgereicht (Wiedergabe, Transkription). */
  app.get("/api/telephony/sipgate/recording/:callId", async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).end();
    const upstream = await sipgateRecordingResponse(db, Number(req.params.callId) || 0, text(req.query.secret)).catch(() => null);
    if (!upstream) return res.status(404).end();
    if (!upstream.ok) return res.status(502).end();
    res.status(200).type(upstream.headers.get("content-type") ?? "audio/mpeg");
    const length = upstream.headers.get("content-length"); if (length) res.setHeader("content-length", length);
    res.send(Buffer.from(await upstream.arrayBuffer()));
  });
}
