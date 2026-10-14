import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const selectedRows: unknown[][] = [];
  const deletes: unknown[] = [];
  const updates: unknown[] = [];
  const inserts: unknown[] = [];
  const select = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => { const rows = selectedRows.shift() ?? []; return { limit: vi.fn(async () => rows), then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) }; }) })) }));
  const remove = vi.fn(() => ({ where: vi.fn(async (where: unknown) => { deletes.push(where); return []; }) }));
  const update = vi.fn(() => ({ set: vi.fn((values: unknown) => ({ where: vi.fn(async (where: unknown) => { updates.push({ values, where }); return []; }) })) }));
  const insert = vi.fn(() => ({ values: vi.fn(async (values: unknown) => { inserts.push(values); return []; }) }));
  const tx = { delete: remove, update, insert };
  const db = { select, delete: remove, transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)) };
  return { db, selectedRows, deletes, updates, inserts, reset: () => { selectedRows.length = 0; deletes.length = 0; updates.length = 0; inserts.length = 0; vi.clearAllMocks(); } };
});

vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 71, slug: "tanescodigital", name: "Tanesco Digital" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));
import { appRouter } from "./routers";

describe("Sichere Bestelllöschung", () => {
  beforeEach(() => state.reset());

  it("entfernt eine Bestellung mit ihren Lieferketten, Stops, Auslieferungen und Konfigurationen", async () => {
    state.selectedRows.push(
      [{ id: 812, orderNumber: "ORD-PV812", name: "PV Rhein-Main" }],
      [{ id: 91 }],
      [],
    );
    const caller = appRouter.createCaller({ user: { id: 21 } } as never);

    await expect(caller.leadops.deleteOrder({ orderId: 812 })).resolves.toEqual({ success: true, orderNumber: "ORD-PV812", removedChains: 1, detachedLeads: 0 });
    expect(state.deletes).toHaveLength(6);
  });

  it("aktiviert eine Bestellung samt operativer Konfiguration und protokolliert die Änderung", async () => {
    state.selectedRows.push([{ id: 812, status: "offen" }]);
    const caller = appRouter.createCaller({ user: { id: 21 } } as never);

    await expect(caller.leadops.updateOrderStatus({ id: 812, status: "aktiv" })).resolves.toEqual({ success: true });
    expect(state.updates.map((entry) => (entry as { values: unknown }).values)).toEqual(expect.arrayContaining([{ status: "aktiv" }, { active: true }]));
    expect(state.inserts[0]).toMatchObject({ orderId: 812, eventType: "aktiviert", note: "Bestellstatus geändert: offen → aktiv." });
  });
});
