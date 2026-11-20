import { Palette } from "lucide-react";
import React from "react";

/** Zwölf feste Farben – dieselben für Tags und Teams – und daneben das Feld für eine eigene Farbe. */
export const COLOR_PALETTE = ["#2dd4bf", "#22c55e", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#ec4899", "#0ea5e9", "#84cc16", "#f97316", "#64748b", "#111827"];

/** Farbauswahl: Punkte zum Anklicken, der gewählte hat einen Ring; rechts „Eigene Farbe“ (öffnet die Farbwahl des Geräts). */
export default function ColorPalette({ value, onChange, label = "Farbe" }: { value: string; onChange: (color: string) => void; label?: string }) {
  const current = value.toLowerCase(); const custom = /^#[0-9a-f]{6}$/.test(current) && !COLOR_PALETTE.includes(current);
  return <div className="color-palette" role="radiogroup" aria-label={label}>
    {COLOR_PALETTE.map((item) => <button key={item} type="button" role="radio" aria-checked={current === item} aria-label={`Farbe ${item}`} className={`color-dot ${current === item ? "swatch-selected is-on" : ""}`} style={{ backgroundColor: item }} onClick={() => onChange(item)} />)}
    <label className={`color-own ${custom ? "swatch-selected is-on" : ""}`} title="Eigene Farbe" style={custom ? { backgroundColor: current } : undefined}><Palette aria-hidden="true" /><input type="color" className="sr-only" aria-label="Eigene Farbe" value={/^#[0-9a-f]{6}$/.test(current) ? current : "#8b5cf6"} onChange={(event) => onChange(event.target.value)} /></label>
  </div>;
}
