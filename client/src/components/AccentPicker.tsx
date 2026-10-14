import { ACCENTS, applyAccent, readAccent, type AccentKey } from "@/lib/accent";
import { Check } from "lucide-react";
import { useState } from "react";

/** Farbwelt des hellen Modus wählen – wirkt sofort, wird im Browser gemerkt. */
export default function AccentPicker() {
  const [active, setActive] = useState<AccentKey>(() => readAccent());
  return <section className="rounded-xl border border-white/10 bg-white/[.018] p-4">
    <span className="eyebrow">FARBWELT (HELLER MODUS)</span>
    <p className="mt-1 text-sm text-slate-400">Der Verlauf für Hintergrund-Schleier, Kacheln, Diagrammbalken und Auswahl. Knöpfe und Navigation bleiben schwarz, Status-Farben bleiben gleich.</p>
    <div className="accent-grid mt-4" role="radiogroup" aria-label="Farbwelt">
      {ACCENTS.map((item) => <button key={item.key} type="button" role="radio" aria-checked={active === item.key} className={`accent-option ${active === item.key ? "active" : ""}`} onClick={() => { applyAccent(item.key); setActive(item.key); }}>
        <span className="accent-swatch" style={{ background: `linear-gradient(135deg, rgb(${item.a}), rgb(${item.b}))` }}>{active === item.key && <Check className="h-4 w-4" />}</span>
        <span className="min-w-0"><strong className="block text-sm">{item.label}</strong><small className="block text-xs text-slate-500">{item.note}</small></span>
      </button>)}
    </div>
  </section>;
}
