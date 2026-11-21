/**
 * Suche in den Gesprächen – dieselbe Regel für Server und Vorschau.
 * Jedes Wort der Eingabe muss irgendwo vorkommen: beim Kunden (Name, Lead-Nummer, Ort), in der Rufnummer, beim Agenten (auch Alias),
 * in der Kampagne, in der Kurzfassung oder im Text des Gesprächs. Groß- und Kleinschreibung spielen keine Rolle.
 * Rufnummern: Leerzeichen, Bindestriche und Schrägstriche zählen nicht; „0152 …“ findet auch „+49 152 …“.
 */
export const SEARCH_MAX_WORDS = 6;
/** Eingabe in Wörter zerlegen (höchstens sechs, je mindestens zwei Zeichen). */
export function searchWords(search: unknown): string[] {
  const text = typeof search === "string" ? search.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  if (!text) return [];
  // eine Rufnummer mit Leerzeichen („0152 027 28987“) ist EIN Suchwort
  if (/^[+\d][\d\s\-/()]{4,}$/.test(text)) return [text.replace(/[^\d+]/g, "")];
  return Array.from(new Set(text.split(" ").filter((word) => word.length >= 2))).slice(0, SEARCH_MAX_WORDS);
}
/** Ziffern eines Suchworts, wenn es wie ein Stück Rufnummer aussieht – ohne Ländervorwahl und führende Null, damit „0152…“ auch „+49152…“ trifft. */
export function phoneFragment(word: string): string | null {
  if (!/^[+\d][\d\s\-/()]*$/.test(word)) return null;
  const digits = word.replace(/\D/g, "").replace(/^(?:0049|49(?=1[5-7]|[2-9]\d)|0)/, "");
  return digits.length >= 3 ? digits : null;
}
const fold = (value: unknown) => String(value ?? "").toLowerCase();
/** Passt ein Gespräch zur Suche? `texts` sind alle durchsuchbaren Angaben, `phone` die Rufnummer. */
export function matchesCallSearch(search: unknown, texts: Array<string | null | undefined>, phone?: string | null): boolean {
  const words = searchWords(search); if (!words.length) return true;
  const hay = texts.map(fold); const phoneDigits = String(phone ?? "").replace(/\D/g, "");
  return words.every((word) => { const needle = fold(word); const digits = phoneFragment(word); return hay.some((text) => text.includes(needle)) || fold(phone).includes(needle) || Boolean(digits && phoneDigits.includes(digits)); });
}
