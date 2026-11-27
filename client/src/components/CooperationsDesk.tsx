import { Button } from "@/components/ui/button";
import { confirmAction } from "@/lib/confirm";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Check, ChevronDown, Handshake, Hourglass, Pause, Play, Plus, Search, Trash2, Users, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { AppRouter } from "../../../server/routers";
import { categoryEmoji } from "../../../shared/category-emoji";
import { COOP_DIRECTIONS, COOP_LEAD_FIELDS, COOP_STATUS, coopCounts, coopDirectionLabel, coopFieldLabel, coopMatches, coopNameIssue, coopNextStep, coopStatusLabel, coopStatusTone, coopSummary, type CoopDirection, type CoopStatus } from "../../../shared/cooperation-view";

type Cooperation = inferRouterOutputs<AppRouter>["leadops"]["listCooperations"][number];
type Category = inferRouterOutputs<AppRouter>["leadops"]["listCategories"][number];
type Tab = "alle" | CoopStatus;
const OTHER_FIELD = "__anderes__";
const num = (value: number) => value.toLocaleString("de-DE");
const DirectionIcon = ({ direction }: { direction: string }) => direction === "eingehend" ? <ArrowDownLeft aria-hidden="true" /> : direction === "beidseitig" ? <ArrowLeftRight aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />;
const requestedId = () => { try { return Number(new URLSearchParams(window.location.search).get("coop")) || null; } catch { return null; } };

/**
 * Kooperationen: das Verzeichnis der Partner, mit denen Leads ausgetauscht werden – Richtung, Stand und wie Kategorien und Felder
 * beim Partner heißen. Aufbau wie die neu gestalteten Seiten: Zahlen als Leiste, Reiter nach Stand, Suche, eine Zeile je Partner,
 * die an Ort und Stelle aufklappt. Ausgeliefert wird über die Lieferkette und die Integrationen; diese Seite ändert daran nichts.
 */
export default function CooperationsDesk() {
  const utils = trpc.useUtils();
  const cooperations = trpc.leadops.listCooperations.useQuery(undefined, { retry: false });
  const categories = trpc.leadops.listCategories.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const [tab, setTab] = useState<Tab>("alle");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(() => requestedId());
  const [creating, setCreating] = useState(false);
  // Ein Verzeichnis: nach Namen sortiert – so springt keine Zeile nach oben, nur weil man sie gerade geändert hat.
  const rows = useMemo(() => [...(cooperations.data ?? [])].sort((a, b) => a.partnerTenantName.localeCompare(b.partnerTenantName, "de", { sensitivity: "base" }) || a.id - b.id), [cooperations.data]);
  const categoryOf = (id: number) => (categories.data ?? []).find((item) => item.id === id) ?? null;
  const counts = coopCounts(rows);
  const found = rows.filter((row) => coopMatches(row, search, (id) => categoryOf(id)?.name ?? null));
  const tabCounts = coopCounts(found);
  const visible = found.filter((row) => tab === "alle" || row.status === tab);
  const narrowed = tab !== "alle" || Boolean(search.trim());
  const refresh = () => utils.leadops.listCooperations.invalidate();
  const showAll = () => { setTab("alle"); setSearch(""); };
  // Der geöffnete Partner rutscht nach dem Laden bzw. Anlegen ins Bild
  useEffect(() => { if (openId && rows.some((row) => row.id === openId)) document.getElementById(`ko-${openId}`)?.scrollIntoView?.({ block: "nearest" }); }, [openId, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = (count: number) => cooperations.data ? num(count) : "–";

  return <div className="fx-scope tg ko">
    <header className="page-intro compact"><div><span className="eyebrow">ORGANISATION</span><h1>Kooperationen</h1><p>Mit welchen Partnern du Leads austauschst – mit Richtung, Stand und den Namen, die deine Kategorien und Felder beim Partner haben.</p></div><nav className="people-header-actions"><Button className="flux-button" onClick={() => setCreating(true)} disabled={creating}><Plus aria-hidden="true" /> Kooperation anlegen</Button></nav></header>
    <section className="tg-rail" aria-label="Kooperationen auf einen Blick">
      <div className="tg-stat"><span><Users aria-hidden="true" /> Partner</span><strong>{value(counts.alle)}</strong><small>{!cooperations.data ? "" : counts.alle ? `${num(counts.zuordnungen)} ${counts.zuordnungen === 1 ? "Zuordnung" : "Zuordnungen"} hinterlegt` : "noch keiner angelegt"}</small></div>
      <div className="tg-stat"><span><Handshake aria-hidden="true" /> Aktiv</span><strong>{value(counts.aktiv)}</strong><small>{!cooperations.data ? "" : counts.aktiv ? "die Zusammenarbeit läuft" : "noch keine aktiv"}</small></div>
      <div className={`tg-stat ${counts.angefragt ? "is-wait" : ""}`}><span><Hourglass aria-hidden="true" /> Angefragt</span><strong>{value(counts.angefragt)}</strong><small>{!cooperations.data ? "" : counts.angefragt ? "noch nicht bestätigt" : "nichts offen"}</small></div>
      <div className="tg-stat"><span><Pause aria-hidden="true" /> Pausiert</span><strong>{value(counts.inaktiv)}</strong><small>{!cooperations.data ? "" : counts.inaktiv ? "ruhen gerade" : "keine pausiert"}</small></div>
    </section>
    {creating && <CooperationCreate existing={rows} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); showAll(); void refresh(); if (id) setOpenId(id); }} />}
    <section className="tg-list ko-list" aria-label="Alle Kooperationen">
      <div className="fx-toolrow">
        <div className="fx-tabs" role="tablist" aria-label="Kooperationen nach Stand">{([{ key: "alle", label: "Alle", hint: "" }, ...COOP_STATUS] as Array<{ key: Tab; label: string; hint: string }>).map((item) => <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={tab === item.key ? "active" : ""} title={item.hint || undefined} onClick={() => setTab(item.key)}>{item.label}<span>{cooperations.data ? num(item.key === "alle" ? tabCounts.alle : tabCounts[item.key]) : ""}</span></button>)}</div>
        <label className="fx-search"><Search aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Partner, Kategorie oder Feld" aria-label="Kooperationen durchsuchen" />{search && <button type="button" aria-label="Suche leeren" onClick={() => setSearch("")}><X aria-hidden="true" /></button>}</label>
      </div>
      {cooperations.isLoading ? <p className="tg-note">Kooperationen werden geladen …</p>
        : cooperations.error ? <div className="rd-none"><p className="is-bad">Die Kooperationen konnten nicht geladen werden: {cooperations.error.message}</p><button type="button" className="fx-tool" onClick={() => void cooperations.refetch()}>Erneut laden</button></div>
        : !visible.length ? (narrowed ? <div className="rd-none"><p>Zu dieser Auswahl gibt es keinen Partner.</p><button type="button" className="fx-tool" onClick={showAll}>Alle Partner zeigen</button></div>
          : <div className="rd-empty"><Handshake aria-hidden="true" /><b>Noch kein Partner</b><p>Lege den ersten Partner an und halte fest, in welche Richtung Leads gehen und wie deine Kategorien bei ihm heißen.</p><Button className="flux-button" onClick={() => setCreating(true)} disabled={creating}><Plus aria-hidden="true" /> Kooperation anlegen</Button></div>)
        : <>
          <div className="ko-rows-head" aria-hidden="true"><span>Partner</span><span>Zugeordnet</span><span>Stand</span><span /></div>
          <ul className="ko-rows">{visible.map((row) => { const on = openId === row.id; const tone = coopStatusTone(String(row.status)); return <li key={row.id} id={`ko-${row.id}`} className={`ko-item ${on ? "is-open" : ""}`}>
            <button type="button" className="ko-row" aria-expanded={on} onClick={() => setOpenId(on ? null : row.id)}>
              <span className="ko-who"><i className={`ko-dir is-${row.direction}`}><DirectionIcon direction={String(row.direction)} /></i><span><b>{row.partnerTenantName}</b><small>{coopDirectionLabel(String(row.direction))}</small></span></span>
              <span className={`ko-sum ${row.categories.length + row.fields.length ? "" : "is-none"}`}>{coopSummary(row)}</span>
              <span className="ko-status"><span className={`fx-pill is-${tone}`}><i />{coopStatusLabel(String(row.status))}</span></span>
              <ChevronDown className="rk-chevron" aria-hidden="true" />
            </button>
            {on && <CooperationDetail row={row} all={rows} categories={categories.data ?? []} onChanged={refresh} onDeleted={() => { setOpenId(null); void refresh(); }} />}
          </li>; })}</ul>
        </>}
    </section>
    <p className="ko-good"><b>Gut zu wissen:</b> Ausgeliefert wird über die Lieferkette und die Integrationen. Die Angaben hier sind dein Nachschlagewerk für die Zusammenarbeit – an der Auslieferung ändern sie nichts.</p>
  </div>;
}

/** Neuen Partner anlegen: Name und Richtung – mehr braucht es zum Start nicht. */
function CooperationCreate({ existing, onClose, onCreated }: { existing: Cooperation[]; onClose: () => void; onCreated: (id: number | null) => void }) {
  const [name, setName] = useState(""); const [direction, setDirection] = useState<CoopDirection>("ausgehend"); const [tried, setTried] = useState(false);
  const create = trpc.leadops.createCooperation.useMutation({ onSuccess: (result) => { toast.success("Kooperation angelegt – sie steht auf „Angefragt“, bis du sie aktivierst."); onCreated((result as { id?: number | null }).id ?? null); }, onError: (error) => toast.error(error.message) });
  const issue = coopNameIssue(name, existing);
  const submit = (event: FormEvent) => { event.preventDefault(); setTried(true); if (issue) return; create.mutate({ partnerTenantName: name.trim(), direction }); };
  return <form className="fx-scope cf ko-create" onSubmit={submit} aria-label="Kooperation anlegen">
    <div className="ld-head"><div><h2>Kooperation anlegen</h2><p>Name und Richtung genügen. Kategorien und Felder ordnest du danach in Ruhe zu.</p></div><button type="button" className="ld-close" aria-label="Schließen" onClick={onClose}><X aria-hidden="true" /></button></div>
    <div className="cf-fields">
      <label className="rd-field"><span>Name des Partners</span><input className="fx-field" value={name} onChange={(event) => setName(event.target.value)} placeholder="z. B. Solarnetz Bayern" maxLength={160} autoFocus aria-invalid={tried && Boolean(issue)} /></label>
      <label className="rd-field"><span>Richtung</span><select className="fx-select" value={direction} onChange={(event) => setDirection(event.target.value as CoopDirection)}>{COOP_DIRECTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
    </div>
    {tried && issue && <p className="ko-issue" role="alert">{issue}</p>}
    <div className="ld-actions"><Button type="button" variant="outline" onClick={onClose}>Abbrechen</Button><Button type="submit" className="flux-button" disabled={create.isPending}><Plus aria-hidden="true" /> {create.isPending ? "Wird angelegt …" : "Anlegen"}</Button></div>
  </form>;
}

/** Aufgeklappter Partner: Angaben ändern, Kategorien und Felder zuordnen, aktivieren/pausieren, löschen. */
export function CooperationDetail({ row, all, categories, onChanged, onDeleted }: { row: Cooperation; all: Cooperation[]; categories: Category[]; onChanged: () => void; onDeleted: () => void }) {
  const fail = { onError: (error: { message: string }) => toast.error(error.message) };
  const [name, setName] = useState(row.partnerTenantName); const [direction, setDirection] = useState<CoopDirection>(row.direction as CoopDirection); const [partnerNumber, setPartnerNumber] = useState(row.partnerTenantId ? String(row.partnerTenantId) : "");
  useEffect(() => { setName(row.partnerTenantName); setDirection(row.direction as CoopDirection); setPartnerNumber(row.partnerTenantId ? String(row.partnerTenantId) : ""); }, [row.id, row.partnerTenantName, row.direction, row.partnerTenantId]);
  const [categoryId, setCategoryId] = useState(""); const [partnerCategory, setPartnerCategory] = useState("");
  const [field, setField] = useState(""); const [ownField, setOwnField] = useState(""); const [partnerField, setPartnerField] = useState("");
  const save = trpc.leadops.updateCooperation.useMutation({ onSuccess: () => { toast.success("Angaben gespeichert."); onChanged(); }, ...fail });
  const setStatus = trpc.leadops.updateCooperationStatus.useMutation({ onSuccess: () => onChanged(), ...fail });
  const remove = trpc.leadops.deleteCooperation.useMutation({ onSuccess: () => { toast.success("Kooperation gelöscht."); onDeleted(); }, ...fail });
  const addCategory = trpc.leadops.setCooperationCategoryMapping.useMutation({ onSuccess: () => { setCategoryId(""); setPartnerCategory(""); onChanged(); }, ...fail });
  const dropCategory = trpc.leadops.removeCooperationCategoryMapping.useMutation({ onSuccess: () => onChanged(), ...fail });
  const addField = trpc.leadops.setCooperationFieldMapping.useMutation({ onSuccess: () => { setField(""); setOwnField(""); setPartnerField(""); onChanged(); }, ...fail });
  const dropField = trpc.leadops.removeCooperationFieldMapping.useMutation({ onSuccess: () => onChanged(), ...fail });

  const numberValue = partnerNumber.trim() ? Number(partnerNumber) : null;
  const numberIssue = numberValue !== null && (!Number.isInteger(numberValue) || numberValue <= 0) ? "Die Nummer des Partners muss eine ganze Zahl sein." : null;
  const nameIssue = coopNameIssue(name, all, row.id);
  const changed = name.trim() !== row.partnerTenantName || direction !== row.direction || (numberValue ?? null) !== (row.partnerTenantId ?? null);
  const saveDetails = (event: FormEvent) => { event.preventDefault(); const issue = nameIssue ?? numberIssue; if (issue) return void toast.error(issue); save.mutate({ id: row.id, partnerTenantName: name.trim(), direction, partnerTenantId: numberValue }); };
  const next = coopNextStep(String(row.status));
  const switchStatus = () => setStatus.mutate({ id: row.id, status: next.status }, { onSuccess: () => { toast.success(next.done); } });
  const askDelete = async () => { const mappings = row.categories.length + row.fields.length; if (await confirmAction(`Kooperation „${row.partnerTenantName}“ löschen?${mappings ? ` Die ${mappings === 1 ? "Zuordnung geht" : `${mappings} Zuordnungen gehen`} mit verloren.` : ""} Das lässt sich nicht rückgängig machen.`, { danger: true, confirmLabel: "Ja, löschen" })) remove.mutate({ id: row.id }); };
  const categoryOf = (id: number) => categories.find((item) => item.id === id) ?? null;
  const saveCategory = (event: FormEvent) => { event.preventDefault(); const id = Number(categoryId); if (!Number.isInteger(id) || id <= 0) return void toast.error("Bitte eine Lead-Kategorie wählen."); if (partnerCategory.trim().length < 2) return void toast.error("Bitte eintragen, wie die Kategorie beim Partner heißt."); addCategory.mutate({ cooperationId: row.id, sourceCategoryId: id, partnerCategoryName: partnerCategory.trim() }); };
  const sourceField = field === OTHER_FIELD ? ownField.trim() : field;
  const saveField = (event: FormEvent) => { event.preventDefault(); if (!sourceField) return void toast.error("Bitte ein Feld wählen."); if (!partnerField.trim()) return void toast.error("Bitte eintragen, wie das Feld beim Partner heißt."); addField.mutate({ cooperationId: row.id, sourceField, partnerField: partnerField.trim(), transfer: true }); };
  const mappedCategory = categoryId ? row.categories.find((item) => item.sourceCategoryId === Number(categoryId)) : undefined;
  const mappedField = sourceField ? row.fields.find((item) => item.sourceField.toLowerCase() === sourceField.toLowerCase()) : undefined;

  return <div className="ko-detail">
    <form className="ko-block ko-base" onSubmit={saveDetails} aria-label={`Angaben zu ${row.partnerTenantName}`}>
      <h3>Angaben</h3>
      <div className="ko-base-fields">
        <label className="rd-field"><span>Name des Partners</span><input className="fx-field" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} /></label>
        <label className="rd-field"><span>Richtung</span><select className="fx-select" value={direction} onChange={(event) => setDirection(event.target.value as CoopDirection)}>{COOP_DIRECTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <Button type="submit" variant="outline" disabled={!changed || save.isPending}>{save.isPending ? "Speichert …" : "Angaben speichern"}</Button>
      </div>
      <details className="ko-more" open={Boolean(row.partnerTenantId) || undefined}><summary>Der Partner arbeitet auch mit Tanesco Leads</summary><label className="rd-field rd-field-narrow"><span>Nummer seiner Organisation (freiwillig)</span><input className="fx-field" value={partnerNumber} onChange={(event) => setPartnerNumber(event.target.value)} inputMode="numeric" placeholder="z. B. 12" /></label></details>
    </form>
    <div className="ko-blocks">
      <section className="ko-block" aria-label="Kategorien beim Partner">
        <h3>Kategorien <span>{row.categories.length}</span></h3>
        <p>So heißen deine Lead-Kategorien beim Partner.</p>
        {row.categories.length > 0 && <ul className="ko-maps">{row.categories.map((item) => { const category = categoryOf(item.sourceCategoryId); return <li key={item.sourceCategoryId}><span className="ko-from">{category ? <><span aria-hidden="true">{categoryEmoji(category)}</span> {category.name}</> : <em>gelöschte Kategorie</em>}</span><ArrowRight className="ko-arrow" aria-hidden="true" /><b>{item.partnerCategoryName}</b><button type="button" className="ko-drop" aria-label={`Zuordnung ${category?.name ?? "gelöschte Kategorie"} entfernen`} title="Zuordnung entfernen" disabled={dropCategory.isPending} onClick={() => dropCategory.mutate({ cooperationId: row.id, sourceCategoryId: item.sourceCategoryId })}><X aria-hidden="true" /></button></li>; })}</ul>}
        <form className="ko-add" onSubmit={saveCategory}>
          <select className="fx-select" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} aria-label="Lead-Kategorie"><option value="">Lead-Kategorie wählen</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
          <input className="fx-field" value={partnerCategory} onChange={(event) => setPartnerCategory(event.target.value)} placeholder="Name beim Partner" maxLength={160} aria-label="Name der Kategorie beim Partner" />
          <Button type="submit" size="sm" variant="outline" disabled={addCategory.isPending}><Check aria-hidden="true" /> {mappedCategory ? "Ändern" : "Zuordnen"}</Button>
        </form>
        {mappedCategory && <small className="ko-hint">Schon zugeordnet als „{mappedCategory.partnerCategoryName}“ – „Ändern“ ersetzt den Namen.</small>}
      </section>
      <section className="ko-block" aria-label="Felder beim Partner">
        <h3>Felder <span>{row.fields.length}</span></h3>
        <p>So heißen die Angaben eines Leads beim Partner.</p>
        {row.fields.length > 0 && <ul className="ko-maps">{row.fields.map((item) => <li key={item.sourceField}><span className="ko-from">{coopFieldLabel(item.sourceField)}</span><ArrowRight className="ko-arrow" aria-hidden="true" /><b>{item.partnerField || "–"}</b><button type="button" className="ko-drop" aria-label={`Zuordnung ${coopFieldLabel(item.sourceField)} entfernen`} title="Zuordnung entfernen" disabled={dropField.isPending} onClick={() => dropField.mutate({ cooperationId: row.id, sourceField: item.sourceField })}><X aria-hidden="true" /></button></li>)}</ul>}
        <form className={`ko-add ${field === OTHER_FIELD ? "is-own" : ""}`} onSubmit={saveField}>
          <select className="fx-select" value={field} onChange={(event) => setField(event.target.value)} aria-label="Feld des Leads"><option value="">Feld wählen</option>{COOP_LEAD_FIELDS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}<option value={OTHER_FIELD}>Anderes Feld …</option></select>
          {field === OTHER_FIELD && <input className="fx-field" value={ownField} onChange={(event) => setOwnField(event.target.value)} placeholder="Feldname bei uns" maxLength={120} aria-label="Eigener Feldname" />}
          <input className="fx-field" value={partnerField} onChange={(event) => setPartnerField(event.target.value)} placeholder="Name beim Partner" maxLength={120} aria-label="Name des Feldes beim Partner" />
          <Button type="submit" size="sm" variant="outline" disabled={addField.isPending}><Check aria-hidden="true" /> {mappedField ? "Ändern" : "Zuordnen"}</Button>
        </form>
        {mappedField && <small className="ko-hint">Schon zugeordnet als „{mappedField.partnerField || "–"}“ – „Ändern“ ersetzt den Namen.</small>}
      </section>
    </div>
    <div className="ko-foot">
      <p>{COOP_STATUS.find((item) => item.key === row.status)?.hint ?? ""}</p>
      <div><button type="button" className="fx-tool ko-delete" disabled={remove.isPending} onClick={() => void askDelete()}><Trash2 aria-hidden="true" /> Löschen</button><Button className={row.status === "aktiv" ? "" : "flux-button"} variant={row.status === "aktiv" ? "outline" : "default"} disabled={setStatus.isPending} onClick={switchStatus}>{row.status === "aktiv" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />} {next.label}</Button></div>
    </div>
  </div>;
}
