/**
 * Kontaktliste aus einer Datei lesen: CSV/Text direkt, Excel (.xlsx/.xls) über das erste Tabellenblatt als Semikolon-CSV.
 * Der Dateiname (ohne Endung) wird als Vorschlag für den Listennamen zurückgegeben.
 */
export async function readListFile(file: File): Promise<{ name: string; text: string }> {
  const name = file.name.replace(/\.[a-z0-9]+$/i, "");
  let text: string;
  if (/\.xlsx?$/i.test(file.name)) {
    const XLSX = await import("xlsx");
    const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = book.Sheets[book.SheetNames[0]];
    if (!sheet) throw new Error("Die Excel-Datei enthält kein Tabellenblatt.");
    text = XLSX.utils.sheet_to_csv(sheet, { FS: ";", blankrows: false });
  } else text = await file.text();
  if (!text.trim()) throw new Error("Die Datei ist leer.");
  return { name, text };
}
