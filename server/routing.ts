export type ChainCandidate = { id: number; priority: number; status: "aktiv" | "inaktiv"; stopCount: number; hasOrder?: boolean };
export type FieldCondition = { field: string; operator: "gleich" | "ungleich" | "größer_als" | "kleiner_als" | "größer_gleich" | "kleiner_gleich" | "zwischen" | "nicht_zwischen" | "enthält" | "gesetzt"; value?: string };

/**
 * Feste Verteilung: Passen mehrere Ketten zu einem Lead, kommt immer zuerst die mit der kleinsten Zahl bei „Reihenfolge“
 * (bei gleicher Zahl die ältere Kette). Es wird nicht abgewechselt – dieselbe Art Lead geht immer denselben Weg.
 */
export function selectNextChain(chains: ChainCandidate[]) {
  return chains.filter((chain) => chain.status === "aktiv" && chain.stopCount > 0).sort((a, b) => a.priority - b.priority || a.id - b.id)[0];
}

export function conditionsMatch(data: Record<string, unknown>, conditions: FieldCondition[], mode: "alle" | "mindestens_eine") {
  if (!conditions.length) return true;
  const matches = conditions.map((condition) => {
    const raw = data[condition.field]; const value = raw === undefined || raw === null ? "" : String(raw);
    if (condition.operator === "gesetzt") return value.length > 0;
    if (condition.operator === "gleich") return value === (condition.value ?? "");
    if (condition.operator === "ungleich") return value !== (condition.value ?? "");
    if (condition.operator === "enthält") return value.toLowerCase().includes((condition.value ?? "").toLowerCase());
    const number = Number(value.replace(",", ".")); const comparison = condition.value ?? "";
    if (!Number.isFinite(number)) return false;
    if (condition.operator === "größer_als") return number > Number(comparison.replace(",", "."));
    if (condition.operator === "kleiner_als") return number < Number(comparison.replace(",", "."));
    if (condition.operator === "größer_gleich") return number >= Number(comparison.replace(",", "."));
    if (condition.operator === "kleiner_gleich") return number <= Number(comparison.replace(",", "."));
    const [from, until] = comparison.split("|").map((part) => Number(part.trim().replace(",", ".")));
    const within = Number.isFinite(from) && Number.isFinite(until) && number >= from && number <= until;
    return condition.operator === "zwischen" ? within : !within;
  });
  return mode === "alle" ? matches.every(Boolean) : matches.some(Boolean);
}

export function canExecuteAutomation(source: { supplierId: number | null; metadata: Record<string, unknown> }, rule: { supplierId: number | null; conditions: FieldCondition[]; conditionMode: "alle" | "mindestens_eine" }) {
  if (rule.supplierId && rule.supplierId !== source.supplierId) return false;
  return conditionsMatch(source.metadata, rule.conditions, rule.conditionMode);
}
