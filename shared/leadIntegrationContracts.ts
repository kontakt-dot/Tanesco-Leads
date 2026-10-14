export const fluxoraStandardLeadFields = [
  { key: "lead_type_id", label: "Kategoriecode", required: true, description: "PVCC für Photovoltaik, WP für Wärmepumpe" },
  { key: "first_name", label: "Vorname", required: false, description: "Mindestens Vor- oder Nachname erforderlich" },
  { key: "last_name", label: "Nachname", required: false, description: "Mindestens Vor- oder Nachname erforderlich" },
  { key: "gender", label: "Geschlecht", required: false, description: "m oder f" },
  { key: "email", label: "E-Mail", required: false, description: "Kontaktadresse" },
  { key: "phone", label: "Telefon", required: false, description: "Telefonnummer" },
  { key: "street_no", label: "Straße und Hausnummer", required: false, description: "Adresszeile" },
  { key: "zip_code", label: "Postleitzahl", required: false, description: "Pflicht, wenn die Kategorie eine PLZ verlangt" },
  { key: "city", label: "Ort", required: false, description: "Ort" },
  { key: "country_code", label: "Ländercode", required: true, description: "DE, AT, CH, US, CA oder AU" },
  { key: "marketplace", label: "Marktplatz", required: false, description: "Boolean: Direkt in den Marktplatz statt in die Verteilung" },
] as const;

export const fluxoraMasterLeadIntegrations = {
  PV: { shortcode: "PV", leadTypeId: "PVCC", name: "Photovoltaik", tokenHeader: "Authorization: Bearer <MANDANTEN_TOKEN>", customDataKey: "custom_data" },
  WP: { shortcode: "WP", leadTypeId: "WP", name: "Wärmepumpe", tokenHeader: "Authorization: Bearer <MANDANTEN_TOKEN>", customDataKey: "custom_data" },
} as const;

export function getFluxoraMasterLeadIntegration(shortcode: string) {
  return Object.values(fluxoraMasterLeadIntegrations).find((integration) => integration.shortcode === shortcode.toUpperCase());
}
