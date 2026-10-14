import { describe, expect, it } from "vitest";
import { computeDeliveryDistribution, computeHourlyDeliverySeries, computeIntegrationStatistics, computeOperationsStatistics, computeStatistics, filterStatisticsLeads, type StatisticsLead } from "./statistics";

const fixture: StatisticsLead[] = [
  { status: "zugewiesen", cost: 42, createdAt: new Date("2026-08-10T10:00:00Z"), categoryId: 1, supplierId: 3 },
  { status: "reklamiert", cost: 35, createdAt: new Date("2026-08-11T10:00:00Z"), categoryId: 1, supplierId: 3 },
  { status: "genehmigt", cost: 0, createdAt: new Date("2026-08-12T10:00:00Z"), categoryId: 2, supplierId: 4 },
];

describe("statistics", () => {
  it("berechnet Annahme-, Reklamations- und Umsatzkennzahlen aus entschiedenen Zustellungen", () => {
    expect(computeStatistics(fixture)).toMatchObject({ delivered: 3, assigned: 2, accepted: 1, claimed: 1, pending: 1, rejected: 1, revenue: 42, acceptanceRate: 0.5, claimRate: 0.5 });
  });

  it("zählt wiederkehrende E-Mail-Adressen als Dubletten", () => {
    const result = computeStatistics([{ ...fixture[0]!, email: "kontakt@beispiel.de" }, { ...fixture[1]!, email: " KONTAKT@BEISPIEL.DE " }, { ...fixture[2]!, email: "einmalig@beispiel.de" }]);
    expect(result.duplicates).toBe(2);
  });

  it("filtert nach Zeit, Kategorie und Lieferant", () => {
    const result = filterStatisticsLeads(fixture, { from: new Date("2026-08-11T00:00:00Z"), categoryId: 1, supplierId: 3 });
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("reklamiert");
  });

  it("aggregiert Käufer, Lieferanten und Ketten aus Auslieferungsereignissen", () => {
    const result = computeOperationsStatistics([{ leadId: 1, buyerName: "Käufer A", supplierName: "Quelle A", chainName: "Kette Nord", stopName: "Stop 1", result: "angenommen", unitPrice: 42 }, { leadId: 2, buyerName: "Käufer A", supplierName: "Quelle A", chainName: "Kette Nord", stopName: "Stop 1", result: "abgelehnt", unitPrice: 42 }, { leadId: 3, buyerName: "Käufer B", supplierName: null, chainName: null, stopName: null, result: "angeboten", unitPrice: 20 }], new Set([2]));
    expect(result.buyers).toContainEqual(expect.objectContaining({ name: "Käufer A", assigned: 2, accepted: 1, claimed: 1, revenue: 42 }));
    expect(result.suppliers).toContainEqual(expect.objectContaining({ name: "Quelle A", delivered: 2, sold: 1, claimed: 1 }));
    expect(result.chains).toContainEqual(expect.objectContaining({ name: "Kette Nord · Stop 1", offered: 2, accepted: 1, rejected: 1, revenue: 42 }));
  });

  it("aggregiert Zustell- und Bewertungsereignisse je Partnerintegration", () => {
    expect(computeIntegrationStatistics([{ integrationId: 2, eventType: "geliefert" }, { integrationId: 2, eventType: "angenommen" }, { integrationId: 2, eventType: "anerkannt" }, { integrationId: 3, eventType: "geliefert" }, { integrationId: 3, eventType: "abgelehnt" }])).toEqual(expect.arrayContaining([{ integrationId: 2, delivered: 1, rejected: 0, accepted: 1, open: 0, approved: 1, cancelled: 0 }, { integrationId: 3, delivered: 1, rejected: 1, accepted: 0, open: 0, approved: 0, cancelled: 0 }]));
  });

  it("verteilt Lieferant → Kunde je Sparte (Dashboard-Verteilung)", () => {
    const result = computeDeliveryDistribution([
      { occurredAt: new Date("2026-08-17T08:15:00"), result: "angenommen", unitPrice: "40.00", categoryId: 1, categoryName: "Photovoltaik", supplierName: "Flux Ads", buyerName: "Nordlicht Energie" },
      { occurredAt: new Date("2026-08-17T09:15:00"), result: "angenommen", unitPrice: "40.00", categoryId: 1, categoryName: "Photovoltaik", supplierName: "Flux Ads", buyerName: "Nordlicht Energie" },
      { occurredAt: new Date("2026-08-17T10:15:00"), result: "angeboten", unitPrice: "40.00", categoryId: 2, categoryName: "Wärmepumpe", supplierName: "Flux Ads", buyerName: "Sabine Krüger" },
      { occurredAt: new Date("2026-08-17T11:15:00"), result: "abgelehnt", unitPrice: "40.00", categoryId: 1, categoryName: "Photovoltaik", supplierName: "Orbit", buyerName: "Nordlicht Energie" },
    ], { from: new Date("2026-08-17T00:00:00") });
    expect(result.rows[0]).toMatchObject({ supplierName: "Flux Ads", buyerName: "Nordlicht Energie", categoryName: "Photovoltaik", delivered: 2, offered: 0, revenue: 80 });
    expect(result.rows[1]).toMatchObject({ supplierName: "Flux Ads", buyerName: "Sabine Krüger", categoryName: "Wärmepumpe", delivered: 0, offered: 1 });
    expect(result.totals).toMatchObject({ delivered: 2, offered: 1, revenue: 80, suppliers: 1, buyers: 2 });
  });
  it("aggregiert den Dashboard-Stundenverlauf nach Zeit und Kategorie", () => {
    const series = computeHourlyDeliverySeries([{ occurredAt: new Date("2026-08-17T08:15:00"), result: "angeboten", categoryId: 1 }, { occurredAt: new Date("2026-08-17T08:45:00"), result: "angenommen", categoryId: 1 }, { occurredAt: new Date("2026-08-17T09:00:00"), result: "angeboten", categoryId: 2 }, { occurredAt: new Date("2026-08-16T09:00:00"), result: "angeboten", categoryId: 1 }], new Date("2026-08-17T00:00:00"), 1);
    expect(series[8]).toMatchObject({ hour: 8, offered: 1, accepted: 1 });
    expect(series[8].breakdown).toEqual([{ category: "Ohne Kategorie", buyer: "Unbekannt", count: 2, result: "geliefert" }]); // Aufschlüsselung Sparte → Kunde
    expect(series[9]).toMatchObject({ hour: 9, offered: 0, accepted: 0, rejected: 0, breakdown: [] });
  });
  it("beachtet im Stundenverlauf auch das Enddatum (eigener Zeitraum)", () => {
    const events = [{ occurredAt: new Date("2026-08-15T10:00:00"), result: "angenommen" as const, categoryId: 1 }, { occurredAt: new Date("2026-08-16T10:00:00"), result: "angenommen" as const, categoryId: 1 }, { occurredAt: new Date("2026-08-17T10:00:00"), result: "angenommen" as const, categoryId: 1 }];
    const series = computeHourlyDeliverySeries(events, new Date("2026-08-15T00:00:00"), undefined, new Date("2026-08-16T23:59:59.999"));
    expect(series[10].accepted).toBe(2); // der 17.8. liegt nach „Bis“
    expect(computeHourlyDeliverySeries(events, new Date("2026-08-15T00:00:00"))[10].accepted).toBe(3); // ohne „Bis“ wie bisher
  });
});
