import { describe, expect, it } from "vitest";
import { assembleReport, buildPartnerReport, berlinBound, endpointAccount, guessProvider, providerMode, providerName, reportTitle, type RawAccount, type RawEndpoint, type RawEvent } from "../shared/partner-report";
import { WATTFOX_TEMPLATE } from "../shared/wattfox";

/**
 * Version 383 – Statistik je Käufer von selbst: Jeder Käufer mit Schnittstelle bekommt eine Karte, auch ohne Partnerkonto.
 * Hier: die reine Zusammenstellung (Server und Vorschau rechnen damit) – welcher Partner erkannt wird, welche Schnittstelle zu welcher
 * Karte gehört, wann ein Käufer von selbst erscheint und was eine Zeile „api“ (nur Kontingent) bedeutet. Alle Namen sind erfunden.
 */
const account = (values: Partial<RawAccount> & { id: number; provider: string }): RawAccount => ({ label: null, buyerUserId: null, hasAccess: true, lastSyncAt: null, lastSyncNote: null, quotaAmount: null, quotaPeriod: null, ...values });
const endpoint = (values: Partial<RawEndpoint> & { id: number }): RawEndpoint => ({ url: "https://crm.haus-und-dach.example/api/leads", bodyTemplate: null, enabled: true, buyerUserId: null, membershipId: null, buyerName: null, ...values });
const event = (id: number, endpointId: number, leadId: number, eventType = "geliefert", minutesAgo = id): RawEvent => ({ id, endpointId, leadId, categoryId: 1, eventType, occurredAt: new Date(Date.UTC(2026, 10, 20, 12, 0) - minutesAgo * 60_000) });

describe("Partner an der Schnittstelle erkennen", () => {
  it("WattFox an der Vorlage oder an der Adresse, Aroundhome/Leadnodes/Enpal/GoHighLevel an der Adresse – sonst „api“", () => {
    expect(guessProvider({ url: "https://partner.example/in", bodyTemplate: WATTFOX_TEMPLATE })).toBe("wattfox");
    expect(guessProvider({ url: "https://api.wattfox.example/leads", bodyTemplate: null })).toBe("wattfox"); expect(guessProvider({ url: "https://www.photovoltaik-angebotsvergleich.example/api", bodyTemplate: "" })).toBe("wattfox");
    expect(guessProvider({ url: "https://api.AroundHome.example/v2/leads", bodyTemplate: null })).toBe("aroundhome"); expect(guessProvider({ url: "https://app.leadnodes.example/hook", bodyTemplate: null })).toBe("leadnodes"); expect(guessProvider({ url: "https://partner.enpal.example/x", bodyTemplate: null })).toBe("enpal");
    expect(guessProvider({ url: "https://services.leadconnectorhq.com/contacts/", bodyTemplate: null })).toBe("gohighlevel"); expect(guessProvider({ url: "https://rest.gohighlevel.com/v1", bodyTemplate: null })).toBe("gohighlevel");
    expect(guessProvider({ url: "https://crm.haus-und-dach.example/api/leads", bodyTemplate: '{"name":"{{firstName}}"}' })).toBe("api");
  });
  it("„Eigene Schnittstelle“ hat keine Rückmeldung; der Titel einer solchen Karte ist der Name des Käufers", () => {
    expect(providerName("api")).toBe("Eigene Schnittstelle"); expect(providerMode("api")).toBe("none");
    expect(reportTitle({ provider: "api", label: null, buyerName: "Haus & Dach GmbH" })).toBe("Haus & Dach GmbH"); expect(reportTitle({ provider: "api", label: null, buyerName: null })).toBe("Käufer");
    expect(reportTitle({ provider: "wattfox", label: null, buyerName: "Haus & Dach GmbH" })).toBe("WattFox"); expect(reportTitle({ provider: "aroundhome", label: "Account 1", buyerName: null })).toBe("Aroundhome (Account 1)"); expect(reportTitle({ provider: "wattfox", label: " wattfox ", buyerName: null })).toBe("WattFox");
  });
});

describe("Schnittstelle → Konto", () => {
  const accounts = [{ id: 1, provider: "aroundhome", buyerUserId: 10 }, { id: 2, provider: "wattfox", buyerUserId: null }, { id: 3, provider: "api", buyerUserId: 20 }, { id: 4, provider: "wattfox", buyerUserId: 20 }];
  it("der Käufer des Kontos entscheidet – auch wenn die Adresse nach einem anderen Partner aussieht", () => {
    expect(endpointAccount({ url: "https://api.wattfox.example/leads", bodyTemplate: null, buyerUserId: 10 }, accounts)).toBe(1);
  });
  it("ein Konto mit Rückmeldung geht vor einer Zeile „api“ desselben Käufers", () => {
    expect(endpointAccount({ url: "https://x.example", bodyTemplate: null, buyerUserId: 20 }, accounts)).toBe(4); expect(endpointAccount({ url: "https://x.example", bodyTemplate: null, buyerUserId: 20 }, accounts.slice(0, 3))).toBe(3);
  });
  it("ein Konto ohne Käufer erkennt „seine“ Schnittstelle am Partner; ohne erkannten Partner gehört die Schnittstelle zu keinem Konto", () => {
    expect(endpointAccount({ url: "https://partner.example/in", bodyTemplate: WATTFOX_TEMPLATE, buyerUserId: 30 }, accounts)).toBe(2); expect(endpointAccount({ url: "https://crm.example/api", bodyTemplate: null, buyerUserId: 30 }, accounts)).toBeNull();
    expect(endpointAccount({ url: "https://api.aroundhome.example", bodyTemplate: null, buyerUserId: 30 }, accounts)).toBeNull(); // das Aroundhome-Konto gehört schon einem anderen Käufer
  });
});

describe("Karten zusammenstellen", () => {
  it("ein Käufer mit Schnittstelle bekommt von selbst eine Karte – ohne Konto, mit dem erkannten Partner und dem Weg zu seinem Benutzer-Eintrag", () => {
    const made = assembleReport({ accounts: [], endpoints: [endpoint({ id: 1, bodyTemplate: WATTFOX_TEMPLATE, buyerUserId: 7, membershipId: 70, buyerName: "Sonnenwerk Süd" })], events: [event(1, 1, 100), event(2, 1, 101, "abgelehnt"), event(3, 1, 102, "storniert")] });
    expect(made.accounts).toEqual([{ id: -7, provider: "wattfox", label: null, buyerName: "Sonnenwerk Süd", mode: "push", hasAccess: false, lastSyncAt: null, lastSyncNote: null, quotaAmount: null, quotaPeriod: null, buyerUserId: 7, membershipId: 70, virtual: true }]);
    expect(made.deliveries.map((row) => [row.accountId, row.leadId, row.result, row.buyerName])).toEqual([[-7, 100, "accepted", "Sonnenwerk Süd"], [-7, 101, "rejected", "Sonnenwerk Süd"], [-7, 102, "rejected", "Sonnenwerk Süd"]]);
  });
  it("je Lead und Karte zählt die letzte Übergabe; Übergaben ohne Lead oder an fremde Schnittstellen zählen nicht", () => {
    const made = assembleReport({ accounts: [], endpoints: [endpoint({ id: 1, buyerUserId: 7, membershipId: 70, buyerName: "Haus & Dach GmbH" })], events: [event(1, 1, 100, "abgelehnt", 90), event(2, 1, 100, "geliefert", 30), event(3, 1, 101, "geliefert", 80), event(4, 1, 101, "abgelehnt", 10), { ...event(5, 1, 0), leadId: null }, event(6, 99, 300)] });
    expect(made.deliveries.map((row) => [row.leadId, row.result])).toEqual([[100, "accepted"], [101, "rejected"]]); expect(made.accounts[0].provider).toBe("api"); expect(made.accounts[0].mode).toBe("none");
  });
  it("nur ausgeschaltete Schnittstellen und noch nie geliefert: keine Karte – mit einer Übergabe schon", () => {
    const off = [endpoint({ id: 1, enabled: false, buyerUserId: 7, membershipId: 70, buyerName: "Haus & Dach GmbH" })];
    expect(assembleReport({ accounts: [], endpoints: off, events: [] }).accounts).toEqual([]);
    expect(assembleReport({ accounts: [], endpoints: off, events: [event(1, 1, 100)] }).accounts.map((row) => row.id)).toEqual([-7]);
    expect(assembleReport({ accounts: [], endpoints: [...off, endpoint({ id: 2, buyerUserId: 7, membershipId: 70 })], events: [] }).accounts.map((row) => row.id)).toEqual([-7]); // eine eingeschaltete genügt
  });
  it("eine Schnittstelle ohne Käufer (ältere Verbindung) ergibt keine Karte", () => {
    const made = assembleReport({ accounts: [], endpoints: [endpoint({ id: 1, buyerUserId: null })], events: [event(1, 1, 100)] }); expect(made.accounts).toEqual([]); expect(made.deliveries).toEqual([]);
  });
  it("gibt es ein Konto für den Käufer, zählt alles dort – keine zweite Karte", () => {
    const made = assembleReport({ accounts: [account({ id: 5, provider: "wattfox", buyerUserId: 7, label: "WattFox PV", quotaAmount: 900, quotaPeriod: "week" })], endpoints: [endpoint({ id: 1, bodyTemplate: WATTFOX_TEMPLATE, buyerUserId: 7, membershipId: 70, buyerName: "Sonnenwerk Süd" })], events: [event(1, 1, 100)], buyers: [{ userId: 7, membershipId: 70, name: "Sonnenwerk Süd" }] });
    expect(made.accounts).toHaveLength(1); expect(made.accounts[0]).toMatchObject({ id: 5, provider: "wattfox", label: "WattFox PV", buyerName: "Sonnenwerk Süd", mode: "push", hasAccess: true, quotaAmount: 900, quotaPeriod: "week", buyerUserId: 7, membershipId: 70 }); expect(made.accounts[0].virtual).toBeUndefined();
    expect(made.deliveries.map((row) => row.accountId)).toEqual([5]);
  });
  it("ein Konto ohne Käufer, das die Schnittstelle am Partner erkennt, nimmt ihre Übergaben – der Käufer bekommt dann keine eigene Karte", () => {
    const made = assembleReport({ accounts: [account({ id: 5, provider: "wattfox" })], endpoints: [endpoint({ id: 1, bodyTemplate: WATTFOX_TEMPLATE, buyerUserId: 7, membershipId: 70, buyerName: "Sonnenwerk Süd" })], events: [event(1, 1, 100)] });
    expect(made.accounts.map((row) => row.id)).toEqual([5]); expect(made.accounts[0].buyerName).toBe("Sonnenwerk Süd"); expect(made.deliveries[0].accountId).toBe(5); // der Name kommt aus der Zustellung
  });
  it("eine Zeile „api“ (nur Kontingent) zeigt den Partner, den die Schnittstelle verrät – ohne Zugang, mit Kontingent, als echtes Konto", () => {
    const rows = { accounts: [account({ id: 9, provider: "api", buyerUserId: 7, hasAccess: false, quotaAmount: 40, quotaPeriod: "month" })], endpoints: [endpoint({ id: 1, bodyTemplate: WATTFOX_TEMPLATE, buyerUserId: 7, membershipId: 70, buyerName: "Sonnenwerk Süd" })], events: [event(1, 1, 100), event(2, 1, 101)] };
    const made = assembleReport(rows);
    expect(made.accounts).toEqual([{ id: 9, provider: "wattfox", label: null, buyerName: "Sonnenwerk Süd", mode: "push", hasAccess: false, lastSyncAt: null, lastSyncNote: null, quotaAmount: 40, quotaPeriod: "month", buyerUserId: 7, membershipId: 70 }]);
    expect(made.deliveries.map((row) => row.accountId)).toEqual([9, 9]);
    const plain = assembleReport({ ...rows, endpoints: [endpoint({ id: 1, buyerUserId: 7, membershipId: 70, buyerName: "Haus & Dach GmbH" })] }).accounts[0];
    expect(plain.provider).toBe("api"); expect(plain.mode).toBe("none"); expect(reportTitle(plain)).toBe("Haus & Dach GmbH");
  });
  it("Reihenfolge: erst die gespeicherten Konten, dann die Käufer ohne Konto nach Namen", () => {
    const made = assembleReport({
      accounts: [account({ id: 5, provider: "aroundhome", buyerUserId: 1 }), account({ id: 6, provider: "leadnodes", buyerUserId: 2, hasAccess: false })],
      endpoints: [endpoint({ id: 1, buyerUserId: 30, membershipId: 300, buyerName: "Zimmerei Nord" }), endpoint({ id: 2, buyerUserId: 31, membershipId: 310, buyerName: "Ökostrom Mitte" }), endpoint({ id: 3, buyerUserId: 32, membershipId: 320, buyerName: "Albrecht Bedachungen" }), endpoint({ id: 4, buyerUserId: 1, membershipId: 10, buyerName: "Aroundhome GmbH" })],
      events: [],
    });
    expect(made.accounts.map((row) => [row.id, row.buyerName])).toEqual([[5, "Aroundhome GmbH"], [6, null], [-32, "Albrecht Bedachungen"], [-31, "Ökostrom Mitte"], [-30, "Zimmerei Nord"]]);
    expect(made.accounts.slice(2).every((row) => row.virtual === true)).toBe(true); expect(made.accounts[0].membershipId).toBe(10); expect(made.accounts[1].membershipId).toBeNull();
  });
  it("die Rechnung läuft für eine Karte ohne Konto genauso: geliefert, PrePing abgelehnt, angenommen – ohne Bewertung, ohne Kontingent", () => {
    const made = assembleReport({ accounts: [], endpoints: [endpoint({ id: 1, buyerUserId: 7, membershipId: 70, buyerName: "Haus & Dach GmbH" })], events: [event(1, 1, 100), event(2, 1, 101), event(3, 1, 102, "abgelehnt")] });
    const cards = buildPartnerReport({ ...made, transactions: [], filter: { from: berlinBound("2026-11-01"), until: berlinBound("2026-11-30", true), basis: "delivery" }, today: "2026-11-20" });
    expect(cards).toHaveLength(1); expect(cards[0].title).toBe("Haus & Dach GmbH"); expect(cards[0].account.virtual).toBe(true);
    expect(cards[0].counts).toMatchObject({ delivered: 3, rejected: 1, accepted: 2, rated: 0, silent: 2, commission: 0 }); expect(cards[0].quota).toBeNull(); expect(cards[0].buyers).toEqual([expect.objectContaining({ buyerName: "Haus & Dach GmbH", delivered: 3 })]);
  });
});
