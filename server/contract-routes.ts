/**
 * Öffentliche Seiten für Verträge: /vertrag/:token (ansehen + unterschreiben), POST /api/vertrag/:token/sign, /decline, GET /pdf.
 * Der Link ist das Geheimnis – ohne gültigen Token gibt es nichts zu sehen.
 */
import type { Express, Request, Response } from "express";
import { getDb } from "./db";
import * as vertraege from "./contracts";

const clientIp = (req: Request) => { const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim(); return (forwarded || req.socket?.remoteAddress || req.ip || "").replace(/^::ffff:/, "").slice(0, 64) || null; };
const appUrlOf = (req: Request) => (process.env.APP_URL ?? "").replace(/\/+$/, "") || `${req.protocol}://${req.get("host")}`;
const page = (title: string, text: string) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f2f4f7;color:#101828"><div style="max-width:520px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #e4e7ec;border-radius:18px"><h1 style="font-size:20px;margin:0 0 10px">${title}</h1><p style="margin:0;color:#475467;line-height:1.6">${text}</p></div></body></html>`;

export function registerContractRoutes(app: Express) {
  app.get("/vertrag/:token", async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).send(page("Gerade nicht erreichbar", "Bitte in ein paar Minuten noch einmal versuchen."));
    try {
      const html = await vertraege.publicContract(db, String(req.params.token), { ip: clientIp(req), userAgent: req.get("user-agent") ?? null }, appUrlOf(req));
      if (!html) return res.status(404).send(page("Vertrag nicht gefunden", "Dieser Link ist ungültig oder der Vertrag wurde zurückgezogen."));
      res.set({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" }); return res.send(html);
    } catch (error) { console.error("[Verträge] Seite:", error instanceof Error ? error.message : error); return res.status(500).send(page("Fehler", "Der Vertrag konnte nicht geladen werden.")); }
  });
  app.post("/api/vertrag/:token/sign", async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).json({ error: "Gerade nicht erreichbar – bitte gleich noch einmal versuchen." });
    try {
      const body = (req.body ?? {}) as { signerName?: string; fields?: Record<string, string>; signatureImage?: string; method?: string; consent?: boolean };
      const result = await vertraege.signContract(db, String(req.params.token), { signerName: String(body.signerName ?? ""), fields: body.fields ?? null, signatureImage: String(body.signatureImage ?? ""), method: body.method ?? null, consent: Boolean(body.consent) }, { ip: clientIp(req), userAgent: req.get("user-agent") ?? null }, appUrlOf(req));
      return res.json(result);
    } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Unterschrift fehlgeschlagen" }); }
  });
  app.post("/api/vertrag/:token/decline", async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).json({ error: "Gerade nicht erreichbar." });
    try { return res.json(await vertraege.declineContract(db, String(req.params.token), (req.body as { reason?: string } | undefined)?.reason ?? null, { ip: clientIp(req), userAgent: req.get("user-agent") ?? null })); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Fehler" }); }
  });
  app.get("/api/vertrag/:token/pdf", async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).send("Gerade nicht erreichbar.");
    try {
      const pdf = await vertraege.publicPdf(db, String(req.params.token)); if (!pdf) return res.status(404).send("Nicht gefunden.");
      res.set({ "content-type": "application/pdf", "content-disposition": `inline; filename="${pdf.fileName.replace(/"/g, "")}"`, "cache-control": "no-store" }); return res.send(Buffer.from(pdf.buffer));
    } catch (error) { console.error("[Verträge] PDF:", error instanceof Error ? error.message : error); return res.status(500).send("PDF konnte nicht erstellt werden."); }
  });
}
