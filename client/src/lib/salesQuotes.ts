/** Vertriebssprüche – frech, witzig, direkt. Wechseln alle 5 Minuten von allein und per Knopf. */
export const SALES_QUOTES: Array<{ text: string; author?: string }> = [
  { text: "Dein Telefon ist kein Deko-Objekt. Nimm es in die Hand." },
  { text: "Ein Nein ist nur ein Ja, das noch nicht wach ist." },
  { text: "Die Konkurrenz ruft gerade an. Du liest gerade Sprüche." },
  { text: "Kaffee holen zählt nicht als Kontaktaufnahme." },
  { text: "Nachfassen ist kein Nerven. Nicht nachfassen ist Geld verbrennen." },
  { text: "Der Deal entsteht beim fünften Kontakt. Beim zweiten gehen die Amateure heim." },
  { text: "Deine Pipeline ist dein Gehalt von morgen. Heute schon gefüttert?" },
  { text: "„Ich meld mich“ ist keine Stufe. „Termin“ ist eine." },
  { text: "Hör zu, bis es weh tut – dann weißt du, was der Kunde wirklich will." },
  { text: "Jede Karte links liegen zu lassen ist auch eine Entscheidung. Eine teure." },
  { text: "Mut ist, nach dem dritten Nein genauso charmant zu sein wie beim ersten." },
  { text: "Die beste Zeit für den nächsten Anruf war vor fünf Minuten. Die zweitbeste ist jetzt." },
  { text: "Lächeln hört man am Telefon. Zähneknirschen auch." },
  { text: "Qualität schlägt Masse. Aber Masse mit Qualität schlägt alles." },
  { text: "Verloren heißt gelernt. Notier den Grund, nicht die Ausrede." },
  { text: "Du verkaufst keine Leads. Du verkaufst volle Auftragsbücher." },
  { text: "Ein voller Kalender fängt mit einem unangenehmen Anruf an." },
  { text: "Der Kunde kauft die Lösung, nicht den Preis. Der Preis ist nur das Kleingedruckte." },
  { text: "Heute ein Termin mehr als gestern. Das ist der ganze Trick." },
  { text: "Pipeline leer? Kein Problem – Listen, Anrufe, E-Mails. Jammern ist keine Spalte." },
  { text: "Jedes „Kunde“ auf dem Board war mal ein „Neu“, das jemand ernst genommen hat." },
  { text: "Der Abschluss gehört dem, der zuletzt nachgefasst hat. Nicht dem, der am lautesten geseufzt hat." },
  { text: "Zwanzig Anrufe sind ein guter Tag. Zwanzig Gespräche sind ein großartiger. Zwanzig Ausreden sind ein Montag." },
  { text: "Du hast heute mehr geschafft, als du denkst. Jetzt noch einen." },
  { text: "Angebot verschickt? Super. Und jetzt bitte nicht auf Wunder warten." },
  { text: "Die Mailbox ist nicht der Kunde. Nochmal anrufen." },
  { text: "Wer fragt, führt. Wer nachfasst, kassiert." },
  { text: "Komfortzone: netter Ort, aber dort wird nichts unterschrieben." },
  { text: "Ein Termin, der nicht im Kalender steht, ist ein Gerücht." },
  { text: "Montag ist auch nur ein Tag mit Telefon." },
  { text: "Energie ist ansteckend. Müdigkeit leider auch – also Haltung gerade." },
  { text: "Wenn der Kunde „zu teuer“ sagt, hat er nur noch nicht verstanden, was er bekommt. Erklär’s ihm." },
  { text: "Niemand hat je einen Deal gewonnen, indem er auf die Pipeline gestarrt hat." },
  { text: "Kleiner Tipp: Der Kunde googelt gerade die Konkurrenz. Ruf vorher an." },
  { text: "Ziele sind Träume mit Deadline. Deine Deadline ist Freitag." },
  { text: "Nach dem Termin ist vor dem Angebot. Nach dem Angebot ist vor dem Nachfassen. Immer." },
];
export const WON_MESSAGES = ["🎉 Deal gewonnen! Jetzt bloß nicht bescheiden werden.", "🏆 Kunde! Erzähl’s dem Team, Bescheidenheit ist für andere.", "🚀 Abschluss! Die Pipeline macht gerade einen kleinen Freudensprung.", "💪 Gewonnen – der nächste wartet schon ungeduldig.", "🥂 Volltreffer! Notier dir, was heute gut lief, und mach’s morgen nochmal."];
export const LOST_MESSAGES = ["Verloren heißt gelernt – der nächste wird besser.", "Nicht jeder passt. Der Richtige kommt – wahrscheinlich beim nächsten Anruf.", "Abgehakt. Energie in den nächsten Kontakt, nicht in den Frust.", "Kein Abschluss, aber Erfahrung. Weiter geht’s, die Pipeline wartet."];
export const STEP_MESSAGES: Record<string, string[]> = {
  kontaktiert: ["Kontakt hergestellt – jetzt dranbleiben.", "Erster Schritt geschafft. Nachfassen nicht vergessen!", "Erreicht! Das ist mehr, als die Mailbox je geschafft hat."],
  qualifiziert: ["Qualifiziert! Jetzt den Termin holen.", "Passt. Weiter zum Termin – ohne Umweg.", "Bedarf da, Budget da. Fehlt nur noch dein Vorschlag."],
  termin: ["Termin steht – gut vorbereiten, gut abschließen.", "Termin vereinbart. Der halbe Weg ist geschafft.", "Im Kalender! Jetzt kein Gerücht mehr."],
  angebot: ["Angebot raus – jetzt heißt es nachfassen.", "Angebot verschickt. In 2 Tagen nachhaken, nicht in 2 Wochen!", "Angebot ist draußen. Wunder bitte nicht abwarten – anrufen."],
};
export const randomQuote = (exclude?: string) => { const pool = SALES_QUOTES.filter((quote) => quote.text !== exclude); return pool[Math.floor(Math.random() * pool.length)]; };
export const pick = (items: string[]) => items[Math.floor(Math.random() * items.length)];
