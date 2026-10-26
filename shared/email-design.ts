/** E-Mail-Builder: Bausteine + Design → fertiges, responsives E-Mail-HTML (Tabellenlayout, Inline-Styles) und Textfassung. */
export type EmailBlock =
  | { id: string; type: "heading"; text: string; align?: "left" | "center" }
  | { id: string; type: "text"; text: string; align?: "left" | "center" }
  | { id: string; type: "image"; url: string; alt?: string; width?: number; link?: string }
  | { id: string; type: "button"; text: string; url: string; align?: "left" | "center" }
  | { id: string; type: "divider" }
  | { id: string; type: "spacer"; height?: number }
  | { id: string; type: "bullets"; items: string[] }
  | { id: string; type: "signature"; name: string; role?: string; phone?: string };
/**
 * `plain` = persönlicher Versand: ohne Logo, ohne Kasten, ohne farbigen Knopf und ohne Messung.
 * Solche E-Mails sehen aus wie von Hand geschrieben und landen bei Gmail viel seltener im Reiter „Werbung“.
 */
export type EmailDesign = { primaryColor: string; textColor: string; background: string; cardBackground: string; font: string; logoUrl?: string | null; logoHeight?: number; footerText?: string; footerReset?: number; /* 1 = Fußzeile wurde bewusst gesetzt oder einmalig geleert – nicht noch einmal anfassen */ unsubscribeText?: string; buttonRadius?: number; plain?: boolean; signature?: boolean /* Signatur aus den E-Mail-Einstellungen anhängen (Standard: ja) */ };
/** Hängt die Kampagne die Signatur aus den E-Mail-Einstellungen an? Fehlt die Angabe, ja. */
export const usesSignature = (design: Partial<EmailDesign> | null | undefined) => design?.signature !== false;
/**
 * Anbieterzeile für alle ausgehenden Nachrichten – Fußzeile im E-Mail-Builder, Signaturen, Willkommens- und
 * Systemmails. An einer Stelle gepflegt, damit eine Änderung überall gilt.
 */
export const COMPANY_FOOTER = "Tanesco Digital GbR · Schultheißweg 44 · 55252 Wiesbaden";
/** Webseite und Terminbuchung – stehen in jeder Fußzeile und werden automatisch verlinkt. Unter Einstellungen → Branding änderbar. */
export const COMPANY_WEBSITE = "https://tanescodigital.de";
export const COMPANY_APPOINTMENT_URL = "";
/**
 * Links in der Fußzeile. Zwei Schreibweisen:
 *  • eigener Text: [Unsere Webseite](https://tanescodigital.de) – der Text steht da, dahinter liegt die Adresse
 *  • blanke Adresse: „https://…“ oder „tanescodigital.de“ wird von selbst anklickbar
 * Läuft auf bereits maskiertem HTML, erzeugt also nur die Links und nichts anderes.
 */
export function linkifyFooter(html: string) {
  // Zuerst die Schreibweise mit eigenem Text, damit die Adresse darin nicht noch einmal verlinkt wird.
  const withLabels = html.replace(/\[([^\]\n]{1,80})\]\(\s*((?:https?:\/\/|mailto:|tel:)?[^\s)]{3,300})\s*\)/g, (_match, label: string, url: string) => {
    const clean = url.replace(/&amp;/g, "&").trim();
    const href = /^(https?:\/\/|mailto:|tel:)/i.test(clean) ? clean : `https://${clean}`;
    // Noch keine Adresse eingetragen (z. B. „https://“ aus dem Einfügen-Knopf): nur den Text zeigen, keinen toten Link bauen.
    const rest = href.replace(/^(https?:\/\/|mailto:|tel:)/i, "").trim();
    if (!rest || (/^https?:/i.test(href) && !rest.includes("."))) return label;
    return `<a href="${href.replace(/"/g, "&quot;")}" style="color:inherit;text-decoration:underline">${label}</a>`;
  });
  return withLabels.replace(/(https?:\/\/[^\s<>"]+|(?:^|[\s>·])((?:[a-z0-9-]+\.)+(?:de|com|net|org|eu|at|ch|io))(?=$|[\s<·,]))/gi, (match, _all, bare) => {
    const lead = bare && !match.startsWith(bare) ? match.slice(0, match.indexOf(bare)) : "";
    const target = (bare ?? match).trim(); if (!target) return match;
    const href = /^https?:\/\//i.test(target) ? target : `https://${target}`;
    const label = target.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    return `${lead}<a href="${href}" style="color:inherit;text-decoration:underline">${label}</a>`;
  });
}
/** Fußzeile aus Anschrift, Webseite und (falls hinterlegt) Terminlink zusammensetzen. */
export const companyFooterText = (options: { footer?: string | null; website?: string | null; appointment?: string | null } = {}) => {
  const address = (options.footer ?? COMPANY_FOOTER).trim();
  const website = (options.website ?? COMPANY_WEBSITE).trim();
  const appointment = (options.appointment ?? COMPANY_APPOINTMENT_URL).trim();
  const line = [website, appointment].filter(Boolean).join(" · ");
  return [address, line].filter(Boolean).join("\n");
};
/** Platzhalter für das Tanesco-Logo – wird beim Versand durch die öffentliche Adresse ersetzt (APP_URL + Pfad), in der Vorschau durch die eingebettete Datei. */
export const TANESCO_LOGO_PATH = "/brand/tanesco-logo-mail.png";
export const DEFAULT_DESIGN: EmailDesign = { primaryColor: "#bc001d", textColor: "#101828", background: "#f3f4f6", cardBackground: "#ffffff", font: "Inter, Helvetica, Arial, sans-serif", logoUrl: TANESCO_LOGO_PATH, logoHeight: 40, footerText: "", /* Fußzeile standardmäßig leer – Anschrift und Gruß bringt die Signatur mit; unter Einstellungen → Branding lässt sich eine Fußzeile auf Wunsch auf alle Kampagnen anwenden */ unsubscribeText: "Hier abmelden", buttonRadius: 10 };
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Platzhalter: {{vorname}}, {{nachname}}, {{anrede}}, {{firma}}, {{stadt}}, {{abmelden}} … */
export function fillPlaceholders(text: string, values: Record<string, string | null | undefined>) { return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => values[key] ?? values[key.toLowerCase()] ?? ""); }
export function renderEmailHtml(blocks: EmailBlock[], design: EmailDesign, values: Record<string, string | null | undefined> = {}, options: { trackingPixelUrl?: string | null; wrapLink?: (url: string) => string; unsubscribeUrl?: string | null; logoBase?: string | null; preview?: boolean; signatureHtml?: string | null } = {}) {
  const d = { ...DEFAULT_DESIGN, ...design }; const fill = (text: string) => escapeHtml(fillPlaceholders(text, values)).replace(/\n/g, "<br>"); const link = (url: string) => (options.wrapLink ? options.wrapLink(url) : url);
  const logoSrc = d.logoUrl ? (d.logoUrl.startsWith("/") ? `${(options.logoBase ?? "").replace(/\/+$/, "")}${d.logoUrl}` : d.logoUrl) : null;
  const unsubscribeLink = options.unsubscribeUrl ? `<a href="${escapeHtml(options.unsubscribeUrl)}" style="color:#6a7282;text-decoration:underline">${escapeHtml(d.unsubscribeText || "Hier abmelden")}</a>` : `<span style="text-decoration:underline">${escapeHtml(d.unsubscribeText || "Hier abmelden")}</span>`;
  // Signatur aus den E-Mail-Einstellungen: ersetzt einen von Hand gesetzten Signatur-Baustein und kommt immer ans Ende des Inhalts.
  const signature = usesSignature(d) && options.signatureHtml ? options.signatureHtml : "";
  const parts = blocks.filter((block) => !(signature && block.type === "signature")).map((block) => {
    switch (block.type) {
      case "heading": return d.plain ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;font-weight:600;color:${d.textColor}">${fill(block.text)}</p>` : `<h1 style="margin:0 0 14px;font-size:24px;line-height:1.3;font-weight:800;color:${d.textColor};text-align:${block.align ?? "left"}">${fill(block.text)}</h1>`;
      case "text": return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${d.textColor};text-align:${block.align ?? "left"}">${fill(block.text)}</p>`;
      case "image": return `<div style="margin:0 0 16px;text-align:center">${block.link ? `<a href="${escapeHtml(link(block.link))}">` : ""}<img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt ?? "")}" width="${block.width ?? 560}" style="max-width:100%;height:auto;border-radius:10px;display:inline-block">${block.link ? "</a>" : ""}</div>`;
      case "button": return d.plain
        ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${d.textColor}"><a href="${escapeHtml(link(fillPlaceholders(block.url, values)))}" style="color:${d.textColor};text-decoration:underline">${fill(block.text)}</a></p>`
        : `<div style="margin:6px 0 18px;text-align:${block.align ?? "center"}"><a href="${escapeHtml(link(fillPlaceholders(block.url, values)))}" style="display:inline-block;padding:13px 26px;border-radius:${d.buttonRadius ?? 10}px;background:${d.primaryColor};color:#ffffff;font-weight:700;font-size:15px;text-decoration:none">${fill(block.text)}</a></div>`;
      case "divider": return `<hr style="border:0;border-top:1px solid #e5e7eb;margin:16px 0">`;
      case "spacer": return `<div style="height:${block.height ?? 16}px"></div>`;
      case "bullets": return `<ul style="margin:0 0 14px;padding-left:20px;color:${d.textColor};font-size:15px;line-height:1.6">${block.items.map((item) => `<li>${fill(item)}</li>`).join("")}</ul>`;
      case "signature": return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 0"><tr><td style="${d.plain ? "" : `border-left:3px solid ${d.primaryColor};padding-left:12px`}"><strong style="color:${d.textColor};font-size:15px">${fill(block.name)}</strong>${block.role ? `<br><span style="color:#6a7282;font-size:13px">${fill(block.role)}</span>` : ""}${block.phone ? `<br><span style="color:#6a7282;font-size:13px">${escapeHtml(block.phone)}</span>` : ""}</td></tr></table>`;
      default: return "";
    }
  }).join("") + signature;
  const logo = logoSrc && !d.plain ? `<div style="padding:0 0 18px;text-align:left"><img src="${escapeHtml(logoSrc)}" alt="Tanesco" height="${d.logoHeight ?? 40}" style="height:${d.logoHeight ?? 40}px;width:auto;display:block"></div>` : "";
  const footer = d.footerText ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#6a7282;text-align:${d.plain ? "left" : "center"}">${linkifyFooter(escapeHtml(fillPlaceholders(d.footerText, { ...values, abmelden: "\u0000ABMELDEN\u0000" })).replace(/\n/g, "<br>")).replace(/\u0000ABMELDEN\u0000/g, unsubscribeLink)}</p>` : "";
  const previewCss = options.preview ? `<style>a{pointer-events:none}</style>` : "";
  const pixel = options.trackingPixelUrl && !d.plain ? `<img src="${escapeHtml(options.trackingPixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : "";
  if (d.plain) return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title></title>${previewCss}</head><body style="margin:0;padding:0;background:#ffffff;font-family:${d.font};font-size:15px;line-height:1.6;color:${d.textColor}"><div style="max-width:600px;margin:0 auto;padding:18px 16px">${parts}${footer}</div></body></html>`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title></title>${previewCss}</head><body style="margin:0;padding:0;background:${d.background};font-family:${d.font}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${d.background}"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%"><tr><td style="background:${d.cardBackground};border-radius:16px;padding:32px 30px;box-shadow:0 8px 30px rgba(0,0,0,.06)">${logo}${parts}</td></tr><tr><td>${footer}</td></tr></table>${pixel}</td></tr></table></body></html>`;
}
export function renderEmailText(blocks: EmailBlock[], values: Record<string, string | null | undefined> = {}, signatureText?: string | null) {
  return (signatureText ? blocks.filter((block) => block.type !== "signature") : blocks).map((block) => { switch (block.type) { case "heading": return fillPlaceholders(block.text, values).toUpperCase(); case "text": return fillPlaceholders(block.text, values); case "button": return `${fillPlaceholders(block.text, values)}: ${fillPlaceholders(block.url, values)}`; case "bullets": return block.items.map((item) => `• ${fillPlaceholders(item, values)}`).join("\n"); case "signature": return [block.name, block.role, block.phone].filter(Boolean).join(" · "); case "image": return block.alt ?? ""; default: return ""; } }).filter(Boolean).join("\n\n") + (signatureText ? `\n${signatureText}` : "");
}
export const newBlockId = () => `b${Math.random().toString(36).slice(2, 8)}`;
export function starterBlocks(kind: "kaltakquise" | "nachfassen" | "angebot" | "aufwecken" | "leer" = "kaltakquise"): EmailBlock[] {
  if (kind === "leer") return [];
  const signature = (): EmailBlock => ({ id: newBlockId(), type: "signature", name: "Ihr Tanesco-Team", role: "Vertrieb", phone: "+49 69 000000" });
  if (kind === "angebot") return [{ id: newBlockId(), type: "heading", text: "Noch Fragen zu unserem Angebot?" }, { id: newBlockId(), type: "text", text: "{{begruessung}},\n\nvor ein paar Tagen haben Sie unser Angebot erhalten. Gern gehe ich offene Punkte mit Ihnen durch oder passe das Angebot an Ihre Wünsche an." }, { id: newBlockId(), type: "bullets", items: ["Festpreis ohne versteckte Kosten", "Start innerhalb von 14 Tagen möglich", "Persönlicher Ansprechpartner"] }, { id: newBlockId(), type: "text", text: "Wenn Sie mögen, {{kontaktweg}}.\n\nVielen Dank" }, signature()];
  if (kind === "aufwecken") return [{ id: newBlockId(), type: "heading", text: "Passt es gerade nicht?" }, { id: newBlockId(), type: "text", text: "{{begruessung}},\n\nwir hatten vor einiger Zeit Kontakt – seitdem ist es ruhig geworden. Falls das Thema noch aktuell ist, melde ich mich gern mit einem kurzen Update. Wenn nicht, sagen Sie einfach kurz Bescheid.\n\nWenn es passt, {{kontaktweg}}.\n\nVielen Dank" }, signature()];
  if (kind === "nachfassen") return [{ id: newBlockId(), type: "heading", text: "Kurz nachgefragt: Anfragen für {{firma}}" }, { id: newBlockId(), type: "text", text: "{{begruessung}},\n\nich wollte sicherstellen, dass meine letzte E-Mail nicht untergegangen ist. Das Angebot steht weiterhin: 20 Test-Leads kostenlos, individuell für Ihren Betrieb telefonisch qualifiziert – ohne Vorkasse und ohne lange Bindung.\n\nLassen Sie uns gerne kurz sprechen: {{kontaktweg}}.\n\nVielen Dank" }, signature()];
  return [{ id: newBlockId(), type: "heading", text: "Mehr qualifizierte Anfragen für {{firma}}" }, { id: newBlockId(), type: "text", text: "{{begruessung}},\n\nwir von Tanesco Digital gehören zu den größten Lead-Lieferanten in Deutschland für Photovoltaik und Wärmepumpen. Unsere Anfragen werden in der Regel anhand von zehn Fragen telefonisch vorqualifiziert, sodass der Interessent weiß, dass sich ein Fachbetrieb bei ihm meldet – und gehen exklusiv und in Echtzeit an Sie." }, { id: newBlockId(), type: "bullets", items: ["20 Test-Leads kostenlos – individuell für Ihren Betrieb telefonisch qualifiziert", "Exklusiv, keine Vorkasse, keine lange Vertragsbindung", "Übergabe in Echtzeit per Schnittstelle"] }, { id: newBlockId(), type: "text", text: "Wenn das für Sie interessant ist, {{kontaktweg}}.\n\nVielen Dank" }, signature()];
}
