import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { Ban } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Kontakt sperren – aus der Lead-Seite der Vertriebspipeline und aus dem Reiter „Kontakte“ der E-Mail-Kampagnen.
 * Die Adresse kommt auf die Sperrliste (Unterliste „Manuell“), laufende E-Mail-Serien stoppen sofort, der Kontakt bleibt
 * in der Pipeline. Optional ein Grund, der auf der Sperrliste und im Verlauf der Karte steht.
 */
export default function BlockContactDialog({ leadIds, label, source, open, onClose, onDone }: { leadIds: number[]; label: string; source: string; open: boolean; onClose: () => void; onDone?: () => void }) {
  const [note, setNote] = useState("");
  useEffect(() => { if (open) setNote(""); }, [open]);
  const block = trpc.leadops.blockLeads.useMutation({ onSuccess: (result) => {
    if (!result.blocked) { toast.error(result.skipped ? "Keine E-Mail-Adresse am Kontakt – ohne Adresse gibt es nichts zu sperren." : "Nichts gesperrt."); return; }
    toast.success(`${result.blocked === 1 ? label : `${result.blocked} Kontakte`} gesperrt – keine E-Mails mehr${result.stopped ? `, ${result.stopped} laufende Serie${result.stopped === 1 ? "" : "n"} gestoppt` : ""}${result.skipped ? ` (${result.skipped} ohne E-Mail übersprungen)` : ""}.`, { duration: 7000 });
    onDone?.(); onClose();
  }, onError: (error) => toast.error(error.message) });
  return <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <DialogContent className="block-dialog">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Ban className="h-4 w-4 text-red-400" aria-hidden="true" /> {leadIds.length === 1 ? `${label} sperren` : `${leadIds.length} Kontakte sperren`}</DialogTitle><DialogDescription>Die E-Mail-Adresse kommt auf die Sperrliste und bekommt keine E-Mail mehr – aus keiner Kampagne. Laufende Serien stoppen sofort. Der Kontakt bleibt in der Pipeline, anrufen geht weiterhin. Die Sperre lässt sich jederzeit wieder aufheben.</DialogDescription></DialogHeader>
      <label className="rv-field">Grund (optional)<input value={note} maxLength={300} placeholder="z. B. will keine Werbung, Wettbewerber, telefonisch abgesagt" onChange={(event) => setNote(event.target.value)} /></label>
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className="campaign-act" onClick={onClose}>Abbrechen</button><button type="button" className="campaign-act is-danger" disabled={block.isPending || !leadIds.length} onClick={() => block.mutate({ leadIds, note: note.trim() || null, source })}><Ban className="h-3.5 w-3.5" /> {block.isPending ? "Wird gesperrt …" : "Sperren"}</button></div>
    </DialogContent>
  </Dialog>;
}

/** Knopf „Sperre aufheben“ – Adresse von der Sperrliste nehmen. */
export function UnblockButton({ leadIds, label, className = "campaign-act", onDone }: { leadIds: number[]; label?: string; className?: string; onDone?: () => void }) {
  const unblock = trpc.leadops.unblockLeads.useMutation({ onSuccess: (result) => { toast.success(result.unblocked ? `Sperre aufgehoben – ${result.unblocked === 1 ? "der Kontakt kann" : `${result.unblocked} Kontakte können`} wieder E-Mails bekommen.` : "Nichts zu entsperren."); onDone?.(); }, onError: (error) => toast.error(error.message) });
  return <button type="button" className={className} disabled={unblock.isPending || !leadIds.length} title="Von der Sperrliste nehmen – E-Mails sind dann wieder möglich" onClick={() => unblock.mutate({ leadIds })}>{unblock.isPending ? "Wird aufgehoben …" : label ?? "Sperre aufheben"}</button>;
}
