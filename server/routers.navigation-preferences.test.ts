import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const updateCalls: unknown[] = [];
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 8 }]) })) })) })),
    update: vi.fn(() => ({ set: vi.fn((values: unknown) => ({ where: vi.fn(async () => { updateCalls.push(values); return []; }) })) })),
    insert: vi.fn(() => ({ values: vi.fn(async () => []) })),
  };
  return { db, updateCalls };
});

vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 41, slug: "test-mandant", name: "Test" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));

import { appRouter } from "./routers";

describe("Mandanten-Navigationspräferenzen", () => {
  beforeEach(() => { state.updateCalls.length = 0; vi.clearAllMocks(); });
  it("speichert ausgeblendete Bereiche am aktiven Mandanten", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);
    await caller.leadops.updateNavigationPreferences({ hiddenPages: ["Statistik", "E-Mails"] });
    expect(state.updateCalls[0]).toMatchObject({ navigationHiddenPages: ["Statistik", "E-Mails"] });
  });
});
