import { describe, expect, it } from "vitest";
import { agentNameMerges, canonicalAgentName, sameAgentName } from "../shared/agent-names";

describe("Agenten-Namen: ähnlich klingende Namen sind dieselbe Person", () => {
  it.each([["Maja Becker", "Maja Decker"], ["Maya Becker", "Maja Becker"], ["David Pfeil", "David Feiles"], ["Monika Hansen", "Miriam Hansen"], ["Sabine Hagen", "Sabine Hagn"], ["Vanessa Schiffer", "Wanessa Schiffer"], ["Vanessa Schiffer", "Nesta Schiffer"], ["Thomas Müller", "Petra Müller"]])("%s = %s", (a, b) => { expect(sameAgentName(a, b)).toBe(true); expect(sameAgentName(b, a)).toBe(true); });
  it.each([["Maja Becker", "Sabine Hagen"], ["Maja Becker", "David Pfeil"], ["Monika Hansen", "Vanessa Schiffer"], ["Sabine Hagen", "Monika Hansen"], ["Woche", "Maja Becker"], ["David Pfeil", "Daniel Schmidt"]])("%s ≠ %s", (a, b) => { expect(sameAgentName(a, b)).toBe(false); });
  it("neuer Name wird dem bekannten zugeordnet, der häufigere gewinnt", () => {
    const known = [{ name: "Maja Becker", count: 6 }, { name: "David Pfeil", count: 2 }, { name: "Monika Hansen", count: 3 }];
    expect(canonicalAgentName("Maja Decker", known)).toBe("Maja Becker"); expect(canonicalAgentName("David Feiles", known)).toBe("David Pfeil"); expect(canonicalAgentName("Miriam Hansen", known)).toBe("Monika Hansen"); expect(canonicalAgentName("Sabine Hagen", known)).toBe("Sabine Hagen");
  });
  it("führt die Liste aus dem Beispiel zusammen", () => {
    const merges = agentNameMerges([{ name: "Maja Becker", count: 6 }, { name: "Maja Decker", count: 1 }, { name: "Sabine Hagen", count: 1 }, { name: "Vanessa Schiffer", count: 2 }, { name: "Monika Hansen", count: 3 }, { name: "David Pfeil", count: 2 }, { name: "Woche", count: 1 }, { name: "David Feiles", count: 1 }, { name: "Miriam Hansen", count: 1 }]);
    expect(merges.sort((a, b) => a.from.localeCompare(b.from))).toEqual([{ from: "David Feiles", to: "David Pfeil" }, { from: "Maja Decker", to: "Maja Becker" }, { from: "Miriam Hansen", to: "Monika Hansen" }]);
  });
});
