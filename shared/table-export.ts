/**
 * Tabellen-Export (Reiter „Kontakte“): CSV für Excel/Numbers und Text zum Einfügen in Google Sheets. Zellen, die ein Tabellenprogramm als
 * Formel lesen würde (=, +, -, @), werden entschärft. In Google Sheets bleiben Telefonnummern („+49 …“, „0171 …“) und Postleitzahlen
 * mit führender Null Text (Apostroph davor – Sheets zeigt ihn nicht an). Gemeinsam für Oberfläche, Chat-Demo und Tests.
 */
const FORMULA_START = /^[=+\-@]/;
const PHONE_LIKE = /^\+?[\d\s()/.-]{5,}$/;
const clean = (value: unknown) => String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();

/** CSV mit Semikolon (deutsches Excel): Formeln entschärft – Telefonnummern bleiben, wie sie sind (wie beim Herunterladen einer Liste). */
export function tableCsv(columns: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (value: unknown) => { let text = clean(value); if (FORMULA_START.test(text) && !PHONE_LIKE.test(text)) text = `'${text}`; return /[;"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  return [columns, ...rows].map((row) => row.map(cell).join(";")).join("\r\n");
}

/** Text für Google Sheets (Tabulator zwischen den Spalten): einfügen in Zelle A1 füllt die Tabelle. */
export function tableTsv(columns: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (value: unknown) => { const text = clean(value); return FORMULA_START.test(text) || /^0\d/.test(text) ? `'${text}` : text; }; // Formel, Telefonnummer, PLZ mit 0 → Text
  return [columns, ...rows].map((row) => row.map(cell).join("\t")).join("\n");
}

/** Dateiname ohne Zeichen, die Windows oder macOS nicht mögen. */
export const exportFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Export";
