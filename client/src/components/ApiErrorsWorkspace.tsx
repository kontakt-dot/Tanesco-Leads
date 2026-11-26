import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { BookOpen, Check, ChevronDown, ExternalLink, Pencil, RefreshCw, Search, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { API_ERROR_GUIDE, API_ERROR_KIND_LABEL, LEAD_FIELD_LABEL, emailProblem, phoneProblem, postcodeProblem, postcodeSuggestion, suggestEmail, type ApiErrorKind, type ApiHealthRow, type ApiProblem, type LeadContactField } from "../../../shared/api-errors";

type Days = 7 | 30 | 90;
type Filter = "alle" | "daten" | "empfaenger" | "kein_abnehmer";
type RetryResult = { publicId: string; name: string; ok: boolean; result: string; buyerName: string | null; message: string };

const NO_BUYER: ApiErrorKind[] = ["kein_abnehmer", "einrichtung"];
/** Solange noch nichts geladen ist: immer dieselbe leere Liste (eine neue je Zeichnen würde alles, was davon abhängt, jedes Mal neu anstoßen). */
const NO_PROBLEMS: ApiProblem[] = [];
const PAGE = 50;
const groupOf = (kind: ApiErrorKind): Exclude<Filter, "alle"> => (kind === "daten" ? "daten" : NO_BUYER.includes(kind) ? "kein_abnehmer" : "empfaenger");
const STATUS_LABEL: Record<string, string> = { neu: "Neu", genehmigt: "Freigegeben", zugewiesen: "Zugewiesen", reklamiert: "Reklamiert", fehlerhaft: "Fehlerhaft", deaktiviert: "Deaktiviert", "hängend": "Hängend" };
const HEALTH_LABEL: Record<ApiHealthRow["state"], string> = { gut: "Läuft", warnung: "Wackelt", gestoert: "Gestört", unbekannt: "Noch keine Daten" };
const CONTACT_FIELDS: LeadContactField[] = ["salutation", "firstName", "lastName", "phone", "email", "street", "postcode", "city"];
/** „Angaben fehlen“, wenn nichts falsch ist, sondern nur etwas fehlt (E-Mail-Adresse, Anrede …) – sonst der Name der Art. */
const kindLabel = (problem: ApiProblem) => problem.kind === "daten" && problem.dataProblems.length > 0 && problem.dataProblems.every((item) => item.missing) ? "Angaben fehlen" : API_ERROR_KIND_LABEL[problem.kind];

const stamp = (value: string) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
/** „vor 5 Min“, „vor 3 Std“, „gestern“, sonst das Datum – die genaue Zeit steht im Hinweis beim Darüberfahren. */
function ago(value: string | null, now = Date.now()): string {
  if (!value) return "–";
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "gerade eben"; if (minutes < 60) return `vor ${minutes} Min`;
  const hours = Math.round(minutes / 60); if (hours < 24) return `vor ${hours} Std`;
  const days = Math.round(hours / 24); if (days === 1) return "gestern"; if (days < 14) return `vor ${days} Tagen`;
  return new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
const count = (value: number, one: string, many: string) => `${value.toLocaleString("de-DE")} ${value === 1 ? one : many}`;

/**
 * API-Fehler: alles, was beim Ausliefern hakt – an einem Ort.
 * Oben der Zustand jeder Schnittstelle („API-Gesundheit“), darunter die Leads, die nicht rausgegangen sind: Grund in einfachen Worten,
 * Lead korrigieren, noch einmal ausliefern oder abhaken.
 */
export default function ApiErrorsWorkspace() {
  const utils = trpc.useUtils();
  const [days, setDays] = useState<Days>(30); const [filter, setFilter] = useState<Filter>("alle"); const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]); const [editing, setEditing] = useState<string | null>(null); const [open, setOpen] = useState<Record<string, boolean>>({});
  const [guideOpen, setGuideOpen] = useState(false); const [results, setResults] = useState<RetryResult[] | null>(null);
  const [limit, setLimit] = useState(PAGE); // lange Listen in Portionen – die Seite bleibt auch bei vielen Einträgen schnell
  const overview = trpc.leadops.apiErrorOverview.useQuery({ days }, { retry: false, refetchInterval: 60_000, placeholderData: (previous) => previous });
  const refresh = () => { utils.leadops.apiErrorOverview.invalidate(); utils.leadops.apiErrorCount.invalidate(); utils.leadops.listLeadsPaged.invalidate(); };
  const onError = (error: { message: string }) => toast.error(error.message);
  const retry = trpc.leadops.retryLeadDeliveries.useMutation({ onSuccess: (result) => { refresh(); setResults(result.results); setSelected([]); if (result.failed === 0) toast.success(result.delivered === 1 ? `${result.results[0].name}: ${result.results[0].message}` : `${result.delivered} Leads ausgeliefert.`); else if (result.delivered === 0) toast.error(result.results.length === 1 ? `Noch nicht ausgeliefert: ${result.results[0].message}` : `Keiner der ${result.results.length} Leads ist rausgegangen – die Gründe stehen über der Liste.`); else toast.message(`${result.delivered} ausgeliefert, ${result.failed} nicht – die Gründe stehen über der Liste.`); }, onError });
  const dismiss = trpc.leadops.dismissApiErrors.useMutation({ onSuccess: (result) => { refresh(); setSelected([]); toast.success(result.dismissed === 1 ? "Als erledigt abgehakt." : `${result.dismissed} Probleme abgehakt.`); }, onError });
  const check = trpc.leadops.checkInterfacesNow.useMutation({ onSuccess: (result) => { refresh(); toast.success(result.checked ? `${count(result.checked, "Schnittstelle", "Schnittstellen")} geprüft: ${result.healthy} erreichbar${result.warnings ? `, ${result.warnings} nicht` : ""}.` : "Es ist noch keine Schnittstelle eingerichtet."); }, onError });

  const data = overview.data; const problems = data?.problems ?? NO_PROBLEMS;
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return problems.filter((problem) => (filter === "alle" || groupOf(problem.kind) === filter) && words.every((word) => `${problem.name} ${problem.publicId} ${problem.categoryName} ${problem.target ?? ""} ${problem.title} ${problem.lead.email} ${problem.lead.phone} ${problem.lead.city}`.toLowerCase().includes(word)));
  }, [problems, filter, search]);
  // Auswahl aufräumen, wenn ein Lead nicht mehr in der Liste steht. Ändert sich nichts, bleibt die Auswahl dieselbe (sonst würde die Seite sich im Kreis neu zeichnen).
  useEffect(() => { setSelected((current) => { const next = current.filter((id) => problems.some((problem) => problem.publicId === id)); return next.length === current.length ? current : next; }); }, [problems]);
  useEffect(() => { setLimit(PAGE); }, [filter, search, days]);
  const visible = shown.length > limit ? shown.slice(0, limit) : shown;
  const allSelected = visible.length > 0 && visible.every((problem) => selected.includes(problem.publicId));
  const toggle = (publicId: string) => setSelected((current) => current.includes(publicId) ? current.filter((id) => id !== publicId) : [...current, publicId]);
  const tile = (key: Filter, value: number | undefined, label: string, note: string) => <button type="button" className={`af-tile ${filter === key ? "is-active" : ""} ${key !== "alle" && value ? "has-items" : ""}`} aria-pressed={filter === key} onClick={() => setFilter(filter === key && key !== "alle" ? "alle" : key)}><strong>{typeof value === "number" ? value.toLocaleString("de-DE") : "–"}</strong><span>{label}</span><small>{note}</small></button>;
  const health = data?.health ?? []; const broken = health.filter((row) => row.state === "gestoert").length; const shaky = health.filter((row) => row.state === "warnung").length;

  return <div className="fx-scope af">
    <header className="page-intro compact"><div><span className="eyebrow">ANALYSE</span><h1>API-Fehler</h1><p>Alles, was beim Ausliefern hakt. Du siehst den Grund in einfachen Worten, korrigierst den Lead und schickst ihn noch einmal los.</p></div>
      <div className="flex flex-wrap items-center gap-3"><select aria-label="Zeitraum" className="filter-select af-days" value={days} onChange={(event) => setDays(Number(event.target.value) as Days)}><option value={7}>Letzte 7 Tage</option><option value={30}>Letzte 30 Tage</option><option value={90}>Letzte 90 Tage</option></select><Button variant="outline" onClick={() => setGuideOpen(true)}><BookOpen className="h-4 w-4" /> Welche Fehler gibt es?</Button></div></header>

    <section className="af-tiles" aria-label="Offene Probleme nach Art">
      {tile("alle", data?.counts.open, "Offene Probleme", "alle anzeigen")}
      {tile("daten", data?.counts.daten, "Angaben fehlen oder falsch", "E-Mail, Anrede, Rufnummer, PLZ …")}
      {tile("empfaenger", data?.counts.empfaenger, "Beim Empfänger gescheitert", "abgelehnt, Zugang, Störung")}
      {tile("kein_abnehmer", data?.counts.keinAbnehmer, "Kein Abnehmer", "kein Käufer, keine Kette")}
    </section>

    <section className="af-panel" aria-label="API-Gesundheit">
      <header className="af-head"><div><h2>API-Gesundheit</h2><p>{!health.length ? "Zustand jeder Schnittstelle, über die Leads rausgehen." : broken ? `${count(broken, "Schnittstelle ist", "Schnittstellen sind")} gestört.` : shaky ? `${count(shaky, "Schnittstelle wackelt", "Schnittstellen wackeln")} – der Rest läuft.` : "Alle Schnittstellen laufen."} Gezählt werden die Übergaben der letzten {days} Tage.</p></div>
        <Button variant="outline" disabled={check.isPending} onClick={() => check.mutate()} title="Prüft, ob jeder Empfänger erreichbar ist – es werden keine Leads verschickt"><RefreshCw className={`h-4 w-4 ${check.isPending ? "animate-spin" : ""}`} /> {check.isPending ? "Wird geprüft …" : "Jetzt prüfen"}</Button></header>
      {overview.isLoading ? <p className="af-empty">Wird geladen …</p> : !health.length ? <p className="af-empty">Noch keine Schnittstelle eingerichtet. Solange gehen Leads ohne Übergabe an den Käufer – er sieht sie in seinem Bereich.</p> :
        <ul className="af-health">{health.map((row) => <li key={row.key} className={`af-api is-${row.state}`}>
          <div className="af-api-top"><i aria-hidden="true" /><div><strong>{row.name}</strong><small>{[row.detail, row.host].filter(Boolean).join(" · ") || "–"}{!row.active && " · ausgeschaltet"}</small></div><span className="af-api-state">{HEALTH_LABEL[row.state]}</span></div>
          <p className="af-api-text">{row.stateText}{row.sent > 0 && <> · {count(row.sent, "Übergabe", "Übergaben")}: {[`${row.sent - row.failed} angekommen`, row.refused ? `${row.refused} abgelehnt` : null, row.failed - row.refused ? `${row.failed - row.refused} fehlgeschlagen` : null].filter(Boolean).join(", ")}</>}</p>
          <dl className="af-api-facts">
            <div><dt>Zuletzt angekommen</dt><dd title={row.lastOkAt ? stamp(row.lastOkAt) : undefined}>{ago(row.lastOkAt)}</dd></div>
            <div><dt>Letzter Fehler</dt><dd title={row.lastErrorAt ? stamp(row.lastErrorAt) : undefined}>{row.lastError ? <>{ago(row.lastErrorAt)} – {row.lastError.title}{row.lastError.httpStatus ? ` (Antwort ${row.lastError.httpStatus})` : ""}</> : "keiner"}</dd></div>
            {row.lastCheck && <div><dt>Letzte Probe</dt><dd title={stamp(row.lastCheck.at)}>{ago(row.lastCheck.at)} – {row.lastCheck.ok ? "erreichbar" : "nicht erreichbar"}</dd></div>}
          </dl>
          {row.kind === "kaeufer" && row.membershipId ? <a className="af-link" href={`/?page=Benutzer&member=${row.membershipId}&tab=integration`}>Schnittstelle des Käufers öffnen <ExternalLink aria-hidden="true" /></a> : row.kind === "partner" ? <a className="af-link" href="/?page=Integrationen">Integrationen öffnen <ExternalLink aria-hidden="true" /></a> : null}
        </li>)}</ul>}
    </section>

    <section className="af-panel" aria-label="Leads, die nicht rausgegangen sind">
      <header className="af-head"><div><h2>Leads, die nicht rausgegangen sind</h2><p>{!data ? "Wird geladen …" : !problems.length ? "Im Moment hakt nichts." : `${count(shown.length, "Lead", "Leads")}${shown.length !== problems.length ? ` von ${problems.length}` : ""} – der neueste Fehler steht oben.`}</p></div>
        <label className="af-search"><Search aria-hidden="true" /><input aria-label="Probleme durchsuchen" placeholder="Name, Käufer, E-Mail …" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" aria-label="Suche leeren" onClick={() => setSearch("")}><X /></button>}</label></header>
      {results && <div className="af-results" role="status"><header><strong>Ergebnis des letzten Versuchs</strong><button type="button" aria-label="Ergebnis schließen" onClick={() => setResults(null)}><X /></button></header><ul>{results.map((row) => <li key={row.publicId} className={row.ok ? "is-ok" : "is-bad"}><b>{row.ok ? "Ausgeliefert" : "Nicht ausgeliefert"}</b><span>{row.name}</span><em>{row.message}</em></li>)}</ul></div>}
      {shown.length > 0 && <div className="af-bulk"><label><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? selected.filter((id) => !visible.some((problem) => problem.publicId === id)) : Array.from(new Set([...selected, ...visible.map((problem) => problem.publicId)])))} /> {selected.length ? `${selected.length} ausgewählt` : visible.length < shown.length ? `Alle ${visible.length} angezeigten auswählen` : "Alle auswählen"}</label>
        {selected.length > 0 && <span><Button size="sm" className="flux-button" disabled={retry.isPending || selected.length > 50} onClick={() => retry.mutate({ publicIds: selected })}><Send className="h-4 w-4" /> {retry.isPending ? "Wird ausgeliefert …" : "Erneut ausliefern"}</Button><Button size="sm" variant="outline" disabled={dismiss.isPending} onClick={() => dismiss.mutate({ publicIds: selected })}><Check className="h-4 w-4" /> Als erledigt abhaken</Button>{selected.length > 50 && <small>Höchstens 50 auf einmal ausliefern.</small>}</span>}</div>}
      {overview.error ? <p className="af-empty is-error">{overview.error.message}</p> : !data ? <p className="af-empty">Wird geladen …</p> : !shown.length ? <div className="af-clear"><Check aria-hidden="true" /><strong>{problems.length ? "Kein Problem passt zu dieser Auswahl." : "Keine offenen Probleme."}</strong><p>{problems.length ? "Filter oder Suche ändern, um die anderen zu sehen." : "Alles, was rausgehen sollte, ist rausgegangen. Leads mit fehlenden oder falschen Angaben stehen hier, sobald es welche gibt."}</p>{(filter !== "alle" || search) && <Button variant="outline" size="sm" onClick={() => { setFilter("alle"); setSearch(""); }}>Alle anzeigen</Button>}</div> :
        <><ul className="af-list">{visible.map((problem) => <ProblemRow key={problem.publicId} problem={problem} selected={selected.includes(problem.publicId)} onToggle={() => toggle(problem.publicId)} expanded={Boolean(open[problem.publicId])} onExpand={() => setOpen({ ...open, [problem.publicId]: !open[problem.publicId] })} editing={editing === problem.publicId} onEdit={() => setEditing(editing === problem.publicId ? null : problem.publicId)}
          busy={retry.isPending || dismiss.isPending} onRetry={() => retry.mutate({ publicIds: [problem.publicId] })} onDismiss={() => dismiss.mutate({ publicIds: [problem.publicId] })} onSaved={(result) => { refresh(); setEditing(null); if (result) setResults([result]); }} />)}</ul>
          {visible.length < shown.length && <div className="af-more-rows"><Button variant="outline" onClick={() => setLimit(limit + PAGE)}>Weitere {Math.min(PAGE, shown.length - visible.length)} anzeigen</Button><small>{visible.length} von {shown.length} angezeigt</small></div>}</>}
    </section>

    {(data?.resolved.length ?? 0) > 0 && <details className="af-panel af-resolved"><summary><ChevronDown aria-hidden="true" /> Zuletzt gelöst <span>{data!.resolved.length}</span></summary><ul>{data!.resolved.map((row) => <li key={`${row.publicId}-${row.solvedAt}`}><Check aria-hidden="true" /><a href={`/?page=Leads&lead=${encodeURIComponent(row.publicId)}`}>{row.name}</a><span>{row.categoryName}</span><em>{row.title}</em><small title={stamp(row.solvedAt)}>{row.buyerName ? `angekommen bei ${row.buyerName}` : "angekommen"} · {ago(row.solvedAt)}</small></li>)}</ul></details>}

    {guideOpen && <div className="af-overlay" role="presentation" onClick={() => setGuideOpen(false)}><section className="af-guide" role="dialog" aria-modal="true" aria-label="Welche Fehler gibt es?" onClick={(event) => event.stopPropagation()}>
      <header><div><h2>Welche Fehler gibt es?</h2><p>Jede Art von Problem beim Ausliefern – was sie bedeutet und was zu tun ist. Die Zahl ist der Code, mit dem der Empfänger antwortet.</p></div><button type="button" aria-label="Schließen" onClick={() => setGuideOpen(false)}><X /></button></header>
      <ul>{API_ERROR_GUIDE.map((row) => <li key={row.kind}><div><span className={`af-kind is-${groupOf(row.kind)}`}>{API_ERROR_KIND_LABEL[row.kind]}</span><code title="Code der Antwort">{row.codes}</code></div><div><p>{row.what}</p><strong>{row.todo}</strong></div></li>)}</ul>
    </section></div>}
  </div>;
}

function ProblemRow({ problem, selected, onToggle, expanded, onExpand, editing, onEdit, busy, onRetry, onDismiss, onSaved }: { problem: ApiProblem; selected: boolean; onToggle: () => void; expanded: boolean; onExpand: () => void; editing: boolean; onEdit: () => void; busy: boolean; onRetry: () => void; onDismiss: () => void; onSaved: (result: RetryResult | null) => void }) {
  const group = groupOf(problem.kind);
  const targetHref = problem.targetLink?.kind === "kaeufer" ? `/?page=Benutzer&member=${problem.targetLink.membershipId}&tab=integration` : problem.targetLink?.kind === "integration" ? "/?page=Integrationen" : null;
  const primary = problem.fix === "lead" ? "korrigieren" : problem.fix === "schnittstelle" && targetHref ? "schnittstelle" : problem.fix === "lieferkette" ? "lieferkette" : problem.fix === "keine" ? "erledigt" : "ausliefern";
  return <li className={`af-row is-${group} ${selected ? "is-selected" : ""}`}>
    <label className="af-check"><input type="checkbox" aria-label={`${problem.name} auswählen`} checked={selected} onChange={onToggle} /></label>
    <div className="af-main">
      <div className="af-line"><span className={`af-kind is-${group}`}>{kindLabel(problem)}</span><a className="af-name" href={`/?page=Leads&lead=${encodeURIComponent(problem.publicId)}`} title="Lead öffnen">{problem.name}</a><span className="af-meta">{problem.categoryName} · {STATUS_LABEL[problem.status] ?? problem.status}{problem.supplierName ? ` · von ${problem.supplierName}` : ""}</span><span className="af-when" title={stamp(problem.occurredAt)}>{ago(problem.occurredAt)}{problem.attempts > 1 ? ` · ${problem.attempts} Versuche` : ""}</span></div>
      <p className="af-title">{problem.title}{(problem.target || problem.httpStatus) && <span>{problem.target ? ` Empfänger: ${problem.target}` : ""}{problem.httpStatus ? `${problem.target ? " ·" : ""} Antwort ${problem.httpStatus}` : ""}</span>}</p>
      {problem.dataProblems.length > 0 && <ul className="af-data">{problem.dataProblems.map((item) => <li key={`${item.field}-${item.title}`}><b>{LEAD_FIELD_LABEL[item.field]}</b>{problem.lead[item.field] ? <code>{problem.lead[item.field]}</code> : <code className="is-empty">leer</code>}<span>{item.hint}</span></li>)}</ul>}
      {group === "kein_abnehmer" && problem.parts.length > 0 && <ul className="af-parts">{problem.parts.map((part, index) => <li key={index}>{part.who && <b>{part.who}</b>}<span>{part.why}</span></li>)}</ul>}
      <p className="af-advice">{problem.advice}</p>
      <div className="af-actions">
        {primary === "korrigieren" && <Button size="sm" className="flux-button" onClick={onEdit}><Pencil className="h-4 w-4" /> {editing ? "Schließen" : "Korrigieren"}</Button>}
        {primary === "schnittstelle" && targetHref && <a className="af-button flux-button" href={targetHref}>Schnittstelle prüfen <ExternalLink aria-hidden="true" /></a>}
        {primary === "lieferkette" && <a className="af-button flux-button" href="/?page=Lieferkette">Lieferkette öffnen <ExternalLink aria-hidden="true" /></a>}
        {primary === "ausliefern" && <Button size="sm" className="flux-button" disabled={busy} onClick={onRetry}><Send className="h-4 w-4" /> Erneut ausliefern</Button>}
        {primary === "erledigt" && <Button size="sm" className="flux-button" disabled={busy} onClick={onDismiss}><Check className="h-4 w-4" /> Als erledigt abhaken</Button>}
        {primary !== "korrigieren" && <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="h-4 w-4" /> {editing ? "Schließen" : "Korrigieren"}</Button>}
        {primary !== "ausliefern" && <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}><Send className="h-4 w-4" /> Erneut ausliefern</Button>}
        {primary !== "erledigt" && <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss} title="Aus der Liste nehmen – scheitert der Lead wieder, steht er wieder da"><Check className="h-4 w-4" /> Erledigt</Button>}
        {(problem.reasons.length > 0 || problem.detail) && <button type="button" className="af-more" aria-expanded={expanded} onClick={onExpand}><ChevronDown aria-hidden="true" /> {expanded ? "Weniger" : "Antwort und Verlauf"}</button>}
      </div>
      {expanded && <div className="af-detail">
        {problem.detail && <div><h4>Antwort des Empfängers</h4><pre>{problem.detail}</pre></div>}
        {problem.reasons.length > 0 && <div><h4>Verlauf</h4><ol>{problem.reasons.map((reason, index) => <li key={`${reason.at}-${index}`}><time title={stamp(reason.at)}>{stamp(reason.at)}</time><span>{reason.title}{reason.target ? ` (${reason.target}${reason.httpStatus ? `, Antwort ${reason.httpStatus}` : ""})` : reason.httpStatus ? ` (Antwort ${reason.httpStatus})` : ""}</span>{reason.parts.length > 0 && <ul>{reason.parts.map((part, at) => <li key={at}>{part.who && <b>{part.who}: </b>}{part.why}</li>)}</ul>}</li>)}</ol></div>}
      </div>}
      {editing && <LeadCorrection problem={problem} onSaved={onSaved} onCancel={onEdit} />}
    </div>
  </li>;
}

/** Lead korrigieren: Kontaktangaben und – wenn gewünscht – die Felder der Kategorie. Falsche Angaben werden schon beim Tippen gemeldet. */
function LeadCorrection({ problem, onSaved, onCancel }: { problem: ApiProblem; onSaved: (result: RetryResult | null) => void; onCancel: () => void }) {
  const [values, setValues] = useState<Record<LeadContactField, string>>({ salutation: problem.lead.salutation, firstName: problem.lead.firstName, lastName: problem.lead.lastName, email: problem.lead.email, phone: problem.lead.phone, street: problem.lead.street, postcode: problem.lead.postcode, city: problem.lead.city });
  const [extraOpen, setExtraOpen] = useState(false); const [extra, setExtra] = useState<Record<string, string>>({});
  const detail = trpc.leadops.getLeadDetail.useQuery({ publicId: problem.publicId }, { enabled: extraOpen, retry: false });
  const save = trpc.leadops.correctLead.useMutation({
    onSuccess: (result, variables) => {
      if (!variables.deliver) { toast.success(result.changed.length ? `Gespeichert: ${result.changed.join(", ")}.` : "Es wurde nichts geändert."); onSaved(null); return; }
      const delivery = result.delivery;
      if (delivery?.ok) toast.success(`Gespeichert und ausgeliefert: ${delivery.message}`); else toast.error(`Gespeichert – aber noch nicht ausgeliefert: ${delivery?.message ?? "unbekannter Grund"}`);
      onSaved(delivery ?? null);
    },
    onError: (error) => toast.error(error.message),
  });
  const wrong = (key: LeadContactField): string | null => key === "email" ? emailProblem(values.email) : key === "phone" ? phoneProblem(values.phone) : key === "postcode" ? postcodeProblem(values.postcode, problem.lead.country) : null;
  const marked = new Set<LeadContactField>([...(problem.field ? [problem.field] : []), ...problem.dataProblems.map((item) => item.field)]);
  const invalid = CONTACT_FIELDS.some((key) => wrong(key)); const noName = !values.firstName.trim() && !values.lastName.trim();
  const changes = () => { const out: Partial<Record<LeadContactField, string>> & { fields?: Record<string, string> } = {}; for (const key of CONTACT_FIELDS) if (values[key].trim() !== problem.lead[key].trim()) out[key] = values[key]; if (Object.keys(extra).length) out.fields = extra; return out; };
  const submit = (deliver: boolean) => save.mutate({ publicId: problem.publicId, changes: changes(), deliver });
  const suggestion = wrong("email") ? suggestEmail(values.email) : null;
  const plzSuggestion = wrong("postcode") ? postcodeSuggestion(values.postcode, problem.lead.country) : null; // „9633“ → „09633“
  const fields = detail.data?.fields ?? [];
  return <form className="af-edit" aria-label={`${problem.name} korrigieren`} onSubmit={(event) => { event.preventDefault(); if (!invalid && !noName) submit(true); }}>
    <h4>Angaben korrigieren</h4>
    <div className="af-edit-grid">{CONTACT_FIELDS.map((key) => { const hint = wrong(key); return <label key={key} className={`af-field is-${key} ${hint ? "is-wrong" : marked.has(key) && values[key].trim() === problem.lead[key].trim() ? "is-marked" : ""}`}>
      <span>{LEAD_FIELD_LABEL[key]}</span>
      {key === "salutation" ? <select className="filter-select" aria-label="Anrede" value={values.salutation} onChange={(event) => setValues({ ...values, salutation: event.target.value })}><option value="">– leer –</option><option value="Herr">Herr</option><option value="Frau">Frau</option></select>
        : <Input value={values[key]} inputMode={key === "phone" ? "tel" : key === "email" ? "email" : key === "postcode" ? "numeric" : undefined} autoComplete="off" spellCheck={false} aria-invalid={Boolean(hint)} onChange={(event) => setValues({ ...values, [key]: event.target.value })} />}
      {hint ? <small role="alert">{hint}</small> : marked.has(key) && values[key].trim() === problem.lead[key].trim() ? <small>{values[key].trim() ? "Hier hakt es – bitte prüfen." : "Fehlt – bitte nachtragen."}</small> : null}
      {key === "email" && suggestion && <button type="button" className="af-suggest" onClick={() => setValues({ ...values, email: suggestion })}>Meintest du <b>{suggestion}</b>? Übernehmen</button>}
      {key === "postcode" && plzSuggestion && <button type="button" className="af-suggest" onClick={() => setValues({ ...values, postcode: plzSuggestion })}>Die führende Null fehlt: <b>{plzSuggestion}</b> übernehmen</button>}
    </label>; })}</div>
    <button type="button" className="af-more" aria-expanded={extraOpen} onClick={() => setExtraOpen(!extraOpen)}><ChevronDown aria-hidden="true" /> {extraOpen ? "Felder der Kategorie ausblenden" : `Felder der Kategorie „${problem.categoryName}“ bearbeiten`}</button>
    {extraOpen && (detail.isLoading ? <p className="af-edit-note">Felder werden geladen …</p> : !fields.length ? <p className="af-edit-note">Diese Kategorie hat keine eigenen Felder.</p> : <div className="af-edit-grid">{fields.map((field) => { const current = field.key in extra ? extra[field.key] : field.value === null || field.value === undefined ? "" : String(field.value); const set = (value: string) => setExtra({ ...extra, [field.key]: value });
      return <label key={field.key} className="af-field"><span>{field.label}</span>{field.type === "auswahl" && field.options.length ? <select className="filter-select" value={current} onChange={(event) => set(event.target.value)}><option value="">– leer –</option>{!field.options.includes(current) && current && <option value={current}>{current} (passt nicht zur Auswahl)</option>}{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select> : field.type === "ja_nein" ? <select className="filter-select" value={current} onChange={(event) => set(event.target.value)}><option value="">– leer –</option>{!["Ja", "Nein", ""].includes(current) && <option value={current}>{current}</option>}<option value="Ja">Ja</option><option value="Nein">Nein</option></select> : <Input value={current} onChange={(event) => set(event.target.value)} />}</label>; })}</div>)}
    <div className="af-edit-foot">
      {noName ? <small role="alert">Vorname oder Nachname muss stehen bleiben.</small> : invalid ? <small role="alert">Bitte zuerst die markierten Angaben berichtigen.</small> : <small>Die Änderung steht mit altem und neuem Wert im Lead-Log.</small>}
      <span><Button type="button" variant="ghost" onClick={onCancel}>Abbrechen</Button><Button type="button" variant="outline" disabled={save.isPending || invalid || noName} onClick={() => submit(false)}>Nur speichern</Button><Button type="submit" className="flux-button" disabled={save.isPending || invalid || noName}><Send className="h-4 w-4" /> {save.isPending ? "Wird gespeichert …" : "Speichern und ausliefern"}</Button></span>
    </div>
  </form>;
}
