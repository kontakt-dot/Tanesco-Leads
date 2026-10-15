/**
 * Signatur (Footer) für Einzel-E-Mails – Antworten aus dem Posteingang und E-Mails aus der Pipeline-Karte.
 *
 * Aufbau wie eine klassische Geschäfts-Signatur: Grußformel, Name (kursiv), optional Position, Logo,
 * Firmenblock (Firma, Straße, Ort aus Einstellungen → Branding → Fußzeile), Telefon, E-Mail, Webseite.
 * Server und Chat-Demo rendern mit derselben Funktion; die Einstellungen zeigen eine Live-Vorschau.
 */
export type MailSignature = {
  enabled: boolean;
  greeting: string;   // „Mit freundlichen Grüßen“
  name: string;       // „Thomas Kutzbach“
  role: string;       // optional, z. B. „Geschäftsführung“
  phone: string;
  email: string;
  website: string;
  showLogo: boolean;
  showCompany: boolean; // Firmenblock aus der Fußzeile (Einstellungen → Branding)
};

export const DEFAULT_SIGNATURE: MailSignature = { enabled: true, greeting: "Mit freundlichen Grüßen", name: "", role: "", phone: "", email: "", website: "", showLogo: true, showCompany: true };

export function normalizeSignature(input: Partial<MailSignature> | null | undefined): MailSignature {
  const value = input ?? {};
  const text = (key: keyof MailSignature, max = 160) => String((value as Record<string, unknown>)[key] ?? DEFAULT_SIGNATURE[key] ?? "").trim().slice(0, max);
  return {
    enabled: value.enabled ?? DEFAULT_SIGNATURE.enabled,
    greeting: text("greeting", 80), name: text("name", 120), role: text("role", 120), phone: text("phone", 60), email: text("email", 200), website: text("website", 200),
    showLogo: value.showLogo ?? DEFAULT_SIGNATURE.showLogo, showCompany: value.showCompany ?? DEFAULT_SIGNATURE.showCompany,
  };
}

/** Fußzeile „Firma · Straße · Ort“ in Zeilen zerlegen. */
export const companyLines = (footer: string | null | undefined): string[] => String(footer ?? "").split(/\s*(?:·|\||\n)\s*/).map((part) => part.trim()).filter(Boolean);

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const websiteHref = (site: string) => (/^https?:\/\//i.test(site) ? site : `https://${site}`);
const websiteLabel = (site: string) => site.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

export type SignatureContext = { companyFooter?: string | null; logoUrl?: string | null };

export function hasSignatureContent(signature: MailSignature, context: SignatureContext = {}): boolean {
  if (!signature.enabled) return false;
  return Boolean(signature.greeting || signature.name || signature.phone || signature.email || signature.website || (signature.showCompany && companyLines(context.companyFooter).length));
}

/** HTML-Signatur – schlicht, ohne Tabellenzauber, damit sie in jedem Postfach gleich aussieht. */
export function renderSignatureHtml(signature: MailSignature, context: SignatureContext = {}): string {
  if (!hasSignatureContent(signature, context)) return "";
  const lines: string[] = [];
  lines.push(`<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#101828;margin-top:22px">`);
  lines.push(`<div style="color:#98a2b3">--</div>`);
  if (signature.greeting) lines.push(`<div style="font-weight:700;margin-top:6px">${escape(signature.greeting)}</div>`);
  if (signature.name) lines.push(`<div style="font-style:italic">${escape(signature.name)}${signature.role ? ` <span style="font-style:normal;color:#667085">· ${escape(signature.role)}</span>` : ""}</div>`);
  if (signature.showLogo && context.logoUrl) lines.push(`<div style="margin:16px 0 10px"><img src="${escape(context.logoUrl)}" alt="" width="110" style="display:block;width:110px;max-width:110px;height:auto;border:0"></div>`);
  const company = signature.showCompany ? companyLines(context.companyFooter) : [];
  const contact: string[] = [];
  if (signature.phone) contact.push(`Telefon: ${escape(signature.phone)}`);
  if (signature.email) contact.push(`E-Mail: <a href="mailto:${escape(signature.email)}" style="color:#1d4ed8">${escape(signature.email)}</a>`);
  if (signature.website) contact.push(`Webseite: <a href="${escape(websiteHref(signature.website))}" style="color:#1d4ed8">${escape(websiteLabel(signature.website))}</a>`);
  if (company.length || contact.length) {
    lines.push(`<div style="margin-top:${signature.showLogo && context.logoUrl ? 0 : 14}px;color:#475467">`);
    company.forEach((line, index) => lines.push(`<div${index === 0 ? ' style="font-weight:700;color:#101828"' : ""}>${escape(line)}</div>`));
    contact.forEach((line) => lines.push(`<div>${line}</div>`));
    lines.push(`</div>`);
  }
  lines.push(`</div>`);
  return lines.join("");
}

/** Textfassung für Mailprogramme ohne HTML. */
export function renderSignatureText(signature: MailSignature, context: SignatureContext = {}): string {
  if (!hasSignatureContent(signature, context)) return "";
  const out: string[] = ["", "-- "];
  if (signature.greeting) out.push(signature.greeting);
  if (signature.name) out.push(`${signature.name}${signature.role ? ` · ${signature.role}` : ""}`);
  const company = signature.showCompany ? companyLines(context.companyFooter) : [];
  if (company.length || signature.phone || signature.email || signature.website) out.push("");
  out.push(...company);
  if (signature.phone) out.push(`Telefon: ${signature.phone}`);
  if (signature.email) out.push(`E-Mail: ${signature.email}`);
  if (signature.website) out.push(`Webseite: ${websiteLabel(signature.website)}`);
  return out.join("\n");
}

/** Anhänge: Grenzen, die Mailserver und Brevo problemlos schlucken. */
export const ATTACHMENT_LIMITS = { maxFiles: 5, maxFileBytes: 7 * 1024 * 1024, maxTotalBytes: 15 * 1024 * 1024 };
export type MailAttachmentInput = { filename: string; contentType: string; contentBase64: string; size: number };
export function checkAttachments(files: MailAttachmentInput[]): string | null {
  if (files.length > ATTACHMENT_LIMITS.maxFiles) return `Höchstens ${ATTACHMENT_LIMITS.maxFiles} Anhänge je E-Mail.`;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const big = files.find((file) => file.size > ATTACHMENT_LIMITS.maxFileBytes);
  if (big) return `„${big.filename}“ ist zu groß (max. ${Math.round(ATTACHMENT_LIMITS.maxFileBytes / 1024 / 1024)} MB je Datei).`;
  if (total > ATTACHMENT_LIMITS.maxTotalBytes) return `Alle Anhänge zusammen dürfen höchstens ${Math.round(ATTACHMENT_LIMITS.maxTotalBytes / 1024 / 1024)} MB haben.`;
  if (files.some((file) => !file.filename.trim())) return "Ein Anhang hat keinen Dateinamen.";
  return null;
}
export const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
