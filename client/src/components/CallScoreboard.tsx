import { CALL_MORE_PERIODS, CALL_OPEN_MODES, CALL_PERIODS, DECISION_LABEL, shiftDay, talkTimeText, type CallDecision, type CallOpenMode, type CallOverview, type CallPeriodKey, type CallRange, type DecisionFilter } from "../../../shared/call-overview";
import { Face, type Mood } from "@/components/CallMood";

export { CALL_PERIODS, callRangeInput, dayKey, dayLabel, DECISION_LABEL, hasCallRange, rangeOfSpan, timeText, type CallRange, type DecisionFilter } from "../../../shared/call-overview";

const MOOD_OF_DECISION: Record<CallDecision, Mood> = { freigegeben: "gruen", pruefen: "gelb", zurueckgewiesen: "rot", offen: "offen" };
const MOOD_WORD: Record<Mood, string> = { gruen: "passt", gelb: "bitte reinhören", rot: "passt nicht", offen: "noch nicht bewertet" };

const isOpenMode = (value: string): value is CallOpenMode => value === "zwischen" || value === "ab" || value === "vor";
/**
 * Zeitraum für Gesprächsliste und Bestenliste – überall derselbe: schnelle Knöpfe (Heute … Gesamt), dazu „Weitere Zeiträume“ wie auf der
 * Leads-Seite: feste (diese Woche, letzte Woche, letzte 2 Wochen, dieser Monat, letzter Monat) und eigene (zwischen zwei Tagen, ab einem
 * Tag, vor einem Tag). Die Datumsfelder stehen nur da, wenn ein eigener Zeitraum gewählt ist. `resetTo` ist der Zeitraum nach dem Zurücksetzen.
 */
export function CallPeriodControl({ range, onRange, resetTo = "alle" }: { range: CallRange; onRange: (range: CallRange) => void; resetTo?: CallPeriodKey }) {
  const custom = Boolean(range.from || range.to);
  const open: CallOpenMode | "" = range.open || (range.from && range.to ? "zwischen" : range.from ? "ab" : range.to ? "vor" : "");
  const more = open || (!custom && CALL_MORE_PERIODS.some(([key]) => key === range.period) ? range.period : "");
  const choose = (value: string) => {
    if (!value) { onRange({ period: resetTo, from: "", to: "" }); return; }
    if (isOpenMode(value)) { onRange({ period: "alle", from: value === "vor" ? "" : range.from, to: value === "ab" ? "" : range.to, open: value }); return; } // was schon eingetragen ist, bleibt – soweit es zur Auswahl passt
    onRange({ period: value as CallPeriodKey, from: "", to: "" });
  };
  const quick = (key: CallPeriodKey) => !custom && !open && range.period === key;
  return <div className="gq-period cq-filterbar">
    <div className="gq-periods" role="group" aria-label="Zeitraum">{CALL_PERIODS.map(([key, label]) => <button key={key} type="button" className={quick(key) ? "active" : ""} aria-pressed={quick(key)} onClick={() => onRange({ period: key, from: "", to: "" })}>{label}</button>)}</div>
    <select className={`filter-select gq-more-periods ${more ? "is-on" : ""}`} aria-label="Weitere Zeiträume" title="Weitere Zeiträume – wie auf der Leads-Seite" value={more} onChange={(event) => choose(event.target.value)}>
      <option value="">Weitere Zeiträume</option>
      <optgroup label="Feste Zeiträume">{CALL_MORE_PERIODS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</optgroup>
      <optgroup label="Eigener Zeitraum">{CALL_OPEN_MODES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</optgroup>
    </select>
    {open && <div className="gq-dates">
      {open === "ab" ? <label>ab<input type="date" aria-label="Datum ab" value={range.from} onChange={(event) => onRange({ ...range, open, from: event.target.value, to: "" })} /></label>
        : open === "vor" ? <label title="Der gewählte Tag selbst zählt nicht mehr mit">vor<input type="date" aria-label="Datum vor" value={range.to ? shiftDay(range.to, 1) : ""} onChange={(event) => onRange({ ...range, open, from: "", to: event.target.value ? shiftDay(event.target.value, -1) : "" })} /></label>
        : <><label>von<input type="date" aria-label="Datum von" value={range.from} max={range.to || undefined} onChange={(event) => onRange({ ...range, open, from: event.target.value })} /></label><label>bis<input type="date" aria-label="Datum bis" value={range.to} min={range.from || undefined} onChange={(event) => onRange({ ...range, open, to: event.target.value })} /></label></>}
      <button type="button" className="gq-reset" onClick={() => onRange({ period: resetTo, from: "", to: "" })}>Datum zurücksetzen</button>
    </div>}
  </div>;
}

/** Zähler je Ergebnis – kleine Knöpfe, die zugleich die Liste filtern (noch einmal klicken hebt den Filter auf). */
export function CallTally({ overview, decision, onDecision }: { overview: CallOverview | null; decision: DecisionFilter; onDecision: (decision: DecisionFilter) => void }) {
  const counts: Record<CallDecision, number> = { freigegeben: overview?.approved ?? 0, pruefen: overview?.review ?? 0, zurueckgewiesen: overview?.rejected ?? 0, offen: overview?.open ?? 0 };
  const openHint = overview && (overview.failed || overview.noConsent) ? [overview.failed ? `${overview.failed} fehlgeschlagen` : "", overview.noConsent ? `${overview.noConsent} ohne Einwilligung` : ""].filter(Boolean).join(", ") : MOOD_WORD.offen;
  return <div className={`gq-tally ${decision ? "has-filter" : ""}`} role="group" aria-label="Liste nach Ergebnis filtern">
    {(Object.keys(MOOD_OF_DECISION) as CallDecision[]).map((key) => { const mood = MOOD_OF_DECISION[key]; const on = decision === key; const hint = key === "offen" ? openHint : MOOD_WORD[mood]; return <button key={key} type="button" className={`gq-tally-item is-${mood} ${on ? "is-on" : ""}`} aria-pressed={on} title={on ? "Filter aufheben – wieder alle Gespräche zeigen" : `${DECISION_LABEL[key]} (${hint}) – nur diese Gespräche in der Liste zeigen`} onClick={() => onDecision(on ? "" : key)}>
      <Face mood={mood} size={20} /><b>{DECISION_LABEL[key]}</b><strong>{counts[key].toLocaleString("de-DE")}</strong>
    </button>; })}
  </div>;
}

/** Kurz in Worten für die Leiste: „24 Gespräche, 1 Std 3 Min am Telefon“. */
export function overviewSummary(overview: CallOverview | null): string {
  if (!overview) return "Gespräche werden geladen …"; const total = overview.total;
  return `${total.toLocaleString("de-DE")} ${total === 1 ? "Gespräch" : "Gespräche"}${overview.talkSeconds > 0 ? `, ${talkTimeText(overview.talkSeconds)} am Telefon` : ""}`;
}
