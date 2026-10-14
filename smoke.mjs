import { JSDOM, VirtualConsole } from "jsdom";
import fs from "node:fs";
let html = fs.readFileSync("/mnt/user-data/outputs/tanesco-leads.html", "utf8");
html = html.replace('<script type="module">', '<script>');
const virtualConsole = new VirtualConsole();
const errors = [];
virtualConsole.on("jsdomError", (e) => errors.push(String(e.message || e)));
virtualConsole.on("error", (...a) => errors.push(a.map(String).join(" ")));
virtualConsole.on("warn", () => {});
virtualConsole.on("log", () => {});
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.test/artifact/abc?page=Dashboard", virtualConsole, beforeParse(window) {
  window.matchMedia = (q) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.structuredClone = structuredClone;
  window.HTMLElement.prototype.scrollIntoView = () => {};
} });
const { window } = dom;
for (const page of ["Dashboard", "Leads", "Vertriebspipeline", "Gespräche", "Einstellungen"]) {
  window.dispatchEvent(new window.CustomEvent("fluxora:navigate", { detail: { page } }));
  await new Promise((r) => setTimeout(r, 1500));
  const text = window.document.body.textContent || "";
  console.log(page, "→", text.length, "Zeichen;", "Fehlerseite:", text.includes("An unexpected error occurred"), "| Beispiel:", text.slice(0, 160).replace(/\s+/g, " "));
}
console.log("localStorage keys:", Object.keys(window.localStorage));
console.log("URL:", window.location.href);
console.log("errors:", errors.length, errors.slice(0, 5));
window.close();