/**
 * Zeitplaner für Auslieferungen ohne Echtzeit (Lieferintervall täglich/wöchentlich/monatlich) und für
 * Wiederholungen abgelehnter Übergaben.
 *
 *  - Kandidaten: Leads mit Bestellzuordnung (metadata.assignedOrderId), die noch nicht als „zugewiesen“ ausgeliefert sind.
 *  - Intervall: sofort → bei jedem Lauf; täglich → einmal pro Kalendertag; wöchentlich → einmal pro Kalenderwoche;
 *    monatlich → einmal pro Monat (Bezug: letzte Lieferung der Bestellung, MEZ/MESZ des Servers).
 *  - Echtzeit-Bestellungen: nur Wiederholung nach Ablehnung (Abstand ≥ RETRY_MINUTES, höchstens MAX_ATTEMPTS Versuche).
 *  - Reihenfolge: FIFO/LIFO nach Mandanteneinstellung, Bestellmenge und Konfiguration werden von deliverLeadNow geprüft.
 *
 * Start im Server: startDeliveryScheduler() – Intervall über DELIVERY_SCHEDULER_INTERVAL_MINUTES (Standard 15, 0 = aus).
 * Manuell: tRPC leadops.runScheduledDeliveries (Administratoren) oder runScheduledDeliveries(db, { tenantId }).
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { leadDeliveries, leadStatusEvents, leads, orderOperationalConfigs, orders, tenants } from "../drizzle/schema";
import { getDb } from "./db";
import { processDueEmails } from "./email-onboarding";
import { syncInsights } from "./meta-ads";
import { processEmailCampaigns, repairWaitingRecipients } from "./sales-outreach";
import { syncBrevoEvents } from "./mail-events";
import { processAutomations } from "./pipeline-extras";
import { syncInbox } from "./inbox";
import { tenantsWithImap } from "./mail-settings";
import { metaConnections } from "../drizzle/schema";
import { deliverLeadNow, loadDeliverySettings, metadataOf, type Db } from "./lead-pipeline";
import { intervalWindowOpen } from "./order-eligibility";
import { purgeExpiredCalls } from "./call-qa";
import { predictiveTick, releaseWrapUps, reconcileSipgateRecordings, syncSipgateCalls } from "./dialer";

export { intervalWindowOpen };

export const MAX_ATTEMPTS = 3;
export const RETRY_MINUTES = 30;

export type ScheduledRunSummary = { tenantId: number; checked: number; delivered: number; rejected: number; skipped: number; abandoned: number; details: string[] };

export async function runScheduledDeliveries(db: Db, options: { tenantId?: number; now?: Date } = {}): Promise<ScheduledRunSummary[]> {
  const now = options.now ?? new Date();
  const tenantIds = options.tenantId ? [options.tenantId] : (await db.select({ id: tenants.id }).from(tenants)).map((row) => row.id);
  const summaries: ScheduledRunSummary[] = [];
  for (const tenantId of tenantIds) {
    const summary: ScheduledRunSummary = { tenantId, checked: 0, delivered: 0, rejected: 0, skipped: 0, abandoned: 0, details: [] };
    const settings = await loadDeliverySettings(db, tenantId);
    const pending = await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "verkauf"), inArray(leads.status, ["neu", "genehmigt"]), sql`JSON_EXTRACT(${leads.metadata}, '$.assignedOrderId') IS NOT NULL`)).orderBy(settings.distributionOrder === "lifo" ? desc(leads.createdAt) : asc(leads.createdAt));
    summary.checked = pending.length;
    if (!pending.length) { summaries.push(summary); continue; }
    const orderIds = Array.from(new Set(pending.map((lead) => Number(metadataOf(lead).assignedOrderId)).filter((id) => Number.isInteger(id) && id > 0)));
    const configs = orderIds.length ? await db.select().from(orderOperationalConfigs).where(and(eq(orderOperationalConfigs.tenantId, tenantId), inArray(orderOperationalConfigs.orderId, orderIds))) : [];
    const orderRows = orderIds.length ? await db.select().from(orders).where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds))) : [];
    const deliveries = orderIds.length ? await db.select().from(leadDeliveries).where(and(eq(leadDeliveries.tenantId, tenantId), inArray(leadDeliveries.orderId, orderIds))) : [];
    const lastDeliveryAt = new Map<number, Date>(); for (const row of deliveries) if (row.orderId && (row.result === "angeboten" || row.result === "angenommen")) { const previous = lastDeliveryAt.get(row.orderId); if (!previous || previous < row.occurredAt) lastDeliveryAt.set(row.orderId, row.occurredAt); }
    const windowOpened = new Set<number>();
    for (const lead of pending) {
      const orderId = Number(metadataOf(lead).assignedOrderId); const config = configs.find((row) => row.orderId === orderId); const order = orderRows.find((row) => row.id === orderId);
      if (!order || !config) { summary.skipped += 1; continue; }
      const attempts = deliveries.filter((row) => row.leadId === lead.id && row.orderId === orderId && row.result === "abgelehnt");
      if (attempts.length >= MAX_ATTEMPTS) {
        await db.update(leads).set({ status: "hängend" }).where(eq(leads.id, lead.id));
        await db.insert(leadStatusEvents).values({ tenantId, leadId: lead.id, previousStatus: lead.status, nextStatus: "hängend", actorUserId: null, note: `Auslieferung an Bestellung ${order.orderNumber} nach ${attempts.length} Versuchen aufgegeben – bitte manuell prüfen.` });
        summary.abandoned += 1; summary.details.push(`${lead.publicId}: aufgegeben nach ${attempts.length} Versuchen`); continue;
      }
      const lastAttempt = attempts.reduce<Date | undefined>((latest, row) => !latest || latest < row.occurredAt ? row.occurredAt : latest, undefined);
      if (lastAttempt && now.getTime() - lastAttempt.getTime() < RETRY_MINUTES * 60_000) { summary.skipped += 1; continue; }
      if (config.realtimeDelivery && !attempts.length) { summary.skipped += 1; continue; } // Echtzeit-Leads liefert die Zuordnung selbst; hier nur Wiederholungen
      if (!config.realtimeDelivery && !windowOpened.has(orderId) && !intervalWindowOpen(config.deliveryInterval, lastDeliveryAt.get(orderId), now)) { summary.skipped += 1; continue; }
      try {
        const result = await deliverLeadNow(db, { tenantId, actorUserId: null, lead, preferOrderId: orderId, now, settings });
        if (result.result === "abgelehnt") { summary.rejected += 1; summary.details.push(`${lead.publicId}: abgelehnt (${result.attempts.map((attempt) => attempt.reason ?? attempt.buyerName).join("; ")})`); }
        else { summary.delivered += 1; windowOpened.add(orderId); summary.details.push(`${lead.publicId}: ${result.result} → ${result.buyerName}`); }
      } catch (error) {
        summary.skipped += 1; summary.details.push(`${lead.publicId}: ${error instanceof Error ? error.message : "unbekannter Fehler"}`);
      }
    }
    summaries.push(summary);
  }
  return summaries;
}

let timer: ReturnType<typeof setInterval> | undefined;
let lastInsightsSync = 0;
let lastInboxSync = 0;

/** Startet den periodischen Lauf im Serverprozess (idempotent). */
let dialerTimer: ReturnType<typeof setInterval> | undefined;

/** Predictive-Dialer und Nachbereitung im Sekundentakt (DIALER_TICK_SECONDS, Standard 5, 0 = aus). */
export function startDialerScheduler(intervalSeconds = Number(process.env.DIALER_TICK_SECONDS ?? 5)) {
  if (dialerTimer || !Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return undefined;
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try { const db = await getDb(); if (!db) return; const appUrl = process.env.APP_URL ?? ""; const tenantIds = (await db.select({ id: tenants.id }).from(tenants)).map((row) => row.id); for (const tenantId of tenantIds) { await releaseWrapUps(db, tenantId); await predictiveTick(db, tenantId, appUrl); await syncSipgateCalls(db, tenantId).catch((error) => console.error("[sipgate] Abgleich:", error instanceof Error ? error.message : error)); await reconcileSipgateRecordings(db, tenantId, appUrl).catch((error) => console.error("[sipgate] Aufzeichnungen:", error instanceof Error ? error.message : error)); } }
    catch (error) { console.error("[Dialer] Takt fehlgeschlagen:", error); } finally { running = false; }
  };
  dialerTimer = setInterval(tick, intervalSeconds * 1000); dialerTimer.unref?.();
  return dialerTimer;
}

export function startDeliveryScheduler(intervalMinutes = Number(process.env.DELIVERY_SCHEDULER_INTERVAL_MINUTES ?? 15)) {
  if (timer || !Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return undefined;
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try {
      const db = await getDb(); if (!db) return;
      const summaries = await runScheduledDeliveries(db);
      const purged = await purgeExpiredCalls(db).catch(() => ({ purged: 0 })); if (purged.purged) console.log(`[Aufbewahrung] ${purged.purged} Gesprächsaufzeichnungen/-transkripte entfernt`);
      const mails = await processDueEmails(db).catch((error) => { console.error("[E-Mail] Versand fehlgeschlagen:", error); return null; });
      const weekly = await import("./mail-health").then((mod) => mod.runWeeklyReports(db)).catch(() => 0); if (weekly) console.log(`[Wochenbericht] ${weekly} Bericht${weekly === 1 ? "" : "e"} verschickt`); // montags ab 8 Uhr, einmal je Woche
      for (const tenantId of (await db.select({ id: tenants.id }).from(tenants).catch(() => [] as Array<{ id: number }>)).map((row) => row.id)) await processAutomations(db, tenantId, { appUrl: process.env.APP_URL ?? "" }).catch((error) => console.error(`[Pipeline] Automatik Mandant ${tenantId}:`, error instanceof Error ? error.message : error));
      if (Date.now() - lastInboxSync > 5 * 60_000) { lastInboxSync = Date.now(); for (const tenantId of await tenantsWithImap(db).catch(() => [] as number[])) await syncInbox(db, tenantId).catch((error) => console.error(`[Posteingang] Mandant ${tenantId}:`, error instanceof Error ? error.message : error)); }
      if (Date.now() - lastInsightsSync > 60 * 60_000) { lastInsightsSync = Date.now(); const connected = await db.select({ tenantId: metaConnections.tenantId }).from(metaConnections).where(eq(metaConnections.status, "verbunden")).catch(() => []); for (const row of connected) await syncInsights(db, row.tenantId, { days: 7 }).catch((error) => console.error(`[Meta] Kennzahlen Mandant ${row.tenantId}:`, error instanceof Error ? error.message : error)); } if (mails && (mails.sent || mails.skipped || mails.failed)) console.log(`[E-Mail] ${mails.sent} gesendet, ${mails.skipped} übersprungen (angemeldet), ${mails.failed} fehlgeschlagen`);
      for (const summary of summaries) if (summary.delivered || summary.rejected || summary.abandoned) console.log(`[Zeitplaner] Mandant ${summary.tenantId}: ${summary.delivered} geliefert, ${summary.rejected} abgelehnt, ${summary.abandoned} aufgegeben, ${summary.skipped} übersprungen`);
    } catch (error) { console.error("[Zeitplaner] Lauf fehlgeschlagen:", error); } finally { running = false; }
  };
  timer = setInterval(tick, intervalMinutes * 60_000); timer.unref?.();
  return timer;
}

let campaignTimer: ReturnType<typeof setInterval> | undefined;
/** E-Mail-Kampagnen im Minutentakt (EMAIL_CAMPAIGN_TICK_SECONDS, Standard 60, 0 = aus) – fällige Mails gehen spätestens nach einer Minute raus, nicht erst nach 15. */
export function startEmailCampaignScheduler(intervalSeconds = Number(process.env.EMAIL_CAMPAIGN_TICK_SECONDS ?? 60)) {
  if (campaignTimer || !Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return undefined;
  let running = false; let repaired = false;
  const tick = async () => {
    if (running) return; running = true; // läuft ein Durchgang noch (viele Mails), startet kein zweiter parallel – keine Doppelversände
    try { const db = await getDb(); if (!db) return;
      if (!repaired) { repaired = true; const count = await repairWaitingRecipients(db).catch((error) => { console.error("[E-Mail-Kampagnen] Wartende nachziehen:", error instanceof Error ? error.message : error); return 0; }); if (count) console.log(`[E-Mail-Kampagnen] ${count} wartende Kontakte stehen jetzt am Warten-Schritt`);
        const { alignStoredDrafts } = await import("./campaign-review"); const aligned = await alignStoredDrafts(db).catch((error) => { console.error("[E-Mail-Kampagnen] Entwürfe ausrichten:", error instanceof Error ? error.message : error); return 0; }); if (aligned) console.log(`[E-Mail-Kampagnen] ${aligned} KI-Entwürfe auf den Ansatz ihrer Kampagne umgestellt`);
        const { useSpartePlaceholder } = await import("./sales-outreach"); const placeholders = await useSpartePlaceholder(db).catch((error) => { console.error("[E-Mail-Kampagnen] Vorlagen-Sparte:", error instanceof Error ? error.message : error); return 0; }); if (placeholders) console.log(`[E-Mail-Kampagnen] ${placeholders} Vorlagen nutzen jetzt die Leadsparte der Kampagne`);
        const { clearWrongSparteDrafts } = await import("./campaign-review"); const wrong = await clearWrongSparteDrafts(db).catch((error) => { console.error("[E-Mail-Kampagnen] Entwürfe falsche Sparte:", error instanceof Error ? error.message : error); return 0; }); if (wrong) console.log(`[E-Mail-Kampagnen] ${wrong} Entwürfe in der falschen Sparte verworfen – die KI schreibt sie neu`);
        const { addPayFitToDrafts } = await import("./campaign-review"); const fitted = await addPayFitToDrafts(db).catch((error) => { console.error("[E-Mail-Kampagnen] Satz „nur passende Leads“:", error instanceof Error ? error.message : error); return 0; }); if (fitted) console.log(`[E-Mail-Kampagnen] ${fitted} PV-/WP-Entwürfe um „nur passende Leads zahlen“ ergänzt`);
        const { fixQuestionCounts } = await import("./campaign-review"); const counted = await fixQuestionCounts(db).catch((error) => { console.error("[E-Mail-Kampagnen] Zahl der Fragen:", error instanceof Error ? error.message : error); return { campaigns: 0, drafts: 0 }; }); if (counted.campaigns || counted.drafts) console.log(`[E-Mail-Kampagnen] Zahl der Fragen passend zur Sparte: ${counted.campaigns} Vorlagen, ${counted.drafts} Entwürfe angepasst`); } // einmal nach dem Start: Wartende auf den Warten-Schritt setzen, alte Entwürfe auf den gewählten Ansatz
      await processEmailCampaigns(db, process.env.APP_URL ?? "", { limit: 300 });
      await syncBrevoEvents(db).catch((error) => console.error("[E-Mail-Ereignisse]", error instanceof Error ? error.message : error)); } // Öffnungen/Klicks von Brevo (alle 10 Minuten)
    catch (error) { console.error("[E-Mail-Kampagnen]", error instanceof Error ? error.message : error); } finally { running = false; }
  };
  campaignTimer = setInterval(tick, intervalSeconds * 1000); campaignTimer.unref?.();
  setTimeout(() => void tick(), 15_000).unref?.(); // gleich nach dem Serverstart einmal – z. B. nach einem Update auf Railway
  return campaignTimer;
}
export function stopDeliveryScheduler() { if (timer) clearInterval(timer); timer = undefined; }
