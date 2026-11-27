import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { getStore, resetStore } from "../backend";
import { dashboardRange } from "@/lib/dashboardPeriod";

/**
 * Version 359 – Leads-Seite: ruhigere Leiste über der Tabelle (je Zahl eine Zeile, der Rest im Hinweis beim Überfahren; Hinweise bleiben),
 * Zeitraum mit „Gestern“, „Erstellt ab …“ und „Erstellt vor …“, Zeitraum und Erweiterte Filter im Stil der Leiste für ausgewählte Leads.
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 700) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const change = async (node: Element | null | undefined, value: string, wait = 900) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.change(node!, { target: { value } }); }); await settle(wait); };
const open = async (query: string, wait = 2000) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
type Lead = { id: number; status: string; kind?: string; createdAt: Date };
const salesLeads = () => (getStore().tables.leads as unknown as Lead[]).filter((lead) => (lead.kind ?? "verkauf") === "verkauf");
const localDay = (value: Date | string | number) => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const found = (root: ParentNode) => Number((root.querySelector(".lt-foot-count b")!.textContent ?? "").replace(/\./g, ""));
const period = (root: ParentNode) => root.querySelector<HTMLSelectElement>('select[aria-label="Zeitraum auswählen"]')!;

describe("Version 359", () => {
  beforeEach(() => { cleanup(); resetStore(); try { localStorage.removeItem("tanesco-lead-hints-hidden"); localStorage.removeItem("tanesco-lead-saved-views"); } catch { /* egal */ } });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); });

  it("Leiste über der Tabelle: je Zahl Name, Zahl und eine Zeile – der Rest im Hinweis; die Hinweise darunter bleiben", async () => {
    const root = await open("page=Leads");
    const tiles = Array.from(root.querySelectorAll<HTMLElement>(".lo-tile")); expect(tiles).toHaveLength(4); // seit v377 ohne „Reklamiert“
    for (const tile of tiles) { expect(Array.from(tile.children).map((child) => child.tagName.toLowerCase() + (child.className ? `.${String(child.className).split(" ")[0]}` : ""))).toEqual(["span.lo-label", "strong", "span.lo-insight"]); expect(tile.getAttribute("title")).toBeTruthy(); }
    expect(root.querySelector(".lo-split")).toBeNull(); expect(root.querySelector(".lo-tile small")).toBeNull();
    expect(root.querySelectorAll(".lo-bar")).toHaveLength(14);
    expect(root.querySelectorAll(".lo-hints .lo-hint").length).toBeGreaterThan(0); // Hinweise bleiben, wie sie waren
  });

  it("Zeitraum: Gestern, Erstellt ab …, Erstellt vor … – die Tabelle zeigt genau diese Leads", async () => {
    const root = await open("page=Leads"); const all = salesLeads();
    expect(Array.from(period(root).options).map((option) => option.textContent)).toEqual(["Gesamter Zeitraum", "Heute", "Gestern", "Diese Woche", "Letzte Woche", "Letzte 2 Wochen", "Dieser Monat", "Letzter Monat", "Erstellt zwischen …", "Erstellt ab …", "Erstellt vor …"]); // seit v364: „Letzter Monat“, „Erstellt zwischen …“ statt „Eigene Zeitspanne“
    // Gestern
    const yesterday = localDay(dashboardRange("yesterday", "", "").from);
    await change(period(root), "yesterday"); expect(found(root)).toBe(all.filter((lead) => localDay(lead.createdAt) === yesterday).length);
    // Erstellt ab …: ein Feld, die Tabelle zeigt alles ab diesem Tag
    const days = Array.from(new Set(all.map((lead) => localDay(lead.createdAt)))).sort(); const middle = days[Math.floor(days.length / 2)];
    await change(period(root), "since", 500);
    const custom = () => root.querySelector<HTMLElement>(".lt-custom")!; expect(custom().querySelectorAll(".lt-field")).toHaveLength(1); expect(custom().querySelector(".lt-field span")!.textContent).toBe("Erstellt ab");
    await change(custom().querySelector('input[aria-label="Erstellt ab Tag"]'), middle);
    expect(found(root)).toBe(all.filter((lead) => localDay(lead.createdAt) >= middle).length); expect(custom().querySelector(".lt-custom-note")!.textContent).toContain("bis heute");
    // Erstellt vor …: der Tag selbst zählt nicht mit
    await change(period(root), "before", 500); expect(custom().querySelector(".lt-field span")!.textContent).toBe("Erstellt vor");
    await change(custom().querySelector('input[aria-label="Erstellt vor Tag"]'), middle);
    expect(found(root)).toBe(all.filter((lead) => localDay(lead.createdAt) < middle).length);
    expect(root.querySelector<HTMLInputElement>('input[aria-label="Erstellt vor Tag"]')!.value).toBe(middle);
    expect(custom().querySelector(".lt-custom-note")!.textContent).toContain("dieser Tag zählt nicht mit");
    // zurück auf „Gesamter Zeitraum“: alle Leads, das Feld ist weg
    await change(period(root), ""); expect(found(root)).toBe(all.length); expect(root.querySelector(".lt-custom")).toBeNull();
  }, 40_000);

  it("Erweiterte Filter im Stil der Aktionsleiste: Felder mit Namen, Zurücksetzen und Schließen", async () => {
    const root = await open("page=Leads"); const all = salesLeads();
    await click(Array.from(root.querySelectorAll("button")).find((button) => button.textContent?.trim().startsWith("Filter")), 500);
    const panel = () => root.querySelector<HTMLElement>('.lt-filters[aria-label="Erweiterte Filter"]');
    expect(panel()).toBeTruthy(); expect(panel()!.querySelector(".lt-filters-head b")!.textContent).toBe("Erweiterte Filter");
    expect(Array.from(panel()!.querySelectorAll(".lt-field > span")).map((node) => node.textContent)).toEqual(["Kategorie", "Käufer", "Lieferant", "Zuordnung", "Sortierung", "Auslieferung", "Erstellt ab", "Erstellt bis", "Ausgeliefert ab", "Ausgeliefert bis"]); // v388: die Sortierung steht jetzt hier
    expect(panel()!.querySelectorAll(".lt-field-control")).toHaveLength(10);
    expect(Array.from(panel()!.querySelectorAll("button")).some((button) => button.textContent === "Alle zurücksetzen")).toBe(false); // nichts gesetzt
    const categories = Array.from(panel()!.querySelector<HTMLSelectElement>('select[aria-label="Kategorie filtern"]')!.options).filter((option) => option.value);
    const category = categories.find((option) => (getStore().tables.leads as unknown as Array<{ categoryId: number }>).some((lead) => String(lead.categoryId) === option.value))!;
    await change(panel()!.querySelector('select[aria-label="Kategorie filtern"]'), category.value);
    expect(found(root)).toBeLessThan(all.length);
    await click(Array.from(panel()!.querySelectorAll("button")).find((button) => button.textContent === "Alle zurücksetzen"));
    expect(found(root)).toBe(all.length);
    await click(panel()!.querySelector('button[aria-label="Erweiterte Filter schließen"]'), 300); expect(panel()).toBeNull();
  }, 30_000);
});
