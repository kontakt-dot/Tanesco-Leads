import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, Circle, Mic, Square, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { OPT_IN_STATUS_LABEL, type ScriptStep } from "../../../shared/opt-in";

/**
 * „Opt-in aufnehmen“ im Dialer: Skript in drei Schritten mit eingesetztem Käufernamen. Die Aufnahme startet erst nach dem ersten „Ja“
 * (Erlaubnis für die Aufnahme) und endet nach dem Abschluss – so wird nur der Einwilligungsabschnitt aufgezeichnet. Der Agent bestätigt
 * beide „Ja“; die Abschrift wird nach dem Auflegen automatisch geprüft (Regeln bzw. KI).
 */
export default function OptInRecorder({ publicId, dialerCallId, open, onClose, onDone }: { publicId: string; dialerCallId: number | null; open: boolean; onClose: () => void; onDone?: () => void }) {
  const [buyerName, setBuyerName] = useState(""); const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<"vorbereiten" | "aufnahme" | "fertig">("vorbereiten");
  const [optInId, setOptInId] = useState<number | null>(null); const [recordingNote, setRecordingNote] = useState<string | null>(null); const [recordingActive, setRecordingActive] = useState(false);
  const [attestJa, setAttestJa] = useState(false); const [startedAt, setStartedAt] = useState<number | null>(null); const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ status: string; number: string } | null>(null);
  const script = trpc.leadops.optInScript.useQuery({ publicId, buyerName: touched ? buyerName || null : null }, { retry: false, enabled: open });
  useEffect(() => { if (!touched && script.data?.buyer?.buyerName) setBuyerName(script.data.buyer.buyerName); }, [script.data?.buyer?.buyerName, touched]);
  useEffect(() => { if (!startedAt) return; const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 500); return () => window.clearInterval(timer); }, [startedAt]);
  useEffect(() => { if (!open) { setPhase("vorbereiten"); setOptInId(null); setRecordingNote(null); setRecordingActive(false); setAttestJa(false); setStartedAt(null); setElapsed(0); setResult(null); setTouched(false); setBuyerName(""); } }, [open]);
  const start = trpc.leadops.startVoiceOptIn.useMutation({ onSuccess: (data) => { setOptInId(data.id); setRecordingNote(data.recording.note); setRecordingActive(data.recording.active); setPhase("aufnahme"); setStartedAt(Date.now()); if (data.recording.active) toast.success("Aufnahme läuft – jetzt den Einwilligungstext vorlesen."); else toast.warning(data.recording.note ?? "Keine Aufnahme möglich."); }, onError: (error) => toast.error(error.message) });
  const finish = trpc.leadops.finishVoiceOptIn.useMutation({ onSuccess: (data, variables) => { setPhase("fertig"); setResult({ status: data.status, number: String(data.id) }); setStartedAt(null); if (variables.cancel) toast("Abgebrochen – kein Opt-in gespeichert."); else if (data.status === "gueltig") toast.success("Opt-in gespeichert – gültig. Die Abschrift wird nach dem Auflegen geprüft."); else toast.warning("Opt-in gespeichert, aber unvollständig – bitte per SMS bestätigen lassen."); onDone?.(); }, onError: (error) => toast.error(error.message) });
  const steps: ScriptStep[] = script.data?.script.steps ?? [];
  const choices = script.data?.choices ?? []; const suggestions = script.data?.suggestions ?? [];
  const chosen = useMemo(() => choices.find((item) => item.buyerName === buyerName.trim()) ?? suggestions.find((item) => item.buyerName === buyerName.trim()) ?? null, [choices, suggestions, buyerName]);
  const existingValid = (script.data?.existing ?? []).find((row) => row.status === "gueltig" && row.grantedTo === "kaeufer");
  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  return <Dialog open={open} onOpenChange={(next) => { if (!next) { if (phase === "aufnahme" && optInId) { finish.mutate({ optInId, attest: { aufnahme: true, ja: false }, cancel: true }); } onClose(); } }}>
    <DialogContent className="opt-in-dialog">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Mic className="h-5 w-5" /> Opt-in aufnehmen{phase === "aufnahme" && <span className={`opt-in-rec ${recordingActive ? "is-live" : ""}`}>{recordingActive ? "● Aufnahme" : "keine Aufnahme"} {mmss}</span>}</DialogTitle><DialogDescription>Nur der Einwilligungsabschnitt wird aufgezeichnet. Erst fragen, dann aufnehmen – ein heimlicher Mitschnitt ist strafbar.</DialogDescription></DialogHeader>
      {script.data?.settings.missingCompany && <p className="opt-in-warning">Bitte zuerst unter Einstellungen → Opt-in den Firmennamen eintragen – er wird im Text vorgelesen.</p>}
      {existingValid && phase === "vorbereiten" && <p className="opt-in-hint">Für diesen Kontakt gibt es schon ein gültiges Opt-in{existingValid.buyerName ? ` für ${existingValid.buyerName}` : ""} ({existingValid.number}). Ein weiteres ist nur nötig, wenn ein anderer Fachbetrieb den Lead bekommt.</p>}
      {phase === "vorbereiten" && <>
        <label className="text-xs text-slate-400">Fachbetrieb, der genannt wird<input className="opt-in-input" list="opt-in-recorder-buyers" placeholder="Firma, Ort – leer lassen = Ersatzformulierung" value={buyerName} onChange={(event) => { setBuyerName(event.target.value); setTouched(true); }} /><datalist id="opt-in-recorder-buyers">{choices.map((choice) => <option key={`${choice.buyerUserId ?? ""}-${choice.buyerName}`} value={choice.buyerName} />)}</datalist></label>
        {suggestions.length > 0 && <small className="opt-in-hint">Laut Lieferkette bekommt den Lead voraussichtlich: {suggestions.slice(0, 3).map((item) => item.buyerName).join(" · ")}{buyerName.trim() ? "" : " – bitte oben eintragen"}</small>}
        {!buyerName.trim() && <small className="opt-in-hint is-warn">Ohne Firmennamen gilt die Ersatzformulierung („ein Fachbetrieb aus Ihrer Region“) – rechtlich die schwächere Variante. Dann hinterher die SMS-Bestätigung mit Firmennamen schicken.</small>}
        {steps[0] && <section className="opt-in-step is-current"><h4>{steps[0].title}</h4><p className="opt-in-read">{steps[0].text}</p><small>{steps[0].hint}</small></section>}
        <div className="flex flex-wrap items-center gap-2"><Button className="flux-button" disabled={start.isPending || script.isLoading || Boolean(script.data?.settings.missingCompany)} onClick={() => start.mutate({ publicId, dialerCallId, buyerName: buyerName.trim() || null, buyerUserId: chosen?.buyerUserId ?? null })}><Mic /> {start.isPending ? "Startet …" : "Kunde hat Ja gesagt → Aufnahme starten"}</Button><Button variant="ghost" onClick={onClose}>Abbrechen</Button></div>
        {!dialerCallId && <small className="opt-in-hint is-warn">Kein aktiver Anruf im App-Dialer – es kann nichts aufgezeichnet werden. Die Einwilligung lässt sich dann nur per SMS bestätigen.</small>}
      </>}
      {phase === "aufnahme" && <>
        {recordingNote && <p className="opt-in-warning">{recordingNote}</p>}
        {steps.slice(1).map((step) => <section key={step.key} className="opt-in-step is-current"><h4>{step.title}</h4><p className="opt-in-read">{step.text}</p><small>{step.hint}</small></section>)}
        <label className="opt-in-attest"><input type="checkbox" checked={attestJa} onChange={(event) => setAttestJa(event.target.checked)} />{attestJa ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}<span>Der Kunde hat auf die Einwilligung eindeutig <strong>„Ja“</strong> gesagt (kein „Mhm“).</span></label>
        <div className="flex flex-wrap items-center gap-2">
          <Button className="flux-button" disabled={finish.isPending || !optInId} onClick={() => optInId && finish.mutate({ optInId, attest: { aufnahme: true, ja: attestJa } })}><Square /> {finish.isPending ? "Speichert …" : attestJa ? "Aufnahme beenden & speichern" : "Beenden (ohne Ja – unvollständig)"}</Button>
          <Button variant="ghost" disabled={finish.isPending || !optInId} onClick={() => optInId && finish.mutate({ optInId, attest: { aufnahme: true, ja: false }, cancel: true })}><X /> Abbrechen – kein Opt-in</Button>
        </div>
      </>}
      {phase === "fertig" && result && <>
        <p className={`opt-in-result ${result.status === "gueltig" ? "is-ok" : result.status === "abgelehnt" ? "is-bad" : "is-warn"}`}>{result.status === "gueltig" ? "Gespeichert – Opt-in gültig. Nach dem Auflegen wird die Abschrift geprüft; das Ergebnis steht am Lead unter „Opt-in“." : result.status === "abgelehnt" ? "Abgebrochen – kein Opt-in." : "Gespeichert, aber unvollständig. Bitte die SMS-Bestätigung schicken (Lead → Opt-in)."}</p>
        <div className="flex gap-2"><Button className="flux-button" onClick={onClose}>Fertig</Button></div>
      </>}
      <small className="opt-in-hint">Status-Namen: {Object.values(OPT_IN_STATUS_LABEL).join(" · ")}. Nachweis mit Aufnahme, Abschrift-Stelle, Prüfsumme und PDF liegt danach am Lead.</small>
    </DialogContent>
  </Dialog>;
}
