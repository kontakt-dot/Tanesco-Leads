import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const inserts: unknown[] = [];
  const selectedRows: unknown[][] = [];
  const deletes: unknown[] = [];
  const updates: unknown[] = [];
  const insert = vi.fn(() => ({ values: vi.fn((value: unknown) => { inserts.push(value); return { onDuplicateKeyUpdate: vi.fn(async () => []) }; }) }));
  const select = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => { const rows = selectedRows.shift() ?? []; return { limit: vi.fn(async () => rows), then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) }; }) })) }));
  const remove = vi.fn(() => ({ where: vi.fn(async (where: unknown) => { deletes.push(where); return []; }) }));
  const update = vi.fn(() => ({ set: vi.fn((value: unknown) => ({ where: vi.fn(async () => { updates.push(value); return []; }) })) }));
  const tx = { insert, delete: remove, update };
  const db = { transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)), select, insert, delete: remove, update };
  return { db, inserts, selectedRows, deletes, updates, reset: () => { inserts.length = 0; selectedRows.length = 0; deletes.length = 0; updates.length = 0; vi.clearAllMocks(); } };
});

vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 41, slug: "test", name: "Test" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => state.db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));
import { appRouter } from "./routers";

describe("Operative Käufer- und Lieferantenprofile", () => {
  beforeEach(() => state.reset());

  it("legt einen Lieferanten ohne Benutzerkonto an und stellt ihn für die Lead-Zuordnung bereit", async () => {
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);
    await caller.leadops.createOrganizationProfile({ partnerType: "lieferant", name: "Nordlicht Vertrieb", email: "kontakt@nordlicht.example" });
    expect(state.inserts).toContainEqual(expect.objectContaining({ tenantId: 41, partnerType: "lieferant", name: "Nordlicht Vertrieb" }));
    expect(state.inserts).toContainEqual(expect.objectContaining({ tenantId: 41, name: "Nordlicht Vertrieb", status: "aktiv" }));
  });

  it("verschiebt ein ungenutztes Lieferantenprofil sicher in den Papierkorb", async () => {
    state.selectedRows.push([{ id: 19, partnerType: "lieferant", name: "Nordlicht Vertrieb" }], [], [{ id: 81 }], [], [], []);
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);

    await expect(caller.leadops.deleteOrganizationProfile({ id: 19 })).resolves.toMatchObject({ success: true, archived: true, profile: { name: "Nordlicht Vertrieb", partnerType: "lieferant" } });

    expect(state.updates).toContainEqual(expect.objectContaining({ archivedByUserId: 7 }));
    expect(state.deletes).toHaveLength(0);
  });

  it("liefert konkrete Lead-Blocker statt ein verknüpftes Lieferantenprofil zu archivieren", async () => {
    state.selectedRows.push([{ id: 19, partnerType: "lieferant", name: "Nordlicht Vertrieb" }], [], [{ id: 81 }], [{ id: 501 }], [], []);
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);

    await expect(caller.leadops.deleteOrganizationProfile({ id: 19 })).resolves.toMatchObject({ success: false, archived: false, leads: [{ id: 501 }] });
    expect(state.deletes).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });

  it("aktualisiert Namen und Kontaktdaten eines Käuferprofils nachträglich", async () => {
    state.selectedRows.push([{ id: 11, partnerType: "käufer", name: "Alt GmbH", archivedAt: null }], []);
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);

    await expect(caller.leadops.updateOrganizationProfile({ id: 11, name: "Neu GmbH", email: "kontakt@neu.example", phone: "030 123456" })).resolves.toEqual({ success: true });
    expect(state.updates).toContainEqual(expect.objectContaining({ name: "Neu GmbH", email: "kontakt@neu.example", phone: "030 123456" }));
  });

  it("stellt ein archiviertes Lieferantenprofil innerhalb der Wiederherstellungsfrist wieder her", async () => {
    state.selectedRows.push([{ id: 19, partnerType: "lieferant", name: "Nordlicht Vertrieb", email: "kontakt@nordlicht.example", status: "aktiv", archivedAt: new Date() }]);
    const caller = appRouter.createCaller({ user: { id: 7 } } as never);

    await expect(caller.leadops.restoreOrganizationProfile({ id: 19 })).resolves.toMatchObject({ success: true, name: "Nordlicht Vertrieb" });
    expect(state.updates).toContainEqual({ archivedAt: null, archivedByUserId: null });
    expect(state.inserts).toContainEqual(expect.objectContaining({ tenantId: 41, name: "Nordlicht Vertrieb" }));
  });
});
