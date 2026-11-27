import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEEDBACK_KINDS, PARTNER_PROVIDERS, feedbackKind } from "../shared/partner-report";
import { HELP_TOPICS, helpAnswer } from "../shared/help-knowledge";

/**
 * Version 383 – Integration an einer Stelle: beim Käufer.
 * Hier: die Regeln des Stil-Blocks, der Aufbau im Quelltext (wo eingerichtet wird, wo nicht mehr), die Schutzregeln auf dem Server,
 * die Migration und die Hilfe. Die Rechnung selbst prüft server/partner-assemble.test.ts, den Ablauf gegen die Datenbank der Schritt „v383.“.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const component = (name: string) => read(`../client/src/components/${name}`);

describe("Stil-Block „Version 383“", () => {
  const all = read("../client/src/bausteine.css");
  const start = all.lastIndexOf("/*", all.indexOf("Version 383")); const next = all.indexOf("Version 384"); const block = all.slice(start, next > 0 ? all.lastIndexOf("/*", next) : undefined).replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = Array.from(block.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((match) => ({ selector: match[1].replace(/\s+/g, " ").trim(), body: match[2].replace(/\s+/g, "") })).filter((rule) => !rule.selector.startsWith("@"));
  const body = (selector: string) => rules.filter((rule) => rule.selector.split(",").map((part) => part.trim()).includes(selector)).map((rule) => rule.body).join(";");

  it("steht nach dem Block der Version 382 und bringt die drei Teile mit: Statistik, Rückmeldung beim Käufer, Einstellungen", () => {
    expect(start).toBeGreaterThan(all.indexOf("Version 382")); expect(rules.length).toBeGreaterThan(110);
    for (const selector of [".pr-sync.is-todo", ".pr-tiles.is-three", ".bf", ".bf-kinds", ".bf-account", ".bf-url code", ".ie-card", ".ie-rows li", ".ie-rules li", ".ie-older-wrap", ".it-intro"]) expect(body(selector), selector).not.toBe("");
  });
  it("Markenrot und Rosa stehen nur in Regeln für das helle Design, Lila nur in Regeln für das dunkle – der Block kommt mit den gemeinsamen Farbwerten aus", () => {
    const light = (rule: { selector: string }) => rule.selector.split(",").every((part) => part.trim().startsWith("html:not(.dark)")); const dark = (rule: { selector: string }) => rule.selector.split(",").every((part) => part.trim().startsWith("html.dark"));
    expect(rules.filter((rule) => /#bc001d|#fb2c36|#fff1f2|#fff5f5|#fff8f8|#fde8ea|#d92d20|rgba\(188,0,29/i.test(rule.body) && !light(rule)).map((rule) => rule.selector)).toEqual([]);
    expect(rules.filter((rule) => /#8178ff|#7a70f5|#a39bff|#c4bfff|rgba\(125,113,255|rgba\(141,133,255/i.test(rule.body) && !dark(rule)).map((rule) => rule.selector)).toEqual([]);
  });
  it("Farbe trägt Bedeutung: bernstein, wo noch etwas einzurichten ist; rot erst beim Zeigen auf „Entfernen“; der gewählte Weg in der Farbe der Auswahl", () => {
    expect(body(".pr-sync.is-todo")).toBe("border-color:var(--fx-warn-line);background:var(--fx-warn-bg);color:var(--lt-ink-2)"); expect(body(".bf-existing")).toContain("border:1pxsolidvar(--fx-warn-line)"); expect(body(".ie-rows li.is-open")).toBe("border-color:var(--fx-warn-line)"); expect(body(".ie-hint")).toContain("background:var(--fx-warn-bg)");
    expect(body(".bf-remove:hover:not(:disabled)")).toContain("color:var(--fx-bad)"); expect(body(".ie-remove:hover:not(:disabled)")).toContain("color:var(--fx-bad)"); expect(rules.some((rule) => /^\.(bf|ie)-remove$/.test(rule.selector) && /--fx-bad/.test(rule.body))).toBe(false);
    expect(body(".bf-kinds label.is-on")).toContain("border-color:var(--fx-pick-line);background:var(--fx-pick)"); expect(body(".bf-kinds label:focus-within")).toContain("outline:2px");
  });
  it("Maße: drei Wege nebeneinander (am Handy untereinander); drei Kacheln ohne Gesamtquote; Zeilen der Übersicht mit festen Spalten", () => {
    expect(body(".bf-kinds")).toContain("grid-template-columns:repeat(3,minmax(0,1fr))"); expect(block).toMatch(/@media \(max-width:900px\)\{\.bf-kinds,\.bf-kinds\.is-two\{grid-template-columns:minmax\(0,1fr\)\}\}/);
    expect(body(".pr-tiles.is-three").split(";")[0]).toBe("grid-template-columns:repeat(3,minmax(0,1fr))"); expect(body(".ie-rows li")).toContain("grid-template-columns:autominmax(0,1fr)autoauto"); expect(body(".ie-rules li")).toContain("grid-template-columns:150pxminmax(0,1fr)minmax(0,1fr)auto");
    expect(body(".bf-url code")).toContain("overflow-wrap:anywhere"); // die lange Adresse bricht um, statt die Karte zu sprengen
  });
});

describe("Aufbau im Quelltext: eingerichtet wird beim Käufer", () => {
  it("der Reiter „Integration“ zeigt die Rückmeldung direkt nach der Schnittstelle; dort – und nur dort – entstehen neue Konten, immer mit dem Käufer", () => {
    const tab = component("IntegrationTab.tsx"); const order = ["<OutgoingCalls ", "<BuyerFeedback ", "<ResponseMapping ", "<ReturnWebhooks ", "<WebhookBlock "].map((tag) => tab.indexOf(tag)); expect(order.every((at) => at > 0)).toBe(true); expect([...order].sort((a, b) => a - b)).toEqual(order);
    const feedback = component("BuyerFeedback.tsx");
    expect(feedback).toContain("wattfox.mutate({ label: \"\", reclaimOnCancel: true, reclaimReasonId: null, buyerUserId: data.buyerUserId })"); expect(feedback).toMatch(/aroundhome\.mutate\(\{[^}]*buyerUserId: data\.buyerUserId \}\)/); expect(feedback).toMatch(/platform\.mutate\(\{[^}]*buyerUserId: data\.buyerUserId \}\)/);
    expect(feedback).toContain("trpc.leadops.removeBuyerFeedback.useMutation"); expect(feedback).toContain('const STATS_URL = "/?page=Statistik&view=Integrationen";');
    for (const heading of ["Schnittstelle zu diesem Käufer", "Ablehnungen des Käufers einordnen", "Rückgabe an den Lieferanten", "Einfache Benachrichtigung (Webhook)"]) expect(tab, heading).toContain(`<h3 className="fx-h">${heading}</h3>`);
    expect(tab).not.toMatch(/AUSGEHENDE API-CALLS|PARTNER-RESPONSE-MAPPING|LIEFERANTEN-RÜCKGABE-WEBHOOKS|Mapping aktiv/); expect(tab).toContain("Endpoint hinzufügen"); // der Editor selbst bleibt, wie er ist
  });
  it("Einstellungen → Integrationen legt keine Konten mehr an: Übersicht mit Zuordnung, Stornogründe, Telefonnummern, Vorlagen – ältere Verbindungen am Ende", () => {
    expect(existsSync(new URL("../client/src/components/PartnerPlatforms.tsx", import.meta.url))).toBe(false);
    const panel = component("PartnerAccountsPanel.tsx"); for (const gone of ["createWattfoxAccount", "saveAroundhomeAccount", "savePlatformAccount", "Konto hinzufügen", "Tracking-URL erzeugen", "className=\"eyebrow\">PARTNER", "PartnerPlatforms"]) expect(panel, gone).not.toContain(gone);
    for (const kept of ["updatePartnerAccount", "deletePartnerAccount", "saveCancelRules", "saveHlrLookup", "testHlrLookup", "listIntegrationPresets", "buyerIntegrationUrl(member.membershipId)"]) expect(panel, kept).toContain(kept);
    const settings = component("SettingsWorkspace.tsx"); const at = ["<IntegrationSettingsHead />", "<PartnerAccountsPanel />", "<IntegrationPanel embedded />"].map((tag) => settings.indexOf(tag)); expect(at.every((value) => value > 0)).toBe(true); expect([...at].sort((a, b) => a - b)).toEqual(at);
    const older = component("IntegrationPanel.tsx"); expect(older).toContain("Ältere Verbindungen (Integrationsbuilder)"); expect(older).toContain("greift nur, wenn beim Käufer keine eigene Schnittstelle eingerichtet ist"); expect(older).toContain("Vorlagenbibliothek");
  });
  it("Statistik: eine Karte auch ohne Konto – mit dem Weg zum Käufer; ohne Rückmeldung keine Gesamtquote", () => {
    const report = component("PartnerReport.tsx");
    expect(report).toContain("export const buyerIntegrationUrl = (membershipId: number) => `/?page=Benutzer&member=${membershipId}&tab=tools`;"); expect(report).toContain("const missing = account.mode !== \"none\" && !account.hasAccess;");
    expect(report).toContain("const rated = account.mode !== \"none\" && (c.rated > 0 || (account.mode === \"pull\" && account.hasAccess));"); expect(report).toContain("{rated && <Tile label=\"Gesamtquote\"");
    expect(report).toContain("<h3>Noch keine Integration</h3>"); expect(report).not.toContain("Noch kein Partnerkonto"); expect(report).not.toContain("Partnerkonto anlegen");
  });
  it("die Wege der Rückmeldung: WattFox, Aroundhome, weitere Plattformen – „Eigene Schnittstelle“ hat keinen", () => {
    expect(FEEDBACK_KINDS.map((item) => item.key)).toEqual(["wattfox", "aroundhome", "plattform"]); for (const item of FEEDBACK_KINDS) { expect(item.text.length, item.key).toBeGreaterThan(30); expect(item.action, item.key).not.toBe(""); expect(item.next.endsWith("."), item.key).toBe(true); }
    expect(["wattfox", "aroundhome", "leadnodes", "enpal", "gohighlevel", "api", "hlrlookup", null, undefined].map(feedbackKind)).toEqual(["wattfox", "aroundhome", "plattform", "plattform", "plattform", null, null, null, null]);
    expect(PARTNER_PROVIDERS.map((item) => item.key)).toEqual(["aroundhome", "wattfox", "leadnodes", "enpal", "gohighlevel", "api"]); expect(PARTNER_PROVIDERS.at(-1)).toMatchObject({ name: "Eigene Schnittstelle", mode: "none" });
  });
});

describe("Server: Konten ohne Rückmeldung, Schutzregeln, Migration", () => {
  const routers = read("./routers.ts"); const accounts = read("./partner-accounts.ts"); const report = read("./partner-report.ts");
  it("der Anbieter „api“ steht in der Tabelle; die Migration hängt ihn hinten an – vorhandene Zeilen bleiben, wie sie sind", () => {
    expect(read("../drizzle/schema.ts")).toContain('mysqlEnum("provider", ["aroundhome", "wattfox", "hlrlookup", "leadnodes", "enpal", "gohighlevel", "api"])');
    const sql = read("../drizzle/0126_kaeufer_ohne_konto.sql").split("\n").filter((line) => line.trim() && !line.startsWith("--")); expect(sql).toEqual(["ALTER TABLE `partnerAccounts` MODIFY COLUMN `provider` enum('aroundhome','wattfox','hlrlookup','leadnodes','enpal','gohighlevel','api') NOT NULL;"]);
    const journal = JSON.parse(read("../drizzle/meta/_journal.json")) as { entries: Array<{ idx: number; tag: string; when: number }> }; const last = journal.entries.at(-1)!; expect(last).toMatchObject({ idx: 126, tag: "0126_kaeufer_ohne_konto" }); expect(last.when).toBeGreaterThan(journal.entries.at(-2)!.when); expect(journal.entries.map((entry) => entry.idx)).toEqual(journal.entries.map((_, index) => index));
  });
  it("neu: getBuyerFeedback (nur Administratoren, Zugang nur gekürzt) und removeBuyerFeedback (nur Administratoren)", () => {
    const set = (name: string) => routers.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]`))![1];
    expect(set("ADMIN_ONLY_QUERIES")).toContain('"getBuyerFeedback"'); expect(set("RESTRICTED_QUERIES")).toContain('"getBuyerFeedback"'); for (const name of ["removeBuyerFeedback", "createWattfoxAccount", "saveAroundhomeAccount", "savePlatformAccount", "updatePartnerAccount", "deletePartnerAccount"]) expect(set("ADMIN_ONLY_MUTATIONS"), name).toContain(`"${name}"`);
    expect(set("ADMIN_ONLY_MUTATIONS")).not.toContain('"setPartnerQuota"'); // das Kontingent dürfen auch Manager eintragen – wie bisher
    const feedback = accounts.slice(accounts.indexOf("export async function getBuyerFeedback"), accounts.indexOf("export async function removeBuyerFeedback")); expect(feedback).toContain("accessToken: mask(credentials.accessToken)"); expect(feedback).not.toMatch(/accessToken: credentials\.accessToken|credentialsEncrypted:/); expect(feedback).toContain('throw new Error("Der Benutzer gehört nicht zu diesem Lead-Bereich.")');
    expect(feedback).toContain('account.provider !== "api"'); // die Zeile, die nur ein Kontingent hält, ist keine Rückmeldung
  });
  it("eine Zeile „api“ entsteht nur für ein Kontingent, wird beim Einrichten zum Konto des Partners und beim Entfernen wieder zur Zeile – das Kontingent geht nie verloren", () => {
    const quota = report.slice(report.indexOf("export async function setPartnerQuota"), report.indexOf("export async function partnerContacts"));
    expect(quota).toContain('if (input.accountId < 0) {'); expect(quota).toContain('provider: "api", buyerUserId, label: null, enabled: true, quotaAmount: amount, quotaPeriod: input.period'); expect(quota).toContain('throw new Error("Der Käufer wurde nicht gefunden.")');
    expect(quota).toContain('if (!amount && account.provider === "api") { await db.delete(partnerAccounts)'); // ohne Kontingent hat die Zeile keinen Zweck
    expect((accounts.match(/const holder = await placeholderAccount\(db, tenantId, /g) ?? []).length).toBe(4); // WattFox, Aroundhome, weitere Plattform, Zuordnen
    const remove = accounts.slice(accounts.indexOf("export async function removeBuyerFeedback")); expect(remove).toContain('if (account.buyerUserId && account.quotaAmount) {'); expect(remove).toContain('set({ provider: "api", label: null, publisherId: null, credentialsEncrypted: null, trackingToken: null,'); expect(remove).toContain("keptQuota: true"); expect(remove).toContain("keptQuota: false");
    expect(routers).toContain("setPartnerQuota: leadopsProcedure.input(z.object({ accountId: z.number().int().refine((value) => value !== 0)"); expect(routers).toContain("partnerContacts: leadopsProcedure.input(z.object({ accountId: z.number().int().refine((value) => value !== 0)");
    expect(report).toContain('export { endpointAccount } from "../shared/partner-report";'); expect(report).toContain("assembleReport({ accounts: rawAccounts, endpoints, events,"); // Server und Vorschau rechnen mit derselben Zusammenstellung
  });
});

describe("Hilfe: wo die Rückmeldung eingerichtet wird", () => {
  it("eigener Eintrag, steht vorn – und sagt, dass kein Partnerkonto mehr nötig ist", () => {
    expect(HELP_TOPICS.slice(0, 4).map((topic) => topic.id)).toEqual(["passwort-aendern", "reklamationsgruende", "kooperationen", "rueckmeldung-kaeufer"]);
    for (const question of ["Wo richte ich die Rückmeldung ein?", "Tracking-URL für WattFox erzeugen", "Warum fehlt mein Käufer in der Statistik?", "Wo lege ich ein Partnerkonto an?"]) expect(helpAnswer(question), question).toContain("Benutzer → Käufer öffnen → Reiter „Integration“ → „Rückmeldung des Käufers“");
    expect(helpAnswer("Wo lege ich ein Partnerkonto an?")).toContain("Ein Partnerkonto musst du nicht mehr eigens anlegen.");
    const stats = HELP_TOPICS.find((topic) => topic.id === "integrationen-statistik")!.answer; expect(stats).toContain("Seit Version 383 erscheint jeder solche Käufer von selbst"); expect(stats).not.toContain("Einstellungen → Integrationen → „Plattformen“");
    const api = HELP_TOPICS.find((topic) => topic.id === "integrationen")!.answer; expect(api).toContain("Ein Käufer wird nur noch bei ihm selbst eingerichtet (seit Version 383)"); expect(api).not.toContain("Response-Mapping");
  });
});

describe("Wortwahl: Die Seite heißt „Integrationen“ (im Dashboard) – nicht mehr „Statistik“", () => {
  it("die neuen Bausteine nennen den Ort „Dashboard“; „Statistik“ steht nur noch in der Adresse", () => {
    for (const name of ["BuyerFeedback.tsx", "PartnerAccountsPanel.tsx", "IntegrationTab.tsx"]) expect(component(name).replace(/page=Statistik/g, ""), name).not.toMatch(/Statistik/);
    expect(component("BuyerFeedback.tsx")).toContain("Im Dashboard ansehen"); expect(component("PartnerAccountsPanel.tsx")).toContain("Im Dashboard ansehen");
    expect(component("BuyerFeedback.tsx")).toContain("Dann steht das im Dashboard unter „Integrationen“");
    // wer noch nach der „Statistik“ fragt, bekommt trotzdem die richtige Antwort – mit dem heutigen Namen
    for (const question of ["Warum fehlt mein Käufer im Dashboard?", "Warum fehlt mein Käufer in der Statistik?"]) expect(helpAnswer(question), question).toContain("Fehlt ein Käufer im Dashboard? Seit Version 383 erscheint jeder Käufer mit Schnittstelle von selbst unter Dashboard → „Integrationen“");
  });
});
