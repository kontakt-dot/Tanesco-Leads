import React, { useState } from "react";
import { trpc } from "@/lib/trpc";

const number = (value: number | undefined) => (typeof value === "number" ? value.toLocaleString("de-DE") : "–");
const dayLabel = (day: string, long = false) => new Date(`${day}T12:00:00Z`).toLocaleDateString("de-DE", long ? { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" } : { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const leads = (count: number) => `${count.toLocaleString("de-DE")} ${count === 1 ? "Lead" : "Leads"}`;

/**
 * Zahlen über der Leads-Tabelle: alle Leads, heute neu, die letzten 7 Tage, bereit zum Ausliefern – und die letzten 14 Tage als Säulen.
 * Jede Kachel und jede Säule ist ein Filter: ein Klick zeigt genau diese Leads in der Tabelle.
 */
export default function LeadsOverviewStrip({ active, activeDay, onAll, onToday, onWeek, onReady, onDay }: {
  active: "all" | "today" | "week" | "ready" | "day" | null; activeDay: string | null;
  onAll: () => void; onToday: () => void; onWeek: () => void; onReady: () => void; onDay: (day: string) => void;
}) {
  const overview = trpc.leadops.leadsOverview.useQuery(undefined, { retry: false, refetchInterval: 60_000, placeholderData: (previous) => previous });
  const [hover, setHover] = useState<number | null>(null);
  const data = overview.data; const days = data?.days ?? []; const max = Math.max(1, ...days.map((day) => day.count));
  const today = days[days.length - 1]?.day ?? null; const shown = hover !== null ? days[hover] : null;
  const tile = (key: "all" | "today" | "week" | "ready", label: string, value: number | undefined, note: string, onClick: () => void) => <button type="button" className={`lo-tile ${active === key ? "is-active" : ""}`} aria-pressed={active === key} onClick={onClick}><strong>{number(value)}</strong><span>{label}</span><small>{note}</small></button>;
  return <section className="lo-strip" aria-label="Leads im Überblick">
    {tile("all", "Leads gesamt", data?.total, "alle anzeigen", onAll)}
    {tile("today", "Heute neu", data?.today, data ? `gestern ${number(data.yesterday)}` : " ", onToday)}
    {tile("week", "Letzte 7 Tage", data?.week, "mit heute", onWeek)}
    {tile("ready", "Bereit zum Ausliefern", data?.ready, data ? `${number(data.delivered)} ausgeliefert` : " ", onReady)}
    <div className="lo-chart">
      <header><span>Neue Leads je Tag</span><small>{shown ? `${dayLabel(shown.day, true)} · ${leads(shown.count)}` : "14 Tage – Säule anklicken für den Tag"}</small></header>
      <div className="lo-bars" role="group" aria-label="Neue Leads je Tag, letzte 14 Tage" onMouseLeave={() => setHover(null)}>
        {days.map((day, index) => <button key={day.day} type="button" className={`lo-bar ${day.day === today ? "is-today" : ""} ${activeDay === day.day ? "is-active" : ""} ${day.count ? "" : "is-empty"}`} style={{ ["--h" as string]: `${Math.max(day.count ? 10 : 0, Math.round((day.count / max) * 100))}%` } as React.CSSProperties} aria-label={`${dayLabel(day.day, true)}: ${leads(day.count)}`} aria-pressed={activeDay === day.day} title={`${dayLabel(day.day, true)}: ${leads(day.count)}`} onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} onClick={() => onDay(day.day)}><i /></button>)}
        {!days.length && <p className="lo-wait">Zahlen werden geladen …</p>}
      </div>
      <footer><span>{days[0] ? dayLabel(days[0].day) : ""}</span><span>heute</span></footer>
      <table className="sr-only"><caption>Neue Leads je Tag</caption><thead><tr><th>Tag</th><th>Leads</th></tr></thead><tbody>{days.map((day) => <tr key={day.day}><td>{dayLabel(day.day, true)}</td><td>{day.count}</td></tr>)}</tbody></table>
    </div>
  </section>;
}
