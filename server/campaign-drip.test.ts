import { describe, expect, it } from "vitest";
import { DEFAULT_DRIP, dripBudget, resolveDrip } from "../shared/email-campaigns";

describe("Drip-Versand", () => {
  const now = new Date("2026-10-21T08:00:00Z");
  it("Standard ist an: 40 pro Stunde, ca. 90 Sekunden Abstand", () => {
    expect(resolveDrip(null)).toEqual(DEFAULT_DRIP);
    expect(resolveDrip({ enabled: false })).toMatchObject({ enabled: false, perHour: 40 });
    expect(resolveDrip({ perHour: 0, gapSeconds: 2 })).toMatchObject({ perHour: 40, gapSeconds: 90 });
  });
  it("aus: kein Limit", () => { expect(dripBudget({ ...DEFAULT_DRIP, enabled: false }, 999, now, now)).toBe(Number.POSITIVE_INFINITY); });
  it("Stundenlimit erreicht → nichts", () => { expect(dripBudget({ enabled: true, perHour: 10, gapSeconds: 60 }, 10, null, now)).toBe(0); });
  it("Abstand noch nicht vorbei → nichts, danach eine", () => {
    const drip = { enabled: true, perHour: 40, gapSeconds: 90 };
    expect(dripBudget(drip, 3, new Date(now.getTime() - 30_000), now, 0.5)).toBe(0);
    expect(dripBudget(drip, 3, new Date(now.getTime() - 120_000), now, 0.5)).toBe(1);
    expect(dripBudget(drip, 0, null, now, 0.5)).toBe(1);
  });
  it("kurzer Abstand → mehrere je Minute, aber nie über das Stundenlimit", () => {
    expect(dripBudget({ enabled: true, perHour: 100, gapSeconds: 30 }, 0, null, now, 0.5)).toBe(2);
    expect(dripBudget({ enabled: true, perHour: 100, gapSeconds: 30 }, 99, null, now, 0.5)).toBe(1);
  });
});
