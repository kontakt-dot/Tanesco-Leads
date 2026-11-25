import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { getStore, resetStore } from "../backend";
import { nameInitials } from "../../../../shared/lead-age";

/**
 * Version 366 – Menü: API-Fehler unter „Analyse“, „Bestellungen“ öffnet die Bestellübersicht (neu gestaltet: Zahlen oben, Lieferbalken,
 * Status-Streifen, „startet am …“). Leads: Die Kacheln folgen dem Zeitraum („Gestern“), der Zeitraum steht schmal in der Werkzeugzeile,
 * unten Seitenknöpfe, die Tabelle mit Kreis in der Kategoriefarbe und der Frische des Leads.
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
const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((node) => (node.textContent ?? "").trim());
const button = (root: ParentNode, label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent?.trim() === label);
type Row = Record<string, any>;
const table = (name: string) => (getStore().tables as unknown as Record<string, Row[]>)[name];
const localDay = (value: Date | string | number) => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const salesLeads = () => table("leads").filter((lead) => (lead.kind ?? "verkauf") === "verkauf");

describe("Version 366", () => {
  beforeEach(() => { cleanup(); resetStore(); try { localStorage.removeItem("tanesco-lead-hidden-columns"); } catch { /* egal */ } });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); });

  it("Menü: „Bestellungen“ öffnet die Bestellübersicht – Zahlen oben, Kopfzeile, je Bestellung Balken und Status; „Bearbeiten“ öffnet den Editor", async () => {
    const root = await open("page=Bestellungen", 2600);
    expect(root.querySelector(".order-overview")).toBeTruthy(); expect(root.querySelector(".order-main")).toBeNull();
    expect(button(root, "Bestellübersicht")).toBeUndefined(); expect(Array.from(root.querySelectorAll("button")).some((node) => node.textContent?.includes("Bestellung anlegen"))).toBe(true);
    // Zahlen über alle Bestellungen
    const orders = table("orders");
    expect(texts(root, ".order-kpis dt")).toEqual(["Aktiv", "Geliefert", "Noch offen", "Wert geliefert"]);
    expect(root.querySelector(".order-kpis .is-active b")!.textContent).toBe(String(orders.filter((order) => order.status === "aktiv").length));
    expect(texts(root, ".order-stream-head span").filter(Boolean)).toEqual(["Bestellung", "Käufer und Lieferant", "Kategorie", "Lieferstatus", "Preis & Wert", "Status"]);
    // eine Bestellung mit Menge: Balken und Prozent passen zusammen; Streifen in der Farbe des Status
    const limited = orders.find((order) => order.quantity && order.status === "aktiv")!;
    const row = Array.from(root.querySelectorAll<HTMLElement>(".order-stream-row")).find((node) => node.textContent?.includes(limited.orderNumber))!;
    const percent = Math.min(100, Math.round((limited.deliveredCount / limited.quantity) * 100));
    expect(row.classList.contains("is-aktiv")).toBe(true); expect(row.querySelector(".order-progress-line em")!.textContent).toBe(`${percent} %`);
    expect(row.querySelector<HTMLElement>(".order-bar i")!.style.width).toBe(`${percent}%`); expect(row.querySelector(".order-bar")!.getAttribute("aria-valuenow")).toBe(String(percent));
    expect(row.querySelector(".order-avatar")!.textContent).toBe(nameInitials(limited.buyerName));
    // Bearbeiten → Editor; dort führt „Bestellübersicht“ zurück
    cleanup();
    const editor = await open(`page=Bestellungen&orderId=${limited.id}`, 2600);
    expect(editor.querySelector(".order-main")).toBeTruthy(); expect(editor.querySelector(".order-overview")).toBeNull();
    await click(button(editor, "Bestellübersicht"), 1200); expect(editor.querySelector(".order-overview")).toBeTruthy();
    // Menü: API-Fehler steht unter „Analyse“
    const analyse = Array.from(editor.querySelectorAll(".nav-group")).find((node) => node.querySelector(".nav-group-label")?.textContent === "ANALYSE")!;
    expect(texts(analyse, ".nav-item > span")).toContain("API-Fehler");
  }, 40_000);

  it("Bestellübersicht: Startet eine Bestellung erst später, steht „startet am …“ am Namen; inaktiv hat einen anderen Streifen", async () => {
    const order = table("orders").find((row) => row.status === "aktiv")!; const config = table("orderOperationalConfigs").find((row) => row.orderId === order.id)!;
    const start = new Date(); start.setDate(start.getDate() + 5); start.setHours(0, 0, 0, 0); config.startsAt = start;
    const other = table("orders").find((row) => row.id !== order.id && row.status === "aktiv")!; other.status = "pausiert";
    const root = await open("page=Bestellungen", 2600);
    const rowOf = (number: string) => Array.from(root.querySelectorAll<HTMLElement>(".order-stream-row")).find((node) => node.textContent?.includes(number))!;
    expect(rowOf(order.orderNumber).querySelector(".order-flag.is-later")!.textContent).toBe(`startet am ${start.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}`);
    expect(rowOf(other.orderNumber).classList.contains("is-pausiert")).toBe(true); expect(rowOf(other.orderNumber).querySelector<HTMLSelectElement>("select")!.value).toBe("pausiert");
  }, 30_000);

  it("Leads: Bei „Gestern“ heißt die Kachel „Gestern“, die anderen zählen nur die Leads von gestern – ein Klick behält den Zeitraum", async () => {
    const root = await open("page=Leads", 2200);
    const period = root.querySelector<HTMLSelectElement>('select[aria-label="Zeitraum auswählen"]')!;
    await change(period, "yesterday", 1500);
    const now = new Date(); const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1); const before = new Date(now); before.setDate(now.getDate() - 2);
    const ofDay = (day: Date) => salesLeads().filter((lead) => localDay(lead.createdAt) === localDay(day));
    const tiles = () => Array.from(root.querySelectorAll<HTMLButtonElement>(".lo-tile"));
    expect(texts(root, ".lo-tile .lo-label")).toEqual(["Leads gesamt", "Gestern", "Bereit zum Ausliefern", "Ausgeliefert", "Reklamiert"]);
    expect(tiles()[0].querySelector("strong")!.textContent).toBe(String(salesLeads().length)); // „Leads gesamt“ bleibt alle
    expect(tiles()[1].querySelector("strong")!.textContent).toBe(String(ofDay(yesterday).length)); expect(tiles()[1].classList.contains("is-active")).toBe(true);
    const diff = ofDay(yesterday).length - ofDay(before).length;
    expect(tiles()[1].querySelector(".lo-insight")!.textContent).toBe(diff > 0 ? `${diff} mehr als vorgestern` : diff < 0 ? `${-diff} weniger als vorgestern` : ofDay(yesterday).length ? "so viele wie vorgestern" : "wie vorgestern");
    const ready = ofDay(yesterday).filter((lead) => lead.status === "genehmigt").length; const delivered = ofDay(yesterday).filter((lead) => lead.status === "zugewiesen").length;
    expect(tiles()[2].querySelector("strong")!.textContent).toBe(String(ready)); expect(tiles()[3].querySelector("strong")!.textContent).toBe(String(delivered));
    if (ready) expect(tiles()[2].querySelector(".lo-insight")!.textContent).toBe("von gestern");
    // Klick auf „Bereit zum Ausliefern“: der Zeitraum bleibt, die Tabelle zeigt genau diese Zahl
    await click(tiles()[2], 1200);
    expect(root.querySelector<HTMLSelectElement>('select[aria-label="Zeitraum auswählen"]')!.value).toBe("yesterday"); expect(root.querySelector(".lt-tabs button.active")!.firstChild!.textContent).toBe("Freigegeben");
    expect(Number(root.querySelector(".lt-foot-count b")!.textContent)).toBe(ready); expect(tiles()[2].classList.contains("is-active")).toBe(true);
    // „Leads gesamt“ nimmt den Zeitraum wieder weg – die Kacheln sind wie vorher
    await click(tiles()[0], 1200); expect(root.querySelector<HTMLSelectElement>('select[aria-label="Zeitraum auswählen"]')!.value).toBe("");
    expect(texts(root, ".lo-tile .lo-label")[1]).toBe("Heute neu");
  }, 40_000);

  it("Leads: Zeitraum schmal in der Werkzeugzeile; unten Seitenknöpfe; Tabelle mit Kreis und Frische", async () => {
    const root = await open("page=Leads", 2200);
    // „Erstellt zwischen …“: die Tagesfelder stehen in der Zeile, keine eigene Karte darunter
    await change(root.querySelector('select[aria-label="Zeitraum auswählen"]'), "custom", 600);
    const custom = root.querySelector<HTMLElement>(".lt-custom")!; expect(custom.closest(".lt-toolbar")).toBeTruthy(); expect(custom.getAttribute("title")).toBe("Leads, die zwischen diesen Tagen kamen – beide Tage zählen mit.");
    expect(custom.querySelectorAll('input[type="date"]')).toHaveLength(2);
    await change(root.querySelector('select[aria-label="Zeitraum auswählen"]'), "", 900); expect(root.querySelector(".lt-custom")).toBeNull();
    // Leiste unten: gefunden, welche auf dieser Seite, Seitenknöpfe
    const total = salesLeads().length; const pages = Math.ceil(total / 25);
    expect(root.querySelector(".lt-foot-count")!.textContent).toBe(`${total} Leads gefunden`); expect(root.querySelector(".lt-foot-range")!.textContent).toBe("1–25 auf dieser Seite");
    expect(texts(root, ".lt-pager .lt-page")).toEqual(Array.from({ length: Math.min(pages, 7) }, (_, index) => String(index + 1)));
    expect(root.querySelector(".lt-page.is-current")!.getAttribute("aria-current")).toBe("page"); expect(root.querySelector<HTMLButtonElement>('.lt-page-step[aria-label="Vorige Seite"]')!.disabled).toBe(true);
    const firstOnPage1 = root.querySelector(".lt-row")!.getAttribute("data-lead");
    await click(root.querySelector('.lt-page[aria-label="Seite 2"]'), 1000);
    expect(root.querySelector(".lt-page.is-current")!.textContent).toBe("2"); expect(root.querySelector(".lt-foot-range")!.textContent).toBe(`26–${Math.min(50, total)} auf dieser Seite`); expect(root.querySelector(".lt-row")!.getAttribute("data-lead")).not.toBe(firstOnPage1);
    await click(root.querySelector('.lt-page-step[aria-label="Vorige Seite"]'), 1000); expect(root.querySelector(".lt-page.is-current")!.textContent).toBe("1");
    // Tabelle: Kreis mit dem Kürzel des Namens, Ankunft als „vor … Min.“ / „Heute …“ mit dem ganzen Zeitpunkt im Hinweis
    const rows = Array.from(root.querySelectorAll<HTMLElement>(".lt-row")).slice(0, 10);
    for (const row of rows) {
      const name = row.querySelector(".lt-name strong")!.textContent ?? ""; expect(row.querySelector(".lt-avatar")!.textContent).toBe(nameInitials(name));
      const age = row.querySelector<HTMLElement>(".lt-delivered .lt-age")!; expect(age.getAttribute("title")).toMatch(/^Vom Lieferanten angekommen: \w+, \d{2}\.\d{2}\.\d{4} um \d{2}:\d{2} Uhr$/);
      expect(row.style.getPropertyValue("--cat")).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // Leads aus dem Ausland tragen die Flagge, deutsche nicht
    const abroad = salesLeads().filter((lead) => lead.country && lead.country !== "DE").map((lead) => lead.publicId);
    for (const row of Array.from(root.querySelectorAll<HTMLElement>(".lt-row"))) expect(Boolean(row.querySelector(".lt-flag"))).toBe(abroad.includes(row.getAttribute("data-lead")!));
  }, 40_000);
});
