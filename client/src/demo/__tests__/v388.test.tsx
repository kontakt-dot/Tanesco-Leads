import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { getStore, resetStore } from "../backend";

/** Version 388 – Benutzer → Ansicht mit den echten Bereichen; Leads: Lead-Kategorie in der Leiste, Sortierung unter „Filter“. */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 500) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const change = async (node: Element | null | undefined, value: string, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.change(node!, { target: { value } }); }); await settle(wait); };
const until = async (check: () => boolean, max = 15_000) => { const start = Date.now(); while (!check() && Date.now() - start < max) await settle(250); };
type Settings = { membershipId: number; visibleAreas: unknown };

describe("Version 388", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); });

  it("Benutzer → Ansicht: nur die Seiten des Kundenbereichs; Dashboard, Leads und Einstellungen gesperrt; Abwählen wird gespeichert", async () => {
    window.history.replaceState(null, "", "/?page=Benutzer&member=2&tab=ansicht"); const root = mount().container;
    await until(() => root.querySelectorAll(".va-areas li").length > 0);
    const items = () => Array.from(root.querySelectorAll<HTMLLIElement>(".va-areas li"));
    expect(items().map((item) => item.querySelector("b")!.textContent)).toEqual(["Dashboard", "Leads", "Bestellungen", "Reklamationen", "Integrationen", "Support", "Einstellungen"]);
    expect(root.textContent).not.toContain("App-Download-Logos"); expect(root.textContent).not.toContain("Marktplatz");
    expect(items().filter((item) => item.querySelector<HTMLInputElement>("input")!.disabled).map((item) => item.querySelector("b")!.textContent)).toEqual(["Dashboard", "Leads", "Einstellungen"]);
    expect(root.querySelector(".va-note")!.textContent).toContain("„Lead-Import“ (Leads hochladen) gibt es nur bei Lieferanten-Zugängen");
    const support = items().find((item) => item.querySelector("b")!.textContent === "Support")!;
    await click(support.querySelector("input"), 200); expect(support.className).toBe("is-off");
    await click(Array.from(root.querySelectorAll("button")).find((button) => button.textContent === "Speichern"), 900);
    const saved = (getStore().tables.memberOperationalSettings as unknown as Settings[]).find((row) => row.membershipId === 2)!;
    expect(saved.visibleAreas).toEqual(["Bestellungen", "Reklamationen", "Lead-Import", "Integrationen"]);
  }, 60_000);

  it("Leads: in der Leiste „Alle Lead-Kategorien“ statt „Neueste zuerst“ – wählt die Kategorie; sortieren unter „Filter“", async () => {
    window.history.replaceState(null, "", "/?page=Leads"); const root = mount().container;
    await until(() => root.querySelectorAll(".lt-row").length > 0);
    const pick = root.querySelector<HTMLSelectElement>('select[aria-label="Lead-Kategorie wählen"]')!;
    expect(pick.options[0].textContent).toBe("Alle Lead-Kategorien"); expect(root.querySelector(".lt-panel select[aria-label='Leadliste sortieren']")?.closest(".lt-filters")).toBeFalsy();
    const before = Number((root.querySelector(".lt-tabs button")?.textContent ?? "").replace(/\D/g, ""));
    const option = Array.from(pick.options).find((item) => item.textContent === "Photovoltaik")!; await change(pick, option.value, 1200);
    const rows = Array.from(root.querySelectorAll(".lt-row")); expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => (row.textContent ?? "").includes("Photovoltaik"))).toBe(true);
    expect(Number((root.querySelector(".lt-tabs button")?.textContent ?? "").replace(/\D/g, ""))).toBeLessThan(before);
    await click(Array.from(root.querySelectorAll("button")).find((button) => button.textContent?.trim().startsWith("Filter")), 500);
    const panel = root.querySelector<HTMLElement>('.lt-filters[aria-label="Erweiterte Filter"]')!;
    const sort = panel.querySelector<HTMLSelectElement>('select[aria-label="Leadliste sortieren"]')!; expect(sort.closest("label")!.querySelector("span")!.textContent).toBe("Sortierung");
    expect(Array.from(sort.options).map((item) => item.textContent)).toEqual(["Neueste zuerst", "Preis: hoch nach niedrig", "Preis: niedrig nach hoch", "Auslieferung: neueste zuerst", "Auslieferung: älteste zuerst"]);
    expect(panel.querySelector<HTMLSelectElement>('select[aria-label="Kategorie filtern"]')!.value).toBe(option.value); // beide zeigen dieselbe Kategorie
  }, 60_000);
});
