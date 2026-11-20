import AgentAliasSettings from "@/components/AgentAliasSettings";
import DialerIntake from "@/components/DialerIntake";
import { Badge } from "@/components/ui/badge";
import { SCOPE_LABEL } from "../../../shared/call-qualification";
import OptInPanel, { OptInBadge } from "@/components/OptInPanel";
import type { OptInKind, OptInStatus } from "../../../shared/opt-in";
import { dialerGuideText } from "../../../shared/dialer-guide";
import { CONTACT_MAPPING, CONTACT_MAPPING_LABELS } from "../../../shared/dialer-contact";
import { CALL_QA_PRESETS } from "../../../shared/call-qa-presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { BookOpenText, Cable, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, FileCheck2, FileText, FlaskConical, Gauge, Inbox, Info, LayoutTemplate, ListOrdered, PhoneIncoming, Play, Plus, RefreshCw, Search, Send, Settings2, ShieldCheck, Sparkles, TextSearch, TriangleAlert, Upload, Users, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { confirmAction } from "@/lib/confirm";
import { Face, FACE_COLOR, MOOD, MoodFace, moodOf } from "@/components/CallMood";
import { CallPlayer, type CallPlayerHandle, type PlayerMark } from "@/components/CallPlayer";
import { clock, criterionMark, questionMark, segmentIndexAt, type CallSegment } from "../../../shared/call-timeline";
import { CallPeriodControl, CallTally, overviewSummary, dayKey, dayLabel, timeText, DECISION_LABEL, type CallRange, type DecisionFilter } from "@/components/CallScoreboard";
import { useAvatarOf } from "@/components/AvatarUpload";
import { AgentFace, Split } from "@/components/AgentFace";
import AgentLeaderboard from "@/components/AgentLeaderboard";
import { clockText } from "../../../shared/call-overview";

type Settings = inferRouterOutputs<AppRouter>["leadops"]["getCallQaSettings"];
type CallRow = inferRouterOutputs<AppRouter>["leadops"]["listCalls"][number];
const verdictLabel: Record<string, string> = { verkaufbar: "Verkaufbar", nachfassen: "Nachfassen", nicht_verkaufbar: "Nicht verkaufbar", unklar: "Unklar" };
const decisionLabel: Record<string, string> = { offen: "Offen", freigegeben: "Freigegeben", pruefen: "Zur Prüfung", zurueckgewiesen: "Zurückgewiesen" };
const statusLabel: Record<string, string> = { eingegangen: "Eingegangen", transkribiert: "Transkribiert", bewertet: "Bewertet", fehlgeschlagen: "Fehlgeschlagen", ohne_einwilligung: "Ohne Einwilligung" };
const decisionClass = (decision: string) => decision === "freigegeben" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : decision === "zurueckgewiesen" ? "border-red-400/25 bg-red-500/10 text-red-200" : decision === "pruefen" ? "border-amber-400/25 bg-amber-500/10 text-amber-200" : "border-white/15 text-slate-300";
/** Agent im Gespräch: Name aus dem Transkript – von Hand korrigierbar (bleibt dann fest, auch bei neuer Bewertung). */
function AgentEdit({ callId, agentName, manual, fromDialer = false, alias = null, viaAlias = false, onChanged, bare = false }: { callId: number; agentName: string | null; manual: boolean; /** der Dialer hat den Agenten genannt */ fromDialer?: boolean; /** Name, mit dem sich der Agent am Telefon vorstellt */ alias?: string | null; /** der echte Name kam über den Alias */ viaAlias?: boolean; onChanged: () => void; /** nur der Name – die Beschriftung „Agent“ steht schon daneben */ bare?: boolean }) {
  const [editing, setEditing] = useState(false); const [value, setValue] = useState(agentName ?? "");
  const agents = trpc.leadops.callAgentNames.useQuery(undefined, { retry: false, staleTime: 60_000, enabled: editing });
  const save = trpc.leadops.setCallAgent.useMutation({ onSuccess: (result) => { toast.success(result.agentName ? `Agent auf „${result.agentName}“ gesetzt.` : "Agent wird wieder automatisch aus dem Transkript erkannt."); setEditing(false); onChanged(); }, onError: (error) => toast.error(error.message) });
  if (!editing) return <span className="cq-agent">{bare ? "" : "Agent "}{agentName ?? (bare ? "nicht erkannt" : "–")}{manual ? " (von Hand)" : fromDialer ? " (laut Dialer)" : viaAlias ? " (über den Alias zugeordnet)" : ""}{alias ? <span className="cq-agent-alias" title="So stellt sich der Agent am Telefon vor – Alias-Namen verwaltest du unter „Dialer & Bewertung“ → „Alias-Namen“"> · am Telefon: {alias}</span> : null} <button type="button" className="cq-agent-edit underline" title="Agent korrigieren – bleibt dann fest, auch wenn das Gespräch neu bewertet wird" onClick={() => { setValue(agentName ?? ""); setEditing(true); }}>ändern</button></span>;
  return <span className="cq-agent inline-flex flex-wrap items-center gap-1 align-middle"><Input className="h-7 w-44 text-xs" aria-label="Agent" list={`cq-agents-${callId}`} autoFocus value={value} placeholder="Name des Agenten" onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") save.mutate({ callId, agentName: value.trim() || null }); if (event.key === "Escape") setEditing(false); }} /><datalist id={`cq-agents-${callId}`}>{(agents.data ?? []).map((item) => <option key={item.name} value={item.name} />)}</datalist><Button size="sm" className="h-7" disabled={save.isPending} onClick={() => save.mutate({ callId, agentName: value.trim() || null })}>{save.isPending ? "…" : "Speichern"}</Button><Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(false)}>Abbrechen</Button></span>;
}
/** Längere Belege: zwei Zeilen zeigen, Rest per Klick aufklappen – der Text selbst ist immer vollständig. */
function Expandable({ text, quote = false, className = "" }: { text: string; quote?: boolean; className?: string }) {
  const [open, setOpen] = useState(false); const long = text.length > 150;
  return <span className={`cq-expand ${className} ${long && !open ? "is-clamped" : ""}`}><span className="cq-expand-text">{quote ? `„${text}“` : text}</span>{long && <button type="button" className="cq-expand-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "weniger anzeigen" : "alles anzeigen"}</button>}</span>;
}

export default function CallQaWorkspace() {
  const params = new URLSearchParams(window.location.search);
  type CqView = "liste" | "agenten" | "einstellungen";
  const readUrl = () => { const current = new URLSearchParams(window.location.search); return { view: (current.get("view") === "Einstellungen" ? "einstellungen" : current.get("view") === "Agenten" ? "agenten" : "liste") as CqView, callId: Number(current.get("callId")) || null }; };
  const [view, setViewState] = useState<CqView>(() => readUrl().view);
  const [selected, setSelectedState] = useState<number | null>(() => readUrl().callId);
  // Jeder Schritt innerhalb von „Gespräche“ (Reiter, Gespräch öffnen) bekommt einen eigenen Verlaufseintrag – „Zurück“ bleibt so in Gespräche statt auf die vorherige Seite zu springen.
  const go = (nextView: CqView, callId: number | null) => { setViewState(nextView); setSelectedState(callId); try { const next = new URLSearchParams(); next.set("page", "Gespräche"); if (nextView === "agenten") next.set("view", "Agenten"); if (nextView === "einstellungen") next.set("view", "Einstellungen"); if (callId) next.set("callId", String(callId)); const url = `/?${next.toString()}`; if (`${window.location.pathname}${window.location.search}` !== url) window.history.pushState({ cq: true }, "", url); } catch { /* Verlauf nicht verfügbar */ } };
  const setView = (nextView: CqView) => go(nextView, nextView === "liste" ? selected : null);
  const setSelected = (callId: number | null) => { if (callId === null && (window.history.state as { cq?: boolean } | null)?.cq) { try { window.history.back(); return; } catch { /* unten weiter */ } } go(view, callId); };
  useEffect(() => { const sync = () => { if (new URLSearchParams(window.location.search).get("page") !== "Gespräche") return; const next = readUrl(); setViewState(next.view); setSelectedState(next.callId); }; window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync); }, []);
  const [agent, setAgent] = useState<string>(() => params.get("agent") ?? ""); // Agent-Filter der Gesprächsliste (aus der Agenten-Auswertung oder der Adresse)
  const [campaign, setCampaign] = useState<string>(() => params.get("campaign") ?? "");
  const [range, setRange] = useState<CallRange>({ period: "alle", from: "", to: "" });
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [decision, setDecision] = useState<DecisionFilter>(""); // Zähler der Anzeigetafel filtern die Liste
  const statsInput = { period: range.from || range.to ? null : range.period, from: range.from || null, to: range.to || null, campaign: campaign || null, agentName: agent || null, categoryId };
  const stats = trpc.leadops.callStatistics.useQuery(statsInput, { retry: false, placeholderData: (previous) => previous, refetchInterval: 30_000 });
  const categoryOptions = trpc.leadops.callCategoryOptions.useQuery(undefined, { retry: false, staleTime: 30_000 });
  return <>
    <header className="page-intro compact"><div><span className="eyebrow">CALLCENTER</span><h1>Gespräche</h1><p>Jedes Telefonat aus dem Dialer wird mitgeschnitten, in Text umgewandelt und von der KI bewertet. Was passt, wird als Lead freigegeben und steht unter „Leads“.</p></div><div className="people-header-actions"><Button variant={view === "liste" ? "default" : "outline"} className={view === "liste" ? "flux-button" : ""} onClick={() => go("liste", null)}>Gespräche</Button><Button variant={view === "agenten" ? "default" : "outline"} className={view === "agenten" ? "flux-button" : ""} onClick={() => go("agenten", null)}><Users className="h-4 w-4" /> Agenten</Button><Button variant={view === "einstellungen" ? "default" : "outline"} className={view === "einstellungen" ? "flux-button" : ""} onClick={() => go("einstellungen", null)}>Dialer & Bewertung</Button></div></header>
    {view === "einstellungen" ? <CallQaSettings onOpenCall={(id) => go("liste", id)} /> : view === "agenten" ? <AgentLeaderboard onShowCalls={(name, filter) => { setAgent(name); setCampaign(filter.campaign ?? ""); setRange({ period: filter.period, from: "", to: "" }); setDecision(""); setCategoryId(null); go("liste", null); }} /> : selected ? <CallDetail callId={selected} onBack={() => setSelected(null)} /> : <CallList onOpen={(id) => go("liste", id)} agent={agent} onAgent={setAgent} campaign={campaign} onCampaign={setCampaign} range={range} onRange={setRange} categoryId={categoryId} onCategory={setCategoryId} decision={decision} onDecision={setDecision} overview={stats.data ?? null} />}
  </>;
}

type Overview = inferRouterOutputs<AppRouter>["leadops"]["callStatistics"];
type DayGroup = { key: string; label: string; sub: string; rows: CallRow[] };
const LONG_DAY = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
/** Gespräche nach Tagen bündeln: „Heute“, „Gestern“, sonst der ausgeschriebene Tag. */
function groupCallsByDay(rows: CallRow[]): DayGroup[] {
  const groups: DayGroup[] = []; const thisYear = new Date().getFullYear();
  for (const row of rows) {
    const date = row.startedAt ? new Date(row.startedAt) : null; const key = date ? dayKey(date) : "ohne"; const last = groups[groups.length - 1];
    if (last && last.key === key) { last.rows.push(row); continue; }
    const near = date ? dayLabel(date) : ""; const isNear = near === "Heute" || near === "Gestern";
    groups.push({ key, label: !date ? "Ohne Datum" : isNear ? near : LONG_DAY.format(date), sub: !date ? "" : isNear ? LONG_DAY.format(date) : date.getFullYear() !== thisYear ? String(date.getFullYear()) : "", rows: [row] });
  }
  return groups;
}
/** Hinweis unter dem Ergebnis, solange ein Gespräch noch nicht fertig bewertet ist. */
const statusNote = (status: string): { cls: string; text: string } | null => status === "eingegangen" ? { cls: "is-working", text: "Eingegangen – Text folgt" } : status === "transkribiert" ? { cls: "is-working", text: "Text liegt vor – Bewertung folgt" } : status === "fehlgeschlagen" ? { cls: "is-warn", text: "Fehlgeschlagen" } : status === "ohne_einwilligung" ? { cls: "is-warn", text: "Ohne Einwilligung" } : null;
type AgentOption = { name: string; total: number; approved: number; review: number; rejected: number; open: number };
/** Die Gesprächsliste lädt in Schritten: erst die neuesten 200, höchstens 1000 – ältere findet man über die Filter. */
const LIST_STEP = 200; const LIST_MAX = 1000;
/**
 * Agent wählen – eine Auswahl mit Suche statt je Agent ein Schild: passt auch bei 80 Agenten in eine Zeile.
 * Die Liste zeigt je Agent die Zahl seiner Gespräche im Zeitraum und wie sie ausgingen (meiste Gespräche zuerst).
 */
function AgentPicker({ agents, value, onChange, pictureOf }: { agents: AgentOption[]; value: string; onChange: (name: string) => void; pictureOf: (name: string | null | undefined) => string | null }) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(""); const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null); const input = useRef<HTMLInputElement>(null); const list = useRef<HTMLUListElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  const current = value ? agents.find((item) => item.name === value) ?? null : null; const calls = agents.reduce((sum, item) => sum + item.total, 0);
  const needle = query.trim().toLowerCase(); const shown = needle ? agents.filter((item) => item.name.toLowerCase().includes(needle)) : agents;
  const options: Array<AgentOption | null> = needle ? shown : [null, ...shown]; // ohne Suche steht „Alle Agenten“ oben
  useEffect(() => { if (!open) return; const onDown = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false); }; document.addEventListener("mousedown", onDown); return () => document.removeEventListener("mousedown", onDown); }, [open]);
  const show = () => { setQuery(""); setActive(Math.max(0, agents.findIndex((item) => item.name === value) + 1)); setOpen(true); window.setTimeout(() => input.current?.focus(), 0); };
  const hide = (refocus = false) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const choose = (name: string) => { onChange(name); hide(true); };
  useEffect(() => { if (!open) return; const row = list.current?.children[active] as HTMLElement | undefined; row?.scrollIntoView?.({ block: "nearest" }); }, [active, open]);
  const onKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(options.length - 1, index + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
    else if (event.key === "Enter") { event.preventDefault(); if (options.length) choose(options[Math.min(active, options.length - 1)]?.name ?? ""); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); hide(true); }
    else if (event.key === "Tab") hide();
  };
  return <div className={`gq-pick ${open ? "is-open" : ""}`} ref={box}>
    <button ref={trigger} type="button" className={`gq-pick-button ${value ? "has-value" : ""}`} aria-haspopup="listbox" aria-expanded={open} title={value ? `${value}: ${current?.total ?? 0} ${current?.total === 1 ? "Gespräch" : "Gespräche"} im Zeitraum – anderen Agenten wählen` : "Gespräche eines Agenten zeigen"} onClick={() => (open ? hide() : show())}>
      {value ? <><AgentFace name={value} avatarUrl={pictureOf(value)} /><b>{value}</b><em>{current?.total ?? 0}</em></> : <><Users aria-hidden="true" /><b>Alle Agenten</b><em>{agents.length}</em></>}
      <ChevronDown className="gq-pick-chevron" aria-hidden="true" />
    </button>
    {value && <button type="button" className="gq-pick-clear" aria-label="Filter aufheben – wieder alle Agenten zeigen" title="Wieder alle Agenten zeigen" onClick={() => { onChange(""); hide(); }}><X aria-hidden="true" /></button>}
    {open && <div className="gq-pick-pop">
      <label className="gq-pick-search"><Search aria-hidden="true" /><input ref={input} type="text" role="combobox" aria-expanded="true" aria-controls="gq-pick-list" aria-autocomplete="list" aria-label="Agent suchen" placeholder={`Agent suchen … (${agents.length})`} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKey} /></label>
      {options.length > 0 ? <ul id="gq-pick-list" role="listbox" aria-label="Agenten" ref={list}>{options.map((option, index) => { const name = option?.name ?? ""; const on = name === value; return <li key={name || "alle"} role="option" aria-selected={on} className={`gq-pick-option ${index === active ? "is-active" : ""} ${on ? "is-on" : ""}`} onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(name)}>
        {option ? <><AgentFace name={option.name} avatarUrl={pictureOf(option.name)} /><span className="gq-pick-name"><b>{option.name}</b><Split approved={option.approved} review={option.review} rejected={option.rejected} open={option.open} /></span><em title={`${option.total} ${option.total === 1 ? "Gespräch" : "Gespräche"} – ${option.approved} freigegeben, ${option.review} zur Prüfung, ${option.rejected} zurückgewiesen${option.open ? `, ${option.open} offen` : ""}`}>{option.total}</em></>
          : <><span className="gq-who is-all" aria-hidden="true"><Users /></span><span className="gq-pick-name"><b>Alle Agenten</b><small>{agents.length} {agents.length === 1 ? "Agent" : "Agenten"} im Zeitraum</small></span><em title={`${calls} Gespräche`}>{calls}</em></>}
        <Check className="gq-pick-check" aria-hidden="true" />
      </li>; })}</ul> : <p className="gq-pick-empty">Kein Agent mit „{query.trim()}“.</p>}
    </div>}
  </div>;
}
function CallList({ onOpen, agent, onAgent, campaign, onCampaign, range, onRange, categoryId, onCategory, decision, onDecision, overview }: { onOpen: (id: number) => void; agent: string; onAgent: (name: string) => void; campaign: string; onCampaign: (name: string) => void; range: CallRange; onRange: (range: CallRange) => void; categoryId: number | null; onCategory: (id: number | null) => void; decision: DecisionFilter; onDecision: (decision: DecisionFilter) => void; overview: Overview | null }) {
  const categoryOptions = trpc.leadops.callCategoryOptions.useQuery(undefined, { retry: false, staleTime: 30_000 });
  const utils = trpc.useUtils();
  const [linkText, setLinkText] = useState(""); const [linkAgent, setLinkAgent] = useState(""); const [linkCampaign, setLinkCampaign] = useState("");
  const fileInput = useRef<HTMLInputElement>(null); const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null); const [dropOver, setDropOver] = useState(false);
  const importFile = trpc.leadops.importRecordingFile.useMutation();
  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return; const list = Array.from(files).slice(0, 20); setUploading({ done: 0, total: list.length }); let ok = 0; let dup = 0;
    for (const file of list) {
      try {
        const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden.")); reader.readAsDataURL(file); });
        const result = await importFile.mutateAsync({ fileName: file.name, mimeType: file.type || "audio/mpeg", base64, agentName: linkAgent.trim() || null, campaign: linkCampaign.trim() || null });
        if (result.duplicate) dup += 1; else ok += 1;
      } catch (error) { toast.error(`${file.name}: ${error instanceof Error ? error.message : "Fehler"}`); }
      setUploading((current) => (current ? { ...current, done: current.done + 1 } : current));
    }
    setUploading(null); if (fileInput.current) fileInput.current.value = "";
    if (ok) toast.success(`${ok} Aufnahme${ok === 1 ? "" : "n"} hochgeladen – Text und Bewertung folgen in etwa einer halben Minute.${dup ? ` ${dup} ${dup === 1 ? "war" : "waren"} schon da.` : ""}`); else if (dup) toast.info("Diese Aufnahmen sind schon da – siehe Liste unten.");
    utils.leadops.listCalls.invalidate(); utils.leadops.callStatistics.invalidate();
  };
  const importLinks = trpc.leadops.importRecordingLinks.useMutation({ onSuccess: (result) => { const retried = (result as { retried?: number }).retried ?? 0; const ok = result.created + retried > 0; toast[ok ? "success" : "error"](ok ? `${result.created ? `${result.created} Aufnahme${result.created === 1 ? "" : "n"} angelegt` : ""}${result.created && retried ? ", " : ""}${retried ? `${retried} fehlgeschlagene${retried === 1 ? "" : ""} Aufnahme${retried === 1 ? "" : "n"} wird erneut geholt` : ""} – Text und Bewertung folgen in etwa einer halben Minute, die Liste aktualisiert sich von selbst.${result.duplicates ? ` ${result.duplicates} ${result.duplicates === 1 ? "war" : "waren"} schon fertig bewertet.` : ""}` : result.duplicates ? "Diese Links sind schon bewertet – du findest sie in der Liste unten." : "Kein Link erkannt – bitte eine Adresse je Zeile (beginnt mit https://)."); if (ok) setLinkText(""); utils.leadops.listCalls.invalidate(); utils.leadops.callStatistics.invalidate(); }, onError: (error) => toast.error(error.message) });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const reevaluateMany = trpc.leadops.reevaluateCalls.useMutation({ onSuccess: (result) => { toast.success(`${result.queued} ${result.queued === 1 ? "Gespräch wird" : "Gespräche werden"} neu bewertet – die Liste aktualisiert sich von selbst.`); setSelected(new Set()); utils.leadops.listCalls.invalidate(); utils.leadops.callStatistics.invalidate(); }, onError: (error) => toast.error(error.message) });
  const removeMany = trpc.leadops.deleteCalls.useMutation({ onSuccess: (result) => { toast.success(`${result.deleted} ${result.deleted === 1 ? "Gespräch" : "Gespräche"} gelöscht.`); setSelected(new Set()); utils.leadops.listCalls.invalidate(); utils.leadops.callStatistics.invalidate(); }, onError: (error) => toast.error(error.message) });
  const campaigns = trpc.leadops.listCallQaCampaigns.useQuery(undefined, { retry: false });
  // Die Liste zeigt die neuesten Gespräche – bei sehr vielen erst 200, auf Wunsch mehr. Ändert sich ein Filter, beginnt sie wieder bei 200.
  const [limit, setLimit] = useState(LIST_STEP);
  useEffect(() => { setLimit(LIST_STEP); }, [decision, campaign, agent, range.period, range.from, range.to, categoryId]);
  const calls = trpc.leadops.listCalls.useQuery({ decision: decision || null, campaign: campaign || null, agentName: agent || null, period: range.from || range.to ? null : range.period, from: range.from || null, to: range.to || null, categoryId, limit }, { retry: false, placeholderData: (previous) => previous, refetchInterval: (query) => ((query.state.data as Array<{ status: string }> | undefined)?.some((row) => row.status === "eingegangen" || row.status === "transkribiert") ? 5_000 : 30_000) });
  const agentNames = trpc.leadops.callAgentNames.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const [showSettings, setShowSettings] = useState(false); const [showImport, setShowImport] = useState(false); const settingsDirty = useRef(false); const closeAsking = useRef(false); // ungespeicherte Änderungen im Einstellen-Fenster
  /** Einstellen-Fenster schließen – mit ungespeicherten Änderungen erst nach Rückfrage (die Esc-Taste, die die Rückfrage schließt, löst keine zweite aus). */
  const closeSettings = async (open: boolean) => {
    if (open) return void setShowSettings(true);
    if (settingsDirty.current) {
      if (closeAsking.current) return; closeAsking.current = true;
      await new Promise((resolve) => setTimeout(resolve, 0));
      const discard = await confirmAction("Du hast Änderungen, die noch nicht gespeichert sind. Fenster trotzdem schließen?", { confirmLabel: "Ohne Speichern schließen", danger: true });
      setTimeout(() => { closeAsking.current = false; }, 0);
      if (!discard) return;
    }
    settingsDirty.current = false; setShowSettings(false);
  };
  const rows: CallRow[] = calls.data ?? []; const days = groupCallsByDay(rows);
  // So viele Gespräche gibt es laut Übersicht für die gewählten Filter – stehen mehr dort, als die Liste zeigt, sagt sie es
  const expected = !overview ? 0 : decision === "freigegeben" ? overview.approved : decision === "pruefen" ? overview.review : decision === "zurueckgewiesen" ? overview.rejected : decision === "offen" ? overview.open : overview.total;
  const cut = rows.length >= limit && expected > rows.length;
  const avatarOf = useAvatarOf(); const userIdOf = new Map((agentNames.data ?? []).filter((item) => item.userId).map((item) => [item.name, item.userId] as const));
  const pictureOf = (name: string | null | undefined) => (name ? avatarOf(userIdOf.get(name) ?? null) : null);
  const agentChips = overview?.byAgent ?? [];
  const allSelected = Boolean(rows.length) && selected.size === rows.length;
  const toggle = (id: number, on: boolean) => setSelected((current) => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });
  return <>
    <section className="surface-panel operations-panel overflow-hidden cq-list-panel">
      <div className="gq-toolbar">
        <div className="gq-period-row">
          <span className="gq-label">Zeitraum</span>
          <CallPeriodControl range={range} onRange={onRange} />
        </div>
        <div className="gq-tally-row">
          <span className="gq-label">Ergebnis</span>
          <CallTally overview={overview} decision={decision} onDecision={onDecision} />
          <div className="gq-sum"><span>{overviewSummary(overview)}</span></div>
        </div>
        <div className="cq-campaign-row">
          <span className="gq-label">Kampagne</span>
          <div className="dashboard-segments"><button type="button" className={campaign ? "" : "active"} onClick={() => onCampaign("")}>Alle</button>{(campaigns.data ?? []).map((item) => <button key={item.name} type="button" className={campaign === item.name ? "active" : ""} onClick={() => onCampaign(item.name)}>{item.name}</button>)}</div>
          <div className="gq-tools"><button type="button" className="cq-tool" title={`Kampagne einstellen: Kriterien, Prüffragen, Auswertung${campaign ? ` für „${campaign}“` : ""}`} onClick={() => setShowSettings(true)}><Settings2 aria-hidden="true" /><span>Einstellen</span></button><button type="button" className="cq-tool" title="Aufnahmen testen – Datei hochladen oder Links einfügen" onClick={() => setShowImport(true)}><Upload aria-hidden="true" /><span>Aufnahmen testen</span></button></div>
        </div>
        <div className="gq-agent-row">
          <div className="gq-agents" role="group" aria-label="Nach Agent filtern">
            <span className="gq-label">Agent</span>
            <AgentPicker agents={agentChips} value={agent} onChange={onAgent} pictureOf={pictureOf} />
          </div>
          <label className="gq-category"><span className="gq-label">Lead-Kategorie</span><select className="filter-select h-8" aria-label="Nach Lead-Kategorie filtern" value={categoryId ?? ""} onChange={(event) => onCategory(event.target.value ? Number(event.target.value) : null)}><option value="">Alle Kategorien</option>{(categoryOptions.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.emoji ? `${item.emoji} ` : ""}{item.name} ({item.count})</option>)}</select></label>
        </div>
      </div>
      {decision && <div className="gq-result-line"><span>Die Liste zeigt nur Gespräche mit dem Ergebnis „{DECISION_LABEL[decision]}“ – {rows.length === 1 ? "1 Gespräch" : `${rows.length} Gespräche`}.</span><button type="button" className="gq-link" onClick={() => onDecision("")}>Alle zeigen</button></div>}
      {selected.size > 0 && <div className="cq-bulk gq-bulk"><b>{selected.size} ausgewählt</b><Button size="sm" variant="outline" className="cq-bulk-reevaluate" disabled={reevaluateMany.isPending} title="Die ausgewählten Gespräche nach den aktuellen Regeln der Kampagne neu bewerten" onClick={() => reevaluateMany.mutate({ callIds: Array.from(selected) })}>{reevaluateMany.isPending ? "Starte …" : "Neu bewerten"}</Button><Button size="sm" variant="outline" className="gq-danger" disabled={removeMany.isPending} onClick={async () => { if (!(await confirmAction(`${selected.size} ${selected.size === 1 ? "Gespräch" : "Gespräche"} samt Transkript, Bewertung und hochgeladenen Aufnahmen endgültig löschen? Kontakte/Leads bleiben erhalten.`, { confirmLabel: "Löschen", danger: true }))) return; removeMany.mutate({ callIds: Array.from(selected) }); }}>{removeMany.isPending ? "Lösche …" : "Ausgewählte löschen"}</Button><button type="button" className="gq-link" onClick={() => setSelected(new Set())}>Auswahl aufheben</button></div>}
      {rows.length > 0 && <div className="gq-table-wrap"><table className="flux-table no-stack gq-table">
        <thead><tr>
          <th className="gq-col-check"><input type="checkbox" aria-label="Alle auswählen" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((row) => row.id)) : new Set())} /></th>
          <th className="cq-th-ampel" title="Grün: alle entscheidenden Prüffragen sind mit Ja beantwortet. Orange: mindestens eine ist unklar – bitte reinhören. Rot: mindestens eine wurde mit Nein beantwortet. Der Ring und die Zahl zeigen, wie viele dieser Fragen erfüllt sind.">Ampel <span className="cq-th-info" aria-hidden="true">ⓘ</span></th>
          <th>Uhrzeit</th><th>Gespräch</th><th>Agent, Kampagne</th><th>Ergebnis</th><th className="gq-col-go"><span className="sr-only">Öffnen</span></th>
        </tr></thead>
        {days.map((day, dayIndex) => <tbody key={`${day.key}-${dayIndex}`}>
          <tr className="gq-day"><th colSpan={7} scope="rowgroup"><span className="gq-day-line"><span className="gq-day-name">{day.label}</span>{day.sub && <span className="gq-day-date">{day.sub}</span>}<span className="gq-day-count">{day.rows.length === 1 ? "1 Gespräch" : `${day.rows.length} Gespräche`}</span>{!decision && day.rows.length > 1 && <Split approved={day.rows.filter((row) => row.decision === "freigegeben").length} review={day.rows.filter((row) => row.decision === "pruefen").length} rejected={day.rows.filter((row) => row.decision === "zurueckgewiesen").length} open={day.rows.filter((row) => !["freigegeben", "pruefen", "zurueckgewiesen"].includes(row.decision)).length} />}</span></th></tr>
          {day.rows.map((call) => { const started = call.startedAt ? new Date(call.startedAt) : null; const contact = call.leadName ?? call.rawContactName ?? null; const note = statusNote(call.status); const error = (call as { error?: string | null }).error ?? null; const optIn = (call as { optIn?: { status: OptInStatus; kind: OptInKind; buyerName: string | null; missing: string[] } | null }).optIn ?? null;
            // Zweite Zeile: worum es ging (Zusammenfassung der KI) – oder was gerade mit dem Gespräch passiert
            const gist = call.status === "fehlgeschlagen" && error ? { cls: "is-warn", text: error } : note ? { cls: note.cls, text: note.text } : call.summary ? { cls: "", text: call.summary } : call.nextStep ? { cls: "", text: call.nextStep } : null;
            return <tr key={call.id} className={`gq-call is-${moodOf(call)} ${selected.has(call.id) ? "is-selected" : ""}`} tabIndex={0} aria-label={`Gespräch ${started ? `${day.label}, ${timeText(started)} Uhr` : "ohne Uhrzeit"}${contact ? `, ${contact}` : ""} – öffnen`} onClick={() => onOpen(call.id)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(call.id); } }}>
              <td className="gq-col-check" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label="Gespräch auswählen" checked={selected.has(call.id)} onChange={(event) => toggle(call.id, event.target.checked)} /></td>
              <td className="gq-ampel"><MoodFace call={call} percent layout="row" /></td>
              <td className="gq-time"><b>{started ? <>{timeText(started)}<span> Uhr</span></> : "–"}</b>{typeof call.durationSeconds === "number" && call.durationSeconds > 0 ? <small>{clockText(call.durationSeconds)} Min</small> : null}</td>
              <td className="gq-talkcell">
                <span className="gq-who-line"><b>{contact ?? call.phone ?? "Unbekannt"}</b>{call.leadPublicId ? <span className="gq-lead-id" title="Diesem Lead zugeordnet">{call.leadPublicId}</span> : call.rawContactName ? <span className="gq-raw" title="Kontakt aus den Rohdaten – wird bei Freigabe zum Lead">Rohdaten</span> : null}{contact && call.phone ? <span className="gq-phone">{call.phone}</span> : null}{call.category && <span className="gq-chip is-cat cq-category" title="Lead-Kategorie – von der KI aus dem Gespräch erkannt">{call.category.emoji ? `${call.category.emoji} ` : ""}{call.category.name}</span>}</span>
                {gist && <span className={`gq-summary ${gist.cls}`} title={gist.text}>{gist.text}</span>}
              </td>
              <td className="gq-agent"><span className="gq-agent-cell">{call.agentName ? <AgentFace name={call.agentName} avatarUrl={pictureOf(call.agentName)} /> : <span className="gq-who is-none" aria-hidden="true">–</span>}<span className="gq-agent-lines"><b className={call.agentName ? "" : "gq-none"} title={(call as { agentAlias?: string | null }).agentAlias ? `Am Telefon: ${(call as { agentAlias?: string | null }).agentAlias}` : undefined}>{call.agentName ?? "Ohne Agent"}</b><small title={`Kampagne: ${call.campaign ?? call.provider}`}>{call.campaign ?? call.provider}</small></span></span></td>
              <td className="gq-result"><span className={`gq-pill is-${call.decision}`}>{decisionLabel[call.decision]}{call.decidedBy === "manuell" ? <i title="Von Hand entschieden"> · von Hand</i> : null}</span>{optIn && <span className="gq-optin"><OptInBadge status={optIn.status} kind={optIn.kind} buyerName={optIn.buyerName} missing={optIn.missing} compact /></span>}</td>
              <td className="gq-col-go" aria-hidden="true"><ChevronRight /></td>
            </tr>; })}
        </tbody>)}
      </table></div>}
      {cut && <div className="gq-more" role="status"><span>Die Liste zeigt die neuesten <b>{rows.length}</b> von <b>{expected}</b> Gesprächen.</span>{limit < LIST_MAX ? <button type="button" className="gq-link" disabled={calls.isFetching} onClick={() => setLimit((current) => Math.min(LIST_MAX, current + LIST_STEP))}>{calls.isFetching ? "Lädt …" : `Weitere ${Math.min(LIST_STEP, expected - rows.length, LIST_MAX - limit)} zeigen`}</button> : <span>Für ältere Gespräche bitte Zeitraum, Kampagne oder Agent eingrenzen.</span>}</div>}
      {!rows.length && <p className="gq-empty">{calls.isLoading ? "Gespräche werden geladen …" : <>Noch keine Gespräche{decision ? ` mit dem Ergebnis „${DECISION_LABEL[decision]}“` : ""}{campaign ? ` in der Kampagne „${campaign}“` : ""}{agent ? ` von ${agent}` : ""}{range.from || range.to || range.period !== "alle" ? " im gewählten Zeitraum" : ""}{categoryId ? " in dieser Lead-Kategorie" : ""}. Sobald der Dialer Gespräche meldet, erscheinen sie hier – oder teste die Bewertung mit „Aufnahmen testen“.</>}</p>}
    </section>
    <Dialog open={showSettings} onOpenChange={closeSettings}><DialogContent className="cq-dialog" onInteractOutside={(event) => event.preventDefault()}><DialogHeader><DialogTitle>Kampagne einstellen</DialogTitle><DialogDescription>{campaign ? `„${campaign}“` : "Standard"} – Kriterien, Prüffragen und Auswertung. Einmal einstellen, danach läuft die Bewertung automatisch.</DialogDescription></DialogHeader>{showSettings && <CampaignPanel campaigns={campaigns.data ?? []} campaign={campaign} onSelect={onCampaign} onChanged={() => campaigns.refetch()} onDirty={(dirty) => { settingsDirty.current = dirty; }} />}</DialogContent></Dialog>
    <Dialog open={showImport} onOpenChange={setShowImport}><DialogContent className="cq-dialog gi-dialog" onInteractOutside={(event) => event.preventDefault()}><DialogHeader><DialogTitle>Aufnahmen testen</DialogTitle><DialogDescription>Die Software holt die Aufnahme, wandelt sie in Text um und bewertet sie wie ein echtes Gespräch. Das dauert je Aufnahme etwa eine halbe Minute.</DialogDescription></DialogHeader>
      <div className="cq-links gi">
        <div className="gi-ways">
          <section className="gi-way" aria-labelledby="gi-h-file"><h3 id="gi-h-file">Datei hochladen<span className="gi-tag">am sichersten</span></h3>
            <div className={`cq-upload gi-drop ${dropOver ? "is-over" : ""}`} onDragOver={(event) => { event.preventDefault(); setDropOver(true); }} onDragLeave={() => setDropOver(false)} onDrop={(event) => { event.preventDefault(); setDropOver(false); void uploadFiles(event.dataTransfer.files); }}>
              <input ref={fileInput} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm" multiple className="hidden" onChange={(event) => void uploadFiles(event.target.files)} />
              <span className="gi-drop-icon"><Upload aria-hidden="true" /></span>
              <b>{uploading ? `Lade hoch … ${uploading.done} von ${uploading.total}` : "Aufnahmen hierher ziehen"}</b>
              <small>mp3, wav, m4a oder ogg, bis 24 MB je Datei, mehrere auf einmal</small>
              <button type="button" className="gs-btn" disabled={Boolean(uploading)} onClick={() => fileInput.current?.click()}>{uploading ? "Bitte warten …" : "Datei auswählen"}</button>
              {uploading && <i className="gi-progress" aria-hidden="true"><i style={{ width: `${Math.round((uploading.done / Math.max(1, uploading.total)) * 100)}%` }} /></i>}
            </div>
            <p className="gi-hint">So geht es: im Dialer auf den Link der Aufnahme klicken, die Datei herunterladen und hier hochladen.</p>
          </section>
          <section className="gi-way" aria-labelledby="gi-h-link"><h3 id="gi-h-link">Link einfügen</h3>
            <textarea className="gs-textarea gi-links" aria-label="Links zu Aufnahmen" value={linkText} placeholder={"https://…/getSound.aspx?token=…\nhttps://…/aufnahme-2.mp3 | +49 170 1234567 | Termin vereinbart"} onChange={(event) => setLinkText(event.target.value)} spellCheck={false} />
            <p className="gi-hint">Eine Adresse je Zeile. Dahinter geht optional <code>| Rufnummer</code> (ordnet den Kontakt zu) und <code>| Notiz</code>.</p>
            <Button className="flux-button" size="sm" onClick={() => importLinks.mutate({ text: linkText, agentName: linkAgent.trim() || null, campaign: linkCampaign.trim() || null })} disabled={importLinks.isPending || !/https?:\/\//.test(linkText)}>{importLinks.isPending ? "Lege an …" : "Aufnahmen holen und bewerten"}</Button>
          </section>
        </div>
        <div className="gi-meta"><label className="gs-field">Agent<Input value={linkAgent} placeholder="optional" list="gi-agents" onChange={(event) => setLinkAgent(event.target.value)} /></label><label className="gs-field">Kampagne<Input value={linkCampaign} placeholder="Standard: Aufnahmen-Test" list="gi-campaigns" onChange={(event) => setLinkCampaign(event.target.value)} /></label><p>Gilt für beide Wege. Ohne Angabe landet alles in der Kampagne „Aufnahmen-Test“. Anhören geht danach direkt im Gespräch.</p>
          <datalist id="gi-agents">{(agentNames.data ?? []).map((item) => <option key={item.name} value={item.name} />)}</datalist><datalist id="gi-campaigns">{(campaigns.data ?? []).filter((item) => item.name).map((item) => <option key={item.name} value={item.name} />)}</datalist></div>
      </div></DialogContent></Dialog></>;
}

/** Kampagne wählen, ihre Qualifizierungsfragen pflegen und die Auswertung (Ja-Anteil je Frage) sehen. */
type Rule = "ko" | "required" | "info";
type Scope = "photovoltaik" | "waermepumpe";
const presetFor = (campaign: string) => /wattfox/i.test(campaign) ? { key: "wattfox-pv-wp", label: "Wattfox – Photovoltaik & Wärmepumpe" } : { key: "pv-hauskompass", label: "Photovoltaik & Wärmepumpe – HausKompass" };
const RULE_SHORT: Record<Rule, string> = { ko: "K.-o.", required: "Pflicht", info: "Info" };
type CriterionDraft = { key?: string; label: string; description: string; weight: number };
type QuestionDraft = { key?: string; label: string; rule: Rule; hint: string; onlyFor: Scope | null };
/**
 * Einstellungen einer Kampagne – alles direkt als Felder änderbar: Name, Kriterien (mit Vorgaben für die KI) und Prüffragen.
 * Gespeichert wird je Bereich mit „Änderungen speichern“; solange nichts geändert ist, bleibt der Knopf grau.
 */
function CampaignPanel({ campaigns, campaign, onSelect, onChanged, onDirty }: { campaigns: Array<{ id: number | null; name: string; questions: Array<{ key: string; label: string; rule?: Rule; hint?: string; onlyFor?: Scope | null }>; custom: boolean }>; campaign: string; onSelect: (name: string) => void; onChanged: () => void; onDirty?: (dirty: boolean) => void }) {
  const utilsPanel = trpc.useUtils();
  const summary = trpc.leadops.callQaCampaignSummary.useQuery({ campaign: campaign || null }, { retry: false });
  const current = campaigns.find((item) => item.name === campaign);
  const questions = summary.data?.questions ?? current?.questions ?? [];
  const criteria = summary.data?.criteria ?? []; const criteriaCustom = summary.data?.criteriaCustom ?? false;
  const refreshLists = () => { onChanged(); summary.refetch(); utilsPanel.leadops.listCalls.invalidate(); utilsPanel.leadops.callStatistics.invalidate(); };

  // Name der Kampagne
  const [nameDraft, setNameDraft] = useState(campaign); const [newName, setNewName] = useState(""); const draftsDirty = useRef(false);
  useEffect(() => { setNameDraft(campaign); }, [campaign]);
  const nameChanged = Boolean(campaign) && nameDraft.trim().length > 0 && nameDraft.trim() !== campaign;
  const rename = trpc.leadops.renameCallCampaign.useMutation({ onSuccess: (result, variables) => { toast.success(result.merged ? `„${variables.from}“ in „${variables.to}“ aufgegangen – ${result.calls} Gespräche umgehängt.` : `Kampagne heißt jetzt „${variables.to}“ (${result.calls} Gespräche).`); onSelect(variables.to); refreshLists(); }, onError: (error) => toast.error(error.message) });
  const saveName = () => { if (!nameChanged || rename.isPending) return; if (draftsDirty.current) return void toast.error("Speichere zuerst deine Änderungen bei Kriterien und Prüffragen (oder setze sie zurück) – danach den Namen."); rename.mutate({ from: campaign, to: nameDraft.trim() }); };
  const removeCampaign = trpc.leadops.deleteCallCampaign.useMutation({ onSuccess: (result, variables) => { toast.success(`Kampagne „${variables.name}“ gelöscht – ${result.deletedCalls} ${result.deletedCalls === 1 ? "Gespräch" : "Gespräche"} entfernt.`); onSelect(""); refreshLists(); }, onError: (error) => toast.error(error.message) });
  const setDefault = trpc.leadops.setCallQaDefaultCampaign.useMutation({ onSuccess: (result) => { toast.success(result.defaultCampaign ? `Neue Gespräche vom Dialer landen ab jetzt in „${result.defaultCampaign}“.` : "Neue Gespräche behalten die Kampagne, die der Dialer mitschickt."); summary.refetch(); }, onError: (error) => toast.error(error.message) });

  // Kriterien + Vorgaben für die KI: Entwurf folgt dem gespeicherten Stand, bis man etwas ändert
  const criteriaSource = JSON.stringify({ rows: criteria.map((item): CriterionDraft => ({ key: item.key, label: item.label, description: item.description ?? "", weight: item.weight })), instructions: summary.data?.instructions ?? "" });
  const [criteriaDraft, setCriteriaDraft] = useState<CriterionDraft[]>([]); const [instructionsDraft, setInstructionsDraft] = useState("");
  const resetCriteria = () => { const saved = JSON.parse(criteriaSource) as { rows: CriterionDraft[]; instructions: string }; setCriteriaDraft(saved.rows); setInstructionsDraft(saved.instructions); };
  useEffect(resetCriteria, [campaign, criteriaSource]); // eslint-disable-line react-hooks/exhaustive-deps
  const criteriaDirty = JSON.stringify({ rows: criteriaDraft, instructions: instructionsDraft }) !== criteriaSource;
  const weightSum = criteriaDraft.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
  const patchCriterion = (index: number, change: Partial<CriterionDraft>) => setCriteriaDraft(criteriaDraft.map((row, i) => (i === index ? { ...row, ...change } : row)));
  const saveCriteria = trpc.leadops.saveCallQaCampaignCriteria.useMutation({ onSuccess: (result) => { toast.success(result.custom ? `${result.criteria} Kriterien für „${campaign}“ gespeichert – neue Gespräche werden damit bewertet.` : `„${campaign}“ nutzt wieder die Standard-Kriterien.`); refreshLists(); }, onError: (error) => toast.error(error.message) });
  const saveCriteriaNow = () => {
    const rows = criteriaDraft.filter((item) => item.label.trim());
    if (!rows.length) return void toast.error("Bitte mindestens ein Kriterium eintragen.");
    if (rows.some((item) => item.label.trim().length < 2)) return void toast.error("Jedes Kriterium braucht einen Namen mit mindestens 2 Zeichen.");
    if (rows.reduce((sum, item) => sum + (Number(item.weight) || 0), 0) <= 0) return void toast.error("Mindestens ein Kriterium braucht ein Gewicht größer als 0.");
    saveCriteria.mutate({ name: campaign, criteria: rows.map((item) => ({ key: item.key, label: item.label.trim(), description: item.description.trim().slice(0, 2000), weight: Math.max(0, Math.min(100, Math.round(Number(item.weight) || 0))) })), instructions: instructionsDraft.trim().slice(0, 4000) || null });
  };

  // Prüffragen
  const questionsSource = JSON.stringify(questions.map((question): QuestionDraft => ({ key: question.key, label: question.label, rule: question.rule ?? "info", hint: question.hint ?? "", onlyFor: question.onlyFor ?? null })));
  const [questionsDraft, setQuestionsDraft] = useState<QuestionDraft[]>([]);
  const resetQuestions = () => setQuestionsDraft(JSON.parse(questionsSource) as QuestionDraft[]);
  useEffect(resetQuestions, [campaign, questionsSource]); // eslint-disable-line react-hooks/exhaustive-deps
  const questionsDirty = JSON.stringify(questionsDraft) !== questionsSource;
  const patchQuestion = (index: number, change: Partial<QuestionDraft>) => setQuestionsDraft(questionsDraft.map((row, i) => (i === index ? { ...row, ...change } : row)));
  const save = trpc.leadops.saveCallQaCampaign.useMutation({ onSuccess: () => { toast.success("Prüffragen gespeichert – neue Gespräche werden damit geprüft."); refreshLists(); }, onError: (error) => toast.error(error.message) });
  const saveDefault = trpc.leadops.saveCallQaDefaultQuestions.useMutation({ onSuccess: () => { toast.success("Standard-Prüffragen gespeichert."); refreshLists(); }, onError: (error) => toast.error(error.message) });
  const savingQuestions = save.isPending || saveDefault.isPending;
  const saveQuestionsNow = () => {
    const rows = questionsDraft.filter((item) => item.label.trim());
    if (!rows.length) return void toast.error("Bitte mindestens eine Frage eintragen.");
    if (rows.some((item) => item.label.trim().length < 2)) return void toast.error("Jede Frage braucht mindestens 2 Zeichen.");
    const payload = rows.map((item) => ({ key: item.key, label: item.label.trim(), rule: item.rule, hint: item.hint.trim().slice(0, 500) || undefined, onlyFor: item.onlyFor }));
    if (campaign) save.mutate({ id: current?.id ?? null, name: campaign, questions: payload }); else saveDefault.mutate({ questions: payload });
  };
  const applyToCampaign = trpc.leadops.applyPresetToCampaign.useMutation({ onSuccess: (result) => { toast.success(`${result.questions} Prüffragen und ${result.criteria} Kriterien der Vorlage für „${campaign}“ übernommen.`); refreshLists(); }, onError: (error) => toast.error(error.message) });

  // Ungespeicherte Änderungen: dem Fenster melden (Rückfrage beim Schließen) und beim Wechsel der Kampagne nachfragen
  draftsDirty.current = criteriaDirty || questionsDirty;
  const anyDirty = criteriaDirty || questionsDirty || nameChanged;
  useEffect(() => { onDirty?.(anyDirty); return () => onDirty?.(false); }, [anyDirty]); // eslint-disable-line react-hooks/exhaustive-deps
  const switchCampaign = async (name: string) => { if (name === campaign) return; if (anyDirty && !(await confirmAction("Du hast Änderungen, die noch nicht gespeichert sind. Trotzdem zur anderen Kampagne wechseln?", { confirmLabel: "Ohne Speichern wechseln", danger: true }))) return; onSelect(name); };

  const ruleCount = (rule: Rule) => questions.filter((question) => (question.rule ?? "info") === rule).length;
  const tabs: Array<["kriterien" | "fragen" | "auswertung", string]> = [...(campaign ? [["kriterien", "Kriterien"] as ["kriterien", string]] : []), ["fragen", "Prüffragen"], ["auswertung", "Auswertung"]];
  const [tabState, setTab] = useState<"kriterien" | "fragen" | "auswertung">("kriterien");
  const tab = tabs.some(([key]) => key === tabState) ? tabState : "fragen";
  const [showHelp, setShowHelp] = useState(false);
  const presetLabel = summary.data?.presetLabel ?? null;
  const fieldClass = "cq-textarea w-full rounded-md border border-white/10 bg-slate-950 p-2 text-xs text-slate-100";
  const selectClass = "h-9 rounded-md border border-white/10 bg-slate-900 px-2 text-xs text-slate-100";

  return <div className="cq-campaign">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="flex items-center gap-2 text-sm text-slate-200">Kampagne
        <select className="filter-select h-9 cq-campaign-select" aria-label="Kampagne wählen" value={campaign} onChange={(event) => { void switchCampaign(event.target.value); }}>
          <option value="">Standard (für Kampagnen ohne eigene Einstellungen)</option>
          {campaigns.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
        </select>
      </label>
      <div className="flex items-center gap-1">
        <Input className="h-9 w-48" placeholder="Neue Kampagne …" aria-label="Name der neuen Kampagne" maxLength={160} value={newName} onChange={(event) => setNewName(event.target.value)} />
        <Button size="sm" variant="outline" disabled={!newName.trim() || save.isPending} onClick={async () => { const name = newName.trim(); if (anyDirty && !(await confirmAction("Du hast Änderungen, die noch nicht gespeichert sind. Trotzdem eine neue Kampagne anlegen und dorthin wechseln?", { confirmLabel: "Ohne Speichern anlegen", danger: true }))) return; save.mutate({ name, questions: questions.length ? questions.map((question) => ({ key: question.key, label: question.label, rule: question.rule ?? "info", hint: question.hint, onlyFor: question.onlyFor ?? null })) : [{ label: "Hat der Kunde generell Interesse?" }] }, { onSuccess: () => { setNewName(""); onSelect(name); } }); }}>Anlegen</Button>
      </div>
    </div>

    {campaign && <div className="cq-namebar mt-3">
      <span className="cq-field-label">Name der Kampagne</span>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Input className="cq-name-input h-9 w-full max-w-md" aria-label="Name der Kampagne" maxLength={160} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveName(); if (event.key === "Escape") setNameDraft(campaign); }} />
        <Button size="sm" className="cq-name-save flux-button" disabled={!nameChanged || rename.isPending} onClick={saveName}>{rename.isPending ? "Speichere …" : "Name speichern"}</Button>
        <Button size="sm" variant="ghost" className="cq-delete-campaign ml-auto text-red-300 hover:text-red-200" title="Diese Kampagne samt allen Gesprächen löschen" disabled={removeCampaign.isPending} onClick={async () => { const count = summary.data?.calls ?? null; if (!(await confirmAction(`Kampagne „${campaign}“ löschen? ${count !== null ? `${count} ${count === 1 ? "Gespräch" : "Gespräche"}` : "Alle Gespräche"} samt Transkripten, Bewertungen und hochgeladenen Aufnahmen werden endgültig gelöscht – Kontakte/Leads bleiben.`, { confirmLabel: "Löschen", danger: true }))) return; removeCampaign.mutate({ name: campaign }); }}>Kampagne löschen</Button>
      </div>
      <p className="mt-1 text-xs text-slate-500">Beim Umbenennen bekommen alle Gespräche dieser Kampagne den neuen Namen{summary.data?.defaultCampaign === campaign ? " – neue Gespräche vom Dialer landen dann auch unter dem neuen Namen" : ""}.</p>
    </div>}

    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <label className="flex items-center gap-2 text-xs text-slate-400" title="Alle neuen Gespräche, die der Dialer schickt, werden in diese Kampagne einsortiert – egal, welchen Kampagnennamen der Dialer mitschickt">Neue Gespräche vom Dialer landen in
        <select className="filter-select h-9 cq-default-campaign" aria-label="Kampagne für neue Gespräche vom Dialer" value={summary.data?.defaultCampaign ?? ""} disabled={setDefault.isPending} onChange={(event) => setDefault.mutate({ campaign: event.target.value || null })}>
          <option value="">Kampagne laut Dialer</option>
          {campaigns.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          {summary.data?.defaultCampaign && !campaigns.some((item) => item.name === summary.data?.defaultCampaign) && <option value={summary.data.defaultCampaign}>{summary.data.defaultCampaign}</option>}
        </select>
      </label>
      <button type="button" className="cq-help-toggle text-xs" onClick={() => setShowHelp(!showHelp)}>{showHelp ? "Erklärung ausblenden" : "Wie entscheidet die Software?"}</button>
    </div>
    {showHelp && <p className="cq-help mt-2 text-xs text-slate-400">Die KI beantwortet je Gespräch jede Prüffrage mit Ja / Nein / Unklar – und <strong className="text-slate-200">diese Fragen entscheiden</strong>: K.-o.-Frage = Nein → zurückgewiesen · Pflichtfrage = Nein → zurückgewiesen, Unklar → zur Prüfung · alle erfüllt → freigegeben. Die Kriterien (0–10 Punkte, gewichtet) ergeben die Qualitätsnote im Gespräch.</p>}

    {campaign && <div className="cq-facts mt-4 grid gap-2 sm:grid-cols-3">
      <button type="button" className={`cq-fact ${tab === "kriterien" ? "is-active" : ""}`} onClick={() => setTab("kriterien")}><strong>{criteria.length}</strong><span>Kriterien</span><small>{criteriaCustom ? "eigene dieser Kampagne" : "Standard aus „Dialer & Bewertung“"}</small></button>
      <button type="button" className={`cq-fact ${tab === "fragen" ? "is-active" : ""}`} onClick={() => setTab("fragen")}><strong>{questions.length}</strong><span>Prüffragen</span><small>{ruleCount("ko")} K.-o. · {ruleCount("required")} Pflicht · {ruleCount("info")} Info</small></button>
      <button type="button" className={`cq-fact ${tab === "auswertung" ? "is-active" : ""}`} onClick={() => setTab("auswertung")}><strong>{summary.data?.calls ?? 0}</strong><span>Bewertete Gespräche</span><small>Anteil „Ja“ je Frage</small></button>
    </div>}
    <div className="cq-tabs mt-4" role="tablist">{tabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "is-active" : ""} onClick={() => setTab(key)}>{label}{(key === "kriterien" && criteriaDirty) || (key === "fragen" && questionsDirty) ? " •" : ""}</button>)}</div>

    <div className="cq-tabpanel mt-3">
      {tab === "kriterien" && campaign && <div className="cq-criteria-box">
        <p className="text-xs text-slate-500">{criteriaCustom ? "Eigene Kriterien dieser Kampagne." : "Diese Kampagne nutzt die Standard-Kriterien. Änderst du hier etwas und speicherst, gelten deine Kriterien nur für diese Kampagne."} Die KI vergibt je Kriterium 0–10 Punkte; das Gewicht bestimmt den Anteil an der Qualitätsnote.{presetLabel && criteriaCustom ? ` Stammt aus der Vorlage „${presetLabel}“ – deine Änderungen bleiben erhalten und werden nicht mehr überschrieben.` : ""}</p>
        <div className="mt-3 grid gap-2">
          {criteriaDraft.map((item, index) => { const share = weightSum ? Math.round(((Number(item.weight) || 0) / weightSum) * 100) : 0; return <div key={index} className="cq-criterion-row">
            <div className="flex flex-wrap items-center gap-2">
              <span className="cq-qnum">{index + 1}</span>
              <Input className="h-9 min-w-[200px] flex-1" value={item.label} placeholder="Kriterium, z. B. Entscheider geklärt" aria-label="Kriterium" maxLength={160} onChange={(event) => patchCriterion(index, { label: event.target.value })} />
              <label className="flex items-center gap-1 text-xs text-slate-400" title="Gewicht: Wie stark dieses Kriterium in die Qualitätsnote eingeht">Gewicht<Input className="h-9 w-20" type="number" min={0} max={100} value={item.weight} aria-label="Gewicht" onChange={(event) => patchCriterion(index, { weight: Number(event.target.value) })} /></label>
              <span className="cq-weight" title="Anteil an der Qualitätsnote">{share} %</span>
              <Button size="sm" variant="ghost" aria-label="Kriterium entfernen" title="Kriterium entfernen" onClick={() => setCriteriaDraft(criteriaDraft.filter((_, i) => i !== index))}>✕</Button>
            </div>
            <textarea className={`${fieldClass} mt-2`} rows={2} value={item.description} placeholder="Was die KI bei diesem Kriterium prüfen soll" aria-label="Beschreibung" maxLength={2000} onChange={(event) => patchCriterion(index, { description: event.target.value })} />
          </div>; })}
          {!criteriaDraft.length && <p className="text-xs text-slate-500">Noch keine Kriterien – füge das erste hinzu.</p>}
        </div>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => setCriteriaDraft([...criteriaDraft, { label: "", description: "", weight: 10 }])}>Kriterium hinzufügen</Button>
        <div className="mt-4"><span className="cq-field-label">Vorgaben für die KI – nur für diese Kampagne (optional, ersetzen die Standard-Vorgaben)</span><textarea className={`${fieldClass} mt-1`} rows={7} aria-label="Vorgaben für die KI" maxLength={4000} placeholder="Zum Beispiel: „HausKompass muss als Firma genannt werden.“" value={instructionsDraft} onChange={(event) => setInstructionsDraft(event.target.value)} /></div>
        <div className="cq-savebar">
          <Button size="sm" className="cq-save-criteria flux-button" disabled={!criteriaDirty || saveCriteria.isPending} onClick={saveCriteriaNow}>{saveCriteria.isPending ? "Speichere …" : "Änderungen speichern"}</Button>
          <Button size="sm" variant="ghost" disabled={!criteriaDirty || saveCriteria.isPending} onClick={resetCriteria}>Zurücksetzen</Button>
          {criteriaCustom && <Button size="sm" variant="ghost" className="cq-reset-criteria" disabled={saveCriteria.isPending} onClick={async () => { if (!(await confirmAction(`Eigene Kriterien von „${campaign}“ entfernen und wieder die Standard-Kriterien nutzen?`, { confirmLabel: "Standard nutzen" }))) return; saveCriteria.mutate({ name: campaign, criteria: [], instructions: null }); }}>Standard nutzen</Button>}
          <span className="ml-auto text-xs text-slate-500">{criteriaDirty ? "Ungespeicherte Änderungen" : "Alles gespeichert"} · Gewichte zusammen: {weightSum}</span>
        </div>
      </div>}

      {tab === "fragen" && <div className="cq-questions-box">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">{campaign ? `Prüffragen für „${campaign}“` : "Standard-Prüffragen für Kampagnen ohne eigene Fragen"} – <span className="cq-rule is-ko">K.-o.</span> Nein = zurückgewiesen · <span className="cq-rule is-required">Pflicht</span> Ja nötig · <span className="cq-rule is-info">Info</span> nur Auswertung.</p>
          {campaign && <Button size="sm" variant="ghost" className="cq-preset-campaign" title={`Die Prüffragen und Kriterien der Vorlage „${presetFor(campaign).label}“ nur für diese Kampagne setzen`} disabled={applyToCampaign.isPending} onClick={async () => { const preset = presetFor(campaign); if (!(await confirmAction(`Prüffragen und Kriterien der Vorlage „${preset.label}“ für „${campaign}“ übernehmen? Die jetzigen Fragen und Kriterien dieser Kampagne werden ersetzt.`, { confirmLabel: "Übernehmen" }))) return; applyToCampaign.mutate({ preset: preset.key, campaign }); }}>Vorlage übernehmen</Button>}
        </div>
        <div className="mt-3 grid gap-2">
          {questionsDraft.map((question, index) => <div key={index} className={`cq-question-row is-${question.rule}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="cq-qnum">{index + 1}</span>
              <Input className="h-9 min-w-[220px] flex-1" value={question.label} placeholder="Frage, die die KI mit Ja / Nein / Unklar beantwortet" aria-label="Frage" maxLength={200} onChange={(event) => patchQuestion(index, { label: event.target.value })} />
              <select className={selectClass} value={question.rule} aria-label="Regel" onChange={(event) => patchQuestion(index, { rule: event.target.value as Rule })}><option value="ko">K.-o. (Nein = zurückgewiesen)</option><option value="required">Pflicht (Ja für Freigabe)</option><option value="info">Nur Auswertung</option></select>
              <select className={selectClass} value={question.onlyFor ?? ""} aria-label="Gilt für" title="Gilt die Frage nur für ein Produkt, entfällt sie bei anderen Gesprächen automatisch" onChange={(event) => patchQuestion(index, { onlyFor: (event.target.value || null) as Scope | null })}><option value="">gilt immer</option><option value="photovoltaik">nur Photovoltaik</option><option value="waermepumpe">nur Wärmepumpe</option></select>
              <Button size="sm" variant="ghost" aria-label="Frage entfernen" title="Frage entfernen" onClick={() => setQuestionsDraft(questionsDraft.filter((_, i) => i !== index))}>✕</Button>
            </div>
            <textarea className={`${fieldClass} mt-2`} rows={2} value={question.hint} placeholder="Hinweis für die KI (optional): Wann gilt Ja, wann Nein?" aria-label="Hinweis für die KI" maxLength={500} onChange={(event) => patchQuestion(index, { hint: event.target.value })} />
          </div>)}
          {!questionsDraft.length && <p className="text-xs text-slate-500">Noch keine Fragen – füge die erste hinzu.</p>}
        </div>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => setQuestionsDraft([...questionsDraft, { label: "", rule: "info", hint: "", onlyFor: null }])}>Frage hinzufügen</Button>
        <div className="cq-savebar">
          <Button size="sm" className="cq-save-questions flux-button" disabled={!questionsDirty || savingQuestions} onClick={saveQuestionsNow}>{savingQuestions ? "Speichere …" : "Änderungen speichern"}</Button>
          <Button size="sm" variant="ghost" disabled={!questionsDirty || savingQuestions} onClick={resetQuestions}>Zurücksetzen</Button>
          <span className="ml-auto text-xs text-slate-500">{questionsDirty ? "Ungespeicherte Änderungen" : "Alles gespeichert"}</span>
        </div>
      </div>}

      {tab === "auswertung" && <div className="cq-eval-box">
        <p className="text-xs text-slate-500">{summary.data?.calls ?? 0} bewertete Gespräche{campaign ? ` in „${campaign}“` : ""} – wie oft die KI je Frage „Ja“ gesagt hat (Ja / Nein / Unklar).</p>
        <div className="mt-3 grid gap-2">{(summary.data?.summary ?? []).map((row) => <div key={row.key} className="qa-summary-row"><span className="min-w-0 truncate text-xs text-slate-300" title={row.label}>{row.label}</span><span className="dash-bar"><i style={{ width: `${row.jaShare}%` }} /></span><b className="text-xs">{row.total ? `${row.jaShare} %` : "–"}</b><small className="text-[10px] text-slate-500">{row.ja}/{row.nein}{row.unklar ? `/${row.unklar}` : ""}</small></div>)}{!(summary.data?.summary ?? []).length && <p className="text-xs text-slate-500">Noch keine bewerteten Gespräche.</p>}</div>
      </div>}
    </div>
  </div>;
}

function CallDetail({ callId, onBack }: { callId: number; onBack: () => void }) {
  const utils = trpc.useUtils();
  const listened = trpc.leadops.markCallListened.useMutation({ onSuccess: () => utils.leadops.activityFeed.invalidate() }); // Glocke: „Gespräch abgehört“ – einmal je Aufruf der Seite
  const listenedOnce = useRef(false);
  const setAnswer = trpc.leadops.setCallQualificationAnswer.useMutation({ onSuccess: (result) => { utils.leadops.getCall.invalidate({ callId }); utils.leadops.listCalls.invalidate(); utils.leadops.callQaCampaignSummary.invalidate(); if (result.reason) toast.success(`Entscheidung: ${decisionLabel[result.decision] ?? result.decision} – ${result.reason}`); }, onError: (error) => toast.error(error.message) });
  const call = trpc.leadops.getCall.useQuery({ callId }, { retry: false });
  const [note, setNote] = useState(""); const [linkId, setLinkId] = useState("");
  const remove = trpc.leadops.deleteCall.useMutation({ onSuccess: () => { toast.success("Gespräch gelöscht."); utils.leadops.listCalls.invalidate(); utils.leadops.callStatistics.invalidate(); onBack(); }, onError: (error) => toast.error(error.message) });
  const refresh = () => { utils.leadops.getCall.invalidate({ callId }); utils.leadops.listCalls.invalidate(); utils.leadops.callStatistics.invalidate(); utils.leadops.listLeadsPaged.invalidate(); };
  const review = trpc.leadops.reviewCall.useMutation({ onSuccess: () => { toast.success("Entscheidung gespeichert."); refresh(); }, onError: (error) => toast.error(error.message) });
  const optInFromCall = trpc.leadops.optInFromCall.useMutation({ onSuccess: (result) => { if (!result) toast.error("Zu diesem Gespräch gibt es keinen Lead."); else toast[result.status === "gueltig" ? "success" : "warning"](result.created ? `Opt-in ${result.number} angelegt – ${result.status === "gueltig" ? "gültig" : "unvollständig, bitte prüfen oder per SMS bestätigen lassen"}.` : `Opt-in ${result.number} gibt es schon (${result.status}).`); refresh(); utils.leadops.listOptIns.invalidate(); }, onError: (error) => toast.error(error.message) });
  const reevaluate = trpc.leadops.reevaluateCall.useMutation({ onSuccess: (result) => { toast[result.status === "bewertet" ? "success" : "error"](result.status === "bewertet" ? `Neu bewertet: ${MOOD[moodOf({ verdict: result.verdict, decision: result.decision, status: result.status, score: result.score })].label}` : result.error ?? "Fehlgeschlagen"); refresh(); }, onError: (error) => toast.error(error.message) });
  const link = trpc.leadops.linkCallToLead.useMutation({ onSuccess: () => { toast.success("Lead zugeordnet."); refresh(); }, onError: (error) => toast.error(error.message) });
  // Abspieler: Zeiten im Gespräch springen dorthin; das Transkript erfährt die laufende Stelle, ohne dass die ganze Seite neu gezeichnet wird
  const player = useRef<CallPlayerHandle>(null); const timeListeners = useRef(new Set<(seconds: number) => void>());
  const onTime = useCallback((seconds: number) => { timeListeners.current.forEach((listener) => listener(seconds)); }, []);
  const subscribeTime = useCallback((listener: (seconds: number) => void) => { timeListeners.current.add(listener); return () => { timeListeners.current.delete(listener); }; }, []);
  const jump = useCallback((seconds: number) => player.current?.seek(seconds, true), []);
  // Zeitmarken fehlen noch (älteres Gespräch): einmal je Aufruf der Seite von selbst nachholen
  const timeline = trpc.leadops.fetchCallTimeline.useMutation({ onSuccess: () => utils.leadops.getCall.invalidate({ callId }), onError: (error) => toast.error(error.message) });
  const timelineAsked = useRef(false); const timelineMissing = call.data?.timelineState === "fehlt"; const fetchTimeline = timeline.mutate;
  useEffect(() => { if (timelineMissing && !timelineAsked.current) { timelineAsked.current = true; fetchTimeline({ callId }); } }, [timelineMissing, callId, fetchTimeline]);
  if (call.error) return <section className="surface-panel p-6 text-sm text-red-200">{call.error.message} <Button variant="ghost" size="sm" onClick={onBack}>Zurück</Button></section>;
  if (!call.data) return <section className="surface-panel p-6 text-sm text-slate-400">Gespräch wird geladen…</section>;
  const data = call.data;
  const mood = moodOf(data); const started = data.startedAt ? new Date(data.startedAt) : null; const contactName = data.leadName ?? data.rawContact?.name ?? null;
  const recordingSource = (data as { recordingSource?: string | null }).recordingSource ?? null;
  // Stellen im Gespräch: je Prüffrage und Kriterium die Zeit (Sekunden); Abschnitte der Abschrift mit Zeit
  const marks = (data.marks ?? {}) as Record<string, number>; const segments = (data.segments ?? []) as CallSegment[]; const canPlay = Boolean(data.recordingUrl);
  const answerTone = (answer: string | undefined): PlayerMark["tone"] => answer === "ja" ? "gruen" : answer === "nein" ? "rot" : "gelb";
  const playerMarks: PlayerMark[] = []; const usedSeconds = new Set<number>();
  for (const question of data.questions ?? []) { const at = marks[questionMark(question.key)]; if (typeof at !== "number" || usedSeconds.has(Math.round(at))) continue; usedSeconds.add(Math.round(at)); const given = data.qualificationAnswers?.[question.key]?.answer; playerMarks.push({ at, tone: answerTone(given), label: `${question.label} – ${given === "ja" ? "Ja" : given === "nein" ? "Nein" : "Unklar"}` }); }
  for (const criterion of data.criteria) { const at = marks[criterionMark(criterion.key)]; if (typeof at !== "number" || usedSeconds.has(Math.round(at))) continue; usedSeconds.add(Math.round(at)); playerMarks.push({ at, tone: criterion.score === null ? "offen" : criterion.score >= 7 ? "gruen" : criterion.score >= 4 ? "gelb" : "rot", label: criterion.label }); }
  const timelineBusy = timeline.isPending || (timelineMissing && !timeline.isError);
  // Woran es liegt: die entscheidenden Prüffragen (K.-o. und Pflicht), die nicht mit Ja beantwortet sind – „Nein“ zuerst
  const reasons = (data.questions ?? []).flatMap((question) => { const rule = ((question as { rule?: Rule }).rule ?? "info") as Rule; const given = data.qualificationAnswers?.[question.key]; if (rule === "info" || !given || given.answer === "ja" || /^Entfällt/i.test(given.note ?? "")) return []; return [{ key: question.key, label: question.label, answer: given.answer === "nein" ? "nein" as const : "unklar" as const }]; }).sort((a, b) => Number(a.answer === "unklar") - Number(b.answer === "unklar"));
  const dialer = data.dialer ?? null; // was der Dialer zum Kontakt mitgeschickt hat (Name, Anschrift, weitere Felder, Notiz)
  const dialerFacts: Array<[string, string]> = dialer ? ([["Leadsparte", dialer.category], ["Name", dialer.name], ["Firma", dialer.company], ["Straße", dialer.street], ["PLZ und Ort", dialer.place], ["E-Mail", dialer.email], ["Kontakt-Nummer im Dialer", dialer.contactId], ["Rückruf oder Termin", dialer.callbackAt && !Number.isNaN(new Date(dialer.callbackAt).getTime()) ? `${new Date(dialer.callbackAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })} Uhr` : dialer.callbackAt]] as Array<[string, string | null]>).filter((item): item is [string, string] => Boolean(item[1])) : [];
  return <div className="grid gap-4 gq-detail">
    <div className="gq-detail-bar"><button type="button" className="gq-back" onClick={onBack}><ChevronLeft aria-hidden="true" />Alle Gespräche</button><Button variant="outline" size="sm" className="gq-danger" disabled={remove.isPending} onClick={async () => { if (!(await confirmAction("Dieses Gespräch samt Transkript, Bewertung und hochgeladener Aufnahme endgültig löschen? Der Kontakt/Lead bleibt erhalten.", { confirmLabel: "Löschen", danger: true }))) return; remove.mutate({ callId }); }}>Gespräch löschen</Button></div>
    <section className="gq-stage gq-call-stage" aria-label="Ergebnis des Gesprächs">
      <div className="gq-call-top">
        <div className="gq-call-main">
          <MoodFace call={data} size="lg" percent />
          <div className="gq-call-text">
            <h2 className="gq-count">{MOOD[mood].label}</h2>
            <p className="gq-talk">{contactName ? `${contactName}, ` : ""}{started ? `${LONG_DAY.format(started)} um ${timeText(started)} Uhr` : "ohne Uhrzeit"}{typeof data.durationSeconds === "number" && data.durationSeconds > 0 ? `, ${clockText(data.durationSeconds)} Minuten` : ""}</p>
            <p className="gq-call-pills"><span className={`gq-pill is-${data.decision}`}>{decisionLabel[data.decision]}{data.decidedBy === "manuell" ? <i> · von Hand{data.reviewer ? ` (${data.reviewer})` : ""}</i> : data.decidedBy === "automatisch" ? <i> · automatisch</i> : null}</span>{data.callback && <span className="gq-pill cq-callback" title="Die Software hat erkannt, dass es ein Rückruf ist – der Firmenname muss dann nicht noch einmal genannt werden">Rückruf</span>}</p>
          </div>
        </div>
        <div className="gq-player">
          <b>Aufnahme anhören</b>
          {data.recordingUrl ? <>
            <CallPlayer ref={player} src={data.recordingUrl} duration={data.durationSeconds || (segments.length ? segments[segments.length - 1].e : null)} marks={playerMarks} hint="Die Punkte auf dem Balken zeigen, wo die Prüffragen und Kriterien besprochen werden." onTime={onTime} onPlay={() => { if (!listenedOnce.current) { listenedOnce.current = true; listened.mutate({ callId }); } }} />
            <small>{recordingSource === "vorschau" ? "Vorschau ohne Ton: Hier läuft nur die Uhr. Spulen, Tempo und die Zeiten arbeiten wie im echten Betrieb mit der Aufnahme." : recordingSource === "datei" ? "Hochgeladene Aufnahme – liegt bei uns, nur angemeldet abrufbar." : "Die Aufnahme liegt beim Dialer. Zum Anhören holen wir sie kurz zu uns – so kannst du vor- und zurückspulen."}</small>
            {timelineBusy ? <small className="gq-player-note is-busy">Die Zeiten zu den Prüffragen werden gerade geholt …</small> : data.timelineState === "ohne" && data.timelineNote ? <small className="gq-player-note">Keine Zeiten zu diesem Gespräch: {data.timelineNote} <button type="button" className="gq-link" disabled={timeline.isPending} onClick={() => timeline.mutate({ callId, force: true })}>Noch einmal versuchen</button></small> : null}
          </> : <small>{data.status === "ohne_einwilligung" ? "Ohne dokumentierte Einwilligung gibt es keine Aufnahme." : "Zu diesem Gespräch liegt keine Aufnahme vor."}</small>}
        </div>
      </div>
      <dl className="gq-call-facts">
        <div><dt>Agent</dt><dd><AgentEdit bare callId={data.id} agentName={data.agentName ?? null} manual={data.agentSource === "manuell"} fromDialer={data.agentSource === "dialer"} alias={(data as { agentAlias?: string | null }).agentAlias || null} viaAlias={data.agentSource === "alias"} onChanged={() => { call.refetch(); utils.leadops.listCalls.invalidate(); utils.leadops.callStatistics.invalidate(); utils.leadops.dialerAgentReport.invalidate(); utils.leadops.callAgentNames.invalidate(); }} /></dd></div>
        <div><dt>Kampagne</dt><dd>{data.campaign ?? data.provider}</dd></div>
        {data.category ? <div><dt>Lead-Kategorie</dt><dd title={dialer?.category ? `Leadsparte laut Dialer: ${dialer.category}` : "Von der KI aus dem Gespräch erkannt"}>{data.category.emoji ? `${data.category.emoji} ` : ""}{data.category.name}</dd></div> : null}
        <div><dt>Einwilligung zur Aufnahme</dt><dd>{data.consent ? `Ja (${data.consentSource ?? "Dialer"})` : "Nein"}</dd></div>
        {dialer?.result ? <div><dt>Ergebnis im Dialer</dt><dd>{dialer.result}</dd></div> : null}
      </dl>
      {(data.summary || data.nextStep || data.error || data.redFlags.length > 0 || reasons.length > 0) && <div className="gq-call-notes">
        {data.summary && <p className="gq-call-summary">{data.summary}</p>}
        {data.nextStep && <p className="gq-call-next">Nächster Schritt: {data.nextStep}</p>}
        {reasons.length > 0 && <div className="gq-why"><b>Woran es liegt</b><ul>{reasons.map((reason) => <li key={reason.key} className={`is-${reason.answer}`}><span className="gq-why-answer">{reason.answer === "nein" ? "Nein" : "Unklar"}</span><span className="gq-why-text">{reason.label}</span><AtChip at={marks[questionMark(reason.key)]} label={reason.label} onJump={canPlay ? jump : null} /></li>)}</ul></div>}
        {data.error && <p className="gq-call-error">{data.error}</p>}
        {data.redFlags.length > 0 && <p className="gq-call-flags">{data.redFlags.map((flag) => <span key={flag} className="gq-flag">⚠ {flag}</span>)}</p>}
      </div>}
    </section>
    <section className="surface-panel operations-panel gq-panel gq-decide" aria-label="Entscheidung">
      <div className="gq-panel-head"><div><h2>Entscheidung</h2><p>{data.autoDeliver ? "Freigeben setzt den Lead auf „genehmigt“, startet die Auslieferung über die Regeln und legt den Opt-in-Nachweis aus der Einwilligungsstelle der Abschrift an." : "Freigeben setzt den Lead auf „genehmigt“ und legt den Opt-in-Nachweis aus der Einwilligungsstelle der Abschrift an. Weitergeleitet wird nichts – Leads werden gerade nur empfangen."} Zurückweisen markiert ihn als fehlerhaft.</p></div>
        <p className="gq-lead-line">{data.rawContact && !data.leadPublicId && <span className="gq-raw">Rohdaten-Kontakt {data.rawContact.name} ({data.rawContact.status}) – wird bei Freigabe zum Lead.</span>}{data.leadPublicId ? <><span>Lead</span><span className="gq-lead-id">{data.leadPublicId}</span><b>{data.leadName}</b><span className="gq-chip">{data.leadStatus}</span><button type="button" className="gq-link" onClick={() => window.location.assign(`/?page=Leads&leadId=${data.leadPublicId}`)}>Lead öffnen</button></> : <span>Noch keinem Lead zugeordnet</span>}</p></div>
      <div className="gq-decide-row"><Input value={note} placeholder="Notiz zur Entscheidung (optional)" aria-label="Notiz zur Entscheidung" onChange={(event) => setNote(event.target.value)} />
        <div className="gq-choices" role="group" aria-label="Entscheidung treffen">{([["freigegeben", "gruen", data.autoDeliver ? "Freigeben & verkaufen" : "Freigeben"], ["pruefen", "gelb", "Zur Prüfung"], ["zurueckgewiesen", "rot", "Zurückweisen"]] as const).map(([key, mood, label]) => <button key={key} type="button" className={`gq-choice is-${mood} ${data.decision === key ? "is-on" : ""}`} aria-pressed={data.decision === key} disabled={review.isPending} onClick={() => review.mutate({ callId, decision: key, note })}><i aria-hidden="true" />{label}</button>)}</div></div>
      {data.reviewNote && <p className="gq-decide-note">Notiz: {data.reviewNote}</p>}
      <div className="gq-decide-foot"><div className="gq-tools"><button type="button" className="cq-tool" disabled={reevaluate.isPending || data.status === "ohne_einwilligung"} title="Das Gespräch nach den aktuellen Regeln der Kampagne neu bewerten" onClick={() => reevaluate.mutate({ callId })}><RefreshCw aria-hidden="true" /><span>Neu bewerten</span></button>{data.leadId && <button type="button" className="cq-tool" title="Einwilligungsstelle aus der Abschrift als Opt-in-Nachweis anlegen (ohne Freigabe)" disabled={optInFromCall.isPending} onClick={() => optInFromCall.mutate({ callId })}><FileCheck2 aria-hidden="true" /><span>Opt-in aus Gespräch</span></button>}</div>
        <div className="gq-assign"><Input value={linkId} placeholder="Lead-ID zuordnen" aria-label="Lead-ID zuordnen" onChange={(event) => setLinkId(event.target.value)} /><Button size="sm" variant="outline" onClick={() => link.mutate({ callId, publicId: linkId.trim() })} disabled={!linkId.trim()}>Zuordnen</Button></div></div>
    </section>
    {dialer && (dialerFacts.length > 0 || dialer.fields.length > 0 || dialer.note) && <section className="surface-panel operations-panel gq-panel gq-dialer" aria-label="Vom Dialer gemeldet">
      <div className="gq-panel-head"><div><h2>Vom Dialer gemeldet</h2><p>Diese Angaben hat der Dialer mit dem Gespräch geschickt. {data.leadPublicId ? "Sie stehen im Lead; vorhandene Angaben wurden nicht überschrieben." : "Bei einer Freigabe wird daraus der Lead."}</p></div></div>
      {(dialerFacts.length > 0 || dialer.fields.length > 0) && <dl className="gq-dialer-facts">{dialerFacts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}{dialer.fields.map((field) => <div key={field.label} className="is-extra"><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}
      {dialer.note && <p className="gq-dialer-note"><b>Notiz des Agenten</b>{dialer.note}</p>}
    </section>}
    {data.leadPublicId && <section className="surface-panel operations-panel gq-panel"><OptInPanel publicId={data.leadPublicId} onChanged={refresh} /></section>}
    <div className="gq-detail-grid">
      <section className="surface-panel operations-panel gq-panel" aria-label="Prüffragen">
        <div className="gq-panel-head"><div><h2>Prüffragen{data.campaign ? <span> {data.campaign}</span> : null}</h2><p>Diese Fragen entscheiden über Freigabe, Prüfung oder Zurückweisung. Jede Antwort lässt sich von Hand ändern – die Entscheidung folgt sofort.{data.nextStep ? <> <b>Aktuell:</b> {data.nextStep}</> : null}</p></div></div>
        <ul className="gq-qlist">{(data.questions ?? []).map((question) => { const answer = data.qualificationAnswers?.[question.key]; const rule = ((question as { rule?: Rule }).rule ?? "info") as Rule; const given = answer?.answer ?? "unklar"; return <li key={question.key} className={`gq-q is-${given}`}>
          <div className="gq-q-text"><strong>{question.label}</strong><span className="gq-q-tags"><span className={`gq-rule is-${rule}`}>{RULE_SHORT[rule]}</span>{question.onlyFor && <span className="gq-rule">nur {SCOPE_LABEL[question.onlyFor]}</span>}<AtChip at={marks[questionMark(question.key)]} label={question.label} onJump={canPlay ? jump : null} /></span>{answer?.note && <Expandable text={answer.note} className="gq-q-note" />}</div>
          <div className="gq-answers" role="group" aria-label={`Antwort: ${question.label}`}>{(["ja", "nein", "unklar"] as const).map((option) => <button key={option} type="button" className={`gq-answer is-${option} ${given === option ? "is-on" : ""}`} aria-pressed={given === option} onClick={() => setAnswer.mutate({ callId, key: question.key, answer: option })}>{option === "ja" ? "Ja" : option === "nein" ? "Nein" : "Unklar"}</button>)}</div>
        </li>; })}</ul>
        {!(data.questions ?? []).length && <p className="gq-panel-empty">Für diese Kampagne sind keine Fragen hinterlegt.</p>}
      </section>
      <section className="surface-panel operations-panel gq-panel" aria-label="Kriterien">
        <div className="gq-panel-head"><div><h2>Kriterien{data.criteriaCustom ? <span> eigene der Kampagne</span> : null}</h2>{data.verdict && <p>KI-Einschätzung zur Gesprächsqualität: <b>{verdictLabel[data.verdict]}</b>{typeof data.score === "number" && <>, Qualitätsnote <b>{data.score} %</b> (aus den gewichteten Kriterien)</>}. Entschieden wird aber über die Prüffragen (K.-o. und Pflicht) – deshalb kann die Ampel davon abweichen.</p>}</div></div>
        {data.criteriaUnscored && <p className="cq-unscored">Die Kriterien dieses Gesprächs sind noch nicht bewertet. Das holt die Software in den nächsten Minuten automatisch nach – die Ampel oben gilt trotzdem, denn sie kommt aus den Prüffragen. Sofort geht es mit „Neu bewerten“.{data.criteriaNote ? <span className="mt-1 block opacity-70">Technischer Hinweis: {data.criteriaNote}</span> : null}</p>}
        <ul className="gq-clist">{data.criteria.map((criterion) => { const mood = criterion.score === null ? "offen" : criterion.score >= 7 ? "gruen" : criterion.score >= 4 ? "gelb" : "rot"; return <li key={criterion.key} className={`gq-c is-${mood}`}>
          <div className="gq-c-head"><strong>{criterion.label}</strong><small>Gewicht {criterion.weight}</small><AtChip at={marks[criterionMark(criterion.key)]} label={criterion.label} onJump={canPlay ? jump : null} />{criterion.score !== null && <b className="cq-percent-sm">{criterion.score * 10} %</b>}<span className="cq-mood is-sm" title={criterion.score === null ? "Noch nicht bewertet" : `Einschätzung der KI: ${criterion.score >= 7 ? "erfüllt" : criterion.score >= 4 ? "teilweise" : "nicht erfüllt"}`}><Face mood={mood} size={24} /></span></div>
          <i className="gq-c-bar" aria-hidden="true"><i style={{ width: `${((criterion.score ?? 0) / 10) * 100}%` }} /></i>
          {criterion.evidence && <Expandable text={criterion.evidence} quote className="gq-c-evidence" />}
        </li>; })}</ul>
      </section>
      <section className="surface-panel operations-panel gq-panel is-wide" aria-label="Transkript">
        <div className="gq-panel-head"><div><h2>Transkript</h2>{segments.length > 0 && <p>{canPlay ? "Ein Klick auf eine Zeile spielt die Aufnahme ab dieser Stelle. Die Zeile, die gerade läuft, ist hervorgehoben." : "Links steht, wann im Gespräch der Satz fällt."}</p>}</div></div>
        {segments.length > 0 ? <TimedTranscript segments={segments} onJump={canPlay ? jump : null} subscribe={subscribeTime} /> : <Transcript text={data.transcript ?? null} fallback={data.status === "ohne_einwilligung" ? "Ohne dokumentierte Einwilligung wird das Gespräch nicht transkribiert." : "Noch kein Transkript."} />}
      </section>
    </div>
  </div>;
}

/** Zeit einer Stelle im Gespräch („1:31“). Mit Aufnahme ein Knopf, der dorthin springt und abspielt; ohne Aufnahme nur die Zeit. */
function AtChip({ at, label, onJump }: { at: number | undefined; label: string; onJump: ((seconds: number) => void) | null }) {
  if (typeof at !== "number") return null;
  if (!onJump) return <span className="gq-at is-static" title="Stelle im Gespräch">{clock(at)}</span>;
  return <button type="button" className="gq-at" title={`In der Aufnahme zu ${clock(at)} springen`} aria-label={`${label}: in der Aufnahme zu ${clock(at)} springen`} onClick={() => onJump(at)}><Play aria-hidden="true" />{clock(at)}</button>;
}
/** Abschrift mit Zeiten: jede Zeile trägt ihre Zeit; ein Klick spielt ab dieser Stelle, die laufende Zeile ist hervorgehoben. */
function TimedTranscript({ segments, onJump, subscribe }: { segments: CallSegment[]; onJump: ((seconds: number) => void) | null; subscribe: (listener: (seconds: number) => void) => () => void }) {
  const [current, setCurrent] = useState(-1); const list = useRef<HTMLOListElement>(null);
  useEffect(() => subscribe((seconds) => { const index = segmentIndexAt(segments, seconds); setCurrent((old) => (old === index ? old : index)); }), [segments, subscribe]);
  // Lange Gespräche: Die Liste rollt mit, sobald die laufende Zeile aus ihrem Fenster wandert (nur in der Liste – die Seite bleibt, wo sie ist)
  useEffect(() => { const box = list.current; const row = box?.children[current] as HTMLElement | undefined; if (!box || !row || box.clientHeight <= 0 || box.scrollHeight <= box.clientHeight) return; const top = row.offsetTop; if (top < box.scrollTop || top + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = Math.max(0, top - box.clientHeight / 3); }, [current]);
  const rows = segments.map((segment) => { const match = segment.sp === undefined ? /^\s*([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß .\-]{0,28}?):\s+(.*)$/.exec(segment.t) : null; return { at: segment.s, who: segment.sp !== undefined ? `Sprecher ${segment.sp + 1}` : match ? match[1].trim() : "", text: match ? match[2] : segment.t }; });
  const speakers = Array.from(new Set(rows.map((row) => row.who).filter(Boolean)));
  return <ol ref={list} className="gq-segs">{rows.map((row, index) => { const body = <><time>{clock(row.at)}</time><span>{row.who && <b className={`is-speaker-${Math.max(0, speakers.indexOf(row.who)) % 4}`}>{row.who}</b>}{row.text}</span></>; return <li key={index}>{onJump ? <button type="button" className={`gq-seg ${index === current ? "is-now" : ""}`} aria-current={index === current ? "true" : undefined} aria-label={`Ab ${clock(row.at)} abspielen: ${row.text.slice(0, 80)}`} onClick={() => onJump(row.at)}>{body}</button> : <div className="gq-seg is-static">{body}</div>}</li>; })}</ol>;
}
/** Abschrift als Gespräch: erkennt Zeilen wie „Agent: …“ / „Kunde: …“ und setzt sie als Wortwechsel; sonst bleibt der Text, wie er ist. */
function Transcript({ text, fallback }: { text: string | null; fallback: string }) {
  if (!text?.trim()) return <p className="gq-panel-empty">{fallback}</p>;
  const turns: Array<{ who: string; text: string }> = [];
  for (const line of text.split(/\n+/)) { const match = /^\s*([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß .\-]{0,28}?):\s+(.*)$/.exec(line); if (match) turns.push({ who: match[1].trim(), text: match[2] }); else if (turns.length && line.trim()) turns[turns.length - 1].text += ` ${line.trim()}`; else if (line.trim()) turns.push({ who: "", text: line.trim() }); }
  const speakers = Array.from(new Set(turns.map((turn) => turn.who).filter(Boolean)));
  if (speakers.length < 2 || speakers.length > 4) return <pre className="gq-transcript">{text}</pre>;
  return <div className="gq-turns">{turns.map((turn, index) => <p key={index} className={`gq-turn is-speaker-${Math.max(0, speakers.indexOf(turn.who))}`}>{turn.who && <b>{turn.who}</b>}<span>{turn.text}</span></p>)}</div>;
}

/* ─────────────── Dialer & Bewertung: links die Abschnitte mit ihrem Stand, rechts immer genau ein Abschnitt ─────────────── */
type SettingsTab = "anbindung" | "alias" | "vorlagen" | "bewertung" | "regeln" | "daten" | "beispiele" | "testen";
const SETTINGS_TABS: Array<[SettingsTab, typeof Cable, string]> = [["anbindung", Cable, "Anbindung"], ["alias", Users, "Alias-Namen"], ["vorlagen", LayoutTemplate, "Vorlagen"], ["bewertung", Gauge, "Kriterien und Ampel"], ["regeln", ListOrdered, "Eigene Regeln"], ["daten", TextSearch, "Daten auslesen"], ["beispiele", BookOpenText, "Beispiele für die KI"], ["testen", FlaskConical, "Ausprobieren"]];
/** Welche Felder zu welchem Abschnitt gehören – daraus entsteht der Punkt „ungespeichert“ in der Leiste. */
const SETTINGS_FIELDS: Partial<Record<SettingsTab, string[]>> = { anbindung: ["enabled", "autoDeliver", "consentRequired", "fieldMapping", "recordingAuthHeader", "transcriptionProvider", "transcriptionLanguage"], bewertung: ["criteria", "instructions", "autoApproveThreshold", "autoRejectThreshold", "retentionDays"], regeln: ["decisionRules"], daten: ["extractFields"], beispiele: ["examples"] };
const RULE_IDEAS = [{ label: "Warnsignal vorhanden", field: "redFlags", op: "any", value: "", decision: "zurueckgewiesen", then: "zurückweisen" }, { label: "Transkript enthält „Mieter“", field: "transcript", op: "contains", value: "Mieter", decision: "pruefen", then: "zur Prüfung" }, { label: "Gesamtpunkte höchstens 30", field: "score", op: "lte", value: "30", decision: "zurueckgewiesen", then: "zurückweisen" }] as const;
const FIELD_IDEAS = [{ key: "dachflaeche", label: "Dachfläche", question: "Wie groß ist die Dachfläche?" }, { key: "baujahr", label: "Baujahr", question: "In welchem Jahr wurde das Haus gebaut?" }, { key: "wunschtermin", label: "Wunschtermin", question: "Wann soll sich ein Fachbetrieb melden?" }];
const VERDICT_CHOICES = [["verkaufbar", "gruen", "Verkaufbar"], ["nachfassen", "gelb", "Nachfassen"], ["nicht_verkaufbar", "rot", "Nicht verkaufbar"]] as const;
/** Aus einer Bezeichnung wird das Kürzel (Kleinbuchstaben, Ziffern, Unterstrich). */
const keyOf = (text: string) => text.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
const cleanKey = (text: string) => text.replace(/[^a-z0-9_]/gi, "").toLowerCase();
const whole = (value: string, max: number) => Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
/** Schalter – der ganze Kasten ist die Schaltfläche. */
const Switch = ({ checked, onChange, label, hint, plain = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string; plain?: boolean }) => <button type="button" role="switch" aria-checked={checked} className={`gs-switch ${checked ? "is-on" : ""} ${plain ? "is-plain" : ""}`} onClick={() => onChange(!checked)}><i aria-hidden="true" /><span><b>{label}</b>{hint && <small>{hint}</small>}</span></button>;

function CallQaSettings({ onOpenCall }: { onOpenCall: (callId: number) => void }) {
  const utils = trpc.useUtils();
  const settings = trpc.leadops.getCallQaSettings.useQuery(undefined, { retry: false });
  const [tab, setTab] = useState<SettingsTab>("anbindung"); // der gewählte Abschnitt bleibt stehen, auch wenn das Formular nach dem Speichern neu aufgebaut wird
  if (settings.error) return <section className="surface-panel p-6 text-sm text-red-200">{settings.error.message}</section>;
  if (!settings.data) return <section className="surface-panel p-6 text-sm text-slate-400">Einstellungen werden geladen…</section>;
  return <SettingsForm key={settings.data.updatedAt ? String(settings.data.updatedAt) : "init"} data={settings.data} tab={tab} onTab={setTab} onOpenCall={onOpenCall} onDone={() => { utils.leadops.getCallQaSettings.invalidate(); utils.leadops.listCalls.invalidate(); utils.leadops.callStatistics.invalidate(); }} />;
}

function SettingsForm({ data, onDone, tab, onTab, onOpenCall }: { data: Settings; onDone: () => void; tab: SettingsTab; onTab: (tab: SettingsTab) => void; onOpenCall: (callId: number) => void }) {
  const initial = () => ({ enabled: data.enabled, consentRequired: data.consentRequired, autoApproveThreshold: data.autoApproveThreshold, autoRejectThreshold: data.autoRejectThreshold, autoDeliver: data.autoDeliver, criteria: data.criteria, instructions: data.instructions ?? "", fieldMapping: data.fieldMapping, recordingAuthHeader: data.recordingAuthHeader, transcriptionProvider: data.transcriptionProvider, transcriptionLanguage: data.transcriptionLanguage, retentionDays: data.retentionDays, decisionRules: data.decisionRules, examples: data.examples, extractFields: data.extractFields });
  type Form = ReturnType<typeof initial>;
  const saved = useMemo(() => JSON.stringify(initial()), [data]);
  const base = useMemo(() => JSON.parse(saved) as Record<string, unknown>, [saved]);
  const [form, setForm] = useState(initial);
  useEffect(() => { setForm(initial()); }, [saved]); // nur wenn sich der gespeicherte Stand wirklich ändert – ein bloßes Neuladen der Daten verwirft keine Eingaben
  const patch = (changes: Partial<Form>) => setForm((current) => ({ ...current, ...changes }));
  const dirtyTabs = SETTINGS_TABS.map(([key]) => key).filter((key) => (SETTINGS_FIELDS[key] ?? []).some((name) => JSON.stringify((form as Record<string, unknown>)[name]) !== JSON.stringify(base[name])));
  const dirty = dirtyTabs.length > 0;
  const save = trpc.leadops.saveCallQaSettings.useMutation({ onSuccess: () => { toast.success("Einstellungen gespeichert."); onDone(); }, onError: (error) => toast.error(error.message) });
  const submit = () => {
    if (!form.criteria.length) { onTab("bewertung"); toast.error("Mindestens ein Kriterium ist nötig."); return; }
    if (form.criteria.some((criterion) => !criterion.key.trim() || !criterion.label.trim())) { onTab("bewertung"); toast.error("Bitte jedem Kriterium eine Bezeichnung geben."); return; }
    if (form.criteria.reduce((sum, criterion) => sum + (Number(criterion.weight) || 0), 0) <= 0) { onTab("bewertung"); toast.error("Mindestens ein Kriterium braucht ein Gewicht über 0."); return; }
    if (form.autoRejectThreshold >= form.autoApproveThreshold) { onTab("bewertung"); toast.error("„Rot bis“ muss kleiner sein als „Grün ab“."); return; }
    save.mutate(form);
  };
  const rotate = trpc.leadops.rotateCallQaToken.useMutation({ onSuccess: () => { toast.success("Neue Webhook-Adresse erzeugt. Bitte im Dialer aktualisieren."); onDone(); }, onError: (error) => toast.error(error.message) });
  const simulate = trpc.leadops.simulateCall.useMutation({ onSuccess: (result) => { toast[result.status === "bewertet" ? "success" : "error"](result.status === "bewertet" ? `Bewertung: ${MOOD[moodOf({ verdict: result.verdict, decision: result.decision, status: result.status, score: result.score })].label} – ${verdictLabel[result.verdict ?? "unklar"]} → ${decisionLabel[result.decision]}` : result.error ?? "Fehlgeschlagen"); onDone(); }, onError: (error) => toast.error(error.message) });
  const [transcript, setTranscript] = useState(""); const [testLead, setTestLead] = useState("");
  const [presetAll, setPresetAll] = useState(true);
  const applyPreset = trpc.leadops.applyCallQaPreset.useMutation({ onSuccess: (result) => { toast.success(`Vorlage übernommen – Kriterien, KI-Anweisung und Prüffragen sind gesetzt${result.campaigns ? ` (auch für ${result.campaigns} Kampagnen-Fragensätze)` : ""}.`); onDone(); onTab("bewertung"); }, onError: (error) => toast.error(error.message) });
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); toast.success("Kopiert."); } catch { toast.error("Kopieren nicht möglich."); } };
  const mappingKeys: Array<[keyof typeof form.fieldMapping, string]> = [["callId", "Gesprächs-ID"], ["leadId", "Lead-ID (unsere)"], ["phone", "Telefonnummer"], ["agent", "Agent"], ["campaign", "Kampagne"], ["direction", "Richtung"], ["startedAt", "Beginn"], ["duration", "Dauer (Sek.)"], ["recordingUrl", "Aufzeichnungs-URL"], ["transcript", "Transkript (falls vorhanden)"], ["consent", "Einwilligung"]];
  const sample = JSON.stringify({ [form.fieldMapping.callId]: "abc-123", [form.fieldMapping.leadId]: "API-1A2B3C4D", [form.fieldMapping.phone]: "+49 170 1234567", [form.fieldMapping.agent]: "Deniz Kaya", [(form.fieldMapping as Record<string, string>).category ?? CONTACT_MAPPING.category]: "PV", [form.fieldMapping.campaign]: "PV Q4", [form.fieldMapping.startedAt]: "2026-09-23T10:15:00Z", [form.fieldMapping.duration]: 312, [form.fieldMapping.recordingUrl]: "https://…/aufzeichnung.mp3", [form.fieldMapping.consent]: true }, null, 2);

  // Aufnahme → Text: welcher Dienst gerade greift (oder dass keiner eingerichtet ist)
  const { openai, deepgram } = data.transcriptionAvailable; const provider = form.transcriptionProvider;
  const textService = provider === "payload" ? "Transkript kommt vom Dialer – kein Dienst nötig." : provider === "openai" || (provider === "auto" && openai) ? "Aktiv: OpenAI Whisper (Schlüssel beim Hosting hinterlegt)." : provider === "deepgram" || (provider === "auto" && deepgram) ? "Aktiv: Deepgram (Schlüssel beim Hosting hinterlegt)." : null;
  const enabledHint = form.enabled ? (form.enabled === data.enabled ? "An: Gespräche werden angenommen und bewertet." : "Wird nach dem Speichern eingeschaltet.") : (form.enabled === data.enabled ? "Aus: Es wird nichts angenommen (Antwort „call evaluation disabled“)." : "Wird nach dem Speichern ausgeschaltet.");

  // Listen bearbeiten
  const setCriterion = (index: number, changes: Partial<Form["criteria"][number]>) => setForm((current) => ({ ...current, criteria: current.criteria.map((item, i) => i === index ? { ...item, ...changes } : item) }));
  const savedCriteria = new Set(((base.criteria as Form["criteria"] | undefined) ?? []).map((criterion) => criterion.key));
  /** Neue Kriterien bekommen ihr Kürzel aus der Bezeichnung – gespeicherte behalten ihres (Regeln und alte Bewertungen hängen daran). */
  const renameCriterion = (index: number, label: string) => setForm((current) => {
    const item = current.criteria[index]; const follows = !item.key || (!savedCriteria.has(item.key) && (/^kriterium_\d+$/.test(item.key) || item.key === keyOf(item.label)));
    let key = follows ? keyOf(label) || `kriterium_${index + 1}` : item.key; if (key !== item.key && current.criteria.some((entry, i) => i !== index && entry.key === key)) key = `${key}_${index + 1}`;
    return { ...current, criteria: current.criteria.map((entry, i) => i === index ? { ...entry, label, key } : entry), decisionRules: key === item.key ? current.decisionRules : current.decisionRules.map((rule) => rule.field === `criterion:${item.key}` ? { ...rule, field: `criterion:${key}` as typeof rule.field } : rule) };
  });
  const setRule = (index: number, changes: Partial<Form["decisionRules"][number]>) => setForm((current) => ({ ...current, decisionRules: current.decisionRules.map((item, i) => i === index ? { ...item, ...changes } : item) }));
  const addRule = (idea?: (typeof RULE_IDEAS)[number]) => setForm((current) => ({ ...current, decisionRules: [...current.decisionRules, { id: `r${Date.now()}`, label: idea?.label ?? "", field: idea?.field ?? "score", op: idea?.op ?? "gte", value: idea?.value ?? "", decision: idea?.decision ?? "pruefen", active: true } as Form["decisionRules"][number]] }));
  const savedFields = new Set(((base.extractFields as Form["extractFields"] | undefined) ?? []).map((item) => item.key));
  const setExtract = (index: number, changes: Partial<Form["extractFields"][number]>) => setForm((current) => ({ ...current, extractFields: current.extractFields.map((item, i) => i === index ? { ...item, ...changes } : item) }));
  const renameExtract = (index: number, label: string) => setForm((current) => ({ ...current, extractFields: current.extractFields.map((item, i) => i === index ? { ...item, label, key: !item.key || (!savedFields.has(item.key) && item.key === keyOf(item.label)) ? keyOf(label) : item.key } : item) }));
  const setExample = (index: number, changes: Partial<Form["examples"][number]>) => setForm((current) => ({ ...current, examples: current.examples.map((item, i) => i === index ? { ...item, ...changes } : item) }));

  const aliasOverview = trpc.leadops.agentAliasOverview.useQuery(undefined, { retry: false, staleTime: 30_000 }); const aliasCount = aliasOverview.data ? aliasOverview.data.aliases.filter((item) => item.name).length : null;
  const weightTotal = form.criteria.reduce((sum, criterion) => sum + (Number(criterion.weight) || 0), 0);
  const low = Math.max(0, Math.min(100, form.autoRejectThreshold)); const high = Math.max(0, Math.min(100, form.autoApproveThreshold)); const scaleOk = low < high;
  const activeRules = form.decisionRules.filter((rule) => rule.active).length;
  const status: Record<SettingsTab, string> = {
    anbindung: !form.enabled ? "Ausgeschaltet" : textService ? "Eingeschaltet" : "Text-Dienst fehlt",
    alias: aliasCount === null ? "Name am Telefon → echter Name" : aliasCount ? `${aliasCount} ${aliasCount === 1 ? "Zuordnung" : "Zuordnungen"}` : "Noch keine",
    vorlagen: `${CALL_QA_PRESETS.length} fertige Vorlagen`,
    bewertung: `${form.criteria.length} Kriterien, grün ab ${form.autoApproveThreshold} %`,
    regeln: form.decisionRules.length ? `${activeRules} von ${form.decisionRules.length} aktiv` : "Noch keine",
    daten: form.extractFields.length ? `${form.extractFields.length} ${form.extractFields.length === 1 ? "Frage" : "Fragen"}` : "Noch keine Fragen",
    beispiele: form.examples.length ? `${form.examples.length} ${form.examples.length === 1 ? "Beispiel" : "Beispiele"}` : "Noch keine",
    testen: "Text einfügen und bewerten",
  };
  const tone: Partial<Record<SettingsTab, string>> = { anbindung: !form.enabled ? "is-off" : textService ? "is-ok" : "is-warn" };
  const tested = simulate.data ?? null; const testedMood = tested && tested.status === "bewertet" ? moodOf({ verdict: tested.verdict, decision: tested.decision, status: tested.status, score: tested.score }) : null;

  return <div className="gq-settings">
    <nav className="surface-panel gs-rail" aria-label="Abschnitte der Einstellungen">{SETTINGS_TABS.map(([key, Icon, label]) => <button key={key} type="button" className={`gs-nav ${tab === key ? "is-on" : ""}`} aria-current={tab === key ? "true" : undefined} onClick={(event) => { onTab(key); event.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" }); /* am Handy ist die Leiste eine Reihe zum Wischen */ }}>
      <span className="gs-nav-icon"><Icon aria-hidden="true" /></span>
      <span className="gs-nav-text"><b>{label}</b><small className={tone[key] ?? ""}>{status[key]}</small></span>
      {dirtyTabs.includes(key) && <i className="gs-nav-dot" role="img" aria-label="ungespeicherte Änderungen" title="Ungespeicherte Änderungen" />}
    </button>)}</nav>

    <div className="gs-main">
      {tab === "alias" && <AgentAliasSettings />}
      {tab === "anbindung" && <section className="surface-panel operations-panel gs-card" aria-labelledby="gs-h">
        <header className="gs-head"><div><h2 id="gs-h">Anbindung an den Dialer</h2><p>Der Dialer meldet jedes beendete Gespräch an deine Adresse. Den Rest erledigt die Software von selbst.</p></div><Switch checked={form.enabled} onChange={(value) => patch({ enabled: value })} label="Gesprächsbewertung" hint={enabledHint} /></header>
        <DialerIntake />
        <ol className="gs-flow" aria-label="So läuft ein Gespräch durch">
          <li className={form.enabled ? "is-ok" : "is-off"}><span className="gs-flow-icon"><PhoneIncoming aria-hidden="true" /></span><b>Der Dialer meldet das Gespräch</b><small>{form.enabled ? "Die Adresse nimmt Gespräche an." : "Ausgeschaltet – es wird nichts angenommen."}</small></li>
          <li className="is-ok"><span className="gs-flow-icon"><Download aria-hidden="true" /></span><b>Die Aufnahme wird geholt</b><small>Noch nicht fertig? Dann holen wir sie nach – bis zu 8 Versuche in etwa 4 Stunden.</small></li>
          <li className={textService ? "is-ok" : "is-warn"}><span className="gs-flow-icon"><FileText aria-hidden="true" /></span><b>Aus der Aufnahme wird Text</b><small>{provider === "payload" ? "Der Text kommt fertig vom Dialer." : textService ? `${textService.replace(/^Aktiv: /, "").replace(/ \(.*$/, "")} ist aktiv.` : "Kein Dienst eingerichtet – so kann die KI nichts auswerten."}</small></li>
          <li className="is-ok"><span className="gs-flow-icon"><Sparkles aria-hidden="true" /></span><b>Die KI bewertet</b><small>Nach deinen Kriterien und den Prüffragen der Kampagne.</small></li>
        </ol>
        <div className="gs-address">
          <div className="gs-address-label"><b>Adresse für den Dialer</b><small>Im Dialer als Webhook für „Gespräch beendet“ eintragen.</small></div>
          <div className="gs-address-row"><code title={data.webhookUrl}><span>POST</span><em>{data.webhookUrl}</em></code><button type="button" className="gs-btn" onClick={() => copy(data.webhookUrl)}><Copy aria-hidden="true" />Kopieren</button></div>
          <div className="gs-address-more"><button type="button" className="gs-textbtn" title="Fertige Anleitung mit dieser Adresse, den Feldnamen und Beispielen – zum Einfügen in eine E-Mail an den Entwickler des Dialers (ohne Produktname)" onClick={() => copy(dialerGuideText({ webhookUrl: data.webhookUrl, fieldMapping: form.fieldMapping, consentRequired: form.consentRequired, recordingAuthHeader: Boolean(form.recordingAuthHeader) }))}>Anleitung für den Dialer-Entwickler kopieren</button><button type="button" className="gs-textbtn" onClick={async () => { if (await confirmAction("Neue Adresse erzeugen? Die alte wird ungültig.")) rotate.mutate(); }}>Neue Adresse erzeugen</button></div>
        </div>
        <div className="gs-box gs-deliver"><div className="gs-deliver-head"><h3>Freigegebene Leads</h3><p>{form.autoDeliver ? "Was die Bewertung freigibt, läuft sofort über deine Regeln zu den Käufern." : "Die Leads kommen an und bleiben unter „Leads“ liegen, bis du sie selbst weitergibst."}</p></div>
          <div className="gs-modes" role="radiogroup" aria-label="Was passiert mit freigegebenen Leads?">
            <button type="button" role="radio" aria-checked={!form.autoDeliver} className={`gs-mode ${form.autoDeliver ? "" : "is-on"}`} onClick={() => patch({ autoDeliver: false })}><Inbox aria-hidden="true" /><span><b>Nur empfangen</b><small>Nichts wird weitergeleitet.</small></span></button>
            <button type="button" role="radio" aria-checked={form.autoDeliver} className={`gs-mode ${form.autoDeliver ? "is-on" : ""}`} onClick={() => patch({ autoDeliver: true })}><Send aria-hidden="true" /><span><b>Sofort ausliefern</b><small>Über die Regeln an die Käufer.</small></span></button>
          </div></div>
        <div className="gs-grid-2">
          <div className="gs-box"><h3>Aufnahmen</h3><Switch checked={form.consentRequired} onChange={(value) => patch({ consentRequired: value })} label="Einwilligung erforderlich" hint="Nur Gespräche mit dokumentierter Einwilligung zur Aufzeichnung (Feld „Einwilligung“ = ja) werden in Text umgewandelt und bewertet." />
            <p className="gs-note"><ShieldCheck aria-hidden="true" /><span>Aufzeichnen ohne Einwilligung beider Seiten ist in Deutschland strafbar (§ 201 StGB).</span></p>
            <label className="gs-field">Zugang zu den Aufnahmen (Header)<Input value={form.recordingAuthHeader} placeholder="Authorization: Bearer …" onChange={(event) => patch({ recordingAuthHeader: event.target.value })} /><small>Nur nötig, wenn der Dialer die Aufnahmen nicht frei herausgibt.</small></label></div>
          <div className="gs-box"><h3>Aus der Aufnahme wird Text</h3>
            <div className="gs-fields-row is-service"><label className="gs-field">Dienst<select className="gs-select" value={form.transcriptionProvider} onChange={(event) => patch({ transcriptionProvider: event.target.value as typeof form.transcriptionProvider })}><option value="auto">Automatisch</option><option value="payload">Transkript kommt vom Dialer</option><option value="openai" disabled={!openai}>OpenAI Whisper{openai ? "" : " (Schlüssel fehlt)"}</option><option value="deepgram" disabled={!deepgram}>Deepgram{deepgram ? "" : " (Schlüssel fehlt)"}</option></select></label><label className="gs-field">Sprache<Input value={form.transcriptionLanguage} onChange={(event) => patch({ transcriptionLanguage: event.target.value })} /></label></div>
            {textService ? <p className="cq-transcription-state is-ok gs-note is-good" role="status"><Check aria-hidden="true" /><span>{textService}</span></p> : <p className="cq-transcription-state is-missing gs-note is-warn" role="status"><TriangleAlert aria-hidden="true" /><span>Kein Transkriptionsdienst eingerichtet – die KI kann Aufnahmen nicht auswerten. Beim Hosting (Railway → Variables) den Schlüssel OPENAI_API_KEY oder DEEPGRAM_API_KEY eintragen; nach dem Neustart steht hier „Aktiv“.</span></p>}
            <p className="gs-hint">Liefert der Dialer schon ein fertiges Transkript, reicht beim Dienst „Transkript kommt vom Dialer“.</p></div>
        </div>
        <details className="gs-details"><summary><span><b>Felder des Dialers zuordnen</b><small>Nur nötig, wenn der Dialer andere Feldnamen schickt als üblich.</small></span><ChevronDown aria-hidden="true" /></summary><div className="gs-details-body">
          <p>Welches Feld im Webhook des Dialers welche Bedeutung hat (Punkt-Schreibweise für verschachtelte Felder, z. B. call.id). Die Vorgaben passen zu einem Standard-Webhook; nach Erhalt der OnDialer-Dokumentation hier anpassen.</p>
          <h4 className="gs-map-title">Zum Gespräch</h4>
          <div className="gs-map">{mappingKeys.map(([key, label]) => <label key={key} className="gs-field">{label}<Input value={form.fieldMapping[key]} onChange={(event) => patch({ fieldMapping: { ...form.fieldMapping, [key]: event.target.value } })} /></label>)}</div>
          <h4 className="gs-map-title">Zum Kontakt <span>wenn der Dialer den ganzen Kontakt mitschickt</span></h4>
          <div className="gs-map is-contact">{CONTACT_MAPPING_LABELS.map(([key, label]) => <label key={key} className="gs-field">{label}<Input value={(form.fieldMapping as Record<string, string>)[key] ?? CONTACT_MAPPING[key]} onChange={(event) => patch({ fieldMapping: { ...form.fieldMapping, [key]: event.target.value } })} /></label>)}</div>
          <p>Kennt die Software die Rufnummer noch nicht, legt sie den Kontakt selbst an (Liste „Kontakte vom Dialer“ unter „Rohdaten“). Ein grünes Gespräch macht ihn zum Lead, ein rotes verwirft ihn. Deutsche Feldnamen wie <code>vorname</code>, <code>plz</code> oder <code>ort</code> werden auch ohne Zuordnung erkannt.</p>
          <p>Beispiel, wie der Webhook aussehen sollte (mit Kontakt: Knopf „Anleitung für den Dialer-Entwickler kopieren“). Wichtig sind der volle Name des Agenten und die Leadsparte (PV, WP oder PV+WP) – dann steht bei jedem Lead, wer ihn gemacht hat und wozu er gehört:</p><pre>{sample}</pre>
          <p>Für den Entwickler des Dialers: Ein Aufruf der Adresse im Browser (GET) zeigt, ob alles stimmt. Ein Testgespräch mit <code>"test": true</code> prüft Felder und Aufnahme-Link, ohne etwas zu speichern.</p>
        </div></details>
      </section>}

      {tab === "vorlagen" && <section className="surface-panel operations-panel gs-card cq-presets" aria-labelledby="gs-h">
        <header className="gs-head"><div><h2 id="gs-h">Mit einer Vorlage starten</h2><p>Eine Vorlage setzt Kriterien, die Anweisung an die KI und die Prüffragen in einem Schritt. Danach kannst du alles noch anpassen.</p></div></header>
        <ul className="gs-presets">{CALL_QA_PRESETS.map((preset) => { const parts = preset.description.split(" · "); const cut = parts.length > 1 ? parts[0].indexOf(". ") : -1; const lead = cut >= 0 ? parts[0].slice(0, cut + 1) : parts[0]; const points = (cut >= 0 ? [parts[0].slice(cut + 2), ...parts.slice(1)] : parts.slice(1)).map((point) => point.replace(/\.$/, "")); const inUse = data.presetKey === preset.key; return <li key={preset.key} className={`gs-preset ${inUse ? "is-used" : ""}`}><span className="gs-preset-icon"><LayoutTemplate aria-hidden="true" /></span>
          <div className="gs-preset-text"><b>{preset.label}{inUse && <span className="gs-used" title="Kriterien und KI-Anweisung stammen unverändert aus dieser Vorlage – Verbesserungen an ihr kommen von selbst an.">im Einsatz</span>}</b><p>{lead}</p>{points.length > 0 && <ul>{points.map((point) => <li key={point}><Check aria-hidden="true" />{point}</li>)}</ul>}<small>{preset.criteria.length} Kriterien, {preset.questions.length} Prüffragen</small></div>
          <button type="button" className="gs-btn is-strong" disabled={applyPreset.isPending} onClick={async () => { if (!(await confirmAction(`Vorlage „${preset.label}“ übernehmen? Kriterien, KI-Anweisung und Prüffragen werden ersetzt – deine jetzigen Einstellungen in diesen drei Bereichen gehen verloren.${dirty ? " Ungespeicherte Änderungen auf dieser Seite gehen ebenfalls verloren." : ""}`, { confirmLabel: "Übernehmen" }))) return; applyPreset.mutate({ preset: preset.key, allCampaigns: presetAll }); }}>{applyPreset.isPending ? "Übernehme …" : inUse ? "Neu übernehmen" : "Vorlage übernehmen"}</button>
        </li>; })}</ul>
        <Switch checked={presetAll} onChange={setPresetAll} label="Auch für vorhandene Kampagnen-Fragensätze" hint="An: Die Prüffragen aller Kampagnen, die schon eigene Fragen haben, werden mit ersetzt. Aus: Nur der Standard ändert sich." />
      </section>}

      {tab === "bewertung" && <section className="surface-panel operations-panel gs-card" aria-labelledby="gs-h">
        <header className="gs-head"><div><h2 id="gs-h">Kriterien und Ampel</h2><p>Die KI prüft jedes Kriterium und belegt es mit einer Stelle aus dem Gespräch. Das Gewicht bestimmt, wie stark ein Kriterium in die Note eingeht.</p></div></header>
        <div className="gs-block"><div className="gs-sub"><h3>Kriterien</h3><span className="gs-sub-meta">{form.criteria.length} Kriterien, Gewichte zusammen {weightTotal}</span></div>
          {form.criteria.length > 0 && <div className="gs-cols" aria-hidden="true"><span>Bezeichnung</span><span>Kürzel</span><span>Gewicht</span><span /></div>}
          <ul className="gs-crits">{form.criteria.map((criterion, index) => { const share = weightTotal ? Math.round(((Number(criterion.weight) || 0) / weightTotal) * 100) : 0; return <li key={index} className="gs-crit">
            <Input className="gs-crit-label" aria-label="Bezeichnung" value={criterion.label} placeholder="Bezeichnung, z. B. Bedarf & Interesse" onChange={(event) => renameCriterion(index, event.target.value)} />
            <Input className="gs-key" aria-label="Kürzel" value={criterion.key} placeholder="kuerzel" onChange={(event) => setCriterion(index, { key: cleanKey(event.target.value) })} />
            <label className="gs-crit-weight"><span>Gewicht</span><Input type="number" min={0} max={100} value={criterion.weight} onChange={(event) => setCriterion(index, { weight: whole(event.target.value, 100) })} /></label>
            <button type="button" className="gs-x" aria-label={`Kriterium „${criterion.label || "ohne Namen"}“ entfernen`} title="Entfernen" onClick={() => patch({ criteria: form.criteria.filter((_, i) => i !== index) })}><X aria-hidden="true" /></button>
            <textarea className="gs-textarea gs-crit-text" aria-label="Was erfüllt sein muss" rows={2} value={criterion.description} placeholder="Was erfüllt sein muss" onChange={(event) => setCriterion(index, { description: event.target.value })} />
            <span className="gs-crit-share"><i aria-hidden="true"><i style={{ width: `${share}%` }} /></i><small>{share} % der Note</small></span>
          </li>; })}</ul>
          {!form.criteria.length && <p className="gs-empty">Noch kein Kriterium. Ohne Kriterien kann die KI keine Note vergeben.</p>}
          <button type="button" className="gs-add" onClick={() => patch({ criteria: [...form.criteria, { key: `kriterium_${form.criteria.length + 1}`, label: "", weight: 10, description: "" }] })}><Plus aria-hidden="true" />Kriterium hinzufügen</button>
        </div>
        <div className="gs-block"><div className="gs-sub"><h3>Zusätzliche Vorgaben für die KI</h3><span className="gs-sub-meta">optional</span></div>
          <textarea className="gs-textarea" aria-label="Zusätzliche Vorgaben für die Bewertung" rows={3} value={form.instructions} placeholder="z. B. Nur Eigentümer von Einfamilienhäusern gelten als verkaufbar; Mieter immer „nicht verkaufbar“." onChange={(event) => patch({ instructions: event.target.value })} /></div>
        <div className="gs-block"><div className="gs-sub"><h3>Ampel</h3><p>Bis zu welcher Note die KI zurückweist und ab welcher sie freigibt. Alles dazwischen landet bei dir zur Prüfung.</p></div>
          <div className={`gs-scale ${scaleOk ? "" : "is-bad"}`}>
            <div className="gs-scale-bar" role="img" aria-label={`Zurückweisen bis Note ${low}, zur Prüfung dazwischen, freigeben ab Note ${high}`}><i className="is-rot" style={{ flexGrow: low }} /><i className="is-gelb" style={{ flexGrow: Math.max(0, high - low) }} /><i className="is-gruen" style={{ flexGrow: Math.max(0, 100 - Math.max(low, high)) }} /></div>
            <div className="gs-scale-ticks" aria-hidden="true"><span style={{ left: "0%" }}>0</span><span style={{ left: `${low}%` }}>{low}</span>{scaleOk && <span style={{ left: `${high}%` }}>{high}</span>}<span style={{ left: "100%" }}>100</span></div>
            <ul className="gs-scale-legend"><li><Face mood="rot" size={28} /><span><b>Zurückweisen</b><small>bis Note {low}</small></span></li><li><Face mood="gelb" size={28} /><span><b>Zur Prüfung</b><small>dazwischen</small></span></li><li><Face mood="gruen" size={28} /><span><b>Freigeben</b><small>ab Note {high}</small></span></li></ul>
          </div>
          {!scaleOk && <p className="gs-note is-warn" role="alert"><TriangleAlert aria-hidden="true" /><span>„Rot bis“ muss kleiner sein als „Grün ab“ – sonst bleibt für „Zur Prüfung“ kein Platz.</span></p>}
          <div className="gs-fields-row"><label className="gs-field">Rot bis Note<Input type="number" min={0} max={100} value={form.autoRejectThreshold} onChange={(event) => patch({ autoRejectThreshold: whole(event.target.value, 100) })} /><small>Der Lead wird „fehlerhaft“.</small></label><label className="gs-field">Grün ab Note<Input type="number" min={0} max={100} value={form.autoApproveThreshold} onChange={(event) => patch({ autoApproveThreshold: whole(event.target.value, 100) })} /><small>{form.autoDeliver ? "Der Lead wird „genehmigt“ und über die Regeln ausgeliefert." : "Der Lead wird „genehmigt“ und bleibt bei dir liegen."}</small></label></div>
          <p className="gs-note"><Info aria-hidden="true" /><span><b>Zuerst entscheiden die Prüffragen der Kampagne</b> (K.-o. und Pflicht) – einzustellen auf der Seite „Gespräche“ unter „Einstellen“. Die Ampel hier ist die Qualitätsnote der KI und greift nur, wenn eine Kampagne keine solche Frage hat.</span></p>
        </div>
        <div className="gs-block"><div className="gs-sub"><h3>Aufbewahrung</h3></div>
          <div className="gs-after">
            <label className="gs-field gs-keep">Texte aufbewahren (Tage)<Input type="number" min={0} max={3650} value={form.retentionDays} onChange={(event) => patch({ retentionDays: whole(event.target.value, 3650) })} /><small>Danach werden Transkript und Aufzeichnungs-Link gelöscht, die Bewertung bleibt. 0 = nie.</small></label></div></div>
      </section>}

      {tab === "regeln" && <section className="surface-panel operations-panel gs-card" aria-labelledby="gs-h">
        <header className="gs-head"><div><h2 id="gs-h">Eigene Regeln</h2><p>Regeln greifen vor der Ampel. Es geht von oben nach unten: Die erste Regel, die passt, entscheidet.</p></div></header>
        {!form.decisionRules.length && <div className="gs-empty"><p>Noch keine eigenen Regeln – die Ampel und die Prüffragen entscheiden allein. Starte mit einem Beispiel:</p><div className="gs-ideas">{RULE_IDEAS.map((idea) => <button key={idea.label} type="button" className="gs-idea" onClick={() => addRule(idea)}><Plus aria-hidden="true" /><span>{idea.label}</span><em>dann {idea.then}</em></button>)}</div></div>}
        <div className="gs-block"><ol className="gs-rules">{form.decisionRules.map((rule, index) => <li key={rule.id || index} className={`gs-rule ${rule.active ? "" : "is-off"}`}>
          <span className="gs-rule-no" aria-label={`Regel ${index + 1}`}>{index + 1}</span>
          <Input className="gs-rule-name" aria-label="Name der Regel" value={rule.label} placeholder="Name der Regel" onChange={(event) => setRule(index, { label: event.target.value })} />
          <Switch plain checked={rule.active} onChange={(value) => setRule(index, { active: value })} label={rule.active ? "Aktiv" : "Aus"} />
          <button type="button" className="gs-x" aria-label={`Regel ${index + 1} entfernen`} title="Entfernen" onClick={() => patch({ decisionRules: form.decisionRules.filter((_, i) => i !== index) })}><X aria-hidden="true" /></button>
          <div className="gs-rule-line"><span>Wenn</span>
            <select className="gs-select" aria-label="Was geprüft wird" value={rule.field} onChange={(event) => setRule(index, { field: event.target.value as typeof rule.field })}><option value="score">Gesamtpunkte</option><option value="verdict">Urteil</option><option value="redFlags">Warnsignale</option><option value="transcript">Transkript</option><option value="dialerResult">Ergebnis im Dialer</option>{form.criteria.map((criterion) => <option key={criterion.key} value={`criterion:${criterion.key}`}>Kriterium: {criterion.label}</option>)}</select>
            <select className="gs-select" aria-label="Vergleich" value={rule.op} onChange={(event) => setRule(index, { op: event.target.value as typeof rule.op })}><option value="gte">mindestens</option><option value="lte">höchstens</option><option value="eq">ist genau</option><option value="contains">enthält</option><option value="any">ist vorhanden</option></select>
            {rule.op === "any" ? <i className="gs-rule-gap" aria-hidden="true" /> : <Input aria-label="Wert" value={rule.value} placeholder={rule.field === "verdict" ? "verkaufbar / nachfassen / nicht_verkaufbar" : rule.field === "transcript" ? "Wort oder Satz" : rule.field === "dialerResult" ? "z. B. kein Interesse" : "Zahl"} onChange={(event) => setRule(index, { value: event.target.value })} />}
            <span>dann</span>
            <select className="gs-select" aria-label="Entscheidung" value={rule.decision} onChange={(event) => setRule(index, { decision: event.target.value as typeof rule.decision })}><option value="freigegeben">freigeben</option><option value="pruefen">zur Prüfung</option><option value="zurueckgewiesen">zurückweisen</option></select></div>
        </li>)}</ol>
        <button type="button" className="gs-add" onClick={() => addRule()}><Plus aria-hidden="true" />Regel hinzufügen</button></div>
      </section>}

      {tab === "daten" && <section className="surface-panel operations-panel gs-card" aria-labelledby="gs-h">
        <header className="gs-head"><div><h2 id="gs-h">Daten aus dem Gespräch auslesen</h2><p>Die KI beantwortet diese Fragen aus dem Gespräch und schreibt die Antworten als Zusatzfelder in den Lead. So wird der Lead für den Käufer wertvoller.</p></div></header>
        {!form.extractFields.length && <div className="gs-empty"><p>Noch keine Fragen. Starte mit einem Beispiel:</p><div className="gs-ideas">{FIELD_IDEAS.map((idea) => <button key={idea.key} type="button" className="gs-idea" onClick={() => patch({ extractFields: [...form.extractFields, { ...idea }] })}><Plus aria-hidden="true" /><span>{idea.label}</span><em>{idea.question}</em></button>)}</div></div>}
        <div className="gs-block">{form.extractFields.length > 0 && <div className="gs-cols is-fields" aria-hidden="true"><span>Bezeichnung</span><span>Frage an das Gespräch</span><span>Feldname im Lead</span><span /></div>}
        <ul className="gs-fieldrows">{form.extractFields.map((item, index) => <li key={index} className="gs-fieldrow">
          <Input aria-label="Bezeichnung" value={item.label} placeholder="Bezeichnung, z. B. Dachfläche" onChange={(event) => renameExtract(index, event.target.value)} />
          <Input aria-label="Frage an das Gespräch" value={item.question} placeholder="Frage, z. B. Wie groß ist die Dachfläche?" onChange={(event) => setExtract(index, { question: event.target.value })} />
          <Input className="gs-key" aria-label="Feldname im Lead" value={item.key} placeholder="feldname" onChange={(event) => setExtract(index, { key: cleanKey(event.target.value) })} />
          <button type="button" className="gs-x" aria-label={`Frage „${item.label || "ohne Namen"}“ entfernen`} title="Entfernen" onClick={() => patch({ extractFields: form.extractFields.filter((_, i) => i !== index) })}><X aria-hidden="true" /></button>
        </li>)}</ul>
        <button type="button" className="gs-add" onClick={() => patch({ extractFields: [...form.extractFields, { key: "", label: "", question: "" }] })}><Plus aria-hidden="true" />Frage hinzufügen</button></div>
      </section>}

      {tab === "beispiele" && <section className="surface-panel operations-panel gs-card" aria-labelledby="gs-h">
        <header className="gs-head"><div><h2 id="gs-h">Beispiele für die KI</h2><p>Zeig der KI an echten Gesprächsausschnitten, wie ihr entscheiden würdet. Die Beispiele gehen bei jeder Bewertung mit und verbessern die Trefferquote.</p></div></header>
        {!form.examples.length && <p className="gs-empty">Noch keine Beispiele. Ein gutes Beispiel ist ein kurzer Ausschnitt, bei dem die Entscheidung nicht auf der Hand liegt – etwa ein Mieter, der Interesse zeigt.</p>}
        <div className="gs-block"><ul className="gs-examples">{form.examples.map((example, index) => <li key={index} className="gs-example">
          <div className="gs-example-top"><Input aria-label="Titel" value={example.title} placeholder="Titel, z. B. Mieter ohne Eigentum" onChange={(event) => setExample(index, { title: event.target.value })} />
            <div className="gs-seg" role="group" aria-label="So würdet ihr entscheiden">{VERDICT_CHOICES.map(([key, mood, label]) => <button key={key} type="button" className={`gs-seg-item is-${mood} ${example.verdict === key ? "is-on" : ""}`} aria-pressed={example.verdict === key} onClick={() => setExample(index, { verdict: key })}><i aria-hidden="true" />{label}</button>)}</div>
            <button type="button" className="gs-x" aria-label={`Beispiel „${example.title || "ohne Titel"}“ entfernen`} title="Entfernen" onClick={() => patch({ examples: form.examples.filter((_, i) => i !== index) })}><X aria-hidden="true" /></button></div>
          <textarea className="gs-textarea" aria-label="Gesprächsausschnitt" rows={3} placeholder="Gesprächsausschnitt" value={example.transcript} onChange={(event) => setExample(index, { transcript: event.target.value })} />
          <Input aria-label="Begründung" value={example.reason} placeholder="Begründung, z. B. Mieter dürfen keine PV-Anlage beauftragen" onChange={(event) => setExample(index, { reason: event.target.value })} />
        </li>)}</ul>
        <button type="button" className="gs-add" onClick={() => patch({ examples: [...form.examples, { title: "", transcript: "", verdict: "nachfassen", reason: "" }] })}><Plus aria-hidden="true" />Beispiel hinzufügen</button></div>
      </section>}

      {tab === "testen" && <section className="surface-panel operations-panel gs-card" aria-labelledby="gs-h">
        <header className="gs-head"><div><h2 id="gs-h">Bewertung ausprobieren</h2><p>Füge den Text eines Gesprächs ein – zum Beispiel aus einem Testanruf – und sieh, wie die KI bewertet und entscheidet. Mit einer Lead-ID wirkt die Entscheidung auf diesen Lead.</p></div></header>
        {dirty && <p className="gs-note is-warn"><TriangleAlert aria-hidden="true" /><span>Getestet wird mit den gespeicherten Einstellungen. Deine Änderungen zählen erst nach dem Speichern.</span></p>}
        <textarea className="gs-textarea is-tall" aria-label="Gesprächstext" value={transcript} placeholder={"Agent: Guten Tag, hier ist … vom Energieservice. Sie hatten sich für eine Photovoltaikanlage interessiert?\nKunde: Ja, wir überlegen, nächstes Frühjahr …"} onChange={(event) => setTranscript(event.target.value)} />
        <div className="gs-test-row"><Input value={testLead} placeholder="Lead-ID (optional)" aria-label="Lead-ID (optional)" onChange={(event) => setTestLead(event.target.value)} /><Button className="flux-button" size="sm" onClick={() => simulate.mutate({ transcript, publicId: testLead.trim() || null, agentName: "Test" })} disabled={simulate.isPending || transcript.trim().length < 20}>{simulate.isPending ? "Bewertet …" : "Bewerten"}</Button><small>{transcript.trim().length < 20 ? "Mindestens 20 Zeichen einfügen." : "Das Ergebnis erscheint hier und als Gespräch in der Liste."}</small></div>
        {tested && (testedMood ? <div className={`gs-result is-${testedMood}`} role="status"><Face mood={testedMood} size={40} /><div><b>{MOOD[testedMood].label}{typeof tested.score === "number" ? `, Note ${tested.score} %` : ""}</b><span>Urteil der KI: {verdictLabel[tested.verdict ?? "unklar"]}. Entscheidung: {decisionLabel[tested.decision]}.</span></div><button type="button" className="gs-btn" onClick={() => onOpenCall(tested.callId)}>Gespräch öffnen<ChevronRight aria-hidden="true" /></button></div> : <p className="gs-note is-warn" role="status"><TriangleAlert aria-hidden="true" /><span>{tested.error ?? "Die Bewertung ist fehlgeschlagen."}</span></p>)}
      </section>}

      <div className={`gs-savebar ${dirty ? "is-dirty" : ""}`}>
        <span className="gs-save-state" role="status">{dirty ? <>Ungespeicherte Änderungen in <b>{dirtyTabs.map((key) => SETTINGS_TABS.find(([name]) => name === key)?.[2]).join(", ")}</b></> : "Alles gespeichert."}</span>
        {dirty && <button type="button" className="gs-btn" onClick={() => setForm(initial())}>Verwerfen</button>}
        <Button className="flux-button" size="sm" onClick={submit} disabled={!dirty || save.isPending}>{save.isPending ? "Speichert …" : "Änderungen speichern"}</Button>
      </div>
    </div>
  </div>;
}
