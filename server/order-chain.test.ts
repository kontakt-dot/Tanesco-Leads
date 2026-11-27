import { describe, expect, it } from "vitest";
import { DEFAULT_REASONS, missingDefaultReasons } from "../shared/default-reasons";
import { readDeliveryArea } from "../shared/german-states";
import { NO_BUYER_REASON, ORDER_WITHOUT_BUYER, daysInShort, deliversForOrder, describeOrderStation, orderCategoryIds, orderChainName, orderGate, orderHasBuyer, orderSupplierFilter, planHasWork, planOrderChains, type PlanChain, type PlanStop } from "../shared/order-chain";
import { evaluateOrderEligibility, orderBlocks, type OrderEligibilityConfig } from "./order-eligibility";

/**
 * Version 376 – Lieferkette aus der Bestellung: Station 1 ist die Bestellung, darunter weitere Stationen.
 * Geprüft wird die reine Logik, die Server und Vorschau gemeinsam nutzen.
 */
const base: OrderEligibilityConfig = { active: true, ongoing: true, startsAt: null, endsAt: null, deliveryDays: [], pauses: [], requestedQuantity: 0, advancedFilters: null, supplierRestrictions: null };
const lead = { supplierId: 7, postcode: "80331", cost: "0.00" };
const wednesday = new Date(2026, 10, 25, 9, 0, 0); // Mittwoch, 25.11.2026, 09:00 (Ortszeit des Tests)

describe("Bestellung: was die ganze Kette betrifft und was nur Station 1", () => {
  it("der Starttag gilt immer – auch bei „fortlaufend“ (bis v375 lieferte eine fortlaufende Bestellung schon vor ihrem Start)", () => {
    const tomorrow = new Date(2026, 10, 26, 12, 0, 0);
    expect(orderBlocks({ ...base, startsAt: tomorrow }, lead, 0, wednesday)).toEqual({ chain: "Bestellzeitraum hat noch nicht begonnen", station: null });
    expect(evaluateOrderEligibility({ ...base, startsAt: tomorrow }, lead, 0, wednesday)).toEqual({ eligible: false, reason: "Bestellzeitraum hat noch nicht begonnen" });
    // Start heute um 12 Uhr gespeichert (so legt das Formular ihn ab) – morgens um 9 läuft die Bestellung schon: Der Starttag zählt ganz
    expect(evaluateOrderEligibility({ ...base, startsAt: new Date(2026, 10, 25, 12, 0, 0) }, lead, 0, wednesday)).toEqual({ eligible: true });
  });

  it("das Ende zählt als ganzer Tag und nur ohne „fortlaufend“", () => {
    const endsToday = { ...base, ongoing: false, endsAt: new Date(2026, 10, 25, 12, 0, 0) };
    expect(evaluateOrderEligibility(endsToday, lead, 0, new Date(2026, 10, 25, 18, 0, 0))).toEqual({ eligible: true });
    expect(evaluateOrderEligibility(endsToday, lead, 0, new Date(2026, 10, 26, 0, 30, 0)).reason).toBe("Bestellzeitraum ist abgelaufen");
    expect(evaluateOrderEligibility({ ...endsToday, ongoing: true }, lead, 0, new Date(2026, 10, 26, 0, 30, 0))).toEqual({ eligible: true });
  });

  it("ganze Kette: ausgeschaltet, Menge erreicht, Lieferant nicht zugelassen", () => {
    expect(orderBlocks({ ...base, active: false }, lead, 0, wednesday).chain).toBe("Bestellung ist deaktiviert");
    expect(orderBlocks({ ...base, requestedQuantity: 10 }, lead, 10, wednesday).chain).toBe("Bestellmenge erreicht (10/10)");
    expect(orderBlocks({ ...base, supplierRestrictions: { blockUnknownSuppliers: true, allowedSupplierIds: [1] } }, lead, 0, wednesday).chain).toBe("Lieferant für diese Bestellung nicht freigegeben");
    expect(orderBlocks({ ...base, supplierRestrictions: { blockUnknownSuppliers: true, allowedSupplierIds: [7] } }, lead, 0, wednesday)).toEqual({ chain: null, station: null });
  });

  it("nur Station 1: Liefertag, Lieferpause, Preisgrenze, Gebiet", () => {
    expect(orderBlocks({ ...base, deliveryDays: ["Montag"] }, lead, 0, wednesday)).toEqual({ chain: null, station: "Kein Liefertag (Mittwoch)" });
    expect(orderBlocks({ ...base, pauses: [{ from: "2026-11-24", until: "2026-11-26" }] }, lead, 0, wednesday).station).toBe("Bestellung pausiert bis 2026-11-26");
    expect(orderBlocks({ ...base, advancedFilters: { maxLeadPrice: 15 } }, { ...lead, cost: "20.00" }, 0, wednesday).station).toBe("Leadpreis über Limit (15)");
    expect(orderBlocks({ ...base, advancedFilters: { postcodes: "10, 20" } }, lead, 0, wednesday).station).toBe("Postleitzahl außerhalb des Liefergebiets");
  });

  it("Bundesländer im Liefergebiet: Bayern nimmt 80331 und lehnt 10115 ab (bis v375 nahm so eine Bestellung gar keinen Lead)", () => {
    const bavaria = { ...base, advancedFilters: { postcodes: "Bayern" } };
    expect(evaluateOrderEligibility(bavaria, lead, 0, wednesday)).toEqual({ eligible: true });
    expect(evaluateOrderEligibility(bavaria, { ...lead, postcode: "10115" }, 0, wednesday)).toEqual({ eligible: false, reason: "Bundesland außerhalb des Liefergebiets (Bayern)" });
    expect(readDeliveryArea("Bayern, Hessen").states).toEqual(["Bayern", "Hessen"]);
    expect(readDeliveryArea("60, 61").postcodes).toEqual(["60", "61"]);
    expect(readDeliveryArea(null)).toMatchObject({ prefixes: [], states: [], postcodes: [] });
  });

  it("trifft beides zu, zählt zuerst, was die ganze Bestellung betrifft", () => {
    expect(evaluateOrderEligibility({ ...base, deliveryDays: ["Montag"], requestedQuantity: 5 }, lead, 5, wednesday).reason).toBe("Bestellmenge erreicht (5/5)");
  });
});

describe("orderGate: Station 1 hält nur sich selbst auf, wenn es weitere Stationen gibt", () => {
  const none = { chain: null, station: null };
  it("läuft die Bestellung selbst nicht, geht über die ganze Kette nichts raus", () => {
    expect(orderGate({ blocks: { chain: "Bestellung ist deaktiviert", station: null }, duplicate: false, stationId: 1, activeStopIds: [1, 2] })).toEqual({ eligible: false, reason: "Bestellung ist deaktiviert", stationSkip: null });
  });
  it("nichts im Weg: Kette nimmt den Lead, Station 1 auch", () => {
    expect(orderGate({ blocks: none, duplicate: false, stationId: 1, activeStopIds: [1, 2] })).toEqual({ eligible: true, stationSkip: null });
  });
  it("Gebiet passt nicht – mit weiterer Station läuft der Lead dorthin, ohne nimmt die Kette ihn nicht an", () => {
    const blocks = { chain: null, station: "Postleitzahl außerhalb des Liefergebiets" };
    expect(orderGate({ blocks, duplicate: false, stationId: 1, activeStopIds: [1, 2] })).toEqual({ eligible: true, stationSkip: "Postleitzahl außerhalb des Liefergebiets" });
    expect(orderGate({ blocks, duplicate: false, stationId: 1, activeStopIds: [1] })).toEqual({ eligible: false, reason: "Postleitzahl außerhalb des Liefergebiets", stationSkip: null });
  });
  it("ältere Kette ohne gekennzeichnete Station 1: bleibt wie bisher – die Bestellung gilt für die ganze Kette", () => {
    expect(orderGate({ blocks: { chain: null, station: "Kein Liefertag (Mittwoch)" }, duplicate: false, stationId: null, activeStopIds: [4, 5] })).toEqual({ eligible: false, reason: "Kein Liefertag (Mittwoch)", stationSkip: null });
  });
  it("Dublette beim Käufer der Bestellung: weiter zur nächsten Station – allein steht „Dublettenschutz“", () => {
    expect(orderGate({ blocks: none, duplicate: true, stationId: 1, activeStopIds: [1, 2] })).toEqual({ eligible: true, stationSkip: "Dublette: Kontakt liegt bereits bei diesem Käufer" });
    expect(orderGate({ blocks: none, duplicate: true, stationId: 1, activeStopIds: [1] })).toEqual({ eligible: false, reason: "Dublettenschutz: Kontakt wurde bereits an diesen Käufer geliefert", stationSkip: null });
  });
  it("Zugang des Käufers pausiert: wie ein Grund von Station 1", () => {
    expect(orderGate({ blocks: none, duplicate: false, buyerBlock: "Auslieferung für diesen Käufer pausiert", stationId: 1, activeStopIds: [1, 2] }).stationSkip).toBe("Auslieferung für diesen Käufer pausiert");
    expect(orderGate({ blocks: none, duplicate: false, buyerBlock: "Auslieferung für diesen Käufer pausiert", stationId: 1, activeStopIds: [1] }).eligible).toBe(false);
  });
  it("Station 1 ist ausgeschaltet: Die übrigen Stationen laufen, ein Grund von Station 1 hält niemanden auf", () => {
    expect(orderGate({ blocks: { chain: null, station: "Kein Liefertag (Mittwoch)" }, duplicate: false, stationId: 1, activeStopIds: [2, 3] })).toEqual({ eligible: true, stationSkip: null });
  });
  it("nur Station 1 liefert „für die Bestellung“ – in älteren Ketten ohne Station 1 jede", () => {
    expect(deliversForOrder(1, 1)).toBe(true); expect(deliversForOrder(2, 1)).toBe(false); expect(deliversForOrder(2, null)).toBe(true);
  });
  it("Bestellung ohne gewählten Käufer liefert nicht", () => {
    expect(orderHasBuyer({ buyerName: ORDER_WITHOUT_BUYER }, { buyerUserId: null })).toBe(false);
    expect(orderHasBuyer({ buyerName: ORDER_WITHOUT_BUYER }, { buyerUserId: 5 })).toBe(true);
    expect(orderHasBuyer({ buyerName: "Sonnenwerk GmbH" }, null)).toBe(true);
    expect(NO_BUYER_REASON).toBe("In der Bestellung ist noch kein Käufer gewählt");
  });
});

describe("planOrderChains: was aus einer Bestellung für ihre Ketten folgt", () => {
  const order = { id: 9, orderNumber: "ORD-TEST", buyerName: "Sonnenwerk GmbH", unitPrice: "44.00", categoryId: 1 };
  const config = { buyerUserId: 50, categoryIds: [1, 2], priority: 3, supplierRestrictions: { blockUnknownSuppliers: true, allowedSupplierIds: [7] } };
  const chain = (id: number, categoryId: number, extra: Partial<PlanChain> = {}): PlanChain => ({ id, name: `Kette ${id}`, categoryId, status: "aktiv", supplierFilterMode: "include", supplierIds: [7], ...extra });
  const stop = (id: number, chainId: number, position: number, extra: Partial<PlanStop> = {}): PlanStop => ({ id, chainId, position, buyerName: "Sonnenwerk GmbH", buyerUserId: 50, unitPrice: "44.00", orderStop: false, ...extra });

  it("ohne Ketten: je Kategorie eine – Station 1 ist Käufer und Preis der Bestellung, Lieferanten wie in der Bestellung", () => {
    const plan = planOrderChains(order, config, [], []);
    expect(plan).toMatchObject({ categoryIds: [1, 2], createChains: [1, 2], priority: 3, supplier: { mode: "include", ids: [7] }, station: { buyerName: "Sonnenwerk GmbH", buyerUserId: 50, unitPrice: "44.00" } });
    expect(planHasWork(plan)).toBe(true);
    expect(orderCategoryIds({ categoryId: 1 }, { categoryIds: [2, 1, 2] })).toEqual([1, 2]);
    expect(orderSupplierFilter({ supplierRestrictions: { blockUnknownSuppliers: false, allowedSupplierIds: [7] } })).toEqual({ mode: "all", ids: [] });
    expect(orderChainName("ORD-TEST")).toBe("Bestellung ORD-TEST");
  });

  it("im Hintergrund (Start, Ausliefern) entstehen nur fehlende Ketten – an vorhandenen ändert sich nichts", () => {
    const chains = [chain(1, 1, { supplierFilterMode: "all", supplierIds: [] }), chain(3, 5)];
    const stops = [stop(11, 1, 1, { buyerName: "Anderer Kunde", buyerUserId: 60, unitPrice: "30.00" }), stop(12, 1, 2)];
    const plan = planOrderChains(order, config, chains, stops, { mode: "background" });
    expect(plan.createChains).toEqual([2]);
    expect(plan).toMatchObject({ setSuppliers: [], insertStation: [], markStation: [], updateStation: [], retireStation: [], deactivate: [], activate: [] });
    expect(plan.missingStation).toEqual([1]); // steht in der Oberfläche als „aus der Bestellung übernehmen“
  });

  it("ausdrücklich (Bestellung gespeichert): leere Kette bekommt Station 1, die Station des Käufers kommt nach vorn, Lieferanten folgen der Bestellung", () => {
    const chains = [chain(1, 1, { supplierFilterMode: "all", supplierIds: [] }), chain(2, 2)];
    const stops = [stop(11, 1, 1, { buyerName: "Anderer Kunde", buyerUserId: 60, unitPrice: "30.00" }), stop(12, 1, 2)];
    const plan = planOrderChains(order, config, chains, stops);
    expect(plan.createChains).toEqual([]); expect(plan.setSuppliers).toEqual([1]);
    expect(plan.markStation).toEqual([12]); expect(plan.updateStation).toEqual([]); // gleicher Käufer, gleicher Preis: nur kennzeichnen und nach vorn
    expect(plan.insertStation).toEqual([2]); expect(plan.missingStation).toEqual([]);
  });

  it("Preis der Bestellung geändert: Station 1 wird angeglichen – steht sie schon vorn, sonst nichts", () => {
    const plan = planOrderChains({ ...order, unitPrice: "39.5" }, config, [chain(1, 1), chain(2, 2)], [stop(11, 1, 1, { orderStop: true }), stop(21, 2, 1, { orderStop: true, unitPrice: "39.50" })]);
    expect(plan.updateStation).toEqual([11]); expect(plan.markStation).toEqual([]); expect(plan.insertStation).toEqual([]);
  });

  it("Kette mit Stationen, aber ohne den Käufer der Bestellung: Er kommt als neue Station 1 davor", () => {
    const plan = planOrderChains(order, config, [chain(1, 1), chain(2, 2)], [stop(11, 1, 1, { buyerName: "Anderer Kunde", buyerUserId: 60 }), stop(21, 2, 1, { orderStop: true })]);
    expect(plan.insertStation).toEqual([1]); expect(plan.markStation).toEqual([]); expect(plan.retireStation).toEqual([]);
  });

  it("anderer Käufer in der Bestellung: ohne Lieferungen wird Station 1 umgeschrieben – mit Lieferungen bleibt die alte für die Historie und eine neue kommt davor", () => {
    const chains = [chain(1, 1), chain(2, 2)]; const stops = [stop(11, 1, 1, { orderStop: true }), stop(21, 2, 1, { orderStop: true })];
    const changed = { ...order, buyerName: "Neuer Käufer AG" }; const changedConfig = { ...config, buyerUserId: 77 };
    const fresh = planOrderChains(changed, changedConfig, chains, stops);
    expect(fresh.updateStation).toEqual([11, 21]); expect(fresh.retireStation).toEqual([]);
    const delivered = planOrderChains(changed, changedConfig, chains, stops, { deliveredStopIds: [11] });
    expect(delivered.retireStation).toEqual([11]); expect(delivered.insertStation).toEqual([1]); expect(delivered.updateStation).toEqual([21]);
  });

  it("der neue Käufer steht schon weiter hinten in der Kette: Er rückt als Station 1 nach vorn – keine doppelte Station, die bisherige geht aus", () => {
    const stops = [stop(11, 1, 1, { orderStop: true }), stop(12, 1, 2, { buyerName: "Neuer Käufer AG", buyerUserId: 77, unitPrice: "30.00" }), stop(21, 2, 1, { orderStop: true })];
    const plan = planOrderChains({ ...order, buyerName: "Neuer Käufer AG", unitPrice: "41.00" }, { ...config, buyerUserId: 77 }, [chain(1, 1), chain(2, 2)], stops, { deliveredStopIds: [11, 21] });
    expect(plan.retireStation).toEqual([11, 21]); expect(plan.markStation).toEqual([12]); expect(plan.updateStation).toEqual([12]); expect(plan.insertStation).toEqual([2]);
  });

  it("ältere Standard-Kette der Software (ein Stop, Name „Bestellung …“): ihr Stop ist die Bestellung, auch wenn der Käufer inzwischen anders heißt", () => {
    const plan = planOrderChains({ ...order, buyerName: "Sonnenwerk Solar GmbH" }, { ...config, categoryIds: [1], buyerUserId: null }, [chain(1, 1, { name: "Bestellung ORD-TEST" })], [stop(11, 1, 1, { buyerUserId: null })]);
    expect(plan.markStation).toEqual([11]); expect(plan.updateStation).toEqual([11]); expect(plan.insertStation).toEqual([]);
  });

  it("Kategorie abgewählt: ihre Kette geht aus – kommt sie wieder dazu, geht sie an", () => {
    const one = { ...config, categoryIds: [1] };
    expect(planOrderChains(order, one, [chain(1, 1), chain(2, 2)], [stop(11, 1, 1, { orderStop: true }), stop(21, 2, 1, { orderStop: true })]).deactivate).toEqual([2]);
    const back = planOrderChains(order, config, [chain(1, 1), chain(2, 2, { status: "inaktiv" })], [stop(11, 1, 1, { orderStop: true }), stop(21, 2, 1, { orderStop: true })], { addedCategoryIds: [2] });
    expect(back.activate).toEqual([2]);
    // ohne „neu dazugekommen“ bleibt eine von Hand ausgeschaltete Kette aus
    expect(planOrderChains(order, config, [chain(1, 1), chain(2, 2, { status: "inaktiv" })], [stop(11, 1, 1, { orderStop: true }), stop(21, 2, 1, { orderStop: true })]).activate).toEqual([]);
  });

  it("alles im Lot: nichts zu tun", () => {
    const plan = planOrderChains(order, config, [chain(1, 1), chain(2, 2)], [stop(11, 1, 1, { orderStop: true }), stop(12, 1, 2, { buyerName: "Anderer Kunde", buyerUserId: 60 }), stop(21, 2, 1, { orderStop: true })]);
    expect(planHasWork(plan)).toBe(false);
  });
});

describe("Station 1 in Worten und die Standard-Gründe", () => {
  it("describeOrderStation: Lieferant, Sparten, Preis, Menge, Start, Ende, Gebiet, Liefertage, Takt", () => {
    const station = describeOrderStation({
      order: { id: 9, orderNumber: "ORD-TEST", name: "PV Bayern", status: "aktiv", buyerName: "Sonnenwerk GmbH", unitPrice: "44.00", quantity: 120, deliveredCount: 87 },
      config: { buyerUserId: 50, startsAt: new Date("2026-12-01T11:00:00Z"), endsAt: null, ongoing: true, deliveryDays: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"], deliveryInterval: "sofort", advancedFilters: { postcodes: "Bayern, Hessen" }, supplierRestrictions: { blockUnknownSuppliers: true, allowedSupplierIds: [7] }, categoryIds: [1, 2] },
      mainCategoryId: 1, supplierName: (id) => (id === 7 ? "Signal Ads" : `Lieferant #${id}`), categoryName: (id) => (id === 1 ? "Photovoltaik" : "Wärmepumpe"),
    });
    expect(Object.fromEntries(station.facts.map((fact) => [fact.key, `${fact.label}: ${fact.value}`]))).toEqual({ lieferant: "Lieferant: Signal Ads", sparten: "Leadsparten: Photovoltaik, Wärmepumpe", preis: "Preis: 44,00 € je Lead", menge: "Menge: 87 von 120 geliefert", start: "Start: 01.12.2026", ende: "Ende: fortlaufend", gebiet: "Bundesländer: Bayern, Hessen", tage: "Liefertage: Mo–Fr", takt: "Takt: in Echtzeit" });
    expect(station).toMatchObject({ orderNumber: "ORD-TEST", name: "PV Bayern", buyerName: "Sonnenwerk GmbH", unitPrice: "44.00", quantity: 120, delivered: 87, buyerMissing: false });
  });
  it("ohne Einschränkungen: alle Lieferanten, landesweit, jeden Tag, unbegrenzt – und der Hinweis, wenn kein Käufer gewählt ist", () => {
    const station = describeOrderStation({ order: { id: 1, orderNumber: "ORD-1", name: null, status: "offen", buyerName: ORDER_WITHOUT_BUYER, unitPrice: 0, quantity: null }, config: { buyerUserId: null, deliveryDays: [], supplierRestrictions: { mode: "alle" } }, mainCategoryId: 1, supplierName: () => "", categoryName: () => "Photovoltaik" });
    const value = (key: string) => station.facts.find((fact) => fact.key === key)!.value;
    expect([value("lieferant"), value("gebiet"), value("tage"), value("menge"), value("start")]).toEqual(["Alle Lieferanten", "Landesweit", "jeden Tag", "unbegrenzt", "sofort"]);
    expect(station.name).toBe("Bestellung ORD-1"); expect(station.buyerMissing).toBe(true);
    expect(daysInShort(["Montag", "Mittwoch", "Freitag"])).toBe("Mo, Mi, Fr");
  });
  it("30 Standard-Gründe, jeder einmal – weitergegeben wird nur bei Dublette und fehlgeschlagener Zustellung", () => {
    expect(DEFAULT_REASONS).toHaveLength(30);
    expect(new Set(DEFAULT_REASONS.map((reason) => reason.name.toLowerCase())).size).toBe(30);
    expect(DEFAULT_REASONS.filter((reason) => reason.forward).map((reason) => reason.name)).toEqual(["Dublette", "Zustellung fehlgeschlagen (API)"]);
    expect(missingDefaultReasons(["dublette", " Storno ", null])).toHaveLength(28);
    expect(missingDefaultReasons(DEFAULT_REASONS.map((reason) => reason.name))).toEqual([]);
  });
});
