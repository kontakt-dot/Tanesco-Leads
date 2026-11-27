import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { ArrowRight, CalendarClock, Infinity as Unlimited, LayoutGrid, Pencil, Route, Rows3, Trash2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { toast } from "sonner";
import { confirmAction } from "@/lib/confirm";
import { categoryColor } from "@/lib/colors";
import { orderStatusChoice } from "../../../shared/order-status";
import { nameInitials } from "../../../shared/lead-age";
import { orderRoutes, routeEnd, routeSentence, routeShort, type OrderRoute } from "../../../shared/order-route";

type OrderOverviewProps = {
  categories: Array<{ id: number; name: string; shortcode?: string | null; color?: string | null }>;
  order?: unknown;
  form?: unknown;
  suppliers?: unknown;
  chainCount?: number;
  onEdit?: () => void;
  onAddChain?: () => void;
};

function orderEditLink(orderId: number) {
  const params = new URLSearchParams(window.location.search);
  params.set("page", "Bestellungen");
  params.set("orderId", String(orderId));
  params.delete("overview");
  return `/?${params.toString()}`;
}

/** Die Bestellung öffnen und gleich die Lieferkette zeigen (Schritt 2). */
const orderChainLink = (orderId: number) => `${orderEditLink(orderId)}&kette=1`;

function formatMoney(value: number) { return value.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }); }
const price = (value: number) => value.toLocaleString("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 });

/**
 * Wohin die Leads einer Bestellung gehen (seit v379): die Lieferkette als Zeile unter der Bestellung – Station 1 ist die Bestellung, danach
 * die weiteren Stationen der Reihe nach, am Ende, was mit einem Lead passiert, den niemand nimmt. Haben die Leadsparten verschiedene Ketten,
 * steht je Weg eine Zeile; Sparten mit demselben Weg stehen zusammen.
 */
function OrderRouteStrip({ orderId, routes, categoryLabel, several }: { orderId: number; routes: OrderRoute[]; categoryLabel: (id: number) => string; several: boolean }) {
  if (!routes.length) return <div className="order-route is-missing"><span className="order-route-label"><Route aria-hidden="true" />Lieferkette</span><span className="order-route-none">Für diese Bestellung gibt es noch keine Lieferkette. Sie entsteht, sobald du die Bestellung speicherst.</span><a className="order-route-edit" href={orderChainLink(orderId)}>Kette anlegen</a></div>;
  return <div className="order-route" aria-label="Lieferkette: wohin die Leads gehen">
    <span className="order-route-label" title="Station 1 bekommt jeden passenden Lead zuerst. Nimmt sie ihn nicht (Gebiet passt nicht, Dublette, Höchstmenge erreicht, abgelehnt oder reklamiert), geht er zur nächsten Station."><Route aria-hidden="true" />Lieferkette</span>
    <div className="order-route-lines">{routes.map((route) => { const names = route.categoryIds.map(categoryLabel).join(", "); const sentence = routeSentence(route);
      return <div key={route.chainIds.join("-")} className={`order-route-line ${route.active ? "" : "is-off"}`} title={sentence}>
        {(several || routes.length > 1) && <span className="order-route-cats">{routes.length === 1 ? "Alle Sparten" : names}</span>}
        <ol className="order-route-stops" aria-label={`${routes.length === 1 && several ? "Alle Sparten" : names}: ${sentence}`}>
          {route.stops.map((stop, index) => <li key={`${stop.position}-${stop.buyerName}`} className={`order-route-stop ${stop.active ? "" : "is-off"} ${stop.orderStop ? "is-order" : ""}`}>{index > 0 && <ArrowRight className="order-route-arrow" aria-hidden="true" />}<span className="order-route-chip" title={`Station ${index + 1}${stop.orderStop ? " – die Bestellung" : ""}${stop.active ? "" : " – ausgeschaltet, wird übersprungen"}${stop.maxLeads ? ` – höchstens ${stop.maxLeads.toLocaleString("de-DE")} Leads` : ""}`}><em>{index + 1}</em><b>{stop.buyerName}</b><small>{price(stop.unitPrice)}{stop.active ? "" : " · aus"}</small></span></li>)}
          <li className="order-route-end"><ArrowRight className="order-route-arrow" aria-hidden="true" /><span>{!route.active ? "Kette ausgeschaltet" : !route.stops.some((stop) => stop.active) ? "keine eingeschaltete Station" : `sonst ${routeEnd(route).replace(/^geht er |^ist er /, "")}`}</span></li>
        </ol>
      </div>; })}</div>
    <a className="order-route-edit" href={orderChainLink(orderId)} aria-label="Lieferkette dieser Bestellung bearbeiten">Kette bearbeiten</a>
  </div>;
}
const number = (value: number) => value.toLocaleString("de-DE");
const shortDate = (value: Date | string) => new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
const tint = (color: string) => ({ ["--cat" as string]: color }) as React.CSSProperties;

/** Ansicht der Bestellübersicht (v387): „liste“ (eine Zeile je Bestellung) oder „kacheln“ (Karten wie bei den Benutzern). Wird je Browser gemerkt. */
export type OrderView = "liste" | "kacheln";
const VIEW_KEY = "tanesco-order-view";
function initialOrderView(): OrderView {
  try { const asked = new URLSearchParams(window.location.search).get("ansicht"); if (asked === "kacheln" || asked === "liste") return asked; } catch { /* egal */ }
  try { return window.localStorage.getItem(VIEW_KEY) === "kacheln" ? "kacheln" : "liste"; } catch { return "liste"; }
}
/**
 * Bestellübersicht (neu gestaltet in Version 366): oben vier Zahlen über alle Bestellungen, darunter je Bestellung eine Zeile –
 * links ein Streifen in der Farbe des Status (Aktiv grün, Inaktiv bernstein), Käufer mit Kürzel, Kategorien als Marken,
 * der Lieferstand als Balken (unbegrenzt ohne Ende), Preis und Wert, Status und Aktionen rechts. Beginnt eine Bestellung erst später,
 * steht das am Namen („startet am 30.11.“) – bis dahin bekommt sie keine Leads.
 */
export function OrderOverview({ categories }: OrderOverviewProps) {
  const utils = trpc.useUtils();
  const orders = trpc.leadops.listOrders.useQuery({}, { retry: false });
  const chains = trpc.leadops.listDeliveryChains.useQuery(undefined, { retry: false });
  const deleteOrder = trpc.leadops.deleteOrder.useMutation({
    onSuccess: async (result) => { await Promise.all([utils.leadops.listOrders.invalidate(), utils.leadops.listDeliveryChains.invalidate()]); toast.success(`Bestellung ${result.orderNumber} wurde gelöscht.`); window.location.assign("/?page=Bestellungen&overview=1"); },
    onError: (error) => toast.error(error.message),
  });
  const updateStatus = trpc.leadops.updateOrderStatus.useMutation({
    onSuccess: async () => { await utils.leadops.listOrders.invalidate(); toast.success("Bestellstatus aktualisiert."); },
    onError: (error) => toast.error(error.message),
  });
  const list = orders.data ?? [];
  const [view, setViewState] = useState<OrderView>(initialOrderView);
  const setView = (next: OrderView) => { setViewState(next); try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* privater Modus: dann gilt die Wahl nur bis zum Neuladen */ } };
  const activeOrders = list.filter((order) => order.status === "aktiv").length;
  const deliveredAll = list.reduce((sum, order) => sum + order.deliveredCount, 0);
  const openAll = list.filter((order) => order.status === "aktiv" || order.status === "offen" || order.status === "pausiert").reduce((sum, order) => sum + (order.quantity ? Math.max(order.quantity - order.deliveredCount, 0) : 0), 0);
  const unlimitedActive = list.some((order) => !order.quantity && order.status !== "storniert" && order.status !== "erfüllt");
  const valueAll = list.reduce((sum, order) => sum + Number(order.unitPrice) * order.deliveredCount, 0);
  const now = Date.now();

  return <section className="surface-panel order-overview"><div className="order-overview-head compact"><div><span className="eyebrow">BESTELLÜBERSICHT</span><h2>Alle Bestellungen</h2><p>Prüfe Käufer, Lieferant, Lieferfortschritt und Status direkt dort, wo du die Bestellung steuerst.</p></div>
      <dl className="order-kpis" aria-label="Alle Bestellungen in Zahlen">
        <div className="is-active"><dt>Aktiv</dt><dd><b>{number(activeOrders)}</b><small>von {number(list.length)}</small></dd></div>
        <div><dt>Geliefert</dt><dd><b>{number(deliveredAll)}</b><small>Leads</small></dd></div>
        <div><dt>Noch offen</dt><dd><b>{number(openAll)}</b><small>{unlimitedActive ? "+ unbegrenzte" : "Leads"}</small></dd></div>
        <div><dt>Wert geliefert</dt><dd><b>{formatMoney(valueAll)}</b></dd></div>
      </dl>
    </div>
    {list.length > 0 && <div className="order-toolbar">
      <span className="order-toolbar-count">{number(list.length)} {list.length === 1 ? "Bestellung" : "Bestellungen"}</span>
      <div className="order-view" role="group" aria-label="Ansicht der Bestellungen">
        <button type="button" aria-pressed={view === "liste"} className={view === "liste" ? "is-on" : ""} title="Untereinander, eine Zeile je Bestellung" onClick={() => setView("liste")}><Rows3 aria-hidden="true" />Liste</button>
        <button type="button" aria-pressed={view === "kacheln"} className={view === "kacheln" ? "is-on" : ""} title="Als Kacheln nebeneinander – wie bei den Benutzern" onClick={() => setView("kacheln")}><LayoutGrid aria-hidden="true" />Kacheln</button>
      </div>
    </div>}
    <div className={view === "kacheln" ? "order-cards" : "order-stream"} aria-label="Alle Bestellungen">{orders.isLoading && <p className="order-empty">Bestellungen werden geladen.</p>}
      {view === "liste" && list.length > 0 && <div className="order-stream-head" aria-hidden="true"><span>Bestellung</span><span>Käufer und Lieferant</span><span>Kategorie</span><span>Lieferstatus</span><span>Preis & Wert</span><span>Status</span><span /></div>}
      {list.map((order) => {
      const delivered = order.deliveredCount; const unlimited = !order.quantity; const statusChoice = orderStatusChoice(order.status);
      const remaining = order.quantity ? Math.max(order.quantity - delivered, 0) : 0; const completion = order.quantity ? Math.min(100, Math.round((delivered / order.quantity) * 100)) : 0;
      const categoryIds = Array.isArray(order.categoryIds) ? order.categoryIds.filter((id): id is number => typeof id === "number") : [order.categoryId];
      const orderCategories = categories.filter((category) => categoryIds.includes(category.id)); const categoryText = orderCategories.map((category) => category.name).join(" · ") || "Keine Kategorie";
      const chainCount = chains.data?.filter((chain) => chain.orderId === order.id).length ?? 0;
      const routes = orderRoutes((chains.data ?? []).filter((chain) => chain.orderId === order.id), categoryIds); const categoryLabel = (id: number) => categories.find((category) => category.id === id)?.name ?? "Sparte";
      const value = Number(order.unitPrice) * delivered; /* geliefert – daneben der Wert der ganzen Bestellung (bei unbegrenzt gibt es keinen) */ const orderValue = order.quantity ? Number(order.unitPrice) * order.quantity : null;
      const startsLater = order.startsAt && new Date(order.startsAt).getTime() > now; const ended = order.endsAt && new Date(order.endsAt).getTime() < now;
      const interval = "in Echtzeit"; // seit v391 liefert jede Bestellung sofort – das alte Lieferintervall zählt nicht mehr
      const statusSelect = <select aria-label={`Status für ${order.orderNumber}`} className={`order-status-select status-${statusChoice}`} value={statusChoice} title={statusChoice === "aktiv" ? "Aktiv: bekommt Leads" : statusChoice === "pausiert" ? "Inaktiv: bekommt keine Leads" : undefined} disabled={updateStatus.isPending} onChange={(event) => updateStatus.mutate({ id: order.id, status: event.target.value as "aktiv" | "pausiert" })}><option value="aktiv">Aktiv</option><option value="pausiert">Inaktiv</option>{statusChoice === "erfüllt" && <option value="erfüllt" disabled>Erfüllt</option>}{statusChoice === "storniert" && <option value="storniert" disabled>Storniert</option>}</select>;
      const remove = async () => { if (await confirmAction(`Bestellung ${order.orderNumber} wirklich löschen? Zugehörige Lieferketten, Auslieferungsdaten und Bestellkonfigurationen werden entfernt. Bereits zugeordnete Leads bleiben erhalten, werden aber von dieser Bestellung gelöst.`)) deleteOrder.mutate({ orderId: order.id }); };
      const flag = startsLater ? <em className="order-flag is-later" title="Bis dahin bekommt die Bestellung keine Leads"><CalendarClock aria-hidden="true" />startet am {shortDate(order.startsAt!)}</em> : ended ? <em className="order-flag is-ended" title="Die Bestellung bekommt keine Leads mehr">endete am {shortDate(order.endsAt!)}</em> : null;
      const progress = <div className={`order-progress order-card-progress ${unlimited ? "is-unlimited" : ""}`}>
          <span className="order-progress-line"><b>{number(delivered)}</b>{unlimited ? <span>geliefert</span> : <span>/ {number(order.quantity!)} geliefert</span>}<em>{unlimited ? <><Unlimited aria-hidden="true" />unbegrenzt</> : `${completion} %`}</em></span>
          <span className="order-bar" role="progressbar" aria-label={unlimited ? "Menge unbegrenzt" : `${completion} % geliefert`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={unlimited ? undefined : completion}><i style={{ width: unlimited ? "100%" : `${completion}%` }} /></span>
          <span className="order-progress-foot">{unlimited ? `Menge unbegrenzt · ${interval}` : `${number(remaining)} offen · ${interval}`}</span>
        </div>;
      if (view === "kacheln") { const short = routeShort(routes); const title = order.name || order.orderNumber;
        return <article key={order.id} className={`order-card is-${statusChoice}`}>
          <a className="order-card-main" href={orderEditLink(order.id)} aria-label={`${title} bearbeiten`}>
            <span className="order-card-mono" aria-hidden="true">{nameInitials(order.buyerName)}</span>
            <span className="order-card-title"><b title={title}>{title}</b><small title={order.buyerName}>{order.buyerName}</small><small className="order-card-supplier" title={`Lieferant: ${order.supplierText}`}>{order.supplierText}</small></span>
            <code className="order-card-id">{order.orderNumber}</code>
          </a>
          <div className="order-card-tags">{orderCategories.length ? orderCategories.map((category) => <b key={category.id} className="order-cat" style={tint(categoryColor(category))} title={category.name}>{category.shortcode || category.name.slice(0, 3).toUpperCase()}</b>) : <em className="order-none">Keine Kategorie</em>}{flag}</div>
          {progress}
          <dl className="order-card-facts">
            <div><dt>Preis</dt><dd><b>{formatMoney(Number(order.unitPrice))}</b> je Lead</dd></div>
            <div><dt>Wert</dt><dd title={orderValue !== null ? "Wert der gelieferten Leads von dem der ganzen Bestellung" : "Wert der gelieferten Leads"}>{formatMoney(value)}{orderValue !== null && <> von {formatMoney(orderValue)}</>}</dd></div>
            <div><dt>Lieferkette</dt><dd title={short.title}><a className="order-card-route" href={orderChainLink(order.id)}>{short.text}</a></dd></div>
          </dl>
          <footer className="order-card-foot">{statusSelect}<div className="order-card-actions"><Button size="sm" variant="ghost" className="order-edit" asChild><a href={orderEditLink(order.id)}><Pencil /> Bearbeiten</a></Button><Button size="sm" variant="ghost" className="order-delete" aria-label={`Bestellung ${order.orderNumber} löschen`} title="Löschen" disabled={deleteOrder.isPending} onClick={remove}><Trash2 /></Button></div></footer>
        </article>; }
      return <article key={order.id} className={`order-stream-row is-${statusChoice}`}>
        <div className="order-stream-identity"><strong title={order.name || order.orderNumber}>{order.name || order.orderNumber}</strong><span className="order-stream-meta"><code>{order.orderNumber}</code>{startsLater ? <em className="order-flag is-later" title="Bis dahin bekommt die Bestellung keine Leads"><CalendarClock aria-hidden="true" />startet am {shortDate(order.startsAt!)}</em> : ended ? <em className="order-flag is-ended" title="Die Bestellung bekommt keine Leads mehr">endete am {shortDate(order.endsAt!)}</em> : null}{chainCount > 0 && <span className="order-chain" title={`${chainCount} ${chainCount === 1 ? "Lieferkette" : "Lieferketten"}`}><Route aria-hidden="true" />{chainCount}</span>}</span></div>
        <div className="order-stream-metric order-party order-buyer"><i className="order-avatar" aria-hidden="true">{nameInitials(order.buyerName)}</i><span className="order-buyer-text"><small>Käufer</small><b title={order.buyerName}>{order.buyerName}</b><span className="order-supplier" title={`Lieferant: ${order.supplierText}`}>{order.supplierText}</span></span></div>
        <div className="order-stream-metric order-cats"><small>Kategorie</small><span className="order-cat-list" title={categoryText}>{orderCategories.length ? orderCategories.map((category) => <b key={category.id} className="order-cat" style={tint(categoryColor(category))}>{category.shortcode || category.name.slice(0, 3).toUpperCase()}</b>) : <em className="order-none">Keine Kategorie</em>}</span></div>
        <div className={`order-stream-metric order-progress ${unlimited ? "is-unlimited" : ""}`}><small>Lieferstatus</small>
          <span className="order-progress-line"><b>{number(delivered)}</b>{unlimited ? <span>geliefert</span> : <span>/ {number(order.quantity!)} geliefert</span>}<em>{unlimited ? <><Unlimited aria-hidden="true" />unbegrenzt</> : `${completion} %`}</em></span>
          <span className="order-bar" role="progressbar" aria-label={unlimited ? "Menge unbegrenzt" : `${completion} % geliefert`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={unlimited ? undefined : completion}><i style={{ width: unlimited ? "100%" : `${completion}%` }} /></span>
          <span className="order-progress-foot">{unlimited ? `Menge unbegrenzt · ${interval}` : `${number(remaining)} offen · ${interval}`}</span>
        </div>
        <div className="order-stream-metric order-money"><small>Preis & Wert</small><b>{formatMoney(Number(order.unitPrice))}<span> je Lead</span></b><span title={orderValue !== null ? "Wert der gelieferten Leads von dem der ganzen Bestellung" : "Wert der gelieferten Leads"}>Wert {formatMoney(value)}{orderValue !== null && <> von {formatMoney(orderValue)}</>}</span></div>
        {statusSelect}
        <div className="order-stream-actions"><Button size="sm" variant="ghost" className="order-edit" asChild><a href={orderEditLink(order.id)}><Pencil /> Bearbeiten</a></Button><Button size="sm" variant="ghost" className="order-delete" aria-label={`Bestellung ${order.orderNumber} löschen`} title="Löschen" disabled={deleteOrder.isPending} onClick={remove}><Trash2 /></Button></div>
        {chains.data && <OrderRouteStrip orderId={order.id} routes={routes} categoryLabel={categoryLabel} several={categoryIds.length > 1} />}
      </article>; })}</div>
    {!orders.isLoading && !orders.data?.length && <div className="order-empty">Noch keine Bestellungen vorhanden. Lege die erste Bestellung an – die Kennzahlen landen danach direkt hier.</div>}
  </section>;
}
