/**
 * Eingabefehler als verständlicher deutscher Satz.
 *
 * Lehnt die Prüfung eine Eingabe ab, kam bisher die technische Liste beim Nutzer an
 * („[{ "code": "too_big", "maximum": 500, "path": ["criteria", 0, "description"] … }]“).
 * Hier wird daraus „Kriterium 1 – Beschreibung ist zu lang (höchstens 500 Zeichen).“
 */
export type InputIssue = { code?: string; path?: ReadonlyArray<PropertyKey>; maximum?: unknown; minimum?: unknown; origin?: string; type?: string; message?: string; input?: unknown; format?: string };

const FIELD: Record<string, string> = {
  name: "Name", label: "Bezeichnung", description: "Beschreibung", hint: "Hinweis", instructions: "Vorgaben für die KI", weight: "Gewicht",
  questions: "Frage", criteria: "Kriterium", rule: "Regel", campaign: "Kampagne", from: "Bisheriger Name", to: "Neuer Name",
  email: "E-Mail-Adresse", fromEmail: "Absender-Adresse", fromName: "Absender-Name", phone: "Telefonnummer", subject: "Betreff", text: "Text", body: "Text",
  note: "Notiz", title: "Titel", firstName: "Vorname", lastName: "Nachname", company: "Firma", city: "Ort", zip: "Postleitzahl", street: "Straße",
  url: "Adresse (Link)", website: "Webseite", password: "Passwort", listName: "Name der Liste", rows: "Zeile", agentName: "Agent", transcript: "Transkript",
  retentionDays: "Aufbewahrung (Tage)", autoApproveThreshold: "Schwelle für die Freigabe", autoRejectThreshold: "Schwelle für die Ablehnung",
};

/** Pfad → lesbare Feldbezeichnung: ["criteria", 0, "description"] → „Kriterium 1 – Beschreibung“. */
export function fieldLabel(path: ReadonlyArray<PropertyKey> | undefined): string {
  const parts: string[] = [];
  for (const segment of path ?? []) {
    if (typeof segment === "number") { if (parts.length) parts[parts.length - 1] += ` ${segment + 1}`; else parts.push(`Eintrag ${segment + 1}`); continue; }
    const key = String(segment); parts.push(FIELD[key] ?? key);
  }
  return parts.join(" – ") || "Die Eingabe";
}

function one(issue: InputIssue): string {
  const field = fieldLabel(issue.path); const kind = issue.origin ?? issue.type ?? ""; const max = Number(issue.maximum); const min = Number(issue.minimum);
  if (issue.code === "too_big") {
    if (kind === "string") return `${field} ist zu lang (höchstens ${max} Zeichen).`;
    if (kind === "array" || kind === "set") return `${field}: höchstens ${max} Einträge möglich.`;
    return `${field} darf höchstens ${max} sein.`;
  }
  if (issue.code === "too_small") {
    if (kind === "string") return min <= 1 ? `${field} fehlt.` : `${field} ist zu kurz (mindestens ${min} Zeichen).`;
    if (kind === "array" || kind === "set") return `${field}: mindestens ${min} ${min === 1 ? "Eintrag" : "Einträge"} nötig.`;
    return `${field} muss mindestens ${min} sein.`;
  }
  if (issue.code === "invalid_type") return issue.input === undefined || /received undefined|required/i.test(issue.message ?? "") ? `${field} fehlt.` : `${field} hat ein ungültiges Format.`;
  if (issue.code === "invalid_format" || issue.code === "invalid_string") return issue.format === "email" ? `${field} ist keine gültige E-Mail-Adresse.` : issue.format === "url" ? `${field} ist kein gültiger Link.` : `${field} hat ein ungültiges Format.`;
  if (issue.code === "invalid_value" || issue.code === "invalid_enum_value" || issue.code === "invalid_union") return `${field}: Dieser Wert ist nicht möglich.`;
  if (issue.code === "custom" && issue.message && !/^invalid/i.test(issue.message)) return issue.message; // eigene (schon deutsche) Meldung aus einer Prüfregel
  return `${field}: Die Eingabe ist ungültig.`;
}

export function inputErrorMessage(issues: ReadonlyArray<InputIssue> | null | undefined): string {
  const list = Array.isArray(issues) ? issues : []; if (!list.length) return "Die Eingabe ist ungültig.";
  const rest = list.length - 1;
  return `${one(list[0])}${rest > 0 ? ` (${rest} weitere ${rest === 1 ? "Angabe passt" : "Angaben passen"} ebenfalls nicht.)` : ""}`;
}
