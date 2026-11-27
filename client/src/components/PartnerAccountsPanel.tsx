import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { BarChart3, Plus, Save, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { confirmAction, promptAction } from "@/lib/confirm";
import { buyerIntegrationUrl } from "@/components/PartnerReport";
import { providerName } from "../../../shared/partner-report";

type Accounts = inferRouterOutputs<AppRouter>["leadops"]["listPartnerAccounts"];
const BRAND: Record<string, string> = { aroundhome: "#f97316", wattfox: "#eab308", leadnodes: "#0ea5e9", enpal: "#22c55e", gohighlevel: "#6366f1" };
const stamp = (value: Date | string) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const title = (account: { provider: string; label: string }) => { const name = providerName(account.provider); const label = account.label.trim(); return label && label.toLowerCase() !== name.toLowerCase() ? `${name} (${label})` : name; };

/**
 * Einstellungen → Integrationen: was für alle Käufer gilt. Seit v383 wird ein Käufer nur noch bei ihm selbst eingerichtet
 * (Benutzer → Käufer → Reiter „Integration“: Schnittstelle, Rückmeldung, Testleads). Hier bleiben: die Übersicht aller Rückmeldungen
 * (mit Zuordnung für ältere Konten ohne Käufer), die Zuordnung der Stornogründe, die Telefonnummern-Prüfung und die Vorlagen.
 */
export default function PartnerAccountsPanel() {
  const utils = trpc.useUtils();
  const accounts = trpc.leadops.listPartnerAccounts.useQuery(undefined, { retry: false });
  const refresh = () => { void utils.leadops.listPartnerAccounts.invalidate(); void utils.leadops.partnerReport.invalidate(); };
  if (accounts.error) return <p className="ie-note is-bad">{accounts.error.message}</p>;
  if (!accounts.data) return <p className="ie-note">Rückmeldungen werden geladen …</p>;
  const data = accounts.data;
  return <div className="ie-stack">
    <FeedbackOverview data={data} onDone={refresh} />
    <CancelRules provider="aroundhome" title="Stornogründe von Aroundhome zuordnen" intro="Welcher Stornogrund von Aroundhome wird zu welchem Reklamationsgrund? Die erste passende Regel gewinnt. Ohne Treffer gilt der Grund, der beim Käufer hinterlegt ist." data={data} onDone={refresh} />
    <CancelRules provider="wattfox" title="Stornogründe von WattFox zuordnen" intro="Welcher Code von WattFox wird zu welchem Reklamationsgrund? Die erste passende Regel gewinnt." data={data} onDone={refresh} />
    <HlrSection data={data} onDone={refresh} />
    <PresetsSection />
  </div>;
}

/** Alle Rückmeldungen auf einen Blick: zu welchem Käufer sie gehören – ältere Konten ohne Käufer lassen sich hier noch zuordnen. Neue entstehen nur beim Käufer. */
function FeedbackOverview({ data, onDone }: { data: Accounts; onDone: () => void }) {
  const members = trpc.leadops.listMembers.useQuery(undefined, { retry: false });
  const buyers = (members.data ?? []).filter((member) => member.status === "aktiv" && (member as { partnerType?: string }).partnerType !== "lieferant");
  const onError = (error: { message: string }) => toast.error(error.message);
  const assign = trpc.leadops.updatePartnerAccount.useMutation({ onSuccess: () => { toast.success("Käufer zugeordnet."); onDone(); }, onError });
  const remove = trpc.leadops.deletePartnerAccount.useMutation({ onSuccess: () => { toast.success("Rückmeldung entfernt."); onDone(); }, onError });
  const rows = [
    ...data.aroundhome.map((account) => ({ id: account.id, provider: "aroundhome", label: account.label, enabled: account.enabled, note: account.lastSyncAt ? `Zuletzt abgeglichen am ${stamp(account.lastSyncAt)}` : "Noch kein Abgleich" })),
    ...data.wattfox.map((account) => ({ id: account.id, provider: "wattfox", label: account.label, enabled: account.enabled, note: "WattFox meldet jede Änderung selbst" })),
    ...data.platforms.map((account) => ({ id: account.id, provider: account.provider as string, label: account.label, enabled: account.enabled, note: "Die Anbindung folgt" })),
  ];
  return <section className="ie-card" aria-label="Rückmeldungen der Käufer">
    <header className="ie-head"><div><h2 className="fx-h">Rückmeldungen der Käufer</h2><p>Was Käufer zu ihren Leads zurückmelden – Stornos, Status, Provision. Eingerichtet wird das beim Käufer im Reiter „Integration“. Hier siehst du alle auf einen Blick.</p></div><a className="fx-tool" href="/?page=Statistik&view=Integrationen"><BarChart3 aria-hidden="true" /> Im Dashboard ansehen</a></header>
    {!rows.length ? <p className="ie-empty">Noch keine Rückmeldung eingerichtet. Öffne einen Käufer unter „Benutzer“ und richte sie dort im Reiter „Integration“ ein. <a href="/?page=Benutzer">Zu den Benutzern</a></p>
      : <ul className="ie-rows">{rows.map((row) => { const buyerId = data.buyerOf[row.id] ?? null; const member = buyerId ? (members.data ?? []).find((item) => item.userId === buyerId) : undefined; const name = title(row); return <li key={row.id} className={buyerId ? "" : "is-open"} style={{ "--brand": BRAND[row.provider] } as CSSProperties}>
        <span className="bf-mark" aria-hidden="true">{providerName(row.provider).slice(0, 2)}</span>
        <div><b>{name}</b><small>{row.note}{row.enabled ? "" : " · pausiert"}</small></div>
        {buyerId ? (member ? <a className="fx-tool" href={buyerIntegrationUrl(member.membershipId)} title="Beim Käufer öffnen"><UserRound aria-hidden="true" /> {member.name ?? member.email ?? `Käufer #${buyerId}`}</a> : <span className="ie-buyer">{members.isLoading ? "…" : `Käufer #${buyerId}`}</span>)
          : <select aria-label={`Käufer für ${name}`} className="fx-select ie-assign" value="" disabled={assign.isPending} onChange={(event) => { const next = Number(event.target.value) || null; if (next) assign.mutate({ id: row.id, buyerUserId: next }); }}><option value="">Käufer zuordnen …</option>{buyers.map((buyer) => <option key={buyer.userId} value={buyer.userId}>{buyer.name ?? buyer.email ?? `Käufer #${buyer.userId}`}</option>)}</select>}
        <button type="button" className="fx-tool ie-remove" aria-label={`${name} entfernen`} title="Entfernen" disabled={remove.isPending} onClick={async () => { if (await confirmAction(`Rückmeldung „${name}“ entfernen? Stornos und Provisionen dieses Partners erscheinen dann nicht mehr im Dashboard.${row.provider === "wattfox" ? " Die Adresse für WattFox gilt danach nicht mehr." : ""}`, { danger: true, confirmLabel: "Ja, entfernen" })) remove.mutate({ id: row.id }); }}><Trash2 aria-hidden="true" /></button>
      </li>; })}</ul>}
    {rows.some((row) => !data.buyerOf[row.id]) && <p className="ie-hint">Eine Rückmeldung ohne Käufer erkennt ihre Leads nur an der Schnittstelle (Vorlage oder Adresse). Ordne sie dem Käufer zu, über den geliefert wird – dann stimmen die Zahlen im Dashboard sicher.</p>}
  </section>;
}

function CancelRules({ provider, title: heading, intro, data, onDone }: { provider: "aroundhome" | "wattfox"; title: string; intro: string; data: Accounts; onDone: () => void }) {
  const [rules, setRules] = useState(data.cancelRules.filter((rule) => rule.provider === provider));
  useEffect(() => { setRules(data.cancelRules.filter((rule) => rule.provider === provider)); }, [data.cancelRules, provider]);
  const save = trpc.leadops.saveCancelRules.useMutation({ onSuccess: () => { toast.success("Zuordnung gespeichert."); onDone(); }, onError: (error) => toast.error(error.message) });
  return <section className="ie-card" aria-label={heading}>
    <header className="ie-head"><div><h3 className="fx-h is-sub">{heading}</h3><p>{intro}</p></div></header>
    {rules.length > 0 ? <ul className="ie-rules">{rules.map((rule, index) => <li key={index}>
      <select className="fx-select" aria-label="Vergleich" value={rule.matchOp} onChange={(event) => setRules((current) => current.map((item, i) => i === index ? { ...item, matchOp: event.target.value as typeof rule.matchOp } : item))}><option value="enthaelt">enthält</option><option value="gleich">ist genau</option><option value="beginnt">beginnt mit</option></select>
      <input className="fx-field" aria-label="Text des Partners" value={rule.matchValue} placeholder={provider === "wattfox" ? "z. B. duplicate" : "z. B. Kunde nicht erreichbar"} onChange={(event) => setRules((current) => current.map((item, i) => i === index ? { ...item, matchValue: event.target.value } : item))} />
      <select className="fx-select" aria-label="Reklamationsgrund" value={rule.reasonId} onChange={(event) => setRules((current) => current.map((item, i) => i === index ? { ...item, reasonId: Number(event.target.value) } : item))}><option value={0}>Reklamationsgrund wählen …</option>{data.reasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select>
      <button type="button" className="fx-tool ie-remove" aria-label="Regel entfernen" title="Regel entfernen" onClick={() => setRules((current) => current.filter((_, i) => i !== index))}><X aria-hidden="true" /></button>
    </li>)}</ul> : <p className="ie-empty">Noch keine Zuordnung.</p>}
    <footer className="ie-foot"><Button size="sm" variant="outline" onClick={() => setRules((current) => [...current, { id: 0, provider, matchOp: "enthaelt", matchValue: "", reasonId: 0 }])}><Plus aria-hidden="true" /> Regel hinzufügen</Button><Button className="flux-button" size="sm" onClick={() => save.mutate({ provider, rules: rules.map((rule) => ({ matchOp: rule.matchOp, matchValue: rule.matchValue, reasonId: rule.reasonId })) })} disabled={save.isPending}><Save aria-hidden="true" /> {save.isPending ? "Speichert …" : "Zuordnung speichern"}</Button></footer>
  </section>;
}

function HlrSection({ data, onDone }: { data: Accounts; onDone: () => void }) {
  const [form, setForm] = useState({ apiKey: data.hlrlookup.apiKey, apiSecret: data.hlrlookup.apiSecret, enabled: data.hlrlookup.enabled });
  useEffect(() => { setForm({ apiKey: data.hlrlookup.apiKey, apiSecret: data.hlrlookup.apiSecret, enabled: data.hlrlookup.enabled }); }, [data.hlrlookup]);
  const save = trpc.leadops.saveHlrLookup.useMutation({ onSuccess: () => { toast.success("Telefonnummern-Prüfung gespeichert."); onDone(); }, onError: (error) => toast.error(error.message) });
  const test = trpc.leadops.testHlrLookup.useMutation({ onSuccess: (result) => { toast[result.ok ? "success" : "error"](result.summary); onDone(); }, onError: (error) => toast.error(error.message) });
  return <section className="ie-card" aria-label="Telefonnummern prüfen">
    <header className="ie-head"><div><h3 className="fx-h is-sub">Telefonnummern prüfen (hlrlookup.com)</h3><p>Prüft die Telefonnummer, wenn ein Lead über die Schnittstelle hereinkommt. Ungültige Nummern werden als „fehlerhaft“ markiert und im Verlauf des Leads vermerkt. Die Zugangsdaten bekommst du bei hlrlookup.com.</p></div></header>
    <div className="ie-fields"><label className="rd-field"><span>API-Schlüssel</span><input className="fx-field" value={form.apiKey} autoComplete="off" spellCheck={false} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} /></label><label className="rd-field"><span>API-Passwort</span><input className="fx-field" type="password" value={form.apiSecret} autoComplete="off" onChange={(event) => setForm((current) => ({ ...current, apiSecret: event.target.value }))} /></label></div>
    <div className="ie-switch"><label htmlFor="ie-hlr"><b>Beim Hereinkommen prüfen</b><small>Jede Prüfung kostet Guthaben bei hlrlookup.com.</small></label><Switch id="ie-hlr" checked={form.enabled} onCheckedChange={(enabled) => setForm((current) => ({ ...current, enabled }))} aria-label="Telefonnummern beim Hereinkommen prüfen" /></div>
    <footer className="ie-foot"><small>{data.hlrlookup.lastTestAt ? `Letzter Test am ${stamp(data.hlrlookup.lastTestAt)}: ${data.hlrlookup.lastTestSummary ?? ""}` : "Noch nicht getestet."}</small><span><Button size="sm" variant="outline" onClick={() => test.mutate()} disabled={!data.hlrlookup.id || test.isPending}>{test.isPending ? "Testet …" : "Verbindung testen"}</Button><Button className="flux-button" size="sm" onClick={() => save.mutate(form)} disabled={save.isPending}><Save aria-hidden="true" /> {save.isPending ? "Speichert …" : "Speichern"}</Button></span></footer>
  </section>;
}

function PresetsSection() {
  const utils = trpc.useUtils();
  const presets = trpc.leadops.listIntegrationPresets.useQuery(undefined, { retry: false });
  const onError = (error: { message: string }) => toast.error(error.message);
  const rename = trpc.leadops.updateIntegrationPreset.useMutation({ onSuccess: () => utils.leadops.listIntegrationPresets.invalidate(), onError });
  const remove = trpc.leadops.deleteIntegrationPreset.useMutation({ onSuccess: () => { toast.success("Vorlage gelöscht."); utils.leadops.listIntegrationPresets.invalidate(); }, onError });
  const kindLabel: Record<string, string> = { endpoint: "Schnittstelle", response_mapping: "Antworten einordnen", return_webhook: "Rückgabe an den Lieferanten" };
  return <section className="ie-card" aria-label="Vorlagen für Schnittstellen">
    <header className="ie-head"><div><h3 className="fx-h is-sub">Vorlagen für Schnittstellen (Presets)</h3><p>Was du bei einem Käufer im Reiter „Integration“ eingerichtet und „Als Preset gespeichert“ hast. Bei jedem anderen Käufer übernimmst du es mit „Preset hinzufügen“ in einem Klick.</p></div></header>
    {!presets.data?.length ? <p className="ie-empty">{presets.isLoading ? "Vorlagen werden geladen …" : "Noch keine Vorlage gespeichert."}</p>
      : <div className="ie-table-wrap"><table className="ie-table"><thead><tr><th>Name</th><th>Art</th><th>Kategorie</th><th>Inhalt</th><th>Zugangsdaten</th><th>Verwendet</th><th /></tr></thead><tbody>{presets.data.map((preset) => <tr key={preset.id}><td><b>{preset.name}</b>{preset.description && <small>{preset.description}</small>}</td><td>{kindLabel[preset.kind]}</td><td>{preset.categoryShortcode ?? "–"}</td><td><small>{preset.summary}</small></td><td>{preset.kind === "response_mapping" ? "–" : preset.hasSecrets ? "enthalten" : "werden abgefragt"}</td><td>{preset.usageCount}×</td><td><span className="ie-actions"><Button size="sm" variant="ghost" onClick={async () => { const name = await promptAction("Neuer Name:", preset.name); if (name?.trim()) rename.mutate({ id: preset.id, name: name.trim() }); }}>Umbenennen</Button><Button size="sm" variant="ghost" onClick={async () => { if (await confirmAction("Vorlage löschen? Was bei Käufern schon übernommen wurde, bleibt dort erhalten.", { danger: true, confirmLabel: "Ja, löschen" })) remove.mutate({ id: preset.id }); }}>Löschen</Button></span></td></tr>)}</tbody></table></div>}
  </section>;
}

/** Kopf der Seite Einstellungen → Integrationen: sagt, wo ein Käufer eingerichtet wird – und was hier bleibt. */
export function IntegrationSettingsHead() {
  return <header className="page-intro compact"><div><span className="eyebrow">EINSTELLUNGEN</span><h1>Integrationen</h1><p>Einen Käufer richtest du bei ihm selbst ein: Benutzer → Käufer öffnen → Reiter „Integration“. Dort stehen seine Schnittstelle, die Rückmeldung und die Testleads an einer Stelle. Hier bleibt, was für alle gilt.</p></div><nav className="people-header-actions"><a className="fx-tool" href="/?page=Benutzer"><UserRound aria-hidden="true" /> Zu den Benutzern</a></nav></header>;
}
