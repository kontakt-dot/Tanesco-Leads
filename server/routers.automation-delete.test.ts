import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const where = vi.fn(async () => []);
  const db = { delete: vi.fn(() => ({ where })) };
  return { db, where, reset: () => where.mockClear() };
});
vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 41, slug: "test", name: "Test" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));
import { appRouter } from "./routers";

describe("Automatisierungsregel-Löschung", () => {
  beforeEach(() => { state.reset(); vi.clearAllMocks(); });
  it("führt die Löschaktion innerhalb des aktiven Mandanten aus", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);
    await expect(caller.leadops.deleteAutomationRule({ id: 12 })).resolves.toEqual({ success: true });
    expect(state.where).toHaveBeenCalledOnce();
  });
});
