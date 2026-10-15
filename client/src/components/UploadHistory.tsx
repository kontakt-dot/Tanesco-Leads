import { confirmAction } from "@/lib/confirm";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/**
 * Upload-Verlauf: welche Liste wann und von wem hochgeladen wurde, wie viele Kontakte dabei neu entstanden sind
 * und wie viele davon es noch gibt. „Rückgängig“ löscht genau die Kontakte dieses Uploads – aktualisierte Kontakte
 * und Kunden bleiben, weil die es vorher schon gab.
 */
const stamp = (value: string | Date) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function UploadHistory({ onChanged }: { onChanged?: () => void }) {
  const utils = trpc.useUtils();
  const history = trpc.leadops.listImportHistory.useQuery({ limit: 50 }, { retry: false });
  const undo = trpc.leadops.undoListImport.useMutation({ onSuccess: (result) => {
    toast.success(`Upload „${result.listName}“ zurückgenommen: ${result.deleted} ${result.deleted === 1 ? "Kontakt" : "Kontakte"} gelöscht${result.keptCustomers ? `, ${result.keptCustomers} Kunden behalten` : ""}.`);
    utils.leadops.listImportHistory.invalidate(); utils.leadops.listColdLists.invalidate(); utils.leadops.emailLeads.invalidate(); utils.leadops.pipelineOverview.invalidate(); onChanged?.();
  }, onError: (error) => toast.error(error.message) });
  const rows = history.data ?? [];

  return <section className="surface-panel operations-panel p-5">
    <span className="eyebrow">UPLOAD-VERLAUF</span>
    <h2 className="mt-1 text-lg text-slate-100">Was wurde wann hochgeladen?</h2>
    <p className="text-xs text-slate-500">Jeder Upload mit Datum, Liste und Anzahl. „Rückgängig“ entfernt genau die Kontakte dieses Uploads – Kontakte, die dabei nur ergänzt wurden, und Kunden bleiben erhalten.</p>
    {history.isLoading ? <p className="py-8 text-center text-sm text-slate-500">Wird geladen …</p>
      : !rows.length ? <p className="py-8 text-center text-sm text-slate-500">Noch nichts hochgeladen.</p>
      : <div className="upload-history">{rows.map((row) => <div key={row.id} className={`upload-row ${row.undoneAt ? "is-undone" : ""}`}>
          <div className="upload-main">
            <strong>{row.listName}</strong>
            <small>{stamp(row.createdAt)}{row.actorName ? ` · ${row.actorName}` : ""} · {row.source === "kampagne" ? "aus der E-Mail-Kampagne" : "aus der Kaltakquise"}{row.toPipeline ? "" : " · nicht in der Pipeline"}</small>
          </div>
          <div className="upload-numbers">
            <span><strong>{row.created}</strong> neu</span>
            {row.updated ? <span><strong>{row.updated}</strong> aktualisiert</span> : null}
            {row.duplicates && !row.updated ? <span><strong>{row.duplicates}</strong> Dubletten</span> : null}
            <span className="text-slate-500">{row.stillThere} von {row.created} noch da</span>
          </div>
          {row.undoneAt ? <span className="upload-done">zurückgenommen {stamp(row.undoneAt)}</span>
            : <button type="button" className="upload-undo" disabled={undo.isPending || row.stillThere === 0} onClick={async () => { if (await confirmAction(`Upload „${row.listName}“ vom ${stamp(row.createdAt)} rückgängig machen? Dabei werden ${row.stillThere} Kontakte gelöscht. Das lässt sich nicht widerrufen.`, { danger: true })) undo.mutate({ id: row.id }); }}>{row.stillThere === 0 ? "nichts mehr da" : "Rückgängig"}</button>}
        </div>)}</div>}
  </section>;
}
