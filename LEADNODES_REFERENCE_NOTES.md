# Leadnodes-Referenzbefunde

## Benutzerübersicht, passiv geprüft am 20.08.2026

Die Referenz führt eine tabellarische Benutzerübersicht mit Aktiv-/Inaktiv-Registern, Volltextsuche, Rollenfilter, Gruppenfilter, Sortierung und Seitengröße. Je Benutzer werden ID, Name mit Organisation, Kontostand, Prepaid, Status und Registrierungsdatum gezeigt. Die sichtbaren Zeilen führen mehrere kontextbezogene Werkzeuge, unter anderem Benutzerkonfiguration, zugeordnete Integrationen und Verifikationsaktionen. Export- und integrationsspezifische Funktionen werden gemäß Nutzeranweisung nicht in den Benutzerbereich von Tanesco Leads übernommen.

Die weitere Erfassung erfolgt rein lesend. Es werden keine Änderungen in der Referenzanwendung vorgenommen.

## Integrationen eines Referenzbenutzers, passiv geprüft am 20.08.2026

Die Benutzerliste verlinkt pro Zeile in eine eigene Integrationsansicht. In der Seitennavigation des Benutzerbereichs sind unter anderem Benutzerprofil, Benachrichtigungen, Zahlungen, Kontoeinstellungen, Lieferpausen, Erstattungseinstellungen, Guthabenkonto, UI-Restriktionen, individuelle Lead-Provisionen, deaktivierte Lead-Typen, API-Tokens und Integrationen getrennt erreichbar.

Für einen Aroundhome-Referenzbenutzer zeigt die Integrationsansicht kartenartige Anbieterblöcke mit Logo, Name, Aktivstatus, Kurzbeschreibung und einer Einstellungsaktion. Sichtbar sind mindestens **Aroundhome (API v2)** mit aktivem Status sowie **Aroundhome Complaints**. Die Referenz führt darüber hinaus zahlreiche generische Zielintegrationen, unter anderem CRM-, Auto-Responder-, Webhook- und Exportmuster. Die spätere Umsetzung in Tanesco Leads wird auf die explizit gewünschten Aroundhome-, Wattfox- und GoHighLevel-Standardvorlagen begrenzt.

Die geöffnete generische Zielintegration verwendet einen einfachen Webhook-/REST-API-Ablauf mit Endpunkt, Quell-ID, Status-ID, Aktivierungsschalter und frei verwaltbarem Lead-Datenmapping. Das bestätigt die geplante Tanesco-Leads-Struktur aus inaktivem Entwurf, separat gespeichertem Zugangsschlüssel, Aktivierung und Feldzuordnung.

Ein GoHighLevel-Referenzbenutzer zeigt eine eigene, aktive **GoHighLevel**-Karte mit Anbieterlogo, Name, Aktivstatus, Kurzbeschreibung und Einstellungsaktion. Die konkrete Zielkonfiguration wird ausschließlich aus öffentlicher API-Dokumentation und nachgelagerten Benutzerangaben befüllt; geheime Zugangsdaten werden nicht aus der Referenz gelesen oder übernommen.

## Lead-Aktionen und Länderfilter, Screenshots geprüft am 20.08.2026

Die bereitgestellte Leadliste zeigt eine zusätzliche Länderauswahl sowie pro Lead eine kleine Flagge direkt neben der Lead-ID. Die konkrete sichtbare Aktion öffnet ein Kontextmenü mit **Lead duplizieren** und **Lead deaktivieren**. Zusätzlich führt die Kopfaktion einen **Testlead**. Die spätere Tanesco-Leads-Umsetzung ergänzt diese drei Abläufe; bestehende Exportfunktionen bleiben außerhalb dieses Nachbauschritts.

Ein dritter Screenshot zeigt die Benutzerwerkzeuge als getrennte Navigation: Profil, Benachrichtigungen, Zahlungs- und Kontoeinstellungen, Lieferpausen, Erstattungseinstellungen, Guthabenkonto, UI-Restriktionen, individuelle Lead-Provisionen und deaktivierte Lead-Typen. Integrationen, API-Tokens und Exporte sind separat geführt und werden nicht in den Tanesco-Leads-Benutzerbereich dupliziert.

Die live geprüfte Leadliste bestätigt Statusregister, Feld- und Spartensuche, zusätzliche Filter, Sortierung und Seitengröße. Das geöffnete Referenz-Aktionsmenü zeigt Lead Details, Bearbeiten, Duplizieren, Wiedervorlage, Rückerstattung, Zuweisung aufheben und Löschen. Für die angeforderte Umsetzung werden Duplizieren, Deaktivieren und Testlead als neue fokussierte Abläufe ergänzt; die weiteren Operationen werden gegen bestehende Tanesco-Leads-Logik abgeglichen.

## Reklamationen und Reporting, passiv geprüft am 20.08.2026

Die Referenz-Reklamationsliste bietet Filter nach Reklamations-ID, Grund, Benutzer/Käufer, Leadsparte, Bearbeitungsstatus sowie Callcenter-Status. Sichtbar sind die Sammelaktion zur Übergabe an ein Callcenter, Auswahlkästchen je Reklamation und eine konfigurierbare Seitengröße. Die spätere Tanesco-Leads-Variante ergänzt entsprechende sichere Auswahlaktionen und eine kombinierbare Filterlogik, ohne künstliche Reklamationsdaten anzulegen.

Die Reportingnavigation führt getrennte Auswertungen für Profit, SEO, Zuweisungen, Lieferungen, Leadzuteilung, Feedback, Bestellungen und Lead Tracking. Für die gewünschte Tanesco-Leads-Statistik sind insbesondere Bestell-, Liefer- und Zuteilungsdaten relevant; der Überblick wird deshalb Käufer, Lieferant, Bestellung und optionalen Lieferkettenbezug gemeinsam darstellen.

Der passive Referenz-Bestellreport fasst je Leadsparte Anzahl der Bestellungen, Gesamtleads, gelieferte und noch lieferbare Leads sowie regionale Liefergebiete zusammen. Die sichtbaren Gebietstypen umfassen bundesweit, Bundesland, einzelne PLZ, PLZ mit Radius und PLZ-Abschnitte. Für Tanesco Leads wird die bestehende Bestell- und Lieferkettenlogik um eine klare Kennzeichnung „mit Lieferkette / ohne Lieferkette“ sowie Käufer- und Lieferantenzuordnung ergänzt.

Der vermutete Pfad `/system/automations` ist in der Referenz nicht verfügbar. Deshalb werden die gewünschten Änderungen der Tanesco-Leads-Automatisierung anhand der bestehenden internen Regelstruktur und der expliziten Nutzeranforderungen umgesetzt, nicht auf Basis eines erfundenen Referenzablaufs.

## Öffentliche Integrationsangaben, geprüft am 20.08.2026

Die offizielle HighLevel-v3-Dokumentation bestätigt für die Anlage eines Kontakts den Endpunkt `POST https://services.leadconnectorhq.com/contacts/`, Bearer-Authentifizierung über einen Sub-Account-Token, den erforderlichen Header `Version: v3`, den erforderlichen Wert `locationId` sowie die Kernfelder `firstName`, `lastName`, `email`, `phone`, `address1`, `city`, `state`, `postalCode`, `country`, `tags` und `customFields`. Die GoHighLevel-Standardvorlage kann diese bestätigten Werte daher vorausfüllen; Location-ID und Token bleiben zwingende, separat abgefragte Zugangswerte.

Die öffentliche Leadnodes-Wattfox-Seite beschreibt einen automatischen Austausch eingehender und ausgehender PV-Leads mit Feldmapping. Sie nennt keinen frei nutzbaren Zielendpunkt oder öffentlichen Authentifizierungsvertrag. Die Wattfox-Standardvorlage wird daher Prozesse, Kategorie PV und Feldmapping vorschlagen, Endpunkt und Zugang jedoch bewusst als vom Partner einzuholende Pflichtangaben markieren. Für Aroundhome gilt derselbe vorsichtige Ansatz, da keine verifizierbare öffentliche Partner-API-Spezifikation vorliegt.
