import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { routeShort } from "../shared/order-route";

/**
 * Version 387 – Auslieferung: Bestellungen untereinander (Liste) oder als Kacheln wie bei den Benutzern.
 * Hier: Aufbau im Quelltext und die Regeln des Stil-Blocks. Den Ablauf in der Oberfläche prüft client/src/demo/__tests__/v387.test.tsx.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Bestellübersicht: Liste oder Kacheln", () => {
  const source = read("../client/src/components/OrderOverview.tsx");
  it("Umschalter über den Bestellungen – die Wahl wird je Browser gemerkt, die Adresse kann sie vorgeben", () => {
    expect(source).toContain('aria-label="Ansicht der Bestellungen"');
    expect(source).toContain('<Rows3 aria-hidden="true" />Liste'); expect(source).toContain('<LayoutGrid aria-hidden="true" />Kacheln');
    expect(source).toContain('const VIEW_KEY = "tanesco-order-view"'); expect(source).toContain('get("ansicht")');
    expect(source).toMatch(/try \{ window\.localStorage\.setItem\(VIEW_KEY, next\); \} catch/); // privater Modus: kein Fehler
  });
  it("die Kachel zeigt dasselbe wie die Zeile: Käufer, Lieferant, Kategorien, Lieferstand, Preis, Wert, Lieferkette, Status und Aktionen", () => {
    for (const part of ['className={`order-card is-${statusChoice}`}', 'className="order-card-mono"', 'className="order-card-tags"', '<dt>Preis</dt>', '<dt>Wert</dt>', '<dt>Lieferkette</dt>', 'className="order-card-foot">{statusSelect}', 'href={orderChainLink(order.id)}']) expect(source, part).toContain(part);
    // Status und Löschen gibt es nur einmal – Liste und Kacheln nutzen dieselben
    expect(source.match(/wirklich löschen\?/g)).toHaveLength(1); expect(source.match(/<select aria-label=\{`Status für/g)).toHaveLength(1);
  });
  it("die Lieferkette kurz: Namen der eingeschalteten Stationen, bei mehreren Wegen deren Zahl", () => {
    expect(routeShort([]).text).toBe("noch keine");
    const stop = (position: number, buyerName: string, active = true) => ({ position, buyerName, unitPrice: 10, active, orderStop: position === 1, maxLeads: null });
    const route = { chainIds: [1], categoryIds: [1], active: true, stops: [stop(1, "Beispiel GmbH"), stop(2, "Muster AG", false), stop(3, "Probe KG")], end: "free" } as unknown as Parameters<typeof routeShort>[0][number];
    expect(routeShort([route]).text).toBe("Beispiel GmbH → Probe KG");
    expect(routeShort([route, { ...route, chainIds: [2] }]).text).toBe("2 Wege – je nach Sparte");
  });
});

describe("Stil-Block „Version 387“", () => {
  const all = read("../client/src/bausteine.css");
  const start = all.lastIndexOf("/*", all.indexOf("Version 387")); const block = all.slice(start).replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = Array.from(block.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((match) => ({ selector: match[1].replace(/\s+/g, " ").trim(), body: match[2].replace(/\s+/g, "") })).filter((rule) => !rule.selector.startsWith("@"));
  const body = (selector: string) => rules.filter((rule) => rule.selector.split(",").map((part) => part.trim()).includes(selector)).map((rule) => rule.body).join(";");
  it("Kacheln wie bei den Benutzern: Raster, runde Karte mit Schatten, Kürzel im Verlauf, Schalen für Lieferstand und Zahlen", () => {
    expect(body(".order-cards")).toContain("grid-template-columns:repeat(auto-fill,minmax(320px,1fr))");
    expect(body(".order-card")).toContain("border-radius:20px"); expect(body(".order-card")).toContain("box-shadow:var(--ov-card-shadow)");
    expect(body(".order-card-mono")).toContain("background:var(--ov-mono)");
    expect(body(".order-card-facts")).toContain("background:var(--ov-tray)"); expect(body(".order-card-progress")).toContain("background:var(--ov-tray)");
    expect(body(".order-card.is-aktiv::before")).toBe("background:var(--ov-good)"); expect(body(".order-card.is-pausiert::before")).toBe("background:var(--ov-warn)");
    expect(body(".order-view button.is-on")).toContain("background:var(--ov-on)");
  });
  it("Markenrot nur im hellen Design, Lila nur im dunklen – der Rest nutzt die Farbwerte der Bestellübersicht", () => {
    const light = (rule: { selector: string }) => rule.selector.split(",").every((part) => part.trim().startsWith("html:not(.dark)")); const dark = (rule: { selector: string }) => rule.selector.split(",").every((part) => part.trim().startsWith("html.dark"));
    expect(rules.filter((rule) => /#bc001d|#fb2c36|#fff1f2|#fff5f5|#fff8f8|#fde8ea|#d92d20|rgba\(188,0,29|rgba\(220,38,38/i.test(rule.body) && !light(rule)).map((rule) => rule.selector)).toEqual([]);
    expect(rules.filter((rule) => /#8278ff|#6258df|#7a70f5|#a39bff|rgba\(98,88,223/i.test(rule.body) && !dark(rule)).map((rule) => rule.selector)).toEqual([]);
  });
  it("auf dem Handy eine Kachel je Zeile; ohne Bewegung, wenn das Gerät es so will", () => {
    expect(block).toContain("@media (max-width:720px){.order-toolbar{padding:12px 16px 4px}.order-cards{grid-template-columns:minmax(0,1fr)");
    expect(block).toContain("@media (prefers-reduced-motion:reduce){.order-card,.order-view button{transition:none}.order-card:hover{transform:none}}");
  });
});
