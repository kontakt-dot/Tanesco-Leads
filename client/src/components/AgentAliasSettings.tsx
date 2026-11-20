import { confirmAction } from "@/lib/confirm";
import { trpc } from "@/lib/trpc";
import { ArrowRight, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Alias-Namen der Agenten (Gespräche → „Dialer & Bewertung“ → „Alias-Namen“).
 * Am Telefon nennen sich Agenten anders als im Dialer. Hier steht, welcher Name am Telefon zu welchem echten Namen gehört:
 * gelernt aus Gesprächen, bei denen der Dialer den echten Namen meldet, oder von Hand eingetragen. Jede Zuordnung gilt sofort für
 * alle Gespräche – auch für die alten.
 */
const count = (value: number, one: string, many: string) => `${value.toLocaleString("de-DE")} ${value === 1 ? one : many}`;

export default function AgentAliasSettings() {
  const utils = trpc.useUtils();
  const overview = trpc.leadops.agentAliasOverview.useQuery(undefined, { retry: false, refetchInterval: 60_000 });
  const refresh = () => { utils.leadops.agentAliasOverview.invalidate(); utils.leadops.listCalls.invalidate(); utils.leadops.callStatistics.invalidate(); utils.leadops.dialerAgentReport.invalidate(); utils.leadops.callAgentNames.invalidate(); };
  const onError = (error: { message: string }) => toast.error(error.message);
  const [alias, setAlias] = useState(""); const [name, setName] = useState("");
  const save = trpc.leadops.setAgentAlias.useMutation({ onSuccess: (result, input) => { toast.success(`„${input.alias}“ gehört jetzt zu ${input.name}.${result.renamed ? ` ${count(result.renamed, "Gespräch wurde", "Gespräche wurden")} umgeschrieben.` : ""}`); setAlias(""); setName(""); refresh(); }, onError });
  const remove = trpc.leadops.removeAgentAlias.useMutation({ onSuccess: (result) => { toast.success(result.restored ? `Zuordnung entfernt – ${count(result.restored, "Gespräch läuft", "Gespräche laufen")} wieder unter dem Alias.` : "Zuordnung entfernt."); refresh(); }, onError });
  const sync = trpc.leadops.syncAgentAliases.useMutation({ onSuccess: (result) => { toast.success(result.renamed ? `${count(result.renamed, "Gespräch", "Gespräche")} dem echten Namen zugeordnet.` : "Alles ist auf dem Stand – nichts zu ändern."); refresh(); }, onError });
  const data = overview.data;
  const pairs = (data?.aliases ?? []).filter((item) => item.name); const blocked = (data?.aliases ?? []).filter((item) => !item.name);
  const submit = () => { if (alias.trim().length < 3 || name.trim().length < 3) return toast.error("Bitte beide Namen eintragen."); save.mutate({ alias: alias.trim(), name: name.trim() }); };
  return <section className="surface-panel operations-panel gs-card" aria-labelledby="ga-h">
    <header className="gs-head"><div><h2 id="ga-h">Alias-Namen der Agenten</h2><p>Am Telefon nennen sich Agenten oft anders als im Dialer. Hier steht, welcher Name am Telefon zu welchem echten Namen gehört. Die Software lernt das von selbst: Sobald der Dialer bei einem Gespräch den echten Namen meldet, merkt sie sich, wie sich der Agent dort vorstellt – und ordnet auch alle älteren Gespräche dem echten Namen zu.</p></div>
      <button type="button" className="gs-btn" disabled={sync.isPending} onClick={() => sync.mutate()} title="Gespräche noch einmal durchgehen: Vorstellungen prüfen, Zuordnungen lernen und anwenden">{sync.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}{sync.isPending ? "Gleicht ab …" : "Jetzt abgleichen"}</button></header>
    {overview.isLoading ? <p className="ga-empty">Wird geladen …</p> : overview.error ? <p className="ga-empty">{overview.error.message}</p> : <>
      <div className="ga-box">
        <div className="ga-box-head"><h3>Zuordnungen</h3><span>{pairs.length ? count(pairs.length, "Alias", "Alias-Namen") : "Noch keine"}</span></div>
        {!pairs.length ? <p className="ga-empty">{data?.dialerNames ? "Noch keine Zuordnung gelernt. Das geschieht, sobald ein Agent sich in einem Gespräch mit einem anderen Namen vorstellt, als der Dialer meldet. Du kannst Zuordnungen auch gleich von Hand eintragen." : "Der Dialer meldet bisher keine Namen der Agenten. Sobald er das tut, lernt die Software die Zuordnungen von selbst. Du kannst sie auch von Hand eintragen."}</p>
          : <ul className="ga-list">{pairs.map((item) => <li key={item.alias}>
            <span className="ga-alias"><small>am Telefon</small><b>{item.alias}</b></span>
            <ArrowRight className="ga-arrow" aria-hidden="true" />
            <span className="ga-real"><small>echter Name</small><b>{item.name}</b></span>
            <span className="ga-facts"><em className={item.source === "manuell" ? "is-hand" : ""}>{item.source === "manuell" ? "von Hand" : item.calls ? `gelernt aus ${count(item.calls, "Gespräch", "Gesprächen")}` : "gelernt"}</em><small>{count(item.realCalls, "Gespräch", "Gespräche")} unter dem echten Namen{item.aliasCalls ? `, ${item.aliasCalls.toLocaleString("de-DE")} davon mit diesem Alias` : ""}</small></span>
            <button type="button" className="ga-x" aria-label={`Zuordnung ${item.alias} entfernen`} title="Zuordnung entfernen – die Gespräche laufen dann wieder unter dem Alias" disabled={remove.isPending} onClick={async () => { if (await confirmAction(`„${item.alias}“ nicht mehr ${item.name} zuordnen? Gespräche, die darüber zugeordnet wurden, laufen dann wieder unter „${item.alias}“.`)) remove.mutate({ alias: item.alias }); }}><Trash2 aria-hidden="true" /></button>
          </li>)}</ul>}
        <form className="ga-add" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label><span>Name am Telefon</span><input list="ga-open-names" value={alias} placeholder="z. B. Laura Stein" onChange={(event) => setAlias(event.target.value)} /></label>
          <ArrowRight className="ga-arrow" aria-hidden="true" />
          <label><span>Echter Name</span><input list="ga-real-names" value={name} placeholder="z. B. Deniz Kaya" onChange={(event) => setName(event.target.value)} /></label>
          <button type="submit" className="gs-btn is-strong" disabled={save.isPending}>{save.isPending ? "Ordnet zu …" : "Zuordnen"}</button>
          <datalist id="ga-open-names">{(data?.open ?? []).map((item) => <option key={item.name} value={item.name} />)}</datalist><datalist id="ga-real-names">{(data?.real ?? []).map((item) => <option key={item} value={item} />)}</datalist>
        </form>
      </div>
      {(data?.open.length ?? 0) > 0 && <div className="ga-box">
        <div className="ga-box-head"><h3>Namen ohne echten Namen</h3><span>{count(data!.open.length, "Name", "Namen")}</span></div>
        <p className="ga-hint">Unter diesen Namen laufen Gespräche, bei denen der Dialer keinen Agenten gemeldet hat – der Name stammt aus dem Gespräch. Gehört ein Name als Alias zu einem Agenten, wähle rechts den echten Namen. Alle seine Gespräche zählen dann für diesen Agenten.</p>
        <ul className="ga-open">{data!.open.map((item) => <li key={item.name}><b>{item.name}</b><small>{count(item.calls, "Gespräch", "Gespräche")}</small>{data!.real.length > 0 ? <select aria-label={`Echter Name zu ${item.name}`} value="" disabled={save.isPending} onChange={(event) => { if (event.target.value) save.mutate({ alias: item.name, name: event.target.value }); }}><option value="">Echten Namen wählen …</option>{data!.real.map((real) => <option key={real} value={real}>{real}</option>)}</select> : <button type="button" className="gs-textbtn" onClick={() => setAlias(item.name)}>oben eintragen</button>}</li>)}</ul>
      </div>}
      {blocked.length > 0 && <div className="ga-box">
        <div className="ga-box-head"><h3>Kein Alias</h3><span>{count(blocked.length, "Name", "Namen")}</span></div>
        <p className="ga-hint">Diese Namen hast du ausdrücklich nicht zugeordnet – die Software lernt sie nicht wieder.</p>
        <ul className="ga-open">{blocked.map((item) => <li key={item.alias}><b>{item.alias}</b><small>bleibt ein eigener Name</small><button type="button" className="gs-textbtn" disabled={remove.isPending} onClick={() => remove.mutate({ alias: item.alias })}>wieder lernen lassen</button></li>)}</ul>
      </div>}
    </>}
  </section>;
}
