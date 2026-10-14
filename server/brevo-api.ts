/**
 * Versand über die HTTP-Schnittstelle von Brevo statt über SMTP.
 *
 * Hintergrund: Viele Hoster (u. a. Railway) sperren ausgehende Mail-Ports (25, 465, 587, 2525) gegen Spam-Versand.
 * Ein SMTP-Versuch läuft dort in einen Timeout, ohne dass die Zugangsdaten überhaupt geprüft werden. Die HTTP-Schnittstelle
 * läuft über Port 443 wie eine normale Webseite und ist deshalb immer erreichbar.
 *
 * Das Objekt aus `brevoTransport()` verhält sich nach außen wie ein Nodemailer-Transport (`verify`, `sendMail`),
 * damit der restliche Code (deliverMail, Testmail, Kampagnen) unverändert bleibt.
 */

/** Adresse der Schnittstelle. Über BREVO_API_URL umstellbar – nur für automatische Tests gegen einen Nachbau. */
const apiBase = () => (process.env.BREVO_API_URL || "https://api.brevo.com/v3").replace(/\/+$/, "");

export type BrevoMail = {
  from?: string;
  replyTo?: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: Array<{ filename: string; content: string; contentType?: string }>;
};

/** „Name <adresse@example.de>“ → { name, email }; auch eine blanke Adresse wird akzeptiert. */
export function parseAddress(value: string | null | undefined): { name?: string; email: string } | null {
  const raw = (value ?? "").trim(); if (!raw) return null;
  const withName = raw.match(/^\s*"?([^"<]*?)"?\s*<\s*([^>\s]+)\s*>\s*$/);
  if (withName) { const name = withName[1].trim(); return name ? { name, email: withName[2] } : { email: withName[2] }; }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? { email: raw } : null;
}

type FetchLike = typeof fetch;

async function call(path: string, apiKey: string, init: RequestInit & { fetchImpl?: FetchLike } = {}) {
  const { fetchImpl, ...rest } = init;
  const doFetch = fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await doFetch(`${apiBase()}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: { "api-key": apiKey, accept: "application/json", ...(rest.body ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    });
    const text = await response.text();
    let body: unknown = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) {
      const detail = body && typeof body === "object" && "message" in body ? String((body as { message: unknown }).message) : typeof body === "string" ? body.slice(0, 200) : "";
      throw new Error(`Brevo ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Brevo antwortet nicht (Zeitüberschreitung nach 20 s).");
    throw error;
  } finally { clearTimeout(timer); }
}

/** Nodemailer-ähnlicher Transport, der über die HTTP-Schnittstelle sendet. */
export function brevoTransport(apiKey: string, options: { fetchImpl?: FetchLike } = {}) {
  const key = apiKey.trim();
  return {
    /** Prüft den Schlüssel (Kontoabfrage) – entspricht dem Verbindungstest von SMTP. */
    async verify() {
      if (!key) throw new Error("Kein Brevo-API-Schlüssel hinterlegt.");
      if (key.startsWith("xsmtpsib-")) throw new Error("Das ist der SMTP-Schlüssel. Für den Versand über die HTTP-Schnittstelle brauchst du den API-Schlüssel (beginnt mit xkeysib-, Brevo → SMTP & API → Reiter „API-Schlüssel“).");
      await call("/account", key, { method: "GET", fetchImpl: options.fetchImpl });
      return true as const;
    },
    async sendMail(mail: BrevoMail) {
      const sender = parseAddress(mail.from); if (!sender) throw new Error("Keine gültige Absenderadresse hinterlegt.");
      const recipient = parseAddress(mail.to); if (!recipient) throw new Error(`Keine gültige Empfängeradresse: ${mail.to}`);
      const replyTo = parseAddress(mail.replyTo);
      const body = {
        sender,
        to: [recipient],
        subject: mail.subject,
        ...(mail.html ? { htmlContent: mail.html } : {}),
        ...(mail.text ? { textContent: mail.text } : {}),
        ...(replyTo ? { replyTo } : {}),
        ...(mail.attachments?.length ? { attachment: mail.attachments.map((item) => ({ name: item.filename, content: item.content })) } : {}),
      };
      const result = await call("/smtp/email", key, { method: "POST", body: JSON.stringify(body), fetchImpl: options.fetchImpl });
      const messageId = result && typeof result === "object" && "messageId" in result ? String((result as { messageId: unknown }).messageId) : undefined;
      return { messageId };
    },
  };
}
