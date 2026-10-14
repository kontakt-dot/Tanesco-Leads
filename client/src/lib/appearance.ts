/**
 * Darstellung: Hell/Dunkel manuell, automatisch nach Sonnenauf-/untergang (wie bei Apple) oder wie das System;
 * dazu die Wahl, ob das Menü im hellen Modus weiß oder dunkel ist. Alles bleibt im Browser gespeichert.
 */
export type ThemeMode = "light" | "dark" | "auto" | "system";
export const THEME_MODES: Array<{ key: ThemeMode; label: string; note: string }> = [
  { key: "light", label: "Hell", note: "Immer der helle Modus" },
  { key: "dark", label: "Dunkel", note: "Immer der dunkle Modus" },
  { key: "auto", label: "Automatisch", note: "Hell am Tag, dunkel nach Sonnenuntergang" },
  { key: "system", label: "Wie System", note: "Folgt der Einstellung deines Geräts" },
];
const MODE_KEY = "tanesco.theme-mode"; const LOCATION_KEY = "tanesco.location";
const safeGet = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };
const safeSet = (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* privater Modus */ } };

export function readThemeMode(): ThemeMode { const stored = safeGet(MODE_KEY); if (stored === "light" || stored === "dark" || stored === "auto" || stored === "system") return stored; const legacy = safeGet("theme"); return legacy === "light" ? "light" : "dark"; }
export function writeThemeMode(mode: ThemeMode) { safeSet(MODE_KEY, mode); }

/** Sonnenauf- und -untergang (NOAA-Näherung, auf wenige Minuten genau) in lokaler Zeit. */
export function sunTimes(date: Date, latitude: number, longitude: number): { sunrise: Date; sunset: Date } {
  const rad = Math.PI / 180; const dayOfYear = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86_400_000);
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (12 - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const cosHa = (Math.cos(90.833 * rad) / (Math.cos(latitude * rad) * Math.cos(decl))) - Math.tan(latitude * rad) * Math.tan(decl);
  const ha = Math.acos(Math.min(1, Math.max(-1, cosHa))) / rad; // Polartag/-nacht abgefangen
  const sunriseUtcMinutes = 720 - 4 * (longitude + ha) - eqTime; const sunsetUtcMinutes = 720 - 4 * (longitude - ha) - eqTime;
  const base = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return { sunrise: new Date(base + sunriseUtcMinutes * 60_000), sunset: new Date(base + sunsetUtcMinutes * 60_000) };
}

/** Standort für die Sonnenzeiten: einmal erlaubt → gemerkt; sonst Deutschland-Mitte. */
export function readLocation(): { latitude: number; longitude: number } { try { const stored = safeGet(LOCATION_KEY); if (stored) { const parsed = JSON.parse(stored) as { latitude: number; longitude: number }; if (Number.isFinite(parsed.latitude) && Number.isFinite(parsed.longitude)) return parsed; } } catch { /* ignorieren */ } return { latitude: 51.16, longitude: 10.45 }; }
export function requestLocation(onUpdate: (location: { latitude: number; longitude: number }) => void) {
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((position) => { const location = { latitude: Math.round(position.coords.latitude * 100) / 100, longitude: Math.round(position.coords.longitude * 100) / 100 }; safeSet(LOCATION_KEY, JSON.stringify(location)); onUpdate(location); }, () => { /* abgelehnt → Standardstandort */ }, { maximumAge: 6 * 3_600_000, timeout: 8_000 });
}

/** Ergibt den tatsächlich anzuwendenden Modus. */
export function resolveTheme(mode: ThemeMode, now = new Date()): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  if (mode === "system") return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const { latitude, longitude } = readLocation(); const { sunrise, sunset } = sunTimes(now, latitude, longitude);
  return now >= sunrise && now < sunset ? "light" : "dark";
}

/** Nächster Wechselzeitpunkt (für die Anzeige „dunkel ab 19:12“). */
export function nextSwitch(now = new Date()): { at: Date; to: "light" | "dark" } {
  const { latitude, longitude } = readLocation(); const today = sunTimes(now, latitude, longitude);
  if (now < today.sunrise) return { at: today.sunrise, to: "light" };
  if (now < today.sunset) return { at: today.sunset, to: "dark" };
  const tomorrow = new Date(now.getTime() + 86_400_000); return { at: sunTimes(tomorrow, latitude, longitude).sunrise, to: "light" };
}
