import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const updates: unknown[] = [];
  const tickets = [{ id: 5, tenantId: 1, ticketNumber: "SUP-ABCDE", subject: "Schaden am Dach", requesterName: "Max Beispiel", priority: "normal", status: "offen", updatedAt: new Date() }];
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(async () => tickets) })) })) })),
    update: vi.fn(() => ({ set: vi.fn((value: unknown) => ({ where: vi.fn(async () => { updates.push(value); return []; }) })) })),
  };
  return { db, updates, reset: () => { updates.length = 0; } };
});

vi.mock("./db", () => ({
  ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 1, slug: "mandant-1", name: "Test-Mandant" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })),
  getDb: vi.fn(async () => state.db),
  getTenantForUser: vi.fn(),
  listRecentLeads: vi.fn(),
}));

import { appRouter } from "./routers";

describe("Support-Ticket-Router", () => {
  beforeEach(() => { state.reset(); vi.clearAllMocks(); });

  it("sucht mandantenbezogen und speichert eine Ticketbearbeitung", async () => {
    const caller = appRouter.createCaller({ user: { id: 3 } } as never);
    const tickets = await caller.leadops.listTickets({ query: "Schaden", status: "offen" });
    await caller.leadops.updateTicketStatus({ id: 5, subject: "Schaden am Dach – Rückruf", requesterName: "Max Beispiel", priority: "hoch", status: "in_bearbeitung" });

    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ ticketNumber: "SUP-ABCDE", subject: "Schaden am Dach" });
    expect(state.updates[0]).toMatchObject({ subject: "Schaden am Dach – Rückruf", requesterName: "Max Beispiel", priority: "hoch", status: "in_bearbeitung" });
  });
});
