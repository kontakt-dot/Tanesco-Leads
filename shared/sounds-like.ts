/**
 * „Klingt wie“: Transkripte kommen aus automatischer Spracherkennung – Firmennamen werden oft falsch geschrieben
 * („Haus Campus“, „Hauskompas“, „Haus Kompaß“ statt „HausKompass“). Für die Prüfung zählt, ob etwas gesagt wurde,
 * das sich wie der Name anhört: Der Gesprächspartner ordnet es trotzdem richtig zu.
 */
const sound = (value: string) => value.toLowerCase()
  .replace(/ä/g, "e").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "s")
  .replace(/ph/g, "f").replace(/ck/g, "k").replace(/c(?=[aou])/g, "k").replace(/c/g, "z").replace(/z/g, "s").replace(/v/g, "f").replace(/y/g, "i")
  .replace(/[^a-z]+/g, "").replace(/(.)\1+/g, "$1");

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) { const current = [i]; for (let j = 1; j <= b.length; j += 1) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = current; }
  return previous[b.length];
}

/** Kommt im Text etwas vor, das sich wie `name` anhört? Erlaubt je nach Namenslänge ein paar abweichende Laute; der Anfang muss stimmen. */
export function soundsLike(text: string, name: string): boolean {
  const target = sound(name); if (target.length < 4) return sound(text).includes(target);
  const allowed = Math.max(1, Math.floor(target.length * 0.3));
  const words = text.toLowerCase().split(/[^a-zäöüß]+/).filter(Boolean);
  for (let start = 0; start < words.length; start += 1) {
    let joined = "";
    for (let count = 0; count < 3 && start + count < words.length; count += 1) { // bis zu drei Wörter am Stück („Haus Kom Pass“)
      joined += words[start + count]; const candidate = sound(joined);
      if (candidate.length < target.length - allowed) continue; if (candidate.length > target.length + allowed) break;
      if (candidate.slice(0, 3) === target.slice(0, 3) && distance(candidate, target) <= allowed) return true;
    }
  }
  return false;
}
