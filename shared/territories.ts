/**
 * Gebietskarte: Einsatzgebiete der Kunden als PLZ-Listen, je Sparte (Lead-Kategorie). Ein Lead aus einer PLZ lässt sich an
 * alle Kunden verkaufen, deren Gebiet diese PLZ in derselben Sparte enthält – deshalb zählt die Karte, welche PLZ bei
 * mehreren Kunden liegen („Überschneidungen“), wie oft und genau wo.
 *
 * Eingaben: 5-stellige PLZ, kürzere Vorwahl-Bereiche („60“ = alle 60xxx, „601“ = alle 601xx), Bereiche („60000-60599“,
 * „60000 bis 60599“). Getrennt durch Zeilen, Kommas, Semikolons oder Leerzeichen. Kopfzeilen und Text werden übersprungen.
 */
export type Territory = { id: number; customerName: string; categoryId: number | null; color: string; postcodes: string[]; note?: string | null; sourceName?: string | null };
export type ParsedPostcodes = { postcodes: string[]; direct: number; fromPrefixes: number; fromRanges: number; unknown: string[]; ignored: number; prefixes: string[]; ranges: Array<[string, string]> };

/** Farben für Kunden auf der Karte – kräftig und unterscheidbar, in beiden Themes lesbar. */
export const TERRITORY_COLORS = ["#2f6df6", "#e2583e", "#13a37a", "#d9a21b", "#8b5cf6", "#0ea5c9", "#ec4899", "#7c8f1d", "#f97316", "#64748b"];
export const colorForIndex = (index: number) => TERRITORY_COLORS[index % TERRITORY_COLORS.length];

/** Text → PLZ-Liste. `universe` = alle bekannten deutschen PLZ (für Vorwahl-Bereiche, Bereiche und die Prüfung „gibt es die?“). */
export function parsePostcodeText(text: string, universe: Set<string> | string[]): ParsedPostcodes {
  const all = universe instanceof Set ? universe : new Set(universe);
  const sorted = Array.from(all).sort();
  const found = new Set<string>(); const unknown = new Set<string>(); const prefixes: string[] = []; const ranges: Array<[string, string]> = [];
  let direct = 0; let fromPrefixes = 0; let fromRanges = 0; let ignored = 0;
  const normalized = text.replace(/ /g, " ").replace(/[–—]/g, "-").replace(/\s+bis\s+/gi, "-");
  const tokens = normalized.split(/[\n\r,;|\t ]+/).map((token) => token.trim()).filter(Boolean);
  for (const raw of tokens) {
    const token = raw.replace(/^D-?/i, "").replace(/[^0-9-]/g, "");
    if (!token) { ignored += 1; continue; }
    const range = token.match(/^(\d{1,5})-(\d{1,5})$/);
    if (range) {
      const from = range[1].padEnd(5, "0"); const to = range[2].padEnd(5, "9").slice(0, 5); const lo = from <= to ? from : to; const hi = from <= to ? to : from; let hits = 0;
      for (const plz of sorted) { if (plz < lo) continue; if (plz > hi) break; if (!found.has(plz)) { found.add(plz); hits += 1; } }
      if (hits) { fromRanges += hits; ranges.push([lo, hi]); } else unknown.add(raw);
      continue;
    }
    if (!/^\d{1,5}$/.test(token)) { ignored += 1; continue; }
    if (token.length === 5) { if (all.has(token)) { if (!found.has(token)) { found.add(token); direct += 1; } } else unknown.add(token); continue; }
    // Vorwahl-Bereich: 1–4 Ziffern → alle PLZ mit diesem Anfang
    let hits = 0; for (const plz of sorted) { if (plz.startsWith(token)) { if (!found.has(plz)) { found.add(plz); hits += 1; } } else if (plz > token + "99999") break; }
    if (hits) { fromPrefixes += hits; prefixes.push(token); } else unknown.add(token);
  }
  return { postcodes: Array.from(found).sort(), direct, fromPrefixes, fromRanges, unknown: Array.from(unknown).slice(0, 50), ignored, prefixes, ranges };
}

export type OverlapCustomer = { id: number; customerName: string; color: string };
export type OverlapItem = { plz: string; count: number; customers: OverlapCustomer[] };
export type OverlapGroup = { categoryId: number | null; categoryName: string; customers: number; coveredPlz: number; overlapPlz: number; maxCustomers: number; items: OverlapItem[]; pairs: Array<{ a: OverlapCustomer; b: OverlapCustomer; shared: number }> };
/**
 * Überschneidungen je Sparte: PLZ, die bei zwei oder mehr Kunden derselben Sparte liegen – mit Anzahl und den Kunden.
 * Gebiete ohne Sparte zählen in der Gruppe „Ohne Sparte“ nur untereinander. Zusätzlich je Kundenpaar die Zahl gemeinsamer PLZ.
 */
export function computeOverlaps(territories: Territory[], categories: Array<{ id: number; name: string }> = []): { groups: OverlapGroup[]; totalOverlapPlz: number; totalCoveredPlz: number } {
  const byCategory = new Map<number | null, Territory[]>();
  for (const territory of territories) { const key = territory.categoryId ?? null; byCategory.set(key, [...(byCategory.get(key) ?? []), territory]); }
  const groups: OverlapGroup[] = []; const coveredAll = new Set<string>(); let totalOverlapPlz = 0;
  for (const [categoryId, list] of Array.from(byCategory.entries())) {
    const owners = new Map<string, OverlapCustomer[]>();
    for (const territory of list) for (const plz of territory.postcodes) { coveredAll.add(plz); const current = owners.get(plz) ?? []; if (!current.some((item) => item.id === territory.id)) current.push({ id: territory.id, customerName: territory.customerName, color: territory.color }); owners.set(plz, current); }
    const items = Array.from(owners.entries()).filter(([, customers]) => customers.length >= 2).map(([plz, customers]) => ({ plz, count: customers.length, customers })).sort((a, b) => b.count - a.count || a.plz.localeCompare(b.plz));
    const pairs: OverlapGroup["pairs"] = [];
    for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) { const setB = new Set(list[j].postcodes); const shared = list[i].postcodes.filter((plz) => setB.has(plz)).length; if (shared) pairs.push({ a: { id: list[i].id, customerName: list[i].customerName, color: list[i].color }, b: { id: list[j].id, customerName: list[j].customerName, color: list[j].color }, shared }); }
    pairs.sort((a, b) => b.shared - a.shared);
    totalOverlapPlz += items.length;
    groups.push({ categoryId, categoryName: categoryId === null ? "Ohne Sparte" : categories.find((category) => category.id === categoryId)?.name ?? `Sparte ${categoryId}`, customers: list.length, coveredPlz: owners.size, overlapPlz: items.length, maxCustomers: items.reduce((max, item) => Math.max(max, item.count), 0), items, pairs });
  }
  groups.sort((a, b) => b.overlapPlz - a.overlapPlz || a.categoryName.localeCompare(b.categoryName, "de"));
  return { groups, totalOverlapPlz, totalCoveredPlz: coveredAll.size };
}

/** „Wo genau“: Überschneidungen nach Region (erste zwei Ziffern) bündeln – mit Orten und Beispiel-PLZ, sortiert nach Anzahl. */
export function groupOverlapsByRegion(items: OverlapItem[], placeOf: (plz: string) => string | null): Array<{ region: string; plzCount: number; maxCustomers: number; places: string[]; postcodes: string[]; customers: OverlapCustomer[] }> {
  const regions = new Map<string, OverlapItem[]>();
  for (const item of items) { const key = item.plz.slice(0, 2); regions.set(key, [...(regions.get(key) ?? []), item]); }
  return Array.from(regions.entries()).map(([region, list]) => {
    const places = topPlaces(list.map((item) => item.plz), placeOf, 6);
    const customers = new Map<number, OverlapCustomer>(); for (const item of list) for (const customer of item.customers) customers.set(customer.id, customer);
    return { region, plzCount: list.length, maxCustomers: list.reduce((max, item) => Math.max(max, item.count), 0), places, postcodes: list.map((item) => item.plz).sort(), customers: Array.from(customers.values()) };
  }).sort((a, b) => b.plzCount - a.plzCount || a.region.localeCompare(b.region));
}

/** CSV der Überschneidungen (Excel-tauglich, Semikolon): Sparte;PLZ;Ort;Anzahl Kunden;Kunden */
export function overlapsCsv(groups: OverlapGroup[], placeOf: (plz: string) => string | null): string {
  const rows = [["Sparte", "PLZ", "Ort", "Anzahl Kunden", "Kunden"]];
  for (const group of groups) for (const item of group.items) rows.push([group.categoryName, item.plz, placeOf(item.plz) ?? "", String(item.count), item.customers.map((customer) => customer.customerName).join(" + ")]);
  return rows.map((row) => row.map((cell) => /[;"\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell).join(";")).join("\n");
}

/** Kurze Zusammenfassung eines Gebiets: „1.204 PLZ · Hamburg, Lübeck, Kiel …“ */
export function describePostcodes(postcodes: string[], placeOf: (plz: string) => string | null, limit = 4): string {
  const places = topPlaces(postcodes, placeOf, limit);
  return `${postcodes.length.toLocaleString("de-DE")} PLZ${places.length ? ` · ${places.join(", ")}${postcodes.length > limit ? " …" : ""}` : ""}`;
}
/** Die häufigsten Orte einer PLZ-Liste (Städte mit vielen PLZ zuerst) – so dominieren nie einzelne Ausreißer-Namen. */
export function topPlaces(postcodes: string[], placeOf: (plz: string) => string | null, limit = 4): string[] {
  const counts = new Map<string, number>(); for (const plz of postcodes) { const place = placeOf(plz); if (place) counts.set(place, (counts.get(place) ?? 0) + 1); }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de")).slice(0, limit).map(([place]) => place);
}
