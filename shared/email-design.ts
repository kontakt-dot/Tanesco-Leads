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
export type EmailDesign = { primaryColor: string; textColor: string; background: string; cardBackground: string; font: string; logoUrl?: string | null; logoHeight?: number; footerText?: string; unsubscribeText?: string; buttonRadius?: number };
/** Platzhalter für das Tanesco-Logo – wird beim Versand durch die öffentliche Adresse ersetzt (APP_URL + Pfad), in der Vorschau durch die eingebettete Datei. */
export const TANESCO_LOGO_PATH = "/brand/tanesco-logo-mail.png";
export const DEFAULT_DESIGN: EmailDesign = { primaryColor: "#bc001d", textColor: "#101828", background: "#f3f4f6", cardBackground: "#ffffff", font: "Inter, Helvetica, Arial, sans-serif", logoUrl: TANESCO_LOGO_PATH, logoHeight: 40, footerText: "Tanesco Digital GmbH · Musterstraße 1 · 60311 Frankfurt am Main\nDu erhältst diese E-Mail, weil du dich für unser Angebot interessiert hast. {{abmelden}}", unsubscribeText: "Hier abmelden", buttonRadius: 10 };
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Platzhalter: {{vorname}}, {{nachname}}, {{anrede}}, {{firma}}, {{stadt}}, {{abmelden}} … */
export function fillPlaceholders(text: string, values: Record<string, string | null | undefined>) { return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => values[key] ?? values[key.toLowerCase()] ?? ""); }
export function renderEmailHtml(blocks: EmailBlock[], design: EmailDesign, values: Record<string, string | null | undefined> = {}, options: { trackingPixelUrl?: string | null; wrapLink?: (url: string) => string; unsubscribeUrl?: string | null; logoBase?: string | null; preview?: boolean } = {}) {
  const d = { ...DEFAULT_DESIGN, ...design }; const fill = (text: string) => escapeHtml(fillPlaceholders(text, values)).replace(/\n/g, "<br>"); const link = (url: string) => (options.wrapLink ? options.wrapLink(url) : url);
  const logoSrc = d.logoUrl ? (d.logoUrl.startsWith("/") ? `${(options.logoBase ?? "").replace(/\/+$/, "")}${d.logoUrl}` : d.logoUrl) : null;
  const unsubscribeLink = options.unsubscribeUrl ? `<a href="${escapeHtml(options.unsubscribeUrl)}" style="color:#6a7282;text-decoration:underline">${escapeHtml(d.unsubscribeText || "Hier abmelden")}</a>` : `<span style="text-decoration:underline">${escapeHtml(d.unsubscribeText || "Hier abmelden")}</span>`;
  const parts = blocks.map((block) => {
    switch (block.type) {
      case "heading": return `<h1 style="margin:0 0 14px;font-size:24px;line-height:1.3;font-weight:800;color:${d.textColor};text-align:${block.align ?? "left"}">${fill(block.text)}</h1>`;
      case "text": return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${d.textColor};text-align:${block.align ?? "left"}">${fill(block.text)}</p>`;
      case "image": return `<div style="margin:0 0 16px;text-align:center">${block.link ? `<a href="${escapeHtml(link(block.link))}">` : ""}<img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt ?? "")}" width="${block.width ?? 560}" style="max-width:100%;height:auto;border-radius:10px;display:inline-block">${block.link ? "</a>" : ""}</div>`;
      case "button": return `<div style="margin:6px 0 18px;text-align:${block.align ?? "center"}"><a href="${escapeHtml(link(fillPlaceholders(block.url, values)))}" style="display:inline-block;padding:13px 26px;border-radius:${d.buttonRadius ?? 10}px;background:${d.primaryColor};color:#ffffff;font-weight:700;font-size:15px;text-decoration:none">${fill(block.text)}</a></div>`;
      case "divider": return `<hr style="border:0;border-top:1px solid #e5e7eb;margin:16px 0">`;
      case "spacer": return `<div style="height:${block.height ?? 16}px"></div>`;
      case "bullets": return `<ul style="margin:0 0 14px;padding-left:20px;color:${d.textColor};font-size:15px;line-height:1.6">${block.items.map((item) => `<li>${fill(item)}</li>`).join("")}</ul>`;
      case "signature": return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 0"><tr><td style="border-left:3px solid ${d.primaryColor};padding-left:12px"><strong style="color:${d.textColor};font-size:15px">${fill(block.name)}</strong>${block.role ? `<br><span style="color:#6a7282;font-size:13px">${fill(block.role)}</span>` : ""}${block.phone ? `<br><span style="color:#6a7282;font-size:13px">${escapeHtml(block.phone)}</span>` : ""}</td></tr></table>`;
      default: return "";
    }
  }).join("");
  const logo = logoSrc ? `<div style="padding:0 0 18px;text-align:left"><img src="${escapeHtml(logoSrc)}" alt="Tanesco" height="${d.logoHeight ?? 40}" style="height:${d.logoHeight ?? 40}px;width:auto;display:block"></div>` : "";
  const footer = d.footerText ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#6a7282;text-align:center">${escapeHtml(fillPlaceholders(d.footerText, { ...values, abmelden: "\u0000ABMELDEN\u0000" })).replace(/\n/g, "<br>").replace(/\u0000ABMELDEN\u0000/g, unsubscribeLink)}</p>` : "";
  const previewCss = options.preview ? `<style>a{pointer-events:none}</style>` : "";
  const pixel = options.trackingPixelUrl ? `<img src="${escapeHtml(options.trackingPixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : "";
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title></title>${previewCss}</head><body style="margin:0;padding:0;background:${d.background};font-family:${d.font}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${d.background}"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%"><tr><td style="background:${d.cardBackground};border-radius:16px;padding:32px 30px;box-shadow:0 8px 30px rgba(0,0,0,.06)">${logo}${parts}</td></tr><tr><td>${footer}</td></tr></table>${pixel}</td></tr></table></body></html>`;
}
export function renderEmailText(blocks: EmailBlock[], values: Record<string, string | null | undefined> = {}) {
  return blocks.map((block) => { switch (block.type) { case "heading": return fillPlaceholders(block.text, values).toUpperCase(); case "text": return fillPlaceholders(block.text, values); case "button": return `${fillPlaceholders(block.text, values)}: ${fillPlaceholders(block.url, values)}`; case "bullets": return block.items.map((item) => `• ${fillPlaceholders(item, values)}`).join("\n"); case "signature": return [block.name, block.role, block.phone].filter(Boolean).join(" · "); case "image": return block.alt ?? ""; default: return ""; } }).filter(Boolean).join("\n\n");
}
export const newBlockId = () => `b${Math.random().toString(36).slice(2, 8)}`;
export function starterBlocks(kind: "kaltakquise" | "nachfassen" | "angebot" | "aufwecken" | "leer" = "kaltakquise"): EmailBlock[] {
  if (kind === "leer") return [];
  if (kind === "angebot") return [{ id: newBlockId(), type: "heading", text: "Noch Fragen zu unserem Angebot, {{vorname}}?" }, { id: newBlockId(), type: "text", text: "Guten Tag {{anrede}} {{nachname}},\n\nvor ein paar Tagen haben Sie unser Angebot erhalten. Gern gehe ich offene Punkte mit Ihnen durch oder passe das Angebot an Ihre Wünsche an." }, { id: newBlockId(), type: "bullets", items: ["Festpreis ohne versteckte Kosten", "Start innerhalb von 14 Tagen möglich", "Persönlicher Ansprechpartner"] }, { id: newBlockId(), type: "button", text: "Rückruf vereinbaren", url: "https://tanesco.digital/termin" }, { id: newBlockId(), type: "signature", name: "Ihr Tanesco-Team", role: "Vertrieb", phone: "+49 69 000000" }];
  if (kind === "aufwecken") return [{ id: newBlockId(), type: "heading", text: "Passt es gerade nicht, {{vorname}}?" }, { id: newBlockId(), type: "text", text: "Guten Tag {{anrede}} {{nachname}},\n\nwir hatten vor einiger Zeit Kontakt – seitdem ist es ruhig geworden. Falls das Thema noch aktuell ist, melde ich mich gern mit einem kurzen Update. Wenn nicht, sagen Sie einfach kurz Bescheid." }, { id: newBlockId(), type: "button", text: "Kurz Rückmeldung geben", url: "https://tanesco.digital/termin" }, { id: newBlockId(), type: "signature", name: "Ihr Tanesco-Team", role: "Vertrieb", phone: "+49 69 000000" }];
  if (kind === "nachfassen") return [{ id: newBlockId(), type: "heading", text: "Kurz nachgefragt, {{vorname}}" }, { id: newBlockId(), type: "text", text: "ich wollte sicherstellen, dass meine letzte E-Mail nicht untergegangen ist. Hätten Sie diese Woche 15 Minuten für ein kurzes Gespräch?" }, { id: newBlockId(), type: "button", text: "Termin vorschlagen", url: "https://tanesco.digital/termin" }, { id: newBlockId(), type: "signature", name: "Ihr Tanesco-Team", role: "Vertrieb", phone: "+49 69 000000" }];
  return [{ id: newBlockId(), type: "heading", text: "Mehr qualifizierte Anfragen für {{firma}}" }, { id: newBlockId(), type: "text", text: "Guten Tag {{anrede}} {{nachname}},\n\nwir liefern geprüfte Kundenanfragen aus Ihrer Region – exklusiv, telefonisch bestätigt und mit Vor-Ort-Termin. Kein Risiko: Sie zahlen nur für Anfragen, die Sie erreichen." }, { id: newBlockId(), type: "bullets", items: ["Anfragen exklusiv in Ihrer Region", "Telefonisch vorqualifiziert", "Reklamation innerhalb von 48 Stunden"] }, { id: newBlockId(), type: "button", text: "Kostenloses Erstgespräch", url: "https://tanesco.digital/termin" }, { id: newBlockId(), type: "signature", name: "Ihr Tanesco-Team", role: "Vertrieb", phone: "+49 69 000000" }];
}
