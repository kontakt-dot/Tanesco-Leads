/**
 * Zustellbarkeit: alles, was dafür sorgt, dass Kampagnen-Mails ankommen.
 * - Domain-Check (Ampel): die drei Echtheits-Einträge der Absender-Domain (SPF, DKIM, DMARC) per DNS prüfen, mit Anleitung.
 * - Quoten-Wächter: Unzustellbare (Bounces) und Spam-Beschwerden der letzten 14 Tage gegen die kritischen Schwellen.
 * - Warmlaufen: das Tageslimit steigt automatisch Woche für Woche (40 → 60 → 80 …) bis zum eingestellten Limit.
 * - Absender-Adressen: zusätzliche Adressen mit eigenem Tageslimit – der Versand verteilt sich automatisch,
 *   jeder Kontakt bekommt immer dieselbe Adresse (damit Antworten im selben Faden bleiben).
 * - Wochenbericht: montags eine kurze Zusammenfassung der letzten 7 Tage per E-Mail.
 */
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { emailCampaignEvents, emailCampaignRecipients, emailCampaigns, inboxMessages, mailSenders, mailSettings, memberships, users } from "../drizzle/schema";
import { DEFAULT_CAMPAIGN_DAILY_LIMIT, dayStartIn } from "../shared/email-campaigns";
import { deliverMail } from "./email-onboarding";
import { isMailboxKind, mailboxMissing, mailboxOf, mailboxPreset, type MailboxKind } from "../shared/mailbox";
import type { Db } from "./lead-pipeline";

/* ---------------------------------------------------------------- Domain-Check (SPF/DKIM/DMARC) – nutzt die vorhandene Prüfung aus den E-Mail-Einstellungen */
export type DomainCheckResult = Awaited<ReturnType<typeof import("./mail-settings")["checkDomain"]>>;
/** Ampel aus dem Prüfergebnis: rot = SPF fehlt (Mails landen im Spam), gelb = DKIM/DMARC fehlt oder Anbieter nicht im SPF, grün = alles da. */
export function ampelOf(result: { spf: { found: boolean; providerIncluded?: boolean }; dkim: { found: boolean }; dmarc: { found: boolean } } | null | undefined): "gruen" | "gelb" | "rot" | "unbekannt" {
  if (!result) return "unbekannt";
  if (!result.spf.found) return "rot";
  if (!result.dkim.found || !result.dmarc.found || result.spf.providerIncluded === false) return "gelb";
  return "gruen";
}
/** Zustellbarkeit auf einen Blick: Domain-Prüfung der hinterlegten Absenderadresse plus die Quoten der letzten 14 Tage. */
export async function mailHealthFor(db: Db, tenantId: number) {
  const settings = (await db.select({ fromEmail: mailSettings.fromEmail, provider: mailSettings.provider }).from(mailSettings).where(eq(mailSettings.tenantId, tenantId)).limit(1))[0] ?? null;
  const rates = await mailRates(db, tenantId);
  if (!settings?.fromEmail) return { domain: null, ampel: "unbekannt" as const, check: null, rates, note: "Noch keine Absenderadresse in den E-Mail-Einstellungen hinterlegt." };
  const { checkDomain } = await import("./mail-settings");
  const check = await checkDomain(settings.fromEmail, settings.provider as never).catch(() => null);
  return { domain: settings.fromEmail.split("@")[1] ?? null, ampel: ampelOf(check), check, rates, note: null };
}

/* ---------------------------------------------------------------- Quoten (Bounces, Beschwerden) */
export const BOUNCE_WARN_PCT = 4; // kritische Schwellen der großen Postfach-Anbieter
export const COMPLAINT_WARN_PCT = 0.3;
export async function mailRates(db: Db, tenantId: number, days = 14) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.select({ kind: emailCampaignEvents.kind, count: sql<number>`count(*)` }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), gte(emailCampaignEvents.createdAt, since), inArray(emailCampaignEvents.kind, ["gesendet", "bounce", "beschwerde"]))).groupBy(emailCampaignEvents.kind);
  const of = (kind: string) => Number(rows.find((row) => row.kind === kind)?.count ?? 0);
  const sent = of("gesendet"); const bounces = of("bounce"); const complaints = of("beschwerde");
  const pct = (part: number) => (sent > 0 ? Math.round((part / sent) * 1000) / 10 : 0);
  return { days, sent, bounces, complaints, bouncePct: pct(bounces), complaintPct: pct(complaints), bounceWarn: sent >= 25 && pct(bounces) > BOUNCE_WARN_PCT, complaintWarn: sent >= 100 && pct(complaints) > COMPLAINT_WARN_PCT };
}

/* ---------------------------------------------------------------- Warmlaufen */
/** Limit-Plan beim Warmlaufen: Woche 1 = 40, danach +20 je Woche – gedeckelt auf das eingestellte Limit. */
export function warmupLimit(startedAt: Date | string | null | undefined, configured: number, now = new Date()): { limit: number; week: number; done: boolean } {
  if (!startedAt) return { limit: configured, week: 0, done: true };
  const week = Math.max(1, Math.floor((now.getTime() - new Date(startedAt).getTime()) / (7 * 86_400_000)) + 1);
  const ramp = 40 + (week - 1) * 20;
  return ramp >= configured ? { limit: configured, week, done: true } : { limit: ramp, week, done: false };
}

/* ---------------------------------------------------------------- Absender-Adressen */
export async function listSenders(db: Db, tenantId: number) {
  const settings = (await db.select().from(mailSettings).where(eq(mailSettings.tenantId, tenantId)).limit(1))[0] ?? null;
  const extra = await db.select().from(mailSenders).where(eq(mailSenders.tenantId, tenantId)).orderBy(asc(mailSenders.id));
  const today = await sentTodayBySender(db, tenantId);
  const mainEmail = settings?.fromEmail?.trim().toLowerCase() ?? null;
  const extraSent = extra.reduce((sum, row) => sum + (today.get(row.fromEmail.toLowerCase()) ?? 0), 0);
  const totalToday = Array.from(today.values()).reduce((sum, value) => sum + value, 0);
  const mailboxView = (row: typeof mailSenders.$inferSelect) => isMailboxKind(row.mailboxKind) ? { kind: row.mailboxKind as MailboxKind, host: row.smtpHost ?? mailboxPreset(row.mailboxKind)?.host ?? "", port: row.smtpPort ?? mailboxPreset(row.mailboxKind)?.port ?? 587, secure: row.smtpSecure, user: row.smtpUser ?? "", hasPassword: Boolean(row.smtpPassword), ready: Boolean(mailboxOf(row)), missing: mailboxMissing(row), lastTestAt: row.lastTestAt, lastTestStatus: row.lastTestStatus, lastError: row.lastError } : null; // nie das Passwort
  return {
    main: mainEmail ? { fromEmail: mainEmail, fromName: settings?.fromName ?? null, sentToday: Math.max(0, totalToday - extraSent) } : null,
    senders: extra.map((row) => ({ id: row.id, fromName: row.fromName, fromEmail: row.fromEmail, dailyLimit: row.dailyLimit, active: row.active, sentToday: today.get(row.fromEmail.toLowerCase()) ?? 0, mailbox: mailboxView(row) })),
  };
}
/** Postfach-Angaben einer Absender-Adresse: `kind` „keins“ entfernt das Postfach; leeres Passwort behält das gespeicherte. */
export type MailboxInput = { kind: MailboxKind | "keins"; host?: string | null; port?: number | null; secure?: boolean | null; user?: string | null; password?: string | null };
export async function saveSender(db: Db, tenantId: number, input: { id?: number | null; fromName?: string | null; fromEmail: string; dailyLimit?: number | null; active?: boolean | null; mailbox?: MailboxInput | null }) {
  const email = input.fromEmail.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error("Bitte eine gültige Absender-Adresse angeben.");
  const limit = Math.max(1, Math.min(2000, Math.round(input.dailyLimit ?? 40)));
  const values: Partial<typeof mailSenders.$inferInsert> = { fromName: input.fromName?.trim() || null, fromEmail: email, dailyLimit: limit, ...(typeof input.active === "boolean" ? { active: input.active } : {}) };
  if (input.mailbox) {
    if (input.mailbox.kind === "keins") Object.assign(values, { mailboxKind: null, smtpHost: null, smtpPort: null, smtpSecure: false, smtpUser: null, smtpPassword: null, lastTestAt: null, lastTestStatus: null, lastError: null });
    else {
      const preset = mailboxPreset(input.mailbox.kind); if (!preset) throw new Error("Unbekannte Postfach-Art.");
      const host = (input.mailbox.host ?? "").trim() || preset.host; if (!host) throw new Error("Bitte den Server des Postfachs angeben (z. B. smtp.ionos.de).");
      const port = input.mailbox.port && input.mailbox.port > 0 && input.mailbox.port < 65536 ? Math.round(input.mailbox.port) : preset.port;
      Object.assign(values, { mailboxKind: input.mailbox.kind, smtpHost: host.slice(0, 200), smtpPort: port, smtpSecure: typeof input.mailbox.secure === "boolean" ? input.mailbox.secure : port === 465, smtpUser: ((input.mailbox.user ?? "").trim() || email).slice(0, 320), lastTestAt: null, lastTestStatus: null, lastError: null, ...(input.mailbox.password ? { smtpPassword: input.mailbox.password } : {}) }); // Passwort leer = gespeichertes behalten
    }
  }
  if (input.id) { await db.update(mailSenders).set(values).where(and(eq(mailSenders.id, input.id), eq(mailSenders.tenantId, tenantId))); return { id: input.id }; }
  const existing = (await db.select({ id: mailSenders.id }).from(mailSenders).where(and(eq(mailSenders.tenantId, tenantId), eq(mailSenders.fromEmail, email))).limit(1))[0];
  if (existing) { await db.update(mailSenders).set(values).where(eq(mailSenders.id, existing.id)); return { id: existing.id }; }
  const inserted = await db.insert(mailSenders).values({ tenantId, fromEmail: email, ...values, active: input.active ?? true });
  return { id: Number(inserted[0]?.insertId) || 0 };
}
/** Testmail über das eigene Postfach einer Absender-Adresse – an die Haupt-Adresse (oder eine angegebene). Ergebnis bleibt als Ampel gespeichert. */
export async function testSender(db: Db, tenantId: number, input: { id: number; to?: string | null }) {
  const row = (await db.select().from(mailSenders).where(and(eq(mailSenders.id, input.id), eq(mailSenders.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Absender-Adresse nicht gefunden.");
  if (!isMailboxKind(row.mailboxKind)) throw new Error("Diese Adresse hat kein eigenes Postfach – sie sendet über den Anbieter aus den Einstellungen.");
  const missing = mailboxMissing(row); if (missing.length) throw new Error(`Postfach unvollständig: ${missing.join(", ")} fehlt.`);
  const settings = (await db.select({ fromEmail: mailSettings.fromEmail, imapUsername: mailSettings.imapUsername }).from(mailSettings).where(eq(mailSettings.tenantId, tenantId)).limit(1))[0] ?? null;
  const target = (input.to ?? "").trim() || settings?.fromEmail?.trim() || row.fromEmail; if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) throw new Error("Bitte eine gültige Empfängeradresse angeben.");
  const { senderTransportFor, noteSenderResult } = await import("./mail-settings");
  const ready = await senderTransportFor(db, tenantId, row.id); if (!ready) throw new Error("Postfach unvollständig – bitte Server, Benutzer und Passwort prüfen.");
  try {
    await ready.transport.verify();
    const result = await ready.transport.sendMail({ from: ready.from, to: target, replyTo: ready.replyTo, subject: `Testmail von ${row.fromEmail}`, text: `Das Postfach ${row.fromEmail} versendet. Diese Nachricht wurde aus Einstellungen → E-Mail-Versand → Absender-Adressen verschickt.`, html: `<p>Das Postfach <strong>${row.fromEmail}</strong> versendet.</p><p style="color:#6a7282;font-size:12px">Verschickt aus Tanesco Leads → Einstellungen → E-Mail-Versand → Absender-Adressen.</p>` });
    await noteSenderResult(db, row.id, true);
    return { ok: true as const, to: target, messageId: (result as { messageId?: string }).messageId ?? null };
  } catch (error) { const message = error instanceof Error ? error.message.slice(0, 300) : "Versand fehlgeschlagen"; await noteSenderResult(db, row.id, false, message); throw new Error(`Testmail über ${row.fromEmail} fehlgeschlagen: ${message}`); }
}
export async function deleteSender(db: Db, tenantId: number, id: number) { await db.delete(mailSenders).where(and(eq(mailSenders.id, id), eq(mailSenders.tenantId, tenantId))); return { success: true as const }; }

async function sentTodayBySender(db: Db, tenantId: number, now = new Date()) {
  const rows = await db.select({ sender: emailCampaignEvents.sender, count: sql<number>`count(*)` }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.kind, "gesendet"), gte(emailCampaignEvents.createdAt, dayStartIn(now)))).groupBy(emailCampaignEvents.sender);
  return new Map(rows.map((row) => [String(row.sender ?? "").toLowerCase(), Number(row.count) || 0]));
}
export type SenderPool = { pool: Array<{ id: number | null; fromName: string | null; fromEmail: string; left: number | null; ownMailbox: boolean }>; pick: (contactEmail: string) => { id: number | null; fromName: string | null; fromEmail: string } | null };
/**
 * Verteilung beim Versand: jeder Kontakt bekommt fest „seine“ Adresse (gleichmäßig verteilt). Ist deren Tagesbudget
 * aufgebraucht, übernimmt die Haupt-Adresse. Ohne Zusatz-Adressen bleibt alles wie bisher (kein Eingriff).
 */
export async function senderPoolFor(db: Db, tenantId: number): Promise<SenderPool | null> {
  const { main, senders } = await listSenders(db, tenantId);
  const active = senders.filter((row) => row.active);
  if (!active.length || !main) return null;
  const budgets = new Map(active.map((row) => [row.fromEmail, Math.max(0, row.dailyLimit - row.sentToday)]));
  const mainPick = { id: null as number | null, fromName: main.fromName, fromEmail: main.fromEmail };
  const all = [mainPick, ...active.map((row) => ({ id: row.id as number | null, fromName: row.fromName, fromEmail: row.fromEmail }))];
  const hash = (text: string) => { let value = 0; for (const char of text.toLowerCase()) value = (value * 31 + char.charCodeAt(0)) >>> 0; return value; };
  return {
    pool: [{ id: null, fromName: main.fromName, fromEmail: main.fromEmail, left: null, ownMailbox: false }, ...active.map((row) => ({ id: row.id, fromName: row.fromName, fromEmail: row.fromEmail, left: budgets.get(row.fromEmail) ?? 0, ownMailbox: Boolean(row.mailbox?.ready) }))],
    pick: (contactEmail: string) => {
      const chosen = all[hash(contactEmail) % all.length];
      if (chosen.fromEmail === main.fromEmail) return chosen;
      const left = budgets.get(chosen.fromEmail) ?? 0;
      if (left <= 0) return mainPick; // Budget der Zusatz-Adresse für heute aufgebraucht → Haupt-Adresse
      budgets.set(chosen.fromEmail, left - 1);
      return chosen;
    },
  };
}

/* ---------------------------------------------------------------- Wochenbericht */
/** Zahlen und Text für den Wochenbericht (letzte 7 Tage) – reiner Baustein, gut testbar. */
export async function buildWeeklyReport(db: Db, tenantId: number, now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const rows = await db.select({ kind: emailCampaignEvents.kind, count: sql<number>`count(*)` }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), gte(emailCampaignEvents.createdAt, since))).groupBy(emailCampaignEvents.kind);
  const of = (kind: string) => Number(rows.find((row) => row.kind === kind)?.count ?? 0);
  const replies = (await db.select({ count: sql<number>`count(*)` }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), gte(emailCampaignRecipients.repliedAt, since))))[0];
  const inboxNew = (await db.select({ count: sql<number>`count(*)` }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), gte(inboxMessages.receivedAt, since))))[0];
  // beste Kampagne nach Antworten der Woche
  const best = (await db.select({ campaignId: emailCampaignRecipients.campaignId, name: emailCampaigns.name, count: sql<number>`count(*)` }).from(emailCampaignRecipients).innerJoin(emailCampaigns, eq(emailCampaigns.id, emailCampaignRecipients.campaignId)).where(and(eq(emailCampaignRecipients.tenantId, tenantId), gte(emailCampaignRecipients.repliedAt, since))).groupBy(emailCampaignRecipients.campaignId, emailCampaigns.name).orderBy(desc(sql`count(*)`)).limit(1))[0] ?? null;
  // wartende Freigaben: offene Empfänger, deren aktueller Schritt eine E-Mail ist und die (noch) nicht freigegeben sind
  const campaigns = await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.tenantId, tenantId), eq(emailCampaigns.status, "aktiv")));
  let approvalsOpen = 0;
  for (const campaign of campaigns) {
    const { kiModusOf } = await import("../shared/email-campaigns"); if (kiModusOf(campaign) !== "freigabe") continue;
    const tree = (campaign.tree ?? { start: null, nodes: [] }) as { nodes: Array<{ id: string; type: string }> };
    const open = await db.select({ nodeId: emailCampaignRecipients.nodeId, draftState: emailCampaignRecipients.draftState, draftNodeId: emailCampaignRecipients.draftNodeId, sentCount: emailCampaignRecipients.sentCount }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId, campaign.id), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"])));
    approvalsOpen += open.filter((row) => { const node = tree.nodes.find((item) => item.id === row.nodeId && item.type === "send"); if (!node) return false; const fits = row.draftNodeId ? row.draftNodeId === node.id : row.sentCount === 0; return !(row.draftState === "freigegeben" && fits); }).length;
  }
  const sent = of("gesendet"); const opened = of("geoeffnet"); const bounces = of("bounce");
  const lines = [
    `Deine E-Mail-Woche (${since.toLocaleDateString("de-DE")} – ${now.toLocaleDateString("de-DE")}):`,
    "",
    `• Gesendet: ${sent} E-Mail${sent === 1 ? "" : "s"}`,
    `• Antworten: ${Number(replies?.count ?? 0)}`,
    `• Geöffnet: ${opened}${sent ? ` (${Math.round((opened / sent) * 100)} %)` : ""}`,
    `• Unzustellbar: ${bounces}`,
    `• Neu im Posteingang: ${Number(inboxNew?.count ?? 0)}`,
    best ? `• Beste Kampagne: „${best.name}“ mit ${best.count} Antwort${Number(best.count) === 1 ? "" : "en"}` : "• Beste Kampagne: diese Woche keine Antworten",
    approvalsOpen ? `• ${approvalsOpen} E-Mail${approvalsOpen === 1 ? " wartet" : "s warten"} auf deine Freigabe – einmal reinschauen lohnt sich.` : "• Keine offenen Freigaben – alles läuft.",
  ];
  return { subject: `Tanesco Leads – deine Woche: ${sent} gesendet, ${Number(replies?.count ?? 0)} Antworten`, text: lines.join("\n"), sent, replies: Number(replies?.count ?? 0), approvalsOpen };
}
/** Bericht an den Besitzer schicken (dessen Anmelde-Adresse) – von Hand („Jetzt senden“) oder montags vom Zeitplaner. */
export async function sendWeeklyReport(db: Db, tenantId: number, options: { force?: boolean } = {}) {
  const settings = (await db.select().from(mailSettings).where(eq(mailSettings.tenantId, tenantId)).limit(1))[0] ?? null;
  if (!options.force && settings && !settings.weeklyReportEnabled) return { sent: false, note: "Wochenbericht ist ausgeschaltet." };
  const owner = (await db.select({ email: users.email, name: users.name }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "inhaber"))).orderBy(asc(memberships.id)).limit(1))[0];
  const to = owner?.email ?? settings?.fromEmail ?? null; if (!to) return { sent: false, note: "Keine Empfänger-Adresse gefunden." };
  const report = await buildWeeklyReport(db, tenantId);
  const html = `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.7;color:#101828;white-space:pre-wrap">${report.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`;
  const result = await deliverMail({ to, subject: report.subject, html, text: report.text }, { db, tenantId });
  if (result.ok && settings) await db.update(mailSettings).set({ weeklyReportAt: new Date() }).where(eq(mailSettings.id, settings.id));
  return { sent: result.ok, note: result.note ?? null, to, subject: report.subject };
}
/** Montags einmal je Mandant (Zeitplaner ruft das alle 15 Minuten auf). */
export async function runWeeklyReports(db: Db, now = new Date()) {
  const berlin = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
  if (berlin.getDay() !== 1 || berlin.getHours() < 8) return 0; // Montag ab 8 Uhr
  const rows = await db.select().from(mailSettings).where(eq(mailSettings.weeklyReportEnabled, true));
  let sent = 0;
  for (const row of rows) {
    if (row.weeklyReportAt && now.getTime() - new Date(row.weeklyReportAt).getTime() < 6 * 86_400_000) continue; // diese Woche schon
    const result = await sendWeeklyReport(db, row.tenantId).catch(() => ({ sent: false }));
    if (result.sent) sent += 1;
  }
  return sent;
}
