import { describe, expect, it } from "vitest";
import { claimCounts, claimDay, claimDeadline, claimEventLabel, claimLeadName, claimStatusLabel, claimTone, claimedDelivery, claimsTable, restoredLeadStatus } from "../shared/claim-view";
import { tableCsv } from "../shared/table-export";

// Samstag, 21.11.2026, 20:55 Uhr deutscher Zeit
const now = new Date("2026-11-21T19:55:00Z");

describe("Reklamationen: Prüffrist in Worten", () => {
  it("läuft noch: Tage zählen nach dem Kalender in deutscher Zeit", () => {
    expect(claimDeadline({ dueAt: new Date("2026-11-25T11:00:00Z") }, now)).toEqual({ tone: "ok", text: "noch 4 Tage" });
    expect(claimDeadline({ dueAt: new Date("2026-11-23T11:00:00Z") }, now)).toEqual({ tone: "soon", text: "noch 2 Tage" });
    expect(claimDeadline({ dueAt: new Date("2026-11-22T11:00:00Z") }, now)).toEqual({ tone: "soon", text: "bis morgen" });
    expect(claimDeadline({ dueAt: new Date("2026-11-21T22:30:00Z") }, now)).toEqual({ tone: "soon", text: "heute fällig" }); // 23:30 Uhr deutscher Zeit, also noch heute
    // 23:30 Uhr UTC ist in Deutschland schon der nächste Tag
    expect(claimDeadline({ dueAt: new Date("2026-11-21T23:30:00Z") }, now)).toEqual({ tone: "soon", text: "bis morgen" });
  });
  it("vorbei: überfällig seit heute, gestern oder mehreren Tagen – auch als Text aus der Schnittstelle", () => {
    expect(claimDeadline({ dueAt: new Date("2026-11-21T11:00:00Z") }, now)).toEqual({ tone: "late", text: "seit heute überfällig" });
    expect(claimDeadline({ dueAt: new Date("2026-11-20T11:00:00Z") }, now)).toEqual({ tone: "late", text: "seit gestern überfällig" });
    expect(claimDeadline({ dueAt: "2026-11-16T11:00:00.000Z" }, now)).toEqual({ tone: "late", text: "seit 5 Tagen überfällig" });
  });
  it("entschieden schlägt die Frist; ohne Frist steht das da", () => {
    expect(claimDeadline({ dueAt: new Date("2026-11-10T11:00:00Z"), resolvedAt: new Date("2026-11-18T09:00:00Z") }, now)).toEqual({ tone: "done", text: "entschieden am 18.11.2026" });
    expect(claimDeadline({ dueAt: null }, now)).toEqual({ tone: "none", text: "ohne Frist" });
    expect(claimDay(new Date("2026-12-31T23:30:00Z"))).toBe("01.01.2027"); expect(claimDay(null)).toBe("");
  });
});

describe("Reklamationen: Zahlen der Leiste und der Reiter", () => {
  const claims = [
    { status: "offen", dueAt: new Date("2026-11-25T11:00:00Z"), resolvedAt: null },
    { status: "offen", dueAt: new Date("2026-11-20T11:00:00Z"), resolvedAt: null },
    { status: "in_prüfung", dueAt: new Date("2026-11-23T11:00:00Z"), resolvedAt: null },
    { status: "genehmigt", dueAt: new Date("2026-11-10T11:00:00Z"), resolvedAt: new Date("2026-11-11T09:00:00Z") },
    { status: "abgelehnt", dueAt: new Date("2026-11-10T11:00:00Z"), resolvedAt: new Date("2026-11-21T09:00:00Z") },
    { status: "abgelehnt", dueAt: null, resolvedAt: new Date("2026-11-21T09:00:00Z") },
  ];
  it("wartend = offen + in Prüfung; überfällig nur, was noch wartet; Quote aus den entschiedenen", () => {
    expect(claimCounts(claims, now)).toEqual({ alle: 6, offen: 2, in_prüfung: 1, genehmigt: 1, abgelehnt: 2, wartend: 3, überfällig: 1, entschieden: 3, genehmigtQuote: 33 });
  });
  it("ohne Entscheidung gibt es keine Quote", () => {
    expect(claimCounts(claims.slice(0, 3), now).genehmigtQuote).toBeNull(); expect(claimCounts([], now)).toMatchObject({ alle: 0, wartend: 0, überfällig: 0, genehmigtQuote: null });
  });
  it("Worte und Töne: Farbe nur, wo etwas zu tun ist", () => {
    expect(["offen", "in_prüfung", "genehmigt", "abgelehnt"].map(claimStatusLabel)).toEqual(["Offen", "In Prüfung", "Genehmigt", "Abgelehnt"]); expect(claimStatusLabel("anders")).toBe("anders");
    expect(["offen", "in_prüfung", "genehmigt", "abgelehnt"].map(claimTone)).toEqual(["open", "check", "yes", "no"]);
    expect(["erstellt", "frist_gesetzt", "status_geändert", "entschieden", "notiz", "neu_art"].map(claimEventLabel)).toEqual(["Erfasst", "Frist gesetzt", "Status geändert", "Entschieden", "Notiz", "neu art"]);
    expect(claimLeadName({ firstName: "Mara", lastName: "Sommer" })).toBe("Mara Sommer"); expect(claimLeadName({ firstName: null, lastName: "Sommer" })).toBe("Sommer"); expect(claimLeadName({})).toBe("Lead ohne Namen");
  });
});

describe("Reklamationen: Wer hat reklamiert?", () => {
  const claim = { id: 7, leadId: 40, createdAt: new Date("2026-11-20T10:00:00Z") };
  const delivery = (values: Partial<{ id: number; leadId: number; claimId: number | null; buyerName: string; unitPrice: string; result: string; occurredAt: Date }>) => ({ id: 1, leadId: 40, claimId: null, buyerName: "Käufer A", unitPrice: "40.00", result: "angenommen", occurredAt: new Date("2026-11-19T10:00:00Z"), ...values });
  it("die Lieferung, an der die Reklamation hängt – auch wenn eine spätere Lieferung an einen anderen ging", () => {
    const rows = [delivery({ id: 1, claimId: 7, result: "reklamiert", buyerName: "Käufer A" }), delivery({ id: 2, buyerName: "Käufer B", occurredAt: new Date("2026-11-21T10:00:00Z") })];
    expect(claimedDelivery(claim, rows)?.buyerName).toBe("Käufer A");
  });
  it("nach einer Ablehnung ist die Verknüpfung gelöst: dann die letzte geltende Lieferung vor der Reklamation", () => {
    const rows = [delivery({ id: 1, buyerName: "Früher", occurredAt: new Date("2026-11-10T10:00:00Z") }), delivery({ id: 2, buyerName: "Zuletzt", occurredAt: new Date("2026-11-19T10:00:00Z") }), delivery({ id: 3, buyerName: "Danach", occurredAt: new Date("2026-11-21T10:00:00Z") }), delivery({ id: 4, buyerName: "Abgelehnt", result: "abgelehnt", occurredAt: new Date("2026-11-19T12:00:00Z") }), delivery({ id: 5, leadId: 41, buyerName: "Anderer Lead" })];
    expect(claimedDelivery(claim, rows)?.buyerName).toBe("Zuletzt");
  });
  it("liegt keine Lieferung vor der Reklamation (Zeit auf die Sekunde gerundet), zählt die früheste geltende", () => {
    const rows = [delivery({ id: 2, buyerName: "Später", occurredAt: new Date("2026-11-22T10:00:00Z") }), delivery({ id: 1, buyerName: "Gleich danach", occurredAt: new Date("2026-11-20T10:00:01Z") })];
    expect(claimedDelivery(claim, rows)?.buyerName).toBe("Gleich danach");
  });
  it("ohne Lieferung gibt es keinen Käufer", () => {
    expect(claimedDelivery(claim, [])).toBeNull(); expect(claimedDelivery(claim, [delivery({ result: "übersprungen" }), delivery({ leadId: 41 })])).toBeNull();
  });
});

describe("Reklamationen: Lead nach einer Ablehnung", () => {
  it("bekommt den Status von vor der Reklamation zurück", () => {
    expect(restoredLeadStatus("zugewiesen", true)).toBe("zugewiesen"); expect(restoredLeadStatus("genehmigt", false)).toBe("genehmigt"); expect(restoredLeadStatus("neu", true)).toBe("neu");
  });
  it("ohne bekannten Status: zugewiesen, wenn eine Lieferung gilt – sonst bleibt er, wie er ist", () => {
    expect(restoredLeadStatus(null, true)).toBe("zugewiesen"); expect(restoredLeadStatus("reklamiert", true)).toBe("zugewiesen"); expect(restoredLeadStatus(undefined, false)).toBeNull(); expect(restoredLeadStatus("irgendwas", false)).toBeNull();
  });
});

describe("Reklamationen: CSV", () => {
  const rows = [
    { id: 3, leadId: 12, leadPublicId: "AB12CD34", firstName: "Mara", lastName: "Sommer", reason: "Falsche Telefonnummer", status: "in_prüfung", buyerName: "Sonnendach GmbH", supplierName: "Quelle Nord", refundAmount: "39.50", dueAt: new Date("2026-11-25T11:00:00Z"), createdAt: new Date("2026-11-19T08:00:00Z"), resolvedAt: null },
    { id: 4, leadId: 13, leadPublicId: null, firstName: null, lastName: null, reason: "Dublette; schon da", status: "genehmigt", buyerName: null, supplierName: null, refundAmount: null, dueAt: null, createdAt: "2026-11-09T08:00:00.000Z", resolvedAt: new Date("2026-11-11T09:00:00Z") },
  ];
  it("Lead-Nummer und Name statt der internen Zahl, Datum deutsch, Betrag mit Komma", () => {
    const table = claimsTable(rows);
    expect(table.columns).toEqual(["Reklamation", "Lead", "Name", "Grund", "Status", "Käufer", "Lieferant", "Erstattung in €", "Prüfen bis", "Erstellt am", "Entschieden am"]);
    expect(table.rows[0]).toEqual(["REC-3", "AB12CD34", "Mara Sommer", "Falsche Telefonnummer", "In Prüfung", "Sonnendach GmbH", "Quelle Nord", "39,50", "25.11.2026", "19.11.2026", ""]);
    expect(table.rows[1]).toEqual(["REC-4", "#13", "", "Dublette; schon da", "Genehmigt", "", "", "", "", "09.11.2026", "11.11.2026"]);
  });
  it("als Datei: Semikolon zwischen den Spalten, Text mit Semikolon steht in Anführungszeichen", () => {
    const table = claimsTable(rows); const lines = tableCsv(table.columns, table.rows).split("\r\n");
    expect(lines).toHaveLength(3); expect(lines[0]).toBe("Reklamation;Lead;Name;Grund;Status;Käufer;Lieferant;Erstattung in €;Prüfen bis;Erstellt am;Entschieden am");
    expect(lines[2]).toContain('"Dublette; schon da"'); expect(lines[1]).not.toContain("Dublette");
  });
});
