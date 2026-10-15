/**
 * E-Mail-Versand je Mandant: Anbieter-Voreinstellungen (Gmail, Brevo, Mailgun, Postmark, Amazon SES, eigener SMTP),
 * Testmail, DNS-Prüfung (SPF/DKIM/DMARC) für die Absenderdomain und optional IMAP-Abgleich: Antworten auf Kampagnen-Mails
 * setzen „Geantwortet“ automatisch.
 */
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import dns from "node:dns/promises";
import { emailCampaignEvents, emailCampaignRecipients, mailSettings } from "../drizzle/schema";
import type { Db } from "./lead-pipeline";

export type Provider = "gmail" | "brevo" | "brevo_api" | "mailgun" | "postmark" | "ses" | "smtp";
/** Anbieter ohne SMTP-Verbindung (Versand über HTTP) – Server/Port/Verschlüsselung entfallen. */
export const isApiProvider = (provider: string) => provider === "brevo_api";
export const PROVIDERS: Array<{ key: Provider; label: string; host: string; port: number; secure: boolean; hint: string; dkimSelectors: string[]; dailyLimit: number }> = [
  { key: "gmail", label: "Gmail / Google Workspace", host: "smtp.gmail.com", port: 465, secure: true, hint: "Benutzer = deine Gmail-Adresse, Passwort = App-Passwort (Google-Konto → Sicherheit → App-Passwörter). Google erlaubt ca. 500 Mails/Tag (Workspace 2.000).", dkimSelectors: ["google"], dailyLimit: 400 },
  { key: "brevo", label: "Brevo (ehem. Sendinblue)", host: "smtp-relay.brevo.com", port: 587, secure: false, hint: "Benutzer = Brevo-Login-E-Mail, Passwort = SMTP-Schlüssel (Brevo → SMTP & API). Domain unter „Absender & Domains“ bestätigen.", dkimSelectors: ["mail", "brevo1", "brevo2"], dailyLimit: 2000 },
  { key: "brevo_api", label: "Brevo über HTTP (wenn der Hoster Mail-Ports sperrt)", host: "", port: 443, secure: true, hint: "Passwort = API-Schlüssel (Brevo → SMTP & API → Reiter „API-Schlüssel“, beginnt mit xkeysib-). Kein SMTP nötig – läuft über https, auch wenn der Hoster Port 587 sperrt. Domain unter „Absender & Domains“ bestätigen.", dkimSelectors: ["mail"], dailyLimit: 300 },
  { key: "mailgun", label: "Mailgun", host: "smtp.eu.mailgun.org", port: 587, secure: false, hint: "Benutzer = postmaster@deine-domain, Passwort = SMTP-Passwort der Domain (Mailgun → Sending → Domain settings). EU-Server: smtp.eu.mailgun.org.", dkimSelectors: ["mailo", "k1", "smtp"], dailyLimit: 5000 },
  { key: "postmark", label: "Postmark", host: "smtp.postmarkapp.com", port: 587, secure: false, hint: "Benutzer und Passwort = Server-API-Token (beides gleich). Für Kaltakquise den „Broadcast“-Stream nutzen.", dkimSelectors: ["pm", "20230601pm"], dailyLimit: 5000 },
  { key: "ses", label: "Amazon SES", host: "email-smtp.eu-central-1.amazonaws.com", port: 587, secure: false, hint: "SMTP-Zugangsdaten in SES → SMTP settings erzeugen. Domain in SES verifizieren (DKIM-Einträge werden dort angezeigt).", dkimSelectors: [], dailyLimit: 5000 },
  { key: "smtp", label: "Eigener SMTP-Server", host: "", port: 587, secure: false, hint: "Zugangsdaten deines Hosters (z. B. IONOS, Strato, All-Inkl). Port 465 = TLS sofort, 587 = STARTTLS.", dkimSelectors: ["default", "mail", "s1", "selector1"], dailyLimit: 300 },
];
const mask = (value: string | null | undefined) => (value ? "••••••••" : "");
export async function ensureSettings(db: Db, tenantId: number) {
  const existing = (await db.select().from(mailSettings).where(eq(mailSettings.tenantId, tenantId)).limit(1))[0]; if (existing) return existing;
  await db.insert(mailSettings).values({ tenantId, provider: "smtp" }); return (await db.select().from(mailSettings).where(eq(mailSettings.tenantId, tenantId)).limit(1))[0];
}
export async function getSettings(db: Db, tenantId: number) {
  const row = await ensureSettings(db, tenantId);
  return { ...row, password: mask(row.password), imapPassword: mask(row.imapPassword), hasPassword: Boolean(row.password), hasImapPassword: Boolean(row.imapPassword), envFallback: Boolean(process.env.SMTP_URL), replyAiAvailable: Boolean(process.env.ANTHROPIC_API_KEY), providers: PROVIDERS.map(({ key, label, host, port, secure, hint, dailyLimit }) => ({ key, label, host, port, secure, hint, dailyLimit })) };
}
export async function saveSettings(db: Db, tenantId: number, input: { provider: Provider; host?: string | null; port?: number | null; secure?: boolean; username?: string | null; password?: string | null; fromName?: string | null; fromEmail?: string | null; replyTo?: string | null; dailyLimit?: number | null; enabled?: boolean; imapEnabled?: boolean; imapHost?: string | null; imapPort?: number | null; imapUsername?: string | null; imapPassword?: string | null; replyAiEnabled?: boolean; replyAiAutoBlock?: boolean; replyAiInterest?: boolean; imapScope?: "bekannte" | "alle" }) {
  const row = await ensureSettings(db, tenantId); const preset = PROVIDERS.find((item) => item.key === input.provider) ?? PROVIDERS[5];
  const fromEmail = input.fromEmail?.trim().toLowerCase() || null; if (fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) throw new Error("Bitte eine gültige Absenderadresse angeben.");
  const keepPassword = !input.password || input.password === "••••••••"; const keepImap = !input.imapPassword || input.imapPassword === "••••••••";
  await db.update(mailSettings).set({ provider: input.provider, host: input.host?.trim() || preset.host || null, port: input.port ?? preset.port, secure: input.secure ?? preset.secure, username: input.username?.trim() || null, ...(keepPassword ? {} : { password: input.password }), fromName: input.fromName?.trim() || null, fromEmail, replyTo: input.replyTo?.trim() || null, dailyLimit: input.dailyLimit ?? preset.dailyLimit, enabled: input.enabled ?? row.enabled, imapEnabled: input.imapEnabled ?? row.imapEnabled, imapHost: input.imapHost?.trim() || (input.provider === "gmail" ? "imap.gmail.com" : row.imapHost), imapPort: input.imapPort ?? row.imapPort ?? 993, imapUsername: input.imapUsername?.trim() || null, ...(keepImap ? {} : { imapPassword: input.imapPassword }), replyAiEnabled: input.replyAiEnabled ?? row.replyAiEnabled, replyAiAutoBlock: input.replyAiAutoBlock ?? row.replyAiAutoBlock, replyAiInterest: input.replyAiInterest ?? row.replyAiInterest, imapScope: input.imapScope ?? row.imapScope ?? "bekannte" }).where(eq(mailSettings.id, row.id));
  return { success: true as const };
}
/** Gemeinsame Form von Nodemailer-Transport und HTTP-Versand, damit der aufrufende Code beides gleich behandelt. */
export type MailTransport = { verify: () => Promise<unknown>; sendMail: (mail: { from?: string; replyTo?: string; to: string; subject: string; html?: string; text?: string; attachments?: Array<{ filename: string; content: string; contentType?: string }> }) => Promise<{ messageId?: string }> };
/** Transport aus den Mandanten-Einstellungen; Rückfall auf SMTP_URL (Hosting). null = kein Versand möglich (simulieren). */
export async function transportFor(db: Db | null, tenantId: number | null) {
  const nodemailer = await import("nodemailer");
  if (db && tenantId) {
    const row = (await db.select().from(mailSettings).where(eq(mailSettings.tenantId, tenantId)).limit(1))[0];
    if (row?.enabled && isApiProvider(row.provider) && row.password) { const { brevoTransport } = await import("./brevo-api"); return { transport: brevoTransport(row.password) as MailTransport, from: row.fromName ? `${row.fromName} <${row.fromEmail ?? ""}>` : (row.fromEmail ?? ""), replyTo: row.replyTo ?? undefined, source: "mandant" as const }; }
    if (row?.enabled && row.host && row.username && row.password) return { transport: nodemailer.createTransport({ host: row.host, port: row.port ?? 587, secure: row.secure, auth: { user: row.username, pass: row.password }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 }) as unknown as MailTransport, from: row.fromName ? `${row.fromName} <${row.fromEmail ?? row.username}>` : (row.fromEmail ?? row.username), replyTo: row.replyTo ?? undefined, source: "mandant" as const };
  }
  if (process.env.SMTP_URL) return { transport: nodemailer.createTransport({ url: process.env.SMTP_URL, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 } as never) as unknown as MailTransport, from: process.env.SMTP_FROM ?? "Tanesco Leads <no-reply@tanesco.digital>", replyTo: undefined, source: "hosting" as const };
  return null;
}
export async function sendTest(db: Db, tenantId: number, to: string) {
  const row = await ensureSettings(db, tenantId); const target = to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) throw new Error("Bitte eine gültige Empfängeradresse angeben.");
  const ready = await transportFor(db, tenantId); if (!ready || ready.source !== "mandant") { if (!row.enabled) throw new Error("Bitte den Versand zuerst einschalten und speichern."); throw new Error(isApiProvider(row.provider) ? "Es fehlt der API-Schlüssel (Brevo → SMTP & API → Reiter „API-Schlüssel“)." : "Zugangsdaten unvollständig: Server, Benutzer und Passwort werden gebraucht."); }
  try { await ready.transport.verify(); const result = await ready.transport.sendMail({ from: ready.from, to: target, replyTo: ready.replyTo, subject: "Testmail aus Tanesco Leads", text: "Dein E-Mail-Versand funktioniert. Diese Nachricht wurde aus den Einstellungen → E-Mail-Versand verschickt.", html: "<p>Dein E-Mail-Versand funktioniert.</p><p style=\"color:#6a7282;font-size:12px\">Verschickt aus Tanesco Leads → Einstellungen → E-Mail-Versand.</p>" }); await db.update(mailSettings).set({ lastTestAt: new Date(), lastTestStatus: "ok", lastError: null }).where(eq(mailSettings.id, row.id)); return { ok: true as const, messageId: result.messageId }; }
  catch (error) { const message = error instanceof Error ? error.message.slice(0, 300) : "Versand fehlgeschlagen"; await db.update(mailSettings).set({ lastTestAt: new Date(), lastTestStatus: "fehler", lastError: message }).where(eq(mailSettings.id, row.id)); throw new Error(`Testmail fehlgeschlagen: ${message}`); }
}
/** DNS-Prüfung der Absenderdomain: SPF, DKIM (bekannte Selektoren je Anbieter), DMARC. */
export async function checkDomain(domain: string, provider: Provider) {
  const clean = domain.trim().toLowerCase().replace(/^.*@/, ""); if (!clean || !clean.includes(".")) throw new Error("Bitte eine Absenderadresse oder Domain angeben.");
  const txt = async (name: string) => { try { return (await dns.resolveTxt(name)).map((parts) => parts.join("")); } catch { return []; } };
  const spf = (await txt(clean)).find((record) => record.toLowerCase().startsWith("v=spf1")) ?? null;
  const preset = PROVIDERS.find((item) => item.key === provider) ?? PROVIDERS[5];
  let dkim: { selector: string; record: string } | null = null;
  for (const selector of preset.dkimSelectors) { const records = await txt(`${selector}._domainkey.${clean}`); const hit = records.find((record) => /v=dkim1|k=rsa|p=/i.test(record)); if (hit) { dkim = { selector, record: hit.slice(0, 80) }; break; } if (!hit) { try { const cname = await dns.resolveCname(`${selector}._domainkey.${clean}`); if (cname.length) { dkim = { selector, record: `CNAME → ${cname[0]}` }; break; } } catch { /* kein CNAME */ } } }
  const dmarc = (await txt(`_dmarc.${clean}`)).find((record) => record.toLowerCase().startsWith("v=dmarc1")) ?? null;
  const providerInSpf = spf ? ({ gmail: /_spf\.google\.com/, brevo: /sendinblue\.com|brevo\.com/, brevo_api: /sendinblue\.com|brevo\.com/, mailgun: /mailgun\.org/, postmark: /mtasv\.net/, ses: /amazonses\.com/, smtp: /./ } as Record<Provider, RegExp>)[provider].test(spf) : false;
  return { domain: clean, spf: { found: Boolean(spf), record: spf, providerIncluded: providerInSpf }, dkim: { found: Boolean(dkim), selector: dkim?.selector ?? null, record: dkim?.record ?? null, checked: preset.dkimSelectors }, dmarc: { found: Boolean(dmarc), record: dmarc }, ready: Boolean(spf && providerInSpf && (dkim || preset.dkimSelectors.length === 0)) };
}
/** IMAP-Abgleich: ungelesene Mails der letzten Tage; Absender, die Empfänger einer laufenden Serie sind, werden als „geantwortet“ markiert. */
export async function checkReplies(db: Db, tenantId: number) {
  const row = await ensureSettings(db, tenantId); if (!row.imapEnabled || !row.imapHost || !row.imapUsername || !row.imapPassword) throw new Error("IMAP ist nicht eingerichtet (Server, Benutzer, Passwort).");
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({ host: row.imapHost, port: row.imapPort ?? 993, secure: (row.imapPort ?? 993) === 993, auth: { user: row.imapUsername, pass: row.imapPassword }, logger: false });
  const candidates = await db.select({ id: emailCampaignRecipients.id, email: emailCampaignRecipients.email, campaignId: emailCampaignRecipients.campaignId, nodeId: emailCampaignRecipients.nodeId }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), gt(emailCampaignRecipients.sentCount, 0), isNull(emailCampaignRecipients.repliedAt)));
  const byEmail = new Map(candidates.map((item) => [item.email.toLowerCase(), item])); let matched = 0; let scanned = 0;
  try { await client.connect(); const lock = await client.getMailboxLock("INBOX"); try { const since = new Date(Date.now() - 14 * 86_400_000); for await (const message of client.fetch({ since }, { envelope: true })) { scanned += 1; const from = message.envelope?.from?.[0]?.address?.toLowerCase(); const hit = from ? byEmail.get(from) : undefined; if (hit) { await db.update(emailCampaignRecipients).set({ repliedAt: message.envelope?.date ?? new Date() }).where(eq(emailCampaignRecipients.id, hit.id)); await db.insert(emailCampaignEvents).values({ tenantId, campaignId: hit.campaignId, recipientId: hit.id, nodeId: hit.nodeId, kind: "geoeffnet", note: `Antwort im Postfach erkannt: „${(message.envelope?.subject ?? "").slice(0, 120)}“` }); byEmail.delete(from!); matched += 1; } } } finally { lock.release(); } await client.logout(); }
  catch (error) { throw new Error(`IMAP-Abgleich fehlgeschlagen: ${error instanceof Error ? error.message.slice(0, 200) : "unbekannt"}`); }
  await db.update(mailSettings).set({ lastReplyCheckAt: new Date() }).where(eq(mailSettings.id, row.id));
  return { scanned, matched };
}
export async function tenantsWithImap(db: Db) { return (await db.select({ tenantId: mailSettings.tenantId }).from(mailSettings).where(and(eq(mailSettings.imapEnabled, true), eq(mailSettings.enabled, true)))).map((row) => row.tenantId); }
export { inArray };
