# Lead-Verwaltung – Referenzbezogener QA-Nachweis

## Prüfziel

Die Fluxora-Lead-Verwaltung wurde gegen die bereitgestellten Referenzansichten funktional abgeglichen. Die Oberfläche verwendet bewusst ein eigenständiges, dunkles Operations-Cockpit-Design; geprüft wurden daher die Fachabläufe und die Informationsarchitektur, nicht eine visuelle Kopie.

| Referenzpunkt | Fluxora-Nachweis | Ergebnis |
|---|---|---|
| Lead-Liste mit Suche, Statusregistern und Aktionen | `LiveLeads.tsx`, UI-Gesamttest | Erfüllt |
| Zentraler Quick View mit verdecktem Hintergrund | `LeadQuickViewOverlay.tsx`, Dialog- und Backdrop-Struktur | Erfüllt |
| Lead Log mit Status-, Liefer-, Reklamations-, Automatisierungs- und Integrationsereignissen | `buildLeadAuditLog`, Audit-Zusammenführungstest und UI-Gesamttest | Erfüllt |
| Manuelle Anlage mit Kategorieauswahl | Manuelles Anlegeformular in `LiveLeads.tsx`, UI-Gesamttest | Erfüllt |
| CSV-Import mit Feldübernahme, Headerprüfung und Zeilenreport | `leadCsvImport.ts`, Parser-Test und UI-Importzugang | Erfüllt |
| Persistente Statushistorie | `leadStatusEvents`, Router-Regressionstest | Erfüllt |
| API-Rückmeldungen inklusive Referenz und HTTP-Ergebnis | Partnerexport mit `integrationEvents`, Router-Persistenztest | Erfüllt |

## Prüfzustände

Der aktuelle Durchlauf deckt eine vorhandene PV-Kategorie, einen Lead mit Fachfeldwerten, ein Quick-View-Auditereignis, die manuelle Anlage und die Importoberfläche ab. Der UI-nahe Gesamttest `server/live-leads.workflow.integration.test.ts` prüft diese Zustände zusammen. Parser- und Routertests sichern die nicht-visuellen Fehler-, Persistenz- und Exportpfade ab.

## Bekannte bewusst gesetzte Abweichungen

Die Oberfläche bildet keine visuelle Kopie der Referenz nach. Stattdessen verwendet sie das Fluxora-Designsystem mit zentralem Overlay, klarer Ereignischronik und sichtbaren Fachfeldinformationen. Stripe- und Gmail-Produktivzugänge bleiben entsprechend der Projektentscheidung deaktiviert.
