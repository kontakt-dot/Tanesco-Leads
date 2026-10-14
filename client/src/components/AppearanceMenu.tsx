import { useTheme } from "@/contexts/ThemeContext";
import { nextSwitch, THEME_MODES } from "@/lib/appearance";
import { Check, Moon, Sun, SunMoon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const fmt = (date: Date) => date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

/** Kopfzeilen-Knopf: Hell/Dunkel/Automatisch/System + Menüfarbe im hellen Modus. Kurzer Klick öffnet das Menü. */
export default function AppearanceMenu() {
  const { theme, mode, setMode, switchable } = useTheme();
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const onDown = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); }; const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); }; document.addEventListener("mousedown", onDown); window.addEventListener("keydown", onKey); return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); }; }, [open]);
  if (!switchable) return null;
  const upcoming = mode === "auto" ? nextSwitch() : null;
  return <div className="appearance-menu" ref={ref}>
    <button type="button" aria-label={theme === "dark" ? "Hellen Modus einschalten" : "Dunklen Modus einschalten"} aria-haspopup="menu" aria-expanded={open} title="Darstellung" onClick={() => setOpen((value) => !value)}>{mode === "auto" ? <SunMoon /> : theme === "dark" ? <Sun /> : <Moon />}</button>
    {open && <div className="appearance-popover" role="menu" aria-label="Darstellung">
      <span className="eyebrow">DARSTELLUNG</span>
      <div className="appearance-options">{THEME_MODES.map((item) => <button key={item.key} type="button" role="menuitemradio" aria-checked={mode === item.key} className={mode === item.key ? "active" : ""} onClick={() => setMode(item.key)}><span><strong>{item.label}</strong><small>{item.note}</small></span>{mode === item.key && <Check className="h-4 w-4" />}</button>)}</div>
      {upcoming && <p className="appearance-hint">Nächster Wechsel: {upcoming.to === "dark" ? "dunkel" : "hell"} ab {fmt(upcoming.at)} Uhr (Sonnenzeiten für deinen Standort; ohne Freigabe Deutschland-Mitte).</p>}
      {mode === "system" && <p className="appearance-hint">Dein Gerät meldet gerade: <strong>{typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dunkel" : "hell"}</strong>. Die Plattform folgt dieser Einstellung – änderst du sie am Gerät (oder greift dessen Automatik), wechselt die Ansicht mit.</p>}
    </div>}
  </div>;
}
