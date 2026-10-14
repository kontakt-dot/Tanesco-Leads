import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Sparkles } from "lucide-react";
import { useState } from "react";

export type AutomationBuilderRequest = { description: string; sourceCategoryId: number; targetCategoryId: number };

export default function AutomationBuilder({ categories, onBuild, isBuilding = false }: { categories: Array<{ id: number; name: string }>; onBuild: (request: AutomationBuilderRequest) => void; isBuilding?: boolean }) {
  const [description, setDescription] = useState("");
  const [sourceCategoryId, setSourceCategoryId] = useState("");
  const [targetCategoryId, setTargetCategoryId] = useState("");
  const create = () => {
    const source = Number(sourceCategoryId || categories[0]?.id);
    const target = Number(targetCategoryId || sourceCategoryId || categories[0]?.id);
    if (description.trim().length < 12 || !source || !target) return;
    onBuild({ description: description.trim(), sourceCategoryId: source, targetCategoryId: target });
    setDescription("");
  };
  return <section className="builder-hero rounded-2xl border border-violet-300/25 p-5">
    <div className="flex gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-400/15 text-violet-100"><Sparkles className="h-5 w-5" /></div><div><span className="eyebrow">AUTOMATISIERUNGSBUILDER</span><h3 className="mt-1 text-base font-semibold text-white">Sag einfach, was passieren soll</h3><p className="mt-1 text-xs leading-5 text-slate-300">Zum Beispiel: „Wenn ein PV-Lead erstellt wird, prüfe ihn und ordne ihn anschließend einer Bestellung zu.“ Der Builder legt die Regel pausiert an – du kannst sie danach direkt aktivieren.</p></div></div>
    <div className="mt-5 grid gap-3"><Textarea value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-28 border-white/15 bg-slate-950/55 text-slate-100 placeholder:text-slate-500" placeholder="Beschreibe deine Automatisierung in einem Satz …" />
      <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-xs text-slate-300">Ausgangs-Kategorie<select className="filter-select w-full" value={sourceCategoryId} onChange={(event) => setSourceCategoryId(event.target.value)}><option value="">Kategorie auswählen</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="grid gap-1.5 text-xs text-slate-300">Ziel-Kategorie<select className="filter-select w-full" value={targetCategoryId} onChange={(event) => setTargetCategoryId(event.target.value)}><option value="">Wie Ausgangs-Kategorie</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div>
      <Button className="flux-button w-full" disabled={description.trim().length < 12 || !categories.length || isBuilding} onClick={create}><Bot /> {isBuilding ? "Regel wird erstellt …" : "Automatisierung automatisch erstellen"}</Button>
    </div>
  </section>;
}
