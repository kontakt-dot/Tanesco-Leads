/**
 * Spracheingabe (Diktat) für Notizen – Spracherkennung des Browsers (Chrome, Edge, Safari) mit:
 *  - sauberer Mikrofon-Freigabe (getUserMedia zuerst, damit der Browser wirklich fragt),
 *  - Weiterlaufen nach Sprechpausen (Chrome beendet die Erkennung sonst nach kurzer Stille),
 *  - verständlichen Fehlermeldungen,
 *  - Ausweg für eingebettete Seiten (Chat-Vorschau): dort sperrt der Browser das Mikrofon im Rahmen – ein kleines
 *    eigenes Fenster (eigenständige Seite, in ein leeres Fenster geschrieben) nimmt auf und schickt den Text per
 *    postMessage zurück. Die App-Route ?voice=… bleibt als Ausweg, falls das Fenster nicht beschrieben werden darf.
 */
type Recognition = { lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number; onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null; onstart: (() => void) | null; start: () => void; stop: () => void; abort: () => void };
const recognitionClass = (): (new () => Recognition) | null => { if (typeof window === "undefined") return null; const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }; return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null; };

export const speechSupported = () => Boolean(recognitionClass());
export const embedded = () => { try { return window.self !== window.top; } catch { return true; } };
export const isIOS = () => typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
export const BROWSER_HINT = "Spracheingabe braucht Chrome, Edge oder Safari – Firefox kann das nicht.";
export const DENIED_HINT = "Mikrofon nicht erlaubt – bitte den Zugriff im Browser freigeben (Schloss-Symbol in der Adresszeile → Mikrofon → Zulassen) und es noch einmal versuchen.";
export const EMBEDDED_HINT = "In der eingebetteten Vorschau sperrt der Browser das Mikrofon. Zum Einsprechen geht ein kleines Fenster auf – dort einmal die Freigabe erteilen.";

export type MicState = "ok" | "denied" | "none" | "unsupported";
/** Mikrofon-Freigabe holen (zeigt die Browser-Abfrage) – danach sofort wieder freigeben. */
export async function requestMicrophone(): Promise<MicState> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return "unsupported";
  try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((track) => track.stop()); return "ok"; }
  catch (error) { const name = (error as { name?: string } | null)?.name ?? ""; if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "none"; if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError" || name === "NotReadableError") return "denied"; return "unsupported"; }
}

export type VoiceSession = { stop: () => void };
export type VoiceHandlers = { onText: (text: string, interim: string) => void; onEnd: () => void; onError: (message: string, code: string) => void };
/** Erkennung starten; `seed` ist vorhandener Text, an den angehängt wird. Läuft weiter, bis stop() aufgerufen wird. */
export function startRecognition(handlers: VoiceHandlers, seed = ""): VoiceSession | null {
  const Ctor = recognitionClass(); if (!Ctor) { handlers.onError(BROWSER_HINT, "unsupported"); return null; }
  let active = true; let finalText = seed; let restarts = 0; let current: Recognition | null = null;
  const join = (a: string, b: string) => `${a}${a && !/\s$/.test(a) && b ? " " : ""}${b}`;
  const spin = () => {
    const rec = new Ctor(); current = rec; rec.lang = "de-DE"; rec.continuous = !isIOS(); rec.interimResults = true; rec.maxAlternatives = 1; let sessionFinal = "";
    rec.onresult = (event) => { let interim = ""; for (let i = event.resultIndex; i < event.results.length; i += 1) { const result = event.results[i]; const transcript = (result[0]?.transcript ?? "").trim(); if (!transcript) continue; if (result.isFinal) sessionFinal = join(sessionFinal, transcript); else interim = join(interim, transcript); } handlers.onText(join(finalText, sessionFinal), interim); };
    rec.onerror = (event) => {
      const code = event.error;
      if (code === "no-speech" || code === "aborted") return; // Stille oder Stopp → kein Fehler
      active = false;
      handlers.onError(code === "not-allowed" || code === "service-not-allowed" ? (embedded() ? EMBEDDED_HINT : DENIED_HINT) : code === "audio-capture" ? "Kein Mikrofon gefunden – bitte eins anschließen oder freigeben." : code === "network" ? "Die Spracherkennung braucht eine Internetverbindung." : code === "language-not-supported" ? "Deutsch wird von dieser Spracherkennung nicht unterstützt." : `Spracheingabe: ${code}`, code);
    };
    rec.onend = () => { finalText = join(finalText, sessionFinal); sessionFinal = ""; if (!active) { handlers.onEnd(); return; } if (restarts > 200) { active = false; handlers.onEnd(); return; } restarts += 1; try { spin(); } catch { active = false; handlers.onEnd(); } }; // Chrome beendet nach Stille – nahtlos weiter
    rec.start();
  };
  try { spin(); } catch { handlers.onError(DENIED_HINT, "start"); return null; }
  return { stop: () => { active = false; try { current?.stop(); } catch { /* egal */ } } };
}

/* ---- Ausweg für eingebettete Seiten: eigenes kleines Fenster nimmt auf und schickt den Text zurück ---- */
export const VOICE_MESSAGE = "tanesco-voice";
export type VoiceMessage = { type: typeof VOICE_MESSAGE; token: string; text?: string; interim?: string; done?: boolean; error?: string };
export const voiceToken = () => Math.random().toString(36).slice(2, 10);
export function voiceWindowUrl(token: string) { const url = new URL(window.location.href); url.hash = ""; url.searchParams.set("voice", token); return url.toString(); }
/** Sperrt die Berechtigungsrichtlinie des Rahmens das Mikrofon? (Chrome/Edge sagen das synchron – wichtig, damit das Fenster noch als Folge des Klicks aufgeht.) */
export function microphoneBlockedByPolicy(): boolean {
  try { const doc = document as unknown as { permissionsPolicy?: { allowsFeature: (feature: string) => boolean }; featurePolicy?: { allowsFeature: (feature: string) => boolean } }; const policy = doc.permissionsPolicy ?? doc.featurePolicy; return policy ? !policy.allowsFeature("microphone") : false; } catch { return false; }
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
/** Eigenständige Seite für das Sprachfenster – ohne App-URL, ohne Netz: wird direkt in ein leeres Fenster geschrieben. */
export function voicePopupHtml(token: string) {
  const script = `(function(){var token=${JSON.stringify(token)};var DENIED=${JSON.stringify(DENIED_HINT)};var BROWSER=${JSON.stringify(BROWSER_HINT)};
var opener=window.opener;function send(m){try{if(opener&&!opener.closed)opener.postMessage(Object.assign({type:"tanesco-voice",token:token},m),"*");}catch(e){}}
var $=function(id){return document.getElementById(id)};var box=$("text"),hint=$("hint"),mic=$("mic"),done=$("done");
function status(msg,bad){hint.textContent=msg;hint.className=bad?"hint bad":"hint";}
var isIOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
var Ctor=window.SpeechRecognition||window.webkitSpeechRecognition;
var finalText="",sessionFinal="",active=false,restarts=0,current=null;
function join(a,b){return a+(a&&!/\s$/.test(a)&&b?" ":"")+b}
function render(full,interim){box.innerHTML="";box.appendChild(document.createTextNode(full));if(interim){var i=document.createElement("span");i.className="interim";i.textContent=(full?" ":"")+interim;box.appendChild(i);}if(!full&&!interim){var p=document.createElement("span");p.className="placeholder";p.textContent="…";box.appendChild(p);}}
function setLive(on){box.className=on?"text live":"text";mic.className=on?"mic active":"mic";mic.setAttribute("aria-label",on?"Aufnahme anhalten":"Aufnahme starten");mic.innerHTML=on?"&#9632;":"&#127908;";}
function spin(){var rec=new Ctor();current=rec;rec.lang="de-DE";rec.continuous=!isIOS;rec.interimResults=true;rec.maxAlternatives=1;sessionFinal="";
rec.onresult=function(ev){var interim="";for(var i=ev.resultIndex;i<ev.results.length;i++){var r=ev.results[i];var t=((r[0]&&r[0].transcript)||"").trim();if(!t)continue;if(r.isFinal)sessionFinal=join(sessionFinal,t);else interim=join(interim,t);}var full=join(finalText,sessionFinal);render(full,interim);send({text:full,interim:interim});};
rec.onerror=function(ev){var code=ev.error;if(code==="no-speech"||code==="aborted")return;active=false;setLive(false);var msg=code==="not-allowed"||code==="service-not-allowed"?DENIED:code==="audio-capture"?"Kein Mikrofon gefunden – bitte eins anschließen oder freigeben.":code==="network"?"Die Spracherkennung braucht eine Internetverbindung.":code==="language-not-supported"?"Deutsch wird von dieser Spracherkennung nicht unterstützt.":"Spracheingabe: "+code;status(msg,true);send({text:join(finalText,sessionFinal),interim:"",error:msg});};
rec.onend=function(){finalText=join(finalText,sessionFinal);sessionFinal="";if(!active){setLive(false);return;}if(restarts>200){active=false;setLive(false);return;}restarts+=1;try{spin();}catch(e){active=false;setLive(false);}};
rec.start();}
function start(){if(!Ctor){status(BROWSER,true);send({text:"",interim:"",error:BROWSER});return;}active=true;restarts=0;setLive(true);status("Sprich jetzt – der Text erscheint gleichzeitig in der Notiz. Mit „Fertig“ schließt sich das Fenster.");try{spin();}catch(e){active=false;setLive(false);status(DENIED,true);}}
function pause(){active=false;try{if(current)current.stop();}catch(e){}setLive(false);status("Angehalten. Auf das Mikrofon klicken, um weiter einzusprechen.");}
var finished=false;function finish(){if(finished)return;finished=true;active=false;try{if(current)current.stop();}catch(e){}send({text:join(finalText,sessionFinal),interim:"",done:true});status("Übernommen – das Fenster schließt sich.");setTimeout(function(){window.close();},300);}
mic.onclick=function(){if(active)pause();else start();};done.onclick=finish;
window.addEventListener("beforeunload",function(){if(!finished){finished=true;send({text:join(finalText,sessionFinal),interim:"",done:true});}});
render("","");
if(!opener){status("Dieses Fenster gehört zu einer Notiz in Tanesco Leads – bitte dort auf das Mikrofon klicken.",true);return;}
if(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){status("Bitte die Mikrofon-Freigabe erteilen …");navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){stream.getTracks().forEach(function(t){t.stop();});start();}).catch(function(err){var name=(err&&err.name)||"";var msg=name==="NotFoundError"||name==="DevicesNotFoundError"||name==="OverconstrainedError"?"Kein Mikrofon gefunden – bitte eins anschließen oder freigeben.":"Mikrofon nicht erlaubt – bitte in diesem Fenster die Freigabe erteilen (Schloss-Symbol in der Adresszeile) und dann auf das Mikrofon klicken.";status(msg,true);send({text:"",interim:"",error:msg});});}else start();
})();`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Einsprechen – Tanesco Leads</title><style>
html,body{margin:0;background:#0f1117;color:#f1effe;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{min-height:100vh;display:flex;flex-direction:column;gap:14px;padding:22px 20px;box-sizing:border-box}
h1{display:flex;align-items:center;gap:8px;margin:0;font-size:18px;font-weight:800;color:#fff}
.hint{margin:0;font-size:13px;line-height:1.5;color:#a5a1d7}.hint.bad{color:#fca5a5}
.text{flex:1;min-height:180px;padding:12px 14px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:#181530;white-space:pre-wrap;word-break:break-word}
.text.live{border-color:rgba(248,113,113,.6);box-shadow:0 0 0 3px rgba(248,113,113,.15)}.interim{color:#a5a1d7}.placeholder{color:#55517c}
.actions{display:flex;align-items:center;justify-content:space-between;gap:12px}
.mic{width:56px;height:56px;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:#241f4a;color:#fff;font-size:24px;cursor:pointer}
.mic.active{background:#dc2626;border-color:#f87171;animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(248,113,113,.45)}50%{box-shadow:0 0 0 10px rgba(248,113,113,0)}}
.done{height:40px;padding:0 18px;border-radius:999px;border:0;background:#7c6cff;color:#fff;font-weight:700;font-size:14px;cursor:pointer}.done:hover{background:#8f82ff}
</style></head><body><main><h1>🎤 Einsprechen</h1><p id="hint" class="hint">Bereit.</p><div id="text" class="text"></div><div class="actions"><button id="mic" class="mic" type="button" aria-label="Aufnahme starten">&#127908;</button><button id="done" class="done" type="button">✓ Fertig</button></div><p class="hint">${escapeHtml("Dein Browser sperrt das Mikrofon in der eingebetteten Vorschau – deshalb dieses Fenster. Die Spracherkennung läuft im Browser (Deutsch).")}</p></main><script>${script}</script></body></html>`;
}
/** Sprachfenster öffnen: leeres Fenster + eigene Seite hinein (braucht keine App-URL, geht auch in der Chat-Vorschau); Ausweg: App-URL mit ?voice=. */
export function openVoiceWindow(token: string): Window | null {
  let popup: Window | null = null;
  try { popup = window.open("", `tanesco-voice-${token}`, "popup=yes,width=460,height=600"); } catch { return null; }
  if (!popup) return null;
  try { popup.document.open(); popup.document.write(voicePopupHtml(token)); popup.document.close(); }
  catch { try { popup.location.href = voiceWindowUrl(token); } catch { /* egal */ } }
  return popup;
}
/** Im Hauptfenster: auf Text aus dem Sprachfenster hören. */
export function listenToVoiceWindow(token: string, popup: Window, handlers: { onText: (text: string, interim: string) => void; onClose: () => void; onError: (message: string) => void }) {
  let closed = false;
  const onMessage = (event: MessageEvent) => { const data = event.data as VoiceMessage | null; if (!data || data.type !== VOICE_MESSAGE || data.token !== token) return; if (data.error) handlers.onError(data.error); else if (typeof data.text === "string") handlers.onText(data.text, data.interim ?? ""); if (data.done) finish(); };
  const timer = window.setInterval(() => { if (popup.closed) finish(); }, 500);
  const finish = () => { if (closed) return; closed = true; window.removeEventListener("message", onMessage); window.clearInterval(timer); handlers.onClose(); };
  window.addEventListener("message", onMessage);
  return { stop: () => { try { if (!popup.closed) popup.close(); } catch { /* egal */ } finish(); } };
}
