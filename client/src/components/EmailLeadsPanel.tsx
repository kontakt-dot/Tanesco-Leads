import { undoIdOf, withUndo } from "@/components/UndoPanel";
import { Fragment, useState } from "react";
import { Ban, History, Phone } from "lucide-react";
import RestoreStateDialog from "@/components/RestoreStateDialog";
import BlockContactDialog, { UnblockButton } from "@/components/BlockContactDialog";
import { CallDialog } from "@/components/CallLog";
import { ContactSentMails } from "@/components/InboxPanel";
import { trpc } from "@/lib/trpc";
import { callCounterText, callResultLabel } from "../../../shared/pipeline-extras";
import { toast } from "sonner";
import { confirmAction } from "@/lib/confirm";
import { pipelineLabel, pipelineSourceOf, stageLabel, type PipelineSource } from "../../../shared/sales-pipeline";

/**
 * Kontakt-Übersicht als Tabelle – in zwei Rollen:
 * • E-Mail-Akquise (Standard): die eigene Lead-Liste der E-Mail-Kampagnen. Je Kontakt steht, woher er kommt (Liste),
 *   wann er angelegt wurde, in welchen Kampagnen er steckt, was zuletzt passiert ist (gesendet, geöffnet, geklickt,
 *   geantwortet, abgemeldet, Bounce), seine Stufe und wer ihn betreut. Ankreuzen → in eine Pipeline („E-Mail-Kampagne“ oder
 *   „Kaltakquise“) mit Stufe übernehmen – auch Kontakte, die schon in einer anderen Pipeline stehen, werden verschoben – oder löschen.
 * • Vertriebspipeline (mode="pipeline"): alle Kontakte der gewählten Pipeline (Meta Ads, Kaltakquise oder E-Mail-Kampagne),
 *   auch ohne E-Mail-Adresse – mit Telefon und Ort, Stufe setzen, zuteilen und löschen für die Auswahl.
 * Gefiltert wird wie auf der Leads-Seite.
 */
const ACTIVITY: Array<{ key: "angeschrieben" | "gesendet" | "geoeffnet" | "geklickt" | "geantwortet" | "abgemeldet" | "bounce" | "ohne"; label: string; hint?: string }> = [
  { key: "angeschrieben", label: "Gesendet", hint: "Alle, die schon mindestens eine E-Mail bekommen haben – egal, ob sie geöffnet haben. Wer eine E-Mail bekommt, steht automatisch hier." },
  { key: "geantwortet", label: "Geantwortet" },
  { key: "geklickt", label: "Geklickt" },
  { key: "geoeffnet", label: "Geöffnet" },
  { key: "gesendet", label: "Nicht geöffnet", hint: "Angeschrieben, aber bisher nicht geöffnet, nicht geklickt und keine Antwort – gut, um sie auszuwählen und noch einmal in eine Kampagne zu stecken" },
  { key: "ohne", label: "Noch nichts", hint: "Noch keine E-Mail bekommen" },
  { key: "abgemeldet", label: "Abgemeldet" },
  { key: "bounce", label: "Unzustellbar" },
];
const stamp = (value: string | Date | null) => value ? new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "–";
export type { PipelineSource } from "../../../shared/sales-pipeline";

export default function EmailLeadsPanel({ onOpenLead, mode = "email", source = null, onChanged }: { onOpenLead?: (publicId: string) => void; mode?: "email" | "pipeline"; source?: PipelineSource | null; onChanged?: () => void }) {
  const utils = trpc.useUtils();
  const pipeline = mode === "pipeline";
  const pipelineSettingsForLabels = trpc.leadops.pipelineSettings.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const [picked, setPicked] = useState<number[]>([]);
  const [callFor, setCallFor] = useState<{ publicId: string; name: string; phone: string | null } | null>(null); // Anruf-Fenster aus der Zeile
  const [target, setTarget] = useState<"email" | "kaltakquise">("email"); // Ziel-Pipeline beim Übernehmen
  const [stage, setStage] = useState("neu"); // Stufe, in der übernommene Kontakte in der Ziel-Pipeline landen
  const [search, setSearch] = useState("");
  const [listName, setListName] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [activity, setActivity] = useState<typeof ACTIVITY[number]["key"] | null>(null);
  const [owner, setOwner] = useState<number | "ohne" | null>(null);
  const [onlyBlocked, setOnlyBlocked] = useState(false); // nur gesperrte Kontakte (Sperrliste)
  const [blockFor, setBlockFor] = useState<{ ids: number[]; label: string } | null>(null); // Sperren-Fenster (Zeile oder Auswahl)
  const [mailsFor, setMailsFor] = useState<number | null>(null); // aufgeklappt: welche E-Mails an diesen Kontakt rausgingen
  const [restoreOpen, setRestoreOpen] = useState(false); // Fenster „Früheren Stand wiederherstellen“
  const data = trpc.leadops.emailLeads.useQuery({ search: search.trim() || null, listName, campaignId, activity, stage: stageFilter, ownerUserId: owner, blocked: onlyBlocked ? true : null, ...(pipeline ? { source, inPipeline: true, withoutEmail: true } : {}) }, { retry: false });
  const owners = trpc.leadops.pipelineOwners.useQuery(undefined, { retry: false });
  const stages = trpc.leadops.pipelineStages.useQuery({ source: pipeline ? source : target }, { retry: false }); // Stufen der jeweiligen Pipeline (E-Mail-Akquise: Stufen der gewählten Ziel-Pipeline)
  const stageDefs = stages.data ?? [];
  const refreshAll = () => { utils.leadops.emailLeads.invalidate(); utils.leadops.pipelineOverview.invalidate(); utils.leadops.listColdLists.invalidate(); utils.leadops.listImportHistory.invalidate(); onChanged?.(); };
  const push = trpc.leadops.pushLeadsToPipeline.useMutation({ onSuccess: (result) => {
    // Rückmeldung in einem Satz: wie viele neu übernommen, aus einer anderen Pipeline verschoben, nur umgestuft – und was unverändert blieb.
    const teile: string[] = [];
    if (result.moved) teile.push(`${result.moved} neu übernommen`);
    if (result.switched) teile.push(`${result.switched} aus einer anderen Pipeline verschoben`);
    if (result.restaged) teile.push(`${result.restaged} in die Stufe gesetzt`);
    if (result.assigned) teile.push(`${result.assigned} an Vertriebler verteilt`); // Verteilung aus den Einstellungen (Team → Verteilung neuer Leads)
    const summe = result.moved + result.switched + result.restaged;
    toast.success(summe ? `${summe} ${summe === 1 ? "Kontakt" : "Kontakte"} in der Pipeline „${result.targetName}“, Stufe „${stageLabel(result.stage, stageDefs)}“ (${teile.join(", ")})${result.already ? ` – ${result.already} standen dort schon so` : ""}.` : `Diese Kontakte stehen schon in der Pipeline „${result.targetName}“ in dieser Stufe.`, withUndo(undoIdOf(result), { duration: 15000 }));
    setPicked([]); refreshAll();
  }, onError: (error) => toast.error(error.message) });
  // Ausgewählte Kontakte direkt in eine E-Mail-Kampagne nehmen
  const [addTo, setAddTo] = useState<number | null>(null);
  const campaignList = trpc.leadops.listEmailCampaigns.useQuery(undefined, { retry: false });
  const campaignChoices = (campaignList.data ?? []).filter((row) => !row.isTemplate && !row.archivedAt); // archivierte Kampagnen nehmen keine Kontakte mehr auf
  const addToCampaign = trpc.leadops.addLeadsToEmailCampaign.useMutation({ onSuccess: (result) => {
    const name = campaignChoices.find((row) => row.id === addTo)?.name ?? "die Kampagne";
    const extra = [result.already ? `${result.already} waren schon drin` : "", result.noEmail ? `${result.noEmail} ohne E-Mail-Adresse` : "", result.blocked ? `${result.blocked} gesperrt` : ""].filter(Boolean).join(", ");
    if (result.added) toast.success(`${result.added} ${result.added === 1 ? "Kontakt" : "Kontakte"} zu „${name}“ hinzugefügt${result.status === "entwurf" ? " – sie bekommen die Serie, sobald du die Kampagne startest" : result.status === "pausiert" ? " – die Kampagne ist pausiert, es geht los, sobald du sie fortsetzt" : " – die erste E-Mail geht im Versandfenster raus"}${extra ? ` (${extra})` : ""}.`, { duration: 9000 });
    else toast.info(`Niemand neu hinzugefügt${extra ? `: ${extra}` : ""}.`);
    setPicked([]); refreshAll(); utils.leadops.listEmailCampaigns.invalidate(); utils.leadops.getEmailCampaign.invalidate();
  }, onError: (error) => toast.error(error.message) });
  const removeLeads = trpc.leadops.deleteEmailLeads.useMutation({ onSuccess: (result) => {
    toast.success(`${result.deleted} ${result.deleted === 1 ? "Kontakt" : "Kontakte"} gelöscht${result.keptCustomers ? `, ${result.keptCustomers} Kunden behalten` : ""}.`);
    setPicked([]); refreshAll();
  }, onError: (error) => toast.error(error.message) });
  const stopFunnel = trpc.leadops.stopLeadsInCampaigns.useMutation({ onSuccess: (result) => { toast.success(result.stopped ? `${result.stopped} laufende E-Mail-Serie${result.stopped === 1 ? "" : "n"} gestoppt – es geht keine weitere E-Mail raus.` : "Keiner der Kontakte steckt in einer laufenden E-Mail-Serie.", withUndo(result.undoId)); setPicked([]); data.refetch(); }, onError: (error) => toast.error(error.message) });
  const removeCards = trpc.leadops.deletePipelineLeads.useMutation({ onSuccess: (result) => {
    toast.success(`${result.deleted} ${result.deleted === 1 ? "Kontakt" : "Kontakte"} gelöscht${result.skipped ? `, ${result.skipped} übersprungen` : ""}.`);
    setPicked([]); refreshAll();
  }, onError: (error) => toast.error(error.message) });
  const bulkMove = trpc.leadops.bulkMovePipelineStage.useMutation({ onSuccess: (result) => { toast.success(`${result.moved} ${result.moved === 1 ? "Kontakt" : "Kontakte"} nach „${result.label}“ verschoben.`, withUndo(undoIdOf(result))); setPicked([]); refreshAll(); }, onError: (error) => toast.error(error.message) });
  const bulkAssign = trpc.leadops.assignPipelineOwner.useMutation({ onSuccess: (result) => { toast.success(result.ownerName ? `${result.updated} ${result.updated === 1 ? "Kontakt gehört" : "Kontakte gehören"} jetzt ${result.ownerName.split(" ")[0]}.` : `${result.updated} Zuteilungen entfernt.`, withUndo(undoIdOf(result))); setPicked([]); refreshAll(); }, onError: (error) => toast.error(error.message) });
  const items = data.data?.items ?? [];
  const counts = data.data?.counts ?? {};
  const offen = items.filter((lead) => lead.inPipeline === false).map((lead) => lead.id);
  const pickedRows = items.filter((lead) => picked.includes(lead.id));
  const resetAll = () => { setSearch(""); setListName(null); setCampaignId(null); setActivity(null); setOwner(null); setStageFilter(null); setOnlyBlocked(false); };
  const gefiltert = Boolean(search.trim() || listName || campaignId || activity || owner || stageFilter || onlyBlocked);
  const blockedCount = (data.data as { blocked?: number } | undefined)?.blocked ?? items.filter((lead) => lead.blocked).length;
  const nameOf = (lead: { firstName: string | null; lastName: string | null; company: string | null; email: string | null; publicId: string }) => [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.company || lead.email || lead.publicId;
  const herkunft = (lead: { listName: string | null; adCampaignName?: string | null; adPlatform?: string | null }) => lead.listName || (lead.adPlatform !== "kaltakquise" && lead.adPlatform !== "email" ? lead.adCampaignName : null) || "–";
  const canPick = (_lead: { inPipeline: boolean }) => true; // jede Zeile ist wählbar – übernehmen verschiebt auch Kontakte, die schon in einer anderen Pipeline stehen
  const pipelineName = (lead: { adPlatform?: string | null }) => pipelineLabel(pipelineSourceOf(lead.adPlatform ?? null), pipelineSettingsForLabels.data?.customPipelines ?? []);
  // Wie die Kampagnen-Spalte heißt, hängt von der Pipeline ab: in der Kaltakquise sind es die Kaltakquise-Kampagnen (E-Mail-Serien an die hochgeladenen Listen).
  const campaignWord = pipeline && source === "kaltakquise" ? "Kaltakquise-Kampagne" : pipeline ? "E-Mail-Kampagne" : "Kampagne";
  const campaignWordPlural = pipeline && source === "kaltakquise" ? "Alle Kaltakquise-Kampagnen" : pipeline ? "Alle E-Mail-Kampagnen" : "Alle Kampagnen";

  return <section className="surface-panel operations-panel p-5">
    <div className="xl-head"><div><h2>{pipeline ? "Kontakte dieser Pipeline" : "Kontakte"} <span>{data.data?.total ?? 0}</span></h2><p>{pipeline ? "Alle Kontakte als Liste – Klick öffnet die Lead-Seite, ankreuzen für Stufe, Zuteilung oder Löschen." : "Wer steckt in den Serien und was ist passiert – Klick öffnet die Lead-Seite, ankreuzen für Kampagne, Pipeline oder Löschen."}</p></div><button type="button" className="email-leads-restore" title="Kontakte so zurücksetzen, wie sie zu einem Zeitpunkt standen (Pipeline, Stufe, Vertriebler) – mit Vorschau" onClick={() => setRestoreOpen(true)}><History className="h-3.5 w-3.5" aria-hidden="true" /> Früheren Stand wiederherstellen</button></div>

    <div className="email-leads-filters">
      <input className="email-leads-search" placeholder={pipeline ? `Suchen: Name, Firma, Telefon, E-Mail, Ort, PLZ, Liste, ${campaignWord}` : "Suchen: Name, Firma, E-Mail, Ort, Liste"} value={search} onChange={(event) => setSearch(event.target.value)} />
      {(!pipeline || source !== "ads") && <select className="lead-action-select" aria-label="Liste" value={listName ?? ""} onChange={(event) => setListName(event.target.value || null)}><option value="">Alle Listen</option>{(data.data?.lists ?? []).map((name) => <option key={name} value={name}>{name}</option>)}</select>}
      <select className="lead-action-select" aria-label="Kampagne" value={campaignId ?? ""} onChange={(event) => setCampaignId(event.target.value ? Number(event.target.value) : null)}><option value="">{campaignWordPlural}</option>{(data.data?.campaigns ?? []).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select>
      {pipeline && <select className="lead-action-select" aria-label="Stufe" value={stageFilter ?? ""} onChange={(event) => setStageFilter(event.target.value || null)}><option value="">Alle Stufen</option>{stageDefs.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>}
      <select className="lead-action-select" aria-label="Vertriebler" value={owner === "ohne" ? "ohne" : owner ?? ""} onChange={(event) => setOwner(event.target.value === "ohne" ? "ohne" : event.target.value ? Number(event.target.value) : null)}><option value="">Alle Vertriebler</option>{(owners.data ?? []).map((item) => <option key={item.userId} value={item.userId}>{item.name}</option>)}<option value="ohne">Ohne Vertriebler</option></select>
      {gefiltert && <button type="button" className="email-leads-reset" onClick={resetAll}>Filter entfernen</button>}
    </div>

    <div className="cd-filters xl-filters" role="tablist" aria-label="Nach letzter Reaktion filtern">
      <button type="button" role="tab" aria-selected={activity === null} className={activity === null ? "is-active" : ""} onClick={() => setActivity(null)}>Alle<i>{counts.alle ?? 0}</i></button>
      {ACTIVITY.filter((item) => (counts[item.key] ?? 0) > 0 || activity === item.key).map((item) => <button key={item.key} type="button" role="tab" aria-selected={activity === item.key} title={item.hint} className={`${activity === item.key ? "is-active" : ""} is-${item.key}`} onClick={() => setActivity(activity === item.key ? null : item.key)}><b className={`xl-dot is-${item.key}`} aria-hidden="true" />{item.label}<i>{counts[item.key] ?? 0}</i></button>)}
      {(blockedCount > 0 || onlyBlocked) && <button type="button" role="tab" aria-selected={onlyBlocked} className={`${onlyBlocked ? "is-active" : ""} is-gesperrt`} title="Gesperrte Kontakte: stehen auf der Sperrliste und bekommen keine E-Mails" onClick={() => setOnlyBlocked((value) => !value)}><b className="xl-dot is-gesperrt" aria-hidden="true" />Gesperrt<i>{blockedCount}</i></button>}
    </div>

    {activity === "angeschrieben" && <p className="email-leads-sentinfo">Hier steht jeder, der schon eine E-Mail bekommen hat – neue kommen automatisch dazu, sobald eine E-Mail rausgeht. Zuletzt angeschrieben steht oben. Klick auf die Zahl bei „Mails“ zeigt, welche E-Mails rausgingen.</p>}
    {data.isLoading ? <p className="py-10 text-center text-sm text-slate-500">Wird geladen …</p>
      : !items.length ? <p className="py-10 text-center text-sm text-slate-500">{gefiltert ? "Keine Kontakte für diese Filter." : pipeline ? "Noch keine Kontakte in dieser Pipeline." : "Noch keine Kontakte – lade eine Liste hoch."}</p>
      : <>
        <div className="email-leads-bar">
          <p className="text-xs text-slate-500">{data.data?.total} {data.data?.total === 1 ? "Kontakt" : "Kontakte"}{(data.data?.total ?? 0) > items.length ? ` · die ersten ${items.length} werden gezeigt` : ""}{!pipeline && offen.length ? ` · ${offen.length} noch nicht in der Pipeline` : ""}</p>
          {picked.length > 0 && <div className="email-leads-actions">
            <strong>{picked.length} ausgewählt</strong>
            <span className="email-leads-campaign"><select className="lead-action-select" aria-label="E-Mail-Kampagne wählen" value={addTo ?? ""} onChange={(event) => setAddTo(event.target.value ? Number(event.target.value) : null)}><option value="">E-Mail-Kampagne wählen …</option>{campaignChoices.map((row) => <option key={row.id} value={row.id}>{row.name}{row.status === "entwurf" ? " (Entwurf)" : row.status === "pausiert" ? " (pausiert)" : ""}</option>)}</select><button type="button" className="email-leads-push" disabled={!addTo || addToCampaign.isPending} title={addTo ? "Die ausgewählten Kontakte bekommen die Serie dieser Kampagne" : "Erst eine Kampagne wählen"} onClick={() => { if (addTo) addToCampaign.mutate({ id: addTo, leadIds: picked }); }}>{addToCampaign.isPending ? "Wird hinzugefügt …" : "Zur Kampagne hinzufügen"}</button></span>
            {pipeline ? <>
              <select className="lead-action-select" aria-label="Ausgewählte in Stufe verschieben" value="" disabled={bulkMove.isPending} onChange={(event) => { if (event.target.value) bulkMove.mutate({ publicIds: pickedRows.map((lead) => lead.publicId), stage: event.target.value }); }}><option value="">Stufe setzen …</option>{stageDefs.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
              <select className="lead-action-select" aria-label="Ausgewählte zuteilen an" value="" disabled={bulkAssign.isPending} onChange={(event) => { if (event.target.value) bulkAssign.mutate({ publicIds: pickedRows.map((lead) => lead.publicId), ownerUserId: event.target.value === "ohne" ? null : Number(event.target.value) }); }}><option value="">Zuteilen an …</option>{(owners.data ?? []).map((item) => <option key={item.userId} value={item.userId}>{item.name.split(" ")[0]}</option>)}<option value="ohne">Zuteilung entfernen</option></select>
              <button type="button" className="email-leads-delete" disabled={removeCards.isPending} onClick={async () => { if (await confirmAction(`${picked.length} ${picked.length === 1 ? "Kontakt" : "Kontakte"} aus der Pipeline löschen? Verlauf, Aufgaben und Notizen gehen mit. Das lässt sich nicht rückgängig machen.`, { danger: true })) removeCards.mutate({ publicIds: pickedRows.map((lead) => lead.publicId) }); }}>{removeCards.isPending ? "Wird gelöscht …" : "Löschen"}</button>
            </> : <>
              <select className="lead-action-select" aria-label="Ziel-Pipeline" value={target} onChange={(event) => { setTarget(event.target.value === "kaltakquise" ? "kaltakquise" : "email"); setStage("neu"); }}><option value="email">Pipeline: E-Mail-Kampagne</option><option value="kaltakquise">Pipeline: Kaltakquise</option></select>
              <select className="lead-action-select" aria-label="Stufe in der Pipeline" value={stageDefs.some((item) => item.key === stage) ? stage : (stageDefs[0]?.key ?? "neu")} onChange={(event) => setStage(event.target.value)}>{stageDefs.map((item) => <option key={item.key} value={item.key}>Stufe: {item.label}</option>)}</select>
              <button type="button" className="email-leads-push" disabled={push.isPending} title={pickedRows.every((lead) => lead.inPipeline !== false) ? "Die ausgewählten Kontakte stehen schon in einer Pipeline – sie werden in die gewählte Pipeline und Stufe verschoben" : ""} onClick={() => push.mutate({ leadIds: picked, stage: stageDefs.some((item) => item.key === stage) ? stage : (stageDefs[0]?.key ?? "neu"), target })}>{push.isPending ? "Wird übernommen …" : "In die Vertriebspipeline übernehmen"}</button>
              <button type="button" className="email-leads-delete" disabled={removeLeads.isPending} onClick={async () => { if (await confirmAction(`${picked.length} ${picked.length === 1 ? "Kontakt" : "Kontakte"} löschen? Kunden bleiben erhalten. Das lässt sich nicht rückgängig machen.`, { danger: true })) removeLeads.mutate({ leadIds: picked }); }}>{removeLeads.isPending ? "Wird gelöscht …" : "Löschen"}</button>
            </>}
            <button type="button" className="email-leads-block" title="Keine E-Mails mehr an die ausgewählten Kontakte – Sperrliste, laufende Serien stoppen; die Kontakte bleiben" disabled={!pickedRows.some((lead) => lead.email && !lead.blocked)} onClick={() => setBlockFor({ ids: pickedRows.filter((lead) => lead.email && !lead.blocked).map((lead) => lead.id), label: nameOf(pickedRows[0]) })}><Ban className="h-3.5 w-3.5" /> Sperren</button>
            {pickedRows.some((lead) => lead.blocked) && <UnblockButton leadIds={pickedRows.filter((lead) => lead.blocked).map((lead) => lead.id)} label={`Sperre aufheben (${pickedRows.filter((lead) => lead.blocked).length})`} className="email-leads-reset" onDone={() => { setPicked([]); data.refetch(); }} />}
            <button type="button" className="email-leads-reset" title="Laufende E-Mail-Serien der ausgewählten Kontakte stoppen – keine weitere E-Mail, die Kontakte bleiben" disabled={stopFunnel.isPending} onClick={async () => { if (await confirmAction(`${picked.length} ${picked.length === 1 ? "Kontakt" : "Kontakte"} aus dem E-Mail-Funnel nehmen? Laufende Serien stoppen sofort.`, { confirmLabel: "Aus Funnel nehmen" })) stopFunnel.mutate({ leadIds: picked }); }}>Aus E-Mail-Funnel nehmen</button>
            <button type="button" className="email-leads-reset" onClick={() => setPicked([])}>Auswahl aufheben</button>
          </div>}
        </div>
        <div className="email-leads-scroll"><table className="email-leads-table">
          <thead><tr><th className="email-leads-check"><input type="checkbox" aria-label="Alle auswählen" checked={items.some(canPick) && items.filter(canPick).every((lead) => picked.includes(lead.id))} onChange={(event) => setPicked(event.target.checked ? items.filter(canPick).map((lead) => lead.id) : [])} /></th><th>Kontakt</th><th>Zuletzt</th><th>Firma</th>{pipeline && <th>Telefon</th>}{pipeline && <th>Ort</th>}<th>{pipeline ? "Herkunft" : "Liste"}</th><th>{campaignWord}</th>{pipeline && <th title="Anrufversuche (Zähler der Karte)">Anrufe</th>}<th title="Wie viele E-Mails rausgingen – Klick auf die Zahl zeigt sie mit Datum und Uhrzeit">Mails</th><th>Stufe</th><th>Vertriebler</th><th>Angelegt</th>{!pipeline && <th>Pipeline</th>}<th></th></tr></thead>
          <tbody>{items.map((lead) => <Fragment key={lead.id}><tr className={`${picked.includes(lead.id) ? "is-picked" : ""} ${onOpenLead ? "is-clickable" : ""} ${mailsFor === lead.id ? "is-mails-open" : ""}`} title="Klick öffnet die Lead-Seite" onClick={() => onOpenLead?.(lead.publicId)}>
            <td className="email-leads-check" onClick={(event) => event.stopPropagation()}>{canPick(lead) ? <input type="checkbox" aria-label={`${nameOf(lead)} auswählen`} checked={picked.includes(lead.id)} onChange={(event) => setPicked((value) => event.target.checked ? [...value, lead.id] : value.filter((id) => id !== lead.id))} /> : null}</td>
            <td className="xl-person"><span className="xl-person-in"><span className="cd-avatar" aria-hidden="true">{nameOf(lead).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?"}</span><span className="xl-person-text">{onOpenLead ? <button type="button" className="email-leads-name" onClick={() => onOpenLead(lead.publicId)}>{nameOf(lead)}</button> : <strong>{nameOf(lead)}</strong>}<small>{lead.email || "keine E-Mail"}</small></span></span></td>
            <td className="email-leads-zuletzt">{lead.blocked ? <span className="email-leads-state is-gesperrt" title={`Gesperrt – keine E-Mails (${lead.blockedReason ?? "Sperrliste"})${lead.blockedNote ? `: ${lead.blockedNote}` : ""}`}><Ban className="h-3 w-3" /> Gesperrt</span> : <span className={`email-leads-state is-${lead.activity}`}>{ACTIVITY.find((item) => item.key === lead.activity)?.label ?? "–"}</span>}{!lead.blocked && lead.activityAt ? <small> {stamp(lead.activityAt)}</small> : null}</td>
            <td className="xl-cut is-firma" title={lead.company ?? ""}>{lead.company || "–"}</td>
            {pipeline && <td>{lead.phone || "–"}</td>}
            {pipeline && <td>{[lead.postcode, lead.city].filter(Boolean).join(" ") || "–"}</td>}
            <td className="xl-cut is-liste" title={pipeline ? "" : lead.listName ?? ""}>{pipeline ? herkunft(lead) : lead.listName || "–"}</td>
            <td className="xl-cut" title={lead.campaigns.map((campaign) => campaign.name).join(", ")}>{lead.campaigns.length ? lead.campaigns.map((campaign) => campaign.name).join(", ") : <span className="text-slate-500">in keiner</span>}</td>
            {pipeline && <td>{lead.calls?.count ? <span className={`email-leads-calls ${lead.calls.lastResult === "erreicht" || lead.calls.lastResult === "rueckruf" ? "is-reached" : ""}`} title={callCounterText(lead.calls) ?? ""}>{lead.calls.count}× <small>{callResultLabel(lead.calls.lastResult)}</small></span> : "–"}</td>}
            <td onClick={(event) => { if (lead.mails) event.stopPropagation(); }}>{lead.mails ? <button type="button" className="email-leads-mails" aria-expanded={mailsFor === lead.id} title="Zeigt, welche E-Mails an diesen Kontakt rausgingen – mit Datum und Uhrzeit" onClick={() => setMailsFor(mailsFor === lead.id ? null : lead.id)}><b>{lead.mails}</b>{lead.lastSentAt ? <small>zuletzt {new Date(lead.lastSentAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</small> : null}</button> : "–"}</td>
            <td>{lead.stage ? stageLabel(lead.stage, stageDefs) : "–"}</td>
            <td title={lead.ownerName ?? ""}>{lead.ownerName ? lead.ownerName.split(/\s+/)[0] : <span className="text-slate-500">offen</span>}</td>
            <td>{stamp(lead.createdAt)}</td>
            {!pipeline && <td>{lead.inPipeline === false ? <span className="email-leads-state">nur E-Mail</span> : <span className="email-leads-state is-geoeffnet" title="Steht in dieser Pipeline">{pipelineName(lead)}</span>}</td>}
            <td className="email-leads-row-tools" onClick={(event) => event.stopPropagation()}>{pipeline && <button type="button" className="email-leads-call" title="Anrufen und Ergebnis festhalten (zählt auch ohne Dialer)" aria-label={`${nameOf(lead)} anrufen`} onClick={() => setCallFor({ publicId: lead.publicId, name: nameOf(lead), phone: lead.phone ?? null })}><Phone className="h-3.5 w-3.5" /></button>}{lead.email && (lead.blocked ? <UnblockButton leadIds={[lead.id]} label="Entsperren" className="email-leads-unblock" onDone={() => data.refetch()} /> : <button type="button" className="email-leads-blockrow" title="Sperren – keine E-Mails mehr an diesen Kontakt" aria-label={`${nameOf(lead)} sperren`} onClick={() => setBlockFor({ ids: [lead.id], label: nameOf(lead) })}><Ban className="h-3.5 w-3.5" /></button>)}<button type="button" title="Kontakt löschen" aria-label="Kontakt löschen" onClick={async () => { if (await confirmAction(`${nameOf(lead)} löschen?${pipeline ? " Verlauf, Aufgaben und Notizen gehen mit." : " Kunden bleiben erhalten."}`, { danger: true })) { if (pipeline) removeCards.mutate({ publicIds: [lead.publicId] }); else removeLeads.mutate({ leadIds: [lead.id] }); } }}>✕</button></td>
          </tr>
          {mailsFor === lead.id && <tr className="email-leads-sub"><td colSpan={pipeline ? 14 : 12}><ContactSentMails leadId={lead.id} email={lead.email ?? null} /></td></tr>}
          </Fragment>)}</tbody>
        </table></div>
      </>}
    <BlockContactDialog leadIds={blockFor?.ids ?? []} label={blockFor?.label ?? ""} source={pipeline ? "Vertriebspipeline (Kontakte)" : "E-Mail-Kampagnen (Kontakte)"} open={Boolean(blockFor)} onClose={() => setBlockFor(null)} onDone={() => { setPicked([]); data.refetch(); onChanged?.(); }} />
    <RestoreStateDialog open={restoreOpen} onClose={() => { setRestoreOpen(false); data.refetch(); }} />
    {callFor && <CallDialog publicId={callFor.publicId} name={callFor.name} phone={callFor.phone} onDone={() => { setCallFor(null); data.refetch(); onChanged?.(); }} onCancel={() => setCallFor(null)} onPhoneSaved={() => data.refetch()} />}
  </section>;
}
