import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

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
  const [assign, setAssign] = useState<"verteilen" | "keine" | number>("verteilen");
  const [search, setSearch] = useState("");
  const [listName, setListName] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [activity, setActivity] = useState<typeof ACTIVITY[number]["key"] | null>(null);
  const [owner, setOwner] = useState<number | "ohne" | null>(null);
  const data = trpc.leadops.emailLeads.useQuery({ search: search.trim() || null, listName, campaignId, activity, ownerUserId: owner }, { retry: false });
  const owners = trpc.leadops.pipelineOwners.useQuery(undefined, { retry: false });
  const push = trpc.leadops.pushLeadsToPipeline.useMutation({ onSuccess: (result) => {
    toast.success(result.moved ? `${result.moved} ${result.moved === 1 ? "Kontakt" : "Kontakte"} in die Vertriebspipeline übernommen${result.already ? `, ${result.already} waren schon drin` : ""}.` : "Diese Kontakte sind schon in der Pipeline.");
    setPicked([]); utils.leadops.emailLeads.invalidate(); utils.leadops.pipelineOverview.invalidate();
  }, onError: (error) => toast.error(error.message) });
  const items = data.data?.items ?? [];
  const counts = data.data?.counts ?? {};
  const offen = items.filter((lead) => lead.inPipeline === false).map((lead) => lead.id);
  const resetAll = () => { setSearch(""); setListName(null); setCampaignId(null); setActivity(null); setOwner(null); };
  const gefiltert = Boolean(search.trim() || listName || campaignId || activity || owner);

  return <section className="surface-panel operations-panel p-5">
    <div className="panel-title"><div><span className="eyebrow">KONTAKTE DER E-MAIL-AKQUISE</span><h2>Wer steckt in den Serien – und was ist passiert?</h2><p className="text-xs text-slate-500">Jede Zeile ein Kontakt: Herkunft, Kampagne, letzte Reaktion, Stufe und Vertriebler. Klick auf den Namen öffnet die Lead-Seite.</p></div></div>

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
            <select className="lead-action-select" aria-label="Zuteilen an" value={assign === "verteilen" ? "verteilen" : assign === "keine" ? "keine" : String(assign)} onChange={(event) => setAssign(event.target.value === "verteilen" ? "verteilen" : event.target.value === "keine" ? "keine" : Number(event.target.value))}>
              <option value="verteilen">Gleichmäßig verteilen{(owners.data ?? []).length ? ` (${(owners.data ?? []).map((item) => item.name.split(" ")[0]).join(" / ")})` : ""}</option>
              {(owners.data ?? []).map((item) => <option key={item.userId} value={item.userId}>Nur {item.name}</option>)}
              <option value="keine">Später von Hand zuteilen</option>
            </select>
            <button type="button" className="email-leads-push" disabled={push.isPending} onClick={() => push.mutate({ leadIds: picked, ownerUserIds: assign === "keine" ? null : assign === "verteilen" ? (owners.data ?? []).map((item) => item.userId) : [assign] })}>{push.isPending ? "Wird übernommen …" : "In die Vertriebspipeline übernehmen"}</button>
            <button type="button" className="email-leads-reset" onClick={() => setPicked([])}>Auswahl aufheben</button>
          </div>}
        </div>
        <div className="email-leads-scroll"><table className="email-leads-table">
          <thead><tr><th className="email-leads-check"><input type="checkbox" aria-label="Alle auswählen" checked={offen.length > 0 && offen.every((id) => picked.includes(id))} onChange={(event) => setPicked(event.target.checked ? offen : [])} /></th><th>Name</th><th>Firma</th><th>E-Mail</th><th>Liste</th><th>Kampagne</th><th>Zuletzt</th><th>Mails</th><th>Stufe</th><th>Vertriebler</th><th>Angelegt</th><th>Pipeline</th></tr></thead>
          <tbody>{items.map((lead) => <tr key={lead.id} className={picked.includes(lead.id) ? "is-picked" : ""}>
            <td className="email-leads-check">{lead.inPipeline === false ? <input type="checkbox" aria-label={`${lead.firstName ?? ""} ${lead.lastName ?? ""} auswählen`} checked={picked.includes(lead.id)} onChange={(event) => setPicked((value) => event.target.checked ? [...value, lead.id] : value.filter((id) => id !== lead.id))} /> : null}</td>
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
          </tr>)}</tbody>
        </table></div>
      </>}
  </section>;
}
