import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STATUS_STYLE } from "../client/src/lib/colors";

/**
 * Version 389 – „Freigegeben“ türkisblau statt Pink (überall gleich, auch die Punkte der Kacheln); die Käufer-Seite episch:
 * roter Kopf (dunkel: lila) mit Firmenname, Schildern, Monogramm und den Zahlen des Käufers; Reiter und Abschnitte ohne rosa Flächen.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const lab = (hex: string) => { const [r, g, b] = [1, 3, 5].map((index) => { const value = parseInt(hex.slice(index, index + 2), 16) / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]; };
const distance = (a: string, b: string) => 100 * Math.hypot(...lab(a).map((value, index) => value - lab(b)[index]));
const hue = (hex: string) => { const [, a, b] = lab(hex); return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360; };
/** Block „Version 389“ am Ende von bausteine.css, als einzelne Regeln (Auswahl + Inhalt) – auch die in @media */
const block = () => { const css = read("../client/src/bausteine.css"); return css.slice(css.indexOf("/* ───────── Version 389")); };
const rules = (css: string) => Array.from(css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((match) => ({ selector: match[1].trim(), body: match[2] }));

describe("„Freigegeben“ in Türkisblau", () => {
  it("eigene Farbe: kein Pink, klar anders als Neu (blau) und Zugewiesen (grün) – und als alle anderen Status", () => {
    expect(STATUS_STYLE.genehmigt).toEqual({ color: "#06b6d4", label: "Freigegeben" });
    const h = hue(STATUS_STYLE.genehmigt.color); expect(h).toBeGreaterThan(180); expect(h).toBeLessThan(250); // zwischen Türkis und Blau – weit weg vom Pink (~320)
    expect(distance(STATUS_STYLE.genehmigt.color, STATUS_STYLE.zugewiesen.color)).toBeGreaterThan(18); // altes Türkis: 11
    expect(distance(STATUS_STYLE.genehmigt.color, STATUS_STYLE.neu.color)).toBeGreaterThan(20);
    for (const [key, style] of Object.entries(STATUS_STYLE)) if (key !== "genehmigt") expect(distance(STATUS_STYLE.genehmigt.color, style.color), key).toBeGreaterThan(15);
  });
  it("überall gleich: Punkte der Kacheln „Bereit zum Ausliefern“ und „Ausgeliefert“ in den Farben der Status – hell und dunkel", () => {
    const css = read("../client/src/bausteine.css");
    expect(css.match(/--lo-bereit:#06b6d4;--lo-raus:#16a34a;/g)).toHaveLength(2);
    expect(css).not.toMatch(/--lo-bereit:#(3987e5|2a78d6)/);
  });
  it("Schnellansicht: der Status steht als Kapsel, nicht als farbige Schrift (Türkisblau wäre auf Weiß schlecht lesbar); Hilfe nennt die Farbe", () => {
    const overlay = read("../client/src/components/LeadQuickViewOverlay.tsx");
    expect(overlay).not.toContain("style={{ color: statusStyle(lead.status).color }}");
    expect(overlay).toContain('<span className="lp-status" style={catPill(statusStyle(lead.status).color)}>');
    expect(read("../shared/help-knowledge.ts")).toContain("Freigegeben türkisblau");
  });
});

describe("Käufer-Seite episch", () => {
  it("Kopf: Firma als Titel, Schilder Käufer und Schnittstelle (öffnet „Integration“), Monogramm, fünf Zahlen, Leiste mit „Letzte Lieferung“ und „Kunde seit“", () => {
    const detail = read("../client/src/components/MemberDetail.tsx");
    expect(detail).toContain("const title = (isBuyer ? user.company || user.name : user.name) ?? user.email ?? \"Benutzer\";");
    expect(detail).toContain('<span className="md-hero-mark" aria-hidden="true">{initials}</span>');
    expect(detail).toContain('onClick={() => selectTab("tools")}><Plug aria-hidden="true" />');
    for (const label of ["Leads bekommen", "Wert geliefert", "Bestellungen", "Reklamiert", "Abgelehnt"]) expect(detail).toContain(`label="${label}"`);
    expect(detail).toContain('<dl className="md-kpis" aria-label="Zahlen des Käufers">');
    expect(detail).toContain('<Fact label="Letzte Lieferung"'); expect(detail).toContain('label={isBuyer ? "Kunde seit" : "Registriert am"}');
  });
  it("Abschnitte mit Überschrift und Symbol statt Großbuchstaben-Schild; Schalter als Zeilen; Bestellungen als Karten; Aktivität als Zeitleiste", () => {
    const detail = read("../client/src/components/MemberDetail.tsx");
    for (const old of ["PROVISIONSSÄTZE", "GUTHABEN & AUSZAHLUNG", "PROVISIONEN PRO KONTAKT", "LEAD-KATEGORIE-MAPPING", "FELD-SCHLÜSSEL-MAPPING", "INBOUND WERT-MAPPING", "REKLAMATIONS-FENSTER", "REKLAMATION GESPERRT", "REKLAMATIONSGRÜNDE EINSCHRÄNKEN", "KONTO-AKTIVITÄT", "SICHTBARE BEREICHE", "RECHNUNGSADRESSE", '<span className="eyebrow">ZAHLUNGSART']) expect(detail, old).not.toContain(old);
    expect(detail).toContain('<label className="md-toggle"><input type="checkbox" role="switch"');
    expect(detail).toContain('<a key={order.id} className={`md-order is-${tone}`} href={`/?page=Bestellungen&orderId=${order.id}`}');
    expect(detail).toContain('<ol className="md-timeline">'); expect(detail).toContain("className={`is-${activityTone(event.title)}`}");
    expect(detail).not.toContain("<table className=\"flux-table\"><thead><tr><th>Bestellung</th>");
  });
  it("Server: Zahlen nur bei Käufern – Lieferungen über Bestellung (nicht an eine andere Station), über Station mit seinem Konto und direkt ohne Bestellung", () => {
    const server = read("./member-admin.ts");
    expect(server).toContain('const buyer = membership.partnerType === "käufer" ? await buyerOverview(db, tenantId, membership.id, user, orderRows) : null;');
    expect(server).toContain("or(isNull(deliveryStops.buyerUserId), eq(deliveryStops.buyerUserId, user.id))");
    expect(server).toContain("isNull(leadDeliveries.orderId), isNull(leadDeliveries.stopId), eq(leadDeliveries.buyerName, buyerName)");
    expect(server).toContain("eq(deliveryEndpoints.enabled, true)");
  });
  it("Stil: Rot nur in hellen Regeln, Lila nur in dunklen; keine rosa Flächen (kein Zartrot); Kopf in der Farbe der Hauptknöpfe", () => {
    const css = block(); expect(css.length).toBeGreaterThan(5000);
    for (const rule of rules(css)) {
      if (/#bc001d|#fb2c36|#c4001f|#9f0018|rgba\(188,\s*0,\s*29/i.test(rule.body)) expect(rule.selector, rule.selector).toMatch(/^html:not\(\.dark\)/);
      if (/#a39bff|#7a6dff|#4536c8|#271d73|rgba\(130,\s*120,\s*255/i.test(rule.body)) expect(rule.selector, rule.selector).toMatch(/^html\.dark/);
    }
    expect(css).not.toMatch(/(background|-soft)[^;{}]*rgba\(188,\s*0,\s*29/); // kein Zartrot als Fläche (der rote Schatten unter dem Kopf ist keine Fläche)
    expect(css).toContain("--md-accent-soft:#f2f4f7;"); // gewählter Reiter und Symbol-Kästchen: dezent grau
    expect(css).toContain("--md-hero-bg:linear-gradient(118deg,#9f0018 0%,#c4001f 46%,#fb2c36 100%)");
    expect(css).toContain(".md .md-hero{border:0;background:var(--md-hero-bg);color:#fff;");
    expect(css).toContain(".md-hero:not(.is-buyer) .md-hero-mark{display:none}");
  });
});
