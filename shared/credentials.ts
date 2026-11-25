/**
 * Zugangsdaten für Partner (Benutzer → Integration → Endpoint → „Anmeldung nötig“).
 * Gespeicherte Geheimnisse kommen nie zurück in den Browser: An ihrer Stelle steht SAVED_SECRET; wer speichert, ohne neu einzutippen,
 * behält den gespeicherten Wert. Benutzernamen sind kein Geheimnis – sie kommen lesbar zurück, damit man sieht, welcher Zugang drin ist
 * (z. B. Test oder Live).
 */
export const SAVED_SECRET = "••••••••";

/** Zugangsfeld, dessen Wert kein Geheimnis ist (Benutzername, Login, E-Mail, Client-ID): lesbar statt Punkte, auch gespeichert. */
export const isPlainCredential = (name: string) => /^(user|username|user_name|benutzer|benutzername|login|e-?mail|mail|account|client_?id)$/i.test(name.trim());
