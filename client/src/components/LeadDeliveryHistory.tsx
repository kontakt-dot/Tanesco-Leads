import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

export default function LeadDeliveryHistory({ publicId }: { publicId: string }) {
  const deliveries = trpc.leadops.listLeadDeliveries.useQuery({ publicId }, { retry: false });
  return <div className="detail-block"><span>Auslieferungshistorie</span><div className="mt-2 space-y-2">{deliveries.data?.map((delivery) => <div key={delivery.id} className="flex items-center justify-between text-[11px]"><div><strong>{delivery.buyerName}</strong><p className="text-slate-500">{new Date(delivery.occurredAt).toLocaleString("de-DE")}</p></div><Badge variant="outline" className="border-red-400/25 bg-red-500/10 text-red-200">{delivery.result}</Badge></div>)}{!deliveries.data?.length && <p className="text-xs text-slate-500">Noch keine Auslieferung protokolliert.</p>}</div></div>;
}
