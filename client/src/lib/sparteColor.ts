import { categoryColor } from "./colors";

type CategoryRow = { id: number; name: string; color?: string | null };

const plain = (text: string) => text.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ").trim();

/** „Alarmanlage“ und „Alarmanlagen“ meinen dasselbe: gleich geschrieben – oder das längere Wort hängt nur eine Endung (bis zwei Buchstaben) an. */
export function sameSparteName(a: string, b: string): boolean {
  const x = plain(a); const y = plain(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && long.startsWith(short) && long.length - short.length <= 2;
}

/**
 * Farbe für das Schild der Leadsparte einer Kampagne – dieselbe Farbe, die die Lead-Kategorie überall trägt (Leads, Dashboard, Vertriebspipeline).
 * Reihenfolge: genau eine gewählte Lead-Kategorie → ihre Farbe; sonst die Kategorie, die so heißt wie die Sparte
 * („Photovoltaik & Wärmepumpe“ ist eine eigene Kategorie); sonst die erste gewählte.
 * Ohne Wahl und ohne erkannte Sparte („Standard“) bleibt das Schild ohne Farbe.
 */
export function sparteColor(sparte: { label: string; source?: string } | null | undefined, chosen: CategoryRow[], all: CategoryRow[]): string | null {
  if (!sparte || sparte.source === "standard") return null;
  if (chosen.length === 1) return categoryColor(chosen[0]);
  const named = all.find((row) => sameSparteName(row.name, sparte.label));
  if (named) return categoryColor(named);
  return chosen.length ? categoryColor(chosen[0]) : null;
}
