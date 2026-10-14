export const categoryFieldTypes = ["text", "zahl", "auswahl", "ja_nein", "datum", "notiz"] as const;

export type CategoryFieldType = (typeof categoryFieldTypes)[number];

export type CategoryTemplateField = { label: string; fieldKey: string; fieldType: CategoryFieldType; options?: readonly string[] };

export const pvCategoryFields: ReadonlyArray<CategoryTemplateField> = [
  { label: "Stromverbrauch", fieldKey: "stromverbrauch", fieldType: "auswahl", options: ["0 - 3.000 kWh", "3.000 - 4.000 kWh", "4.000 - 6.000 kWh", "Über 6.000 kWh"] },
  { label: "Monatliche Stromkosten", fieldKey: "monatliche_stromkosten", fieldType: "text" },
  { label: "Wärmepumpe", fieldKey: "waermepumpe", fieldType: "auswahl", options: ["Ja", "Nein"] },
  { label: "Wallbox", fieldKey: "wallbox", fieldType: "text" },
  { label: "Dachart", fieldKey: "dachart", fieldType: "auswahl", options: ["Satteldach", "Pultdach", "Flachdach", "Walmdach", "Sonstiges"] },
  { label: "Hausart", fieldKey: "hausart", fieldType: "auswahl", options: ["Ein-/Zweifamilienhaus", "Mehrfamilienhaus", "Firmengebäude", "Freilandfläche", "Sonstiges"] },
  { label: "Dachfläche", fieldKey: "dachflaeche", fieldType: "text" },
  { label: "Dachalter", fieldKey: "dachalter", fieldType: "auswahl", options: ["Unter 30 Jahre", "30-70 Jahre", "Über 70 Jahre"] },
  { label: "Finanzierung", fieldKey: "finanzierung", fieldType: "auswahl", options: ["Ja", "Nein"] },
  { label: "Umsetzung", fieldKey: "umsetzung", fieldType: "auswahl", options: ["So schnell wie möglich", "1-3 Monate", "4-6 Monate", "Mehr als 6 Monate"] },
  { label: "Erreichbarkeit", fieldKey: "erreichbarkeit", fieldType: "text" },
  { label: "Recording", fieldKey: "recording_1", fieldType: "text" },
  { label: "Lieferant", fieldKey: "lieferant", fieldType: "text" },
  { label: "Kundenalter", fieldKey: "kundenalter", fieldType: "text" },
  { label: "Personen im Haushalt", fieldKey: "personen_im_haushalt", fieldType: "text" },
  { label: "Wie viele Angebote", fieldKey: "wie_viele_angebote", fieldType: "text" },
  { label: "Hauptmotivation", fieldKey: "hauptmotivation", fieldType: "text" },
  { label: "Dach älter als 30 Jahre", fieldKey: "dach_aelter_als_30_jahre", fieldType: "text" },
  { label: "Dachausrichtung", fieldKey: "dachausrichtung", fieldType: "text" },
  { label: "Info", fieldKey: "info", fieldType: "text" },
  { label: "Stromspeicher", fieldKey: "stromspeicher", fieldType: "auswahl", options: ["Ja", "Nein", "Weiß nicht"] },
  { label: "Dachmaterial", fieldKey: "dachmaterial", fieldType: "auswahl", options: ["Unbefestigte Dachziegel / Dachpfannen", "Befestigte Dachziegel / Dachpfannen (zb. vermörtelt)", "Bitumen / Teerpappe", "Blechdach / Metalldach", "Naturschiefer", "Asbest / Faserzementwolle / Eternit / Welleternit / Kunstschiefer", "Sonstiges"] },
  { label: "Entscheider", fieldKey: "entscheider", fieldType: "auswahl", options: ["Ja", "Ja, Eigentümergemeinschaft", "Nein"] },
  { label: "Bestandsanlage", fieldKey: "bestandsanlage", fieldType: "auswahl", options: ["Ja, wird aber vor der Neuinstallation selbst demontiert.", "Ja, soll mit der neuen kombiniert werden.", "Ja, soll aber nicht mit der neuen Anlage kombiniert werden.", "Nein"] },
  { label: "GHL ID", fieldKey: "ghl_id", fieldType: "text" },
];

export const heatPumpCategoryFields: ReadonlyArray<CategoryTemplateField> = [
  { label: "Geplantes Heizsystem", fieldKey: "geplantes_heizsystem", fieldType: "auswahl", options: ["Wärmepumpe", "Holz/Pellets", "Erdgas", "Heizöl", "Strom", "Flüssiggas", "Brennstoffzellenheizung"] },
  { label: "Aktuelles Heizsystem", fieldKey: "aktuelles_heizsystem", fieldType: "auswahl", options: ["Erdgas", "Heizöl", "Wärmepumpe", "Holz/Pellets", "Flüssiggas", "Strom", "Sonstiges", "Erstinstallation/neubauprojekt"] },
  { label: "Beheizte Fläche", fieldKey: "beheizte_flaeche", fieldType: "auswahl", options: ["bis 100 qm", "101-140 qm", "141-180 qm", "181-250 qm", "251-400 qm", "mehr als 400 qm"] },
  { label: "Aktuelle Wärmeverteilung", fieldKey: "aktuelle_waermeverteilung", fieldType: "auswahl", options: ["heizkörper", "Fußbodenheizung", "heizkörper & Fußbodenheizung", "sonstiges"] },
  { label: "Warmwasser System", fieldKey: "warmwasser_system", fieldType: "auswahl", options: ["Zentral über Heizung", "Separat (Durchlauferhitzer oder Boiler)", "Solarthermie", "weiß nicht /sonstiges"] },
  { label: "Installationszeitraum", fieldKey: "installationszeitraum", fieldType: "auswahl", options: ["sofort", "1-3 Monate", "4-6 Monate", "7-12 Monate", "später als 12 Monate"] },
  { label: "Bevorzugte Wärmepumpe", fieldKey: "bevorzugte_waermepumpe", fieldType: "auswahl", options: ["Luftwärmepumpe", "Erdwärmepumpe", "Beides Interessant"] },
  { label: "Gebäudetyp", fieldKey: "gebaeudetyp", fieldType: "auswahl", options: ["Ein-/Zweifamilienhaus", "Doppel-Reihenhaus", "Mehrfamilienhaus", "Eigentumswohnung", "Gewerbe"] },
  { label: "Kommentare", fieldKey: "kommentare", fieldType: "text" },
  { label: "Erreichbarkeit", fieldKey: "erreichbarkeit", fieldType: "text" },
  { label: "Installationsort", fieldKey: "installationsort", fieldType: "text" },
  { label: "Ist Eigentümer", fieldKey: "ist_eigentuemer", fieldType: "auswahl", options: ["Ja", "Nein"] },
  { label: "Termin erwünscht", fieldKey: "termin_erwuenscht", fieldType: "auswahl", options: ["Ja", "Nein"] },
  { label: "Ist Neubau", fieldKey: "ist_neubau", fieldType: "auswahl", options: ["Ja", "Nein"] },
  { label: "Info", fieldKey: "info", fieldType: "text" },
  { label: "Record File", fieldKey: "record_file", fieldType: "text" },
  { label: "Sprachaufzeichnung", fieldKey: "sprachaufzeichnung", fieldType: "text" },
  { label: "Hauptmotivation", fieldKey: "hauptmotivation", fieldType: "auswahl", options: ["Stromkosten senken", "Unabhängigkeit", "Förderung nutzen"] },
  { label: "Interesse Photovoltaikanlage", fieldKey: "interesse_photovoltaikanlage", fieldType: "auswahl", options: ["Ja", "Nein"] },
  { label: "Kombi Lead", fieldKey: "kombi_lead", fieldType: "auswahl", options: ["ja", "nein"] },
];

export const pvCategoryFieldMappings = [
  { sourceField: "record_file", targetFieldKey: "recording_1", mode: "umschreiben" as const, searchValue: "leadshome.ondialer.com", replaceValue: "download.voicefile.de", sortOrder: 0 },
] as const;
