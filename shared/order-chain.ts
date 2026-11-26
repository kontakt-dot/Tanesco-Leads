/**
 * Lieferkette aus der Bestellung (v376).
 *
 * Eine Bestellung hat je Lead-Kategorie eine Kette. Station 1 ist die Bestellung selbst – ihr Käufer zu ihrem Preis; darunter lassen sich
 * weitere Stationen anbauen (wohin der Lead geht, wenn Station 1 ihn nicht nimmt). Was für die Bestellung gilt – Lieferanten, Start,
 * Liefertage, Gebiet, Menge –, gilt für die ganze Kette: Beim Ausliefern wird es über die Bestellung geprüft.
 *
 * Diese Datei rechnet nur aus, WAS zu tun ist (planOrderChains) und wie sich die Bestellung in der Kette liest (describeOrderStation).
 * Server und Vorschau führen es aus – so gilt an beiden Stellen dieselbe Regel.
 */
import { readDeliveryArea } from "./german-states";

export type PlanOrder = { id: number; orderNumber: string; buyerName: string; unitPrice: string | number; categoryId: number };
export type PlanConfig = { buyerUserId?: number | null; categoryIds?: unknown; priority?: number | null; supplierRestrictions?: unknown } | null | undefined;
export type PlanChain = { id: number; name: string; categoryId: number; status: string; supplierFilterMode?: string | null; supplierIds?: unknown };
export type PlanStop = { id: number; chainId: number; position: number; buyerName: string; buyerUserId?: number | null; unitPrice: string | number; orderStop?: boolean | null };

export type OrderChainPlan = {
  /** Kategorien der Bestellung (die erste ist ihre Hauptkategorie) */
  categoryIds: number[]; priority: number;
  /** Lieferanten der Bestellung, wie sie an jeder ihrer Ketten stehen */
  supplier: { mode: "all" | "include"; ids: number[] };
  /** Station 1: Käufer und Preis der Bestellung */
  station: { buyerName: string; buyerUserId: number | null; unitPrice: string };
  /** Kategorien ohne Kette → Kette mit Station 1 anlegen */
  createChains: number[];
  /** Ketten, deren Lieferanten an die Bestellung angeglichen werden */
  setSuppliers: number[];
  /** Ketten, die eine neue Station 1 bekommen – vor allen vorhandenen Stationen (leere Kette, Käufer der Bestellung fehlt, oder er wurde ersetzt) */
  insertStation: number[];
  /** Vorhandene Station des Käufers der Bestellung → als Station 1 kennzeichnen und nach vorn stellen */
  markStation: number[];
  /** Station 1, die nicht mehr zu Käufer oder Preis der Bestellung passt → angleichen */
  updateStation: number[];
  /**
   * Die Bestellung hat einen ANDEREN Käufer bekommen, und an die bisherige Station sind schon Leads gegangen: Sie bleibt für die Historie stehen
   * (ausgeschaltet, keine Station 1 mehr) – die Kette bekommt eine neue Station 1 (steht dann auch in insertStation). So sieht der neue Käufer nie die Leads des alten.
   */
  retireStation: number[];
  /** Ketten ohne Station 1 aus der Bestellung, an denen (im Hintergrund) nichts geändert wurde – die Oberfläche bietet „aus der Bestellung übernehmen“ an */
  missingStation: number[];
  /** Ketten einer Kategorie, die nicht mehr zur Bestellung gehört → ausschalten */
  deactivate: number[];
  /** Ketten einer Kategorie, die gerade wieder dazugekommen ist → einschalten */
  activate: number[];
};
export type PlanOptions = {
  /**
   * "explicit" (Standard): Jemand hat die Bestellung gespeichert, eingeschaltet oder „aus der Bestellung übernehmen“ gewählt – ihre Ketten folgen ihr ganz
   * (Station 1 vorn, Käufer, Preis, Lieferanten, Kategorien).
   * "background": beim Start des Servers und beim Ausliefern – es entstehen nur Ketten für Kategorien, die noch gar keine haben. An vorhandenen Ketten ändert
   * sich nichts: Wer welchen Lead zu welchem Preis bekommt, wechselt nie von selbst.
   */
  mode?: "explicit" | "background";
  /** Kategorien, die beim Speichern neu dazugekommen sind */
  addedCategoryIds?: number[];
  /** Stationen, an die schon Leads gegangen sind */
  deliveredStopIds?: number[];
};

const numbers = (value: unknown): number[] => (Array.isArray(value) ? value.map(Number).filter((id) => Number.isInteger(id) && id > 0) : []);
const price = (value: string | number | null | undefined) => (Number(value) || 0).toFixed(2);
const sameName = (a: string | null | undefined, b: string | null | undefined) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase() && String(a ?? "").trim() !== "";

/** Kategorien einer Bestellung: Hauptkategorie zuerst, dann die weiteren – ohne Doppelte. */
export function orderCategoryIds(order: Pick<PlanOrder, "categoryId">, config: PlanConfig): number[] {
  return Array.from(new Set([order.categoryId, ...numbers(config?.categoryIds)]));
}
/** Lieferanten einer Bestellung, wie eine Kette sie kennt: alle – oder nur die gewählten. */
export function orderSupplierFilter(config: PlanConfig): { mode: "all" | "include"; ids: number[] } {
  const restrictions = (config?.supplierRestrictions ?? {}) as { blockUnknownSuppliers?: boolean; allowedSupplierIds?: unknown };
  const ids = Array.from(new Set(numbers(restrictions.allowedSupplierIds)));
  return restrictions.blockUnknownSuppliers && ids.length ? { mode: "include", ids } : { mode: "all", ids: [] };
}
/** Name einer Kette, die die Software für eine Bestellung anlegt. An ihm erkennt sie auch ältere, selbst angelegte Standard-Ketten. */
export const orderChainName = (orderNumber: string) => `Bestellung ${orderNumber}`;

export function planOrderChains(order: PlanOrder, config: PlanConfig, chains: PlanChain[], stops: PlanStop[], options: PlanOptions = {}): OrderChainPlan {
  const explicit = (options.mode ?? "explicit") === "explicit";
  const categoryIds = orderCategoryIds(order, config); const supplier = orderSupplierFilter(config);
  const station = { buyerName: order.buyerName, buyerUserId: config?.buyerUserId ?? null, unitPrice: price(order.unitPrice) };
  const plan: OrderChainPlan = { categoryIds, priority: Math.max(1, Number(config?.priority) || 1), supplier, station, createChains: [], setSuppliers: [], insertStation: [], markStation: [], updateStation: [], retireStation: [], missingStation: [], deactivate: [], activate: [] };
  const isBuyer = (stop: PlanStop) => (station.buyerUserId && stop.buyerUserId ? stop.buyerUserId === station.buyerUserId : sameName(stop.buyerName, station.buyerName));
  const differs = (stop: PlanStop) => stop.buyerName !== station.buyerName || (stop.buyerUserId ?? null) !== station.buyerUserId || price(stop.unitPrice) !== station.unitPrice;
  /** anderer Käufer als bisher UND schon beliefert → nicht umschreiben, sondern ersetzen */
  const replace = (stop: PlanStop) => !isBuyer(stop) && (options.deliveredStopIds ?? []).includes(stop.id);
  for (const categoryId of categoryIds) if (!chains.some((chain) => chain.categoryId === categoryId)) plan.createChains.push(categoryId);
  for (const chain of chains) {
    const own = stops.filter((stop) => stop.chainId === chain.id).sort((a, b) => a.position - b.position);
    const flagged = own.find((stop) => stop.orderStop);
    if (!explicit) { if (categoryIds.includes(chain.categoryId) && !flagged) plan.missingStation.push(chain.id); continue; }
    if (!categoryIds.includes(chain.categoryId)) { if (chain.status === "aktiv") plan.deactivate.push(chain.id); continue; }
    if (chain.status !== "aktiv" && (options.addedCategoryIds ?? []).includes(chain.categoryId)) plan.activate.push(chain.id);
    const mode = chain.supplierFilterMode === "include" || chain.supplierFilterMode === "exclude" ? chain.supplierFilterMode : "all"; const ids = numbers(chain.supplierIds);
    if (mode !== supplier.mode || ids.length !== supplier.ids.length || ids.some((id) => !supplier.ids.includes(id))) plan.setSuppliers.push(chain.id);
    // Station 1: die Station des Käufers der Bestellung – sonst die bisher gekennzeichnete – sonst (ältere Standard-Kette der Software: ein Stop, Name „Bestellung …“) deren einzige
    const current = (flagged && isBuyer(flagged) ? flagged : undefined) ?? own.find(isBuyer) ?? flagged ?? (own.length === 1 && chain.name === orderChainName(order.orderNumber) ? own[0] : undefined);
    // Die Bestellung hat jetzt einen anderen Käufer, und der steht schon weiter hinten in der Kette: Er rückt als Station 1 nach vorn (keine doppelte Station), die bisherige geht aus
    if (flagged && current && flagged.id !== current.id) plan.retireStation.push(flagged.id);
    if (!current) { plan.insertStation.push(chain.id); continue; }
    if (replace(current)) { plan.retireStation.push(current.id); plan.insertStation.push(chain.id); continue; }
    if (!current.orderStop || own[0].id !== current.id) plan.markStation.push(current.id);
    if (differs(current)) plan.updateStation.push(current.id);
  }
  return plan;
}
/** Hat der Plan etwas zu tun? */
export const planHasWork = (plan: OrderChainPlan) => plan.createChains.length + plan.setSuppliers.length + plan.insertStation.length + plan.markStation.length + plan.updateStation.length + plan.retireStation.length + plan.deactivate.length + plan.activate.length > 0;

/** Platzhalter-Name einer Bestellung, in der noch kein Käufer gewählt ist („Bestellung anlegen“ setzt ihn). So lange liefert die Bestellung nicht. */
export const ORDER_WITHOUT_BUYER = "Noch nicht gewählt";
export const orderHasBuyer = (order: { buyerName?: string | null }, config: { buyerUserId?: number | null } | null | undefined) => Boolean(config?.buyerUserId) || String(order.buyerName ?? "").trim() !== ORDER_WITHOUT_BUYER;
export const NO_BUYER_REASON = "In der Bestellung ist noch kein Käufer gewählt";

/** Liefert diese Station „für die Bestellung“ (zählt zur Bestellmenge, läuft über das Käufer-Konto der Bestellung)? Ja bei Station 1 – und in älteren Ketten ohne gekennzeichnete Station 1 bei jeder, wie bisher. */
export const deliversForOrder = (stopId: number, stationId: number | null | undefined) => stationId === null || stationId === undefined || stopId === stationId;

/**
 * Was die Bestellung für ihre Kette bedeutet, wenn ein Lead ankommt (v376).
 *  - Läuft die Bestellung selbst nicht (`blocks.chain`), geht über die ganze Kette nichts raus.
 *  - Kann nur ihr Käufer den Lead nicht nehmen (Gebiet, Liefertag, Pause, Preisgrenze, Dublette, Zugang pausiert), hält das allein Station 1 auf:
 *    Gibt es weitere eingeschaltete Stationen, läuft der Lead zu ihnen weiter (`stationSkip` = warum Station 1 ihn nicht nimmt).
 *    Gibt es keine, nimmt die Kette den Lead nicht an – wie vor v376.
 * `stationId` = gekennzeichnete Station 1 (null bei älteren Ketten ohne: dort bleibt alles wie bisher).
 */
export function orderGate(input: { blocks: { chain: string | null; station: string | null }; duplicate: boolean; buyerBlock?: string | null; stationId: number | null; activeStopIds: number[] }): { eligible: boolean; reason?: string; stationSkip: string | null } {
  if (input.blocks.chain) return { eligible: false, reason: input.blocks.chain, stationSkip: null };
  const reason = input.duplicate ? "Dublette: Kontakt liegt bereits bei diesem Käufer" : input.blocks.station ?? input.buyerBlock ?? null;
  if (!reason) return { eligible: true, stationSkip: null };
  const others = input.stationId !== null && input.activeStopIds.some((id) => id !== input.stationId);
  if (!others) return { eligible: false, reason: input.duplicate ? "Dublettenschutz: Kontakt wurde bereits an diesen Käufer geliefert" : reason, stationSkip: null };
  return { eligible: true, stationSkip: input.activeStopIds.includes(input.stationId as number) ? reason : null };
}


/* ------------------------------------------------------------------ Die Bestellung, wie sie als Station 1 in der Kette steht */

export type OrderStationInput = {
  order: { id: number; orderNumber: string; name: string | null; status: string; buyerName: string; unitPrice: string | number; quantity: number | null; deliveredCount?: number | null };
  config: { buyerUserId?: number | null; startsAt?: Date | string | null; endsAt?: Date | string | null; ongoing?: boolean | null; deliveryDays?: unknown; deliveryInterval?: string | null; deliveryArea?: string | null; advancedFilters?: unknown; supplierRestrictions?: unknown; categoryIds?: unknown } | null | undefined;
  supplierName: (id: number) => string; categoryName: (id: number) => string; mainCategoryId: number;
};
export type OrderStation = {
  orderId: number; orderNumber: string; name: string; status: string; buyerName: string; unitPrice: string; quantity: number | null; delivered: number;
  /** in der Bestellung ist noch kein Käufer gewählt – so lange geht über die Kette nichts raus */
  buyerMissing: boolean;
  /** je eine Zeile für die Karte „Aus der Bestellung“ */
  facts: Array<{ key: "lieferant" | "sparten" | "preis" | "menge" | "start" | "ende" | "gebiet" | "tage" | "takt"; label: string; value: string }>;
};
const WEEK = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
/** Liefertage kurz: „Mo–Fr“, „Mo, Mi, Fr“, „jeden Tag“. */
export function daysInShort(days: unknown): string {
  const picked = WEEK.filter((day) => (Array.isArray(days) ? days.map(String) : []).includes(day));
  if (!picked.length || picked.length === 7) return "jeden Tag";
  const indexes = picked.map((day) => WEEK.indexOf(day)); const run = indexes.every((value, index) => index === 0 || value === indexes[index - 1] + 1);
  return run && picked.length > 2 ? `${picked[0].slice(0, 2)}–${picked[picked.length - 1].slice(0, 2)}` : picked.map((day) => day.slice(0, 2)).join(", ");
}
const day = (value: Date | string | null | undefined) => { if (!value) return ""; const date = value instanceof Date ? value : new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" }); };
const euro = (value: string | number) => `${(Number(value) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const TAKT: Record<string, string> = { sofort: "sofort", täglich: "einmal am Tag", wöchentlich: "einmal in der Woche", monatlich: "einmal im Monat" };

/** Alles, was aus der Bestellung in die Kette kommt – als lesbare Zeilen (Lieferant, Sparten, Preis, Menge, Start, Ende, Gebiet, Liefertage, Takt). */
export function describeOrderStation(input: OrderStationInput): OrderStation {
  const { order, config } = input; const supplier = orderSupplierFilter(config as PlanConfig);
  const categories = orderCategoryIds({ categoryId: input.mainCategoryId }, config as PlanConfig).map(input.categoryName).filter(Boolean);
  const area = readDeliveryArea(typeof (config?.advancedFilters as { postcodes?: unknown } | undefined)?.postcodes === "string" ? String((config!.advancedFilters as { postcodes: string }).postcodes) : null);
  const areaText = area.states.length ? area.states.join(", ") : area.postcodes.length ? `PLZ ${area.postcodes.join(", ")}` : "Landesweit";
  const start = day(config?.startsAt); const end = config?.ongoing === false ? day(config?.endsAt) : "";
  const quantity = order.quantity && order.quantity > 0 ? order.quantity : null; const delivered = Math.max(0, Number(order.deliveredCount) || 0);
  const facts: OrderStation["facts"] = [
    { key: "lieferant", label: supplier.ids.length === 1 ? "Lieferant" : "Lieferanten", value: supplier.mode === "all" ? "Alle Lieferanten" : supplier.ids.map(input.supplierName).join(", ") },
    { key: "sparten", label: categories.length === 1 ? "Leadsparte" : "Leadsparten", value: categories.join(", ") || "–" },
    { key: "preis", label: "Preis", value: `${euro(order.unitPrice)} je Lead` },
    { key: "menge", label: "Menge", value: quantity ? `${delivered} von ${quantity} geliefert` : "unbegrenzt" },
    { key: "start", label: "Start", value: start || "sofort" },
    { key: "ende", label: "Ende", value: end || "fortlaufend" },
    { key: "gebiet", label: area.states.length ? (area.states.length === 1 ? "Bundesland" : "Bundesländer") : "Gebiet", value: areaText },
    { key: "tage", label: "Liefertage", value: daysInShort(config?.deliveryDays) },
    { key: "takt", label: "Takt", value: TAKT[String(config?.deliveryInterval ?? "sofort")] ?? String(config?.deliveryInterval ?? "sofort") },
  ];
  return { orderId: order.id, orderNumber: order.orderNumber, name: (order.name ?? "").trim() || orderChainName(order.orderNumber), status: order.status, buyerName: order.buyerName, unitPrice: price(order.unitPrice), quantity, delivered, buyerMissing: !orderHasBuyer(order, config as { buyerUserId?: number | null } | null | undefined), facts };
}
