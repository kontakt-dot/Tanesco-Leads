import { describe, expect, it } from "vitest";
import { canExecuteAutomation, conditionsMatch, selectNextChain } from "./routing";

describe("routing", () => {
  it("feste Verteilung: immer die Kette mit der kleinsten Zahl, bei gleicher Zahl die ältere – es wird nicht abgewechselt", () => {
    const chains = [{ id: 1, priority: 1, status: "aktiv" as const, stopCount: 2 }, { id: 2, priority: 1, status: "aktiv" as const, stopCount: 3 }, { id: 3, priority: 2, status: "aktiv" as const, stopCount: 2 }];
    expect(selectNextChain(chains)?.id).toBe(1);
    expect(selectNextChain(chains)?.id).toBe(1); // derselbe Lead-Typ geht immer denselben Weg
    expect(selectNextChain(chains.slice().reverse())?.id).toBe(1); // die Reihenfolge der Eingabe spielt keine Rolle
    expect(selectNextChain(chains.filter((chain) => chain.id !== 1))?.id).toBe(2); // erst wenn Kette 1 den Lead nicht nimmt, kommt Kette 2
    expect(selectNextChain([{ id: 9, priority: 1, status: "inaktiv" as const, stopCount: 2 }, { id: 10, priority: 5, status: "aktiv" as const, stopCount: 0 }, { id: 11, priority: 7, status: "aktiv" as const, stopCount: 1 }])?.id).toBe(11); // inaktive Ketten und Ketten ohne Kunden zählen nicht
    expect(selectNextChain([])).toBeUndefined();
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
