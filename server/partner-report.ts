/**
 * Statistik „Integrationen“: Zeilen aus der Datenbank laden und an die gemeinsame Rechnung (shared/partner-report.ts) geben.
 *  - Zustellungen: Übergaben an die Schnittstellen eines Käufers (je Lead und Karte zählt die letzte) – mit oder ohne Partnerkonto.
 *  - Transaktionen: was der Partner zum Lead führt – aus dem Abgleich (Aroundhome) oder aus seinen Aufrufen (WattFox).
 * Der Abgleich legt eine Transaktion über Konto + Partner-Nummer an oder aktualisiert sie – er kann beliebig oft laufen.
 */
import { and, eq, inArray, ne, or, isNull } from "drizzle-orm";
import { deliveryEndpoints, integrationEvents, leadCategories, leads, memberships, partnerAccounts, partnerTransactions, users } from "../drizzle/schema";
import { leadDisplayName } from "../shared/lead-fields";
import { HEALTH_CHECK } from "../shared/api-errors";
import { assembleReport, berlinBound, berlinDay, buildPartnerReport, endpointAccount, isDay, listPartnerContacts, quickRange, type ContactStatus, type RawAccount, type RawEndpoint, type ReportBasis, type ReportFilter, type ReportLead, type ReportTransaction, type QuotaPeriod } from "../shared/partner-report";
import type { Db } from "./lead-pipeline";

export type ReportQuery = { from?: string | null; to?: string | null; basis?: ReportBasis | null; categoryId?: number | null };
/** Zeitraum und Zeitbasis aus der Anfrage – ohne Angabe die letzten 30 Tage nach Zustelldatum; vertauschte Tage werden gedreht. */
export function reportFilter(query: ReportQuery, now = new Date()): { filter: ReportFilter; from: string; to: string; today: string } {
  const today = berlinDay(now); const fallback = quickRange("last30", today);
  let from = isDay(query.from) ? query.from : fallback.from; let to = isDay(query.to) ? query.to : fallback.to; if (from > to) [from, to] = [to, from];
  return { filter: { from: berlinBound(from), until: berlinBound(to, true), basis: query.basis ?? "delivery", categoryId: query.categoryId ?? null }, from, to, today };
}

export { endpointAccount } from "../shared/partner-report";

/**
 * Rohdaten laden: Konten, die Schnittstellen der Käufer (mit Käufer) und ihre Übergaben. Was daraus Karten und Zustellungen werden,
 * entscheidet `assembleReport` (shared) – seit v383 bekommt auch jeder Käufer mit Schnittstelle eine Karte, zu dem es kein Konto gibt.
 */
async function loadReportRows(db: Db, tenantId: number) {
  const [accountRows, endpointRows, txRows] = await Promise.all([
    db.select().from(partnerAccounts).where(and(eq(partnerAccounts.tenantId, tenantId), ne(partnerAccounts.provider, "hlrlookup"))).orderBy(partnerAccounts.id),
    db.select({ id: deliveryEndpoints.id, url: deliveryEndpoints.url, bodyTemplate: deliveryEndpoints.bodyTemplate, enabled: deliveryEndpoints.enabled, membershipId: deliveryEndpoints.membershipId, buyerUserId: memberships.userId, name: users.name, company: users.company })
      .from(deliveryEndpoints).leftJoin(memberships, eq(memberships.id, deliveryEndpoints.membershipId)).leftJoin(users, eq(users.id, memberships.userId)).where(eq(deliveryEndpoints.tenantId, tenantId)),
    db.select().from(partnerTransactions).where(eq(partnerTransactions.tenantId, tenantId)),
  ]);
  const buyerIds = Array.from(new Set(accountRows.map((row) => row.buyerUserId).filter((id): id is number => typeof id === "number")));
  const buyerRows = buyerIds.length ? await db.select({ id: users.id, name: users.name, company: users.company, membershipId: memberships.id }).from(users).leftJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.tenantId, tenantId))).where(inArray(users.id, buyerIds)) : [];
  const rawAccounts: RawAccount[] = accountRows.map((row) => ({ id: row.id, provider: row.provider, label: row.label, buyerUserId: row.buyerUserId, hasAccess: row.provider === "wattfox" ? Boolean(row.trackingToken) : Boolean(row.credentialsEncrypted), lastSyncAt: row.lastSyncAt, lastSyncNote: row.lastSyncSummary, quotaAmount: row.quotaAmount, quotaPeriod: row.quotaPeriod }));
  const endpoints: RawEndpoint[] = endpointRows.map((row) => ({ id: row.id, url: row.url, bodyTemplate: row.bodyTemplate, enabled: row.enabled, buyerUserId: row.buyerUserId ?? null, membershipId: row.buyerUserId ? row.membershipId : null, buyerName: row.company ?? row.name ?? null }));
  // nur Übergaben an Schnittstellen, die zu einer Karte führen: zu einem Konto oder zu einem Käufer
  const endpointIds = endpoints.filter((endpoint) => endpoint.buyerUserId || endpointAccount(endpoint, rawAccounts)).map((endpoint) => endpoint.id);
  const events = endpointIds.length ? await db.select({ id: integrationEvents.id, endpointId: integrationEvents.endpointId, leadId: integrationEvents.leadId, categoryId: integrationEvents.categoryId, eventType: integrationEvents.eventType, occurredAt: integrationEvents.occurredAt })
    .from(integrationEvents).where(and(eq(integrationEvents.tenantId, tenantId), inArray(integrationEvents.endpointId, endpointIds), or(isNull(integrationEvents.externalReference), ne(integrationEvents.externalReference, HEALTH_CHECK)))) : [];
  const { accounts, deliveries } = assembleReport({ accounts: rawAccounts, endpoints, events, buyers: buyerRows.map((row) => ({ userId: row.id, membershipId: row.membershipId ?? null, name: row.company ?? row.name ?? null })) });
  const transactions: ReportTransaction[] = txRows.map((row) => ({ id: row.id, accountId: row.accountId, leadId: row.leadId, status: row.status, transactionAt: row.transactionAt ?? row.createdAt, processedAt: row.processedAt, paidAt: row.paidAt, commission: Number(row.commission) || 0, campaignId: row.campaignId, campaignName: row.campaignName, partnerCategory: row.partnerCategory, subId: row.subId, cancelReason: row.cancelReason }));
  return { accounts, deliveries, transactions };
}

export async function partnerReport(db: Db, tenantId: number, query: ReportQuery) {
  const range = reportFilter(query); const rows = await loadReportRows(db, tenantId);
  return { from: range.from, to: range.to, today: range.today, basis: range.filter.basis, categoryId: range.filter.categoryId ?? null, cards: buildPartnerReport({ ...rows, filter: range.filter, today: range.today }) };
}

/**
 * Kontingent eines Partnerkontos setzen oder entfernen (seit v378): „900 Leads je Woche“. `amount` leer oder 0 = kein Kontingent.
 * Die Auslieferung ändert sich dadurch nicht – das Kontingent ist die Messlatte der Statistik („noch nachschieben“).
 */
export async function setPartnerQuota(db: Db, tenantId: number, input: { accountId: number; amount: number | null; period: QuotaPeriod }) {
  const amount = input.amount && input.amount > 0 ? Math.floor(input.amount) : null;
  if (input.accountId < 0) {
    // Karte eines Käufers ohne Konto (seit v383): Das Kontingent braucht einen Platz – ein Konto „api“ für diesen Käufer, ohne Rückmeldung.
    const buyerUserId = -input.accountId;
    const member = (await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, buyerUserId))).limit(1))[0];
    if (!member) throw new Error("Der Käufer wurde nicht gefunden.");
    const known = (await db.select({ id: partnerAccounts.id }).from(partnerAccounts).where(and(eq(partnerAccounts.tenantId, tenantId), eq(partnerAccounts.buyerUserId, buyerUserId), ne(partnerAccounts.provider, "hlrlookup"))).orderBy(partnerAccounts.id).limit(1))[0];
    if (known) { await db.update(partnerAccounts).set({ quotaAmount: amount, quotaPeriod: input.period }).where(eq(partnerAccounts.id, known.id)); return { success: true, amount, period: input.period }; }
    if (!amount) return { success: true, amount, period: input.period };
    await db.insert(partnerAccounts).values({ tenantId, provider: "api", buyerUserId, label: null, enabled: true, quotaAmount: amount, quotaPeriod: input.period });
    return { success: true, amount, period: input.period };
  }
  const account = (await db.select({ id: partnerAccounts.id, provider: partnerAccounts.provider }).from(partnerAccounts).where(and(eq(partnerAccounts.id, input.accountId), eq(partnerAccounts.tenantId, tenantId))).limit(1))[0];
  if (!account || account.provider === "hlrlookup") throw new Error("Das Partnerkonto wurde nicht gefunden.");
  // Ein Konto „api“ hält nur das Kontingent: ohne Kontingent hat es keinen Zweck mehr – der Käufer behält seine Karte auch ohne Konto
  if (!amount && account.provider === "api") { await db.delete(partnerAccounts).where(eq(partnerAccounts.id, account.id)); return { success: true, amount, period: input.period }; }
  await db.update(partnerAccounts).set({ quotaAmount: amount, quotaPeriod: input.period }).where(eq(partnerAccounts.id, account.id));
  return { success: true, amount, period: input.period };
}

export async function partnerContacts(db: Db, tenantId: number, query: ReportQuery & { accountId: number; status?: "all" | ContactStatus; search?: string; offset?: number; limit?: number }) {
  const range = reportFilter(query); const rows = await loadReportRows(db, tenantId);
  const leadIds = Array.from(new Set(rows.deliveries.filter((row) => row.accountId === query.accountId).map((row) => row.leadId)));
  const leadRows: ReportLead[] = [];
  for (let index = 0; index < leadIds.length; index += 800) {
    const part = await db.select({ id: leads.id, publicId: leads.publicId, firstName: leads.firstName, lastName: leads.lastName, company: leads.company, city: leads.city, categoryId: leads.categoryId }).from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, leadIds.slice(index, index + 800))));
    leadRows.push(...part.map((lead) => ({ id: lead.id, publicId: lead.publicId, name: leadDisplayName(lead) || lead.company || "", city: lead.city, categoryId: lead.categoryId })));
  }
  const categories = await db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId)); const categoryName = new Map(categories.map((row) => [row.id, row.name]));
  const list = listPartnerContacts({ accountId: query.accountId, ...rows, leads: leadRows, filter: range.filter, status: query.status, search: query.search, offset: query.offset, limit: query.limit });
  return { total: list.total, rows: list.rows.map((row) => ({ ...row, categoryName: row.categoryId ? categoryName.get(row.categoryId) ?? null : null })) };
}

/* ------------------------------------------------------------------ Transaktionen speichern */

export type IncomingTransaction = {
  externalId: string; reference?: string | null; leadId: number | null; status: "open" | "confirmed" | "cancelled";
  transactionAt?: Date | null; processedAt?: Date | null; paidAt?: Date | null; commission?: number | null;
  campaignId?: string | null; campaignName?: string | null; partnerCategory?: string | null; subId?: string | null; cancelReason?: string | null; raw?: unknown;
};
const clip = (value: string | null | undefined, max: number) => { const text = String(value ?? "").trim(); return text ? text.slice(0, max) : null; };
/**
 * Transaktion anlegen oder aktualisieren (Konto + Partner-Nummer). Ein Statuswechsel setzt den Bearbeitungszeitpunkt, falls der Partner keinen nennt;
 * vorhandene Angaben werden nicht mit „leer“ überschrieben. Meldet, ob die Transaktion neu ist und ob sie gerade storniert wurde.
 */
export async function upsertPartnerTransaction(db: Db, tenantId: number, accountId: number, tx: IncomingTransaction, now = new Date()): Promise<{ created: boolean; changed: boolean; newlyCancelled: boolean }> {
  const externalId = clip(tx.externalId, 160); if (!externalId) return { created: false, changed: false, newlyCancelled: false };
  const known = (await db.select().from(partnerTransactions).where(and(eq(partnerTransactions.accountId, accountId), eq(partnerTransactions.externalId, externalId))).limit(1))[0];
  const decided = tx.status !== "open";
  if (!known) {
    await db.insert(partnerTransactions).values({ tenantId, accountId, externalId, reference: clip(tx.reference, 160), leadId: tx.leadId, status: tx.status, transactionAt: tx.transactionAt ?? now, processedAt: decided ? tx.processedAt ?? tx.paidAt ?? now : null, paidAt: tx.status === "confirmed" ? tx.paidAt ?? null : null, commission: String(Math.max(0, Number(tx.commission) || 0).toFixed(2)), campaignId: clip(tx.campaignId, 120), campaignName: clip(tx.campaignName, 240), partnerCategory: clip(tx.partnerCategory, 160), subId: clip(tx.subId, 120), cancelReason: tx.status === "cancelled" ? clip(tx.cancelReason, 255) : null, raw: (tx.raw ?? null) as never });
    return { created: true, changed: true, newlyCancelled: tx.status === "cancelled" };
  }
  const patch: Partial<typeof partnerTransactions.$inferInsert> = {};
  if (tx.leadId && known.leadId !== tx.leadId) patch.leadId = tx.leadId;
  if (known.status !== tx.status) { patch.status = tx.status; patch.processedAt = decided ? tx.processedAt ?? tx.paidAt ?? now : null; }
  else if (decided && tx.processedAt && (!known.processedAt || known.processedAt.getTime() !== tx.processedAt.getTime())) patch.processedAt = tx.processedAt;
  if (tx.status === "confirmed" && tx.paidAt && (!known.paidAt || known.paidAt.getTime() !== tx.paidAt.getTime())) patch.paidAt = tx.paidAt;
  if (tx.status !== "confirmed" && known.paidAt) patch.paidAt = null;
  if (tx.transactionAt && (!known.transactionAt || known.transactionAt.getTime() !== tx.transactionAt.getTime())) patch.transactionAt = tx.transactionAt;
  if (tx.commission !== undefined && tx.commission !== null && Number(known.commission) !== Number(tx.commission)) patch.commission = String(Math.max(0, Number(tx.commission) || 0).toFixed(2));
  for (const [key, max] of [["reference", 160], ["campaignId", 120], ["campaignName", 240], ["partnerCategory", 160], ["subId", 120]] as const) { const value = clip(tx[key], max); if (value && known[key] !== value) patch[key] = value; }
  if (tx.status === "cancelled") { const reason = clip(tx.cancelReason, 255); if (reason && known.cancelReason !== reason) patch.cancelReason = reason; }
  if (!Object.keys(patch).length) return { created: false, changed: false, newlyCancelled: false };
  if (tx.raw !== undefined) patch.raw = tx.raw as never;
  await db.update(partnerTransactions).set(patch).where(eq(partnerTransactions.id, known.id));
  return { created: false, changed: true, newlyCancelled: tx.status === "cancelled" && known.status !== "cancelled" };
}
