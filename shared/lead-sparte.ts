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
  /** worum es bei den Fragen geht – drei Beispiele, in E-Mails ohne Klammern: „Abgefragt werden beispielsweise die Krankenkasse, der Pflegegrad, die Wohnsituation des Interessenten usw.“ Eigene Sparten: keine festen Punkte – die KI nennt drei passende. */
  topics?: string[] | null;
};

const PV_RE = /photovoltaik|solar|\bpv\b|pv[-\s]|pv-?anlage/i;
const WP_RE = /wärmepumpe|waermepumpe|\bwp\b/i;
export const SPARTEN: Sparte[] = [
  { key: "pv-wp", label: "Photovoltaik & Wärmepumpe", topic: "Photovoltaik und Wärmepumpen", leads: "PV- und Wärmepumpen-Leads", recipients: "PV- und Wärmepumpen-Fachbetriebe und Energieversorger", partner: "Fachbetrieb", match: /(?!)/, questions: 10, topics: ["die Eigentumsverhältnisse", "der Zustand von Dach und Heizung", "der aktuelle Stromverbrauch"] },
  { key: "photovoltaik", label: "Photovoltaik", topic: "Photovoltaik", leads: "Photovoltaik-Leads", recipients: "Photovoltaik-Fachbetriebe und Solarteure", partner: "Fachbetrieb", match: PV_RE, questions: 10, topics: ["die Eigentumsverhältnisse", "die verfügbare Dachfläche", "der aktuelle Stromverbrauch"] },
  { key: "waermepumpe", label: "Wärmepumpe", topic: "Wärmepumpen", leads: "Wärmepumpen-Leads", recipients: "Wärmepumpen-Fachbetriebe und Heizungsbauer", partner: "Fachbetrieb", match: WP_RE, questions: 10, topics: ["die Eigentumsverhältnisse", "die Wohnfläche, die beheizt werden soll", "die aktuelle Heizung"] },
  { key: "hausnotruf", label: "Hausnotruf", topic: "Hausnotruf", leads: "Hausnotruf-Leads", recipients: "Anbieter von Hausnotruf-Systemen", partner: "Anbieter", match: /hausnotruf|notrufsystem|notruf|haus-notruf/i, questions: 6, topics: ["die Krankenkasse", "der Pflegegrad", "die Wohnsituation des Interessenten"] },
  { key: "pflegebox", label: "Pflegebox", topic: "Pflegeboxen", leads: "Pflegebox-Leads", recipients: "Anbieter von Pflegeboxen und Pflegehilfsmitteln", partner: "Anbieter", match: /pflegebox|pflegehilfsmittel|pflege-box/i, topics: ["der Pflegegrad", "die Pflegekasse", "die Pflegesituation zu Hause"] },
  { key: "elektrorollstuhl", label: "Elektrorollstuhl", topic: "Elektrorollstühle", leads: "Elektrorollstuhl-Leads", recipients: "Fachhändler und Sanitätshäuser für Elektrorollstühle", partner: "Fachhändler", match: /elektro-?\s?rollst|e-?rollst|rollstuhl|rollstühle/i, questions: 6, topics: ["die Krankenkasse", "der Pflegegrad", "die geplante Nutzung drinnen oder draußen"] },
  { key: "rollator", label: "Rollator", topic: "Rollatoren", leads: "Rollator-Leads", recipients: "Fachhändler und Sanitätshäuser für Rollatoren", partner: "Fachhändler", match: /rollator/i, topics: ["die Krankenkasse", "der Pflegegrad", "der Einsatz im Alltag"] },
  { key: "treppenlift", label: "Treppenlift", topic: "Treppenlifte", leads: "Treppenlift-Leads", recipients: "Anbieter und Fachbetriebe für Treppenlifte", partner: "Fachbetrieb", match: /treppenlift|sitzlift|plattformlift/i, topics: ["die Treppenform", "die Anzahl der Etagen", "der Pflegegrad"] },
  { key: "bad", label: "Barrierefreies Bad", topic: "barrierefreie Bäder", leads: "Leads für barrierefreie Bäder", recipients: "Fachbetriebe für barrierefreie Badumbauten", partner: "Fachbetrieb", match: /barrierefrei|badumbau|bäder|baeder|badsanierung/i, topics: ["der gewünschte Umbau", "die Größe des Bads", "der Pflegegrad"] },
  { key: "alarmanlage", label: "Alarmanlage", topic: "Alarmanlagen", leads: "Alarmanlagen-Leads", recipients: "Errichter und Fachbetriebe für Alarmanlagen und Sicherheitstechnik", partner: "Fachbetrieb", match: /alarm|einbruchschutz|einbruchmelde|sicherheitstechnik/i, questions: 8, topics: ["die Fläche, die abgesichert werden soll", "die Objektart, um die es sich handelt", "die gewünschte Art der Alarmanlage"] },
  { key: "fenster", label: "Fenster", topic: "Fenster", leads: "Fenster-Leads", recipients: "Fensterbauer und Fachbetriebe für Fenster", partner: "Fachbetrieb", match: /fenster/i, topics: ["die Anzahl der Fenster", "das gewünschte Material", "der geplante Zeitrahmen"] },
  { key: "wintergarten", label: "Wintergarten", topic: "Wintergärten", leads: "Wintergarten-Leads", recipients: "Fachbetriebe für Wintergärten", partner: "Fachbetrieb", match: /wintergarten|wintergärten/i, topics: ["die gewünschte Größe", "die geplante Nutzung", "der geplante Zeitrahmen"] },
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
type QuestionSparte = { key?: string; questions?: number | null; topics?: string[] | null; partner?: string | null } | null | undefined;
/**
 * Worum es bei den Fragen geht (drei Beispiele je Sparte): Hausnotruf die Krankenkasse, der Pflegegrad, die Wohnsituation; Alarmanlage die Fläche,
 * die abgesichert werden soll, die Objektart, um die es sich handelt, die gewünschte Art der Alarmanlage … Eigene Sparten haben keine festen
 * Punkte → null (die KI nennt dann drei passende). Ohne Sparte: PV & WP.
 */
export function questionTopics(sparte?: QuestionSparte): string[] | null {
  if (!sparte) return DEFAULT_SPARTE.topics ?? null;
  if (sparte.topics !== undefined) return sparte.topics?.length ? sparte.topics : null;
  if (!sparte.key) return DEFAULT_SPARTE.topics ?? null;
  return SPARTEN.find((item) => item.key === sparte.key)?.topics ?? null;
}
/** „beispielsweise die Krankenkasse, der Pflegegrad, die Wohnsituation des Interessenten usw.“ – ohne Klammern; leer ohne Punkte. */
export function topicsExamples(sparte?: QuestionSparte, topics: string[] | null = questionTopics(sparte)): string { return topics?.length ? `beispielsweise ${topics.join(", ")} usw.` : ""; }
/** Eigener Satz direkt hinter der Qualifizierung: „Abgefragt werden beispielsweise … usw.“ */
export function topicsSentence(sparte?: QuestionSparte, topics: string[] | null = questionTopics(sparte)): string { const examples = topicsExamples(sparte, topics); return examples ? `Abgefragt werden ${examples}` : ""; }
/** „in der Regel anhand von sechs Fragen telefonisch vorqualifiziert“ – ohne feste Zahl „anhand gezielter Fragen telefonisch vorqualifiziert“. Die Beispiele folgen als eigener Satz. */
export function qualifyPhrase(sparte?: QuestionSparte): string { const count = questionCount(sparte); return `${count ? `in der Regel anhand von ${numberWord(count)} Fragen` : "anhand gezielter Fragen"} telefonisch vorqualifiziert`; }
/** Für Aufzählungen („Telefonische Vorqualifizierung jedes Interessenten …“): „anhand von in der Regel sechs Fragen – beispielsweise … usw.“ */
export function qualifyBy(sparte?: QuestionSparte): string { const count = questionCount(sparte); const examples = topicsExamples(sparte); return `${count ? `anhand von in der Regel ${numberWord(count)} Fragen` : "anhand gezielter Fragen"}${examples ? ` – ${examples}` : ""}`; }
/** Die Logik-Kette: Der Interessent weiß, dass sich ein Fachbetrieb mit einem Angebot bei ihm meldet – er wartet auf den Anruf des Betriebs. */
export const offerChain = (sparte?: { partner?: string | null } | null) => `Der Interessent weiß danach, dass sich ein ${sparte?.partner || "Fachbetrieb"} bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet also auf Ihren Anruf.`;
/** Dieselbe Kette als Punkt einer Aufzählung (ohne Schlusspunkt). */
export const offerChainBullet = (sparte?: { partner?: string | null } | null) => `Der Interessent weiß, dass sich ein ${sparte?.partner || "Fachbetrieb"} bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet auf Ihren Anruf`;
const normTopics = (text: string) => text.toLowerCase().replace(/\b(?:der|die|das|des|den|dem)\b/g, " ").replace(/\s*(?:,|\bund\b|\bsowie\b|\busw\.?|\betc\.?)\s*/g, "|").replace(/\s+/g, " ").split("|").map((part) => part.trim()).filter(Boolean).join("|");
/** Frühere Punkte (vor „beispielsweise … usw.“) – so werden alte Klammern und Beispiele aus kopierten Vorlagen erkannt. */
const OLD_TOPICS: string[][] = [["Eigentum", "Dach und Heizung", "Stromverbrauch"], ["Eigentum", "Dachfläche", "Stromverbrauch"], ["Eigentum", "Wohnfläche", "aktuelle Heizung"], ["Krankenkasse", "Pflegegrad", "Wohnsituation"], ["Pflegegrad", "Pflegekasse", "Pflege zu Hause"], ["Krankenkasse", "Pflegegrad", "Nutzung drinnen oder draußen"], ["Krankenkasse", "Pflegegrad", "Einsatz im Alltag"], ["Treppenform", "Anzahl der Etagen", "Pflegegrad"], ["gewünschter Umbau", "Größe des Bads", "Pflegegrad"], ["Objekt und Fläche", "Anzahl der Fenster", "Art der Alarmanlage"], ["Anzahl der Fenster", "Material", "Zeitrahmen"], ["Größe", "Art der Nutzung", "Zeitrahmen"]];
/** Alle Punkte, die wir je geschrieben haben (alt und neu, jede Sparte) – nur die werden ersetzt; eigene Punkte bleiben. */
const KNOWN_TOPIC_LISTS = new Set([...OLD_TOPICS, ...SPARTEN.map((item) => item.topics ?? []).filter((topics) => topics.length)].map((topics) => normTopics(topics.join(", "))));
const isKnownTopicList = (text: string) => KNOWN_TOPIC_LISTS.has(normTopics(text));
/** „Krankenkasse, Pflegegrad und Wohnsituation“ → [Krankenkasse, Pflegegrad, Wohnsituation] */
const splitTopicList = (text: string) => text.replace(/\s*(?:usw\.?|etc\.?)\s*$/i, "").split(/\s*,\s*|\s+(?:und|sowie)\s+/).map((part) => part.trim()).filter(Boolean);
/** alte Klammer hinter der Zahl der Fragen: „(z. B. …)“, „(u. a. …)“ – fällt weg, die Beispiele stehen jetzt ohne Klammern */
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
const ABBREVIATION_RE = /(?:\bz\.\s?B|\bu\.\s?a|\bd\.\s?h|\bo\.\s?Ä|\bi\.\s?d\.\s?R|\bca|\bbzw|\busw|\betc|\binkl|\bggf|\bevtl|\bvgl|\bsog|\bNr|\bStr|\bTel)$/i;
/** Index direkt hinter dem Ende des Satzes ab `from` – „z. B.“, „usw.“ mitten im Satz und Datumszahlen („28.“) beenden keinen Satz, ein Zeilenende schon. */
function sentenceEnd(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\n") return index;
    if (char !== "." && char !== "!" && char !== "?") continue;
    const next = text[index + 1]; if (next !== undefined && !/\s/.test(next)) continue;
    if (char === ".") {
      const before = text.slice(Math.max(0, index - 14), index);
      const following = text.slice(index + 1).match(/^[ \t]*(\S)/)?.[1] ?? null; const ends = following === null || /[A-ZÄÖÜ„"(]/.test(following) || /^\s*\n/.test(text.slice(index + 1));
      if (/(?:usw|etc)$/i.test(before) && ends) return index + 1; // „… usw.“ am Satzende
      if (ABBREVIATION_RE.test(before) || /\d$/.test(before)) continue;
    }
    return index + 1;
  }
  return text.length;
}
const sentenceStart = (text: string, at: number) => { for (let index = at - 1; index >= 0; index -= 1) { if (text[index] === "\n") return index + 1; if (/[.!?]/.test(text[index]) && /\s/.test(text[index + 1] ?? "") && !ABBREVIATION_RE.test(text.slice(Math.max(0, index - 14), index))) return index + 1; } return 0; };
const isBulletLine = (text: string, at: number) => /^[ \t]*[•\-–*][ \t]/.test(text.slice(text.lastIndexOf("\n", at - 1) + 1));
/** Kette schon im Text? (alt: „erwartet die Rückmeldung eines …“, „weiß, dass sich … meldet“ – neu: „… um ihm ein Angebot zu unterbreiten“) */
const CHAIN_RE = /\b(?:der|jeder)\s+interessent\b[^.!?\n]{0,60}\b(?:weiß|erwartet|wartet)(?![\wäöüß])/i; // nie \b hinter „ß“ – das zählt in JavaScript nicht als Buchstabe
/** „…, sodass der Interessent weiß, dass sich der Betrieb bei ihm meldet“ – Nebensatz im Satz zur Qualifizierung (wird ein eigener Satz) */
const CHAIN_CLAUSE_RE = /,?\s*(?:sodass|so dass|damit)\s+(?:(?:der|jeder)\s+interessent|er)(?:\s+(?:genau|sicher|direkt|dann|danach))?\s+weiß,?\s+dass\s+sich\s+[^.!?\n]*?\bmeldet\b[^.!?\n]*/i;
const OLD_CHAIN_BULLET_RE = /^([ \t]*[•\-–*][ \t]+)(?:der|jeder)\s+interessent\s+erwartet\s+(?:danach|dann|anschließend)?\s*(?:die|eine)\s+rückmeldung\s+(?:eines|einer|des|der)\s+[^\n]*$/gim;
/** ältere Kette ohne Angebot: „der Interessent weiß (danach), dass sich ein Anbieter bei ihm meldet“ (auch „… melden wird“) */
const OLD_CHAIN_CORE = String.raw`(?:der|jeder)\s+interessent\s+weiß(?:\s+(?:danach|dadurch|somit|also|dann|anschließend|genau|schon|bereits|sofort|sicher)){0,2},?\s+dass\s+sich\s+[^.!?\n]*?\b(?:meldet|melden\s+wird)\b`;
const OLD_CHAIN_SENTENCE_RE = new RegExp(String.raw`(^|[.!?][ \t]+|\n)(${OLD_CHAIN_CORE})(?![^.!?\n]*\bangebot)[^.!?\n]*[.!?]?`, "gi");
/** dieselbe Kette mitten im Satz („…vorqualifiziert; der Interessent weiß danach, …“, „… – und der Interessent weiß …“) → eigener Satz mit der neuen Kette */
const OLD_CHAIN_MID_RE = new RegExp(String.raw`(?:\s*[;,]\s*(?:und\s+)?|\s+[–-]\s+(?:und\s+)?|\s+und\s+)(${OLD_CHAIN_CORE})(?![^.!?\n]*\bangebot)[^.!?\n]*[.!?]?`, "gi");
/** Ältere Fassungen der Kette auf die neue bringen: „… meldet, um ihm ein Angebot zu unterbreiten – er wartet also auf Ihren Anruf.“ */
export function upgradeOfferChain(text: string, sparte?: QuestionSparte, options: { bullet?: boolean } = {}): string { // `bullet`: ein Punkt einer Aufzählung im Builder (ohne „•“ im Text)
  if (!text || !/interessent/i.test(text)) return text;
  return text
    .replace(OLD_CHAIN_BULLET_RE, (_all, bullet: string) => `${bullet}${offerChainBullet(sparte)}`)
    .replace(OLD_CHAIN_SENTENCE_RE, (all: string, lead: string, _body: string, offset: number, whole: string) => options.bullet || isBulletLine(whole, offset + lead.length) ? `${lead}${offerChainBullet(sparte)}` : `${lead}${offerChain(sparte)}`)
    .replace(OLD_CHAIN_MID_RE, (all: string, _body: string, offset: number, whole: string) => {
      if (options.bullet) return all; // Punkt im Builder bleibt, wie er ist
      if (!isBulletLine(whole, offset)) return `. ${offerChain(sparte)}`;
      const marker = whole.slice(whole.lastIndexOf("\n", offset - 1) + 1).match(/^[ \t]*[•\-–*][ \t]/)?.[0] ?? "• ";
      return `\n${marker}${offerChainBullet(sparte)}`; // in einer Aufzählung: die Kette als eigener Punkt
    })
    .replace(/(\bdass sich ein )(Fachbetrieb|Anbieter|Fachhändler)(?= bei ihm meldet, um ihm ein Angebot zu unterbreiten)/g, (all: string, lead: string) => sparte?.partner ? `${lead}${sparte.partner}` : all); // kopierte Vorlage einer anderen Sparte: wer sich meldet
}
/**
 * Steht die Logik-Kette schon im Text (neue oder ältere Fassung)? Der alte Nebensatz „…, sodass der Interessent weiß, dass sich der Betrieb bei ihm
 * meldet“ zählt nicht: Den löst withQuestionTopics aus dem Satz zur Qualifizierung und setzt dafür die neue Kette ein.
 */
export const hasOfferChain = (text: string, sparte?: QuestionSparte) => CHAIN_RE.test(upgradeOfferChain(text, sparte).replace(new RegExp(CHAIN_CLAUSE_RE.source, "gi"), ""));
/** Alter Starttext: „… Danach gehen sie exklusiv …“ stand hinter der Qualifizierung – hinter der Kette heißt es „Die Anfragen gehen exklusiv …“. */
const tidyAfterChain = (text: string) => text.replace(/(er wartet also auf Ihren Anruf\.)\s+Danach gehen sie exklusiv/g, "$1 Die Anfragen gehen exklusiv");
/**
 * Qualifizierung in einem Text ausformulieren – ohne Klammern: hinter dem Satz mit der Zahl der Fragen folgt „Abgefragt werden beispielsweise …
 * usw.“ (in einer Aufzählung „ – beispielsweise … usw.“), danach die Logik-Kette „Der Interessent weiß danach, dass sich ein Fachbetrieb bei ihm
 * meldet, um ihm ein Angebot zu unterbreiten – er wartet also auf Ihren Anruf.“ Alte Klammern „(z. B. …)“ fallen weg; eigene Punkte darin bleiben
 * als Beispiele (bei Sparten ohne feste Punkte), Punkte einer anderen Sparte werden ersetzt. Je E-Mail nur einmal (`state` gilt über alle
 * Bausteine einer E-Mail); Überschriften (`insert: false`) werden nur bereinigt. Mehrfach ausführbar ohne Nebenwirkung.
 */
export function withQuestionTopics(text: string, sparte?: QuestionSparte, state: { done: boolean; chain?: boolean; chainAfter?: boolean } = { done: false }, options: { insert?: boolean; bullet?: boolean } = {}): string {
  if (!text) return text;
  let out = upgradeOfferChain(text, sparte, { bullet: options.bullet });
  if (!COUNTED_RE.test(out)) return out;
  const qualifying = (whole: string, offset: number, length: number) => { const around = whole.slice(Math.max(0, offset - 160), offset + length + 120); return QUALIFY_CONTEXT.test(around) || /vorqualifi|telefonisch/i.test(around); };
  // 1) Klammern weg: „acht Fragen (z. B. …)“ → „acht Fragen“ – eigene Punkte merken
  let custom: string[] | null = null;
  out = out.replace(new RegExp(`(\\b(?:${COUNT_SRC}|gezielte[rn]?)\\s+(?:kurze[n]?\\s+)?${QUESTIONS_SRC}\\b)(${TEASER_SRC})`, "gi"), (all: string, head: string, teaser: string, offset: number, whole: string) => {
    if (!qualifying(whole, offset, all.length)) return all;
    const inner = teaser.trim().replace(/^\(\s*(?:z\.\s?B\.|u\.\s?a\.|etwa|unter anderem)\s*/i, "").replace(/\)\s*$/, "").trim();
    if (!custom && inner && !isKnownTopicList(inner)) custom = splitTopicList(inner);
    return head;
  });
  if (options.insert === false) return out;
  const own = questionTopics(sparte); const examples = own ?? custom;
  // Beispiele, die wir schon geschrieben hatten, auf die Sparte bringen: andere Sparte (kopierte Vorlage) → eigene Punkte; Sparte ohne feste Punkte → weg
  out = out.replace(/([ \t]?)(Abgefragt werden beispielsweise |– beispielsweise )([^\n]*?) usw\./g, (all: string, space: string, lead: string, list: string) => {
    if (!isKnownTopicList(list)) return all; // eigene Punkte bleiben
    if (own) return normTopics(list) === normTopics(own.join(", ")) ? all : `${space}${lead}${own.join(", ")} usw.`;
    return custom ? `${space}${lead}${custom.join(", ")} usw.` : "";
  });
  // 2) die erste Erwähnung der Qualifizierung finden
  const mention = new RegExp(`\\b(?:${COUNT_SRC}|gezielte[rn]?)\\s+(?:kurze[n]?\\s+)?${QUESTIONS_SRC}\\b`, "gi"); let found: RegExpExecArray | null = null;
  for (let match = mention.exec(out); match; match = mention.exec(out)) if (qualifying(out, match.index, match[0].length)) { found = match; break; }
  if (!found) return out;
  const start = sentenceStart(out, found.index); let end = sentenceEnd(out, found.index + found[0].length);
  const bullet = options.bullet === true || isBulletLine(out, found.index); // `bullet`: ein Punkt einer Aufzählung im Builder (ohne „•“ im Text)
  // 3) Nebensatz zur Kette aus dem Satz lösen – er folgt gleich als eigener Satz
  let chainRemoved = false;
  if (!bullet) { const sentence = out.slice(start, end); const clause = sentence.match(CHAIN_CLAUSE_RE); if (clause && clause.index !== undefined) { const cut = sentence.slice(0, clause.index).replace(/\s+$/, ""); const rest = sentence.slice(clause.index + clause[0].length).replace(/^[\s,]*/, ""); const fixed = `${cut}${/[.!?]$/.test(cut) ? "" : "."}${rest && !/^[.!?]/.test(rest) ? ` ${rest}` : ""}`.replace(/\.\s*\.$/, "."); out = `${out.slice(0, start)}${fixed}${out.slice(end)}`; end = start + fixed.length; chainRemoved = true; } }
  // 4) Beispiele – nur, wenn nicht schon welche dastehen (eigene „beispielsweise …“ der KI bleiben; Punkte einer anderen Sparte werden ersetzt)
  let insertAt = end;
  const following = out.slice(end).match(/^[ \t]*(?:Abgefragt werden|Dabei (?:fragen|klären) wir)\b[^\n]*?beispielsweise\b/); if (following) insertAt = sentenceEnd(out, end + following[0].length); // Beispiele stehen schon direkt dahinter → Kette danach
  const keyWord = (topic: string) => topic.toLowerCase().split(/[^a-zäöüß]+/).filter((word) => word.length >= 5).sort((a, b) => b.length - a.length)[0] ?? null;
  const rest = out.slice(found.index + found[0].length, end).toLowerCase(); const named = Boolean(own?.some((topic) => { const word = keyWord(topic); return word && rest.includes(word); })); // „… sechs Fragen zu Krankenkasse und Pflegegrad“ – Punkte stehen schon im Satz
  const hasExamples = named || /\bbeispielsweise\b|\bzum beispiel\b/i.test(out.slice(found.index, Math.min(out.length, end + 320)));
  if (!hasExamples && examples?.length && !state.done) {
    if (bullet) { const lineEnd = options.bullet ? -1 : out.indexOf("\n", found.index); const at = lineEnd === -1 ? out.length : lineEnd; const line = out.slice(0, at).replace(/[ \t.]+$/, ""); out = `${line} – ${topicsExamples(sparte, examples)}${out.slice(at)}`; insertAt = line.length + 3 + topicsExamples(sparte, examples).length; }
    else { const head = out.slice(0, end).replace(/[ \t]+$/, ""); const dot = /[.!?]$/.test(head) ? "" : "."; const sentence = ` ${topicsSentence(sparte, examples)}`; out = `${head}${dot}${sentence}${out.slice(end)}`; insertAt = head.length + dot.length + sentence.length; }
  }
  state.done = true;
  // 5) Logik-Kette – einmal je E-Mail, direkt hinter den Beispielen (in einer Aufzählung als eigener Punkt)
  if (!state.chain && !CHAIN_RE.test(out)) {
    if (options.bullet) { state.chainAfter = true; return tidyAfterChain(out); } // als eigener Punkt direkt dahinter – setzt der Builder-Fix ein
    if (bullet) { const lineEnd = out.indexOf("\n", insertAt); const at = lineEnd === -1 ? out.length : lineEnd; const marker = out.slice(out.lastIndexOf("\n", found.index - 1) + 1).match(/^[ \t]*[•\-–*][ \t]/)?.[0] ?? "• "; out = `${out.slice(0, at)}\n${marker}${offerChainBullet(sparte)}${out.slice(at)}`; }
    else { const head = out.slice(0, insertAt).replace(/[ \t]+$/, ""); const dot = /[.!?]$/.test(head) ? "" : "."; out = `${head}${dot} ${offerChain(sparte)}${out.slice(insertAt).replace(/^[ \t]+(?=\S)/, " ")}`; }
  }
  void chainRemoved; state.chain = true;
  return tidyAfterChain(out);
}
