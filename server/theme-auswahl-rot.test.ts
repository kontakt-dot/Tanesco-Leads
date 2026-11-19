import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Helles Design: Was gewählt ist, steht in kräftigem Rot, das ausläuft – nie in Grau und nie in Blassrot (Rosa). */
const css = (name: string) => readFileSync(new URL(`../client/src/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = (source: string) => Array.from(source.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((match) => ({ selector: match[1].replace(/\s+/g, " ").trim(), body: match[2].replace(/\s+/g, " ").trim() })).filter((rule) => !rule.selector.startsWith("@"));
/** Was am Ende gilt: je einzelnem Selektor die letzte Regel der Datei. */
const effective = (source: string) => { const map = new Map<string, string>(); for (const rule of rules(source)) for (const part of rule.selector.split(",")) map.set(part.trim(), rule.body); return map; };
const GRADIENT = "linear-gradient(90deg, #bc001d, #fb2c36)";
const GREY_FILL = /background(-color)?\s*:\s*(#f2f4f7|#f7f8fa|#f9fafb|#eceef2|#e4e7ec|#f3f4f6|#f3f6f8|#f8fafb|#f1f5f9|#f8fafc|#eef0f3)/i;
const SELECTED = /\.active\b|\.is-active|\.is-on\b|\.is-picked|\.is-selected|\.selected\b|\.is-current|\.is-now|\[aria-selected|\[aria-pressed=|\[aria-current/;

describe("Helles Design – Auswahl in kräftigem Rot statt Grau", () => {
  const manual = css("theme-light.manual.css"); const light = effective(manual);

  it("Menü links: der gewählte Punkt ist rot gefüllt mit weißer Schrift, beim Überfahren wird die Schrift rot", () => {
    const active = light.get("html:not(.dark) .flux-sidebar .nav-item.active") ?? "";
    expect(active).toContain(GRADIENT); expect(active).toContain("color: #ffffff"); expect(active).not.toMatch(GREY_FILL);
    expect(light.get("html:not(.dark) .flux-sidebar .nav-item.active svg")).toContain("color: #ffffff");
    const hover = light.get("html:not(.dark) .flux-sidebar .nav-item:hover") ?? ""; expect(hover).toContain("color: #bc001d"); expect(hover).not.toMatch(GREY_FILL);
    expect(light.get("html:not(.dark) .mobile-tabbar button.active")).toContain(GRADIENT);
  });

  it("kein gewählter Zustand ist grau hinterlegt", () => {
    const allowed = new Set(["html:not(.dark) .qa-answer.active.unklar"]); // „Unklar“ ist bewusst neutral – die Antwort selbst ist die Aussage
    const grey = Array.from(light).filter(([selector, body]) => SELECTED.test(selector) && !selector.includes(":hover") && !allowed.has(selector) && GREY_FILL.test(body)).map(([selector]) => selector);
    expect(grey).toEqual([]);
  });

  it("kein Blassrot: Flächen sind nie halbtransparentes Rot", () => {
    expect(rules(manual).filter((rule) => /background[^;]*rgba\(188, 0, 29, \./.test(rule.body)).map((rule) => rule.selector)).toEqual([]);
  });

  it("gewählte Bedienelemente tragen den Verlauf, gewählte Zeilen und Karten einen roten Rahmen auf Weiß", () => {
    for (const selector of [".action-picker button.active", ".order-steps button.active", ".order-choice-chips button.selected", ".appearance-options button.active", ".cat-pick.is-on", ".rv-approaches button.is-active", ".inbox-item.active"]) expect(light.get(`html:not(.dark) ${selector}`), selector).toContain(GRADIENT);
    for (const selector of [".provider-card.active", ".source-card.is-active", ".rv-item.is-active", ".list-picker-row.is-active", ".ai-proposal.is-picked"]) { const body = (light.get(`html:not(.dark) ${selector}`) ?? "").replace(/\s+/g, ""); expect(body, selector).toContain("background:#ffffff"); expect(body, selector).toContain("#bc001d"); }
  });

  it("Beschriftungs-Pillen über den Überschriften: weiß mit rotem Rand und roter Schrift", () => {
    const eyebrow = light.get("html:not(.dark) .eyebrow") ?? ""; expect(eyebrow).toContain("border: 1px solid #bc001d"); expect(eyebrow).toContain("color: #bc001d"); expect(eyebrow).toContain("background: #ffffff");
  });

  it("ausgeschaltete Hauptknöpfe sind weder grau noch blassrot: weiß mit gestricheltem rotem Rand", () => {
    const disabled = light.get("html:not(.dark) .flux-button:disabled") ?? ""; expect(disabled).toContain("dashed #bc001d"); expect(disabled).toContain("background: #ffffff"); expect(disabled).not.toContain("#d0d5dd"); expect(disabled).toContain("opacity: 1");
  });

  it("Gespräche und Ordner ziehen mit: gewählter Abschnitt im Verlauf, das dunkle Design bleibt unberührt", () => {
    const calls = css("gespraeche.css"); const callRules = effective(calls);
    const on = callRules.get("html:not(.dark) .gs-nav.is-on") ?? ""; expect(on.replace(/\s+/g, "")).toContain("linear-gradient(90deg,#bc001d,#fb2c36)");
    expect(callRules.get("html:not(.dark) .gs-nav.is-on .gs-nav-text b")).toContain("#ffffff");
    expect(callRules.get(".gs-nav.is-on")).toContain("var(--gl-"); // Grundregel (dunkel) unverändert über Farbwerte des Schemas
    const added = calls.slice(calls.indexOf("html:not(.dark) .gs-nav:hover")); const stray = rules(added).filter((rule) => /#bc001d|#fb2c36/.test(rule.body) && !rule.selector.split(",").every((part) => part.trim().startsWith("html:not(.dark)")));
    expect(stray.map((rule) => rule.selector)).toEqual([]); // Rot nur im hellen Design
    expect(css("bausteine.css")).toContain("--fo-over-bg:#bc001d");
  });
});
