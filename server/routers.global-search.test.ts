import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  let selectStep = 0;
  const rows = [
    [{ publicId: "LX-100", firstName: "Mira", lastName: "Scholz", email: "mira@example.de", city: "Köln", status: "neu" }],
    [{ orderNumber: "ORD-100", buyerName: "Mira Energie", status: "aktiv", quantity: 12 }],
    [{ membershipId: 8, name: "Mira Scholz", email: "mira@example.de", role: "manager", status: "aktiv" }],
    [{ publicId: "KALT-MIRA1", firstName: "Mira", lastName: "Dach", company: "Mira Dach GmbH", city: "Köln", stage: "neu", adPlatform: "kaltakquise" }],
  ];
  const db = {
    select: vi.fn(() => {
      const result = rows[selectStep++] ?? [];
      const where = vi.fn(() => ({ limit: vi.fn(async () => result) }));
      return { from: vi.fn(() => ({ where, innerJoin: vi.fn(() => ({ where })) })) };
    }),
  };
  return { db, reset: () => { selectStep = 0; } };
});

vi.mock("./db", () => ({
  ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 1, slug: "mandant-1", name: "Test-Mandant" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })),
  getDb: vi.fn(async () => state.db),
  getTenantForUser: vi.fn(),
  listRecentLeads: vi.fn(),
}));

import { appRouter } from "./routers";

describe("Globale Suche", () => {
  beforeEach(() => { state.reset(); vi.clearAllMocks(); });

  it("liefert Leads, Bestellungen, Mitglieder und Vertriebskontakte getrennt aus dem aktiven Mandanten", async () => {
    const caller = appRouter.createCaller({ user: { id: 2 } } as never);
    const result = await caller.leadops.globalSearch({ query: "Mira", limit: 6 });

    expect(result).toEqual({
      leads: [expect.objectContaining({ publicId: "LX-100", firstName: "Mira" })],
      orders: [expect.objectContaining({ orderNumber: "ORD-100", buyerName: "Mira Energie" })],
      members: [expect.objectContaining({ membershipId: 8, name: "Mira Scholz", role: "manager" })],
      prospects: [expect.objectContaining({ publicId: "KALT-MIRA1", company: "Mira Dach GmbH", adPlatform: "kaltakquise" })],
    });
  });
});
