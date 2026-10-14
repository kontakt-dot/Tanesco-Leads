import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  let insertStep = 0;
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 44, status: "zugewiesen" }]), orderBy: vi.fn(() => ({ limit: vi.fn(async () => []) })) })) })) })),
    insert: vi.fn(() => ({ values: vi.fn(async (value: unknown) => { inserts.push(value); return insertStep++ === 0 ? [{ insertId: 99 }] : []; }) })),
    update: vi.fn(() => ({ set: vi.fn((value: unknown) => ({ where: vi.fn(async () => { updates.push(value); return []; }) })) })),
  };
  Object.assign(db, { transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db)) });
  return { db, inserts, updates, reset: () => { inserts.length = 0; updates.length = 0; insertStep = 0; } };
});

vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 5, slug: "test", name: "Test" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));
import { appRouter } from "./routers";

describe("Reklamationsanlage-Router", () => {
  beforeEach(() => { state.reset(); vi.clearAllMocks(); });

  it("erstellt einen Mandantenfall, markiert den Lead als reklamiert und protokolliert Erfassung sowie Frist", async () => {
    const caller = appRouter.createCaller({ user: { id: 9 } } as never);
    const result = await caller.leadops.createClaim({ leadId: 44, reason: "Qualitätsprüfung", details: "Autorisierter Prüffall", refundAmount: 15, dueAt: new Date("2026-09-01T12:00:00Z") });

    expect(result).toEqual({ success: true, claimId: 99 });
    expect(state.inserts[0]).toMatchObject({ tenantId: 5, leadId: 44, reason: "Qualitätsprüfung", refundAmount: "15.00" });
    expect(state.updates[0]).toMatchObject({ status: "reklamiert" });
    expect(state.inserts).toContainEqual(expect.objectContaining({ tenantId: 5, leadId: 44, previousStatus: "zugewiesen", nextStatus: "reklamiert", actorUserId: 9 }));
    expect(state.inserts).toContainEqual(expect.arrayContaining([
      expect.objectContaining({ tenantId: 5, claimId: 99, eventType: "erstellt", nextStatus: "offen", actorUserId: 9 }),
      expect.objectContaining({ tenantId: 5, claimId: 99, eventType: "frist_gesetzt", actorUserId: 9 }),
    ]));
  });
});
