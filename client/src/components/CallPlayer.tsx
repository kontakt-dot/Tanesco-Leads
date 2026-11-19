import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";
import { clock, previewLength as previewLengthOf } from "../../../shared/call-timeline";

/** Punkt auf dem Balken: eine Stelle im Gespräch (z. B. wo eine Prüffrage besprochen wird). */
export type PlayerMark = { at: number; label: string; tone: "gruen" | "gelb" | "rot" | "offen" };
export type CallPlayerHandle = { /** an eine Stelle springen (Sekunden) und – wenn gewünscht – gleich abspielen */ seek: (seconds: number, play?: boolean) => void };
const RATES = [1, 1.25, 1.5, 2];
const SKIP = 10;

/** Was der Abspieler von seiner Quelle braucht – die Aufnahme im Browser oder (in der Vorschau) nur eine Uhr. */
type Media = { currentTime: number; readonly duration: number; readonly paused: boolean; playbackRate: number; play: () => unknown; pause: () => void; load: () => void };
/** Vorschau ohne Aufnahme (Adresse „vorschau:<Sekunden>“): Dann läuft nur die Uhr – Spulen, Tempo und Zeiten arbeiten wie mit einer Aufnahme, nur ohne Ton. */
const TICK_MS = 250;
function previewClock(length: number, on: { time: (seconds: number) => void; play: () => void; pause: () => void }): Media & { stop: () => void } {
  let at = 0; let rate = 1; let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
  return {
    get currentTime() { return at; }, set currentTime(value: number) { at = Math.max(0, Math.min(length, value)); },
    get duration() { return length; }, get paused() { return timer === null; },
    get playbackRate() { return rate; }, set playbackRate(value: number) { rate = value; },
    play() { if (timer !== null) return; if (at >= length) at = 0; on.play(); timer = setInterval(() => { at = Math.min(length, at + (TICK_MS / 1000) * rate); on.time(at); if (at >= length) { stop(); on.pause(); } }, TICK_MS); },
    pause() { if (timer === null) return; stop(); on.pause(); },
    load() { /* nichts zu laden */ }, stop,
  };
}

/**
 * Abspieler für die Aufnahme eines Gesprächs: abspielen und anhalten, 10 Sekunden zurück und vor, Balken zum Ziehen, Tempo.
 * Auf dem Balken sitzen die Stellen des Gesprächs als Punkte. Scrollt man nach unten, bleibt eine kleine Leiste am Rand –
 * so lässt sich weiter anhalten und spulen, während man die Prüffragen liest.
 * Die Aufnahme wird erst geholt, wenn jemand sie anhören will (nicht schon beim Öffnen des Gesprächs).
 */
export const CallPlayer = forwardRef<CallPlayerHandle, { src: string; duration?: number | null; marks?: PlayerMark[]; /** Erklärung unter dem Balken, solange kein Punkt angefasst wird */ hint?: string; onPlay?: () => void; onTime?: (seconds: number) => void }>(function CallPlayer({ src, duration, marks = [], hint, onPlay, onTime }, ref) {
  const audio = useRef<HTMLAudioElement>(null); const box = useRef<HTMLDivElement>(null);
  const previewLength = previewLengthOf(src); const preview = previewLength > 0;
  const ticker = useRef<ReturnType<typeof previewClock> | null>(null);
  const media = useCallback((): Media | null => (preview ? ticker.current : audio.current), [preview]);
  const [time, setTime] = useState(0); const [length, setLength] = useState(preview ? previewLength : duration && duration > 0 ? duration : 0);
  const [playing, setPlaying] = useState(false); const [rate, setRate] = useState(1); const [failed, setFailed] = useState(false); const [loading, setLoading] = useState(false);
  const [away, setAway] = useState(false); const [used, setUsed] = useState(false); const [docked, setDocked] = useState(true); const [pointed, setPointed] = useState<PlayerMark | null>(null);
  // Die Rückrufe der Seite wechseln mit jedem Zeichnen – der Abspieler merkt sich immer die neuesten, ohne deshalb neu zu starten
  const listeners = useRef({ onPlay, onTime }); listeners.current = { onPlay, onTime };
  const tellTime = useCallback((seconds: number) => { setTime(seconds); listeners.current.onTime?.(seconds); }, []);
  const tellPlay = useCallback(() => { setPlaying(true); setFailed(false); listeners.current.onPlay?.(); }, []);
  const tellPause = useCallback(() => { setPlaying(false); setLoading(false); }, []);

  useEffect(() => { if (!preview && duration && duration > 0) setLength((current) => current || duration); }, [duration, preview]);
  useEffect(() => { setTime(0); setPlaying(false); setFailed(false); setLoading(false); setUsed(false); setRate(1); }, [src]); // neue Aufnahme: von vorn, im normalen Tempo
  // Vorschau: statt einer Aufnahme läuft eine Uhr
  useEffect(() => {
    if (!preview) { ticker.current = null; return; }
    const next = previewClock(previewLength, { time: tellTime, play: tellPlay, pause: tellPause }); ticker.current = next; setLength(previewLength);
    return () => { next.stop(); if (ticker.current === next) ticker.current = null; };
  }, [preview, previewLength, src, tellTime, tellPlay, tellPause]);
  // Liegt der Abspieler außerhalb des sichtbaren Bereichs? Dann zeigt sich die kleine Leiste am unteren Rand.
  useEffect(() => { const node = box.current; if (!node || typeof IntersectionObserver === "undefined") return; const observer = new IntersectionObserver((entries) => setAway(!entries[0]?.isIntersecting), { threshold: 0.2 }); observer.observe(node); return () => observer.disconnect(); }, []);

  const start = useCallback(() => {
    const element = media(); if (!element) return; setUsed(true); setDocked(true);
    if (element.playbackRate !== rate) element.playbackRate = rate; // nach einem neuen Laden steht das Tempo sonst wieder auf 1
    if (!preview && (audio.current?.readyState ?? 0) < 3) setLoading(true); // die Aufnahme wird erst jetzt geholt – das dauert beim ersten Mal einen Moment
    try { const result = element.play() as Promise<void> | undefined; if (result && typeof result.catch === "function") result.catch(() => undefined); } catch { /* ohne Tonausgabe (z. B. im Test) */ }
  }, [media, preview, rate]);
  const seek = useCallback((seconds: number, play = false) => {
    const element = media(); if (!element) return;
    const end = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : length > 0 ? length : seconds;
    const next = Math.max(0, Math.min(end, seconds));
    try { element.currentTime = next; } catch { /* noch nichts geladen – die Stelle gilt, sobald die Aufnahme da ist */ }
    setUsed(true); tellTime(next); if (play) start();
  }, [length, media, start, tellTime]);
  useImperativeHandle(ref, () => ({ seek }), [seek]);
  const toggle = () => { const element = media(); if (!element) return; if (element.paused) start(); else element.pause(); };
  const speed = () => { const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]; setRate(next); const element = media(); if (element) element.playbackRate = next; };
  const retry = () => { setFailed(false); media()?.load(); start(); };
  // Tasten auf dem Balken: Pfeile springen 5 Sekunden, Pos1/Ende an Anfang und Schluss, Leertaste spielt ab oder hält an
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -5 : event.key === "ArrowRight" || event.key === "ArrowUp" ? 5 : 0;
    if (step) { event.preventDefault(); seek(time + step); } else if (event.key === "Home") { event.preventDefault(); seek(0); } else if (event.key === "End") { event.preventDefault(); seek(length); } else if (event.key === " ") { event.preventDefault(); toggle(); }
  };

  const share = length > 0 ? Math.max(0, Math.min(100, (time / length) * 100)) : 0;
  const shown = marks.filter((mark) => mark.at >= 0 && (length <= 0 || mark.at <= length));
  const playLabel = loading ? "Die Aufnahme wird geholt – anhalten" : playing ? "Anhalten" : "Abspielen";
  const buttons = <>
    <button type="button" className="gq-skip" aria-label={`${SKIP} Sekunden zurück`} title={`${SKIP} Sekunden zurück`} onClick={() => seek(time - SKIP)}><RotateCcw aria-hidden="true" /><span aria-hidden="true">{SKIP}</span></button>
    <button type="button" className={`gq-play ${playing ? "is-playing" : ""} ${loading ? "is-loading" : ""}`} aria-label={playLabel} aria-busy={loading || undefined} title={playLabel} onClick={toggle}>{playing || loading ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
    <button type="button" className="gq-skip" aria-label={`${SKIP} Sekunden vor`} title={`${SKIP} Sekunden vor`} onClick={() => seek(time + SKIP)}><RotateCw aria-hidden="true" /><span aria-hidden="true">{SKIP}</span></button>
    <span className="gq-clock" aria-live="off"><b>{clock(time)}</b> / {length > 0 ? clock(length) : "–:––"}</span>
  </>;
  const bar = (withMarks: boolean) => <div className="gq-scrub" style={{ "--fill": `${share}%` } as CSSProperties}>
    <input type="range" min={0} max={length > 0 ? length : 1} step={1} value={Math.round(Math.min(time, length > 0 ? length : time))} disabled={length <= 0} aria-label="Stelle in der Aufnahme" aria-valuetext={`${clock(time)} von ${clock(length)}`} onChange={(event) => seek(Number(event.target.value))} onKeyDown={onKey} />
    {withMarks && length > 0 && shown.map((mark, index) => <button key={`${mark.at}-${index}`} type="button" className={`gq-scrub-mark is-${mark.tone}`} style={{ left: `${(mark.at / length) * 100}%` }} aria-label={`Zu ${clock(mark.at)} springen: ${mark.label}`} onClick={() => seek(mark.at, true)} onMouseEnter={() => setPointed(mark)} onMouseLeave={() => setPointed((current) => (current === mark ? null : current))} onFocus={() => setPointed(mark)} onBlur={() => setPointed((current) => (current === mark ? null : current))} />)}
  </div>;
  const dock = away && used && docked && typeof document !== "undefined" ? createPortal(<div className="gq-player-dock" role="group" aria-label="Aufnahme">
    {buttons}{bar(false)}
    <button type="button" className="gq-dock-close" aria-label="Leiste schließen und anhalten" title="Schließen" onClick={() => { media()?.pause(); setDocked(false); }}><X aria-hidden="true" /></button>
  </div>, document.body) : null;
  // Zeile unter dem Balken: der angefasste Punkt mit Zeit und Thema – sonst, was gerade geschieht, oder die Erklärung der Punkte
  const line = pointed ? <><b>{clock(pointed.at)}</b> {pointed.label}</> : loading ? "Die Aufnahme wird geholt – einen Moment …" : shown.length > 0 && length > 0 ? hint ?? null : null;

  return <div ref={box} className={`gq-player-ui ${failed ? "is-failed" : ""}`}>
    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
    {!preview && <audio ref={audio} src={src} preload="none" onTimeUpdate={(event) => tellTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => { const total = event.currentTarget.duration; if (Number.isFinite(total) && total > 0) setLength(total); }} onDurationChange={(event) => { const total = event.currentTarget.duration; if (Number.isFinite(total) && total > 0) setLength(total); }} onPlay={tellPlay} onPlaying={() => setLoading(false)} onCanPlay={() => setLoading(false)} onWaiting={() => setLoading(true)} onPause={tellPause} onEnded={tellPause} onError={() => { setPlaying(false); setLoading(false); setFailed(true); }} />}
    <div className="gq-player-row">{buttons}<button type="button" className="gq-rate" aria-label={`Tempo: ${String(rate).replace(".", ",")}-fach – ändern`} title="Tempo ändern" onClick={speed}>{String(rate).replace(".", ",")}×</button></div>
    {bar(true)}
    {line && !failed && <p className={`gq-scrub-hint ${pointed ? "is-point" : ""}`} aria-live="polite">{line}</p>}
    {failed && <p className="gq-player-error" role="alert">Die Aufnahme ließ sich nicht laden. <button type="button" className="gq-link" onClick={retry}>Noch einmal versuchen</button></p>}
    {dock}
  </div>;
});
