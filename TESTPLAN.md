# Testplan Tanesco Leads – Schritt für Schritt

So prüfst du die Plattform komplett. Reihenfolge einhalten: erst der Chat-Build (ohne Installation), dann die echte Installation,
zum Schluss die echten Partner. Bei jedem Schritt steht, was du tust und was du sehen musst. Wenn etwas anders ist:
Screenshot machen, Seite und Klick notieren, Text aus dem Lead-Log oder Protokoll kopieren – damit lässt sich jeder Fehler beheben.

---

## Phase 1 – Chat-Build durchklicken (ca. 45 Minuten, keine Installation)

Der Chat-Build läuft nur in deinem Browser mit Beispieldaten. „Zurücksetzen“ (unten rechts) stellt den Ausgangszustand wieder her.
Prüfe jede Seite einmal im Dunkel- und einmal im Hellmodus (Sonne/Mond oben rechts).

### 1.1 Dashboard
1. Zeitraum oben auf „Diese Woche“ und „Dieser Monat“ stellen → Kennzahlen und Stundenverlauf ändern sich.
2. „Eigener Zeitraum“ → Feld mit Von/Bis erscheint (vorbelegt mit den letzten 7 Tagen), Schnellwahl „Letzte 30 Tage“ → Zusammenfassung zeigt „30 Tage · Datum – Datum“, Zahlen, Stundenverlauf und Karte ändern sich. Bis vor Von setzen → Hinweis + „Daten tauschen“. Seite neu laden → Zeitraum bleibt gemerkt.
3. Kategorie-Filter auf „Photovoltaik“ → Zahlen ändern sich, „Bestellverteilung“ zeigt nur PV. Kategorie „Hörgeräte“ → Leads, Bestellung „Hörgeräte Aurora“ und Karte zeigen die neue Kategorie.

### 1.2 Leads
1. „Lead anlegen“ → Kategorie, Name, Telefon, PLZ, Ort eintragen → Lead erscheint oben in der Liste mit Status „Neu“.
2. Suchfeld: Nachnamen eines Leads eintippen → Liste filtert; Feld leeren → alle zurück.
3. Status-Reiter „Zugewiesen“, „Reklamiert“, „Fehlerhaft“ anklicken → nur passende Leads mit farbiger Status-Pille.
4. „Filter“ → Kategorie und Lieferant setzen → „Filter speichern“ → Name vergeben → gespeicherte Ansicht erscheint im Dropdown.
5. „Spalten anpassen“ → Telefon einblenden → Spalte erscheint, Zeilen bleiben sauber ausgerichtet.
6. Ganz unten „Leads pro Seite“ → „Eigene Anzahl …“ → 5 eintippen, Enter → nur 5 Leads, Blättern funktioniert.
7. Auge (ganz rechts) → Quick View öffnet sich rechts, Hintergrund verschwommen; „Ganzes Lead-Log“ öffnet die Log-Schublade; Escape schließt.
8. Auf einen Lead-Namen klicken → Lead-Seite (Kontakt, Fachfelder, Herkunft, Tags, Auslieferung, Reklamationen, Lead-Log); „← Zurück zu den Leads“.
9. Drei Leads anhaken → Leiste „Sammelaktion“ erscheint unten → „Käufer zuordnen“ → Käufer wählen → ausführen → Meldung, Käufer steht in der Spalte.
10. Zwei Leads anhaken → „Ausliefern“ → Lead-Log zeigt „Auslieferung an …“ (bei Beispieldaten kann auch „Kein Käufer“ erscheinen – das ist ok).
11. „Leads importieren“ → CSV aus dem Dialog ausprobieren (Spalten zuordnen) → Zeilenbericht, Import rückgängig machen → Leads wieder weg.
12. „Testlead senden“ → Testlead wird angelegt und ausgeliefert (im Lead-Log nachvollziehbar).

### 1.3 Lead-Kategorien
1. Kategorie „Photovoltaik“ öffnen → Farbe auf ein anderes Feld der Palette ändern → „Speichern“ → in der Lead-Liste hat der Punkt jetzt diese Farbe.
2. „Neue Kategorie“ → Name, Kürzel, Farbe → speichern → erscheint links in der Liste mit farbigem Kürzel.
3. Reiter „Fachfelder“ → „Feld hinzufügen“ (z. B. Auswahl mit zwei Optionen) → speichern → beim Lead anlegen ist das Feld da.

### 1.4 Bestellungen
1. „Bestellung anlegen“ → Name, Käufer, Lieferant, Kategorie, Preis, Menge, Liefertage → speichern.
2. Schritt 2 „Lieferkette ergänzen“ → „Lieferkette anlegen“ → „Käufer hinzufügen“ (Käufer-Konto wählen, Preis, Fenster 24 h) → Stop erscheint.
3. Im Stop: Chevron öffnen → Reklamationsgrund „Dublette“ auf „weitergeben“ stellen → „Gründe speichern“; PLZ-Gebiet „10“ → „Geo speichern“.
4. „Bestellübersicht“ → Bestellung mit Fortschrittsbalken sichtbar.

### 1.5 Lieferkette
1. Übersicht: Verteilmodus umschalten → Meldung „gespeichert“; Zeitraum wechseln → Ges./Ang./Abg. ändern sich.
2. Kette „Ondialer PV …“ öffnen → „Ketten-Einstellungen“ aufklappen → Tageshöchstgrenze 50 → „Speichern“.
3. Stop mit Pfeil nach unten verschieben → Reihenfolge ändert sich; Preis im Stop ändern (Enter) → gespeichert.
4. „Aktivität“ → Stop aufklappen → Lead-Name klicken → Lead-Seite öffnet sich.
5. Zurück → Kette „PV Premium Süd“ über den Papierkorb löschen → eigener Dialog, „Ja, löschen“ → Kette weg.

### 1.6 Automatisierung
1. Regel „Bearbeiten“ → bei „DANN Aktion bei Treffer“ eine andere Karte wählen (z. B. „Lead-Tag setzen“) → Tag wählen → speichern.
2. „SONST“ einschalten → Aktion wählen → speichern; „Protokoll“ öffnen → Einträge sichtbar.

### 1.7 Tags
1. Tag „Rückruf morgen“ mit Farbe anlegen → erscheint in der Liste mit 0 Leads.
2. Im Quick View eines Leads den Tag anklicken → auf der Tags-Seite steht jetzt 1 Lead, Beispiel-Lead klickbar.
3. Tag umfärben, umbenennen, löschen → jeweils Meldung, Liste aktualisiert.

### 1.8 Reklamationen
1. „Neuen Vorgang“ → Lead, Grund, Text → anlegen → Status „offen“.
2. Vorgang „genehmigen“ → Lead-Status „Reklamiert“; bei Grund „Dublette“ und Kette mit „weitergeben“ → Lead-Log zeigt Weitergabe an den nächsten Stop.
3. Filter (Status, Kategorie, Frist) und CSV-Export ausprobieren.

### 1.9 Callcenter (Rohdaten, Telefonie, Gespräche)
1. Rohdaten: Liste hochladen (Beispiel-CSV mit Name/Telefon), Kategorien wählen → Kontakte erscheinen; Kontakt „in Lead umwandeln“.
2. Telefonie: Kampagne anlegen, Kontakt aus der Liste anrufen (Simulation), Gesprächsergebnis setzen.
3. Automatische Gesprächsnotiz: Im Dialer steht „Auto-Notiz: an“. Nach „Einwilligung erteilt“ und „Auflegen“ erscheint unten „Gesprächsnotiz (automatisch)“ mit Zusammenfassung, Punkten und nächstem Schritt; nach dem Ergebnis steht auch „Ergebnis: …“ darin. Dieselbe Notiz steht an der Pipeline-Karte (blau), im Verlauf des Leads und unter Telefonie → Anrufe → „Notiz ansehen“. Schalter auf „aus“ → der nächste Anruf bekommt keine Notiz. Gleicher Schalter: Kaltakquise → Anrufkampagne, Telefonie → Kampagnen (Standard/An/Aus) und Telefonie → Einstellungen.
4. Dialer in der Pipeline: Vertriebspipeline → Kaltakquise → grüner Telefon-Knopf auf der Karte „Anja Reuter“ (oder Karte öffnen → „Anrufen“) → unten erscheint das Dialer-Feld (Klingelt → Verbunden) → „Einwilligung erteilt“ → „Auflegen“ → Ergebnis „Interessiert“ → Karte rückt nach „Qualifiziert“, Gesprächsnotiz an der Karte. Telefon-Symbol im Spaltenkopf „Neu“ → Modus wählen (Manuell / Power / Predictive) → „Power starten“: nicht erreichte Nummern werden als „Nicht erreicht“ verbucht und später wiederholt, angenommene Gespräche bekommen ein Ergebnis; Predictive: die Software wählt selbst, Gespräche erscheinen im Feld. Die Kampagne „Pipeline: Neu · …“ steht unter Telefonie → Kampagnen.
5. Aufzeichnung ohne Abfrage: Telefonie → Einstellungen → „Ohne Einwilligungsabfrage aufzeichnen“ einschalten (Warnhinweis erscheint) → Speichern → Anruf im Dialer: statt des Knopfes „Einwilligung erteilt“ steht „Aufzeichnung ohne Abfrage“, nach dem Gespräch gibt es Bewertung und Notiz aus dem Transkript. Danach wieder ausschalten.
6. Kategorie-Emojis: Lead-Kategorien → Kategorie öffnen → Zeile „Emoji“ (Vorschlag, Auswahl, eigenes Zeichen) → Speichern → Emoji dezent sichtbar in Leads (Spalte Typ), Dashboard (Kategorie-Chips, Bestellverteilung, Karte), Quick View und Pipeline-Karten.
7. Gespräche: Bewertung eines Beispielgesprächs öffnen → Kriterien und Punkte sichtbar.

### 1.10 Haustür-Erfassung
1. „Erfassen“ → Vertriebler wählen, Kontakt eintragen → Lead entsteht, Übersicht zählt hoch.
2. „Vertriebler & Agenturen“ → neuen Vertriebler mit Sub-ID anlegen.

### 1.11 Benutzer, Teams, Kooperationen
1. Benutzer: „Neuer Benutzer“ (Käufer) mit Passwort anlegen → Detailseite → Reiter „Ansicht“: nur „Bestellungen“ und „Support“ freigeben.
2. Reiter „Integration“: API-Endpunkt anlegen („Vorlage Aroundhome“ testen), „Als Preset speichern“.
3. „Als Benutzer einloggen“ → Kundenbereich „MEIN BEREICH“ nur mit den freigegebenen Punkten, gelbes Banner → „← Zurück zum Admin“ → Reiter „Aktivität“ zeigt Beginn und Ende.
4. Teams: Team anlegen, Mitglieder zuordnen. Kooperationen: Partner anlegen.

### 1.12 Einstellungen
1. System: Dublettenschutz-Zeitraum ändern → speichern. Reklamationsgründe: neuen Grund anlegen, „weitergeben“ setzen.
2. E-Mail: Vorlage bearbeiten. API-Dokumentation: Beispielaufrufe lesbar (werden in Phase 2 gebraucht).

### 1.13 Handy
1. Link des Chat-Builds am Handy öffnen → Tab-Leiste unten, „Mehr“ öffnet das Menü.
2. Leads → Karten, Auge öffnet Quick View in voller Breite; Benutzer → gestapelte Karten; Formular „Lead anlegen“ ausfüllen (Tastatur zoomt nicht).

---

## Phase 2 – Echte Installation (Railway) und echte Daten (ca. 2 Stunden)

### 2.1 Online stellen
1. START-HIER.md befolgen (Weg A mit Claude Code oder Weg B von Hand). Alle Variablen aus Schritt 5 setzen, `APP_URL` auf die erzeugte Adresse.
2. Prüfen: Adresse öffnen → Anmeldeseite mit Tanesco-Logo; „Konto erstellen“ → erstes Konto = Inhaber; danach ist die Registrierung zu (`REGISTRATION_OPEN=false`).
3. Railway → Dienst → „Logs“: Zeile „Datenbank ist auf dem aktuellen Stand“ (Migrationen) und „Server läuft“ – keine roten Fehler.
4. Sicherheit: Zugangsdaten aus dem ersten ZIP gelten als verbraucht → neue Passwörter/Schlüssel vergeben.

### 2.2 Grundgerüst mit echten Daten
1. Lead-Kategorien anlegen (Namen, Kürzel, Farben, Fachfelder wie im echten Betrieb).
2. Lieferanten anlegen (Benutzer → „Neuer Benutzer“, Art Lieferant) → Detailseite → Reiter „Lieferant“ → „Token erzeugen“ → Token sicher notieren.
3. Käufer anlegen (Art Käufer) mit Passwort → in einem zweiten Browser (oder privaten Fenster) als Käufer anmelden → Kundenbereich sichtbar, keine Verwaltungsseiten.
4. Bestellung für den Käufer anlegen, Lieferkette mit dem Käufer als Stop.

### 2.3 Lead-Eingang per API (mit dem Lieferanten-Token)
1. Einstellungen → API-Dokumentation → Beispiel für `POST /api/leads` kopieren, Token einsetzen, Testdaten senden (z. B. mit curl oder einem API-Tool).
2. Erwartung: Antwort `200` mit Lead-ID; Lead erscheint in der Liste; Lead-Log: „erfasst“ → ggf. „Auslieferung an …“.
3. Denselben Lead nochmal senden → Dublettenschutz greift (Lead-Log oder Antwort sagt Dublette).

### 2.4 Auslieferung an einen Käufer-Endpunkt (ohne echten Partner)
1. Auf webhook.site eine Test-Adresse erzeugen (kostenlos, zeigt eingehende Aufrufe an).
2. Käufer → Reiter „Integration“ → Endpunkt mit dieser Adresse, Methode POST, Vorlage frei → speichern → „Testlead senden“.
3. Erwartung: webhook.site zeigt den Aufruf mit den Lead-Feldern; Lead-Log: „API-Übergabe … geliefert (HTTP 200)“.
4. Auf webhook.site die Antwort auf `422` mit Text `duplicate` stellen → Response-Mapping im Endpunkt (`duplicate` → Grund „Dublette“, weitergeben) → nächsten Testlead senden → Reklamation entsteht, Lead geht an den nächsten Stop (Lieferkette → Aktivität).

### 2.5 Reklamation per API (Käufer-Token)
1. Käufer → Reiter „Reklamation“: Frist (z. B. 24 h), „automatisch annehmen“ ein; Käufer-Token erzeugen.
2. `POST /api/reclaim` (Beispiel aus der API-Dokumentation) mit `lead_number` und `reason` senden.
3. Erwartung: `200` mit `status: approved`; Lead-Status „Reklamiert“; bei „weitergeben“ Lieferung an den nächsten Stop; nach Ablauf der Frist antwortet die API mit `403`.

### 2.6 Rückgabe-Webhook an den Lieferanten
1. Lieferant → Reiter „Lieferant“ → Rückgabe-Webhook auf eine webhook.site-Adresse.
2. Reklamation genehmigen → webhook.site zeigt die Rückgabe-Meldung; Lead-Log: „Rückgabe-Webhook: gemeldet“.

### 2.7 E-Mail und Zeitplaner
1. Einstellungen → E-Mail: SMTP-Zugang eintragen → „Testmail senden“ → Mail kommt an.
2. Bestellung mit Liefertagen/Uhrzeiten außerhalb von jetzt anlegen → Lead bleibt „hängend“, wird beim nächsten Zeitplaner-Lauf (alle 15 Min.) ausgeliefert → Lead-Log prüfen.

### 2.8 Rollen und Sicherheit
1. Als Käufer anmelden und versuchen, `/?page=Benutzer` aufzurufen → Kundenbereich bleibt, keine Verwaltungsdaten.
2. Als Inhaber: „Als Benutzer einloggen“ für einen Admin → wird abgelehnt; für einen Käufer → funktioniert, Aktivität protokolliert.
3. Abmelden → Anmeldeseite; falsches Passwort → Fehlermeldung, kein Zugang.

---

## Phase 3 – Echte Partner (je ca. 30 Minuten, mit echten Zugangsdaten)

| Partner | Was einrichten | Was prüfen |
|---|---|---|
| **Aroundhome** | Käufer „Aroundhome“ → Integration → „Vorlage Aroundhome (mit Sub-ID)“ → echten Zugang eintragen | Haustür-Erfassung mit Sub-ID → Aroundhome erhält den Lead (deren Portal); Feldnamen mit der Aroundhome-Doku abgleichen; Tages-Abgleich (Sync) in den Partner-Konten prüfen |
| **Wattfox** | Einstellungen → Integrationen → Wattfox-Konto mit Token | `GET/POST /api/partner/wattfox/<token>` laut Doku testen → Leads kommen an |
| **OnDialer / Dialer** | Partner-Konto anlegen → Webhook-URL `/api/partner/ondialer/<token>` beim Dialer eintragen | Ein Anruf-Ergebnis vom Dialer → Lead/Ergebnis erscheint; Format der Dialer-Nachricht ggf. an mich schicken |
| **Twilio** | Telefonie → Twilio-Zugang (SID, Token), Nummer kaufen/zuweisen | Testanruf aus einer Kampagne; Rufnummer erscheint beim Angerufenen; Gespräch landet unter „Gespräche“ |
| **KI-Funktionen** | `ANTHROPIC_API_KEY` (und OPENAI/DEEPGRAM für Sprache-zu-Text) gesetzt | Kategorien-Builder aus PDF; Gesprächsbewertung eines Testgesprächs |

---

## Phase 4 – Abnahme-Checkliste (kurz)

| Bereich | Muss funktionieren | OK? |
|---|---|---|
| Anmeldung | Inhaber, Admin, Käufer, Lieferant mit passenden Rechten | |
| Leads | anlegen, importieren, API-Eingang, Dubletten, Quick View, Lead-Seite, Log | |
| Auslieferung | Bestellung + Kette, Wasserfall (Skip, Fenster, weitergeben, erschöpft), Zeitplaner | |
| Reklamation | intern und per API, Fristen, Gründe, Rückgabe-Webhook | |
| Kundenbereich | „Als Benutzer einloggen“, Ansicht-Freigaben, Zahlen-Auge | |
| Callcenter | Rohdaten, Telefonie, Gespräche | |
| Vertriebspipeline | Reiter Pipeline · Aufgaben (Wiedervorlagen, Jetzt anrufen, Erledigt/Verschieben) · Termine (Kalender, Einladung, Erinnerung) · Statistik (Kennzahlen, Funnel, Werte, bei Meta Ads die Tabelle „Kampagnen aus Meta“ mit „Pipeline zeigen“) · Einstellungen (Stufen: umbenennen/Reihenfolge/neue Stufe, Speichern erst bei Änderung; Team & Ziele; Automatik: Angebot → Nachfass-Serie, eingeschlafene Karten → Aufwecken, Antwort → Kontaktiert; Facebook-Verbindung). Karte: Klick klappt sie in ihrer Spalte auf (Spalte wird etwas breiter, ca. 480 px, Karte ca. 510 px hoch; oben Anrufen/nächste Stufe/Verloren, dann die Werkzeuge – Wiedervorlage/Termin/Wert zeigen den aktuellen Wert im Knopf –, darunter Infos (Anzeigengruppe/Anzeige/Formular bzw. Firma, Telefon, E-Mail) und Notizen (Mikrofon) nebeneinander – alles auf einen Blick; Schritte/Nachrichten als aufklappbare Zeilen), Name ohne Unterstrich, Pfeil-Knopf/Name → Lead-Seite, ✕ klappt zu; keine abgeschnittenen Texte; Wert/SMS/WhatsApp/E-Mail, Suche/Filter (ohne „Heiß“)/Mehrfachauswahl/CSV (ohne Spalte „Punkte“). Karten einheitlich (keine Kategoriefarbe als Hintergrund), keine Lead-Punkte. Alte Links `?ansicht=team` / `?ansicht=stufen` / `?meta=…` landen in den Einstellungen | |
| E-Mail-Kampagnen | A/B-Betreff mit Auswertung, Versandfenster, Link-Bedingung, Sperrliste (Bounce-Knopf + Webhook), Vorlagen/Kopie; KI-Builder: Vorschlags-Kacheln (Klick füllt nur die Beschreibung, Kachel markiert, Hinweis; gebaut wird erst mit dem Knopf; Ablauf-Baum: verschachtelte Wenn/Dann-Zweige untereinander, E-Mail-Karte ragt nie aus dem Zweig) im Builder-Reiter „KI-Vorlage“ und bei „Serie per KI“; Vorlagen → „Vorlagen schreiben“ (Kategorie, Unterschrift, Auswahl) legt fertige Vorlagen an, die unter „Neue Kampagne → Aus Vorlage“ erscheinen | |
| Posteingang | Erster Reiter ganz links (öffnet zuerst); oben Ordner mit Zählern (Alle, Ungelesen, Antworten, Nicht zugeordnet, Archiv, Gesperrt), Kampagnen-Auswahl (Hinweis „Nur Antworten auf …“ mit „Filter entfernen“) und Aktualisieren (liest das Postfach); Liste links schmal mit Suchfeld, Gruppen Heute/Gestern/Diese Woche/Älter, Initialen-Avataren und Merkern (Antwort: Kampagne, Stufe (Vertriebler), Nicht zugeordnet, Abgemeldet, Gesperrt); rechts die Nachricht groß: Absender, Betreff, Hinweise (Pipeline-Link), Knöpfe Als Lead in Pipeline / Stufe setzen (Formular klappt darunter auf, Telefon aus der Signatur), Antworten (springt ins Antwortfeld, Strg + Enter sendet), Sperren/Entsperren, Archivieren; Handy: Liste → Nachricht mit „Zurück zur Liste“ | |
| E-Mail-Verlauf | Posteingang: Mayer („Anfrage: Leads für Photovoltaik“) → Antworten → Senden → Als Lead in Pipeline (E-Mail-Pipeline) → Hinweis „4 E-Mails stehen im E-Mail-Verlauf der Karte“; Karte aufklappen → Zeile „E-Mail-Verlauf 4 · 4 vor dem Lead“ → letzte drei Mails als Chat (Eingegangen links, Unsere Antwort rechts), „1 ältere E-Mail anzeigen“, Marke „Als Lead angelegt“; Lead-Seite → Reiter „E-Mail-Verlauf 4“ mit Hinweis „4 E-Mails wurden schon vor dem Anlegen …“, Tagestrennern, KI-Merkern, „Ganze E-Mail“; Hansen (Kaltakquise): Serie → Serie → Eingegangen; Kontakt ohne Mailverkehr: keine Zeile | |
| Listen hochladen | Vertriebspipeline → Kaltakquise → Listen & Kontakte: Excel-Datei (.xlsx, erstes Blatt, Kopfzeile) oder CSV auswählen bzw. hineinziehen (Feld leuchtet beim Ziehen) → Listenname aus dem Dateinamen, Vorschau „n Kontakte erkannt · n Zeile(n) ohne Telefon/E-Mail übersprungen“, „In die Pipeline übernehmen“ → Liste in der Übersicht mit „mit E-Mail“-Zähler; E-Mail-Kampagnen → Neue Kampagne → Zielgruppe „Liste“ zeigt die Liste | |
| Kampagne: Liste & Versandfenster | Neue Kampagne → Zielgruppe „Liste“ → Box „Neue Liste hochladen“ (Excel/CSV hineinziehen oder „Datei wählen“) → „4 Kontakte erkannt, 3 mit E-Mail“ → Name prüfen → „Hochladen und als Zielgruppe wählen“ → Liste ist gewählt, „3 Empfänger“; Versandfenster bei neuer Kampagne eingeschaltet Mo–Fr 7:30–17:00, nach Änderung Link „Auf Standard zurücksetzen“; ältere Kampagnen ohne Fenster senden weiter rund um die Uhr | |
| Spalten zuordnen & Platzhalter | Liste mit Spalten Name/Betrieb/Mail/Telefon/Branche/Anzahl Mitarbeiter/Intern wählen → Tabelle „Spalten zuordnen“: Name→Nachname, Betrieb→Firma, Mail→E-Mail, Telefon→Telefon, Branche/Anzahl Mitarbeiter/Intern→Platzhalter; „Intern“ auf „nicht übernehmen“ → Hinweiszeile zeigt nur noch {{branche}} {{anzahl_mitarbeiter}}; hochladen → Builder: Leiste „Platzhalter einfügen“ mit festen Platzhaltern + grün {{branche}} {{anzahl_mitarbeiter}}; Klick fügt in Betreff/Baustein ein, Vorschau zeigt „Dachdecker“/„12“; Karte (Infos) und Lead-Seite („Aus der Liste“) zeigen Branche/Anzahl Mitarbeiter; Serien-Verlauf zeigt gefüllte Betreffs je Empfänger | |
| Posteingang KI | „Aktualisieren“ holt Antworten und die KI ordnet sie ein: Beschwerde → automatisch gesperrt (Hinweis mit Prozent + Zitat, Sperrliste „Beschwerden“, Serie gestoppt, alle Mails des Absenders unter „Gesperrt“), unsicher → Ordner „Prüfen“ mit „Sperren“/„Ist in Ordnung“, Abwesenheitsnotiz/Interessiert nur markiert (Interessiert = Notiz an der Pipeline-Karte); „Entsperren“ nimmt einen Fehlgriff zurück; Einstellungen → E-Mail-Versand → „KI prüft jede Antwort“ (aus = nur Wortliste; Auto-Sperre aus = nur Prüfen); Filter „KI: alle Antworten“ (Beschwerde … Automatisch gesperrt, Zu prüfen, Ohne Einordnung) kombinierbar mit Zeitraum und Kampagne; Sortierung „Einordnung: Interesse zuerst“ / „Beschwerde zuerst“ gruppiert die Liste mit Zählern (Wahl wird gemerkt), sonst Neueste/Älteste zuerst | |
| Posteingang Zeitraum | Auswahl Gesamt/Heute/Gestern/7 Tage/30 Tage/eigener Von–Bis; Hinweiszeile zeigt Kampagne + Zeitraum, „Filter entfernen“ setzt beides zurück | |
| Dashboard | Reiter „Übersicht“ (Kennzahlen → Bestellverteilung → Karte „Wo fließen die Leads?“ → Stundenverlauf → Lead-Puls) und „Statistik“ (anklickbar: „Auf einen Blick“ + Käufer/Lieferanten/Bestellungen/Lieferketten/Integrationen); kein eigener Menüpunkt „Statistik“ mehr (alter Link öffnet den Reiter, Sidebar markiert Dashboard); Zeitraum + Kategorie gelten für beide Reiter, auch für den Lead-Puls; mobil: Filter scrollen seitlich, Seite wird nicht breiter, Bestellverteilung erst 5 Karten mit „Alle anzeigen“ | |
| Ablauf-Editor | Zeile „So läuft es“ fasst den Ablauf zusammen; Schritte nummeriert an einer Linie, „+“ auf der Linie klappt die Einfüge-Auswahl auf; Warten mit Schnellwahl (1 Tag … 1 Woche); „Wenn … dann“ als Satz mit Zweigen „Dann“ (links, grün) / „Sonst“ (rechts, rot), Zweig-Kopf zeigt Kurzfassung („1 E-Mail → Ende“); E-Mail-Karten in schmalen Zweigen kompakt (Vorschau unter dem Betreff, keine endlos lange Karte mehr); Klick auf die Vorschau öffnet den Builder – der Builder startet oben (Kopf mit „Übernehmen“ sichtbar), „← Ablauf“/„Übernehmen“ springt zur bearbeiteten E-Mail-Karte zurück; Tippen im Betreff behält den Fokus | |
| Builder-Bausteine | Griff links: Baustein ziehen und ablegen (Einfügemarke), auch ganz nach oben; Knöpfe „Ganz nach oben“ (ab dem 3. Baustein), ↑, ↓, ✕; verschobener Baustein leuchtet kurz auf und bleibt im Bild | |
| Sperrliste | Unterlisten Bounces/Abmeldungen/Beschwerden/Posteingang/Manuell mit Quelle und Datum, Suche, CSV; Posteingang „Sperren“ → Filter „Gesperrt“, „Entsperren“; Antwort „bitte keine E-Mails“ → automatisch auf „Abmeldungen“ | |
| Trennung | Leads-Seite/Bestellungen/Lieferkette zeigen keine Pipeline-Kontakte; Pipeline/E-Mail-Zielgruppen enthalten keine Verkaufs-Leads; globale Suche trennt „Leads“ und „Vertriebskontakte“ | |
| Lead-Seite | Klick auf den Namen oder „Öffnen“ → eigene Seite (kein Overlay) mit Stammdaten-Formular (Speichern nur bei Änderung, Eintrag im Verlauf), Kategorie wechseln, „Kontakt löschen“ mit Rückfrage, Herkunft, Angebot & Termine, Verlauf, Notizen (Mikrofon), Aufgaben, Nachrichten, Anrufen, Serien, E-Mail-Verlauf (Chat-Ansicht mit Tagestrennern, Marke „Als Lead angelegt“, „Ganze E-Mail“); Stufe/Vertriebler umstellen | |
| Mikrofon | Notiz einsprechen: Freigabe-Abfrage, Text läuft live ein, Pausen überbrückt; in der Chat-Vorschau eigenes Sprachfenster | |
| Partner | Aroundhome, Wattfox, OnDialer, Twilio (mit echten Daten) | |
| Design | Hell/Dunkel, Handy (Tab-Leiste, Karten), keine abgeschnittenen Texte; Dashboard-Kategorien ohne Emojis (Leads-Seite, Kategorien, Pipeline behalten sie); Kategorie-/Status-Kapseln kräftig (helle Schrift auf getöntem Grund im Dunkeln, dunkle Schrift auf hellem Ton im Hellen); Kopfzeile der Leads-Tabelle mit einer durchgehenden Linie; Bestätigungsknopf „Ja, löschen/sperren“ weiß auf Rot | |

**Bei Problemen an mich schicken:** Screenshot, Seite + Klick, Text aus Lead-Log/Protokoll, bei API-Tests die Antwort (Status + Text). Dann fixe ich es und liefere einen neuen Build.
