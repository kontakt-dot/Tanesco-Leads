# Fluxora-Stammintegration: Photovoltaik und Wärmepumpe

**Quelle:** Nutzerbereitgestellte Datei `API-Dokumentation(1).pdf`, Seiten 1 sowie 4–8, Stand laut Dokument: 18. August 2026. Die darin genannte externe URL wird **nicht** als Fluxora-Zielintegration übernommen. Sie dient ausschließlich als fachliche Vorlage für Fluxoras eigene Stammintegrations- und Parametersheet-Verträge.

## Gemeinsamer Fluxora-Ausgangsvertrag

| Fluxora-Ausgangsfeld | Typ | Vorgabe |
|---|---|---|
| `lead_type_id` | String | Erforderlicher Kategoriecode, für PV `PVCC`, für Wärmepumpe `WP`. |
| `first_name`, `last_name` | String | Mindestens einer der beiden Werte erforderlich. |
| `gender` | String | Optional: `m` oder `f`. |
| `email`, `phone` | String | Optional. |
| `street_no`, `zip_code`, `city` | String | Adresse; PLZ ist erforderlich, wenn die Kategorie eine PLZ verlangt. |
| `country_code` | String | Erforderlich; zugelassen: `DE`, `AT`, `CH`, `US`, `CA`, `AU`. |
| `marketplace` | Boolean | Optional; Marktplatz statt regulärer Verteilung. |
| `custom_data` | Objekt | Kategorienbezogene Felder gemäß den folgenden Tabellen. |

Der spätere Versand aus Fluxora wird tokenbasiert und mandantenbezogen konfiguriert. Der vorliegende Vertrag legt **keinen** Zielanbieter und keine Ziel-URL fest.

## PV: Kategoriecode `PVCC`

| Schlüssel | Fluxora-Feld | Typ | Dokumentierte Werte |
|---|---|---|---|
| `stromverbrauch` | Stromverbrauch | Auswahl | `0 - 3.000 kWh`, `3.000 - 4.000 kWh`, `4.000 - 6.000 kWh`, `Über 6.000 kWh` |
| `monatliche_stromkosten` | Monatliche Stromkosten | Text | Freitext |
| `waermepumpe` | Wärmepumpe | Auswahl | `Ja`, `Nein` |
| `wallbox` | Wallbox | Text | Freitext |
| `dachart` | Dachart | Auswahl | `Satteldach`, `Pultdach`, `Flachdach`, `Walmdach`, `Sonstiges` |
| `hausart` | Hausart | Auswahl | `Ein-/Zweifamilienhaus`, `Mehrfamilienhaus`, `Firmengebäude`, `Freilandfläche`, `Sonstiges` |
| `dachflaeche` | Dachfläche | Text | Freitext |
| `dachalter` | Dachalter | Auswahl | `Unter 30 Jahre`, `30-70 Jahre`, `Über 70 Jahre` |
| `finanzierung` | Finanzierung | Auswahl | `Ja`, `Nein` |
| `umsetzung` | Umsetzung | Auswahl | `So schnell wie möglich`, `1-3 Monate`, `4-6 Monate`, `Mehr als 6 Monate` |
| `erreichbarkeit` | Erreichbarkeit | Text | Freitext |
| `recording_1` | Recording | Text | Freitext |
| `lieferant` | Lieferant | Text | Freitext |
| `kundenalter` | Kundenalter | Text | Freitext |
| `personen_im_haushalt` | Personen im Haushalt | Text | Freitext |
| `wie_viele_angebote` | Wie viele Angebote | Text | Freitext |
| `hauptmotivation` | Hauptmotivation | Text | Freitext |
| `dach_aelter_als_30_jahre` | Dach älter als 30 Jahre | Text | Freitext |
| `dachausrichtung` | Dachausrichtung | Text | Freitext |
| `info` | Info | Text | Freitext |
| `stromspeicher` | Stromspeicher | Auswahl | `Ja`, `Nein`, `Weiß nicht` |
| `dachmaterial` | Dachmaterial | Auswahl | `Unbefestigte Dachziegel / Dachpfannen`, `Befestigte Dachziegel / Dachpfannen (zb. vermörtelt)`, `Bitumen / Teerpappe`, `Blechdach / Metalldach`, `Naturschiefer`, `Asbest / Faserzementwolle / Eternit / Welleternit / Kunstschiefer`, `Sonstiges` |
| `entscheider` | Entscheider | Auswahl | `Ja`, `Ja, Eigentümergemeinschaft`, `Nein` |
| `bestandsanlage` | Bestandsanlage | Auswahl | `Ja, wird aber vor der Neuinstallation selbst demontiert.`, `Ja, soll mit der neuen kombiniert werden.`, `Ja, soll aber nicht mit der neuen Anlage kombiniert werden.`, `Nein` |
| `ghl_id` | GHL ID | Text | Freitext |

Die Standardisierung für Aufzeichnungs-URLs bleibt: `record_file` wird auf `recording_1` gemappt; `leadshome.ondialer.com` wird dabei durch `download.voicefile.de` ersetzt.

## Wärmepumpe: Kategoriecode `WP`

| Schlüssel | Fluxora-Feld | Typ | Dokumentierte Werte |
|---|---|---|---|
| `geplantes_heizsystem` | Geplantes Heizsystem | Auswahl | `Wärmepumpe`, `Holz/Pellets`, `Erdgas`, `Heizöl`, `Strom`, `Flüssiggas`, `Brennstoffzellenheizung` |
| `aktuelles_heizsystem` | Aktuelles Heizsystem | Auswahl | `Erdgas`, `Heizöl`, `Wärmepumpe`, `Holz/Pellets`, `Flüssiggas`, `Strom`, `Sonstiges`, `Erstinstallation/neubauprojekt` |
| `beheizte_flaeche` | Beheizte Fläche | Auswahl | `bis 100 qm`, `101-140 qm`, `141-180 qm`, `181-250 qm`, `251-400 qm`, `mehr als 400 qm` |
| `aktuelle_waermeverteilung` | Aktuelle Wärmeverteilung | Auswahl | `heizkörper`, `Fußbodenheizung`, `heizkörper & Fußbodenheizung`, `sonstiges` |
| `warmwasser_system` | Warmwasser System | Auswahl | `Zentral über Heizung`, `Separat (Durchlauferhitzer oder Boiler)`, `Solarthermie`, `weiß nicht /sonstiges` |
| `installationszeitraum` | Installationszeitraum | Auswahl | `sofort`, `1-3 Monate`, `4-6 Monate`, `7-12 Monate`, `später als 12 Monate` |
| `bevorzugte_waermepumpe` | Bevorzugte Wärmepumpe | Auswahl | `Luftwärmepumpe`, `Erdwärmepumpe`, `Beides Interessant` |
| `gebaeudetyp` | Gebäudetyp | Auswahl | `Ein-/Zweifamilienhaus`, `Doppel-Reihenhaus`, `Mehrfamilienhaus`, `Eigentumswohnung`, `Gewerbe` |
| `kommentare`, `erreichbarkeit`, `installationsort`, `info`, `record_file`, `sprachaufzeichnung` | Textfelder | Text | Freitext |
| `ist_eigentuemer`, `termin_erwuenscht`, `ist_neubau`, `interesse_photovoltaikanlage` | Qualifizierung | Auswahl | `Ja`, `Nein` |
| `hauptmotivation` | Hauptmotivation | Auswahl | `Stromkosten senken`, `Unabhängigkeit`, `Förderung nutzen` |
| `kombi_lead` | Kombi Lead | Auswahl | `ja`, `nein` |
