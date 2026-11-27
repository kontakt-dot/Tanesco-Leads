import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarOff, Check, CheckCircle2, ChevronDown, ChevronRight, Copy, CornerDownRight, Gauge, GitBranch, GripVertical, MapPin, MessageSquareWarning, Plus, Save, Send, Trash2, Unplug, UserRoundCog, Users, X } from "lucide-react";
import { categoryColor } from "@/lib/colors";
import { categoryEmoji } from "../../../shared/category-emoji";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { confirmAction } from "@/lib/confirm";
import { parsePrice, ruleSentence, suggestChainName, supplierText } from "../../../shared/chain-rules";
import { missingDefaultReasons } from "../../../shared/default-reasons";

type Range = "heute" | "gestern" | "7_tage" | "14_tage" | "30_tage" | "maximal";
type Overview = inferRouterOutputs<AppRouter>["leadops"]["chainOverview"];
type OverviewChain = Overview["chains"][number];
type Pickers = inferRouterOutputs<AppRouter>["leadops"]["chainPickers"];
type Detail = inferRouterOutputs<AppRouter>["leadops"]["chainDetail"];
type Stop = Detail["stops"][number];
type StopDelivery = inferRouterOutputs<AppRouter>["leadops"]["listStopDeliveries"][number];

const RANGES: Array<{ value: Range; label: string }> = [{ value: "heute", label: "Heute" }, { value: "gestern", label: "Gestern" }, { value: "7_tage", label: "Letzte 7 Tage" }, { value: "14_tage", label: "Letzte 14 Tage" }, { value: "30_tage", label: "Letzte 30 Tage" }, { value: "maximal", label: "Maximal" }];
const COUNTRIES = [{ value: "", label: "Alle Länder" }, { value: "DE", label: "Deutschland" }, { value: "AT", label: "Österreich" }, { value: "CH", label: "Schweiz" }];
const STATES = ["Baden-Württemberg", "Bayern", "Berlin", "Brandenburg", "Bremen", "Hamburg", "Hessen", "Mecklenburg-Vorpommern", "Niedersachsen", "Nordrhein-Westfalen", "Rheinland-Pfalz", "Saarland", "Sachsen", "Sachsen-Anhalt", "Schleswig-Holstein", "Thüringen"];
const FILTER_OPS: Array<{ value: "gleich" | "ungleich" | "enthaelt" | "gesetzt" | "leer" | "groesser" | "kleiner"; label: string }> = [{ value: "gleich", label: "ist gleich" }, { value: "ungleich", label: "ist nicht" }, { value: "enthaelt", label: "enthält" }, { value: "gesetzt", label: "ist gesetzt" }, { value: "leer", label: "ist leer" }, { value: "groesser", label: "größer als" }, { value: "kleiner", label: "kleiner als" }];
const field = "h-10 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100";
const small = "h-9 max-w-[260px] rounded-md border border-white/10 bg-slate-900 px-2 text-sm text-slate-100";
const money = (value: string | number) => `${Number(value).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const stamp = (value: Date | string) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const statusBadge = (status: string) => status === "angenommen" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : status === "reklamiert" || status === "abgelehnt" ? "border-red-400/25 bg-red-500/10 text-red-200" : status === "übersprungen" ? "border-amber-400/25 bg-amber-500/10 text-amber-200" : "border-white/15 text-slate-300";
const statusLabel: Record<string, string> = { angenommen: "angenommen", reklamiert: "reklamiert", abgelehnt: "abgelehnt", übersprungen: "übersprungen", im_fenster: "im Reklamationsfenster", angeboten: "angeboten" };

export default function ChainWorkspace() {
  const [chainId, setChainId] = useState<number | null>(() => Number(new URLSearchParams(window.location.search).get("chain")) || null);
  const [range, setRange] = useState<Range>("maximal"); const [alone, setAlone] = useState(false); // gezielt zu einer anderen Sparte gewechselt: Dort gilt zunächst nur sie
  const open = (id: number | null) => { setChainId(id); const params = new URLSearchParams(window.location.search); params.set("page", "Lieferkette"); if (id) params.set("chain", String(id)); else params.delete("chain"); window.history.replaceState(null, "", `/?${params.toString()}`); };
  if (chainId) return <ChainDetailPage key={chainId} chainId={chainId} range={range} setRange={setRange} onBack={() => { setAlone(false); open(null); }} alone={alone} onOpenChain={(id) => { setAlone(true); open(id); }} />;
  return <ChainOverviewPage range={range} setRange={setRange} onOpen={open} />;
}

function RangeSelect({ range, setRange }: { range: Range; setRange: (value: Range) => void }) {
  return <select className={small} value={range} onChange={(event) => setRange(event.target.value as Range)} aria-label="Zeitraum">{RANGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>;
}

/* ------------------------------------------------------------------ Übersicht */
/**
 * Übersicht: feste Verteilung. Je Kategorie stehen die Ketten in ihrer festen Reihenfolge – mit „Von“ (Lieferanten) und „An“ (Kunden der Reihe nach).
 * Es wird nicht abgewechselt: Passen mehrere Ketten zu einem Lead, kommt immer zuerst die obere.
 */
function ChainOverviewPage({ range, setRange, onOpen }: { range: Range; setRange: (value: Range) => void; onOpen: (id: number) => void }) {
  const utils = trpc.useUtils();
  const overview = trpc.leadops.chainOverview.useQuery({ range }, { retry: false });
  const pickers = trpc.leadops.chainPickers.useQuery(undefined, { retry: false });
  const refresh = () => { utils.leadops.chainOverview.invalidate(); utils.leadops.listDeliveryChains.invalidate(); };
  const onError = (error: { message: string }) => toast.error(error.message);
  const [building, setBuilding] = useState(false);
  const createRule = trpc.leadops.createChainRule.useMutation({ onSuccess: (result) => { refresh(); setBuilding(false); toast.success(result.created.length === 1 ? "Lieferkette angelegt." : `${result.created.length} Lieferketten angelegt – eine je Kategorie.`); if (result.created.length === 1) onOpen(result.created[0].chainId); }, onError });
  const updateChain = trpc.leadops.updateDeliveryChain.useMutation({ onSuccess: refresh, onError });
  const deleteChain = trpc.leadops.deleteDeliveryChain.useMutation({ onSuccess: () => { refresh(); toast.success("Kette gelöscht."); }, onError });
  const reorder = trpc.leadops.reorderChains.useMutation({ onSuccess: () => { refresh(); toast.success("Reihenfolge gespeichert."); }, onError });
  const chains = overview.data?.chains ?? [];
  const groups = useMemo(() => {
    const byCategory = new Map<number, { categoryId: number; categoryName: string; chains: OverviewChain[] }>();
    for (const chain of chains) { const group = byCategory.get(chain.categoryId) ?? { categoryId: chain.categoryId, categoryName: chain.categoryName, chains: [] }; group.chains.push(chain); byCategory.set(chain.categoryId, group); }
    return Array.from(byCategory.values()).map((group) => ({ ...group, chains: group.chains.slice().sort((a, b) => a.place - b.place) })).sort((a, b) => a.categoryName.localeCompare(b.categoryName, "de"));
  }, [chains]);
  const move = (group: { categoryId: number; chains: OverviewChain[] }, chainId: number, direction: -1 | 1) => { const ids = group.chains.map((chain) => chain.id); const index = ids.indexOf(chainId); const target = index + direction; if (target < 0 || target >= ids.length) return; [ids[index], ids[target]] = [ids[target], ids[index]]; reorder.mutate({ categoryId: group.categoryId, chainIds: ids }); };
  const nameOf = (id: number) => chains.find((chain) => chain.id === id)?.name ?? `Kette #${id}`;
  // Farbe und Emoji je Kategorie (wie in der Leads-Tabelle) – für den Kopf jeder Gruppe
  const categoryList = trpc.leadops.listCategories.useQuery(undefined, { retry: false });
  const look = (id: number, name: string) => { const category = (categoryList.data ?? []).find((row) => row.id === id); return { color: categoryColor(category ?? { id, color: null } as never), emoji: categoryEmoji(category ?? { name }) }; };
  // Kennzahlen für die Leiste oben (im gewählten Zeitraum)
  const sums = chains.reduce((total, chain) => ({ sent: total.sent + chain.stats.total, accepted: total.accepted + chain.stats.accepted, rejected: total.rejected + chain.stats.rejected }), { sent: 0, accepted: 0, rejected: 0 });
  const activeCount = chains.filter((chain) => chain.status === "aktiv").length;
  const buyerCount = new Set(chains.filter((chain) => chain.status === "aktiv").flatMap((chain) => chain.buyers.filter((buyer) => buyer.active).map((buyer) => buyer.name.trim().toLowerCase()))).size;
  const decided = sums.accepted + sums.rejected; const rate = decided ? Math.round((sums.accepted / decided) * 100) : null;
  const rangeLabel = RANGES.find((item) => item.value === range)?.label ?? "";
  return <div className="fx-scope lk">
    <header className="page-intro compact"><div><span className="eyebrow">ROUTING ENGINE</span><h1>Lieferkette</h1><p>Feste Verteilung: Du legst fest, welche Kategorie von welchen Lieferanten an welche Kunden geht. Die Kunden kommen in fester Reihenfolge dran – es wird nicht abgewechselt.</p></div>
      <div className="flex flex-wrap items-center gap-3"><RangeSelect range={range} setRange={setRange} /><Button className="flux-button" onClick={() => setBuilding(true)} disabled={building}><Plus className="h-4 w-4" /> Neue Lieferkette</Button></div></header>
    {groups.length > 0 && <section className="lk-rail" aria-label="Kennzahlen der Lieferketten">
      <div className="lk-stat"><span className="lk-stat-label"><GitBranch aria-hidden="true" />Ketten</span><strong>{activeCount}<em>von {chains.length} aktiv</em></strong><small>in {groups.length} {groups.length === 1 ? "Kategorie" : "Kategorien"}</small></div>
      <div className="lk-stat"><span className="lk-stat-label"><Users aria-hidden="true" />Kunden in Ketten</span><strong>{buyerCount}</strong><small>bekommen Leads in fester Reihenfolge</small></div>
      <div className="lk-stat"><span className="lk-stat-label"><Send aria-hidden="true" />Geschickt</span><strong>{sums.sent.toLocaleString("de-DE")}<em>Leads</em></strong><small>Zeitraum: {rangeLabel}</small></div>
      <div className="lk-stat"><span className="lk-stat-label"><CheckCircle2 aria-hidden="true" />Angenommen</span><strong className="is-good">{sums.accepted.toLocaleString("de-DE")}<em>{rate === null ? "noch keine Entscheidung" : `${rate} % Annahme`}</em></strong>{decided > 0 && <span className="lk-split" aria-hidden="true">{sums.accepted > 0 && <i className="is-good" style={{ flexGrow: sums.accepted }} />}{sums.rejected > 0 && <i className="is-bad" style={{ flexGrow: sums.rejected }} />}</span>}<small>{sums.rejected.toLocaleString("de-DE")} abgelehnt</small></div>
    </section>}
    {building && <ChainBuilder pickers={pickers.data} pending={createRule.isPending} onCancel={() => setBuilding(false)} onCreate={(values) => createRule.mutate(values)} />}
    {overview.isLoading ? <section className="lk-panel"><p className="lk-empty">Ketten werden geladen …</p></section> : overview.error ? <section className="lk-panel"><p className="lk-empty is-error">{overview.error.message}</p></section> : !groups.length ? (building ? null : <ChainWelcome onStart={() => setBuilding(true)} />) :
      groups.map((group) => { const active = group.chains.filter((chain) => chain.status === "aktiv"); const shared = active.some((chain) => chain.before.length > 0); const { color, emoji } = look(group.categoryId, group.categoryName); return <section key={group.categoryId} className="lk-panel" aria-label={`Lieferketten für ${group.categoryName}`} style={{ ["--cat" as string]: color }}>
        <header className="lk-group"><span className="lk-group-badge" aria-hidden="true">{emoji}</span><h2>{group.categoryName}</h2><span>{group.chains.length === 1 ? "1 Kette" : `${group.chains.length} Ketten`}{active.length !== group.chains.length ? ` · ${active.length} aktiv` : ""}</span></header>
        {shared && <p className="lk-order-note">Zu manchen Leads passen hier mehrere Ketten. Dann gilt immer die Reihenfolge von oben nach unten: Erst wenn in der oberen Kette kein Kunde zugreift, kommt die nächste.</p>}
        <ol className="lk-list">{group.chains.map((chain, index) => <li key={chain.id} className={`lk-chain ${chain.status === "aktiv" ? "" : "is-off"}`}>
          <div className="lk-place"><strong title="Platz in der festen Reihenfolge dieser Kategorie">{chain.place}</strong>{group.chains.length > 1 && <span><button type="button" aria-label={`„${chain.name}“ nach oben`} title="Früher drankommen" disabled={index === 0 || reorder.isPending} onClick={() => move(group, chain.id, -1)}><ArrowUp /></button><button type="button" aria-label={`„${chain.name}“ nach unten`} title="Später drankommen" disabled={index === group.chains.length - 1 || reorder.isPending} onClick={() => move(group, chain.id, 1)}><ArrowDown /></button></span>}</div>
          <div className="lk-body">
            <div className="lk-title"><button type="button" className="lk-name" onClick={() => onOpen(chain.id)}>{chain.name}</button>{chain.orderNumber && <span className="lk-order">Bestellung {chain.orderNumber}</span>}<span className={`lk-status ${chain.status === "aktiv" ? "is-on" : ""}`}>{chain.status === "aktiv" ? "Aktiv" : "Aus"}</span></div>
            <div className="lk-flow">
              <span className="lk-from"><small>Von</small><b>{chain.supplierText}</b>{chain.country && <i>nur {chain.country}</i>}</span>
              <ArrowRight className="lk-arrow" aria-hidden="true" />
              <span className="lk-to"><small>An</small>{chain.buyers.length ? <span className="lk-buyers">{chain.buyers.map((buyer, position) => <span key={`${buyer.name}-${position}`} className={`lk-buyer ${buyer.active ? "" : "is-off"}`} title={buyer.active ? `Kunde ${position + 1} · ${money(buyer.unitPrice)}` : "Dieser Kunde ist ausgeschaltet"}><em>{position + 1}</em>{buyer.name}</span>)}</span> : <b className="lk-missing">Noch kein Kunde – diese Kette verteilt nichts</b>}</span>
            </div>
            {chain.before.length > 0 && <p className="lk-after">Kommt erst nach: {chain.before.map(nameOf).join(", ")}</p>}
          </div>
          <div className="lk-side">
            <span className="lk-stats" title="Geschickt / angenommen / abgelehnt im gewählten Zeitraum"><span className="lk-stats-line"><b>{chain.stats.total}</b> geschickt · <b className="is-good">{chain.stats.accepted}</b> angenommen · <b className="is-bad">{chain.stats.rejected}</b> abgelehnt</span><span className="lk-meter" aria-hidden="true">{chain.stats.total > 0 ? <>{chain.stats.accepted > 0 && <i className="is-good" style={{ flexGrow: chain.stats.accepted }} />}{chain.stats.rejected > 0 && <i className="is-bad" style={{ flexGrow: chain.stats.rejected }} />}{chain.stats.total - chain.stats.accepted - chain.stats.rejected > 0 && <i style={{ flexGrow: chain.stats.total - chain.stats.accepted - chain.stats.rejected }} />}</> : <i className="is-none" />}</span></span>
            <span className="lk-actions"><Button size="sm" variant="outline" disabled={updateChain.isPending} onClick={() => updateChain.mutate({ id: chain.id, status: chain.status === "aktiv" ? "inaktiv" : "aktiv" })}>{chain.status === "aktiv" ? "Ausschalten" : "Einschalten"}</Button><Button size="sm" variant="outline" onClick={() => onOpen(chain.id)}>Öffnen</Button><Button size="sm" variant="ghost" aria-label={`Kette „${chain.name}“ löschen`} title="Kette löschen" onClick={async () => { if (await confirmAction(`Kette „${chain.name}“ wirklich löschen?`)) deleteChain.mutate({ chainId: chain.id }); }}><Trash2 className="h-4 w-4" /></Button></span>
          </div>
        </li>)}</ol>
      </section>; })}
  </div>;
}

/**
 * Noch keine Lieferkette: zeigt an einem Bild, was eine Kette tut (Kategorie → Lieferanten → Kunde 1, 2, 3), in drei Schritten,
 * und führt direkt zur ersten Kette.
 */
function ChainWelcome({ onStart }: { onStart: () => void }) {
  return <section className="lk-welcome" aria-label="Noch keine Lieferkette">
    <div className="lk-welcome-lane" aria-hidden="true">
      <span className="lk-node is-cat"><small>Kategorie</small><b>☀️ Photovoltaik</b></span>
      <span className="lk-wire" />
      <span className="lk-node"><small>Von</small><b>Alle Lieferanten</b></span>
      <span className="lk-wire" />
      <span className="lk-node is-buyer"><em>1</em><b>Kunde A</b></span>
      <span className="lk-wire is-short" />
      <span className="lk-node is-buyer"><em>2</em><b>Kunde B</b></span>
      <span className="lk-wire is-short" />
      <span className="lk-node is-buyer"><em>3</em><b>Kunde C</b></span>
      <span className="lk-pulse" />
    </div>
    <div className="lk-welcome-text">
      <h2>Noch keine Lieferkette</h2>
      <p>Eine Lieferkette legt fest, wohin die Leads einer Kategorie gehen – immer in derselben Reihenfolge. Kunde 1 bekommt jeden passenden Lead zuerst; nimmt er ihn nicht, geht er an Kunde 2 und so weiter.</p>
      <ol className="lk-welcome-steps">
        <li><em>1</em><span><b>Kategorie wählen</b><small>z. B. Photovoltaik oder Wärmepumpe</small></span></li>
        <li><em>2</em><span><b>Lieferanten festlegen</b><small>alle oder nur bestimmte</small></span></li>
        <li><em>3</em><span><b>Kunden der Reihe nach</b><small>mit Preis je Lead</small></span></li>
      </ol>
      <div className="lk-welcome-actions"><Button className="flux-button" onClick={onStart}><Plus className="h-4 w-4" /> Erste Lieferkette anlegen</Button><small>Aus jeder Bestellung entsteht ihre Lieferkette von selbst – die Bestellung ist dort Station 1.</small></div>
    </div>
  </section>;
}

type BuilderBuyer = { key: number; buyerUserId: number | null; name: string; price: string };
/** „Neue Lieferkette“: Kategorie(n) → Lieferanten → Kunden in fester Reihenfolge. Darunter steht die Regel als Satz. */
function ChainBuilder({ pickers, pending, onCancel, onCreate }: { pickers: Pickers | undefined; pending: boolean; onCancel: () => void; onCreate: (values: { categoryIds: number[]; supplierMode: "all" | "include"; supplierIds: number[]; buyers: Array<{ buyerUserId: number | null; buyerName: string | null; unitPrice: number }>; name: string | null; active: boolean }) => void }) {
  const categories = (pickers?.categories ?? []).filter((category) => category.status === "aktiv" && !category.isTemplate); const suppliers = pickers?.suppliers ?? []; const accounts = pickers?.buyers ?? [];
  const [categoryIds, setCategoryIds] = useState<number[]>([]); const [supplierMode, setSupplierMode] = useState<"all" | "include">("all"); const [supplierIds, setSupplierIds] = useState<number[]>([]);
  const [buyers, setBuyers] = useState<BuilderBuyer[]>([]); const [pick, setPick] = useState(""); const [freeName, setFreeName] = useState(""); const [price, setPrice] = useState(""); const [name, setName] = useState(""); const [active, setActive] = useState(true); const [seq, setSeq] = useState(1);
  const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  const supplierNames = supplierIds.map((id) => suppliers.find((supplier) => supplier.id === id)?.label.split(" — ")[0] ?? `Lieferant #${id}`);
  const categoryNames = categoryIds.map((id) => categories.find((category) => category.id === id)?.name ?? "");
  const fromText = supplierText(supplierMode, supplierNames);
  const addBuyer = () => {
    const account = pick && pick !== "frei" ? accounts.find((buyer) => String(buyer.userId) === pick) : undefined; const label = account ? account.company : freeName.trim();
    if (!label || label.length < 2) return toast.error("Bitte einen Kunden wählen oder einen Namen eintragen.");
    if (account && buyers.some((buyer) => buyer.buyerUserId === account.userId)) return toast.error("Dieser Kunde steht schon in der Kette.");
    setBuyers([...buyers, { key: seq, buyerUserId: account?.userId ?? null, name: label, price: price.trim() || "0" }]); setSeq(seq + 1); setPick(""); setFreeName(""); setPrice("");
  };
  const moveBuyer = (index: number, direction: -1 | 1) => { const next = buyers.slice(); const target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; setBuyers(next); };
  const suggested = categoryNames.length === 1 ? suggestChainName(categoryNames[0], supplierMode === "all" ? [] : supplierNames, buyers.map((buyer) => buyer.name)) : "";
  const missing = !categoryIds.length ? "Wähle mindestens eine Kategorie." : supplierMode === "include" && !supplierIds.length ? "Wähle mindestens einen Lieferanten – oder „Alle Lieferanten“." : active && !buyers.length ? "Trage mindestens einen Kunden ein – oder lege die Kette ausgeschaltet an." : null;
  const submit = () => onCreate({ categoryIds, supplierMode, supplierIds: supplierMode === "include" ? supplierIds : [], buyers: buyers.map((buyer) => ({ buyerUserId: buyer.buyerUserId, buyerName: buyer.buyerUserId ? null : buyer.name, unitPrice: Math.max(0, Number(buyer.price.replace(",", ".")) || 0) })), name: name.trim() || null, active });
  return <section className="lk-panel lk-builder" aria-label="Neue Lieferkette">
    <header className="lk-builder-head"><div><h2>Neue Lieferkette</h2><p>Drei Angaben, dann steht fest, wohin diese Leads gehen.</p></div><button type="button" className="lk-close" aria-label="Schließen" onClick={onCancel}><X /></button></header>
    <div className="lk-steps">
      <fieldset className="lk-step"><legend><em>1</em> Welche Kategorie?</legend>
        {categories.length ? <div className="lk-chips">{categories.map((category) => <button key={category.id} type="button" className={`lk-chip ${categoryIds.includes(category.id) ? "is-on" : ""}`} aria-pressed={categoryIds.includes(category.id)} onClick={() => setCategoryIds(toggle(categoryIds, category.id))}>{category.name}</button>)}</div> : <p className="lk-hint">Noch keine Lead-Kategorie angelegt.</p>}
        <p className="lk-hint">Mehrere wählen ist möglich – dann entsteht je Kategorie eine Kette mit denselben Kunden.</p>
      </fieldset>
      <fieldset className="lk-step"><legend><em>2</em> Von welchen Lieferanten?</legend>
        <div className="lk-radio" role="radiogroup" aria-label="Lieferanten"><button type="button" role="radio" aria-checked={supplierMode === "all"} className={supplierMode === "all" ? "is-on" : ""} onClick={() => setSupplierMode("all")}>Alle Lieferanten</button><button type="button" role="radio" aria-checked={supplierMode === "include"} className={supplierMode === "include" ? "is-on" : ""} onClick={() => setSupplierMode("include")}>Nur bestimmte</button></div>
        {supplierMode === "include" && (suppliers.length ? <div className="lk-chips">{suppliers.map((supplier) => <button key={supplier.id} type="button" className={`lk-chip ${supplierIds.includes(supplier.id) ? "is-on" : ""}`} aria-pressed={supplierIds.includes(supplier.id)} onClick={() => setSupplierIds(toggle(supplierIds, supplier.id))}>{supplier.label.split(" — ")[0]}</button>)}</div> : <p className="lk-hint">Noch kein Lieferant angelegt.</p>)}
        <p className="lk-hint">{supplierMode === "all" ? "Jeder Lead dieser Kategorie passt – egal, von wem er kommt." : "Nur Leads dieser Lieferanten laufen in die Kette. Alle anderen bleiben für andere Ketten."}</p>
      </fieldset>
      <fieldset className="lk-step is-wide"><legend><em>3</em> An welche Kunden – in dieser Reihenfolge</legend>
        {buyers.length > 0 && <ol className="lk-picked">{buyers.map((buyer, index) => <li key={buyer.key}><em>{index + 1}</em><strong>{buyer.name}</strong><label>Preis<Input aria-label={`Preis für ${buyer.name}`} inputMode="decimal" value={buyer.price} onChange={(event) => setBuyers(buyers.map((item) => item.key === buyer.key ? { ...item, price: event.target.value } : item))} /><span>€</span></label><span className="lk-picked-tools"><button type="button" aria-label={`${buyer.name} nach oben`} disabled={index === 0} onClick={() => moveBuyer(index, -1)}><ArrowUp /></button><button type="button" aria-label={`${buyer.name} nach unten`} disabled={index === buyers.length - 1} onClick={() => moveBuyer(index, 1)}><ArrowDown /></button><button type="button" aria-label={`${buyer.name} entfernen`} onClick={() => setBuyers(buyers.filter((item) => item.key !== buyer.key))}><X /></button></span></li>)}</ol>}
        <div className="lk-add">
          <select aria-label="Kunde wählen" className={field} value={pick} onChange={(event) => setPick(event.target.value)}><option value="">Kunde wählen …</option>{accounts.filter((buyer) => !buyers.some((item) => item.buyerUserId === buyer.userId)).map((buyer) => <option key={buyer.userId} value={buyer.userId}>{buyer.label}{buyer.api ? " · API" : ""}</option>)}<option value="frei">Anderer Kunde (nur Name)</option></select>
          {pick === "frei" && <Input aria-label="Name des Kunden" value={freeName} placeholder="Name des Kunden" onChange={(event) => setFreeName(event.target.value)} />}
          <label className="lk-add-price"><Input aria-label="Preis je Lead" inputMode="decimal" value={price} placeholder="Preis" onChange={(event) => setPrice(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addBuyer(); } }} /><span>€</span></label>
          <Button variant="outline" onClick={addBuyer} disabled={!pick}><Plus className="h-4 w-4" /> Kunde hinzufügen</Button>
        </div>
        <p className="lk-hint">Kunde 1 bekommt jeden passenden Lead zuerst. Nimmt er ihn nicht (Gebiet, Tagesgrenze, Dublette, Ablehnung), geht der Lead an Kunde 2 und so weiter. Gebiete und Grenzen stellst du danach je Kunde ein.</p>
      </fieldset>
    </div>
    <p className="lk-sentence" aria-live="polite"><span>So wird verteilt</span>{ruleSentence(categoryNames, fromText, buyers.map((buyer) => buyer.name))}</p>
    <div className="lk-builder-foot">
      <label className="lk-name-field">Name der Kette (optional)<Input value={name} maxLength={140} placeholder={suggested || "wird aus Kategorie, Lieferanten und Kunden gebildet"} onChange={(event) => setName(event.target.value)} /></label>
      <label className="lk-switch"><Switch checked={active} onCheckedChange={setActive} aria-label="Gleich einschalten" /><span>{active ? "Gleich einschalten" : "Ausgeschaltet anlegen"}</span></label>
      <span className="lk-builder-actions">{missing && <small role="status">{missing}</small>}<Button variant="outline" onClick={onCancel}>Abbrechen</Button><Button className="flux-button" disabled={pending || Boolean(missing)} onClick={submit}>{pending ? "Wird angelegt …" : categoryIds.length > 1 ? `${categoryIds.length} Lieferketten anlegen` : "Lieferkette anlegen"}</Button></span>
    </div>
  </section>;
}

/* ------------------------------------------------------------------ Detailseite */
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "?";
/** Gebiet einer Station in Worten: „Landesweit“, „Bayern, Hessen“, „PLZ 10, 12 …“ */
const areaText = (stop: Pick<Stop, "geoMode" | "geoValues">) => stop.geoMode === "landesweit" || !stop.geoValues.length ? "Landesweit" : stop.geoMode === "bundesland" ? (stop.geoValues.length > 3 ? `${stop.geoValues.length} Bundesländer` : stop.geoValues.join(", ")) : `PLZ ${stop.geoValues.slice(0, 4).join(", ")}${stop.geoValues.length > 4 ? " …" : ""}`;

/**
 * Detailseite einer Kette (v376, einfacher): die Stationen der Reihe nach als Karten. Bei jeder steht, wann der Lead zur nächsten weitergeht
 * (Gebiet passt nicht, Dublette, Höchstmenge, Ablehnung, Reklamation). In der Kette einer Bestellung ist Station 1 die Bestellung selbst –
 * mit allem, was von dort gilt. Auch eingebettet in den Bestellungen (Schritt „Lieferkette“), dann ohne Rücksprung und mit kompaktem Kopf.
 */
export function ChainDetailPage({ chainId, range, setRange, onBack, embedded = false, onOpenChain, alone = false }: { chainId: number; range: Range; setRange: (value: Range) => void; onBack: () => void; embedded?: boolean; /** zur Kette einer anderen Leadsparte derselben Bestellung wechseln */ onOpenChain?: (chainId: number) => void; /** die Kette wurde gezielt geöffnet („ansehen“): Dann gilt zunächst nur diese Sparte – sonst alle Sparten mit derselben Kette */ alone?: boolean }) {
  const utils = trpc.useUtils();
  const detail = trpc.leadops.chainDetail.useQuery({ chainId, range }, { retry: false });
  const refresh = () => { utils.leadops.chainDetail.invalidate(); utils.leadops.chainOverview.invalidate(); utils.leadops.listDeliveryChains.invalidate(); };
  const onError = (error: { message: string }) => toast.error(error.message);
  // Mehrere Leadsparten (v379): Für welche weiteren Sparten gilt, was hier festgelegt wird? Nach jeder Änderung bekommen sie dieselbe Kette.
  // Seit v391 gespeichert: `scope` gilt (gespeichert – vor dem ersten Speichern alle eingeschalteten Sparten mit derselben Kette, gezielt
  // geöffnet nur diese), `draft` ist, was gerade angehakt ist. Erst „Speichern“ übernimmt es. null = noch nicht aus den Daten gelesen.
  const [scope, setScope] = useState<number[] | null>(null); const [draft, setDraft] = useState<number[] | null>(null); const scopeRef = useRef<number[]>([]); const copyQueue = useRef<Promise<unknown>>(Promise.resolve());
  const copyChain = trpc.leadops.copyOrderChain.useMutation(); const saveScope = trpc.leadops.saveChainScope.useMutation();
  useEffect(() => { if (scope !== null || !detail.data) return; const info = detail.data.order; const initial = !info ? [] : info.linksSaved ? info.chains.filter((item) => item.linked).map((item) => item.chainId) : alone ? [] : info.chains.filter((item) => item.chainId !== chainId && item.status === "aktiv" && item.same).map((item) => item.chainId); setScope(initial); setDraft(initial); }, [detail.data, scope, chainId, alone]);
  scopeRef.current = scope ?? [];
  const droppedNote = (dropped: Array<{ categoryName: string; buyerName: string; field: string }>) => { if (dropped.length) toast.message(`Hinweis: ${dropped.length === 1 ? "Ein Feld-Filter geht" : `${dropped.length} Feld-Filter gehen`} nicht mit – ${dropped.slice(0, 3).map((item) => `„${item.field}“ gibt es in ${item.categoryName} nicht`).join("; ")}${dropped.length > 3 ? " …" : ""}.`); };
  /** Kette auf andere Sparten übertragen – der Reihe nach, damit ein älterer Stand nie einen neueren überschreibt. */
  const copyTo = (toChainIds: number[]) => { const run = copyQueue.current.then(() => copyChain.mutateAsync({ fromChainId: chainId, toChainIds })); copyQueue.current = run.catch(() => undefined); return run; };
  /** Nach jeder Änderung an den Stationen: neu laden – und die angehakten Sparten bekommen dieselbe Kette. */
  const afterChange = () => { refresh(); const others = scopeRef.current; if (others.length) void copyTo(others).then((result) => { droppedNote(result.dropped); refresh(); }).catch((error: { message?: string }) => { toast.error(`Die anderen Sparten konnten nicht angepasst werden: ${error?.message ?? "unbekannter Fehler"}`); refresh(); }); };
  const scopeNote = () => (scopeRef.current.length ? ` Gilt für ${scopeRef.current.length + 1} Sparten.` : "");
  const updateChain = trpc.leadops.updateDeliveryChain.useMutation({ onSuccess: () => { refresh(); toast.success("Ketten-Einstellungen gespeichert."); }, onError });
  const addStop = trpc.leadops.addChainStop.useMutation({ onSuccess: () => { afterChange(); setAdding(null); toast.success(`Station hinzugefügt.${scopeNote()}`); }, onError });
  const updateStop = trpc.leadops.updateChainStop.useMutation({ onSuccess: afterChange, onError });
  const reorder = trpc.leadops.reorderChainStops.useMutation({ onSuccess: afterChange, onError });
  const deleteStop = trpc.leadops.deleteChainStop.useMutation({ onSuccess: () => { afterChange(); toast.success(`Station gelöscht.${scopeNote()}`); }, onError });
  const adopt = trpc.leadops.insertOrderStation.useMutation({ onSuccess: () => { refresh(); toast.success("Übernommen: Station 1 ist jetzt die Bestellung."); }, onError });
  const addReasons = trpc.leadops.addDefaultReasons.useMutation({ onSuccess: (result) => { refresh(); toast.success(result.added ? `${result.added} Gründe angelegt.` : "Die Standard-Gründe sind schon da."); }, onError });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adding, setAdding] = useState<{ buyerUserId: string; buyerName: string; price: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [dragId, setDragId] = useState<number | null>(null);
  if (detail.isLoading) return <section className="fx-scope lk-panel"><p className="lk-empty">Kette wird geladen …</p></section>;
  if (detail.error || !detail.data) return <section className="fx-scope lk-panel"><p className="lk-empty is-error">{detail.error?.message ?? "Kette nicht gefunden."}</p>{!embedded && <div className="px-5 pb-5"><Button variant="outline" onClick={onBack}>Zurück zu den Ketten</Button></div>}</section>;
  const { chain, stops, buyers, suppliers, activity, order } = detail.data;
  const fromText = supplierText(chain.supplierFilterMode, chain.supplierIds.map((id) => suppliers.find((supplier) => supplier.id === id)?.label.split(" — ")[0] ?? `Lieferant #${id}`));
  // Station 1 einer Bestellung bleibt vorn: Sie lässt sich nicht verschieben, und nichts kommt vor sie
  const moveStop = (stopId: number, direction: -1 | 1) => { const ids = stops.map((stop) => stop.id); const index = ids.indexOf(stopId); const target = index + direction; if (target < 0 || target >= ids.length || stops[target].orderStop) return; [ids[index], ids[target]] = [ids[target], ids[index]]; reorder.mutate({ chainId, stopIds: ids }); };
  const dropOn = (targetId: number) => { if (dragId === null || dragId === targetId) return; const ids = stops.map((stop) => stop.id); const from = ids.indexOf(dragId); const to = ids.indexOf(targetId); ids.splice(from, 1); ids.splice(to, 0, dragId); setDragId(null); reorder.mutate({ chainId, stopIds: ids }); };
  // Sparten der Bestellung: die angehakten bekommen dieselbe Kette; die anderen haben ihre eigene
  const scopeIds = scope ?? []; const siblings = order ? order.chains.filter((item) => item.chainId !== chain.id) : []; const selectable = siblings.filter((item) => item.status === "aktiv");
  const apart = siblings.filter((item) => !scopeIds.includes(item.chainId));
  const joinNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`);
  const ownRoute = stops.filter((stop) => !stop.orderStop).map((stop) => stop.buyerCompany);
  /** die Sparten, für die diese Kette gilt – die gezeigte zuerst */ const scopeNames = [chain.categoryName, ...siblings.filter((item) => scopeIds.includes(item.chainId)).map((item) => item.categoryName)];
  // Angehakt, aber noch nicht gespeichert (v391): Erst „Speichern“ übernimmt die Auswahl – vorher bekommt keine Sparte etwas ab
  const draftIds = draft ?? scopeIds; const dirty = draftIds.length !== scopeIds.length || draftIds.some((id) => !scopeIds.includes(id));
  const draftOn = (item: { chainId: number }) => item.chainId === chain.id || draftIds.includes(item.chainId);
  const draftNames = [chain.categoryName, ...siblings.filter((item) => draftIds.includes(item.chainId)).map((item) => item.categoryName)];
  const allDraft = selectable.length > 0 && selectable.every(draftOn);
  const toggleScope = (item: (typeof siblings)[number]) => setDraft(draftIds.includes(item.chainId) ? draftIds.filter((id) => id !== item.chainId) : [...draftIds, item.chainId]);
  const toggleAll = () => setDraft(allDraft ? draftIds.filter((id) => !selectable.some((item) => item.chainId === id)) : Array.from(new Set([...draftIds, ...selectable.map((item) => item.chainId)])));
  /** Speichern: Wer neu dazukommt und eine andere Kette hat, bekommt nach einer Nachfrage diese hier. Danach bleibt die Auswahl – auch nach dem Neuladen. */
  const persistScope = async () => {
    const next = [...draftIds]; const differing = siblings.filter((item) => next.includes(item.chainId) && !scopeIds.includes(item.chainId) && !item.same);
    if (differing.length) {
      const names = joinNames(differing.map((item) => item.categoryName));
      const losing = differing.filter((item) => item.route.length); // nur wer schon eigene Stationen hat, verliert etwas
      if (!(await confirmAction(`${names} ${differing.length === 1 ? "bekommt" : "bekommen"} dieselbe Kette wie ${chain.categoryName}${ownRoute.length ? ` (nach Station 1: ${ownRoute.join(" → ")})` : " (keine weitere Station)"}.${losing.length ? ` Die bisherigen Stationen von ${joinNames(losing.map((item) => `${item.categoryName} (${item.route.join(" → ")})`))} werden ersetzt.` : ""} Speichern?`, { confirmLabel: "Speichern", danger: false }))) return;
    }
    const run = copyQueue.current.then(() => saveScope.mutateAsync({ chainId, linkedChainIds: next })); copyQueue.current = run.catch(() => undefined); // nach einer laufenden Übertragung
    try { const result = await run; droppedNote(result.dropped); setScope(next); setDraft(next); toast.success(next.length ? `Gespeichert: Diese Kette gilt jetzt für ${joinNames(draftNames)}.` : `Gespeichert: Diese Kette gilt jetzt nur für ${chain.categoryName}.`); refresh(); }
    catch (error) { toast.error((error as { message?: string })?.message ?? "Die Auswahl konnte nicht gespeichert werden."); refresh(); }
  };
  const freeBuyers = buyers.filter((buyer) => !stops.some((stop) => stop.buyerUserId === buyer.userId));
  const openSettings = () => { setSettingsOpen(true); window.setTimeout(() => document.getElementById(`lk-settings-${chain.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); };
  const status = <span className={`lk-status ${chain.status === "aktiv" ? "is-on" : ""}`}>{chain.status === "aktiv" ? "Aktiv" : "Aus"}</span>;
  return <div className="fx-scope lk lk-detail lk-v2">
    {!embedded && <button type="button" className="lk-back" onClick={onBack}><ArrowLeft aria-hidden="true" />Zurück zu den Ketten</button>}
    {embedded ? <div className="lk-embed-head"><div><h2>{order ? "Lieferkette der Bestellung" : chain.name}</h2><p>{order ? "Station 1 ist diese Bestellung. Darunter legst du fest, wohin ein Lead geht, wenn Station 1 ihn nicht nimmt." : "Die Stationen kommen von oben nach unten dran."}</p></div><div className="lk-head-tools"><RangeSelect range={range} setRange={setRange} />{status}</div></div>
    : <header className="page-intro compact"><div><span className="eyebrow">LIEFERKETTE</span><h1>{chain.name}</h1><p>Feste Reihenfolge: Die Kunden kommen von oben nach unten dran – es wird nicht abgewechselt.</p></div><div className="lk-head-tools"><RangeSelect range={range} setRange={setRange} />{status}</div></header>}

    {/* Seit v379: Die Kette gilt für alle angehakten Sparten – alle gemeinsam oder einzelne. Was hier geändert wird, bekommen sie alle. */}
    {order && order.chains.length > 1 && <section className="lk-sparten" aria-label="Leadsparten der Bestellung">
      <div className="lk-sparten-head"><b>Für welche Sparten gilt diese Kette?</b><span>{draftIds.length ? `Was du unten festlegst, gilt für ${joinNames(draftNames)}.` : `Was du unten festlegst, gilt nur für ${chain.categoryName}.`}</span></div>
      <div className="lk-sparten-chips" role="group" aria-label="Sparten dieser Kette">
        {selectable.length > 0 && <button type="button" className={`lk-sparte is-all ${allDraft ? "is-on" : ""}`} aria-pressed={allDraft} disabled={saveScope.isPending} title={allDraft ? "Nur noch für die gezeigte Sparte festlegen" : "Diese Kette für alle Sparten der Bestellung festlegen"} onClick={toggleAll}>{allDraft && <Check aria-hidden="true" />}Alle {selectable.length + 1} Sparten</button>}
        <button type="button" className="lk-sparte is-on is-own" aria-pressed="true" aria-disabled="true" title="Diese Sparte siehst du gerade – ihre Kette steht unten" onClick={(event) => event.preventDefault()}><Check aria-hidden="true" />{chain.categoryName}</button>
        {siblings.map((item) => { const on = draftIds.includes(item.chainId); const off = item.status !== "aktiv";
          return <button key={item.chainId} type="button" className={`lk-sparte ${on ? "is-on" : ""}`} aria-pressed={on} disabled={off || saveScope.isPending} title={off ? "Diese Kette ist ausgeschaltet" : on ? `${item.categoryName} abwählen – die Sparte behält ihre Kette, folgt nach dem Speichern aber den Änderungen nicht mehr` : item.same ? `${item.categoryName} dazunehmen – die Kette ist schon dieselbe` : `${item.categoryName} dazunehmen – beim Speichern bekommt die Sparte diese Kette`} onClick={() => toggleScope(item)}>{on && <Check aria-hidden="true" />}{item.categoryName}{off ? " (aus)" : ""}</button>; })}
      </div>
      {/* v391: Die Auswahl gilt erst mit „Speichern“ – und bleibt dann, auch nach dem Neuladen */}
      <div className={`lk-sparten-save ${dirty ? "is-dirty" : "is-saved"}`}>
        <span role="status">{dirty ? <><AlertTriangle aria-hidden="true" />Noch nicht gespeichert – erst mit „Speichern“ gilt die Auswahl.</> : <><Check aria-hidden="true" />Gespeichert</>}</span>
        {dirty && <button type="button" className="lk-sparten-reset" disabled={saveScope.isPending} onClick={() => setDraft(scopeIds)}>Verwerfen</button>}
        <Button type="button" className="flux-button" disabled={!dirty || saveScope.isPending} onClick={() => void persistScope()}><Save aria-hidden="true" />{saveScope.isPending ? "Speichert …" : "Speichern"}</Button>
      </div>
      {apart.length > 0 && <ul className="lk-sparten-apart" aria-label="Sparten mit eigener Kette">{apart.map((item) => <li key={item.chainId}><b>{item.categoryName}</b><span>{item.same ? "hat dieselben Stationen, folgt den Änderungen hier aber nicht" : `eigene Kette: ${item.route.length ? `nach Station 1 → ${item.route.join(" → ")}` : "keine weitere Station"}`}</span>{onOpenChain && <button type="button" onClick={() => onOpenChain(item.chainId)}>Kette von {item.categoryName} ansehen</button>}</li>)}</ul>}
    </section>}

    <section className="fx-scope lk-rule" aria-label="Regel dieser Kette">
      <div className="lk-flow"><span className="lk-from"><small>{scopeIds.length ? "Kategorien" : "Kategorie"}</small><b>{scopeNames.join(", ")}</b></span><ArrowRight className="lk-arrow" aria-hidden="true" /><span className="lk-from"><small>Von</small><b>{fromText}</b>{chain.country && <i>nur {chain.country}</i>}</span><ArrowRight className="lk-arrow" aria-hidden="true" /><span className="lk-to"><small>An</small>{stops.length ? <span className="lk-buyers">{stops.map((stop) => <span key={stop.id} className={`lk-buyer ${stop.active ? "" : "is-off"}`}><em>{stop.position}</em>{stop.buyerCompany}</span>)}</span> : <b className="lk-missing">Noch kein Kunde</b>}</span></div>
      <p className="lk-sentence"><span>So wird verteilt</span>{ruleSentence(scopeNames, fromText, stops.filter((stop) => stop.active).map((stop) => stop.buyerCompany))}</p>
    </section>

    {order?.buyerMissing ? <section className="lk-adopt" role="status"><AlertTriangle aria-hidden="true" /><div><strong>In der Bestellung ist noch kein Käufer gewählt</strong><p>So lange geht über diese Kette kein Lead raus. Wähle in der Bestellung den Käufer und speichere sie – dann steht er hier als Station 1.</p></div>{!embedded && <a className="lk-adopt-link" href={`/?page=Bestellungen&orderId=${order.orderId}`}>Bestellung öffnen</a>}</section>
    : order?.missingStation ? <section className="lk-adopt" role="status"><AlertTriangle aria-hidden="true" /><div><strong>Diese Kette folgt ihrer Bestellung noch nicht</strong><p>{stops.length ? "Station 1 – der Käufer der Bestellung zu ihrem Preis – ist hier noch nicht festgelegt. Bis dahin läuft die Kette wie bisher." : "Die Kette hat noch keine Station und nimmt deshalb keinen Lead an."} Mit „Übernehmen“ wird {order.buyerName} Station 1; Preis und Lieferanten kommen dann aus der Bestellung.</p></div><Button variant="outline" disabled={adopt.isPending} onClick={async () => { if (await confirmAction(`${order.buyerName} wird Station 1 dieser Bestellung (${money(order.unitPrice)} je Lead) und bekommt ab dann jeden passenden Lead zuerst. Übernehmen?`)) adopt.mutate({ chainId }); }}>Aus der Bestellung übernehmen</Button></section> : null}

    <section className="lk-panel lk-stops">
      <header className="lk-stops-head"><div><h2>Stationen der Reihe nach</h2><p>Station 1 bekommt jeden passenden Lead zuerst. Kann sie ihn nicht nehmen, geht er zur nächsten Station – bei jeder steht, wann das passiert.</p></div></header>
      <ol className="lk-stop-list lk-track">
        {stops.map((stop, index) => { const decided = stop.stats.accepted + stop.stats.rejected; const isOrder = stop.orderStop; const open = Boolean(expanded[stop.id]); const toggle = () => setExpanded({ ...expanded, [stop.id]: !open });
          const forwarding = stop.rules.filter((rule) => rule.allowed && rule.passOn); const fact = (key: string) => order?.facts.find((item) => item.key === key)?.value ?? "";
          return <li key={stop.id} className={`lk-stop ${stop.active ? "" : "is-off"} ${isOrder ? "is-order" : ""} ${dragId === stop.id ? "is-drag" : ""} ${open ? "is-open" : ""}`} draggable={!isOrder} onDragStart={() => { if (!isOrder) setDragId(stop.id); }} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(stop.id)} onDragEnd={() => setDragId(null)}>
          <div className="lk-stop-row">
            <div className="lk-stop-who">
              {isOrder ? <span className="lk-stop-move is-fixed" aria-hidden="true" /> : <span className="lk-stop-move"><button type="button" className="lk-grip" title="Verschieben (ziehen oder Pfeile)"><GripVertical /></button><span><button type="button" disabled={index === 0 || stops[index - 1].orderStop} aria-label="Nach oben" onClick={() => moveStop(stop.id, -1)}><ArrowUp /></button><button type="button" disabled={index === stops.length - 1} aria-label="Nach unten" onClick={() => moveStop(stop.id, 1)}><ArrowDown /></button></span></span>}
              <strong className="lk-stop-pos" title="Platz in der Reihenfolge">{stop.position}</strong>
              <span className="lk-stop-avatar" aria-hidden="true">{initials(stop.buyerCompany)}</span>
              <button type="button" className="lk-stop-name" aria-label={`Station ${stop.position}: ${stop.buyerCompany} – Einstellungen`} aria-expanded={open} title={stop.buyerLabel} onClick={toggle}><span><b>{stop.buyerCompany}</b><small>{isOrder && order ? `Aus der Bestellung ${order.orderNumber}` : stop.buyerContact || (stop.buyerUserId ? "" : "ohne Konto – wird von Hand übergeben")}</small></span><ChevronDown className="lk-stop-chevron" aria-hidden="true" /></button>
              <span className="lk-stop-tags">{stop.api && <span className="lk-tag is-api" title="Geht automatisch über die Schnittstelle des Kunden raus">API</span>}{stop.membershipId && <a className="lk-tag is-link" href={`/?page=Benutzer&member=${stop.membershipId}`} title="Zum Konto des Kunden" aria-label="Zum Konto des Kunden"><UserRoundCog /></a>}</span>
            </div>
            <div className="lk-stop-numbers" title={`${stop.stats.total} geschickt · ${stop.stats.accepted} angenommen · ${stop.stats.rejected} abgelehnt · Annahme ${stop.stats.acceptanceRate ?? "–"} % (angenommen ÷ entschieden)`}>
              <span className="lk-stop-stat"><b>{stop.stats.total}</b><small>geschickt</small></span>
              <span className="lk-stop-stat is-good"><b>{stop.stats.accepted}</b><small>angenommen</small></span>
              <span className="lk-stop-stat is-bad"><b>{stop.stats.rejected}</b><small>abgelehnt</small></span>
              <span className="lk-stop-rate"><b>{stop.stats.acceptanceRate === null ? "–" : `${stop.stats.acceptanceRate} %`}</b><span className="lk-meter" aria-hidden="true">{decided > 0 ? <>{stop.stats.accepted > 0 && <i className="is-good" style={{ flexGrow: stop.stats.accepted }} />}{stop.stats.rejected > 0 && <i className="is-bad" style={{ flexGrow: stop.stats.rejected }} />}</> : <i className="is-none" />}</span></span>
            </div>
            <div className="lk-stop-edit">
              {isOrder ? <span className="lk-stop-fixed" title="Der Preis kommt aus der Bestellung">{money(stop.unitPrice)}</span> : <StopNumber label="€" value={String(stop.unitPrice).replace(".", ",")} step="0.01" width="w-20" title="Preis je Lead" onCommit={(value) => updateStop.mutate({ id: stop.id, unitPrice: parsePrice(value) })} />}
              <StopNumber label="Std." value={String(stop.reclamationWindowHours)} width="w-14" title="Reklamationsfrist in Stunden (0 = sofort angenommen)" onCommit={(value) => updateStop.mutate({ id: stop.id, reclamationWindowHours: Math.max(0, Number(value) || 0) })} />
              <StopNumber label="" value={stop.maxLeads ? String(stop.maxLeads) : ""} width="w-16" placeholder="max" title="Höchstmenge für diesen Kunden (leer = keine Grenze)" onCommit={(value) => updateStop.mutate({ id: stop.id, maxLeads: value ? Number(value) : null })} />
              {(!isOrder || !stop.active) && <label className="lk-stop-switch" title="Station eingeschaltet – bekommt Leads"><Switch checked={stop.active} onCheckedChange={(checked) => updateStop.mutate({ id: stop.id, active: checked })} aria-label="Station eingeschaltet" />{stop.active ? "An" : "Aus"}</label>}
              {!isOrder && <button type="button" className="lk-stop-delete" aria-label="Station löschen" title="Station löschen" onClick={async () => { if (await confirmAction(`Station „${stop.buyerCompany}“ löschen?`)) deleteStop.mutate({ stopId: stop.id }); }}><Trash2 /></button>}
            </div>
          </div>
          {isOrder && order && <div className="lk-order-box">
            <dl className="lk-facts">{order.facts.map((item) => <div key={item.key}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
            <p className="lk-order-hint">Das alles kommt aus der Bestellung und wird dort geändert. Vor dem Start, nach dem Ende und wenn die Menge erreicht ist, geht über diese Kette nichts mehr raus.{!embedded && <> <a href={`/?page=Bestellungen&orderId=${order.orderId}`}>Bestellung öffnen</a></>}</p>
          </div>}
          <div className="lk-why"><span className="lk-why-lead">{index === stops.length - 1 ? "Der Lead verlässt die Kette, wenn" : "Der Lead geht zur nächsten Station, wenn"}</span>
            <ul>
              {isOrder && order ? <li><MapPin aria-hidden="true" />das Gebiet der Bestellung nicht passt <em>{fact("gebiet")}</em></li> : <li className="is-button"><button type="button" onClick={toggle} aria-expanded={open} title="Gebiet dieses Kunden einstellen"><MapPin aria-hidden="true" />das Gebiet nicht passt <em>{areaText(stop)}</em></button></li>}
              {isOrder && order && <li><CalendarOff aria-hidden="true" />kein Liefertag ist oder eine Lieferpause läuft <em>geliefert wird {fact("tage")}</em></li>}
              <li><Copy aria-hidden="true" />der Kunde den Kontakt schon hat <em>Dublette</em></li>
              {stop.maxLeads ? <li><Gauge aria-hidden="true" />seine Höchstmenge erreicht ist <em>max. {stop.maxLeads}</em></li> : null}
              {stop.api && <li><Unplug aria-hidden="true" />seine Schnittstelle den Lead ablehnt</li>}
              <li className="is-button"><button type="button" onClick={toggle} aria-expanded={open}><MessageSquareWarning aria-hidden="true" />er reklamiert <em>{!stop.rules.length ? "noch keine Gründe angelegt" : forwarding.length ? `bei ${forwarding.length} von ${stop.rules.length} Gründen` : "bei keinem Grund – der Lead endet hier"}</em></button></li>
            </ul>
          </div>
          {/* Seit v377: ein deutlicher Streifen zum Auf- und Zuklappen – der kleine Pfeil am Namen allein fiel nicht auf */}
          <button type="button" className="lk-stop-toggle" onClick={toggle} aria-expanded={open} aria-label={open ? `Station ${stop.position} zuklappen` : `Station ${stop.position} aufklappen: Reklamationsgründe, Gebiet und Einstellungen`}><ChevronDown aria-hidden="true" /><span>{open ? "Zuklappen" : "Aufklappen"}</span>{!open && <small>Reklamationsgründe, Gebiet und weitere Einstellungen dieser Station</small>}</button>
          {open && <div className="lk-stop-more">
            <p className="lk-handover">Übergabe: {stop.api ? "automatisch über die Schnittstelle des Kunden" : stop.buyerUserId ? "von Hand – für diesen Kunden ist keine Schnittstelle eingerichtet" : "von Hand – der Kunde hat kein Konto"}. Nach {stop.reclamationWindowHours ? `${stop.reclamationWindowHours} Stunden ohne Reklamation gilt der Lead als angenommen` : "der Übergabe gilt der Lead sofort als angenommen"}.{stop.membershipId && <> <a href={`/?page=Benutzer&member=${stop.membershipId}&tab=tools`}>{stop.api ? "Schnittstelle des Kunden ansehen" : "Schnittstelle für den Kunden einrichten"}</a></>}</p>
            <StationReasons stop={stop} onSaved={afterChange} onAddDefaults={() => addReasons.mutate()} addingDefaults={addReasons.isPending} />
            <StationSettings stop={stop} isOrder={isOrder} suppliers={suppliers} buyers={buyers} onSaved={afterChange} />
          </div>}
        </li>; })}
        <li className="lk-add-row">{adding ? <form className="lk-add-form" onSubmit={(event) => { event.preventDefault(); addStop.mutate({ chainId, buyerUserId: adding.buyerUserId ? Number(adding.buyerUserId) : null, buyerName: adding.buyerName.trim() || null, unitPrice: parsePrice(adding.price) }); }}>
          <label>Kunde<select className={field} value={adding.buyerUserId} onChange={(event) => setAdding({ ...adding, buyerUserId: event.target.value })}>{freeBuyers.map((buyer) => <option key={buyer.userId} value={buyer.userId}>{buyer.label}{buyer.api ? " · API" : ""}</option>)}<option value="">Anderer Kunde (nur Name)</option></select></label>
          {!adding.buyerUserId && <label>Name des Kunden<Input value={adding.buyerName} onChange={(event) => setAdding({ ...adding, buyerName: event.target.value })} placeholder="Name" /></label>}
          <label>Preis je Lead<span className="lk-add-price"><Input inputMode="decimal" value={adding.price} placeholder="0,00" onChange={(event) => setAdding({ ...adding, price: event.target.value })} /><span>€</span></span></label>
          {scopeIds.length > 0 && <p className="lk-add-all">Die Station kommt in die Ketten von {joinNames(scopeNames)} – wie oben angehakt.</p>}
          <span className="lk-add-actions"><Button type="submit" variant="outline" disabled={addStop.isPending || (!adding.buyerUserId && adding.buyerName.trim().length < 2)}><Check className="h-4 w-4" /> Station hinzufügen</Button><Button type="button" variant="ghost" onClick={() => setAdding(null)}>Abbrechen</Button></span>
        </form> : <button type="button" className="lk-add-btn" onClick={() => setAdding({ buyerUserId: String(freeBuyers[0]?.userId ?? ""), buyerName: "", price: "" })}><Plus aria-hidden="true" /><span><b>{stops.length ? "Nächste Station hinzufügen" : "Erste Station hinzufügen"}</b><small>{stops.length ? "Wohin der Lead geht, wenn ihn vorher niemand nimmt" : "Wer die Leads dieser Kette bekommt"}</small></span></button>}</li>
        {stops.length > 0 && <li className="lk-end"><CornerDownRight aria-hidden="true" /><span>Nimmt keine Station den Lead, {chain.exhaustedAction === "return" ? "geht er zurück an die Quelle" : "ist er frei für deine anderen Ketten und Bestellungen"}.</span><button type="button" onClick={openSettings}>ändern</button></li>}
      </ol>
    </section>

    <section className="lk-panel lk-settings" id={`lk-settings-${chain.id}`}>
      <button type="button" className="lk-settings-toggle" onClick={() => setSettingsOpen((value) => !value)} aria-expanded={settingsOpen}><ChevronRight className={settingsOpen ? "is-open" : ""} aria-hidden="true" /><span><b>Ketten-Einstellungen</b><small>Name, Reihenfolge, Grenzen, Lieferanten – und was passiert, wenn keine Station den Lead nimmt</small></span></button>
      {settingsOpen && <ChainSettingsForm chain={chain} suppliers={suppliers} fromOrder={Boolean(order) && !order?.missingStation} pending={updateChain.isPending} onSave={(values) => updateChain.mutate({ id: chain.id, ...values })} />}
    </section>

    <section className="lk-panel lk-activity">
      <header className="lk-stops-head"><div><h2>Aktivität</h2><p>{activity.delivered} zugestellt · {activity.inTransit} gerade unterwegs</p></div></header>
      <div className="lk-activity-list">{stops.map((stop) => <StopActivity key={stop.id} stop={stop} range={range} />)}{!stops.length && <p className="lk-empty">Noch keine Aktivität.</p>}</div>
    </section>
  </div>;
}

function StopNumber({ label, value, onCommit, width, step, placeholder, title }: { label: string; value: string; onCommit: (value: string) => void; width: string; step?: string; placeholder?: string; title?: string }) {
  const [draft, setDraft] = useState(value); const [editing, setEditing] = useState(false);
  const shown = editing ? draft : value;
  return <label className="flex items-center gap-1 text-xs text-slate-500" title={title}><Input type="text" inputMode="decimal" className={`${width} h-9 px-2 text-right`} value={shown} placeholder={placeholder} onFocus={() => { setDraft(value); setEditing(true); }} onChange={(event) => setDraft(event.target.value)} onBlur={() => { setEditing(false); if (draft !== value) onCommit(draft); }} onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} />{label}</label>;
}

/* ------------------------------------------------------------------ Ketten-Einstellungen */
function ChainSettingsForm({ chain, suppliers, pending, onSave, fromOrder = false }: { chain: Detail["chain"]; suppliers: Detail["suppliers"]; pending: boolean; /** Kette einer Bestellung: Die Lieferanten kommen von dort */ fromOrder?: boolean; onSave: (values: { name: string; priority: number; sellTarget: number; dailyCap: number | null; totalCap: number | null; status: "aktiv" | "inaktiv"; exhaustedAction: "return" | "release"; exhaustedOverrides: Array<{ supplierId: number; action: "return" | "release" }>; country: string | null; supplierFilterMode: "all" | "include" | "exclude"; supplierIds: number[] }) => void }) {
  const [form, setForm] = useState({ name: chain.name, priority: String(chain.priority), sellTarget: String(chain.sellTarget), dailyCap: chain.dailyCap ? String(chain.dailyCap) : "", totalCap: chain.totalCap ? String(chain.totalCap) : "", active: chain.status === "aktiv", exhaustedAction: chain.exhaustedAction, overrides: chain.exhaustedOverrides, country: chain.country ?? "", supplierFilterMode: chain.supplierFilterMode, supplierIds: chain.supplierIds });
  const [addSupplier, setAddSupplier] = useState(""); const [addOverride, setAddOverride] = useState<string | null>(null);
  const supplierName = (id: number) => suppliers.find((supplier) => supplier.id === id)?.label ?? `Lieferant #${id}`;
  const actionSelect = (value: "return" | "release", onChange: (value: "return" | "release") => void) => <select className={field} value={value} onChange={(event) => onChange(event.target.value as "return" | "release")}><option value="return">Zurück an die Quelle (reklamieren)</option><option value="release">In meine Lieferketten/Bestellungen freigeben</option></select>;
  return <div className="border-t border-white/8 px-5 py-5">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <label className="grid gap-1 text-xs text-slate-400">Name<Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label className="grid gap-1 text-xs text-slate-400">Reihenfolge<Input type="number" min={1} value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} /><span className="text-[11px] text-slate-500">Kleinere Zahl = kommt zuerst dran. Passen mehrere Ketten zu einem Lead, gilt immer diese feste Reihenfolge – es wird nicht abgewechselt.</span></label>
      <label className="grid gap-1 text-xs text-slate-400">Verkaufsziel<Input type="number" min={1} value={form.sellTarget} onChange={(event) => setForm({ ...form, sellTarget: event.target.value })} /><span className="text-[11px] text-slate-500">1 = exklusiv (ein Käufer). N = an N verschiedene Käufer.</span></label>
      <label className="grid gap-1 text-xs text-slate-400">Tageshöchstgrenze<Input type="number" min={1} value={form.dailyCap} placeholder="unbegrenzt" onChange={(event) => setForm({ ...form, dailyCap: event.target.value })} /><span className="text-[11px] text-slate-500">Max. Kontakte pro Tag durch diese Kette. Leer = unbegrenzt.</span></label>
      <label className="grid gap-1 text-xs text-slate-400">Maximale Leads insgesamt<Input type="number" min={1} value={form.totalCap} placeholder="unbegrenzt" onChange={(event) => setForm({ ...form, totalCap: event.target.value })} /><span className="text-[11px] text-slate-500">Obergrenze über die gesamte Laufzeit. Ist sie erreicht, nimmt die Kette keine weiteren Leads mehr an.</span></label>
      <label className="grid gap-1 text-xs text-slate-400">Kette aktiv<span className="flex h-10 items-center gap-2"><Switch checked={form.active} onCheckedChange={(checked) => setForm({ ...form, active: checked })} aria-label="Kette aktiv" /><span className="text-sm text-slate-200">{form.active ? "An" : "Aus"}</span></span><span className="text-[11px] text-slate-500">Inaktive Ketten verteilen keine Leads.</span></label>
    </div>
    <div className="mt-5 rounded-lg border border-white/10 bg-slate-950/30 p-4">
      <h3 className="text-sm font-semibold text-slate-100">Welche Leads laufen in diese Kette?</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">Die Kategorie steht fest ({chain.categoryName}). Hier legst du fest, von welchen Lieferanten die Leads kommen dürfen – und aus welchem Land.{fromOrder && " Diese Kette gehört zu einer Bestellung: Die Lieferanten kommen von dort und werden beim Speichern der Bestellung wieder übernommen."}</p>
      <div className="mt-3 grid gap-4 md:grid-cols-3">
        <label className="grid gap-1 text-xs text-slate-400">Von welchen Lieferanten?<select className={field} value={form.supplierFilterMode} onChange={(event) => setForm({ ...form, supplierFilterMode: event.target.value as typeof form.supplierFilterMode })}><option value="all">Alle Lieferanten</option><option value="include">Nur diese Lieferanten</option><option value="exclude">Alle außer diese Lieferanten</option></select><span className="text-[11px] text-slate-500">Ein Lead, den keine Kette annimmt, bleibt liegen und steht unter „API-Fehler“.</span></label>
        <label className="grid gap-1 text-xs text-slate-400">Land der Kette (optional)<select className={field} value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })}>{COUNTRIES.map((country) => <option key={country.value} value={country.value}>{country.label}</option>)}</select><span className="text-[11px] text-slate-500">Nur Leads dieses Landes laufen in die Kette.</span></label>
      </div>
      {form.supplierFilterMode !== "all" && <div className="mt-3"><span className="text-xs text-slate-400">{form.supplierFilterMode === "include" ? "Nur diese Lieferanten" : "Alle außer diesen"}</span><div className="mt-1 flex flex-wrap items-center gap-2">{form.supplierIds.map((id) => <span key={id} className="flex items-center gap-1 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-100">{supplierName(id)}<button type="button" aria-label="Entfernen" onClick={() => setForm({ ...form, supplierIds: form.supplierIds.filter((item) => item !== id) })}><X className="h-3 w-3" /></button></span>)}
        <select className={small} value={addSupplier} onChange={(event) => setAddSupplier(event.target.value)}><option value="">+ Lieferant hinzufügen</option>{suppliers.filter((supplier) => !form.supplierIds.includes(supplier.id)).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.label}</option>)}</select>{addSupplier && <Button size="sm" variant="outline" onClick={() => { setForm({ ...form, supplierIds: [...form.supplierIds, Number(addSupplier)] }); setAddSupplier(""); }}>Hinzufügen</Button>}</div>{form.supplierFilterMode === "include" && !form.supplierIds.length && <p className="mt-2 text-xs text-amber-300">Noch kein Lieferant gewählt – so nimmt die Kette keinen Lead an.</p>}</div>}
    </div>
    <div className="mt-5 rounded-lg border border-white/10 bg-slate-950/30 p-4">
      <h3 className="text-sm font-semibold text-slate-100">Lead ohne Abnehmer (erschöpft)</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">Läuft ein Lead durch die ganze Kette, ohne dass ihn ein Käufer nimmt, geht er entweder zurück an die Quelle (Reklamation beim Lieferanten bzw. Kooperationspartner) oder wird freigegeben — zuerst für deine weiteren Lieferketten in ihrer festen Reihenfolge, und erst wenn keine greift, für deine Bestellungen.</p>
      <div className="mt-3 grid gap-4 md:grid-cols-3">
        <label className="grid gap-1 text-xs text-slate-400">Standard für alle Lieferanten{actionSelect(form.exhaustedAction, (value) => setForm({ ...form, exhaustedAction: value }))}</label>
      </div>
      <div className="mt-4"><span className="text-xs text-slate-400">Abweichend pro Lieferant</span><p className="text-[11px] text-slate-500">Standard gilt für alle; hier einzelne Lieferanten hinzufügen, für die eine andere Erschöpft-Regel gilt.</p>
        <div className="mt-2 grid gap-2">{form.overrides.map((override) => <div key={override.supplierId} className="grid items-center gap-2 md:grid-cols-[1fr_1fr_auto]"><span className="text-sm text-slate-200">{supplierName(override.supplierId)}</span>{actionSelect(override.action, (value) => setForm({ ...form, overrides: form.overrides.map((item) => item.supplierId === override.supplierId ? { ...item, action: value } : item) }))}<Button size="sm" variant="ghost" aria-label="Abweichung entfernen" onClick={() => setForm({ ...form, overrides: form.overrides.filter((item) => item.supplierId !== override.supplierId) })}><X className="h-4 w-4" /></Button></div>)}
          {addOverride === null ? <div><Button size="sm" variant="outline" onClick={() => setAddOverride("")}>+ Lieferant hinzufügen</Button></div> : <div className="flex flex-wrap items-center gap-2"><select className={small} value={addOverride} onChange={(event) => setAddOverride(event.target.value)}><option value="">Lieferant wählen …</option>{suppliers.filter((supplier) => !form.overrides.some((item) => item.supplierId === supplier.id)).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.label}</option>)}</select><Button size="sm" variant="outline" disabled={!addOverride} onClick={() => { setForm({ ...form, overrides: [...form.overrides, { supplierId: Number(addOverride), action: form.exhaustedAction === "return" ? "release" : "return" }] }); setAddOverride(null); }}>Hinzufügen</Button><Button size="sm" variant="ghost" onClick={() => setAddOverride(null)}>Abbrechen</Button></div>}</div></div>
    </div>
    <div className="mt-4"><Button className="flux-button" disabled={pending || form.name.trim().length < 2} onClick={() => onSave({ name: form.name.trim(), priority: Math.max(1, Number(form.priority) || 1), sellTarget: Math.max(1, Number(form.sellTarget) || 1), dailyCap: form.dailyCap ? Number(form.dailyCap) : null, totalCap: form.totalCap ? Number(form.totalCap) : null, status: form.active ? "aktiv" : "inaktiv", exhaustedAction: form.exhaustedAction, exhaustedOverrides: form.overrides, country: form.country || null, supplierFilterMode: form.supplierFilterMode, supplierIds: form.supplierIds })}>Speichern</Button></div>
  </div>;
}

/* ------------------------------------------------------------------ Station: Reklamationsgründe, Gebiet, seltenere Filter */
/**
 * „Wenn der Kunde reklamiert“: je Grund – darf er ihn nennen, und geht der Lead danach zur nächsten Station oder endet er hier?
 * Jede Änderung wird sofort gespeichert (kein eigener Knopf).
 */
function StationReasons({ stop, onSaved, onAddDefaults, addingDefaults }: { stop: Stop; onSaved: () => void; onAddDefaults: () => void; addingDefaults: boolean }) {
  const [rules, setRules] = useState(stop.rules); const [saved, setSaved] = useState<"" | "speichert" | "gespeichert">("");
  const signature = JSON.stringify(stop.rules);
  useEffect(() => { setRules(stop.rules); }, [signature]); // nach dem Neuladen, z. B. wenn Gründe dazugekommen sind
  const save = trpc.leadops.saveStopRules.useMutation({ onSuccess: () => { setSaved("gespeichert"); onSaved(); }, onError: (error) => { setSaved(""); setRules(stop.rules); toast.error(error.message); } });
  const apply = (next: typeof rules) => { setRules(next); setSaved("speichert"); save.mutate({ stopId: stop.id, rules: next.map((rule) => ({ reasonId: rule.reasonId, allowed: rule.allowed, passOn: rule.passOn })) }); };
  const change = (reasonId: number, patch: Partial<{ allowed: boolean; passOn: boolean }>) => apply(rules.map((rule) => rule.reasonId === reasonId ? { ...rule, ...patch } : rule));
  const missing = missingDefaultReasons(rules.map((rule) => rule.name)).length;
  return <section className="lk-reasons" aria-label={`Reklamationsgründe für ${stop.buyerCompany}`}>
    <header><div><h4>Wenn der Kunde reklamiert</h4><p>Links: Darf er diesen Grund nennen? Rechts: Geht der Lead danach zur nächsten Station – oder endet er hier?</p></div>
      {rules.length > 1 && <span className="lk-reasons-tools"><button type="button" onClick={() => apply(rules.map((rule) => ({ ...rule, passOn: true })))}>alle weitergeben</button><button type="button" onClick={() => apply(rules.map((rule) => ({ ...rule, passOn: false })))}>alle enden hier</button></span>}</header>
    {rules.length ? <ul className="lk-reason-list">{rules.map((rule) => <li key={rule.reasonId} className={rule.allowed ? "" : "is-off"}>
      <span className="lk-reason-name">{rule.name}</span>
      <label className="lk-reason-allow"><Switch checked={rule.allowed} onCheckedChange={(checked) => change(rule.reasonId, { allowed: checked })} aria-label={`${rule.name} erlaubt`} /><span>{rule.allowed ? "erlaubt" : "nicht erlaubt"}</span></label>
      <span className="lk-seg is-small" role="group" aria-label={`${rule.name}: danach`}><button type="button" aria-pressed={rule.passOn} onClick={() => { if (!rule.passOn) change(rule.reasonId, { passOn: true }); }}><ArrowRight aria-hidden="true" />weitergeben</button><button type="button" aria-pressed={!rule.passOn} onClick={() => { if (rule.passOn) change(rule.reasonId, { passOn: false }); }}>Lead endet hier</button></span>
    </li>)}</ul> : <p className="lk-reasons-empty">Es sind noch keine Reklamationsgründe angelegt.</p>}
    <footer>{missing > 0 && <Button variant="outline" size="sm" disabled={addingDefaults} onClick={onAddDefaults}>{rules.length ? `${missing} Standard-Gründe ergänzen` : "Standard-Gründe anlegen"}</Button>}<a href="/?page=Einstellungen&setting=Reklamationen">Gründe umbenennen oder ergänzen</a><span className="lk-saved" role="status">{saved === "speichert" ? "wird gespeichert …" : saved === "gespeichert" ? "Gespeichert" : ""}</span></footer>
  </section>;
}

type GeoForm = { country: string; mode: Stop["geoMode"]; values: string[]; filters: Stop["fieldFilters"]; excludedSuppliers: number[]; excludedBuyers: number[]; automationDuplicates: boolean; phoneFilter: Stop["phoneFilter"]; ageValue: string; ageUnit: string };
const geoForm = (stop: Stop): GeoForm => ({ country: stop.geoCountry ?? "DE", mode: stop.geoMode, values: stop.geoValues, filters: stop.fieldFilters, excludedSuppliers: stop.excludedSupplierIds, excludedBuyers: stop.excludedBuyerUserIds, automationDuplicates: stop.excludeAutomationDuplicates, phoneFilter: stop.phoneFilter, ageValue: stop.maxLeadAgeMinutes ? (stop.maxLeadAgeMinutes % 60 === 0 ? String(stop.maxLeadAgeMinutes / 60) : String(stop.maxLeadAgeMinutes)) : "", ageUnit: stop.maxLeadAgeMinutes && stop.maxLeadAgeMinutes % 60 === 0 ? "stunden" : "minuten" });
const GEO_MODES: Array<{ value: Stop["geoMode"]; label: string }> = [{ value: "landesweit", label: "Landesweit" }, { value: "bundesland", label: "Bundesländer" }, { value: "plz", label: "PLZ-Gebiete" }];

/** Gebiet der Station – und eingeklappt die selteneren Filter (Land, Feld-Filter, Ausschlüsse, Telefonnummern, Alter des Leads). */
function StationSettings({ stop, isOrder, suppliers, buyers, onSaved }: { stop: Stop; isOrder: boolean; suppliers: Detail["suppliers"]; buyers: Detail["buyers"]; onSaved: () => void }) {
  const updateStop = trpc.leadops.updateChainStop.useMutation({ onSuccess: () => { onSaved(); toast.success("Gespeichert."); }, onError: (error) => toast.error(error.message) });
  const initial = useMemo(() => geoForm(stop), [stop]);
  const [geo, setGeo] = useState<GeoForm>(initial); const [moreOpen, setMoreOpen] = useState(false);
  const [pickSupplier, setPickSupplier] = useState(""); const [pickBuyer, setPickBuyer] = useState("");
  const dirty = JSON.stringify(geo) !== JSON.stringify(initial);
  const supplierName = (id: number) => suppliers.find((supplier) => supplier.id === id)?.label ?? `Lieferant #${id}`;
  const buyerName = (id: number) => buyers.find((buyer) => buyer.userId === id)?.label ?? `Käufer #${id}`;
  const save = () => updateStop.mutate({ id: stop.id, geoCountry: geo.country || null, geoMode: geo.mode, geoValues: geo.values, fieldFilters: geo.filters.filter((filter) => filter.field.trim()), excludedSupplierIds: geo.excludedSuppliers, excludedBuyerUserIds: geo.excludedBuyers, excludeAutomationDuplicates: geo.automationDuplicates, phoneFilter: geo.phoneFilter, maxLeadAgeMinutes: geo.ageValue ? Math.max(1, Math.round(Number(geo.ageValue) * (geo.ageUnit === "stunden" ? 60 : 1))) : null });
  const area = <div className="lk-area">
    <h4>{isOrder ? "Gebiet dieser Station zusätzlich eingrenzen" : "Gebiet dieses Kunden"}</h4>
    <p>{isOrder ? "Das Gebiet kommt aus der Bestellung. Nur wenn Station 1 noch enger gefasst sein soll, stellst du es hier ein." : "Passt ein Lead nicht hinein, bekommt ihn dieser Kunde nicht – der Lead geht zur nächsten Station."}</p>
    <span className="lk-seg" role="group" aria-label="Gebiet">{GEO_MODES.map((item) => <button key={item.value} type="button" aria-pressed={geo.mode === item.value} onClick={() => { if (geo.mode !== item.value) setGeo({ ...geo, mode: item.value, values: [] }); }}>{item.label}</button>)}</span>
    {geo.mode === "bundesland" && <div className="lk-chips">{STATES.map((state) => { const active = geo.values.includes(state); return <button key={state} type="button" className={`lk-chip ${active ? "is-on" : ""}`} aria-pressed={active} onClick={() => setGeo({ ...geo, values: active ? geo.values.filter((item) => item !== state) : [...geo.values, state] })}>{state}</button>; })}</div>}
    {geo.mode === "plz" && <label className="lk-area-plz">Anfänge der Postleitzahlen, mit Komma getrennt<Input value={geo.values.join(", ")} onChange={(event) => setGeo({ ...geo, values: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="10, 12, 60" /></label>}
  </div>;
  return <section className="lk-station-settings">
    {!isOrder && area}
    <button type="button" className="lk-more-toggle" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}><ChevronRight className={moreOpen ? "is-open" : ""} aria-hidden="true" /><span><b>Mehr Einstellungen</b><small>Land, Feld-Filter, Ausschlüsse, Telefonnummern, Alter des Leads</small></span></button>
    {moreOpen && <div className="lk-more">
      {isOrder && area}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-xs text-slate-400">Land<select className={field} value={geo.country} onChange={(event) => setGeo({ ...geo, country: event.target.value })}>{COUNTRIES.filter((country) => country.value).map((country) => <option key={country.value} value={country.value}>{country.label}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-slate-400">Telefonnummern<select className={field} value={geo.phoneFilter} onChange={(event) => setGeo({ ...geo, phoneFilter: event.target.value as GeoForm["phoneFilter"] })}><option value="all">Alle Kontakte (Standard)</option><option value="exclude_invalid">Nur eindeutig ungültige Nummern ausschließen</option><option value="only_valid">Nur bestätigt gültige Nummern – ungeprüfte fallen auch raus</option></select></label>
        <label className="grid gap-1 text-xs text-slate-400">Höchstes Alter des Leads (ab Import)<span className="flex gap-2"><Input type="number" min={1} value={geo.ageValue} placeholder="egal" onChange={(event) => setGeo({ ...geo, ageValue: event.target.value })} /><select className={field} value={geo.ageUnit} onChange={(event) => setGeo({ ...geo, ageUnit: event.target.value })}><option value="minuten">Minuten</option><option value="stunden">Stunden</option></select></span></label>
        <label className="flex items-start gap-2 text-xs text-slate-400"><Switch checked={geo.automationDuplicates} onCheckedChange={(checked) => setGeo({ ...geo, automationDuplicates: checked })} aria-label="Automation-Duplikate ausschließen" /><span><span className="block text-sm text-slate-200">Automation-Duplikate ausschließen</span>Leads, die eine Automation kopiert hat, gehen nicht an diese Station.</span></label>
      </div>
      <div><span className="text-xs text-slate-400">Feld-Filter</span><p className="text-[11px] text-slate-500">Nur Leads, deren Felder diese Bedingungen erfüllen.</p>
        <div className="mt-1 grid gap-2">{geo.filters.map((filter, index) => <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]"><Input value={filter.field} placeholder="Feld (z. B. heizungsart)" onChange={(event) => setGeo({ ...geo, filters: geo.filters.map((item, i) => i === index ? { ...item, field: event.target.value } : item) })} /><select className={field} value={filter.op} onChange={(event) => setGeo({ ...geo, filters: geo.filters.map((item, i) => i === index ? { ...item, op: event.target.value as typeof filter.op } : item) })}>{FILTER_OPS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}</select><Input value={filter.value ?? ""} placeholder="Wert" disabled={filter.op === "gesetzt" || filter.op === "leer"} onChange={(event) => setGeo({ ...geo, filters: geo.filters.map((item, i) => i === index ? { ...item, value: event.target.value } : item) })} /><Button size="sm" variant="ghost" aria-label="Filter entfernen" onClick={() => setGeo({ ...geo, filters: geo.filters.filter((_, i) => i !== index) })}><X className="h-4 w-4" /></Button></div>)}<div><Button size="sm" variant="outline" onClick={() => setGeo({ ...geo, filters: [...geo.filters, { field: "", op: "gleich", value: "" }] })}>Filter hinzufügen</Button></div></div></div>
      <div className="grid gap-3 md:grid-cols-2">
        <div><span className="text-xs text-slate-400">Lieferanten ausschließen</span><p className="text-[11px] text-slate-500">Leads dieser Lieferanten gehen nicht an diese Station.</p><div className="mt-1 flex flex-wrap items-center gap-1.5">{geo.excludedSuppliers.map((id) => <span key={id} className="lk-pick">{supplierName(id)}<button type="button" aria-label="Entfernen" onClick={() => setGeo({ ...geo, excludedSuppliers: geo.excludedSuppliers.filter((item) => item !== id) })}><X /></button></span>)}<select className={small} value={pickSupplier} onChange={(event) => { const id = Number(event.target.value); if (id) setGeo({ ...geo, excludedSuppliers: [...geo.excludedSuppliers, id] }); setPickSupplier(""); }}><option value="">+ Lieferant</option>{suppliers.filter((supplier) => !geo.excludedSuppliers.includes(supplier.id)).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.label}</option>)}</select></div></div>
        <div><span className="text-xs text-slate-400">Nicht, wenn der Kontakt schon bei diesen Kunden liegt</span><p className="text-[11px] text-slate-500">Die Station wird übersprungen, wenn einer dieser Kunden den Kontakt schon bekommen hat.</p><div className="mt-1 flex flex-wrap items-center gap-1.5">{geo.excludedBuyers.map((id) => <span key={id} className="lk-pick">{buyerName(id)}<button type="button" aria-label="Entfernen" onClick={() => setGeo({ ...geo, excludedBuyers: geo.excludedBuyers.filter((item) => item !== id) })}><X /></button></span>)}<select className={small} value={pickBuyer} onChange={(event) => { const id = Number(event.target.value); if (id) setGeo({ ...geo, excludedBuyers: [...geo.excludedBuyers, id] }); setPickBuyer(""); }}><option value="">+ Kunde</option>{buyers.filter((buyer) => buyer.userId !== stop.buyerUserId && !geo.excludedBuyers.includes(buyer.userId)).map((buyer) => <option key={buyer.userId} value={buyer.userId}>{buyer.label}</option>)}</select></div></div>
      </div>
    </div>}
    {(dirty || moreOpen || !isOrder) && <div className="lk-settings-foot"><Button variant="outline" size="sm" disabled={updateStop.isPending || !dirty} onClick={save}>{isOrder ? "Einstellungen speichern" : "Gebiet und Einstellungen speichern"}</Button>{dirty && <span>Noch nicht gespeichert</span>}</div>}
  </section>;
}

/* ------------------------------------------------------------------ Aktivität je Stop */
function StopActivity({ stop, range }: { stop: Stop; range: Range }) {
  const [open, setOpen] = useState(false); const [showAll, setShowAll] = useState(false);
  const all = trpc.leadops.listStopDeliveries.useQuery({ stopId: stop.id, range }, { enabled: showAll, retry: false });
  const rows: Array<Pick<StopDelivery, "deliveryId" | "publicId" | "name" | "city" | "status" | "info" | "occurredAt">> = showAll && all.data ? all.data : stop.activity.recent;
  const summary = [`${stop.stats.total} zugestellt`, `${stop.stats.accepted} angenommen`, stop.stats.reclaimed ? `${stop.stats.reclaimed} reklamiert` : null, stop.stats.duplicates ? `${stop.stats.duplicates} Dublette` : null, stop.stats.skipped ? `${stop.stats.skipped} übersprungen` : null].filter(Boolean).join(" · ");
  return <div className="rounded-lg border border-white/10 bg-slate-950/30">
    <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}<span className="w-5 font-mono text-sm text-slate-400">{stop.position}</span><span className="flex-1"><span className="block text-sm font-medium text-slate-100">{stop.buyerCompany}{stop.buyerContact && <span className="text-slate-400"> — {stop.buyerContact}</span>}</span><span className="block text-xs text-slate-500">{summary}</span></span></button>
    {open && <div className="border-t border-white/8 px-3 py-2">{!rows.length ? <p className="py-2 text-sm text-slate-500">Noch keine Leads an diesem Stop.</p> : <ul className="divide-y divide-white/6">{rows.map((row) => <li key={row.deliveryId} className="flex flex-wrap items-center gap-2 py-2 text-sm"><a className="font-medium text-violet-200 hover:underline" href={row.publicId ? `/?page=Leads&lead=${encodeURIComponent(row.publicId)}` : `/?page=Leads&search=${encodeURIComponent(row.name)}`}>{row.name}</a>{row.city && <span className="text-xs text-slate-500">{row.city}</span>}<Badge variant="outline" className={statusBadge(row.status)}>{statusLabel[row.status] ?? row.status}</Badge>{row.info && <span className="text-xs text-slate-400">· {row.info}</span>}<span className="ml-auto text-xs text-slate-500">{stamp(row.occurredAt)}</span></li>)}</ul>}
      {stop.activity.total > rows.length && !showAll && <Button size="sm" variant="outline" className="mt-2" onClick={() => setShowAll(true)}>Alle {stop.activity.total} anzeigen</Button>}{showAll && all.isLoading && <p className="mt-2 text-xs text-slate-500">Wird geladen …</p>}</div>}
  </div>;
}
