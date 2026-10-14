import { useState } from "react";
import { trpc } from "@/lib/trpc";

/**
 * „Liste ansehen“: zeigt die Kontakte einer hochgeladenen Liste als Tabelle – Name, Firma, Telefon, E-Mail, Ort,
 * Stufe und die Zusatzspalten aus der Datei (die Platzhalter). Wird in der Kaltakquise-Pipeline und im
 * Kampagnen-Editor verwendet, damit man vor dem Versand sieht, wer wirklich in der Liste steht.
 */
export default function ListPreview({ listName, onClose }: { listName: string; onClose?: () => void }) {
  const [search, setSearch] = useState("");
  const data = trpc.leadops.coldListContacts.useQuery({ listName, search: search.trim() || null }, { retry: false });
  const contacts = data.data?.contacts ?? [];
  const columns = data.data?.columns ?? [];
  return <div className="list-preview">
    <div className="list-preview-head">
      <div><span className="eyebrow">LISTE ANSEHEN</span><strong>{listName}</strong><small>{data.data ? `${contacts.length} Kontakte${data.data.more ? " (erste 100)" : ""}` : "wird geladen …"}</small></div>
      <div className="list-preview-tools">
        <input className="list-preview-search" placeholder="Suchen: Name, Firma, Ort" value={search} onChange={(event) => setSearch(event.target.value)} />
        {onClose && <button type="button" className="text-xs text-violet-200 hover:underline" onClick={onClose}>schließen</button>}
      </div>
    </div>
    {data.isLoading ? <p className="py-6 text-center text-sm text-slate-500">Wird geladen …</p>
      : !contacts.length ? <p className="py-6 text-center text-sm text-slate-500">Keine Kontakte{search ? " für diese Suche" : ""}.</p>
      : <div className="list-preview-scroll"><table className="list-preview-table">
          <thead><tr><th>Name</th><th>Firma</th><th>Telefon</th><th>E-Mail</th><th>Ort</th><th>Stufe</th>{columns.map((key) => <th key={key}>{key}</th>)}</tr></thead>
          <tbody>{contacts.map((contact) => <tr key={contact.id}>
            <td>{[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "–"}</td>
            <td>{contact.company || "–"}</td>
            <td>{contact.phone || "–"}</td>
            <td>{contact.email || "–"}</td>
            <td>{[contact.postcode, contact.city].filter(Boolean).join(" ") || "–"}</td>
            <td>{contact.stage || "–"}</td>
            {columns.map((key) => <td key={key}>{contact.felder?.[key] ?? "–"}</td>)}
          </tr>)}</tbody>
        </table></div>}
    {columns.length > 0 && <p className="list-preview-note">Zusatzspalten dieser Liste als Platzhalter in E-Mails: {columns.map((key) => <code key={key}>{`{{${key}}}`}</code>)}</p>}
  </div>;
}
