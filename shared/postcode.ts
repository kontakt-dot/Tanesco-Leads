/**
 * PLZ so, wie sie sein muss.
 *
 * In Deutschland hat jede PLZ 5 Ziffern. Eine mit 4 Ziffern hat ihre führende Null verloren – typisch, wenn eine Liste durch Excel lief
 * oder der Dialer die PLZ als Zahl speichert („09633“ → 9633) – und bekommt sie zurück. „D-01067“ und „01 067“ werden zu „01067“.
 * Österreich und die Schweiz haben 4-stellige PLZ: Dort bleibt alles, wie es ist. Was sich nicht eindeutig richten lässt, bleibt unverändert
 * (die Prüfung unter „API-Fehler“ meldet es).
 */
export function normalizePostcode(value: unknown, country?: string | null): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const land = String(country || "DE").trim().toUpperCase();
  if (land !== "DE") return text;
  const compact = text.replace(/^(?:d|de)\s*-\s*/i, "").replace(/\s+/g, "");
  if (/^\d{5}$/.test(compact)) return compact;
  if (/^\d{4}$/.test(compact)) return `0${compact}`;
  return text;
}
