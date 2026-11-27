import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Helles Design: rosarot wie vor Version 333 – Auswahl, Überfahren und Marken-Schilder in zartem Rot mit Schrift in Markenrot,
 * Hauptknöpfe und gewählte Reiter im roten Verlauf mit rotem Schein. Das dunkle Design bleibt unberührt.
 */
const css = (name: string) => readFileSync(new URL(`../client/src/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = (source: string) => Array.from(source.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((match) => ({ selector: match[1].replace(/\s+/g, " ").trim(), body: match[2].replace(/\s+/g, " ").trim() })).filter((rule) => !rule.selector.startsWith("@"));
/** Was am Ende gilt: je einzelnem Selektor die letzte Regel der Datei. */
const effective = (source: string) => { const map = new Map<string, string>(); for (const rule of rules(source)) for (const part of rule.selector.split(",")) map.set(part.trim(), rule.body); return map; };
const tight = (text: string | undefined) => (text ?? "").replace(/\s+/g, "");
const GRADIENT = "linear-gradient(90deg, #bc001d, #fb2c36)";
const STEEL_FILL = /background(-color)?\s*:\s*(#f2f4f7|#f7f8fa|#eceef2|#e4e7ec|#d0d5dd)/i;
const ROSE = /rgba\(188, ?0, ?29, ?\.\d+\)|rgba\(220, ?38, ?38, ?\.\d+\)|#fff1f2|#fff1f3|#fff5f5|#fff7f8|#fde8ea|#fde7ea|#fdecef|#ffe3e8|#ffe4e6/i;

describe("Helles Design – rosarot wie vor Version 333", () => {
  const manual = css("theme-light.manual.css"); const light = effective(manual); const of = (selector: string) => light.get(`html:not(.dark) ${selector}`) ?? "";

  it("Menü links: der gewählte Punkt ist zartrot mit rotem Balken und roter Schrift", () => {
    const active = of(".flux-sidebar .nav-item.active");
    expect(active).toContain("linear-gradient(90deg, rgba(188, 0, 29, .14), rgba(188, 0, 29, .04))"); expect(active).toContain("box-shadow: inset 3px 0 #bc001d"); expect(active).toContain("color: #bc001d");
    expect(of(".flux-sidebar .nav-item.active svg")).toContain("color: #bc001d");
    expect(of(".mobile-tabbar button.active")).toContain("linear-gradient(180deg, rgba(188, 0, 29, .14), rgba(188, 0, 29, .05))");
  });

  it("Schilder über den Überschriften: zartrote Pille mit roter Schrift", () => {
    const eyebrow = of(".eyebrow"); expect(eyebrow).toContain("background: rgba(188, 0, 29, .08)"); expect(eyebrow).toContain("border: 1px solid rgba(188, 0, 29, .2)"); expect(eyebrow).toContain("color: #bc001d");
  });

  it("Auswahl, Marken und Hinweise sind rosarot – nichts davon ist stahlgrau hinterlegt", () => {
    const selectors = [".action-picker button.active", ".order-steps button.active", ".order-choice-chips button.selected", ".appearance-options button.active", ".cat-pick.is-on", ".rv-item.is-active", ".rv-approaches button.is-active", ".provider-card.active", ".list-picker-row.is-active", ".inbox-item.is-picked", ".hourly-day tr.is-selected td", ".stage-pill", ".fact-icon", ".cl-tag.is-sparte", ".cd-avatar", ".motivation-bar", ".pipeline-quote", ".cl-tile", ".cl-approval", ".sheets-step", ".kpi-people-count", ".opt-in-step.is-current", ".bg-violet-500\\/10"];
    for (const selector of selectors) { const body = of(selector); expect(body, selector).toMatch(ROSE); expect(body, selector).not.toMatch(STEEL_FILL); }
    expect(of(".live-leads-workspace .lead-panel table tbody tr:hover")).toContain("#fff5f5"); // Zeile der Lead-Liste beim Überfahren
    expect(manual).not.toContain("v339");
  });

  it("Hauptknöpfe und gewählte Reiter: roter Verlauf mit rotem Schein; Fokus in Rot", () => {
    const button = of(".flux-button"); expect(button).toContain(GRADIENT); expect(button).toContain("0 8px 30px rgba(220, 38, 38, .30)");
    const tab = of(".settings-tab.active"); expect(tab).toContain(GRADIENT); expect(tab).toContain("0 8px 24px rgba(220, 38, 38, .25)");
    expect(of("input:focus-visible")).toContain("rgba(188, 0, 29, .35)"); expect(light.get("html:not(.dark)")).toContain("--ring: #bc001d");
  });

  it("ausgeschaltete Hauptknöpfe haben keine graue Sonderregel mehr", () => {
    expect(light.has("html:not(.dark) .flux-button:disabled")).toBe(false); expect(manual).not.toContain("#d0d5dd !important; color: #ffffff !important; box-shadow: none");
    expect(of(".email-leads-push:disabled")).toContain("#f1b8c1");
  });

  it("Gespräche, Ordner und Verträge tragen dasselbe Rosarot – und nur im hellen Design", () => {
    const calls = css("gespraeche.css"); const callRules = effective(calls);
    expect(tight(callRules.get("html:not(.dark) .gs-nav.is-on"))).toContain("linear-gradient(90deg,rgba(188,0,29,.14),rgba(188,0,29,.04));box-shadow:inset3px0#bc001d");
    expect(tight(callRules.get("html:not(.dark) .gs-nav.is-on .gs-nav-text b"))).toContain("color:#bc001d");
    expect(tight(callRules.get("html:not(.dark) .gs-mode.is-on"))).toContain("background:#fff1f2");
    expect(callRules.get(".gs-nav.is-on")).toContain("var(--gl-"); // Grundregel (dunkles Design) arbeitet weiter mit den Farbwerten des Schemas
    expect(calls).toContain("--gq-on-shadow:0 6px 16px rgba(220,38,38,.25)");
    const folders = css("bausteine.css"); expect(folders).toContain("--fo-on-bg:#fff1f2"); expect(folders).toContain("--fo-on-count-bg:#bc001d"); expect(tight(effective(folders).get("html:not(.dark) .cl-folder.is-active"))).toContain("border-color:#bc001d");
    const contracts = css("vertraege.css"); const contractRules = effective(contracts);
    expect(tight(contractRules.get("html:not(.dark) .vt-nudge"))).toContain("background:#fde8ea"); expect(tight(contractRules.get("html:not(.dark) .vt-btn.is-solid"))).toContain("linear-gradient(90deg,#bc001d,#fb2c36)");
    expect(tight(contractRules.get(".vt-track i.is-done"))).toContain("var(--vt-ink)"); // „erledigt“ bleibt dunkel – Rot heißt dort „abgelehnt/abgelaufen“
    // Rot und Rosa der neuen Blöcke stehen nur in Regeln für das helle Design
    for (const [name, source, start] of [["gespraeche.css", calls, "html:not(.dark) .gs-nav:hover"], ["vertraege.css", contracts, "html:not(.dark) .vt-nudge"]] as const) {
      const stray = rules(source.slice(source.indexOf(start))).filter((rule) => /#bc001d|#fb2c36|#fff1f2|#fff5f5|#fde8ea|rgba\(188,0,29/.test(rule.body) && !rule.selector.split(",").every((part) => part.trim().startsWith("html:not(.dark)")));
      expect(stray.map((rule) => rule.selector), name).toEqual([]);
    }
  });

  it("Gespräche: im hellen Design ist alles weiß – keine graue Fläche hinter der Liste, keine grauen Kästen", () => {
    const calls = css("gespraeche.css"); const callRules = effective(calls);
    const lightTokens = rules(calls).filter((rule) => rule.selector.startsWith("html:not(.dark)") && /--g[lq]-/.test(rule.body)).map((rule) => tight(rule.body)).join(";");
    for (const token of ["--gl-tray:#ffffff", "--gl-softer:#ffffff", "--gl-card:#ffffff", "--gq-soft:#ffffff"]) expect(lightTokens, token).toContain(token);
    expect(calls).toContain("--gl-tray:rgba(0,0,0,.16)"); expect(calls).toContain("--gl-softer:rgba(255,255,255,.022)"); // das dunkle Design bleibt, wie es war
    const wrap = tight(callRules.get("html:not(.dark) .gq-table-wrap")); expect(wrap).toContain("background:none"); expect(wrap).toContain("border-color:transparent"); // die Liste hat keinen eigenen Rahmen mehr
    for (const selector of [".gq-periods", ".cq-list-panel .dashboard-segments", ".cq-dialog .cq-question-row", ".cq-dialog .cq-criterion-row", ".gq-turn", ".gq-detail audio[controls]"]) expect(tight(callRules.get(`html:not(.dark) ${selector}`)), selector).toContain("background:#ffffff");
    const grey = rules(calls).filter((rule) => rule.selector.startsWith("html:not(.dark)") && /background(-color)?:(#f9fafb|#f8fafb|#f4f5f7)/i.test(tight(rule.body)));
    expect(grey.map((rule) => rule.selector)).toEqual([]);
    expect(tight(effective(css("vertraege.css")).get("html:not(.dark) .vt-list"))).toContain("background:none"); // Vertragsliste: dieselbe Lösung
    // Die Liste ist ein ruhiges Protokoll: Zeilen mit feinen Linien, ohne Karten, Schatten oder Hüpfen – beim Überfahren ein Hauch Rosa
    const row = tight(rules(calls).find((rule) => rule.selector === ".gq-call")?.body); expect(row).toContain("border:0;border-top:1pxsolidvar(--gl-line)"); expect(row).toContain("border-radius:0"); expect(row).toContain("background:transparent"); expect(row).not.toContain("box-shadow");
    expect(tight(rules(calls).find((rule) => rule.selector === ".gq-call:hover")?.body)).toBe("background:var(--gl-row)"); expect(lightTokens).toContain("--gl-row:#f7f8fa"); expect(lightTokens).toContain("--gl-row-on:#eff1f4"); /* seit v386 auf Wunsch dezent grau statt rosa */
    expect(calls).not.toMatch(/\.gq-(wave|slot|dur|agent-chip)\b/); // Verlauf, Dauer-Strich und Agenten-Schilder gibt es nicht mehr
  });

  it("Gespräche: Ergebnis-Schilder sind wieder farbig hinterlegt – grün, orange, rot; „Offen“ bleibt neutral", () => {
    const calls = css("gespraeche.css"); const callRules = effective(calls);
    const light = rules(calls).filter((rule) => rule.selector.startsWith("html:not(.dark)") && rule.body.includes("--gp-green")).map((rule) => tight(rule.body)).join(";");
    for (const token of ["--gp-green:#0b6b39", "--gp-green-bg:#e2f5e9", "--gp-orange:#a64208", "--gp-orange-bg:#ffefdf", "--gp-red:#ab1f15", "--gp-red-bg:#fde8e6", "--gp-open-bg:#ffffff"]) expect(light, token).toContain(token);
    expect(calls).toContain("--gp-green:#6ee7b7;--gp-green-bg:rgba(16,185,129,.15)"); // das dunkle Design hat eigene Töne
    const pill = tight(callRules.get(".gq-pill")); expect(pill).toContain("background:var(--pill-bg)"); expect(pill).toContain("color:var(--pill-ink)");
    expect(tight(callRules.get(".gq-pill.is-freigegeben"))).toBe("--pill-bg:var(--gp-green-bg);--pill-ink:var(--gp-green)");
    expect(tight(callRules.get(".gq-pill.is-pruefen"))).toBe("--pill-bg:var(--gp-orange-bg);--pill-ink:var(--gp-orange)"); expect(tight(callRules.get(".gq-pill.is-zurueckgewiesen"))).toBe("--pill-bg:var(--gp-red-bg);--pill-ink:var(--gp-red)");
    expect(tight(callRules.get(".gq-pill::before"))).toContain("background:currentColor"); // der Punkt trägt die Schriftfarbe
    expect(calls).not.toContain(".gq-stage .gq-pill{"); // im Kopf des Gesprächs gelten dieselben Farben wie in der Liste
  });

  it("Bestenliste der Agenten: Bühne in beiden Designs dunkel (hell: weinrot), darunter weiß und rosarot – Markenrot nur im hellen Design, Bewegung abschaltbar", () => {
    const board = css("bestenliste.css"); const boardRules = rules(board); const last = effective(board);
    // Markenrot und Rosa stehen nur in Regeln für das helle Design
    const stray = boardRules.filter((rule) => /#bc001d|#fb2c36|#fff1f2|#fff5f5|#fff8f8|#fde8ea|rgba\(188,0,29/.test(rule.body) && !rule.selector.split(",").every((part) => part.trim().startsWith("html:not(.dark)")));
    expect(stray.map((rule) => rule.selector)).toEqual([]);
    const lightTokens = tight(last.get("html:not(.dark) .bl-scope")); const darkTokens = tight(last.get(".bl-scope"));
    expect(lightTokens).toContain("--bl-accent:#bc001d"); expect(lightTokens).toContain("--bl-bar:linear-gradient(90deg,#bc001d,#fb2c36)"); expect(lightTokens).toContain("--bl-row:#fff8f8"); expect(lightTokens).toContain("--bl-tile:#ffffff");
    expect(lightTokens).toContain("linear-gradient(162deg,#8f0c210%,#5d091c48%,#2b0612100%)"); expect(darkTokens).toContain("linear-gradient(162deg,#2a24680%,#1a164248%,#0f0d24100%)"); // der Vorhang
    expect(darkTokens).toContain("--bl-accent:#b3a9ff"); expect(darkTokens).not.toMatch(/#bc001d|#fb2c36/);
    // im hellen Design keine graue Fläche
    const grey = boardRules.filter((rule) => rule.selector.startsWith("html:not(.dark)") && /background(-color)?:(#f9fafb|#f8fafb|#f4f5f7|#f2f4f7)/i.test(tight(rule.body))); expect(grey.map((rule) => rule.selector)).toEqual([]);
    // die Überschrift auf der Bühne bleibt weiß, obwohl Überschriften im hellen Design sonst dunkel sind
    expect(tight(last.get("html:not(.dark) .bl-stage .bl-stage-head h2"))).toContain("color:#ffffff!important");
    // Treppchen: der Erste in der Mitte; Gold, Silber, Bronze
    expect(tight(last.get(".bl-pod.is-p1"))).toContain("order:2;--bl-medal:var(--bl-gold)"); expect(tight(last.get(".bl-pod.is-p2"))).toContain("order:1;--bl-medal:var(--bl-silver)"); expect(tight(last.get(".bl-pod.is-p3"))).toContain("order:3;--bl-medal:var(--bl-bronze)");
    // wer weniger Bewegung möchte: kein Konfetti, nichts fliegt herein
    const calm = board.slice(board.indexOf("@media(prefers-reduced-motion:reduce)")); expect(calm.length).toBeGreaterThan(50);
    expect(tight(calm)).toContain(".bl-confetti{display:none}"); expect(tight(calm)).toContain(".bl-pod,.bl-feedli,.bl-cheer,.bl-livei,.bl-pod.is-fresh.bl-pod-face,.bl-chaseli.is-fresh{animation:none}");
    // die Großansicht liegt über der ganzen Seite
    const wide = tight(last.get(".bl-wide")); expect(wide).toContain("position:fixed;inset:0"); expect(wide).toContain("background:var(--bl-curtain-wide)"); expect(tight(last.get("html.bl-wide-open"))).toBe("overflow:hidden");
    // die Auswertung von früher ist aus den Gesprächs-Regeln verschwunden
    expect(css("gespraeche.css")).not.toMatch(/\.gq-(stats|best|agent-wrap|alist|arow|astats|rank|meter|agents-note)\b/);
  });

  it("Smileys: weicher Schatten in der Ampelfarbe statt grauem Schlagschatten", () => {
    const callRules = effective(css("gespraeche.css"));
    expect(tight(callRules.get(".cq-face"))).toContain("filter:drop-shadow(01.5px2.5pxvar(--cq-glow))");
    for (const mood of ["gruen", "gelb", "rot"]) expect(tight(callRules.get(`.cq-face.is-${mood}`)), mood).toMatch(/^--cq-glow:rgba\(\d+,\d+,\d+,\.38\)$/);
    expect(callRules.has(".cq-ring-track")).toBe(false); // die Spur des Rings bekommt ihre Farbe vom Smiley selbst
  });
});
