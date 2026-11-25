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
 * Version 365 – Bestellungen: Leadmenge leer = unbegrenzt, Status nur noch Aktiv/Inaktiv („Offen“ heißt Inaktiv);
 * der Dialer ist ein echter Lieferant („OnDialer“) – wählbar in Bestellungen, die Leads aus Gesprächen hängen daran.
 * Wattfox: „Live-Adresse einsetzen“ lässt Benutzername und Passwort stehen; ungespeichert gibt es nur „Speichern“ mit Hinweis.
 * Endpoint: zwei Adressen hintereinander in einem Feld (alte beim Einfügen nicht gelöscht) – Hinweis, Speichern gesperrt.
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const change = async (node: Element | null | undefined, value: string, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.change(node!, { target: { value } }); }); await settle(wait); };
const open = async (query: string, wait = 1800) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
type Row = Record<string, any>;
const byText = (root: ParentNode, selector: string, text: string | RegExp) => Array.from(root.querySelectorAll(selector)).find((node) => (typeof text === "string" ? node.textContent?.trim() === text : text.test(node.textContent ?? "")));
function mountIntegration(membershipId: number) { const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }); const client = trpc.createClient({ links: [localDemoLink()] }); return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><IntegrationTab membershipId={membershipId} webhookUrl={null} /></QueryClientProvider></trpc.Provider>); }
const table = (name: string) => (getStore().tables as unknown as Record<string, Row[]>)[name];

describe("Version 365", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); });

  it("Bestellstatus: nur Aktiv und Inaktiv – eine neue („offene“) Bestellung steht auf Inaktiv; Aktiv bekommt Leads", async () => {
    const created = await callProcedure("leadops.createOrder", { name: "V365 Neu", buyerName: "V365 Käufer", categoryId: table("leadCategories")[0].id, quantity: null, unitPrice: 30, status: "offen" }) as { orderId: number };
    const root = await open(`page=Bestellungen&orderId=${created.orderId}&overview=1`, 2200);
    const select = () => root.querySelector<HTMLSelectElement>(`select[aria-label="Status für ${table("orders").find((row) => row.id === created.orderId)!.orderNumber}"]`)!;
    expect(Array.from(select().options).map((option) => option.textContent)).toEqual(["Aktiv", "Inaktiv"]);
    expect(select().value).toBe("pausiert"); expect(select().title).toBe("Inaktiv: bekommt keine Leads");
    await change(select(), "aktiv", 900);
    expect(table("orders").find((row) => row.id === created.orderId)!.status).toBe("aktiv");
    expect(table("orderOperationalConfigs").find((row) => row.orderId === created.orderId)!.active).toBe(true);
  }, 30_000);

  it("Leadmenge: leer = unbegrenzt (Hinweis im Formular, Übersicht ohne Prozent), mit Zahl wie bisher", async () => {
    const created = await callProcedure("leadops.createOrder", { name: "V365 Menge", buyerName: "V365 Käufer", categoryId: table("leadCategories")[0].id, quantity: null, unitPrice: 30, status: "offen" }) as { orderId: number };
    expect(table("orders").find((row) => row.id === created.orderId)!.quantity).toBeNull();
    const root = await open(`page=Bestellungen&orderId=${created.orderId}`, 2400);
    const quantity = () => Array.from(root.querySelectorAll<HTMLLabelElement>("label.order-form-field")).find((label) => label.textContent?.startsWith("Leadmenge"))!.querySelector<HTMLInputElement>("input")!;
    expect(quantity().value).toBe(""); expect(quantity().placeholder).toBe("unbegrenzt");
    expect(root.querySelector("#order-quantity-hint")!.textContent).toBe("Leer = unbegrenzt. Mit einer Zahl endet die Bestellung, sobald so viele Leads geliefert sind.");
    const save = () => Array.from(root.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Bestellung speichern");
    await change(quantity(), "120", 100); await click(save(), 1200);
    expect(table("orders").find((row) => row.id === created.orderId)!.quantity).toBe(120); expect(table("orderOperationalConfigs").find((row) => row.orderId === created.orderId)!.requestedQuantity).toBe(120);
    cleanup();
    const again = await open(`page=Bestellungen&orderId=${created.orderId}`, 2400);
    const field = Array.from(again.querySelectorAll<HTMLLabelElement>("label.order-form-field")).find((label) => label.textContent?.startsWith("Leadmenge"))!.querySelector<HTMLInputElement>("input")!;
    expect(field.value).toBe("120");
    await change(field, "", 100); await click(Array.from(again.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Bestellung speichern"), 1200);
    expect(table("orders").find((row) => row.id === created.orderId)!.quantity).toBeNull(); expect(table("orderOperationalConfigs").find((row) => row.orderId === created.orderId)!.requestedQuantity).toBe(0);
    cleanup();
    const overview = await open(`page=Bestellungen&orderId=${created.orderId}&overview=1`, 2200);
    const row = Array.from(overview.querySelectorAll<HTMLElement>(".order-stream-row")).find((node) => node.textContent?.includes("V365 Menge"))!;
    expect(row.querySelector(".order-progress-line")!.textContent).toBe("0geliefertunbegrenzt"); expect(row.querySelector(".order-progress-foot")!.textContent).toBe("Menge unbegrenzt · täglich"); // seit v366 mit Balken
  }, 40_000);

  it("Wattfox: „Live-Adresse einsetzen“ lässt das gespeicherte Passwort stehen – erst speichern, dann „Anmeldung prüfen“", async () => {
    const members = await callProcedure("leadops.listMembers", undefined) as Array<{ membershipId: number; userId: number; status: string }>;
    const buyer = members.find((member) => member.status === "aktiv" && member.userId !== table("users")[0].id && !table("deliveryEndpoints").some((row) => row.membershipId === member.membershipId)) ?? members[1];
    const view = mountIntegration(buyer.membershipId); await settle(1200);
    await click(byText(view.container, "button", /^Photovoltaik/));
    await click(byText(view.container, "button", "Endpoint hinzufügen"));
    let editor = document.body.querySelector(".fixed.inset-0")!;
    await click(editor.querySelector(".ig-wattfox-template"));
    const values = () => Array.from(document.body.querySelectorAll<HTMLInputElement>(".fixed.inset-0 .ig-credential input[data-secret]"));
    await change(values()[0], "firma-v365", 50); await change(values()[1], "geheim-v365", 50);
    await click(byText(editor, "button", "Speichern"), 1000);
    const stored = () => table("deliveryEndpoints").filter((row) => row.membershipId === buyer.membershipId).at(-1)!;
    expect(stored().url).toBe(WATTFOX.leadsUrl);
    // wieder öffnen: Passwort steht als „gespeichert“, der Benutzername lesbar
    await click(byText(view.container, "button", "Bearbeiten"));
    editor = document.body.querySelector(".fixed.inset-0")!;
    expect(values()[0].value).toBe("firma-v365"); expect(values()[1].value).toBe(""); expect(values()[1].placeholder).toBe("gespeichert – zum Ändern neu eintippen");
    expect(editor.querySelector(".ig-test-send")!.textContent).toBe("Test senden"); expect(editor.querySelector(".ig-address-unsaved")).toBeNull();
    // Live-Adresse einsetzen: Zugang bleibt; bis zum Speichern nur „Speichern“ mit Hinweis (Prüfen liefe sonst noch an die Testumgebung)
    await click(editor.querySelector(".ig-wattfox-live"), 200);
    expect(editor.querySelector(".ig-wattfox-address")!.textContent).toContain("Live-System von Wattfox");
    expect(values()[0].value).toBe("firma-v365"); expect(values()[1].placeholder).toBe("gespeichert – zum Ändern neu eintippen");
    expect(editor.querySelector(".ig-address-unsaved")!.textContent).toBe("Die Live-Adresse ist noch nicht gespeichert – erst „Speichern“, dann den Endpoint wieder öffnen: Unten rechts steht dann „Anmeldung prüfen“.");
    expect(editor.querySelector(".ig-test-send")).toBeNull(); expect(editor.querySelector(".ig-wattfox-send")).toBeNull(); expect(editor.querySelector(".ig-wattfox-send-all")).toBeNull();
    await click(byText(editor, "button", "Speichern"), 1000);
    expect(stored().url).toBe(WATTFOX.liveLeadsUrl); expect(stored().auth.loginUrl).toBe(WATTFOX.liveLoginUrl);
    expect(stored().auth.credentials).toEqual([{ name: "user", value: "firma-v365" }, { name: "pass", value: "geheim-v365" }]);
    // wieder öffnen: jetzt „Anmeldung prüfen“, kein Hinweis mehr
    await click(byText(view.container, "button", "Bearbeiten"));
    editor = document.body.querySelector(".fixed.inset-0")!;
    expect(editor.querySelector(".ig-test-send")!.textContent).toBe("Anmeldung prüfen"); expect(editor.querySelector(".ig-address-unsaved")).toBeNull();
  }, 30_000);

  it("Endpoint: zwei Adressen hintereinander – roter Hinweis unter dem Feld, Speichern gesperrt, bis nur eine dasteht", async () => {
    const members = await callProcedure("leadops.listMembers", undefined) as Array<{ membershipId: number; userId: number; status: string }>;
    const buyer = members.find((member) => member.status === "aktiv" && member.userId !== table("users")[0].id && !table("deliveryEndpoints").some((row) => row.membershipId === member.membershipId)) ?? members[1];
    const view = mountIntegration(buyer.membershipId); await settle(1200);
    await click(byText(view.container, "button", /^Wärmepumpe/));
    await click(byText(view.container, "button", "Endpoint hinzufügen"));
    const editor = document.body.querySelector(".fixed.inset-0")!;
    await click(editor.querySelector(".ig-wattfox-template"));
    const address = () => editor.querySelector<HTMLInputElement>('input[placeholder="https://api.dein-system.de/leads"]')!;
    const login = () => editor.querySelector<HTMLInputElement>('input[placeholder="https://partner.example/login"]')!;
    const save = () => byText(editor, "button", "Speichern") as HTMLButtonElement;
    const hint = "Hier stehen zwei Adressen hintereinander. Ins Feld klicken, alles markieren (Cmd + A, unter Windows Strg + A) und nur die eine Adresse einfügen.";
    expect(address().value).toBe(WATTFOX.leadsUrl); expect(editor.querySelector(".ig-glued")).toBeNull(); expect(save().disabled).toBe(false);
    // neue Adresse eingefügt, ohne die alte zu löschen
    await change(address(), `${WATTFOX.leadsUrl}${WATTFOX.liveLeadsUrl}`, 100);
    expect(Array.from(editor.querySelectorAll(".ig-glued")).map((node) => node.textContent)).toEqual([hint]);
    expect(address().getAttribute("aria-invalid")).toBe("true"); expect(save().disabled).toBe(true); expect(save().title).toBe("Erst die doppelte Adresse korrigieren");
    await change(address(), WATTFOX.liveLeadsUrl, 100);
    expect(editor.querySelector(".ig-glued")).toBeNull(); expect(save().disabled).toBe(false);
    // dasselbe bei der Anmelde-Adresse
    await change(login(), `${WATTFOX.loginUrl}${WATTFOX.liveLoginUrl}`, 100);
    expect(editor.querySelectorAll(".ig-glued").length).toBe(1); expect(login().getAttribute("aria-invalid")).toBe("true"); expect(save().disabled).toBe(true);
    await change(login(), WATTFOX.liveLoginUrl, 100);
    expect(editor.querySelector(".ig-glued")).toBeNull(); expect(save().disabled).toBe(false);
    // auch die Vorschau speichert so etwas nicht
    await expect(Promise.resolve().then(() => callProcedure("leadops.saveDeliveryEndpoint", { membershipId: buyer.membershipId, categoryId: table("leadCategories")[0].id, enabled: true, method: "POST", url: `${WATTFOX.leadsUrl}${WATTFOX.liveLeadsUrl}`, sourceFilterMode: "alle", sourceSupplierIds: [], fieldFilters: [], headers: [], authEnabled: false, auth: null, bodyTemplate: "", omitAutoFields: false, rotate: false, valueMappings: [] }))).rejects.toThrow("zwei Adressen hintereinander");
  }, 30_000);

  it("OnDialer ist ein echter Lieferant: wählbar, Liste und Leads aus Gesprächen hängen daran", async () => {
    const suppliers = await callProcedure("leadops.listSuppliers", undefined) as Array<{ id: number; name: string }>;
    const onDialer = suppliers.find((row) => row.name === "OnDialer")!; expect(onDialer).toBeTruthy();
    const batch = table("rawBatches").find((row) => row.name === "Kontakte vom Dialer")!; expect(batch.supplierId).toBe(onDialer.id);
    const fromCalls = table("leads").filter((row) => row.supplierName === "OnDialer"); expect(fromCalls.length).toBeGreaterThan(0);
    expect(fromCalls.every((row) => row.supplierId === onDialer.id)).toBe(true);
  }, 20_000);
});
