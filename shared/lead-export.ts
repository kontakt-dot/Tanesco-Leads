/**
 * Leads als Tabelle zum Herunterladen (CSV oder Excel) – eine Rechnung für Server und Vorschau.
 * Feste Spalten zum Kontakt, dahinter die eigenen Felder der Lead-Kategorien (mit ihrem Namen als Überschrift) und weitere Zusatzfelder.
 * Vermerke der Software (Nummer des Gesprächs, Name der Liste …) stehen nicht in der Datei.
 */
import { extraMetaFields, realText } from "./lead-fields";

export type ExportLead = { publicId: string; categoryId: number; status: string; firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null; postcode?: string | null; city?: string | null; country?: string | null; supplierName?: string | null; cost?: string | number | null; createdAt: Date | string; metadata?: unknown; buyerName?: string | null; deliveredAt?: Date | string | null };
export type ExportField = { categoryId: number; fieldKey: string; label: string };
export type LeadTable = { columns: string[]; rows: string[][] };

const stamp = (value: Date | string | null | undefined) => { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", ""); };
const text = (value: unknown) => (Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined && typeof item !== "object").join(", ") : typeof value === "boolean" ? (value ? "Ja" : "Nein") : realText(typeof value === "number" ? String(value) : value, 2000) ?? "");
export const BASE_EXPORT_COLUMNS = ["ID", "Kategorie", "Status", "Vorname", "Nachname", "E-Mail", "Telefon", "Straße", "PLZ", "Ort", "Land", "Lieferant", "Geliefert am", "Käufer", "Ausgeliefert am", "Preis"] as const;

/** Tabelle aus Leads bauen. Spalten der Kategorie-Felder: in der Reihenfolge der Kategorien und Felder, gleiche Namen nur einmal. */
export function leadExportTable(leads: ExportLead[], categories: Array<{ id: number; name: string }>, fields: ExportField[]): LeadTable {
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const usedCategories = new Set(leads.map((lead) => lead.categoryId));
  const fieldColumns: string[] = []; const keysByLabel = new Map<string, Map<number, string>>(); const fieldKeys = new Map<number, Set<string>>();
  for (const field of fields) {
    if (!usedCategories.has(field.categoryId)) continue;
    const label = field.label.trim() || field.fieldKey; if (!keysByLabel.has(label)) { keysByLabel.set(label, new Map()); fieldColumns.push(label); }
    keysByLabel.get(label)!.set(field.categoryId, field.fieldKey);
    if (!fieldKeys.has(field.categoryId)) fieldKeys.set(field.categoryId, new Set()); fieldKeys.get(field.categoryId)!.add(field.fieldKey);
  }
  const base = new Set<string>(BASE_EXPORT_COLUMNS); const taken = new Set<string>([...BASE_EXPORT_COLUMNS, ...fieldColumns]);
  // weitere Zusatzfelder (ohne eigene Definition) – nur, wenn sie bei mindestens einem Lead gefüllt sind
  const extraColumns: string[] = []; const extraByLead = leads.map((lead) => { const extras = extraMetaFields(lead.metadata, fieldKeys.get(lead.categoryId) ?? []); for (const extra of extras) if (!taken.has(extra.label)) { taken.add(extra.label); extraColumns.push(extra.label); } return new Map(extras.map((extra) => [extra.label, extra.value])); });
  const columns = [...BASE_EXPORT_COLUMNS, ...fieldColumns.map((label) => (base.has(label) ? `${label} (Feld)` : label)), ...extraColumns];
  const rows = leads.map((lead, index) => {
    const meta = lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata) ? lead.metadata as Record<string, unknown> : {};
    const price = Number(lead.cost ?? 0);
    return [
      lead.publicId, categoryName.get(lead.categoryId) ?? `Kategorie #${lead.categoryId}`, lead.status.replace(/^./, (letter) => letter.toUpperCase()), text(lead.firstName), text(lead.lastName), text(lead.email), text(lead.phone), text(meta.street), text(lead.postcode), text(lead.city), text(lead.country), text(lead.supplierName), stamp(lead.createdAt), text(lead.buyerName), stamp(lead.deliveredAt ?? null), Number.isFinite(price) ? price.toFixed(2).replace(".", ",") : "",
      ...fieldColumns.map((label) => { const key = keysByLabel.get(label)?.get(lead.categoryId); return key ? text(meta[key]) : ""; }),
      ...extraColumns.map((label) => extraByLead[index].get(label) ?? ""),
    ];
  });
  return { columns, rows };
}
