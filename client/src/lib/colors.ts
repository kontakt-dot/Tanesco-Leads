/** Farben für Lead-Kategorien und Lead-Status – überall gleich (Leads-Tabelle, Kategorien-Seite, Quick View, Lead-Seite). */
export const CATEGORY_PALETTE = ["#2563eb", "#7c3aed", "#0d9488", "#d97706", "#db2777", "#0891b2", "#65a30d", "#ea580c", "#4f46e5", "#0f766e", "#b45309", "#9333ea"] as const;

/** Farbe einer Kategorie: gespeicherte Farbe, sonst stabil aus der ID abgeleitet. */
export function categoryColor(category: { id: number; color?: string | null } | null | undefined): string {
  if (!category) return "#64748b";
  if (category.color && /^#[0-9a-fA-F]{6}$/.test(category.color)) return category.color;
  return CATEGORY_PALETTE[Math.abs(category.id) % CATEGORY_PALETTE.length];
}

/** Lead-Status: Farbe + lesbares Label. */
export const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  neu: { color: "#2563eb", label: "Neu" },
  genehmigt: { color: "#0d9488", label: "Freigegeben" },
  zugewiesen: { color: "#16a34a", label: "Zugewiesen" },
  reklamiert: { color: "#dc2626", label: "Reklamiert" },
  fehlerhaft: { color: "#ea580c", label: "Fehlerhaft" },
  deaktiviert: { color: "#64748b", label: "Deaktiviert" },
  hängend: { color: "#d97706", label: "Hängend" },
  dublette: { color: "#7c3aed", label: "Dublette" },
};
export const statusStyle = (status: string) => STATUS_STYLE[status] ?? { color: "#64748b", label: status };

/** Hex → rgba mit Transparenz (für zarte Hintergründe). */
export function tint(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

/** Kräftige Farbkapsel: die Farbe als CSS-Variable, die Klasse „cat-strong“ macht daraus in Hell und Dunkel gut lesbare Schrift auf getöntem Grund. */
export function catPill(hex: string): import("react").CSSProperties { return { ["--cat" as string]: hex } as import("react").CSSProperties; }
