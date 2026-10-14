import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  let selectStep = 0;
  const integrations = [{ id: 9, name: "Partner API", provider: "custom_api", callbackUrl: "https://partner.example/leads", config: { authMethod: "bearer" }, status: "aktiv", credentialsEncrypted: "encrypted-value" }];
  const events = [{ integrationId: 9, eventType: "abgelehnt", responseStatus: 401, responseBody: "unauthorized", externalReference: "OUT-9", occurredAt: new Date("2026-08-19T12:00:00Z") }];
  const query = (value: unknown) => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn(async () => value) })) })) })) });
  const db = { select: vi.fn(() => query(selectStep++ === 0 ? integrations : events)) };
  return { db, reset: () => { selectStep = 0; vi.clearAllMocks(); } };
});

const invoke = vi.hoisted(() => vi.fn(async () => ({ choices: [{ message: { content: "Der Bearer-Zugang wurde abgelehnt. Prüfen Sie den Token." } }] })));
vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 8, slug: "test", name: "Tanesco Leads" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));
vi.mock("./_core/llm", () => ({ invokeLLM: invoke }));
import { appRouter } from "./routers";

describe("Tanesco KI-Assistenz", () => {
  beforeEach(() => state.reset());
  it("wertet aktuelle Fehlerereignisse des aktiven Lead-Bereichs aus, ohne Zugangsdaten auszugeben", async () => {
    const caller = appRouter.createCaller({ user: { id: 11 } } as never);
    const result = await caller.leadops.askTanescoAssistant({ mode: "integration", question: "Prüfen Sie Fehler." });
    expect(result.answer).toContain("Bearer-Zugang");
    expect(result.observedErrors).toBe(1);
    const serializedContext = JSON.stringify(invoke.mock.calls[0][0]);
    expect(serializedContext).toContain("credentialConfigured");
    expect(serializedContext).not.toContain("encrypted-value");
  });
});
