# Go-live: Vertriebspipeline & E-Mail-Kampagnen (Stand 06.10.2026)

## A. Online stellen mit Railway (einmalig, ca. 45 Minuten)
1. ZIP entpacken → Ordner `tanesco-leads` in ein **privates GitHub-Repository** hochladen (GitHub → New repository → „uploading an existing file“ oder mit Git/Claude Code).
2. railway.com → New Project → **Deploy MySQL** (Datenbank).
3. Im selben Projekt → **+ New → GitHub Repo** → `tanesco-leads` wählen. Railway baut über das `Dockerfile` (Start: Migrationen, dann Server).
4. Service **Variables** (Reiter „Variables“ des App-Service):
   - `DATABASE_URL` = `${{MySQL.MYSQL_PRIVATE_URL}}` (Referenz auf die Railway-MySQL)
   - `JWT_SECRET` = langer Zufallstext (z. B. 48 Zeichen)
   - `APP_URL` = öffentliche Adresse der App (Settings → Networking → **Generate Domain**, z. B. `https://tanesco-leads.up.railway.app`) – nötig für Öffnungs-/Klickmessung, Abmeldelink, Logo in E-Mails und Meta-Webhook
   - `NODE_ENV` = `production`, `REGISTRATION_OPEN` = `false`
   - optional: `MAIL_WEBHOOK_SECRET` (schützt den Bounce-Webhook `APP_URL/api/mail/bounce`, beim Mail-Anbieter als `?secret=…` anhängen)
   - optional: `ANTHROPIC_API_KEY` (KI-Hilfe, Gesprächsbewertung und ausführliche automatische Gesprächsnotizen – ohne Schlüssel gibt es eine Kurzfassung aus dem Transkript), `OPENAI_API_KEY` oder `DEEPGRAM_API_KEY` (Sprache zu Text für Aufzeichnungen; entfällt in der Simulation), `META_APP_ID` + `META_APP_SECRET` (Facebook-Login), `GOOGLE_PLACES_API_KEY` (Lead-Finder, derzeit ausgeblendet)
5. Deploy abwarten (2–3 Minuten) → `APP_URL` im Browser öffnen → **Konto erstellen**: das erste Konto ist der Inhaber/Admin.
6. Eigene Domain (optional): Settings → Networking → Custom Domain (z. B. `leads.tanesco.digital`) + CNAME bei All-Inkl; danach `APP_URL` anpassen und neu deployen.

Updates: neuen Stand ins Repository pushen → Railway baut automatisch neu, Migrationen laufen beim Start, Daten bleiben.

## B. In der Software einrichten (ca. 30 Minuten)
1. **Einstellungen → E-Mail-Versand**: Anbieter **Brevo** wählen, Login-E-Mail + SMTP-Schlüssel, Absendername und `vertrieb@tanesco.digital`, Tageslimit (Start: 100), „Versand einschalten“ → Speichern → **Testmail** an dich → **Domain prüfen** (SPF/DKIM/DMARC grün; Einträge bei All-Inkl laut Brevo).
2. Dort auch **IMAP** aktivieren (Postfach der Absenderadresse, Port 993) → „Jetzt abgleichen“ – damit füllt sich der Posteingang und Antworten zählen in den Serien.
3. **Benutzer → Neuer Benutzer**: Taner und Francesco mit Rolle **„Vertriebler (Pipeline & Haustür)“** anlegen → sie erscheinen in der Pipeline als Vertriebler und bekommen eine Willkommensmail mit Zugang.
4. **Lead-Kategorien**: mindestens eine Kategorie anlegen (z. B. Photovoltaik) – Kontakte und Kampagnen hängen daran.
5. **Vertriebspipeline → Kaltakquise → Listen & Kontakte**: CSV hochladen (Vorname;Nachname;Firma;Telefon;E-Mail;PLZ;Ort), Zuteilung „Taner / Francesco (50 % je)“ → In die Pipeline übernehmen. Einzelkontakte per Formular.
6. **E-Mail-Kampagnen → Neue Kampagne**: Texte im Builder anpassen (Logo ist drin, Fußzeile/Abmeldetext prüfen), Absender, Zielgruppe „Liste“ (eine vorhandene Liste wählen oder direkt dort „Neue Liste hochladen“: Excel/CSV → „Hochladen und als Zielgruppe wählen“) → Speichern → **Starten**. Erste E-Mails gehen sofort raus, Nachfass-Schritte übernimmt der Zeitplaner (jede Minute). Antworten: Reiter **Posteingang** → „Als Lead in Pipeline“.
7. **Meta Ads** (wenn gewünscht): Vertriebspipeline → Meta Ads → Einstellungen → Facebook-Verbindung → „Mit Facebook verbinden“ (braucht `META_APP_ID/SECRET`) oder Seiten-Token einfügen → Formulare → Kategorie zuordnen. In der Meta-App: Rückruf-URL `APP_URL/api/meta/oauth/callback`, Webhook `APP_URL/api/meta/webhook` (Objekt Page, Feld leadgen, Verify-Token aus der Plattform).

## C. Täglicher Betrieb
- Pipeline: Karten ziehen oder „→ nächste Stufe“, Notizen (auch per Mikrofon – der Browser fragt auf der eigenen https-Adresse einmal nach der Freigabe; in der Chat-Vorschau ist das Mikrofon gesperrt), Vertriebler-Filter, Statistik-Reiter.
- Dialer in der Pipeline: Karte öffnen → „Anrufen“, oder Telefon-Symbol im Spaltenkopf → ganze Stufe als Wählliste (Manuell / Power / Predictive). Ergebnis setzen → Karte rückt passend vor. Voraussetzung: eine Rufnummer unter Telefonie → Rufnummern (Twilio; ohne Zugangsdaten Simulation).
- Aufzeichnung: Standard mit Ansage oder Agenten-Klick. Der Schalter „Ohne Einwilligungsabfrage aufzeichnen“ (Telefonie → Einstellungen) nimmt ab Gesprächsbeginn auf – nur nutzen, wenn die Einwilligung bereits vorliegt (z. B. im Lead-Formular); in DE/AT/CH ist Aufzeichnen ohne Einwilligung strafbar (§ 201 StGB).
- Dialer: Nach jedem Gespräch entsteht automatisch eine Gesprächsnotiz (Zusammenfassung, Punkte, nächster Schritt) an der Karte, im Verlauf und in der Anrufliste. Ein/Aus: Schalter „Auto-Notiz“ im Dialer, bei der Anrufkampagne, je Kampagne und als Standard in Telefonie → Einstellungen.
- E-Mail: Kampagnen-Übersicht (gesendet/geöffnet/geklickt/geantwortet), Posteingang mit Filtern, Antworten direkt beantworten.
- Heute: Reiter „Heute“ in der Pipeline – alles, was fällig ist (Wiedervorlagen aus dem Dialer, Aufgaben von der Karte), mit „Jetzt anrufen“ bzw. „Alle abtelefonieren“, Erledigt und Verschieben. Termine der nächsten Tage daneben; Wochenkalender unter „Termine“.
- Karte: „Wiedervorlage“, „Termin“ (Einladung mit Kalendereintrag, Erinnerung automatisch), „Wert“ (Angebotswert → Pipeline-Wert und Umsatz in der Statistik), „SMS“/„WhatsApp“/„E-Mail“ mit Vorlagen. SMS braucht eine eigene Rufnummer (Telefonie), WhatsApp ohne Business-Anbindung öffnet WhatsApp mit fertigem Text.
- Automatik (Reiter in der Pipeline): einmal einstellen – Stufe „Angebot“ → Nachfass-Serie, eingeschlafene Karten nach 5 Tagen → Aufweck-Serie, Antwort im Posteingang → „Kontaktiert“, Terminerinnerung 24 h vorher. Läuft alle 15 Minuten im Server, „Automatik jetzt ausführen“ zum Prüfen.
- Team: Tagesziele (Anrufe/Termine/Abschlüsse) für Taner und Francesco eintragen, Zählung je Tag/Woche/Monat; Verteilregeln für neue Leads (z. B. PLZ 6/5 → Taner, 8/9/7 → Francesco) oder reihum.
- KI-Vorlagen-Builder: im Builder einer E-Mail Reiter „KI-Vorlage“ (beschreiben → E-Mail bauen) oder im Kampagnen-Editor „Serie per KI“ (ganze Serie). Braucht `ANTHROPIC_API_KEY` beim Hosting – ohne Schlüssel kommt ein regelbasierter Entwurf.
- Leads aus dem Posteingang: Telefonnummer wird aus der Signatur erkannt; fehlt sie, fragt der Telefon-Knopf an der Karte die Nummer ab und ruft direkt an.
- Trennung: Leads zum Verkauf (Lead-Operations) und Vertriebskontakte (Pipeline, E-Mail-Kampagnen, Posteingang) sind strikt getrennt (Kennzeichen `kind`). Migration 0062 markiert Bestandsdaten automatisch – danach einmal prüfen: Leads-Seite ohne META-/KALT-/MAIL-Einträge, Pipeline ohne Verkaufs-Leads.
- Sperrliste: füllt sich von selbst (Bounces per Webhook `/api/mail/bounce` oder Knopf, Abmeldungen per Link oder erkannter Antwort, Posteingang „Sperren“). Unterlisten mit Quelle/Datum, CSV-Export. Mikrofon für Notizen braucht https und Chrome/Edge/Safari.
- E-Mail-Kampagnen: „Neue Kampagne“ bietet fertige Abläufe (Kaltakquise, Nachfassen nach Angebot, Aufwecken) und eigene Vorlagen. Versandfenster ist bei neuen Kampagnen schon an (werktags 7:30–17:00 Uhr), bei Bedarf anpassen, bei Bedarf „Betreff B“ für den A/B-Test. Bounces: beim Mail-Anbieter den Webhook auf `https://<deine-domain>/api/mail/bounce?secret=<MAIL_WEBHOOK_SECRET>` legen – gesperrte Adressen landen in der Sperrliste und werden nie wieder angeschrieben.
- Zeitplaner läuft im Server: Serienschritte jede Minute, Posteingang alle 15 Minuten, Meta-Kennzahlen stündlich.
