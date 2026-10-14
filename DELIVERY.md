# Fluxora Lead Operations

## Umsetzungsstand

Fluxora ist als **deutschsprachige, mandantenfähige Lead-Operations-Anwendung** aufgebaut. Das Projekt enthält eine eigenständige, responsive B2B-Oberfläche, eine relationale Datenbasis für die zentralen Geschäftseinheiten sowie geschützte serverseitige Schnittstellen für Mandantenkontext, Leads, Kategorien und Suche.

Die öffentliche Startansicht dient als visuelle Produktvorschau. Der produktive Workspace ist unter `/app/dashboard` über den vorhandenen Anmeldefluss geschützt. Die Demoansicht verwendet ausdrücklich synthetische Daten; es wurden keine personenbezogenen Quelldaten übernommen.

| Bereich | Umgesetzt |
|---|---|
| Mandantenmodell | Tenant, Membership, Teams, Rollen und Einladungen mit Token und Ablaufzeit |
| Lead Operations | Leads, Kategorien, Tags, Lieferanten, Status, CSV-Hilfsfunktion und Quick-View-UI |
| Routing | Lieferketten, Stops, Prioritäten, Verkaufsziele und Round-Robin-Steuerung |
| Automatisierung | Trigger, Bedingungen, Lieferantenfilter und Zielkategorie im Datenmodell sowie UI-Steuerung |
| Marktplatz | Freigabe, Angebote, Käufe, Preisrevisionen und Wiedervermarktungsregel |
| Service | Bestellungen, Reklamationen, Support, Teams, Benutzer und Einstellungen als Verwaltungsansichten |
| Zahlung | Stripe Checkout-Grundlage, Webhook-Prüfung und minimale Stripe-IDs im Datenmodell |

## Qualitätsnachweise

Die TypeScript-Prüfung wurde erfolgreich ausgeführt. Die Testsuite umfasst die bestehende Logout-Prüfung sowie Tests für KPI-Aggregation und den CSV-Export. Die Desktopansicht, die mobile Ansicht und der Zugang unter `/app/dashboard` wurden visuell geprüft. Nach einem Neustart des Entwicklungsservers lief die Anwendung ohne aktuellen Build- oder Typfehler.

## Stripe-Hinweis

Die Checkout- und Webhook-Grundlage ist implementiert. Für echte Testzahlungen muss die bereitgestellte Stripe-Testumgebung noch beansprucht und anschließend ein Test-Checkout mit einer autorisierten Testkarte durchgeführt werden. Der Webhook ist auf `/api/stripe/webhook` angelegt und prüft die Stripe-Signatur vor der Verarbeitung.

## Nächste Produktivschritte

Vor dem Livebetrieb sollten Sie je Mandant einen Stripe-Kunden anlegen, reale Nutzer zu Mandanten zuordnen und die UI-Demodaten durch tRPC-Abfragen aus der Datenbank ersetzen. Der Datenbankentwurf und die serverseitigen Verfahren sind dafür vorbereitet.
