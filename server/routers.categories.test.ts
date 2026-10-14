import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const insertCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  const deleteCalls: unknown[] = [];
  const db = {
    insert: vi.fn(() => ({ values: vi.fn(async (values: unknown) => { insertCalls.push(values); return []; }) })),
    update: vi.fn(() => ({ set: vi.fn((values: unknown) => ({ where: vi.fn(async () => { updateCalls.push(values); return []; }) })) })),
    delete: vi.fn((table: unknown) => ({ where: vi.fn(async () => { deleteCalls.push(table); return []; }) })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 74 }]), orderBy: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 74 }]) })) })) })) })),
    transaction: vi.fn(async (callback: (transaction: typeof db) => Promise<void>) => callback(db)),
  };
  return { db, insertCalls, updateCalls, deleteCalls };
});

vi.mock("./db", () => ({
  ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 41, slug: "test-mandant", name: "Test-Mandant" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })),
  getDb: vi.fn(async () => state.db),
  getTenantForUser: vi.fn(),
  listRecentLeads: vi.fn(),
}));

import { appRouter } from "./routers";

describe("Lead-Kategorie-Router", () => {
  beforeEach(() => {
    state.insertCalls.length = 0;
    state.updateCalls.length = 0;
    state.deleteCalls.length = 0;
    vi.clearAllMocks();
  });

  it("legt und bearbeitet eine Kategorie im aktiven Mandanten ohne Pipeline und Priorität", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);

    await caller.leadops.createCategory({
      shortcode: "pv",
      name: "Photovoltaik",
      defaultLeadPrice: "60.00",
      geocodingRequired: false,
      marketplaceEnabled: true,
      status: "aktiv",
      offerDescription: "Qualifizierte PV-Anfragen",
    });
    await caller.leadops.updateCategory({
      id: 73,
      shortcode: "pv-plus",
      defaultLeadPrice: "65.50",
      marketplaceEnabled: false,
      status: "inaktiv",
    });

    expect(state.insertCalls[0]).toMatchObject({
      tenantId: 41,
      shortcode: "PV",
      name: "Photovoltaik",
      defaultLeadPrice: "60.00",
      geocodingRequired: false,
      marketplaceEnabled: true,
      status: "aktiv",
      offerDescription: "Qualifizierte PV-Anfragen",
    });
    expect(state.updateCalls[0]).toMatchObject({
      shortcode: "PV-PLUS",
      defaultLeadPrice: "65.50",
      marketplaceEnabled: false,
      status: "inaktiv",
    });
  });

  it("löscht ausschließlich eine eigene Vorlage mit ihren Fachfeldern und Harmonisierungseinträgen", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);

    await expect(caller.leadops.deleteCategoryTemplate({ id: 74 })).resolves.toEqual({ success: true });

    expect(state.deleteCalls).toHaveLength(3);
  });
});
