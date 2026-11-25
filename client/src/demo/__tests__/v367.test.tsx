import { trpc } from "@/lib/trpc";
import { createTRPCClient } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { getStore, resetStore } from "../backend";
import { nameInitials } from "../../../../shared/lead-age";
import { leadDisplayName } from "../../../../shared/lead-fields";
import type { AppRouter } from "../../../../server/routers";

/**
 * Version 367 – Lead-Seite neu gestaltet: Kopf mit Kreis, Kategorie, Status, ID zum Kopieren und Anrufen / E-Mail / Kontakt kopieren;
 * der Weg des Leads in vier Schritten; Einkauf, Verkauf, Erstattet, Marge.
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 400) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const open = async (query: string, wait = 2200) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((node) => (node.textContent ?? "").trim());
type Row = Record<string, any>;
const table = (name: string) => (getStore().tables as unknown as Record<string, Row[]>)[name];
const euro = (value: number) => `${value.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
/** Den ersten Verkaufs-Lead suchen, dessen Lead-Seite (wie sie die Vorschau liefert) passt */
async function findLead(match: (detail: any) => boolean) {
  const client = createTRPCClient<AppRouter>({ links: [localDemoLink()] });
  for (const row of table("leads").filter((item) => (item.kind ?? "verkauf") === "verkauf")) { const detail: any = await client.leadops.getLeadDetail.query({ publicId: row.publicId }); if (match(detail)) return { row, detail }; }
  throw new Error("kein passender Lead in der Vorschau");
}

describe("Version 367", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); });

  it("Lead-Seite: Kopf, Weg des Leads, Einkauf/Verkauf/Marge – und Kopieren von ID und Kontakt", async () => {
    // ein Lead, der angenommen ausgeliefert wurde und eine Reklamation hat
    const claimed = table("claims").map((claim) => claim.leadId);
    const lead = table("leads").find((row) => (row.kind ?? "verkauf") === "verkauf" && row.phone && row.email && claimed.includes(row.id) && table("leadDeliveries").some((delivery) => delivery.leadId === row.id && delivery.result === "angenommen"))!;
    expect(lead).toBeTruthy();
    const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const root = await open(`page=Leads&lead=${lead.publicId}`);
    const name = leadDisplayName(lead as never) || lead.publicId;
    // Kopf
    expect(root.querySelector(".lp-hero h1")!.textContent).toBe(name); expect(root.querySelector(".lp-avatar")!.textContent).toBe(nameInitials(name));
    const category = table("leadCategories").find((row) => row.id === lead.categoryId)!;
    expect(root.querySelector(".lp-cat-code")!.textContent).toBe(category.shortcode); expect(root.querySelector(".lp-cat-name")!.textContent).toBe(category.name);
    expect(root.querySelector(".lp-id code")!.textContent).toBe(lead.publicId); expect(root.querySelector(".lp-facts")!.textContent).toContain("eingegangen vor");
    expect(root.querySelector<HTMLAnchorElement>('.lp-quick a[href^="tel:"]')!.getAttribute("href")).toBe(`tel:${lead.phone}`); expect(root.querySelector<HTMLAnchorElement>('.lp-quick a[href^="mailto:"]')!.getAttribute("href")).toBe(`mailto:${lead.email}`);
    // Weg des Leads: vier Schritte, eingegangen und ausgeliefert erledigt, danach die Reklamation
    const steps = Array.from(root.querySelectorAll<HTMLElement>(".lp-step"));
    expect(steps).toHaveLength(4); expect(steps[0].classList.contains("is-done")).toBe(true); expect(steps[0].querySelector("b")!.textContent).toBe("Eingegangen");
    expect(steps[2].querySelector("b")!.textContent).toBe("Ausgeliefert"); expect(steps[2].classList.contains("is-done")).toBe(true);
    expect(["Reklamation offen", "Reklamiert", "Reklamation abgelehnt"]).toContain(steps[3].querySelector("b")!.textContent);
    // Wirtschaftlich: Einkauf = Preis beim Lieferanten, Verkauf = angenommene/angebotene Auslieferungen
    expect(texts(root, ".lp-money dt")).toEqual(["Einkauf", "Verkauf", "Erstattet", "Marge"]);
    expect(root.querySelector(".lp-money dd b")!.textContent).toBe(euro(Number(lead.cost ?? 0)));
    const sold = table("leadDeliveries").filter((delivery) => delivery.leadId === lead.id && (delivery.result === "angenommen" || delivery.result === "angeboten")).reduce((sum, delivery) => sum + Number(delivery.unitPrice ?? 0), 0);
    expect(root.querySelectorAll(".lp-money dd b")[1].textContent).toBe(euro(sold));
    // Karten: Überschriften in normaler Schreibweise, Auslieferung mit Kürzel des Käufers und Preis
    expect(texts(root, ".lead-page-card > header .lp-title")).toEqual(expect.arrayContaining(["Fachfelder", "Kontakt", "Herkunft", "Auslieferung", "Reklamationen", "Tags", "Lead-Log"]));
    const delivery = root.querySelector<HTMLElement>(".lp-entry")!; expect(delivery.querySelector(".lp-entry-avatar")!.textContent).toBe(nameInitials(delivery.querySelector("strong")!.textContent));
    // Kopieren: ID und Kontakt
    await click(root.querySelector(".lp-id")); expect(writeText).toHaveBeenLastCalledWith(lead.publicId); expect(root.querySelector(".lp-id")!.classList.contains("is-copied")).toBe(true);
    const contact = Array.from(root.querySelectorAll(".lp-quick-btn")).find((node) => node.textContent?.includes("Kontakt kopieren"));
    await click(contact);
    const copied = String(writeText.mock.calls.at(-1)![0]); expect(copied.split("\n")[0]).toBe(name); expect(copied).toContain(lead.phone); expect(copied).toContain(lead.email);
    expect(contact!.querySelector("b")!.textContent).toBe("Kopiert"); expect(contact!.classList.contains("is-copied")).toBe(true);
    await settle(1800); expect(contact!.querySelector("b")!.textContent).toBe("Kontakt kopieren"); expect(root.querySelector(".lp-id")!.classList.contains("is-copied")).toBe(false);
  }, 30_000);

  it("Lead-Seite: im Reklamationsfenster – Restzeit als Balken, Marge mit Anteil", async () => {
    const soldOf = (item: any) => item.deliveries.filter((delivery: any) => delivery.result === "angenommen" || delivery.result === "angeboten").reduce((sum: number, delivery: any) => sum + Number(delivery.unitPrice ?? 0), 0);
    const { row, detail } = await findLead((item) => item.deliveries.some((delivery: any) => delivery.inWindow) && !item.claims.length && Number(item.cost ?? 0) > 0 && soldOf(item) > 0);
    const root = await open(`page=Leads&lead=${row.publicId}`);
    const last = root.querySelectorAll<HTMLElement>(".lp-step")[3];
    expect(last.classList.contains("is-current")).toBe(true); expect(last.querySelector("b")!.textContent).toBe("Reklamationsfenster");
    const width = parseFloat(last.querySelector<HTMLElement>(".lp-step-bar i")!.style.width); expect(width).toBeGreaterThanOrEqual(0); expect(width).toBeLessThanOrEqual(100);
    const sold = soldOf(detail);
    const share = Math.round(((sold - Number(detail.cost)) / sold) * 100);
    expect(root.querySelector(".lp-money .is-margin small")!.textContent).toBe(`${share < 0 ? "−" : ""}${Math.abs(share)} % vom Verkauf`);
    if (share > 0) expect(root.querySelector<HTMLElement>(".lp-money-meter i")!.style.width).toBe(`${Math.min(100, share)}%`); else expect(root.querySelector(".lp-money-meter")).toBeNull();
  }, 60_000);

  it("Lead-Seite: unbekannte ID – freundlicher Hinweis und zurück zur Liste", async () => {
    const root = await open("page=Leads&lead=GIBTSNICHT");
    expect(root.querySelector(".lp-missing h2")!.textContent).toBe("Lead nicht gefunden"); expect(root.querySelector(".lp-missing p")!.textContent).toContain("GIBTSNICHT");
    await click(root.querySelector(".lp-missing button"), 900);
    expect(root.querySelector(".lp-missing")).toBeNull(); expect(new URLSearchParams(window.location.search).get("lead")).toBeNull(); expect(root.querySelector(".lt-row[data-lead]")).toBeTruthy();
  }, 30_000);

  it("Lead-Seite: ein neuer Lead ohne Auslieferung – geprüft wird noch, Verkauf und Marge noch offen", async () => {
    const { row: lead } = await findLead((item) => item.status === "neu" && !item.deliveries.length && (!item.call || item.call.decision !== "freigegeben"));
    const root = await open(`page=Leads&lead=${lead.publicId}`);
    const steps = Array.from(root.querySelectorAll<HTMLElement>(".lp-step"));
    expect(steps.map((step) => step.className.replace("lp-step ", ""))).toEqual(["is-done", "is-current", "is-todo", "is-todo"]);
    expect(texts(root, ".lp-money dd b").slice(1)).toEqual(["–", "–", "–"]);
    expect(root.querySelector(".lp-step.is-current b")!.textContent).toBe("Wird geprüft");
    expect(root.querySelector(".lp-step-bar")).toBeNull(); expect(root.querySelector(".lp-money-meter")).toBeNull();
  }, 60_000);
});
