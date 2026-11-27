import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeOrderStation, ORDER_TAKT } from "../shared/order-chain";
import { chainLinkGroups, chainLinksSaved, relinkChains } from "../shared/order-route";
import { helpAnswer } from "../shared/help-knowledge";
import { NACHHOLEN_NACH_MS, NACHHOLEN_TAGE } from "./delivery-scheduler";

/**
 * Version 391 – zwei Wünsche vom 27.11.2026:
 *  1. „Was heißt Takt einmal am Tag – es muss immer Echtzeit sein.“ Die Karte der Station 1 zeigte das Lieferintervall („täglich“ war
 *     vorausgewählt), auch wenn die Bestellung längst sofort lieferte. Jetzt liefert jede Bestellung in Echtzeit – ohne Auswahl.
 *  2. „Wenn ich eine Leadsparte ändere, kann ich das nicht speichern.“ Die Auswahl „Für welche Sparten gilt diese Kette?“ lebte nur im
 *     Browser und war nach dem Neuladen weg. Jetzt gibt es „Speichern“, und die Auswahl bleibt.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const groupsOf = (map: Map<number, number>) => Object.fromEntries(Array.from(map.entries()).sort((a, b) => a[0] - b[0]));

describe("1. Takt: immer in Echtzeit", () => {
  const station = (deliveryInterval: string) => describeOrderStation({ order: { id: 7, orderNumber: "ORD-7", name: "PV", status: "aktiv", buyerName: "Station 1 GmbH", unitPrice: "45.00", quantity: null, deliveredCount: 0 }, config: { deliveryInterval, deliveryDays: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"], startsAt: new Date("2026-12-22T11:00:00Z"), ongoing: true }, mainCategoryId: 1, supplierName: () => "Dialer", categoryName: () => "Photovoltaik" });
  it("die Karte der Station 1 sagt „in Echtzeit“ – auch bei Bestellungen, die noch „täglich“ gespeichert haben", () => {
    for (const interval of ["täglich", "wöchentlich", "monatlich", "sofort"]) expect(station(interval).facts.find((fact) => fact.key === "takt"), interval).toEqual({ key: "takt", label: "Takt", value: "in Echtzeit" });
    expect(ORDER_TAKT).toBe("in Echtzeit"); expect(JSON.stringify(station("täglich").facts)).not.toContain("einmal am Tag");
    expect(station("täglich").facts.find((fact) => fact.key === "start")!.value).toBe("22.12.2026"); // der Start steht weiter da – vorher geht kein Lead raus
  });
  it("das Bestellformular hat kein Lieferintervall und keinen Echtzeit-Schalter mehr – es zeigt fest „In Echtzeit“", () => {
    const form = read("../client/src/components/OrderWorkspace.tsx");
    expect(form).not.toMatch(/Lieferintervall<select/); expect(form).not.toContain("<strong>Echtzeit-Lieferung</strong>"); expect(form).not.toContain('deliveryInterval: "täglich"');
    expect(form).toContain('<span className="of-realtime" role="status"><Zap aria-hidden="true" />In Echtzeit</span>'); expect(form).toContain("<dt>Takt</dt><dd><b>in Echtzeit</b>");
    expect(read("../client/src/components/OrderOverview.tsx")).toContain('const interval = "in Echtzeit"'); expect(read("../client/src/components/MemberDetail.tsx")).toContain("<dt>Auslieferung</dt><dd>in Echtzeit</dd>");
  });
  it("der Server speichert immer Echtzeit, die Automatisierung liefert nach dem Zuordnen immer gleich, der Zeitplaner kennt kein Tagesfenster mehr", () => {
    const routers = read("./routers.ts"); expect(routers).toContain('deliveryInterval: "sofort" as const, requestedQuantity: input.quantity ?? 0, compensateClaims: input.compensateClaims, priority: input.priority, realtimeDelivery: true');
    expect(routers).toMatch(/assignLeadsToOrder[\s\S]{0,2200}deliverLeadNow\(db, \{ tenantId: tenant\.id, actorUserId: ctx\.user\.id, lead: fresh, preferOrderId: order\.id \}\)/);
    const pipeline = read("./lead-pipeline.ts"); expect(pipeline).not.toContain("config?.realtimeDelivery");
    const scheduler = read("./delivery-scheduler.ts"); expect(scheduler).not.toMatch(/intervalWindowOpen\(config/); expect(scheduler).not.toContain("config.realtimeDelivery"); expect(NACHHOLEN_NACH_MS).toBe(120_000); expect(NACHHOLEN_TAGE).toBe(14);
  });
  it("die Migration stellt alle Bestellungen um und setzt den Standard auf „sofort“", () => {
    const sql = read("../drizzle/0127_echtzeit_spartengruppen.sql");
    expect(sql).toContain("UPDATE `orderOperationalConfigs` SET `realtimeDelivery` = true, `deliveryInterval` = 'sofort';"); expect(sql).toContain("NOT NULL DEFAULT 'sofort'"); expect(sql).toContain("ALTER TABLE `deliveryChains` ADD `linkGroup` int;");
    const journal = JSON.parse(read("../drizzle/meta/_journal.json")) as { entries: Array<{ idx: number; tag: string }> }; expect(journal.entries.find((entry) => entry.tag === "0127_echtzeit_spartengruppen")).toMatchObject({ idx: 127 });
    expect(read("../drizzle/schema.ts")).toContain('.default("sofort").notNull(), requestedQuantity');
  });
  it("die Hilfe beantwortet „Was heißt Takt einmal am Tag?“", () => {
    for (const question of ["Was heißt Takt einmal am Tag?", "Liefert die Bestellung in Echtzeit?"]) expect(helpAnswer(question), question).toContain("immer in Echtzeit");
  });
});

describe("2. Sparten einer Kette: gespeichert und verbunden", () => {
  it("vor dem ersten Speichern: Ketten mit denselben Stationen gehören zusammen (wie bis v390)", () => {
    const groups = chainLinkGroups([{ id: 14, signature: "[]" }, { id: 9, signature: "[]" }, { id: 21, signature: '[["a"]]' }]);
    expect(groupsOf(groups)).toEqual({ 9: 9, 14: 9, 21: 21 }); expect(chainLinksSaved([{ id: 9 }, { id: 14, linkGroup: null }])).toBe(false);
  });
  it("gespeichert: nur das Gespeicherte zählt – eine neu dazugekommene Sparte steht allein, alte Nummern werden eindeutig", () => {
    const groups = chainLinkGroups([{ id: 9, linkGroup: 3, signature: "[]" }, { id: 14, linkGroup: 3, signature: "[]" }, { id: 21, linkGroup: null, signature: "[]" }]);
    expect(groupsOf(groups)).toEqual({ 9: 9, 14: 9, 21: 21 }); expect(chainLinksSaved([{ id: 9, linkGroup: 3 }])).toBe(true);
  });
  it("Speichern bildet die neue Gruppe – wer abgewählt wird, bleibt bei den übrigen; andere Gruppen bleiben, wie sie sind", () => {
    const chains = [{ id: 5, signature: "x" }, { id: 6, signature: "x" }, { id: 7, signature: "x" }, { id: 8, signature: "y" }];
    // gezeigt: 5, angehakt nur 8 → 5 und 8 zusammen; 6 und 7 hatten dieselben Stationen und bleiben zusammen
    expect(groupsOf(relinkChains(chains, 5, [8]))).toEqual({ 5: 5, 6: 6, 7: 6, 8: 5 });
    // gespeichert: aus 6 und 7 eine Gruppe nehmen – 7 alleine (6 gezeigt, nichts angehakt)
    const saved = [{ id: 5, linkGroup: 5 }, { id: 6, linkGroup: 6 }, { id: 7, linkGroup: 6 }, { id: 8, linkGroup: 5 }];
    expect(groupsOf(relinkChains(saved, 6, []))).toEqual({ 5: 5, 6: 6, 7: 7, 8: 5 });
    // die kleinste Nummer wechselt die Gruppe: 5 geht zu 7 – 8 bleibt (allein) mit neuer Nummer, nie mit der von 5
    expect(groupsOf(relinkChains(saved, 7, [5]))).toEqual({ 5: 5, 6: 6, 7: 5, 8: 8 });
    // alle angehakt: eine Gruppe
    expect(new Set(relinkChains(saved, 8, [5, 6, 7]).values())).toEqual(new Set([5]));
  });
  it("die Seite: Anhaken ist ein Entwurf, „Speichern“ übernimmt ihn, „Verwerfen“ nimmt ihn zurück", () => {
    const page = read("../client/src/components/ChainWorkspace.tsx");
    expect(page).toContain('<div className={`lk-sparten-save ${dirty ? "is-dirty" : "is-saved"}`}>'); expect(page).toContain("Noch nicht gespeichert – erst mit „Speichern“ gilt die Auswahl.");
    expect(page).toContain('onClick={() => setDraft(scopeIds)}>Verwerfen</button>'); expect(page).toContain("saveScope.mutateAsync({ chainId, linkedChainIds: next })");
    expect(page).toContain("info.linksSaved ? info.chains.filter((item) => item.linked)"); // nach dem Neuladen: das Gespeicherte
    expect(page).not.toContain("void take("); // kein sofortiges Übernehmen beim Anhaken mehr
  });
  it("Gestaltung: Speichern-Leiste mit grünem Haken oder gelbem Hinweis; gewählte Sparte grau statt zartrot; Rot nur im hellen Design", () => {
    const css = read("../client/src/bausteine.css"); const block = css.slice(css.indexOf("/* ───────── Version 391"));
    expect(block).toContain(".lk-sparten-save.is-saved>span{color:var(--lt-good)}"); expect(block).toContain(".lk-sparten-save.is-dirty>span{color:var(--fx-warn,#fcd34d)}");
    expect(block).toContain("html:not(.dark) .lk-sparten .lk-sparte.is-on{border-color:#bc001d;background:#f2f4f7;color:#bc001d}"); expect(block).not.toMatch(/#fff5f5|#fef3f2|#fee4e2/i); // keine zartrosa Flächen
    expect(block).toContain("html:not(.dark) .order-steps.surface-panel button.active{background:#f7f8fa!important;border-color:#d0d5dd!important}"); // gewählter Schritt grau
    const rules = block.replace(/\/\*[\s\S]*?\*\//g, "").split("}"); // ohne Kommentare
    for (const rule of rules.filter((item) => /#bc001d|#c4001f|#fb2c36/i.test(item))) expect(rule.trim(), rule).toMatch(/^html:not\(\.dark\)/);
    for (const rule of rules.filter((item) => /#7a70f5|#a39bff|#8278ff/i.test(item))) expect(rule.trim(), rule).toMatch(/^html\.dark/);
  });
  it("die Hilfe erklärt das Speichern der Sparten", () => {
    expect(helpAnswer("Wie kann ich die Leadsparten der Kette speichern?")).toContain("Seit Version 391 gilt die Auswahl erst mit „Speichern“");
  });
});
