import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, CheckCircle2, Circle, CircleDot, Clock3, ExternalLink, Flag, GitBranch, Mail, MinusCircle, XCircle } from "lucide-react";

/**
 * Lead-Log: alles, was mit einem Empfänger in einer E-Mail-Serie passiert – anklickbar aus der Kampagnen-Ansicht.
 * Oben der Stand (Status, Pipeline-Stufe, wie lange er noch wartet), dann Fehler mit Grund, der Weg durch den Ablauf
 * (erledigt / aktuell / offen) und die Ereignisse in Zeitfolge. Unten: alle Durchläufe desselben Kontakts.
 */
const stamp = (value: string | Date | null | undefined) => value ? new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–";
const STATUS: Record<string, string> = { wartet: "Wartet", laeuft: "Läuft", fertig: "Fertig", fehler: "Fehler", abgemeldet: "Abgemeldet", bounce: "Unzustellbar", beschwerde: "Beschwerde" };
const STEP_ICON = { send: Mail, wait: Clock3, condition: GitBranch, end: Flag } as const;

export default function LeadLogDialog({ recipientId, onClose, onOpenLead }: { recipientId: number | null; onClose: () => void; onOpenLead?: (publicId: string) => void }) {
  const log = trpc.leadops.emailRecipientLog.useQuery({ recipientId: recipientId ?? 0 }, { enabled: recipientId !== null, retry: false, refetchInterval: 30_000 });
  const data = log.data;
  return <Dialog open={recipientId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="leadlog-dialog">
      {!data ? <DialogHeader><DialogTitle>Lead-Log</DialogTitle><DialogDescription>{log.error ? log.error.message : "Wird geladen …"}</DialogDescription></DialogHeader> : <>
        <DialogHeader className="leadlog-head">
          <div>
            <DialogTitle className="leadlog-title">{data.recipient.name || data.lead?.name || data.recipient.email}</DialogTitle>
            <DialogDescription className="leadlog-desc">{data.recipient.email}{data.recipient.company ? ` · ${data.recipient.company}` : ""} · Serie „{data.campaign.name}“{data.recipient.variant ? ` · Variante ${data.recipient.variant}` : ""}</DialogDescription>
          </div>
          <div className="leadlog-badges">
            <span className={`leadlog-status is-${data.recipient.status}`}>{data.recipient.status === "fertig" && data.recipient.repliedAt ? "Gestoppt – hat geantwortet" : STATUS[data.recipient.status] ?? data.recipient.status}</span>
            {data.lead?.stage && <button type="button" className="leadlog-stage" title="Pipeline-Stufe – Klick öffnet die Karte" onClick={() => data.lead && onOpenLead?.(data.lead.publicId)}>Stufe: {data.lead.stage.label}{data.lead.owner ? ` · ${data.lead.owner}` : ""} <ExternalLink className="h-3 w-3" aria-hidden="true" /></button>}
            {data.lead && !data.lead.stage && <span className="leadlog-stage is-muted">Nicht in der Pipeline</span>}
          </div>
        </DialogHeader>
        <div className="leadlog-body">
          {data.errors.length > 0 && <section className="leadlog-errors"><strong><AlertTriangle className="h-4 w-4" aria-hidden="true" /> {data.errors.length === 1 ? "Ein Fehler" : `${data.errors.length} Fehler`}</strong>{data.errors.map((error, index) => <p key={index}><span>{stamp(error.at)}</span> {error.note}</p>)}<small>Fehler stoppen den Ablauf für diesen Empfänger. Nach dem Beheben (Absender, Server, Adresse) kann die Kampagne ihn beim nächsten Start erneut aufnehmen.</small></section>}
          <section className="leadlog-now">
            <div><span className="eyebrow">STAND</span><strong>{data.waiting ? data.waiting : data.recipient.status === "fertig" ? "Ablauf beendet – keine weitere E-Mail" : data.recipient.status === "fehler" ? "Angehalten wegen Fehler" : "Keine weiteren Schritte"}</strong>{data.currentStep && data.waiting && <small>Nächster Schritt: {data.steps.find((step) => step.id === data.currentStep?.id)?.title ?? data.currentStep.type}</small>}</div>
            <div className="leadlog-facts"><span><b>{data.recipient.sentCount}</b> gesendet</span><span><b>{data.recipient.openedAt ? stamp(data.recipient.openedAt) : "–"}</b> geöffnet</span><span><b>{data.recipient.clickedAt ? stamp(data.recipient.clickedAt) : "–"}</b> geklickt</span><span><b>{data.recipient.repliedAt ? stamp(data.recipient.repliedAt) : "–"}</b> geantwortet</span><span><b>{data.campaign.stopOnReply ? "an" : "aus"}</b> Bei Antwort anhalten</span></div>
          </section>
          <section className="leadlog-steps"><span className="eyebrow">WEG DURCH DEN ABLAUF</span>
            <ol>{data.steps.map((step) => { const Icon = STEP_ICON[step.type]; const State = step.state === "erledigt" ? CheckCircle2 : step.state === "aktuell" ? CircleDot : step.state === "abgebrochen" ? XCircle : step.state === "uebersprungen" ? MinusCircle : Circle;
              return <li key={step.id} className={`is-${step.state}`}><State className="leadlog-step-state h-4 w-4" aria-hidden="true" /><span className="leadlog-step-main"><strong><Icon className="h-3.5 w-3.5" aria-hidden="true" /> {step.title}</strong>{step.detail && <small>{step.detail}</small>}</span><span className="leadlog-step-when">{step.state === "erledigt" || step.state === "abgebrochen" ? stamp(step.at) : step.state === "aktuell" ? "jetzt" : step.state === "uebersprungen" ? "übersprungen" : "offen"}</span></li>; })}</ol>
            {!data.steps.length && <p className="text-xs text-slate-500">Der Ablauf hat noch keine Schritte.</p>}
          </section>
          <section className="leadlog-events"><span className="eyebrow">WAS WANN PASSIERT IST</span>
            {!data.events.length ? <p className="text-xs text-slate-500">Noch nichts passiert – der Empfänger wurde am {stamp(data.recipient.createdAt)} aufgenommen.</p> : <ol>{[...data.events].reverse().map((event) => <li key={event.id} className={`is-${event.kind}`}><span className="leadlog-event-when">{stamp(event.createdAt)}</span><span className="leadlog-event-main"><strong>{event.label}</strong>{event.subject && <em>„{event.subject}“</em>}{event.note && <small>{event.note}</small>}</span></li>)}</ol>}
          </section>
          {data.runs.length > 1 && <section className="leadlog-runs"><span className="eyebrow">ALLE DURCHLÄUFE DIESES KONTAKTS</span><ul>{data.runs.map((run) => <li key={run.id} className={run.id === data.recipient.id ? "is-current" : ""}><strong>{run.campaignName}</strong><span>{STATUS[run.status] ?? run.status} · {run.sentCount} gesendet · seit {stamp(run.createdAt)}</span></li>)}</ul></section>}
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
