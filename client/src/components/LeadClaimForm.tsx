import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";

function defaultDueDate() {
  const due = new Date();
  due.setDate(due.getDate() + 7);
  return due.toISOString().slice(0, 10);
}

export default function LeadClaimForm({ leadId, publicId, onClose, onCreated }: { leadId: number; publicId: string; onClose: () => void; onCreated: (claimId: number) => void }) {
  const [reason, setReason] = useState("Qualitätsprüfung");
  const [details, setDetails] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [refundAmount, setRefundAmount] = useState("");
  const createClaim = trpc.leadops.createClaim.useMutation({
    onSuccess: ({ claimId }) => { toast.success("Reklamation mit Prüfungsfrist wurde erfasst."); onCreated(claimId); },
    onError: (error) => toast.error(error.message),
  });

  const submit = () => {
    if (reason.trim().length < 2) return toast.error("Bitte geben Sie einen Reklamationsgrund an.");
    createClaim.mutate({ leadId, reason: reason.trim(), details: details.trim() || undefined, dueAt: new Date(`${dueDate}T12:00:00`), refundAmount: refundAmount ? Number(refundAmount.replace(",", ".")) : undefined });
  };

  return <section className="surface-panel mt-4 p-5" aria-label="Reklamation erfassen">
    <div className="mb-4"><span className="eyebrow">REKLAMATION ERFASSEN</span><h3 className="mt-1 text-lg font-semibold text-white">Fall für {publicId}</h3><p className="mt-1 text-sm text-slate-400">Die Erfassung erstellt einen offenen Vorgang und dokumentiert Frist sowie Entscheidung später in der Chronik.</p></div>
    <div className="grid gap-3 md:grid-cols-2"><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reklamationsgrund" aria-label="Reklamationsgrund" /><Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="Prüfungsfrist" /><Input value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} placeholder="Erstattung in € (optional)" inputMode="decimal" aria-label="Erstattungsbetrag" /></div>
    <textarea value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Details zur Reklamation (optional)" aria-label="Reklamationsdetails" className="mt-3 min-h-24 w-full rounded-md border border-white/10 bg-white/[.03] p-3 text-sm text-slate-100 outline-none focus:border-violet-400/60" />
    <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Abbrechen</Button><Button className="flux-button" disabled={createClaim.isPending} onClick={submit}>Reklamation anlegen</Button></div>
  </section>;
}
