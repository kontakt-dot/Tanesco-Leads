import { useEffect } from "react";
import { startEyebrowIcons } from "@/lib/eyebrowIcons";

/** Untere Tab-Leiste (nur auf dem Handy sichtbar): die wichtigsten Bereiche wie in einer App, „Mehr“ öffnet das Menü. */
export function MobileTabBar<T extends string>({ items, active, onSelect, onMenu, menuLabel = "Mehr" }: { items: Array<{ page: T; label: string; icon: React.ComponentType<{ className?: string }> }>; active: T; onSelect: (page: T) => void; onMenu: () => void; menuLabel?: string }) {
  return <nav className="mobile-tabbar" aria-label="Schnellnavigation">
    {items.map((item) => <button key={item.page} type="button" className={active === item.page ? "active" : ""} onClick={() => onSelect(item.page)} aria-current={active === item.page ? "page" : undefined}><item.icon className="h-5 w-5" /><span>{item.label}</span></button>)}
    <button type="button" onClick={onMenu} aria-label="Menü öffnen"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg><span>{menuLabel}</span></button>
  </nav>;
}

const MOBILE_QUERY = "(max-width: 760px)";
export const isMobileViewport = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(MOBILE_QUERY).matches;

/**
 * Tabellen auf dem Handy als gestapelte Karten: Jede Zelle bekommt die Spaltenüberschrift als Beschriftung (data-label),
 * das CSS (`table.stack-mobile`) zeigt Zeile für Zeile als Karte. Läuft über einen Beobachter, damit auch später
 * gerenderte Tabellen erfasst werden. Die Lead-Tabelle hat ihr eigenes Kartenlayout und wird ausgelassen.
 */
export function useMobileTables(rootSelector = ".content-area") {
  useEffect(() => {
    if (typeof window === "undefined" || typeof MutationObserver === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(MOBILE_QUERY);
    const apply = () => {
      const root = document.querySelector(rootSelector); if (!root) return;
      root.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
        if (table.closest(".live-leads-workspace") || table.classList.contains("no-stack")) return;
        const labels = Array.from(table.tHead?.rows[0]?.cells ?? []).map((cell) => cell.textContent?.trim() ?? "");
        if (!media.matches || labels.filter(Boolean).length < 2) { table.classList.remove("stack-mobile"); return; }
        table.classList.add("stack-mobile");
        Array.from(table.tBodies).forEach((body) => Array.from(body.rows).forEach((row) => Array.from(row.cells).forEach((cell, index) => { const label = labels[index] ?? ""; if (cell.dataset.label !== label) cell.dataset.label = label; })));
      });
    };
    let timer = 0; const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { try { apply(); } catch { /* Dokument bereits geschlossen */ } }, 40); };
    const observer = new MutationObserver(schedule); observer.observe(document.body, { childList: true, subtree: true });
    media.addEventListener("change", schedule); schedule();
    return () => { observer.disconnect(); media.removeEventListener("change", schedule); window.clearTimeout(timer); };
  }, [rootSelector]);
}

/** Überschriften-Symbole plattformweit (siehe lib/eyebrowIcons). */
export function useEyebrowIcons() { useEffect(() => startEyebrowIcons(), []); }
