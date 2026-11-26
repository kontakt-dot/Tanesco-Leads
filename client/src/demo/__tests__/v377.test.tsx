import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";
import { dashboardRange } from "@/lib/dashboardPeriod";
import { WATTFOX, WATTFOX_TEMPLATE } from "../../../../shared/wattfox";
import type { EndpointTestTarget } from "../../../../shared/endpoint-test";

/**
 * Version 377 – Leads-Seite: Leiste ohne „Reklamiert“, Reiter und Filter-Knöpfe in einer Zeile, gespeicherte Filter löschen, Import mit Feld zum
 * Hineinziehen, „Testlead senden“ kennt die Schnittstellen der Käufer (Wattfox-Live: nur die Anmeldung). Dashboard: Reiter „Integrationen“,
 * Zeitraum „Erstellt ab“ / „Erstellt vor“. Menü: „Bestellungen“ heißt „Auslieferung“, „Haustür-Erfassung“ ist nicht mehr im Menü.
 * Lieferkette: deutlicher Streifen zum Aufklappen der Stationen.
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
async function until(check: () => boolean, tries = 40) { for (let index = 0; index < tries && !check(); index += 1) await settle(150); }
const click = async (node: Element | null | undefined, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const change = async (node: Element | null | undefined, value: string, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.change(node!, { target: { value } }); }); await settle(wait); };
const open = async (query: string, wait = 2400) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((node) => (node.textContent ?? "").trim());
const button = (root: ParentNode, text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((node) => (node.textContent ?? "").includes(text));
type Row = Record<string, any>;
const table = (name: string) => (getStore().tables as unknown as Record<string, Row[]>)[name];
const SAVED = "tanesco-lead-saved-views";
const emptyFilters = { categoryId: "", buyerId: "", supplierId: "", country: "", city: "", postcode: "", email: "", phone: "", createdFrom: "", createdTo: "", deliveredFrom: "", deliveredTo: "", minPrice: "", maxPrice: "", assignment: "alle", deliveryResult: "" };
const csv = (name: string, text: string, type = "text/csv") => { const file = new File([text], name, { type }); Object.defineProperty(file, "text", { value: async () => text }); return file; };
const found = (root: ParentNode) => root.querySelector(".lt-foot-count b")!.textContent;

describe("Version 377", () => {
  beforeEach(() => { cleanup(); resetStore(); try { localStorage.removeItem(SAVED); localStorage.removeItem("tanesco.dashboard-period"); localStorage.removeItem("tanesco.dashboard-open-range"); } catch { /* egal */ } });
  afterEach(() => { document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); cleanup(); resetStore(); try { localStorage.removeItem(SAVED); localStorage.removeItem("tanesco.dashboard-period"); localStorage.removeItem("tanesco.dashboard-open-range"); } catch { /* egal */ } });

  it("Menü: „Bestellungen“ heißt „Auslieferung“ (die Adresse bleibt), „Haustür-Erfassung“ steht nicht mehr im Menü – die Seite geht über ihre Adresse weiter auf", async () => {
    const root = await open("page=Bestellungen");
    const items = texts(root, ".flux-sidebar nav .nav-item > span");
    expect(items).toContain("Auslieferung"); expect(items).not.toContain("Bestellungen"); expect(items).not.toContain("Haustür-Erfassung"); expect(items).toContain("Lieferkette");
    expect(root.querySelector(".flux-sidebar nav .nav-item.active span")!.textContent).toBe("Auslieferung");
    expect(root.querySelector(".page-intro h1")!.textContent).toBe("Auslieferung"); expect(root.querySelector(".page-intro p")!.textContent).toContain("Bestellungen und ihre Lieferketten");
    expect(root.querySelector(".order-overview-head h2")!.textContent).toBe("Alle Bestellungen"); expect(button(root, "Bestellung anlegen")).toBeTruthy(); // drinnen heißt es weiter Bestellung
    expect(new URLSearchParams(window.location.search).get("page")).toBe("Bestellungen");
    // „Menüpunkte ein- oder ausblenden“ kennt denselben Namen und führt die Haustür-Erfassung nicht mehr
    await click(Array.from(root.querySelectorAll<HTMLButtonElement>(".sidebar-bottom .nav-item")).find((node) => node.textContent === "Menüpunkte"));
    const switches = texts(root, ".content-area .surface-panel label > span"); expect(switches).toContain("Auslieferung"); expect(switches).not.toContain("Bestellungen"); expect(switches).not.toContain("Haustür-Erfassung");
    // alte Adresse (Lesezeichen): die Seite ist noch da
    cleanup(); const old = await open("page=Haustür-Erfassung"); expect(old.querySelector("h1")!.textContent).toMatch(/Haustür/); expect(texts(old, ".flux-sidebar nav .nav-item > span")).not.toContain("Haustür-Erfassung");
  }, 60_000);

  it("Leads: Die Leiste hat vier Zahlen – ohne „Reklamiert“; Reiter und Filter-Knöpfe stehen in einer Zeile", async () => {
    const root = await open("page=Leads");
    expect(texts(root, ".lo-tile .lo-label")).toEqual(["Leads gesamt", "Heute neu", "Bereit zum Ausliefern", "Ausgeliefert"]);
    const row = root.querySelector(".lt-tabrow")!; expect(row).toBeTruthy();
    expect(row.querySelector(".lt-tabs")).toBeTruthy(); expect(row.querySelector(".lt-views")).toBeTruthy(); expect(row.firstElementChild!.classList.contains("lt-tabs")).toBe(true); // links die Reiter, rechts die Filter-Knöpfe
    expect(texts(row, ".lt-tabs button").map((text) => text.replace(/[\d.]+$/, ""))).toContain("Reklamiert"); // als Reiter der Tabelle bleibt „Reklamiert“
    expect(texts(row, ".lt-views > button")).toEqual(["Filter speichern"]); expect(row.querySelector(".lt-savedmenu")).toBeNull(); // noch nichts gespeichert, nichts gefiltert
    expect(root.querySelector(".lt-subtools .lt-views")).toBeNull(); // nicht mehr als eigene Zeile darunter
  }, 40_000);

  it("Gespeicherte Filter: speichern, laden, einzeln löschen (mit Rückfrage) und alle löschen", async () => {
    localStorage.setItem(SAVED, JSON.stringify([{ id: "a", name: "Nur Hamburg", filters: { ...emptyFilters, city: "Hamburg" }, activePeriod: "", sortMode: "created-desc" }, { id: "b", name: "Ohne Käufer", filters: { ...emptyFilters, assignment: "ohne_kaeufer" }, activePeriod: "", sortMode: "created-desc" }]));
    const root = await open("page=Leads"); const all = found(root);
    const menu = () => root.querySelector<HTMLDetailsElement>(".lt-savedmenu")!; const rows = () => texts(root, ".lt-saved-load"); const stored = () => (JSON.parse(localStorage.getItem(SAVED) ?? "[]") as Array<{ name: string }>).map((item) => item.name);
    expect(menu().querySelector("summary")!.textContent).toBe("Gespeicherte Filter2"); expect(rows()).toEqual(["Nur Hamburg", "Ohne Käufer"]);
    // laden: Der Filter gilt, das Menü geht zu
    menu().open = true; await click(root.querySelector(".lt-saved-load"), 1200);
    expect(menu().open).toBe(false); expect(button(root, "Filter (1)")).toBeTruthy(); expect(found(root)).not.toBe(all); expect(button(root, "Filter zurücksetzen")).toBeTruthy();
    const shown = texts(root, ".lt-row"); expect(shown.length).toBeGreaterThan(0); expect(shown.every((text) => /Hamburg/.test(text))).toBe(true);
    // „Filter zurücksetzen“ steht in derselben Zeile wie die Reiter
    expect(texts(root, ".lt-tabrow .lt-views > button")).toEqual(["Filter zurücksetzen", "Filter speichern"]);
    await click(button(root, "Filter zurücksetzen"), 900); expect(found(root)).toBe(all);
    // einzeln löschen: erst die Rückfrage – „Abbrechen“ lässt ihn stehen
    menu().open = true; const trash = () => Array.from(root.querySelectorAll<HTMLButtonElement>(".lt-saved-del"));
    expect(trash()[0].getAttribute("aria-label")).toBe("Gespeicherten Filter „Nur Hamburg“ löschen");
    await click(trash()[0], 300); const dialog = document.querySelector(".app-confirm")!; expect(dialog.textContent).toContain("Gespeicherten Filter „Nur Hamburg“ löschen?"); expect(dialog.querySelector(".app-confirm-ok")!.textContent).toBe("Löschen");
    await click(dialog.querySelector(".app-confirm-cancel"), 300); expect(rows()).toEqual(["Nur Hamburg", "Ohne Käufer"]);
    await click(trash()[0], 300); await click(document.querySelector(".app-confirm-ok"), 500);
    expect(rows()).toEqual(["Ohne Käufer"]); expect(stored()).toEqual(["Ohne Käufer"]); expect(menu().querySelector("summary")!.textContent).toBe("Gespeicherte Filter1");
    expect(root.querySelector(".lt-saved-all")).toBeNull(); // bei nur einem gibt es „Alle löschen“ nicht
    // neu speichern (Name über die Nachfrage) – dann „Alle gespeicherten Filter löschen“
    await click(button(root, "Filter speichern"), 300); const prompt = document.querySelector<HTMLInputElement>(".app-confirm-input")!; await act(async () => { prompt.value = "Alles"; }); await click(document.querySelector(".app-confirm-ok"), 500);
    expect(stored()).toEqual(["Alles", "Ohne Käufer"]); expect(rows()).toEqual(["Alles", "Ohne Käufer"]);
    menu().open = true; await click(root.querySelector(".lt-saved-all"), 300); expect(document.querySelector(".app-confirm")!.textContent).toContain("Alle 2 gespeicherten Filter löschen?");
    await click(document.querySelector(".app-confirm-ok"), 500); expect(root.querySelector(".lt-savedmenu")).toBeNull(); expect(stored()).toEqual([]);
  }, 80_000);

  it("Import: Die CSV-Datei lässt sich ins Feld ziehen – eine Excel-Datei wird mit einem Hinweis abgelehnt", async () => {
    const root = await open("page=Leads"); const category = table("leadCategories")[0];
    await click(button(root, "Leads importieren"));
    const drop = root.querySelector<HTMLElement>(".ld-drop")!; expect(drop).toBeTruthy(); expect(drop.textContent).toContain("CSV-Datei hierher ziehen"); expect(drop.textContent).toContain("oder klicken und Datei auswählen");
    expect(drop.querySelector<HTMLInputElement>('input[type="file"]')!.accept).toBe(".csv,text/csv"); expect(drop.tagName).toBe("LABEL"); // ein Klick öffnet die Dateiauswahl
    await change(root.querySelector('select[aria-label="Lead-Kategorie für den Import"]'), String(category.id), 300);
    // Datei schwebt darüber: Das Feld zeigt es
    await act(async () => { fireEvent.dragOver(drop, { dataTransfer: { files: [] } }); }); expect(drop.classList.contains("is-over")).toBe(true); expect(drop.textContent).toContain("Loslassen");
    // Excel-Datei: abgelehnt, keine Vorschau
    await act(async () => { fireEvent.drop(drop, { dataTransfer: { files: [csv("leads.xlsx", "PK…", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")] } }); }); await settle(400);
    expect(drop.classList.contains("is-over")).toBe(false); expect(root.textContent).not.toContain("gültige Zeilen erkannt");
    // CSV fallen lassen: eingelesen, der Dateiname steht im Feld
    await act(async () => { fireEvent.drop(drop, { dataTransfer: { files: [csv("meine-leads.csv", "Vorname;Nachname;PLZ;Ort\nClara;Beispiel;20095;Hamburg\nJonas;Muster;10115;Berlin")] } }); }); await settle(700);
    expect(root.textContent).toContain("2 gültige Zeilen erkannt"); expect(root.querySelector(".ld-drop-text b")!.textContent).toBe("meine-leads.csv"); expect(button(root, "2 Leads importieren")).toBeTruthy();
  }, 50_000);

  it("Testlead senden: Die Auswahl zeigt auch die Schnittstellen der Käufer – mit vorgegebener Kategorie; das Ergebnis steht im Fenster", async () => {
    const targets = await callProcedure("leadops.listEndpointTestTargets", undefined) as EndpointTestTarget[]; const endpoints = table("deliveryEndpoints").filter((row) => row.enabled);
    expect(targets.length).toBe(endpoints.length); expect(targets.length).toBeGreaterThan(0);
    const first = targets[0]; expect(Object.keys(first).sort()).toEqual(["buyerName", "categoryId", "categoryName", "host", "id", "kind", "membershipId"]); expect(first.kind).toBe("standard"); expect(first.host).toBe("crm.nordlicht-energie.example"); // ohne Adresse und Zugangsdaten
    const root = await open("page=Leads"); await click(button(root, "Testlead senden"), 900);
    const panel = root.querySelector<HTMLElement>(".ld-test")!; const select = () => panel.querySelector<HTMLSelectElement>('select[aria-label="Schnittstelle auswählen"]')!;
    const groups = Array.from(select().querySelectorAll("optgroup")).map((group) => group.label); expect(groups).toEqual(["Schnittstellen der Käufer", "Verbindungen aus Einstellungen → Integrationen"]);
    const option = select().querySelector<HTMLOptionElement>(`option[value="e:${first.id}"]`)!; expect(option.textContent).toBe(`${first.buyerName} · ${first.categoryName}`);
    expect(button(panel, "Testlead senden")!.disabled).toBe(true);
    // Schnittstelle gewählt: Die Kategorie gibt sie vor, das Ziel steht darunter (nur der Rechnername)
    await change(select(), `e:${first.id}`, 300);
    expect(panel.querySelector(".ld-fixed")!.textContent).toContain(first.categoryName); expect(panel.querySelector(".ld-fixed")!.textContent).toContain("von der Schnittstelle vorgegeben"); expect(panel.querySelector('select[aria-label="Lead-Kategorie auswählen"]')).toBeNull();
    expect(panel.querySelector(".ld-note")!.textContent).toContain("erfundener Lead ohne Kundendaten"); expect(panel.querySelector(".ld-note b")!.textContent).toBe(first.host);
    expect(panel.querySelector<HTMLAnchorElement>(".ld-note a")!.getAttribute("href")).toBe(`/?page=Benutzer&member=${first.membershipId}&tab=integration`);
    await click(button(panel, "Testlead senden"), 900); await until(() => panel.querySelector(".ld-result") !== null);
    const result = panel.querySelector(".ld-result")!; expect(result.classList.contains("is-ok")).toBe(true); expect(result.querySelector("strong")!.textContent).toBe("Angekommen (HTTP 200)"); expect(result.querySelector("details")!.textContent).toContain("Gesendete Daten ansehen");
    expect(button(panel, "Schließen")).toBeTruthy(); // das Fenster bleibt offen, bis man es schließt
    // eine Verbindung aus den Einstellungen: braucht eine Kategorie
    const integration = table("partnerIntegrations").find((row) => row.status === "aktiv" && row.callbackUrl)!;
    await change(select(), `i:${integration.id}`, 300); expect(panel.querySelector(".ld-result")).toBeNull(); expect(button(panel, "Testlead senden")!.disabled).toBe(true);
    await change(panel.querySelector('select[aria-label="Lead-Kategorie auswählen"]'), String(table("leadCategories")[0].id), 300); expect(button(panel, "Testlead senden")!.disabled).toBe(false);
    await click(button(panel, "Testlead senden"), 900); await until(() => panel.querySelector(".ld-result") !== null); expect(panel.querySelector(".ld-result strong")!.textContent).toMatch(/^Testlead TEST-\S+ (angekommen|nicht angenommen) \(HTTP /);
  }, 70_000);

  it("Testlead an eine Wattfox-Schnittstelle im Live-System: Es geht kein Lead raus – geprüft wird nur die Anmeldung", async () => {
    const endpoint = table("deliveryEndpoints").find((row) => row.enabled)!;
    Object.assign(endpoint, { url: WATTFOX.liveLeadsUrl, bodyTemplate: WATTFOX_TEMPLATE, authEnabled: true, auth: { loginUrl: WATTFOX.liveLoginUrl, credentials: [{ name: "user", value: "partner" }, { name: "pass", value: "geheim-nur-im-test" }], tokenPath: WATTFOX.tokenPath, headerName: WATTFOX.tokenHeader, prefix: "", ttlMinutes: WATTFOX.tokenMinutes } });
    const target = (await callProcedure("leadops.listEndpointTestTargets", undefined) as EndpointTestTarget[]).find((item) => item.id === endpoint.id)!;
    expect(target.kind).toBe("wattfox-live"); expect(JSON.stringify(target)).not.toContain("geheim-nur-im-test"); expect(JSON.stringify(target)).not.toContain("/v1/leads");
    const deliveries = table("leadDeliveries").length; const events = table("integrationEvents").length;
    const root = await open("page=Leads"); await click(button(root, "Testlead senden"), 900); const panel = root.querySelector<HTMLElement>(".ld-test")!;
    const select = panel.querySelector<HTMLSelectElement>('select[aria-label="Schnittstelle auswählen"]')!; expect(select.querySelector(`option[value="e:${endpoint.id}"]`)!.textContent).toContain("– Wattfox live");
    await change(select, `e:${endpoint.id}`, 300);
    const note = panel.querySelector(".ld-note")!; expect(note.classList.contains("is-live")).toBe(true); expect(note.textContent).toContain("Live-System von Wattfox"); expect(note.textContent).toContain("kein erfundener Lead"); expect(note.textContent).toContain("nur die Anmeldung");
    expect(button(panel, "Testlead senden")).toBeUndefined(); const check = button(panel, "Anmeldung prüfen")!; expect(check.disabled).toBe(false);
    await click(check, 900); await until(() => panel.querySelector(".ld-result") !== null);
    expect(panel.querySelector(".ld-result strong")!.textContent).toBe("Anmeldung klappt – es wurde kein Lead gesendet"); expect(panel.querySelector(".ld-result")!.textContent).toContain("Es wurde kein Lead gesendet"); expect(panel.querySelector(".ld-result details")).toBeNull();
    expect(table("leadDeliveries").length).toBe(deliveries); expect(table("integrationEvents").length).toBe(events); // nichts ging raus, nichts wurde als Zustellung gezählt
    // Testumgebung: dort gibt es wieder einen erfundenen Lead
    Object.assign(endpoint, { url: WATTFOX.leadsUrl }); const test = (await callProcedure("leadops.listEndpointTestTargets", undefined) as EndpointTestTarget[]).find((item) => item.id === endpoint.id)!; expect(test.kind).toBe("wattfox-test");
  }, 60_000);

  it("Dashboard: Der zweite Reiter heißt „Integrationen“; beim Zeitraum gibt es „Erstellt ab“ und „Erstellt vor“ – die Zahlen folgen", async () => {
    const root = await open("page=Dashboard&period=all", 3000);
    expect(texts(root, ".dashboard-tabs button")).toEqual(["Übersicht", "Integrationen"]);
    const periods = () => Array.from(root.querySelectorAll<HTMLButtonElement>('[aria-label="Dashboard-Zeitraum"] button')); expect(periods().map((node) => node.textContent)).toEqual(["Heute", "Diese Woche", "Letzte Woche", "Letzte 2 Wochen", "Dieser Monat", "Gesamt", "Erstellt ab", "Erstellt vor", "Eigener Zeitraum"]);
    const delivered = () => root.querySelector(".db-rail .db-stat strong")!.textContent; const note = () => root.querySelector(".dashboard-range-note strong")!.textContent;
    const count = async (range: { from: Date; until: Date }) => ((await callProcedure("leadops.statistics", { from: range.from, until: range.until })) as { delivered: number }).delivered;
    const total = await count(dashboardRange("all", "", "")); await until(() => delivered() === total.toLocaleString("de-DE")); expect(delivered()).toBe(total.toLocaleString("de-DE"));
    // Erstellt ab: ein Feld, die Zahlen zählen ab diesem Tag bis jetzt
    const day = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
    const german = (value: string) => value.split("-").reverse().join(".");
    await click(periods().find((node) => node.textContent === "Erstellt ab"), 900);
    const panel = () => root.querySelector<HTMLElement>(".db-open")!; expect(panel().getAttribute("aria-label")).toBe("Erstellt ab"); expect(panel().querySelectorAll('input[type="date"]')).toHaveLength(1); expect(root.querySelector('[aria-label="Eigener Zeitraum"]')).toBeNull();
    await change(panel().querySelector('input[aria-label="Dashboard: erstellt ab Tag"]'), day(-3), 1200);
    expect(note()).toBe(`ab ${german(day(-3))}`); expect(panel().querySelector(".dashboard-custom-summary")!.textContent).toBe(`4 Tage${german(day(-3))} – heute`);
    const since = await count(dashboardRange("since", day(-3), "")); await until(() => delivered() === since.toLocaleString("de-DE")); expect(delivered()).toBe(since.toLocaleString("de-DE"));
    expect(JSON.parse(localStorage.getItem("tanesco.dashboard-open-range")!).since).toBe(day(-3)); expect(localStorage.getItem("tanesco.dashboard-period")).toBe("since"); // die Wahl wird gemerkt
    // ein Tag in der Zukunft: gültig, aber leer
    await change(panel().querySelector('input[aria-label="Dashboard: erstellt ab Tag"]'), day(5), 1000); expect(panel().querySelector(".dashboard-custom-summary")!.textContent).toContain("liegt in der Zukunft"); await until(() => delivered() === "0"); expect(delivered()).toBe("0");
    // Erstellt vor: alles vor dem Tag – der Tag selbst zählt nicht mit; zusammen mit „ab demselben Tag“ ergibt es alles
    await click(periods().find((node) => node.textContent === "Erstellt vor"), 900); expect(panel().getAttribute("aria-label")).toBe("Erstellt vor");
    await change(panel().querySelector('input[aria-label="Dashboard: erstellt vor Tag"]'), day(-3), 1200);
    expect(note()).toBe(`vor ${german(day(-3))}`); expect(panel().querySelector(".dashboard-custom-summary")!.textContent).toBe(`bis ${german(day(-4))}alles davor, ohne Anfang`);
    const before = await count(dashboardRange("before", "", day(-3))); await until(() => delivered() === before.toLocaleString("de-DE")); expect(delivered()).toBe(before.toLocaleString("de-DE"));
    expect(before + since).toBeGreaterThanOrEqual(total); expect(since).toBeGreaterThan(0); expect(before).toBeGreaterThan(0); expect(before).toBeLessThan(total); // „vor“ und „ab“ demselben Tag teilen alles auf
    // ohne Tag: Hinweis statt Zahlen
    await change(panel().querySelector('input[aria-label="Dashboard: erstellt vor Tag"]'), "", 600); expect(panel().querySelector(".dashboard-custom-summary")!.classList.contains("is-invalid")).toBe(true); expect(panel().querySelector(".dashboard-custom-summary")!.textContent).toBe("Bitte einen Tag wählen.");
    // der Reiter „Integrationen“ zeigt die Partnerkonten unter eigener Überschrift
    await click(root.querySelectorAll(".dashboard-tabs button")[1], 1500); await until(() => root.querySelectorAll(".pr-card").length > 0); expect(root.querySelector(".page-intro h1")!.textContent).toBe("Integrationen"); expect(new URLSearchParams(window.location.search).get("page")).toBe("Statistik");
  }, 90_000);

  it("Gespräch: „Lead öffnen“ öffnet wirklich die Lead-Seite (vorher landete der Klick nur auf der Liste)", async () => {
    const call = table("callRecords").find((item) => item.leadId && table("leads").some((lead) => lead.id === item.leadId))!; expect(call).toBeTruthy(); const lead = table("leads").find((item) => item.id === call.leadId)!;
    const root = await open(`page=Gespräche&callId=${call.id}`, 1800); await until(() => Boolean(root.querySelector(".gq-lead-line .gq-link")));
    expect(root.querySelector(".gq-lead-line .gq-lead-id")!.textContent).toBe(lead.publicId);
    await click(root.querySelector(".gq-lead-line .gq-link"), 1500);
    const address = new URLSearchParams(window.location.search); expect(address.get("page")).toBe("Leads"); expect(address.get("lead")).toBe(lead.publicId); expect(address.get("leadId")).toBeNull();
    await until(() => Boolean(button(root, "Zurück zu den Leads"))); expect(button(root, "Zurück zu den Leads")).toBeTruthy(); // die Lead-Seite, nicht die Liste
    expect(root.querySelector(".flux-sidebar nav .nav-item.active span")!.textContent).toBe("Leads"); expect(root.querySelector(".lt-tabrow")).toBeNull();
    expect(root.querySelector("h1")!.textContent).toContain(String(lead.lastName ?? lead.firstName ?? lead.publicId));
  }, 40_000);

  it("Gespräch: unter Prüffragen und Kriterien stehen Opt-in-Nachweise, dann „Vom Dialer gemeldet“, am Ende das Transkript", async () => {
    const call = table("callRecords").find((item) => item.payload?.contact && item.leadId) ?? table("callRecords").find((item) => item.payload?.contact)!; expect(call).toBeTruthy();
    const root = await open(`page=Gespräche&callId=${call.id}`, 1800); await until(() => Boolean(root.querySelector(".gq-dialer")));
    const order = Array.from(root.querySelector(".gq-detail")!.children).map((node) => node.getAttribute("aria-label") ?? (node.querySelector(".opt-in-title") ? "Opt-in" : node.className.split(" ")[0]));
    const at = (label: string) => order.indexOf(label); expect(at("Vom Dialer gemeldet")).toBeGreaterThan(-1); expect(at("Transkript")).toBe(order.length - 1); expect(at("Vom Dialer gemeldet")).toBe(order.length - 2);
    if (call.leadId) { expect(at("Opt-in")).toBe(order.length - 3); }
  }, 40_000);

  it("Lieferkette: Jede Station hat einen deutlichen Streifen zum Auf- und Zuklappen", async () => {
    const root = await open("page=Lieferkette&chain=1", 2800); await until(() => root.querySelectorAll(".lk-track > .lk-stop").length > 0);
    const cards = () => Array.from(root.querySelectorAll<HTMLElement>(".lk-track > .lk-stop")); expect(cards().length).toBeGreaterThan(0);
    for (const card of cards()) { const toggle = card.querySelector<HTMLButtonElement>(".lk-stop-toggle")!; expect(toggle).toBeTruthy(); expect(toggle.getAttribute("aria-expanded")).toBe("false"); expect(toggle.textContent).toContain("Aufklappen"); expect(toggle.textContent).toContain("Reklamationsgründe, Gebiet und weitere Einstellungen dieser Station"); }
    const first = () => cards()[0]; expect(first().querySelector(".lk-stop-more")).toBeNull();
    await click(first().querySelector(".lk-stop-toggle"), 500);
    expect(first().querySelector(".lk-stop-more")).toBeTruthy(); expect(first().classList.contains("is-open")).toBe(true); expect(first().querySelector(".lk-stop-toggle")!.getAttribute("aria-expanded")).toBe("true"); expect(first().querySelector(".lk-stop-toggle span")!.textContent).toBe("Zuklappen"); expect(first().querySelector(".lk-stop-toggle small")).toBeNull();
    expect(first().querySelector(".lk-stop-name")!.getAttribute("aria-expanded")).toBe("true"); // der Name klappt weiter mit auf
    await click(first().querySelector(".lk-stop-toggle"), 500); expect(first().querySelector(".lk-stop-more")).toBeNull(); expect(first().querySelector(".lk-stop-toggle span")!.textContent).toBe("Aufklappen");
  }, 40_000);
});
