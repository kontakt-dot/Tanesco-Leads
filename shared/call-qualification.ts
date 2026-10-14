/** Qualifizierungsfragen je Kampagne (Gesprächsbewertung): Standardfragen + regelbasierte Auswertung eines Transkripts. */
/** Regel je Frage: „ko“ = Nein führt zur Zurückweisung, „required“ = Ja ist Pflicht für die Freigabe, „info“ = nur zur Auswertung. */
export type QualificationRule = "ko" | "required" | "info";
export type QualificationQuestion = { key: string; label: string; hint?: string; rule?: QualificationRule };
export const RULE_LABEL: Record<QualificationRule, string> = { ko: "K.-o. (Nein = zurückgewiesen)", required: "Pflicht (Ja für Freigabe)", info: "Nur Auswertung" };
export type QualificationAnswer = { answer: "ja" | "nein" | "unklar"; note?: string };
export const DEFAULT_QUALIFICATION_QUESTIONS: QualificationQuestion[] = [
  { key: "frage_photovoltaik", label: "Hat der Mitarbeiter nach Photovoltaik gefragt?", rule: "info" },
  { key: "frage_waermepumpe", label: "Hat der Mitarbeiter nach einer Wärmepumpe gefragt?", rule: "info" },
  { key: "frage_wintergarten", label: "Hat der Mitarbeiter nach einem Wintergarten gefragt?", rule: "info" },
  { key: "interesse", label: "Hat der Kunde generell Interesse?", rule: "ko" },
  { key: "vor_ort_termin", label: "Stimmt der Kunde einem Vor-Ort-Termin innerhalb eines Monats zu?", rule: "required" },
  { key: "telefonische_kontaktaufnahme", label: "Ist eine telefonische Kontaktaufnahme erwünscht?", rule: "required" },
  { key: "alle_fragen_gestellt", label: "Wurden alle Fragen gestellt?", rule: "info" },
];
const slug = (text: string) => text.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "frage";
export function normalizeQuestions(input: Array<Partial<QualificationQuestion>> | null | undefined): QualificationQuestion[] {
  const seen = new Set<string>(); const out: QualificationQuestion[] = [];
  for (const item of input ?? []) { const label = String(item?.label ?? "").trim(); if (!label) continue; let key = String(item?.key ?? "").trim() || slug(label); while (seen.has(key)) key = `${key}_2`; seen.add(key); const rule: QualificationRule = item?.rule === "ko" || item?.rule === "required" || item?.rule === "info" ? item.rule : "info"; out.push({ key, label: label.slice(0, 200), rule, ...(item?.hint ? { hint: String(item.hint).slice(0, 200) } : {}) }); }
  return out;
}

const NEG = /(kein interesse|nicht interessiert|nein danke|keinen bedarf|nicht anrufen|nicht mehr anrufen|nicht angerufen|keine anrufe|keine weitergabe|daten löschen|löschen sie meine daten|nicht gewünscht|nicht erwünscht|kein termin|keinen termin)/i;
/** Regelbasierte Antworten aus dem Transkript (ohne KI): Stichworte je Frage; „unklar“, wenn nichts Belastbares gefunden wird. */
export function answerQuestionsHeuristically(questions: QualificationQuestion[], transcript: string): Record<string, QualificationAnswer> {
  const text = transcript.toLowerCase(); const answers: Record<string, QualificationAnswer> = {};
  const mentions = (pattern: RegExp) => pattern.test(text);
  for (const question of questions) {
    const label = question.label.toLowerCase(); const key = question.key;
    let answer: QualificationAnswer = { answer: "unklar" };
    if (/photovoltaik|pv\b/.test(label)) answer = { answer: mentions(/photovoltaik|pv-anlage|solaranlage/) ? "ja" : "nein", note: mentions(/photovoltaik|pv-anlage|solaranlage/) ? "Photovoltaik wurde angesprochen" : "Kein Hinweis auf Photovoltaik" };
    else if (/wärmepumpe|waermepumpe/.test(label)) answer = { answer: mentions(/wärmepumpe|waermepumpe/) ? "ja" : "nein", note: mentions(/wärmepumpe|waermepumpe/) ? "Wärmepumpe wurde angesprochen" : "Kein Hinweis auf Wärmepumpe" };
    else if (/wintergarten/.test(label)) answer = { answer: mentions(/wintergarten|glashaus|terrassenüberdachung/) ? "ja" : "nein", note: mentions(/wintergarten/) ? "Wintergarten wurde angesprochen" : "Kein Hinweis auf Wintergarten" };
    else if (/interesse/.test(label)) answer = NEG.test(text) ? { answer: "nein", note: "Kunde äußert kein Interesse" } : mentions(/interess|gerne|klingt gut|möchte|hätte gern|angebot/) ? { answer: "ja", note: "Kunde zeigt Interesse" } : { answer: "unklar" };
    else if (/vor-ort|vor ort|termin/.test(label)) answer = mentions(/kein termin|keinen termin|nicht vor ort/) ? { answer: "nein", note: "Kunde lehnt Termin ab" } : mentions(/termin|vor ort|vorbeikommen|besichtigung|aufmaß/) && mentions(/monat|woche|tage|nächste|kommende|zeitnah|bald|ja,? gerne|passt/) ? { answer: "ja", note: "Termin innerhalb eines Monats zugesagt" } : mentions(/termin|vor ort/) ? { answer: "unklar", note: "Termin angesprochen, Zeitraum unklar" } : { answer: "unklar" };
    else if (/telefon|kontaktaufnahme|rückruf|anruf/.test(label)) answer = mentions(/nicht anrufen|nicht mehr anrufen|nicht angerufen|keine anrufe|nicht telefonisch|keine weitergabe/) ? { answer: "nein", note: "Kunde möchte nicht angerufen werden" } : mentions(/anrufen|rückruf|telefonisch|erreichbar|melden sie sich|kontakt aufnehmen/) ? { answer: "ja", note: "Telefonische Kontaktaufnahme gewünscht" } : { answer: "unklar" };
    else if (/alle fragen/.test(label)) { const asked = questions.filter((item) => item.key !== key && answers[item.key]?.answer !== "unklar" && answers[item.key]?.answer !== undefined).length; answer = asked >= Math.max(1, questions.length - 2) ? { answer: "ja", note: `${asked} von ${questions.length - 1} Fragen belegt` } : { answer: "nein", note: `${asked} von ${questions.length - 1} Fragen belegt` }; }
    answers[key] = answer;
  }
  return answers;
}
export function summarizeAnswers(records: Array<Record<string, QualificationAnswer> | null | undefined>, questions: QualificationQuestion[]) {
  return questions.map((question) => { let ja = 0; let nein = 0; let unklar = 0; for (const record of records) { const item = record?.[question.key]; if (!item) continue; if (item.answer === "ja") ja += 1; else if (item.answer === "nein") nein += 1; else unklar += 1; } const total = ja + nein + unklar; return { key: question.key, label: question.label, ja, nein, unklar, total, jaShare: total ? Math.round((ja / total) * 100) : 0 }; });
}

export type QuestionDecision = { decision: "freigegeben" | "pruefen" | "zurueckgewiesen"; reason: string } | null;
/** Entscheidung allein nach den Kampagnenfragen. null = keine entscheidende Frage in der Kampagne (dann greift die allgemeine Bewertung). */
export function decideByQuestions(questions: QualificationQuestion[], answers: Record<string, QualificationAnswer> | null | undefined): QuestionDecision {
  const decisive = questions.filter((question) => question.rule === "ko" || question.rule === "required");
  if (!decisive.length) return null;
  const value = (key: string) => answers?.[key]?.answer ?? "unklar";
  const koNo = decisive.find((question) => question.rule === "ko" && value(question.key) === "nein");
  if (koNo) return { decision: "zurueckgewiesen", reason: `K.-o.: „${koNo.label}“ = Nein` };
  const requiredNo = decisive.find((question) => question.rule === "required" && value(question.key) === "nein");
  if (requiredNo) return { decision: "zurueckgewiesen", reason: `Pflichtfrage „${requiredNo.label}“ = Nein` };
  const unclear = decisive.find((question) => value(question.key) === "unklar");
  if (unclear) return { decision: "pruefen", reason: `„${unclear.label}“ ist unklar – bitte reinhören` };
  return { decision: "freigegeben", reason: `Alle ${decisive.length} entscheidenden Fragen erfüllt` };
}
