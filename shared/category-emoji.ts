/**
 * Emojis für Lead-Kategorien: jede Kategorie kann ein eigenes Emoji tragen (Grundeinstellungen);
 * ohne eigenes Emoji wird aus dem Namen ein passendes vorgeschlagen. Anzeige dezent (in Chips, Pillen, Typ-Spalte).
 */
const RULES: Array<[RegExp, string]> = [
  [/photovoltaik|solar|\bpv\b/i, "☀️"],
  [/balkonkraftwerk|speicher|batterie/i, "🔋"],
  [/wärmepumpe|waermepumpe/i, "♨️"],
  [/heizung|kessel|pellet|öl|gas/i, "🔥"],
  [/klima/i, "❄️"],
  [/fenster/i, "🪟"],
  [/haustür|haustuer|tür|tuer|tor\b/i, "🚪"],
  [/treppenlift|aufzug|lift/i, "🛗"],
  [/treppe/i, "🪜"],
  [/bad|bäder|baeder|dusche|sanitär|sanitaer/i, "🛁"],
  [/alarm|einbruch|sicherheit|überwachung|ueberwachung|kamera/i, "🚨"],
  [/wintergarten|wintergärten|wintergaerten|terrasse|überdachung|ueberdachung/i, "🌿"],
  [/rollstuhl|rollstühle|rollstuehle|barrierefrei/i, "♿"],
  [/rollator|gehhilfe|mobilität|mobilitaet/i, "🚶"],
  [/hörgerät|hoergeraet|hörakustik|hoerakustik|hören|hoeren/i, "🦻"],
  [/brille|optik|sehen/i, "👓"],
  [/zahn|dental/i, "🦷"],
  [/hausnotruf|notruf/i, "🆘"],
  [/pflege|reha|gesundheit|medizin/i, "🩺"],
  [/dach|dächer|daecher/i, "🏠"],
  [/fassade|dämm|daemm|wärmedämmung/i, "🧱"],
  [/küche|kueche/i, "🍳"],
  [/garten|zaun|landschaft/i, "🌳"],
  [/pool|schwimm/i, "🏊"],
  [/markise|sonnenschutz|rollladen|rolllad/i, "⛱️"],
  [/strom|energie|elektro|wallbox|laden/i, "⚡"],
  [/wasser|brunnen|enthärt|enthaert/i, "💧"],
  [/umzug|transport|lager/i, "📦"],
  [/versicherung|vorsorge/i, "🛡️"],
  [/kredit|finanz|darlehen|baufinanz|leasing/i, "💶"],
  [/immobilie|wohnung|haus(verkauf|kauf)|makler/i, "🏢"],
  [/auto|kfz|fahrzeug|wagen/i, "🚗"],
  [/reise|urlaub|hotel/i, "✈️"],
  [/internet|telefon|mobilfunk|dsl|glasfaser/i, "📶"],
  [/möbel|moebel|sofa|einrichtung/i, "🛋️"],
  [/bett|matratze|schlaf/i, "🛏️"],
  [/gewerbe|firma|b2b|business/i, "🏭"],
];

export const EMOJI_CHOICES = ["☀️", "🔋", "♨️", "🔥", "❄️", "🪟", "🚪", "🛗", "🪜", "🛁", "🚨", "🌿", "♿", "🚶", "🦻", "👓", "🦷", "🆘", "🩺", "🏠", "🧱", "🍳", "🌳", "🏊", "⛱️", "⚡", "💧", "📦", "🛡️", "💶", "🏢", "🚗", "✈️", "📶", "🛋️", "🛏️", "🏭", "🏷️"];

/** Vorschlag aus dem Namen (erste passende Regel, sonst Etikett). */
export function suggestCategoryEmoji(name: string | null | undefined): string {
  const value = String(name ?? "");
  for (const [pattern, emoji] of RULES) if (pattern.test(value)) return emoji;
  return "🏷️";
}

/** Emoji einer Kategorie: eigenes Emoji, sonst Vorschlag aus dem Namen. */
export function categoryEmoji(category: { name?: string | null; emoji?: string | null } | null | undefined): string {
  if (!category) return "🏷️";
  const own = String(category.emoji ?? "").trim();
  return own || suggestCategoryEmoji(category.name);
}

/** Grob prüfen, dass ein Emoji (1–3 Zeichen inkl. Varianten/Joiner) eingegeben wurde. */
export function isValidEmoji(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > 16) return false;
  return !/[a-z0-9]/i.test(trimmed);
}
