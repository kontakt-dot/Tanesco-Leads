import LeadClaimForm from "@/components/LeadClaimForm";
import { Button } from "@/components/ui/button";
import { statusStyle } from "@/lib/colors";
import { confirmAction } from "@/lib/confirm";
import { leadUrl, openInApp } from "@/lib/navigate";
import { downloadCsv } from "@/lib/table-download";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import { AlarmClock, Ban, Check, CheckCircle2, ChevronDown, Download, ExternalLink, Hourglass, Plus, Search, ShieldQuestion, SlidersHorizontal, X } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react"; // „React“ selbst braucht der Test, der das Detail ohne die Oberfläche rendert
import { toast } from "sonner";
import type { AppRouter } from "../../../server/routers";
import { CLAIM_STATUS, claimCounts, claimDay, claimDeadline, claimEventLabel, claimLeadName, claimStatusLabel, claimTone, claimsTable, type ClaimStatusKey } from "../../../shared/claim-view";

type Claim = inferRouterOutputs<AppRouter>["leadops"]["listClaims"][number];
type Tab = ClaimStatusKey | "alle";
type DueState = "" | "offen" | "überfällig" | "ohne_frist" | "erledigt";
const NO_FILTERS = { reason: "", categoryId: "", supplierId: "", dueState: "" as DueState, from: "", to: "" };
const eur = (value: string | number) => Number(value).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const num = (value: number) => value.toLocaleString("de-DE");
const stamp = (value: Date | string) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const plural = (count: number) => count === 1 ? "Reklamation" : "Reklamationen";

/** Marke mit dem Stand einer Reklamation: offen = bernstein, in Prüfung = blau; entschieden bleibt ruhig – mit Haken (genehmigt) oder Kreuz (abgelehnt). */
function StatusPill({ status }: { status: string }) {
  const tone = claimTone(status);
  return <span className={`fx-pill is-${tone === "open" ? "warn" : tone === "check" ? "calm" : tone === "yes" ? "done" : "mute"}`}>{tone === "yes" ? <Check aria-hidden="true" /> : tone === "no" ? <X aria-hidden="true" /> : <i aria-hidden="true" />}{claimStatusLabel(status)}</span>;
}

function ClaimTimeline({ claimId }: { claimId: number }) {
  const events = trpc.leadops.listClaimEvents.useQuery({ claimId }, { retry: false });
  if (events.isLoading) return <p className="rk-quiet">Verlauf wird geladen …</p>;
  if (events.error) return <p className="rk-quiet is-bad">{events.error.message}</p>;
  if (!events.data?.length) return <p className="rk-quiet">Noch kein Eintrag.</p>;
  return <ol className="rk-events">{events.data.map((event) => <li key={event.id}><i aria-hidden="true" /><div><b>{claimEventLabel(event.eventType)}</b><time dateTime={new Date(event.occurredAt).toISOString()}>{stamp(event.occurredAt)}</time>{event.note && <p>{event.note}</p>}{event.previousStatus && event.nextStatus && event.previousStatus !== event.nextStatus && <small>{claimStatusLabel(event.previousStatus)} → {claimStatusLabel(event.nextStatus)}</small>}</div></li>)}</ol>;
}

/** Aufgeklappte Reklamation: die Angaben, was der Käufer schreibt, der Lead, der Verlauf – und für offene die Frist und die Entscheidung. */
export function ClaimDetail({ claim, categoryName, busy, onResolve, onDeadline, savingDeadline }: { claim: Claim; categoryName: string | null; busy: boolean; onResolve: (status: "genehmigt" | "abgelehnt") => void; onDeadline: (dueAt: Date) => void; savingDeadline: boolean }) {
  const [due, setDue] = useState("");
  useEffect(() => { setDue(claim.dueAt ? new Date(claim.dueAt).toISOString().slice(0, 10) : ""); }, [claim.dueAt, claim.id]);
  const open = !claim.resolvedAt;
  return <div className="rk-detail">
    <dl className="rk-facts">
      <div><dt>Grund</dt><dd>{claim.reason}</dd></div>
      <div><dt>Käufer hat bezahlt</dt><dd>{claim.unitPrice !== null && claim.unitPrice !== undefined ? eur(claim.unitPrice) : "–"}</dd></div>
      <div><dt>Erstattung</dt><dd>{claim.refundAmount !== null ? eur(claim.refundAmount) : "nicht festgelegt"}</dd></div>
      <div><dt>Prüfen bis</dt><dd>{claim.dueAt ? claimDay(claim.dueAt) : "ohne Frist"}</dd></div>
      <div><dt>Entscheidung</dt><dd>{claim.resolvedAt ? `${claimStatusLabel(claim.status)} am ${claimDay(claim.resolvedAt)}` : "steht aus"}</dd></div>
    </dl>
    <div className="rk-cols">
      <div className="rk-col">
        <h3>Was reklamiert wird</h3>
        <p className="rk-text">{claim.details?.trim() || "Keine weitere Beschreibung."}</p>
        <div className="rk-leadbox"><div><b>{claimLeadName(claim)}</b><small>{[claim.leadPublicId, categoryName, claim.supplierName ? `Lieferant: ${claim.supplierName}` : null].filter(Boolean).join(" · ")}</small></div>{claim.leadPublicId && <button type="button" className="fx-tool" onClick={() => openInApp(leadUrl(claim.leadPublicId!))}><ExternalLink aria-hidden="true" /> Lead öffnen</button>}</div>
        {open && <div className="rk-duechange"><label className="rd-field"><span>Prüffrist ändern</span><input className="fx-field" type="date" value={due} onChange={(event) => setDue(event.target.value)} /></label><button type="button" className="fx-tool" disabled={!due || savingDeadline} onClick={() => onDeadline(new Date(`${due}T12:00:00`))}>Frist speichern</button></div>}
      </div>
      <div className="rk-col"><h3>Verlauf</h3><ClaimTimeline claimId={claim.id} /></div>
    </div>
    {open && <footer className="rk-decide"><p><b>Genehmigen:</b> Der Lead gilt als reklamiert und geht – wenn die Lieferkette das für diesen Grund vorsieht – an die nächste Station. <b>Ablehnen:</b> Die Lieferung gilt wieder als angenommen.</p><div><Button variant="outline" disabled={busy} onClick={() => onResolve("abgelehnt")}><X aria-hidden="true" /> Ablehnen</Button><Button className="flux-button" disabled={busy} onClick={() => onResolve("genehmigt")}><Check aria-hidden="true" /> Genehmigen</Button></div></footer>}
  </div>;
}

/** Selbst eine Reklamation erfassen: erst den Lead suchen, dann Grund und Angaben. */
function ClaimCreate({ onClose, onCreated }: { onClose: () => void; onCreated: (claimId: number) => void }) {
  const [query, setQuery] = useState(""); const [lead, setLead] = useState<{ id: number; publicId: string; name: string } | null>(null);
  const term = query.trim();
  const hits = trpc.leadops.listLeadsPaged.useQuery({ query: term, pageSize: 6 }, { retry: false, enabled: term.length >= 2 && !lead, placeholderData: (previous) => previous });
  if (lead) return <LeadClaimForm leadId={lead.id} publicId={lead.publicId} leadName={lead.name} onClose={onClose} onCreated={onCreated} />;
  const rows = hits.data?.rows ?? []; const more = (hits.data?.total ?? 0) - rows.length;
  return <section className="fx-scope cf" aria-label="Reklamation erfassen">
    <header className="ld-head"><div><h2>Reklamation erfassen</h2><p>Zu welchem Lead? Suche nach Name, Lead-Nummer, Telefon oder E-Mail.</p></div><button type="button" className="ld-close" aria-label="Schließen" onClick={onClose}><X aria-hidden="true" /></button></header>
    <label className="fx-search is-wide"><Search aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Lead suchen …" aria-label="Lead suchen" /></label>
    {term.length < 2 ? <p className="rk-quiet">Gib mindestens zwei Zeichen ein.</p> : hits.isLoading ? <p className="rk-quiet">Sucht …</p> : hits.error ? <p className="rk-quiet is-bad">{hits.error.message}</p> : !rows.length ? <p className="rk-quiet">Kein Lead zu „{term}“ gefunden.</p> :
      <ul className="rk-hits">{rows.map((row) => { const name = claimLeadName(row); return <li key={row.id}><button type="button" onClick={() => setLead({ id: row.id, publicId: row.publicId, name })}><span><b>{name}</b><small>{[row.publicId, [row.postcode, row.city].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</small></span><span className="fx-pill is-plain">{statusStyle(row.status).label}</span></button></li>; })}{more > 0 && <li className="rk-quiet">{num(more)} weitere Treffer – gib mehr ein, um sie einzugrenzen.</li>}</ul>}
  </section>;
}

/**
 * Reklamationen: oben die Zahlen als Leiste (was wartet, was überfällig ist, wie entschieden wurde), darunter die Liste mit Reitern nach Stand,
 * Suche und Filtern. Ein Klick auf eine Zeile klappt die Reklamation an Ort und Stelle auf – dort wird entschieden. Die Adresse
 * „?page=Reklamationen&claimId=…“ öffnet die Liste mit dieser Reklamation aufgeklappt.
 */
export default function ClaimsDesk() {
  const utils = trpc.useUtils();
  const categories = trpc.leadops.listCategories.useQuery(undefined, { retry: false });
  const suppliers = trpc.leadops.listSuppliers.useQuery(undefined, { retry: false });
  const reasons = trpc.leadops.listReclamationReasons.useQuery(undefined, { retry: false });
  const [tab, setTab] = useState<Tab>("alle"); const [search, setSearch] = useState(""); const [filters, setFilters] = useState(NO_FILTERS); const [showFilters, setShowFilters] = useState(false);
  const [linked] = useState<number | null>(() => Number(new URLSearchParams(window.location.search).get("claimId")) || null);
  const [openId, setOpenId] = useState<number | null>(linked);
  const [creating, setCreating] = useState(false);
  // Die Leiste zählt immer alles; Reiter und Liste folgen Suche und Filtern (ohne den Stand – der ist der Reiter)
  const all = trpc.leadops.listClaims.useQuery({}, { retry: false });
  const input = useMemo(() => ({ query: search.trim() || undefined, reason: filters.reason || undefined, categoryId: Number(filters.categoryId) || undefined, supplierId: Number(filters.supplierId) || undefined, dueState: filters.dueState || undefined, createdFrom: filters.from ? new Date(`${filters.from}T00:00:00`) : undefined, createdTo: filters.to ? new Date(`${filters.to}T23:59:59.999`) : undefined }), [search, filters]);
  const scoped = trpc.leadops.listClaims.useQuery(input, { retry: false, placeholderData: (previous) => previous });
  const rows = scoped.data ?? []; const counts = claimCounts(rows); const total = claimCounts(all.data ?? []);
  const visible = tab === "alle" ? rows : rows.filter((claim) => claim.status === tab);
  const waiting = visible.filter((claim) => !claim.resolvedAt);
  const activeFilters = Object.values(filters).filter(Boolean).length; const narrowed = activeFilters > 0 || search.trim().length > 0 || tab !== "alle";
  const reasonOptions = useMemo(() => Array.from(new Set([...(reasons.data ?? []).map((item) => item.name), ...(all.data ?? []).map((claim) => claim.reason)])).sort((a, b) => a.localeCompare(b, "de")), [reasons.data, all.data]);
  const categoryName = (id: number | null) => (categories.data ?? []).find((item) => item.id === id)?.name ?? null;
  const refresh = () => { utils.leadops.listClaims.invalidate(); utils.leadops.listClaimEvents.invalidate(); utils.leadops.listLeadsPaged.invalidate(); utils.leadops.getLeadDetail.invalidate(); };
  const onError = (failure: { message: string }) => toast.error(failure.message);
  const resolve = trpc.leadops.resolveClaim.useMutation({ onSuccess: (result, sent) => { refresh(); toast.success(sent.status === "abgelehnt" ? "Reklamation abgelehnt. Die Lieferung gilt wieder als angenommen." : result.reinjected ? "Reklamation genehmigt. Der Lead ging an die nächste Station der Lieferkette." : "Reklamation genehmigt. Der Lead ist jetzt reklamiert."); }, onError });
  const bulk = trpc.leadops.bulkResolveClaims.useMutation({ onSuccess: (result, sent) => { refresh(); toast.success(`${num(result.updated)} ${plural(result.updated)} ${sent.status === "genehmigt" ? "genehmigt" : "abgelehnt"}${result.reinjected ? ` – ${num(result.reinjected)} ${result.reinjected === 1 ? "Lead ging" : "Leads gingen"} an die nächste Station` : ""}.`); }, onError: (failure) => { refresh(); onError(failure); } });
  const deadline = trpc.leadops.updateClaimDeadline.useMutation({ onSuccess: () => { refresh(); toast.success("Prüffrist gespeichert."); }, onError });
  const decideAll = async (status: "genehmigt" | "abgelehnt") => {
    const question = status === "genehmigt" ? `Alle ${num(waiting.length)} Reklamationen dieser Ansicht, die noch warten, genehmigen? Die Leads gelten dann als reklamiert und gehen – je nach Regel der Lieferkette – an die nächste Station.` : `Alle ${num(waiting.length)} Reklamationen dieser Ansicht, die noch warten, ablehnen? Die Lieferungen gelten dann wieder als angenommen.`;
    if (await confirmAction(question, { confirmLabel: status === "genehmigt" ? "Ja, genehmigen" : "Ja, ablehnen", danger: false })) bulk.mutate({ claimIds: waiting.map((claim) => claim.id), status });
  };
  const download = () => { const table = claimsTable(visible); downloadCsv(table.columns, table.rows, "Reklamationen"); };
  const showAll = () => { setTab("alle"); setSearch(""); setFilters(NO_FILTERS); };
  const set = <K extends keyof typeof NO_FILTERS>(key: K, value: (typeof NO_FILTERS)[K]) => setFilters((state) => ({ ...state, [key]: value }));
  // Kommt man über einen Link zu einer bestimmten Reklamation, steht sie nach dem Laden im Blick
  const loaded = Boolean(scoped.data);
  useEffect(() => { if (linked && loaded) document.getElementById(`rk-${linked}`)?.scrollIntoView?.({ block: "center" }); }, [linked, loaded]);
  const value = (count: number) => all.data ? num(count) : "…";
  return <div className="fx-scope tg rk">
    <header className="page-intro compact"><div><span className="eyebrow">SERVICE DESK</span><h1>Reklamationen</h1><p>Käufer melden hier Leads, die nicht passen. Du entscheidest über jede Meldung: genehmigen oder ablehnen.</p></div><nav className="people-header-actions"><Button variant="outline" onClick={download} disabled={!visible.length}><Download aria-hidden="true" /> CSV exportieren</Button><Button className="flux-button" onClick={() => setCreating(true)}><Plus aria-hidden="true" /> Reklamation erfassen</Button></nav></header>
    <section className="tg-rail" aria-label="Reklamationen auf einen Blick">
      <div className="tg-stat"><span><Hourglass aria-hidden="true" /> Warten auf Entscheidung</span><strong>{value(total.wartend)}</strong><small>{!all.data ? "" : total.wartend ? `${num(total.offen)} offen · ${num(total.in_prüfung)} in Prüfung` : "nichts zu entscheiden"}</small></div>
      <div className={`tg-stat ${total.überfällig ? "is-late" : ""}`}><span><AlarmClock aria-hidden="true" /> Überfällig</span><strong>{value(total.überfällig)}</strong><small>{!all.data ? "" : total.überfällig ? "Prüffrist ist abgelaufen" : "keine Frist überschritten"}</small></div>
      <div className="tg-stat"><span><CheckCircle2 aria-hidden="true" /> Genehmigt</span><strong>{value(total.genehmigt)}{all.data && total.genehmigtQuote !== null && <em>{total.genehmigtQuote} %</em>}</strong><small>{!all.data ? "" : total.entschieden ? `von ${num(total.entschieden)} entschiedenen` : "noch nichts entschieden"}</small></div>
      <div className="tg-stat"><span><Ban aria-hidden="true" /> Abgelehnt</span><strong>{value(total.abgelehnt)}</strong><small>{!all.data ? "" : total.abgelehnt ? "Lieferung gilt wieder als angenommen" : "noch keine abgelehnt"}</small></div>
    </section>
    {creating && <ClaimCreate onClose={() => setCreating(false)} onCreated={(claimId) => { setCreating(false); refresh(); showAll(); setOpenId(claimId); }} />}
    <section className="tg-list rk-list" aria-label="Alle Reklamationen">
      <div className="fx-toolrow">
        <div className="fx-tabs" role="tablist" aria-label="Reklamationen nach Stand">{([["alle", "Alle"], ...CLAIM_STATUS] as Array<[Tab, string]>).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}<span>{scoped.data ? num(key === "alle" ? counts.alle : counts[key]) : ""}</span></button>)}</div>
        <label className="fx-search"><Search aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nummer, Lead, Name, Grund oder Lieferant" aria-label="Reklamationen durchsuchen" />{search && <button type="button" aria-label="Suche leeren" onClick={() => setSearch("")}><X aria-hidden="true" /></button>}</label>
        <button type="button" className={`fx-tool ${showFilters || activeFilters ? "is-on" : ""}`} aria-expanded={showFilters} onClick={() => setShowFilters((state) => !state)}><SlidersHorizontal aria-hidden="true" /> Filter{activeFilters > 0 && <em>{activeFilters}</em>}</button>
      </div>
      {showFilters && <div className="rk-filters">
        <label className="rd-field"><span>Grund</span><select className="fx-select" value={filters.reason} onChange={(event) => set("reason", event.target.value)}><option value="">Alle Gründe</option>{reasonOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label className="rd-field"><span>Kategorie</span><select className="fx-select" value={filters.categoryId} onChange={(event) => set("categoryId", event.target.value)}><option value="">Alle Kategorien</option>{(categories.data ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label className="rd-field"><span>Lieferant</span><select className="fx-select" value={filters.supplierId} onChange={(event) => set("supplierId", event.target.value)}><option value="">Alle Lieferanten</option>{(suppliers.data ?? []).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        <label className="rd-field"><span>Prüffrist</span><select className="fx-select" value={filters.dueState} onChange={(event) => set("dueState", event.target.value as DueState)}><option value="">Alle Fristen</option><option value="offen">Frist läuft noch</option><option value="überfällig">Überfällig</option><option value="ohne_frist">Ohne Frist</option><option value="erledigt">Schon entschieden</option></select></label>
        <label className="rd-field"><span>Erstellt ab</span><input className="fx-field" type="date" value={filters.from} onChange={(event) => set("from", event.target.value)} /></label>
        <label className="rd-field"><span>Erstellt bis</span><input className="fx-field" type="date" value={filters.to} onChange={(event) => set("to", event.target.value)} /></label>
        {activeFilters > 0 && <button type="button" className="fx-tool rk-reset" onClick={() => setFilters(NO_FILTERS)}>Filter zurücksetzen</button>}
      </div>}
      {waiting.length > 1 && <div className="rk-bulk" role="toolbar" aria-label="Alle wartenden Reklamationen dieser Ansicht entscheiden"><span><b>{num(waiting.length)}</b> Reklamationen dieser Ansicht warten auf deine Entscheidung</span><div><Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => void decideAll("abgelehnt")}>Alle ablehnen</Button><Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => void decideAll("genehmigt")}>Alle genehmigen</Button></div></div>}
      {scoped.isLoading ? <p className="tg-note">Reklamationen werden geladen …</p> : scoped.error ? <div className="rd-none"><p className="is-bad">Die Reklamationen konnten nicht geladen werden: {scoped.error.message}</p><button type="button" className="fx-tool" onClick={() => void scoped.refetch()}>Erneut laden</button></div>
        : !visible.length ? (narrowed ? <div className="rd-none"><p>Zu dieser Auswahl gibt es keine Reklamation.</p><button type="button" className="fx-tool" onClick={showAll}>Alle Reklamationen zeigen</button></div> : <div className="rd-empty"><ShieldQuestion aria-hidden="true" /><b>Noch keine Reklamation</b><p>Käufer melden Reklamationen in ihrem Bereich oder über die Schnittstelle. Du kannst auch selbst eine erfassen.</p><Button className="flux-button" onClick={() => setCreating(true)}><Plus aria-hidden="true" /> Reklamation erfassen</Button></div>) : <>
          <div className="rk-rows-head" aria-hidden="true"><span>Reklamation</span><span>Lead</span><span>Käufer</span><span>Stand</span><span>Prüffrist</span><span /></div>
          <ul className="rk-rows">{visible.map((claim) => { const on = openId === claim.id; const due = claimDeadline(claim); return <li key={claim.id} id={`rk-${claim.id}`} className={`rk-item ${on ? "is-open" : ""} ${due.tone === "late" ? "is-late" : ""}`}>
            <button type="button" className="rk-row" aria-expanded={on} onClick={() => setOpenId(on ? null : claim.id)}>
              <span className="rk-what"><b>{claim.reason}</b><small>REC-{claim.id} · erfasst am {claimDay(claim.createdAt)}</small></span>
              <span className="rk-lead"><b>{claimLeadName(claim)}</b><small>{[claim.leadPublicId ?? `Lead ${claim.leadId}`, categoryName(claim.categoryId)].filter(Boolean).join(" · ")}</small></span>
              <span className="rk-party"><b>{claim.buyerName ?? "–"}</b>{claim.supplierName && <small>Lieferant: {claim.supplierName}</small>}</span>
              <span className="rk-status"><StatusPill status={claim.status} /></span>
              <span className={`rk-due is-${due.tone}`}><b>{due.text}</b>{!claim.resolvedAt && claim.dueAt && <small>bis {claimDay(claim.dueAt)}</small>}</span>
              <ChevronDown className="rk-chevron" aria-hidden="true" />
            </button>
            {on && <ClaimDetail claim={claim} categoryName={categoryName(claim.categoryId)} busy={resolve.isPending} onResolve={(status) => resolve.mutate({ claimId: claim.id, status })} onDeadline={(dueAt) => deadline.mutate({ claimId: claim.id, dueAt })} savingDeadline={deadline.isPending} />}
          </li>; })}</ul>
        </>}
    </section>
    <ol className="tg-how" aria-label="So läuft eine Reklamation">
      <li><em>1</em><div><b>Die Reklamation kommt an</b><p>Käufer melden sie in ihrem Bereich oder über die Schnittstelle. Die Gründe zur Auswahl legst du unter Einstellungen → Reklamationen fest.</p></div></li>
      <li><em>2</em><div><b>Du entscheidest</b><p>Zeile anklicken, lesen, dann genehmigen oder ablehnen – am besten vor Ablauf der Prüffrist.</p></div></li>
      <li><em>3</em><div><b>Was danach passiert</b><p>Genehmigt: Der Lead ist reklamiert und geht je nach Regel der Lieferkette an die nächste Station. Abgelehnt: Die Lieferung gilt wieder als angenommen.</p></div></li>
    </ol>
  </div>;
}
