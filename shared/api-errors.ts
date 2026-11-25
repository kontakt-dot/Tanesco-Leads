/**
 * API-Fehler – eine Quelle für Server, Vorschau und Oberfläche.
 *  - Was ist beim Übergeben eines Leads schiefgegangen? Aus dem Code der Antwort und dem Text des Empfängers wird ein Satz in einfachen
 *    Worten: was passiert ist und was jetzt zu tun ist.
 *  - Angaben des Leads prüfen, bevor er rausgeht: E-Mail-Adresse, Rufnummer, PLZ.
 *  - Übersicht bauen: offene Probleme je Lead, zuletzt Erledigtes und der Zustand jeder Schnittstelle („API-Gesundheit“).
 * Die Rechnung hängt an keiner Datenbank – Server und Vorschau geben dieselben Zeilen hinein.
 */
import { isPlaceholder, leadDisplayName } from "./lead-fields";
import { normalizePostcode } from "./postcode";

/* ------------------------------------------------------------------ Arten von Fehlern */

export type ApiErrorKind = "daten" | "abgelehnt" | "dublette" | "zugang" | "adresse" | "limit" | "stoerung" | "zeit" | "verbindung" | "einrichtung" | "kein_abnehmer" | "unbekannt";
/** Wer kann das Problem lösen? lead = Angaben des Leads korrigieren · schnittstelle = Zugang/Adresse beim Käufer prüfen · lieferkette = Lieferkette anpassen · warten = später noch einmal · keine = nichts zu tun */
export type ApiFix = "lead" | "schnittstelle" | "lieferkette" | "warten" | "keine";
export type LeadContactField = "firstName" | "lastName" | "email" | "phone" | "street" | "postcode" | "city";
export type ApiErrorInfo = { kind: ApiErrorKind; title: string; advice: string; fix: ApiFix; field: LeadContactField | null };

export const API_ERROR_KIND_LABEL: Record<ApiErrorKind, string> = {
  daten: "Angaben falsch", abgelehnt: "Abgelehnt", dublette: "Schon bekannt", zugang: "Zugang", adresse: "Adresse falsch", limit: "Zu viele Anfragen",
  stoerung: "Störung beim Empfänger", zeit: "Keine Antwort", verbindung: "Keine Verbindung", einrichtung: "Nicht eingerichtet", kein_abnehmer: "Kein Abnehmer", unbekannt: "Unklar",
};
export const LEAD_FIELD_LABEL: Record<LeadContactField, string> = { firstName: "Vorname", lastName: "Nachname", email: "E-Mail-Adresse", phone: "Rufnummer", street: "Straße", postcode: "PLZ", city: "Ort" };

/** Welche Angabe des Leads meint der Empfänger? Sucht im Text der Antwort nach den üblichen Feldnamen (deutsch und englisch). */
export function fieldFromError(body: string | null | undefined): LeadContactField | null {
  const text = String(body ?? "").toLowerCase();
  if (!text) return null;
  if (/e-?mail|e_mail|mail[_ -]?address|\bmail\b/.test(text)) return "email";
  if (/phone|telefon|\btel\b|mobile|mobil|handy|rufnummer|msisdn/.test(text)) return "phone";
  if (/zip|postal|post_?code|\bplz\b|postleitzahl/.test(text)) return "postcode";
  if (/first[_ -]?name|vorname|given[_ -]?name/.test(text)) return "firstName";
  if (/last[_ -]?name|nachname|surname|family[_ -]?name/.test(text)) return "lastName";
  if (/street|stra(?:ß|ss)e|address|adresse|anschrift|house[_ -]?number|hausnummer/.test(text)) return "street";
  if (/\bcity\b|\bort\b|\bstadt\b|\btown\b/.test(text)) return "city";
  return null;
}

const DUPLICATE = /duplicate|duplikat|dublette|already (?:exists|known|registered|submitted)|bereits (?:vorhanden|bekannt|erfasst|geliefert)|schon (?:vorhanden|bekannt)|doppelt/i;
/** Die PLZ liegt nicht im Gebiet des Empfängers („postal_code_not_serviceable“, „außerhalb des Liefergebiets“ …). */
const OUT_OF_AREA = /not[_ -]?serviceable|not[_ -]?serviced|out[_ -]?of[_ -]?(?:area|region|coverage|zone)|no[_ -]?coverage|outside (?:of )?(?:the |our |your )?(?:delivery |service |sales )?(?:area|region|coverage|zone)|außerhalb|ausserhalb|nicht im (?:liefer|einzugs|verkaufs)?gebiet|region (?:not|nicht)/i;
/** Der Empfänger will diesen Kontakt nicht (Sperrliste). */
const BLOCKED = /black[_ -]?list|block[_ -]?list|sperrliste|gesperrt|\bblocked\b|\bbanned\b|opt[_ -]?out|robinson/i;
/** Der Empfänger hat gerade keinen Platz: kein Partner, Kontingent oder Budget erschöpft. */
const NO_CAPACITY = /no[_ -]?(?:partner|buyer|vendor|taker)|kein(?:en)? (?:partner|abnehmer|käufer)|quota|kontingent|capacity|kapazität|budget|cap[_ -]?reached|limit[_ -]?(?:reached|exceeded)|ausgeschöpft|erschöpft/i;
/** Eine Angabe fehlt ganz (statt falsch zu sein). */
const MISSING = /missing|required|is blank|can'?t be blank|must not be (?:empty|blank)|darf nicht leer|fehlt|pflichtfeld|erforderlich|is empty/i;
const SETUP = /nicht aktiv|keine exportadresse|zugangsschlüssel|nicht konfiguriert|kein(?:e)? (?:endpunkt|adresse|endpoint)|fehlt ein|sichere öffentliche https/i;

/**
 * Antwort eines Empfängers in einfachen Worten.
 * `status` = Code der Antwort (fehlt, wenn gar keine Antwort kam), `body` = Text der Antwort oder die Fehlermeldung der Verbindung.
 */
export function explainApiError(input: { status?: number | null; body?: string | null }): ApiErrorInfo {
  const status = typeof input.status === "number" && Number.isFinite(input.status) ? input.status : null;
  const body = String(input.body ?? "").trim();
  const info = (kind: ApiErrorKind, title: string, advice: string, fix: ApiFix, field: LeadContactField | null = null): ApiErrorInfo => ({ kind, title, advice, fix, field });
  if (DUPLICATE.test(body) || status === 409) return info("dublette", "Der Empfänger kennt diesen Kontakt schon.", "Der Lead ist dort bereits vorhanden. Er kann an einen anderen Käufer gehen oder als erledigt abgehakt werden.", "keine");
  if (status === null) {
    if (SETUP.test(body)) return info("einrichtung", "Die Schnittstelle ist nicht fertig eingerichtet.", body || "Es fehlt die Adresse oder der Zugang des Empfängers. Bitte beim Käufer unter „Integration“ nachtragen.", "schnittstelle");
    if (/time[d ]?out|timeout|aborted|abort|etimedout|zeitüberschreitung/i.test(body)) return info("zeit", "Der Empfänger hat nicht rechtzeitig geantwortet.", "Meist nur vorübergehend. Später noch einmal ausliefern – passiert es oft, beim Empfänger nachfragen.", "warten");
    if (/enotfound|getaddrinfo|eai_again|\bdns\b/i.test(body)) return info("adresse", "Die Adresse der Schnittstelle gibt es nicht.", "Wahrscheinlich ein Schreibfehler in der Adresse. Bitte beim Käufer unter „Integration“ prüfen.", "schnittstelle");
    if (/certificate|\bssl\b|\btls\b|cert_|self[- ]signed/i.test(body)) return info("verbindung", "Die Verbindung zum Empfänger ist nicht sicher.", "Das Sicherheits-Zertifikat des Empfängers ist abgelaufen oder falsch. Das muss der Empfänger beheben.", "schnittstelle");
    return info("verbindung", "Keine Verbindung zum Empfänger.", "Der Empfänger war nicht erreichbar. Später noch einmal ausliefern – bleibt es so, die Adresse prüfen.", "warten");
  }
  // Der Empfänger hat geantwortet und den Lead nicht genommen: Was genau stört ihn?
  const refused = (): ApiErrorInfo | null => {
    if (OUT_OF_AREA.test(body)) return info("abgelehnt", "Der Empfänger nimmt keine Leads aus diesem Gebiet.", "Die PLZ liegt außerhalb seines Gebiets – am Lead ist nichts falsch. Noch einmal ausliefern (dann geht er an den nächsten Käufer) und das Gebiet beim Käufer in der Lieferkette eintragen.", "lieferkette");
    if (BLOCKED.test(body)) return info("abgelehnt", "Der Empfänger hat diesen Kontakt gesperrt.", "Der Kontakt steht dort auf einer Sperrliste. An einen anderen Käufer ausliefern oder abhaken.", "keine");
    if (NO_CAPACITY.test(body)) return info("abgelehnt", "Der Empfänger hat gerade keinen Platz für diesen Lead.", "Sein Kontingent ist voll oder er hat keinen Abnehmer. Später noch einmal ausliefern oder an einen anderen Käufer geben.", "warten");
    const field = fieldFromError(body);
    if (field) return info("daten", MISSING.test(body) ? `Dem Empfänger fehlt die Angabe „${LEAD_FIELD_LABEL[field]}“.` : `Der Empfänger lehnt die Angabe „${LEAD_FIELD_LABEL[field]}“ ab.`, "Angabe korrigieren und den Lead noch einmal ausliefern.", "lead", field);
    return null;
  };
  if (status === 400 || status === 406 || status === 412 || status === 415 || status === 422) {
    return refused() ?? info("abgelehnt", "Der Empfänger lehnt die Angaben des Leads ab.", "In der Antwort des Empfängers steht meist, was nicht passt. Angaben korrigieren und noch einmal ausliefern.", "lead");
  }
  if (status === 401 || status === 403 || status === 407) return info("zugang", "Der Empfänger lässt uns nicht hinein.", "Schlüssel oder Passwort der Schnittstelle stimmen nicht (mehr). Bitte beim Käufer unter „Integration“ neu eintragen.", "schnittstelle");
  if (status === 402) return info("zugang", "Das Konto beim Empfänger ist gesperrt oder ohne Guthaben.", "Das muss der Empfänger klären. Danach noch einmal ausliefern.", "schnittstelle");
  if (status === 404 || status === 405 || status === 410) return info("adresse", "Die Adresse der Schnittstelle stimmt nicht (mehr).", "Unter dieser Adresse nimmt der Empfänger nichts an. Bitte beim Käufer unter „Integration“ die Adresse prüfen.", "schnittstelle");
  if (status === 408 || status === 504 || status === 524) return info("zeit", "Der Empfänger hat nicht rechtzeitig geantwortet.", "Meist nur vorübergehend. Später noch einmal ausliefern.", "warten");
  if (status === 413 || status === 414 || status === 431) return info("abgelehnt", "Zu viele Daten für den Empfänger.", "Ein Feld ist zu lang (zum Beispiel eine Notiz). Kürzen und noch einmal ausliefern.", "lead");
  if (status === 429) return info("limit", "Zu viele Anfragen in kurzer Zeit.", "Der Empfänger bremst. Etwas warten und noch einmal ausliefern.", "warten");
  if (status >= 500) return info("stoerung", "Beim Empfänger gibt es gerade eine Störung.", "Das liegt nicht am Lead. Später noch einmal ausliefern – bleibt es so, den Empfänger informieren.", "warten");
  if (status >= 300 && status < 400) return info("adresse", "Die Adresse der Schnittstelle leitet weiter.", "Bitte beim Käufer unter „Integration“ die neue Adresse eintragen.", "schnittstelle");
  if (status >= 200 && status < 300) return refused() ?? info("abgelehnt", "Der Empfänger hat geantwortet, den Lead aber nicht angenommen.", "In der Antwort des Empfängers steht der Grund.", "lead");
  return info("unbekannt", "Die Übergabe ist fehlgeschlagen.", "Antwort des Empfängers ansehen und danach noch einmal ausliefern.", "warten");
}

/** Kein Käufer hat den Lead genommen oder es gibt keine passende Lieferkette – aus dem Vermerk im Lead-Log. */
export function explainNoBuyer(note: string | null | undefined): ApiErrorInfo {
  const text = String(note ?? "");
  const info = (kind: ApiErrorKind, title: string, advice: string): ApiErrorInfo => ({ kind, title, advice, fix: "lieferkette", field: null });
  if (/keine aktive lieferkette/i.test(text)) return /\(/.test(text)
    ? info("kein_abnehmer", "Keine Lieferkette kann den Lead gerade annehmen.", "Darunter steht je Kette der Grund. Kette anpassen – dann noch einmal ausliefern.")
    : info("einrichtung", "Für diese Kategorie gibt es keine aktive Lieferkette.", "Unter „Lieferkette“ eine Kette für die Kategorie anlegen und einschalten – dann noch einmal ausliefern.");
  if (/aufgegeben/i.test(text)) return info("kein_abnehmer", "Nach mehreren Versuchen aufgegeben.", "Die Bestellung hat den Lead mehrmals nicht angenommen. Gründe prüfen, dann noch einmal ausliefern.");
  if (/zugeordnete (?:lieferkette|bestellung)/i.test(text)) return info("kein_abnehmer", "Die zugeordnete Kette kann den Lead gerade nicht annehmen.", "Der Grund steht darunter. Zuordnung ändern oder die Kette anpassen – dann noch einmal ausliefern.");
  return info("kein_abnehmer", "Kein Käufer hat den Lead genommen.", "Darunter steht je Käufer der Grund. Lieferkette anpassen oder den Lead korrigieren – dann noch einmal ausliefern.");
}

/** Text an „; “ trennen – aber nicht innerhalb von Klammern (dort stehen oft mehrere Antworten eines Empfängers). */
function splitOutsideBrackets(value: string): string[] {
  const out: string[] = []; let depth = 0; let current = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(" || char === "{" || char === "[") depth += 1; else if ((char === ")" || char === "}" || char === "]") && depth > 0) depth -= 1;
    if (char === ";" && depth === 0 && value[index + 1] === " ") { out.push(current); current = ""; index += 1; continue; }
    current += char;
  }
  out.push(current);
  return out.map((part) => part.trim()).filter(Boolean);
}

/**
 * Grund, warum ein Käufer oder eine Kette den Lead nicht genommen hat, in einfachen Worten.
 * Die Pipeline schreibt kurze Stichworte ins Protokoll („Geo-Targeting: PLZ passt nicht“) – hier werden daraus ganze Sätze.
 */
export function plainReason(reason: string): string {
  const text = reason.trim();
  const api = /hat abgelehnt \(HTTP ([\d–-]+)(?::\s*([\s\S]*))?\)$/.exec(text);
  if (api) { const status = Number(api[1]); const info = explainApiError({ status: Number.isFinite(status) ? status : null, body: api[2] ?? "" }); return `${info.title.replace(/\.$/, "")}${Number.isFinite(status) ? ` (Antwort ${status})` : ""}`; }
  const rules: Array<[RegExp, string | ((match: RegExpExecArray) => string)]> = [
    [/^Geo-Targeting: PLZ passt nicht/i, "Die PLZ liegt nicht in seinem Gebiet"],
    [/^Geo-Targeting: Bundesland passt nicht/i, "Das Bundesland gehört nicht zu seinem Gebiet"],
    [/^Geo-Targeting: nur (\S+)/i, (match) => `Er nimmt nur Leads aus ${match[1]}`],
    [/^Maximale Leads für diesen Käufer erreicht/i, "Seine Höchstzahl an Leads ist erreicht"],
    [/^Feld-Filter: (.+)$/i, (match) => `Das Feld „${match[1]}“ passt nicht zu seinem Filter`],
    [/^Lieferant für diesen Stop ausgeschlossen/i, "Er nimmt keine Leads von diesem Lieferanten"],
    [/^Konflikt-Käufer/i, "Der Kontakt liegt schon bei einem Käufer, den er ausschließt"],
    [/^Automation-Duplikat/i, "Er nimmt keine Leads, die eine Regel kopiert hat"],
    [/^Telefonfilter: Nummer ungültig/i, "Die Rufnummer ist ungültig"],
    [/^Telefonfilter: Nummer nicht bestätigt/i, "Die Rufnummer ist nicht als gültig bestätigt"],
    [/^Lead zu alt/i, "Der Lead ist ihm zu alt"],
    [/^Dublette(?:nschutz)?\b/i, "Er hat diesen Kontakt schon bekommen"],
    [/^Lieferkette hat keinen aktiven Stop/i, "Die Kette hat keinen eingeschalteten Kunden"],
    [/^Kette nur für Land (\S+)/i, (match) => `Die Kette nimmt nur Leads aus ${match[1]}`],
    [/^Lieferant nicht in dieser Kette freigegeben|^Lieferant für diese Kette ausgeschlossen/i, "Die Kette nimmt keine Leads von diesem Lieferanten"],
    [/^Maximale Leads insgesamt erreicht/i, "Die Höchstzahl der Kette ist erreicht"],
    [/^Tageshöchstgrenze erreicht/i, "Die Tagesgrenze der Kette ist erreicht"],
    [/^Käufer-Zugang ist nicht aktiv/i, "Sein Zugang ist nicht eingeschaltet"],
    [/^Auslieferung für diesen Käufer pausiert/i, "Die Auslieferung an ihn ist pausiert"],
    [/^Käufer ist gesperrt/i, "Er ist gesperrt"],
    [/^Lead-Kategorie für diesen Käufer deaktiviert/i, "Diese Kategorie ist für ihn ausgeschaltet"],
    [/^(?:abgelehnt|nicht verfügbar)$/i, "Hat den Lead nicht genommen"],
    [/^übersprungen$/i, "Wurde übersprungen"],
    [/^kein passender Stop$/i, "Kein Kunde der Kette passt zu diesem Lead"],
  ];
  for (const [pattern, plain] of rules) { const match = pattern.exec(text); if (match) return typeof plain === "string" ? plain : plain(match); }
  return text;
}

/** Gründe je Käufer oder Kette aus einem Vermerk wie „Auslieferung ohne Abnehmer: Käufer A: Grund; Käufer B: Grund“ – in einfachen Worten. */
export function noBuyerReasons(note: string | null | undefined): Array<{ who: string; why: string }> {
  let rest = String(note ?? "").trim().replace(/^(?:Auslieferung ohne Abnehmer|Auslieferung nicht möglich|Auslieferung offen|Auslieferung abgelehnt)\s*:\s*/i, "");
  const wrapped = /^(?:Keine aktive Lieferkette|Die zugeordnete)[^(]*\(([\s\S]*)\)\.?$/i.exec(rest);
  if (wrapped) rest = wrapped[1];
  else if (/^(?:Keine aktive Lieferkette|Die zugeordnete|Auslieferung an Bestellung)/i.test(rest)) return [];
  return splitOutsideBrackets(rest).slice(0, 12).map((part) => {
    const [who, why] = splitWhoWhy(part);
    return { who, why: plainReason(why) };
  });
}

/** So beginnt ein Grund im Protokoll der Auslieferung – daran wird erkannt, wo der Name (Käufer oder Kette) endet. */
const REASON_START = /^(?:Geo-Targeting|Maximale Leads|Feld-Filter|Lieferant |Konflikt-Käufer|Automation-Duplikat|Telefonfilter|Lead zu alt|Dublette|Lieferkette hat|Kette nur|Tageshöchstgrenze|Käufer-Zugang|Auslieferung für|Käufer ist|Lead-Kategorie für|Bestellung \S+ ist|abgelehnt|übersprungen|angeboten|angenommen|nicht verfügbar|kein passender|API-Calls? \(|.{1,80} hat abgelehnt \(HTTP)/i;
/**
 * „Name: Grund“ trennen. Der Name einer Kette enthält oft selbst einen Doppelpunkt („Photovoltaik: OnDialer → Solar Nord“), ein Grund auch
 * („Geo-Targeting: PLZ passt nicht“) – getrennt wird deshalb dort, wo dahinter ein bekannter Grund beginnt; sonst am ersten Doppelpunkt.
 */
function splitWhoWhy(part: string): [string, string] {
  let depth = 0; let first = -1;
  for (let index = 0; index < part.length - 1; index += 1) {
    const char = part[index];
    if (char === "(" || char === "{" || char === "[") depth += 1; else if ((char === ")" || char === "}" || char === "]") && depth > 0) depth -= 1;
    if (char !== ":" || part[index + 1] !== " " || depth !== 0 || index === 0) continue;
    if (first < 0) first = index;
    if (REASON_START.test(part.slice(index + 2))) return [part.slice(0, index).trim(), part.slice(index + 2).trim()];
  }
  return first > 0 && first < 80 ? [part.slice(0, first).trim(), part.slice(first + 2).trim()] : ["", part.trim()];
}

/* ------------------------------------------------------------------ Angaben des Leads prüfen */

/** Warum ist diese E-Mail-Adresse nicht gültig? `null` = sie ist in Ordnung. Geprüft wird die Form, nicht ob es das Postfach gibt. */
export function emailProblem(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/\s/.test(text)) return "Die Adresse enthält ein Leerzeichen.";
  const parts = text.split("@");
  if (parts.length < 2) return "Es fehlt das @-Zeichen.";
  if (parts.length > 2) return "Die Adresse enthält mehr als ein @-Zeichen.";
  const [local, domain] = parts;
  if (!local) return "Vor dem @ fehlt der Name.";
  if (!domain) return "Nach dem @ fehlt die Adresse des Anbieters (zum Beispiel gmx.de).";
  if (domain.startsWith(".")) return "Nach dem @ fehlt der Name des Anbieters (zum Beispiel gmx.de).";
  if (!domain.includes(".")) return "Nach dem @ fehlt die Endung (zum Beispiel .de).";
  if (domain.endsWith(".")) return "Die Adresse endet mit einem Punkt.";
  if (text.includes("..")) return "In der Adresse stehen zwei Punkte hintereinander.";
  if (local.startsWith(".") || local.endsWith(".")) return "Vor dem @ steht ein Punkt an der falschen Stelle.";
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return "Vor dem @ steht ein Zeichen, das nicht erlaubt ist.";
  if (!/^[a-z0-9.-]+$/i.test(domain) || domain.split(".").some((label) => !label || label.startsWith("-") || label.endsWith("-"))) return "Nach dem @ steht ein Zeichen, das nicht erlaubt ist.";
  if (!/^[a-z]{2,24}$/i.test(domain.slice(domain.lastIndexOf(".") + 1))) return "Die Endung nach dem letzten Punkt stimmt nicht (zum Beispiel .de oder .com).";
  return null;
}
export const isValidEmail = (value: string | null | undefined): boolean => Boolean(String(value ?? "").trim()) && emailProblem(value) === null;

const DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmal.com": "gmail.com", "gmail.con": "gmail.com", "gmail.co": "gmail.com", "gmail.de": "gmail.com", "googlemail.con": "googlemail.com",
  "gmx.d": "gmx.de", "gmx.dee": "gmx.de", "gmx.con": "gmx.com", "web.d": "web.de", "web.dee": "web.de", "wep.de": "web.de", "t-online.d": "t-online.de", "t-onlin.de": "t-online.de", "tonline.de": "t-online.de",
  "hotmial.com": "hotmail.com", "hotmail.con": "hotmail.com", "hotmai.com": "hotmail.com", "outlok.com": "outlook.com", "outlook.con": "outlook.com", "yahoo.con": "yahoo.com", "yaho.de": "yahoo.de", "icloud.con": "icloud.com", "freenet.d": "freenet.de",
};
/** Vorschlag für eine offensichtlich vertippte Adresse (Komma statt Punkt, Leerzeichen, bekannte Dreher im Anbieter) – oder `null`. */
export function suggestEmail(value: string | null | undefined): string | null {
  const original = String(value ?? "").trim();
  if (!original) return null;
  let text = original.replace(/\s+/g, "").replace(/,/g, ".").replace(/\.{2,}/g, ".").replace(/@{2,}/g, "@").replace(/\.+$/, "").replace(/\(at\)|\[at\]/gi, "@");
  const at = text.lastIndexOf("@");
  if (at > 0) { const domain = text.slice(at + 1).toLowerCase(); text = `${text.slice(0, at)}@${DOMAIN_TYPOS[domain] ?? domain}`; }
  return text !== original && emailProblem(text) === null ? text : null;
}

/** Warum ist diese Rufnummer nicht brauchbar? `null` = in Ordnung. */
export function phoneProblem(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/[a-zäöüß]/i.test(text)) return "Die Rufnummer enthält Buchstaben.";
  const digits = text.replace(/\D/g, "");
  if (digits.length < 7) return "Die Rufnummer ist zu kurz.";
  if (digits.length > 15) return "Die Rufnummer ist zu lang.";
  if (/^(\d)\1+$/.test(digits.replace(/^(?:00)?49|^0/, ""))) return "Die Rufnummer besteht nur aus derselben Ziffer.";
  return null;
}

/** Vorschlag für eine PLZ, die nicht passt: „9633“ in Deutschland → „09633“ (die führende Null ging verloren). Sonst null. */
export function postcodeSuggestion(value: string | null | undefined, country: string | null | undefined): string | null {
  const fixed = normalizePostcode(value, country); return fixed && fixed !== String(value ?? "").trim() && !postcodeProblem(fixed, country) ? fixed : null;
}

/** Passt die PLZ zum Land? Geprüft werden Deutschland (5 Ziffern), Österreich und Schweiz (4 Ziffern). */
export function postcodeProblem(value: string | null | undefined, country: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const land = String(country ?? "DE").toUpperCase();
  if (land === "DE" && !/^\d{5}$/.test(text)) return "Eine deutsche PLZ hat 5 Ziffern.";
  if (land === "AT" && !/^\d{4}$/.test(text)) return "Eine PLZ in Österreich hat 4 Ziffern.";
  if (land === "CH" && !/^\d{4}$/.test(text)) return "Eine PLZ in der Schweiz hat 4 Ziffern.";
  return null;
}

export type LeadContact = { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null; postcode?: string | null; city?: string | null; country?: string | null; street?: string | null };
export type LeadDataProblem = { field: LeadContactField; title: string; hint: string; suggestion?: string | null };

/** Was an den Angaben eines Leads würde ein Empfänger sehr wahrscheinlich ablehnen? */
export function leadDataProblems(lead: LeadContact): LeadDataProblem[] {
  const out: LeadDataProblem[] = [];
  const email = isPlaceholder(lead.email) ? "" : String(lead.email ?? "").trim(); const phone = isPlaceholder(lead.phone) ? "" : String(lead.phone ?? "").trim();
  const mail = emailProblem(email); if (mail) out.push({ field: "email", title: "Die E-Mail-Adresse ist nicht gültig.", hint: mail, suggestion: suggestEmail(email) });
  const tel = phoneProblem(phone); if (tel) out.push({ field: "phone", title: "Die Rufnummer ist nicht brauchbar.", hint: tel });
  if (!email && !phone) out.push({ field: "phone", title: "Weder Rufnummer noch E-Mail-Adresse.", hint: "Ohne Kontaktweg kann kein Käufer den Kunden erreichen." });
  const plz = postcodeProblem(isPlaceholder(lead.postcode) ? "" : lead.postcode, lead.country); if (plz) out.push({ field: "postcode", title: "Die PLZ passt nicht.", suggestion: postcodeSuggestion(lead.postcode, lead.country), hint: plz });
  return out;
}

/* ------------------------------------------------------------------ Übersicht */

export type ApiLeadRow = { id: number; publicId: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; postcode: string | null; city: string | null; country: string | null; status: string; categoryId: number; supplierName: string | null; metadata: unknown; createdAt: Date | string };
/** Ein Versuch, einen Lead an eine Schnittstelle zu übergeben (oder eine Probe der Erreichbarkeit: reference „healthcheck“). */
export type ApiEventRow = { id: number; leadId: number | null; integrationId: number | null; endpointId: number | null; eventType: string; responseStatus: number | null; responseBody: string | null; externalReference: string | null; occurredAt: Date | string };
export type ApiDeliveryRow = { leadId: number; buyerName: string; result: string; occurredAt: Date | string };
/** Vermerk „ohne Abnehmer“ / „nicht möglich“ aus dem Lead-Log oder aus dem Protokoll der Regeln. */
export type ApiNoteRow = { leadId: number; note: string; occurredAt: Date | string };
export type ApiEndpointRow = { id: number; url: string; enabled: boolean; buyerName: string; categoryName: string | null; membershipId: number | null };
export type ApiIntegrationRow = { id: number; name: string; status: string; callbackUrl: string | null };

export type ApiProblemReason = { at: string; kind: ApiErrorKind; title: string; target: string | null; httpStatus: number | null; detail: string | null; parts: Array<{ who: string; why: string }> };
export type ApiProblem = {
  leadId: number; publicId: string; name: string; categoryName: string; status: string; supplierName: string | null;
  kind: ApiErrorKind; title: string; advice: string; fix: ApiFix; field: LeadContactField | null;
  target: string | null; targetLink: { kind: "kaeufer"; membershipId: number } | { kind: "integration" } | null;
  httpStatus: number | null; detail: string | null; occurredAt: string; attempts: number;
  /** Grund je Käufer oder Kette aus dem letzten Vermerk „ohne Abnehmer“ (leer, wenn es keinen gibt) */
  parts: Array<{ who: string; why: string }>;
  reasons: ApiProblemReason[]; dataProblems: LeadDataProblem[];
  lead: { firstName: string; lastName: string; email: string; phone: string; street: string; postcode: string; city: string; country: string };
};
export type ApiResolved = { leadId: number; publicId: string; name: string; categoryName: string; title: string; failedAt: string; solvedAt: string; buyerName: string | null };
export type ApiHealthState = "gut" | "warnung" | "gestoert" | "unbekannt";
export type ApiHealthRow = {
  key: string; kind: "kaeufer" | "partner" | "rueckgabe"; name: string; detail: string | null; host: string | null; active: boolean; membershipId: number | null;
  /** `failed` = alles, was nicht ankam; davon `refused` = Absagen wegen der Angaben des Leads (die Schnittstelle selbst lief) */
  state: ApiHealthState; stateText: string; sent: number; failed: number; refused: number; rate: number | null;
  lastOkAt: string | null; lastErrorAt: string | null; lastError: { title: string; httpStatus: number | null } | null; lastCheck: { at: string; ok: boolean; text: string } | null;
};
export type ApiErrorOverview = {
  checkedAt: string; days: number;
  counts: { open: number; daten: number; empfaenger: number; keinAbnehmer: number; schnittstellenGestoert: number; byKind: Partial<Record<ApiErrorKind, number>> };
  problems: ApiProblem[]; resolved: ApiResolved[]; health: ApiHealthRow[];
};

const iso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const time = (value: Date | string): number => (value instanceof Date ? value : new Date(value)).getTime();
const metaOf = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const text = (value: unknown): string => (typeof value === "string" && !isPlaceholder(value) ? value.trim() : "");
export const hostOf = (url: string | null | undefined): string | null => { try { return url ? new URL(url).host : null; } catch { return url ? String(url).replace(/^https?:\/\//, "").split("/")[0].slice(0, 80) : null; } };
const short = (value: string | null | undefined, max = 600): string | null => { const out = String(value ?? "").replace(/\s+/g, " ").trim(); return out ? out.slice(0, max) : null; };

export const HEALTH_CHECK = "healthcheck";
export const isHealthCheck = (event: Pick<ApiEventRow, "externalReference">): boolean => event.externalReference === HEALTH_CHECK;
export const isSupplierReturn = (event: Pick<ApiEventRow, "externalReference">): boolean => String(event.externalReference ?? "").startsWith("Rückgabe/");
const isOk = (event: Pick<ApiEventRow, "eventType">): boolean => event.eventType !== "abgelehnt" && event.eventType !== "storniert";
/** Status, in denen ein Lead gerade bei keinem Käufer liegt und noch rausgehen könnte. */
export const OPEN_LEAD_STATUS = new Set(["neu", "genehmigt", "hängend", "reklamiert", "fehlerhaft"]);
/** Status, bei denen die Angaben schon vor dem Ausliefern geprüft werden. */
export const PRECHECK_STATUS = new Set(["neu", "genehmigt", "hängend"]);
/** Vermerke im Lead-Log, die ein Problem beim Ausliefern festhalten. */
export const NO_BUYER_NOTE = /^(?:Auslieferung ohne Abnehmer:|Auslieferung nicht möglich:|Auslieferung an Bestellung .{1,60} aufgegeben)/;
export const NOT_POSSIBLE_PREFIX = "Auslieferung nicht möglich: ";
/** So lange kann ein Durchlauf der Auslieferung höchstens dauern (mehrere Käufer nacheinander, jeder mit Wartezeit). */
const RUN_SPAN = 180_000;
/** Zeitstempel kommen teils von der Datenbank (volle Sekunde), teils vom Server (gerundet) – eine Sekunde Spiel. */
const JITTER = 1_000;
/** Kam `a` nach `b`? Bei gleicher Sekunde entscheidet die Reihenfolge der Einträge. */
const later = (a: Pick<ApiEventRow, "id" | "occurredAt">, b: Pick<ApiEventRow, "id" | "occurredAt">): boolean => time(a.occurredAt) > time(b.occurredAt) || (time(a.occurredAt) === time(b.occurredAt) && a.id > b.id);

/** Absagen, die am Lead liegen (falsche Angabe, nicht gewünscht, schon bekannt) – die Schnittstelle selbst hat dabei geantwortet und funktioniert. */
const LEAD_KINDS = new Set<ApiErrorKind>(["daten", "abgelehnt", "dublette"]);

/**
 * Zustand einer Schnittstelle. Maßgeblich sind Fehler der Schnittstelle selbst (kein Zugang, falsche Adresse, Störung, keine Antwort).
 * Lehnt der Empfänger einen Lead wegen seiner Angaben ab, ist die Schnittstelle erreichbar – das steht bei den Leads, nicht hier als Störung.
 */
function healthState(counts: { sent: number; faults: number; refused: number; arrived: number; faultLatest: boolean; lastArrived: boolean }, lastCheck: { at: number; ok: boolean } | null): { state: ApiHealthState; text: string } {
  const { sent, faults, refused, arrived, faultLatest, lastArrived } = counts;
  if (!sent) {
    if (lastCheck) return lastCheck.ok ? { state: "gut", text: "Erreichbar – noch keine Übergabe im Zeitraum" } : { state: "gestoert", text: "Bei der letzten Probe nicht erreichbar" };
    return { state: "unbekannt", text: "Noch keine Übergabe im Zeitraum" };
  }
  if (!faults && !refused) return { state: "gut", text: "Alle Übergaben angekommen" };
  if (faults) {
    if (faults === sent || (faultLatest && faults >= 3 && faults / sent >= 0.5)) return { state: "gestoert", text: arrived || refused ? "Die letzten Übergaben sind fehlgeschlagen" : "Keine Übergabe ist angekommen" };
    if (faultLatest) return { state: "warnung", text: "Die letzte Übergabe ist fehlgeschlagen" };
    return faults / sent >= 0.2 ? { state: "warnung", text: lastArrived ? "Viele Übergaben fehlgeschlagen – die letzte kam an" : "Viele Übergaben fehlgeschlagen – zuletzt hat der Empfänger wieder geantwortet" } : { state: "gut", text: "Läuft – einzelne Übergaben fehlgeschlagen" };
  }
  // nur Absagen wegen der Leads: Lehnt der Empfänger (fast) alles ab, stimmt meist die Zuordnung der Felder nicht
  if (refused >= 3 && refused / sent >= 0.5) return { state: "warnung", text: arrived ? "Erreichbar – der Empfänger lehnt viele Leads ab" : "Erreichbar – der Empfänger lehnt jeden Lead ab" };
  return { state: "gut", text: refused === 1 ? "Erreichbar – ein Lead wurde abgelehnt" : `Erreichbar – ${refused} Leads wurden abgelehnt` };
}

/**
 * Übersicht „API-Fehler“ aus rohen Zeilen.
 *  - `leads`: alle Leads, die in Ereignissen/Vermerken vorkommen, dazu die noch nicht ausgelieferten (für die Prüfung der Angaben)
 *  - `events`: Übergaben und Proben im Zeitraum · `deliveries`: Zustellungen dieser Leads · `notes`: Vermerke „ohne Abnehmer“/„nicht möglich“
 */
export function buildApiErrorOverview(input: {
  now: Date; days: number; leads: ApiLeadRow[]; events: ApiEventRow[]; deliveries: ApiDeliveryRow[]; notes: ApiNoteRow[];
  endpoints: ApiEndpointRow[]; integrations: ApiIntegrationRow[]; categories: Array<{ id: number; name: string }>;
}): ApiErrorOverview {
  const { now } = input; const since = now.getTime() - input.days * 86_400_000;
  const categoryName = new Map(input.categories.map((row) => [row.id, row.name]));
  const endpointById = new Map(input.endpoints.map((row) => [row.id, row])); const integrationById = new Map(input.integrations.map((row) => [row.id, row]));
  const targetOf = (event: ApiEventRow): { name: string | null; link: ApiProblem["targetLink"] } => {
    if (event.endpointId) { const endpoint = endpointById.get(event.endpointId); return { name: endpoint ? endpoint.buyerName : "Schnittstelle des Käufers", link: endpoint?.membershipId ? { kind: "kaeufer", membershipId: endpoint.membershipId } : null }; }
    if (event.integrationId) return { name: integrationById.get(event.integrationId)?.name ?? "Partner-Schnittstelle", link: { kind: "integration" } };
    if (isSupplierReturn(event)) return { name: "Rückmeldung an den Lieferanten", link: null };
    return { name: null, link: null };
  };

  const eventsByLead = new Map<number, ApiEventRow[]>(); const notesByLead = new Map<number, ApiNoteRow[]>(); const deliveriesByLead = new Map<number, ApiDeliveryRow[]>();
  for (const event of input.events) if (event.leadId && !isHealthCheck(event) && !isSupplierReturn(event)) eventsByLead.set(event.leadId, [...(eventsByLead.get(event.leadId) ?? []), event]);
  for (const note of input.notes) notesByLead.set(note.leadId, [...(notesByLead.get(note.leadId) ?? []), note]);
  for (const delivery of input.deliveries) deliveriesByLead.set(delivery.leadId, [...(deliveriesByLead.get(delivery.leadId) ?? []), delivery]);

  const problems: ApiProblem[] = []; const resolved: ApiResolved[] = [];
  for (const lead of input.leads) {
    const meta = metaOf(lead.metadata);
    const dismissedAt = typeof meta.apiErrorsDismissedAt === "string" ? time(meta.apiErrorsDismissedAt) || 0 : 0;
    const events = (eventsByLead.get(lead.id) ?? []).slice().sort((a, b) => time(a.occurredAt) - time(b.occurredAt) || a.id - b.id);
    const deliveries = deliveriesByLead.get(lead.id) ?? [];
    const okDeliveries = deliveries.filter((row) => row.result === "angenommen" || row.result === "angeboten");
    // Für „kam der Lead danach noch an?“ zählt auch eine Zustellung, die später reklamiert wurde – sie war angekommen
    const handedOver = deliveries.filter((row) => row.result === "angenommen" || row.result === "angeboten" || row.result === "reklamiert");
    const okEvents = events.filter(isOk);
    const lastOkEvent = okEvents.reduce((latest, event) => Math.max(latest, time(event.occurredAt)), 0);
    const lastOk = Math.max(lastOkEvent, okDeliveries.reduce((latest, row) => Math.max(latest, time(row.occurredAt)), 0));
    const failures = events.filter((event) => !isOk(event) && time(event.occurredAt) >= since);
    const notes = (notesByLead.get(lead.id) ?? []).filter((note) => time(note.occurredAt) >= since).sort((a, b) => time(a.occurredAt) - time(b.occurredAt));
    const name = leadDisplayName(lead) || "Name unbekannt"; const category = categoryName.get(lead.categoryId) ?? "–";
    const open = OPEN_LEAD_STATUS.has(lead.status);
    const cutoff = Math.max(lastOk, dismissedAt);
    // Ein Durchlauf ohne Abnehmer endet immer mit einem Vermerk – der ist der sichere Anker
    const openNotes = notes.filter((note) => time(note.occurredAt) > cutoff);
    const inRun = (event: ApiEventRow, note: ApiNoteRow) => time(event.occurredAt) <= time(note.occurredAt) + JITTER && time(event.occurredAt) >= time(note.occurredAt) - RUN_SPAN;
    // Eine Absage zählt nicht, wenn der Lead danach doch noch ankam. Das passiert auch im selben Durchlauf: Ein Käufer lehnt ab, der nächste nimmt.
    // Erkennbar an einer späteren angekommenen Übergabe – oder an einer Zustellung, deren Durchlauf die Absage umfasst (oder die später kam).
    const passedOn = (event: ApiEventRow) => okEvents.some((ok) => later(ok, event)) || (!openNotes.some((note) => inRun(event, note)) && handedOver.some((row) => time(row.occurredAt) >= time(event.occurredAt) - RUN_SPAN));
    const openFailures = failures.filter((event) => time(event.occurredAt) > dismissedAt && !passedOn(event));
    const dataProblems = open ? leadDataProblems({ ...lead, street: text(meta.street) }) : [];

    if (!open || (!openFailures.length && !openNotes.length)) {
      // Früher gescheitert, inzwischen angekommen → „gelöst“ (zeigt, dass die Korrektur gewirkt hat). Gemeint ist ein eigener, gescheiterter
      // Durchlauf – nicht ein Käufer, der ablehnte, kurz bevor der nächste im selben Durchlauf nahm.
      const failedRun = lastOk >= since ? notes.filter((note) => time(note.occurredAt) < lastOk).pop() : undefined;
      const failedBefore = lastOk >= since ? (failedRun ? failures.filter((event) => inRun(event, failedRun)).pop() : failures.filter((event) => time(event.occurredAt) < lastOk - RUN_SPAN).pop()) : undefined;
      if (failedRun || failedBefore) {
        const buyer = okDeliveries.slice().sort((a, b) => time(b.occurredAt) - time(a.occurredAt))[0]?.buyerName ?? null;
        const title = failedBefore ? explainApiError({ status: failedBefore.responseStatus, body: failedBefore.responseBody }).title : explainNoBuyer(failedRun!.note).title;
        resolved.push({ leadId: lead.id, publicId: lead.publicId, name, categoryName: category, title, failedAt: iso((failedBefore ?? failedRun!).occurredAt), solvedAt: new Date(lastOk).toISOString(), buyerName: buyer });
      }
      // Noch nicht ausgeliefert, aber die Angaben stimmen nicht → vorab melden (einmal abgehakt bleibt abgehakt)
      if (!(PRECHECK_STATUS.has(lead.status) && dataProblems.length && !dismissedAt)) continue;
    }

    const reasons: ApiProblemReason[] = [
      ...openFailures.map((event) => { const info = explainApiError({ status: event.responseStatus, body: event.responseBody }); return { at: iso(event.occurredAt), kind: info.kind, title: info.title, target: targetOf(event).name, httpStatus: event.responseStatus ?? null, detail: short(event.responseBody), parts: [] as Array<{ who: string; why: string }> }; }),
      ...openNotes.map((note) => { const info = explainNoBuyer(note.note); return { at: iso(note.occurredAt), kind: info.kind, title: info.title, target: null, httpStatus: null, detail: null, parts: noBuyerReasons(note.note) }; }),
    ].sort((a, b) => time(b.at) - time(a.at));
    const lastFailure = openFailures[openFailures.length - 1]; const lastNote = openNotes[openNotes.length - 1];
    // Die Antwort eines Empfängers sagt mehr als der Sammelvermerk „ohne Abnehmer“ – sie führt, wenn es eine gibt
    let info: ApiErrorInfo; let occurredAt: string; let target: ReturnType<typeof targetOf> = { name: null, link: null }; let httpStatus: number | null = null; let detail: string | null = null;
    if (lastFailure) { info = explainApiError({ status: lastFailure.responseStatus, body: lastFailure.responseBody }); occurredAt = iso(lastFailure.occurredAt); target = targetOf(lastFailure); httpStatus = lastFailure.responseStatus ?? null; detail = short(lastFailure.responseBody); }
    else if (lastNote) { info = explainNoBuyer(lastNote.note); occurredAt = iso(lastNote.occurredAt); }
    else { const first = dataProblems[0]; info = { kind: "daten", title: first.title, advice: "Vor dem Ausliefern korrigieren – sonst lehnt der Empfänger den Lead sehr wahrscheinlich ab.", fix: "lead", field: first.field }; occurredAt = iso(lead.createdAt); }
    // Stimmen die Angaben nicht, ist das fast immer der eigentliche Grund – dann zeigt die Zeile auf das Feld
    if (dataProblems.length && info.fix !== "schnittstelle" && info.kind !== "daten") info = { ...info, fix: "lead", field: info.field ?? dataProblems[0].field };
    if (info.kind === "daten" && !info.field && dataProblems.length) info = { ...info, field: dataProblems[0].field };
    problems.push({
      leadId: lead.id, publicId: lead.publicId, name, categoryName: category, status: lead.status, supplierName: lead.supplierName ?? null,
      kind: info.kind, title: info.title, advice: info.advice, fix: info.fix, field: info.field,
      target: target.name, targetLink: target.link, httpStatus, detail, occurredAt, attempts: openFailures.length || openNotes.length, parts: lastNote ? noBuyerReasons(lastNote.note) : [], reasons: reasons.slice(0, 8), dataProblems,
      lead: { firstName: text(lead.firstName), lastName: text(lead.lastName), email: String(lead.email ?? "").trim(), phone: String(lead.phone ?? "").trim(), street: text(meta.street), postcode: String(lead.postcode ?? "").trim(), city: text(lead.city), country: String(lead.country ?? "DE") },
    });
  }
  problems.sort((a, b) => time(b.occurredAt) - time(a.occurredAt)); resolved.sort((a, b) => time(b.solvedAt) - time(a.solvedAt));

  // Zustand je Schnittstelle: echte Übergaben im Zeitraum, dazu die letzte Probe der Erreichbarkeit
  const health: ApiHealthRow[] = [];
  const windowEvents = input.events.filter((event) => time(event.occurredAt) >= since);
  const measure = (rows: ApiEventRow[]) => {
    const real = rows.filter((event) => !isHealthCheck(event)); const checks = rows.filter(isHealthCheck).sort((a, b) => (later(a, b) ? -1 : 1));
    const failed = real.filter((event) => !isOk(event)); const ok = real.filter(isOk);
    // Absage wegen des Leads (die Schnittstelle hat geantwortet) oder Fehler der Schnittstelle selbst?
    const refused = failed.filter((event) => LEAD_KINDS.has(explainApiError({ status: event.responseStatus, body: event.responseBody }).kind)); const faults = failed.filter((event) => !refused.includes(event));
    const newest = (rows: ApiEventRow[]) => rows.reduce<ApiEventRow | null>((latest, event) => (!latest || later(event, latest) ? event : latest), null);
    const lastOkEvent = newest(ok); const lastFailEvent = newest(failed); const lastFault = newest(faults); const lastAlive = newest([...ok, ...refused]);
    const lastOk = lastOkEvent ? time(lastOkEvent.occurredAt) : 0; const lastFail = lastFailEvent ? time(lastFailEvent.occurredAt) : 0; const check = checks[0] ? { at: time(checks[0].occurredAt), ok: isOk(checks[0]) } : null;
    const state = healthState({ sent: real.length, faults: faults.length, refused: refused.length, arrived: ok.length, faultLatest: Boolean(lastFault && (!lastAlive || later(lastFault, lastAlive))), lastArrived: Boolean(lastAlive && isOk(lastAlive)) }, check);
    return {
      state: state.state, stateText: state.text, sent: real.length, failed: failed.length, refused: refused.length, rate: real.length ? Math.round((ok.length / real.length) * 100) : null,
      lastOkAt: lastOk ? new Date(lastOk).toISOString() : null, lastErrorAt: lastFail ? new Date(lastFail).toISOString() : null,
      lastError: lastFailEvent ? { title: explainApiError({ status: lastFailEvent.responseStatus, body: lastFailEvent.responseBody }).title, httpStatus: lastFailEvent.responseStatus ?? null } : null,
      lastCheck: checks[0] ? { at: iso(checks[0].occurredAt), ok: isOk(checks[0]), text: short(checks[0].responseBody, 200) ?? (isOk(checks[0]) ? "Erreichbar" : "Nicht erreichbar") } : null,
    };
  };
  for (const endpoint of input.endpoints) {
    const rows = windowEvents.filter((event) => event.endpointId === endpoint.id);
    if (!endpoint.enabled && !rows.length) continue;
    health.push({ key: `e${endpoint.id}`, kind: "kaeufer", name: endpoint.buyerName, detail: endpoint.categoryName, host: hostOf(endpoint.url), active: endpoint.enabled, membershipId: endpoint.membershipId, ...measure(rows) });
  }
  for (const integration of input.integrations) {
    const rows = windowEvents.filter((event) => event.integrationId === integration.id);
    if (integration.status !== "aktiv" && !rows.length) continue;
    health.push({ key: `i${integration.id}`, kind: "partner", name: integration.name, detail: "Partner-Schnittstelle", host: hostOf(integration.callbackUrl), active: integration.status === "aktiv", membershipId: null, ...measure(rows) });
  }
  const returns = windowEvents.filter(isSupplierReturn);
  if (returns.length) health.push({ key: "rueckgabe", kind: "rueckgabe", name: "Rückmeldungen an Lieferanten", detail: "Wenn kein Käufer einen Lead nimmt", host: null, active: true, membershipId: null, ...measure(returns) });
  const order: Record<ApiHealthState, number> = { gestoert: 0, warnung: 1, gut: 2, unbekannt: 3 };
  health.sort((a, b) => order[a.state] - order[b.state] || b.sent - a.sent || a.name.localeCompare(b.name, "de"));

  const byKind: Partial<Record<ApiErrorKind, number>> = {}; for (const problem of problems) byKind[problem.kind] = (byKind[problem.kind] ?? 0) + 1;
  const noBuyer = (byKind.kein_abnehmer ?? 0) + (byKind.einrichtung ?? 0);
  return {
    checkedAt: now.toISOString(), days: input.days,
    counts: { open: problems.length, daten: byKind.daten ?? 0, keinAbnehmer: noBuyer, empfaenger: problems.length - (byKind.daten ?? 0) - noBuyer, schnittstellenGestoert: health.filter((row) => row.state === "gestoert").length, byKind },
    problems, resolved: resolved.slice(0, 20), health,
  };
}

/** Alle Arten von Fehlern mit Erklärung – das Nachschlage-Fenster auf der Seite. */
export const API_ERROR_GUIDE: Array<{ kind: ApiErrorKind; codes: string; what: string; todo: string }> = [
  { kind: "daten", codes: "400 · 422", what: "Eine Angabe des Leads passt dem Empfänger nicht – zum Beispiel eine falsche E-Mail-Adresse, eine zu kurze Rufnummer oder eine PLZ, die es nicht gibt.", todo: "Lead korrigieren und noch einmal ausliefern." },
  { kind: "abgelehnt", codes: "400 · 413 · 422", what: "Der Empfänger nimmt den Lead nicht an: Die PLZ liegt nicht in seinem Gebiet, der Kontakt steht auf seiner Sperrliste, sein Kontingent ist voll – oder er nennt kein bestimmtes Feld. Der Grund steht in seiner Antwort.", todo: "Antwort lesen. Liegt es am Gebiet oder am Kontingent: noch einmal ausliefern, dann geht der Lead an den nächsten Käufer." },
  { kind: "dublette", codes: "409", what: "Der Empfänger kennt den Kontakt schon.", todo: "An einen anderen Käufer ausliefern oder abhaken." },
  { kind: "zugang", codes: "401 · 402 · 403", what: "Schlüssel oder Passwort der Schnittstelle stimmen nicht (mehr) – oder das Konto beim Empfänger ist gesperrt.", todo: "Zugang beim Käufer unter „Integration“ neu eintragen." },
  { kind: "adresse", codes: "301 · 404 · 405 · 410", what: "Unter der hinterlegten Adresse nimmt der Empfänger nichts an – sie ist falsch geschrieben, umgezogen oder abgeschaltet.", todo: "Adresse beim Käufer unter „Integration“ prüfen." },
  { kind: "limit", codes: "429", what: "Der Empfänger bremst, weil zu viele Leads in kurzer Zeit kamen.", todo: "Etwas warten und noch einmal ausliefern." },
  { kind: "stoerung", codes: "500 · 502 · 503", what: "Beim Empfänger läuft gerade etwas nicht. Das liegt nicht am Lead.", todo: "Später noch einmal ausliefern; bleibt es so, den Empfänger informieren." },
  { kind: "zeit", codes: "408 · 504", what: "Der Empfänger hat nicht rechtzeitig geantwortet.", todo: "Später noch einmal ausliefern." },
  { kind: "verbindung", codes: "ohne Antwort", what: "Es kam gar keine Verbindung zustande – der Empfänger war nicht erreichbar oder sein Sicherheits-Zertifikat ist abgelaufen.", todo: "Später noch einmal ausliefern; bleibt es so, Adresse prüfen." },
  { kind: "einrichtung", codes: "ohne Antwort", what: "Es fehlt etwas in der Einrichtung: keine aktive Lieferkette für die Kategorie, keine Adresse oder kein Zugang bei der Schnittstelle.", todo: "Lieferkette oder Schnittstelle fertig einrichten." },
  { kind: "kein_abnehmer", codes: "–", what: "Kein Käufer der Lieferkette hat den Lead genommen – zum Beispiel wegen Gebiet, Tagesgrenze, Dubletten-Schutz oder weil alle abgelehnt haben.", todo: "Gründe je Käufer ansehen, Lieferkette anpassen oder Lead korrigieren." },
];
