/** Reine Regeln der Bestellkonfiguration – ohne Datenbankabhängigkeiten, damit Server und Browser-Demo dieselbe Logik nutzen. */
import { readDeliveryArea } from "../shared/german-states";

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export type OrderEligibilityConfig = { active: boolean; ongoing: boolean; startsAt: Date | null; endsAt: Date | null; deliveryDays: unknown; pauses: unknown; requestedQuantity: number; advancedFilters: unknown; supplierRestrictions: unknown };

const dayStart = (date: Date) => { const copy = new Date(date); copy.setHours(0, 0, 0, 0); return copy; };
const dayEnd = (date: Date) => { const copy = new Date(date); copy.setHours(23, 59, 59, 999); return copy; };

/**
 * Warum eine Bestellung den Lead gerade nicht nimmt – getrennt nach zwei Fragen (v376):
 *  - `chain`: Die Bestellung selbst läuft nicht (ausgeschaltet, noch nicht gestartet, beendet, Menge erreicht, Lieferant nicht zugelassen).
 *    Dann geht über ihre ganze Lieferkette nichts raus.
 *  - `station`: Nur der Käufer der Bestellung kann diesen Lead jetzt nicht nehmen (kein Liefertag, Lieferpause, Preisgrenze, Gebiet).
 *    Hat die Kette weitere Stationen, bekommen sie den Lead; sonst nimmt die Kette ihn nicht an.
 * Der Starttag gilt immer (bis v375 nur ohne „fortlaufend“ – eine fortlaufende Bestellung lieferte schon vor ihrem Start). Start und Ende zählen als ganze Tage.
 */
export function orderBlocks(config: OrderEligibilityConfig | undefined, lead: { supplierId: number | null; postcode: string | null; cost: string | number | null }, deliveredCount: number, now = new Date()): { chain: string | null; station: string | null } {
  if (!config) return { chain: null, station: null };
  const restrictions = (config.supplierRestrictions ?? {}) as { blockUnknownSuppliers?: boolean; allowedSupplierIds?: number[] };
  const allowedIds = Array.isArray(restrictions.allowedSupplierIds) ? restrictions.allowedSupplierIds : [];
  const chain = !config.active ? "Bestellung ist deaktiviert"
    : config.startsAt && now < dayStart(config.startsAt) ? "Bestellzeitraum hat noch nicht begonnen"
    : !config.ongoing && config.endsAt && now > dayEnd(config.endsAt) ? "Bestellzeitraum ist abgelaufen"
    : config.requestedQuantity > 0 && deliveredCount >= config.requestedQuantity ? `Bestellmenge erreicht (${deliveredCount}/${config.requestedQuantity})`
    : restrictions.blockUnknownSuppliers && !(lead.supplierId && allowedIds.includes(lead.supplierId)) ? "Lieferant für diese Bestellung nicht freigegeben"
    : null;
  return { chain, station: stationBlock(config, lead, now) };
}
function stationBlock(config: OrderEligibilityConfig, lead: { postcode: string | null; cost: string | number | null }, now: Date): string | null {
  const days = Array.isArray(config.deliveryDays) ? (config.deliveryDays as unknown[]).map(String) : [];
  if (days.length && !days.includes(WEEKDAYS[now.getDay()])) return `Kein Liefertag (${WEEKDAYS[now.getDay()]})`;
  const pauses = Array.isArray(config.pauses) ? (config.pauses as Array<{ from?: string; until?: string }>) : [];
  for (const pause of pauses) {
    const from = pause.from ? new Date(pause.from) : null; const until = pause.until ? new Date(pause.until) : null;
    if (until && !Number.isNaN(until.getTime())) until.setHours(23, 59, 59, 999);
    const started = !from || Number.isNaN(from.getTime()) || now >= from; const notEnded = !until || Number.isNaN(until.getTime()) || now <= until;
    if ((from || until) && started && notEnded) return `Bestellung pausiert${pause.until ? ` bis ${pause.until}` : ""}`;
  }
  const filters = (config.advancedFilters ?? {}) as { maxLeadPrice?: number | null; postcodes?: string | null };
  if (typeof filters.maxLeadPrice === "number" && Number(lead.cost ?? 0) > filters.maxLeadPrice) return `Leadpreis über Limit (${filters.maxLeadPrice})`;
  // Liefergebiet: PLZ-Anfänge („60, 61“) oder Bundesländer („Hessen, Bayern“). Bis v375 galten die Namen der Bundesländer selbst als PLZ-Anfang –
  // eine Bestellung mit Bundesländern nahm deshalb keinen einzigen Lead an. Jetzt werden sie in ihre PLZ-Anfänge übersetzt.
  const area = readDeliveryArea(typeof filters.postcodes === "string" ? filters.postcodes : null); const postcode = (lead.postcode ?? "").replace(/\s/g, "");
  if (area.prefixes.length && !area.prefixes.some((prefix) => postcode.startsWith(prefix))) return area.states.length && !area.postcodes.length ? `Bundesland außerhalb des Liefergebiets (${area.states.join(", ")})`.slice(0, 160) : "Postleitzahl außerhalb des Liefergebiets";
  return null;
}

/** Prüft, ob eine Bestellung den Lead jetzt annehmen darf. Reine Funktion (testbar). Erst, was die ganze Bestellung betrifft, dann der Käufer. */
export function evaluateOrderEligibility(config: OrderEligibilityConfig | undefined, lead: { supplierId: number | null; postcode: string | null; cost: string | number | null }, deliveredCount: number, now = new Date()): { eligible: boolean; reason?: string } {
  const blocks = orderBlocks(config, lead, deliveredCount, now); const reason = blocks.chain ?? blocks.station;
  return reason ? { eligible: false, reason } : { eligible: true };
}


const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const isoWeek = (date: Date) => { const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day); const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return `${d.getUTCFullYear()}-${Math.ceil(((d.getTime() - start.getTime()) / 86_400_000 + 1) / 7)}`; };
const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

/** Ist das Lieferfenster der Bestellung (sofort/täglich/wöchentlich/monatlich) für diesen Lauf offen? Bezug: letzte Lieferung der Bestellung. */
export function intervalWindowOpen(interval: string, lastDeliveryAt: Date | undefined, now: Date) {
  if (!lastDeliveryAt || interval === "sofort") return true;
  if (interval === "täglich") return !sameDay(lastDeliveryAt, now);
  if (interval === "wöchentlich") return isoWeek(lastDeliveryAt) !== isoWeek(now);
  if (interval === "monatlich") return !sameMonth(lastDeliveryAt, now);
  return true;
}

