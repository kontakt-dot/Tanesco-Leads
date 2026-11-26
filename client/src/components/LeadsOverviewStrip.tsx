import React, { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Clock, Equal, Flag, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { hintText, statusSplit, todayComparison, waitingAge, weekComparison, type OverviewHint, type OverviewTone } from "../../../shared/lead-overview";
import { periodComparison, periodSplit, type TilePeriod } from "../../../shared/lead-period";

const number = (value: number | undefined) => (typeof value === "number" ? value.toLocaleString("de-DE") : "–");
const euro = (value: number) => value.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const dayLabel = (day: string, long = false) => new Date(`${day}T12:00:00Z`).toLocaleDateString("de-DE", long ? { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" } : { day: "2-digit", month: "2-digit", timeZone: "UTC" });
/** „Mo“, „Di“ … – zwei Buchstaben unter jeder Säule. */
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "short", timeZone: "UTC" }).replace(".", "").slice(0, 2);
const leads = (count: number) => `${count.toLocaleString("de-DE")} ${count === 1 ? "Lead" : "Leads"}`;
/** Angaben mit „ · “ dazwischen brechen nur am Punkt um: „gestern bis jetzt 11 ·“ / „ganzer Tag 11“ – nie mitten in einer Angabe. */
const parts = (text: string): React.ReactNode => { const list = text.split(" · "); return list.length < 2 ? text : list.flatMap((part, index) => [index ? " " : null, <span key={index} className="lo-part">{part}{index < list.length - 1 ? " ·" : ""}</span>]); };
const toneIcon = (arrow: "↑" | "↓" | "=") => (arrow === "↑" ? <ArrowUp aria-hidden="true" /> : arrow === "↓" ? <ArrowDown aria-hidden="true" /> : <Equal aria-hidden="true" />);

export type OverviewFilter = "all" | "today" | "week" | "ready" | "delivered" | "day" | null;

/** Ausgeblendete Hinweise: bleiben drei Tage weg (nur in diesem Browser). Ändert sich der Hinweis – andere Kategorie –, kommt er wieder. */
const HIDDEN_KEY = "tanesco-lead-hints-hidden"; const HIDE_MS = 3 * 86_400_000;
const hintKey = (hint: OverviewHint) => `${hint.kind}:${hint.categories.join("|")}`;
function readHidden(): Record<string, number> {
  try { const raw = JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? "{}") as Record<string, number>; const now = Date.now(); return Object.fromEntries(Object.entries(raw).filter(([, until]) => typeof until === "number" && until > now)); } catch { return {}; }
}
/** Ohne Neuladen auf eine andere Seite der Software wechseln (der Link funktioniert auch ohne das). */
function openPage(event: React.MouseEvent<HTMLAnchorElement>, page: string) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  try { event.preventDefault(); window.history.pushState(null, "", `/?page=${encodeURIComponent(page)}`); window.dispatchEvent(new PopStateEvent("popstate")); } catch { window.location.assign(`/?page=${encodeURIComponent(page)}`); }
}

/**
 * Über der Leads-Tabelle: der Weg der Leads auf einen Blick – eine ruhige Leiste, von links nach rechts.
 *  Alle Leads → heute neu (gegen gestern um dieselbe Zeit) → bereit zum Ausliefern (wie alt der älteste ist)
 *  → ausgeliefert (7 Tage, heute). Daneben die letzten 14 Tage: die letzten 7 gegen die 7 davor.
 * Seit v377 ohne „Reklamiert“ – auf dieser Seite wird nicht mit Reklamationen gearbeitet (die stehen unter „Reklamationen“).
 * Je Zahl eine Zeile; der Rest (wo alle Leads stehen, gestern, was noch wartet, Wert) steht im Hinweis beim Überfahren.
 * Jede Zahl und jede Säule ist ein Filter. Darunter steht nur dann ein Hinweis, wenn etwas zu tun ist.
 */
export default function LeadsOverviewStrip({ active, activeDay, period, onPeriod, onAll, onToday, onWeek, onReady, onDelivered, onDay, onWaiting }: {
  active: OverviewFilter; activeDay: string | null;
  /** Gewählter Zeitraum der Tabelle (seit v366): Die zweite Kachel heißt dann wie der Zeitraum, Bereit/Ausgeliefert zählen nur seine Leads */
  period: TilePeriod | null; onPeriod: () => void;
  onAll: () => void; onToday: () => void; onWeek: () => void; onReady: () => void; onDelivered: () => void; onDay: (day: string) => void;
  /** Die freigegebenen Leads zeigen – bei einer einzelnen Kategorie nur die dieser Kategorie */
  onWaiting: (categoryId: number | null) => void;
}) {
  const overview = trpc.leadops.leadsOverview.useQuery(undefined, { retry: false, refetchInterval: 60_000, placeholderData: (previous) => previous });
  const periodInput = useMemo(() => ({ from: period?.from ?? null, to: period?.to ?? null, previousFrom: period?.previousFrom ?? null, previousTo: period?.previousTo ?? null }), [period]);
  const periodData = trpc.leadops.leadsPeriod.useQuery(periodInput, { enabled: Boolean(period), retry: false, refetchInterval: 60_000 });
  const scoped = period && periodData.data ? periodSplit(periodData.data.statuses) : null;
  const periodCompare = period && periodData.data ? periodComparison(periodData.data.total, periodData.data.previous, period.versus) : null;
  const [hover, setHover] = useState<number | null>(null); const [hidden, setHidden] = useState<Record<string, number>>({});
  useEffect(() => { setHidden(readHidden()); }, []);
  const data = overview.data; const days = data?.days ?? []; const max = Math.max(1, ...days.map((day) => day.count));
  const today = days[days.length - 1]?.day ?? null; const shown = hover !== null ? days[hover] : null;
  const peak = days.reduce((best, day, index) => (day.count > (days[best]?.count ?? 0) ? index : best), 0);
  const split = data?.status ? statusSplit(data.status) : []; const splitTotal = split.reduce((all, part) => all + part.count, 0);
  const todayCompare = data ? todayComparison(data.today, data.yesterdaySoFar ?? 0) : null;
  const weekCompare = data ? weekComparison(data.week, data.previousWeek ?? 0) : null;
  const age = data ? waitingAge(data.oldestReadyAt ?? null) : null;
  const waitingElse = data?.status ? [data.status.neu ? `${number(data.status.neu)} neu` : "", data.status.hängend ? `${number(data.status.hängend)} hängend` : ""].filter(Boolean).join(" · ") : "";
  const hints = (data?.hints ?? []).filter((hint) => !hidden[hintKey(hint)]).slice(0, 2);
  const hide = (hint: OverviewHint) => { const next = { ...readHidden(), [hintKey(hint)]: Date.now() + HIDE_MS }; setHidden(next); try { window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(next)); } catch { /* ohne Speicher bleibt der Hinweis bis zum Neuladen weg */ } };

  /** Aussage unter der Zahl. Das Zeichen hängt am ersten Wort – bricht der Satz um, bleibt es nicht allein am Rand stehen. */
  const insight = (tone: OverviewTone | "leise", icon: React.ReactNode, text: string) => {
    const at = text.indexOf(" "); const head = icon && at > 0 ? text.slice(0, at) : ""; const tail = head ? text.slice(at) : text;
    return <span className={`lo-insight is-${tone}`}>{head ? <span className="lo-part">{icon}{head}</span> : icon}{parts(tail)}</span>;
  };
  /** Eine Zahl der Leiste: Name, Zahl, eine Zeile darunter. Was sonst noch dazugehört, steht im Hinweis beim Überfahren. */
  const tile = (key: Exclude<OverviewFilter, "day" | "week" | null>, label: string, dot: string | null, value: number | undefined, onClick: () => void, body: React.ReactNode, foot: string, title?: string, on = active === key) =>
    <button type="button" className={`lo-tile is-${key} ${on ? "is-active" : ""}`} aria-pressed={on} onClick={onClick} title={[foot, title].filter(Boolean).join(" – ") || undefined}>
      <span className="lo-label">{dot && <i className={`lo-dot is-${dot}`} aria-hidden="true" />}{label}</span>
      <strong>{number(value)}</strong>
      {body}
    </button>;

  return <div className="lo-wrap">
    <section className="lo-strip" aria-label="Leads im Überblick">
      <div className="lo-tiles">
        {tile("all", "Leads gesamt", null, data?.total, onAll,
          insight("leise", null, "alle anzeigen"),
          "", splitTotal ? split.filter((part) => part.count > 0).map((part) => `${number(part.count)} ${part.label} (${part.share} %)`).join(" · ") : undefined)}
        {period ? tile("today", period.label, null, periodData.data?.total, onPeriod,
          periodCompare ? insight(periodCompare.tone, toneIcon(periodCompare.arrow), periodCompare.text) : insight("leise", null, periodData.data && !period.versus ? "ohne Vergleich" : " "),
          period.versus && typeof periodData.data?.previous === "number" ? `${period.versus.charAt(0).toUpperCase()}${period.versus.slice(1)}: ${number(periodData.data.previous)}` : "",
          period.versus ? `Verglichen wird mit ${period.versus}${period.running ? " bis zur selben Uhrzeit" : ""}.` : "Vor diesem Tag gibt es keinen gleich langen Zeitraum zum Vergleichen.", active === "today" || active === "day" || active === "week")
        : tile("today", "Heute neu", null, data?.today, onToday,
          todayCompare ? insight(todayCompare.tone, toneIcon(todayCompare.arrow), todayCompare.text) : insight("ruhig", null, " "),
          data ? `gestern bis jetzt ${number(data.yesterdaySoFar ?? 0)} · ganzer Tag ${number(data.yesterday)}` : "",
          data && today ? `Verglichen wird mit gestern bis zur selben Uhrzeit. ${dayLabel(days[days.length - 8]?.day ?? today, true).split(",")[0]} vor einer Woche: ${leads(data.sameDayLastWeek ?? 0)}.` : undefined)}
        {period ? tile("ready", "Bereit zum Ausliefern", "bereit", scoped?.ready, onReady,
          !scoped ? insight("ruhig", null, " ") : !scoped.total ? insight("leise", null, `keine Leads ${period.scope}`) : scoped.ready ? insight("ruhig", null, period.scope) : insight("gut", <Check aria-hidden="true" />, `alles ${period.scope} ist raus`),
          "", `Freigegebene Leads ${period.scope}, die noch an keinen Käufer gegangen sind`)
        : tile("ready", "Bereit zum Ausliefern", "bereit", data?.ready, onReady,
          !data ? insight("ruhig", null, " ") : data.ready ? (age ? insight(age.tone, <Clock aria-hidden="true" />, age.text) : insight("ruhig", null, " ")) : insight("gut", <Check aria-hidden="true" />, "alles Freigegebene ist raus"),
          waitingElse ? `dazu ${waitingElse}` : "", "Freigegebene Leads, die noch an keinen Käufer gegangen sind")}
        {period ? tile("delivered", "Ausgeliefert", "ausgeliefert", scoped?.delivered, onDelivered,
          !scoped ? insight("ruhig", null, " ") : scoped.delivered ? insight("ruhig", null, `${number(Math.round((scoped.delivered / Math.max(1, scoped.total)) * 100))} % ${period.scope}`) : insight("ruhig", null, "noch keiner"),
          "", `Leads ${period.scope}, die an einen Käufer gegangen sind`)
        : tile("delivered", "Ausgeliefert", "ausgeliefert", data?.delivered, onDelivered,
          !data ? insight("ruhig", null, " ") : data.delivered || data.deliveredWeek ? insight("ruhig", null, `${number(data.deliveredWeek ?? 0)} in 7 Tagen · heute ${number(data.deliveredToday ?? 0)}`) : insight("ruhig", null, "noch keiner"),
          data ? ((data.valueWeek ?? 0) > 0 ? `${euro(data.valueWeek)} in 7 Tagen` : data.total && data.delivered ? `${Math.round((data.delivered / data.total) * 100)} % aller Leads` : "") : "",
          "Leads, die an einen Käufer gegangen sind. Der Betrag ist die Summe ihrer Preise – ohne Abgelehnte und Reklamierte.")}
      </div>
      <div className="lo-chart">
        <header>
          <span className="lo-chart-title">Neue Leads je Tag</span>
          {shown ? <small className="lo-readout"><b>{leads(shown.count)}</b> · {dayLabel(shown.day, true)}</small>
            : data ? <span className="lo-weeks">
              <button type="button" className={`lo-week ${active === "week" ? "is-active" : ""}`} aria-pressed={active === "week"} onClick={onWeek} title="Die Leads der letzten 7 Tage in der Tabelle zeigen"><i className="lo-key is-recent" aria-hidden="true" />Letzte 7 Tage <b>{number(data.week)}</b></button>
              <span className="lo-prev"><i className="lo-key is-before" aria-hidden="true" />davor <b>{number(data.previousWeek ?? 0)}</b></span>
              {weekCompare && insight(weekCompare.tone, toneIcon(weekCompare.arrow), weekCompare.text)}
            </span> : <small className="lo-readout">14 Tage</small>}
        </header>
        <div className="lo-bars" role="group" aria-label="Neue Leads je Tag, letzte 14 Tage – eine Säule anklicken zeigt die Leads des Tages" onMouseLeave={() => setHover(null)}>
          {days.map((day, index) => {
            const label = `${dayLabel(day.day, true)}: ${leads(day.count)}`; const tagged = day.count > 0 && (index === peak || day.day === today);
            return <button key={day.day} type="button" className={`lo-bar ${index >= days.length - 7 ? "is-recent" : "is-before"} ${index === days.length - 7 ? "is-week-start" : ""} ${day.day === today ? "is-today" : ""} ${activeDay === day.day ? "is-active" : ""} ${day.count ? "" : "is-empty"}`} style={{ ["--h" as string]: `${day.count ? Math.max(8, Math.round((day.count / max) * 100)) : 0}%` } as React.CSSProperties} aria-label={label} aria-pressed={activeDay === day.day} title={label} onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} onClick={() => onDay(day.day)}>
              <span className="lo-col">{tagged && <b>{number(day.count)}</b>}<i /></span>
              <em>{day.day === today ? "heute" : weekday(day.day)}</em>
            </button>;
          })}
          {!days.length && <p className="lo-wait">Zahlen werden geladen …</p>}
        </div>
        <table className="sr-only"><caption>Neue Leads je Tag</caption><thead><tr><th>Tag</th><th>Leads</th></tr></thead><tbody>{days.map((day) => <tr key={day.day}><td>{dayLabel(day.day, true)}</td><td>{day.count}</td></tr>)}</tbody></table>
      </div>
    </section>
    {hints.length > 0 && <ul className="lo-hints" aria-label="Was jetzt zu tun ist">
      {hints.map((hint) => { const info = hintText(hint); return <li key={hintKey(hint)} className={`lo-hint is-${hint.kind}`}>
        <div className="lo-hint-text"><Flag aria-hidden="true" /><p>{info.text}</p></div>
        <div className="lo-hint-actions">
          {info.showLeads && <button type="button" className="lo-hint-more" onClick={() => onWaiting(hint.categoryIds.length === 1 ? hint.categoryIds[0] : null)}>{hint.leads === 1 ? "Diesen Lead zeigen" : "Diese Leads zeigen"}</button>}
          <a className="lo-hint-go" href={`/?page=${encodeURIComponent(info.page)}`} onClick={(event) => openPage(event, info.page)}>{info.action}</a>
          <button type="button" className="lo-hint-close" aria-label="Hinweis für drei Tage ausblenden" title="Für drei Tage ausblenden" onClick={() => hide(hint)}><X aria-hidden="true" /></button>
        </div>
      </li>; })}
    </ul>}
  </div>;
}
