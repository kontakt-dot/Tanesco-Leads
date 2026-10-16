import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Headphones, Phone, PhoneCall, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { callCounterText, CALL_RESULTS, normalizePhone, type CallResult } from "../../../shared/pipeline-extras";

/**
 * Anruf-Fenster – ein Ort für alles rund um den Anruf, mit oder ohne Dialer:
 *  1. „Jetzt anrufen“: die Nummer zum Antippen (tel:-Link → Telefon-App, Handy, Softphone, sipgate-App) und, falls
 *     eingerichtet, der Knopf „Über den Dialer“. Fehlt die Nummer, lässt sie sich direkt hier eintragen.
 *  2. „Ergebnis festhalten“: nach dem Auflegen Ergebnis anklicken, Notiz, Wiedervorlage – der Zähler zählt hoch und die
 *     Karte wandert von selbst (Neu → In Bearbeitung, erreicht → Kontaktiert).
 * Dialer-Anrufe zählen automatisch; dieses Fenster ist der Weg für alle Anrufe ohne Dialer.
 */
export type CallDialogProps = { publicId: string; name: string; phone?: string | null; onDialer?: (() => void) | null; dialerLabel?: string | null; onDone: () => void; onCancel: () => void; onPhoneSaved?: () => void };
const FOLLOW_UPS: Array<[string, (now: Date) => Date]> = [["in 1 Std.", (now) => new Date(now.getTime() + 3_600_000)], ["in 3 Std.", (now) => new Date(now.getTime() + 3 * 3_600_000)], ["morgen 9:00", (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0)], ["in 3 Tagen", (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 9, 0)]];
const PHONE_KEY = "tanesco-manual-calls"; // zuletzt per Telefon angerufene Karten (nur Hinweis „Anruf läuft“)
export function CallDialog({ publicId, name, phone, onDialer, dialerLabel, onDone, onCancel, onPhoneSaved }: CallDialogProps) {
  const [result, setResult] = useState<CallResult>("nicht_erreicht"); const [note, setNote] = useState(""); const [followUp, setFollowUp] = useState<number | null>(null);
  const [phoneDraft, setPhoneDraft] = useState(""); const [calling, setCalling] = useState<Date | null>(null); const [, tick] = useState(0);
  useEffect(() => { if (!calling) return; const timer = window.setInterval(() => tick((value) => value + 1), 1000); return () => window.clearInterval(timer); }, [calling]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onCancel]);
  const utils = trpc.useUtils();
  const log = trpc.leadops.logCallAttempt.useMutation({ onSuccess: (saved) => { toast.success(`${name}: Anruf ${saved.count} festgehalten (${CALL_RESULTS.find((item) => item.key === saved.result)?.short ?? saved.result})${saved.moved ? ` – Karte jetzt in „${saved.moved === "in_bearbeitung" ? "In Bearbeitung" : saved.moved === "kontaktiert" ? "Kontaktiert" : saved.moved}“` : ""}.`); try { localStorage.removeItem(`${PHONE_KEY}:${publicId}`); } catch { /* privater Modus */ } onDone(); }, onError: (error) => toast.error(error.message) });
  const savePhone = trpc.leadops.setPipelineContact.useMutation({ onSuccess: (saved) => { toast.success(`Telefon ${saved.phone} gespeichert.`); utils.leadops.pipelineOverview.invalidate(); utils.leadops.pipelineLeadDetail.invalidate(); onPhoneSaved?.(); }, onError: (error) => toast.error(error.message) });
  const seconds = calling ? Math.max(0, Math.round((Date.now() - calling.getTime()) / 1000)) : 0;
  const telHref = phone ? `tel:${(normalizePhone(phone) ?? phone).replace(/\s+/g, "")}` : null;
  return <div className="calllog-overlay" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}><div className="calllog-form" role="dialog" aria-label={`Anruf bei ${name}`}>
    <div className="calllog-title"><strong>{name}</strong><small>{phone ? "Anrufen – und nach dem Auflegen das Ergebnis festhalten. Zählt auch ohne Dialer." : "Noch keine Telefonnummer – eintragen, dann anrufen."}</small></div>
    <div className="calllog-dial">
      {telHref ? <a className="calllog-tel" href={telHref} onClick={() => { setCalling(new Date()); try { localStorage.setItem(`${PHONE_KEY}:${publicId}`, String(Date.now())); } catch { /* privater Modus */ } }} title="Öffnet die Telefon-App bzw. das Softphone (Handy, sipgate-App, Tischtelefon mit Click-to-Dial)"><Smartphone className="h-4 w-4" /><span><b>{phone}</b><small>{calling ? `Anruf läuft · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "Mit dem Telefon anrufen"}</small></span></a>
        : <div className="calllog-phone-missing"><Input className="h-9" placeholder="+49 …" value={phoneDraft} onChange={(event) => setPhoneDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && normalizePhone(phoneDraft)) savePhone.mutate({ publicId, phone: normalizePhone(phoneDraft) }); }} /><button type="button" className="calllog-save" disabled={!normalizePhone(phoneDraft) || savePhone.isPending} onClick={() => savePhone.mutate({ publicId, phone: normalizePhone(phoneDraft) })}>Nummer speichern</button></div>}
      {onDialer && phone && <button type="button" className="calllog-dialer" onClick={() => { onCancel(); onDialer(); }} title="Anruf über den eingerichteten Dialer – das Ergebnis zählt dann automatisch"><Headphones className="h-4 w-4" /> {dialerLabel ?? "Über den Dialer"}</button>}
    </div>
    <div className="calllog-section"><span className="eyebrow">ERGEBNIS FESTHALTEN</span><small>Nach dem Auflegen anklicken – der Zähler zählt den Versuch, die Karte rückt von selbst weiter.</small></div>
    <div className="calllog-results">{CALL_RESULTS.map((item) => <button key={item.key} type="button" className={`${result === item.key ? "active" : ""} ${item.reached ? "is-reached" : ""}`} onClick={() => setResult(item.key)}>{item.label}</button>)}</div>
    <Input className="calllog-note h-8" placeholder="Kurze Notiz (optional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={320} />
    <div className="calllog-followup"><span>Wieder anrufen:</span>{FOLLOW_UPS.map(([label], index) => <button key={label} type="button" className={followUp === index ? "active" : ""} onClick={() => setFollowUp(followUp === index ? null : index)}>{label}</button>)}</div>
    <div className="calllog-actions"><button type="button" className="calllog-cancel" onClick={onCancel}>Abbrechen</button><button type="button" className="calllog-save" disabled={log.isPending} onClick={() => log.mutate({ publicId, result, note: note.trim() || null, followUpAt: followUp === null ? null : FOLLOW_UPS[followUp][1](new Date()) })}>{log.isPending ? "Speichert …" : "Anruf speichern"}</button></div>
  </div></div>;
}
/** Abwärtskompatibel: das alte Formular ist jetzt das Anruf-Fenster. */
export const CallLogForm = CallDialog;

/** „+ Anruf“ unter der Karte: Zähler-Knopf, der das Anruf-Fenster öffnet. */
export function CallLogButton({ lead, onLogged, onDialer, dialerLabel, open, onOpenChange }: { lead: { publicId: string; name: string; phone?: string | null; calls?: { count: number } }; onLogged: () => void; onDialer?: (() => void) | null; dialerLabel?: string | null; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [own, setOwn] = useState(false); const isOpen = open ?? own; const setOpen = (value: boolean) => { setOwn(value); onOpenChange?.(value); };
  return <div className="pipeline-card-calllog">
    <button type="button" className={`calllog-toggle ${isOpen ? "is-open" : ""}`} title="Anrufen und Ergebnis festhalten – zählt den Versuch, auch ohne Dialer" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}><Phone className="h-3 w-3" /> + Anruf{lead.calls?.count ? ` (${lead.calls.count})` : ""}</button>
    {isOpen && <CallDialog publicId={lead.publicId} name={lead.name} phone={lead.phone} onDialer={onDialer} dialerLabel={dialerLabel} onDone={() => { setOpen(false); onLogged(); }} onCancel={() => setOpen(false)} onPhoneSaved={onLogged} />}
  </div>;
}

/** Lead-Seite: Zähler, Liste der Versuche (Dialer und von Hand) und das Anruf-Fenster. */
export function CallAttemptsSection({ publicId, name, phone, onDialer, dialerLabel, open, onOpenChange }: { publicId: string; name: string; phone?: string | null; onDialer?: (() => void) | null; dialerLabel?: string | null; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const attempts = trpc.leadops.callAttempts.useQuery({ publicId }, { retry: false });
  const utils = trpc.useUtils(); const [own, setOwn] = useState(false); const isOpen = open ?? own; const setOpen = (value: boolean) => { setOwn(value); onOpenChange?.(value); };
  const data = attempts.data; const refresh = () => { utils.leadops.callAttempts.invalidate(); utils.leadops.pipelineOverview.invalidate(); utils.leadops.pipelineHistory.invalidate(); utils.leadops.pipelineLeadDetail.invalidate(); utils.leadops.listPipelineTasks.invalidate(); };
  return <section className="call-attempts">
    <div className="call-attempts-head"><span className="eyebrow">ANRUFE</span><strong>{data ? callCounterText(data) ?? "Noch kein Anruf festgehalten" : "…"}</strong>{data && data.count > 0 && <small>{data.reached} × erreicht</small>}<button type="button" className={`calllog-toggle ${isOpen ? "is-open" : ""}`} onClick={() => setOpen(!isOpen)}><PhoneCall className="h-3.5 w-3.5" /> Anrufen / + Anruf</button></div>
    {isOpen && <CallDialog publicId={publicId} name={name} phone={phone} onDialer={onDialer} dialerLabel={dialerLabel} onDone={() => { setOpen(false); refresh(); }} onCancel={() => setOpen(false)} onPhoneSaved={refresh} />}
    {data && data.attempts.length > 0 && <ol className="call-attempts-list">{data.attempts.map((attempt, index) => <li key={attempt.id}><span className="call-attempt-no">{data.attempts.length - index}</span><span className={`call-attempt-result ${attempt.result === "erreicht" || attempt.result === "rueckruf" ? "is-reached" : ""}`}>{attempt.label}</span><span className="call-attempt-when">{new Date(attempt.at).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{attempt.by ? ` · ${attempt.by}` : ""}{attempt.fromDialer ? " · Dialer" : " · Telefon"}</span>{attempt.note && <span className="call-attempt-note">{attempt.note}</span>}</li>)}</ol>}
  </section>;
}
