import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { confirmAction, promptAction } from "@/lib/confirm";

type Accounts = inferRouterOutputs<AppRouter>["leadops"]["listPartnerAccounts"];
const field = "h-10 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100";
const Toggle = ({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string }) => <label className="flex items-start gap-3 rounded-lg border border-white/8 bg-white/[.02] p-3 text-sm text-slate-200"><input type="checkbox" className="mt-1" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><span className="block">{label}</span>{hint && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}</span></label>;

export default function PartnerAccountsPanel() {
  const utils = trpc.useUtils();
  const accounts = trpc.leadops.listPartnerAccounts.useQuery(undefined, { retry: false });
  const refresh = () => utils.leadops.listPartnerAccounts.invalidate();
  if (accounts.error) return <section className="surface-panel p-6 text-sm text-red-200">{accounts.error.message}</section>;
  if (!accounts.data) return <section className="surface-panel p-6 text-sm text-slate-400">Partner-Zugänge werden geladen…</section>;
  const data = accounts.data;
  return <div className="mt-4 grid gap-4">
    <header><span className="eyebrow">PARTNER-STATUSRÜCKMELDUNG</span><h2 className="mt-1 text-lg text-slate-100">Aroundhome, WattFox & Telefonnummern-Prüfung</h2><p className="mt-1 text-xs text-slate-400">Automatische Rückmeldungen deiner Partner: Stornos werden erkannt, Reklamationsgründen zugeordnet und als Reklamation angelegt. Bei WattFox über die Tracking-URL, bei Aroundhome über den Abgleich der Vorgänge.</p></header>
    <AroundhomeSection data={data} onDone={refresh} />
    <CancelRules provider="aroundhome" title="STORNOGRÜNDE AROUNDHOME" intro="Ordne die Stornogründe aus dem Aroundhome-Abgleich deinen Reklamationsgründen zu. Ohne Treffer gilt der Standard-Grund des Kontos." data={data} onDone={refresh} />
    <WattfoxSection data={data} onDone={refresh} />
    <CancelRules provider="wattfox" title="STORNOGRÜNDE WATTFOX" intro="Ordne WattFox-Codes deinen Reklamationsgründen zu. Erste passende Regel gewinnt." data={data} onDone={refresh} />
    <HlrSection data={data} onDone={refresh} />
    <PresetsSection />
  </div>;
}

function PresetsSection() {
  const utils = trpc.useUtils();
  const presets = trpc.leadops.listIntegrationPresets.useQuery(undefined, { retry: false });
  const onError = (error: { message: string }) => toast.error(error.message);
  const rename = trpc.leadops.updateIntegrationPreset.useMutation({ onSuccess: () => utils.leadops.listIntegrationPresets.invalidate(), onError });
  const remove = trpc.leadops.deleteIntegrationPreset.useMutation({ onSuccess: () => { toast.success("Preset gelöscht."); utils.leadops.listIntegrationPresets.invalidate(); }, onError });
  const kindLabel: Record<string, string> = { endpoint: "Ausgehender API-Call", response_mapping: "Response-Mapping", return_webhook: "Rückgabe-Webhook" };
  return <section className="surface-panel operations-panel p-5"><span className="eyebrow">INTEGRATIONS-PRESETS</span><p className="mt-1 text-xs text-slate-400">Alles, was bei einem Benutzer im Reiter Integration eingerichtet und dort „Als Preset gespeichert“ wurde. Bei jedem anderen Benutzer über „Preset hinzufügen“ mit einem Klick übernehmbar.</p>
    <div className="table-wrap wrap-cells mt-3"><table className="flux-table"><thead><tr><th>Name</th><th>Art</th><th>Kategorie</th><th>Inhalt</th><th>Schlüssel</th><th>Verwendet</th><th></th></tr></thead><tbody>{(presets.data ?? []).map((preset) => <tr key={preset.id}><td className="text-slate-100">{preset.name}{preset.description && <div className="text-xs text-slate-500">{preset.description}</div>}</td><td>{kindLabel[preset.kind]}</td><td>{preset.categoryShortcode ?? "–"}</td><td className="text-xs text-slate-400">{preset.summary}</td><td className="text-xs">{preset.kind === "response_mapping" ? "–" : preset.hasSecrets ? <span className="text-amber-200">enthalten</span> : "werden abgefragt"}</td><td>{preset.usageCount}×</td><td><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={async () => { const name = await promptAction("Neuer Name:", preset.name); if (name?.trim()) rename.mutate({ id: preset.id, name: name.trim() }); }}>Umbenennen</Button><Button size="sm" variant="ghost" onClick={async () => { if (await confirmAction("Preset löschen? Bereits hinzugefügte Konfigurationen bleiben bei den Benutzern erhalten.")) remove.mutate({ id: preset.id }); }}>Löschen</Button></div></td></tr>)}</tbody></table>{!presets.data?.length && <p className="p-4 text-sm text-slate-500">Noch kein Preset.</p>}</div></section>;
}

function AroundhomeSection({ data, onDone }: { data: Accounts; onDone: () => void }) {
  const [editing, setEditing] = useState<Accounts["aroundhome"][number] | { id: 0 } | null>(null);
  const sync = trpc.leadops.syncAroundhomeAccount.useMutation({ onSuccess: (result) => { toast.success(result.summary); onDone(); }, onError: (error) => toast.error(error.message) });
  const remove = trpc.leadops.deletePartnerAccount.useMutation({ onSuccess: () => { toast.success("Konto entfernt."); onDone(); }, onError: (error) => toast.error(error.message) });
  return <section className="surface-panel operations-panel p-5"><div className="flex items-start justify-between gap-3"><div><span className="eyebrow">AROUNDHOME-KONTEN</span><p className="mt-1 text-xs text-slate-400">Pro Publisher-ID ein Konto mit Zugangstoken und dem Export-Link, wie er mit euch geteilt wurde. „Aktualisieren“ liest die Vorgänge ein und legt bei Storno eine Reklamation an.</p></div><Button size="sm" variant="outline" onClick={() => setEditing({ id: 0 })}>Konto hinzufügen</Button></div>
    <div className="mt-3 grid gap-2">{data.aroundhome.map((account) => <div key={account.id} className="grid gap-2 rounded-lg border border-white/8 bg-white/[.02] p-3 md:grid-cols-[1fr_auto]"><div><div className="flex flex-wrap items-center gap-2 text-sm text-slate-100"><strong>{account.label}</strong><span className="text-xs text-slate-500">Publisher {account.publisherId || "—"}</span><Badge variant="outline" className={account.enabled ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-white/15 text-slate-400"}>{account.enabled ? "Aktiv" : "Inaktiv"}</Badge>{account.reclaimOnCancel && <Badge variant="outline" className="border-amber-400/25 bg-amber-500/10 text-amber-200">Reklamation bei Storno</Badge>}</div><div className="text-xs text-slate-500">{account.lastSyncAt ? `Zuletzt ${new Date(account.lastSyncAt).toLocaleString("de-DE")}: ${account.lastSyncSummary}` : "Noch kein Abgleich"}</div></div><div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={() => sync.mutate({ id: account.id })} disabled={sync.isPending}>Aktualisieren</Button><Button size="sm" variant="ghost" onClick={() => setEditing(account)}>Bearbeiten</Button><Button size="sm" variant="ghost" onClick={async () => { if (await confirmAction("Konto entfernen?")) remove.mutate({ id: account.id }); }}>Entfernen</Button></div></div>)}{!data.aroundhome.length && <p className="text-sm text-slate-500">Noch kein Aroundhome-Konto.</p>}</div>
    {editing && <AroundhomeDialog data={data} account={"label" in editing ? editing : null} onClose={() => setEditing(null)} onDone={() => { setEditing(null); onDone(); }} />}
  </section>;
}

function AroundhomeDialog({ data, account, onClose, onDone }: { data: Accounts; account: Accounts["aroundhome"][number] | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ label: account?.label ?? "", publisherId: account?.publisherId ?? "", accessToken: account?.accessToken ?? "", exportUrl: account?.exportUrl ?? "", reclaimOnCancel: account?.reclaimOnCancel ?? true, reclaimReasonId: account?.reclaimReasonId ?? null, enabled: account?.enabled ?? true });
  const save = trpc.leadops.saveAroundhomeAccount.useMutation({ onSuccess: () => { toast.success("Aroundhome-Konto gespeichert."); onDone(); }, onError: (error) => toast.error(error.message) });
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4" onClick={onClose}><section className="surface-panel w-full max-w-lg p-6" onClick={(event) => event.stopPropagation()}><h2 className="text-lg text-slate-100">{account ? "Aroundhome-Konto bearbeiten" : "Aroundhome-Konto hinzufügen"}</h2><div className="mt-4 grid gap-3">
    <label className="text-xs text-slate-300">Bezeichnung<Input value={form.label} placeholder="z. B. Aroundhome PV" onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} /></label>
    <label className="text-xs text-slate-300">Publisher-ID<Input value={form.publisherId} onChange={(event) => setForm((current) => ({ ...current, publisherId: event.target.value }))} /></label>
    <label className="text-xs text-slate-300">Zugangstoken (accessToken)<Input value={form.accessToken} onChange={(event) => setForm((current) => ({ ...current, accessToken: event.target.value }))} /></label>
    <label className="text-xs text-slate-300">Export-Link (wie von Aroundhome geteilt)<Input value={form.exportUrl} placeholder="https://…" onChange={(event) => setForm((current) => ({ ...current, exportUrl: event.target.value }))} /></label>
    <Toggle checked={form.reclaimOnCancel} onChange={(value) => setForm((current) => ({ ...current, reclaimOnCancel: value }))} label="Reklamation bei Storno" hint="Erzeugt automatisch eine Reklamation (offen zur Prüfung), wenn Aroundhome einen Vorgang storniert." />
    <label className="text-xs text-slate-300">Standard-Reklamationsgrund<select className={field} value={form.reclaimReasonId ?? ""} onChange={(event) => setForm((current) => ({ ...current, reclaimReasonId: event.target.value ? Number(event.target.value) : null }))}><option value="">— kein Standard —</option>{data.reasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select></label>
    <Toggle checked={form.enabled} onChange={(value) => setForm((current) => ({ ...current, enabled: value }))} label="Konto aktiv" />
  </div><div className="mt-4 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={onClose}>Abbrechen</Button><Button className="flux-button" size="sm" onClick={() => save.mutate({ id: account?.id, ...form })} disabled={save.isPending}>Speichern</Button></div></section></div>;
}

function WattfoxSection({ data, onDone }: { data: Accounts; onDone: () => void }) {
  const [label, setLabel] = useState("");
  const create = trpc.leadops.createWattfoxAccount.useMutation({ onSuccess: () => { toast.success("Tracking-URL erzeugt."); setLabel(""); onDone(); }, onError: (error) => toast.error(error.message) });
  const update = trpc.leadops.updatePartnerAccount.useMutation({ onSuccess: () => onDone(), onError: (error) => toast.error(error.message) });
  const remove = trpc.leadops.deletePartnerAccount.useMutation({ onSuccess: () => { toast.success("Tracking-URL entfernt."); onDone(); }, onError: (error) => toast.error(error.message) });
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); toast.success("Kopiert."); } catch { toast.error("Kopieren nicht möglich."); } };
  return <section className="surface-panel operations-panel p-5"><span className="eyebrow">WATTFOX TRACKING-URL</span><p className="mt-1 text-xs text-slate-400">Erzeuge eine Tracking-URL und hinterlege sie bei WattFox. WattFox ruft sie mit lead_id, status und code auf; Stornos werden über die Zuordnung unten zu Reklamationen.</p>
    <div className="mt-3 flex gap-1"><Input value={label} placeholder="Bezeichnung, z. B. WattFox Wärmepumpe" onChange={(event) => setLabel(event.target.value)} /><Button size="sm" variant="outline" onClick={() => create.mutate({ label, reclaimOnCancel: true, reclaimReasonId: null })} disabled={create.isPending}>Tracking-URL erzeugen</Button></div>
    <div className="mt-3 grid gap-2">{data.wattfox.map((account) => <div key={account.id} className="rounded-lg border border-white/8 bg-white/[.02] p-3"><div className="flex flex-wrap items-center gap-2 text-sm text-slate-100"><strong>{account.label}</strong><Badge variant="outline" className={account.enabled ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-white/15 text-slate-400"}>{account.enabled ? "Aktiv" : "Inaktiv"}</Badge></div><div className="mt-1 flex flex-wrap items-center gap-2"><code className="max-w-full truncate rounded bg-black/30 px-2 py-1 text-xs text-slate-200">{account.trackingUrl}</code><Button size="sm" variant="ghost" onClick={() => copy(account.trackingUrl)}>Kopieren</Button></div><div className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_auto]"><label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={account.reclaimOnCancel} onChange={(event) => update.mutate({ id: account.id, reclaimOnCancel: event.target.checked })} /> Reklamation bei Storno</label><select className={field} value={account.reclaimReasonId ?? ""} onChange={(event) => update.mutate({ id: account.id, reclaimReasonId: event.target.value ? Number(event.target.value) : null })}><option value="">Standard-Grund: keiner</option>{data.reasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => update.mutate({ id: account.id, enabled: !account.enabled })}>{account.enabled ? "Deaktivieren" : "Aktivieren"}</Button><Button size="sm" variant="ghost" onClick={async () => { if (await confirmAction("Tracking-URL entfernen? WattFox-Aufrufe darauf schlagen dann fehl.")) remove.mutate({ id: account.id }); }}>Entfernen</Button></div></div></div>)}{!data.wattfox.length && <p className="text-sm text-slate-500">Noch keine Tracking-URL.</p>}</div>
  </section>;
}

function CancelRules({ provider, title, intro, data, onDone }: { provider: "aroundhome" | "wattfox"; title: string; intro: string; data: Accounts; onDone: () => void }) {
  const [rules, setRules] = useState(data.cancelRules.filter((rule) => rule.provider === provider));
  useEffect(() => { setRules(data.cancelRules.filter((rule) => rule.provider === provider)); }, [data.cancelRules, provider]);
  const save = trpc.leadops.saveCancelRules.useMutation({ onSuccess: () => { toast.success("Zuordnung gespeichert."); onDone(); }, onError: (error) => toast.error(error.message) });
  return <section className="surface-panel operations-panel p-5"><span className="eyebrow">{title}</span><p className="mt-1 text-xs text-slate-400">{intro}</p>
    <div className="mt-3 grid gap-2">{rules.map((rule, index) => <div key={index} className="grid gap-1 md:grid-cols-[140px_1fr_1fr_auto]"><select className={field} value={rule.matchOp} onChange={(event) => setRules((current) => current.map((item, i) => i === index ? { ...item, matchOp: event.target.value as typeof rule.matchOp } : item))}><option value="enthaelt">enthält</option><option value="gleich">ist genau</option><option value="beginnt">beginnt mit</option></select><Input value={rule.matchValue} placeholder={provider === "wattfox" ? "z. B. duplicate" : "z. B. Kunde nicht erreichbar"} onChange={(event) => setRules((current) => current.map((item, i) => i === index ? { ...item, matchValue: event.target.value } : item))} /><select className={field} value={rule.reasonId} onChange={(event) => setRules((current) => current.map((item, i) => i === index ? { ...item, reasonId: Number(event.target.value) } : item))}><option value={0}>Reklamationsgrund wählen …</option>{data.reasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select><Button size="sm" variant="ghost" onClick={() => setRules((current) => current.filter((_, i) => i !== index))}>✕</Button></div>)}{!rules.length && <p className="text-sm text-slate-500">Noch keine Zuordnung.</p>}</div>
    <div className="mt-3 flex justify-between"><Button size="sm" variant="outline" onClick={() => setRules((current) => [...current, { id: 0, provider, matchOp: "enthaelt", matchValue: "", reasonId: 0 }])}>Regel hinzufügen</Button><Button className="flux-button" size="sm" onClick={() => save.mutate({ provider, rules: rules.map((rule) => ({ matchOp: rule.matchOp, matchValue: rule.matchValue, reasonId: rule.reasonId })) })} disabled={save.isPending}>Speichern</Button></div>
  </section>;
}

function HlrSection({ data, onDone }: { data: Accounts; onDone: () => void }) {
  const [form, setForm] = useState({ apiKey: data.hlrlookup.apiKey, apiSecret: data.hlrlookup.apiSecret, enabled: data.hlrlookup.enabled });
  useEffect(() => { setForm({ apiKey: data.hlrlookup.apiKey, apiSecret: data.hlrlookup.apiSecret, enabled: data.hlrlookup.enabled }); }, [data.hlrlookup]);
  const save = trpc.leadops.saveHlrLookup.useMutation({ onSuccess: () => { toast.success("Telefonnummern-Prüfung gespeichert."); onDone(); }, onError: (error) => toast.error(error.message) });
  const test = trpc.leadops.testHlrLookup.useMutation({ onSuccess: (result) => { toast[result.ok ? "success" : "error"](result.summary); onDone(); }, onError: (error) => toast.error(error.message) });
  return <section className="surface-panel operations-panel p-5"><span className="eyebrow">TELEFONNUMMERN-PRÜFUNG (HLRLOOKUP.COM)</span><p className="mt-1 text-xs text-slate-400">Prüft Telefonnummern beim API-Import. Ungültige Nummern werden als „fehlerhaft“ markiert und im Lead-Verlauf vermerkt. Zugangsdaten von hlrlookup.com.</p>
    <div className="mt-3 grid gap-3 md:grid-cols-2"><label className="text-xs text-slate-300">API-Schlüssel<Input value={form.apiKey} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} /></label><label className="text-xs text-slate-300">API-Passwort<Input type="password" value={form.apiSecret} onChange={(event) => setForm((current) => ({ ...current, apiSecret: event.target.value }))} /></label></div>
    <div className="mt-3"><Toggle checked={form.enabled} onChange={(value) => setForm((current) => ({ ...current, enabled: value }))} label="Prüfung beim Import aktiv" hint="Jede Prüfung kostet bei hlrlookup.com Guthaben." /></div>
    {data.hlrlookup.lastTestAt && <p className="mt-2 text-xs text-slate-500">Letzter Test {new Date(data.hlrlookup.lastTestAt).toLocaleString("de-DE")}: {data.hlrlookup.lastTestSummary}</p>}
    <div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => test.mutate()} disabled={!data.hlrlookup.id || test.isPending}>Verbindung testen</Button><Button className="flux-button" size="sm" onClick={() => save.mutate(form)} disabled={save.isPending}>Speichern</Button></div>
  </section>;
}
