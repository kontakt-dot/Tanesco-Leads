import { describe, expect, it } from "vitest";
import { navigationPreferencesKey, readNavigationPreferences, writeNavigationPreferences } from "../client/src/lib/navigationPreferences";

describe("Navigationseinstellungen", () => {
  it("speichert Seitenleistenstatus und gültige ausgeblendete Punkte dauerhaft", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    writeNavigationPreferences(storage, { hiddenPages: ["Statistik", "Leads"], sidebarCollapsed: true });
    expect(JSON.parse(values.get(navigationPreferencesKey) ?? "{}")).toEqual({ hiddenPages: ["Statistik", "Leads"], sidebarCollapsed: true });
    expect(readNavigationPreferences(storage, ["Dashboard", "Statistik", "Leads"])).toEqual({ hiddenPages: ["Statistik", "Leads"], sidebarCollapsed: true });
  });

  it("ignoriert ungültige Seiten aus älteren oder fremden Browserzuständen", () => {
    const storage = { getItem: () => JSON.stringify({ hiddenPages: ["Statistik", "Unbekannt"], sidebarCollapsed: false }), setItem: () => undefined };
    expect(readNavigationPreferences(storage, ["Dashboard", "Statistik"]).hiddenPages).toEqual(["Statistik"]);
  });
});
