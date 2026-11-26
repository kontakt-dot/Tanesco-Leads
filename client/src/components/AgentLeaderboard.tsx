import { AgentFace, Split } from "@/components/AgentFace";
import { useAvatarOf } from "@/components/AvatarUpload";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { CallPeriodControl, callRangeInput, rangeOfSpan, type CallRange } from "@/components/CallScoreboard";
import { confirmAction } from "@/lib/confirm";
import { AGENT_LEVELS, QUOTE_MIN_CALLS, berlinDay, type AgentAwardKey } from "../../../shared/agent-ranking";
import { callPeriodSpan, callSpanTexts, spanHasToday, type CallSpanTexts } from "../../../shared/call-period";
import { ArrowDown, ArrowUp, CalendarCheck, ChevronDown, ChevronRight, Crown, Flame, Maximize2, PhoneCall, Search, Target, Timer, Trash2, TrendingUp, Undo2, X, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

type Report = inferRouterOutputs<AppRouter>["leadops"]["dialerAgentReport"];
type Agent = Report["agents"][number];
type Award = Report["awards"][number];
/** Womit die Gesprächsliste geöffnet wird: derselbe Zeitraum und dieselbe Kampagne wie in der Bestenliste. */
export type LeaderboardFilter = { range: CallRange; campaign: string | null };
/** Zeitraum beim Öffnen der Seite – dorthin führt auch „Datum zurücksetzen“. */
const START_RANGE: CallRange = { period: "30", from: "", to: "" };
const GONE_DAY = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
/** So viele Plätze zeigt die Rangliste, bevor „Alle anzeigen“ gedrückt wird – bei 80 Agenten bleibt die Seite kurz. */
const TOP_ROWS = 10;
const leadWord = (count: number) => (count === 1 ? "Lead" : "Leads");
const dayWord = (count: number) => (count === 1 ? "Tag" : "Tage");
const placeWord = (count: number) => (count === 1 ? "Platz" : "Plätze");
const talkTime = (seconds: number) => (seconds >= 3600 ? `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min` : `${Math.round(seconds / 60)} min`);
const LONG_DAY = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const longDay = (day: string) => LONG_DAY.format(new Date(`${day}T12:00:00Z`));
const CLOCK = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
/** „vor 4 Min.“ – gemessen am Stand der Liste, nicht an der Uhr des Geräts. */
function ago(value: Date | string | null, now: Date): string {
  if (!value) return "";
  const minutes = Math.floor((now.getTime() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "gerade eben"; if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24); return days === 1 ? "gestern" : `vor ${days} Tagen`;
}
const keyOf = (agent: Pick<Agent, "userId" | "name">) => (agent.userId ? `u${agent.userId}` : `n:${agent.name}`);
/** Wer weniger Bewegung möchte (Einstellung des Geräts), bekommt die Zahlen sofort und kein Konfetti. */
const prefersCalm = () => typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Zahl, die hochzählt, wenn sie sich ändert – beim ersten Zeigen von null. */
function Count({ value }: { value: number }) {
  const [shown, setShown] = useState(() => (prefersCalm() ? value : 0)); const last = useRef(shown);
  useEffect(() => {
    if (prefersCalm() || typeof requestAnimationFrame !== "function") { last.current = value; setShown(value); return; }
    const begin = last.current; if (begin === value) return;
    const started = performance.now(); let frame = 0;
    const step = (time: number) => { const part = Math.min(1, (time - started) / 700); const next = Math.round(begin + (value - begin) * (1 - (1 - part) ** 3)); last.current = next; setShown(next); if (part < 1) frame = requestAnimationFrame(step); };
    frame = requestAnimationFrame(step); return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span className="bl-count" data-value={value}>{shown}</span>;
}

/** Auf- oder Abstieg gegenüber dem Abschnitt davor – oder „neu“. Unverändert bleibt leer: so fallen die Bewegungen auf. */
function Move({ agent, before }: { agent: Agent; before: string }) {
  if (agent.rank === null) return null;
  if (agent.isNew) return <span className="bl-move is-new" title="Neu dabei – vor diesem Zeitraum noch ohne Gespräche">neu</span>;
  if (!agent.rankChange || agent.previousRank === null) return null;
  const up = agent.rankChange > 0; const steps = Math.abs(agent.rankChange); const text = `${steps} ${placeWord(steps)} ${up ? "gutgemacht" : "verloren"}`;
  return <span className={`bl-move ${up ? "is-up" : "is-down"}`} title={`${text} – ${before} auf Platz ${agent.previousRank}`}>{up ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}{steps}<span className="sr-only"> {placeWord(steps)} {up ? "gutgemacht" : "verloren"}</span></span>;
}
const levelTitle = (agent: Agent) => `${agent.approvedAllTime} ${leadWord(agent.approvedAllTime)} insgesamt${agent.level.next ? ` – noch ${agent.level.next.missing} bis „${agent.level.next.name}“` : " – höchste Stufe"}`;
const Level = ({ agent }: { agent: Agent }) => <span className={`bl-level is-l${agent.level.index}`} title={levelTitle(agent)}>{agent.level.name}</span>;
/** Abstand nach vorn: wie viele Leads bis zum Platz davor – der Erste sieht seinen Vorsprung. */
function gapText(agent: Agent, second: Agent | undefined): string {
  if (agent.rank === 1) { if (!second) return ""; const lead = agent.approved - second.approved; return lead > 0 ? `${lead} ${leadWord(lead)} Vorsprung` : "gleichauf mit Platz 2"; }
  if (!agent.gap) return "";
  return agent.gap.missing === 0 ? `gleichauf mit Platz ${agent.gap.rank}` : `noch ${agent.gap.missing} bis Platz ${agent.gap.rank}`;
}

const AWARDS: Record<AgentAwardKey, { icon: LucideIcon; title: string; value: (award: Award) => string; note: (award: Award) => string }> = {
  quote: { icon: Target, title: "Beste Quote", value: (award) => `${award.value} %`, note: (award) => `grün bei ${award.extra} bewerteten Gesprächen` },
  serie: { icon: Flame, title: "Längste Serie", value: (award) => `${award.value} ${dayWord(award.value)}`, note: () => "jeden Arbeitstag mindestens ein Lead" },
  tag: { icon: Zap, title: "Bester Tag", value: (award) => `${award.value} ${leadWord(award.value)}`, note: (award) => (typeof award.extra === "string" ? `am ${longDay(award.extra)}` : "an einem Tag") },
  aufsteiger: { icon: TrendingUp, title: "Aufsteiger", value: (award) => `+${award.value} ${placeWord(award.value)}`, note: (award) => (typeof award.extra === "number" ? `von Platz ${award.extra} auf Platz ${award.extra - award.value}` : "nach oben") },
  gespraeche: { icon: PhoneCall, title: "Meiste Gespräche", value: (award) => String(award.value), note: () => "geführt im Zeitraum" },
  telefon: { icon: Timer, title: "Am Telefon", value: (award) => talkTime(award.value), note: () => "längste Gesprächszeit im Zeitraum" },
  termine: { icon: CalendarCheck, title: "Meiste Termine", value: (award) => String(award.value), note: () => "über den eigenen Dialer" },
};

/** Was die Seite zuletzt gesehen hat – je Zeitraum und Kampagne. Bleibt beim Wechsel zu den Gesprächen erhalten: Wer dort ein Gespräch freigibt und zurückkommt, sieht den neuen Lead gefeiert. */
type Seen = { at: number; day: string; leads: Map<string, number>; levels: Map<string, number> };
const seen = new Map<string, Seen>();
type Cheer = { id: number; text: string; keys: string[] };
/** Vergleicht den neuen Stand mit dem zuletzt gesehenen: Wer hat Leads dazugewonnen, wer ist eine Stufe aufgestiegen? */
function cheerFor(data: Report): Cheer | null {
  const key = `${data.period}|${data.span.fromDay ?? ""}|${data.span.toDay ?? ""}|${data.campaign ?? ""}`; const before = seen.get(key); const at = Date.now();
  seen.set(key, { at, day: data.today, leads: new Map(data.agents.map((agent) => [keyOf(agent), agent.approved])), levels: new Map(data.agents.map((agent) => [keyOf(agent), agent.level.index])) });
  if (!before || before.day !== data.today || at - before.at > 30 * 60_000) return null;
  const real = data.agents.filter((agent) => agent.rank !== null);
  // Mehr als neun Leads auf einmal ist kein Lauf, sondern eine Umbenennung oder Zusammenführung – das wird nicht gefeiert
  const gains = real.map((agent) => ({ agent, plus: agent.approved - (before.leads.get(keyOf(agent)) ?? 0) })).filter((item) => item.plus > 0 && item.plus <= 9).sort((a, b) => b.plus - a.plus || (a.agent.rank ?? 0) - (b.agent.rank ?? 0));
  const climbed = real.filter((agent) => { const old = before.levels.get(keyOf(agent)); return old !== undefined && agent.level.index > old; });
  if (!gains.length && !climbed.length) return null;
  const parts: string[] = [];
  if (gains.length === 1) parts.push(`${gains[0].plus === 1 ? "Neuer Lead" : `${gains[0].plus} neue Leads`} für ${gains[0].agent.name} – jetzt ${gains[0].agent.approved}.`);
  else if (gains.length > 1) parts.push(`${gains.reduce((sum, item) => sum + item.plus, 0)} neue Leads: ${gains.slice(0, 3).map((item) => item.agent.name).join(", ")}${gains.length > 3 ? ` und ${gains.length - 3} weitere` : ""}.`);
  for (const agent of climbed.slice(0, 2)) parts.push(`${agent.name} ist jetzt ${agent.level.name}.`);
  return { id: at, text: parts.join(" "), keys: Array.from(new Set([...gains.map((item) => keyOf(item.agent)), ...climbed.map(keyOf)])) };
}
/** Nur für Tests: vergisst, was die Seite zuletzt gesehen hat. */
export const forgetLeaderboard = () => seen.clear();

const CONFETTI = Array.from({ length: 26 }, (_, index) => ({ left: (index * 37 + 11) % 100, delay: ((index * 53) % 40) / 100, turn: (index * 97) % 360, drift: ((index * 29) % 60) - 30, tone: index % 4 }));
const Confetti = () => <span className="bl-confetti" aria-hidden="true">{CONFETTI.map((piece, index) => <i key={index} className={`is-c${piece.tone}`} style={{ left: `${piece.left}%`, animationDelay: `${piece.delay}s`, "--bl-turn": `${piece.turn}deg`, "--bl-drift": `${piece.drift}px` } as CSSProperties} />)}</span>;

/** Die ersten drei auf dem Treppchen – in der Mitte der Erste. Aufs Treppchen kommt nur, wer mindestens einen Lead hat; sonst bleibt die Stufe frei. */
function Podium({ top, second, pictureOf, fresh, before, hasToday }: { top: Agent[]; second: Agent | undefined; pictureOf: (agent: Agent) => string | null; fresh: Set<string>; before: string; /** liegt heute im Zeitraum? Nur dann steht „+2 heute“ da */ hasToday: boolean }) {
  return <ol className="bl-podium" aria-label="Die ersten drei">{[0, 1, 2].map((index) => { const agent = top[index]; const place = index + 1;
    if (!agent) return <li key={place} className={`bl-pod is-p${place} is-empty`}><span className="bl-pod-free">{top.length === 0 && place === 1 ? "Wer holt den ersten Lead?" : `Platz ${place} ist noch frei`}</span><div className="bl-step" aria-hidden="true"><span>{place}</span></div></li>;
    const gap = gapText(agent, second);
    return <li key={keyOf(agent)} className={`bl-pod is-p${place} ${fresh.has(keyOf(agent)) ? "is-fresh" : ""}`} aria-label={`Platz ${place}: ${agent.name}, ${agent.approved} ${leadWord(agent.approved)}`}>
      <div className="bl-pod-top">
        <span className="bl-pod-face">{place === 1 && <Crown className="bl-crown" aria-hidden="true" />}<AgentFace name={agent.name} avatarUrl={pictureOf(agent)} /></span>
        <b className="bl-pod-name" title={agent.name}>{agent.name}</b>
        <span className="bl-pod-sub"><span title={levelTitle(agent)}>{agent.level.name}</span><Move agent={agent} before={before} /></span>
      </div>
      <div className="bl-pod-score"><Count value={agent.approved} /><span>{leadWord(agent.approved)}</span></div>
      <ul className="bl-pod-facts">
        {agent.greenRate !== null && <li title="Anteil grüner an den bewerteten Gesprächen">{agent.greenRate} % Quote</li>}
        {agent.streak >= 2 && <li className="is-flame" title={`${agent.streak} Arbeitstage in Folge mit mindestens einem Lead`}><Flame aria-hidden="true" />{agent.streak} {dayWord(agent.streak)}</li>}
        {hasToday && agent.approvedToday > 0 && <li className="is-today" title="Leads heute">+{agent.approvedToday} heute</li>}
      </ul>
      <div className="bl-step" aria-hidden="true"><span>{place}</span>{gap && <small>{gap}</small>}</div>
    </li>; })}</ol>;
}

/** Zahlen der ganzen Mannschaft – mit dem Vergleich zum Abschnitt davor. */
function Team({ data, texts, hasToday }: { data: Report; texts: CallSpanTexts; hasToday: boolean }) {
  const totals = data.totals; const quote = totals.evaluated ? Math.round((totals.approved / totals.evaluated) * 100) : null; const beforeCount = totals.approvedBefore;
  // Ein einzelner Tag („Heute“ läuft noch): Dort steht der Vergleichswert als Zahl, nicht als Prozent
  const change = beforeCount === null || texts.single || beforeCount === 0 ? null : Math.round(((totals.approved - beforeCount) / beforeCount) * 100);
  return <div className="bl-team">
    <span className="bl-team-label">Team {texts.inText}</span>
    <b className="bl-team-score"><Count value={totals.approved} /><span>{leadWord(totals.approved)}</span></b>
    {change !== null ? <span className={`bl-team-change ${change > 0 ? "is-up" : change < 0 ? "is-down" : ""}`} title={`${beforeCount} ${leadWord(beforeCount ?? 0)} ${texts.before}`}>{change > 0 ? <ArrowUp aria-hidden="true" /> : change < 0 ? <ArrowDown aria-hidden="true" /> : null}{change > 0 ? "+" : change < 0 ? "−" : "±"}{Math.abs(change)} % {texts.versus}</span>
      : beforeCount !== null && texts.single ? <span className="bl-team-change">{texts.before}: {beforeCount} {leadWord(beforeCount)}</span> : null}
    <dl className="bl-team-facts">
      {hasToday && !texts.single && <div><dt>heute</dt><dd>{totals.approvedToday > 0 ? `+${totals.approvedToday}` : "0"}</dd></div>}
      <div><dt>Gespräche</dt><dd>{totals.calls}</dd></div>
      {quote !== null && <div><dt>Quote</dt><dd>{quote} %</dd></div>}
      <div><dt>am Telefon</dt><dd>{talkTime(totals.talkSeconds)}</dd></div>
    </dl>
  </div>;
}

/** Die zuletzt erreichten Leads – der jüngste oben. */
function Feed({ data, limit, pictureOf }: { data: Report; limit: number; pictureOf: (name: string | null) => string | null }) {
  const wins = data.recentWins.slice(0, limit); const now = new Date(data.now);
  return <div className="bl-feed"><h3>Zuletzt erreicht</h3>
    {wins.length ? <ol>{wins.map((win) => <li key={win.callId}><AgentFace name={win.name ?? "Ohne Agent"} avatarUrl={pictureOf(win.name)} /><span className="bl-feed-text"><b>{win.name ?? "Ohne Agent"}</b><small>{win.campaign ?? "ohne Kampagne"}</small></span><time>{ago(win.at, now)}</time></li>)}</ol> : <p>Noch kein Lead im Zeitraum.</p>}
  </div>;
}

const Awards = ({ awards, pictureOf }: { awards: Award[]; pictureOf: (award: Award) => string | null }) => <ul className="bl-awards" aria-label="Bestwerte im Zeitraum">{awards.map((award) => { const info = AWARDS[award.key]; const Icon = info.icon; return <li key={award.key} className={`bl-award is-${award.key}`}>
  <span className="bl-award-title"><Icon aria-hidden="true" />{info.title}</span>
  <b className="bl-award-value">{info.value(award)}</b>
  <span className="bl-award-who"><AgentFace name={award.name} avatarUrl={pictureOf(award)} /><span>{award.name}</span></span>
  <small>{info.note(award)}</small>
</li>; })}</ul>;

/**
 * Bestenliste der Agenten: Treppchen für die ersten drei, Zahlen der Mannschaft, zuletzt erreichte Leads, Bestwerte und die Rangliste
 * mit Auf- und Abstieg, Serie, Stufe und dem Abstand nach vorn. Kommt ein Lead dazu, wird er gefeiert. „Großansicht“ zeigt die Liste
 * bildschirmfüllend – für den Fernseher im Callcenter.
 */
export default function AgentLeaderboard({ onShowCalls }: { onShowCalls: (agentName: string, filter: LeaderboardFilter) => void }) {
  const [range, setRange] = useState<CallRange>(START_RANGE); const [campaign, setCampaign] = useState("");
  const [query, setQuery] = useState(""); const [showAll, setShowAll] = useState(false); const [wide, setWide] = useState(false);
  const report = trpc.leadops.dialerAgentReport.useQuery({ ...callRangeInput(range), campaign: campaign || null }, { retry: false, refetchInterval: wide ? 15_000 : 30_000, placeholderData: (previous) => previous });
  const campaigns = trpc.leadops.listCallQaCampaigns.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const names = trpc.leadops.callAgentNames.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const avatarOf = useAvatarOf(); const data = report.data;
  const userIdOf = useMemo(() => new Map((names.data ?? []).filter((item) => item.userId).map((item) => [item.name, item.userId] as const)), [names.data]);
  const pictureOfName = (name: string | null) => (name ? avatarOf(userIdOf.get(name) ?? null) : null);
  const pictureOf = (agent: Pick<Agent, "userId" | "name">) => avatarOf(agent.userId ?? userIdOf.get(agent.name) ?? null);

  // Neuer Lead oder neue Stufe seit dem letzten Stand → kurz feiern
  const [cheer, setCheer] = useState<Cheer | null>(null);
  useEffect(() => { if (!data || report.isPlaceholderData) return; const next = cheerFor(data); if (next) setCheer(next); }, [data, report.isPlaceholderData]);
  useEffect(() => { if (!cheer) return; const timer = window.setTimeout(() => setCheer((current) => (current?.id === cheer.id ? null : current)), 7000); return () => window.clearTimeout(timer); }, [cheer]);
  const fresh = useMemo(() => new Set(cheer?.keys ?? []), [cheer]);

  // Agent von Hand löschen und zurückholen: Gelöscht wird nur der Platz in der Bestenliste – die Gespräche bleiben erhalten
  const utils = trpc.useUtils(); const reload = () => { seen.clear(); setCheer(null); void utils.leadops.dialerAgentReport.invalidate(); }; // ohne alten Stand: Wer zurückkommt, wird nicht als „neue Leads“ gefeiert
  const hide = trpc.leadops.hideAgent.useMutation({ onSuccess: (result) => { toast.success(`${result.name} ist aus der Bestenliste gelöscht. Die Gespräche bleiben erhalten.`); reload(); }, onError: (error) => { toast.error(error.message); } });
  const restore = trpc.leadops.restoreAgent.useMutation({ onSuccess: (result) => { toast.success(`${result.name} steht wieder in der Bestenliste.`); reload(); }, onError: (error) => { toast.error(error.message); } });
  const removeAgent = async (agent: Agent) => { if (await confirmAction(`${agent.name} aus der Bestenliste löschen? Die Gespräche bleiben erhalten. Unter „Gelöschte Agenten“ kannst du den Agenten jederzeit zurückholen.`, { confirmLabel: "Löschen", danger: true })) hide.mutate({ name: agent.name }); };

  // Großansicht: füllt das Fenster – und, wo der Browser es erlaubt, den ganzen Bildschirm. Esc oder „Schließen“ beendet sie.
  const stage = useRef<HTMLDivElement>(null); const wasFull = useRef(false); const [zoom, setZoom] = useState(1); const [clock, setClock] = useState(() => CLOCK.format(new Date()));
  const closeWide = () => { setWide(false); try { if (document.fullscreenElement) void document.exitFullscreen(); } catch { /* war nicht im Vollbild */ } };
  useEffect(() => {
    if (!wide) return;
    const fit = () => setZoom(Math.max(0.3, Math.min(window.innerWidth / 1600, window.innerHeight / 900)));
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeWide(); };
    const onFull = () => { if (document.fullscreenElement) wasFull.current = true; else if (wasFull.current) { wasFull.current = false; setWide(false); } };
    fit(); window.addEventListener("resize", fit); window.addEventListener("keydown", onKey); document.addEventListener("fullscreenchange", onFull);
    const tick = window.setInterval(() => setClock(CLOCK.format(new Date())), 10_000); setClock(CLOCK.format(new Date()));
    document.documentElement.classList.add("bl-wide-open"); stage.current?.querySelector<HTMLButtonElement>(".bl-wide-close")?.focus();
    try { const asked = stage.current?.requestFullscreen?.(); if (asked && typeof asked.catch === "function") asked.catch(() => undefined); } catch { /* Vollbild nicht erlaubt – die Ansicht füllt dann das Fenster */ }
    return () => { window.removeEventListener("resize", fit); window.removeEventListener("keydown", onKey); document.removeEventListener("fullscreenchange", onFull); window.clearInterval(tick); document.documentElement.classList.remove("bl-wide-open"); wasFull.current = false; };
  }, [wide]);

  const today = data?.today ?? berlinDay(new Date()); const span = data?.span ?? callPeriodSpan(callRangeInput(range), today);
  const texts = callSpanTexts(span, today); const hasToday = spanHasToday(span, today);
  const ranked = useMemo(() => (data?.agents ?? []).filter((agent) => agent.rank !== null), [data]); const nobody = (data?.agents ?? []).find((agent) => agent.rank === null) ?? null;
  const leader = ranked[0]; const second = ranked[1]; const most = Math.max(1, leader?.approved ?? 0);
  const podium = useMemo(() => ranked.filter((agent) => agent.approved > 0).slice(0, 3), [ranked]); // ohne Lead kein Treppchen
  const needle = query.trim().toLocaleLowerCase("de"); const aliasesOfAgent = (agent: Agent) => ((agent as { aliases?: string[] }).aliases ?? []); const found = needle ? ranked.filter((agent) => agent.name.toLocaleLowerCase("de").includes(needle) || aliasesOfAgent(agent).some((alias) => alias.toLocaleLowerCase("de").includes(needle))) : ranked; // die Suche findet einen Agenten auch über seinen Alias-Namen
  const rows = needle || showAll ? found : found.slice(0, TOP_ROWS); const hidden = found.length - rows.length;
  const campaignNames = Array.from(new Set([...(campaigns.data ?? []).map((item) => item.name), ...(campaign ? [campaign] : [])]));
  const heading = `${texts.label}${data?.campaign ? ` · ${data.campaign}` : ""}`;
  const gone = data?.hiddenAgents ?? []; const goneCalls = gone.reduce((sum, item) => sum + item.calls, 0);
  const updated = data ? CLOCK.format(new Date(data.now)) : null;

  const stageBody = data && ranked.length > 0 ? <>
    <Podium top={podium} second={second} pictureOf={pictureOf} fresh={fresh} before={texts.before} hasToday={hasToday} />
    <aside className="bl-side"><Team data={data} texts={texts} hasToday={hasToday} /><Feed data={data} limit={wide ? 4 : 5} pictureOf={pictureOfName} /></aside>
  </> : null;

  return <section className={`surface-panel operations-panel cq-list-panel gq-agents-panel bl-scope ${report.isPlaceholderData ? "is-switching" : ""}`}>
    <div className="gq-toolbar bl-toolbar">
      <div className="gq-period-row">
        <span className="gq-label">Zeitraum</span>
        <CallPeriodControl range={range} onRange={setRange} resetTo={START_RANGE.period} />
        <label className="gq-category bl-campaign"><span className="gq-label">Kampagne</span><select className="filter-select h-8" aria-label="Kampagne" value={campaign} onChange={(event) => setCampaign(event.target.value)}><option value="">Alle Kampagnen</option>{campaignNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <span className="bl-live" title="Die Bestenliste aktualisiert sich alle 30 Sekunden von selbst">{updated ? <><i aria-hidden="true" />Stand {updated} Uhr</> : null}</span>
        <button type="button" className="bl-wide-button" onClick={() => setWide(true)} disabled={!ranked.length} title="Bestenliste bildschirmfüllend zeigen – zum Beispiel auf dem Fernseher im Callcenter"><Maximize2 aria-hidden="true" /><span>Großansicht</span></button>
      </div>
    </div>

    {report.isLoading ? <p className="gq-empty">Bestenliste wird geladen …</p> : report.error && !data ? <p className="gq-empty">Die Bestenliste konnte nicht geladen werden: {report.error.message}</p> : !data || !ranked.length ? <div className="bl-stage is-empty"><div className="bl-stage-head"><h2>Bestenliste</h2><span>{heading}</span></div><p className="bl-stage-empty">{goneCalls > 0 ? <>Alle Agenten mit Gesprächen {texts.inText}{campaign ? ` in der Kampagne „${campaign}“` : ""} sind gelöscht. Unten kannst du sie zurückholen.</> : <>Noch keine Gespräche {texts.inText}{campaign ? ` in der Kampagne „${campaign}“` : ""}. Sobald der Dialer Gespräche meldet, beginnt hier das Rennen.</>}</p></div> : <>
      <div className={`bl-stage ${cheer ? "is-cheering" : ""}`}>
        <div className="bl-stage-head"><h2>Bestenliste</h2><span>{heading}</span>{cheer && <p key={cheer.id} className="bl-cheer" role="status">{cheer.text}</p>}</div>
        {cheer && !prefersCalm() && <Confetti key={cheer.id} />}
        {!wide && stageBody}
      </div>

      {data.awards.length > 0 && <Awards awards={data.awards} pictureOf={pictureOf} />}

      <div className="bl-list">
        <div className="bl-list-head">
          <h3>Rangliste</h3><span className="bl-list-count">{ranked.length === 1 ? "1 Agent" : `${ranked.length} Agenten`}</span>
          <label className="bl-search"><Search aria-hidden="true" /><input type="search" aria-label="Agent suchen" placeholder="Agent suchen" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button type="button" aria-label="Suche leeren" onClick={() => setQuery("")}><X aria-hidden="true" /></button>}</label>
        </div>
        <div className="bl-row is-head" aria-hidden="true"><span>Platz</span><span>Agent</span><span>Leads</span><span>Quote</span><span>Gespräche</span><span>Serie</span><span>Ergebnis der Gespräche</span><span /></div>
        <ol className="bl-rows">{rows.map((agent) => { const gap = gapText(agent, second); const share = Math.round((agent.approved / most) * 100);
          return <li key={keyOf(agent)} className={`bl-row ${agent.rank && agent.rank <= 3 && agent.approved > 0 ? `is-top is-p${agent.rank}` : ""} ${fresh.has(keyOf(agent)) ? "is-fresh" : ""}`}>
            <span className="bl-place"><b aria-label={`Platz ${agent.rank}`}>{agent.rank}</b><Move agent={agent} before={texts.before} /></span>
            <span className="bl-agent"><AgentFace name={agent.name} avatarUrl={pictureOf(agent)} /><span className="bl-agent-lines"><span className="bl-name"><b title={agent.name}>{agent.name}</b>{aliasesOfAgent(agent).length > 0 && <em className="bl-alias" title={`So nennt sich ${agent.name} am Telefon: ${aliasesOfAgent(agent).join(", ")}`}>({aliasesOfAgent(agent)[0]})</em>}</span><small><Level agent={agent} />{agent.level.next ? <span>noch {agent.level.next.missing} bis {agent.level.next.name}</span> : <span>höchste Stufe</span>}</small></span></span>
            <span className="bl-leads" data-label="Leads"><span className="bl-leads-top"><b>{agent.approved}</b>{hasToday && agent.approvedToday > 0 && <em title="Leads heute">+{agent.approvedToday} heute</em>}</span><i className="bl-bar" aria-hidden="true"><i style={{ width: `${Math.max(agent.approved > 0 ? 4 : 0, share)}%` }} /></i>{gap && <small>{gap}</small>}</span>
            <span className="bl-stats">
            <span className="bl-num" data-label="Quote">{agent.greenRate !== null ? <><b>{agent.greenRate} %</b><small>{agent.approved} von {agent.evaluated}</small></> : <small>noch nichts bewertet</small>}</span>
            <span className="bl-num" data-label="Gespräche" title={agent.userId !== null && agent.reachRate !== null ? `${agent.reached} von ${agent.calls} Anrufen erreicht (${agent.reachRate} %)` : undefined}><b>{agent.calls}</b><small title="Gesprächszeit">{talkTime(agent.talkSeconds)}</small></span>
            <span className="bl-streak" data-label="Serie">{agent.streak >= 1 ? <b className={agent.streak >= 2 ? "is-on" : ""} title={`${agent.streak} ${agent.streak === 1 ? "Arbeitstag" : "Arbeitstage in Folge"} mit mindestens einem Lead`}><Flame aria-hidden="true" />{agent.streak} {dayWord(agent.streak)}</b> : <small>–</small>}</span>
            <span className="bl-outcome" data-label="Ergebnis der Gespräche">{agent.evaluated ? <><Split approved={agent.approved} review={agent.review} rejected={agent.rejected} open={0} /><small title={`${agent.approved} freigegeben, ${agent.review} zur Prüfung, ${agent.rejected} zurückgewiesen von ${agent.evaluated} bewerteten`}>{agent.review} zur Prüfung, {agent.rejected} zurückgewiesen{agent.appointments ? ` · ${agent.appointments} ${agent.appointments === 1 ? "Termin" : "Termine"}` : ""}</small></> : <small>noch nichts bewertet</small>}</span>
            </span>
            <span className="bl-actions"><button type="button" className="gq-open-calls bl-open" onClick={() => onShowCalls(agent.name, { range: rangeOfSpan(data.span), campaign: data.campaign })}>Gespräche<ChevronRight aria-hidden="true" /></button><button type="button" className="bl-remove" aria-label={`${agent.name} aus der Bestenliste löschen`} title="Agent aus der Bestenliste löschen – die Gespräche bleiben erhalten" disabled={hide.isPending} onClick={() => { void removeAgent(agent); }}><Trash2 aria-hidden="true" /></button></span>
          </li>; })}</ol>
        {needle && !found.length && <p className="bl-none">Kein Agent mit „{query.trim()}“.</p>}
        {(hidden > 0 || (showAll && !needle && ranked.length > TOP_ROWS)) && <button type="button" className="bl-more" aria-expanded={showAll} onClick={() => setShowAll((current) => !current)}>{showAll ? `Nur die ersten ${TOP_ROWS} zeigen` : `Alle ${ranked.length} Agenten anzeigen`}</button>}
        {nobody && !needle && <p className="bl-nobody"><b>Ohne Agent:</b> {nobody.calls === 1 ? "1 Gespräch" : `${nobody.calls} Gespräche`}{nobody.approved ? `, davon ${nobody.approved} ${leadWord(nobody.approved)}` : ""} – der Dialer hat keinen Agenten gemeldet, deshalb zählen sie für niemanden.</p>}
        <p className="bl-note">So wird gezählt: Ein Lead ist ein freigegebenes (grünes) Gespräch. Oben steht, wer die meisten Leads hat – bei Gleichstand entscheidet die bessere Quote. Die Serie zählt Arbeitstage in Folge mit mindestens einem Lead. Die Stufe richtet sich nach den Leads insgesamt: {AGENT_LEVELS.map((level) => (level.from ? `${level.name} ab ${level.from}` : level.name)).join(", ")}. Für „Beste Quote“ braucht es mindestens {QUOTE_MIN_CALLS} bewertete Gespräche. Mit dem Papierkorb am Ende einer Zeile löschst du einen Agenten aus der Bestenliste – seine Gespräche bleiben erhalten, und du kannst ihn jederzeit zurückholen.</p>
      </div>
    </>}

    {gone.length > 0 && <details className="bl-gone">
      <summary><ChevronDown aria-hidden="true" /><b>{gone.length === 1 ? "1 gelöschter Agent" : `${gone.length} gelöschte Agenten`}</b><span>{goneCalls > 0 ? `${goneCalls === 1 ? "1 Gespräch" : `${goneCalls} Gespräche`} ${texts.inText} – sie zählen in der Bestenliste nicht mit` : "zählen in der Bestenliste nicht mit"}</span></summary>
      <ul>{gone.map((item) => <li key={item.name}>
        <AgentFace name={item.name} avatarUrl={pictureOfName(item.name)} />
        <span className="bl-gone-text"><b title={item.name}>{item.name}</b><small>{item.calls ? `${item.calls === 1 ? "1 Gespräch" : `${item.calls} Gespräche`}${item.approved ? `, ${item.approved} ${leadWord(item.approved)}` : ""} ${texts.inText}` : `keine Gespräche ${texts.inText}`} · gelöscht am {GONE_DAY.format(new Date(item.at))}{item.by ? ` von ${item.by}` : ""}</small></span>
        <button type="button" className="bl-restore" disabled={restore.isPending} onClick={() => restore.mutate({ name: item.name })}><Undo2 aria-hidden="true" />Zurückholen</button>
      </li>)}</ul>
      <p>Gelöscht ist nur der Platz in der Bestenliste. Alle Gespräche stehen weiter in der Liste „Gespräche“. Neue Gespräche eines gelöschten Agenten zählen erst wieder mit, wenn du ihn zurückholst.</p>
    </details>}

    {wide && data && createPortal(<div ref={stage} className="bl-wide bl-scope" role="dialog" aria-modal="true" aria-label="Bestenliste in der Großansicht">
      <div className={`bl-wide-fit bl-stage ${cheer ? "is-cheering" : ""}`} style={{ zoom } as CSSProperties}>
        <header className="bl-wide-head"><div className="bl-stage-head"><h2>Bestenliste</h2><span>{heading}</span>{cheer && <p key={cheer.id} className="bl-cheer" role="status">{cheer.text}</p>}</div><time>{clock} Uhr</time><button type="button" className="bl-wide-close" onClick={closeWide}><X aria-hidden="true" />Schließen</button></header>
        {cheer && !prefersCalm() && <Confetti key={cheer.id} />}
        <div className="bl-wide-main">{stageBody}</div>
        {ranked.length > podium.length && <ol className="bl-chase" aria-label="Die Plätze dahinter">{ranked.slice(podium.length, podium.length + 8).map((agent) => <li key={keyOf(agent)} className={fresh.has(keyOf(agent)) ? "is-fresh" : ""}><span className="bl-chase-place">{agent.rank}</span><AgentFace name={agent.name} avatarUrl={pictureOf(agent)} /><b title={agent.name}>{agent.name}</b><Move agent={agent} before={texts.before} />{agent.streak >= 2 && <span className="bl-chase-flame" title="Serie"><Flame aria-hidden="true" />{agent.streak}</span>}<span className="bl-chase-score">{agent.approved}<small>{leadWord(agent.approved)}</small></span></li>)}</ol>}
      </div>
    </div>, document.body)}
  </section>;
}
