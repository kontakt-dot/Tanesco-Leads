import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { applyAccent } from "@/lib/accent";
import { readThemeMode, requestLocation, resolveTheme, writeThemeMode, type ThemeMode } from "@/lib/appearance";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  mode: ThemeMode;
  toggleTheme?: () => void;
  setMode: (mode: ThemeMode) => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps { children: React.ReactNode; defaultTheme?: Theme; switchable?: boolean }

export function ThemeProvider({ children, defaultTheme = "light", switchable = false }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(() => (switchable ? readThemeMode() : defaultTheme));
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(switchable ? readThemeMode() : defaultTheme));
  const [, setLocationTick] = useState(0);

  useEffect(() => { applyAccent("tanesco"); }, []); // Hellmodus folgt fest dem Website-Design-System (Rot)

  // Automatik: jede Minute prüfen (Sonnenauf-/untergang) bzw. auf Systemwechsel hören
  useEffect(() => {
    setTheme(resolveTheme(mode));
    if (mode === "auto") { requestLocation(() => { setLocationTick((value) => value + 1); setTheme(resolveTheme("auto")); }); const timer = window.setInterval(() => setTheme(resolveTheme("auto")), 60_000); return () => window.clearInterval(timer); }
    if (mode === "system" && typeof window.matchMedia === "function") { const media = window.matchMedia("(prefers-color-scheme: dark)"); const onChange = () => setTheme(resolveTheme("system")); media.addEventListener("change", onChange); window.addEventListener("focus", onChange); document.addEventListener("visibilitychange", onChange); const timer = window.setInterval(onChange, 30_000); return () => { media.removeEventListener("change", onChange); window.removeEventListener("focus", onChange); document.removeEventListener("visibilitychange", onChange); window.clearInterval(timer); }; }
    return undefined;
  }, [mode]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark"); else root.classList.remove("dark");
    if (switchable) localStorage.setItem("theme", theme);
  }, [theme, switchable]);

  useEffect(() => { delete document.documentElement.dataset.sidebar; }, []);

  const setMode = useCallback((next: ThemeMode) => { setModeState(next); if (switchable) writeThemeMode(next); }, [switchable]);
  const toggleTheme = switchable ? () => setMode(theme === "light" ? "dark" : "light") : undefined;

  return <ThemeContext.Provider value={{ theme, mode, toggleTheme, setMode, switchable }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
