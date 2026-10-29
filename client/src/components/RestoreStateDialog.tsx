import { withUndo } from "@/components/UndoPanel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { History } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

/**
 * Früheren Stand wiederherstellen: Zeitpunkt wählen (z. B. gestern Abend) → Vorschau aller Kontakte, die sich seitdem
 * verändert haben, mit „Jetzt“ und „Stand damals“ (Pipeline, Stufe, Vertriebler) → Auswahl → zurücksetzen.
 * Erreichbar aus E-Mail-Kampagnen → Kontakte und Vertriebspipeline → Rückgängig. Das Zurücksetzen lässt sich selbst rückgängig machen.
 */
const pad = (n: number) => String(n).padStart(2, "0");
const toLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const yesterdayEvening = () => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 20, 0); };
const stamp = (value: Date | string) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const short = (value: Date | string) => { const date = new Date(value); const today = new Date(); const time = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }); return date.toDateString() === today.toDateString() ? `heute ${time}` : `${date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${time}`; };
type View = { pipeline: string; stage: string; owner: string };
const FIELDS: Array<[keyof View, "inPipeline" | "adPlatform" | "pipelineStage" | "ownerUserId", string]> = [["pipeline", "adPlatform", "Pipeline"], ["stage", "pipelineStage", "Stufe"], ["owner", "ownerUserId", "Vertriebler"]];

function StateCell({ view, changed, unknown, side }: { view: View; changed: string[]; unknown: string[]; side: "now" | "then" }) {
  const isChanged = (key: string) => key === "adPlatform" ? changed.includes("adPlatform") || changed.includes("inPipeline") : changed.includes(key);
  return <div className="restore-state">{FIELDS.map(([field, key, label]) => <span key={field} className={isChanged(key) ? `is-changed is-${side}` : ""} title={label}>{view[field]}{side === "then" && (key === "adPlatform" ? unknown.includes("adPlatform") : unknown.includes(key)) ? " (unbekannt – bleibt)" : ""}</span>)}</div>;
}

/** Der Inhalt – als Fenster (Dialog) oder direkt auf der Seite (Verlauf → Früheren Stand wiederherstellen). */
export function RestoreStatePanel({ active, onDone, inline = false }: { active: boolean; onDone: () => void; inline?: boolean }) {
  const utils = trpc.useUtils();
  const [atText, setAtText] = useState(() => toLocal(yesterdayEvening()));
  const at = useMemo(() => { const value = new Date(atText); return Number.isNaN(value.getTime()) ? null : value; }, [atText]);
  const preview = trpc.leadops.pipelineStateAt.useQuery({ at: at ?? new Date() }, { enabled: active && Boolean(at), retry: false, staleTime: 0 });
  const data = preview.data;
  const [off, setOff] = useState<Set<number>>(new Set()); // abgewählte Kontakte (Standard: alle ausgewählt)
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { setOff(new Set()); setConfirm(false); }, [atText, active]);
  const allIds = useMemo(() => (data?.groups ?? []).flatMap((group) => group.leadIds), [data]);
  const picked = allIds.filter((id) => !off.has(id));
  const restore = trpc.leadops.restorePipelineState.useMutation({
    onSuccess: (result) => {
      toast.success(`${result.restored} ${result.restored === 1 ? "Kontakt steht" : "Kontakte stehen"} wieder wie am ${stamp(result.at)} Uhr.`, withUndo(result.undoId as number | undefined, { duration: 12000 }));
      void utils.leadops.emailLeads.invalidate(); void utils.leadops.pipelineOverview.invalidate(); void utils.leadops.listUndo.invalidate(); void utils.leadops.pipelineStateAt.invalidate(); void utils.leadops.listColdLists.invalidate(); void utils.leadops.pipelineLeadDetail.invalidate();
      setConfirm(false); onDone();
    },
    onError: (error) => toast.error(error.message),
  });
  const toggleGroup = (ids: number[], on: boolean) => setOff((value) => { const next = new Set(value); for (const id of ids) { if (on) next.delete(id); else next.add(id); } return next; });
  const quick: Array<[string, () => Date]> = [["Gestern Abend, 20:00", yesterdayEvening], ["Heute früh, 07:00", () => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0); }], ["Vor 1 Stunde", () => new Date(Date.now() - 3_600_000)]];
  return <>
    {inline && <p className="restore-intro">Wähle einen Zeitpunkt. Du siehst zuerst jeden Kontakt, der sich seitdem verändert hat – jetzt und wie er damals stand (Pipeline, Stufe, Vertriebler). Erst nach deinem Klick wird zurückgesetzt, und auch das lässt sich wieder rückgängig machen.</p>}
    <div className="restore-when">
      <label><span>Stand von</span><input type="datetime-local" value={atText} max={toLocal(new Date())} onChange={(event) => setAtText(event.target.value)} /></label>
      <div className="restore-quick">{quick.map(([label, make]) => <button key={label} type="button" className={atText === toLocal(make()) ? "is-on" : ""} onClick={() => setAtText(toLocal(make()))}>{label}</button>)}</div>
    </div>
    {!at ? <p className="restore-empty">Bitte Datum und Uhrzeit wählen.</p>
      : preview.isLoading ? <p className="restore-empty">Wird aus dem Verlauf berechnet …</p>
      : preview.error ? <p className="restore-empty is-error">{preview.error.message}</p>
      : !data?.total ? <p className="restore-empty">Seit {stamp(at)} Uhr hat sich an keinem Kontakt etwas an Pipeline, Stufe oder Vertriebler geändert – es gibt nichts zurückzusetzen.</p>
      : <>
        <p className="restore-summary"><strong>{data.total} {data.total === 1 ? "Kontakt hat" : "Kontakte haben"} sich seit {stamp(at)} Uhr verändert.</strong> Darunter siehst du, wodurch. Hake ab, was zurückgesetzt werden soll.</p>
        <div className="restore-groups" role="group" aria-label="Was seitdem passiert ist">{data.groups.map((group) => { const on = group.leadIds.filter((id) => !off.has(id)).length; return <label key={group.key} className={on ? "is-on" : ""}>
          <input type="checkbox" checked={on === group.leadIds.length} ref={(el) => { if (el) el.indeterminate = on > 0 && on < group.leadIds.length; }} onChange={(event) => toggleGroup(group.leadIds, event.target.checked)} />
          <span><strong>{group.label}</strong><small>{short(group.from)}{short(group.to) !== short(group.from) ? `–${new Date(group.to).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : ""} · {group.actor ?? "automatisch"} · {group.count} {group.count === 1 ? "Kontakt" : "Kontakte"}</small></span>
        </label>; })}</div>
        <div className="restore-list"><table>
          <thead><tr><th><input type="checkbox" aria-label="Alle auswählen" checked={picked.length === allIds.length} onChange={(event) => setOff(event.target.checked ? new Set() : new Set(allIds))} /></th><th>Kontakt</th><th>Jetzt</th><th>Stand {stamp(at)}</th></tr></thead>
          <tbody>{data.items.map((item) => <tr key={item.leadId} className={off.has(item.leadId) ? "is-off" : ""}>
            <td><input type="checkbox" aria-label={`${item.name} zurücksetzen`} checked={!off.has(item.leadId)} onChange={(event) => toggleGroup([item.leadId], event.target.checked)} /></td>
            <td><strong>{item.name}</strong>{item.company && item.company !== item.name ? <small>{item.company}</small> : item.email ? <small>{item.email}</small> : null}{item.createdAfter ? <small className="restore-new">erst danach angelegt – zurück auf den Stand beim Anlegen</small> : null}</td>
            <td><StateCell view={item.now} changed={item.changed} unknown={item.unknown} side="now" /></td>
            <td><StateCell view={item.then} changed={item.changed} unknown={item.unknown} side="then" /></td>
          </tr>)}</tbody>
        </table>{data.total > data.items.length ? <p className="restore-more">Gezeigt werden die ersten {data.items.length} – zurückgesetzt werden alle ausgewählten ({picked.length}).</p> : null}</div>
        {data.unknown > 0 && <p className="restore-note">Bei {data.unknown} {data.unknown === 1 ? "Kontakt" : "Kontakten"} steht ein Teil nicht im Verlauf (z. B. aus welcher eigenen Pipeline er kam) – dieser Teil bleibt, wie er ist.</p>}
      </>}
    <div className="restore-foot">
      {confirm ? <><span className="restore-confirm">{picked.length} {picked.length === 1 ? "Kontakt" : "Kontakte"} auf den Stand vom {at ? stamp(at) : ""} Uhr zurücksetzen?</span>
        <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setConfirm(false)}>Nein</Button><Button type="button" disabled={restore.isPending || !at} onClick={() => at && restore.mutate({ at, leadIds: picked })}>{restore.isPending ? "Wird zurückgesetzt …" : "Ja, zurücksetzen"}</Button></div></>
        : <><span className="text-xs text-slate-400">{data?.total ? `${picked.length} von ${allIds.length} ausgewählt` : ""}</span>
          <div className="flex gap-2">{!inline && <Button type="button" variant="outline" onClick={onDone}>Abbrechen</Button>}<Button type="button" disabled={!picked.length || !at || preview.isLoading} onClick={() => setConfirm(true)}>{picked.length ? `${picked.length} ${picked.length === 1 ? "Kontakt" : "Kontakte"} zurücksetzen` : "Zurücksetzen"}</Button></div></>}
    </div>
  </>;
}

export default function RestoreStateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <DialogContent className="restore-dialog" onOpenAutoFocus={(event) => event.preventDefault()}>
      <DialogHeader><DialogTitle className="distribute-title"><History className="h-5 w-5" aria-hidden="true" /> Früheren Stand wiederherstellen</DialogTitle>
        <DialogDescription>Wähle einen Zeitpunkt. Du siehst zuerst jeden Kontakt, der sich seitdem verändert hat – jetzt und wie er damals stand (Pipeline, Stufe, Vertriebler). Erst nach deinem Klick wird zurückgesetzt, und auch das lässt sich wieder rückgängig machen.</DialogDescription></DialogHeader>
      <RestoreStatePanel active={open} onDone={onClose} />
    </DialogContent>
  </Dialog>;
}
