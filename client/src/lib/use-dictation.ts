import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BROWSER_HINT, DENIED_HINT, EMBEDDED_HINT, embedded, listenToVoiceWindow, microphoneBlockedByPolicy, openVoiceWindow, requestMicrophone, speechSupported, startRecognition, voiceToken, type VoiceSession } from "@/lib/voice";

export type DictationState = false | "lokal" | "fenster";
/**
 * Einsprechen in ein Textfeld (Spracherkennung des Browsers, Deutsch) – dieselbe Logik wie bei den Notizen an der Pipeline-Karte:
 * Mikrofon-Freigabe holen, dann erkennen; in eingebetteten Seiten (Chat-Vorschau) über ein kleines eigenes Fenster.
 * `value` ist der vorhandene Text, an den angehängt wird; `onChange` bekommt den vollständigen Text (fertige Sätze plus Zwischenstand).
 */
export function useDictation(value: string, onChange: (text: string) => void) {
  const [listening, setListening] = useState<DictationState>(false);
  const session = useRef<VoiceSession | { stop: () => void } | null>(null);
  const supported = speechSupported();
  useEffect(() => () => { session.current?.stop(); }, []);
  const stop = () => { session.current?.stop(); session.current = null; setListening(false); };
  const startVoiceWindow = () => {
    const token = voiceToken(); const popup = openVoiceWindow(token);
    if (!popup) { toast.error("Das Fenster zum Einsprechen wurde blockiert – bitte Pop-ups für diese Seite erlauben (Hinweis in der Adresszeile) und noch einmal auf das Mikrofon klicken. Tippen geht natürlich immer.", { duration: 10000 }); return; }
    toast(EMBEDDED_HINT, { duration: 6000 });
    session.current = listenToVoiceWindow(token, popup, { onText: (full, interim) => onChange(interim ? `${full}${full ? " " : ""}${interim}` : full), onClose: () => { session.current = null; setListening(false); }, onError: (message) => toast.error(message, { duration: 8000 }) });
    setListening("fenster");
  };
  const toggle = async () => {
    if (listening) { stop(); return; }
    if (!supported) { toast.error(BROWSER_HINT, { duration: 7000 }); return; }
    if (embedded() && microphoneBlockedByPolicy()) { startVoiceWindow(); return; } // synchron, damit das Fenster noch als Folge des Klicks gilt
    const mic = await requestMicrophone();
    if (mic === "none") { toast.error("Kein Mikrofon gefunden – bitte eins anschließen oder freigeben."); return; }
    if (mic === "denied") { if (embedded()) { startVoiceWindow(); return; } toast.error(DENIED_HINT, { duration: 8000 }); return; }
    const started = startRecognition({
      onText: (full, interim) => onChange(interim ? `${full}${full ? " " : ""}${interim}` : full),
      onEnd: () => setListening(false),
      onError: (message, code) => { setListening(false); session.current = null; if ((code === "not-allowed" || code === "service-not-allowed") && embedded()) startVoiceWindow(); else toast.error(message, { duration: 8000 }); },
    }, value);
    if (started) { session.current = started; setListening("lokal"); }
  };
  return { listening, supported, toggle, stop };
}
