import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const updateCalls: unknown[] = [];
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 8 }]) })) })) })),
    update: vi.fn(() => ({ set: vi.fn((values: unknown) => ({ where: vi.fn(async () => { updateCalls.push(values); return []; }) })) })),
    insert: vi.fn(() => ({ values: vi.fn(async () => []) })),
  };
  return { db, updateCalls };
});

vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 41, slug: "test-mandant", name: "Test" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));

import { appRouter } from "./routers";

describe("Mandanten-Navigationspräferenzen", () => {
  beforeEach(() => { state.updateCalls.length = 0; vi.clearAllMocks(); });
  it("speichert ausgeblendete Bereiche am aktiven Mandanten", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);
    await caller.leadops.updateNavigationPreferences({ hiddenPages: ["Statistik", "E-Mails"] });
    expect(state.updateCalls[0]).toMatchObject({ navigationHiddenPages: ["Statistik", "E-Mails"] });
  });
  it("speichert auch, wenn fast alles ausgeblendet ist (21 von 23 Menüpunkten – früher still abgelehnt, „Gespräche“ kam wieder)", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);
    const all = ["Dashboard", "Leads", "Gebietskarte", "Lead-Kategorien", "Bestellungen", "Lieferkette", "Rohdaten", "Telefonie", "Gespräche", "Haustür-Erfassung", "Vertriebspipeline", "E-Mail-Kampagnen", "Verträge", "Automatisierung", "Kooperationen", "Teams", "Benutzer", "Integrationen", "Tags", "Reklamationen", "E-Mails", "Support", "Rechnungen"] as const;
    const hidden = all.filter((page) => page !== "Vertriebspipeline" && page !== "E-Mail-Kampagnen"); expect(hidden).toHaveLength(21);
    await caller.leadops.updateNavigationPreferences({ hiddenPages: [...hidden, "Gespräche"] }); // doppelt geschickt → einmal gespeichert
    expect(state.updateCalls[0]).toEqual({ navigationHiddenPages: hidden });
  });
});
