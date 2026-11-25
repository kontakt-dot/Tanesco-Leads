/** Seitenknöpfe unter der Tabelle: bis 7 Seiten alle, sonst die erste, die letzte und die Nachbarn der aktuellen – Lücken als „…“ (null) */
export function pageItems(current: number, count: number): Array<number | null> {
  if (count <= 7) return Array.from({ length: Math.max(1, count) }, (_, index) => index + 1);
  const pages = new Set([1, count, current - 1, current, current + 1].filter((page) => page >= 1 && page <= count));
  if (current <= 3) [2, 3, 4].forEach((page) => pages.add(page));
  if (current >= count - 2) [count - 3, count - 2, count - 1].forEach((page) => pages.add(page));
  const sorted = Array.from(pages).sort((a, b) => a - b); const items: Array<number | null> = [];
  sorted.forEach((page, index) => { if (index && page - sorted[index - 1] > 1) items.push(null); items.push(page); });
  return items;
}
