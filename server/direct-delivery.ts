/**
 * Direkt an einen Käufer senden (v384): Leads → anhaken → „Ausliefern“ → Käufer wählen.
 * Der Lead geht ohne Bestellung und ohne Lieferkette über die Schnittstelle des Käufers (Benutzer → Käufer → Reiter „Integration“).
 * Gedacht für einzelne Leads, zum Beispiel den ersten echten Lead an einen neuen Käufer – ohne dass eine Bestellung eingeschaltet sein muss.
 * Schutz bleibt: kein Lead doppelt (außer ausdrücklich „erneut“), Kampagne mit eigenem Käufer, Pflichtangaben der Schnittstelle.
 */
import { and, desc, eq } from "drizzle-orm";
import { leadCategories, leadDeliveries, leadStatusEvents, leads, memberships, orderOperationalConfigs, orders, users } from "../drizzle/schema";
import { campaignDeliverySkip } from "../shared/dialer-campaign";
import { isPartnerDuplicate } from "../shared/partner-duplicate";
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
    const duplicate = handOver.results.some((result) => !result.ok && isPartnerDuplicate(result.status, `${result.body} ${result.error ?? ""}`));
    await db.insert(leadDeliveries).values({ tenantId, leadId: lead.id, orderId: null, buyerName, unitPrice, result: "abgelehnt", skipReason: (duplicate ? `Dublette bei ${buyerName}` : `Direkt gesendet: HTTP ${handOver.status ?? "–"}`).slice(0, 160), occurredAt: now });
    if (duplicate) { await markPartnerDuplicate(db, { tenantId, lead, buyerName, status: handOver.status ?? null, message: detail, actorUserId: input.actorUserId }); return { ...fail(`Dublette – ${buyerName} kennt den Kontakt schon${detail ? ` (${detail})` : ""}. Der Lead steht jetzt unter „Dubletten“.`), unitPrice }; }
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

/** Lead als „Dublette bei <Käufer>“ markieren – Status bleibt (der Lead darf an andere Käufer), im Lead-Log steht die Antwort. */
export async function markPartnerDuplicate(db: Db, input: { tenantId: number; lead: LeadRow; buyerName: string; status: number | null; message: string; actorUserId: number | null }) {
  const fresh = (await db.select({ metadata: leads.metadata, status: leads.status }).from(leads).where(eq(leads.id, input.lead.id)).limit(1))[0];
  const meta = fresh?.metadata && typeof fresh.metadata === "object" && !Array.isArray(fresh.metadata) ? fresh.metadata as Record<string, unknown> : {};
  await db.update(leads).set({ metadata: { ...meta, partnerDuplicate: { buyerName: input.buyerName, at: new Date().toISOString(), status: input.status, message: input.message.slice(0, 300) } } }).where(eq(leads.id, input.lead.id));
  const status = fresh?.status ?? input.lead.status;
  await db.insert(leadStatusEvents).values({ tenantId: input.tenantId, leadId: input.lead.id, previousStatus: status, nextStatus: status, actorUserId: input.actorUserId, note: `Dublette bei ${input.buyerName}: kennt den Kontakt schon (HTTP ${input.status ?? "–"}${input.message ? ` – ${input.message.slice(0, 200)}` : ""}). Der Lead bleibt frei für andere Käufer.`.slice(0, 900) });
}

/** v385, nach dem Start: Ablehnungen der letzten 30 Tage, die eine Dublette melden, markieren den Lead nachträglich (einmal je Lead). */
export async function markPastPartnerDuplicates(db: Db): Promise<number> {
  const { integrationEvents, deliveryEndpoints } = await import("../drizzle/schema");
  const { gte, inArray } = await import("drizzle-orm");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const events = await db.select({ leadId: integrationEvents.leadId, tenantId: integrationEvents.tenantId, endpointId: integrationEvents.endpointId, status: integrationEvents.responseStatus, body: integrationEvents.responseBody }).from(integrationEvents).where(and(eq(integrationEvents.eventType, "abgelehnt"), gte(integrationEvents.occurredAt, since))).orderBy(desc(integrationEvents.id));
  const hits = events.filter((event) => event.leadId && isPartnerDuplicate(event.status, event.body));
  if (!hits.length) return 0;
  const endpointIds = Array.from(new Set(hits.map((event) => event.endpointId).filter((id): id is number => typeof id === "number")));
  const endpoints = endpointIds.length ? await db.select({ id: deliveryEndpoints.id, membershipId: deliveryEndpoints.membershipId }).from(deliveryEndpoints).where(inArray(deliveryEndpoints.id, endpointIds)) : [];
  const membershipIds = Array.from(new Set(endpoints.map((row) => row.membershipId).filter((id): id is number => typeof id === "number")));
  const names = membershipIds.length ? await db.select({ id: memberships.id, name: users.name, company: users.company }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(inArray(memberships.id, membershipIds)) : [];
  const buyerOf = (endpointId: number | null) => { const membershipId = endpoints.find((row) => row.id === endpointId)?.membershipId; const row = names.find((item) => item.id === membershipId); return row?.company ?? row?.name ?? "Käufer"; };
  let marked = 0; const done = new Set<number>();
  for (const event of hits) {
    if (done.has(event.leadId!)) continue; done.add(event.leadId!);
    const lead = (await db.select().from(leads).where(eq(leads.id, event.leadId!)).limit(1))[0]; if (!lead) continue;
    const meta = lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata) ? lead.metadata as Record<string, unknown> : {};
    if (meta.partnerDuplicate) continue;
    await markPartnerDuplicate(db, { tenantId: lead.tenantId, lead, buyerName: buyerOf(event.endpointId), status: event.status ?? null, message: (event.body ?? "").slice(0, 300), actorUserId: null });
    marked += 1;
  }
  return marked;
}
