/**
 * Gebietskarte: Einsatzgebiete der Kunden (PLZ-Listen je Kategorie) speichern und die Überschneidungen berechnen.
 * Die PLZ kommen schon aufgelöst vom Client (Vorwahl-Bereiche und Bereiche werden dort gegen die PLZ-Liste erweitert);
 * hier wird nur geprüft, dass es 5-stellige Zahlen sind, und gespeichert. Überschneidungen: shared/territories.ts.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { leadCategories, territories, users } from "../drizzle/schema";
import { colorForIndex, computeOverlaps, type Territory } from "../shared/territories";
import { buildTerritoryDrafts, describePlan, detectTerritoryLayout, parseTerritoryPlan, territoryPlanPrompt, TERRITORY_PLAN_SCHEMA, trimTable, type TerritoryPlan } from "../shared/territory-import";
import { invokeLLM } from "./_core/llm";
import { logActivity } from "./activity";
import type { Db } from "./lead-pipeline";

const cleanPostcodes = (input: string[]) => Array.from(new Set(input.map((plz) => String(plz).trim()).filter((plz) => /^\d{5}$/.test(plz)))).sort();
const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Doppelte Gebiete (gleicher Kunde + gleiche Kategorie) zu einem zusammenlegen – ein Kunde ist ein Verkauf. */
async function mergeDuplicateTerritories(db: Db, tenantId: number) {
  const rows = await db.select({ id: territories.id, customerName: territories.customerName, categoryId: territories.categoryId, postcodes: territories.postcodes, rawCount: territories.rawCount, active: territories.active }).from(territories).where(eq(territories.tenantId, tenantId)).orderBy(asc(territories.id));
  const groups = new Map<string, typeof rows>();
  for (const row of rows) { const key = `${row.customerName.trim().toLowerCase()}|${row.categoryId ?? 0}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
  for (const list of Array.from(groups.values())) {
    if (list.length < 2) continue;
    const [keep, ...rest] = list; const postcodes = cleanPostcodes(list.flatMap((row) => (Array.isArray(row.postcodes) ? row.postcodes : []) as string[]));
    await db.update(territories).set({ postcodes, rawCount: list.reduce((sum, row) => sum + (row.rawCount ?? 0), 0), active: list.some((row) => row.active !== false) }).where(eq(territories.id, keep.id));
    await db.delete(territories).where(inArray(territories.id, rest.map((row) => row.id)));
  }
}

export async function listTerritories(db: Db, tenantId: number) {
  await mergeDuplicateTerritories(db, tenantId);
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
  // Gibt es den Kunden in dieser Kategorie schon, kommen die PLZ dazu – kein zweites Gebiet für denselben Kunden
  const sameCategory = existing.find((row) => row.customerName.toLowerCase() === customerName.toLowerCase() && (row.categoryId ?? null) === (input.categoryId ?? null));
  if (sameCategory) {
    const merged = cleanPostcodes([...sameCategory.postcodes, ...postcodes]);
    await db.update(territories).set({ ...values, postcodes: merged, color: sameCategory.color, rawCount: (sameCategory.rawCount ?? 0) + values.rawCount, note: values.note ?? sameCategory.note, sourceName: values.sourceName ?? sameCategory.sourceName }).where(eq(territories.id, sameCategory.id));
    await logActivity(db, tenantId, { kind: "sonstiges", title: `Gebiet von „${customerName}“ ergänzt: jetzt ${merged.length} PLZ`, actorUserId: input.actorUserId ?? null, refType: "territory", refId: sameCategory.id });
    return { id: sameCategory.id, postcodes: merged.length, created: false as const };
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

const PLAN_SYSTEM = "Du analysierst Tabellen mit Einsatzgebieten von Kunden (deutsche Postleitzahlen). Du antwortest nur über das vorgegebene Werkzeug. Gib jeder Spalte genau eine Rolle; Spalten ohne Nutzen bekommen „ignorieren“. Eine Kunden-Spalte enthält Firmennamen, die sich meist über mehrere Zeilen wiederholen.";
export type AnalyzeTerritoryInput = { fileName?: string | null; rows: string[][] };
/**
 * KI-Erkennung für Gebietslisten: Die KI (Haiku, 12 s, nur mit ANTHROPIC_API_KEY) sagt, welche Spalte Kunde, PLZ, Ort,
 * Umkreis oder Kategorie ist und ob Kunden in Zeilen oder Spalten stehen. Ohne Schlüssel oder bei Fehlern entscheiden die
 * Regeln aus shared/territory-import.ts. Die Entwürfe je Kunde (Zeilen für den PLZ-Parser) werden hier deterministisch
 * gebaut – aufgelöst zu PLZ werden sie erst im Client, der die PLZ-Liste hat.
 */
export async function analyzeTerritoryFile(db: Db, tenantId: number, input: AnalyzeTerritoryInput, deps: { llm?: typeof invokeLLM; apiKey?: string | null } = {}) {
  const rows = trimTable(input.rows); if (!rows.some((row) => row.some(Boolean))) throw new Error("Die Datei ist leer – keine Zeilen gefunden.");
  const categories = await db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId));
  const width = Math.max(0, ...rows.map((row) => row.length));
  const rulesPlan = detectTerritoryLayout(rows, categories);
  let plan: TerritoryPlan = rulesPlan; let source: "ki" | "regeln" = "regeln"; let aiError: string | null = null;
  const apiKey = deps.apiKey === undefined ? process.env.ANTHROPIC_API_KEY : deps.apiKey;
  if (apiKey) {
    try {
      const call = (deps.llm ?? invokeLLM)({ model: "fast", maxTokens: 600, temperature: 0, outputSchema: TERRITORY_PLAN_SCHEMA, messages: [{ role: "system", content: PLAN_SYSTEM }, { role: "user", content: territoryPlanPrompt(rows, input.fileName, categories) }] });
      const response = await Promise.race([call, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("KI-Zeitüberschreitung")), 12_000))]);
      const parsed = parseTerritoryPlan(response.choices?.[0]?.message?.content ?? "", width);
      if (parsed) { plan = parsed; source = "ki"; }
      else aiError = "Die KI hat keine verwertbare Struktur geliefert – Regeln wurden genutzt.";
    } catch (error) { aiError = `KI nicht erreichbar (${error instanceof Error ? error.message : "Fehler"}) – Regeln wurden genutzt.`; }
  } else aiError = "Keine KI eingerichtet (ANTHROPIC_API_KEY fehlt) – Regeln wurden genutzt.";
  let drafts = buildTerritoryDrafts(rows, plan, { categories, fileName: input.fileName });
  // Sicherheitsnetz: liefert der KI-Plan nichts Brauchbares, die Regeln aber schon, gewinnen die Regeln
  if (source === "ki" && drafts.every((draft) => !draft.lines.length)) { const fallback = buildTerritoryDrafts(rows, rulesPlan, { categories, fileName: input.fileName }); if (fallback.some((draft) => draft.lines.length)) { plan = rulesPlan; drafts = fallback; source = "regeln"; aiError = "Die KI-Struktur ergab keine PLZ – Regeln wurden genutzt."; } }
  return { plan, source, aiError, summary: describePlan(plan, rows), drafts, rows: rows.length, columns: width, categories };
}
