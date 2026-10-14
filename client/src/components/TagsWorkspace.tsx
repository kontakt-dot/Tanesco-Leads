import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { catPill, statusStyle, tint } from "@/lib/colors";
import { confirmAction, promptAction } from "@/lib/confirm";
import { trpc } from "@/lib/trpc";
import { Palette, Plus, Tag as TagIcon, Trash2, Type } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const TAG_PALETTE = ["#2dd4bf", "#22c55e", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#ec4899", "#0ea5e9", "#84cc16", "#f97316", "#64748b", "#111827"];
const stamp = (value: Date | string | null) => value ? new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "–";

/** Tags: anlegen (mit Farbe), Nutzung sehen (wie viele Leads, wann zuletzt, welche Status), umbenennen, umfärben, löschen. */
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
  const top = [...tags].sort((a, b) => b.usageCount - a.usageCount)[0];
  const submit = () => { if (name.trim().length < 1) return toast.error("Bitte einen Tag-Namen eingeben."); createTag.mutate({ name: name.trim(), color }); };
  return <>
    <header className="page-intro compact"><div><span className="eyebrow">LEAD-OPERATIONS</span><h1>Tags</h1><p>Tags sind kleine farbige Marker für Leads – zum Sortieren, Filtern und für Automatisierungen („Lead-Tag setzen“). Jeder Tag zeigt hier, wie oft er im Einsatz ist.</p></div></header>
    <div className="grid gap-3 md:grid-cols-3">
      <div className="metric-card"><span>Tags gesamt</span><strong>{overview.data ? tags.length : "…"}</strong><small>{overview.data ? `${tags.filter((tag) => tag.usageCount > 0).length} davon im Einsatz` : ""}</small></div>
      <div className="metric-card"><span>Leads mit Tag</span><strong>{overview.data ? overview.data.taggedLeads : "…"}</strong><small>{overview.data ? `von ${overview.data.totalLeads} Leads insgesamt` : ""}</small></div>
      <div className="metric-card"><span>Meistgenutzter Tag</span><strong className="flex items-center gap-2 text-xl">{top ? <><i className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: top.color }} />{top.name}</> : "–"}</strong><small>{top ? `${top.usageCount} Leads` : "noch keine Nutzung"}</small></div>
    </div>
    <section className="surface-panel mt-4 p-5">
      <span className="eyebrow">NEUER TAG</span>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Bezeichnung, z. B. Hot Lead" onKeyDown={(event) => { if (event.key === "Enter") submit(); }} />
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Tag-Farbe">{TAG_PALETTE.map((item) => <button key={item} type="button" role="radio" aria-checked={color === item} aria-label={`Farbe ${item}`} className={`h-7 w-7 rounded-full border-2 transition ${color === item ? "swatch-selected" : "border-transparent opacity-80 hover:opacity-100"}`} style={{ backgroundColor: item }} onClick={() => setColor(item)} />)}<label className="ml-1 grid h-7 w-7 cursor-pointer place-items-center rounded-full border border-white/20 text-slate-300" title="Eigene Farbe"><Palette className="h-3.5 w-3.5" /><input type="color" className="sr-only" value={color} onChange={(event) => setColor(event.target.value)} /></label></div>
        <Button className="flux-button" disabled={createTag.isPending} onClick={submit}><Plus /> Tag anlegen</Button>
      </div>
    </section>
    <section className="surface-panel mt-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-5 py-4"><div><span className="eyebrow">ALLE TAGS</span><p className="mt-1 text-xs text-slate-500">Nutzung = Leads mit diesem Tag · Zuletzt = letzte Änderung eines Leads mit dem Tag · Status zeigt, wo diese Leads stehen.</p></div><span className="text-xs text-slate-500">{tags.length} Tag{tags.length === 1 ? "" : "s"}</span></div>
      {overview.isLoading ? <p className="p-5 text-sm text-slate-400">Tags werden geladen …</p> : overview.error ? <p className="p-5 text-sm text-red-200">{overview.error.message}</p> : !tags.length ? <p className="p-5 text-sm text-slate-400">Noch keine Tags. Lege oben den ersten an – zum Beispiel „Hot Lead“, „Rückruf“ oder „Eigenheim“.</p> :
        <ul className="divide-y divide-white/6">{tags.map((tag) => { const statuses = Object.entries(tag.statusCounts).sort((a, b) => b[1] - a[1]); return <li key={tag.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
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
