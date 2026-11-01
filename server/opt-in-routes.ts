/**
 * Öffentliche Seiten für Opt-ins: /opt-in/:token (Bestätigung per SMS-Link, mit Ja/Nein), POST /api/opt-in/:token/confirm und /decline,
 * GET /api/opt-in/nachweis/:token.pdf (Einwilligungsnachweis für den Käufer – der Link ist das Geheimnis).
 */
import type { Express, Request, Response } from "express";
import { getDb } from "./db";
import * as optIn from "./opt-in";

const clientIp = (req: Request) => { const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim(); return (forwarded || req.socket?.remoteAddress || req.ip || "").replace(/^::ffff:/, "").slice(0, 64) || null; };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
const shell = (title: string, body: string) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f2f4f7;color:#101828}main{max-width:560px;margin:0 auto;padding:32px 20px 60px}.card{background:#fff;border-radius:16px;padding:24px;box-shadow:0 8px 30px rgba(16,24,40,.08)}h1{font-size:22px;margin:0 0 10px}p{line-height:1.55;font-size:15.5px}.box{background:#f8f9fc;border:1px solid #e4e7ec;border-radius:12px;padding:14px 16px;margin:14px 0;font-size:14.5px;line-height:1.55}.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}button{appearance:none;border:0;border-radius:12px;padding:14px 20px;font-size:16px;font-weight:600;cursor:pointer}.yes{background:#16a34a;color:#fff;flex:1 1 200px}.no{background:#eef0f4;color:#344054;flex:1 1 140px}small{display:block;color:#667085;font-size:12.5px;line-height:1.5;margin-top:14px}.ok{color:#15803d;font-weight:600}.err{color:#b42318;font-weight:600}</style></head><body><main><div class="card">${body}</div></main></body></html>`;

export function registerOptInRoutes(app: Express) {
  app.get("/opt-in/:token", async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).send(shell("Gerade nicht erreichbar", "<h1>Gerade nicht erreichbar</h1><p>Bitte in ein paar Minuten noch einmal versuchen.</p>"));
    const token = String(req.params.token);
    try {
      const found = await optIn.optInByToken(db, token);
      if (!found) return res.status(404).send(shell("Link ungültig", "<h1>Dieser Link ist nicht mehr gültig.</h1><p>Bitte wenden Sie sich an das Unternehmen, das Ihnen die SMS geschickt hat.</p>"));
      const { row } = found; const company = escapeHtml(row.companyName ?? ""); const buyer = escapeHtml(row.buyerName ?? "der genannte Fachbetrieb"); const category = escapeHtml(found.category ?? "Ihre Anfrage");
      const channels = escapeHtml(found.channels || "telefonisch und per E-Mail");
      const legal = `${found.revokeEmail ? `Widerruf jederzeit per E-Mail an <a href="mailto:${escapeHtml(found.revokeEmail)}">${escapeHtml(found.revokeEmail)}</a>. ` : "Widerruf jederzeit möglich. "}${found.privacyUrl ? `Mehr zur Verarbeitung Ihrer Daten, zur Aufbewahrung und zu Ihren Rechten steht in der <a href="${escapeHtml(found.privacyUrl)}" rel="noopener" target="_blank">Datenschutzerklärung</a>.` : ""}`;
      if (row.status === "gueltig" && row.confirmedAt) return res.send(shell("Bereits bestätigt", `<h1>Vielen Dank – schon bestätigt.</h1><p>Sie haben am ${row.confirmedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} Uhr bestätigt, dass ${buyer} Sie zu Ihrer Anfrage kontaktieren darf.</p><small>${legal || `Widerruf jederzeit möglich – einfach an ${company} wenden.`}</small>`));
      if (row.status === "widerrufen" || row.status === "abgelehnt") return res.send(shell("Keine Einwilligung", `<h1>Keine Einwilligung.</h1><p>Sie haben die Kontaktaufnahme ${row.status === "widerrufen" ? "widerrufen" : "abgelehnt"}. ${buyer} wird Sie auf dieser Grundlage nicht kontaktieren.</p>${legal ? `<small>${legal}</small>` : ""}`));
      const body = `<h1>Darf ${buyer} Sie kontaktieren?</h1><p>${found.name ? `Hallo ${escapeHtml(found.name)}, ` : ""}Sie haben bei ${company} eine Anfrage zum Thema <strong>${category}</strong> gestellt.</p><div class="box">Mit „Ja“ bestätigen Sie: ${company} darf Ihren Namen, Ihre Adresse, Ihre Telefonnummer und Ihre Angaben zur Anfrage an <strong>${buyer}</strong> weitergeben, und dieser Betrieb darf Sie dazu ${channels} kontaktieren – nur zu dieser Anfrage. Diese Einwilligung können Sie jederzeit mit Wirkung für die Zukunft widerrufen. Den Nachweis bewahren wir fünf Jahre auf (§ 7a UWG).</div><div class="row"><button class="yes" id="yes">Ja, ich bin einverstanden</button><button class="no" id="no">Nein</button></div><p id="msg"></p><small>${legal} Nachweis-Nummer ${escapeHtml(row.number)}.</small><script>const msg=document.getElementById('msg');async function go(kind){const buttons=document.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);try{const r=await fetch('/api/opt-in/${encodeURIComponent(token)}/'+kind,{method:'POST'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Fehler');msg.className=kind==='confirm'?'ok':'err';msg.textContent=kind==='confirm'?'Vielen Dank – Ihre Bestätigung ist gespeichert. '+(d.buyerName?d.buyerName+' meldet sich bei Ihnen.':''):'Verstanden – es erfolgt keine Kontaktaufnahme.';document.querySelector('.row').remove();}catch(e){msg.className='err';msg.textContent=e.message;buttons.forEach(b=>b.disabled=false);}}document.getElementById('yes').onclick=()=>go('confirm');document.getElementById('no').onclick=()=>go('decline');</script>`;
      res.set({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.send(shell("Einwilligung bestätigen", body));
    } catch (error) { console.error("[Opt-in] Seite:", error instanceof Error ? error.message : error); return res.status(500).send(shell("Fehler", "<h1>Fehler</h1><p>Die Seite konnte nicht geladen werden.</p>")); }
  });
  app.post("/api/opt-in/:token/confirm", async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).json({ error: "Gerade nicht erreichbar." });
    try { return res.json(await optIn.confirmOptIn(db, String(req.params.token), { ip: clientIp(req), userAgent: req.get("user-agent") ?? null })); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Fehler" }); }
  });
  app.post("/api/opt-in/:token/decline", async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).json({ error: "Gerade nicht erreichbar." });
    try { return res.json(await optIn.declineOptIn(db, String(req.params.token))); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Fehler" }); }
  });
  app.get("/api/opt-in/nachweis/:token.pdf", async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).send("Gerade nicht erreichbar.");
    try {
      const proof = await optIn.optInProof(db, { proofToken: String(req.params.token) }); if (!proof) return res.status(404).send("Nicht gefunden.");
      res.set({ "content-type": "application/pdf", "content-disposition": `inline; filename="${proof.fileName.replace(/"/g, "")}"`, "cache-control": "no-store", "x-robots-tag": "noindex" }); return res.send(Buffer.from(proof.buffer));
    } catch (error) { console.error("[Opt-in] Nachweis:", error instanceof Error ? error.message : error); return res.status(500).send("Nachweis konnte nicht erstellt werden."); }
  });
}
