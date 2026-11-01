import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { confirmAction } from "@/lib/confirm";
import { CHECK_KEYS, CHECK_LABEL, OPT_IN_KIND_LABEL, OPT_IN_STATUS_LABEL, type OptInChecks, type OptInKind, type OptInStatus } from "../../../shared/opt-in";
import { Ban, Download, FileCheck2, MessageSquareText, Mic, Smartphone, FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const stamp = (value: Date | string | null | undefined) => (value ? `${new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })} Uhr` : "–");
const day = (value: Date | string | null | undefined) => (value ? new Date(value).toLocaleDateString("de-DE") : "–");
const KIND_ICON: Record<OptInKind, typeof Mic> = { formular: FileText, sprache: Mic, sms: Smartphone };
export const optInTone = (status: OptInStatus) => (status === "gueltig" ? "is-ok" : status === "offen" ? "is-wait" : status === "unvollstaendig" ? "is-warn" : "is-bad");

/** Status-Schild für Listen (Karte, Gesprächsbewertung). */
export function OptInBadge({ status, kind, buyerName, missing, compact }: { status: OptInStatus; kind?: OptInKind | null; buyerName?: string | null; missing?: string[] | null; compact?: boolean }) {
  const title = `Opt-in ${OPT_IN_STATUS_LABEL[status]}${kind ? ` · ${OPT_IN_KIND_LABEL[kind]}` : ""}${buyerName ? ` · für ${buyerName}` : ""}${missing?.length ? ` · fehlt: ${missing.join(", ")}` : ""}`;
  return <span className={`opt-in-badge ${optInTone(status)}`} title={title}><FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />{compact ? OPT_IN_STATUS_LABEL[status] : `Opt-in ${OPT_IN_STATUS_LABEL[status]}`}</span>;
}

/**
 * Opt-in-Nachweise zum Lead (Callcenter: Gespräche → Anruf): alle Einwilligungsnachweise (Formular, Sprachaufnahme, SMS) mit Status, Fehlendem, Ausschnitt der Aufnahme,
 * Nachweis-PDF, SMS-Bestätigung senden und Widerruf erfassen. Gesendet oder angerufen wird hier nichts automatisch.
 */
export default function OptInPanel({ publicId, onChanged, compact = false }: { publicId: string; onChanged?: () => void; compact?: boolean }) {
  const utils = trpc.useUtils();
  const list = trpc.leadops.listOptIns.useQuery({ publicId }, { retry: false });
  const script = trpc.leadops.optInScript.useQuery({ publicId }, { retry: false, staleTime: 60_000 });
  const refresh = () => { utils.leadops.listOptIns.invalidate({ publicId }); utils.leadops.optInScript.invalidate({ publicId }); onChanged?.(); };
  const [smsBuyer, setSmsBuyer] = useState<string>(""); const [smsOpen, setSmsOpen] = useState(false);
  const sendSms = trpc.leadops.sendOptInSms.useMutation({ onSuccess: (result) => { toast.success(`SMS-Bestätigung ${result.number} geschickt – der Link gilt, bis der Kunde klickt.`); setSmsOpen(false); refresh(); }, onError: (error) => toast.error(error.message) });
  const revoke = trpc.leadops.revokeOptIn.useMutation({ onSuccess: (result) => { toast.success(`Opt-in ${result.number} widerrufen – der Kontakt wird nicht mehr angerufen und steht auf der Sperrliste.`); refresh(); }, onError: (error) => toast.error(error.message) });
  const downloadPdf = async (id: number) => { try { const result = await utils.client.leadops.optInPdf.query({ id }); const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })); const link = document.createElement("a"); link.href = url; link.download = result.fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000); } catch (error) { toast.error(error instanceof Error ? error.message : "PDF konnte nicht erstellt werden."); } };
  const rows = list.data ?? []; const choices = script.data?.choices ?? []; const suggested = script.data?.suggestions?.[0] ?? null;
  const buyerForSms = smsBuyer || suggested?.buyerName || "";
  return <div className={`opt-in-panel ${compact ? "is-compact" : ""}`}>
    {!compact && <div className="opt-in-head"><div><span className="eyebrow">OPT-IN · EINWILLIGUNGSNACHWEISE</span><p>Formular-Einwilligung für unseren Anruf, Sprachaufnahme im Gespräch oder SMS-Bestätigung für den Fachbetrieb. Nachweise bleiben 5 Jahre – ab Erteilung und nach jeder Zustellung neu.</p></div><Button size="sm" variant="outline" onClick={() => setSmsOpen((open) => !open)}><Smartphone /> SMS-Bestätigung senden</Button></div>}
    {smsOpen && <div className="opt-in-sms">
      <label className="text-xs text-slate-400">Fachbetrieb, der in der SMS genannt wird<input className="opt-in-input" list="opt-in-buyers" placeholder="Firma, Ort" value={buyerForSms} onChange={(event) => setSmsBuyer(event.target.value)} /><datalist id="opt-in-buyers">{choices.map((choice) => <option key={`${choice.buyerUserId ?? ""}-${choice.buyerName}`} value={choice.buyerName} />)}</datalist></label>
      {suggested && !smsBuyer && <small className="opt-in-hint">Vorschlag aus der Lieferkette „{suggested.chainName}“: {suggested.buyerName}</small>}
      {script.data?.settings.missingCompany && <small className="opt-in-hint is-warn">Bitte zuerst unter Telefonie → Einstellungen → Opt-in den Firmennamen eintragen.</small>}
      <div className="flex flex-wrap gap-2"><Button size="sm" className="flux-button" disabled={!buyerForSms.trim() || sendSms.isPending} onClick={() => { const choice = choices.find((item) => item.buyerName === buyerForSms.trim()); sendSms.mutate({ publicId, buyerName: buyerForSms.trim(), buyerUserId: choice?.buyerUserId ?? null }); }}><Smartphone /> {sendSms.isPending ? "Wird gesendet …" : "SMS jetzt senden"}</Button><Button size="sm" variant="ghost" onClick={() => setSmsOpen(false)}>Abbrechen</Button></div>
      <small className="opt-in-hint">Die SMS nennt den Fachbetrieb und enthält einen Bestätigungslink. Erst mit dem Klick des Kunden ist der Nachweis gültig (Bundesnetzagentur: SMS ja, E-Mail-Bestätigung reicht für Telefon-Einwilligungen nicht).</small>
    </div>}
    {list.isLoading ? <p className="opt-in-empty">Wird geladen …</p> : rows.length === 0 ? <p className="opt-in-empty">Noch kein Opt-in. Im Dialer „Opt-in aufnehmen“ – oder oben eine SMS-Bestätigung schicken.</p> : <ul className="opt-in-list">
      {rows.map((row) => { const Icon = KIND_ICON[row.kind] ?? FileCheck2; const checks = row.checks as OptInChecks | null; return <li key={row.id} className={`opt-in-row ${optInTone(row.status)}`}>
        <div className="opt-in-row-head"><Icon className="h-4 w-4" aria-hidden="true" /><strong>{OPT_IN_KIND_LABEL[row.kind]}</strong><OptInBadge status={row.status} compact /><span className="opt-in-number">{row.number}</span><span className="opt-in-when">{row.kind === "sms" && !row.confirmedAt ? `SMS ${stamp(row.smsSentAt)}` : stamp(row.givenAt)}</span></div>
        <p className="opt-in-who">{row.grantedTo === "kaeufer" ? (row.buyerName ? <>für <strong>{row.buyerName}</strong></> : <>für den Fachbetrieb <em>(ohne Namen – Ersatzformulierung)</em></>) : <>für unseren Anruf</>}{row.collectedBy ? ` · eingeholt von ${row.collectedBy}` : ""}{row.confirmedAt ? ` · bestätigt ${stamp(row.confirmedAt)}` : ""}</p>
        {row.status === "unvollstaendig" && row.missing.length > 0 && <p className="opt-in-missing">Fehlt: {row.missing.join(", ")}</p>}
        {row.warning && <p className="opt-in-warning">{row.warning}</p>}
        {row.revokedAt && <p className="opt-in-missing">Widerrufen am {stamp(row.revokedAt)}{row.revokeNote ? ` – ${row.revokeNote}` : ""}</p>}
        {!compact && checks?.by && <ul className="opt-in-checks">{CHECK_KEYS.map((key) => <li key={key} className={checks[key] ? "is-on" : "is-off"}>{checks[key] ? "✓" : "✗"} {CHECK_LABEL[key]}</li>)}<li className="opt-in-checks-by">{checks.by === "ki" ? "KI-Prüfung der Abschrift" : checks.by === "regeln" ? "Regelprüfung" : "Bestätigung des Agenten"}</li></ul>}
        {!compact && row.quote && <blockquote className="opt-in-quote">„{row.quote}“</blockquote>}
        {!compact && row.recordingUrl && <audio className="opt-in-audio" controls preload="none" src={row.recordingStartSec !== null && row.recordingStartSec !== undefined && !row.recordingUrl.includes("#") ? `${row.recordingUrl}#t=${row.recordingStartSec}${row.recordingEndSec ? `,${row.recordingEndSec}` : ""}` : row.recordingUrl} />}
        {!compact && row.usages.length > 0 && <p className="opt-in-usages">Verwendet: {row.usages.slice(-3).map((usage) => `${day(usage.at)}${usage.buyerName ? ` an ${usage.buyerName}` : ""}`).join(" · ")}{row.usages.length > 3 ? ` · +${row.usages.length - 3}` : ""} · Aufbewahrung bis {day(row.retainUntil)}</p>}
        {!compact && <div className="opt-in-actions">
          <button type="button" className="cj-btn" onClick={() => void downloadPdf(row.id)}><Download className="h-3.5 w-3.5" /> Nachweis (PDF)</button>
          {row.proofUrl && <button type="button" className="cj-btn" title="Link zum Nachweis für den Käufer kopieren" onClick={async () => { try { await navigator.clipboard.writeText(row.proofUrl!); toast.success("Nachweis-Link kopiert."); } catch { toast.error("Kopieren nicht möglich – Link: " + row.proofUrl); } }}><MessageSquareText className="h-3.5 w-3.5" /> Link für Käufer</button>}
          {row.status !== "widerrufen" && row.status !== "abgelehnt" && <button type="button" className="cj-btn is-danger" disabled={revoke.isPending} onClick={async () => { if (await confirmAction(`Opt-in ${row.number} als widerrufen erfassen? Der Kontakt kommt auf die Sperrliste und wird nicht mehr angerufen.`, { danger: true, confirmLabel: "Widerruf erfassen" })) revoke.mutate({ optInId: row.id, note: "Vom Kunden widerrufen" }); }}><Ban className="h-3.5 w-3.5" /> Widerruf erfassen</button>}
        </div>}
      </li>; })}
    </ul>}
  </div>;
}
