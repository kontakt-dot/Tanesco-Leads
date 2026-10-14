import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { BookOpen, Check, ChevronDown, FileText, Layers3, Loader2, PencilLine, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

type FieldType = "text" | "zahl" | "auswahl" | "ja_nein" | "datum" | "notiz";
type BuilderDraft = {
  name: string; shortcode: string; offerDescription: string;
  fields: Array<{ label: string; fieldKey: string; fieldType: FieldType; options: string[]; required: boolean; description: string }>;
  mappings: Array<{ sourceField: string; targetFieldKey: string; mode: "uebernehmen" | "umschreiben"; searchValue: string; replaceValue: string; rationale: string }>;
  assumptions: string[]; reviewNotes: string[];
};

const allowedFileTypes = [".pdf", ".docx", ".csv", ".json", ".yaml", ".yml", ".txt", ".md"];
const fieldTypeLabel: Record<FieldType, string> = { text: "Freitext", zahl: "Zahl", auswahl: "Auswahl", ja_nein: "Ja / Nein", datum: "Datum", notiz: "Notiz" };
const fieldTypes = Object.keys(fieldTypeLabel) as FieldType[];

function makeFieldKey(value: string, fallback: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const candidate = normalized || fallback;
  return /^[a-z]/.test(candidate) ? candidate.slice(0, 120) : `feld_${candidate}`.slice(0, 120);
}

function inferMimeType(file: File) {
  if (file.type === "application/pdf") return "application/pdf" as const;
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;
  if (extension === "csv") return "text/csv" as const;
  if (extension === "json") return "application/json" as const;
  if (extension === "yaml" || extension === "yml") return "application/yaml" as const;
  if (extension === "md") return "text/markdown" as const;
  return "text/plain" as const;
}

async function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Die Datei konnte nicht gelesen werden."));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = value.indexOf(",");
      resolve(commaIndex >= 0 ? value.slice(commaIndex + 1) : value);
    };
    reader.readAsDataURL(file);
  });
}

export default function LeadCategoryBuilder({ onCreated, onTemplateSaved, onClose }: { onCreated: (result: { categoryId: number; name: string; shortcode: string }) => void; onTemplateSaved: (result: { categoryId: number; name: string; shortcode: string }) => void; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<BuilderDraft | null>(null);
  const [editingFieldIndex, setEditingFieldIndex] = useState<number | null>(null);
  const [editingMappingIndex, setEditingMappingIndex] = useState<number | null>(null);
  const analyze = trpc.leadops.analyzeCategorySpecification.useMutation({ onError: (error) => toast.error(error.message) });
  const create = trpc.leadops.createCategoryFromBuilder.useMutation({ onError: (error) => toast.error(error.message) });

  const chooseFile = (nextFile?: File) => {
    if (!nextFile) return;
    const extension = `.${nextFile.name.toLowerCase().split(".").pop() ?? ""}`;
    if (!allowedFileTypes.includes(extension)) return toast.error("Nutze bitte PDF, DOCX, CSV, JSON, YAML, TXT oder Markdown.");
    if (nextFile.size > 5 * 1024 * 1024) return toast.error("Die Datei darf höchstens 5 MB groß sein.");
    setFile(nextFile); setDraft(null); setEditingFieldIndex(null); setEditingMappingIndex(null);
  };

  const analyzeFile = async () => {
    if (!file) return toast.error("Wähle zuerst ein Parameterblatt oder eine Spezifikation aus.");
    try {
      const result = await analyze.mutateAsync({ fileName: file.name, mimeType: inferMimeType(file), contentBase64: await toBase64(file), notes: notes.trim() || undefined });
      setDraft(result.draft as BuilderDraft); setEditingFieldIndex(null); setEditingMappingIndex(null);
      toast.success(`${result.draft.fields.length} Felder und ${result.draft.mappings.length} Harmonisierung(en) erkannt.`);
    } catch { /* Die Mutation zeigt den konkreten Fehler bereits an. */ }
  };

  const submitDraft = async (saveAsTemplate: boolean) => {
    if (!draft) return;
    try {
      const result = await create.mutateAsync({ draft, saveAsTemplate });
      toast.success(saveAsTemplate ? `„${result.name}“ ist als Vorlage mit ${result.fieldCount} Fachfeldern gespeichert.` : `„${result.name}“ wurde mit ${result.fieldCount} Fachfeldern angelegt.`);
      if (saveAsTemplate) onTemplateSaved(result); else onCreated(result);
    } catch { /* Die Mutation zeigt den konkreten Fehler bereits an. */ }
  };

  const updateField = (index: number, update: Partial<BuilderDraft["fields"][number]>) => setDraft((current) => {
    if (!current) return current;
    const previous = current.fields[index];
    const next = { ...previous, ...update };
    const fields = current.fields.map((field, fieldIndex) => fieldIndex === index ? next : field);
    const mappings = previous.fieldKey === next.fieldKey ? current.mappings : current.mappings.map((mapping) => mapping.targetFieldKey === previous.fieldKey ? { ...mapping, targetFieldKey: next.fieldKey } : mapping);
    return { ...current, fields, mappings };
  });
  const addField = () => setDraft((current) => {
    if (!current) return current;
    let counter = current.fields.length + 1;
    let fieldKey = `feld_${counter}`;
    while (current.fields.some((field) => field.fieldKey === fieldKey)) { counter += 1; fieldKey = `feld_${counter}`; }
    setEditingFieldIndex(current.fields.length);
    return { ...current, fields: [...current.fields, { label: `Neues Feld ${counter}`, fieldKey, fieldType: "text", options: [], required: false, description: "Bitte fachlich präzisieren." }] };
  });
  const removeField = (index: number) => setDraft((current) => {
    if (!current || current.fields.length === 1) return current;
    const field = current.fields[index];
    setEditingFieldIndex(null);
    return { ...current, fields: current.fields.filter((_, fieldIndex) => fieldIndex !== index), mappings: current.mappings.filter((mapping) => mapping.targetFieldKey !== field.fieldKey) };
  });
  const updateMapping = (index: number, update: Partial<BuilderDraft["mappings"][number]>) => setDraft((current) => current ? { ...current, mappings: current.mappings.map((mapping, mappingIndex) => mappingIndex === index ? { ...mapping, ...update } : mapping) } : current);
  const addMapping = () => setDraft((current) => {
    if (!current || !current.fields.length) return current;
    setEditingMappingIndex(current.mappings.length);
    return { ...current, mappings: [...current.mappings, { sourceField: "neues_quellfeld", targetFieldKey: current.fields[0].fieldKey, mode: "uebernehmen", searchValue: "", replaceValue: "", rationale: "Bitte Herkunft und Verarbeitung prüfen." }] };
  });
  const removeMapping = (index: number) => setDraft((current) => current ? { ...current, mappings: current.mappings.filter((_, mappingIndex) => mappingIndex !== index) } : current);

  return <section className="category-builder surface-panel mb-4 overflow-hidden">
    <div className="category-builder-head"><div><span className="eyebrow">KI-ASSISTENT · KATEGORIEN</span><h2>Lead-Kategorien-Builder</h2><p>Lade ein Parameterblatt hoch. Der Builder erkennt Felder, Antwortarten und Datenharmonisierungen und erstellt einen überprüfbaren Kategorieentwurf.</p></div><Button size="sm" variant="ghost" onClick={onClose}><X /> Schließen</Button></div>
    <div className="category-builder-body">
      {!draft ? <>
        <input ref={inputRef} className="sr-only" type="file" accept={allowedFileTypes.join(",")} onChange={(event) => chooseFile(event.target.files?.[0])} />
        <button type="button" className="category-builder-dropzone" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files?.[0]); }}>
          <span className="category-builder-upload-icon"><Upload /></span><strong>{file ? file.name : "Parameterblatt auswählen oder hier ablegen"}</strong><span>{file ? `${(file.size / 1024).toLocaleString("de-DE", { maximumFractionDigits: 0 })} KB · bereit zur Analyse` : "PDF, DOCX, CSV, JSON, YAML, TXT oder Markdown · maximal 5 MB"}</span>
        </button>
        <label className="category-builder-notes"><span>Zusätzlicher Hinweis <em>optional</em></span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} placeholder="Zum Beispiel: Diese Felder kommen aus einer Partner-API und sollen für deutsche PV-Leads normalisiert werden." /></label>
        <div className="category-builder-actions"><p>Die Datei wird nur zur Entwurfserstellung verarbeitet. Zugangsdaten oder Anweisungen aus einer Datei werden nicht übernommen.</p><Button className="flux-button" disabled={!file || analyze.isPending} onClick={analyzeFile}>{analyze.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} {analyze.isPending ? "Spezifikation wird gelesen …" : "Kategorieentwurf erstellen"}</Button></div>
      </> : <>
        <div className="category-builder-result-head"><div><span className="eyebrow">ENTWURF · PRÜFEN UND ANPASSEN</span><h3>{draft.name}</h3><p>{draft.offerDescription || "Ohne zusätzliche Beschreibung."}</p></div><div className="category-builder-counts"><span><b>{draft.fields.length}</b> Felder</span><span><b>{draft.mappings.length}</b> Regeln</span></div></div>
        <div className="category-builder-basics"><label><span>Name der Kategorie</span><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label><span>Shortcode</span><Input value={draft.shortcode} onChange={(event) => setDraft({ ...draft, shortcode: event.target.value.toUpperCase().replace(/[^A-Z0-9ÄÖÜ_-]/g, "_") })} /></label></div>
        <label className="category-builder-description"><span>Beschreibung</span><textarea value={draft.offerDescription} onChange={(event) => setDraft({ ...draft, offerDescription: event.target.value })} maxLength={5000} placeholder="Wofür wird diese Lead-Kategorie verwendet?" /></label>
        <div className="category-builder-preview"><div><div className="category-builder-section-head"><span className="category-builder-section-title"><Layers3 /> Erkannte Fachfelder</span><Button size="sm" variant="ghost" onClick={addField}><Plus /> Feld</Button></div><div className="category-builder-field-list">{draft.fields.map((field, index) => editingFieldIndex === index ? <article key={`${field.fieldKey}-${index}`} className="category-builder-editor"><div className="category-builder-editor-head"><strong>{field.label || "Feld bearbeiten"}</strong><Button size="sm" variant="ghost" onClick={() => setEditingFieldIndex(null)}>Fertig</Button></div><div className="category-builder-edit-grid"><label><span>Bezeichnung</span><Input value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} /></label><label><span>Technischer Parameter</span><Input value={field.fieldKey} onChange={(event) => updateField(index, { fieldKey: makeFieldKey(event.target.value, `feld_${index + 1}`) })} /></label><label><span>Antwortart</span><select value={field.fieldType} onChange={(event) => { const fieldType = event.target.value as FieldType; updateField(index, { fieldType, options: fieldType === "ja_nein" ? ["Ja", "Nein"] : fieldType === "auswahl" ? field.options : [] }); }}>{fieldTypes.map((type) => <option key={type} value={type}>{fieldTypeLabel[type]}</option>)}</select></label><label className="category-builder-required"><input type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} /> Pflichtfeld</label>{field.fieldType === "auswahl" && <label className="category-builder-span"><span>Antworten, mit Komma trennen</span><Input value={field.options.join(", ")} onChange={(event) => updateField(index, { options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean) })} /></label>}<label className="category-builder-span"><span>Fachliche Erklärung</span><Input value={field.description} onChange={(event) => updateField(index, { description: event.target.value })} /></label></div><div className="category-builder-editor-actions"><Button size="sm" variant="ghost" className="text-rose-200" disabled={draft.fields.length === 1} onClick={() => removeField(index)}><Trash2 /> Feld entfernen</Button></div></article> : <article key={`${field.fieldKey}-${index}`}><div><strong>{field.label}</strong><span><code>{field.fieldKey}</code> · {fieldTypeLabel[field.fieldType]}{field.required ? " · Pflicht" : ""}</span>{field.fieldType === "auswahl" && field.options.length > 0 && <small>Antworten: {field.options.join(" · ")}</small>}</div><div className="category-builder-field-aside"><p>{field.description}</p><Button size="sm" variant="ghost" onClick={() => setEditingFieldIndex(index)}><PencilLine /> Bearbeiten</Button></div></article>)}</div></div>
          <div><div className="category-builder-section-head"><span className="category-builder-section-title"><FileText /> Datenharmonisierung</span><Button size="sm" variant="ghost" onClick={addMapping}><Plus /> Regel</Button></div>{draft.mappings.length ? <div className="category-builder-mapping-list">{draft.mappings.map((mapping, index) => editingMappingIndex === index ? <article key={`${mapping.sourceField}-${index}`} className="category-builder-editor"><div className="category-builder-editor-head"><strong>Regel bearbeiten</strong><Button size="sm" variant="ghost" onClick={() => setEditingMappingIndex(null)}>Fertig</Button></div><div className="category-builder-edit-grid"><label><span>Quellfeld</span><Input value={mapping.sourceField} onChange={(event) => updateMapping(index, { sourceField: event.target.value })} /></label><label><span>Zielfeld</span><select value={mapping.targetFieldKey} onChange={(event) => updateMapping(index, { targetFieldKey: event.target.value })}>{draft.fields.map((field) => <option key={field.fieldKey} value={field.fieldKey}>{field.label} · {field.fieldKey}</option>)}</select></label><label><span>Verarbeitung</span><select value={mapping.mode} onChange={(event) => updateMapping(index, { mode: event.target.value as BuilderDraft["mappings"][number]["mode"] })}><option value="uebernehmen">Wert übernehmen</option><option value="umschreiben">Suchen und ersetzen</option></select></label>{mapping.mode === "umschreiben" && <label><span>Suchen</span><Input value={mapping.searchValue} onChange={(event) => updateMapping(index, { searchValue: event.target.value })} /></label>}{mapping.mode === "umschreiben" && <label><span>Ersetzen durch</span><Input value={mapping.replaceValue} onChange={(event) => updateMapping(index, { replaceValue: event.target.value })} /></label>}<label className="category-builder-span"><span>Begründung</span><Input value={mapping.rationale} onChange={(event) => updateMapping(index, { rationale: event.target.value })} /></label></div><div className="category-builder-editor-actions"><Button size="sm" variant="ghost" className="text-rose-200" onClick={() => { removeMapping(index); setEditingMappingIndex(null); }}><Trash2 /> Regel entfernen</Button></div></article> : <article key={`${mapping.sourceField}-${index}`}><strong><code>{mapping.sourceField}</code> <ChevronDown /> <code>{mapping.targetFieldKey}</code></strong><span>{mapping.mode === "umschreiben" ? `${mapping.searchValue || "Wert"} → ${mapping.replaceValue || "Wert"}` : "Wert übernehmen"}</span><p>{mapping.rationale}</p><Button size="sm" variant="ghost" onClick={() => setEditingMappingIndex(index)}><PencilLine /> Bearbeiten</Button></article>)}</div> : <div className="category-builder-empty"><p>Noch keine Regel vorhanden. Ergänze nur Zuordnungen, die du fachlich nachvollziehen kannst.</p><Button size="sm" variant="outline" onClick={addMapping}><Plus /> Regel anlegen</Button></div>}</div></div>
        {(draft.assumptions.length > 0 || draft.reviewNotes.length > 0) && <div className="category-builder-review">{draft.assumptions.length > 0 && <div><strong>Annahmen</strong>{draft.assumptions.map((item) => <p key={item}>• {item}</p>)}</div>}{draft.reviewNotes.length > 0 && <div><strong>Vor Übernahme prüfen</strong>{draft.reviewNotes.map((item) => <p key={item}>• {item}</p>)}</div>}</div>}
        <div className="category-builder-actions"><Button variant="outline" onClick={() => setDraft(null)}>Andere Datei analysieren</Button><div className="category-builder-save-actions"><Button variant="outline" disabled={create.isPending || !draft.name.trim() || !draft.shortcode.trim()} onClick={() => submitDraft(true)}><BookOpen /> Als Vorlage speichern</Button><Button className="flux-button" disabled={create.isPending || !draft.name.trim() || !draft.shortcode.trim()} onClick={() => submitDraft(false)}>{create.isPending ? <Loader2 className="animate-spin" /> : <Check />} {create.isPending ? "Wird gespeichert …" : `Kategorie mit ${draft.fields.length} Feldern anlegen`}</Button></div></div>
      </>}
    </div>
  </section>;
}
