/**
 * Gebietskarte: Einsatzgebiete der Kunden (PLZ-Listen je Kategorie) speichern und die Überschneidungen berechnen.
 * Die PLZ kommen schon aufgelöst vom Client (Vorwahl-Bereiche und Bereiche werden dort gegen die PLZ-Liste erweitert);
 * hier wird nur geprüft, dass es 5-stellige Zahlen sind, und gespeichert. Überschneidungen: shared/territories.ts.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { leadCategories, territories, users } from "../drizzle/schema";
import { colorForIndex, computeOverlaps, type Territory } from "../shared/territories";
import { logActivity } from "./activity";
import type { Db } from "./lead-pipeline";

const cleanPostcodes = (input: string[]) => Array.from(new Set(input.map((plz) => String(plz).trim()).filter((plz) => /^\d{5}$/.test(plz)))).sort();
const COLOR = /^#[0-9a-fA-F]{6}$/;

export async function listTerritories(db: Db, tenantId: number) {
  const rows = await db.select({ id: territories.id, customerName: territories.customerName, categoryId: territories.categoryId, color: territories.color, postcodes: territories.postcodes, rawCount: territories.rawCount, note: territories.note, sourceName: territories.sourceName, active: territories.active, createdByUserId: territories.createdByUserId, createdAt: territories.createdAt, updatedAt: territories.updatedAt }).from(territories).where(eq(territories.tenantId, tenantId)).orderBy(asc(territories.customerName), asc(territories.id));
  const categories = await db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId));
  const actorIds = Array.from(new Set(rows.map((row) => row.createdByUserId).filter((id): id is number => typeof id === "number")));
  const actors = actorIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, actorIds)) : [];
  return rows.map((row) => ({ ...row, postcodes: (Array.isArray(row.postcodes) ? row.postcodes : []) as string[], categoryName: row.categoryId ? categories.find((category) => category.id === row.categoryId)?.name ?? null : null, createdBy: actors.find((user) => user.id === row.createdByUserId)?.name ?? null }));
}

export type SaveTerritoryInput = { id?: number | null; customerName: string; categoryId?: number | null; color?: string | null; postcodes: string[]; note?: string | null; sourceName?: string | null; rawCount?: number | null; actorUserId?: number | null };
/** Gebiet anlegen oder ersetzen. Ohne Farbe bekommt der Kunde die nächste freie Farbe der Palette. */
export async function saveTerritory(db: Db, tenantId: number, input: SaveTerritoryInput) {
  const customerName = input.customerName.trim().replace(/\s+/g, " ").slice(0, 160); if (customerName.length < 2) throw new Error("Bitte den Kundennamen angeben.");
  const postcodes = cleanPostcodes(input.postcodes); if (!postcodes.length) throw new Error("Keine gültige PLZ erkannt – bitte 5-stellige PLZ, Vorwahl-Bereiche wie „60“ oder Bereiche wie „60000-60599“ eingeben.");
  if (postcodes.length > 12000) throw new Error("Das sind mehr PLZ, als es in Deutschland gibt – bitte die Liste prüfen.");
  if (input.categoryId) { const category = (await db.select({ id: leadCategories.id }).from(leadCategories).where(and(eq(leadCategories.id, input.categoryId), eq(leadCategories.tenantId, tenantId))).limit(1))[0]; if (!category) throw new Error("Die Kategorie wurde nicht gefunden."); }
  const existing = await listTerritories(db, tenantId);
  const sameCustomer = existing.find((row) => row.customerName.toLowerCase() === customerName.toLowerCase());
  const color = input.color && COLOR.test(input.color) ? input.color : sameCustomer?.color ?? colorForIndex(new Set(existing.map((row) => row.customerName.toLowerCase())).size);
  const values = { customerName, categoryId: input.categoryId ?? null, color, postcodes, rawCount: Math.max(0, Math.round(input.rawCount ?? postcodes.length)), note: input.note?.trim().slice(0, 240) || null, sourceName: input.sourceName?.trim().slice(0, 160) || null };
  if (input.id) {
    const row = (await db.select({ id: territories.id }).from(territories).where(and(eq(territories.id, input.id), eq(territories.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Dieses Gebiet gibt es nicht mehr.");
    await db.update(territories).set(values).where(eq(territories.id, row.id));
    await logActivity(db, tenantId, { kind: "sonstiges", title: `Gebiet von „${customerName}“ aktualisiert: ${postcodes.length} PLZ`, actorUserId: input.actorUserId ?? null, refType: "territory", refId: row.id });
    return { id: row.id, postcodes: postcodes.length, created: false as const };
  }
  const inserted = await db.insert(territories).values({ tenantId, ...values, createdByUserId: input.actorUserId ?? null });
  const id = Number(inserted[0]?.insertId) || 0;
  await logActivity(db, tenantId, { kind: "sonstiges", title: `Gebiet für „${customerName}“ angelegt: ${postcodes.length} PLZ`, actorUserId: input.actorUserId ?? null, refType: "territory", refId: id });
  return { id, postcodes: postcodes.length, created: true as const };
}

/** Kunde ein- oder ausschalten: ausgeschaltete Gebiete bleiben gespeichert, zählen aber nicht auf der Karte und nicht bei den Überschneidungen. */
export async function setTerritoryActive(db: Db, tenantId: number, input: { id: number; active: boolean }) {
  const row = (await db.select({ id: territories.id, customerName: territories.customerName }).from(territories).where(and(eq(territories.id, input.id), eq(territories.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Dieses Gebiet gibt es nicht mehr.");
  await db.update(territories).set({ active: input.active }).where(eq(territories.id, row.id));
  return { id: row.id, active: input.active, customerName: row.customerName };
}
export async function deleteTerritory(db: Db, tenantId: number, id: number) {
  const row = (await db.select({ id: territories.id, customerName: territories.customerName }).from(territories).where(and(eq(territories.id, id), eq(territories.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Dieses Gebiet gibt es nicht mehr.");
  await db.delete(territories).where(eq(territories.id, row.id));
  return { deleted: true as const, customerName: row.customerName };
}

/** Überschneidungen je Kategorie – plus Kennzahlen für die Kopfzeile der Karte. */
export async function territoryOverlaps(db: Db, tenantId: number) {
  const rows = await listTerritories(db, tenantId);
  const categories = await db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId));
  const active = rows.filter((row) => row.active !== false); // ausgeschaltete Kunden zählen nicht mit
  const list: Territory[] = active.map((row) => ({ id: row.id, customerName: row.customerName, categoryId: row.categoryId, color: row.color, postcodes: row.postcodes }));
  const result = computeOverlaps(list, categories);
  return { ...result, customers: new Set(active.map((row) => row.customerName.toLowerCase())).size, territories: active.length, inactive: rows.length - active.length, categories: new Set(active.map((row) => row.categoryId ?? 0)).size };
}
