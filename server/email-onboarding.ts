/**
 * E-Mail-Automatik beim Anlegen von Benutzern: Willkommensmail sofort, Erinnerungen nach X Tagen, solange sich der
 * Benutzer noch nicht angemeldet hat. Versand über SMTP (Umgebungsvariablen SMTP_URL + SMTP_FROM); ohne SMTP wird
 * jede Mail als „simuliert“ protokolliert, damit der Ablauf trotzdem sichtbar und prüfbar ist.
 */
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { emailEvents, emailTemplates, memberships, tenants, users } from "../drizzle/schema";
import type { Db } from "./lead-pipeline";
import { transportFor } from "./mail-settings";

export type OnboardingKind = "willkommen" | "erinnerung_1" | "erinnerung_2" | "erinnerung_3";
export const ONBOARDING_KINDS: OnboardingKind[] = ["willkommen", "erinnerung_1", "erinnerung_2", "erinnerung_3"];
export const KIND_LABEL: Record<string, string> = { willkommen: "Willkommensmail", erinnerung_1: "1. Erinnerung", erinnerung_2: "2. Erinnerung", erinnerung_3: "3. Erinnerung", frei: "Freie Vorlage", test: "Testmail" };

/** Standardvorlagen – werden je Mandant einmal angelegt und können danach bearbeitet werden. */
export const DEFAULT_TEMPLATES: Array<{ kind: OnboardingKind; name: string; subject: string; delayDays: number; bodyHtml: string }> = [
  { kind: "willkommen", name: "Willkommen bei Tanesco Leads", subject: "Willkommen bei {{firma_plattform}}, {{vorname}}!", delayDays: 0, bodyHtml: "<p>Hallo {{vorname}} {{nachname}},</p><p>Ihr Zugang zu {{firma_plattform}} ist eingerichtet. So melden Sie sich an:</p><p><strong>Adresse:</strong> {{login_url}}<br><strong>Benutzername:</strong> {{email}}<br><strong>Passwort:</strong> {{passwort}}</p><p>Nach der ersten Anmeldung sehen Sie Ihre Leads, Bestellungen und Reklamationen im Bereich „Mein Bereich“.</p><p>Bei Fragen antworten Sie einfach auf diese E-Mail.</p><p>Viele Grüße<br>Ihr Team von {{firma_plattform}}</p>" },
  { kind: "erinnerung_1", name: "Erinnerung: Ihr Zugang wartet", subject: "Ihr Zugang zu {{firma_plattform}} wartet auf Sie", delayDays: 3, bodyHtml: "<p>Hallo {{vorname}},</p><p>Sie haben sich noch nicht bei {{firma_plattform}} angemeldet. Ihr Zugang ist bereit:</p><p><strong>{{login_url}}</strong><br>Benutzername: {{email}}</p><p>Falls Sie Ihr Passwort nicht mehr haben, nutzen Sie bitte „Passwort vergessen“ auf der Anmeldeseite.</p><p>Viele Grüße<br>Ihr Team von {{firma_plattform}}</p>" },
  { kind: "erinnerung_2", name: "Zweite Erinnerung", subject: "Kurze Erinnerung: Anmeldung bei {{firma_plattform}}", delayDays: 7, bodyHtml: "<p>Hallo {{vorname}},</p><p>nur eine kurze Erinnerung: Ihr Zugang zu {{firma_plattform}} ist weiterhin für Sie reserviert.</p><p>Anmelden: <strong>{{login_url}}</strong></p><p>Gern helfen wir bei der ersten Anmeldung – antworten Sie einfach auf diese E-Mail.</p><p>Viele Grüße<br>Ihr Team von {{firma_plattform}}</p>" },
];

export async function ensureOnboardingTemplates(db: Db, tenantId: number) {
  const existing = await db.select().from(emailTemplates).where(eq(emailTemplates.tenantId, tenantId));
  const missing = DEFAULT_TEMPLATES.filter((template) => !existing.some((row) => row.kind === template.kind));
  if (missing.length) await db.insert(emailTemplates).values(missing.map((template) => ({ tenantId, name: template.name, subject: template.subject, bodyHtml: template.bodyHtml, status: "aktiv" as const, kind: template.kind, delayDays: template.delayDays })));
  return db.select().from(emailTemplates).where(eq(emailTemplates.tenantId, tenantId)).orderBy(asc(emailTemplates.delayDays), asc(emailTemplates.id));
}

export type MailContext = { vorname: string; nachname: string; name: string; firma: string; email: string; login_url: string; firma_plattform: string; passwort?: string };

/** Platzhalter {{…}} ersetzen; unbekannte Platzhalter bleiben leer. */
export function renderTemplate(text: string, context: MailContext): string {
  const values: Record<string, string> = { ...context, passwort: context.passwort ?? "(wurde Ihnen separat mitgeteilt)" };
  return text.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_, key: string) => values[key] ?? "");
}

export async function mailContextFor(db: Db, tenantId: number, membershipId: number, password?: string): Promise<{ context: MailContext; membership: typeof memberships.$inferSelect; user: typeof users.$inferSelect } | null> {
  const row = (await db.select({ membership: memberships, user: users }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, tenantId))).limit(1))[0];
  if (!row) return null;
  const tenant = (await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
  const firstName = row.user.firstName ?? (row.user.name ?? "").split(" ")[0] ?? ""; const lastName = row.user.lastName ?? (row.user.name ?? "").split(" ").slice(1).join(" ");
  return { membership: row.membership, user: row.user, context: { vorname: firstName, nachname: lastName, name: row.user.name ?? "", firma: row.user.company ?? "", email: row.user.email ?? "", login_url: process.env.APP_URL ?? "https://leads.tanesco.digital", firma_plattform: tenant?.name ?? "Tanesco Leads", passwort: password } };
}

/** Beim Anlegen eines Benutzers: Willkommensmail sofort, Erinnerungen nach delayDays (nur aktive Vorlagen). */
export async function scheduleOnboardingEmails(db: Db, tenantId: number, membershipId: number, password?: string) {
  const templates = (await ensureOnboardingTemplates(db, tenantId)).filter((template) => template.status === "aktiv" && ONBOARDING_KINDS.includes(template.kind as OnboardingKind));
  const info = await mailContextFor(db, tenantId, membershipId, password);
  if (!info || !info.context.email) return { scheduled: 0, sent: 0 };
  const now = new Date(); let scheduled = 0; let sent = 0;
  for (const template of templates) {
    const scheduledFor = new Date(now.getTime() + template.delayDays * 86_400_000);
    const inserted = await db.insert(emailEvents).values({ tenantId, templateId: template.id, recipientEmail: info.context.email, subject: renderTemplate(template.subject, info.context), deliveryStatus: "geplant", kind: template.kind, membershipId, scheduledFor, bodyPreview: renderTemplate(template.bodyHtml, { ...info.context, passwort: password ? "••••••••" : undefined }) });
    const eventId = Number(inserted[0]?.insertId) || 0; scheduled += 1;
    if (template.delayDays === 0 && eventId) { const result = await sendEvent(db, tenantId, eventId, { ...info.context }); if (result.ok) sent += 1; }
  }
  return { scheduled, sent };
}

/** Fällige Mails verschicken (Zeitplaner): Erinnerungen entfallen, sobald sich der Benutzer angemeldet hat. */
export async function processDueEmails(db: Db, now = new Date()) {
  const due = await db.select().from(emailEvents).where(and(eq(emailEvents.deliveryStatus, "geplant"), lte(emailEvents.scheduledFor, now)));
  let sent = 0; let skipped = 0; let failed = 0;
  for (const event of due) {
    if (event.kind?.startsWith("erinnerung") && event.membershipId) {
      const info = await mailContextFor(db, event.tenantId, event.membershipId);
      if (!info) { await db.update(emailEvents).set({ deliveryStatus: "abgebrochen", note: "Benutzer existiert nicht mehr" }).where(eq(emailEvents.id, event.id)); continue; }
      if (info.user.lastSignedIn && info.user.lastSignedIn.getTime() > info.membership.createdAt.getTime()) { await db.update(emailEvents).set({ deliveryStatus: "übersprungen", note: `Benutzer hat sich am ${info.user.lastSignedIn.toLocaleDateString("de-DE")} angemeldet` }).where(eq(emailEvents.id, event.id)); skipped += 1; continue; }
      const result = await sendEvent(db, event.tenantId, event.id, info.context); if (result.ok) sent += 1; else failed += 1; continue;
    }
    const info = event.membershipId ? await mailContextFor(db, event.tenantId, event.membershipId) : null;
    const result = await sendEvent(db, event.tenantId, event.id, info?.context ?? { vorname: "", nachname: "", name: "", firma: "", email: event.recipientEmail, login_url: process.env.APP_URL ?? "", firma_plattform: "Tanesco Leads" });
    if (result.ok) sent += 1; else failed += 1;
  }
  return { due: due.length, sent, skipped, failed };
}

/** Eine Mail (geplant/fehlgeschlagen/gesendet) jetzt verschicken – über SMTP oder simuliert. */
export async function sendEvent(db: Db, tenantId: number, eventId: number, context: MailContext): Promise<{ ok: boolean; status: string; note?: string }> {
  const event = (await db.select().from(emailEvents).where(and(eq(emailEvents.id, eventId), eq(emailEvents.tenantId, tenantId))).limit(1))[0];
  if (!event) return { ok: false, status: "fehlgeschlagen", note: "Eintrag nicht gefunden" };
  const template = event.templateId ? (await db.select().from(emailTemplates).where(eq(emailTemplates.id, event.templateId)).limit(1))[0] : undefined;
  const subject = template ? renderTemplate(template.subject, context) : event.subject;
  const html = template ? renderTemplate(template.bodyHtml, context) : event.bodyPreview ?? "";
  const outcome = await deliverMail({ to: event.recipientEmail, subject, html }, { db, tenantId: event.tenantId });
  await db.update(emailEvents).set({ deliveryStatus: outcome.status, sentAt: outcome.ok ? new Date() : null, providerMessageId: outcome.messageId ?? null, note: outcome.note ?? null, subject }).where(eq(emailEvents.id, eventId));
  return outcome;
}

/** Versand über die Mandanten-Einstellungen (Einstellungen → E-Mail-Versand), sonst SMTP_URL vom Hosting; ohne beides: simuliert. */
export type MailAttachment = { filename: string; content: string; contentType?: string; encoding?: "base64" };
export async function deliverMail(mail: { to: string; subject: string; html: string; text?: string; attachments?: MailAttachment[] }, options: { db?: Db | null; tenantId?: number | null; from?: { name?: string | null; email: string } | null } = {}): Promise<{ ok: boolean; status: "gesendet" | "simuliert" | "fehlgeschlagen"; messageId?: string; note?: string; notConfigured?: boolean }> {
  const ready = await transportFor(options.db ?? null, options.tenantId ?? null).catch(() => null);
  // Ohne eingerichteten Versand: in der echten App NIE so tun, als wäre gesendet worden (früher stand dann trotzdem „gesendet“).
  // Nur beim Entwickeln und in Tests wird simuliert (EMAIL_SIMULATE=1 erzwingt es auch sonst).
  if (!ready) return process.env.NODE_ENV === "production" && process.env.EMAIL_SIMULATE !== "1" ? { ok: false, status: "fehlgeschlagen", notConfigured: true, note: "Kein E-Mail-Versand eingerichtet (Einstellungen → E-Mail-Versand) – nichts gesendet" } : { ok: true, status: "simuliert", note: "Kein E-Mail-Versand eingerichtet (Einstellungen → E-Mail-Versand) – Versand simuliert" };
  try {
    const from = options.from?.email ? (options.from.name ? `"${options.from.name.replace(/"/g, "")}" <${options.from.email}>` : options.from.email) : ready.from; /* zusätzliche Absender-Adresse (muss beim Mail-Anbieter freigegeben sein) */
    const result = await ready.transport.sendMail({ from, replyTo: ready.replyTo, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text ?? mail.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), ...(mail.attachments?.length ? { attachments: mail.attachments.map((item) => ({ filename: item.filename, content: item.content, contentType: item.contentType, ...(item.encoding ? { encoding: item.encoding } : {}) })) } : {}) });
    return { ok: true, status: "gesendet", messageId: result.messageId };
  } catch (error) { if (process.env.MAIL_DEBUG) console.error("[MAIL_DEBUG]", error); return { ok: false, status: "fehlgeschlagen", note: error instanceof Error ? error.message.slice(0, 220) : "Versand fehlgeschlagen" }; }
}

export function smtpStatus() { return { configured: Boolean(process.env.SMTP_URL), from: process.env.SMTP_FROM ?? null, appUrl: process.env.APP_URL ?? null }; }

/** Übersicht für die Seite „E-Mails“: Vorlagen, Versandprotokoll mit Benutzer, Kennzahlen. */
export async function emailOverview(db: Db, tenantId: number, options: { status?: string; limit?: number } = {}) {
  const templates = await ensureOnboardingTemplates(db, tenantId);
  const conditions = [eq(emailEvents.tenantId, tenantId)]; if (options.status) conditions.push(eq(emailEvents.deliveryStatus, options.status as typeof emailEvents.$inferSelect.deliveryStatus));
  const events = await db.select().from(emailEvents).where(and(...conditions)).orderBy(desc(emailEvents.createdAt)).limit(options.limit ?? 200);
  const membershipIds = Array.from(new Set(events.map((event) => event.membershipId).filter((id): id is number => typeof id === "number")));
  const people = membershipIds.length ? await db.select({ membershipId: memberships.id, name: users.name, company: users.company, lastSignedIn: users.lastSignedIn }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(inArray(memberships.id, membershipIds)) : [];
  const all = await db.select({ status: emailEvents.deliveryStatus }).from(emailEvents).where(eq(emailEvents.tenantId, tenantId));
  const counts = all.reduce<Record<string, number>>((acc, row) => { acc[row.status] = (acc[row.status] ?? 0) + 1; return acc; }, {});
  return { smtp: smtpStatus(), templates, counts, events: events.map((event) => { const person = people.find((row) => row.membershipId === event.membershipId); return { ...event, recipientName: person?.name ?? null, recipientCompany: person?.company ?? null, recipientSignedIn: person?.lastSignedIn ?? null }; }) };
}
