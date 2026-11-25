/**
 * Status einer Bestellung für die Oberfläche (seit Version 365).
 * „offen“ (neu angelegt, noch nie gestartet) und „pausiert“ heißen beide „Inaktiv“ – beide bekommen keine Leads. Leads bekommt nur „Aktiv“.
 */
export type OrderStatus = "offen" | "aktiv" | "erfüllt" | "pausiert" | "storniert";

/** Wert für die Auswahl Aktiv/Inaktiv: „offen“ steht dort als „Inaktiv“ (pausiert). */
export function orderStatusChoice(status: string): "aktiv" | "pausiert" | "erfüllt" | "storniert" {
  return status === "aktiv" || status === "erfüllt" || status === "storniert" ? status : "pausiert";
}

/** Anzeige: Aktiv, Inaktiv, Erfüllt oder Storniert. `active` = Schalter der Bestellkonfiguration (fehlt er, gilt der Status). */
export function orderStatusLabel(status: string, active = true): string {
  if (status === "erfüllt") return "Erfüllt";
  if (status === "storniert") return "Storniert";
  return status === "aktiv" && active ? "Aktiv" : "Inaktiv";
}
