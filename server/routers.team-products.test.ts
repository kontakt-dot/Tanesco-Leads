import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const inserts: unknown[] = [];
  let resultIndex = 0;
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => resultIndex++ === 0 ? [{ id: 5 }] : [{ id: 9 }]) })) })) })),
    insert: vi.fn(() => ({ values: vi.fn((value: unknown) => { inserts.push(value); return { onDuplicateKeyUpdate: vi.fn(async () => []) }; }) })),
  };
  return { db, inserts, reset: () => { inserts.length = 0; resultIndex = 0; } };
});

vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 41, slug: "test", name: "Test" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));

import { appRouter } from "./routers";

describe("Team-Produkt-Router", () => {
  beforeEach(() => { state.reset(); vi.clearAllMocks(); });
  it("ordnet ein im Mandanten vorhandenes Produkt einem Team zu", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);
    await caller.leadops.setTeamProductAssignment({ teamId: 5, productId: 9, assigned: true });
    expect(state.inserts[0]).toMatchObject({ tenantId: 41, teamId: 5, productId: 9 });
  });
});
