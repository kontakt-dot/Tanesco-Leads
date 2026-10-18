import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { RotateCcw, Shuffle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { splitShares, type OwnerShare, type ShareMode } from "../../../shared/pipeline-extras";

/**
 * Karten verteilen – mit zwei Klicks: Welche Karten (nur die ohne Vertriebler oder alle offenen neu), wie (gleichmäßig,
 * prozentual, feste Anzahl, nur einer), Vorschau „≈ 7 von 10“ – fertig. Dieselbe Aufteilung wie beim Listen-Upload.
 * Wird aus der Pipeline (alle Karten der Pipeline) und aus einer E-Mail-Kampagne (nur deren Empfänger) aufgerufen.
 */
export type DistributeCard = { publicId: string; name: string; ownerUserId: number | null; closed: boolean };
type Mode = "gleich" | "prozent" | "anzahl" | "einer";
const MODE_LABEL: Record<Mode, string> = { gleich: "Gleichmäßig", prozent: "Prozentual", anzahl: "Feste Anzahl", einer: "Nur einer" };

export default function DistributeCardsDialog({ open, onClose, cards, title, onDone }: { open: boolean; onClose: () => void; cards: DistributeCard[]; title?: string; onDone?: () => void }) {
  const owners = trpc.leadops.pipelineOwners.useQuery(undefined, { retry: false, enabled: open });
  const reps = owners.data ?? [];
  const [scope, setScope] = useState<"offen" | "alle">("offen");
  // Gibt es keine Karte ohne Vertriebler, startet das Fenster gleich mit „alle offenen neu verteilen“
  useEffect(() => { if (!open) return; const unassigned = cards.filter((card) => !card.closed && !card.ownerUserId).length; const openCards = cards.filter((card) => !card.closed).length; setScope(unassigned === 0 && openCards > 0 ? "alle" : "offen"); }, [open, cards]);
  const [mode, setMode] = useState<Mode>("gleich");
  const [shares, setShares] = useState<Record<string, number>>({});
  const [single, setSingle] = useState<number | null>(null);
  const distribute = trpc.leadops.distributePipelineOwners.useMutation({ onSuccess: (result) => { toast.success(`${result.updated} ${result.updated === 1 ? "Karte" : "Karten"} verteilt.`); onDone?.(); onClose(); }, onError: (error) => toast.error(error.message) });
  // Rückgängig: alle zugeteilten offenen Karten wieder auf „nicht zugeteilt“ (z. B. nach einer falschen Verteilung)
  const assigned = useMemo(() => cards.filter((card) => !card.closed && card.ownerUserId), [cards]);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { if (!open) setConfirmReset(false); }, [open]);
  const reset = trpc.leadops.assignPipelineOwner.useMutation({ onSuccess: (result) => { toast.success(`Zuteilung aufgehoben: ${result.updated} ${result.updated === 1 ? "Karte ist" : "Karten sind"} wieder nicht zugeteilt.`); onDone?.(); onClose(); }, onError: (error) => toast.error(error.message) });
  const targets = useMemo(() => cards.filter((card) => !card.closed && (scope === "alle" || !card.ownerUserId)), [cards, scope]);
  const shareOf = (userId: number) => shares[String(userId)] ?? (mode === "prozent" ? Math.round(100 / Math.max(1, reps.length)) : 0);
  const ownerShares: OwnerShare[] = mode === "einer" ? (single ? [{ userId: single, value: 100 }] : []) : mode === "gleich" ? reps.map((rep) => ({ userId: rep.userId, value: 1 })) : reps.map((rep) => ({ userId: rep.userId, value: shareOf(rep.userId) })).filter((share) => share.value > 0);
  const shareMode: ShareMode = mode === "anzahl" ? "anzahl" : "prozent";
  const preview = ownerShares.length ? splitShares(targets.length, ownerShares, shareMode) : [];
  const unassigned = Math.max(0, targets.length - preview.reduce((sum, item) => sum + item.count, 0));
  const canSubmit = targets.length > 0 && ownerShares.length > 0 && !distribute.isPending;
  return <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <DialogContent className="distribute-dialog">
      <DialogHeader><DialogTitle className="distribute-title"><Shuffle className="h-5 w-5" aria-hidden="true" /> {title ?? "Karten verteilen"}</DialogTitle><DialogDescription>Welche Karten, an wen, in welchem Verhältnis – die Vorschau zeigt, wer wie viele bekommt. Gewonnene und verlorene Karten bleiben außen vor.</DialogDescription></DialogHeader>
      <div className="distribute-body">
        <div className="distribute-block"><span className="eyebrow">WELCHE KARTEN</span><div className="dashboard-segments mt-2">{([["offen", `Nur ohne Vertriebler (${cards.filter((card) => !card.closed && !card.ownerUserId).length})`], ["alle", `Alle offenen neu verteilen (${cards.filter((card) => !card.closed).length})`]] as const).map(([key, label]) => <button key={key} type="button" className={scope === key ? "active" : ""} onClick={() => setScope(key)}>{label}</button>)}</div></div>
        <div className="distribute-block"><span className="eyebrow">WIE</span><div className="dashboard-segments mt-2">{(Object.keys(MODE_LABEL) as Mode[]).map((key) => <button key={key} type="button" className={mode === key ? "active" : ""} onClick={() => setMode(key)}>{MODE_LABEL[key]}</button>)}</div>
          {owners.isLoading ? <p className="mt-2 text-xs text-slate-500">Lädt Vertriebler …</p> : !reps.length ? <p className="mt-2 text-xs text-slate-500">Noch keine Vertriebler – unter Vertriebspipeline → Einstellungen → Vertriebler anlegen.</p>
            : mode === "einer" ? <div className="upload-dist-rows mt-2">{reps.map((rep) => <button key={rep.userId} type="button" className={`upload-dist-rep ${single === rep.userId ? "active" : ""}`} onClick={() => setSingle(rep.userId)}><span className="owner-dot">{rep.initials}</span>{rep.name}<span className="upload-dist-preview">{single === rep.userId ? `alle ${targets.length}` : ""}</span></button>)}</div>
            : mode === "gleich" ? <div className="upload-dist-rows mt-2">{reps.map((rep) => <div key={rep.userId} className="upload-dist-row is-static"><span className="owner-dot">{rep.initials}</span><span className="upload-dist-name">{rep.name}</span><span className="upload-dist-unit">{Math.round(100 / reps.length)} %</span><span className="upload-dist-preview">≈ {preview.find((item) => item.userId === rep.userId)?.count ?? 0} von {targets.length}</span></div>)}</div>
            : <div className="upload-dist-rows mt-2">{reps.map((rep) => <label key={rep.userId} className="upload-dist-row"><span className="owner-dot">{rep.initials}</span><span className="upload-dist-name">{rep.name}</span><input type="number" min={0} max={mode === "prozent" ? 100 : 100000} className="upload-dist-input" value={shareOf(rep.userId)} onChange={(event) => setShares({ ...shares, [String(rep.userId)]: Math.max(0, Number(event.target.value) || 0) })} /><span className="upload-dist-unit">{mode === "prozent" ? "%" : "Karten"}</span><span className="upload-dist-preview">≈ {preview.find((item) => item.userId === rep.userId)?.count ?? 0} von {targets.length}</span></label>)}{mode === "prozent" && ownerShares.reduce((sum, share) => sum + share.value, 0) !== 100 && <p className="upload-dist-hint">Die Prozente ergeben {ownerShares.reduce((sum, share) => sum + share.value, 0)} % – verteilt wird im Verhältnis, das passt trotzdem.</p>}{mode === "anzahl" && unassigned > 0 && <p className="upload-dist-hint">{unassigned} Karten bleiben ohne Zuteilung.</p>}</div>}
        </div>
        <div className="distribute-block distribute-reset"><span className="eyebrow">RÜCKGÄNGIG</span><p className="mt-1 text-xs text-slate-400">Ist bei der Verteilung etwas schiefgelaufen? Hebt bei allen offenen Karten die Zuteilung auf – danach stehen alle auf „Nicht zugeteilt“ und du kannst neu verteilen.</p>{confirmReset ? <div className="distribute-reset-confirm"><strong>Bei {assigned.length} {assigned.length === 1 ? "Karte" : "Karten"} die Zuteilung wirklich aufheben?</strong><div className="flex gap-2"><button type="button" className="distribute-reset-button is-sure" disabled={reset.isPending} onClick={() => reset.mutate({ publicIds: assigned.map((card) => card.publicId), ownerUserId: null })}><RotateCcw className="h-4 w-4" /> {reset.isPending ? "Wird zurückgesetzt …" : "Ja, aufheben"}</button><Button variant="ghost" onClick={() => setConfirmReset(false)}>Nein</Button></div></div> : <button type="button" className="distribute-reset-button" disabled={!assigned.length} onClick={() => setConfirmReset(true)}><RotateCcw className="h-4 w-4" /> Alle Zuteilungen aufheben ({assigned.length})</button>}</div>
        <div className="distribute-foot"><span className="text-xs text-slate-400">{targets.length === 0 ? "Keine passenden Karten." : `${targets.length} ${targets.length === 1 ? "Karte wird" : "Karten werden"} verteilt.`}</span><div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button className="flux-button" disabled={!canSubmit} onClick={() => distribute.mutate({ publicIds: targets.map((card) => card.publicId), userIds: ownerShares.map((share) => share.userId), shares: mode === "gleich" ? undefined : ownerShares, mode: mode === "gleich" ? undefined : shareMode })}><Shuffle className="h-4 w-4" /> {distribute.isPending ? "Verteilt …" : "Jetzt verteilen"}</Button></div></div>
      </div>
    </DialogContent>
  </Dialog>;
}
