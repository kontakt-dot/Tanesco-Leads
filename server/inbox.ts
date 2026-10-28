/**
 * Posteingang: Mails per IMAP abholen (Antworten auf Kampagnen und alles andere), lesen, beantworten und als Lead
 * in die Vertriebspipeline übernehmen (Meta-Ads- oder Kaltakquise-Pipeline).
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { inboxDeletedMessages, emailCampaignEvents, emailCampaignRecipients, emailCampaigns, emailSuppressions, inboxMessages, leadCategories, leadStatusEvents, leads, mailSettings, outboundMessages, pipelineEvents, pipelineNotes, users } from "../drizzle/schema";
import { decideReply, describeAssessment, DEFAULT_REPLY_AI, isAutoReply, matchesAiFilter, type InboxAiFilter, type ReplyAiSettings } from "../shared/reply-ai";
import { assessReply } from "./reply-ai";
import { isStage } from "../shared/sales-pipeline";
import { extractPhone } from "../shared/pipeline-extras";
import { inTimeOfDay, summarizeSent, trackingForSend, type SentReaction, type SentTracking } from "../shared/sent-tracking";
import { addSuppression, isSuppressed, removeSuppressionByEmail } from "./pipeline-extras";
import { deliverMail } from "./email-onboarding";
import type { Db } from "./lead-pipeline";
import { ensureSettings, signatureFor } from "./mail-settings";
import { checkAttachments, type MailAttachmentInput } from "../shared/email-signature";
import { logActivity } from "./activity";
import { messageIdsIn, normalizeMessageId } from "../shared/message-id";
import { audienceLists, kiModusOf, sentSourceOf, type SentSource } from "../shared/email-campaigns";
import { applyPayFit, DEFAULT_SPARTE, fixQuestionCount, isEnergySparte, numberWord, partnerGenitive, paysOnlyFitting, questionCount, sparteOf } from "../shared/lead-sparte";

const stripHtml = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
/** Antworttext ohne zitierte Vornachricht („Am … schrieb …“, „>“-Zeilen). */
export function replyExcerpt(text: string) { const lines = text.split("\n"); const out: string[] = []; for (const line of lines) { if (/^(am .* schrieb|on .* wrote|-{3,} ?(ursprüngliche|original)|von: |from: )/i.test(line.trim()) || line.trim().startsWith(">")) break; out.push(line); } return out.join("\n").trim().slice(0, 4000); }

/** IMAP-Abholung: neue Mails der letzten 14 Tage in den Posteingang, Antworten auf Serien markieren, Leads per E-Mail verknüpfen. */
/* ---------- Absender-Abgleich ---------- */
const FREEMAIL = new Set(["gmail.com", "googlemail.com", "gmx.de", "gmx.net", "gmx.at", "gmx.ch", "web.de", "t-online.de", "outlook.com", "outlook.de", "hotmail.com", "hotmail.de", "live.com", "live.de", "msn.com", "yahoo.com", "yahoo.de", "icloud.com", "me.com", "mac.com", "aol.com", "aol.de", "posteo.de", "mailbox.org", "freenet.de", "arcor.de", "online.de", "1und1.de", "ionos.de", "proton.me", "protonmail.com", "vodafone.de", "kabelmail.de", "email.de"]);
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const domainOf = (email: string) => { const at = email.lastIndexOf("@"); return at > 0 ? email.slice(at + 1).trim().toLowerCase() : null; };
export const isFreemailDomain = (domain: string) => FREEMAIL.has(domain.toLowerCase());
/** Firmen-Domain ohne Unter-Domain: „mail.firma.de“ → „firma.de“ (bei .co.uk u. ä. bleiben drei Teile). */
export const rootDomain = (domain: string | null | undefined) => { if (!domain) return null; const parts = domain.toLowerCase().split(".").filter(Boolean); if (parts.length <= 2) return parts.join("."); const second = parts[parts.length - 2]; return (second.length <= 3 && ["co", "com", "net", "org", "ac", "gov"].includes(second) ? parts.slice(-3) : parts.slice(-2)).join("."); };
/** Firmenname als Suchwort für Domains: „Koppen GmbH & Co. KG“ → „koppen“ (Rechtsformen und Sonderzeichen weg; zu kurze Namen ergeben nichts). */
export const companySlug = (company: string | null | undefined) => { const value = (company ?? "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/\b(gmbh|ag|kg|ohg|gbr|ug|mbh|co|e\.?v|se|inc|ltd|haftungsbeschraenkt|und|and)\b/g, " ").replace(/[^a-z0-9]+/g, ""); return value.length >= 6 ? value : null; };
const domainWords = (domain: string) => domain.toLowerCase().split(".").slice(0, -1).join("").replace(/[^a-z0-9]+/g, "");
const REPLY_PREFIX = /^\s*((re|aw|antw|antwort|wg|fw|fwd|wtr)\s*(\[\d+\])?\s*:\s*)+/i;
export const isReplySubject = (subject: string | null | undefined) => REPLY_PREFIX.test(subject ?? "");
export const baseSubject = (subject: string | null | undefined) => (subject ?? "").replace(REPLY_PREFIX, "").replace(/\s+/g, " ").trim().toLowerCase();
export type SkippedSender = { email: string; name: string | null; subject: string | null; at: Date | null };
/** Zuletzt übersprungene Absender je Mandant (nur im Speicher) – damit im Posteingang sichtbar ist, was nicht hereingeholt wurde. */
const lastSkipped = new Map<number, { at: Date; items: SkippedSender[] }>();
export function skippedSenders(tenantId: number) { const entry = lastSkipped.get(tenantId); if (!entry) return { at: null as Date | null, items: [] as Array<SkippedSender & { count: number }> }; const grouped = new Map<string, SkippedSender & { count: number }>(); for (const item of entry.items) { const current = grouped.get(item.email); if (current) current.count += 1; else grouped.set(item.email, { ...item, count: 1 }); } return { at: entry.at, items: Array.from(grouped.values()) }; }

/** Alle Antworten mit „Interesse“ (KI) – auch ältere: Kontakte, die bisher nur in der E-Mail-Akquise standen, kommen in die Pipeline „E-Mail-Kampagne“. */
export async function pullInterestedIntoPipeline(db: Db, tenantId: number) {
  const rows = await db.select({ leadId: inboxMessages.leadId, recipientId: inboxMessages.campaignRecipientId }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.aiKind, "interessiert"), eq(inboxMessages.blocked, false)));
  const recipientIds = rows.map((row) => row.recipientId).filter((id): id is number => typeof id === "number");
  const viaRecipient = recipientIds.length ? (await db.select({ leadId: emailCampaignRecipients.leadId }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), inArray(emailCampaignRecipients.id, recipientIds)))).map((row) => row.leadId) : [];
  const ids = Array.from(new Set([...rows.map((row) => row.leadId), ...viaRecipient].filter((id): id is number => typeof id === "number")));
  if (!ids.length) return 0;
  const waiting = await db.select({ id: leads.id, adPlatform: leads.adPlatform, stage: leads.pipelineStage }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.inPipeline, false), inArray(leads.id, ids)));
  for (const row of waiting) await db.update(leads).set({ inPipeline: true, adPlatform: row.adPlatform || "email", pipelineStage: row.stage || "neu", pipelineUpdatedAt: new Date() }).where(eq(leads.id, row.id));
  return waiting.length;
}
export async function syncInbox(db: Db, tenantId: number, options: { allowSenders?: string[] } = {}) {
  const row = await ensureSettings(db, tenantId); if (!row.imapEnabled || !row.imapHost || !row.imapUsername || !row.imapPassword) throw new Error("IMAP ist nicht eingerichtet (Einstellungen → E-Mail-Versand → Antworten erkennen).");
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({ host: row.imapHost, port: row.imapPort ?? 993, secure: (row.imapPort ?? 993) === 993, auth: { user: row.imapUsername, pass: row.imapPassword }, logger: false });
  const known = new Set((await db.select({ messageId: inboxMessages.messageId }).from(inboxMessages).where(eq(inboxMessages.tenantId, tenantId))).map((item) => item.messageId));
  for (const item of await db.select({ messageId: inboxDeletedMessages.messageId }).from(inboxDeletedMessages).where(eq(inboxDeletedMessages.tenantId, tenantId))) known.add(item.messageId); // gelöscht = nie wieder einlesen
  // „Nur bekannte Kontakte“ (Standard): Absender muss Kampagnen-Empfänger oder Lead sein – Rechnungen, Newsletter, Fremde bleiben draußen.
  const onlyKnown = (row.imapScope ?? "bekannte") !== "alle";
  // Bekannt ist: genau die Adresse eines Kontakts – ODER dieselbe Firmen-Domain (z. B. Antwort von m.koppen@firma.de auf info@firma.de)
  // ODER eine Antwort („Re:“/„AW:“) auf den Betreff einer gesendeten Kampagnen-/Einzel-Mail. Gmail, GMX, web.de usw. zählen nicht als Firmen-Domain.
  const knownSenders = onlyKnown ? new Set([
    ...(await db.select({ email: emailCampaignRecipients.email }).from(emailCampaignRecipients).where(eq(emailCampaignRecipients.tenantId, tenantId))).map((item) => normalizeEmail(item.email)),
    ...(await db.select({ email: leads.email }).from(leads).where(and(eq(leads.tenantId, tenantId), isNotNull(leads.email)))).map((item) => normalizeEmail(item.email ?? "")).filter(Boolean),
  ]) : null;
  const knownDomains = knownSenders ? new Set(Array.from(knownSenders).map((email) => rootDomain(domainOf(email))).filter((domain): domain is string => Boolean(domain) && !isFreemailDomain(domain!))) : null;
  // Firmenname im Absender: Antwort von „hallo@koppen-gmbh.de“ auf eine Mail an „info@koppen.de“ – der Firmenname des Kontakts steckt in der Domain
  const companySlugs = onlyKnown ? new Set([...(await db.select({ company: leads.company }).from(leads).where(and(eq(leads.tenantId, tenantId), isNotNull(leads.company)))).map((item) => companySlug(item.company)), ...(await db.select({ company: emailCampaignRecipients.company }).from(emailCampaignRecipients).where(eq(emailCampaignRecipients.tenantId, tenantId))).map((item) => companySlug(item.company))].filter((slug): slug is string => Boolean(slug))) : null;
  // Sicherste Zuordnung: Antworten tragen die Message-ID unserer gesendeten Mail (In-Reply-To/References) – egal von welcher Adresse sie kommen
  const sentIds = new Set([...(await db.select({ messageId: emailCampaignEvents.messageId }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), isNotNull(emailCampaignEvents.messageId)))).map((item) => item.messageId), ...(await db.select({ messageId: outboundMessages.providerSid }).from(outboundMessages).where(and(eq(outboundMessages.tenantId, tenantId), eq(outboundMessages.channel, "email"), isNotNull(outboundMessages.providerSid)))).map((item) => item.messageId)].map((id) => normalizeMessageId(id)).filter((id): id is string => Boolean(id)));
  const sentSubjects = onlyKnown ? new Set([
    ...(await db.select({ subject: emailCampaignEvents.subject }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.kind, "gesendet")))).map((item) => baseSubject(item.subject)),
    ...(await db.select({ subject: outboundMessages.subject }).from(outboundMessages).where(eq(outboundMessages.tenantId, tenantId))).map((item) => baseSubject(item.subject)),
  ].filter((subject) => subject.length >= 6)) : null;
  const allow = new Set((options.allowSenders ?? []).map(normalizeEmail));
  const skippedList: SkippedSender[] = [];
  let scanned = 0; let added = 0; let replies = 0; let skipped = 0;
  try {
    await client.connect(); const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - 14 * 86_400_000);
      for await (const message of client.fetch({ since }, { envelope: true, uid: true, source: { maxLength: 200_000 } })) {
        scanned += 1; const envelope = message.envelope; const messageId = (envelope?.messageId ?? `uid-${message.uid}`).slice(0, 320); if (known.has(messageId)) continue; // gekürzt wie gespeichert – sonst würden lange IDs nie wiedererkannt
        const from = envelope?.from?.[0]; if (!from?.address) continue; const fromEmail = from.address.toLowerCase(); if (fromEmail === (row.fromEmail ?? "").toLowerCase()) continue;
        // Antwort-Adressen der Mail: Absender, „Antworten an“ und „Sender“ – Ticketsysteme schicken z. B. von noreply@, antworten aber für hallo@firma.de
        const candidates = Array.from(new Set([fromEmail, ...(envelope?.replyTo ?? []).map((item) => item.address?.toLowerCase() ?? ""), ...(envelope?.sender ?? []).map((item) => item.address?.toLowerCase() ?? "")].filter(Boolean)));
        let bodyText = ""; let references: string[] = [];
        try { const raw = message.source?.toString("utf8") ?? ""; const { simpleParser } = await import("mailparser"); const parsed = await simpleParser(raw); bodyText = parsed.text ?? (parsed.html ? stripHtml(String(parsed.html)) : ""); references = messageIdsIn([parsed.inReplyTo ?? "", ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [])]); } catch { bodyText = ""; }
        if (!references.length && envelope?.inReplyTo) references = messageIdsIn(envelope.inReplyTo);
        if (knownSenders && !candidates.some((email) => allow.has(email) || knownSenders.has(email))) {
          const replyToSent = (isReplySubject(envelope?.subject) && sentSubjects?.has(baseSubject(envelope?.subject))) || references.some((id) => sentIds.has(id));
          const sameCompany = candidates.some((email) => { const domain = domainOf(email); const root = rootDomain(domain); if (!domain || isFreemailDomain(domain) || (root && isFreemailDomain(root))) return false; if (root && knownDomains?.has(root)) return true; const words = domainWords(domain); return Boolean(companySlugs && words.length >= 6 && Array.from(companySlugs).some((slug) => words.includes(slug) || slug.includes(words))); });
          if (!sameCompany && !replyToSent) { skipped += 1; if (skippedList.length < 50) skippedList.push({ email: fromEmail, name: from.name ?? null, subject: envelope?.subject ?? null, at: envelope?.date ?? null }); continue; }
        }
        const result = await storeMessage(db, tenantId, { messageId, imapUid: message.uid, fromEmail, fromName: from.name ?? null, subject: envelope?.subject ?? null, bodyText: replyExcerpt(bodyText), receivedAt: envelope?.date ?? new Date(), references, replyAddresses: candidates });
        known.add(messageId); added += 1; if (result.replied) replies += 1;
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (error) { throw new Error(`Posteingang abholen fehlgeschlagen: ${error instanceof Error ? error.message.slice(0, 200) : "unbekannt"}`); }
  await db.update(mailSettings).set({ lastReplyCheckAt: new Date() }).where(eq(mailSettings.id, row.id));
  lastSkipped.set(tenantId, { at: new Date(), items: skippedList.filter((item) => !allow.has(item.email)) });
  await pullInterestedIntoPipeline(db, tenantId).catch(() => null);
  return { scanned, added, replies, skipped, skippedSenders: skippedList.slice(0, 20) };
}

/**
 * Posteingang aufräumen: „fremde“ entfernt alle Mails, die zu keinem Kontakt gehören (kein Lead, kein Kampagnen-Empfänger) –
 * z. B. Rechnungen und Newsletter, die vor dem Umzug auf ein eigenes Kampagnen-Postfach mitgeladen wurden. „alle“ leert den Posteingang komplett.
 * Die Sperrliste bleibt unberührt; gesendete Antworten bleiben im Ordner „Gesendet“.
 */
export async function clearInbox(db: Db, tenantId: number, scope: "fremde" | "antworten" | "alle") {
  const condition = scope === "alle" ? eq(inboxMessages.tenantId, tenantId) : scope === "antworten" ? and(eq(inboxMessages.tenantId, tenantId), or(isNotNull(inboxMessages.campaignRecipientId), sql`LOWER(${inboxMessages.subject}) REGEXP '^(re|aw|antw|wg|fwd?) ?:'`)) : and(eq(inboxMessages.tenantId, tenantId), isNull(inboxMessages.leadId), isNull(inboxMessages.campaignRecipientId));
  const rows = await db.select({ id: inboxMessages.id, messageId: inboxMessages.messageId }).from(inboxMessages).where(condition);
  await removeMessages(db, tenantId, rows);
  return { deleted: rows.length, scope };
}
/** Mails wirklich löschen und ihre Message-ID merken – sonst holt die nächste IMAP-Abholung sie aus dem Postfach zurück. */
async function removeMessages(db: Db, tenantId: number, rows: Array<{ id: number; messageId: string }>) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await db.insert(inboxDeletedMessages).values(chunk.map((row) => ({ tenantId, messageId: row.messageId.slice(0, 320) }))).onDuplicateKeyUpdate({ set: { deletedAt: new Date() } });
    await db.delete(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), inArray(inboxMessages.id, chunk.map((row) => row.id))));
  }
}
/** Einzelne Mails aus dem Posteingang löschen (z. B. Test-Antworten) – bleiben dauerhaft weg. */
export async function deleteMessages(db: Db, tenantId: number, ids: number[]) {
  const rows = ids.length ? await db.select({ id: inboxMessages.id, messageId: inboxMessages.messageId }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), inArray(inboxMessages.id, ids))) : [];
  await removeMessages(db, tenantId, rows);
  return { deleted: rows.length };
}
/** Eine Mail ablegen (auch ohne IMAP nutzbar, z. B. Test/Webhook) und automatisch verknüpfen. */
/** Empfänger über den Betreff finden: „AW: Mehr Anfragen für Koppen GmbH“ → die Kampagnen-Mail mit genau diesem Betreff (personalisiert, daher eindeutig). */
async function recipientBySubject(db: Db, tenantId: number, subject: string | null | undefined, fromEmail: string) {
  if (!isReplySubject(subject)) return null; const base = baseSubject(subject); if (base.length < 6) return null;
  const hits = await db.select({ recipientId: emailCampaignEvents.recipientId }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.kind, "gesendet"), sql`LOWER(TRIM(REGEXP_REPLACE(${emailCampaignEvents.subject}, '[[:space:]]+', ' '))) = ${base}`)).orderBy(desc(emailCampaignEvents.createdAt)).limit(20);
  const ids = Array.from(new Set(hits.map((hit) => hit.recipientId))); if (!ids.length) return null;
  const rows = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), inArray(emailCampaignRecipients.id, ids)));
  const domain = domainOf(fromEmail); const sameDomain = rows.filter((row) => domain && domainOf(row.email) === domain);
  if (sameDomain.length) return sameDomain[0]; return ids.length === 1 ? rows[0] ?? null : null; // mehrere mit gleichem Betreff und fremder Domain → lieber nicht raten
}
/** Empfänger über die Firmen-Domain finden (zuletzt angeschrieben zuerst). */
async function recipientByDomain(db: Db, tenantId: number, fromEmail: string) {
  const domain = domainOf(fromEmail); const root = rootDomain(domain); if (!domain || !root || isFreemailDomain(domain) || isFreemailDomain(root)) return null;
  const rows = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), sql`LOWER(${emailCampaignRecipients.email}) LIKE ${`%${root}`}`));
  return rows.filter((row) => rootDomain(domainOf(row.email)) === root).sort((a, b) => (b.lastSentAt?.getTime() ?? 0) - (a.lastSentAt?.getTime() ?? 0))[0] ?? null;
}
/** Empfänger über die Message-ID unserer gesendeten Mail finden (In-Reply-To/References der Antwort) – die sicherste Zuordnung. */
async function recipientByReference(db: Db, tenantId: number, references: string[] | null | undefined) {
  const ids = (references ?? []).filter(Boolean).slice(0, 20); if (!ids.length) return null;
  const hit = (await db.select({ recipientId: emailCampaignEvents.recipientId }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), inArray(emailCampaignEvents.messageId, ids))).orderBy(desc(emailCampaignEvents.createdAt)).limit(1))[0];
  return hit ? (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.id, hit.recipientId))).limit(1))[0] ?? null : null;
}
export async function storeMessage(db: Db, tenantId: number, input: { messageId: string; imapUid?: number | null; fromEmail: string; fromName?: string | null; subject?: string | null; bodyText: string; receivedAt: Date; references?: string[] | null; replyAddresses?: string[] | null }, deps: Parameters<typeof assessReply>[3] = {}) {
  const fromEmail = input.fromEmail.toLowerCase();
  const addresses = Array.from(new Set([fromEmail, ...(input.replyAddresses ?? []).map((email) => email.toLowerCase())].filter(Boolean)));
  const references = Array.from(new Set((input.references ?? []).flatMap((ref) => messageIdsIn(ref)))); // mit oder ohne spitze Klammern, Groß/Klein egal
  let recipient = await recipientByReference(db, tenantId, references); // 1. Message-ID unserer Mail in der Antwort (sicher, egal von welcher Adresse)
  for (const email of addresses) recipient = recipient ?? (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.email, email))).orderBy(desc(emailCampaignRecipients.createdAt)).limit(1))[0] ?? null; // 2. genau die Adresse (auch „Antworten an“)
  recipient = recipient ?? await recipientBySubject(db, tenantId, input.subject, fromEmail); // 3. Betreff der gesendeten Mail („AW: …“)
  for (const email of addresses) recipient = recipient ?? await recipientByDomain(db, tenantId, email); // 4. dieselbe Firmen-Domain (nicht Gmail, GMX usw.) – auch mit Unter-Domain
  const viaSingleMail = references.length ? (await db.select({ leadId: outboundMessages.leadId }).from(outboundMessages).where(and(eq(outboundMessages.tenantId, tenantId), eq(outboundMessages.channel, "email"), inArray(outboundMessages.providerSid, references.slice(0, 20)))).orderBy(desc(outboundMessages.createdAt)).limit(1))[0] ?? null : null; // Antwort auf eine Einzel-Mail aus der Karte (Message-ID)
  let lead: { id: number } | null = viaSingleMail?.leadId ? { id: viaSingleMail.leadId } : null;
  for (const email of addresses) lead = lead ?? (await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.email, email))).orderBy(desc(leads.createdAt)).limit(1))[0] ?? null; // nur Vertriebskontakte – Leads zum Verkauf werden nie verknüpft
  const alreadyBlocked = await isSuppressed(db, tenantId, fromEmail); // gesperrter Absender → landet direkt unter „Gesperrt“
  // KI-Einordnung (Beschwerde, Abmeldewunsch, Interessiert, Frage, Abwesenheit) – ohne KI greifen die Regeln; daraus folgt sperren / prüfen / markieren
  const settings = await replyAiSettings(db, tenantId);
  const assessment = alreadyBlocked ? null : await assessReply(input.subject, input.bodyText, settings, deps);
  const decision = decideReply(assessment, settings);
  const optOut = decision.action === "gesperrt" && decision.reason === "abgemeldet";
  const autoBlocked = decision.action === "gesperrt" && decision.reason === "beschwerde";
  const blocked = alreadyBlocked || autoBlocked;
  const inserted = await db.insert(inboxMessages).values({ tenantId, messageId: input.messageId.slice(0, 320), imapUid: input.imapUid ?? null, fromEmail, fromName: input.fromName?.slice(0, 200) ?? null, subject: input.subject?.slice(0, 400) ?? null, bodyText: input.bodyText.slice(0, 20000), receivedAt: input.receivedAt, campaignRecipientId: recipient?.id ?? null, leadId: recipient?.leadId ?? lead?.id ?? null, blocked, isRead: blocked, optOut, aiKind: assessment?.kind ?? null, aiConfidence: assessment?.confidence ?? null, aiQuote: assessment?.quote?.slice(0, 300) ?? null, aiReason: assessment?.reason?.slice(0, 200) ?? null, aiSource: assessment?.source ?? null, aiAction: decision.action });
  let replied = false;
  const campaignName = recipient ? (await db.select({ name: emailCampaigns.name }).from(emailCampaigns).where(eq(emailCampaigns.id, recipient.campaignId)).limit(1))[0]?.name ?? null : null;
  const source = campaignName ? `Antwort auf „${campaignName}“` : "Antwort im Posteingang";
  if (optOut && assessment) { // Abmeldung in der Antwort erkannt → Sperrliste (Unterliste „Abmeldungen“), laufende Serien stoppen
    await addSuppression(db, tenantId, { email: fromEmail, reason: "abgemeldet", note: `${describeAssessment(assessment)} · „${(input.subject ?? "").slice(0, 100)}“`.slice(0, 400), source }).catch(() => null);
    if (recipient) await db.insert(emailCampaignEvents).values({ tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: "abgemeldet", note: "Abmeldung in der Antwort erkannt – Adresse gesperrt" });
  }
  if (autoBlocked && assessment) { // Beschwerde → Sperrliste (Unterliste „Beschwerden“), alle Nachrichten des Absenders nach „Gesperrt“
    await addSuppression(db, tenantId, { email: fromEmail, reason: "beschwerde", note: `${describeAssessment(assessment)} – automatisch gesperrt`.slice(0, 400), source }).catch(() => null);
    const own = await db.select({ id: inboxMessages.id }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.fromEmail, fromEmail)));
    if (own.length) await db.update(inboxMessages).set({ blocked: true, isRead: true }).where(inArray(inboxMessages.id, own.map((row) => row.id)));
    if (recipient) await db.insert(emailCampaignEvents).values({ tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: "abgemeldet", note: `Beschwerde in der Antwort erkannt (${assessment.confidence} %) – Adresse gesperrt` });
  }
  const noteLeadId = recipient?.leadId ?? lead?.id ?? null;
  if (decision.action === "markiert" && assessment?.kind === "interessiert" && settings.markInterest && noteLeadId) { // „Interessiert“ als Notiz an der Pipeline-Karte
    await db.insert(pipelineNotes).values({ tenantId, leadId: noteLeadId, authorUserId: null, text: `KI: Antwort klingt interessiert (${assessment.confidence} %)${assessment.quote ? ` – „${assessment.quote}“` : ""}`, source: "text" }).catch(() => null);
  }
  // Antwort-Stopp: eine echte Antwort beendet sofort jede laufende Serie an diese Adresse – egal aus welcher Kampagne die
  // Mail kam. Abwesenheitsnotizen/automatische Antworten zählen nicht als Antwort: die Serie läuft weiter, der Verlauf vermerkt es.
  const autoReply = isAutoReply(assessment, input.subject);
  if (!blocked && autoReply && recipient) await db.insert(emailCampaignEvents).values({ tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: "gewartet", note: `Abwesenheitsnotiz erhalten – zählt nicht als Antwort, Serie läuft weiter: „${(input.subject ?? "").slice(0, 100)}“` });
  if (!blocked && !autoReply && recipient && recipient.sentCount > 0 && !recipient.repliedAt) { await db.update(emailCampaignRecipients).set({ repliedAt: input.receivedAt }).where(eq(emailCampaignRecipients.id, recipient.id)); await db.insert(emailCampaignEvents).values({ tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: "geoeffnet", note: `Antwort im Posteingang: „${(input.subject ?? "").slice(0, 120)}“` }); replied = true;
    const replyLeadId = recipient.leadId ?? lead?.id ?? null; if (replyLeadId) { const { onInboxReply } = await import("./pipeline-extras"); await onInboxReply(db, tenantId, { leadId: replyLeadId, subject: input.subject ?? null }).catch(() => null); } if (replyLeadId && assessment?.kind === "interessiert") { /* Interesse → Kontakt automatisch in die Pipeline „E-Mail-Kampagne“ (Liste „Interesse“), falls er bisher nur in der E-Mail-Akquise stand */ const row = (await db.select({ inPipeline: leads.inPipeline, adPlatform: leads.adPlatform, stage: leads.pipelineStage }).from(leads).where(eq(leads.id, replyLeadId)).limit(1))[0]; if (row && row.inPipeline === false) await db.update(leads).set({ inPipeline: true, adPlatform: row.adPlatform || "email", pipelineStage: row.stage || "neu", pipelineUpdatedAt: new Date() }).where(eq(leads.id, replyLeadId)); }
    await logActivity(db, tenantId, { kind: "email_antwort", title: `Antwort von ${input.fromName?.trim() || input.fromEmail}: „${(input.subject ?? "(ohne Betreff)").slice(0, 100)}“`, detail: assessment ? `KI: ${assessment.kind} (${assessment.confidence} %)` : null, leadId: replyLeadId, refType: "inboxMessage", refId: Number(inserted[0]?.insertId) || null }); }
  // Antwort-Stopp: eine echte Antwort beendet sofort jede laufende Serie an diese Adresse – egal aus welcher Kampagne die Mail kam
  if (!blocked && !autoReply) { const { stopSeriesForContact } = await import("./sales-outreach"); await stopSeriesForContact(db, tenantId, { email: fromEmail, leadId: recipient?.leadId ?? lead?.id ?? null, repliedAt: input.receivedAt }).catch(() => null); }
  return { id: Number(inserted[0]?.insertId) || 0, replied, leadId: recipient?.leadId ?? lead?.id ?? null, ai: assessment ? { kind: assessment.kind, confidence: assessment.confidence, action: decision.action } : null };
}
/** KI-Schalter aus den E-Mail-Einstellungen (Einstellungen → E-Mail-Versand → Antworten). */
export async function replyAiSettings(db: Db, tenantId: number): Promise<ReplyAiSettings> { const row = await ensureSettings(db, tenantId); return { enabled: row.replyAiEnabled ?? DEFAULT_REPLY_AI.enabled, autoBlock: row.replyAiAutoBlock ?? DEFAULT_REPLY_AI.autoBlock, markInterest: row.replyAiInterest ?? DEFAULT_REPLY_AI.markInterest }; }
export type InboxFilter = "alle" | "antworten" | "geantwortet" | "unbekannt" | "ungelesen" | "pruefen" | "archiv" | "gesperrt";

export async function listInbox(db: Db, tenantId: number, options: { filter?: InboxFilter; limit?: number; campaignId?: number | null; from?: Date | null; to?: Date | null; aiKind?: InboxAiFilter | null } = {}) {
  const rows = await db.select({ message: inboxMessages, leadPublicId: leads.publicId, leadStage: leads.pipelineStage, leadPlatform: leads.adPlatform, leadName: leads.firstName, leadLastName: leads.lastName, leadPhone: leads.phone, ownerName: users.name }).from(inboxMessages).leftJoin(leads, eq(leads.id, inboxMessages.leadId)).leftJoin(users, eq(users.id, leads.ownerUserId)).where(and(eq(inboxMessages.tenantId, tenantId), options.filter === "gesperrt" ? eq(inboxMessages.blocked, true) : options.filter === "archiv" ? and(eq(inboxMessages.archived, true), eq(inboxMessages.blocked, false)) : and(eq(inboxMessages.archived, false), eq(inboxMessages.blocked, false)), options.from ? gte(inboxMessages.receivedAt, options.from) : undefined, options.to ? lt(inboxMessages.receivedAt, options.to) : undefined)).orderBy(desc(inboxMessages.receivedAt)).limit(options.limit ?? 200);
  const blockedCount = options.filter === "gesperrt" ? rows.length : Number((await db.select({ count: sql<number>`COUNT(*)` }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.blocked, true))))[0]?.count ?? 0);
  const suppressed = new Set((await db.select({ email: emailSuppressions.email }).from(emailSuppressions).where(eq(emailSuppressions.tenantId, tenantId))).map((row) => row.email));
  const campaignIds = Array.from(new Set(rows.map((row) => row.message.campaignRecipientId).filter((id): id is number => typeof id === "number")));
  const recipients = campaignIds.length ? await db.select({ id: emailCampaignRecipients.id, campaignId: emailCampaignRecipients.campaignId, campaignName: emailCampaigns.name }).from(emailCampaignRecipients).innerJoin(emailCampaigns, eq(emailCampaigns.id, emailCampaignRecipients.campaignId)).where(inArray(emailCampaignRecipients.id, campaignIds)) : [];
  // Von uns beantwortet: Antworten aus dem Posteingang hängen an der eingegangenen Mail (outboundMessages.inboxMessageId)
  const answered = new Map<number, Date>(); const messageIds = rows.map((row) => row.message.id);
  for (let i = 0; i < messageIds.length; i += 1000) { const chunk = messageIds.slice(i, i + 1000); if (!chunk.length) continue; for (const row of await db.select({ inboxMessageId: outboundMessages.inboxMessageId, at: outboundMessages.createdAt }).from(outboundMessages).where(and(eq(outboundMessages.tenantId, tenantId), inArray(outboundMessages.inboxMessageId, chunk)))) { if (!row.inboxMessageId) continue; const before = answered.get(row.inboxMessageId); if (!before || before < row.at) answered.set(row.inboxMessageId, row.at); } }
  const items = rows.map(({ message, leadPublicId, leadStage, leadPlatform, leadName, leadLastName, leadPhone, ownerName }) => { const recipient = recipients.find((item) => item.id === message.campaignRecipientId); return { id: message.id, answeredAt: answered.get(message.id) ?? null, fromEmail: message.fromEmail, fromName: message.fromName, subject: message.subject, bodyText: message.bodyText ?? "", phoneHint: extractPhone(message.bodyText), receivedAt: message.receivedAt, isRead: message.isRead, archived: message.archived, blocked: message.blocked, optOut: message.optOut, suppressed: suppressed.has(message.fromEmail), ai: message.aiKind ? { kind: message.aiKind as import("../shared/reply-ai").ReplyKind, confidence: message.aiConfidence ?? 0, quote: message.aiQuote ?? null, reason: message.aiReason ?? null, source: (message.aiSource ?? "regeln") as "ki" | "regeln", action: (message.aiAction ?? null) as import("../shared/reply-ai").ReplyAction } : null, campaignName: recipient?.campaignName ?? null, campaignId: recipient?.campaignId ?? null, lead: leadPublicId ? { publicId: leadPublicId, name: `${leadName ?? ""} ${leadLastName ?? ""}`.trim() || leadPublicId, stage: isStage(leadStage) ? leadStage : leadStage ? "neu" : null, platform: leadPlatform, owner: ownerName?.split(" ")[0] ?? null, phone: leadPhone ?? null } : null }; });
  const byStatus = options.filter === "antworten" ? items.filter((item) => item.campaignName) : options.filter === "geantwortet" ? items.filter((item) => item.answeredAt) : options.filter === "unbekannt" ? items.filter((item) => !item.lead) : options.filter === "ungelesen" ? items.filter((item) => !item.isRead) : options.filter === "pruefen" ? items.filter((item) => item.ai?.action === "pruefen") : items;
  // Filter je Kampagne: nur Antworten auf diese Serie; die Kampagnen-Chips zählen innerhalb des aktuellen Ordners (Posteingang/Archiv/Gesperrt)
  const byCampaign = options.campaignId ? byStatus.filter((item) => item.campaignId === options.campaignId) : byStatus;
  // Filter nach KI-Einordnung: eine Art, „automatisch gesperrt“, „zu prüfen“ oder „ohne Einordnung“
  const aiFilter = options.aiKind; const filtered = aiFilter ? byCampaign.filter((item) => matchesAiFilter(item.ai, aiFilter)) : byCampaign;
  const campaigns = Array.from(items.reduce((map, item) => { if (item.campaignId && item.campaignName) { const entry = map.get(item.campaignId) ?? { id: item.campaignId, name: item.campaignName, count: 0 }; entry.count += 1; map.set(item.campaignId, entry); } return map; }, new Map<number, { id: number; name: string; count: number }>()).values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"));
  // Zähler beziehen sich immer auf den aktiven Posteingang (ohne Archiv/Gesperrt), damit sie beim Wechsel der Filter stabil bleiben
    // Zähler: immer der ganze aktive Posteingang (ohne Archiv/Gesperrt, ohne Zeitraum-Filter), damit sie beim Wechsel der Filter stabil bleiben
  const active = options.filter === "archiv" || options.filter === "gesperrt" || options.from || options.to ? await db.select({ campaignRecipientId: inboxMessages.campaignRecipientId, leadId: inboxMessages.leadId, isRead: inboxMessages.isRead, aiAction: inboxMessages.aiAction }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.archived, false), eq(inboxMessages.blocked, false))) : null;
  const activeAnswered = active ? Number((await db.select({ count: sql<number>`COUNT(DISTINCT ${outboundMessages.inboxMessageId})` }).from(outboundMessages).innerJoin(inboxMessages, eq(inboxMessages.id, outboundMessages.inboxMessageId)).where(and(eq(outboundMessages.tenantId, tenantId), eq(inboxMessages.archived, false), eq(inboxMessages.blocked, false))))[0]?.count ?? 0) : 0;
  const counts = active ? { alle: active.length, geantwortet: activeAnswered, antworten: active.filter((row) => row.campaignRecipientId).length, unbekannt: active.filter((row) => !row.leadId).length, ungelesen: active.filter((row) => !row.isRead).length, pruefen: active.filter((row) => row.aiAction === "pruefen").length, gesperrt: blockedCount } : { alle: items.length, geantwortet: items.filter((item) => item.answeredAt).length, antworten: items.filter((item) => item.campaignName).length, unbekannt: items.filter((item) => !item.lead).length, ungelesen: items.filter((item) => !item.isRead).length, pruefen: items.filter((item) => item.ai?.action === "pruefen").length, gesperrt: blockedCount };
  return { items: filtered, counts, campaigns };
}
/** Alle E-Mails dieses Absenders (eingegangen und unsere Antworten) an den Lead hängen – so steht der ganze Verlauf an der Karte. Gibt die Zahl der verknüpften Nachrichten zurück. */
async function linkThread(db: Db, tenantId: number, leadId: number, email: string) {
  const address = email.toLowerCase();
  const incoming = await db.select({ id: inboxMessages.id }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.fromEmail, address), isNull(inboxMessages.leadId)));
  if (incoming.length) await db.update(inboxMessages).set({ leadId }).where(inArray(inboxMessages.id, incoming.map((row) => row.id)));
  const outgoing = await db.select({ id: outboundMessages.id }).from(outboundMessages).where(and(eq(outboundMessages.tenantId, tenantId), eq(outboundMessages.toAddress, address), isNull(outboundMessages.leadId)));
  if (outgoing.length) await db.update(outboundMessages).set({ leadId }).where(inArray(outboundMessages.id, outgoing.map((row) => row.id)));
  const total = await db.select({ count: sql<number>`COUNT(*)` }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.leadId, leadId)));
  return { incoming: Number(total[0]?.count ?? 0), replies: outgoing.length };
}
/** Absender sperren: Adresse auf die Sperrliste (Unterliste „Posteingang“), laufende Serien stoppen, alle seine Nachrichten nach „Gesperrt“. */
export async function blockSender(db: Db, tenantId: number, input: { messageId: number; note?: string | null }) {
  const message = (await db.select().from(inboxMessages).where(and(eq(inboxMessages.id, input.messageId), eq(inboxMessages.tenantId, tenantId))).limit(1))[0]; if (!message) throw new Error("Nachricht nicht gefunden.");
  const result = await addSuppression(db, tenantId, { email: message.fromEmail, reason: "gesperrt", note: input.note?.trim() || `Im Posteingang gesperrt: „${(message.subject ?? "").slice(0, 120)}“`, source: "Posteingang" });
  const own = await db.select({ id: inboxMessages.id }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.fromEmail, message.fromEmail)));
  await db.update(inboxMessages).set({ blocked: true, isRead: true }).where(inArray(inboxMessages.id, own.map((row) => row.id)));
  return { email: message.fromEmail, messages: own.length, stopped: result.stopped };
}
/** Sperre aufheben: Adresse von der Sperrliste, Nachrichten zurück in den Posteingang. */
export async function unblockSender(db: Db, tenantId: number, input: { messageId: number }) {
  const message = (await db.select().from(inboxMessages).where(and(eq(inboxMessages.id, input.messageId), eq(inboxMessages.tenantId, tenantId))).limit(1))[0]; if (!message) throw new Error("Nachricht nicht gefunden.");
  await removeSuppressionByEmail(db, tenantId, message.fromEmail);
  const own = await db.select({ id: inboxMessages.id }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.fromEmail, message.fromEmail)));
  await db.update(inboxMessages).set({ blocked: false }).where(inArray(inboxMessages.id, own.map((row) => row.id)));
  return { email: message.fromEmail, messages: own.length };
}
/** „Prüfen“-Markierung der KI erledigen (Absender ist in Ordnung) – die Einordnung bleibt sichtbar, die Nachricht verschwindet aus dem Ordner „Prüfen“. */
export async function resolveCheck(db: Db, tenantId: number, id: number) { await db.update(inboxMessages).set({ aiAction: "geprueft" }).where(and(eq(inboxMessages.id, id), eq(inboxMessages.tenantId, tenantId))); return { success: true as const }; }
/** Mehrere Mails auf einmal (Posteingang ankreuzen): gelesen/ungelesen, archivieren/zurückholen, Absender sperren, löschen. */
export async function bulkAction(db: Db, tenantId: number, input: { ids: number[]; action: "gelesen" | "ungelesen" | "archivieren" | "zurueck" | "sperren" | "loeschen" }) {
  const ids = Array.from(new Set(input.ids)).slice(0, 2000); if (!ids.length) return { count: 0 };
  const rows = await db.select({ id: inboxMessages.id, fromEmail: inboxMessages.fromEmail, blocked: inboxMessages.blocked }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), inArray(inboxMessages.id, ids)));
  if (!rows.length) return { count: 0 };
  const own = rows.map((row) => row.id);
  if (input.action === "loeschen") return { count: (await deleteMessages(db, tenantId, own)).deleted };
  if (input.action === "gelesen" || input.action === "ungelesen") { await db.update(inboxMessages).set({ isRead: input.action === "gelesen" }).where(and(eq(inboxMessages.tenantId, tenantId), inArray(inboxMessages.id, own))); return { count: own.length }; }
  if (input.action === "archivieren" || input.action === "zurueck") { for (const id of own) await archive(db, tenantId, id, input.action === "archivieren"); return { count: own.length }; }
  // sperren: je Absender einmal
  const seen = new Set<string>(); let count = 0;
  for (const row of rows) { const email = row.fromEmail.toLowerCase(); if (row.blocked || seen.has(email)) continue; seen.add(email); await blockSender(db, tenantId, { messageId: row.id, note: "Im Posteingang gesperrt (mehrere ausgewählt)" }); count += 1; }
  return { count };
}
export async function markRead(db: Db, tenantId: number, id: number, isRead: boolean) { await db.update(inboxMessages).set({ isRead }).where(and(eq(inboxMessages.id, id), eq(inboxMessages.tenantId, tenantId))); return { success: true as const }; }
export async function archive(db: Db, tenantId: number, id: number, archived: boolean) { await db.update(inboxMessages).set({ archived, isRead: true }).where(and(eq(inboxMessages.id, id), eq(inboxMessages.tenantId, tenantId))); return { success: true as const }; }
/** Absender als Lead in die Pipeline übernehmen (oder bestehenden Lead in die gewählte Pipeline/Stufe setzen). */
export async function createLeadFromMessage(db: Db, tenantId: number, input: { messageId: number; pipeline: "ads" | "kaltakquise" | "email"; stage: string; ownerUserId?: number | null; categoryId?: number | null; firstName?: string | null; lastName?: string | null; company?: string | null; phone?: string | null; actorUserId: number | null }) {
  const message = (await db.select().from(inboxMessages).where(and(eq(inboxMessages.id, input.messageId), eq(inboxMessages.tenantId, tenantId))).limit(1))[0]; if (!message) throw new Error("Nachricht nicht gefunden.");
  const stage = isStage(input.stage) ? input.stage : "kontaktiert";
  if (message.blocked) throw new Error("Dieser Absender ist gesperrt – erst die Sperre aufheben.");
  const existing = message.leadId ? (await db.select().from(leads).where(and(eq(leads.id, message.leadId), eq(leads.kind, "vertrieb"))).limit(1))[0] : (await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.email, message.fromEmail))).limit(1))[0];
  if (existing) {
    const campaignOf = message.campaignRecipientId ? (await db.select({ id: emailCampaigns.id, name: emailCampaigns.name }).from(emailCampaignRecipients).innerJoin(emailCampaigns, eq(emailCampaigns.id, emailCampaignRecipients.campaignId)).where(eq(emailCampaignRecipients.id, message.campaignRecipientId)).limit(1))[0] ?? null : null;
    const platform = input.pipeline === "kaltakquise" ? "kaltakquise" : input.pipeline === "email" ? "email" : existing.adPlatform === "kaltakquise" || existing.adPlatform === "email" ? "posteingang" : existing.adPlatform ?? "posteingang";
    const campaignId = input.pipeline === "email" ? (campaignOf ? `email-${campaignOf.id}` : "email-posteingang") : input.pipeline === "kaltakquise" ? existing.adCampaignId ?? "liste-posteingang" : existing.adCampaignId ?? "posteingang";
    const campaignName = input.pipeline === "email" ? (campaignOf ? campaignOf.name : "Posteingang") : input.pipeline === "kaltakquise" ? existing.adCampaignName ?? "Liste: Posteingang" : existing.adCampaignName ?? "Posteingang";
    const phoneFromMail = existing.phone ? null : (input.phone?.trim() || extractPhone(message.bodyText)); // Nummer nachtragen, damit der Dialer sofort nutzbar ist
    await db.update(leads).set({ pipelineStage: stage, pipelineUpdatedAt: new Date(), ownerUserId: input.ownerUserId ?? existing.ownerUserId, adPlatform: platform, listName: input.pipeline === "kaltakquise" ? existing.listName ?? "Posteingang" : existing.listName, adCampaignId: campaignId, adCampaignName: campaignName, ...(phoneFromMail ? { phone: phoneFromMail } : {}) }).where(eq(leads.id, existing.id));
    if (phoneFromMail) await db.insert(pipelineEvents).values({ tenantId, leadId: existing.id, fromStage: null, toStage: "kontakt", actorUserId: input.actorUserId, note: `Telefon aus dem Posteingang übernommen: ${phoneFromMail}` });
    await db.insert(pipelineEvents).values({ tenantId, leadId: existing.id, fromStage: isStage(existing.pipelineStage) ? existing.pipelineStage : null, toStage: stage, actorUserId: input.actorUserId, note: `Aus Posteingang: „${(message.subject ?? "").slice(0, 120)}“` });
    await db.update(inboxMessages).set({ leadId: existing.id, isRead: true }).where(eq(inboxMessages.id, message.id));
    const linked = await linkThread(db, tenantId, existing.id, message.fromEmail);
    return { leadId: existing.id, publicId: existing.publicId, created: false, linked };
  }
  const categoryId = input.categoryId ?? (await db.select({ id: leadCategories.id }).from(leadCategories).where(and(eq(leadCategories.tenantId, tenantId), eq(leadCategories.status, "aktiv"))).limit(1))[0]?.id; if (!categoryId) throw new Error("Keine Lead-Kategorie vorhanden.");
  const guessed = (message.fromName ?? message.fromEmail.split("@")[0]).replace(/[._]/g, " ").trim().split(/\s+/); const firstName = input.firstName?.trim() || (guessed.length > 1 ? guessed[0] : null); const lastName = input.lastName?.trim() || (guessed.length > 1 ? guessed.slice(1).join(" ") : guessed[0]);
  const publicId = `${input.pipeline === "kaltakquise" ? "KALT" : "MAIL"}-${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  const newCampaign = message.campaignRecipientId ? (await db.select({ id: emailCampaigns.id, name: emailCampaigns.name }).from(emailCampaignRecipients).innerJoin(emailCampaigns, eq(emailCampaigns.id, emailCampaignRecipients.campaignId)).where(eq(emailCampaignRecipients.id, message.campaignRecipientId)).limit(1))[0] ?? null : null;
  const inserted = await db.insert(leads).values({ tenantId, publicId, categoryId, kind: "vertrieb", firstName, lastName, email: message.fromEmail, phone: input.phone?.trim() || extractPhone(message.bodyText), country: "DE", supplierName: "Posteingang", metadata: { posteingang: { messageId: message.messageId, subject: message.subject } }, status: "neu", cost: "0.00", pipelineStage: stage, pipelineUpdatedAt: new Date(), ownerUserId: input.ownerUserId ?? null, company: input.company?.trim() || null, listName: input.pipeline === "kaltakquise" ? "Posteingang" : null, adPlatform: input.pipeline === "kaltakquise" ? "kaltakquise" : input.pipeline === "email" ? "email" : "posteingang", adCampaignId: input.pipeline === "kaltakquise" ? "liste-posteingang" : input.pipeline === "email" ? (newCampaign ? `email-${newCampaign.id}` : "email-posteingang") : "posteingang", adCampaignName: input.pipeline === "kaltakquise" ? "Liste: Posteingang" : input.pipeline === "email" ? (newCampaign?.name ?? "Posteingang") : "Posteingang" });
  const leadId = Number(inserted[0]?.insertId) || 0;
  await db.insert(leadStatusEvents).values({ tenantId, leadId, previousStatus: null, nextStatus: "neu", actorUserId: input.actorUserId, note: `Aus Posteingang angelegt: „${(message.subject ?? "").slice(0, 120)}“` });
  await db.insert(pipelineEvents).values({ tenantId, leadId, fromStage: null, toStage: stage, actorUserId: input.actorUserId, note: `Aus Posteingang: „${(message.subject ?? "").slice(0, 120)}“` });
  await db.update(inboxMessages).set({ leadId, isRead: true }).where(eq(inboxMessages.id, message.id));
  const linked = await linkThread(db, tenantId, leadId, message.fromEmail);
  return { leadId, publicId, created: true, linked };
}
/**
 * Mehrere Posteingangs-Nachrichten auf einmal als Leads in die Pipeline übernehmen (Mehrfachauswahl).
 * Gleiche Logik wie einzeln: bestehende Kontakte werden in die Stufe gesetzt und verknüpft, neue angelegt
 * (Name aus Absender geraten), gesperrte Absender werden übersprungen. Dieselbe Adresse entsteht nur einmal –
 * die zweite Nachricht findet den gerade angelegten Lead und zählt als „aktualisiert“.
 */
export async function createLeadsFromMessages(db: Db, tenantId: number, input: { messageIds: number[]; pipeline: "ads" | "kaltakquise" | "email"; stage: string; ownerUserId?: number | null; categoryId?: number | null; actorUserId: number | null }) {
  let created = 0; let updated = 0; const skipped: string[] = [];
  for (const messageId of input.messageIds) {
    try { const result = await createLeadFromMessage(db, tenantId, { messageId, pipeline: input.pipeline, stage: input.stage, ownerUserId: input.ownerUserId ?? null, categoryId: input.categoryId ?? null, actorUserId: input.actorUserId }); if (result.created) created += 1; else updated += 1; }
    catch (error) { skipped.push(error instanceof Error ? error.message : "Nachricht übersprungen"); }
  }
  return { created, updated, skipped: skipped.length, skippedNote: skipped[0] ?? null };
}
/**
 * KI-Antwortvorschlag: liest die eingegangene Antwort (plus unsere letzte Kampagnen-Mail als Zusammenhang) und schreibt
 * einen kurzen Antwortentwurf – zum Lesen, Ändern und Abschicken. Ohne KI-Schlüssel kommt eine passende Vorlage.
 * Keine Grußformel am Ende – die Signatur hängt der Versand an.
 */
export async function suggestReply(db: Db, tenantId: number, messageId: number): Promise<{ text: string; source: "ki" | "vorlage" }> {
  const message = (await db.select().from(inboxMessages).where(and(eq(inboxMessages.id, messageId), eq(inboxMessages.tenantId, tenantId))).limit(1))[0]; if (!message) throw new Error("Nachricht nicht gefunden.");
  const recipient = message.campaignRecipientId ? (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, message.campaignRecipientId)).limit(1))[0] ?? null : null;
  const lastSent = recipient ? (await db.select({ subject: emailCampaignEvents.subject }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.recipientId, recipient.id), eq(emailCampaignEvents.kind, "gesendet"))).orderBy(desc(emailCampaignEvents.id)).limit(1))[0]?.subject ?? null : null;
  const name = (message.fromName ?? "").trim();
  const lead = recipient?.leadId ? (await db.select({ lastName: leads.lastName, metadata: leads.metadata, listName: leads.listName }).from(leads).where(eq(leads.id, recipient.leadId)).limit(1))[0] ?? null : null;
  // Leadsparte der Kampagne, auf die geantwortet wurde: Hausnotruf-Firmen bekommen eine Antwort zu Hausnotruf-Leads (mit sechs Fragen), nie zu Wärmepumpen
  const campaign = recipient ? (await db.select({ leadSparte: emailCampaigns.leadSparte, name: emailCampaigns.name, audience: emailCampaigns.audience }).from(emailCampaigns).where(eq(emailCampaigns.id, recipient.campaignId)).limit(1))[0] ?? null : null;
  const sparte = campaign ? sparteOf(campaign, [...audienceLists((campaign.audience ?? null) as never), lead?.listName ?? ""].filter(Boolean)) : DEFAULT_SPARTE;
  const questions = questionCount(sparte); const qualifiedBy = questions ? `in der Regel anhand von ${numberWord(questions)} Fragen` : "anhand gezielter Fragen";
  const salutation = String((lead?.metadata as { salutation?: string } | null)?.salutation ?? "").toLowerCase(); const lastName = (lead?.lastName ?? "").trim();
  const anrede = lastName && (salutation === "herr" || salutation === "frau") ? `Sehr geehrte${salutation === "frau" ? "" : "r"} ${salutation === "frau" ? "Frau" : "Herr"} ${lastName},` : "Guten Tag,"; // nie „Guten Tag Vorname Nachname“ – ohne sichere Anrede neutral; `name` nur fürs Protokoll
  void name;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { invokeLLM } = await import("./_core/llm");
      const system = `Du beantwortest für Tanesco Digital (einer der größten Leadlieferanten Deutschlands für ${sparte.leads}) Antworten auf unsere Akquise-E-Mails an ${sparte.recipients}. Es geht ausschließlich um ${sparte.leads}${isEnergySparte(sparte) ? "" : " – kein Wort zu Photovoltaik, Solar oder Wärmepumpen"}. Schreibe EINE kurze Antwort (60–120 Wörter), Deutsch, Sie-Form, freundlich und konkret: beantworte die Fragen aus der Nachricht, nutze nur diese Fakten – Leads exklusiv, telefonisch vorqualifiziert (${qualifiedBy}${questions ? " – genau diese Zahl, keine andere" : " – keine Zahl nennen"}; der Interessent erwartet danach die Rückmeldung eines ${partnerGenitive(sparte)} – den Firmennamen des Betriebs nennen wir dabei nicht, das nie behaupten), Übergabe in Echtzeit per Schnittstelle, keine Vorkasse, keine lange Vertragsbindung, 20 Test-Leads kostenlos individuell für den Betrieb.${paysOnlyFitting(sparte) ? " Der Betrieb zahlt nur für Leads, die zu ihm passen." : " Behaupte nicht, dass nur passende Leads bezahlt werden – das gilt hier nicht."} Nenne KEINE Preise (die klären wir im Gespräch). Ziel: ein kurzes Telefonat vereinbaren – schlage vor, dass der Interessent zwei Zeitfenster nennt, oder biete an, dass wir anrufen. Bei Absagen: höflich bedanken, kein Druck, Tür offen lassen. Anrede: „Sehr geehrter Herr Nachname,“ / „Sehr geehrte Frau Nachname,“ wenn die Anrede sicher ist (aus der Signatur der Nachricht oder einem eindeutigen Vornamen), sonst nur „Guten Tag,“ – nie „Hallo“, nie „Guten Tag Vorname Nachname“. Keine Grußformel und kein Name am Ende (die Signatur hängt das System an), keine Links, keine Ausrufezeichen. Aroundhome und andere Portale erwähnst du nie; Bewertungen höchstens als Google-Bewertungen, wenn sie in der Nachricht stehen.`;
      const user = `Eingegangene Antwort von ${message.fromName ?? message.fromEmail} (${message.fromEmail}):\nBetreff: ${message.subject ?? "(ohne Betreff)"}\n\n${(message.bodyText ?? "").slice(0, 4000)}${lastSent ? `\n\nUnsere letzte E-Mail an diesen Kontakt hatte den Betreff: „${lastSent}“` : ""}\n\nSchreibe die Antwort.`;
      const response = await invokeLLM({ maxTokens: 700, temperature: 0.5, messages: [{ role: "system", content: system }, { role: "user", content: user }] });
      const text = String(response.choices[0]?.message.content ?? "").trim();
      if (text.length > 30) { const { stripClosing } = await import("./campaign-review"); return { text: fixQuestionCount(applyPayFit(stripClosing(text), { sparte }), sparte), source: "ki" }; } // Zahl der Fragen und „nur passende Leads zahlen“ passend zur Sparte
    } catch { /* Vorlage unten */ }
  }
  const text = `${anrede}\n\nvielen Dank für Ihre Rückmeldung.\n\nGerne stimme ich die Einzelheiten direkt mit Ihnen ab – unsere Anfragen sind exklusiv, telefonisch vorqualifiziert und werden in Echtzeit übergeben, und zum Kennenlernen erhalten Sie 20 Test-Leads kostenlos. Passt Ihnen diese Woche ein kurzes Telefonat? Nennen Sie mir gerne zwei Zeitfenster, oder wir rufen Sie einfach an.`;
  return { text, source: "vorlage" };
}
/** Antwort aus dem Posteingang schicken (über den eingerichteten Versand). */
export async function reply(db: Db, tenantId: number, input: { messageId: number; text: string; actorUserId?: number | null; attachments?: MailAttachmentInput[] | null; appUrl?: string | null }) {
  const message = (await db.select().from(inboxMessages).where(and(eq(inboxMessages.id, input.messageId), eq(inboxMessages.tenantId, tenantId))).limit(1))[0]; if (!message) throw new Error("Nachricht nicht gefunden.");
  const text = input.text.trim(); if (!text) throw new Error("Bitte einen Text eingeben.");
  const files = input.attachments ?? []; const problem = checkAttachments(files); if (problem) throw new Error(problem);
  const subject = /^re:/i.test(message.subject ?? "") ? message.subject! : `Re: ${message.subject ?? ""}`.trim();
  // Signatur aus den E-Mail-Einstellungen unter den Text – als HTML und als reiner Text
  const signature = await signatureFor(db, tenantId, input.appUrl ?? null);
  const html = `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#101828">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>${signature.html}`;
  const sent = await deliverMail({ to: message.fromEmail, subject, html, text: `${text}${signature.text}`, attachments: files.map((file) => ({ filename: file.filename, content: file.contentBase64, contentType: file.contentType || undefined, encoding: "base64" as const })) }, { db, tenantId }); if (!sent.ok) throw new Error(sent.note ?? "Versand fehlgeschlagen");
  await db.update(inboxMessages).set({ isRead: true }).where(eq(inboxMessages.id, message.id));
  // Antwort im E-Mail-Verlauf festhalten – auch ohne Lead (wird beim Anlegen des Leads nachträglich verknüpft)
  const leadId = message.leadId ?? (await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.email, message.fromEmail))).limit(1))[0]?.id ?? null;
  await db.insert(outboundMessages).values({ tenantId, leadId, channel: "email", toAddress: message.fromEmail, subject: subject.slice(0, 320), text, status: sent.status === "gesendet" ? "gesendet" : "simuliert", provider: "posteingang", inboxMessageId: message.id, attachments: files.length ? files.map((file) => ({ filename: file.filename, size: file.size, contentType: file.contentType })) : null, createdByUserId: input.actorUserId ?? null });
  return { status: sent.status, attachments: files.length };
}
export { isNull };

/* ---------- Gesendet ---------- */
export type SentKind = "kampagne" | "antwort" | "einzel";
/**
 * Alles, was wir per E-Mail herausgeschickt haben – an einer Stelle:
 * Kampagnen-Mails aus den Serien (Verlauf der Empfänger), Antworten aus dem Posteingang und Einzel-E-Mails aus einer Karte.
 * Filter: Suche (Adresse, Betreff), Zeitraum, Kampagne, Art und Reaktion (geöffnet, geklickt, geantwortet …).
 * Je Kampagnen-Mail steht dabei, was danach passiert ist (siehe shared/sent-tracking.ts) – und der Kontakt ist verlinkt.
 */
export async function listSent(db: Db, tenantId: number, options: { search?: string | null; from?: Date | null; to?: Date | null; campaignId?: number | null; kind?: SentKind | null; reaction?: SentReaction | null; timeFrom?: string | null; timeTo?: string | null; leadId?: number | null; email?: string | null; limit?: number } = {}) {
  const limit = Math.min(500, Math.max(10, options.limit ?? 200));
  // Zeitraum (Datum + Uhrzeit) und Kampagne direkt in der Abfrage – sonst fielen ältere E-Mails hinter die neuesten 200.
  // Mit Zeitraum oder Uhrzeit werden bis zu 3000 Mails geholt, damit Liste und Zähler für den ganzen Zeitraum stimmen.
  const timeOfDay = Boolean(options.timeFrom || options.timeTo);
  const from = options.from && !Number.isNaN(options.from.getTime()) ? options.from : null; const to = options.to && !Number.isNaN(options.to.getTime()) ? options.to : null;
  const fetchLimit = timeOfDay || from || to ? 3000 : limit; let capped = false;
  // Ein Kontakt (Reiter „Kontakte“): seine Mails über die Kontakt-Nummer oder – falls die fehlt – über die Adresse
  const address = (options.email ?? "").trim().toLowerCase(); const contact = Boolean(options.leadId || address);
  const forRecipient = contact ? [or(...(options.leadId ? [eq(emailCampaignRecipients.leadId, options.leadId)] : []), ...(address ? [sql`lower(${emailCampaignRecipients.email}) = ${address}`] : []))!] : [];
  const forSingle = contact ? [or(...(options.leadId ? [eq(outboundMessages.leadId, options.leadId)] : []), ...(address ? [sql`lower(${outboundMessages.toAddress}) = ${address}`] : []))!] : [];
  const inWindow = <R extends { at: Date }>(rows: R[]) => { if (rows.length >= fetchLimit) capped = true; return timeOfDay ? rows.filter((row) => inTimeOfDay(new Date(row.at), options.timeFrom, options.timeTo)) : rows; };
  const campaignRows = await db.select({ id: emailCampaignEvents.id, at: emailCampaignEvents.createdAt, subject: emailCampaignEvents.subject, note: emailCampaignEvents.note, campaignId: emailCampaignEvents.campaignId, campaignName: emailCampaigns.name, nodeId: emailCampaignEvents.nodeId, bodySource: emailCampaignEvents.bodySource, draftSubject: emailCampaignRecipients.draftSubject, draftSource: emailCampaignRecipients.draftSource, recipientId: emailCampaignRecipients.id, email: emailCampaignRecipients.email, name: emailCampaignRecipients.name, leadId: emailCampaignRecipients.leadId, repliedAt: emailCampaignRecipients.repliedAt, openedAt: emailCampaignRecipients.openedAt, clickedAt: emailCampaignRecipients.clickedAt, bouncedAt: emailCampaignRecipients.bouncedAt })
    .from(emailCampaignEvents)
    .innerJoin(emailCampaignRecipients, eq(emailCampaignRecipients.id, emailCampaignEvents.recipientId))
    .innerJoin(emailCampaigns, eq(emailCampaigns.id, emailCampaignEvents.campaignId))
    .where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.kind, "gesendet"), ...forRecipient, ...(options.campaignId ? [eq(emailCampaignEvents.campaignId, options.campaignId)] : []), ...(from ? [gte(emailCampaignEvents.createdAt, from)] : []), ...(to ? [lt(emailCampaignEvents.createdAt, to)] : [])))
    .orderBy(desc(emailCampaignEvents.createdAt)).limit(fetchLimit).then(inWindow);
  // Einzel-E-Mails und Antworten gehören zu keiner Kampagne – bei gewählter Kampagne gar nicht erst laden
  const singleRows = options.campaignId ? [] : await db.select({ id: outboundMessages.id, at: outboundMessages.createdAt, subject: outboundMessages.subject, text: outboundMessages.text, to: outboundMessages.toAddress, status: outboundMessages.status, inboxMessageId: outboundMessages.inboxMessageId, leadId: outboundMessages.leadId, attachments: outboundMessages.attachments, senderName: users.name })
    .from(outboundMessages).leftJoin(users, eq(users.id, outboundMessages.createdByUserId))
    .where(and(eq(outboundMessages.tenantId, tenantId), eq(outboundMessages.channel, "email"), ...forSingle, ...(from ? [gte(outboundMessages.createdAt, from)] : []), ...(to ? [lt(outboundMessages.createdAt, to)] : [])))
    .orderBy(desc(outboundMessages.createdAt)).limit(fetchLimit).then(inWindow);
  // Reaktionen je Mail: alle Ereignisse der betroffenen Empfänger holen und jeder gesendeten Mail ihr Zeitfenster zuordnen.
  const recipientIds = Array.from(new Set(campaignRows.map((row) => row.recipientId)));
  const events = recipientIds.length ? await db.select({ recipientId: emailCampaignEvents.recipientId, kind: emailCampaignEvents.kind, note: emailCampaignEvents.note, createdAt: emailCampaignEvents.createdAt }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), inArray(emailCampaignEvents.recipientId, recipientIds))) : [];
  const byRecipient = new Map<number, typeof events>();
  for (const event of events) byRecipient.set(event.recipientId, [...(byRecipient.get(event.recipientId) ?? []), event]);
  const sendsOf = (recipientId: number) => (byRecipient.get(recipientId) ?? []).filter((event) => event.kind === "gesendet").map((event) => event.createdAt);
  // Kontakt verlinken: öffentliche Lead-Nummer und Name zu den Lead-IDs.
  const leadIds = Array.from(new Set([...campaignRows, ...singleRows].map((row) => row.leadId).filter((id): id is number => typeof id === "number")));
  const leadRows = leadIds.length ? await db.select({ id: leads.id, publicId: leads.publicId, firstName: leads.firstName, lastName: leads.lastName, company: leads.company }).from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, leadIds))) : [];
  const leadById = new Map(leadRows.map((row) => [row.id, row]));
  const leadInfo = (leadId: number | null) => { const row = leadId ? leadById.get(leadId) : undefined; return row ? { publicId: row.publicId, name: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.company || row.publicId } : null; };
  // Herkunft je Kampagnen-Mail (KI-Text / Ersatz aus Vorlage / Vorlage) – braucht die Betreffzeilen der Vorlagen
  const campaignIds = Array.from(new Set(campaignRows.map((row) => row.campaignId)));
  const trees = campaignIds.length ? await db.select({ id: emailCampaigns.id, tree: emailCampaigns.tree, kiModus: emailCampaigns.kiModus, reviewFirst: emailCampaigns.reviewFirst }).from(emailCampaigns).where(and(eq(emailCampaigns.tenantId, tenantId), inArray(emailCampaigns.id, campaignIds))) : [];
  const templateSubjects = (campaignId: number, nodeId: string | null) => { const tree = trees.find((row) => row.id === campaignId)?.tree as { nodes?: Array<{ id: string; type: string; subject?: string; subjectB?: string | null }> } | null; const node = tree?.nodes?.find((item) => item.id === nodeId && item.type === "send"); return node ? [node.subject, node.subjectB] : []; };
  const kiOnFor = (campaignId: number) => { const row = trees.find((item) => item.id === campaignId); return row ? kiModusOf(row) !== "aus" : undefined; };
  const items = [
    ...campaignRows.map((row) => ({ id: `k${row.id}`, kind: "kampagne" as SentKind, origin: sentSourceOf({ bodySource: row.bodySource, subject: row.subject, draftSubject: row.draftSubject, draftSource: row.draftSource, templateSubjects: templateSubjects(row.campaignId, row.nodeId), kiOn: kiOnFor(row.campaignId) }) as { source: SentSource; known: boolean } | null, at: row.at, to: row.email, name: row.name ?? null, subject: row.subject ?? row.note ?? "(ohne Betreff)", preview: row.campaignName, campaignId: row.campaignId as number | null, campaignName: row.campaignName as string | null, leadId: row.leadId as number | null, lead: leadInfo(row.leadId), status: "gesendet", sender: null as string | null, attachments: [] as Array<{ filename: string; size: number; contentType?: string }>, tracking: trackingForSend(row.at, byRecipient.get(row.recipientId) ?? [], sendsOf(row.recipientId), { openedAt: row.openedAt, clickedAt: row.clickedAt, repliedAt: row.repliedAt, bouncedAt: row.bouncedAt }) as SentTracking | null })),
    ...singleRows.map((row) => ({ id: `e${row.id}`, kind: (row.inboxMessageId ? "antwort" : "einzel") as SentKind, origin: null as { source: SentSource; known: boolean } | null, at: row.at, to: row.to, name: leadInfo(row.leadId)?.name ?? null, subject: row.subject ?? "(ohne Betreff)", preview: (row.text ?? "").replace(/\s+/g, " ").slice(0, 160), campaignId: null as number | null, campaignName: null as string | null, leadId: row.leadId as number | null, lead: leadInfo(row.leadId), status: row.status as string, sender: row.senderName ?? null, tracking: null as SentTracking | null, attachments: (Array.isArray(row.attachments) ? row.attachments : []) as Array<{ filename: string; size: number; contentType?: string }> })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  // Kampagnen-Auswahl: Ist schon eine Kampagne gewählt, enthalten die Zeilen nur diese – dann die Übersicht aller Kampagnen im Zeitraum extra holen
  const overview = options.campaignId ? await db.select({ campaignId: emailCampaignEvents.campaignId, name: emailCampaigns.name, at: emailCampaignEvents.createdAt })
    .from(emailCampaignEvents).innerJoin(emailCampaigns, eq(emailCampaigns.id, emailCampaignEvents.campaignId))
    .where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.kind, "gesendet"), ...(from ? [gte(emailCampaignEvents.createdAt, from)] : []), ...(to ? [lt(emailCampaignEvents.createdAt, to)] : [])))
    .orderBy(desc(emailCampaignEvents.createdAt)).limit(5000) : undefined;
  const result = summarizeSent(items, { ...options, from, to }, { limit, overview });
  return { ...result, capped };
}
