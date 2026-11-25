/**
 * Zwei Adressen hintereinander im selben Feld („https://alt…https://neu…“) – passiert, wenn man eine neue Adresse einfügt,
 * ohne die alte vorher zu löschen (seit Version 365 geprüft). Für den Rechner ist das trotzdem eine gültige Adresse
 * (die zweite steht dann im Pfad), der Partner antwortet aber nur mit Fehlern – und eine Testadresse vorne hält die
 * Software weiter für die Testumgebung. Eine Adresse in den Parametern (nach „?“ oder „#“) ist erlaubt.
 */
export function hasGluedAddress(value: string | null | undefined): boolean {
  const head = String(value ?? "").trim().split(/[?#]/)[0];
  return (head.match(/https?:\/\//gi) ?? []).length > 1;
}

/** Hinweis direkt unter dem Feld */
export const GLUED_ADDRESS_HINT = "Hier stehen zwei Adressen hintereinander. Ins Feld klicken, alles markieren (Cmd + A, unter Windows Strg + A) und nur die eine Adresse einfügen.";

/** Meldung beim Speichern; `field` = welches Feld */
export function gluedAddressError(field: "oben" | "anmeldung"): string {
  return `${field === "oben" ? "In der Adresse oben (neben „POST“)" : "In der Anmelde-Adresse"} stehen zwei Adressen hintereinander – bitte alles im Feld löschen und nur die eine Adresse einfügen. Gespeichert wurde nichts.`;
}
