import { describe, expect, it } from "vitest";
import { activeQuickRange, berlinBound, berlinDay, buildPartnerReport, contactStatus, euro, listPartnerContacts, quickRange, share, type ReportAccount, type ReportDelivery, type ReportFilter, type ReportTransaction } from "../shared/partner-report";

/** Statistik „Integrationen“ – die Rechenproben aus dem Blueprint vom 26.11.2026 (Zahlen dort, Datensätze hier erzeugt). */
const account: ReportAccount = { id: 1, provider: "aroundhome", label: "Account 1", buyerName: "Aroundhome GmbH", mode: "pull", hasAccess: true, lastSyncAt: null, lastSyncNote: null };
const at = (day: string, hour = 12) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00+01:00`);
const filter = (from: string, to: string, basis: ReportFilter["basis"] = "delivery", categoryId?: number): ReportFilter => ({ from: berlinBound(from), until: berlinBound(to, true), basis, categoryId });

/** 6035 Zustellungen: 1009 abgelehnt, 5026 angenommen – davon 587 offen, 1393 anerkannt (62 ausgezahlt), 3007 storniert, 39 ohne Rückmeldung. Provision 129.630,60 €. */
function accountOne() {
  const deliveries: ReportDelivery[] = []; const transactions: ReportTransaction[] = []; let lead = 0;
  const push = (result: ReportDelivery["result"], status: ReportTransaction["status"] | null, extra: Partial<ReportTransaction> = {}) => {
    lead += 1; deliveries.push({ accountId: 1, leadId: lead, buyerName: lead % 7 === 0 ? "Zweitkäufer GmbH" : "Aroundhome GmbH", categoryId: lead % 2 ? 1 : 2, deliveredAt: at("2026-11-10"), result });
    if (status) transactions.push({ id: lead, accountId: 1, leadId: lead, status, transactionAt: at("2026-11-11"), processedAt: status === "open" ? null : at("2026-11-15"), paidAt: null, commission: 0, campaignId: "4711", campaignName: "Solar Herbst", partnerCategory: lead % 3 ? "solaranlagen" : "heizung", subId: null, cancelReason: null, ...extra });
  };
  for (let i = 0; i < 1009; i += 1) push("rejected", null);
  for (let i = 0; i < 587; i += 1) push("accepted", "open");
  for (let i = 0; i < 1393; i += 1) push("accepted", "confirmed", { commission: i === 1392 ? 91.08 : 93.06, paidAt: i < 62 ? at("2026-11-20") : null });
  for (let i = 0; i < 3007; i += 1) push("accepted", "cancelled", { cancelReason: i < 617 ? "Erinnerungsmail" : i < 617 + 517 ? "Falsche Kontaktdaten" : "Anderer Grund" });
  for (let i = 0; i < 39; i += 1) push("accepted", null);
  return { deliveries, transactions };
}

describe("Statistik Integrationen – Kennzahlen", () => {
  const data = accountOne();
  it("Rechenprobe Account 1, 30 Tage nach Zustelldatum: alle Zähler, Quoten und die Provision", () => {
    const [card] = buildPartnerReport({ accounts: [account], ...data, filter: filter("2026-10-28", "2026-11-26") });
    expect(card.title).toBe("Aroundhome (Account 1)");
    expect(card.counts).toMatchObject({ delivered: 6035, rejected: 1009, accepted: 5026, open: 587, confirmed: 1393, paid: 62, cancelled: 3007, rated: 4987, silent: 39, commission: 129630.6 });
    const c = card.counts;
    expect(share(c.rejected, c.delivered)).toBe("16,7 %"); expect(share(c.accepted, c.delivered)).toBe("83,3 %"); expect(share(c.confirmed, c.delivered)).toBe("23,1 %"); // Gesamtquote
    expect(share(c.open, c.accepted)).toBe("11,7 %"); expect(share(c.confirmed, c.rated)).toBe("27,9 %"); expect(share(c.cancelled, c.rated)).toBe("60,3 %");
    expect(euro(c.commission)).toBe("129.630,60 €"); expect(euro(c.commission / c.confirmed)).toBe("93,06 €");
    // Käufer-Zeilen ergeben zusammen die Kacheln; Sparten beim Partner und Stornogründe ebenso
    expect(card.buyers.map((row) => row.buyerName)).toEqual(["Aroundhome GmbH", "Zweitkäufer GmbH"]); expect(card.buyers.reduce((sum, row) => sum + row.delivered, 0)).toBe(6035);
    expect(card.categories.reduce((sum, row) => sum + row.accepted, 0)).toBe(4987); expect(card.categories.reduce((sum, row) => sum + row.confirmed, 0)).toBe(1393); expect(card.categories[0].accepted).toBeGreaterThanOrEqual(card.categories[1].accepted);
    expect(card.campaigns).toEqual([{ name: "4711 · Solar Herbst", confirmed: 1393, paid: 62, commission: 129630.6 }]);
    expect(card.cancelReasons.slice(0, 2)).toEqual([{ reason: "Anderer Grund", count: 3007 - 617 - 517 }, { reason: "Erinnerungsmail", count: 617 }]); expect(card.cancelReasons.reduce((sum, row) => sum + row.count, 0)).toBe(3007);
    expect(card.direct).toBeNull(); expect(card.unmatched).toBe(0);
  });
  it("Zeitbasis: Transaktionsdatum zählt nur Leads mit Transaktion (abgelehnt 0), Bearbeitungsdatum nur entschiedene (offen 0), Auszahlungsdatum nur ausgezahlte", () => {
    const by = (basis: ReportFilter["basis"], from = "2026-10-28", to = "2026-11-26") => buildPartnerReport({ accounts: [account], ...data, filter: filter(from, to, basis) })[0].counts;
    expect(by("transaction")).toMatchObject({ delivered: 4987, rejected: 0, accepted: 4987, open: 587, confirmed: 1393, cancelled: 3007, silent: 0 });
    expect(by("processed")).toMatchObject({ delivered: 4400, rejected: 0, open: 0, confirmed: 1393, cancelled: 3007 });
    expect(by("paid")).toMatchObject({ delivered: 62, accepted: 62, confirmed: 62, paid: 62, cancelled: 0, commission: 62 * 93.06 });
    expect(by("paid", "2026-11-21", "2026-11-26").delivered).toBe(0); expect(by("delivery", "2026-11-11", "2026-11-26").delivered).toBe(0); // Zustellung war am 10.11.
    // Sparte: nur Zustellungen dieser eigenen Sparte
    const one = buildPartnerReport({ accounts: [account], ...data, filter: filter("2026-10-28", "2026-11-26", "delivery", 1) })[0].counts; const two = buildPartnerReport({ accounts: [account], ...data, filter: filter("2026-10-28", "2026-11-26", "delivery", 2) })[0].counts;
    expect(one.delivered + two.delivered).toBe(6035); expect(one.delivered).toBe(3018);
  });
  it("Leere Werte: Nenner 0 ergibt „—“, Zähler 0 ergibt „0,0 %“; ein Konto ohne Daten bleibt als Karte mit Nullen", () => {
    expect(share(0, 0)).toBe("—"); expect(share(0, 12)).toBe("0,0 %"); expect(share(1, 3)).toBe("33,3 %"); expect(share(2, 3)).toBe("66,7 %");
    const [empty] = buildPartnerReport({ accounts: [{ ...account, id: 9, label: null, provider: "leadnodes", mode: "none", hasAccess: false }], deliveries: [], transactions: [], filter: filter("2026-10-28", "2026-11-26") });
    expect(empty.title).toBe("Leadnodes"); expect(empty.counts).toMatchObject({ delivered: 0, accepted: 0, rated: 0, commission: 0 }); expect(empty.buyers).toEqual([]);
  });
  it("Direkt beim Partner eingeliefert (D2D): Transaktionen ohne Zustellung zählen in keinem Zähler – ihre Provision steckt in der Kachel; nach Sub-ID und nach Tag", () => {
    // 218 eingeliefert: 77 qualifiziert (35,3 %), 121 storniert (55,5 %), 20 offen – 16 Sub-IDs, 15 Tage, 7.612,00 € Provision
    const transactions: ReportTransaction[] = [];
    for (let i = 0; i < 218; i += 1) { const status = i < 77 ? "confirmed" : i < 198 ? "cancelled" : "open"; const day = `2026-11-${String(10 + (i % 15)).padStart(2, "0")}`;
      transactions.push({ id: i + 1, accountId: 2, leadId: null, status, transactionAt: at(day), processedAt: status === "open" ? null : at(day, 18), paidAt: status === "confirmed" && i < 10 ? at(day, 20) : null, commission: status === "confirmed" ? (i === 0 ? 108 : 98.7368421053) : 0, campaignId: null, campaignName: null, partnerCategory: "solaranlagen", subId: `rep-${(i % 16) + 1}`, cancelReason: null }); }
    const sum = transactions.reduce((total, tx) => total + tx.commission, 0); const scale = 7612 / sum; for (const tx of transactions) tx.commission *= scale;
    const [card] = buildPartnerReport({ accounts: [{ ...account, id: 2, label: "D2D Account" }], deliveries: [], transactions, filter: filter("2026-10-28", "2026-11-26") });
    expect(card.counts).toMatchObject({ delivered: 0, accepted: 0, confirmed: 0, commission: 7612 }); expect(card.unmatched).toBe(218); expect(card.unmatchedCommission).toBe(7612); expect(card.buyers).toEqual([]);
    expect(card.direct).toMatchObject({ total: 218, qualified: 77, cancelled: 121, open: 20 }); expect(share(77, 218)).toBe("35,3 %"); expect(share(121, 218)).toBe("55,5 %");
    expect(card.direct!.bySub).toHaveLength(16); expect(card.direct!.byDay).toHaveLength(15); expect(card.direct!.byDay[0].day).toBe("2026-11-24"); expect(card.direct!.bySub[0].total).toBeGreaterThanOrEqual(card.direct!.bySub[15].total);
    expect(card.direct!.byDay.reduce((total, day) => total + day.paid, 0)).toBe(10); expect(card.direct!.byDay.reduce((total, day) => total + day.confirmed + day.paid, 0)).toBe(77);
  });
  it("Status eines Kontakts und die Liste: Filter, Suche über alle Zeilen, Nachladen in Portionen", () => {
    expect(contactStatus({ result: "rejected" }, undefined)).toBe("rejected"); expect(contactStatus({ result: "accepted" }, undefined)).toBe("none"); expect(contactStatus({ result: "pending" }, undefined)).toBe("pending");
    expect(contactStatus({ result: "accepted" }, { status: "open", paidAt: null })).toBe("open"); expect(contactStatus({ result: "accepted" }, { status: "confirmed", paidAt: null })).toBe("confirmed");
    expect(contactStatus({ result: "accepted" }, { status: "confirmed", paidAt: at("2026-11-20") })).toBe("paid"); expect(contactStatus({ result: "accepted" }, { status: "cancelled", paidAt: null })).toBe("cancelled");
    const leads = data.deliveries.map((row) => ({ id: row.leadId, publicId: `L${row.leadId}`, name: row.leadId === 4000 ? "Petra Sommer" : `Kontakt ${row.leadId}`, city: row.leadId === 4000 ? "Gera" : "Kiel", categoryId: row.categoryId }));
    const list = (extra: Partial<Parameters<typeof listPartnerContacts>[0]> = {}) => listPartnerContacts({ accountId: 1, ...data, leads, filter: filter("2026-10-28", "2026-11-26"), ...extra });
    expect(list()).toMatchObject({ total: 6035 }); expect(list().rows).toHaveLength(50); expect(list({ offset: 50, limit: 100 }).rows).toHaveLength(100);
    // Rechenprobe: 1009 abgelehnt, 587 offen, 1331 bestätigt, 62 ausgezahlt, 3007 storniert – bestätigt + ausgezahlt = anerkannt (1393)
    expect([list({ status: "rejected" }).total, list({ status: "open" }).total, list({ status: "confirmed" }).total, list({ status: "paid" }).total, list({ status: "cancelled" }).total, list({ status: "none" }).total]).toEqual([1009, 587, 1331, 62, 3007, 39]);
    const found = list({ search: "sommer gera" }); expect(found.total).toBe(1); expect(found.rows[0]).toMatchObject({ publicId: "L4000", name: "Petra Sommer", status: "cancelled", cancelReason: "Falsche Kontaktdaten", commission: null });
    expect(list({ status: "paid" }).rows[0]).toMatchObject({ status: "paid", commission: 93.06, cancelReason: null });
  });
});

describe("Statistik Integrationen – Zeitraum", () => {
  it("Schnellwahl am Donnerstag, 26.11.2026 – wie im Blueprint", () => {
    const today = "2026-11-26";
    expect(quickRange("today", today)).toEqual({ from: "2026-11-26", to: "2026-11-26" }); expect(quickRange("yesterday", today)).toEqual({ from: "2026-11-25", to: "2026-11-25" });
    expect(quickRange("last7", today)).toEqual({ from: "2026-11-20", to: "2026-11-26" }); expect(quickRange("last30", today)).toEqual({ from: "2026-10-28", to: "2026-11-26" });
    expect(quickRange("week", today)).toEqual({ from: "2026-11-23", to: "2026-11-29" }); expect(quickRange("lastWeek", today)).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(quickRange("month", today)).toEqual({ from: "2026-11-01", to: "2026-11-30" }); expect(quickRange("lastMonth", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(quickRange("max", today)).toEqual({ from: "2020-01-01", to: "2026-11-26" }); expect(quickRange("lastMonth", "2027-01-15")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(activeQuickRange("2026-10-28", "2026-11-26", today)).toBe("last30"); expect(activeQuickRange("2026-10-27", "2026-11-26", today)).toBeNull();
  });
  it("Tagesgrenzen in deutscher Zeit – Winter- und Sommerzeit", () => {
    expect(berlinBound("2026-11-26").toISOString()).toBe("2026-11-25T23:00:00.000Z"); expect(berlinBound("2026-11-26", true).toISOString()).toBe("2026-11-26T22:59:59.999Z");
    expect(berlinBound("2026-07-01").toISOString()).toBe("2026-06-30T22:00:00.000Z"); expect(berlinDay(new Date("2026-11-25T23:30:00Z"))).toBe("2026-11-26");
  });
});

describe("Statistik Integrationen – Transaktionen aus dem Abgleich lesen", () => {
  it("Export des Partners: Status, Provision (deutsches oder englisches Format), Kampagne, Kategorie, Sub-ID und Zeitpunkte", async () => {
    const { parseTransactions, transactionStatus } = await import("./partner-accounts");
    const rows = parseTransactions(JSON.stringify({ transactions: [
      { uuid: "T-1", external_id: "L-100", status: "confirmed", commission: "93.06", campaign_id: 20418, campaign_name: "Solar Herbst", category: "solaranlagen", sub_id: "rep-3", created_at: "2026-11-11T09:00:00Z", processed_at: "2026-11-15T10:00:00Z", paid_at: "2026-11-20T08:00:00Z" },
      { uuid: "T-2", external_id: "L-101", status: "Storniert", cancellation_reason: "Falsche Kontaktdaten", provision: "0,00 €" },
      { uuid: "T-3", status: "open", commission: "1.234,50" },
    ] }));
    expect(rows.map((row) => [row.reference, transactionStatus(row), row.commission])).toEqual([["T-1", "confirmed", 93.06], ["T-2", "cancelled", 0], ["T-3", "open", 1234.5]]);
    expect(rows[0]).toMatchObject({ leadPublicId: "L-100", campaignId: "20418", campaignName: "Solar Herbst", category: "solaranlagen", subId: "rep-3", paidAt: "2026-11-20T08:00:00Z" }); expect(rows[1].reason).toBe("Falsche Kontaktdaten");
    expect(transactionStatus({ status: "ausgezahlt", paidAt: "" })).toBe("confirmed"); expect(transactionStatus({ status: "pending", paidAt: "2026-11-20" })).toBe("confirmed"); expect(transactionStatus({ status: "in Prüfung", paidAt: "" })).toBe("open");
  });
});
