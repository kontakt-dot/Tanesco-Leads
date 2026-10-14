import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseCsvLine } from "@/lib/leadCsvImport";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { confirmAction } from "@/lib/confirm";

type Batch = inferRouterOutputs<AppRouter>["leadops"]["listRawBatches"][number];
type Contact = inferRouterOutputs<AppRouter>["leadops"]["listRawContacts"][number];
const field = "h-10 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100";
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
const statusLabel: Record<string, string> = { neu: "Neu", in_liste: "In Wählliste", konvertiert: "Lead", verworfen: "Verworfen", duplikat: "Doppelt" };
const statusClass = (status: string) => status === "konvertiert" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : status === "verworfen" ? "border-white/15 text-slate-500" : status === "duplikat" ? "border-amber-400/25 bg-amber-500/10 text-amber-200" : status === "in_liste" ? "border-red-400/30 bg-red-500/10 text-red-100" : "border-white/15 text-slate-300";

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

export default function RawDataWorkspace() {
  const utils = trpc.useUtils();
  const batches = trpc.leadops.listRawBatches.useQuery(undefined, { retry: false });
  const [selected, setSelected] = useState<number | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const refresh = () => { utils.leadops.listRawBatches.invalidate(); utils.leadops.listRawContacts.invalidate(); utils.leadops.listLeadsPaged.invalidate(); utils.leadops.listDialerCampaigns.invalidate(); };
  const totals = (batches.data ?? []).reduce((sum, batch) => ({ total: sum.total + batch.counts.total, neu: sum.neu + batch.counts.neu + batch.counts.in_liste, konvertiert: sum.konvertiert + batch.counts.konvertiert, verworfen: sum.verworfen + batch.counts.verworfen, duplikat: sum.duplikat + batch.counts.duplikat }), { total: 0, neu: 0, konvertiert: 0, verworfen: 0, duplikat: 0 });
  return <>
    <header className="page-intro compact"><div><span className="eyebrow">CALLCENTER</span><h1>Rohdaten</h1><p>Listen hochladen (CSV oder Excel), die noch keine Leads sind. Das Callcenter telefoniert sie ab; erst wenn ein Kontakt qualifiziert ist – Ergebnis „interessiert/verkauft“ oder Freigabe der Gesprächsbewertung – wird er zum Lead, erscheint unter Leads und läuft über Regeln, Bestellungen und Auslieferung wie jeder andere Lead.</p></div><nav className="people-header-actions"><Button className="flux-button" onClick={() => setShowUpload(true)}>Liste hochladen</Button></nav></header>
    <div className="mb-4 grid gap-3 md:grid-cols-5">{[["Kontakte", totals.total], ["Offen", totals.neu], ["Zu Leads geworden", totals.konvertiert], ["Verworfen", totals.verworfen], ["Doppelt", totals.duplikat]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-white/8 bg-white/[.02] p-3"><span className="eyebrow">{label}</span><div className="mt-1 text-lg text-slate-100">{value}</div></div>)}</div>
    <div className="grid gap-4">
      <BatchList batches={batches.data ?? []} selected={selected} onSelect={setSelected} onDone={refresh} />
      <ContactList batchId={selected} onDone={refresh} />
    </div>
    {showUpload && <UploadDialog onClose={() => setShowUpload(false)} onDone={(batchId) => { setShowUpload(false); setSelected(batchId); refresh(); }} />}
  </>;
}

function BatchList({ batches, selected, onSelect, onDone }: { batches: Batch[]; selected: number | null; onSelect: (id: number | null) => void; onDone: () => void }) {
  const onError = (error: { message: string }) => toast.error(error.message);
  const convertAll = trpc.leadops.convertRawBatch.useMutation({ onSuccess: (result) => { toast.success(`${result.converted} Kontakte als Leads übernommen${result.delivered ? `, ${result.delivered} direkt ausgeliefert` : ""}.`); onDone(); }, onError });
  const remove = trpc.leadops.deleteRawBatch.useMutation({ onSuccess: (result) => { toast.success(result.keptConverted ? `Liste bereinigt, ${result.keptConverted} bereits übernommene Kontakte bleiben.` : "Liste gelöscht."); onSelect(null); onDone(); }, onError });
  const saveCampaign = trpc.leadops.saveDialerCampaign.useMutation({ onError });
  const build = trpc.leadops.buildDialerQueue.useMutation({ onError });
  const activate = trpc.leadops.setDialerCampaignStatus.useMutation({ onError });
  const toDialer = async (batch: Batch) => { const campaign = await saveCampaign.mutateAsync({ name: `Rohdaten: ${batch.name}`, mode: "power", leadFilter: { leadsEnabled: false, rawBatchIds: [batch.id] }, callerNumberId: null, maxAttempts: null, retryMinutes: null, wrapUpSeconds: null, pacingRatio: null, callWindow: null, script: "" }); const built = await build.mutateAsync({ campaignId: campaign.id }); await activate.mutateAsync({ id: campaign.id, status: "aktiv" }); toast.success(`Kampagne angelegt: ${built.added} Nummern in der Wählliste. Unter Telefonie → Wählen starten.`); onDone(); };
  return <section className="surface-panel operations-panel p-5"><span className="eyebrow">LISTEN</span>
    <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{batches.map((batch) => <div key={batch.id} className={`cursor-pointer rounded-lg border p-3 ${selected === batch.id ? "border-violet-400/40 bg-violet-500/10" : "border-white/8 bg-white/[.02]"}`} onClick={() => onSelect(selected === batch.id ? null : batch.id)}><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-slate-100">{batch.name}</strong>{batch.categories.map((category) => <Badge key={category.id} variant="outline" className={category.id === batch.categoryId ? "border-red-400/40 bg-red-500/10 text-red-100" : "border-white/15 text-slate-300"} title={category.id === batch.categoryId ? `${category.name} (Standard)` : category.name}>{category.shortcode}</Badge>)}{batch.sourceName && <span className="text-xs text-slate-500">{batch.sourceName}</span>}<span className="ml-auto text-xs text-slate-500">{new Date(batch.createdAt).toLocaleDateString("de-DE")}{batch.createdBy ? ` · ${batch.createdBy}` : ""}</span></div><div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400"><span>{batch.counts.total} Kontakte</span><span>· {batch.counts.neu} offen</span><span>· {batch.counts.in_liste} in Wählliste</span><span className="text-emerald-200">· {batch.counts.konvertiert} Leads</span><span>· {batch.counts.verworfen} verworfen</span>{batch.counts.duplikat > 0 && <span className="text-amber-200">· {batch.counts.duplikat} doppelt</span>}</div><div className="mt-2 flex flex-wrap gap-1" onClick={(event) => event.stopPropagation()}><Button size="sm" variant="outline" onClick={() => toDialer(batch)} disabled={saveCampaign.isPending || build.isPending || batch.counts.neu + batch.counts.in_liste === 0}>Ins Callcenter (Wählliste)</Button><Button size="sm" variant="ghost" onClick={async () => { if (await confirmAction("Alle offenen Kontakte dieser Liste sofort als Leads übernehmen? Sie erscheinen dann unter Leads und laufen über die Regeln.")) convertAll.mutate({ batchId: batch.id }); }} disabled={convertAll.isPending || batch.counts.neu + batch.counts.in_liste === 0}>Alle als Leads übernehmen</Button><Button size="sm" variant="ghost" onClick={async () => { if (await confirmAction("Liste löschen? Bereits übernommene Leads bleiben erhalten.")) remove.mutate({ batchId: batch.id }); }}>Löschen</Button></div></div>)}{!batches.length && <p className="text-sm text-slate-500">Noch keine Liste. Klicke oben auf „Liste hochladen“.</p>}</div></section>;
}

function ContactList({ batchId, onDone }: { batchId: number | null; onDone: () => void }) {
  const [status, setStatus] = useState<string>(""); const [search, setSearch] = useState(""); const [chosen, setChosen] = useState<Record<number, number>>({});
  const categories = trpc.leadops.listCategories.useQuery(undefined, { retry: false });
  const contacts = trpc.leadops.listRawContacts.useQuery({ batchId, status: (status || null) as Contact["status"] | null, search: search || null, limit: 300 }, { retry: false });
  const onError = (error: { message: string }) => toast.error(error.message);
  const convert = trpc.leadops.convertRawContact.useMutation({ onSuccess: (result) => { toast.success(result.alreadyConverted ? `Bereits Lead ${result.publicId}.` : `Lead ${result.publicId} angelegt${result.automation?.delivered ? " und ausgeliefert" : ""}.`); onDone(); }, onError });
  const discard = trpc.leadops.discardRawContact.useMutation({ onSuccess: onDone, onError });
  const restore = trpc.leadops.restoreRawContact.useMutation({ onSuccess: onDone, onError });
  return <section className="surface-panel operations-panel overflow-hidden"><div className="flex flex-wrap items-center gap-2 p-3"><span className="eyebrow">KONTAKTE{batchId ? " DER LISTE" : " (ALLE LISTEN)"}</span><span className="flex-1" /><Input className="max-w-[200px]" placeholder="Suchen …" value={search} onChange={(event) => setSearch(event.target.value)} /><select className={`${field} max-w-[170px]`} value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Alle Status</option>{Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
    <div className="table-wrap wrap-cells"><table className="flux-table"><thead><tr><th>Kontakt</th><th>Telefon / E-Mail</th><th>Ort</th><th>Liste</th><th>Status</th><th>Aktion</th></tr></thead><tbody>{(contacts.data ?? []).map((contact) => <tr key={contact.id}><td><div className="text-slate-100">{contact.name}</div>{contact.company && contact.name !== contact.company && <div className="text-xs text-slate-500">{contact.company}</div>}</td><td><div>{contact.phone ?? "–"}</div><div className="text-xs text-slate-500">{contact.email ?? ""}</div></td><td>{[contact.postcode, contact.city].filter(Boolean).join(" ") || "–"}</td><td className="text-xs text-slate-400">{contact.batchName}{contact.categoryShortcode && <div className="mt-1"><Badge variant="outline" className="border-white/15 text-slate-300">{contact.categoryShortcode}</Badge></div>}</td><td><Badge variant="outline" className={statusClass(contact.status)}>{statusLabel[contact.status]}</Badge>{contact.leadPublicId && <div className="mt-1 text-xs"><button type="button" className="font-mono text-violet-200" onClick={() => window.location.assign(`/?page=Leads&leadId=${contact.leadPublicId}`)}>{contact.leadPublicId}</button> <span className="text-slate-500">{contact.leadStatus}</span></div>}{contact.note && <div className="mt-1 text-[11px] text-slate-500">{contact.note}</div>}</td><td><div className="flex flex-wrap gap-1">{(contact.status === "neu" || contact.status === "in_liste") && <>{contact.batchCategoryIds.length > 1 && <select className="h-8 rounded-md border border-white/10 bg-slate-900 px-2 text-xs text-slate-100" value={chosen[contact.id] ?? contact.categoryId ?? contact.batchCategoryIds[0]} onChange={(event) => setChosen((state) => ({ ...state, [contact.id]: Number(event.target.value) }))} title="Kategorie für den Lead">{contact.batchCategoryIds.map((id) => { const category = (categories.data ?? []).find((item) => item.id === id); return <option key={id} value={id}>{category?.shortcode ?? id}</option>; })}</select>}<Button size="sm" variant="outline" onClick={() => convert.mutate({ id: contact.id, initialStatus: "neu", categoryId: chosen[contact.id] ?? contact.categoryId ?? null })} disabled={convert.isPending}>Als Lead übernehmen</Button><Button size="sm" variant="ghost" onClick={() => discard.mutate({ id: contact.id, note: "Manuell verworfen" })}>Verwerfen</Button></>}{(contact.status === "verworfen" || contact.status === "duplikat") && <Button size="sm" variant="ghost" onClick={() => restore.mutate({ id: contact.id })}>Wieder aufnehmen</Button>}</div></td></tr>)}</tbody></table>{!contacts.data?.length && <p className="p-6 text-center text-sm text-slate-500">Keine Kontakte.</p>}</div></section>;
}

function UploadDialog({ onClose, onDone }: { onClose: () => void; onDone: (batchId: number) => void }) {
  const categories = trpc.leadops.listCategories.useQuery(undefined, { retry: false }); const suppliers = trpc.leadops.listSuppliers.useQuery(undefined, { retry: false });
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: string[][] } | null>(null); const [mapping, setMapping] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: "", categoryId: "", categoryIds: [] as number[], supplierId: "", sourceName: "" });
  const [busy, setBusy] = useState(false);
  const create = trpc.leadops.createRawBatch.useMutation();
  const onFile = async (input: File | undefined) => { if (!input) return; try { const parsed = await readFile(input); if (!parsed.headers.length) return toast.error("Die Datei hat keine Kopfzeile."); setFile({ name: input.name, ...parsed }); setMapping(guessMapping(parsed.headers)); setForm((state) => ({ ...state, name: state.name || input.name.replace(/\.[^.]+$/, "") })); } catch (error) { toast.error(error instanceof Error ? error.message : "Datei konnte nicht gelesen werden."); } };
  const preview = useMemo(() => { if (!file) return []; const index = (key: string) => file.headers.indexOf(mapping[key] ?? ""); return file.rows.slice(0, 5).map((row) => { const cell = (key: string) => (index(key) >= 0 ? row[index(key)] : ""); const name = cell("name"); const [first, ...rest] = name.split(/\s+/); return { firstName: cell("firstName") || (name ? first : ""), lastName: cell("lastName") || (name ? rest.join(" ") : ""), company: cell("company"), phone: cell("phone"), email: cell("email"), city: [cell("postcode"), cell("city")].filter(Boolean).join(" "), category: cell("category") }; }); }, [file, mapping]);
  const mappedCount = FIELDS.filter((item) => mapping[item.key]).length;
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
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 px-4 py-6" onClick={onClose}><section className="surface-panel operations-panel mx-auto w-full max-w-4xl p-6" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-3"><div><span className="eyebrow">ROHDATEN</span><h2 className="mt-1 text-lg text-slate-100">Liste hochladen</h2><p className="mt-1 text-xs text-slate-400">CSV oder Excel mit Kopfzeile. Die Spalten werden automatisch erkannt und können unten korrigiert werden. Alle weiteren Spalten wandern als Zusatzinfos mit in den Lead.</p></div><Button variant="ghost" size="sm" onClick={onClose}>Schließen</Button></div>
    <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-xs text-slate-300">Datei<input type="file" accept=".csv,.txt,.xlsx,.xls" className="mt-1 block w-full text-sm text-slate-300" onChange={(event) => onFile(event.target.files?.[0])} /></label><div className="text-xs text-slate-300 md:col-span-2">Lead-Kategorien (eine oder mehrere; der Lead bekommt beim Übernehmen die Kategorie aus der Spalte, der Auswahl beim Anruf oder die Standard-Kategorie)<div className="mt-1 flex flex-wrap gap-1">{(categories.data ?? []).map((category) => { const active = form.categoryIds.includes(category.id); return <button key={category.id} type="button" className={`rounded-full border px-2 py-0.5 text-xs ${active ? "border-violet-400/40 bg-violet-500/15 text-violet-100" : "border-white/10 text-slate-400"}`} onClick={() => setForm((state) => { const categoryIds = active ? state.categoryIds.filter((id) => id !== category.id) : [...state.categoryIds, category.id]; const categoryId = categoryIds.includes(Number(state.categoryId)) ? state.categoryId : String(categoryIds[0] ?? ""); return { ...state, categoryIds, categoryId }; })}>{category.name} ({category.shortcode})</button>; })}</div>{form.categoryIds.length > 1 && <label className="mt-2 block text-xs text-slate-300">Standard-Kategorie<select className={field} value={form.categoryId} onChange={(event) => setForm((state) => ({ ...state, categoryId: event.target.value }))}>{form.categoryIds.map((id) => { const category = (categories.data ?? []).find((item) => item.id === id); return <option key={id} value={id}>{category?.name} ({category?.shortcode})</option>; })}</select></label>}</div><label className="text-xs text-slate-300">Bezeichnung der Liste<Input value={form.name} onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))} /></label><label className="text-xs text-slate-300">Quelle (optional, z. B. Messe, Portal)<Input value={form.sourceName} onChange={(event) => setForm((state) => ({ ...state, sourceName: event.target.value }))} /></label><label className="text-xs text-slate-300">Lieferant zuordnen (optional)<select className={field} value={form.supplierId} onChange={(event) => setForm((state) => ({ ...state, supplierId: event.target.value }))}><option value="">— keiner —</option>{(suppliers.data ?? []).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label></div>
    {file && <><div className="mt-4"><span className="eyebrow">SPALTEN ZUORDNEN</span><span className="ml-2 text-xs text-slate-500">{file.rows.length} Zeilen · {mappedCount} Felder erkannt</span><div className="mt-2 grid gap-2 md:grid-cols-3">{FIELDS.map((item) => <label key={item.key} className="text-xs text-slate-300">{item.label}<select className={field} value={mapping[item.key] ?? ""} onChange={(event) => setMapping((state) => { const next = { ...state }; if (event.target.value) next[item.key] = event.target.value; else delete next[item.key]; return next; })}><option value="">— nicht vorhanden —</option>{file.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div></div>
      <div className="mt-4"><span className="eyebrow">VORSCHAU</span><div className="table-wrap wrap-cells mt-2"><table className="flux-table"><thead><tr><th>Vorname</th><th>Nachname</th><th>Firma</th><th>Telefon</th><th>E-Mail</th><th>Ort</th><th>Kategorie</th></tr></thead><tbody>{preview.map((row, index) => <tr key={index}><td>{row.firstName || "–"}</td><td>{row.lastName || "–"}</td><td>{row.company || "–"}</td><td>{row.phone || "–"}</td><td>{row.email || "–"}</td><td>{row.city || "–"}</td><td>{row.category || "Standard"}</td></tr>)}</tbody></table></div></div></>}
    <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={onClose}>Abbrechen</Button><Button className="flux-button" size="sm" onClick={submit} disabled={busy || !file || !form.categoryIds.length}>{busy ? "Lädt hoch …" : "Hochladen"}</Button></div></section></div>;
}
