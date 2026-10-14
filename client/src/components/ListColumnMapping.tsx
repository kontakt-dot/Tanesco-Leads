import { COLD_FIELDS, placeholderKey, type ColdRow, type ColumnTarget } from "../../../shared/cold-list";

/**
 * Spalten einer hochgeladenen Liste zuordnen: Für jede Spalte der Datei (mit Beispielwert aus der ersten Zeile) wählt man,
 * ob sie ein Standardfeld füllt (Vorname, Firma, Telefon …), als Platzhalter {{spaltenname}} in E-Mails nutzbar wird oder wegfällt.
 * Die automatische Erkennung ist vorbelegt; jede Änderung wertet die Datei sofort neu aus.
 */
export default function ListColumnMapping({ columns, mapping, sample, onChange }: { columns: string[]; mapping: ColumnTarget[]; sample: ColdRow | null; onChange: (next: ColumnTarget[]) => void }) {
  if (!columns.length) return null;
  const placeholders = columns.map((column, index) => mapping[index] === "platzhalter" ? placeholderKey(column) : "").filter(Boolean);
  const sampleOf = (index: number) => { const target = mapping[index]; if (!sample) return ""; if (target === "platzhalter") return sample.extra?.[placeholderKey(columns[index])] ?? ""; if (target === "ignorieren") return ""; return (sample[target] as string | null | undefined) ?? ""; };
  return <div className="list-mapping">
    <div className="list-mapping-head"><span className="eyebrow">SPALTEN ZUORDNEN</span><small>Automatisch erkannt – bei Bedarf ändern. Unbekannte Spalten werden zu Platzhaltern.</small></div>
    <table className="list-mapping-table"><thead><tr><th>Spalte in der Datei</th><th>Übernehmen als</th><th>Beispiel</th></tr></thead><tbody>
      {columns.map((column, index) => { const target = mapping[index] ?? "ignorieren"; const used = (field: string) => mapping.some((item, other) => other !== index && item === field); return <tr key={`${column}-${index}`} className={target === "ignorieren" ? "is-off" : ""}>
        <td><strong>{column || <em>(ohne Überschrift)</em>}</strong></td>
        <td><select className="lead-action-select list-mapping-select" value={target} aria-label={`Spalte ${column || index + 1} übernehmen als`} onChange={(event) => { const next = [...mapping]; next[index] = event.target.value as ColumnTarget; onChange(next); }}>
          <option value="ignorieren">– nicht übernehmen –</option>
          {COLD_FIELDS.map((field) => <option key={field.key} value={field.key}>{field.label}{used(field.key) ? " (schon belegt)" : ""}</option>)}
          <option value="platzhalter">{column.trim() ? `Platzhalter {{${placeholderKey(column)}}}` : "Platzhalter"}</option>
        </select></td>
        <td className="list-mapping-sample">{sampleOf(index) || <span className="text-slate-500">–</span>}</td>
      </tr>; })}
    </tbody></table>
    {placeholders.length > 0 && <p className="list-mapping-note">Platzhalter aus dieser Liste – in E-Mails, SMS und WhatsApp nutzbar: {placeholders.map((key) => <code key={key}>{`{{${key}}}`}</code>)}</p>}
  </div>;
}
