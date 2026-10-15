import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { confirmAction } from "@/lib/confirm";
import { stageLabel } from "../../../shared/sales-pipeline";

/**
 * Kontakt-Übersicht als Tabelle – in zwei Rollen:
 * • E-Mail-Akquise (Standard): die eigene Lead-Liste der E-Mail-Kampagnen. Je Kontakt steht, woher er kommt (Liste),
 *   wann er angelegt wurde, in welchen Kampagnen er steckt, was zuletzt passiert ist (gesendet, geöffnet, geklickt,
 *   geantwortet, abgemeldet, Bounce), seine Stufe und wer ihn betreut. Ankreuzen → mit Stufe in die Pipeline übernehmen oder löschen.
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
export type PipelineSource = "ads" | "kaltakquise" | "email";

export default function EmailLeadsPanel({ onOpenLead, mode = "email", source = null, onChanged }: { onOpenLead?: (publicId: string) => void; mode?: "email" | "pipeline"; source?: PipelineSource | null; onChanged?: () => void }) {
  const utils = trpc.useUtils();
  const pipeline = mode === "pipeline";
  const [picked, setPicked] = useState<number[]>([]);
  const [stage, setStage] = useState("neu"); // Stufe, in der übernommene Kontakte in der Pipeline „E-Mail-Kampagne“ landen
  const [search, setSearch] = useState("");
  const [listName, setListName] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [activity, setActivity] = useState<typeof ACTIVITY[number]["key"] | null>(null);
  const [owner, setOwner] = useState<number | "ohne" | null>(null);
  const data = trpc.leadops.emailLeads.useQuery({ search: search.trim() || null, listName, campaignId, activity, stage: stageFilter, ownerUserId: owner, ...(pipeline ? { source, inPipeline: true, withoutEmail: true } : {}) }, { retry: false });
  const owners = trpc.leadops.pipelineOwners.useQuery(undefined, { retry: false });
  const stages = trpc.leadops.pipelineStages.useQuery(undefined, { retry: false });
  const stageDefs = stages.data ?? [];
  const refreshAll = () => { utils.leadops.emailLeads.invalidate(); utils.leadops.pipelineOverview.invalidate(); utils.leadops.listColdLists.invalidate(); utils.leadops.listImportHistory.invalidate(); onChanged?.(); };
  const push = trpc.leadops.pushLeadsToPipeline.useMutation({ onSuccess: (result) => {
    toast.success(result.moved ? `${result.moved} ${result.moved === 1 ? "Kontakt" : "Kontakte"} in die Pipeline „E-Mail-Kampagne“ übernommen, Stufe „${stageLabel(result.stage, stageDefs)}“${result.already ? ` – ${result.already} waren schon drin` : ""}.` : "Diese Kontakte sind schon in der Pipeline.");
    setPicked([]); refreshAll();
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
  const canPick = (lead: { inPipeline: boolean }) => pipeline || lead.inPipeline === false;

  return <section className="surface-panel operations-panel p-5">
    <div className="panel-title"><div>
      <span className="eyebrow">{pipeline ? "KONTAKTE DIESER PIPELINE" : "KONTAKTE DER E-MAIL-AKQUISE"}</span>
      <h2>{pipeline ? "Alle Kontakte auf einen Blick – als Liste statt Karten" : "Wer steckt in den Serien – und was ist passiert?"}</h2>
      <p className="text-xs text-slate-500">{pipeline ? "Jede Zeile ein Kontakt dieser Pipeline mit Telefon, E-Mail, Herkunft, letzter Reaktion, Stufe und Vertriebler. Klick auf die Zeile öffnet die Lead-Seite; ankreuzen, um Stufe zu setzen, zuzuteilen oder zu löschen." : "Jede Zeile ein Kontakt: Herkunft, Kampagne, letzte Reaktion und Stufe. Klick auf die Zeile öffnet die Lead-Seite; ankreuzen zum Übernehmen in die Pipeline oder zum Löschen."}</p>
    </div></div>

    <div className="email-leads-filters">
      <input className="email-leads-search" placeholder={pipeline ? "Suchen: Name, Firma, Telefon, E-Mail, Ort, PLZ, Liste, Kampagne" : "Suchen: Name, Firma, E-Mail, Ort, Liste"} value={search} onChange={(event) => setSearch(event.target.value)} />
      {(!pipeline || source !== "ads") && <select className="lead-action-select" aria-label="Liste" value={listName ?? ""} onChange={(event) => setListName(event.target.value || null)}><option value="">Alle Listen</option>{(data.data?.lists ?? []).map((name) => <option key={name} value={name}>{name}</option>)}</select>}
      <select className="lead-action-select" aria-label="Kampagne" value={campaignId ?? ""} onChange={(event) => setCampaignId(event.target.value ? Number(event.target.value) : null)}><option value="">{pipeline ? "Alle E-Mail-Kampagnen" : "Alle Kampagnen"}</option>{(data.data?.campaigns ?? []).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select>
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
            {pipeline ? <>
              <select className="lead-action-select" aria-label="Ausgewählte in Stufe verschieben" value="" disabled={bulkMove.isPending} onChange={(event) => { if (event.target.value) bulkMove.mutate({ publicIds: pickedRows.map((lead) => lead.publicId), stage: event.target.value }); }}><option value="">Stufe setzen …</option>{stageDefs.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
              <select className="lead-action-select" aria-label="Ausgewählte zuteilen an" value="" disabled={bulkAssign.isPending} onChange={(event) => { if (event.target.value) bulkAssign.mutate({ publicIds: pickedRows.map((lead) => lead.publicId), ownerUserId: event.target.value === "ohne" ? null : Number(event.target.value) }); }}><option value="">Zuteilen an …</option>{(owners.data ?? []).map((item) => <option key={item.userId} value={item.userId}>{item.name.split(" ")[0]}</option>)}<option value="ohne">Zuteilung entfernen</option></select>
              <button type="button" className="email-leads-delete" disabled={removeCards.isPending} onClick={async () => { if (await confirmAction(`${picked.length} ${picked.length === 1 ? "Kontakt" : "Kontakte"} aus der Pipeline löschen? Verlauf, Aufgaben und Notizen gehen mit. Das lässt sich nicht rückgängig machen.`, { danger: true })) removeCards.mutate({ publicIds: pickedRows.map((lead) => lead.publicId) }); }}>{removeCards.isPending ? "Wird gelöscht …" : "Löschen"}</button>
            </> : <>
              <select className="lead-action-select" aria-label="Stufe in der Pipeline" value={stage} onChange={(event) => setStage(event.target.value)}>{stageDefs.map((item) => <option key={item.key} value={item.key}>Stufe: {item.label}</option>)}</select>
              <button type="button" className="email-leads-push" disabled={push.isPending || !picked.some((id) => offen.includes(id))} title={picked.some((id) => offen.includes(id)) ? "" : "Alle ausgewählten Kontakte sind schon in der Pipeline"} onClick={() => push.mutate({ leadIds: picked.filter((id) => offen.includes(id)), stage })}>{push.isPending ? "Wird übernommen …" : "In die Vertriebspipeline übernehmen"}</button>
              <button type="button" className="email-leads-delete" disabled={removeLeads.isPending} onClick={async () => { if (await confirmAction(`${picked.length} ${picked.length === 1 ? "Kontakt" : "Kontakte"} löschen? Kunden bleiben erhalten. Das lässt sich nicht rückgängig machen.`, { danger: true })) removeLeads.mutate({ leadIds: picked }); }}>{removeLeads.isPending ? "Wird gelöscht …" : "Löschen"}</button>
            </>}
            <button type="button" className="email-leads-reset" onClick={() => setPicked([])}>Auswahl aufheben</button>
          </div>}
        </div>
        <div className="email-leads-scroll"><table className="email-leads-table">
          <thead><tr><th className="email-leads-check"><input type="checkbox" aria-label="Alle auswählen" checked={items.some(canPick) && items.filter(canPick).every((lead) => picked.includes(lead.id))} onChange={(event) => setPicked(event.target.checked ? items.filter(canPick).map((lead) => lead.id) : [])} /></th><th>Name</th><th>Firma</th>{pipeline && <th>Telefon</th>}<th>E-Mail</th>{pipeline && <th>Ort</th>}<th>{pipeline ? "Herkunft" : "Liste"}</th><th>{pipeline ? "E-Mail-Kampagne" : "Kampagne"}</th><th>Zuletzt</th><th>Mails</th><th>Stufe</th><th>Vertriebler</th><th>Angelegt</th>{!pipeline && <th>Pipeline</th>}<th></th></tr></thead>
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
            <td>{lead.mails || "–"}</td>
            <td>{lead.stage ? stageLabel(lead.stage, stageDefs) : "–"}</td>
            <td>{lead.ownerName || <span className="text-slate-500">offen</span>}</td>
            <td>{stamp(lead.createdAt)}</td>
            {!pipeline && <td>{lead.inPipeline === false ? <span className="email-leads-state">nur E-Mail</span> : <span className="email-leads-state is-geoeffnet">in der Pipeline</span>}</td>}
            <td className="email-leads-row-tools" onClick={(event) => event.stopPropagation()}><button type="button" title="Kontakt löschen" aria-label="Kontakt löschen" onClick={async () => { if (await confirmAction(`${nameOf(lead)} löschen?${pipeline ? " Verlauf, Aufgaben und Notizen gehen mit." : " Kunden bleiben erhalten."}`, { danger: true })) { if (pipeline) removeCards.mutate({ publicIds: [lead.publicId] }); else removeLeads.mutate({ leadIds: [lead.id] }); } }}>✕</button></td>
          </tr>)}</tbody>
        </table></div>
      </>}
  </section>;
}
