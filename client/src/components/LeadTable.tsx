import React, { useEffect, useState } from "react";
import { Eye, History, Inbox } from "lucide-react";
import { currency } from "@/lib/leadOps";
import { statusStyle } from "@/lib/colors";
import { LEAD_COLUMNS, leadGridTemplate, type LeadColumnKey } from "@/lib/leadColumns";
import { arrivalLabel, nameInitials } from "../../../shared/lead-age";

/** Eine Zeile der Leads-Tabelle – fertig aufbereitet (Texte, Farben, Zeiten). */
export type LeadTableRow = {
  id: string; flag: string; name: string; place: string; email: string; phone: string; status: string; price: number;
  supplier: string; buyer: string; categoryName: string; categoryCode: string; categoryColor: string;
  /** Wann der Lead vom Lieferanten ankam */ received: string; receivedFull: string;
  /** derselbe Zeitpunkt als Zahl – für „vor 12 Min.“, „Heute 17:28“ */ receivedAt?: number;
  /** Land des Kunden (DE, AT, CH) – die Flagge steht nur bei Leads aus dem Ausland */ country?: string;
  /** Wann er an den Käufer ging */ delivered: string; assigned: string;
};

const DASH = "—";
const cellText = (value: string) => (value && value !== DASH ? value : DASH);
const tint = (color: string) => ({ ["--cat" as string]: color }) as React.CSSProperties;

/** Jede Minute neu rechnen – „vor 12 Min.“ stimmt, ohne dass die Tabelle neu lädt */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []);
  return now;
}

/**
 * Leads-Tabelle (neu gestaltet in Version 366). Sie wird vollständig hier gebaut – jede Spalte, jede Zeile.
 *  - Links bündig und ruhig: Jede Zeile beginnt mit einem Kreis in der Farbe der Kategorie (Kürzel des Namens), daneben Name und Ort.
 *  - „Geliefert“ sagt, wie frisch der Lead ist: „vor 12 Min.“ (mit Punkt, unter 15 Minuten pulsierend), „Heute 17:28“, „Gestern 16:58“.
 *  - Der Preis steht rechtsbündig; Ansicht und Lead-Log treten erst beim Überfahren der Zeile hervor.
 *  - Beim Überfahren zeigt ein Streifen links die Farbe der Kategorie. Auf dem Handy wird jede Zeile zu einer Karte.
 */
export default function LeadTable({ rows, visible, wide, loading, selectedIds, allSelected, onToggle, onTogglePage, onOpenLead, onQuickView, onOpenLog, emptyHint }: {
  rows: LeadTableRow[]; visible: LeadColumnKey[]; /** alle Spalten erzwungen – die Tabelle rollt zur Seite */ wide?: boolean; loading?: boolean;
  selectedIds: string[]; allSelected: boolean; onToggle: (id: string) => void; onTogglePage: () => void;
  onOpenLead: (id: string) => void; onQuickView: (id: string) => void; onOpenLog: (id: string) => void; emptyHint?: React.ReactNode;
}) {
  const now = useMinute();
  const columns = LEAD_COLUMNS.filter((column) => visible.includes(column.key));
  const style = { ["--lt-cols" as string]: leadGridTemplate(visible, wide) } as React.CSSProperties;
  const cell = (lead: LeadTableRow, key: LeadColumnKey) => {
    if (key === "category") return <span className="lt-cat" title={lead.categoryName}><b className="lt-cat-code" style={tint(lead.categoryColor)}>{lead.categoryCode}</b><span className="lt-cat-name">{lead.categoryName}</span></span>;
    if (key === "email") return lead.email && lead.email !== DASH ? <a className="lt-link" href={`mailto:${lead.email}`} title={lead.email}>{lead.email}</a> : <span className="lt-none">{DASH}</span>;
    if (key === "phone") return lead.phone && lead.phone !== DASH ? <a className="lt-link lt-num" href={`tel:${lead.phone}`}>{lead.phone}</a> : <span className="lt-none">{DASH}</span>;
    if (key === "status") { const status = statusStyle(lead.status); return <span className="lt-pill-status" style={tint(status.color)}><i aria-hidden="true" />{status.label}</span>; }
    if (key === "supplier") return lead.supplier && lead.supplier !== DASH ? <span className="lt-text lt-soft" title={lead.supplier}>{lead.supplier}</span> : <span className="lt-none">{DASH}</span>;
    if (key === "delivered") {
      const arrival = lead.receivedAt ? arrivalLabel(lead.receivedAt, now) : null;
      if (!arrival) return <span className="lt-num" title={`Vom Lieferanten angekommen: ${lead.receivedFull}`}>{cellText(lead.received)}</span>;
      return <span className={`lt-age lt-num ${arrival.fresh ? `is-${arrival.fresh}` : ""}`} title={`Vom Lieferanten angekommen: ${arrival.full}`}>{arrival.fresh && <i aria-hidden="true" />}{arrival.text}</span>;
    }
    if (key === "buyer") return lead.buyer && lead.buyer !== DASH ? <span className="lt-two"><span className="lt-text" title={lead.buyer}>{lead.buyer}</span>{lead.delivered !== DASH && <small title="An den Käufer ausgeliefert">{lead.delivered}</small>}</span> : <span className="lt-none">{DASH}</span>;
    if (key === "assigned") return lead.assigned && lead.assigned !== DASH ? <span className="lt-num lt-soft">{lead.assigned}</span> : <span className="lt-none">{DASH}</span>;
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
      {rows.map((lead) => { const selected = selectedIds.includes(lead.id); const abroad = lead.country && lead.country !== "DE"; return <div key={lead.id} className={`lt-row ${selected ? "is-selected" : ""}`} role="row" data-lead={lead.id} style={tint(lead.categoryColor)}>
        <span className="lt-c lt-select" role="cell"><input aria-label={`Lead ${lead.name} auswählen`} type="checkbox" checked={selected} onChange={() => onToggle(lead.id)} /></span>
        <span className="lt-c lt-id" role="cell"><code>{lead.id}</code></span>
        <span className="lt-c lt-lead" role="cell"><button type="button" className="lt-name" title="Lead-Seite öffnen" onClick={() => onOpenLead(lead.id)}><i className="lt-avatar" aria-hidden="true">{nameInitials(lead.name)}</i><span className="lt-name-text"><strong>{lead.name}</strong><small>{lead.place}{abroad && <span className="lt-flag" title={lead.country}>{lead.flag}</span>}</small></span></button></span>
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
