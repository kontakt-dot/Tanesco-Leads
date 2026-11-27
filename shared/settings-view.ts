/**
 * Einstellungen: Bereiche in Gruppen, ihre Beschreibungen, die Schalter unter „System“ in einfachen Worten
 * und kleine Prüfungen (Passwort, Reihenfolge der Reklamationsgründe) – ohne Oberfläche, damit sie sich prüfen lassen.
 */
export const SETTING_GROUPS = [
  { label: "Mein Zugang", items: ["Profil", "Passwort"] },
  { label: "Firma", items: ["Branding", "Rechnung & Rechtliches", "Nutzungsbedingungen"] },
  { label: "Leads & Auslieferung", items: ["System", "Reklamationen"] },
  { label: "Versand & Schnittstellen", items: ["E-Mail-Versand", "Integrationen", "API-Dokumentation"] },
] as const;
export type Setting = typeof SETTING_GROUPS[number]["items"][number];
const ALL: Setting[] = SETTING_GROUPS.flatMap((group) => [...group.items]);

/** Eine Zeile unter der Überschrift jedes Bereichs: was man dort einstellt. */
export const SETTING_INFO: Record<Setting, string> = {
  Profil: "Dein Bild, die Darstellung der Software und deine Angaben.",
  Passwort: "Das Passwort für deinen eigenen Zugang.",
  Branding: "Logo, Name, Farbe und die Fußzeile deiner E-Mails.",
  "Rechnung & Rechtliches": "Rechnungsnummern, Steuersatz und der rechtliche Fußtext.",
  Nutzungsbedingungen: "Die Bedingungen der Plattform – und wann sie angenommen wurden.",
  System: "Wie Leads verteilt und übergeben werden – und was mit doppelten Kontakten passiert.",
  Reklamationen: "Die Gründe, aus denen ein Käufer reklamieren kann.",
  "E-Mail-Versand": "Anbieter, Zugang, Testmail, Domain-Prüfung und Antworten-Abgleich für alle ausgehenden E-Mails.",
  Integrationen: "Schnittstellen zu Käufern und Lieferanten und die Zugänge der Partner.",
  "API-Dokumentation": "Zugangsschlüssel und Anleitung für Lead-Import, Reklamationen und Rechnungen.",
};

/**
 * Bereich aus der Adresse (?setting=…). Frühere Namen führen weiter: „E-Mail“ und „Domain“ zum E-Mail-Versand
 * (dort stehen Absender, Domain-Prüfung und Zustellbarkeit), „Ansicht“ zum Profil (dort steht die Darstellung).
 * Die früheren Platzhalter ohne Funktion (Zahlung, Abonnement, Affiliate) gibt es nicht mehr – sie öffnen die Übersicht.
 */
export function settingFromAddress(value: string | null | undefined): Setting | null {
  const name = (value ?? "").trim();
  if (!name) return null;
  if ((ALL as string[]).includes(name)) return name as Setting;
  if (name === "E-Mail" || name === "Domain") return "E-Mail-Versand";
  if (name === "Ansicht") return "Profil";
  return null;
}

export type SystemSwitchKey = "fifo" | "skipEmpty" | "duplicate" | "uploadUpdate" | "preping";
export type SystemSwitch = { key: SystemSwitchKey; group: string; title: string; text: string };
/** Die Schalter unter „System“ – jeder sagt, was bei „an“ passiert und (wo es nicht selbsterklärend ist) was bei „aus“. */
export const SYSTEM_SWITCHES: SystemSwitch[] = [
  { key: "fifo", group: "Auslieferung", title: "Älteste Leads zuerst ausliefern", text: "An: Wartende Leads gehen in der Reihenfolge raus, in der sie reingekommen sind. Aus: Der neueste Lead geht zuerst raus." },
  { key: "skipEmpty", group: "Auslieferung", title: "Leere Felder nicht mitschicken", text: "Bei der Übergabe an Käufer bleiben Angaben ohne Inhalt weg, statt als leeres Feld anzukommen." },
  { key: "duplicate", group: "Doppelte Kontakte", title: "Kein Käufer bekommt denselben Kontakt zweimal", text: "Vor der Übergabe wird geprüft, ob der Käufer diesen Kontakt (gleiche E-Mail-Adresse oder Telefonnummer) schon bekommen hat. Wenn ja, geht der Lead an den nächsten." },
  { key: "uploadUpdate", group: "Doppelte Kontakte", title: "Vorhandene Kontakte beim Hochladen aktualisieren", text: "An: Steht ein Kontakt aus einer neuen Liste schon drin (gleiche E-Mail-Adresse oder Telefonnummer), werden seine Angaben aufgefrischt. Aus: Er bleibt, wie er ist. Doppelt angelegt wird er in keinem Fall." },
  { key: "preping", group: "Ablehnungen", title: "Ablehnungen automatisch als Reklamation erfassen (PrePing)", text: "Lehnt die Schnittstelle eines Käufers einen Lead bei der Übergabe ab, entsteht daraus von selbst eine Reklamation mit 7 Tagen Prüffrist. Bei Lieferanten mit PrePing werden doppelte Kontakte außerdem sofort abgelehnt." },
];
/** Die Schalter in der Reihenfolge ihrer Gruppen: „Auslieferung“, „Doppelte Kontakte“, „Ablehnungen“. */
export function systemSwitchGroups(): Array<{ group: string; items: SystemSwitch[] }> {
  const groups: Array<{ group: string; items: SystemSwitch[] }> = [];
  for (const item of SYSTEM_SWITCHES) { const found = groups.find((entry) => entry.group === item.group); if (found) found.items.push(item); else groups.push({ group: item.group, items: [item] }); }
  return groups;
}

/** Prüft die Eingaben für ein neues Passwort – dieselbe Regel wie auf dem Server (mindestens 10 Zeichen, Buchstaben und eine Ziffer). */
export function passwordIssue(current: string, next: string, repeat: string): string | null {
  if (!current) return "Bitte das aktuelle Passwort eintragen.";
  if (next.length < 10) return "Das neue Passwort braucht mindestens 10 Zeichen.";
  if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) return "Das neue Passwort braucht Buchstaben und mindestens eine Ziffer.";
  if (next !== repeat) return "Die Wiederholung stimmt nicht mit dem neuen Passwort überein.";
  if (next === current) return "Das neue Passwort ist dasselbe wie das aktuelle.";
  return null;
}

/**
 * Einen Reklamationsgrund eine Zeile nach oben (−1) oder unten (+1) schieben. `rows` steht in der gezeigten Reihenfolge.
 * Zurück kommen nur die Gründe, deren Platznummer sich ändert – danach sind die Plätze lückenlos 0, 1, 2 … durchgezählt
 * (auch wenn vorher zwei Gründe dieselbe Nummer hatten).
 */
export function movedReasons(rows: Array<{ id: number; sortOrder: number }>, id: number, step: -1 | 1): Array<{ id: number; sortOrder: number }> {
  const from = rows.findIndex((row) => row.id === id); const to = from + step;
  if (from < 0 || to < 0 || to >= rows.length) return [];
  const order = rows.map((row) => row.id); [order[from], order[to]] = [order[to], order[from]];
  return order.map((rowId, index) => ({ id: rowId, sortOrder: index })).filter((change) => rows.find((row) => row.id === change.id)!.sortOrder !== change.sortOrder);
}
