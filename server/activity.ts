/**
 * Verlauf der Plattform (Glocke oben rechts).
 *
 * `logActivity` schreibt einen Eintrag und darf nie eine Aktion scheitern lassen – Fehler werden nur geloggt.
 * `activityFeed` liefert die Einträge der letzten Tage als Tagesverlauf (shared/activity.ts gruppiert sie)
 * plus die Zahl der Einträge seit dem letzten Öffnen der Glocke (für den roten Punkt).
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { activityLog, leads, users } from "../drizzle/schema";
import { countSince, groupActivity, type ActivityEntry, type ActivityKind } from "../shared/activity";
import type { Db } from "./lead-pipeline";

export type ActivityInput = { kind: ActivityKind; title: string; detail?: string | null; count?: number; leadId?: number | null; actorUserId?: number | null; refType?: string | null; refId?: number | null };

export async function logActivity(db: Db, tenantId: number, input: ActivityInput): Promise<number | null> {
  try {
    const inserted = await db.insert(activityLog).values({ tenantId, kind: input.kind, title: input.title.slice(0, 200), detail: input.detail ? input.detail.slice(0, 400) : null, count: Math.max(1, Math.round(input.count ?? 1)), leadId: input.leadId ?? null, actorUserId: input.actorUserId ?? null, refType: input.refType ?? null, refId: input.refId ?? null });
    return Number(inserted[0]?.insertId) || null;
  } catch (error) {
    console.error("[activity] Eintrag konnte nicht geschrieben werden:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Einen bestehenden Eintrag ergänzen (z. B. Anruf → später kommt das Ergebnis dazu). Ohne Treffer passiert nichts. */
export async function annotateActivity(db: Db, tenantId: number, ref: { refType: string; refId: number }, patch: { detail?: string | null; title?: string; leadId?: number | null }): Promise<boolean> {
  try {
    const row = (await db.select({ id: activityLog.id }).from(activityLog).where(and(eq(activityLog.tenantId, tenantId), eq(activityLog.refType, ref.refType), eq(activityLog.refId, ref.refId))).orderBy(desc(activityLog.id)).limit(1))[0];
    if (!row) return false;
    await db.update(activityLog).set({ ...(patch.detail !== undefined ? { detail: patch.detail ? patch.detail.slice(0, 400) : null } : {}), ...(patch.title ? { title: patch.title.slice(0, 200) } : {}), ...(patch.leadId !== undefined ? { leadId: patch.leadId } : {}) }).where(eq(activityLog.id, row.id));
    return true;
  } catch (error) {
    console.error("[activity] Eintrag konnte nicht ergänzt werden:", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Zähler-Eintrag: Gleiche Vorgänge kurz nacheinander (z. B. der Zeitplaner schickt alle paar Minuten E-Mails
 * derselben Kampagne) landen in EINEM Eintrag, dessen Zahl hochgezählt wird – statt in dreißig Zeilen.
 * `title(count)` baut den Text aus der neuen Gesamtzahl.
 */
export async function bumpActivity(db: Db, tenantId: number, ref: { refType: string; refId: number; withinMinutes?: number }, input: { kind: ActivityKind; title: (count: number) => string; detail?: string | null; add: number; leadId?: number | null; actorUserId?: number | null }): Promise<number | null> {
  if (input.add <= 0) return null;
  try {
    const since = new Date(Date.now() - (ref.withinMinutes ?? 60) * 60_000);
    const row = (await db.select({ id: activityLog.id, count: activityLog.count }).from(activityLog).where(and(eq(activityLog.tenantId, tenantId), eq(activityLog.kind, input.kind), eq(activityLog.refType, ref.refType), eq(activityLog.refId, ref.refId), gte(activityLog.createdAt, since))).orderBy(desc(activityLog.id)).limit(1))[0];
    if (row) {
      const count = row.count + input.add;
      await db.update(activityLog).set({ count, title: input.title(count).slice(0, 200), detail: input.detail === undefined ? undefined : input.detail ? input.detail.slice(0, 400) : null, createdAt: new Date() }).where(eq(activityLog.id, row.id));
      return row.id;
    }
    return logActivity(db, tenantId, { kind: input.kind, title: input.title(input.add), detail: input.detail ?? null, count: input.add, leadId: input.leadId ?? null, actorUserId: input.actorUserId ?? null, refType: ref.refType, refId: ref.refId });
  } catch (error) {
    console.error("[activity] Zähler konnte nicht erhöht werden:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function activityFeed(db: Db, tenantId: number, options: { days?: number; since?: Date | null; limit?: number } = {}) {
  const days = Math.min(90, Math.max(1, options.days ?? 14));
  const limit = Math.min(2000, Math.max(50, options.limit ?? 800));
  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (days - 1));
  const rows = await db.select().from(activityLog).where(and(eq(activityLog.tenantId, tenantId), gte(activityLog.createdAt, from))).orderBy(desc(activityLog.createdAt), desc(activityLog.id)).limit(limit);
  const leadIds = Array.from(new Set(rows.map((row) => row.leadId).filter((id): id is number => typeof id === "number")));
  const userIds = Array.from(new Set(rows.map((row) => row.actorUserId).filter((id): id is number => typeof id === "number")));
  const leadRows = leadIds.length ? await db.select({ id: leads.id, publicId: leads.publicId }).from(leads).where(inArray(leads.id, leadIds)) : [];
  const userRows = userIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [];
  const publicIds = new Map(leadRows.map((row) => [row.id, row.publicId]));
  const names = new Map(userRows.map((row) => [row.id, row.name]));
  const entries: ActivityEntry[] = rows.map((row) => ({ id: row.id, kind: row.kind as ActivityKind, title: row.title, detail: row.detail ?? null, count: row.count, leadPublicId: row.leadId ? publicIds.get(row.leadId) ?? null : null, actorName: row.actorUserId ? names.get(row.actorUserId) ?? null : null, createdAt: row.createdAt }));
  return { days: groupActivity(entries), newCount: countSince(entries, options.since ?? null), total: entries.length, from };
}
