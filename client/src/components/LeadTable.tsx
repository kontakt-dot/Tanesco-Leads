import React from "react";
import { Eye, History, Inbox } from "lucide-react";
import { currency } from "@/lib/leadOps";
import { statusStyle } from "@/lib/colors";
import { LEAD_COLUMNS, leadGridTemplate, type LeadColumnKey } from "@/lib/leadColumns";

/** Eine Zeile der Leads-Tabelle – fertig aufbereitet (Texte, Farben, Zeiten). */
export type LeadTableRow = {
  id: string; flag: string; name: string; place: string; email: string; phone: string; status: string; price: number;
  supplier: string; buyer: string; categoryName: string; categoryCode: string; categoryColor: string;
  /** Wann der Lead vom Lieferanten ankam */ received: string; receivedFull: string;
  /** Wann er an den Käufer ging */ delivered: string; assigned: string;
};

const DASH = "—";
const cellText = (value: string) => (value && value !== DASH ? value : DASH);

/**
 * Leads-Tabelle. Sie wird vollständig hier gebaut – jede Spalte, jede Zeile. Früher wurde eine einfache Tabelle nachträglich umgebaut;
 * kam man von einem Lead zurück, fehlte dieser Umbau, und rechts standen weder Preis noch Ansicht noch Lead-Log.
 * Alle Inhalte stehen mittig in ihrer Spalte. Auf dem Handy wird jede Zeile zu einer Karte.
 */
export default function LeadTable({ rows, visible, wide, loading, selectedIds, allSelected, onToggle, onTogglePage, onOpenLead, onQuickView, onOpenLog, emptyHint }: {
  rows: LeadTableRow[]; visible: LeadColumnKey[]; /** alle Spalten erzwungen – die Tabelle rollt zur Seite */ wide?: boolean; loading?: boolean;
  selectedIds: string[]; allSelected: boolean; onToggle: (id: string) => void; onTogglePage: () => void;
  onOpenLead: (id: string) => void; onQuickView: (id: string) => void; onOpenLog: (id: string) => void; emptyHint?: React.ReactNode;
}) {
  const columns = LEAD_COLUMNS.filter((column) => visible.includes(column.key));
  const style = { ["--lt-cols" as string]: leadGridTemplate(visible, wide) } as React.CSSProperties;
  const cell = (lead: LeadTableRow, key: LeadColumnKey) => {
    if (key === "category") return <span className="lt-cat" title={lead.categoryName}><b className="lt-cat-code cat-strong" style={{ ["--cat" as string]: lead.categoryColor } as React.CSSProperties}>{lead.categoryCode}</b><span className="lt-cat-name">{lead.categoryName}</span></span>;
    if (key === "email") return lead.email && lead.email !== DASH ? <a className="lt-link" href={`mailto:${lead.email}`} title={lead.email}>{lead.email}</a> : <span className="lt-none">{DASH}</span>;
    if (key === "phone") return lead.phone && lead.phone !== DASH ? <a className="lt-link lt-num" href={`tel:${lead.phone}`}>{lead.phone}</a> : <span className="lt-none">{DASH}</span>;
    if (key === "status") { const status = statusStyle(lead.status); return <span className="lt-pill-status cat-strong" style={{ ["--cat" as string]: status.color } as React.CSSProperties}><i aria-hidden="true" />{status.label}</span>; }
    if (key === "supplier") return <span className="lt-text" title={lead.supplier}>{cellText(lead.supplier)}</span>;
    if (key === "delivered") return <span className="lt-num" title={`Vom Lieferanten angekommen: ${lead.receivedFull}`}>{cellText(lead.received)}</span>;
    if (key === "buyer") return lead.buyer && lead.buyer !== DASH ? <span className="lt-two"><span className="lt-text" title={lead.buyer}>{lead.buyer}</span>{lead.delivered !== DASH && <small title="An den Käufer ausgeliefert">{lead.delivered}</small>}</span> : <span className="lt-none">{DASH}</span>;
    if (key === "assigned") return <span className="lt-num">{cellText(lead.assigned)}</span>;
    return <span className={lead.price > 0 ? "lt-pill-price" : "lt-pill-price is-zero"}>{currency(lead.price)}</span>;
  };
  return <div className={`lt-wrap ${wide ? "is-wide" : ""}`}>
    <div className="lt" role="table" aria-label="Leads" aria-busy={loading || undefined} style={style}>
      <div className="lt-head" role="row">
        <span className="lt-c lt-select" role="columnheader"><input aria-label="Alle Leads dieser Seite auswählen" type="checkbox" checked={allSelected} onChange={onTogglePage} /></span>
        <span className="lt-c lt-id" role="columnheader">ID</span>
        <span className="lt-c lt-lead" role="columnheader">Lead</span>
        {columns.map((column) => <span key={column.key} className={`lt-c lt-${column.key}`} role="columnheader" title={column.hint}>{column.label}</span>)}
        <span className="lt-c lt-actions" role="columnheader" title="Ansicht öffnen oder das Lead-Log ansehen">Ansicht</span>
      </div>
      {rows.map((lead) => { const selected = selectedIds.includes(lead.id); return <div key={lead.id} className={`lt-row ${selected ? "is-selected" : ""}`} role="row" data-lead={lead.id}>
        <span className="lt-c lt-select" role="cell"><input aria-label={`Lead ${lead.name} auswählen`} type="checkbox" checked={selected} onChange={() => onToggle(lead.id)} /></span>
        <span className="lt-c lt-id" role="cell"><code>{lead.id}</code></span>
        <span className="lt-c lt-lead" role="cell"><button type="button" className="lt-name" title="Lead-Seite öffnen" onClick={() => onOpenLead(lead.id)}><strong><span className="lt-flag" aria-hidden="true">{lead.flag}</span>{lead.name}</strong><small>{lead.place}</small></button></span>
        {columns.map((column) => <span key={column.key} className={`lt-c lt-${column.key}`} role="cell" data-label={column.label}>{cell(lead, column.key)}</span>)}
        <span className="lt-c lt-actions" role="cell">
          <button type="button" className="lt-act" title="Ansicht öffnen" aria-label={`Ansicht für ${lead.name} öffnen`} onClick={() => onQuickView(lead.id)}><Eye aria-hidden="true" /></button>
          <button type="button" className="lt-act" title="Lead-Log ansehen" aria-label={`Lead-Log von ${lead.name} ansehen`} onClick={() => onOpenLog(lead.id)}><History aria-hidden="true" /></button>
        </span>
      </div>; })}
      {loading && !rows.length && Array.from({ length: 6 }, (_, index) => <div key={index} className="lt-row lt-skeleton" role="row" aria-hidden="true"><span className="lt-c lt-select"><i /></span><span className="lt-c lt-id"><i /></span><span className="lt-c lt-lead"><i /></span>{columns.map((column) => <span key={column.key} className={`lt-c lt-${column.key}`}><i /></span>)}<span className="lt-c lt-actions"><i /></span></div>)}
    </div>
    {!loading && !rows.length && <div className="lt-empty"><Inbox aria-hidden="true" /><strong>Keine Leads gefunden</strong><p>{emptyHint ?? "Für diese Auswahl gibt es keine Leads."}</p></div>}
  </div>;
}
