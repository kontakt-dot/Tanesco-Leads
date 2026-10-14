/** Farbwelten für den hellen Modus: zwei Verlaufsfarben (RGB-Tripel) für Schleier, Kacheln, Balken und Auswahl. */
export type AccentKey = "tanesco" | "aurora" | "ozean" | "smaragd" | "sonne" | "rose" | "graphit";
export const ACCENTS: Array<{ key: AccentKey; label: string; note: string; a: string; b: string }> = [
  { key: "tanesco", label: "Tanesco", note: "Website-Rot, wie tanescodigital.de", a: "188,0,29", b: "251,44,54" },
  { key: "aurora", label: "Aurora", note: "Violett → Cyan, wie der Dunkelmodus", a: "124,114,255", b: "69,212,223" },
  { key: "ozean", label: "Ozean", note: "Blau → Türkis, ruhig und seriös", a: "37,99,235", b: "6,182,212" },
  { key: "smaragd", label: "Smaragd", note: "Grün → Türkis, frisch und positiv", a: "16,163,127", b: "34,197,194" },
  { key: "sonne", label: "Sonne", note: "Koralle → Gold, warm und freundlich", a: "244,84,64", b: "245,166,35" },
  { key: "rose", label: "Rosé", note: "Pink → Violett, modern und weich", a: "236,72,153", b: "139,92,246" },
  { key: "graphit", label: "Graphit", note: "Anthrazit → Grau, sehr zurückhaltend", a: "31,41,55", b: "107,114,128" },
];
const STORAGE_KEY = "tanesco.accent";
export function readAccent(): AccentKey { try { const stored = window.localStorage.getItem(STORAGE_KEY) as AccentKey | null; return stored && ACCENTS.some((item) => item.key === stored) ? stored : "tanesco"; } catch { return "tanesco"; } }
export function applyAccent(key: AccentKey) { const accent = ACCENTS.find((item) => item.key === key) ?? ACCENTS[0]; const root = document.documentElement; root.dataset.accent = accent.key; root.style.setProperty("--acc1", accent.a); root.style.setProperty("--acc2", accent.b); try { window.localStorage.setItem(STORAGE_KEY, accent.key); } catch { /* privater Modus */ } }
