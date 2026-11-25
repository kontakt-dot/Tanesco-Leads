import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import IntegrationTab from "@/components/IntegrationTab";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";
import { WATTFOX } from "../../../../shared/wattfox";

/**
 * Version 364 – Wattfox geht live: „Live-Adresse einsetzen“ (Zugang leeren, neu eintippen) und „Anmeldung prüfen“ statt „Test senden“ –
 * prüft nur Adresse und Zugang, es geht kein Lead raus; Testleads nur noch für die Testumgebung.
 * Leads: Zeitraum „Letzter Monat“, „Erstellt zwischen …“ statt „Eigene Zeitspanne“.
 */
type Member = { membershipId: number; userId: number; status: string };
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const change = async (node: Element | null | undefined, value: string, wait = 900) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.change(node!, { target: { value } }); }); await settle(wait); };
const byText = (root: ParentNode, selector: string, text: string | RegExp) => Array.from(root.querySelectorAll(selector)).find((node) => (typeof text === "string" ? node.textContent?.trim() === text : text.test(node.textContent ?? "")));
function client() { const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return { queryClient, trpcClient: trpc.createClient({ links: [localDemoLink()] }) }; }
function mountIntegration(membershipId: number) { const { queryClient, trpcClient } = client(); return render(<trpc.Provider client={trpcClient} queryClient={queryClient}><QueryClientProvider client={queryClient}><IntegrationTab membershipId={membershipId} webhookUrl={null} /></QueryClientProvider></trpc.Provider>); }
function mountApp() { const { queryClient, trpcClient } = client(); return render(<trpc.Provider client={trpcClient} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>); }
type Lead = { id: number; kind?: string; createdAt: Date };
const localDay = (value: Date | string | number) => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };

describe("Version 364", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); });

  it("Wattfox live: Live-Adresse einsetzen leert den Zugang; gespeichert heißt der Knopf „Anmeldung prüfen“ – kein Lead, keine Testleads", async () => {
    const members = await callProcedure("leadops.listMembers", undefined) as Member[];
    const buyer = members.find((member) => member.status === "aktiv" && member.userId !== (getStore().tables.users as unknown as Array<{ id: number }>)[0].id && !(getStore().tables.deliveryEndpoints as unknown as Array<{ membershipId: number }>).some((row) => row.membershipId === member.membershipId)) ?? members[1];
    const view = mountIntegration(buyer.membershipId); await settle(1200);
    await click(byText(view.container, "button", /^Photovoltaik/));
    await click(byText(view.container, "button", "Endpoint hinzufügen"));
    let editor = document.body.querySelector(".fixed.inset-0")!;
    await click(editor.querySelector(".ig-wattfox-template"));
    const values = () => Array.from(document.body.querySelectorAll<HTMLInputElement>(".fixed.inset-0 .ig-credential input[data-secret]"));
    await change(values()[0], "testfirma", 50); await change(values()[1], "geheim", 50);
    expect(editor.querySelector(".ig-wattfox-address")!.textContent).toContain("Testumgebung von Wattfox");
    // auf Live umstellen: beide Adressen tauschen, der Zugang wird geleert (dort gilt ein anderer)
    await click(editor.querySelector(".ig-wattfox-live"), 200);
    expect(editor.querySelector(".ig-wattfox-address")!.textContent).toContain("Live-System von Wattfox");
    expect(Array.from(editor.querySelectorAll<HTMLInputElement>("input")).map((input) => input.value)).toEqual(expect.arrayContaining([WATTFOX.liveLeadsUrl, WATTFOX.liveLoginUrl]));
    expect(values().map((input) => input.value)).toEqual(["", ""]);
    expect(editor.querySelector(".ig-wattfox-live")!.textContent).toBe("Testumgebung einsetzen");
    await change(values()[0], "livefirma", 50); await change(values()[1], "livegeheim", 50);
    await click(byText(editor, "button", "Speichern"), 1000);
    const saved = (getStore().tables.deliveryEndpoints as unknown as Array<{ membershipId: number; url: string; auth: { loginUrl: string; credentials: Array<{ name: string; value: string }> } | null }>).filter((row) => row.membershipId === buyer.membershipId).at(-1)!;
    expect(saved.url).toBe(WATTFOX.liveLeadsUrl); expect(saved.auth?.loginUrl).toBe(WATTFOX.liveLoginUrl); expect(saved.auth?.credentials).toEqual([{ name: "user", value: "livefirma" }, { name: "pass", value: "livegeheim" }]);
    // wieder öffnen: „Anmeldung prüfen“ statt „Test senden“, keine Testleads-Knöpfe
    await click(byText(view.container, "button", "Bearbeiten"));
    editor = document.body.querySelector(".fixed.inset-0")!;
    const check = editor.querySelector<HTMLButtonElement>(".ig-test-send")!; expect(check.textContent).toBe("Anmeldung prüfen"); expect(check.title).toContain("es geht kein Lead raus");
    expect(editor.querySelector(".ig-wattfox-send")).toBeNull(); expect(editor.querySelector(".ig-wattfox-send-all")).toBeNull();
    const deliveriesBefore = (getStore().tables as unknown as Record<string, unknown[]>).deliveries?.length ?? 0;
    await click(check, 900);
    expect(editor.querySelector(".ig-test-title")!.textContent).toBe("Anmeldung: klappt");
    expect(editor.textContent).toContain("Es wurde kein Lead gesendet."); expect(byText(editor, "summary", "Gesendeter Body")).toBeUndefined();
    expect((getStore().tables as unknown as Record<string, unknown[]>).deliveries?.length ?? 0).toBe(deliveriesBefore);
  }, 30_000);

  it("Leads: „Letzter Monat“ zeigt genau den Vormonat; „Erstellt zwischen …“ statt „Eigene Zeitspanne“", async () => {
    window.history.replaceState(null, "", "/?page=Leads"); const view = mountApp(); await settle(2000); const root = view.container;
    const period = root.querySelector<HTMLSelectElement>('select[aria-label="Zeitraum auswählen"]')!;
    expect(Array.from(period.options).map((option) => option.textContent)).toEqual(["Gesamter Zeitraum", "Heute", "Gestern", "Diese Woche", "Letzte Woche", "Letzte 2 Wochen", "Dieser Monat", "Letzter Monat", "Erstellt zwischen …", "Erstellt ab …", "Erstellt vor …"]);
    const now = new Date(); const first = localDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)); const last = localDay(new Date(now.getFullYear(), now.getMonth(), 0));
    const all = (getStore().tables.leads as unknown as Lead[]).filter((lead) => (lead.kind ?? "verkauf") === "verkauf");
    await change(period, "last_month");
    const found = Number((root.querySelector(".lt-foot-count b")!.textContent ?? "").replace(/\./g, ""));
    expect(found).toBe(all.filter((lead) => localDay(lead.createdAt) >= first && localDay(lead.createdAt) <= last).length);
    await change(period, "custom", 500);
    const card = root.querySelector<HTMLElement>(".lt-custom")!;
    expect(Array.from(card.querySelectorAll(".lt-field > span")).map((node) => node.textContent)).toEqual(["Erstellt ab", "Erstellt bis"]);
    expect(card.querySelector(".lt-custom-note")!.textContent).toBe("Leads, die zwischen diesen Tagen kamen – beide Tage zählen mit.");
  }, 40_000);
});
