import { describe, expect, it } from "vitest";
import { dashboardGreeting } from "../client/src/lib/dashboardGreeting";

describe("Dashboard-Begrüßung", () => {
  it("ordnet Morgen, Tag und Abend der lokalen Stunde zu", () => {
    expect(dashboardGreeting(0)).toBe("Guten Morgen");
    expect(dashboardGreeting(11)).toBe("Guten Morgen");
    expect(dashboardGreeting(12)).toBe("Guten Tag");
    expect(dashboardGreeting(17)).toBe("Guten Tag");
    expect(dashboardGreeting(18)).toBe("Guten Abend");
    expect(dashboardGreeting(23)).toBe("Guten Abend");
  });
});
