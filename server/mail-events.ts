/**
 * Öffnungen und Klicks vom Versanddienst übernehmen.
 *
 * Bei „Persönlich senden“ (und wenn Bilder blockiert sind) kann die Software Öffnungen nicht selbst messen – es gibt
 * kein eigenes Zählpixel und keine umgeschriebenen Links. Der Versanddienst (Brevo) misst sie aber trotzdem. Diese Datei
 * holt die Ereignisse ab (Brevo-HTTP-Schnittstelle, alle 10 Minuten) bzw. nimmt sie per Webhook an und trägt sie beim
 * passenden Kampagnen-Empfänger ein – über die Message-ID der gesendeten E-Mail, sonst über die E-Mail-Adresse.
 * Doppelte Meldungen zählen nicht doppelt.
 */
import { and, desc, eq, isNotNull } from "drizzle-orm";
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
export async function syncBrevoEvents(db: Db, options: { tenantId?: number | null; force?: boolean; everyMinutes?: number; fetchImpl?: FetchLike } = {}) {
  const every = (options.everyMinutes ?? Number(process.env.EMAIL_EVENTS_SYNC_MINUTES ?? 10)) * 60_000;
  const rows = await db.select({ tenantId: mailSettings.tenantId, provider: mailSettings.provider, password: mailSettings.password, enabled: mailSettings.enabled }).from(mailSettings).where(options.tenantId ? eq(mailSettings.tenantId, options.tenantId) : eq(mailSettings.provider, "brevo_api"));
  let applied = 0; let checked = 0; const errors: string[] = [];
  for (const row of rows) {
    if (row.provider !== "brevo_api" || !row.password || row.enabled === false) continue;
    const last = lastSync.get(row.tenantId) ?? 0; if (!options.force && Date.now() - last < every) continue; lastSync.set(row.tenantId, Date.now());
    for (const event of ["opened", "clicks"] as const) {
      for (let offset = 0; offset < 10_000; offset += 2500) {
        let body: unknown;
        try { body = await brevoGet(`/smtp/statistics/events?event=${event}&days=2&limit=2500&offset=${offset}&sort=desc`, row.password, { fetchImpl: options.fetchImpl }); }
        catch (error) { errors.push(error instanceof Error ? error.message : String(error)); break; }
        const list = (body && typeof body === "object" && Array.isArray((body as { events?: unknown }).events) ? (body as { events: Array<Record<string, unknown>> }).events : []);
        for (const item of list) {
          const kind = event === "clicks" ? "click" : "open"; checked += 1;
          if (await applyProviderEvent(db, { tenantId: row.tenantId, email: String(item.email ?? ""), messageId: String(item.messageId ?? item["message-id"] ?? ""), kind, url: typeof item.link === "string" ? item.link : null, at: item.date ? new Date(String(item.date)) : null }).catch(() => false)) applied += 1;
        }
        if (list.length < 2500) break;
      }
    }
  }
  if (errors.length) console.error("[E-Mail-Ereignisse] Brevo:", errors[0]);
  return { applied, checked, errors };
}
