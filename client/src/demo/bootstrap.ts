/**
 * Laufzeit-Anpassungen für den Chat-Build. Muss vor allen anderen Modulen
 * ausgeführt werden (erster Import in main.demo.tsx):
 *  - Web Storage: fällt bei blockiertem Zugriff auf einen In-Memory-Speicher zurück
 *  - History-API: "/?page=…" wird auf den tatsächlichen Pfad der Seite abgebildet
 *  - Downloads: Blob-Links und jsPDF-Speichern laufen über die Download-Fähigkeit des Viewers
 */

type DownloadsApi = { save(input: { filename: string; data: string | Blob | ArrayBuffer }): Promise<unknown> };
type ClaudeRuntime = { use(name: string): Promise<unknown> };

declare global {
  interface Window {
    saveAs?: (blob: Blob, filename?: string) => void;
    __tanescoDemo?: { reset(): void; call?: (path: string, input: unknown) => Promise<unknown>; store?: () => unknown };
    /** Aktueller Query-String der Anwendung (ersetzt window.location.search im Chat-Build). */
    __demoSearch: () => string;
    /** Ersatz für window.location.assign: Seitenwechsel ohne Neuladen der Seite. */
    __demoAssign: (url: string) => void;
  }
}

/* ---------- Web Storage ---------- */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, String(value)); },
  } as Storage;
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  let usable = false;
  try { const probe = `__probe_${Date.now()}`; window[name].setItem(probe, "1"); window[name].removeItem(probe); usable = true; } catch { usable = false; }
  if (!usable) { try { Object.defineProperty(window, name, { value: memoryStorage(), configurable: true }); } catch { /* ignore */ } }
}

/* ---------- History & virtueller Query-String ---------- */
// Die Anwendung hält ihren Zustand in "/?page=…". Im Viewer darf der Pfad nicht
// verlassen werden und die History-API kann eingeschränkt sein; deshalb wird
// der Query-String zusätzlich lokal geführt und über window.__demoSearch()
// gelesen (Build-Zeit-Ersetzung von window.location.search).
const basePath = window.location.pathname;
let currentSearch = window.location.search;
// Parameter, die die Anwendung selbst verwaltet; alle anderen Parameter der
// Aufruf-URL (z. B. vom Viewer gesetzt) bleiben beim Umschreiben erhalten.
const appKeys = new Set(["page", "overview", "library", "builder", "categoryId", "category", "tab", "orderId", "leadId", "memberId", "claimId", "invoiceId", "view", "setting", "invite", "newRule", "newChain"]);
const foreignParams = Array.from(new URLSearchParams(window.location.search).entries()).filter(([key]) => !appKeys.has(key));
const composeSearch = (appSearch: string) => {
  const params = new URLSearchParams(appSearch);
  for (const [key, value] of foreignParams) if (!params.has(key)) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : "";
};
const rewriteUrl = (url: string | URL | null | undefined) => {
  if (typeof url !== "string") return url;
  if (url === "/") { currentSearch = composeSearch(""); return `${basePath}${currentSearch}`; }
  if (url.startsWith("/?")) { currentSearch = composeSearch(url.slice(2)); return `${basePath}${currentSearch}`; }
  return url;
};
for (const method of ["replaceState", "pushState"] as const) {
  const original = history[method].bind(history);
  history[method] = (state: unknown, unused: string, url?: string | URL | null) => {
    const next = rewriteUrl(url);
    try { original(state, unused, next as string | URL | null | undefined); } catch { /* Same-Origin-Beschränkung des Viewers – Zustand bleibt lokal erhalten */ }
  };
}
window.__demoSearch = () => currentSearch;
// Browser-Zurück im Chat-Build: die echte Adresse (falls der Viewer Verlaufseinträge erlaubt) in den Demo-Zustand übernehmen
window.addEventListener("popstate", () => { try { const real = new URLSearchParams(window.location.search); if (real.has("page")) currentSearch = composeSearch(real.toString()); } catch { /* Viewer ohne Verlauf */ } });
window.__demoAssign = (url: string) => {
  if (typeof url !== "string" || !(url === "/" || url.startsWith("/?"))) { console.warn("[Tanesco Leads] Navigation im Chat-Build nicht möglich:", url); return; }
  const params = new URLSearchParams(url === "/" ? "" : url.slice(2));
  const page = params.get("page") ?? "Dashboard"; params.delete("page");
  try { history.replaceState(null, "", url); } catch { /* Same-Origin-Beschränkung des Viewers */ }
  window.dispatchEvent(new CustomEvent("fluxora:navigate", { detail: { page, params: Object.fromEntries(params.entries()) } }));
};

/* Interne Links (/?page=…) im Chat-Build: kein Neuladen, sondern Seitenwechsel per Ereignis */
document.addEventListener("click", (event) => {
  const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
  const href = anchor.getAttribute("href") ?? "";
  if (href === "/" || href.startsWith("/?")) { event.preventDefault(); window.__demoAssign(href); }
});

/* ---------- Downloads ---------- */
const blobByUrl = new Map<string, Blob>();
const originalCreateObjectURL: (object: Blob | MediaSource) => string = typeof URL.createObjectURL === "function" ? URL.createObjectURL.bind(URL) : () => `blob:demo/${Math.random().toString(36).slice(2)}`;
URL.createObjectURL = (object: Blob | MediaSource) => { const url = originalCreateObjectURL(object); if (object instanceof Blob) blobByUrl.set(url, object); return url; };
if (typeof URL.revokeObjectURL !== "function") URL.revokeObjectURL = () => {};

let downloadsPromise: Promise<DownloadsApi | null> | null = null;
function downloadsApi() {
  if (!downloadsPromise) {
    const runtime = (window as unknown as { claude?: ClaudeRuntime }).claude;
    downloadsPromise = runtime ? runtime.use("downloads").then((api) => (api as DownloadsApi) ?? null).catch(() => null) : Promise.resolve(null);
  }
  return downloadsPromise;
}

async function saveThroughViewer(filename: string, data: Blob | string): Promise<boolean> {
  const api = await downloadsApi();
  if (!api) return false;
  try { await api.save({ filename, data }); return true; } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code !== "declined") console.warn("[Tanesco Leads] Download nicht möglich:", error);
    return true;
  }
}

const originalAnchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
  const href = this.getAttribute("href") ?? "";
  if (this.hasAttribute("download") && (href.startsWith("blob:") || href.startsWith("data:"))) {
    const filename = this.getAttribute("download") || "download";
    const blob = blobByUrl.get(href);
    if (blob) { void saveThroughViewer(filename, blob).then((handled) => { if (!handled) originalAnchorClick.call(this); }); return; }
    if (href.startsWith("data:")) { void fetch(href).then((response) => response.blob()).then((data) => saveThroughViewer(filename, data)).then((handled) => { if (!handled) originalAnchorClick.call(this); }); return; }
  }
  return originalAnchorClick.call(this);
};

const originalDispatchEvent = HTMLAnchorElement.prototype.dispatchEvent;
HTMLAnchorElement.prototype.dispatchEvent = function (this: HTMLAnchorElement, event: Event) {
  const href = this.getAttribute("href") ?? "";
  if (event.type === "click" && this.hasAttribute("download") && href.startsWith("blob:") && blobByUrl.has(href)) {
    void saveThroughViewer(this.getAttribute("download") || "download", blobByUrl.get(href)!).then((handled) => { if (!handled) originalDispatchEvent.call(this, event); });
    return true;
  }
  return originalDispatchEvent.call(this, event);
};

// jsPDF ruft window.saveAs auf, sobald die Funktion beim Laden vorhanden ist.
window.saveAs = (blob: Blob, filename?: string) => { void saveThroughViewer(filename || "dokument.pdf", blob).then((handled) => { if (!handled) { const anchor = document.createElement("a"); anchor.href = originalCreateObjectURL(blob); anchor.download = filename || "dokument.pdf"; originalAnchorClick.call(anchor); } }); };

export {};
