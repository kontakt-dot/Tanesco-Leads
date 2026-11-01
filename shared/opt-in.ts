/**
 * Opt-in-Nachweis: die dokumentierte Einwilligung eines Interessenten (§ 7 Abs. 2 Nr. 1 und § 7a UWG, DSGVO) –
 *  - „formular“: Einwilligung aus dem Online-Formular (Meta Lead Ads) für unseren eigenen Anruf,
 *  - „sprache“: Voice-Opt-in im Gespräch – nur der Einwilligungsabschnitt wird aufgezeichnet (Zustimmung zur Aufnahme vorab,
 *    Datum/Uhrzeit/Name gesprochen, vollständiger Text, eindeutiges „Ja“, Widerrufshinweis) – für den Anruf des Fachbetriebs,
 *  - „sms“: Bestätigung per SMS-Link mit Firmennamen (wenn der Käufer im Gespräch noch nicht feststand oder keine Aufnahme möglich war).
 * Gemeinsam für Server, Chat-Demo und Oberfläche: Skript zum Vorlesen, Prüfung der Pflichtbestandteile, Status, Aufbewahrung (5 Jahre
 * ab Erteilung und nach jeder Verwendung neu).
 */
export type OptInKind = "formular" | "sprache" | "sms";
export type OptInStatus = "offen" | "gueltig" | "unvollstaendig" | "abgelehnt" | "widerrufen";
export type OptInGrantee = "eigen" | "kaeufer";
export const OPT_IN_KIND_LABEL: Record<OptInKind, string> = { formular: "Formular", sprache: "Sprachaufnahme", sms: "SMS-Bestätigung" };
export const OPT_IN_STATUS_LABEL: Record<OptInStatus, string> = { offen: "offen", gueltig: "gültig", unvollstaendig: "unvollständig", abgelehnt: "abgelehnt", widerrufen: "widerrufen" };
export const OPT_IN_GRANTEE_LABEL: Record<OptInGrantee, string> = { eigen: "für unseren Anruf", kaeufer: "für den Fachbetrieb" };
export const RETENTION_YEARS = 5;

/** Die sechs Pflichtbestandteile einer telefonischen Einwilligung – jeder muss in der Aufnahme zu hören sein. */
export type OptInChecks = { aufnahme: boolean; firma: boolean; zweck: boolean; kanaele: boolean; widerruf: boolean; ja: boolean; by: "agent" | "regeln" | "ki" | null };
export const CHECK_KEYS = ["aufnahme", "firma", "zweck", "kanaele", "widerruf", "ja"] as const;
export type CheckKey = (typeof CHECK_KEYS)[number];
export const CHECK_LABEL: Record<CheckKey, string> = { aufnahme: "Zustimmung zur Aufnahme", firma: "Fachbetrieb genannt", zweck: "Zweck (Anfrage und Weitergabe)", kanaele: "Kanäle (Telefon, E-Mail)", widerruf: "Widerrufshinweis", ja: "Eindeutiges „Ja“" };
export const EMPTY_CHECKS: OptInChecks = { aufnahme: false, firma: false, zweck: false, kanaele: false, widerruf: false, ja: false, by: null };
export const missingOf = (checks: OptInChecks | null | undefined): string[] => CHECK_KEYS.filter((key) => !checks?.[key]).map((key) => CHECK_LABEL[key]);
export const allChecked = (checks: OptInChecks | null | undefined): boolean => CHECK_KEYS.every((key) => Boolean(checks?.[key]));

/* ---------------------------------------------------------------- Einstellungen (Firma, Texte) */
export type OptInSettings = {
  companyName: string;      // wer die Einwilligung einholt (wir)
  companyAddress: string;
  revokeEmail: string;      // wohin der Widerruf geht
  privacyUrl: string;
  channels: string;         // „telefonisch und per E-Mail“
  consentTemplate: string;  // Schritt 2 – mit Platzhaltern
  smsTemplate: string;      // SMS-Bestätigung – mit Platzhaltern
  autoSms: boolean;         // nach der Zuteilung automatisch eine SMS-Bestätigung schicken, wenn der Käufer im Gespräch nicht genannt war
};
export const FALLBACK_BUYER = "einen Fachbetrieb aus Ihrer Region, dessen Namen wir Ihnen per SMS mitteilen";
export const DEFAULT_CONSENT_TEMPLATE = "Heute ist der {{datum}}, {{uhrzeit}} Uhr. Ich spreche mit {{name}}, Telefonnummer {{telefon}}. Sie haben eine Anfrage zum Thema {{kategorie}} gestellt{{ort}}. Sind Sie damit einverstanden, dass {{firma}} Ihren Namen, Ihre Adresse, Ihre Telefonnummer und Ihre Angaben zur Anfrage an {{kaeufer}} weitergibt und dieser Betrieb Sie dazu {{kanaele}} kontaktiert?";
export const DEFAULT_SMS_TEMPLATE = "{{firma}}: Hallo {{vorname}}, bitte bestätigen Sie mit einem Klick, dass {{kaeufer}} Sie zu Ihrer Anfrage ({{kategorie}}) telefonisch und per E-Mail kontaktieren darf: {{link}} – Widerruf jederzeit möglich.";
export const DEFAULT_OPT_IN_SETTINGS: OptInSettings = { companyName: "", companyAddress: "", revokeEmail: "", privacyUrl: "", channels: "telefonisch und per E-Mail", consentTemplate: DEFAULT_CONSENT_TEMPLATE, smsTemplate: DEFAULT_SMS_TEMPLATE, autoSms: false };
export const OPT_IN_PLACEHOLDERS: Array<[string, string]> = [["{{datum}}", "Datum"], ["{{uhrzeit}}", "Uhrzeit"], ["{{name}}", "Name des Kunden"], ["{{vorname}}", "Vorname"], ["{{telefon}}", "Telefonnummer"], ["{{ort}}", "„ für Ihr Haus in <Ort>“"], ["{{kategorie}}", "Lead-Kategorie"], ["{{firma}}", "unsere Firma"], ["{{kaeufer}}", "Fachbetrieb (Name, Ort)"], ["{{kanaele}}", "Kanäle"], ["{{link}}", "Bestätigungslink (nur SMS)"]];
export function normalizeOptInSettings(input: unknown): OptInSettings {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const text = (key: keyof OptInSettings, max: number, fallback: string) => { const value = raw[key]; return typeof value === "string" ? value.trim().slice(0, max) || fallback : fallback; };
  return { companyName: text("companyName", 160, ""), companyAddress: text("companyAddress", 240, ""), revokeEmail: text("revokeEmail", 320, ""), privacyUrl: text("privacyUrl", 400, ""), channels: text("channels", 120, DEFAULT_OPT_IN_SETTINGS.channels), consentTemplate: text("consentTemplate", 2000, DEFAULT_CONSENT_TEMPLATE), smsTemplate: text("smsTemplate", 600, DEFAULT_SMS_TEMPLATE), autoSms: raw.autoSms === true };
}

/* ---------------------------------------------------------------- Skript zum Vorlesen */
export type ScriptValues = { now: Date | string; name: string; firstName?: string | null; phone: string; city?: string | null; category: string; buyerName?: string | null; link?: string | null };
export type ScriptStep = { key: "aufnahme" | "einwilligung" | "abschluss"; title: string; text: string; expectYes: boolean; hint: string };
const dateDe = (value: Date | string) => new Date(value).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
const timeDe = (value: Date | string) => new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
export function scriptPlaceholders(settings: OptInSettings, values: ScriptValues): Record<string, string> {
  const firma = settings.companyName || "unsere Firma";
  return { datum: dateDe(values.now), uhrzeit: timeDe(values.now), name: values.name || "dem Interessenten", vorname: values.firstName?.trim() || values.name || "", telefon: values.phone || "–", ort: values.city ? ` für Ihr Haus in ${values.city}` : "", kategorie: values.category || "Ihre Anfrage", firma, kaeufer: values.buyerName?.trim() || FALLBACK_BUYER, kanaele: settings.channels || DEFAULT_OPT_IN_SETTINGS.channels, link: values.link ?? "" };
}
export const fillOptIn = (template: string, placeholders: Record<string, string>) => template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_match, key: string) => placeholders[key] ?? "");
/** Die drei Schritte: 1. Erlaubnis für die Aufnahme (noch ohne Aufnahme), 2. Einwilligung (auf der Aufnahme), 3. Widerruf, Speicherdauer, Datenschutz. */
export function consentScript(settings: OptInSettings, values: ScriptValues): { steps: ScriptStep[]; fullText: string; placeholders: Record<string, string> } {
  const placeholders = scriptPlaceholders(settings, values);
  const firma = placeholders.firma;
  const aufnahme = `${values.name ? `${values.name}, ` : ""}damit der Fachbetrieb Sie kontaktieren darf, halte ich Ihre Zustimmung jetzt kurz fest. Sind Sie einverstanden, dass ich die nächsten 30 Sekunden aufzeichne?`;
  const einwilligung = fillOptIn(settings.consentTemplate || DEFAULT_CONSENT_TEMPLATE, placeholders);
  const abschluss = `Diese Einwilligung können Sie jederzeit widerrufen${settings.revokeEmail ? `, zum Beispiel per E-Mail an ${settings.revokeEmail}` : ""}. Die Aufnahme bewahren wir ${RETENTION_YEARS} Jahre als Nachweis auf${settings.privacyUrl ? `, mehr dazu steht in unserer Datenschutzerklärung unter ${settings.privacyUrl}` : ", mehr dazu steht in unserer Datenschutzerklärung"}. Vielen Dank.`;
  const steps: ScriptStep[] = [
    { key: "aufnahme", title: "1. Erlaubnis für die Aufnahme", text: aufnahme, expectYes: true, hint: "Noch ohne Aufnahme vorlesen. Erst nach dem „Ja“ auf „Aufnahme starten“ klicken." },
    { key: "einwilligung", title: "2. Einwilligung (auf der Aufnahme)", text: einwilligung, expectYes: true, hint: "Satz für Satz vorlesen, nichts zusammenfassen. Das Ja muss ein Wort sein – kein „Mhm“. Am besten: „Sagen Sie bitte noch einmal mit Ihrem Namen, dass Sie einverstanden sind.“" },
    { key: "abschluss", title: "3. Abschluss (auf der Aufnahme)", text: abschluss, expectYes: false, hint: `Danach „Aufnahme beenden“. ${firma} nennt sich dabei nie „Beratungsstelle“ – wir sind der Anrufer.` },
  ];
  return { steps, fullText: steps.map((step) => step.text).join("\n\n"), placeholders };
}
export const smsText = (settings: OptInSettings, values: ScriptValues) => fillOptIn(settings.smsTemplate || DEFAULT_SMS_TEMPLATE, scriptPlaceholders(settings, values));

/* ---------------------------------------------------------------- Prüfung einer Abschrift nach Regeln (ohne KI) */
const normalize = (text: string) => text.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
/** Zählt eigenständige Zustimmungen („ja“, „einverstanden“, „ja, bin ich“) – Verneinungen wie „nein“ oder „nicht einverstanden“ zählen nicht. */
export function countYes(transcript: string): number {
  // Nur Antworten zählen: ein Ja am Satz- oder Zeilenanfang (nach . ? ! oder einem Sprecher wie „Kunde:“) – nicht das „einverstanden“ in der Frage des Agenten
  const text = normalize(transcript).replace(/nicht einverstanden|kein(e|en)? einverst\w*|nein,? ich bin nicht einverstanden/g, " ");
  const matches = text.match(/(^|[.?!\n]\s*)(?:[a-z]+\s*:\s*)?(ja|jawohl|einverstanden|ich bin einverstanden|bin einverstanden|ich stimme zu|stimme zu)(?=$|[^a-z])/g);
  return matches ? matches.length : 0;
}
/** Regelprüfung: Sind die Pflichtbestandteile in der Abschrift? `buyerName` = erwarteter Fachbetrieb (leer = Ersatzformulierung erlaubt). */
export function checkConsentText(transcript: string | null | undefined, expect: { buyerName?: string | null; companyName?: string | null }): OptInChecks {
  const raw = (transcript ?? "").trim(); if (!raw) return { ...EMPTY_CHECKS, by: "regeln" };
  const text = normalize(raw);
  const buyerWords = (expect.buyerName ?? "").split(/[\s,–-]+/).map((word) => normalize(word)).filter((word) => word.length >= 3 && !/^(gmbh|ag|kg|ug|ohg|und|aus|der|die|das|e\.v\.)$/.test(word));
  const firma = expect.buyerName ? buyerWords.some((word) => text.includes(word)) : /fachbetrieb|betrieb|firma|partner/.test(text);
  return {
    aufnahme: /aufzeichn|aufnehm|aufnahme|mitschn/.test(text),
    firma,
    zweck: /anfrage/.test(text) && /weiterg(a|e|i)b|weiterleit|uebermitt/.test(text),
    kanaele: /telefon/.test(text) && /e-?mail|mail/.test(text),
    widerruf: /widerruf|widerrufen|zuruecknehmen|jederzeit zurueck/.test(text),
    ja: countYes(raw) >= 2, // einmal für die Aufnahme, einmal für die Einwilligung
    by: "regeln",
  };
}
/** Die Stelle in der Abschrift, an der die Einwilligung erteilt wird (für den Nachweis zitiert): vom Beginn der Aufnahmefrage bis zum letzten Ja danach. */
export function consentQuote(transcript: string | null | undefined, maxLength = 900): string | null {
  const raw = (transcript ?? "").replace(/\s+/g, " ").trim(); if (!raw) return null;
  const lower = raw.toLowerCase(); // gleiche Länge wie `raw` (keine Umlaut-Ersetzung), damit die Positionen stimmen
  const hit = Math.max(0, lower.search(/damit der fachbetrieb|aufzeichn|aufnehm|einverstanden, dass|sind sie damit einverstanden/));
  const boundary = Math.max(lower.lastIndexOf(". ", hit), lower.lastIndexOf("? ", hit), lower.lastIndexOf("! ", hit)); const start = boundary >= 0 ? boundary + 2 : 0; // ab Satzanfang (mit Anrede/Name)
  const tail = lower.slice(start); const lastYes = Math.max(tail.lastIndexOf("einverstanden"), tail.lastIndexOf(" ja"), tail.lastIndexOf("vielen dank"));
  const end = lastYes > 0 ? Math.min(raw.length, start + lastYes + 40) : Math.min(raw.length, start + maxLength);
  const quote = raw.slice(start, end).trim();
  return quote.length > maxLength ? `${quote.slice(0, maxLength).trimEnd()} …` : quote || null;
}

/* ---------------------------------------------------------------- Aufbewahrung, Status */
export function retainUntil(givenAt: Date | string | null | undefined, lastUsedAt?: Date | string | null): Date | null {
  const base = lastUsedAt ?? givenAt; if (!base) return null;
  const date = new Date(base); date.setFullYear(date.getFullYear() + RETENTION_YEARS); return date;
}
/** Status aus Prüfung und Bestätigung: alles da → gültig, sonst unvollständig (offen, solange noch nichts geprüft/bestätigt ist). */
export function statusFromChecks(checks: OptInChecks | null | undefined): OptInStatus { return checks?.by ? (allChecked(checks) ? "gueltig" : "unvollstaendig") : "offen"; }
export type OptInUsage = { at: string; kind: "zustellung" | "angebot" | "export"; buyerName: string | null; buyerUserId: number | null; orderId: number | null };
/** Kurzzeile für Listen: „Sprachaufnahme · gültig · für Müller Solartechnik · 01.11.2026“. */
export function optInLine(optIn: { kind: OptInKind; status: OptInStatus; buyerName?: string | null; grantedTo: OptInGrantee; givenAt?: Date | string | null }): string {
  const who = optIn.grantedTo === "kaeufer" ? (optIn.buyerName ? `für ${optIn.buyerName}` : "für den Fachbetrieb") : "für unseren Anruf";
  return [OPT_IN_KIND_LABEL[optIn.kind], OPT_IN_STATUS_LABEL[optIn.status], who, optIn.givenAt ? new Date(optIn.givenAt).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" }) : null].filter(Boolean).join(" · ");
}
/** Prüfsummen-Grundlage: die unveränderlichen Angaben in fester Reihenfolge (Server rechnet SHA-256 darüber). */
export function canonicalOptIn(record: { number: string; leadId: number; kind: string; grantedTo: string; buyerName: string | null; consentText: string; givenAt: Date | string | null; collectedBy: string | null; quote: string | null; recordingUrl: string | null; confirmedAt: Date | string | null; source: unknown }): string {
  const at = (value: Date | string | null) => (value ? new Date(value).toISOString() : "");
  return JSON.stringify({ n: record.number, l: record.leadId, k: record.kind, g: record.grantedTo, b: record.buyerName ?? "", t: record.consentText, a: at(record.givenAt), c: record.collectedBy ?? "", q: record.quote ?? "", r: record.recordingUrl ?? "", f: at(record.confirmedAt), s: record.source ?? null });
}
/** Einfache Prüfsumme für den Chat-Build (im Browser ohne Krypto-Modul) – der Server nutzt SHA-256. */
export function fnvHash(text: string): string {
  let h1 = 0x811c9dc5; let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) { const code = text.charCodeAt(i); h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ code, 0x811c9dc5) >>> 0; }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}
export const newOptInNumber = (seq: number, now: Date = new Date()) => `OPT-${now.getFullYear()}-${String(seq).padStart(6, "0")}`;
