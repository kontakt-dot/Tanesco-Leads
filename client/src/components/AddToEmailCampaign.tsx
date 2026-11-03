/**
 * Einzelne Leads (wieder) in eine E-Mail-Kampagne packen – aus der Pipeline (aufgeklappte Karte, Auswahl) und von der Lead-Seite.
 * Auch wer schon durch war, geantwortet hat oder aus dem Funnel genommen wurde, bekommt die Serie noch einmal von vorn; wer gerade drin
 * läuft, nicht doppelt. Abgemeldete, Unzustellbare und Gesperrte nie (Server).
 */
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { byCategoryThenName, campaignOptionText } from "../../../shared/campaign-tag";

export default function AddToEmailCampaign({ leadIds, variant = "pill", label = "In E-Mail-Kampagne", disabledHint, onDone }: { leadIds: number[]; variant?: "pill" | "select"; label?: string; disabledHint?: string | null; onDone?: () => void }) {
  const utils = trpc.useUtils();
  const list = trpc.leadops.listEmailCampaigns.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const choices = (list.data ?? []).filter((row) => !row.isTemplate && !row.archivedAt).sort(byCategoryThenName); // archivierte nehmen niemanden mehr auf
  const add = trpc.leadops.addLeadsToEmailCampaign.useMutation({
    onSuccess: (result, input) => {
      const chosen = choices.find((row) => row.id === input.id); const name = chosen ? chosen.name : "die Kampagne";
      const extra = [result.already ? `${result.already} ${result.already === 1 ? "läuft" : "laufen"} dort gerade schon` : "", result.noEmail ? `${result.noEmail} ohne E-Mail-Adresse` : "", result.blocked ? `${result.blocked} gesperrt` : ""].filter(Boolean).join(", ");
      if (result.added) toast.success(`${result.added === 1 ? "In" : `${result.added} Kontakte in`} „${name}“ aufgenommen${result.status === "entwurf" ? " – die Serie startet, sobald du die Kampagne startest" : result.status === "pausiert" ? " – die Kampagne ist pausiert, es geht los, sobald du sie fortsetzt" : " – die erste E-Mail geht im Versandfenster raus"}${extra ? ` (${extra})` : ""}.`, { duration: 8000 });
      else toast.info(`Niemand aufgenommen${extra ? `: ${extra}` : ""}.`);
      void utils.leadops.listEmailCampaigns.invalidate(); void utils.leadops.getEmailCampaign.invalidate(); void utils.leadops.emailLeads.invalidate(); void utils.leadops.pipelineLeadDetail.invalidate(); void utils.leadops.pipelineOverview.invalidate();
      onDone?.();
    },
    onError: (error) => toast.error(error.message),
  });
  const disabled = !leadIds.length || Boolean(disabledHint) || add.isPending;
  const title = disabledHint ?? "Die Serie dieser Kampagne (noch einmal) bekommen – auch wer schon durch war; wer gerade drin läuft, bekommt sie nicht doppelt";
  const select = <select className={variant === "pill" ? "card-move-pipeline" : "owner-select"} aria-label={label} title={title} value="" disabled={disabled} onChange={(event) => { const id = Number(event.target.value); if (id) add.mutate({ id, leadIds, again: true }); }}>
    <option value="">{add.isPending ? "Wird aufgenommen …" : variant === "pill" ? label : `${label} …`}</option>
    {list.isLoading && <option value="" disabled>Wird geladen …</option>}
    {choices.map((row) => <option key={row.id} value={row.id}>{campaignOptionText(row.tag, row.name)}{row.status === "entwurf" ? " (Entwurf)" : row.status === "pausiert" ? " (pausiert)" : ""}</option>)}
  </select>;
  return variant === "pill" ? <label className="card-move-pill" title={title}><Mail className="h-3.5 w-3.5" aria-hidden="true" />{select}</label> : select;
}
