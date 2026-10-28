import { Clock3, Pause, PenLine } from "lucide-react";

/**
 * „Nächste Follow-ups: Do 29.10. ab 09:00 · 14 E-Mails“ – in der Kampagnen-Übersicht und oben in einer Kampagne.
 * Die Zeiten rechnet der Server (shared/follow-up-plan.ts) wie der Zeitplaner: Wartezeit, Versandfenster, E-Mails pro Stunde
 * und das Tageslimit für alle Kampagnen zusammen. Darunter die folgenden Tage, im Hinweis (Maus drüber) alle Tage mit Uhrzeit.
 */
type Stamp = Date | string;
export type FollowUpView = { total: number; days: Array<{ day: string; first: Stamp; last: Stamp; count: number }>; later: number; approval: { count: number; first: Stamp | null } | null; paused: boolean; delayedByLimit: boolean; perHour: number | null };

const ZONE = "Europe/Berlin";
const dateKey = (value: Date) => value.toLocaleDateString("de-DE", { timeZone: ZONE });
/** „heute“, „morgen“ oder „Do 29.10.“ (deutsche Zeit) */
export function dayWord(value: Stamp, now = new Date()) {
  const date = new Date(value); const key = dateKey(date);
  if (key === dateKey(now)) return "heute";
  if (key === dateKey(new Date(now.getTime() + 86_400_000))) return "morgen";
  return `${date.toLocaleDateString("de-DE", { timeZone: ZONE, weekday: "short" }).replace(/\.$/, "")} ${date.toLocaleDateString("de-DE", { timeZone: ZONE, day: "2-digit", month: "2-digit" })}`;
}
export const clock = (value: Stamp) => new Date(value).toLocaleTimeString("de-DE", { timeZone: ZONE, hour: "2-digit", minute: "2-digit" });
const mails = (count: number) => `${count} E-Mail${count === 1 ? "" : "s"}`;
const followUps = (count: number) => `${count} Follow-up${count === 1 ? "" : "s"}`;

/** `withApproval={false}`: ohne den Freigabe-Hinweis – den zeigt dann der gemeinsame Freigabe-Hinweis der Kampagne (Erst-E-Mails und Follow-ups zusammen). */
export default function FollowUpLine({ plan, sentAny, className = "", withApproval = true }: { plan: FollowUpView | null | undefined; sentAny: boolean; className?: string; withApproval?: boolean }) {
  if (!plan) return null;
  const now = new Date();
  if (plan.paused) return plan.total > 0 ? <span className={`cl-next is-paused ${className}`} title="Die Kampagne ist pausiert – die Follow-ups gehen erst raus, wenn du sie fortsetzt."><Pause aria-hidden="true" /><span>Pausiert – <span className="nw">{followUps(plan.total)}</span> {plan.total === 1 ? "wartet" : "warten"}</span></span> : null;
  const [first, ...rest] = plan.days;
  const approval = plan.approval && plan.approval.count > 0 ? plan.approval : null;
  const hint = [
    ...plan.days.map((day) => `${dayWord(day.first, now)}: ${mails(day.count)}${clock(day.first) === clock(day.last) ? ` um ${clock(day.first)}` : `, ${clock(day.first)}–${clock(day.last)} Uhr`}`),
    plan.later > 0 ? `später: ${mails(plan.later)}` : null,
    approval ? `${followUps(approval.count)} brauchen erst deine Freigabe` : null,
    plan.perHour ? `Verteilt im Versandfenster, höchstens ${plan.perHour} pro Stunde.` : null,
    plan.delayedByLimit ? "Das Tageslimit (für alle Kampagnen zusammen) schiebt einen Teil auf die nächsten Tage." : null,
    "Stand jetzt – wer vorher antwortet, bekommt kein Follow-up mehr.",
  ].filter(Boolean).join("\n");
  const approvalLine = approval && withApproval ? <span className={`cl-next is-approval ${className}`} title={hint}><PenLine aria-hidden="true" /><span>{approval.first && new Date(approval.first).getTime() > now.getTime() + 60_000 ? <><span className="nw">{followUps(approval.count)}</span> zur Freigabe ab <b>{dayWord(approval.first, now)} {clock(approval.first)} Uhr</b></> : <><span className="nw">{followUps(approval.count)}</span> {approval.count === 1 ? "wartet" : "warten"} auf deine Freigabe</>}</span></span> : null;
  if (!first) {
    if (approvalLine) return approvalLine;
    if (plan.later > 0) return <span className={`cl-next ${className}`} title={hint}><Clock3 aria-hidden="true" /><span>Nächste Follow-ups erst in mehr als 3 Wochen · {mails(plan.later)}</span></span>;
    return plan.total === 0 && sentAny ? <span className={`cl-next is-done ${className}`} title="Gerade wartet niemand in dieser Kampagne auf ein Follow-up.">
      <Clock3 aria-hidden="true" /><span>Keine Follow-ups offen</span></span> : null;
  }
  const goingNow = dayWord(first.first, now) === "heute" && new Date(first.first).getTime() <= now.getTime() + 2 * 60_000;
  const restCount = rest.slice(3).reduce((sum, day) => sum + day.count, 0) + plan.later;
  return <>
    <span className={`cl-next ${className}`} title={hint}><Clock3 aria-hidden="true" /><span>{goingNow
      ? <><span className="nw">Follow-ups gehen gerade raus</span> · <b>heute noch {first.count}</b>{clock(first.last) !== clock(first.first) ? <span className="nw"> bis ca. {clock(first.last)} Uhr</span> : null}</>
      : <><span className="nw">Nächste Follow-ups:</span> <b>{dayWord(first.first, now)} ab {clock(first.first)} Uhr</b> <span className="nw">· {mails(first.count)}</span></>}</span></span>
    {(rest.length > 0 || plan.later > 0) && <span className={`cl-next-more ${className}`} title={hint}>danach {rest.slice(0, 3).map((day) => `${dayWord(day.first, now)} (${day.count})`).join(" · ")}{restCount > 0 ? `${rest.length ? " · " : ""}+${restCount} später` : ""}</span>}
    {approvalLine}
  </>;
}
