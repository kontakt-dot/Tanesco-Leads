/**
 * Lieferketten – feste Verteilung, eine Quelle für Server, Vorschau und Oberfläche.
 * Eine Kette legt fest: welche Kategorie · von welchen Lieferanten · an welche Kunden (in fester Reihenfolge).
 * Passen mehrere Ketten zu einem Lead, gilt immer dieselbe Reihenfolge: kleinere Zahl zuerst, bei gleicher Zahl die ältere Kette.
 * Es wird nicht abgewechselt.
 */

export type SupplierFilterMode = "all" | "include" | "exclude";
export type ChainRule = { id: number; name: string; categoryId: number; priority: number; status: "aktiv" | "inaktiv" | string; supplierFilterMode: SupplierFilterMode | string; supplierIds: number[] };

/** Feste Reihenfolge der Ketten: kleinere Zahl zuerst, bei gleicher Zahl die ältere Kette. */
export const byChainOrder = (a: { priority: number; id: number }, b: { priority: number; id: number }): number => a.priority - b.priority || a.id - b.id;

/** Nimmt die Kette Leads dieses Lieferanten an? (`null` = Lead ohne Lieferant) */
export function chainAcceptsSupplier(chain: Pick<ChainRule, "supplierFilterMode" | "supplierIds">, supplierId: number | null): boolean {
  if (chain.supplierFilterMode === "include") return supplierId !== null && chain.supplierIds.includes(supplierId);
  if (chain.supplierFilterMode === "exclude") return supplierId === null || !chain.supplierIds.includes(supplierId);
  return true;
}

/** Können zwei Ketten denselben Lead bekommen? Gleiche Kategorie und mindestens ein Lieferant, den beide annehmen. */
export function chainsOverlap(a: ChainRule, b: ChainRule): boolean {
  if (a.id === b.id || a.categoryId !== b.categoryId) return false;
  const modeA = a.supplierFilterMode; const modeB = b.supplierFilterMode;
  if (modeA === "include" && modeB === "include") return a.supplierIds.some((id) => b.supplierIds.includes(id));
  if (modeA === "include") return a.supplierIds.some((id) => chainAcceptsSupplier(b, id));
  if (modeB === "include") return b.supplierIds.some((id) => chainAcceptsSupplier(a, id));
  return true; // „alle“ oder „alle außer“: Es bleibt immer ein gemeinsamer Lieferant (oder ein Lead ohne Lieferant)
}

/** „Alle Lieferanten“ · „OnDialer, Leadquelle Nord“ · „Alle außer Leadquelle Nord“ */
export function supplierText(mode: SupplierFilterMode | string, names: string[]): string {
  if (mode === "include") return names.length ? names.join(", ") : "Kein Lieferant gewählt";
  if (mode === "exclude") return names.length ? `Alle außer ${names.join(", ")}` : "Alle Lieferanten";
  return "Alle Lieferanten";
}

export type ChainPlace = { place: number; overlapsWith: number[]; before: number[] };
/**
 * Platz jeder Kette in ihrer Kategorie (1., 2., …) und mit welchen aktiven Ketten sie sich einen Lead teilen könnte.
 * `before` = Ketten, die bei so einem Lead vorher drankommen.
 */
export function chainPlaces(chains: ChainRule[]): Map<number, ChainPlace> {
  const out = new Map<number, ChainPlace>();
  const categories = Array.from(new Set(chains.map((chain) => chain.categoryId)));
  for (const categoryId of categories) {
    const group = chains.filter((chain) => chain.categoryId === categoryId).sort(byChainOrder);
    group.forEach((chain, index) => {
      const active = chain.status === "aktiv";
      const overlaps = active ? group.filter((other) => other.status === "aktiv" && chainsOverlap(chain, other)) : [];
      out.set(chain.id, { place: index + 1, overlapsWith: overlaps.map((other) => other.id), before: overlaps.filter((other) => byChainOrder(other, chain) < 0).map((other) => other.id) });
    });
  }
  return out;
}

/** Name-Vorschlag für eine neue Kette: „Photovoltaik: OnDialer → Nordlicht Energie → Aurora Home“. */
export function suggestChainName(category: string, suppliers: string[], buyers: string[]): string {
  const from = suppliers.length ? suppliers.slice(0, 2).join(" + ") + (suppliers.length > 2 ? ` + ${suppliers.length - 2}` : "") : "Alle Lieferanten";
  const to = buyers.length ? buyers.slice(0, 3).join(" → ") + (buyers.length > 3 ? " → …" : "") : "noch kein Kunde";
  return `${category}: ${from} → ${to}`.slice(0, 160);
}

/** Neue Reihenfolge innerhalb einer Kategorie: Die Ketten bekommen die Zahlen 1, 2, 3 … in der gewünschten Folge. */
export function reorderedPriorities(chainIds: number[]): Array<{ id: number; priority: number }> {
  return Array.from(new Set(chainIds)).map((id, index) => ({ id, priority: index + 1 }));
}

const joinAnd = (items: string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} und ${items[items.length - 1]}`);
/**
 * Die Regel einer Kette als Satz: „Leads aus Photovoltaik von OnDialer gehen zuerst an Solar Nord. Nimmt Solar Nord einen Lead nicht, geht er an Aurora Home.“
 * `suppliers` ist der Text aus supplierText().
 */
export function ruleSentence(categories: string[], suppliers: string, buyers: string[]): string {
  const what = categories.length ? `Leads aus ${joinAnd(categories)}` : "Leads";
  const from = suppliers === "Alle Lieferanten" ? "von allen Lieferanten" : suppliers.startsWith("Alle außer ") ? `von allen Lieferanten außer ${suppliers.slice("Alle außer ".length)}` : suppliers === "Kein Lieferant gewählt" ? "(noch kein Lieferant gewählt)" : `von ${suppliers}`;
  if (!buyers.length) return `${what} ${from}: Es ist noch kein Kunde eingetragen.`;
  const first = `${what} ${from} gehen zuerst an ${buyers[0]}.`;
  if (buyers.length === 1) return first;
  const rest = buyers.slice(1).map((buyer, index) => (index === 0 ? `Nimmt ${buyers[0]} einen Lead nicht, geht er an ${buyer}` : `danach an ${buyer}`)).join(", ");
  return `${first} ${rest}.`;
}

/** Preis aus einem Eingabefeld lesen (seit v370): „44,50“ und „44.50“ geben 44,5; steht ein Komma drin, gilt der Punkt als Tausender („1.250,00“ → 1250). Nie negativ, Unlesbares wird 0. */
export function parsePrice(value: string): number {
  const text = String(value ?? "").trim(); const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  return Math.max(0, Number(normalized) || 0);
}
