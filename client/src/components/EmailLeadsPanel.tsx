import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { confirmAction } from "@/lib/confirm";

/**
 * Kontakte der E-Mail-Akquise: eine eigene Lead-Liste nur für die E-Mail-Kampagnen.
 * Je Kontakt steht da, woher er kommt (Liste), wann er angelegt wurde, in welchen Kampagnen er steckt,
 * was zuletzt passiert ist (gesendet, geöffnet, geklickt, geantwortet, abgemeldet, Bounce), seine Stufe
 * in der Pipeline und wer ihn betreut. Gefiltert wird wie auf der Leads-Seite.
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

export default function EmailLeadsPanel({ onOpenLead }: { onOpenLead?: (publicId: string) => void }) {
  const utils = trpc.useUtils();
  const [picked, setPicked] = useState<number[]>([]);
  const [stage, setStage] = useState("neu"); // Stufe, in der übernommene Kontakte in der Pipeline „E-Mail-Kampagne“ landen
  const [search, setSearch] = useState("");
  const [listName, setListName] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [activity, setActivity] = useState<typeof ACTIVITY[number]["key"] | null>(null);
  const [owner, setOwner] = useState<number | "ohne" | null>(null);
  const data = trpc.leadops.emailLeads.useQuery({ search: search.trim() || null, listName, campaignId, activity, ownerUserId: owner }, { retry: false });
  const owners = trpc.leadops.pipelineOwners.useQuery(undefined, { retry: false });
  const stages = trpc.leadops.pipelineStages.useQuery(undefined, { retry: false });
  const push = trpc.leadops.pushLeadsToPipeline.useMutation({ onSuccess: (result) => {
    toast.success(result.moved ? `${result.moved} ${result.moved === 1 ? "Kontakt" : "Kontakte"} in die Pipeline „E-Mail-Kampagne“ übernommen, Stufe „${(stages.data ?? []).find((item) => item.key === result.stage)?.label ?? result.stage}“${result.already ? ` – ${result.already} waren schon drin` : ""}.` : "Diese Kontakte sind schon in der Pipeline.");
    setPicked([]); utils.leadops.emailLeads.invalidate(); utils.leadops.pipelineOverview.invalidate();
  }, onError: (error) => toast.error(error.message) });
  const removeLeads = trpc.leadops.deleteEmailLeads.useMutation({ onSuccess: (result) => {
    toast.success(`${result.deleted} ${result.deleted === 1 ? "Kontakt" : "Kontakte"} gelöscht${result.keptCustomers ? `, ${result.keptCustomers} Kunden behalten` : ""}.`);
    setPicked([]); utils.leadops.emailLeads.invalidate(); utils.leadops.listColdLists.invalidate(); utils.leadops.pipelineOverview.invalidate(); utils.leadops.listImportHistory.invalidate();
  }, onError: (error) => toast.error(error.message) });
  const items = data.data?.items ?? [];
  const counts = data.data?.counts ?? {};
  const offen = items.filter((lead) => lead.inPipeline === false).map((lead) => lead.id);
  const resetAll = () => { setSearch(""); setListName(null); setCampaignId(null); setActivity(null); setOwner(null); };
  const gefiltert = Boolean(search.trim() || listName || campaignId || activity || owner);

  return <section className="surface-panel operations-panel p-5">
    <div className="panel-title"><div><span className="eyebrow">KONTAKTE DER E-MAIL-AKQUISE</span><h2>Wer steckt in den Serien – und was ist passiert?</h2><p className="text-xs text-slate-500">Jede Zeile ein Kontakt: Herkunft, Kampagne, letzte Reaktion und Stufe. Klick auf die Zeile öffnet die Lead-Seite; ankreuzen zum Übernehmen in die Pipeline oder zum Löschen.</p></div></div>

    <div className="email-leads-filters">
      <input className="email-leads-search" placeholder="Suchen: Name, Firma, E-Mail, Ort, Liste" value={search} onChange={(event) => setSearch(event.target.value)} />
      <select className="lead-action-select" aria-label="Liste" value={listName ?? ""} onChange={(event) => setListName(event.target.value || null)}><option value="">Alle Listen</option>{(data.data?.lists ?? []).map((name) => <option key={name} value={name}>{name}</option>)}</select>
      <select className="lead-action-select" aria-label="Kampagne" value={campaignId ?? ""} onChange={(event) => setCampaignId(event.target.value ? Number(event.target.value) : null)}><option value="">Alle Kampagnen</option>{(data.data?.campaigns ?? []).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select>
      <select className="lead-action-select" aria-label="Vertriebler" value={owner === "ohne" ? "ohne" : owner ?? ""} onChange={(event) => setOwner(event.target.value === "ohne" ? "ohne" : event.target.value ? Number(event.target.value) : null)}><option value="">Alle Vertriebler</option>{(owners.data ?? []).map((item) => <option key={item.userId} value={item.userId}>{item.name}</option>)}<option value="ohne">Ohne Vertriebler</option></select>
      {gefiltert && <button type="button" className="email-leads-reset" onClick={resetAll}>Filter entfernen</button>}
    </div>

    <div className="dashboard-segments mt-3">
      <button type="button" className={activity === null ? "active" : ""} onClick={() => setActivity(null)}>Alle ({counts.alle ?? 0})</button>
      {ACTIVITY.map((item) => <button key={item.key} type="button" className={activity === item.key ? "active" : ""} onClick={() => setActivity(activity === item.key ? null : item.key)}>{item.label} ({counts[item.key] ?? 0})</button>)}
    </div>

    {data.isLoading ? <p className="py-10 text-center text-sm text-slate-500">Wird geladen …</p>
      : !items.length ? <p className="py-10 text-center text-sm text-slate-500">{gefiltert ? "Keine Kontakte für diese Filter." : "Noch keine Kontakte – lade eine Liste hoch."}</p>
      : <>
        <div className="email-leads-bar">
          <p className="text-xs text-slate-500">{data.data?.total} {data.data?.total === 1 ? "Kontakt" : "Kontakte"}{(data.data?.total ?? 0) > items.length ? ` · die ersten ${items.length} werden gezeigt` : ""}{offen.length ? ` · ${offen.length} noch nicht in der Pipeline` : ""}</p>
          {picked.length > 0 && <div className="email-leads-actions">
            <strong>{picked.length} ausgewählt</strong>
            <select className="lead-action-select" aria-label="Stufe in der Pipeline" value={stage} onChange={(event) => setStage(event.target.value)}>{(stages.data ?? []).map((item) => <option key={item.key} value={item.key}>Stufe: {item.label}</option>)}</select>
            <button type="button" className="email-leads-push" disabled={push.isPending || !picked.some((id) => offen.includes(id))} title={picked.some((id) => offen.includes(id)) ? "" : "Alle ausgewählten Kontakte sind schon in der Pipeline"} onClick={() => push.mutate({ leadIds: picked.filter((id) => offen.includes(id)), stage })}>{push.isPending ? "Wird übernommen …" : "In die Vertriebspipeline übernehmen"}</button><button type="button" className="email-leads-delete" disabled={removeLeads.isPending} onClick={async () => { if (await confirmAction(`${picked.length} ${picked.length === 1 ? "Kontakt" : "Kontakte"} löschen? Kunden bleiben erhalten. Das lässt sich nicht rückgängig machen.`, { danger: true })) removeLeads.mutate({ leadIds: picked }); }}>{removeLeads.isPending ? "Wird gelöscht …" : "Löschen"}</button>
            <button type="button" className="email-leads-reset" onClick={() => setPicked([])}>Auswahl aufheben</button>
          </div>}
        </div>
        <div className="email-leads-scroll"><table className="email-leads-table">
          <thead><tr><th className="email-leads-check"><input type="checkbox" aria-label="Alle auswählen" checked={items.length > 0 && items.every((lead) => picked.includes(lead.id))} onChange={(event) => setPicked(event.target.checked ? items.map((lead) => lead.id) : [])} /></th><th>Name</th><th>Firma</th><th>E-Mail</th><th>Liste</th><th>Kampagne</th><th>Zuletzt</th><th>Mails</th><th>Stufe</th><th>Vertriebler</th><th>Angelegt</th><th>Pipeline</th><th></th></tr></thead>
          <tbody>{items.map((lead) => <tr key={lead.id} className={`${picked.includes(lead.id) ? "is-picked" : ""} ${onOpenLead ? "is-clickable" : ""}`} title="Klick öffnet die Lead-Seite" onClick={() => onOpenLead?.(lead.publicId)}>
            <td className="email-leads-check" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`${lead.firstName ?? ""} ${lead.lastName ?? ""} auswählen`} checked={picked.includes(lead.id)} onChange={(event) => setPicked((value) => event.target.checked ? [...value, lead.id] : value.filter((id) => id !== lead.id))} /></td>
            <td>{onOpenLead ? <button type="button" className="email-leads-name" onClick={() => onOpenLead(lead.publicId)}>{[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "–"}</button> : [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "–"}</td>
            <td>{lead.company || "–"}</td>
            <td>{lead.email || "–"}</td>
            <td>{lead.listName || "–"}</td>
            <td>{lead.campaigns.length ? lead.campaigns.map((campaign) => campaign.name).join(", ") : <span className="text-slate-500">in keiner</span>}</td>
            <td><span className={`email-leads-state is-${lead.activity}`}>{ACTIVITY.find((item) => item.key === lead.activity)?.label ?? "–"}</span>{lead.activityAt ? <small> {stamp(lead.activityAt)}</small> : null}</td>
            <td>{lead.mails || "–"}</td>
            <td>{lead.stage || "–"}</td>
            <td>{lead.ownerName || <span className="text-slate-500">offen</span>}</td>
            <td>{stamp(lead.createdAt)}</td>
            <td>{lead.inPipeline === false ? <span className="email-leads-state">nur E-Mail</span> : <span className="email-leads-state is-geoeffnet">in der Pipeline</span>}</td>
            <td className="email-leads-row-tools" onClick={(event) => event.stopPropagation()}><button type="button" title="Kontakt löschen" aria-label="Kontakt löschen" onClick={async () => { if (await confirmAction(`${[lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email} löschen? Kunden bleiben erhalten.`, { danger: true })) removeLeads.mutate({ leadIds: [lead.id] }); }}>✕</button></td>
          </tr>)}</tbody>
        </table></div>
      </>}
  </section>;
}
