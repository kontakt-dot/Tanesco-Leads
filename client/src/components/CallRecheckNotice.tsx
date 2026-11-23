import { trpc } from "@/lib/trpc";
import { History, PauseCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Hinweis über der Liste der Gespräche: Prüffragen werden bei älteren Gesprächen nachgeholt (z. B. „bis zu 3 Angebote von Fachpartnern“) –
 * wie viele noch warten, welche Frage, und was sich dadurch geändert hat. „Diese Gespräche zeigen“ filtert die Liste auf die geänderten.
 * Ist alles nachgeholt, lässt sich der Hinweis ausblenden – bis sich wieder etwas ändert.
 */
const HIDE_KEY = "tanesco-recheck-hidden";
const de = (value: number) => value.toLocaleString("de-DE");
const calls = (count: number) => `${de(count)} ${count === 1 ? "Gespräch" : "Gespräche"}`;
export default function CallRecheckNotice({ active, onShow }: { active: boolean; onShow: (on: boolean) => void }) {
  const utils = trpc.useUtils();
  const status = trpc.leadops.callRecheckStatus.useQuery(undefined, { retry: false, refetchInterval: (query) => ((query.state.data?.waiting ?? 0) > 0 ? 30_000 : 120_000) }).data;
  // Während nachgeprüft wird, ändern sich Entscheidungen – Liste und Zähler ziehen mit
  const seen = useRef<string | null>(null);
  const stamp = status ? `${status.waiting}|${status.changed.total}` : null;
  useEffect(() => { if (stamp === null) return; if (seen.current !== null && seen.current !== stamp) { void utils.leadops.listCalls.invalidate(); void utils.leadops.callStatistics.invalidate(); } seen.current = stamp; }, [stamp, utils]);
  const [hidden, setHidden] = useState<number | null>(() => { try { return Number(localStorage.getItem(HIDE_KEY)) || null; } catch { return null; } });
  if (!status) return null;
  const { waiting, changed, questions } = status;
  const showChanged = changed.total > 0 && (active || waiting > 0 || hidden !== changed.total);
  if (!waiting && !showChanged) return null;
  const hide = () => { try { localStorage.setItem(HIDE_KEY, String(changed.total)); } catch { /* egal */ } setHidden(changed.total); onShow(false); };
  const parts = [changed.rejected ? `${de(changed.rejected)} zurückgewiesen` : "", changed.review ? `${de(changed.review)} zur Prüfung` : ""].filter(Boolean).join(", ");
  return <section className={`gq-recheck ${waiting ? "is-running" : "is-done"}`} aria-label="Prüffragen bei älteren Gesprächen" aria-live="polite">
    <span className="gq-recheck-icon" aria-hidden="true">{status.paused && waiting ? <PauseCircle /> : <History />}</span>
    <div className="gq-recheck-text">
      {waiting > 0 && <p><b>Prüffragen werden bei älteren Gesprächen nachgeholt.</b> Noch {calls(waiting)}{status.paused ? " – pausiert, weil die Tagesgrenze der KI für Gespräche erreicht ist. Es geht weiter, sobald wieder Budget frei ist." : `, etwa ${de(status.perMinute)} pro Minute.`}{questions[0] ? <> Neu dabei: „{questions[0].label}“{status.questionCount > 1 ? ` und ${status.questionCount - 1} weitere ${status.questionCount === 2 ? "Frage" : "Fragen"}` : ""}.</> : null}</p>}
      {waiting > 0 && <small>Die Entscheidung wird dabei nur strenger, nie lockerer. Fehlt eine Pflicht-Antwort, wird das Gespräch zurückgewiesen und sein Lead auf „Fehlerhaft“ gesetzt. Schon ausgelieferte Leads bleiben, wie sie sind.</small>}
      {changed.total > 0 && <p className="gq-recheck-result"><b>{calls(changed.total)} durch die Nachprüfung geändert</b>{parts ? `: ${parts}.` : "."}{changed.leadsHeld ? ` ${de(changed.leadsHeld)} ${changed.leadsHeld === 1 ? "Lead steht" : "Leads stehen"} jetzt auf „Fehlerhaft“ oder „Hängend“ und ${changed.leadsHeld === 1 ? "geht" : "gehen"} nicht raus.` : ""}{changed.delivered ? ` ${de(changed.delivered)} ${changed.delivered === 1 ? "war" : "waren"} schon ausgeliefert und ${changed.delivered === 1 ? "bleibt" : "bleiben"} unverändert.` : ""}</p>}
    </div>
    {changed.total > 0 && <div className="gq-recheck-actions">
      <button type="button" className="gq-recheck-show" aria-pressed={active} onClick={() => onShow(!active)}>{active ? "Alle Gespräche zeigen" : "Diese Gespräche zeigen"}</button>
      {!waiting && <button type="button" className="gq-recheck-close" aria-label="Hinweis ausblenden" title="Ausblenden – er kommt wieder, wenn sich durch eine Nachprüfung etwas ändert" onClick={hide}><X aria-hidden="true" /></button>}
    </div>}
  </section>;
}
