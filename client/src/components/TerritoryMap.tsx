import map from "@/data/germany-map.json";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { confirmAction } from "@/lib/confirm";
import { loadPlzGeo, PLZ_ATTRIBUTION, type PlzGeo } from "@/lib/plz-geo";
import { trpc } from "@/lib/trpc";
import { Check, ChevronDown, Download, Layers, Loader2, MapPinned, Pencil, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { describePostcodes, overlapsCsv, topPlaces, parsePostcodeText, TERRITORY_COLORS, type OverlapCustomer, type OverlapGroup, type ParsedPostcodes } from "../../../shared/territories";
import { buildTerritoryDrafts, trimTable, type TerritoryDraft } from "../../../shared/territory-import";

/**
 * Gebietskarte: Deutschlandkarte wie im Dashboard, darauf die Einsatzgebiete der Kunden als farbige PLZ-Punkte.
 * PLZ-Listen mit Kundenname und Kategorie hochladen (Datei oder Einfügen), Filter nach Kategorie und Kunde, und das Wichtigste:
 * Überschneidungen – welche PLZ bei mehreren Kunden derselben Kategorie liegen, wie oft und genau wo. Dort lässt sich ein
 * Lead mehrfach verkaufen.
 */
type TerritoryRow = { id: number; customerName: string; categoryId: number | null; categoryName: string | null; color: string; postcodes: string[]; rawCount: number; note: string | null; sourceName: string | null; active: boolean; createdBy: string | null; createdAt: string | Date; updatedAt: string | Date };
const stamp = (value: string | Date) => new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
/** PLZ-Gebiete (2-stellig) als Flächen mit Nummer – aus client/src/data/plz-regions.json (wird mit der Karte nachgeladen). */
type PlzRegions = { zones2: Record<string, { d: string; cx: number; cy: number; plz: number }>; zones1: Record<string, { d: string; cx: number; cy: number }> };
const ZONE_TINTS = ["#f59e0b", "#ef4444", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#14b8a6", "#84cc16", "#64748b"]; // je Leitzone 0–9 eine Farbe
let regionsCache: PlzRegions | null = null;
const loadRegions = () => regionsCache ? Promise.resolve(regionsCache) : import("@/data/plz-regions.json").then((module) => { regionsCache = ((module as unknown as { default?: PlzRegions }).default ?? (module as unknown as PlzRegions)) as PlzRegions; return regionsCache; });
/**
 * Verkaufs-Stufen: wie oft lässt sich ein Lead in einer PLZ verkaufen? 1 = genau ein Kunde, 2/3 = so viele Kunden derselben
 * Kategorie, 4 = mehr als drei. Jede Stufe lässt sich einzeln an- und abschalten; abgeschaltete PLZ bleiben blass auf der Karte,
 * damit nichts „verschwindet“ – die gewählten Stufen werden hervorgehoben und rechts direkt als PLZ gelistet.
 */
type SellLevel = 1 | 2 | 3 | 4;
type LevelSet = Record<SellLevel, boolean>;
const SELL_LEVELS: Array<[SellLevel, string, string]> = [[1, "1× Verkauf", "PLZ mit genau einem Kunden – der Lead lässt sich einmal verkaufen"], [2, "2× Verkauf", "Zwei Kunden derselben Kategorie in der PLZ – zweimal verkaufbar"], [3, "3× Verkauf", "Drei Kunden derselben Kategorie – dreimal verkaufbar"], [4, "mehr als 3×", "Vier oder mehr Kunden derselben Kategorie"]];
const ALL_LEVELS: LevelSet = { 1: true, 2: true, 3: true, 4: true };
const bucketOf = (count: number): SellLevel => count >= 4 ? 4 : count === 3 ? 3 : count === 2 ? 2 : 1;
const LEVEL_COLORS = { 1: "#94a3b8", 2: "#f59e0b", 3: "#e11d48", 4: "#7e22ce" } as const;
const dotColor = (count: number, base: string) => count >= 4 ? LEVEL_COLORS[4] : count === 3 ? LEVEL_COLORS[3] : count === 2 ? LEVEL_COLORS[2] : base;
const timesText = (count: number) => count >= 4 ? "mehr als 3×" : `${count}×`;

export default function TerritoryMap() {
  const territories = trpc.leadops.listTerritories.useQuery(undefined, { retry: false });
  const overlaps = trpc.leadops.territoryOverlaps.useQuery(undefined, { retry: false });
  const categories = trpc.leadops.listCategories.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const refresh = () => { utils.leadops.listTerritories.invalidate(); utils.leadops.territoryOverlaps.invalidate(); };
  const [geo, setGeo] = useState<PlzGeo | null>(null); const [geoError, setGeoError] = useState<string | null>(null);
  useEffect(() => { loadPlzGeo().then(setGeo).catch(() => setGeoError("Die PLZ-Koordinaten konnten nicht geladen werden.")); }, []);
  const [regions, setRegions] = useState<PlzRegions | null>(null); const [showRegions, setShowRegions] = useState(true);
  useEffect(() => { loadRegions().then(setRegions).catch(() => setRegions(null)); }, []);
  const regionOf = (plz: string) => regions?.zones2[plz.slice(0, 2)] ?? null;
  const [categoryFilter, setCategoryFilter] = useState<number | "alle">("alle");
  const setActive = trpc.leadops.setTerritoryActive.useMutation({ onSuccess: (result) => { toast.success(`${result.customerName} ${result.active ? "eingeschaltet" : "ausgeschaltet"}.`); refresh(); }, onError: (error) => toast.error(error.message) });
  const [focus, setFocus] = useState<number | null>(null);
  const [levels, setLevels] = useState<LevelSet>(ALL_LEVELS);
  const allLevels = SELL_LEVELS.every(([key]) => levels[key]); const chosenLevels = SELL_LEVELS.filter(([key]) => levels[key]).map(([key]) => key);
  const [hover, setHover] = useState<{ plz: string; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; edit: TerritoryRow | null }>({ open: false, edit: null });
  const [openRegion, setOpenRegion] = useState<string | null>(null);
  const remove = trpc.leadops.deleteTerritory.useMutation({ onSuccess: (result) => { toast.success(`Gebiet von „${result.customerName}“ gelöscht.`); refresh(); }, onError: (error) => toast.error(error.message) });

  const rows = (territories.data ?? []) as TerritoryRow[];
  const usedCategories = useMemo(() => { const ids = new Set(rows.map((row) => row.categoryId ?? 0)); return (categories.data ?? []).filter((category) => ids.has(category.id)).map((category) => ({ id: category.id, name: category.name })).concat(ids.has(0) ? [{ id: 0, name: "Ohne Kategorie" }] : []); }, [rows, categories.data]);
  const focused = focus !== null ? rows.find((row) => row.id === focus) ?? null : null;
  // Ein angeklickter Kunde wird allein gezeigt – seine Überschneidungen mit anderen bleiben farbig markiert (aus den Server-Daten)
  const visible = focused ? [focused] : rows.filter((row) => row.active !== false && (categoryFilter === "alle" || (row.categoryId ?? 0) === categoryFilter));
  const placeOf = (plz: string) => geo?.entries.get(plz)?.place ?? null;
  // Punkte: je PLZ die sichtbaren Kunden (innerhalb derselben Kategorie zählt die Überschneidung)
  const points = useMemo(() => {
    if (!geo) return [] as Array<{ plz: string; x: number; y: number; customers: Array<{ id: number; name: string; color: string; categoryId: number | null }>; overlap: number }>;
    const byPlz = new Map<string, Array<{ id: number; name: string; color: string; categoryId: number | null }>>();
    for (const row of visible) for (const plz of row.postcodes) { const list = byPlz.get(plz) ?? []; list.push({ id: row.id, name: row.customerName, color: row.color, categoryId: row.categoryId }); byPlz.set(plz, list); }
    const out: Array<{ plz: string; x: number; y: number; customers: Array<{ id: number; name: string; color: string; categoryId: number | null }>; overlap: number }> = [];
    for (const [plz, customers] of Array.from(byPlz.entries())) { const entry = geo.entries.get(plz); if (!entry) continue; const { x, y } = geo.project(entry.lng, entry.lat); const perCategory = new Map<number, number>(); for (const customer of customers) perCategory.set(customer.categoryId ?? 0, (perCategory.get(customer.categoryId ?? 0) ?? 0) + 1); const overlap = Math.max(0, ...Array.from(perCategory.values())); out.push({ plz, x, y, customers, overlap }); }
    return out.sort((a, b) => a.overlap - b.overlap); // Überschneidungen zuletzt zeichnen = oben
  }, [geo, visible]);
  const allGroups: OverlapGroup[] = (overlaps.data?.groups ?? []).filter((group) => categoryFilter === "alle" || (group.categoryId ?? 0) === categoryFilter);
  // Nur-ein-Kunde-Ansicht: Überschneidungen dieses Kunden aus den Server-Daten (Anzahl der Kunden je PLZ in seiner Kategorie)
  const overlapGroups: OverlapGroup[] = focused ? allGroups.filter((group) => (group.categoryId ?? null) === (focused.categoryId ?? null)).map((group) => ({ ...group, items: group.items.filter((item) => item.customers.some((customer) => customer.id === focused.id)), pairs: group.pairs.filter((pair) => pair.a.id === focused.id || pair.b.id === focused.id) })).map((group) => ({ ...group, overlapPlz: group.items.length, maxCustomers: group.items.reduce((max, item) => Math.max(max, item.count), 0) })) : allGroups;
  const focusOverlapOf = useMemo(() => { const map = new Map<string, number>(); if (focused) for (const group of overlapGroups) for (const item of group.items) map.set(item.plz, item.count); return map; }, [focused, overlapGroups]);
  const pointsWithFocus = focused ? points.map((point) => ({ ...point, overlap: focusOverlapOf.get(point.plz) ?? 0 })) : points;
  // Gewählte Stufen werden hervorgehoben und zuletzt gezeichnet (= oben), die anderen bleiben blass sichtbar
  const shown = useMemo(() => pointsWithFocus.map((point) => ({ ...point, on: levels[bucketOf(point.overlap)] })).sort((a, b) => Number(a.on) - Number(b.on) || a.overlap - b.overlap), [pointsWithFocus, levels]);
  const shownOn = shown.filter((point) => point.on).length;
  // Anzahl PLZ je Verkaufs-Stufe (für die Knöpfe und die Kennzahl) – aus den Punkten der Karte, also im aktuellen Filter
  const levelCounts = useMemo(() => ({ 1: pointsWithFocus.filter((point) => point.overlap <= 1).length, 2: pointsWithFocus.filter((point) => point.overlap === 2).length, 3: pointsWithFocus.filter((point) => point.overlap === 3).length, 4: pointsWithFocus.filter((point) => point.overlap >= 4).length }), [pointsWithFocus]);
  // Liste rechts und CSV folgen den gewählten Stufen (Stufe 1 hat keine Überschneidungen zu listen)
  const listGroups: OverlapGroup[] = allLevels ? overlapGroups : overlapGroups.map((group) => { const items = group.items.filter((item) => levels[bucketOf(item.count)]); return { ...group, items, overlapPlz: items.length, maxCustomers: items.reduce((max, item) => Math.max(max, item.count), 0) }; });
  // Überschneidungen nach Kunden-Kombination: „Aurora + Helios“ teilen 187 PLZ – einfacher zu lesen als nach Region
  const combos = useMemo(() => { const map = new Map<string, { key: string; categoryName: string; customers: OverlapCustomer[]; postcodes: string[] }>(); for (const group of listGroups) for (const item of group.items) { const customers = [...item.customers].sort((a, b) => a.customerName.localeCompare(b.customerName, "de")); const key = `${group.categoryId ?? 0}|${customers.map((customer) => customer.id).join(",")}`; const entry = map.get(key) ?? { key, categoryName: group.categoryName, customers, postcodes: [] }; entry.postcodes.push(item.plz); map.set(key, entry); } return Array.from(map.values()).map((entry) => ({ ...entry, postcodes: entry.postcodes.sort() })).sort((a, b) => b.customers.length - a.customers.length || b.postcodes.length - a.postcodes.length); }, [listGroups]);
  const toggleLevel = (key: SellLevel) => setLevels((current) => ({ ...current, [key]: !current[key] }));
  const onlyLevel = (key: SellLevel) => setLevels({ 1: key === 1, 2: key === 2, 3: key === 3, 4: key === 4 });
  const totalOverlap = overlapGroups.reduce((sum, group) => sum + group.overlapPlz, 0);
  const maxCustomers = overlapGroups.reduce((max, group) => Math.max(max, group.maxCustomers), 0);
  const covered = new Set(visible.flatMap((row) => row.postcodes)).size;
  const hovered = hover ? points.find((point) => point.plz === hover.plz) : null;
  const levelLabel = allLevels ? "alle Stufen" : chosenLevels.length ? chosenLevels.map((key) => SELL_LEVELS.find(([k]) => k === key)?.[1] ?? "").join(", ") : "keine Stufe";
  const exportCsv = () => { const csv = overlapsCsv(listGroups, placeOf); const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `Ueberschneidungen_${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url); };

  return <>
    <header className="page-intro compact territory-intro"><div><span className="eyebrow">ANALYSE</span><h1>Gebietskarte</h1><p>Wo haben wir welche Kunden, wo ist ihr Einsatzgebiet, welche Kategorie – und wo überschneiden sich die Gebiete? In diesen PLZ lässt sich ein Lead mehrfach verkaufen.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!totalOverlap} onClick={exportCsv} title="Alle Überschneidungen als CSV (Excel)"><Download /> <span className="territory-btn-long">Überschneidungen als </span>CSV</Button><Button className="flux-button" size="sm" onClick={() => setDialog({ open: true, edit: null })}><Upload /> PLZ-Liste hochladen</Button></div></header>
    <div className="metric-grid territory-kpis">
      <div className="metric-card"><span className="eyebrow">KUNDEN</span><strong>{overlaps.data?.customers ?? rows.length}</strong><small>{rows.length} {rows.length === 1 ? "Gebiet" : "Gebiete"} in {overlaps.data?.categories ?? usedCategories.length} {(overlaps.data?.categories ?? usedCategories.length) === 1 ? "Kategorie" : "Kategorien"}</small></div>
      <div className="metric-card"><span className="eyebrow">ABGEDECKTE PLZ</span><strong>{covered.toLocaleString("de-DE")}</strong><small>von {geo ? geo.universe.size.toLocaleString("de-DE") : "…"} PLZ in Deutschland{categoryFilter !== "alle" || rows.some((row) => row.active === false) ? " (nur eingeschaltete Kunden)" : ""}</small></div>
      <div className="metric-card is-accent"><span className="eyebrow">ÜBERSCHNEIDUNGEN</span><strong>{totalOverlap.toLocaleString("de-DE")} PLZ</strong><small>{totalOverlap ? `bis zu ${maxCustomers} Kunden in derselben PLZ und Kategorie` : "noch keine PLZ bei mehreren Kunden"}</small></div>
      <div className="metric-card"><span className="eyebrow">MEHRFACH VERKAUFEN</span><strong>{overlapGroups.reduce((sum, group) => sum + group.items.filter((item) => item.count >= 3).length, 0).toLocaleString("de-DE")} PLZ</strong><small>mit drei oder mehr Kunden · 1×: {levelCounts[1].toLocaleString("de-DE")} · 2×: {levelCounts[2].toLocaleString("de-DE")} · 3×: {levelCounts[3].toLocaleString("de-DE")} · mehr als 3×: {levelCounts[4].toLocaleString("de-DE")}</small></div>
    </div>
    <section className="surface-panel dashboard-filters territory-filters">
      <div className="dashboard-filter-group"><span className="eyebrow">KATEGORIE</span><div className="dashboard-segments"><button type="button" className={categoryFilter === "alle" ? "active" : ""} onClick={() => setCategoryFilter("alle")}>Alle</button>{usedCategories.map((category) => <button key={category.id} type="button" className={categoryFilter === category.id ? "active" : ""} onClick={() => setCategoryFilter(category.id)}>{category.name}</button>)}</div></div>
      <div className="dashboard-filter-group"><span className="eyebrow">KUNDEN</span><div className="territory-chips">{rows.map((row) => <button key={row.id} type="button" className={`territory-chip ${row.active === false ? "is-off" : ""} ${focus === row.id ? "is-focus" : ""}`} style={{ ["--c" as string]: row.color }} title={row.active === false ? "Kunde ist ausgeschaltet – Klick schaltet ihn ein" : "Kunde ist eingeschaltet – Klick schaltet ihn aus (zählt dann nicht auf der Karte und bei den Überschneidungen)"} disabled={setActive.isPending} onClick={() => setActive.mutate({ id: row.id, active: row.active === false })}><i /> {row.customerName}{row.categoryName ? <small>{row.categoryName}</small> : null}{row.active === false && <small className="territory-chip-off">aus</small>}</button>)}{!rows.length && <span className="text-xs text-slate-500">Noch kein Gebiet – lade die erste PLZ-Liste hoch.</span>}</div></div>
      <div className="dashboard-filter-group territory-levels"><span className="eyebrow">VERKAUFBAR</span><div className="dashboard-segments"><button type="button" className={allLevels ? "active" : ""} data-level="alle" title="Alle Stufen zeigen" onClick={() => setLevels(ALL_LEVELS)}>Alle</button>{SELL_LEVELS.map(([key, label, hint]) => <button key={key} type="button" className={levels[key] && !allLevels ? "active" : ""} aria-pressed={levels[key]} title={`${hint} – Klick schaltet die Stufe an oder aus, Doppelklick zeigt nur diese Stufe`} data-level={String(key)} onClick={() => toggleLevel(key)} onDoubleClick={() => onlyLevel(key)}><i className="territory-level-dot" style={{ background: LEVEL_COLORS[key] }} />{label}<small>{levelCounts[key].toLocaleString("de-DE")}</small></button>)}</div><small className="territory-levels-hint">{allLevels ? "Klick auf eine Stufe schaltet sie an oder aus – die anderen PLZ bleiben blass auf der Karte." : `Hervorgehoben: ${levelLabel} (${shownOn.toLocaleString("de-DE")} PLZ) – die anderen bleiben blass.`}</small></div>
    </section>
    <div className="lead-map-grid territory-grid">
      <section className="surface-panel operations-panel territory-map-panel p-4">
        <div className="lead-map-canvas territory-canvas" onMouseLeave={() => setHover(null)}>
          <svg viewBox={map.viewBox.join(" ")} role="img" aria-label="Deutschlandkarte mit Einsatzgebieten" className="lead-map-svg territory-svg">
            {map.states.map((state) => <path key={state.id} d={state.d} className="territory-state" />)}
            {showRegions && regions && <g className="territory-regions" aria-label="PLZ-Gebiete (2-stellig)">
              {Object.entries(regions.zones2).map(([code, zone]) => <path key={code} d={zone.d} className="territory-region" style={{ fill: ZONE_TINTS[Number(code[0])] }} data-region={code}><title>{`PLZ-Gebiet ${code} – ${zone.plz} PLZ`}</title></path>)}
              {map.states.map((state) => <path key={`${state.id}-outline`} d={state.d} className="territory-state-outline" />)}
              {Object.entries(regions.zones2).map(([code, zone]) => <text key={`${code}-label`} x={zone.cx} y={zone.cy} className="territory-region-label">{code}</text>)}
            </g>}
            {(!showRegions || !regions) && map.states.map((state) => <text key={`${state.id}-label`} x={state.cx} y={state.cy} className="lead-map-state-label">{state.id}</text>)}
            {shown.map((point) => { const fill = dotColor(point.overlap, point.customers[0]?.color ?? "#8278ff"); return <circle key={point.plz} cx={point.x} cy={point.y} r={point.overlap >= 4 ? 3.5 : point.overlap >= 2 ? 3.1 : 2.1} fill={fill} className={`territory-dot ${point.overlap >= 2 ? "is-overlap" : ""} ${point.on ? "" : "is-dim"}`} data-count={point.overlap} data-on={point.on ? "1" : "0"} onMouseEnter={() => setHover({ plz: point.plz, x: point.x, y: point.y })} />; })}
          </svg>
          {hovered && <div className="territory-tooltip" style={{ left: `${(hover!.x / map.viewBox[2]) * 100}%`, top: `${(hover!.y / map.viewBox[3]) * 100}%` }}><strong>{hovered.plz} {placeOf(hovered.plz) ?? ""}</strong>{regionOf(hovered.plz) && <small>PLZ-Gebiet {hovered.plz.slice(0, 2)} · {geo?.entries.get(hovered.plz)?.state ?? ""}</small>}{hovered.customers.map((customer) => <span key={customer.id}><i style={{ background: customer.color }} /> {customer.name}</span>)}{hovered.overlap >= 2 ? <em>{hovered.overlap} Kunden in derselben Kategorie – Lead {timesText(hovered.overlap)} verkaufbar</em> : <em className="is-single">ein Kunde – Lead 1× verkaufbar</em>}</div>}
          {!geo && !geoError && <p className="text-xs text-slate-500">Karte wird geladen …</p>}{geoError && <p className="text-xs text-red-300">{geoError}</p>}
          {geo && !shown.length && <p className="territory-empty">{rows.length ? "Alle Kunden ausgeblendet – oben wieder einblenden." : "Noch keine Gebiete – „PLZ-Liste hochladen“ klicken."}</p>}
          {geo && shown.length > 0 && !shownOn && <p className="territory-empty">{!chosenLevels.length ? "Keine Stufe gewählt – oben eine Stufe anklicken." : focused ? `${focused.customerName}: keine PLZ für ${levelLabel}.` : `Keine PLZ für ${levelLabel} im aktuellen Filter – die anderen Stufen bleiben blass sichtbar.`}</p>}
        </div>
        <div className="territory-legend"><label className="territory-regions-toggle" title="PLZ-Gebiete (2-stellig) mit Nummer ein- oder ausblenden"><Switch className="territory-switch" checked={showRegions} onCheckedChange={setShowRegions} aria-label="PLZ-Gebiete zeigen" /> PLZ-Gebiete</label><span><i style={{ background: focused?.color ?? "#8278ff" }} /> {focused ? `nur ${focused.customerName}` : "ein Kunde (Farbe des Kunden)"}</span><span><i style={{ background: LEVEL_COLORS[2] }} /> 2 Kunden – 2× verkaufbar</span><span><i style={{ background: LEVEL_COLORS[3] }} /> 3 Kunden – 3× verkaufbar</span><span><i style={{ background: LEVEL_COLORS[4] }} /> mehr als 3 Kunden</span><small>{PLZ_ATTRIBUTION}</small></div>
      </section>
      <aside className="lead-map-side territory-side">
        <section className="surface-panel operations-panel p-4"><div className="flex items-start justify-between gap-2"><div><span className="eyebrow">KUNDEN & GEBIETE</span><p className="mt-1 text-xs text-slate-500">{focused ? <>Nur <strong className="text-slate-200">{focused.customerName}</strong> wird gezeigt – <button type="button" className="territory-link" onClick={() => setFocus(null)}>alle Kunden zeigen</button></> : "Klick auf einen Kunden zeigt nur sein Gebiet – mit den Stellen, an denen es sich mit anderen überschneidet."}</p></div><Button size="sm" variant="outline" onClick={() => setDialog({ open: true, edit: null })}><Plus /> Neu</Button></div>
          {territories.isLoading ? <p className="mt-3 text-xs text-slate-500">Lädt …</p> : !rows.length ? <p className="mt-3 text-xs text-slate-500">Noch kein Gebiet angelegt.</p> : <ul className="territory-list mt-3">{rows.filter((row) => categoryFilter === "alle" || (row.categoryId ?? 0) === categoryFilter).map((row) => <li key={row.id} className={`${focus === row.id ? "is-focus" : ""} ${row.active === false ? "is-off" : ""}`}>
            <Switch className="territory-switch" checked={row.active !== false} disabled={setActive.isPending} aria-label={`${row.customerName} ${row.active === false ? "einschalten" : "ausschalten"}`} title={row.active === false ? "Ausgeschaltet – zählt nicht auf der Karte und bei den Überschneidungen" : "Eingeschaltet"} onCheckedChange={(value) => setActive.mutate({ id: row.id, active: value })} />
            <button type="button" className="territory-list-main" onClick={() => { if (row.active === false) { setActive.mutate({ id: row.id, active: true }); } setFocus(focus === row.id ? null : row.id); }}><i style={{ background: row.color }} /><span><strong>{row.customerName}</strong><small>{row.active === false ? "Ausgeschaltet · " : ""}{row.categoryName ?? "Ohne Kategorie"} · {geo ? describePostcodes(row.postcodes, placeOf) : `${row.postcodes.length} PLZ`}</small>{row.note && <small className="territory-note">{row.note}</small>}<small className="territory-meta">{row.sourceName ? `${row.sourceName} · ` : ""}{stamp(row.updatedAt)}{row.createdBy ? ` · ${row.createdBy.split(" ")[0]}` : ""}</small></span></button>
            <span className="territory-list-actions"><button type="button" title="Gebiet bearbeiten" onClick={() => setDialog({ open: true, edit: row })}><Pencil className="h-3.5 w-3.5" /></button><button type="button" title="Gebiet löschen" disabled={remove.isPending} onClick={async () => { if (await confirmAction(`Gebiet von „${row.customerName}“ (${row.postcodes.length} PLZ) löschen?`, { danger: true })) remove.mutate({ id: row.id }); }}><Trash2 className="h-3.5 w-3.5" /></button></span>
          </li>)}</ul>}
        </section>
        <section className="surface-panel operations-panel p-4"><span className="eyebrow">ÜBERSCHNEIDUNGEN</span><p className="mt-1 text-xs text-slate-500">{focused ? `Mit wem sich ${focused.customerName} PLZ teilt.` : "Welche Kunden sich PLZ teilen – dort lässt sich ein Lead mehrfach verkaufen. Klick zeigt die PLZ."}</p>
          {overlaps.isLoading ? <p className="mt-3 text-xs text-slate-500">Rechnet …</p> : !combos.length ? <p className="mt-3 text-xs text-slate-500">Keine Überschneidungen{categoryFilter !== "alle" ? " in dieser Kategorie" : ""}{!allLevels ? ` für ${levelLabel}` : ""}.</p>
            : <ul className="overlap-list">{combos.map((combo) => { const open = openRegion === combo.key; return <li key={combo.key} className={open ? "is-open" : ""}>
              <button type="button" className="overlap-row" onClick={() => setOpenRegion(open ? null : combo.key)} aria-expanded={open}>
                <span className="overlap-times" style={{ background: dotColor(combo.customers.length, "#94a3b8") }}>{combo.customers.length}×</span>
                <span className="overlap-main"><strong>{combo.customers.map((customer) => customer.customerName).join(" + ")}</strong><small>{combo.postcodes.length.toLocaleString("de-DE")} PLZ · {topPlaces(combo.postcodes, placeOf, 3).join(", ")}{usedCategories.length > 1 ? ` · ${combo.categoryName}` : ""}</small></span>
                <ChevronDown className="overlap-chevron h-4 w-4" aria-hidden="true" />
              </button>
              {open && <div className="overlap-plz">{combo.postcodes.map((plz) => <span key={plz}><b>{plz}</b> {placeOf(plz) ?? ""}</span>)}</div>}
            </li>; })}</ul>}
        </section>
      </aside>
    </div>
    {dialog.open && <TerritoryDialog edit={dialog.edit} geo={geo} categories={(categories.data ?? []).map((category) => ({ id: category.id, name: category.name }))} existing={rows.map((row) => ({ id: row.id, customerName: row.customerName, categoryId: row.categoryId, color: row.color, postcodes: row.postcodes }))} onClose={() => setDialog({ open: false, edit: null })} onSaved={() => { setDialog({ open: false, edit: null }); refresh(); }} />}
  </>;
}

/** Datei (CSV/TXT/Excel) in Zeilen und Zellen lesen – Excel über das erste Blatt, Text über das häufigste Trennzeichen. */
async function readTableFile(file: File): Promise<string[][]> {
  if (/\.xlsx?$/i.test(file.name)) { const XLSX = await import("xlsx"); const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" }); const sheet = workbook.Sheets[workbook.SheetNames[0]]; return (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][]).map((row) => row.map((value) => String(value ?? ""))); }
  const text = await file.text(); const lines = text.split(/\r?\n/);
  const delimiter = [";", "\t", ","].map((candidate) => ({ candidate, count: lines.slice(0, 20).reduce((sum, line) => sum + line.split(candidate).length - 1, 0) })).sort((a, b) => b.count - a.count)[0];
  const split = (line: string) => delimiter.count > 0 ? line.split(delimiter.candidate).map((value) => value.trim().replace(/^"|"$/g, "")) : [line.trim()];
  return lines.map(split);
}
type DraftRow = TerritoryDraft & { key: string; selected: boolean; categoryValue: string; merge: "ergaenzen" | "ersetzen" };

/** PLZ-Liste hochladen oder ein Gebiet bearbeiten: Kundenname, Kategorie, Farbe, Datei oder eingefügter Text, Vorschau. Bei einer Datei liest die KI die Struktur und schlägt die Gebiete je Kunde vor. */
function TerritoryDialog({ edit, geo, categories, existing, onClose, onSaved }: { edit: TerritoryRow | null; geo: PlzGeo | null; categories: Array<{ id: number; name: string }>; existing: Array<{ id: number; customerName: string; categoryId: number | null; color: string; postcodes: string[] }>; onClose: () => void; onSaved: () => void }) {
  const existingNames = Array.from(new Set(existing.map((row) => row.customerName))); const colorsInUse = existing.map((row) => row.color);
  const [customerName, setCustomerName] = useState(edit?.customerName ?? "");
  const [categoryId, setCategoryId] = useState<string>(edit?.categoryId ? String(edit.categoryId) : "");
  const [color, setColor] = useState<string>(edit?.color ?? (TERRITORY_COLORS.find((candidate) => !colorsInUse.includes(candidate)) ?? TERRITORY_COLORS[0]));
  const [text, setText] = useState(edit ? edit.postcodes.join("\n") : "");
  const [note, setNote] = useState(edit?.note ?? ""); const [sourceName, setSourceName] = useState(edit?.sourceName ?? "");
  const [fileNote, setFileNote] = useState<string | null>(null);
  const save = trpc.leadops.saveTerritory.useMutation();
  const saveOne = () => { if (!parsed) return; save.mutate({ id: edit?.id ?? null, customerName: customerName.trim(), categoryId: categoryId ? Number(categoryId) : null, color, postcodes: parsed.postcodes, note: note.trim() || null, sourceName: sourceName.trim() || null, rawCount: parsed.direct + parsed.prefixes.length + parsed.ranges.length + parsed.radii.length + parsed.places.length }, { onSuccess: (result) => { toast.success(`Gebiet ${result.created ? "angelegt" : "aktualisiert"}: ${result.postcodes.toLocaleString("de-DE")} PLZ.`); onSaved(); }, onError: (error) => toast.error(error.message) }); };
  const parsed: ParsedPostcodes | null = useMemo(() => geo && text.trim() ? parsePostcodeText(text, geo.universe, { lookup: geo.lookup }) : null, [geo, text]);
  const [radiusPlace, setRadiusPlace] = useState(""); const [radiusKm, setRadiusKm] = useState("50");
  const addRadius = () => { const place = radiusPlace.trim(); const km = Math.max(1, Math.min(500, Number(radiusKm) || 50)); if (!place) return; setText((current) => `${current.trim() ? `${current.trim()}\n` : ""}${place} ${km} km Umkreis`); setRadiusPlace(""); };
  const [analysis, setAnalysis] = useState<{ fileName: string; summary: string; source: "ki" | "regeln"; aiError: string | null; rows: number; drafts: DraftRow[] } | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const analyze = trpc.leadops.analyzeTerritoryFile.useMutation({ onError: (error) => toast.error(error.message) });
  const readFile = async (file: File) => {
    try {
      const table = await readTableFile(file); setSourceName(file.name);
      if (edit) { setText(table.map((row) => row.filter(Boolean).join(";")).filter(Boolean).join("\n")); setFileNote(`Datei „${file.name}“ gelesen – unten die erkannten PLZ prüfen.`); return; }
      setFileNote(null); setAnalysis(null);
      // Die KI bekommt nur eine Stichprobe (Kopf + erste Zeilen) für die STRUKTUR – die Gebiete baut der Browser aus ALLEN Zeilen der Datei
      const result = await analyze.mutateAsync({ fileName: file.name, rows: trimTable(table, 60) });
      const fullRows = table.map((row) => row.map((value) => String(value ?? "").trim())).filter((row) => row.some(Boolean));
      const drafts = buildTerritoryDrafts(fullRows, result.plan, { categories: result.categories, fileName: file.name });
      setAnalysis({ fileName: file.name, summary: result.summary, source: result.source, aiError: result.aiError, rows: Math.max(0, fullRows.length - (result.plan.headerRow === null ? 0 : result.plan.headerRow + 1)), drafts: drafts.map((draft, index) => ({ ...draft, key: `${index}-${draft.customerName}`, selected: draft.lines.length > 0, categoryValue: draft.categoryId ? String(draft.categoryId) : "", merge: "ergaenzen" as const })) });
    } catch { toast.error("Die Datei konnte nicht gelesen werden – bitte als CSV/TXT speichern oder die PLZ einfügen."); }
  };
  const draftParsed = useMemo(() => new Map((analysis?.drafts ?? []).map((draft) => [draft.key, geo && draft.lines.length ? parsePostcodeText(draft.lines.join("\n"), geo.universe, { lookup: geo.lookup }) : null])), [analysis, geo]);
  const updateDraft = (key: string, patch: Partial<DraftRow>) => setAnalysis((current) => current ? { ...current, drafts: current.drafts.map((draft) => draft.key === key ? { ...draft, ...patch } : draft) } : current);
  const useAsSingleList = () => { if (!analysis) return; setText(analysis.drafts.flatMap((draft) => draft.lines).join("\n")); setFileNote(`Alle Zeilen aus „${analysis.fileName}“ als eine Liste übernommen – Kunde oben eintragen.`); setAnalysis(null); };
  const createAll = async () => {
    if (!analysis) return; const chosen = analysis.drafts.filter((draft) => draft.selected && draft.customerName.trim().length >= 2 && (draftParsed.get(draft.key)?.postcodes.length ?? 0) > 0);
    if (!chosen.length) { toast.error("Kein Gebiet ausgewählt, das PLZ enthält."); return; }
    setBulk({ done: 0, total: chosen.length }); let created = 0; let updated = 0; let failed = 0;
    for (const draft of chosen) {
      const parsedDraft = draftParsed.get(draft.key)!; const categoryIdValue = draft.categoryValue ? Number(draft.categoryValue) : null;
      const same = existing.find((row) => row.customerName.toLowerCase() === draft.customerName.trim().toLowerCase() && (row.categoryId ?? null) === categoryIdValue);
      // Bestehendes Gebiet desselben Kunden in derselben Kategorie: standardmäßig ergänzen (nichts geht verloren), auf Wunsch ersetzen
      const postcodes = same && draft.merge === "ergaenzen" ? Array.from(new Set([...same.postcodes, ...parsedDraft.postcodes])).sort() : parsedDraft.postcodes;
      try { const result = await save.mutateAsync({ id: same?.id ?? null, customerName: draft.customerName.trim(), categoryId: categoryIdValue, color: null, postcodes, note: null, sourceName: analysis.fileName, rawCount: parsedDraft.direct + parsedDraft.prefixes.length + parsedDraft.ranges.length + parsedDraft.radii.length + parsedDraft.places.length }); if (result.created) created += 1; else updated += 1; }
      catch { failed += 1; }
      setBulk((current) => current ? { ...current, done: current.done + 1 } : current);
    }
    setBulk(null);
    if (failed && !created && !updated) { toast.error("Kein Gebiet konnte angelegt werden."); return; }
    toast.success(`${created} Gebiet${created === 1 ? "" : "e"} angelegt${updated ? `, ${updated} aktualisiert` : ""}${failed ? `, ${failed} fehlgeschlagen` : ""}.`); onSaved();
  };
  const canSave = customerName.trim().length >= 2 && Boolean(parsed?.postcodes.length) && !save.isPending;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="territory-dialog">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><MapPinned className="h-5 w-5" aria-hidden="true" /> {edit ? `Gebiet von „${edit.customerName}“ bearbeiten` : "PLZ-Liste hochladen"}</DialogTitle><DialogDescription>Kunde, Kategorie und sein Gebiet. Erlaubt sind 5-stellige PLZ, Vorwahl-Bereiche wie „60“ (alle 60xxx) oder „601“, Bereiche wie „60000-60599“, Orte wie „Hamburg“ und Umkreise wie „München 100 km Umkreis“ – je Zeile eins, PLZ auch durch Kommas oder Leerzeichen getrennt. Eine Datei (CSV, TXT, Excel) geht auch: die KI erkennt darin von selbst, welche Spalte Kunde, PLZ, Ort, Umkreis oder Kategorie ist, und schlägt die Gebiete je Kunde vor – du prüfst und legst alle auf einmal an.</DialogDescription></DialogHeader>
      {analyze.isPending ? <div className="territory-ai territory-ai-busy"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /><div><strong>KI liest die Datei …</strong><span>Welche Spalte ist Kunde, PLZ, Ort, Umkreis oder Kategorie? Das dauert ein paar Sekunden.</span></div></div> : analysis ? <div className="territory-ai">
        <div className="territory-ai-head"><Sparkles className="h-5 w-5" aria-hidden="true" /><div><strong>{analysis.source === "ki" ? "KI hat die Datei gelesen" : "Datei gelesen (Regeln)"}: {analysis.drafts.length} Kunde{analysis.drafts.length === 1 ? "" : "n"} in {analysis.rows} Zeilen</strong><span>{analysis.summary}</span>{analysis.source !== "ki" && analysis.aiError && <small>{analysis.aiError}</small>}</div></div>
        <div className="table-wrap"><table className="flux-table territory-ai-table"><thead><tr><th><span className="sr-only">Anlegen</span></th><th>Kunde</th><th>Kategorie</th><th>Gebiet</th><th>Hinweise</th></tr></thead><tbody>{analysis.drafts.map((draft) => { const parsedDraft = draftParsed.get(draft.key) ?? null; const same = existing.find((row) => row.customerName.toLowerCase() === draft.customerName.trim().toLowerCase() && (row.categoryId ?? null) === (draft.categoryValue ? Number(draft.categoryValue) : null)); const count = parsedDraft?.postcodes.length ?? 0; return <tr key={draft.key} className={draft.selected ? "" : "is-off"}>
          <td><input type="checkbox" className="territory-ai-check" aria-label={`${draft.customerName} anlegen`} checked={draft.selected} disabled={!count} onChange={(event) => updateDraft(draft.key, { selected: event.target.checked })} /></td>
          <td><Input className="h-8 territory-ai-name" value={draft.customerName} onChange={(event) => updateDraft(draft.key, { customerName: event.target.value })} aria-label="Kundenname" /></td>
          <td><select className="h-8 rounded-md border border-white/10 bg-slate-900 px-2 text-sm text-slate-100 territory-ai-category" value={draft.categoryValue} onChange={(event) => updateDraft(draft.key, { categoryValue: event.target.value })} aria-label="Kategorie"><option value="">Ohne Kategorie</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></td>
          <td className="territory-ai-area"><div className="territory-ai-area-in">{!geo ? <span>PLZ-Liste lädt …</span> : count ? <><strong>{count.toLocaleString("de-DE")} PLZ</strong><small>{[parsedDraft!.direct ? `${parsedDraft!.direct} direkt` : null, parsedDraft!.prefixes.length ? `${parsedDraft!.prefixes.length} Vorwahl-Bereich${parsedDraft!.prefixes.length === 1 ? "" : "e"}` : null, parsedDraft!.ranges.length ? `${parsedDraft!.ranges.length} Bereich${parsedDraft!.ranges.length === 1 ? "" : "e"}` : null, parsedDraft!.radii.length ? parsedDraft!.radii.map((radius) => `${radius.center} ${radius.km} km`).join(", ") : null, parsedDraft!.places.length ? parsedDraft!.places.map((place) => place.name).slice(0, 4).join(", ") : null].filter(Boolean).join(" · ")}</small><small>{describePostcodes(parsedDraft!.postcodes, (plz) => geo.entries.get(plz)?.place ?? null, 4)}</small></> : <em>Keine gültige PLZ</em>}</div></td>
          <td className="territory-ai-notes"><div className="territory-ai-notes-in">{same && <label className="territory-ai-merge"><span>Gebiet gibt es schon ({same.postcodes.length.toLocaleString("de-DE")} PLZ):</span><select className="h-7 rounded-md border border-white/10 bg-slate-900 px-2 text-xs text-slate-100" value={draft.merge} onChange={(event) => updateDraft(draft.key, { merge: event.target.value as DraftRow["merge"] })} aria-label="Bestehendes Gebiet"><option value="ergaenzen">neue PLZ dazu (ergänzen)</option><option value="ersetzen">durch die Liste ersetzen</option></select></label>}{draft.warnings.map((warning) => <em key={warning}>{warning}</em>)}{parsedDraft && parsedDraft.unknown.length > 0 && <em>{parsedDraft.unknown.length} unbekannte PLZ: {parsedDraft.unknown.slice(0, 5).join(", ")}{parsedDraft.unknown.length > 5 ? " …" : ""}</em>}{parsedDraft && parsedDraft.unknownPlaces.length > 0 && <em>Ort nicht gefunden: {parsedDraft.unknownPlaces.slice(0, 4).join(", ")}</em>}</div></td>
        </tr>; })}</tbody></table></div>
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => { setAnalysis(null); setSourceName(""); }}>Andere Datei</Button><Button variant="ghost" size="sm" onClick={useAsSingleList} title="Alle Zeilen als eine Liste für einen einzigen Kunden übernehmen">Als eine Liste übernehmen</Button></div><div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button className="flux-button territory-ai-create" disabled={Boolean(bulk) || !geo || !analysis.drafts.some((draft) => draft.selected && (draftParsed.get(draft.key)?.postcodes.length ?? 0) > 0)} onClick={() => void createAll()}>{bulk ? <><Loader2 className="animate-spin" /> {bulk.done} von {bulk.total} …</> : <><Check /> {analysis.drafts.filter((draft) => draft.selected && (draftParsed.get(draft.key)?.postcodes.length ?? 0) > 0).length} Gebiete anlegen</>}</Button></div></div>
      </div> : <div className="territory-form">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="lead-action-field">Kunde *<Input list="territory-customers" placeholder="z. B. Aurora Home Solar" value={customerName} onChange={(event) => setCustomerName(event.target.value)} /><datalist id="territory-customers">{existingNames.map((name) => <option key={name} value={name} />)}</datalist></label>
          <label className="lead-action-field">Kategorie<select className="h-9 rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Ohne Kategorie</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        </div>
        <div className="territory-colors"><span className="text-xs text-slate-400">Farbe auf der Karte:</span>{TERRITORY_COLORS.map((candidate) => <button key={candidate} type="button" className={`territory-swatch ${color === candidate ? "is-active" : ""}`} style={{ background: candidate }} aria-label={`Farbe ${candidate}`} onClick={() => setColor(candidate)} />)}</div>
        <label className={`cold-drop flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/15 px-4 py-5 text-sm text-slate-300 hover:border-violet-300/50`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) void readFile(file); }}><input type="file" accept=".csv,.txt,.xlsx,.xls,text/csv,text/plain" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readFile(file); event.target.value = ""; }} /><span><Upload className="inline h-4 w-4" aria-hidden="true" /> Datei auswählen oder hierher ziehen</span><small className="text-xs text-slate-500">{edit ? "CSV, TXT oder Excel – PLZ-Spalte oder einfach PLZ untereinander" : "CSV, TXT oder Excel – die KI erkennt Kunden, PLZ, Orte, Umkreise und Kategorien von selbst und schlägt die Gebiete vor"}</small></label>
        {fileNote && <p className="text-xs text-slate-400">{fileNote}</p>}
        <div className="territory-radius"><span className="text-xs text-slate-400">Umkreis eintragen:</span><Input className="h-9 territory-radius-place" placeholder="Ort oder PLZ, z. B. München" value={radiusPlace} onChange={(event) => setRadiusPlace(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addRadius(); } }} /><Input className="h-9 territory-radius-km" type="number" min={1} max={500} value={radiusKm} onChange={(event) => setRadiusKm(event.target.value)} aria-label="Kilometer" /><span className="text-xs text-slate-400">km</span><Button size="sm" variant="outline" disabled={!radiusPlace.trim()} onClick={addRadius}><Plus /> Hinzufügen</Button></div>
        <textarea className="territory-textarea" placeholder={"…oder PLZ, Orte und Umkreise einfügen (je Zeile eins):\n60311, 60313\n61 (alle 61xxx)\n63000-63599\nHamburg\nMünchen 100 km Umkreis"} value={text} onChange={(event) => setText(event.target.value)} />
        <div className="territory-preview">{!geo ? <span>PLZ-Liste wird geladen …</span> : !text.trim() ? <span>Noch nichts eingegeben.</span> : parsed && parsed.postcodes.length ? <><strong>{parsed.postcodes.length.toLocaleString("de-DE")} PLZ erkannt</strong><span>{[parsed.direct ? `${parsed.direct} direkt` : null, parsed.fromPrefixes ? `${parsed.fromPrefixes} aus ${parsed.prefixes.length} Vorwahl-Bereich${parsed.prefixes.length === 1 ? "" : "en"} (${parsed.prefixes.slice(0, 8).join(", ")}${parsed.prefixes.length > 8 ? " …" : ""})` : null, parsed.fromRanges ? `${parsed.fromRanges} aus ${parsed.ranges.length} Bereich${parsed.ranges.length === 1 ? "" : "en"}` : null, parsed.fromRadius ? `${parsed.fromRadius} aus Umkreis ${parsed.radii.map((radius) => `${radius.center} ${radius.km} km`).join(", ")}` : null, parsed.fromPlaces ? `${parsed.fromPlaces} aus Ort${parsed.places.length === 1 ? "" : "en"} ${parsed.places.map((place) => place.name).slice(0, 6).join(", ")}` : null].filter(Boolean).join(" · ")}</span>{parsed.unknown.length > 0 && <em>{parsed.unknown.length} unbekannt (keine deutsche PLZ): {parsed.unknown.slice(0, 10).join(", ")}{parsed.unknown.length > 10 ? " …" : ""}</em>}{parsed.unknownPlaces.length > 0 && <em>Ort nicht gefunden: {parsed.unknownPlaces.join(", ")} – bitte den amtlichen Ortsnamen oder eine PLZ als Mittelpunkt angeben.</em>}<small>{describePostcodes(parsed.postcodes, (plz) => geo.entries.get(plz)?.place ?? null, 6)}</small></> : <em>Keine gültige PLZ erkannt.{parsed?.unknown.length ? ` Unbekannt: ${parsed.unknown.slice(0, 8).join(", ")}` : ""}{parsed?.unknownPlaces.length ? ` Ort nicht gefunden: ${parsed.unknownPlaces.join(", ")}` : ""}</em>}</div>
        <div className="grid gap-3 md:grid-cols-2"><Input placeholder="Notiz (optional), z. B. „Rhein-Main komplett“" value={note} onChange={(event) => setNote(event.target.value)} maxLength={240} /><Input placeholder="Quelle/Dateiname (optional)" value={sourceName} onChange={(event) => setSourceName(event.target.value)} maxLength={160} /></div>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button className="flux-button" disabled={!canSave} onClick={saveOne}>{save.isPending ? "Speichert …" : edit ? "Gebiet speichern" : "Gebiet anlegen"}</Button></div>
      </div>}
    </DialogContent>
  </Dialog>;
}
