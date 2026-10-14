import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Clock3, X } from "lucide-react";
import { useEffect } from "react";

const toneClass: Record<string, string> = { violett: "bg-violet-400", gruen: "bg-emerald-400", rot: "bg-red-400", blau: "bg-sky-400", orange: "bg-amber-400", grau: "bg-slate-500" };
const typeLabel: Record<string, string> = { erfasst: "Erfasst", auslieferung: "Auslieferung", reklamation: "Reklamation", status: "Status", api: "API", automation: "Automatisierung" };
const stamp = (value: Date | string) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Zeitleiste der Lead-Ereignisse (neueste zuerst) – in Schublade und auf der Lead-Seite. */
export function LeadLogTimeline({ publicId, limit }: { publicId: string; limit?: number }) {
  const audit = trpc.leadops.getLeadAuditLog.useQuery({ publicId }, { retry: false });
  const items = [...(audit.data ?? [])].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()).slice(0, limit ?? Infinity);
  if (audit.isLoading) return <p className="text-sm text-slate-400">Lead-Log wird geladen …</p>;
  if (audit.error) return <p className="text-sm text-red-200">{audit.error.message}</p>;
  if (!items.length) return <p className="text-sm text-slate-400">Noch keine Ereignisse.</p>;
  return <ol className="lead-log-list">{items.map((item) => <li key={item.id} className="lead-log-item"><span className={`lead-log-dot ${toneClass[item.tone] ?? toneClass.grau}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-x-3"><strong className="text-sm text-slate-100">{item.title}</strong><span className="flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-500"><Clock3 className="h-3 w-3" />{stamp(item.occurredAt)}</span></div>{item.detail && <p className="mt-0.5 break-words text-xs text-slate-400">{item.detail}</p>}<span className="mt-1 inline-block rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[.12em] text-slate-500">{typeLabel[item.type] ?? item.type}</span></div></li>)}</ol>;
}

/** Lead-Log als schmale Schublade am rechten Rand. */
export default function LeadLogDrawer({ publicId, name, onClose, onOpenLead }: { publicId: string; name?: string; onClose: () => void; onOpenLead?: () => void }) {
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose]);
  return <div className="side-drawer-backdrop" onClick={onClose} role="presentation">
    <aside className="side-drawer narrow" role="dialog" aria-label={`Lead-Log ${publicId}`} onClick={(event) => event.stopPropagation()}>
      <header className="side-drawer-head"><div><span className="eyebrow">LEAD-LOG</span><h2 className="mt-1 text-base font-semibold text-slate-100">{name || publicId}</h2><p className="text-xs text-slate-500">{publicId}</p></div><div className="flex items-center gap-1">{onOpenLead && <Button size="sm" variant="outline" onClick={onOpenLead}>Zur Lead-Seite</Button>}<Button size="icon" variant="ghost" aria-label="Lead-Log schließen" onClick={onClose}><X className="h-4 w-4" /></Button></div></header>
      <div className="side-drawer-body"><LeadLogTimeline publicId={publicId} /></div>
    </aside>
  </div>;
}
