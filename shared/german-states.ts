/**
 * Bundesländer und ihre PLZ-Anfänge (die ersten zwei Ziffern – eine grobe Zuordnung: An den Grenzen gehört ein Anfang zu zwei Ländern).
 * Eine Quelle für das Gebiet einer Station der Lieferkette und für das Liefergebiet einer Bestellung.
 */
export const GERMAN_STATES: Record<string, string[]> = {
  "Schleswig-Holstein": ["22", "23", "24", "25"], Hamburg: ["20", "21", "22"], Niedersachsen: ["19", "21", "26", "27", "28", "29", "30", "31", "34", "37", "38", "48", "49"], Bremen: ["27", "28"],
  "Nordrhein-Westfalen": ["32", "33", "34", "40", "41", "42", "44", "45", "46", "47", "48", "50", "51", "52", "53", "57", "58", "59"], Hessen: ["34", "35", "36", "37", "55", "60", "61", "63", "64", "65", "68"],
  "Rheinland-Pfalz": ["54", "55", "56", "57", "66", "67", "76"], "Baden-Württemberg": ["68", "69", "70", "71", "72", "73", "74", "75", "76", "77", "78", "79", "88", "89", "97"],
  Bayern: ["63", "80", "81", "82", "83", "84", "85", "86", "87", "88", "89", "90", "91", "92", "93", "94", "95", "96", "97"], Saarland: ["66"], Berlin: ["10", "12", "13", "14"],
  Brandenburg: ["01", "03", "04", "14", "15", "16", "17", "19", "39"], "Mecklenburg-Vorpommern": ["17", "18", "19", "23"], Sachsen: ["01", "02", "04", "07", "08", "09"], "Sachsen-Anhalt": ["06", "29", "38", "39"], Thüringen: ["04", "07", "36", "96", "98", "99"],
};
export const GERMAN_STATE_NAMES = Object.keys(GERMAN_STATES);

export type DeliveryArea = { /** PLZ-Anfänge, die passen (Bundesländer übersetzt, Ziffern wie eingetragen) */ prefixes: string[]; /** erkannte Bundesländer */ states: string[]; /** eingetragene PLZ-Anfänge */ postcodes: string[]; /** was weder Bundesland noch Ziffern ist */ unknown: string[] };
/**
 * Gebiet einer Bestellung lesen. Im Feld steht entweder eine Liste von Bundesländern („Hessen, Bayern“ – Liefergebiet „regional“)
 * oder eine Liste von PLZ-Anfängen („60, 61, 65“). Bundesländer werden in ihre PLZ-Anfänge übersetzt.
 */
export function readDeliveryArea(text: string | null | undefined): DeliveryArea {
  const tokens = String(text ?? "").split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean);
  const area: DeliveryArea = { prefixes: [], states: [], postcodes: [], unknown: [] };
  for (const token of tokens) {
    const state = GERMAN_STATE_NAMES.find((name) => name.toLowerCase() === token.toLowerCase());
    if (state) { area.states.push(state); area.prefixes.push(...GERMAN_STATES[state]); }
    else if (/^\d{1,5}$/.test(token)) { area.postcodes.push(token); area.prefixes.push(token); }
    else area.unknown.push(token);
  }
  area.prefixes = Array.from(new Set(area.prefixes));
  return area;
}
