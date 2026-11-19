import { locateByWords, type CallSegment, type CallTimeline, type MarkItem } from "../../../shared/call-timeline";

/**
 * Zeitmarken in der Vorschau. Im echten Betrieb liefert der Dienst, der die Aufnahme in Text umwandelt, je Satz die Zeit,
 * und die KI sucht je Prüffrage und Kriterium die Stelle. Die Vorschau hat weder Aufnahmen noch diesen Dienst – hier werden
 * die Zeilen des Textes über die Dauer des Gesprächs verteilt und die Stellen über Stichwörter gesucht.
 */
export function demoSegments(transcript: string | null | undefined, durationSeconds: number | null | undefined): CallSegment[] {
  const lines = String(transcript ?? "").split(/\n+/).map((line) => line.trim()).filter(Boolean); if (!lines.length) return [];
  const weights = lines.map((line) => line.replace(/^[^:]{1,28}:\s*/, "").length + 16); // jede Zeile braucht etwas Luft
  const total = weights.reduce((sum, value) => sum + value, 0);
  const duration = typeof durationSeconds === "number" && durationSeconds > 0 ? durationSeconds : Math.max(20, Math.round(total / 13));
  const lead = Math.min(3, duration * 0.02); const span = Math.max(1, duration - lead - Math.min(8, duration * 0.04)); // kurz Klingeln am Anfang, Verabschiedung am Ende
  let used = 0;
  return lines.map((line, index) => { const s = lead + (used / total) * span; used += weights[index]; const e = lead + (used / total) * span; return { s: Math.round(s * 10) / 10, e: Math.round(e * 10) / 10, t: line.slice(0, 600) }; });
}

/** Woran man eine Stelle ohne KI erkennt: [worum es beim Punkt geht, was dazu im Gespräch fällt]. */
const TOPICS: Array<[RegExp, RegExp]> = [
  [/hauskompass/i, /hauskompass|haus-kompass/i],
  [/photovoltaik|\bpv\b/i, /photovoltaik|pv-anlage|solar/i],
  [/alter der heizung/i, /gasheizung|ölheizung|heizung/i],
  [/erdgas|gas-?wärmepumpe/i, /gas-?wärmepumpe|gas-?hybrid|gasheizung/i],
  [/wärmepumpe/i, /wärmepumpe/i],
  [/wintergarten/i, /wintergarten/i],
  [/dachfläche|quadratmeter/i, /quadratmeter|\bqm\b|m²|dach/i],
  [/eigentümer|entscheid/i, /eigentümer|gehört|geschäftsführer|entscheide|mit meiner frau|besprechen/i],
  [/zeitrahmen|monate/i, /wann |frühjahr|dieses jahr|zeitnah|monat|weiß ich noch nicht/i],
  [/budget|finanz/i, /budget|finanzierung|kostet|förderung|hausbank/i],
  [/vor-ort|vor ort|termin/i, /termin|vor ort/i],
  [/weitergabe|einwilligung|angebotsvergleich|übergabe/i, /fachbetrieb|angebotsvergleich|daten zu löschen|nicht angerufen werden/i],
  [/kontaktdaten/i, /adresse|stimmt das|erreichbar|per e-mail/i],
  [/telefon|kontaktaufnahme|rückruf/i, /anrufen|telefonisch|erreichbar|nicht angerufen|melde mich/i],
  [/interesse|bedarf/i, /interess|wollen|überlegen|möchte|nirgends etwas angefragt|suchen/i],
];
/** Belege, die sagen, dass etwas im Gespräch gar nicht vorkommt – dafür gibt es keine einzelne Stelle. */
const NOT_SAID = /^kein(e)? (hinweis|ankündigung)|kommt im gespräch nicht vor|nicht angesprochen/i;
/** Stelle je Punkt: zuerst der Beleg (wie auf dem Server ohne KI), sonst das Stichwort zum Punkt. Gibt es keine einzelne Stelle, bleibt der Punkt ohne Zeit. */
export function demoLocateMarks(segments: CallSegment[], items: MarkItem[]): Record<string, number> {
  const marks: Record<string, number> = {}; if (!segments.length) return marks;
  for (const item of items) {
    if (NOT_SAID.test(item.note)) continue; // „kommt nicht vor“ hat keine Stelle
    let at = locateByWords(segments, item.note);
    if (at === null) { const topic = TOPICS.find(([about]) => about.test(item.label)); const hit = topic ? segments.find((segment) => topic[1].test(segment.t)) : undefined; if (hit) at = hit.s; }
    if (at !== null) marks[item.id] = at;
  }
  return marks;
}
export function demoTimeline(transcript: string | null | undefined, durationSeconds: number | null | undefined, items: (segments: CallSegment[]) => MarkItem[]): CallTimeline {
  const segments = demoSegments(transcript, durationSeconds); return { segments, marks: demoLocateMarks(segments, items(segments)) };
}
