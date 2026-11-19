/**
 * Vertrag direkt im Dokument bearbeiten: Das Blatt sieht aus wie beim Kunden. Ein Klick auf eine Stelle macht sie bearbeitbar –
 * genau dort, wo sie steht. „+“ über einem Baustein fügt davor einen neuen ein; Verschieben und Entfernen stehen am Baustein.
 * Texte zeigen in der Ansicht die eingesetzten Werte (Firma, Preis …), beim Bearbeiten die Platzhalter wie {{firma}}.
 */
import { Fragment, useLayoutEffect, useRef, useState, type ChangeEvent, type MouseEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDown, ArrowUp, PenLine, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CONTRACT_BLOCK_TYPES, DEFAULT_CONTRACT_DESIGN, detailValues, fillContract, formatContractDate, newContractBlock, type ContractBlock, type ContractBlockType, type ContractValues } from "../../../shared/contracts";
import { BLOCK_ICON, CUSTOMER_FIELDS, CustomerPicker, DetailEditor, readImage, slug } from "@/components/contract-parts";

const labelOf = (type: ContractBlockType) => CONTRACT_BLOCK_TYPES.find((item) => item.type === type)?.label ?? type;
const stop = (event: MouseEvent) => event.stopPropagation();
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lines = (text: string): ReactNode => text.split("\n").map((line, index) => <Fragment key={index}>{index > 0 && <br />}{line}</Fragment>);

/** Textfeld, das mit dem Inhalt wächst – sieht aus wie der Text im Vertrag. */
function AutoText({ value, onChange, onBlur, className, placeholder, label }: { value: string; onChange: (value: string) => void; onBlur?: () => void; className: string; placeholder: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { const node = ref.current; if (!node) return; node.style.height = "0px"; node.style.height = `${node.scrollHeight}px`; }, [value]);
  useLayoutEffect(() => { const node = ref.current; if (!node) return; node.focus({ preventScroll: true }); const end = node.value.length; try { node.setSelectionRange(end, end); } catch { /* egal */ } }, []);
  return <textarea ref={ref} rows={1} className={className} value={value} placeholder={placeholder} aria-label={label} spellCheck onClick={stop} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />;
}

/** Auswahl, welcher Baustein eingefügt wird. */
function InsertMenu({ onAdd }: { onAdd: (type: ContractBlockType) => void }) {
  return <div className="vd-menu" role="menu" aria-label="Baustein einfügen" onClick={stop}>{CONTRACT_BLOCK_TYPES.map((item) => { const Icon = BLOCK_ICON[item.type]; return <button key={item.type} type="button" role="menuitem" title={item.hint} onClick={() => onAdd(item.type)}><Icon aria-hidden="true" /><span>{item.label}</span></button>; })}</div>;
}

export type DocEditorProps = {
  blocks: ContractBlock[]; onBlocks: (blocks: ContractBlock[]) => void;
  /** eigene Werte des Vertrags: Kunde und „vertreten durch“ */
  values: ContractValues; onValue: (key: string, value: string) => void;
  /** alles zusammen für die Anzeige: Anbieter aus den Einstellungen plus die eigenen Werte */
  shownValues: ContractValues;
  leadId: number | null; onLead: (leadId: number | null, values?: ContractValues) => void;
  /** Vorlage: ohne Kunde und Unterschrift · gesperrt: liegt schon beim Kunden */
  template: boolean; locked: boolean;
  active: string | null; onActive: (id: string | null) => void;
  onSign: () => void;
};

export default function ContractDocEditor({ blocks, onBlocks, values, onValue, shownValues, leadId, onLead, template, locked, active, onActive, onSign }: DocEditorProps) {
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null); const [pickFor, setPickFor] = useState<number | null>(null);
  const all: ContractValues = { ...detailValues(blocks), ...shownValues };
  const fill = (text: string) => fillContract(text, all, true);
  const logoSrc = (src?: string | null) => { const value = (src ?? DEFAULT_CONTRACT_DESIGN.logoUrl) || ""; return value.startsWith("/") ? `${window.location.origin}${value}` : value; };
  const set = (index: number, next: ContractBlock) => onBlocks(blocks.map((block, i) => (i === index ? next : block)));
  const move = (index: number, delta: number) => { const target = index + delta; if (target < 0 || target >= blocks.length) return; const copy = [...blocks]; const [item] = copy.splice(index, 1); copy.splice(target, 0, item); onBlocks(copy); };
  const removeAt = (index: number) => { onBlocks(blocks.filter((_, i) => i !== index)); onActive(null); };
  const insert = (index: number, type: ContractBlockType) => { const block = newContractBlock(type); const copy = [...blocks]; copy.splice(index, 0, block); onBlocks(copy); setInsertAt(null); onActive(type === "divider" || type === "pagebreak" ? null : block.id); };
  const pickImage = (index: number) => { setPickFor(index); fileRef.current?.click(); };
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file || pickFor === null) return; try { const src = await readImage(file); const block = blocks[pickFor]; if (block?.type === "image") set(pickFor, { ...block, src, alt: block.alt || file.name }); if (block?.type === "logo") set(pickFor, { ...block, src }); } catch (error) { toast.error(error instanceof Error ? error.message : "Bild konnte nicht geladen werden."); } };
  const customerLines = [values.firma, values.name, values.strasse, values.plzOrt, values.email].filter(Boolean);

  const content = (block: ContractBlock, index: number, on: boolean): ReactNode => {
    switch (block.type) {
      case "heading": return on ? <AutoText className="c-h vd-text" label="Überschrift" value={block.text} placeholder="Überschrift" onChange={(text) => set(index, { ...block, text })} /> : <h2 className="c-h">{block.text.trim() ? fill(block.text) : <i className="c-dots">Überschrift schreiben …</i>}</h2>;
      case "text": return on ? <AutoText className="c-p vd-text" label="Text" value={block.text} placeholder="Text schreiben – Platzhalter wie {{firma}} oder {{preis}} werden im Vertrag ersetzt" onChange={(text) => set(index, { ...block, text })} /> : <div className="c-p">{block.text.trim() ? fill(block.text).split(/\n{2,}/).map((part, i) => <p key={i}>{lines(part)}</p>) : <p><i className="c-dots">Text schreiben …</i></p>}</div>;
      case "bullets": return on ? <AutoText className="vd-text vd-bullets" label="Aufzählung, ein Punkt je Zeile" value={block.items.join("\n")} placeholder="Ein Punkt je Zeile" onChange={(text) => set(index, { ...block, items: text.split("\n") })} onBlur={() => set(index, { ...block, items: block.items.map((item) => item.trim()).filter(Boolean) })} /> : <ul className="c-ul">{block.items.filter((item) => item.trim()).length ? block.items.filter((item) => item.trim()).map((item, i) => <li key={i}>{fill(item)}</li>) : <li><i className="c-dots">Punkte schreiben …</i></li>}</ul>;
      case "detail": return <>
        <div className={`c-kv ${block.value.trim() ? "" : "is-open"}`}><span>{block.label}</span><strong>{block.value.trim() ? lines(block.value.trim()) : <i className="c-dots">noch eintragen</i>}</strong></div>
        {on && <div className="vd-edit" onClick={stop}><DetailEditor block={block} showLabel={false} onChange={(next) => set(index, next)} />
          <details className="vd-more"><summary>Bezeichnung und Platzhalter ändern</summary><div className="ct-fields"><label className="ct-field is-half"><span>Bezeichnung</span><Input value={block.label} onChange={(event) => set(index, { ...block, label: event.target.value, key: block.key.startsWith("angabe_") || block.key === slug(block.label) ? slug(event.target.value) : block.key })} /></label><label className="ct-field is-half"><span>Platzhalter-Schlüssel</span><Input value={block.key} onChange={(event) => set(index, { ...block, key: slug(event.target.value) })} /></label></div><p className="vd-help">Diese Angabe füllst du selbst aus. Im Text kannst du sie als {"{{"}{block.key}{"}}"} einsetzen.</p></details></div>}
      </>;
      case "field": return <>
        <div className="c-field is-static"><span>{block.label}{block.required ? " *" : ""}</span><strong><i className="c-dots">füllt der Kunde beim Unterschreiben aus</i></strong></div>
        {on && <div className="vd-edit" onClick={stop}><div className="ct-fields"><label className="ct-field is-half"><span>Bezeichnung</span><Input value={block.label} onChange={(event) => set(index, { ...block, label: event.target.value, key: block.key.startsWith("feld_") || block.key === slug(block.label) ? slug(event.target.value) : block.key })} /></label><label className="ct-field is-half"><span>Hinweis im Feld</span><Input value={block.placeholder ?? ""} onChange={(event) => set(index, { ...block, placeholder: event.target.value })} /></label></div><label className="lead-action-check text-xs"><input type="checkbox" checked={block.required !== false} onChange={(event) => set(index, { ...block, required: event.target.checked })} /> Pflichtfeld</label><p className="vd-help">Im Text nutzbar als {"{{"}{block.key}{"}}"}.</p></div>}
      </>;
      case "date": return <>
        <div className="c-date"><span>{block.label ?? "Datum"}</span><strong>{block.mode === "fest" ? formatContractDate(block.value) || <i className="c-dots">Datum wählen</i> : <i className="c-dots">Datum der Unterschrift</i>}</strong></div>
        {on && <div className="vd-edit" onClick={stop}><div className="ct-fields"><label className="ct-field is-half"><span>Bezeichnung</span><Input value={block.label ?? ""} onChange={(event) => set(index, { ...block, label: event.target.value })} /></label><label className="ct-field is-half"><span>Art</span><select className="lead-action-select" value={block.mode} onChange={(event) => set(index, { ...block, mode: event.target.value as "unterschrift" | "fest" })}><option value="unterschrift">Datum der Unterschrift (automatisch)</option><option value="fest">Festes Datum</option></select></label>{block.mode === "fest" && <label className="ct-field is-half"><span>Datum</span><Input type="date" value={block.value ?? ""} onChange={(event) => set(index, { ...block, value: event.target.value })} /></label>}</div></div>}
      </>;
      case "parties": return <>
        <div className="c-parties"><div><span className="c-label">Anbieter</span>{[shownValues.anbieterFirma, shownValues.anbieterAdresse, shownValues.anbieterVertreter ? `vertreten durch ${shownValues.anbieterVertreter}` : "", shownValues.anbieterWebseite ?? ""].filter(Boolean).map((line, i) => <div key={i}>{line}</div>)}</div><div><span className="c-label">Kunde</span>{template ? <div><i className="c-dots">steht später im Vertrag</i></div> : customerLines.length ? customerLines.map((line, i) => <div key={i}>{line}</div>) : <div><i className="c-dots">Kunde eintragen</i></div>}</div></div>
        {on && (template ? <div className="vd-edit" onClick={stop}><p className="vd-help">Zeigt Anbieter und Kunde nebeneinander. In der Vorlage bleibt der Kunde leer – er kommt erst im Vertrag dazu.</p></div> : <div className="vd-edit vd-parties-edit" onClick={stop}>
          <div><strong className="vd-edit-title">Anbieter</strong><p className="vd-help">Firma und Anschrift kommen aus Einstellungen → Branding.</p><label className="ct-field"><span>Vertreten durch (dein Name)</span><Input value={values.anbieterVertreter ?? ""} placeholder="z. B. Max Mustermann" onChange={(event) => onValue("anbieterVertreter", event.target.value)} /></label></div>
          <div><strong className="vd-edit-title">Kunde</strong><CustomerPicker leadId={leadId} onPick={(id, picked) => onLead(id, picked)} onClear={() => onLead(null)} /><div className="ct-fields">{CUSTOMER_FIELDS.map(([key, label, placeholder]) => <label key={key} className={`ct-field ${key === "strasse" || key === "plzOrt" ? "is-half" : ""}`}><span>{label}</span><Input value={values[key] ?? ""} placeholder={placeholder} onChange={(event) => onValue(key, event.target.value)} /></label>)}</div><p className="vd-help">An die E-Mail-Adresse geht der Link zum Unterschreiben.</p></div>
        </div>)}
      </>;
      case "signature": { const own = block.party === "anbieter"; const who = block.signedName || shownValues.anbieterVertreter; return <>
        <div className="c-sig">{own ? <div className={`c-sig-box ${block.image ? "is-signed" : "is-todo"}`}>{block.image ? <img src={block.image} alt="Deine Unterschrift" /> : template ? "Hier unterschreibst du im Vertrag" : "Noch nicht unterschrieben"}</div> : <div className="c-sig-box is-customer">Hier unterschreibt der Kunde online</div>}<div className="c-sig-line">{block.label ?? (own ? "Unterschrift Anbieter" : "Unterschrift Kunde")}{own && who ? ` · ${who}` : ""}{own && shownValues.anbieterFirma ? `, ${shownValues.anbieterFirma}` : ""}{own && block.signedAt ? ` · ${formatContractDate(block.signedAt)}` : ""}</div></div>
        {on && <div className="vd-edit" onClick={stop}>{own && !template && <div className="ct-inline">{block.image ? <><Button variant="outline" size="sm" onClick={onSign}>Neu unterschreiben</Button><Button variant="ghost" size="sm" onClick={() => set(index, { ...block, image: null, signedName: null, signedAt: null })}>Unterschrift entfernen</Button></> : <Button className="flux-button" size="sm" onClick={onSign}><PenLine /> Jetzt selbst unterschreiben</Button>}</div>}{!own && <p className="vd-help">Der Kunde unterschreibt online über den Link aus der E-Mail. Zeitpunkt, IP-Adresse und Gerät werden dabei festgehalten.</p>}<div className="ct-fields"><label className="ct-field is-half"><span>Wer unterschreibt</span><select className="lead-action-select" value={block.party} onChange={(event) => set(index, { ...block, party: event.target.value as "kunde" | "anbieter", label: event.target.value === "kunde" ? "Unterschrift Kunde" : "Unterschrift Anbieter" })}><option value="kunde">Kunde (online, mit Nachweis)</option><option value="anbieter">Anbieter (dein Feld)</option></select></label><label className="ct-field is-half"><span>Beschriftung</span><Input value={block.label ?? ""} onChange={(event) => set(index, { ...block, label: event.target.value })} /></label></div></div>}
      </>; }
      case "logo": return <>
        <div className="c-logo"><img src={logoSrc(block.src)} alt="Logo" style={{ height: clamp(block.height ?? 36, 16, 120) }} /></div>
        {on && <div className="vd-edit" onClick={stop}><div className="ct-inline"><Button variant="outline" size="sm" onClick={() => pickImage(index)}>{block.src ? "Logo tauschen" : "Eigenes Logo hochladen"}</Button>{block.src && <Button variant="ghost" size="sm" onClick={() => set(index, { ...block, src: null })}>Standard-Logo</Button>}<label className="ct-field is-small"><span>Höhe (px)</span><Input type="number" min={16} max={120} value={block.height ?? 36} onChange={(event) => set(index, { ...block, height: Number(event.target.value) || 36 })} /></label></div></div>}
      </>;
      case "image": return <>
        {block.src ? <div className="c-img" style={{ textAlign: block.align ?? "center" }}><img src={block.src} alt={block.alt ?? ""} style={{ width: `${clamp(block.width ?? 60, 10, 100)}%` }} /></div> : <div className="c-img c-empty">Bild wählen …</div>}
        {on && <div className="vd-edit" onClick={stop}><div className="ct-inline"><Button variant="outline" size="sm" onClick={() => pickImage(index)}>{block.src ? "Bild tauschen" : "Bild wählen"}</Button><label className="ct-field is-small"><span>Breite (%)</span><Input type="number" min={10} max={100} value={block.width ?? 60} onChange={(event) => set(index, { ...block, width: Number(event.target.value) || 60 })} /></label><label className="ct-field is-small"><span>Ausrichtung</span><select className="lead-action-select" value={block.align ?? "center"} onChange={(event) => set(index, { ...block, align: event.target.value as "left" | "center" | "right" })}><option value="left">links</option><option value="center">mittig</option><option value="right">rechts</option></select></label></div></div>}
      </>;
      case "divider": return <hr className="c-hr" />;
      case "pagebreak": return <div className="vd-break" aria-label="Seitenumbruch"><span>Seitenumbruch – ab hier neue Seite im PDF</span></div>;
    }
  };

  return <div className={`vd-sheet ${locked ? "is-locked" : ""}`} onClick={() => { onActive(null); setInsertAt(null); }}>
    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
    {blocks.map((block, index) => { const on = !locked && active === block.id; const label = labelOf(block.type); return <div key={block.id} className={`vd-block is-${block.type} ${on ? "is-active" : ""}`} data-b={block.id} tabIndex={locked ? undefined : 0} aria-label={locked ? undefined : `${label} – zum Bearbeiten öffnen`} onKeyDown={(event) => { if (locked || event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setInsertAt(null); onActive(block.id); } else if (event.key === "Escape") onActive(null); }} onClick={(event) => { event.stopPropagation(); if (locked) return; setInsertAt(null); if (!on) onActive(block.id); }}>
      {!locked && <button type="button" className={`vd-plus ${insertAt === index ? "is-open" : ""}`} title="Davor einen Baustein einfügen" aria-label={`Vor „${label}“ einen Baustein einfügen`} aria-expanded={insertAt === index} onClick={(event) => { event.stopPropagation(); onActive(null); setInsertAt(insertAt === index ? null : index); }}><Plus aria-hidden="true" /></button>}
      {insertAt === index && <InsertMenu onAdd={(type) => insert(index, type)} />}
      {!locked && <div className="vd-tools" role="group" aria-label={`${label}: verschieben oder entfernen`} onClick={stop}><span>{label}</span><button type="button" title="Nach oben" aria-label="Nach oben" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp aria-hidden="true" /></button><button type="button" title="Nach unten" aria-label="Nach unten" disabled={index === blocks.length - 1} onClick={() => move(index, 1)}><ArrowDown aria-hidden="true" /></button><button type="button" className="is-danger" title="Entfernen" aria-label={`${label} entfernen`} onClick={() => removeAt(index)}><Trash2 aria-hidden="true" /></button></div>}
      {content(block, index, on)}
    </div>; })}
    {!locked && <div className="vd-end" onClick={stop}><button type="button" className="vd-add" aria-expanded={insertAt === blocks.length} onClick={() => setInsertAt(insertAt === blocks.length ? null : blocks.length)}><Plus aria-hidden="true" /> Baustein hinzufügen</button>{insertAt === blocks.length && <InsertMenu onAdd={(type) => insert(blocks.length, type)} />}</div>}
  </div>;
}
