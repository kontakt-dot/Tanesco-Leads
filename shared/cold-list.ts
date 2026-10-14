/**
 * Kaltakquise-/E-Mail-Listen: CSV (Komma, Semikolon oder Tab) → Zeilen; Kopfzeile wird erkannt. Gemeinsam für Server und Chat-Demo.
 * Jede Spalte bekommt ein Ziel: ein Standardfeld (Vorname, Firma, Telefon …), „Platzhalter“ (die Spalte wird als {{spaltenname}}
 * in E-Mails und Nachrichten nutzbar) oder „nicht übernehmen“. Die Zuordnung wird automatisch erkannt und lässt sich von Hand ändern.
 */
export type ColdField = "salutation" | "firstName" | "lastName" | "company" | "phone" | "email" | "postcode" | "city" | "notes";
export type ColumnTarget = ColdField | "platzhalter" | "ignorieren";
export type ColdRow = { firstName?: string | null; lastName?: string | null; company?: string | null; phone?: string | null; email?: string | null; postcode?: string | null; city?: string | null; salutation?: string | null; notes?: string | null; extra?: Record<string, string> | null };
export const COLD_FIELDS: Array<{ key: ColdField; label: string }> = [
  { key: "salutation", label: "Anrede" }, { key: "firstName", label: "Vorname" }, { key: "lastName", label: "Nachname" }, { key: "company", label: "Firma" },
  { key: "phone", label: "Telefon" }, { key: "email", label: "E-Mail" }, { key: "postcode", label: "PLZ" }, { key: "city", label: "Ort" }, { key: "notes", label: "Notizen" },
];
/** Feste Platzhalter, die immer da sind (aus den Stammdaten des Kontakts). */
export const STANDARD_PLACEHOLDERS: Array<{ key: string; label: string }> = [
  { key: "anrede", label: "Herr / Frau" }, { key: "vorname", label: "Vorname" }, { key: "nachname", label: "Nachname" }, { key: "name", label: "Vor- und Nachname" },
  { key: "firma", label: "Firma" }, { key: "stadt", label: "Ort" }, { key: "email", label: "E-Mail-Adresse" }, { key: "abmelden", label: "Abmelde-Link" },
];
const RESERVED = new Set(STANDARD_PLACEHOLDERS.map((item) => item.key));
const HEADER_MAP: Array<[RegExp, ColdField]> = [[/^(vorname|first ?name|firstname)$/i, "firstName"], [/^(nachname|name|last ?name|lastname)$/i, "lastName"], [/^(firma|company|unternehmen|betrieb)$/i, "company"], [/^(telefon|phone|tel|mobil|handy|telefonnummer)$/i, "phone"], [/^(e-?mail|mail|e-?mail-?adresse)$/i, "email"], [/^(plz|postleitzahl|zip)$/i, "postcode"], [/^(ort|stadt|city)$/i, "city"], [/^(anrede|salutation)$/i, "salutation"], [/^(notiz|notizen|notes|bemerkung|kommentar)$/i, "notes"]];

/** Spaltenname → Platzhalter-Schlüssel: „Anzahl Mitarbeiter“ → anzahl_mitarbeiter, „Größe“ → groesse. Feste Platzhalter werden nicht überschrieben (→ branche_2 o. ä. ist nicht nötig, sie bekommen den Zusatz „_liste“). */
export function placeholderKey(column: string) {
  const key = column.trim().toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "s$1");
  if (!key) return "";
  return RESERVED.has(key) ? `${key}_liste` : key;
}
/** Automatische Zuordnung der Kopfzeile: bekannte Namen → Standardfeld, alles andere mit Inhalt → Platzhalter, leere Köpfe → nicht übernehmen. */
export function detectMapping(columns: string[]): ColumnTarget[] {
  const taken = new Set<ColdField>();
  return columns.map((column) => { const field = HEADER_MAP.find(([pattern]) => pattern.test(column.trim()))?.[1]; if (field && !taken.has(field)) { taken.add(field); return field; } return column.trim() ? "platzhalter" : "ignorieren"; });
}
const splitLine = (line: string, delimiter: string) => { const out: string[] = []; let cur = ""; let quoted = false; for (const ch of line) { if (ch === '"') quoted = !quoted; else if (ch === delimiter && !quoted) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((cell) => cell.trim().replace(/^"|"$/g, "")); };

export function parseColdList(csv: string, mapping?: ColumnTarget[] | null): { rows: ColdRow[]; columns: string[]; skipped: number; mapping: ColumnTarget[]; placeholders: string[] } {
  const lines = csv.replace(/\r/g, "").split("\n").filter((line) => line.trim()); if (!lines.length) return { rows: [], columns: [], skipped: 0, mapping: [], placeholders: [] };
  const delimiter = [";", ",", "\t"].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const header = splitLine(lines[0], delimiter);
  const applied: ColumnTarget[] = mapping && mapping.length === header.length ? mapping : detectMapping(header);
  const keys = header.map((column, index) => applied[index] === "platzhalter" ? placeholderKey(column) : "");
  const placeholders = Array.from(new Set(keys.filter(Boolean)));
  const rows: ColdRow[] = []; let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, delimiter); const row: ColdRow = {}; const extra: Record<string, string> = {};
    applied.forEach((target, index) => { const cell = cells[index]; if (!cell || target === "ignorieren") return; if (target === "platzhalter") { if (keys[index]) extra[keys[index]] = cell; } else row[target] = cell; });
    if (Object.keys(extra).length) row.extra = extra;
    if (!row.phone && !row.email) { skipped += 1; continue; }
    if (!row.lastName && !row.firstName && !row.company) { skipped += 1; continue; }
    rows.push(row);
  }
  return { rows, columns: header, skipped, mapping: applied, placeholders };
}
/** Zusätzliche Felder eines Kontakts (aus der Liste) als Platzhalter-Werte. */
export function extraFieldsOf(metadata: unknown): Record<string, string> {
  const felder = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as { felder?: unknown }).felder : null;
  if (!felder || typeof felder !== "object" || Array.isArray(felder)) return {};
  const out: Record<string, string> = {}; for (const [key, value] of Object.entries(felder as Record<string, unknown>)) if (typeof value === "string" && value) out[key] = value; return out;
}
