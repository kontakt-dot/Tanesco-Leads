export type NavigationPreferences = { hiddenPages: string[]; sidebarCollapsed: boolean };

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const navigationPreferencesKey = "fluxora.navigation-preferences.v1";

export function readNavigationPreferences(storage: StorageLike | null | undefined, allowedPages: readonly string[]): NavigationPreferences {
  if (!storage) return { hiddenPages: [], sidebarCollapsed: false };
  try {
    const parsed = JSON.parse(storage.getItem(navigationPreferencesKey) ?? "{}") as Partial<NavigationPreferences>;
    const hiddenPages = Array.isArray(parsed.hiddenPages) ? parsed.hiddenPages.filter((page): page is string => typeof page === "string" && allowedPages.includes(page)) : [];
    return { hiddenPages: Array.from(new Set(hiddenPages)), sidebarCollapsed: parsed.sidebarCollapsed === true };
  } catch {
    return { hiddenPages: [], sidebarCollapsed: false };
  }
}

export function writeNavigationPreferences(storage: StorageLike | null | undefined, preferences: NavigationPreferences) {
  storage?.setItem(navigationPreferencesKey, JSON.stringify(preferences));
}
