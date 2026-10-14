import { describe, expect, it } from "vitest";
import { resolveTheme, sunTimes } from "../client/src/lib/appearance";

describe("Darstellung: Sonnenzeiten und Automatik", () => {
  it("berechnet Sonnenauf- und -untergang für Berlin plausibel (Sommer lang, Winter kurz)", () => {
    const summer = sunTimes(new Date(2026, 5, 21, 12), 52.52, 13.405); // 21. Juni
    const winter = sunTimes(new Date(2026, 11, 21, 12), 52.52, 13.405); // 21. Dezember
    const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;
    expect(hours(summer.sunrise, summer.sunset)).toBeGreaterThan(16); expect(hours(summer.sunrise, summer.sunset)).toBeLessThan(17.5);
    expect(hours(winter.sunrise, winter.sunset)).toBeGreaterThan(7); expect(hours(winter.sunrise, winter.sunset)).toBeLessThan(8.5);
    expect(summer.sunset.getUTCHours()).toBeGreaterThanOrEqual(19); // ca. 21:33 MESZ = 19:33 UTC
  });
  it("Automatik: hell am Mittag, dunkel um Mitternacht; feste Modi bleiben fest", () => {
    expect(resolveTheme("auto", new Date(2026, 6, 1, 12, 0))).toBe("light");
    expect(resolveTheme("auto", new Date(2026, 6, 1, 0, 30))).toBe("dark");
    expect(resolveTheme("light", new Date(2026, 6, 1, 0, 30))).toBe("light");
    expect(resolveTheme("dark", new Date(2026, 6, 1, 12, 0))).toBe("dark");
  });
});
