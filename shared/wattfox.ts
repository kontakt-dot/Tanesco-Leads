/**
 * Wattfox – Leads einliefern (Lead API „PV – Import“ und „HZ – Import“, Stand März 2024, Testzugang vom 24.11.2026).
 *
 *  - Photovoltaik = productId 2. Wärmepumpe ist bei Wattfox ein Unterprodukt der Heizung: productId 20 plus childinterests [6].
 *  - Ein Lead je Person: Will jemand PV und Wärmepumpe, geht EIN Lead raus – das zweite Produkt als Zusatzinteresse
 *    (otherinterests mit dessen productId; ist die Wärmepumpe dabei, immer auch childinterests [6]).
 *  - Pflicht laut Wattfox: Anrede (bei PV), Vor- und Nachname, Straße, PLZ, Ort, Telefon, E-Mail – dazu immer der Umsetzungszeitraum.
 *  - Herkunft (utm_…) steht in der Vorlage des Endpoints; utm_source und utm_medium dürfen nicht geändert werden.
 *    utm_campaign laut Wattfox (Mail vom 25.11.2026): „Hauskompass, Meta vorqualifiziert“ – zeigt den Callagents von Wattfox, unter welcher
 *    Marke der Kunde gewonnen wurde; nur nach Rücksprache mit Wattfox ändern (andere Marke = anderer Wert). Leer wird es gar nicht mitgeschickt.
 *  - Unsere Angaben werden in die Werte von Wattfox übersetzt. Was nicht genau passt (Dachalter, beheizte Fläche …),
 *    geht mit dem nächstliegenden Wert raus – der genaue Wert steht zusätzlich im Hinweisfeld (notes).
 *  - Rückmeldung der Qualitätskontrolle von Wattfox (27.11.2026, zu einer anderen Software) – bei uns ausgeschlossen (v390):
 *    · Telefonnummer immer international („+4917012345678“), nie „49…“ ohne Plus – sonst kann der Dialer von Wattfox nicht automatisch anrufen.
 *    · Alles, was wir wissen, geht mit: wo es ein Feld gibt, im Feld; alles Übrige als „Bezeichnung: Wert“ im Hinweisfeld (Freitext).
 *      Nie dabei: Aufnahme, Transkript, Name des Agenten, Bewertung, Einwilligung, Herkunft der Anzeige, Lieferant, Preise, interne Nummern.
 *    · Herkunft ohne Tippfehler: utm_source und utm_medium immer genau wie vereinbart; utm_campaign mit kleinem Tippfehler → vereinbarter Wert.
 *
 * Bewusst ohne Datenbank: Server, Vorschau und Tests nutzen dieselbe Logik.
 */
import { categoryProducts } from "./dialer-contact";
import { isTechnicalMeta, metaLabel } from "./lead-fields";
import { internationalPhone } from "./phone";
import { heatPumpCategoryFields, pvCategoryFields } from "../server/category-fields";

export const WATTFOX = {
  /** Testumgebung laut Mail von Wattfox (die Adressen in den PDFs gelten nicht) */
  loginUrl: "https://prelive.wattfox.net/v1/login",
  leadsUrl: "https://prelive.wattfox.net/v1/leads",
  tokenPath: "auth_token",
  tokenHeader: "X-AUTH-TOKEN",
  /**
   * Live-System laut Beschreibung von Wattfox (PDF „Lead API“, Stand März 2024). Wattfox hat am 25.11.2026 das Senden an die Live-API freigegeben,
   * die Adresse aber nicht eigens genannt – „Anmeldung prüfen“ zeigt, ob Adresse und Live-Zugang stimmen (ohne einen Lead zu senden).
   */
  liveLoginUrl: "https://api-v1.photovoltaik-angebotsvergleich.de/v1/login",
  liveLeadsUrl: "https://api-v1.photovoltaik-angebotsvergleich.de/v1/leads",
  /** Der Schlüssel gilt 24 Stunden – kurz vorher neu anmelden */
  tokenMinutes: 1380,
  products: { pv: 2, heating: 20 },
  heatPumpChild: 6,
  /** Herkunft laut Wattfox – utm_source und utm_medium nie ändern, utm_campaign nur nach Rücksprache (Marke, unter der der Kunde gewonnen wurde) */
  utm: { utm_source: "Tanesco Digital GbR", utm_medium: "affiliate", utm_campaign: "Hauskompass, Meta vorqualifiziert" },
} as const;

/** Inhalt des Feldes „Body“ für die Wattfox-Vorlage: Die Felder baut die Software selbst, hier stehen nur Herkunft und eigene Zusätze. */
export const WATTFOX_TEMPLATE = JSON.stringify({ vorlage: "wattfox", ...WATTFOX.utm }, null, 2);

/** Ist der Body eine Wattfox-Vorlage? Dann die zusätzlichen Angaben daraus (utm_… und alles, was der Mandant ergänzt hat) – leere Angaben gehen nicht mit. */
export function wattfoxTemplateOptions(template: string | null | undefined): Record<string, unknown> | null {
  if (!template || !template.includes("wattfox")) return null;
  try {
    const parsed: unknown = JSON.parse(template);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const { vorlage, ...rest } = parsed as Record<string, unknown>;
    if (String(vorlage ?? "").trim().toLowerCase() !== "wattfox") return null;
    return Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== null && value !== undefined && !(typeof value === "string" && !value.trim())));
  } catch { return null; }
}
export const isWattfoxTemplate = (template: string | null | undefined) => wattfoxTemplateOptions(template) !== null;

const squash = (value: string) => value.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "");
/** Abstand zweier Texte in Zeichen (Einfügen, Löschen, Tauschen) */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}
/** Liegt ein Wert nur um Groß-/Kleinschreibung, Satz- oder Leerzeichen oder bis zu zwei Tippfehler neben dem vereinbarten? */
const nearlyAgreed = (value: string, agreed: string) => editDistance(squash(value), squash(agreed)) <= 2;

/**
 * Herkunft, wie mit Wattfox vereinbart (v390) – gilt für jeden Lead, egal was im Body der Lieferadresse steht:
 *  - utm_source und utm_medium immer genau so (Wattfox: nie ändern),
 *  - utm_campaign wie im Body; liegt der Wert nur um Schreibweise oder einen kleinen Tippfehler neben dem vereinbarten
 *    („hauskompass meta vorqualifizert“), geht der vereinbarte raus. Ein wirklich anderer Wert (andere Marke nach Rücksprache) bleibt; leer geht er nicht mit.
 */
export function wattfoxOrigin(options: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...options, utm_source: WATTFOX.utm.utm_source, utm_medium: WATTFOX.utm.utm_medium };
  const campaign = typeof options.utm_campaign === "string" || typeof options.utm_campaign === "number" ? String(options.utm_campaign).replace(/\s+/g, " ").trim() : "";
  if (!campaign) delete out.utm_campaign;
  else out.utm_campaign = nearlyAgreed(campaign, WATTFOX.utm.utm_campaign) ? WATTFOX.utm.utm_campaign : campaign;
  return out;
}

/** Prüfung für den Endpoint-Editor: Was geht als Herkunft raus, und weicht etwas vom Vereinbarten ab? */
export function wattfoxOriginCheck(template: string | null | undefined): { ok: boolean; sent: Record<string, unknown>; problems: string[] } | null {
  const options = wattfoxTemplateOptions(template); if (!options) return null;
  const sent = wattfoxOrigin(options); const problems: string[] = [];
  for (const key of ["utm_source", "utm_medium"] as const) if (options[key] !== WATTFOX.utm[key]) problems.push(`„${key}“ steht im Body als „${String(options[key] ?? "")}“ – es geht trotzdem „${WATTFOX.utm[key]}“ raus (nie ändern).`);
  const campaign = typeof options.utm_campaign === "string" ? options.utm_campaign.trim() : "";
  if (!campaign) problems.push(`„utm_campaign“ fehlt – die Callagents von Wattfox sehen dann nicht, unter welcher Marke der Kunde gewonnen wurde. Vereinbart: „${WATTFOX.utm.utm_campaign}“.`);
  else if (campaign !== WATTFOX.utm.utm_campaign) problems.push(sent.utm_campaign === WATTFOX.utm.utm_campaign ? `„utm_campaign“ ist falsch geschrieben („${campaign}“) – es geht der vereinbarte Wert „${WATTFOX.utm.utm_campaign}“ raus.` : `„utm_campaign“ weicht vom vereinbarten Wert ab: „${campaign}“ statt „${WATTFOX.utm.utm_campaign}“ – nur nach Rücksprache mit Wattfox so lassen.`);
  return { ok: problems.length === 0, sent, problems };
}
/** Body mit der vereinbarten Herkunft – eigene Zusätze im Body bleiben */
export function wattfoxTemplateWithAgreedOrigin(template: string | null | undefined): string {
  const options = wattfoxTemplateOptions(template) ?? {};
  return JSON.stringify({ vorlage: "wattfox", ...options, ...WATTFOX.utm }, null, 2);
}
/** Sieht die Adresse nach einer Testumgebung aus? (Testleads nie aus Versehen ins Live-System) */
export const isTestAddress = (url: string | null | undefined) => /prelive|entwicklung|staging|sandbox|[./-](test|dev)[./-]/i.test(String(url ?? ""));

type Product = "pv" | "wp";
type Values = Record<string, unknown>;
export type WattfoxPayload = Record<string, unknown>;

const text = (value: unknown, max = 255): string => {
  const raw = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value : "";
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
};
const norm = (value: string) => value.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "");
const plain = (value: string) => value.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
const yes = (value: string | null) => Boolean(value && /^(ja|yes|true|1|x|j|y)\b/i.test(value.trim()));
const numberIn = (value: string): number | null => { const match = /(\d+(?:[.,]\d+)?)/.exec(value.replace(/(\d)\.(\d{3})\b/g, "$1$2")); return match ? Number(match[1].replace(",", ".")) : null; };

/** Angaben des Leads (custom_data.<schlüssel>) – auffindbar über verschiedene Schreibweisen der Schlüssel. Merkt sich, was schon verwendet wurde. */
function fieldsOf(values: Values) {
  const map = new Map<string, string>(); const keys = new Map<string, string>(); const used = new Set<string>();
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith("custom_data.")) continue;
    const content = Array.isArray(value) ? value.map((item) => (item && typeof item === "object" ? "" : text(item))).filter(Boolean).join(", ") : typeof value === "boolean" ? (value ? "Ja" : "Nein") : value && typeof value === "object" ? "" : text(value, 2000);
    const name = norm(key.slice("custom_data.".length));
    if (content && name && !map.has(name)) { map.set(name, content); keys.set(name, key.slice("custom_data.".length)); }
  }
  return {
    get: (...names: string[]) => { for (const name of names) { const found = map.get(norm(name)); if (found) { used.add(norm(name)); return found; } } return null; },
    /** alle Angaben, die noch nicht verwendet wurden – in der Reihenfolge des Leads */
    rest: () => Array.from(map.entries()).filter(([name]) => !used.has(name)).map(([name, value]) => ({ key: keys.get(name) ?? name, value })),
  };
}

/**
 * Was nie an Wattfox geht – auch nicht im Hinweisfeld: Aufnahme und Transkript, Agent und Bewertung, Einwilligung, Herkunft der Anzeige und Kampagne,
 * Lieferant, Preise, interne Nummern und Merker. Die Grunddaten (Name, Anschrift, Telefon, E-Mail) stehen schon in ihren Feldern.
 */
const NEVER_PARTS = /record|aufnahme|aufzeich|sprachaufz|sprachnachricht|voice|audio|mp3|wav|transkript|transcript|zusammenfassung|kurzfassung|telefonist|bewertung|verdict|consent|optin|einwillig|zustimm|dsgvo|datenschutz|lieferant|supplier|ghl|ondialer|dialer|kampagne|campaign|utm|adset|adname|formid|fbclid|gclid|clickid|pixel|token|secret|passw|password|marge|provision|duplicate|dublette|uuid|callid|leadid|externalid|metadata/;
/** ganze Wortteile – „Wärmequelle“, „Strompreis“ oder „Lebenspartner“ bleiben erlaubt, „Quelle“, „Preis“ oder „Partner“ allein nicht */
const NEVER_WORDS = new Set(["source", "quelle", "summary", "caller", "score", "punkte", "preis", "price", "kosten", "anzeige", "formular", "form", "ad", "ads", "fb", "meta", "google", "partner", "agent", "agenten", "agentname", "bearbeiter", "mitarbeiter", "einkauf", "verkauf", "ek", "vk", "status", "kategorie", "category", "type", "typ", "platform", "plattform", "channel", "kanal", "created", "time", "url", "link", "intern", "internal", "admin"]);
const MAIN_FIELDS = new Set(["anrede", "salutation", "titel", "vorname", "nachname", "firstname", "lastname", "name", "fullname", "email", "mail", "emailadresse", "telefon", "telefonnummer", "phone", "phonenumber", "mobil", "mobilnummer", "handy", "plz", "postleitzahl", "postalcode", "zip", "zipcode", "ort", "stadt", "city", "strasse", "street", "hausnummer", "housenumber", "land", "country", "countrycode", "firma", "company", "test", "id"]);
/** Bezeichnungen der Felder, wie sie in den Lead-Kategorien heißen („Wie viele Angebote“) – Felder von OnDialer kommen mit „pv_“/„wp_“ davor. */
const LABELS = new Map<string, string>([...pvCategoryFields, ...heatPumpCategoryFields].map((field) => [norm(field.fieldKey), field.label] as [string, string]).concat([["eauto", "E-Auto"], ["baujahr", "Baujahr"], ["dachneigung", "Dachneigung"], ["kaufodermiete", "Kauf oder Miete"]]));
export function wattfoxLabel(key: string): string {
  return LABELS.get(norm(key)) ?? LABELS.get(norm(key.replace(/^(pv|wp)[_-]/i, ""))) ?? metaLabel(key);
}

/** Darf diese Angabe als „Bezeichnung: Wert“ ins Hinweisfeld? */
export function wattfoxExtraAllowed(key: string, value: string): boolean {
  const name = norm(key); const words = key.replace(/([a-zäöüß])([A-ZÄÖÜ])/g, "$1 $2").split(/[^A-Za-z0-9ÄÖÜäöüß]+/).map(norm).filter(Boolean);
  if (!name || MAIN_FIELDS.has(name) || isTechnicalMeta(key) || NEVER_PARTS.test(name) || words.some((word) => NEVER_WORDS.has(word))) return false;
  if (/(^|[_\s.-])id$/i.test(key) || /(At|_at)$/.test(key)) return false; // Nummern und Zeitstempel der Software
  if (/https?:\/\/|www\./i.test(value) || value.length > 500) return false; // Links (z. B. zu einer Aufnahme) und lange Texte (Transkript)
  return true;
}

/** Hauptprodukt aus der Kategorie, Zusatzinteresse aus Kategorie (PV+WP) oder den Feldern „Wärmepumpe“ / „Interesse Photovoltaikanlage“ / „Kombi Lead“. */
export function wattfoxProducts(values: Values): { main: Product; extra: Product | null } {
  const fields = fieldsOf(values);
  const category = categoryProducts(`${text(values.lead_type)} ${text(values.lead_type_shortcode)}`);
  const main: Product = category.wp && !category.pv ? "wp" : "pv";
  if (category.pv && category.wp) return { main: "pv", extra: "wp" };
  // Interesse an beidem – egal, in welchem Fragebogen es steht: „Kombi Lead“, „Wärmepumpe: Ja“ (PV-Fragen) oder „Interesse Photovoltaikanlage: Ja“ (WP-Fragen).
  // Ein PV-Lead mit ausgefüllten WP-Fragen und „Interesse Photovoltaikanlage: Ja“ will also auch die Wärmepumpe → ein Lead mit Zusatzinteresse.
  const both = yes(fields.get("kombi_lead", "wp_kombi_lead", "pv_kombi_lead"))
    || yes(fields.get("waermepumpe", "pv_waermepumpe", "interesse_waermepumpe"))
    || yes(fields.get("interesse_photovoltaikanlage", "wp_interesse_photovoltaikanlage", "wp_interesse_photovolatikanalge", "interesse_photovolatikanalge", "interesse_photovoltaik"));
  return { main, extra: both ? (main === "pv" ? "wp" : "pv") : null };
}

type Mapped = { value: string; exact: boolean };

/** Umsetzungszeitraum → bis in 1 Monat | 1 bis 3 Monate | 3 bis 6 Monate | mehr als 6 Monate | weiß nicht | zunächst nur Informationen */
export function wattfoxImplementation(raw: string | null): Mapped {
  if (!raw) return { value: "weiß nicht", exact: false };
  const value = plain(raw);
  if (/so schnell|sofort|asap|umgehend|zeitnah|bis in 1 monat|unter (einem|1) monat|innerhalb (eines|1) monat|naechsten wochen/.test(value)) return { value: "bis in 1 Monat", exact: true };
  if (/(^|\D)1\s*(-|–|bis)\s*3(\D|$)|ein bis drei/.test(value)) return { value: "1 bis 3 Monate", exact: true };
  if (/(^|\D)[34]\s*(-|–|bis)\s*6(\D|$)|drei bis sechs|vier bis sechs/.test(value)) return { value: "3 bis 6 Monate", exact: true };
  if (/mehr als 6|ueber 6|spaeter|7\s*(-|–|bis)\s*12|12 monat|jahr/.test(value)) return { value: "mehr als 6 Monate", exact: true };
  if (/information/.test(value)) return { value: "zunächst nur Informationen", exact: true };
  if (/weiss nicht|unklar|unsicher|offen/.test(value)) return { value: "weiß nicht", exact: true };
  return { value: "weiß nicht", exact: false };
}

/** Gebäudeart: PV schreibt „Ein-/Zweifamilienhaus“, Heizung „Ein- / Zweifamilienhaus“. */
export function wattfoxBuilding(raw: string | null, product: Product): Mapped | null {
  if (!raw) return null;
  const value = plain(raw); const family = product === "pv" ? "Ein-/Zweifamilienhaus" : "Ein- / Zweifamilienhaus";
  if (/ein.?\/?.?zweifamilien|einfamilien|zweifamilien|doppelhaus|doppel.?reihen|reihenhaus|bungalow|freistehend|efh/.test(value)) return { value: family, exact: !/doppel|reihen|bungalow|freistehend/.test(value) };
  if (/mehrfamilien|mfh/.test(value)) return { value: "Mehrfamilienhaus", exact: true };
  if (/eigentumswohnung|wohnung/.test(value)) return { value: "Mehrfamilienhaus", exact: false };
  if (/firm|gewerb|halle|betrieb|buero|landwirt/.test(value)) return { value: "Firmengebäude", exact: /firm/.test(value) };
  return { value: "Sonstiges", exact: /sonstig/.test(value) };
}

/** Dachausrichtung → Süd | Süd-West | Süd-Ost | West | Ost | weiß nicht */
export function wattfoxOrientation(raw: string | null): Mapped | null {
  if (!raw) return null;
  const value = plain(raw).trim(); const token = value.replace(/[^a-z]/g, "");
  const south = /sued|sud|^s$/.test(value) || ["s", "sw", "so", "se"].includes(token);
  const west = /west/.test(value) || ["w", "sw"].includes(token); const east = /ost|east/.test(value) || ["o", "so", "se"].includes(token);
  if (/nord/.test(value)) return { value: "weiß nicht", exact: false };
  if (south && west) return { value: "Süd-West", exact: true };
  if (south && east) return { value: "Süd-Ost", exact: true };
  if (south) return { value: "Süd", exact: true };
  if (west && east) return { value: "weiß nicht", exact: false };
  if (west) return { value: "West", exact: true };
  if (east) return { value: "Ost", exact: true };
  if (/weiss nicht|unklar/.test(value)) return { value: "weiß nicht", exact: true };
  return { value: "weiß nicht", exact: false };
}

/** Dachalter → bis 25 Jahre alt | 25 bis 75 Jahre alt | älter als 75 Jahre | … – unsere Stufen (unter 30, 30–70, über 70) gehen auf die nächste. */
export function wattfoxRoofAge(raw: string | null, olderThan30: string | null): Mapped | null {
  if (raw) {
    const value = plain(raw);
    if (/planung/.test(value)) return { value: "in Planung", exact: true };
    if (/bau|sanier/.test(value) && !/\d/.test(value)) return { value: "in Bau / Sanierung", exact: true };
    if (/keine flaeche|kein dach/.test(value)) return { value: "noch keine Fläche", exact: true };
    if (/weiss nicht|unklar/.test(value)) return { value: "weiß nicht", exact: true };
    const range = /(\d+)\s*(-|–|bis)\s*(\d+)/.exec(value);
    if (range) { const from = Number(range[1]); const to = Number(range[3]); return { value: to <= 25 ? "bis 25 Jahre alt" : from >= 75 ? "älter als 75 Jahre" : "25 bis 75 Jahre alt", exact: to <= 25 || (from >= 25 && to <= 75) || from >= 75 }; }
    const years = numberIn(value);
    if (years !== null) {
      if (/unter|bis|weniger|juenger|max/.test(value)) return { value: "bis 25 Jahre alt", exact: years <= 25 };
      if (/ueber|mehr als|aelter/.test(value)) return { value: years >= 70 ? "älter als 75 Jahre" : "25 bis 75 Jahre alt", exact: years >= 75 };
      return { value: years <= 25 ? "bis 25 Jahre alt" : years <= 75 ? "25 bis 75 Jahre alt" : "älter als 75 Jahre", exact: true };
    }
    return { value: "weiß nicht", exact: false };
  }
  if (olderThan30) return yes(olderThan30) ? { value: "25 bis 75 Jahre alt", exact: false } : /^nein/i.test(olderThan30.trim()) ? { value: "bis 25 Jahre alt", exact: false } : null;
  return null;
}

/** Ja | Nein | Weiß nicht / Beratung erwünscht */
export function wattfoxStorage(raw: string | null): Mapped | null {
  if (!raw) return null;
  if (yes(raw)) return { value: "Ja", exact: true };
  if (/^nein|^no\b/i.test(raw.trim())) return { value: "Nein", exact: true };
  return { value: "Weiß nicht / Beratung erwünscht", exact: /weiss nicht|weiß nicht|beratung|vielleicht/i.test(raw) };
}

const HEATING: Array<[RegExp, string]> = [
  [/fluessiggas|erdgas|gas/, "Gasheizung"], [/heizoel|oel/, "Ölheizung"], [/waermepumpe/, "Wärmepumpe"], [/pellet|holz/, "Pellet-/Holzheizung"],
  [/brennstoffzelle/, "Brennstoffzelle"], [/bhkw|blockheiz/, "Blockheizkraftwerk (BHKW)"], [/solarthermie/, "Solarthermie"], [/nachtspeicher/, "Nachtspeicher"],
  [/infrarot|elektro|strom/, "Elektro-/Infrarotheizung"], [/kamin/, "Kaminofen"], [/fernwaerme|sonstig|andere/, "Sonstige Heizsysteme"],
];
/** Bisherige Heizung (mehrere möglich) → Liste mit den Werten von Wattfox. Erstinstallation/Neubau → keine. */
export function wattfoxHeating(raw: string | null): { values: string[]; exact: boolean; firstInstall: boolean } {
  if (!raw) return { values: [], exact: true, firstInstall: false };
  const parts = plain(raw).split(/,|;|&|\+| und /).map((part) => part.trim()).filter(Boolean);
  const out: string[] = []; let exact = true; let firstInstall = false;
  for (const part of parts) {
    if (/erstinstallation|neubau|keine/.test(part)) { firstInstall = true; continue; }
    const hit = HEATING.find(([pattern]) => pattern.test(part));
    if (hit) { if (!out.includes(hit[1])) out.push(hit[1]); if (/fluessiggas|fernwaerme/.test(part)) exact = false; } else { exact = false; if (!out.includes("Sonstige Heizsysteme")) out.push("Sonstige Heizsysteme"); }
  }
  return { values: out, exact, firstInstall };
}

/** Beheizte Fläche als ganze Zahl (qm). Unsere Stufen („141-180 qm“) gehen mit der Mitte raus. */
export function wattfoxArea(raw: string | null): { value: number; exact: boolean } | null {
  if (!raw) return null;
  const value = plain(raw).replace(/(\d)\.(\d{3})\b/g, "$1$2");
  const range = /(\d+)\s*(-|–|bis)\s*(\d+)/.exec(value);
  if (range) return { value: Math.round((Number(range[1]) + Number(range[3])) / 2), exact: false };
  const single = numberIn(value); if (single === null) return null;
  return { value: Math.round(single), exact: !/bis|unter|mehr|ueber|ab/.test(value) };
}

/** Personen im Haushalt → 1-2 Personen | 3-4 Personen | 5-6 Personen | 7-8 Personen | Mehr als 8 Personen */
export function wattfoxPersons(raw: string | null): string | null {
  const count = raw ? numberIn(raw) : null; if (count === null || count < 1) return null;
  return count <= 2 ? "1-2 Personen" : count <= 4 ? "3-4 Personen" : count <= 6 ? "5-6 Personen" : count <= 8 ? "7-8 Personen" : "Mehr als 8 Personen";
}

/** Art der Wärmepumpe → Sole-/Erd-Wärmepumpe | Grundwasser-Wärmepumpe | Luft-Wärmepumpe | Beratung erwünscht */
export function wattfoxPumpType(raw: string | null): Mapped | null {
  if (!raw) return null;
  const value = plain(raw);
  if (/beide|beratung|weiss nicht|offen|egal/.test(value)) return { value: "Beratung erwünscht", exact: true };
  if (/grundwasser|wasser.?wasser/.test(value)) return { value: "Grundwasser-Wärmepumpe", exact: true };
  if (/sole|erd/.test(value)) return { value: "Sole-/Erd-Wärmepumpe", exact: true };
  if (/luft/.test(value)) return { value: "Luft-Wärmepumpe", exact: true };
  return { value: "Beratung erwünscht", exact: false };
}

/** Wärmeverteilung → Liste aus Heizkörper | Fußbodenheizung | bitte beraten */
export function wattfoxDistribution(raw: string | null): { values: string[]; exact: boolean } | null {
  if (!raw) return null;
  const value = plain(raw); const out: string[] = [];
  if (/heizkoerper|radiator/.test(value)) out.push("Heizkörper");
  if (/fussboden|fbh/.test(value)) out.push("Fußbodenheizung");
  return out.length ? { values: out, exact: true } : { values: ["bitte beraten"], exact: false };
}

/** Dachneigung → 0° bis 15° | 16° bis 30° | 31° bis 45° | 46° bis 60° | weiß nicht. Ohne Angabe, aber „Flachdach“ als Dachart → 0° bis 15°. */
export function wattfoxPitch(raw: string | null, roofType: string | null): Mapped | null {
  if (raw) {
    const value = plain(raw);
    if (/flach/.test(value)) return { value: "0° bis 15°", exact: true };
    if (/weiss nicht|unklar|unsicher/.test(value)) return { value: "weiß nicht", exact: true };
    const range = /(\d+)\s*(?:°|grad)?\s*(?:-|–|bis)\s*(\d+)/.exec(value); const degrees = range ? (Number(range[1]) + Number(range[2])) / 2 : numberIn(value);
    if (degrees === null || degrees > 60) return { value: "weiß nicht", exact: false };
    return { value: degrees <= 15 ? "0° bis 15°" : degrees <= 30 ? "16° bis 30°" : degrees <= 45 ? "31° bis 45°" : "46° bis 60°", exact: !range };
  }
  return roofType && /flachdach/.test(plain(roofType)) ? { value: "0° bis 15°", exact: true } : null;
}

/** „Haben Sie eine südlich ausgerichtete Dachfläche?“ → Ja | Nein | Teilweise | Bin nicht sicher – aus der Dachausrichtung. */
export function wattfoxSouth(raw: string | null): string | null {
  if (!raw) return null;
  const value = plain(raw).trim(); const token = value.replace(/[^a-z]/g, "");
  if (/weiss nicht|unklar|unsicher/.test(value)) return "Bin nicht sicher";
  if (/teilweise|teils/.test(value)) return "Teilweise";
  if (/sued|sud/.test(value) || ["s", "sw", "so", "se"].includes(token)) return "Ja";
  if (/nord|west|ost|east/.test(value) || ["n", "w", "o", "nw", "no", "ow", "wo"].includes(token)) return "Nein";
  return "Bin nicht sicher";
}

/** Gasanschluss → „Ja, im Haus“ | „Ja, in Straße“ | Nein | Weiß nicht. Ohne Angabe: heizt der Kunde mit Erdgas, liegt Gas im Haus. */
export function wattfoxGas(raw: string | null, heatingRaw: string | null): string | null {
  if (raw) {
    const value = plain(raw);
    if (/strasse|strase/.test(value)) return "Ja, in Straße";
    if (/^nein|^no\b|kein/.test(value.trim())) return "Nein";
    if (/haus|^ja|vorhanden/.test(value.trim())) return "Ja, im Haus";
    return "Weiß nicht";
  }
  return heatingRaw && /erdgas/.test(plain(heatingRaw)) ? "Ja, im Haus" : null;
}

/** Alter der Heizung in Jahren – auch aus einem Baujahr („2005“). */
export function wattfoxHeatingAge(raw: string | null, now = new Date()): number | null {
  const number = raw ? numberIn(raw) : null; if (number === null) return null;
  const years = number > 1900 && number <= now.getFullYear() ? now.getFullYear() - number : number;
  return years >= 0 && years <= 100 ? Math.round(years) : null;
}

/** Kauf oder Miete: PV → Miete | Kauf | „Miete / Kauf“ | „Weiß nicht / Beratung erwünscht“, Heizung → Kauf | „Kauf / Contracting“ | Contracting. */
export function wattfoxAcquisition(raw: string | null, product: Product): string | null {
  if (!raw) return null;
  const value = plain(raw); const buy = /kauf/.test(value); const rent = /miet|pacht|leasing/.test(value); const contracting = /contracting/.test(value);
  if (product === "pv") return buy && rent ? "Miete / Kauf" : rent ? "Miete" : buy ? "Kauf" : "Weiß nicht / Beratung erwünscht";
  return buy && contracting ? "Kauf / Contracting" : contracting ? "Contracting" : buy ? "Kauf" : null;
}

/** Handynummer (international)? Deutschland 015x/016x/017x, Österreich 065x–069x, Schweiz 075–079 */
export const isMobilePhone = (number: string) => /^\+49(15|16|17)\d/.test(number) || /^\+436[5-9]\d/.test(number) || /^\+417[5-9]\d/.test(number);

function salutationOf(raw: unknown): "Herr" | "Frau" | null {
  const value = plain(text(raw)).replace(/\.$/, "");
  if (/^(herrn?|hr|mr|maennlich|m|bay)$/.test(value)) return "Herr";
  if (/^(frau|fr|mrs|ms|weiblich|w|bayan)$/.test(value)) return "Frau";
  return null;
}

/**
 * Stromverbrauch als ganze Zahl (kWh im Jahr) – Wattfox prüft auf Ziffern („4034: stromverbrauch: … is not a valid digit“), obwohl die
 * Beschreibung „String“ sagt. Unsere Stufen („4.000 - 6.000 kWh“) gehen mit der Mitte raus, „Über 6.000 kWh“ mit 6000; der genaue Wert steht im Hinweisfeld.
 */
export function wattfoxConsumption(raw: string | null): { value: number; exact: boolean } | null {
  if (!raw) return null;
  const value = plain(raw).replace(/(\d)\.(\d{3})\b/g, "$1$2");
  const range = /(\d+(?:,\d+)?)\s*(-|–|bis)\s*(\d+(?:,\d+)?)/.exec(value);
  const number = (text: string) => Number(text.replace(",", "."));
  if (range) { const result = Math.round((number(range[1]) + number(range[3])) / 2); return result > 0 ? { value: result, exact: false } : null; }
  const single = numberIn(value); if (single === null || single <= 0) return null;
  return { value: Math.round(single), exact: /^\s*\d+(?:[.,]\d+)?\s*(kwh)?(\s*(im|pro|\/)\s*jahr)?\s*$/.test(value) };
}

/** Nur eine Zahl („120“)? Dann mit Einheit – für das Hinweisfeld. */
function withUnit(raw: string | null, unit: string): string | null {
  if (!raw) return null;
  return /^\s*\d+(?:[.,]\d+)?\s*$/.test(raw) ? `${raw.trim()} ${unit}` : raw;
}

/** Leere Angaben fallen weg (Wattfox prüft vorgegebene Werte – ein leerer Text wäre ein falscher Wert). */
function compact(payload: WattfoxPayload): WattfoxPayload {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => !(value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length))));
}

/**
 * Der Lead im Format von Wattfox. `values`: Werte wie für die Vorlagen der Lieferadressen (leadTemplateValues) –
 * Name, Anschrift, Kategorie (lead_type) und die Angaben des Leads unter custom_data.<schlüssel>.
 */
export function wattfoxPayload(values: Values): { payload: WattfoxPayload; products: { main: Product; extra: Product | null }; missing: string[] } {
  const fields = fieldsOf(values); const products = wattfoxProducts(values);
  const withPv = products.main === "pv" || products.extra === "pv"; const withWp = products.main === "wp" || products.extra === "wp";
  const notes: string[] = []; const note = (label: string, value: string | null | undefined) => { if (value) notes.push(`${label}: ${value}`); };
  const exactOr = (label: string, raw: string | null, mapped: { exact: boolean } | null) => { if (raw && mapped && !mapped.exact) note(`${label} laut Gespräch`, raw); };

  const implementationRaw = products.main === "pv" ? fields.get("umsetzung", "pv_umsetzung", "umsetzungszeitraum", "installationszeitraum", "wp_installationszeitraum") : fields.get("installationszeitraum", "wp_installationszeitraum", "umsetzung", "pv_umsetzung", "umsetzungszeitraum");
  const implementation = wattfoxImplementation(implementationRaw);
  exactOr("Umsetzung", implementationRaw, implementation);

  const phone = wattfoxPhone(values, fields);
  const payload: WattfoxPayload = {
    productId: products.main === "pv" ? WATTFOX.products.pv : WATTFOX.products.heating,
    childinterests: withWp ? [WATTFOX.heatPumpChild] : undefined,
    otherinterests: products.extra ? [products.extra === "pv" ? WATTFOX.products.pv : WATTFOX.products.heating] : undefined,
    salutation: salutationOf(values.salutation) ?? undefined,
    firstname: text(values.first_name),
    lastname: text(values.last_name),
    company: fields.get("company", "firma") ?? undefined,
    street: text(values.street),
    zip: text(values.postal_code).replace(/\s+/g, "").slice(0, 5),
    city: text(values.city),
    country: (text(values.country_code) || "DE").slice(0, 2).toUpperCase(),
    phone, // immer international – nie „49…“ ohne Plus (Rückmeldung der Qualitätskontrolle von Wattfox)
    mobile: isMobilePhone(phone) ? phone : undefined, // Handynummer auch im eigenen Feld „mobile“ (Wattfox: „am besten direkt in die Felder“)
    email: text(values.email).toLowerCase(),
    implementation: implementation.value,
  };

  if (withPv) {
    const buildingRaw = fields.get("hausart", "pv_hausart", "pv_gebaeudetyp", "gebaeudetyp", "wp_gebaeudetyp"); const building = wattfoxBuilding(buildingRaw, "pv");
    const orientationRaw = fields.get("dachausrichtung", "pv_dachausrichtung", "ausrichtung"); const orientation = wattfoxOrientation(orientationRaw);
    const ageRaw = fields.get("dachalter", "pv_dachalter"); const older = fields.get("dach_aelter_als_30_jahre", "pv_dach_aelter_als_30_jahre"); const age = wattfoxRoofAge(ageRaw, older);
    const storageRaw = fields.get("stromspeicher", "pv_stromspeicher"); const storage = wattfoxStorage(storageRaw);
    const consumptionRaw = fields.get("stromverbrauch", "pv_stromverbrauch"); const consumption = wattfoxConsumption(consumptionRaw);
    const pitchRaw = fields.get("dachneigung", "pv_dachneigung", "neigung_dach"); const pitch = wattfoxPitch(pitchRaw, fields.get("dachart", "pv_dachart"));
    const powerRaw = fields.get("anlagenleistung", "pv_anlagenleistung", "kwp", "leistung_kwp"); const power = powerRaw ? numberIn(powerRaw) : null;
    const acquisitionRaw = fields.get("erwerb", "pv_erwerb", "kauf_oder_miete", "miete_oder_kauf", "art_des_erwerbs");
    Object.assign(payload, {
      ph_neigungderflaeche: pitch?.value,
      ph_ausrichtungsued: wattfoxSouth(orientationRaw) ?? undefined,
      ph_anlagenleistung: power !== null && power > 0 && power < 1000 ? Math.round(power * 10) / 10 : undefined,
      ph_erwerb: wattfoxAcquisition(acquisitionRaw, "pv") ?? undefined,
      ph_artdesgebaeude: building?.value,
      ph_ausrichtungderflaeche: orientation?.value,
      ph_alterderflaeche: age?.value,
      ph_dachflaeche: fields.get("dachflaeche", "pv_dachflaeche", "dachflaeche_m2", "sonnige_flaeche") ?? undefined,
      ph_stromspeicher: storage?.value,
      stromverbrauch: consumption?.value, // nur als Zahl (kWh im Jahr) – Stromkosten im Monat stehen im Hinweisfeld, als Zahl hielte Wattfox sie für kWh
    });
    exactOr("Gebäude", buildingRaw, building); exactOr("Dachausrichtung", orientationRaw, orientation); exactOr("Dachalter", ageRaw ?? (older ? `älter als 30 Jahre: ${older}` : null), age); exactOr("Stromspeicher", storageRaw, storage); exactOr("Dachneigung", pitchRaw, pitch);
    if (acquisitionRaw && !/kauf|miet|pacht|leasing/i.test(plain(acquisitionRaw))) note("Kauf oder Miete laut Gespräch", acquisitionRaw);
    if (consumptionRaw && !consumption) note("Stromverbrauch laut Gespräch", consumptionRaw); else exactOr("Stromverbrauch", consumptionRaw, consumption);
    note("Monatliche Stromkosten", withUnit(fields.get("monatliche_stromkosten", "pv_monatliche_stromkosten"), "€ im Monat"));
    note("Dachart", fields.get("dachart", "pv_dachart")); note("Dachmaterial", fields.get("dachmaterial", "pv_dachmaterial")); note("Bestandsanlage", fields.get("bestandsanlage", "pv_bestandsanlage"));
    note("Wallbox", fields.get("wallbox", "pv_wallbox")); note("Finanzierung gewünscht", fields.get("finanzierung", "pv_finanzierung"));
  }

  if (withWp) {
    const buildingRaw = fields.get("gebaeudetyp", "wp_gebaeudetyp", "hausart", "pv_hausart", "pv_gebaeudetyp"); const building = wattfoxBuilding(buildingRaw, "wp");
    const heatingRaw = fields.get("aktuelles_heizsystem", "wp_aktuelles_heizsystem", "bisherige_heizung"); const heating = wattfoxHeating(heatingRaw);
    const newBuild = yes(fields.get("ist_neubau", "wp_ist_neubau")) || heating.firstInstall;
    const areaRaw = fields.get("beheizte_flaeche", "wp_beheizte_flaeche", "wohnflaeche"); const area = wattfoxArea(areaRaw);
    const pumpRaw = fields.get("bevorzugte_waermepumpe", "wp_bevorzugte_waermepumpe"); const pump = wattfoxPumpType(pumpRaw);
    const distributionRaw = fields.get("aktuelle_waermeverteilung", "wp_aktuelle_waermeverteilung"); const distribution = wattfoxDistribution(distributionRaw);
    const yearRaw = fields.get("baujahr", "pv_baujahr", "wp_baujahr", "baujahr_gebaeude"); const year = yearRaw ? numberIn(yearRaw) : null;
    const gasRaw = fields.get("gasanschluss", "wp_gasanschluss", "gas_anschluss");
    const heatingAgeRaw = fields.get("alter_heizung", "heizungsalter", "alter_der_heizung", "alter_heizsystem", "baujahr_heizung", "wp_alter_heizung");
    const hzAcquisitionRaw = fields.get("erwerb", "wp_erwerb", "art_des_erwerbs", "kauf_oder_contracting");
    Object.assign(payload, {
      hz_gasanschluss: wattfoxGas(gasRaw, heatingRaw) ?? undefined,
      hz_alterderheizung: wattfoxHeatingAge(heatingAgeRaw) ?? undefined,
      hz_artdeserwerbs: wattfoxAcquisition(hzAcquisitionRaw, "wp") ?? undefined,
      wp_nutzung: heatingRaw || areaRaw || pumpRaw ? ["zum Heizen"] : undefined, // wer eine Wärmepumpe für sein Haus anfragt, will damit heizen
      hz_gebaeudetyp: building?.value,
      hz_bisherigeheizung: heating.values.length ? heating.values : undefined,
      hz_taetigkeit: newBuild ? "Neuinstallation" : heatingRaw ? "Austausch / Modernisierung" : undefined,
      hz_groessederflaeche: area?.value,
      hz_personen: wattfoxPersons(fields.get("personen_im_haushalt", "pv_personen_im_haushalt", "personen")) ?? undefined,
      hz_baujahrgebaeude: year && year >= 1800 && year <= 2100 ? Math.round(year) : undefined,
      wp_artderpumpe: pump?.value,
      wp_waermeabgabesystem: distribution?.values,
    });
    exactOr("Gebäude", buildingRaw, building); if (heatingRaw && !heating.exact) note("Heizung laut Gespräch", heatingRaw);
    exactOr("Beheizte Fläche", areaRaw, area); exactOr("Wärmepumpe", pumpRaw, pump); exactOr("Wärmeverteilung", distributionRaw, distribution);
    note("Geplantes Heizsystem", fields.get("geplantes_heizsystem", "wp_geplantes_heizsystem")); note("Warmwasser", fields.get("warmwasser_system", "wp_warmwasser_system"));
    note("Termin erwünscht", fields.get("termin_erwuenscht", "wp_termin_erwuenscht"));
  }

  note("Eigentümer/Entscheider", fields.get("entscheider", "pv_entscheider", "ist_eigentuemer", "wp_ist_eigentuemer"));
  note("Hauptmotivation", fields.get("hauptmotivation", "pv_hauptmotivation", "wp_hauptmotivation"));
  note("Erreichbarkeit", fields.get("erreichbarkeit", "pv_erreichbarkeit", "wp_erreichbarkeit"));
  note("Hinweis", fields.get("kommentare", "wp_kommentare", "info", "pv_info", "wp_info"));
  note("Notiz des Agenten", fields.get("dialerNote"));
  // weitere Rufnummern des Kunden (z. B. Festnetz neben dem Handy) – ebenfalls international
  const mainPhone = String(payload.phone ?? ""); const otherPhones: string[] = [];
  for (const name of ["telefon", "telefonnummer", "telefon_2", "telefon2", "mobil", "mobilnummer", "handy", "handynummer", "festnetz", "festnetznummer", "zweitnummer", "weitere_rufnummer"]) { const raw = fields.get(name); const number = raw ? internationalPhone(raw, String(payload.country ?? "DE")) : null; if (number && number !== mainPhone && !otherPhones.includes(number)) otherPhones.push(number); }
  if (!payload.mobile) { const mobile = otherPhones.find(isMobilePhone); if (mobile) { payload.mobile = mobile; otherPhones.splice(otherPhones.indexOf(mobile), 1); } } // zweite Nummer ist ein Handy → ins Feld „mobile“
  note(otherPhones.length > 1 ? "Weitere Rufnummern" : "Weitere Rufnummer", otherPhones.join(", "));
  // Alles Übrige, was wir über den Kunden wissen, als „Bezeichnung: Wert“ (Wattfox: „Schickt gerne alle Infos mit“) – ohne Aufnahme, Agent, Herkunft der Anzeige …
  fields.get("kombi_lead", "wp_kombi_lead", "pv_kombi_lead"); fields.get("waermepumpe", "pv_waermepumpe", "interesse_waermepumpe"); // stecken im Zusatzinteresse
  fields.get("interesse_photovoltaikanlage", "wp_interesse_photovoltaikanlage", "wp_interesse_photovolatikanalge", "interesse_photovolatikanalge", "interesse_photovoltaik");
  for (const item of fields.rest()) if (wattfoxExtraAllowed(item.key, item.value)) note(wattfoxLabel(item.key), item.value);
  if (values.test === true || fields.get("test") === "true") notes.unshift("TESTLEAD – bitte nicht bearbeiten");
  payload.notes = notes.join("\n").slice(0, 2000) || undefined;

  const clean = compact(payload);
  return { payload: clean, products, missing: wattfoxMissing(clean, products.main) };
}

/** Telefon an Wattfox: international („+4917012345678“), egal ob als „49…“, „0049…“, „0…“ oder „+49 (0)…“ gespeichert; fehlt sie am Lead, die aus den Angaben. */
function wattfoxPhone(values: Values, fields: ReturnType<typeof fieldsOf>): string {
  const raw = text(values.phone) || fields.get("telefon", "telefonnummer", "mobil", "mobilnummer", "handy", "phone_number") || "";
  return raw ? internationalPhone(raw, text(values.country_code) || "DE") ?? raw : "";
}

/** Was Wattfox laut Beschreibung zwingend braucht – fehlt etwas, geht der Lead gar nicht erst raus (sonst lehnt Wattfox ihn ab). */
export function wattfoxMissing(payload: WattfoxPayload, main: Product): string[] {
  const required: Array<[string, string]> = [["firstname", "Vorname"], ["lastname", "Nachname"], ["street", "Straße"], ["zip", "PLZ"], ["city", "Ort"], ["phone", "Telefon"], ["email", "E-Mail"]];
  if (main === "pv") required.unshift(["salutation", "Anrede (Herr/Frau)"]);
  return required.filter(([key]) => !payload[key]).map(([, label]) => label).concat(/^\d{5}$/.test(String(payload.zip ?? "")) || !payload.zip ? [] : ["PLZ mit 5 Ziffern"]);
}

/** Antwort von Wattfox: der eingelieferte Lead mit „wf_leadid“. */
export function wattfoxLeadId(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body); const item = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!item || typeof item !== "object") return null; const record = item as Record<string, unknown>;
    const id = record.wf_leadid ?? (record.data as Record<string, unknown> | undefined)?.wf_leadid ?? (record.lead as Record<string, unknown> | undefined)?.wf_leadid;
    return typeof id === "string" || typeof id === "number" ? String(id).slice(0, 160) : null;
  } catch { return null; }
}

/**
 * Testleads für Wattfox: einer je Sparte – Photovoltaik, Wärmepumpe und einer mit beidem (das Zusatzinteresse geht bei Wattfox
 * anders hinüber). Mit `all` die 9 aus der früheren Mail von Wattfox: je 3 für PV und Wärmepumpe, dazu 3 mit Zusatzinteresse.
 * Erfundene Personen; Rufnummern, die es nicht gibt (Teilnehmernummer mit 0), E-Mails unter example.com.
 */
export function wattfoxTestLeads(options: { all?: boolean } = {}): Array<{ label: string; values: Values }> {
  const all = wattfoxTestLeadSet();
  if (options.all) return all;
  return [{ ...all[0], label: "Photovoltaik" }, { ...all[3], label: "Wärmepumpe" }, { ...all[6], label: "PV mit Wärmepumpe" }];
}
function wattfoxTestLeadSet(): Array<{ label: string; values: Values }> {
  const base = (index: number, person: [string, string, string], place: [string, string, string]) => ({ lead_id: `TEST-WF-${index}`, lead_number: 0, salutation: person[0], first_name: person[1], last_name: person[2], email: `${plain(person[1])}.${plain(person[2]).replace(/[^a-z]/g, "")}@example.com`, phone: `+49 761 000000${index}`, street: place[0], postal_code: place[1], city: place[2], country_code: "DE", test: true });
  const pv = (extra: Values = {}) => ({ lead_type: "Photovoltaik", lead_type_shortcode: "PV", ...extra });
  const wp = (extra: Values = {}) => ({ lead_type: "Wärmepumpe", lead_type_shortcode: "WP", ...extra });
  const c = (data: Record<string, string>) => Object.fromEntries(Object.entries(data).map(([key, value]) => [`custom_data.${key}`, value]));
  return [
    { label: "PV 1", values: { ...base(1, ["Herr", "Max", "Testmann"], ["Teststraße 1", "79110", "Freiburg"]), ...pv(c({ umsetzung: "1-3 Monate", hausart: "Ein-/Zweifamilienhaus", dachausrichtung: "Süd", dachalter: "Unter 30 Jahre", dachflaeche: "60", stromspeicher: "Ja", stromverbrauch: "4.000 - 6.000 kWh", erreichbarkeit: "nachmittags" })) } },
    { label: "PV 2", values: { ...base(2, ["Frau", "Erika", "Testfrau"], ["Musterweg 5", "79100", "Freiburg"]), ...pv(c({ umsetzung: "So schnell wie möglich", hausart: "Ein-/Zweifamilienhaus", dachausrichtung: "Südwest", dachalter: "30-70 Jahre", dachflaeche: "45", stromspeicher: "Weiß nicht", stromverbrauch: "3.000 - 4.000 kWh" })) } },
    { label: "PV 3", values: { ...base(3, ["Herr", "Paul", "Probe"], ["Beispielallee 12", "79102", "Freiburg"]), ...pv(c({ umsetzung: "4-6 Monate", hausart: "Mehrfamilienhaus", dachausrichtung: "Ost", dachalter: "30-70 Jahre", dachflaeche: "120", stromspeicher: "Nein", stromverbrauch: "Über 6.000 kWh" })) } },
    { label: "WP 1", values: { ...base(4, ["Frau", "Anna", "Testkundin"], ["Probeweg 3", "79104", "Freiburg"]), ...wp(c({ installationszeitraum: "1-3 Monate", gebaeudetyp: "Ein-/Zweifamilienhaus", aktuelles_heizsystem: "Erdgas", beheizte_flaeche: "141-180 qm", aktuelle_waermeverteilung: "Fußbodenheizung", bevorzugte_waermepumpe: "Luftwärmepumpe", ist_neubau: "Nein", personen_im_haushalt: "4" })) } },
    { label: "WP 2", values: { ...base(5, ["Herr", "Tom", "Mustertest"], ["Testgasse 8", "79106", "Freiburg"]), ...wp(c({ installationszeitraum: "sofort", gebaeudetyp: "Ein-/Zweifamilienhaus", aktuelles_heizsystem: "Heizöl", beheizte_flaeche: "101-140 qm", aktuelle_waermeverteilung: "heizkörper", bevorzugte_waermepumpe: "Erdwärmepumpe", ist_neubau: "Nein", personen_im_haushalt: "2" })) } },
    { label: "WP 3", values: { ...base(6, ["Frau", "Lisa", "Prüfmann"], ["Probestraße 21", "79108", "Freiburg"]), ...wp(c({ installationszeitraum: "4-6 Monate", gebaeudetyp: "Mehrfamilienhaus", aktuelles_heizsystem: "Holz/Pellets", beheizte_flaeche: "181-250 qm", aktuelle_waermeverteilung: "heizkörper & Fußbodenheizung", bevorzugte_waermepumpe: "Beides Interessant", ist_neubau: "Nein", personen_im_haushalt: "5" })) } },
    { label: "PV mit Wärmepumpe 1", values: { ...base(7, ["Herr", "Jan", "Kombitest"], ["Testweg 14", "79110", "Freiburg"]), ...pv(c({ umsetzung: "1-3 Monate", hausart: "Ein-/Zweifamilienhaus", dachausrichtung: "Süd", dachalter: "Unter 30 Jahre", dachflaeche: "70", stromspeicher: "Ja", stromverbrauch: "4.000 - 6.000 kWh", waermepumpe: "Ja", aktuelles_heizsystem: "Erdgas", beheizte_flaeche: "141-180 qm", aktuelle_waermeverteilung: "Fußbodenheizung", bevorzugte_waermepumpe: "Luftwärmepumpe" })) } },
    { label: "PV mit Wärmepumpe 2", values: { ...base(8, ["Frau", "Nina", "Doppeltest"], ["Musterstraße 30", "79100", "Freiburg"]), ...pv(c({ umsetzung: "So schnell wie möglich", hausart: "Ein-/Zweifamilienhaus", dachausrichtung: "Süd-Ost", dachalter: "30-70 Jahre", dachflaeche: "55", stromspeicher: "Weiß nicht", stromverbrauch: "3.000 - 4.000 kWh", waermepumpe: "Ja", aktuelles_heizsystem: "Heizöl", beheizte_flaeche: "101-140 qm", aktuelle_waermeverteilung: "heizkörper", bevorzugte_waermepumpe: "Beides Interessant" })) } },
    { label: "Wärmepumpe mit PV", values: { ...base(9, ["Herr", "Kai", "Zusatztest"], ["Beispielweg 2", "79102", "Freiburg"]), ...wp(c({ installationszeitraum: "1-3 Monate", gebaeudetyp: "Ein-/Zweifamilienhaus", aktuelles_heizsystem: "Erdgas", beheizte_flaeche: "141-180 qm", aktuelle_waermeverteilung: "Fußbodenheizung", bevorzugte_waermepumpe: "Luftwärmepumpe", ist_neubau: "Nein", interesse_photovoltaikanlage: "Ja", hausart: "Ein-/Zweifamilienhaus", dachausrichtung: "Süd-West", dachalter: "Unter 30 Jahre", dachflaeche: "65", stromspeicher: "Ja", stromverbrauch: "4.000 - 6.000 kWh" })) } },
  ];
}
