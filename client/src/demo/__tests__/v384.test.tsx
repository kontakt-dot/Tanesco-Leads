import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { getStore, resetStore } from "../backend";

/** Version 384 – Leads → „Ausliefern“ → „An wen?“: automatisch über Bestellung und Lieferkette oder direkt an einen Kunden mit Schnittstelle. */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 500) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const type = async (node: Element | null | undefined, value: string, wait = 300) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.change(node!, { target: { value } }); }); await settle(wait); };
const until = async (check: () => boolean, max = 15_000) => { const start = Date.now(); while (!check() && Date.now() - start < max) await settle(250); };
type Lead = { id: number; publicId: string; status: string };
type Delivery = { leadId: number; buyerName: string; result: string; orderId: number | null };

describe("Version 384", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); });

  it("Ausliefern: „An wen?“ zeigt Automatisch und die Kunden mit Schnittstelle – direkt senden fragt nach und liefert ohne Bestellung", async () => {
    window.history.replaceState(null, "", "/?page=Leads"); const root = mount().container; await until(() => root.querySelectorAll(".lt-row").length > 0);
    const rows = Array.from(root.querySelectorAll<HTMLElement>(".lt-row"));
    const row = rows.find((item) => /Freigegeben|Neu/.test(item.textContent ?? "")) ?? rows[0];
    await click(row.querySelector(".lt-select input"), 200);
    const bar = root.querySelector<HTMLElement>(".lt-bulk")!; await type(bar.querySelector('select[aria-label="Lead-Aktion auswählen"]'), "deliver", 600);
    await until(() => (bar.querySelector<HTMLSelectElement>('select[aria-label="An wen ausliefern?"]')?.options.length ?? 0) > 1);
    const to = bar.querySelector<HTMLSelectElement>('select[aria-label="An wen ausliefern?"]')!;
    expect(to.options[0].textContent).toBe("Automatisch (Bestellung und Lieferkette)"); expect(to.querySelector("optgroup")!.getAttribute("label")).toBe("Direkt an einen Kunden senden");
    const names = Array.from(to.querySelectorAll("optgroup option")).map((option) => option.textContent); expect(names).toContain("Nordlicht Energie");
    const nordlicht = Array.from(to.querySelectorAll<HTMLOptionElement>("optgroup option")).find((option) => option.textContent === "Nordlicht Energie")!;
    const publicId = (row.querySelector(".lt-id")?.textContent ?? "").trim();
    const lead = (getStore().tables.leads as unknown as Lead[]).find((item) => publicId && publicId.includes(item.publicId)) ?? (getStore().tables.leads as unknown as Lead[]).find((item) => (row.textContent ?? "").includes(item.publicId))!;
    await type(to, nordlicht.value, 300);
    await click(Array.from(bar.querySelectorAll("button")).find((button) => button.textContent === "Ausführen"), 500);
    await until(() => Boolean(document.querySelector(".app-confirm-text")));
    expect(document.querySelector(".app-confirm-text")!.textContent).toBe("Diesen Lead jetzt direkt an Nordlicht Energie senden? Er geht echt über die Schnittstelle raus – ohne Bestellung.");
    expect(document.querySelector(".app-confirm-ok")!.textContent).toBe("Jetzt senden");
    await click(document.querySelector(".app-confirm-ok"), 1500);
    const deliveries = () => (getStore().tables.leadDeliveries as unknown as Delivery[]).filter((item) => item.leadId === lead.id && item.buyerName === "Nordlicht Energie");
    await until(() => deliveries().length > 0);
    expect(deliveries()[0]).toMatchObject({ result: "angenommen", orderId: null });
    expect((getStore().tables.leads as unknown as Lead[]).find((item) => item.id === lead.id)!.status).toBe("zugewiesen");
  }, 60_000);
});
