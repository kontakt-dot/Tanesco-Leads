import { useState } from "react";
import { trpc } from "@/lib/trpc";

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
  const [search, setSearch] = useState("");
  const [listName, setListName] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [activity, setActivity] = useState<typeof ACTIVITY[number]["key"] | null>(null);
  const [owner, setOwner] = useState<number | "ohne" | null>(null);
  const data = trpc.leadops.emailLeads.useQuery({ search: search.trim() || null, listName, campaignId, activity, ownerUserId: owner }, { retry: false });
  const owners = trpc.leadops.pipelineOwners.useQuery(undefined, { retry: false });
  const items = data.data?.items ?? [];
  const counts = data.data?.counts ?? {};
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
        <p className="mt-3 text-xs text-slate-500">{data.data?.total} {data.data?.total === 1 ? "Kontakt" : "Kontakte"}{(data.data?.total ?? 0) > items.length ? ` · die ersten ${items.length} werden gezeigt` : ""}</p>
        <div className="email-leads-scroll"><table className="email-leads-table">
          <thead><tr><th>Name</th><th>Firma</th><th>E-Mail</th><th>Liste</th><th>Kampagne</th><th>Zuletzt</th><th>Mails</th><th>Stufe</th><th>Vertriebler</th><th>Angelegt</th></tr></thead>
          <tbody>{items.map((lead) => <tr key={lead.id}>
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
          </tr>)}</tbody>
        </table></div>
      </>}
  </section>;
}
