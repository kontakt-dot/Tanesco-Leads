import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCategoryCsvHeaders, buildCategoryParameterSheet, buildProtectedCategoryWorkspaceContract } from "../client/src/components/lead-category-contract";

const state = vi.hoisted(() => {
  let step = 0;
  const rows = [[{ id: 1, tenantId: 41, categoryId: 55, label: "Stromverbrauch", fieldKey: "stromverbrauch", fieldType: "zahl", sortOrder: 0 }], [{ id: 2, tenantId: 41, categoryId: 55, sourceField: "record_file", targetFieldKey: "recording", mode: "umschreiben", sortOrder: 0 }]];
  const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(async () => rows[step++]) })) })) })) };
  return { db, reset: () => { step = 0; } };
});
vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 41, slug: "test", name: "Test" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));
import { appRouter } from "./routers";

describe("Geschützter PV-Arbeitsbereich", () => {
  beforeEach(() => { state.reset(); vi.clearAllMocks(); });
  it("verbindet geschützte Felder und Mappings mit PV-Direktlink, allen Tabs und Betriebswerkzeugen", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);
    const fields = await caller.leadops.listCategoryFields({ categoryId: 55 });
    const mappings = await caller.leadops.listCategoryFieldMappings({ categoryId: 55 });
    const workspace = buildProtectedCategoryWorkspaceContract({ tenantId: fields[0].tenantId, categoryId: 55 });
    expect(workspace).toMatchObject({ directLink: "/?page=Lead-Kategorien&categoryId=55", tabs: ["settings", "fields", "mapping"], tools: ["CSV-Vorlage", "Parameterblatt"], tenantId: 41 });
    expect(buildCategoryCsvHeaders(fields)).toContain("stromverbrauch");
    expect(buildCategoryParameterSheet({ name: "PV", shortcode: "PV", priority: "1", pipeline: "Partner-Pipeline", fields, mappings, labelForFieldType: (type) => type })).toContain("record_file → recording");
  });
});
