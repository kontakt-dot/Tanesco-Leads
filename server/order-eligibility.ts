/** Reine Regeln der Bestellkonfiguration – ohne Datenbankabhängigkeiten, damit Server und Browser-Demo dieselbe Logik nutzen. */
const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export type OrderEligibilityConfig = { active: boolean; ongoing: boolean; startsAt: Date | null; endsAt: Date | null; deliveryDays: unknown; pauses: unknown; requestedQuantity: number; advancedFilters: unknown; supplierRestrictions: unknown };

/** Prüft, ob eine Bestellung den Lead jetzt annehmen darf. Reine Funktion (testbar). */
export function evaluateOrderEligibility(config: OrderEligibilityConfig | undefined, lead: { supplierId: number | null; postcode: string | null; cost: string | number | null }, deliveredCount: number, now = new Date()): { eligible: boolean; reason?: string } {
  if (!config) return { eligible: true };
  if (!config.active) return { eligible: false, reason: "Bestellung ist deaktiviert" };
  if (!config.ongoing) {
    if (config.startsAt && now < config.startsAt) return { eligible: false, reason: "Bestellzeitraum hat noch nicht begonnen" };
    if (config.endsAt && now > config.endsAt) return { eligible: false, reason: "Bestellzeitraum ist abgelaufen" };
  }
  const days = Array.isArray(config.deliveryDays) ? (config.deliveryDays as unknown[]).map(String) : [];
  if (days.length && !days.includes(WEEKDAYS[now.getDay()])) return { eligible: false, reason: `Kein Liefertag (${WEEKDAYS[now.getDay()]})` };
  const pauses = Array.isArray(config.pauses) ? (config.pauses as Array<{ from?: string; until?: string }>) : [];
  for (const pause of pauses) {
    const from = pause.from ? new Date(pause.from) : null; const until = pause.until ? new Date(pause.until) : null;
    if (until && !Number.isNaN(until.getTime())) until.setHours(23, 59, 59, 999);
    const started = !from || Number.isNaN(from.getTime()) || now >= from; const notEnded = !until || Number.isNaN(until.getTime()) || now <= until;
    if ((from || until) && started && notEnded) return { eligible: false, reason: `Bestellung pausiert${pause.until ? ` bis ${pause.until}` : ""}` };
  }
  if (config.requestedQuantity > 0 && deliveredCount >= config.requestedQuantity) return { eligible: false, reason: `Bestellmenge erreicht (${deliveredCount}/${config.requestedQuantity})` };
  const restrictions = (config.supplierRestrictions ?? {}) as { blockUnknownSuppliers?: boolean; allowedSupplierIds?: number[] };
  const allowedIds = Array.isArray(restrictions.allowedSupplierIds) ? restrictions.allowedSupplierIds : [];
  if (restrictions.blockUnknownSuppliers && !(lead.supplierId && allowedIds.includes(lead.supplierId))) return { eligible: false, reason: "Lieferant für diese Bestellung nicht freigegeben" };
  const filters = (config.advancedFilters ?? {}) as { maxLeadPrice?: number | null; postcodes?: string | null };
  if (typeof filters.maxLeadPrice === "number" && Number(lead.cost ?? 0) > filters.maxLeadPrice) return { eligible: false, reason: `Leadpreis über Limit (${filters.maxLeadPrice})` };
  const prefixes = typeof filters.postcodes === "string" ? filters.postcodes.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean) : [];
  if (prefixes.length && !prefixes.some((prefix) => (lead.postcode ?? "").startsWith(prefix))) return { eligible: false, reason: "Postleitzahl außerhalb des Liefergebiets" };
  return { eligible: true };
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

