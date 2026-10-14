import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Mic, MicOff, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BROWSER_HINT, DENIED_HINT, EMBEDDED_HINT, embedded, listenToVoiceWindow, microphoneBlockedByPolicy, openVoiceWindow, requestMicrophone, speechSupported, startRecognition, voiceToken, type VoiceSession } from "@/lib/voice";

const stamp = (value: Date | string) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Notizen an einer Pipeline-Karte – tippen oder einsprechen (Spracherkennung des Browsers, Deutsch). */
export default function PipelineNotes({ publicId, onChanged, compact }: { publicId: string; onChanged?: () => void; compact?: boolean }) {
  const notes = trpc.leadops.listPipelineNotes.useQuery({ publicId }, { retry: false });
  const utils = trpc.useUtils();
  const add = trpc.leadops.addPipelineNote.useMutation({ onSuccess: () => { setText(""); utils.leadops.listPipelineNotes.invalidate({ publicId }); onChanged?.(); }, onError: (error) => toast.error(error.message) });
  const remove = trpc.leadops.deletePipelineNote.useMutation({ onSuccess: () => { utils.leadops.listPipelineNotes.invalidate({ publicId }); onChanged?.(); }, onError: (error) => toast.error(error.message) });
  const [text, setText] = useState(""); const [listening, setListening] = useState<false | "lokal" | "fenster">(false); const [spoken, setSpoken] = useState(false);
  const session = useRef<VoiceSession | { stop: () => void } | null>(null); const supported = speechSupported();
  useEffect(() => () => { session.current?.stop(); }, []);
  const stopVoice = () => { session.current?.stop(); session.current = null; setListening(false); };
  /** Spracheingabe: Mikrofon-Freigabe holen, dann Erkennung – in eingebetteten Seiten über ein kleines eigenes Fenster. */
  const toggleVoice = async () => {
    if (listening) { stopVoice(); return; }
    if (!supported) { toast.error(BROWSER_HINT, { duration: 7000 }); return; }
    if (embedded() && microphoneBlockedByPolicy()) { startVoiceWindow(); return; } // synchron, damit das Fenster noch als Folge des Klicks gilt
    const mic = await requestMicrophone();
    if (mic === "none") { toast.error("Kein Mikrofon gefunden – bitte eins anschließen oder freigeben."); return; }
    if (mic === "denied") { if (embedded()) { startVoiceWindow(); return; } toast.error(DENIED_HINT, { duration: 8000 }); return; }
    const started = startRecognition({
      onText: (full, interim) => { setText(interim ? `${full}${full ? " " : ""}${interim}` : full); setSpoken(true); },
      onEnd: () => setListening(false),
      onError: (message, code) => { setListening(false); session.current = null; if ((code === "not-allowed" || code === "service-not-allowed") && embedded()) startVoiceWindow(); else toast.error(message, { duration: 8000 }); },
    }, text);
    if (started) { session.current = started; setListening("lokal"); }
  };
  const startVoiceWindow = () => {
    const token = voiceToken(); const popup = openVoiceWindow(token);
    if (!popup) { toast.error("Das Fenster zum Einsprechen wurde blockiert – bitte Pop-ups für diese Seite erlauben (Hinweis in der Adresszeile) und noch einmal auf das Mikrofon klicken. Tippen geht natürlich immer.", { duration: 10000 }); return; }
    toast(EMBEDDED_HINT, { duration: 6000 });
    session.current = listenToVoiceWindow(token, popup, { onText: (full, interim) => { setText(interim ? `${full}${full ? " " : ""}${interim}` : full); setSpoken(true); }, onClose: () => { session.current = null; setListening(false); }, onError: (message) => toast.error(message, { duration: 8000 }) });
    setListening("fenster");
  };
  const submit = () => { const value = text.trim(); if (!value) return; stopVoice(); add.mutate({ publicId, text: value, source: spoken ? "sprache" : "text" }); setSpoken(false); };
  return <div className={`pipeline-notes ${compact ? "is-compact" : ""}`}>{!compact && <div className="flex items-center justify-between gap-2"><span className="eyebrow">NOTIZEN</span><small className="text-slate-500">{(notes.data ?? []).length} Einträge</small></div>}
    <div className={`pipeline-note-input ${listening ? "is-listening" : ""}`}><textarea value={text} rows={2} placeholder={listening === "fenster" ? "Sprich im kleinen Fenster – der Text landet hier …" : listening ? "Sprich jetzt … (Stopp mit dem Mikrofon)" : "Notiz tippen oder einsprechen …"} onChange={(event) => { setText(event.target.value); setSpoken(false); }} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(); }} /><div className="pipeline-note-actions"><button type="button" className={`note-mic ${listening ? "active" : ""}`} title={supported ? (listening ? "Aufnahme beenden" : "Einsprechen (Mikrofon)") : BROWSER_HINT} aria-pressed={Boolean(listening)} onClick={() => void toggleVoice()}>{listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}</button><Button size="sm" className="flux-button" disabled={!text.trim() || add.isPending} onClick={submit}><Send /> Speichern</Button></div></div>
    <ul className="pipeline-note-list">{(notes.data ?? []).map((note) => <li key={note.id} className={note.source === "gespraech" ? "is-auto" : ""}><p>{note.text}</p><small>{stamp(note.createdAt)} · {note.author}{note.source === "sprache" ? " · 🎤" : note.source === "gespraech" ? " · automatisch aus dem Gespräch" : ""}<button type="button" aria-label="Notiz löschen" onClick={() => remove.mutate({ id: note.id })}><Trash2 className="h-3 w-3" /></button></small></li>)}{notes.data && !notes.data.length && <li className="pipeline-note-empty">Noch keine Notiz.</li>}</ul></div>;
}
