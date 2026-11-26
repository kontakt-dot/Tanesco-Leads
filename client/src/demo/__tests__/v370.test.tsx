import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { getStore, resetStore } from "../backend";

/**
 * Version 370 – Lieferkette und Verträge neu gestaltet: Kennzahlen-Leiste, Kategorie-Kopf mit Emoji, Balken je Kette, leerer Zustand
 * mit Bild und drei Schritten, Detailseite mit Kunden der Reihe nach (Preis mit Komma); Verträge mit Ring „unterschrieben“ und Zeichen je Station.
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 400) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const open = async (query: string, wait = 2400) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
type Row = Record<string, any>;
const table = (name: string) => (getStore().tables as unknown as Record<string, Row[]>)[name];

describe("Version 370", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); resetStore(); });

  it("Lieferkette: Leiste mit Ketten, Kunden, Geschickt und Angenommen; Kopf je Kategorie mit Emoji; Balken nur für vorhandene Zahlen", async () => {
    const root = await open("page=Lieferkette");
    const stats = Array.from(root.querySelectorAll(".lk-rail .lk-stat"));
    expect(stats.map((node) => node.querySelector(".lk-stat-label")!.textContent)).toEqual(["Ketten", "Kunden in Ketten", "Geschickt", "Angenommen"]);
    const chains = Array.from(root.querySelectorAll<HTMLElement>(".lk-chain")); expect(chains.length).toBeGreaterThan(3);
    const active = chains.filter((node) => node.querySelector(".lk-status")!.textContent === "Aktiv").length;
    expect(stats[0].querySelector("strong")!.textContent).toBe(`${active}von ${chains.length} aktiv`);
    // Geschickt / angenommen = Summe der Zeilen
    const numbers = (node: Element) => Array.from(node.querySelectorAll(".lk-stats-line b")).map((item) => Number(item.textContent));
    const sent = chains.reduce((sum, node) => sum + numbers(node)[0], 0); const accepted = chains.reduce((sum, node) => sum + numbers(node)[1], 0);
    expect(Number(stats[2].querySelector("strong")!.textContent!.replace(/\D/g, ""))).toBe(sent);
    expect(stats[3].querySelector("strong")!.textContent).toContain(String(accepted));
    // Kopf je Kategorie: Emoji vor dem Namen (der Name selbst bleibt ohne Emoji)
    const pv = Array.from(root.querySelectorAll<HTMLElement>("section.lk-panel")).find((node) => node.querySelector("h2")?.textContent === "Photovoltaik")!;
    expect(pv.querySelector(".lk-group-badge")!.textContent).toBe("☀️"); expect(pv.getAttribute("style")).toContain("--cat");
    // Balken: nur Teile für Zahlen über 0
    for (const node of chains) { const [total, yes, no] = numbers(node); const meter = node.querySelector(".lk-meter")!;
      expect(meter.querySelectorAll("i.is-good").length, node.textContent!).toBe(yes > 0 ? 1 : 0); expect(meter.querySelectorAll("i.is-bad").length).toBe(no > 0 ? 1 : 0);
      if (!total) expect(meter.querySelector("i.is-none")).toBeTruthy(); }
  }, 30_000);

  it("Lieferkette: ohne Kette ein Bild mit drei Schritten – „Erste Lieferkette anlegen“ öffnet das Anlegen", async () => {
    table("deliveryChains").splice(0);
    const root = await open("page=Lieferkette");
    const welcome = root.querySelector(".lk-welcome")!; expect(welcome).toBeTruthy(); expect(root.querySelector(".lk-rail")).toBeNull();
    expect(welcome.querySelector("h2")!.textContent).toBe("Noch keine Lieferkette");
    expect(Array.from(welcome.querySelectorAll(".lk-welcome-steps b")).map((node) => node.textContent)).toEqual(["Kategorie wählen", "Lieferanten festlegen", "Kunden der Reihe nach"]);
    await click(Array.from(welcome.querySelectorAll("button")).find((node) => node.textContent?.includes("Erste Lieferkette anlegen")));
    expect(root.querySelector(".lk-builder")).toBeTruthy(); expect(root.querySelector(".lk-welcome")).toBeNull();
  }, 30_000);

  it("Lieferkette, Detail: Stationen der Reihe nach mit Platz, Zahlen und Preis mit Komma – „44,50“ wird 44,5 €; Station 1 einer Bestellung zeigt ihren Preis fest (v376)", async () => {
    const root = await open("page=Lieferkette&chain=1");
    const stops = Array.from(root.querySelectorAll<HTMLElement>(".lk-stop")); expect(stops.length).toBeGreaterThan(1);
    expect(stops.map((node) => node.querySelector(".lk-stop-pos")!.textContent)).toEqual(stops.map((_, index) => String(index + 1)));
    const first = stops[0]; expect(first.querySelectorAll(".lk-stop-stat")).toHaveLength(3);
    // Kette 1 gehört zu einer Bestellung: Station 1 ist die Bestellung – ihr Preis steht fest und wird in der Bestellung geändert
    expect(first.classList.contains("is-order")).toBe(true); expect(first.querySelector(".lk-stop-fixed")!.textContent).toMatch(/^\d+,\d{2} €$/);
    const second = stops[1]; const price = second.querySelector<HTMLInputElement>('.lk-stop-edit input')!; expect(price.value).toMatch(/^\d+,\d{2}$/);
    const stopRow = table("deliveryStops").filter((row) => row.chainId === 1).sort((a, b) => Number(a.position) - Number(b.position))[1]; expect(stopRow).toBeTruthy(); const stopId = Number(stopRow.id);
    await act(async () => { fireEvent.focus(price); fireEvent.change(price, { target: { value: "44,50" } }); fireEvent.blur(price); }); await settle(700);
    expect(Number(table("deliveryStops").find((row) => row.id === stopId)!.unitPrice)).toBe(44.5);
    expect(root.querySelectorAll<HTMLElement>(".lk-stop")[1].querySelector<HTMLInputElement>(".lk-stop-edit input")!.value).toBe("44,50");
    // Einstellungen aufklappen: Name ist der Knopf
    await click(second.querySelector(".lk-stop-name")); expect(second.classList.contains("is-open")).toBe(true);
  }, 30_000);

  it("Verträge: Ring „unterschrieben“ mit Anteil der gesendeten, Zeichen je Station", async () => {
    const root = await open("page=Verträge", 2200);
    const stand = root.querySelector(".vt-stand")!; expect(stand.querySelector(".vt-stand-icon svg")).toBeTruthy();
    const stations = Array.from(stand.querySelectorAll(".vt-station")); expect(stations).toHaveLength(5);
    expect(stations.every((node) => node.querySelector(".vt-station-icon"))).toBe(true);
    const count = (node: Element) => Number(node.querySelector("strong")!.textContent);
    const sent = count(stations[0]); const signed = count(stations[4]);
    const ring = stand.querySelector<HTMLElement>(".vt-stand-rate")!; expect(ring.querySelector("b")!.textContent).toBe(`${Math.round((signed / sent) * 100)} %`); expect(ring.getAttribute("style")).toContain(`--rate: ${Math.round((signed / sent) * 100)}%`);
  }, 30_000);
});
