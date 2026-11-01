/**
 * Einwilligungsnachweis als PDF (jsPDF – läuft im Browser und auf dem Server): wer, was, wann, wie (§ 7a UWG, Auslegungshinweise der
 * Bundesnetzagentur), dazu die zitierte Stelle aus dem Gespräch, Prüfung der Pflichtbestandteile, SMS-Bestätigung, Verwendungen,
 * Widerruf, Aufbewahrung und Prüfsumme. Keine Abschrift im Ganzen – nur die Einwilligungsstelle.
 */
import { jsPDF } from "jspdf";
import { CHECK_KEYS, CHECK_LABEL, OPT_IN_GRANTEE_LABEL, OPT_IN_KIND_LABEL, OPT_IN_STATUS_LABEL, RETENTION_YEARS, type OptInChecks, type OptInGrantee, type OptInKind, type OptInStatus, type OptInUsage } from "./opt-in";

export type ProofOptIn = { number: string; kind: OptInKind; status: OptInStatus; grantedTo: OptInGrantee; buyerName: string | null; companyName: string | null; consentText: string; channels: string | null; givenAt: Date | string | null; collectedBy: string | null; source: unknown; recordingUrl: string | null; recordingStartSec: number | null; recordingEndSec: number | null; quote: string | null; checks: OptInChecks | null; missing: string[]; warning: string | null; attest: { aufnahme?: boolean; ja?: boolean; note?: string | null; at?: string } | null; smsPhone: string | null; smsSentAt: Date | string | null; confirmedAt: Date | string | null; confirmIp: string | null; revokedAt: Date | string | null; revokeNote: string | null; usages: OptInUsage[]; lastUsedAt: Date | string | null; retainUntil: Date | string | null; hash: string | null; createdAt: Date | string };
export type ProofLead = { name: string; publicId: string; phone: string | null; email: string | null; street: string | null; postcode: string | null; city: string | null; category: string | null };
export type ProofCompany = { name: string; address: string; revokeEmail: string; privacyUrl: string };

const PAGE = { width: 210, height: 297, margin: 20 };
const FONT = { body: 10.5, heading: 13, title: 18, small: 8.5 };
const stamp = (value: Date | string | null | undefined) => (value ? new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }) + " Uhr" : "–");
const day = (value: Date | string | null | undefined) => (value ? new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" }) : "–");
const seconds = (value: number | null | undefined) => (value === null || value === undefined ? null : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")} min`);

export function buildOptInPdf(input: { optIn: ProofOptIn; lead: ProofLead; company: ProofCompany }): ArrayBuffer {
  const { optIn, lead, company } = input;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const width = PAGE.width - PAGE.margin * 2; let y = PAGE.margin;
  const ensure = (needed: number) => { if (y + needed > PAGE.height - PAGE.margin) { doc.addPage(); y = PAGE.margin; } };
  const text = (value: string, size = FONT.body, style: "normal" | "bold" | "italic" = "normal", color: [number, number, number] = [16, 24, 40], indent = 0) => {
    doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(value, width - indent) as string[]; const lineHeight = size * 0.3527 * 1.45;
    for (const line of lines) { ensure(lineHeight); doc.text(line, PAGE.margin + indent, y); y += lineHeight; }
  };
  const gap = (mm: number) => { y += mm; };
  const heading = (value: string) => { gap(3); text(value, FONT.heading, "bold"); gap(1.5); };
  const row = (label: string, value: string | null | undefined) => { if (!value) return; text(`${label}: ${value}`); };
  const rule = () => { ensure(3); doc.setDrawColor(200, 200, 210); doc.setLineWidth(0.3); doc.line(PAGE.margin, y, PAGE.margin + width, y); gap(3); };

  text("Einwilligungsnachweis", FONT.title, "bold"); gap(1);
  text(`${optIn.number} · ${OPT_IN_KIND_LABEL[optIn.kind]} · Status: ${OPT_IN_STATUS_LABEL[optIn.status]}`, FONT.body, "normal", [90, 90, 110]); gap(2);
  text(`Dokumentation einer Werbeeinwilligung nach § 7 Abs. 2 Nr. 1 und § 7a UWG – erstellt von ${company.name || optIn.companyName || "–"}${company.address ? `, ${company.address}` : ""}.`, FONT.small, "normal", [90, 90, 110]);
  gap(3); rule();

  heading("Wer");
  row("Einwilligende Person", `${lead.name}${lead.publicId ? ` (Lead ${lead.publicId})` : ""}`);
  row("Anschrift", [lead.street, [lead.postcode, lead.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null);
  row("Telefon", lead.phone); row("E-Mail", lead.email);
  row("Einholendes Unternehmen", `${company.name || optIn.companyName || "–"}${company.address ? `, ${company.address}` : ""}`);
  row("Einwilligung gilt", optIn.grantedTo === "kaeufer" ? `für den Fachbetrieb${optIn.buyerName ? ` „${optIn.buyerName}“` : " (Ersatzformulierung – Name per SMS mitgeteilt)"}` : OPT_IN_GRANTEE_LABEL[optIn.grantedTo]);
  row("Anfrage", lead.category);
  row("Eingeholt durch", optIn.collectedBy);

  heading("Was");
  text(optIn.consentText, FONT.body, "italic", [40, 40, 60], 3);
  row("Kanäle", optIn.channels);

  heading("Wann und wie");
  row("Erteilt am", stamp(optIn.givenAt));
  const source = (optIn.source ?? {}) as Record<string, unknown>;
  if (optIn.kind === "sprache") {
    row("Art", String(source.via) === "dialer" ? "Sprachaufnahme im Gespräch (nur der Einwilligungsabschnitt aufgezeichnet)" : "Sprachaufnahme – Einwilligungsstelle in der Gesprächsaufzeichnung");
    if (optIn.recordingStartSec !== null && optIn.recordingStartSec !== undefined) row("Stelle in der Aufnahme", `ab ${seconds(optIn.recordingStartSec)}${optIn.recordingEndSec !== null && optIn.recordingEndSec !== undefined ? ` bis ${seconds(optIn.recordingEndSec)}` : ""}`);
    row("Aufnahme", optIn.recordingUrl ? "liegt vor (Audio-Datei beim einholenden Unternehmen)" : "keine Audio-Datei");
    if (optIn.attest) row("Bestätigung des Agenten", `Zustimmung zur Aufnahme: ${optIn.attest.aufnahme ? "ja" : "nein"} · Eindeutiges Ja: ${optIn.attest.ja ? "ja" : "nein"}${optIn.attest.note ? ` · ${optIn.attest.note}` : ""}`);
  } else if (optIn.kind === "sms") {
    row("Art", "Bestätigung per SMS-Link");
    row("SMS an", optIn.smsPhone); row("SMS gesendet", stamp(optIn.smsSentAt));
    row("Bestätigt", optIn.confirmedAt ? `${stamp(optIn.confirmedAt)}${optIn.confirmIp ? ` · IP ${optIn.confirmIp}` : ""}` : "noch nicht bestätigt");
  } else {
    row("Art", `Online-Formular${source.formName ? ` „${String(source.formName)}“` : ""}${source.platform ? ` (${String(source.platform)})` : ""}`);
    const responses = Array.isArray(source.responses) ? (source.responses as Array<{ key: string; checked: boolean }>) : [];
    if (responses.length) row("Häkchen", responses.map((item) => `${item.key}: ${item.checked ? "gesetzt" : "nicht gesetzt"}`).join(" · "));
  }
  if (optIn.quote) { gap(1); text("Zitierte Stelle:", FONT.small, "bold", [90, 90, 110]); text(`„${optIn.quote}“`, FONT.body, "italic", [40, 40, 60], 3); }

  heading("Prüfung der Pflichtbestandteile");
  const checks = optIn.checks;
  for (const key of CHECK_KEYS) text(`${checks?.[key] ? "✓" : "✗"}  ${CHECK_LABEL[key]}`, FONT.body, "normal", checks?.[key] ? [21, 128, 61] : [185, 28, 28], 2);
  row("Geprüft durch", checks?.by === "ki" ? "KI-Prüfung der Abschrift" : checks?.by === "regeln" ? "Regelprüfung" : checks?.by === "agent" ? "Bestätigung des Agenten" : "noch nicht geprüft");
  if (optIn.warning) text(`Hinweis: ${optIn.warning}`, FONT.small, "italic", [180, 83, 9]);

  heading("Verwendung und Aufbewahrung");
  if (optIn.usages.length) for (const usage of optIn.usages.slice(-20)) text(`${stamp(usage.at)} – ${usage.kind === "zustellung" ? "Zustellung" : usage.kind === "angebot" ? "Angebot" : "Export"}${usage.buyerName ? ` an ${usage.buyerName}` : ""}`, FONT.body, "normal", [16, 24, 40], 2); else text("Noch keine Verwendung (Zustellung) protokolliert.", FONT.body, "normal", [90, 90, 110], 2);
  row("Letzte Verwendung", optIn.lastUsedAt ? stamp(optIn.lastUsedAt) : null);
  row("Aufbewahrung bis", `${day(optIn.retainUntil)} (${RETENTION_YEARS} Jahre ab Erteilung und nach jeder Verwendung neu)`);
  if (optIn.revokedAt) { gap(1); text(`WIDERRUFEN am ${stamp(optIn.revokedAt)}${optIn.revokeNote ? ` – ${optIn.revokeNote}` : ""}. Keine weitere Kontaktaufnahme auf Grundlage dieser Einwilligung.`, FONT.body, "bold", [185, 28, 28]); }
  row("Widerruf möglich", company.revokeEmail ? `jederzeit, z. B. per E-Mail an ${company.revokeEmail}` : "jederzeit");
  row("Datenschutzerklärung", company.privacyUrl || null);

  gap(4); rule();
  text(`Prüfsumme (SHA-256 über die unveränderlichen Angaben): ${optIn.hash ?? "–"}`, FONT.small, "normal", [90, 90, 110]);
  text(`Nachweis erstellt am ${stamp(new Date())} · Datensatz angelegt am ${stamp(optIn.createdAt)}`, FONT.small, "normal", [90, 90, 110]);
  return doc.output("arraybuffer");
}
