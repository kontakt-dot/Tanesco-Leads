/**
 * Antworten der KI robust lesen.
 *
 * Die KI liefert strukturierte Ergebnisse über ein Schema. In der Praxis kommen verschachtelte Listen trotzdem manchmal
 *  - als Text (JSON in einem String, teils mit ```-Zaun),
 *  - als Objekt statt Liste ({schlüssel: {score, evidence}}),
 *  - mit anderen Feldnamen (punkte/beleg statt score/evidence) oder
 *  - mit dem Titel statt dem Schlüssel als Kennung.
 * Früher führte das dazu, dass alle Kriterien stillschweigend mit 0 Punkten gespeichert wurden. Hier wird jede dieser Formen gelesen –
 * und wenn wirklich nichts da ist, meldet der Aufrufer „nicht bewertet“ statt 0.
 */

/** Flache Feldnamen im Schema (z. B. punkte_interesse): nur a–z, 0–9, _ – eindeutig je Liste. */
export function fieldNames(keys: string[], prefix: string): string[] {
  const used = new Set<string>();
  return keys.map((key, index) => {
    let safe = key.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || `nr${index + 1}`;
    while (used.has(safe)) safe = `${safe.slice(0, 36)}_${index + 1}`;
    used.add(safe);
    return `${prefix}_${safe}`;
  });
}

const norm = (value: unknown) => String(value ?? "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "");

/** Text → JSON, auch mit ```-Zaun oder Text drumherum. */
function parseLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!trimmed) return undefined;
  try { return JSON.parse(trimmed); } catch { /* weiter unten: Teile retten */ }
  const start = trimmed.search(/[[{]/); const end = Math.max(trimmed.lastIndexOf("]"), trimmed.lastIndexOf("}"));
  if (start >= 0 && end > start) { try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* einzelne Objekte retten */ } }
  const objects: unknown[] = [];
  for (const match of Array.from(trimmed.matchAll(/\{[^{}]*\}/g))) { try { objects.push(JSON.parse(match[0])); } catch { /* dieses Stück ist kaputt */ } }
  return objects.length ? objects : undefined;
}

/** Liste von Einträgen aus Liste, Objekt oder Text. Bei einem Objekt wird der Schlüssel als „key“ in den Eintrag gelegt. */
export function looseItems(value: unknown): Array<Record<string, unknown>> {
  const source = typeof value === "string" ? parseLoose(value) : value;
  if (Array.isArray(source)) return source.flatMap((item): Array<Record<string, unknown>> => (item && typeof item === "object" && !Array.isArray(item) ? [item as Record<string, unknown>] : typeof item === "string" ? looseItems(item) : []));
  if (source && typeof source === "object") {
    const record = source as Record<string, unknown>;
    // Ein einzelner Eintrag ({key, score, evidence}) statt einer Liste
    if ("key" in record && ("score" in record || "answer" in record)) return [record];
    return Object.entries(record).map(([key, entry]) => (entry && typeof entry === "object" && !Array.isArray(entry) ? { key, ...(entry as Record<string, unknown>) } : { key, value: entry }));
  }
  return [];
}

/** Liste von Texten aus Liste oder Text (JSON-Liste oder Zeilen). */
export function looseStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  const text = value.trim(); if (!text || /^(keine|nichts|none|n\/a|-|–|\[\s*\])$/i.test(text)) return [];
  if (text.startsWith("[")) { const parsed = parseLoose(text); if (Array.isArray(parsed)) return parsed.map((item) => String(item ?? "").trim()).filter(Boolean); }
  return text.split(/\n+/).map((line) => line.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean);
}

const first = (item: Record<string, unknown>, names: string[]) => { for (const name of names) if (item[name] !== undefined && item[name] !== null) return item[name]; return undefined; };

/** Punkte 0–10 aus Zahl oder Text („8“, „8/10“, „8 von 10“, „80 %“); undefined, wenn keine Zahl da ist. */
export function toScore(value: unknown): number | undefined {
  if (typeof value === "boolean") return value ? 10 : 0;
  if (value === null || value === undefined || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(String(value).replace(",", ".").match(/-?\d+(?:\.\d+)?/)?.[0] ?? NaN);
  if (!Number.isFinite(number)) return undefined;
  const scaled = number > 10 && number <= 100 ? number / 10 : number;
  return Math.max(0, Math.min(10, Math.round(scaled)));
}

type Keyed = { key: string; label: string };
/** Einträge den erwarteten Schlüsseln zuordnen: exakter Schlüssel, Titel, „schlüssel: titel“ – und zuletzt nach Reihenfolge, wenn die Anzahl passt. */
function assign<T extends Keyed>(expected: T[], items: Array<Record<string, unknown>>): Array<Record<string, unknown> | undefined> {
  const idOf = (item: Record<string, unknown>) => first(item, ["key", "schluessel", "schlüssel", "name", "kriterium", "criterion", "frage", "question", "id", "label", "titel", "title"]);
  const taken = new Set<number>();
  const result = expected.map((entry) => {
    const wantKey = norm(entry.key); const wantLabel = norm(entry.label);
    const index = items.findIndex((item, position) => {
      if (taken.has(position)) return false; const raw = String(idOf(item) ?? ""); const id = norm(raw); if (!id) return false;
      if (id === wantKey || (wantLabel && id === wantLabel)) return true;
      const head = norm(raw.split(/[:–—]| - /)[0]); // „interesse: Interesse am Produkt“
      return Boolean(head) && (head === wantKey || head === wantLabel);
    });
    if (index >= 0) { taken.add(index); return items[index]; }
    return undefined;
  });
  if (result.every((item) => item === undefined) && items.length === expected.length) return items; // Kennungen unbrauchbar, aber vollständig und in Reihenfolge
  return result;
}

export type ScoredCriterion = { key: string; score: number; evidence: string };
/**
 * Punkte und Belege je Kriterium lesen. Reihenfolge der Quellen:
 *  1. flache Felder (punkte_<schlüssel> / beleg_<schlüssel>) – so fragt das Schema inzwischen,
 *  2. „criteria“ als Liste, Objekt oder Text (ältere Form und alles, was die KI stattdessen liefert).
 * Liefert nur Kriterien, für die wirklich Punkte da sind.
 */
export function readCriteriaScores(parsed: Record<string, unknown>, criteria: Keyed[]): ScoredCriterion[] {
  const scoreFields = fieldNames(criteria.map((criterion) => criterion.key), "punkte"); const evidenceFields = fieldNames(criteria.map((criterion) => criterion.key), "beleg");
  const legacy = assign(criteria, looseItems(parsed.criteria ?? parsed.kriterien ?? parsed.bewertung));
  const out: ScoredCriterion[] = [];
  criteria.forEach((criterion, index) => {
    let score = toScore(parsed[scoreFields[index]]); let evidence = parsed[evidenceFields[index]];
    if (score === undefined && legacy[index]) { const item = legacy[index]!; score = toScore(first(item, ["score", "punkte", "points", "wert", "bewertung", "value"])); evidence = first(item, ["evidence", "beleg", "begruendung", "begründung", "reason", "note", "zitat"]); }
    if (score !== undefined) out.push({ key: criterion.key, score, evidence: String(evidence ?? "").trim().slice(0, 1500) });
  });
  return out;
}

export type ReadAnswer = { key: string; answer: "ja" | "nein" | "unklar"; note: string };
const toAnswer = (value: unknown): ReadAnswer["answer"] | undefined => {
  if (typeof value === "boolean") return value ? "ja" : "nein";
  const text = norm(value); if (!text) return undefined;
  if (/^(ja|yes|true|erfuellt|j)$/.test(text)) return "ja"; if (/^(nein|no|false|nichterfuellt|n)$/.test(text)) return "nein";
  if (/^(unklar|unknown|unclear|offen|unbekannt|keineangabe)$/.test(text)) return "unklar";
  return text.startsWith("ja") ? "ja" : text.startsWith("nein") ? "nein" : text.startsWith("unklar") ? "unklar" : undefined;
};
/** Antworten je Prüffrage lesen: flache Felder (antwort_<schlüssel> / notiz_<schlüssel>), sonst „answers“ in jeder Form. */
export function readAnswers(parsed: Record<string, unknown>, questions: Keyed[]): ReadAnswer[] {
  const answerFields = fieldNames(questions.map((question) => question.key), "antwort"); const noteFields = fieldNames(questions.map((question) => question.key), "notiz");
  const legacy = assign(questions, looseItems(parsed.answers ?? parsed.antworten));
  const out: ReadAnswer[] = [];
  questions.forEach((question, index) => {
    let answer = toAnswer(parsed[answerFields[index]]); let note = parsed[noteFields[index]];
    if (answer === undefined && legacy[index]) { const item = legacy[index]!; answer = toAnswer(first(item, ["answer", "antwort", "value", "ergebnis"])); note = first(item, ["note", "beleg", "notiz", "begruendung", "begründung", "evidence", "reason"]); }
    if (answer !== undefined) out.push({ key: question.key, answer, note: String(note ?? "").trim().slice(0, 1500) });
  });
  return out;
}

/** Kurzbeschreibung dessen, was die KI geliefert hat – für die Meldung, wenn nichts lesbar war. */
export function describeShape(parsed: Record<string, unknown>): string {
  const keys = Object.keys(parsed); if (!keys.length) return "leere Antwort";
  const criteria = parsed.criteria;
  const kind = criteria === undefined ? "" : Array.isArray(criteria) ? `, criteria: Liste (${criteria.length})` : typeof criteria === "string" ? `, criteria: Text „${criteria.slice(0, 60)}…“` : `, criteria: ${typeof criteria}`;
  return `Felder: ${keys.slice(0, 14).join(", ")}${kind}`.slice(0, 300);
}
