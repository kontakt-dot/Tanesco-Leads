/**
 * Anleitung für den Entwickler des Dialers (z. B. OnDialer): wie der Webhook „Gespräch beendet“ an unsere Software aussehen muss.
 * Wird in der App (Gespräche → Dialer-Anbindung) mit der echten Adresse und den eingestellten Feldnamen erzeugt – zum Kopieren in eine E-Mail.
 * Bewusst ohne Produktnamen: nur „unsere Software“.
 */
export type DialerGuideInput = { webhookUrl: string; fieldMapping: Record<string, string>; consentRequired: boolean; recordingAuthHeader: boolean };

const FIELD_ROWS: Array<{ key: string; required: boolean; what: string; example: string }> = [
  { key: "callId", required: true, what: "Eindeutige Gesprächs-ID des Dialers. Dient dem Doppelt-Schutz: dieselbe ID wird nie zweimal ausgewertet – ein erneutes Senden ist unschädlich.", example: "\"od-2026-1105-000123\"" },
  { key: "phone", required: true, what: "Angerufene Rufnummer (Format egal, am besten +49…). Darüber ordnen wir das Gespräch dem Kontakt zu.", example: "\"+49 30 1234567\"" },
  { key: "recordingUrl", required: true, what: "Direkter https-Link zur Aufnahme (mp3, wav, m4a oder ogg). Muss ohne Login abrufbar sein – oder mit einem festen Zugriffs-Header, den ihr uns nennt. Der Link sollte dauerhaft gültig bleiben (mindestens 1 Jahr), damit wir Gespräche später nachhören können.", example: "\"https://…/recordings/000123.mp3\"" },
  { key: "consent", required: false, what: "true, wenn die Einwilligung zur Aufzeichnung vorlag. Ohne true wird das Gespräch gespeichert, aber nicht ausgewertet (solange bei uns „Einwilligung erforderlich“ eingeschaltet ist).", example: "true" },
  { key: "agent", required: false, what: "Name oder Kürzel des Agenten.", example: "\"Yilmaz\"" },
  { key: "campaign", required: false, what: "Name der Kampagne/Liste im Dialer – wir ordnen danach die Prüffragen zu.", example: "\"PV Herbst 2026\"" },
  { key: "direction", required: false, what: "\"outbound\" (ausgehend, Standard) oder \"inbound\" (eingehend).", example: "\"outbound\"" },
  { key: "startedAt", required: false, what: "Gesprächsbeginn als ISO 8601 mit Zeitzone. Fehlt er, nehmen wir den Eingangszeitpunkt.", example: "\"2026-11-05T09:15:00+01:00\"" },
  { key: "duration", required: false, what: "Gesprächsdauer in Sekunden (Zahl).", example: "312" },
  { key: "leadId", required: false, what: "Unsere Kontakt-Nummer, falls ihr sie mitführt (steht in Exporten als „Lead-ID“, z. B. API-1A2B3C4D). Dann ist die Zuordnung eindeutig, auch bei doppelten Rufnummern.", example: "\"API-1A2B3C4D\"" },
  { key: "transcript", required: false, what: "Fertiges Transkript, falls der Dialer selbst transkribiert. Dann holen wir die Aufnahme nur zum Nachhören.", example: "\"Agent: Guten Tag … Kunde: …\"" },
];

export function dialerGuideText(input: DialerGuideInput): string {
  const name = (key: string) => input.fieldMapping[key] ?? key;
  const example: Record<string, unknown> = { [name("callId")]: "od-2026-1105-000123", [name("phone")]: "+49 30 1234567", [name("agent")]: "Yilmaz", [name("campaign")]: "PV Herbst 2026", [name("direction")]: "outbound", [name("startedAt")]: "2026-11-05T09:15:00+01:00", [name("duration")]: 312, [name("recordingUrl")]: "https://IHR-SERVER/recordings/000123.mp3", [name("consent")]: true };
  const lines: string[] = [];
  lines.push("# Schnittstelle „Gespräch beendet“ – Webhook vom Dialer an unsere Software", "");
  lines.push("## Worum es geht", "Nach jedem beendeten Gespräch schickt der Dialer die Gesprächsdaten und den Link zur Aufnahme an unsere Software. Wir holen die Aufnahme, erstellen das Transkript und werten das Gespräch aus. Es ist eine einzige Anfrage pro Gespräch – keine Rückmeldung an den Dialer nötig.", "");
  lines.push("## Adresse", "```", `POST ${input.webhookUrl}`, "Content-Type: application/json", "```", "Der lange Teil am Ende ist unser geheimer Zugangsschlüssel – bitte nicht weitergeben und nur über https senden. JSON im Body ist der Normalfall; Formularfelder (x-www-form-urlencoded) oder Parameter in der Adresse funktionieren ebenfalls.", "");
  lines.push("## Wann senden", "Direkt nach Gesprächsende. Ideal ist der Zeitpunkt, an dem die Aufnahmedatei abrufbar ist. Ist sie noch nicht fertig, trotzdem senden – wir versuchen es automatisch bis zu 8-mal über etwa 4 Stunden erneut (nach 2, 4, 8 … 60 Minuten). Alternativ dasselbe Gespräch später noch einmal mit derselben Gesprächs-ID senden.", "");
  lines.push("## Felder", "", "| Feld | Pflicht | Bedeutung | Beispiel |", "|---|---|---|---|");
  for (const row of FIELD_ROWS) lines.push(`| \`${name(row.key)}\` | ${row.required ? "ja" : "nein"} | ${row.what} | \`${row.example}\` |`);
  lines.push("", "Andere Feldnamen sind möglich (wir können sie bei uns zuordnen) – am einfachsten ist es, genau diese Namen zu verwenden. Verschachtelte Felder (z. B. `call.id`) gehen auch; dann bitte Bescheid geben.", "");
  lines.push("## Beispiel", "```json", JSON.stringify(example, null, 2), "```", "", "Als curl:", "```", `curl -X POST "${input.webhookUrl}" \\`, "  -H \"Content-Type: application/json\" \\", `  -d '${JSON.stringify(example)}'`, "```", "");
  lines.push("## Antworten", "| Status | Bedeutung |", "|---|---|", "| 200 `{\"ok\":true,\"evaluated\":true,\"score\":…,\"verdict\":…,\"decision\":…}` | angenommen und ausgewertet |", "| 200 `{\"ok\":true,\"evaluated\":false,\"error\":\"…\"}` | angenommen; Auswertung folgt automatisch (z. B. Aufnahme noch nicht abrufbar) |", "| 200 `{\"ok\":true,\"duplicate\":true}` | dieselbe Gesprächs-ID kam schon – nichts passiert |", `| 202 \`{"ok":true,"evaluated":false,"reason":"no consent"}\` | gespeichert, aber nicht ausgewertet: Feld \`${name("consent")}\` war nicht true |`, "| 403 | Auswertung ist bei uns ausgeschaltet |", "| 404 | Adresse oder Schlüssel falsch |", "| 503 / 5xx | vorübergehend nicht erreichbar – bitte mit wachsendem Abstand erneut senden (Doppelt-Schutz greift) |", "");
  lines.push("## Testen, ohne etwas zu speichern", `1. **Prüf-Aufruf:** \`GET ${input.webhookUrl}\` – antwortet mit \`ok:true\`, den erwarteten Feldnamen und ob die Auswertung eingeschaltet ist.`, "2. **Testmodus:** dasselbe JSON per POST mit zusätzlich `\"test\": true` senden. Wir prüfen die Felder und ob der Aufnahme-Link abrufbar ist, speichern aber nichts. Die Antwort nennt fehlende Pflichtfelder (`required_missing`), den Stand des Links (`recording`) und ob das Gespräch ausgewertet würde (`would_evaluate`).", "3. Danach ein echtes Testgespräch senden – es erscheint bei uns unter „Gespräche“.", "");
  lines.push("## Aktuelle Einstellungen bei uns", `- Einwilligung erforderlich: ${input.consentRequired ? `ja – \`${name("consent")}: true\` mitsenden, sonst keine Auswertung` : "nein – das Feld ist optional"}`, `- Zugriffs-Header für Aufnahmen: ${input.recordingAuthHeader ? "hinterlegt (bitte prüfen, ob Name und Wert zu euren Links passen)" : "keiner – die Links müssen ohne Login abrufbar sein, oder ihr nennt uns Header-Name und Wert"}`, "- Die Aufnahme wird nur zum Transkribieren und Nachhören abgerufen; dauerhaft gespeichert werden Gesprächsdaten, Link und Transkript.", "");
  lines.push("## Noch offen / bitte mitteilen", "- Sind die Aufnahme-Links öffentlich (signiert) oder braucht es einen Header/Schlüssel?", "- Wie lange bleiben die Links gültig?", "- Gibt es eine Schnittstelle, über die ein laufendes Gespräch live mitgehört werden kann (Audio-Stream)? Falls ja: Name und Doku.");
  return lines.join("\n");
}
