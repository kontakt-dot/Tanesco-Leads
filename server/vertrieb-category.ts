/**
 * Lead-Kategorie der Kontakte in der Vertriebspipeline: Photovoltaik und Wärmepumpe laufen dort als EINE Kategorie
 * „Photovoltaik & Wärmepumpe“ (☀️♨️) – wie die Leadsparte der E-Mail-Kampagnen. Das gilt in allen Pipelines (Kaltakquise,
 * E-Mail-Kampagne, Meta Ads): als Vorgabe beim Hochladen von Listen, beim Anlegen von Hand, aus dem Lead-Finder und dem
 * Posteingang, bei der Kategorie einer Kampagne – und einmal beim Start für alle Karten, die noch „Photovoltaik“ oder
 * „Wärmepumpe“ tragen. Eine Kategorie, die jemand ausdrücklich wählt (Upload, Karte, Posteingang), bleibt so gewählt.
 * Verkaufs-Leads (kind „verkauf“) bleiben bei Photovoltaik bzw. Wärmepumpe – dort sind es zwei Produkte.
 */
import { and, desc, eq, inArray, like } from "drizzle-orm";
import { leadCategories, leads, pipelineEvents } from "../drizzle/schema";
import { COMBINED_ENERGY_CATEGORY, combinedEnergyCategory, isSingleEnergyCategory, vertriebCategory } from "../shared/lead-sparte";
import type { Db } from "./lead-pipeline";

export type CategoryRow = { id: number; name: string; status?: string | null };
export const ENERGY_MERGE_NOTE = "Kategorie zusammengeführt";

/** Alle Lead-Kategorien eines Mandanten (ohne Vorlagen). */
export async function loadCategories(db: Db, tenantId: number): Promise<CategoryRow[]> {
  return db.select({ id: leadCategories.id, name: leadCategories.name, status: leadCategories.status }).from(leadCategories).where(and(eq(leadCategories.tenantId, tenantId), eq(leadCategories.isTemplate, false)));
}

/** Lead-Kategorie anlegen (Name = Sparte, Kürzel aus dem Namen oder vorgegeben, Emoji passend) – gibt es den Namen schon, die vorhandene. */
export async function createCategoryForSparte(db: Db, tenantId: number, label: string, options: { shortcode?: string; emoji?: string; color?: string; detail?: string } = {}): Promise<{ id: number; name: string }> {
  const name = label.trim().slice(0, 160);
  const existing = await db.select({ id: leadCategories.id, name: leadCategories.name, shortcode: leadCategories.shortcode }).from(leadCategories).where(and(eq(leadCategories.tenantId, tenantId), eq(leadCategories.isTemplate, false)));
  const same = existing.find((row) => row.name.trim().toLowerCase() === name.toLowerCase()); if (same) return { id: same.id, name: same.name };
  const base = (options.shortcode ?? name.toUpperCase().replace(/Ä/g, "AE").replace(/Ö/g, "OE").replace(/Ü/g, "UE").replace(/ß/gi, "SS").replace(/[^A-Z0-9]/g, "").slice(0, 8)) || "KAT";
  const codes = new Set(existing.map((row) => row.shortcode.toUpperCase())); let code = base; for (let n = 2; codes.has(code); n += 1) code = `${base.slice(0, 6)}${n}`;
  const { suggestCategoryEmoji } = await import("../shared/category-emoji");
  await db.insert(leadCategories).values({ tenantId, shortcode: code, name, color: options.color ?? null, emoji: options.emoji ?? suggestCategoryEmoji(name), status: "aktiv", geocodingRequired: true, marketplaceEnabled: false });
  const row = (await db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(and(eq(leadCategories.tenantId, tenantId), eq(leadCategories.shortcode, code))).orderBy(desc(leadCategories.id)).limit(1))[0];
  const { logActivity } = await import("./activity"); await logActivity(db, tenantId, { kind: "sonstiges", title: `Lead-Kategorie „${name}“ angelegt`, detail: options.detail ?? "Automatisch zur Leadsparte einer E-Mail-Kampagne – damit Kontakte aus der Kampagne in der Pipeline ihre Kategorie tragen.", refType: "leadCategory", refId: row.id });
  return row;
}

/**
 * Die gemeinsame Kategorie „Photovoltaik & Wärmepumpe“: vorhanden → die; sonst wird sie angelegt, sobald der Mandant
 * überhaupt mit Photovoltaik oder Wärmepumpe arbeitet (eine solche Kategorie hat) oder es ausdrücklich gewünscht ist (`force`).
 */
export async function ensureCombinedEnergyCategory(db: Db, tenantId: number, rows?: CategoryRow[], options: { force?: boolean } = {}): Promise<CategoryRow | null> {
  const categories = rows ?? await loadCategories(db, tenantId);
  const found = combinedEnergyCategory(categories); if (found) return found;
  if (!options.force && !categories.some((row) => isSingleEnergyCategory(row.name))) return null;
  const created = await createCategoryForSparte(db, tenantId, COMBINED_ENERGY_CATEGORY.name, { shortcode: COMBINED_ENERGY_CATEGORY.shortcode, emoji: COMBINED_ENERGY_CATEGORY.emoji, color: COMBINED_ENERGY_CATEGORY.color, detail: "Automatisch: In der Vertriebspipeline laufen Photovoltaik und Wärmepumpe als eine Kategorie – wie die Leadsparte der E-Mail-Kampagnen." });
  const row = { id: created.id, name: created.name, status: "aktiv" }; if (rows && !rows.some((item) => item.id === row.id)) rows.push(row);
  return row;
}

/**
 * Lead-Kategorie für einen neuen Kontakt der Vertriebspipeline: die ausdrücklich gewählte bleibt; ohne Wahl gilt
 * „Photovoltaik & Wärmepumpe“ (wird angelegt, wenn es Photovoltaik- oder Wärmepumpen-Kategorien gibt), sonst die erste aktive Kategorie.
 */
export async function vertriebCategoryId(db: Db, tenantId: number, chosen?: number | null): Promise<number | null> {
  if (chosen) return chosen;
  const rows = await loadCategories(db, tenantId); const active = rows.filter((row) => row.status !== "inaktiv").sort((a, b) => a.id - b.id);
  const combined = await ensureCombinedEnergyCategory(db, tenantId, active);
  return combined?.id ?? active[0]?.id ?? null;
}

/** Wie vertriebCategoryId – ohne eine einzige Kategorie geht es nicht weiter. */
export async function requireVertriebCategoryId(db: Db, tenantId: number, chosen?: number | null): Promise<number> {
  const id = await vertriebCategoryId(db, tenantId, chosen); if (!id) throw new Error("Keine Lead-Kategorie vorhanden – bitte zuerst unter Lead-Kategorien eine anlegen."); return id;
}

/** Eine automatisch ermittelte Kategorie (Kampagne, Zuordnung) auf die Vertriebspipeline bringen: Photovoltaik/Wärmepumpe → gemeinsame Kategorie (bei Bedarf angelegt). */
export async function toVertriebCategory(db: Db, tenantId: number, rows: CategoryRow[], picked: CategoryRow | null): Promise<CategoryRow | null> {
  if (!picked || !isSingleEnergyCategory(picked.name)) return picked;
  return (await ensureCombinedEnergyCategory(db, tenantId, rows, { force: true })) ?? vertriebCategory(rows, picked);
}

/**
 * Einmal je Karte: Kontakte der Vertriebspipeline (alle Pipelines) mit Kategorie „Photovoltaik“ oder „Wärmepumpe“ bekommen die
 * gemeinsame Kategorie „Photovoltaik & Wärmepumpe“ – mit Vermerk im Verlauf. Danach von Hand gewählte Kategorien bleiben
 * (der Vermerk sorgt dafür, dass es nur einmal passiert). Verkaufs-Leads bleiben unberührt.
 */
export async function mergeEnergyCategories(db: Db): Promise<number> {
  const allCategories = await db.select({ id: leadCategories.id, tenantId: leadCategories.tenantId, name: leadCategories.name, status: leadCategories.status }).from(leadCategories).where(eq(leadCategories.isTemplate, false));
  const singles = allCategories.filter((row) => isSingleEnergyCategory(row.name)); if (!singles.length) return 0;
  const rows = await db.select({ id: leads.id, tenantId: leads.tenantId, categoryId: leads.categoryId }).from(leads).where(and(eq(leads.kind, "vertrieb"), inArray(leads.categoryId, singles.map((row) => row.id))));
  if (!rows.length) return 0;
  const done = new Set((await db.select({ leadId: pipelineEvents.leadId }).from(pipelineEvents).where(and(inArray(pipelineEvents.leadId, rows.map((row) => row.id)), like(pipelineEvents.note, `${ENERGY_MERGE_NOTE}%`)))).map((row) => row.leadId));
  let merged = 0;
  for (const tenantId of Array.from(new Set(rows.map((row) => row.tenantId)))) {
    const own = rows.filter((row) => row.tenantId === tenantId && !done.has(row.id)); if (!own.length) continue;
    const combined = await ensureCombinedEnergyCategory(db, tenantId, allCategories.filter((row) => row.tenantId === tenantId), { force: true }); if (!combined) continue;
    for (const before of singles.filter((row) => row.tenantId === tenantId)) {
      const ids = own.filter((row) => row.categoryId === before.id).map((row) => row.id); if (!ids.length) continue;
      for (let at = 0; at < ids.length; at += 500) {
        const chunk = ids.slice(at, at + 500);
        await db.update(leads).set({ categoryId: combined.id }).where(inArray(leads.id, chunk));
        await db.insert(pipelineEvents).values(chunk.map((leadId) => ({ tenantId, leadId, fromStage: null, toStage: "kategorie", actorUserId: null, note: `${ENERGY_MERGE_NOTE}: „${combined.name}“ (vorher „${before.name}“) – in der Vertriebspipeline laufen Photovoltaik und Wärmepumpe als eine Kategorie` })));
        merged += chunk.length;
      }
    }
  }
  return merged;
}
