/**
 * Nächste Follow-ups je Kampagne für die Übersicht „E-Mail-Kampagnen“: lädt den Stand aller laufenden und pausierten
 * Kampagnen des Kontos (zusammen, wegen des gemeinsamen Tageslimits) und rechnet mit shared/follow-up-plan.ts.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { emailCampaignEvents, emailCampaignRecipients, emailCampaigns } from "../drizzle/schema";
import type { Db } from "./lead-pipeline";
import { kiModusOf, resolveSendWindow, stopsOnReply, type EmailTree, type SendWindow } from "../shared/email-campaigns";
import { planFollowUps, type FollowUpPlan } from "../shared/follow-up-plan";

export async function followUpPlans(db: Db, tenantId: number, now = new Date()): Promise<Map<number, FollowUpPlan>> {
  const rows = (await db.select({ id: emailCampaigns.id, status: emailCampaigns.status, tree: emailCampaigns.tree, sendWindow: emailCampaigns.sendWindow, stopOnReply: emailCampaigns.stopOnReply, kiModus: emailCampaigns.kiModus, reviewFirst: emailCampaigns.reviewFirst, isTemplate: emailCampaigns.isTemplate, archivedAt: emailCampaigns.archivedAt })
    .from(emailCampaigns).where(and(eq(emailCampaigns.tenantId, tenantId), inArray(emailCampaigns.status, ["aktiv", "pausiert"])))).filter((row) => !row.isTemplate && !row.archivedAt);
  if (!rows.length) return new Map();
  const ids = rows.map((row) => row.id);
  const open = await db.select({ id: emailCampaignRecipients.id, campaignId: emailCampaignRecipients.campaignId, nodeId: emailCampaignRecipients.nodeId, status: emailCampaignRecipients.status, sentCount: emailCampaignRecipients.sentCount, nextActionAt: emailCampaignRecipients.nextActionAt, lastSentAt: emailCampaignRecipients.lastSentAt, openedAt: emailCampaignRecipients.openedAt, clickedAt: emailCampaignRecipients.clickedAt, repliedAt: emailCampaignRecipients.repliedAt, clickedUrls: emailCampaignRecipients.clickedUrls, draftState: emailCampaignRecipients.draftState, draftNodeId: emailCampaignRecipients.draftNodeId })
    .from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), inArray(emailCampaignRecipients.campaignId, ids), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"])));
  // Drip: wann hat die Kampagne zuletzt gesendet (alle Empfänger, auch fertige)
  const lastRows = await db.select({ campaignId: emailCampaignRecipients.campaignId, lastSentAt: emailCampaignRecipients.lastSentAt }).from(emailCampaignRecipients)
    .where(and(eq(emailCampaignRecipients.tenantId, tenantId), inArray(emailCampaignRecipients.campaignId, ids), isNotNull(emailCampaignRecipients.lastSentAt)));
  const lastSent = new Map<number, number>(); for (const row of lastRows) { const at = row.lastSentAt ? new Date(row.lastSentAt).getTime() : 0; if (at > (lastSent.get(row.campaignId) ?? 0)) lastSent.set(row.campaignId, at); }
  // Schon gesendete E-Mails je Empfänger (dieselbe E-Mail geht nie zweimal raus)
  const sentNodes = new Map<number, string[]>(); const withMail = open.filter((row) => row.sentCount > 0).map((row) => row.id);
  for (let offset = 0; offset < withMail.length; offset += 1000) {
    const chunk = withMail.slice(offset, offset + 1000);
    const events = await db.select({ recipientId: emailCampaignEvents.recipientId, nodeId: emailCampaignEvents.nodeId }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.kind, "gesendet"), inArray(emailCampaignEvents.recipientId, chunk)));
    for (const event of events) if (event.nodeId) { const list = sentNodes.get(event.recipientId) ?? []; if (!list.includes(event.nodeId)) list.push(event.nodeId); sentNodes.set(event.recipientId, list); }
  }
  const { campaignDailyStatus } = await import("./campaign-review"); const daily = await campaignDailyStatus(db, tenantId);
  return planFollowUps(rows.map((row) => ({
    id: row.id, status: row.status, tree: (row.tree && typeof row.tree === "object" ? row.tree : { start: null, nodes: [] }) as EmailTree, window: resolveSendWindow(row.sendWindow as Partial<SendWindow> | null),
    stopOnReply: stopsOnReply(row), approval: kiModusOf(row) === "freigabe", lastSentAt: lastSent.has(row.id) ? new Date(lastSent.get(row.id)!) : null,
    recipients: open.filter((item) => item.campaignId === row.id).map((item) => ({ ...item, clickedUrls: (Array.isArray(item.clickedUrls) ? item.clickedUrls : []) as string[], sentNodeIds: sentNodes.get(item.id) ?? [] })),
  })), { now, todayLeft: daily.left, dailyLimit: daily.limit });
}
