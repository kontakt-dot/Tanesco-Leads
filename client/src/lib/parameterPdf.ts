import { jsPDF } from "jspdf";

/**
 * Parameterblatt einer Lead-Kategorie als PDF (A4): Kopf in der Farbe der Kategorie, vier Kennzahlen, die Felder als Tabelle
 * (Bezeichnung, technischer Parameter, Antwortart, Pflicht – vorgegebene Antworten als Marken darunter), die Zuordnungen der
 * Datenharmonisierung und ein Beispiel für die Übergabe. Jede Seite trägt Fußzeile und Seitenzahl.
 */
export type ParameterField = { label: string; fieldKey: string; fieldType: string; options: unknown; required: boolean };
export type ParameterMapping = { sourceField: string; targetFieldKey: string; mode?: string | null; searchValue?: string | null; replaceValue?: string | null };
export type ParameterSheet = { name: string; shortcode: string; color?: string | null; fields: ParameterField[]; mappings?: ParameterMapping[]; labelForFieldType: (fieldType: string) => string; date?: Date };

const rgb = (hex: string | null | undefined): [number, number, number] => { const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex ?? "").trim()); return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : [188, 0, 29]; };
const mix = (color: [number, number, number], other: [number, number, number], amount: number): [number, number, number] => [0, 1, 2].map((index) => Math.round(color[index] * (1 - amount) + other[index] * amount)) as [number, number, number];
const optionsOf = (field: ParameterField): string[] => (Array.isArray(field.options) ? field.options.map((item) => String(item)).filter(Boolean) : []);
/** Beispielwert je Antwortart – für das Beispiel am Ende. */
export function sampleValue(field: ParameterField): string | number {
  const options = optionsOf(field); if (options.length) return options[0];
  return field.fieldType === "zahl" ? 120 : field.fieldType === "ja_nein" ? "Ja" : field.fieldType === "datum" ? "2026-12-01" : field.fieldType === "notiz" ? "Hinweis des Kunden" : "Text";
}

export function createParameterPdf(input: ParameterSheet): jsPDF {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210; const H = 297; const M = 14; const INK: [number, number, number] = [23, 25, 43]; const MUTED: [number, number, number] = [102, 108, 128]; const LINE: [number, number, number] = [226, 229, 238]; const WHITE: [number, number, number] = [255, 255, 255];
  const brand = rgb(input.color); const dark = mix(brand, [12, 12, 28], 0.55); const soft = mix(brand, WHITE, 0.9); const lightBand = brand[0] * 0.299 + brand[1] * 0.587 + brand[2] * 0.114 > 170;
  const onBand: [number, number, number] = lightBand ? INK : WHITE; const stand = (input.date ?? new Date()).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const text = (color: [number, number, number]) => pdf.setTextColor(color[0], color[1], color[2]); const fill = (color: [number, number, number]) => pdf.setFillColor(color[0], color[1], color[2]); const draw = (color: [number, number, number]) => pdf.setDrawColor(color[0], color[1], color[2]);
  const font = (style: "normal" | "bold", size: number, family: "helvetica" | "courier" = "helvetica") => { pdf.setFont(family, style); pdf.setFontSize(size); };

  // Kopf: Band in der Farbe der Kategorie, unten ein dunklerer Streifen
  fill(brand); pdf.rect(0, 0, W, 44, "F"); fill(dark); pdf.rect(0, 44, W, 2.2, "F");
  text(onBand); font("bold", 8.5); pdf.text("PARAMETERBLATT", M, 15, { charSpace: 1.1 });
  font("bold", 23); const title = pdf.splitTextToSize(input.name || "Lead-Kategorie", 130)[0] as string; pdf.text(title, M, 27);
  font("normal", 9.5); pdf.text("Felder, Antworten und technische Parameter für CSV, API und Datenharmonisierung", M, 35);
  // Kürzel als Marke, darunter der Stand
  font("bold", 12); const code = (input.shortcode || "–").toUpperCase(); const codeWidth = Math.max(22, pdf.getTextWidth(code) + 12);
  fill(WHITE); pdf.roundedRect(W - M - codeWidth, 11, codeWidth, 11, 3, 3, "F"); text(lightBand ? INK : dark); pdf.text(code, W - M - codeWidth / 2, 18.3, { align: "center" });
  text(onBand); font("normal", 8.5); pdf.text(`Stand ${stand}`, W - M, 30, { align: "right" }); pdf.text("Tanesco Leads", W - M, 35, { align: "right" });

  // Kennzahlen
  const fields = input.fields; const mappings = input.mappings ?? [];
  const stats: Array<[string, string]> = [[String(fields.length), fields.length === 1 ? "Feld" : "Felder"], [String(fields.filter((field) => field.required).length), "Pflichtfelder"], [String(fields.filter((field) => optionsOf(field).length > 0).length), "mit festen Antworten"], [String(mappings.length), mappings.length === 1 ? "Zuordnung" : "Zuordnungen"]];
  const boxWidth = (W - 2 * M - 3 * 4) / 4;
  stats.forEach(([value, label], index) => { const x = M + index * (boxWidth + 4); fill(soft); pdf.roundedRect(x, 54, boxWidth, 18, 3, 3, "F"); text(INK); font("bold", 16); pdf.text(value, x + 5, 63.5); text(MUTED); font("normal", 8.5); pdf.text(label, x + 5, 68.8); });
  text(MUTED); font("normal", 9); pdf.text(pdf.splitTextToSize("Der technische Parameter ist der Name des Feldes in der CSV-Vorlage, in der API und in der Datenharmonisierung. Bei Feldern mit festen Antworten gilt genau eine der genannten Antworten.", W - 2 * M), M, 80);

  let y = 92; let page = 1;
  const COLS = { nr: M + 3, label: M + 12, key: M + 78, type: M + 128, required: W - M - 3 };
  const tableHead = () => { fill(INK); pdf.roundedRect(M, y, W - 2 * M, 8, 2, 2, "F"); text(WHITE); font("bold", 7.5); pdf.text("NR.", COLS.nr, y + 5.2); pdf.text("BEZEICHNUNG", COLS.label, y + 5.2); pdf.text("TECHNISCHER PARAMETER", COLS.key, y + 5.2); pdf.text("ANTWORTART", COLS.type, y + 5.2); pdf.text("PFLICHT", COLS.required, y + 5.2, { align: "right" }); y += 8; };
  const nextPage = (withHead: boolean) => { pdf.addPage(); page += 1; y = 18; if (withHead) tableHead(); };
  const heading = (label: string) => { if (y + 16 > H - 20) nextPage(false); text(INK); font("bold", 12); pdf.text(label, M, y + 5); fill(brand); pdf.rect(M, y + 7.5, 14, 0.9, "F"); y += 13; };

  heading("Felder der Kategorie");
  if (!fields.length) { text(MUTED); font("normal", 9.5); pdf.text("Diese Kategorie hat noch keine eigenen Felder.", M, y + 4); y += 10; }
  else {
    tableHead();
    fields.forEach((field, index) => {
      // Antworten als Marken: erst messen (Zeilenumbruch), dann zeichnen
      const options = optionsOf(field); font("normal", 7.5); const chips: Array<{ label: string; x: number; row: number; width: number }> = []; let cx = COLS.label; let row = 0;
      for (const option of options) { const label = option.length > 46 ? `${option.slice(0, 45)}…` : option; const width = pdf.getTextWidth(label) + 5; if (cx + width > W - M - 3) { cx = COLS.label; row += 1; } chips.push({ label, x: cx, row, width }); cx += width + 1.8; }
      font("bold", 9.5); const labelLines = pdf.splitTextToSize(field.label || field.fieldKey, 62) as string[];
      const height = 4.2 + labelLines.length * 4.4 + (options.length ? 3 + (row + 1) * 5.4 : 1.6);
      if (y + height > H - 20) nextPage(true);
      if (index % 2 === 1) { fill([248, 249, 252]); pdf.rect(M, y, W - 2 * M, height, "F"); }
      draw(LINE); pdf.setLineWidth(0.2); pdf.line(M, y + height, W - M, y + height);
      text(MUTED); font("bold", 8.5); pdf.text(String(index + 1).padStart(2, "0"), COLS.nr, y + 6);
      text(INK); font("bold", 9.5); pdf.text(labelLines, COLS.label, y + 6);
      text(mix(brand, INK, 0.45)); font("normal", 8.5, "courier"); pdf.text(pdf.splitTextToSize(field.fieldKey, 46)[0] as string, COLS.key, y + 6);
      text(INK); font("normal", 8.8); pdf.text(input.labelForFieldType(field.fieldType), COLS.type, y + 6);
      if (field.required) { font("bold", 7.5); const width = pdf.getTextWidth("Pflicht") + 5; fill(brand); pdf.roundedRect(COLS.required - width, y + 2.4, width, 5, 2.4, 2.4, "F"); text(onBand); pdf.text("Pflicht", COLS.required - width / 2, y + 5.9, { align: "center" }); }
      else { text(MUTED); font("normal", 8.5); pdf.text("optional", COLS.required, y + 6, { align: "right" }); }
      if (options.length) { const top = y + 4.2 + labelLines.length * 4.4 + 0.8; font("normal", 7.5); for (const chip of chips) { fill(soft); pdf.roundedRect(chip.x, top + chip.row * 5.4, chip.width, 4.4, 2.1, 2.1, "F"); text(INK); pdf.text(chip.label, chip.x + 2.5, top + chip.row * 5.4 + 3.1); } }
      y += height;
    });
    y += 8;
  }

  if (mappings.length) {
    heading("Datenharmonisierung");
    text(MUTED); font("normal", 9); pdf.text("Angaben, die unter einem anderen Namen ankommen, landen im genannten Feld.", M, y + 1); y += 7;
    for (const mapping of mappings) {
      if (y + 8 > H - 20) nextPage(false);
      fill([248, 249, 252]); pdf.roundedRect(M, y, W - 2 * M, 6.6, 2, 2, "F");
      text(INK); font("normal", 8.5, "courier"); pdf.text(pdf.splitTextToSize(mapping.sourceField, 60)[0] as string, M + 3, y + 4.4);
      text(MUTED); font("bold", 9); pdf.text("->", M + 70, y + 4.4);
      text(mix(brand, INK, 0.45)); font("normal", 8.5, "courier"); pdf.text(pdf.splitTextToSize(mapping.targetFieldKey, 46)[0] as string, M + 78, y + 4.4);
      text(MUTED); font("normal", 8); pdf.text(mapping.mode === "umschreiben" ? `umschreiben: „${mapping.searchValue ?? ""}“ wird „${mapping.replaceValue ?? ""}“`.slice(0, 60) : "übernehmen", W - M - 3, y + 4.4, { align: "right" });
      y += 8;
    }
    y += 6;
  }

  if (fields.length) {
    const shown = fields.slice(0, 10); const lines = ["{", ...shown.map((field, index) => { const value = sampleValue(field); return `  "${field.fieldKey}": ${typeof value === "number" ? value : `"${value}"`}${index < shown.length - 1 || fields.length > shown.length ? "," : ""}`; }), ...(fields.length > shown.length ? ["  …"] : []), "}"];
    const height = 8 + lines.length * 4.3; if (y + 13 + height > H - 20) nextPage(false);
    heading("Beispiel für die Übergabe");
    fill(INK); pdf.roundedRect(M, y, W - 2 * M, height, 3, 3, "F"); text([222, 226, 240]); font("normal", 8.5, "courier"); pdf.text(lines.map((line) => (pdf.splitTextToSize(line, W - 2 * M - 10)[0] as string)), M + 5, y + 7, { lineHeightFactor: 1.38 }); y += height + 6;
  }

  // Fußzeile mit Seitenzahl auf jeder Seite
  for (let index = 1; index <= page; index += 1) {
    pdf.setPage(index); draw(LINE); pdf.setLineWidth(0.2); pdf.line(M, H - 13, W - M, H - 13);
    text(MUTED); font("normal", 7.8); pdf.text(`Tanesco Leads · Parameterblatt ${input.name} (${code}) · Stand ${stand}`, M, H - 8.5); pdf.text(`Seite ${index} von ${page}`, W - M, H - 8.5, { align: "right" });
  }
  return pdf;
}
