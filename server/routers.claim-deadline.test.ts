import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const updates: unknown[] = [];
  const events: unknown[] = [];
  const claim = { id: 12, tenantId: 5, leadId: 44, status: "offen", resolvedAt: null };
  const tx = {
    update: vi.fn(() => ({ set: vi.fn((value: unknown) => ({ where: vi.fn(async () => { updates.push(value); return []; }) })) })),
    insert: vi.fn(() => ({ values: vi.fn(async (value: unknown) => { events.push(value); return []; }) })),
  };
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [claim]) })) })) })),
    transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)),
  };
  return { db, updates, events, reset: () => { updates.length = 0; events.length = 0; } };
});

vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 5, slug: "test", name: "Test" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));
import { appRouter } from "./routers";

describe("Reklamationsfrist-Router", () => {
  beforeEach(() => { state.reset(); vi.clearAllMocks(); });

  it("setzt eine Frist im aktiven Mandanten, überführt offene Fälle in Prüfung und schreibt ein Chronikereignis", async () => {
    const caller = appRouter.createCaller({ user: { id: 9 } } as never);
    await caller.leadops.updateClaimDeadline({ claimId: 12, dueAt: new Date("2026-09-01T12:00:00Z") });
    expect(state.updates[0]).toMatchObject({ status: "in_prüfung", dueAt: new Date("2026-09-01T12:00:00Z") });
    expect(state.events[0]).toMatchObject({ tenantId: 5, claimId: 12, eventType: "frist_gesetzt", previousStatus: "offen", nextStatus: "in_prüfung", actorUserId: 9 });
  });
});
