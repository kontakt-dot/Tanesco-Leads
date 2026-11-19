import { useId } from "react";
import { moodOf, type Mood } from "../../../shared/call-overview";

export { moodOf, type Mood };
/** Ampel statt Punkte: grün 🙂 = passt (freigegeben / verkaufbar), gelb 😐 = reinhören (zur Prüfung / nachfassen / unklar), rot 🙁 = passt nicht (zurückgewiesen / nicht verkaufbar), grau = noch nicht bewertet. */
export const MOOD: Record<Mood, { label: string; hint: string; cls: string; color: string }> = {
  gruen: { label: "Passt", hint: "Grün: Gespräch passt – alle Vorgaben erfüllt bzw. freigegeben.", cls: "is-gruen", color: "#16a34a" },
  gelb: { label: "Reinhören", hint: "Orange: Unklar – bitte selbst reinhören und entscheiden.", cls: "is-gelb", color: "#f97316" },
  rot: { label: "Passt nicht", hint: "Rot: Vorgabe nicht erfüllt bzw. zurückgewiesen.", cls: "is-rot", color: "#dc2626" },
  offen: { label: "Noch nicht bewertet", hint: "Grau: Noch keine Bewertung – Aufnahme wird noch geholt oder ausgewertet.", cls: "is-offen", color: "#94a3b8" },
};
/**
 * Smiley als Kugel in der Ampelfarbe: Verlauf von hell nach kräftig, Glanz oben, weißes Gesicht mit eigenem Ausdruck –
 * Grün lacht, Orange schaut abwartend, Rot ist enttäuscht, Grau wartet (drei Punkte). Die Mimik unterscheidet die Ampel auch ohne Farbe.
 */
export const FACE_COLOR: Record<Mood, string> = { gruen: "#16a34a", gelb: "#f97316", rot: "#dc2626", offen: "#94a3b8" };
/** Kugel: heller Ton oben links, Ampelfarbe, tiefer Ton unten rechts. */
const ORB: Record<Mood, { hi: string; mid: string; lo: string }> = {
  gruen: { hi: "#7bea9f", mid: "#22c55e", lo: "#15803d" },
  gelb: { hi: "#ffc98a", mid: "#f97316", lo: "#c2410c" },
  rot: { hi: "#ff9a94", mid: "#ef4444", lo: "#b91c1c" },
  offen: { hi: "#e6eaf1", mid: "#a9b4c5", lo: "#77839a" },
};
/** Gesicht auf einem 48er-Raster; `detail` zeichnet ab mittlerer Größe die Augenbrauen mit. */
function Features({ mood, detail }: { mood: Mood; detail: boolean }) {
  if (mood === "offen") return <><circle cx="15" cy="24" r="2.9" stroke="none" /><circle cx="24" cy="24" r="2.9" stroke="none" /><circle cx="33" cy="24" r="2.9" stroke="none" /></>;
  if (mood === "gruen") return <><path d="M13.4 21.6 Q17 16.4 20.6 21.6" fill="none" strokeWidth="3.3" strokeLinecap="round" /><path d="M27.4 21.6 Q31 16.4 34.6 21.6" fill="none" strokeWidth="3.3" strokeLinecap="round" /><path d="M13.6 26.4 Q24 29.6 34.4 26.4 Q33 37 24 37 Q15 37 13.6 26.4 Z" stroke="none" /></>;
  if (mood === "gelb") return <><circle cx="16.8" cy="20.2" r="3" stroke="none" /><circle cx="31.2" cy="20.2" r="3" stroke="none" /><path d="M16.2 31.8 L31.8 30.2" fill="none" strokeWidth="3.4" strokeLinecap="round" /></>;
  return <>{detail && <><path d="M12.6 18.4 L19.6 15.6" fill="none" strokeWidth="2.7" strokeLinecap="round" /><path d="M35.4 18.4 L28.4 15.6" fill="none" strokeWidth="2.7" strokeLinecap="round" /></>}<circle cx="16.8" cy="22.4" r="3" stroke="none" /><circle cx="31.2" cy="22.4" r="3" stroke="none" /><path d="M15.4 35 Q24 27 32.6 35" fill="none" strokeWidth="3.4" strokeLinecap="round" /></>;
}
/** Die Kugel selbst – Mittelpunkt 24/24, Radius `r`. Jede Kugel bringt ihre Verläufe mit eigener Kennung mit (mehrere Smileys auf einer Seite). */
function Orb({ mood, r, detail }: { mood: Mood; r: number; detail: boolean }) {
  const id = `cq${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`; const { hi, mid, lo } = ORB[mood]; const scale = r / 21.5;
  return <>
    <defs>
      <linearGradient id={`${id}a`} x1="0.18" y1="0.08" x2="0.82" y2="0.96"><stop offset="0" stopColor={hi} /><stop offset=".5" stopColor={mid} /><stop offset="1" stopColor={lo} /></linearGradient>
      <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".62" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
      <radialGradient id={`${id}c`} cx=".5" cy=".42" r=".62"><stop offset=".62" stopColor={lo} stopOpacity="0" /><stop offset="1" stopColor={lo} stopOpacity=".55" /></radialGradient>
    </defs>
    <g className="cq-orb">
      <circle cx="24" cy="24" r={r} fill={`url(#${id}a)`} />
      <circle cx="24" cy="24" r={r} fill={`url(#${id}c)`} />
      <ellipse cx="24" cy={(24 - r * 0.46).toFixed(2)} rx={(r * 0.66).toFixed(2)} ry={(r * 0.4).toFixed(2)} fill={`url(#${id}b)`} />
      <g transform={`translate(24 24) scale(${scale.toFixed(3)}) translate(-24 -24)`}>
        <g transform="translate(0 1.1)" fill={lo} stroke={lo} opacity=".45"><Features mood={mood} detail={detail} /></g>
        <g fill="#fff" stroke="#fff"><Features mood={mood} detail={detail} /></g>
      </g>
    </g>
  </>;
}
export function Face({ mood, size = 44 }: { mood: Mood; size?: number }) {
  return <svg className={`cq-face is-${mood}`} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><Orb mood={mood} r={21.5} detail={size >= 30} /></svg>;
}
/**
 * Smiley im Ring (Gesprächsliste): Der Ring zeigt, wie viele der entscheidenden Prüffragen erfüllt sind – voll = alles erfüllt.
 * Ohne Prüffragen ist der Ring voll in der Ampelfarbe; „noch nicht bewertet“ zeigt einen leeren Ring mit drei Punkten.
 */
export function MoodRing({ mood, percent, size = 46 }: { mood: Mood; percent: number | null; size?: number }) {
  const c = ORB[mood].mid; const r = 21; const length = 2 * Math.PI * r; const share = mood === "offen" ? 0 : percent === null ? 1 : Math.max(0.04, Math.min(1, percent / 100));
  return <svg className={`cq-ring is-${mood}`} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <circle className="cq-ring-track" cx="24" cy="24" r={r} fill="none" strokeWidth="3.2" />
    {share > 0 && <circle className="cq-ring-share" cx="24" cy="24" r={r} fill="none" stroke={c} strokeWidth="3.2" strokeLinecap="round" strokeDasharray={`${(share * length).toFixed(2)} ${length.toFixed(2)}`} transform="rotate(-90 24 24)" />}
    <Orb mood={mood} r={15.6} detail={size >= 60} />
  </svg>;
}

/** Smiley + Prozent: Die Zahl zeigt, wie viele der entscheidenden Prüffragen erfüllt sind (grün = 100 %) – sie passt damit immer zur Ampel. Die Qualitätsnote der KI steht separat bei den Kriterien. */
export type FulfilmentInfo = { yes: number; no: number; unclear: number; total: number; percent: number; failed?: string[]; open?: string[] } | null | undefined;
export const fulfilmentHint = (info: FulfilmentInfo) => info ? `${info.yes} von ${info.total} entscheidenden Prüffragen erfüllt${info.no ? ` · ${info.no} mit Nein beantwortet${info.failed?.length ? ` (${info.failed.join(" | ")})` : ""}` : ""}${info.unclear ? ` · ${info.unclear} unklar${info.open?.length ? ` (${info.open.join(" | ")})` : ""}` : ""}` : "";
/** Kurz in Worten, warum die Ampel so steht: „1× Nein“, „2× unklar“ oder „3/3 erfüllt“. */
export const fulfilmentShort = (info: NonNullable<FulfilmentInfo>) => `${info.no ? `${info.no}× Nein` : info.unclear ? `${info.unclear}× unklar` : `${info.yes}/${info.total} erfüllt`}${info.no && info.unclear ? ` · ${info.unclear}× unklar` : ""}`;
/**
 * Ampel eines Gesprächs. `layout="row"` (Gesprächsliste) stellt Prozent und Begründung rechts neben den Smiley,
 * sonst stehen sie darunter. In der Liste und groß im Gespräch sitzt der Smiley im Ring der erfüllten Prüffragen.
 */
export function MoodFace({ call, size = "md", percent = false, layout = "stack" }: { call: Parameters<typeof moodOf>[0] & { fulfilment?: FulfilmentInfo }; size?: "md" | "lg"; percent?: boolean; layout?: "stack" | "row" }) {
  const key = moodOf(call); const mood = MOOD[key]; const info = call.status === "bewertet" ? call.fulfilment : null;
  const face = layout === "row" ? <MoodRing mood={key} percent={info ? info.percent : null} /> : size === "lg" ? <MoodRing mood={key} percent={info ? info.percent : null} size={84} /> : <Face mood={key} size={44} />;
  const text = percent && info ? <><b className="cq-percent" style={{ color: FACE_COLOR[key] }}>{info.percent} %</b><small className="cq-fraction">{fulfilmentShort(info)}</small></> : null;
  return <span className={`cq-mood ${mood.cls} ${size === "lg" ? "is-lg" : ""} ${percent ? "has-percent" : ""} ${layout === "row" ? "is-row" : ""}`} title={`${mood.hint}${info ? ` ${fulfilmentHint(info)}.` : ""}`} aria-label={`${mood.label}${info ? `, ${fulfilmentHint(info)}` : ""}`} role="img">
    {face}{layout === "row" ? <span className="cq-mood-text">{text ?? <small className="cq-fraction">{mood.label}</small>}</span> : text}
  </span>;
}
