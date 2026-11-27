import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HELP_TOPICS, helpAnswer } from "../shared/help-knowledge";
import { SETTING_GROUPS } from "../shared/settings-view";

/**
 * Version 382 – Kooperationen, Einstellungen und Gespräche im Stil der neu gestalteten Seiten.
 * Hier: die Regeln des neuen Stil-Blocks, der Aufbau der Seiten im Quelltext und die Schutzregeln auf dem Server.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Stil-Block „Version 382“", () => {
  const all = read("../client/src/bausteine.css");
  const start = all.lastIndexOf("/*", all.indexOf("Version 382")); const next = all.indexOf("Version 383"); const block = all.slice(start, next > 0 ? all.lastIndexOf("/*", next) : undefined).replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = Array.from(block.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((match) => ({ selector: match[1].replace(/\s+/g, " ").trim(), body: match[2].replace(/\s+/g, "") })).filter((rule) => !rule.selector.startsWith("@"));
  const body = (selector: string) => rules.filter((rule) => rule.selector.split(",").map((part) => part.trim()).includes(selector)).map((rule) => rule.body).join(";");

  it("steht am Ende der Bausteine – nach dem Block der Version 381", () => {
    expect(start).toBeGreaterThan(all.indexOf("Version 381")); expect(rules.length).toBeGreaterThan(120);
    for (const selector of [".ko-row", ".ko-detail", ".ko-block", ".ko-maps li", ".ko-good", ".st-layout", ".st-menu", ".st-panel", ".st-card", ".st-switches li", ".st-reason-rows li"]) expect(body(selector), selector).not.toBe("");
  });

  it("Markenrot und Rosa stehen nur in Regeln für das helle Design, Lila nur in Regeln für das dunkle", () => {
    const light = (rule: { selector: string }) => rule.selector.split(",").every((part) => part.trim().startsWith("html:not(.dark)"));
    const dark = (rule: { selector: string }) => rule.selector.split(",").every((part) => part.trim().startsWith("html.dark"));
    expect(rules.filter((rule) => /#bc001d|#fb2c36|#fff1f2|#fff5f5|#fff8f8|#fde8ea|#d92d20|rgba\(188,0,29/i.test(rule.body) && !light(rule)).map((rule) => rule.selector)).toEqual([]);
    expect(rules.filter((rule) => /#8178ff|#7a70f5|#a39bff|#c4bfff|rgba\(125,113,255|rgba\(141,133,255/i.test(rule.body) && !dark(rule)).map((rule) => rule.selector)).toEqual([]);
  });

  it("Kooperationen: Kopf und Zeilen teilen sich die Spalten; Farbe nur, wo noch etwas zu klären ist", () => {
    const grid = "grid-template-columns:minmax(240px,1.6fr)minmax(200px,1.2fr)150px24px"; expect(body(".ko-rows-head")).toContain(grid); expect(body(".ko-row")).toContain(grid);
    expect(body(".ko .tg-stat.is-wait strong")).toBe("color:var(--fx-warn)"); expect(rules.some((rule) => /\.ko .*\.tg-stat(?!\.is-wait)[^,]* strong/.test(rule.selector) && /color:var\(--fx-(warn|bad)\)/.test(rule.body))).toBe(false);
    expect(body(".ko-item.is-open .rk-chevron")).toBe("transform:rotate(180deg)"); expect(body(".ko-item.is-open>.ko-row")).toContain("background:var(--lt-head)");
    expect(body(".ko-blocks")).toContain("grid-template-columns:repeat(2,minmax(0,1fr))"); // Kategorien und Felder nebeneinander
    expect(body(".ko-drop:hover:not(:disabled)")).toContain("color:var(--fx-bad)"); expect(body(".ko-delete:hover:not(:disabled)")).toContain("color:var(--fx-bad)"); // rot erst beim Draufzeigen
    expect(body(".ko-row:focus-visible")).toContain("outline:2px"); expect(block).toMatch(/@media \(max-width:760px\)\{\s*\.ko-rows-head\{display:none\}/);
  });

  it("Einstellungen: Menü links bleibt stehen, der gewählte Punkt ist im dunklen Design lila – im hellen greift die Regel des hellen Schemas (rot mit Schein)", () => {
    expect(body(".st-layout")).toContain("grid-template-columns:268pxminmax(0,1fr)"); expect(body(".st-menu")).toContain("position:sticky");
    expect(body("html.dark .st-menu .settings-tab.active")).toContain("background:rgba(125,113,255,.16)");
    expect(rules.filter((rule) => /settings-tab\.active/.test(rule.selector) && !/^html\.dark /.test(rule.selector)).map((rule) => rule.selector)).toEqual([]); // nichts überschreibt das helle Rot
    expect(body(".st-menu .settings-tab:not(.active):hover")).toContain("background:var(--lt-chip)"); expect(body(".st-menu .settings-tab:focus-visible")).toContain("outline:2px");
    expect(body(".st-panel-head h2")).toContain("font-size:20px"); expect(body(".st-card")).toContain("border-radius:16px");
    expect(body(".st-switches li")).toContain("border-top:1pxsolidvar(--lt-line)"); expect(body(".st-issue")).toContain("color:var(--fx-bad)");
    const light = read("../client/src/theme-light.css") + read("../client/src/theme-light.manual.css");
    expect(light).toMatch(/html:not\(\.dark\) \.settings-tab\.active[^{]*\{[^}]*linear-gradient/); // die Regel, auf die sich der Block verlässt
  });

  it("Einstellungen: Darstellung – jede Wahl hat einen Rahmen, die gewählte behält ihre Farbe; Reklamationsgründe – Kopf und Zeilen teilen sich die Spalten", () => {
    expect(body(".st-card .appearance-options button:not(.active)")).toBe("border-color:var(--lt-line-2)"); expect(rules.some((rule) => rule.selector === ".st-card .appearance-options button.active")).toBe(false);
    const grid = "grid-template-columns:72pxminmax(0,1fr)220px150px"; expect(body(".st-reason-head")).toContain(grid); expect(body(".st-reason-rows li")).toContain(grid);
    expect(body(".st-reason-move button:disabled")).toContain("opacity:.35"); expect(block).toMatch(/\.st-reason-head\{display:none\}/); // am Handy ohne Kopfzeile
  });

  it("Gespräche: Werkzeuge rechts in der Zeile „Agent“, das Feld „Lead-Kategorie“ so groß wie die übrigen Felder", () => {
    expect(body(".gq-agent-row .gq-tools").split(";")[0]).toBe("margin-left:auto"); expect(body(".gq-agent-row .gq-category").split(";")[0]).toBe("margin-left:0");
    const field = body(".cq-list-panel .gq-category .filter-select"); expect(field).toContain("height:36px"); expect(field).toContain("font-size:12.5px"); expect(field).toContain("font-weight:600");
    const periods = read("../client/src/gespraeche.css").match(/\.cq-list-panel \.gq-more-periods\{([^}]*)\}/)![1]; expect(periods).toContain("height:36px"); expect(periods).toContain("font-size:12.5px"); // dieselben Maße wie „Weitere Zeiträume“
    expect(block).toMatch(/@media \(max-width:760px\)\{\s*\.gq-agent-row \.gq-tools\{order:3;/); // am Handy zuletzt
  });
});

describe("Aufbau im Quelltext", () => {
  it("Kooperationen: die neue Seite ersetzt die alte – eine Datei, eingebunden im Arbeitsbereich", () => {
    expect(existsSync(new URL("../client/src/components/LiveCooperations.tsx", import.meta.url))).toBe(false);
    const shell = read("../client/src/components/FluxoraWorkspace.tsx"); expect(shell).toContain('import CooperationsDesk from "@/components/CooperationsDesk"'); expect(shell).not.toContain("LiveCooperations");
    const page = read("../client/src/components/CooperationsDesk.tsx");
    expect(page).toContain('className="fx-scope tg ko"'); expect(page).toContain("localeCompare(b.partnerTenantName"); // nach Namen sortiert – nichts springt
    expect(page).not.toMatch(/>[^<{]*(Mapping|Detail-Editor|Mandant)[^<{]*</); expect(page).not.toMatch(/"[^"\n]*(Mapping|Detail-Editor|Mandant)[^"\n]*"/); // in dem, was man liest – die Namen der Server-Aufrufe bleiben
    expect(page).not.toMatch(/>[^<{]*\b(Sie|Ihre|Ihren|Ihrem)\b[^<{]*</);
  });

  it("Einstellungen: keine Attrappen mehr – das Passwort geht an den Server, die Platzhalter sind raus, Schilder nur noch im Seitenkopf", () => {
    const page = read("../client/src/components/SettingsWorkspace.tsx");
    expect(page).toContain("trpc.auth.changePassword.useMutation"); expect(page).not.toContain("Passwortänderung geprüft"); expect(page).not.toMatch(/Stripe|Zahlungseinstellungen|Abonnement|Affiliate/);
    expect(page.match(/className="eyebrow[^"]*"/g)).toEqual(['className="eyebrow"', 'className="eyebrow block"']); // Reklamationsgründe und die Liste am Handy
    expect(page).not.toMatch(/forwardToSupplier=\{|forwardToSupplier\)/); // der Schalter ohne Wirkung wird nicht mehr gezeigt
    for (const file of ["LegalSettingsPanel", "TermsPanel", "ApiTokenPanel"]) { const source = read(`../client/src/components/${file}.tsx`); expect(source, file).toContain('<span className="eyebrow">EINSTELLUNGEN</span><h1>'); expect(source, file).not.toMatch(/<span className="eyebrow[^"]*">[^<]*<\/span>(?!<h[12]>)/); } // ein Schild steht nur noch über einer Überschrift
    expect(read("../client/src/components/MailSettingsPanel.tsx")).not.toContain('className="eyebrow'); expect((read("../client/src/components/MailSettingsPanel.tsx").match(/className="fx-h is-sub"/g) ?? []).length).toBeGreaterThanOrEqual(9);
    expect(read("../client/src/components/AppearanceSettings.tsx")).toContain('<h3 className="fx-h is-sub">Darstellung</h3>');
  });

  it("Gespräche: die Werkzeuge stehen im Quelltext in der Zeile „Agent“", () => {
    const page = read("../client/src/components/CallQaWorkspace.tsx"); const row = page.slice(page.indexOf('<div className="gq-agent-row">'), page.indexOf("<CallRecheckNotice"));
    expect(row.indexOf('className="gq-agents"')).toBeGreaterThan(0); expect(row.indexOf('className="gq-tools"')).toBeGreaterThan(row.indexOf('className="gq-agents"')); expect(row.indexOf('className="gq-category"')).toBeGreaterThan(row.indexOf('className="gq-tools"'));
    const campaigns = page.slice(page.indexOf('<div className="cq-campaign-row">'), page.indexOf('<div className="gq-agent-row">')); expect(campaigns).not.toContain("gq-tools");
    expect(page).toContain('<select className="filter-select" aria-label="Nach Lead-Kategorie filtern"');
  });
});

describe("Server: Kooperationen", () => {
  const routers = read("./routers.ts");
  it("die Liste sucht die Felder in der Tabelle der Felder – vorher über die Spalte der Kategorien, und scheiterte damit, sobald es einen Partner gab", () => {
    expect(routers).toContain("fields: await db.select().from(cooperationFieldMappings).where(eq(cooperationFieldMappings.cooperationId, row.id))");
    expect(routers).toContain("categories: await db.select().from(cooperationCategoryMappings).where(eq(cooperationCategoryMappings.cooperationId, row.id))");
    expect(routers).not.toContain("from(cooperationFieldMappings).where(eq(cooperationCategoryMappings.");
  });
  it("löschen und Zuordnungen entfernen sind Administratoren vorbehalten und prüfen, dass die Kooperation zum eigenen Bereich gehört", () => {
    const admin = routers.match(/const ADMIN_ONLY_MUTATIONS = new Set\(\[([^\]]*)\]\)/)![1];
    for (const name of ["createCooperation", "updateCooperation", "updateCooperationStatus", "deleteCooperation", "setCooperationCategoryMapping", "setCooperationFieldMapping", "removeCooperationCategoryMapping", "removeCooperationFieldMapping"]) expect(admin, name).toContain(`"${name}"`);
    for (const name of ["deleteCooperation", "removeCooperationCategoryMapping", "removeCooperationFieldMapping"]) {
      const line = routers.split("\n").find((text) => text.trimStart().startsWith(`${name}:`))!; expect(line, name).toBeTruthy();
      expect(line, name).toContain("eq(cooperations.tenantId, tenant.id)"); expect(line, name).toContain('throw new Error("Kooperation wurde nicht gefunden.")');
    }
    const remove = routers.split("\n").find((text) => text.trimStart().startsWith("deleteCooperation:"))!; expect(remove).toContain("db.transaction"); expect(remove).toContain("tx.delete(cooperationCategoryMappings)"); expect(remove).toContain("tx.delete(cooperationFieldMappings)");
    expect(routers.split("\n").find((text) => text.trimStart().startsWith("createCooperation:"))!).toContain("return { success: true, id: Number(inserted[0]?.insertId) || null }");
  });
});

describe("Hilfe kennt die neuen Seiten", () => {
  it("Passwort, Kooperationen und Reklamationsgründe haben einen eigenen Eintrag – er gewinnt vor den allgemeinen", () => {
    expect(helpAnswer("Wie ändere ich mein Passwort?")).toContain("mindestens 10 Zeichen, mit Buchstaben und mindestens einer Ziffer");
    expect(helpAnswer("Was sind Kooperationen?")).toContain("ändert an der Auslieferung nichts"); expect(helpAnswer("Wie lege ich einen Partner an?")).toContain("„Kooperation anlegen“");
    expect(helpAnswer("Wie heißt die Kategorie beim Partner?")).toContain("Verzeichnis der Partner"); // obwohl auch „Kategorie“ und „heiß…“ passen
    expect(helpAnswer("Reklamationsgründe sortieren")).toContain("mit den Pfeilen nach oben oder unten");
    expect(HELP_TOPICS.slice(0, 3).map((topic) => topic.id)).toEqual(["passwort-aendern", "reklamationsgruende", "kooperationen"]); expect(HELP_TOPICS.at(-2)!.id).toBe("einstellungen"); // allgemeine Einträge bleiben hinten
  });
  it("Einstellungen: die Hilfe nennt die vier Gruppen und jeden Bereich – und verspricht keine Bereiche mehr, die es nicht gibt", () => {
    const text = HELP_TOPICS.find((topic) => topic.id === "einstellungen")!.answer; expect(helpAnswer("Wo finde ich die Einstellungen?")).toBe(text);
    for (const group of SETTING_GROUPS) { expect(text, group.label).toContain(`${group.label}:`); for (const item of group.items) expect(text, item).toContain(`„${item}“`); }
    expect(text).not.toMatch(/E-Mail, Domain|Zahlung, Abonnement, Affiliate, Nutzungsbedingungen|Dublettenschutz/); expect(helpAnswer("Wo ist Zahlung?")).toContain("gibt es nicht mehr");
  });
});
