import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliveryChains, deliveryStops, leads } from "../drizzle/schema";
import { createFakeDb } from "./test-fake-db";

const state = vi.hoisted(() => ({ fake: null as ReturnType<typeof import("./test-fake-db").createFakeDb> | null }));
vi.mock("./db", () => ({
  ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 1, slug: "mandant-1", name: "Test-Mandant" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })),
  getDb: vi.fn(async () => state.fake!.db),
  getTenantForUser: vi.fn(),
  listRecentLeads: vi.fn(),
}));

import { appRouter } from "./routers";

describe("Auslieferungs-Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.fake = createFakeDb([
      [leads, [{ id: 101, tenantId: 1, publicId: "LEAD-01", categoryId: 12, status: "genehmigt", supplierId: null, postcode: "10115", cost: "0.00", metadata: {} }]],
      [deliveryChains, [{ id: 21, tenantId: 1, orderId: null, categoryId: 12, name: "PV Nord", priority: 1, status: "aktiv", roundRobinCursor: 1 }]],
      [deliveryStops, [{ id: 31, chainId: 21, buyerName: "Käufer Nord", position: 1, unitPrice: "52.00", active: true }, { id: 32, chainId: 21, buyerName: "Käufer Ost", position: 2, unitPrice: "58.00", active: true }]],
    ]);
  });

  it("liefert einen Lead an den nächsten Stop, persistiert das Ereignis und erhöht den Round-Robin-Zähler", async () => {
    const caller = appRouter.createCaller({ user: { id: 4 } } as never);
    const result = await caller.leadops.deliverLead({ publicId: "LEAD-01" });

    // Wasserfall: Stops werden von oben nach unten abgelaufen – der erste aktive Stop bekommt den Lead
    expect(result).toMatchObject({ chainId: 21, stopId: 31, buyerName: "Käufer Nord", unitPrice: "52.00", orderId: null, result: "angeboten", export: null }); expect(result.attempts).toHaveLength(1);
    expect(state.fake!.insertCalls.find((call) => call.table === "leadDeliveries")!.values).toMatchObject({ tenantId: 1, leadId: 101, chainId: 21, stopId: 31, buyerName: "Käufer Nord", result: "angeboten" });
    expect(state.fake!.insertCalls.find((call) => call.table === "leadStatusEvents")!.values).toMatchObject({ tenantId: 1, leadId: 101, previousStatus: "genehmigt", nextStatus: "zugewiesen", actorUserId: 4, note: "Auslieferung an Käufer Nord (PV Nord, Stop 1)" });
    expect(state.fake!.updateCalls).toContainEqual(expect.objectContaining({ table: "deliveryChains", values: { roundRobinCursor: 2 } }));
    expect(state.fake!.updateCalls.some((call) => call.table === "leads" && call.values.status === "zugewiesen")).toBe(true);
  });

  it("nennt den Grund, wenn keine Kette den Lead annehmen kann", async () => {
    state.fake!.rows(deliveryStops).splice(0, 2);
    const caller = appRouter.createCaller({ user: { id: 4 } } as never);
    await expect(caller.leadops.deliverLead({ publicId: "LEAD-01" })).rejects.toThrow("PV Nord: Lieferkette hat keinen aktiven Stop");
  });
});
