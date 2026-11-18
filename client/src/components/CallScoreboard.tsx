import { useMemo, useRef, useState, type CSSProperties } from "react";
import { barHeight, CALL_PERIODS, CLOCK_LIMIT, clockLayout, clockText, dayLabel, DECISION_LABEL, groupTimeline, periodPhrase, singleDayOf, talkTimeText, timeText, type CallDecision, type CallOverview, type CallRange, type DecisionFilter, type TimelineEntry } from "../../../shared/call-overview";
import { Face, type Mood } from "@/components/CallMood";

export { CALL_PERIODS, dayKey, dayLabel, DECISION_LABEL, timeText, type CallRange, type DecisionFilter } from "../../../shared/call-overview";

const MOOD_OF_DECISION: Record<CallDecision, Mood> = { freigegeben: "gruen", pruefen: "gelb", zurueckgewiesen: "rot", offen: "offen" };
const MOOD_WORD: Record<Mood, string> = { gruen: "passt", gelb: "bitte reinhören", rot: "passt nicht", offen: "noch nicht bewertet" };

/**
 * Anzeigetafel über der Gesprächsliste: wie viele Gespräche, wie lange telefoniert – und der Verlauf als Tonspur.
 * Jeder Strich ist ein Gespräch (Höhe = Dauer, Farbe = Ampel), ein Klick öffnet es. Die Zähler rechts filtern die Liste.
 * Ein einzelner Tag wird auf einer Uhrzeit-Achse gezeigt (wann wurde telefoniert?), mehrere Tage als Folge je Tag.
 */
export default function CallScoreboard({ overview, loading, range, onRange, decision, onDecision, onOpen, scope }: { overview: CallOverview | null; loading: boolean; range: CallRange; onRange: (range: CallRange) => void; decision: DecisionFilter; onDecision: (decision: DecisionFilter) => void; onOpen: (callId: number) => void; /** eingestellte Filter in Worten, z. B. „Taner Tanesco, Kampagne ‚PV Q4‘“ */ scope?: string }) {
  const timeline = overview?.timeline ?? [];
  const longest = useMemo(() => timeline.reduce((max, entry) => Math.max(max, entry.seconds ?? 0), 0), [timeline]);
  const sequence = useMemo(() => groupTimeline(timeline), [timeline]);
  // Uhrzeit-Achse: wenn der Zeitraum genau ein Tag ist (oder alle Gespräche an einem Tag liegen) und es nicht zu viele sind
  const clockDay = useMemo(() => { const chosen = singleDayOf(range); if (chosen) return chosen; const first = timeline.find((entry) => entry.at); return sequence.byHour && first?.at ? new Date(first.at) : null; }, [range.period, range.from, range.to, timeline, sequence.byHour]);
  const clock = useMemo(() => (clockDay && timeline.length <= CLOCK_LIMIT ? clockLayout(timeline, clockDay) : null), [clockDay, timeline]);
  const waveRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ entry: TimelineEntry; x: number } | null>(null);
  const showTip = (entry: TimelineEntry, target: HTMLElement) => {
    const host = waveRef.current?.getBoundingClientRect(); const rect = target.getBoundingClientRect(); if (!host) return;
    const half = 108; const middle = rect.left - host.left + rect.width / 2;
    setTip({ entry, x: Math.max(Math.min(half, host.width / 2), Math.min(Math.max(half, host.width - half), middle)) });
  };
  const custom = Boolean(range.from || range.to); const total = overview?.total ?? 0; const phrase = periodPhrase(range);
  const headline = !overview ? "Gespräche werden geladen …" : total === 0 ? `Keine Gespräche ${phrase}` : `${total.toLocaleString("de-DE")} ${total === 1 ? "Gespräch" : "Gespräche"} ${phrase}`;
  const talk = !overview ? "" : total === 0
    ? `${scope ? `${scope} – s` : "S"}obald der Dialer ein Gespräch meldet, erscheint es hier.`
    : overview.talkSeconds > 0 ? `${scope ? `${scope} – zusammen` : "Zusammen"} ${talkTimeText(overview.talkSeconds)} am Telefon${overview.averageSeconds ? `, im Schnitt ${clockText(overview.averageSeconds)} Minuten je Gespräch` : ""}.` : scope ? `${scope}.` : "";
  const counts: Record<CallDecision, number> = { freigegeben: overview?.approved ?? 0, pruefen: overview?.review ?? 0, zurueckgewiesen: overview?.rejected ?? 0, offen: overview?.open ?? 0 };
  const openHint = overview && (overview.failed || overview.noConsent) ? [overview.failed ? `${overview.failed} fehlgeschlagen` : "", overview.noConsent ? `${overview.noConsent} ohne Einwilligung` : ""].filter(Boolean).join(", ") : MOOD_WORD.offen;
  const decided = counts.freigegeben + counts.pruefen + counts.zurueckgewiesen;
  const density = timeline.length > 140 ? "is-dense" : timeline.length > 70 ? "is-medium" : "";
  const waveKey = `${range.period}|${range.from}|${range.to}|${scope ?? ""}`; // neuer Zeitraum/Filter → die Striche wachsen einmal neu
  const delayOf = (order: number) => `${Math.round(Math.min(order * (460 / Math.max(1, timeline.length)), 460))}ms`;
  const slot = (entry: TimelineEntry, order: number, place?: CSSProperties) => {
    const date = entry.at ? new Date(entry.at) : null; const withDay = !clock && !sequence.byHour;
    const label = `Gespräch ${date ? `${withDay ? `${dayLabel(date)}, ` : ""}${timeText(date)} Uhr` : "ohne Uhrzeit"}${entry.seconds ? `, ${clockText(entry.seconds)} Minuten` : ""}${entry.agent ? `, ${entry.agent}` : ""}, ${DECISION_LABEL[entry.decision]} – öffnen`;
    return <button key={entry.id} type="button" tabIndex={-1} className={`gq-slot is-${entry.mood} ${decision && entry.decision !== decision ? "is-dim" : ""} ${tip?.entry.id === entry.id ? "is-hover" : ""}`} style={{ ...place, ["--h" as string]: barHeight(entry.seconds, longest).toFixed(3), ["--d" as string]: delayOf(order) } as CSSProperties} aria-label={label} onMouseEnter={(event) => showTip(entry, event.currentTarget)} onFocus={(event) => showTip(entry, event.currentTarget)} onBlur={() => setTip(null)} onClick={() => onOpen(entry.id)}><i /></button>;
  };
  let order = 0;
  const trackLabel = total ? `Verlauf: ${timeline.length} Gespräche in zeitlicher Reihenfolge` : "Verlauf: noch keine Gespräche";
  return <section className={`gq-stage ${loading ? "is-loading" : ""}`} aria-label="Übersicht der Gespräche">
    <div className="gq-stage-top cq-filterbar">
      <div className="gq-periods" role="group" aria-label="Zeitraum">{CALL_PERIODS.map(([key, label]) => <button key={key} type="button" className={!custom && range.period === key ? "active" : ""} aria-pressed={!custom && range.period === key} onClick={() => onRange({ period: key, from: "", to: "" })}>{label}</button>)}</div>
      <div className="gq-dates"><label>von<input type="date" aria-label="Datum von" value={range.from} max={range.to || undefined} onChange={(event) => onRange({ ...range, from: event.target.value })} /></label><label>bis<input type="date" aria-label="Datum bis" value={range.to} min={range.from || undefined} onChange={(event) => onRange({ ...range, to: event.target.value })} /></label>{custom && <button type="button" className="gq-reset" onClick={() => onRange({ period: "alle", from: "", to: "" })}>Datum zurücksetzen</button>}</div>
    </div>
    <div className="gq-stage-main">
      <div className="gq-lead">
        <h2 className="gq-count">{headline}</h2>
        {talk && <p className="gq-talk">{talk}</p>}
        <div className={`gq-wave ${clock ? "is-clock" : sequence.byHour ? "is-hours" : "is-days"} ${density} ${decision ? "has-filter" : ""}`} ref={waveRef} onMouseLeave={() => setTip(null)}>
          {clock ? <div className="gq-wave-track" role="group" aria-label={trackLabel} key={waveKey}>
            <div className="gq-clock-bars" style={{ ["--gq-clock-w" as string]: `${clock.width / 10}%` } as CSSProperties}>{clock.bars.map((bar, index) => slot(bar.entry, index, { left: `${bar.x / 10}%` }))}</div>
            {clock.nowX !== null && <span className={`gq-now ${clock.nowX > 93 ? "is-right" : ""}`} style={{ left: `${clock.nowX}%` }} aria-hidden="true"><b>jetzt</b></span>}
            <div className="gq-clock-ticks" aria-hidden="true">{clock.ticks.map((tick) => <span key={tick.hour} className={`gq-tick ${tick.label ? "" : "is-bare"} ${(tick.hour - clock.start) % 2 ? "is-odd" : ""}`} style={{ left: `${tick.x}%` }}>{tick.label && <b>{tick.hour} Uhr</b>}</span>)}</div>
          </div> : <div className={`gq-wave-track ${!sequence.byHour && sequence.groups.length <= 12 ? "has-room" : ""}`} role="group" aria-label={trackLabel} key={waveKey} style={{ ["--gq-groups" as string]: Math.max(1, sequence.groups.length) } as CSSProperties}>
            {sequence.groups.map((group) => <div key={group.key} className="gq-wave-group" style={{ flexGrow: group.entries.length, maxWidth: `max(calc(${group.entries.length} * var(--gq-slot-max)), var(--gq-group-min, 0px))` }}>
              <div className="gq-wave-bars">{group.entries.map((entry) => slot(entry, order++))}</div>
              <span className="gq-wave-label" aria-hidden="true"><b>{group.label}</b><i>{group.short}</i></span>
            </div>)}
          </div>}
          {tip && <div className={`gq-tip is-${tip.entry.mood}`} style={{ left: tip.x }} role="status">
            <b>{tip.entry.at ? `${clock || sequence.byHour ? "" : `${dayLabel(new Date(tip.entry.at))}, `}${timeText(new Date(tip.entry.at))} Uhr` : "Ohne Uhrzeit"}{tip.entry.seconds ? `, ${clockText(tip.entry.seconds)} Min` : ""}</b>
            <span><i aria-hidden="true" />{DECISION_LABEL[tip.entry.decision]}{tip.entry.agent ? ` – ${tip.entry.agent}` : ""}</span>
          </div>}
        </div>
        <p className="gq-wave-note">{total ? <>Jeder Strich ist ein Gespräch: je länger es dauert, desto höher. Ein Klick öffnet es.{overview && overview.timelineHidden > 0 ? ` Zu sehen sind die letzten ${timeline.length} von ${total.toLocaleString("de-DE")}.` : ""}{clock && clock.untimed > 0 ? ` ${clock.untimed} ohne Uhrzeit ${clock.untimed === 1 ? "steht" : "stehen"} nur in der Liste.` : ""}</> : "Hier entsteht der Verlauf – ein Strich je Gespräch."}</p>
      </div>
      <div className={`gq-tally ${decision ? "has-filter" : ""}`} role="group" aria-label="Liste nach Ergebnis filtern">
        {(Object.keys(MOOD_OF_DECISION) as CallDecision[]).map((key) => { const mood = MOOD_OF_DECISION[key]; const on = decision === key; return <button key={key} type="button" className={`gq-tally-item is-${mood} ${on ? "is-on" : ""}`} aria-pressed={on} title={on ? "Filter aufheben – wieder alle Gespräche zeigen" : `Nur „${DECISION_LABEL[key]}“ in der Liste zeigen`} onClick={() => onDecision(on ? "" : key)}>
          <Face mood={mood} size={30} />
          <span className="gq-tally-text"><b>{DECISION_LABEL[key]}</b><small>{key === "offen" ? openHint : MOOD_WORD[mood]}</small></span>
          <strong>{counts[key].toLocaleString("de-DE")}</strong>
        </button>; })}
        <p className="gq-rate">{decision ? <button type="button" className="gq-reset" onClick={() => onDecision("")}>Wieder alle Gespräche zeigen</button> : overview && overview.approvalRate !== null ? <>{overview.approvalRate} % der {decided.toLocaleString("de-DE")} entschiedenen Gespräche sind freigegeben.</> : "Ein Klick auf eine Zeile filtert die Liste."}</p>
      </div>
    </div>
  </section>;
}
