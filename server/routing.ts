export type ChainCandidate = { id: number; priority: number; status: "aktiv" | "inaktiv"; cursor: number; stopCount: number; hasOrder?: boolean };
export type FieldCondition = { field: string; operator: "gleich" | "ungleich" | "größer_als" | "kleiner_als" | "größer_gleich" | "kleiner_gleich" | "zwischen" | "nicht_zwischen" | "enthält" | "gesetzt"; value?: string };

export function selectNextChain(chains: ChainCandidate[], mode: "lieferketten_round_robin" | "bestellungen_round_robin") {
  // Reihenfolge nach Priorität (kleiner = wichtiger); bei gleicher Priorität Round-Robin über den Zähler
  const active = chains.filter((chain) => chain.status === "aktiv" && chain.stopCount > 0).sort((a, b) => a.priority - b.priority || a.id - b.id);
  if (!active.length) return undefined;
  if (mode === "bestellungen_round_robin") return active[0];
  const priority = active[0].priority;
  const priorityGroup = active.filter((chain) => chain.priority === priority);
  const minCursor = Math.min(...priorityGroup.map((chain) => chain.cursor));
  return priorityGroup.filter((chain) => chain.cursor === minCursor)[0];
}

export function selectStopPosition(cursor: number, stopCount: number) {
  if (stopCount < 1) throw new Error("Eine Lieferkette benötigt mindestens einen aktiven Stop.");
  return (cursor % stopCount) + 1;
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
