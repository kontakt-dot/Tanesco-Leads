/**
 * Doppelt-Schutz der E-Mail-Kampagnen – die reinen Regeln (Server: server/send-log.ts, Chat-Demo: client/src/demo/backend.ts).
 *
 * - `replayPosition`: Wo steht ein Kontakt, der diese E-Mails schon bekommen hat (aus dem Versand-Protokoll)? Er macht dort weiter –
 *   in der Wartezeit nach der letzten E-Mail, am nächsten Schritt oder fertig. Nie geht eine E-Mail doppelt raus.
 * - `withSendLog`: Zahlen einer Kampagne mit dem Protokoll – „Gesendet“ zählt alles, was wirklich rausging (auch an inzwischen
 *   entfernte Empfänger), dazu „heute“.
 */
import { firstSendNode, type EmailNode, type EmailTree } from "./email-campaigns";

/** Anfang der Notiz an nachgetragenen „gesendet“-Ereignissen – so erkennt man sie wieder (z. B. beim Aufräumen doppelter Einträge). */
export const RESTORED_NOTE = "Wiederhergestellt:";
/** Anfang des Hinweises im Pipeline-Verlauf, den die erste Kampagnen-E-Mail an einen Kontakt hinterlässt (server/sent-card.ts). */
export const sentTracePrefix = (campaignName: string) => `E-Mail aus „${campaignName.slice(0, 160)}“ versendet`;

export type SendRecord = { nodeId: string | null; at: Date; sender?: string | null; logId?: number | null };
type Position = { status: "wartet" | "laeuft" | "fertig"; nodeId: string | null; nextActionAt: Date | null; wait: Extract<EmailNode, { type: "wait" }> | null };
/**
 * Wo steht ein Kontakt, der diese E-Mails schon bekommen hat? Nach der letzten E-Mail des Durchlaufs: in deren Wartezeit (bis
 * letzte E-Mail + Wartezeit), am nächsten Schritt – oder fertig, wenn es die letzte war. Schritte, die es im Ablauf nicht mehr gibt,
 * zählen als Erst-E-Mail (die ging sicher raus). Nur der letzte Durchlauf zählt (ab der letzten Erst-E-Mail).
 */
export function replayPosition(tree: EmailTree, sends: SendRecord[]): { sends: Array<SendRecord & { nodeId: string }>; position: Position } | null {
  const first = firstSendNode(tree); if (!first || !sends.length) return null;
  const sendNode = (id: string | null) => (id ? tree.nodes.find((node): node is Extract<EmailNode, { type: "send" }> => node.id === id && node.type === "send") ?? null : null);
  const ordered = [...sends].sort((a, b) => a.at.getTime() - b.at.getTime()).map((send, index) => ({ ...send, nodeId: sendNode(send.nodeId) ? String(send.nodeId) : index === 0 ? first.id : "" })).filter((send) => send.nodeId);
  let start = 0; ordered.forEach((send, index) => { if (send.nodeId === first.id) start = index; }); // letzter Durchlauf
  const run: Array<SendRecord & { nodeId: string }> = []; for (const send of ordered.slice(start)) if (!run.some((item) => item.nodeId === send.nodeId)) run.push(send);
  if (!run.length) return null;
  const last = run[run.length - 1]; const node = sendNode(last.nodeId)!;
  const next = node.next ? tree.nodes.find((item) => item.id === node.next) ?? null : null;
  if (!next) return { sends: run, position: { status: "fertig", nodeId: null, nextActionAt: null, wait: null } };
  if (next.type === "wait") return { sends: run, position: { status: "wartet", nodeId: next.id, nextActionAt: new Date(last.at.getTime() + next.hours * 3_600_000), wait: next } };
  return { sends: run, position: { status: "laeuft", nodeId: next.id, nextActionAt: null, wait: null } };
}

/**
 * Zahlen einer Kampagne mit dem Versand-Protokoll: Die Kennzahlen selbst zählen nur, wer noch in der Kampagne ist (gelöschte Kontakte
 * verschwinden aus „Gesendet“, „Geöffnet“ …). Dazu kommen aus dem Protokoll `sentGone` – E-Mails, die an inzwischen entfernte oder gelöschte
 * Empfänger rausgingen – und `sentToday`: was heute wirklich rausging (auch an Entfernte).
 */
export function withSendLog<T extends { mails?: { sent: number; opened: number; clicked: number; replied: number } | null }>(stats: T, logged: number, today: number): T & { sentGone: number; sentToday: number } {
  const mails = stats.mails ?? { sent: 0, opened: 0, clicked: 0, replied: 0 };
  return { ...stats, sentGone: Math.max(0, logged - mails.sent), sentToday: today };
}
