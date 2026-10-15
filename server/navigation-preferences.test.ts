import { describe, expect, it } from "vitest";
import { navigationPreferencesKey, readNavigationPreferences, shouldAutoCollapseSidebar, writeNavigationPreferences } from "../client/src/lib/navigationPreferences";

describe("Navigationseinstellungen", () => {
  it("speichert Seitenleistenstatus und gültige ausgeblendete Punkte dauerhaft", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    writeNavigationPreferences(storage, { hiddenPages: ["Statistik", "Leads"], sidebarCollapsed: true });
    expect(JSON.parse(values.get(navigationPreferencesKey) ?? "{}")).toEqual({ hiddenPages: ["Statistik", "Leads"], sidebarCollapsed: true });
    expect(readNavigationPreferences(storage, ["Dashboard", "Statistik", "Leads"])).toEqual({ hiddenPages: ["Statistik", "Leads"], sidebarCollapsed: true, laptopChecked: false });
  });

  it("ignoriert ungültige Seiten aus älteren oder fremden Browserzuständen", () => {
    const storage = { getItem: () => JSON.stringify({ hiddenPages: ["Statistik", "Unbekannt"], sidebarCollapsed: false }), setItem: () => undefined };
    expect(readNavigationPreferences(storage, ["Dashboard", "Statistik"]).hiddenPages).toEqual(["Statistik"]);
  });
});

describe("Seitenleiste auf Laptops", () => {
  const fresh = { hiddenPages: [], sidebarCollapsed: false, laptopChecked: false };
  it("klappt beim ersten Besuch auf 14-Zoll-Breiten ein, nicht am großen Bildschirm und nicht am Handy", () => {
    expect(shouldAutoCollapseSidebar(fresh, 1366)).toBe(true);
    expect(shouldAutoCollapseSidebar(fresh, 1440)).toBe(true);
    expect(shouldAutoCollapseSidebar(fresh, 1920)).toBe(false);
    expect(shouldAutoCollapseSidebar(fresh, 390)).toBe(false);
  });
  it("respektiert danach die eigene Wahl – nach dem ersten Speichern nie wieder automatisch", () => {
    expect(shouldAutoCollapseSidebar({ ...fresh, laptopChecked: true }, 1366)).toBe(false);
    expect(shouldAutoCollapseSidebar({ ...fresh, sidebarCollapsed: true }, 1366)).toBe(false);
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    writeNavigationPreferences(storage, { hiddenPages: [], sidebarCollapsed: false, laptopChecked: true });
    expect(readNavigationPreferences(storage, []).laptopChecked).toBe(true);
    expect(readNavigationPreferences({ getItem: () => JSON.stringify({ hiddenPages: [], sidebarCollapsed: false }), setItem: () => undefined }, []).laptopChecked).toBe(false);
  });
});
