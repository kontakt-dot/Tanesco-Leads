import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { catPill, statusStyle } from "@/lib/colors";
import { confirmAction, promptAction } from "@/lib/confirm";
import { trpc } from "@/lib/trpc";
import ColorPalette, { COLOR_PALETTE } from "@/components/ColorPalette";
import { CircleDashed, Palette, Plus, Tag as TagIcon, Trash2, Trophy, Type, Users, X } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
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
  const maxUse = Math.max(1, ...tags.map((tag) => tag.usageCount)); const idle = tags.filter((tag) => tag.usageCount === 0).length; const shareTagged = overview.data && overview.data.totalLeads ? Math.round((overview.data.taggedLeads / overview.data.totalLeads) * 100) : 0;
  return <div className="fx-scope tg">
    <header className="page-intro compact"><div><span className="eyebrow">LEAD-OPERATIONS</span><h1>Tags</h1><p>Tags sind kleine farbige Marker für Leads – zum Sortieren, Filtern und für Automatisierungen („Lead-Tag setzen“). Jeder Tag zeigt hier, wie oft er im Einsatz ist.</p></div></header>
    <section className="tg-rail" aria-label="Tags auf einen Blick">
      <div className="tg-stat"><span><TagIcon aria-hidden="true" /> Tags gesamt</span><strong>{overview.data ? tags.length : "…"}</strong><small>{overview.data ? `${tags.length - idle} davon im Einsatz` : ""}</small></div>
      <div className="tg-stat"><span><Users aria-hidden="true" /> Leads mit Tag</span><strong>{overview.data ? overview.data.taggedLeads : "…"}{overview.data && overview.data.totalLeads > 0 && <em>{shareTagged} %</em>}</strong>{overview.data && <span className="tg-meter" aria-hidden="true"><i style={{ width: `${shareTagged}%` }} /></span>}<small>{overview.data ? `von ${overview.data.totalLeads} Leads insgesamt` : ""}</small></div>
      <div className="tg-stat"><span><Trophy aria-hidden="true" /> Meistgenutzter Tag</span><strong className="text-xl">{top ? <span className="tag-top"><i style={{ backgroundColor: top.color }} aria-hidden="true" /><span>{top.name}</span></span> : "–"}</strong><small>{top ? `${top.usageCount} Leads` : "noch keine Nutzung"}</small></div>
      <div className="tg-stat"><span><CircleDashed aria-hidden="true" /> Ohne Leads</span><strong>{overview.data ? idle : "…"}</strong><small>{!overview.data ? "" : idle ? "an keinem Lead – aufräumen oder vergeben" : "jeder Tag ist im Einsatz"}</small></div>
    </section>
    <section className="tg-new" aria-label="Neuer Tag">
      <div className="tg-new-head"><span className="eyebrow">NEUER TAG</span><span className="tg-chip tg-preview" style={{ "--tag": color } as CSSProperties} aria-label="Vorschau"><i aria-hidden="true" />{name.trim() || "So sieht der Tag aus"}</span></div>
      <div className="tg-new-row">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Bezeichnung, z. B. Hot Lead" onKeyDown={(event) => { if (event.key === "Enter") submit(); }} />
        <ColorPalette value={color} onChange={setColor} label="Tag-Farbe" />
        <Button className="flux-button" disabled={createTag.isPending} onClick={submit}><Plus /> Tag anlegen</Button>
      </div>
    </section>
    <section className="tg-list" aria-label="Alle Tags">
      <div className="tg-list-head"><div><h2>Alle Tags</h2><p>Nutzung = Leads mit diesem Tag · Zuletzt = letzte Änderung eines Leads mit dem Tag · Status zeigt, wo diese Leads stehen.</p></div><span className="tg-count">{tags.length} Tag{tags.length === 1 ? "" : "s"}</span></div>
      {tags.length > 0 && <div className={`tag-bulk ${chosen.length ? "is-on" : ""}`} role="toolbar" aria-label="Mehrere Tags bearbeiten">
        <label className="tag-bulk-all"><input type="checkbox" className="tag-check" checked={allPicked} ref={(node) => { if (node) node.indeterminate = chosen.length > 0 && !allPicked; }} onChange={() => setPicked(allPicked ? [] : tags.map((tag) => tag.id))} /> {allPicked ? "Alle abwählen" : "Alle auswählen"}</label>
        {chosen.length > 0 ? <><span className="tag-bulk-count" aria-live="polite">{chosen.length} von {tags.length} ausgewählt</span><span className="tag-bulk-tools"><Button size="sm" variant="ghost" onClick={() => setPicked([])}><X /> Auswahl aufheben</Button><Button size="sm" variant="outline" className="tag-bulk-delete" disabled={deleteTags.isPending} onClick={() => void removeChosen()}><Trash2 /> {deleteTags.isPending ? "Löscht …" : `${chosen.length} löschen`}</Button></span></> : <span className="tag-bulk-hint">Links anhaken, um mehrere Tags auf einmal zu löschen.</span>}
      </div>}
      {overview.isLoading ? <p className="tg-note">Tags werden geladen …</p> : overview.error ? <p className="tg-note is-bad">{overview.error.message}</p> : !tags.length ? <div className="tg-empty"><span className="tg-chip" style={{ "--tag": "#f97316" } as CSSProperties}><i aria-hidden="true" />Hot Lead</span><span className="tg-chip" style={{ "--tag": "#22c55e" } as CSSProperties}><i aria-hidden="true" />Rückruf</span><span className="tg-chip" style={{ "--tag": "#3b82f6" } as CSSProperties}><i aria-hidden="true" />Eigenheim</span><p>Noch keine Tags. Lege oben den ersten an – zum Beispiel „Hot Lead“, „Rückruf“ oder „Eigenheim“.</p></div> :
        <ul className="tg-rows">{tags.map((tag) => { const statuses = Object.entries(tag.statusCounts).sort((a, b) => b[1] - a[1]); return <li key={tag.id} className={`tag-row tg-row ${picked.includes(tag.id) ? "is-picked" : ""} ${tag.usageCount ? "" : "is-idle"}`} style={{ "--tag": tag.color } as CSSProperties}>
          <input type="checkbox" className="tag-check" aria-label={`Tag ${tag.name} auswählen`} checked={picked.includes(tag.id)} onChange={() => toggle(tag.id)} />
          <span className="tg-name"><span className="tg-chip"><i aria-hidden="true" /><strong>{tag.name}</strong></span><small>seit {stamp(tag.createdAt)}</small></span>
          <span className="tg-use"><b>{tag.usageCount}</b><small>{tag.usageCount === 1 ? "Lead" : "Leads"}</small><span className="tg-meter" aria-hidden="true"><i style={{ width: `${tag.usageCount ? Math.max(4, (tag.usageCount / maxUse) * 100) : 0}%` }} /></span></span>
          <span className="tg-last"><b>{stamp(tag.lastUsedAt)}</b><small>zuletzt</small></span>
          <span className="tg-status">{statuses.length ? <><span className="tg-split" aria-hidden="true">{statuses.map(([status, count]) => <i key={status} style={{ flexGrow: count, background: statusStyle(status).color }} />)}</span><span className="tg-badges">{statuses.map(([status, count]) => { const style = statusStyle(status); return <Badge key={status} variant="outline" className="cat-strong" style={catPill(style.color)}>{style.label} {count}</Badge>; })}</span></> : <span className="tg-none">noch keinem Lead zugeordnet</span>}{tag.samples.length > 0 && <span className="tg-samples">z. B. {tag.samples.map((sample) => <a key={sample.publicId} href={`/?page=Leads&lead=${encodeURIComponent(sample.publicId)}`}>{sample.name}</a>).reduce<React.ReactNode[]>((acc, node, index) => index ? [...acc, ", ", node] : [node], [])}</span>}</span>
          <span className="tg-actions">
            <label title="Farbe ändern"><Palette className="h-4 w-4" /><input type="color" className="sr-only" value={tag.color} onChange={(event) => updateTag.mutate({ id: tag.id, color: event.target.value })} /></label>
            <Button size="icon" variant="ghost" aria-label={`Tag ${tag.name} umbenennen`} title="Umbenennen" onClick={async () => { const next = await promptAction("Neuer Name für den Tag:", tag.name); if (next?.trim() && next.trim() !== tag.name) updateTag.mutate({ id: tag.id, name: next.trim() }); }}><Type className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" aria-label={`Tag ${tag.name} löschen`} title="Löschen" onClick={async () => { if (await confirmAction(`Tag „${tag.name}“ löschen? Er wird von ${tag.usageCount} Lead${tag.usageCount === 1 ? "" : "s"} entfernt.`)) deleteTag.mutate({ id: tag.id }); }}><Trash2 className="h-4 w-4" /></Button>
          </span>
        </li>; })}</ul>}
    </section>
    <ol className="tg-how">
      <li><em>1</em><div><b>Von Hand setzen</b><p>Auf der Lead-Seite oder im Quick View unter „Tags“ anklicken – sofort gespeichert.</p></div></li>
      <li><em>2</em><div><b>Automatisch vergeben</b><p>In der Automatisierung die Aktion „Lead-Tag setzen“ wählen, z. B. „Hot Lead“ bei Speicherwunsch = Ja.</p></div></li>
      <li><em>3</em><div><b>Danach filtern</b><p>In der Lead-Liste über „Filter“ nach Tags eingrenzen und die Ansicht mit „Filter speichern“ merken.</p></div></li>
    </ol>
  </div>;
}
