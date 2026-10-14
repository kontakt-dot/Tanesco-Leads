import { describe, expect, it, vi } from "vitest";

const inserted: unknown[] = [];
const db = {
  insert: vi.fn(() => ({ values: vi.fn(async (value: unknown) => { inserted.push(value); return [{ insertId: 904 }]; }) })),
};

vi.mock("./db", () => ({
  ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 72, slug: "test", name: "Tanesco Leads" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })),
  getDb: vi.fn(async () => db),
  getTenantForUser: vi.fn(),
  listRecentLeads: vi.fn(),
}));

import { appRouter } from "./routers";

describe("Anlage einer Builder-Integration", () => {
  it("speichert einen inaktiven echten Schnittstellenentwurf und gibt dessen ID zurück", async () => {
    const caller = appRouter.createCaller({ user: { id: 21 } } as never);
    await expect(caller.leadops.createPartnerIntegration({
      provider: "custom_api",
      name: "Partner CRM",
      callbackUrl: "https://partner.example/api/leads",
      status: "inaktiv",
      config: { direction: "ausgehend", authMethod: "bearer", processes: ["lead_export"], builderCreated: true },
    })).resolves.toEqual({ success: true, integrationId: 904 });
    expect(inserted[0]).toMatchObject({ tenantId: 72, name: "Partner CRM", status: "inaktiv" });
  });
});
