import { describe, expect, it } from "vitest";
import { canExecuteAutomation, conditionsMatch, selectNextChain, selectStopPosition } from "./routing";

describe("routing", () => {
  it("priorisiert aktive Lieferketten und verteilt gleichpriorisierte Ketten im Round-Robin", () => {
    const chains = [{ id: 1, priority: 1, status: "aktiv" as const, cursor: 4, stopCount: 2 }, { id: 2, priority: 1, status: "aktiv" as const, cursor: 3, stopCount: 3 }, { id: 3, priority: 2, status: "aktiv" as const, cursor: 0, stopCount: 2 }];
    expect(selectNextChain(chains, "lieferketten_round_robin")?.id).toBe(2);
    expect(selectNextChain(chains, "bestellungen_round_robin")?.id).toBe(1);
    expect(selectStopPosition(4, 3)).toBe(2);
  });

  it("wertet alle und alternative Feldbedingungen aus", () => {
    const data = { country: "DE", source: "Google Ads", consent: true };
    expect(conditionsMatch(data, [{ field: "country", operator: "gleich", value: "DE" }, { field: "source", operator: "enthält", value: "ads" }], "alle")).toBe(true);
    expect(conditionsMatch(data, [{ field: "country", operator: "gleich", value: "AT" }, { field: "consent", operator: "gesetzt" }], "mindestens_eine")).toBe(true);
  });

  it("wertet numerische Vergleiche sowie inklusive Wertebereiche aus", () => {
    const data = { score: "18", budget: "2500" };
    expect(conditionsMatch(data, [{ field: "score", operator: "größer_als", value: "15" }, { field: "score", operator: "kleiner_gleich", value: "18" }], "alle")).toBe(true);
    expect(conditionsMatch(data, [{ field: "budget", operator: "zwischen", value: "2000 | 3000" }], "alle")).toBe(true);
    expect(conditionsMatch(data, [{ field: "budget", operator: "nicht_zwischen", value: "2000 | 3000" }], "alle")).toBe(false);
  });

  it("lässt eine qualifizierte Automatisierung für die Lead-Duplizierung zu", () => {
    const source = { supplierId: 8, metadata: { country: "DE", consent: true } };
    const rule = { supplierId: 8, conditions: [{ field: "country", operator: "gleich" as const, value: "DE" }], conditionMode: "alle" as const };
    expect(canExecuteAutomation(source, rule)).toBe(true);
    expect(canExecuteAutomation(source, { ...rule, supplierId: 9 })).toBe(false);
  });
});
