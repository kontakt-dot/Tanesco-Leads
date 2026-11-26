import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, resetStore } from "../backend";

/**
 * Version 374 – Tags, Lead-Kategorien und Telefonie im neuen Aufbau: Zahlenleiste oben, Kategorien als Liste mit Emoji,
 * Parameterblatt als Karte mit den Zahlen des PDFs, Telefonie mit Reitern und Modus-Karten.
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
const stat = (root: Element, label: string) => Array.from(root.querySelectorAll(".tg-stat")).find((node) => node.querySelector("span")?.textContent?.trim() === label);

describe("Version 374", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); resetStore(); });

  it("Lead-Kategorien: Leiste zählt wie die Liste, Auswahl färbt den Kopf, Parameterblatt zeigt die Zahlen der Felder", async () => {
    const categories = (await callProcedure("leadops.listCategories", undefined)) as Array<{ id: number; name: string; status: string }>;
    const root = await open("page=Lead-Kategorien"); await until(() => root.querySelectorAll(".lc-item").length > 0);
    expect(root.querySelectorAll(".lc-item").length).toBe(categories.length);
    expect(stat(root, "Kategorien")!.querySelector("strong")!.textContent).toBe(String(categories.length));
    const active = categories.filter((row) => row.status === "aktiv").length;
    expect(stat(root, "Aktiv")!.querySelector("strong")!.textContent).toBe(`${active}von ${categories.length}`);
    expect(stat(root, "Inaktiv")!.querySelector("strong")!.textContent).toBe(String(categories.length - active));
    expect(root.querySelector(".lc-welcome h2")!.textContent).toBe("Wählen Sie eine Kategorie"); expect(root.querySelectorAll(".lc-how li").length).toBe(3);
    const first = root.querySelector<HTMLButtonElement>(".lc-item")!; const name = first.querySelector("strong")!.textContent!; expect(first.querySelector(".lc-mark")!.textContent!.length).toBeGreaterThan(0);
    await click(first, 900);
    expect(root.querySelector(".lc-item.is-on strong")!.textContent).toBe(name); expect(root.querySelector(".lc-head h2")!.textContent).toBe(name); expect(root.querySelector(".lc-welcome")).toBeNull();
    const picked = categories.find((row) => row.name === name)!; const fields = (await callProcedure("leadops.listCategoryFields", { categoryId: picked.id })) as Array<{ required: boolean; options: unknown }>;
    await click(Array.from(root.querySelectorAll("button")).find((node) => node.textContent?.trim() === "Parameterblatt"), 500);
    const sheet = root.querySelector('.lc-sheet[aria-label="Parameterblatt"]')!; expect(sheet).toBeTruthy();
    const facts = Object.fromEntries(Array.from(sheet.querySelectorAll(".lc-sheet-facts div")).map((node) => [node.querySelector("dt")!.textContent, node.querySelector("dd")!.textContent]));
    expect(facts).toMatchObject({ Felder: String(fields.length), Pflichtfelder: String(fields.filter((field) => field.required).length), "mit festen Antworten": String(fields.filter((field) => Array.isArray(field.options) && field.options.length > 0).length) });
    expect(sheet.querySelector(".lc-paper-band b")!.textContent).toBe(name);
    expect(Array.from(sheet.querySelectorAll("button")).map((node) => node.textContent?.trim())).toEqual(["Als PDF herunterladen", "CSV-Vorlage dazu", "Schließen"]);
    await click(Array.from(sheet.querySelectorAll("button")).find((node) => node.textContent?.trim() === "Schließen"), 300); expect(root.querySelector(".lc-sheet")).toBeNull();
  }, 30000);

  it("Tags: vier Kennzahlen, jede Zeile mit Marke und Nutzung", async () => {
    const root = await open("page=Tags"); await until(() => root.querySelectorAll(".tg-row").length > 0);
    expect(Array.from(root.querySelectorAll(".tg-rail .tg-stat > span:first-child")).map((node) => node.textContent?.trim())).toEqual(["Tags gesamt", "Leads mit Tag", "Meistgenutzter Tag", "Ohne Leads"]);
    const rows = Array.from(root.querySelectorAll(".tg-row")); expect(stat(root, "Tags gesamt")!.querySelector("strong")!.textContent).toBe(String(rows.length));
    for (const row of rows) { expect(row.querySelector(".tg-name strong")!.textContent!.length).toBeGreaterThan(0); expect(row.querySelector(".tg-use")).toBeTruthy(); }
    expect(root.querySelectorAll(".tg-how li").length).toBe(3);
  }, 30000);

  it("Telefonie: Reiter mit Symbol, Modus als Karten (Auswahl wechselt, Power braucht eine Kampagne), Live-Leiste und Kampagnen-Karten", async () => {
    const root = await open("page=Telefonie"); await until(() => root.querySelectorAll(".tp-mode").length > 0);
    const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>(".tp-tabs button")); expect(tabs.map((node) => node.textContent)).toEqual(["Wählen", "Live-Bild", "Kampagnen", "Anrufe", "Rufnummern", "Einstellungen"]);
    expect(tabs[0].getAttribute("aria-current")).toBe("page"); for (const tab of tabs) expect(tab.querySelector("svg")).toBeTruthy();
    const modes = Array.from(root.querySelectorAll<HTMLButtonElement>(".tp-mode")); expect(modes.map((node) => node.querySelector("b")!.textContent)).toEqual(["Manuell", "Power-Dialer", "Predictive-Dialer"]);
    expect(modes[0].getAttribute("aria-checked")).toBe("true");
    const start = () => Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent?.trim() === "Sitzung starten")!; expect(start().disabled).toBe(false);
    await click(modes[1], 300); expect(root.querySelectorAll(".tp-mode.is-on").length).toBe(1); expect(root.querySelector(".tp-mode.is-on b")!.textContent).toBe("Power-Dialer"); expect(start().disabled).toBe(true);
    expect(root.querySelector(".tp-provider")!.textContent).toContain("Simulation");
    await click(tabs[1], 1500); await until(() => root.querySelectorAll(".tp-rail .tg-stat").length > 0);
    expect(Array.from(root.querySelectorAll(".tp-rail .tg-stat > span:first-child")).map((node) => node.textContent?.trim())).toEqual(["Angemeldet", "Im Gespräch", "Anrufe heute", "Termine/Verkäufe heute", "Gesprächszeit heute"]);
    await click(Array.from(root.querySelectorAll<HTMLButtonElement>(".tp-tabs button"))[2], 1200); await until(() => root.querySelectorAll(".tp-camp").length > 0);
    const campaigns = (await callProcedure("leadops.listDialerCampaigns", undefined)) as Array<{ name: string; stats: { open: number; done: number } }>;
    const cards = Array.from(root.querySelectorAll(".tp-camp")); expect(cards.length).toBe(campaigns.length);
    const campaign = campaigns[0]; const total = campaign.stats.open + campaign.stats.done; const card = cards.find((node) => node.querySelector(".tp-camp-head strong")!.textContent === campaign.name)!;
    expect(card.querySelector(".tp-camp-progress small")!.textContent).toBe(total ? `${campaign.stats.done} von ${total} erledigt · ${Math.round((campaign.stats.done / total) * 100)} %` : "Wählliste ist noch leer");
    expect(card.querySelector(".tp-camp-stats dd")!.textContent).toBe(String(campaign.stats.open));
  }, 40000);
});
