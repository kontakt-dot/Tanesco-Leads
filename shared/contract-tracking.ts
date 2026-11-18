/**
 * Verlauf eines Vertrags beim Kunden („Tracker“): Aus den protokollierten Ereignissen wird zusammengezählt, was passiert ist –
 * wann gesendet, ob und wie oft die E-Mail und der Vertrag geöffnet wurden, wie lange gelesen wurde, ob das PDF geladen wurde.
 * Eine Rechnung für Server und Demo; die Texte sind bewusst in einfacher Sprache.
 */
import type { ContractEventKind, ContractStatus } from "./contracts";
import { talkTimeText } from "./call-overview";

export type TrackSource = "mail" | "erinnerung" | "link";
export type TrackEvent = { kind: ContractEventKind; createdAt: Date | string; note?: string | null; ip?: string | null; userAgent?: string | null; source?: string | null; seconds?: number | null; depth?: number | null };
export type ContractTracking = {
  /** Versand: wie oft insgesamt gesendet, wann zuerst, wann zuletzt (Versand oder Erinnerung), Erinnerungen seit dem letzten Versand */
  sent: { count: number; firstAt: string | null; lastAt: string | null; reminders: number };
  /** E-Mail geöffnet (Zählbild) – „inferred“: kein Zählbild geladen, aber der Link aus der E-Mail wurde angeklickt */
  mail: { opens: number; firstAt: string | null; lastAt: string | null; inferred: boolean };
  /** Vertrag geöffnet = Link angeklickt; fromMail: wie viele Aufrufe über den Link aus E-Mail oder Erinnerung kamen */
  views: { count: number; firstAt: string | null; lastAt: string | null; fromMail: number; devices: string[] };
  /** Lesen: Sekunden über alle Aufrufe, tiefste Stelle (0–100 %), bis zum Ende gescrollt? */
  reading: { seconds: number; depth: number; reachedEnd: boolean };
  downloads: { count: number; lastAt: string | null };
};
/** Ab dieser Tiefe gilt der Vertrag als „bis zum Ende“ gelesen; unter dieser Lesezeit als „nur kurz angesehen“. */
export const READ_END_DEPTH = 90; export const READ_MIN_SECONDS = 20; export const READ_MAX_SECONDS = 4 * 3600;

const iso = (value: Date | string) => new Date(value).toISOString();
export const EMPTY_TRACKING: ContractTracking = { sent: { count: 0, firstAt: null, lastAt: null, reminders: 0 }, mail: { opens: 0, firstAt: null, lastAt: null, inferred: false }, views: { count: 0, firstAt: null, lastAt: null, fromMail: 0, devices: [] }, reading: { seconds: 0, depth: 0, reachedEnd: false }, downloads: { count: 0, lastAt: null } };

/**
 * Gerät und Programm in Worten: „iPhone, Safari“, „Windows-PC, Chrome“. Für die Liste der Geräte und den Verlauf –
 * das volle Browser-Kennzeichen bleibt im Nachweis gespeichert.
 */
export function deviceLabel(userAgent: string | null | undefined): string | null {
  const ua = (userAgent ?? "").trim(); if (!ua) return null;
  if (/googleimageproxy/i.test(ua)) return "Gmail";
  if (!/mozilla\/|applewebkit|gecko|outlook|thunderbird/i.test(ua)) return ua.slice(0, 40); // schon lesbar gespeichert (z. B. „Safari 17 · macOS“)
  const device = /iphone/i.test(ua) ? "iPhone" : /ipad/i.test(ua) ? "iPad" : /android/i.test(ua) ? (/mobile/i.test(ua) ? "Android-Handy" : "Android-Tablet") : /windows/i.test(ua) ? "Windows-PC" : /macintosh|mac os x/i.test(ua) ? "Mac" : /cros/i.test(ua) ? "Chromebook" : /linux/i.test(ua) ? "Linux-PC" : "";
  const app = /microsoft outlook|ms-office|outlook/i.test(ua) ? "Outlook" : /thunderbird/i.test(ua) ? "Thunderbird" : /edg(e|a|ios)?\//i.test(ua) ? "Edge" : /opr\/|opera/i.test(ua) ? "Opera" : /samsungbrowser/i.test(ua) ? "Samsung Internet" : /firefox\/|fxios/i.test(ua) ? "Firefox" : /chrome\/|crios/i.test(ua) ? "Chrome" : /safari\//i.test(ua) ? "Safari" : "";
  return [device, app].filter(Boolean).join(", ") || "Unbekanntes Gerät";
}

/**
 * Zusammenfassung seit dem letzten Versand: Wird ein abgelehnter Vertrag geändert und neu gesendet, zählt das Öffnen der alten
 * Fassung nicht mehr mit (die neue hat der Kunde ja noch nicht gesehen).
 */
export function summarizeContractEvents(events: TrackEvent[]): ContractTracking {
  const sorted = [...events].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const sends = sorted.filter((event) => event.kind === "gesendet");
  const out: ContractTracking = JSON.parse(JSON.stringify(EMPTY_TRACKING)) as ContractTracking;
  if (!sends.length) return out;
  out.sent.count = sends.length; out.sent.firstAt = iso(sends[0].createdAt); out.sent.lastAt = iso(sends[sends.length - 1].createdAt);
  const round = sorted.slice(sorted.lastIndexOf(sends[sends.length - 1]) + 1); const devices = new Set<string>();
  for (const event of round) {
    const at = iso(event.createdAt);
    if (event.kind === "erinnert") { out.sent.reminders += 1; out.sent.lastAt = at; }
    else if (event.kind === "mail_geoeffnet") { out.mail.opens += 1; out.mail.firstAt ??= at; out.mail.lastAt = at; }
    else if (event.kind === "angesehen") {
      out.views.count += 1; out.views.firstAt ??= at; out.views.lastAt = at; if (event.source === "mail" || event.source === "erinnerung") out.views.fromMail += 1;
      const device = deviceLabel(event.userAgent); if (device) devices.add(device);
      out.reading.seconds += Math.max(0, Math.min(READ_MAX_SECONDS, Math.round(Number(event.seconds) || 0))); out.reading.depth = Math.max(out.reading.depth, Math.max(0, Math.min(100, Math.round(Number(event.depth) || 0))));
    } else if (event.kind === "pdf_geladen") { out.downloads.count += 1; out.downloads.lastAt = at; }
  }
  out.views.devices = Array.from(devices).slice(0, 4); out.mail.inferred = out.mail.opens === 0 && out.views.fromMail > 0; out.reading.reachedEnd = out.reading.depth >= READ_END_DEPTH;
  return out;
}

const pad = (value: number) => String(value).padStart(2, "0");
/** Zeitpunkt in Worten: „heute, 15:10 Uhr“, „gestern, 08:55 Uhr“, sonst „16.11.2026, 11:20 Uhr“. */
export function whenText(value: Date | string | null | undefined, now: Date = new Date()): string {
  if (!value) return "–"; const date = new Date(value); const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())} Uhr`; const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (day(date) === day(now)) return `heute, ${time}`; if (day(date) === day(yesterday)) return `gestern, ${time}`;
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${time}`;
}
const times = (count: number) => `${count}×`;

export type TrackingStepKey = "gesendet" | "mail" | "geoeffnet" | "gelesen" | "ergebnis";
export type TrackingStep = { key: TrackingStepKey; label: string; state: "done" | "todo" | "warn"; detail: string };
/** Die fünf Schritte eines Vertrags beim Kunden – jeder mit Stand und einem Satz dazu. */
export function trackingSteps(tracking: ContractTracking, status: ContractStatus, result: { signedAt?: Date | string | null; signerName?: string | null; declinedAt?: Date | string | null; declineReason?: string | null } = {}, now: Date = new Date()): TrackingStep[] {
  const { sent, mail, views, reading } = tracking; const sentDone = sent.count > 0;
  const sentDetail = !sentDone ? "noch nicht gesendet" : `${whenText(sent.lastAt, now)}${sent.count > 1 ? ` – insgesamt ${times(sent.count)} gesendet` : ""}${sent.reminders ? ` – ${times(sent.reminders)} erinnert` : ""}`;
  const mailDone = mail.opens > 0 || mail.inferred;
  const mailDetail = mail.opens > 0 ? (mail.opens === 1 ? `geöffnet ${whenText(mail.firstAt, now)}` : `${times(mail.opens)} geöffnet, zuletzt ${whenText(mail.lastAt, now)}`) : mail.inferred ? "geöffnet – am Klick auf den Link erkannt" : sentDone ? "noch nicht geöffnet" : "–";
  const viewsDone = views.count > 0;
  const viewsDetail = !viewsDone ? (sentDone ? "noch nicht angeklickt" : "–") : `${views.count === 1 ? `geöffnet ${whenText(views.firstAt, now)}` : `${times(views.count)} geöffnet, zuletzt ${whenText(views.lastAt, now)}`}${views.devices.length ? ` – ${views.devices.join(" und ")}` : ""}`;
  const readDone = viewsDone && (reading.seconds >= READ_MIN_SECONDS || reading.reachedEnd);
  const readDetail = !viewsDone ? "–" : readDone ? `${talkTimeText(reading.seconds)} gelesen${reading.reachedEnd ? ", bis zum Ende" : reading.depth >= 15 ? `, etwa bis zur ${reading.depth >= 60 ? "zweiten Hälfte" : "Mitte"}` : ""}` : "nur kurz angesehen";
  const end: TrackingStep = status === "unterschrieben" ? { key: "ergebnis", label: "Unterschrieben", state: "done", detail: `${whenText(result.signedAt, now)}${result.signerName ? ` von ${result.signerName}` : ""}` }
    : status === "abgelehnt" ? { key: "ergebnis", label: "Abgelehnt", state: "warn", detail: `${whenText(result.declinedAt, now)}${result.declineReason ? ` – „${result.declineReason}“` : ""}` }
    : status === "storniert" ? { key: "ergebnis", label: "Storniert", state: "warn", detail: "von dir zurückgezogen" }
    : { key: "ergebnis", label: "Unterschrift", state: "todo", detail: sentDone ? "noch nicht unterschrieben" : "–" };
  return [
    { key: "gesendet", label: "Gesendet", state: sentDone ? "done" : "todo", detail: sentDetail },
    { key: "mail", label: "E-Mail geöffnet", state: mailDone ? "done" : "todo", detail: mailDetail },
    { key: "geoeffnet", label: "Link angeklickt, Vertrag geöffnet", state: viewsDone ? "done" : "todo", detail: viewsDetail },
    { key: "gelesen", label: "Gelesen", state: readDone ? "done" : "todo", detail: readDetail },
    end,
  ];
}
/** Eine Zeile für die Übersicht: „3× geöffnet, zuletzt heute, 15:10 Uhr – 4 Min gelesen“. */
export function trackingLine(tracking: ContractTracking, now: Date = new Date()): string {
  const { sent, mail, views, reading } = tracking; if (!sent.count) return "";
  if (!views.count) return mail.opens ? `E-Mail ${mail.opens === 1 ? "geöffnet" : `${times(mail.opens)} geöffnet`}, Vertrag noch nicht` : "noch nicht geöffnet";
  return `${views.count === 1 ? "geöffnet" : `${times(views.count)} geöffnet, zuletzt`} ${whenText(views.lastAt, now)}${reading.seconds >= READ_MIN_SECONDS ? ` – ${talkTimeText(reading.seconds)} gelesen` : ""}`;
}
/** Tipp für den Vertrieb, solange der Vertrag beim Kunden liegt – oder null, wenn es nichts zu sagen gibt. */
export function trackingHint(tracking: ContractTracking, status: ContractStatus, now: Date = new Date()): string | null {
  if (status !== "gesendet" && status !== "angesehen") return null; const { sent, views, reading } = tracking; if (!sent.count) return null;
  if (views.count >= 2 || reading.reachedEnd || reading.seconds >= 120) return `Der Kunde hat den Vertrag ${views.count > 1 ? `schon ${times(views.count)} geöffnet` : "geöffnet"}${reading.reachedEnd ? " und bis zum Ende gelesen" : ""}, aber noch nicht unterschrieben. Ein kurzer Anruf lohnt sich jetzt.`;
  if (views.count === 1) return "Der Kunde hat den Vertrag einmal geöffnet. Frag ruhig nach, ob noch etwas unklar ist.";
  const days = sent.lastAt ? Math.floor((now.getTime() - new Date(sent.lastAt).getTime()) / 86_400_000) : 0;
  if (days >= 2) return `Seit ${days} Tagen nicht geöffnet. Schick eine Erinnerung oder ruf kurz an – vielleicht ist die E-Mail im Spam gelandet.`;
  return null;
}
export type FunnelStation = { key: TrackingStepKey; label: string; count: number; /** Anteil an den gesendeten Verträgen (0–100), null ohne gesendete */ share: number | null };
/**
 * Wie weit sind die gesendeten Verträge gekommen? Fünf Stationen, jede zählt alle Verträge, die mindestens so weit sind:
 * Wer unterschrieben hat, hat auch gelesen; wer gelesen hat, hat geöffnet; wer geöffnet hat, hat die E-Mail aufgemacht.
 */
export function contractFunnel(rows: Array<{ status: ContractStatus; tracking?: ContractTracking | null }>): { sent: number; stations: FunnelStation[] } {
  let sent = 0; let mail = 0; let viewed = 0; let read = 0; let signed = 0;
  for (const row of rows) {
    const tracking = row.tracking ?? EMPTY_TRACKING; if (!(tracking.sent.count > 0 || (row.status !== "entwurf" && row.status !== "storniert"))) continue; if (row.status === "entwurf") continue; // wieder im Entwurf: liegt nicht mehr beim Kunden
    const isSigned = row.status === "unterschrieben"; const isRead = isSigned || tracking.reading.seconds >= READ_MIN_SECONDS || tracking.reading.reachedEnd; const isViewed = isRead || tracking.views.count > 0 || row.status === "angesehen"; const isMail = isViewed || tracking.mail.opens > 0;
    sent += 1; if (isMail) mail += 1; if (isViewed) viewed += 1; if (isRead) read += 1; if (isSigned) signed += 1;
  }
  const share = (count: number) => (sent ? Math.round((count / sent) * 100) : null);
  return { sent, stations: [{ key: "gesendet", label: "Gesendet", count: sent, share: share(sent) }, { key: "mail", label: "E-Mail geöffnet", count: mail, share: share(mail) }, { key: "geoeffnet", label: "Vertrag geöffnet", count: viewed, share: share(viewed) }, { key: "gelesen", label: "Gelesen", count: read, share: share(read) }, { key: "ergebnis", label: "Unterschrieben", count: signed, share: share(signed) }] };
}
/** Der offene Vertrag, bei dem sich Nachfassen am meisten lohnt: am häufigsten geöffnet, am längsten gelesen. */
export function hottestOpen<T extends { status: ContractStatus; tracking?: ContractTracking | null }>(rows: T[]): T | null {
  const open = rows.filter((row) => row.status === "gesendet" || row.status === "angesehen"); if (!open.length) return null;
  const heat = (row: T) => { const tracking = row.tracking ?? EMPTY_TRACKING; return tracking.views.count * 1000 + Math.min(900, tracking.reading.seconds) + (tracking.reading.reachedEnd ? 5000 : 0) + tracking.mail.opens; };
  return [...open].sort((a, b) => heat(b) - heat(a))[0];
}
/** Im Nachweis (PDF und Seite) stehen nur die wichtigen Schritte – nicht jedes Öffnen der E-Mail oder jeder weitere Aufruf. */
export function proofEvents<T extends { kind: ContractEventKind }>(events: T[]): T[] {
  let viewed = false;
  return events.filter((event) => { if (event.kind === "mail_geoeffnet" || event.kind === "pdf_geladen") return false; if (event.kind !== "angesehen") return true; if (viewed) return false; viewed = true; return true; });
}
/** Wie der Aufruf zustande kam – für den Verlauf. */
export const SOURCE_NOTE: Record<TrackSource, string> = { mail: "über den Link in der E-Mail", erinnerung: "über den Link in der Erinnerung", link: "Link direkt geöffnet" };
export const sourceOf = (value: unknown): TrackSource => (value === "1" || value === "mail" ? "mail" : value === "2" || value === "erinnerung" ? "erinnerung" : "link");
