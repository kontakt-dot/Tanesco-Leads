/** E-Mail-Kampagnen mit Ablauf-Baum: Senden → Warten → Wenn geöffnet/geklickt → Dann/Sonst … Gemeinsame Logik für Server und Chat-Demo. */
import { renderEmailHtml, renderEmailText, type EmailBlock, type EmailDesign } from "./email-design";
export type EmailNode =
  | { id: string; type: "send"; label?: string; subject: string; subjectB?: string | null; preheader?: string; blocks: EmailBlock[]; next: string | null }
  | { id: string; type: "wait"; hours: number; next: string | null }
  | { id: string; type: "condition"; check: "opened" | "clicked" | "replied"; url?: string | null; yes: string | null; no: string | null }
  | { id: string; type: "end"; label?: string };
export type EmailTree = { start: string | null; nodes: EmailNode[] };
export type AbVariant = "A" | "B";
export type RecipientStatus = "wartet" | "laeuft" | "fertig" | "fehler" | "abgemeldet" | "bounce" | "beschwerde";
export type RecipientState = { nodeId: string | null; nextActionAt: Date | null; status: RecipientStatus; sentCount: number; openedAt: Date | null; clickedAt: Date | null; repliedAt: Date | null; lastSentAt: Date | null; variant?: AbVariant | null; clickedUrls?: string[] | null };
export type StepEvent = { kind: "gesendet" | "gewartet" | "verzweigt" | "beendet" | "fehler"; nodeId: string; subject?: string; note: string };
/**
 * Versandfenster: nur an diesen Wochentagen (0 = Sonntag) zwischen von/bis (Ortszeit der Zeitzone) senden.
 * `days` sind Ausnahmen je Wochentag – z. B. freitags nur bis 13 Uhr. Was dort nicht steht, nutzt von/bis.
 */
export type SendDay = { from: string; to: string };
export type SendWindow = { enabled: boolean; weekdays: number[]; from: string; to: string; timezone: string; days?: Record<string, SendDay> | null };
/** Standard für neue Kampagnen: werktags 7:30–17:00 Uhr, freitags nur bis 13:00 Uhr (Berlin). Fällige E-Mails außerhalb warten bis zum nächsten Fenster. */
export const DEFAULT_SEND_WINDOW: SendWindow = { enabled: true, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin", days: { "5": { from: "07:30", to: "13:00" } } };
/** Gespeichertes Fenster einer Kampagne auflösen: fehlende Felder mit dem Standard füllen; ohne gespeichertes Fenster (ältere Kampagnen) bleibt der Versand rund um die Uhr. */
export const resolveSendWindow = (stored: Partial<SendWindow> | null | undefined): SendWindow => stored ? { ...DEFAULT_SEND_WINDOW, ...stored, days: stored.days === undefined ? DEFAULT_SEND_WINDOW.days : stored.days } : { ...DEFAULT_SEND_WINDOW, enabled: false };
/** Zeiten für einen Wochentag: Ausnahme aus `days`, sonst das allgemeine von/bis. `null`, wenn an dem Tag gar nicht gesendet wird. */
export function windowForDay(window: SendWindow, weekday: number): SendDay | null {
  const days = window.weekdays.length ? window.weekdays : [0, 1, 2, 3, 4, 5, 6];
  if (!days.includes(weekday)) return null;
  const exception = window.days?.[String(weekday)];
  const from = exception?.from || window.from; const to = exception?.to || window.to;
  return from && to && from < to ? { from, to } : null;
}
export const TIMEZONES = ["Europe/Berlin", "Europe/Vienna", "Europe/Zurich", "Europe/London", "Europe/Madrid", "Europe/Istanbul", "America/New_York", "America/Los_Angeles", "Asia/Dubai"];
export const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const newNodeId = () => `n${Math.random().toString(36).slice(2, 8)}`;
export function starterTree(blocks: { first: EmailBlock[]; followUp: EmailBlock[] }): EmailTree {
  const send1 = newNodeId(); const wait1 = newNodeId(); const cond = newNodeId(); const sendOpened = newNodeId(); const sendNotOpened = newNodeId(); const end = newNodeId();
  return { start: send1, nodes: [
    { id: send1, type: "send", label: "1. E-Mail", subject: "Mehr Anfragen für {{firma}} – ohne Risiko", blocks: blocks.first, next: wait1 },
    { id: wait1, type: "wait", hours: 72, next: cond },
    { id: cond, type: "condition", check: "opened", yes: sendOpened, no: sendNotOpened },
    { id: sendOpened, type: "send", label: "Wenn geöffnet", subject: "Kurze Frage zu Ihrem Bedarf, {{vorname}}", blocks: blocks.followUp, next: end },
    { id: sendNotOpened, type: "send", label: "Wenn nicht geöffnet", subject: "Haben Sie meine E-Mail gesehen, {{vorname}}?", blocks: blocks.followUp, next: end },
    { id: end, type: "end", label: "Ende" },
  ] };
}
/** Nachfass-Serie (z. B. nach „Angebot“ oder für eingeschlafene Karten): 2 E-Mails mit Wartezeit, Ende wenn geantwortet. */
export function followUpTree(blocks: { first: EmailBlock[]; second: EmailBlock[] }, options: { firstSubject?: string; secondSubject?: string; waitHours?: number } = {}): EmailTree {
  const send1 = newNodeId(); const wait1 = newNodeId(); const cond = newNodeId(); const send2 = newNodeId(); const end = newNodeId(); const endReplied = newNodeId();
  return { start: send1, nodes: [
    { id: send1, type: "send", label: "Nachfassen 1", subject: options.firstSubject ?? "Kurze Frage zu unserem Angebot, {{vorname}}", blocks: blocks.first, next: wait1 },
    { id: wait1, type: "wait", hours: options.waitHours ?? 96, next: cond },
    { id: cond, type: "condition", check: "replied", yes: endReplied, no: send2 },
    { id: endReplied, type: "end", label: "Hat geantwortet" },
    { id: send2, type: "send", label: "Nachfassen 2", subject: options.secondSubject ?? "Passt es gerade nicht, {{vorname}}?", blocks: blocks.second, next: end },
    { id: end, type: "end", label: "Ende" },
  ] };
}
export function validateTree(tree: EmailTree): string[] {
  const issues: string[] = []; const ids = new Set(tree.nodes.map((node) => node.id));
  if (!tree.start || !ids.has(tree.start)) issues.push("Der Ablauf hat keinen Startpunkt (erste E-Mail).");
  for (const node of tree.nodes) {
    if (node.type === "send") { if (!node.subject.trim()) issues.push(`„${node.label ?? "E-Mail"}“ hat keinen Betreff.`); if (!node.blocks.length) issues.push(`„${node.label ?? node.subject}“ hat keinen Inhalt.`); if (node.next && !ids.has(node.next)) issues.push(`„${node.label ?? node.subject}“ zeigt auf einen fehlenden Schritt.`); }
    if (node.type === "wait" && (!Number.isFinite(node.hours) || node.hours <= 0)) issues.push("Eine Wartezeit ist leer oder 0.");
    if (node.type === "condition" && !node.yes && !node.no) issues.push("Eine Wenn-Abfrage hat weder Dann noch Sonst.");
  }
  return issues;
}
/** A/B-Test: Variante je Empfänger – abwechselnd nach Reihenfolge, Anteil B in Prozent (Standard 50). */
export function abVariantFor(index: number, splitB = 50): AbVariant { const share = Math.min(90, Math.max(10, Math.round(splitB) || 50)); return ((index + 1) * share) % 100 < share ? "B" : "A"; }
export const hasAbTest = (tree: EmailTree) => tree.nodes.some((node) => node.type === "send" && Boolean(node.subjectB?.trim()));
export const subjectFor = (node: Extract<EmailNode, { type: "send" }>, variant: AbVariant | null | undefined) => (variant === "B" && node.subjectB?.trim() ? node.subjectB.trim() : node.subject);
/** Uhrzeit/Wochentag in einer Zeitzone (ohne Bibliothek, über Intl). */
export function zonedParts(date: Date, timezone: string) {
  try { const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit" }).formatToParts(date); const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ""; const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")); return { weekday: weekday < 0 ? date.getDay() : weekday, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) }; }
  catch { return { weekday: date.getDay(), minutes: date.getHours() * 60 + date.getMinutes() }; }
}
const toMinutes = (time: string) => { const [hours, minutes] = time.split(":").map(Number); return (hours || 0) * 60 + (minutes || 0); };
/** Darf jetzt gesendet werden? Sonst: nächster Zeitpunkt innerhalb des Fensters. */
export function nextSendSlot(now: Date, window: SendWindow | null | undefined): Date | null {
  if (!window || !window.enabled) return null;
  /** Liegt dieser Zeitpunkt im Fenster seines Wochentags? Jeder Tag kann eigene Zeiten haben (z. B. Freitag bis 13 Uhr). */
  const inside = (date: Date) => { const parts = zonedParts(date, window.timezone); const day = windowForDay(window, parts.weekday); return day ? parts.minutes >= toMinutes(day.from) && parts.minutes < toMinutes(day.to) : false; };
  if (inside(now)) return null;
  for (let step = 0; step < 8 * 24 * 4; step += 1) { // in Viertelstunden bis zu 8 Tage vorausschauen
    const candidate = new Date(now.getTime() + step * 15 * 60_000);
    if (inside(candidate)) return candidate;
  }
  return null;
}
/** Führt einen Empfänger so weit wie möglich aus (bis Warten/Ende). send() liefert false, wenn der Versand fehlschlägt. */
/** Versand-Rückruf: `true`/`false` – oder `{ ok, subject }` mit dem fertig gefüllten Betreff (steht dann im Verlauf statt der Vorlage mit Platzhaltern). */
export type SendOutcome = boolean | { ok: boolean; subject?: string | null };
export async function advanceRecipient(tree: EmailTree, state: RecipientState, now: Date, send: (node: Extract<EmailNode, { type: "send" }>, subject: string) => Promise<SendOutcome>, options: { window?: SendWindow | null } = {}): Promise<{ state: RecipientState; events: StepEvent[] }> {
  const events: StepEvent[] = []; let current = { ...state }; let guard = 0;
  if (!current.nodeId) current.nodeId = tree.start;
  while (current.nodeId && guard < 12) {
    guard += 1; if (current.nextActionAt && current.nextActionAt > now) break; // noch nicht fällig
    const node = tree.nodes.find((item) => item.id === current.nodeId);
    if (!node) { current = { ...current, status: "fertig", nodeId: null, nextActionAt: null }; events.push({ kind: "beendet", nodeId: current.nodeId ?? "", note: "Schritt nicht gefunden – Ablauf beendet" }); break; }
    if (node.type === "end") { current = { ...current, status: "fertig", nodeId: null, nextActionAt: null }; events.push({ kind: "beendet", nodeId: node.id, note: node.label ?? "Ablauf beendet" }); break; }
    if (node.type === "wait") { if (current.nextActionAt && current.nextActionAt > now) break; const due = new Date(now.getTime() + node.hours * 3_600_000); current = { ...current, status: "wartet", nodeId: node.next, nextActionAt: due }; events.push({ kind: "gewartet", nodeId: node.id, note: `Wartet ${node.hours} Stunden (bis ${due.toLocaleString("de-DE")})` }); break; }
    if (node.type === "condition") { const since = current.lastSentAt ? new Date(current.lastSentAt.getTime() - 3000) : new Date(0); /* 3 s Toleranz (Sekundenrundung) */ const wanted = (node.url ?? "").trim().toLowerCase(); const clickedWanted = !wanted || (current.clickedUrls ?? []).some((url) => url.toLowerCase().includes(wanted)); const hit = node.check === "opened" ? Boolean(current.openedAt && current.openedAt >= since) : node.check === "clicked" ? Boolean(current.clickedAt && current.clickedAt >= since && clickedWanted) : Boolean(current.repliedAt && current.repliedAt >= since); const label = node.check === "opened" ? "geöffnet" : node.check === "clicked" ? (wanted ? `Link „${wanted.slice(0, 40)}“ geklickt` : "geklickt") : "geantwortet"; current = { ...current, nodeId: hit ? node.yes : node.no, nextActionAt: null }; events.push({ kind: "verzweigt", nodeId: node.id, note: hit ? `Wenn ${label}: ja → Dann-Zweig` : `Wenn ${label}: nein → Sonst-Zweig` }); if (!current.nodeId) { current = { ...current, status: "fertig" }; events.push({ kind: "beendet", nodeId: node.id, note: "Kein weiterer Schritt – Ablauf beendet" }); } continue; }
    if (node.type === "send") {
      if (current.nextActionAt && current.nextActionAt > now) break;
      const slot = nextSendSlot(now, options.window); if (slot) { current = { ...current, status: "wartet", nextActionAt: slot }; events.push({ kind: "gewartet", nodeId: node.id, note: `Versandfenster: wartet bis ${slot.toLocaleString("de-DE", { timeZone: options.window?.timezone })}` }); break; }
      const template = subjectFor(node, current.variant); const outcome = await send(node, template);
      const ok = typeof outcome === "boolean" ? outcome : outcome.ok; const subject = (typeof outcome === "object" && outcome.subject) || template;
      if (!ok) { current = { ...current, status: "fehler", nextActionAt: null }; events.push({ kind: "fehler", nodeId: node.id, subject, note: "Versand fehlgeschlagen" }); break; }
      current = { ...current, status: "laeuft", sentCount: current.sentCount + 1, lastSentAt: now, nodeId: node.next, nextActionAt: null }; events.push({ kind: "gesendet", nodeId: node.id, subject, note: `E-Mail „${subject}“ gesendet${current.variant && node.subjectB?.trim() ? ` (Variante ${current.variant})` : ""}` });
      if (!node.next) { current = { ...current, status: "fertig" }; events.push({ kind: "beendet", nodeId: node.id, note: "Letzte E-Mail gesendet – Ablauf beendet" }); }
      continue;
    }
  }
  return { state: current, events };
}
export function renderNode(node: Extract<EmailNode, { type: "send" }>, design: EmailDesign, values: Record<string, string | null | undefined>, tracking: { pixelUrl?: string | null; wrapLink?: (url: string) => string; unsubscribeUrl?: string | null; logoBase?: string | null; preview?: boolean; subject?: string | null } = {}) {
  return { subject: fillPlaceholdersSafe(tracking.subject ?? node.subject, values), html: renderEmailHtml(node.blocks, design, values, { trackingPixelUrl: tracking.pixelUrl ?? null, wrapLink: tracking.wrapLink, unsubscribeUrl: tracking.unsubscribeUrl ?? null, logoBase: tracking.logoBase ?? null, preview: tracking.preview }), text: renderEmailText(node.blocks, values) };
}
export function fillPlaceholdersSafe(text: string, values: Record<string, string | null | undefined>) { return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => values[key] ?? ""); }
/** Platzhalter-Werte eines Empfängers: feste Felder plus die Zusatzfelder aus der hochgeladenen Liste (z. B. {{branche}}); feste Felder gewinnen bei gleichem Namen. */
export function recipientValues(lead: { firstName?: string | null; lastName?: string | null; company?: string | null; city?: string | null; salutation?: string | null; email?: string | null; fields?: Record<string, string> | null }, unsubscribeUrl?: string | null) {
  const anrede = lead.salutation === "frau" ? "Frau" : lead.salutation === "herr" ? "Herr" : "";
  return { ...(lead.fields ?? {}), vorname: lead.firstName ?? "", nachname: lead.lastName ?? "", name: `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim(), firma: lead.company ?? "", stadt: lead.city ?? "", anrede, email: lead.email ?? "", abmelden: unsubscribeUrl ? `Abmelden: ${unsubscribeUrl}` : "Abmelden" };
}
export type SuppressionReason = "bounce" | "beschwerde" | "abgemeldet" | "gesperrt" | "manuell";
export const SUPPRESSION_LABELS: Record<SuppressionReason, string> = { bounce: "Unzustellbar (Bounce)", beschwerde: "Beschwerde (Spam-Meldung)", abgemeldet: "Abgemeldet", gesperrt: "Im Posteingang gesperrt", manuell: "Von Hand gesperrt" };
/** Unterlisten der Sperrliste – jede Adresse steht genau in einer, je nach Grund. */
export const SUPPRESSION_LISTS: Array<{ key: "alle" | SuppressionReason; label: string; hint: string }> = [
  { key: "alle", label: "Alle", hint: "Alle gesperrten Adressen – Protokoll mit Grund, Quelle und Datum." },
  { key: "bounce", label: "Bounces", hint: "Unzustellbar: Mail-Anbieter (Webhook) oder Knopf beim Empfänger. Kommen automatisch dazu." },
  { key: "abgemeldet", label: "Abmeldungen", hint: "Abmelde-Link geklickt oder Abmeldung in einer Antwort erkannt. Kommen automatisch dazu." },
  { key: "beschwerde", label: "Beschwerden", hint: "Spam-Beschwerden vom Mail-Anbieter und Beschwerden, die die KI in Antworten erkannt hat (automatisch gesperrt)." },
  { key: "gesperrt", label: "Posteingang", hint: "Absender, die im Posteingang gesperrt wurden – ihre Nachrichten liegen dort unter „Gesperrt“." },
  { key: "manuell", label: "Manuell", hint: "Von Hand eingetragen, z. B. nach einer telefonischen Bitte." },
];
/** Erkennt in einer Antwort, ob sich jemand abmelden will („bitte keine E-Mails mehr“, „unsubscribe“, „aus dem Verteiler nehmen“ …). */
export function detectOptOut(text: string | null | undefined, subject?: string | null) {
  const value = `${subject ?? ""}\n${text ?? ""}`.toLowerCase();
  const head = value.split("\n").filter((line) => line.trim() && !line.trim().startsWith(">")).slice(0, 12).join("\n"); // nur der eigene Text, nicht die zitierte Mail
  return /(\babmelden\b|\babbestellen\b|\baustragen\b|\bunsubscribe\b|\bremove me\b|kein(e)? (weiteren? )?(e-?mails?|nachrichten|werbung|newsletter|mails?)\b|nicht mehr (anschreiben|kontaktieren|schreiben|anrufen|belästigen)|aus (dem|ihrem|eurem) verteiler|(streichen|löschen|entfernen) sie (mich|meine (adresse|e-?mail))|^stop\b|\bstopp?(en)?\b.*(mail|nachricht|verteiler|werbung))/im.test(head);
}
export function summarizeCampaign(recipients: Array<Pick<RecipientState, "status" | "sentCount" | "openedAt" | "clickedAt" | "repliedAt"> & { variant?: AbVariant | null }>) {
  const total = recipients.length; const sent = recipients.filter((row) => row.sentCount > 0).length; const opened = recipients.filter((row) => row.openedAt).length; const clicked = recipients.filter((row) => row.clickedAt).length; const replied = recipients.filter((row) => row.repliedAt).length; const done = recipients.filter((row) => row.status === "fertig").length; const failed = recipients.filter((row) => row.status === "fehler").length; const bounced = recipients.filter((row) => row.status === "bounce" || row.status === "beschwerde").length; const unsubscribed = recipients.filter((row) => row.status === "abgemeldet").length;
  const variant = (key: AbVariant) => { const rows = recipients.filter((row) => row.variant === key && row.sentCount > 0); const openedV = rows.filter((row) => row.openedAt).length; const clickedV = rows.filter((row) => row.clickedAt).length; return { sent: rows.length, opened: openedV, clicked: clickedV, openRate: rows.length ? Math.round((openedV / rows.length) * 100) : 0, clickRate: rows.length ? Math.round((clickedV / rows.length) * 100) : 0 }; };
  const a = variant("A"); const b = variant("B");
  return { total, sent, opened, clicked, replied, done, failed, bounced, unsubscribed, openRate: sent ? Math.round((opened / sent) * 100) : 0, clickRate: sent ? Math.round((clicked / sent) * 100) : 0, bounceRate: sent ? Math.round((bounced / sent) * 100) : 0, abTest: a.sent || b.sent ? { a, b, winner: a.sent && b.sent ? (a.openRate === b.openRate ? null : a.openRate > b.openRate ? "A" : "B") : null } : null };
}
