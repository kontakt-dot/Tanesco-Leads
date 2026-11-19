/**
 * Verträge – Bausteine, die Editor und Dokument gemeinsam nutzen: Symbole der Bausteine, Bild einlesen,
 * Kunde aus den Kontakten wählen und die Vertragsangabe mit Schnellauswahl (Liefergebiet, Menge, Preis …).
 */
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { BUNDESLAENDER, DETAIL_PRESETS, isRegionDetail, parsePlzList, regionText, type ContractBlock, type ContractBlockType, type ContractRegion, type ContractValues } from "../../../shared/contracts";
import { Calendar, FileSignature, Heading, Image as ImageIcon, List, ListChecks, Minus, PenLine, Scissors, Search, Type, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";

export const BLOCK_ICON: Record<ContractBlockType, typeof Type> = { heading: Heading, text: Type, bullets: List, image: ImageIcon, logo: ImageIcon, parties: Users, detail: ListChecks, field: PenLine, date: Calendar, signature: FileSignature, divider: Minus, pagebreak: Scissors };
export const slug = (text: string) => text.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "feld";
/** Bild fürs Einbetten verkleinern (max. 1400 px breit, JPEG) – so bleibt der Vertrag klein und das PDF scharf genug. */
export async function readImage(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden.")); reader.readAsDataURL(file); });
  if (!/^data:image\/(png|jpeg|jpg|webp|gif)/i.test(dataUrl)) throw new Error("Bitte ein Bild (PNG oder JPG) wählen.");
  return new Promise<string>((resolve) => { const img = new Image(); img.onload = () => { const scale = Math.min(1, 1400 / img.width); const canvas = document.createElement("canvas"); canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale); const ctx = canvas.getContext("2d"); if (!ctx) return resolve(dataUrl); if (!/png/i.test(dataUrl)) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height); } ctx.drawImage(img, 0, 0, canvas.width, canvas.height); resolve(/png/i.test(dataUrl) && dataUrl.length < 900_000 ? dataUrl : canvas.toDataURL(/png/i.test(dataUrl) ? "image/png" : "image/jpeg", 0.86)); }; img.onerror = () => resolve(dataUrl); img.src = dataUrl; });
}
export const CUSTOMER_FIELDS: Array<[string, string, string]> = [["firma", "Firma", "z. B. Sonnenstrom Müller GmbH"], ["name", "Ansprechpartner", "Vor- und Nachname"], ["email", "E-Mail", "name@firma.de"], ["strasse", "Straße und Nr.", ""], ["plzOrt", "PLZ und Ort", ""]];

export function CustomerPicker({ leadId, onPick, onClear }: { leadId: number | null; onPick: (leadId: number, values: ContractValues) => void; onClear: () => void }) {
  const [query, setQuery] = useState(""); const [open, setOpen] = useState(false); const [debounced, setDebounced] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(query), 220); return () => window.clearTimeout(timer); }, [query]);
  const options = trpc.leadops.contractLeadOptions.useQuery({ query: debounced }, { enabled: open, staleTime: 10_000 });
  const utils = trpc.useUtils();
  const pick = async (id: number) => { try { const values = await utils.leadops.contractValuesFromLead.fetch({ leadId: id }); onPick(id, Object.fromEntries(Object.entries(values).filter(([, value]) => value)) as ContractValues); setOpen(false); setQuery(""); toast.success("Kunde übernommen."); } catch (error) { toast.error(error instanceof Error ? error.message : "Kontakt konnte nicht geladen werden."); } };
  return <div className="ct-picker">
    <div className="ct-picker-input"><Search className="h-4 w-4" aria-hidden="true" /><input value={query} placeholder="Kunde aus den Kontakten suchen – Firma, Name, E-Mail, Ort …" aria-label="Kunde aus den Kontakten suchen" onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 180)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} /></div>
    {leadId ? <div className="ct-picker-linked"><UserCheck className="h-3.5 w-3.5" aria-hidden="true" /> Mit Kontakt verknüpft<button type="button" onClick={onClear}>Verknüpfung lösen</button></div> : null}
    {open && <ul className="ct-picker-list" role="listbox">{options.isLoading ? <li className="is-empty">Wird gesucht …</li> : !(options.data ?? []).length ? <li className="is-empty">Kein Kontakt gefunden{query ? ` für „${query}“` : ""}.</li> : (options.data ?? []).map((option) => <li key={option.id}><button type="button" role="option" aria-selected={option.id === leadId} onMouseDown={(event) => event.preventDefault()} onClick={() => void pick(option.id)}><strong>{option.company || option.name || option.email}</strong><small>{[option.company ? option.name : "", option.email, option.place].filter(Boolean).join(" · ")}</small></button></li>)}</ul>}
  </div>;
}

/* ---------------- Vertragsangabe mit Schnellauswahl (Liefergebiet: Deutschland / Bundesländer / PLZ + Umkreis) ---------------- */
const RADIUS_OPTIONS = [10, 25, 50, 75, 100, 150];
export function DetailEditor({ block, onChange, onFocus, showLabel = true }: { block: Extract<ContractBlock, { type: "detail" }>; onChange: (block: Extract<ContractBlock, { type: "detail" }>) => void; onFocus?: () => void; showLabel?: boolean }) {
  const presets = DETAIL_PRESETS[block.key] ?? []; const region = isRegionDetail(block);
  const long = (block.hint ?? "").length > 60 || ["leistung", "konditionen", "danach"].includes(block.key); // fest je Angabe – kein Wechsel beim Tippen (sonst springt der Cursor)
  const textInput = long
    ? <textarea className="ct-textarea" rows={3} value={block.value} placeholder={block.hint || ""} onFocus={onFocus} onChange={(event) => onChange({ ...block, value: event.target.value, region: null })} />
    : <Input value={block.value} placeholder={block.hint || ""} onFocus={onFocus} onChange={(event) => onChange({ ...block, value: event.target.value, region: null })} />;
  return <div className="ct-field ct-detail" onFocusCapture={onFocus}>{showLabel && <span>{block.label}</span>}
    {region ? <RegionPicker value={block.region ?? null} text={block.value} onChange={(next) => onChange({ ...block, region: next, value: regionText(next) })} /> : textInput}
    {region && <small className="ct-detail-result">{block.value ? <>Im Vertrag: <strong>{block.value}</strong></> : "Noch kein Gebiet gewählt"}</small>}
    {!region && presets.length > 0 && <div className="ct-presets">{presets.map((preset) => <button key={preset} type="button" className={block.value === preset ? "is-on" : ""} onClick={() => { onFocus?.(); onChange({ ...block, value: preset }); }}>{preset}</button>)}</div>}
  </div>;
}
export function RegionPicker({ value, text, onChange }: { value: ContractRegion | null; text: string; onChange: (region: ContractRegion) => void }) {
  const current: ContractRegion = value ?? (/deutschlandweit/i.test(text) ? { mode: "deutschland" } : { mode: "bundeslaender", states: BUNDESLAENDER.filter((name) => text.includes(name)) });
  const [plzText, setPlzText] = useState((current.plz ?? []).join(", "));
  const states = current.states ?? [];
  const toggle = (name: string) => onChange({ ...current, mode: "bundeslaender", states: states.includes(name) ? states.filter((item) => item !== name) : [...states, name] });
  return <div className="ct-region">
    <div className="dashboard-segments ct-region-modes"><button type="button" className={current.mode === "deutschland" ? "active" : ""} onClick={() => onChange({ mode: "deutschland" })}>Deutschlandweit</button><button type="button" className={current.mode === "bundeslaender" ? "active" : ""} onClick={() => onChange({ mode: "bundeslaender", states })}>Bundesländer</button><button type="button" className={current.mode === "plz" ? "active" : ""} onClick={() => onChange({ mode: "plz", plz: parsePlzList(plzText), radiusKm: current.radiusKm ?? 50 })}>PLZ + Umkreis</button></div>
    {current.mode === "bundeslaender" && <><div className="ct-presets ct-states">{BUNDESLAENDER.map((name) => <button key={name} type="button" className={states.includes(name) ? "is-on" : ""} aria-pressed={states.includes(name)} onClick={() => toggle(name)}>{states.includes(name) ? "✓ " : ""}{name}</button>)}</div><div className="ct-region-tools"><button type="button" onClick={() => onChange({ mode: "bundeslaender", states: [...BUNDESLAENDER] })}>Alle auswählen</button>{states.length > 0 && <button type="button" onClick={() => onChange({ mode: "bundeslaender", states: [] })}>Auswahl leeren</button>}<span>{states.length} von {BUNDESLAENDER.length}</span></div></>}
    {current.mode === "plz" && <div className="ct-plz"><label className="ct-field"><span>Postleitzahlen oder PLZ-Gebiete</span><Input value={plzText} placeholder="z. B. 60311, 65183 oder 60, 61, 63" onChange={(event) => { setPlzText(event.target.value); onChange({ ...current, mode: "plz", plz: parsePlzList(event.target.value) }); }} /></label>
      <label className="ct-field"><span>Umkreis</span><select className="lead-action-select" value={current.radiusKm ?? 0} onChange={(event) => onChange({ ...current, mode: "plz", radiusKm: Number(event.target.value) || null })}><option value={0}>ohne Umkreis</option>{RADIUS_OPTIONS.map((km) => <option key={km} value={km}>{km} km</option>)}</select></label>
      {(current.plz ?? []).length > 0 && <div className="ct-presets">{(current.plz ?? []).map((code) => <button key={code} type="button" className="is-on" title="Entfernen" onClick={() => { const next = (current.plz ?? []).filter((item) => item !== code); setPlzText(next.join(", ")); onChange({ ...current, mode: "plz", plz: next }); }}>{code} ✕</button>)}</div>}</div>}
  </div>;
}
