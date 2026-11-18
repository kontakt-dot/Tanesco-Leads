import { moodOf, type Mood } from "../../../shared/call-overview";

export { moodOf, type Mood };
/** Ampel statt Punkte: grün 🙂 = passt (freigegeben / verkaufbar), gelb 😐 = reinhören (zur Prüfung / nachfassen / unklar), rot 🙁 = passt nicht (zurückgewiesen / nicht verkaufbar), grau = noch nicht bewertet. */
export const MOOD: Record<Mood, { label: string; hint: string; cls: string; color: string }> = {
  gruen: { label: "Passt", hint: "Grün: Gespräch passt – alle Vorgaben erfüllt bzw. freigegeben.", cls: "is-gruen", color: "#16a34a" },
  gelb: { label: "Reinhören", hint: "Orange: Unklar – bitte selbst reinhören und entscheiden.", cls: "is-gelb", color: "#f97316" },
  rot: { label: "Passt nicht", hint: "Rot: Vorgabe nicht erfüllt bzw. zurückgewiesen.", cls: "is-rot", color: "#dc2626" },
  offen: { label: "Noch nicht bewertet", hint: "Grau: Noch keine Bewertung – Aufnahme wird noch geholt oder ausgewertet.", cls: "is-offen", color: "#94a3b8" },
};
/** Smiley in der Ampelfarbe – clean: weißes Gesicht, farbiger Ring, Augen und Mund in der Farbe. Grün lacht, Orange neutral, Rot traurig, Grau wartet. */
export const FACE_COLOR: Record<Mood, string> = { gruen: "#16a34a", gelb: "#f97316", rot: "#dc2626", offen: "#94a3b8" };
export function Face({ mood, size = 44 }: { mood: Mood; size?: number }) {
  const c = FACE_COLOR[mood];
  return <svg className={`cq-face is-${mood}`} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="21" fill="#fff" stroke={c} strokeWidth="3.5" />
    {mood === "offen" ? <><circle cx="15" cy="25" r="2.6" fill={c} /><circle cx="24" cy="25" r="2.6" fill={c} /><circle cx="33" cy="25" r="2.6" fill={c} /></> : <>
      <circle cx="16.5" cy="19.5" r="2.9" fill={c} /><circle cx="31.5" cy="19.5" r="2.9" fill={c} />
      {mood === "gruen" && <path d="M14.5 28 C17.5 34.5, 30.5 34.5, 33.5 28" fill="none" stroke={c} strokeWidth="3.5" strokeLinecap="round" />}
      {mood === "gelb" && <path d="M15.5 31 L32.5 31" fill="none" stroke={c} strokeWidth="3.5" strokeLinecap="round" />}
      {mood === "rot" && <path d="M14.5 34 C17.5 27.5, 30.5 27.5, 33.5 34" fill="none" stroke={c} strokeWidth="3.5" strokeLinecap="round" />}
    </>}
  </svg>;
}

/** Smiley + Prozent: Die Zahl zeigt, wie viele der entscheidenden Prüffragen erfüllt sind (grün = 100 %) – sie passt damit immer zur Ampel. Die Qualitätsnote der KI steht separat bei den Kriterien. */
export type FulfilmentInfo = { yes: number; no: number; unclear: number; total: number; percent: number; failed?: string[]; open?: string[] } | null | undefined;
export const fulfilmentHint = (info: FulfilmentInfo) => info ? `${info.yes} von ${info.total} entscheidenden Prüffragen erfüllt${info.no ? ` · ${info.no} mit Nein beantwortet${info.failed?.length ? ` (${info.failed.join(" | ")})` : ""}` : ""}${info.unclear ? ` · ${info.unclear} unklar${info.open?.length ? ` (${info.open.join(" | ")})` : ""}` : ""}` : "";
/** Kurz in Worten, warum die Ampel so steht: „1× Nein“, „2× unklar“ oder „3/3 erfüllt“. */
export const fulfilmentShort = (info: NonNullable<FulfilmentInfo>) => `${info.no ? `${info.no}× Nein` : info.unclear ? `${info.unclear}× unklar` : `${info.yes}/${info.total} erfüllt`}${info.no && info.unclear ? ` · ${info.unclear}× unklar` : ""}`;
/**
 * Ampel eines Gesprächs. `layout="row"` (Gesprächsliste) stellt Prozent und Begründung rechts neben den Smiley,
 * sonst stehen sie darunter.
 */
export function MoodFace({ call, size = "md", percent = false, layout = "stack" }: { call: Parameters<typeof moodOf>[0] & { fulfilment?: FulfilmentInfo }; size?: "md" | "lg"; percent?: boolean; layout?: "stack" | "row" }) {
  const key = moodOf(call); const mood = MOOD[key]; const info = call.status === "bewertet" ? call.fulfilment : null;
  const face = <Face mood={key} size={size === "lg" ? 64 : layout === "row" ? 38 : 44} />;
  const text = percent && info ? <><b className="cq-percent" style={{ color: FACE_COLOR[key] }}>{info.percent} %</b><small className="cq-fraction">{fulfilmentShort(info)}</small></> : null;
  return <span className={`cq-mood ${mood.cls} ${size === "lg" ? "is-lg" : ""} ${percent ? "has-percent" : ""} ${layout === "row" ? "is-row" : ""}`} title={`${mood.hint}${info ? ` ${fulfilmentHint(info)}.` : ""}`} aria-label={`${mood.label}${info ? `, ${fulfilmentHint(info)}` : ""}`} role="img">
    {face}{layout === "row" ? <span className="cq-mood-text">{text ?? <small className="cq-fraction">{mood.label}</small>}</span> : text}
  </span>;
}
