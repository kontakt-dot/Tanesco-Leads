/**
 * Webseite eines Kontakts – für den Knopf „Webseite öffnen“ auf der Pipeline-Karte und der Lead-Seite sowie für die KI-Entwürfe.
 * Quelle: die Daten aus der Liste (Feld „Webseite“, „Homepage“, „URL“ …) – sonst die Firmen-Adresse (info@firma.de → firma.de; nicht Gmail, GMX usw.).
 */
import { extraFieldsOf } from "./cold-list";

/** Freemail-Anbieter: deren Domain ist nie die Webseite der Firma. */
export const FREEMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com", "gmx.de", "gmx.net", "gmx.at", "gmx.ch", "web.de", "t-online.de", "outlook.com", "outlook.de", "hotmail.com", "hotmail.de", "live.com", "live.de", "msn.com", "yahoo.com", "yahoo.de", "icloud.com", "me.com", "mac.com", "aol.com", "aol.de", "posteo.de", "mailbox.org", "freenet.de", "arcor.de", "online.de", "1und1.de", "ionos.de", "proton.me", "protonmail.com", "vodafone.de", "kabelmail.de", "email.de"]);
export const emailDomainOf = (email: string) => { const at = email.lastIndexOf("@"); return at > 0 ? email.slice(at + 1).trim().toLowerCase() : null; };
export const isFreemailDomain = (domain: string) => FREEMAIL_DOMAINS.has(domain.toLowerCase());
/** Spaltennamen, unter denen Listen die Webseite mitbringen. */
export const WEBSITE_KEY_RE = /^(web ?(site|seite)?|homepage|internet(seite)?|url|domain)$/i;

export function websiteOf(metadata: unknown, email: string | null | undefined): string | null {
  const meta = (metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}) as Record<string, unknown>;
  const direct = [meta.website, meta.webseite, meta.homepage].find((value) => typeof value === "string" && value.trim()) as string | undefined;
  const fromFields = Object.entries(extraFieldsOf(metadata)).find(([key, value]) => WEBSITE_KEY_RE.test(key.trim()) && value.trim())?.[1];
  const value = (direct ?? fromFields ?? "").trim(); if (value && /[a-z0-9-]+\.[a-z]{2,}/i.test(value)) return value.replace(/\s+/g, "");
  const domain = email ? emailDomainOf(email) : null; return domain && !isFreemailDomain(domain) ? domain : null;
}

/**
 * Link zum Öffnen: „firma.de“ → „https://firma.de/“. Nur http/https mit richtiger Domain – alles andere (javascript:, mailto:,
 * Tippfehler ohne Domain) gibt null, damit aus einer Liste nie etwas anderes als eine Webseite geöffnet wird.
 */
export function websiteHref(site: string | null | undefined): string | null {
  const value = (site ?? "").trim().replace(/\s+/g, ""); if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : /^[a-z][a-z0-9+.-]*:/i.test(value) ? null : `https://${value.replace(/^\/+/, "")}`;
  if (!withScheme) return null;
  try { const url = new URL(withScheme); if (url.protocol !== "http:" && url.protocol !== "https:") return null; if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || url.username || url.password) return null; return url.toString(); } catch { return null; }
}
/** Anzeige im Hinweis: „https://www.firma.de/“ → „firma.de“. */
export const websiteLabel = (site: string) => site.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
/** Webseite eines Kontakts als Link (oder null). */
export const websiteLinkOf = (metadata: unknown, email: string | null | undefined) => websiteHref(websiteOf(metadata, email));
