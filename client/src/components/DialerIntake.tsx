import { trpc } from "@/lib/trpc";
import { Check, CircleAlert, Clock, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

/**
 * „Was kommt vom Dialer an?“ – steht auf „Anbindung“ ganz oben. Zeigt für heute und die letzten 7 Tage, wie viele Gespräche
 * ankamen, wie viele grün wurden und wie viele Leads daraus entstanden sind; dazu, welche Angaben die letzte Meldung enthielt.
 * Grüne Gespräche ohne Lead lassen sich mit einem Klick nachholen.
 */
const when = (value: string | Date | null) => { if (!value) return "noch nie"; const date = new Date(value); const minutes = Math.round((Date.now() - date.getTime()) / 60_000); if (minutes < 1) return "gerade eben"; if (minutes < 60) return `vor ${minutes} Min.`; if (minutes < 24 * 60) return `vor ${Math.round(minutes / 60)} Std.`; return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) + ", " + date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr"; };
const num = (value: number) => value.toLocaleString("de-DE");

export default function DialerIntake() {
  const utils = trpc.useUtils();
  const intake = trpc.leadops.dialerIntake.useQuery(undefined, { retry: false, refetchInterval: 30_000 });
  const catchUp = trpc.leadops.leadsFromApprovedCalls.useMutation({ onSuccess: (result) => { toast.success(result.leads ? `${num(result.leads)} ${result.leads === 1 ? "Lead" : "Leads"} angelegt – sie stehen unter „Leads“.` : "Es gab nichts nachzuholen."); utils.leadops.dialerIntake.invalidate(); utils.leadops.listCalls.invalidate(); utils.leadops.listLeadsPaged.invalidate(); }, onError: (error) => toast.error(error.message) });
  const data = intake.data; if (!data) return null;
  const { today, week, verdict, contact } = data;
  const Icon = verdict.tone === "ok" ? Check : verdict.tone === "idle" ? Clock : CircleAlert;
  const steps: Array<[string, number, number, string]> = [["Angekommen", today.received, week.received, "Gespräche, die der Dialer gemeldet hat"], ["Grün", today.approved, week.approved, "von der Bewertung freigegeben"], ["Zur Prüfung", today.review, week.review, "warten auf deine Entscheidung"], ["Leads", today.leads, week.leads, "stehen unter „Leads“"]];
  const sent: Array<[string, boolean]> = contact ? [["Name oder Firma", contact.name], ["Anschrift", contact.address], ["E-Mail", contact.email], ["Leadsparte", contact.category], ["Ergebnis im Dialer", contact.result]] : [];
  return <section className={`gs-intake is-${verdict.tone}`} aria-label="Was kommt vom Dialer an?">
    <header className="gs-intake-head"><span className="gs-intake-icon"><Icon aria-hidden="true" /></span><div><h3>{verdict.title}</h3><p>{verdict.text}</p></div><small>Letzte Meldung: {when(data.lastAt)}</small></header>
    <ol className="gs-intake-steps">{steps.map(([label, day, seven, hint]) => <li key={label} title={hint}><b>{num(day)}</b><span>{label}</span><small>7 Tage: {num(seven)}</small></li>)}</ol>
    {data.approvedWithoutLead > 0 && <div className="gs-intake-fix"><p><b>{num(data.approvedWithoutLead)} {data.approvedWithoutLead === 1 ? "grünes Gespräch hat" : "grüne Gespräche haben"} noch keinen Lead.</b> Der Dialer hat dazu keinen Kontakt mitgeschickt. Die Software legt die Leads an – Name und Ort liest die KI aus dem Gespräch.</p><button type="button" className="gs-btn is-strong" disabled={catchUp.isPending} onClick={() => catchUp.mutate()}>{catchUp.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <UserPlus aria-hidden="true" />}{catchUp.isPending ? "Legt Leads an …" : "Leads jetzt anlegen"}</button></div>}
    {contact && <div className="gs-intake-sent"><b>Das schickt der Dialer mit</b><ul>{sent.map(([label, ok]) => <li key={label} className={ok ? "is-yes" : "is-no"}>{ok ? <Check aria-hidden="true" /> : <i aria-hidden="true" />}{label}<span className="sr-only">{ok ? " – kommt an" : " – fehlt"}</span></li>)}</ul>
      <p>{contact.name ? "Der Kontakt kommt an – der Lead bekommt die Angaben vom Dialer." : "In der letzten Meldung stand kein Name. Der Lead entsteht trotzdem: Name und Ort liest die KI aus dem Gespräch. Vollständiger wird er, wenn der Dialer den Kontakt mitschickt."}</p>
      {data.fields.length > 0 && <details><summary>Felder der letzten Meldung ({data.fields.length})</summary><code>{data.fields.join(" · ")}</code></details>}</div>}
  </section>;
}
