const replacements: Array<[RegExp, string]> = [
  [/für den aktiven Mandanten/gi, "für Ihren aktiven Lead-Bereich"],
  [/des aktiven Mandanten/gi, "der aktiven Organisation"],
  [/dem aktiven Mandanten/gi, "dem aktiven Lead-Bereich"],
  [/im aktiven Mandanten/gi, "im aktiven Lead-Bereich"],
  [/Mandantenprotokoll/gi, "Organisationsprotokoll"],
  [/Mandantenkontext/gi, "Lead-Operations-Kontext"],
  [/Mandantendaten/gi, "Organisationsdaten"],
  [/Mandantenbereich/gi, "Lead-Bereich"],
  [/Mandantenprodukte/gi, "Organisationsprodukte"],
  [/Mandantenfälle/gi, "Organisationsfälle"],
  [/Mandanten-ID/gi, "Organisations-ID"],
  [/Mandantenabfrage/gi, "Organisationsabfrage"],
  [/mandantenbezogen/gi, "organisationsbezogen"],
  [/mandantenfähig/gi, "organisationsfähig"],
  [/Mandanten/gi, "Organisation"],
  [/Mandant/gi, "Organisation"],
];

export function normalizeLeadOperationsTerminology(value: string) {
  return replacements.reduce((normalized, [pattern, replacement]) => normalized.replace(pattern, replacement), value);
}
