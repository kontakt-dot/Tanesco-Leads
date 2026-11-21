/**
 * Lieferkette (Wasserfall-Routing) – Übersicht, Detailseite, Ketten-Einstellungen, Stops, Reklamationsgründe je Stop, Aktivität.
 * Ein Lead läuft der Reihe nach über die Stops (Käufer + Preis); passt eine Bedingung nicht, wird der Stop übersprungen (keine Lieferung, keine Belastung).
 */
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { deliveryChains, deliveryEndpoints, deliveryStopReasons, deliveryStops, leadCategories, leadDeliveries, leads, memberships, orders, reclamationReasons, suppliers, users } from "../drizzle/schema";
import { byChainOrder, chainPlaces, reorderedPriorities, suggestChainName, supplierText, type SupplierFilterMode } from "../shared/chain-rules";
import type { Db } from "./lead-pipeline";

export type ChainRange = "heute" | "gestern" | "7_tage" | "14_tage" | "30_tage" | "maximal";
export type FieldFilter = { field: string; op: "gleich" | "ungleich" | "enthaelt" | "gesetzt" | "leer" | "groesser" | "kleiner"; value?: string };
export type StopRuleInput = { reasonId: number; allowed: boolean; passOn: boolean };

/** Zeitraum-Filter der Übersicht (Heute · Gestern · Letzte 7/14/30 Tage · Maximal). */
export function rangeBounds(range: ChainRange, now = new Date()): { from: Date | null; until: Date | null } {
  const startOfDay = (date: Date) => { const copy = new Date(date); copy.setHours(0, 0, 0, 0); return copy; };
  const today = startOfDay(now);
  if (range === "heute") return { from: today, until: null };
  if (range === "gestern") return { from: new Date(today.getTime() - 86_400_000), until: today };
  if (range === "7_tage") return { from: new Date(today.getTime() - 6 * 86_400_000), until: null };
  if (range === "14_tage") return { from: new Date(today.getTime() - 13 * 86_400_000), until: null };
  if (range === "30_tage") return { from: new Date(today.getTime() - 29 * 86_400_000), until: null };
  return { from: null, until: null };
}

export type DeliveryLike = { result: "angeboten" | "angenommen" | "abgelehnt" | "übersprungen" | "reklamiert"; windowEndsAt: Date | null; acceptedAt?: Date | null; skipReason?: string | null };
/** Angenommen = geliefert und Fenster vorbei (bzw. sofort angenommen bei 0 h). */
export const isAccepted = (row: DeliveryLike, now: Date) => row.result === "angenommen" && (Boolean(row.acceptedAt) || !row.windowEndsAt || row.windowEndsAt.getTime() <= now.getTime());

/** Ges./Ang./Abg. aus Lieferungen: gesamt = geschickt (ohne Skips) · angenommen = angenommen (Fenster abgelaufen oder ohne Fenster) · abgelehnt = abgelehnt + reklamiert. */
export function summarize(rows: DeliveryLike[], now = new Date()) {
  const sent = rows.filter((row) => row.result !== "übersprungen");
  const accepted = sent.filter((row) => isAccepted(row, now));
  const inWindow = sent.filter((row) => row.result === "angenommen" && !isAccepted(row, now));
  const rejected = sent.filter((row) => row.result === "abgelehnt" || row.result === "reklamiert");
  const reclaimed = sent.filter((row) => row.result === "reklamiert");
  const skipped = rows.filter((row) => row.result === "übersprungen");
  const duplicates = skipped.filter((row) => (row.skipReason ?? "").toLowerCase().startsWith("dublette"));
  const decided = accepted.length + rejected.length;
  return { total: sent.length, accepted: accepted.length, inWindow: inWindow.length, rejected: rejected.length, reclaimed: reclaimed.length, skipped: skipped.length, duplicates: duplicates.length, offered: sent.filter((row) => row.result === "angeboten").length, acceptanceRate: decided ? Math.round((accepted.length / decided) * 100) : null };
}

async function deliveriesFor(db: Db, tenantId: number, chainIds: number[], range: ChainRange) {
  if (!chainIds.length) return [];
  const bounds = rangeBounds(range);
  const conditions = [eq(leadDeliveries.tenantId, tenantId), inArray(leadDeliveries.chainId, chainIds)];
  if (bounds.from) conditions.push(gte(leadDeliveries.occurredAt, bounds.from));
  if (bounds.until) conditions.push(lte(leadDeliveries.occurredAt, bounds.until));
  return db.select().from(leadDeliveries).where(and(...conditions)).orderBy(desc(leadDeliveries.occurredAt));
}

const idList = (value: unknown): number[] => (Array.isArray(value) ? value.map(Number).filter((id) => Number.isInteger(id) && id > 0) : []);

/**
 * Übersichtsseite: alle Ketten in ihrer festen Reihenfolge – je Kette die Kategorie, von welchen Lieferanten, an welche Kunden
 * (in Reihenfolge), Ziel und Ges./Ang./Abg. im Zeitraum. `place` = Platz in der Kategorie, `before` = Ketten, die bei demselben Lead vorher drankommen.
 */
export async function chainOverview(db: Db, tenantId: number, range: ChainRange) {
  const chains = await db.select().from(deliveryChains).where(eq(deliveryChains.tenantId, tenantId)).orderBy(deliveryChains.priority, deliveryChains.id);
  const categories = await db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId));
  const stops = chains.length ? await db.select({ id: deliveryStops.id, chainId: deliveryStops.chainId, active: deliveryStops.active, buyerName: deliveryStops.buyerName, position: deliveryStops.position, unitPrice: deliveryStops.unitPrice }).from(deliveryStops).where(inArray(deliveryStops.chainId, chains.map((chain) => chain.id))).orderBy(deliveryStops.position) : [];
  const orderRows = chains.some((chain) => chain.orderId) ? await db.select({ id: orders.id, orderNumber: orders.orderNumber }).from(orders).where(eq(orders.tenantId, tenantId)) : [];
  const supplierRows = chains.some((chain) => chain.supplierFilterMode !== "all") ? await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.tenantId, tenantId)) : [];
  const rows = await deliveriesFor(db, tenantId, chains.map((chain) => chain.id), range);
  const places = chainPlaces(chains.map((chain) => ({ id: chain.id, name: chain.name, categoryId: chain.categoryId, priority: chain.priority, status: chain.status, supplierFilterMode: chain.supplierFilterMode, supplierIds: idList(chain.supplierIds) })));
  return {
    chains: chains.map((chain) => {
      const supplierIds = idList(chain.supplierIds); const supplierNames = supplierIds.map((id) => supplierRows.find((supplier) => supplier.id === id)?.name ?? `Lieferant #${id}`);
      const own = stops.filter((stop) => stop.chainId === chain.id); const place = places.get(chain.id);
      return {
        id: chain.id, name: chain.name, categoryId: chain.categoryId, categoryName: categories.find((category) => category.id === chain.categoryId)?.name ?? "–", orderId: chain.orderId, orderNumber: orderRows.find((order) => order.id === chain.orderId)?.orderNumber ?? null,
        priority: chain.priority, place: place?.place ?? 1, overlapsWith: place?.overlapsWith ?? [], before: place?.before ?? [],
        supplierFilterMode: chain.supplierFilterMode, supplierIds, supplierNames, supplierText: supplierText(chain.supplierFilterMode, supplierNames), country: chain.country,
        buyers: own.map((stop) => ({ name: stop.buyerName, active: stop.active, unitPrice: stop.unitPrice })), stops: own.length, sellTarget: chain.sellTarget, status: chain.status, stats: summarize(rows.filter((row) => row.chainId === chain.id)),
      };
    }),
  };
}

export type FixedChainInput = { categoryIds: number[]; supplierMode: SupplierFilterMode; supplierIds: number[]; buyers: Array<{ buyerUserId?: number | null; buyerName?: string | null; unitPrice: number; reclamationWindowHours?: number }>; name?: string | null; active: boolean };
/**
 * Feste Zuordnung anlegen: je gewählter Kategorie eine Kette – von diesen Lieferanten, an diese Kunden in dieser Reihenfolge.
 * Eine neue Kette kommt in ihrer Kategorie hinter die vorhandenen (sie nimmt niemandem den Platz weg).
 */
export async function createFixedChains(db: Db, tenantId: number, input: FixedChainInput) {
  const categoryIds = Array.from(new Set(input.categoryIds));
  const categoryRows = categoryIds.length ? await db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(and(eq(leadCategories.tenantId, tenantId), inArray(leadCategories.id, categoryIds))) : [];
  if (!categoryRows.length || categoryRows.length !== categoryIds.length) throw new Error("Bitte mindestens eine Lead-Kategorie wählen.");
  const supplierIds = input.supplierMode === "all" ? [] : Array.from(new Set(input.supplierIds));
  const supplierRows = supplierIds.length ? await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(and(eq(suppliers.tenantId, tenantId), inArray(suppliers.id, supplierIds))) : [];
  if (supplierRows.length !== supplierIds.length) throw new Error("Ein gewählter Lieferant wurde nicht gefunden.");
  if (input.supplierMode === "include" && !supplierIds.length) throw new Error("Bitte mindestens einen Lieferanten wählen – oder „Alle Lieferanten“.");
  if (input.active && !input.buyers.length) throw new Error("Eine aktive Kette braucht mindestens einen Kunden.");
  // Namen der Kunden vorab klären (für den Namen der Kette und damit ein Fehler nichts halb anlegt)
  const buyerNames: string[] = [];
  for (const buyer of input.buyers) {
    let name = (buyer.buyerName ?? "").trim();
    if (buyer.buyerUserId) { const row = (await db.select({ name: users.name, company: users.company }).from(users).innerJoin(memberships, eq(memberships.userId, users.id)).where(and(eq(users.id, buyer.buyerUserId), eq(memberships.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Käufer-Konto wurde nicht gefunden."); name = name || `${row.company ?? row.name ?? "Käufer"}`; }
    if (!name) throw new Error("Bitte bei jedem Kunden ein Käufer-Konto wählen oder einen Namen angeben.");
    buyerNames.push(name);
  }
  const existing = await db.select({ categoryId: deliveryChains.categoryId, priority: deliveryChains.priority }).from(deliveryChains).where(and(eq(deliveryChains.tenantId, tenantId), inArray(deliveryChains.categoryId, categoryIds)));
  const supplierNames = supplierIds.map((id) => supplierRows.find((row) => row.id === id)?.name ?? "");
  const created: Array<{ chainId: number; name: string; categoryId: number; priority: number }> = [];
  for (const categoryId of categoryIds) {
    const category = categoryRows.find((row) => row.id === categoryId)!;
    const priority = Math.min(999, existing.filter((row) => row.categoryId === categoryId).reduce((highest, row) => Math.max(highest, row.priority), 0) + 1);
    const custom = (input.name ?? "").trim();
    const name = (custom ? (categoryIds.length > 1 ? `${custom} – ${category.name}` : custom) : suggestChainName(category.name, input.supplierMode === "exclude" ? [`Alle außer ${supplierNames.join(", ")}`] : supplierNames, buyerNames)).slice(0, 160);
    const inserted = await db.insert(deliveryChains).values({ tenantId, categoryId, name, priority, sellTarget: 1, status: input.active ? "aktiv" : "inaktiv", supplierFilterMode: input.supplierMode, supplierIds });
    const chainId = Number(inserted[0]?.insertId) || 0;
    for (const buyer of input.buyers) await addStop(db, tenantId, { chainId, buyerUserId: buyer.buyerUserId ?? null, buyerName: buyer.buyerName ?? null, unitPrice: buyer.unitPrice, reclamationWindowHours: buyer.reclamationWindowHours });
    created.push({ chainId, name, categoryId, priority });
  }
  return { success: true, created };
}

/** Feste Reihenfolge der Ketten einer Kategorie neu setzen: Die Ketten bekommen die Zahlen 1, 2, 3 … in der gewünschten Folge. */
export async function reorderChains(db: Db, tenantId: number, categoryId: number, chainIds: number[]) {
  const rows = (await db.select({ id: deliveryChains.id, priority: deliveryChains.priority }).from(deliveryChains).where(and(eq(deliveryChains.tenantId, tenantId), eq(deliveryChains.categoryId, categoryId)))).sort(byChainOrder);
  const known = new Set(rows.map((row) => row.id));
  const ordered = chainIds.filter((id) => known.has(id)); for (const row of rows) if (!ordered.includes(row.id)) ordered.push(row.id);
  const next = reorderedPriorities(ordered);
  for (const item of next) if (rows.find((row) => row.id === item.id)?.priority !== item.priority) await db.update(deliveryChains).set({ priority: item.priority }).where(and(eq(deliveryChains.id, item.id), eq(deliveryChains.tenantId, tenantId)));
  return { success: true, order: next };
}

/** Käufer-Konten (Mitglieder vom Typ Käufer) und Lieferanten für die Auswahlfelder. */
export async function chainPickers(db: Db, tenantId: number) {
  const buyers = await db.select({ userId: memberships.userId, membershipId: memberships.id, status: memberships.status, name: users.name, company: users.company, email: users.email, integrationId: memberships.integrationId }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.tenantId, tenantId), eq(memberships.partnerType, "käufer")));
  const supplierRows = await db.select({ id: suppliers.id, name: suppliers.name, email: suppliers.email, status: suppliers.status }).from(suppliers).where(eq(suppliers.tenantId, tenantId));
  const endpoints = buyers.length ? await db.select({ membershipId: deliveryEndpoints.membershipId, url: deliveryEndpoints.url, method: deliveryEndpoints.method, enabled: deliveryEndpoints.enabled }).from(deliveryEndpoints).where(and(eq(deliveryEndpoints.tenantId, tenantId), inArray(deliveryEndpoints.membershipId, buyers.map((buyer) => buyer.membershipId)))) : [];
  return {
    buyers: buyers.map((buyer) => { const own = endpoints.filter((endpoint) => endpoint.membershipId === buyer.membershipId && endpoint.enabled); return { userId: buyer.userId, membershipId: buyer.membershipId, label: `${buyer.company ?? buyer.name ?? "Käufer"} — ${buyer.name ?? buyer.email ?? ""}`, company: buyer.company ?? buyer.name ?? "Käufer", contact: buyer.name ?? "", email: buyer.email ?? "", status: buyer.status, api: own.length > 0 || Boolean(buyer.integrationId), endpoint: own[0] ? `${own[0].method} ${own[0].url}` : null }; }),
    suppliers: supplierRows.map((supplier) => ({ id: supplier.id, label: supplier.email ? `${supplier.name} — ${supplier.email}` : supplier.name, status: supplier.status })),
    categories: await db.select({ id: leadCategories.id, name: leadCategories.name, status: leadCategories.status, isTemplate: leadCategories.isTemplate }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId)),
  };
}

/** Detailseite einer Kette: Einstellungen, Stops mit Statistik und Käuferinfo, Reklamationsgründe je Stop, Aktivität. */
export async function chainDetail(db: Db, tenantId: number, chainId: number, range: ChainRange) {
  const chain = (await db.select().from(deliveryChains).where(and(eq(deliveryChains.id, chainId), eq(deliveryChains.tenantId, tenantId))).limit(1))[0];
  if (!chain) throw new Error("Lieferkette wurde nicht gefunden.");
  const category = (await db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.id, chain.categoryId)).limit(1))[0];
  const stops = await db.select().from(deliveryStops).where(eq(deliveryStops.chainId, chain.id)).orderBy(deliveryStops.position);
  const pickers = await chainPickers(db, tenantId);
  const rows = await deliveriesFor(db, tenantId, [chain.id], range);
  const allRows = await db.select({ stopId: leadDeliveries.stopId, result: leadDeliveries.result, windowEndsAt: leadDeliveries.windowEndsAt, acceptedAt: leadDeliveries.acceptedAt, skipReason: leadDeliveries.skipReason }).from(leadDeliveries).where(and(eq(leadDeliveries.tenantId, tenantId), eq(leadDeliveries.chainId, chain.id)));
  const reasons = await db.select({ id: reclamationReasons.id, name: reclamationReasons.name, active: reclamationReasons.active, forwardToNextStop: reclamationReasons.forwardToNextStop }).from(reclamationReasons).where(and(eq(reclamationReasons.tenantId, tenantId), eq(reclamationReasons.active, true))).orderBy(reclamationReasons.id);
  const rules = stops.length ? await db.select().from(deliveryStopReasons).where(inArray(deliveryStopReasons.stopId, stops.map((stop) => stop.id))) : [];
  const leadIds = Array.from(new Set(rows.map((row) => row.leadId)));
  const leadRows = leadIds.length ? await db.select({ id: leads.id, publicId: leads.publicId, firstName: leads.firstName, lastName: leads.lastName, city: leads.city, status: leads.status }).from(leads).where(inArray(leads.id, leadIds)) : [];
  const now = new Date();
  const describe = (row: typeof rows[number]) => {
    if (row.result === "übersprungen") return { status: "übersprungen" as const, info: row.skipReason ?? "" };
    if (row.result === "reklamiert") return { status: "reklamiert" as const, info: "" };
    if (row.result === "abgelehnt") return { status: "abgelehnt" as const, info: "vom Käufer abgelehnt (API)" };
    if (row.result === "angeboten") return { status: "angeboten" as const, info: "wartet auf Übergabe" };
    if (!isAccepted(row, now) && row.windowEndsAt) return { status: "im_fenster" as const, info: `angenommen ab ${row.windowEndsAt.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}` };
    return { status: "angenommen" as const, info: "" };
  };
  return {
    chain: { id: chain.id, name: chain.name, categoryId: chain.categoryId, categoryName: category?.name ?? "–", orderId: chain.orderId, priority: chain.priority, sellTarget: chain.sellTarget, dailyCap: chain.dailyCap, totalCap: chain.totalCap, status: chain.status, exhaustedAction: chain.exhaustedAction, exhaustedOverrides: Array.isArray(chain.exhaustedOverrides) ? (chain.exhaustedOverrides as Array<{ supplierId: number; action: "return" | "release" }>) : [], country: chain.country, supplierFilterMode: chain.supplierFilterMode, supplierIds: Array.isArray(chain.supplierIds) ? (chain.supplierIds as unknown[]).map(Number) : [] },
    stops: stops.map((stop) => {
      const buyer = pickers.buyers.find((item) => item.userId === stop.buyerUserId);
      const stopRows = rows.filter((row) => row.stopId === stop.id);
      const stopAll = allRows.filter((row) => row.stopId === stop.id);
      return { id: stop.id, position: stop.position, buyerName: stop.buyerName, buyerUserId: stop.buyerUserId, buyerLabel: buyer?.label ?? stop.buyerName, buyerCompany: buyer?.company ?? stop.buyerName, buyerContact: buyer?.contact ?? "", api: buyer?.api ?? false, endpoint: buyer?.endpoint ?? null, membershipId: buyer?.membershipId ?? null, unitPrice: stop.unitPrice, reclamationWindowHours: stop.reclamationWindowHours, maxLeads: stop.maxLeads, active: stop.active, geoCountry: stop.geoCountry, geoMode: stop.geoMode, geoValues: Array.isArray(stop.geoValues) ? (stop.geoValues as unknown[]).map(String) : [], fieldFilters: Array.isArray(stop.fieldFilters) ? (stop.fieldFilters as FieldFilter[]) : [], excludedSupplierIds: Array.isArray(stop.excludedSupplierIds) ? (stop.excludedSupplierIds as unknown[]).map(Number) : [], excludedBuyerUserIds: Array.isArray(stop.excludedBuyerUserIds) ? (stop.excludedBuyerUserIds as unknown[]).map(Number) : [], excludeAutomationDuplicates: stop.excludeAutomationDuplicates, phoneFilter: stop.phoneFilter, maxLeadAgeMinutes: stop.maxLeadAgeMinutes, stats: summarize(stopRows, now), lifetime: summarize(stopAll, now), rules: reasons.map((reason) => { const rule = rules.find((item) => item.stopId === stop.id && item.reasonId === reason.id); return { reasonId: reason.id, name: reason.name, allowed: rule?.allowed ?? true, passOn: rule?.passOn ?? reason.forwardToNextStop }; }), activity: { total: stopRows.length, recent: stopRows.slice(0, 10).map((row) => { const lead = leadRows.find((item) => item.id === row.leadId); const state = describe(row); return { deliveryId: row.id, leadId: row.leadId, publicId: lead?.publicId ?? "", name: lead ? `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || lead.publicId : `Lead #${row.leadId}`, city: lead?.city ?? "", status: state.status, info: state.info, occurredAt: row.occurredAt }; }) } };
    }),
    activity: { delivered: rows.filter((row) => row.result !== "übersprungen").length, inTransit: rows.filter((row) => row.result === "angenommen" && !isAccepted(row, now)).length },
    reasons,
    buyers: pickers.buyers,
    suppliers: pickers.suppliers,
  };
}

/** Alle Lieferungen eines Stops („Alle N anzeigen“). */
export async function stopDeliveries(db: Db, tenantId: number, stopId: number, range: ChainRange, limit = 200) {
  const stop = (await db.select({ chainId: deliveryStops.chainId }).from(deliveryStops).innerJoin(deliveryChains, eq(deliveryChains.id, deliveryStops.chainId)).where(and(eq(deliveryStops.id, stopId), eq(deliveryChains.tenantId, tenantId))).limit(1))[0];
  if (!stop) throw new Error("Stop wurde nicht gefunden.");
  const rows = (await deliveriesFor(db, tenantId, [stop.chainId], range)).filter((row) => row.stopId === stopId).slice(0, limit);
  const leadIds = Array.from(new Set(rows.map((row) => row.leadId)));
  const leadRows = leadIds.length ? await db.select({ id: leads.id, publicId: leads.publicId, firstName: leads.firstName, lastName: leads.lastName, city: leads.city }).from(leads).where(inArray(leads.id, leadIds)) : [];
  const now = new Date();
  return rows.map((row) => { const lead = leadRows.find((item) => item.id === row.leadId); const status = row.result === "angenommen" && !isAccepted(row, now) ? "im_fenster" : row.result; return { deliveryId: row.id, leadId: row.leadId, publicId: lead?.publicId ?? "", name: lead ? `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || lead.publicId : `Lead #${row.leadId}`, city: lead?.city ?? "", status, info: row.result === "übersprungen" ? row.skipReason ?? "" : status === "im_fenster" ? `angenommen ab ${row.windowEndsAt!.toLocaleString("de-DE")}` : "", occurredAt: row.occurredAt }; });
}

/** Stop hinzufügen: Käufer-Konto (Name = Firma — Ansprechpartner) oder freier Käufername; Position = ans Ende. */
export async function addStop(db: Db, tenantId: number, input: { chainId: number; buyerUserId?: number | null; buyerName?: string | null; unitPrice: number; reclamationWindowHours?: number; maxLeads?: number | null }) {
  const chain = (await db.select({ id: deliveryChains.id }).from(deliveryChains).where(and(eq(deliveryChains.id, input.chainId), eq(deliveryChains.tenantId, tenantId))).limit(1))[0];
  if (!chain) throw new Error("Lieferkette wurde nicht gefunden.");
  let buyerName = (input.buyerName ?? "").trim();
  if (input.buyerUserId) { const buyer = (await db.select({ name: users.name, company: users.company }).from(users).innerJoin(memberships, eq(memberships.userId, users.id)).where(and(eq(users.id, input.buyerUserId), eq(memberships.tenantId, tenantId))).limit(1))[0]; if (!buyer) throw new Error("Käufer-Konto wurde nicht gefunden."); buyerName = buyerName || `${buyer.company ?? buyer.name ?? "Käufer"}`; }
  if (!buyerName) throw new Error("Bitte einen Käufer wählen oder einen Käufernamen angeben.");
  const existing = await db.select({ position: deliveryStops.position }).from(deliveryStops).where(eq(deliveryStops.chainId, chain.id));
  const position = existing.length ? Math.max(...existing.map((row) => row.position)) + 1 : 1;
  const inserted = await db.insert(deliveryStops).values({ chainId: chain.id, buyerName, buyerUserId: input.buyerUserId ?? null, position, unitPrice: input.unitPrice.toFixed(2), reclamationWindowHours: input.reclamationWindowHours ?? 24, maxLeads: input.maxLeads ?? null });
  return { success: true, stopId: Number(inserted[0]?.insertId) || 0, position };
}

/** Reihenfolge der Stops neu setzen (Drag & Drop / Pfeile); Positionen werden 1..n durchnummeriert. */
export async function reorderStops(db: Db, tenantId: number, chainId: number, stopIds: number[]) {
  const stops = await db.select({ id: deliveryStops.id }).from(deliveryStops).innerJoin(deliveryChains, eq(deliveryChains.id, deliveryStops.chainId)).where(and(eq(deliveryStops.chainId, chainId), eq(deliveryChains.tenantId, tenantId)));
  const known = new Set(stops.map((stop) => stop.id));
  const ordered = stopIds.filter((id) => known.has(id)); for (const stop of stops) if (!ordered.includes(stop.id)) ordered.push(stop.id);
  await db.transaction(async (tx) => {
    for (let index = 0; index < ordered.length; index += 1) await tx.update(deliveryStops).set({ position: 1000 + index }).where(eq(deliveryStops.id, ordered[index]));
    for (let index = 0; index < ordered.length; index += 1) await tx.update(deliveryStops).set({ position: index + 1 }).where(eq(deliveryStops.id, ordered[index]));
  });
  return { success: true, order: ordered };
}

/** Reklamationsgründe eines Stops speichern (Erlaubt / Bei Reklamation weitergeben). */
export async function saveStopRules(db: Db, tenantId: number, stopId: number, rules: StopRuleInput[]) {
  const stop = (await db.select({ id: deliveryStops.id }).from(deliveryStops).innerJoin(deliveryChains, eq(deliveryChains.id, deliveryStops.chainId)).where(and(eq(deliveryStops.id, stopId), eq(deliveryChains.tenantId, tenantId))).limit(1))[0];
  if (!stop) throw new Error("Stop wurde nicht gefunden.");
  await db.transaction(async (tx) => {
    await tx.delete(deliveryStopReasons).where(eq(deliveryStopReasons.stopId, stopId));
    if (rules.length) await tx.insert(deliveryStopReasons).values(rules.map((rule) => ({ stopId, reasonId: rule.reasonId, allowed: rule.allowed, passOn: rule.passOn })));
  });
  return { success: true };
}

export async function deleteStop(db: Db, tenantId: number, stopId: number) {
  const stop = (await db.select({ id: deliveryStops.id, chainId: deliveryStops.chainId }).from(deliveryStops).innerJoin(deliveryChains, eq(deliveryChains.id, deliveryStops.chainId)).where(and(eq(deliveryStops.id, stopId), eq(deliveryChains.tenantId, tenantId))).limit(1))[0];
  if (!stop) throw new Error("Stop wurde nicht gefunden.");
  await db.delete(deliveryStopReasons).where(eq(deliveryStopReasons.stopId, stopId));
  await db.delete(deliveryStops).where(eq(deliveryStops.id, stopId));
  const remaining = await db.select({ id: deliveryStops.id }).from(deliveryStops).where(eq(deliveryStops.chainId, stop.chainId)).orderBy(deliveryStops.position);
  await reorderStops(db, tenantId, stop.chainId, remaining.map((row) => row.id));
  return { success: true };
}

export async function deleteChain(db: Db, tenantId: number, chainId: number) {
  const chain = (await db.select({ id: deliveryChains.id }).from(deliveryChains).where(and(eq(deliveryChains.id, chainId), eq(deliveryChains.tenantId, tenantId))).limit(1))[0];
  if (!chain) throw new Error("Lieferkette wurde nicht gefunden.");
  const stops = await db.select({ id: deliveryStops.id }).from(deliveryStops).where(eq(deliveryStops.chainId, chainId));
  if (stops.length) await db.delete(deliveryStopReasons).where(inArray(deliveryStopReasons.stopId, stops.map((stop) => stop.id)));
  await db.delete(deliveryStops).where(eq(deliveryStops.chainId, chainId));
  await db.delete(deliveryChains).where(eq(deliveryChains.id, chainId));
  return { success: true };
}
