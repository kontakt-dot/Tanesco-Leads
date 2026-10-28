/**
 * Wann gehen die nächsten Follow-up-E-Mails raus? Vorhersage je Kampagne aus dem Stand der Empfänger – so, wie der Zeitplaner
 * (processEmailCampaigns + advanceRecipient) es machen wird:
 * - Wartezeit läuft → endet bei `nextActionAt`; danach die Wenn-Abfragen mit dem heutigen Stand (geöffnet/geklickt/geantwortet)
 *   bis zur nächsten E-Mail. Schon gesendete E-Mails werden übersprungen, „Ende“ heißt: kein Follow-up mehr.
 * - Versandfenster: außerhalb wartet die E-Mail bis zum nächsten Fenster (Viertelstunden-Raster wie nextSendSlot).
 * - Drip: höchstens so viele E-Mails pro Stunde je Kampagne (gleichmäßig verteilt gerechnet).
 * - Tageslimit: gilt für alle Kampagnen zusammen – was an einem Tag nicht mehr passt, geht am nächsten Tag raus.
 *   Dafür zählen auch fällige Erst-E-Mails mit (sie verbrauchen dasselbe Limit), angezeigt werden nur die Follow-ups.
 * - „Jede E-Mail freigeben“: Follow-ups gehen erst nach deiner Freigabe raus – gezeigt wird, ab wann sie zur Freigabe anstehen.
 * Gemeinsam für Server und Chat-Demo; reine Rechnung ohne Datenbank.
 */
import { effectiveDripPerHour, pauseOf, resolveDrip, windowForDay, type EmailTree, type SendWindow } from "./email-campaigns";

type Stamp = Date | string | null | undefined;
export type PlanRecipient = { id: number; nodeId: string | null; status: string; sentCount: number; nextActionAt: Stamp; lastSentAt: Stamp; openedAt?: Stamp; clickedAt?: Stamp; repliedAt?: Stamp; clickedUrls?: string[] | null; sentNodeIds?: string[] | null; draftState?: string | null; draftNodeId?: string | null };
export type PlanCampaign = { id: number; status: string; tree: EmailTree; window: SendWindow; stopOnReply: boolean; approval: boolean; lastSentAt?: Stamp; recipients: PlanRecipient[] };
/** Ein Tag mit Follow-ups: erste und letzte vorhergesagte Uhrzeit, Anzahl. `day` = JJJJ-MM-TT (deutsche Zeit). */
export type FollowUpDay = { day: string; first: Date; last: Date; count: number };
export type FollowUpPlan = {
  /** offene Follow-ups: Kontakte, die schon eine E-Mail haben und laut Ablauf noch eine bekommen */
  total: number;
  /** vorhergesagt nach Tagen (nur die, die ohne dein Zutun rausgehen) */
  days: FollowUpDay[];
  /** außerhalb der gerechneten Tage */
  later: number;
  /** „Jede E-Mail freigeben“: so viele Follow-ups stehen zur Freigabe an, das erste ab `first` */
  approval: { count: number; first: Date | null } | null;
  /** Kampagne pausiert – nichts geht raus, bis sie weiterläuft */
  paused: boolean;
  /** Tageslimit (alle Kampagnen zusammen) schiebt Follow-ups dieser Kampagne auf spätere Tage */
  delayedByLimit: boolean;
  /** Drip: höchstens so viele pro Stunde (null = ohne Drip) */
  perHour: number | null;
};

const HOUR = 3_600_000; const DAY = 86_400_000; const STEP = 15 * 60_000;
const CAP_ZONE = "Europe/Berlin"; // Tageslimit zählt ab Mitternacht deutscher Zeit (wie dayStartIn)

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsAt(ms: number, timezone: string) {
  let format = formatters.get(timezone);
  if (!format) { try { format = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }); } catch { format = new Intl.DateTimeFormat("en-US", { timeZone: CAP_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }); } formatters.set(timezone, format); }
  const parts = format.formatToParts(new Date(ms)); const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), h: Number(get("hour")) % 24, mi: Number(get("minute")), s: Number(get("second")), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")) };
}
/** Abstand der Zeitzone zu UTC in ms zu diesem Zeitpunkt (Sommerzeit inklusive). */
function offsetAt(ms: number, timezone: string) { const whole = Math.floor(ms / 1000) * 1000; const p = partsAt(whole, timezone); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - whole; }
const pad = (n: number) => String(n).padStart(2, "0");
/** Kalendertag (deutsche Zeit) als JJJJ-MM-TT. */
export function planDayKey(value: Date | number, timezone = CAP_ZONE) { const p = partsAt(typeof value === "number" ? value : value.getTime(), timezone); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }
/** Beginn des nächsten Tages (Mitternacht deutscher Zeit) nach diesem Zeitpunkt. */
function nextDayStart(ms: number, timezone = CAP_ZONE) { const p = partsAt(ms, timezone); const guess = Date.UTC(p.y, p.m - 1, p.d + 1, 0, 0); return guess - offsetAt(guess - offsetAt(ms, timezone), timezone); }

/** Versandfenster als feste Zeiträume [von, bis) ab `fromMs` für `days` Tage – mit Ausnahmen je Wochentag und Mittagspause. */
export function windowIntervals(window: SendWindow, fromMs: number, days: number): Array<[number, number]> {
  if (!window.enabled) return [[Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]];
  const zone = window.timezone || CAP_ZONE; const today = partsAt(fromMs, zone); const pause = pauseOf(window); const out: Array<[number, number]> = [];
  const minutes = (time: string) => { const [h, m] = time.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  for (let i = -1; i <= days; i += 1) {
    const noonGuess = Date.UTC(today.y, today.m - 1, today.d + i, 12, 0); const offset = offsetAt(noonGuess - offsetAt(noonGuess, zone), zone);
    const p = partsAt(noonGuess - offset, zone); const day = windowForDay(window, p.weekday); if (!day) continue;
    const at = (mins: number) => Date.UTC(p.y, p.m - 1, p.d, Math.floor(mins / 60), mins % 60) - offset;
    const from = minutes(day.from); const to = minutes(day.to);
    // wie im Zeitplaner: drin ist [von, bis) ohne [Pause von, Pause bis)
    const pieces: Array<[number, number]> = pause ? [[from, Math.min(to, minutes(pause.from))], [Math.max(from, minutes(pause.to)), to]] : [[from, to]];
    for (const [start, end] of pieces) if (end > start) out.push([at(start), at(end)]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
/** Nächster Versand-Zeitpunkt ab `ms`: jetzt (im Fenster) oder wie nextSendSlot in Viertelstunden-Schritten bis ins nächste Fenster. */
function slotFrom(ms: number, intervals: Array<[number, number]>): number | null {
  for (const [start, end] of intervals) {
    if (ms >= end) continue; if (ms >= start) return ms;
    const t = ms + Math.ceil((start - ms) / STEP) * STEP; if (t < end) return t;
  }
  return null;
}
const time = (value: Stamp) => (value ? new Date(value).getTime() : null);

/** Nächste E-Mail eines Empfängers: welcher Schritt und ab wann fällig (vor dem Versandfenster). `null` = keine weitere E-Mail. */
export function nextEmailOf(tree: EmailTree, recipient: PlanRecipient, now: number, stopOnReply = true): { nodeId: string; readyAt: number } | null {
  if (recipient.status !== "wartet" && recipient.status !== "laeuft") return null;
  const replied = time(recipient.repliedAt); if (stopOnReply && replied) return null; // Antwort-Stopp: es geht nichts mehr raus
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  let id: string | null = recipient.nodeId ?? (recipient.sentCount > 0 || recipient.lastSentAt ? null : tree.start); // ohne Schritt: frisch → vorn, sonst fertig
  const sent = new Set(recipient.sentNodeIds ?? []); const nextAction = time(recipient.nextActionAt);
  let at = Math.max(now, nextAction ?? now); let first = true;
  const since = (time(recipient.lastSentAt) ?? 0) - 3000; // wie im Zeitplaner: 3 s Toleranz
  for (let guard = 0; guard < 24 && id; guard += 1) {
    const node = byId.get(id); if (!node || node.type === "end") return null;
    if (node.type === "wait") { at = first && recipient.status === "wartet" && nextAction ? Math.max(now, nextAction) /* Wartezeit läuft schon */ : at + node.hours * HOUR; id = node.next; first = false; continue; }
    first = false;
    if (node.type === "condition") {
      const opened = time(recipient.openedAt); const clicked = time(recipient.clickedAt); const wanted = (node.url ?? "").trim().toLowerCase();
      const hit = node.check === "opened" ? Boolean(opened && opened >= since) : node.check === "clicked" ? Boolean(clicked && clicked >= since && (!wanted || (recipient.clickedUrls ?? []).some((url) => url.toLowerCase().includes(wanted)))) : Boolean(replied && replied >= since);
      id = hit ? node.yes : node.no; continue;
    }
    if (sent.has(node.id)) { id = node.next; continue; } // dieselbe E-Mail geht nie zweimal raus
    return { nodeId: node.id, readyAt: at };
  }
  return null;
}

type Item = { campaignId: number; recipientId: number; followUp: boolean; readyAt: number };
/**
 * Vorhersage für alle Kampagnen eines Kontos zusammen (wegen des gemeinsamen Tageslimits).
 * `todayLeft` = heute noch erlaubte Kampagnen-Mails, `dailyLimit` = Limit je Tag. `days` = so weit wird gerechnet (Standard 21).
 */
export function planFollowUps(campaigns: PlanCampaign[], options: { now: Date; todayLeft: number; dailyLimit: number; days?: number }): Map<number, FollowUpPlan> {
  const now = options.now.getTime(); const horizonDays = options.days ?? 21; const horizon = now + horizonDays * DAY;
  const result = new Map<number, FollowUpPlan>();
  type Lane = { id: number; intervals: Array<[number, number]>; gap: number; nextAllowed: number; queue: Item[] };
  const lanes: Lane[] = []; const blocked = new Map<number, number[]>(); // Freigabe nötig: fällig ab …
  for (const campaign of campaigns) {
    const drip = resolveDrip(campaign.window.drip); const perHour = drip.enabled ? effectiveDripPerHour(drip) : null;
    const plan: FollowUpPlan = { total: 0, days: [], later: 0, approval: campaign.approval ? { count: 0, first: null } : null, paused: campaign.status === "pausiert", delayedByLimit: false, perHour };
    result.set(campaign.id, plan);
    const intervals = windowIntervals(campaign.window, now, horizonDays + 1);
    const items: Item[] = []; const waitingApproval: number[] = [];
    for (const recipient of campaign.recipients) {
      const next = nextEmailOf(campaign.tree, recipient, now, campaign.stopOnReply); if (!next) continue;
      const followUp = recipient.sentCount > 0;
      if (followUp) plan.total += 1;
      const approved = recipient.draftState === "freigegeben" && (recipient.draftNodeId ? recipient.draftNodeId === next.nodeId : recipient.sentCount === 0);
      if (campaign.approval && !approved) { if (followUp) { const slot = slotFrom(next.readyAt, intervals); waitingApproval.push(slot ?? next.readyAt); } continue; } // geht erst nach deiner Freigabe raus
      items.push({ campaignId: campaign.id, recipientId: recipient.id, followUp, readyAt: next.readyAt });
    }
    if (plan.approval) { plan.approval.count = waitingApproval.length; plan.approval.first = waitingApproval.length ? new Date(Math.min(...waitingApproval)) : null; }
    blocked.set(campaign.id, waitingApproval);
    if (campaign.status !== "aktiv") continue; // pausiert/Entwurf: es geht nichts raus
    items.sort((a, b) => a.readyAt - b.readyAt || a.recipientId - b.recipientId);
    const gap = perHour ? HOUR / perHour : 0; const last = time(campaign.lastSentAt);
    lanes.push({ id: campaign.id, intervals, gap, nextAllowed: last && gap ? Math.max(now, last + gap) : now, queue: items });
  }
  // Ablauf wie im Minutentakt: immer die Kampagne, die als Nächste senden darf; das Tageslimit gilt für alle zusammen
  const sentAt = new Map<number, number[]>(); let capDayEnd = nextDayStart(now); let capLeft = Math.max(0, options.todayLeft); let blockedUntil = capLeft > 0 ? now : capDayEnd;
  const delayed = new Set<number>();
  if (capLeft <= 0) for (const lane of lanes) { const head = lane.queue.find((item) => item.followUp); const at = head ? slotFrom(Math.max(head.readyAt, lane.nextAllowed), lane.intervals) : null; if (at !== null && at < blockedUntil) delayed.add(lane.id); } // heute schon voll
  for (let guard = 0; guard < 200_000; guard += 1) {
    let best: { lane: Lane; at: number } | null = null;
    for (const lane of lanes) {
      const head = lane.queue[0]; if (!head) continue;
      const at = slotFrom(Math.max(head.readyAt, lane.nextAllowed, blockedUntil), lane.intervals); if (at === null || at > horizon) { lane.queue.length = 0; continue; }
      if (!best || at < best.at || (at === best.at && lane.id < best.lane.id)) best = { lane, at };
    }
    if (!best) break;
    if (best.at >= capDayEnd) { capDayEnd = nextDayStart(best.at); capLeft = Math.max(0, options.dailyLimit); } // neuer Tag → volles Limit
    if (capLeft <= 0) { blockedUntil = capDayEnd; for (const lane of lanes) if (lane.queue[0] && lane.queue[0].followUp) delayed.add(lane.id); continue; } // Tageslimit voll → morgen weiter
    const item = best.lane.queue.shift()!; capLeft -= 1; best.lane.nextAllowed = best.at + best.lane.gap;
    if (item.followUp) { const list = sentAt.get(item.campaignId) ?? []; list.push(best.at); sentAt.set(item.campaignId, list); }
  }
  for (const [campaignId, plan] of Array.from(result.entries())) {
    const times = sentAt.get(campaignId) ?? []; const byDay = new Map<string, FollowUpDay>();
    for (const at of times) { const key = planDayKey(at); const entry = byDay.get(key); if (entry) { entry.count += 1; if (at < entry.first.getTime()) entry.first = new Date(at); if (at > entry.last.getTime()) entry.last = new Date(at); } else byDay.set(key, { day: key, first: new Date(at), last: new Date(at), count: 1 }); }
    plan.days = Array.from(byDay.values()).sort((a, b) => a.first.getTime() - b.first.getTime());
    plan.later = Math.max(0, plan.total - times.length - (plan.approval?.count ?? 0));
    plan.delayedByLimit = delayed.has(campaignId) && plan.days.length > 0;
    if (plan.paused) plan.days = []; // pausiert: keine Zeiten – es geht erst weiter, wenn du sie wieder startest
  }
  return result;
}
