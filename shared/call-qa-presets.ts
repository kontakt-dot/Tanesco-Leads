/**
 * Vorlagen für die Gesprächsbewertung: Kriterien (gewichtete KI-Bewertung), Anweisung an die KI und Prüffragen (Ja/Nein mit Regel).
 * „Photovoltaik – HausKompass“: Der Kunde hat sich über HausKompass eingetragen; am Ende muss er wissen, dass sich
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
  label: "Photovoltaik – HausKompass",
  description: "HausKompass als Herkunft nennen · Eigentümer/Entscheider abfragen · Umsetzung in höchstens 6 Monaten · am Ende: „Photovoltaik Angebotsvergleich“ meldet sich.",
  criteria: [
    { key: "hauskompass", label: "HausKompass genannt", weight: 15, description: "Der Mitarbeiter nennt HausKompass als Herkunft der Anfrage (der Kunde hat sich dort eingetragen) und der Kunde erkennt den Bezug." },
    { key: "entscheider", label: "Eigentümer / Entscheider abgefragt", weight: 20, description: "Der Mitarbeiter fragt, ob der Gesprächspartner Eigentümer des Hauses ist bzw. selbst entscheidet – und bekommt eine klare Antwort." },
    { key: "bedarf", label: "Bedarf & Interesse", weight: 15, description: "Der Kunde hat echtes Interesse an einer Photovoltaikanlage (Dach, Verbrauch, Motivation werden besprochen)." },
    { key: "zeitrahmen", label: "Umsetzung in höchstens 6 Monaten", weight: 20, description: "Der Kunde will innerhalb der nächsten 6 Monate umsetzen. Länger als 6 Monate oder „irgendwann“ = nicht erfüllt." },
    { key: "uebergabe", label: "Übergabe angekündigt: „Photovoltaik Angebotsvergleich“", weight: 20, description: "Am Ende weiß der Kunde ausdrücklich, dass sich „Photovoltaik Angebotsvergleich“ bei ihm meldet, und ist damit einverstanden." },
    { key: "kontaktdaten", label: "Kontaktdaten bestätigt", weight: 10, description: "Name, Telefonnummer, Adresse und Erreichbarkeit wurden bestätigt oder korrigiert." },
  ],
  instructions: "Ablauf, der im Gespräch vorkommen muss: 1) Herkunft nennen: Der Kunde hat sich über HausKompass eingetragen – das muss gesagt werden. 2) Fragen, ob der Gesprächspartner Eigentümer bzw. Entscheider ist. 3) Zeitrahmen klären: Umsetzung innerhalb von höchstens 6 Monaten; länger ist nicht verkaufbar. 4) Zum Schluss muss der Kunde wissen, dass sich „Photovoltaik Angebotsvergleich“ bei ihm meldet. Fehlt die Übergabe-Ankündigung oder die Eigentümer-Frage, höchstens „nachfassen“. Bewerte nur, was im Transkript wörtlich vorkommt.",
  questions: [
    { key: "hauskompass_genannt", label: "Hat der Mitarbeiter HausKompass als Herkunft der Anfrage genannt?", rule: "required", hint: "„Sie hatten sich bei HausKompass eingetragen …“" },
    { key: "eigentuemer_entscheider", label: "Wurde abgefragt, ob der Kunde Eigentümer bzw. Entscheider ist – und ist er es?", rule: "ko", hint: "Nein = kein Eigentümer/Entscheider → zurückgewiesen" },
    { key: "interesse", label: "Hat der Kunde Interesse an einer Photovoltaikanlage?", rule: "ko" },
    { key: "umsetzung_6_monate", label: "Ist die Umsetzung innerhalb von höchstens 6 Monaten geplant?", rule: "ko", hint: "Länger als 6 Monate oder unklar = nicht erfüllt" },
    { key: "uebergabe_angebotsvergleich", label: "Weiß der Kunde am Ende, dass sich „Photovoltaik Angebotsvergleich“ bei ihm meldet?", rule: "required", hint: "Muss ausdrücklich gesagt werden" },
    { key: "telefonische_kontaktaufnahme", label: "Ist eine telefonische Kontaktaufnahme erwünscht?", rule: "required" },
    { key: "alle_fragen_gestellt", label: "Wurden alle Fragen gestellt?", rule: "info" },
  ],
};

export const CALL_QA_PRESETS: CallQaPreset[] = [PV_HAUSKOMPASS_PRESET];
export const presetByKey = (key: string) => CALL_QA_PRESETS.find((preset) => preset.key === key) ?? null;
