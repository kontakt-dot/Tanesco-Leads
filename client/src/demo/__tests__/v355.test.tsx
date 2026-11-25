import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IntegrationTab from "@/components/IntegrationTab";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";
import { WATTFOX, WATTFOX_TEMPLATE } from "../../../../shared/wattfox";

/**
 * Version 355 – Leads an Wattfox: Im Endpoint-Editor setzt „Vorlage Wattfox“ Anmeldung, Adresse der Testumgebung und den Body mit der Herkunft ein.
 * Nach dem Speichern schickt „Testleads an Wattfox senden (3)“ einen je Sparte (seit v357; „Alle 9“ die aus der früheren Mail) und zeigt die Nummern von Wattfox.
 */
type Member = { membershipId: number; userId: number; status: string };
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const byText = (root: ParentNode, selector: string, text: string | RegExp) => Array.from(root.querySelectorAll(selector)).find((node) => (typeof text === "string" ? node.textContent?.trim() === text : text.test(node.textContent ?? "")));
function mount(membershipId: number) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><IntegrationTab membershipId={membershipId} webhookUrl={null} /></QueryClientProvider></trpc.Provider>);
}
const type = async (input: Element | null | undefined, value: string) => { expect(input).toBeTruthy(); await act(async () => { fireEvent.change(input!, { target: { value } }); }); };

describe("Version 355", () => {
  beforeEach(() => { cleanup(); resetStore(); Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true }); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); });

  it("Vorlage Wattfox im Endpoint-Editor, speichern, 9 Testleads mit Nummern", async () => {
    const members = await callProcedure("leadops.listMembers", undefined) as Member[];
    const buyer = members.find((member) => member.status === "aktiv" && member.userId !== (getStore().tables.users as unknown as Array<{ id: number }>)[0].id && !(getStore().tables.deliveryEndpoints as unknown as Array<{ membershipId: number }>).some((row) => row.membershipId === member.membershipId)) ?? members[1];
    const view = mount(buyer.membershipId); await settle(1200);
    const root = view.container;
    await click(byText(root, "button", /^Photovoltaik/));
    await click(byText(root, "button", "Endpoint hinzufügen"));
    const editor = document.body.querySelector(".fixed.inset-0")!;
    expect(editor).toBeTruthy();
    await click(editor.querySelector(".ig-wattfox-template"));
    // Adresse der Testumgebung, Anmeldung mit Schlüssel 24 h, Body mit Herkunft
    expect((editor.querySelector('input[placeholder="https://api.dein-system.de/leads"]') as HTMLInputElement).value).toBe(WATTFOX.leadsUrl);
    expect((editor.querySelector('input[placeholder="https://partner.example/login"]') as HTMLInputElement).value).toBe(WATTFOX.loginUrl);
    expect((editor.querySelector(`#body-0`) as HTMLTextAreaElement).value).toBe(WATTFOX_TEMPLATE);
    expect(editor.querySelector(".ig-wattfox-note")?.textContent).toContain("Die Felder baut die Software selbst");
    expect(editor.querySelector(".ig-wattfox-note")?.textContent).toContain("Testumgebung von Wattfox");
    // Zugangsdaten eintragen (Feldnamen user/pass sind schon da) und speichern
    const secrets = Array.from(editor.querySelectorAll('.ig-credential input[data-secret]')); // seit v361: Benutzername lesbar, Passwort als Punkte
    expect(secrets).toHaveLength(2);
    await type(secrets[0], "testfirma"); await type(secrets[1], "geheim");
    await click(byText(editor, "button", "Speichern"), 1000);
    const saved = (getStore().tables.deliveryEndpoints as unknown as Array<{ id: number; membershipId: number; bodyTemplate: string; url: string; omitAutoFields: boolean; authEnabled: boolean; auth: { headerName: string; tokenPath: string; ttlMinutes: number; credentials: Array<{ name: string; value: string }> } }>).find((row) => row.membershipId === buyer.membershipId)!;
    expect(saved).toMatchObject({ url: WATTFOX.leadsUrl, bodyTemplate: WATTFOX_TEMPLATE, omitAutoFields: true, authEnabled: true, auth: { headerName: "X-AUTH-TOKEN", tokenPath: "auth_token", ttlMinutes: 1380 } });
    expect(saved.auth.credentials).toEqual([{ name: "user", value: "testfirma" }, { name: "pass", value: "geheim" }]);

    // wieder öffnen: Testleads senden → einer je Sparte (3 von 3), Nummern von Wattfox, kopierbar; „Alle 9“ → 9 von 9
    await click(byText(root, "button", "Bearbeiten"));
    const again = document.body.querySelector(".fixed.inset-0")!;
    expect(again.querySelector(".ig-wattfox-send")?.textContent).toBe("Testleads an Wattfox senden (3)");
    await click(again.querySelector(".ig-wattfox-send"), 1200);
    let panel = again.querySelector(".ig-wattfox-tests");
    expect(panel?.textContent).toContain("Testleads an Wattfox: 3 von 3 angekommen");
    expect(Array.from(panel?.querySelectorAll("li .font-medium") ?? []).map((node) => node.textContent)).toEqual(["✓ Photovoltaik", "✓ Wärmepumpe", "✓ PV mit Wärmepumpe"]);
    expect(panel?.textContent).toMatch(/Wattfox-Nr\. \d+/);
    await click(byText(panel!, "button", "Nummern kopieren"), 200);
    await click(again.querySelector(".ig-wattfox-send-all"), 1200);
    panel = again.querySelector(".ig-wattfox-tests");
    expect(panel?.textContent).toContain("Testleads an Wattfox: 9 von 9 angekommen");
    expect(panel?.querySelectorAll("li")).toHaveLength(9);
    expect(panel?.textContent).toContain("PV mit Wärmepumpe 1");
  });

  it("ohne Zugang: Abbruch mit klarem Hinweis – an eine Live-Adresse nur ausdrücklich", async () => {
    const members = await callProcedure("leadops.listMembers", undefined) as Member[];
    const buyer = members[1];
    const category = (await callProcedure("leadops.listCategories", undefined) as Array<{ id: number }>)[0];
    const base = { membershipId: buyer.membershipId, categoryId: category.id, enabled: true, method: "POST", url: WATTFOX.leadsUrl, sourceFilterMode: "alle", sourceSupplierIds: [], fieldFilters: [], headers: [], authEnabled: true, auth: { loginUrl: WATTFOX.loginUrl, credentials: [{ name: "user", value: "" }, { name: "pass", value: "" }], tokenPath: "auth_token", headerName: "X-AUTH-TOKEN", prefix: "", ttlMinutes: 1380 }, bodyTemplate: WATTFOX_TEMPLATE, omitAutoFields: true, rotate: false, valueMappings: [] };
    const saved = await callProcedure("leadops.saveDeliveryEndpoint", base) as { id: number };
    const result = await callProcedure("leadops.sendWattfoxTestLeads", { membershipId: buyer.membershipId, id: saved.id }) as { sent: number; ok: number; total: number; results: Array<{ response: string }> };
    expect(result).toMatchObject({ sent: 1, ok: 0, total: 3 }); expect(result.results[0].response).toContain("Anmeldung");
    await callProcedure("leadops.saveDeliveryEndpoint", { ...base, id: saved.id, url: "https://api-v1.photovoltaik-angebotsvergleich.de/v1/leads" });
    await expect(callProcedure("leadops.sendWattfoxTestLeads", { membershipId: buyer.membershipId, id: saved.id })).rejects.toThrow(/Live-System/);
  });
});
