import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const inserts: unknown[] = []; const updates: unknown[] = [];
  const tx = { insert: vi.fn(() => ({ values: vi.fn((value: unknown) => { inserts.push(value); return { onDuplicateKeyUpdate: vi.fn(async () => []) }; }) })), select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 4 }]) })) })) })), update: vi.fn(() => ({ set: vi.fn((value: unknown) => ({ where: vi.fn(async () => { updates.push(value); return []; }) })) })) };
  const db = { transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)) };
  return { db, inserts, updates, reset: () => { inserts.length = 0; updates.length = 0; } };
});
vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 41, slug: "test", name: "Test" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));
import { appRouter } from "./routers";

describe("Nutzungsbedingungen-Router", () => {
  beforeEach(() => { state.reset(); vi.clearAllMocks(); });
  it("protokolliert eine Annahme versionsgeführt und aktualisiert den Mandantenstatus", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);
    await expect(caller.leadops.acceptTerms({ version: "1.0" })).resolves.toMatchObject({ success: true });
    expect(state.inserts[0]).toMatchObject({ tenantId: 41, acceptedByUserId: 7, version: "1.0" });
    expect(state.updates[0]).toMatchObject({ acceptedTermsVersion: "1.0", acceptedTermsAt: expect.any(Date) });
  });
});
