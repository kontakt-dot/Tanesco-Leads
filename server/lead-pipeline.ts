/**
 * Lead-Pipeline: verbindet Automatisierung, Bestellkonfiguration, Lieferketten und Partner-Schnittstellen.
 *
 *  - runAutomationsForLead: Regel-Engine (aus runLeadAutomation herausgelöst), wird bei Lead-Anlage,
 *    Statuswechsel und über die REST-API automatisch aufgerufen.
 *  - deliverLeadNow: Auslieferung, die Bestellzuordnung, Bestellkonfiguration (aktiv, Zeitraum, Liefertage,
 *    Pausen, Menge, Lieferantensperre, PLZ-/Preisfilter) beachtet und den Lead anschließend an die
 *    API-Integration des Käufers übergibt (Bestellung → Käufer-Nutzer → Mitgliedschaft → Integration).
 *  - exportLeadToIntegration: HTTPS-Export mit entschlüsselten Zugangsdaten und Provider-Mapping, protokolliert.
 */
import { and, desc, eq, gte, inArray, ne, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { automationExecutionLogs, automationRules, claimEvents, claims, deliveryChains, deliveryStopReasons, deliveryStops, emailEvents, integrationEvents, leadCategories, leadDeliveries, leadStatusEvents, leadTagAssignments, leads, memberOperationalSettings, memberships, orderOperationalConfigs, orders, partnerIntegrations, reclamationReasons, tags, tenantSettings, users } from "../drizzle/schema";
import type { getDb } from "./db";
import { decryptIntegrationSecret } from "./integration-secrets";
import { dispatchLeadExport, type ExportableLead, type IntegrationExportConfig } from "./lead-integration-export";
import { evaluateOrderEligibility } from "./order-eligibility";
import { conditionsMatch, selectNextChain, selectStopPosition, type FieldCondition } from "./routing";
import { extractPartnerReference, handOverToBuyerEndpoints, notifySupplierReturn } from "./outbound-endpoints";
import { suppliers } from "../drizzle/schema";

export type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type LeadRow = typeof leads.$inferSelect;
export type TriggerType = (typeof automationRules.$inferSelect)["triggerType"];
type IntegrationRow = typeof partnerIntegrations.$inferSelect;
type OrderConfigRow = typeof orderOperationalConfigs.$inferSelect;

export function metadataOf(lead: { metadata: unknown }): Record<string, unknown> {
  return lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata) ? (lead.metadata as Record<string, unknown>) : {};
}

export { evaluateOrderEligibility, type OrderEligibilityConfig } from "./order-eligibility";

/* ------------------------------------------------------------------ Export an Integrationen */

function integrationConfig(integration: Pick<IntegrationRow, "config">): IntegrationExportConfig {
  return integration.config && typeof integration.config === "object" && !Array.isArray(integration.config) ? (integration.config as IntegrationExportConfig) : {};
}

export type ExportOutcome = { eventType: "geliefert" | "abgelehnt"; externalReference: string; responseStatus: number | undefined; responseBody: string | null };

export type DeliverySettings = { outgoingDuplicateProtection: boolean; duplicateFields: string[]; duplicateWindowHours: number; skipEmptyApiFields: boolean; incomingPrePing: boolean; distributionOrder: "fifo" | "lifo"; chainDistributionMode: "lieferketten_round_robin" | "bestellungen_round_robin" };

/** Mandanteneinstellungen für Übergabe und Verteilung (Einstellungen → System). */
export async function loadDeliverySettings(db: Db, tenantId: number): Promise<DeliverySettings> {
  const row = (await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)).limit(1))[0];
  const fields = Array.isArray(row?.duplicateFields) ? (row!.duplicateFields as unknown[]).map(String).filter((field) => field === "email" || field === "phone") : ["email", "phone"];
  return { outgoingDuplicateProtection: row?.outgoingDuplicateProtection ?? true, duplicateFields: fields.length ? fields : ["email", "phone"], duplicateWindowHours: row?.duplicateWindowHours ?? 0, skipEmptyApiFields: row?.skipEmptyApiFields ?? false, incomingPrePing: row?.incomingPrePing ?? false, distributionOrder: row?.distributionOrder ?? "fifo", chainDistributionMode: row?.chainDistributionMode ?? "lieferketten_round_robin" };
}

/** HTTPS-Export eines Leads an eine aktive Integration inkl. Zugangsdaten und Provider-Mapping; schreibt immer ein integrationEvent. */
export async function exportLeadToIntegration(db: Db, input: { tenantId: number; integration: IntegrationRow; lead: ExportableLead & { id?: number }; externalReference?: string; settings?: DeliverySettings }): Promise<ExportOutcome> {
  const { integration, lead } = input;
  const config = integrationConfig(integration);
  const authMethod = config.authMethod ?? "ohne";
  let result: ExportOutcome;
  try {
    if (integration.status !== "aktiv") throw new Error("Die Integration ist nicht aktiv.");
    if (!integration.callbackUrl) throw new Error("Für diese aktive Partnerintegration ist keine Exportadresse hinterlegt.");
    if (authMethod !== "ohne" && !integration.credentialsEncrypted) throw new Error("Für diese Integration fehlt ein Zugangsschlüssel.");
    const settings = input.settings ?? await loadDeliverySettings(db, input.tenantId);
    result = await dispatchLeadExport({ callbackUrl: integration.callbackUrl, lead, externalReference: input.externalReference, authMethod, credential: integration.credentialsEncrypted ? decryptIntegrationSecret(integration.credentialsEncrypted) : undefined, provider: integration.provider, publisherId: integration.publisherId, config, skipEmptyFields: settings.skipEmptyApiFields });
  } catch (error) {
    result = { eventType: "abgelehnt", externalReference: input.externalReference ?? lead.publicId, responseStatus: undefined, responseBody: error instanceof Error ? error.message.slice(0, 5000) : "Unbekannter Exportfehler" };
  }
  await db.insert(integrationEvents).values({ tenantId: input.tenantId, integrationId: integration.id, leadId: lead.id, categoryId: lead.categoryId, eventType: result.eventType, externalReference: result.externalReference, responseStatus: result.responseStatus, responseBody: result.responseBody });
  return result;
}

/** Bestellung → Käufer-Nutzer → Mitgliedschaft → aktive Integration des Käufers. */
export async function resolveBuyerIntegration(db: Db, tenantId: number, config: Pick<OrderConfigRow, "buyerUserId"> | undefined): Promise<IntegrationRow | undefined> {
  if (!config?.buyerUserId) return undefined;
  const membership = (await db.select({ integrationId: memberships.integrationId }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, config.buyerUserId), eq(memberships.status, "aktiv"))).limit(1))[0];
  if (!membership?.integrationId) return undefined;
  return (await db.select().from(partnerIntegrations).where(and(eq(partnerIntegrations.tenantId, tenantId), eq(partnerIntegrations.id, membership.integrationId), eq(partnerIntegrations.status, "aktiv"))).limit(1))[0];
}

/* ------------------------------------------------------------------ Auslieferung */

export type DeliveryAttempt = { chainId: number; chainName: string; stopId: number; buyerName: string; orderId: number | null; outcome: "angeboten" | "angenommen" | "abgelehnt" | "übersprungen"; responseStatus: number | undefined; reason?: string };
export type DeliveryResult = { chainId: number; stopId: number; buyerName: string; unitPrice: string; orderId: number | null; result: "angeboten" | "angenommen" | "abgelehnt"; export: { integrationId: number; integrationName: string; eventType: "geliefert" | "abgelehnt"; responseStatus: number | undefined } | null; attempts: DeliveryAttempt[]; claimId?: number };

type StopRow = typeof deliveryStops.$inferSelect;
type Candidate = { chain: typeof deliveryChains.$inferSelect; stops: StopRow[]; config: OrderConfigRow | undefined; order: typeof orders.$inferSelect | undefined; eligibility: { eligible: boolean; reason?: string } };
const numberList = (value: unknown) => Array.isArray(value) ? (value as unknown[]).map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
const stringList = (value: unknown) => Array.isArray(value) ? (value as unknown[]).map(String).map((item) => item.trim()).filter(Boolean) : [];
const GERMAN_STATES: Record<string, string[]> = { "Schleswig-Holstein": ["22", "23", "24", "25"], Hamburg: ["20", "21", "22"], Niedersachsen: ["19", "21", "26", "27", "28", "29", "30", "31", "34", "37", "38", "48", "49"], Bremen: ["27", "28"], "Nordrhein-Westfalen": ["32", "33", "34", "40", "41", "42", "44", "45", "46", "47", "48", "50", "51", "52", "53", "57", "58", "59"], Hessen: ["34", "35", "36", "37", "55", "60", "61", "63", "64", "65", "68"], "Rheinland-Pfalz": ["54", "55", "56", "57", "66", "67", "76"], "Baden-Württemberg": ["68", "69", "70", "71", "72", "73", "74", "75", "76", "77", "78", "79", "88", "89", "97"], Bayern: ["63", "80", "81", "82", "83", "84", "85", "86", "87", "88", "89", "90", "91", "92", "93", "94", "95", "96", "97"], Saarland: ["66"], Berlin: ["10", "12", "13", "14"], Brandenburg: ["01", "03", "04", "14", "15", "16", "17", "19", "39"], "Mecklenburg-Vorpommern": ["17", "18", "19", "23"], Sachsen: ["01", "02", "04", "07", "08", "09"], "Sachsen-Anhalt": ["06", "29", "38", "39"], Thüringen: ["04", "07", "36", "96", "98", "99"] };

/** Prüft, ob ein Stop den Lead nehmen darf; liefert den Skip-Grund (übersprungen = keine Lieferung, keine Belastung). */
export function stopSkipReason(stop: StopRow, lead: LeadRow, context: { now: Date; suppliersDelivered: Set<number>; conflictBuyerIds: Set<number>; stopDeliveries: number }): string | null {
  if (stop.maxLeads && context.stopDeliveries >= stop.maxLeads) return "Maximale Leads für diesen Käufer erreicht";
  if (stop.geoCountry && lead.country !== stop.geoCountry) return `Geo-Targeting: nur ${stop.geoCountry}`;
  const postcode = (lead.postcode ?? "").replace(/\s/g, "");
  if (stop.geoMode === "plz") { const prefixes = stringList(stop.geoValues); if (prefixes.length && !prefixes.some((prefix) => postcode.startsWith(prefix))) return "Geo-Targeting: PLZ passt nicht"; }
  if (stop.geoMode === "bundesland") { const states = stringList(stop.geoValues); const prefixes = states.flatMap((state) => GERMAN_STATES[state] ?? []); if (states.length && !prefixes.some((prefix) => postcode.startsWith(prefix))) return "Geo-Targeting: Bundesland passt nicht"; }
  const filters = Array.isArray(stop.fieldFilters) ? (stop.fieldFilters as Array<{ field: string; op: string; value?: string }>) : [];
  if (filters.length) { const metadata = metadataOf(lead); const data: Record<string, unknown> = { ...metadata, first_name: lead.firstName, last_name: lead.lastName, email: lead.email, phone: lead.phone, postal_code: lead.postcode, city: lead.city, country_code: lead.country }; for (const filter of filters) { const raw = data[filter.field]; const value = raw === undefined || raw === null ? "" : String(raw).toLowerCase(); const wanted = (filter.value ?? "").toLowerCase(); const ok = filter.op === "gleich" ? value === wanted : filter.op === "ungleich" ? value !== wanted : filter.op === "enthaelt" ? value.includes(wanted) : filter.op === "gesetzt" ? value.length > 0 : filter.op === "leer" ? value.length === 0 : filter.op === "groesser" ? Number(value) > Number(wanted) : filter.op === "kleiner" ? Number(value) < Number(wanted) : true; if (!ok) return `Feld-Filter: ${filter.field}`; } }
  if (lead.supplierId && numberList(stop.excludedSupplierIds).includes(lead.supplierId)) return "Lieferant für diesen Stop ausgeschlossen";
  const conflicts = numberList(stop.excludedBuyerUserIds); if (conflicts.length && conflicts.some((id) => context.conflictBuyerIds.has(id))) return "Konflikt-Käufer: Kontakt liegt bereits bei einem ausgeschlossenen Käufer";
  const metadata = metadataOf(lead);
  if (stop.excludeAutomationDuplicates && (metadata.duplicatedFromLeadId || metadata.automationDuplicate || metadata.duplicateOf)) return "Automation-Duplikat ausgeschlossen";
  const phoneStatus = String(metadata.phone_status ?? metadata.phoneStatus ?? metadata.hlr_status ?? "").toLowerCase();
  if (stop.phoneFilter === "exclude_invalid" && (phoneStatus === "invalid" || phoneStatus === "ungültig" || metadata.phone_valid === false)) return "Telefonfilter: Nummer ungültig";
  if (stop.phoneFilter === "only_valid" && !(phoneStatus === "valid" || phoneStatus === "gültig" || metadata.phone_valid === true)) return "Telefonfilter: Nummer nicht bestätigt gültig";
  if (stop.maxLeadAgeMinutes && context.now.getTime() - lead.createdAt.getTime() > stop.maxLeadAgeMinutes * 60_000) return "Lead zu alt für diesen Stop";
  void context.suppliersDelivered;
  return null;
}

/** Erschöpft-Regel der Kette für diesen Lead (Standard oder Abweichung je Lieferant). */
export function exhaustedActionFor(chain: typeof deliveryChains.$inferSelect, lead: LeadRow): "return" | "release" {
  const overrides = Array.isArray(chain.exhaustedOverrides) ? (chain.exhaustedOverrides as Array<{ supplierId: number; action: "return" | "release" }>) : [];
  const override = lead.supplierId ? overrides.find((item) => Number(item.supplierId) === lead.supplierId) : undefined;
  return override?.action ?? chain.exhaustedAction ?? "release";
}

const QUALIFIED_REJECTION = (status: number | undefined) => typeof status === "number" && status >= 400 && status < 500 && ![401, 403, 407, 429].includes(status);

/** Kontakte (E-Mail/Telefon), die bereits an Käufer geliefert wurden – für den ausgehenden Dublettenschutz. */
async function duplicateTargets(db: Db, tenantId: number, lead: LeadRow, settings: DeliverySettings, now: Date) {
  const orderIds = new Set<number>(); const buyerNames = new Set<string>();
  if (!settings.outgoingDuplicateProtection) return { orderIds, buyerNames };
  const clauses = [] as ReturnType<typeof eq>[];
  if (settings.duplicateFields.includes("email") && lead.email) clauses.push(eq(leads.email, lead.email));
  if (settings.duplicateFields.includes("phone") && lead.phone) clauses.push(eq(leads.phone, lead.phone));
  if (!clauses.length) return { orderIds, buyerNames };
  const twins = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "verkauf"), ne(leads.id, lead.id), or(...clauses)));
  const contactIds = [lead.id, ...twins.map((row) => row.id)]; // der Lead selbst zählt mit (erneute Auslieferung desselben Kontakts)
  const conditions = [eq(leadDeliveries.tenantId, tenantId), inArray(leadDeliveries.leadId, contactIds), inArray(leadDeliveries.result, ["angeboten", "angenommen", "reklamiert"])];
  if (settings.duplicateWindowHours > 0) conditions.push(gte(leadDeliveries.occurredAt, new Date(now.getTime() - settings.duplicateWindowHours * 3_600_000)));
  for (const row of await db.select({ orderId: leadDeliveries.orderId, buyerName: leadDeliveries.buyerName }).from(leadDeliveries).where(and(...conditions))) { if (row.orderId) orderIds.add(row.orderId); buyerNames.add(row.buyerName.toLowerCase()); }
  return { orderIds, buyerNames };
}

/** Operative Einstellungen des Käufer-Mitglieds (Benutzer → Käufer-Einstellungen) je Bestellkonfiguration. */
async function buyerMemberBlocks(db: Db, tenantId: number, configs: OrderConfigRow[], categoryId: number) {
  const blocks = new Map<number, string>();
  const buyerIds = Array.from(new Set(configs.map((config) => config.buyerUserId).filter((id): id is number => typeof id === "number")));
  if (!buyerIds.length) return blocks;
  const rows = await db.select({ userId: memberships.userId, status: memberships.status, deliveryPaused: memberOperationalSettings.deliveryPaused, paymentMode: memberOperationalSettings.paymentMode, disabledCategoryIds: memberOperationalSettings.disabledCategoryIds }).from(memberships).leftJoin(memberOperationalSettings, eq(memberOperationalSettings.membershipId, memberships.id)).where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, buyerIds)));
  for (const row of rows) {
    if (row.status !== "aktiv") blocks.set(row.userId, "Käufer-Zugang ist nicht aktiv");
    else if (row.deliveryPaused) blocks.set(row.userId, "Auslieferung für diesen Käufer pausiert");
    else if (row.paymentMode === "gesperrt") blocks.set(row.userId, "Käufer ist gesperrt (Zahlungsmodus)");
    else if (Array.isArray(row.disabledCategoryIds) && (row.disabledCategoryIds as unknown[]).map(Number).includes(categoryId)) blocks.set(row.userId, "Lead-Kategorie für diesen Käufer deaktiviert");
  }
  return blocks;
}

/**
 * Sorgt dafür, dass eine Bestellung ausliefern kann, ohne dass jemand von Hand eine Lieferkette baut:
 * je Kategorie der Bestellung eine Kette „Bestellung <Nr.>“ mit einem Stop für den Käufer (Preis der Bestellung).
 */
export async function ensureOrderChains(db: Db, tenantId: number, orderId: number) {
  const order = (await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1))[0];
  if (!order) return { created: 0 };
  const config = (await db.select().from(orderOperationalConfigs).where(eq(orderOperationalConfigs.orderId, order.id)).limit(1))[0];
  const categoryIds = Array.from(new Set([order.categoryId, ...((Array.isArray(config?.categoryIds) ? (config!.categoryIds as unknown[]).map(Number) : []).filter((id) => Number.isInteger(id) && id > 0))]));
  const existing = await db.select({ id: deliveryChains.id, categoryId: deliveryChains.categoryId }).from(deliveryChains).where(and(eq(deliveryChains.tenantId, tenantId), eq(deliveryChains.orderId, order.id)));
  let created = 0;
  for (const categoryId of categoryIds) {
    if (existing.some((chain) => chain.categoryId === categoryId)) continue;
    const inserted = await db.insert(deliveryChains).values({ tenantId, orderId: order.id, categoryId, name: `Bestellung ${order.orderNumber}`, priority: config?.priority ?? 1, sellTarget: 1, distributionMode: "lieferketten_round_robin", status: "aktiv" });
    const chainId = Number(inserted[0]?.insertId) || 0;
    if (chainId) { await db.insert(deliveryStops).values({ chainId, buyerName: order.buyerName, position: 1, unitPrice: order.unitPrice, active: true }); created += 1; }
  }
  // Stop-Preis und Käufername an der Standard-Kette nachziehen, wenn die Bestellung geändert wurde
  for (const chain of existing) { const stops = await db.select().from(deliveryStops).where(eq(deliveryStops.chainId, chain.id)); if (stops.length === 1 && (stops[0].buyerName !== order.buyerName || stops[0].unitPrice !== order.unitPrice)) await db.update(deliveryStops).set({ buyerName: order.buyerName, unitPrice: order.unitPrice }).where(eq(deliveryStops.id, stops[0].id)); }
  return { created };
}

/** Letzte erfolgreiche Lieferung eines Leads als reklamiert markieren (Reklamationsfenster/Aktivität der Kette). */
export async function markDeliveryReclaimed(db: Db, tenantId: number, leadId: number, claimId: number) {
  const delivery = (await db.select().from(leadDeliveries).where(and(eq(leadDeliveries.tenantId, tenantId), eq(leadDeliveries.leadId, leadId), inArray(leadDeliveries.result, ["angeboten", "angenommen"]))).orderBy(desc(leadDeliveries.occurredAt)).limit(1))[0];
  if (delivery) await db.update(leadDeliveries).set({ result: "reklamiert", claimId }).where(eq(leadDeliveries.id, delivery.id));
  return delivery;
}

/** Abgelehnte Reklamation: Lieferung gilt wieder als angenommen. */
export async function restoreDeliveryAfterRejectedClaim(db: Db, tenantId: number, claimId: number) {
  await db.update(leadDeliveries).set({ result: "angenommen", claimId: null }).where(and(eq(leadDeliveries.tenantId, tenantId), eq(leadDeliveries.claimId, claimId)));
}

/** Weitergeben nach Reklamation: Regel des Stops für diesen Grund, sonst die Einstellung des Grundes. */
export async function passOnAfterClaim(db: Db, tenantId: number, stopId: number | null | undefined, reasonName: string) {
  const reason = (await db.select({ id: reclamationReasons.id, forwardToNextStop: reclamationReasons.forwardToNextStop }).from(reclamationReasons).where(and(eq(reclamationReasons.tenantId, tenantId), eq(reclamationReasons.name, reasonName))).limit(1))[0];
  if (stopId && reason) { const rule = (await db.select().from(deliveryStopReasons).where(and(eq(deliveryStopReasons.stopId, stopId), eq(deliveryStopReasons.reasonId, reason.id))).limit(1))[0]; if (rule) return rule.passOn; }
  return reason?.forwardToNextStop ?? false;
}

export async function deliverLeadNow(db: Db, input: { tenantId: number; actorUserId: number | null; lead: LeadRow; preferChainId?: number | null; preferOrderId?: number | null; allowRepeat?: boolean; now?: Date; settings?: DeliverySettings; excludeChainIds?: number[]; ignoreAssignment?: boolean; passedOn?: boolean }): Promise<DeliveryResult> {
  const { tenantId, lead } = input; const now = input.now ?? new Date();
  const settings = input.settings ?? await loadDeliverySettings(db, tenantId);
  const metadata = metadataOf(lead);
  const preferChainId = input.ignoreAssignment ? null : input.preferChainId ?? (Number(metadata.assignedDeliveryChainId) || null);
  const preferOrderId = input.ignoreAssignment ? null : input.preferOrderId ?? (Number(metadata.assignedOrderId) || null);

  // Schutz vor Doppelauslieferung desselben Leads
  const previousDeliveries = await db.select().from(leadDeliveries).where(and(eq(leadDeliveries.tenantId, tenantId), eq(leadDeliveries.leadId, lead.id)));
  const alreadyDelivered = previousDeliveries.find((row) => row.result === "angeboten" || row.result === "angenommen");
  if (alreadyDelivered && !input.allowRepeat) throw new Error(`Lead wurde bereits an ${alreadyDelivered.buyerName} ausgeliefert (${alreadyDelivered.occurredAt.toLocaleString("de-DE")}). Erneute Auslieferung nur ausdrücklich mit „erneut ausliefern“.`);

  const excluded = new Set(input.excludeChainIds ?? []);
  // Bestellungen ohne eigene Lieferkette bekommen bei Bedarf eine Standard-Kette (ein Stop = Käufer der Bestellung)
  if (preferOrderId) { const forOrder = await db.select({ id: deliveryChains.id }).from(deliveryChains).where(and(eq(deliveryChains.tenantId, tenantId), eq(deliveryChains.orderId, preferOrderId), eq(deliveryChains.categoryId, lead.categoryId))); if (!forOrder.length) await ensureOrderChains(db, tenantId, preferOrderId); }
  else if (!preferChainId) {
    const openOrders = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.categoryId, lead.categoryId), or(eq(orders.status, "offen"), eq(orders.status, "aktiv"))));
    if (openOrders.length) { const withChain = new Set((await db.select({ orderId: deliveryChains.orderId }).from(deliveryChains).where(and(eq(deliveryChains.tenantId, tenantId), inArray(deliveryChains.orderId, openOrders.map((order) => order.id))))).map((row) => row.orderId)); for (const order of openOrders) if (!withChain.has(order.id)) await ensureOrderChains(db, tenantId, order.id); }
  }
  const chains = (await db.select().from(deliveryChains).where(and(eq(deliveryChains.tenantId, tenantId), eq(deliveryChains.categoryId, lead.categoryId), eq(deliveryChains.status, "aktiv")))).filter((chain) => !excluded.has(chain.id));
  const orderIds = Array.from(new Set(chains.map((chain) => chain.orderId).filter((id): id is number => typeof id === "number")));
  const configs = orderIds.length ? await db.select().from(orderOperationalConfigs).where(and(eq(orderOperationalConfigs.tenantId, tenantId), inArray(orderOperationalConfigs.orderId, orderIds))) : [];
  const orderRows = orderIds.length ? await db.select().from(orders).where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds))) : [];
  const deliveredRows = orderIds.length ? await db.select({ orderId: leadDeliveries.orderId }).from(leadDeliveries).where(and(eq(leadDeliveries.tenantId, tenantId), inArray(leadDeliveries.orderId, orderIds), inArray(leadDeliveries.result, ["angeboten", "angenommen"]))) : [];
  const deliveredCount = new Map<number, number>(); for (const row of deliveredRows) if (row.orderId) deliveredCount.set(row.orderId, (deliveredCount.get(row.orderId) ?? 0) + 1);
  const duplicates = await duplicateTargets(db, tenantId, lead, settings, now);
  // Kappen je Kette (Tag / gesamt) und je Stop (max. Leads)
  const chainIds = chains.map((chain) => chain.id);
  const chainDeliveries = chainIds.length ? await db.select({ chainId: leadDeliveries.chainId, stopId: leadDeliveries.stopId, occurredAt: leadDeliveries.occurredAt }).from(leadDeliveries).where(and(eq(leadDeliveries.tenantId, tenantId), inArray(leadDeliveries.chainId, chainIds), inArray(leadDeliveries.result, ["angeboten", "angenommen", "reklamiert"]))) : [];
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const chainTotal = new Map<number, number>(); const chainToday = new Map<number, number>(); const stopTotal = new Map<number, number>();
  for (const row of chainDeliveries) { if (row.chainId) { chainTotal.set(row.chainId, (chainTotal.get(row.chainId) ?? 0) + 1); if (row.occurredAt >= dayStart) chainToday.set(row.chainId, (chainToday.get(row.chainId) ?? 0) + 1); } if (row.stopId) stopTotal.set(row.stopId, (stopTotal.get(row.stopId) ?? 0) + 1); }
  // Konflikt-Käufer: bei welchen Käufer-Konten liegt dieser Kontakt bereits?
  const conflictBuyerIds = new Set<number>();
  if (duplicates.buyerNames.size) { const stopRows = await db.select({ buyerName: deliveryStops.buyerName, buyerUserId: deliveryStops.buyerUserId }).from(deliveryStops).innerJoin(deliveryChains, eq(deliveryChains.id, deliveryStops.chainId)).where(eq(deliveryChains.tenantId, tenantId)); for (const row of stopRows) if (row.buyerUserId && duplicates.buyerNames.has(row.buyerName.toLowerCase())) conflictBuyerIds.add(row.buyerUserId); for (const config of configs) if (config.buyerUserId && duplicates.orderIds.has(config.orderId)) conflictBuyerIds.add(config.buyerUserId); }
  const stopBuyerIds = new Set<number>();
  const candidates: Candidate[] = await Promise.all(chains.map(async (chain) => {
    const stops = await db.select().from(deliveryStops).where(and(eq(deliveryStops.chainId, chain.id), eq(deliveryStops.active, true))).orderBy(deliveryStops.position);
    for (const stop of stops) if (stop.buyerUserId) stopBuyerIds.add(stop.buyerUserId);
    const config = chain.orderId ? configs.find((row) => row.orderId === chain.orderId) : undefined;
    const order = chain.orderId ? orderRows.find((row) => row.id === chain.orderId) : undefined;
    let eligibility: Candidate["eligibility"];
    const supplierIds = numberList(chain.supplierIds);
    if (!stops.length) eligibility = { eligible: false, reason: "Lieferkette hat keinen aktiven Stop" };
    else if (order && !["offen", "aktiv"].includes(order.status)) eligibility = { eligible: false, reason: `Bestellung ${order.orderNumber} ist ${order.status}` };
    else if (chain.country && lead.country !== chain.country) eligibility = { eligible: false, reason: `Kette nur für Land ${chain.country}` };
    else if (chain.supplierFilterMode === "include" && (!lead.supplierId || !supplierIds.includes(lead.supplierId))) eligibility = { eligible: false, reason: "Lieferant nicht in dieser Kette freigegeben" };
    else if (chain.supplierFilterMode === "exclude" && lead.supplierId && supplierIds.includes(lead.supplierId)) eligibility = { eligible: false, reason: "Lieferant für diese Kette ausgeschlossen" };
    else if (chain.totalCap && (chainTotal.get(chain.id) ?? 0) >= chain.totalCap) eligibility = { eligible: false, reason: "Maximale Leads insgesamt erreicht" };
    else if (chain.dailyCap && (chainToday.get(chain.id) ?? 0) >= chain.dailyCap) eligibility = { eligible: false, reason: "Tageshöchstgrenze erreicht" };
    else if ((chain.orderId && duplicates.orderIds.has(chain.orderId)) || stops.every((stop) => duplicates.buyerNames.has(stop.buyerName.toLowerCase()))) eligibility = { eligible: false, reason: "Dublettenschutz: Kontakt wurde bereits an diesen Käufer geliefert" };
    else eligibility = evaluateOrderEligibility(config, lead, chain.orderId ? deliveredCount.get(chain.orderId) ?? 0 : 0, now);
    return { chain, stops, config, order, eligibility };
  }));
  const memberBlocks = await buyerMemberBlocks(db, tenantId, [...configs, ...Array.from(stopBuyerIds).map((buyerUserId) => ({ buyerUserId } as OrderConfigRow))], lead.categoryId);
  for (const candidate of candidates) if (candidate.eligibility.eligible && candidate.config?.buyerUserId && memberBlocks.has(candidate.config.buyerUserId)) candidate.eligibility = { eligible: false, reason: memberBlocks.get(candidate.config.buyerUserId) };
  if (!candidates.length) throw new Error("Keine aktive Lieferkette mit Stop für diese Lead-Kategorie verfügbar.");

  const explain = (items: Candidate[]) => items.map((item) => `${item.chain.name}: ${item.eligibility.reason ?? "nicht verfügbar"}`).join("; ");
  let pool = candidates.filter((item) => item.eligibility.eligible);
  if (preferChainId) {
    const preferred = candidates.filter((item) => item.chain.id === preferChainId);
    if (preferred.length && !preferred[0].eligibility.eligible && !input.passedOn) throw new Error(`Die zugeordnete Lieferkette kann den Lead gerade nicht annehmen (${explain(preferred)}).`);
    if (preferred.length && preferred[0].eligibility.eligible) pool = preferred; // beim Weitergeben nach Reklamation: Kette nicht mehr zuständig → alle passenden Ketten
  } else if (preferOrderId) {
    const preferred = candidates.filter((item) => item.chain.orderId === preferOrderId);
    if (preferred.length && !preferred.some((item) => item.eligibility.eligible)) throw new Error(`Die zugeordnete Bestellung kann den Lead gerade nicht annehmen (${explain(preferred)}).`);
    if (preferred.length) pool = preferred.filter((item) => item.eligibility.eligible);
  }
  if (!pool.length) throw new Error(`Keine aktive Lieferkette mit Stop für diese Lead-Kategorie verfügbar (${explain(candidates)}).`);

  const attempts: DeliveryAttempt[] = []; const tried = new Set<number>(); let claimId: number | undefined;
  const toCandidate = (item: Candidate) => ({ id: item.chain.id, priority: item.chain.priority, status: item.chain.status, cursor: item.chain.roundRobinCursor, stopCount: item.stops.length, hasOrder: Boolean(item.chain.orderId) });
  let lastResult: DeliveryResult | null = null; let stopOnExhausted = false; let passedOn = input.passedOn ?? false;
  const suppliersDelivered = new Set<number>();
  outer: while (!stopOnExhausted) {
    const selected = selectNextChain(pool.filter((item) => !tried.has(item.chain.id)).map(toCandidate), settings.chainDistributionMode);
    if (!selected) break;
    const target = pool.find((item) => item.chain.id === selected.id)!; tried.add(target.chain.id);
    await db.update(deliveryChains).set({ roundRobinCursor: target.chain.roundRobinCursor + 1 }).where(eq(deliveryChains.id, target.chain.id));
    let sold = 0;
    // Wasserfall: Stops von oben nach unten
    for (const stop of target.stops) {
      const currentLead = (await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1))[0] ?? lead;
      const buyerUserId = stop.buyerUserId ?? target.config?.buyerUserId ?? null;
      let skip: string | null = null;
      if (duplicates.buyerNames.has(stop.buyerName.toLowerCase())) skip = "Dublette: Kontakt liegt bereits bei diesem Käufer";
      else if (buyerUserId && memberBlocks.has(buyerUserId)) skip = memberBlocks.get(buyerUserId) ?? "Käufer nicht verfügbar";
      else skip = stopSkipReason(stop, currentLead, { now, suppliersDelivered, conflictBuyerIds, stopDeliveries: stopTotal.get(stop.id) ?? 0 });
      if (skip) {
        await db.insert(leadDeliveries).values({ tenantId, leadId: lead.id, chainId: target.chain.id, stopId: stop.id, orderId: target.chain.orderId ?? null, buyerName: stop.buyerName, unitPrice: stop.unitPrice, result: "übersprungen", skipReason: skip.slice(0, 160), occurredAt: now });
        attempts.push({ chainId: target.chain.id, chainName: target.chain.name, stopId: stop.id, buyerName: stop.buyerName, orderId: target.chain.orderId ?? null, outcome: "übersprungen", responseStatus: undefined, reason: skip });
        continue;
      }
      const windowEndsAt = new Date(now.getTime() + (stop.reclamationWindowHours ?? 0) * 3_600_000);
      let deliveryId = 0;
      await db.transaction(async (tx) => {
        const inserted = await tx.insert(leadDeliveries).values({ tenantId, leadId: lead.id, chainId: target.chain.id, stopId: stop.id, orderId: target.chain.orderId ?? null, buyerName: stop.buyerName, unitPrice: stop.unitPrice, result: "angeboten", windowEndsAt, acceptedAt: stop.reclamationWindowHours ? null : now, occurredAt: now });
        deliveryId = Number(inserted[0]?.insertId) || 0;
        await tx.update(leads).set({ status: "zugewiesen", assignedAt: now }).where(eq(leads.id, lead.id));
        if (currentLead.status !== "zugewiesen") await tx.insert(leadStatusEvents).values({ tenantId, leadId: lead.id, previousStatus: currentLead.status, nextStatus: "zugewiesen", actorUserId: input.actorUserId, note: `Auslieferung an ${stop.buyerName} (${target.chain.name}, Stop ${stop.position})` });
        if (target.order) { const delivered = target.order.deliveredCount + 1; await tx.update(orders).set({ deliveredCount: delivered, status: delivered >= target.order.quantity ? "erfüllt" : target.order.status }).where(eq(orders.id, target.order.id)); }
      });
      stopTotal.set(stop.id, (stopTotal.get(stop.id) ?? 0) + 1);

      // Übergabe: API-Calls des Käufer-Kontos des Stops (Benutzer → Integration), sonst dessen Partnerintegration, sonst „angeboten“ (manuell)
      let integration: IntegrationRow | undefined; let outcome: ExportOutcome | undefined; let handOverName = ""; let matchedRule: Awaited<ReturnType<typeof handOverToBuyerEndpoints>>["matchedRule"] = null;
      if (buyerUserId) {
        const handOver = await handOverToBuyerEndpoints(db, { tenantId, buyerUserId, lead: currentLead, extraValues: { order_number: target.order?.orderNumber ?? "", unit_price: stop.unitPrice }, skipEmptyFields: settings.skipEmptyApiFields });
        if (handOver.attempted) { outcome = { eventType: handOver.ok ? "geliefert" : "abgelehnt", externalReference: handOver.partnerReference ?? lead.publicId, responseStatus: handOver.status, responseBody: handOver.summary }; handOverName = `API-Call${handOver.results.length > 1 ? "s" : ""} (${handOver.summary})`; matchedRule = handOver.matchedRule; }
      }
      if (!outcome) {
        integration = await resolveBuyerIntegration(db, tenantId, buyerUserId ? { buyerUserId } : undefined);
        if (!integration) {
          attempts.push({ chainId: target.chain.id, chainName: target.chain.name, stopId: stop.id, buyerName: stop.buyerName, orderId: target.chain.orderId ?? null, outcome: "angeboten", responseStatus: undefined });
          return { chainId: target.chain.id, stopId: stop.id, buyerName: stop.buyerName, unitPrice: stop.unitPrice, orderId: target.chain.orderId ?? null, result: "angeboten", export: null, attempts };
        }
        outcome = await exportLeadToIntegration(db, { tenantId, integration, lead: { ...currentLead, metadata: { ...metadataOf(currentLead), deliveredOrderNumber: target.order?.orderNumber ?? null, deliveredUnitPrice: stop.unitPrice } }, externalReference: `${target.order?.orderNumber ?? target.chain.name}/${lead.publicId}`, settings });
        handOverName = integration.name;
      }
      const exported = { integrationId: integration?.id ?? 0, integrationName: integration?.name ?? "API-Call", eventType: outcome.eventType, responseStatus: outcome.responseStatus };
      if (outcome.eventType === "geliefert") {
        if (deliveryId) await db.update(leadDeliveries).set({ result: "angenommen" }).where(eq(leadDeliveries.id, deliveryId));
        if (integration) { const partnerReference = extractPartnerReference(outcome.responseBody ?? ""); if (partnerReference) await db.update(leads).set({ metadata: { ...metadataOf(currentLead), partnerReference, partnerReferenceAt: now.toISOString() } }).where(eq(leads.id, lead.id)); }
        await db.insert(leadStatusEvents).values({ tenantId, leadId: lead.id, previousStatus: "zugewiesen", nextStatus: "zugewiesen", actorUserId: input.actorUserId, note: `API-Übergabe an ${handOverName}: geliefert (HTTP ${outcome.responseStatus ?? "–"})${stop.reclamationWindowHours ? ` · reklamierbar bis ${windowEndsAt.toLocaleString("de-DE")}` : " · sofort angenommen"}` });
        attempts.push({ chainId: target.chain.id, chainName: target.chain.name, stopId: stop.id, buyerName: stop.buyerName, orderId: target.chain.orderId ?? null, outcome: "angenommen", responseStatus: outcome.responseStatus });
        duplicates.buyerNames.add(stop.buyerName.toLowerCase()); if (buyerUserId) conflictBuyerIds.add(buyerUserId);
        sold += 1; lastResult = { chainId: target.chain.id, stopId: stop.id, buyerName: stop.buyerName, unitPrice: stop.unitPrice, orderId: target.chain.orderId ?? null, result: "angenommen", export: exported, attempts, claimId };
        if (sold >= Math.max(1, target.chain.sellTarget)) return lastResult;
        continue; // Verkaufsziel > 1: weitere Käufer in der Kette
      }
      // Ablehnung: Lieferung als abgelehnt markieren, Bestellzähler zurücknehmen, nächster Stop
      const reason = `${handOverName} hat abgelehnt (HTTP ${outcome.responseStatus ?? "–"}${outcome.responseBody ? `: ${outcome.responseBody.slice(0, 160)}` : ""})`;
      if (deliveryId) await db.update(leadDeliveries).set({ result: "abgelehnt" }).where(eq(leadDeliveries.id, deliveryId));
      if (target.order) await db.update(orders).set({ deliveredCount: target.order.deliveredCount, status: target.order.status }).where(eq(orders.id, target.order.id));
      await db.insert(leadStatusEvents).values({ tenantId, leadId: lead.id, previousStatus: "zugewiesen", nextStatus: "zugewiesen", actorUserId: input.actorUserId, note: `API-Übergabe an ${handOverName}: abgelehnt (HTTP ${outcome.responseStatus ?? "–"})` });
      attempts.push({ chainId: target.chain.id, chainName: target.chain.name, stopId: stop.id, buyerName: stop.buyerName, orderId: target.chain.orderId ?? null, outcome: "abgelehnt", responseStatus: outcome.responseStatus, reason: matchedRule ? `${reason} → ${matchedRule.reasonName}` : reason });
      if (matchedRule) {
        // Partner-Response-Mapping: Treffer → Reklamation mit dem zugeordneten Grund (sofort genehmigt); weitergeben laut Stop-Regel, sonst laut Grund
        const insertedClaim = await db.insert(claims).values({ tenantId, leadId: lead.id, reason: matchedRule.reasonName, details: `Partner-Antwort: ${reason}`, status: "genehmigt", refundAmount: stop.unitPrice, dueAt: now, resolvedAt: now });
        claimId = Number(insertedClaim[0]?.insertId) || claimId;
        if (claimId) { await db.insert(claimEvents).values([{ tenantId, claimId, eventType: "erstellt", nextStatus: "genehmigt", actorUserId: input.actorUserId, note: `Response-Mapping: ${matchedRule.label ?? matchedRule.value} → ${matchedRule.reasonName}` }, { tenantId, claimId, eventType: "entschieden", previousStatus: "offen", nextStatus: "genehmigt", actorUserId: input.actorUserId, note: "Automatisch genehmigt und erstattet (Partner-Response-Mapping)." }]); if (deliveryId) await db.update(leadDeliveries).set({ result: "reklamiert", claimId }).where(eq(leadDeliveries.id, deliveryId)); }
        const stopRule = (await db.select().from(deliveryStopReasons).where(and(eq(deliveryStopReasons.stopId, stop.id), eq(deliveryStopReasons.reasonId, matchedRule.reasonId))).limit(1))[0];
        const passOn = stopRule ? stopRule.passOn : matchedRule.forwardToNextStop;
        if (!passOn) { stopOnExhausted = true; break outer; }
        passedOn = true; continue;
      }
      if (settings.incomingPrePing && QUALIFIED_REJECTION(outcome.responseStatus) && !claimId) {
        const dueAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const insertedClaim = await db.insert(claims).values({ tenantId, leadId: lead.id, reason: "Partnerablehnung", details: reason, status: "offen", dueAt });
        claimId = Number(insertedClaim[0]?.insertId) || undefined;
        if (claimId) await db.insert(claimEvents).values([{ tenantId, claimId, eventType: "erstellt", nextStatus: "offen", actorUserId: input.actorUserId, note: "Automatische Reklamation nach qualifizierter Partnerablehnung (PrePing)." }, { tenantId, claimId, eventType: "frist_gesetzt", note: `Prüfungsfrist: ${dueAt.toLocaleDateString("de-DE")}`, actorUserId: input.actorUserId }]);
      }
    }
    if (lastResult) return lastResult;
    // Kette erschöpft: Regel „Lead ohne Abnehmer“
    const action = exhaustedActionFor(target.chain, lead);
    await db.insert(leadStatusEvents).values({ tenantId, leadId: lead.id, previousStatus: "zugewiesen", nextStatus: "zugewiesen", actorUserId: input.actorUserId, note: `Kette „${target.chain.name}“ erschöpft – ${action === "return" ? "zurück an die Quelle" : "freigegeben für weitere Ketten/Bestellungen"}` });
    if (action === "return") { stopOnExhausted = true; break; }
    // freigegeben: alle passenden Ketten (nach Priorität), danach Bestellungen – bei fester Zuordnung nur nach einer Reklamation mit „weitergeben“
    if (!(preferChainId || preferOrderId) || passedOn) pool = candidates.filter((item) => item.eligibility.eligible);
  }

  // Kein Abnehmer: Lead wieder freigeben (bzw. an die Quelle zurück), Lieferant benachrichtigen
  const last = attempts[attempts.length - 1] ?? { chainId: 0, chainName: "", stopId: 0, buyerName: "", orderId: null, outcome: "abgelehnt" as const, responseStatus: undefined, reason: "Kein passender Stop" };
  if (lead.supplierId) {
    const supplier = (await db.select({ userId: suppliers.userId }).from(suppliers).where(eq(suppliers.id, lead.supplierId)).limit(1))[0];
    if (supplier?.userId) { const returned = await notifySupplierReturn(db, { tenantId, supplierUserId: supplier.userId, lead, reason: last.reason ?? "Zustellung fehlgeschlagen (API)" }); if (returned) await db.insert(leadStatusEvents).values({ tenantId, leadId: lead.id, previousStatus: "zugewiesen", nextStatus: "zugewiesen", actorUserId: input.actorUserId, note: `Rückgabe-Webhook an Lieferant: ${returned.ok ? "gemeldet" : "fehlgeschlagen"} (HTTP ${returned.status || "–"})` }); }
  }
  const untouched = attempts.every((attempt) => attempt.outcome === "übersprungen");
  const restoredStatus = claimId ? "reklamiert" : untouched ? lead.status : stopOnExhausted ? "hängend" : lead.status === "zugewiesen" ? "genehmigt" : lead.status;
  if (!untouched) await db.update(leads).set({ status: restoredStatus, assignedAt: null }).where(eq(leads.id, lead.id));
  await db.insert(leadStatusEvents).values({ tenantId, leadId: lead.id, previousStatus: untouched ? lead.status : "zugewiesen", nextStatus: restoredStatus, actorUserId: input.actorUserId, note: `Auslieferung ohne Abnehmer: ${attempts.map((attempt) => `${attempt.buyerName}: ${attempt.reason ?? attempt.outcome}`).join("; ") || "kein passender Stop"}` });
  const lastCandidate = pool.find((item) => item.chain.id === last.chainId);
  return { chainId: last.chainId, stopId: last.stopId, buyerName: last.buyerName, unitPrice: lastCandidate?.stops.find((stop) => stop.id === last.stopId)?.unitPrice ?? "0.00", orderId: last.orderId, result: "abgelehnt", export: null, attempts, claimId };
}

/* ------------------------------------------------------------------ Automatisierung */

export type AutomationRunResult = { duplicated: number; executed: number; delivered: number };

export async function runAutomationsForLead(db: Db, input: { tenantId: number; actorUserId: number | null; lead: LeadRow; triggerType: TriggerType; depth?: number }): Promise<AutomationRunResult> {
  const { tenantId, lead: source } = input; const depth = input.depth ?? 0;
  const rules = await db.select().from(automationRules).where(and(eq(automationRules.tenantId, tenantId), eq(automationRules.status, "aktiv"), eq(automationRules.triggerType, input.triggerType), eq(automationRules.sourceCategoryId, source.categoryId)));
  let duplicated = 0; let executed = 0; let delivered = 0;
  const metadata = metadataOf(source);
  const sourceData = { ...metadata, firstName: source.firstName ?? "", lastName: source.lastName ?? "", email: source.email ?? "", phone: source.phone ?? "", postcode: source.postcode ?? "", city: source.city ?? "", status: source.status, supplierName: source.supplierName ?? "" };
  const log = (ruleId: number, result: "ausgeführt" | "übersprungen", summary: string, createdLeadId?: number) => db.insert(automationExecutionLogs).values({ tenantId, ruleId, sourceLeadId: source.id, createdLeadId, result, summary: summary.slice(0, 320) });
  const currentLead = async () => (await db.select().from(leads).where(eq(leads.id, source.id)).limit(1))[0] ?? source;

  for (const rule of rules) {
    try {
      if (rule.supplierId && rule.supplierId !== source.supplierId) { await log(rule.id, "übersprungen", "Lieferantenfilter nicht erfüllt"); continue; }
      const conditionsFulfilled = conditionsMatch(sourceData, (rule.conditions ?? []) as FieldCondition[], rule.conditionMode); const useNegativeBranch = !conditionsFulfilled;
      if (useNegativeBranch && !rule.falseActionType) { await log(rule.id, "übersprungen", "Bedingungen nicht erfüllt; kein Negativzweig konfiguriert."); continue; }
      const configSource = useNegativeBranch ? rule.falseActionConfig : rule.actionConfig; const config = configSource && typeof configSource === "object" && !Array.isArray(configSource) ? (configSource as Record<string, unknown>) : {};
      const actionType = useNegativeBranch ? rule.falseActionType! : rule.actionType ?? "lead_typ_duplizieren";
      const textConfig = (key: string) => (typeof config[key] === "string" ? (config[key] as string) : ""); const numericConfig = (key: string) => Number(config[key]) || 0;
      let summary = "Automatisierung ausgeführt."; let createdLeadId: number | undefined;

      if (actionType === "lead_typ_duplizieren") {
        const categoryId = numericConfig("categoryId") || rule.targetCategoryId; const publicId = nanoid(8).toUpperCase();
        const values = { tenantId, publicId, categoryId, firstName: source.firstName, lastName: source.lastName, email: source.email, phone: source.phone, postcode: source.postcode, city: source.city, country: source.country, supplierId: source.supplierId, supplierName: source.supplierName, assignedUserId: source.assignedUserId, cost: source.cost, metadata: source.metadata, status: "genehmigt" as const };
        const inserted = await db.insert(leads).values(values);
        createdLeadId = Number(inserted[0]?.insertId) || undefined; duplicated += 1; summary = `Lead ${publicId} in Zielkategorie ${categoryId} dupliziert`;
        const created: LeadRow | undefined = createdLeadId ? { ...source, ...values, id: createdLeadId, assignedAt: null, createdAt: new Date(), updatedAt: new Date() } : undefined;
        if (created && depth < 2) { const nested = await runAutomationsForLead(db, { tenantId, actorUserId: input.actorUserId, lead: created, triggerType: "lead_erstellt", depth: depth + 1 }); executed += nested.executed; duplicated += nested.duplicated; delivered += nested.delivered; }
      } else if (actionType === "lead_freigeben" || actionType === "lead_pruefen" || actionType === "lead_status_aendern") {
        const nextStatus = actionType === "lead_freigeben" ? "genehmigt" : actionType === "lead_pruefen" ? "hängend" : textConfig("status");
        if (!["neu", "genehmigt", "zugewiesen", "reklamiert", "fehlerhaft", "deaktiviert", "hängend"].includes(nextStatus)) { await log(rule.id, "übersprungen", "Ungültiger Zielstatus in der Aktionskonfiguration."); continue; }
        const before = await currentLead();
        await db.update(leads).set({ status: nextStatus as LeadRow["status"] }).where(eq(leads.id, source.id));
        if (before.status !== nextStatus) await db.insert(leadStatusEvents).values({ tenantId, leadId: source.id, previousStatus: before.status, nextStatus, actorUserId: input.actorUserId, note: `Automatisierung: ${rule.name}` });
        summary = `Leadstatus auf ${nextStatus} gesetzt`;
      } else if (actionType === "lead_sparte_aendern") {
        const categoryId = numericConfig("categoryId") || rule.targetCategoryId;
        const category = (await db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(and(eq(leadCategories.tenantId, tenantId), eq(leadCategories.id, categoryId))).limit(1))[0];
        if (!category) { await log(rule.id, "übersprungen", "Zielkategorie wurde nicht gefunden."); continue; }
        await db.update(leads).set({ categoryId }).where(eq(leads.id, source.id)); summary = `Lead-Sparte zu ${category.name} geändert`;
      } else if (actionType === "lead_verantwortung_aendern") {
        const userId = numericConfig("userId");
        const member = userId ? (await db.select({ userId: memberships.userId, name: users.name }).from(memberships).leftJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), eq(memberships.status, "aktiv"))).limit(1))[0] : undefined;
        if (!member) { await log(rule.id, "übersprungen", "Aktives verantwortliches Mitglied wurde nicht gefunden."); continue; }
        await db.update(leads).set({ assignedUserId: userId, assignedAt: new Date() }).where(eq(leads.id, source.id)); summary = `Verantwortung an ${member.name ?? `Mitglied #${userId}`} übertragen`;
      } else if (actionType === "lead_tags_setzen") {
        const tagId = numericConfig("tagId");
        const tag = tagId ? (await db.select({ id: tags.id, name: tags.name }).from(tags).where(and(eq(tags.tenantId, tenantId), eq(tags.id, tagId))).limit(1))[0] : undefined;
        if (!tag) { await log(rule.id, "übersprungen", "Lead-Tag wurde nicht gefunden."); continue; }
        await db.insert(leadTagAssignments).values({ leadId: source.id, tagId }).onDuplicateKeyUpdate({ set: { tagId } }); summary = `Lead-Tag ${tag.name} gesetzt`;
      } else if (actionType === "lead_ausliefern") {
        // Automatisch ausliefern: die passende Bestellung/Lieferkette nach Priorität und Verteilreihenfolge, ohne feste Zuordnung
        try {
          const delivery = await deliverLeadNow(db, { tenantId, actorUserId: input.actorUserId, lead: await currentLead() });
          summary = delivery.result === "abgelehnt" ? `Auslieferung abgelehnt: ${delivery.attempts.map((attempt) => attempt.reason ?? attempt.buyerName).join("; ")}` : `Automatisch ausgeliefert an ${delivery.buyerName} (${delivery.result})`;
          if (delivery.result !== "abgelehnt") delivered += 1;
        } catch (error) { await log(rule.id, "übersprungen", error instanceof Error ? error.message : "Auslieferung nicht möglich"); continue; }
      } else if (actionType === "lead_lieferkette_zuordnen" || actionType === "lead_bestellung_zuordnen") {
        let chainId: number | null = null; let orderId: number | null = null; let label = "";
        if (actionType === "lead_lieferkette_zuordnen") {
          chainId = numericConfig("chainId") || null;
          const chain = chainId ? (await db.select().from(deliveryChains).where(and(eq(deliveryChains.tenantId, tenantId), eq(deliveryChains.id, chainId))).limit(1))[0] : undefined;
          if (!chain) { await log(rule.id, "übersprungen", "Lieferkette wurde nicht gefunden."); continue; }
          orderId = chain.orderId ?? null; label = `Lieferkette ${chain.name}`;
          await db.update(leads).set({ metadata: { ...metadataOf(await currentLead()), assignedDeliveryChainId: chain.id, assignedDeliveryChainName: chain.name } }).where(eq(leads.id, source.id));
          await db.insert(leadStatusEvents).values({ tenantId, leadId: source.id, previousStatus: source.status, nextStatus: source.status, actorUserId: input.actorUserId, note: `Automatisierung: Lieferkette zugeordnet (${chain.name})` });
        } else {
          orderId = numericConfig("orderId") || null;
          const order = orderId ? (await db.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId), or(eq(orders.status, "offen"), eq(orders.status, "aktiv")))).limit(1))[0] : undefined;
          if (!order) { await log(rule.id, "übersprungen", "Offene Bestellung wurde nicht gefunden."); continue; }
          label = `Bestellung ${order.orderNumber}`;
          await db.update(leads).set({ metadata: { ...metadataOf(await currentLead()), assignedOrderId: order.id, assignedOrderNumber: order.orderNumber } }).where(eq(leads.id, source.id));
          await db.insert(leadStatusEvents).values({ tenantId, leadId: source.id, previousStatus: source.status, nextStatus: source.status, actorUserId: input.actorUserId, note: `Automatisierung: Bestellung zugeordnet (${order.orderNumber})` });
        }
        summary = `${label} zugeordnet`;
        // Echtzeit-Auslieferung, wenn die Bestellkonfiguration es vorsieht (Ketten ohne Bestellung liefern sofort).
        const config = orderId ? (await db.select().from(orderOperationalConfigs).where(and(eq(orderOperationalConfigs.tenantId, tenantId), eq(orderOperationalConfigs.orderId, orderId))).limit(1))[0] : undefined;
        if (!orderId || config?.realtimeDelivery) {
          try {
            const delivery = await deliverLeadNow(db, { tenantId, actorUserId: input.actorUserId, lead: await currentLead(), preferChainId: chainId, preferOrderId: orderId });
            if (delivery.result === "abgelehnt") summary += `; Auslieferung abgelehnt: ${delivery.attempts.map((attempt) => attempt.reason ?? attempt.buyerName).join("; ")}`;
            else { delivered += 1; summary += `; ausgeliefert an ${delivery.buyerName}${delivery.export ? ` (API ${delivery.export.integrationName}: HTTP ${delivery.export.responseStatus ?? "–"})` : ""}`; }
          } catch (error) { summary += `; Auslieferung offen: ${error instanceof Error ? error.message : "unbekannter Fehler"}`; }
        }
      } else if (actionType === "integration_ausfuehren") {
        const integrationId = numericConfig("integrationId");
        const integration = integrationId ? (await db.select().from(partnerIntegrations).where(and(eq(partnerIntegrations.tenantId, tenantId), eq(partnerIntegrations.id, integrationId), eq(partnerIntegrations.status, "aktiv"))).limit(1))[0] : undefined;
        if (!integration?.callbackUrl) { await log(rule.id, "übersprungen", "Aktive Partnerintegration mit HTTPS-Rückrufadresse fehlt."); continue; }
        const exported = await exportLeadToIntegration(db, { tenantId, integration, lead: await currentLead(), externalReference: source.publicId });
        summary = `Integration ${integration.name}: ${exported.eventType} (HTTP ${exported.responseStatus ?? "–"})`;
      } else if (actionType === "webhook_ausloesen") {
        const url = textConfig("url"); if (!url) { await log(rule.id, "übersprungen", "Webhook-URL fehlt."); continue; }
        const exported = await dispatchLeadExport({ callbackUrl: url, lead: await currentLead(), externalReference: source.publicId, authMethod: (textConfig("authMethod") || "ohne") as "api_key" | "bearer" | "basic" | "ohne", credential: textConfig("credential") || undefined });
        summary = `Webhook ausgelöst: HTTP ${exported.responseStatus}`;
      } else if (actionType === "nachricht_senden") {
        if (!source.email) { await log(rule.id, "übersprungen", "Lead hat keine E-Mail-Adresse für die Nachricht."); continue; }
        await db.insert(emailEvents).values({ tenantId, recipientEmail: source.email, subject: textConfig("subject") || `Fluxora Lead ${source.publicId}`, deliveryStatus: "entwurf" }); summary = "Nachrichtenauftrag als Entwurf erstellt";
      } else {
        const actionKey = actionType === "kreditpruefung" ? "creditCheck" : "smartflow"; const actionValue = actionType === "kreditpruefung" ? "angefordert" : textConfig("flowName") || "ausgeführt";
        await db.update(leads).set({ metadata: { ...metadataOf(await currentLead()), [actionKey]: actionValue, lastAutomationRule: rule.name } }).where(eq(leads.id, source.id));
        summary = actionType === "kreditpruefung" ? "Kreditprüfung angefordert" : `Smartflow ${actionValue} ausgeführt`;
      }
      await log(rule.id, "ausgeführt", useNegativeBranch ? `Trifft nicht zu: ${summary}` : summary, createdLeadId); executed += 1;
    } catch (error) {
      await log(rule.id, "übersprungen", `Fehler: ${error instanceof Error ? error.message : "unbekannt"}`);
    }
  }
  return { duplicated, executed, delivered };
}

/** Bequemer Einstieg für Lead-Anlage/Statuswechsel: lädt den Lead frisch und lässt Fehler nie nach außen. */
export async function triggerLeadAutomations(db: Db, input: { tenantId: number; actorUserId: number | null; leadId: number; triggerType: TriggerType }): Promise<AutomationRunResult> {
  try {
    const lead = (await db.select().from(leads).where(and(eq(leads.tenantId, input.tenantId), eq(leads.kind, "verkauf"), eq(leads.id, input.leadId))).limit(1))[0];
    if (!lead) return { duplicated: 0, executed: 0, delivered: 0 };
    return await runAutomationsForLead(db, { tenantId: input.tenantId, actorUserId: input.actorUserId, lead, triggerType: input.triggerType });
  } catch (error) {
    console.error("[Automatisierung] Ausführung fehlgeschlagen:", error);
    return { duplicated: 0, executed: 0, delivered: 0 };
  }
}
