import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Pencil, Route, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { confirmAction } from "@/lib/confirm";

type OrderOverviewProps = {
  categories: Array<{ id: number; name: string }>;
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

function formatMoney(value: number) { return value.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }); }

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
  const activeOrders = orders.data?.filter((order) => order.status === "aktiv").length ?? 0;

  return <section className="surface-panel order-overview"><div className="order-overview-head compact"><div><span className="eyebrow">BESTELLÜBERSICHT</span><h2>Alle Bestellungen</h2><p>Prüfe Käufer, Lieferant, Lieferfortschritt und Status direkt dort, wo du die Bestellung steuerst.</p></div><span className="order-overview-summary">{orders.data?.length ?? 0} insgesamt · {activeOrders} aktiv</span></div>
    <div className="order-stream" aria-label="Alle Bestellungen">{orders.isLoading && <p className="order-empty">Bestellungen werden geladen.</p>}{orders.data?.map((order) => { const delivered = order.deliveredCount; const remaining = Math.max(order.quantity - delivered, 0); const completion = order.quantity ? Math.round((delivered / order.quantity) * 100) : 0; const categoryIds = Array.isArray(order.categoryIds) ? order.categoryIds.filter((id): id is number => typeof id === "number") : [order.categoryId]; const categoryText = categories.filter((category) => categoryIds.includes(category.id)).map((category) => category.name).join(" · ") || "Keine Kategorie"; const chainCount = chains.data?.filter((chain) => chain.orderId === order.id).length ?? 0; const value = Number(order.unitPrice) * order.quantity; return <article key={order.id} className="order-stream-row"><div className="order-stream-identity"><strong>{order.name || order.orderNumber}</strong><span>{order.orderNumber}</span></div><div className="order-stream-metric order-party"><small>Käufer</small><span title={order.buyerName}>{order.buyerName}</span></div><div className="order-stream-metric"><small>Kategorie</small><span title={categoryText}>{categoryText}</span></div><div className="order-stream-metric order-party"><small>Lieferant</small><span title={order.supplierText}>{order.supplierText}</span></div><div className="order-stream-metric"><small>Intervall</small><b>{order.deliveryInterval}</b></div><div className="order-stream-metric order-progress"><small>Lieferstatus</small><b>{delivered}/{order.quantity} · {remaining} offen</b><em>{completion}% erfüllt</em></div><div className="order-stream-metric"><small>Preis & Wert</small><b>{formatMoney(Number(order.unitPrice))}/Lead</b><span>{formatMoney(value)}</span></div><div className="order-stream-metric"><small>Lieferkette</small><span className="inline-flex items-center gap-1"><Route className="h-3.5 w-3.5" />{chainCount || "—"}</span></div><select aria-label={`Status für ${order.orderNumber}`} className={`order-status-select status-${order.status}`} value={order.status} disabled={updateStatus.isPending} onChange={(event) => updateStatus.mutate({ id: order.id, status: event.target.value as "offen" | "aktiv" | "pausiert" })}><option value="offen">Offen</option><option value="aktiv">Aktiv</option><option value="pausiert">Inaktiv</option></select><div className="order-stream-actions"><Button size="sm" variant="ghost" asChild><a href={orderEditLink(order.id)}><Pencil /> Bearbeiten</a></Button><Button size="sm" variant="ghost" className="text-rose-300 hover:bg-rose-500/10 hover:text-rose-100" disabled={deleteOrder.isPending} onClick={async () => { if (await confirmAction(`Bestellung ${order.orderNumber} wirklich löschen? Zugehörige Lieferketten, Auslieferungsdaten und Bestellkonfigurationen werden entfernt. Bereits zugeordnete Leads bleiben erhalten, werden aber von dieser Bestellung gelöst.`)) deleteOrder.mutate({ orderId: order.id }); }}><Trash2 /> Löschen</Button></div></article>; })}</div>
    {!orders.isLoading && !orders.data?.length && <div className="order-empty">Noch keine Bestellungen vorhanden. Lege die erste Bestellung an – die Kennzahlen landen danach direkt hier.</div>}
  </section>;
}
