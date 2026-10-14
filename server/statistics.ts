export type StatisticsLead = {
  status: "neu" | "genehmigt" | "zugewiesen" | "reklamiert" | "fehlerhaft" | "deaktiviert" | "hängend";
  cost: number;
  createdAt: Date;
  categoryId: number;
  supplierId: number | null;
  email?: string | null;
  phone?: string | null;
};

export type StatisticsFilter = {
  from?: Date;
  until?: Date;
  categoryId?: number;
  supplierId?: number;
};

export function filterStatisticsLeads(leads: StatisticsLead[], filter: StatisticsFilter) {
  return leads.filter((lead) => {
    if (filter.from && lead.createdAt < filter.from) return false;
    if (filter.until && lead.createdAt > filter.until) return false;
    if (filter.categoryId && lead.categoryId !== filter.categoryId) return false;
    if (filter.supplierId && lead.supplierId !== filter.supplierId) return false;
    return true;
  });
}

export function computeStatistics(leads: StatisticsLead[]) {
  const assigned = leads.filter((lead) => lead.status === "zugewiesen" || lead.status === "reklamiert");
  const accepted = leads.filter((lead) => lead.status === "zugewiesen");
  const claimed = leads.filter((lead) => lead.status === "reklamiert");
  const pending = leads.filter((lead) => lead.status === "neu" || lead.status === "genehmigt" || lead.status === "hängend");
  const rejected = leads.filter((lead) => lead.status === "fehlerhaft" || lead.status === "reklamiert");
  const revenue = accepted.reduce((sum, lead) => sum + lead.cost, 0);
  const fingerprints = new Map<string, number>();
  for (const lead of leads) {
    const email = lead.email?.trim().toLowerCase();
    const phone = lead.phone?.replace(/\D/g, "");
    const fingerprint = email ? `email:${email}` : phone ? `phone:${phone}` : undefined;
    if (fingerprint) fingerprints.set(fingerprint, (fingerprints.get(fingerprint) ?? 0) + 1);
  }
  const duplicates = leads.filter((lead) => {
    const email = lead.email?.trim().toLowerCase();
    const phone = lead.phone?.replace(/\D/g, "");
    const fingerprint = email ? `email:${email}` : phone ? `phone:${phone}` : undefined;
    return Boolean(fingerprint && (fingerprints.get(fingerprint) ?? 0) > 1);
  }).length;
  return {
    delivered: leads.length,
    assigned: assigned.length,
    accepted: accepted.length,
    claimed: claimed.length,
    pending: pending.length,
    rejected: rejected.length,
    revenue,
    duplicates,
    acceptanceRate: assigned.length ? accepted.length / assigned.length : 0,
    claimRate: assigned.length ? claimed.length / assigned.length : 0,
  };
}

export type StatisticsDelivery = { leadId: number; buyerName: string; supplierName: string | null; chainName: string | null; stopName: string | null; result: "angeboten" | "angenommen" | "abgelehnt" | "übersprungen" | "reklamiert"; unitPrice: number };

type StatisticsRow = { name: string; assigned: number; accepted: number; claimed: number; revenue: number; delivered?: number; sold?: number; offered?: number; open?: number; rejected?: number; skipped?: number };

const row = (name: string): StatisticsRow => ({ name, assigned: 0, accepted: 0, claimed: 0, revenue: 0 });

export function computeOperationsStatistics(deliveries: StatisticsDelivery[], claimedLeadIds: Set<number>) {
  const buyers = new Map<string, StatisticsRow>();
  const suppliers = new Map<string, StatisticsRow>();
  const chains = new Map<string, StatisticsRow>();
  const seenClaimByBuyer = new Set<string>();
  const seenClaimBySupplier = new Set<string>();
  const seenClaimByChain = new Set<string>();
  for (const delivery of deliveries) {
    const buyer = buyers.get(delivery.buyerName) ?? row(delivery.buyerName); buyer.assigned++; if (delivery.result === "angenommen") { buyer.accepted++; buyer.revenue += delivery.unitPrice; } if (claimedLeadIds.has(delivery.leadId) && !seenClaimByBuyer.has(`${buyer.name}:${delivery.leadId}`)) { buyer.claimed++; seenClaimByBuyer.add(`${buyer.name}:${delivery.leadId}`); } buyers.set(buyer.name, buyer);
    const supplierName = delivery.supplierName ?? "Ohne Lieferant"; const supplier = suppliers.get(supplierName) ?? { ...row(supplierName), delivered: 0, sold: 0 }; supplier.delivered = (supplier.delivered ?? 0) + 1; if (delivery.result === "angenommen") { supplier.sold = (supplier.sold ?? 0) + 1; supplier.revenue += delivery.unitPrice; } if (claimedLeadIds.has(delivery.leadId) && !seenClaimBySupplier.has(`${supplier.name}:${delivery.leadId}`)) { supplier.claimed++; seenClaimBySupplier.add(`${supplier.name}:${delivery.leadId}`); } suppliers.set(supplier.name, supplier);
    const chainName = delivery.chainName ? `${delivery.chainName}${delivery.stopName ? ` · ${delivery.stopName}` : ""}` : "Direkte Auslieferung"; const chain = chains.get(chainName) ?? { ...row(chainName), offered: 0, open: 0, rejected: 0, skipped: 0 }; chain.offered = (chain.offered ?? 0) + 1; if (delivery.result === "angenommen") { chain.accepted++; chain.revenue += delivery.unitPrice; } if (delivery.result === "angeboten") chain.open = (chain.open ?? 0) + 1; if (delivery.result === "abgelehnt") chain.rejected = (chain.rejected ?? 0) + 1; if (delivery.result === "übersprungen") chain.skipped = (chain.skipped ?? 0) + 1; if (claimedLeadIds.has(delivery.leadId) && !seenClaimByChain.has(`${chain.name}:${delivery.leadId}`)) { chain.claimed++; seenClaimByChain.add(`${chain.name}:${delivery.leadId}`); } chains.set(chain.name, chain);
  }
  return { buyers: Array.from(buyers.values()), suppliers: Array.from(suppliers.values()), chains: Array.from(chains.values()) };
}

export type StatisticsIntegrationEvent = { integrationId: number; eventType: "geliefert" | "abgelehnt" | "angenommen" | "offen" | "anerkannt" | "storniert" };
export function computeIntegrationStatistics(events: StatisticsIntegrationEvent[]) {
  const grouped: Record<number, { integrationId: number; delivered: number; rejected: number; accepted: number; open: number; approved: number; cancelled: number }> = {};
  for (const event of events) { const row = grouped[event.integrationId] ?? { integrationId: event.integrationId, delivered: 0, rejected: 0, accepted: 0, open: 0, approved: 0, cancelled: 0 }; if (event.eventType === "geliefert") row.delivered++; if (event.eventType === "abgelehnt") row.rejected++; if (event.eventType === "angenommen") row.accepted++; if (event.eventType === "offen") row.open++; if (event.eventType === "anerkannt") row.approved++; if (event.eventType === "storniert") row.cancelled++; grouped[event.integrationId] = row; }
  return Object.values(grouped);
}

export type HourlyDeliveryEvent = { occurredAt: Date; result: "angeboten" | "angenommen" | "abgelehnt" | "übersprungen" | "reklamiert"; categoryId: number | null };
export type HourlyBreakdown = { category: string; buyer: string; count: number; result: "geliefert" | "abgelehnt" };
/** Stundenverlauf: je Stunde Angebote/Annahmen – plus Aufschlüsselung „welche Sparte an welchen Kunden“. */
export function computeHourlyDeliverySeries(events: Array<HourlyDeliveryEvent & { categoryName?: string | null; buyerName?: string | null }>, from: Date, categoryId?: number, until?: Date) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, offered: 0, accepted: 0, rejected: 0, breakdown: [] as HourlyBreakdown[] }));
  for (const event of events) {
    if (event.occurredAt < from || (until && event.occurredAt > until) || (categoryId && event.categoryId !== categoryId)) continue; // „Bis“ zählt für eigene Zeiträume und abgeschlossene Wochen
    const bucket = buckets[event.occurredAt.getHours()];
    if (!bucket) continue;
    if (event.result === "angeboten") bucket.offered += 1;
    if (event.result === "angenommen") bucket.accepted += 1;
    if (event.result === "abgelehnt") bucket.rejected += 1; // PrePing / Käufer-Ablehnung
    if (event.result === "angeboten" || event.result === "angenommen" || event.result === "abgelehnt") {
      const category = event.categoryName ?? "Ohne Kategorie"; const buyer = event.buyerName ?? "Unbekannt"; const result = event.result === "abgelehnt" ? "abgelehnt" : "geliefert";
      const entry = bucket.breakdown.find((item) => item.category === category && item.buyer === buyer && item.result === result);
      if (entry) entry.count += 1; else bucket.breakdown.push({ category, buyer, count: 1, result });
    }
  }
  for (const bucket of buckets) bucket.breakdown.sort((a, b) => b.count - a.count);
  return buckets;
}

export type DistributionEvent = { occurredAt: Date; result: string; unitPrice: string | number | null; categoryId: number | null; categoryName: string | null; categoryColor?: string | null; supplierName: string | null; buyerName: string };
/** Verteilung Lieferant → Käufer je Sparte: wie viele Leads wurden angenommen (und angeboten), welcher Umsatz. */
export function computeDeliveryDistribution(events: DistributionEvent[], options: { from?: Date; until?: Date; categoryId?: number } = {}) {
  const grouped = new Map<string, { supplierName: string; buyerName: string; categoryId: number | null; categoryName: string; categoryColor: string | null; delivered: number; offered: number; revenue: number }>();
  for (const event of events) {
    if (options.from && event.occurredAt < options.from) continue; if (options.until && event.occurredAt > options.until) continue; if (options.categoryId && event.categoryId !== options.categoryId) continue;
    if (event.result !== "angenommen" && event.result !== "angeboten") continue;
    const supplierName = event.supplierName ?? "Ohne Lieferant"; const categoryName = event.categoryName ?? "Ohne Kategorie";
    const key = `${supplierName}|${event.buyerName}|${event.categoryId ?? "x"}`;
    const current = grouped.get(key) ?? { supplierName, buyerName: event.buyerName, categoryId: event.categoryId, categoryName, categoryColor: event.categoryColor ?? null, delivered: 0, offered: 0, revenue: 0 };
    if (event.result === "angenommen") { current.delivered += 1; current.revenue += Number(event.unitPrice ?? 0); } else current.offered += 1;
    grouped.set(key, current);
  }
  const rows = Array.from(grouped.values()).sort((a, b) => b.delivered - a.delivered || b.offered - a.offered || a.supplierName.localeCompare(b.supplierName));
  return { rows, totals: { delivered: rows.reduce((sum, row) => sum + row.delivered, 0), offered: rows.reduce((sum, row) => sum + row.offered, 0), revenue: rows.reduce((sum, row) => sum + row.revenue, 0), suppliers: new Set(rows.map((row) => row.supplierName)).size, buyers: new Set(rows.map((row) => row.buyerName)).size } };
}
