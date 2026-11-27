import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";

/**
 * Version 391 – „Was heißt Takt einmal am Tag – es muss immer Echtzeit sein“ und „Wenn ich eine Leadsparte ändere, kann ich das nicht
 * speichern – füg einen Speichern-Knopf ein“.
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
const cards = (root: Element) => Array.from(root.querySelectorAll<HTMLElement>(".lk-track > .lk-stop"));
const chipsOf = (root: Element) => Array.from(root.querySelectorAll<HTMLButtonElement>(".lk-sparten-chips .lk-sparte"));
const chip = (root: Element, name: string) => chipsOf(root).find((node) => node.textContent === name)!;
const pressed = (root: Element) => chipsOf(root).map((node) => `${node.textContent}:${node.getAttribute("aria-pressed") === "true" ? "an" : "aus"}`);
const saveBar = (root: Element) => root.querySelector<HTMLElement>(".lk-sparten-save")!;
/** Die Bestellung „Aroundhome“ der Vorschau: zwei Leadsparten (Photovoltaik, Wärmepumpe), jede Kette hat nur Station 1. */
const aroundhome = () => { const chain = table("deliveryChains").find((row) => row.name === "Aroundhome Haustür")!; const order = table("orders").find((row) => row.id === chain.orderId)!; const sibling = table("deliveryChains").find((row) => row.orderId === order.id && row.id !== chain.id)!; return { chain, order, sibling }; };

describe("Version 391", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); cleanup(); resetStore(); });

  it("Takt: Die Bestellung liefert immer in Echtzeit – kein Lieferintervall, kein Schalter; Station 1 der Kette sagt „in Echtzeit“", async () => {
    // alle Bestellungen der Vorschau liefern in Echtzeit (wie nach der Umstellung am Server)
    expect(table("orderOperationalConfigs").every((row) => row.realtimeDelivery === true && row.deliveryInterval === "sofort")).toBe(true);
    const { order } = aroundhome(); const root = await open(`page=Bestellungen&orderId=${order.id}`); await until(() => Boolean(root.querySelector(".of-summary")));
    expect(Array.from(root.querySelectorAll(".order-form-field")).some((node) => node.textContent?.startsWith("Lieferintervall"))).toBe(false); expect(root.textContent).not.toContain("Echtzeit-Lieferung");
    expect(root.querySelector(".of-realtime")!.textContent).toBe("In Echtzeit"); expect(root.querySelector(".of-realtime")!.closest(".order-form-field")!.textContent).toContain("Jeder passende Lead geht sofort nach der Freigabe raus");
    const takt = Array.from(root.querySelectorAll(".of-summary dl > div")).find((node) => node.querySelector("dt")?.textContent === "Takt")!; expect(takt.querySelector("dd")!.textContent).toMatch(/^in Echtzeit · /);
    expect(texts(root, ".of-card > header p")).toContain("Was ein Lead kostet und wie viele es werden sollen. Geliefert wird immer in Echtzeit.");
    // speichern: Echtzeit bleibt – auch wenn vorher „täglich“ gespeichert war
    const config = table("orderOperationalConfigs").find((row) => row.orderId === order.id)!; config.deliveryInterval = "täglich"; config.realtimeDelivery = false;
    await click(button(root, "Bestellung speichern"), 1500); expect(table("orderOperationalConfigs").find((row) => row.orderId === order.id)).toMatchObject({ deliveryInterval: "sofort", realtimeDelivery: true });
    // Schritt „Lieferkette“: Station 1 zeigt Takt „in Echtzeit“ (bis v390: „einmal am Tag“)
    await until(() => cards(root).length > 0); const facts = Object.fromEntries(Array.from(cards(root)[0].querySelectorAll(".lk-facts > div")).map((node) => [node.querySelector("dt")!.textContent, node.querySelector("dd")!.textContent]));
    expect(facts.Takt).toBe("in Echtzeit"); expect(root.textContent).not.toContain("einmal am Tag");
  }, 60_000);

  it("Die Bestellübersicht nennt „in Echtzeit“ statt eines Lieferintervalls", async () => {
    const root = await open("page=Bestellungen&overview=1"); await until(() => root.querySelectorAll(".order-progress-foot").length > 0);
    const feet = texts(root, ".order-progress-foot"); expect(feet.length).toBeGreaterThan(0); for (const foot of feet) expect(foot).toMatch(/ · in Echtzeit$/);
    expect(feet.join(" ")).not.toMatch(/täglich|wöchentlich|monatlich/);
  }, 40_000);

  it("Leadsparten: Anhaken ist ein Entwurf – „Speichern“ übernimmt die Auswahl, und sie bleibt nach dem Neuladen", async () => {
    const { order, chain, sibling } = aroundhome(); let root = await open(`page=Bestellungen&orderId=${order.id}&kette=1`); await until(() => cards(root).length > 0);
    expect(pressed(root)).toEqual(["Alle 2 Sparten:an", "Photovoltaik:an", "Wärmepumpe:an"]); expect(saveBar(root).classList.contains("is-saved")).toBe(true);
    expect(button(saveBar(root), "Speichern")!.disabled).toBe(true); expect(saveBar(root).textContent).toContain("Gespeichert"); // nichts geändert: nichts zu speichern
    // Wärmepumpe abwählen: noch nicht gespeichert
    await click(chip(root, "Wärmepumpe"), 300); expect(pressed(root)).toEqual(["Alle 2 Sparten:aus", "Photovoltaik:an", "Wärmepumpe:aus"]);
    expect(saveBar(root).classList.contains("is-dirty")).toBe(true); expect(saveBar(root).querySelector("[role=status]")!.textContent).toBe("Noch nicht gespeichert – erst mit „Speichern“ gilt die Auswahl.");
    expect(button(saveBar(root), "Speichern")!.disabled).toBe(false); expect(button(saveBar(root), "Verwerfen")).toBeTruthy();
    // ohne Speichern neu laden: Die alte Auswahl ist wieder da (das war der Fehler – jetzt sieht man, dass noch nicht gespeichert ist)
    cleanup(); root = await open(`page=Bestellungen&orderId=${order.id}&kette=1`); await until(() => cards(root).length > 0);
    expect(pressed(root)).toEqual(["Alle 2 Sparten:an", "Photovoltaik:an", "Wärmepumpe:an"]);
    // abwählen und speichern
    await click(chip(root, "Wärmepumpe"), 300); await click(button(saveBar(root), "Speichern"), 900); await until(() => saveBar(root).classList.contains("is-saved"));
    expect(document.querySelector(".app-confirm-text")).toBeNull(); expect(texts(root, ".lk-sparten-apart li b")).toEqual(["Wärmepumpe"]);
    expect(table("deliveryChains").find((row) => row.id === chain.id)!.linkGroup).toBe(chain.id); expect(table("deliveryChains").find((row) => row.id === sibling.id)!.linkGroup).toBe(sibling.id);
    // neu laden: Die Auswahl bleibt – obwohl beide Sparten dieselben Stationen haben
    cleanup(); root = await open(`page=Bestellungen&orderId=${order.id}&kette=1`); await until(() => cards(root).length > 0);
    expect(pressed(root)).toEqual(["Alle 2 Sparten:aus", "Photovoltaik:an", "Wärmepumpe:aus"]); expect(saveBar(root).classList.contains("is-saved")).toBe(true);
    expect(root.querySelector(".lk-sparten-apart li span")!.textContent).toBe("hat dieselben Stationen, folgt den Änderungen hier aber nicht");
    // eine neue Station gilt jetzt nur für Photovoltaik
    await callProcedure("leadops.addChainStop", { chainId: chain.id, buyerName: "Nur Solar GmbH", unitPrice: 14 });
    expect(table("deliveryStops").filter((row) => row.chainId === sibling.id)).toHaveLength(1);
    // wieder dazunehmen und speichern: Nachfrage, dann hat Wärmepumpe dieselbe Kette – und bleibt verbunden
    cleanup(); root = await open(`page=Bestellungen&orderId=${order.id}&kette=1`); await until(() => cards(root).length === 2);
    await click(chip(root, "Alle 2 Sparten"), 300); await click(button(saveBar(root), "Speichern"), 300);
    expect(document.querySelector(".app-confirm-text")!.textContent).toBe("Wärmepumpe bekommt dieselbe Kette wie Photovoltaik (nach Station 1: Nur Solar GmbH). Speichern?");
    await until(() => Boolean(document.querySelector(".app-confirm-ok"))); await click(document.querySelector(".app-confirm-ok"), 1200);
    await until(() => table("deliveryStops").filter((row) => row.chainId === sibling.id).length === 2); await until(() => saveBar(root).classList.contains("is-saved"));
    cleanup(); root = await open(`page=Bestellungen&orderId=${order.id}&kette=1`); await until(() => cards(root).length === 2);
    expect(pressed(root)).toEqual(["Alle 2 Sparten:an", "Photovoltaik:an", "Wärmepumpe:an"]); expect(root.querySelector(".lk-sparten-apart")).toBeNull();
    expect(new Set(table("deliveryChains").filter((row) => row.orderId === order.id).map((row) => row.linkGroup))).toEqual(new Set([Math.min(chain.id, sibling.id)]));
  }, 90_000);

  it("„Verwerfen“ nimmt die Änderung zurück – gespeichert wird nichts", async () => {
    const { order, sibling } = aroundhome(); const root = await open(`page=Bestellungen&orderId=${order.id}&kette=1`); await until(() => cards(root).length > 0);
    await click(chip(root, "Wärmepumpe"), 300); await click(button(saveBar(root), "Verwerfen"), 300);
    expect(pressed(root)).toEqual(["Alle 2 Sparten:an", "Photovoltaik:an", "Wärmepumpe:an"]); expect(saveBar(root).classList.contains("is-saved")).toBe(true);
    expect(table("deliveryChains").find((row) => row.id === sibling.id)!.linkGroup ?? null).toBeNull();
  }, 40_000);
});
