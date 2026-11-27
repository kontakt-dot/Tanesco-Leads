import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { categoryColor, CATEGORY_PALETTE } from "../client/src/lib/colors";
import { sameSparteName, sparteColor } from "../client/src/lib/sparteColor";

/**
 * Version 381 – Vertriebspipeline und E-Mail-Kampagnen im Stil der neu gestalteten Seiten.
 * Hier: die Farbe für das Schild der Leadsparte (dieselbe wie die Lead-Kategorie überall) und die Regeln des neuen Stil-Blocks.
 */
describe("Schild der Leadsparte: Farbe der Lead-Kategorie", () => {
  const categories = [
    { id: 1, name: "Photovoltaik", color: "#d97706" },
    { id: 2, name: "Wärmepumpe", color: "#ea580c" },
    { id: 3, name: "Photovoltaik & Wärmepumpe", color: "#b45309" },
    { id: 4, name: "Alarmanlagen", color: null },
    { id: 5, name: "Fenster" },
  ];
  const pick = (...ids: number[]) => ids.map((id) => categories.find((row) => row.id === id)!);

  it("genau eine gewählte Kategorie: ihre gespeicherte Farbe – ohne gespeicherte Farbe die feste Farbe aus ihrer Nummer", () => {
    expect(sparteColor({ label: "Photovoltaik", source: "eingetragen" }, pick(1), categories)).toBe("#d97706");
    expect(sparteColor({ label: "Alarmanlage", source: "eingetragen" }, pick(4), categories)).toBe(CATEGORY_PALETTE[4 % CATEGORY_PALETTE.length]);
    expect(sparteColor({ label: "Irgendwas", source: "eingetragen" }, pick(5), categories)).toBe(categoryColor({ id: 5 }));
  });
  it("mehrere gewählt: die Kategorie, die so heißt wie die Sparte – sonst die erste gewählte", () => {
    expect(sparteColor({ label: "Photovoltaik & Wärmepumpe", source: "eingetragen" }, pick(1, 2), categories)).toBe("#b45309");
    expect(sparteColor({ label: "Photovoltaik und Fenster", source: "eingetragen" }, pick(1, 5), categories)).toBe("#d97706");
  });
  it("nichts gewählt, aber aus dem Namen erkannt: die Kategorie mit demselben Namen (Einzahl und Mehrzahl zählen gleich)", () => {
    expect(sparteColor({ label: "Alarmanlage", source: "erkannt" }, [], categories)).toBe(categoryColor({ id: 4, color: null }));
    expect(sparteColor({ label: "Wärmepumpe", source: "erkannt" }, [], categories)).toBe("#ea580c");
    expect(sparteColor({ label: "Hausnotruf", source: "erkannt" }, [], categories)).toBeNull(); // keine Kategorie heißt so: das Schild bleibt ruhig
  });
  it("„Standard“ (nichts gewählt, nichts erkannt) und fehlende Sparte bleiben ohne Farbe", () => {
    expect(sparteColor({ label: "Photovoltaik & Wärmepumpe", source: "standard" }, [], categories)).toBeNull();
    expect(sparteColor({ label: "Photovoltaik", source: "standard" }, pick(1), categories)).toBeNull();
    expect(sparteColor(null, pick(1), categories)).toBeNull(); expect(sparteColor(undefined, [], categories)).toBeNull();
  });
  it("gleicher Name: Groß-/Kleinschreibung, Umlaute und eine kurze Endung stören nicht – ein längerer Name ist etwas anderes", () => {
    expect(sameSparteName("Alarmanlage", "Alarmanlagen")).toBe(true); expect(sameSparteName("WÄRMEPUMPE", "Waermepumpe")).toBe(true); expect(sameSparteName("Treppenlift", "Treppenlifte")).toBe(true);
    expect(sameSparteName("Photovoltaik", "Photovoltaik & Wärmepumpe")).toBe(false); expect(sameSparteName("Bad", "Bäder")).toBe(false); expect(sameSparteName("PV", "PVT")).toBe(false);
    expect(sameSparteName("", "Fenster")).toBe(false); expect(sameSparteName("Fenster", "Fenster")).toBe(true);
  });
});

describe("Stil-Block „Version 381“", () => {
  const all = readFileSync(new URL("../client/src/bausteine.css", import.meta.url), "utf8");
  const start = all.lastIndexOf("/*", all.indexOf("Version 381")); const block = all.slice(start).replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = Array.from(block.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((match) => ({ selector: match[1].replace(/\s+/g, " ").trim(), body: match[2].replace(/\s+/g, "") })).filter((rule) => !rule.selector.startsWith("@"));
  const body = (selector: string) => rules.filter((rule) => rule.selector.split(",").map((part) => part.trim()).includes(selector)).map((rule) => rule.body).join(";");

  it("steht am Ende der Bausteine und bringt Überschrift, Beschriftung und die Zahlen-Leiste mit", () => {
    expect(start).toBeGreaterThan(0); expect(rules.length).toBeGreaterThan(60);
    for (const selector of [".fx-h", ".fx-h.is-sub", ".fx-cap", ".fx-rail", ".fx-stat", ".fx-stat strong"]) expect(body(selector), selector).not.toBe("");
    expect(body(".fx-rail")).toContain("grid-template-columns:repeat(var(--fx-rail-n,4),minmax(0,1fr))");
    expect(body(".fx-stat.is-bad strong")).toContain("color:var(--fx-bad)"); // Farbe nur, wo etwas zu tun ist
  });

  it("Markenrot und Rosa stehen nur in Regeln für das helle Design – das dunkle Design behält seine Farben", () => {
    const stray = rules.filter((rule) => /#bc001d|#fb2c36|#fff1f2|#fff5f5|#fff8f8|#fde8ea|#d92d20|rgba\(188,0,29/i.test(rule.body) && !rule.selector.split(",").every((part) => part.trim().startsWith("html:not(.dark)")));
    expect(stray.map((rule) => rule.selector)).toEqual([]);
    expect(body(".vp")).toContain("--px-open:#60a5fa"); expect(body("html:not(.dark) .vp")).toContain("--px-open:#2a78d6"); // eigene Töne je Design
  });

  it("Filterleiste der Vertriebspipeline: Beschriftungen ohne Schild", () => {
    const label = body("html:not(.dark) .vp .dashboard-filter-group>.eyebrow");
    expect(label).toContain("background:none!important"); expect(label).toContain("border:0!important"); expect(label).toContain("padding:0!important");
  });

  it("Kästen, die rosa oder lila waren, sind weiß mit farbigem Rand links", () => {
    for (const selector of ["html:not(.dark) .undo-restore", "html:not(.dark) .ek .cl-next.is-run", "html:not(.dark) .ek .ki-box"]) { const text = body(selector); expect(text, selector).toContain("background:#ffffff!important"); expect(text, selector).toContain("box-shadow:inset3px00#bc001d"); }
    const rows = body("html:not(.dark) .vp .today-item.is-ueberfaellig"); expect(rows).toContain("background:#ffffff!important"); expect(rows).toContain("box-shadow:inset3px00#d92d20");
    expect(body("html:not(.dark) .vp .today-item.is-heute")).toContain("box-shadow:inset3px00#f79009"); expect(body("html:not(.dark) .vp .today-item.is-termin.is-today")).toContain("box-shadow:inset3px00#2a78d6");
    for (const selector of ["html:not(.dark) .rv-prewrite", "html:not(.dark) .ek .tree-preview-ki"]) expect(body(selector), selector).toContain("background:#f7f8fa!important");
  });

  it("Kontaktliste: „Nicht geöffnet“ ist ruhig, die Knöpfe am Zeilenende bleiben stehen, Köpfe in normaler Schrift", () => {
    const idle = body("html:not(.dark) .vp .email-leads-state.is-gesendet"); expect(idle).toContain("background:#ffffff!important"); expect(idle).not.toMatch(/#fde7ea|#ffe4e6/);
    expect(body(".vp .email-leads-table td.email-leads-row-tools")).toContain("position:sticky;right:0"); expect(body(".ek .email-leads-table td.email-leads-row-tools")).toContain("position:sticky;right:0");
    const head = body("html:not(.dark) .ek .email-leads-table th"); expect(head).toContain("text-transform:none"); expect(head).toContain("letter-spacing:0");
    expect(body("html:not(.dark) .vp .email-leads-mails")).toContain("background:#ffffff!important"); // „Mails“ nicht mehr lila
  });

  it("E-Mail-Kampagnen: Kennzahlen als eine Karte; geöffnet blau, geklickt bernstein, geantwortet grün – oben wie auf den Karten", () => {
    expect(body(".ek .cd-kpibar")).toContain("border-radius:20px"); expect(body(".ek .cd-kpi::before")).toBe("display:none");
    expect(body(".ek .cd-kpi.is-open")).toBe("--kpi-dot:var(--px-open)"); expect(body(".ek .cd-kpi.is-click")).toBe("--kpi-dot:var(--px-click)"); expect(body(".ek .cd-kpi.is-reply")).toBe("--kpi-dot:var(--px-reply)");
    expect(body(".ek .cl-f.is-click")).toBe("--bar:var(--px-click)"); expect(body(".ek .cl-f.is-open")).toBe("--bar:var(--px-open)"); expect(body(".ek .cl-f.is-reply")).toBe("--bar:var(--px-reply)");
    const warn = body("html:not(.dark) .ek .audience-status .is-warn"); expect(warn).toContain("background:#fffaeb!important"); // „noch niemand ausgewählt“: bernstein statt rosa
    expect(body("html:not(.dark) .sparte-badge.cat-strong")).toContain("background:color-mix(insrgb,var(--cat)15%,#fff)!important");
  });
});
