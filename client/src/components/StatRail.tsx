import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";

export type RailStat = { label: string; value: string; hint?: string; icon?: LucideIcon; tone?: "bad" | "warn" | "good"; title?: string };

/**
 * Kennzahlen als eine Leiste – wie auf den neu gestalteten Seiten (Leads, Rohdaten, Reklamationen):
 * über jeder Zahl steht, was sie zählt, darunter eine Zeile, die sie einordnet. Mehr als `columns` Zahlen laufen in die nächste Reihe.
 * Farbe gibt es nur über `tone` – für Zahlen, bei denen etwas zu tun ist („überfällig“).
 */
export default function StatRail({ items, label, columns, className = "" }: { items: RailStat[]; label: string; columns?: number; className?: string }) {
  return <section className={`fx-rail ${className}`.trim()} aria-label={label} style={{ "--fx-rail-n": columns ?? items.length } as CSSProperties}>
    {items.map((item) => { const Icon = item.icon; return <div key={item.label} className={`fx-stat ${item.tone ? `is-${item.tone}` : ""}`.trim()} title={item.title}>
      <span>{Icon && <Icon aria-hidden="true" />}{item.label}</span>
      <strong>{item.value}</strong>
      {item.hint ? <small>{item.hint}</small> : null}
    </div>; })}
  </section>;
}
