/**
 * Vorschau: Beispieldaten für die Statistik „Integrationen“ – vier Partnerkonten, wie sie in der Praxis vorkommen
 * (abgerufen, mit Direkt-Einlieferungen an der Haustür, selbst meldend, ohne Zugang). Alle Namen und Zahlen sind erfunden;
 * die Zustellungen hängen an den Leads der Vorschau, damit die Kontakte auf echte Lead-Seiten führen.
 */
import type { ReportAccount, ReportDelivery, ReportTransaction } from "../../../shared/partner-report";

const REASONS = ["Falsche Kontaktdaten", "Kaufwunsch bereits erloschen", "Erinnerungsmail", "Kein Eigentümer", "Anderer Grund"];
const CATEGORIES = ["solaranlagen", "heizung", "waermepumpe"];
/** Fester Zufall je Zahl – dieselbe Vorschau bei jedem Laden. */
const pick = (seed: number) => { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); };

export function samplePartnerData(leads: Array<{ id: number; categoryId: number | null }>, now = new Date()): { accounts: ReportAccount[]; deliveries: ReportDelivery[]; transactions: ReportTransaction[] } {
  const ago = (days: number, hours = 0) => new Date(now.getTime() - days * 86_400_000 - hours * 3_600_000);
  const accounts: ReportAccount[] = [
    { id: 9001, provider: "aroundhome", label: "Account 1", buyerName: "Aroundhome GmbH", mode: "pull", hasAccess: true, lastSyncAt: ago(0, 0.02), lastSyncNote: "Abgleich abgeschlossen" },
    { id: 9002, provider: "aroundhome", label: "D2D Account", buyerName: "Aroundhome GmbH", mode: "pull", hasAccess: true, lastSyncAt: ago(0, 0.03), lastSyncNote: "Abgleich abgeschlossen" },
    { id: 9003, provider: "wattfox", label: null, buyerName: "Nordlicht Energie", mode: "push", hasAccess: true, lastSyncAt: null, lastSyncNote: null },
    { id: 9004, provider: "leadnodes", label: null, buyerName: "Helios Solar", mode: "none", hasAccess: false, lastSyncAt: null, lastSyncNote: null },
  ];
  const deliveries: ReportDelivery[] = []; const transactions: ReportTransaction[] = []; let txId = 0;
  const sorted = leads.slice().sort((a, b) => a.id - b.id);
  sorted.forEach((lead, index) => {
    const roll = pick(lead.id); const accountId = index % 5 === 4 ? 9004 : index % 3 === 2 ? 9003 : 9001; const day = Math.floor(pick(lead.id + 7) * 27) + 1;
    const rejected = roll < 0.16;
    deliveries.push({ accountId, leadId: lead.id, buyerName: accountId === 9001 ? (index % 7 === 0 ? "Aroundhome Regional" : "Aroundhome GmbH") : accountId === 9003 ? "Nordlicht Energie" : "Helios Solar", categoryId: lead.categoryId, deliveredAt: ago(day, Math.floor(roll * 9)), result: rejected ? "rejected" : "accepted" });
    if (rejected || accountId === 9004 || roll > 0.97) return; // abgelehnt, ohne Rückkanal oder (noch) ohne Rückmeldung
    const state = pick(lead.id + 3); const status: ReportTransaction["status"] = state < 0.3 ? "confirmed" : state < 0.82 ? "cancelled" : "open";
    const decided = status === "open" ? null : ago(Math.max(0, day - 2), 3);
    transactions.push({ id: (txId += 1), accountId, leadId: lead.id, status, transactionAt: ago(day, 0), processedAt: decided, paidAt: status === "confirmed" && state < 0.06 ? ago(Math.max(0, day - 3)) : null, commission: status === "confirmed" ? Math.round((78 + pick(lead.id + 11) * 34) * 100) / 100 : 0,
      campaignId: accountId === 9001 ? "20418" : null, campaignName: accountId === 9001 ? "Solar & Wärme Herbst" : null, partnerCategory: accountId === 9003 ? null : CATEGORIES[Math.floor(pick(lead.id + 5) * CATEGORIES.length)], subId: null,
      cancelReason: status === "cancelled" ? (accountId === 9003 ? ["INVALID_OTHER", "INVALID_CONTACT", "DUPLICATE"][Math.floor(pick(lead.id + 9) * 3)] : REASONS[Math.floor(pick(lead.id + 9) * REASONS.length)]) : null });
  });
  // Haustür: Kontakte, die direkt beim Partner angelegt wurden – ohne unsere Zustellung, nur Referenz, Status und Sub-ID des Vertrieblers
  for (let index = 0; index < 46; index += 1) {
    const state = pick(index + 500); const status: ReportTransaction["status"] = state < 0.36 ? "confirmed" : state < 0.9 ? "cancelled" : "open"; const day = Math.floor(pick(index + 900) * 14) + 1;
    transactions.push({ id: (txId += 1), accountId: 9002, leadId: null, status, transactionAt: ago(day, 2), processedAt: status === "open" ? null : ago(Math.max(0, day - 1)), paidAt: status === "confirmed" && state < 0.08 ? ago(Math.max(0, day - 1)) : null, commission: status === "confirmed" ? 98 + Math.round(pick(index + 40) * 12) : 0, campaignId: "20977", campaignName: "Haustür Solar", partnerCategory: "solaranlagen", subId: `vertrieb-${String((index % 6) + 1).padStart(2, "0")}`, cancelReason: status === "cancelled" ? REASONS[index % REASONS.length] : null });
  }
  return { accounts, deliveries, transactions };
}
