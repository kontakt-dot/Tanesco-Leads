import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";

/**
 * Version 357 – Kampagnen vom Dialer: Im Einstellen-Fenster steht, wie die Kampagnen im Dialer heißen und wo ihre Gespräche landen.
 * Zuordnen holt die bisherigen Gespräche mit. Je Kampagne lässt sich ein Käufer wählen – dann bekommt nur er ihre Leads.
 * Am Gespräch steht der Name aus dem Dialer, wenn er anders heißt.
 */
type Row = Record<string, unknown>;
type DialerRow = { name: string; calls: number; target: string | null; via: string; elsewhere: number };
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const names = async () => await callProcedure("leadops.listDialerCampaignNames", undefined) as DialerRow[];
const dialog = () => Array.from(document.querySelectorAll<HTMLElement>(".cq-dialog")).pop()!;

describe("Version 357", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); cleanup(); vi.restoreAllMocks(); resetStore(); });

  it("Kampagnen vom Dialer: Liste, zuordnen (die bisherigen kommen mit), Käufer je Kampagne; am Gespräch der Name aus dem Dialer", async () => {
    // Beispiel: „PV Q4“ heißt im Dialer genauso, „WP Herbst Nord“ ist „Wärmepumpe Herbst“ zugeordnet, ein paar aus „Aroundhome Solar“ liegen noch in „PV Q4“
    const before = await names();
    expect(before.find((row) => row.name === "PV Q4")).toMatchObject({ target: "PV Q4", via: "name", elsewhere: 0 });
    expect(before.find((row) => row.name === "WP Herbst Nord")).toMatchObject({ target: "Wärmepumpe Herbst", via: "zuordnung", elsewhere: 0 });
    const aroundhome = before.find((row) => row.name === "Aroundhome Solar")!;
    expect(aroundhome).toMatchObject({ target: "Aroundhome Solar", via: "dialer" }); expect(aroundhome.calls).toBeGreaterThan(0); expect(aroundhome.elsewhere).toBe(aroundhome.calls);

    // Einstellen-Fenster: die Tabelle „Kampagnen vom Dialer“ und „Leads aus dieser Kampagne gehen an“
    window.history.replaceState(null, "", "/?page=Gespräche"); const view = mount(); await settle(500);
    await click(Array.from(view.container.querySelectorAll<HTMLButtonElement>(".cq-campaign-row .dashboard-segments button")).find((node) => node.textContent === "PV Q4"), 400);
    await click(Array.from(view.container.querySelectorAll<HTMLButtonElement>(".cq-tool")).find((node) => /Einstellen/.test(node.textContent ?? "")), 600);
    const map = dialog().querySelector(".cq-dialer-map")!; expect(map).toBeTruthy();
    const rows = () => Array.from(dialog().querySelectorAll<HTMLElement>(".cq-dialer-row"));
    const rowOf = (name: string) => rows().find((row) => row.querySelector(".cq-dialer-name b")?.textContent === name)!;
    expect(rowOf("WP Herbst Nord").querySelector(".cq-dialer-state")?.textContent).toBe("zugeordnet");
    expect(rowOf("PV Q4").querySelector(".cq-dialer-state")?.textContent).toBe("gleicher Name");
    expect(rowOf("Aroundhome Solar").querySelector(".cq-dialer-state")?.textContent).toContain(`${aroundhome.calls} ${aroundhome.calls === 1 ? "liegt" : "liegen"} noch woanders`);
    // zuordnen: „Neue Kampagne „Aroundhome Solar““ → Rückfrage → die bisherigen kommen mit
    const select = rowOf("Aroundhome Solar").querySelector<HTMLSelectElement>(".cq-dialer-target")!;
    expect(Array.from(select.options).map((option) => option.textContent)).toContain("Neue Kampagne „Aroundhome Solar“");
    await act(async () => { fireEvent.change(select, { target: { value: "__neu__" } }); }); await settle(200);
    const confirm = document.querySelector<HTMLElement>(".app-confirm")!; expect(confirm.textContent).toContain(`Die ${aroundhome.calls} bisherigen kommen mit`);
    await click(confirm.querySelector(".app-confirm-ok"), 800);
    const table = getStore().tables;
    expect((table.callRecords as Row[]).filter((row) => row.dialerCampaign === "Aroundhome Solar").every((row) => row.campaign === "Aroundhome Solar")).toBe(true);
    expect((await names()).find((row) => row.name === "Aroundhome Solar")).toMatchObject({ target: "Aroundhome Solar", via: "zuordnung", elsewhere: 0 });

    // Käufer der Kampagne „PV Q4“ wählen
    const buyerSelect = dialog().querySelector<HTMLSelectElement>(".cq-campaign-buyer")!; expect(buyerSelect).toBeTruthy();
    for (let i = 0; i < 10 && buyerSelect.options.length < 2; i += 1) await settle(200);
    const buyer = Array.from(buyerSelect.options).find((option) => option.value)!; expect(buyer).toBeTruthy();
    await act(async () => { fireEvent.change(buyerSelect, { target: { value: buyer.value } }); }); await settle(600);
    expect(Number((table.callQaCampaigns as Row[]).find((row) => row.name === "PV Q4")?.buyerUserId)).toBe(Number(buyer.value));
    expect(dialog().querySelector(".cq-buyer")?.textContent).toContain(`Nur ${buyer.textContent} bekommt Leads aus „PV Q4“`);
    cleanup(); document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove());

    // am Gespräch: „im Dialer: …“, wenn der Name anders ist
    const wp = (table.callRecords as Row[]).find((row) => row.dialerCampaign === "WP Herbst Nord" && row.campaign === "Wärmepumpe Herbst" && row.status === "bewertet")!;
    window.history.replaceState(null, "", `/?page=Gespräche&callId=${wp.id}`); const detail = mount(); await settle(900);
    expect(detail.container.querySelector(".gq-dialer-campaign")?.textContent).toBe("im Dialer: WP Herbst Nord");
  });

  it("Leads einer Kampagne mit eigenem Käufer gehen nur an ihn (Vorschau wie Server)", async () => {
    const categories = await callProcedure("leadops.listCategories", undefined) as Array<{ id: number }>; const categoryId = categories[0].id;
    await callProcedure("leadops.createDeliveryChain", { categoryId, name: "V357 Kette", priority: 0, sellTarget: 1 });
    const chain = (await callProcedure("leadops.listDeliveryChains", undefined) as Array<{ id: number; name: string }>).find((row) => row.name === "V357 Kette")!;
    await callProcedure("leadops.addDeliveryStop", { chainId: chain.id, buyerName: "V357 Erster", position: 1, unitPrice: 20 });
    await callProcedure("leadops.updateDeliveryChain", { id: chain.id, status: "aktiv" });
    const tables = getStore().tables as unknown as Record<string, Array<Record<string, unknown>>>;
    const inChains = new Set([...tables.deliveryStops.map((stop) => Number(stop.buyerUserId)), ...tables.orderOperationalConfigs.map((config) => Number(config.buyerUserId))]);
    const target = (tables.users as Array<{ id: number }>).find((user) => !inChains.has(user.id))!; expect(target).toBeTruthy(); // ein Käufer, der in keiner Kette und keiner Bestellung steht
    await callProcedure("leadops.setCallQaCampaignBuyer", { campaign: "PV Q4", buyerUserId: target.id });
    const lead = await callProcedure("leadops.importLead", { categoryId, firstName: "Kira", lastName: "Kampagne", email: "kira.kampagne@example.de", city: "Bremen" }) as { publicId: string };
    const row = (getStore().tables.leads as unknown as Array<{ id: number; publicId: string }>).find((item) => item.publicId === lead.publicId)!;
    (getStore().tables.callRecords as unknown as Row[]).push({ id: 990001, tenantId: (tables.tenants[0] as { id: number }).id, provider: "ondialer", externalCallId: "V357-L1", leadId: row.id, campaign: "PV Q4", dialerCampaign: "PV Q4", status: "bewertet", decision: "freigegeben", createdAt: new Date(), startedAt: new Date() });
    await expect(callProcedure("leadops.deliverLead", { publicId: lead.publicId })).rejects.toThrow(/Kampagne „PV Q4“ liefert nur an/);
    await callProcedure("leadops.setCallQaCampaignBuyer", { campaign: "PV Q4", buyerUserId: null });
    const free = await callProcedure("leadops.deliverLead", { publicId: lead.publicId }) as { result: string };
    expect(["angeboten", "angenommen"]).toContain(free.result);
  });
});
