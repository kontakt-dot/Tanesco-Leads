import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const ensureTenantForUser = vi.fn();
const listRecentLeads = vi.fn();
const getDb = vi.fn();
const getTenantForUser = vi.fn();

vi.mock("./db", () => ({
  ensureTenantForUser,
  listRecentLeads,
  getDb,
  getTenantForUser,
}));

vi.mock("./stripe", () => ({
  catalog: [],
  requireStripe: () => {
    throw new Error("Stripe ist in diesem Test nicht verfügbar.");
  },
}));

function createProtectedContext(userRole: "admin" | "user" = "admin"): TrpcContext {
  return {
    user: {
      id: 42,
      openId: "admin-open-id",
      email: "admin@fluxora.test",
      name: "Admin Test",
      loginMethod: "manus",
      role: userRole,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("Mandanten-Erstanlage", async () => {
  const { appRouter } = await import("./routers");

  beforeEach(() => {
    vi.clearAllMocks();
    getDb.mockResolvedValue(null);
    getTenantForUser.mockResolvedValue(undefined);
    listRecentLeads.mockResolvedValue([]);
  });

  it("stellt für Administratoren bei einer geschützten Abfrage automatisch einen aktiven Mandanten bereit", async () => {
    ensureTenantForUser.mockResolvedValue({
      tenant: { id: 7, name: "Fluxora Operations", slug: "workspace-42" },
      membership: { tenantId: 7, userId: 42, role: "inhaber", status: "aktiv" },
    });

    const caller = appRouter.createCaller(createProtectedContext("admin"));
    const result = await caller.leadops.dashboard();

    expect(ensureTenantForUser).toHaveBeenCalledWith(42);
    expect(listRecentLeads).toHaveBeenCalledWith(7, 10, { categoryId: null, from: null, until: null }); // Lead-Puls ohne Filter
    expect(result).toMatchObject({
      tenant: { id: 7, slug: "workspace-42" },
      kpis: { delivered: 0, revenue: 0, registrations: 0, complaints: 0 },
    });
  });

  it("lehnt geschützte Abfragen ohne automatisch bereitstellbaren Mandanten weiterhin ab", async () => {
    ensureTenantForUser.mockResolvedValue(undefined);

    const caller = appRouter.createCaller(createProtectedContext("user"));

    await expect(caller.leadops.dashboard()).rejects.toThrow("Für diesen Benutzer ist kein aktiver Mandant hinterlegt.");
    expect(listRecentLeads).not.toHaveBeenCalled();
  });
});
