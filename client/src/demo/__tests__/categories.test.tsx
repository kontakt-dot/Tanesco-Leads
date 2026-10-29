import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { getStore, resetStore } from "../backend";
import { localDemoLink } from "../link";

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const picked = (root: HTMLElement) => Array.from(root.querySelectorAll(".cat-pick.is-on .cat-pick-name")).map((node) => node.textContent ?? "");
const chip = (root: HTMLElement, name: string) => Array.from(root.querySelectorAll<HTMLButtonElement>(".cat-pick")).find((node) => node.querySelector(".cat-pick-name")?.textContent === name)!;
const hint = (root: HTMLElement) => root.querySelector(".sparte-field small")?.textContent ?? "";
async function openEditor(root: HTMLElement, campaign: string) {
  const card = Array.from(root.querySelectorAll<HTMLElement>(".cl-card")).find((item) => item.querySelector(".cl-name")?.textContent?.includes(campaign))!;
  await act(async () => { fireEvent.click(card.querySelector<HTMLButtonElement>('button[aria-label="Bearbeiten"]')!); }); await settle(300); await settle(200);
}

describe("Lead-Kategorien in der Kampagne wählen – daraus kommt die Leadsparte", () => {
  beforeEach(() => { resetStore(); try { localStorage.removeItem("kampagnen-ordner"); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });

  it("vorausgewählt passend zur Sparte; Photovoltaik + Wärmepumpe gewählt → PV & WP, gespeichert mit den Kategorien", async () => {
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const view = mount(); await settle(300); await settle(300);
    await openEditor(view.container, "Alarmanlagen-Errichter NRW");
    const names = Array.from(view.container.querySelectorAll(".cat-pick .cat-pick-name")).map((node) => node.textContent);
    expect(names).toContain("Photovoltaik"); expect(names).not.toContain("Vorlage: PV Gewerbe"); // Kategorie-Vorlagen stehen nicht zur Wahl
    expect(picked(view.container)).toEqual(["Alarmanlagen"]); // passend zur eingetragenen Sparte vorausgewählt
    expect(hint(view.container)).toContain("passend zu Alarmanlage");
    await act(async () => { fireEvent.click(chip(view.container, "Alarmanlagen")); }); await settle(50); // abwählen
    expect(picked(view.container)).toEqual([]);
    await act(async () => { fireEvent.click(chip(view.container, "Photovoltaik")); }); await settle(50);
    await act(async () => { fireEvent.click(chip(view.container, "Wärmepumpe")); }); await settle(50);
    expect(picked(view.container)).toEqual(["Photovoltaik", "Wärmepumpe"]); expect(hint(view.container)).toContain("passend zu Photovoltaik & Wärmepumpe");
    expect(view.container.querySelector('.cat-free input')).toBeNull(); // mit Kategorie kein freier Eintrag
    const save = Array.from(view.container.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent?.trim() === "Speichern")!;
    await act(async () => { fireEvent.click(save); }); await settle(300);
    const categories = getStore().tables.leadCategories; const idOf = (name: string) => categories.find((row) => row.name === name)!.id;
    const row = getStore().tables.emailCampaigns.find((item) => item.name === "Alarmanlagen-Errichter NRW")!;
    expect(row.leadCategoryIds).toEqual([idOf("Photovoltaik"), idOf("Wärmepumpe")]); expect(row.leadSparte).toBe("Photovoltaik & Wärmepumpe");
  });

  it("keine passende Kategorie: freier Eintrag bleibt; „Andere Sparte eintragen“ wählt die Kategorien ab", async () => {
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const view = mount(); await settle(300); await settle(300);
    await openEditor(view.container, "Hausnotruf-Anbieter – Erstkontakt"); // im Demo gibt es keine Hausnotruf-Kategorie
    expect(picked(view.container)).toEqual([]);
    const free = view.container.querySelector<HTMLInputElement>(".cat-free input"); expect(free?.value).toBe("Hausnotruf"); expect(hint(view.container)).toContain("passend zu Hausnotruf");
    // eine Kategorie wählen → freier Eintrag weg; „Andere Sparte eintragen“ → wieder frei, Kategorien abgewählt
    await act(async () => { fireEvent.click(chip(view.container, "Treppenlifte")); }); await settle(50);
    expect(picked(view.container)).toEqual(["Treppenlifte"]); expect(view.container.querySelector(".cat-free input")).toBeNull(); expect(hint(view.container)).toContain("passend zu Treppenlift");
    const other = view.container.querySelector<HTMLButtonElement>(".cat-pick.is-other")!; expect(other.textContent).toContain("Andere Sparte eintragen");
    await act(async () => { fireEvent.click(other); }); await settle(50);
    expect(picked(view.container)).toEqual([]);
    await act(async () => { fireEvent.change(view.container.querySelector<HTMLInputElement>(".cat-free input")!, { target: { value: "Pool-Bau" } }); }); await settle(50);
    expect(hint(view.container)).toContain("passend zu Pool-Bau");
  });
});

describe("Zielgruppe im Editor: weitere Listen einklappbar", () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });
  it("die Listen der Kampagne stehen immer da, die übrigen erst nach „Weitere Listen anzeigen“", async () => {
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const view = mount(); await settle(300); await settle(300);
    await openEditor(view.container, "Dachdecker Hessen – Erstkontakt");
    const rows = () => Array.from(view.container.querySelectorAll(".list-picker-row strong")).map((node) => node.textContent);
    expect(rows()).toEqual(["Dachdecker Hessen"]); // eingeklappt: nur die Liste der Kampagne
    const more = view.container.querySelector<HTMLButtonElement>(".list-picker-more")!; expect(more.getAttribute("aria-expanded")).toBe("false"); expect(more.textContent).toContain("Weitere Listen anzeigen");
    await act(async () => { fireEvent.click(more); }); await settle(50);
    expect(rows().length).toBeGreaterThan(1); expect(rows()[0]).toBe("Dachdecker Hessen"); expect(more.textContent).toContain("Weitere Listen ausblenden"); expect(more.getAttribute("aria-expanded")).toBe("true");
  });
});
