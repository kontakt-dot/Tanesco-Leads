/**
 * Anleitung für den Entwickler des Dialers (z. B. OnDialer): wie der Webhook „Gespräch beendet“ an unsere Software aussehen muss.
 * Wird in der App (Gespräche → Dialer-Anbindung) mit der echten Adresse und den eingestellten Feldnamen erzeugt – zum Kopieren in eine E-Mail.
 * Bewusst ohne Produktnamen: nur „unsere Software“.
 */
export type DialerGuideInput = { webhookUrl: string; fieldMapping: Record<string, string>; consentRequired: boolean; recordingAuthHeader: boolean };

const FIELD_ROWS: Array<{ key: string; required: boolean | "empfohlen"; what: string; example: string }> = [
  { key: "callId", required: true, what: "Eindeutige Gesprächs-ID des Dialers. Dient dem Doppelt-Schutz: dieselbe ID wird nie zweimal ausgewertet – ein erneutes Senden ist unschädlich.", example: "\"od-2026-1105-000123\"" },
  { key: "phone", required: true, what: "Angerufene Rufnummer (Format egal, am besten +49…). Darüber ordnen wir das Gespräch dem Kontakt zu.", example: "\"+49 30 1234567\"" },
  { key: "recordingUrl", required: true, what: "Direkter https-Link zur Aufnahme (mp3, wav, m4a oder ogg). Muss ohne Login abrufbar sein – oder mit einem festen Zugriffs-Header, den ihr uns nennt. Der Link sollte dauerhaft gültig bleiben (mindestens 1 Jahr), damit wir Gespräche später nachhören können.", example: "\"https://…/recordings/000123.mp3\"" },
  { key: "agent", required: true, what: "Voller Name des Agenten, der das Gespräch geführt hat – immer in derselben Schreibweise. Darüber werten wir aus, welcher Agent welche Leads bringt.", example: "\"Deniz Kaya\"" },
  { key: "category", required: "empfohlen", what: "Leadsparte, um die es im Gespräch ging: \"PV\" (Photovoltaik), \"WP\" (Wärmepumpe) oder \"PV+WP\" (beides). Daraus wird die Kategorie des Leads. Ohne Angabe erkennen wir sie aus dem Gespräch.", example: "\"PV\"" },
  { key: "consent", required: false, what: "true, wenn die Einwilligung zur Aufzeichnung vorlag. Ohne true wird das Gespräch gespeichert, aber nicht ausgewertet (solange bei uns „Einwilligung erforderlich“ eingeschaltet ist).", example: "true" },
  { key: "campaign", required: false, what: "Name der Kampagne/Liste im Dialer – wir ordnen danach die Prüffragen zu.", example: "\"PV Herbst 2026\"" },
  { key: "direction", required: false, what: "\"outbound\" (ausgehend, Standard) oder \"inbound\" (eingehend).", example: "\"outbound\"" },
  { key: "startedAt", required: false, what: "Gesprächsbeginn als ISO 8601 mit Zeitzone. Fehlt er, nehmen wir den Eingangszeitpunkt.", example: "\"2026-11-05T09:15:00+01:00\"" },
  { key: "duration", required: false, what: "Gesprächsdauer in Sekunden (Zahl).", example: "312" },
  { key: "leadId", required: false, what: "Unsere Kontakt-Nummer, falls ihr sie mitführt (steht in Exporten als „Lead-ID“, z. B. API-1A2B3C4D). Dann ist die Zuordnung eindeutig, auch bei doppelten Rufnummern.", example: "\"API-1A2B3C4D\"" },
  { key: "transcript", required: false, what: "Fertiges Transkript, falls der Dialer selbst transkribiert. Dann holen wir die Aufnahme nur zum Nachhören.", example: "\"Agent: Guten Tag … Kunde: …\"" },
];

/** Felder zum Kontakt – der Dialer kann den ganzen Kontakt in derselben Meldung mitschicken (alles freiwillig). */
const CONTACT_ROWS: Array<{ key: string; what: string; example: unknown }> = [
  { key: "contactId", what: "Eure Kontakt-Nummer. Sie bleibt bei jedem Anruf desselben Kontakts gleich.", example: "C-88412" },
  { key: "firstName", what: "Vorname", example: "Murat" },
  { key: "lastName", what: "Nachname", example: "Yilmaz" },
  { key: "company", what: "Firma, bei Gewerbe", example: "" },
  { key: "street", what: "Straße mit Hausnummer", example: "Hauptstraße 12" },
  { key: "postcode", what: "Postleitzahl", example: "64283" },
  { key: "city", what: "Ort", example: "Darmstadt" },
  { key: "country", what: "Land als Kürzel: DE, AT oder CH. Ohne Angabe gilt DE.", example: "DE" },
  { key: "email", what: "E-Mail-Adresse", example: "murat@example.de" },
  { key: "contactFields", what: "Alle weiteren Angaben als Name-Wert-Paare: die Felder der Liste und alles, was der Agent in der Maske einträgt. Eigene Namen mit Vorsilbe der Leadsparte gehen auch (z. B. `pv_dachart`, `wp_gebaeudetyp`) – wir ordnen sie unseren Feldern zu und erkennen daran die Leadsparte. Den Link zur Aufnahme bitte in `recording_url` senden.", example: { "Dachfläche": "60 m²", "Eigentümer": "ja", "Baujahr": "1998" } },
  { key: "result", what: "Ergebnis im Dialer (Abschluss), zum Beispiel Termin, Interesse, kein Interesse", example: "Termin" },
  { key: "note", what: "Notiz des Agenten", example: "Dach nach Süden, 2019 neu gedeckt" },
  { key: "callbackAt", what: "Rückruf- oder Termin-Zeitpunkt als ISO 8601 mit Zeitzone", example: "2026-11-21T10:00:00+01:00" },
];
/** Wert an einen Pfad in Punkt-Schreibweise setzen (`contact.first_name` → verschachtelt). */
const setPath = (target: Record<string, unknown>, path: string, value: unknown) => { const parts = path.split(".").filter(Boolean); let node = target; parts.forEach((part, index) => { if (index === parts.length - 1) { node[part] = value; return; } if (!node[part] || typeof node[part] !== "object") node[part] = {}; node = node[part] as Record<string, unknown>; }); };

export function dialerGuideText(input: DialerGuideInput): string {
  const name = (key: string) => input.fieldMapping[key] ?? key;
  const withContact: Record<string, unknown> = {};
  const example: Record<string, unknown> = { [name("callId")]: "od-2026-1105-000123", [name("phone")]: "+49 30 1234567", [name("agent")]: "Deniz Kaya", [name("category")]: "PV", [name("campaign")]: "PV Herbst 2026", [name("direction")]: "outbound", [name("startedAt")]: "2026-11-05T09:15:00+01:00", [name("duration")]: 312, [name("recordingUrl")]: "https://IHR-SERVER/recordings/000123.mp3", [name("consent")]: true };
  const lines: string[] = [];
  lines.push("# Schnittstelle „Gespräch beendet“ – Webhook vom Dialer an unsere Software", "");
  lines.push("## Worum es geht", "Nach jedem beendeten Gespräch schickt der Dialer die Gesprächsdaten und den Link zur Aufnahme an unsere Software. Wir holen die Aufnahme, erstellen das Transkript und werten das Gespräch aus. Es ist eine einzige Anfrage pro Gespräch – keine Rückmeldung an den Dialer nötig.", "");
  lines.push("## Adresse", "```", `POST ${input.webhookUrl}`, "Content-Type: application/json", "```", "Der lange Teil am Ende ist unser geheimer Zugangsschlüssel – bitte nicht weitergeben und nur über https senden. JSON im Body ist der Normalfall; Formularfelder (x-www-form-urlencoded) oder Parameter in der Adresse funktionieren ebenfalls.", "");
  lines.push("## Wann senden", "Direkt nach Gesprächsende. Ideal ist der Zeitpunkt, an dem die Aufnahmedatei abrufbar ist. Ist sie noch nicht fertig, trotzdem senden – wir versuchen es automatisch bis zu 8-mal über etwa 4 Stunden erneut (nach 2, 4, 8 … 60 Minuten). Alternativ dasselbe Gespräch später noch einmal mit derselben Gesprächs-ID senden.", "");
  lines.push("## Felder", "", "| Feld | Pflicht | Bedeutung | Beispiel |", "|---|---|---|---|");
  for (const row of FIELD_ROWS) lines.push(`| \`${name(row.key)}\` | ${row.required === true ? "ja" : row.required === "empfohlen" ? "empfohlen" : "nein"} | ${row.what} | \`${row.example}\` |`);
  lines.push("", "Andere Feldnamen sind möglich (wir können sie bei uns zuordnen) – am einfachsten ist es, genau diese Namen zu verwenden. Verschachtelte Felder (z. B. `call.id`) gehen auch; dann bitte Bescheid geben.", "");
  // Agent und Leadsparte: warum wir sie brauchen
  lines.push("## Agent und Leadsparte – bitte bei jedem Gespräch mitsenden", `- **\`${name("agent")}\`:** Wir werten aus, welcher Agent welche Leads bringt. Bitte immer den vollen Namen des Agenten senden, der telefoniert hat – und immer gleich geschrieben (nicht einmal „D. Kaya“ und einmal „Deniz Kaya“). Der Name aus dem Dialer gilt bei uns.`, `- **\`${name("category")}\`:** die Leadsparte des Gesprächs – \`PV\` für Photovoltaik, \`WP\` für Wärmepumpe, \`PV+WP\` für beides. Daraus wird die Kategorie des Leads. Wählt der Agent das Produkt im Dialer aus, bitte genau diesen Wert senden.`, "");
  // Kontakt mitschicken: Felder, was damit geschieht, flache Schreibweise
  lines.push("## Kontakt mitschicken – damit aus dem Gespräch ein Lead wird", "Bitte schickt in derselben Meldung den ganzen Kontakt mit. Kennen wir die Rufnummer noch nicht, legen wir den Kontakt selbst an – nach einer guten Bewertung wird er bei uns zum Lead. Dafür brauchen wir neben der Rufnummer mindestens einen Namen oder eine Firma; je vollständiger die Angaben (Anschrift, E-Mail, weitere Felder), desto besser ist der Lead. Technisch sind die Felder dieses Abschnitts freiwillig – ohne Namen oder Firma können wir aber keinen Lead anlegen.", "", "| Feld | Bedeutung | Beispiel |", "|---|---|---|");
  for (const row of CONTACT_ROWS) lines.push(`| \`${name(row.key)}\` | ${row.what} | \`${JSON.stringify(row.key === "contactFields" ? { "Dachfläche": "60 m²" } : row.key === "company" ? "Solartechnik Mayer GmbH" : row.example)}\` |`);
  lines.push("", "Was wir damit tun:", "- **Rufnummer unbekannt:** Der Kontakt wird bei uns angelegt. Nach einer guten Bewertung wird er zum Lead, nach einer schlechten wird er verworfen.", `- **Rufnummer bekannt:** Fehlende Angaben werden ergänzt, vorhandene nie überschrieben. \`${name("contactFields")}\`, \`${name("result")}\` und \`${name("note")}\` speichern wir am Kontakt.`, "- **Ohne Kontakt-Daten:** alles wie bisher – die Zuordnung läuft nur über die Rufnummer.", "", "Die Kontakt-Felder dürfen auch flach neben der Rufnummer stehen (`first_name`, `last_name`, `company`, `street`, `postcode`, `city`, `email`, `contact_id`) – nötig, wenn ihr Formularfelder statt JSON sendet. Deutsche Namen wie `vorname`, `nachname`, `firma`, `strasse`, `plz` und `ort` erkennen wir ebenfalls.", "");
  for (const [key, value] of Object.entries(example)) setPath(withContact, key, value);
  for (const row of CONTACT_ROWS.filter((item) => ["result", "note", "callbackAt"].includes(item.key))) setPath(withContact, name(row.key), row.example);
  for (const row of CONTACT_ROWS.filter((item) => !["result", "note", "callbackAt"].includes(item.key))) setPath(withContact, name(row.key), row.example);
  lines.push("## Beispiel", "```json", JSON.stringify(example, null, 2), "```", "", "Als curl:", "```", `curl -X POST "${input.webhookUrl}" \\`, "  -H \"Content-Type: application/json\" \\", `  -d '${JSON.stringify(example)}'`, "```", "", "Dieselbe Meldung mit Kontakt:", "```json", JSON.stringify(withContact, null, 2), "```", "");
  lines.push("## Antworten", "| Status | Bedeutung |", "|---|---|", "| 200 `{\"ok\":true,\"evaluated\":true,\"score\":…,\"verdict\":…,\"decision\":…}` | angenommen und ausgewertet |", "| 200 `{\"ok\":true,\"evaluated\":false,\"error\":\"…\"}` | angenommen; Auswertung folgt automatisch (z. B. Aufnahme noch nicht abrufbar) |", "| 200 `{\"ok\":true,\"duplicate\":true}` | dieselbe Gesprächs-ID kam schon – nichts passiert |", `| 202 \`{"ok":true,"evaluated":false,"reason":"no consent"}\` | gespeichert, aber nicht ausgewertet: Feld \`${name("consent")}\` war nicht true |`, "| 403 | Auswertung ist bei uns ausgeschaltet |", "| 404 | Adresse oder Schlüssel falsch |", "| 503 / 5xx | vorübergehend nicht erreichbar – bitte mit wachsendem Abstand erneut senden (Doppelt-Schutz greift) |", "", "Jede angenommene Meldung nennt außerdem, was mit dem Kontakt geschehen ist: `\"contact\": \"created\"` (Rufnummer war unbekannt – Kontakt angelegt), `\"updated\"` (Kontakt war bekannt – fehlende Angaben ergänzt), `\"matched\"` (Kontakt war bekannt – nichts zu ergänzen) oder `\"none\"` (Rufnummer unbekannt und keine Kontakt-Daten in der Meldung). `lead_id` ist unsere Lead-Nummer, sobald der Kontakt bei uns ein Lead ist.", "");
  lines.push("## Testen, ohne etwas zu speichern", `1. **Prüf-Aufruf:** \`GET ${input.webhookUrl}\` – antwortet mit \`ok:true\`, den erwarteten Feldnamen und ob die Auswertung eingeschaltet ist.`, "2. **Testmodus:** dasselbe JSON per POST mit zusätzlich `\"test\": true` senden. Wir prüfen die Felder und ob der Aufnahme-Link abrufbar ist, speichern aber nichts. Die Antwort nennt fehlende Pflichtfelder (`required_missing` – dort steht auch ein fehlender Agent), den Stand des Links (`recording`), ob das Gespräch ausgewertet würde (`would_evaluate`), unter `category`, ob wir die Leadsparte erkannt haben (`recognised`), und unter `contact`, welche Kontakt-Felder wir erkannt haben (`found`) und was im Ernstfall geschehen würde (`would`).", "3. Danach ein echtes Testgespräch senden – es erscheint bei uns unter „Gespräche“.", "");
  lines.push("## Aktuelle Einstellungen bei uns", `- Einwilligung erforderlich: ${input.consentRequired ? `ja – \`${name("consent")}: true\` mitsenden, sonst keine Auswertung` : "nein – das Feld ist optional"}`, `- Zugriffs-Header für Aufnahmen: ${input.recordingAuthHeader ? "hinterlegt (bitte prüfen, ob Name und Wert zu euren Links passen)" : "keiner – die Links müssen ohne Login abrufbar sein, oder ihr nennt uns Header-Name und Wert"}`, "- Die Aufnahme wird nur zum Transkribieren und Nachhören abgerufen; dauerhaft gespeichert werden Gesprächsdaten, Link und Transkript.", "");
  lines.push("## Noch offen / bitte mitteilen", "- Sind die Aufnahme-Links öffentlich (signiert) oder braucht es einen Header/Schlüssel?", "- Wie lange bleiben die Links gültig?", "- Gibt es eine Schnittstelle, über die ein laufendes Gespräch live mitgehört werden kann (Audio-Stream)? Falls ja: Name und Doku.");
  return lines.join("\n");
}
