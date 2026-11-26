import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";
import { presetByKey } from "../../../../shared/call-qa-presets";

/**
 * Version 358 – Benutzer-Seite neu (Kunden als Karten, Team als Liste), Willkommensmail nur mit Häkchen,
 * „Ausgelieferte Leads“ zählt nur echte Auslieferungen, „Kampagnen vom Dialer“ mit Hinweis, wenn noch nichts da ist,
 * neue Kampagne aus dem Dialer übernimmt die Regeln ihrer bisherigen, Käufer einer Kampagne bekommt keine Leads aus anderen.
 */
type Row = Record<string, unknown>;
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const type = async (input: HTMLInputElement | null | undefined, value: string) => { expect(input).toBeTruthy(); await act(async () => { fireEvent.change(input!, { target: { value } }); }); };
const tables = () => getStore().tables as unknown as Record<string, Row[]>;
const isCustomer = (row: Row) => row.partnerType === "käufer" && row.role !== "inhaber";

describe("Version 358", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); cleanup(); vi.restoreAllMocks(); resetStore(); });

  it("Benutzer: Kunden als Karten, Team als Liste, Filter und Suche; neuer Benutzer ohne Willkommensmail – außer mit Häkchen", async () => {
    const active = tables().memberships.filter((row) => row.status !== "deaktiviert");
    window.history.replaceState(null, "", "/?page=Benutzer"); let view = mount(); await settle(700);
    let root = view.container;
    expect(root.querySelectorAll(".bn-card").length).toBe(active.filter(isCustomer).length);
    expect(root.querySelectorAll(".bn-row").length).toBe(active.filter((row) => !isCustomer(row)).length);
    const segment = (label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>(".bn-segments button")).find((node) => node.textContent?.startsWith(label));
    await click(segment("Kunden"), 200); expect(root.querySelectorAll(".bn-row").length).toBe(0); expect(root.querySelectorAll(".bn-card").length).toBeGreaterThan(0);
    await click(segment("Team"), 200); expect(root.querySelectorAll(".bn-card").length).toBe(0); expect(root.querySelectorAll(".bn-row").length).toBeGreaterThan(0);
    await click(segment("Alle"), 200);
    // jede Karte zeigt Zahlung, Schnittstelle und Anmeldung; Lieferadressen zählen nur eingeschaltete
    const card = root.querySelector<HTMLElement>(".bn-card")!; expect(card.querySelector(".bn-facts")?.textContent).toMatch(/Zahlung.*Schnittstelle.*Anmeldung/);
    const withEndpoint = active.filter(isCustomer).find((member) => tables().deliveryEndpoints.some((endpoint) => endpoint.membershipId === member.id && endpoint.enabled !== false));
    if (withEndpoint) { const user = tables().users.find((row) => row.id === withEndpoint.userId)!; const title = String(user.company || user.name); const own = Array.from(root.querySelectorAll<HTMLElement>(".bn-card")).find((node) => node.querySelector(".bn-card-title b")?.textContent === title)!; expect(own.textContent).toMatch(/\d+ Lieferadresse/); }
    // Suche nach der Firma
    const title = card.querySelector(".bn-card-title b")!.textContent!;
    await type(root.querySelector<HTMLInputElement>(".bn-search input"), title); await settle(100);
    expect(Array.from(root.querySelectorAll(".bn-card .bn-card-title b")).map((node) => node.textContent)).toContain(title);
    expect(root.querySelectorAll(".bn-card").length).toBeLessThan(active.filter(isCustomer).length);
    await click(root.querySelector('.bn-search button[aria-label="Suche leeren"]'), 100); expect(root.querySelectorAll(".bn-card").length).toBe(active.filter(isCustomer).length);

    // Neuer Benutzer: Häkchen „Willkommensmail“ ist aus
    const openDialog = async () => { await click(Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent?.includes("Neuer Benutzer")), 300); return document.querySelector<HTMLElement>(".bn-welcome")!.closest("form")!; };
    const fill = async (form: HTMLElement, values: Record<string, string>) => { for (const [label, value] of Object.entries(values)) await type(Array.from(form.querySelectorAll("label")).find((node) => node.textContent?.trim().startsWith(label))?.querySelector("input"), value); };
    let form = await openDialog();
    const box = form.querySelector<HTMLInputElement>(".bn-welcome input[type=checkbox]")!; expect(box.checked).toBe(false);
    const submit = () => form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit().textContent).toBe("Anlegen");
    await fill(form, { Vorname: "Nina", Nachname: "Neukunde", Firma: "Beispiel Solar GmbH", "E-Mail": "nina.neukunde@beispiel.example", Passwort: "Sicher!Passwort2026" });
    await click(submit(), 900);
    const quiet = tables().users.find((row) => row.email === "nina.neukunde@beispiel.example")!; expect(quiet).toBeTruthy();
    const quietMembership = tables().memberships.find((row) => row.userId === quiet.id)!;
    expect(tables().emailEvents.filter((row) => row.membershipId === quietMembership.id)).toHaveLength(0);
    // in der Liste: Karte mit „noch nie angemeldet“
    cleanup(); window.history.replaceState(null, "", "/?page=Benutzer"); view = mount(); await settle(700); root = view.container;
    const fresh = Array.from(root.querySelectorAll<HTMLElement>(".bn-card")).find((node) => node.querySelector(".bn-card-title b")?.textContent === "Beispiel Solar GmbH")!;
    expect(fresh).toBeTruthy(); expect(fresh.textContent).toContain("noch nie angemeldet"); expect(fresh.textContent).toContain("noch keine");
    // mit Häkchen: Willkommensmail wie bisher
    form = await openDialog();
    await act(async () => { fireEvent.click(form.querySelector<HTMLInputElement>(".bn-welcome input[type=checkbox]")!); });
    expect(submit().textContent).toBe("Anlegen und Mail schicken");
    await fill(form, { Vorname: "Wim", Nachname: "Willkommen", Firma: "Beispiel Wärme GmbH", "E-Mail": "wim.willkommen@beispiel.example", Passwort: "Sicher!Passwort2026" });
    await click(submit(), 900);
    const welcomed = tables().users.find((row) => row.email === "wim.willkommen@beispiel.example")!; const welcomedMembership = tables().memberships.find((row) => row.userId === welcomed.id)!;
    expect(tables().emailEvents.filter((row) => row.membershipId === welcomedMembership.id).map((row) => String(row.kind))).toContain("willkommen");
  }, 30_000);

  it("Dashboard: neue Leads ohne Auslieferung erhöhen „Ausgelieferte Leads“ nicht", async () => {
    window.history.replaceState(null, "", "/?page=Dashboard"); let view = mount(); await settle(900);
    const tile = () => Array.from(view.container.querySelectorAll<HTMLElement>(".db-stat")).find((node) => node.textContent?.includes("Ausgelieferte Leads"))?.querySelector("strong")?.textContent ?? null;
    const before = tile(); expect(before).toMatch(/^\d+$/);
    const categoryId = (await callProcedure("leadops.listCategories", undefined) as Array<{ id: number }>)[0].id;
    for (let i = 1; i <= 3; i += 1) await callProcedure("leadops.importLead", { categoryId, firstName: "Nora", lastName: `Neu${i}`, email: `nora.neu${i}@beispiel.example`, city: "Kassel" });
    cleanup(); view = mount(); await settle(900);
    expect(tile()).toBe(before);
  });

  it("Gespräche: „Kampagnen vom Dialer“ mit Hinweis, solange kein Name ankam; „Das schickt der Dialer mit“ nennt die Kampagne", async () => {
    for (const row of tables().callRecords) row.dialerCampaign = null;
    window.history.replaceState(null, "", "/?page=Gespräche"); let view = mount(); await settle(600);
    await click(Array.from(view.container.querySelectorAll<HTMLButtonElement>(".cq-tool")).find((node) => /Einstellen/.test(node.textContent ?? "")), 700);
    const dialog = Array.from(document.querySelectorAll<HTMLElement>(".cq-dialog")).pop()!;
    const empty = dialog.querySelector<HTMLElement>(".cq-dialer-map.is-empty"); expect(empty).toBeTruthy();
    expect(empty!.textContent).toContain("Noch kein Gespräch mit Kampagnenname vom Dialer");
    cleanup(); window.history.replaceState(null, "", "/?page=Gespräche&view=Einstellungen"); view = mount(); await settle(1000);
    let panel = view.container.querySelector<HTMLElement>(".gs-intake");
    if (!panel) { await click(Array.from(view.container.querySelectorAll("button")).find((node) => node.textContent?.includes("Dialer & Bewertung")), 900); panel = view.container.querySelector<HTMLElement>(".gs-intake"); }
    expect(Array.from(panel!.querySelectorAll(".gs-intake-sent li")).map((node) => node.textContent ?? "").some((text) => text.startsWith("Kampagne"))).toBe(true);
  });

  it("Neue Kampagne aus dem Dialer übernimmt die Regeln ihrer bisherigen; Verschieben nimmt fremde Nachprüfungen zurück; Käufer einer Kampagne bekommt keine Leads aus anderen", async () => {
    const preset = presetByKey("wattfox-pv-wp")!;
    const pv = tables().callQaCampaigns.find((row) => row.name === "PV Q4")!; Object.assign(pv, { questions: preset.questions, criteria: preset.criteria, instructions: preset.instructions, presetKey: preset.key });
    const tenantId = (tables().tenants[0] as { id: number }).id;
    const dialerName = "V358 FB PV & WP - FOX";
    const calls = [990201, 990202].map((id) => ({ id, tenantId, provider: "ondialer", externalCallId: `V358-${id}`, leadId: null, campaign: "PV Q4", dialerCampaign: dialerName, status: "bewertet", decision: "freigegeben", decidedBy: "automatisch", transcript: "Agent: Guten Tag. Kunde: Ja.", qualificationAnswers: Object.fromEntries(preset.questions.map((question) => [question.key, { answer: "ja" }])), createdAt: new Date(), startedAt: new Date() }));
    tables().callRecords.push(...calls);
    const created = await callProcedure("leadops.assignDialerCampaign", { dialerName, campaign: "V358 FB", moveExisting: true }) as { created: boolean; moved: number; inheritedFrom: string | null };
    expect(created).toMatchObject({ created: true, moved: 2, inheritedFrom: "PV Q4" });
    const fb = tables().callQaCampaigns.find((row) => row.name === "V358 FB")!;
    expect(fb.questions).toEqual(preset.questions); expect(fb.criteria).toEqual(preset.criteria); expect(fb.presetKey).toBe(preset.key); expect(fb.buyerUserId ?? null).toBeNull();
    // fremde Nachprüfung (Frage gibt es in „PV Q4“ nicht) → beim Zurückverschieben zurückgenommen; eigene bleibt
    const own = preset.questions.find((question) => question.rule === "ko")!;
    const [foreignCall, ownCall] = calls.map((call) => tables().callRecords.find((row) => row.id === call.id)!);
    Object.assign(foreignCall, { decision: "zurueckgewiesen", recheckFrom: "freigegeben", nextStep: "Nachprüfung: Pflichtfrage „Hat der Mitarbeiter HausKompass genannt?“ = Nein" });
    Object.assign(ownCall, { decision: "zurueckgewiesen", recheckFrom: "freigegeben", nextStep: `Nachprüfung: K.-o.: „${own.label}“ = Nein` });
    expect(await callProcedure("leadops.assignDialerCampaign", { dialerName, campaign: "PV Q4", moveExisting: true })).toMatchObject({ created: false, moved: 2, reverted: 1 });
    expect(foreignCall).toMatchObject({ campaign: "PV Q4", decision: "freigegeben", recheckFrom: null }); expect(String(foreignCall.nextStep)).toContain("Nachprüfung zurückgenommen");
    expect(ownCall).toMatchObject({ campaign: "PV Q4", decision: "zurueckgewiesen", recheckFrom: "freigegeben" });

    // Käufer der Kampagne „PV Q4“ steht als erster Stop in der Kette: Leads aus einer anderen Kampagne überspringen ihn – mit Grund
    const categoryId = (await callProcedure("leadops.listCategories", undefined) as Array<{ id: number }>)[0].id;
    await callProcedure("leadops.createDeliveryChain", { categoryId, name: "V358 Kette", priority: 0, sellTarget: 1 });
    const chain = (await callProcedure("leadops.listDeliveryChains", undefined) as Array<{ id: number; name: string }>).find((row) => row.name === "V358 Kette")!;
    await callProcedure("leadops.addDeliveryStop", { chainId: chain.id, buyerName: "V358 Gebunden", position: 1, unitPrice: 20 });
    await callProcedure("leadops.addDeliveryStop", { chainId: chain.id, buyerName: "V358 Frei", position: 2, unitPrice: 15 });
    await callProcedure("leadops.updateDeliveryChain", { id: chain.id, status: "aktiv" });
    const buyer = tables().users.find((user) => tables().memberships.some((row) => row.userId === user.id && isCustomer(row) && row.status === "aktiv"))!;
    tables().deliveryStops.find((stop) => stop.chainId === chain.id && stop.position === 1)!.buyerUserId = buyer.id;
    await callProcedure("leadops.setCallQaCampaignBuyer", { campaign: "PV Q4", buyerUserId: buyer.id });
    const lead = await callProcedure("leadops.importLead", { categoryId, firstName: "Lea", lastName: "Andere", email: "lea.andere@beispiel.example", city: "Kiel" }) as { publicId: string };
    const leadRow = tables().leads.find((row) => row.publicId === lead.publicId)!;
    tables().callRecords.push({ id: 990203, tenantId, provider: "ondialer", externalCallId: "V358-L1", leadId: leadRow.id, campaign: "Wärmepumpe Herbst", dialerCampaign: "WP Herbst Nord", status: "bewertet", decision: "freigegeben", createdAt: new Date(), startedAt: new Date() });
    await callProcedure("leadops.deliverLead", { publicId: lead.publicId, chainId: chain.id });
    const rows = tables().leadDeliveries.filter((row) => row.leadId === leadRow.id);
    const skipped = rows.find((row) => row.buyerName === "V358 Gebunden")!; expect(skipped).toMatchObject({ result: "übersprungen" }); expect(String(skipped.skipReason)).toContain("bekommt nur Leads aus „PV Q4“");
    expect(rows.some((row) => row.buyerName === "V358 Frei" && ["angeboten", "angenommen"].includes(String(row.result)))).toBe(true);
  });
});
