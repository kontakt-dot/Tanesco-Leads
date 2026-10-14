import { AUTO_NOTE_HELP } from "../../../shared/call-notes";

/**
 * Schalter „Automatische Gesprächsnotiz“ – sitzt in jedem Dialer (Telefonie, Kaltakquise-Anrufkampagne, Kampagnen-Einstellungen).
 * An: nach jedem Gespräch entsteht eine Zusammenfassung als Notiz am Kontakt. Aus: keine automatische Notiz.
 */
export default function AutoNoteSwitch({ enabled, onChange, pending = false, label = "Auto-Notiz", compact = false }: { enabled: boolean; onChange: (next: boolean) => void; pending?: boolean; label?: string; compact?: boolean }) {
  return <button type="button" role="switch" aria-checked={enabled} aria-label={`Automatische Gesprächsnotiz ${enabled ? "ausschalten" : "einschalten"}`} title={AUTO_NOTE_HELP} className={`auto-note-switch ${enabled ? "on" : ""}`} disabled={pending} onClick={() => onChange(!enabled)}><i aria-hidden="true" />{compact ? null : <span>{label}: {enabled ? "an" : "aus"}</span>}</button>;
}
