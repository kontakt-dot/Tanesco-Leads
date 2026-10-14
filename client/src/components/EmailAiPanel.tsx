import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Check, FileText, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DEFAULT_CTA_URL, draftWordCount, GOALS, LENGTHS, PLACEHOLDERS_HINT, TEMPLATE_PROPOSALS, TONES, type EmailDraft, type EmailGoal, type EmailLength, type EmailTone, type TemplateProposal } from "../../../shared/email-ai";
import type { EmailTree } from "../../../shared/email-campaigns";

/**
 * KI-Vorlagen-Builder: „Welche E-Mail brauchst du?“ → fertige E-Mail (Betreff, Vorschautext, Bausteine) oder ganze Serie.
 * Mit KI-Schlüssel schreibt die KI, sonst kommt ein regelbasierter Entwurf – beides landet im Builder zum Anpassen.
 */
type BriefState = { brief: string; goal: EmailGoal; tone: EmailTone; length: EmailLength; audience: string; ctaUrl: string; abTest: boolean };
function useBrief(initial: Partial<BriefState> = {}) { return useState<BriefState>({ brief: "", goal: "frei", tone: "freundlich", length: "mittel", audience: "", ctaUrl: DEFAULT_CTA_URL, abTest: false, ...initial }); }
const fromProposal = (state: BriefState, proposal: TemplateProposal): BriefState => ({ ...state, brief: proposal.brief, goal: proposal.goal, tone: proposal.tone, length: proposal.length, abTest: Boolean(proposal.abTest) });
/** Vorschläge, die der Builder vorschreibt: ein Klick füllt nur die Beschreibung aus – gebaut wird erst mit dem Knopf, damit man den Text vorher in Ruhe anpassen kann. */
function Proposals({ onPick, series = false, picked = null }: { onPick: (proposal: TemplateProposal) => void; series?: boolean; picked?: string | null }) {
  return <div className="ai-proposals"><span className="eyebrow">VORSCHLÄGE · KLICK FÜLLT DIE BESCHREIBUNG AUS</span><div className="ai-proposal-grid">{TEMPLATE_PROPOSALS.map((proposal) => <button key={proposal.key} type="button" className={`ai-proposal ${picked === proposal.key ? "is-picked" : ""}`} aria-pressed={picked === proposal.key} onClick={() => onPick(proposal)} title={proposal.brief}><strong><FileText className="h-3.5 w-3.5" /> {proposal.name}</strong><small>{series ? (proposal.kind === "serie" ? proposal.hint : `${proposal.hint} – als Serie mit Nachfassen`) : (proposal.kind === "serie" ? `${proposal.hint.replace(/^\d+ E-Mails?: ?/, "")} – hier als erste E-Mail` : proposal.hint)}</small></button>)}</div></div>;
}
function BriefFields({ state, onChange, compact = false }: { state: BriefState; onChange: (next: BriefState) => void; compact?: boolean }) {
  return <>
    <textarea className="lead-action-textarea" rows={compact ? 3 : 4} maxLength={2000} placeholder="Welche E-Mail brauchst du? Beschreib sie in ein, zwei Sätzen – Anlass, Zielgruppe, was der Empfänger tun soll … oder nimm oben einen Vorschlag." value={state.brief} onChange={(event) => onChange({ ...state, brief: event.target.value })} />
    <div className="ai-chip-row"><span className="eyebrow">ZIEL</span><div className="ai-chips">{GOALS.map((goal) => <button key={goal.key} type="button" className={`segment-tab ${state.goal === goal.key ? "active" : ""}`} title={goal.hint} onClick={() => onChange({ ...state, goal: goal.key })}>{goal.label}</button>)}</div></div>
    <div className="ai-chip-row"><span className="eyebrow">TON</span><div className="ai-chips">{TONES.map((tone) => <button key={tone.key} type="button" className={`segment-tab ${state.tone === tone.key ? "active" : ""}`} onClick={() => onChange({ ...state, tone: tone.key })}>{tone.label}</button>)}</div><span className="eyebrow">LÄNGE</span><div className="ai-chips">{LENGTHS.map((length) => <button key={length.key} type="button" className={`segment-tab ${state.length === length.key ? "active" : ""}`} onClick={() => onChange({ ...state, length: length.key })}>{length.label}</button>)}</div></div>
    <div className="grid gap-2 md:grid-cols-2"><Input placeholder="Zielgruppe (optional, z. B. Dachdecker in Hessen)" value={state.audience} onChange={(event) => onChange({ ...state, audience: event.target.value })} /><Input placeholder="Link für den Knopf" value={state.ctaUrl} onChange={(event) => onChange({ ...state, ctaUrl: event.target.value })} /></div>
    <label className="lead-action-check"><input type="checkbox" checked={state.abTest} onChange={(event) => onChange({ ...state, abTest: event.target.checked })} /> zweiten Betreff für den A/B-Test mitliefern</label>
  </>;
}
const sourceNote = (source: "ki" | "vorlage", note?: string | null) => source === "ki" ? `Von der KI geschrieben${note ? ` (${note})` : ""} – im Builder anpassen.` : `Achtung: Standard-Vorlage – deine Beschreibung wurde nicht verwendet${note ? ` (${note})` : ""}. Dafür fehlt der KI-Schlüssel (ANTHROPIC_API_KEY beim Hosting).`;

/**
 * Warnung, solange kein KI-Schlüssel hinterlegt ist: Ohne Schlüssel baut der Server nur eine Standard-Vorlage
 * aus Ziel, Ton und Länge – der eigene Beschreibungstext fällt weg. Das muss man vor dem Klick sehen, nicht danach.
 */
function AiMissingKeyNote() {
  const status = trpc.leadops.aiStatus.useQuery(undefined, { retry: false, staleTime: 5 * 60 * 1000 });
  if (status.data?.enabled !== false) return null;
  return <p className="ai-missing-key">Kein KI-Schlüssel hinterlegt: Der Builder baut nur eine Standard-Vorlage aus Ziel, Ton und Länge – <strong>deine Beschreibung wird nicht verwendet</strong>. Damit die KI wirklich schreibt, muss beim Hosting die Variable <code>ANTHROPIC_API_KEY</code> gesetzt sein.</p>;
}

/** Eine E-Mail bauen (im Builder einer Send-Karte). */
export function EmailAiPanel({ category, onDraft }: { category?: string | null; onDraft: (draft: EmailDraft) => void }) {
  const [state, setState] = useBrief(); const [picked, setPicked] = useState<string | null>(null);
  const draft = trpc.leadops.draftEmailWithAi.useMutation({ onSuccess: (result) => { onDraft(result.draft); toast.success(`E-Mail gebaut: ${result.draft.blocks.length} Bausteine, ${draftWordCount(result.draft.blocks)} Wörter. ${sourceNote(result.source, (result as { note?: string }).note)}`, { duration: 6000 }); }, onError: (error) => toast.error(error.message) });
  const build = (next: BriefState) => draft.mutate({ brief: next.brief, goal: next.goal, tone: next.tone, length: next.length, audience: next.audience || null, category: category ?? null, ctaUrl: next.ctaUrl || null, abTest: next.abTest });
  return <div className="ai-panel">
    <p className="text-xs text-slate-500">Nimm einen Vorschlag – oder beschreibe die E-Mail selbst. Der Builder schreibt Betreff, Vorschautext und Bausteine; Platzhalter wie {PLACEHOLDERS_HINT} werden beim Versand gefüllt.</p>
    <AiMissingKeyNote />
    <Proposals picked={picked} onPick={(proposal) => { setState(fromProposal(state, proposal)); setPicked(proposal.key); }} />
    {picked && <p className="ai-picked-note">Vorschlag übernommen – Beschreibung, Ziel und Ton kannst du jetzt noch anpassen. Gebaut wird erst, wenn du auf „E-Mail bauen“ klickst.</p>}
    <BriefFields state={state} onChange={(next) => { setState(next); if (picked && next.brief !== state.brief) setPicked(null); }} />
    <div className="flex flex-wrap items-center justify-between gap-2"><small className="text-xs text-slate-500">Ersetzt Betreff und Bausteine dieser E-Mail – das Design bleibt. Nichts passiert, bevor du nicht auf den Knopf klickst.</small><Button className="flux-button" disabled={draft.isPending || state.brief.trim().length < 3} onClick={() => build(state)}><Sparkles /> {draft.isPending ? "Schreibt …" : "E-Mail bauen"}</Button></div>
  </div>;
}

/** Ganze Serie bauen (im Kampagnen-Editor). */
export function SeriesAiPanel({ category, onSeries }: { category?: string | null; onSeries: (result: { name: string; tree: EmailTree }) => void }) {
  const [state, setState] = useBrief(); const [picked, setPicked] = useState<string | null>(null); const [count, setCount] = useState(3); const [waitDays, setWaitDays] = useState(3); const [stopWhen, setStopWhen] = useState<"replied" | "clicked" | "opened" | "never">("replied");
  const draft = trpc.leadops.draftEmailSeriesWithAi.useMutation({ onSuccess: (result) => { onSeries({ name: result.series.name, tree: result.tree }); toast.success(`${result.series.mails.length} E-Mails als Ablauf eingesetzt. ${sourceNote(result.source, (result as { note?: string }).note)}`); }, onError: (error) => toast.error(error.message) });
  const build = (next: BriefState, options: { count: number; waitDays: number; stopWhen: "replied" | "clicked" | "opened" | "never" }) => draft.mutate({ brief: next.brief, goal: next.goal, tone: next.tone, length: next.length, audience: next.audience || null, category: category ?? null, ctaUrl: next.ctaUrl || null, abTest: next.abTest, ...options });
  return <div className="ai-panel">
    <p className="text-xs text-slate-500">Nimm einen Vorschlag – oder beschreibe, worum es geht. Daraus entsteht die ganze Serie: Ansprache, Nachfassen, letzte Nachricht, mit Wartezeiten und Ende, sobald der Empfänger reagiert.</p>
    <AiMissingKeyNote />
    <Proposals series picked={picked} onPick={(proposal) => { setState(fromProposal(state, proposal)); setCount(proposal.count ?? 2); setWaitDays(proposal.waitDays ?? 3); setStopWhen(proposal.stopWhen ?? "replied"); setPicked(proposal.key); }} />
    {picked && <p className="ai-picked-note">Vorschlag übernommen – Beschreibung, Anzahl und Abstand kannst du jetzt noch anpassen. Gebaut wird erst, wenn du auf „Serie bauen“ klickst.</p>}
    <BriefFields state={state} onChange={(next) => { setState(next); if (picked && next.brief !== state.brief) setPicked(null); }} compact />
    <div className="ai-chip-row"><span className="eyebrow">E-MAILS</span><div className="dashboard-segments">{[2, 3, 4].map((value) => <button key={value} type="button" className={count === value ? "active" : ""} onClick={() => setCount(value)}>{value}</button>)}</div><span className="eyebrow">ABSTAND</span><div className="dashboard-segments">{[2, 3, 5, 7].map((value) => <button key={value} type="button" className={waitDays === value ? "active" : ""} onClick={() => setWaitDays(value)}>{value} Tage</button>)}</div><span className="eyebrow">ENDE WENN</span><div className="dashboard-segments">{([["replied", "geantwortet"], ["clicked", "geklickt"], ["opened", "geöffnet"], ["never", "nie"]] as const).map(([key, label]) => <button key={key} type="button" className={stopWhen === key ? "active" : ""} onClick={() => setStopWhen(key)}>{label}</button>)}</div></div>
    <div className="flex flex-wrap items-center justify-between gap-2"><small className="text-xs text-slate-500">Ersetzt den aktuellen Ablauf – erst nach Klick auf den Knopf. Jede E-Mail lässt sich danach im Builder anpassen.</small><Button className="flux-button" disabled={draft.isPending || state.brief.trim().length < 3} onClick={() => build(state, { count, waitDays, stopWhen })}><Wand2 /> {draft.isPending ? "Schreibt …" : "Serie bauen"}</Button></div>
  </div>;
}

/** Vorlagen vorschreiben lassen: ausgewählte Vorschläge landen als fertige Vorlagen (E-Mail oder Serie) unter „Vorlagen“. */
export function AiTemplatesPanel({ onCreated }: { onCreated: () => void }) {
  const categories = trpc.leadops.listCategories.useQuery(undefined, { retry: false });
  const [keys, setKeys] = useState<string[]>(() => TEMPLATE_PROPOSALS.map((proposal) => proposal.key));
  const [categoryId, setCategoryId] = useState<string>("");
  const [sender, setSender] = useState("");
  const write = trpc.leadops.createEmailTemplatesWithAi.useMutation({ onSuccess: (result) => { toast.success(`${result.created.length} Vorlage${result.created.length === 1 ? "" : "n"} angelegt. ${result.source === "ki" ? "Von der KI geschrieben – jede Vorlage lässt sich bearbeiten." : "Regelbasierte Entwürfe (ohne KI-Schlüssel) – Texte in der Vorlage anpassen."}`, { duration: 7000 }); onCreated(); }, onError: (error) => toast.error(error.message) });
  const toggle = (key: string) => setKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const category = (categories.data ?? []).find((row) => String(row.id) === categoryId)?.name ?? null;
  return <section className="surface-panel operations-panel ai-section p-5"><div className="flex flex-wrap items-start justify-between gap-2"><div><span className="eyebrow"><Sparkles className="inline h-3.5 w-3.5" /> VORLAGEN VORSCHREIBEN LASSEN</span><p className="mt-1 text-xs text-slate-500">Der Builder schreibt fertige Vorlagen für die typischen Anlässe – auf Wunsch zugeschnitten auf eine Lead-Kategorie (z. B. Photovoltaik). Danach stehen sie hier unter „Vorlagen“ und bei „Neue Kampagne“; jede lässt sich im Builder anpassen.</p></div></div>
    <div className="mt-3 grid gap-2 md:grid-cols-2"><label className="lead-action-field">Zugeschnitten auf<select className="lead-action-select" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Allgemein (alle Kategorien)</option>{(categories.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="lead-action-field">Unterschrift (optional)<Input placeholder="z. B. Taner Tanesco" value={sender} onChange={(event) => setSender(event.target.value)} /></label></div>
    <div className="ai-proposal-grid mt-3">{TEMPLATE_PROPOSALS.map((proposal) => { const active = keys.includes(proposal.key); return <button key={proposal.key} type="button" className={`ai-proposal is-check ${active ? "is-active" : ""}`} aria-pressed={active} onClick={() => toggle(proposal.key)} title={proposal.brief}><strong><span className="ai-check" aria-hidden="true">{active ? <Check className="h-3 w-3" /> : null}</span> {proposal.name}</strong><small>{proposal.hint}{proposal.kind === "serie" ? " · Serie" : " · eine E-Mail"}</small></button>; })}</div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><small className="text-xs text-slate-500">{keys.length} von {TEMPLATE_PROPOSALS.length} ausgewählt{category ? ` · für ${category}` : ""}. Mit KI-Schlüssel schreibt die KI, sonst kommt ein regelbasierter Entwurf.</small><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setKeys(keys.length === TEMPLATE_PROPOSALS.length ? [] : TEMPLATE_PROPOSALS.map((proposal) => proposal.key))}>{keys.length === TEMPLATE_PROPOSALS.length ? "Keine" : "Alle"}</Button><Button className="flux-button" disabled={write.isPending || !keys.length} onClick={() => write.mutate({ keys, category, sender: sender.trim() || null })}><Wand2 /> {write.isPending ? "Schreibt Vorlagen …" : `${keys.length} Vorlage${keys.length === 1 ? "" : "n"} schreiben`}</Button></div></div>
  </section>;
}
