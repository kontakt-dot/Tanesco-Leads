export type NavigationPreferences = { hiddenPages: string[]; sidebarCollapsed: boolean; laptopChecked?: boolean };

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const navigationPreferencesKey = "fluxora.navigation-preferences.v1";
/** Bis zu dieser Fensterbreite (14-Zoll-Laptops) wird die Seitenleiste beim ersten Besuch eingeklappt – mehr Platz für Board und Tabellen. */
export const LAPTOP_MAX_WIDTH = 1480;
const PHONE_MAX_WIDTH = 760;

export function readNavigationPreferences(storage: StorageLike | null | undefined, allowedPages: readonly string[]): NavigationPreferences {
  if (!storage) return { hiddenPages: [], sidebarCollapsed: false, laptopChecked: false };
  try {
    const parsed = JSON.parse(storage.getItem(navigationPreferencesKey) ?? "{}") as Partial<NavigationPreferences>;
    const hiddenPages = Array.isArray(parsed.hiddenPages) ? parsed.hiddenPages.filter((page): page is string => typeof page === "string" && allowedPages.includes(page)) : [];
    return { hiddenPages: Array.from(new Set(hiddenPages)), sidebarCollapsed: parsed.sidebarCollapsed === true, laptopChecked: parsed.laptopChecked === true };
  } catch {
    return { hiddenPages: [], sidebarCollapsed: false, laptopChecked: false };
  }
}

export function writeNavigationPreferences(storage: StorageLike | null | undefined, preferences: NavigationPreferences) {
  storage?.setItem(navigationPreferencesKey, JSON.stringify(preferences));
}

/**
 * Einmal pro Browser: Auf einem Laptop-Bildschirm (bis 1480 px, kein Handy) startet die Seitenleiste eingeklappt.
 * Danach gilt, was die Nutzerin selbst wählt – `laptopChecked` wird beim ersten Speichern gesetzt.
 */
export function shouldAutoCollapseSidebar(preferences: NavigationPreferences, windowWidth: number): boolean {
  return !preferences.laptopChecked && !preferences.sidebarCollapsed && windowWidth > PHONE_MAX_WIDTH && windowWidth <= LAPTOP_MAX_WIDTH;
}
