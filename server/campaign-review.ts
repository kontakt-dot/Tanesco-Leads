/**
 * Einzeln schreiben & freigeben: Bei Kampagnen mit „Erst-E-Mail einzeln freigeben“ bekommt jeder Lead eine eigene
 * Erst-E-Mail. Die KI schreibt einen Entwurf (Firma, Ort, Branche, Liste), du liest, änderst und gibst frei – erst dann
 * geht sie raus. Nachfass-Mails laufen danach automatisch aus der Vorlage.
 * Dazu das Tageslimit für alle Kampagnen zusammen (Standard 50 E-Mails am Tag).
 */
import { and, asc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { emailCampaignEvents, emailCampaignRecipients, emailCampaigns, leads, mailSettings } from "../drizzle/schema";
import { blocksToPlainText, dayStartIn, DEFAULT_CAMPAIGN_DAILY_LIMIT, fillPlaceholdersSafe, firstSendNode, recipientValues, type EmailTree } from "../shared/email-campaigns";
import { extraFieldsOf } from "../shared/cold-list";
import { invokeLLM } from "./_core/llm";
import type { Db } from "./lead-pipeline";

type Recipient = typeof emailCampaignRecipients.$inferSelect;

export async function campaignDailyLimit(db: Db, tenantId: number): Promise<number> {
  const row = (await db.select({ limit: mailSettings.campaignDailyLimit }).from(mailSettings).where(eq(mailSettings.tenantId, tenantId)).limit(1))[0];
  return row?.limit && row.limit > 0 ? row.limit : DEFAULT_CAMPAIGN_DAILY_LIMIT;
}
export async function sentToday(db: Db, tenantId: number, now = new Date()): Promise<number> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.kind, "gesendet"), gte(emailCampaignEvents.createdAt, dayStartIn(now))));
  return Number(count) || 0;
}
export async function campaignDailyStatus(db: Db, tenantId: number) {
  const limit = await campaignDailyLimit(db, tenantId); const sent = await sentToday(db, tenantId);
  return { limit, sent, left: Math.max(0, limit - sent) };
}
export async function setCampaignDailyLimit(db: Db, tenantId: number, limit: number) {
  const value = Math.max(1, Math.min(2000, Math.round(limit)));
  const existing = (await db.select({ id: mailSettings.id }).from(mailSettings).where(eq(mailSettings.tenantId, tenantId)).limit(1))[0];
  if (existing) await db.update(mailSettings).set({ campaignDailyLimit: value }).where(eq(mailSettings.id, existing.id));
  else await db.insert(mailSettings).values({ tenantId, campaignDailyLimit: value });
  return { limit: value };
}

async function loadContext(db: Db, tenantId: number, recipient: Recipient) {
  const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, recipient.campaignId), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0];
  if (!campaign) throw new Error("Kampagne nicht gefunden.");
  const lead = recipient.leadId ? (await db.select().from(leads).where(and(eq(leads.id, recipient.leadId), eq(leads.tenantId, tenantId))).limit(1))[0] ?? null : null;
  const node = firstSendNode((campaign.tree ?? { start: null, nodes: [] }) as EmailTree);
  if (!node) throw new Error("Die Kampagne hat keine E-Mail im Ablauf.");
  const values = recipientValues({ firstName: lead?.firstName ?? recipient.name?.split(" ")[0], lastName: lead?.lastName ?? recipient.name?.split(" ").slice(1).join(" "), company: lead?.company ?? recipient.company, city: lead?.city, salutation: (lead?.metadata as { salutation?: string } | null)?.salutation ?? null, email: recipient.email, fields: extraFieldsOf(lead?.metadata) });
  return { campaign, lead, node, values };
}

/** Entwurf ohne KI: die Vorlage mit den Daten des Leads gefüllt. */
function templateDraft(node: NonNullable<ReturnType<typeof firstSendNode>>, values: Record<string, string>) {
  return { subject: fillPlaceholdersSafe(node.subject, values).slice(0, 300), text: blocksToPlainText(node.blocks, values) };
}

const SYSTEM = `Du schreibst für Tanesco Digital (Leadlieferant für Photovoltaik und Wärmepumpen in Deutschland) persönliche Erst-E-Mails an Firmen – jede einzeln, wie von Hand geschrieben.
Regeln: Deutsch, Sie-Form. Nimm die Vorlage als Grundlage für Inhalt, Angebot und Ton, aber schreib sie für genau diesen Empfänger um: Firma, Ort, Branche und Zusatzinfos sinnvoll einbauen, ohne zu übertreiben.
Nichts erfinden: keine Zahlen, Projekte, Namen, Bewertungen oder Fakten, die nicht in den Angaben stehen. Keine Floskeln („ich hoffe, es geht Ihnen gut“), kein Werbesprech, keine Ausrufezeichen-Kaskaden.
Länge wie die Vorlage oder kürzer (höchstens 170 Wörter). Beginne mit der Anrede, ende mit einer kurzen Grußformel ohne Namen – die Signatur hängt das System an. Keine Links schreiben.
Betreff: konkret, persönlich, höchstens 70 Zeichen, kein Clickbait.`;

async function aiDraft(base: { subject: string; text: string }, info: Record<string, string>) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const facts = Object.entries(info).filter(([, value]) => value && String(value).trim()).map(([key, value]) => `${key}: ${String(value).slice(0, 300)}`).join("\n");
    const response = await invokeLLM({ maxTokens: 1200, temperature: 0.7, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `Empfänger:\n${facts}\n\nVorlage – Betreff: ${base.subject}\n\n${base.text}\n\nSchreibe die persönliche Erst-E-Mail für diesen Empfänger.` }], outputSchema: { name: "persoenliche_email", schema: { type: "object", additionalProperties: false, required: ["subject", "text"], properties: { subject: { type: "string" }, text: { type: "string" } } } } });
    const parsed = JSON.parse(response.choices[0]?.message.content ?? "{}") as { subject?: unknown; text?: unknown };
    const subject = String(parsed.subject ?? "").trim().slice(0, 300); const text = String(parsed.text ?? "").trim();
    return subject && text.length > 40 ? { subject, text } : null;
  } catch { return null; }
}

/** Entwurf für einen Empfänger schreiben (KI, sonst Vorlage) und speichern – Zustand „entwurf“. */
export async function draftForRecipient(db: Db, tenantId: number, recipientId: number) {
  const recipient = (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.id, recipientId), eq(emailCampaignRecipients.tenantId, tenantId))).limit(1))[0];
  if (!recipient) throw new Error("Empfänger nicht gefunden.");
  if (recipient.sentCount > 0) throw new Error("Die erste E-Mail an diesen Kontakt ist schon raus.");
  const { lead, node, values } = await loadContext(db, tenantId, recipient);
  const base = templateDraft(node, values);
  const meta = (lead?.metadata ?? {}) as Record<string, unknown>;
  const info: Record<string, string> = { Firma: values.firma, Ansprechpartner: [values.anrede, values.vorname, values.nachname].filter(Boolean).join(" "), Ort: values.stadt, "PLZ": String(lead?.postcode ?? ""), Webseite: String(meta.website ?? meta.webseite ?? ""), Liste: String(lead?.listName ?? ""), ...Object.fromEntries(Object.entries(extraFieldsOf(lead?.metadata)).map(([key, value]) => [key, String(value)])) };
  const ai = await aiDraft(base, info);
  const draft = ai ?? base; const source = ai ? "ki" : "vorlage";
  await db.update(emailCampaignRecipients).set({ draftSubject: draft.subject, draftText: draft.text, draftState: "entwurf", draftSource: source, draftAt: new Date() }).where(eq(emailCampaignRecipients.id, recipient.id));
  return { id: recipient.id, subject: draft.subject, text: draft.text, source };
}

/** Die nächsten Entwürfe schreiben (für Empfänger ohne Entwurf, ältester zuerst) – oder für bestimmte Empfänger neu. */
export async function generateDrafts(db: Db, tenantId: number, input: { campaignId: number; recipientIds?: number[] | null; limit?: number | null }) {
  const limit = Math.max(1, Math.min(10, input.limit ?? 5));
  const ids = input.recipientIds?.length ? input.recipientIds.slice(0, 10) : (await db.select({ id: emailCampaignRecipients.id }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, input.campaignId), eq(emailCampaignRecipients.sentCount, 0), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]), or(isNull(emailCampaignRecipients.draftState), eq(emailCampaignRecipients.draftState, "")))).orderBy(asc(emailCampaignRecipients.id)).limit(limit)).map((row) => row.id);
  const drafts = []; let failed = 0;
  for (const id of ids) { try { drafts.push(await draftForRecipient(db, tenantId, id)); } catch { failed += 1; } }
  return { drafts, failed, ai: drafts.some((draft) => draft.source === "ki") };
}

/** Freigabe-Liste einer Kampagne: alle offenen Empfänger, deren erste E-Mail noch nicht raus ist. */
export async function reviewQueue(db: Db, tenantId: number, campaignId: number) {
  const rows = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaignId), eq(emailCampaignRecipients.sentCount, 0), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]))).orderBy(asc(emailCampaignRecipients.id));
  const leadIds = Array.from(new Set(rows.map((row) => row.leadId).filter((id): id is number => typeof id === "number")));
  const leadRows = leadIds.length ? await db.select({ id: leads.id, publicId: leads.publicId, city: leads.city, listName: leads.listName, company: leads.company, firstName: leads.firstName, lastName: leads.lastName }).from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, leadIds))) : [];
  const items = rows.map((row) => { const lead = leadRows.find((item) => item.id === row.leadId) ?? null; return { id: row.id, email: row.email, name: row.name, company: row.company ?? lead?.company ?? null, city: lead?.city ?? null, listName: lead?.listName ?? null, publicId: lead?.publicId ?? null, draftSubject: row.draftSubject, draftText: row.draftText, draftState: (row.draftState || null) as "entwurf" | "freigegeben" | null, draftSource: row.draftSource, draftAt: row.draftAt }; });
  return { items, counts: { offen: items.filter((item) => !item.draftState).length, entwurf: items.filter((item) => item.draftState === "entwurf").length, freigegeben: items.filter((item) => item.draftState === "freigegeben").length } };
}

/** Entwurf speichern, freigeben oder Freigabe zurücknehmen. */
export async function saveDraft(db: Db, tenantId: number, input: { recipientId: number; subject: string; text: string; approve: boolean }) {
  const recipient = (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.id, input.recipientId), eq(emailCampaignRecipients.tenantId, tenantId))).limit(1))[0];
  if (!recipient) throw new Error("Empfänger nicht gefunden.");
  if (recipient.sentCount > 0) throw new Error("Die erste E-Mail an diesen Kontakt ist schon raus.");
  const subject = input.subject.trim().slice(0, 300); const text = input.text.trim();
  if (input.approve && (!subject || text.length < 10)) throw new Error("Bitte Betreff und Text ausfüllen.");
  await db.update(emailCampaignRecipients).set({ draftSubject: subject || null, draftText: text || null, draftState: input.approve ? "freigegeben" : "entwurf", draftSource: recipient.draftSource ?? "hand", draftAt: new Date() }).where(eq(emailCampaignRecipients.id, recipient.id));
  return { id: recipient.id, draftState: input.approve ? "freigegeben" as const : "entwurf" as const };
}
