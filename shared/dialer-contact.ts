/**
 * Kontakt-Daten in der Meldung „Gespräch beendet“ des Dialers.
 * Der Dialer kann den ganzen Kontakt mitschicken – verschachtelt unter `contact` oder flach neben `phone`,
 * mit englischen oder deutschen Feldnamen. Hier wird er aus der Meldung gelesen und mit vorhandenen Daten zusammengeführt.
 * Bewusst ohne Datenbank: Server, Vorschau und Tests nutzen dieselbe Logik.
 */

/** Zuordnung der zusätzlichen Felder (Pfad in der Meldung, Punkt-Schreibweise) – in den Einstellungen änderbar. */
export const CONTACT_MAPPING = { result: "result", note: "note", callbackAt: "callback_at", contactId: "contact.id", firstName: "contact.first_name", lastName: "contact.last_name", company: "contact.company", street: "contact.street", postcode: "contact.postcode", city: "contact.city", country: "contact.country", email: "contact.email", contactFields: "contact.fields", category: "category" } as const;
export type ContactMappingKey = keyof typeof CONTACT_MAPPING;
export const CONTACT_MAPPING_LABELS: Array<[ContactMappingKey, string]> = [["contactId", "Kontakt-Nummer des Dialers"], ["firstName", "Vorname"], ["lastName", "Nachname"], ["company", "Firma"], ["street", "Straße mit Hausnummer"], ["postcode", "PLZ"], ["city", "Ort"], ["country", "Land"], ["email", "E-Mail"], ["contactFields", "Weitere Felder (Name-Wert-Paare)"], ["category", "Leadsparte (PV, WP, PV+WP)"], ["result", "Ergebnis im Dialer"], ["note", "Notiz des Agenten"], ["callbackAt", "Rückruf oder Termin"]];

export type DialerContact = {
  externalId: string | null; firstName: string | null; lastName: string | null; company: string | null; street: string | null; postcode: string | null; city: string | null;
  country: "DE" | "AT" | "CH"; email: string | null; phone: string | null; category: string | null; fields: Record<string, string>;
  result: string | null; note: string | null; callbackAt: string | null;
  /** erkannte Angaben in der Schreibweise der Anleitung – für den Testmodus */
  found: string[];
  /** Name oder Firma vorhanden: reicht, um einen neuen Kontakt anzulegen */
  hasIdentity: boolean;
  /** irgendeine Angabe zum Kontakt oder zum Ergebnis vorhanden */
  hasData: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const norm = (key: string) => key.toLowerCase().replace(/[^a-z0-9äöüß]/g, "");
const clean = (value: unknown, max: number): string | null => {
  const raw = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "boolean" ? (value ? "ja" : "nein") : value;
  if (typeof raw !== "string") return null; const text = raw.replace(/\s+/g, " ").trim(); return text ? text.slice(0, max) : null;
};
const readPath = (value: unknown, path: string | undefined): unknown => (path ? path.split(".").filter(Boolean).reduce<unknown>((current, segment) => (isObject(current) ? current[segment] : undefined), value) : undefined);

const ALIASES = {
  firstName: ["firstname", "vorname", "givenname", "forename"],
  lastName: ["lastname", "nachname", "surname", "familyname"],
  fullName: ["name", "fullname", "kontaktname", "contactname", "kundenname", "customername"],
  company: ["company", "firma", "companyname", "firmenname", "organisation", "organization"],
  street: ["street", "strasse", "straße", "address", "adresse", "streetaddress", "address1", "anschrift"],
  houseNumber: ["housenumber", "hausnummer", "streetnumber", "hnr", "hausnr"],
  postcode: ["postcode", "postalcode", "zip", "zipcode", "plz", "postleitzahl"],
  city: ["city", "ort", "stadt", "town", "wohnort"],
  country: ["country", "land", "countrycode"],
  email: ["email", "mail", "emailaddress", "emailadresse"],
  phone: ["phone", "telefon", "tel", "mobile", "mobil", "handy", "phonenumber", "telefonnummer", "rufnummer"],
  id: ["id", "contactid", "kontaktid", "customerid", "kundenid", "kundennummer", "contactnumber"],
  category: ["category", "kategorie", "leadcategory", "sparte"],
  fields: ["fields", "customfields", "zusatzfelder", "felder", "data", "extra", "attributes"],
  result: ["result", "disposition", "outcome", "ergebnis", "abschluss", "abschlussgrund", "callresult", "dispo", "dispositioncode"],
  note: ["note", "notes", "comment", "comments", "kommentar", "notiz", "agentnote", "bemerkung"],
  callbackAt: ["callbackat", "callback", "rueckruf", "rückruf", "wiedervorlage", "appointmentat", "appointment", "termin"],
} as const;
type AliasKey = keyof typeof ALIASES;
/** Flach neben `phone` zählen allgemeine Namen nicht (dort hieße `id` oder `name` etwas anderes) – nur eindeutige oder mit Vorsatz wie `contact_`. */
const AMBIGUOUS_AT_TOP: Partial<Record<AliasKey, string[]>> = { fullName: ["name"], id: ["id"], fields: ["fields", "data", "extra", "attributes"], phone: ["phone", "telefon", "tel", "mobile", "mobil", "handy", "phonenumber", "telefonnummer", "rufnummer"], category: [] };
const TOP_PREFIXES = ["contact", "kontakt", "customer", "kunde"];
const CONTAINER_KEYS = ["contact", "kontakt", "customer", "kunde", "lead", "person"];

const findIn = (source: Record<string, unknown> | null, key: AliasKey, top: boolean): { key: string; value: unknown } | null => {
  if (!source) return null; const names = ALIASES[key] as readonly string[]; const blocked = top ? AMBIGUOUS_AT_TOP[key] ?? [] : [];
  for (const [raw, value] of Object.entries(source)) {
    if (value === null || value === undefined || value === "") continue; const name = norm(raw);
    if (names.includes(name) && !blocked.includes(name)) return { key: raw, value };
    if (top && TOP_PREFIXES.some((prefix) => name.startsWith(prefix) && names.includes(name.slice(prefix.length)))) return { key: raw, value };
  }
  return null;
};
const COUNTRY: Record<string, "DE" | "AT" | "CH"> = { de: "DE", deu: "DE", deutschland: "DE", germany: "DE", at: "AT", aut: "AT", österreich: "AT", oesterreich: "AT", austria: "AT", ch: "CH", che: "CH", schweiz: "CH", switzerland: "CH" };
const flatFields = (value: unknown): Record<string, string> => {
  const out: Record<string, string> = {}; if (!isObject(value)) return out;
  for (const [raw, item] of Object.entries(value)) {
    if (Object.keys(out).length >= 60) break; const name = raw.replace(/\s+/g, " ").trim().slice(0, 80); if (!name) continue;
    const text = Array.isArray(item) ? clean(item.filter((entry) => typeof entry !== "object").join(", "), 500) : clean(item, 500);
    if (text) out[name] = text;
  }
  return out;
};

/** Liest Kontakt, Ergebnis und Notiz aus der Meldung des Dialers. `mapping`: eingestellte Pfade (sonst die Vorgaben). */
export function extractDialerContact(payload: unknown, mapping: Partial<Record<string, string>> = {}): DialerContact {
  const top = isObject(payload) ? payload : {};
  const path = (key: ContactMappingKey) => mapping[key] || CONTACT_MAPPING[key];
  const container = CONTAINER_KEYS.map((name) => Object.entries(top).find(([raw, value]) => norm(raw) === name && isObject(value))?.[1]).find(isObject) ?? null;
  const found: string[] = [];
  const pick = (mapped: ContactMappingKey | null, alias: AliasKey, label: string, max: number): string | null => {
    const direct = mapped ? clean(readPath(top, path(mapped)), max) : null;
    const value = direct ?? clean(findIn(container, alias, false)?.value, max) ?? clean(findIn(top, alias, true)?.value, max);
    if (value) found.push(label); return value;
  };
  let firstName = pick("firstName", "firstName", "contact.first_name", 120); let lastName = pick("lastName", "lastName", "contact.last_name", 120);
  if (!firstName && !lastName) { // nur ein ganzer Name: letztes Wort = Nachname
    const full = clean(findIn(container, "fullName", false)?.value, 240) ?? clean(findIn(top, "fullName", true)?.value, 240);
    if (full) { const parts = full.split(" "); lastName = parts.length > 1 ? parts.pop()!.slice(0, 120) : full.slice(0, 120); firstName = parts.length && parts.join(" ") !== lastName ? parts.join(" ").slice(0, 120) : null; found.push("contact.name"); }
  }
  const company = pick("company", "company", "contact.company", 160);
  let street = pick("street", "street", "contact.street", 200);
  const houseNumber = clean(findIn(container, "houseNumber", false)?.value, 20) ?? clean(findIn(top, "houseNumber", true)?.value, 20);
  if (street && houseNumber && !street.toLowerCase().endsWith(houseNumber.toLowerCase())) street = `${street} ${houseNumber}`.slice(0, 200);
  const postcode = pick("postcode", "postcode", "contact.postcode", 24); const city = pick("city", "city", "contact.city", 120);
  const countryRaw = clean(readPath(top, path("country")), 40) ?? clean(findIn(container, "country", false)?.value, 40) ?? clean(findIn(top, "country", true)?.value, 40);
  const country = COUNTRY[(countryRaw ?? "").toLowerCase()] ?? "DE"; if (countryRaw) found.push("contact.country");
  const emailRaw = pick("email", "email", "contact.email", 320); const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw.toLowerCase() : null; if (emailRaw && !email) found.pop();
  const phone = clean(findIn(container, "phone", false)?.value, 48);
  const externalId = pick("contactId", "id", "contact.id", 120);
  const category = clean(readPath(top, path("category")), 160) ?? clean(findIn(container, "category", false)?.value, 160) ?? clean(findIn(top, "category", true)?.value, 160); if (category) found.push("category");
  // weitere Felder: das Feld `fields` – und alles im Kontakt, was kein bekanntes Feld ist
  const mappedFields = readPath(top, path("contactFields")); const fieldsSource = isObject(mappedFields) ? mappedFields : findIn(container, "fields", false)?.value ?? findIn(top, "fields", true)?.value;
  const fields = flatFields(fieldsSource);
  if (container) { const known = new Set<string>(Object.values(ALIASES).flat()); for (const [raw, value] of Object.entries(container)) { if (known.has(norm(raw)) || isObject(value) || Object.keys(fields).length >= 60) continue; const name = raw.replace(/\s+/g, " ").trim().slice(0, 80); const text = Array.isArray(value) ? null : clean(value, 500); if (name && text && !(name in fields)) fields[name] = text; } }
  if (Object.keys(fields).length) found.push(`contact.fields (${Object.keys(fields).length})`);
  const result = clean(readPath(top, path("result")), 160) ?? clean(findIn(top, "result", false)?.value, 160); if (result) found.push("result");
  const note = clean(readPath(top, path("note")), 2000) ?? clean(findIn(top, "note", false)?.value, 2000); if (note) found.push("note");
  const callbackRaw = clean(readPath(top, path("callbackAt")), 60) ?? clean(findIn(top, "callbackAt", false)?.value, 60);
  const callbackAt = callbackRaw ? (Number.isNaN(new Date(callbackRaw).getTime()) ? callbackRaw : new Date(callbackRaw).toISOString()) : null; if (callbackAt) found.push("callback_at");
  const hasIdentity = Boolean(firstName || lastName || company);
  const hasData = hasIdentity || Boolean(street || postcode || city || email || externalId || category || result || note || callbackAt || Object.keys(fields).length);
  return { externalId, firstName, lastName, company, street, postcode, city, country, email, phone, category, fields, result, note, callbackAt, found, hasIdentity, hasData };
}

/**
 * Führt die Angaben des Dialers mit vorhandenen Zusatzfeldern zusammen. Vorhandene Werte bleiben stehen;
 * nur Ergebnis, Notiz und Rückruf des Dialers gelten jeweils vom letzten Gespräch.
 */
export function mergeDialerData(existing: Record<string, unknown> | null | undefined, contact: DialerContact): { data: Record<string, unknown>; changed: boolean } {
  const data: Record<string, unknown> = { ...(existing ?? {}) }; let changed = false;
  const empty = (value: unknown) => value === undefined || value === null || value === "";
  const fill = (key: string, value: string | null) => { if (value && empty(data[key])) { data[key] = value; changed = true; } };
  const set = (key: string, value: string | null) => { if (value && data[key] !== value) { data[key] = value; changed = true; } };
  fill("street", contact.street);
  for (const [key, value] of Object.entries(contact.fields)) fill(key, value);
  fill("dialerContactId", contact.externalId);
  set("dialerResult", contact.result); set("dialerNote", contact.note); set("dialerCallbackAt", contact.callbackAt);
  return { data, changed };
}

/** Kurzfassung für die Anzeige im Gespräch: was der Dialer zum Kontakt und zum Ergebnis gemeldet hat. */
export function dialerInfo(payload: unknown, mapping: Partial<Record<string, string>> = {}) {
  const contact = extractDialerContact(payload, mapping); if (!contact.hasData) return null;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null;
  const place = [contact.postcode, contact.city].filter(Boolean).join(" ") || null;
  return { result: contact.result, note: contact.note, callbackAt: contact.callbackAt, contactId: contact.externalId, name, company: contact.company, street: contact.street, place, email: contact.email, category: contact.category, fields: Object.entries(contact.fields).map(([label, value]) => ({ label, value })) };
}
export type DialerInfo = NonNullable<ReturnType<typeof dialerInfo>>;

/** Welche Produkte nennt eine Leadsparte? „PV“, „Photovoltaik“, „Solar“ → PV; „WP“, „Wärmepumpe“ → WP; „PV+WP“, „beides“ → beide. */
export function categoryProducts(value: string | null | undefined): { pv: boolean; wp: boolean } {
  const text = ` ${String(value ?? "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ").trim()} `;
  const both = /\b(pvwp|wppv|beides|beide|both)\b/.test(text);
  return { pv: both || /\b(pv|photovoltaik|fotovoltaik|solar|solaranlage|solarstrom)\b/.test(text), wp: both || /\b(wp|waermepumpe|waermepumpen|heatpump|heat pump)\b/.test(text) };
}
/**
 * Leadsparte des Dialers einer Kategorie zuordnen: zuerst genauer Name oder Kürzel; sonst über das Produkt –
 * „PV“ → die Photovoltaik-Kategorie, „WP“ → die Wärmepumpen-Kategorie, „PV+WP“ → die Kategorie für beides.
 * Nur ein eindeutiger Treffer zählt; sonst null (dann erkennt die Software die Kategorie aus dem Gespräch).
 */
export function matchDialerCategory<T extends { id: number; name: string; shortcode?: string | null }>(categories: T[], wanted: string | null | undefined): T | null {
  const value = String(wanted ?? "").trim().toLowerCase(); if (!value) return null;
  const exact = categories.filter((item) => item.name.trim().toLowerCase() === value || (item.shortcode ?? "").trim().toLowerCase() === value); if (exact.length === 1) return exact[0];
  const want = categoryProducts(value); if (!want.pv && !want.wp) return null;
  const hits = categories.filter((item) => { const has = categoryProducts(`${item.name} ${item.shortcode ?? ""}`); return has.pv === want.pv && has.wp === want.wp; });
  return hits.length === 1 ? hits[0] : null;
}
