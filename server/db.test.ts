import { describe, expect, it, vi } from "vitest";
import { ensureTenantForUserWithDb } from "./db";

function createDbMock(options: {
  existingMembership?: { tenant: { id: number; slug: string; name: string }; membership: { tenantId: number; userId: number; role: string; status: string } };
  user?: { id: number; name: string | null; role: "admin" | "user" } | undefined;
  existingTenant?: { id: number; slug: string; name: string } | undefined;
  createdTenant?: { id: number; slug: string; name: string } | undefined;
}) {
  const insertCalls: Array<{ table: unknown; values: unknown; duplicate?: unknown }> = [];
  let stage = 0;

  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table) => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => {
              stage += 1;
              if (stage === 1) return options.existingMembership ? [options.existingMembership] : [];
              if (stage === 5) {
                return options.createdTenant && options.user
                  ? [{ tenant: options.createdTenant, membership: { tenantId: options.createdTenant.id, userId: options.user.id, role: "inhaber", status: "aktiv" } }]
                  : [];
              }
              return [];
            }),
          })),
        })),
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            stage += 1;
            if (stage === 2) return options.user ? [options.user] : [];
            if (stage === 3) return options.existingTenant ? [options.existingTenant] : [];
            if (stage === 4) return options.createdTenant ? [options.createdTenant] : [];
            return [];
          }),
        })),
      })),
    })),
    insert: vi.fn((table) => ({
      values: vi.fn((values) => {
        insertCalls.push({ table, values });
        return {
          onDuplicateKeyUpdate: vi.fn(({ set }) => {
            insertCalls[insertCalls.length - 1] = { table, values, duplicate: set };
            return Promise.resolve();
          }),
        };
      }),
    })),
  };

  return { db, insertCalls };
}

describe("ensureTenantForUserWithDb", () => {
  it("legt für Administratoren ohne aktiven Mandanten Tenant und Membership an", async () => {
    const createdTenant = { id: 11, slug: "workspace-42", name: "Admin Test – Fluxora" };
    const { db, insertCalls } = createDbMock({
      user: { id: 42, name: "Admin Test", role: "admin" },
      createdTenant,
    });

    const result = await ensureTenantForUserWithDb(db as never, 42);

    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0]?.values).toMatchObject({ slug: "workspace-42", name: "Admin Test – Fluxora" });
    expect(insertCalls[1]?.values).toMatchObject({ tenantId: 11, userId: 42, role: "inhaber", status: "aktiv" });
    expect(result).toMatchObject({ tenant: createdTenant, membership: { tenantId: 11, userId: 42, status: "aktiv" } });
  });

  it("erstellt für Nicht-Administratoren keinen Mandanten", async () => {
    const { db, insertCalls } = createDbMock({
      user: { id: 7, name: "User Test", role: "user" },
    });

    const result = await ensureTenantForUserWithDb(db as never, 7);

    expect(result).toBeUndefined();
    expect(insertCalls).toHaveLength(0);
  });
});
