import { trpc } from "@/lib/trpc";
import { confirmAction } from "@/lib/confirm";
import { MailX, ArrowRightLeft, CopyX, History, Layers, MailMinus, NotebookPen, Phone, PhoneOff, RotateCcw, Trash2, UserPlus, Users } from "lucide-react";
import RestoreStateDialog from "@/components/RestoreStateDialog";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Rückgängig & Papierkorb der Vertriebspipeline.
 *  - `withUndo(undoId)`: Toast-Option mit Knopf „Rückgängig“ – direkt nach einer Aktion.
 *  - `UndoBridge`: hört auf den Knopf und nimmt die Aktion zurück (einmal je Seite eingebunden).
 *  - `UndoPanel`: Reiter „Rückgängig“ – alle Aktionen der letzten 60 Tage, gelöschte Kontakte/Listen wiederherstellen.
 *    `scope="email"`: nur der Papierkorb der E-Mail-Kampagnen (E-Mail-Kampagnen → Verlauf → Papierkorb) – gelöschte Kontakte/Listen,
 *    aus Kampagnen entfernte Empfänger, gelöschte Kampagnen, „aus dem E-Mail-Funnel genommen“ und „Nicht doppelt“.
 */
const EVENT = "tanesco:undo";
export function withUndo(undoId: number | null | undefined, extra: { duration?: number } = {}) {
  if (!undoId) return extra;
  return { ...extra, duration: Math.max(extra.duration ?? 0, 9000), action: { label: "Rückgängig", onClick: () => window.dispatchEvent(new CustomEvent(EVENT, { detail: undoId })) } };
}
export const undoIdOf = (result: unknown) => (result && typeof result === "object" && "undoId" in result ? Number((result as { undoId?: number }).undoId) || 0 : 0);

function useInvalidateAll() {
  const utils = trpc.useUtils();
  return () => { void utils.leadops.listUndo.invalidate(); void utils.leadops.pipelineOverview.invalidate(); void utils.leadops.pipelineLeadDetail.invalidate(); void utils.leadops.pipelineHistory.invalidate(); void utils.leadops.callAttempts.invalidate(); void utils.leadops.emailLeads.invalidate(); void utils.leadops.listColdLists.invalidate(); void utils.leadops.listImportHistory.invalidate(); void utils.leadops.listPipelineTasks.invalidate(); void utils.leadops.listEmailCampaigns.invalidate(); void utils.leadops.getEmailCampaign.invalidate(); void utils.leadops.campaignDailyStatus.invalidate(); void utils.leadops.campaignReviewQueue.invalidate(); };
}

export function UndoBridge() {
  const refresh = useInvalidateAll();
  const undo = trpc.leadops.undoOperation.useMutation({ onSuccess: (result) => { toast.success(result.message); refresh(); }, onError: (error) => toast.error(error.message) });
  useEffect(() => { const handler = (event: Event) => { const id = Number((event as CustomEvent).detail); if (id) undo.mutate({ id }); }; window.addEventListener(EVENT, handler); return () => window.removeEventListener(EVENT, handler); }, [undo]);
  return null;
}

type Filter = "alle" | "loeschen" | "anruf" | "stufe" | "zuteilung" | "pipeline" | "notiz" | "kontakt_neu" | "serie";
const FILTERS: Array<[Filter, string]> = [["alle", "Alles"], ["loeschen", "Gelöscht"], ["anruf", "Anrufe"], ["stufe", "Stufen"], ["zuteilung", "Zuteilung"], ["pipeline", "Pipeline"], ["notiz", "Notizen"], ["kontakt_neu", "Angelegt"], ["serie", "E-Mail-Funnel"]];
const ICON: Record<string, typeof Phone> = { loeschen: Trash2, empfaenger_weg: MailMinus, kampagne_weg: Trash2, anruf: Phone, anruf_weg: PhoneOff, stufe: ArrowRightLeft, zuteilung: Users, pipeline: Layers, notiz_neu: NotebookPen, notiz_text: NotebookPen, notiz_weg: NotebookPen, kontakt_neu: UserPlus, serie: MailX, doppelt: CopyX };
/** Papierkorb: gelöschte Kontakte/Listen, aus Kampagnen entfernte Empfänger, gelöschte Kampagnen. */
const TRASH = ["loeschen", "empfaenger_weg", "kampagne_weg"];
/** Bei den E-Mail-Kampagnen: Papierkorb plus „aus dem E-Mail-Funnel genommen“ und der Doppelt-Schutz. */
const EMAIL_KINDS = [...TRASH, "serie", "doppelt"];
const matches = (kind: string, filter: Filter) => filter === "alle" || (filter === "anruf" ? kind.startsWith("anruf") : filter === "notiz" ? kind.startsWith("notiz") : filter === "loeschen" ? TRASH.includes(kind) : filter === "serie" ? kind === "serie" || kind === "doppelt" : kind === filter);
const restoreQuestion = (kind: string, title: string) => kind === "loeschen" ? `„${title}“ wiederherstellen? Die Kontakte kommen mit Verlauf, Notizen, Anrufen und Kampagnen zurück.` : kind === "empfaenger_weg" ? `„${title}“ wiederherstellen? Die Empfänger kommen mit ihrem Verlauf zurück in die Kampagne (gesendet, geöffnet, geantwortet) und machen dort weiter, wo sie standen. Niemand bekommt eine E-Mail doppelt.` : kind === "kampagne_weg" ? `„${title}“ wiederherstellen? Die Kampagne kommt mit allen Empfängern und ihrem Verlauf zurück – Stand wie vor dem Löschen (laufende Kampagnen bleiben, wie sie waren).` : kind === "doppelt" ? `„${title}“ zurücknehmen? Diese Kontakte stehen dann wieder wie vorher – wer die Erst-E-Mail schon bekommen hatte, bekommt sie dann noch einmal.` : null;
const when = (value: string | Date) => new Date(value).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function UndoPanel({ scope = "alle" }: { scope?: "alle" | "email" }) {
  const list = trpc.leadops.listUndo.useQuery({ limit: 300 }, { retry: false, refetchInterval: 30_000 });
  const email = scope === "email";
  const refresh = useInvalidateAll();
  const undo = trpc.leadops.undoOperation.useMutation({ onSuccess: (result) => { toast.success(result.message); refresh(); }, onError: (error) => toast.error(error.message) });
  const [filter, setFilter] = useState<Filter>("alle"); const [showDone, setShowDone] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const all = (list.data ?? []).filter((row) => !email || EMAIL_KINDS.includes(row.kind));
  const rows = all.filter((row) => matches(row.kind, filter) && (showDone || !row.undoneAt));
  const count = (key: Filter) => all.filter((row) => matches(row.kind, key) && !row.undoneAt).length;
  return <section className={`surface-panel operations-panel p-5 undo-panel ${email ? "is-email" : ""}`}>
    <div className="xl-head"><div>{email ? <><h2>Papierkorb <span>{all.filter((row) => !row.undoneAt).length}</span></h2><p>Alles, was bei den E-Mail-Kampagnen gelöscht oder entfernt wurde – Kontakte und Listen, Empfänger („Entfernen“, Liste entfernt), ganze Kampagnen – der letzten 60 Tage. „Wiederherstellen“ holt es mit Verlauf zurück: Wer schon E-Mails hatte, macht dort weiter, wo er stand. Niemand bekommt eine E-Mail doppelt, und gesendete E-Mails zählen immer mit.</p></> : <><h2>Rückgängig &amp; Papierkorb <span>{all.filter((row) => !row.undoneAt).length}</span></h2><p>Jede Aktion in der Vertriebspipeline der letzten 60 Tage – Stufe, Zuteilung, Anruf-Ergebnis, Notiz, verschoben, angelegt, gelöscht. Ein Klick nimmt sie zurück; gelöschte Kontakte und Listen kommen mit Verlauf, Notizen, Anrufen und Kampagnen zurück.</p></>}</div>
      <label className="undo-show-done"><input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} /> auch erledigte zeigen</label></div>
    {!email && <div className="undo-restore"><History className="h-4 w-4" aria-hidden="true" /><p><strong>Früheren Stand wiederherstellen</strong><span>Kontakte so zurücksetzen, wie sie zu einem Zeitpunkt standen – z. B. gestern Abend. Pipeline, Stufe und Vertriebler; mit Vorschau.</span></p><button type="button" className="cj-btn" onClick={() => setRestoreOpen(true)}>Zeitpunkt wählen …</button></div>}
    {!email && <RestoreStateDialog open={restoreOpen} onClose={() => setRestoreOpen(false)} />}
    <div className="cd-filters" role="tablist" aria-label="Nach Art filtern">{FILTERS.filter(([key]) => !email || key === "alle" || key === "loeschen" || key === "serie").filter(([key]) => key === "alle" || count(key) > 0 || filter === key).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? "is-active" : ""} onClick={() => setFilter(key)}>{label}<i>{count(key)}</i></button>)}</div>
    {list.isLoading ? <p className="cd-empty">Wird geladen …</p> : !rows.length ? <p className="cd-empty">{filter === "loeschen" || email ? "Der Papierkorb ist leer – seit dem Update kommt hier alles hinein, was bei den E-Mail-Kampagnen gelöscht oder entfernt wird." : "Noch nichts, was sich zurücknehmen lässt."}</p>
      : <ol className="undo-list">{rows.map((row) => { const Icon = ICON[row.kind] ?? RotateCcw; const isDelete = TRASH.includes(row.kind) || row.kind === "anruf_weg" || row.kind === "notiz_weg"; return <li key={row.id} className={`${row.undoneAt ? "is-done" : ""} is-${row.kind}`}>
        <span className="undo-icon" aria-hidden="true"><Icon className="h-4 w-4" /></span>
        <div className="undo-main"><strong>{row.title}</strong><small>{row.label} · {when(row.createdAt)}{row.actor ? ` · ${row.actor}` : " · automatisch"}{row.count > 1 ? ` · ${row.count} Einträge` : ""}</small></div>
        {row.undoneAt ? <span className="undo-done">zurückgenommen {when(row.undoneAt)}</span>
          : <button type="button" className={`cj-btn ${isDelete ? "is-restore" : ""}`} disabled={undo.isPending} onClick={async () => { const question = restoreQuestion(row.kind, row.title); if (question ? await confirmAction(question, { confirmLabel: row.kind === "doppelt" ? "Zurücknehmen" : "Wiederherstellen" }) : true) undo.mutate({ id: row.id }); }}><RotateCcw className="h-3.5 w-3.5" /> {isDelete ? "Wiederherstellen" : "Rückgängig"}</button>}
      </li>; })}</ol>}
  </section>;
}
