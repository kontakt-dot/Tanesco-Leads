import map from "@/data/germany-map.json";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { confirmAction } from "@/lib/confirm";
import { loadPlzGeo, PLZ_ATTRIBUTION, type PlzGeo } from "@/lib/plz-geo";
import { trpc } from "@/lib/trpc";
import { Download, Layers, MapPinned, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { describePostcodes, groupOverlapsByRegion, overlapsCsv, parsePostcodeText, TERRITORY_COLORS, type OverlapCustomer, type OverlapGroup, type ParsedPostcodes } from "../../../shared/territories";

/**
 * Gebietskarte: Deutschlandkarte wie im Dashboard, darauf die Einsatzgebiete der Kunden als farbige PLZ-Punkte.
 * PLZ-Listen mit Kundenname und Sparte hochladen (Datei oder Einfügen), Filter nach Sparte und Kunde, und das Wichtigste:
 * Überschneidungen – welche PLZ bei mehreren Kunden derselben Sparte liegen, wie oft und genau wo. Dort lässt sich ein
 * Lead mehrfach verkaufen.
 */
type TerritoryRow = { id: number; customerName: string; categoryId: number | null; categoryName: string | null; color: string; postcodes: string[]; rawCount: number; note: string | null; sourceName: string | null; createdBy: string | null; createdAt: string | Date; updatedAt: string | Date };
const stamp = (value: string | Date) => new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });

export default function TerritoryMap() {
  const territories = trpc.leadops.listTerritories.useQuery(undefined, { retry: false });
  const overlaps = trpc.leadops.territoryOverlaps.useQuery(undefined, { retry: false });
  const categories = trpc.leadops.listCategories.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const refresh = () => { utils.leadops.listTerritories.invalidate(); utils.leadops.territoryOverlaps.invalidate(); };
  const [geo, setGeo] = useState<PlzGeo | null>(null); const [geoError, setGeoError] = useState<string | null>(null);
  useEffect(() => { loadPlzGeo().then(setGeo).catch(() => setGeoError("Die PLZ-Koordinaten konnten nicht geladen werden.")); }, []);
  const [categoryFilter, setCategoryFilter] = useState<number | "alle">("alle");
  const [hidden, setHidden] = useState<Set<number>>(() => new Set());
  const [focus, setFocus] = useState<number | null>(null);
  const [onlyOverlaps, setOnlyOverlaps] = useState(false);
  const [hover, setHover] = useState<{ plz: string; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; edit: TerritoryRow | null }>({ open: false, edit: null });
  const [openRegion, setOpenRegion] = useState<string | null>(null);
  const remove = trpc.leadops.deleteTerritory.useMutation({ onSuccess: (result) => { toast.success(`Gebiet von „${result.customerName}“ gelöscht.`); refresh(); }, onError: (error) => toast.error(error.message) });

  const rows = (territories.data ?? []) as TerritoryRow[];
  const usedCategories = useMemo(() => { const ids = new Set(rows.map((row) => row.categoryId ?? 0)); return (categories.data ?? []).filter((category) => ids.has(category.id)).map((category) => ({ id: category.id, name: category.name })).concat(ids.has(0) ? [{ id: 0, name: "Ohne Sparte" }] : []); }, [rows, categories.data]);
  const visible = rows.filter((row) => !hidden.has(row.id) && (categoryFilter === "alle" || (row.categoryId ?? 0) === categoryFilter));
  const placeOf = (plz: string) => geo?.entries.get(plz)?.place ?? null;
  // Punkte: je PLZ die sichtbaren Kunden (innerhalb derselben Sparte zählt die Überschneidung)
  const points = useMemo(() => {
    if (!geo) return [] as Array<{ plz: string; x: number; y: number; customers: Array<{ id: number; name: string; color: string; categoryId: number | null }>; overlap: number }>;
    const byPlz = new Map<string, Array<{ id: number; name: string; color: string; categoryId: number | null }>>();
    for (const row of visible) for (const plz of row.postcodes) { const list = byPlz.get(plz) ?? []; list.push({ id: row.id, name: row.customerName, color: row.color, categoryId: row.categoryId }); byPlz.set(plz, list); }
    const out: Array<{ plz: string; x: number; y: number; customers: Array<{ id: number; name: string; color: string; categoryId: number | null }>; overlap: number }> = [];
    for (const [plz, customers] of Array.from(byPlz.entries())) { const entry = geo.entries.get(plz); if (!entry) continue; const { x, y } = geo.project(entry.lng, entry.lat); const perCategory = new Map<number, number>(); for (const customer of customers) perCategory.set(customer.categoryId ?? 0, (perCategory.get(customer.categoryId ?? 0) ?? 0) + 1); const overlap = Math.max(0, ...Array.from(perCategory.values())); out.push({ plz, x, y, customers, overlap }); }
    return out.sort((a, b) => a.overlap - b.overlap); // Überschneidungen zuletzt zeichnen = oben
  }, [geo, visible]);
  const shown = onlyOverlaps ? points.filter((point) => point.overlap >= 2) : points;
  const overlapGroups: OverlapGroup[] = (overlaps.data?.groups ?? []).filter((group) => categoryFilter === "alle" || (group.categoryId ?? 0) === categoryFilter);
  const totalOverlap = overlapGroups.reduce((sum, group) => sum + group.overlapPlz, 0);
  const maxCustomers = overlapGroups.reduce((max, group) => Math.max(max, group.maxCustomers), 0);
  const covered = new Set(visible.flatMap((row) => row.postcodes)).size;
  const hovered = hover ? points.find((point) => point.plz === hover.plz) : null;
  const exportCsv = () => { const csv = overlapsCsv(overlapGroups, placeOf); const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `Ueberschneidungen_${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url); };

  return <>
    <header className="page-intro compact"><div><span className="eyebrow">LEAD-OPERATIONS</span><h1>Gebietskarte</h1><p>Wo haben wir welche Kunden, wo ist ihr Einsatzgebiet, welche Sparte – und wo überschneiden sich die Gebiete? In diesen PLZ lässt sich ein Lead mehrfach verkaufen.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!totalOverlap} onClick={exportCsv} title="Alle Überschneidungen als CSV (Excel)"><Download /> Überschneidungen als CSV</Button><Button className="flux-button" size="sm" onClick={() => setDialog({ open: true, edit: null })}><Upload /> PLZ-Liste hochladen</Button></div></header>
    <div className="metric-grid territory-kpis">
      <div className="metric-card"><span className="eyebrow">KUNDEN</span><strong>{overlaps.data?.customers ?? rows.length}</strong><small>{rows.length} {rows.length === 1 ? "Gebiet" : "Gebiete"} in {overlaps.data?.categories ?? usedCategories.length} {(overlaps.data?.categories ?? usedCategories.length) === 1 ? "Sparte" : "Sparten"}</small></div>
      <div className="metric-card"><span className="eyebrow">ABGEDECKTE PLZ</span><strong>{covered.toLocaleString("de-DE")}</strong><small>von {geo ? geo.universe.size.toLocaleString("de-DE") : "…"} PLZ in Deutschland{categoryFilter !== "alle" || hidden.size ? " (gefiltert)" : ""}</small></div>
      <div className="metric-card is-accent"><span className="eyebrow">ÜBERSCHNEIDUNGEN</span><strong>{totalOverlap.toLocaleString("de-DE")} PLZ</strong><small>{totalOverlap ? `bis zu ${maxCustomers} Kunden in derselben PLZ und Sparte` : "noch keine PLZ bei mehreren Kunden"}</small></div>
      <div className="metric-card"><span className="eyebrow">MEHRFACH VERKAUFEN</span><strong>{overlapGroups.reduce((sum, group) => sum + group.items.filter((item) => item.count >= 3).length, 0).toLocaleString("de-DE")} PLZ</strong><small>mit drei oder mehr Kunden</small></div>
    </div>
    <section className="surface-panel dashboard-filters territory-filters">
      <div className="dashboard-filter-group"><span className="eyebrow">SPARTE</span><div className="dashboard-segments"><button type="button" className={categoryFilter === "alle" ? "active" : ""} onClick={() => setCategoryFilter("alle")}>Alle</button>{usedCategories.map((category) => <button key={category.id} type="button" className={categoryFilter === category.id ? "active" : ""} onClick={() => setCategoryFilter(category.id)}>{category.name}</button>)}</div></div>
      <div className="dashboard-filter-group"><span className="eyebrow">KUNDEN</span><div className="territory-chips">{rows.map((row) => <button key={row.id} type="button" className={`territory-chip ${hidden.has(row.id) ? "is-off" : ""} ${focus === row.id ? "is-focus" : ""}`} style={{ ["--c" as string]: row.color }} title={hidden.has(row.id) ? "Einblenden" : "Ausblenden"} onClick={() => setHidden((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; })}><i /> {row.customerName}{row.categoryName ? <small>{row.categoryName}</small> : null}</button>)}{!rows.length && <span className="text-xs text-slate-500">Noch kein Gebiet – lade die erste PLZ-Liste hoch.</span>}</div></div>
      <label className="territory-toggle"><Switch checked={onlyOverlaps} onCheckedChange={setOnlyOverlaps} aria-label="Nur Überschneidungen zeigen" /> Nur Überschneidungen zeigen</label>
    </section>
    <div className="lead-map-grid territory-grid">
      <section className="surface-panel operations-panel territory-map-panel p-4">
        <div className="lead-map-canvas territory-canvas" onMouseLeave={() => setHover(null)}>
          <svg viewBox={map.viewBox.join(" ")} role="img" aria-label="Deutschlandkarte mit Einsatzgebieten" className="lead-map-svg territory-svg">
            {map.states.map((state) => <path key={state.id} d={state.d} className="territory-state" />)}
            {map.states.map((state) => <text key={`${state.id}-label`} x={state.cx} y={state.cy} className="lead-map-state-label">{state.id}</text>)}
            {shown.map((point) => { const dim = focus !== null && !point.customers.some((customer) => customer.id === focus); const fill = point.overlap >= 3 ? "#e11d48" : point.overlap === 2 ? "#f59e0b" : point.customers[0]?.color ?? "#8278ff"; return <circle key={point.plz} cx={point.x} cy={point.y} r={point.overlap >= 2 ? 3.1 : 2.1} fill={fill} className={`territory-dot ${point.overlap >= 2 ? "is-overlap" : ""} ${dim ? "is-dim" : ""}`} onMouseEnter={() => setHover({ plz: point.plz, x: point.x, y: point.y })} />; })}
          </svg>
          {hovered && <div className="territory-tooltip" style={{ left: `${(hover!.x / map.viewBox[2]) * 100}%`, top: `${(hover!.y / map.viewBox[3]) * 100}%` }}><strong>{hovered.plz} {placeOf(hovered.plz) ?? ""}</strong>{hovered.customers.map((customer) => <span key={customer.id}><i style={{ background: customer.color }} /> {customer.name}</span>)}{hovered.overlap >= 2 && <em>{hovered.overlap} Kunden in derselben Sparte – Lead mehrfach verkaufbar</em>}</div>}
          {!geo && !geoError && <p className="text-xs text-slate-500">Karte wird geladen …</p>}{geoError && <p className="text-xs text-red-300">{geoError}</p>}
          {geo && !shown.length && <p className="territory-empty">{onlyOverlaps ? "Keine Überschneidungen im aktuellen Filter." : rows.length ? "Alle Kunden ausgeblendet – oben wieder einblenden." : "Noch keine Gebiete – „PLZ-Liste hochladen“ klicken."}</p>}
        </div>
        <div className="territory-legend"><span><i style={{ background: "#8278ff" }} /> ein Kunde (Farbe des Kunden)</span><span><i style={{ background: "#f59e0b" }} /> 2 Kunden in der PLZ</span><span><i style={{ background: "#e11d48" }} /> 3 oder mehr Kunden</span><small>{PLZ_ATTRIBUTION}</small></div>
      </section>
      <aside className="lead-map-side territory-side">
        <section className="surface-panel operations-panel p-4"><div className="flex items-start justify-between gap-2"><div><span className="eyebrow">KUNDEN & GEBIETE</span><p className="mt-1 text-xs text-slate-500">Klick auf einen Kunden hebt sein Gebiet hervor.</p></div><Button size="sm" variant="outline" onClick={() => setDialog({ open: true, edit: null })}><Plus /> Neu</Button></div>
          {territories.isLoading ? <p className="mt-3 text-xs text-slate-500">Lädt …</p> : !rows.length ? <p className="mt-3 text-xs text-slate-500">Noch kein Gebiet angelegt.</p> : <ul className="territory-list mt-3">{rows.filter((row) => categoryFilter === "alle" || (row.categoryId ?? 0) === categoryFilter).map((row) => <li key={row.id} className={`${focus === row.id ? "is-focus" : ""} ${hidden.has(row.id) ? "is-off" : ""}`}>
            <button type="button" className="territory-list-main" onClick={() => setFocus(focus === row.id ? null : row.id)}><i style={{ background: row.color }} /><span><strong>{row.customerName}</strong><small>{row.categoryName ?? "Ohne Sparte"} · {geo ? describePostcodes(row.postcodes, placeOf) : `${row.postcodes.length} PLZ`}</small>{row.note && <small className="territory-note">{row.note}</small>}<small className="territory-meta">{row.sourceName ? `${row.sourceName} · ` : ""}{stamp(row.updatedAt)}{row.createdBy ? ` · ${row.createdBy.split(" ")[0]}` : ""}</small></span></button>
            <span className="territory-list-actions"><button type="button" title="Gebiet bearbeiten" onClick={() => setDialog({ open: true, edit: row })}><Pencil className="h-3.5 w-3.5" /></button><button type="button" title="Gebiet löschen" disabled={remove.isPending} onClick={async () => { if (await confirmAction(`Gebiet von „${row.customerName}“ (${row.postcodes.length} PLZ) löschen?`, { danger: true })) remove.mutate({ id: row.id }); }}><Trash2 className="h-3.5 w-3.5" /></button></span>
          </li>)}</ul>}
        </section>
        <section className="surface-panel operations-panel p-4"><span className="eyebrow">ÜBERSCHNEIDUNGEN – WO GENAU</span><p className="mt-1 text-xs text-slate-500">PLZ, die bei zwei oder mehr Kunden derselben Sparte liegen – nach Region gebündelt, die größten zuerst. Klick auf eine Region zeigt alle PLZ.</p>
          {overlaps.isLoading ? <p className="mt-3 text-xs text-slate-500">Rechnet …</p> : !overlapGroups.some((group) => group.overlapPlz) ? <p className="mt-3 text-xs text-slate-500">Keine Überschneidungen{categoryFilter !== "alle" ? " in dieser Sparte" : ""}. Sobald zwei Kunden derselben Sparte dieselbe PLZ haben, erscheint sie hier.</p>
            : overlapGroups.filter((group) => group.overlapPlz).map((group) => { const regions = groupOverlapsByRegion(group.items, placeOf); return <div key={group.categoryId ?? 0} className="territory-group">
              <div className="territory-group-head"><strong><Layers className="h-3.5 w-3.5" aria-hidden="true" /> {group.categoryName}</strong><span>{group.overlapPlz.toLocaleString("de-DE")} PLZ · bis zu {group.maxCustomers} Kunden</span></div>
              {group.pairs.length > 0 && <div className="territory-pairs">{group.pairs.slice(0, 6).map((pair) => <span key={`${pair.a.id}-${pair.b.id}`} title="Gemeinsame PLZ dieser beiden Kunden"><i style={{ background: pair.a.color }} />{pair.a.customerName} + <i style={{ background: pair.b.color }} />{pair.b.customerName}: <b>{pair.shared.toLocaleString("de-DE")}</b> PLZ</span>)}</div>}
              <table className="territory-table"><thead><tr><th>Region</th><th className="num">PLZ</th><th className="num">Kunden</th><th>Wer</th></tr></thead><tbody>{regions.map((region) => { const key = `${group.categoryId ?? 0}-${region.region}`; const open = openRegion === key; return [
                <tr key={key} className={open ? "is-open" : ""} onClick={() => setOpenRegion(open ? null : key)}><td><strong>{region.region}xxx</strong><small>{region.places.join(", ")}{region.places.length >= 6 ? " …" : ""}</small></td><td className="num">{region.plzCount}</td><td className="num"><b className={region.maxCustomers >= 3 ? "is-hot" : ""}>{region.maxCustomers}</b></td><td><span className="territory-who">{region.customers.map((customer: OverlapCustomer) => <i key={customer.id} style={{ background: customer.color }} title={customer.customerName} />)}</span></td></tr>,
                open ? <tr key={`${key}-plz`} className="territory-plz-row"><td colSpan={4}><div className="territory-plz-list">{region.postcodes.map((plz) => { const item = group.items.find((entry) => entry.plz === plz); return <span key={plz} className={item && item.count >= 3 ? "is-hot" : ""} title={`${placeOf(plz) ?? ""} · ${item?.customers.map((customer) => customer.customerName).join(" + ") ?? ""}`}>{plz}<small>{item?.count}×</small></span>; })}</div></td></tr> : null,
              ]; })}</tbody></table>
            </div>; })}
        </section>
      </aside>
    </div>
    {dialog.open && <TerritoryDialog edit={dialog.edit} geo={geo} categories={(categories.data ?? []).map((category) => ({ id: category.id, name: category.name }))} existingNames={Array.from(new Set(rows.map((row) => row.customerName)))} colorsInUse={rows.map((row) => row.color)} onClose={() => setDialog({ open: false, edit: null })} onSaved={() => { setDialog({ open: false, edit: null }); refresh(); }} />}
  </>;
}

/** PLZ-Liste hochladen oder ein Gebiet bearbeiten: Kundenname, Sparte, Farbe, Datei oder eingefügter Text, Vorschau. */
function TerritoryDialog({ edit, geo, categories, existingNames, colorsInUse, onClose, onSaved }: { edit: TerritoryRow | null; geo: PlzGeo | null; categories: Array<{ id: number; name: string }>; existingNames: string[]; colorsInUse: string[]; onClose: () => void; onSaved: () => void }) {
  const [customerName, setCustomerName] = useState(edit?.customerName ?? "");
  const [categoryId, setCategoryId] = useState<string>(edit?.categoryId ? String(edit.categoryId) : "");
  const [color, setColor] = useState<string>(edit?.color ?? (TERRITORY_COLORS.find((candidate) => !colorsInUse.includes(candidate)) ?? TERRITORY_COLORS[0]));
  const [text, setText] = useState(edit ? edit.postcodes.join("\n") : "");
  const [note, setNote] = useState(edit?.note ?? ""); const [sourceName, setSourceName] = useState(edit?.sourceName ?? "");
  const [fileNote, setFileNote] = useState<string | null>(null);
  const save = trpc.leadops.saveTerritory.useMutation({ onSuccess: (result) => { toast.success(`Gebiet ${result.created ? "angelegt" : "aktualisiert"}: ${result.postcodes.toLocaleString("de-DE")} PLZ.`); onSaved(); }, onError: (error) => toast.error(error.message) });
  const parsed: ParsedPostcodes | null = useMemo(() => geo && text.trim() ? parsePostcodeText(text, geo.universe) : null, [geo, text]);
  const readFile = async (file: File) => {
    try {
      if (/\.xlsx?$/i.test(file.name)) { const XLSX = await import("xlsx"); const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" }); const sheet = workbook.Sheets[workbook.SheetNames[0]]; const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ";" }); setText(csv); }
      else setText(await file.text());
      setSourceName(file.name); setFileNote(`Datei „${file.name}“ gelesen – unten die erkannten PLZ prüfen.`);
    } catch { toast.error("Die Datei konnte nicht gelesen werden – bitte als CSV/TXT speichern oder die PLZ einfügen."); }
  };
  const canSave = customerName.trim().length >= 2 && Boolean(parsed?.postcodes.length) && !save.isPending;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="territory-dialog">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><MapPinned className="h-5 w-5" aria-hidden="true" /> {edit ? `Gebiet von „${edit.customerName}“ bearbeiten` : "PLZ-Liste hochladen"}</DialogTitle><DialogDescription>Kunde, Sparte und seine PLZ. Erlaubt sind 5-stellige PLZ, Vorwahl-Bereiche wie „60“ (alle 60xxx) oder „601“ und Bereiche wie „60000-60599“ – getrennt durch Zeilen, Kommas oder Leerzeichen. Eine Datei (CSV, TXT, Excel) geht auch: die PLZ werden daraus herausgelesen.</DialogDescription></DialogHeader>
      <div className="territory-form">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="lead-action-field">Kunde *<Input list="territory-customers" placeholder="z. B. Aurora Home Solar" value={customerName} onChange={(event) => setCustomerName(event.target.value)} /><datalist id="territory-customers">{existingNames.map((name) => <option key={name} value={name} />)}</datalist></label>
          <label className="lead-action-field">Sparte<select className="h-9 rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Ohne Sparte</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        </div>
        <div className="territory-colors"><span className="text-xs text-slate-400">Farbe auf der Karte:</span>{TERRITORY_COLORS.map((candidate) => <button key={candidate} type="button" className={`territory-swatch ${color === candidate ? "is-active" : ""}`} style={{ background: candidate }} aria-label={`Farbe ${candidate}`} onClick={() => setColor(candidate)} />)}</div>
        <label className={`cold-drop flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/15 px-4 py-5 text-sm text-slate-300 hover:border-violet-300/50`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) void readFile(file); }}><input type="file" accept=".csv,.txt,.xlsx,.xls,text/csv,text/plain" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readFile(file); event.target.value = ""; }} /><span><Upload className="inline h-4 w-4" aria-hidden="true" /> Datei auswählen oder hierher ziehen</span><small className="text-xs text-slate-500">CSV, TXT oder Excel – PLZ-Spalte oder einfach PLZ untereinander</small></label>
        {fileNote && <p className="text-xs text-slate-400">{fileNote}</p>}
        <textarea className="territory-textarea" placeholder={"…oder PLZ einfügen:\n60311\n60313\n61 (alle 61xxx)\n63000-63599"} value={text} onChange={(event) => setText(event.target.value)} />
        <div className="territory-preview">{!geo ? <span>PLZ-Liste wird geladen …</span> : !text.trim() ? <span>Noch nichts eingegeben.</span> : parsed && parsed.postcodes.length ? <><strong>{parsed.postcodes.length.toLocaleString("de-DE")} PLZ erkannt</strong><span>{[parsed.direct ? `${parsed.direct} direkt` : null, parsed.fromPrefixes ? `${parsed.fromPrefixes} aus ${parsed.prefixes.length} Vorwahl-Bereich${parsed.prefixes.length === 1 ? "" : "en"} (${parsed.prefixes.slice(0, 8).join(", ")}${parsed.prefixes.length > 8 ? " …" : ""})` : null, parsed.fromRanges ? `${parsed.fromRanges} aus ${parsed.ranges.length} Bereich${parsed.ranges.length === 1 ? "" : "en"}` : null].filter(Boolean).join(" · ")}</span>{parsed.unknown.length > 0 && <em>{parsed.unknown.length} unbekannt (keine deutsche PLZ): {parsed.unknown.slice(0, 10).join(", ")}{parsed.unknown.length > 10 ? " …" : ""}</em>}<small>{describePostcodes(parsed.postcodes, (plz) => geo.entries.get(plz)?.place ?? null, 6)}</small></> : <em>Keine gültige PLZ erkannt.{parsed?.unknown.length ? ` Unbekannt: ${parsed.unknown.slice(0, 8).join(", ")}` : ""}</em>}</div>
        <div className="grid gap-3 md:grid-cols-2"><Input placeholder="Notiz (optional), z. B. „Rhein-Main komplett“" value={note} onChange={(event) => setNote(event.target.value)} maxLength={240} /><Input placeholder="Quelle/Dateiname (optional)" value={sourceName} onChange={(event) => setSourceName(event.target.value)} maxLength={160} /></div>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button className="flux-button" disabled={!canSave} onClick={() => parsed && save.mutate({ id: edit?.id ?? null, customerName: customerName.trim(), categoryId: categoryId ? Number(categoryId) : null, color, postcodes: parsed.postcodes, note: note.trim() || null, sourceName: sourceName.trim() || null, rawCount: parsed.direct + parsed.prefixes.length + parsed.ranges.length })}>{save.isPending ? "Speichert …" : edit ? "Gebiet speichern" : "Gebiet anlegen"}</Button></div>
      </div>
    </DialogContent>
  </Dialog>;
}
