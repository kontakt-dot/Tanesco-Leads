import { useTheme } from "@/contexts/ThemeContext";
import { nextSwitch, THEME_MODES } from "@/lib/appearance";
import { Check } from "lucide-react";

/** Darstellung in den Einstellungen (Profil): Modus-Automatik + Menüfarbe im hellen Modus. */
export default function AppearanceSettings() {
  const { mode, setMode, switchable } = useTheme();
  if (!switchable) return null;
  const upcoming = mode === "auto" ? nextSwitch() : null;
  return <section className="rounded-xl border border-white/10 bg-white/[.018] p-4">
    <span className="eyebrow">DARSTELLUNG</span>
    <p className="mt-1 text-sm text-slate-400">Hell, dunkel, automatisch nach Sonnenauf- und -untergang (wie bei Apple) oder wie dein Gerät. Gilt für diesen Browser.</p>
    <div className="appearance-options mt-3 md:grid-cols-2" style={{ display: "grid" }}>{THEME_MODES.map((item) => <button key={item.key} type="button" role="radio" aria-checked={mode === item.key} className={mode === item.key ? "active" : ""} onClick={() => setMode(item.key)}><span><strong>{item.label}</strong><small>{item.note}</small></span>{mode === item.key && <Check className="h-4 w-4" />}</button>)}</div>
    {upcoming && <p className="appearance-hint">Nächster Wechsel: {upcoming.to === "dark" ? "dunkel" : "hell"} ab {upcoming.at.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr. Der Browser fragt einmal nach deinem Standort; ohne Freigabe gelten die Sonnenzeiten für Deutschland-Mitte.</p>}
  </section>;
}
