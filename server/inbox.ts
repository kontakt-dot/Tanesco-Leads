/**
 * Posteingang: Mails per IMAP abholen (Antworten auf Kampagnen und alles andere), lesen, beantworten und als Lead
 * in die Vertriebspipeline übernehmen (Meta-Ads- oder Kaltakquise-Pipeline).
 */
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { emailCampaignEvents, emailCampaignRecipients, emailCampaigns, emailSuppressions, inboxMessages, leadCategories, leadStatusEvents, leads, mailSettings, outboundMessages, pipelineEvents, pipelineNotes, users } from "../drizzle/schema";
import { decideReply, describeAssessment, DEFAULT_REPLY_AI, matchesAiFilter, type InboxAiFilter, type ReplyAiSettings } from "../shared/reply-ai";
import { assessReply } from "./reply-ai";
import { isStage } from "../shared/sales-pipeline";
import { extractPhone } from "../shared/pipeline-extras";
import { addSuppression, isSuppressed, removeSuppressionByEmail } from "./pipeline-extras";
import { deliverMail } from "./email-onboarding";
import type { Db } from "./lead-pipeline";
import { ensureSettings } from "./mail-settings";

const stripHtml = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
/** Antworttext ohne zitierte Vornachricht („Am … schrieb …“, „>“-Zeilen). */
export function replyExcerpt(text: string) { const lines = text.split("\n"); const out: string[] = []; for (const line of lines) { if (/^(am .* schrieb|on .* wrote|-{3,} ?(ursprüngliche|original)|von: |from: )/i.test(line.trim()) || line.trim().startsWith(">")) break; out.push(line); } return out.join("\n").trim().slice(0, 4000); }

/** IMAP-Abholung: neue Mails der letzten 14 Tage in den Posteingang, Antworten auf Serien markieren, Leads per E-Mail verknüpfen. */
export async function syncInbox(db: Db, tenantId: number) {
  const row = await ensureSettings(db, tenantId); if (!row.imapEnabled || !row.imapHost || !row.imapUsername || !row.imapPassword) throw new Error("IMAP ist nicht eingerichtet (Einstellungen → E-Mail-Versand → Antworten erkennen).");
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({ host: row.imapHost, port: row.imapPort ?? 993, secure: (row.imapPort ?? 993) === 993, auth: { user: row.imapUsername, pass: row.imapPassword }, logger: false });
  const known = new Set((await db.select({ messageId: inboxMessages.messageId }).from(inboxMessages).where(eq(inboxMessages.tenantId, tenantId))).map((item) => item.messageId));
  let scanned = 0; let added = 0; let replies = 0;
  try {
    await client.connect(); const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - 14 * 86_400_000);
      for await (const message of client.fetch({ since }, { envelope: true, uid: true, source: { maxLength: 200_000 } })) {
        scanned += 1; const envelope = message.envelope; const messageId = envelope?.messageId ?? `uid-${message.uid}`; if (known.has(messageId)) continue;
        const from = envelope?.from?.[0]; if (!from?.address) continue; const fromEmail = from.address.toLowerCase(); if (fromEmail === (row.fromEmail ?? "").toLowerCase()) continue;
        let bodyText = ""; try { const raw = message.source?.toString("utf8") ?? ""; const { simpleParser } = await import("mailparser"); const parsed = await simpleParser(raw); bodyText = parsed.text ?? (parsed.html ? stripHtml(String(parsed.html)) : ""); } catch { bodyText = ""; }
        const result = await storeMessage(db, tenantId, { messageId, imapUid: message.uid, fromEmail, fromName: from.name ?? null, subject: envelope?.subject ?? null, bodyText: replyExcerpt(bodyText), receivedAt: envelope?.date ?? new Date() });
        known.add(messageId); added += 1; if (result.replied) replies += 1;
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (error) { throw new Error(`Posteingang abholen fehlgeschlagen: ${error instanceof Error ? error.message.slice(0, 200) : "unbekannt"}`); }
  await db.update(mailSettings).set({ lastReplyCheckAt: new Date() }).where(eq(mailSettings.id, row.id));
  return { scanned, added, replies };
}
/** Eine Mail ablegen (auch ohne IMAP nutzbar, z. B. Test/Webhook) und automatisch verknüpfen. */
export async function storeMessage(db: Db, tenantId: number, input: { messageId: string; imapUid?: number | null; fromEmail: string; fromName?: string | null; subject?: string | null; bodyText: string; receivedAt: Date }, deps: Parameters<typeof assessReply>[3] = {}) {
  const fromEmail = input.fromEmail.toLowerCase();
  const recipient = (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.email, fromEmail))).orderBy(desc(emailCampaignRecipients.createdAt)).limit(1))[0] ?? null;
  const lead = (await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.email, fromEmail))).orderBy(desc(leads.createdAt)).limit(1))[0] ?? null; // nur Vertriebskontakte – Leads zum Verkauf werden nie verknüpft
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
  if (!blocked && recipient && recipient.sentCount > 0 && !recipient.repliedAt) { await db.update(emailCampaignRecipients).set({ repliedAt: input.receivedAt }).where(eq(emailCampaignRecipients.id, recipient.id)); await db.insert(emailCampaignEvents).values({ tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: recipient.nodeId, kind: "geoeffnet", note: `Antwort im Posteingang: „${(input.subject ?? "").slice(0, 120)}“` }); replied = true;
    const replyLeadId = recipient.leadId ?? lead?.id ?? null; if (replyLeadId) { const { onInboxReply } = await import("./pipeline-extras"); await onInboxReply(db, tenantId, { leadId: replyLeadId, subject: input.subject ?? null }).catch(() => null); } }
  return { id: Number(inserted[0]?.insertId) || 0, replied, leadId: recipient?.leadId ?? lead?.id ?? null, ai: assessment ? { kind: assessment.kind, confidence: assessment.confidence, action: decision.action } : null };
}
/** KI-Schalter aus den E-Mail-Einstellungen (Einstellungen → E-Mail-Versand → Antworten). */
export async function replyAiSettings(db: Db, tenantId: number): Promise<ReplyAiSettings> { const row = await ensureSettings(db, tenantId); return { enabled: row.replyAiEnabled ?? DEFAULT_REPLY_AI.enabled, autoBlock: row.replyAiAutoBlock ?? DEFAULT_REPLY_AI.autoBlock, markInterest: row.replyAiInterest ?? DEFAULT_REPLY_AI.markInterest }; }
export type InboxFilter = "alle" | "antworten" | "unbekannt" | "ungelesen" | "pruefen" | "archiv" | "gesperrt";

export async function listInbox(db: Db, tenantId: number, options: { filter?: InboxFilter; limit?: number; campaignId?: number | null; from?: Date | null; to?: Date | null; aiKind?: InboxAiFilter | null } = {}) {
  const rows = await db.select({ message: inboxMessages, leadPublicId: leads.publicId, leadStage: leads.pipelineStage, leadPlatform: leads.adPlatform, leadName: leads.firstName, leadLastName: leads.lastName, leadPhone: leads.phone, ownerName: users.name }).from(inboxMessages).leftJoin(leads, eq(leads.id, inboxMessages.leadId)).leftJoin(users, eq(users.id, leads.ownerUserId)).where(and(eq(inboxMessages.tenantId, tenantId), options.filter === "gesperrt" ? eq(inboxMessages.blocked, true) : options.filter === "archiv" ? and(eq(inboxMessages.archived, true), eq(inboxMessages.blocked, false)) : and(eq(inboxMessages.archived, false), eq(inboxMessages.blocked, false)), options.from ? gte(inboxMessages.receivedAt, options.from) : undefined, options.to ? lt(inboxMessages.receivedAt, options.to) : undefined)).orderBy(desc(inboxMessages.receivedAt)).limit(options.limit ?? 200);
  const blockedCount = options.filter === "gesperrt" ? rows.length : Number((await db.select({ count: sql<number>`COUNT(*)` }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.blocked, true))))[0]?.count ?? 0);
  const suppressed = new Set((await db.select({ email: emailSuppressions.email }).from(emailSuppressions).where(eq(emailSuppressions.tenantId, tenantId))).map((row) => row.email));
  const campaignIds = Array.from(new Set(rows.map((row) => row.message.campaignRecipientId).filter((id): id is number => typeof id === "number")));
  const recipients = campaignIds.length ? await db.select({ id: emailCampaignRecipients.id, campaignId: emailCampaignRecipients.campaignId, campaignName: emailCampaigns.name }).from(emailCampaignRecipients).innerJoin(emailCampaigns, eq(emailCampaigns.id, emailCampaignRecipients.campaignId)).where(inArray(emailCampaignRecipients.id, campaignIds)) : [];
  const items = rows.map(({ message, leadPublicId, leadStage, leadPlatform, leadName, leadLastName, leadPhone, ownerName }) => { const recipient = recipients.find((item) => item.id === message.campaignRecipientId); return { id: message.id, fromEmail: message.fromEmail, fromName: message.fromName, subject: message.subject, bodyText: message.bodyText ?? "", phoneHint: extractPhone(message.bodyText), receivedAt: message.receivedAt, isRead: message.isRead, archived: message.archived, blocked: message.blocked, optOut: message.optOut, suppressed: suppressed.has(message.fromEmail), ai: message.aiKind ? { kind: message.aiKind as import("../shared/reply-ai").ReplyKind, confidence: message.aiConfidence ?? 0, quote: message.aiQuote ?? null, reason: message.aiReason ?? null, source: (message.aiSource ?? "regeln") as "ki" | "regeln", action: (message.aiAction ?? null) as import("../shared/reply-ai").ReplyAction } : null, campaignName: recipient?.campaignName ?? null, campaignId: recipient?.campaignId ?? null, lead: leadPublicId ? { publicId: leadPublicId, name: `${leadName ?? ""} ${leadLastName ?? ""}`.trim() || leadPublicId, stage: isStage(leadStage) ? leadStage : leadStage ? "neu" : null, platform: leadPlatform, owner: ownerName?.split(" ")[0] ?? null, phone: leadPhone ?? null } : null }; });
  const byStatus = options.filter === "antworten" ? items.filter((item) => item.campaignName) : options.filter === "unbekannt" ? items.filter((item) => !item.lead) : options.filter === "ungelesen" ? items.filter((item) => !item.isRead) : options.filter === "pruefen" ? items.filter((item) => item.ai?.action === "pruefen") : items;
  // Filter je Kampagne: nur Antworten auf diese Serie; die Kampagnen-Chips zählen innerhalb des aktuellen Ordners (Posteingang/Archiv/Gesperrt)
  const byCampaign = options.campaignId ? byStatus.filter((item) => item.campaignId === options.campaignId) : byStatus;
  // Filter nach KI-Einordnung: eine Art, „automatisch gesperrt“, „zu prüfen“ oder „ohne Einordnung“
  const aiFilter = options.aiKind; const filtered = aiFilter ? byCampaign.filter((item) => matchesAiFilter(item.ai, aiFilter)) : byCampaign;
  const campaigns = Array.from(items.reduce((map, item) => { if (item.campaignId && item.campaignName) { const entry = map.get(item.campaignId) ?? { id: item.campaignId, name: item.campaignName, count: 0 }; entry.count += 1; map.set(item.campaignId, entry); } return map; }, new Map<number, { id: number; name: string; count: number }>()).values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"));
  // Zähler beziehen sich immer auf den aktiven Posteingang (ohne Archiv/Gesperrt), damit sie beim Wechsel der Filter stabil bleiben
    // Zähler: immer der ganze aktive Posteingang (ohne Archiv/Gesperrt, ohne Zeitraum-Filter), damit sie beim Wechsel der Filter stabil bleiben
  const active = options.filter === "archiv" || options.filter === "gesperrt" || options.from || options.to ? await db.select({ campaignRecipientId: inboxMessages.campaignRecipientId, leadId: inboxMessages.leadId, isRead: inboxMessages.isRead, aiAction: inboxMessages.aiAction }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.archived, false), eq(inboxMessages.blocked, false))) : null;
  const counts = active ? { alle: active.length, antworten: active.filter((row) => row.campaignRecipientId).length, unbekannt: active.filter((row) => !row.leadId).length, ungelesen: active.filter((row) => !row.isRead).length, pruefen: active.filter((row) => row.aiAction === "pruefen").length, gesperrt: blockedCount } : { alle: items.length, antworten: items.filter((item) => item.campaignName).length, unbekannt: items.filter((item) => !item.lead).length, ungelesen: items.filter((item) => !item.isRead).length, pruefen: items.filter((item) => item.ai?.action === "pruefen").length, gesperrt: blockedCount };
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
/** Antwort aus dem Posteingang schicken (über den eingerichteten Versand). */
export async function reply(db: Db, tenantId: number, input: { messageId: number; text: string; actorUserId?: number | null }) {
  const message = (await db.select().from(inboxMessages).where(and(eq(inboxMessages.id, input.messageId), eq(inboxMessages.tenantId, tenantId))).limit(1))[0]; if (!message) throw new Error("Nachricht nicht gefunden.");
  const text = input.text.trim(); if (!text) throw new Error("Bitte einen Text eingeben.");
  const subject = /^re:/i.test(message.subject ?? "") ? message.subject! : `Re: ${message.subject ?? ""}`.trim();
  const html = `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#101828">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>`;
  const sent = await deliverMail({ to: message.fromEmail, subject, html, text }, { db, tenantId }); if (!sent.ok) throw new Error(sent.note ?? "Versand fehlgeschlagen");
  await db.update(inboxMessages).set({ isRead: true }).where(eq(inboxMessages.id, message.id));
  // Antwort im E-Mail-Verlauf festhalten – auch ohne Lead (wird beim Anlegen des Leads nachträglich verknüpft)
  const leadId = message.leadId ?? (await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), eq(leads.email, message.fromEmail))).limit(1))[0]?.id ?? null;
  await db.insert(outboundMessages).values({ tenantId, leadId, channel: "email", toAddress: message.fromEmail, subject: subject.slice(0, 320), text, status: sent.status === "gesendet" ? "gesendet" : "simuliert", provider: "posteingang", inboxMessageId: message.id, createdByUserId: input.actorUserId ?? null });
  return { status: sent.status };
}
export { isNull };

/* ---------- Gesendet ---------- */
export type SentKind = "kampagne" | "antwort" | "einzel";
/**
 * Alles, was wir per E-Mail herausgeschickt haben – an einer Stelle:
 * Kampagnen-Mails aus den Serien (Verlauf der Empfänger), Antworten aus dem Posteingang und Einzel-E-Mails aus einer Karte.
 * Filter: Suche (Adresse, Betreff), Zeitraum, Kampagne und Art.
 */
export async function listSent(db: Db, tenantId: number, options: { search?: string | null; from?: Date | null; to?: Date | null; campaignId?: number | null; kind?: SentKind | null; limit?: number } = {}) {
  const limit = Math.min(500, Math.max(10, options.limit ?? 200));
  const campaignRows = await db.select({ id: emailCampaignEvents.id, at: emailCampaignEvents.createdAt, subject: emailCampaignEvents.subject, note: emailCampaignEvents.note, campaignId: emailCampaignEvents.campaignId, campaignName: emailCampaigns.name, email: emailCampaignRecipients.email, name: emailCampaignRecipients.name, leadId: emailCampaignRecipients.leadId })
    .from(emailCampaignEvents)
    .innerJoin(emailCampaignRecipients, eq(emailCampaignRecipients.id, emailCampaignEvents.recipientId))
    .innerJoin(emailCampaigns, eq(emailCampaigns.id, emailCampaignEvents.campaignId))
    .where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.kind, "gesendet")))
    .orderBy(desc(emailCampaignEvents.createdAt)).limit(limit);
  const singleRows = await db.select({ id: outboundMessages.id, at: outboundMessages.createdAt, subject: outboundMessages.subject, text: outboundMessages.text, to: outboundMessages.toAddress, status: outboundMessages.status, inboxMessageId: outboundMessages.inboxMessageId, leadId: outboundMessages.leadId, senderName: users.name })
    .from(outboundMessages).leftJoin(users, eq(users.id, outboundMessages.createdByUserId))
    .where(and(eq(outboundMessages.tenantId, tenantId), eq(outboundMessages.channel, "email")))
    .orderBy(desc(outboundMessages.createdAt)).limit(limit);
  const items = [
    ...campaignRows.map((row) => ({ id: `k${row.id}`, kind: "kampagne" as SentKind, at: row.at, to: row.email, name: row.name ?? null, subject: row.subject ?? row.note ?? "(ohne Betreff)", preview: row.campaignName, campaignId: row.campaignId as number | null, campaignName: row.campaignName as string | null, leadId: row.leadId as number | null, status: "gesendet", sender: null as string | null })),
    ...singleRows.map((row) => ({ id: `e${row.id}`, kind: (row.inboxMessageId ? "antwort" : "einzel") as SentKind, at: row.at, to: row.to, name: null as string | null, subject: row.subject ?? "(ohne Betreff)", preview: (row.text ?? "").replace(/\s+/g, " ").slice(0, 160), campaignId: null as number | null, campaignName: null as string | null, leadId: row.leadId as number | null, status: row.status as string, sender: row.senderName ?? null })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const search = (options.search ?? "").trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (options.kind && item.kind !== options.kind) return false;
    if (options.campaignId && item.campaignId !== options.campaignId) return false;
    if (options.from && new Date(item.at) < options.from) return false;
    if (options.to && new Date(item.at) > options.to) return false;
    if (search && !`${item.to} ${item.name ?? ""} ${item.subject} ${item.campaignName ?? ""}`.toLowerCase().includes(search)) return false;
    return true;
  });
  const campaigns = Array.from(items.reduce((map, item) => { if (item.campaignId && item.campaignName) { const entry = map.get(item.campaignId) ?? { id: item.campaignId, name: item.campaignName, count: 0 }; entry.count += 1; map.set(item.campaignId, entry); } return map; }, new Map<number, { id: number; name: string; count: number }>()).values()).sort((a, b) => b.count - a.count);
  const counts = { alle: items.length, kampagne: items.filter((item) => item.kind === "kampagne").length, antwort: items.filter((item) => item.kind === "antwort").length, einzel: items.filter((item) => item.kind === "einzel").length };
  return { items: filtered.slice(0, limit), counts, campaigns };
}
