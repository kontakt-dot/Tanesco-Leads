import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { catPill, statusStyle, tint } from "@/lib/colors";
import { confirmAction, promptAction } from "@/lib/confirm";
import { trpc } from "@/lib/trpc";
import ColorPalette, { COLOR_PALETTE } from "@/components/ColorPalette";
import { Palette, Plus, Tag as TagIcon, Trash2, Type, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const TAG_PALETTE = COLOR_PALETTE;
const stamp = (value: Date | string | null) => value ? new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "–";

/** Tags: anlegen (mit Farbe), Nutzung sehen (wie viele Leads, wann zuletzt, welche Status), umbenennen, umfärben, löschen – einzeln oder mehrere auf einmal (links anhaken). */
export default function TagsWorkspace() {
  const utils = trpc.useUtils();
  const overview = trpc.leadops.tagOverview.useQuery(undefined, { retry: false });
  const refresh = () => { utils.leadops.tagOverview.invalidate(); utils.leadops.listTags.invalidate(); };
  const onError = (error: { message: string }) => toast.error(error.message);
  const createTag = trpc.leadops.createTag.useMutation({ onSuccess: () => { refresh(); setName(""); toast.success("Tag angelegt."); }, onError });
  const updateTag = trpc.leadops.updateTag.useMutation({ onSuccess: () => { refresh(); toast.success("Tag gespeichert."); }, onError });
  const deleteTag = trpc.leadops.deleteTag.useMutation({ onSuccess: () => { refresh(); toast.success("Tag gelöscht."); }, onError });
  const [name, setName] = useState(""); const [color, setColor] = useState(TAG_PALETTE[0]);
  const tags = overview.data?.tags ?? [];
  const top = [...tags].filter((tag) => tag.usageCount > 0).sort((a, b) => b.usageCount - a.usageCount)[0]; // ein Tag ohne Leads ist nicht „meistgenutzt“
  // Auswahl für Sammelaktionen: links anhaken, „Alle auswählen“ im Kopf – gelöschte oder verschwundene Tags fallen von selbst heraus
  const [picked, setPicked] = useState<number[]>([]);
  const known = tags.map((tag) => tag.id).join(",");
  useEffect(() => { setPicked((current) => { const next = current.filter((id) => tags.some((tag) => tag.id === id)); return next.length === current.length ? current : next; }); }, [known]);
  const chosen = tags.filter((tag) => picked.includes(tag.id)); const allPicked = tags.length > 0 && chosen.length === tags.length;
  const toggle = (id: number) => setPicked((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const deleteTags = trpc.leadops.deleteTags.useMutation({ onSuccess: (result) => { refresh(); setPicked([]); toast.success(`${result.deleted} ${result.deleted === 1 ? "Tag" : "Tags"} gelöscht.`); }, onError });
  const removeChosen = async () => { const leads = chosen.reduce((sum, tag) => sum + tag.usageCount, 0); if (await confirmAction(`${chosen.length} ${chosen.length === 1 ? "Tag" : "Tags"} löschen?${leads ? ` Sie werden von den Leads entfernt (${leads} Zuordnungen).` : " Keiner davon hängt an einem Lead."} Das lässt sich nicht rückgängig machen.`, { danger: true })) deleteTags.mutate({ ids: chosen.map((tag) => tag.id) }); };
  const submit = () => { if (name.trim().length < 1) return toast.error("Bitte einen Tag-Namen eingeben."); createTag.mutate({ name: name.trim(), color }); };
  return <>
    <header className="page-intro compact"><div><span className="eyebrow">LEAD-OPERATIONS</span><h1>Tags</h1><p>Tags sind kleine farbige Marker für Leads – zum Sortieren, Filtern und für Automatisierungen („Lead-Tag setzen“). Jeder Tag zeigt hier, wie oft er im Einsatz ist.</p></div></header>
    <div className="grid gap-3 md:grid-cols-3">
      <div className="metric-card"><span>Tags gesamt</span><strong>{overview.data ? tags.length : "…"}</strong><small>{overview.data ? `${tags.filter((tag) => tag.usageCount > 0).length} davon im Einsatz` : ""}</small></div>
      <div className="metric-card"><span>Leads mit Tag</span><strong>{overview.data ? overview.data.taggedLeads : "…"}</strong><small>{overview.data ? `von ${overview.data.totalLeads} Leads insgesamt` : ""}</small></div>
      <div className="metric-card"><span>Meistgenutzter Tag</span><strong className="text-xl">{top ? <span className="tag-top"><i style={{ backgroundColor: top.color }} aria-hidden="true" /><span>{top.name}</span></span> : "–"}</strong><small>{top ? `${top.usageCount} Leads` : "noch keine Nutzung"}</small></div>
    </div>
    <section className="surface-panel mt-4 p-5">
      <span className="eyebrow">NEUER TAG</span>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Bezeichnung, z. B. Hot Lead" onKeyDown={(event) => { if (event.key === "Enter") submit(); }} />
        <ColorPalette value={color} onChange={setColor} label="Tag-Farbe" />
        <Button className="flux-button" disabled={createTag.isPending} onClick={submit}><Plus /> Tag anlegen</Button>
      </div>
    </section>
    <section className="surface-panel mt-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-5 py-4"><div><span className="eyebrow">ALLE TAGS</span><p className="mt-1 text-xs text-slate-500">Nutzung = Leads mit diesem Tag · Zuletzt = letzte Änderung eines Leads mit dem Tag · Status zeigt, wo diese Leads stehen.</p></div><span className="text-xs text-slate-500">{tags.length} Tag{tags.length === 1 ? "" : "s"}</span></div>
      {tags.length > 0 && <div className={`tag-bulk ${chosen.length ? "is-on" : ""}`} role="toolbar" aria-label="Mehrere Tags bearbeiten">
        <label className="tag-bulk-all"><input type="checkbox" className="tag-check" checked={allPicked} ref={(node) => { if (node) node.indeterminate = chosen.length > 0 && !allPicked; }} onChange={() => setPicked(allPicked ? [] : tags.map((tag) => tag.id))} /> {allPicked ? "Alle abwählen" : "Alle auswählen"}</label>
        {chosen.length > 0 ? <><span className="tag-bulk-count" aria-live="polite">{chosen.length} von {tags.length} ausgewählt</span><span className="tag-bulk-tools"><Button size="sm" variant="ghost" onClick={() => setPicked([])}><X /> Auswahl aufheben</Button><Button size="sm" variant="outline" className="tag-bulk-delete" disabled={deleteTags.isPending} onClick={() => void removeChosen()}><Trash2 /> {deleteTags.isPending ? "Löscht …" : `${chosen.length} löschen`}</Button></span></> : <span className="tag-bulk-hint">Links anhaken, um mehrere Tags auf einmal zu löschen.</span>}
      </div>}
      {overview.isLoading ? <p className="p-5 text-sm text-slate-400">Tags werden geladen …</p> : overview.error ? <p className="p-5 text-sm text-red-200">{overview.error.message}</p> : !tags.length ? <p className="p-5 text-sm text-slate-400">Noch keine Tags. Lege oben den ersten an – zum Beispiel „Hot Lead“, „Rückruf“ oder „Eigenheim“.</p> :
        <ul className="divide-y divide-white/6">{tags.map((tag) => { const statuses = Object.entries(tag.statusCounts).sort((a, b) => b[1] - a[1]); return <li key={tag.id} className={`tag-row flex flex-wrap items-center gap-4 px-5 py-3.5 ${picked.includes(tag.id) ? "is-picked" : ""}`}>
          <input type="checkbox" className="tag-check" aria-label={`Tag ${tag.name} auswählen`} checked={picked.includes(tag.id)} onChange={() => toggle(tag.id)} />
          <span className="flex min-w-[200px] items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg" style={{ backgroundColor: tint(tag.color, 0.16), color: tag.color }}><TagIcon className="h-4 w-4" /></span><span><strong className="block text-sm text-slate-100">{tag.name}</strong><span className="text-xs text-slate-500">seit {stamp(tag.createdAt)}</span></span></span>
          <span className="w-24"><strong className="block text-lg leading-none text-slate-100">{tag.usageCount}</strong><span className="text-[11px] text-slate-500">Leads</span></span>
          <span className="w-24"><strong className="block text-sm text-slate-100">{stamp(tag.lastUsedAt)}</strong><span className="text-[11px] text-slate-500">zuletzt</span></span>
          <span className="flex min-w-[220px] flex-1 flex-wrap items-center gap-1.5">{statuses.length ? statuses.map(([status, count]) => { const style = statusStyle(status); return <Badge key={status} variant="outline" className="cat-strong" style={catPill(style.color)}>{style.label} {count}</Badge>; }) : <span className="text-xs text-slate-500">noch keinem Lead zugeordnet</span>}{tag.samples.length > 0 && <span className="text-[11px] text-slate-500">· z. B. {tag.samples.map((sample) => <a key={sample.publicId} className="underline-offset-2 hover:underline" href={`/?page=Leads&lead=${encodeURIComponent(sample.publicId)}`}>{sample.name}</a>).reduce<React.ReactNode[]>((acc, node, index) => index ? [...acc, ", ", node] : [node], [])}</span>}</span>
          <span className="flex items-center gap-1">
            <label className="grid h-8 w-8 cursor-pointer place-items-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100" title="Farbe ändern"><Palette className="h-4 w-4" /><input type="color" className="sr-only" value={tag.color} onChange={(event) => updateTag.mutate({ id: tag.id, color: event.target.value })} /></label>
            <Button size="icon" variant="ghost" aria-label={`Tag ${tag.name} umbenennen`} title="Umbenennen" onClick={async () => { const next = await promptAction("Neuer Name für den Tag:", tag.name); if (next?.trim() && next.trim() !== tag.name) updateTag.mutate({ id: tag.id, name: next.trim() }); }}><Type className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" aria-label={`Tag ${tag.name} löschen`} title="Löschen" onClick={async () => { if (await confirmAction(`Tag „${tag.name}“ löschen? Er wird von ${tag.usageCount} Lead${tag.usageCount === 1 ? "" : "s"} entfernt.`)) deleteTag.mutate({ id: tag.id }); }}><Trash2 className="h-4 w-4" /></Button>
          </span>
        </li>; })}</ul>}
    </section>
    <section className="mt-4 grid gap-3 md:grid-cols-3">
      <div className="surface-panel p-4"><span className="eyebrow">SO SETZT DU TAGS</span><p className="mt-2 text-sm text-slate-400">Auf der Lead-Seite oder im Quick View unter „Tags“ anklicken – sofort gespeichert.</p></div>
      <div className="surface-panel p-4"><span className="eyebrow">AUTOMATISCH VERGEBEN</span><p className="mt-2 text-sm text-slate-400">In der Automatisierung die Aktion „Lead-Tag setzen“ wählen, z. B. „Hot Lead“ bei Speicherwunsch = Ja.</p></div>
      <div className="surface-panel p-4"><span className="eyebrow">FILTERN</span><p className="mt-2 text-sm text-slate-400">In der Lead-Liste über „Filter“ nach Tags eingrenzen und die Ansicht mit „Filter speichern“ merken.</p></div>
    </section>
  </>;
}
