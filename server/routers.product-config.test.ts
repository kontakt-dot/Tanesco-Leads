import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const inserts: unknown[] = [];
  const productQuery = { limit: vi.fn(async () => [{ id: 3 }]) };
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => productQuery) })) })),
    insert: vi.fn(() => ({ values: vi.fn((value: unknown) => { inserts.push(value); return { onDuplicateKeyUpdate: vi.fn(async () => []) }; }) })),
  };
  return { db, inserts, reset: () => { inserts.length = 0; productQuery.limit.mockClear(); } };
});

vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 41, slug: "test", name: "Test" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));
import { appRouter } from "./routers";

describe("Produktregeln-Router", () => {
  beforeEach(() => { state.reset(); vi.clearAllMocks(); });
  it("speichert Mengenbegrenzung und Geopflicht mandantenbezogen", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);
    await caller.leadops.updateProductOperationalConfig({ productId: 3, minQuantity: 2, maxQuantity: 12, geoRequired: true });
    expect(state.inserts[0]).toMatchObject({ tenantId: 41, productId: 3, minQuantity: 2, maxQuantity: 12, geoRequired: true });
  });
});
