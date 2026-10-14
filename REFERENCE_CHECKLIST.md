# Referenzcheckliste: Leadfy ↔ Fluxora

**Zweck:** Diese Checkliste trennt die dokumentierte Referenzfunktion von der sichtbaren Fluxora-Oberfläche, der zugrunde liegenden persistierenden Geschäftslogik und offenen Ergänzungen. Sie enthält weder Daten noch Markenbestandteile der Referenzanwendung.

## Globale Abläufe

| Bereich | Referenzfunktion | Fluxora-Status | Prüfmethode / nächster Schritt |
|---|---|---:|---|
| Navigation | Alle 18 Hauptbereiche über Seitennavigation erreichbar | Erfasst | Alle Einträge sind in `FluxoraWorkspace` verbunden; bei Abschluss visuell je Eintrag prüfen |
| Suche | Globale Suche nach Benutzern, Bestellungen und Leads | Implementiert | Die Suchleiste fragt den aktiven Mandanten geschützt ab, gruppiert Leads, Bestellungen und Mitglieder und navigiert direkt in den jeweiligen Arbeitsbereich. |
| Mandantenkontext | Datenzugriff ausschließlich im aktiven Mandanten | Implementiert | Geschützte tRPC-Prozeduren verwenden den Mandantenkontext |
| Sprache | Deutsche Bedienoberfläche in formeller Ansprache | Implementiert | Neue Texte bei jedem UI-Abgleich prüfen |
| Design | Eigenständige B2B-Oberfläche statt visueller Kopie | Implementiert | Dunkles Fluxora Operations Cockpit als bewusst unabhängige Gestaltung |

## Dashboard und Statistik

| Seite / Dialog | Referenzfunktion | Fluxora-Status | Verbleibender Abgleich |
|---|---|---:|---|
| Dashboard | Zeitraum- und Kategorieauswahl, KPI-Karten, neueste Leads | Implementiert | Zeitraum- und Kategorienfilter mit leeren Mandanten weiter durchspielen |
| Dashboard | Stundenverlauf ausgelieferter Leads | Teilweise | Live-Aggregation der Stundenwerte ergänzen |
| Statistik: Käufer | Mengen, Annahme-/Stornoquote, Umsatz und Gesamtsumme | Teilweise | Tabellenzeilen vollständig aus Liefereignissen aggregieren |
| Statistik: Lieferketten | Angebots-, Annahme-, Ablehnungs- und Umsatzwerte je Kette und Stop | Teilweise | Ketten- und Stopkennzahlen aus Live-Auslieferungen berechnen |
| Statistik: Lieferanten | Geliefert, verkauft, reklamiert, Quoten und PrePing | Teilweise | Testlead- und PrePing-Differenzierung vervollständigen |
| Statistik: Integrationen | Zustellung, Partnerbewertung, Synchronisationszustand | Teilweise | Persistente Ereignisse je Partnerintegration speisen geliefert, abgelehnt, angenommen, offen, anerkannt, storniert und Gesamtquote in Tabelle und KPI-Karten | Navigation zur Perspektive visuell prüfen; Detailkarten und Synchronisationswarnungen ergänzen |
| Statistikfilter | Sparte, Käufer, Lieferant, Schnellzeitraum und individueller Zeitraum | Implementiert | Sparte, Käufer, Heute, 7/30 Tage und benutzerdefinierter Zeitraum speisen die geschützte Live-Abfrage; ein Startdatum nach dem Enddatum wird sichtbar abgewiesen |

## Lead-Operations

| Seite / Dialog | Referenzfunktion | Fluxora-Status | Verbleibender Abgleich |
|---|---|---:|---|
| Leads | Volltextsuche, Statusregister und tabellarische Leadliste | Implementiert | Erweiterte Filterkombinationen und Massenauswahl optional ergänzen |
| Leads | Import, Statuswechsel und CSV-Export | Implementiert | Import-Validierung gegen Kategorien- und Geo-Regeln ausbauen |
| Lead Quick-View | Tags, Zuweisung, Reklamation und Auslieferungsverlauf | Implementiert | Vollständige Ereignishistorie mit Rohdaten-Ansicht ergänzen |
| Lead-Kategorien | Shortcode, Preis, Multisale, Geo, Marktplatz, Pipeline und Angebotstext | Implementiert | Detailvalidierung und Massenauswahl optional ergänzen |
| Lead-Kategorien | Aktivieren, deaktivieren und bearbeiten | Implementiert | Im visuellen Abgleich aller Fehlerzustände prüfen |

## Routing und Automatisierung

| Seite / Dialog | Referenzfunktion | Fluxora-Status | Verbleibender Abgleich |
|---|---|---:|---|
| Lieferketten | Ketten erstellen, Aktivstatus, Priorität, Verkaufsziel und Round-Robin | Implementiert | Live-Kennzahlen aus Auslieferungsereignissen mit Lade-, Fehler- und Leerzustand angebunden; erfolgreiche Ereignisansicht im authentifizierten Mandanten prüfen |
| Lieferketten: Stop-Editor | Käufer, Position, Preis und Aktivstatus je Stop | Implementiert | Positionskonflikte und Umsortierung als Komfortfunktion ergänzen |
| Lieferketten: Ausführung | Ketten-/Bestell-Round-Robin und persistente Cursor | Implementiert | Abdeckung per Integrationsablauf und Kennzahl prüfen |
| Automatisierung: Regel-Editor | Trigger, Quelle, Ziel, Lieferantenfilter und Bedingungsmodus | Implementiert | Direktnavigation und Berechtigungs-/Fehlerzustand geprüft; befüllten Editor im authentifizierten Mandanten mit Kategorien und Lieferanten prüfen |
| Automatisierung: Bedingungen | Feld, Operator und Vergleichswert | Implementiert | Der Regeleditor unterstützt beliebig viele Bedingungen, den Modus „alle“ oder „mindestens eine“ sowie die mandantensichere Regel-Löschung. |
| Automatisierung: Ausführung | Qualifiziertes Duplikat in Zielkategorie übernehmen | Implementiert | Persistentes Ausführungsprotokoll mit Ergebnis, Ursache sowie Quell- und Duplikat-Lead-Referenz ist verfügbar; den erfolgreichen End-to-End-Fall zusätzlich nachweisen |

## Vertrieb, Marktplatz und Kooperationen

| Seite / Dialog | Referenzfunktion | Fluxora-Status | Verbleibender Abgleich |
|---|---|---:|---|
| Marktplatz | Aktive Angebote, Preise, Entfernen und Checkout | Implementiert | Angebotsdetail mit Leadkontext und Transaktionsbezug sichtbar |
| Marktplatz | Preisrevision und Historie | Implementiert | Preisverlauf wird im Angebotsdetail dargestellt |
| Marktplatz | Wiedervermarktung nach genehmigter Reklamation | Implementiert | Wirkung über Angebotsstatus und Wiedervermarktungslogik sichtbar |
| Käufe | Persistente Kaufhistorie nach Stripe-Webhook | Implementiert | Eigenständiges Kaufdetail zeigt Käufer, Betrag, Zeitpunkt, Angebot und Stripe-Transaktionskennungen |
| Kooperationen | Partnerstatus und Richtung | Implementiert | Detail-Editor für Partnername, Richtung und optionale Partner-Mandanten-ID angebunden |
| Kooperationen: Mapping | Kategorie- und Feldmappings | Implementiert | Sichtbarer Mapping-Editor schreibt Kategorie- und Feldzuordnungen mandantenbezogen |

## Service, Personen und Kommunikation

| Seite / Dialog | Referenzfunktion | Fluxora-Status | Verbleibender Abgleich |
|---|---|---:|---|
| Bestellungen | Liste, Statusfortschritt, Mengen und Lieferfortschritt | Implementiert | Bestelldetail zeigt Käufer, Kategorie, Menge, Lieferfortschritt, Preis und Status; die leadgenaue Auslieferungshistorie bleibt im Lead-Quick-View verankert |
| Reklamationen | Liste mit Grund, Status und Datum | Implementiert | Volltextsuche, Statusfilter und CSV-Export sind für reale Mandantenfälle ergänzt; die leere Liste erklärt den gewählten Filterzustand. |
| Reklamationsdetail | Grund, Falldetails, Erstattung, Zeitverlauf und Entscheidung | Implementiert | Persistente Chronik für Erfassung, Frist und Entscheidung ist verfügbar; Partnerantworten und den befüllten Ereignisfall weiter prüfen |
| Support | Ticketliste, Priorität und Statussteuerung | Implementiert | Volltextsuche nach Ticketnummer, Betreff und anfragender Person sowie ein mandantenbezogener Bearbeitungsdialog für Betreff, Person, Priorität und Status sind angebunden. |
| E-Mails | Vorlagen und Zustellereignisse | Teilweise | Vorlagen, statusgefilterter Zustellverlauf, mandantenbezogene Ereignisprotokollierung und CSV-Export sind sichtbar; ein externer Versandadapter bleibt offen. |
| Teams | Liste und Teamverwaltung | Implementiert | Teamstammdaten sowie mandantenbezogene Mitglieds- und Produktzuordnungen sind im Teamarbeitsbereich sichtbar und bearbeitbar. |
| Benutzer | Mitglieder, Rollen, Status und Einladungen | Implementiert | Einladungsformular, Einladungsübersicht mit Ablaufdatum und Widerruf sowie sichtbarer Mitgliedereditor für Rolle, Team und Status sind mandantenbezogen angebunden |
| Tags | Mandantenbezogene Tags und Leadzuweisung | Implementiert | Auswählbare Bearbeitung von Name und Farbe sowie Leadzuweisung sind mandantenbezogen angebunden |
| Produkte | Produktkatalog | Teilweise | Auswählbare Detailansicht mit Preis, Status und Anlagezeitpunkt vorhanden; Mengen- und Geo-Konfiguration ergänzen |
| Rechnungen | Listen- und API-Abruf | Implementiert | Persistente Liste, Entwurfserstellung, Statuswechsel, Detailansicht und eine druckbare Vorschau mit Steueraufteilung sowie Fälligkeit sind vorhanden. |

## Einstellungen und Schnittstellen

| Seite / Dialog | Referenzfunktion | Fluxora-Status | Verbleibender Abgleich |
|---|---|---:|---|
| System | FIFO/LIFO, PrePing, leere API-Felder und Dublettenschutz | Implementiert | Zusatzfelder, Ausnahmen und Deaktivierungsfenster ergänzen |
| Reklamationsgründe | Bezeichnung, Reihenfolge, Lieferantenweitergabe und Aktivstatus | Implementiert | Erstellung und Bearbeitung erfolgen mandantenbezogen im Einstellungsbereich |
| Branding | Wortmarke, Primärfarbe, Support-Adresse und Absendername | Implementiert | Logo, Sekundärfarbe, Favicon und E-Mail-Footer ergänzen |
| Shop | Shop- und Guthabenfreigabe | Implementiert | Käufer-Shop, Guthaben und automatische oder manuelle Bestellfreigabe werden mandantenbezogen im Einstellungsbereich gespeichert. |
| Marktplatz | Sichtbarkeit und Wiedervermarktungsregel | Implementiert | Live-Kennzahlen zum angebotenen Bestand ergänzen |
| Nutzungsbedingungen | Versionsgeführte Annahme | Implementiert | Version, Zeitpunkt und annehmende Person werden mandantenbezogen protokolliert; die Annahme ist im Compliance-Bereich sichtbar. |
| API | Token-Erzeugung sowie Lead-, Reklamations- und Rechnungsendpunkte | Teilweise | Sichtbare Tokenübersicht und Widerruf sind umgesetzt; Kopieren und Rotation ergänzen |
| Integrationen | Partnerkonfiguration und Callbacks | Teilweise | Sichtbare Anlage, Rückrufadresse und Statussteuerung sind umgesetzt; Geheimnisverwaltung und Antwortsynchronisation ergänzen |
| Zahlung | Stripe-Checkout und Webhook-Persistenz | Teilweise | Tenant-spezifische Stripe-Konfiguration erst nach sicherer Geheimnisverwaltung anbinden |
| Rechnung & Rechtliches | Absender, Steuer, Präfix und Richtlinien | Teilweise | Vollständiges Formblatt, Vorschau und Rechtsdokumente ergänzen |
| Domain, E-Mail, Passwort, Ansicht, Abonnement, Affiliate | Konfigurationsbereiche | Erfasst | Je Bereich einen echten persistierenden Dialog statt Standardhinweis implementieren |

## Abnahmeroutine

1. Jede Tabellen- und Dialogoberfläche mit einem angemeldeten Mandanten öffnen.
2. Pro Schreibaktion Erfolg, Validierungsfehler und anschließenden Refresh prüfen.
3. Bei Auslieferung, Automatisierung, Reklamation und Kauf die persistierten Folgeeffekte in der nächsten Ansicht kontrollieren.
4. Für jeden abgeschlossenen Bereich die Referenzmatrix aktualisieren und den zugehörigen TODO-Punkt als erledigt markieren.
5. Vor einer Bereitstellung Typprüfung, Unit-Tests und visuelle Screenshots der Kernseiten ausführen.

## Sichtprüfung: Statistik – Integrationen

| Prüfaspekt | Ergebnis |
|---|---|
| Aufruf | `/?page=Statistik&view=Integrationen` am 17.08.2026 |
| Navigation | Der Tab **Integrationen** ist als aktive Perspektive sichtbar; die direkte Navigation öffnet den vorgesehenen Bereich. |
| KPI-Karten | **Geliefert**, **Angenommen**, **Abgelehnt / storniert** und **Gesamtquote** werden als eigene Integrationskennzahlen dargestellt. |
| Tabellenkopf | Die sichtbaren Spalten lauten **Integration**, **Geliefert**, **Abgelehnt**, **Angenommen**, **Offen**, **Anerkannt**, **Storniert** und **Gesamtquote**. |
| Leerer Zustand | Ohne gespeicherte Partnerintegrationen oder Ereignisse werden alle Kennzahlen mit `0` und ein erklärender Leerzustand angezeigt; es werden keine Demo-Werte eingeblendet. |
| Layout | KPI-Karten, Filterleiste und Tabellenüberschriften sind auf Desktop lesbar ausgerichtet; die Tabellenzellen verwenden feste Mindestbreite und Abstände. |

## Sichtprüfung: Statistikfilter

| Prüfaspekt | Ergebnis |
|---|---|
| Aufruf | `/?page=Statistik&view=Käufer` am 17.08.2026 |
| Sparte und Käufer | Beide Auswahlfelder sind in der Käuferperspektive sichtbar und werden in die mandantenbezogene Detailabfrage übernommen. |
| Zeitraum | Die Auswahl **Heute**, **Letzte 7 Tage**, **Letzte 30 Tage** und **Benutzerdefiniert** ist sichtbar. |
| Benutzerdefiniert | Zwei Datumseingaben erscheinen nur bei benutzerdefiniertem Zeitraum; Abfragen werden bei einer ungültigen Reihenfolge unterdrückt und eine Fehlermeldung erklärt die Korrektur. |
| Leerzustand | Ohne Ereignisse bleibt die Tabellenstruktur sichtbar und erklärt den leeren gefilterten Zeitraum ohne Demo-Werte. |

## Laufzeitnachweis: Mandanten-Erstanlage

| Prüfaspekt | Ergebnis |
|---|---|
| Ausgangslage | Der angemeldete Administrator hatte zunächst keine aktive Mitgliedschaft; geschützte Live-Abfragen lieferten deshalb einen Mandantenfehler. |
| Schutzmechanismus | Die Serverlogik legt ausschließlich für Administratoren ohne bestehende Mitgliedschaft einen eigenen Mandanten sowie eine aktive Inhaber-Mitgliedschaft an. Nicht-administrative Benutzer erhalten keine automatische Mitgliedschaft. |
| Nachweis | Nach dem Serverneustart antwortete die gebündelte Abfrage `leadops.dashboard`, `leadops.listCategories` und `leadops.statistics` am 17.08.2026 mit HTTP `200`. |
| Ergebnis | Dashboard, Kategorien und Statistik erhielten einen echten leeren Mandantenkontext mit `0`-Kennzahlen statt eines Mandantenfehlers. |

## Vollständiger Routen- und Dialogabgleich

| Route / Arbeitsbereich | Kernabläufe und Dialoge | Stand | Nachweis / verbleibender Punkt |
|---|---|---:|---|
| Dashboard | Zeitraum, Kategorie, Kennzahlen, Stundenverlauf, neueste Leads | Implementiert | Geschützte Dashboard-Tests und sichtbarer Mandantenleerzustand. |
| Statistik | Käufer, Lieferketten, Lieferanten, Integrationen, Zeit- und Sachfilter | Implementiert | Live-Aggregation und sechs Statistiktests; ereignisarme Mandanten zeigen einen klaren Leerzustand. |
| Leads | Suche, Status, Import, Quick-View, Tags, Zuweisung, CSV | Implementiert | Geschützte Leadverfahren und UI-Detailabläufe vorhanden. |
| Lead-Kategorien | CRUD, Priorität, PV-Vorlage, Feldbibliothek, Harmonisierung, Exportwerkzeuge | Implementiert | Geschützter PV-Integrationsvertrag und gerenderter LiveCategories-Test; persönlicher Login-Laufzeitnachweis bleibt separat offen. |
| Marktplatz | Angebote, Preisverlauf, Kaufhistorie, Checkout, Wiedervermarktung | Implementiert | Persistente Angebots-, Kauf- und Stripe-Webhookschnittstellen vorhanden. |
| Lieferketten | Ketten, Stops, Kennzahlen, Round-Robin-Auslieferung | Implementiert | Routertest für Stopauswahl, Cursorfortschritt und Lieferereignis. |
| Automatisierung | Regeln, Mehrfachbedingungen, Lieferantenfilter, Ausführungsprotokoll | Implementiert | Sichtprüfung und Routertests für Duplikat-Referenz sowie Regel-Löschung. |
| Kooperationen | Partnerstammdaten, Richtung, Kategorie- und Feldmapping | Implementiert | Mandantenbezogener Editor und Persistenzverfahren vorhanden. |
| Bestellungen | Liste, Statusfortschritt, Detail, Lieferfortschritt | Implementiert | Detail-Deep-Link und Live-Service-Desk-Vertrag. |
| Reklamationen | Filter, CSV, Entscheidung, Frist, Chronik | Teilweise | Persistente Events und Detailchronik bestehen; echter mehrstufiger Ereignisfall ohne Testdaten bleibt offen. |
| Support | Suche, Filter, Ticketanlage und -bearbeitung | Implementiert | Geschützte Router- und UI-Prüfungen. |
| E-Mails | Vorlagen, Ereignislog, Statusfilter, CSV | Teilweise | Versandadapter benötigt eine freigegebene externe Versandkonfiguration. |
| Teams | Stammdaten, Mitglieder, Produktzuordnungen | Implementiert | Gerenderter Mandantenintegrationstest deckt Hinzufügen, Entfernen und Teamwechsel ab. |
| Benutzer und Einladungen | Rolle, Status, Team, Einladung, Widerruf | Implementiert | Persistente Bearbeitung und Einladungsabläufe vorhanden. |
| Tags | Stammdaten und Leadzuweisung | Implementiert | Tags werden im Personenbereich sowie Lead-Quick-View verarbeitet. |
| Produkte | Katalog, Detail, Mengen- und Georegeln | Implementiert | Geschützter Produktkonfigurationsvertrag; reale Produktdaten können unmittelbar im Katalog gepflegt werden. |
| Rechnungen | Entwürfe, Status, Detail, Vorschau, Druck | Implementiert | Reale Detailansicht und Steuerberechnung geprüft. |
| Einstellungen | Branding, System, Gründe, Rechtliches, Bedingungen, Tokens, Integrationen | Teilweise | Stripe, Geheimnisverwaltung sowie Domain-/Abonnementdialoge benötigen getrennte Dienst- oder Plattformkonfiguration. |

> **Transparente externe Abhängigkeiten:** Die noch nicht als vollständig markierten Bereiche betreffen entweder reale Ereignisdaten, die nicht künstlich angelegt werden dürfen, oder ausdrücklich gesicherte Drittanbieterzugänge für Versand, Stripe-Geheimnisse und Plattformkonfiguration.
