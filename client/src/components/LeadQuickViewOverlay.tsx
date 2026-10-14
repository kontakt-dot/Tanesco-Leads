import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { currency } from "@/lib/leadOps";
import { catPill, statusStyle, tint } from "@/lib/colors";
import { AlertTriangle, ClipboardList, Clock3, ExternalLink, Send, X } from "lucide-react";
import LeadClaimForm from "@/components/LeadClaimForm";
import LeadTagManager from "@/components/LeadTagManager";
import { LeadLogTimeline } from "@/components/LeadLogDrawer";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export type QuickViewLead = { id: string; leadDbId?: number; name: string; place: string; phone: string; email: string; status: string; price: number; supplier: string; created: string; categoryName?: string; categoryEmoji?: string; categoryColor?: string; metadata?: unknown };

const humanize = (key: string) => key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

/** Quick View als Schublade am rechten Rand (verschwommener Hintergrund): das Wichtigste auf einen Blick, Details auf der Lead-Seite. */
export default function LeadQuickViewOverlay({ lead, onClose, onDeliver, onClaimCreated, onOpenLead, onOpenLog }: { lead: QuickViewLead; onClose: () => void; onDeliver: () => void; onClaimCreated: (claimId: number) => void; onOpenLead?: () => void; onOpenLog?: () => void }) {
  const [claimLeadId, setClaimLeadId] = useState<number | null>(null);
  const customFields = useMemo(() => Object.entries(lead.metadata && typeof lead.metadata === "object" ? lead.metadata as Record<string, unknown> : {}).filter(([, value]) => value !== null && value !== undefined && value !== ""), [lead.metadata]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose]);
  const utils = trpc.useUtils(); void utils;
  return <div className="side-drawer-backdrop" onClick={onClose} role="presentation">
    <aside className="side-drawer" role="dialog" aria-modal="true" aria-label={`Quick View für ${lead.name}`} onClick={(event) => event.stopPropagation()}>
      <header className="side-drawer-head"><div><span className="eyebrow">LEAD QUICK VIEW</span><h2 className="mt-1 text-lg font-semibold text-slate-100">{lead.name}</h2><div className="mt-2 flex flex-wrap gap-2"><Badge variant="outline" className="cat-strong" style={catPill(lead.categoryColor ?? "#64748b")}>{lead.categoryEmoji && <span className="cat-emoji" aria-hidden="true">{lead.categoryEmoji}</span>}{lead.categoryName ?? "Lead-Kategorie"}</Badge><Badge variant="outline" className="mono">ID: {lead.id}</Badge><Badge variant="outline" style={{ color: statusStyle(lead.status).color, borderColor: tint(statusStyle(lead.status).color, 0.4), backgroundColor: tint(statusStyle(lead.status).color, 0.1) }}>{statusStyle(lead.status).label}</Badge></div></div><div className="flex items-center gap-1">{onOpenLead && <Button size="sm" variant="outline" onClick={onOpenLead}><ExternalLink className="h-3.5 w-3.5" /> Lead-Seite</Button>}<Button size="icon" variant="ghost" onClick={onClose} aria-label="Quick View schließen"><X /></Button></div></header>
      <div className="side-drawer-body">
        <section className="lead-summary-card"><div><span>Status</span><strong style={{ color: statusStyle(lead.status).color }}>{statusStyle(lead.status).label}</strong></div><div><span>Erfasst</span><strong>{lead.created}</strong></div><div><span>Wert</span><strong>{currency(lead.price)}</strong></div></section>
        <section className="lead-detail-section"><div className="lead-section-title"><ClipboardList /> Kontaktdaten und Lead-Felder</div><dl className="lead-field-grid"><div><dt>Adresse</dt><dd>{lead.place}</dd></div><div><dt>E-Mail</dt><dd>{lead.email}</dd></div><div><dt>Telefon</dt><dd>{lead.phone}</dd></div><div><dt>Lieferquelle</dt><dd>{lead.supplier}</dd></div>{customFields.map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{Array.isArray(value) ? value.join(", ") : String(value)}</dd></div>)}</dl></section>
        <LeadTagManager publicId={lead.id} />
        <section className="lead-detail-section"><div className="lead-section-title"><Clock3 /> Letzte Ereignisse{onOpenLog && <button type="button" className="ml-auto text-xs font-medium text-violet-200 hover:underline" onClick={onOpenLog}>Ganzes Lead-Log</button>}</div><div className="p-4"><LeadLogTimeline publicId={lead.id} limit={4} /></div></section>
        {claimLeadId === lead.leadDbId && lead.leadDbId ? <LeadClaimForm leadId={lead.leadDbId} publicId={lead.id} onClose={() => setClaimLeadId(null)} onCreated={onClaimCreated} /> : null}
      </div>
      <footer className="side-drawer-foot"><Button variant="outline" onClick={() => lead.leadDbId ? setClaimLeadId(lead.leadDbId) : toast.error("Für diesen Vorschau-Lead kann kein Reklamationsfall angelegt werden.")}><AlertTriangle /> Reklamation erfassen</Button><Button className="flux-button" onClick={onDeliver}><Send /> Jetzt ausliefern</Button></footer>
    </aside>
  </div>;
}
