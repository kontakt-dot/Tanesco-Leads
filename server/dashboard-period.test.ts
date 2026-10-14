import { describe, expect, it } from "vitest";
import { customRangePreset, dashboardRange, precedingRange, rangeDayCount, relativeChange, toDateInput } from "../client/src/lib/dashboardPeriod";

describe("dashboard Zeitraumlogik", () => {
  const now = new Date("2026-08-18T14:00:00.000Z");

  it("berechnet Heute, Wochen- und Monatsstart korrekt", () => {
    expect(dashboardRange("today", "", "", now).from.toISOString()).toBe("2026-08-18T00:00:00.000Z");
    expect(dashboardRange("week", "", "", now).from.toISOString()).toBe("2026-08-17T00:00:00.000Z");
    expect(dashboardRange("month", "", "", now).from.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(dashboardRange("last_week", "", "", now).from.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    expect(dashboardRange("last_week", "", "", now).until.toISOString()).toBe("2026-08-16T23:59:59.999Z");
    expect(dashboardRange("last_two_weeks", "", "", now).from.toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect(dashboardRange("all", "", "", now).label).toBe("Gesamte Zeitspanne");
  });

  it("validiert eigene Zeitspannen und bildet den unmittelbar vorherigen Zeitraum", () => {
    const range = dashboardRange("custom", "2026-08-10", "2026-08-12", now);
    expect(range.valid).toBe(true);
    expect(range.from.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    expect(precedingRange(range).until.toISOString()).toBe("2026-08-09T23:59:59.999Z");
    expect(dashboardRange("custom", "2026-08-13", "2026-08-12", now)).toMatchObject({ valid: false, problem: "order" });
    expect(dashboardRange("custom", "", "2026-08-12", now)).toMatchObject({ valid: false, problem: "missing" });
    expect(range.label).toBe("10.08.2026 – 12.08.2026");
    expect(rangeDayCount(range.from, range.until)).toBe(3);
  });

  it("füllt die Schnellwahl des eigenen Zeitraums mit lokalen Datumswerten", () => {
    expect(customRangePreset("last7", now)).toEqual({ from: "2026-08-12", to: "2026-08-18" });
    expect(customRangePreset("last30", now)).toEqual({ from: "2026-07-20", to: "2026-08-18" });
    expect(customRangePreset("last_month", now)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(customRangePreset("this_quarter", now)).toEqual({ from: "2026-07-01", to: "2026-08-18" });
    expect(customRangePreset("this_year", now)).toEqual({ from: "2026-01-01", to: "2026-08-18" });
    expect(toDateInput(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("liefert verständliche relative Kennzahlen", () => {
    expect(relativeChange(15, 10)).toBe(50);
    expect(relativeChange(0, 8)).toBe(-100);
    expect(relativeChange(4, 0)).toBeNull();
  });
});
