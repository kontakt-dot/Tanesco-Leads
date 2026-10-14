import { and, desc, eq, gte, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { InsertUser, leads, memberships, tenants, users } from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId, lastSignedIn: user.lastSignedIn ?? new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: values.lastSignedIn };
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.role) { values.role = user.role; updateSet.role = user.role; }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  return rows[0];
}

export async function countUsers() {
  const db = await getDb();
  if (!db) return 0;
  return (await db.select({ id: users.id }).from(users)).length;
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getTenantForUser(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select({ tenant: tenants, membership: memberships })
    .from(memberships)
    .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "aktiv")))
    .limit(1);
  return result[0];
}

type DbLike = Pick<MySql2Database<Record<string, never>>, "select" | "insert">;

export async function ensureTenantForUserWithDb(db: DbLike, userId: number) {
  const existing = await db
    .select({ tenant: tenants, membership: memberships })
    .from(memberships)
    .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "aktiv")))
    .limit(1);
  if (existing[0]) return existing[0];

  const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!user || user.role !== "admin") return undefined;

  const slug = `workspace-${userId}`;
  let tenant = (await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1))[0];
  if (!tenant) {
    await db.insert(tenants).values({ slug, name: user.name ? `${user.name} – Fluxora` : "Fluxora Operations" });
    tenant = (await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1))[0];
  }
  if (!tenant) return undefined;

  await db
    .insert(memberships)
    .values({ tenantId: tenant.id, userId, role: "inhaber", status: "aktiv" })
    .onDuplicateKeyUpdate({ set: { role: "inhaber", status: "aktiv" } });

  const created = await db
    .select({ tenant: tenants, membership: memberships })
    .from(memberships)
    .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "aktiv")))
    .limit(1);
  return created[0];
}

export async function ensureTenantForUser(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  return ensureTenantForUserWithDb(db, userId);
}

export async function listRecentLeads(tenantId: number, limit = 10, filter: { categoryId?: number | null; from?: Date | null; until?: Date | null } = {}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(leads.tenantId, tenantId), eq(leads.kind, "verkauf")];
  if (filter.categoryId) conditions.push(eq(leads.categoryId, filter.categoryId));
  if (filter.from) conditions.push(gte(leads.createdAt, filter.from));
  if (filter.until) conditions.push(lte(leads.createdAt, filter.until));
  return db
    .select()
    .from(leads)
    .where(and(...conditions))
    .orderBy(desc(leads.createdAt))
    .limit(limit);
}
