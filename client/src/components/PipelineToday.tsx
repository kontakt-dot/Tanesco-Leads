import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import { CalendarDays, Check, Clock3, Phone, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import type { AppRouter } from "../../../server/routers";
import { DUE_BUCKETS, dueBucket, formatAppointment, formatDue, groupByDue, taskKindEmoji, taskKindLabel, type DueBucket } from "../../../shared/pipeline-extras";
import { stageLabel, type StageDef } from "../../../shared/sales-pipeline";
import type { DialTarget } from "@/components/PipelineDialer";

type DueList = inferRouterOutputs<AppRouter>["leadops"]["pipelineDueList"];
type Task = DueList["tasks"][number];

/**
 * „Aufgaben“ (früher „Heute“): alle fälligen Wiedervorlagen und Aufgaben (aus Dialer, Notizen, von Hand) plus die Termine der nächsten Tage –
 * mit „Jetzt anrufen“ (Pipeline-Dialer), Erledigt, Verschieben und Löschen.
 */
export default function PipelineToday({ ownerFilter, stageDefs, onDial, onOpenLead }: { ownerFilter: number | "ohne" | null; stageDefs: StageDef[]; onDial: (queue: DialTarget[], start: number, mode: "einzel" | "setup", listLabel?: string) => void; onOpenLead: (publicId: string) => void }) {
  const due = trpc.leadops.pipelineDueList.useQuery({ ownerUserId: ownerFilter }, { retry: false, refetchInterval: 60_000 });
  const utils = trpc.useUtils(); const refresh = () => { utils.leadops.pipelineDueList.invalidate(); utils.leadops.pipelineOverview.invalidate(); utils.leadops.listPipelineTasks.invalidate(); };
  const complete = trpc.leadops.completePipelineTask.useMutation({ onSuccess: () => { toast.success("Erledigt."); refresh(); }, onError: (error) => toast.error(error.message) });
  const snooze = trpc.leadops.snoozePipelineTask.useMutation({ onSuccess: (result) => { toast.success(`Verschoben auf ${formatDue(result.dueAt)}.`); refresh(); }, onError: (error) => toast.error(error.message) });
  const remove = trpc.leadops.deletePipelineTask.useMutation({ onSuccess: () => { toast("Aufgabe gelöscht."); refresh(); }, onError: (error) => toast.error(error.message) });
  const now = useMemo(() => new Date(), [due.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupByDue(due.data?.tasks ?? [], now), [due.data, now]);
  const appointments = due.data?.appointments ?? [];
  const toTarget = (task: Task): DialTarget => ({ id: task.lead.id, publicId: task.lead.publicId, name: task.lead.name, phone: task.lead.phone, stage: task.lead.stage ?? stageDefs[0]?.key ?? "neu", company: task.lead.company, city: task.lead.city });
  const callable = [...groups.ueberfaellig, ...groups.heute].filter((task) => task.lead.phone);
  const snoozeTo = (task: Task, days: number) => { const next = new Date(); next.setDate(next.getDate() + days); next.setHours(9, 0, 0, 0); snooze.mutate({ id: task.id, dueAt: next }); };
  const openCount = groups.ueberfaellig.length + groups.heute.length;
  return <div className="pipeline-today mt-3">
    <div className="metric-grid pipeline-kpis">{[["Überfällig", String(groups.ueberfaellig.length), "noch nicht erledigt"], ["Heute fällig", String(groups.heute.length), "Wiedervorlagen & Aufgaben"], ["Termine heute", String(appointments.filter((item) => dueBucket(item.appointmentAt, now) === "heute").length), `${appointments.length} in den nächsten 7 Tagen`], ["Diese Woche", String(groups.morgen.length + groups.woche.length), `+${due.data?.laterCount ?? 0} später`]].map(([label, value, hint]) => <article key={label} className="metric-card"><div className="metric-line"><span>{label}</span></div><strong>{value}</strong><small>{hint}</small></article>)}</div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="surface-panel operations-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><span className="eyebrow">WIEDERVORLAGEN & AUFGABEN</span><p className="mt-1 text-xs text-slate-500">Aus dem Dialer („Wiedervorlage“, „Interessiert“), aus Notizen und von Hand. Erledigtes verschwindet, Verschobenes rutscht nach hinten.</p></div>{callable.length > 0 && <Button size="sm" className="flux-button" onClick={() => onDial(callable.map(toTarget), 0, "setup", `Heute fällig (${callable.length})`)}><Phone /> Alle {callable.length} abtelefonieren</Button>}</div>
        {due.isLoading ? <p className="mt-3 text-xs text-slate-500">Wird geladen …</p> : openCount + groups.morgen.length + groups.woche.length === 0 ? <p className="mt-6 text-center text-sm text-slate-400">Nichts offen – alles erledigt. 🎉<br /><small className="text-slate-500">Neue Wiedervorlagen legst du an der Karte („Wiedervorlage“) oder im Dialer an.</small></p> : DUE_BUCKETS.filter((bucket) => bucket.key !== "spaeter" && groups[bucket.key].length > 0).map((bucket) => <div key={bucket.key} className="mt-4"><h3 className={`today-group-title is-${bucket.key}`}>{bucket.label} <span className="count">{groups[bucket.key].length}</span></h3><ul className="today-list">{groups[bucket.key].map((task) => <TaskRow key={task.id} task={task} bucket={bucket.key} now={now} stageDefs={stageDefs} pending={complete.isPending || snooze.isPending || remove.isPending} onCall={task.lead.phone ? () => onDial([toTarget(task)], 0, "einzel") : undefined} onDone={() => complete.mutate({ id: task.id })} onSnooze={(days) => snoozeTo(task, days)} onDelete={() => remove.mutate({ id: task.id })} onOpen={() => onOpenLead(task.lead.publicId)} />)}</ul></div>)}
      </section>
      <section className="surface-panel operations-panel p-4"><span className="eyebrow">TERMINE – NÄCHSTE 7 TAGE</span><p className="mt-1 text-xs text-slate-500">Aus der Karte („Termin“) oder nach einem Anruf-Ergebnis „Verkauft / Termin“. Erinnerung geht laut Automatik automatisch raus.</p>
        {!appointments.length ? <p className="mt-4 text-xs text-slate-500">Kein Termin in den nächsten Tagen.</p> : <ul className="today-list mt-3">{appointments.map((item) => { const bucket = dueBucket(item.appointmentAt, now); return <li key={item.leadId} className={`today-item is-termin ${bucket === "heute" ? "is-today" : ""}`}><div className="today-item-main"><span className="today-kind" aria-hidden="true"><CalendarDays className="h-3.5 w-3.5" /></span><div className="min-w-0"><strong>{formatAppointment(item.appointmentAt)}</strong><span className="today-lead"><button type="button" onClick={() => onOpenLead(item.publicId)}>{item.name}</button>{item.company ? ` · ${item.company}` : ""}{item.city ? ` · ${item.city}` : ""}</span><small>{stageLabel(item.stage, stageDefs)}{item.ownerName ? ` · ${item.ownerName}` : ""}{item.phone ? ` · ${item.phone}` : ""}</small></div></div><div className="today-item-actions">{item.phone && <button type="button" className="pipeline-card-phone" title={`${item.name} anrufen`} aria-label={`${item.name} anrufen`} onClick={() => onDial([{ id: item.leadId, publicId: item.publicId, name: item.name, phone: item.phone, stage: item.stage ?? stageDefs[0]?.key ?? "neu", company: item.company, city: item.city }], 0, "einzel")}><Phone className="h-3.5 w-3.5" /></button>}</div></li>; })}</ul>}
      </section>
    </div>
  </div>;
}

function TaskRow({ task, bucket, now, stageDefs, pending, onCall, onDone, onSnooze, onDelete, onOpen }: { task: Task; bucket: DueBucket; now: Date; stageDefs: StageDef[]; pending: boolean; onCall?: () => void; onDone: () => void; onSnooze: (days: number) => void; onDelete: () => void; onOpen: () => void }) {
  return <li className={`today-item is-${bucket}`}>
    <div className="today-item-main"><span className="today-kind" title={taskKindLabel(task.kind)} aria-hidden="true">{taskKindEmoji(task.kind)}</span><div className="min-w-0"><strong>{task.title}</strong><span className="today-lead"><button type="button" onClick={onOpen}>{task.lead.name}</button>{task.lead.company ? ` · ${task.lead.company}` : ""}{task.lead.city ? ` · ${task.lead.city}` : ""}</span><small><Clock3 className="inline h-3 w-3" /> {formatDue(task.dueAt, now)} · {stageLabel(task.lead.stage, stageDefs)}{task.ownerName ? ` · ${task.ownerName}` : ""}{task.source === "dialer" ? " · aus dem Dialer" : task.source === "automatik" ? " · automatisch" : ""}{task.note ? ` · ${task.note}` : ""}</small></div></div>
    <div className="today-item-actions">{onCall && <Button size="sm" className="flux-button" disabled={pending} onClick={onCall} title={`${task.lead.name} jetzt anrufen (${task.lead.phone})`}><Phone /> Jetzt anrufen</Button>}<Button size="sm" variant="outline" disabled={pending} onClick={onDone} title="Als erledigt markieren"><Check /> Erledigt</Button><select className="today-snooze" aria-label="Verschieben" value="" disabled={pending} onChange={(event) => { const days = Number(event.target.value); if (days) onSnooze(days); }}><option value="">Verschieben …</option><option value="1">auf morgen</option><option value="3">um 3 Tage</option><option value="7">um 1 Woche</option></select><button type="button" className="today-delete" aria-label="Aufgabe löschen" disabled={pending} onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></button></div>
  </li>;
}
