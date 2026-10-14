import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const insertCalls: unknown[] = []; let selectStep = 0;
  const integration = { id: 81, tenantId: 1, name: "PV-Partner", provider: "webhook", callbackUrl: "https://partner.example/leads", config: { authMethod: "ohne" }, status: "aktiv" };
  const lead = { id: 101, tenantId: 1, publicId: "PV-1001", categoryId: 150001, firstName: "Anna", lastName: "Muster", email: "anna@example.de", phone: "01234", postcode: "50667", city: "Köln", country: "DE", metadata: { dachausrichtung: "Süd" } };
  const query = (value: unknown) => ({ limit: vi.fn(async () => value), then: (resolve: (result: unknown) => unknown) => Promise.resolve(value).then(resolve) });
  const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => query(selectStep++ === 0 ? [integration] : [lead])) })) })), insert: vi.fn(() => ({ values: vi.fn(async (value: unknown) => { insertCalls.push(value); return []; }) })) };
  return { db, insertCalls, reset: () => { insertCalls.length = 0; selectStep = 0; } };
});

vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 1, slug: "organisation-1", name: "Testorganisation" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));
vi.mock("./lead-integration-export", () => ({ dispatchLeadExport: vi.fn(async () => ({ eventType: "geliefert", externalReference: "OUT-4711", responseStatus: 201, responseBody: "accepted" })) }));

import { appRouter } from "./routers";

describe("Partnerexport-Router", () => {
  beforeEach(() => { state.reset(); vi.clearAllMocks(); });

  it("speichert Vorgangsreferenz, HTTP-Ergebnis und Rückmeldung im Integrationsereignis", async () => {
    const caller = appRouter.createCaller({ user: { id: 4 } } as never);
    await expect(caller.leadops.exportLeadToPartnerIntegration({ integrationId: 81, publicId: "PV-1001" })).resolves.toEqual({ eventType: "geliefert", externalReference: "OUT-4711", responseStatus: 201, responseBody: "accepted" });
    expect(state.insertCalls).toContainEqual(expect.objectContaining({ tenantId: 1, integrationId: 81, leadId: 101, categoryId: 150001, eventType: "geliefert", externalReference: "OUT-4711", responseStatus: 201, responseBody: "accepted" }));
  });
});
