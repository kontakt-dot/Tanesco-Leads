import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, resetStore } from "../backend";
import { dashboardRange } from "@/lib/dashboardPeriod";

/**
 * Version 372 – Dashboard neu gestaltet: Kennzahlen als eine Leiste (jede Zahl mit einer Zeile, die sie einordnet), Zeichen der Kategorie
 * im Filter, Bestellverteilung mit Rang, Schnittstellen als Ring mit Liste.
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const open = async (query: string, wait = 2800) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };

describe("Version 372", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); resetStore(); });

  it("Dashboard: Leiste mit fünf Kennzahlen – Zahl, Balken und eine Zeile, die sie einordnet; die Zahlen stimmen mit der Statistik überein", async () => {
    const root = await open("page=Dashboard&period=all");
    const stats = Array.from(root.querySelectorAll<HTMLElement>(".db-rail .db-stat"));
    expect(stats.map((node) => node.querySelector(".db-stat-label")!.textContent)).toEqual(["Ausgelieferte Leads", "Umsatz Leads", "Dubletten", "Reklamationen", "PrePing abgelehnt"]);
    const range = dashboardRange("all", "", ""); const data = await callProcedure("leadops.statistics", { from: range.from, until: range.until }) as { delivered: number; revenue: number; duplicates: number; claims: number };
    const number = (node: Element) => Number(node.querySelector("strong")!.textContent!.replace(/\./g, "").replace(/[^\d,]/g, "").replace(",", "."));
    expect(number(stats[0])).toBe(data.delivered); expect(number(stats[1])).toBeCloseTo(data.revenue, 2); expect(number(stats[2])).toBe(data.duplicates); expect(number(stats[3])).toBe(data.claims);
    expect(stats[0].querySelector("small")!.textContent).toBe("im gesamten Zeitraum"); expect(stats[0].querySelectorAll(".db-spark i")).toHaveLength(24);
    if (data.delivered) { expect(stats[1].querySelector("small")!.textContent).toMatch(/^Ø [\d.,]+\s€ je Lead$/); expect(stats[3].querySelector("small")!.textContent).toBe(`${Math.round((data.claims / data.delivered) * 100)} % der ausgelieferten Leads`); expect(stats[3].querySelector(".db-meter i")).toBeTruthy(); }
    expect(stats[2].querySelector("small")!.textContent).toMatch(/^\d+ % von [\d.]+ eingegangenen Leads$/); expect(stats[4].querySelector("small")!.textContent).toMatch(/% der angebotenen Leads$|^nichts angeboten$/);
    expect(root.querySelector(".metric-grid")).toBeNull(); // die fünf einzelnen Karten gibt es nicht mehr
    // ein Zeitraum mit Tagen: Schnitt am Tag
    await click(Array.from(root.querySelectorAll<HTMLButtonElement>('.dashboard-segments[aria-label="Dashboard-Zeitraum"] button')).find((node) => node.textContent === "Letzte 2 Wochen"), 1200);
    expect(root.querySelector(".db-rail .db-stat small")!.textContent).toMatch(/^(Ø [\d.,]+ am Tag · 14 Tage|noch nichts ausgeliefert)$/);
  }, 40_000);

  it("Dashboard: Zeichen der Kategorie im Filter (der Name bleibt ohne Zeichen), Rang in der Bestellverteilung, Schnittstellen als Ring mit Liste", async () => {
    const root = await open("page=Dashboard&period=all");
    const pv = Array.from(root.querySelectorAll<HTMLButtonElement>('.dashboard-segments[aria-label="Kategorie"] button')).find((node) => node.textContent === "Photovoltaik")!;
    expect(pv.getAttribute("data-emoji")).toBe("☀️"); expect(pv.getAttribute("style")).toContain("--cat");
    const rows = Array.from(root.querySelectorAll("#dashboard-bestellverteilung .dash-table tbody tr")); expect(rows.length).toBeGreaterThan(2);
    expect(rows.map((row) => row.querySelector(".db-order em")!.textContent)).toEqual(rows.map((_, index) => String(index + 1)));
    expect(root.querySelector("#dashboard-bestellverteilung .db-count")!.textContent).toMatch(/^\d+ von \d+$/); expect(rows[0].querySelector(".dash-pill[data-emoji]")).toBeTruthy();
    const health = root.querySelector(".focus-panel")!; const title = health.querySelector("h2")!.textContent!; const [healthy, total] = title.split(" ")[0].split("/").map(Number);
    expect(health.querySelector(".db-ring b")!.textContent).toBe(`${Math.round((healthy / total) * 100)} %`); expect(health.querySelector<HTMLElement>(".db-ring")!.getAttribute("style")).toContain(`--rate: ${Math.round((healthy / total) * 100)}%`);
    expect(health.querySelectorAll(".db-apis li").length).toBe(Math.min(4, total)); expect(health.querySelectorAll(".db-apis li.is-ok").length).toBe(Math.min(healthy, 4 - Math.min(4, total - healthy)));
    // Lead-Puls: Farbe und Zeichen der Kategorie an der Zeile
    const first = root.querySelector<HTMLElement>(".pulse-window .recent-row")!; expect(first.getAttribute("style")).toContain("--cat"); expect(first.querySelector(".recent-type")!.getAttribute("data-emoji")).toBeTruthy();
  }, 40_000);

  it("Bestellung definieren: vier Abschnitte, Kategorien mit Zeichen, Liefertage als Knöpfe – rechts die Bestellung in einfachen Worten mit dem, was fehlt", async () => {
    const root = await open("page=Bestellungen&orderId=1");
    const form = root.querySelector(".order-main.of")!; expect(Array.from(form.querySelectorAll(".of-card > header h2")).map((node) => node.textContent)).toEqual(["Wer bekommt was?", "Preis und Menge", "Zeitraum und Gebiet", "Regeln und Liefertage"]);
    const summary = () => form.querySelector(".of-summary")!; const line = (name: string) => Array.from(summary().querySelectorAll("dl > div")).find((row) => row.querySelector("dt")!.textContent === name)!.querySelector("dd")!.textContent!;
    const pv = Array.from(form.querySelectorAll<HTMLButtonElement>(".of-cats button")).find((node) => node.textContent === "PhotovoltaikPV")!; expect(pv.getAttribute("data-emoji")).toBe("☀️"); expect(pv.className).toContain("selected");
    expect(line("Kategorien")).toContain("Photovoltaik"); expect(line("Takt")).toMatch(/Mo–Fr$/); expect(summary().querySelector(".of-fine")).toBeTruthy();
    // Liefertage: Samstag dazu, Mittwoch weg → „Mo, Di, Do, Fr, Sa“
    const day = (name: string) => Array.from(form.querySelectorAll<HTMLButtonElement>(".of-days button")).find((node) => node.textContent === name)!;
    expect(day("Samstag").getAttribute("aria-pressed")).toBe("false"); await click(day("Samstag"), 150); await click(day("Mittwoch"), 150);
    expect(day("Samstag").getAttribute("aria-pressed")).toBe("true"); expect(line("Takt")).toMatch(/Mo, Di, Do, Fr, Sa$/);
    // Preis 0 und Start in der Zukunft: beides steht als Hinweis da
    const field = (name: string) => Array.from(form.querySelectorAll<HTMLLabelElement>("label.order-form-field")).find((label) => label.textContent?.startsWith(name))!.querySelector<HTMLInputElement>("input")!;
    const future = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
    await act(async () => { fireEvent.change(field("Leadpreis"), { target: { value: "0" } }); fireEvent.change(field("Bestellstart"), { target: { value: future } }); }); await settle(200);
    const warnings = Array.from(summary().querySelectorAll(".of-warn li")).map((node) => node.textContent!); expect(warnings[0]).toBe("Der Leadpreis ist 0,00 € – der Käufer zahlt je Lead nichts."); expect(warnings[1]).toMatch(/^Die Bestellung startet erst am \d\d\.\d\d\.\d{4} – bis dahin geht kein Lead raus\.$/);
    expect(line("Start")).toMatch(/· in [34] Tagen$/); expect(summary().querySelector(".of-fine")).toBeNull();
  }, 40_000);
});
