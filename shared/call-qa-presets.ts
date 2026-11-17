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
    { key: "hauskompass", label: "HausKompass genannt", weight: 15, description: "Der Mitarbeiter nennt HausKompass als Firma (er ruft im Namen von HausKompass an). Der Name reicht – volle Punktzahl, sobald er fällt. Auch ein nur ähnlich klingender Name zählt voll (z. B. „Haus Campus“, „Hauskompas“, „Haus Kompaß“): Die Spracherkennung verhört sich oft, und der Kunde ordnet es trotzdem richtig zu. Ob er dazu sagt, der Kunde habe sich informiert oder eingetragen, ist egal – beides ist in Ordnung, nichts davon ist ein Mangel." },
    { key: "entscheider", label: "Eigentümer / Entscheider abgefragt", weight: 20, description: "Der Mitarbeiter fragt, ob der Gesprächspartner Eigentümer des Hauses ist bzw. selbst entscheidet – und bekommt eine klare Antwort." },
    { key: "bedarf", label: "Bedarf & Interesse (PV oder Wärmepumpe)", weight: 15, description: "Der Kunde hat echtes Interesse an einer Photovoltaikanlage oder einer Wärmepumpe – eines von beiden reicht (Dach/Heizung, Verbrauch, Motivation werden besprochen)." },
    { key: "zeitrahmen", label: "Umsetzung in höchstens 6 Monaten", weight: 20, description: "Der Kunde will zeitnah umsetzen (innerhalb von etwa 6 Monaten). Ein genauer Termin muss NICHT genannt werden: Antworten wie „so schnell wie möglich“, „zeitnah“, „bald“ oder „kommt auf das Angebot an, dann gehe ich davon aus“ sind voll erfüllt. Nicht erfüllt nur, wenn der Kunde ausdrücklich später will (länger als 6 Monate, „nächstes Jahr“, „irgendwann“)." },
    { key: "uebergabe", label: "Übergabe angekündigt: „Photovoltaik Angebotsvergleich“", weight: 20, description: "Am Ende weiß der Kunde, dass sich „Photovoltaik Angebotsvergleich“ bei ihm meldet. Der Name passt auch bei Wärmepumpen-Anfragen (dieselbe Firma ist für beides zuständig) – das ist kein Widerspruch und kein Abzug. Volle Punktzahl, wenn die Ankündigung klar gesagt wurde; ein ausdrückliches „Ja“ des Kunden ist schön, aber nicht nötig, solange er nicht widerspricht." },
    { key: "kontaktdaten", label: "Name, Adresse, Erreichbarkeit", weight: 10, description: "Name und Adresse (mindestens Ort) wurden bestätigt oder aufgenommen und es ist klar, wann der Kunde erreichbar ist. Die Telefonnummer zählt NICHT dazu – wir rufen auf dieser Nummer an, sie muss nicht bestätigt werden." },
  ],
  instructions: "Es geht um Photovoltaik ODER Wärmepumpe – beides ist gleichwertig, eines von beiden reicht. Hintergrund: Der Kunde hat sich informiert (z. B. im Internet), deshalb rufen wir an. Der Mitarbeiter DARF sagen, der Kunde habe sich informiert oder eingetragen – das ist in Ordnung und KEIN Mangel; es ist ebenso kein Mangel, wenn die Herkunft gar nicht erklärt wird. Ablauf, der im Gespräch vorkommen muss: 1) HausKompass muss als Firma genannt werden (der Mitarbeiter ruft im Namen von HausKompass an) – der Name reicht. Das Transkript kommt aus automatischer Spracherkennung, Firmennamen sind darin oft falsch geschrieben: Steht dort etwas, das sich wie HausKompass anhört (z. B. „Haus Campus“, „Hauskompas“, „Haus Kompaß“), gilt der Name als genannt – KEIN Mangel. 2) Fragen, ob der Gesprächspartner Eigentümer bzw. Entscheider ist. 3) Zeitrahmen: Der Kunde will zeitnah umsetzen (innerhalb von etwa 6 Monaten). Ein konkretes Zeitfenster muss NICHT genannt werden – „so schnell wie möglich“, „zeitnah“, „bald“ oder „kommt auf das Angebot an, dann gehe ich davon aus“ reicht und ist KEIN Mangel. Nicht verkaufbar nur, wenn der Kunde ausdrücklich später als in 6 Monaten oder „irgendwann“ sagt. 4) Zum Schluss muss der Kunde wissen, dass sich „Photovoltaik Angebotsvergleich“ bei ihm meldet. Diese Firma ist für Photovoltaik UND Wärmepumpen zuständig – bei einer Wärmepumpen-Anfrage ist der Name also richtig und KEIN Widerspruch, KEIN Mangel. Die Telefonnummer muss NICHT bestätigt oder abgefragt werden – wir rufen auf genau dieser Nummer an; nie als Mangel werten. Fehlt die Übergabe-Ankündigung oder die Eigentümer-Frage, höchstens „nachfassen“. Bewerte nur, was im Transkript vorkommt (Namen dürfen wie oben beschrieben ähnlich klingen).",
  questions: [
    { key: "hauskompass_genannt", label: "Hat der Mitarbeiter HausKompass genannt?", rule: "required", hint: "Der Name muss im Gespräch fallen, z. B. „… von HausKompass“. Ähnlich klingende Schreibweisen zählen als Ja (z. B. „Haus Campus“, „Hauskompas“) – die Spracherkennung verhört sich oft" },
    { key: "eigentuemer_entscheider", label: "Wurde abgefragt, ob der Kunde Eigentümer bzw. Entscheider ist – und ist er es?", rule: "ko", hint: "Nein = kein Eigentümer/Entscheider → zurückgewiesen" },
    { key: "interesse", label: "Hat der Kunde Interesse an einer Photovoltaikanlage oder Wärmepumpe?", rule: "ko", hint: "Eines von beiden reicht" },
    { key: "umsetzung_6_monate", label: "Ist die Umsetzung innerhalb von höchstens 6 Monaten geplant?", rule: "ko", hint: "Kein genauer Termin nötig: „so schnell wie möglich“, „zeitnah“, „bald“ oder „kommt auf das Angebot an“ = Ja. Nein nur, wenn der Kunde ausdrücklich später als in 6 Monaten oder „irgendwann“ sagt. Unklar nur, wenn gar nicht über den Zeitpunkt gesprochen wurde." },
    { key: "uebergabe_angebotsvergleich", label: "Weiß der Kunde am Ende, dass sich „Photovoltaik Angebotsvergleich“ bei ihm meldet?", rule: "required", hint: "Muss ausdrücklich gesagt werden – auch bei Wärmepumpe (gleiche Firma)" },
    { key: "telefonische_kontaktaufnahme", label: "Ist eine telefonische Kontaktaufnahme erwünscht?", rule: "required", hint: "Reicht, wenn der Kunde dem Rückruf zustimmt – die Nummer muss nicht bestätigt werden" },
    { key: "alle_fragen_gestellt", label: "Wurden alle Fragen gestellt?", rule: "info" },
  ],
};

export const CALL_QA_PRESETS: CallQaPreset[] = [PV_HAUSKOMPASS_PRESET];
export const presetByKey = (key: string) => CALL_QA_PRESETS.find((preset) => preset.key === key) ?? null;
