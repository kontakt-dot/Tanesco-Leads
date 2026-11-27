import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHOOSABLE_AREAS, CUSTOMER_AREAS } from "../shared/customer-areas";
import { BUYER_AREAS } from "./member-admin";
import { CUSTOMER_PAGES, visibleCustomerPages } from "./customer-area";
import { STATUS_STYLE } from "../client/src/lib/colors";

/**
 * Version 388 – Benutzer → Ansicht zeigt nur Bereiche, die es im Kundenbereich gibt; sichtbare Kategorien wirken; „Freigegeben“ in eigener
 * Farbe; Knöpfe der Leads rechts; in der Leiste der Leads die Lead-Kategorie statt „Neueste zuerst“.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Sichtbare Bereiche: genau die Seiten des Kundenbereichs", () => {
  it("die Liste deckt sich mit den Seiten, die ein Kunde wirklich sieht – nichts aus der alten Vorlage", () => {
    expect(CUSTOMER_AREAS.map((area) => area.key)).toEqual([...CUSTOMER_PAGES]);
    expect(CHOOSABLE_AREAS).toEqual(["Bestellungen", "Reklamationen", "Lead-Import", "Integrationen", "Support"]);
    expect(BUYER_AREAS).toEqual(CHOOSABLE_AREAS);
    for (const old of ["Angebote", "Shop", "Marktplatz", "Guthaben", "Pipeline", "Käufe", "E-Mails", "Team", "App-Download-Logos"]) expect(CUSTOMER_AREAS.map((area) => area.key)).not.toContain(old);
    expect(CUSTOMER_AREAS.filter((area) => area.always).map((area) => area.key)).toEqual(["Dashboard", "Leads", "Einstellungen"]);
  });
  it("was man abhakt, steht wirklich in der Seitenleiste des Kunden – Dashboard, Leads und Einstellungen immer, Lead-Import nur bei Lieferanten", () => {
    expect(visibleCustomerPages(null, "käufer")).toEqual(["Dashboard", "Leads", "Bestellungen", "Reklamationen", "Integrationen", "Support", "Einstellungen"]);
    expect(visibleCustomerPages(["Support"], "käufer")).toEqual(["Dashboard", "Leads", "Support", "Einstellungen"]);
    expect(visibleCustomerPages([], "lieferant")).toEqual(["Dashboard", "Leads", "Einstellungen"]);
    expect(visibleCustomerPages(["Lead-Import"], "lieferant")).toEqual(["Dashboard", "Leads", "Lead-Import", "Einstellungen"]);
    // alte Auswahl mit Namen aus der Vorlage: nur die echten Namen zählen
    expect(visibleCustomerPages(["Angebote", "Shop", "Reklamationen"], "käufer")).toEqual(["Dashboard", "Leads", "Reklamationen", "Einstellungen"]);
  });
  it("Reiter „Ansicht“: Liste aus shared/customer-areas, „immer sichtbar“ gesperrt, Lead-Import nur bei Lieferanten; sichtbare Kategorien wirken auf „Integrationen“", () => {
    const detail = read("../client/src/components/MemberDetail.tsx");
    expect(detail).toContain('const shown = CUSTOMER_AREAS.filter((area) => !area.onlySupplier || supplier);');
    expect(detail).toContain('<input type="checkbox" checked={on} disabled={area.always}');
    expect(detail).toContain("Dashboard, Leads und Einstellungen sieht er immer");
    expect(detail).not.toContain("Voreinstellung des Tenants");
    expect(read("./customer-area.ts")).toContain("rows.filter((row) => !shown || shown.has(row.categoryId))");
  });
});

describe("Leads: Farbe, Knöpfe, Leiste", () => {
  it("„Freigegeben“ hat eine eigene Farbe – deutlich anders als „Zugewiesen“ (v388 Magenta, seit v389 Türkisblau – siehe v389-design.test.ts)", () => {
    expect(STATUS_STYLE.genehmigt.color).not.toBe("#0d9488"); expect(STATUS_STYLE.zugewiesen.color).toBe("#16a34a");
    const lab = (hex: string) => { const lin = [1, 3, 5].map((index) => { const value = parseInt(hex.slice(index, index + 2), 16) / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }); const [r, g, b] = lin;
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]; };
    const distance = (a: string, b: string) => 100 * Math.hypot(...lab(a).map((value, index) => value - lab(b)[index]));
    expect(distance(STATUS_STYLE.genehmigt.color, STATUS_STYLE.zugewiesen.color)).toBeGreaterThan(15); // altes Türkis: 11
    for (const [key, style] of Object.entries(STATUS_STYLE)) if (key !== "genehmigt") expect(distance(STATUS_STYLE.genehmigt.color, style.color), key).toBeGreaterThan(12);
  });
  it("Knöpfe im Kopf rechtsbündig; in der Leiste die Lead-Kategorie, die Sortierung steht unter „Filter“", () => {
    const css = read("../client/src/bausteine.css"); const leads = read("../client/src/components/LiveLeads.tsx");
    expect(css).toContain("@media (min-width:761px){.live-leads-workspace>.page-intro.compact>.lead-header-actions{justify-content:flex-end;margin-left:auto}}");
    expect(leads).toContain('<select aria-label="Lead-Kategorie wählen" className="filter-select lt-control lt-category-pick" value={filters.categoryId}');
    expect(leads).toContain('<option value="">Alle Lead-Kategorien</option>');
    expect(leads).toContain('<label className="lt-field"><span>Sortierung</span><select aria-label="Leadliste sortieren" className="lt-field-control"');
    expect(leads).not.toContain('className="filter-select lt-control" value={sortMode}');
  });
});
