/**
 * KI-Erkennung für Gebietslisten (Excel/CSV): Was steht in welcher Spalte? Kunde, PLZ, Ort, Umkreis, Kategorie …
 * Die KI (oder ohne Schlüssel: die Regeln hier) entscheidet nur über die STRUKTUR – welche Spalte was ist und ob die
 * Kunden in Zeilen oder als Spaltenköpfe stehen. Daraus baut `buildTerritoryDrafts` deterministisch je Kunde die Zeilen,
 * die der PLZ-Parser (shared/territories.ts) dann in PLZ auflöst. So bleibt das Ergebnis nachvollziehbar und prüfbar.
 */
export type ColumnRole = "kunde" | "plz" | "ort" | "umkreis" | "kategorie" | "notiz" | "ignorieren";
export type TerritoryLayout = "zeilen" | "kunden-als-spalten" | "ein-kunde";
export type TerritoryPlan = { layout: TerritoryLayout; headerRow: number | null; columns: Array<{ index: number; role: ColumnRole }>; singleCustomerName?: string | null; notes?: string | null };
export type TerritoryDraft = { customerName: string; categoryName: string | null; categoryId: number | null; lines: string[]; rowCount: number; warnings: string[] };
export type Category = { id: number; name: string };

const HEADER_ROLES: Array<[RegExp, ColumnRole]> = [
  [/^(plz|postleitzahl(en)?|zip|zipcode|postal)/i, "plz"],
  [/umkreis|radius|\bkm\b|entfernung|reichweite/i, "umkreis"],
  [/^(ort|stadt|city|gemeinde|region|gebiet|standort|wohnort)/i, "ort"],
  [/kunde|kundin|firma|unternehmen|company|käufer|kaeufer|partner|betrieb|auftraggeber|^name$/i, "kunde"],
  [/kategorie|sparte|produkt|branche|gewerk|leadart|lead-art|thema/i, "kategorie"],
  [/notiz|bemerkung|hinweis|kommentar|info/i, "notiz"],
];
const cell = (value: unknown) => String(value ?? "").replace(/ /g, " ").trim();
const isPlzLike = (value: string) => /^(D-?)?\d{5}$/.test(value) || /^\d{1,5}\s*(-|bis)\s*\d{1,5}$/i.test(value) || /^\d{1,4}$/.test(value) || /^\d{5}(\s*[,;]\s*\d{5})+$/.test(value);
const isRadiusLike = (value: string) => /^\d{1,3}\s*(km|kilometer)?$/i.test(value) && Number(value.replace(/\D/g, "")) >= 1 && Number(value.replace(/\D/g, "")) <= 500;
const looksLikeText = (value: string) => /[A-Za-zÄÖÜäöüß]{2,}/.test(value);

/** Spaltenköpfe erkennen: die erste Zeile, in der die Mehrheit der Zellen Text ist und mindestens ein Kopfwort vorkommt. */
export function detectHeaderRow(rows: string[][]): number | null {
  for (let index = 0; index < Math.min(rows.length, 5); index += 1) {
    const cells = rows[index].map(cell).filter(Boolean); if (cells.length < 1) continue;
    const texty = cells.filter((value) => looksLikeText(value) && !isPlzLike(value)).length;
    const known = cells.some((value) => HEADER_ROLES.some(([pattern]) => pattern.test(value)));
    if (texty >= Math.ceil(cells.length / 2) && known) return index;
    // Nur Namen in der Zeile (z. B. Kundennamen als Spaltenköpfe) und darunter überwiegend PLZ/Zahlen → auch eine Kopfzeile
    const next = rows[index + 1]?.map(cell).filter(Boolean) ?? [];
    if (index === 0 && texty === cells.length && cells.every((value) => !/^\d/.test(value)) && next.length && next.filter((value) => isPlzLike(value) || isRadiusLike(value)).length >= Math.ceil(next.length / 2)) return index;
  }
  return null;
}

/** Regeln ohne KI: Spaltenrollen aus Kopfzeile und Inhalt; Kunden als Spalten, wenn mehrere PLZ-Spalten mit Textköpfen da sind. */
export function detectTerritoryLayout(rows: string[][], categories: Category[] = [], lookupPlace?: (name: string) => boolean): TerritoryPlan {
  const width = Math.max(0, ...rows.map((row) => row.length)); if (!width || !rows.length) return { layout: "ein-kunde", headerRow: null, columns: [] };
  const headerRow = detectHeaderRow(rows); const data = rows.slice(headerRow === null ? 0 : headerRow + 1);
  const header = headerRow === null ? [] : rows[headerRow].map(cell);
  const categoryNames = categories.map((category) => category.name.toLowerCase());
  const columns: Array<{ index: number; role: ColumnRole }> = [];
  const stats = Array.from({ length: width }, (_, index) => { const values = data.map((row) => cell(row[index])).filter(Boolean); const plz = values.filter(isPlzLike).length; const radius = values.filter(isRadiusLike).length; const text = values.filter((value) => looksLikeText(value)).length; const places = lookupPlace ? values.filter((value) => looksLikeText(value) && lookupPlace(value)).length : 0; const cats = values.filter((value) => categoryNames.includes(value.toLowerCase())).length; const distinct = new Set(values.map((value) => value.toLowerCase())).size; return { index, values, plz, radius, text, places, cats, distinct, headerText: header[index] ?? "" }; });
  for (const column of stats) {
    let role: ColumnRole | null = null;
    for (const [pattern, candidate] of HEADER_ROLES) if (column.headerText && pattern.test(column.headerText)) { role = candidate; break; }
    if (!role) {
      const n = column.values.length;
      if (!n) role = "ignorieren";
      else if (column.plz >= n * 0.6) role = "plz";
      else if (column.radius >= n * 0.6 && column.plz < n * 0.5) role = "umkreis";
      else if (column.cats >= n * 0.6) role = "kategorie";
      else if (column.places >= n * 0.5) role = "ort";
      else if (column.text >= n * 0.6 && column.distinct <= Math.max(2, Math.ceil(n * 0.5))) role = "kunde";
      else if (column.text >= n * 0.6) role = "notiz";
      else role = "ignorieren";
    }
    columns.push({ index: column.index, role });
  }
  // Kunden als Spalten: mehrere PLZ-Spalten, deren Köpfe Namen sind (keine PLZ-/Ort-Kopfwörter)
  const plzColumns = columns.filter((column) => column.role === "plz");
  if (headerRow !== null && plzColumns.length >= 2 && !columns.some((column) => column.role === "kunde") && plzColumns.every((column) => looksLikeText(header[column.index] ?? "") && !/plz|postleitzahl|zip/i.test(header[column.index] ?? ""))) return { layout: "kunden-als-spalten", headerRow, columns };
  if (plzColumns.length >= 2 && !columns.some((column) => column.role === "kunde")) { // mehrere PLZ-Spalten ohne Kundennamen: alle als PLZ einer Liste lesen
    return { layout: "ein-kunde", headerRow, columns };
  }
  const hasCustomer = columns.some((column) => column.role === "kunde");
  // Eine Kunden-Spalte, in der jeder Wert nur einmal vorkommt und sonst keine PLZ/Ort-Spalte: eher Notizen → Ein-Kunde
  if (hasCustomer && !columns.some((column) => column.role === "plz" || column.role === "ort")) return { layout: "ein-kunde", headerRow, columns: columns.map((column) => column.role === "kunde" ? { ...column, role: "plz" } : column) };
  return { layout: hasCustomer ? "zeilen" : "ein-kunde", headerRow, columns };
}

/** Kategorie-Namen weich zuordnen („PV“ → Photovoltaik, „Wärmepumpen“ → Wärmepumpe). */
export function matchCategory(value: string | null | undefined, categories: Category[]): Category | null {
  const text = cell(value).toLowerCase(); if (!text) return null;
  const exact = categories.find((category) => category.name.toLowerCase() === text); if (exact) return exact;
  const starts = categories.find((category) => category.name.toLowerCase().startsWith(text) || text.startsWith(category.name.toLowerCase())); if (starts) return starts;
  const initials = categories.find((category) => category.name.toLowerCase().split(/[\s-]+/).map((part) => part[0]).join("") === text); if (initials) return initials;
  const aliases: Array<[RegExp, RegExp]> = [[/^pv$|photovoltaik|solar/i, /photovoltaik|solar|pv/i], [/^wp$|wärmepumpe|waermepumpe|heizung/i, /wärmepumpe|waermepumpe|wp/i], [/fenster/i, /fenster/i], [/dach/i, /dach/i], [/treppenlift/i, /treppenlift/i], [/hörgerät|hoergeraet/i, /hörgerät|hoergeraet/i]];
  for (const [input, target] of aliases) if (input.test(text)) { const hit = categories.find((category) => target.test(category.name)); if (hit) return hit; }
  return null;
}

/**
 * Aus Plan + Tabelle die Gebiets-Entwürfe je Kunde bauen: PLZ-, Ort- und Umkreis-Zellen werden zu Zeilen für den
 * PLZ-Parser („60311“, „Hamburg“, „München 100 km Umkreis“). Kategorie aus der Kategorie-Spalte (weich zugeordnet) oder
 * aus `defaultCategoryId`. Kunden ohne eine einzige verwertbare Zeile bekommen eine Warnung.
 */
export function buildTerritoryDrafts(rows: string[][], plan: TerritoryPlan, options: { categories?: Category[]; fileName?: string | null; defaultCategoryId?: number | null } = {}): TerritoryDraft[] {
  const categories = options.categories ?? []; const start = plan.headerRow === null ? 0 : plan.headerRow + 1; const data = rows.slice(start);
  const roleOf = (role: ColumnRole) => plan.columns.filter((column) => column.role === role).map((column) => column.index);
  const fileCustomer = (options.fileName ?? "").replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || "Neuer Kunde";
  const drafts = new Map<string, TerritoryDraft>();
  const draftFor = (name: string, categoryName: string | null) => { const key = `${name.toLowerCase()}|${(categoryName ?? "").toLowerCase()}`; let draft = drafts.get(key); if (!draft) { const category = matchCategory(categoryName, categories); draft = { customerName: name, categoryName: category?.name ?? categoryName, categoryId: category?.id ?? options.defaultCategoryId ?? null, lines: [], rowCount: 0, warnings: [] }; if (categoryName && !category) draft.warnings.push(`Kategorie „${categoryName}“ gibt es noch nicht – bitte zuordnen.`); drafts.set(key, draft); } return draft; };
  const linesOfRow = (row: string[]) => {
    const lines: string[] = []; const plzCells = roleOf("plz").map((index) => cell(row[index])).filter((value) => /\d/.test(value)); const ortCells = roleOf("ort").map((index) => cell(row[index])).filter(Boolean); const radiusCells = roleOf("umkreis").map((index) => cell(row[index])).filter(Boolean);
    const km = radiusCells.map((value) => Number(value.replace(/\D/g, ""))).find((value) => value >= 1 && value <= 500) ?? null;
    if (km && (plzCells.length || ortCells.length)) { for (const center of [...plzCells, ...ortCells]) lines.push(`${center} ${km} km Umkreis`); return lines; }
    lines.push(...plzCells); lines.push(...ortCells); return lines;
  };
  if (plan.layout === "kunden-als-spalten") {
    const header = plan.headerRow === null ? [] : rows[plan.headerRow].map(cell);
    for (const column of plan.columns.filter((item) => item.role === "plz")) { const draft = draftFor(header[column.index] || `Spalte ${column.index + 1}`, null); for (const row of data) { const value = cell(row[column.index]); if (value) { draft.lines.push(value); draft.rowCount += 1; } } }
  } else if (plan.layout === "zeilen") {
    const customerColumns = roleOf("kunde"); const categoryColumns = roleOf("kategorie");
    let lastName = ""; let lastCategory: string | null = null;
    for (const row of data) {
      const name = customerColumns.map((index) => cell(row[index])).find(Boolean) || lastName; if (!name) continue; lastName = name; // leere Kundenzelle = gleicher Kunde wie die Zeile davor (Excel-Gruppierung)
      const categoryName: string | null = categoryColumns.map((index) => cell(row[index])).find(Boolean) || lastCategory; lastCategory = categoryName;
      const draft = draftFor(name, categoryName ?? null); const lines = linesOfRow(row); if (lines.length) { draft.lines.push(...lines); draft.rowCount += 1; }
    }
  } else {
    const name = plan.singleCustomerName?.trim() || fileCustomer; const categoryColumns = roleOf("kategorie");
    const categoryName = data.map((row) => categoryColumns.map((index) => cell(row[index])).find(Boolean)).find(Boolean) ?? null;
    const draft = draftFor(name, categoryName); const plzColumns = roleOf("plz");
    for (const row of data) { const lines = plzColumns.length || roleOf("ort").length ? linesOfRow(row) : row.map(cell).filter((value) => isPlzLike(value) || /\d{1,3}\s*km/i.test(value)); if (lines.length) { draft.lines.push(...lines); draft.rowCount += 1; } }
  }
  for (const draft of Array.from(drafts.values())) { draft.customerName = draft.customerName.replace(/\s+/g, " ").slice(0, 160); if (!draft.lines.length) draft.warnings.push("Keine PLZ, Orte oder Umkreise gefunden."); }
  return Array.from(drafts.values());
}

/** Plan in einem Satz erklären – für die Vorschau („Kunde in Spalte B, PLZ in Spalte D …“). */
export function describePlan(plan: TerritoryPlan, rows: string[][]): string {
  const letter = (index: number) => String.fromCharCode(65 + (index % 26));
  const header = plan.headerRow === null ? [] : rows[plan.headerRow].map(cell);
  const name = (index: number) => header[index] ? `„${header[index]}“ (${letter(index)})` : `Spalte ${letter(index)}`;
  const roles: Record<ColumnRole, string> = { kunde: "Kunde", plz: "PLZ", ort: "Ort", umkreis: "Umkreis", kategorie: "Kategorie", notiz: "Notiz", ignorieren: "übersprungen" };
  const parts = plan.columns.filter((column) => column.role !== "ignorieren").map((column) => `${roles[column.role]}: ${name(column.index)}`);
  const layout = plan.layout === "kunden-als-spalten" ? "Jede Spalte ist ein Kunde, darunter seine PLZ." : plan.layout === "zeilen" ? "Jede Zeile gehört zu dem Kunden in der Kunden-Spalte." : `Die ganze Liste gehört einem Kunden${plan.singleCustomerName ? ` („${plan.singleCustomerName}“)` : ""}.`;
  return `${layout}${parts.length ? ` ${parts.join(" · ")}.` : ""}${plan.headerRow === null ? " Keine Kopfzeile erkannt." : ""}`;
}

/* ---------------------------------------------------------------- KI: Prompt und Antwort */
export const TERRITORY_PLAN_SCHEMA = { name: "gebietsliste_struktur", schema: { type: "object", additionalProperties: false, properties: { layout: { type: "string", enum: ["zeilen", "kunden-als-spalten", "ein-kunde"] }, headerRow: { type: ["integer", "null"] }, columns: { type: "array", items: { type: "object", additionalProperties: false, properties: { index: { type: "integer" }, role: { type: "string", enum: ["kunde", "plz", "ort", "umkreis", "kategorie", "notiz", "ignorieren"] } }, required: ["index", "role"] } }, singleCustomerName: { type: ["string", "null"] }, notes: { type: ["string", "null"] } }, required: ["layout", "headerRow", "columns"] } };
export function territoryPlanPrompt(rows: string[][], fileName: string | null | undefined, categories: Category[]): string {
  const sample = rows.slice(0, 40).map((row, index) => `${index}: ${row.map((value) => cell(value).slice(0, 40)).join(" | ")}`).join("\n");
  return [`Eine deutsche Lead-Firma lädt eine Tabelle mit Einsatzgebieten ihrer Kunden hoch (Datei: ${fileName ?? "unbekannt"}). Erkenne die Struktur.`,
    `Mögliche Spaltenrollen: kunde (Firmenname des Kunden), plz (Postleitzahlen, auch Vorwahl-Bereiche wie 60 oder Bereiche wie 60000-60599), ort (Stadt/Gemeinde), umkreis (Kilometer um Ort/PLZ), kategorie (Lead-Kategorie, bekannte Kategorien: ${categories.map((category) => category.name).join(", ") || "keine"}), notiz, ignorieren.`,
    `Layouts: "zeilen" = jede Zeile gehört zu dem Kunden in einer Kunden-Spalte; "kunden-als-spalten" = Spaltenköpfe sind Kundennamen und darunter stehen deren PLZ; "ein-kunde" = die ganze Liste gehört einem Kunden (singleCustomerName aus Dateiname oder Inhalt, sonst null).`,
    `headerRow = Zeilennummer der Kopfzeile (0-basiert) oder null, wenn die Daten sofort beginnen. Zeilen (0-basiert, Zellen mit | getrennt):`, sample].join("\n\n");
}
export function parseTerritoryPlan(text: string, width: number): TerritoryPlan | null {
  try {
    const match = text.match(/\{[\s\S]*\}/); if (!match) return null; const raw = JSON.parse(match[0]) as Partial<TerritoryPlan>;
    const layout: TerritoryLayout = raw.layout === "zeilen" || raw.layout === "kunden-als-spalten" || raw.layout === "ein-kunde" ? raw.layout : "ein-kunde";
    const roles: ColumnRole[] = ["kunde", "plz", "ort", "umkreis", "kategorie", "notiz", "ignorieren"];
    const columns = Array.isArray(raw.columns) ? raw.columns.filter((column) => column && Number.isInteger(column.index) && column.index >= 0 && column.index < width && roles.includes(column.role)).map((column) => ({ index: column.index, role: column.role })) : [];
    if (!columns.length) return null;
    const headerRow = typeof raw.headerRow === "number" && raw.headerRow >= 0 ? Math.floor(raw.headerRow) : null;
    return { layout, headerRow, columns, singleCustomerName: typeof raw.singleCustomerName === "string" ? raw.singleCustomerName.slice(0, 160) : null, notes: typeof raw.notes === "string" ? raw.notes.slice(0, 300) : null };
  } catch { return null; }
}
/** Tabelle für die Übertragung zum Server eindampfen: höchstens 400 Zeilen × 30 Spalten, Zellen ≤ 80 Zeichen. */
export function trimTable(rows: unknown[][], maxRows = 400, maxCols = 30): string[][] {
  return rows.slice(0, maxRows).map((row) => row.slice(0, maxCols).map((value) => cell(value).slice(0, 80)));
}
