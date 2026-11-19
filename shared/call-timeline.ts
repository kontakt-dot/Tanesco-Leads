/**
 * Zeitmarken eines Gesprächs: Abschnitte der Abschrift mit ihrer Zeit (aus der Umwandlung in Text) und – je Prüffrage und
 * Kriterium – die Stelle im Gespräch, an der es besprochen wird. Daraus entstehen die Zeiten im Gespräch („1:31“), ein Klick
 * springt in der Aufnahme dorthin.
 */
/** Ein Abschnitt der Abschrift: Beginn und Ende in Sekunden, Text, bei getrennten Sprechern die Nummer des Sprechers (ab 0). */
export type CallSegment = { s: number; e: number; t: string; sp?: number };
/** `marks`: Stelle je Punkt in Sekunden – Schlüssel „q:<Frage>“ bzw. „c:<Kriterium>“. `note`: warum es keine Zeitmarken gibt. */
export type CallTimeline = { segments: CallSegment[]; marks: Record<string, number>; note?: string | null };
export const questionMark = (key: string) => `q:${key}`;
export const criterionMark = (key: string) => `c:${key}`;

/** Ein Punkt der Bewertung, zu dem die Stelle im Gespräch gesucht wird. */
export type MarkItem = { id: string; kind: "Frage" | "Kriterium"; label: string; result: string; note: string };
/** Prüffragen (mit Antwort und Beleg) und Kriterien (mit Punkten und Beleg) als Liste – Fragen, die für dieses Gespräch entfallen, bleiben weg. */
export function markItems(questions: Array<{ key: string; label: string }>, answers: Record<string, { answer: string; note?: string | null }> | null | undefined, criteria: Array<{ key: string; label: string }>, scores: Array<{ key: string; score: number; evidence?: string | null }>): MarkItem[] {
  const items: MarkItem[] = [];
  for (const question of questions) { const given = answers?.[question.key]; if (!given || /^Entfällt/i.test(given.note ?? "")) continue; items.push({ id: questionMark(question.key), kind: "Frage", label: question.label, result: given.answer === "ja" ? "Ja" : given.answer === "nein" ? "Nein" : "unklar", note: given.note ?? "" }); }
  for (const criterion of criteria) { const score = scores.find((item) => item.key === criterion.key); if (!score) continue; items.push({ id: criterionMark(criterion.key), kind: "Kriterium", label: criterion.label, result: `${score.score} von 10 Punkten`, note: score.evidence ?? "" }); }
  return items;
}

/** Stand der Zeitmarken eines Gesprächs: „ok“ = vorhanden, „fehlt“ = lassen sich aus der Aufnahme nachholen, „ohne“ = gibt es nicht (Grund in `note`). */
export type TimelineState = "ok" | "fehlt" | "ohne";
export function timelineStateOf(call: { timeline?: unknown; transcript?: string | null; recordingUrl?: string | null; status?: string | null }): { state: TimelineState; note: string | null } {
  const timeline = readTimeline(call.timeline);
  if (timeline?.segments.length) return { state: "ok", note: null };
  if (timeline) return { state: "ohne", note: timeline.note ?? null }; // schon versucht – nicht bei jedem Öffnen wieder
  if (call.transcript && call.recordingUrl && (call.status === "bewertet" || call.status === "transkribiert")) return { state: "fehlt", note: null };
  return { state: "ohne", note: null };
}

/** Vorschau ohne Aufnahme: Adresse „vorschau:<Sekunden>“ – der Abspieler lässt dann nur die Uhr laufen (Spulen, Tempo und Zeiten wie mit Aufnahme, ohne Ton). */
export const previewSource = (seconds: number | null | undefined) => `vorschau:${Math.max(1, Math.round(Number(seconds) > 0 ? Number(seconds) : 60))}`;
/** Länge einer Vorschau-Adresse in Sekunden; 0, wenn es eine echte Aufnahme ist. */
export const previewLength = (source: string | null | undefined) => Number(/^vorschau:(\d+)$/.exec(String(source ?? ""))?.[1] ?? 0);

/** 91 → „1:31“; ab einer Stunde „1:02:05“. */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0)); const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
/** „1:31“, „01:31“, „[1:31]“, „1:02:05“ oder „91“ → Sekunden; alles andere null. */
export function parseClock(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const text = String(value ?? "").trim().replace(/^\[|\]$/g, "").replace(/\s*(uhr|min\.?|minuten?)$/i, "").trim(); if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const match = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$/.exec(text); if (!match) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}
const MAX_SEGMENTS = 1500; const MAX_SEGMENT_TEXT = 600;
/** Abschnitte säubern: nur brauchbare Zahlen und Texte, nach Zeit sortiert, in der Menge begrenzt. */
export function normalizeSegments(input: unknown): CallSegment[] {
  if (!Array.isArray(input)) return [];
  const out: CallSegment[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue; const raw = item as Record<string, unknown>;
    const start = Number(raw.s ?? raw.start); const text = String(raw.t ?? raw.text ?? raw.transcript ?? "").replace(/\s+/g, " ").trim();
    if (!Number.isFinite(start) || start < 0 || !text) continue;
    const endRaw = Number(raw.e ?? raw.end); const end = Number.isFinite(endRaw) && endRaw >= start ? endRaw : start;
    const speakerRaw = raw.sp ?? raw.speaker; const speaker = typeof speakerRaw === "number" && Number.isInteger(speakerRaw) && speakerRaw >= 0 && speakerRaw < 20 ? speakerRaw : undefined;
    out.push({ s: Math.round(start * 10) / 10, e: Math.round(end * 10) / 10, t: text.slice(0, MAX_SEGMENT_TEXT), ...(speaker !== undefined ? { sp: speaker } : {}) });
    if (out.length >= MAX_SEGMENTS) break;
  }
  return out.sort((a, b) => a.s - b.s);
}
/** Gespeicherte Zeitmarken lesen – alles Unbrauchbare fällt weg. */
export function readTimeline(input: unknown): CallTimeline | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null; const raw = input as Record<string, unknown>;
  const segments = normalizeSegments(raw.segments); const marks: Record<string, number> = {};
  if (raw.marks && typeof raw.marks === "object" && !Array.isArray(raw.marks)) for (const [key, value] of Object.entries(raw.marks as Record<string, unknown>)) { const seconds = Number(value); if (/^[qc]:.{1,64}$/.test(key) && Number.isFinite(seconds) && seconds >= 0) marks[key] = Math.round(seconds * 10) / 10; }
  return { segments, marks, ...(typeof raw.note === "string" && raw.note.trim() ? { note: raw.note.trim().slice(0, 240) } : {}) };
}
/** Abschrift mit Zeitmarke am Zeilenanfang – so bekommt sie die KI, wenn sie die Stellen sucht. */
export function timedTranscript(segments: CallSegment[]): string {
  return segments.map((segment) => `[${clock(segment.s)}] ${segment.sp !== undefined ? `Sprecher ${segment.sp + 1}: ` : ""}${segment.t}`).join("\n");
}
/** Nummer des Abschnitts, der zu dieser Zeit läuft (der letzte, der schon begonnen hat); -1, wenn noch keiner begonnen hat. */
export function segmentIndexAt(segments: CallSegment[], seconds: number): number {
  let found = -1;
  for (let index = 0; index < segments.length; index += 1) { if (segments[index].s <= seconds + 0.05) found = index; else break; }
  return found;
}
/** Eine genannte Zeit auf den Anfang ihres Abschnitts ziehen – die Aufnahme springt an den Satzanfang, nicht mitten ins Wort. Außerhalb des Gesprächs: null. */
export function snapToSegment(segments: CallSegment[], seconds: number | null): number | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0 || !segments.length) return null;
  const last = segments[segments.length - 1]; if (seconds > Math.max(last.e, last.s) + 5) return null;
  const index = segmentIndexAt(segments, seconds); return segments[Math.max(0, index)].s;
}

const STOP = new Set("aber alle allem allen aller alles also auch auf aus bei beim bin bis bist dann das dass dem den denn der des die dies diese diesem diesen dieser dieses doch dort durch ein eine einem einen einer eines er es für gegen gibt hab habe haben hat hatte hatten hier ich ihm ihn ihr ihre ihrem ihren ihrer im in ist ja kann kein keine keinem keinen keiner man mehr mein meine mit muss nach nicht noch nun nur ob oder ohne sehr sein seine sich sie sind so soll über um und uns unser unter vom von vor war was weil wenn wer wie wir wird wurde zu zum zur kunde kunden kundin mitarbeiter mitarbeiterin agent agentin frage gefragt gespräch sagt sagte antwortet antwort wurde wurden genannt nennt".split(" "));
const words = (text: string) => Array.from(new Set(text.toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").split(" ").filter((word) => word.length >= 4 && !STOP.has(word))));
/** Wörtlich Zitiertes aus einem Beleg („…“ oder "…") – das steht so auch in der Abschrift und führt am sichersten zur Stelle. */
const quoted = (text: string) => Array.from(text.matchAll(/[„“"»«]([^„“”"»«]{12,400})[“”"»«]/g)).map((match) => match[1].trim());
/**
 * Stelle ohne KI finden: der Abschnitt, dessen Wörter am besten zum Beleg passen. Wörtliche Zitate im Beleg zählen zuerst.
 * Passt nichts überzeugend (weniger als zwei gemeinsame, aussagekräftige Wörter), gibt es keine Stelle.
 */
export function locateByWords(segments: CallSegment[], text: string | null | undefined): number | null {
  const source = String(text ?? "").trim(); if (!source || !segments.length) return null;
  const bags = segments.map((segment) => new Set(words(segment.t)));
  const rarity = new Map<string, number>(); for (const bag of bags) bag.forEach((word) => rarity.set(word, (rarity.get(word) ?? 0) + 1));
  const best = (needles: string[]) => {
    let top = -1; let hits = 0; let ownHits = 0; let weight = 0;
    bags.forEach((bag, index) => {
      // Zwei Abschnitte zusammen betrachten (eine Antwort geht oft über die Abschnittsgrenze) – bei Gleichstand gewinnt der Abschnitt, der selbst mehr davon enthält
      const next = index + 1 < bags.length ? bags[index + 1] : null;
      let count = 0; let own = 0; let sum = 0;
      for (const needle of needles) { const inOwn = bag.has(needle); if (inOwn || next?.has(needle)) { count += 1; sum += 1 / Math.sqrt(rarity.get(needle) ?? 1); } if (inOwn) own += 1; }
      if (own === 0) return; // die Stelle beginnt in einem Abschnitt, der selbst etwas davon enthält
      if (count > hits || (count === hits && (own > ownHits || (own === ownHits && sum > weight + 1e-9)))) { top = index; hits = count; ownHits = own; weight = sum; }
    });
    return hits >= 2 ? segments[top].s : null;
  };
  for (const quote of quoted(source)) { const found = best(words(quote)); if (found !== null) return found; }
  return best(words(source));
}
