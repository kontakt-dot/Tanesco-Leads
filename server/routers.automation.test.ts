import { beforeEach, describe, expect, it, vi } from "vitest";
import { automationRules, leads } from "../drizzle/schema";
import { createFakeDb } from "./test-fake-db";

const state = vi.hoisted(() => ({ fake: null as ReturnType<typeof import("./test-fake-db").createFakeDb> | null }));
vi.mock("./db", () => ({
  ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 1, slug: "mandant-1", name: "Test-Mandant" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })),
  getDb: vi.fn(async () => state.fake!.db),
  getTenantForUser: vi.fn(),
  listRecentLeads: vi.fn(),
}));

import { appRouter } from "./routers";

const source = { id: 91, tenantId: 1, publicId: "SRC-0001", categoryId: 11, firstName: "Anna", lastName: "Muster", email: "anna@example.de", phone: "0171123456", postcode: "10115", city: "Berlin", country: "DE", supplierId: null, supplierName: null, assignedUserId: null, cost: "0.00", metadata: {}, status: "neu" };
const baseRule = { id: 7, tenantId: 1, name: "PV in Zielkategorie", triggerType: "lead_erstellt", sourceCategoryId: 11, targetCategoryId: 22, supplierId: null, conditionMode: "alle", conditions: [] as Array<{ field: string; operator: "gleich"; value: string }>, actionType: "lead_typ_duplizieren", actionConfig: null, falseActionType: null as "lead_pruefen" | null, falseActionConfig: null, status: "aktiv" };

describe("Automatisierungs-Router", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("dupliziert einen passenden Lead und protokolliert die erzeugte Lead-ID", async () => {
    state.fake = createFakeDb([[leads, [source]], [automationRules, [baseRule]]], { onceTables: [automationRules] });
    const caller = appRouter.createCaller({ user: { id: 9 } } as never);
    const result = await caller.leadops.runLeadAutomation({ publicId: "SRC-0001", triggerType: "lead_erstellt" });

    expect(result).toEqual({ duplicated: 1, executed: 1, delivered: 0 });
    const created = state.fake.insertCalls.find((call) => call.table === "leads")!;
    expect(created.values).toMatchObject({ tenantId: 1, categoryId: 22, firstName: "Anna", status: "genehmigt" });
    const createdRow = state.fake.rows(leads).find((row) => row.publicId === created.values.publicId)!;
    expect(state.fake.insertCalls.find((call) => call.table === "automationExecutionLogs")!.values).toMatchObject({ tenantId: 1, ruleId: 7, sourceLeadId: 91, createdLeadId: createdRow.id, result: "ausgeführt" });
  });

  it("führt bei nicht erfüllter Bedingung die konfigurierte Negativaktion aus", async () => {
    state.fake = createFakeDb([[leads, [source]], [automationRules, [{ ...baseRule, conditions: [{ field: "city", operator: "gleich", value: "München" }], falseActionType: "lead_pruefen" }]]], { onceTables: [automationRules] });
    const caller = appRouter.createCaller({ user: { id: 9 } } as never);
    const result = await caller.leadops.runLeadAutomation({ publicId: "SRC-0001", triggerType: "lead_erstellt" });

    expect(result).toEqual({ duplicated: 0, executed: 1, delivered: 0 });
    expect(state.fake.updateCalls.some((call) => call.table === "leads" && call.values.status === "hängend")).toBe(true);
    expect(state.fake.insertCalls.at(-1)!.values).toMatchObject({ tenantId: 1, ruleId: 7, result: "ausgeführt", summary: "Trifft nicht zu: Leadstatus auf hängend gesetzt" });
  });

  it("ordnet eine Bestellung zu und liefert in Echtzeit aus, wenn die Bestellkonfiguration es vorsieht", async () => {
    const { deliveryChains, deliveryStops, orderOperationalConfigs, orders } = await import("../drizzle/schema");
    state.fake = createFakeDb([
      [leads, [{ ...source, supplierId: 3 }]],
      [automationRules, [{ ...baseRule, actionType: "lead_bestellung_zuordnen", actionConfig: { orderId: 5 } }]],
      [orders, [{ id: 5, tenantId: 1, orderNumber: "ORD-TEST", status: "aktiv", quantity: 10, deliveredCount: 0 }]],
      [orderOperationalConfigs, [{ id: 1, tenantId: 1, orderId: 5, active: true, ongoing: true, startsAt: null, endsAt: null, deliveryDays: [], pauses: [], requestedQuantity: 10, advancedFilters: null, supplierRestrictions: null, realtimeDelivery: true, buyerUserId: null }]],
      [deliveryChains, [{ id: 21, tenantId: 1, orderId: 5, categoryId: 11, name: "Kette A", priority: 1, status: "aktiv", roundRobinCursor: 0 }]],
      [deliveryStops, [{ id: 31, chainId: 21, buyerName: "Käufer A", position: 1, unitPrice: "40.00", active: true }]],
    ], { onceTables: [automationRules] });
    const caller = appRouter.createCaller({ user: { id: 9 } } as never);
    const result = await caller.leadops.runLeadAutomation({ publicId: "SRC-0001", triggerType: "lead_erstellt" });

    expect(result).toEqual({ duplicated: 0, executed: 1, delivered: 1 });
    expect(state.fake.insertCalls.find((call) => call.table === "leadDeliveries")!.values).toMatchObject({ leadId: 91, chainId: 21, orderId: 5, buyerName: "Käufer A", result: "angeboten" });
    expect(state.fake.updateCalls.some((call) => call.table === "orders" && call.values.deliveredCount === 1)).toBe(true);
    expect(state.fake.insertCalls.at(-1)!.values).toMatchObject({ result: "ausgeführt", summary: "Bestellung ORD-TEST zugeordnet; ausgeliefert an Käufer A" });
  });
});
