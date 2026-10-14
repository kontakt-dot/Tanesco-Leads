# PV-Lead-Kategorie – Referenznotizen

## Grundeinstellungen

Die PV-Kategorie führt eine eindeutige Kategoriekennung, einen sichtbaren Namen und einen Shortcode. Für die replizierbare Fluxora-Vorlage werden außerdem Käuferpreis, Lieferantenprovision mit Fest-/Prozentmodus, Beschreibung, Priorität, Marktplatzfreigabe, Feedbackanforderung und Shortcode-Aliasse benötigt.

## Benutzerdefinierte Felder

Die Referenz verwaltet eine geordnete Feldliste mit sichtbarer Bezeichnung und technischem Parametername. Die PV-Vorlage enthält unter anderem Stromverbrauch, monatliche Stromkosten, Wärmepumpe, Wallbox, Dachart, Hausart, Dachfläche, Dachalter, Finanzierung, Installationszeitraum, Erreichbarkeit, Qualinotizen, Recording und Lieferant. Jedes Feld besitzt Sichtbarkeits-, Lösch- und Konfigurationsaktionen sowie eine Reihenfolge.

Weitere PV-Felder sind Kundenalter, Personen im Haushalt, Anzahl Angebote, Hauptmotivation, Dach älter als 30 Jahre, Dachausrichtung, Umsetzung, Info, Stromspeicher, Dachmaterial, Entscheider und Bestandsanlage. Die Vorlage muss diese Liste als veränderbare Feldbibliothek, nicht als fest kodierte Einmalansicht führen.

## Vereinheitlichung von Lead-Daten

Externe Importwerte werden per regelbasierter Zuordnung in interne PV-Parameter überführt. Eine Zuordnung enthält Quellfeld, Zielfeld, Modus und optionalen Umschreibwert. Der gezeigte Anwendungsfall ordnet `record_file` dem Parameter `Recording` zu und ersetzt im eingehenden Wert `leadshome.ondialer.com` durch `download.voicefile.de`. Die replizierbare Vorlage benötigt deshalb geordnete Mapping-Regeln mit einem expliziten Speichern-Schritt.

## Betriebswerkzeuge

Die PV-Kategorie stellt eine CSV-Importvorlage und ein Parameter-Sheet bereit. Außerdem ist die Kategorie über einen klar abgegrenzten Löschpfad entfernbar. Diese Werkzeuge gehören in Fluxora als wiederverwendbare Funktionen der Kategorievorlage.
