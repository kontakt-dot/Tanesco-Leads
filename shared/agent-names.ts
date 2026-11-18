/**
 * Agenten-Namen aus Aufnahmen.
 * 1) Erkennen: Der Mitarbeiter stellt sich am Anfang vor („hier ist Maja Becker von HausKompass“, „Becker mein Name“, „die Frau Hansen von …“).
 * 2) Zuordnen: Die Spracherkennung verhört sich („Maja Becker“ / „Maja Decker“, „David Pfeil“ / „David Feiles“) – Namen, die sich ähnlich
 *    anhören, und Namen mit gleichem Nachnamen gelten als dieselbe Person und werden zusammengeführt.
 */
const sound = (value: string) => value.toLowerCase()
  .replace(/ä/g, "e").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "s")
  .replace(/pf/g, "f").replace(/ph/g, "f").replace(/ck/g, "k").replace(/c(?=[aou])/g, "k").replace(/c/g, "z").replace(/z/g, "s").replace(/v/g, "f").replace(/w/g, "f").replace(/y/g, "i").replace(/j/g, "i").replace(/th/g, "t").replace(/dt/g, "t")
  .replace(/[^a-z]+/g, "").replace(/(.)\1+/g, "$1");

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) { const current = [i]; for (let j = 1; j <= b.length; j += 1) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = current; }
  return previous[b.length];
}
const close = (a: string, b: string) => distance(a, b) <= Math.max(1, Math.round(Math.max(a.length, b.length) * 0.34));
const parts = (name: string) => name.trim().split(/\s+/).filter(Boolean);

/** Klingen zwei Agenten-Namen wie dieselbe Person? */
export function sameAgentName(a: string, b: string): boolean {
  const partsA = parts(a); const partsB = parts(b);
  if (!partsA.length || !partsB.length) return false;
  if (sound(a) === sound(b)) return true;
  if (partsA.length < 2 && partsB.length < 2) return false; // zwei einzelne Wörter: nur bei Gleichklang
  if (partsA.length < 2 || partsB.length < 2) { // nur der Nachname genannt („Frau Schiffer“) = der Agent mit diesem Nachnamen
    const single = sound(partsA.length < 2 ? partsA[0] : partsB[0]); const full = partsA.length < 2 ? partsB : partsA; const last = sound(full[full.length - 1]);
    return single.length >= 3 && (single === last || (single.length >= 5 && distance(single, last) <= 1));
  }
  const firstA = sound(partsA[0]); const firstB = sound(partsB[0]); const lastA = sound(partsA[partsA.length - 1]); const lastB = sound(partsB[partsB.length - 1]);
  if (!firstA || !firstB || !lastA || !lastB) return false;
  if (firstA === firstB) return close(lastA, lastB); // gleicher Vorname, Nachname ähnlich (Becker/Decker, Pfeil/Feiles)
  if (lastA === lastB) return true; // gleicher Nachname = immer derselbe Agent (Vanessa/Nesta Schiffer, Monika/Miriam Hansen) – so gewünscht
  return distance(firstA, firstB) <= 1 && distance(lastA, lastB) <= 1; // beides leicht verhört
}

type Known = { name: string; count: number };
/** Reihenfolge der „besten“ Schreibweise: voller Name vor Einzelwort, dann die meisten Gespräche. */
const byQuality = (x: Known, y: Known) => Number(parts(y.name).length >= 2) - Number(parts(x.name).length >= 2) || y.count - x.count || x.name.localeCompare(y.name);

/** Den schon bekannten Namen nehmen, wenn der neue nur anders verstanden wurde oder nur ein Teil des Namens fiel. */
export function canonicalAgentName(name: string, known: Known[]): string {
  const clean = name.trim(); if (!clean) return clean;
  const others = known.filter((item) => item.name && item.name !== clean);
  const matches = others.filter((item) => sameAgentName(item.name, clean));
  if (!matches.length) {
    // Nur der Vorname genannt („hier ist die Vanessa“): zuordnen, wenn genau ein bekannter Agent so heißt
    if (parts(clean).length === 1) { const first = sound(clean); const byFirst = others.filter((item) => parts(item.name).length >= 2 && sound(parts(item.name)[0]) === first); if (byFirst.length === 1) return byFirst[0].name; }
    return clean;
  }
  const own: Known = { name: clean, count: known.find((item) => item.name === clean)?.count ?? 0 };
  const best = [...matches].sort(byQuality)[0];
  return byQuality(best, own) <= 0 ? best.name : clean;
}

/** Gruppen ähnlich klingender Namen → je Gruppe die beste Schreibweise (voller Name, meiste Gespräche). Liefert nur die Umbenennungen. */
export function agentNameMerges(known: Known[]): Array<{ from: string; to: string }> {
  const sorted = [...known].filter((item) => item.name.trim()).sort(byQuality);
  const leaders: string[] = []; const merges: Array<{ from: string; to: string }> = [];
  for (const item of sorted) { const leader = leaders.find((candidate) => sameAgentName(candidate, item.name)); if (leader) merges.push({ from: item.name, to: leader }); else leaders.push(item.name); }
  return merges;
}

/* ------------------------------------------------------------------ Erkennen im Transkript */

/** Großgeschriebene Wörter, die nach „ich bin …“ / „hier ist …“ stehen können, aber keine Namen sind. */
const NOT_NAMES = new Set(["guten", "gute", "hallo", "schönen", "schön", "ja", "nein", "vielen", "danke", "dank", "herr", "herrn", "frau", "agent", "agentin", "kunde", "kundin", "sprecher", "mitarbeiter", "mitarbeiterin", "photovoltaik", "angebotsvergleich", "hauskompass", "haus", "kompass", "campus", "firma", "woche", "wochen", "tag", "morgen", "abend", "mittag", "heute", "moment", "bitte", "genau", "okay", "ok", "gerne", "eigentümer", "eigentümerin", "mieter", "mieterin", "rentner", "rentnerin", "besitzer", "besitzerin", "inhaber", "inhaberin", "entscheider", "entscheiderin", "interessiert", "zuhause", "hause", "unterwegs", "sie", "ich", "wir", "ihnen", "das", "der", "die", "wärmepumpe", "wärmepumpen", "solar", "solaranlage", "anlage", "energie", "beratung", "telefon", "apparat", "name", "gespräch", "anruf", "rückruf", "thema", "grund", "zeit", "deutschland", "wattfox", "team", "service", "kundenservice", "zufrieden", "einverstanden", "sicher", "richtig", "leider", "super", "alles", "tschüss", "wiederhören", "entschuldigung", "also", "und", "aber", "noch", "nochmal", "gerade", "jetzt", "dann", "hier", "dort", "immer", "schon", "eben", "mal", "ihr", "ihre", "ihrem", "ihren", "mein", "meine", "unser", "unsere", "ein", "eine", "es", "er", "da", "so", "wie", "was", "wer", "wegen", "bezüglich", "zum", "zur", "im", "in", "am", "an", "auf", "mit", "von", "vom", "für"]);

/** Aus einem Fund nur die Namenswörter behalten: großgeschrieben, am Stück, keine Füllwörter („Maja Becker“, nicht „von“). */
export function cleanAgentName(raw: string): string | null {
  const all = raw.replace(/[^A-Za-zÄÖÜäöüßéèÉ\- ]/g, " ").trim().split(/\s+/).filter(Boolean);
  const words: string[] = [];
  for (const word of all) { if (!/^[A-ZÄÖÜÉ]/.test(word) || NOT_NAMES.has(word.toLowerCase()) || word.length < 2) { if (words.length) break; continue; } words.push(word); if (words.length === 3) break; }
  if (!words.length) return null;
  const value = words.join(" "); return value.length >= 3 && value.length <= 60 ? value : null;
}

const WORD = "[A-ZÄÖÜÉ][a-zäöüßéè]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?";
const NAME = `(${WORD}(?: ${WORD}){0,2})`;
const ARTICLE = "(?:(?:der|die) )?(?:(?:Frau|Herr) )?";
const COMPANY_CUE = /^[,.]?\s*(?:und (?:ich )?(?:rufe|melde)[^.]{0,40}?)?(?:ich rufe (?:Sie )?an |ich melde mich )?(?:von|vom|aus dem Hause|im Auftrag von|im Auftrag der)\s+(?:der |dem |den )?(?:Firma )?[A-ZÄÖÜ]/;

export type AgentDetection = { name: string; sure: boolean };
/**
 * Name des Mitarbeiters aus der Vorstellung am Gesprächsanfang.
 * „sure“ = eindeutige Vorstellung (mit Firma dahinter oder klare Formel ganz am Anfang); sonst nur vermutet.
 * `known` hilft, wenn keine Formel passt: steht ein bekannter Agenten-Name (auch verhört) am Anfang, wird er genommen.
 */
export function detectAgent(transcript: string, known: string[] = []): AgentDetection | null {
  const head = transcript.slice(0, 2500).replace(/\s+/g, " ");
  const found: Array<{ index: number; name: string; sure: boolean }> = [];
  const add = (index: number, raw: string, after: string, formula: boolean, strongFormula: boolean) => {
    const name = cleanAgentName(raw); if (!name) return;
    const cue = COMPANY_CUE.test(after.slice(0, 90));
    const single = parts(name).length === 1;
    // sicher: Firma direkt dahinter – oder eine klare Vorstellungsformel früh im Gespräch (ein einzelnes Wort nur mit „mein Name“/Firma)
    const sure = cue || (formula && index < 700 && (!single || strongFormula));
    found.push({ index, name, sure });
  };
  // A: „hier ist / hier spricht / mein Name ist / ich bin / ich heiße / Sie sprechen mit … NAME“
  const intro = new RegExp(`(?:[Hh]ier ist(?: noch ?mal)?|[Hh]ier spricht|[Mm]ein Name ist|[Mm]ein Name lautet|[Ii]ch hei(?:ß|ss)e|[Ss]ie sprechen mit|[Aa]m Apparat ist|[Ii]ch bin|[Hh]ier (?:ist |spricht )?(?:der|die))\\s+${ARTICLE}${NAME}`, "g");
  for (const match of Array.from(head.matchAll(intro))) add(match.index ?? 0, match[1], head.slice((match.index ?? 0) + match[0].length), true, /[Mm]ein Name|hei(?:ß|ss)e|sprechen mit|Apparat/.test(match[0]));
  // B: „NAME mein Name / ist mein Name / am Apparat / hier“
  const outro = new RegExp(`${NAME},? (?:ist )?(?:mein Name|am Apparat|hier(?= |,|\\.|$))`, "g");
  for (const match of Array.from(head.matchAll(outro))) { const strong = /mein Name|Apparat/.test(match[0]); if (!strong && /\b(?:Herr|Herrn|Frau)\b/.test(match[1])) continue; /* „Herr Müller hier“ = Kunde */ add(match.index ?? 0, match[1], head.slice((match.index ?? 0) + match[0].length), true, strong); }
  // C: „NAME von (der Firma) X“ – auch ohne Formel davor
  const company = new RegExp(`${NAME}(?=,? (?:von|vom|aus dem Hause|im Auftrag von) (?:der |dem )?(?:Firma )?[A-ZÄÖÜ])`, "g");
  for (const match of Array.from(head.matchAll(company))) {
    const index = match.index ?? 0; const before = head.slice(Math.max(0, index - 30), index);
    // „Guten Tag Herr Müller, …“ ist die Anrede des Kunden – außer es heißt „hier ist die Frau …“
    if (/(?:Herr|Herrn|Frau) $/.test(before) && !/(?:ist|spricht|bin) (?:noch ?mal )?(?:der |die )?(?:Herr|Frau) $/.test(before)) continue;
    if (/\b(?:Herr|Herrn|Frau)\b/.test(match[1])) continue; // „Tag Herr Müller von …“ – ebenfalls Anrede (die Vorstellung „hier ist die Frau …“ deckt Formel A ab)
    add(index, match[1], head.slice(index + match[0].length), false, false);
  }
  found.sort((x, y) => x.index - y.index);
  const best = found.find((item) => item.sure) ?? null;
  if (best) return { name: best.name, sure: true };
  // Kein eindeutiger Fund: steht ein bekannter Agent (auch verhört) in den ersten Sätzen?
  const opening = head.slice(0, 700); const words = opening.split(/[^A-Za-zÄÖÜäöüßéè-]+/).filter(Boolean);
  for (const candidate of known.filter((name) => parts(name).length >= 2)) {
    const [first, ...rest] = parts(candidate); const last = rest[rest.length - 1]; const soundFirst = sound(first); const soundLast = sound(last);
    for (let i = 0; i + 1 < words.length; i += 1) if (/^[A-ZÄÖÜ]/.test(words[i]) && /^[A-ZÄÖÜ]/.test(words[i + 1]) && distance(sound(words[i]), soundFirst) <= 1 && distance(sound(words[i + 1]), soundLast) <= 1) return { name: candidate, sure: true };
  }
  return found.length ? { name: found[0].name, sure: false } : null;
}
/** Kurzform: nur der Name (für ältere Aufrufe). */
export const detectAgentName = (transcript: string, known: string[] = []): string | null => detectAgent(transcript, known)?.name ?? null;
