import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { confirmAction } from "@/lib/confirm";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import { BarChart3, Check, Copy, Info, Link2, Pause, Play, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { toast } from "sonner";
import type { AppRouter } from "../../../server/routers";
import { FEEDBACK_KINDS, feedbackKind, providerName, quotaPeriod, type FeedbackKind } from "../../../shared/partner-report";

type Feedback = inferRouterOutputs<AppRouter>["leadops"]["getBuyerFeedback"];
type Account = Feedback["accounts"][number];
const BRAND: Record<string, string> = { aroundhome: "#f97316", wattfox: "#eab308", leadnodes: "#0ea5e9", enpal: "#22c55e", gohighlevel: "#6366f1" };
const stamp = (value: Date | string) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const title = (account: { provider: string; label: string }) => { const name = providerName(account.provider); const label = account.label.trim(); return label && label.toLowerCase() !== name.toLowerCase() ? `${name} (${label})` : name; };
const STATS_URL = "/?page=Statistik&view=Integrationen";

/**
 * Rückmeldung des Käufers (seit v383): Meldet der Partner zurück, was aus einem Lead wurde – anerkannt, storniert, Provision?
 * Eingerichtet wird das hier, beim Käufer, an derselben Stelle wie seine Schnittstelle: WattFox ruft unsere Adresse auf, bei Aroundhome
 * rufen wir den Export ab, für weitere Plattformen wird der Zugang hinterlegt. Das Konto gehört von Anfang an zu diesem Käufer.
 * Ohne Rückmeldung zeigt das Dashboard (Reiter „Integrationen“) trotzdem, was geliefert, abgelehnt und angenommen wurde.
 */
export default function BuyerFeedback({ membershipId }: { membershipId: number }) {
  const utils = trpc.useUtils();
  const feedback = trpc.leadops.getBuyerFeedback.useQuery({ membershipId }, { retry: false });
  const refresh = () => { void utils.leadops.getBuyerFeedback.invalidate({ membershipId }); void utils.leadops.partnerReport.invalidate(); void utils.leadops.listPartnerAccounts.invalidate(); };
  const [adding, setAdding] = useState(false);
  const data = feedback.data;
  return <section className="fx-scope bf" aria-label="Rückmeldung des Käufers">
    <header className="bf-head"><div><h3 className="fx-h">Rückmeldung des Käufers</h3><p>Meldet der Käufer zurück, was aus einem Lead wurde – anerkannt, storniert, Provision? Dann steht das im Dashboard unter „Integrationen“, und ein Storno kann von selbst zur Reklamation werden.</p></div><a className="fx-tool" href={STATS_URL}><BarChart3 aria-hidden="true" /> Im Dashboard ansehen</a></header>
    {feedback.error ? <p className="bf-note is-bad">{feedback.error.message}</p> : !data ? <p className="bf-note">Rückmeldung wird geladen …</p> : <>
      {data.accounts.map((account) => <FeedbackAccount key={account.id} account={account} data={data} onDone={refresh} />)}
      {data.accounts.length === 0 || adding ? <FeedbackSetup data={data} first={data.accounts.length === 0} onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} />
        : <button type="button" className="fx-tool bf-more" onClick={() => setAdding(true)}><Plus aria-hidden="true" /> Weitere Rückmeldung einrichten</button>}
    </>}
  </section>;
}

/** Noch nichts eingerichtet: Partner wählen und in einem Schritt anlegen – oder ein vorhandenes Konto ohne Käufer zuordnen. */
function FeedbackSetup({ data, first, onClose, onDone }: { data: Feedback; first: boolean; onClose: () => void; onDone: () => void }) {
  // je Käufer eine Adresse für WattFox: Gibt es sie schon, steht dieser Weg nicht noch einmal zur Wahl
  const kindsLeft = FEEDBACK_KINDS.filter((item) => !(item.key === "wattfox" && data.accounts.some((account) => account.provider === "wattfox")));
  const suggested = feedbackKind(data.suggested); const guess = suggested && kindsLeft.some((item) => item.key === suggested) ? suggested : null;
  const [kind, setKind] = useState<FeedbackKind>(guess ?? kindsLeft[0].key);
  const [form, setForm] = useState({ publisherId: "", accessToken: "", exportUrl: "", platform: (data.suggested === "enpal" || data.suggested === "gohighlevel" ? data.suggested : "leadnodes") as "leadnodes" | "enpal" | "gohighlevel", token: "" });
  useEffect(() => { if (guess) setKind(guess); }, [guess]);
  const fail = { onError: (error: { message: string }) => toast.error(error.message) };
  const wattfox = trpc.leadops.createWattfoxAccount.useMutation({ onSuccess: () => { toast.success("Adresse für WattFox erzeugt."); onDone(); }, ...fail });
  const aroundhome = trpc.leadops.saveAroundhomeAccount.useMutation({ onSuccess: () => { toast.success("Aroundhome-Zugang gespeichert."); onDone(); }, ...fail });
  const platform = trpc.leadops.savePlatformAccount.useMutation({ onSuccess: () => { toast.success("Zugang gespeichert."); onDone(); }, ...fail });
  const assign = trpc.leadops.updatePartnerAccount.useMutation({ onSuccess: () => { toast.success("Rückmeldung zugeordnet."); onDone(); }, ...fail });
  const busy = wattfox.isPending || aroundhome.isPending || platform.isPending;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (kind === "wattfox") return wattfox.mutate({ label: "", reclaimOnCancel: true, reclaimReasonId: null, buyerUserId: data.buyerUserId });
    if (kind === "aroundhome") { if (!form.exportUrl.trim() && !(form.publisherId.trim() && form.accessToken.trim())) return void toast.error("Bitte den Export-Link eintragen – oder Publisher-ID und Zugangstoken."); return aroundhome.mutate({ label: "", publisherId: form.publisherId, accessToken: form.accessToken, exportUrl: form.exportUrl, reclaimOnCancel: true, reclaimReasonId: null, enabled: true, buyerUserId: data.buyerUserId }); }
    platform.mutate({ provider: form.platform, label: "", token: form.token, buyerUserId: data.buyerUserId });
  };
  const chosen = kindsLeft.find((item) => item.key === kind) ?? kindsLeft[0];
  return <form className="bf-setup" onSubmit={submit} aria-label="Rückmeldung einrichten">
    {first && <p className="bf-state"><Info aria-hidden="true" /><span><b>Noch keine Rückmeldung eingerichtet.</b> Das ist in Ordnung: Das Dashboard zeigt für diesen Käufer trotzdem, was geliefert, abgelehnt und angenommen wurde. Mit einer Rückmeldung kommen Stornos und Provisionen dazu.</span></p>}
    {!data.hasEndpoint && <p className="bf-note">Dieser Käufer hat noch keine Schnittstelle. Richte sie zuerst oben ein – die Rückmeldung gehört zu den Leads, die darüber rausgehen.</p>}
    {data.unassigned.length > 0 && <div className="bf-existing"><b>Schon vorhanden, aber noch keinem Käufer zugeordnet</b><ul>{data.unassigned.map((account) => <li key={account.id}><span className="bf-mark" style={{ "--brand": BRAND[account.provider] } as CSSProperties} aria-hidden="true">{providerName(account.provider).slice(0, 2)}</span><span>{title(account)}</span><Button type="button" size="sm" variant="outline" disabled={assign.isPending} onClick={() => assign.mutate({ id: account.id, buyerUserId: data.buyerUserId })}><Link2 aria-hidden="true" /> Diesem Käufer zuordnen</Button></li>)}</ul></div>}
    <fieldset className={`bf-kinds ${kindsLeft.length < FEEDBACK_KINDS.length ? "is-two" : ""}`}><legend>{first ? "Wie meldet dieser Käufer zurück?" : "Welche Rückmeldung kommt dazu?"}</legend>{kindsLeft.map((item) => <label key={item.key} className={kind === item.key ? "is-on" : ""}><input type="radio" name="bf-kind" value={item.key} checked={kind === item.key} onChange={() => setKind(item.key)} /><span><b>{item.title}</b><small>{item.text}</small></span>{guess === item.key && <em>passt zur Schnittstelle</em>}</label>)}</fieldset>
    {kind === "aroundhome" && <div className="bf-fields"><label className="rd-field"><span>Publisher-ID</span><input className="fx-field" value={form.publisherId} onChange={(event) => setForm({ ...form, publisherId: event.target.value })} /></label><label className="rd-field"><span>Zugangstoken</span><input className="fx-field" value={form.accessToken} autoComplete="off" spellCheck={false} onChange={(event) => setForm({ ...form, accessToken: event.target.value })} /></label><label className="rd-field bf-wide"><span>Export-Link (so, wie Aroundhome ihn mit dir geteilt hat)</span><input className="fx-field" value={form.exportUrl} placeholder="https://…" onChange={(event) => setForm({ ...form, exportUrl: event.target.value })} /></label></div>}
    {kind === "plattform" && <div className="bf-fields"><label className="rd-field"><span>Plattform</span><select className="fx-select" value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value as typeof form.platform })}><option value="leadnodes">Leadnodes</option><option value="enpal">Enpal</option><option value="gohighlevel">GoHighLevel</option></select></label><label className="rd-field"><span>Zugangsschlüssel (Token)</span><input className="fx-field" value={form.token} autoComplete="off" spellCheck={false} placeholder="Token einfügen" onChange={(event) => setForm({ ...form, token: event.target.value })} /></label></div>}
    <div className="bf-foot"><small>{chosen.next}</small><span>{!first && <Button type="button" variant="ghost" onClick={onClose}>Abbrechen</Button>}<Button type="submit" className="flux-button" disabled={busy}><Check aria-hidden="true" /> {busy ? "Wird eingerichtet …" : chosen.action}</Button></span></div>
  </form>;
}

/** Eine eingerichtete Rückmeldung: Stand, Zugang bzw. Adresse, „bei Storno reklamieren“, pausieren, entfernen. */
function FeedbackAccount({ account, data, onDone }: { account: Account; data: Feedback; onDone: () => void }) {
  const fail = { onError: (error: { message: string }) => toast.error(error.message) };
  const update = trpc.leadops.updatePartnerAccount.useMutation({ onSuccess: () => onDone(), ...fail });
  const remove = trpc.leadops.removeBuyerFeedback.useMutation({ onSuccess: (result) => { toast.success(result.keptQuota ? "Rückmeldung entfernt. Das Kontingent bleibt." : "Rückmeldung entfernt."); onDone(); }, ...fail });
  const sync = trpc.leadops.syncAroundhomeAccount.useMutation({ onSuccess: (result) => { toast.success(result.summary); onDone(); }, ...fail });
  const saveAroundhome = trpc.leadops.saveAroundhomeAccount.useMutation({ onSuccess: () => { toast.success("Zugang gespeichert."); onDone(); }, ...fail });
  const savePlatform = trpc.leadops.savePlatformAccount.useMutation({ onSuccess: () => { toast.success("Zugang gespeichert."); onDone(); }, ...fail });
  const [form, setForm] = useState({ publisherId: account.publisherId, accessToken: account.accessToken, exportUrl: account.exportUrl });
  useEffect(() => { setForm({ publisherId: account.publisherId, accessToken: account.accessToken, exportUrl: account.exportUrl }); }, [account.publisherId, account.accessToken, account.exportUrl]);
  const changed = form.publisherId !== account.publisherId || form.accessToken !== account.accessToken || form.exportUrl !== account.exportUrl;
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); toast.success("Adresse kopiert."); } catch { toast.error("Kopieren nicht möglich – bitte die Adresse von Hand markieren."); } };
  const reclaims = account.provider === "wattfox" || account.provider === "aroundhome";
  const askRemove = async () => { if (await confirmAction(`Rückmeldung von ${providerName(account.provider)} entfernen? Stornos und Provisionen dieses Käufers erscheinen dann nicht mehr im Dashboard.${account.provider === "wattfox" ? " Die Adresse gilt danach nicht mehr – Aufrufe von WattFox schlagen fehl." : ""}${account.quotaAmount ? " Das eingetragene Kontingent bleibt erhalten." : ""}`, { danger: true, confirmLabel: "Ja, entfernen" })) remove.mutate({ id: account.id }); };
  return <article className={`bf-account ${account.enabled ? "" : "is-off"}`} style={{ "--brand": BRAND[account.provider] } as CSSProperties} aria-label={`Rückmeldung ${title(account)}`}>
    <header><span className="bf-mark" aria-hidden="true">{providerName(account.provider).slice(0, 2)}</span><div><b>{title(account)}</b><small>{account.provider === "wattfox" ? "WattFox meldet jede Änderung selbst" : account.provider === "aroundhome" ? "Wir rufen den Stand bei Aroundhome ab – alle 15 Minuten und auf Knopfdruck" : "Die Anbindung folgt – bis dahin zeigt das Dashboard geliefert, abgelehnt und angenommen"}</small></div><span className={`fx-pill ${account.enabled ? "is-good" : "is-mute"}`}><i />{account.enabled ? "Eingeschaltet" : "Pausiert"}</span></header>
    {account.provider === "wattfox" && <div className="bf-url"><span>Adresse für WattFox</span><div><code>{account.trackingUrl ?? "–"}</code>{account.trackingUrl && <Button type="button" size="sm" variant="outline" onClick={() => void copy(account.trackingUrl!)}><Copy aria-hidden="true" /> Kopieren</Button>}</div><small>Trag diese Adresse bei WattFox als Tracking-URL ein. WattFox ruft sie auf, sobald sich bei einem Lead etwas ändert.</small></div>}
    {account.provider === "aroundhome" && <form className="bf-fields" onSubmit={(event) => { event.preventDefault(); saveAroundhome.mutate({ id: account.id, label: account.label, ...form, reclaimOnCancel: account.reclaimOnCancel, reclaimReasonId: account.reclaimReasonId, enabled: account.enabled }); }}>
      <label className="rd-field"><span>Publisher-ID</span><input className="fx-field" value={form.publisherId} onChange={(event) => setForm({ ...form, publisherId: event.target.value })} /></label>
      <label className="rd-field"><span>Zugangstoken</span><input className="fx-field" value={form.accessToken} autoComplete="off" spellCheck={false} onFocus={() => { if (form.accessToken.startsWith("••••")) setForm({ ...form, accessToken: "" }); }} onBlur={() => { if (!form.accessToken) setForm({ ...form, accessToken: account.accessToken }); }} onChange={(event) => setForm({ ...form, accessToken: event.target.value })} /></label>
      <label className="rd-field bf-wide"><span>Export-Link</span><input className="fx-field" value={form.exportUrl} placeholder="https://…" onChange={(event) => setForm({ ...form, exportUrl: event.target.value })} /></label>
      <div className="bf-sync bf-wide"><small>{account.lastSyncAt ? `Zuletzt abgeglichen am ${stamp(account.lastSyncAt)}${account.lastSyncSummary ? `: ${account.lastSyncSummary}` : ""}` : "Noch kein Abgleich."}</small><span><Button type="submit" size="sm" variant="outline" disabled={!changed || saveAroundhome.isPending}><Save aria-hidden="true" /> {saveAroundhome.isPending ? "Speichert …" : "Zugang speichern"}</Button><Button type="button" size="sm" variant="outline" disabled={sync.isPending || changed} onClick={() => sync.mutate({ id: account.id })}><RefreshCw aria-hidden="true" className={sync.isPending ? "animate-spin" : ""} /> {sync.isPending ? "Wird abgeglichen …" : "Jetzt abgleichen"}</Button></span></div>
    </form>}
    {!reclaims && <PlatformToken account={account} pending={savePlatform.isPending} onSave={(token) => savePlatform.mutate({ id: account.id, provider: account.provider as "leadnodes" | "enpal" | "gohighlevel", label: account.label, token, buyerUserId: data.buyerUserId })} />}
    {reclaims && <div className="bf-claim"><label htmlFor={`bf-claim-${account.id}`}><b>Bei Storno automatisch reklamieren</b><small>Meldet der Partner ein Storno, entsteht daraus von selbst eine Reklamation zur Prüfung.</small></label><Switch id={`bf-claim-${account.id}`} checked={account.reclaimOnCancel} disabled={update.isPending} onCheckedChange={(checked) => update.mutate({ id: account.id, reclaimOnCancel: checked })} aria-label="Bei Storno automatisch reklamieren" />
      {account.reclaimOnCancel && <label className="rd-field bf-reason"><span>Grund, wenn kein besserer passt</span><select className="fx-select" value={account.reclaimReasonId ?? ""} disabled={update.isPending} onChange={(event) => update.mutate({ id: account.id, reclaimReasonId: event.target.value ? Number(event.target.value) : null })}><option value="">Kein fester Grund</option>{data.reasons.filter((reason) => reason.active || reason.id === account.reclaimReasonId).map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select><small>Welcher Stornogrund zu welchem Reklamationsgrund wird, legst du für alle fest: <a href="/?page=Einstellungen&setting=Integrationen">Einstellungen → Integrationen</a>.</small></label>}</div>}
    <footer><small>{account.quotaAmount ? <>Kontingent: {account.quotaAmount.toLocaleString("de-DE")} Leads {quotaPeriod(account.quotaPeriod).label} – <a href={STATS_URL}>im Dashboard ändern</a>.</> : <>Ein Kontingent trägst du auf der Karte im <a href={STATS_URL}>Dashboard</a> ein.</>}</small><span><button type="button" className="fx-tool" disabled={update.isPending} onClick={() => update.mutate({ id: account.id, enabled: !account.enabled }, { onSuccess: () => { toast.success(account.enabled ? "Rückmeldung pausiert." : "Rückmeldung wieder eingeschaltet."); } })}>{account.enabled ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />} {account.enabled ? "Pausieren" : "Wieder einschalten"}</button><button type="button" className="fx-tool bf-remove" disabled={remove.isPending} onClick={() => void askRemove()}><Trash2 aria-hidden="true" /> Entfernen</button></span></footer>
  </article>;
}

/** Zugangsschlüssel einer weiteren Plattform: gespeichert erscheint er nur gekürzt; ein leeres Feld lässt ihn stehen. */
function PlatformToken({ account, pending, onSave }: { account: Account; pending: boolean; onSave: (token: string) => void }) {
  const [token, setToken] = useState(account.accessToken);
  useEffect(() => { setToken(account.accessToken); }, [account.accessToken]);
  return <form className="bf-fields" onSubmit={(event) => { event.preventDefault(); onSave(token); }}><label className="rd-field bf-wide"><span>Zugangsschlüssel (Token)</span><input className="fx-field" value={token} autoComplete="off" spellCheck={false} placeholder="Token einfügen" onFocus={() => { if (token.startsWith("••••")) setToken(""); }} onBlur={() => { if (!token) setToken(account.accessToken); }} onChange={(event) => setToken(event.target.value)} /></label><div className="bf-sync bf-wide"><small>{account.accessToken ? "Der Schlüssel ist gespeichert und erscheint nur gekürzt." : "Noch kein Schlüssel hinterlegt."}</small><span><Button type="submit" size="sm" variant="outline" disabled={pending || token === account.accessToken}><Save aria-hidden="true" /> {pending ? "Speichert …" : "Schlüssel speichern"}</Button></span></div></form>;
}
