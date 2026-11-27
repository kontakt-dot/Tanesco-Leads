/**
 * Zahlen im Kopf der Käufer-Seite (Version 389): was ein Käufer bekommen hat.
 * Grundlage sind seine Lieferungen – über eine Bestellung, über eine Station der Lieferkette oder direkt ohne Bestellung (v384) –
 * und seine Bestellungen. Rein gerechnet, damit Server, Vorschau und Tests dasselbe Ergebnis haben.
 */
import { orderStatusLabel } from "./order-status";

export type BuyerDeliveryRow = { id: number; leadId: number; result: string; unitPrice: string | number | null; occurredAt: Date | string };
export type BuyerOrderRow = { status: string; active?: boolean | null };
export type BuyerStats = {
  /** Leads, die er bekommen hat (angeboten, angenommen oder reklamiert) – jeder Lead einmal */
  delivered: number;
  /** davon seit dem 1. dieses Monats */
  thisMonth: number;
  /** Summe der Preise der bekommenen Leads – ohne reklamierte */
  value: number;
  /** Durchschnitt je Lead (ohne reklamierte), auf Cent gerundet */
  averagePrice: number;
  /** reklamierte Leads */
  claimed: number;
  /** reklamiert in Prozent der bekommenen Leads, gerundet */
  claimRate: number;
  /** Leads, die seine Schnittstelle abgelehnt hat (z. B. Dublette) und die er auch danach nicht bekommen hat */
  rejected: number;
  /** wann er zuletzt einen Lead bekommen hat (ISO), sonst null */
  lastDeliveryAt: string | null;
  /** Bestellungen, die gerade Leads bekommen (Status „Aktiv“) */
  ordersActive: number;
  ordersTotal: number;
};

const DELIVERED = new Set(["angeboten", "angenommen", "reklamiert"]);

export function summarizeBuyer(rows: BuyerDeliveryRow[], orders: BuyerOrderRow[], now = new Date()): BuyerStats {
  const seen = new Set<number>();
  const latest = new Map<number, { result: string; price: number; at: number }>();
  for (const row of rows) {
    if (seen.has(row.id)) continue; // dieselbe Lieferung kann über Bestellung und Station zugleich gefunden werden
    seen.add(row.id);
    if (!DELIVERED.has(row.result) && row.result !== "abgelehnt") continue; // „übersprungen“ hat ihn nie erreicht
    const at = new Date(row.occurredAt).getTime();
    if (!Number.isFinite(at)) continue;
    const next = { result: row.result, price: Number(row.unitPrice ?? 0) || 0, at };
    const current = latest.get(row.leadId);
    // Ein bekommener Lead bleibt bekommen, auch wenn ein späterer Versuch abgelehnt wurde; sonst gilt der neueste Stand
    const better = !current || (DELIVERED.has(next.result) && !DELIVERED.has(current.result)) || (DELIVERED.has(next.result) === DELIVERED.has(current.result) && next.at >= current.at);
    if (better) latest.set(row.leadId, next);
  }
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const got = Array.from(latest.values()).filter((item) => DELIVERED.has(item.result));
  const paid = got.filter((item) => item.result !== "reklamiert");
  const value = Math.round(paid.reduce((sum, item) => sum + item.price, 0) * 100) / 100;
  const claimed = got.length - paid.length;
  const last = got.reduce((max, item) => Math.max(max, item.at), 0);
  return {
    delivered: got.length,
    thisMonth: got.filter((item) => item.at >= monthStart).length,
    value,
    averagePrice: paid.length ? Math.round((value / paid.length) * 100) / 100 : 0,
    claimed,
    claimRate: got.length ? Math.round((claimed * 100) / got.length) : 0,
    rejected: Array.from(latest.values()).filter((item) => item.result === "abgelehnt").length,
    lastDeliveryAt: last ? new Date(last).toISOString() : null,
    ordersActive: orders.filter((order) => orderStatusLabel(order.status, order.active ?? true) === "Aktiv").length,
    ordersTotal: orders.length,
  };
}

/** „Letzte Lieferung“ in Worten: heute/gestern mit Uhrzeit, sonst das Datum – darunter, wie lange das her ist. */
export function lastDeliveryText(iso: string | null, now = new Date()): { value: string; hint: string } {
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return { value: "noch keine", hint: "noch kein Lead bekommen" };
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  const time = at.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (days <= 0) return { value: `heute, ${time}`, hint: "zuletzt einen Lead bekommen" };
  if (days === 1) return { value: `gestern, ${time}`, hint: "zuletzt einen Lead bekommen" };
  return { value: at.toLocaleDateString("de-DE"), hint: `vor ${days} Tagen` };
}

/** Geldbetrag kurz: ganze Euro ohne Nachkommastellen („11.555 €“), sonst mit Cent („35,50 €“). */
export function shortMoney(value: number): string {
  return `${value.toLocaleString("de-DE", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })} €`;
}

/** Farbe des Punkts in der Zeitleiste „Aktivität“: Reklamation gelb, abgelehnt/Fehler rot, geliefert/angenommen grün, sonst neutral. */
export function activityTone(title: string): "warn" | "bad" | "good" | "info" {
  if (/reklamation/i.test(title)) return "warn";
  if (/abgelehnt|fehler|storniert/i.test(title)) return "bad";
  if (/geliefert|anerkannt|angenommen|auslieferung|gesendet/i.test(title)) return "good";
  return "info";
}
