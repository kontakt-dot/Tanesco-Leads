/**
 * Leadsparte einer E-Mail-Kampagne: Worum geht es thematisch (Photovoltaik & Wärmepumpe, Hausnotruf, Elektrorollstuhl,
 * Alarmanlage …)? Die KI schreibt Vorlagen und E-Mails passend zu genau dieser Sparte – nie Wärmepumpen-Texte an
 * Hausnotruf-Firmen. Ohne Angabe wird die Sparte aus dem Kampagnennamen bzw. den Listen erkannt, sonst gilt PV & WP.
 * Gemeinsam für Server, Chat-Demo und Oberfläche.
 */
export type Sparte = {
  /** fester Schlüssel bekannter Sparten, „eigene“ für frei eingetragene */
  key: string;
  /** so heißt sie in der Oberfläche */
  label: string;
  /** im Satz nach „für“: „Lead-Lieferant für Hausnotruf“, „… für Elektrorollstühle“ – auch der Platzhalter {{sparte}} */
  topic: string;
  /** „Hausnotruf-Leads“ */
  leads: string;
  /** wen wir anschreiben: „Anbieter von Hausnotruf“ */
  recipients: string;
  /** bei wem sich der Interessent meldet: „Fachbetrieb“, „Anbieter“, „Fachhändler“ */
  partner: string;
  /** woran man die Sparte in Namen und Listen erkennt */
  match: RegExp;
  /** mit wie vielen Fragen wir telefonisch vorqualifizieren (PV & WP 10, Hausnotruf 6, Elektrorollstuhl 6, Alarmanlage 8) – ohne Angabe nennen wir keine Zahl */
  questions?: number | null;
  /** worum es bei den Fragen geht – drei Punkte, in E-Mails als kurzer Teaser in Klammern („z. B. Krankenkasse, Pflegegrad und Wohnsituation“). Eigene Sparten: keine festen Punkte – die KI nennt drei passende. */
  topics?: string[] | null;
};

const PV_RE = /photovoltaik|solar|\bpv\b|pv[-\s]|pv-?anlage/i;
const WP_RE = /wärmepumpe|waermepumpe|\bwp\b/i;
export const SPARTEN: Sparte[] = [
  { key: "pv-wp", label: "Photovoltaik & Wärmepumpe", topic: "Photovoltaik und Wärmepumpen", leads: "PV- und Wärmepumpen-Leads", recipients: "PV- und Wärmepumpen-Fachbetriebe und Energieversorger", partner: "Fachbetrieb", match: /(?!)/, questions: 10, topics: ["Eigentum", "Dach und Heizung", "Stromverbrauch"] },
  { key: "photovoltaik", label: "Photovoltaik", topic: "Photovoltaik", leads: "Photovoltaik-Leads", recipients: "Photovoltaik-Fachbetriebe und Solarteure", partner: "Fachbetrieb", match: PV_RE, questions: 10, topics: ["Eigentum", "Dachfläche", "Stromverbrauch"] },
  { key: "waermepumpe", label: "Wärmepumpe", topic: "Wärmepumpen", leads: "Wärmepumpen-Leads", recipients: "Wärmepumpen-Fachbetriebe und Heizungsbauer", partner: "Fachbetrieb", match: WP_RE, questions: 10, topics: ["Eigentum", "Wohnfläche", "aktuelle Heizung"] },
  { key: "hausnotruf", label: "Hausnotruf", topic: "Hausnotruf", leads: "Hausnotruf-Leads", recipients: "Anbieter von Hausnotruf-Systemen", partner: "Anbieter", match: /hausnotruf|notrufsystem|notruf|haus-notruf/i, questions: 6, topics: ["Krankenkasse", "Pflegegrad", "Wohnsituation"] },
  { key: "pflegebox", label: "Pflegebox", topic: "Pflegeboxen", leads: "Pflegebox-Leads", recipients: "Anbieter von Pflegeboxen und Pflegehilfsmitteln", partner: "Anbieter", match: /pflegebox|pflegehilfsmittel|pflege-box/i, topics: ["Pflegegrad", "Pflegekasse", "Pflege zu Hause"] },
  { key: "elektrorollstuhl", label: "Elektrorollstuhl", topic: "Elektrorollstühle", leads: "Elektrorollstuhl-Leads", recipients: "Fachhändler und Sanitätshäuser für Elektrorollstühle", partner: "Fachhändler", match: /elektro-?\s?rollst|e-?rollst|rollstuhl|rollstühle/i, questions: 6, topics: ["Krankenkasse", "Pflegegrad", "Nutzung drinnen oder draußen"] },
  { key: "rollator", label: "Rollator", topic: "Rollatoren", leads: "Rollator-Leads", recipients: "Fachhändler und Sanitätshäuser für Rollatoren", partner: "Fachhändler", match: /rollator/i, topics: ["Krankenkasse", "Pflegegrad", "Einsatz im Alltag"] },
  { key: "treppenlift", label: "Treppenlift", topic: "Treppenlifte", leads: "Treppenlift-Leads", recipients: "Anbieter und Fachbetriebe für Treppenlifte", partner: "Fachbetrieb", match: /treppenlift|sitzlift|plattformlift/i, topics: ["Treppenform", "Anzahl der Etagen", "Pflegegrad"] },
  { key: "bad", label: "Barrierefreies Bad", topic: "barrierefreie Bäder", leads: "Leads für barrierefreie Bäder", recipients: "Fachbetriebe für barrierefreie Badumbauten", partner: "Fachbetrieb", match: /barrierefrei|badumbau|bäder|baeder|badsanierung/i, topics: ["gewünschter Umbau", "Größe des Bads", "Pflegegrad"] },
  { key: "alarmanlage", label: "Alarmanlage", topic: "Alarmanlagen", leads: "Alarmanlagen-Leads", recipients: "Errichter und Fachbetriebe für Alarmanlagen und Sicherheitstechnik", partner: "Fachbetrieb", match: /alarm|einbruchschutz|einbruchmelde|sicherheitstechnik/i, questions: 8, topics: ["Objekt und Fläche", "Anzahl der Fenster", "Art der Alarmanlage"] },
  { key: "fenster", label: "Fenster", topic: "Fenster", leads: "Fenster-Leads", recipients: "Fensterbauer und Fachbetriebe für Fenster", partner: "Fachbetrieb", match: /fenster/i, topics: ["Anzahl der Fenster", "Material", "Zeitrahmen"] },
  { key: "wintergarten", label: "Wintergarten", topic: "Wintergärten", leads: "Wintergarten-Leads", recipients: "Fachbetriebe für Wintergärten", partner: "Fachbetrieb", match: /wintergarten|wintergärten/i, topics: ["Größe", "Art der Nutzung", "Zeitrahmen"] },
];
export const DEFAULT_SPARTE = SPARTEN[0];
/** Vorschläge für das Eingabefeld (frei eintragbar bleibt es trotzdem). */
export const SPARTE_SUGGESTIONS = SPARTEN.map((item) => item.label);

const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
/** Sparte aus Texten erkennen (Kampagnenname, Listen): „PV & WP …“ → Photovoltaik & Wärmepumpe, „Hausnotruf • …“ → Hausnotruf. */
export function detectSparte(...texts: Array<string | null | undefined>): Sparte | null {
  const text = texts.filter(Boolean).join(" · "); if (!text.trim()) return null;
  const pv = PV_RE.test(text); const wp = WP_RE.test(text);
  // eindeutige Sparten zuerst (ein „Elektro“ allein ist noch kein Rollstuhl; „Notruf“ vor allem anderen)
  const pick = (keys: string[]) => { for (const key of keys) { const sparte = SPARTEN.find((item) => item.key === key)!; if (sparte.match.test(text)) return sparte; } return null; };
  const specific = pick(["hausnotruf", "pflegebox", "elektrorollstuhl", "rollator", "treppenlift", "alarmanlage", "wintergarten"]); if (specific) return specific;
  if (pv && wp) return SPARTEN[0]; if (pv) return SPARTEN[1]; if (wp) return SPARTEN[2];
  return pick(["fenster", "bad"]);
}
/** Eingetragene Sparte auflösen: bekannte über Name/Stichwort, sonst als eigene Sparte mit genau diesem Wortlaut. */
export function resolveSparte(value: string | null | undefined): Sparte | null {
  const text = (value ?? "").trim().slice(0, 120); if (!text) return null;
  const exact = SPARTEN.find((item) => norm(item.label) === norm(text) || item.key === norm(text)); if (exact) return exact;
  const detected = detectSparte(text); if (detected && norm(detected.label).length >= norm(text).length - 6) return detected; // „Hausnotrufe“, „Alarmanlagen“ → bekannte Sparte
  return { key: "eigene", label: text, topic: text, leads: `Leads für ${text}`, recipients: `Anbieter und Fachbetriebe im Bereich ${text}`, partner: "Anbieter", match: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") };
}
/** Sparte einer Kampagne: eingetragen → erkannt aus Name und Listen → Photovoltaik & Wärmepumpe. `source` sagt, woher sie kommt. */
export function sparteOf(campaign: { leadSparte?: string | null; name?: string | null }, lists: string[] = []): Sparte & { source: "eingetragen" | "erkannt" | "standard" } {
  const set = resolveSparte(campaign.leadSparte); if (set) return { ...set, source: "eingetragen" };
  const found = detectSparte(campaign.name) ?? detectSparte(...lists); if (found) return { ...found, source: "erkannt" }; // der Name zählt vor den Listen
  return { ...DEFAULT_SPARTE, source: "standard" };
}
/** Photovoltaik und/oder Wärmepumpe? */
export const isEnergySparte = (sparte: Pick<Sparte, "key">) => sparte.key === "pv-wp" || sparte.key === "photovoltaik" || sparte.key === "waermepumpe";
const isEnergy = isEnergySparte;
/** Passt der Text zur Sparte? In jeder Sparte außer PV/WP darf nichts von Photovoltaik oder Wärmepumpen stehen. */
export function fitsSparte(sparte: Pick<Sparte, "key"> & { label?: string }, text: string): boolean { const energyLabel = sparte.key === "eigene" && (PV_RE.test(sparte.label ?? "") || WP_RE.test(sparte.label ?? "")); /* eigene Sparte wie „Batteriespeicher für PV“ */ return isEnergy(sparte) || energyLabel || !(PV_RE.test(text) || WP_RE.test(text)); }
const ENERGY_WORD = "(?:photovoltaik\\w*|solar\\w*|pv(?:-?anlagen?)?|wärmepumpe\\w*|waermepumpe\\w*)";
const LEAD_WORD = "(?:leads?|anfragen|interessenten|kundenanfragen|lead-?lieferant\\w*|leadlieferant\\w*)";
const FOREIGN_LEADS_RE = new RegExp(`\\b${ENERGY_WORD}[\\s-]*(?:(?:und|&|/)[\\s-]*${ENERGY_WORD}[\\s-]*)?${LEAD_WORD}|\\b${LEAD_WORD}\\s+(?:\\S+\\s+){0,3}?(?:für|zu|im bereich|rund um)\\s+(?:\\S+\\s+){0,2}?${ENERGY_WORD}`, "i");
/**
 * KI-Texte: bietet der Text Leads der falschen Sparte an (z. B. „unsere PV- und Wärmepumpen-Leads“ an eine Hausnotruf-Firma)? Nur das
 * ist ein harter Fehler – ein Detail von der Webseite der Firma („Außensirene mit Solarpanel“) ist es nicht.
 */
export function offersForeignLeads(sparte: Pick<Sparte, "key"> & { label?: string }, text: string): boolean {
  const energyLabel = sparte.key === "eigene" && (PV_RE.test(sparte.label ?? "") || WP_RE.test(sparte.label ?? ""));
  return !isEnergy(sparte) && !energyLabel && FOREIGN_LEADS_RE.test(text);
}
/** Hinweis im Builder: Vorlage spricht von Photovoltaik/Wärmepumpe, die Kampagne hat aber eine andere Sparte. */
export function foreignSparteIn(sparte: Pick<Sparte, "key"> & { label?: string }, text: string): string | null { return fitsSparte(sparte, text) ? null : "Photovoltaik/Wärmepumpe"; }
/** Der Satzteil in alten Vorlagen, der fest auf PV & WP stand – wird durch den Platzhalter {{sparte}} ersetzt. */
export const OLD_ENERGY_PHRASE = "Lead-Lieferanten in Deutschland für Photovoltaik und Wärmepumpen";
export const SPARTE_PHRASE = "Lead-Lieferanten in Deutschland für {{sparte}}";
/** Platzhalter {{sparte}}: ohne Kampagne „Ihre Branche“ – mit Kampagne deren Sparte (ein Wert aus der Liste des Kontakts hat Vorrang). */
export const SPARTE_FALLBACK = "Ihre Branche";
export function withSparte<T extends Record<string, string>>(values: T, sparte: Pick<Sparte, "topic">): T { return { ...values, sparte: values.sparte && values.sparte !== SPARTE_FALLBACK ? values.sparte : sparte.topic }; }
/* ---------------------------------------------------------------- „Sie zahlen nur für Leads, die passen“ */
/** Nur bei Photovoltaik und Wärmepumpe zahlt der Betrieb ausschließlich für Leads, die zu ihm passen – in allen anderen Sparten gilt das nicht. */
export const paysOnlyFitting = (sparte: Pick<Sparte, "key">) => isEnergySparte(sparte);
export const PAY_FIT_SENTENCE = "Sie zahlen dabei nur für Leads, die wirklich zu Ihnen passen.";
const PAY_FIT_RE = /\b(?:zahl|bezahl|berechn|abrechn|abgerechnet)\w*\b[^.!?\n]{0,60}\b(?:nur|ausschließlich)\b[^.!?\n]{0,60}\bpass\w*|\b(?:nur|ausschließlich)\b[^.!?\n]{0,40}\bpass\w*[^.!?\n]{0,40}\b(?:zahl|bezahl|berechn|abrechn|abgerechnet)\w*/i;
/** Steht im Text, dass nur passende Leads bezahlt werden? */
export const mentionsPayFit = (text: string) => PAY_FIT_RE.test(text);
const CLOSING_RE = /antworten sie|rufen sie|anrufen|\{\{kontaktweg\}\}|lassen sie uns|vielen dank/i;
/**
 * PV & WP: im freien Vorschlag steht in der Erst-E-Mail immer, dass nur passende Leads bezahlt werden (fehlt der Satz, kommt er
 * vor den Schluss) – früher galt das für den individuellen Ansatz, den der freie Vorschlag ersetzt. In allen anderen Sparten
 * fliegt jeder Satz dazu raus – das gilt dort nicht.
 */
export function applyPayFit(text: string, options: { sparte: Pick<Sparte, "key">; approach?: string | null; followUp?: boolean }): string {
  if (!paysOnlyFitting(options.sparte)) {
    if (!mentionsPayFit(text)) return text;
    return text.split(/(\n+)/).map((part) => part.split(/(?<=[.!?])\s+/).filter((sentence) => !mentionsPayFit(sentence)).join(" ")).join("").replace(/\n{3,}/g, "\n\n").trim();
  }
  if (options.approach !== "frei" || options.followUp || mentionsPayFit(text)) return text;
  const parts = text.split(/\n{2,}/); let at = parts.length;
  for (let index = parts.length - 1; index > 0; index -= 1) { if (CLOSING_RE.test(parts[index])) at = index; else break; } // vor den Schluss (Kontaktweg, „Vielen Dank“)
  parts.splice(at, 0, PAY_FIT_SENTENCE); return parts.join("\n\n");
}
/** „eines Fachbetriebs“, „eines Fachhändlers“, „eines Anbieters“ */
export const partnerGenitive = (sparte: Pick<Sparte, "partner">) => sparte.partner === "Fachbetrieb" ? "Fachbetriebs" : sparte.partner === "Fachhändler" ? "Fachhändlers" : "Anbieters";
/* ---------------------------------------------------------------- Zahl der Fragen bei der Vorqualifizierung */
const WORD_OF = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf"];
const VALUE_OF: Record<string, number> = { vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, dreizehn: 13, vierzehn: 14, fünfzehn: 15 };
/** Zahlen bis zwölf als Wort („sechs“, „acht“, „zehn“), größere als Ziffer. */
export const numberWord = (count: number) => WORD_OF[count] ?? String(count);
/** „10“ / „Zehn“ → 10 */
export const countValue = (token: string) => /^\d+$/.test(token) ? Number(token) : VALUE_OF[token.toLowerCase()] ?? null;
/**
 * Mit wie vielen Fragen wir in der Sparte telefonisch vorqualifizieren: PV & WP 10, Hausnotruf 6, Elektrorollstuhl 6, Alarmanlage 8.
 * Andere Sparten haben (noch) keine feste Zahl → null, dann steht „anhand gezielter Fragen“ ohne Zahl. Ohne Sparte gilt der Standard (PV & WP).
 */
export function questionCount(sparte?: { key?: string; questions?: number | null } | null): number | null {
  if (!sparte) return DEFAULT_SPARTE.questions ?? null;
  if (sparte.questions !== undefined) return sparte.questions ?? null;
  if (!sparte.key) return DEFAULT_SPARTE.questions ?? null;
  return SPARTEN.find((item) => item.key === sparte.key)?.questions ?? null;
}
type QuestionSparte = { key?: string; questions?: number | null; topics?: string[] | null } | null | undefined;
/**
 * Worum es bei den Fragen geht (drei Punkte je Sparte): Hausnotruf Krankenkasse, Pflegegrad, Wohnsituation; Alarmanlage Objekt und Fläche,
 * Anzahl der Fenster, Art der Alarmanlage … Eigene Sparten haben keine festen Punkte → null (die KI nennt dann drei passende). Ohne Sparte: PV & WP.
 */
export function questionTopics(sparte?: QuestionSparte): string[] | null {
  if (!sparte) return DEFAULT_SPARTE.topics ?? null;
  if (sparte.topics !== undefined) return sparte.topics?.length ? sparte.topics : null;
  if (!sparte.key) return DEFAULT_SPARTE.topics ?? null;
  return SPARTEN.find((item) => item.key === sparte.key)?.topics ?? null;
}
const joinTopics = (topics: string[]) => topics.length < 2 ? topics.join("") : `${topics.slice(0, -1).join(", ")} ${topics.some((item) => / und /.test(item)) ? "sowie" : "und"} ${topics[topics.length - 1]}`;
/** Kurzer Teaser in Klammern: „(z. B. Krankenkasse, Pflegegrad und Wohnsituation)“ – leer, wenn die Sparte keine festen Punkte hat. */
export function topicsTeaser(sparte?: QuestionSparte): string { const topics = questionTopics(sparte); return topics ? `(z. B. ${joinTopics(topics)})` : ""; }
/** „in der Regel anhand von sechs Fragen (z. B. Krankenkasse, Pflegegrad und Wohnsituation) telefonisch vorqualifiziert“ – ohne feste Zahl „anhand gezielter Fragen … telefonisch vorqualifiziert“. */
export function qualifyPhrase(sparte?: QuestionSparte): string { const count = questionCount(sparte); const teaser = topicsTeaser(sparte); return `${count ? `in der Regel anhand von ${numberWord(count)} Fragen` : "anhand gezielter Fragen"}${teaser ? ` ${teaser}` : ""} telefonisch vorqualifiziert`; }
/** Für Aufzählungen („Telefonische Vorqualifizierung jedes Interessenten …“): „anhand von in der Regel sechs Fragen (z. B. …)“ / „anhand gezielter Fragen“. */
export function qualifyBy(sparte?: QuestionSparte): string { const count = questionCount(sparte); const teaser = topicsTeaser(sparte); return `${count ? `anhand von in der Regel ${numberWord(count)} Fragen` : "anhand gezielter Fragen"}${teaser ? ` ${teaser}` : ""}`; }
/** Die Teaser aller bekannten Sparten – so erkennt man einen Teaser, der zu einer anderen Sparte gehört (z. B. nach einer kopierten Vorlage). */
const KNOWN_TEASERS = new Set(SPARTEN.map((item) => topicsTeaser(item)).filter(Boolean).map((teaser) => teaser.toLowerCase()));
const TEASER_SRC = "\\s*\\((?:z\\.\\s?B\\.|u\\.\\s?a\\.|etwa\\b|unter anderem\\b)[^()\\n]{2,160}\\)";
export const COUNT_SRC = "(?:1[0-5]|[4-9]|vierzehn|dreizehn|fünfzehn|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)";
const QUESTIONS_SRC = "(?:Qualifizierungs|Qualifikations)?[Ff]ragen";
const COUNTED_RE = new RegExp(`\\b${COUNT_SRC}\\s+(?:kurze[n]?\\s+)?${QUESTIONS_SRC}\\b|\\bgezielte[rn]?\\s+(?:Qualifizierungs)?[Ff]ragen\\b`, "i");
/** Steht im Text schon, wie wir qualifizieren (eine Zahl von Fragen oder „gezielte Fragen“)? */
export const mentionsQuestions = (text: string) => COUNTED_RE.test(text);
const QUALIFY_CONTEXT = /qualifi|interessent|anfrage|lead/i;
const cap = (match: string, value: string) => (/^[A-ZÄÖÜ]/.test(match) ? value.charAt(0).toUpperCase() + value.slice(1) : value);
/**
 * Zahl der Fragen in einem Text an die Sparte anpassen: „anhand von zehn Fragen“ wird bei Hausnotruf „anhand von sechs Fragen“,
 * bei Alarmanlagen „acht“; Sparten ohne feste Zahl bekommen „anhand gezielter Fragen“. Nur in Sätzen über die Qualifizierung –
 * eine „Frage an Sie“ bleibt unberührt.
 */
export function fixQuestionCount(text: string, sparte?: QuestionSparte): string {
  if (!text || !COUNTED_RE.test(text)) return text;
  const count = questionCount(sparte); const word = count ? numberWord(count) : null;
  return text.replace(/[^.!?\n]+[.!?]*/g, (segment) => {
    if (!QUALIFY_CONTEXT.test(segment) || !COUNTED_RE.test(segment)) return segment;
    if (word) return segment
      .replace(/(?:in der Regel\s+)?anhand gezielter (?:Qualifizierungs)?[Ff]ragen/gi, (match) => cap(match, `in der Regel anhand von ${word} Fragen`))
      .replace(new RegExp(`\\b${COUNT_SRC}(?=\\s+(?:kurze[n]?\\s+)?${QUESTIONS_SRC}\\b)`, "gi"), (match) => countValue(match) === count ? match : cap(match, word)); // stimmt die Zahl schon („10“ bei PV), bleibt sie so
    return segment
      .replace(new RegExp(`(?:in der Regel\\s+)?anhand von\\s+(?:in der Regel\\s+|rund\\s+|etwa\\s+|bis zu\\s+)?${COUNT_SRC}\\s+(?:kurze[n]?\\s+)?${QUESTIONS_SRC}\\b`, "gi"), (match) => cap(match, "anhand gezielter Fragen"))
      .replace(new RegExp(`\\b(mit|über|durch)\\s+(?:in der Regel\\s+|rund\\s+|etwa\\s+)?${COUNT_SRC}\\s+(?:kurze[n]?\\s+)?${QUESTIONS_SRC}\\b`, "gi"), (_match, prep: string) => `${prep} ${/^mit$/i.test(prep) ? "gezielten" : "gezielte"} Fragen`)
      .replace(new RegExp(`(?:\\b(?:rund|etwa)\\s+)?\\b${COUNT_SRC}\\s+(?:kurze[n]?\\s+)?${QUESTIONS_SRC}\\b`, "gi"), (match) => cap(match, "gezielte Fragen"));
  });
}
/**
 * Teaser in Klammern hinter der Zahl der Fragen: „anhand von sechs Fragen (z. B. Krankenkasse, Pflegegrad und Wohnsituation)“.
 * Nur in Sätzen über die Qualifizierung und nur einmal je Text (`state.done` gilt über mehrere Bausteine einer E-Mail). Steht schon
 * ein Teaser da, bleibt er – außer er gehört zu einer anderen Sparte (z. B. aus einer kopierten Vorlage): dann kommt der richtige
 * hin, bei Sparten ohne feste Punkte fällt er weg. Nennt der Satz die Punkte schon („… Fragen zu Krankenkasse und Pflegegrad“), kommt nichts dazu.
 */
export function withQuestionTopics(text: string, sparte?: QuestionSparte, state: { done: boolean } = { done: false }): string {
  if (!text || !COUNTED_RE.test(text)) return text;
  const topics = questionTopics(sparte); const teaser = topicsTeaser(sparte);
  const mention = new RegExp(`(\\b(?:${COUNT_SRC}|gezielte[rn]?)\\s+(?:kurze[n]?\\s+)?${QUESTIONS_SRC}\\b)(${TEASER_SRC})?`, "gi");
  return text.replace(mention, (all: string, head: string, existing: string | undefined, offset: number, whole: string) => {
    const around = whole.slice(Math.max(0, offset - 160), offset + all.length + 120);
    if (!QUALIFY_CONTEXT.test(around) && !/vorqualifi|telefonisch/i.test(around)) return all; // eine „Frage an Sie“ bleibt unberührt
    const current = (existing ?? "").trim(); const foreign = current && KNOWN_TEASERS.has(current.toLowerCase()) && current.toLowerCase() !== teaser.toLowerCase();
    if (current && !foreign) { state.done = true; return all; } // eigener oder passender Teaser bleibt
    if (!teaser) return foreign ? head : all; // Sparte ohne feste Punkte: fremden Teaser entfernen
    if (state.done) return foreign ? head : all;
    const after = whole.slice(offset + all.length, offset + all.length + 140).toLowerCase();
    const keyWord = (topic: string) => topic.toLowerCase().split(/\s+/).filter((word) => word.length >= 5).sort((a, b) => b.length - a.length)[0] ?? topic.toLowerCase();
    if (!current && topics!.some((topic) => new RegExp(`(^|[^a-zäöüß])${keyWord(topic)}`, "i").test(after))) { state.done = true; return all; } // Punkte stehen schon im Satz
    state.done = true; return `${head} ${teaser}`;
  });
}
