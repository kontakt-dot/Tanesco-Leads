import { trpc } from "@/lib/trpc";
import { confirmAction } from "@/lib/confirm";
import { Check, ChevronRight, ExternalLink, Globe, MailX, PenLine, RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DRAFT_APPROACHES, draftToBlocks, type DraftApproach, type EmailNode } from "../../../shared/email-campaigns";

/**
 * Erst-E-Mails einzeln schreiben & freigeben: links alle Kontakte, deren erste E-Mail noch nicht raus ist, rechts der
 * Entwurf (KI oder Vorlage) zum Lesen, Ändern und Freigeben. Freigegebene E-Mails gehen im Minutentakt raus –
 * innerhalb von Versandfenster, Drip und Tageslimit.
 */
type Item = { id: number; email: string; name: string | null; company: string | null; city: string | null; listName: string | null; publicId: string | null; website?: string | null; draftSubject: string | null; draftText: string | null; draftState: "entwurf" | "freigegeben" | null; draftSource: string | null; draftOptions?: Array<{ key: DraftApproach; label: string; subject: string; text: string }>; draftApproach?: DraftApproach | null; draftAt: string | Date | null };
type Filter = "alle" | "offen" | "entwurf" | "freigegeben";
const FILTERS: Array<[Filter, string]> = [["alle", "Alle"], ["offen", "Ohne Entwurf"], ["entwurf", "Zu prüfen"], ["freigegeben", "Freigegeben"]];
const initialsOf = (text: string) => text.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
const stateOf = (item: Item): Filter => item.draftState === "freigegeben" ? "freigegeben" : item.draftState === "entwurf" ? "entwurf" : "offen";
const STATE_LABEL: Record<Filter, string> = { alle: "", offen: "Kein Entwurf", entwurf: "Zu prüfen", freigegeben: "Freigegeben – geht raus" };

export default function CampaignReviewPanel({ campaignId, onClose, onOpenLead }: { campaignId: number; onClose: () => void; onOpenLead?: (publicId: string) => void }) {
  const utils = trpc.useUtils();
  const queue = trpc.leadops.campaignReviewQueue.useQuery({ campaignId }, { retry: false, refetchInterval: 20_000 });
  const daily = trpc.leadops.campaignDailyStatus.useQuery(undefined, { retry: false, refetchInterval: 60_000 });
  const refresh = () => { void utils.leadops.campaignReviewQueue.invalidate({ campaignId }); void utils.leadops.getEmailCampaign.invalidate({ id: campaignId }); void utils.leadops.listEmailCampaigns.invalidate(); };
  const generate = trpc.leadops.generateCampaignDrafts.useMutation({ onSuccess: (result) => { refresh(); if (result.failed) toast.error(`${result.failed} Entwurf${result.failed === 1 ? "" : "e"} konnte${result.failed === 1 ? "" : "n"} nicht geschrieben werden.`); }, onError: (error) => toast.error(error.message) });
  const save = trpc.leadops.saveCampaignDraft.useMutation({ onError: (error) => toast.error(error.message) });
  const approveAll = trpc.leadops.approveAllCampaignDrafts.useMutation({ onSuccess: (result, variables) => { const out = result as { approved?: number; reverted?: number; withoutDraft?: number; templateOnly?: number }; if (variables.approve && out.templateOnly) toast.warning(`${out.templateOnly} Entwurf${out.templateOnly === 1 ? " ist" : "e sind"} nur Ersatz aus der Vorlage – die KI hat dort nicht geschrieben. Nicht freigegeben: „Alle neu schreiben“ versucht es erneut, oder einzeln prüfen und freigeben.`, { duration: 10000 }); toast.success(variables.approve ? `${out.approved ?? 0} E-Mail${(out.approved ?? 0) === 1 ? "" : "s"} freigegeben – sie gehen mit dem nächsten Lauf raus.${out.withoutDraft ? ` ${out.withoutDraft} ohne fertigen Entwurf bleiben offen – erst „Nächste Entwürfe schreiben“.` : ""}` : `${out.reverted ?? 0} Freigabe${(out.reverted ?? 0) === 1 ? "" : "n"} zurückgenommen – die E-Mails warten wieder auf dich.`, { duration: 8000 }); refresh(); }, onError: (error) => toast.error(error.message) });
  const reset = trpc.leadops.resetCampaignDrafts.useMutation({ onSuccess: (result) => { toast.success(result.reset ? `${result.reset} Entwurf${result.reset === 1 ? "" : "e"} verworfen – die KI schreibt sie jetzt nach den aktuellen Regeln neu (beim Auswählen oder über „Nächste Entwürfe schreiben“).` : "Es gab keine Entwürfe zum Verwerfen."); loadedSig.current = null; edits.current = {}; refresh(); }, onError: (error) => toast.error(error.message) });
  const stop = trpc.leadops.stopRecipientInCampaign.useMutation({ onSuccess: () => { toast.success("Aus dem E-Mail-Funnel genommen."); refresh(); }, onError: (error) => toast.error(error.message) });
  const [filter, setFilter] = useState<Filter>("alle");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [subject, setSubject] = useState(""); const [text, setText] = useState(""); const loadedSig = useRef<string | null>(null);
  const [approach, setApproach] = useState<DraftApproach | null>(null); const edits = useRef<Record<string, { subject: string; text: string }>>({}); // je Ansatz die eigenen Änderungen merken
  const [generatingIds, setGeneratingIds] = useState<Set<number>>(new Set());
  const campaign = trpc.leadops.getEmailCampaign.useQuery({ id: campaignId }, { retry: false });
  const [showPreview, setShowPreview] = useState(true);
  const [deferred, setDeferred] = useState<{ subject: string; text: string }>({ subject: "", text: "" }); // Vorschau folgt dem Tippen mit kurzer Verzögerung

  const items = useMemo(() => (queue.data?.items ?? []) as Item[], [queue.data]);
  const visible = items.filter((item) => filter === "alle" || stateOf(item) === filter);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const counts = queue.data?.counts ?? { offen: 0, entwurf: 0, freigegeben: 0 };
  const portal = (queue.data as { portalCheck?: { checked: number; found: number; cleaned: number; reset: number } } | undefined)?.portalCheck ?? null;
  // Vorschau: der Entwurf in der echten E-Mail – Design und Footer/Signatur aus dem Builder
  useEffect(() => { const timer = setTimeout(() => setDeferred({ subject, text }), 600); return () => clearTimeout(timer); }, [subject, text]);
  const previewNode = useMemo(() => { const tree = campaign.data?.tree; if (!tree || !selected) return null; const nodeId = (selected as { nodeId?: string | null }).nodeId ?? null; const node = tree.nodes.find((item): item is Extract<EmailNode, { type: "send" }> => item.type === "send" && (nodeId ? item.id === nodeId : true)); if (!node || !deferred.text.trim()) return null; return { ...node, subject: deferred.subject.trim() || node.subject, subjectB: null, blocks: draftToBlocks(deferred.text, node.blocks) }; }, [campaign.data, selected, deferred]);
  const preview = trpc.leadops.previewEmailNode.useQuery({ node: previewNode as never, design: (campaign.data?.design ?? {}) as Record<string, unknown>, sparte: (campaign.data as { sparte?: { label: string } } | undefined)?.sparte?.label ?? null }, { retry: false, enabled: Boolean(previewNode && showPreview), placeholderData: (previous) => previous });

  // Auswahl: erster Kontakt, der noch nicht freigegeben ist
  useEffect(() => { if (selectedId !== null && items.some((item) => item.id === selectedId)) return; const next = items.find((item) => item.draftState !== "freigegeben") ?? items[0] ?? null; setSelectedId(next?.id ?? null); }, [items, selectedId]);
  // Entwurf in die Felder laden, sobald ein anderer Kontakt gewählt wird oder sein Entwurf ankommt
  useEffect(() => { if (!selected) return; const sig = `${selected.id}|${String(selected.draftAt ?? "")}|${selected.draftSubject ?? ""}|${(selected.draftText ?? "").length}`; if (loadedSig.current !== sig) { loadedSig.current = sig; edits.current = {}; setApproach(selected.draftApproach ?? selected.draftOptions?.[0]?.key ?? null); setSubject(selected.draftSubject ?? ""); setText(selected.draftText ?? ""); } }, [selected]);
  // Ohne Entwurf: KI schreibt ihn beim Auswählen – und die nächsten zwei gleich mit, damit es flüssig weitergeht
  const generateFor = (ids: number[]) => { const fresh = ids.filter((id) => !generatingIds.has(id)); if (!fresh.length) return; setGeneratingIds((current) => { const next = new Set(current); for (const id of fresh) next.add(id); return next; }); generate.mutate({ campaignId, recipientIds: fresh }, { onSettled: () => setGeneratingIds((current) => { const next = new Set(current); for (const id of fresh) next.delete(id); return next; }) }); };
  useEffect(() => { if (!selected || queue.isFetching) return; const pending = [selected, ...items.filter((item) => item.id !== selected.id && !item.draftState).slice(0, 2)].filter((item) => !item.draftState && !generatingIds.has(item.id)).map((item) => item.id); if (pending.length) generateFor(pending); }, [selected?.id, queue.isFetching]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = selected ? subject !== (selected.draftSubject ?? "") || text !== (selected.draftText ?? "") : false;
  const goNext = () => { const index = visible.findIndex((item) => item.id === selectedId); const next = visible.slice(index + 1).find((item) => item.draftState !== "freigegeben") ?? visible.find((item) => item.id !== selectedId && item.draftState !== "freigegeben") ?? null; setSelectedId(next?.id ?? null); };
  const switchTo = (key: DraftApproach) => { if (!selected || key === approach) return; if (approach) edits.current[approach] = { subject, text }; const option = selected.draftOptions?.find((item) => item.key === key); const kept = edits.current[key]; setApproach(key); setSubject(kept?.subject ?? option?.subject ?? ""); setText(kept?.text ?? option?.text ?? ""); };
  const approve = () => { if (!selected) return; save.mutate({ recipientId: selected.id, subject, text, approve: true, approach }, { onSuccess: () => { toast.success(`Freigegeben – geht an ${selected.name || selected.email} raus.`); refresh(); goNext(); } }); };
  const keep = () => { if (!selected) return; save.mutate({ recipientId: selected.id, subject, text, approve: false, approach }, { onSuccess: () => { toast.success("Entwurf gespeichert."); refresh(); } }); };
  const unapprove = () => { if (!selected) return; save.mutate({ recipientId: selected.id, subject, text, approve: false, approach }, { onSuccess: () => { toast.success("Freigabe zurückgenommen – die E-Mail wartet wieder."); refresh(); } }); };
  const isGenerating = selected ? generatingIds.has(selected.id) : false;

  return <section className="rv-panel" aria-label="E-Mails freigeben">
    <header className="rv-head">
      <div><h2><PenLine className="h-4 w-4" aria-hidden="true" /> E-Mails freigeben</h2><p>{items.length ? <>{counts.entwurf + counts.offen} warten auf dich · {counts.freigegeben} freigegeben{daily.data ? <> · heute {daily.data.sent} von {daily.data.limit} Kampagnen-Mails gesendet</> : null}</> : "Alle Erst-E-Mails sind freigegeben oder schon raus."}</p></div>
      <div className="rv-head-actions">{counts.offen > 0 && <button type="button" className="campaign-act" disabled={generate.isPending} onClick={() => generate.mutate({ campaignId, limit: 5 })}><Sparkles className="h-3.5 w-3.5" /> {generate.isPending ? "KI schreibt …" : `Nächste ${Math.min(5, counts.offen)} Entwürfe schreiben`}</button>}{counts.entwurf > 0 && <button type="button" className="campaign-act is-primary" disabled={approveAll.isPending} title="Alle fertigen Entwürfe auf einen Klick freigeben – ohne einzeln durchzulesen" onClick={async () => { if (await confirmAction(`Alle ${counts.entwurf} fertigen Entwürfe dieser Kampagne freigeben? Sie gehen dann ohne weitere Prüfung raus (innerhalb des Tageslimits).`, { confirmLabel: "Ja, alle freigeben" })) approveAll.mutate({ campaignId, approve: true }); }}><Check className="h-3.5 w-3.5" /> {approveAll.isPending ? "Gibt frei …" : `Alle ${counts.entwurf} freigeben`}</button>}{counts.freigegeben > 0 && <button type="button" className="campaign-act" disabled={approveAll.isPending} title="Alle Freigaben zurücknehmen – die E-Mails warten wieder, bis du sie einzeln durchgelesen hast" onClick={() => approveAll.mutate({ campaignId, approve: false })}><RefreshCw className="h-3.5 w-3.5" /> Alle wieder prüfen ({counts.freigegeben})</button>}{(counts.entwurf + counts.freigegeben) > 0 && <button type="button" className="campaign-act" disabled={reset.isPending} title="Alle noch nicht gesendeten Entwürfe (auch freigegebene) verwerfen – die KI schreibt sie mit den aktuellen Regeln neu" onClick={async () => { if (await confirmAction(`Alle ${counts.entwurf + counts.freigegeben} noch nicht gesendeten Entwürfe dieser Kampagne verwerfen und neu schreiben lassen? Eigene Änderungen an den Texten gehen dabei verloren.`, { confirmLabel: "Ja, alle neu schreiben" })) reset.mutate({ campaignId }); }}><RotateCcw className="h-3.5 w-3.5" /> {reset.isPending ? "Verwirft …" : "Alle neu schreiben"}</button>}<button type="button" className="campaign-act" onClick={onClose}><X className="h-3.5 w-3.5" /> Schließen</button></div>
    </header>
    {portal && portal.checked > 0 && <p className={`rv-portal ${portal.found ? "is-bad" : ""}`}>{portal.found ? `Achtung: ${portal.found} Entwurf${portal.found === 1 ? "" : "e"} erwähnt Aroundhome – bitte „Alle neu schreiben“.` : `Geprüft: keiner der ${portal.checked} Entwürfe erwähnt Aroundhome – weder Text, Betreff noch Alternativ-Vorschläge.`}{portal.cleaned || portal.reset ? ` Eben bereinigt: ${portal.cleaned ? `${portal.cleaned} Entwurf${portal.cleaned === 1 ? "" : "e"} gesäubert` : ""}${portal.cleaned && portal.reset ? ", " : ""}${portal.reset ? `${portal.reset} mit Aroundhome im Betreff verworfen (werden neu geschrieben)` : ""}.` : ""}</p>}
    {daily.data && daily.data.left === 0 && <p className="rv-limit">Das Tageslimit von {daily.data.limit} E-Mails ist für heute erreicht – freigegebene E-Mails gehen ab morgen raus. Das Limit änderst du unter Einstellungen → E-Mail-Versand.</p>}
    <div className="cd-filters" role="tablist" aria-label="Nach Stand filtern">{FILTERS.map(([key, label]) => { const count = key === "alle" ? items.length : counts[key]; return <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? "is-active" : ""} onClick={() => setFilter(key)}>{label}<i>{count}</i></button>; })}</div>
    <div className="rv-grid">
      <ol className="rv-list">
        {!visible.length && <li className="cd-empty">{queue.isLoading ? "Wird geladen …" : "Niemand in dieser Gruppe."}</li>}
        {visible.map((item) => { const name = item.name || item.email; const state = stateOf(item); return <li key={item.id}><button type="button" className={`rv-item ${item.id === selectedId ? "is-active" : ""} is-${state}`} onClick={() => setSelectedId(item.id)}>
          <span className="cd-avatar" aria-hidden="true">{initialsOf(name)}</span>
          <span className="cd-who"><strong>{name}</strong><small>{[item.company, item.city].filter(Boolean).join(" · ") || item.email}</small>{(item as { nodeLabel?: string | null; followUp?: boolean }).nodeLabel && <small className="rv-step">{(item as { followUp?: boolean }).followUp ? "Nachfass: " : ""}„{(item as { nodeLabel?: string | null }).nodeLabel}“</small>}</span>
          <span className="rv-state">{generatingIds.has(item.id) ? <em className="is-busy"><Sparkles className="h-3 w-3" /> KI schreibt …</em> : state === "freigegeben" ? <em className="is-ok"><Check className="h-3 w-3" /> Freigegeben</em> : state === "entwurf" ? <em className="is-draft">Zu prüfen</em> : <em className="is-none">Kein Entwurf</em>}{item.listName && <small>{item.listName}</small>}</span>
        </button></li>; })}
      </ol>
      <div className="rv-editor">
        {!selected ? <p className="cd-empty">Links einen Kontakt wählen.</p> : <>
          <div className="rv-editor-head">
            <div className="rv-editor-who"><strong>{selected.name || selected.email}</strong><small>{selected.email}{selected.company ? ` · ${selected.company}` : ""}{selected.city ? ` · ${selected.city}` : ""}{selected.listName ? ` · Liste „${selected.listName}“` : ""}{selected.website ? ` · ${selected.website.replace(/^https?:\/\//i, "").replace(/\/$/, "")}` : ""}</small></div>
            <div className="rv-editor-tools">{selected.publicId && onOpenLead && <button type="button" className="cj-btn" title="Karte in der Pipeline öffnen" onClick={() => onOpenLead(selected.publicId!)}><ExternalLink className="h-3.5 w-3.5" /> Karte</button>}<button type="button" className="cj-btn" disabled={isGenerating || save.isPending} title="Die KI schreibt einen neuen Entwurf für diesen Kontakt" onClick={() => generateFor([selected.id])}><RefreshCw className={`h-3.5 w-3.5 ${isGenerating ? "animate-spin" : ""}`} /> {selected.draftState ? "KI neu schreiben" : "KI-Entwurf"}</button><button type="button" className="cj-btn is-danger" disabled={stop.isPending} title="Aus dem E-Mail-Funnel nehmen – keine E-Mail an diesen Kontakt" onClick={async () => { if (await confirmAction(`${selected.name || selected.email} aus dem E-Mail-Funnel nehmen? Es geht keine E-Mail raus.`, { confirmLabel: "Aus Funnel nehmen" })) stop.mutate({ recipientId: selected.id }); }}><MailX className="h-3.5 w-3.5" /></button></div>
          </div>
          {selected.draftState === "freigegeben" && <p className="rv-note is-ok"><Check className="h-3.5 w-3.5" /> Freigegeben – geht beim nächsten Versandlauf raus (Versandfenster, Drip und Tageslimit gelten). Änderungen hier nehmen die Freigabe zurück.</p>}
          {isGenerating && !selected.draftText && <p className="rv-note is-busy"><Sparkles className="h-3.5 w-3.5" /> Die KI {selected.website ? "liest die Webseite und " : ""}schreibt gerade die persönliche E-Mail für {selected.company || selected.name || "diesen Kontakt"} …</p>}
          {selected.draftSource === "vorlage" && <p className="rv-note is-template">Ersatz aus der Vorlage – die KI hat für diesen Kontakt keinen eigenen Text geschrieben. „Neu schreiben“ versucht es erneut. Wird bei „Alle freigeben“ nicht mit freigegeben.</p>}
          {selected.draftSource === "kiweb" && selected.website && <p className="rv-note is-web"><Globe className="h-3.5 w-3.5" /> Die KI hat dafür die Webseite <a href={/^https?:/i.test(selected.website) ? selected.website : `https://${selected.website}`} target="_blank" rel="noreferrer">{selected.website.replace(/^https?:\/\//i, "").replace(/\/$/, "")}</a> gelesen – bitte kurz prüfen, ob die Angaben stimmen.</p>}{selected.draftSource === "ki" && selected.draftState && <p className="rv-note">{selected.website ? <>Die Webseite {selected.website.replace(/^https?:\/\//i, "")} war nicht erreichbar – Entwurf nur aus den Daten des Kontakts.</> : "Keine Webseite bekannt – Entwurf nur aus den Daten des Kontakts. Tipp: Spalte „Webseite“ in der Liste mitgeben."}</p>}{selected.draftSource === "vorlage" && selected.draftState && <p className="rv-note">Entwurf aus der Vorlage mit den Daten des Kontakts – ohne KI-Schlüssel schreibt die KI nicht selbst. Du kannst den Text hier frei anpassen.</p>}
          {(selected.draftOptions?.length ?? 0) > 1 && <div className="rv-approaches" role="tablist" aria-label="Ansatz wählen">{DRAFT_APPROACHES.filter((item) => selected.draftOptions?.some((option) => option.key === item.key)).map((item) => <button key={item.key} type="button" role="tab" aria-selected={approach === item.key} className={approach === item.key ? "is-active" : ""} title={item.hint} onClick={() => switchTo(item.key)}><strong>{item.label}</strong><small>{item.hint}</small></button>)}</div>}
          <label className="rv-field">Betreff<input value={subject} placeholder="Betreff dieser E-Mail" onChange={(event) => setSubject(event.target.value)} /></label>
          <label className="rv-field">E-Mail-Text<textarea value={text} rows={14} placeholder={isGenerating ? "KI schreibt …" : "Persönlicher Text für diesen Kontakt – Grußformel ohne Namen, die Signatur hängt das System an."} onChange={(event) => setText(event.target.value)} /></label>
          <div className="rv-preview">
            <button type="button" className="rv-preview-toggle" aria-expanded={showPreview} onClick={() => setShowPreview((value) => !value)}>{showPreview ? "▾" : "▸"} So kommt die E-Mail an – mit Design und Footer aus dem Builder{selected.draftState !== "freigegeben" && showPreview ? "" : ""}</button>
            {showPreview && (preview.data?.html ? <iframe className="rv-preview-frame" title="Vorschau der E-Mail" sandbox="" srcDoc={preview.data.html} /> : <p className="rv-preview-empty">{previewNode ? "Vorschau wird geladen …" : "Noch kein Text – die Vorschau erscheint, sobald ein Entwurf da ist."}</p>)}
          </div>
          <div className="rv-editor-foot">
            <small>{text.trim().split(/\s+/).filter(Boolean).length} Wörter{dirty ? " · ungespeichert" : ""}</small>
            <div className="rv-editor-buttons">
              {selected.draftState === "freigegeben" ? <button type="button" className="campaign-act" disabled={save.isPending} onClick={unapprove}>Freigabe zurücknehmen</button> : <button type="button" className="campaign-act" disabled={save.isPending || !dirty} onClick={keep}>Speichern</button>}
              <button type="button" className="campaign-act is-primary" disabled={save.isPending || isGenerating || !subject.trim() || text.trim().length < 10} onClick={approve}><Check className="h-3.5 w-3.5" /> {selected.draftState === "freigegeben" && !dirty ? "Weiter" : "Freigeben & weiter"} <ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </>}
      </div>
    </div>
  </section>;
}
