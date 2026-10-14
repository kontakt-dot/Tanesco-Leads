import { vi } from "vitest";
import "../bootstrap";
// jsdom-Lücken schließen
if (!window.matchMedia) window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as any;
if (!(globalThis as any).ResizeObserver) (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!(globalThis as any).IntersectionObserver) (globalThis as any).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ""; thresholds = []; };
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});
Element.prototype.setPointerCapture = Element.prototype.setPointerCapture ?? (() => {});
window.scrollTo = window.scrollTo ?? (() => {});
(window as any).confirm = () => true;
vi.stubGlobal("structuredClone", globalThis.structuredClone);
