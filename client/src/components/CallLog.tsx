import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Phone, PhoneCall } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { callCounterText, CALL_RESULTS, type CallResult } from "../../../shared/pipeline-extras";

/**
 * „+ Anruf“ an der Karte: ein Versuch wird mit Ergebnis festgehalten – der Zähler zählt hoch, die Karte wandert von selbst
 * (Neu → In Bearbeitung, erreicht → Kontaktiert). Rückruf gewünscht? Dann gleich eine Wiedervorlage mit anlegen.
 */
export function CallLogButton({ lead, onLogged }: { lead: { publicId: string; name: string; calls?: { count: number } }; onLogged: () => void }) {
  const [open, setOpen] = useState(false);
  return <div className="pipeline-card-calllog">
    <button type="button" className={`calllog-toggle ${open ? "is-open" : ""}`} title="Anruf festhalten – zählt den Versuch und trägt das Ergebnis ein" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Phone className="h-3 w-3" /> + Anruf{lead.calls?.count ? ` (${lead.calls.count})` : ""}</button>
    {open && <CallLogForm publicId={lead.publicId} name={lead.name} onDone={() => { setOpen(false); onLogged(); }} onCancel={() => setOpen(false)} />}
  </div>;
}
const FOLLOW_UPS: Array<[string, (now: Date) => Date]> = [["in 1 Std.", (now) => new Date(now.getTime() + 3_600_000)], ["in 3 Std.", (now) => new Date(now.getTime() + 3 * 3_600_000)], ["morgen 9:00", (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0)], ["in 3 Tagen", (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 9, 0)]];
export function CallLogForm({ publicId, name, onDone, onCancel }: { publicId: string; name: string; onDone: () => void; onCancel: () => void }) {
  const [result, setResult] = useState<CallResult>("nicht_erreicht"); const [note, setNote] = useState(""); const [followUp, setFollowUp] = useState<number | null>(null);
  const log = trpc.leadops.logCallAttempt.useMutation({ onSuccess: (saved) => { toast.success(`${name}: Anruf ${saved.count} festgehalten (${CALL_RESULTS.find((item) => item.key === saved.result)?.short ?? saved.result})${saved.moved ? ` – Karte jetzt in „${saved.moved === "in_bearbeitung" ? "In Bearbeitung" : saved.moved === "kontaktiert" ? "Kontaktiert" : saved.moved}“` : ""}.`); onDone(); }, onError: (error) => toast.error(error.message) });
  return <div className="calllog-overlay" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}><div className="calllog-form" role="dialog" aria-label={`Anruf bei ${name} festhalten`}><div className="calllog-title"><strong>{name}</strong><small>Wie ist der Anruf ausgegangen?</small></div>
    <div className="calllog-results">{CALL_RESULTS.map((item) => <button key={item.key} type="button" className={`${result === item.key ? "active" : ""} ${item.reached ? "is-reached" : ""}`} onClick={() => setResult(item.key)}>{item.label}</button>)}</div>
    <Input className="calllog-note h-8" placeholder="Kurze Notiz (optional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={320} />
    <div className="calllog-followup"><span>Wieder anrufen:</span>{FOLLOW_UPS.map(([label], index) => <button key={label} type="button" className={followUp === index ? "active" : ""} onClick={() => setFollowUp(followUp === index ? null : index)}>{label}</button>)}</div>
    <div className="calllog-actions"><button type="button" className="calllog-cancel" onClick={onCancel}>Abbrechen</button><button type="button" className="calllog-save" disabled={log.isPending} onClick={() => log.mutate({ publicId, result, note: note.trim() || null, followUpAt: followUp === null ? null : FOLLOW_UPS[followUp][1](new Date()) })}>{log.isPending ? "Speichert …" : "Anruf speichern"}</button></div>
  </div></div>;
}

/** Lead-Seite: Zähler, Liste der Versuche (Dialer und von Hand) und das Formular für den nächsten Anruf. */
export function CallAttemptsSection({ publicId, name }: { publicId: string; name: string }) {
  const attempts = trpc.leadops.callAttempts.useQuery({ publicId }, { retry: false });
  const utils = trpc.useUtils(); const [open, setOpen] = useState(false);
  const data = attempts.data; const refresh = () => { utils.leadops.callAttempts.invalidate(); utils.leadops.pipelineOverview.invalidate(); utils.leadops.pipelineHistory.invalidate(); utils.leadops.pipelineLeadDetail.invalidate(); };
  return <section className="call-attempts">
    <div className="call-attempts-head"><span className="eyebrow">ANRUFE</span><strong>{data ? callCounterText(data) ?? "Noch kein Anruf festgehalten" : "…"}</strong>{data && data.count > 0 && <small>{data.reached} × erreicht</small>}<button type="button" className={`calllog-toggle ${open ? "is-open" : ""}`} onClick={() => setOpen((value) => !value)}><PhoneCall className="h-3.5 w-3.5" /> + Anruf</button></div>
    {open && <CallLogForm publicId={publicId} name={name} onDone={() => { setOpen(false); refresh(); }} onCancel={() => setOpen(false)} />}
    {data && data.attempts.length > 0 && <ol className="call-attempts-list">{data.attempts.map((attempt, index) => <li key={attempt.id}><span className="call-attempt-no">{data.attempts.length - index}</span><span className={`call-attempt-result ${attempt.result === "erreicht" || attempt.result === "rueckruf" ? "is-reached" : ""}`}>{attempt.label}</span><span className="call-attempt-when">{new Date(attempt.at).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{attempt.by ? ` · ${attempt.by}` : ""}{attempt.fromDialer ? " · Dialer" : ""}</span>{attempt.note && <span className="call-attempt-note">{attempt.note}</span>}</li>)}</ol>}
  </section>;
}
