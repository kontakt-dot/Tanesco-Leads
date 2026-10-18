/**
 * Kontaktliste aus einer Datei lesen: CSV/Text direkt, Excel (.xlsx/.xls) über ALLE Tabellenblätter als Semikolon-CSV
 * (Spalten mit gleichem Namen werden zusammengelegt, Zeilenumbrüche in Zellen zu Leerzeichen).
 * Der Dateiname (ohne Endung) wird als Vorschlag für den Listennamen zurückgegeben.
 */
export async function readListFile(file: File): Promise<{ name: string; text: string }> {
  const name = file.name.replace(/\.[a-z0-9]+$/i, "");
  let text: string;
  if (/\.xlsx?$/i.test(file.name)) {
    const XLSX = await import("xlsx");
    const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
    if (!book.SheetNames.length) throw new Error("Die Excel-Datei enthält kein Tabellenblatt.");
    text = workbookToCsv(book.SheetNames.map((sheetName) => XLSX.utils.sheet_to_json(book.Sheets[sheetName], { header: 1, raw: false, defval: "" }) as unknown[][]));
  } else text = await file.text();
  if (!text.trim()) throw new Error("Die Datei ist leer.");
  return { name, text };
}

/** Alle Blätter zu einer Tabelle: Kopfzeilen vereinigen (gleicher Spaltenname = gleiche Spalte), leere Zeilen weg, sauber als „;“-CSV. */
export function workbookToCsv(sheets: unknown[][][]): string {
  const clean = (value: unknown) => String(value ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const header: string[] = []; const rows: Record<string, string>[] = [];
  for (const sheet of sheets) {
    const lines = sheet.map((row) => row.map(clean)).filter((row) => row.some(Boolean)); if (!lines.length) continue;
    const head = lines[0].map((name, index) => name || `Spalte ${index + 1}`);
    for (const name of head) if (!header.includes(name)) header.push(name);
    for (const line of lines.slice(1)) { const record: Record<string, string> = {}; head.forEach((name, index) => { if (line[index]) record[name] = line[index]; }); rows.push(record); }
  }
  const used = header.filter((name) => !/^Spalte \d+$/.test(name) || rows.some((row) => row[name]));
  const quote = (value: string) => /[;"]/.test(value) ? `"${value.replace(/"/g, "'")}"` : value;
  return [used.map(quote).join(";"), ...rows.map((row) => used.map((name) => quote(row[name] ?? "")).join(";"))].join("\n");
}
