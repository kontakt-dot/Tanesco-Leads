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
 * Smiley als matte Kugel: weiches Licht von links oben, sanfter Schatten am unteren Rand, feine Lichtkante – kein Glanzfleck.
 * Das Gesicht ist in einem tiefen Ton der Ampelfarbe eingeprägt (helle Kante darunter). Grün lächelt, Orange schaut abwartend,
 * Rot ist enttäuscht (ab mittlerer Größe mit Brauen), Grau wartet (drei Punkte). Die Mimik unterscheidet die Ampel auch ohne Farbe.
 */
export const FACE_COLOR: Record<Mood, string> = { gruen: "#16a34a", gelb: "#f97316", rot: "#dc2626", offen: "#94a3b8" };
/** Kugel: heller Ton im Licht, Ampelfarbe, tiefer Ton im Schatten – und der dunkle Ton für das Gesicht. */
const TONE: Record<Mood, { hi: string; mid: string; lo: string; ink: string }> = {
  gruen: { hi: "#b9f5cb", mid: "#3fce76", lo: "#1c9a52", ink: "#0b4f28" },
  gelb: { hi: "#ffe0ad", mid: "#ff9a3d", lo: "#e8690f", ink: "#7a2f05" },
  rot: { hi: "#ffc9c4", mid: "#f4655d", lo: "#d23a33", ink: "#701210" },
  offen: { hi: "#f4f6fa", mid: "#c9d0db", lo: "#9ca7b8", ink: "#4c586f" },
};
const EYE_Y: Record<Mood, number> = { gruen: 19.6, gelb: 20.2, rot: 21.6, offen: 24 };
/** Gesicht auf einem 48er-Raster. `detail` zeichnet ab mittlerer Größe die Brauen mit; `bold` macht winzige Smileys kräftiger, damit sie scharf bleiben. */
function Features({ mood, detail, bold }: { mood: Mood; detail: boolean; bold: boolean }) {
  const width = bold ? 3.9 : 3.2; const eyeY = EYE_Y[mood];
  if (mood === "offen") return <><circle cx="15.2" cy="24" r={bold ? 3 : 2.7} stroke="none" /><circle cx="24" cy="24" r={bold ? 3 : 2.7} stroke="none" /><circle cx="32.8" cy="24" r={bold ? 3 : 2.7} stroke="none" /></>;
  const eyes = <><ellipse cx="17" cy={eyeY} rx={bold ? 2.9 : 2.5} ry={bold ? 3.6 : 3.3} stroke="none" /><ellipse cx="31" cy={eyeY} rx={bold ? 2.9 : 2.5} ry={bold ? 3.6 : 3.3} stroke="none" /></>;
  if (mood === "gruen") return <>{eyes}<path d="M14.6 27.6 Q24 37.6 33.4 27.6" fill="none" strokeWidth={width} strokeLinecap="round" /></>;
  if (mood === "gelb") return <>{eyes}<path d="M16.6 31 L31.4 31" fill="none" strokeWidth={width} strokeLinecap="round" /></>;
  return <>{detail && <><path d="M12.8 16.6 L19.4 14.4" fill="none" strokeWidth="2.5" strokeLinecap="round" /><path d="M35.2 16.6 L28.6 14.4" fill="none" strokeWidth="2.5" strokeLinecap="round" /></>}{eyes}<path d="M15.2 34.4 Q24 26.4 32.8 34.4" fill="none" strokeWidth={width} strokeLinecap="round" /></>;
}
/** Die Kugel selbst – Mittelpunkt 24/24, Radius `r`. Jede Kugel bringt ihre Verläufe mit eigener Kennung mit (mehrere Smileys auf einer Seite). */
function Orb({ mood, r, size }: { mood: Mood; r: number; size: number }) {
  const id = `cq${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`; const { hi, mid, lo, ink } = TONE[mood];
  const detail = size >= 30; const bold = size < 26; const scale = r / 21.5; const lightX = (24 - r * 0.36).toFixed(2); const lightY = (24 - r * 0.5).toFixed(2); const glintY = (EYE_Y[mood] - 1.25).toFixed(2);
  return <>
    <defs>
      <radialGradient id={`${id}a`} cx=".36" cy=".3" r=".86"><stop offset="0" stopColor={hi} /><stop offset=".5" stopColor={mid} /><stop offset="1" stopColor={lo} /></radialGradient>
      <radialGradient id={`${id}b`} cx=".5" cy=".38" r=".64"><stop offset=".66" stopColor={lo} stopOpacity="0" /><stop offset="1" stopColor={ink} stopOpacity=".34" /></radialGradient>
      <radialGradient id={`${id}c`} cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#fff" stopOpacity=".62" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
      <linearGradient id={`${id}d`} x1=".15" y1=".1" x2=".85" y2=".9"><stop offset="0" stopColor="#fff" stopOpacity=".75" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /></linearGradient>
    </defs>
    <g className="cq-orb">
      <circle cx="24" cy="24" r={r} fill={`url(#${id}a)`} />
      <circle cx="24" cy="24" r={r} fill={`url(#${id}b)`} />
      <ellipse cx={lightX} cy={lightY} rx={(r * 0.44).toFixed(2)} ry={(r * 0.26).toFixed(2)} fill={`url(#${id}c)`} transform={`rotate(-32 ${lightX} ${lightY})`} />
      <circle className="cq-orb-rim" cx="24" cy="24" r={(r - 0.7).toFixed(2)} fill="none" stroke={`url(#${id}d)`} strokeWidth="1.1" />
      <g className="cq-orb-face" transform={`translate(24 24) scale(${scale.toFixed(3)}) translate(-24 -24)`}>
        {!bold && <g className="cq-orb-edge" transform="translate(0 1)" fill="#fff" stroke="#fff" opacity=".42"><Features mood={mood} detail={detail} bold={bold} /></g>}
        <g className="cq-orb-ink" fill={ink} stroke={ink}><Features mood={mood} detail={detail} bold={bold} /></g>
        {detail && mood !== "offen" && <g className="cq-orb-glint" fill="#fff" opacity=".9"><circle cx="16.1" cy={glintY} r=".95" /><circle cx="30.1" cy={glintY} r=".95" /></g>}
      </g>
    </g>
  </>;
}
export function Face({ mood, size = 44 }: { mood: Mood; size?: number }) {
  return <svg className={`cq-face is-${mood}`} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><Orb mood={mood} r={21.5} size={size} /></svg>;
}
/**
 * Smiley im Ring (groß im Gespräch): Der feine Ring zeigt, wie viele der entscheidenden Prüffragen erfüllt sind – voll = alles erfüllt.
 * Ohne Prüffragen ist der Ring voll; „noch nicht bewertet“ zeigt einen leeren Ring mit drei Punkten.
 */
export function MoodRing({ mood, percent, size = 84 }: { mood: Mood; percent: number | null; size?: number }) {
  const id = `cq${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`; const { mid, lo } = TONE[mood]; const r = 22; const length = 2 * Math.PI * r; const share = mood === "offen" ? 0 : percent === null ? 1 : Math.max(0.04, Math.min(1, percent / 100));
  return <svg className={`cq-ring is-${mood}`} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <defs><linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={mid} /><stop offset="1" stopColor={lo} /></linearGradient></defs>
    <circle className="cq-ring-track" cx="24" cy="24" r={r} fill="none" stroke={lo} strokeOpacity=".16" strokeWidth="2" />
    {share > 0 && <circle className="cq-ring-share" cx="24" cy="24" r={r} fill="none" stroke={`url(#${id}r)`} strokeWidth="2" strokeLinecap="round" strokeDasharray={`${(share * length).toFixed(2)} ${length.toFixed(2)}`} transform="rotate(-90 24 24)" />}
    <Orb mood={mood} r={17} size={size} />
  </svg>;
}

/** Smiley + Prozent: Die Zahl zeigt, wie viele der entscheidenden Prüffragen erfüllt sind (grün = 100 %) – sie passt damit immer zur Ampel. Die Qualitätsnote der KI steht separat bei den Kriterien. */
export type FulfilmentInfo = { yes: number; no: number; unclear: number; total: number; percent: number; failed?: string[]; open?: string[] } | null | undefined;
export const fulfilmentHint = (info: FulfilmentInfo) => info ? `${info.yes} von ${info.total} entscheidenden Prüffragen erfüllt${info.no ? ` · ${info.no} mit Nein beantwortet${info.failed?.length ? ` (${info.failed.join(" | ")})` : ""}` : ""}${info.unclear ? ` · ${info.unclear} unklar${info.open?.length ? ` (${info.open.join(" | ")})` : ""}` : ""}` : "";
/** Kurz in Worten, warum die Ampel so steht: „1× Nein“, „2× unklar“ oder „3/3 erfüllt“. */
export const fulfilmentShort = (info: NonNullable<FulfilmentInfo>) => `${info.no ? `${info.no}× Nein` : info.unclear ? `${info.unclear}× unklar` : `${info.yes}/${info.total} erfüllt`}${info.no && info.unclear ? ` · ${info.unclear}× unklar` : ""}`;
/**
 * Ampel eines Gesprächs. `layout="row"` (Gesprächsliste) stellt Prozent und Begründung rechts neben den Smiley,
 * sonst stehen sie darunter. In der Liste steht die Kugel für sich; groß im Gespräch sitzt sie im Ring der erfüllten Prüffragen.
 */
export function MoodFace({ call, size = "md", percent = false, layout = "stack" }: { call: Parameters<typeof moodOf>[0] & { fulfilment?: FulfilmentInfo }; size?: "md" | "lg"; percent?: boolean; layout?: "stack" | "row" }) {
  const key = moodOf(call); const mood = MOOD[key]; const info = call.status === "bewertet" ? call.fulfilment : null;
  const face = layout === "row" ? <Face mood={key} size={40} /> : size === "lg" ? <MoodRing mood={key} percent={info ? info.percent : null} size={84} /> : <Face mood={key} size={44} />;
  const text = percent && info ? <><b className="cq-percent" style={{ color: FACE_COLOR[key] }}>{info.percent} %</b><small className="cq-fraction">{fulfilmentShort(info)}</small></> : null;
  return <span className={`cq-mood ${mood.cls} ${size === "lg" ? "is-lg" : ""} ${percent ? "has-percent" : ""} ${layout === "row" ? "is-row" : ""}`} title={`${mood.hint}${info ? ` ${fulfilmentHint(info)}.` : ""}`} aria-label={`${mood.label}${info ? `, ${fulfilmentHint(info)}` : ""}`} role="img">
    {face}{layout === "row" ? <span className="cq-mood-text">{text ?? <small className="cq-fraction">{mood.label}</small>}</span> : text}
  </span>;
}
