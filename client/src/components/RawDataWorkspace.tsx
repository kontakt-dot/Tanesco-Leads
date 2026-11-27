import { Button } from "@/components/ui/button";
import { statusStyle } from "@/lib/colors";
import { confirmAction } from "@/lib/confirm";
import { parseCsvLine } from "@/lib/leadCsvImport";
import { leadUrl, openInApp } from "@/lib/navigate";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import { Check, CircleDashed, Copy, FileUp, ListChecks, PhoneCall, Search, Upload, UserCheck, UserX, Users, X } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import type { AppRouter } from "../../../server/routers";
import { RAW_STATUS, rawDoneText, rawOpen, rawSegments, rawShare, rawStatusLabel, rawTotals, type RawCounts, type RawStatus } from "../../../shared/raw-view";

type Batch = inferRouterOutputs<AppRouter>["leadops"]["listRawBatches"][number];
const CONTACT_LIMIT = 300;
const num = (value: number) => value.toLocaleString("de-DE");
const FIELDS: Array<{ key: string; label: string; hints: string[] }> = [
  { key: "firstName", label: "Vorname", hints: ["vorname", "first name", "firstname", "first_name", "given"] },
  { key: "lastName", label: "Nachname", hints: ["nachname", "last name", "lastname", "last_name", "familienname", "surname"] },
  { key: "name", label: "Name (Vor- und Nachname)", hints: ["name", "kunde", "kontakt", "ansprechpartner"] },
  { key: "company", label: "Firma", hints: ["firma", "company", "unternehmen", "betrieb"] },
  { key: "phone", label: "Telefon", hints: ["telefon", "phone", "tel", "mobil", "handy", "rufnummer", "mobile"] },
  { key: "email", label: "E-Mail", hints: ["email", "e-mail", "mail"] },
  { key: "postcode", label: "PLZ", hints: ["plz", "postleitzahl", "zip", "postal"] },
  { key: "city", label: "Ort", hints: ["ort", "stadt", "city", "wohnort"] },
  { key: "country", label: "Land", hints: ["land", "country"] },
  { key: "category", label: "Lead-Kategorie (Kürzel oder Name)", hints: ["kategorie", "sparte", "category", "lead_type", "produkt", "interesse"] },
];
/** Farbe eines Kontakt-Status: Lead = grün, in Wählliste = blau (läuft gerade), doppelt = bernstein; neu und verworfen bleiben ruhig. */
const STATUS_TONE: Record<RawStatus, string> = { neu: "plain", in_liste: "calm", konvertiert: "good", verworfen: "mute", duplikat: "warn" };

async function readFile(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
    const [head = [], ...body] = matrix;
    return { headers: head.map((cell) => String(cell ?? "").trim()), rows: body.filter((row) => row.some((cell) => String(cell ?? "").trim())).map((row) => head.map((_, index) => String(row[index] ?? "").trim())) };
  }
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const delimiter = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const headers = parseCsvLine(lines[0], delimiter).map((cell) => cell.trim());
  return { headers, rows: lines.slice(1).map((line) => parseCsvLine(line, delimiter)) };
}

const guessMapping = (headers: string[]) => { const mapping: Record<string, string> = {}; for (const fieldDef of FIELDS) { const hit = headers.find((header) => fieldDef.hints.some((hint) => header.toLowerCase().replace(/[^a-z0-9äöüß -]/g, "") === hint || header.toLowerCase().includes(hint))); if (hit && !Object.values(mapping).includes(hit)) mapping[fieldDef.key] = hit; } if (mapping.name && (mapping.firstName || mapping.lastName)) delete mapping.name; return mapping; };

/**
 * Rohdaten: hochgeladene Listen mit Kontakten, die noch keine Leads sind. Oben die Zahlen aller Listen als Leiste, darunter je Liste eine Karte
 * (Balken = was aus ihren Kontakten wurde), dann die Auswertung je Kategorie und die Kontakte. Eine Liste auswählen („Kontakte zeigen“)
 * grenzt Auswertung und Kontakte auf diese Liste ein – das steht dann als Marke im Kopf beider Bereiche.
 */
export default function RawDataWorkspace() {
  const utils = trpc.useUtils();
  const batches = trpc.leadops.listRawBatches.useQuery(undefined, { retry: false });
  const [selected, setSelected] = useState<number | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const refresh = () => { utils.leadops.listRawBatches.invalidate(); utils.leadops.listRawContacts.invalidate(); utils.leadops.rawCategoryReport.invalidate(); utils.leadops.listLeadsPaged.invalidate(); utils.leadops.listDialerCampaigns.invalidate(); };
  const list = batches.data ?? []; const totals = rawTotals(list); const open = rawOpen(totals); const share = rawShare(totals.konvertiert, totals.total);
  const chosen = list.find((batch) => batch.id === selected) ?? null;
  const show = (value: number | string) => batches.data ? (typeof value === "number" ? num(value) : value) : "…";
  // „Kontakte zeigen“ an einer Liste: auswählen und dorthin rollen, wo sich etwas ändert
  const focus = (id: number | null) => { setSelected(id); if (id !== null) window.setTimeout(() => document.getElementById("rd-detail")?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 60); };
  return <div className="fx-scope tg rd">
    <header className="page-intro compact"><div><span className="eyebrow">CALLCENTER</span><h1>Rohdaten</h1><p>Listen mit Kontakten, die noch keine Leads sind. Das Callcenter ruft sie an – wer Interesse hat, wird zum Lead und läuft dann wie jeder andere Lead.</p></div><nav className="people-header-actions"><Button className="flux-button" onClick={() => setShowUpload(true)}><Upload aria-hidden="true" /> Liste hochladen</Button></nav></header>
    <section className="tg-rail rd-rail" aria-label="Rohdaten auf einen Blick">
      <div className="tg-stat"><span><Users aria-hidden="true" /> Kontakte</span><strong>{show(totals.total)}</strong><small>{batches.data ? `in ${num(list.length)} ${list.length === 1 ? "Liste" : "Listen"}` : ""}</small></div>
      <div className="tg-stat"><span><CircleDashed aria-hidden="true" /> Noch offen</span><strong>{show(open)}</strong><small>{!batches.data ? "" : totals.in_liste ? `${num(totals.in_liste)} davon in einer Wählliste` : open ? "noch in keiner Wählliste" : "nichts mehr offen"}</small></div>
      <div className="tg-stat"><span><UserCheck aria-hidden="true" /> Zu Leads geworden</span><strong>{show(totals.konvertiert)}{batches.data && totals.total > 0 && <em>{share} %</em>}</strong>{batches.data && <span className="tg-meter" aria-hidden="true" style={{ "--tag": "var(--rd-lead)" } as CSSProperties}><i style={{ width: `${share}%` }} /></span>}<small>{batches.data ? "von allen Kontakten" : ""}</small></div>
      <div className="tg-stat"><span><UserX aria-hidden="true" /> Verworfen</span><strong>{show(totals.verworfen)}</strong><small>{!batches.data ? "" : totals.verworfen ? "lassen sich wieder aufnehmen" : "kein Kontakt verworfen"}</small></div>
      <div className="tg-stat"><span><Copy aria-hidden="true" /> Doppelt</span><strong>{show(totals.duplikat)}</strong><small>{!batches.data ? "" : totals.duplikat ? "gab es schon als Lead oder Kontakt" : "kein Kontakt doppelt"}</small></div>
    </section>
    <BatchList batches={list} loading={batches.isLoading} error={batches.error?.message ?? null} selected={selected} onSelect={setSelected} onFocus={focus} onUpload={() => setShowUpload(true)} onDone={refresh} />
    <CategoryReport batchId={selected} batchName={chosen?.name ?? null} onClear={() => setSelected(null)} />
    <ContactList batchId={selected} batchName={chosen?.name ?? null} counts={chosen ? chosen.counts : batches.data ? totals : null} onClear={() => setSelected(null)} onDone={refresh} />
    <ol className="tg-how" aria-label="So wird aus einem Kontakt ein Lead">
      <li><em>1</em><div><b>Liste hochladen</b><p>CSV oder Excel. Kontakte, die es schon als Lead oder Kontakt gibt, werden als „doppelt“ erkannt.</p></div></li>
      <li><em>2</em><div><b>Abtelefonieren</b><p>„Ins Callcenter“ legt aus der Liste eine Wählliste an. Gewählt wird unter Telefonie.</p></div></li>
      <li><em>3</em><div><b>Aus dem Kontakt wird ein Lead</b><p>Beim Ergebnis „interessiert“ oder „verkauft“ – oder wenn die Gesprächsbewertung ihn freigibt. Ab dann gelten Regeln, Bestellungen und Auslieferung.</p></div></li>
    </ol>
    {showUpload && <UploadDialog onClose={() => setShowUpload(false)} onDone={(batchId) => { setShowUpload(false); setSelected(batchId); refresh(); }} />}
  </div>;
}

/** Marke im Kopf von Auswertung und Kontakten: zeigt, für welche Liste der Bereich gilt – das Kreuz stellt wieder auf alle Listen. */
function ScopeChip({ name, onClear }: { name: string | null; onClear: () => void }) {
  if (!name) return <span className="tg-count">Alle Listen</span>;
  return <span className="rd-scope" title={`Nur die Liste „${name}“`}><span>Liste</span><b>{name}</b><button type="button" aria-label="Alle Listen zeigen" title="Alle Listen zeigen" onClick={onClear}><X aria-hidden="true" /></button></span>;
}

type CategoryReportRow = inferRouterOutputs<AppRouter>["leadops"]["rawCategoryReport"]["categories"][number];
/** Was wurde aus den Rohdaten – je Kategorie: Kontakte → angerufen/erreicht → Ergebnisse → Leads → verkauft. Folgt der gewählten Liste. */
function CategoryReport({ batchId, batchName, onClear }: { batchId: number | null; batchName: string | null; onClear: () => void }) {
  const [open, setOpen] = useState(true);
  const report = trpc.leadops.rawCategoryReport.useQuery({ batchId }, { retry: false, placeholderData: (previous) => previous });
  const rows = report.data?.categories ?? []; const totals = report.data?.totals;
  const pctText = (value: number | null) => value === null ? "–" : `${value} %`;
  const Flow = ({ row }: { row: Pick<CategoryReportRow, "total" | "angerufen" | "erreicht" | "leads" | "leadVerkauft"> }) => { const max = Math.max(1, row.total); const w = (value: number) => `${Math.round((value / max) * 100)}%`; const text = `${row.total} Kontakte · ${row.angerufen} angerufen · ${row.erreicht} erreicht · ${row.leads} Leads · ${row.leadVerkauft} verkauft`; return <span className="rd-flow" role="img" aria-label={text} title={text}><span className="is-called" style={{ width: w(row.angerufen) }} /><span className="is-reached" style={{ width: w(row.erreicht) }} /><span className="is-lead" style={{ width: w(row.leads) }} /><span className="is-sold" style={{ width: w(row.leadVerkauft) }} /></span>; };
  const cells = (row: Omit<CategoryReportRow, "categoryId" | "name" | "shortcode">, strong: boolean) => <>
    <td className="num"><strong>{num(row.total)}</strong></td>
    <td className="rd-flow-cell"><Flow row={row} /></td>
    <td className="num">{num(row.neu + row.inListe)}{row.inListe > 0 && <small>{num(row.inListe)} in Wählliste</small>}</td>
    <td className="num is-group">{num(row.angerufen)}{row.anrufe > row.angerufen && <small>{num(row.anrufe)} Anrufe</small>}</td>
    <td className="num">{num(row.erreicht)}<small>{pctText(row.reachRate)}</small></td>
    <td className="num is-group"><strong className={row.termine && !strong ? "is-good" : ""}>{num(row.termine)}</strong></td>
    <td className="num">{num(row.interessiert)}</td>
    <td className="num">{num(row.wiedervorlage)}</td>
    <td className="num">{num(row.keinInteresse)}</td>
    <td className="num">{num(row.verworfen)}{row.duplikat > 0 && <small>+ {num(row.duplikat)} doppelt</small>}</td>
    <td className="num is-group"><strong>{num(row.leads)}</strong><small>{pctText(row.leadRate)}</small></td>
    <td className="num"><strong className={row.leadVerkauft && !strong ? "is-good" : ""}>{num(row.leadVerkauft)}</strong><small>{pctText(row.saleRate)}</small></td>
    <td className="num">{num(row.leadReklamiert)} / {num(row.leadAussortiert)}{row.leadOffen > 0 && <small>{num(row.leadOffen)} noch offen</small>}</td>
  </>;
  return <section id="rd-detail" className="tg-list rd-report" aria-label="Was wurde aus den Kontakten">
    <div className="tg-list-head"><div><h2>Was wurde aus den Kontakten?</h2><p>Je Kategorie: wie viele Kontakte angerufen und erreicht wurden, was dabei herauskam, wie viele zum Lead wurden – und was aus diesen Leads wurde.</p></div><div className="rd-head-tools"><ScopeChip name={batchId ? batchName ?? `Liste ${batchId}` : null} onClear={onClear} /><button type="button" className="fx-tool" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? "Ausblenden" : "Anzeigen"}</button></div></div>
    {open && (report.isLoading ? <p className="tg-note">Wird berechnet …</p> : report.error ? <p className="tg-note is-bad">{report.error.message}</p> : !rows.length ? <p className="tg-note">Noch keine Kontakte{batchId ? " in dieser Liste" : ""} – also auch noch nichts auszuwerten.</p> : <>
      <div className="rd-table-wrap"><table className="rd-table no-stack">
        <thead>
          <tr className="rd-groups"><th rowSpan={2} scope="col">Kategorie</th><th colSpan={3} scope="colgroup">Kontakte</th><th colSpan={2} scope="colgroup">Am Telefon</th><th colSpan={5} scope="colgroup">Ergebnis</th><th colSpan={3} scope="colgroup">Leads daraus</th></tr>
          <tr><th scope="col">Gesamt</th><th scope="col">Verlauf</th><th scope="col">Offen</th><th scope="col" className="is-group">Angerufen</th><th scope="col">Erreicht</th><th scope="col" className="is-group">Termine</th><th scope="col">Interessiert</th><th scope="col" title="Wiedervorlage">Wiedervorlage</th><th scope="col">Kein Interesse</th><th scope="col" title="Verworfen (+ doppelt)">Verworfen</th><th scope="col" className="is-group">Leads</th><th scope="col">Verkauft</th><th scope="col" title="Reklamiert / aussortiert (fehlerhaft, deaktiviert)">Rekl. / aussort.</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => <tr key={row.categoryId}><th scope="row"><b>{row.name}</b>{row.shortcode && <small>{row.shortcode}</small>}</th>{cells(row, false)}</tr>)}
          {totals && rows.length > 1 && <tr className="rd-total"><th scope="row"><b>Gesamt</b></th>{cells(totals, true)}</tr>}
        </tbody>
      </table></div>
      <p className="rd-flow-legend"><span>Verlauf:</span><span><i className="is-total" /> Kontakte</span><span><i className="is-called" /> angerufen</span><span><i className="is-reached" /> erreicht</span><span><i className="is-lead" /> Lead</span><span><i className="is-sold" /> verkauft</span></p>
    </>)}
  </section>;
}

function BatchList({ batches, loading, error, selected, onSelect, onFocus, onUpload, onDone }: { batches: Batch[]; loading: boolean; error: string | null; selected: number | null; onSelect: (id: number | null) => void; onFocus: (id: number | null) => void; onUpload: () => void; onDone: () => void }) {
  const onError = (failure: { message: string }) => toast.error(failure.message);
  const convertAll = trpc.leadops.convertRawBatch.useMutation({ onSuccess: (result) => { toast.success(`${result.converted} Kontakte als Leads übernommen${result.delivered ? `, ${result.delivered} direkt ausgeliefert` : ""}.`); onDone(); }, onError });
  const remove = trpc.leadops.deleteRawBatch.useMutation({ onSuccess: (result) => { toast.success(result.keptConverted ? `Liste bereinigt, ${result.keptConverted} bereits übernommene Kontakte bleiben.` : "Liste gelöscht."); onSelect(null); onDone(); }, onError });
  const saveCampaign = trpc.leadops.saveDialerCampaign.useMutation({ onError });
  const build = trpc.leadops.buildDialerQueue.useMutation({ onError });
  const activate = trpc.leadops.setDialerCampaignStatus.useMutation({ onError });
  const toDialer = async (batch: Batch) => { const campaign = await saveCampaign.mutateAsync({ name: `Rohdaten: ${batch.name}`, mode: "power", leadFilter: { leadsEnabled: false, rawBatchIds: [batch.id] }, callerNumberId: null, maxAttempts: null, retryMinutes: null, wrapUpSeconds: null, pacingRatio: null, callWindow: null, script: "" }); const built = await build.mutateAsync({ campaignId: campaign.id }); await activate.mutateAsync({ id: campaign.id, status: "aktiv" }); toast.success(`Kampagne angelegt: ${built.added} Nummern in der Wählliste. Unter Telefonie → Wählen starten.`); onDone(); };
  const toLeads = () => openInApp("/?page=Leads");
  const drop = async (batch: Batch) => { if (await confirmAction(`Liste „${batch.name}“ löschen? Bereits übernommene Leads bleiben erhalten.`)) remove.mutate({ batchId: batch.id }); };
  return <section className="tg-list rd-lists" aria-label="Listen">
    <div className="tg-list-head"><div><h2>Listen</h2><p>Jede hochgeladene Datei ist eine Liste. Der Balken zeigt, was aus ihren Kontakten geworden ist.</p></div><span className="tg-count">{num(batches.length)} {batches.length === 1 ? "Liste" : "Listen"}</span></div>
    {loading ? <p className="tg-note">Listen werden geladen …</p> : error ? <p className="tg-note is-bad">{error}</p> : !batches.length ? <div className="rd-empty"><FileUp aria-hidden="true" /><b>Noch keine Liste</b><p>Lade eine CSV- oder Excel-Datei mit Kontakten hoch. Leads entstehen erst, wenn ein Kontakt am Telefon Interesse zeigt.</p><Button className="flux-button" onClick={onUpload}><Upload aria-hidden="true" /> Liste hochladen</Button></div> :
      <div className="rd-batches">{batches.map((batch) => { const on = selected === batch.id; const segments = rawSegments(batch.counts); const open = rawOpen(batch.counts); const done = rawDoneText(batch.counts);
        return <article key={batch.id} className={`rd-batch ${on ? "is-on" : ""}`} aria-label={`Liste ${batch.name}`}>
          <header className="rd-batch-head"><div className="rd-batch-title"><strong>{batch.name}</strong><small>{[new Date(batch.createdAt).toLocaleDateString("de-DE"), batch.createdBy, batch.sourceName ? `Quelle: ${batch.sourceName}` : null].filter(Boolean).join(" · ")}</small></div><span className="rd-cats">{batch.categories.map((category) => <span key={category.id} className={`rd-cat ${category.id === batch.categoryId && batch.categories.length > 1 ? "is-main" : ""}`} title={category.id === batch.categoryId && batch.categories.length > 1 ? `${category.name} (Standard)` : category.name}>{category.shortcode}</span>)}</span></header>
          <p className="rd-batch-nums"><b>{num(batch.counts.total)}</b><span>{batch.counts.total === 1 ? "Kontakt" : "Kontakte"}</span><em className={open ? "" : "is-done"}>{open ? `${num(open)} noch offen` : batch.counts.total ? "keiner mehr offen" : "leer"}</em></p>
          <span className="rd-bar" role="img" aria-label={segments.map((segment) => `${segment.count} ${segment.label}`).join(", ")}>{segments.filter((segment) => segment.count > 0).map((segment) => <i key={segment.key} className={`is-${segment.key}`} style={{ flexGrow: segment.count }} />)}</span>
          <ul className="rd-legend">{segments.map((segment) => <li key={segment.key} className={segment.count ? "" : "is-zero"}><i className={`is-${segment.key}`} aria-hidden="true" /><b>{num(segment.count)}</b> {segment.label}</li>)}</ul>
          {done ? <div className="rd-done"><p>{done}</p>{batch.counts.konvertiert > 0 && <div className="rd-batch-actions"><Button size="sm" variant="outline" onClick={toLeads}>Leads ansehen</Button></div>}</div>
            : <div className="rd-batch-actions"><Button size="sm" variant="outline" onClick={() => void toDialer(batch)} disabled={saveCampaign.isPending || build.isPending || activate.isPending}><PhoneCall aria-hidden="true" /> Ins Callcenter (Wählliste)</Button><Button size="sm" variant="ghost" onClick={async () => { if (await confirmAction("Alle offenen Kontakte dieser Liste sofort als Leads übernehmen? Sie erscheinen dann unter Leads und laufen über die Regeln.")) convertAll.mutate({ batchId: batch.id }); }} disabled={convertAll.isPending}>Alle als Leads übernehmen</Button></div>}
          <footer className="rd-batch-foot"><button type="button" className="rd-pick" aria-pressed={on} onClick={() => (on ? onSelect(null) : onFocus(batch.id))}>{on ? <><Check aria-hidden="true" /> Unten gezeigt – Auswahl aufheben</> : <><ListChecks aria-hidden="true" /> Kontakte zeigen</>}</button><button type="button" className="rd-drop" disabled={remove.isPending} onClick={() => void drop(batch)}>Löschen</button></footer>
        </article>; })}</div>}
  </section>;
}

function ContactList({ batchId, batchName, counts, onClear, onDone }: { batchId: number | null; batchName: string | null; counts: RawCounts | null; onClear: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<RawStatus | "">(""); const [search, setSearch] = useState(""); const [chosen, setChosen] = useState<Record<number, number>>({});
  const categories = trpc.leadops.listCategories.useQuery(undefined, { retry: false });
  const contacts = trpc.leadops.listRawContacts.useQuery({ batchId, status: status || null, search: search.trim() || null, limit: CONTACT_LIMIT }, { retry: false, placeholderData: (previous) => previous });
  const onError = (failure: { message: string }) => toast.error(failure.message);
  const convert = trpc.leadops.convertRawContact.useMutation({ onSuccess: (result) => { toast.success(result.alreadyConverted ? `Bereits Lead ${result.publicId}.` : `Lead ${result.publicId} angelegt${result.automation?.delivered ? " und ausgeliefert" : ""}.`); onDone(); }, onError });
  const discard = trpc.leadops.discardRawContact.useMutation({ onSuccess: onDone, onError });
  const restore = trpc.leadops.restoreRawContact.useMutation({ onSuccess: onDone, onError });
  const rows = contacts.data ?? []; const searching = search.trim().length > 0;
  // Zahlen an den Reitern: aus den Listen. Während einer Suche stimmen sie nicht für die Treffer – dann stehen die Reiter ohne Zahl da.
  const tabCount = (key: RawStatus | "") => !counts || searching ? null : key === "" ? counts.total : counts[key];
  const shortcodeOf = (id: number) => (categories.data ?? []).find((item) => item.id === id)?.shortcode ?? String(id);
  return <section className="tg-list rd-contacts" aria-label="Kontakte">
    <div className="tg-list-head"><div><h2>Kontakte</h2><p>{batchId ? "Die Kontakte dieser einen Liste." : "Die Kontakte aus allen Listen."} Offene Kontakte kannst du von Hand zum Lead machen oder verwerfen.</p></div><div className="rd-head-tools"><ScopeChip name={batchId ? batchName ?? `Liste ${batchId}` : null} onClear={onClear} /></div></div>
    <div className="fx-toolrow">
      <div className="fx-tabs" role="tablist" aria-label="Kontakte nach Status">{([["", "Alle"], ...RAW_STATUS] as Array<[RawStatus | "", string]>).map(([key, label]) => { const count = tabCount(key); return <button key={key || "alle"} type="button" role="tab" aria-selected={status === key} className={status === key ? "active" : ""} onClick={() => setStatus(key)}>{label}<span>{count === null ? "" : num(count)}</span></button>; })}</div>
      <label className="fx-search"><Search aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, Firma, Telefon, E-Mail oder Ort" aria-label="Kontakte durchsuchen" />{search && <button type="button" aria-label="Suche leeren" onClick={() => setSearch("")}><X aria-hidden="true" /></button>}</label>
    </div>
    {contacts.isLoading ? <p className="tg-note">Kontakte werden geladen …</p> : contacts.error ? <p className="tg-note is-bad">{contacts.error.message}</p> : !rows.length ? <div className="rd-none"><p>{searching ? `Zur Suche „${search.trim()}“ gibt es keinen Kontakt${status ? ` mit dem Status „${rawStatusLabel(status)}“` : ""}.` : status ? `Kein Kontakt mit dem Status „${rawStatusLabel(status)}“.` : batchId ? "In dieser Liste sind keine Kontakte." : "Noch keine Kontakte – lade oben eine Liste hoch."}</p>{(searching || status) && <button type="button" className="fx-tool" onClick={() => { setSearch(""); setStatus(""); }}>Alle Kontakte zeigen</button>}</div> : <>
      <div className="rd-rows-head" aria-hidden="true"><span>Kontakt</span><span>Telefon / E-Mail</span><span>Ort</span><span>Liste</span><span>Status</span><span>Aktion</span></div>
      <ul className="rd-rows">{rows.map((contact) => { const isOpen = contact.status === "neu" || contact.status === "in_liste"; const place = [contact.postcode, contact.city].filter(Boolean).join(" "); return <li key={contact.id} className="rd-row">
        <span className="rd-who"><b>{contact.name}</b>{contact.company && contact.name !== contact.company && <small>{contact.company}</small>}</span>
        <span className="rd-reach"><span>{contact.phone ?? "–"}</span>{contact.email && <small>{contact.email}</small>}</span>
        <span className="rd-place">{place || "–"}</span>
        <span className="rd-from">{contact.categoryShortcode && <span className="rd-cat">{contact.categoryShortcode}</span>}<small>{contact.batchName}</small></span>
        <span className="rd-state"><span className={`fx-pill is-${STATUS_TONE[contact.status]}`}>{rawStatusLabel(contact.status)}</span>{contact.leadPublicId && <span className="rd-lead"><button type="button" title="Lead öffnen" onClick={() => openInApp(leadUrl(contact.leadPublicId!))}>{contact.leadPublicId}</button>{contact.leadStatus && <small>{statusStyle(contact.leadStatus).label}</small>}</span>}{contact.note && <small className="rd-note">{contact.note}</small>}</span>
        <span className="rd-acts">{isOpen && <>{contact.batchCategoryIds.length > 1 && <select className="fx-select" value={chosen[contact.id] ?? contact.categoryId ?? contact.batchCategoryIds[0]} onChange={(event) => setChosen((state) => ({ ...state, [contact.id]: Number(event.target.value) }))} title="Kategorie für den Lead" aria-label={`Kategorie für ${contact.name}`}>{contact.batchCategoryIds.map((id) => <option key={id} value={id}>{shortcodeOf(id)}</option>)}</select>}<Button size="sm" variant="outline" onClick={() => convert.mutate({ id: contact.id, initialStatus: "neu", categoryId: chosen[contact.id] ?? contact.categoryId ?? null })} disabled={convert.isPending}>Als Lead übernehmen</Button><Button size="sm" variant="ghost" onClick={() => discard.mutate({ id: contact.id, note: "Manuell verworfen" })} disabled={discard.isPending}>Verwerfen</Button></>}{(contact.status === "verworfen" || contact.status === "duplikat") && <Button size="sm" variant="ghost" onClick={() => restore.mutate({ id: contact.id })} disabled={restore.isPending}>Wieder aufnehmen</Button>}</span>
      </li>; })}</ul>
      {rows.length >= CONTACT_LIMIT && <p className="rd-more">Hier stehen die ersten {CONTACT_LIMIT} Kontakte. Die übrigen findest du mit der Suche oder über einen Reiter.</p>}
    </>}
  </section>;
}

/** Datei hineinziehen oder klicken – CSV und Excel. */
function FileDrop({ fileName, rows, onFile }: { fileName: string | null; rows: number; onFile: (file: File | undefined) => void }) {
  const [over, setOver] = useState(false);
  return <label className={`ld-drop ${over ? "is-over" : ""}`}
    onDragEnter={(event) => { event.preventDefault(); setOver(true); }} onDragOver={(event) => { event.preventDefault(); setOver(true); }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); }}
    onDrop={(event) => { event.preventDefault(); setOver(false); onFile(event.dataTransfer.files?.[0]); }}>
    <input type="file" className="sr-only" accept=".csv,.txt,.xlsx,.xls" aria-label="CSV- oder Excel-Datei auswählen" onChange={(event) => { onFile(event.target.files?.[0]); try { event.target.value = ""; } catch { /* dieselbe Datei lässt sich so noch einmal wählen */ } }} />
    <FileUp aria-hidden="true" />
    <span className="ld-drop-text"><b>{over ? "Loslassen – die Datei wird eingelesen" : fileName ?? "CSV- oder Excel-Datei hierher ziehen"}</b><small>{fileName && !over ? `${num(rows)} Zeilen gelesen · andere Datei hierher ziehen oder klicken` : "oder klicken und Datei auswählen"}</small></span>
  </label>;
}

function UploadDialog({ onClose, onDone }: { onClose: () => void; onDone: (batchId: number) => void }) {
  const categories = trpc.leadops.listCategories.useQuery(undefined, { retry: false }); const suppliers = trpc.leadops.listSuppliers.useQuery(undefined, { retry: false });
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: string[][] } | null>(null); const [mapping, setMapping] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: "", categoryId: "", categoryIds: [] as number[], supplierId: "", sourceName: "" });
  const [busy, setBusy] = useState(false);
  const create = trpc.leadops.createRawBatch.useMutation();
  const onFile = async (input: File | undefined) => { if (!input) return; if (!/\.(csv|txt|xlsx|xls)$/i.test(input.name)) return toast.error("Bitte eine CSV- oder Excel-Datei wählen (.csv, .xlsx, .xls)."); try { const parsed = await readFile(input); if (!parsed.headers.length) return toast.error("Die Datei hat keine Kopfzeile."); setFile({ name: input.name, ...parsed }); setMapping(guessMapping(parsed.headers)); setForm((state) => ({ ...state, name: state.name || input.name.replace(/\.[^.]+$/, "") })); } catch (error) { toast.error(error instanceof Error ? error.message : "Datei konnte nicht gelesen werden."); } };
  const preview = useMemo(() => { if (!file) return []; const index = (key: string) => file.headers.indexOf(mapping[key] ?? ""); return file.rows.slice(0, 5).map((row) => { const cell = (key: string) => (index(key) >= 0 ? row[index(key)] : ""); const name = cell("name"); const [first, ...rest] = name.split(/\s+/); return { firstName: cell("firstName") || (name ? first : ""), lastName: cell("lastName") || (name ? rest.join(" ") : ""), company: cell("company"), phone: cell("phone"), email: cell("email"), city: [cell("postcode"), cell("city")].filter(Boolean).join(" "), category: cell("category") }; }); }, [file, mapping]);
  const mappedCount = FIELDS.filter((item) => mapping[item.key]).length;
  // Nur Zeilen mit Telefon oder E-Mail werden Kontakte – so steht schon vor dem Hochladen da, wie viele es werden
  const usable = useMemo(() => { if (!file) return 0; const phone = file.headers.indexOf(mapping.phone ?? ""); const email = file.headers.indexOf(mapping.email ?? ""); return file.rows.filter((row) => (phone >= 0 && row[phone]?.trim()) || (email >= 0 && row[email]?.trim())).length; }, [file, mapping]);
  const skippedRows = (file?.rows.length ?? 0) - usable;
  const missing = [!file ? "die Datei" : null, !form.categoryIds.length ? "eine Lead-Kategorie" : null, file && !mapping.phone && !mapping.email ? "die Spalte für Telefon oder E-Mail" : null].filter(Boolean);
  const submit = async () => {
    if (!file || !form.categoryId) return toast.error("Bitte Datei und mindestens eine Lead-Kategorie wählen.");
    if (!mapping.phone && !mapping.email) return toast.error("Bitte mindestens Telefon oder E-Mail zuordnen.");
    setBusy(true);
    try {
      const index = (key: string) => file.headers.indexOf(mapping[key] ?? "");
      const used = new Set(Object.values(mapping));
      const rows = file.rows.map((row) => { const cell = (key: string) => (index(key) >= 0 ? row[index(key)]?.trim() ?? "" : ""); const name = cell("name"); const [first, ...rest] = name.split(/\s+/); const data: Record<string, unknown> = {}; file.headers.forEach((header, i) => { if (header && !used.has(header) && row[i]?.trim()) data[header] = row[i].trim(); }); return { firstName: cell("firstName") || (name ? first : "") || null, lastName: cell("lastName") || (name ? rest.join(" ") : "") || null, company: cell("company") || null, phone: cell("phone") || null, email: cell("email") || null, postcode: cell("postcode") || null, city: cell("city") || null, country: cell("country") || null, category: cell("category") || null, data }; }).filter((row) => row.phone || row.email);
      if (!rows.length) return toast.error("Keine Zeile mit Telefon oder E-Mail gefunden.");
      let batchId = 0; let imported = 0; let duplicates = 0; let skipped = 0; let unmatched = 0;
      for (let start = 0; start < rows.length; start += 2000) { const result = await create.mutateAsync({ name: start === 0 ? form.name || file.name : `${form.name || file.name} (Teil ${Math.floor(start / 2000) + 1})`, categoryId: Number(form.categoryId), categoryIds: form.categoryIds, supplierId: form.supplierId ? Number(form.supplierId) : null, sourceName: form.sourceName || null, mapping, rows: rows.slice(start, start + 2000) }); batchId = batchId || result.batchId; imported += result.imported; duplicates += result.duplicates; skipped += result.skipped; unmatched += result.unmatchedCategories ?? 0; }
      toast.success(`${imported} Kontakte übernommen (${duplicates} doppelt, ${skipped} ohne Kontaktdaten übersprungen${unmatched ? `, ${unmatched} mit unbekannter Kategorie → Standard` : ""}).`);
      onDone(batchId);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Upload fehlgeschlagen."); } finally { setBusy(false); }
  };
  const toggleCategory = (id: number) => setForm((state) => { const active = state.categoryIds.includes(id); const categoryIds = active ? state.categoryIds.filter((item) => item !== id) : [...state.categoryIds, id]; const categoryId = categoryIds.includes(Number(state.categoryId)) ? state.categoryId : String(categoryIds[0] ?? ""); return { ...state, categoryIds, categoryId }; });
  return <div className="fx-scope rd-shade" onClick={onClose}><section className="rd-upload" role="dialog" aria-modal="true" aria-label="Liste hochladen" onClick={(event) => event.stopPropagation()}>
    <header className="ld-head"><div><h2>Liste hochladen</h2><p>CSV oder Excel mit Kopfzeile. Die Spalten werden von selbst erkannt – du kannst sie unten ändern. Alle weiteren Spalten wandern als Zusatzinfos mit in den Lead.</p></div><button type="button" className="ld-close" aria-label="Schließen" onClick={onClose}><X aria-hidden="true" /></button></header>
    <ol className="rd-steps">
      <li><em>1</em><div><b>Datei</b><FileDrop fileName={file?.name ?? null} rows={file?.rows.length ?? 0} onFile={(input) => void onFile(input)} /></div></li>
      <li><em>2</em><div><b>Lead-Kategorie</b><p>Eine oder mehrere. Der Lead bekommt später die Kategorie aus der Spalte der Datei, aus der Auswahl beim Anruf – oder die Standard-Kategorie.</p>
        <div className="rd-chips">{(categories.data ?? []).map((category) => { const active = form.categoryIds.includes(category.id); return <button key={category.id} type="button" className={active ? "is-on" : ""} aria-pressed={active} onClick={() => toggleCategory(category.id)}>{active && <Check aria-hidden="true" />}{category.name} <small>{category.shortcode}</small></button>; })}{categories.data && !categories.data.length && <span className="rd-hint">Es gibt noch keine Lead-Kategorie. Lege zuerst eine unter „Lead-Kategorien“ an.</span>}</div>
        {form.categoryIds.length > 1 && <label className="rd-field rd-field-narrow"><span>Standard-Kategorie</span><select className="fx-select" value={form.categoryId} onChange={(event) => setForm((state) => ({ ...state, categoryId: event.target.value }))}>{form.categoryIds.map((id) => { const category = (categories.data ?? []).find((item) => item.id === id); return <option key={id} value={id}>{category?.name} ({category?.shortcode})</option>; })}</select></label>}
      </div></li>
      <li><em>3</em><div><b>Angaben zur Liste</b><div className="rd-fields"><label className="rd-field"><span>Name der Liste</span><input className="fx-field" value={form.name} onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))} placeholder="z. B. Messe Hannover" /></label><label className="rd-field"><span>Quelle (freiwillig)</span><input className="fx-field" value={form.sourceName} onChange={(event) => setForm((state) => ({ ...state, sourceName: event.target.value }))} placeholder="z. B. Messe, Portal" /></label><label className="rd-field"><span>Lieferant (freiwillig)</span><select className="fx-select" value={form.supplierId} onChange={(event) => setForm((state) => ({ ...state, supplierId: event.target.value }))}><option value="">keiner</option>{(suppliers.data ?? []).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label></div></div></li>
      {file && <li><em>4</em><div><b>Spalten zuordnen</b><p>{num(file.rows.length)} Zeilen · {mappedCount} Felder erkannt. Telefon oder E-Mail muss zugeordnet sein.</p>
        <div className="rd-fields is-map">{FIELDS.map((item) => <label key={item.key} className="rd-field"><span>{item.label}</span><select className="fx-select" value={mapping[item.key] ?? ""} onChange={(event) => setMapping((state) => { const next = { ...state }; if (event.target.value) next[item.key] = event.target.value; else delete next[item.key]; return next; })}><option value="">nicht vorhanden</option>{file.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div>
        <div className="rd-table-wrap rd-preview"><table className="rd-table no-stack"><caption>So werden die ersten Zeilen gelesen</caption><thead><tr><th scope="col">Vorname</th><th scope="col">Nachname</th><th scope="col">Firma</th><th scope="col">Telefon</th><th scope="col">E-Mail</th><th scope="col">Ort</th><th scope="col">Kategorie</th></tr></thead><tbody>{preview.map((row, index) => <tr key={index}><td>{row.firstName || "–"}</td><td>{row.lastName || "–"}</td><td>{row.company || "–"}</td><td>{row.phone || "–"}</td><td>{row.email || "–"}</td><td>{row.city || "–"}</td><td>{row.category || "Standard"}</td></tr>)}</tbody></table></div>
      </div></li>}
    </ol>
    <footer className="rd-upload-foot"><p>{missing.length ? `Es fehlt noch: ${missing.join(", ")}.` : skippedRows > 0 ? (skippedRows === 1 ? "1 Zeile ohne Telefon und E-Mail wird übersprungen." : `${num(skippedRows)} Zeilen ohne Telefon und E-Mail werden übersprungen.`) : "Alles da – die Liste kann hochgeladen werden."}</p><div className="ld-actions"><Button variant="outline" onClick={onClose}>Abbrechen</Button><Button className="flux-button" onClick={() => void submit()} disabled={busy || !file || !form.categoryIds.length}>{busy ? "Lädt hoch …" : file && usable > 0 ? `${num(usable)} ${usable === 1 ? "Kontakt" : "Kontakte"} hochladen` : "Hochladen"}</Button></div></footer>
  </section></div>;
}
