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

  it("Gestern: der ganze Vortag (v359)", () => {
    const range = dashboardRange("yesterday", "", "", now);
    expect(range.from.toISOString()).toBe("2026-08-17T00:00:00.000Z"); expect(range.until.toISOString()).toBe("2026-08-17T23:59:59.999Z"); expect(range.label).toBe("Gestern"); expect(range.valid).toBe(true);
    const monday = dashboardRange("yesterday", "", "", new Date("2026-09-01T08:00:00.000Z")); // über den Monatswechsel
    expect(monday.from.toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("Erstellt ab: ab dem gewählten Tag bis jetzt – ein Tag in der Zukunft ist gültig, aber leer (v377)", () => {
    const range = dashboardRange("since", "2026-08-10", "", now);
    expect(range.from.toISOString()).toBe("2026-08-10T00:00:00.000Z"); expect(range.until.toISOString()).toBe(now.toISOString()); expect(range.label).toBe("ab 10.08.2026"); expect(range.valid).toBe(true); expect(range.open).toBe("since");
    expect(rangeDayCount(range.from, range.until)).toBe(9); // 10. bis 18. August
    const today = dashboardRange("since", "2026-08-18", "", now); expect(rangeDayCount(today.from, today.until)).toBe(1);
    const future = dashboardRange("since", "2026-09-01", "", now); expect(future.valid).toBe(true); expect(future.from.toISOString()).toBe("2026-09-01T00:00:00.000Z"); expect(future.until.toISOString()).toBe("2026-09-01T23:59:59.999Z"); expect(future.from.getTime()).toBeGreaterThan(now.getTime());
    const missing = dashboardRange("since", "", "2026-08-10", now); expect(missing.valid).toBe(false); expect(missing.problem).toBe("missing"); expect(missing.open).toBe("since"); // das Bis-Feld zählt hier nicht
    expect(dashboardRange("since", "10.08.2026", "", now).valid).toBe(false);
  });

  it("Erstellt vor: alles vor dem gewählten Tag – der Tag selbst zählt nicht mit, einen Anfang gibt es nicht (v377)", () => {
    const range = dashboardRange("before", "", "2026-08-10", now);
    expect(range.from.getTime()).toBe(0); expect(range.until.toISOString()).toBe("2026-08-09T23:59:59.999Z"); expect(range.label).toBe("vor 10.08.2026"); expect(range.valid).toBe(true); expect(range.open).toBe("before");
    const missing = dashboardRange("before", "2026-08-10", "", now); expect(missing.valid).toBe(false); expect(missing.problem).toBe("missing"); // das Von-Feld zählt hier nicht
    // die festen Zeiträume und der eigene Zeitraum sind nicht „offen“
    expect(dashboardRange("all", "", "", now).open).toBeUndefined(); expect(dashboardRange("custom", "2026-08-01", "2026-08-10", now).open).toBeUndefined();
  });

  it("Letzter Monat: der ganze Vormonat (v364)", () => {
    const range = dashboardRange("last_month", "", "", now);
    expect(range.from.toISOString()).toBe("2026-07-01T00:00:00.000Z"); expect(range.until.toISOString()).toBe("2026-07-31T23:59:59.999Z"); expect(range.label).toBe("Letzter Monat"); expect(range.valid).toBe(true);
    const january = dashboardRange("last_month", "", "", new Date("2027-01-10T08:00:00.000Z")); // über den Jahreswechsel
    expect(january.from.toISOString()).toBe("2026-12-01T00:00:00.000Z"); expect(january.until.toISOString()).toBe("2026-12-31T23:59:59.999Z");
    expect(dashboardRange("last_month", "", "", new Date("2026-03-05T08:00:00.000Z")).until.toISOString()).toBe("2026-02-28T23:59:59.999Z"); // Februar
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
