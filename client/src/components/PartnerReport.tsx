import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { BadgeCheck, CalendarRange, ChevronDown, Info, KeyRound, RefreshCw, Search, Send, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import { CONTACT_FILTERS, CONTACT_STATUS, QUICK_RANGES, REPORT_BASES, activeQuickRange, berlinDay, euro, isDay, providerName, quickRange, share, type ContactStatus, type ReportBasis, type ReportCard, type ReportCounts } from "../../../shared/partner-report";

/**
 * Statistik „Integrationen“: je Partnerkonto, was aus den gelieferten Leads wurde – geliefert, abgelehnt, angenommen, dann die Bewertung
 * des Partners (offen, anerkannt, storniert, ausgezahlt) mit Provision. Alle Filter stehen in der Adresse; jede Ansicht lässt sich verlinken.
 */
const BRAND: Record<string, string> = { aroundhome: "#f97316", wattfox: "#eab308", leadnodes: "#0ea5e9", enpal: "#22c55e", gohighlevel: "#6366f1" };
const count = (value: number) => value.toLocaleString("de-DE");
const longDay = (day: string) => { const [y, m, d] = day.split("-"); return `${d}.${m}.${y}`; };
const stamp = (value: string) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
function ago(value: Date | string | null): string {
  if (!value) return "noch nie"; const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `vor ${seconds} Sek.`; const minutes = Math.round(seconds / 60); if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60); if (hours < 48) return `vor ${hours} Std.`; return `vor ${Math.round(hours / 24)} Tagen`;
}
type Query = { from: string; to: string; basis: ReportBasis; categoryId: number | null };
function readQuery(): Partial<Query> {
  const params = new URLSearchParams(window.location.search); const basis = params.get("basis") as ReportBasis | null; const leadType = Number(params.get("leadType"));
  return { from: isDay(params.get("from")) ? params.get("from")! : undefined, to: isDay(params.get("to")) ? params.get("to")! : undefined, basis: REPORT_BASES.some((item) => item.key === basis) ? basis! : undefined, categoryId: Number.isInteger(leadType) && leadType > 0 ? leadType : undefined };
}
function writeQuery(query: Query, isDefault: boolean) {
  try { const url = new URL(window.location.href); const set = (key: string, value: string | null) => { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); };
    set("from", isDefault ? null : query.from); set("to", isDefault ? null : query.to); set("basis", query.basis === "delivery" ? null : query.basis); set("leadType", query.categoryId ? String(query.categoryId) : null);
    window.history.replaceState(window.history.state, "", url.toString()); } catch { /* ignorieren */ }
}

function Tile({ label, value, tone, children }: { label: string; value: string; tone?: "good" | "bad" | "calm"; children?: ReactNode }) {
  return <div className={`pr-tile ${tone ? `is-${tone}` : ""}`}><span>{label}</span><strong>{value}</strong>{children && <small>{children}</small>}</div>;
}
/** Der Weg der gelieferten Leads als ein Balken: abgelehnt · ohne Rückmeldung · offen · storniert · anerkannt. */
function Flow({ counts }: { counts: ReportCounts }) {
  const parts = [{ key: "rejected", label: "abgelehnt", value: counts.rejected }, { key: "silent", label: "ohne Rückmeldung", value: counts.silent + counts.pending }, { key: "open", label: "offen", value: counts.open }, { key: "cancelled", label: "storniert", value: counts.cancelled }, { key: "confirmed", label: "anerkannt", value: counts.confirmed }].filter((part) => part.value > 0);
  if (!counts.delivered) return null;
  return <div className="pr-flow" role="img" aria-label={`Von ${count(counts.delivered)} gelieferten Leads: ${parts.map((part) => `${count(part.value)} ${part.label}`).join(", ")}`}>
    <div className="pr-flow-bar">{parts.map((part) => <i key={part.key} className={`is-${part.key}`} style={{ flexGrow: part.value }} title={`${count(part.value)} ${part.label} · ${share(part.value, counts.delivered)}`} />)}</div>
    <ul>{parts.map((part) => <li key={part.key}><i className={`is-${part.key}`} aria-hidden="true" /><b>{count(part.value)}</b> {part.label}</li>)}</ul>
  </div>;
}
function Fold({ title, counter, children, onOpen }: { title: string; counter: number; children: ReactNode; onOpen?: () => void }) {
  return <details className="pr-fold" onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) onOpen?.(); }}><summary><ChevronDown aria-hidden="true" /><span>{title}</span><em>{count(counter)}</em></summary><div className="pr-fold-body">{children}</div></details>;
}

/** Kontakte eines Kontos – erst beim Aufklappen geladen; Statusfilter und Suche laufen über alle Zeilen, „Mehr anzeigen“ lädt nach. */
function Contacts({ accountId, query }: { accountId: number; query: Query }) {
  const [status, setStatus] = useState<"all" | ContactStatus>("all"); const [typed, setTyped] = useState(""); const [search, setSearch] = useState(""); const [limit, setLimit] = useState(50);
  useEffect(() => { const timer = window.setTimeout(() => { setSearch(typed.trim()); setLimit(50); }, 300); return () => window.clearTimeout(timer); }, [typed]);
  const list = trpc.leadops.partnerContacts.useQuery({ accountId, from: query.from, to: query.to, basis: query.basis, categoryId: query.categoryId, status, search: search || undefined, offset: 0, limit }, { retry: false, placeholderData: (previous) => previous });
  const rows = list.data?.rows ?? []; const total = list.data?.total ?? 0;
  return <div className="pr-contacts">
    <div className="pr-contacts-tools"><select aria-label="Status" className="filter-select" value={status} onChange={(event) => { setStatus(event.target.value as "all" | ContactStatus); setLimit(50); }}>{CONTACT_FILTERS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
      <label className="pr-search"><Search aria-hidden="true" /><input aria-label="Kontakte durchsuchen" placeholder="Name, Ort oder Lead-Nummer" value={typed} onChange={(event) => setTyped(event.target.value)} />{typed && <button type="button" aria-label="Suche leeren" onClick={() => setTyped("")}><X /></button>}</label>
      <span className="pr-contacts-count" aria-live="polite">{list.data ? `${count(total)} ${total === 1 ? "Kontakt" : "Kontakte"}` : ""}</span></div>
    {list.isLoading ? <p className="pr-note">Kontakte werden geladen …</p> : list.error ? <p className="pr-note is-bad">{list.error.message}</p> : !rows.length ? <p className="pr-note">Kein Kontakt passt zu dieser Auswahl.</p> :
      <div className="pr-table-wrap"><table className="pr-table"><thead><tr><th>Kontakt</th><th>Ort</th><th>Sparte</th><th>Konto</th><th>Geliefert am</th><th>Status</th><th>Stornogrund</th><th className="num">Provision</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.leadId}><td><a href={`/?page=Leads&lead=${encodeURIComponent(row.publicId)}`}><b>{row.name}</b><small>{row.publicId}</small></a></td><td>{row.city ?? "—"}</td><td>{row.categoryName ?? "—"}</td><td>{row.buyerName}</td><td>{stamp(row.deliveredAt)}</td><td><span className={`pr-status is-${CONTACT_STATUS[row.status].tone}`}>{CONTACT_STATUS[row.status].label}</span></td><td>{row.cancelReason ?? "—"}</td><td className="num">{row.commission !== null ? euro(row.commission) : "—"}</td></tr>)}</tbody></table></div>}
    {rows.length < total && <div className="pr-more"><Button variant="outline" size="sm" disabled={list.isFetching} onClick={() => setLimit(limit + 100)}>{list.isFetching ? "Lädt …" : `Mehr anzeigen (${count(Math.min(100, total - rows.length))} weitere)`}</Button><small>{count(rows.length)} von {count(total)} angezeigt</small></div>}
  </div>;
}

function PartnerCard({ card, query, onSync, syncing }: { card: ReportCard; query: Query; onSync: () => void; syncing: boolean }) {
  const { account, counts: c } = card; const [contactsOpen, setContactsOpen] = useState(false);
  const rated = account.mode !== "none" && (account.mode === "pull" || c.rated > 0);
  return <article className="pr-card" style={{ "--brand": BRAND[account.provider] ?? "var(--lt-accent-strong)" } as CSSProperties} aria-label={card.title}>
    <header className="pr-card-head"><span className="pr-mark" aria-hidden="true">{providerName(account.provider).slice(0, 2)}</span><div><h3>{card.title}</h3><p>{account.buyerName ? `Käufer: ${account.buyerName}` : "Noch keinem Käufer zugeordnet"}</p></div>
      {account.mode === "pull" && account.hasAccess ? <div className="pr-sync"><span title={account.lastSyncNote ?? undefined}>zuletzt aktualisiert {ago(account.lastSyncAt)}</span><Button variant="outline" size="sm" disabled={syncing} onClick={onSync}><RefreshCw className={syncing ? "animate-spin" : ""} /> {syncing ? "Wird abgeglichen …" : "Aktualisieren"}</Button></div>
        : account.mode === "push" ? <div className="pr-sync is-info"><Info aria-hidden="true" /><span>{providerName(account.provider)} meldet jede Änderung selbst – es gibt nichts abzurufen.</span></div>
        : <div className="pr-sync is-info"><KeyRound aria-hidden="true" /><span>{account.mode === "pull" ? "Noch kein Zugang hinterlegt." : "Für diesen Partner gibt es noch keinen Rückkanal."} <a href="/?page=Einstellungen&setting=Integrationen">Unter Einstellungen → Integrationen einrichten</a></span></div>}</header>
    <Flow counts={c} />
    <section className="pr-block" aria-label="Zustellung"><h4>Zustellung</h4><div className="pr-tiles">
      <Tile label="Geliefert" value={count(c.delivered)}>{c.pending ? `${count(c.pending)} noch ohne Ergebnis` : null}</Tile>
      <Tile label="Abgelehnt" value={count(c.rejected)} tone="calm">{share(c.rejected, c.delivered)} · sofort beim Senden (meist Dublette)</Tile>
      <Tile label="Angenommen" value={count(c.accepted)}>{share(c.accepted, c.delivered)} der gelieferten</Tile>
      <Tile label="Gesamtquote" value={share(c.confirmed, c.delivered)} tone="good">{count(c.confirmed)} anerkannt von {count(c.delivered)} gelieferten{c.open ? ` · ${count(c.open)} noch offen` : ""}</Tile>
    </div></section>
    {rated && <section className="pr-block" aria-label="Bewertung durch den Partner"><h4>Bewertung durch den Partner <span>{count(c.rated)} von {count(c.accepted)} angenommenen bewertet</span></h4><div className="pr-tiles">
      <Tile label="Offen" value={count(c.open)}>{share(c.open, c.accepted)} · noch nicht entschieden</Tile>
      <Tile label="Anerkannt" value={count(c.confirmed)} tone="good">{share(c.confirmed, c.rated)} der bewerteten · davon {count(c.paid)} ausgezahlt</Tile>
      <Tile label="Storniert" value={count(c.cancelled)} tone="bad">{share(c.cancelled, c.rated)} der bewerteten</Tile>
      <Tile label="Provision" value={euro(c.commission)}>{c.confirmed ? `Ø ${euro((c.commission - card.unmatchedCommission) / c.confirmed)} je anerkanntem Lead` : null}</Tile>
    </div></section>}
    {(c.silent > 0 || card.unmatched > 0) && <ul className="pr-hints">
      {c.silent > 0 && rated && <li>{count(c.silent)} angenommene {c.silent === 1 ? "Lead" : "Leads"} ohne Rückmeldung: Sie fehlen beim Partner noch, oder der letzte Abgleich hat sie nicht erfasst.</li>}
      {card.unmatched > 0 && <li>{count(card.unmatched)} {card.unmatched === 1 ? "Transaktion" : "Transaktionen"} des Partners ohne unsere Zustellung – sie zählen in keinem Zähler.{card.unmatchedCommission > 0 ? ` Ihre Provision (${euro(card.unmatchedCommission)}) steckt in der Kachel „Provision“.` : ""}</li>}
    </ul>}
    {card.buyers.length > 0 && <div className="pr-table-wrap"><table className="pr-table"><thead><tr><th>Käufer</th><th className="num">Geliefert</th><th className="num">Abgelehnt</th><th className="num">Angenommen</th>{rated && <><th className="num">Offen</th><th className="num">Anerkannt</th><th className="num">Storniert</th><th className="num">davon ausgezahlt</th><th className="num">Provision</th></>}</tr></thead>
      <tbody>{card.buyers.map((row) => <tr key={row.buyerName}><td><b>{row.buyerName}</b></td><td className="num">{count(row.delivered)}</td><td className="num">{count(row.rejected)}</td><td className="num">{count(row.accepted)}</td>{rated && <><td className="num">{count(row.open)}</td><td className="num is-good">{count(row.confirmed)}</td><td className="num is-bad">{count(row.cancelled)}</td><td className="num">{count(row.paid)}</td><td className="num">{euro(row.commission)}</td></>}</tr>)}</tbody></table></div>}
    <div className="pr-folds">
      {card.direct && <Fold title="Direkt beim Partner eingeliefert" counter={card.direct.total}>
        <p className="pr-note">Kontakte, die nicht über uns liefen, sondern direkt beim Partner angelegt wurden – zum Beispiel über sein Formular an der Haustür. Bekannt sind nur die Referenz und der Status, keine Kontaktdaten.</p>
        <div className="pr-tiles"><Tile label="Eingeliefert" value={count(card.direct.total)} /><Tile label="Qualifiziert" value={count(card.direct.qualified)} tone="good">{share(card.direct.qualified, card.direct.total)} · anerkannt oder ausgezahlt</Tile><Tile label="Storniert" value={count(card.direct.cancelled)} tone="bad">{share(card.direct.cancelled, card.direct.total)}</Tile><Tile label="Offen" value={count(card.direct.open)} tone="calm">{share(card.direct.open, card.direct.total)}</Tile></div>
        {card.direct.bySub.length > 0 && <div className="pr-table-wrap"><table className="pr-table"><caption>Nach Vertriebler (Sub-ID)</caption><thead><tr><th>Vertriebler</th><th className="num">Eingeliefert</th><th className="num">Qualifiziert</th><th className="num">Storniert</th><th className="num">Offen</th></tr></thead><tbody>{card.direct.bySub.map((row) => <tr key={row.subId}><td><b>{row.subId}</b></td><td className="num">{count(row.total)}</td><td className="num is-good">{count(row.qualified)} <small>{share(row.qualified, row.total)}</small></td><td className="num is-bad">{count(row.cancelled)}</td><td className="num">{count(row.open)}</td></tr>)}</tbody></table></div>}
        <div className="pr-table-wrap"><table className="pr-table"><caption>Nach Tag</caption><thead><tr><th>Tag</th><th className="num">Eingeliefert</th><th className="num">Offen</th><th className="num">Anerkannt</th><th className="num">Storniert</th><th className="num">Ausgezahlt</th><th className="num">Provision</th></tr></thead><tbody>{card.direct.byDay.map((row) => <tr key={row.day}><td><b>{longDay(row.day)}</b></td><td className="num">{count(row.total)}</td><td className="num">{count(row.open)}</td><td className="num is-good">{count(row.confirmed)}</td><td className="num is-bad">{count(row.cancelled)}</td><td className="num">{count(row.paid)}</td><td className="num">{euro(row.commission)}</td></tr>)}</tbody></table></div>
      </Fold>}
      {card.categories.length > 0 && <Fold title="Sparten beim Partner" counter={c.rated}>
        <p className="pr-note">Die Sparte ist hier die Kategorie des Partners aus der Transaktion – nicht unsere eigene.</p>
        <div className="pr-table-wrap"><table className="pr-table"><thead><tr><th>Sparte</th><th className="num">Angenommen</th><th className="num">Anerkannt</th><th className="num">Storniert</th><th className="num">Offen</th><th className="num">Provision</th><th className="num">je angenommenem</th></tr></thead><tbody>{card.categories.map((row) => <tr key={row.name}><td><b>{row.name}</b></td><td className="num">{count(row.accepted)}</td><td className="num is-good">{count(row.confirmed)} <small>{share(row.confirmed, row.accepted)}</small></td><td className="num is-bad">{count(row.cancelled)}</td><td className="num">{count(row.open)}</td><td className="num">{euro(row.commission)}</td><td className="num">{row.accepted ? euro(row.commission / row.accepted) : "—"}</td></tr>)}</tbody></table></div>
      </Fold>}
      {card.campaigns.length > 0 && <Fold title="Kampagnen (wie auf der Gutschrift)" counter={c.confirmed}>
        <p className="pr-note">Zum Abgleich mit der Gutschrift: Der Partner gliedert sie nach Kampagne.</p>
        <div className="pr-table-wrap"><table className="pr-table"><thead><tr><th>Kampagne</th><th className="num">Anerkannt</th><th className="num">davon ausgezahlt</th><th className="num">Provision</th></tr></thead><tbody>{card.campaigns.map((row) => <tr key={row.name}><td><b>{row.name}</b></td><td className="num is-good">{count(row.confirmed)}</td><td className="num">{count(row.paid)}</td><td className="num">{euro(row.commission)}</td></tr>)}</tbody></table></div>
      </Fold>}
      {c.delivered > 0 && <Fold title="Kontakte" counter={c.delivered} onOpen={() => setContactsOpen(true)}>{contactsOpen ? <Contacts accountId={account.id} query={query} /> : <p className="pr-note">Kontakte werden geladen …</p>}</Fold>}
      {card.cancelReasons.length > 0 && <Fold title="Stornogründe" counter={c.cancelled}>
        <div className="pr-table-wrap"><table className="pr-table"><thead><tr><th>Stornogrund</th><th className="num">Anzahl</th><th>Anteil</th></tr></thead><tbody>{card.cancelReasons.map((row) => <tr key={row.reason}><td><b>{row.reason}</b></td><td className="num">{count(row.count)}</td><td><span className="pr-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, (row.count / Math.max(1, card.cancelReasons[0].count)) * 100)}%` }} /></span> <small>{share(row.count, c.cancelled)}</small></td></tr>)}</tbody></table></div>
      </Fold>}
    </div>
  </article>;
}

export default function PartnerReport() {
  const utils = trpc.useUtils(); const today = berlinDay(new Date()); const standard = quickRange("last30", today);
  const [query, setQuery] = useState<Query>(() => { const read = readQuery(); let from = read.from ?? standard.from; let to = read.to ?? standard.to; if (from > to) [from, to] = [to, from]; return { from, to, basis: read.basis ?? "delivery", categoryId: read.categoryId ?? null }; });
  const [draft, setDraft] = useState({ from: query.from, to: query.to });
  const apply = (next: Partial<Query>) => { const merged = { ...query, ...next }; if (merged.from > merged.to) [merged.from, merged.to] = [merged.to, merged.from]; setQuery(merged); setDraft({ from: merged.from, to: merged.to }); writeQuery(merged, merged.from === standard.from && merged.to === standard.to); };
  const categories = trpc.leadops.listCategories.useQuery(undefined, { retry: false });
  const report = trpc.leadops.partnerReport.useQuery({ from: query.from, to: query.to, basis: query.basis, categoryId: query.categoryId }, { retry: false, refetchInterval: 120_000, placeholderData: (previous) => previous });
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const sync = trpc.leadops.syncAroundhomeAccount.useMutation({ onSuccess: (result) => { toast.success(result.summary); utils.leadops.partnerReport.invalidate(); utils.leadops.partnerContacts.invalidate(); }, onError: (error) => toast.error(error.message), onSettled: () => setSyncingId(null) });
  const quick = activeQuickRange(query.from, query.to, today); const basis = REPORT_BASES.find((item) => item.key === query.basis)!;
  const sorted = useMemo(() => (categories.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, "de")), [categories.data]);
  const cards = report.data?.cards ?? []; const draftChanged = draft.from !== query.from || draft.to !== query.to; const draftValid = isDay(draft.from) && isDay(draft.to);
  const sum = cards.reduce((total, card) => ({ delivered: total.delivered + card.counts.delivered, confirmed: total.confirmed + card.counts.confirmed, open: total.open + card.counts.open, commission: total.commission + card.counts.commission, matched: total.matched + card.counts.commission - card.unmatchedCommission }), { delivered: 0, confirmed: 0, open: 0, commission: 0, matched: 0 });
  return <div className="fx-scope pr">
    <section className="pr-filter" aria-label="Filter">
      <div className="pr-filter-row">
        <label>Sparte<select className="filter-select" value={query.categoryId ?? ""} onChange={(event) => apply({ categoryId: Number(event.target.value) || null })}><option value="">Alle Sparten</option>{sorted.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>Von<input type="date" className="pr-date" value={draft.from} max={draft.to || undefined} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
        <label>Bis<input type="date" className="pr-date" value={draft.to} min={draft.from || undefined} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
        <Button variant="outline" disabled={!draftChanged || !draftValid} onClick={() => apply({ from: draft.from, to: draft.to })}>Anwenden</Button>
        <label className="pr-basis">Zeitraum nach<select className="filter-select" value={query.basis} onChange={(event) => apply({ basis: event.target.value as ReportBasis })}>{REPORT_BASES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      </div>
      <div className="pr-quick" role="group" aria-label="Schnellwahl"><CalendarRange aria-hidden="true" />{QUICK_RANGES.map((item) => <button key={item.key} type="button" aria-pressed={quick === item.key} className={quick === item.key ? "is-on" : ""} onClick={() => apply(quickRange(item.key, today))}>{item.label}</button>)}</div>
    </section>
    {basis.note && <p className="pr-basis-note"><Info aria-hidden="true" /><span><b>{basis.label}:</b> {basis.note}</span></p>}
    {report.isLoading ? <div className="pr-skeleton" aria-label="Wird geladen"><i /><i /><i /></div> : report.error ? <p className="pr-note is-bad">{report.error.message}</p> : !cards.length ? <section className="pr-empty"><KeyRound aria-hidden="true" /><h3>Noch kein Partnerkonto</h3><p>Lege unter Einstellungen → Integrationen ein Konto bei Aroundhome, WattFox, Leadnodes, Enpal oder GoHighLevel an. Danach steht hier je Konto, was aus den gelieferten Leads wurde.</p><a className="flux-button pr-empty-link" href="/?page=Einstellungen&setting=Integrationen">Partnerkonto anlegen</a></section> : <>
      <section className="pr-rail" aria-label="Alle Partnerkonten zusammen">
        <div className="pr-stat"><span><KeyRound aria-hidden="true" /> Partnerkonten</span><strong>{count(cards.length)}</strong><small>{longDay(query.from)} – {longDay(query.to)}</small></div>
        <div className="pr-stat"><span><Send aria-hidden="true" /> Geliefert</span><strong>{count(sum.delivered)}</strong><small>an alle Konten zusammen</small></div>
        <div className="pr-stat is-good"><span><BadgeCheck aria-hidden="true" /> Anerkannt</span><strong>{count(sum.confirmed)} <em>{share(sum.confirmed, sum.delivered)}</em></strong><small>{sum.open ? `${count(sum.open)} noch offen` : "Gesamtquote aller Konten"}</small></div>
        <div className="pr-stat"><span><Wallet aria-hidden="true" /> Provision</span><strong>{euro(sum.commission)}</strong><small>{sum.confirmed ? `Ø ${euro(sum.matched / sum.confirmed)} je anerkanntem Lead` : "noch keine anerkannten Leads"}</small></div>
      </section>
      {cards.map((card) => <PartnerCard key={card.account.id} card={card} query={query} syncing={syncingId === card.account.id} onSync={() => { setSyncingId(card.account.id); sync.mutate({ id: card.account.id }); }} />)}
    </>}
  </div>;
}
