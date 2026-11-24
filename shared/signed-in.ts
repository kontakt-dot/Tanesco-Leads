/**
 * Hat sich ein Benutzer wirklich angemeldet?
 * Beim Anlegen setzt die Datenbank „zuletzt angemeldet“ auf den Zeitpunkt des Anlegens. Erst eine Anmeldung danach zählt –
 * mit einer Minute Spielraum, weil die Datenbank auf ganze Sekunden rundet.
 * Ohne Datenbank: Server, Vorschau und Tests nutzen dieselbe Regel (Benutzer-Seite, Erinnerungsmails).
 */
export const SIGN_IN_GRACE_MS = 60_000;

const time = (value: Date | string | number | null | undefined): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const at = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(at) ? at : null;
};

/** true, wenn die letzte Anmeldung nach dem Anlegen des Kontos liegt (mehr als eine Minute). */
export function signedInAfter(lastSignedIn: Date | string | number | null | undefined, createdAt: Date | string | number | null | undefined, graceMs = SIGN_IN_GRACE_MS): boolean {
  const last = time(lastSignedIn); if (last === null) return false;
  const created = time(createdAt); if (created === null) return true;
  return last - created > graceMs;
}

/** Für die Anzeige: die letzte echte Anmeldung – oder null, wenn er sich seit dem Anlegen nie angemeldet hat. */
export function realSignIn<T extends Date | string>(lastSignedIn: T | null | undefined, createdAt: Date | string | number | null | undefined): T | null {
  return lastSignedIn && signedInAfter(lastSignedIn, createdAt) ? lastSignedIn : null;
}
