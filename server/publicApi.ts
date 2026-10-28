import type { Express, Request, Response } from "express";
import { and, eq, isNull, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { apiTokens, categoryFields, claimEvents, claims, deliveryStopReasons, deliveryStops, invoices, leadCategories, leadDeliveries, leadStatusEvents, leads, memberOperationalSettings, memberships, orderOperationalConfigs, reclamationReasons, supplierInboundMappings, suppliers, metaConnections } from "../drizzle/schema";
import { deliverLeadNow, loadDeliverySettings, triggerLeadAutomations } from "./lead-pipeline";
import { checkPhoneNumber, handleWattfoxCallback } from "./partner-accounts";
import { ingestDialerCall } from "./call-qa";
import { desc, sql } from "drizzle-orm";
import { getDb } from "./db";
import { registerContractRoutes } from "./contract-routes";
import * as metaAds from "./meta-ads";
import * as outreach from "./sales-outreach";
import * as pipelineExtras from "./pipeline-extras";
import * as mailEvents from "./mail-events";
import { emailCampaignRecipients } from "../drizzle/schema";

async function verifyBearer(req: Request, scope: string) {
  const value = req.headers.authorization;
  if (!value?.startsWith("Bearer ")) return undefined;
  const tokenHash = createHash("sha256").update(value.slice(7)).digest("hex");
  const db = await getDb(); if (!db) return undefined;
  const record = (await db.select().from(apiTokens).where(and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt))).limit(1))[0];
  const scopes = Array.isArray(record?.scopes) ? record.scopes : [];
  if (!record || !scopes.includes(scope)) return undefined;
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, record.id));
  return { db, tenantId: record.tenantId, tokenId: record.id, membershipId: record.membershipId ?? null };
}

/** Max. 120 Importe pro Minute je Token (persönliche Lieferanten-Tokens). */
const importWindows = new Map<number, number[]>();
function rateLimited(tokenId: number, limit = 120) {
  const now = Date.now(); const stamps = (importWindows.get(tokenId) ?? []).filter((stamp) => now - stamp < 60_000);
  if (stamps.length >= limit) { importWindows.set(tokenId, stamps); return true; }
  stamps.push(now); importWindows.set(tokenId, stamps); return false;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

export function registerPublicApiRoutes(app: Express) {
  registerContractRoutes(app); // Verträge: öffentliche Unterschriften-Seite
  app.post("/api/v1/leads", async (req: Request, res: Response) => {
    const auth = await verifyBearer(req, "leads:write"); if (!auth) return res.status(401).json({ error: "Unauthorized" });
    if (auth.membershipId && rateLimited(auth.tokenId)) return res.status(429).json({ error: "rate limited (120 imports per minute)" });
    const body = req.body as Record<string, unknown>;
    // Persönlicher Lieferanten-Token: Lieferant, eingehende Mappings (Kategorie, Feldnamen, Werte) und PrePing dieses Benutzers
    const supplierContext = auth.membershipId ? await loadSupplierContext(auth.db, auth.tenantId, auth.membershipId) : null;
    let categoryId = Number(body.categoryId);
    const foreignCategory = text(body.lead_type_id ?? body.leadType ?? body.categoryShortcode ?? body.category);
    if (!Number.isInteger(categoryId) || categoryId < 1) {
      const tenantCategories = await auth.db.select({ id: leadCategories.id, shortcode: leadCategories.shortcode, name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.tenantId, auth.tenantId));
      const mapped = supplierContext?.categoryMappings.get(foreignCategory.toLowerCase());
      const match = mapped ? tenantCategories.find((row) => row.id === mapped) : tenantCategories.find((row) => row.shortcode.toLowerCase() === foreignCategory.toLowerCase() || row.name.toLowerCase() === foreignCategory.toLowerCase());
      if (!match) return res.status(422).json({ error: foreignCategory ? "Lead type not found" : "categoryId or lead_type_id is required" });
      categoryId = match.id;
    }
    if (supplierContext) {
      const metadataIn = body.metadata && typeof body.metadata === "object" ? { ...(body.metadata as Record<string, unknown>) } : {};
      const customData = body.custom_data && typeof body.custom_data === "object" ? (body.custom_data as Record<string, unknown>) : {};
      const merged: Record<string, unknown> = { ...customData, ...metadataIn };
      const fields = await auth.db.select({ fieldKey: categoryFields.fieldKey, options: categoryFields.options }).from(categoryFields).where(eq(categoryFields.categoryId, categoryId));
      const known = new Map(fields.map((field) => [field.fieldKey, field]));
      const translated: Record<string, unknown> = {}; const dropped: string[] = [];
      for (const [rawKey, rawValue] of Object.entries(merged)) {
        const key = supplierContext.fieldMappings.get(rawKey.toLowerCase()) ?? rawKey;
        const valueRules = supplierContext.valueMappings.get(`${categoryId}:${key}`);
        let value = rawValue;
        if (valueRules && typeof rawValue === "string") {
          const hit = valueRules.rules.get(rawValue.trim().toLowerCase());
          if (hit !== undefined) value = hit;
          else if (valueRules.strict) { const options = Array.isArray(known.get(key)?.options) ? (known.get(key)!.options as unknown[]).map(String) : []; if (options.length && !options.includes(rawValue.trim())) { dropped.push(`${key} (invalid_value)`); continue; } }
        }
        translated[key] = value;
      }
      body.metadata = translated;
      if (dropped.length) (translated as Record<string, unknown>).__importNotes = `Verworfen beim Import: ${dropped.join(", ")}`;
      if (!body.firstName && typeof body.first_name === "string") body.firstName = body.first_name;
      if (!body.lastName && typeof body.last_name === "string") body.lastName = body.last_name;
      if (!body.postcode && typeof body.zip_code === "string") body.postcode = body.zip_code;
      if (!body.country && typeof body.country_code === "string") body.country = body.country_code;
      if (!body.supplierId) body.supplierId = supplierContext.supplierId ?? undefined;
      // Eingehendes PrePing: doppelte Kontakte sofort mit 409 ablehnen
      const tenantSettings = await loadDeliverySettings(auth.db, auth.tenantId);
      if (tenantSettings.incomingPrePing && supplierContext.inboundPrePing) {
        const email = text(body.email).toLowerCase(); const phone = text(body.phone);
        const clauses = [] as ReturnType<typeof eq>[]; if (email && tenantSettings.duplicateFields.includes("email")) clauses.push(eq(leads.email, email)); if (phone && tenantSettings.duplicateFields.includes("phone")) clauses.push(eq(leads.phone, phone));
        if (clauses.length) {
          const twin = (await auth.db.select({ id: leads.id, publicId: leads.publicId, createdAt: leads.createdAt }).from(leads).where(and(eq(leads.tenantId, auth.tenantId), eq(leads.kind, "verkauf"), or(...clauses))).limit(1))[0];
          if (twin && (!tenantSettings.duplicateWindowHours || Date.now() - twin.createdAt.getTime() < tenantSettings.duplicateWindowHours * 3_600_000)) return res.status(409).json({ error: "duplicated lead", existingLeadId: twin.publicId });
        }
      }
    }
    if (!body.firstName && !body.lastName) return res.status(422).json({ error: "firstName or lastName is required" });
    const publicId = `API-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    // Lieferant auflösen: explizite supplierId (muss zum Mandanten gehören) oder Name des Lieferanten
    const supplierName = typeof body.supplierName === "string" ? body.supplierName.trim() : "";
    const tenantSuppliers = await auth.db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.tenantId, auth.tenantId));
    const supplierById = Number.isInteger(Number(body.supplierId)) ? tenantSuppliers.find((row) => row.id === Number(body.supplierId)) : undefined;
    if (auth.membershipId && !supplierById) return res.status(403).json({ error: "supplier profile missing for this token" });
    const supplier = supplierById ?? (supplierName ? tenantSuppliers.find((row) => row.name.toLowerCase() === supplierName.toLowerCase()) : undefined);
    const cost = typeof body.cost === "number" && Number.isFinite(body.cost) && body.cost >= 0 ? body.cost.toFixed(2) : "0.00";
    const inserted = await auth.db.insert(leads).values({ tenantId: auth.tenantId, publicId, categoryId, firstName: typeof body.firstName === "string" ? body.firstName : undefined, lastName: typeof body.lastName === "string" ? body.lastName : undefined, email: typeof body.email === "string" ? body.email : undefined, phone: typeof body.phone === "string" ? body.phone : undefined, postcode: typeof body.postcode === "string" ? body.postcode : undefined, city: typeof body.city === "string" ? body.city : undefined, country: body.country === "AT" || body.country === "CH" ? body.country : "DE", supplierId: supplier?.id, supplierName: supplier?.name ?? (supplierName || undefined), metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : undefined, status: "neu", cost });
    const leadId = Number(inserted[0]?.insertId) || 0;
    if (leadId && typeof body.phone === "string" && body.phone.trim()) {
      const phoneCheck = await checkPhoneNumber(auth.db, auth.tenantId, body.phone);
      if (phoneCheck.checked && phoneCheck.valid !== null) {
        const metadata = body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : {};
        await auth.db.update(leads).set({ metadata: { ...metadata, phoneCheck: { valid: phoneCheck.valid, network: phoneCheck.network ?? null, checkedAt: new Date().toISOString() } }, ...(phoneCheck.valid ? {} : { status: "fehlerhaft" as const }) }).where(eq(leads.id, leadId));
        if (!phoneCheck.valid) await auth.db.insert(leadStatusEvents).values({ tenantId: auth.tenantId, leadId, previousStatus: "neu", nextStatus: "fehlerhaft", actorUserId: null, note: "Telefonnummern-Prüfung (hlrlookup): Nummer ungültig – Lead als fehlerhaft markiert." });
      }
    }
    if (leadId) {
      const importNote = body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>).__importNotes : undefined;
      await auth.db.insert(leadStatusEvents).values({ tenantId: auth.tenantId, leadId, nextStatus: "neu", actorUserId: null, note: typeof importNote === "string" ? `Lead über die REST-API angelegt. ${importNote}` : "Lead über die REST-API angelegt." });
    }
    const automation = leadId ? await triggerLeadAutomations(auth.db, { tenantId: auth.tenantId, actorUserId: null, leadId, triggerType: "lead_erstellt" }) : { executed: 0, duplicated: 0, delivered: 0 };
    return res.status(201).json({ id: publicId, status: "neu", supplierId: supplier?.id ?? null, automation });
  });
  app.post("/api/v1/claims", async (req: Request, res: Response) => {
    const auth = await verifyBearer(req, "claims:write"); if (!auth) return res.status(401).json({ error: "Unauthorized" });
    const body = req.body as Record<string, unknown>; const publicId = typeof body.leadId === "string" ? body.leadId : ""; const reason = typeof body.reason === "string" ? body.reason.trim() : ""; if (!publicId || !reason) return res.status(422).json({ error: "leadId and reason are required" });
    const lead = (await auth.db.select().from(leads).where(and(eq(leads.tenantId, auth.tenantId), eq(leads.kind, "verkauf"), eq(leads.publicId, publicId))).limit(1))[0]; if (!lead) return res.status(404).json({ error: "Lead not found" });
    await auth.db.insert(claims).values({ tenantId: auth.tenantId, leadId: lead.id, reason, details: typeof body.details === "string" ? body.details : undefined, status: "offen" }); return res.status(201).json({ status: "offen", leadId: publicId });
  });
  /** Reklamation per API (persönlicher Token des Käufers): reason + lead_number | lead_id | partner_lead_id, optional comment. */
  const reclaimHandler = async (req: Request, res: Response) => {
    const auth = await verifyBearer(req, "leads:write"); if (!auth) return res.status(401).json({ error: "Unauthorized" });
    if (!auth.membershipId) return res.status(403).json({ error: "a personal buyer token is required (tenant-wide tokens are rejected)" });
    const body = req.body as Record<string, unknown>;
    const reasonKey = text(body.reason); if (!reasonKey) return res.status(422).json({ error: "reason is required" });
    const membership = (await auth.db.select().from(memberships).where(and(eq(memberships.id, auth.membershipId), eq(memberships.tenantId, auth.tenantId))).limit(1))[0];
    if (!membership) return res.status(403).json({ error: "membership not found" });
    const settings = (await auth.db.select().from(memberOperationalSettings).where(eq(memberOperationalSettings.membershipId, membership.id)).limit(1))[0];
    // Lead auflösen
    const leadNumber = Number(body.lead_number); const leadId = text(body.lead_id ?? body.leadId); const partnerRef = text(body.partner_lead_id);
    let lead = Number.isInteger(leadNumber) && leadNumber > 0 ? (await auth.db.select().from(leads).where(and(eq(leads.tenantId, auth.tenantId), eq(leads.kind, "verkauf"), eq(leads.id, leadNumber))).limit(1))[0] : undefined;
    if (!lead && leadId) lead = (await auth.db.select().from(leads).where(and(eq(leads.tenantId, auth.tenantId), eq(leads.kind, "verkauf"), eq(leads.publicId, leadId))).limit(1))[0];
    if (!lead && partnerRef) lead = (await auth.db.select().from(leads).where(and(eq(leads.tenantId, auth.tenantId), eq(leads.kind, "verkauf"), sql`JSON_UNQUOTE(JSON_EXTRACT(${leads.metadata}, '$.partnerReference')) = ${partnerRef}`)).limit(1))[0];
    if (!lead) return res.status(404).json({ error: "no matching lead assigned to this buyer" });
    // Zuteilung an diesen Käufer prüfen (letzte Zustellung)
    const viaOrder = (await auth.db.select({ delivery: leadDeliveries }).from(leadDeliveries).innerJoin(orderOperationalConfigs, eq(orderOperationalConfigs.orderId, leadDeliveries.orderId)).where(and(eq(leadDeliveries.tenantId, auth.tenantId), eq(leadDeliveries.leadId, lead.id), eq(orderOperationalConfigs.buyerUserId, membership.userId))).orderBy(desc(leadDeliveries.occurredAt)).limit(1))[0];
    const viaStop = (await auth.db.select({ delivery: leadDeliveries }).from(leadDeliveries).innerJoin(deliveryStops, eq(deliveryStops.id, leadDeliveries.stopId)).where(and(eq(leadDeliveries.tenantId, auth.tenantId), eq(leadDeliveries.leadId, lead.id), eq(deliveryStops.buyerUserId, membership.userId))).orderBy(desc(leadDeliveries.occurredAt)).limit(1))[0];
    const delivery = [viaOrder, viaStop].filter((item): item is NonNullable<typeof item> => Boolean(item)).sort((a, b) => b.delivery.occurredAt.getTime() - a.delivery.occurredAt.getTime())[0];
    if (!delivery || delivery.delivery.result === "abgelehnt" || delivery.delivery.result === "übersprungen") return res.status(404).json({ error: "no matching lead assigned to this buyer" });
    // Reklamationsfenster: das des Stops (0 h = sofort angenommen, keine Reklamation), sonst das des Käufer-Kontos
    if (delivery.delivery.windowEndsAt) { if (delivery.delivery.windowEndsAt.getTime() <= delivery.delivery.occurredAt.getTime()) return res.status(403).json({ error: "no reclamation possible for this delivery (accepted immediately)" }); if (Date.now() > delivery.delivery.windowEndsAt.getTime()) return res.status(403).json({ error: "reclamation window expired" }); }
    else { const windowHours = settings?.reclamationPeriodHours ?? 24; if (Date.now() - delivery.delivery.occurredAt.getTime() > windowHours * 3_600_000) return res.status(403).json({ error: "reclamation window expired" }); }
    const blocked = Array.isArray(settings?.blockedClaimCategoryIds) ? (settings!.blockedClaimCategoryIds as unknown[]).map(Number) : [];
    if (blocked.includes(lead.categoryId)) return res.status(403).json({ error: "reclamations are blocked for this lead type" });
    // Grund auflösen (Key = Name in snake_case, Aliasse wie duplikat/storno)
    const reasons = await auth.db.select().from(reclamationReasons).where(and(eq(reclamationReasons.tenantId, auth.tenantId), eq(reclamationReasons.active, true)));
    const slug = (value: string) => value.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const aliases: Record<string, string> = { duplikat: "dublette", storno: "storno", zustellung_fehlgeschlagen: "zustellung_fehlgeschlagen_api", falsche_telefonnummer: "falsche_telefonnummer", kontaktdaten_fehlen: "kontaktdaten_fehlen", kein_partner: "kein_partner", sperrliste: "sperrliste" };
    const wanted = aliases[slug(reasonKey)] ?? slug(reasonKey);
    const excluded = Array.isArray(settings?.excludedClaimReasonIds) ? (settings!.excludedClaimReasonIds as unknown[]).map(Number) : [];
    const reason = reasons.find((row) => slug(row.name) === wanted);
    if (!reason) return res.status(422).json({ error: "unknown reason", valid: reasons.filter((row) => !excluded.includes(row.id)).map((row) => slug(row.name)) });
    if (excluded.includes(reason.id)) return res.status(403).json({ error: "reason not allowed for this buyer" });
    const stopRule = delivery.delivery.stopId ? (await auth.db.select().from(deliveryStopReasons).where(and(eq(deliveryStopReasons.stopId, delivery.delivery.stopId), eq(deliveryStopReasons.reasonId, reason.id))).limit(1))[0] : undefined;
    if (stopRule && !stopRule.allowed) return res.status(403).json({ error: "reason not allowed for this buyer" });
    const open = (await auth.db.select({ id: claims.id, status: claims.status }).from(claims).where(and(eq(claims.tenantId, auth.tenantId), eq(claims.leadId, lead.id))).orderBy(desc(claims.createdAt)).limit(1))[0];
    if (open && (open.status === "offen" || open.status === "in_prüfung" || open.status === "genehmigt")) return res.status(409).json({ error: "already reclaimed" });
    if (lead.status !== "zugewiesen") return res.status(409).json({ error: "lead is not in a reclaimable state" });
    const autoAccept = settings?.autoAcceptApiClaims ?? false;
    const comment = text(body.comment);
    const inserted = await auth.db.insert(claims).values({ tenantId: auth.tenantId, leadId: lead.id, reason: reason.name, details: comment || `Per API gemeldet (${reasonKey})`, status: autoAccept ? "genehmigt" : "offen", refundAmount: autoAccept ? delivery.delivery.unitPrice : null, dueAt: new Date(Date.now() + 7 * 24 * 3_600_000), resolvedAt: autoAccept ? new Date() : null });
    const claimId = Number(inserted[0]?.insertId) || 0;
    await auth.db.insert(claimEvents).values({ tenantId: auth.tenantId, claimId, eventType: "erstellt", nextStatus: autoAccept ? "genehmigt" : "offen", actorUserId: null, note: `Reklamation über die API (${reason.name})${autoAccept ? " – automatisch genehmigt" : ""}` });
    let reinjected = false;
    await auth.db.update(leadDeliveries).set({ result: "reklamiert", claimId }).where(eq(leadDeliveries.id, delivery.delivery.id));
    if (autoAccept) {
      await auth.db.update(leads).set({ status: "reklamiert" }).where(eq(leads.id, lead.id));
      await auth.db.insert(leadStatusEvents).values({ tenantId: auth.tenantId, leadId: lead.id, previousStatus: lead.status, nextStatus: "reklamiert", actorUserId: null, note: `API-Reklamation genehmigt: ${reason.name}` });
      if (stopRule ? stopRule.passOn : reason.forwardToNextStop) {
        // Wasserfall: weiter in derselben Kette (der reklamierende Käufer wird als Dublette übersprungen), danach weitere Ketten/Bestellungen
        try { const result = await deliverLeadNow(auth.db, { tenantId: auth.tenantId, actorUserId: null, lead: { ...lead, status: "reklamiert" }, allowRepeat: true, ignoreAssignment: !delivery.delivery.chainId, preferChainId: delivery.delivery.chainId ?? null, passedOn: true }); reinjected = result.result !== "abgelehnt"; } catch { reinjected = false; }
      }
    }
    return res.status(200).json({ reclamation_id: claimId, reinjected, refund_cents: autoAccept ? Math.round(Number(delivery.delivery.unitPrice) * 100) : 0, status: autoAccept ? "approved" : "open" });
  };
  /** WattFox-Tracking-URL (GET oder POST): Statusmeldungen des Partners je Konto-Token. */
  const wattfoxHandler = async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).json({ error: "database unavailable" });
    const params = { ...(req.query as Record<string, unknown>), ...((req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>) };
    const result = await handleWattfoxCallback(db, String(req.params.token ?? ""), params);
    return res.status(result.status).json(result.body);
  };
  /** Dialer-Webhook (OnDialer u. a.): beendetes Gespräch mit Aufzeichnung → Transkription → Bewertung → Entscheidung. */
  const dialerHandler = async (req: Request, res: Response) => {
    const db = await getDb(); if (!db) return res.status(503).json({ error: "database unavailable" });
    const params = { ...(req.query as Record<string, unknown>), ...((req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>) };
    const result = await ingestDialerCall(db, String(req.params.token ?? ""), params);
    return res.status(result.status).json(result.body);
  };
  app.post("/api/partner/dialer/:token", dialerHandler);
  app.post("/api/partner/ondialer/:token", dialerHandler);
  app.get("/api/partner/wattfox/:token", wattfoxHandler);
  app.post("/api/partner/wattfox/:token", wattfoxHandler);
  // ---- Meta Lead Ads: Webhook-Prüfung (GET) und neue Leads (POST), Facebook-Login-Rückruf
  app.get("/api/meta/webhook", async (req: Request, res: Response) => {
    const mode = String(req.query["hub.mode"] ?? ""); const token = String(req.query["hub.verify_token"] ?? ""); const challenge = String(req.query["hub.challenge"] ?? "");
    const db = await getDb(); if (!db || mode !== "subscribe" || !token) return res.status(403).send("Forbidden");
    const match = (await db.select({ id: metaConnections.id }).from(metaConnections).where(eq(metaConnections.verifyToken, token)).limit(1))[0];
    if (!match) return res.status(403).send("Forbidden");
    return res.status(200).send(challenge);
  });
  app.post("/api/meta/webhook", async (req: Request, res: Response) => {
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    if (!metaAds.verifyWebhookSignature(raw, req.get("x-hub-signature-256"))) return res.status(401).json({ error: "invalid signature" });
    const db = await getDb(); if (!db) return res.status(503).json({ error: "database unavailable" });
    const body = req.body as { object?: string; entry?: Array<{ changes?: Array<{ field?: string; value?: metaAds.LeadgenChange }> }> };
    res.status(200).json({ received: true }); // Meta erwartet eine schnelle Antwort – Verarbeitung danach
    try { for (const entry of body.entry ?? []) for (const change of entry.changes ?? []) if (change.field === "leadgen" && change.value?.leadgen_id) await metaAds.importLeadgen(db, change.value); } catch (error) { console.error("[Meta] Lead-Import fehlgeschlagen:", error); }
  });
  // ---- E-Mail-Kampagnen: Öffnungs-Pixel, Klick-Weiterleitung, Abmeldung
  app.get("/api/mail/o/:token.gif", async (req: Request, res: Response) => { const db = await getDb(); if (db) await outreach.trackOpen(db, String(req.params.token), { userAgent: req.get("user-agent") ?? null, method: req.method }).catch(() => false); res.set({ "content-type": "image/gif", "cache-control": "no-store" }); return res.send(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64")); });
  app.get("/api/mail/c/:token", async (req: Request, res: Response) => { const db = await getDb(); const url = String(req.query.u ?? ""); const target = db ? await outreach.trackClick(db, String(req.params.token), url, { userAgent: req.get("user-agent") ?? null, method: req.method }).catch(() => null) : null; return target ? res.redirect(target) : res.status(400).send("Ungültiger Link"); });
  // Bounce-/Beschwerde-Webhook des Mail-Anbieters (Brevo, Mailgun, Postmark, SES-SNS …): Adresse sperren, laufende Serien stoppen. Absicherung über MAIL_WEBHOOK_SECRET (?secret=… oder Header x-webhook-secret).
  app.post("/api/mail/bounce", async (req: Request, res: Response) => {
    const secret = process.env.MAIL_WEBHOOK_SECRET; if (secret && String(req.query.secret ?? req.get("x-webhook-secret") ?? "") !== secret) return res.status(401).json({ error: "Ungültiges Geheimnis" });
    const db = await getDb(); if (!db) return res.status(503).json({ error: "Datenbank nicht verfügbar" });
    const body = (req.body ?? {}) as Record<string, unknown>; const events = Array.isArray(body) ? (body as Array<Record<string, unknown>>) : Array.isArray(body.events) ? (body.events as Array<Record<string, unknown>>) : [body];
    let handled = 0;
    for (const event of events) {
      const email = String(event.email ?? event.recipient ?? event.Email ?? (event.message as { recipient?: string } | undefined)?.recipient ?? "").toLowerCase(); if (!email) continue;
      const type = String(event.event ?? event.type ?? event.RecordType ?? event["event-data"] ?? "").toLowerCase();
      // Öffnen/Klicken (Brevo „opened“, „click“ …): beim Kampagnen-Empfänger eintragen – zählt auch bei „Persönlich senden“
      const seen = mailEvents.providerEventKind(type); if (seen) { const when = event.date ?? event.ts_event ?? event.timestamp ?? event.ReceivedAt; const at = typeof when === "number" ? new Date(when * (when < 1e12 ? 1000 : 1)) : when ? new Date(String(when)) : null; if (await mailEvents.applyProviderEvent(db, { email, messageId: String(event["message-id"] ?? event.messageId ?? event.MessageID ?? (event.message as { headers?: { "message-id"?: string } } | undefined)?.headers?.["message-id"] ?? ""), kind: seen, url: String(event.link ?? event.url ?? event.OriginalLink ?? ""), at, tenantId: Number(req.query.tenant ?? 0) || null }).catch(() => false)) handled += 1; continue; }
      // Zustellung (Brevo „delivered“, „deferred“, „hard_bounce“ …) bei der gesendeten E-Mail eintragen – stoppen und sperren macht unten der alte Weg
      const delivery = mailEvents.deliveryStatusOf(type); if (delivery) { const when = event.date ?? event.ts_event ?? event.timestamp; const at = typeof when === "number" ? new Date(when * (when < 1e12 ? 1000 : 1)) : when ? new Date(String(when)) : null; await mailEvents.applyDeliveryEvent(db, { tenantId: Number(req.query.tenant ?? body.tenantId ?? 0) || null, email, messageId: String(event["message-id"] ?? event.messageId ?? event.MessageID ?? ""), status: delivery, reason: typeof event.reason === "string" ? event.reason : null, at, stop: false }).catch(() => false); if (delivery === "zugestellt" || delivery === "verzoegert") { handled += 1; continue; } }
      const kind = /complain|spam|beschwerde/.test(type) ? "beschwerde" : /bounce|hard|blocked|invalid|unzustell|dropped|failed/.test(type) ? "bounce" : null; if (!kind) continue;
      const tenantId = Number(req.query.tenant ?? body.tenantId ?? 0) || (await db.select({ tenantId: emailCampaignRecipients.tenantId }).from(emailCampaignRecipients).where(eq(emailCampaignRecipients.email, email)).limit(1))[0]?.tenantId; if (!tenantId) continue;
      await pipelineExtras.markBounced(db, tenantId, { email, kind, note: `Webhook: ${type}`.slice(0, 400) }).catch(() => null); handled += 1;
    }
    return res.json({ handled });
  });
  app.get("/api/mail/u/:token", async (req: Request, res: Response) => { const db = await getDb(); const ok = db ? await outreach.unsubscribe(db, String(req.params.token)).catch(() => false) : false; return res.status(ok ? 200 : 404).send(ok ? "Du wurdest abgemeldet und bekommst keine weiteren E-Mails dieser Kampagne." : "Unbekannter Link"); });
  app.get("/api/meta/oauth/callback", async (req: Request, res: Response) => {
    const db = await getDb(); const code = String(req.query.code ?? ""); const state = String(req.query.state ?? ""); const appUrl = process.env.APP_URL ?? `${req.protocol}://${req.get("host")}`;
    if (!db || !code || !state) return res.redirect("/?page=Vertriebspipeline&meta=fehler");
    try { await metaAds.completeOauth(db, code, state, appUrl); return res.redirect("/?page=Vertriebspipeline&meta=verbunden"); } catch (error) { console.error("[Meta] OAuth fehlgeschlagen:", error); return res.redirect("/?page=Vertriebspipeline&meta=fehler"); }
  });
  app.post("/api/v1/reclaim", reclaimHandler);
  app.post("/api/reclaim", reclaimHandler);
  app.post("/api/leads", (req: Request, res: Response, next) => { req.url = "/api/v1/leads"; next(); });
  app.get("/api/v1/invoices", async (req: Request, res: Response) => {
    const auth = await verifyBearer(req, "invoices:read"); if (!auth) return res.status(401).json({ error: "Unauthorized" });
    const records = await auth.db.select({ number: invoices.invoiceNumber, recipient: invoices.recipientName, amount: invoices.amount, status: invoices.status, dueAt: invoices.dueAt, createdAt: invoices.createdAt }).from(invoices).where(eq(invoices.tenantId, auth.tenantId));
    return res.json({ invoices: records });
  });
}

type SupplierContext = { supplierId: number | null; inboundPrePing: boolean; categoryMappings: Map<string, number>; fieldMappings: Map<string, string>; valueMappings: Map<string, { strict: boolean; rules: Map<string, string> }> };

async function loadSupplierContext(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, tenantId: number, membershipId: number): Promise<SupplierContext> {
  const membership = (await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, tenantId))).limit(1))[0];
  const supplier = membership ? (await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.userId, membership.userId))).limit(1))[0] : undefined;
  const settings = (await db.select({ inboundPrePing: memberOperationalSettings.inboundPrePing }).from(memberOperationalSettings).where(eq(memberOperationalSettings.membershipId, membershipId)).limit(1))[0];
  const rows = await db.select().from(supplierInboundMappings).where(and(eq(supplierInboundMappings.tenantId, tenantId), eq(supplierInboundMappings.membershipId, membershipId)));
  const categoryMappings = new Map<string, number>(); const fieldMappings = new Map<string, string>(); const valueMappings = new Map<string, { strict: boolean; rules: Map<string, string> }>();
  for (const row of rows) {
    if (row.kind === "kategorie") categoryMappings.set(row.sourceValue.toLowerCase(), Number(row.targetValue));
    else if (row.kind === "feld") fieldMappings.set(row.sourceValue.toLowerCase(), row.targetValue);
    else if (row.kind === "wert" && row.categoryId && row.fieldKey) { const key = `${row.categoryId}:${row.fieldKey}`; const entry = valueMappings.get(key) ?? { strict: false, rules: new Map() }; entry.strict = entry.strict || row.strict; entry.rules.set(row.sourceValue.toLowerCase(), row.targetValue); valueMappings.set(key, entry); }
  }
  return { supplierId: supplier?.id ?? null, inboundPrePing: settings?.inboundPrePing ?? true, categoryMappings, fieldMappings, valueMappings };
}
