import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";

/**
 * Version 345:
 *  - Gebietskarte: Ein Klick auf einen Kunden hebt sein Gebiet hervor – die anderen bleiben auf der Karte (früher verschwanden sie).
 *  - Anbindung an den Dialer: „Was kommt vom Dialer an?“ – Zahlen, Urteil und der Knopf, der grüne Gespräche ohne Lead nachholt.
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 500) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
type Intake = { enabled: boolean; today: { received: number; approved: number; leads: number; approvedNoLead: number }; week: { received: number; approved: number; leads: number }; lastAt: string | Date | null; approvedWithoutLead: number; verdict: { tone: string; title: string; text: string }; contact: { name: boolean } | null; fields: string[] };
const intakeNow = () => callProcedure("leadops.dialerIntake", undefined) as Promise<Intake>;

describe("Gebietskarte – hervorheben statt ausblenden", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); resetStore(); });

  it("alle Kunden bleiben auf der Karte: ein Klick hebt einen hervor, „Alle“ zeigt wieder alle gleich", async () => {
    window.history.replaceState(null, "", "/?page=Gebietskarte"); const view = mount(); await settle(2500);
    const root = view.container; const dots = () => Array.from(root.querySelectorAll<SVGCircleElement>(".territory-dot"));
    const total = dots().length; expect(total).toBeGreaterThan(50);
    expect(dots().every((dot) => dot.getAttribute("data-mine") === "1")).toBe(true); // ohne Hervorhebung gehört jede PLZ „dazu“
    // seit v369: Kunden unten auf der Karte („.gk-customers“), Kennzahlen als Leiste („.gk-rail“), Kundenliste rechts („.gk-customer-main“)
    const chips = () => Array.from(root.querySelectorAll<HTMLButtonElement>(".gk-customers .gk-chip")); const all = () => root.querySelector<HTMLButtonElement>(".gk-chip-all")!;
    expect(all()).toBeTruthy(); expect(all().classList.contains("is-on")).toBe(true); expect(all().getAttribute("aria-pressed")).toBe("true");
    const first = chips().find((chip) => !chip.classList.contains("gk-chip-all") && !chip.classList.contains("is-off"))!;
    await click(first);
    // dieselbe Zahl an Punkten wie vorher – nichts verschwindet; die PLZ der anderen sind nur blasser
    expect(dots().length).toBe(total);
    const mine = dots().filter((dot) => dot.getAttribute("data-mine") === "1"); const others = dots().filter((dot) => dot.getAttribute("data-mine") === "0");
    expect(mine.length).toBeGreaterThan(0); expect(others.length).toBeGreaterThan(0); expect(others.every((dot) => dot.classList.contains("is-other") || dot.classList.contains("is-dim"))).toBe(true); expect(mine.some((dot) => dot.classList.contains("is-other"))).toBe(false);
    expect(first.classList.contains("is-focus")).toBe(true); expect(all().classList.contains("is-on")).toBe(false);
    expect(root.querySelector(".territory-side")!.textContent).toContain("ist hervorgehoben"); expect(root.textContent).not.toContain("wird gezeigt – alle Kunden zeigen");
    // die Kennzahl „Abgedeckte PLZ“ gilt weiter für alle Kunden
    const covered = () => Number(root.querySelectorAll(".gk-rail .gk-stat strong")[1]!.textContent!.replace(/\D/g, "")); const coveredFocused = covered();
    await click(all());
    expect(dots().every((dot) => dot.getAttribute("data-mine") === "1")).toBe(true); expect(covered()).toBe(coveredFocused); expect(root.querySelector(".gk-chip.is-focus")).toBeNull();
    // auch die Kundenliste rechts hebt hervor – ein zweiter Klick nimmt es zurück
    const listed = root.querySelector<HTMLButtonElement>(".gk-customer-main")!; await click(listed); expect(root.querySelector(".gk-chip.is-focus")).toBeTruthy(); expect(listed.closest("li")!.classList.contains("is-focus")).toBe(true);
    await click(root.querySelector<HTMLButtonElement>(".gk-customer-main")); expect(root.querySelector(".gk-chip.is-focus")).toBeNull();
  }, 30_000);
});

describe("Anbindung – was kommt vom Dialer an?", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); resetStore(); });

  it("zeigt Zahlen und Urteil – und holt grüne Gespräche ohne Lead mit einem Klick nach", async () => {
    const before = await intakeNow(); const leadsBefore = getStore().tables.leads.length; const idsBefore = new Set(getStore().tables.leads.map((row) => row.id));
    expect(before.enabled).toBe(true); expect(before.week.received).toBeGreaterThan(20); expect(before.approvedWithoutLead).toBeGreaterThan(10); expect(before.lastAt).toBeTruthy();
    window.history.replaceState(null, "", "/?page=Gespräche&view=Einstellungen"); const view = mount(); await settle(1200);
    const root = view.container; let panel = root.querySelector<HTMLElement>(".gs-intake");
    if (!panel) { await click(Array.from(root.querySelectorAll("button")).find((button) => button.textContent?.includes("Dialer & Bewertung")), 900); panel = root.querySelector<HTMLElement>(".gs-intake"); }
    expect(panel).toBeTruthy();
    expect(panel!.querySelector(".gs-intake-head h3")!.textContent).toBe(before.verdict.title);
    const steps = Array.from(panel!.querySelectorAll(".gs-intake-steps li")).map((item) => item.textContent ?? ""); expect(steps).toHaveLength(4); expect(steps[0]).toContain("Angekommen"); expect(steps[3]).toContain("Leads");
    const fix = panel!.querySelector<HTMLElement>(".gs-intake-fix")!; expect(fix.textContent).toContain(`${before.approvedWithoutLead.toLocaleString("de-DE")} grüne Gespräche haben noch keinen Lead`);
    await click(fix.querySelector("button"), 1500);
    const after = await intakeNow(); expect(after.approvedWithoutLead).toBe(0); expect(after.week.leads).toBe(after.week.approved); expect(root.querySelector(".gs-intake-fix")).toBeNull();
    // jeder Lead hängt an seinem Gespräch; dieselbe Rufnummer ergibt keinen zweiten Lead
    const store = getStore(); const made = store.tables.leads.length - leadsBefore; expect(made).toBeGreaterThan(0); expect(made).toBeLessThanOrEqual(before.approvedWithoutLead);
    const green = store.tables.callRecords.filter((row) => row.decision === "freigegeben" && row.provider === "ondialer"); expect(green.every((row) => row.leadId)).toBe(true);
    const phones = store.tables.leads.filter((row) => row.supplierName === "OnDialer").map((row) => String(row.phone)); expect(new Set(phones).size).toBe(phones.length);
    const fresh = store.tables.leads.filter((row) => !idsBefore.has(row.id)); expect(fresh.length).toBe(made); expect(fresh.every((row) => (row.metadata as { callRecordId?: number } | null)?.callRecordId && row.supplierName === "OnDialer")).toBe(true); expect(fresh.every((row) => row.status === "genehmigt" && row.lastName && row.phone)).toBe(true);
    // ein zweiter Lauf findet nichts mehr
    expect(await callProcedure("leadops.leadsFromApprovedCalls", undefined)).toMatchObject({ leads: 0 });
  }, 30_000);
});
