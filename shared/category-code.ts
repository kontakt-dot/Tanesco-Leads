/**
 * Kurze Kürzel für Lead-Kategorien.
 * Das gespeicherte Kürzel (shortcode) bleibt der technische Schlüssel – hier geht es nur darum, dass es kurz ist:
 * neue Kategorien bekommen ein kurzes Kürzel aus dem Namen, und in der Kreis-Anzeige wird ein zu langes Kürzel
 * durch die Kurzform aus dem Namen ersetzt (ALARMANL → ALA).
 */
const ascii = (value: string) => value.toUpperCase().replace(/Ä/g, "AE").replace(/Ö/g, "OE").replace(/Ü/g, "UE").replace(/ß/gi, "SS");

/** Kürzel aus dem Namen: mehrere Wörter → Anfangsbuchstaben (max. 4), ein Wort → die ersten 3 Buchstaben. */
export function shortCategoryCode(name: string): string {
  const words = ascii(name).split(/[^A-Z0-9]+/).filter(Boolean);
  if (!words.length) return "KAT";
  if (words.length === 1) return words[0].slice(0, 3);
  return words.map((word) => word[0]).join("").slice(0, 4);
}

/** Was im Kreis steht: das gespeicherte Kürzel, wenn es kurz genug ist (bis 4 Zeichen), sonst die Kurzform aus dem Namen. */
export function categoryBadgeCode(shortcode: string | null | undefined, name: string | null | undefined): string {
  const code = (shortcode ?? "").trim();
  if (code && code.length <= 4) return code;
  return shortCategoryCode(name || code);
}
