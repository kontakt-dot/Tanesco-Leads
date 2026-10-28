/**
 * Ordner der E-Mail-Kampagnen: oben eine Leiste mit „Alle“, den Ordnern und „Ohne Ordner“ – die Liste und die Kennzahlen darunter
 * zeigen nur den gewählten Ordner. Kampagnen kommen über „⋯“ → „In Ordner verschieben“ oder per Ziehen auf einen Ordner hinein;
 * „Nach Leadsparte einsortieren“ legt je Sparte einen Ordner an. Ordner sind nur Ablage – an Versand und Zahlen ändert sich nichts.
 */
import { confirmAction, promptAction } from "@/lib/confirm";
import { trpc } from "@/lib/trpc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Check, Folder, FolderInput, FolderMinus, FolderOpen, FolderPlus, FolderTree, Layers, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { cleanFolderName, folderNameIssue, planSparteFolders, sortFolders, sortSummary } from "../../../shared/campaign-folders";
import { resolveSparte } from "../../../shared/lead-sparte";

export type FolderPick = "alle" | "ohne" | number;
export type CampaignFolder = { id: number; name: string };
type FolderCampaign = { id: number; name: string; folderId?: number | null; sparte?: { label: string } | null; archivedAt?: Date | string | null };

const PICK_KEY = "kampagnen-ordner";
/** Zuletzt gewählter Ordner (im Browser gemerkt) – ohne Speicher einfach „Alle“. */
export function readFolderPick(): FolderPick {
  try { const saved = localStorage.getItem(PICK_KEY) ?? ""; if (saved === "ohne") return "ohne"; const id = Number(saved); return Number.isInteger(id) && id > 0 ? id : "alle"; } catch { return "alle"; }
}
export function saveFolderPick(pick: FolderPick) { try { localStorage.setItem(PICK_KEY, String(pick)); } catch { /* egal */ } }
export const folderIdOf = (row: { folderId?: number | null }) => row.folderId ?? null;
export const campaignCount = (count: number) => `${count} Kampagne${count === 1 ? "" : "n"}`;
/** Liegt die Kampagne im gewählten Ordner? „Ohne Ordner“ zählt auch Kampagnen, deren Ordner es nicht mehr gibt. */
export function inFolder(row: { folderId?: number | null }, pick: FolderPick, known: Set<number>) {
  const id = folderIdOf(row);
  return pick === "alle" ? true : pick === "ohne" ? !(id && known.has(id)) : id === pick;
}

/** Ordner laden und bearbeiten – mit kurzen Meldungen; Verschieben lässt sich rückgängig machen. */
export function useCampaignFolders() {
  const utils = trpc.useUtils();
  const query = trpc.leadops.listEmailCampaignFolders.useQuery(undefined, { retry: false });
  const folders = useMemo(() => sortFolders(query.data ?? []).map((folder) => ({ id: folder.id, name: folder.name })), [query.data]);
  const known = useMemo(() => new Set(folders.map((folder) => folder.id)), [folders]);
  const refresh = () => Promise.all([utils.leadops.listEmailCampaignFolders.invalidate(), utils.leadops.listEmailCampaigns.invalidate()]);
  const onError = (error: { message: string }) => toast.error(error.message);
  const save = trpc.leadops.saveEmailCampaignFolder.useMutation({ onError });
  const drop = trpc.leadops.deleteEmailCampaignFolder.useMutation({ onError });
  const move = trpc.leadops.moveEmailCampaignsToFolder.useMutation({ onError });
  const sort = trpc.leadops.sortEmailCampaignsBySparte.useMutation({ onError });

  const askName = async (message: string, current = "", ownId: number | null = null) => {
    const value = await promptAction(message, current, "z. B. Hausnotruf"); if (value === null) return null;
    const issue = folderNameIssue(value, folders, ownId); if (issue) { toast.error(issue); return null; }
    return cleanFolderName(value);
  };
  const create = async (): Promise<CampaignFolder | null> => {
    const name = await askName("Wie soll der neue Ordner heißen?"); if (!name) return null;
    const result = await save.mutateAsync({ name }).catch(() => null); if (!result) return null;
    await refresh(); return { id: result.id, name: result.name }; // erst neu laden – dann kennt die Leiste den Ordner schon
  };
  const rename = async (folder: CampaignFolder) => {
    const name = await askName(`Neuer Name für den Ordner „${folder.name}“`, folder.name, folder.id); if (!name || name === folder.name) return;
    const result = await save.mutateAsync({ id: folder.id, name }).catch(() => null); if (!result) return;
    toast.success(`Der Ordner heißt jetzt „${result.name}“.`); void refresh();
  };
  const remove = async (folder: CampaignFolder, count: number) => {
    const question = count ? `Ordner „${folder.name}“ löschen? Die ${campaignCount(count)} darin ${count === 1 ? "bleibt" : "bleiben"} erhalten und ${count === 1 ? "steht" : "stehen"} danach unter „Ohne Ordner“.` : `Leeren Ordner „${folder.name}“ löschen?`;
    if (!(await confirmAction(question, { danger: true, confirmLabel: "Ordner löschen" }))) return false;
    const result = await drop.mutateAsync({ id: folder.id }).catch(() => null); if (!result) return false;
    toast.success(`Ordner „${folder.name}“ gelöscht${result.released ? ` – ${campaignCount(result.released)} jetzt ohne Ordner` : ""}.`); void refresh(); return true;
  };
  /** Kampagnen in einen Ordner legen (null = ohne Ordner); die Meldung bietet „Rückgängig“ an. */
  const moveTo = async (rows: FolderCampaign[], folder: CampaignFolder | null) => {
    const ids = rows.filter((row) => folderIdOf(row) !== (folder?.id ?? null)).map((row) => row.id); if (!ids.length) return;
    const before = rows.filter((row) => ids.includes(row.id)).map((row) => ({ id: row.id, folderId: folderIdOf(row) && known.has(folderIdOf(row)!) ? folderIdOf(row) : null }));
    const result = await move.mutateAsync({ ids, folderId: folder?.id ?? null }).catch(() => null); if (!result) return;
    void refresh();
    const one = ids.length === 1; const label = one ? `„${rows.find((row) => row.id === ids[0])?.name ?? "Kampagne"}“` : campaignCount(ids.length);
    const undo = async () => { const groups = new Map<number | null, number[]>(); for (const item of before) groups.set(item.folderId, [...(groups.get(item.folderId) ?? []), item.id]); for (const [folderId, groupIds] of Array.from(groups.entries())) await move.mutateAsync({ ids: groupIds, folderId }).catch(() => null); void refresh(); };
    toast.success(folder ? `${label} ${one ? "liegt" : "liegen"} jetzt im Ordner „${folder.name}“.` : `${label} ${one ? "liegt" : "liegen"} jetzt ohne Ordner.`, { duration: 7000, action: { label: "Rückgängig", onClick: () => { void undo(); } } });
  };
  /** Vorschau wie auf dem Server: welche Kampagnen ohne Ordner in welchen Sparten-Ordner kommen (für Knopf-Hinweis und Rückfrage). */
  const planFor = (rows: FolderCampaign[]) => planSparteFolders(rows.map((row) => { const label = row.sparte?.label ?? ""; return { id: row.id, folderId: folderIdOf(row) && known.has(folderIdOf(row)!) ? folderIdOf(row) : null, sparte: { key: resolveSparte(label)?.key ?? "eigene", label } }; }).filter((row) => row.sparte.label), folders);
  const sortBySparte = async (rows: FolderCampaign[]) => {
    const plan = planFor(rows); if (!plan.moves.length) { toast.success("Alle Kampagnen liegen schon in Ordnern."); return; }
    const groups = sortSummary(plan.moves); const summary = groups.map((item) => `${item.name} (${item.count})`).join(", ");
    const archived = plan.moves.filter((move) => rows.find((row) => row.id === move.id)?.archivedAt).length;
    const fresh = !plan.create.length ? "" : plan.create.length === groups.length ? (plan.create.length === 1 ? " Der Ordner wird neu angelegt." : " Die Ordner werden neu angelegt.") : ` Neu angelegt ${plan.create.length === 1 ? "wird" : "werden"}: ${plan.create.join(", ")}.`;
    if (!(await confirmAction(`Nach Leadsparte einsortieren? ${campaignCount(plan.moves.length)} ohne Ordner${archived ? ` (davon ${archived} im Archiv)` : ""} ${plan.moves.length === 1 ? "kommt" : "kommen"} in: ${summary}.${fresh} Schon einsortierte Kampagnen bleiben, wo sie sind.`, { confirmLabel: "Einsortieren" }))) return;
    const result = await sort.mutateAsync().catch(() => null); if (!result) return;
    void refresh();
    toast.success(`${campaignCount(result.moved)} einsortiert${result.created ? ` – ${result.created} Ordner neu angelegt` : ""}: ${result.folders.map((item) => `${item.name} (${item.count})`).join(", ")}.`, { duration: 8000 });
  };
  return { folders, known, /* geladen und nicht gerade neu am Laden – erst dann darf ein unbekannter Ordner auf „Alle“ zurückfallen */ settled: (query.isSuccess && !query.isFetching) || query.isError, create, rename, remove, moveTo, planFor, sortBySparte, sorting: sort.isPending };
}
type FolderTools = ReturnType<typeof useCampaignFolders>;

/**
 * Ordner-Leiste über Kennzahlen und Liste. Die Zahlen gelten für die gerade gezeigte Ansicht (Übersicht oder Archiv).
 * Beim Ziehen einer Kampagne werden die Ordner zu Ablagen („Ohne Ordner“ holt sie wieder heraus).
 */
export function CampaignFolderBar({ tools, rows, allRows, pick, onPick, dragged, onDropped }: { tools: FolderTools; rows: FolderCampaign[]; allRows: FolderCampaign[]; pick: FolderPick; onPick: (pick: FolderPick) => void; dragged: FolderCampaign | null; onDropped: () => void }) {
  const { folders, known } = tools;
  const [over, setOver] = useState<number | "ohne" | null>(null);
  const countOf = (id: number) => rows.filter((row) => folderIdOf(row) === id).length;
  const unfiled = rows.filter((row) => inFolder(row, "ohne", known)).length;
  const plan = tools.planFor(allRows);
  const target = (folder: CampaignFolder | null) => !dragged ? {} : {
    onDragOver: (event: DragEvent) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(folder?.id ?? "ohne"); },
    onDragLeave: () => setOver((value) => (value === (folder?.id ?? "ohne") ? null : value)),
    onDrop: (event: DragEvent) => { event.preventDefault(); setOver(null); const row = dragged; onDropped(); if (row) void tools.moveTo([row], folder); },
  };
  const sortHint = plan.moves.length ? `Legt je Leadsparte einen Ordner an und sortiert ${campaignCount(plan.moves.length)} ohne Ordner ein: ${sortSummary(plan.moves).map((item) => `${item.name} (${item.count})`).join(", ")}. Schon einsortierte bleiben, wo sie sind.` : "";
  return <nav className={`cl-folders ${dragged ? "is-dragging" : ""}`} aria-label="Ordner der Kampagnen">
    <div className="cl-folder-rail">
      <button type="button" className={`cl-folder is-all ${pick === "alle" ? "is-active" : ""}`} aria-pressed={pick === "alle"} title="Alle Kampagnen, egal in welchem Ordner" onClick={() => onPick("alle")}><Layers aria-hidden="true" /><span>Alle</span><i>{rows.length}</i></button>
      {folders.map((folder) => { const active = pick === folder.id; const count = countOf(folder.id); return <div key={folder.id} className={`cl-folder ${active ? "is-active" : ""} ${over === folder.id ? "is-over" : ""}`} {...target(folder)}>
        <button type="button" className="cl-folder-pick" aria-pressed={active} title={dragged ? `„${dragged.name}“ in den Ordner „${folder.name}“ legen` : `${folder.name}: ${campaignCount(count)}`} onClick={() => onPick(folder.id)}>{active || over === folder.id ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}<span>{folder.name}</span><i>{count}</i></button>
        {active && !dragged && <DropdownMenu modal={false}><DropdownMenuTrigger asChild><button type="button" className="cl-folder-more" title="Umbenennen oder löschen" aria-label={`Ordner „${folder.name}“ umbenennen oder löschen`}><MoreHorizontal aria-hidden="true" /></button></DropdownMenuTrigger><DropdownMenuContent align="start" className="campaign-act-menu"><DropdownMenuItem onSelect={() => { void tools.rename(folder); }}><Pencil /> Umbenennen</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="campaign-act-danger" onSelect={() => { void tools.remove(folder, allRows.filter((row) => folderIdOf(row) === folder.id).length); }}><Trash2 /> Ordner löschen</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
      </div>; })}
      {folders.length > 0 && (unfiled > 0 || pick === "ohne" || dragged) && <button type="button" className={`cl-folder is-none ${pick === "ohne" ? "is-active" : ""} ${over === "ohne" ? "is-over" : ""}`} aria-pressed={pick === "ohne"} title={dragged ? `„${dragged.name}“ aus dem Ordner nehmen` : "Kampagnen, die in keinem Ordner liegen"} onClick={() => onPick("ohne")} {...target(null)}><FolderMinus aria-hidden="true" /><span>Ohne Ordner</span><i>{unfiled}</i></button>}
    </div>
    <div className="cl-folder-actions">
      <button type="button" className="cl-folder-act" onClick={async () => { const folder = await tools.create(); if (folder) { toast.success(`Ordner „${folder.name}“ angelegt. Kampagnen kommen über „⋯“ → „In Ordner verschieben“ hinein – oder zieh sie mit der Maus auf den Ordner.`, { duration: 7000 }); onPick(folder.id); } }}><FolderPlus aria-hidden="true" /> Neuer Ordner</button>
      {plan.moves.length > 0 && <button type="button" className="cl-folder-act is-sort" disabled={tools.sorting} title={sortHint} onClick={() => { void tools.sortBySparte(allRows); }}><FolderTree aria-hidden="true" /> Nach Leadsparte einsortieren</button>}
    </div>
  </nav>;
}

/** Eintrag im „⋯“-Menü einer Kampagne: in einen Ordner legen, herausnehmen oder dafür einen neuen Ordner anlegen. */
export function MoveToFolderMenu({ tools, row }: { tools: FolderTools; row: FolderCampaign }) {
  const current = folderIdOf(row) && tools.known.has(folderIdOf(row)!) ? folderIdOf(row) : null;
  return <DropdownMenuSub>
    <DropdownMenuSubTrigger className="campaign-act-sub"><FolderInput /> In Ordner verschieben</DropdownMenuSubTrigger>
    <DropdownMenuPortal><DropdownMenuSubContent className="campaign-act-menu cl-folder-menu">
      {tools.folders.map((folder) => <DropdownMenuItem key={folder.id} disabled={folder.id === current} onSelect={() => { void tools.moveTo([row], folder); }}>{folder.id === current ? <Check /> : <Folder />} <span className="cl-folder-menu-name">{folder.name}</span></DropdownMenuItem>)}
      {tools.folders.length > 0 && <DropdownMenuSeparator />}
      {current !== null && <DropdownMenuItem onSelect={() => { void tools.moveTo([row], null); }}><FolderMinus /> Aus dem Ordner nehmen</DropdownMenuItem>}
      <DropdownMenuItem onSelect={async () => { const folder = await tools.create(); if (folder) await tools.moveTo([row], folder); }}><FolderPlus /> Neuer Ordner …</DropdownMenuItem>
    </DropdownMenuSubContent></DropdownMenuPortal>
  </DropdownMenuSub>;
}
