/**
 * Felder eines Leads – eine Quelle für Server, Vorschau und Oberfläche.
 *  - Vermerke der Software (kein Feld des Kunden): werden nie als „Fachfeld“ gezeigt.
 *  - Felder der Lead-Kategorie aus einem Gespräch lesen: welche Felder sich dafür eignen, wie die Antwort der KI geprüft wird
 *    und was ohne KI geht (nur das, was eindeutig im Text steht).
 *  - Platzhalter wie „<UNKNOWN>“ oder „unbekannt“ sind keine Angabe.
 */

export type LeadFieldType = "text" | "zahl" | "auswahl" | "ja_nein" | "datum" | "notiz";
export type LeadFieldDef = { fieldKey: string; label: string; fieldType: LeadFieldType | string; options?: unknown };

/** Leere Antworten in Worten: „unbekannt“, „nicht genannt“, „<UNKNOWN>“, „n/a“, „-“ … */
const PLACEHOLDER = /^(?:<[^<>]*>|\[[^\[\]]*\]|unbekannt(?:er?|e)?|unknown|unklar|keine? angaben?|nicht (?:genannt|erwähnt|bekannt|angegeben|gesagt|vorhanden)|ohne angabe|k\.\s?a\.?|n\s?\/\s?a|n\.\s?a\.?|null|none|nil|undefined|[-–—?.]+)$/i;
/** Ist das eine echte Angabe? Platzhalter der KI oder aus Listen zählen nicht – auch mehrere hintereinander („<UNKNOWN> <UNKNOWN>“). */
export function isPlaceholder(value: unknown): boolean {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return true;
  return PLACEHOLDER.test(text) || text.split(" ").every((part) => PLACEHOLDER.test(part));
}
/** Text säubern: Leerzeichen zusammenziehen, Platzhalter fallen weg. */
export function realText(value: unknown, max = 300): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  return text && !isPlaceholder(text) ? text.slice(0, max) : null;
}

/** Anrede, die als Vorname gespeichert wurde („Herr“, „Frau“) – am Telefon heißt der Kunde oft nur „Herr Bade“. */
const SALUTATION = /^(?:herrn?|frau|hr\.?|fr\.?|familie|fam\.?)$/i;
export const isSalutation = (value: unknown): boolean => typeof value === "string" && SALUTATION.test(value.trim());
/** „Herr“ oder „Frau“ aus einer Angabe („herrn“ → „Herr“); alles andere ist keine Anrede. */
export function tidySalutation(value: unknown): "Herr" | "Frau" | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^(?:herrn?|hr\.?)$/.test(text) ? "Herr" : /^(?:frau|fr\.?)$/.test(text) ? "Frau" : null;
}
/**
 * v386: Anrede aus einer Angabe des Leads – auch so, wie Dialer und Listen sie schreiben („m“, „w“, „männlich“, „Bay“, „Bayan“, „Mr“).
 * Leer, Platzhalter („<UNKNOWN>“, „-“) und Unbekanntes ergeben null.
 */
export function salutationValue(value: unknown): "Herr" | "Frau" | null {
  const text = typeof value === "string" ? value.trim().toLowerCase().replace(/\.$/, "") : "";
  if (!text) return null;
  if (/^(?:herrn?|hr|mr|männlich|maennlich|mann|m|male|bay)$/.test(text)) return "Herr";
  if (/^(?:frau|fr|mrs|ms|weiblich|w|female|bayan)$/.test(text)) return "Frau";
  return null;
}
/**
 * v386: Die Anrede eines Leads – aus „salutation“ oder „anrede“, je nachdem, wo sie wirklich steht. Bis v385 galt nur das erste Feld:
 * Stand dort ein leerer Wert oder ein Platzhalter des Dialers, fiel die echte Anrede in „anrede“ unter den Tisch („Angaben fehlen – Anrede“).
 */
export function leadSalutation(metadata: unknown): "Herr" | "Frau" | null {
  const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  return salutationValue(meta.salutation) ?? salutationValue(meta.anrede) ?? salutationValue(meta.Anrede);
}
/**
 * Name eines Leads zum Anzeigen: „Vorname Nachname“; ohne Vornamen mit der Anrede davor („Herr Bade“). Platzhalter („<UNKNOWN>“) zählen nicht.
 * Leer, wenn es keinen Namen gibt – der Aufrufer entscheidet, was dann steht.
 */
export function leadDisplayName(lead: { firstName?: string | null; lastName?: string | null; metadata?: unknown }): string {
  const first = realText(lead.firstName, 120); const last = realText(lead.lastName, 120);
  const meta = lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata) ? lead.metadata as Record<string, unknown> : {};
  if (first) return [first, last].filter(Boolean).join(" ");
  return last ? [tidySalutation(meta.anrede ?? meta.salutation), last].filter(Boolean).join(" ") : "";
}

/* ------------------------------------------------------------------ Vermerke der Software */

const TECHNICAL = new Set([
  // Herkunft und Rohdaten
  "rawContactId", "rawBatch", "source", "automationPending", "importBatchId",
  // Gesprächsbewertung
  "callScore", "callVerdict", "callDecision", "callRecordId", "callExtractedAt", "callFieldsAt", "callFieldsTries", "callFieldsCallId",
  // Dialer
  "street", "company", "dialerContactId", "dialerResult", "dialerNote", "dialerCallbackAt",
  // Auslieferung
  "assignedDeliveryChainId", "assignedDeliveryChainName", "assignedOrderId", "assignedOrderNumber", "assignedBuyerUserId", "partnerReference", "partnerReferenceAt", "deliveredOrderNumber", "deliveredUnitPrice", "apiErrorsDismissedAt",
  // Automatisierung
  "duplicatedFromLeadId", "automationDuplicate", "duplicateOf", "creditCheck", "smartflow", "lastAutomationRule",
  // Rufnummernprüfung
  "phone_status", "phoneStatus", "hlr_status", "phone_valid",
]);
/** Vermerk der Software (z. B. Nummer des Gesprächs, Name der Liste) – keine Angabe des Kunden, also kein Fachfeld. */
export const isTechnicalMeta = (key: string): boolean => TECHNICAL.has(key);

/** Reine Merker der Software über ihre eigene Arbeit – sie gehen nie an einen Käufer oder Partner mit (auch nicht als „weitere Felder“). */
const NEVER_SENT = new Set(["apiErrorsDismissedAt", "callFieldsAt", "callFieldsTries", "callFieldsCallId"]);
/** Zusatzfelder eines Leads für die Übergabe nach außen: alles wie bisher, nur ohne die Merker der Software. */
export function outboundMeta(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return Object.fromEntries(Object.entries(metadata as Record<string, unknown>).filter(([key]) => !NEVER_SENT.has(key)));
}

const META_LABELS: Record<string, string> = { street: "Straße", company: "Firma", anrede: "Anrede", salutation: "Anrede", dialerResult: "Ergebnis im Dialer", dialerNote: "Notiz im Dialer", dialerCallbackAt: "Rückruf laut Dialer", utm_source: "Quelle (Anzeige)", utm_campaign: "Kampagne (Anzeige)", utm_medium: "Medium (Anzeige)" };
/** Lesbarer Name für ein Zusatzfeld ohne eigene Definition („monatliche_stromkosten“ → „Monatliche Stromkosten“, „wp_ist_neubau“ → „WP Neubau“). */
export function metaLabel(key: string): string {
  return META_LABELS[key] ?? readableLabel(key.replace(/([a-zäöüß])([A-ZÄÖÜ])/g, "$1 $2").replace(/[_-]+/g, " "));
}

/** Kürzel und Einheiten mit fester Schreibweise */
const LABEL_TOKENS: Record<string, string> = { pv: "PV", wp: "WP", plz: "PLZ", id: "ID", utm: "UTM", kwh: "kWh", kwp: "kWp", qm: "qm", url: "URL", api: "API", crm: "CRM", sms: "SMS", ki: "KI", "e-mail": "E-Mail", email: "E-Mail" };
/** Wortteile, die in Feldnamen ohne Umlaut ankommen – nur diese bekannten Stämme werden ersetzt, damit z. B. „aktuelle“ oder „Steuer“ heil bleiben */
const UMLAUT_STEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/gebaeude/g, "gebäude"], [/flaeche/g, "fläche"], [/waerme/g, "wärme"], [/wuensch/g, "wünsch"], [/eigentuemer/g, "eigentümer"], [/groesse/g, "größe"], [/hoehe/g, "höhe"],
  [/zusaetz/g, "zusätz"], [/moeglich/g, "möglich"], [/jaehr/g, "jähr"], [/koerper/g, "körper"], [/fussboden/g, "fußboden"], [/strasse/g, "straße"], [/verfueg/g, "verfüg"],
  [/pruef/g, "prüf"], [/kuehl/g, "kühl"], [/loesung/g, "lösung"], [/schaetz/g, "schätz"], [/aenderung/g, "änderung"], [/naechst/g, "nächst"], [/taeglich/g, "täglich"],
  [/haeufig/g, "häufig"], [/buero/g, "büro"], [/^ueber/g, "über"], [/^fuer$/g, "für"], [/photovolatik/g, "photovoltaik"],
];
/** Kleine Wörter bleiben klein, außer ganz vorn („Anzahl der Personen im Haushalt“) */
const SMALL_WORDS = new Set(["und", "oder", "mit", "im", "in", "am", "an", "auf", "aus", "bei", "für", "von", "vom", "zu", "zum", "zur", "pro", "je", "bis", "ab", "ohne", "nach", "vor", "seit", "per", "als", "der", "die", "das", "des", "dem", "den", "ein", "eine", "einer", "eines", "einem", "einen", "&"]);
const upperFirst = (word: string) => `${word.charAt(0).toLocaleUpperCase("de-DE")}${word.slice(1)}`;

/**
 * Feldname groß und lesbar (seit Version 368): jedes Wort beginnt groß (kleine Wörter wie „der“, „im“ nicht),
 * Kürzel wie WP, PV, PLZ und kWh stehen fest, „ae/oe/ue“ wird bei bekannten Wörtern zum Umlaut,
 * ein „ist“ am Anfang fällt weg („wp ist neubau“ → „WP Neubau“). Schon gut geschriebene Namen bleiben, wie sie sind – nur der erste Buchstabe jedes Worts wird groß.
 */
export function readableLabel(label: string): string {
  const words = String(label ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return String(label ?? "");
  const lower = (word: string) => word.toLocaleLowerCase("de-DE");
  if (words.length > 2 && LABEL_TOKENS[lower(words[0])] && lower(words[1]) === "ist") words.splice(1, 1);
  else if (words.length > 1 && lower(words[0]) === "ist") words.shift();
  return words.map((word, index) => {
    const small = lower(word);
    if (LABEL_TOKENS[small]) return LABEL_TOKENS[small];
    if (word !== small) return upperFirst(word); // schon mit Großbuchstaben geschrieben – so lassen
    const fixed = UMLAUT_STEMS.reduce((text, [stem, replacement]) => text.replace(stem, replacement), small);
    return index > 0 && SMALL_WORDS.has(fixed) ? fixed : upperFirst(fixed);
  }).join(" ");
}

/** Wert für die Anzeige: erster Buchstabe groß („heizkörper“ → „Heizkörper“) – nicht bei E-Mail-Adressen und Links */
export function readableValue(value: string): string {
  const text = String(value ?? ""); const first = text.charAt(0);
  if (!first || /@|^(https?:\/\/|www\.)/i.test(text) || /^[a-zäöüß]+[A-ZÄÖÜ]/.test(text)) return text; // E-Mail, Link, Marken wie „iPhone“ bleiben
  const upper = first.toLocaleUpperCase("de-DE");
  return upper !== first && upper.length === 1 ? `${upper}${text.slice(1)}` : text;
}
/** Zusatzfelder eines Leads, die weder zur Kategorie gehören noch Vermerke der Software sind – mit lesbarem Namen. */
export function extraMetaFields(metadata: unknown, knownKeys: Iterable<string> = []): Array<{ key: string; label: string; value: string }> {
  const known = new Set(knownKeys); const data = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  const out: Array<{ key: string; label: string; value: string }> = [];
  for (const [key, value] of Object.entries(data)) {
    if (known.has(key) || isTechnicalMeta(key) || value === null || value === undefined || value === "" || (typeof value === "object" && !Array.isArray(value))) continue;
    const text = Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined && typeof item !== "object").join(", ") : typeof value === "boolean" ? (value ? "Ja" : "Nein") : String(value);
    if (!text || isPlaceholder(text)) continue;
    out.push({ key, label: metaLabel(key), value: text });
  }
  return out;
}

/* ------------------------------------------------------------------ Felder der Kategorie aus dem Gespräch */

/** Felder, die niemand am Telefon sagt (Aufnahme-Link, Nummern fremder Systeme, Lieferant) – die bleiben beim Lesen aus dem Gespräch außen vor. */
const NOT_SPOKEN = /^(?:recording|aufnahme|aufzeichnung|ghl|lieferant|supplier|quelle|source|utm|info$|notiz_intern|intern)|(?:^|_)(?:id|url|link|token)(?:_\d+)?$/i;
export const isSpokenField = (field: Pick<LeadFieldDef, "fieldKey">): boolean => !NOT_SPOKEN.test(field.fieldKey) && !isTechnicalMeta(field.fieldKey);
export const fieldOptions = (field: Pick<LeadFieldDef, "options">): string[] => (Array.isArray(field.options) ? field.options.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []);
const isEmpty = (value: unknown) => value === null || value === undefined || value === "" || (typeof value === "string" && isPlaceholder(value));
/** Die Felder der Kategorie, die am Lead noch leer sind und sich aus einem Gespräch lesen lassen. */
export function fieldsToRead<T extends LeadFieldDef>(fields: T[], metadata: unknown): T[] {
  const data = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  return fields.filter((field) => isSpokenField(field) && isEmpty(data[field.fieldKey]));
}

const fold = (value: string) => value.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ").trim();
/** Zahl aus einer Angabe („4.500 kWh“ → „4500“, „3,5“ → „3.5“). */
function readNumber(text: string): string | null {
  const match = /-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?/.exec(text); if (!match) return null;
  const raw = match[0]; const normal = /^\-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(raw) ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(",", ".");
  return Number.isFinite(Number(normal)) ? String(Number(normal)) : null;
}
function readDate(text: string): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text); const german = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/.exec(text);
  const parts = iso ? [iso[1], iso[2], iso[3]] : german ? [german[3], german[2].padStart(2, "0"), german[1].padStart(2, "0")] : null; if (!parts) return null;
  const date = new Date(`${parts[0]}-${parts[1]}-${parts[2]}T12:00:00Z`); return Number.isNaN(date.getTime()) || date.getUTCMonth() + 1 !== Number(parts[1]) ? null : `${parts[0]}-${parts[1]}-${parts[2]}`;
}
/**
 * Antwort für ein Feld prüfen – so, wie die Kategorie das Feld festlegt. Passt sie nicht (z. B. keine der Auswahl-Antworten), bleibt das Feld leer:
 * lieber nichts als etwas Falsches an den Käufer geben.
 */
export function cleanFieldValue(field: LeadFieldDef, raw: unknown): string | null {
  const text = realText(raw, field.fieldType === "notiz" ? 600 : 300); if (!text) return null;
  if (field.fieldType === "ja_nein") return /^(?:ja\b|yes\b|true$|stimmt|richtig|vorhanden)/i.test(text) ? "Ja" : /^(?:nein\b|no\b|false$|kein|nicht vorhanden)/i.test(text) ? "Nein" : null;
  if (field.fieldType === "zahl") return readNumber(text);
  if (field.fieldType === "datum") return readDate(text);
  if (field.fieldType === "auswahl") {
    const options = fieldOptions(field); if (!options.length) return text;
    const wanted = fold(text); const exact = options.find((option) => fold(option) === wanted); if (exact) return exact;
    const near = options.filter((option) => { const folded = fold(option); return folded.length >= 3 && (wanted.includes(folded) || folded.includes(wanted)); });
    return near.length === 1 ? near[0] : null;
  }
  return text;
}
/** Felder, die einen Link zur Aufnahme tragen („pv_recording_1“, „wp_record_file“, „wp_sprachaufzeichung“). */
export const RECORDING_FIELD = /record|aufzeich|aufnahme|recording/i;
/** Name ohne Vorsilbe der Leadsparte, ohne Klammerzusatz, ä = ae: „pv_dachflaeche“ = „Dachfläche (m²)“ = „dachflaeche“. */
const bareName = (value: string) => fold(String(value ?? "").replace(/\([^)]*\)/g, " ")).replace(/^(?:pv|wp)\s+/, "").replace(/\s+/g, "");
/** Abstand zweier Namen (Buchstabe falsch, fehlt, zu viel oder zwei vertauscht) – für Tippfehler wie „sprachaufzeichung“, „photovolatikanalge“. */
function typoDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1; d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
/** Wie viele Tippfehler bei einem Namen dieser Länge noch als derselbe Name gelten. */
const typoAllowance = (length: number) => (length >= 16 ? 2 : length >= 8 ? 1 : 0);
export type DialerFieldMapping = { sourceField: string; targetFieldKey: string; mode?: string | null; searchValue?: string | null; replaceValue?: string | null };
/**
 * Angaben, die der Dialer unter eigenen Namen schickt („pv_dachart“, „wp_gebaeudetyp“), den Feldern der Kategorie zuordnen.
 * Reihenfolge: 1. die Zuordnungen der Kategorie (z. B. „record_file → Recording“, Adresse umschreiben), 2. gleicher Name (Vorsilbe pv_/wp_ zählt nicht, ä = ae),
 * 3. kleine Tippfehler im Namen. Gilt nur für leere Felder; die Antwort wird wie jede andere geprüft (Auswahl, Ja/Nein, Zahl, Datum) – passt sie nicht, bleibt sie als eigene Angabe stehen.
 * Steht dasselbe Feld mit „pv_“ und „wp_“ da, gilt das der eigenen Leadsparte. Aufnahme-Links, die kein Feld der Kategorie bekommen, werden entfernt (sie gingen sonst mit an den Käufer).
 */
export function dialerFieldMatches(fields: LeadFieldDef[], metadata: unknown, categoryName?: string | null, mappings: DialerFieldMapping[] = []): { values: Record<string, string>; sources: string[] } {
  const data = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  const own = /w(ä|ae)rmepumpe|\bwp\b/i.test(categoryName ?? "") && !/photovolt|\bpv\b|solar/i.test(categoryName ?? "") ? "wp" : "pv";
  const fieldKeys = new Set(fields.map((field) => field.fieldKey));
  const keys = Object.keys(data).filter((key) => !fieldKeys.has(key) && !isEmpty(data[key])).sort((a, b) => Number(!a.toLowerCase().startsWith(own)) - Number(!b.toLowerCase().startsWith(own)));
  const values: Record<string, string> = {}; const sources: string[] = []; const used = new Set<string>();
  // Eine Zuordnung „umschreiben“ gilt für alles, was in ihr Feld kommt (z. B. Adresse der Aufnahme leadshome.ondialer.com → download.voicefile.de)
  const rewrite = (fieldKey: string, raw: unknown) => { let text = String(raw ?? ""); for (const mapping of mappings) if (mapping.targetFieldKey === fieldKey && mapping.mode === "umschreiben" && mapping.searchValue) text = text.split(mapping.searchValue).join(mapping.replaceValue ?? ""); return text; };
  const take = (field: LeadFieldDef, key: string, raw: unknown) => { const value = cleanFieldValue(field, rewrite(field.fieldKey, raw)); if (value === null) return false; values[field.fieldKey] = value; sources.push(key); used.add(key); return true; };
  const open = fields.filter((field) => isEmpty(data[field.fieldKey]));
  // 1. Zuordnungen der Kategorie
  for (const mapping of mappings) {
    const field = open.find((item) => item.fieldKey === mapping.targetFieldKey); if (!field || values[field.fieldKey] !== undefined) continue;
    const key = keys.find((item) => !used.has(item) && bareName(item) === bareName(mapping.sourceField)); if (!key) continue;
    take(field, key, data[key]);
  }
  // 2. gleicher Name, 3. kleiner Tippfehler – nur, wenn genau ein Feld so nah liegt
  for (const pass of ["gleich", "tippfehler"] as const) {
    for (const field of open) {
      if (values[field.fieldKey] !== undefined) continue;
      const names = [bareName(field.fieldKey), bareName(field.label)].filter((name) => name.length >= 3);
      const fits = (key: string) => { const name = bareName(key); return pass === "gleich" ? names.includes(name) : names.some((own) => { const allowed = typoAllowance(Math.min(own.length, name.length)); return allowed > 0 && typoDistance(own, name) <= allowed; }); };
      const candidates = keys.filter((key) => !used.has(key) && fits(key));
      if (pass === "tippfehler" && new Set(candidates.map(bareName)).size !== 1) continue;
      for (const key of candidates) if (take(field, key, data[key])) break;
    }
  }
  // Aufnahme-Links ohne eigenes Feld der Kategorie: entfernen
  for (const key of keys) if (!used.has(key) && RECORDING_FIELD.test(key) && /^https?:\/\//i.test(String(data[key]).trim())) sources.push(key);
  return { values, sources };
}
/** Nur die zugeordneten Werte (siehe dialerFieldMatches). */
export function dialerFieldValues(fields: LeadFieldDef[], metadata: unknown, categoryName?: string | null, mappings: DialerFieldMapping[] = []): Record<string, string> {
  return dialerFieldMatches(fields, metadata, categoryName, mappings).values;
}
/** Antworten prüfen und nur die behalten, die zu einem Feld passen. */
export function cleanFieldValues(fields: LeadFieldDef[], values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) { const value = cleanFieldValue(field, values[field.fieldKey]); if (value !== null) out[field.fieldKey] = value; }
  return out;
}
/**
 * Ersatz ohne KI: Bei Auswahl-Feldern gilt eine Antwort nur, wenn genau EINE der Antworten wörtlich im Gespräch fällt
 * (mindestens zwei Wörter oder ein langes Wort – „Ja“/„Nein“ allein sagen nichts über ein bestimmtes Feld).
 */
export function fieldsFromTranscript(fields: LeadFieldDef[], transcript: string | null | undefined): Record<string, string> {
  const text = ` ${fold(String(transcript ?? ""))} `; const out: Record<string, string> = {};
  if (text.trim().length < 20) return out;
  for (const field of fields) {
    if (field.fieldType !== "auswahl") continue;
    const hits = fieldOptions(field).filter((option) => { const folded = fold(option); return (folded.includes(" ") || folded.length >= 8) && text.includes(` ${folded} `); });
    if (hits.length === 1) out[field.fieldKey] = hits[0];
  }
  return out;
}

/* ------------------------------------------------------------------ Antworten aus dem Gespräch (Prüffragen) */

export type CallAnswer = { key: string; label: string; answer: "ja" | "nein" | "unklar"; note: string };
/** Prüffragen der Kampagne mit ihren Antworten aus dem Gespräch – in der Reihenfolge der Fragen; unbeantwortete und „Entfällt“ fallen weg. */
export function callAnswerList(questions: Array<{ key: string; label: string }>, answers: unknown): CallAnswer[] {
  const given = answers && typeof answers === "object" && !Array.isArray(answers) ? answers as Record<string, { answer?: unknown; note?: unknown }> : {};
  const out: CallAnswer[] = [];
  for (const question of questions) {
    const item = given[question.key]; const answer = String(item?.answer ?? "").toLowerCase(); const note = typeof item?.note === "string" ? item.note.trim() : "";
    if (answer !== "ja" && answer !== "nein" && answer !== "unklar") continue;
    if (/^entfällt/i.test(note)) continue;
    out.push({ key: question.key, label: question.label, answer, note: note.slice(0, 600) });
  }
  return out;
}
