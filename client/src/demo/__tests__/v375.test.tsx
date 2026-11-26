import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";
import { WATTFOX_TEMPLATE } from "../../../../shared/wattfox";

/**
 * Version 375 – Statistik nur noch Integrationen, Menüpunkt „Integrationen“ weg (alte Links landen in den Einstellungen),
 * im Gespräch stehen „Vom Dialer gemeldet“ und „Opt-in-Nachweise“ unter dem Transkript, die Telefonie zeigt keine Listen-Marker mehr,
 * und „Angaben fehlen“ gilt nur für Käufer, die den Lead nach der Regel „Kampagne → Käufer“ überhaupt bekommen.
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
async function until(check: () => boolean, tries = 40) { for (let index = 0; index < tries && !check(); index += 1) await settle(150); }
const click = async (node: Element | null | undefined, wait = 500) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const open = async (query: string, wait = 2600) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
type Row = Record<string, any>;
const table = (name: string) => (getStore().tables as unknown as Record<string, Row[]>)[name];
const nextId = (name: string) => Math.max(0, ...table(name).map((row) => Number(row.id))) + 1;
const follows = (first: Element, second: Element) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
type Overview = { problems: Array<{ publicId: string; dataProblems: Array<{ field: string; title: string; hint: string; missing?: boolean }> }> };
const problemsOf = async (publicId: string) => ((await callProcedure("leadops.apiErrorOverview", { days: 30 })) as Overview).problems.find((problem) => problem.publicId === publicId)?.dataProblems ?? [];

describe("Version 375", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); resetStore(); });

  it("Statistik: nur noch Integrationen – keine Reiter, Überschrift nennt sie; das Seitenmenü hat keinen Punkt „Integrationen“ mehr", async () => {
    const root = await open("page=Statistik"); await until(() => root.querySelectorAll(".pr-card").length > 0);
    expect(root.querySelector("#dashboard-statistik .pr")).toBeTruthy(); expect(root.querySelectorAll(".pr-card").length).toBeGreaterThan(0);
    expect(root.querySelector("#dashboard-statistik .status-tabs")).toBeNull(); expect(root.querySelector(".pr-views")).toBeNull();
    expect(root.textContent).not.toContain("Käufer, Lieferanten und Bestellungen im Vergleich"); expect(root.textContent).not.toContain("-Perspektive");
    expect(root.querySelector(".page-intro h1")!.textContent).toBe("Statistik"); expect(root.querySelector(".page-intro .eyebrow")!.textContent).toContain("INTEGRATIONEN");
    expect(root.querySelector(".page-intro p")!.textContent).toContain("bei deinen Partnern");
    // alte Adresse mit „view“ (Lesezeichen): dieselbe Seite
    cleanup(); const old = await open("page=Statistik&view=Käufer"); await until(() => old.querySelectorAll(".pr-card").length > 0); expect(old.querySelectorAll(".pr-card").length).toBeGreaterThan(0); expect(old.querySelector(".status-tabs")).toBeNull();
    const items = Array.from(old.querySelectorAll(".flux-sidebar nav .nav-item span")).map((node) => node.textContent);
    expect(items).toContain("Benutzer"); expect(items).toContain("Kooperationen"); expect(items).not.toContain("Integrationen");
  }, 40000);

  it("Alter Link auf den Menüpunkt „Integrationen“ öffnet Einstellungen → Integrationen", async () => {
    const root = await open("page=Integrationen", 2200);
    expect(decodeURIComponent(window.location.search)).toBe("?page=Einstellungen&setting=Integrationen");
    await until(() => /Integrationen/.test(root.querySelector("h1")?.textContent ?? ""));
    expect(root.textContent).toContain("Aroundhome"); expect(root.querySelector(".flux-sidebar .sidebar-bottom .nav-item.active")?.textContent).toBe("Einstellungen");
  }, 30000);

  it("Gespräch: erst Prüffragen, Kriterien und Transkript – darunter „Vom Dialer gemeldet“ und die Opt-in-Nachweise", async () => {
    const call = table("callRecords").find((item) => item.payload?.contact && item.leadId) ?? table("callRecords").find((item) => item.payload?.contact)!; expect(call).toBeTruthy();
    const root = await open(`page=Gespräche&callId=${call.id}`, 1500); await until(() => Boolean(root.querySelector(".gq-dialer")));
    const transcript = root.querySelector('section[aria-label="Transkript"]')!; const dialer = root.querySelector(".gq-dialer")!; const decide = root.querySelector(".gq-decide")!;
    expect(transcript).toBeTruthy(); expect(dialer.querySelector("h2")!.textContent).toBe("Vom Dialer gemeldet");
    expect(follows(decide, transcript)).toBe(true); expect(follows(transcript, dialer)).toBe(true); // Entscheidung → Transkript → Dialer
    expect(follows(root.querySelector('section[aria-label="Prüffragen"]')!, dialer)).toBe(true); expect(follows(root.querySelector('section[aria-label="Kriterien"]')!, dialer)).toBe(true);
    const optIn = root.querySelector(".gq-detail .opt-in-title");
    if (call.leadId) { expect(optIn).toBeTruthy(); expect(follows(dialer, optIn!)).toBe(true); expect(follows(transcript, optIn!)).toBe(true); }
    expect(root.querySelector(".gq-detail")!.lastElementChild!.contains(optIn ?? dialer)).toBe(true); // die beiden Abschnitte stehen am Ende der Seite
  }, 30000);

  it("Telefonie → Kampagne: Listen-Marker stehen nicht bei den Tags; die Kampagne einer Liste behält sie und nennt die Liste", async () => {
    const tags = (await callProcedure("leadops.listTags", undefined)) as Array<{ id: number; name: string }>; const marker = tags.find((tag) => tag.name.startsWith("Liste: "))!; const real = tags.filter((tag) => !tag.name.startsWith("Liste: "));
    expect(marker).toBeTruthy(); expect(real.length).toBeGreaterThan(0);
    const saved = (await callProcedure("leadops.saveDialerCampaign", { name: "Kaltakquise: Probe", mode: "power", leadFilter: { tagIds: [marker.id], onlyWithoutCall: true, kind: "vertrieb" }, callerNumberId: null, maxAttempts: 3, retryMinutes: 240, wrapUpSeconds: 20, pacingRatio: null, autoNotes: null, callWindow: null, script: "" })) as { id: number };
    const root = await open("page=Telefonie&view=kampagnen"); await until(() => root.querySelectorAll(".tp-camp").length > 0);
    const card = Array.from(root.querySelectorAll(".tp-camp")).find((node) => node.querySelector(".tp-camp-head strong")!.textContent === "Kaltakquise: Probe")!;
    await click(Array.from(card.querySelectorAll("button")).find((node) => node.textContent?.trim() === "Bearbeiten"), 700);
    const dialog = Array.from(root.querySelectorAll("section")).find((node) => node.querySelector("h2")?.textContent === "Kampagne bearbeiten")!; expect(dialog).toBeTruthy();
    const chips = Array.from(dialog.querySelectorAll(".tp-tags button")).map((node) => node.textContent); expect(chips).toEqual(real.map((tag) => tag.name)); expect(chips.some((name) => name?.startsWith("Liste: "))).toBe(false);
    expect(dialog.textContent).not.toContain(marker.name); expect(dialog.querySelector(".tp-called-list")!.textContent).toContain(`Angerufen wird die Liste „${marker.name.slice("Liste: ".length)}“`);
    // ein echtes Tag dazuwählen und speichern: der Listen-Marker und die Art der Kontakte bleiben
    await click(dialog.querySelector(".tp-tags button"), 200); expect(dialog.querySelector(".tp-tags button")!.getAttribute("aria-pressed")).toBe("true");
    await click(Array.from(dialog.querySelectorAll("button")).find((node) => node.textContent?.trim() === "Speichern"), 900);
    const stored = (table("dialerCampaigns").find((row) => row.id === saved.id)!.leadFilter ?? {}) as { tagIds?: number[]; kind?: string };
    expect(stored.kind).toBe("vertrieb"); expect(stored.tagIds).toEqual([marker.id, real[0].id]);
    // neue Kampagne: nur echte Tags zur Auswahl, keine Zeile zu einer Liste
    await click(Array.from(root.querySelectorAll("button")).find((node) => node.textContent?.trim() === "Neue Kampagne"), 600);
    const fresh = Array.from(root.querySelectorAll("section")).find((node) => node.querySelector("h2")?.textContent === "Neue Kampagne")!;
    expect(Array.from(fresh.querySelectorAll(".tp-tags button")).map((node) => node.textContent)).toEqual(real.map((tag) => tag.name)); expect(fresh.querySelector(".tp-called-list")).toBeNull();
  }, 40000);

  it("API-Fehler: Die Anrede fehlt nur bei Leads, die der Käufer nach der Regel „Kampagne → Käufer“ bekommt", async () => {
    const pv = table("leadCategories").find((row) => row.name === "Photovoltaik")!; const sample = table("leads").find((row) => row.categoryId === pv.id && row.kind !== "vertrieb")!;
    const endpoint = table("deliveryEndpoints")[0]; const membership = table("memberships").find((row) => row.id === endpoint.membershipId)!; const buyer = table("users").find((row) => row.id === membership.userId)!; const buyerName = String(buyer.company ?? buyer.name);
    table("deliveryEndpoints").push({ ...endpoint, id: nextId("deliveryEndpoints"), categoryId: pv.id, enabled: true, bodyTemplate: WATTFOX_TEMPLATE, sourceFilterMode: "alle", sourceSupplierIds: null, fieldFilters: null, valueMappings: null });
    const lead = (publicId: string, firstName = "Bernd") => { const row = { ...sample, tenantId: pv.tenantId, categoryId: pv.id, id: nextId("leads"), publicId, kind: "verkauf", firstName, lastName: "Mustermann", email: "bernd.mustermann@example.de", phone: "+4915112340999", postcode: "48249", city: "Dülmen", country: "DE", status: "genehmigt", supplierId: null, supplierName: "OnDialer", assignedUserId: null, metadata: { street: "Hauptstraße 12" }, createdAt: new Date(), updatedAt: new Date() }; table("leads").push(row); return row; };
    const callFor = (leadId: number, campaign: string) => { const base = table("callRecords")[0]; table("callRecords").push({ ...base, id: nextId("callRecords"), leadId, campaign, decision: "freigegeben", payload: null, createdAt: new Date() }); };
    const own = lead("V375EIGEN", "Erika"); const other = lead("V375FREMD", "Franz"); const plain = lead("V375OHNE", "Otto");
    const anrede = (list: Array<{ field: string; hint: string }>) => list.filter((problem) => problem.field === "salutation");
    // ohne Bindung: alle drei brauchen die Anrede
    for (const row of [own, other, plain]) expect(anrede(await problemsOf(row.publicId)).map((problem) => problem.hint)).toEqual([`${buyerName} nimmt den Lead nur damit an.`]);
    // Kampagne „V375 Partner“ liefert nur an diesen Käufer: ihr Lead braucht die Anrede, der Lead einer anderen Kampagne nicht mehr, der Lead ohne Gespräch weiter
    const campaigns = table("callQaCampaigns"); campaigns.push({ ...(campaigns[0] ?? {}), id: nextId("callQaCampaigns"), tenantId: pv.tenantId, name: "V375 Partner", buyerUserId: buyer.id, dialerNames: null });
    callFor(own.id, "V375 Partner"); callFor(other.id, "V375 Andere Kampagne");
    expect(anrede(await problemsOf(own.publicId))).toHaveLength(1); expect(anrede(await problemsOf(other.publicId))).toHaveLength(0); expect(anrede(await problemsOf(plain.publicId))).toHaveLength(1);
    const root = await open("page=API-Fehler"); await until(() => root.querySelectorAll(".af-row").length > 0);
    const rowOf = (name: string) => Array.from(root.querySelectorAll<HTMLElement>(".af-row")).find((row) => row.querySelector(".af-name")?.textContent === name);
    await until(() => Boolean(rowOf("Erika Mustermann")));
    expect(rowOf("Erika Mustermann")!.textContent).toContain("Die Anrede fehlt"); expect(rowOf("Otto Mustermann")!.textContent).toContain("Die Anrede fehlt");
    expect(rowOf("Franz Mustermann")).toBeUndefined(); // der Lead aus der anderen Kampagne geht nie an diesen Käufer – ihm fehlt nichts
  }, 40000);
});
