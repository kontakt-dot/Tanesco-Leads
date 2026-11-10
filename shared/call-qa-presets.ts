/**
 * Vorlagen für die Gesprächsbewertung: Kriterien (gewichtete KI-Bewertung), Anweisung an die KI und Prüffragen (Ja/Nein mit Regel).
 * „Photovoltaik & Wärmepumpe – HausKompass“: Der Mitarbeiter ruft im Namen von HausKompass an und muss das sagen; am Ende muss der Kunde wissen, dass sich
 * „Photovoltaik Angebotsvergleich“ meldet; Umsetzung in höchstens 6 Monaten; Eigentümer/Entscheider wird abgefragt.
 */
import type { QualificationQuestion } from "./call-qualification";

export type CallQaPreset = {
  key: string; label: string; description: string;
  criteria: Array<{ key: string; label: string; weight: number; description: string }>;
  instructions: string;
  questions: QualificationQuestion[];
};

export const PV_HAUSKOMPASS_PRESET: CallQaPreset = {
  key: "pv-hauskompass",
  label: "Photovoltaik & Wärmepumpe – HausKompass",
  description: "Gilt für Photovoltaik UND Wärmepumpe. HausKompass im Gespräch nennen · Eigentümer/Entscheider abfragen · Umsetzung in höchstens 6 Monaten · am Ende: „Photovoltaik Angebotsvergleich“ meldet sich (auch bei Wärmepumpen-Anfragen).",
  criteria: [
    { key: "hauskompass", label: "HausKompass genannt", weight: 15, description: "Der Mitarbeiter nennt HausKompass als Firma (er ruft im Namen von HausKompass an). Der Name reicht – volle Punktzahl, sobald er fällt. Nicht verlangt: eine Erklärung, woher die Daten stammen oder dass sich der Kunde eingetragen hätte (hat er nicht)." },
    { key: "entscheider", label: "Eigentümer / Entscheider abgefragt", weight: 20, description: "Der Mitarbeiter fragt, ob der Gesprächspartner Eigentümer des Hauses ist bzw. selbst entscheidet – und bekommt eine klare Antwort." },
    { key: "bedarf", label: "Bedarf & Interesse (PV oder Wärmepumpe)", weight: 15, description: "Der Kunde hat echtes Interesse an einer Photovoltaikanlage oder einer Wärmepumpe – eines von beiden reicht (Dach/Heizung, Verbrauch, Motivation werden besprochen)." },
    { key: "zeitrahmen", label: "Umsetzung in höchstens 6 Monaten", weight: 20, description: "Der Kunde will innerhalb der nächsten 6 Monate umsetzen. Länger als 6 Monate oder „irgendwann“ = nicht erfüllt." },
    { key: "uebergabe", label: "Übergabe angekündigt: „Photovoltaik Angebotsvergleich“", weight: 20, description: "Am Ende weiß der Kunde, dass sich „Photovoltaik Angebotsvergleich“ bei ihm meldet. Der Name passt auch bei Wärmepumpen-Anfragen (dieselbe Firma ist für beides zuständig) – das ist kein Widerspruch und kein Abzug. Volle Punktzahl, wenn die Ankündigung klar gesagt wurde; ein ausdrückliches „Ja“ des Kunden ist schön, aber nicht nötig, solange er nicht widerspricht." },
    { key: "kontaktdaten", label: "Kontaktdaten bestätigt", weight: 10, description: "Name, Telefonnummer, Adresse und Erreichbarkeit wurden bestätigt oder korrigiert." },
  ],
  instructions: "Es geht um Photovoltaik ODER Wärmepumpe – beides ist gleichwertig, eines von beiden reicht. Hintergrund: Der Kunde hat sich nur informiert (z. B. im Internet), deshalb rufen wir an. Er hat sich NICHT bei HausKompass eingetragen – das darf weder behauptet noch erwartet werden, und es ist KEIN Mangel, wenn der Mitarbeiter nicht erklärt, woher die Daten stammen. Ablauf, der im Gespräch vorkommen muss: 1) HausKompass muss als Firma genannt werden (der Mitarbeiter ruft im Namen von HausKompass an) – der Name reicht. 2) Fragen, ob der Gesprächspartner Eigentümer bzw. Entscheider ist. 3) Zeitrahmen klären: Umsetzung innerhalb von höchstens 6 Monaten; länger ist nicht verkaufbar. 4) Zum Schluss muss der Kunde wissen, dass sich „Photovoltaik Angebotsvergleich“ bei ihm meldet. Diese Firma ist für Photovoltaik UND Wärmepumpen zuständig – bei einer Wärmepumpen-Anfrage ist der Name also richtig und KEIN Widerspruch, KEIN Mangel. Fehlt die Übergabe-Ankündigung oder die Eigentümer-Frage, höchstens „nachfassen“. Bewerte nur, was im Transkript wörtlich vorkommt.",
  questions: [
    { key: "hauskompass_genannt", label: "Hat der Mitarbeiter HausKompass genannt?", rule: "required", hint: "Der Name muss im Gespräch fallen, z. B. „… von HausKompass“" },
    { key: "eigentuemer_entscheider", label: "Wurde abgefragt, ob der Kunde Eigentümer bzw. Entscheider ist – und ist er es?", rule: "ko", hint: "Nein = kein Eigentümer/Entscheider → zurückgewiesen" },
    { key: "interesse", label: "Hat der Kunde Interesse an einer Photovoltaikanlage oder Wärmepumpe?", rule: "ko", hint: "Eines von beiden reicht" },
    { key: "umsetzung_6_monate", label: "Ist die Umsetzung innerhalb von höchstens 6 Monaten geplant?", rule: "ko", hint: "Länger als 6 Monate oder unklar = nicht erfüllt" },
    { key: "uebergabe_angebotsvergleich", label: "Weiß der Kunde am Ende, dass sich „Photovoltaik Angebotsvergleich“ bei ihm meldet?", rule: "required", hint: "Muss ausdrücklich gesagt werden – auch bei Wärmepumpe (gleiche Firma)" },
    { key: "telefonische_kontaktaufnahme", label: "Ist eine telefonische Kontaktaufnahme erwünscht?", rule: "required" },
    { key: "alle_fragen_gestellt", label: "Wurden alle Fragen gestellt?", rule: "info" },
  ],
};

export const CALL_QA_PRESETS: CallQaPreset[] = [PV_HAUSKOMPASS_PRESET];
export const presetByKey = (key: string) => CALL_QA_PRESETS.find((preset) => preset.key === key) ?? null;
