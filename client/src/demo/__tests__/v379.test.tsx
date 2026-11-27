import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";
import { orderRoutes, routeSentence } from "../../../../shared/order-route";

/**
 * Version 379 – Auslieferung: Die Bestellübersicht zeigt je Bestellung ihre Lieferkette (wohin die Leads gehen). In der „Lieferkette der
 * Bestellung“ legt man fest, für welche Leadsparten die Kette gilt – für alle gemeinsam oder für einzelne; was man ändert, bekommen alle
 * angehakten Sparten.
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
async function until(check: () => boolean, tries = 40) { for (let index = 0; index < tries && !check(); index += 1) await settle(150); }
const click = async (node: Element | null | undefined, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const open = async (query: string, wait = 2600) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((node) => (node.textContent ?? "").trim());
const button = (root: ParentNode, text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((node) => (node.textContent ?? "").includes(text));
type Row = Record<string, any>;
const table = (name: string) => (getStore().tables as unknown as Record<string, Row[]>)[name];
const stopsOf = (chainId: number) => table("deliveryStops").filter((row) => row.chainId === chainId).sort((a, b) => Number(a.position) - Number(b.position));
const cards = (root: Element) => Array.from(root.querySelectorAll<HTMLElement>(".lk-track > .lk-stop"));
const chipsOf = (root: Element) => Array.from(root.querySelectorAll<HTMLButtonElement>(".lk-sparten-chips .lk-sparte"));
const chip = (root: Element, name: string) => chipsOf(root).find((node) => node.textContent === name)!;
const pressed = (root: Element) => chipsOf(root).map((node) => `${node.textContent}:${node.getAttribute("aria-pressed") === "true" ? "an" : "aus"}`);
const confirmOk = async () => { await until(() => Boolean(document.querySelector(".app-confirm-ok"))); await click(document.querySelector(".app-confirm-ok"), 900); };
/** Die Bestellung „Aroundhome“ der Vorschau: zwei Leadsparten (Photovoltaik, Wärmepumpe), jede Kette hat nur Station 1. */
const aroundhome = () => { const chain = table("deliveryChains").find((row) => row.name === "Aroundhome Haustür")!; const order = table("orders").find((row) => row.id === chain.orderId)!; const sibling = table("deliveryChains").find((row) => row.orderId === order.id && row.id !== chain.id)!; return { chain, order, sibling }; };
/** Beträge ohne geschütztes Leerzeichen – so lassen sie sich mit getipptem Text vergleichen. */
const plain = (text: string) => text.replace(/\u00a0/g, " ");
const rowOf = (root: Element, orderNumber: string) => Array.from(root.querySelectorAll<HTMLElement>(".order-stream-row")).find((node) => node.textContent?.includes(orderNumber))!;
const routeLines = (row: Element) => Array.from(row.querySelectorAll<HTMLElement>(".order-route-line")).map((line) => ({ cats: line.querySelector(".order-route-cats")?.textContent ?? "", stops: texts(line, ".order-route-chip b"), prices: texts(line, ".order-route-chip small").map(plain), end: line.querySelector(".order-route-end span")!.textContent, title: line.getAttribute("title") }));

describe("Version 379", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); cleanup(); resetStore(); });

  it("Bestellübersicht: Unter jeder Bestellung steht ihre Lieferkette – Station 1 ist die Bestellung, danach die weiteren Stationen und was am Ende passiert", async () => {
    const root = await open("page=Bestellungen&overview=1"); await until(() => root.querySelectorAll(".order-route").length > 0);
    const orders = table("orders"); expect(root.querySelectorAll(".order-stream-row").length).toBe(orders.length); expect(root.querySelectorAll(".order-stream-row .order-route").length).toBe(orders.length); // jede Bestellung zeigt ihren Weg
    // eine Bestellung mit drei Stationen
    const chain = table("deliveryChains").find((row) => row.id === 1)!; const order = orders.find((row) => row.id === chain.orderId)!; const stops = stopsOf(chain.id); expect(stops.length).toBe(3);
    const line = routeLines(rowOf(root, order.orderNumber)); expect(line).toHaveLength(1);
    expect(line[0].stops).toEqual(stops.map((stop) => String(stop.buyerName))); expect(line[0].prices).toEqual(stops.map((stop) => plain(Number(stop.unitPrice).toLocaleString("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(Number(stop.unitPrice)) ? 0 : 2, maximumFractionDigits: 2 }))));
    expect(line[0].end).toBe("sonst frei für deine anderen Ketten und Bestellungen"); expect(line[0].cats).toBe(""); // eine Sparte: kein Name nötig
    expect(line[0].title).toBe(`Jeder Lead geht zuerst an ${stops[0].buyerName}. Nimmt ${stops[0].buyerName} ihn nicht, geht er an ${stops[1].buyerName}, danach an ${stops[2].buyerName}. Nimmt ihn keine Station, ist er frei für deine anderen Ketten und Bestellungen.`);
    const row = rowOf(root, order.orderNumber); expect(row.querySelector(".order-route-stop.is-order b")!.textContent).toBe(String(stops[0].buyerName)); expect(row.querySelectorAll(".order-route-stop.is-order").length).toBe(1);
    expect(row.querySelector<HTMLAnchorElement>(".order-route-edit")!.getAttribute("href")).toBe(`/?page=Bestellungen&orderId=${order.id}&kette=1`); expect(row.querySelector(".order-route-edit")!.textContent).toBe("Kette bearbeiten");
    // zwei Sparten mit demselben Weg stehen zusammen: „Alle Sparten“
    const { order: two, chain: pv, sibling } = aroundhome(); const both = routeLines(rowOf(root, two.orderNumber)); expect(both).toHaveLength(1); expect(both[0].cats).toBe("Alle Sparten"); expect(both[0].stops).toEqual(["Aroundhome GmbH"]);
    expect(both[0].title).toBe("Jeder Lead geht an Aroundhome GmbH. Nimmt Aroundhome GmbH ihn nicht, ist er frei für deine anderen Ketten und Bestellungen – es gibt keine weitere Station.");
    // dieselbe Rechnung wie in shared/order-route.ts
    const routes = orderRoutes(table("deliveryChains").filter((row) => row.orderId === two.id).map((row) => ({ id: row.id, categoryId: row.categoryId, status: row.status, exhaustedAction: row.exhaustedAction ?? null, stops: stopsOf(row.id) as never })), [pv.categoryId, sibling.categoryId]); expect(routes).toHaveLength(1); expect(routeSentence(routes[0])).toBe(both[0].title);
  }, 40_000);

  it("Bestellübersicht: Haben die Sparten verschiedene Ketten, steht je Weg eine Zeile mit den Namen der Sparten; ausgeschaltete Stationen sind durchgestrichen", async () => {
    const { order, chain, sibling } = aroundhome(); const buyer = table("users").find((row) => row.company && row.company !== "Aroundhome GmbH")!;
    const added = await callProcedure("leadops.addChainStop", { chainId: sibling.id, buyerUserId: buyer.id, unitPrice: 19.5 }) as { stopId: number }; await callProcedure("leadops.addChainStop", { chainId: sibling.id, buyerName: "Nachrücker GmbH", unitPrice: 12 });
    await callProcedure("leadops.updateChainStop", { id: added.stopId, active: false });
    const root = await open("page=Bestellungen&overview=1"); await until(() => root.querySelectorAll(".order-route").length > 0);
    const lines = routeLines(rowOf(root, order.orderNumber)); expect(lines).toHaveLength(2);
    const names = (categoryId: number) => String(table("leadCategories").find((row) => row.id === categoryId)!.name);
    expect(lines.map((line) => line.cats)).toEqual([names(chain.categoryId), names(sibling.categoryId)]); expect(lines[0].stops).toEqual(["Aroundhome GmbH"]); expect(lines[1].stops).toEqual(["Aroundhome GmbH", String(buyer.company), "Nachrücker GmbH"]);
    expect(lines[1].prices).toEqual(["35 €", "19,50 € · aus", "12 €"]); expect(rowOf(root, order.orderNumber).querySelectorAll(".order-route-stop.is-off").length).toBe(1);
    expect(lines[1].title).toBe("Jeder Lead geht zuerst an Aroundhome GmbH. Nimmt Aroundhome GmbH ihn nicht, geht er an Nachrücker GmbH. Nimmt ihn keine Station, ist er frei für deine anderen Ketten und Bestellungen."); // die ausgeschaltete Station wird übersprungen
  }, 40_000);

  it("„Kette bearbeiten“ öffnet die Bestellung gleich bei der Lieferkette", async () => {
    const { order } = aroundhome(); const root = await open(`page=Bestellungen&orderId=${order.id}&kette=1`); await until(() => cards(root).length > 0);
    expect(root.querySelector(".lk-embed-head h2")!.textContent).toBe("Lieferkette der Bestellung"); expect(root.querySelector(".order-steps button.active")!.textContent).toContain("Lieferkette"); expect(root.querySelector(".lk-sparten-head b")!.textContent).toBe("Für welche Sparten gilt diese Kette?");
  }, 40_000);

  it("Alle Sparten gemeinsam: Haben sie dieselbe Kette, sind alle angehakt – eine neue Station, ein Schalter und das Löschen gelten für alle", async () => {
    const { order, chain, sibling } = aroundhome(); const root = await open(`page=Bestellungen&orderId=${order.id}&kette=1`); await until(() => cards(root).length > 0);
    expect(pressed(root)).toEqual(["Alle 2 Sparten:an", "Photovoltaik:an", "Wärmepumpe:an"]); expect(root.querySelector(".lk-sparten-head span")!.textContent).toBe("Was du unten festlegst, gilt für Photovoltaik und Wärmepumpe."); expect(root.querySelector(".lk-sparten-apart")).toBeNull();
    expect(root.querySelector(".lk-from b")!.textContent).toBe("Photovoltaik, Wärmepumpe"); expect(root.querySelector(".lk-sentence")!.textContent).toContain("Leads aus Photovoltaik und Wärmepumpe von");
    // Station hinzufügen: steht in beiden Ketten
    await click(root.querySelector(".lk-add-btn")); const form = root.querySelector<HTMLFormElement>(".lk-add-form")!; const buyerUserId = Number(form.querySelector("select")!.value);
    expect(form.querySelector(".lk-add-all")!.textContent).toBe("Die Station kommt in die Ketten von Photovoltaik und Wärmepumpe – wie oben angehakt.");
    await act(async () => { fireEvent.change(form.querySelector<HTMLInputElement>(".lk-add-price input")!, { target: { value: "27" } }); }); await click(button(form, "Station hinzufügen"), 900);
    await until(() => stopsOf(sibling.id).length === 2); for (const id of [chain.id, sibling.id]) expect(stopsOf(id).map((row) => [row.position, row.buyerUserId, Number(row.unitPrice), row.active !== false])).toEqual([[1, stopsOf(id)[0].buyerUserId, 35, true], [2, buyerUserId, 27, true]]);
    expect(pressed(root)).toEqual(["Alle 2 Sparten:an", "Photovoltaik:an", "Wärmepumpe:an"]);
    // ausschalten: in beiden
    await until(() => cards(root).length === 2); await click(cards(root)[1].querySelector('button[role="switch"]'), 900); await until(() => stopsOf(sibling.id)[1].active === false);
    expect(stopsOf(chain.id)[1].active).toBe(false); expect(stopsOf(sibling.id)[1].active).toBe(false);
    // löschen: in beiden – Station 1 bleibt
    await click(cards(root)[1].querySelector(".lk-stop-delete"), 300); await confirmOk(); await until(() => stopsOf(sibling.id).length === 1);
    for (const id of [chain.id, sibling.id]) expect(stopsOf(id).map((row) => [row.position, Boolean(row.orderStop)])).toEqual([[1, true]]);
  }, 60_000);

  it("Einzelne Sparte: abgewählt folgt sie den Änderungen nicht mehr – dazunehmen ersetzt ihre Kette erst nach einer Nachfrage", async () => {
    const { order, chain, sibling } = aroundhome(); const root = await open(`page=Bestellungen&orderId=${order.id}&kette=1`); await until(() => cards(root).length > 0);
    await click(chip(root, "Wärmepumpe"), 400);
    expect(pressed(root)).toEqual(["Alle 2 Sparten:aus", "Photovoltaik:an", "Wärmepumpe:aus"]); expect(root.querySelector(".lk-sparten-head span")!.textContent).toBe("Was du unten festlegst, gilt nur für Photovoltaik.");
    expect(texts(root, ".lk-sparten-apart li")).toEqual(["Wärmepumpehat dieselben Stationen, folgt den Änderungen hier aber nichtKette von Wärmepumpe ansehen"]); expect(root.querySelector(".lk-from b")!.textContent).toBe("Photovoltaik");
    // neue Station: nur in Photovoltaik
    await click(root.querySelector(".lk-add-btn")); const form = root.querySelector<HTMLFormElement>(".lk-add-form")!; expect(form.querySelector(".lk-add-all")).toBeNull(); const buyerUserId = Number(form.querySelector("select")!.value);
    await act(async () => { fireEvent.change(form.querySelector<HTMLInputElement>(".lk-add-price input")!, { target: { value: "21,5" } }); }); await click(button(form, "Station hinzufügen"), 1200);
    expect(stopsOf(chain.id)).toHaveLength(2); expect(stopsOf(sibling.id)).toHaveLength(1); await until(() => (root.querySelector(".lk-sparten-apart li span")?.textContent ?? "").startsWith("eigene Kette"));
    expect(root.querySelector(".lk-sparten-apart li span")!.textContent).toBe("eigene Kette: keine weitere Station");
    // wieder dazunehmen: Nachfrage – „Abbrechen“ ändert nichts
    const company = String(table("users").find((row) => row.id === buyerUserId)!.company ?? table("users").find((row) => row.id === buyerUserId)!.name);
    await click(chip(root, "Wärmepumpe"), 300); expect(document.querySelector(".app-confirm-text")!.textContent).toBe(`Wärmepumpe bekommt dieselbe Kette wie Photovoltaik (nach Station 1: ${company}). Übernehmen?`);
    await click(document.querySelector(".app-confirm-cancel"), 500); expect(stopsOf(sibling.id)).toHaveLength(1); expect(pressed(root)).toEqual(["Alle 2 Sparten:aus", "Photovoltaik:an", "Wärmepumpe:aus"]);
    // „Alle 2 Sparten“: nach der Nachfrage hat Wärmepumpe dieselbe Kette
    await click(chip(root, "Alle 2 Sparten"), 300); await confirmOk(); await until(() => stopsOf(sibling.id).length === 2);
    expect(stopsOf(sibling.id).map((row) => [row.position, row.buyerUserId, Number(row.unitPrice)])).toEqual([[1, stopsOf(sibling.id)[0].buyerUserId, 35], [2, buyerUserId, 21.5]]);
    await until(() => pressed(root).every((item) => item.endsWith(":an"))); expect(pressed(root)).toEqual(["Alle 2 Sparten:an", "Photovoltaik:an", "Wärmepumpe:an"]); expect(root.querySelector(".lk-sparten-apart")).toBeNull();
    // „Alle“ noch einmal: nur noch die gezeigte Sparte
    await click(chip(root, "Alle 2 Sparten"), 400); expect(pressed(root)).toEqual(["Alle 2 Sparten:aus", "Photovoltaik:an", "Wärmepumpe:aus"]); expect(stopsOf(sibling.id)).toHaveLength(2); // abwählen ändert an der Kette nichts
  }, 60_000);

  it("Eine Sparte mit eigener Kette lässt sich ansehen – dort gilt zunächst nur sie; ihre Kette ersetzt die andere erst nach einer Nachfrage", async () => {
    const { order, chain, sibling } = aroundhome(); await callProcedure("leadops.addChainStop", { chainId: sibling.id, buyerName: "Eigener Abnehmer GmbH", unitPrice: 18 });
    const root = await open(`page=Bestellungen&orderId=${order.id}&kette=1`); await until(() => cards(root).length > 0);
    // die Ketten sind verschieden: Nur die gezeigte Sparte ist angehakt, die andere steht mit ihrem Weg darunter
    expect(pressed(root)).toEqual(["Alle 2 Sparten:aus", "Photovoltaik:an", "Wärmepumpe:aus"]); expect(root.querySelector(".lk-sparten-apart li span")!.textContent).toBe("eigene Kette: nach Station 1 → Eigener Abnehmer GmbH");
    await click(button(root, "Kette von Wärmepumpe ansehen"), 1200); await until(() => cards(root).length === 2);
    expect(pressed(root)).toEqual(["Alle 2 Sparten:aus", "Wärmepumpe:an", "Photovoltaik:aus"]); expect(root.querySelector(".lk-sparten-head span")!.textContent).toBe("Was du unten festlegst, gilt nur für Wärmepumpe."); expect(root.querySelector(".lk-sparten-apart li span")!.textContent).toBe("eigene Kette: keine weitere Station");
    // Photovoltaik dazunehmen: Die Nachfrage nennt, was ersetzt wird – hier nichts, denn Photovoltaik hat keine weitere Station
    await click(chip(root, "Photovoltaik"), 300); expect(document.querySelector(".app-confirm-text")!.textContent).toBe("Photovoltaik bekommt dieselbe Kette wie Wärmepumpe (nach Station 1: Eigener Abnehmer GmbH). Übernehmen?");
    await confirmOk(); await until(() => stopsOf(chain.id).length === 2); expect(stopsOf(chain.id).map((row) => [row.position, String(row.buyerName), Number(row.unitPrice)])).toEqual([[1, "Aroundhome GmbH", 35], [2, "Eigener Abnehmer GmbH", 18]]);
  }, 60_000);

  it("Übernehmen ersetzt eigene Stationen – die Nachfrage nennt sie; gleiche Käufer behalten ihre Station", async () => {
    const { chain, sibling } = aroundhome();
    await callProcedure("leadops.addChainStop", { chainId: chain.id, buyerName: "Gemeinsam GmbH", unitPrice: 20 }); await callProcedure("leadops.addChainStop", { chainId: chain.id, buyerName: "Nur Solar GmbH", unitPrice: 15 });
    const kept = await callProcedure("leadops.addChainStop", { chainId: sibling.id, buyerName: "gemeinsam gmbh", unitPrice: 9 }) as { stopId: number }; const gone = await callProcedure("leadops.addChainStop", { chainId: sibling.id, buyerName: "Nur Wärme GmbH", unitPrice: 8 }) as { stopId: number };
    const root = await open(`page=Lieferkette&chain=${chain.id}`); await until(() => cards(root).length === 3);
    expect(root.querySelector(".lk-sparten-apart li span")!.textContent).toBe("eigene Kette: nach Station 1 → gemeinsam gmbh → Nur Wärme GmbH");
    await click(chip(root, "Wärmepumpe"), 300); expect(document.querySelector(".app-confirm-text")!.textContent).toBe("Wärmepumpe bekommt dieselbe Kette wie Photovoltaik (nach Station 1: Gemeinsam GmbH → Nur Solar GmbH). Die bisherigen Stationen von Wärmepumpe (gemeinsam gmbh → Nur Wärme GmbH) werden ersetzt. Übernehmen?");
    await confirmOk(); await until(() => stopsOf(sibling.id).some((row) => row.buyerName === "Nur Solar GmbH"));
    expect(stopsOf(sibling.id).map((row) => [row.position, String(row.buyerName), Number(row.unitPrice)])).toEqual([[1, "Aroundhome GmbH", 35], [2, "Gemeinsam GmbH", 20], [3, "Nur Solar GmbH", 15]]);
    expect(stopsOf(sibling.id)[1].id).toBe(kept.stopId); expect(table("deliveryStops").some((row) => row.id === gone.stopId)).toBe(false); // derselbe Käufer: dieselbe Station (ihre Zahlen bleiben) – die andere ist weg
    const detail = await callProcedure("leadops.chainDetail", { chainId: chain.id, range: "maximal" }) as { order: { chains: Array<{ chainId: number; same: boolean; route: string[] }> } }; expect(detail.order.chains.map((item) => [item.same, item.route])).toEqual([[true, ["Gemeinsam GmbH", "Nur Solar GmbH"]], [true, ["Gemeinsam GmbH", "Nur Solar GmbH"]]]);
  }, 60_000);
});
