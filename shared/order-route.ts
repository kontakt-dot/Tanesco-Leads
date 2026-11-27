/**
 * Lieferkette einer Bestellung über mehrere Leadsparten (v379).
 * Jede Sparte der Bestellung hat ihre eigene Kette. Station 1 ist immer die Bestellung selbst; was danach kommt – wohin ein Lead geht,
 * wenn Station 1 ihn nicht nimmt –, lässt sich für alle Sparten gemeinsam festlegen oder für einzelne.
 * Hier steht die Rechnung dazu, eine Quelle für Server, Vorschau und Oberfläche:
 *  • der Fingerabdruck einer Kette (sind zwei Ketten gleich?),
 *  • der Plan, eine Kette auf die einer anderen Sparte zu übertragen (anpassen, ergänzen, entfernen, Reihenfolge),
 *  • die Wege einer Bestellung für die Bestellübersicht (Sparten mit demselben Weg stehen zusammen).
 */
export type RouteStop = {
  id: number; buyerName: string; buyerUserId: number | null; position: number; unitPrice: string | number; active: boolean; orderStop: boolean;
  reclamationWindowHours: number; maxLeads: number | null; geoCountry: string | null; geoMode: string; geoValues: unknown; fieldFilters: unknown;
  excludedSupplierIds: unknown; excludedBuyerUserIds: unknown; excludeAutomationDuplicates: boolean; phoneFilter: string; maxLeadAgeMinutes: number | null;
};
export type RouteRule = { stopId: number; reasonId: number; allowed: boolean; passOn: boolean };
export type RouteReason = { id: number; forwardToNextStop: boolean };
export type RouteFilter = { field: string; op: string; value?: string };
/** Was beim Übertragen einer Station mitgeht: alles außer ihrem Platz. */
export type StopValues = {
  buyerName: string; buyerUserId: number | null; unitPrice: string; active: boolean; reclamationWindowHours: number; maxLeads: number | null;
  geoCountry: string | null; geoMode: string; geoValues: string[]; fieldFilters: RouteFilter[]; excludedSupplierIds: number[]; excludedBuyerUserIds: number[];
  excludeAutomationDuplicates: boolean; phoneFilter: string; maxLeadAgeMinutes: number | null;
};
export type StopRuleValues = { reasonId: number; allowed: boolean; passOn: boolean };

const texts = (value: unknown): string[] => (Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : []);
const numbers = (value: unknown): number[] => (Array.isArray(value) ? value.map(Number).filter((id) => Number.isInteger(id) && id > 0) : []);
const filtersOf = (value: unknown): RouteFilter[] => (Array.isArray(value) ? (value as Array<Partial<RouteFilter> | null>).filter((item): item is RouteFilter => Boolean(item && typeof item.field === "string" && item.field.trim())).map((item) => ({ field: item.field.trim(), op: String(item.op), ...(item.value !== undefined && item.value !== null && String(item.value) !== "" ? { value: String(item.value) } : {}) })) : []);
const priceText = (value: string | number) => (Number(value) || 0).toFixed(2);
/** Käufer einer Station: das Konto – ohne Konto der Name (Groß- und Kleinschreibung egal). Daran finden sich dieselben Stationen in zwei Ketten. */
export const stopBuyerKey = (stop: Pick<RouteStop, "buyerUserId" | "buyerName">): string => (stop.buyerUserId ? `u${stop.buyerUserId}` : `n:${String(stop.buyerName ?? "").trim().toLowerCase()}`);
/** Die Stationen nach Station 1 – der Reihe nach. */
export const extraStops = <T extends Pick<RouteStop, "orderStop" | "position">>(stops: T[]): T[] => stops.filter((stop) => !stop.orderStop).sort((a, b) => a.position - b.position);

/**
 * Einstellungen einer Station zum Übertragen. `foreignFields`: Felder, die es nur in der Sparte der Quelle gibt – ein Feld-Filter darauf
 * würde in der anderen Sparte jeden Lead abweisen, deshalb geht er nicht mit (und wird gemeldet).
 */
export function stopValues(stop: RouteStop, foreignFields: ReadonlySet<string> = new Set()): { values: StopValues; dropped: string[] } {
  const all = filtersOf(stop.fieldFilters);
  return {
    values: {
      buyerName: String(stop.buyerName).trim(), buyerUserId: stop.buyerUserId ?? null, unitPrice: priceText(stop.unitPrice), active: stop.active !== false, reclamationWindowHours: Number(stop.reclamationWindowHours ?? 24), maxLeads: stop.maxLeads ?? null,
      geoCountry: stop.geoCountry ?? null, geoMode: String(stop.geoMode ?? "landesweit"), geoValues: texts(stop.geoValues), fieldFilters: all.filter((item) => !foreignFields.has(item.field)), excludedSupplierIds: numbers(stop.excludedSupplierIds), excludedBuyerUserIds: numbers(stop.excludedBuyerUserIds),
      excludeAutomationDuplicates: Boolean(stop.excludeAutomationDuplicates), phoneFilter: String(stop.phoneFilter ?? "all"), maxLeadAgeMinutes: stop.maxLeadAgeMinutes ?? null,
    },
    dropped: all.filter((item) => foreignFields.has(item.field)).map((item) => item.field),
  };
}

/** Die Regeln einer Station, wie sie wirken: Ohne eigene Zeile gilt „erlaubt“ und die Vorgabe des Grundes. */
const ruleText = (stopId: number, rules: RouteRule[], reasons: RouteReason[]) => reasons.map((reason) => { const rule = rules.find((item) => item.stopId === stopId && item.reasonId === reason.id); return `${reason.id}:${rule ? (rule.allowed ? 1 : 0) : 1}${rule ? (rule.passOn ? 1 : 0) : reason.forwardToNextStop ? 1 : 0}`; }).join(",");
/**
 * Fingerabdruck einer Kette: die Stationen nach Station 1 in ihrer Reihenfolge – mit Käufer, Preis, allen Einstellungen und Regeln.
 * Zwei Ketten mit demselben Fingerabdruck machen mit einem Lead dasselbe. Für den Vergleich „Quelle → Ziel“ bekommt die Quelle die
 * `foreignFields` des Ziels (diese Filter könnten dort ohnehin nicht gelten).
 */
export function chainSignature(input: { stops: RouteStop[]; rules: RouteRule[]; reasons: RouteReason[]; foreignFields?: ReadonlySet<string> }): string {
  return JSON.stringify(extraStops(input.stops).map((stop) => {
    const { values } = stopValues(stop, input.foreignFields);
    return [stopBuyerKey(stop), values.unitPrice, values.active, values.reclamationWindowHours, values.maxLeads, values.geoCountry, values.geoMode, [...values.geoValues].sort(), values.fieldFilters.map((item) => `${item.field}|${item.op}|${item.value ?? ""}`).sort(), [...values.excludedSupplierIds].sort((a, b) => a - b), [...values.excludedBuyerUserIds].sort((a, b) => a - b), values.excludeAutomationDuplicates, values.phoneFilter, values.maxLeadAgeMinutes, ruleText(stop.id, input.rules, input.reasons)];
  }));
}

export type ChainCopyPlan = {
  /** Stationen des Ziels, die bleiben und angepasst werden */ updates: Array<{ id: number; values: StopValues; rules: StopRuleValues[] }>;
  /** Stationen, die im Ziel fehlen */ inserts: Array<{ values: StopValues; rules: StopRuleValues[] }>;
  /** Stationen des Ziels, die es in der Quelle nicht gibt */ removes: number[];
  /** Käufer der Stationen nach Station 1 in der neuen Reihenfolge */ order: string[];
  /** Feld-Filter, die nicht mitgehen: Das Feld gibt es in der Sparte des Ziels nicht */ dropped: Array<{ buyerName: string; field: string }>;
};
/**
 * Plan, die Kette der Quelle auf das Ziel zu übertragen: Danach hat das Ziel nach seiner Station 1 dieselben Stationen in derselben
 * Reihenfolge. Stationen mit demselben Käufer bleiben erhalten (mit ihren Zahlen) und werden angepasst; fehlende kommen dazu;
 * Stationen, die es in der Quelle nicht gibt, fallen weg. Station 1 (die Bestellung) fasst der Plan nie an.
 */
export function planChainCopy(input: { source: RouteStop[]; sourceRules: RouteRule[]; target: RouteStop[]; foreignFields?: ReadonlySet<string> }): ChainCopyPlan {
  const plan: ChainCopyPlan = { updates: [], inserts: [], removes: [], order: [], dropped: [] };
  const stationKeys = new Set(input.target.filter((stop) => stop.orderStop).map(stopBuyerKey)); // der Käufer der Bestellung steht im Ziel schon vorn
  const have = new Map<string, RouteStop>();
  for (const stop of extraStops(input.target)) { const key = stopBuyerKey(stop); if (have.has(key)) plan.removes.push(stop.id); else have.set(key, stop); } // derselbe Käufer doppelt: Nur die erste Station bleibt
  const seen = new Set<string>();
  for (const stop of extraStops(input.source)) {
    const key = stopBuyerKey(stop); if (seen.has(key) || stationKeys.has(key)) continue; seen.add(key);
    const { values, dropped } = stopValues(stop, input.foreignFields); for (const field of dropped) plan.dropped.push({ buyerName: values.buyerName, field });
    const rules = input.sourceRules.filter((rule) => rule.stopId === stop.id).map((rule) => ({ reasonId: rule.reasonId, allowed: Boolean(rule.allowed), passOn: Boolean(rule.passOn) }));
    const existing = have.get(key); if (existing) plan.updates.push({ id: existing.id, values, rules }); else plan.inserts.push({ values, rules });
    plan.order.push(key);
  }
  have.forEach((stop, key) => { if (!seen.has(key)) plan.removes.push(stop.id); });
  return plan;
}

/* ------------------------------------------------------------------ Bestellübersicht: wohin die Leads einer Bestellung gehen */
export type OrderRouteStop = { position: number; buyerName: string; unitPrice: number; active: boolean; orderStop: boolean; maxLeads: number | null };
export type OrderRoute = { /** Sparten mit diesem Weg – in der Reihenfolge der Bestellung */ categoryIds: number[]; chainIds: number[]; /** die Kette ist eingeschaltet */ active: boolean; /** nimmt keine Station den Lead: frei für andere Ketten – oder zurück an die Quelle */ returns: boolean; stops: OrderRouteStop[] };
type RouteChain = { id: number; categoryId: number; status: string; exhaustedAction?: string | null; stops: Array<Pick<RouteStop, "buyerName" | "buyerUserId" | "position" | "unitPrice" | "active" | "orderStop" | "maxLeads">> };
/**
 * Die Wege einer Bestellung: je Leadsparte die Stationen der Reihe nach. Sparten, deren Leads denselben Weg nehmen (dieselben Käufer in
 * derselben Reihenfolge, gleicher Preis, gleich ein- oder ausgeschaltet), stehen zusammen. Es zählen nur die Sparten der Bestellung.
 */
export function orderRoutes(chains: RouteChain[], categoryIds: number[]): OrderRoute[] {
  const routes: Array<OrderRoute & { key: string }> = [];
  for (const categoryId of categoryIds) {
    const chain = chains.filter((item) => item.categoryId === categoryId).sort((a, b) => Number(b.status === "aktiv") - Number(a.status === "aktiv") || a.id - b.id)[0]; if (!chain) continue;
    const stops = [...chain.stops].sort((a, b) => a.position - b.position).map((stop) => ({ position: stop.position, buyerName: String(stop.buyerName), unitPrice: Number(stop.unitPrice) || 0, active: stop.active !== false, orderStop: Boolean(stop.orderStop), maxLeads: stop.maxLeads ?? null, key: stopBuyerKey(stop) }));
    const active = chain.status === "aktiv"; const returns = chain.exhaustedAction === "return"; const key = JSON.stringify([active, returns, stops.map((stop) => [stop.key, stop.unitPrice, stop.active, stop.orderStop, stop.maxLeads])]);
    const same = routes.find((route) => route.key === key);
    if (same) { same.categoryIds.push(categoryId); same.chainIds.push(chain.id); } else routes.push({ key, categoryIds: [categoryId], chainIds: [chain.id], active, returns, stops: stops.map(({ key: _key, ...stop }) => stop) });
  }
  return routes.map(({ key: _key, ...route }) => route);
}
/** Was passiert, wenn keine Station den Lead nimmt – in Worten. */
export const routeEnd = (route: Pick<OrderRoute, "returns">): string => (route.returns ? "geht er zurück an die Quelle" : "ist er frei für deine anderen Ketten und Bestellungen");
/**
 * Der Weg in Sätzen: „Jeder Lead geht zuerst an A. Nimmt A ihn nicht, geht er an B, danach an C. Nimmt ihn keine Station, ist er frei …“ –
 * oder was fehlt. Ausgeschaltete Stationen werden übersprungen.
 */
export function routeSentence(route: Pick<OrderRoute, "active" | "stops" | "returns">): string {
  if (!route.active) return "Diese Kette ist ausgeschaltet – über sie geht kein Lead raus.";
  const buyers = route.stops.filter((stop) => stop.active).map((stop) => stop.buyerName);
  if (!buyers.length) return "Noch keine eingeschaltete Station – über diese Kette geht kein Lead raus.";
  if (buyers.length === 1) return `Jeder Lead geht an ${buyers[0]}. Nimmt ${buyers[0]} ihn nicht, ${routeEnd(route)} – es gibt keine weitere Station.`;
  const rest = buyers.slice(1).map((buyer, index) => (index === 0 ? `geht er an ${buyer}` : `danach an ${buyer}`)).join(", ");
  return `Jeder Lead geht zuerst an ${buyers[0]}. Nimmt ${buyers[0]} ihn nicht, ${rest}. Nimmt ihn keine Station, ${routeEnd(route)}.`;
}

/** Die Lieferkette kurz für eine Kachel: „Aurora Home → Vektor Klima“; bei mehreren Wegen deren Zahl. */
export function routeShort(routes: OrderRoute[]): { text: string; title: string } {
  if (!routes.length) return { text: "noch keine", title: "Für diese Bestellung gibt es noch keine Lieferkette. Sie entsteht, sobald du die Bestellung speicherst." };
  if (routes.length > 1) return { text: `${routes.length} Wege – je nach Sparte`, title: routes.map((route) => routeSentence(route)).join(" · ") };
  const route = routes[0]; const names = route.stops.filter((stop) => stop.active).map((stop) => stop.buyerName);
  return { text: !route.active ? "ausgeschaltet" : names.length ? names.join(" → ") : "keine eingeschaltete Station", title: routeSentence(route) };
}
