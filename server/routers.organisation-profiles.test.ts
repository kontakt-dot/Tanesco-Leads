import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 71 }]) })) })) })),
    insert: vi.fn(() => ({ values: vi.fn(async (value: unknown) => { inserts.push(value); return []; }) })),
    update: vi.fn(() => ({ set: vi.fn((value: unknown) => ({ where: vi.fn(async () => { updates.push(value); return []; }) })) })),
  };
  return { db, inserts, updates, reset: () => { inserts.length = 0; updates.length = 0; } };
});

vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 41, slug: "test", name: "Test" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));
import { appRouter } from "./routers";

describe("Organisationsprofile", () => {
  beforeEach(() => { state.reset(); vi.clearAllMocks(); });

  it("speichert Käuferprofil und API-Integration mit der Einladung", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);
    await caller.leadops.inviteUser({ email: "kaeufer@example.de", role: "viewer", partnerType: "käufer", integrationId: 71 });
    expect(state.inserts[0]).toMatchObject({ tenantId: 41, email: "kaeufer@example.de", partnerType: "käufer", integrationId: 71 });
  });

  it("aktualisiert Lieferantenprofil und API-Integration gemeinsam", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);
    await caller.leadops.updateMembership({ id: 12, partnerType: "lieferant", integrationId: 71 });
    expect(state.updates[0]).toMatchObject({ partnerType: "lieferant", integrationId: 71 });
  });
});
