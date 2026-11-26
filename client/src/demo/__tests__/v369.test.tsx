import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { resetStore } from "../backend";

/**
 * Version 369 – Gebietskarte neu gestaltet: Kennzahlen als Leiste, die Karte als Bühne mit Kategorie oben, Verkaufs-Stufen als
 * Legende (zugleich Filter), Kunden unten, Hof um Überschneidungen, Hinweis beim Überfahren. Dazu: Emoji der Kategorie in der Leads-Tabelle.
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 400) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const open = async (query: string, wait = 2600) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };

describe("Version 369", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); resetStore(); });

  it("Gebietskarte: Leiste, Stufen als Legende und Filter, Kategorie oben, Hof um Überschneidungen, Hinweis beim Überfahren", async () => {
    const root = await open("page=Gebietskarte");
    const dots = () => Array.from(root.querySelectorAll<SVGCircleElement>(".gk-map .territory-dot"));
    const level = (key: string) => root.querySelector<HTMLButtonElement>(`.gk-level[data-level="${key}"]`)!;
    // Leiste: vier Kennzahlen, „Abgedeckt“ mit Anteil an allen PLZ
    expect(Array.from(root.querySelectorAll(".gk-stat-label")).map((node) => node.textContent)).toEqual(["Kunden", "Abgedeckt", "Überschneidungen", "Mehrfach verkaufbar"]);
    expect(root.querySelectorAll(".gk-stat")[1].textContent).toMatch(/\d+ % von [\d.]+ PLZ in Deutschland/);
    // Legende: vier Stufen mit Zahl – die Zahlen passen zu den Punkten auf der Karte
    const count = (key: string) => Number(level(key).querySelector("b")!.textContent!.replace(/\D/g, ""));
    for (const key of ["1", "2", "3", "4"]) expect(count(key), key).toBe(dots().filter((dot) => dot.getAttribute("data-level") === key).length);
    expect(count("3")).toBeGreaterThan(0);
    // Hof nur um hervorgehobene Überschneidungen
    expect(root.querySelectorAll(".gk-halo").length).toBe(dots().filter((dot) => Number(dot.getAttribute("data-level")) >= 2 && dot.getAttribute("data-on") === "1").length);
    // Stufe 2 aus: ihre Punkte werden blass (bleiben aber da), der Hof verschwindet dort
    const total = dots().length; await click(level("2"));
    expect(level("2").getAttribute("aria-pressed")).toBe("false"); expect(dots().length).toBe(total);
    expect(dots().filter((dot) => dot.getAttribute("data-level") === "2").every((dot) => dot.getAttribute("data-on") === "0")).toBe(true);
    expect(root.querySelectorAll(".gk-halo.is-l2").length).toBe(0); expect(root.querySelector(".gk-legend small")!.textContent).toContain("Hervorgehoben");
    // „Alle Stufen“ holt alles zurück; Doppelklick zeigt nur eine Stufe
    await click(Array.from(root.querySelectorAll(".gk-legend .gk-link")).find((node) => node.textContent === "Alle Stufen"));
    expect(dots().every((dot) => dot.getAttribute("data-on") === "1")).toBe(true);
    await act(async () => { fireEvent.doubleClick(level("3")); }); await settle(300);
    expect(["1", "2", "3", "4"].map((key) => level(key).getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false"]);
    await click(Array.from(root.querySelectorAll(".gk-legend .gk-link")).find((node) => node.textContent === "Alle Stufen"));
    // Kategorie oben: Wärmepumpe zeigt nur deren Kunden – unten bleiben die Kunden der Kategorie
    const seg = (text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>(".gk-seg button")).find((node) => node.textContent === text)!;
    expect(seg("Alle Kategorien").getAttribute("aria-pressed")).toBe("true");
    await click(seg("Wärmepumpe"), 600);
    expect(seg("Wärmepumpe").getAttribute("aria-pressed")).toBe("true"); expect(dots().length).toBeLessThan(total); expect(root.querySelectorAll(".gk-halo").length).toBe(0); // nur ein WP-Kunde: keine Überschneidung
    await click(seg("Alle Kategorien"), 600); expect(dots().length).toBe(total);
    // Hinweis beim Überfahren: PLZ, Ort, Gebiet mit Bundesland ausgeschrieben, Kunden und wie oft der Lead verkaufbar ist
    const hot = dots().find((dot) => dot.getAttribute("data-level") === "3")!;
    await act(async () => { fireEvent.mouseOver(hot); fireEvent.mouseEnter(hot); }); await settle(200);
    const tip = root.querySelector(".gk-tip")!; expect(tip).toBeTruthy();
    expect(tip.querySelector(".gk-tip-head b")!.textContent).toMatch(/^\d{5}$/); expect(tip.textContent).toMatch(/PLZ-Gebiet \d\d · [A-ZÄÖÜ][a-zäöüß]+/); expect(tip.textContent).not.toMatch(/ · [A-Z]{2}$/m);
    expect(tip.querySelectorAll("li").length).toBeGreaterThanOrEqual(3); expect(tip.querySelector(".gk-tip-verdict")!.textContent).toContain("3× verkaufbar");
    await act(async () => { fireEvent.mouseLeave(root.querySelector(".gk-canvas")!); }); await settle(100); expect(root.querySelector(".gk-tip")).toBeNull();
    // Überschneidungen rechts: Farbpunkte der Kunden, Stufe und PLZ; ein Klick zeigt die PLZ
    const combo = root.querySelector<HTMLButtonElement>(".gk-combo")!; expect(combo.querySelectorAll(".gk-combo-who i").length).toBeGreaterThanOrEqual(2); expect(combo.querySelector(".gk-combo-times")!.textContent).toMatch(/^\d×$/);
    await click(combo); expect(root.querySelectorAll(".gk-combo-plz span").length).toBeGreaterThan(0);
  }, 40_000);

  it("Leads-Tabelle: das Emoji der Kategorie steht vor dem Namen", async () => {
    const root = await open("page=Leads", 2200);
    const cells = Array.from(root.querySelectorAll(".lt-row[data-lead] .lt-cat"));
    expect(cells.length).toBeGreaterThan(0);
    const pv = cells.find((cell) => cell.querySelector(".lt-cat-name")!.textContent === "Photovoltaik")!; // der Name bleibt ohne Emoji (Hinweis und Sortierung)
    expect(pv.querySelector(".lt-cat-emoji")!.textContent).toBe("☀️"); expect(pv.querySelector(".lt-cat-emoji")!.getAttribute("aria-hidden")).toBe("true");
    const wp = cells.find((cell) => cell.querySelector(".lt-cat-name")!.textContent!.endsWith("Wärmepumpe"));
    if (wp) expect(wp.querySelector(".lt-cat-emoji")!.textContent).toBe("♨️");
  }, 30_000);
});
