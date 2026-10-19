import { useState } from "react";
import { Phone } from "lucide-react";
import { CallDialog } from "@/components/CallLog";
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
const ACTIVITY: Array<{ key: "gesendet" | "geoeffnet" | "geklickt" | "geantwortet" | "abgemeldet" | "bounce" | "ohne"; label: string }> = [
  { key: "geantwortet", label: "Geantwortet" },
  { key: "geklickt", label: "Geklickt" },
  { key: "geoeffnet", label: "Geöffnet" },
  { key: "gesendet", label: "Gesendet" },
  { key: "ohne", label: "Noch nichts" },
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
  const data = trpc.leadops.emailLeads.useQuery({ search: search.trim() || null, listName, campaignId, activity, stage: stageFilter, ownerUserId: owner, ...(pipeline ? { source, inPipeline: true, withoutEmail: true } : {}) }, { retry: false });
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
    toast.success(summe ? `${summe} ${summe === 1 ? "Kontakt" : "Kontakte"} in der Pipeline „${result.targetName}“, Stufe „${stageLabel(result.stage, stageDefs)}“ (${teile.join(", ")})${result.already ? ` – ${result.already} standen dort schon so` : ""}.` : `Diese Kontakte stehen schon in der Pipeline „${result.targetName}“ in dieser Stufe.`);
    setPicked([]); refreshAll();
  }, onError: (error) => toast.error(error.message) });
  // Ausgewählte Kontakte direkt in eine E-Mail-Kampagne nehmen
  const [addTo, setAddTo] = useState<number | null>(null);
  const campaignList = trpc.leadops.listEmailCampaigns.useQuery(undefined, { retry: false });
  const campaignChoices = (campaignList.data ?? []).filter((row) => !row.isTemplate);
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
  const removeCards = trpc.leadops.deletePipelineLeads.useMutation({ onSuccess: (result) => {
    toast.success(`${result.deleted} ${result.deleted === 1 ? "Kontakt" : "Kontakte"} gelöscht${result.skipped ? `, ${result.skipped} übersprungen` : ""}.`);
    setPicked([]); refreshAll();
  }, onError: (error) => toast.error(error.message) });
  const bulkMove = trpc.leadops.bulkMovePipelineStage.useMutation({ onSuccess: (result) => { toast.success(`${result.moved} ${result.moved === 1 ? "Kontakt" : "Kontakte"} nach „${result.label}“ verschoben.`); setPicked([]); refreshAll(); }, onError: (error) => toast.error(error.message) });
  const bulkAssign = trpc.leadops.assignPipelineOwner.useMutation({ onSuccess: (result) => { toast.success(result.ownerName ? `${result.updated} ${result.updated === 1 ? "Kontakt gehört" : "Kontakte gehören"} jetzt ${result.ownerName.split(" ")[0]}.` : `${result.updated} Zuteilungen entfernt.`); setPicked([]); refreshAll(); }, onError: (error) => toast.error(error.message) });
  const items = data.data?.items ?? [];
  const counts = data.data?.counts ?? {};
  const offen = items.filter((lead) => lead.inPipeline === false).map((lead) => lead.id);
  const pickedRows = items.filter((lead) => picked.includes(lead.id));
  const resetAll = () => { setSearch(""); setListName(null); setCampaignId(null); setActivity(null); setOwner(null); setStageFilter(null); };
  const gefiltert = Boolean(search.trim() || listName || campaignId || activity || owner || stageFilter);
  const nameOf = (lead: { firstName: string | null; lastName: string | null; company: string | null; email: string | null; publicId: string }) => [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.company || lead.email || lead.publicId;
  const herkunft = (lead: { listName: string | null; adCampaignName?: string | null; adPlatform?: string | null }) => lead.listName || (lead.adPlatform !== "kaltakquise" && lead.adPlatform !== "email" ? lead.adCampaignName : null) || "–";
  const canPick = (_lead: { inPipeline: boolean }) => true; // jede Zeile ist wählbar – übernehmen verschiebt auch Kontakte, die schon in einer anderen Pipeline stehen
  const pipelineName = (lead: { adPlatform?: string | null }) => pipelineLabel(pipelineSourceOf(lead.adPlatform ?? null), pipelineSettingsForLabels.data?.customPipelines ?? []);
  // Wie die Kampagnen-Spalte heißt, hängt von der Pipeline ab: in der Kaltakquise sind es die Kaltakquise-Kampagnen (E-Mail-Serien an die hochgeladenen Listen).
  const campaignWord = pipeline && source === "kaltakquise" ? "Kaltakquise-Kampagne" : pipeline ? "E-Mail-Kampagne" : "Kampagne";
  const campaignWordPlural = pipeline && source === "kaltakquise" ? "Alle Kaltakquise-Kampagnen" : pipeline ? "Alle E-Mail-Kampagnen" : "Alle Kampagnen";

  return <section className="surface-panel operations-panel p-5">
    <div className="panel-title"><div>
      <span className="eyebrow">{pipeline ? "KONTAKTE DIESER PIPELINE" : "KONTAKTE DER E-MAIL-AKQUISE"}</span>
      <h2>{pipeline ? "Alle Kontakte auf einen Blick – als Liste statt Karten" : "Wer steckt in den Serien – und was ist passiert?"}</h2>
      <p className="text-xs text-slate-500">{pipeline ? "Jede Zeile ein Kontakt dieser Pipeline mit Telefon, E-Mail, Herkunft, letzter Reaktion, Stufe und Vertriebler. Klick auf die Zeile öffnet die Lead-Seite; ankreuzen, um Stufe zu setzen, zuzuteilen oder zu löschen." : "Jede Zeile ein Kontakt: Herkunft, Kampagne, letzte Reaktion und Stufe. Klick auf die Zeile öffnet die Lead-Seite; ankreuzen zum Übernehmen in die Pipeline oder zum Löschen."}</p>
    </div></div>

    <div className="email-leads-filters">
      <input className="email-leads-search" placeholder={pipeline ? `Suchen: Name, Firma, Telefon, E-Mail, Ort, PLZ, Liste, ${campaignWord}` : "Suchen: Name, Firma, E-Mail, Ort, Liste"} value={search} onChange={(event) => setSearch(event.target.value)} />
      {(!pipeline || source !== "ads") && <select className="lead-action-select" aria-label="Liste" value={listName ?? ""} onChange={(event) => setListName(event.target.value || null)}><option value="">Alle Listen</option>{(data.data?.lists ?? []).map((name) => <option key={name} value={name}>{name}</option>)}</select>}
      <select className="lead-action-select" aria-label="Kampagne" value={campaignId ?? ""} onChange={(event) => setCampaignId(event.target.value ? Number(event.target.value) : null)}><option value="">{campaignWordPlural}</option>{(data.data?.campaigns ?? []).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select>
      {pipeline && <select className="lead-action-select" aria-label="Stufe" value={stageFilter ?? ""} onChange={(event) => setStageFilter(event.target.value || null)}><option value="">Alle Stufen</option>{stageDefs.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>}
      <select className="lead-action-select" aria-label="Vertriebler" value={owner === "ohne" ? "ohne" : owner ?? ""} onChange={(event) => setOwner(event.target.value === "ohne" ? "ohne" : event.target.value ? Number(event.target.value) : null)}><option value="">Alle Vertriebler</option>{(owners.data ?? []).map((item) => <option key={item.userId} value={item.userId}>{item.name}</option>)}<option value="ohne">Ohne Vertriebler</option></select>
      {gefiltert && <button type="button" className="email-leads-reset" onClick={resetAll}>Filter entfernen</button>}
    </div>

    <div className="dashboard-segments mt-3">
      <button type="button" className={activity === null ? "active" : ""} onClick={() => setActivity(null)}>Alle ({counts.alle ?? 0})</button>
      {ACTIVITY.map((item) => <button key={item.key} type="button" className={activity === item.key ? "active" : ""} onClick={() => setActivity(activity === item.key ? null : item.key)}>{item.label} ({counts[item.key] ?? 0})</button>)}
    </div>

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
            <button type="button" className="email-leads-reset" onClick={() => setPicked([])}>Auswahl aufheben</button>
          </div>}
        </div>
        <div className="email-leads-scroll"><table className="email-leads-table">
          <thead><tr><th className="email-leads-check"><input type="checkbox" aria-label="Alle auswählen" checked={items.some(canPick) && items.filter(canPick).every((lead) => picked.includes(lead.id))} onChange={(event) => setPicked(event.target.checked ? items.filter(canPick).map((lead) => lead.id) : [])} /></th><th>Name</th><th>Firma</th>{pipeline && <th>Telefon</th>}<th>E-Mail</th>{pipeline && <th>Ort</th>}<th>{pipeline ? "Herkunft" : "Liste"}</th><th>{campaignWord}</th><th>Zuletzt</th>{pipeline && <th title="Anrufversuche (Zähler der Karte)">Anrufe</th>}<th>Mails</th><th>Stufe</th><th>Vertriebler</th><th>Angelegt</th>{!pipeline && <th>Pipeline</th>}<th></th></tr></thead>
          <tbody>{items.map((lead) => <tr key={lead.id} className={`${picked.includes(lead.id) ? "is-picked" : ""} ${onOpenLead ? "is-clickable" : ""}`} title="Klick öffnet die Lead-Seite" onClick={() => onOpenLead?.(lead.publicId)}>
            <td className="email-leads-check" onClick={(event) => event.stopPropagation()}>{canPick(lead) ? <input type="checkbox" aria-label={`${nameOf(lead)} auswählen`} checked={picked.includes(lead.id)} onChange={(event) => setPicked((value) => event.target.checked ? [...value, lead.id] : value.filter((id) => id !== lead.id))} /> : null}</td>
            <td>{onOpenLead ? <button type="button" className="email-leads-name" onClick={() => onOpenLead(lead.publicId)}>{nameOf(lead)}</button> : nameOf(lead)}</td>
            <td>{lead.company || "–"}</td>
            {pipeline && <td>{lead.phone || "–"}</td>}
            <td>{lead.email || "–"}</td>
            {pipeline && <td>{[lead.postcode, lead.city].filter(Boolean).join(" ") || "–"}</td>}
            <td>{pipeline ? herkunft(lead) : lead.listName || "–"}</td>
            <td>{lead.campaigns.length ? lead.campaigns.map((campaign) => campaign.name).join(", ") : <span className="text-slate-500">in keiner</span>}</td>
            <td><span className={`email-leads-state is-${lead.activity}`}>{ACTIVITY.find((item) => item.key === lead.activity)?.label ?? "–"}</span>{lead.activityAt ? <small> {stamp(lead.activityAt)}</small> : null}</td>
            {pipeline && <td>{lead.calls?.count ? <span className={`email-leads-calls ${lead.calls.lastResult === "erreicht" || lead.calls.lastResult === "rueckruf" ? "is-reached" : ""}`} title={callCounterText(lead.calls) ?? ""}>{lead.calls.count}× <small>{callResultLabel(lead.calls.lastResult)}</small></span> : "–"}</td>}
            <td>{lead.mails || "–"}</td>
            <td>{lead.stage ? stageLabel(lead.stage, stageDefs) : "–"}</td>
            <td>{lead.ownerName || <span className="text-slate-500">offen</span>}</td>
            <td>{stamp(lead.createdAt)}</td>
            {!pipeline && <td>{lead.inPipeline === false ? <span className="email-leads-state">nur E-Mail</span> : <span className="email-leads-state is-geoeffnet" title="Steht in dieser Pipeline">{pipelineName(lead)}</span>}</td>}
            <td className="email-leads-row-tools" onClick={(event) => event.stopPropagation()}>{pipeline && <button type="button" className="email-leads-call" title="Anrufen und Ergebnis festhalten (zählt auch ohne Dialer)" aria-label={`${nameOf(lead)} anrufen`} onClick={() => setCallFor({ publicId: lead.publicId, name: nameOf(lead), phone: lead.phone ?? null })}><Phone className="h-3.5 w-3.5" /></button>}<button type="button" title="Kontakt löschen" aria-label="Kontakt löschen" onClick={async () => { if (await confirmAction(`${nameOf(lead)} löschen?${pipeline ? " Verlauf, Aufgaben und Notizen gehen mit." : " Kunden bleiben erhalten."}`, { danger: true })) { if (pipeline) removeCards.mutate({ publicIds: [lead.publicId] }); else removeLeads.mutate({ leadIds: [lead.id] }); } }}>✕</button></td>
          </tr>)}</tbody>
        </table></div>
      </>}
    {callFor && <CallDialog publicId={callFor.publicId} name={callFor.name} phone={callFor.phone} onDone={() => { setCallFor(null); data.refetch(); onChanged?.(); }} onCancel={() => setCallFor(null)} onPhoneSaved={() => data.refetch()} />}
  </section>;
}
