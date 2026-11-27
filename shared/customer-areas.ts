/**
 * Seiten des Kundenbereichs („MEIN BEREICH“) in der Reihenfolge der Seitenleiste, wie ein Käufer- oder Lieferanten-Zugang sie sieht (v388).
 * Benutzer → Kunde → Reiter „Ansicht“ → „Sichtbare Bereiche“ zeigt genau diese Liste. Bis v387 standen dort 14 Bereiche aus der alten
 * Vorlage (Angebote, Shop, Marktplatz, Guthaben, Pipeline, Käufe, E-Mails, Team, App-Download-Logos …) – nur fünf davon gab es wirklich.
 */
export type CustomerArea = { key: string; label: string; hint: string; always?: boolean; onlySupplier?: boolean };
export const CUSTOMER_AREAS: CustomerArea[] = [
  { key: "Dashboard", label: "Dashboard", hint: "Überblick über seine Leads und Bestellungen", always: true },
  { key: "Leads", label: "Leads", hint: "die Leads, die er bekommen hat", always: true },
  { key: "Bestellungen", label: "Bestellungen", hint: "seine Bestellungen mit Lieferfortschritt" },
  { key: "Reklamationen", label: "Reklamationen", hint: "Leads reklamieren und den Stand sehen" },
  { key: "Lead-Import", label: "Lead-Import", hint: "Leads hochladen – nur bei Lieferanten", onlySupplier: true },
  { key: "Integrationen", label: "Integrationen", hint: "seine Schnittstelle – wohin die Leads gehen" },
  { key: "Support", label: "Support", hint: "Fragen an euch stellen" },
  { key: "Einstellungen", label: "Einstellungen", hint: "Zugang und Stammdaten", always: true },
];
/** Bereiche, die sich ein- und ausschalten lassen (Dashboard, Leads und Einstellungen sieht jeder Zugang immer). */
export const CHOOSABLE_AREAS = CUSTOMER_AREAS.filter((area) => !area.always).map((area) => area.key);
