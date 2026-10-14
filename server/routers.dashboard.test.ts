import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  leads: [
    { id: 1, status: "neu", cost: "0.00", createdAt: new Date("2026-08-17T10:00:00.000Z"), email: "Kontakt@Beispiel.de", phone: "+49 171 1234567" },
    { id: 2, status: "zugewiesen", cost: "60.00", createdAt: new Date("2026-08-17T10:05:00.000Z"), email: "kontakt@beispiel.de", phone: "0171-1234567" },
    { id: 3, status: "zugewiesen", cost: "35.00", createdAt: new Date("2026-08-17T10:10:00.000Z"), email: "neu@example.de", phone: "0171123458" },
    { id: 4, status: "reklamiert", cost: "0.00", createdAt: new Date("2026-08-17T10:15:00.000Z"), email: "reklamation@example.de", phone: "0171123459" },
  ],
}));

vi.mock("./db", () => ({
  ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 1, slug: "mandant-1", name: "Test-Mandant" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })),
  getDb: vi.fn(),
  getTenantForUser: vi.fn(),
  listRecentLeads: vi.fn(async () => state.leads),
}));

import { appRouter } from "./routers";

describe("Dashboard-Router", () => {
  it("liefert alle Dashboard-KPIs aus gemischten Mandantenleads einschließlich normalisierter Dubletten", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);
    const dashboard = await caller.leadops.dashboard();

    expect(dashboard.kpis).toEqual({ delivered: 2, revenue: 95, registrations: 1, duplicates: 2, complaints: 1 });
  });
});
