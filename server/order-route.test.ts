import { describe, expect, it } from "vitest";
import { chainSignature, extraStops, orderRoutes, planChainCopy, routeEnd, routeSentence, stopBuyerKey, stopValues, type RouteRule, type RouteStop } from "../shared/order-route";

/**
 * Lieferkette einer Bestellung mit mehreren Leadsparten (v379): Sind zwei Ketten gleich? Wie wird eine Kette auf eine andere Sparte
 * übertragen? Und wie steht der Weg der Leads in der Bestellübersicht? Dieselbe Rechnung für Server, Vorschau und Oberfläche.
 */
let nextId = 100;
const stop = (buyerName: string, position: number, values: Partial<RouteStop> = {}): RouteStop => ({ id: (nextId += 1), buyerName, buyerUserId: null, position, unitPrice: "30.00", active: true, orderStop: false, reclamationWindowHours: 24, maxLeads: null, geoCountry: null, geoMode: "landesweit", geoValues: [], fieldFilters: [], excludedSupplierIds: [], excludedBuyerUserIds: [], excludeAutomationDuplicates: false, phoneFilter: "all", maxLeadAgeMinutes: null, ...values });
const station = (buyerName = "Aurora Home") => stop(buyerName, 1, { orderStop: true, buyerUserId: 7, unitPrice: "44.00" });
const reasons = [{ id: 1, forwardToNextStop: true }, { id: 2, forwardToNextStop: false }];

describe("Lieferkette über mehrere Sparten – dieselbe Station erkennen", () => {
  it("Käufer einer Station: das Konto – ohne Konto der Name, Groß- und Kleinschreibung egal", () => {
    expect(stopBuyerKey({ buyerUserId: 12, buyerName: "Solar Nord" })).toBe("u12"); expect(stopBuyerKey({ buyerUserId: null, buyerName: "  Solar NORD " })).toBe("n:solar nord"); expect(stopBuyerKey({ buyerUserId: null, buyerName: "Solar Nord" })).toBe(stopBuyerKey({ buyerUserId: null, buyerName: "solar nord" }));
    expect(stopBuyerKey({ buyerUserId: 12, buyerName: "A" })).not.toBe(stopBuyerKey({ buyerUserId: 13, buyerName: "A" }));
  });
  it("die Stationen nach Station 1 – der Reihe nach", () => { const list = [stop("C", 3), station(), stop("B", 2)]; expect(extraStops(list).map((item) => item.buyerName)).toEqual(["B", "C"]); });
  it("Einstellungen zum Übertragen: aufgeräumt – Feld-Filter auf Felder, die es in der anderen Sparte nicht gibt, gehen nicht mit", () => {
    const source = stop("Solar Nord", 2, { unitPrice: 29.5, maxLeads: 40, geoMode: "plz", geoValues: ["10", " 12 ", ""], fieldFilters: [{ field: "dachflaeche", op: "groesser", value: "30" }, { field: "city", op: "gesetzt" }, { field: " " }, null], excludedSupplierIds: ["3", 0, "x"], phoneFilter: "only_valid", maxLeadAgeMinutes: 90 });
    const all = stopValues(source); expect(all.dropped).toEqual([]);
    expect(all.values).toEqual({ buyerName: "Solar Nord", buyerUserId: null, unitPrice: "29.50", active: true, reclamationWindowHours: 24, maxLeads: 40, geoCountry: null, geoMode: "plz", geoValues: ["10", "12"], fieldFilters: [{ field: "dachflaeche", op: "groesser", value: "30" }, { field: "city", op: "gesetzt" }], excludedSupplierIds: [3], excludedBuyerUserIds: [], excludeAutomationDuplicates: false, phoneFilter: "only_valid", maxLeadAgeMinutes: 90 });
    const other = stopValues(source, new Set(["dachflaeche"])); expect(other.dropped).toEqual(["dachflaeche"]); expect(other.values.fieldFilters).toEqual([{ field: "city", op: "gesetzt" }]);
  });
});

describe("Lieferkette über mehrere Sparten – sind zwei Ketten gleich?", () => {
  const sign = (stops: RouteStop[], rules: RouteRule[] = [], foreignFields?: Set<string>) => chainSignature({ stops, rules, reasons, foreignFields });
  it("gleich: dieselben Käufer in derselben Reihenfolge mit denselben Einstellungen – Station 1 und die Kennungen zählen nicht", () => {
    const a = [station(), stop("Solar Nord", 2, { buyerUserId: 12 }), stop("Vektor Klima", 3)]; const b = [station("Anderer Käufer"), stop("solar nord (anders geschrieben)", 2, { buyerUserId: 12 }), stop("VEKTOR KLIMA", 3)];
    expect(sign(a)).toBe(sign(b)); expect(sign([station()])).toBe(sign([])); expect(sign([station()])).toBe("[]");
  });
  it("verschieden: andere Reihenfolge, anderer Preis, ausgeschaltet, Höchstmenge, Gebiet, Filter", () => {
    const base = [station(), stop("B", 2), stop("C", 3)]; const same = sign(base);
    expect(sign([station(), stop("C", 2), stop("B", 3)])).not.toBe(same); expect(sign([station(), stop("B", 2)])).not.toBe(same);
    for (const change of [{ unitPrice: "31.00" }, { active: false }, { maxLeads: 10 }, { reclamationWindowHours: 48 }, { geoMode: "bundesland", geoValues: ["Hessen"] }, { fieldFilters: [{ field: "city", op: "gesetzt" }] }, { excludedSupplierIds: [4] }, { phoneFilter: "only_valid" }, { maxLeadAgeMinutes: 60 }, { excludeAutomationDuplicates: true }] as Array<Partial<RouteStop>>) expect(sign([station(), stop("B", 2, change), stop("C", 3)]), JSON.stringify(change)).not.toBe(same);
    expect(sign([station(), stop("B", 2, { geoValues: ["12", "10"], geoMode: "plz" })])).toBe(sign([station(), stop("B", 2, { geoValues: ["10", "12"], geoMode: "plz" })])); // die Reihenfolge der Gebiete ist egal
  });
  it("Regeln zählen, wie sie wirken: ohne eigene Zeile gilt „erlaubt“ und die Vorgabe des Grundes", () => {
    const a = stop("B", 2); const b = stop("B", 2); const plain = sign([a]);
    expect(sign([b], [{ stopId: b.id, reasonId: 1, allowed: true, passOn: true }, { stopId: b.id, reasonId: 2, allowed: true, passOn: false }])).toBe(plain); // ausdrücklich dasselbe wie die Vorgabe
    expect(sign([b], [{ stopId: b.id, reasonId: 2, allowed: true, passOn: true }])).not.toBe(plain); expect(sign([b], [{ stopId: b.id, reasonId: 1, allowed: false, passOn: true }])).not.toBe(plain);
  });
  it("Vergleich Quelle → Ziel: Filter, die im Ziel nicht gelten können, zählen bei der Quelle nicht mit", () => {
    const source = [stop("B", 2, { fieldFilters: [{ field: "dachflaeche", op: "gesetzt" }, { field: "city", op: "gesetzt" }] })]; const target = [stop("B", 2, { fieldFilters: [{ field: "city", op: "gesetzt" }] })];
    expect(sign(source)).not.toBe(sign(target)); expect(sign(source, [], new Set(["dachflaeche"]))).toBe(sign(target));
  });
});

describe("Lieferkette über mehrere Sparten – Kette übernehmen", () => {
  it("Stationen mit demselben Käufer bleiben und werden angepasst, fehlende kommen dazu, überzählige fallen weg – Station 1 bleibt", () => {
    const b = stop("Solar Nord", 2, { buyerUserId: 12, unitPrice: "29.50", maxLeads: 40 }); const c = stop("Vektor Klima", 3, { unitPrice: "25.00" }); const source = [station(), b, c];
    const keep = stop("solar nord", 3, { buyerUserId: 12, unitPrice: "10.00" }); const gone = stop("Helios Solar", 2); const first = station(); const target = [first, gone, keep];
    const plan = planChainCopy({ source, sourceRules: [{ stopId: b.id, reasonId: 1, allowed: false, passOn: false }, { stopId: 999, reasonId: 1, allowed: true, passOn: true }], target });
    expect(plan.updates).toHaveLength(1); expect(plan.updates[0]).toMatchObject({ id: keep.id, values: { buyerName: "Solar Nord", buyerUserId: 12, unitPrice: "29.50", maxLeads: 40 }, rules: [{ reasonId: 1, allowed: false, passOn: false }] });
    expect(plan.inserts).toHaveLength(1); expect(plan.inserts[0]).toMatchObject({ values: { buyerName: "Vektor Klima", unitPrice: "25.00" }, rules: [] });
    expect(plan.removes).toEqual([gone.id]); expect(plan.order).toEqual(["u12", "n:vektor klima"]); expect(plan.dropped).toEqual([]);
    expect([...plan.updates.map((item) => item.id), ...plan.removes]).not.toContain(first.id);
  });
  it("leere Quelle: Im Ziel bleibt nur Station 1; gleiche Ketten: nichts kommt dazu, nichts fällt weg", () => {
    const target = [station(), stop("B", 2), stop("C", 3)];
    expect(planChainCopy({ source: [station()], sourceRules: [], target })).toMatchObject({ updates: [], inserts: [], removes: [target[1].id, target[2].id], order: [] });
    const same = planChainCopy({ source: [station(), stop("B", 2), stop("C", 3)], sourceRules: [], target }); expect(same.inserts).toEqual([]); expect(same.removes).toEqual([]); expect(same.updates.map((item) => item.id)).toEqual([target[1].id, target[2].id]);
  });
  it("derselbe Käufer doppelt: In der Quelle zählt die erste Station, im Ziel bleibt nur eine", () => {
    const twice = [stop("B", 2), stop("b", 3), stop("C", 4)]; const target = [stop("C", 1), stop("c", 2)];
    const plan = planChainCopy({ source: twice, sourceRules: [], target }); expect(plan.order).toEqual(["n:b", "n:c"]); expect(plan.inserts.map((item) => item.values.buyerName)).toEqual(["B"]); expect(plan.updates.map((item) => item.id)).toEqual([target[0].id]); expect(plan.removes).toEqual([target[1].id]);
  });
  it("der Käufer der Bestellung steht im Ziel schon vorn – er kommt nicht noch einmal als weitere Station dazu", () => {
    const plan = planChainCopy({ source: [stop("Aurora Home", 1, { buyerUserId: 7 }), stop("B", 2)], sourceRules: [], target: [station()] });
    expect(plan.inserts.map((item) => item.values.buyerName)).toEqual(["B"]); expect(plan.order).toEqual(["n:b"]);
  });
  it("Feld-Filter, die es in der Sparte des Ziels nicht gibt, gehen nicht mit – und werden gemeldet", () => {
    const plan = planChainCopy({ source: [stop("B", 2, { fieldFilters: [{ field: "dachflaeche", op: "gesetzt" }, { field: "city", op: "gesetzt" }] })], sourceRules: [], target: [], foreignFields: new Set(["dachflaeche"]) });
    expect(plan.inserts[0].values.fieldFilters).toEqual([{ field: "city", op: "gesetzt" }]); expect(plan.dropped).toEqual([{ buyerName: "B", field: "dachflaeche" }]);
  });
  it("nach dem Übernehmen sind Quelle und Ziel gleich", () => {
    const source = [station(), stop("B", 2, { unitPrice: "19.90", geoMode: "plz", geoValues: ["60", "61"] }), stop("C", 3, { active: false })]; const target = [station(), stop("X", 2), stop("c", 3, { unitPrice: "5.00" })];
    const plan = planChainCopy({ source, sourceRules: [], target }); let id = 900;
    const result: RouteStop[] = [target[0], ...plan.updates.map((item) => ({ ...target.find((row) => row.id === item.id)!, ...item.values })), ...plan.inserts.map((item) => ({ ...stop(item.values.buyerName, 0), ...item.values, id: (id += 1) }))].filter((row) => !plan.removes.includes(row.id));
    const rank = (row: RouteStop) => (row.orderStop ? -1 : plan.order.indexOf(stopBuyerKey(row))); result.sort((a, b) => rank(a) - rank(b)).forEach((row, index) => { row.position = index + 1; });
    expect(result.map((row) => [row.position, row.buyerName, row.unitPrice, row.active])).toEqual([[1, "Aurora Home", "44.00", true], [2, "B", "19.90", true], [3, "C", "30.00", false]]);
    expect(chainSignature({ stops: result, rules: [], reasons })).toBe(chainSignature({ stops: source, rules: [], reasons }));
  });
});

describe("Bestellübersicht – wohin die Leads einer Bestellung gehen", () => {
  const chain = (id: number, categoryId: number, stops: RouteStop[], status = "aktiv", exhaustedAction: string | null = "release") => ({ id, categoryId, status, exhaustedAction, stops });
  it("je Sparte ein Weg – Sparten mit demselben Weg stehen zusammen, in der Reihenfolge der Bestellung", () => {
    const routes = orderRoutes([chain(1, 10, [station(), stop("B", 2)]), chain(2, 20, [station(), stop("C", 2)]), chain(3, 30, [stop("B", 2), station()])], [30, 20, 10]);
    expect(routes.map((route) => [route.categoryIds, route.chainIds, route.stops.map((item) => item.buyerName)])).toEqual([[[30, 10], [3, 1], ["Aurora Home", "B"]], [[20], [2], ["Aurora Home", "C"]]]);
    expect(routes[0].stops[0]).toEqual({ position: 1, buyerName: "Aurora Home", unitPrice: 44, active: true, orderStop: true, maxLeads: null });
  });
  it("es zählen nur die Sparten der Bestellung; hat eine Sparte zwei Ketten, zählt die eingeschaltete; ohne Kette gibt es keinen Weg", () => {
    const routes = orderRoutes([chain(1, 10, [station()], "inaktiv"), chain(2, 10, [station(), stop("B", 2)]), chain(3, 99, [station()])], [10, 20]);
    expect(routes).toHaveLength(1); expect(routes[0]).toMatchObject({ categoryIds: [10], chainIds: [2], active: true }); expect(orderRoutes([], [10])).toEqual([]);
  });
  it("verschieden sind auch: anderer Preis, ausgeschaltete Station, ausgeschaltete Kette, anderes Ende", () => {
    const base = () => [station(), stop("B", 2)];
    expect(orderRoutes([chain(1, 10, base()), chain(2, 20, [station(), stop("B", 2, { unitPrice: "31.00" })])], [10, 20])).toHaveLength(2);
    expect(orderRoutes([chain(1, 10, base()), chain(2, 20, [station(), stop("B", 2, { active: false })])], [10, 20])).toHaveLength(2);
    expect(orderRoutes([chain(1, 10, base()), chain(2, 20, base(), "inaktiv")], [10, 20])).toHaveLength(2); expect(orderRoutes([chain(1, 10, base()), chain(2, 20, base(), "aktiv", "return")], [10, 20])).toHaveLength(2);
    expect(orderRoutes([chain(1, 10, base()), chain(2, 20, base())], [10, 20])).toHaveLength(1);
  });
  it("der Weg in Sätzen – mit dem, was am Ende passiert", () => {
    const route = (names: Array<[string, boolean]>, values: { active?: boolean; returns?: boolean } = {}) => ({ active: values.active ?? true, returns: values.returns ?? false, stops: names.map(([buyerName, active], index) => ({ position: index + 1, buyerName, unitPrice: 30, active, orderStop: index === 0, maxLeads: null })) });
    expect(routeSentence(route([["A", true], ["B", true], ["C", true]]))).toBe("Jeder Lead geht zuerst an A. Nimmt A ihn nicht, geht er an B, danach an C. Nimmt ihn keine Station, ist er frei für deine anderen Ketten und Bestellungen.");
    expect(routeSentence(route([["A", true]]))).toBe("Jeder Lead geht an A. Nimmt A ihn nicht, ist er frei für deine anderen Ketten und Bestellungen – es gibt keine weitere Station.");
    expect(routeSentence(route([["A", true], ["B", false], ["C", true]], { returns: true }))).toBe("Jeder Lead geht zuerst an A. Nimmt A ihn nicht, geht er an C. Nimmt ihn keine Station, geht er zurück an die Quelle."); // ausgeschaltete Station wird übersprungen
    expect(routeSentence(route([["A", false]]))).toBe("Noch keine eingeschaltete Station – über diese Kette geht kein Lead raus."); expect(routeSentence(route([["A", true]], { active: false }))).toBe("Diese Kette ist ausgeschaltet – über sie geht kein Lead raus.");
    expect(routeEnd({ returns: false })).toBe("ist er frei für deine anderen Ketten und Bestellungen"); expect(routeEnd({ returns: true })).toBe("geht er zurück an die Quelle");
  });
});
