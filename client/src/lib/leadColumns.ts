/**
 * Spalten der Leads-Tabelle – welche es gibt, wie breit sie mindestens sind und welche bei wenig Platz von selbst wegfallen.
 * Die Tabelle wird direkt aus diesen Angaben gebaut (kein nachträgliches Umbauen der Seite mehr): Sie sieht nach jedem Wechsel gleich aus.
 */
export const LEAD_COLUMNS = [
  { key: "category", label: "Kategorie", min: 150, track: "minmax(150px,1.1fr)", hint: "Lead-Kategorie: Kürzel und Name" },
  { key: "email", label: "E-Mail", min: 170, track: "minmax(170px,1.45fr)", hint: "E-Mail-Adresse des Kunden" },
  { key: "phone", label: "Telefon", min: 128, track: "minmax(128px,.9fr)", hint: "Rufnummer des Kunden" },
  { key: "status", label: "Status", min: 112, track: "minmax(112px,.8fr)", hint: "Wo der Lead gerade steht" },
  { key: "supplier", label: "Lieferant", min: 96, track: "minmax(96px,.85fr)", hint: "Von wem der Lead kommt" },
  { key: "delivered", label: "Geliefert", min: 104, track: "minmax(104px,.85fr)", hint: "Wann der Lead vom Lieferanten bei uns ankam" },
  { key: "buyer", label: "Käufer", min: 112, track: "minmax(112px,1fr)", hint: "An wen der Lead ging – darunter der Zeitpunkt" },
  { key: "assigned", label: "Zugewiesen", min: 110, track: "minmax(110px,.85fr)", hint: "Wann der Lead einem Käufer zugewiesen wurde" },
  { key: "price", label: "Preis", min: 88, track: "88px", hint: "Preis des Leads" },
] as const;
export type LeadColumnKey = (typeof LEAD_COLUMNS)[number]["key"];
export const LEAD_COLUMN_KEYS = LEAD_COLUMNS.map((column) => column.key) as LeadColumnKey[];
/** Feste Spalten: Auswahl, ID, Lead (Name und Ort) links – Aktionen (Ansicht, Lead-Log) rechts. */
export const FIXED_TRACKS = { select: "34px", id: "84px", lead: "minmax(170px,1.5fr)", actions: "84px" } as const;
const FIXED_WIDTH = 34 + 84 + 170 + 84; const GAP = 10;
/** Diese Spalten fallen bei wenig Platz zuerst weg – in dieser Reihenfolge. */
export const AUTO_HIDE_ORDER: LeadColumnKey[] = ["assigned", "phone", "supplier", "buyer", "email", "delivered"];
export const DEFAULT_HIDDEN: LeadColumnKey[] = ["assigned", "phone"];

/**
 * Welche Spalten passen in die Breite? `hidden` hat der Benutzer selbst ausgeblendet; reicht der Platz trotzdem nicht, fallen weitere
 * von selbst weg (außer mit `force` – dann rollt die Tabelle zur Seite).
 */
export function fitLeadColumns(available: number, hidden: readonly string[], force = false): { visible: LeadColumnKey[]; autoHidden: LeadColumnKey[] } {
  let visible = LEAD_COLUMNS.filter((column) => !hidden.includes(column.key));
  const autoHidden: LeadColumnKey[] = [];
  if (!force && available > 0) {
    let total = FIXED_WIDTH + visible.reduce((sum, column) => sum + column.min, 0) + (visible.length + 3) * GAP + 24;
    for (const key of AUTO_HIDE_ORDER) {
      if (total <= available) break;
      const column = visible.find((item) => item.key === key); if (!column) continue;
      visible = visible.filter((item) => item.key !== key); autoHidden.push(key); total -= column.min + GAP;
    }
  }
  return { visible: visible.map((column) => column.key), autoHidden };
}
/** Raster der Tabelle für die sichtbaren Spalten. Mit `force` bekommt jede Spalte ihre Mindestbreite – die Tabelle wird dann breiter als ihr Rahmen. */
export function leadGridTemplate(visible: readonly LeadColumnKey[], force = false): string {
  const tracks = visible.map((key) => { const column = LEAD_COLUMNS.find((item) => item.key === key)!; return force ? `minmax(${column.min}px,1fr)` : column.track; });
  return [FIXED_TRACKS.select, FIXED_TRACKS.id, FIXED_TRACKS.lead, ...tracks, FIXED_TRACKS.actions].join(" ");
}
/** Gemerkte Auswahl lesen: nur bekannte Spalten zählen (alte Einträge wie „type“ fallen weg). */
export function readHiddenColumns(stored: string | null): LeadColumnKey[] {
  if (stored === null) return [...DEFAULT_HIDDEN];
  try { const parsed: unknown = JSON.parse(stored); return Array.isArray(parsed) ? parsed.filter((key): key is LeadColumnKey => LEAD_COLUMN_KEYS.includes(key as LeadColumnKey)) : [...DEFAULT_HIDDEN]; } catch { return [...DEFAULT_HIDDEN]; }
}
