/**
 * Rufnummern für die Übergabe an Käufer (Version 390).
 *
 * Anlass: Die Qualitätskontrolle von Wattfox meldete am 27.11.2026, dass Nummern aus einer anderen Software mit „49…“ ankamen – statt mit
 * „+49…“ oder „0…“. So kann ihr Dialer nicht automatisch anrufen, die Nummer muss von Hand verbessert werden. Bei uns geht keine Nummer so raus:
 *  - an Wattfox immer international und ohne Leerzeichen („+4917012345678“),
 *  - an alle anderen Käufer wie gespeichert – nur kaputte Formen („49…“ ohne Plus, „0049…“, „+49 0…“) werden repariert.
 *
 * Bewusst ohne Datenbank: Server, Vorschau und Tests nutzen dieselbe Logik.
 */

/** Ländervorwahl je Land des Leads – andere Länder rechnen wie Deutschland */
const COUNTRY_CODES: Record<string, string> = { DE: "49", AT: "43", CH: "41" };
const DACH = ["49", "43", "41"] as const;
const asText = (raw: unknown): string => (typeof raw === "number" && Number.isFinite(raw) ? String(raw) : typeof raw === "string" ? raw : "").trim();

/** Eine Nummer (ohne zweite Nummer dahinter) → Ziffern im internationalen Format ohne „+“, sonst null. */
function internationalDigits(text: string, home: string): string | null {
  const cleaned = text.replace(/\(\s*0\s*\)/g, ""); // „+49 (0)170 …“ – die Null in Klammern gehört nicht dazu
  const compact = cleaned.replace(/[^\d+]/g, "");
  if (!compact.replace(/\+/g, "")) return null;
  let digits: string;
  if (compact.startsWith("+")) digits = compact.slice(1).replace(/\D/g, "");
  else if (compact.startsWith("00")) digits = compact.slice(2).replace(/\D/g, "");
  else if (compact.startsWith("0")) digits = home + compact.slice(1).replace(/\D/g, "");
  else if (DACH.some((code) => compact.startsWith(code)) && compact.length >= 11) digits = compact.replace(/\D/g, ""); // „4917012345678“ – Ländervorwahl ohne Plus
  else digits = home + compact.replace(/\D/g, ""); // ohne führende Null („170 1234567“)
  const code = DACH.find((item) => digits.startsWith(item));
  if (code && digits.charAt(code.length) === "0") digits = code + digits.slice(code.length + 1); // „+49 0170 …“ – die Null nach der Ländervorwahl fällt weg
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/**
 * Rufnummer international und ohne Leerzeichen („+4917012345678“) – egal, ob sie als „49…“, „0049…“, „0…“, „+49 (0)…“, „+49 0…“ oder ohne
 * führende Null vorliegt. Stehen zwei Nummern im Feld („0170 … / 089 …“), zählt die erste. `null`, wenn es keine Rufnummer ist.
 */
export function internationalPhone(raw: unknown, country?: string | null): string | null {
  const text = asText(raw); if (!text) return null;
  const home = COUNTRY_CODES[String(country ?? "").trim().toUpperCase()] ?? "49";
  const whole = internationalDigits(text, home); if (whole) return `+${whole}`;
  const first = text.split(/\s[\/|]\s|[,;]|\boder\b|\bod\.|\bbzw\.?/i)[0]; // zweite Nummer dahinter
  const single = first && first !== text ? internationalDigits(first, home) : null;
  return single ? `+${single}` : null;
}

/** Rufnummer im Inland mit „0“ („01701234567“) – Nummern aus einem anderen Land bleiben international. */
export function nationalPhone(raw: unknown, country?: string | null): string | null {
  const international = internationalPhone(raw, country); if (!international) return null;
  const home = COUNTRY_CODES[String(country ?? "").trim().toUpperCase()] ?? "49";
  return international.startsWith(`+${home}`) ? `0${international.slice(home.length + 1)}` : international;
}

/** Kaputte Formen, mit denen ein Dialer nicht wählen kann: „49…“ ohne Plus, „0049…“ und „+49 0…“ (auch für Österreich und die Schweiz). */
export function isBrokenPhone(raw: unknown): boolean {
  const compact = asText(raw).replace(/[\s\-\/().]/g, "");
  return /^(?:00)?(?:49|43|41)\d{6,}$/.test(compact) || /^\+(?:49|43|41)0\d/.test(compact);
}

/** Für alle Käufer außer Wattfox: die Nummer wie gespeichert („0170 1234567“, „+49 170 …“) – nur kaputte Formen werden international. */
export function repairedPhone(raw: unknown, country?: string | null): string {
  const text = asText(raw);
  return text && isBrokenPhone(text) ? internationalPhone(text, country) ?? text : text;
}
