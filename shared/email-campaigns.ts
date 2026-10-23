/** E-Mail-Kampagnen mit Ablauf-Baum: Senden → Warten → Wenn geöffnet/geklickt → Dann/Sonst … Gemeinsame Logik für Server und Chat-Demo. */
import { renderEmailHtml, renderEmailText, type EmailBlock, type EmailDesign, usesSignature } from "./email-design";
export type EmailNode =
  | { id: string; type: "send"; label?: string; subject: string; subjectB?: string | null; preheader?: string; blocks: EmailBlock[]; attachments?: CampaignAttachment[]; next: string | null }
  | { id: string; type: "wait"; hours: number; next: string | null }
  | { id: string; type: "condition"; check: "opened" | "clicked" | "replied"; url?: string | null; yes: string | null; no: string | null }
  | { id: string; type: "end"; label?: string };
export type EmailTree = { start: string | null; nodes: EmailNode[] };
export type AbVariant = "A" | "B";
export type RecipientStatus = "wartet" | "laeuft" | "fertig" | "fehler" | "abgemeldet" | "bounce" | "beschwerde";
/**
 * Stand eines Empfängers im Ablauf. `nodeId` ist der Schritt, an dem er gerade steht: während einer Wartezeit der Warten-Schritt
 * selbst (`waitingAt` = derselbe Schritt, `nextActionAt` = wann die Wartezeit um ist). Erst wenn sie um ist, wird nachgesehen,
 * was JETZT dahinter steht – so gelten Änderungen am Ablauf (E-Mail eingefügt, Schritt verschoben) auch für alle, die gerade warten.
 * `sentNodeIds`: E-Mails, die er in diesem Durchlauf schon bekommen hat – dieselbe E-Mail geht nie zweimal raus.
 */
export type RecipientState = { nodeId: string | null; nextActionAt: Date | null; status: RecipientStatus; sentCount: number; openedAt: Date | null; clickedAt: Date | null; repliedAt: Date | null; lastSentAt: Date | null; variant?: AbVariant | null; clickedUrls?: string[] | null; waitingAt?: string | null; sentNodeIds?: string[] | null };
export type StepEvent = { kind: "gesendet" | "gewartet" | "verzweigt" | "beendet" | "fehler"; nodeId: string; subject?: string; note: string };
/**
 * Versandfenster: nur an diesen Wochentagen (0 = Sonntag) zwischen von/bis (Ortszeit der Zeitzone) senden.
 * `days` sind Ausnahmen je Wochentag – z. B. freitags nur bis 13 Uhr. Was dort nicht steht, nutzt von/bis.
 */
export type SendDay = { from: string; to: string };
/** Drip-Versand: E-Mails nicht alle auf einmal, sondern verteilt – höchstens `perHour` pro Stunde, dazwischen ein zufälliger Abstand um `gapSeconds`. Bessere Zustellbarkeit (kein Massenversand-Muster). */
export type DripSettings = { enabled: boolean; perHour: number; gapSeconds: number };
export const DEFAULT_DRIP: DripSettings = { enabled: true, perHour: 40, gapSeconds: 90 };
export const DRIP_PER_HOUR = [10, 20, 30, 40, 60, 100];
export const DRIP_GAPS: Array<[number, string]> = [[30, "30 Sek."], [60, "1 Min."], [90, "1,5 Min."], [120, "2 Min."], [300, "5 Min."]];
export function resolveDrip(value: Partial<DripSettings> | null | undefined): DripSettings {
  const raw = value ?? {}; const perHour = Math.round(Number(raw.perHour)); const gap = Math.round(Number(raw.gapSeconds));
  return { enabled: raw.enabled === undefined ? DEFAULT_DRIP.enabled : Boolean(raw.enabled), perHour: Number.isFinite(perHour) && perHour >= 1 ? Math.min(500, perHour) : DEFAULT_DRIP.perHour, gapSeconds: Number.isFinite(gap) && gap >= 10 ? Math.min(3600, gap) : DEFAULT_DRIP.gapSeconds };
}
/** Wie viele E-Mails darf diese Kampagne jetzt verschicken? `sentLastHour` = in den letzten 60 Min. gesendet, `lastSentAt` = letzte E-Mail der Kampagne, `jitter` 0…1 (Zufall). */
export function dripBudget(drip: DripSettings, sentLastHour: number, lastSentAt: Date | null, now: Date, jitter = Math.random()): number {
  if (!drip.enabled) return Number.POSITIVE_INFINITY;
  const left = Math.max(0, drip.perHour - sentLastHour); if (!left) return 0;
  const gap = drip.gapSeconds * (0.7 + jitter * 0.6) * 1000; // ±30 % – kein starres Muster
  if (lastSentAt && now.getTime() - lastSentAt.getTime() < gap) return 0;
  return Math.min(left, Math.max(1, Math.floor(60 / drip.gapSeconds))); // je Minuten-Durchlauf höchstens so viele, wie der Abstand zulässt
}
export type SendWindow = { enabled: boolean; weekdays: number[]; from: string; to: string; timezone: string; days?: Record<string, SendDay> | null; drip?: DripSettings | null };
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
/** Anhang an einer Kampagnen-E-Mail (wird mit jeder E-Mail dieses Schritts verschickt). */
export type CampaignAttachment = { filename: string; contentType: string; contentBase64: string; size: number };
export const CAMPAIGN_ATTACHMENT_LIMITS = { maxFiles: 3, maxFileBytes: 5 * 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024 };
export function attachmentIssue(files: CampaignAttachment[] | undefined | null): string | null {
  const list = files ?? []; if (!list.length) return null;
  if (list.length > CAMPAIGN_ATTACHMENT_LIMITS.maxFiles) return `Höchstens ${CAMPAIGN_ATTACHMENT_LIMITS.maxFiles} Anhänge je E-Mail.`;
  const big = list.find((file) => file.size > CAMPAIGN_ATTACHMENT_LIMITS.maxFileBytes); if (big) return `„${big.filename}“ ist zu groß (höchstens 5 MB je Datei).`;
  if (list.reduce((sum, file) => sum + file.size, 0) > CAMPAIGN_ATTACHMENT_LIMITS.maxTotalBytes) return "Alle Anhänge zusammen dürfen höchstens 8 MB groß sein.";
  if (list.some((file) => /\.(exe|bat|cmd|js|vbs|scr|com|msi)$/i.test(file.filename))) return "Programme und Skripte können nicht angehängt werden (werden von Mail-Anbietern blockiert).";
  return null;
}
export function validateTree(tree: EmailTree): string[] {
  const issues: string[] = []; const ids = new Set(tree.nodes.map((node) => node.id));
  if (!tree.start || !ids.has(tree.start)) issues.push("Der Ablauf hat keinen Startpunkt (erste E-Mail).");
  for (const node of tree.nodes) {
    if (node.type === "send") { const issue = attachmentIssue(node.attachments); if (issue) issues.push(`E-Mail „${node.label?.trim() || node.subject || "ohne Betreff"}“: ${issue}`); }
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
/**
 * Antwort-Stopp („Bei Antwort anhalten“, Schalter je Kampagne, standardmäßig an – auch für alle schon angelegten
 * Kampagnen): Sobald der Kontakt geantwortet hat (`repliedAt`), geht keine weitere E-Mail mehr raus – unabhängig vom
 * gebauten Ablauf. Der Empfänger wird mit diesem Vermerk beendet. Nur wer den Schalter bewusst ausschaltet, schickt die
 * Serie trotz Antwort zu Ende.
 */
export const REPLY_STOP_NOTE = "Antwort erhalten – Serie gestoppt, keine weitere E-Mail";
/** Gilt der Antwort-Stopp für diese Kampagne? Fehlt das Feld (alte Daten, alte Demo-Stände), ist er an. */
export function stopsOnReply(campaign: object | null | undefined): boolean { return (campaign as { stopOnReply?: boolean | null } | null | undefined)?.stopOnReply !== false; }
/** Offene Empfänger: nur diese bekommen noch E-Mails (fertig/fehler/abgemeldet/bounce/beschwerde sind endgültig). */
export const OPEN_RECIPIENT_STATUSES: RecipientStatus[] = ["wartet", "laeuft"];
export function isOpenRecipient(status: string | null | undefined): boolean { return status === "wartet" || status === "laeuft"; }
/** Muss dieser Empfänger wegen Antwort gestoppt werden? (offen und geantwortet) */
export function stoppedByReply(state: Pick<RecipientState, "status" | "repliedAt">): boolean { return Boolean(state.repliedAt) && isOpenRecipient(state.status); }
/** Führt einen Empfänger so weit wie möglich aus (bis Warten/Ende). send() liefert false, wenn der Versand fehlschlägt. */
/**
 * Versand-Rückruf: `true`/`false` – oder `{ ok, subject }` mit dem fertig gefüllten Betreff (steht dann im Verlauf statt der
 * Vorlage mit Platzhaltern). `stopped` (Text) bricht die Serie ohne Versand ab – z. B. wenn beim Nachprüfen direkt vor dem
 * Senden eine Antwort oder eine Sperre aufgetaucht ist.
 */
export type SendOutcome = boolean | { ok: boolean; subject?: string | null; stopped?: string | null };
export async function advanceRecipient(tree: EmailTree, state: RecipientState, now: Date, send: (node: Extract<EmailNode, { type: "send" }>, subject: string) => Promise<SendOutcome>, options: { window?: SendWindow | null; stopOnReply?: boolean | null } = {}): Promise<{ state: RecipientState; events: StepEvent[] }> {
  const events: StepEvent[] = []; let current = { ...state }; let guard = 0;
  // Ohne Schritt: ein frischer Empfänger beginnt vorn. Wer schon E-Mails bekommen hat, ist fertig – nie wieder von vorn, nie doppelt.
  if (!current.nodeId) { if (current.sentCount > 0 || current.lastSentAt) { current = { ...current, status: "fertig", nextActionAt: null }; events.push({ kind: "beendet", nodeId: "", note: "Kein weiterer Schritt – Ablauf beendet" }); return { state: current, events }; } current.nodeId = tree.start; }
  // Antwort-Stopp (Schalter „Bei Antwort anhalten“, Standard an): geantwortet → sofort beenden, egal wo der Ablauf gerade steht.
  if (options.stopOnReply !== false && stoppedByReply(current)) { const at = current.nodeId ?? ""; current = { ...current, status: "fertig", nodeId: null, nextActionAt: null }; events.push({ kind: "beendet", nodeId: at, note: REPLY_STOP_NOTE }); return { state: current, events }; }
  while (current.nodeId && guard < 12) {
    guard += 1; if (current.nextActionAt && current.nextActionAt > now) break; // noch nicht fällig
    const node = tree.nodes.find((item) => item.id === current.nodeId);
    if (!node) { current = { ...current, status: "fertig", nodeId: null, nextActionAt: null }; events.push({ kind: "beendet", nodeId: current.nodeId ?? "", note: "Schritt nicht gefunden – Ablauf beendet" }); break; }
    if (node.type === "end") { current = { ...current, status: "fertig", nodeId: null, nextActionAt: null }; events.push({ kind: "beendet", nodeId: node.id, note: node.label ?? "Ablauf beendet" }); break; }
    if (node.type === "wait") {
      if (current.waitingAt === node.id) { // Wartezeit lief schon und ist um: weiter zu dem Schritt, der JETZT dahinter steht – auch wenn der Ablauf inzwischen geändert wurde
        current = { ...current, status: "laeuft", nodeId: node.next, nextActionAt: null, waitingAt: null };
        if (!node.next) { current = { ...current, status: "fertig" }; events.push({ kind: "beendet", nodeId: node.id, note: "Wartezeit vorbei, kein weiterer Schritt – Ablauf beendet" }); }
        continue;
      }
      // Wartezeit beginnt: der Empfänger bleibt AM Warten-Schritt stehen (nicht schon am nächsten) – was danach kommt, wird erst am Ende der Wartezeit nachgesehen
      const due = new Date(now.getTime() + node.hours * 3_600_000); current = { ...current, status: "wartet", nodeId: node.id, nextActionAt: due, waitingAt: node.id };
      events.push({ kind: "gewartet", nodeId: node.id, note: `Wartet ${node.hours} Stunden (bis ${due.toLocaleString("de-DE")})` }); break;
    }
    if (node.type === "condition") { const since = current.lastSentAt ? new Date(current.lastSentAt.getTime() - 3000) : new Date(0); /* 3 s Toleranz (Sekundenrundung) */ const wanted = (node.url ?? "").trim().toLowerCase(); const clickedWanted = !wanted || (current.clickedUrls ?? []).some((url) => url.toLowerCase().includes(wanted)); const hit = node.check === "opened" ? Boolean(current.openedAt && current.openedAt >= since) : node.check === "clicked" ? Boolean(current.clickedAt && current.clickedAt >= since && clickedWanted) : Boolean(current.repliedAt && current.repliedAt >= since); const label = node.check === "opened" ? "geöffnet" : node.check === "clicked" ? (wanted ? `Link „${wanted.slice(0, 40)}“ geklickt` : "geklickt") : "geantwortet"; current = { ...current, nodeId: hit ? node.yes : node.no, nextActionAt: null }; events.push({ kind: "verzweigt", nodeId: node.id, note: hit ? `Wenn ${label}: ja → Dann-Zweig` : `Wenn ${label}: nein → Sonst-Zweig` }); if (!current.nodeId) { current = { ...current, status: "fertig" }; events.push({ kind: "beendet", nodeId: node.id, note: "Kein weiterer Schritt – Ablauf beendet" }); } continue; }
    if (node.type === "send") {
      if (current.nextActionAt && current.nextActionAt > now) break;
      if (current.sentNodeIds?.includes(node.id)) { // Schutz: dieselbe E-Mail geht in einem Durchlauf nie zweimal raus – z. B. wenn der Ablauf umgebaut wurde, während der Kontakt wartete
        current = { ...current, nodeId: node.next, nextActionAt: null }; events.push({ kind: "verzweigt", nodeId: node.id, note: `Übersprungen: E-Mail „${node.label?.trim() || node.subject}“ wurde schon gesendet` });
        if (!node.next) { current = { ...current, status: "fertig" }; events.push({ kind: "beendet", nodeId: node.id, note: "Kein weiterer Schritt – Ablauf beendet" }); }
        continue;
      }
      const slot = nextSendSlot(now, options.window); if (slot) { current = { ...current, status: "wartet", nextActionAt: slot }; events.push({ kind: "gewartet", nodeId: node.id, note: `Versandfenster: wartet bis ${slot.toLocaleString("de-DE", { timeZone: options.window?.timezone })}` }); break; }
      const template = subjectFor(node, current.variant); const outcome = await send(node, template);
      if (typeof outcome === "object" && outcome.stopped) { current = { ...current, status: "fertig", nodeId: null, nextActionAt: null }; events.push({ kind: "beendet", nodeId: node.id, note: outcome.stopped }); break; } // z. B. Antwort kurz vor dem Senden eingetroffen
      const ok = typeof outcome === "boolean" ? outcome : outcome.ok; const subject = (typeof outcome === "object" && outcome.subject) || template;
      if (!ok) { current = { ...current, status: "fehler", nextActionAt: null }; events.push({ kind: "fehler", nodeId: node.id, subject, note: "Versand fehlgeschlagen" }); break; }
      current = { ...current, status: "laeuft", sentCount: current.sentCount + 1, lastSentAt: now, nodeId: node.next, nextActionAt: null, sentNodeIds: [...(current.sentNodeIds ?? []), node.id] }; events.push({ kind: "gesendet", nodeId: node.id, subject, note: `E-Mail „${subject}“ gesendet${current.variant && node.subjectB?.trim() ? ` (Variante ${current.variant})` : ""}` });
      if (!node.next) { current = { ...current, status: "fertig" }; events.push({ kind: "beendet", nodeId: node.id, note: "Letzte E-Mail gesendet – Ablauf beendet" }); }
      continue;
    }
  }
  return { state: current, events };
}
/**
 * Wartezeit-Stand eines Empfängers aus seinem Verlauf – für den Zeitplaner (Server und Demo):
 * - `waitingAt`: der Warten-Schritt, dessen Wartezeit gerade läuft (letztes Ereignis ist „gewartet“ an einem Warten-Schritt des aktuellen Ablaufs)
 * - `sentNodeIds`: E-Mails, die er in diesem Durchlauf schon bekommen hat (nie doppelt)
 * - `nodeId`: Einträge aus der Zeit, als Wartende schon am Schritt NACH dem Warten standen, werden auf den Warten-Schritt gesetzt –
 *   so gilt auch für sie, was JETZT hinter der Wartezeit steht. Versandfenster-Pausen („gewartet“ an einer E-Mail) bleiben unberührt.
 */
const STEP_EVENT_KINDS = ["gesendet", "gewartet", "verzweigt", "beendet", "fehler"];
export function resolveWaiting(tree: EmailTree, recipient: { nodeId: string | null; status: string }, events: Array<{ id?: number; kind: string; nodeId?: string | null; createdAt: Date | string }>): { nodeId: string | null; waitingAt: string | null; sentNodeIds: string[] } {
  const ordered = [...events].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || Number(b.id ?? 0) - Number(a.id ?? 0));
  const sentNodeIds: string[] = []; for (const event of ordered) if (event.kind === "gesendet" && event.nodeId && !sentNodeIds.includes(event.nodeId)) sentNodeIds.push(event.nodeId);
  const latest = ordered.find((event) => STEP_EVENT_KINDS.includes(event.kind)); // Öffnungen/Klicks während der Wartezeit zählen nicht als Schritt
  const waitNode = latest?.kind === "gewartet" && latest.nodeId ? tree.nodes.find((node) => node.id === latest.nodeId && node.type === "wait") : undefined;
  if (!waitNode || recipient.status !== "wartet") return { nodeId: recipient.nodeId, waitingAt: null, sentNodeIds };
  return { nodeId: waitNode.id, waitingAt: waitNode.id, sentNodeIds };
}
export type SignatureParts = { html: string; text: string } | null | undefined;
export function renderNode(node: Extract<EmailNode, { type: "send" }>, design: EmailDesign, values: Record<string, string | null | undefined>, tracking: { pixelUrl?: string | null; wrapLink?: (url: string) => string; unsubscribeUrl?: string | null; logoBase?: string | null; preview?: boolean; subject?: string | null; signature?: SignatureParts } = {}) {
  const signature = usesSignature(design) && tracking.signature ? tracking.signature : null;
  return { subject: fillPlaceholdersSafe(tracking.subject ?? node.subject, values), html: renderEmailHtml(node.blocks, design, values, { trackingPixelUrl: tracking.pixelUrl ?? null, wrapLink: tracking.wrapLink, unsubscribeUrl: tracking.unsubscribeUrl ?? null, logoBase: tracking.logoBase ?? null, preview: tracking.preview, signatureHtml: signature?.html ?? null }), text: renderEmailText(node.blocks, values, signature?.text ?? null) };
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
  const total = recipients.length; const sent = recipients.filter((row) => row.sentCount > 0).length; const opened = recipients.filter((row) => row.openedAt || row.clickedAt || row.repliedAt).length; /* Klick oder Antwort beweist das Öffnen */ const clicked = recipients.filter((row) => row.clickedAt).length; const replied = recipients.filter((row) => row.repliedAt).length; const done = recipients.filter((row) => row.status === "fertig").length; const failed = recipients.filter((row) => row.status === "fehler").length; const bounced = recipients.filter((row) => row.status === "bounce" || row.status === "beschwerde").length; const unsubscribed = recipients.filter((row) => row.status === "abgemeldet").length;
  const variant = (key: AbVariant) => { const rows = recipients.filter((row) => row.variant === key && row.sentCount > 0); const openedV = rows.filter((row) => row.openedAt || row.clickedAt || row.repliedAt).length; const clickedV = rows.filter((row) => row.clickedAt).length; return { sent: rows.length, opened: openedV, clicked: clickedV, openRate: rows.length ? Math.round((openedV / rows.length) * 100) : 0, clickRate: rows.length ? Math.round((clickedV / rows.length) * 100) : 0 }; };
  const a = variant("A"); const b = variant("B");
  return { total, sent, opened, clicked, replied, done, failed, bounced, unsubscribed, openRate: sent ? Math.round((opened / sent) * 100) : 0, clickRate: sent ? Math.round((clicked / sent) * 100) : 0, bounceRate: sent ? Math.round((bounced / sent) * 100) : 0, abTest: a.sent || b.sent ? { a, b, winner: a.sent && b.sent ? (a.openRate === b.openRate ? null : a.openRate > b.openRate ? "A" : "B") : null } : null };
}

/**
 * Einen Schritt im Ablauf an eine andere Stelle hängen (E-Mail oder Wartezeit).
 * Zuerst wird er aus der Kette gelöst – der Vorgänger zeigt dann auf seinen Nachfolger –, danach an der
 * neuen Stelle eingesetzt: hinter einen Schritt (`branch: "next"`), in den Dann-/Sonst-Zweig einer
 * Verzweigung (`"yes"`/`"no"`) oder ganz an den Anfang (`parentId: null`).
 * Eine Schleife kann dabei nicht entstehen, weil der Schritt beim Einsetzen nicht mehr in der Kette hängt.
 */
export function moveNodeInTree(tree: EmailTree, id: string, parentId: string | null, branch: "next" | "yes" | "no"): EmailTree {
  const target = tree.nodes.find((node) => node.id === id);
  if (!target || (target.type !== "send" && target.type !== "wait") || parentId === id) return tree;
  const successor = target.next;
  let nodes: EmailNode[] = tree.nodes.map((node) => {
    if (node.id === id) return node;
    if (node.type === "condition") return { ...node, yes: node.yes === id ? successor : node.yes, no: node.no === id ? successor : node.no };
    if (node.type === "end") return node;
    return { ...node, next: node.next === id ? successor : node.next };
  });
  let start = tree.start === id ? successor : tree.start;
  const parent = parentId ? nodes.find((node) => node.id === parentId) ?? null : null;
  if (parentId && !parent) return tree;
  const oldTarget = parent ? (parent.type === "condition" ? (branch === "yes" ? parent.yes : parent.no) : parent.type === "end" ? null : parent.next) : start;
  nodes = nodes.map((node) => node.id === id ? ({ ...node, next: oldTarget } as EmailNode) : node);
  if (!parent) start = id;
  else nodes = nodes.map((node) => node.id === parent.id ? (node.type === "condition" ? { ...node, [branch === "yes" ? "yes" : "no"]: id } : node.type === "end" ? node : { ...node, next: id }) : node);
  return { start, nodes };
}

/* ---------------------------------------------------------------- Lead-Log (Verlauf je Empfänger) */
export const EVENT_KIND_LABEL: Record<string, string> = { gesendet: "E-Mail gesendet", geoeffnet: "Geöffnet", geklickt: "Link geklickt", gewartet: "Gewartet", verzweigt: "Verzweigung geprüft", beendet: "Beendet", fehler: "Fehler", abgemeldet: "Abgemeldet", bounce: "Unzustellbar", beschwerde: "Beschwerde" };
export function eventLabel(event: { kind: string; note?: string | null }): string { if (event.kind === "geoeffnet" && /^antwort/i.test(event.note ?? "")) return "Antwort erhalten"; if (event.kind === "gewartet" && /abwesenheitsnotiz/i.test(event.note ?? "")) return "Abwesenheitsnotiz"; if (event.kind === "gewartet" && /läuft weiter/i.test(event.note ?? "")) return "Antwort erhalten (Serie läuft weiter)"; if (event.kind === "verzweigt" && /^übersprungen/i.test(event.note ?? "")) return "E-Mail übersprungen (schon gesendet)"; return EVENT_KIND_LABEL[event.kind] ?? event.kind; }
export type LogStepState = "erledigt" | "aktuell" | "offen" | "uebersprungen" | "abgebrochen";
export type LogStep = { id: string; type: EmailNode["type"]; title: string; detail: string | null; state: LogStepState; at: Date | null; branch?: "yes" | "no" | null };
/** Kurzname eines Schritts: „E-Mail: Betreff“, „Warten 2 Tage“, „Wenn geöffnet“, „Ende“. */
export function nodeTitle(node: EmailNode): string {
  if (node.type === "send") return `E-Mail: ${node.label?.trim() || node.subject || "ohne Betreff"}`;
  if (node.type === "wait") { const h = node.hours; return `Warten ${h % 24 === 0 && h >= 24 ? `${h / 24} Tag${h / 24 === 1 ? "" : "e"}` : h % 168 === 0 ? `${h / 168} Woche${h / 168 === 1 ? "" : "n"}` : `${h} Std.`}`; }
  if (node.type === "condition") return `Wenn ${node.check === "opened" ? "geöffnet" : node.check === "clicked" ? (node.url ? `Link „${node.url.slice(0, 30)}“ geklickt` : "geklickt") : "geantwortet"}`;
  return node.label && node.label !== "Ende" ? `Ende – ${node.label}` : "Ende";
}
/**
 * Der Weg eines Empfängers durch den Ablauf, Schritt für Schritt: was erledigt ist (mit Zeitpunkt aus den Ereignissen), wo er
 * gerade steht, was noch offen ist. Bei einer noch nicht geprüften Verzweigung geht es mit dem Sonst-Zweig weiter (der Dann-Zweig
 * steht als Hinweis dabei), bei einer geprüften mit dem Zweig, der genommen wurde.
 */
export function recipientPath(tree: EmailTree, recipient: { nodeId: string | null; status: string; sentCount: number }, events: Array<{ kind: string; nodeId?: string | null; note?: string | null; subject?: string | null; createdAt: Date | string }>): LogStep[] {
  const byId = new Map(tree.nodes.map((node) => [node.id, node])); const steps: LogStep[] = []; const closed = !isOpenRecipient(recipient.status);
  const ordered = [...events].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const lastOf = (nodeId: string, kinds: string[]) => [...ordered].reverse().find((event) => event.nodeId === nodeId && kinds.includes(event.kind)) ?? null;
  let current: string | null = tree.start; let guard = 0; let reachedCurrent = false;
  while (current && guard < 40) {
    guard += 1; const node = byId.get(current); if (!node) break;
    const isCurrent = !closed && recipient.nodeId === node.id; if (isCurrent) reachedCurrent = true;
    if (node.type === "send") {
      const sent = lastOf(node.id, ["gesendet"]); const failed = lastOf(node.id, ["fehler"]); const stopped = lastOf(node.id, ["beendet"]);
      const state: LogStepState = sent ? "erledigt" : failed && !sent ? "abgebrochen" : isCurrent ? "aktuell" : reachedCurrent || closed ? (closed && !stopped ? "uebersprungen" : stopped ? "abgebrochen" : "offen") : "offen";
      steps.push({ id: node.id, type: "send", title: nodeTitle(node), detail: sent?.subject ? `Betreff: ${sent.subject}` : failed ? failed.note ?? "Versand fehlgeschlagen" : stopped ? stopped.note ?? null : null, state, at: sent ? new Date(sent.createdAt) : failed ? new Date(failed.createdAt) : null });
      current = node.next; continue;
    }
    if (node.type === "wait") {
      const waited = lastOf(node.id, ["gewartet"]); const passed = Boolean(waited) && recipient.nodeId !== node.id && (reachedCurrent === false || closed) && !isCurrent;
      const state: LogStepState = passed || (waited && recipient.nodeId && recipient.nodeId !== node.id && stepsAfter(tree, node.id, recipient.nodeId)) ? "erledigt" : isCurrent || (waited && recipient.nodeId === node.next && !closed) ? "aktuell" : closed ? "uebersprungen" : "offen";
      steps.push({ id: node.id, type: "wait", title: nodeTitle(node), detail: waited?.note ?? null, state, at: waited ? new Date(waited.createdAt) : null });
      current = node.next; continue;
    }
    if (node.type === "condition") {
      const checked = lastOf(node.id, ["verzweigt"]); const yes = checked ? /ja →/.test(checked.note ?? "") : null;
      const state: LogStepState = checked ? "erledigt" : isCurrent ? "aktuell" : closed ? "uebersprungen" : "offen";
      const yesNode = node.yes ? byId.get(node.yes) : null; const noNode = node.no ? byId.get(node.no) : null;
      steps.push({ id: node.id, type: "condition", title: nodeTitle(node), detail: checked ? checked.note ?? null : `Falls ja → ${yesNode ? nodeTitle(yesNode) : "Ende"} · falls nein → ${noNode ? nodeTitle(noNode) : "Ende"}`, state, at: checked ? new Date(checked.createdAt) : null, branch: checked ? (yes ? "yes" : "no") : null });
      current = checked ? (yes ? node.yes : node.no) : node.no; continue;
    }
    const ended = lastOf(node.id, ["beendet"]); const previousDone = steps.length > 0 && steps[steps.length - 1].state === "erledigt"; // fertig ohne eigenes Ende-Ereignis (ältere Daten): Ende gilt als erreicht
    steps.push({ id: node.id, type: "end", title: nodeTitle(node), detail: ended?.note ?? null, state: ended ? "erledigt" : recipient.status === "fertig" && previousDone ? "erledigt" : closed ? "uebersprungen" : "offen", at: ended ? new Date(ended.createdAt) : null });
    break;
  }
  return steps;
}
/** Liegt `target` im Ablauf hinter `from` (nur Hauptkette, ohne Zweige)? */
function stepsAfter(tree: EmailTree, from: string, target: string): boolean {
  const byId = new Map(tree.nodes.map((node) => [node.id, node])); let current: string | null = byId.get(from)?.type === "end" ? null : ((byId.get(from) as { next?: string | null } | undefined)?.next ?? null); let guard = 0;
  while (current && guard < 40) { guard += 1; if (current === target) return true; const node = byId.get(current); if (!node) return false; current = node.type === "condition" ? (node.no ?? node.yes) : node.type === "end" ? null : node.next; }
  return false;
}
/** „wartet noch 2 Tage 3 Std.“ / „fällig – nächster Lauf“ – für den Lead-Log. */
export function waitingText(nextActionAt: Date | string | null | undefined, status: string, now = new Date()): string | null {
  if (!isOpenRecipient(status)) return null; if (!nextActionAt) return "fällig – wird beim nächsten Lauf des Zeitplaners verarbeitet";
  const ms = new Date(nextActionAt).getTime() - now.getTime(); if (ms <= 0) return "fällig – wird beim nächsten Lauf des Zeitplaners verarbeitet";
  const minutes = Math.round(ms / 60_000); const days = Math.floor(minutes / 1440); const hours = Math.floor((minutes % 1440) / 60); const mins = minutes % 60;
  const parts = [days ? `${days} Tag${days === 1 ? "" : "e"}` : null, hours ? `${hours} Std.` : null, !days && mins ? `${mins} Min.` : null].filter(Boolean);
  return `wartet noch ${parts.join(" ") || "unter einer Minute"} – bis ${new Date(nextActionAt).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
}

/* ---------------------------------------------------------------- Mehrfach-Durchlauf je Kampagne */
/** Wie oft darf ein Kontakt durch diese Kampagne? 1 = einmal (Standard, Schalter aus), 2/3/5 = so oft, 0 = unbegrenzt. */
export const MAX_RUNS_OPTIONS: Array<{ value: number; label: string }> = [{ value: 1, label: "Aus – jeder Kontakt nur einmal" }, { value: 2, label: "Bis zu 2 Durchläufe" }, { value: 3, label: "Bis zu 3 Durchläufe" }, { value: 5, label: "Bis zu 5 Durchläufe" }, { value: 0, label: "Unbegrenzt" }];
export function maxRunsOf(campaign: object | null | undefined): number { const value = Number((campaign as { maxRuns?: number | null } | null | undefined)?.maxRuns ?? 1); return Number.isFinite(value) && value >= 0 ? Math.round(value) : 1; }
export function maxRunsLabel(maxRuns: number): string { return maxRuns === 0 ? "unbegrenzt viele Durchläufe" : maxRuns <= 1 ? "jeder Kontakt nur einmal" : `bis zu ${maxRuns} Durchläufe je Kontakt`; }
/**
 * Darf ein Kontakt (erneut) in die Kampagne? Nie, solange ein Durchlauf offen ist; nie nach Antwort, Bounce, Beschwerde oder
 * Abmeldung; sonst, solange die erlaubte Zahl nicht erreicht ist. Mit Standard 1 ist jeder Kontakt genau einmal dabei.
 * Ein Durchlauf, der am Versand gescheitert ist (Status „fehler“), zählt nicht – so lässt er sich nach dem Beheben wiederholen.
 */
export function canEnroll(previous: Array<{ status: string; repliedAt?: Date | string | null }>, maxRuns: number): { ok: boolean; reason: string | null } {
  if (previous.some((row) => isOpenRecipient(row.status))) return { ok: false, reason: "läuft bereits" };
  if (previous.some((row) => row.repliedAt)) return { ok: false, reason: "hat geantwortet" };
  if (previous.some((row) => row.status === "bounce" || row.status === "beschwerde" || row.status === "abgemeldet")) return { ok: false, reason: "gesperrt" };
  const completed = previous.filter((row) => row.status !== "fehler").length; // ein Versandfehler zählt nicht als Durchlauf – nach dem Beheben darf der Kontakt erneut rein
  if (maxRuns !== 0 && completed >= Math.max(1, maxRuns)) return { ok: false, reason: completed === 1 ? "war schon einmal dabei" : `schon ${completed}× dabei` };
  return { ok: true, reason: null };
}

/** Listen einer Zielgruppe „Liste“: neue Form `listNames` (mehrere), ältere Kampagnen haben nur `listName`. */
export function audienceLists(audience: { source?: string; listName?: string | null; listNames?: string[] | null } | null | undefined): string[] {
  if (!audience || audience.source !== "liste") return [];
  const names = [...(Array.isArray(audience.listNames) ? audience.listNames : []), ...(audience.listName ? [audience.listName] : [])].map((name) => String(name ?? "").trim()).filter(Boolean);
  return Array.from(new Set(names));
}
/** Zielgruppe mit diesen Listen (leer → Liste noch nicht gewählt). */
export function listAudience(names: string[]): { source: "liste"; listName: string | null; listNames: string[] } {
  const unique = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
  return { source: "liste", listName: unique[0] ?? null, listNames: unique };
}

/* ── Einzeln schreiben & freigeben (Erst-E-Mail je Lead) ─────────────────────────────────────────── */
/** Zustand des Entwurfs je Empfänger: noch keiner → „entwurf“ (KI/Vorlage geschrieben, wartet auf dich) → „freigegeben“ (geht raus). */
export type DraftState = "entwurf" | "freigegeben";
/** Kampagnen-Mails pro Tag für alle Kampagnen zusammen (Schutz der Absender-Adresse). */
export const DEFAULT_CAMPAIGN_DAILY_LIMIT = 50;
/** Beginn des heutigen Tages in der Zeitzone (für das Tageslimit). */
export function dayStartIn(now: Date, timezone = "Europe/Berlin"): Date {
  const { minutes } = zonedParts(now, timezone);
  return new Date(now.getTime() - minutes * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds());
}
/** Erste E-Mail des Ablaufs (vom Start aus, über Warten/Abfragen hinweg dem „Ja“-Zweig folgend). */
export function firstSendNode(tree: EmailTree): Extract<EmailNode, { type: "send" }> | null {
  let id: string | null | undefined = tree.start; const seen = new Set<string>();
  while (id && !seen.has(id)) { seen.add(id); const node = tree.nodes.find((item) => item.id === id); if (!node) return null; if (node.type === "send") return node; id = node.type === "condition" ? node.yes : node.type === "end" ? null : node.next; }
  return null;
}
/** Bausteine einer E-Mail als Fließtext (für den persönlichen Entwurf) – Platzhalter gefüllt; Überschrift, Knöpfe, Bilder und Signatur weggelassen (wie von Hand geschrieben). */
export function blocksToPlainText(blocks: EmailBlock[], values: Record<string, string | null | undefined>): string {
  const fill = (text: string) => fillPlaceholdersSafe(text, values);
  return blocks.map((block) => block.type === "text" ? fill(block.text) : block.type === "bullets" ? block.items.map((item) => `• ${fill(item)}`).join("\n") : "").filter((text) => text.trim()).join("\n\n").replace(/[ \t]{2,}/g, " ").replace(/ ,/g, ",").trim(); // leere Platzhalter (z. B. fehlende Anrede) hinterlassen keine Doppel-Leerzeichen
}
/** Freigegebener Entwurf → Bausteine: der Text ersetzt Überschrift/Text/Aufzählung, Knopf und Signatur der Vorlage bleiben. */
export function draftToBlocks(text: string, original: EmailBlock[]): EmailBlock[] {
  const keep = original.filter((block) => block.type === "button" || block.type === "signature");
  return [{ id: "draft-text", type: "text", text: text.trim() }, ...keep];
}

/* ── Drei Ansätze je Erst-E-Mail: Individuell, Drittanbieter, Freier Vorschlag ─────────────────── */
export type DraftApproach = "individuell" | "drittanbieter" | "frei";
export type DraftOption = { key: DraftApproach; label: string; subject: string; text: string };
export const DRAFT_APPROACHES: Array<{ key: DraftApproach; label: string; hint: string }> = [
  { key: "individuell", label: "Individueller Ansatz", hint: "Greift etwas Konkretes der Firma auf (Webseite, Standorte, Leistungen) und spiegelt es auf unser Angebot – kurz, persönlich, ohne Aufzählung." },
  { key: "drittanbieter", label: "Drittanbieter-Ansatz", hint: "Unsere Leads kommen schon über Drittpartner bei der Firma an – wir sind die direkte Quelle und bieten die direkte Zusammenarbeit an." },
  { key: "frei", label: "Freier Vorschlag", hint: "Eigene Idee der KI – ein anderer Einstieg, aber genauso persönlich auf die Firma zugeschnitten." },
];
export const approachLabel = (key: string | null | undefined) => DRAFT_APPROACHES.find((item) => item.key === key)?.label ?? "Entwurf";
/** Ohne KI: der Drittanbieter-Ansatz als feste Vorlage mit den Daten der Firma. */
export function thirdPartyTemplate(values: Record<string, string | null | undefined>): { subject: string; text: string } {
  const firma = (values.firma ?? "").trim() || "Ihr Unternehmen"; const anrede = values.nachname && values.anrede ? `Sehr geehrte${values.anrede === "Frau" ? "" : "r"} ${values.anrede} ${values.nachname},` : "Sehr geehrte Damen und Herren,";
  return { subject: `Direkte Zusammenarbeit statt Umweg über Drittpartner – ${firma}`.slice(0, 120), text: `${anrede}\n\nwir sind Tanesco Digital, einer der größten Leadlieferanten Deutschlands im Bereich Photovoltaik und Wärmepumpen, und seit über vier Jahren erfolgreich im Leadmarkt tätig.\n\nUns ist bekannt geworden, dass von uns generierte Leads bereits regelmäßig über Drittpartner bei ${firma} eingeliefert werden. Da wir die direkte Quelle dieser Interessenten sind, würden wir gerne die Möglichkeit einer unmittelbaren Zusammenarbeit mit Ihnen besprechen.\n\nWas uns als direkten Partner auszeichnet:\n\n• Eigene Leadgenerierung über Meta-Kampagnen (Facebook und Instagram)\n• Telefonische Vorqualifizierung jedes Interessenten\n• Interne Qualitätskontrolle für hohe Datenqualität\n• Hohe Skalierbarkeit – auch größere Volumina zuverlässig\n• Keine Vorkasse – Abrechnung erst nach vereinbarter Lieferung\n• Keine langfristige Vertragsbindung\n• Echtzeitübermittlung per API oder gewünschter Schnittstelle\n\nEine direkte Partnerschaft verkürzt die Lieferkette und bringt mehr Transparenz, schnellere Abstimmung und eine unmittelbare Qualitätskontrolle.\n\nWir freuen uns über Ihre Rückmeldung und die Möglichkeit eines persönlichen Telefonats.\n\nMit freundlichen Grüßen` };
}
