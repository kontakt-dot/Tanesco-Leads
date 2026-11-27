import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { getStore, resetStore } from "../backend";

/** Version 387 – Auslieferung: Bestellungen untereinander (Liste) oder als Kacheln wie bei den Benutzern; die Wahl wird gemerkt. */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 500) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const until = async (check: () => boolean, max = 15_000) => { const start = Date.now(); while (!check() && Date.now() - start < max) await settle(250); };
const KEY = "tanesco-order-view";
type Order = { id: number; orderNumber: string; name: string | null; status: string; buyerName: string };

describe("Version 387", () => {
  beforeEach(() => { cleanup(); resetStore(); try { localStorage.removeItem(KEY); } catch { /* egal */ } });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); try { localStorage.removeItem(KEY); } catch { /* egal */ } });

  it("Liste ist der Anfang; „Kacheln“ zeigt jede Bestellung als Karte mit Käufer, Lieferstand, Preis, Wert, Lieferkette, Status – und wird gemerkt", async () => {
    window.history.replaceState(null, "", "/?page=Bestellungen&overview=1"); let root = mount().container;
    await until(() => root.querySelectorAll(".order-stream-row").length > 0);
    const orders = (getStore().tables.orders as unknown as Order[]);
    const view = root.querySelector('[aria-label="Ansicht der Bestellungen"]')!; const [list, cards] = Array.from(view.querySelectorAll("button"));
    expect([list.textContent, cards.textContent]).toEqual(["Liste", "Kacheln"]); expect(list.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector(".order-toolbar-count")!.textContent).toBe(`${orders.length} Bestellungen`);
    expect(root.querySelectorAll(".order-stream-row")).toHaveLength(orders.length); expect(root.querySelector(".order-cards")).toBeNull();

    await click(cards, 600);
    expect(cards.getAttribute("aria-pressed")).toBe("true"); expect(localStorage.getItem(KEY)).toBe("kacheln");
    const tiles = Array.from(root.querySelectorAll<HTMLElement>(".order-cards .order-card")); expect(tiles).toHaveLength(orders.length);
    expect(root.querySelector(".order-stream-head")).toBeNull(); expect(root.querySelectorAll(".order-stream-row")).toHaveLength(0);
    const first = orders.find((order) => tiles[0].textContent!.includes(order.orderNumber))!; const tile = tiles[0];
    expect(tile.querySelector(".order-card-title b")!.textContent).toBe(first.name || first.orderNumber); expect(tile.querySelector(".order-card-title small")!.textContent).toBe(first.buyerName);
    expect(Array.from(tile.querySelectorAll(".order-card-facts dt")).map((node) => node.textContent)).toEqual(["Preis", "Wert", "Lieferkette"]);
    expect(tile.querySelector(".order-card-main")!.getAttribute("href")).toContain(`orderId=${first.id}`); expect(tile.querySelector(".order-card-route")!.getAttribute("href")).toContain("kette=1");
    expect(tile.querySelector(".order-bar")).toBeTruthy(); expect(tile.className).toMatch(/^order-card is-(aktiv|pausiert|erfüllt|storniert)$/); expect(tile.className).toBe(`order-card is-${tile.querySelector<HTMLSelectElement>(".order-card-foot select")!.value}`);

    // Status direkt in der Kachel umstellen
    const select = tile.querySelector<HTMLSelectElement>(".order-card-foot select")!; const next = select.value === "aktiv" ? "pausiert" : "aktiv";
    await act(async () => { fireEvent.change(select, { target: { value: next } }); }); await until(() => (getStore().tables.orders as unknown as Order[]).find((order) => order.id === first.id)!.status === next);
    expect((getStore().tables.orders as unknown as Order[]).find((order) => order.id === first.id)!.status).toBe(next);

    // nach dem Neuladen bleibt die Wahl
    cleanup(); window.history.replaceState(null, "", "/?page=Bestellungen&overview=1"); root = mount().container;
    await until(() => root.querySelectorAll(".order-card").length > 0); expect(root.querySelectorAll(".order-card")).toHaveLength(orders.length);
    await click(root.querySelector('[aria-label="Ansicht der Bestellungen"] button'), 500); expect(localStorage.getItem(KEY)).toBe("liste"); expect(root.querySelectorAll(".order-stream-row")).toHaveLength(orders.length);
  }, 60_000);
});
