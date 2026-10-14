import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  let step = 0;
  const rows = [[{ id: 1, tenantId: 41, categoryId: 55, label: "Stromverbrauch", fieldKey: "stromverbrauch", fieldType: "zahl", sortOrder: 0 }], [{ id: 2, tenantId: 41, categoryId: 55, sourceField: "record_file", targetFieldKey: "recording", mode: "umschreiben", sortOrder: 0 }]];
  const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(async () => rows[step++]) })) })) })) };
  return { db, reset: () => { step = 0; } };
});
vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 41, slug: "test", name: "Test" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));
import { appRouter } from "./routers";

describe("PV-Kategoriezugriff", () => {
  beforeEach(() => { state.reset(); vi.clearAllMocks(); });
  it("liefert Feldbibliothek und Datenharmonisierung über geschützte Mandantenverfahren", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);
    const [fields, mappings] = await Promise.all([caller.leadops.listCategoryFields({ categoryId: 55 }), caller.leadops.listCategoryFieldMappings({ categoryId: 55 })]);
    expect(fields).toEqual([expect.objectContaining({ tenantId: 41, fieldKey: "stromverbrauch" })]);
    expect(mappings).toEqual([expect.objectContaining({ tenantId: 41, sourceField: "record_file", targetFieldKey: "recording" })]);
  });
});
