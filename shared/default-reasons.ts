/**
 * Standard-Gründe für Reklamationen (v376) – die Liste, mit der die Lieferkette arbeitet: Zu jedem Grund steht je Station,
 * ob der Käufer damit reklamieren darf und ob der Lead danach zur nächsten Station weitergeht oder dort endet.
 * `forward`: Voreinstellung „weitergeben“ – nur dort, wo ein anderer Käufer den Lead noch gebrauchen kann
 * (der Kontakt liegt beim ersten schon vor, oder die Übergabe ist technisch gescheitert). Bei allem anderen endet der Lead.
 * Die Namen entsprechen den Begriffen, die die Partner in ihren Rückmeldungen verwenden – so lassen sich Stornogründe 1:1 zuordnen.
 */
export type DefaultReason = { name: string; forward: boolean; /** kommt auch ohne Reklamation des Käufers vor (die Software setzt ihn selbst) */ system?: boolean };
export const DEFAULT_REASONS: DefaultReason[] = [
  { name: "Dublette", forward: true, system: true },
  { name: "Storno", forward: false },
  { name: "Zustellung fehlgeschlagen (API)", forward: true, system: true },
  { name: "Falsche Telefonnummer", forward: false },
  { name: "Kontaktdaten fehlen", forward: false },
  { name: "Kein Partner", forward: false },
  { name: "Sperrliste", forward: false },
  { name: "Erinnerungsmail (nicht erreicht)", forward: false },
  { name: "Kaufwunsch bereits erloschen", forward: false },
  { name: "AP gibt an, keine Anfrage gestellt zu haben", forward: false },
  { name: "Anderer Grund", forward: false },
  { name: "Derzeit keine Bearbeitung", forward: false },
  { name: "Bearbeitungszeit abgelaufen", forward: false },
  { name: "Keine Auskunftsbereitschaft des Anfragenden", forward: false },
  { name: "Keine Bereitschaft fuer Vorort Termin", forward: false },
  { name: "Email-Adresse wurde nicht bestätigt", forward: false },
  { name: "Informationsinteresse", forward: false },
  { name: "Keine gültige Telefonnummer", forward: false },
  { name: "Keine tel. Erreichbarkeit", forward: false },
  { name: "Kein Interesse am Angebotsvergleich", forward: false },
  { name: "Kein Interesse am Produkt / Thema", forward: false },
  { name: "Kein Interesse an weiteren Angeboten", forward: false },
  { name: "Kein Kontakt gewünscht", forward: false },
  { name: "Nicht vermittelbar - Infoanfrage", forward: false },
  { name: "Nicht vermittelbar - Sonderanliegen", forward: false },
  { name: "Nicht vermittelbar - Sonstiges", forward: false },
  { name: "Nicht vermittelbar - techn. Gründe", forward: false },
  { name: "Spam / Fake", forward: false },
  { name: "Widerruf Datenverarbeitung", forward: false },
  { name: "Person unter Telefonnummer nicht bekannt", forward: false },
];
/** Welche Standard-Gründe fehlen einer vorhandenen Liste? Verglichen wird der Name ohne Groß-/Kleinschreibung. */
export function missingDefaultReasons(existing: Array<string | null | undefined>): DefaultReason[] {
  const known = new Set(existing.map((name) => String(name ?? "").trim().toLowerCase()));
  return DEFAULT_REASONS.filter((reason) => !known.has(reason.name.toLowerCase()));
}
