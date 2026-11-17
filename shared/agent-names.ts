/**
 * Agenten-Namen aus Aufnahmen: Die Spracherkennung verhört sich („Maja Becker“ / „Maja Decker“, „David Pfeil“ / „David Feiles“,
 * „Monika Hansen“ / „Miriam Hansen“). Namen, die sich ähnlich anhören, gelten als dieselbe Person und werden zusammengeführt.
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

/** Klingen zwei Agenten-Namen wie dieselbe Person? */
export function sameAgentName(a: string, b: string): boolean {
  const partsA = a.trim().split(/\s+/).filter(Boolean); const partsB = b.trim().split(/\s+/).filter(Boolean);
  if (!partsA.length || !partsB.length) return false;
  if (sound(a) === sound(b)) return true;
  if (partsA.length < 2 || partsB.length < 2) return false; // nur ein Wort (z. B. nur Vorname): ohne Gleichklang nicht zusammenführen
  const firstA = sound(partsA[0]); const firstB = sound(partsB[0]); const lastA = sound(partsA[partsA.length - 1]); const lastB = sound(partsB[partsB.length - 1]);
  if (!firstA || !firstB || !lastA || !lastB) return false;
  if (firstA === firstB) return close(lastA, lastB); // gleicher Vorname, Nachname ähnlich (Becker/Decker, Pfeil/Feiles)
  if (lastA === lastB) return close(firstA, firstB) || firstA[0] === firstB[0]; // gleicher Nachname, Vorname ähnlich oder gleicher Anfangsbuchstabe (Monika/Miriam Hansen)
  return distance(firstA, firstB) <= 1 && distance(lastA, lastB) <= 1; // beides leicht verhört
}

/** Den schon bekannten Namen nehmen, wenn der neue nur anders verstanden wurde – der mit den meisten Gesprächen gewinnt. */
export function canonicalAgentName(name: string, known: Array<{ name: string; count: number }>): string {
  const clean = name.trim(); if (!clean) return clean;
  const matches = known.filter((item) => item.name && item.name !== clean && sameAgentName(item.name, clean));
  if (!matches.length) return clean;
  const own = known.find((item) => item.name === clean)?.count ?? 0;
  const best = matches.sort((x, y) => y.count - x.count || x.name.localeCompare(y.name))[0];
  return best.count >= own ? best.name : clean;
}

/** Gruppen ähnlich klingender Namen → je Gruppe der häufigste Name. Liefert nur die Umbenennungen. */
export function agentNameMerges(known: Array<{ name: string; count: number }>): Array<{ from: string; to: string }> {
  const sorted = [...known].filter((item) => item.name.trim()).sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
  const leaders: string[] = []; const merges: Array<{ from: string; to: string }> = [];
  for (const item of sorted) { const leader = leaders.find((candidate) => sameAgentName(candidate, item.name)); if (leader) merges.push({ from: item.name, to: leader }); else leaders.push(item.name); }
  return merges;
}
