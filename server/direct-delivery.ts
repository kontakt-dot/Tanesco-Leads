/**
 * Direkt an einen Käufer senden (v384): Leads → anhaken → „Ausliefern“ → Käufer wählen.
 * Der Lead geht ohne Bestellung und ohne Lieferkette über die Schnittstelle des Käufers (Benutzer → Käufer → Reiter „Integration“).
 * Gedacht für einzelne Leads, zum Beispiel den ersten echten Lead an einen neuen Käufer – ohne dass eine Bestellung eingeschaltet sein muss.
 * Schutz bleibt: kein Lead doppelt (außer ausdrücklich „erneut“), Kampagne mit eigenem Käufer, Pflichtangaben der Schnittstelle.
 */
import { and, desc, eq } from "drizzle-orm";
import { leadCategories, leadDeliveries, leadStatusEvents, leads, memberships, orderOperationalConfigs, orders, users } from "../drizzle/schema";
import { campaignDeliverySkip } from "../shared/dialer-campaign";
import { logActivity } from "./activity";
import { leadCampaignRules, type Db, type LeadRow } from "./lead-pipeline";
import { handOverToBuyerEndpoints } from "./outbound-endpoints";

export type DirectDeliveryResult = { publicId: string; ok: boolean; buyerName: string; message: string; partnerReference: string | null; unitPrice: string };

const numberList = (value: unknown): number[] => (Array.isArray(value) ? value.map(Number).filter((item) => Number.isInteger(item) && item > 0) : []);

/** Preis je Lead: aus der neuesten Bestellung dieses Käufers mit der Kategorie des Leads – sonst 0,00 €. */
export async function directDeliveryPrice(db: Db, tenantId: number, buyerUserId: number, categoryId: number): Promise<{ unitPrice: string; orderNumber: string | null }> {
  const rows = await db.select({ orderNumber: orders.orderNumber, unitPrice: orders.unitPrice, categoryId: orders.categoryId, categoryIds: orderOperationalConfigs.categoryIds }).from(orders).innerJoin(orderOperationalConfigs, eq(orderOperationalConfigs.orderId, orders.id)).where(and(eq(orders.tenantId, tenantId), eq(orderOperationalConfigs.buyerUserId, buyerUserId))).orderBy(desc(orders.id));
  const match = rows.find((row) => row.categoryId === categoryId || numberList(row.categoryIds).includes(categoryId));
  return match ? { unitPrice: String(match.unitPrice ?? "0.00"), orderNumber: match.orderNumber } : { unitPrice: "0.00", orderNumber: null };
}

export async function deliverLeadToBuyer(db: Db, input: { tenantId: number; actorUserId: number | null; lead: LeadRow; buyerUserId: number; allowRepeat?: boolean }): Promise<DirectDeliveryResult> {
  const { tenantId, lead } = input; const now = new Date();
  const buyer = (await db.select({ userId: memberships.userId, partnerType: memberships.partnerType, status: memberships.status, name: users.name, company: users.company }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, input.buyerUserId))).limit(1))[0];
  if (!buyer || buyer.partnerType !== "käufer") throw new Error("Der Käufer wurde nicht gefunden.");
  const buyerName = buyer.company ?? buyer.name ?? "Käufer";
  const fail = (message: string): DirectDeliveryResult => ({ publicId: lead.publicId, ok: false, buyerName, message, partnerReference: null, unitPrice: "0.00" });
  if (buyer.status !== "aktiv") return fail(`${buyerName} ist nicht aktiv.`);
  if (!["neu", "genehmigt", "hängend"].includes(lead.status) && !input.allowRepeat) return fail(`Der Lead hat den Status „${lead.status === "zugewiesen" ? "Zugewiesen" : lead.status}“ und wird nicht gesendet.`);
  const previous = (await db.select().from(leadDeliveries).where(and(eq(leadDeliveries.tenantId, tenantId), eq(leadDeliveries.leadId, lead.id)))).find((row) => row.result === "angeboten" || row.result === "angenommen");
  if (previous && !input.allowRepeat) return fail(`Lead wurde bereits an ${previous.buyerName} ausgeliefert (${previous.occurredAt.toLocaleString("de-DE")}).`);
  const campaignSkip = campaignDeliverySkip(await leadCampaignRules(db, tenantId, lead.id), buyer.userId);
  if (campaignSkip) return fail(campaignSkip);

  const { unitPrice, orderNumber } = await directDeliveryPrice(db, tenantId, buyer.userId, lead.categoryId);
  const handOver = await handOverToBuyerEndpoints(db, { tenantId, buyerUserId: buyer.userId, lead, extraValues: { order_number: orderNumber ?? "", unit_price: unitPrice } });
  if (!handOver.attempted) {
    const category = (await db.select({ name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.id, lead.categoryId)).limit(1))[0];
    return fail(`Bei ${buyerName} ist für „${category?.name ?? "diese Kategorie"}“ keine Schnittstelle eingeschaltet (Benutzer → ${buyerName} → Reiter „Integration“).`);
  }
  const detail = handOver.results.map((result) => { try { const parsed = JSON.parse(result.body) as { error?: unknown; message?: unknown }; return String(parsed.error ?? parsed.message ?? ""); } catch { return result.error ?? ""; } }).filter(Boolean).join("; ").slice(0, 300);
  if (!handOver.ok) {
    await db.insert(leadDeliveries).values({ tenantId, leadId: lead.id, orderId: null, buyerName, unitPrice, result: "abgelehnt", skipReason: `Direkt gesendet: HTTP ${handOver.status ?? "–"}`.slice(0, 160), occurredAt: now });
    const message = `${buyerName} hat abgelehnt (HTTP ${handOver.status ?? "–"}${detail ? `: ${detail}` : ""})`;
    await db.insert(leadStatusEvents).values({ tenantId, leadId: lead.id, previousStatus: lead.status, nextStatus: lead.status, actorUserId: input.actorUserId, note: `Direkt an ${buyerName} gesendet (ohne Bestellung): abgelehnt – ${handOver.summary}${detail ? ` – ${detail}` : ""}`.slice(0, 900) });
    return { ...fail(message), unitPrice };
  }
  await db.transaction(async (tx) => {
    await tx.insert(leadDeliveries).values({ tenantId, leadId: lead.id, orderId: null, buyerName, unitPrice, result: "angenommen", acceptedAt: now, occurredAt: now });
    await tx.update(leads).set({ status: "zugewiesen", assignedAt: now }).where(eq(leads.id, lead.id));
    await tx.insert(leadStatusEvents).values({ tenantId, leadId: lead.id, previousStatus: lead.status, nextStatus: "zugewiesen", actorUserId: input.actorUserId, note: `Direkt an ${buyerName} gesendet (ohne Bestellung, ${Number(unitPrice).toFixed(2).replace(".", ",")} €${orderNumber ? ` wie Bestellung ${orderNumber}` : ""}): geliefert – ${handOver.summary}${handOver.partnerReference ? ` · Nummer beim Käufer: ${handOver.partnerReference}` : ""}`.slice(0, 900) });
  });
  await logActivity(db, tenantId, { kind: "lead_verkauft", title: `Lead ${lead.publicId} direkt an ${buyerName} gesendet`, detail: `${Number(unitPrice).toFixed(2).replace(".", ",")} € · ohne Bestellung`, leadId: lead.id, actorUserId: input.actorUserId ?? null }).catch(() => undefined);
  return { publicId: lead.publicId, ok: true, buyerName, message: `an ${buyerName} gesendet${handOver.partnerReference ? ` (Nummer ${handOver.partnerReference})` : ""}`, partnerReference: handOver.partnerReference, unitPrice };
}
