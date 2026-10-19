import { confirmAction, promptAction } from "@/lib/confirm";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { FileUp, Trash2 } from "lucide-react";
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

  return <section className="surface-panel operations-panel p-5 uh-panel">
    <div className="xl-head"><div><h2>Upload-Verlauf <span>{all.length}</span></h2><p>Jeder Upload und jede Löschung mit Datum, Liste, Anzahl und wer. „Rückgängig“ entfernt genau die neuen Kontakte eines Uploads – ergänzte Kontakte und Kunden bleiben.</p></div>
      <div className="cd-filters" role="tablist" aria-label="Verlauf filtern">{([["alle", "Alles", all.length], ["upload", "Uploads", uploads.length], ["loeschung", "Löschungen", deletions.length]] as const).map(([key, label, count]) => <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? "is-active" : ""} onClick={() => setFilter(key)}>{label}<i>{count}</i></button>)}</div></div>
    {deletions.length > 0 && filter !== "upload" && <p className="uh-sum"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Insgesamt <strong>{deletedTotal}</strong> {deletedTotal === 1 ? "Kontakt" : "Kontakte"} gelöscht – zuletzt {stamp(deletions[0].createdAt)}</p>}
    {history.isLoading ? <p className="py-8 text-center text-sm text-slate-500">Wird geladen …</p>
      : !rows.length ? <p className="py-8 text-center text-sm text-slate-500">{filter === "loeschung" ? "Noch nichts gelöscht." : "Noch nichts hochgeladen."}</p>
      : <ol className="uh-list">{rows.map((row) => row.kind === "loeschung" ? <li key={row.id} className="uh-row is-deletion">
          <span className="uh-icon" aria-hidden="true"><Trash2 className="h-4 w-4" /></span>
          <div className="uh-main"><strong>{row.rowCount} {row.rowCount === 1 ? "Kontakt" : "Kontakte"} aus „{row.listName}“ gelöscht</strong><small>{stamp(row.createdAt)}{row.actorName ? ` · ${row.actorName}` : ""}{row.note ? ` · ${row.note}` : ""}</small></div>
          <div className="uh-nums"><span className="uh-num is-minus"><b>−{row.rowCount}</b>gelöscht</span></div>
          <div className="uh-actions" />
        </li> : <li key={row.id} className={`uh-row ${row.undoneAt ? "is-undone" : ""}`}>
          <span className="uh-icon" aria-hidden="true"><FileUp className="h-4 w-4" /></span>
          <div className="uh-main"><strong>{row.listName}</strong><small>{stamp(row.createdAt)}{row.actorName ? ` · ${row.actorName}` : ""} · {row.source === "kampagne" ? "E-Mail-Kampagne" : "Kaltakquise"}{row.toPipeline ? "" : " · nicht in der Pipeline"}</small></div>
          <div className="uh-nums">
            <span className="uh-num"><b>{row.created}</b>neu</span>
            {row.updated ? <span className="uh-num"><b>{row.updated}</b>ergänzt</span> : null}
            {row.duplicates && !row.updated ? <span className="uh-num"><b>{row.duplicates}</b>Dubletten</span> : null}
            <span className="uh-num is-muted"><b>{row.stillThere ?? 0}/{row.created}</b>noch da</span>
          </div>
          <div className="uh-actions">{row.undoneAt ? <span className="uh-done">zurückgenommen {stamp(row.undoneAt)}</span>
            : <>{(row.kind ?? "upload") === "upload" && row.stillThere !== 0 && <button type="button" className="cj-btn" disabled={rename.isPending} title="Die Kontakte dieses Uploads in eine Liste mit anderem Namen verschieben" onClick={async () => { const next = await promptAction(`Neuer Listenname für den Upload vom ${stamp(row.createdAt)} (${row.stillThere ?? row.created} Kontakte):`, row.listName); if (next && next.trim() && next.trim() !== row.listName) rename.mutate({ id: row.id, listName: next.trim() }); }}>Umbenennen</button>}<button type="button" className="cj-btn is-danger" disabled={undo.isPending || row.stillThere === 0} onClick={async () => { if (await confirmAction(`Upload „${row.listName}“ vom ${stamp(row.createdAt)} rückgängig machen? Dabei werden ${row.stillThere} Kontakte gelöscht. Das lässt sich nicht widerrufen.`, { danger: true })) undo.mutate({ id: row.id }); }}>{row.stillThere === 0 ? "nichts mehr da" : "Rückgängig"}</button></>}</div>
        </li>)}</ol>}
  </section>;
}
