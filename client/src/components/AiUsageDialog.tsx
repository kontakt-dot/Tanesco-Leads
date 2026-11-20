import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { AI_AREAS, niceCeilCents, type AiArea, type AiUsageDay } from "../../../shared/ai-usage";

/**
 * KI-Verbrauch (Klick auf „KI heute“): Was die KI an welchem Tag wofür gekostet hat.
 * Oben heute, 7 Tage und 30 Tage; darunter je Tag eine Säule, aufgeteilt nach Bereich. Ein Klick auf eine Säule zeigt den Tag
 * im Einzelnen: je Bereich die Zwecke mit Zahl der Anfragen und Betrag. Dieselben Zahlen stehen darunter als Tabelle.
 * Farben: fünf feste Töne je Bereich (immer dieselbe Reihenfolge) – Schrift bleibt in der Textfarbe, die Farbe trägt nur die Fläche.
 */
const euro = (cents: number) => `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const euroShort = (cents: number) => `${(cents / 100).toLocaleString("de-DE", { maximumFractionDigits: cents % 100 ? 2 : 0 })} €`;
const dateOf = (day: string) => new Date(`${day}T12:00:00`);
const longDay = (day: string) => dateOf(day).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
const shortDay = (day: string) => dateOf(day).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
const weekdayShort = (day: string) => dateOf(day).toLocaleDateString("de-DE", { weekday: "short" });
const PLOT = 150; // Höhe der Zeichenfläche in px

export default function AiUsageDialog({ onClose, onBudget }: { onClose: () => void; onBudget: () => void }) {
  const history = trpc.leadops.aiUsageHistory.useQuery({ days: 30 }, { retry: false, refetchInterval: 60_000 });
  const data = history.data;
  const [picked, setPicked] = useState<string | null>(null);
  const days = data?.days ?? []; const today = data?.today ?? "";
  const chosen: AiUsageDay | null = days.find((day) => day.day === (picked ?? today)) ?? days[days.length - 1] ?? null;
  // Skala: runde Obergrenze. Die Linie für das Tagesbudget steht nur drin, wenn sie die Säulen nicht zusammendrückt.
  const showBudget = Boolean(data) && data!.budgetCents <= Math.max(100, data!.maxCents) * 1.6;
  const scale = niceCeilCents(Math.max(data?.maxCents ?? 0, showBudget ? data!.budgetCents : 0));
  const ticks = [scale, scale / 2, 0];
  const areasUsed = AI_AREAS.filter((area) => (data?.areas[area.key] ?? 0) > 0 || days.some((day) => day.areas[area.key] > 0));
  const budgetLeft = data ? Math.max(0, data.budgetCents - data.todayCents) : 0; const share = data && data.budgetCents ? Math.min(100, Math.round((data.todayCents / data.budgetCents) * 100)) : 0;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="ai-usage">
      <DialogHeader><DialogTitle>KI-Verbrauch</DialogTitle><DialogDescription>Was die KI gekostet hat – je Tag und wofür. Die Beträge sind ungefähr (gerechnet aus der Menge an Text).</DialogDescription></DialogHeader>
      {history.isLoading ? <p className="au-wait">Wird geladen …</p> : history.error || !data ? <p className="au-wait">{history.error?.message ?? "Der Verbrauch ließ sich nicht laden."}</p> : <>
        <div className="au-tiles">
          <div className={`au-tile ${data.todayCents >= data.budgetCents ? "is-full" : ""}`}><span>Heute</span><strong>{euro(data.todayCents)}</strong><small>von {euro(data.budgetCents)} Tagesbudget{data.todayCents >= data.budgetCents ? " – erreicht" : ` · noch ${euro(budgetLeft)}`}</small><i className="au-meter" role="img" aria-label={`${share} % des Tagesbudgets verbraucht`}><b style={{ width: `${share}%` }} /></i></div>
          <div className="au-tile"><span>Letzte 7 Tage</span><strong>{euro(data.weekCents)}</strong><small>im Schnitt {euro(Math.round(data.weekCents / 7))} am Tag</small></div>
          <div className="au-tile"><span>Letzte 30 Tage</span><strong>{euro(data.totalCents)}</strong><small>{data.totalCalls.toLocaleString("de-DE")} Anfragen an die KI</small></div>
        </div>
        <section className="au-block" aria-label="KI-Kosten je Tag, letzte 30 Tage">
          <div className="au-block-head"><h3>Kosten je Tag</h3><ul className="au-legend" aria-label="Bereiche">{areasUsed.map((area) => <li key={area.key} title={area.hint}><i className={`au-swatch is-${area.key}`} aria-hidden="true" />{area.label}<b>{euro(data.areas[area.key])}</b></li>)}</ul></div>
          {data.totalCents === 0 ? <p className="au-wait">In den letzten 30 Tagen hat die KI nichts gekostet.</p> : <div className="au-chart">
            <div className="au-y" aria-hidden="true">{ticks.map((tick) => <span key={tick}>{euroShort(tick)}</span>)}</div>
            <div className="au-plot" style={{ height: PLOT }}>
              {ticks.map((tick) => <i key={tick} className="au-grid" style={{ bottom: `${(tick / scale) * 100}%` }} aria-hidden="true" />)}
              {showBudget && <i className="au-budget" style={{ bottom: `${(data.budgetCents / scale) * 100}%` }} aria-hidden="true"><em>Tagesbudget {euroShort(data.budgetCents)}</em></i>}
              <div className="au-cols">{days.map((day, index) => { const parts = AI_AREAS.filter((area) => day.areas[area.key] > 0); const isPicked = chosen?.day === day.day; const edge = index < 4 ? "is-left" : index > days.length - 5 ? "is-right" : "";
                return <button key={day.day} type="button" className={`au-col ${isPicked ? "is-on" : ""} ${edge}`} aria-pressed={isPicked} aria-label={`${longDay(day.day)}: ${euro(day.cents)}, ${day.calls} Anfragen`} onClick={() => setPicked(day.day)}>
                  <span className="au-stack">{parts.map((area, position) => <i key={area.key} className={`au-seg is-${area.key} ${position === parts.length - 1 ? "is-top" : ""}`} style={{ height: Math.max(2, Math.round((day.areas[area.key] / scale) * PLOT)) }} />)}</span>
                  <span className="au-tip" role="presentation"><b>{weekdayShort(day.day)}, {shortDay(day.day)}{day.day === today ? " (heute)" : ""}</b><em>{euro(day.cents)} · {day.calls.toLocaleString("de-DE")} Anfragen</em>{parts.map((area) => <span key={area.key}><i className={`au-swatch is-${area.key}`} />{area.label}<u>{euro(day.areas[area.key])}</u></span>)}{!parts.length && <span>kein Verbrauch</span>}</span>
                </button>; })}</div>
            </div>
            <div className="au-x" aria-hidden="true">{days.map((day, index) => { const fromEnd = days.length - 1 - index; return <span key={day.day} className={chosen?.day === day.day ? "is-on" : ""}>{fromEnd % 7 === 0 || chosen?.day === day.day ? shortDay(day.day) : ""}</span>; })}</div>
          </div>}
        </section>
        {chosen && <section className="au-block au-day" aria-live="polite">
          <div className="au-block-head"><h3>{longDay(chosen.day)}{chosen.day === today ? " – heute" : ""}</h3><p><b>{euro(chosen.cents)}</b> · {chosen.calls.toLocaleString("de-DE")} {chosen.calls === 1 ? "Anfrage" : "Anfragen"}</p></div>
          {!chosen.parts.length ? <p className="au-wait">An diesem Tag hat die KI nichts gekostet.</p> : <div className="au-areas">{AI_AREAS.filter((area) => chosen.parts.some((part) => part.area === area.key)).map((area) => { const mine = chosen.parts.filter((part) => part.area === area.key); const sum = chosen.areas[area.key as AiArea]; const percent = chosen.cents ? Math.round((sum / chosen.cents) * 100) : 0;
            return <div key={area.key} className="au-area"><div className="au-area-head"><i className={`au-swatch is-${area.key}`} aria-hidden="true" /><b>{area.label}</b><span>{percent} %</span><strong>{euro(sum)}</strong></div>
              <ul>{mine.map((part) => <li key={part.purpose}><span>{part.label}</span><em>{part.calls.toLocaleString("de-DE")} {part.calls === 1 ? "Anfrage" : "Anfragen"}</em><b>{euro(part.cents)}</b></li>)}</ul></div>; })}</div>}
        </section>}
        <details className="au-table"><summary>Alle Tage als Tabelle</summary><div className="au-table-scroll"><table><thead><tr><th>Tag</th>{areasUsed.map((area) => <th key={area.key}>{area.label}</th>)}<th>Anfragen</th><th>Gesamt</th></tr></thead><tbody>{[...days].reverse().map((day) => <tr key={day.day} className={chosen?.day === day.day ? "is-on" : ""}><td><button type="button" onClick={() => setPicked(day.day)}>{weekdayShort(day.day)}, {shortDay(day.day)}</button></td>{areasUsed.map((area) => <td key={area.key}>{day.areas[area.key] ? euro(day.areas[area.key]) : "–"}</td>)}<td>{day.calls ? day.calls.toLocaleString("de-DE") : "–"}</td><td><b>{euro(day.cents)}</b></td></tr>)}</tbody></table></div></details>
        <footer className="au-foot"><p>Das Tagesbudget zählt alles zusammen. Ist es erreicht, pausiert nur die KI im Hintergrund der E-Mail-Kampagnen (Vorschreiben und Prüfen) bis morgen. Gespräche werden weiter bewertet, und was du selbst anklickst, geht immer.</p><button type="button" className="au-budget-btn" onClick={onBudget}>Tagesbudget ändern</button></footer>
      </>}
    </DialogContent>
  </Dialog>;
}
