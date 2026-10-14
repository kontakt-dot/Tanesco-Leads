import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const root = import.meta.dirname;

// Original-Kopfmarke liegt nicht im Quellcode-Export (Manus-Storage). Eigene, schlichte Marke als Data-URI.

type Patch = { file: string; from: string; to: string };
const patches: Patch[] = [
  // Seitenwechsel per Custom-Event statt Vollnavigation (die Seite liegt nicht unter "/").
  { file: "components/FluxoraWorkspace.tsx", from: `const navigate = (next: Page, param?: string, value?: string | number) => {`, to: `const [navKey, setNavKey] = useState(0); useEffect(() => { const listener = (event: Event) => { const detail = (event as CustomEvent<{ page: Page; params?: Record<string, string> }>).detail; if (!detail?.page) return; const params = new URLSearchParams({ page: detail.page, ...(detail.params ?? {}) }); window.history.replaceState(null, "", \`/?\${params.toString()}\`); setPage(detail.page); setSidebarOpen(false); setNavKey((key) => key + 1); }; window.addEventListener("fluxora:navigate", listener); return () => window.removeEventListener("fluxora:navigate", listener); }, []);\n  const navigate = (next: Page, param?: string, value?: string | number) => {` },
  { file: "components/FluxoraWorkspace.tsx", from: `const renderPage = () => page === "Dashboard"`, to: `const renderPage = () => <Fragment key={navKey}>{renderPageInner()}</Fragment>; const renderPageInner = () => page === "Dashboard"` },
  { file: "components/OperationsWorkspace.tsx", from: `window.location.assign("/?page=Bestellungen")`, to: `window.dispatchEvent(new CustomEvent("fluxora:navigate", { detail: { page: "Bestellungen" } }))` },
  { file: "components/OrderOverview.tsx", from: `window.location.assign("/?page=Bestellungen&overview=1")`, to: `window.dispatchEvent(new CustomEvent("fluxora:navigate", { detail: { page: "Bestellungen", params: { overview: "1" } } }))` },
  // Stripe ist im Chat-Build nicht erreichbar: der Kauf wird sofort als Demo-Transaktion verbucht.
];

export function demoPatches(): Plugin {
  const applied = new Set<string>();
  return {
    name: "tanesco-demo-patches",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.split("?")[0].replaceAll("\\", "/");
      let next = code;
      for (const patch of patches) {
        if (!normalized.endsWith(`/client/src/${patch.file}`)) continue;
        if (!next.includes(patch.from)) throw new Error(`Patch nicht anwendbar (${patch.file}): ${patch.from.slice(0, 60)}…`);
        next = next.replace(patch.from, patch.to);
        applied.add(`${patch.file}:${patch.from.slice(0, 40)}`);
      }
      // Der Query-String wird im Chat-Build lokal geführt (siehe demo/bootstrap.ts), da die
      // History-API im Viewer eingeschränkt sein kann; Vollnavigationen werden zu Seitenwechseln.
      if (/\/client\/src\/(?!demo\/)/.test(normalized) && /\.(tsx?|jsx?)$/.test(normalized)) {
        next = next.replaceAll("window.location.search", "window.__demoSearch()").replaceAll("window.location.assign(", "window.__demoAssign(");
      }
      if (normalized.endsWith("/client/src/components/FluxoraWorkspace.tsx") && !/import \{[^}]*\bFragment\b[^}]*\} from "react"/.test(next)) {
        next = next.replace(/import \{([^}]*)\} from "react";/, (_match, names: string) => `import {${names}, Fragment } from "react";`);
        if (!next.includes("Fragment")) throw new Error("React-Import in FluxoraWorkspace.tsx nicht gefunden.");
      }
      return next === code ? null : { code: next, map: null };
    },
    buildEnd() {
      if (applied.size !== patches.length) throw new Error(`Nur ${applied.size} von ${patches.length} Demo-Patches angewendet.`);
    },
  };
}

export default defineConfig({
  plugins: [demoPatches(), react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(root, "client", "src"), "@shared": path.resolve(root, "shared"), "@assets": path.resolve(root, "attached_assets") } },
  define: { "import.meta.env.VITE_FRONTEND_FORGE_API_KEY": JSON.stringify(""), "import.meta.env.VITE_FRONTEND_FORGE_API_URL": JSON.stringify("") },
  root: path.resolve(root, "client"),
  publicDir: false,
  build: {
    outDir: path.resolve(root, "dist/demo"),
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(root, "client", "demo.html"), output: { inlineDynamicImports: true } },
    chunkSizeWarningLimit: 8000,
    sourcemap: false,
    minify: true,
  },
});
