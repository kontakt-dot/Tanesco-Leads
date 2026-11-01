/**
 * Listennamen lesbar machen: aus technischen Dateinamen wie „PV_WP_Aroundhome_Vielkaeufer_ab_100_Bewertungen_neu.xlsx“
 * wird „Photovoltaik & Wärmepumpe Aroundhome Vielkäufer ab 100 Bewertungen (neu)“.
 *
 * Geändert werden nur Namen, die „technisch“ aussehen (Unterstriche, Dateiendung, nur Kleinbuchstaben mit Bindestrichen).
 * Namen, die schon mit Leerzeichen geschrieben sind, bleiben unangetastet – die hat jemand bewusst so vergeben.
 * Die Funktion ist idempotent: tidyListName(tidyListName(x)) === tidyListName(x).
 */

/** Kürzel am Anfang (Leadsparten) → ausgeschriebene Namen. Mehrere Kürzel hintereinander werden mit „&“ verbunden. */
const TOPICS: Record<string, string> = {
  pv: "Photovoltaik", wp: "Wärmepumpe", sp: "Stromspeicher", hn: "Hausnotruf", pb: "Pflegebox", tl: "Treppenlift", trl: "Treppenlift",
  er: "Elektrorollstuhl", ers: "Elektrorollstuhl", rl: "Rollator", bb: "Barrierefreies Bad", aa: "Alarmanlage", fe: "Fenster", wg: "Wintergarten", hg: "Hörgeräte", hoer: "Hörgeräte",
};

/** Wörter mit Umschreibung (ae/oe/ue/ss) → richtige Schreibweise. Nur bekannte Wörter – eine allgemeine Regel würde „Feuer“ zu „Feüer“ machen. */
const WORDS: Record<string, string> = {
  kaeufer: "Käufer", vielkaeufer: "Vielkäufer", verkaeufer: "Verkäufer", grossanbieter: "Großanbieter", gross: "groß", grosse: "große", grosser: "großer",
  ueber: "über", fuer: "für", buero: "Büro", bueros: "Büros", strasse: "Straße", groesse: "Größe", groesste: "größte", groessten: "größten", groesster: "größter", gruen: "grün", koeln: "Köln", muenchen: "München", nuernberg: "Nürnberg",
  duesseldorf: "Düsseldorf", wuerzburg: "Würzburg", saarbruecken: "Saarbrücken", baden_wuerttemberg: "Baden-Württemberg", thueringen: "Thüringen",
  waermepumpe: "Wärmepumpe", waermepumpen: "Wärmepumpen", fachbetriebe: "Fachbetriebe", haendler: "Händler", grosshaendler: "Großhändler", aenderung: "Änderung",
  mitarbeiter: "Mitarbeiter", bewertungen: "Bewertungen", bewertung: "Bewertung", bundesland: "Bundesland", bundeslaender: "Bundesländer", energieversorger: "Energieversorger",
  solarteure: "Solarteure", dachdecker: "Dachdecker", elektriker: "Elektriker", installateure: "Installateure", heizungsbauer: "Heizungsbauer", regional: "regional", bundesweit: "bundesweit",
  nrw: "NRW", kmu: "KMU", gmbh: "GmbH", ug: "UG", ag: "AG", kg: "KG", b2b: "B2B", b2c: "B2C", top: "Top",
  und: "und", ab: "ab", bis: "bis", mit: "mit", ohne: "ohne", oder: "oder", von: "von", im: "im", in: "in", aus: "aus",
};

/** Zustand am Ende („_neu“, „_aktiv“) → in Klammern. */
const STATUS = new Set(["neu", "aktiv", "alt", "test", "kopie", "inaktiv", "nachfassen", "rest", "teil1", "teil2", "teil3"]);
const STATUS_LABEL: Record<string, string> = { teil1: "Teil 1", teil2: "Teil 2", teil3: "Teil 3" };

const FILE_EXT = /\.(xlsx|xls|csv|txt|numbers|ods|json)$/i;

/** Sieht der Name technisch aus (Unterstriche, Dateiendung, nur Kleinbuchstaben mit Bindestrichen)? */
export function looksTechnical(name: string): boolean {
  const value = name.trim();
  if (!value) return false;
  if (FILE_EXT.test(value)) return true;
  if (value.includes("_")) return true;
  if (!/\s/.test(value) && /-/.test(value) && value === value.toLowerCase() && /[a-zäöü]{3}/.test(value)) return true;
  return false;
}

function word(raw: string): string {
  const lower = raw.toLowerCase();
  if (WORDS[lower]) return WORDS[lower];
  if (/^\d+$/.test(raw)) return raw;
  if (/^[A-ZÄÖÜ0-9]{2,}$/.test(raw) && raw.length <= 5) return raw; // Kürzel wie „GmbH“-artige Abkürzungen, „NRW“, „KMU“ bleiben groß
  if (raw === lower) return lower.charAt(0).toUpperCase() + lower.slice(1); // „aroundhome“ → „Aroundhome“
  return raw; // gemischte Schreibung (z. B. „Aroundhome“, „eBay“) bleibt
}

/** Lesbarer Listenname; lässt bewusst geschriebene Namen unverändert. */
export function tidyListName(name: string | null | undefined): string {
  const original = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!looksTechnical(original)) return original;
  const base = original.replace(FILE_EXT, "");
  const parts = base.split(/[_\s]+|(?<=[a-zäöü])-(?=[a-zäöü])/i).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return original;
  // Leadsparten-Kürzel am Anfang
  const topics: string[] = [];
  while (parts.length && TOPICS[parts[0].toLowerCase()]) { const topic = TOPICS[parts.shift()!.toLowerCase()]; if (!topics.includes(topic)) topics.push(topic); }
  // Zustand am Ende
  const status: string[] = [];
  while (parts.length && STATUS.has(parts[parts.length - 1].toLowerCase())) { const key = parts.pop()!.toLowerCase(); status.unshift(STATUS_LABEL[key] ?? key); }
  // zusammengesetzte Ländernamen („baden_wuerttemberg“)
  const words: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const pair = `${parts[index]}_${parts[index + 1] ?? ""}`.toLowerCase();
    if (WORDS[pair]) { words.push(WORDS[pair]); index += 1; continue; }
    words.push(word(parts[index]));
  }
  const head = topics.length ? topics.join(" & ") : "";
  let result = [head, words.join(" ")].filter(Boolean).join(" ");
  if (status.length) result = `${result} (${status.join(", ")})`;
  result = result.replace(/\s+/g, " ").trim();
  if (!result) return original;
  return result.charAt(0).toUpperCase() + result.slice(1);
}
