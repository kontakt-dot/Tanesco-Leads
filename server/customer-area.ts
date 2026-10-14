/**
 * Kundenbereich („MEIN BEREICH“): was ein Käufer- oder Lieferanten-Zugang sieht – auch bei „Als Benutzer einloggen“.
 * Alle Abfragen sind auf den angemeldeten (bzw. übernommenen) Benutzer eingeschränkt.
 */
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { claims, deliveryEndpoints, deliveryStops, leadCategories, leadDeliveries, leads, memberOperationalSettings, memberships, orderOperationalConfigs, orders, supportTickets, suppliers, tenants, users } from "../drizzle/schema";
import type { Db } from "./lead-pipeline";
import { BUYER_AREAS } from "./member-admin";

/** Seiten des Kundenbereichs in Sidebar-Reihenfolge; Dashboard, Leads und Einstellungen sind immer sichtbar. */
export const CUSTOMER_PAGES = ["Dashboard", "Leads", "Bestellungen", "Reklamationen", "Lead-Import", "Integrationen", "Support", "Einstellungen"] as const;
export type CustomerPage = (typeof CUSTOMER_PAGES)[number];
const ALWAYS: CustomerPage[] = ["Dashboard", "Leads", "Einstellungen"];

export function visibleCustomerPages(visibleAreas: unknown, partnerType: "käufer" | "lieferant" | "intern"): CustomerPage[] {
  const areas = Array.isArray(visibleAreas) ? new Set((visibleAreas as unknown[]).map(String)) : new Set<string>(BUYER_AREAS);
  return CUSTOMER_PAGES.filter((page) => ALWAYS.includes(page) || (areas.has(page) && (page !== "Lead-Import" || partnerType === "lieferant")));
}

async function contextFor(db: Db, tenantId: number, userId: number) {
  const row = (await db.select({ membership: memberships, user: users }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId))).limit(1))[0];
  if (!row) throw new Error("Für diesen Benutzer ist kein Zugang hinterlegt.");
  const settings = (await db.select().from(memberOperationalSettings).where(eq(memberOperationalSettings.membershipId, row.membership.id)).limit(1))[0];
  const supplierRows = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.tenantId, tenantId), or(eq(suppliers.userId, userId), row.user.email ? eq(suppliers.email, row.user.email) : sql`1 = 0`)));
  return { membership: row.membership, user: row.user, settings, supplierIds: supplierRows.map((supplier) => supplier.id) };
}

/** Zugangsdaten für das Layout: Firma, Rolle, sichtbare Seiten, Zahlen anzeigen (Standard: verborgen). */
export async function customerAccess(db: Db, tenantId: number, userId: number) {
  const { membership, user, settings, supplierIds } = await contextFor(db, tenantId, userId);
  const tenant = (await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
  return { membershipId: membership.id, role: membership.role, partnerType: membership.partnerType, status: membership.status, company: user.company ?? user.name ?? "Kunde", name: user.name ?? "", email: user.email ?? "", tenantName: tenant?.name ?? "Tanesco Leads", pages: visibleCustomerPages(settings?.visibleAreas, membership.partnerType), uiRestricted: settings?.uiRestricted ?? false, reclamationPeriodHours: settings?.reclamationPeriodHours ?? 24, isSupplier: supplierIds.length > 0 };
}

/** Lead-IDs, die dieser Zugang sehen darf: als Käufer beliefert (Bestellung oder Stop) und/oder als Lieferant geliefert. */
async function ownLeadIds(db: Db, tenantId: number, userId: number, supplierIds: number[]) {
  const viaOrder = await db.select({ leadId: leadDeliveries.leadId, at: leadDeliveries.occurredAt, price: leadDeliveries.unitPrice, result: leadDeliveries.result }).from(leadDeliveries).innerJoin(orderOperationalConfigs, eq(orderOperationalConfigs.orderId, leadDeliveries.orderId)).where(and(eq(leadDeliveries.tenantId, tenantId), eq(orderOperationalConfigs.buyerUserId, userId), inArray(leadDeliveries.result, ["angeboten", "angenommen", "reklamiert"])));
  const viaStop = await db.select({ leadId: leadDeliveries.leadId, at: leadDeliveries.occurredAt, price: leadDeliveries.unitPrice, result: leadDeliveries.result }).from(leadDeliveries).innerJoin(deliveryStops, eq(deliveryStops.id, leadDeliveries.stopId)).where(and(eq(leadDeliveries.tenantId, tenantId), eq(deliveryStops.buyerUserId, userId), inArray(leadDeliveries.result, ["angeboten", "angenommen", "reklamiert"])));
  const delivered = new Map<number, { at: Date; price: string; result: string }>();
  for (const row of [...viaOrder, ...viaStop]) { const existing = delivered.get(row.leadId); if (!existing || existing.at < row.at) delivered.set(row.leadId, { at: row.at, price: row.price, result: row.result }); }
  const supplied = supplierIds.length ? await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "verkauf"), inArray(leads.supplierId, supplierIds))) : [];
  return { delivered, suppliedIds: supplied.map((row) => row.id) };
}

/** Dashboard: „Hallo {Firma}“ – Leads diesen Monat, Leads gesamt, offene Reklamationen, aktive Bestellungen, letzte Leads. */
export async function customerDashboard(db: Db, tenantId: number, userId: number) {
  const { supplierIds } = await contextFor(db, tenantId, userId);
  const { delivered, suppliedIds } = await ownLeadIds(db, tenantId, userId, supplierIds);
  const leadIds = Array.from(new Set([...Array.from(delivered.keys()), ...suppliedIds]));
  const rows = leadIds.length ? await db.select({ id: leads.id, publicId: leads.publicId, firstName: leads.firstName, lastName: leads.lastName, city: leads.city, status: leads.status, categoryId: leads.categoryId, createdAt: leads.createdAt }).from(leads).where(inArray(leads.id, leadIds)) : [];
  const categories = await db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId));
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const at = (id: number, created: Date) => delivered.get(id)?.at ?? created;
  const openClaims = leadIds.length ? (await db.select({ id: claims.id }).from(claims).where(and(eq(claims.tenantId, tenantId), inArray(claims.leadId, leadIds), inArray(claims.status, ["offen", "in_prüfung"])))).length : 0;
  const activeOrders = (await db.select({ id: orders.id }).from(orders).innerJoin(orderOperationalConfigs, eq(orderOperationalConfigs.orderId, orders.id)).where(and(eq(orders.tenantId, tenantId), eq(orderOperationalConfigs.buyerUserId, userId), inArray(orders.status, ["offen", "aktiv"])))).length;
  const recent = rows.map((row) => ({ ...row, deliveredAt: at(row.id, row.createdAt), unitPrice: delivered.get(row.id)?.price ?? null, categoryName: categories.find((category) => category.id === row.categoryId)?.name ?? "–" })).sort((a, b) => b.deliveredAt.getTime() - a.deliveredAt.getTime());
  return { kpis: { leadsThisMonth: recent.filter((row) => row.deliveredAt >= monthStart).length, leadsTotal: recent.length, openClaims, activeOrders }, recent: recent.slice(0, 8).map((row) => ({ id: row.id, publicId: row.publicId, name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || row.publicId, city: row.city ?? "", status: row.status, categoryName: row.categoryName, deliveredAt: row.deliveredAt, unitPrice: row.unitPrice })) };
}

/** Eigene Leads (mit Reklamationsstatus), neueste zuerst. */
export async function customerLeads(db: Db, tenantId: number, userId: number, input: { query?: string; limit?: number }) {
  const { supplierIds } = await contextFor(db, tenantId, userId);
  const { delivered, suppliedIds } = await ownLeadIds(db, tenantId, userId, supplierIds);
  const leadIds = Array.from(new Set([...Array.from(delivered.keys()), ...suppliedIds]));
  if (!leadIds.length) return [];
  const rows = await db.select().from(leads).where(inArray(leads.id, leadIds));
  const categories = await db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId));
  const claimRows = await db.select({ id: claims.id, leadId: claims.leadId, status: claims.status, reason: claims.reason }).from(claims).where(and(eq(claims.tenantId, tenantId), inArray(claims.leadId, leadIds))).orderBy(desc(claims.createdAt));
  const query = (input.query ?? "").trim().toLowerCase();
  return rows.map((row) => { const claim = claimRows.find((item) => item.leadId === row.id); const delivery = delivered.get(row.id); return { id: row.id, publicId: row.publicId, name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || row.publicId, email: row.email ?? "", phone: row.phone ?? "", postcode: row.postcode ?? "", city: row.city ?? "", status: row.status, categoryName: categories.find((category) => category.id === row.categoryId)?.name ?? "–", deliveredAt: delivery?.at ?? row.createdAt, unitPrice: delivery?.price ?? null, claim: claim ? { id: claim.id, status: claim.status, reason: claim.reason } : null, role: delivery ? "käufer" as const : "lieferant" as const }; })
    .filter((row) => !query || `${row.name} ${row.publicId} ${row.city} ${row.email} ${row.phone}`.toLowerCase().includes(query))
    .sort((a, b) => b.deliveredAt.getTime() - a.deliveredAt.getTime()).slice(0, input.limit ?? 200);
}

/** Eigene Bestellungen (als Käufer). */
export async function customerOrders(db: Db, tenantId: number, userId: number) {
  const rows = await db.select({ order: orders, config: orderOperationalConfigs }).from(orders).innerJoin(orderOperationalConfigs, eq(orderOperationalConfigs.orderId, orders.id)).where(and(eq(orders.tenantId, tenantId), eq(orderOperationalConfigs.buyerUserId, userId))).orderBy(desc(orders.createdAt));
  const categories = await db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId));
  return rows.map(({ order }) => ({ id: order.id, orderNumber: order.orderNumber, name: order.name ?? "", categoryName: categories.find((category) => category.id === order.categoryId)?.name ?? "–", quantity: order.quantity, deliveredCount: order.deliveredCount, unitPrice: order.unitPrice, status: order.status, createdAt: order.createdAt }));
}

/** Eigene Reklamationen (zu eigenen Leads). */
export async function customerClaims(db: Db, tenantId: number, userId: number) {
  const { supplierIds } = await contextFor(db, tenantId, userId);
  const { delivered, suppliedIds } = await ownLeadIds(db, tenantId, userId, supplierIds);
  const leadIds = Array.from(new Set([...Array.from(delivered.keys()), ...suppliedIds]));
  if (!leadIds.length) return [];
  const rows = await db.select({ claim: claims, lead: { publicId: leads.publicId, firstName: leads.firstName, lastName: leads.lastName } }).from(claims).innerJoin(leads, eq(leads.id, claims.leadId)).where(and(eq(claims.tenantId, tenantId), inArray(claims.leadId, leadIds))).orderBy(desc(claims.createdAt)).limit(200);
  return rows.map(({ claim, lead }) => ({ id: claim.id, leadPublicId: lead.publicId, leadName: `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || lead.publicId, reason: claim.reason, details: claim.details ?? "", status: claim.status, refundAmount: claim.refundAmount, createdAt: claim.createdAt, dueAt: claim.dueAt, resolvedAt: claim.resolvedAt }));
}

/** Eigene Support-Anfragen (nach Anfragenden-Namen). */
export async function customerTickets(db: Db, tenantId: number, userId: number) {
  const { user } = await contextFor(db, tenantId, userId);
  const names = [user.name, user.company, user.email].filter((value): value is string => Boolean(value));
  if (!names.length) return [];
  return db.select().from(supportTickets).where(and(eq(supportTickets.tenantId, tenantId), inArray(supportTickets.requesterName, names))).orderBy(desc(supportTickets.createdAt)).limit(100);
}

/** Eigene Anbindung: ausgehende API-Calls je Kategorie (ohne Zugangsdaten) und Webhook-URL. */
export async function customerEndpoints(db: Db, tenantId: number, userId: number) {
  const { membership, settings } = await contextFor(db, tenantId, userId);
  const rows = await db.select({ id: deliveryEndpoints.id, categoryId: deliveryEndpoints.categoryId, enabled: deliveryEndpoints.enabled, method: deliveryEndpoints.method, url: deliveryEndpoints.url }).from(deliveryEndpoints).where(and(eq(deliveryEndpoints.tenantId, tenantId), eq(deliveryEndpoints.membershipId, membership.id)));
  const categories = await db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId));
  return { webhookUrl: settings?.webhookUrl ?? null, endpoints: rows.map((row) => ({ id: row.id, categoryName: categories.find((category) => category.id === row.categoryId)?.name ?? "–", enabled: row.enabled, method: row.method, url: row.url })) };
}
