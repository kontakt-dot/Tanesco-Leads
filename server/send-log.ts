/**
 * Versand-Protokoll und Doppelt-Schutz der E-Mail-Kampagnen.
 *
 * Versand-Protokoll (`emailSendLog`): Jede Kampagnen-E-Mail, die rausgeht, bekommt eine Zeile – und die bleibt, auch wenn Kontakte,
 * Empfänger oder ganze Kampagnen gelöscht werden. Damit stimmen „Heute X gesendet“ (je Kampagne und zusammen), das Tageslimit und die
 * Budgets der Absender-Adressen immer: Löschen macht nie Platz für mehr E-Mails am selben Tag.
 *
 * Doppelt-Schutz: Steht eine Adresse (z. B. nach „Entfernen“ oder Löschen und erneutem Hinzufügen der Liste) als NEUER Empfänger in einer
 * Kampagne, die sie schon bekommen hat, geht die Erst-E-Mail nicht noch einmal raus. Ihr Verlauf wird aus dem Protokoll – bei älteren
 * Fällen aus dem Pipeline-Verlauf („E-Mail aus „…“ versendet“) – wiederhergestellt, und sie macht dort weiter, wo sie war (Wartezeit,
 * Nachfass-Mail). Zwei offene Einträge derselben Adresse laufen nie parallel: der weitere bleibt, der andere wird beendet.
 * Ausnahme: bewusst noch einmal aufgenommen („Weiterer Durchlauf“, „In E-Mail-Kampagne“ von Hand) – dann ist `againAt` gesetzt.
 * Jede Änderung steht unter „Rückgängig & Papierkorb“ (Art „Nicht doppelt“) und lässt sich zurücknehmen.
 */
import { and, eq, gte, inArray, isNull, like, lte, sql } from "drizzle-orm";
import { activityLog, emailCampaignEvents, emailCampaignRecipients, emailCampaigns, emailSendLog, inboxMessages, pipelineEvents } from "../drizzle/schema";
import { dayStartIn, firstSendNode, REPLY_STOP_NOTE, stopsOnReply, type EmailTree } from "../shared/email-campaigns";
import { RESTORED_NOTE, replayPosition, sentTracePrefix, type SendRecord } from "../shared/send-guard";
export { withSendLog } from "../shared/send-guard";
import { isAutoReply } from "../shared/reply-ai";
import type { ReplyKind } from "../shared/reply-ai";
import type { Db } from "./lead-pipeline";

type Campaign = typeof emailCampaigns.$inferSelect;
type Recipient = typeof emailCampaignRecipients.$inferSelect;
const OPEN = ["wartet", "laeuft"] as const;
const isOpen = (status: string) => status === "wartet" || status === "laeuft";
const lower = (email: string | null | undefined) => String(email ?? "").trim().toLowerCase();
const chunks = <T,>(items: T[], size = 500): T[][] => { const out: T[][] = []; for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size)); return out; };
const affected = (result: unknown) => Number((result as Array<{ affectedRows?: number }> | undefined)?.[0]?.affectedRows ?? 0) || 0;
const insertIdOf = (result: unknown) => Number((result as Array<{ insertId?: number }> | undefined)?.[0]?.insertId ?? 0) || 0;
const treeOf = (campaign: { tree: unknown }): EmailTree => ((campaign.tree ?? { start: null, nodes: [] }) as EmailTree);
const stamp = (at: Date) => at.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/* ---------- Versand-Protokoll ---------- */

/** Eine gesendete Kampagnen-E-Mail festhalten (direkt nach dem Ereignis „gesendet“). Doppelt eingetragen wird nie (eventId ist eindeutig). */
export async function logSent(db: Db, entry: { tenantId: number; campaignId: number; recipientId?: number | null; leadId?: number | null; email: string; nodeId?: string | null; sender?: string | null; eventId?: number | null; sentAt?: Date | null }) {
  try {
    await db.insert(emailSendLog).values({ tenantId: entry.tenantId, campaignId: entry.campaignId, recipientId: entry.recipientId ?? null, leadId: entry.leadId ?? null, email: lower(entry.email).slice(0, 320), nodeId: entry.nodeId ?? null, sender: entry.sender ? entry.sender.slice(0, 320) : null, eventId: entry.eventId ?? null, ...(entry.sentAt ? { sentAt: entry.sentAt } : {}) })
      .onDuplicateKeyUpdate({ set: { eventId: sql`${emailSendLog.eventId}` } });
  } catch (error) { console.error("[Versand-Protokoll] Eintrag fehlt:", error instanceof Error ? error.message : error); }
}

/**
 * Protokoll nachtragen (beim Start, nach dem Wiederherstellen): gesendete E-Mails aus dem Verlauf, die noch fehlen – und aus dem
 * Papierkorb (gelöschte Kontakte, aus Kampagnen entfernte Empfänger, gelöschte Kampagnen), damit auch sie zählen und nie doppelt kommen.
 */
export async function backfillSendLog(db: Db, tenantId?: number | null): Promise<{ events: number; trash: number }> {
  const scope = tenantId ? sql` AND e.tenantId = ${tenantId}` : sql``;
  const live = await db.execute(sql`INSERT IGNORE INTO \`emailSendLog\` (\`tenantId\`, \`campaignId\`, \`recipientId\`, \`leadId\`, \`email\`, \`nodeId\`, \`sender\`, \`eventId\`, \`sentAt\`) SELECT e.tenantId, e.campaignId, e.recipientId, r.leadId, LOWER(COALESCE(r.email, '')), e.nodeId, e.sender, e.id, e.createdAt FROM \`emailCampaignEvents\` e LEFT JOIN \`emailCampaignRecipients\` r ON r.id = e.recipientId LEFT JOIN \`emailSendLog\` l ON l.eventId = e.id WHERE e.kind = 'gesendet' AND l.id IS NULL AND (e.note IS NULL OR e.note NOT LIKE ${`${RESTORED_NOTE}%`})${scope}`); // nachgetragene E-Mails haben ihre Zeile schon
  let trash = 0;
  try {
    const since = new Date(Date.now() - 61 * 86_400_000); const trashScope = tenantId ? sql` AND u.tenantId = ${tenantId}` : sql``;
    const [rows] = (await db.execute(sql`SELECT u.tenantId AS tenantId, ev.id AS eventId, ev.campaignId AS campaignId, ev.recipientId AS recipientId, ev.nodeId AS nodeId, ev.sender AS sender, ev.createdAt AS createdAt, rc.leadId AS leadId, rc.email AS email FROM \`undoLog\` u CROSS JOIN JSON_TABLE(u.payload, '$.emailCampaignEvents[*]' COLUMNS (id INT PATH '$.id', campaignId INT PATH '$.campaignId', recipientId INT PATH '$.recipientId', kind VARCHAR(20) PATH '$.kind', nodeId VARCHAR(40) PATH '$.nodeId', sender VARCHAR(320) PATH '$.sender', note VARCHAR(400) PATH '$.note', createdAt VARCHAR(40) PATH '$.createdAt')) AS ev LEFT JOIN JSON_TABLE(u.payload, '$.emailCampaignRecipients[*]' COLUMNS (id INT PATH '$.id', leadId INT PATH '$.leadId', email VARCHAR(320) PATH '$.email')) AS rc ON rc.id = ev.recipientId LEFT JOIN \`emailSendLog\` l ON l.eventId = ev.id WHERE u.kind IN ('loeschen', 'empfaenger_weg', 'kampagne_weg') AND u.createdAt >= ${since} AND ev.kind = 'gesendet' AND ev.id IS NOT NULL AND l.id IS NULL AND (ev.note IS NULL OR ev.note NOT LIKE ${`${RESTORED_NOTE}%`})${trashScope} LIMIT 20000`)) as unknown as [Array<{ tenantId: number; eventId: number; campaignId: number | null; recipientId: number | null; nodeId: string | null; sender: string | null; createdAt: string | null; leadId: number | null; email: string | null }>];
    for (const part of chunks(rows ?? [], 300)) {
      const values = part.filter((row) => row.campaignId && row.eventId).map((row) => { const at = row.createdAt ? new Date(row.createdAt) : null; return { tenantId: Number(row.tenantId), campaignId: Number(row.campaignId), recipientId: row.recipientId ?? null, leadId: row.leadId ?? null, email: lower(row.email).slice(0, 320), nodeId: row.nodeId ?? null, sender: row.sender ?? null, eventId: Number(row.eventId), ...(at && !Number.isNaN(at.getTime()) ? { sentAt: at } : {}) }; });
      if (!values.length) continue;
      const result = await db.insert(emailSendLog).values(values).onDuplicateKeyUpdate({ set: { eventId: sql`${emailSendLog.eventId}` } });
      trash += Math.min(values.length, affected(result));
    }
  } catch (error) { console.error("[Versand-Protokoll] Papierkorb nicht gelesen:", error instanceof Error ? error.message : error); }
  return { events: affected(live), trash };
}

/** Glocke („Kampagne X: N E-Mails gesendet“) ab einem Zeitpunkt je Kampagne – zählt auch E-Mails, deren Empfänger früher gelöscht wurden. */
async function bellSentSince(db: Db, tenantId: number, since: Date) {
  const rows = await db.select({ campaignId: activityLog.refId, count: sql<number>`sum(${activityLog.count})` }).from(activityLog).where(and(eq(activityLog.tenantId, tenantId), eq(activityLog.kind, "email_gesendet"), eq(activityLog.refType, "emailCampaign"), gte(activityLog.createdAt, since))).groupBy(activityLog.refId);
  return new Map(rows.filter((row) => row.campaignId).map((row) => [Number(row.campaignId), Number(row.count) || 0]));
}
/** Gesendete Kampagnen-E-Mails je Kampagne in einem Zeitraum – laut Protokoll. */
export async function sentByCampaign(db: Db, tenantId: number, range: { from?: Date | null; until?: Date | null; campaignId?: number | null } = {}) {
  const rows = await db.select({ campaignId: emailSendLog.campaignId, count: sql<number>`count(*)` }).from(emailSendLog).where(and(eq(emailSendLog.tenantId, tenantId), ...(range.campaignId ? [eq(emailSendLog.campaignId, range.campaignId)] : []), ...(range.from ? [gte(emailSendLog.sentAt, range.from)] : []), ...(range.until ? [lte(emailSendLog.sentAt, range.until)] : []))).groupBy(emailSendLog.campaignId);
  return new Map(rows.map((row) => [row.campaignId, Number(row.count) || 0]));
}
/**
 * Heute gesendet je Kampagne: Protokoll, mindestens aber die Glocke (die zählte schon vor dem Protokoll mit – falls heute vor dem Update
 * Empfänger gelöscht wurden, stimmt die Zahl trotzdem).
 */
export async function sentTodayByCampaign(db: Db, tenantId: number, now = new Date()) {
  const since = dayStartIn(now); const [log, bell] = await Promise.all([sentByCampaign(db, tenantId, { from: since }), bellSentSince(db, tenantId, since)]);
  const out = new Map<number, number>(); for (const [id, count] of Array.from(log.entries())) out.set(id, count);
  for (const [id, count] of Array.from(bell.entries())) out.set(id, Math.max(out.get(id) ?? 0, count));
  return out;
}
/** Heute gesendet, alle Kampagnen zusammen – für das Tageslimit. */
export async function sentTodayTotal(db: Db, tenantId: number, now = new Date()): Promise<number> {
  let total = 0; for (const count of Array.from((await sentTodayByCampaign(db, tenantId, now)).values())) total += count; return total;
}
/** Heute gesendet je Absender-Adresse (Budget der Zusatz-Adressen). */
export async function sentTodayBySenderLog(db: Db, tenantId: number, now = new Date()) {
  const rows = await db.select({ sender: emailSendLog.sender, count: sql<number>`count(*)` }).from(emailSendLog).where(and(eq(emailSendLog.tenantId, tenantId), gte(emailSendLog.sentAt, dayStartIn(now)))).groupBy(emailSendLog.sender);
  const out = new Map<string, number>(); for (const row of rows) { const key = lower(row.sender); out.set(key, (out.get(key) ?? 0) + (Number(row.count) || 0)); } return out;
}
/** Gesendet seit einem Zeitpunkt in einer Kampagne (Drip: höchstens X pro Stunde). */
export async function sentSinceInCampaign(db: Db, campaignId: number, since: Date): Promise<number> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(emailSendLog).where(and(eq(emailSendLog.campaignId, campaignId), gte(emailSendLog.sentAt, since)));
  return Number(count) || 0;
}
/** Kampagnen umziehen (Zusammenführen): die Protokoll-Zeilen der übernommenen E-Mails gehören danach zum Ziel. */
export async function moveSendLog(db: Db, tenantId: number, eventIds: number[], to: { campaignId: number; recipientId: number }) {
  for (const part of chunks(eventIds, 500)) await db.update(emailSendLog).set({ campaignId: to.campaignId, recipientId: to.recipientId }).where(and(eq(emailSendLog.tenantId, tenantId), inArray(emailSendLog.eventId, part)));
}

/* ---------- Doppelt-Schutz ---------- */

type ReconcileItem = { recipientId: number; kind: "doppelt" | "entfernt" | "wiederhergestellt"; row?: Record<string, unknown> | null; events?: Array<Record<string, unknown>> | null; before: { status: string; nodeId: string | null; nextActionAt: string | null; sentCount: number; lastSentAt: string | null; repliedAt: string | null; draftState: string | null; draftNodeId: string | null; draftSubject: string | null; draftText: string | null; draftSource: string | null; draftApproach: string | null; draftAt: string | null }; eventIds: number[]; logIds: number[]; movedLogs: Array<{ id: number; recipientId: number | null }> };
export type ReconcileResult = { duplicates: number; restored: number; items: ReconcileItem[] };
const iso = (value: Date | null | undefined) => (value ? new Date(value).toISOString() : null);
const beforeOf = (row: Recipient): ReconcileItem["before"] => ({ status: row.status, nodeId: row.nodeId ?? null, nextActionAt: iso(row.nextActionAt), sentCount: row.sentCount, lastSentAt: iso(row.lastSentAt), repliedAt: iso(row.repliedAt), draftState: row.draftState ?? null, draftNodeId: row.draftNodeId ?? null, draftSubject: row.draftSubject ?? null, draftText: row.draftText ?? null, draftSource: row.draftSource ?? null, draftApproach: row.draftApproach ?? null, draftAt: iso(row.draftAt) });
const clearedDraft = { draftState: null, draftSubject: null, draftText: null, draftOptions: null, draftApproach: null, draftNodeId: null, draftSource: null, draftAt: null } as const;
/** Welcher von zwei offenen Einträgen derselben Adresse bleibt: der weitere (mehr E-Mails), dann der ältere. */
const better = (a: Recipient, b: Recipient) => (b.sentCount - a.sentCount) || (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) || (a.id - b.id);

/**
 * Doppelten Eintrag herausnehmen, wenn er selbst nie etwas bekommen hat (oder nur nachgetragene E-Mails): Antworten, Protokoll und alles
 * Weitere hängen danach am Eintrag, der bleibt. Mit allem, was zum Zurücknehmen nötig ist. Hat er echte E-Mails bekommen → null (bleibt).
 */
async function dropTwin(db: Db, tenantId: number, campaignId: number, twin: Recipient, keepId: number): Promise<ReconcileItem | null> {
  const twinEvents = await db.select().from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.recipientId, twin.id)));
  if (twinEvents.some((event) => event.kind === "gesendet" && !(event.note ?? "").startsWith(RESTORED_NOTE))) return null;
  await db.update(inboxMessages).set({ campaignRecipientId: keepId }).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.campaignRecipientId, twin.id)));
  const movedLogs = await db.select({ id: emailSendLog.id, recipientId: emailSendLog.recipientId }).from(emailSendLog).where(and(eq(emailSendLog.tenantId, tenantId), eq(emailSendLog.campaignId, campaignId), eq(emailSendLog.recipientId, twin.id)));
  if (movedLogs.length) await db.update(emailSendLog).set({ recipientId: keepId }).where(and(eq(emailSendLog.tenantId, tenantId), inArray(emailSendLog.id, movedLogs.map((row) => row.id))));
  await db.delete(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.recipientId, twin.id)));
  await db.delete(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, twin.id));
  return { recipientId: twin.id, kind: "entfernt", row: twin as unknown as Record<string, unknown>, events: twinEvents as unknown as Array<Record<string, unknown>>, before: beforeOf(twin), eventIds: [], logIds: [], movedLogs };
}

/**
 * Nach dem Wiederherstellen aus dem Papierkorb: Wurde dieselbe Adresse in der Zwischenzeit neu in die Kampagne aufgenommen (z. B. Liste neu
 * hochgeladen) und hat dort selbst noch nichts bekommen, kommt dieser neuere Eintrag raus – der wiederhergestellte trägt den Verlauf weiter.
 */
export async function dropRecreatedTwins(db: Db, tenantId: number, restoredIds: number[]): Promise<number> {
  const ids = Array.from(new Set(restoredIds.map(Number).filter((id) => id > 0))); if (!ids.length) return 0;
  const restored: Recipient[] = []; for (const part of chunks(ids, 500)) restored.push(...(await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), inArray(emailCampaignRecipients.id, part)))));
  const idSet = new Set(ids); let dropped = 0;
  const byCampaign = new Map<number, Recipient[]>(); for (const row of restored) byCampaign.set(row.campaignId, [...(byCampaign.get(row.campaignId) ?? []), row]);
  for (const [campaignId, own] of Array.from(byCampaign.entries())) {
    const emails = Array.from(new Set(own.map((row) => lower(row.email))));
    const rows: Recipient[] = []; for (const part of chunks(emails, 400)) rows.push(...(await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaignId), inArray(emailCampaignRecipients.email, part)))));
    const items: ReconcileItem[] = [];
    for (const old of own) {
      for (const twin of rows.filter((row) => !idSet.has(row.id) && lower(row.email) === lower(old.email) && !row.againAt && new Date(row.createdAt).getTime() >= new Date(old.createdAt).getTime())) {
        const item = await dropTwin(db, tenantId, campaignId, twin, old.id); if (item) { items.push(item); idSet.add(twin.id); }
      }
    }
    if (!items.length) continue;
    dropped += items.length;
    const campaign = (await db.select({ name: emailCampaigns.name }).from(emailCampaigns).where(eq(emailCampaigns.id, campaignId)).limit(1))[0];
    const { recordUndo } = await import("./undo");
    await recordUndo(db, tenantId, { kind: "doppelt", title: `Kampagne „${campaign?.name ?? campaignId}“: ${items.length} ${items.length === 1 ? "neuer Eintrag" : "neue Einträge"} nach dem Wiederherstellen entfernt – der alte Eintrag trägt den Verlauf, keine E-Mail doppelt`, count: items.length, actorUserId: null, payload: { campaignId, items } }).catch(() => 0);
  }
  return dropped;
}

/**
 * Doppelt-Schutz für eine Kampagne. `recipientIds`: nur diese prüfen (z. B. die gerade fälligen) – sonst alle offenen ohne E-Mail.
 * Gibt zurück, wie viele doppelte Einträge beendet und wie viele Verläufe wiederhergestellt wurden.
 */
export async function reconcileCampaign(db: Db, tenantId: number, campaign: Campaign, options: { recipientIds?: number[] | null } = {}): Promise<ReconcileResult> {
  const result: ReconcileResult = { duplicates: 0, restored: 0, items: [] };
  if (campaign.isTemplate) return result;
  const conditions = [eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaign.id), inArray(emailCampaignRecipients.status, [...OPEN]), eq(emailCampaignRecipients.sentCount, 0), isNull(emailCampaignRecipients.againAt)];
  const candidates: Recipient[] = [];
  if (options.recipientIds) { for (const part of chunks(Array.from(new Set(options.recipientIds)), 500)) candidates.push(...(await db.select().from(emailCampaignRecipients).where(and(...conditions, inArray(emailCampaignRecipients.id, part))))); }
  else candidates.push(...(await db.select().from(emailCampaignRecipients).where(and(...conditions))));
  if (!candidates.length) return result;
  // alle Einträge der Kampagne mit denselben Adressen
  const emails = Array.from(new Set(candidates.map((row) => lower(row.email)).filter(Boolean)));
  const rows: Recipient[] = []; for (const part of chunks(emails, 400)) rows.push(...(await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaign.id), inArray(emailCampaignRecipients.email, part)))));
  const groups = new Map<string, Recipient[]>(); for (const row of rows) { const key = lower(row.email); if (!emails.includes(key)) continue; groups.set(key, [...(groups.get(key) ?? []), row]); }
  // Protokoll: E-Mails dieser Kampagne an diese Adressen
  const logs: Array<{ id: number; recipientId: number | null; email: string; nodeId: string | null; sender: string | null; sentAt: Date }> = [];
  for (const part of chunks(emails, 400)) logs.push(...(await db.select({ id: emailSendLog.id, recipientId: emailSendLog.recipientId, email: emailSendLog.email, nodeId: emailSendLog.nodeId, sender: emailSendLog.sender, sentAt: emailSendLog.sentAt }).from(emailSendLog).where(and(eq(emailSendLog.tenantId, tenantId), eq(emailSendLog.campaignId, campaign.id), inArray(emailSendLog.email, part)))));
  // Ältere Fälle (vor dem Protokoll gelöscht): Hinweis im Pipeline-Verlauf, dass die erste E-Mail dieser Kampagne an den Kontakt rausging
  const leadIds = Array.from(new Set(candidates.map((row) => row.leadId).filter((id): id is number => typeof id === "number")));
  const traces = new Map<number, Date>();
  if (leadIds.length && campaign.startedAt) {
    const startedAt = new Date(new Date(campaign.startedAt).getTime() - 60_000);
    for (const part of chunks(leadIds, 500)) for (const row of await db.select({ leadId: pipelineEvents.leadId, createdAt: pipelineEvents.createdAt }).from(pipelineEvents).where(and(eq(pipelineEvents.tenantId, tenantId), inArray(pipelineEvents.leadId, part), like(pipelineEvents.note, `${sentTracePrefix(campaign.name).replace(/[\\%_]/g, (char) => `\\${char}`)}%`), gte(pipelineEvents.createdAt, startedAt)))) { const at = new Date(row.createdAt); const known = traces.get(row.leadId); if (!known || at < known) traces.set(row.leadId, at); }
  }
  const tree = treeOf(campaign); const stopReply = stopsOnReply(campaign);
  for (const [email, group] of Array.from(groups.entries())) {
    const open = group.filter((row) => isOpen(row.status)).sort(better);
    if (!open.length) continue;
    const keep = open[0];
    // zwei offene Einträge derselben Adresse (z. B. nach dem Wiederherstellen aus dem Papierkorb): nur der weitere läuft. Hat der andere
    // selbst nie etwas bekommen (oder nur nachgetragene E-Mails), kommt er ganz raus – sonst wird er beendet. Keine E-Mail doppelt.
    for (const twin of open.slice(1)) {
      if (twin.againAt) continue; // bewusst noch einmal aufgenommen bzw. „Nicht doppelt“ zurückgenommen
      const dropped = await dropTwin(db, tenantId, campaign.id, twin, keep.id);
      if (dropped) { result.items.push(dropped); result.duplicates += 1; continue; }
      await db.update(emailCampaignRecipients).set({ status: "fertig", nodeId: null, nextActionAt: null, ...clearedDraft }).where(eq(emailCampaignRecipients.id, twin.id));
      const inserted = await db.insert(emailCampaignEvents).values({ tenantId, campaignId: campaign.id, recipientId: twin.id, nodeId: twin.nodeId, kind: "beendet", note: `Doppelt in der Kampagne – ${email} läuft schon über den anderen Eintrag, keine E-Mail doppelt` });
      result.items.push({ recipientId: twin.id, kind: "doppelt", before: beforeOf(twin), eventIds: [insertIdOf(inserted)].filter(Boolean), logIds: [], movedLogs: [] }); result.duplicates += 1;
    }
    if (keep.sentCount > 0 || keep.againAt) continue;
    if (!candidates.some((row) => row.id === keep.id)) continue;
    if (group.some((row) => row.id !== keep.id && row.sentCount > 0)) continue; // früherer Durchlauf steht noch da (z. B. „Weiterer Durchlauf“) – dann gilt der neue
    const ids = new Set(group.map((row) => row.id));
    const lost = logs.filter((row) => lower(row.email) === email && (row.recipientId === null || !ids.has(row.recipientId))); // E-Mails an gelöschte Einträge
    let sends: SendRecord[] = lost.map((row) => ({ nodeId: row.nodeId, at: new Date(row.sentAt), sender: row.sender, logId: row.id }));
    const trace = keep.leadId ? traces.get(keep.leadId) : undefined;
    if (!sends.length && trace && trace.getTime() < new Date(keep.createdAt).getTime()) sends = [{ nodeId: firstSendNode(tree)?.id ?? null, at: trace, sender: null, logId: null }];
    if (!sends.length) continue;
    const replay = replayPosition(tree, sends); if (!replay) continue;
    const item: ReconcileItem = { recipientId: keep.id, kind: "wiederhergestellt", before: beforeOf(keep), eventIds: [], logIds: [], movedLogs: [] };
    for (const send of replay.sends) {
      const inserted = await db.insert(emailCampaignEvents).values({ tenantId, campaignId: campaign.id, recipientId: keep.id, nodeId: send.nodeId, kind: "gesendet", note: `${RESTORED_NOTE} ging am ${stamp(send.at)} Uhr schon raus – nicht noch einmal gesendet`, sender: send.sender ?? null, createdAt: send.at });
      const eventId = insertIdOf(inserted); if (eventId) item.eventIds.push(eventId);
      if (send.logId) { const old = lost.find((row) => row.id === send.logId); item.movedLogs.push({ id: send.logId, recipientId: old?.recipientId ?? null }); await db.update(emailSendLog).set({ recipientId: keep.id }).where(eq(emailSendLog.id, send.logId)); }
      else { const logged = await db.insert(emailSendLog).values({ tenantId, campaignId: campaign.id, recipientId: keep.id, leadId: keep.leadId ?? null, email, nodeId: send.nodeId, sender: null, eventId: eventId || null, sentAt: send.at }).onDuplicateKeyUpdate({ set: { eventId: sql`${emailSendLog.eventId}` } }); const logId = insertIdOf(logged); if (logId) item.logIds.push(logId); }
    }
    const last = replay.sends[replay.sends.length - 1]; const position = replay.position;
    if (position.wait) { const inserted = await db.insert(emailCampaignEvents).values({ tenantId, campaignId: campaign.id, recipientId: keep.id, nodeId: position.wait.id, kind: "gewartet", note: `Wartet ${position.wait.hours} Stunden (bis ${position.nextActionAt!.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}) – Verlauf wiederhergestellt`, createdAt: new Date(last.at.getTime() + 1000) }); const eventId = insertIdOf(inserted); if (eventId) item.eventIds.push(eventId); }
    if (position.status === "fertig") { const inserted = await db.insert(emailCampaignEvents).values({ tenantId, campaignId: campaign.id, recipientId: keep.id, nodeId: last.nodeId, kind: "beendet", note: "Letzte E-Mail ging schon raus – Ablauf beendet (Verlauf wiederhergestellt)", createdAt: new Date(last.at.getTime() + 1000) }); const eventId = insertIdOf(inserted); if (eventId) item.eventIds.push(eventId); }
    // Antwort verloren gegangen? Hat die Adresse nach der ersten E-Mail geantwortet (keine Abwesenheitsnotiz), gilt sie als geantwortet
    const reply = (await db.select({ receivedAt: inboxMessages.receivedAt, subject: inboxMessages.subject, aiKind: inboxMessages.aiKind, aiConfidence: inboxMessages.aiConfidence }).from(inboxMessages).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.fromEmail, email), gte(inboxMessages.receivedAt, replay.sends[0].at))).limit(20)).filter((row) => !isAutoReply(row.aiKind ? { kind: row.aiKind as ReplyKind, confidence: row.aiConfidence ?? 0 } : null, row.subject)).sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime())[0];
    const stopNow = Boolean(reply && stopReply && position.status !== "fertig");
    await db.update(emailCampaignRecipients).set({ sentCount: replay.sends.length, lastSentAt: last.at, status: stopNow ? "fertig" : position.status, nodeId: stopNow ? null : position.nodeId, nextActionAt: stopNow ? null : position.nextActionAt, ...(reply ? { repliedAt: reply.receivedAt } : {}), lastError: null, ...clearedDraft }).where(eq(emailCampaignRecipients.id, keep.id));
    if (stopNow) { const inserted = await db.insert(emailCampaignEvents).values({ tenantId, campaignId: campaign.id, recipientId: keep.id, nodeId: position.nodeId, kind: "beendet", note: REPLY_STOP_NOTE }); const eventId = insertIdOf(inserted); if (eventId) item.eventIds.push(eventId); }
    result.items.push(item); result.restored += 1;
  }
  if (result.items.length) {
    const { recordUndo } = await import("./undo"); const { logActivity } = await import("./activity");
    const parts = [result.restored ? `${result.restored} ${result.restored === 1 ? "Kontakt hatte" : "Kontakte hatten"} die Kampagne schon bekommen – Verlauf wiederhergestellt, keine E-Mail doppelt` : "", result.duplicates ? `${result.duplicates} doppelte ${result.duplicates === 1 ? "Eintrag" : "Einträge"} beendet` : ""].filter(Boolean);
    await recordUndo(db, tenantId, { kind: "doppelt", title: `Kampagne „${campaign.name}“: ${parts.join(" · ")}`, count: result.items.length, actorUserId: null, payload: { campaignId: campaign.id, items: result.items } }).catch((error) => console.error("[Doppelt-Schutz] Rückgängig-Eintrag fehlt:", error instanceof Error ? error.message : error));
    await logActivity(db, tenantId, { kind: "kampagne", title: `Kampagne „${campaign.name}“: nicht doppelt angeschrieben`.slice(0, 200), detail: `${parts.join(". ")}. Zurücknehmen unter „Rückgängig & Papierkorb“.`, count: result.items.length, refType: "emailCampaign", refId: campaign.id });
  }
  return result;
}

/** Doppelt-Schutz für alle Kampagnen (beim Start und nach dem Wiederherstellen aus dem Papierkorb). */
export async function reconcileAllCampaigns(db: Db, tenantId?: number | null, campaignIds?: number[] | null): Promise<{ duplicates: number; restored: number }> {
  const conditions = [eq(emailCampaigns.isTemplate, false), ...(tenantId ? [eq(emailCampaigns.tenantId, tenantId)] : []), ...(campaignIds?.length ? [inArray(emailCampaigns.id, campaignIds)] : [])];
  const rows = await db.select().from(emailCampaigns).where(and(...conditions));
  let duplicates = 0; let restored = 0;
  for (const campaign of rows) { try { const result = await reconcileCampaign(db, campaign.tenantId, campaign); duplicates += result.duplicates; restored += result.restored; } catch (error) { console.error(`[Doppelt-Schutz] Kampagne ${campaign.id}:`, error instanceof Error ? error.message : error); } }
  return { duplicates, restored };
}

/** „Nicht doppelt“ zurücknehmen: Einträge stehen wieder wie vorher (bekommen die Erst-E-Mail dann doch), die eingefügten Verläufe sind weg. */
export async function undoReconcile(db: Db, tenantId: number, payload: { campaignId?: number; items?: ReconcileItem[] }) {
  let done = 0;
  const revive = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value) ? new Date(value) : value]));
  for (const item of payload.items ?? []) {
    if (item.kind === "entfernt" && item.row) { // doppelter Eintrag kam ganz raus → mit Verlauf zurück (gleiche ID)
      try { await db.insert(emailCampaignRecipients).values(Object.assign(revive(item.row), { againAt: new Date() }) as never); } catch { /* gibt es schon */ }
      for (const event of item.events ?? []) { try { await db.insert(emailCampaignEvents).values(revive(event) as never); } catch { /* gibt es schon */ } }
      for (const moved of item.movedLogs) await db.update(emailSendLog).set({ recipientId: moved.recipientId }).where(and(eq(emailSendLog.tenantId, tenantId), eq(emailSendLog.id, moved.id)));
      done += 1; continue;
    }
    const row = (await db.select({ id: emailCampaignRecipients.id }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.id, item.recipientId))).limit(1))[0]; if (!row) continue;
    const before = item.before; const date = (value: string | null) => (value ? new Date(value) : null);
    await db.update(emailCampaignRecipients).set({ status: before.status as Recipient["status"], nodeId: before.nodeId, nextActionAt: date(before.nextActionAt), sentCount: before.sentCount, lastSentAt: date(before.lastSentAt), repliedAt: date(before.repliedAt), draftState: before.draftState, draftNodeId: before.draftNodeId, draftSubject: before.draftSubject, draftText: before.draftText, draftSource: before.draftSource, draftApproach: before.draftApproach, draftAt: date(before.draftAt), againAt: new Date() /* bewusst zurückgenommen – der Schutz greift für diesen Eintrag nicht noch einmal */ }).where(eq(emailCampaignRecipients.id, item.recipientId));
    for (const part of chunks(item.eventIds, 500)) await db.delete(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), inArray(emailCampaignEvents.id, part)));
    for (const part of chunks(item.logIds, 500)) await db.delete(emailSendLog).where(and(eq(emailSendLog.tenantId, tenantId), inArray(emailSendLog.id, part)));
    for (const moved of item.movedLogs) await db.update(emailSendLog).set({ recipientId: moved.recipientId }).where(and(eq(emailSendLog.tenantId, tenantId), eq(emailSendLog.id, moved.id)));
    done += 1;
  }
  return done;
}
