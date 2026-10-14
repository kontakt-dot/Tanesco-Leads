export type ParsedLeadImportRow = {
  rowNumber: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  postcode?: string;
  city?: string;
  metadata: Record<string, string>;
};

export type ParsedLeadImportError = { rowNumber: number; reason: string; values: Record<string, string> };
export type LeadImportParseResult = { rows: ParsedLeadImportRow[]; errors: string[]; errorRows: ParsedLeadImportError[]; headers: string[] };

const aliases: Record<string, keyof Omit<ParsedLeadImportRow, "rowNumber" | "metadata">> = {
  vorname: "firstName", firstname: "firstName", first_name: "firstName", nachname: "lastName", lastname: "lastName", last_name: "lastName", email: "email", "e-mail": "email", telefon: "phone", phone: "phone", tel: "phone", plz: "postcode", postcode: "postcode", zip: "postcode", ort: "city", stadt: "city", city: "city",
};

export function parseCsvLine(line: string, delimiter: string) {
  const cells: string[] = []; let value = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') { if (quoted && line[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted; }
    else if (character === delimiter && !quoted) { cells.push(value.trim()); value = ""; }
    else value += character;
  }
  cells.push(value.trim()); return cells;
}

export function parseLeadCsv(text: string): LeadImportParseResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return { rows: [], headers: [], errors: ["Die Datei enthält keine Lead-Zeilen unterhalb der Kopfzeile."], errorRows: [] };
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter).map((header) => header.trim().toLowerCase());
  const recognized = headers.filter((header) => Boolean(aliases[header]));
  if (!recognized.some((header) => aliases[header] === "firstName" || aliases[header] === "lastName")) return { rows: [], headers, errors: ["Die CSV benötigt mindestens die Spalte Vorname oder Nachname."], errorRows: [] };
  const errors: string[] = []; const errorRows: ParsedLeadImportError[] = []; const rows: ParsedLeadImportRow[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const values = parseCsvLine(lines[index], delimiter); const candidate: ParsedLeadImportRow = { rowNumber: index + 1, metadata: {} };
    const rawValues = Object.fromEntries(headers.map((header, cellIndex) => [header, values[cellIndex]?.trim() ?? ""]));
    headers.forEach((header, cellIndex) => { const value = values[cellIndex]?.trim(); if (!value) return; const key = aliases[header]; if (key) candidate[key] = value; else candidate.metadata[header] = value; });
    if (!candidate.firstName && !candidate.lastName) { const reason = "Vorname oder Nachname fehlt."; errors.push(`Zeile ${index + 1}: ${reason}`); errorRows.push({ rowNumber: index + 1, reason, values: rawValues }); continue; }
    if (candidate.email && !/^\S+@\S+\.\S+$/.test(candidate.email)) { const reason = "E-Mail-Adresse ist ungültig."; errors.push(`Zeile ${index + 1}: ${reason}`); errorRows.push({ rowNumber: index + 1, reason, values: rawValues }); continue; }
    rows.push(candidate);
  }
  return { rows, errors, errorRows, headers };
}
