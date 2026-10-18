import { confirmAction, promptAction } from "@/lib/confirm";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Upload-Verlauf: welche Liste wann und von wem hochgeladen wurde, wie viele Kontakte dabei neu entstanden sind
 * und wie viele davon es noch gibt. „Rückgängig“ löscht genau die Kontakte dieses Uploads – aktualisierte Kontakte
 * und Kunden bleiben, weil die es vorher schon gab.
 */
const stamp = (value: string | Date) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function UploadHistory({ onChanged }: { onChanged?: () => void }) {
  const utils = trpc.useUtils();
  const history = trpc.leadops.listImportHistory.useQuery({ limit: 100 }, { retry: false });
  const [filter, setFilter] = useState<"alle" | "upload" | "loeschung">("alle");
  const undo = trpc.leadops.undoListImport.useMutation({ onSuccess: (result) => {
    toast.success(`Upload „${result.listName}“ zurückgenommen: ${result.deleted} ${result.deleted === 1 ? "Kontakt" : "Kontakte"} gelöscht${result.keptCustomers ? `, ${result.keptCustomers} Kunden behalten` : ""}.`);
    utils.leadops.listImportHistory.invalidate(); utils.leadops.listColdLists.invalidate(); utils.leadops.emailLeads.invalidate(); utils.leadops.pipelineOverview.invalidate(); onChanged?.();
  }, onError: (error) => toast.error(error.message) });
  const rename = trpc.leadops.renameListImport.useMutation({ onSuccess: (result) => {
    toast.success(`${result.renamed} ${result.renamed === 1 ? "Kontakt" : "Kontakte"} jetzt in der Liste „${result.listName}“.`);
    utils.leadops.listImportHistory.invalidate(); utils.leadops.listColdLists.invalidate(); utils.leadops.emailLeads.invalidate(); utils.leadops.pipelineOverview.invalidate(); onChanged?.();
  }, onError: (error) => toast.error(error.message) });
  const all = history.data ?? []; const uploads = all.filter((row) => (row.kind ?? "upload") === "upload"); const deletions = all.filter((row) => row.kind === "loeschung");
  const rows = filter === "upload" ? uploads : filter === "loeschung" ? deletions : all;
  const deletedTotal = deletions.reduce((sum, row) => sum + row.rowCount, 0);

  return <section className="surface-panel operations-panel p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="eyebrow">UPLOAD-VERLAUF</span>
      <h2 className="mt-1 text-lg text-slate-100">Was wurde wann hochgeladen – und wann gelöscht?</h2>
      <p className="text-xs text-slate-500">Jeder Upload mit Datum, Liste, Anzahl und wer. Jede Löschung steht ebenfalls hier: wann, wie viele Kontakte, aus welcher Liste, von wem und warum (von Hand, ganze Liste, Upload zurückgenommen). „Rückgängig“ entfernt genau die Kontakte eines Uploads – Kontakte, die dabei nur ergänzt wurden, und Kunden bleiben erhalten.</p></div>
      <div className="dashboard-segments" role="tablist" aria-label="Verlauf filtern">{([["alle", `Alles ${all.length}`], ["upload", `Uploads ${uploads.length}`], ["loeschung", `Löschungen ${deletions.length}`]] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label}</button>)}</div></div>
    {deletions.length > 0 && filter !== "upload" && <p className="upload-deleted-sum">Insgesamt <strong>{deletedTotal}</strong> {deletedTotal === 1 ? "Kontakt" : "Kontakte"} gelöscht – zuletzt {stamp(deletions[0].createdAt)}.</p>}
    {history.isLoading ? <p className="py-8 text-center text-sm text-slate-500">Wird geladen …</p>
      : !rows.length ? <p className="py-8 text-center text-sm text-slate-500">{filter === "loeschung" ? "Noch nichts gelöscht." : "Noch nichts hochgeladen."}</p>
      : <div className="upload-history">{rows.map((row) => row.kind === "loeschung" ? <div key={row.id} className="upload-row is-deletion">
          <div className="upload-main"><strong><span className="upload-deleted-tag">Gelöscht</span> {row.rowCount} {row.rowCount === 1 ? "Kontakt" : "Kontakte"} aus „{row.listName}“</strong><small>{stamp(row.createdAt)}{row.actorName ? ` · ${row.actorName}` : ""}{row.note ? ` · ${row.note}` : ""}</small></div>
          <div className="upload-numbers"><span><strong>−{row.rowCount}</strong> gelöscht</span></div>
        </div> : <div key={row.id} className={`upload-row ${row.undoneAt ? "is-undone" : ""}`}>
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
          {!row.undoneAt && (row.kind ?? "upload") === "upload" && row.stillThere !== 0 && <button type="button" className="upload-undo upload-rename" disabled={rename.isPending} title="Die Kontakte dieses Uploads in eine Liste mit anderem Namen verschieben" onClick={async () => { const next = await promptAction(`Neuer Listenname für den Upload vom ${stamp(row.createdAt)} (${row.stillThere ?? row.created} Kontakte):`, row.listName); if (next && next.trim() && next.trim() !== row.listName) rename.mutate({ id: row.id, listName: next.trim() }); }}>Umbenennen</button>}
        </div>)}</div>}
  </section>;
}
