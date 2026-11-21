import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { ArrowDown, ArrowRight, ArrowUp, ChevronDown, ChevronRight, GripVertical, Plus, Trash2, UserRoundCog, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { confirmAction } from "@/lib/confirm";
import { ruleSentence, suggestChainName, supplierText } from "../../../shared/chain-rules";

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
const flag = (country: string | null | undefined) => country === "AT" ? "🇦🇹" : country === "CH" ? "🇨🇭" : country === "DE" ? "🇩🇪" : "🌍";
const geoLabel = (stop: Pick<Stop, "geoMode" | "geoValues">) => stop.geoMode === "landesweit" ? "Landesweit" : stop.geoMode === "bundesland" ? `${stop.geoValues.length} Bundesl.` : `PLZ ${stop.geoValues.slice(0, 3).join(", ")}${stop.geoValues.length > 3 ? " …" : ""}`;
const stamp = (value: Date | string) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const statusBadge = (status: string) => status === "angenommen" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : status === "reklamiert" || status === "abgelehnt" ? "border-red-400/25 bg-red-500/10 text-red-200" : status === "übersprungen" ? "border-amber-400/25 bg-amber-500/10 text-amber-200" : "border-white/15 text-slate-300";
const statusLabel: Record<string, string> = { angenommen: "angenommen", reklamiert: "reklamiert", abgelehnt: "abgelehnt", übersprungen: "übersprungen", im_fenster: "im Reklamationsfenster", angeboten: "angeboten" };

export default function ChainWorkspace() {
  const [chainId, setChainId] = useState<number | null>(() => Number(new URLSearchParams(window.location.search).get("chain")) || null);
  const [range, setRange] = useState<Range>("maximal");
  const open = (id: number | null) => { setChainId(id); const params = new URLSearchParams(window.location.search); params.set("page", "Lieferkette"); if (id) params.set("chain", String(id)); else params.delete("chain"); window.history.replaceState(null, "", `/?${params.toString()}`); };
  if (chainId) return <ChainDetailPage chainId={chainId} range={range} setRange={setRange} onBack={() => open(null)} />;
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
  return <div className="fx-scope lk">
    <header className="page-intro compact"><div><span className="eyebrow">ROUTING ENGINE</span><h1>Lieferkette</h1><p>Feste Verteilung: Du legst fest, welche Kategorie von welchen Lieferanten an welche Kunden geht. Die Kunden kommen in fester Reihenfolge dran – es wird nicht abgewechselt.</p></div>
      <div className="flex flex-wrap items-center gap-3"><RangeSelect range={range} setRange={setRange} /><Button className="flux-button" onClick={() => setBuilding(true)} disabled={building}><Plus className="h-4 w-4" /> Neue Lieferkette</Button></div></header>
    {building && <ChainBuilder pickers={pickers.data} pending={createRule.isPending} onCancel={() => setBuilding(false)} onCreate={(values) => createRule.mutate(values)} />}
    {overview.isLoading ? <section className="lk-panel"><p className="lk-empty">Ketten werden geladen …</p></section> : overview.error ? <section className="lk-panel"><p className="lk-empty is-error">{overview.error.message}</p></section> : !groups.length ? <section className="lk-panel"><p className="lk-empty">Noch keine Lieferkette. Lege mit „Neue Lieferkette“ fest, welche Kategorie von welchen Lieferanten an welche Kunden geht.</p></section> :
      groups.map((group) => { const active = group.chains.filter((chain) => chain.status === "aktiv"); const shared = active.some((chain) => chain.before.length > 0); return <section key={group.categoryId} className="lk-panel" aria-label={`Lieferketten für ${group.categoryName}`}>
        <header className="lk-group"><h2>{group.categoryName}</h2><span>{group.chains.length === 1 ? "1 Kette" : `${group.chains.length} Ketten`}{active.length !== group.chains.length ? ` · ${active.length} aktiv` : ""}</span></header>
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
            <span className="lk-stats" title="Geschickt / angenommen / abgelehnt im gewählten Zeitraum"><b>{chain.stats.total}</b> geschickt · <b className="is-good">{chain.stats.accepted}</b> angenommen · <b className="is-bad">{chain.stats.rejected}</b> abgelehnt</span>
            <span className="lk-actions"><Button size="sm" variant="outline" disabled={updateChain.isPending} onClick={() => updateChain.mutate({ id: chain.id, status: chain.status === "aktiv" ? "inaktiv" : "aktiv" })}>{chain.status === "aktiv" ? "Ausschalten" : "Einschalten"}</Button><Button size="sm" variant="outline" onClick={() => onOpen(chain.id)}>Öffnen</Button><Button size="sm" variant="ghost" aria-label={`Kette „${chain.name}“ löschen`} title="Kette löschen" onClick={async () => { if (await confirmAction(`Kette „${chain.name}“ wirklich löschen?`)) deleteChain.mutate({ chainId: chain.id }); }}><Trash2 className="h-4 w-4" /></Button></span>
          </div>
        </li>)}</ol>
      </section>; })}
  </div>;
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
/** Detailseite einer Kette – auch eingebettet in den Bestellungen (Schritt „Lieferkette“), dann ohne Rücksprung und mit kompaktem Kopf. */
export function ChainDetailPage({ chainId, range, setRange, onBack, embedded = false }: { chainId: number; range: Range; setRange: (value: Range) => void; onBack: () => void; embedded?: boolean }) {
  const utils = trpc.useUtils();
  const detail = trpc.leadops.chainDetail.useQuery({ chainId, range }, { retry: false });
  const refresh = () => { utils.leadops.chainDetail.invalidate({ chainId, range }); utils.leadops.chainOverview.invalidate(); utils.leadops.listDeliveryChains.invalidate(); };
  const onError = (error: { message: string }) => toast.error(error.message);
  const updateChain = trpc.leadops.updateDeliveryChain.useMutation({ onSuccess: () => { refresh(); toast.success("Ketten-Einstellungen gespeichert."); }, onError });
  const addStop = trpc.leadops.addChainStop.useMutation({ onSuccess: () => { refresh(); setAdding(null); toast.success("Käufer hinzugefügt."); }, onError });
  const updateStop = trpc.leadops.updateChainStop.useMutation({ onSuccess: refresh, onError });
  const reorder = trpc.leadops.reorderChainStops.useMutation({ onSuccess: refresh, onError });
  const deleteStop = trpc.leadops.deleteChainStop.useMutation({ onSuccess: () => { refresh(); toast.success("Stop gelöscht."); }, onError });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adding, setAdding] = useState<{ buyerUserId: string; buyerName: string; price: string; window: string; max: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [dragId, setDragId] = useState<number | null>(null);
  if (detail.isLoading) return <section className="surface-panel p-6 text-sm text-slate-400">Kette wird geladen …</section>;
  if (detail.error || !detail.data) return <section className="surface-panel p-6 text-sm text-red-200">{detail.error?.message ?? "Kette nicht gefunden."}<div className="mt-3"><Button variant="outline" onClick={onBack}>Zurück zu den Ketten</Button></div></section>;
  const { chain, stops, buyers, suppliers, reasons, activity } = detail.data;
  const fromText = supplierText(chain.supplierFilterMode, chain.supplierIds.map((id) => suppliers.find((supplier) => supplier.id === id)?.label.split(" — ")[0] ?? `Lieferant #${id}`));
  const moveStop = (stopId: number, direction: -1 | 1) => { const ids = stops.map((stop) => stop.id); const index = ids.indexOf(stopId); const target = index + direction; if (target < 0 || target >= ids.length) return; [ids[index], ids[target]] = [ids[target], ids[index]]; reorder.mutate({ chainId, stopIds: ids }); };
  const dropOn = (targetId: number) => { if (dragId === null || dragId === targetId) return; const ids = stops.map((stop) => stop.id); const from = ids.indexOf(dragId); const to = ids.indexOf(targetId); ids.splice(from, 1); ids.splice(to, 0, dragId); setDragId(null); reorder.mutate({ chainId, stopIds: ids }); };
  return <>
    {!embedded && <button type="button" className="mb-3 text-sm text-violet-200 hover:underline" onClick={onBack}>← Zurück zu den Ketten</button>}
    {embedded ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><span className="eyebrow">LIEFERKETTE DER BESTELLUNG</span><h2 className="text-lg font-semibold text-slate-100">{chain.name}</h2><p className="text-xs text-slate-500">Die Stops werden von oben nach unten abgelaufen – gleiche Einstellungen wie auf der Seite „Lieferkette“.</p></div><div className="flex items-center gap-3"><RangeSelect range={range} setRange={setRange} /><Badge variant="outline" className={chain.status === "aktiv" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-white/15 text-slate-400"}>{chain.status === "aktiv" ? "Aktiv" : "Inaktiv"}</Badge></div></div>
    : <header className="page-intro compact"><div><span className="eyebrow">LIEFERKETTE</span><h1>{chain.name}</h1><p>Feste Reihenfolge: Die Kunden kommen von oben nach unten dran – es wird nicht abgewechselt.</p></div><div className="flex items-center gap-3"><RangeSelect range={range} setRange={setRange} /><Badge variant="outline" className={chain.status === "aktiv" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-white/15 text-slate-400"}>{chain.status === "aktiv" ? "Aktiv" : "Inaktiv"}</Badge></div></header>}

    <section className="fx-scope lk-rule" aria-label="Regel dieser Kette">
      <div className="lk-flow"><span className="lk-from"><small>Kategorie</small><b>{chain.categoryName}</b></span><ArrowRight className="lk-arrow" aria-hidden="true" /><span className="lk-from"><small>Von</small><b>{fromText}</b>{chain.country && <i>nur {chain.country}</i>}</span><ArrowRight className="lk-arrow" aria-hidden="true" /><span className="lk-to"><small>An</small>{stops.length ? <span className="lk-buyers">{stops.map((stop) => <span key={stop.id} className={`lk-buyer ${stop.active ? "" : "is-off"}`}><em>{stop.position}</em>{stop.buyerCompany}</span>)}</span> : <b className="lk-missing">Noch kein Kunde</b>}</span></div>
      <p className="lk-sentence"><span>So wird verteilt</span>{ruleSentence([chain.categoryName], fromText, stops.filter((stop) => stop.active).map((stop) => stop.buyerCompany))}</p>
    </section>

    <section className="surface-panel mb-4 overflow-hidden">
      <button type="button" className="flex w-full items-center justify-between px-5 py-4 text-left" onClick={() => setSettingsOpen((value) => !value)} aria-expanded={settingsOpen}><span className="flex items-center gap-2 text-sm font-semibold text-slate-100">{settingsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Ketten-Einstellungen</span><Badge variant="outline" className="border-violet-400/30 bg-violet-500/10 text-violet-100">{chain.categoryName}</Badge></button>
      {settingsOpen && <ChainSettingsForm chain={chain} suppliers={suppliers} pending={updateChain.isPending} onSave={(values) => updateChain.mutate({ id: chain.id, ...values })} />}
    </section>

    <section className="surface-panel mb-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">Pro Käufer: ges. = geschickt · ang. = angenommen · abg. = abgelehnt · dann Annahmerate (angenommen ÷ entschieden)</p><Button className="flux-button" onClick={() => setAdding({ buyerUserId: String(buyers[0]?.userId ?? ""), buyerName: "", price: "0", window: "24", max: "" })}><Plus className="h-4 w-4" /> Käufer hinzufügen</Button></div>
      {adding && <div className="mt-4 grid gap-3 rounded-lg border border-violet-400/25 p-4 md:grid-cols-[1.6fr_1fr_.6fr_.6fr_.6fr_auto]">
        <label className="grid gap-1 text-xs text-slate-400">Käufer-Konto<select className={field} value={adding.buyerUserId} onChange={(event) => setAdding({ ...adding, buyerUserId: event.target.value })}><option value="">Ohne Konto (nur Name)</option>{buyers.map((buyer) => <option key={buyer.userId} value={buyer.userId}>{buyer.label}{buyer.api ? " · API" : ""}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-slate-400">Käufername (optional)<Input value={adding.buyerName} onChange={(event) => setAdding({ ...adding, buyerName: event.target.value })} placeholder="Anzeigename" /></label>
        <label className="grid gap-1 text-xs text-slate-400">Preis €<Input type="number" min={0} step="0.01" value={adding.price} onChange={(event) => setAdding({ ...adding, price: event.target.value })} /></label>
        <label className="grid gap-1 text-xs text-slate-400">Fenster h<Input type="number" min={0} value={adding.window} onChange={(event) => setAdding({ ...adding, window: event.target.value })} /></label>
        <label className="grid gap-1 text-xs text-slate-400">Max. Leads<Input type="number" min={1} value={adding.max} placeholder="max" onChange={(event) => setAdding({ ...adding, max: event.target.value })} /></label>
        <div className="flex items-end gap-2"><Button className="flux-button" disabled={addStop.isPending || (!adding.buyerUserId && adding.buyerName.trim().length < 2)} onClick={() => addStop.mutate({ chainId, buyerUserId: adding.buyerUserId ? Number(adding.buyerUserId) : null, buyerName: adding.buyerName.trim() || null, unitPrice: Number(adding.price) || 0, reclamationWindowHours: Math.max(0, Number(adding.window) || 0), maxLeads: adding.max ? Number(adding.max) : null })}>Hinzufügen</Button><Button variant="outline" onClick={() => setAdding(null)}>Abbrechen</Button></div></div>}
      {!stops.length ? <p className="mt-4 text-sm text-slate-400">Noch kein Stop. Füge den ersten Käufer hinzu.</p> : <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-2">
        {stops.map((stop, index) => <div key={stop.id} className={`min-w-0 rounded-lg border ${dragId === stop.id ? "border-violet-400/60" : "border-white/10"} bg-slate-950/30`} draggable onDragStart={() => setDragId(stop.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(stop.id)} onDragEnd={() => setDragId(null)}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:min-w-[320px] sm:flex-nowrap">
              <button type="button" className="cursor-grab text-slate-500" title="Verschieben (ziehen oder Pfeile)"><GripVertical className="h-4 w-4" /></button>
              <span className="flex flex-col"><button type="button" className="text-slate-500 hover:text-slate-200 disabled:opacity-30" disabled={index === 0} aria-label="Nach oben" onClick={() => moveStop(stop.id, -1)}><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" className="text-slate-500 hover:text-slate-200 disabled:opacity-30" disabled={index === stops.length - 1} aria-label="Nach unten" onClick={() => moveStop(stop.id, 1)}><ArrowDown className="h-3.5 w-3.5" /></button></span>
              <span className="w-5 text-center font-mono text-sm text-slate-400">{stop.position}</span>
              <button type="button" className="text-slate-400 hover:text-slate-100" aria-label="Stop-Details" aria-expanded={Boolean(expanded[stop.id])} onClick={() => setExpanded({ ...expanded, [stop.id]: !expanded[stop.id] })}>{expanded[stop.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-500/15 text-xs font-semibold text-violet-100">{stop.buyerCompany.slice(0, 2).toUpperCase()}</span>
              <span className="min-w-[150px] flex-1 truncate text-sm font-medium text-slate-100" title={stop.buyerLabel}>{stop.buyerCompany}{stop.buyerContact && <span className="text-slate-400"> — {stop.buyerContact}</span>}</span>
              {stop.api && <Badge variant="outline" className="border-sky-400/25 bg-sky-500/10 text-sky-200" title="Liefert per API-Call (extern hinterlegt)">API</Badge>}
              {stop.membershipId && <a className="text-slate-400 hover:text-slate-100" href={`/?page=Benutzer&member=${stop.membershipId}`} title="Zum Käufer-Account" aria-label="Zum Käufer-Account"><UserRoundCog className="h-4 w-4" /></a>}
              <Badge variant="outline" className="shrink-0 border-white/15 text-slate-300" title={`Geo-Targeting: ${geoLabel(stop)}`}>{flag(stop.geoCountry)} {geoLabel(stop)}</Badge>
            </div>
            <div className="flex basis-full flex-wrap items-center justify-end gap-2 pl-2 sm:flex-nowrap sm:whitespace-nowrap sm:pl-8 2xl:basis-auto 2xl:pl-0">
              <span className="whitespace-nowrap font-mono text-xs" title={`${stop.stats.total} geschickt · ${stop.stats.accepted} angenommen · ${stop.stats.rejected} abgelehnt · Annahmerate ${stop.stats.acceptanceRate ?? "–"} % (angenommen ÷ entschieden)`}><span className="text-slate-400">{stop.stats.total} GES.</span> <span className="text-emerald-300">{stop.stats.accepted} ANG.</span> <span className="text-red-300">{stop.stats.rejected} ABG.</span> <span className="ml-1 text-slate-100">{stop.stats.acceptanceRate === null ? "–" : `${stop.stats.acceptanceRate} %`}</span></span>
              <StopNumber label="€" value={stop.unitPrice} step="0.01" width="w-20" onCommit={(value) => updateStop.mutate({ id: stop.id, unitPrice: Number(value) || 0 })} />
              <StopNumber label="h" value={String(stop.reclamationWindowHours)} width="w-14" title="Reklamationsfenster in Stunden (0 = sofort angenommen)" onCommit={(value) => updateStop.mutate({ id: stop.id, reclamationWindowHours: Math.max(0, Number(value) || 0) })} />
              <StopNumber label="" value={stop.maxLeads ? String(stop.maxLeads) : ""} width="w-16" placeholder="max" title="Max. Leads für diesen Käufer (leer = unbegrenzt)" onCommit={(value) => updateStop.mutate({ id: stop.id, maxLeads: value ? Number(value) : null })} />
              <label className="flex items-center gap-1.5 text-xs text-slate-400" title="Stop aktiv – erhält Leads"><Switch checked={stop.active} onCheckedChange={(checked) => updateStop.mutate({ id: stop.id, active: checked })} aria-label="Stop aktiv" />{stop.active ? "An" : "Aus"}</label>
              <Button size="sm" variant="ghost" aria-label="Stop löschen" title="Stop löschen" onClick={async () => { if (await confirmAction(`Stop „${stop.buyerCompany}“ löschen?`)) deleteStop.mutate({ stopId: stop.id }); }}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
          {expanded[stop.id] && <StopDetails stop={stop} reasons={reasons} suppliers={suppliers} buyers={buyers} onSaved={refresh} />}
        </div>)}
      </div>}
    </section>

    <section className="surface-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold text-slate-100">Aktivität</h2><span className="text-sm text-slate-400">{activity.delivered} zugestellt · {activity.inTransit} gerade unterwegs</span></div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2">{stops.map((stop) => <StopActivity key={stop.id} stop={stop} range={range} />)}{!stops.length && <p className="text-sm text-slate-500">Noch keine Aktivität.</p>}</div>
    </section>
  </>;
}

function StopNumber({ label, value, onCommit, width, step, placeholder, title }: { label: string; value: string; onCommit: (value: string) => void; width: string; step?: string; placeholder?: string; title?: string }) {
  const [draft, setDraft] = useState(value); const [editing, setEditing] = useState(false);
  const shown = editing ? draft : value;
  return <label className="flex items-center gap-1 text-xs text-slate-500" title={title}><Input type="text" inputMode="decimal" className={`${width} h-9 px-2 text-right`} value={shown} placeholder={placeholder} onFocus={() => { setDraft(value); setEditing(true); }} onChange={(event) => setDraft(event.target.value)} onBlur={() => { setEditing(false); if (draft !== value) onCommit(draft); }} onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} />{label}</label>;
}

/* ------------------------------------------------------------------ Ketten-Einstellungen */
function ChainSettingsForm({ chain, suppliers, pending, onSave }: { chain: Detail["chain"]; suppliers: Detail["suppliers"]; pending: boolean; onSave: (values: { name: string; priority: number; sellTarget: number; dailyCap: number | null; totalCap: number | null; status: "aktiv" | "inaktiv"; exhaustedAction: "return" | "release"; exhaustedOverrides: Array<{ supplierId: number; action: "return" | "release" }>; country: string | null; supplierFilterMode: "all" | "include" | "exclude"; supplierIds: number[] }) => void }) {
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
      <p className="mt-1 text-xs leading-5 text-slate-500">Die Kategorie steht fest ({chain.categoryName}). Hier legst du fest, von welchen Lieferanten die Leads kommen dürfen – und aus welchem Land.</p>
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

/* ------------------------------------------------------------------ Stop-Details: Reklamationsgründe + Geo/Filter */
function StopDetails({ stop, reasons, suppliers, buyers, onSaved }: { stop: Stop; reasons: Detail["reasons"]; suppliers: Detail["suppliers"]; buyers: Detail["buyers"]; onSaved: () => void }) {
  const onError = (error: { message: string }) => toast.error(error.message);
  const saveRules = trpc.leadops.saveStopRules.useMutation({ onSuccess: () => { onSaved(); toast.success("Reklamationsgründe gespeichert."); }, onError });
  const updateStop = trpc.leadops.updateChainStop.useMutation({ onSuccess: () => { onSaved(); toast.success("Geo-Targeting und Filter gespeichert."); }, onError });
  const [rules, setRules] = useState(stop.rules);
  const [geo, setGeo] = useState({ country: stop.geoCountry ?? "DE", mode: stop.geoMode, values: stop.geoValues, filters: stop.fieldFilters, excludedSuppliers: stop.excludedSupplierIds, excludedBuyers: stop.excludedBuyerUserIds, automationDuplicates: stop.excludeAutomationDuplicates, phoneFilter: stop.phoneFilter, ageValue: stop.maxLeadAgeMinutes ? (stop.maxLeadAgeMinutes % 60 === 0 ? String(stop.maxLeadAgeMinutes / 60) : String(stop.maxLeadAgeMinutes)) : "", ageUnit: stop.maxLeadAgeMinutes && stop.maxLeadAgeMinutes % 60 === 0 ? "stunden" : "minuten" });
  const [pickSupplier, setPickSupplier] = useState(""); const [pickBuyer, setPickBuyer] = useState("");
  const toggleRule = (reasonId: number, key: "allowed" | "passOn", value: boolean) => setRules(rules.map((rule) => rule.reasonId === reasonId ? { ...rule, [key]: value } : rule));
  const dirtyRules = useMemo(() => JSON.stringify(rules) !== JSON.stringify(stop.rules), [rules, stop.rules]);
  const supplierName = (id: number) => suppliers.find((supplier) => supplier.id === id)?.label ?? `Lieferant #${id}`;
  const buyerName = (id: number) => buyers.find((buyer) => buyer.userId === id)?.label ?? `Käufer #${id}`;
  return <div className="border-t border-white/8 px-4 py-4">
    <div className="grid gap-1 text-xs text-slate-400 md:grid-cols-3"><span><strong className="text-slate-200">Liefermodus:</strong> {stop.api ? "API-Call (extern)" : "manuell / Partnerintegration"}</span><span className="truncate" title={stop.endpoint ?? ""}><strong className="text-slate-200">Endpunkt:</strong> {stop.endpoint ?? "— (im Käufer-Account unter Integration hinterlegen)"}</span><span><strong className="text-slate-200">Reklamationsfenster:</strong> {stop.reclamationWindowHours} h → {stop.reclamationWindowHours ? "so lange reklamierbar, danach automatisch angenommen" : "sofort angenommen, keine Reklamation möglich"}</span></div>
    <div className="mt-4 grid gap-5 2xl:grid-cols-2">
      <div><h4 className="text-sm font-semibold text-slate-100">Reklamationsgründe für diesen Käufer</h4>
        <div className="mt-2 max-h-[420px] overflow-auto rounded-lg border border-white/10"><table className="w-full text-sm"><thead className="sticky top-0 bg-slate-950/90"><tr className="text-left text-[10px] uppercase tracking-[.16em] text-slate-500"><th className="px-3 py-2 font-medium">Grund</th><th className="px-3 py-2 font-medium">Erlaubt</th><th className="px-3 py-2 font-medium">Bei Reklamation</th></tr></thead><tbody>{rules.map((rule) => <tr key={rule.reasonId} className="border-t border-white/6"><td className="px-3 py-1.5 text-sm text-slate-200">{rule.name}</td><td className="px-3 py-1.5"><Switch checked={rule.allowed} onCheckedChange={(checked) => toggleRule(rule.reasonId, "allowed", checked)} aria-label={`${rule.name} erlaubt`} /></td><td className="px-3 py-1.5"><span className="flex items-center gap-2"><Switch checked={rule.passOn} onCheckedChange={(checked) => toggleRule(rule.reasonId, "passOn", checked)} aria-label={`${rule.name} weitergeben`} /><span className={`text-xs ${rule.passOn ? "text-amber-300" : "text-slate-500"}`}>{rule.passOn ? "→ weitergeben" : "Lead endet hier"}</span></span></td></tr>)}{!reasons.length && <tr><td colSpan={3} className="px-3 py-2 text-sm text-slate-500">Noch keine Reklamationsgründe angelegt.</td></tr>}</tbody></table></div>
        <p className="mt-2 text-[11px] text-slate-500">Erlaubt: ob der Käufer mit dem Grund reklamieren darf · weitergeben: Lead geht nach der Reklamation an den nächsten Stop, sonst endet er.</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs"><a className="text-violet-200 hover:underline" href="/?page=Einstellungen&setting=Reklamationen">Gründe anlegen / umbenennen</a>{stop.membershipId && <a className="text-violet-200 hover:underline" href={`/?page=Benutzer&member=${stop.membershipId}&tab=integration`}>API-Endpunkt dieses Käufers konfigurieren</a>}<Button size="sm" className="flux-button ml-auto" disabled={!dirtyRules || saveRules.isPending} onClick={() => saveRules.mutate({ stopId: stop.id, rules: rules.map((rule) => ({ reasonId: rule.reasonId, allowed: rule.allowed, passOn: rule.passOn })) })}>Gründe speichern</Button></div></div>
      <div><h4 className="text-sm font-semibold text-slate-100">Geo-Targeting für diesen Stop</h4>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-xs text-slate-400">Land<select className={field} value={geo.country} onChange={(event) => setGeo({ ...geo, country: event.target.value })}>{COUNTRIES.filter((country) => country.value).map((country) => <option key={country.value} value={country.value}>{country.label}</option>)}</select></label>
          <label className="grid gap-1 text-xs text-slate-400">Geo-Modus<select className={field} value={geo.mode} onChange={(event) => setGeo({ ...geo, mode: event.target.value as typeof geo.mode, values: [] })}><option value="landesweit">Landesweit</option><option value="bundesland">Bundesländer</option><option value="plz">PLZ-Gebiete (Anfang)</option></select></label>
        </div>
        {geo.mode === "bundesland" && <div className="mt-2 flex flex-wrap gap-1.5">{STATES.map((state) => { const active = geo.values.includes(state); return <button key={state} type="button" className={`choice-chip rounded-full border px-2.5 py-1 text-xs ${active ? "selected border-violet-400/40 bg-violet-500/15 text-violet-100" : "border-white/10 text-slate-400 hover:text-slate-100"}`} onClick={() => setGeo({ ...geo, values: active ? geo.values.filter((item) => item !== state) : [...geo.values, state] })}>{state}</button>; })}</div>}
        {geo.mode === "plz" && <label className="mt-2 grid gap-1 text-xs text-slate-400">PLZ-Anfänge (mit Komma, z. B. 10, 12, 60)<Input value={geo.values.join(", ")} onChange={(event) => setGeo({ ...geo, values: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="10, 12, 60" /></label>}
        <div className="mt-3"><span className="text-xs text-slate-400">Feld-Filter (optional)</span><p className="text-[11px] text-slate-500">Nur Leads, deren benutzerdefinierte Felder die Bedingungen erfüllen.</p>
          <div className="mt-1 grid gap-2">{geo.filters.map((filter, index) => <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]"><Input value={filter.field} placeholder="Feld (z. B. heizungsart)" onChange={(event) => setGeo({ ...geo, filters: geo.filters.map((item, i) => i === index ? { ...item, field: event.target.value } : item) })} /><select className={field} value={filter.op} onChange={(event) => setGeo({ ...geo, filters: geo.filters.map((item, i) => i === index ? { ...item, op: event.target.value as typeof filter.op } : item) })}>{FILTER_OPS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}</select><Input value={filter.value ?? ""} placeholder="Wert" disabled={filter.op === "gesetzt" || filter.op === "leer"} onChange={(event) => setGeo({ ...geo, filters: geo.filters.map((item, i) => i === index ? { ...item, value: event.target.value } : item) })} /><Button size="sm" variant="ghost" aria-label="Filter entfernen" onClick={() => setGeo({ ...geo, filters: geo.filters.filter((_, i) => i !== index) })}><X className="h-4 w-4" /></Button></div>)}<div><Button size="sm" variant="outline" onClick={() => setGeo({ ...geo, filters: [...geo.filters, { field: "", op: "gleich", value: "" }] })}>+ Filter hinzufügen</Button></div></div></div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div><span className="text-xs text-slate-400">Lieferanten ausschließen</span><p className="text-[11px] text-slate-500">Leads dieser Lieferanten überspringen diesen Stop (keine Lieferung, keine Belastung).</p><div className="mt-1 flex flex-wrap items-center gap-1.5">{geo.excludedSuppliers.map((id) => <span key={id} className="flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-xs text-slate-200">{supplierName(id)}<button type="button" aria-label="Entfernen" onClick={() => setGeo({ ...geo, excludedSuppliers: geo.excludedSuppliers.filter((item) => item !== id) })}><X className="h-3 w-3" /></button></span>)}<select className={small} value={pickSupplier} onChange={(event) => { const id = Number(event.target.value); if (id) setGeo({ ...geo, excludedSuppliers: [...geo.excludedSuppliers, id] }); setPickSupplier(""); }}><option value="">+ Lieferant</option>{suppliers.filter((supplier) => !geo.excludedSuppliers.includes(supplier.id)).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.label}</option>)}</select></div></div>
          <div><span className="text-xs text-slate-400">Käufer ausschließen</span><p className="text-[11px] text-slate-500">Überspringt Stop, wenn der Kontakt bereits bei einem der gewählten Käufer liegt (Konflikt-Käufer).</p><div className="mt-1 flex flex-wrap items-center gap-1.5">{geo.excludedBuyers.map((id) => <span key={id} className="flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-xs text-slate-200">{buyerName(id)}<button type="button" aria-label="Entfernen" onClick={() => setGeo({ ...geo, excludedBuyers: geo.excludedBuyers.filter((item) => item !== id) })}><X className="h-3 w-3" /></button></span>)}<select className={small} value={pickBuyer} onChange={(event) => { const id = Number(event.target.value); if (id) setGeo({ ...geo, excludedBuyers: [...geo.excludedBuyers, id] }); setPickBuyer(""); }}><option value="">+ Käufer</option>{buyers.filter((buyer) => buyer.userId !== stop.buyerUserId && !geo.excludedBuyers.includes(buyer.userId)).map((buyer) => <option key={buyer.userId} value={buyer.userId}>{buyer.label}</option>)}</select></div></div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="flex items-start gap-2 text-xs text-slate-400"><Switch checked={geo.automationDuplicates} onCheckedChange={(checked) => setGeo({ ...geo, automationDuplicates: checked })} aria-label="Automation-Duplikate ausschließen" /><span><span className="block text-sm text-slate-200">Automation-Duplikate ausschließen</span>Per Automation duplizierte Leads (geringere Qualität) hier nicht ausliefern.</span></label>
          <label className="grid gap-1 text-xs text-slate-400">Telefonnummern-Filter<select className={field} value={geo.phoneFilter} onChange={(event) => setGeo({ ...geo, phoneFilter: event.target.value as typeof geo.phoneFilter })}><option value="all">Alle Kontakte (Standard)</option><option value="exclude_invalid">Nur eindeutig ungültige Nummern ausschließen</option><option value="only_valid">Nur bestätigt gültige Nummern — auch ungeprüfte und unbekannte fallen raus</option></select></label>
          <label className="grid gap-1 text-xs text-slate-400">Max. Lead-Alter (ab Import)<span className="flex gap-2"><Input type="number" min={1} value={geo.ageValue} placeholder="∞" onChange={(event) => setGeo({ ...geo, ageValue: event.target.value })} /><select className={field} value={geo.ageUnit} onChange={(event) => setGeo({ ...geo, ageUnit: event.target.value })}><option value="minuten">Minuten</option><option value="stunden">Stunden</option></select></span><span className="text-[11px] text-slate-500">Zu alt → Stop übersprungen.</span></label>
        </div>
        <div className="mt-3 flex items-center gap-3"><Button className="flux-button" disabled={updateStop.isPending} onClick={() => updateStop.mutate({ id: stop.id, geoCountry: geo.country || null, geoMode: geo.mode, geoValues: geo.values, fieldFilters: geo.filters.filter((filter) => filter.field.trim()), excludedSupplierIds: geo.excludedSuppliers, excludedBuyerUserIds: geo.excludedBuyers, excludeAutomationDuplicates: geo.automationDuplicates, phoneFilter: geo.phoneFilter, maxLeadAgeMinutes: geo.ageValue ? Math.max(1, Math.round(Number(geo.ageValue) * (geo.ageUnit === "stunden" ? 60 : 1))) : null })}>Geo speichern</Button><span className="text-[11px] text-slate-500">Passt der Lead nicht, wird dieser Stop übersprungen (keine Lieferung, keine Belastung).</span></div>
      </div>
    </div>
  </div>;
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
