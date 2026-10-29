import { Input } from "@/components/ui/input";
import { Check, PenLine } from "lucide-react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { SPARTE_SUGGESTIONS } from "../../../shared/lead-sparte";

export type PickCategory = { id: number; name: string; emoji?: string | null; color?: string | null; status?: string | null };

/**
 * Lead-Kategorien einer E-Mail-Kampagne wählen – daraus kommt die Leadsparte, zu der die KI Vorlagen und E-Mails schreibt
 * (Photovoltaik + Wärmepumpe → „Photovoltaik & Wärmepumpe“). Passt keine Kategorie, lässt sich die Sparte frei eintragen;
 * Kategorien und freier Eintrag schließen sich aus: `onSelect` mit Kategorien leert den freien Eintrag, `onFreeText` mit Text die Kategorien.
 */
export default function LeadCategoryPicker({ categories, selected, onSelect, freeText, onFreeText, showFree, onShowFree, hint }: {
  categories: PickCategory[];
  selected: number[];
  onSelect: (ids: number[]) => void;
  freeText: string;
  onFreeText: (value: string) => void;
  showFree: boolean;
  onShowFree: (value: boolean) => void;
  hint?: ReactNode;
}) {
  // inaktive Kategorien nur zeigen, wenn sie schon gewählt sind
  const shown = categories.filter((category) => category.status !== "inaktiv" || selected.includes(category.id));
  const freeOpen = showFree || !shown.length || (!selected.length && Boolean(freeText.trim()));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (showFree && shown.length) input.current?.focus(); }, [showFree, shown.length]);
  const toggle = (id: number) => {
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    onSelect(next); if (next.length) onShowFree(false); // Kategorie gewählt → kein freier Eintrag (den leert onSelect)
  };
  return <div className="sparte-field" role="group" aria-labelledby="cat-picks-label">
    <span id="cat-picks-label">Lead-Kategorien</span>
    {shown.length > 0 && <div className="cat-picks">
      {shown.map((category) => { const on = selected.includes(category.id); return <button key={category.id} type="button" className={`cat-pick ${on ? "is-on" : ""}`} aria-pressed={on} style={category.color ? ({ "--cat": category.color } as CSSProperties) : undefined} title={on ? `${category.name} abwählen` : `E-Mails passend zu ${category.name} schreiben`} onClick={() => toggle(category.id)}>
        {category.emoji ? <span className="cat-pick-emoji" aria-hidden="true">{category.emoji}</span> : <i className="cat-pick-dot" aria-hidden="true" />}
        <span className="cat-pick-name">{category.name}</span>
        {on && <Check className="cat-pick-check" aria-hidden="true" />}
      </button>; })}
      {!freeOpen && <button type="button" className="cat-pick is-other" onClick={() => { onSelect([]); onShowFree(true); }}><PenLine aria-hidden="true" /> Andere Sparte eintragen</button>}
    </div>}
    {freeOpen && <div className="cat-free">
      <Input ref={input} list="sparte-vorschlaege" aria-label="Leadsparte" placeholder={shown.length ? "Andere Sparte, z. B. Pool-Bau" : "z. B. Hausnotruf, Elektrorollstuhl, Alarmanlage"} value={freeText} maxLength={120} onChange={(event) => onFreeText(event.target.value)} /* freier Eintrag → keine Kategorie (das erledigt onFreeText) */ />
      <datalist id="sparte-vorschlaege">{SPARTE_SUGGESTIONS.map((label) => <option key={label} value={label} />)}</datalist>
      {shown.length > 0 && <button type="button" className="cat-free-close" onClick={() => { onFreeText(""); onShowFree(false); }} title="Eintrag löschen – dann gilt die Auswahl der Kategorien">Eintrag entfernen</button>}
    </div>}
    {hint}
  </div>;
}
