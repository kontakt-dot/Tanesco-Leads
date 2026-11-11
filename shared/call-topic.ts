/** Thema aus dem Transkript ohne KI: Stichwörter → Kategoriename (Mehrfachnennung → „A & B“). */
const TOPIC_KEYWORDS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Photovoltaik", pattern: /photovoltaik|pv-?anlage|solaranlage|solarstrom|solarmodul|balkonkraftwerk|\bpv\b/i },
  { name: "Wärmepumpe", pattern: /wärmepumpe|waermepumpe|luft-?wasser|erdwärme/i },
  { name: "Stromspeicher", pattern: /stromspeicher|batteriespeicher|speicher für den strom/i },
  { name: "Klimaanlage", pattern: /klimaanlage|klimagerät|split-?klima/i },
  { name: "Alarmanlage", pattern: /alarmanlage|einbruchschutz|einbruchmeldeanlage/i },
  { name: "Treppenlift", pattern: /treppenlift|sitzlift|plattformlift/i },
  { name: "Elektrorollstuhl", pattern: /elektrorollstuhl|e-?rollstuhl/i },
  { name: "Hausnotruf", pattern: /hausnotruf|notrufknopf|notrufsystem/i },
  { name: "Pflegebox", pattern: /pflegebox|pflegehilfsmittel/i },
  { name: "Badsanierung", pattern: /badsanierung|bad sanier|badumbau|barrierefreies bad/i },
  { name: "Dachsanierung", pattern: /dachsanierung|dach sanier|neues dach|dachdecker/i },
  { name: "Fenster", pattern: /\bfenster\b|fenstertausch|neue fenster/i },
  { name: "Wintergarten", pattern: /wintergarten/i },
  { name: "Wallbox", pattern: /wallbox|ladestation|ladesäule/i },
  { name: "Heizung", pattern: /heizungstausch|neue heizung|gasheizung|ölheizung|pelletheizung/i },
  { name: "Versicherung", pattern: /krankenversicherung|\bbkv\b|versicherung/i },
];
export function detectTopic(transcript: string): string | null {
  const hits = TOPIC_KEYWORDS.filter((entry) => entry.pattern.test(transcript)).map((entry) => entry.name);
  const main = hits.filter((name) => name !== "Heizung" || !hits.includes("Wärmepumpe")).slice(0, 2); // Heizung nur, wenn keine Wärmepumpe
  return main.length ? main.join(" & ") : null;
}
