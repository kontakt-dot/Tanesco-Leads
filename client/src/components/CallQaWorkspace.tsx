import { Badge } from "@/components/ui/badge";
import { SCOPE_LABEL } from "../../../shared/call-qualification";
import OptInPanel, { OptInBadge } from "@/components/OptInPanel";
import type { OptInKind, OptInStatus } from "../../../shared/opt-in";
import { dialerGuideText } from "../../../shared/dialer-guide";
import { CALL_QA_PRESETS } from "../../../shared/call-qa-presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { useEffect, useState, useRef } from "react";
import { AudioLines, CalendarCheck, ChevronDown, ChevronLeft, ChevronRight, FileCheck2, PhoneCall, RefreshCw, Repeat, Settings2, Timer, Trophy, Upload, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { confirmAction } from "@/lib/confirm";
import { Face, FACE_COLOR, MOOD, MoodFace, moodOf } from "@/components/CallMood";
import CallWave, { CallPeriodControl, CallTally, overviewSummary, dayKey, dayLabel, timeText, DECISION_LABEL, type CallRange, type DecisionFilter } from "@/components/CallScoreboard";
import { AvatarContent, useAvatarOf } from "@/components/AvatarUpload";
import { barHeight, clockText } from "../../../shared/call-overview";
import { initialsOf } from "../../../shared/avatar";

type Settings = inferRouterOutputs<AppRouter>["leadops"]["getCallQaSettings"];
type CallRow = inferRouterOutputs<AppRouter>["leadops"]["listCalls"][number];
const field = "h-10 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100";
const Toggle = ({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string }) => <label className="flex items-start gap-3 rounded-lg border border-white/8 bg-white/[.02] p-3 text-sm text-slate-200"><input type="checkbox" className="mt-1" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><span className="block">{label}</span>{hint && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}</span></label>;
const verdictLabel: Record<string, string> = { verkaufbar: "Verkaufbar", nachfassen: "Nachfassen", nicht_verkaufbar: "Nicht verkaufbar", unklar: "Unklar" };
const decisionLabel: Record<string, string> = { offen: "Offen", freigegeben: "Freigegeben", pruefen: "Zur Prüfung", zurueckgewiesen: "Zurückgewiesen" };
const statusLabel: Record<string, string> = { eingegangen: "Eingegangen", transkribiert: "Transkribiert", bewertet: "Bewertet", fehlgeschlagen: "Fehlgeschlagen", ohne_einwilligung: "Ohne Einwilligung" };
const decisionClass = (decision: string) => decision === "freigegeben" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : decision === "zurueckgewiesen" ? "border-red-400/25 bg-red-500/10 text-red-200" : decision === "pruefen" ? "border-amber-400/25 bg-amber-500/10 text-amber-200" : "border-white/15 text-slate-300";
/** Agent im Gespräch: Name aus dem Transkript – von Hand korrigierbar (bleibt dann fest, auch bei neuer Bewertung). */
function AgentEdit({ callId, agentName, manual, onChanged, bare = false }: { callId: number; agentName: string | null; manual: boolean; onChanged: () => void; /** nur der Name – die Beschriftung „Agent“ steht schon daneben */ bare?: boolean }) {
  const [editing, setEditing] = useState(false); const [value, setValue] = useState(agentName ?? "");
  const agents = trpc.leadops.dialerAgentReport.useQuery({ period: "alle" }, { retry: false, staleTime: 60_000, enabled: editing });
  const save = trpc.leadops.setCallAgent.useMutation({ onSuccess: (result) => { toast.success(result.agentName ? `Agent auf „${result.agentName}“ gesetzt.` : "Agent wird wieder automatisch aus dem Transkript erkannt."); setEditing(false); onChanged(); }, onError: (error) => toast.error(error.message) });
  if (!editing) return <span className="cq-agent">{bare ? "" : "Agent "}{agentName ?? (bare ? "nicht erkannt" : "–")}{manual ? " (von Hand)" : ""} <button type="button" className="cq-agent-edit underline" title="Agent korrigieren – bleibt dann fest, auch wenn das Gespräch neu bewertet wird" onClick={() => { setValue(agentName ?? ""); setEditing(true); }}>ändern</button></span>;
  return <span className="cq-agent inline-flex flex-wrap items-center gap-1 align-middle"><Input className="h-7 w-44 text-xs" aria-label="Agent" list={`cq-agents-${callId}`} autoFocus value={value} placeholder="Name des Agenten" onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") save.mutate({ callId, agentName: value.trim() || null }); if (event.key === "Escape") setEditing(false); }} /><datalist id={`cq-agents-${callId}`}>{(agents.data?.agents ?? []).filter((item) => item.name).map((item) => <option key={item.name} value={item.name} />)}</datalist><Button size="sm" className="h-7" disabled={save.isPending} onClick={() => save.mutate({ callId, agentName: value.trim() || null })}>{save.isPending ? "…" : "Speichern"}</Button><Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(false)}>Abbrechen</Button></span>;
}
/** Längere Belege: zwei Zeilen zeigen, Rest per Klick aufklappen – der Text selbst ist immer vollständig. */
function Expandable({ text, quote = false, className = "" }: { text: string; quote?: boolean; className?: string }) {
  const [open, setOpen] = useState(false); const long = text.length > 150;
  return <span className={`cq-expand ${className} ${long && !open ? "is-clamped" : ""}`}><span className="cq-expand-text">{quote ? `„${text}“` : text}</span>{long && <button type="button" className="cq-expand-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "weniger anzeigen" : "alles anzeigen"}</button>}</span>;
}
const duration = (seconds: number | null) => seconds === null ? "–" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} min`;

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
  const categoryName = categoryId ? (categoryOptions.data ?? []).find((item) => item.id === categoryId)?.name ?? null : null;
  const scope = [agent || null, campaign ? `Kampagne „${campaign}“` : null, categoryName ? `Kategorie „${categoryName}“` : null].filter(Boolean).join(", ");
  return <>
    <header className="page-intro compact"><div><span className="eyebrow">CALLCENTER</span><h1>Gespräche</h1><p>Jedes Telefonat aus dem Dialer wird mitgeschnitten, in Text umgewandelt und von der KI bewertet. Was passt, geht von selbst in die Auslieferung.</p></div><div className="people-header-actions"><Button variant={view === "liste" ? "default" : "outline"} className={view === "liste" ? "flux-button" : ""} onClick={() => go("liste", null)}>Gespräche</Button><Button variant={view === "agenten" ? "default" : "outline"} className={view === "agenten" ? "flux-button" : ""} onClick={() => go("agenten", null)}><Users className="h-4 w-4" /> Agenten</Button><Button variant={view === "einstellungen" ? "default" : "outline"} className={view === "einstellungen" ? "flux-button" : ""} onClick={() => go("einstellungen", null)}>Dialer & Bewertung</Button></div></header>
    {view === "einstellungen" ? <CallQaSettings /> : view === "agenten" ? <AgentReport onShowCalls={(name) => { setAgent(name); go("liste", null); }} /> : selected ? <CallDetail callId={selected} onBack={() => setSelected(null)} /> : <CallList onOpen={(id) => go("liste", id)} agent={agent} onAgent={setAgent} campaign={campaign} onCampaign={setCampaign} range={range} onRange={setRange} categoryId={categoryId} onCategory={setCategoryId} decision={decision} onDecision={setDecision} overview={stats.data ?? null} overviewLoading={stats.isFetching} scope={scope} />}
  </>;
}

type Overview = inferRouterOutputs<AppRouter>["leadops"]["callStatistics"];
const WAVE_KEY = "tanesco-gespraeche-verlauf";
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
/** Farbton eines Agenten – immer derselbe je Name, damit man ihn in der Liste wiedererkennt (bewusst keine Ampelfarben). */
const toneOf = (name: string) => { let hash = 0; for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) >>> 0; return hash % 6; };
const AgentFace = ({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) => <span className={`gq-who is-tone-${toneOf(name)}`} aria-hidden="true"><AvatarContent avatarUrl={avatarUrl} initials={initialsOf(name)} /></span>;
/** Schmaler Balken: Anteile freigegeben / zur Prüfung / zurückgewiesen / offen. */
const Split = ({ approved, review, rejected, open }: { approved: number; review: number; rejected: number; open: number }) => <span className="gq-split" aria-hidden="true">{approved > 0 && <i className="is-approved" style={{ flexGrow: approved }} />}{review > 0 && <i className="is-review" style={{ flexGrow: review }} />}{rejected > 0 && <i className="is-rejected" style={{ flexGrow: rejected }} />}{open > 0 && <i className="is-open" style={{ flexGrow: open }} />}</span>;
/** Hinweis unter dem Ergebnis, solange ein Gespräch noch nicht fertig bewertet ist. */
const statusNote = (status: string): { cls: string; text: string } | null => status === "eingegangen" ? { cls: "is-working", text: "Eingegangen – Text folgt" } : status === "transkribiert" ? { cls: "is-working", text: "Text liegt vor – Bewertung folgt" } : status === "fehlgeschlagen" ? { cls: "is-warn", text: "Fehlgeschlagen" } : status === "ohne_einwilligung" ? { cls: "is-warn", text: "Ohne Einwilligung" } : null;
function CallList({ onOpen, agent, onAgent, campaign, onCampaign, range, onRange, categoryId, onCategory, decision, onDecision, overview, overviewLoading, scope }: { onOpen: (id: number) => void; agent: string; onAgent: (name: string) => void; campaign: string; onCampaign: (name: string) => void; range: CallRange; onRange: (range: CallRange) => void; categoryId: number | null; onCategory: (id: number | null) => void; decision: DecisionFilter; onDecision: (decision: DecisionFilter) => void; overview: Overview | null; overviewLoading: boolean; scope: string }) {
  const categoryOptions = trpc.leadops.callCategoryOptions.useQuery(undefined, { retry: false, staleTime: 30_000 });
  const utils = trpc.useUtils();
  const [linkText, setLinkText] = useState(""); const [linkAgent, setLinkAgent] = useState(""); const [linkCampaign, setLinkCampaign] = useState("");
  const fileInput = useRef<HTMLInputElement>(null); const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
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
  const calls = trpc.leadops.listCalls.useQuery({ decision: decision || null, campaign: campaign || null, agentName: agent || null, period: range.from || range.to ? null : range.period, from: range.from || null, to: range.to || null, categoryId }, { retry: false, placeholderData: (previous) => previous, refetchInterval: (query) => ((query.state.data as Array<{ status: string }> | undefined)?.some((row) => row.status === "eingegangen" || row.status === "transkribiert") ? 5_000 : 30_000) });
  const agentNames = trpc.leadops.dialerAgentReport.useQuery({ period: "alle" }, { retry: false, staleTime: 60_000 });
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
  const avatarOf = useAvatarOf(); const userIdOf = new Map((agentNames.data?.agents ?? []).filter((item) => item.userId && item.name).map((item) => [item.name, item.userId] as const));
  const pictureOf = (name: string | null | undefined) => (name ? avatarOf(userIdOf.get(name) ?? null) : null);
  const agentChips = overview?.byAgent ?? []; const extraAgent = agent && !agentChips.some((item) => item.name === agent) ? agent : null;
  const allSelected = Boolean(rows.length) && selected.size === rows.length;
  const longest = rows.reduce((max, row) => Math.max(max, row.durationSeconds ?? 0), 0); // für den kleinen Dauer-Balken unter der Uhrzeit
  // Der Verlauf (große Zahl + Tonspur) ist dezent: erst ein Klick auf „Verlauf“ klappt ihn auf – die Wahl bleibt in diesem Browser gemerkt
  const [showWave, setShowWave] = useState<boolean>(() => { try { return window.localStorage.getItem(WAVE_KEY) === "1"; } catch { return false; } });
  const toggleWave = () => setShowWave((open) => { try { window.localStorage.setItem(WAVE_KEY, open ? "0" : "1"); } catch { /* ohne Speicher: gilt nur für diese Sitzung */ } return !open; });
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
          <div className="gq-sum"><span>{overviewSummary(overview)}</span><button type="button" className={`gq-wave-toggle ${showWave ? "is-open" : ""}`} aria-expanded={showWave} title={showWave ? "Verlauf einklappen" : "Verlauf zeigen: jedes Gespräch als Strich – wann telefoniert wurde und wie es ausging"} onClick={toggleWave}><AudioLines aria-hidden="true" /><span>Verlauf</span><ChevronDown className="gq-wave-chevron" aria-hidden="true" /></button></div>
        </div>
        {showWave && <CallWave overview={overview} loading={overviewLoading} range={range} decision={decision} onOpen={onOpen} scope={scope} />}
        <div className="cq-campaign-row">
          <span className="gq-label">Kampagne</span>
          <div className="dashboard-segments"><button type="button" className={campaign ? "" : "active"} onClick={() => onCampaign("")}>Alle</button>{(campaigns.data ?? []).map((item) => <button key={item.name} type="button" className={campaign === item.name ? "active" : ""} onClick={() => onCampaign(item.name)}>{item.name}</button>)}</div>
          <div className="gq-tools"><button type="button" className="cq-tool" title={`Kampagne einstellen: Kriterien, Prüffragen, Auswertung${campaign ? ` für „${campaign}“` : ""}`} onClick={() => setShowSettings(true)}><Settings2 aria-hidden="true" /><span>Einstellen</span></button><button type="button" className="cq-tool" title="Aufnahmen testen – Datei hochladen oder Links einfügen" onClick={() => setShowImport(true)}><Upload aria-hidden="true" /><span>Aufnahmen testen</span></button></div>
        </div>
        <div className="gq-agent-row">
          <div className="gq-agents" role="group" aria-label="Nach Agent filtern">
            <span className="gq-label">Agent</span>
            <button type="button" className={`gq-agent-chip is-all ${agent ? "" : "is-on"}`} aria-pressed={!agent} onClick={() => onAgent("")}><b>Alle</b></button>
            {agentChips.map((item) => <button key={item.name} type="button" className={`gq-agent-chip ${agent === item.name ? "is-on" : ""}`} aria-pressed={agent === item.name} title={`${item.name}: ${item.total} ${item.total === 1 ? "Gespräch" : "Gespräche"} – ${item.approved} freigegeben, ${item.review} zur Prüfung, ${item.rejected} zurückgewiesen${item.open ? `, ${item.open} offen` : ""}`} onClick={() => onAgent(agent === item.name ? "" : item.name)}>
              <AgentFace name={item.name} avatarUrl={pictureOf(item.name)} />
              <span className="gq-agent-text"><b>{item.name}</b><Split approved={item.approved} review={item.review} rejected={item.rejected} open={item.open} /></span>
              <em>{item.total}</em>
            </button>)}
            {extraAgent && <button type="button" className="gq-agent-chip is-on" aria-pressed="true" title="Im gewählten Zeitraum hat dieser Agent keine Gespräche – Klick hebt den Filter auf" onClick={() => onAgent("")}><AgentFace name={extraAgent} avatarUrl={pictureOf(extraAgent)} /><span className="gq-agent-text"><b>{extraAgent}</b></span><em>0</em></button>}
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
              <td className="gq-time"><b>{started ? timeText(started) : "–"}</b>{typeof call.durationSeconds === "number" && call.durationSeconds > 0 ? <><small>{clockText(call.durationSeconds)} Min</small><i className="gq-dur" aria-hidden="true" style={{ width: `${Math.round(barHeight(call.durationSeconds, longest) * 100)}%` }} /></> : null}</td>
              <td className="gq-talkcell">
                <span className="gq-who-line"><b>{contact ?? call.phone ?? "Unbekannt"}</b>{call.leadPublicId ? <span className="gq-lead-id" title="Diesem Lead zugeordnet">{call.leadPublicId}</span> : call.rawContactName ? <span className="gq-raw" title="Kontakt aus den Rohdaten – wird bei Freigabe zum Lead">Rohdaten</span> : null}{contact && call.phone ? <span className="gq-phone">{call.phone}</span> : null}{call.category && <span className="gq-chip is-cat cq-category" title="Lead-Kategorie – von der KI aus dem Gespräch erkannt">{call.category.emoji ? `${call.category.emoji} ` : ""}{call.category.name}</span>}</span>
                {gist && <span className={`gq-summary ${gist.cls}`} title={gist.text}>{gist.text}</span>}
              </td>
              <td className="gq-agent"><span className="gq-agent-cell">{call.agentName ? <AgentFace name={call.agentName} avatarUrl={pictureOf(call.agentName)} /> : <span className="gq-who is-none" aria-hidden="true">–</span>}<span className="gq-agent-lines"><b className={call.agentName ? "" : "gq-none"}>{call.agentName ?? "Ohne Agent"}</b><small title={`Kampagne: ${call.campaign ?? call.provider}`}>{call.campaign ?? call.provider}</small></span></span></td>
              <td className="gq-result"><span className={`gq-pill is-${call.decision}`}>{decisionLabel[call.decision]}{call.decidedBy === "manuell" ? <i title="Von Hand entschieden"> · von Hand</i> : null}</span>{optIn && <span className="gq-optin"><OptInBadge status={optIn.status} kind={optIn.kind} buyerName={optIn.buyerName} missing={optIn.missing} compact /></span>}</td>
              <td className="gq-col-go" aria-hidden="true"><ChevronRight /></td>
            </tr>; })}
        </tbody>)}
      </table></div>}
      {!rows.length && <p className="gq-empty">{calls.isLoading ? "Gespräche werden geladen …" : <>Noch keine Gespräche{decision ? ` mit dem Ergebnis „${DECISION_LABEL[decision]}“` : ""}{campaign ? ` in der Kampagne „${campaign}“` : ""}{agent ? ` von ${agent}` : ""}{range.from || range.to || range.period !== "alle" ? " im gewählten Zeitraum" : ""}{categoryId ? " in dieser Lead-Kategorie" : ""}. Sobald der Dialer Gespräche meldet, erscheinen sie hier – oder teste die Bewertung mit „Aufnahmen testen“.</>}</p>}
    </section>
    <Dialog open={showSettings} onOpenChange={closeSettings}><DialogContent className="cq-dialog" onInteractOutside={(event) => event.preventDefault()}><DialogHeader><DialogTitle>Kampagne einstellen</DialogTitle><DialogDescription>{campaign ? `„${campaign}“` : "Standard"} – Kriterien, Prüffragen und Auswertung. Einmal einstellen, danach läuft die Bewertung automatisch.</DialogDescription></DialogHeader>{showSettings && <CampaignPanel campaigns={campaigns.data ?? []} campaign={campaign} onSelect={onCampaign} onChanged={() => campaigns.refetch()} onDirty={(dirty) => { settingsDirty.current = dirty; }} />}</DialogContent></Dialog>
    <Dialog open={showImport} onOpenChange={setShowImport}><DialogContent className="cq-dialog" onInteractOutside={(event) => event.preventDefault()}><DialogHeader><DialogTitle>Aufnahmen testen – Datei oder Link</DialogTitle><DialogDescription>Die Software holt die Aufnahme, wandelt sie in Text um und bewertet sie wie ein echtes Gespräch.</DialogDescription></DialogHeader><div className="cq-links"><p className="mt-1 text-xs text-slate-400">Zwei Wege, dasselbe Ergebnis: Die Software holt die Aufnahme, wandelt sie in Text um und bewertet sie wie ein echtes Gespräch. <b>Am sichersten:</b> im Dialer auf den Link klicken, die Datei herunterladen und hier hochladen. Oder den Link einfügen – eine je Zeile, optional dahinter <code>| Rufnummer</code> (ordnet den Kontakt zu) und <code>| Notiz</code>.</p>
      <div className="cq-upload mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-white/15 p-3" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void uploadFiles(event.dataTransfer.files); }}><input ref={fileInput} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm" multiple className="hidden" onChange={(event) => void uploadFiles(event.target.files)} /><Button className="flux-button" size="sm" disabled={Boolean(uploading)} onClick={() => fileInput.current?.click()}>{uploading ? `Lade hoch … ${uploading.done}/${uploading.total}` : "Aufnahme-Datei hochladen"}</Button><span className="text-xs text-slate-400">mp3, wav, m4a oder ogg · bis 24 MB je Datei · mehrere auf einmal möglich · oder hier hineinziehen</span></div><textarea className="mt-2 min-h-[110px] w-full rounded-md border border-white/10 bg-slate-950 p-3 text-xs text-slate-100 font-mono" value={linkText} placeholder={"https://…/getSound.aspx?token=…\nhttps://…/aufnahme-2.mp3 | +49 170 1234567 | Termin vereinbart"} onChange={(event) => setLinkText(event.target.value)} spellCheck={false} /><div className="mt-2 flex flex-wrap items-center gap-2"><Input value={linkAgent} placeholder="Agent (optional)" className="max-w-[170px]" onChange={(event) => setLinkAgent(event.target.value)} /><Input value={linkCampaign} placeholder="Kampagne (optional, Standard: Aufnahmen-Test)" className="max-w-[300px]" onChange={(event) => setLinkCampaign(event.target.value)} /><Button className="flux-button" size="sm" onClick={() => importLinks.mutate({ text: linkText, agentName: linkAgent.trim() || null, campaign: linkCampaign.trim() || null })} disabled={importLinks.isPending || !/https?:\/\//.test(linkText)}>{importLinks.isPending ? "Lege an …" : "Aufnahmen holen und bewerten"}</Button><span className="text-[11px] text-slate-500">Dauert je Aufnahme etwa eine halbe Minute. Anhören geht danach direkt im Gespräch (Player).</span></div></div></DialogContent></Dialog></>;
}

type AgentReportData = inferRouterOutputs<AppRouter>["leadops"]["dialerAgentReport"];
type AgentRow = AgentReportData["agents"][number];
const talkTime = (seconds: number) => seconds >= 3600 ? `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min` : `${Math.round(seconds / 60)} min`;
const PERIODS: Array<[AgentReportData["period"], string]> = [["heute", "Heute"], ["7", "7 Tage"], ["30", "30 Tage"], ["alle", "Gesamt"]];
/** Wer macht was: je Agent Anrufe, Erreicht-Quote, Gesprächszeit, Ergebnisse und KI-Bewertung – mit Bestenliste und Sprung in die Gespräche des Agenten. */
function AgentReport({ onShowCalls }: { onShowCalls: (agentName: string) => void }) {
  const [period, setPeriod] = useState<AgentReportData["period"]>("30");
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const report = trpc.leadops.dialerAgentReport.useQuery({ period, campaignId }, { retry: false, refetchInterval: 30_000 });
  const agents = report.data?.agents ?? []; const totals = report.data?.totals; const avatarOf = useAvatarOf();
  const best = (pick: (agent: AgentRow) => number | null, min = 1) => { const ranked = agents.filter((agent) => (pick(agent) ?? -1) >= min).sort((a, b) => (pick(b) ?? -1) - (pick(a) ?? -1)); return ranked[0] ?? null; };
  const real = agents.filter((agent) => !/^ohne agent$/i.test(agent.name)); const bestGreen = real.filter((agent) => agent.approved > 0).sort((a, b) => b.approved - a.approved || (b.approved / Math.max(1, b.evaluated)) - (a.approved / Math.max(1, a.evaluated)))[0] ?? null; const bestReach = best((agent) => agent.reachRate); const bestAppointments = best((agent) => agent.appointments); const mostCalls = best((agent) => agent.calls); const bestTalk = best((agent) => agent.talkSeconds);
  const stats: Array<[string, string, string]> = totals ? [["Agenten", String(totals.agents), "mit Anrufen im Zeitraum"], ["Anrufe", String(totals.calls), `${totals.reached} erreicht${totals.reachRate !== null ? `, das sind ${totals.reachRate} %` : ""}`], ["Am Telefon", talkTime(totals.talkSeconds), "alle zusammen"], ["Termine", String(totals.appointments), `${totals.interested} interessiert${totals.successRate !== null ? `, ${totals.successRate} % der Erreichten` : ""}`], ["Freigegeben", String(totals.approved), `${totals.review} zur Prüfung, ${totals.rejected} zurückgewiesen – ${totals.evaluated} bewertet`]] : [];
  const winners = [bestGreen && [Trophy, "Meiste grüne Gespräche", bestGreen.name, `${bestGreen.approved} von ${bestGreen.evaluated}`], bestAppointments && [CalendarCheck, "Meiste Termine", bestAppointments.name, `${bestAppointments.appointments}`], bestReach && [PhoneCall, "Beste Erreichbarkeit", bestReach.name, `${bestReach.reachRate} %`], mostCalls && !/^ohne agent$/i.test(mostCalls.name) && [Repeat, "Meiste Anrufe", mostCalls.name, `${mostCalls.calls}`], bestTalk && [Timer, "Am längsten am Telefon", bestTalk.name, talkTime(bestTalk.talkSeconds)]].filter((item): item is [typeof Trophy, string, string, string] => Boolean(item));
  const lastCall = (value: Date | string | null) => value ? new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;
  return <section className="surface-panel operations-panel cq-list-panel gq-agents-panel">
    <div className="gq-toolbar">
      <div className="gq-period-row"><span className="gq-label">Zeitraum</span><div className="gq-periods" role="group" aria-label="Zeitraum">{PERIODS.map(([key, label]) => <button key={key} type="button" className={period === key ? "active" : ""} aria-pressed={period === key} onClick={() => setPeriod(key)}>{label}</button>)}</div>
        <label className="gq-category"><span className="gq-label">Kampagne</span><select className="filter-select h-8" aria-label="Kampagne" value={campaignId ?? ""} onChange={(event) => setCampaignId(event.target.value ? Number(event.target.value) : null)}><option value="">Alle Kampagnen</option>{(report.data?.campaigns ?? []).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label></div>
    </div>
    {totals && <dl className="gq-stats">{stats.map(([label, value, hint]) => <div key={label}><dt>{label}</dt><dd>{value}</dd><small>{hint}</small></div>)}</dl>}
    {agents.length > 1 && winners.length > 0 && <ul className="gq-best" aria-label="Bestwerte im Zeitraum">{winners.map(([Icon, label, name, value]) => <li key={label}><Icon aria-hidden="true" /><span>{label}</span><b>{name}</b><em>{value}</em></li>)}</ul>}
    {report.isLoading ? <p className="gq-empty">Auswertung wird geladen …</p> : !agents.length ? <p className="gq-empty">Im gewählten Zeitraum gibt es noch keine Anrufe. Sobald Agenten über den Dialer telefonieren, steht hier, wer was gemacht hat.</p> : <div className="gq-table-wrap gq-agent-wrap">
      <div className="gq-arow is-head" aria-hidden="true"><span>Platz</span><span>Agent</span><span>Anrufe</span><span>Erreicht</span><span>Am Telefon</span><span>Termine</span><span>Interesse</span><span>Ergebnis der Gespräche</span><span /></div>
      <ol className="gq-alist">{agents.map((agent, index) => { const last = lastCall(agent.lastCallAt); return <li key={agent.userId ?? agent.name} className="gq-arow">
        <span className="gq-rank" aria-label={`Platz ${index + 1}`}>{index + 1}</span>
        <span className="gq-agent-cell"><AgentFace name={agent.name} avatarUrl={avatarOf(agent.userId ?? null)} /><span className="gq-agent-lines"><b>{agent.name}</b><small>{agent.userId === null ? "nur Gespräche ohne Dialer" : last ? `zuletzt ${last} Uhr` : "noch kein Anruf"}</small></span></span>
        <span className="gq-astats">
          <span className="gq-num" data-label="Anrufe"><b>{agent.calls}</b></span>
          <span className="gq-num" data-label="Erreicht"><b>{agent.reached}</b>{agent.reachRate !== null && <small>{agent.reachRate} %</small>}<i className="gq-meter" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, agent.reachRate ?? 0))}%` }} /></i></span>
          <span className="gq-num" data-label="Am Telefon"><b>{talkTime(agent.talkSeconds)}</b>{agent.averageTalkSeconds !== null && <small>im Schnitt {duration(agent.averageTalkSeconds)}</small>}</span>
          <span className="gq-num" data-label="Termine"><b>{agent.appointments}</b>{agent.successRate !== null && <small title="Termine und Interessierte, bezogen auf die erreichten Gespräche">{agent.successRate} % Erfolg</small>}</span>
          <span className="gq-num" data-label="Interesse"><b>{agent.interested}</b><small>{agent.followUps} Wiedervorlage, {agent.noInterest} kein Interesse</small></span>
          <span className="gq-outcome" data-label="Ergebnis der Gespräche">{agent.evaluated ? <><Split approved={agent.approved} review={agent.review} rejected={agent.rejected} open={0} /><small title={`${agent.approved} freigegeben, ${agent.review} zur Prüfung, ${agent.rejected} zurückgewiesen von ${agent.evaluated} bewerteten`}><b>{agent.approved}</b> freigegeben, {agent.review} zur Prüfung, {agent.rejected} zurückgewiesen</small></> : <small>noch nichts bewertet</small>}</span>
        </span>
        <button type="button" className="gq-open-calls" onClick={() => onShowCalls(agent.name)}>Gespräche<ChevronRight aria-hidden="true" /></button>
      </li>; })}</ol>
      <p className="gq-agents-note">Reihenfolge: Wer die meisten grünen Gespräche hat, steht oben – dann der Grün-Anteil, Termine und Anrufe. „Ohne Agent“ steht immer unten.</p>
    </div>}
  </section>;
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
  if (call.error) return <section className="surface-panel p-6 text-sm text-red-200">{call.error.message} <Button variant="ghost" size="sm" onClick={onBack}>Zurück</Button></section>;
  if (!call.data) return <section className="surface-panel p-6 text-sm text-slate-400">Gespräch wird geladen…</section>;
  const data = call.data;
  const mood = moodOf(data); const started = data.startedAt ? new Date(data.startedAt) : null; const contactName = data.leadName ?? data.rawContact?.name ?? null;
  const recordingSource = (data as { recordingSource?: string | null }).recordingSource ?? null;
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
          {data.recordingUrl ? <><audio controls src={data.recordingUrl} onPlay={() => { if (!listenedOnce.current) { listenedOnce.current = true; listened.mutate({ callId }); } }} /><small>{recordingSource === "datei" ? "Hochgeladene Aufnahme – liegt bei uns, nur angemeldet abrufbar." : "Die Aufnahme liegt beim Dialer und wird direkt von dort abgespielt."}</small></> : <small>{data.status === "ohne_einwilligung" ? "Ohne dokumentierte Einwilligung gibt es keine Aufnahme." : "Zu diesem Gespräch liegt keine Aufnahme vor."}</small>}
        </div>
      </div>
      <dl className="gq-call-facts">
        <div><dt>Agent</dt><dd><AgentEdit bare callId={data.id} agentName={data.agentName ?? null} manual={data.agentSource === "manuell"} onChanged={() => { call.refetch(); utils.leadops.listCalls.invalidate(); utils.leadops.callStatistics.invalidate(); utils.leadops.dialerAgentReport.invalidate(); }} /></dd></div>
        <div><dt>Kampagne</dt><dd>{data.campaign ?? data.provider}</dd></div>
        {data.category ? <div><dt>Lead-Kategorie</dt><dd title="Von der KI aus dem Gespräch erkannt">{data.category.emoji ? `${data.category.emoji} ` : ""}{data.category.name}</dd></div> : null}
        <div><dt>Einwilligung zur Aufnahme</dt><dd>{data.consent ? `Ja (${data.consentSource ?? "Dialer"})` : "Nein"}</dd></div>
      </dl>
      {(data.summary || data.nextStep || data.error || data.redFlags.length > 0) && <div className="gq-call-notes">
        {data.summary && <p className="gq-call-summary">{data.summary}</p>}
        {data.nextStep && <p className="gq-call-next">Nächster Schritt: {data.nextStep}</p>}
        {data.error && <p className="gq-call-error">{data.error}</p>}
        {data.redFlags.length > 0 && <p className="gq-call-flags">{data.redFlags.map((flag) => <span key={flag} className="gq-flag">⚠ {flag}</span>)}</p>}
      </div>}
    </section>
    <section className="surface-panel operations-panel gq-panel gq-decide" aria-label="Entscheidung">
      <div className="gq-panel-head"><div><h2>Entscheidung</h2><p>Freigeben setzt den Lead auf „genehmigt“, startet die Auslieferung über die Regeln und legt den Opt-in-Nachweis aus der Einwilligungsstelle der Abschrift an. Zurückweisen markiert ihn als fehlerhaft.</p></div>
        <p className="gq-lead-line">{data.rawContact && !data.leadPublicId && <span className="gq-raw">Rohdaten-Kontakt {data.rawContact.name} ({data.rawContact.status}) – wird bei Freigabe zum Lead.</span>}{data.leadPublicId ? <><span>Lead</span><span className="gq-lead-id">{data.leadPublicId}</span><b>{data.leadName}</b><span className="gq-chip">{data.leadStatus}</span><button type="button" className="gq-link" onClick={() => window.location.assign(`/?page=Leads&leadId=${data.leadPublicId}`)}>Lead öffnen</button></> : <span>Noch keinem Lead zugeordnet</span>}</p></div>
      <div className="gq-decide-row"><Input value={note} placeholder="Notiz zur Entscheidung (optional)" aria-label="Notiz zur Entscheidung" onChange={(event) => setNote(event.target.value)} />
        <div className="gq-choices" role="group" aria-label="Entscheidung treffen">{([["freigegeben", "gruen", "Freigeben & verkaufen"], ["pruefen", "gelb", "Zur Prüfung"], ["zurueckgewiesen", "rot", "Zurückweisen"]] as const).map(([key, mood, label]) => <button key={key} type="button" className={`gq-choice is-${mood} ${data.decision === key ? "is-on" : ""}`} aria-pressed={data.decision === key} disabled={review.isPending} onClick={() => review.mutate({ callId, decision: key, note })}><i aria-hidden="true" />{label}</button>)}</div></div>
      {data.reviewNote && <p className="gq-decide-note">Notiz: {data.reviewNote}</p>}
      <div className="gq-decide-foot"><div className="gq-tools"><button type="button" className="cq-tool" disabled={reevaluate.isPending || data.status === "ohne_einwilligung"} title="Das Gespräch nach den aktuellen Regeln der Kampagne neu bewerten" onClick={() => reevaluate.mutate({ callId })}><RefreshCw aria-hidden="true" /><span>Neu bewerten</span></button>{data.leadId && <button type="button" className="cq-tool" title="Einwilligungsstelle aus der Abschrift als Opt-in-Nachweis anlegen (ohne Freigabe)" disabled={optInFromCall.isPending} onClick={() => optInFromCall.mutate({ callId })}><FileCheck2 aria-hidden="true" /><span>Opt-in aus Gespräch</span></button>}</div>
        <div className="gq-assign"><Input value={linkId} placeholder="Lead-ID zuordnen" aria-label="Lead-ID zuordnen" onChange={(event) => setLinkId(event.target.value)} /><Button size="sm" variant="outline" onClick={() => link.mutate({ callId, publicId: linkId.trim() })} disabled={!linkId.trim()}>Zuordnen</Button></div></div>
    </section>
    {data.leadPublicId && <section className="surface-panel operations-panel gq-panel"><OptInPanel publicId={data.leadPublicId} onChanged={refresh} /></section>}
    <div className="gq-detail-grid">
      <section className="surface-panel operations-panel gq-panel" aria-label="Prüffragen">
        <div className="gq-panel-head"><div><h2>Prüffragen{data.campaign ? <span> {data.campaign}</span> : null}</h2><p>Diese Fragen entscheiden über Freigabe, Prüfung oder Zurückweisung. Jede Antwort lässt sich von Hand ändern – die Entscheidung folgt sofort.{data.nextStep ? <> <b>Aktuell:</b> {data.nextStep}</> : null}</p></div></div>
        <ul className="gq-qlist">{(data.questions ?? []).map((question) => { const answer = data.qualificationAnswers?.[question.key]; const rule = ((question as { rule?: Rule }).rule ?? "info") as Rule; const given = answer?.answer ?? "unklar"; return <li key={question.key} className={`gq-q is-${given}`}>
          <div className="gq-q-text"><strong>{question.label}</strong><span className="gq-q-tags"><span className={`gq-rule is-${rule}`}>{RULE_SHORT[rule]}</span>{question.onlyFor && <span className="gq-rule">nur {SCOPE_LABEL[question.onlyFor]}</span>}</span>{answer?.note && <Expandable text={answer.note} className="gq-q-note" />}</div>
          <div className="gq-answers" role="group" aria-label={`Antwort: ${question.label}`}>{(["ja", "nein", "unklar"] as const).map((option) => <button key={option} type="button" className={`gq-answer is-${option} ${given === option ? "is-on" : ""}`} aria-pressed={given === option} onClick={() => setAnswer.mutate({ callId, key: question.key, answer: option })}>{option === "ja" ? "Ja" : option === "nein" ? "Nein" : "Unklar"}</button>)}</div>
        </li>; })}</ul>
        {!(data.questions ?? []).length && <p className="gq-panel-empty">Für diese Kampagne sind keine Fragen hinterlegt.</p>}
      </section>
      <section className="surface-panel operations-panel gq-panel" aria-label="Kriterien">
        <div className="gq-panel-head"><div><h2>Kriterien{data.criteriaCustom ? <span> eigene der Kampagne</span> : null}</h2>{data.verdict && <p>KI-Einschätzung zur Gesprächsqualität: <b>{verdictLabel[data.verdict]}</b>{typeof data.score === "number" && <>, Qualitätsnote <b>{data.score} %</b> (aus den gewichteten Kriterien)</>}. Entschieden wird aber über die Prüffragen (K.-o. und Pflicht) – deshalb kann die Ampel davon abweichen.</p>}</div></div>
        {data.criteriaUnscored && <p className="cq-unscored">Die Kriterien dieses Gesprächs sind noch nicht bewertet. Das holt die Software in den nächsten Minuten automatisch nach – die Ampel oben gilt trotzdem, denn sie kommt aus den Prüffragen. Sofort geht es mit „Neu bewerten“.{data.criteriaNote ? <span className="mt-1 block opacity-70">Technischer Hinweis: {data.criteriaNote}</span> : null}</p>}
        <ul className="gq-clist">{data.criteria.map((criterion) => { const mood = criterion.score === null ? "offen" : criterion.score >= 7 ? "gruen" : criterion.score >= 4 ? "gelb" : "rot"; return <li key={criterion.key} className={`gq-c is-${mood}`}>
          <div className="gq-c-head"><strong>{criterion.label}</strong><small>Gewicht {criterion.weight}</small>{criterion.score !== null && <b className="cq-percent-sm">{criterion.score * 10} %</b>}<span className="cq-mood is-sm" title={criterion.score === null ? "Noch nicht bewertet" : `Einschätzung der KI: ${criterion.score >= 7 ? "erfüllt" : criterion.score >= 4 ? "teilweise" : "nicht erfüllt"}`}><Face mood={mood} size={24} /></span></div>
          <i className="gq-c-bar" aria-hidden="true"><i style={{ width: `${((criterion.score ?? 0) / 10) * 100}%` }} /></i>
          {criterion.evidence && <Expandable text={criterion.evidence} quote className="gq-c-evidence" />}
        </li>; })}</ul>
      </section>
      <section className="surface-panel operations-panel gq-panel is-wide" aria-label="Transkript">
        <div className="gq-panel-head"><div><h2>Transkript</h2></div></div>
        <Transcript text={data.transcript ?? null} fallback={data.status === "ohne_einwilligung" ? "Ohne dokumentierte Einwilligung wird das Gespräch nicht transkribiert." : "Noch kein Transkript."} />
      </section>
    </div>
  </div>;
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

function CallQaSettings() {
  const utils = trpc.useUtils();
  const settings = trpc.leadops.getCallQaSettings.useQuery(undefined, { retry: false });
  if (settings.error) return <section className="surface-panel p-6 text-sm text-red-200">{settings.error.message}</section>;
  if (!settings.data) return <section className="surface-panel p-6 text-sm text-slate-400">Einstellungen werden geladen…</section>;
  return <SettingsForm key={settings.data.updatedAt ? String(settings.data.updatedAt) : "init"} data={settings.data} onDone={() => { utils.leadops.getCallQaSettings.invalidate(); utils.leadops.listCalls.invalidate(); utils.leadops.callStatistics.invalidate(); }} />;
}

function SettingsForm({ data, onDone }: { data: Settings; onDone: () => void }) {
  const initial = () => ({ enabled: data.enabled, consentRequired: data.consentRequired, autoApproveThreshold: data.autoApproveThreshold, autoRejectThreshold: data.autoRejectThreshold, autoDeliver: data.autoDeliver, criteria: data.criteria, instructions: data.instructions ?? "", fieldMapping: data.fieldMapping, recordingAuthHeader: data.recordingAuthHeader, transcriptionProvider: data.transcriptionProvider, transcriptionLanguage: data.transcriptionLanguage, retentionDays: data.retentionDays, decisionRules: data.decisionRules, examples: data.examples, extractFields: data.extractFields });
  const [form, setForm] = useState(initial);
  useEffect(() => { setForm(initial()); }, [data]);
  const save = trpc.leadops.saveCallQaSettings.useMutation({ onSuccess: () => { toast.success("Einstellungen gespeichert."); onDone(); }, onError: (error) => toast.error(error.message) });
  const rotate = trpc.leadops.rotateCallQaToken.useMutation({ onSuccess: () => { toast.success("Neue Webhook-Adresse erzeugt. Bitte im Dialer aktualisieren."); onDone(); }, onError: (error) => toast.error(error.message) });
  const simulate = trpc.leadops.simulateCall.useMutation({ onSuccess: (result) => { toast[result.status === "bewertet" ? "success" : "error"](result.status === "bewertet" ? `Bewertung: ${MOOD[moodOf({ verdict: result.verdict, decision: result.decision, status: result.status, score: result.score })].label} – ${verdictLabel[result.verdict ?? "unklar"]} → ${decisionLabel[result.decision]}` : result.error ?? "Fehlgeschlagen"); onDone(); }, onError: (error) => toast.error(error.message) });
  const [transcript, setTranscript] = useState(""); const [testLead, setTestLead] = useState("");
  const [presetAll, setPresetAll] = useState(true);
  const applyPreset = trpc.leadops.applyCallQaPreset.useMutation({ onSuccess: (result) => { toast.success(`Vorlage übernommen – Kriterien, KI-Anweisung und Prüffragen sind gesetzt${result.campaigns ? ` (auch für ${result.campaigns} Kampagnen-Fragensätze)` : ""}.`); onDone(); }, onError: (error) => toast.error(error.message) });
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); toast.success("Kopiert."); } catch { toast.error("Kopieren nicht möglich."); } };
  const mappingKeys: Array<[keyof typeof form.fieldMapping, string]> = [["callId", "Gesprächs-ID"], ["leadId", "Lead-ID (unsere)"], ["phone", "Telefonnummer"], ["agent", "Agent"], ["campaign", "Kampagne"], ["direction", "Richtung"], ["startedAt", "Beginn"], ["duration", "Dauer (Sek.)"], ["recordingUrl", "Aufzeichnungs-URL"], ["transcript", "Transkript (falls vorhanden)"], ["consent", "Einwilligung"]];
  const sample = JSON.stringify({ [form.fieldMapping.callId]: "abc-123", [form.fieldMapping.leadId]: "API-1A2B3C4D", [form.fieldMapping.phone]: "+49 170 1234567", [form.fieldMapping.agent]: "Müller", [form.fieldMapping.campaign]: "PV Q4", [form.fieldMapping.startedAt]: "2026-09-23T10:15:00Z", [form.fieldMapping.duration]: 312, [form.fieldMapping.recordingUrl]: "https://…/aufzeichnung.mp3", [form.fieldMapping.consent]: true }, null, 2);
  return <div className="grid gap-4 gq-settings cq-dialog-tokens">
    <section className="surface-panel operations-panel p-5"><span className="eyebrow">Dialer-Anbindung (OnDialer)</span><p className="mt-1 text-xs text-slate-400">Hinterlege diese Adresse im Dialer als Webhook für „Gespräch beendet“. Der Dialer schickt die Gesprächsdaten und den Link zur Aufzeichnung, unsere Software holt die Aufzeichnung, erstellt das Transkript und bewertet es sofort. Ist die Aufnahme beim Eingang noch nicht fertig, holen wir sie automatisch später nach (bis zu 8 Versuche über ca. 4 Stunden). Ein Aufruf der Adresse im Browser (GET) zeigt dem Dialer-Entwickler, ob alles stimmt; ein Testgespräch mit <code>"test": true</code> prüft Felder und Aufnahme-Link, ohne etwas zu speichern.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2"><code className="max-w-full truncate rounded bg-black/30 px-2 py-1 text-xs text-slate-200">POST {data.webhookUrl}</code><Button size="sm" variant="ghost" onClick={() => copy(data.webhookUrl)}>Kopieren</Button><Button size="sm" variant="ghost" title="Fertige Anleitung mit dieser Adresse, den Feldnamen und Beispielen – zum Einfügen in eine E-Mail an den Entwickler des Dialers (ohne Produktname)" onClick={() => copy(dialerGuideText({ webhookUrl: data.webhookUrl, fieldMapping: form.fieldMapping, consentRequired: form.consentRequired, recordingAuthHeader: Boolean(form.recordingAuthHeader) }))}>Anleitung für den Dialer-Entwickler kopieren</Button><Button size="sm" variant="ghost" onClick={async () => { if (await confirmAction("Neue Adresse erzeugen? Die alte wird ungültig.")) rotate.mutate(); }}>Neu erzeugen</Button></div>
      <div className="mt-3 grid gap-2 md:grid-cols-2"><Toggle checked={form.enabled} onChange={(value) => setForm((current) => ({ ...current, enabled: value }))} label="Gesprächsbewertung aktiv" hint={form.enabled ? (form.enabled === data.enabled ? "An: der Webhook nimmt Gespräche an und wertet sie aus." : "Wird nach dem Speichern eingeschaltet.") : (form.enabled === data.enabled ? "Aus: der Webhook nimmt keine Gespräche an (Antwort „call evaluation disabled“)." : "Wird nach dem Speichern ausgeschaltet.")} /><Toggle checked={form.consentRequired} onChange={(value) => setForm((current) => ({ ...current, consentRequired: value }))} label="Einwilligung erforderlich" hint="Nur Gespräche mit dokumentierter Einwilligung zur Aufzeichnung (Feld „Einwilligung“ = ja) werden transkribiert und bewertet. Aufzeichnen ohne Einwilligung beider Seiten ist in Deutschland strafbar (§ 201 StGB)." /></div>
      <details className="mt-3 rounded-lg border border-white/8 bg-white/[.02] p-3"><summary className="cursor-pointer text-sm text-slate-200">Felder des Dialers zuordnen</summary><p className="mt-1 text-xs text-slate-400">Welches Feld im Webhook des Dialers welche Bedeutung hat (Punkt-Schreibweise für verschachtelte Felder, z. B. call.id). Die Vorgaben passen zu einem Standard-Webhook; nach Erhalt der OnDialer-Dokumentation hier anpassen.</p><div className="mt-2 grid gap-2 md:grid-cols-2">{mappingKeys.map(([key, label]) => <label key={key} className="text-xs text-slate-300">{label}<Input value={form.fieldMapping[key]} onChange={(event) => setForm((current) => ({ ...current, fieldMapping: { ...current.fieldMapping, [key]: event.target.value } }))} /></label>)}</div><p className="mt-2 text-xs text-slate-400">Beispiel, wie der Webhook aussehen sollte:</p><pre className="mt-1 overflow-auto rounded-md bg-slate-950 p-3 text-[11px] text-slate-200">{sample}</pre></details>
      <div className="mt-3 grid gap-3 md:grid-cols-3"><label className="text-xs text-slate-300">Transkription<select className={field} value={form.transcriptionProvider} onChange={(event) => setForm((current) => ({ ...current, transcriptionProvider: event.target.value as typeof form.transcriptionProvider }))}><option value="auto">Automatisch</option><option value="payload">Transkript kommt vom Dialer</option><option value="openai" disabled={!data.transcriptionAvailable.openai}>OpenAI Whisper{data.transcriptionAvailable.openai ? "" : " (Schlüssel fehlt)"}</option><option value="deepgram" disabled={!data.transcriptionAvailable.deepgram}>Deepgram{data.transcriptionAvailable.deepgram ? "" : " (Schlüssel fehlt)"}</option></select>{(() => { const { openai, deepgram } = data.transcriptionAvailable; const provider = form.transcriptionProvider; const active = provider === "payload" ? "Transkript kommt vom Dialer – kein Dienst nötig." : provider === "openai" || (provider === "auto" && openai) ? "Aktiv: OpenAI Whisper (Schlüssel beim Hosting hinterlegt)." : provider === "deepgram" || (provider === "auto" && deepgram) ? "Aktiv: Deepgram (Schlüssel beim Hosting hinterlegt)." : null; return active ? <span className="cq-transcription-state is-ok mt-1 block text-[11px]" role="status">✓ {active}</span> : <span className="cq-transcription-state is-missing mt-1 block text-[11px]" role="status">⚠ Kein Transkriptionsdienst eingerichtet – die KI kann Aufnahmen nicht auswerten. Beim Hosting (Railway → Variables) den Schlüssel OPENAI_API_KEY oder DEEPGRAM_API_KEY eintragen; nach dem Neustart steht hier „Aktiv“.</span>; })()}<span className="mt-1 block text-[11px] text-slate-500">Liefert der Dialer schon ein fertiges Transkript, reicht „Transkript kommt vom Dialer“.</span></label><label className="text-xs text-slate-300">Sprache<Input value={form.transcriptionLanguage} onChange={(event) => setForm((current) => ({ ...current, transcriptionLanguage: event.target.value }))} /></label><label className="text-xs text-slate-300">Zugriff auf Aufzeichnungen (Header)<Input value={form.recordingAuthHeader} placeholder="Authorization: Bearer …" onChange={(event) => setForm((current) => ({ ...current, recordingAuthHeader: event.target.value }))} /><span className="mt-1 block text-[11px] text-slate-500">Falls der Dialer die Aufzeichnungen nur mit Schlüssel herausgibt.</span></label></div>
    </section>
    <section className="surface-panel operations-panel p-5 cq-presets"><span className="eyebrow">Vorlage übernehmen</span><p className="mt-1 text-xs text-slate-400">Setzt Kriterien, die Anweisung an die KI und die Prüffragen in einem Schritt – danach kannst du unten alles noch anpassen.</p>
      <div className="mt-3 grid gap-2">{CALL_QA_PRESETS.map((preset) => <div key={preset.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/8 bg-white/[.02] p-3"><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-slate-100">{preset.label}</div><div className="text-xs text-slate-400">{preset.description}</div></div><label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={presetAll} onChange={(event) => setPresetAll(event.target.checked)} />auch für vorhandene Kampagnen-Fragensätze</label><Button className="flux-button" size="sm" disabled={applyPreset.isPending} onClick={async () => { if (!(await confirmAction(`Vorlage „${preset.label}“ übernehmen? Kriterien, KI-Anweisung und Prüffragen werden ersetzt – deine jetzigen Einstellungen in diesen drei Bereichen gehen verloren.`, { confirmLabel: "Übernehmen" }))) return; applyPreset.mutate({ preset: preset.key, allCampaigns: presetAll }); }}>{applyPreset.isPending ? "Übernehme …" : "Vorlage übernehmen"}</Button></div>)}</div>
    </section>
    <section className="surface-panel operations-panel p-5"><span className="eyebrow">Bewertung und Entscheidung</span><p className="mt-1 text-xs text-slate-400">Die KI prüft jedes Kriterium und belegt es mit einer Stelle aus dem Gespräch. Angezeigt wird eine Ampel mit Smileys: grün passt · gelb reinhören · rot passt nicht. Die Gewichte bestimmen, wie stark ein Kriterium in die Gesamt-Ampel eingeht.</p>
      <div className="mt-3 grid gap-2">{form.criteria.map((criterion, index) => <div key={index} className="grid gap-1 rounded-lg border border-white/8 bg-white/[.02] p-2 md:grid-cols-[130px_1fr_90px_2fr_auto]"><Input value={criterion.key} placeholder="schluessel" onChange={(event) => setForm((current) => ({ ...current, criteria: current.criteria.map((item, i) => i === index ? { ...item, key: event.target.value.replace(/[^a-z0-9_]/gi, "").toLowerCase() } : item) }))} /><Input value={criterion.label} placeholder="Bezeichnung" onChange={(event) => setForm((current) => ({ ...current, criteria: current.criteria.map((item, i) => i === index ? { ...item, label: event.target.value } : item) }))} /><Input type="number" min={0} max={100} value={criterion.weight} onChange={(event) => setForm((current) => ({ ...current, criteria: current.criteria.map((item, i) => i === index ? { ...item, weight: Number(event.target.value) } : item) }))} /><Input value={criterion.description} placeholder="Was erfüllt sein muss" onChange={(event) => setForm((current) => ({ ...current, criteria: current.criteria.map((item, i) => i === index ? { ...item, description: event.target.value } : item) }))} /><Button size="sm" variant="ghost" onClick={() => setForm((current) => ({ ...current, criteria: current.criteria.filter((_, i) => i !== index) }))}>✕</Button></div>)}</div>
      <Button size="sm" variant="outline" className="mt-2" onClick={() => setForm((current) => ({ ...current, criteria: [...current.criteria, { key: `kriterium_${current.criteria.length + 1}`, label: "", weight: 10, description: "" }] }))}>Kriterium hinzufügen</Button>
      <label className="mt-3 block text-xs text-slate-300">Zusätzliche Vorgaben für die Bewertung (optional)<textarea className="mt-1 min-h-[80px] w-full rounded-md border border-white/10 bg-slate-950 p-3 text-sm text-slate-100" value={form.instructions} placeholder="z. B. Nur Eigentümer von Einfamilienhäusern gelten als verkaufbar; Mieter immer „nicht verkaufbar“." onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))} /></label>
      <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">Hinweis: Die Entscheidung (freigegeben / prüfen / zurückgewiesen) treffen die Qualifizierungsfragen der jeweiligen Kampagne (Seite „Gespräche“). Die Ampel hier ist die Qualitätsnote der KI und greift nur, wenn eine Kampagne keine entscheidende Frage (K.-o. oder Pflicht) hat.</p><div className="mt-3 grid gap-3 md:grid-cols-3"><label className="text-xs text-slate-300">Ab wann grün 🙂 (KI-Note 0–100)<Input type="number" min={0} max={100} value={form.autoApproveThreshold} onChange={(event) => setForm((current) => ({ ...current, autoApproveThreshold: Number(event.target.value) }))} /><span className="mt-1 block text-[11px] text-slate-500">Lead wird „genehmigt“ und über die Regeln ausgeliefert/verkauft.</span></label><label className="text-xs text-slate-300">Bis wann rot 🙁 (KI-Note 0–100)<Input type="number" min={0} max={100} value={form.autoRejectThreshold} onChange={(event) => setForm((current) => ({ ...current, autoRejectThreshold: Number(event.target.value) }))} /><span className="mt-1 block text-[11px] text-slate-500">Lead wird „fehlerhaft“. Dazwischen: zur manuellen Prüfung.</span></label><label className="text-xs text-slate-300">Aufbewahrung Transkripte (Tage)<Input type="number" min={0} max={3650} value={form.retentionDays} onChange={(event) => setForm((current) => ({ ...current, retentionDays: Number(event.target.value) }))} /><span className="mt-1 block text-[11px] text-slate-500">Danach werden Transkript und Aufzeichnungs-Link gelöscht, die Bewertung bleibt. 0 = nie.</span></label></div>
      <div className="mt-3"><Toggle checked={form.autoDeliver} onChange={(value) => setForm((current) => ({ ...current, autoDeliver: value }))} label="Freigegebene Leads sofort über die Automatisierung ausliefern" hint="Startet die Regeln „bei Statuswechsel“ – z. B. Bestellung zuordnen und in Echtzeit an den Käufer übergeben." /></div>
      <div className="mt-4 flex justify-end"><Button className="flux-button" size="sm" onClick={() => save.mutate(form)} disabled={save.isPending}>Speichern</Button></div>
    </section>
    <section className="surface-panel operations-panel p-5"><span className="eyebrow">Entscheidungsregeln (vor den Schwellen)</span><p className="mt-1 text-xs text-slate-400">Eigene Regeln, die vor der Ampel-Einstufung greifen – die erste passende Regel entscheidet. Beispiele: „Kriterium Weitergabe erlaubt unter 5 → zurückweisen“, „Transkript enthält ‚Mieter‘ → zur Prüfung“, „Warnsignal vorhanden → zurückweisen“.</p>
      <div className="mt-3 grid gap-2">{form.decisionRules.map((rule, index) => <div key={rule.id || index} className="grid gap-1 rounded-lg border border-white/8 bg-white/[.02] p-2 md:grid-cols-[1fr_1fr_130px_1fr_150px_auto]"><Input value={rule.label} placeholder="Bezeichnung" onChange={(event) => setForm((current) => ({ ...current, decisionRules: current.decisionRules.map((item, i) => i === index ? { ...item, label: event.target.value } : item) }))} /><select className={field} value={rule.field} onChange={(event) => setForm((current) => ({ ...current, decisionRules: current.decisionRules.map((item, i) => i === index ? { ...item, field: event.target.value as typeof rule.field } : item) }))}><option value="score">Gesamtpunkte</option><option value="verdict">Urteil</option><option value="redFlags">Warnsignale</option><option value="transcript">Transkript</option>{form.criteria.map((criterion) => <option key={criterion.key} value={`criterion:${criterion.key}`}>Kriterium: {criterion.label}</option>)}</select><select className={field} value={rule.op} onChange={(event) => setForm((current) => ({ ...current, decisionRules: current.decisionRules.map((item, i) => i === index ? { ...item, op: event.target.value as typeof rule.op } : item) }))}><option value="gte">mindestens</option><option value="lte">höchstens</option><option value="eq">ist genau</option><option value="contains">enthält</option><option value="any">ist vorhanden</option></select><Input value={rule.value} placeholder={rule.field === "verdict" ? "verkaufbar / nachfassen / nicht_verkaufbar" : rule.field === "transcript" ? "Wort oder Satz" : "Zahl"} disabled={rule.op === "any"} onChange={(event) => setForm((current) => ({ ...current, decisionRules: current.decisionRules.map((item, i) => i === index ? { ...item, value: event.target.value } : item) }))} /><select className={field} value={rule.decision} onChange={(event) => setForm((current) => ({ ...current, decisionRules: current.decisionRules.map((item, i) => i === index ? { ...item, decision: event.target.value as typeof rule.decision } : item) }))}><option value="freigegeben">→ freigeben</option><option value="pruefen">→ zur Prüfung</option><option value="zurueckgewiesen">→ zurückweisen</option></select><div className="flex items-center gap-1"><input type="checkbox" checked={rule.active} title="Aktiv" onChange={(event) => setForm((current) => ({ ...current, decisionRules: current.decisionRules.map((item, i) => i === index ? { ...item, active: event.target.checked } : item) }))} /><Button size="sm" variant="ghost" onClick={() => setForm((current) => ({ ...current, decisionRules: current.decisionRules.filter((_, i) => i !== index) }))}>✕</Button></div></div>)}</div>
      <Button size="sm" variant="outline" className="mt-2" onClick={() => setForm((current) => ({ ...current, decisionRules: [...current.decisionRules, { id: `r${Date.now()}`, label: "", field: "score", op: "gte", value: "", decision: "pruefen", active: true }] }))}>Regel hinzufügen</Button></section>
    <section className="surface-panel operations-panel p-5"><span className="eyebrow">Fragen an das Gespräch (Daten auslesen)</span><p className="mt-1 text-xs text-slate-400">Die KI beantwortet diese Fragen aus dem Gespräch und schreibt die Antworten als Zusatzfelder in den Lead – z. B. Dachfläche, Baujahr, gewünschter Termin. So werden die Leads wertvoller für den Käufer.</p>
      <div className="mt-3 grid gap-2">{form.extractFields.map((item, index) => <div key={index} className="grid gap-1 md:grid-cols-[160px_1fr_2fr_auto]"><Input value={item.key} placeholder="feldschluessel" onChange={(event) => setForm((current) => ({ ...current, extractFields: current.extractFields.map((entry, i) => i === index ? { ...entry, key: event.target.value.replace(/[^a-z0-9_]/gi, "").toLowerCase() } : entry) }))} /><Input value={item.label} placeholder="Bezeichnung" onChange={(event) => setForm((current) => ({ ...current, extractFields: current.extractFields.map((entry, i) => i === index ? { ...entry, label: event.target.value } : entry) }))} /><Input value={item.question} placeholder="Frage, z. B. Wie groß ist die Dachfläche?" onChange={(event) => setForm((current) => ({ ...current, extractFields: current.extractFields.map((entry, i) => i === index ? { ...entry, question: event.target.value } : entry) }))} /><Button size="sm" variant="ghost" onClick={() => setForm((current) => ({ ...current, extractFields: current.extractFields.filter((_, i) => i !== index) }))}>✕</Button></div>)}</div>
      <Button size="sm" variant="outline" className="mt-2" onClick={() => setForm((current) => ({ ...current, extractFields: [...current.extractFields, { key: "", label: "", question: "" }] }))}>Frage hinzufügen</Button></section>
    <section className="surface-panel operations-panel p-5"><span className="eyebrow">Beispiele für die KI</span><p className="mt-1 text-xs text-slate-400">Zeige der KI anhand echter Gesprächsausschnitte, wie ihr entscheiden würdet. Die Beispiele werden bei jeder Bewertung mitgegeben und verbessern die Trefferquote.</p>
      <div className="mt-3 grid gap-2">{form.examples.map((example, index) => <div key={index} className="rounded-lg border border-white/8 bg-white/[.02] p-3"><div className="grid gap-1 md:grid-cols-[1fr_200px_auto]"><Input value={example.title} placeholder="Titel, z. B. Mieter ohne Eigentum" onChange={(event) => setForm((current) => ({ ...current, examples: current.examples.map((entry, i) => i === index ? { ...entry, title: event.target.value } : entry) }))} /><select className={field} value={example.verdict} onChange={(event) => setForm((current) => ({ ...current, examples: current.examples.map((entry, i) => i === index ? { ...entry, verdict: event.target.value as typeof example.verdict } : entry) }))}><option value="verkaufbar">verkaufbar</option><option value="nachfassen">nachfassen</option><option value="nicht_verkaufbar">nicht verkaufbar</option></select><Button size="sm" variant="ghost" onClick={() => setForm((current) => ({ ...current, examples: current.examples.filter((_, i) => i !== index) }))}>✕</Button></div><textarea className="mt-2 min-h-[70px] w-full rounded-md border border-white/10 bg-slate-950 p-2 text-xs text-slate-100" placeholder="Gesprächsausschnitt" value={example.transcript} onChange={(event) => setForm((current) => ({ ...current, examples: current.examples.map((entry, i) => i === index ? { ...entry, transcript: event.target.value } : entry) }))} /><Input className="mt-1" value={example.reason} placeholder="Begründung, z. B. Mieter dürfen keine PV-Anlage beauftragen" onChange={(event) => setForm((current) => ({ ...current, examples: current.examples.map((entry, i) => i === index ? { ...entry, reason: event.target.value } : entry) }))} /></div>)}</div>
      <Button size="sm" variant="outline" className="mt-2" onClick={() => setForm((current) => ({ ...current, examples: [...current.examples, { title: "", transcript: "", verdict: "nachfassen", reason: "" }] }))}>Beispiel hinzufügen</Button>
      <div className="mt-4 flex justify-end"><Button className="flux-button" size="sm" onClick={() => save.mutate(form)} disabled={save.isPending}>Alles speichern</Button></div></section>
    <section className="surface-panel operations-panel p-5"><span className="eyebrow">Bewertung testen</span><p className="mt-1 text-xs text-slate-400">Füge ein Gesprächsprotokoll ein (z. B. aus einem Testanruf) und sieh, wie die KI bewertet und entscheidet. Optional mit einer Lead-ID, damit die Entscheidung auf den Lead wirkt.</p><textarea className="mt-2 min-h-[160px] w-full rounded-md border border-white/10 bg-slate-950 p-3 text-sm text-slate-100" value={transcript} placeholder={"Agent: Guten Tag, hier ist … vom Energieservice. Sie hatten sich für eine Photovoltaikanlage interessiert?\nKunde: Ja, wir überlegen, nächstes Frühjahr …"} onChange={(event) => setTranscript(event.target.value)} /><div className="mt-2 flex flex-wrap items-center gap-2"><Input value={testLead} placeholder="Lead-ID (optional)" className="max-w-[180px]" onChange={(event) => setTestLead(event.target.value)} /><Button className="flux-button" size="sm" onClick={() => simulate.mutate({ transcript, publicId: testLead.trim() || null, agentName: "Test" })} disabled={simulate.isPending || transcript.trim().length < 20}>{simulate.isPending ? "Bewertet …" : "Bewerten"}</Button></div></section>
  </div>;
}
