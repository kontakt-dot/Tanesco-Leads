import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const updates: unknown[] = []; const inserts: unknown[] = [];
  const tx = { update: vi.fn(() => ({ set: vi.fn((value: unknown) => ({ where: vi.fn(async () => { updates.push(value); return []; }) })) })), insert: vi.fn(() => ({ values: vi.fn(async (value: unknown) => { inserts.push(value); return []; }) })) };
  const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 9, tenantId: 41, name: "Integration", scopes: ["leads:write"], revokedAt: null }]) })) })) })), transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)) };
  return { db, updates, inserts, reset: () => { updates.length = 0; inserts.length = 0; } };
});

vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 41, slug: "test", name: "Test" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));
import { appRouter } from "./routers";

describe("API-Token-Router", () => {
  beforeEach(() => { state.reset(); vi.clearAllMocks(); });
  it("widerruft den bisherigen Mandantentoken und erzeugt einen neuen Token mit denselben Scopes", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);
    const result = await caller.leadops.rotateApiToken({ id: 9 });
    expect(result.token).toMatch(/^fx_/);
    expect(state.updates[0]).toMatchObject({ revokedAt: expect.any(Date) });
    expect(state.inserts[0]).toMatchObject({ tenantId: 41, scopes: ["leads:write"], name: "Integration (rotiert)" });
  });
});
