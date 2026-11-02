/**
 * „Liste aktualisieren“: eine neue Fassung einer bestehenden Liste hochladen (z. B. in Excel bereinigt). Erst zeigt die Vorschau,
 * was passiert – wie viele neu dazukommen, wie viele bleiben und wer gelöscht wird –, dann übernimmt ein Klick die Datei.
 * Wer nicht mehr in der Datei steht, wird gelöscht (auch aus den Kampagnen; 60 Tage im Papierkorb), Kunden bleiben immer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, RefreshCw, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ListColumnMapping from "@/components/ListColumnMapping";
import { confirmAction } from "@/lib/confirm";
import { readListFile } from "@/lib/list-file";
import { trpc } from "@/lib/trpc";
import { parseColdList, type ColumnTarget } from "../../../shared/cold-list";

export default function ListUpdateBox({ listName, onDone, onClose }: { listName: string; onDone?: () => void; onClose: () => void }) {
  const [csv, setCsv] = useState(""); const [fileName, setFileName] = useState(""); const [mapping, setMapping] = useState<ColumnTarget[] | null>(null); const [dragging, setDragging] = useState(false); const [showMapping, setShowMapping] = useState(false); // Spalten-Zuordnung: bei der eigenen, heruntergeladenen Datei passt sie fast immer – nur auf Wunsch aufklappen
  const inputRef = useRef<HTMLInputElement>(null); const utils = trpc.useUtils();
  const parsed = useMemo(() => (csv.trim() ? parseColdList(csv, mapping) : null), [csv, mapping]); // lokal ausgewertet, gleicher Code wie der Server
  const preview = trpc.leadops.previewListUpdate.useMutation({ onError: (error) => toast.error(error.message) });
  const download = trpc.leadops.exportColdList.useMutation({ onSuccess: (result) => { try { const blob = new Blob([`\ufeff${result.csv}`], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = result.fileName; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); toast.success(`${result.rows} Kontakte als Datei heruntergeladen – in Excel bearbeiten, speichern und hier wieder hochladen.`, { duration: 7000 }); } catch { toast.error("Die Datei konnte nicht heruntergeladen werden."); } }, onError: (error) => toast.error(error.message) });
  const refresh = () => { void utils.leadops.listColdLists.invalidate(); void utils.leadops.coldListContacts.invalidate(); void utils.leadops.emailLeads.invalidate(); void utils.leadops.previewEmailAudience.invalidate(); void utils.leadops.pipelineOverview.invalidate(); void utils.leadops.listEmailCampaigns.invalidate(); void utils.leadops.listImportHistory.invalidate(); void utils.leadops.listUndo.invalidate(); void utils.leadops.campaignReviewQueue.invalidate(); };
  const apply = trpc.leadops.updateColdList.useMutation({
    onSuccess: (result) => {
      toast.success(`Liste „${result.listName}“ aktualisiert: ${result.created} neu, ${result.removed} gelöscht${result.keptCustomers ? `, ${result.keptCustomers} Kunden behalten` : ""}.${result.removed ? " Gelöschte lassen sich 60 Tage lang unter „Verlauf“ wiederherstellen." : ""}`, { duration: 9000 });
      for (const campaign of result.campaigns ?? []) toast.success(`${campaign.added} neue Kontakte in die laufende Kampagne „${campaign.name}“ aufgenommen.`, { duration: 8000 });
      refresh(); onDone?.(); onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  const rows = parsed?.rows ?? [];
  // Vorschau neu holen, sobald Datei oder Spalten-Zuordnung sich ändern
  useEffect(() => { if (!rows.length) return; const timer = window.setTimeout(() => preview.mutate({ listName, rows: rows.slice(0, 5000) }), 200); return () => window.clearTimeout(timer); }, [parsed, listName]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = async (file: File | null | undefined) => { if (!file) return; try { const read = await readListFile(file); setMapping(null); setCsv(read.text); setFileName(file.name); preview.reset(); } catch (error) { toast.error(error instanceof Error ? error.message : "Die Datei konnte nicht gelesen werden."); } };
  const plan = preview.data && rows.length ? preview.data : null;
  const bigLoss = Boolean(plan && plan.before > 4 && plan.entfernen > plan.before / 2); // mehr als die Hälfte fällt weg – falsche Datei?
  const submit = async () => {
    if (!plan || !rows.length) return;
    if (plan.entfernen > 0) { const ok = await confirmAction(`${plan.entfernen} ${plan.entfernen === 1 ? "Kontakt" : "Kontakte"} aus „${listName}“ löschen und die Liste aktualisieren?${bigLoss ? " Achtung: Das ist mehr als die Hälfte der Liste – ist es die richtige Datei?" : ""} Sie fallen auch aus den Kampagnen. Im Papierkorb lassen sie sich 60 Tage lang wiederherstellen.`, { danger: true, confirmLabel: "Ja, aktualisieren" }); if (!ok) return; }
    apply.mutate({ listName, rows: rows.slice(0, 5000) });
  };
  return <div className={`list-update ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void pick(event.dataTransfer.files?.[0]); }}>
    <div className="list-update-head"><strong>Liste „{listName}“ aktualisieren</strong><button type="button" className="list-update-close" aria-label="Schließen" onClick={onClose}><X className="h-4 w-4" /></button></div>
    <ol className="list-update-steps">
      <li><span className="list-update-step" aria-hidden="true">1</span><div><p>Aktuelle Liste herunterladen, in Excel bearbeiten (Firmen löschen oder dazuschreiben) und speichern.</p><button type="button" className="list-upload-pick" disabled={download.isPending} onClick={() => download.mutate({ listName })}><Download className="h-3.5 w-3.5" aria-hidden="true" /> {download.isPending ? "Wird erstellt …" : "Liste herunterladen"}</button></div></li>
      <li><span className="list-update-step" aria-hidden="true">2</span><div><p>Bearbeitete Datei hier hochladen. Du siehst vorher, was sich ändert: Wer nicht mehr in der Datei steht, wird gelöscht – Kunden bleiben. Wer drinbleibt, behält Verlauf und Kampagne.</p></div></li>
    </ol>
    <div className="list-update-file"><button type="button" className="list-upload-pick" onClick={() => inputRef.current?.click()}><Upload className="h-3.5 w-3.5" aria-hidden="true" /> {parsed ? "Andere Datei wählen" : "Bearbeitete Datei wählen"}</button><input ref={inputRef} type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden" aria-label="Neue Fassung der Liste wählen" onChange={(event) => { void pick(event.target.files?.[0]); event.target.value = ""; }} />{parsed ? <small><strong>{fileName}</strong>: {parsed.rows.length} Kontakte erkannt{parsed.skipped ? ` · ${parsed.skipped} Zeilen ohne Telefon/E-Mail übersprungen` : ""}</small> : <small>Excel oder CSV – hierher ziehen oder wählen.</small>}</div>
    {parsed && <>
      {showMapping || !rows.length ? <ListColumnMapping columns={parsed.columns} mapping={parsed.mapping} sample={parsed.rows[0] ?? null} onChange={setMapping} /> : <button type="button" className="list-update-mapping" onClick={() => setShowMapping(true)}>Spalten automatisch erkannt – ändern</button>}
      {!rows.length && <p className="list-update-warn"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> In der Datei steht kein Kontakt mit Telefon oder E-Mail – so lässt sich die Liste nicht aktualisieren.</p>}
      {plan && <div className="list-update-plan" aria-live="polite">
        <span className="is-new"><b>{plan.neu}</b> neu</span>
        <span className="is-stay"><b>{plan.bleiben}</b> bleiben</span>
        <span className="is-gone"><b>{plan.entfernen}</b> {plan.entfernen === 1 ? "wird" : "werden"} gelöscht</span>
        {plan.kundenBleiben > 0 && <span className="is-keep"><b>{plan.kundenBleiben}</b> {plan.kundenBleiben === 1 ? "Kunde bleibt" : "Kunden bleiben"}, obwohl {plan.kundenBleiben === 1 ? "er fehlt" : "sie fehlen"}</span>}
      </div>}
      {bigLoss && <p className="list-update-warn"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Mehr als die Hälfte der Liste würde gelöscht. Prüfe, ob es die richtige Datei ist.</p>}
      {plan && plan.entfernen > 0 && <details className="list-update-gone"><summary>Diese {plan.entfernen === 1 ? "Firma wird" : `${plan.entfernen} Firmen werden`} gelöscht</summary><ul>{plan.removeSample.map((row) => <li key={row.id}><strong>{row.name}</strong>{row.email ? <small>{row.email}</small> : null}</li>)}</ul>{plan.entfernen > plan.removeSample.length && <small>… und {plan.entfernen - plan.removeSample.length} weitere</small>}</details>}
      <div className="list-update-actions"><Button size="sm" className="flux-button" disabled={!plan || !rows.length || apply.isPending || preview.isPending} onClick={() => void submit()}><RefreshCw className={apply.isPending ? "animate-spin" : ""} /> {apply.isPending ? "Aktualisiert …" : "Liste aktualisieren"}</Button><Button size="sm" variant="ghost" onClick={onClose}>Abbrechen</Button></div>
    </>}
  </div>;
}
