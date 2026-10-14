import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const inserts: unknown[] = [];
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 812 }]) })) })) })),
    insert: vi.fn(() => ({ values: vi.fn(async (values: unknown) => { inserts.push(values); return [{ insertId: 812 }]; }) })),
    transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db)),
  };
  return { db, inserts, reset: () => inserts.splice(0, inserts.length) };
});

vi.mock("./db", () => ({
  ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 71, slug: "tanescodigital", name: "Tanesco Digital" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })),
  getDb: vi.fn(async () => state.db),
  getTenantForUser: vi.fn(),
  listRecentLeads: vi.fn(),
}));

import { appRouter } from "./routers";

describe("Bestellarbeitsbereich-Router", () => {
  it("legt mit einer Bestellung automatisch Konfiguration, Synchronisationsschlüssel und Chronik an", async () => {
    state.reset();
    const caller = appRouter.createCaller({ user: { id: 21 } } as never);

    const result = await caller.leadops.createOrder({ name: "PV Rhein-Main August", buyerName: "Tanesco Digital", categoryId: 150001, quantity: 20, unitPrice: 39.9, status: "offen" });

    expect(result).toMatchObject({ orderId: 812 });
    expect(state.inserts[0]).toMatchObject({ tenantId: 71, name: "PV Rhein-Main August", buyerName: "Tanesco Digital", categoryId: 150001, quantity: 20, unitPrice: "39.90" });
    expect(state.inserts[1]).toMatchObject({ tenantId: 71, orderId: 812, categoryIds: [150001], requestedQuantity: 20, active: false, deliveryDays: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"] });
    expect(state.inserts[1]).toHaveProperty("syncKey");
    expect(state.inserts[2]).toMatchObject({ tenantId: 71, orderId: 812, eventType: "erstellt", note: "Bestellung angelegt." });
  });

  it("verknüpft eine optional angelegte Lieferkette mit der ausgewählten Bestellung", async () => {
    state.reset();
    const caller = appRouter.createCaller({ user: { id: 21 } } as never);

    const result = await caller.leadops.createDeliveryChain({ orderId: 812, categoryId: 150001, name: "PV-Mehrabnehmer", priority: 1, sellTarget: 1, distributionMode: "lieferketten_round_robin", status: "aktiv" });

    expect(result).toEqual({ success: true, chainId: 812 });
    expect(state.inserts[0]).toMatchObject({ tenantId: 71, orderId: 812, categoryId: 150001, name: "PV-Mehrabnehmer", status: "aktiv" });
  });

  it("verlangt bei eingeschränkter Lieferantenauswahl mindestens einen zugelassenen Lieferanten", async () => {
    const caller = appRouter.createCaller({ user: { id: 21 } } as never);

    await expect(caller.leadops.saveOrderWorkspace({ orderId: 812, name: "PV Rhein-Main", buyerName: "Tanesco Digital", buyerUserId: 1, categoryId: 150001, categoryIds: [150001, 150002], quantity: 20, unitPrice: 39.9, supplierId: null, supplierMode: "mehrere", supplierIds: [], deliveryInterval: "täglich", compensateClaims: false, priority: 1, realtimeDelivery: true, startsAt: new Date("2026-08-18T12:00:00Z"), endsAt: null, ongoing: true, deliveryDays: ["Montag"], deliveryArea: "landesweit", pauses: [], advancedFilters: { minAgeDays: null, maxLeadPrice: null, postcodes: null } })).rejects.toThrow("Wählen Sie mindestens einen Lieferanten");
  });
});
