# Haustür-Erfassung (D2D) – Nachbau-Spezifikation

Quelle: app.leadfy.ai `/haustuer`, analysiert am 28.09.2026 (UI, Client-Code, i18n-Texte).
Hinweis: Im Account gab es keine Daten, keine Agentur und keinen Haustür-Vertriebler – gefüllte Zustände, Agentur-Detailseite und Vertriebler-Oberfläche sind aus Code + Texten abgeleitet. Der Fragenkatalog (Frage 1 „Installationsort“ usw.) war nicht einsehbar.

Tech-Stack Leadfy (zur Orientierung): Next.js (App Router, Server Components + Server Actions), Supabase, next-intl, shadcn/ui, Recharts, lucide-Icons.

---

## 1. Grundidee

- Vertriebler (Haustür/D2D) erfassen Kontakte **zuerst bei uns** (Vorerfassung) und tragen sie **danach im Aroundhome-iFrame** ein.
- Jeder Vertriebler hat eine **Sub-ID** (vergibt Aroundhome). Aroundhome-Einträge laufen unter dieser Sub-ID.
- Aroundhome liefert **keine Kontaktdaten zurück** → Abgleich nur über **Sub-ID + Tag**, nicht je Kontakt.
- Aroundhome-Zahlen werden regelmäßig synchronisiert (Stand „spätestens vor 15 Minuten“).
- Vertriebler können in **Agenturen** (technisch: Teams) gruppiert sein; Agenturleiter haben eigenen Login und sehen nur ihre Agentur.

## 2. Rollen & Sichtbarkeit

| Rolle | Sieht / darf |
|---|---|
| Admin (Mandant) | Gesamtübersicht `/haustuer`, alle Agenturen & Vertriebler, Einstellungen (iFrame, Zuweisung), Agentur anlegen, Vertriebler anlegen/sperren, Sub-IDs pflegen, CSV-Export |
| Agenturleiter | Dashboard nur seiner Agentur, Kontakte + Vertriebler seiner Agentur, Vertriebler anlegen, Sub-IDs pflegen |
| Haustür-Vertriebler | Erfassungsformular + Aroundhome-iFrame, „Meine Kontakte“, eigene KPIs |

Modul ist nur sichtbar (Sidebar Admin + Vertriebler), wenn ein Aroundhome-iFrame hinterlegt ist.

## 3. Datenmodell (Vorschlag)

```
tenant_d2d_settings
  tenant_id
  embed_script_url     -- Aroundhome-Skript (nur https://*.aroundhome.de)
  lead_type_id  NULL   -- "Sparte"; NULL = Vorerfassung aus (nur iFrame)
  buyer_user_id NULL   -- "Käufer"; nur erlaubt wenn lead_type_id gesetzt

agencies (= teams)
  id, tenant_id, name, code (Kürzel, auto-generiert, unique), leader_user_id

d2d_reps
  id (user_id), tenant_id, agency_id NULL, first_name, last_name, email,
  sub_id NULL UNIQUE per tenant  -- ^[A-Za-z0-9_-]{1,64}$
  active bool

leads (vorerfasste Kontakte)
  id, lead_number, tenant_id, lead_type_id, rep_id, agency_id,
  salutation (herr|frau), first_name, last_name, phone, email,
  street, house_number, zip (5-stellig), city, note,
  answers jsonb (Fragen "wie bei Aroundhome"), created_at
  status: sold (wenn Käufer gesetzt → direkt verkauft an buyer, ohne Bestellung/Abrechnung/API-Versand)
          approved ("Genehmigt", unverkauft, wenn kein Käufer)

aroundhome_daily (Sync alle 15 min)
  tenant_id, sub_id, day, ah_total, qualified, open, cancelled
```

## 4. Admin-Übersicht `/haustuer`

### 4.1 Header
- Titel „Haustür-Erfassung“, Beschreibung: „Vorerfasste Haustür-Kontakte je Vertriebler und Tag, abgeglichen mit den Aroundhome-Transaktionen unter seiner Sub-ID.“
- Buttons: **CSV exportieren**, **Agentur anlegen** (Building-Icon), **Zuweisung** (Settings-Icon; amber umrandet + Tooltip „Keine Sparte gewählt – Vorerfassung ist aus. Hier festlegen.“ wenn keine Sparte gesetzt).

### 4.2 Filter (Zustand in URL: `?from=YYYY-MM-DD&to=YYYY-MM-DD&agency=<id>&rep=<id>`)
- **Agentur** (nur wenn Agenturen existieren): „Alle Agenturen“ + Liste.
- **Vertriebler**: „Alle Vertriebler“ + Einträge „Name · Sub-ID“ (bei gewählter Agentur nur deren Vertriebler).
- **Schnellwahl**: Heute / Gestern → sofort anwenden.
- **Von / Bis** (date; Von max = Bis) + Button **Anwenden**.
- Standard: letzte 7 Tage inkl. heute.

### 4.3 KPI-Karten (5, Grid 2/3/5 Spalten)
| Label | Wert | Hint | Icon/Farbe |
|---|---|---|---|
| Vorerfasst | captured | – | DoorOpen, blau |
| Bei Aroundhome | ah | „{pct} der Vorerfassungen“ = ah/captured | Handshake, violett |
| Qualifiziert | qualified | „{pct} von Aroundhome“ = qualified/ah | BadgeCheck, grün |
| Offen | open | – | CircleDashed, amber |
| Storniert | cancelled | „{pct} von Aroundhome“ = cancelled/ah | XCircle, rot |

`pct = Math.round(a/b*100) + " %"`, bei b = 0 → „—“.

### 4.4 Top Agenturen im Zeitraum
- Nur wenn Agenturen existieren **und** weder Agentur- noch Vertriebler-Filter aktiv.
- Enthält Agenturen mit id oder mit Vertrieblern > 0; Zeile „Ohne Agentur (direkt)“ möglich.
- Standard Top 3, Toggle „Alle anzeigen ({count})“ / „Nur Top 3“ (wenn > 3).
- Zeile: Rang-Badge (1 amber/gold, 2 slate/silber, 3 orange/bronze, sonst grau), Name, Sub: „{reps} Vertriebler · {ah} bei Aroundhome · {qualified} qualifiziert“, Wert = captured + Fortschrittsbalken (captured / max captured).
- Klick → `/haustuer/agentur/{id}`.

### 4.5 Top 3 im Zeitraum (Vertriebler)
- Nur Vertriebler mit captured > 0 oder ah > 0; Toggle auf „Alle Vertriebler“ (dann alle inkl. 0).
- Sub: („{Agentur} · “ wenn Agenturen existieren und kein Agenturfilter) + „{ah} bei Aroundhome · {qualified} qualifiziert“.
- Inaktive Vertriebler ausgegraut. Klick → setzt Vertriebler-Filter.
- Bei aktivem Vertriebler-Filter werden beide Ranglisten ausgeblendet, Chart volle Breite (sonst Grid 2fr / 3fr).

### 4.6 Verlauf je Tag (Chart)
- Titel „Verlauf je Tag“ bzw. „Verlauf je Tag – {name}“ bei Vertriebler-Filter.
- Gruppiertes Balkendiagramm, 3 Serien je Tag: Vorerfasst `#2563eb`, Bei Aroundhome `#7c3aed`, Qualifiziert `#16a34a`.
- Höhe 256 px, Balken max 28 px, Radius oben 3, barGap 2, Kategorie-Abstand 20 %, horizontales Grid gestrichelt.
- X-Achse Format „TT.MM.“ (en: MM/DD), jedes n-te Label (n = floor(Tage/10)); Y-Achse ganzzahlig.
- Legende darunter (Punkte + Label). Leer (alle 0) → „Nichts im Zeitraum.“

Fußnote darunter: „Aroundhome liefert keine Kontaktdaten zurück – der Abgleich läuft über Sub-ID und Tag, nicht je Kontakt.“

### 4.7 Tabelle „Erfasste Kontakte“
- Spalten: Erfasst (Datum+Uhrzeit, Mandanten-Zeitzone) · Kontakt (Name als Link zum Lead + „#Lead-Nr.“) · Ort · Vertriebler · Agentur (nur wenn Agenturen existieren).
- Begrenzte Anzahl, Hinweis „neueste {shown} von {total}“.
- Leer → „Nichts im Zeitraum.“

### 4.8 CSV-Export
- Server-seitig mit `{from, to, repId, teamId}` → `{csv, filename}` (Fallback `haustuer.csv`).
- Format: `;`-getrennt, UTF-8 mit BOM, CRLF, Quoting bei `;`, `"` oder Zeilenumbruch (`"` → `""`).
- Spalten: Erfasst am; Nr.; Vertriebler; Sub-ID; Agentur; Anrede; Vorname; Nachname; Telefon; E-Mail; Straße; PLZ; Ort; Notiz.

## 5. Dialoge / Einstellungen

### 5.1 Zuweisung
- Text: „Vorerfasste Kontakte landen in dieser Sparte. Mit Käufer gehen sie sofort als verkauft an ihn (ohne Bestellung, ohne Abrechnung, ohne API-Versand). Ohne Käufer bleiben sie unverkauft auf „Genehmigt“ liegen. Keine Sparte = Vorerfassung aus (nur Iframe).“
- Felder: **Sparte** (Lead-Kategorien des Mandanten, „— keiner —“), **Käufer** (Buyer-User des Mandanten, „— keiner —“).
- Validierung: Käufer ohne Sparte → „Für einen Käufer bitte auch eine Sparte wählen.“; fremde IDs → „Sparte oder Käufer gehört nicht zu diesem Mandanten.“

### 5.2 iFrame Aroundhome (Mandanten-Einstellung)
- Eingabe: Skript-URL `https://aaa.aroundhome.de/trck/ehtml/…` oder komplettes `<script>`-Snippet aus der Aroundhome-Mail (URL wird extrahiert).
- Nur https-Adressen von aroundhome.de. Speichern → Modul sichtbar; „Entfernen“ → Modul aus.

### 5.3 Agentur anlegen
- Hinweis: „Die Agentur bekommt einen eigenen Zugang: Übersicht, Kontakte und Vertriebler nur ihrer Agentur. Zugangsdaten gehen per E-Mail an den Agenturleiter.“
- Felder: Name der Agentur *, Agenturleiter (Login): Vorname, Nachname, E-Mail *. Intern zusätzlich `code` (Kürzel, auto).
- Ablauf: Team anlegen + Leiter-User anlegen + Welcome-Mail → Redirect `/haustuer/agentur/{teamId}`.
- Fehler: Name fehlt · ungültige E-Mail · „Kein freies Kürzel gefunden – bitte selbst eins angeben.“ · „Zu dieser E-Mail-Adresse gibt es schon ein Konto.“ · „Nutzer-Limit des Mandanten erreicht.“ · Warnung „Konto angelegt, aber die Willkommens-Mail konnte nicht verschickt werden.“

## 6. Agentur-Detailseite `/haustuer/agentur/{teamId}`
- Gleiches Dashboard wie 4., fest auf die Agentur gefiltert (keine Agentur-Rangliste).
- Link zurück „Gesamtübersicht“, Meta „Agenturleiter: {leader}“.
- Enthält die Vertriebler-Verwaltung der Agentur (7.). Agenturleiter sieht dieselbe Seite für seine Agentur.

## 7. Vertriebler-Verwaltung (Haustür)
- Tabelle: Vertriebler · Status · Sub-ID · KPIs im gewählten Zeitraum; Suche „Suchen …“. Auf der eigenen Vertriebler-Seite: „Zahlen der letzten 30 Tage. Sub-IDs vergibt Aroundhome – hier eintragen.“
- **Vertriebler anlegen**: Vorname + Nachname (Pflicht), E-Mail (Pflicht), Sub-ID optional. Hinweis: „Zugangsdaten gehen per E-Mail an den Vertriebler. Die Sub-ID von Aroundhome kannst du gleich oder später eintragen.“ → Toast „Vertriebler angelegt – Sub-ID {sub}.“ bzw. „… Sub-ID bitte nachtragen.“
- **Sub-ID bearbeiten** („Sub-ID für {name}“, Placeholder „z. B. 2822“): Regex `^[A-Za-z0-9_-]{1,64}$`, eindeutig („Diese Sub-ID ist schon einem anderen Vertriebler zugeordnet.“). Ohne Sub-ID: Badge „Sub-ID fehlt“; Vertriebler sieht statt Formular nur Hinweis.
- **Sperren / Entsperren**: gesperrt = kein Login mehr, Zahlen bleiben.

## 8. Vertriebler-Oberfläche (Erfassungs-Tool)

- Ohne Sub-ID: „Deine Sub-ID von Aroundhome ist noch nicht eingetragen. Sobald deine Agentur sie hinterlegt hat, kannst du hier Kontakte erfassen.“
- Kopf: „Haustür-Erfassung“, „Sub-ID: {id}“.

**Schritt 1 – „1. Kontakt bei uns erfassen“**
- Hinweis: „Gleiche Fragen wie bei Aroundhome. Pflicht: Frage 1, Name, Telefon, E-Mail, PLZ. Danach den Kontakt bei Aroundhome eintragen.“
- Fragen (wie Aroundhome; Frage 1 = Installationsort, Pflicht) + Kontakt: Anrede (Herr/Frau), Vorname, Nachname, Telefon, E-Mail, Straße, Hausnr., PLZ, Ort, Notiz.
- Validierung: Name, gültige Telefonnummer, gültige E-Mail, PLZ 5-stellig, Frage 1.
- Entwurf wird lokal gespeichert → „Nicht gespeicherte Eingabe wiederhergestellt.“ + „Verwerfen“.
- Speichern → Lead in Sparte anlegen → „{name} gespeichert (Nr. {nr}).“ + „Jetzt bei Aroundhome erfassen – Werte per Klick kopieren.“

**Schritt 2 – „2. Bei Aroundhome erfassen“**
- Aroundhome-iFrame (Skript-URL aus Einstellungen, Sub-ID des Vertrieblers).
- Kopier-Buttons je Feld („{label} kopieren“) zum Übertragen ins Aroundhome-Formular.
- Button „Neuen Kontakt erfassen“.

**Meine Kontakte**
- „{count} Kontakte“, Suche „Name, Ort, Telefon suchen …“, Zeitraum: Gesamt / Heute / Gestern / Letzte 7 Tage / Letzte 30 Tage / Von–Bis („Zurücksetzen“, „Gesamter Zeitraum“), „{count} Treffer“.
- Detail: „Erfasst am {date}“, „Nr. {nr}“, Anrede …, „Antworten (wie bei Aroundhome)“, Kopier-Buttons „Bei Aroundhome erfassen“.
- **Bearbeiten** („Kontakt korrigieren“): „Änderungen gelten nur bei uns – was bei Aroundhome erfasst wurde, bleibt unverändert.“
- Agenturleiter: „Kontakte der Agentur“, je Kontakt „erfasst von {name} ({sub})“.

**Eigene KPIs**: Vorerfasst, Bei Aroundhome, Qualifiziert, Offen, Storniert. Hinweis: „Aroundhome-Zahlen: Einträge unter deiner Sub-ID im Aroundhome-Formular, Stand spätestens vor 15 Minuten.“

## 9. Aggregationslogik

Pro Vertriebler (und Tag) im Zeitraum:
- `captured` = Anzahl vorerfasster Leads (rep_id, created_at im Zeitraum, Mandanten-Zeitzone)
- `ah`, `qualified`, `open`, `cancelled` = Summe aus `aroundhome_daily` über `sub_id` des Vertrieblers und Tag
- Agentur = Summe ihrer Vertriebler (+ Anzahl Vertriebler); Gesamt = Summe aller
- Tages-Serie: je Tag {day, captured, ah, qualified}

## 10. Offene Punkte
- Fragenkatalog des Formulars (Fragen/Antworten „wie bei Aroundhome“) – per Test-Vertriebler mit Sub-ID ermitteln.
- Aroundhome-Sync: Datenquelle/Endpoint und Status-Mapping (qualifiziert/offen/storniert).
- Maximale Anzahl Kontakte in der Admin-Tabelle.

---

## Anhang: UI-Texte (i18n, Deutsch)

### AdminD2D
```json
{
  "title": "Haustür-Erfassung",
  "description": "Vorerfasste Haustür-Kontakte je Vertriebler und Tag, abgeglichen mit den Aroundhome-Transaktionen unter seiner Sub-ID.",
  "not_enabled": "Für diesen Mandanten ist keine Haustür-Erfassung eingerichtet.",
  "settings_title": "Zuweisung",
  "settings_hint": "Vorerfasste Kontakte landen in dieser Sparte. Mit Käufer gehen sie sofort als verkauft an ihn (ohne Bestellung, ohne Abrechnung, ohne API-Versand). Ohne Käufer bleiben sie unverkauft auf „Genehmigt“ liegen. Keine Sparte = Vorerfassung aus (nur Iframe).",
  "settings_lead_type": "Sparte",
  "settings_buyer": "Käufer",
  "settings_off": "— keiner —",
  "save": "Speichern",
  "saving": "Speichert …",
  "saved": "Gespeichert.",
  "from": "Von",
  "to": "Bis",
  "apply": "Anwenden",
  "kpi_captured": "Vorerfasst",
  "kpi_ah": "Bei Aroundhome",
  "kpi_ah_hint": "{pct} der Vorerfassungen",
  "kpi_qualified": "Qualifiziert",
  "kpi_qualified_hint": "{pct} von Aroundhome",
  "kpi_open": "Offen",
  "kpi_cancelled": "Storniert",
  "kpi_cancelled_hint": "{pct} von Aroundhome",
  "match_note": "Aroundhome liefert keine Kontaktdaten zurück – der Abgleich läuft über Sub-ID und Tag, nicht je Kontakt.",
  "col_rep": "Vertriebler",
  "empty_range": "Nichts im Zeitraum.",
  "contacts_title": "Erfasste Kontakte",
  "contacts_capped": "neueste {shown} von {total}",
  "col_captured_at": "Erfasst",
  "col_contact": "Kontakt",
  "col_place": "Ort",
  "err_forbidden": "Keine Berechtigung.",
  "err_both": "Für einen Käufer bitte auch eine Sparte wählen.",
  "err_invalid": "Sparte oder Käufer gehört nicht zu diesem Mandanten.",
  "err_save": "Speichern fehlgeschlagen.",
  "filter_rep": "Vertriebler",
  "all_reps": "Alle Vertriebler",
  "setup_needed": "Keine Sparte gewählt – Vorerfassung ist aus. Hier festlegen.",
  "top3_title": "Top 3 im Zeitraum",
  "all_reps_title": "Alle Vertriebler",
  "show_all": "Alle anzeigen ({count})",
  "show_top3": "Nur Top 3",
  "rep_line": "{ah} bei Aroundhome · {qualified} qualifiziert",
  "chart_title": "Verlauf je Tag",
  "chart_title_rep": "Verlauf je Tag – {name}",
  "cancel": "Abbrechen",
  "export_csv": "CSV exportieren",
  "exporting": "Exportiert …",
  "err_export": "Export fehlgeschlagen.",
  "csv_captured_at": "Erfasst am",
  "csv_lead_nr": "Nr.",
  "csv_rep": "Vertriebler",
  "csv_sub_id": "Sub-ID",
  "csv_salutation": "Anrede",
  "csv_first_name": "Vorname",
  "csv_last_name": "Nachname",
  "csv_phone": "Telefon",
  "csv_email": "E-Mail",
  "csv_street": "Straße",
  "csv_zip": "PLZ",
  "csv_city": "Ort",
  "csv_note": "Notiz",
  "csv_agency": "Agentur",
  "filter_agency": "Agentur",
  "all_agencies": "Alle Agenturen",
  "top_agencies": "Top Agenturen im Zeitraum",
  "no_agency": "Ohne Agentur (direkt)",
  "agency_line": "{reps} Vertriebler · {ah} bei Aroundhome · {qualified} qualifiziert",
  "col_agency": "Agentur",
  "col_status": "Status",
  "col_sub_id": "Sub-ID",
  "reps_title": "Vertriebler",
  "reps_search": "Suchen …",
  "rep_add": "Vertriebler anlegen",
  "rep_add_hint": "Zugangsdaten gehen per E-Mail an den Vertriebler. Die Sub-ID von Aroundhome kannst du gleich oder später eintragen.",
  "reps_empty": "Noch keine Vertriebler angelegt.",
  "reps_hint": "Zahlen im gewählten Zeitraum. Gesperrte Vertriebler können sich nicht mehr anmelden, ihre Zahlen bleiben erhalten.",
  "reps_page_hint": "Zahlen der letzten 30 Tage. Sub-IDs vergibt Aroundhome – hier eintragen.",
  "rep_deactivate": "Sperren",
  "rep_activate": "Entsperren",
  "rep_deactivated": "Vertriebler gesperrt.",
  "rep_activated": "Vertriebler entsperrt.",
  "rep_created": "Vertriebler angelegt – Sub-ID {sub}.",
  "rep_created_no_sub": "Vertriebler angelegt – Sub-ID bitte nachtragen.",
  "contacts_no_match": "Keine Treffer.",
  "agency_add": "Agentur anlegen",
  "agency_add_hint": "Die Agentur bekommt einen eigenen Zugang: Übersicht, Kontakte und Vertriebler nur ihrer Agentur. Zugangsdaten gehen per E-Mail an den Agenturleiter.",
  "agency_name": "Name der Agentur",
  "agency_leader": "Agenturleiter (Login)",
  "agency_created": "Agentur angelegt.",
  "back_overview": "Gesamtübersicht",
  "agency_meta": "Agenturleiter: {leader}",
  "err_agency_name": "Bitte einen Namen angeben.",
  "err_agency_code": "Kein freies Kürzel gefunden – bitte selbst eins angeben.",
  "err_email": "Bitte eine gültige E-Mail-Adresse angeben.",
  "err_name": "Bitte Vor- und Nachnamen angeben.",
  "err_exists": "Zu dieser E-Mail-Adresse gibt es schon ein Konto.",
  "err_capacity": "Nutzer-Limit des Mandanten erreicht.",
  "warn_email": "Konto angelegt, aber die Willkommens-Mail konnte nicht verschickt werden.",
  "sub_id_missing": "Sub-ID fehlt",
  "sub_id_placeholder": "z. B. 2822",
  "sub_id_hint": "Die Sub-ID vergibt Aroundhome. Ohne Sub-ID sieht der Vertriebler statt der Erfassung nur einen Hinweis.",
  "sub_id_saved": "Sub-ID gespeichert.",
  "sub_id_edit_title": "Sub-ID für {name}",
  "err_sub_id_format": "Sub-ID: nur Buchstaben, Ziffern, - und _ (max. 64 Zeichen).",
  "err_sub_id_taken": "Diese Sub-ID ist schon einem anderen Vertriebler zugeordnet.",
  "embed_title": "iFrame Aroundhome",
  "embed_description": "Aroundhome-Einbindung für die Haustür-Erfassung. Sobald eingetragen, erscheint „Haustür-Erfassung“ in der Sidebar und bei den Vertrieblern.",
  "embed_placeholder": "https://aaa.aroundhome.de/trck/ehtml/… oder das komplette <script>-Snippet",
  "embed_hint": "Skript-URL oder Snippet aus der Aroundhome-Mail einfügen. Erlaubt sind nur https-Adressen von aroundhome.de.",
  "embed_saved": "iFrame gespeichert.",
  "embed_removed": "iFrame entfernt – Haustür-Erfassung ist aus.",
  "embed_remove": "Entfernen",
  "err_embed": "Bitte eine https-Adresse von aroundhome.de oder das Aroundhome-Snippet einfügen."
}
```

### BuyerD2D (Vertriebler-Oberfläche)
```json
{
  "title": "Haustür-Erfassung",
  "sub_id_label": "Sub-ID: {id}",
  "partner_title": "2. Bei Aroundhome erfassen",
  "form_title": "1. Kontakt bei uns erfassen",
  "form_hint": "Gleiche Fragen wie bei Aroundhome. Pflicht: Frage 1, Name, Telefon, E-Mail, PLZ. Danach den Kontakt bei Aroundhome eintragen.",
  "contact_title": "Kontakt",
  "salutation_herr": "Herr",
  "salutation_frau": "Frau",
  "first_name": "Vorname",
  "last_name": "Nachname",
  "phone": "Telefon",
  "email": "E-Mail",
  "street": "Straße",
  "house_number": "Hausnr.",
  "postal_code": "PLZ",
  "city": "Ort",
  "note": "Notiz",
  "save": "Kontakt speichern",
  "saving": "Speichert …",
  "saved_title": "{name} gespeichert.",
  "saved_title_nr": "{name} gespeichert (Nr. {nr}).",
  "saved_hint": "Jetzt bei Aroundhome erfassen – Werte per Klick kopieren.",
  "new_contact": "Neuen Kontakt erfassen",
  "err_not_authed": "Nicht angemeldet.",
  "err_not_enabled": "Vorerfassung ist für dein Konto nicht eingerichtet.",
  "err_name": "Bitte Vor- und Nachnamen angeben.",
  "err_phone": "Bitte eine gültige Telefonnummer angeben.",
  "err_email": "Bitte eine gültige E-Mail-Adresse angeben.",
  "err_zip": "Bitte eine fünfstellige PLZ angeben.",
  "err_q1": "Bitte Frage 1 beantworten (Installationsort).",
  "err_save": "Speichern fehlgeschlagen. Bitte erneut versuchen.",
  "contacts_title": "Meine Kontakte",
  "contacts_count": "{count} Kontakte",
  "contacts_search": "Name, Ort, Telefon suchen …",
  "contacts_empty": "Noch keine Kontakte erfasst.",
  "contacts_no_match": "Keine Treffer.",
  "contacts_back": "Meine Kontakte",
  "captured_at": "Erfasst am {date}",
  "lead_nr": "Nr. {nr}",
  "salutation": "Anrede",
  "answers_title": "Antworten (wie bei Aroundhome)",
  "partner_title_short": "Bei Aroundhome erfassen",
  "copy_label": "{label} kopieren",
  "range_all": "Gesamt",
  "range_today": "Heute",
  "range_yesterday": "Gestern",
  "range_7d": "Letzte 7 Tage",
  "range_30d": "Letzte 30 Tage",
  "contacts_in_range": "{count} Treffer",
  "edit": "Bearbeiten",
  "edit_title": "Kontakt korrigieren",
  "edit_hint": "Änderungen gelten nur bei uns – was bei Aroundhome erfasst wurde, bleibt unverändert.",
  "edit_save": "Änderungen speichern",
  "edit_cancel": "Abbrechen",
  "edit_saved": "Kontakt korrigiert.",
  "err_not_found": "Kontakt nicht gefunden.",
  "draft_restored": "Nicht gespeicherte Eingabe wiederhergestellt.",
  "draft_discard": "Verwerfen",
  "agency_contacts_title": "Kontakte der Agentur",
  "captured_by": "erfasst von {name} ({sub})",
  "sub_id_pending": "Deine Sub-ID von Aroundhome ist noch nicht eingetragen. Sobald deine Agentur sie hinterlegt hat, kannst du hier Kontakte erfassen.",
  "kpi_captured": "Vorerfasst",
  "kpi_ah": "Bei Aroundhome",
  "kpi_qualified": "Qualifiziert",
  "kpi_open": "Offen",
  "kpi_cancelled": "Storniert",
  "kpi_note": "Aroundhome-Zahlen: Einträge unter deiner Sub-ID im Aroundhome-Formular, Stand spätestens vor 15 Minuten.",
  "date_from": "Von",
  "date_to": "Bis",
  "date_reset": "Zurücksetzen",
  "date_all": "Gesamter Zeitraum"
}
```
