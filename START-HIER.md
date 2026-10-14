# Tanesco Leads – Quellcode ohne Manus (Stand 22.09.2026)

Dies ist die komplette Software. Sie hängt an keinem Manus-Dienst mehr:
Anmeldung mit E-Mail und Passwort, KI-Funktionen direkt über Claude, Dateien auf dem eigenen Server.
Alle Datenbankänderungen spielt die Software beim Start selbst ein.

## Was die Software zum Laufen braucht

Einen Platz im Internet mit vier Dingen: einem Server für die Software, einer MySQL-Datenbank, einer Internetadresse und
ein paar Einstellungen (unten). Empfehlung: **Railway** (railway.com), dort gibt es alles an einem Ort.

## Weg A – mit Claude Code (empfohlen)

Claude Code (Desktop-App, Bereich „Code") kann die Einrichtung komplett übernehmen. Ordner mit diesem Quellcode öffnen und sagen:

> „Stelle diese Software auf Railway online: neues Projekt, MySQL-Datenbank, Dienst aus dem Dockerfile, Einstellungen aus .env.example
> setzen (DATABASE_URL auf die private Adresse der Datenbank), Domain erzeugen und APP_URL darauf setzen. Danach erstes Konto anlegen lassen."

Claude Code fragt dann nach dem Railway-Konto und dem Anthropic-Schlüssel und macht den Rest.

## Weg B – von Hand (Klick-Anleitung)

1. **Code auf GitHub ablegen**: Auf github.com ein neues, privates Repository anlegen („New repository"), dann „uploading an existing file"
   und den kompletten Inhalt dieses Ordners hochladen (ohne `node_modules`, das ist nicht enthalten).
2. **Railway-Konto**: railway.com → Konto anlegen (Hobby-Plan, ca. 5 US-Dollar im Monat plus Verbrauch, in der Regel unter 20 Dollar).
3. **Datenbank**: Im Projekt „+ New" → „Database" → „MySQL". Fertig, Railway richtet sie ein.
4. **Software**: „+ New" → „GitHub Repo" → das Repository aus Schritt 1 wählen. Railway erkennt das Dockerfile und baut die Software.
5. **Einstellungen** (Dienst der Software → „Variables"), jeweils Name = Wert:
   - `DATABASE_URL` = `${{MySQL.MYSQL_PRIVATE_URL}}` (genau so eintragen, Railway setzt die Adresse der Datenbank ein)
   - `JWT_SECRET` = ein langer, zufälliger Text (mindestens 32 Zeichen, z. B. aus einem Passwort-Generator). Damit werden Anmeldungen und
     Zugangsschlüssel geschützt. Nie ändern, ohne danach die Schlüssel der Integrationen neu einzutragen.
   - `ANTHROPIC_API_KEY` = Schlüssel aus console.anthropic.com (für die KI-Funktionen: Builder und Gesprächsbewertung)
   - `OPENAI_API_KEY` oder `DEEPGRAM_API_KEY` = für die Gesprächsbewertung (Sprache zu Text). Entfällt, wenn der Dialer das Transkript mitliefert.
   - `REGISTRATION_OPEN` = `false`
   - `DELIVERY_SCHEDULER_INTERVAL_MINUTES` = `15`
   - `NODE_ENV` = `production`
   - `SMTP_URL` = Zugang deines Mail-Anbieters für den E-Mail-Versand, z. B. `smtps://benutzer:passwort@smtp.deinanbieter.de:465`
     (ohne diesen Wert werden Willkommens- und Erinnerungsmails nur protokolliert, nicht verschickt)
   - `SMTP_FROM` = Absender, z. B. `Tanesco Leads <service@tanesco.digital>`
6. **Adresse**: Dienst → „Settings" → „Networking" → „Generate Domain". Die angezeigte Adresse (https://…up.railway.app) als weitere
   Einstellung `APP_URL` eintragen. Eine eigene Domain (z. B. leads.tanesco.de) kann dort ebenfalls hinterlegt werden.
7. **Dateiablage** (optional, für hochgeladene Kategorie-Dateien): Dienst → „Settings" → „Volumes" → Volume mit Mount-Pfad `/app/uploads`.
8. **Erstes Konto**: Adresse im Browser öffnen → „Konto erstellen". Das erste Konto bekommt alle Rechte. Danach ist die Registrierung
   geschlossen; weitere Nutzer kommen über „Benutzer → Einladen" (Einladungslink weitergeben).

## Gesprächsbewertung (Callcenter)

Unter „Gespräche → Dialer & Bewertung" steht die Webhook-Adresse, die im Dialer (OnDialer) bei „Gespräch beendet" eingetragen wird.
Der Dialer schickt Gesprächsdaten, Einwilligung und den Link zur Aufzeichnung; die Software transkribiert, bewertet und entscheidet.
Wichtig: Aufzeichnen und Auswerten nur mit Einwilligung beider Gesprächspartner (§ 201 StGB, DSGVO) – die Software wertet nur Gespräche
mit gesetztem Einwilligungs-Feld aus. Die Feldzuordnung ist einstellbar, sobald die OnDialer-Beschreibung des Webhooks vorliegt.

## Rohdaten (Callcenter-Listen)

Unter Callcenter → Rohdaten könnt ihr Listen (CSV/Excel) hochladen, die noch keine Leads sind. Die Kontakte erscheinen erst unter Leads,
wenn das Callcenter sie qualifiziert hat (Ergebnis „interessiert/verkauft“ oder Freigabe der Gesprächsbewertung) oder jemand sie bewusst übernimmt.
Dann laufen sie wie jeder Lead über Regeln, Bestellungen und Auslieferung.

## Telefonie (eigener Dialer)

Ohne Konto läuft die Telefonie in der Simulation (alle Abläufe sichtbar, keine echten Anrufe). Für echte Anrufe:
1. Konto bei Twilio anlegen, Adresse eintragen (Address SID) und für jedes Land ein regulatorisches Bundle einreichen (Bundle SID für DE, AT, CH) – ohne Bundle vergibt Twilio dort keine Rufnummern.
2. Für das Browser-Softphone einen API Key (SID + Secret) und eine TwiML-App anlegen; als Voice-URL der TwiML-App die Adresse aus Telefonie → Einstellungen eintragen.
3. In der Software unter Telefonie → Einstellungen „Twilio“ wählen, Zugangsdaten und SIDs eintragen, speichern; dann unter Rufnummern die erste Nummer kaufen.
4. Beim Hosting `APP_URL` auf die öffentliche Adresse setzen (Twilio ruft die Webhooks auf) und `DIALER_TICK_SECONDS=5` lassen (Predictive-Takt).

Aufzeichnen und Bewerten nur mit Einwilligung (Ansage oder Klick des Agenten) – siehe Gesprächsbewertung.

## Lieferkette (Wasserfall) und Kundenbereich

- **Lieferkette** (Menü LEAD-OPERATIONS → Lieferkette): pro Lead-Kategorie eine Kette anlegen, dann Stops (Käufer + Preis) hinzufügen. Ein Lead läuft der Reihe nach über die Stops; passt ein Stop nicht (PLZ, Filter, Lieferant, Telefonnummer, Alter …), wird er übersprungen – ohne Belastung. Je Stop: Reklamationsfenster in Stunden (0 = sofort angenommen), welche Reklamationsgründe erlaubt sind und ob der Lead danach weitergegeben wird. Läuft ein Lead durch die ganze Kette ohne Abnehmer, entscheidet die Regel „Lead ohne Abnehmer“: zurück an die Quelle oder freigeben (weitere Ketten, dann Bestellungen).
- **Als Benutzer einloggen** (Benutzer → Detailseite): ohne Rückfrage in den Kundenbereich „MEIN BEREICH“ wechseln und die Plattform so sehen wie dieser Kunde (nur die im Tab „Ansicht“ freigegebenen Menüpunkte). Oben erscheint ein gelbes Banner; „← Zurück zum Admin“ bringt dich zur Benutzerseite zurück. Nicht möglich für den Owner, dich selbst und andere Admins. Start und Ende stehen im Tab „Aktivität“, Aktionen in dieser Zeit sind mit „durch Admin …“ markiert.

## Sicherheit

Die alten Manus-Zugänge (Datenbank, Stripe, Schlüssel) aus dem ursprünglichen ZIP werden nicht mehr benutzt. Bitte trotzdem bei Manus
kündigen bzw. die Schlüssel dort ungültig machen, damit sie nirgends mehr gelten.

## Für Entwickler

`pnpm install` · `pnpm build` · `pnpm start` (führt Migrationen aus und startet den Server) · `pnpm test` · Abnahmetest siehe TECHNISCHE-NOTIZEN.md.
Lokal: `.env.example` nach `.env` kopieren und Werte setzen; `pnpm dev` startet Server und Oberfläche mit Live-Reload.

## Meta Lead Ads (Vertriebspipeline)
- `MAIL_WEBHOOK_SECRET` (optional): Geheimnis für den Bounce-/Beschwerde-Webhook der E-Mail-Kampagnen (`POST APP_URL/api/mail/bounce?secret=…` oder Header `x-webhook-secret`); ohne Wert nimmt der Webhook jede Meldung an.
- `META_APP_ID`, `META_APP_SECRET`: Meta-App für den Facebook-Login und die Webhook-Signaturprüfung. Rückruf-URL in der Meta-App: `APP_URL/api/meta/oauth/callback`. Webhook (Objekt Page, Feld leadgen): `APP_URL/api/meta/webhook` – Verify-Token steht in der Plattform unter Vertriebspipeline → Facebook-Verbindung.
- Ohne Meta-App: Seiten-ID und Seiten-Zugriffstoken (Business Manager, Rechte leads_retrieval, pages_manage_metadata, ads_read) in der Plattform einfügen.

## Lead-Finder
- Ohne Schlüssel sucht der Lead-Finder in OpenStreetMap (kostenlos, Qualität je nach Region). Mit `GOOGLE_PLACES_API_KEY` (Google Cloud → Places API (New)) kommen vollständigere Treffer mit Telefon, Webseite und Bewertungen. Die Anreicherung liest die Firmenwebseite; mit `ANTHROPIC_API_KEY` fasst die KI das Profil zusätzlich zusammen.
