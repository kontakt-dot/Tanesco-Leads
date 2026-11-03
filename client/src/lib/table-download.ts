/**
 * Tabellen herunterladen bzw. kopieren (Reiter „Kontakte“): Excel (.xlsx – alle Zellen als Text, Telefonnummern und PLZ bleiben, wie sie
 * sind), CSV und für Google Sheets als Text in die Zwischenablage.
 */
import { exportFileName, tableCsv, tableTsv } from "../../../shared/table-export";

type Rows = Array<Array<string | number | null | undefined>>;

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = fileName; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadCsv(columns: string[], rows: Rows, name: string) {
  saveBlob(new Blob([`﻿${tableCsv(columns, rows)}`], { type: "text/csv;charset=utf-8" }), `${exportFileName(name)}.csv`);
}

export async function downloadXlsx(columns: string[], rows: Rows, name: string, sheetName = "Kontakte") {
  const XLSX = await import("xlsx");
  const text = rows.map((row) => row.map((value) => String(value ?? "")));
  const sheet = XLSX.utils.aoa_to_sheet([columns, ...text]); // nur Text: keine Formeln, „+49 …“ und „01067“ bleiben
  sheet["!cols"] = columns.map((column, index) => ({ wch: Math.min(48, Math.max(column.length, ...text.slice(0, 300).map((row) => (row[index] ?? "").length)) + 2) }));
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, sheetName.slice(0, 31));
  const data = XLSX.write(book, { bookType: "xlsx", type: "array", compression: true }) as ArrayBuffer;
  saveBlob(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${exportFileName(name)}.xlsx`);
}

/** Für Google Sheets: Tabelle als Text in die Zwischenablage – im neuen Sheet in A1 einfügen. */
export async function copyTsv(columns: string[], rows: Rows): Promise<boolean> {
  const text = tableTsv(columns, rows);
  try { await navigator.clipboard.writeText(text); return true; } catch { /* ältere Browser / ohne Freigabe: unten weiter */ }
  try { const area = document.createElement("textarea"); area.value = text; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0"; document.body.append(area); area.select(); const ok = document.execCommand("copy"); area.remove(); return ok; } catch { return false; }
}
