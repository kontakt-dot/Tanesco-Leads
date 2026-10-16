/**
 * Vertriebler der Vertriebspipeline: anlegen (mit oder ohne eigenen Zugang), umbenennen, pausieren – und die beiden
 * Standard-Vertriebler „Taner“ und „Francesco“ auf Knopfdruck. Ein Vertriebler ist ein interner Benutzer mit der
 * Rolle „vertrieb“ (so findet ihn `pipelineOwners`); ohne E-Mail/Passwort hat er keinen Login, bekommt aber Karten,
 * Termine und Ziele wie jeder andere.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { leads, memberships, teams, users } from "../drizzle/schema";
import { hashPassword } from "./_core/auth";
import type { Db } from "./lead-pipeline";
import { lostStage, stagesForLead, wonStage } from "../shared/sales-pipeline";

export const DEFAULT_SALES_REPS = ["Taner", "Francesco"] as const;
const firstNameOf = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";
const initialsOf = (name: string) => name.split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
const isSalesRole = (row: { role: string; team: string | null }) => row.role === "vertrieb" || /vertrieb|sales/i.test(row.team ?? "");

export async function listSalesReps(db: Db, tenantId: number) {
  const rows = await db.select({ membershipId: memberships.id, userId: users.id, name: users.name, email: users.email, loginMethod: users.loginMethod, passwordHash: users.passwordHash, status: memberships.status, role: memberships.role, partnerType: memberships.partnerType, team: teams.name, createdAt: memberships.createdAt })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).leftJoin(teams, eq(teams.id, memberships.teamId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.partnerType, "intern"), ne(memberships.status, "eingeladen")));
  const reps = rows.filter(isSalesRole);
  const ids = reps.map((row) => row.userId);
  const cards = ids.length ? await db.select({ ownerUserId: leads.ownerUserId, pipelineStage: leads.pipelineStage, adPlatform: leads.adPlatform }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "vertrieb"), inArray(leads.ownerUserId, ids))) : [];
  const { pipelineStageSets } = await import("./meta-ads"); const sets = await pipelineStageSets(db, tenantId);
  const openOf = (userId: number) => cards.filter((card) => card.ownerUserId === userId && card.pipelineStage !== wonStage(stagesForLead(sets, card)) && card.pipelineStage !== lostStage(stagesForLead(sets, card))).length;
  const wonOf = (userId: number) => cards.filter((card) => card.ownerUserId === userId && card.pipelineStage === wonStage(stagesForLead(sets, card))).length;
  return reps.map((row) => { const name = (row.name ?? row.email ?? `Benutzer ${row.userId}`).trim(); return { userId: row.userId, membershipId: row.membershipId, name, firstName: firstNameOf(name), initials: initialsOf(name), email: row.email, hasLogin: Boolean(row.passwordHash || (row.loginMethod && row.loginMethod !== "ohne")), active: row.status === "aktiv", openCards: openOf(row.userId), wonCards: wonOf(row.userId), createdAt: row.createdAt }; }).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "de"));
}

/** Team „Vertrieb“ des Mandanten (wird beim ersten Vertriebler angelegt, damit die Zuordnung auch über das Team greift). */
async function salesTeamId(db: Db, tenantId: number) {
  const existing = (await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.tenantId, tenantId))).find((team) => /vertrieb|sales/i.test(team.name));
  if (existing) return existing.id;
  const inserted = await db.insert(teams).values({ tenantId, name: "Vertrieb", description: "Vertriebler der Vertriebspipeline", color: "#8178ff" });
  return Number(inserted[0]?.insertId) || null;
}

export type CreateSalesRepInput = { name: string; email?: string | null; password?: string | null; actorUserId?: number | null };
/**
 * Vertriebler anlegen. Mit E-Mail + Passwort entsteht ein Zugang (Rolle Vertriebler); nur mit Namen ein Eintrag ohne Login.
 * Gibt es die E-Mail schon als Benutzer, wird sie dem Lead-Bereich als Vertriebler hinzugefügt.
 */
export async function createSalesRep(db: Db, tenantId: number, input: CreateSalesRepInput) {
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 120); if (name.length < 2) throw new Error("Bitte einen Namen angeben.");
  const email = input.email?.trim().toLowerCase() || null; if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Bitte eine gültige E-Mail-Adresse angeben.");
  const password = input.password?.trim() || null; if (password && password.length < 8) throw new Error("Das Passwort braucht mindestens 8 Zeichen."); if (password && !email) throw new Error("Für einen Zugang braucht der Vertriebler eine E-Mail-Adresse.");
  const existing = await listSalesReps(db, tenantId);
  if (existing.some((rep) => rep.name.toLowerCase() === name.toLowerCase())) throw new Error(`„${name}“ gibt es schon als Vertriebler.`);
  let userId: number | null = null;
  if (email) {
    const known = (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1))[0];
    if (known) {
      userId = known.id;
      const member = (await db.select({ id: memberships.id, role: memberships.role }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId))).limit(1))[0];
      if (member) { await db.update(memberships).set({ role: "vertrieb", partnerType: "intern", status: "aktiv", teamId: await salesTeamId(db, tenantId) }).where(eq(memberships.id, member.id)); if (password) await db.update(users).set({ passwordHash: await hashPassword(password), loginMethod: "password" }).where(eq(users.id, userId)); return { userId, created: false as const, hasLogin: true }; }
      if (password) await db.update(users).set({ passwordHash: await hashPassword(password), loginMethod: "password" }).where(eq(users.id, userId));
    }
  }
  if (!userId) {
    const openId = `rep_${nanoid(20)}`;
    await db.insert(users).values({ openId, name, email, loginMethod: password ? "password" : "ohne", passwordHash: password ? await hashPassword(password) : null, role: "user", firstName: name.split(" ")[0] ?? name, lastName: name.split(" ").slice(1).join(" ") || null });
    userId = (await db.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1))[0]?.id ?? null;
  }
  if (!userId) throw new Error("Der Vertriebler konnte nicht angelegt werden.");
  await db.insert(memberships).values({ tenantId, userId, role: "vertrieb", partnerType: "intern", status: "aktiv", teamId: await salesTeamId(db, tenantId) });
  return { userId, created: true as const, hasLogin: Boolean(password) };
}

/** Umbenennen, E-Mail ändern, pausieren/aktivieren – ein pausierter Vertriebler bekommt keine neuen Karten, behält aber seine. */
export async function updateSalesRep(db: Db, tenantId: number, input: { userId: number; name?: string | null; email?: string | null; active?: boolean | null }) {
  const member = (await db.select({ id: memberships.id, role: memberships.role, status: memberships.status }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, input.userId))).limit(1))[0];
  if (!member) throw new Error("Vertriebler nicht gefunden.");
  if (input.name !== undefined && input.name !== null) { const name = input.name.trim().replace(/\s+/g, " ").slice(0, 120); if (name.length < 2) throw new Error("Bitte einen Namen angeben."); await db.update(users).set({ name, firstName: name.split(" ")[0] ?? name, lastName: name.split(" ").slice(1).join(" ") || null }).where(eq(users.id, input.userId)); }
  if (input.email !== undefined) { const email = input.email?.trim().toLowerCase() || null; if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Bitte eine gültige E-Mail-Adresse angeben."); if (email) { const clash = (await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), ne(users.id, input.userId))).limit(1))[0]; if (clash) throw new Error("Diese E-Mail-Adresse gehört schon einem anderen Benutzer."); } await db.update(users).set({ email }).where(eq(users.id, input.userId)); }
  if (typeof input.active === "boolean") await db.update(memberships).set({ status: input.active ? "aktiv" : "deaktiviert" }).where(eq(memberships.id, member.id));
  return { success: true as const };
}

/** Die Standard-Vertriebler (Taner, Francesco) anlegen, sofern sie fehlen – Vergleich über den Vornamen. */
export async function ensureDefaultSalesReps(db: Db, tenantId: number, actorUserId: number | null) {
  const existing = await listSalesReps(db, tenantId);
  const created: string[] = [];
  for (const name of DEFAULT_SALES_REPS) {
    if (existing.some((rep) => rep.firstName.toLowerCase() === name.toLowerCase())) continue;
    await createSalesRep(db, tenantId, { name, actorUserId }); created.push(name);
  }
  return { created, reps: await listSalesReps(db, tenantId) };
}
