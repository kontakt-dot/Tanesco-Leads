/**
 * Öffnungen und Klicks vom Versanddienst übernehmen.
 *
 * Bei „Persönlich senden“ (und wenn Bilder blockiert sind) kann die Software Öffnungen nicht selbst messen – es gibt
 * kein eigenes Zählpixel und keine umgeschriebenen Links. Der Versanddienst (Brevo) misst sie aber trotzdem. Diese Datei
 * holt die Ereignisse ab (Brevo-HTTP-Schnittstelle, alle 10 Minuten) bzw. nimmt sie per Webhook an und trägt sie beim
 * passenden Kampagnen-Empfänger ein – über die Message-ID der gesendeten E-Mail, sonst über die E-Mail-Adresse.
 * Doppelte Meldungen zählen nicht doppelt.
 */
import { and, asc, desc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { emailCampaignEvents, emailCampaignRecipients, mailSettings } from "../drizzle/schema";
import { normalizeMessageId } from "../shared/message-id";
import { isTooSoonAfterSend } from "../shared/tracking-guard";
import { brevoGet } from "./brevo-api";
import type { Db } from "./lead-pipeline";

export type ProviderEvent = { email: string; messageId?: string | null; kind: "open" | "click"; url?: string | null; at?: Date | null; tenantId?: number | null };

/** Ein gemeldetes Öffnen/Klicken eintragen. Gibt zurück, ob etwas Neues eingetragen wurde. */
export async function applyProviderEvent(db: Db, input: ProviderEvent): Promise<boolean> {
  const email = input.email.trim().toLowerCase(); if (!email) return false;
  const messageId = normalizeMessageId(input.messageId);
  let recipientId: number | null = null;
  if (messageId) recipientId = (await db.select({ recipientId: emailCampaignEvents.recipientId }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.messageId, messageId), eq(emailCampaignEvents.kind, "gesendet"))).limit(1))[0]?.recipientId ?? null;
  if (!recipientId) recipientId = (await db.select({ id: emailCampaignRecipients.id }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.email, email), ...(input.tenantId ? [eq(emailCampaignRecipients.tenantId, input.tenantId)] : []), isNotNull(emailCampaignRecipients.lastSentAt))).orderBy(desc(emailCampaignRecipients.lastSentAt)).limit(1))[0]?.id ?? null;
  if (!recipientId) return false;
  const recipient = (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, recipientId)).limit(1))[0]; if (!recipient) return false;
  const at = input.at && !Number.isNaN(input.at.getTime()) && input.at.getTime() <= Date.now() + 60_000 ? input.at : new Date();
  if (recipient.lastSentAt && (at.getTime() < new Date(recipient.lastSentAt).getTime() - 2_000 || isTooSoonAfterSend(recipient.lastSentAt, at))) return false; // vor dem letzten Versand (alte Mail) oder Sekunden danach (Scanner)
  const unopened = !recipient.openedAt || (recipient.lastSentAt && recipient.openedAt < recipient.lastSentAt);
  if (input.kind === "open") {
    if (!unopened) return false; // schon gezählt – doppelte Meldung
    await db.update(emailCampaignRecipients).set({ openedAt: at }).where(eq(emailCampaignRecipients.id, recipient.id));
    await db.insert(emailCampaignEvents).values({ tenantId: recipient.tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: "geoeffnet", note: "E-Mail geöffnet (gemeldet vom Versanddienst)", createdAt: at });
    return true;
  }
  const url = /^https?:\/\//.test(input.url ?? "") ? String(input.url).slice(0, 400) : "";
  if (recipient.clickedAt && new Date(recipient.clickedAt).getTime() >= at.getTime() - 1_000) return false; // dieser Klick ist schon da
  const urls = url ? Array.from(new Set([...((Array.isArray(recipient.clickedUrls) ? recipient.clickedUrls : []) as string[]), url])).slice(-20) : (Array.isArray(recipient.clickedUrls) ? recipient.clickedUrls : []);
  await db.update(emailCampaignRecipients).set({ clickedAt: at, openedAt: unopened ? at : recipient.openedAt, clickedUrls: urls }).where(eq(emailCampaignRecipients.id, recipient.id));
  if (unopened) await db.insert(emailCampaignEvents).values({ tenantId: recipient.tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: "geoeffnet", note: "E-Mail geöffnet (über Link-Klick, gemeldet vom Versanddienst)", createdAt: at });
  await db.insert(emailCampaignEvents).values({ tenantId: recipient.tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: "geklickt", note: `Link geklickt${url ? `: ${url.slice(0, 200)}` : ""} (gemeldet vom Versanddienst)`, createdAt: at });
  return true;
}

/* ---------------------------------------------------------------- Zustellung: kam die E-Mail wirklich an? */
/** Zustand einer gesendeten E-Mail laut Versanddienst. „gesendet“ heißt nur „an den Versanddienst übergeben“ – erst das hier sagt, ob sie ankam. */
export type DeliveryStatus = "zugestellt" | "verzoegert" | "unzustellbar" | "blockiert" | "spam" | "fehler";
const DELIVERY_RANK: Record<DeliveryStatus, number> = { verzoegert: 1, zugestellt: 2, fehler: 3, spam: 3, blockiert: 4, unzustellbar: 4 };
/** Brevo-Ereignis (Abfrage „delivered“, „hardBounces“ … oder Webhook „delivered“, „hard_bounce“ …) → Zustand; null = kein Zustellungs-Ereignis. */
export function deliveryStatusOf(type: string): DeliveryStatus | null {
  const value = type.toLowerCase().replace(/[^a-z]/g, "");
  if (value === "delivered" || value === "delivery") return "zugestellt";
  if (value === "deferred" || value === "softbounce" || value === "softbounces") return "verzoegert";
  if (value === "hardbounce" || value === "hardbounces" || value === "invalid" || value === "invalidemail") return "unzustellbar";
  if (value === "blocked") return "blockiert";
  if (value === "spam" || value === "complaint") return "spam";
  if (value === "error") return "fehler";
  return null;
}
/**
 * Zustellungs-Meldung eintragen – bei der gesendeten E-Mail (über die Message-ID, sonst die letzte E-Mail an diese Adresse davor).
 * Ein schlechterer Zustand gewinnt („zugestellt“ → „Spam gemeldet“), doppelte Meldungen ändern nichts. Unzustellbar/Spam stoppen den
 * Kontakt und sperren die Adresse (wie der Knopf „Unzustellbar“) – `stop: false`, wenn das schon jemand anders erledigt (Webhook).
 */
export async function applyDeliveryEvent(db: Db, input: { tenantId?: number | null; email: string; messageId?: string | null; status: DeliveryStatus; reason?: string | null; at?: Date | null; stop?: boolean }): Promise<boolean> {
  const email = input.email.trim().toLowerCase(); const messageId = normalizeMessageId(input.messageId);
  const at = input.at && !Number.isNaN(input.at.getTime()) && input.at.getTime() <= Date.now() + 60_000 ? input.at : new Date();
  const pick = { id: emailCampaignEvents.id, tenantId: emailCampaignEvents.tenantId, recipientId: emailCampaignEvents.recipientId, delivery: emailCampaignEvents.delivery };
  let row = messageId ? (await db.select(pick).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.messageId, messageId), eq(emailCampaignEvents.kind, "gesendet"))).limit(1))[0] : undefined;
  if (!row && email) row = (await db.select(pick).from(emailCampaignEvents).innerJoin(emailCampaignRecipients, eq(emailCampaignRecipients.id, emailCampaignEvents.recipientId)).where(and(eq(emailCampaignEvents.kind, "gesendet"), eq(emailCampaignRecipients.email, email), ...(input.tenantId ? [eq(emailCampaignEvents.tenantId, input.tenantId)] : []), lte(emailCampaignEvents.createdAt, new Date(at.getTime() + 60_000)))).orderBy(desc(emailCampaignEvents.createdAt)).limit(1))[0];
  if (!row) return false;
  if ((DELIVERY_RANK[row.delivery as DeliveryStatus] ?? 0) >= DELIVERY_RANK[input.status]) return false; // schon so oder schlechter bekannt
  await db.update(emailCampaignEvents).set({ delivery: input.status, deliveryNote: (input.reason ?? "").trim().slice(0, 255) || null, deliveryAt: at }).where(eq(emailCampaignEvents.id, row.id));
  if (input.stop !== false && (input.status === "unzustellbar" || input.status === "spam")) { const { markBounced } = await import("./pipeline-extras"); await markBounced(db, row.tenantId, { recipientId: row.recipientId, kind: input.status === "spam" ? "beschwerde" : "bounce", note: `Versanddienst: ${input.reason?.trim() || (input.status === "spam" ? "als Spam gemeldet" : "unzustellbar")}`.slice(0, 400) }).catch(() => null); }
  return true;
}
const BREVO_DELIVERY_EVENTS = ["delivered", "deferred", "softBounces", "hardBounces", "invalid", "blocked", "spam", "error"] as const;

/** Webhook-Ereignisse verschiedener Anbieter erkennen: Brevo „opened/unique_opened/click“, Mailgun „opened/clicked“, Postmark „Open/Click“. */
export function providerEventKind(type: string): "open" | "click" | null {
  const value = type.toLowerCase();
  if (/proxy/.test(value)) return null; // Apple-Datenschutz lädt Bilder automatisch – kein echtes Öffnen
  if (/click/.test(value)) return "click";
  if (/open/.test(value)) return "open";
  return null;
}

type FetchLike = typeof fetch;
const lastSync = new Map<number, number>();
/** Brevo-HTTP: geöffnete und geklickte E-Mails der letzten zwei Tage abholen und eintragen (höchstens alle `everyMinutes`). */
export async function syncBrevoEvents(db: Db, options: { tenantId?: number | null; force?: boolean; everyMinutes?: number; fetchImpl?: FetchLike; days?: number } = {}) {
  const days = Math.max(1, Math.min(30, Math.round(options.days ?? 2))); // sonst die letzten zwei Tage; einmal nach dem Start eine Woche (Zustellung älterer E-Mails nachholen)
  const every = (options.everyMinutes ?? Number(process.env.EMAIL_EVENTS_SYNC_MINUTES ?? 10)) * 60_000;
  const rows = await db.select({ tenantId: mailSettings.tenantId, provider: mailSettings.provider, password: mailSettings.password, enabled: mailSettings.enabled }).from(mailSettings).where(options.tenantId ? eq(mailSettings.tenantId, options.tenantId) : eq(mailSettings.provider, "brevo_api"));
  let applied = 0; let checked = 0; const errors: string[] = [];
  for (const row of rows) {
    if (row.provider !== "brevo_api" || !row.password || row.enabled === false) continue;
    const last = lastSync.get(row.tenantId) ?? 0; if (!options.force && Date.now() - last < every) continue; lastSync.set(row.tenantId, Date.now());
    for (const event of ["opened", "clicks", ...BREVO_DELIVERY_EVENTS] as const) {
      for (let offset = 0; offset < 10_000; offset += 2500) {
        let body: unknown;
        try { body = await brevoGet(`/smtp/statistics/events?event=${event}&days=${days}&limit=2500&offset=${offset}&sort=desc`, row.password, { fetchImpl: options.fetchImpl }); }
        catch (error) { errors.push(error instanceof Error ? error.message : String(error)); break; }
        const list = (body && typeof body === "object" && Array.isArray((body as { events?: unknown }).events) ? (body as { events: Array<Record<string, unknown>> }).events : []);
        for (const item of list) {
          checked += 1; const email = String(item.email ?? ""); const messageId = String(item.messageId ?? item["message-id"] ?? ""); const at = item.date ? new Date(String(item.date)) : null;
          const status = event === "opened" || event === "clicks" ? null : deliveryStatusOf(event);
          if (status) { if (await applyDeliveryEvent(db, { tenantId: row.tenantId, email, messageId, status, reason: typeof item.reason === "string" ? item.reason : null, at }).catch(() => false)) applied += 1; continue; }
          const kind = event === "clicks" ? "click" : "open";
          if (await applyProviderEvent(db, { tenantId: row.tenantId, email, messageId, kind, url: typeof item.link === "string" ? item.link : null, at }).catch(() => false)) applied += 1;
        }
        if (list.length < 2500) break;
      }
    }
    // E-Mails, zu denen die Sammelabfrage nichts gebracht hat: gezielt je Empfänger-Adresse nachfragen
    const missing = await fillMissingDeliveries(db, { tenantId: row.tenantId, apiKey: row.password, limit: options.force ? 120 : 40, fetchImpl: options.fetchImpl }).catch((error) => { errors.push(error instanceof Error ? error.message : String(error)); return null; });
    if (missing) { applied += missing.applied; checked += missing.events; }
  }
  if (errors.length) console.error("[E-Mail-Ereignisse] Brevo:", errors[0]);
  return { applied, checked, errors };
}
const lookedUp = new Map<number, number>(); // gesendete Kampagnen-E-Mail → wann zuletzt gezielt nachgefragt
/**
 * Zustellung gezielt nachfragen: gesendete Kampagnen-E-Mails ohne Zustell-Meldung (älter als 20 Minuten, jünger als 30 Tage) – je
 * Empfänger-Adresse direkt beim Versanddienst (alle Meldungen dieser Adresse der letzten 30 Tage: Zustellung, Öffnen, Klick). So fehlt
 * keine Meldung, auch wenn die Sammelabfrage sie nicht erwischt (viele E-Mails im Konto, ältere Tage). Höchstens `limit` Adressen je
 * Lauf, jede höchstens alle sechs Stunden noch einmal.
 */
export async function fillMissingDeliveries(db: Db, options: { tenantId: number; apiKey: string; limit?: number; fetchImpl?: FetchLike; now?: number }) {
  const now = options.now ?? Date.now(); const limit = Math.max(1, Math.min(200, options.limit ?? 40));
  const rows = await db.select({ id: emailCampaignEvents.id, email: emailCampaignRecipients.email }).from(emailCampaignEvents).innerJoin(emailCampaignRecipients, eq(emailCampaignRecipients.id, emailCampaignEvents.recipientId))
    .where(and(eq(emailCampaignEvents.tenantId, options.tenantId), eq(emailCampaignEvents.kind, "gesendet"), isNull(emailCampaignEvents.delivery), gte(emailCampaignEvents.createdAt, new Date(now - 30 * 86_400_000)), lte(emailCampaignEvents.createdAt, new Date(now - 20 * 60_000))))
    .orderBy(asc(emailCampaignEvents.createdAt)).limit(1000);
  const emails: string[] = [];
  for (const row of rows) {
    if ((lookedUp.get(row.id) ?? 0) > now - 6 * 3_600_000) continue;
    const email = row.email.trim().toLowerCase(); if (!email) continue;
    if (!emails.includes(email)) { if (emails.length >= limit) continue; emails.push(email); }
    lookedUp.set(row.id, now);
  }
  let applied = 0; let events = 0;
  for (const email of emails) {
    const body = await brevoGet(`/smtp/statistics/events?email=${encodeURIComponent(email)}&days=30&limit=100&sort=desc`, options.apiKey, { fetchImpl: options.fetchImpl });
    const list = body && typeof body === "object" && Array.isArray((body as { events?: unknown }).events) ? (body as { events: Array<Record<string, unknown>> }).events : [];
    for (const item of list) {
      events += 1; const type = String(item.event ?? ""); const messageId = String(item.messageId ?? item["message-id"] ?? ""); const at = item.date ? new Date(String(item.date)) : null;
      const status = deliveryStatusOf(type);
      if (status) { if (await applyDeliveryEvent(db, { tenantId: options.tenantId, email: String(item.email ?? email), messageId, status, reason: typeof item.reason === "string" ? item.reason : null, at }).catch(() => false)) applied += 1; continue; }
      const kind = providerEventKind(type); if (!kind) continue;
      if (await applyProviderEvent(db, { tenantId: options.tenantId, email: String(item.email ?? email), messageId, kind, url: typeof item.link === "string" ? item.link : null, at }).catch(() => false)) applied += 1;
    }
  }
  return { emails: emails.length, events, applied };
}
