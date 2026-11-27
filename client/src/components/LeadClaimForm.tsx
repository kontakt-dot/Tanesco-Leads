import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const OTHER = "__anderer__";
function defaultDueDate() {
  const due = new Date();
  due.setDate(due.getDate() + 7);
  return due.toISOString().slice(0, 10);
}

/**
 * Reklamation zu einem Lead erfassen. Der Grund kommt aus der Liste der Reklamationsgründe (Einstellungen → Reklamationen) – so greifen die Regeln
 * der Lieferkette („erlaubt“, „weitergeben“), die am Namen des Grundes hängen. „Anderer Grund“ lässt freien Text zu; gibt es keine Gründe, bleibt es ein Textfeld.
 * `asBuyer`: im Bereich des Käufers – Prüffrist und Erstattung legt der Verkäufer fest, deshalb stehen sie dort nicht.
 */
export default function LeadClaimForm({ leadId, publicId, leadName, asBuyer = false, onClose, onCreated }: { leadId: number; publicId: string; leadName?: string; asBuyer?: boolean; onClose: () => void; onCreated: (claimId: number) => void }) {
  const reasons = trpc.leadops.listReclamationReasons.useQuery(undefined, { retry: false });
  const options = (reasons.data ?? []).filter((item) => item.active).map((item) => item.name);
  const [picked, setPicked] = useState("");
  const [custom, setCustom] = useState("");
  const [details, setDetails] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [refundAmount, setRefundAmount] = useState("");
  const createClaim = trpc.leadops.createClaim.useMutation({
    onSuccess: ({ claimId }) => { toast.success(asBuyer ? "Reklamation eingereicht – wir prüfen sie." : "Reklamation erfasst."); onCreated(claimId); },
    onError: (error) => toast.error(error.message),
  });
  const free = !options.length || picked === OTHER;
  const reason = (free ? custom : picked).trim();

  const submit = () => {
    if (reason.length < 2) return toast.error(free ? "Bitte einen Reklamationsgrund eingeben." : "Bitte einen Reklamationsgrund wählen.");
    const refund = refundAmount.trim() ? Number(refundAmount.replace(",", ".")) : undefined;
    if (refund !== undefined && (!Number.isFinite(refund) || refund < 0)) return toast.error("Die Erstattung muss ein Betrag in Euro sein, z. B. 39,00.");
    createClaim.mutate({ leadId, reason, details: details.trim() || undefined, dueAt: asBuyer || !dueDate ? undefined : new Date(`${dueDate}T12:00:00`), refundAmount: asBuyer ? undefined : refund });
  };

  return <section className="fx-scope cf" aria-label="Reklamation erfassen">
    <header className="ld-head"><div><h2>Reklamation erfassen</h2><p>Für den Lead {leadName ? <><b>{leadName}</b> ({publicId})</> : <b>{publicId}</b>}. {asBuyer ? "Wir prüfen die Reklamation und entscheiden darüber." : "Der Lead gilt sofort als reklamiert. Über die Reklamation entscheidest du unter „Reklamationen“."}</p></div><button type="button" className="ld-close" aria-label="Schließen" onClick={onClose}><X aria-hidden="true" /></button></header>
    <div className="cf-fields">
      <label className="rd-field cf-reason"><span>Grund</span>{options.length ? <select className="fx-select" value={picked} onChange={(event) => setPicked(event.target.value)} aria-label="Reklamationsgrund"><option value="">Bitte wählen …</option>{options.map((name) => <option key={name} value={name}>{name}</option>)}<option value={OTHER}>Anderer Grund …</option></select> : null}{free && <input className="fx-field" value={custom} onChange={(event) => setCustom(event.target.value)} placeholder={options.length ? "Grund in eigenen Worten" : "z. B. Falsche Telefonnummer"} aria-label={options.length ? "Anderer Reklamationsgrund" : "Reklamationsgrund"} />}</label>
      {!asBuyer && <label className="rd-field"><span>Prüfen bis</span><input className="fx-field" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="Prüffrist" /></label>}
      {!asBuyer && <label className="rd-field"><span>Erstattung in € (freiwillig)</span><input className="fx-field" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} placeholder="z. B. 39,00" inputMode="decimal" aria-label="Erstattungsbetrag" /></label>}
    </div>
    <label className="rd-field"><span>Was stimmt nicht? (freiwillig)</span><textarea className="fx-field" value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Kurz beschreiben, was am Lead nicht passt" aria-label="Reklamationsdetails" /></label>
    <footer className="ld-actions"><Button variant="outline" onClick={onClose}>Abbrechen</Button><Button className="flux-button" disabled={createClaim.isPending} onClick={submit}>{createClaim.isPending ? "Speichert …" : asBuyer ? "Reklamation einreichen" : "Reklamation anlegen"}</Button></footer>
  </section>;
}
