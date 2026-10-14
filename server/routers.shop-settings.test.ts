import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const updates: unknown[] = [];
  const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 4 }]) })) })) })), update: vi.fn(() => ({ set: vi.fn((value: unknown) => ({ where: vi.fn(async () => { updates.push(value); return []; }) })) })) };
  return { db, updates, reset: () => updates.length = 0 };
});
vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 41, slug: "test", name: "Test" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));
import { appRouter } from "./routers";

describe("Shop-Freigabeeinstellungen", () => {
  beforeEach(() => { state.reset(); vi.clearAllMocks(); });
  it("speichert Shop, Guthaben und manuellen Bestellfreigabe-Modus im aktiven Mandanten", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);
    await caller.leadops.updateTenantSettings({ shopEnabled: true, creditEnabled: true, orderApproval: "manuell" });
    expect(state.updates[0]).toMatchObject({ shopEnabled: true, creditEnabled: true, orderApproval: "manuell" });
  });
});
