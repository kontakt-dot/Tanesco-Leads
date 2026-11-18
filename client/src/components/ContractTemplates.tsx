/**
 * Vorlagen für Verträge: die mitgelieferten (Leadliefervertrag, Testphase, leerer Vertrag) und die eigenen.
 * Jede Vorlage lässt sich ansehen, als neuer Vertrag starten und bearbeiten. Mitgelieferte Vorlagen lassen sich anpassen
 * und jederzeit auf den Lieferzustand zurücksetzen; eigene lassen sich löschen.
 */
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { confirmAction } from "@/lib/confirm";
import { trpc } from "@/lib/trpc";
import { BookMarked, FilePlus2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ContractBlock, ContractStarterKind } from "../../../shared/contracts";
import { whenText } from "../../../shared/contract-tracking";

type Defaults = inferRouterOutputs<AppRouter>["leadops"]["contractDefaults"];
type TemplateRow = inferRouterOutputs<AppRouter>["leadops"]["listContractTemplates"][number];
type Outline = { sections: number; details?: number; fields?: number };
/** Was der Editor braucht, um eine Vorlage zu bearbeiten (id = eigene Vorlage, starterKind = mitgelieferte). */
export type TemplateTarget = { id: number | null; name: string; title: string; blocks: ContractBlock[]; starterKind: ContractStarterKind | null };
export type ContractSeed = { title: string; blocks: ContractBlock[]; templateId?: number | null };

const PAPER_LINES = 7;
const headingsOf = (blocks: ContractBlock[]) => blocks.filter((block): block is Extract<ContractBlock, { type: "heading" }> => block.type === "heading").map((block) => block.text.trim()).filter(Boolean);
const outlineText = (outline: Outline) => [`${outline.sections} ${outline.sections === 1 ? "Abschnitt" : "Abschnitte"}`, outline.details ? `${outline.details} ${outline.details === 1 ? "Angabe" : "Angaben"}` : "", outline.fields ? `${outline.fields} ${outline.fields === 1 ? "Feld" : "Felder"} für den Kunden` : ""].filter(Boolean).join(", ");

/** Die Vorlage als kleines Blatt: Titel und die ersten Überschriften – so sieht man auf einen Blick, was drinsteht. */
function Paper({ title, blocks }: { title: string; blocks: ContractBlock[] }) {
  const headings = headingsOf(blocks); const first = headings[0] === title ? headings.slice(1) : headings; const shown = first.slice(0, PAPER_LINES);
  return <div className="vt-paper" aria-hidden="true"><strong>{title}</strong>{shown.length ? <ol>{shown.map((text, index) => <li key={index}>{text}</li>)}</ol> : <p>Noch ohne Überschriften</p>}{first.length > shown.length && <small>und {first.length - shown.length} weitere</small>}</div>;
}

export default function ContractTemplates({ defaults, templates, onUse, onEdit, onChanged }: { defaults: Defaults | null; templates: TemplateRow[]; onUse: (seed: ContractSeed) => void; onEdit: (target: TemplateTarget) => void; onChanged: () => void }) {
  const reset = trpc.leadops.resetContractStarter.useMutation({ onSuccess: () => { toast.success("Zurückgesetzt – die Vorlage ist wieder im Lieferzustand."); onChanged(); }, onError: (error) => toast.error(error.message) });
  const remove = trpc.leadops.deleteContractTemplate.useMutation({ onSuccess: () => { toast.success("Vorlage gelöscht."); onChanged(); }, onError: (error) => toast.error(error.message) });
  const starters = defaults?.starters ?? [];
  return <div className="vt-templates">
    <section aria-labelledby="vt-tpl-built"><div className="vt-tpl-head"><h2 id="vt-tpl-built">Mitgelieferte Vorlagen</h2><p>Fertig geschrieben und sofort nutzbar. Du kannst jede an dein Geschäft anpassen – „Zurücksetzen“ holt den Lieferzustand zurück.</p></div>
      <ul className="vt-tpl-grid">{starters.map((starter) => <li key={starter.kind} className={`vt-tpl ${starter.custom ? "is-custom" : ""}`} data-kind={starter.kind}>
        <Paper title={starter.title} blocks={starter.blocks} />
        <div className="vt-tpl-body"><p className="vt-tpl-name"><strong>{starter.label}</strong>{starter.custom ? <span className="vt-tag is-custom" title={starter.updatedAt ? `Zuletzt geändert ${whenText(starter.updatedAt)}` : undefined}>von dir angepasst</span> : <span className="vt-tag">mitgeliefert</span>}</p><p className="vt-tpl-hint">{starter.hint}</p><p className="vt-tpl-meta">{outlineText(starter.outline)}</p></div>
        <div className="vt-tpl-actions"><button type="button" className="vt-btn is-solid" onClick={() => onUse({ title: starter.title, blocks: starter.blocks })}><FilePlus2 /> Vertrag daraus</button><button type="button" className="vt-btn" onClick={() => onEdit({ id: starter.templateId, name: starter.label, title: starter.title, blocks: starter.blocks, starterKind: starter.kind })}><Pencil /> Bearbeiten</button>{starter.custom && <button type="button" className="vt-btn" disabled={reset.isPending} title="Deine Änderungen verwerfen und die mitgelieferte Fassung wiederherstellen" onClick={async () => { if (await confirmAction(`Vorlage „${starter.label}“ zurücksetzen? Deine Änderungen an dieser Vorlage gehen verloren. Verträge, die du schon daraus erstellt hast, bleiben unverändert.`, { danger: true, confirmLabel: "Zurücksetzen" })) reset.mutate({ kind: starter.kind }); }}><RotateCcw /> Zurücksetzen</button>}</div>
      </li>)}</ul>
    </section>
    <section aria-labelledby="vt-tpl-own"><div className="vt-tpl-head"><h2 id="vt-tpl-own">Eigene Vorlagen</h2><p>Aus einem Vertrag über „Als Vorlage“ gespeichert – oder hier neu angelegt.</p></div>
      <ul className="vt-tpl-grid">{templates.map((template) => <li key={template.id} className="vt-tpl is-own" data-template={template.id}>
        <Paper title={template.title ?? template.name} blocks={template.blocks} />
        <div className="vt-tpl-body"><p className="vt-tpl-name"><strong><BookMarked aria-hidden="true" /> {template.name}</strong></p><p className="vt-tpl-meta">{outlineText(template.outline)}</p><p className="vt-tpl-hint">Zuletzt geändert {whenText(template.updatedAt)}</p></div>
        <div className="vt-tpl-actions"><button type="button" className="vt-btn is-solid" onClick={() => onUse({ title: template.title ?? template.name, blocks: template.blocks, templateId: template.id })}><FilePlus2 /> Vertrag daraus</button><button type="button" className="vt-btn" onClick={() => onEdit({ id: template.id, name: template.name, title: template.title ?? template.name, blocks: template.blocks, starterKind: null })}><Pencil /> Bearbeiten</button><button type="button" className="vt-btn is-icon" title="Vorlage löschen" aria-label={`Vorlage „${template.name}“ löschen`} disabled={remove.isPending} onClick={async () => { if (await confirmAction(`Vorlage „${template.name}“ löschen? Verträge, die du schon daraus erstellt hast, bleiben erhalten.`, { danger: true, confirmLabel: "Löschen" })) remove.mutate({ id: template.id }); }}><Trash2 /></button></div>
      </li>)}
        <li className="vt-tpl is-new"><button type="button" disabled={!defaults} onClick={() => defaults && onEdit({ id: null, name: "", title: "Neuer Vertrag", blocks: defaults.empty.blocks, starterKind: null })}><Plus aria-hidden="true" /><strong>Neue Vorlage</strong><small>Mit Logo, Vertragsparteien und Unterschrift – den Rest schreibst du selbst.</small></button></li>
      </ul>
    </section>
  </div>;
}
