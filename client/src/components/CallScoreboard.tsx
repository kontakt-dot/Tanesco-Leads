import { CALL_PERIODS, DECISION_LABEL, talkTimeText, type CallDecision, type CallOverview, type CallRange, type DecisionFilter } from "../../../shared/call-overview";
import { Face, type Mood } from "@/components/CallMood";

export { CALL_PERIODS, dayKey, dayLabel, DECISION_LABEL, timeText, type CallRange, type DecisionFilter } from "../../../shared/call-overview";

const MOOD_OF_DECISION: Record<CallDecision, Mood> = { freigegeben: "gruen", pruefen: "gelb", zurueckgewiesen: "rot", offen: "offen" };
const MOOD_WORD: Record<Mood, string> = { gruen: "passt", gelb: "bitte reinhören", rot: "passt nicht", offen: "noch nicht bewertet" };

/** Zeitraum der Gesprächsliste: Heute … Gesamt oder von/bis – klein in der Leiste der Liste. */
export function CallPeriodControl({ range, onRange }: { range: CallRange; onRange: (range: CallRange) => void }) {
  const custom = Boolean(range.from || range.to);
  return <div className="gq-period cq-filterbar">
    <div className="gq-periods" role="group" aria-label="Zeitraum">{CALL_PERIODS.map(([key, label]) => <button key={key} type="button" className={!custom && range.period === key ? "active" : ""} aria-pressed={!custom && range.period === key} onClick={() => onRange({ period: key, from: "", to: "" })}>{label}</button>)}</div>
    <div className="gq-dates"><label>von<input type="date" aria-label="Datum von" value={range.from} max={range.to || undefined} onChange={(event) => onRange({ ...range, from: event.target.value })} /></label><label>bis<input type="date" aria-label="Datum bis" value={range.to} min={range.from || undefined} onChange={(event) => onRange({ ...range, to: event.target.value })} /></label>{custom && <button type="button" className="gq-reset" onClick={() => onRange({ period: "alle", from: "", to: "" })}>Datum zurücksetzen</button>}</div>
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
