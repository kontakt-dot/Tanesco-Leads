/**
 * Eigenes Postfach je Absender-Adresse: Statt über den einen Anbieter aus den Einstellungen gehen die Mails dieser Adresse
 * über ihr eigenes Postfach raus (Google Workspace, Microsoft 365 oder ein anderer SMTP-Zugang). So sieht Kaltakquise für
 * den Empfänger wie normale Geschäftspost einer Person aus – und bei vielen Adressen verteilt sich der Versand auf viele Postfächer.
 * Gemeinsam für Server, Chat-Demo und Oberfläche.
 */
export type MailboxKind = "google" | "microsoft" | "smtp";
export type MailboxPreset = { key: MailboxKind; label: string; host: string; port: number; secure: boolean; hint: string };
export const MAILBOX_KINDS: MailboxPreset[] = [
  { key: "google", label: "Google Workspace / Gmail", host: "smtp.gmail.com", port: 465, secure: true, hint: "Benutzer = die Adresse selbst. Passwort = ein App-Passwort (Google-Konto → Sicherheit → Bestätigung in zwei Schritten → App-Passwörter), nicht das normale Passwort." },
  { key: "microsoft", label: "Microsoft 365 / Outlook", host: "smtp.office365.com", port: 587, secure: false, hint: "Benutzer = die Adresse selbst. Passwort = das Postfach-Passwort (bei Zwei-Faktor ein App-Passwort). Im Microsoft-365-Admin muss „SMTP AUTH“ für das Postfach erlaubt sein." },
  { key: "smtp", label: "Anderer Anbieter (SMTP)", host: "", port: 587, secure: false, hint: "Zugangsdaten deines Hosters (z. B. IONOS, Strato, All-Inkl). Port 465 = TLS sofort, 587 = STARTTLS." },
];
export const mailboxPreset = (kind: string | null | undefined): MailboxPreset | null => MAILBOX_KINDS.find((item) => item.key === kind) ?? null;
export const isMailboxKind = (value: unknown): value is MailboxKind => value === "google" || value === "microsoft" || value === "smtp";

export type MailboxRow = { mailboxKind?: string | null; smtpHost?: string | null; smtpPort?: number | null; smtpSecure?: boolean | null; smtpUser?: string | null; smtpPassword?: string | null };
export type Mailbox = { kind: MailboxKind; host: string; port: number; secure: boolean; user: string; password: string };
/** Das eingerichtete Postfach einer Absender-Adresse – `null`, solange Art, Server, Benutzer oder Passwort fehlen (dann gilt der Anbieter aus den Einstellungen). */
export function mailboxOf(row: MailboxRow): Mailbox | null {
  if (!isMailboxKind(row.mailboxKind)) return null;
  const preset = mailboxPreset(row.mailboxKind)!;
  const host = (row.smtpHost ?? "").trim() || preset.host; const user = (row.smtpUser ?? "").trim(); const password = row.smtpPassword ?? "";
  if (!host || !user || !password) return null;
  const port = row.smtpPort && row.smtpPort > 0 ? row.smtpPort : preset.port;
  return { kind: row.mailboxKind, host, port, secure: typeof row.smtpSecure === "boolean" ? row.smtpSecure : port === 465, user, password };
}
/** Was fehlt noch, damit das Postfach versendet? (für die Anzeige) */
export function mailboxMissing(row: MailboxRow): string[] {
  if (!isMailboxKind(row.mailboxKind)) return [];
  const preset = mailboxPreset(row.mailboxKind)!; const missing: string[] = [];
  if (!(row.smtpHost ?? "").trim() && !preset.host) missing.push("Server");
  if (!(row.smtpUser ?? "").trim()) missing.push("Benutzer");
  if (!row.smtpPassword) missing.push("Passwort");
  return missing;
}
