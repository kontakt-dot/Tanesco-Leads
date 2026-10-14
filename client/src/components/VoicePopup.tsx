import { Mic, MicOff, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BROWSER_HINT, requestMicrophone, speechSupported, startRecognition, VOICE_MESSAGE, type VoiceSession } from "@/lib/voice";

/**
 * Kleines eigenes Fenster zum Einsprechen (?voice=TOKEN): nimmt mit der Spracherkennung des Browsers auf und schickt
 * den Text laufend an das Hauptfenster (postMessage). Wird gebraucht, wenn die App eingebettet läuft (Chat-Vorschau),
 * weil der Browser das Mikrofon dort im Rahmen sperrt.
 */
export default function VoicePopup({ token }: { token: string }) {
  const [state, setState] = useState<"bereit" | "läuft" | "fehler" | "fertig">("bereit");
  const [text, setText] = useState(""); const [interim, setInterim] = useState(""); const [error, setError] = useState<string | null>(null);
  const session = useRef<VoiceSession | null>(null);
  const send = (payload: { text: string; interim: string; done?: boolean; error?: string }) => { try { window.opener?.postMessage({ type: VOICE_MESSAGE, token, ...payload }, "*"); } catch { /* egal */ } };
  const start = async () => {
    setError(null);
    if (!speechSupported()) { setState("fehler"); setError(BROWSER_HINT); send({ text, interim: "", error: BROWSER_HINT }); return; }
    const mic = await requestMicrophone();
    if (mic === "denied") { const message = "Mikrofon nicht erlaubt – bitte in diesem Fenster die Freigabe erteilen (Schloss-Symbol in der Adresszeile)."; setState("fehler"); setError(message); return; }
    if (mic === "none") { const message = "Kein Mikrofon gefunden."; setState("fehler"); setError(message); send({ text, interim: "", error: message }); return; }
    session.current = startRecognition({
      onText: (full, live) => { setText(full); setInterim(live); send({ text: full, interim: live }); },
      onEnd: () => setState((current) => (current === "läuft" ? "bereit" : current)),
      onError: (message) => { setState("fehler"); setError(message); send({ text, interim: "", error: message }); },
    }, text);
    if (session.current) setState("läuft");
  };
  const stop = () => { session.current?.stop(); session.current = null; setState("bereit"); setInterim(""); };
  const finish = () => { session.current?.stop(); session.current = null; setState("fertig"); send({ text, interim: "", done: true }); window.setTimeout(() => window.close(), 400); };
  useEffect(() => { void start(); return () => session.current?.stop(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const noOpener = typeof window !== "undefined" && !window.opener;
  return <main className="voice-popup">
    <h1><Mic className="h-5 w-5" /> Einsprechen</h1>
    <p className="voice-popup-hint">{noOpener ? "Dieses Fenster gehört zu einer Notiz in Tanesco Leads. Bitte dort auf das Mikrofon klicken – dann öffnet es sich richtig." : state === "läuft" ? "Sprich jetzt – der Text erscheint gleichzeitig in der Notiz. Mit „Fertig“ schließt sich das Fenster." : state === "fehler" ? error : state === "fertig" ? "Übernommen – das Fenster schließt sich." : "Bereit. Auf das Mikrofon klicken, um aufzunehmen."}</p>
    <div className={`voice-popup-text ${state === "läuft" ? "is-live" : ""}`}>{text}{interim ? <span className="voice-popup-interim">{text ? " " : ""}{interim}</span> : null}{!text && !interim && <span className="voice-popup-placeholder">…</span>}</div>
    <div className="voice-popup-actions">
      {state === "läuft" ? <button type="button" className="voice-popup-mic active" onClick={stop} aria-label="Aufnahme anhalten"><MicOff className="h-6 w-6" /></button> : <button type="button" className="voice-popup-mic" onClick={() => void start()} aria-label="Aufnahme starten" disabled={state === "fertig"}><Mic className="h-6 w-6" /></button>}
      <button type="button" className="voice-popup-done" onClick={finish} disabled={state === "fertig"}><Check className="h-4 w-4" /> Fertig</button>
    </div>
  </main>;
}
