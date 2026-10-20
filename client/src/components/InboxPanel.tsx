import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { PIPELINE_STAGES, stageLabel } from "../../../shared/sales-pipeline";
import { REACTION_LABEL, type SentReaction } from "../../../shared/sent-tracking";
import { Archive, ArchiveRestore, ArrowDownUp, Ban, CalendarDays, ChevronLeft, Inbox, Mail, Megaphone, Paperclip, RefreshCw, Reply, Search, ShieldCheck, Sparkles, Trash2, UserPlus, X } from "lucide-react";
import { ATTACHMENT_LIMITS, checkAttachments, formatBytes } from "../../../shared/email-signature";
import { INBOX_AI_FILTERS, inboxAiFilterLabel, periodRange, REPLY_KIND_LABEL, type InboxAiFilter, type InboxPeriod, type ReplyAction, type ReplyKind } from "../../../shared/reply-ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { confirmAction } from "@/lib/confirm";

type Filter = "alle" | "antworten" | "unbekannt" | "ungelesen" | "pruefen" | "gesendet" | "archiv" | "gesperrt";
/** Sortierung der Liste: nach Zeit oder nach KI-Einordnung (dann gruppiert von Interesse bis Beschwerde – oder umgekehrt). */
type InboxSort = "neu" | "alt" | "interesse" | "beschwerde";
const SORT_KEY = "tanesco.inbox-sort";
const KIND_ORDER: Array<{ key: ReplyKind | "ohne"; label: string }> = [{ key: "interessiert", label: "Interessiert" }, { key: "frage", label: "Frage" }, { key: "sonstiges", label: "Sonstiges" }, { key: "ohne", label: "Ohne Einordnung" }, { key: "abwesenheit", label: "Abwesenheitsnotiz" }, { key: "abmeldung", label: "Abmeldewunsch" }, { key: "beschwerde", label: "Beschwerde" }];
const loadSort = (): InboxSort => { try { const stored = window.localStorage.getItem(SORT_KEY); if (stored === "neu" || stored === "alt" || stored === "interesse" || stored === "beschwerde") return stored; } catch { /* ignorieren */ } return "neu"; };
type Pipeline = "ads" | "kaltakquise" | "email";
type LeadForm = { pipeline: Pipeline; stage: string; ownerUserId: string; categoryId: string; firstName: string; lastName: string; company: string; phone: string };

const FOLDERS: Array<{ key: Filter; label: string; hint: string }> = [
  { key: "alle", label: "Alle", hint: "Alle Nachrichten im Posteingang" },
  { key: "ungelesen", label: "Ungelesen", hint: "Noch nicht geöffnete Nachrichten" },
  { key: "antworten", label: "Antworten", hint: "Antworten auf E-Mail-Kampagnen" },
  { key: "unbekannt", label: "Nicht zugeordnet", hint: "Absender, die noch keinem Lead in der Pipeline zugeordnet sind – mit „Als Lead in Pipeline“ zuordnen" },
  { key: "pruefen", label: "Prüfen", hint: "Die KI ist sich nicht sicher: möglicherweise eine Beschwerde oder ein Abmeldewunsch – bitte kurz ansehen" },
  { key: "gesendet", label: "Gesendet", hint: "Alles, was wir verschickt haben: Kampagnen-Mails, Antworten aus dem Posteingang und Einzel-E-Mails" },
  { key: "archiv", label: "Archiv", hint: "Archivierte Nachrichten" },
  { key: "gesperrt", label: "Gesperrt", hint: "Nachrichten gesperrter Absender – die Adressen stehen auf der Sperrliste" },
];

const stamp = (value: Date | string) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dayStart = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
/** Zeit in der Liste: heute nur die Uhrzeit, gestern „Gestern“, sonst das Datum. */
function shortWhen(value: Date | string, now: Date) {
  const date = new Date(value); const diff = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (diff === 0) return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (diff === 1) return "Gestern";
  return date.toLocaleDateString("de-DE", date.getFullYear() === now.getFullYear() ? { day: "2-digit", month: "2-digit" } : { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function groupOf(value: Date | string, now: Date): "Heute" | "Gestern" | "Diese Woche" | "Älter" {
  const diff = Math.round((dayStart(now) - dayStart(new Date(value))) / 86_400_000);
  return diff <= 0 ? "Heute" : diff === 1 ? "Gestern" : diff < 7 ? "Diese Woche" : "Älter";
}
const initialsOf = (name: string | null, email: string) => {
  const parts = (name?.trim() || email.split("@")[0]).replace(/[._-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "")).toUpperCase();
};
const hueOf = (email: string) => { let hash = 0; for (const char of email.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0; return hash % 6; };

/** Merker in der Liste: nur, wenn die KI etwas Nennenswertes erkannt hat. */
function aiTag(ai: { kind: ReplyKind; confidence: number; action: ReplyAction } | null) {
  if (!ai || ai.kind === "sonstiges" || ai.kind === "frage") return null;
  if (ai.action === "pruefen") return <i className="inbox-tag is-check" title={`KI ist sich nicht sicher (${ai.confidence} %) – bitte prüfen`}>Prüfen: {REPLY_KIND_LABEL[ai.kind]}?</i>;
  if (ai.action === null) return null;
  const cls = ai.kind === "beschwerde" || ai.kind === "abmeldung" ? "is-optout" : ai.kind === "interessiert" ? "is-lead" : "is-muted";
  return <i className={`inbox-tag ${cls}`} title={`KI-Einordnung (${ai.confidence} %)`}>KI: {REPLY_KIND_LABEL[ai.kind]}</i>;
}
/** Satz im Lesebereich: was die KI erkannt hat und was daraufhin passiert ist. */
function aiSentence(ai: { kind: ReplyKind; confidence: number; quote: string | null; reason: string | null; source: "ki" | "regeln"; action: ReplyAction }) {
  const who = ai.source === "ki" ? "KI" : "Regelprüfung"; const label = REPLY_KIND_LABEL[ai.kind];
  const what = ai.action === "gesperrt" ? (ai.kind === "beschwerde" ? "Beschwerde erkannt – Absender automatisch gesperrt" : "Abmeldewunsch erkannt – Adresse automatisch auf die Sperrliste gesetzt") : ai.action === "pruefen" ? `möglicherweise ${label} – bitte prüfen` : ai.action === "geprueft" ? `${label} vermutet – als in Ordnung markiert` : ai.kind === "interessiert" ? "Antwort klingt interessiert – Notiz am Lead hinterlegt" : ai.kind === "abwesenheit" ? "Abwesenheitsnotiz – keine echte Antwort" : label;
  return <><strong>{who} ({ai.confidence} %):</strong> {what}{ai.quote ? <> – „{ai.quote}“</> : null}</>;
}
function periodText(period: InboxPeriod, range: { from: Date | null; to: Date | null }) {
  const day = (value: Date) => value.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  if (period === "heute") return "Nur heute"; if (period === "gestern") return "Nur gestern"; if (period === "7tage") return "Letzte 7 Tage"; if (period === "30tage") return "Letzte 30 Tage";
  if (range.from && range.to) return `${day(range.from)} bis ${day(new Date(range.to.getTime() - 1))}`; if (range.from) return `ab ${day(range.from)}`; if (range.to) return `bis ${day(new Date(range.to.getTime() - 1))}`; return "Eigener Zeitraum";
}
/** Posteingang: Antworten lesen, beantworten, Absender sperren oder als Lead in die Pipeline übernehmen. */
export default function InboxPanel({ onOpenLead }: { onOpenLead?: (publicId: string) => void } = {}) {
  const [filter, setFilter] = useState<Filter>("alle"); const [campaignId, setCampaignId] = useState<number | null>(null); const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState(""); const [replyText, setReplyText] = useState(""); const [leadForm, setLeadForm] = useState<LeadForm | null>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null); const now = useMemo(() => new Date(), []);
  const [period, setPeriod] = useState<InboxPeriod>("alle"); const [customFrom, setCustomFrom] = useState(""); const [customTo, setCustomTo] = useState("");
  const range = useMemo(() => periodRange(period, now, { from: customFrom || null, to: customTo || null }), [period, customFrom, customTo, now]);
  const [aiFilter, setAiFilter] = useState<InboxAiFilter | null>(null);
  const [sort, setSortState] = useState<InboxSort>(loadSort); const setSort = (next: InboxSort) => { setSortState(next); try { window.localStorage.setItem(SORT_KEY, next); } catch { /* ignorieren */ } };
  const inbox = trpc.leadops.listInbox.useQuery({ filter: filter === "gesendet" ? "alle" : filter, campaignId, from: range.from, to: range.to, aiKind: aiFilter }, { retry: false, enabled: filter !== "gesendet" });
  const owners = trpc.leadops.pipelineOwners.useQuery(undefined, { retry: false }); const categories = trpc.leadops.listCategories.useQuery(undefined, { retry: false }); const selectedPlatform = (inbox.data?.items ?? []).find((item) => item.id === selectedId)?.lead?.platform ?? null; const stageDefs = trpc.leadops.pipelineStages.useQuery({ source: leadForm?.pipeline ?? (selectedPlatform === "kaltakquise" ? "kaltakquise" : selectedPlatform === "email" ? "email" : "ads") }, { retry: false }); const stagesList = stageDefs.data ?? PIPELINE_STAGES; // Stufen der Pipeline, in die der Lead kommt
  const utils = trpc.useUtils(); const refresh = () => { utils.leadops.listInbox.invalidate(); utils.leadops.pipelineOverview.invalidate(); utils.leadops.listEmailCampaigns.invalidate(); utils.leadops.listEmailSuppressions.invalidate(); };
  const block = trpc.leadops.blockInboxSender.useMutation({ onSuccess: (result) => { toast.success(`${result.email} gesperrt – steht auf der Sperrliste${result.stopped ? `, ${result.stopped} laufende Serie${result.stopped === 1 ? "" : "n"} gestoppt` : ""}. ${result.messages} Nachricht${result.messages === 1 ? "" : "en"} liegen unter „Gesperrt“.`, { duration: 6000 }); setSelectedId(null); refresh(); }, onError: (error) => toast.error(error.message) });
  const unblock = trpc.leadops.unblockInboxSender.useMutation({ onSuccess: (result) => { toast.success(`${result.email} entsperrt – Sperre aufgehoben, Nachrichten wieder im Posteingang.`); setSelectedId(null); refresh(); }, onError: (error) => toast.error(error.message) });
  const sync = trpc.leadops.syncInbox.useMutation({ onSuccess: (result) => { const extra = result as { blocked?: number; flagged?: number; skipped?: number }; toast.success(`${result.scanned} Mails geprüft, ${result.added} neu, ${result.replies} Antworten auf Serien.${extra.skipped ? ` ${extra.skipped} von Fremden übersprungen.` : ""}${extra.blocked ? ` ${extra.blocked} Absender wegen Beschwerde automatisch gesperrt.` : ""}${extra.flagged ? ` ${extra.flagged} zum Prüfen markiert.` : ""}`, { duration: 7000 }); refresh(); }, onError: (error) => toast.error(error.message) });
  const [cleanOpen, setCleanOpen] = useState(false); // Menü „Aufräumen“: fremde Mails oder alles entfernen
  const clean = trpc.leadops.clearInbox.useMutation({ onSuccess: (result) => { toast.success(result.deleted ? `${result.deleted} ${result.deleted === 1 ? "E-Mail" : "E-Mails"} aus dem Posteingang entfernt.` : "Nichts zu entfernen."); setCleanOpen(false); refresh(); }, onError: (error) => toast.error(error.message) });
  const removeMessage = trpc.leadops.deleteInboxMessages.useMutation({ onSuccess: (result) => { toast.success(result.deleted === 1 ? "E-Mail gelöscht – sie kommt auch beim nächsten Abholen nicht wieder." : `${result.deleted} E-Mails gelöscht – sie kommen auch beim nächsten Abholen nicht wieder.`); setSelectedId(null); refresh(); }, onError: (error) => toast.error(error.message) });
  const resolveCheck = trpc.leadops.resolveInboxCheck.useMutation({ onSuccess: () => { toast.success("Als in Ordnung markiert."); refresh(); }, onError: (error) => toast.error(error.message) });
  const markRead = trpc.leadops.markInboxRead.useMutation({ onSuccess: () => refresh() });
  const archive = trpc.leadops.archiveInboxMessage.useMutation({ onSuccess: (_result, input) => { toast.success(input.archived ? "Archiviert." : "Zurück im Posteingang."); setSelectedId(null); refresh(); }, onError: (error) => toast.error(error.message) });
  const reply = trpc.leadops.replyInboxMessage.useMutation({ onSuccess: (result) => { const extra = (result as { attachments?: number }).attachments; toast.success(`${result.status === "gesendet" ? "Antwort gesendet" : "Antwort simuliert (kein Versand eingerichtet)"}${extra ? ` – mit ${extra} Anhang${extra === 1 ? "" : "ängen"}` : ""}.`); setReplyText(""); setFiles([]); refresh(); }, onError: (error) => toast.error(error.message) });
  const [files, setFiles] = useState<File[]>([]); const fileRef = useRef<HTMLInputElement>(null); // Anhänge für die Antwort
  const addFiles = (list: FileList | null) => { if (!list) return; const next = [...files, ...Array.from(list)].filter((file, index, all) => all.findIndex((other) => other.name === file.name && other.size === file.size) === index); const problem = checkAttachments(next.map((file) => ({ filename: file.name, contentType: file.type, contentBase64: "", size: file.size }))); if (problem) { toast.error(problem); return; } setFiles(next); };
  const readAsBase64 = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result ?? "").split(",")[1] ?? ""); reader.onerror = () => reject(new Error(`„${file.name}“ konnte nicht gelesen werden.`)); reader.readAsDataURL(file); });
  const createLead = trpc.leadops.createLeadFromInbox.useMutation({ onSuccess: (result) => { const mails = result.linked ? result.linked.incoming + result.linked.replies : 0; const thread = mails > 1 ? ` ${mails} E-Mails stehen im E-Mail-Verlauf der Karte.` : ""; toast.success(result.created ? `Lead ${result.publicId} angelegt – steht jetzt in der Pipeline.${thread}` : `Lead ${result.publicId} in die Pipeline übernommen.${thread}`); setLeadForm(null); refresh(); }, onError: (error) => toast.error(error.message) });
  const items = inbox.data?.items ?? []; const counts = inbox.data?.counts; const campaigns = inbox.data?.campaigns ?? [];
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => needle ? items.filter((item) => [item.fromName, item.fromEmail, item.subject, item.bodyText, item.campaignName].some((text) => text?.toLowerCase().includes(needle))) : items, [items, needle]);
  const groups = useMemo(() => {
    const byTime = (a: (typeof visible)[number], b: (typeof visible)[number]) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
    if (sort === "interesse" || sort === "beschwerde") { // nach Einordnung gruppiert, innerhalb neueste zuerst
      const order = sort === "interesse" ? KIND_ORDER : [...KIND_ORDER].reverse();
      return order.map((entry) => [`${entry.label}`, [...visible].filter((item) => (item.ai?.kind ?? "ohne") === entry.key).sort(byTime)] as [string, typeof visible]).filter(([, list]) => list.length > 0).map(([label, list]) => [`${label} (${list.length})`, list] as [string, typeof visible]);
    }
    const sorted = [...visible].sort(byTime); if (sort === "alt") sorted.reverse();
    const map = new Map<string, typeof visible>(); for (const item of sorted) { const key = groupOf(item.receivedAt, now); map.set(key, [...(map.get(key) ?? []), item]); } return Array.from(map.entries());
  }, [visible, now, sort]);
  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]); const selectedAi = selected?.ai ?? null;
  useEffect(() => { if (selected && !selected.isRead) markRead.mutate({ id: selected.id, isRead: true }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selected?.id]);
  useEffect(() => { setLeadForm(null); setReplyText(""); }, [selectedId]);
  const openLeadForm = () => { if (!selected) return; const guessed = (selected.fromName ?? selected.fromEmail.split("@")[0]).replace(/[._]/g, " ").trim().split(/\s+/); setLeadForm({ pipeline: selected.lead?.platform === "kaltakquise" ? "kaltakquise" : selected.lead?.platform === "email" || selected.campaignName ? "email" : "ads", stage: stagesList[1]?.key ?? stagesList[0]?.key ?? "kontaktiert", ownerUserId: "", categoryId: "", firstName: guessed.length > 1 ? guessed[0] : "", lastName: guessed.length > 1 ? guessed.slice(1).join(" ") : guessed[0] ?? "", company: selected.fromEmail.split("@")[1]?.split(".")[0] ?? "", phone: selected.phoneHint ?? "" }); };
  const focusReply = () => { replyRef.current?.focus(); replyRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); };
  const sendReply = async () => { if (!selected || !replyText.trim() || reply.isPending) return; try { const attachments = await Promise.all(files.map(async (file) => ({ filename: file.name, contentType: file.type || "application/octet-stream", contentBase64: await readAsBase64(file), size: file.size }))); reply.mutate({ messageId: selected.id, text: replyText, attachments }); } catch (error) { toast.error(error instanceof Error ? error.message : "Anhang konnte nicht gelesen werden."); } };
  const activeCampaign = campaignId ? campaigns.find((campaign) => campaign.id === campaignId) : null;
  const folderLabel = FOLDERS.find((folder) => folder.key === filter)?.label ?? "Alle";
  const selectClass = "mt-1 h-10 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100";
  const pipelineLink = (platform: string | null) => `/?page=Vertriebspipeline&quelle=${platform === "kaltakquise" ? "kaltakquise" : platform === "email" ? "email" : "ads"}`;

  const folderNav = <nav className="inbox-folders" aria-label="Ordner">{FOLDERS.map((folder) => <button key={folder.key} type="button" className={filter === folder.key ? "active" : ""} title={folder.hint} aria-pressed={filter === folder.key} onClick={() => { setFilter(folder.key); setSelectedId(null); }}>{folder.label}{counts && folder.key !== "archiv" && folder.key !== "gesendet" && (counts as Record<string, number>)[folder.key] > 0 ? <span className="inbox-count">{(counts as Record<string, number>)[folder.key]}</span> : null}</button>)}</nav>;
  if (filter === "gesendet") return <div className="inbox-shell"><div className="inbox-toolbar">{folderNav}</div><SentMessages onOpenLead={onOpenLead} /></div>;

  return <div className={`inbox-shell ${selected ? "has-selection" : ""}`}>
    <InboxDeliveryNotice onImported={refresh} />
    <div className="inbox-toolbar">
      <div className="inbox-folder-row">{folderNav}<div className="inbox-clean"><Button size="sm" variant="outline" className="inbox-clean-button" disabled={clean.isPending} title="Posteingang aufräumen: Mails von Fremden oder alles entfernen" aria-haspopup="menu" aria-expanded={cleanOpen} onClick={() => setCleanOpen((value) => !value)}><Trash2 /> Aufräumen</Button>{cleanOpen && <div className="inbox-clean-menu" role="menu"><button type="button" role="menuitem" onClick={async () => { if (await confirmAction("Alle Mails entfernen, die zu keinem Kontakt gehören (kein Lead, kein Kampagnen-Empfänger)? Zum Beispiel Rechnungen und Newsletter aus dem alten Postfach. Die Sperrliste bleibt.", { danger: true })) clean.mutate({ scope: "fremde" }); }}><strong>Nur Fremde entfernen</strong><small>Mails ohne Lead und ohne Kampagne – Rechnungen, Newsletter, Unbekannte</small></button><button type="button" role="menuitem" onClick={async () => { if (await confirmAction("Alle Antworten löschen – auf Kampagnen und auf Test-Mails (Betreff „Re:“/„AW:“)? Sie werden auch beim nächsten Abholen nicht wieder geladen. Kontakte und Sperrliste bleiben.", { danger: true })) clean.mutate({ scope: "antworten" }); }}><strong>Alle Antworten löschen</strong><small>Antworten auf Kampagnen und Test-Mails („Re:“, „AW:“) – kommen nicht wieder</small></button><button type="button" role="menuitem" onClick={async () => { if (await confirmAction("Wirklich den kompletten Posteingang leeren? Die gelöschten Mails werden auch beim nächsten Abholen nicht wieder geladen – nur neue Mails kommen dazu. Die Sperrliste bleibt.", { danger: true })) clean.mutate({ scope: "alle" }); }}><strong>Alles entfernen</strong><small>Posteingang komplett leeren – Sperrliste und „Gesendet“ bleiben</small></button></div>}</div><Button size="sm" variant="outline" className="inbox-sync" disabled={sync.isPending} title="Postfach abrufen (IMAP) – neue Antworten laden und von der KI einordnen lassen" onClick={() => sync.mutate()}><RefreshCw className={sync.isPending ? "animate-spin" : ""} /> Aktualisieren</Button></div>
      <div className="inbox-toolbar-tools">
        <label className="inbox-sort" title="Reihenfolge der Liste"><ArrowDownUp className="h-4 w-4" aria-hidden="true" /><select aria-label="Sortierung" value={sort} onChange={(event) => setSort(event.target.value as InboxSort)}><option value="neu">Neueste zuerst</option><option value="alt">Älteste zuerst</option><option value="interesse">Einordnung: Interesse zuerst</option><option value="beschwerde">Einordnung: Beschwerde zuerst</option></select></label>
        <label className="inbox-ai-filter" title="Nur Nachrichten mit einer bestimmten KI-Einordnung zeigen"><Sparkles className="h-4 w-4" aria-hidden="true" /><select aria-label="KI-Einordnung" value={aiFilter ?? ""} onChange={(event) => { setAiFilter((event.target.value || null) as InboxAiFilter | null); setSelectedId(null); }}><option value="">KI: alle Antworten</option>{INBOX_AI_FILTERS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <label className="inbox-period" title="Nur Nachrichten aus einem Zeitraum zeigen"><CalendarDays className="h-4 w-4" aria-hidden="true" /><select aria-label="Zeitraum" value={period} onChange={(event) => { setPeriod(event.target.value as InboxPeriod); setSelectedId(null); }}><option value="alle">Gesamter Zeitraum</option><option value="heute">Heute</option><option value="gestern">Gestern</option><option value="7tage">Letzte 7 Tage</option><option value="30tage">Letzte 30 Tage</option><option value="eigener">Eigener Zeitraum …</option></select></label>
        {period === "eigener" && <span className="inbox-period-custom"><input type="date" aria-label="Von" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} /><span>bis</span><input type="date" aria-label="Bis" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} /></span>}
        {(campaigns.length || campaignId) ? <label className="inbox-campaign-filter" title="Nur Antworten auf eine bestimmte Kampagne zeigen"><Megaphone className="h-4 w-4" aria-hidden="true" /><select aria-label="Nach Kampagne filtern" value={campaignId ?? ""} onChange={(event) => { setCampaignId(event.target.value ? Number(event.target.value) : null); setSelectedId(null); }}><option value="">Alle Kampagnen</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} ({campaign.count})</option>)}{campaignId && !campaigns.some((campaign) => campaign.id === campaignId) ? <option value={campaignId}>Gewählte Kampagne</option> : null}</select></label> : null}
      </div>
    </div>
    {(activeCampaign || period !== "alle" || aiFilter) && <div className="inbox-active-filter">{aiFilter ? <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> : activeCampaign ? <Megaphone className="h-3.5 w-3.5" aria-hidden="true" /> : <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />}<span>{[aiFilter ? `KI-Einordnung: ${inboxAiFilterLabel(aiFilter)}` : null, activeCampaign ? `Nur Antworten auf „${activeCampaign.name}“` : null, period !== "alle" ? periodText(period, range) : null].filter(Boolean).join(" · ")}</span><button type="button" onClick={() => { setCampaignId(null); setPeriod("alle"); setCustomFrom(""); setCustomTo(""); setAiFilter(null); }}>Filter entfernen</button></div>}
    <div className="inbox-grid">
      <section className="surface-panel inbox-list" aria-label="Nachrichtenliste">
        <div className="inbox-list-head"><label className="inbox-search"><Search className="h-4 w-4" aria-hidden="true" /><input type="search" value={query} placeholder={`In „${folderLabel}“ suchen`} aria-label="Nachrichten durchsuchen" onChange={(event) => setQuery(event.target.value)} />{query && <button type="button" aria-label="Suche leeren" onClick={() => setQuery("")}><X className="h-3.5 w-3.5" /></button>}</label>{needle ? <div className="inbox-search-hint">{visible.length} {visible.length === 1 ? "Treffer" : "Treffer"} für „{query.trim()}“</div> : null}</div>
        <div className="inbox-items">
          {!visible.length && <div className="inbox-list-empty">{inbox.isLoading ? <span>Wird geladen …</span> : needle ? <><strong>Nichts gefunden</strong><span>Keine Nachricht passt zu „{query.trim()}“.</span></> : aiFilter ? <><strong>Nichts mit dieser Einordnung</strong><span>In „{folderLabel}“ gibt es keine Nachricht mit „{inboxAiFilterLabel(aiFilter)}“.</span></> : activeCampaign ? <><strong>Keine Antworten</strong><span>Zu dieser Kampagne liegt in „{folderLabel}“ nichts vor.</span></> : <><strong>Keine Nachrichten in „{folderLabel}“</strong><span>„Aktualisieren“ liest das Postfach (Einstellungen → E-Mail-Versand → IMAP).</span></>}</div>}
          {groups.map(([group, list]) => <div key={group} className="inbox-group"><div className="inbox-group-label">{group}</div>{list.map((item) => <button key={item.id} type="button" className={`inbox-item ${item.id === selectedId ? "active" : ""} ${item.isRead ? "" : "is-unread"}`} aria-current={item.id === selectedId ? "true" : undefined} onClick={() => setSelectedId(item.id)}>
            <span className={`inbox-avatar av-${hueOf(item.fromEmail)}`} aria-hidden="true">{initialsOf(item.fromName, item.fromEmail)}</span>
            <span className="inbox-item-main">
              <span className="inbox-item-head"><strong>{item.fromName || item.fromEmail}</strong><time dateTime={new Date(item.receivedAt).toISOString()} title={stamp(item.receivedAt)}>{shortWhen(item.receivedAt, now)}</time></span>
              <span className="inbox-item-subject">{item.subject || "(kein Betreff)"}</span>
              <span className="inbox-item-preview">{item.bodyText.replace(/\s+/g, " ").slice(0, 110) || "(kein Text)"}</span>
              <span className="inbox-item-tags">{item.blocked ? <i className="inbox-tag is-blocked">Gesperrt</i> : item.optOut ? <i className="inbox-tag is-optout">Abgemeldet</i> : null}{item.campaignName && <i className="inbox-tag is-reply" title={`Antwort auf „${item.campaignName}“`}>Antwort: {item.campaignName}</i>}{item.lead ? <i className="inbox-tag is-lead" title={`In der Pipeline${item.lead.owner ? ` bei ${item.lead.owner}` : ""}`}>{item.lead.stage ? stageLabel(item.lead.stage, stagesList) : "Lead"}{item.lead.owner ? ` (${item.lead.owner})` : ""}</i> : !item.blocked ? <i className="inbox-tag is-open" title="Noch keinem Lead in der Pipeline zugeordnet">Nicht zugeordnet</i> : null}{aiTag(item.ai)}</span>
            </span>
          </button>)}</div>)}
        </div>
      </section>
      <section className="surface-panel inbox-read" aria-label="Nachricht">
        {!selected ? <div className="inbox-empty"><Inbox className="h-9 w-9" aria-hidden="true" /><strong>Keine Nachricht ausgewählt</strong><span>Wähle links eine Nachricht aus – oder lade neue Antworten aus dem Postfach.</span><Button size="sm" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}><RefreshCw /> Aktualisieren</Button></div> : <>
          <button type="button" className="inbox-back" onClick={() => setSelectedId(null)}><ChevronLeft className="h-4 w-4" /> Zurück zur Liste</button>
          <header className="inbox-read-head">
            <div className="inbox-read-from"><span className={`inbox-avatar is-big av-${hueOf(selected.fromEmail)}`} aria-hidden="true">{initialsOf(selected.fromName, selected.fromEmail)}</span><div className="inbox-read-who"><strong>{selected.fromName || selected.fromEmail}</strong><a href={`mailto:${selected.fromEmail}`}>{selected.fromEmail}</a></div><time className="inbox-read-time" dateTime={new Date(selected.receivedAt).toISOString()}>{stamp(selected.receivedAt)}</time></div>
            <h2>{selected.subject || "(kein Betreff)"}</h2>
            <div className="inbox-read-context">
              {selected.campaignName && <span className="inbox-note is-reply"><Megaphone className="h-3.5 w-3.5" aria-hidden="true" /> Antwort auf die Kampagne „{selected.campaignName}“</span>}
              {selected.lead && <a className="inbox-note is-lead" href={pipelineLink(selected.lead.platform)} title="Zur Vertriebspipeline"><UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> In der Pipeline: {selected.lead.stage ? stageLabel(selected.lead.stage, stagesList) : "Lead"}{selected.lead.owner ? ` bei ${selected.lead.owner}` : ""}{!selected.lead.phone ? " – ohne Telefonnummer" : ""}</a>}
              {selectedAi && selectedAi.action !== null && selectedAi.kind !== "sonstiges" ? <span className={`inbox-note is-ai ${selectedAi.action === "pruefen" ? "is-check" : selectedAi.kind === "beschwerde" || selectedAi.kind === "abmeldung" ? "is-optout" : selectedAi.kind === "interessiert" ? "is-lead" : ""}`}><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {aiSentence(selectedAi)}{selectedAi.action === "pruefen" && !selected.blocked ? <span className="inbox-note-actions"><button type="button" className="inbox-note-button is-danger" disabled={block.isPending} onClick={async () => { if (await confirmAction(`${selected.fromEmail} sperren? Die Adresse kommt auf die Sperrliste (keine Kampagnen-E-Mails mehr, laufende Serien stoppen).`, { danger: true, confirmLabel: "Ja, sperren" })) block.mutate({ messageId: selected.id, note: `Nach KI-Hinweis gesperrt: ${REPLY_KIND_LABEL[selectedAi.kind]} (${selectedAi.confidence} %)` }); }}>Sperren</button><button type="button" className="inbox-note-button" disabled={resolveCheck.isPending} onClick={() => resolveCheck.mutate({ id: selected.id })}>Ist in Ordnung</button></span> : null}</span> : null}
              {selected.blocked ? <span className="inbox-note is-blocked"><Ban className="h-3.5 w-3.5" aria-hidden="true" /> Absender gesperrt – steht auf der Sperrliste, bekommt keine Kampagnen-E-Mails mehr.</span> : selected.optOut ? <span className="inbox-note is-optout"><Ban className="h-3.5 w-3.5" aria-hidden="true" /> Abmeldung erkannt – Adresse steht auf der Sperrliste (Abmeldungen), laufende Serien gestoppt.</span> : selected.suppressed ? <span className="inbox-note is-blocked"><Ban className="h-3.5 w-3.5" aria-hidden="true" /> Adresse steht auf der Sperrliste – bekommt keine Kampagnen-E-Mails.</span> : null}
            </div>
            <div className="inbox-read-actions">
              {!selected.blocked && <Button size="sm" className="flux-button" onClick={openLeadForm}><UserPlus /> {selected.lead ? "Stufe setzen" : "Als Lead in Pipeline"}</Button>}
              <Button size="sm" variant="outline" onClick={focusReply}><Reply /> Antworten</Button>
              {selected.blocked ? <Button size="sm" variant="outline" disabled={unblock.isPending} onClick={() => unblock.mutate({ messageId: selected.id })}><ShieldCheck /> Entsperren</Button> : <Button size="sm" variant="outline" className="inbox-block" title="Absender auf die Sperrliste setzen (keine E-Mails mehr) und seine Nachrichten nach „Gesperrt“ verschieben" disabled={block.isPending} onClick={async () => { if (await confirmAction(`${selected.fromEmail} sperren? Die Adresse kommt auf die Sperrliste (keine Kampagnen-E-Mails mehr, laufende Serien stoppen) und alle Nachrichten dieses Absenders wandern nach „Gesperrt“.`, { danger: true, confirmLabel: "Ja, sperren" })) block.mutate({ messageId: selected.id }); }}><Ban /> Sperren</Button>}
              <Button size="sm" variant="ghost" className="inbox-archive" onClick={() => archive.mutate({ id: selected.id, archived: !selected.archived })}>{selected.archived ? <><ArchiveRestore /> Zurückholen</> : <><Archive /> Archivieren</>}</Button>
              <Button size="sm" variant="ghost" className="inbox-delete" disabled={removeMessage.isPending} title="E-Mail endgültig löschen – sie wird auch beim nächsten Abholen nicht wieder geladen" onClick={async () => { if (await confirmAction("Diese E-Mail endgültig löschen? Sie wird auch beim nächsten Abholen aus dem Postfach nicht wieder geladen. Der Kontakt und die Sperrliste bleiben unverändert.", { danger: true })) removeMessage.mutate({ ids: [selected.id] }); }}><Trash2 /> Löschen</Button>
            </div>
          </header>
          <div className="inbox-read-scroll">
          {leadForm && <div className="inbox-lead-form">
            <div className="inbox-lead-form-head"><strong>{selected.lead ? "Stufe in der Pipeline setzen" : "Als Lead in die Pipeline übernehmen"}</strong><button type="button" aria-label="Schließen" onClick={() => setLeadForm(null)}><X className="h-4 w-4" /></button></div>
            <div className="dashboard-segments inbox-lead-pipelines"><button type="button" className={leadForm.pipeline === "ads" ? "active" : ""} onClick={() => setLeadForm({ ...leadForm, pipeline: "ads" })}>Meta-Ads-Pipeline</button><button type="button" className={leadForm.pipeline === "kaltakquise" ? "active" : ""} onClick={() => setLeadForm({ ...leadForm, pipeline: "kaltakquise" })}>Kaltakquise-Pipeline</button><button type="button" className={leadForm.pipeline === "email" ? "active" : ""} onClick={() => setLeadForm({ ...leadForm, pipeline: "email" })}>E-Mail-Pipeline</button></div>
            <div className="inbox-lead-fields">
              <label className="text-xs text-slate-400">Stufe<select className={selectClass} value={leadForm.stage} onChange={(event) => setLeadForm({ ...leadForm, stage: event.target.value })}>{stagesList.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}</select></label>
              <label className="text-xs text-slate-400">Vertriebler<select className={selectClass} value={leadForm.ownerUserId} onChange={(event) => setLeadForm({ ...leadForm, ownerUserId: event.target.value })}><option value="">– offen –</option>{(owners.data ?? []).map((owner) => <option key={owner.userId} value={owner.userId}>{owner.name}</option>)}</select></label>
              {!selected.lead && <>
                <label className="text-xs text-slate-400">Vorname<Input className="mt-1" placeholder="Vorname" value={leadForm.firstName} onChange={(event) => setLeadForm({ ...leadForm, firstName: event.target.value })} /></label>
                <label className="text-xs text-slate-400">Nachname<Input className="mt-1" placeholder="Nachname" value={leadForm.lastName} onChange={(event) => setLeadForm({ ...leadForm, lastName: event.target.value })} /></label>
                <label className="text-xs text-slate-400">Firma<Input className="mt-1" placeholder="Firma" value={leadForm.company} onChange={(event) => setLeadForm({ ...leadForm, company: event.target.value })} /></label>
                <label className="text-xs text-slate-400">Telefon{selected.phoneHint && leadForm.phone === selected.phoneHint ? <span className="text-emerald-300"> – aus der E-Mail erkannt</span> : null}<Input className="mt-1" placeholder="Telefon (für den Dialer)" value={leadForm.phone} onChange={(event) => setLeadForm({ ...leadForm, phone: event.target.value })} /></label>
                <label className="text-xs text-slate-400 inbox-lead-wide">Kategorie<select className={selectClass} value={leadForm.categoryId} onChange={(event) => setLeadForm({ ...leadForm, categoryId: event.target.value })}><option value="">erste aktive</option>{(categories.data ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              </>}
              {selected.lead && !selected.lead.phone && <label className="text-xs text-slate-400 inbox-lead-wide">Telefon nachtragen – damit der Dialer in der Pipeline nutzbar ist{selected.phoneHint && leadForm.phone === selected.phoneHint ? <span className="text-emerald-300"> – aus der E-Mail erkannt</span> : null}<Input className="mt-1" placeholder="Telefon" value={leadForm.phone} onChange={(event) => setLeadForm({ ...leadForm, phone: event.target.value })} /></label>}
            </div>
            <div className="inbox-lead-form-actions"><Button className="flux-button" disabled={createLead.isPending} onClick={() => createLead.mutate({ messageId: selected.id, pipeline: leadForm.pipeline, stage: leadForm.stage, ownerUserId: leadForm.ownerUserId ? Number(leadForm.ownerUserId) : null, categoryId: leadForm.categoryId ? Number(leadForm.categoryId) : null, firstName: leadForm.firstName || null, lastName: leadForm.lastName || null, company: leadForm.company || null, phone: leadForm.phone || null })}>{selected.lead ? "Übernehmen" : "Lead anlegen"}</Button><Button variant="ghost" onClick={() => setLeadForm(null)}>Abbrechen</Button></div>
          </div>}
          <pre className="inbox-body">{selected.bodyText || "(kein Text)"}</pre>
          </div>
          <footer className="inbox-compose">
            <div className="inbox-compose-head"><Reply className="h-4 w-4" aria-hidden="true" /><span>Antwort an <strong>{selected.fromName || selected.fromEmail}</strong></span><small>{selected.fromEmail}</small></div>
            <textarea ref={replyRef} className="inbox-compose-text" rows={4} placeholder="Antwort schreiben …" value={replyText} onChange={(event) => setReplyText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) sendReply(); }} />
            {files.length > 0 && <ul className="inbox-attachments">{files.map((file) => <li key={`${file.name}-${file.size}`}><Paperclip className="h-3.5 w-3.5" aria-hidden="true" /><span>{file.name}</span><small>{formatBytes(file.size)}</small><button type="button" aria-label={`${file.name} entfernen`} onClick={() => setFiles(files.filter((item) => item !== file))}><X className="h-3.5 w-3.5" /></button></li>)}</ul>}
            <div className="inbox-compose-actions"><small>Strg + Enter sendet · Signatur aus den E-Mail-Einstellungen wird angehängt</small><div className="flex items-center gap-2"><input ref={fileRef} type="file" multiple className="hidden" onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} /><Button size="sm" variant="outline" type="button" title={`Dateien anhängen (max. ${ATTACHMENT_LIMITS.maxFiles}, je ${Math.round(ATTACHMENT_LIMITS.maxFileBytes / 1024 / 1024)} MB)`} onClick={() => fileRef.current?.click()}><Paperclip /> Anhang</Button><Button size="sm" className="flux-button" disabled={!replyText.trim() || reply.isPending} onClick={sendReply}><Reply /> {reply.isPending ? "Wird gesendet …" : "Senden"}</Button></div></div>
          </footer>
        </>}
      </section>
    </div>
  </div>;
}
export const InboxIcon = Mail;

/**
 * Ordner „Gesendet“: alles, was wir per E-Mail herausgeschickt haben – Kampagnen-Mails aus den Serien,
 * Antworten aus dem Posteingang und Einzel-E-Mails aus einer Karte. Filter: Art, Reaktion, Kampagne, Zeitraum, Suche.
 * Je Mail steht, an wen sie ging (Kontakt verlinkt) und was danach passiert ist: geöffnet, geklickt, geantwortet – mit Uhrzeit.
 * Klick auf die Zeile zeigt die E-Mail so, wie sie rausging.
 */
const whenShort = (value: Date | string) => { const date = new Date(value); const today = new Date(); const sameDay = date.toDateString() === today.toDateString(); return sameDay ? `heute ${date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : date.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const REACTION_FILTERS: SentReaction[] = ["geoeffnet", "geklickt", "geantwortet", "ohne", "bounce", "abgemeldet"];

function SentMessages({ onOpenLead }: { onOpenLead?: (publicId: string) => void }) {
  const [kind, setKind] = useState<"alle" | "kampagne" | "antwort" | "einzel">("alle");
  const [reaction, setReaction] = useState<SentReaction | null>(null);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [period, setPeriod] = useState<"alle" | "heute" | "7tage" | "30tage">("alle");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null); // Vorschau einer gesendeten E-Mail
  const range = (() => { const now = new Date(); const start = (days: number) => new Date(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - days * 86_400_000); return period === "heute" ? { from: start(0) } : period === "7tage" ? { from: start(6) } : period === "30tage" ? { from: start(29) } : {}; })();
  const sent = trpc.leadops.listSent.useQuery({ kind: kind === "alle" ? null : kind, reaction, campaignId, search: search.trim() || null, from: range.from ?? null }, { retry: false });
  const items = sent.data?.items ?? [];
  const label: Record<string, string> = { kampagne: "Kampagne", antwort: "Antwort", einzel: "Einzel-E-Mail" };
  const openLead = (publicId: string) => { if (onOpenLead) onOpenLead(publicId); else window.location.assign(`/?page=Vertriebspipeline&lead=${publicId}`); };
  return <div className="inbox-sent">
    <div className="inbox-sent-filters">
      <div className="dashboard-segments">{([["alle", `Alle${sent.data ? ` (${sent.data.counts.alle})` : ""}`], ["kampagne", `Kampagnen${sent.data ? ` (${sent.data.counts.kampagne})` : ""}`], ["antwort", `Antworten${sent.data ? ` (${sent.data.counts.antwort})` : ""}`], ["einzel", `Einzeln${sent.data ? ` (${sent.data.counts.einzel})` : ""}`]] as const).map(([key, text]) => <button key={key} type="button" className={kind === key ? "active" : ""} onClick={() => setKind(key)}>{text}</button>)}</div>
      <select className="lead-action-select" aria-label="Kampagne" value={campaignId ?? ""} onChange={(event) => setCampaignId(event.target.value ? Number(event.target.value) : null)}><option value="">Alle Kampagnen</option>{(sent.data?.campaigns ?? []).map((item) => <option key={item.id} value={item.id}>{item.name} ({item.count})</option>)}</select>
      <select className="lead-action-select" aria-label="Zeitraum" value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}><option value="alle">Gesamter Zeitraum</option><option value="heute">Heute</option><option value="7tage">Letzte 7 Tage</option><option value="30tage">Letzte 30 Tage</option></select>
      <input className="inbox-search" placeholder="Suchen: Adresse, Betreff, Kampagne" value={search} onChange={(event) => setSearch(event.target.value)} />
    </div>
    <div className="inbox-sent-reactions" role="group" aria-label="Nach Reaktion filtern"><span>Reaktion:</span>{REACTION_FILTERS.map((key) => <button key={key} type="button" className={`inbox-reaction-chip is-${key} ${reaction === key ? "is-active" : ""}`} onClick={() => setReaction(reaction === key ? null : key)}>{REACTION_LABEL[key]}{sent.data ? ` ${sent.data.reactions[key]}` : ""}</button>)}{reaction && <button type="button" className="inbox-reaction-reset" onClick={() => setReaction(null)}>alle</button>}</div>
    {sent.isLoading ? <p className="py-10 text-center text-sm text-slate-500">Wird geladen …</p>
      : !items.length ? <p className="py-10 text-center text-sm text-slate-500">Noch nichts gesendet{search || campaignId || kind !== "alle" || period !== "alle" || reaction ? " – oder keine Treffer für diese Filter" : ""}.</p>
      : <ul className="inbox-sent-list">{items.map((item) => <li key={item.id} className={`inbox-sent-row ${openId === item.id ? "is-open" : ""}`} role="button" tabIndex={0} title="Klick zeigt die E-Mail, wie sie rausging" onClick={() => setOpenId(openId === item.id ? null : item.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpenId(openId === item.id ? null : item.id); } }}>
          <div className="inbox-sent-main">
            <strong>{item.subject}</strong>
            <small>an {item.lead ? <button type="button" className="inbox-sent-contact" title="Kontakt öffnen" onClick={(event) => { event.stopPropagation(); openLead(item.lead!.publicId); }}>{item.lead.name}</button> : item.name ? <span>{item.name}</span> : null}{item.lead || item.name ? " · " : ""}{item.to}{item.campaignName ? ` · ${item.campaignName}` : ""}{item.sender ? ` · von ${item.sender}` : ""}</small>
            {item.kind !== "kampagne" && item.preview ? <p className="inbox-sent-preview">{item.preview}</p> : null}
            {(item as { attachments?: Array<{ filename: string; size: number }> }).attachments?.length ? <div className="inbox-sent-track">{(item as { attachments: Array<{ filename: string; size: number }> }).attachments.map((file) => <i key={file.filename} className="inbox-track-step is-done" title={formatBytes(file.size)}>📎 {file.filename}</i>)}</div> : null}
            {item.tracking && <div className="inbox-sent-track" aria-label="Was mit dieser E-Mail passiert ist">
              <i className={`inbox-track-step ${item.tracking.openedAt ? "is-done" : ""}`}>{item.tracking.openedAt ? `Geöffnet ${whenShort(item.tracking.openedAt)}` : "Nicht geöffnet"}</i>
              <i className={`inbox-track-step ${item.tracking.clickedAt ? "is-done" : ""}`}>{item.tracking.clickedAt ? `Geklickt ${whenShort(item.tracking.clickedAt)}` : "Kein Klick"}</i>
              <i className={`inbox-track-step ${item.tracking.repliedAt ? "is-done is-reply" : ""}`}>{item.tracking.repliedAt ? `Geantwortet ${whenShort(item.tracking.repliedAt)}` : "Keine Antwort"}</i>
              {item.tracking.bouncedAt && <i className="inbox-track-step is-bad">Unzustellbar {whenShort(item.tracking.bouncedAt)}</i>}
              {item.tracking.unsubscribedAt && <i className="inbox-track-step is-bad">Abgemeldet {whenShort(item.tracking.unsubscribedAt)}</i>}
            </div>}
          </div>
          <div className="inbox-sent-meta">
            <i className={`inbox-tag is-${item.kind}`}>{label[item.kind] ?? item.kind}</i>
            {item.tracking ? <i className={`inbox-tag inbox-reaction is-${item.tracking.reaction}`}>{REACTION_LABEL[item.tracking.reaction]}</i> : null}
            {item.status !== "gesendet" ? <i className="inbox-tag is-blocked">{item.status}</i> : null}
            <time>{new Date(item.at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
          </div>
          {openId === item.id && <div className="inbox-sent-preview-wrap" onClick={(event) => event.stopPropagation()}><SentMailPreview id={item.id} onClose={() => setOpenId(null)} /></div>}
        </li>)}</ul>}
  </div>;
}

/** Vorschau einer gesendeten E-Mail: Kampagnen-Mails werden aus dem Schritt und den Empfängerdaten nachgebaut, Einzel-Mails aus dem gespeicherten Text. */
function SentMailPreview({ id, onClose }: { id: string; onClose: () => void }) {
  const preview = trpc.leadops.sentMailPreview.useQuery({ id }, { retry: false });
  if (preview.isLoading) return <p className="py-6 text-center text-sm text-slate-500">Vorschau wird geladen …</p>;
  if (preview.error || !preview.data) return <p className="py-6 text-center text-sm text-rose-300">{preview.error?.message ?? "Vorschau nicht möglich."}</p>;
  const mail = preview.data;
  return <div className="sent-preview">
    <div className="sent-preview-head">
      <div><strong>{mail.subject || "(ohne Betreff)"}</strong><small>an {mail.name ? `${mail.name} · ` : ""}{mail.to} · {new Date(mail.at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}{mail.campaignName ? ` · ${mail.campaignName}` : ""}</small>{mail.note ? <small className="sent-preview-note">{mail.note}</small> : null}</div>
      <button type="button" className="text-xs text-violet-200 hover:underline" onClick={onClose}>schließen</button>
    </div>
    <iframe title={`Gesendete E-Mail: ${mail.subject}`} className="sent-preview-frame" srcDoc={mail.html} sandbox="allow-same-origin" />
  </div>;
}

/**
 * Hinweise, damit keine Antwort verloren geht:
 *  - Antworten gehen an eine andere Adresse als das Abhol-Postfach → Warnung mit Weg zur Einstellung.
 *  - Beim Abholen übersprungene Absender (unbekannt) → Liste mit „Übernehmen“: holt die Mails dieses Absenders sofort herein.
 */
function InboxDeliveryNotice({ onImported }: { onImported: () => void }) {
  const settings = trpc.leadops.getMailSettings.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const skipped = trpc.leadops.inboxSkippedSenders.useQuery(undefined, { retry: false, refetchInterval: 60_000 });
  const utils = trpc.useUtils();
  const take = trpc.leadops.syncInbox.useMutation({ onSuccess: (result, variables) => { toast.success(result.added ? `${result.added} E-Mail${result.added === 1 ? "" : "s"} von ${variables?.allowSenders?.join(", ")} übernommen.` : "Keine neue E-Mail von diesem Absender gefunden."); utils.leadops.inboxSkippedSenders.invalidate(); onImported(); }, onError: (error) => toast.error(error.message) });
  const routing = (settings.data as { replyRouting?: { ok: boolean; note: string | null } } | undefined)?.replyRouting;
  const items = skipped.data?.items ?? [];
  if ((!routing || routing.ok) && !items.length) return null;
  return <div className="inbox-notices">
    {routing && !routing.ok && routing.note && <div className="inbox-notice is-warn"><strong>Antworten kommen evtl. nicht hier an</strong><span>{routing.note} Bitte unter Einstellungen → E-Mail-Versand „Antwort an“ auf das Abhol-Postfach setzen.</span></div>}
    {items.length > 0 && <div className="inbox-notice"><strong>{items.length} Absender beim Abholen übersprungen</strong><span>Diese Mails kamen von Adressen, die keinem Kontakt gehören. Wenn eine Antwort dabei ist, mit „Übernehmen“ hereinholen.</span>
      <ul>{items.slice(0, 8).map((item) => <li key={item.email}><span className="inbox-notice-who"><b>{item.name || item.email}</b>{item.name ? <small>{item.email}</small> : null}{item.subject ? <small>„{item.subject}“{item.count > 1 ? ` · ${item.count} Mails` : ""}</small> : null}</span><button type="button" className="cj-btn" disabled={take.isPending} onClick={() => take.mutate({ allowSenders: [item.email] })}>Übernehmen</button></li>)}</ul>
    </div>}
  </div>;
}
