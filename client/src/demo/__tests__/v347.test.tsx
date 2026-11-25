import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";

/**
 * Version 347 – Leads und Gespräche:
 *  Leads-Tabelle (wird direkt gebaut, alles mittig, bleibt nach „Zurück“ vollständig, Zahlen je Reiter, Kacheln als Filter, Export als
 *  Excel oder CSV, Leiste für ausgewählte Leads), Lead-Seite (Felder und Antworten aus dem Gespräch, keine Vermerke der Software),
 *  Lead-Puls (alle Leads im festen Fenster, Klick öffnet den Lead), Suche in den Gesprächen, Rohdaten (Liste ohne offene Kontakte).
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 500) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const type = async (node: Element | null | undefined, value: string, wait = 200) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.change(node!, { target: { value } }); }); await settle(wait); };
const open = async (query: string, wait = 1500) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
/** Warten, bis etwas gilt – die Liste mit 200 Gesprächen braucht in der Testumgebung mal eine, mal drei Sekunden. */
const until = async (check: () => boolean, max = 20_000) => { const start = Date.now(); while (!check() && Date.now() - start < max) await settle(250); };
const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((node) => (node.textContent ?? "").trim());
/** Name in der Leads-Tabelle – ohne die Flagge davor. */
const leadNames = (root: ParentNode) => Array.from(root.querySelectorAll(".lt-row .lt-name strong")).map((strong) => (strong.textContent ?? "").replace(strong.querySelector(".lt-flag")?.textContent ?? "", "").trim());
type Lead = { id: number; publicId: string; firstName: string | null; lastName: string | null; status: string; kind?: string; categoryId: number; createdAt: Date; metadata: Record<string, unknown> | null };
const salesLeads = () => (getStore().tables.leads as unknown as Lead[]).filter((lead) => (lead.kind ?? "verkauf") === "verkauf");

describe("Version 347", () => {
  beforeEach(() => { cleanup(); resetStore(); try { localStorage.removeItem("tanesco-lead-hidden-columns"); localStorage.removeItem("tanesco-lead-saved-views"); } catch { /* egal */ } });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); });

  it("Leads-Tabelle: vollständig – auch nach „Zurück“ von einem Lead; rechts Preis, Ansicht und Lead-Log; Zahlen an jedem Reiter", async () => {
    const root = await open("page=Leads", 2000);
    const head = () => texts(root, ".lt-head .lt-c"); const full = head();
    expect(full.slice(0, 3)).toEqual(["", "ID", "Lead"]); expect(full).toEqual(expect.arrayContaining(["Kategorie", "E-Mail", "Status", "Geliefert", "Käufer", "Preis", "Ansicht"])); expect(full[full.length - 1]).toBe("Ansicht");
    const rows = () => Array.from(root.querySelectorAll<HTMLElement>(".lt-row")); expect(rows()).toHaveLength(25);
    // jede Zeile: so viele Zellen wie der Kopf, Preis und zwei Knöpfe (Ansicht, Lead-Log) ganz rechts
    for (const row of rows().slice(0, 6)) { expect(row.querySelectorAll(":scope > .lt-c")).toHaveLength(full.length); expect(row.querySelector(".lt-price .lt-pill-price")!.textContent).toMatch(/€/); expect(row.querySelectorAll(".lt-actions .lt-act")).toHaveLength(2); expect(row.querySelector(".lt-delivered")!.textContent).toMatch(/^(gerade eben|vor \d+ Min\.|Heute \d{2}:\d{2}|Gestern \d{2}:\d{2}|\d{2}\.\d{2}\. \d{2}:\d{2}|\d{2}\.\d{2}\.\d{2})$/); } // seit v366: wie frisch der Lead ist („vor 12 Min.“, „Heute 17:28“)
    // „Geliefert“ ist nie leer: Es zeigt, wann der Lead ankam – auch bei Leads, die noch an keinen Käufer gingen
    expect(texts(root, ".lt-row .lt-delivered").every((text) => text !== "—" && text.length > 0)).toBe(true);
    // Reiter mit Zahlen – sie stammen aus denselben Filtern wie die Tabelle
    const all = salesLeads(); const tab = (label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>(".lt-tabs button")).find((button) => button.firstChild?.textContent === label)!;
    expect(texts(root, ".lt-tabs button").map((text) => text.replace(/[\d.]+$/, ""))).toEqual(["Alle", "Neu", "Freigegeben", "Zugewiesen", "Reklamiert", "Fehlerhaft", "Hängend", "Deaktiviert", "Dubletten"]);
    expect(tab("Alle").querySelector("span")!.textContent).toBe(String(all.length)); expect(tab("Freigegeben").querySelector("span")!.textContent).toBe(String(all.filter((lead) => lead.status === "genehmigt").length));
    await click(tab("Freigegeben"), 700); expect(root.querySelector(".lt-foot-count")!.textContent).toBe(`${all.filter((lead) => lead.status === "genehmigt").length} Leads gefunden`); expect(texts(root, ".lt-row .lt-pill-status").every((text) => text === "Freigegeben")).toBe(true);
    await click(tab("Alle"), 700);
    // Lead öffnen und zurück: Die Tabelle ist dieselbe (früher fehlten danach die rechten Spalten und das Lead-Log)
    const firstName = leadNames(root)[0]; await click(rows()[0].querySelector(".lt-name"), 900);
    expect(root.querySelector(".lt")).toBeNull(); expect(root.querySelector("h1")!.textContent).toBe(firstName); // Lead-Seite
    await click(Array.from(root.querySelectorAll("button")).find((button) => button.textContent?.includes("Zurück zu den Leads")), 900);
    expect(head()).toEqual(full); expect(rows()).toHaveLength(25); expect(rows()[0].querySelectorAll(".lt-actions .lt-act")).toHaveLength(2); expect(rows()[0].querySelector(".lt-price .lt-pill-price")).toBeTruthy(); expect(root.querySelector(".lt-columns summary")).toBeTruthy();
    // Lead-Log direkt aus der Zeile
    await click(rows()[0].querySelectorAll(".lt-actions .lt-act")[1], 800); expect(document.querySelector('[role="dialog"][aria-label^="Lead-Log"]')).toBeTruthy();
  }, 40_000);

  it("Leads: Spalten ein- und ausblenden, Kacheln und Säulen filtern, die Suche findet „Vorname Nachname“", async () => {
    const root = await open("page=Leads", 2000);
    const head = () => texts(root, ".lt-head .lt-c");
    expect(head()).not.toContain("Telefon"); // Telefon ist anfangs ausgeblendet
    await click(root.querySelector(".lt-columns summary"), 200); const box = (label: string) => Array.from(root.querySelectorAll<HTMLLabelElement>(".lt-columns-menu label")).find((item) => item.textContent === label)!.querySelector("input")!;
    await click(box("Telefon"), 300); expect(head()).toContain("Telefon"); await click(box("E-Mail"), 300); expect(head()).not.toContain("E-Mail"); expect(JSON.parse(localStorage.getItem("tanesco-lead-hidden-columns")!)).toEqual(["assigned", "email"]);
    // Kacheln: Zahlen aus allen Leads; „Heute neu“ und „Bereit zum Ausliefern“ setzen den Filter (seit Version 349 fünf Kacheln – jede zeigt genau ihre Leads)
    const all = salesLeads(); const today = new Date().toDateString(); const tiles = () => Array.from(root.querySelectorAll<HTMLButtonElement>(".lo-tile"));
    expect(texts(root, ".lo-tile .lo-label")).toEqual(["Leads gesamt", "Heute neu", "Bereit zum Ausliefern", "Ausgeliefert", "Reklamiert"]); expect(tiles()[0].querySelector("strong")!.textContent).toBe(String(all.length)); expect(tiles()[0].classList.contains("is-active")).toBe(true);
    const todayCount = all.filter((lead) => new Date(lead.createdAt).toDateString() === today).length; expect(tiles()[1].querySelector("strong")!.textContent).toBe(String(todayCount));
    await click(tiles()[1], 900); expect(tiles()[1].classList.contains("is-active")).toBe(true); expect(root.querySelector(".lt-foot-count")!.textContent).toBe(`${todayCount} ${todayCount === 1 ? "Lead" : "Leads"} gefunden`);
    // seit v366 folgen die Kacheln dem Zeitraum: Bei „Heute“ zählt „Bereit zum Ausliefern“ nur die freigegebenen von heute – ein Klick zeigt genau diese
    const readyToday = all.filter((lead) => lead.status === "genehmigt" && new Date(lead.createdAt).toDateString() === today).length; expect(tiles()[2].querySelector("strong")!.textContent).toBe(String(readyToday));
    await click(tiles()[2], 900); expect(root.querySelector(".lt-tabs button.active")!.firstChild!.textContent).toBe("Freigegeben"); expect(root.querySelector(".lt-foot-count b")!.textContent).toBe(String(readyToday)); expect(tiles()[2].classList.contains("is-active")).toBe(true);
    await click(tiles()[0], 900); expect(root.querySelector(".lt-foot-count b")!.textContent).toBe(String(all.length)); expect(root.querySelector(".lt-tabs button.active")!.firstChild!.textContent).toBe("Alle");
    // 14 Säulen, die letzte ist heute – ein Klick zeigt die Leads dieses Tages, ein zweiter nimmt den Filter wieder weg
    const bars = () => Array.from(root.querySelectorAll<HTMLButtonElement>(".lo-bar")); expect(bars()).toHaveLength(14); expect(bars()[13].classList.contains("is-today")).toBe(true); expect(bars()[13].getAttribute("aria-label")).toContain(`${todayCount} ${todayCount === 1 ? "Lead" : "Leads"}`);
    await click(bars()[13], 900); expect(bars()[13].getAttribute("aria-pressed")).toBe("true"); expect(root.querySelector(".lt-foot-count b")!.textContent).toBe(String(todayCount)); await click(bars()[13], 900); expect(root.querySelector(".lt-foot-count b")!.textContent).toBe(String(all.length));
    // Suche nach ganzem Namen
    await type(root.querySelector('input[aria-label="Leads durchsuchen"]'), "Martin Albrecht", 900); expect(leadNames(root)).toEqual(["Martin Albrecht"]);
    await click(root.querySelector(".lt-search-clear"), 800); expect(root.querySelectorAll(".lt-row")).toHaveLength(25);
  }, 40_000);

  it("Leads exportieren: Excel oder CSV – ohne Auswahl alle gefundenen, mit Auswahl nur diese; die Tabelle trägt die Felder der Kategorie", async () => {
    const saved: Array<{ name: string; type: string }> = []; const realCreate = document.createElement.bind(document);
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => { saved.push({ name: "", type: (blob as Blob).type }); return "blob:probe"; }); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string, options?: ElementCreationOptions) => { const node = realCreate(tag, options); if (tag === "a") (node as HTMLAnchorElement).click = function clickLink(this: HTMLAnchorElement) { if (saved.length) saved[saved.length - 1].name = this.download; }; return node; }) as typeof document.createElement);
    const root = await open("page=Leads", 2000); const all = salesLeads();
    const menuButton = () => root.querySelector<HTMLButtonElement>(".lt-export > button")!; expect(menuButton().disabled).toBe(false); expect(menuButton().textContent).toContain("Leads exportieren");
    await click(menuButton(), 300); expect(root.querySelector(".lt-export-menu p")!.textContent).toBe(`Alle ${all.length} gefundenen Leads`); expect(texts(root, ".lt-export-menu button b")).toEqual(["Excel", "CSV"]);
    await click(root.querySelectorAll(".lt-export-menu button")[1], 1200); // CSV, ohne Auswahl
    expect(saved).toHaveLength(1); expect(saved[0].type).toContain("text/csv"); expect(saved[0].name).toMatch(/^Leads \d{4}-\d{2}-\d{2}\.csv$/); expect(root.querySelector(".lt-export-menu")).toBeNull();
    // drei Leads anhaken → Menü nennt die Auswahl, Excel-Datei
    const boxes = Array.from(root.querySelectorAll<HTMLInputElement>(".lt-row .lt-select input")); await click(boxes[0], 150); await click(boxes[1], 150); await click(boxes[2], 150);
    expect(menuButton().textContent).toContain("(3)"); await click(menuButton(), 300); expect(root.querySelector(".lt-export-menu p")!.textContent).toBe("3 ausgewählte Leads");
    await click(root.querySelectorAll(".lt-export-menu button")[0], 2500); expect(saved).toHaveLength(2); expect(saved[1].type).toContain("spreadsheetml"); expect(saved[1].name).toMatch(/^Leads \d{4}-\d{2}-\d{2}\.xlsx$/);
    // Leiste für die Auswahl: mittig, mit Aktion „Auswahl exportieren“ und Wahl des Formats
    const bar = root.querySelector<HTMLElement>(".lt-bulk")!; expect(bar.querySelector("strong")!.textContent).toBe("3 Leads ausgewählt");
    await type(bar.querySelector('select[aria-label="Lead-Aktion auswählen"]'), "export", 300); const format = bar.querySelector<HTMLSelectElement>('select[aria-label="Dateiformat auswählen"]')!; expect(Array.from(format.options).map((option) => option.textContent)).toEqual(["Excel (.xlsx)", "CSV (.csv)"]);
    await type(format, "csv", 200); await click(Array.from(bar.querySelectorAll("button")).find((button) => button.textContent === "Herunterladen"), 1200); expect(saved).toHaveLength(3); expect(saved[2].name).toMatch(/\.csv$/);
    await click(bar.querySelector(".lt-bulk-close"), 300); expect(root.querySelector(".lt-bulk")).toBeNull();
    // die Tabelle selbst: feste Spalten, Felder der Kategorie mit Namen, keine Vermerke der Software
    const martin = all.find((lead) => lead.firstName === "Martin" && lead.lastName === "Albrecht")!; const table = await callProcedure("leadops.exportLeadsTable", { publicIds: [martin.publicId] }) as { columns: string[]; rows: string[][] };
    expect(table.columns.slice(0, 8)).toEqual(["ID", "Kategorie", "Status", "Vorname", "Nachname", "E-Mail", "Telefon", "Straße"]); expect(table.columns).toEqual(expect.arrayContaining(["Hausart", "Dachart", "Stromverbrauch", "Anrede"]));
    const cell = (name: string) => table.rows[0][table.columns.indexOf(name)]; expect([cell("Vorname"), cell("Straße"), cell("Ort"), cell("Lieferant"), cell("Hausart"), cell("Dachart"), cell("Anrede")]).toEqual(["Martin", "Lindenweg 14", "Dülmen", "OnDialer", "Ein-/Zweifamilienhaus", "Satteldach", "Herr"]);
    for (const hidden of ["Call Record Id", "Raw Batch", "Source", "Call Score", "Raw Contact Id"]) expect(table.columns).not.toContain(hidden);
  }, 60_000);

  it("Lead-Seite: Felder der Kategorie und Antworten aus dem Gespräch, Straße in der Anschrift, „Herr Lindner“ statt Platzhalter – ohne Vermerke der Software; Tags ohne Listen-Marker", async () => {
    const lead = salesLeads().find((item) => item.lastName === "Lindner" && item.metadata?.anrede === "Herr")!; expect(lead.firstName).toBeNull();
    const root = await open(`page=Leads&lead=${lead.publicId}`, 2000);
    expect(root.querySelector("h1")!.textContent).toBe("Herr Lindner");
    const cards = () => Array.from(root.querySelectorAll<HTMLElement>(".lead-page-card")); const card = (title: string) => cards().find((item) => item.querySelector("header span")?.textContent?.trim() === title)!;
    const pairs = (node: HTMLElement) => Object.fromEntries(Array.from(node.querySelectorAll(".lead-kv > div")).map((item) => [item.querySelector("dt")!.textContent, item.querySelector("dd")!.textContent]));
    expect(pairs(card("Kontakt"))).toMatchObject({ Name: "Herr Lindner", Adresse: "Rings-Lebener-Straße 116798 Fürstenberg/Havel · DE", "Lead-Kategorie": "Photovoltaik (PV)" }); expect(pairs(card("Kontakt"))).toHaveProperty("Geliefert");
    const fields = pairs(card("Fachfelder")); expect(fields).toMatchObject({ Hausart: "Ein-/Zweifamilienhaus", Dachart: "Flachdach", Stromverbrauch: "3.000 - 4.000 kWh", Stromspeicher: "Weiß nicht", Entscheider: "Ja, Eigentümergemeinschaft", Umsetzung: "1-3 Monate", Anrede: "Herr" });
    for (const technical of ["Source", "Rawbatch", "Callscore", "Callverdict", "Calldecision", "Callrecordid", "Rawcontactid", "Street"]) expect(Object.keys(fields).map((key) => key.toLowerCase())).not.toContain(technical.toLowerCase());
    expect(card("Fachfelder").querySelector(".lead-fields-note")!.textContent).toContain("Aus dem Gespräch übernommen");
    // Gespräch: Entscheidung, Bewertung, Agent mit Alias, Kurzfassung, Antworten auf die Prüffragen, Link zum Gespräch
    const call = card("Gespräch"); expect(call.querySelector(".lead-call-top")!.textContent).toContain("Freigegeben"); expect(call.querySelector(".lead-call-score")!.textContent).toBe("88 von 100 Punkten"); expect(call.querySelector(".lead-call-top")!.textContent).toContain("Agent Nele Winter (am Telefon: Sophie Lang)");
    expect(call.querySelector(".lead-call-summary")!.textContent).toContain("Flachdach");
    const answers = Array.from(call.querySelectorAll(".lead-call-answers li")).map((item) => [item.querySelector(".lead-call-answer")!.textContent, item.querySelector("strong")!.textContent]);
    expect(answers).toEqual([["Ja", "Hat der Mitarbeiter nach Photovoltaik gefragt?"], ["Nein", "Hat der Mitarbeiter nach einer Wärmepumpe gefragt?"], ["Nein", "Hat der Mitarbeiter nach einem Wintergarten gefragt?"], ["Ja", "Hat der Kunde generell Interesse?"], // seit v354 hat jedes Beispiel-Gespräch alle Antworten seines Fragensatzes
       ["Unklar", "Stimmt der Kunde einem Vor-Ort-Termin innerhalb eines Monats zu?"], ["Ja", "Ist eine telefonische Kontaktaufnahme erwünscht?"], ["Nein", "Wurden alle Fragen gestellt?"]]);
    expect(call.querySelector("header a")!.getAttribute("href")).toMatch(/page=Gespr%C3%A4che&callId=\d+$/);
    expect(pairs(card("Herkunft"))).toMatchObject({ Lieferant: "OnDialer", Quelle: "OnDialer", Liste: "Kontakte vom Dialer" });
    // Lead-Log: Vermerk als eigener Eintrag, Kategorie beim Namen
    const log = texts(card("Lead-Log"), ".lead-log-item strong"); expect(log).toEqual(expect.arrayContaining(["Aus dem Gespräch übernommen", "Lead im System erfasst"])); expect(card("Lead-Log").textContent).toContain("Kategorie Photovoltaik · Status Freigegeben");
    // Tags: zur Auswahl stehen nur eigene Tags
    const options = texts(card("Tags"), "select.lead-tag-add option"); expect(options[0]).toBe("+ Tag hinzufügen …"); expect(options.length).toBeGreaterThan(1); expect(options.some((name) => name.startsWith("Liste: "))).toBe(false);
    expect(getStore().tables.tags.some((tag) => String(tag.name).startsWith("Liste: "))).toBe(true);
    await type(card("Tags").querySelector("select.lead-tag-add"), String(getStore().tables.tags.find((tag) => tag.name === options[1])!.id), 700); expect(texts(card("Tags"), ".lead-tag-chip")).toEqual([options[1]]);
  }, 40_000);

  it("Lead aus grünem Gespräch: Felder der Kategorie kommen aus dem Text, „<UNKNOWN>“ ist kein Name", async () => {
    const store = getStore(); const pv = store.tables.leadCategories.find((row) => row.name === "Photovoltaik")!;
    const call = store.tables.callRecords.find((row) => row.decision === "freigegeben" && !row.leadId && row.phone && row.provider === "ondialer")!; expect(call).toBeTruthy();
    Object.assign(call, { leadCategoryId: pv.id, phone: "+4915112349999", transcript: "Guten Tag Herr Wegner, es geht um Photovoltaik. Kunde: Ja, wir haben ein Mehrfamilienhaus mit Flachdach, 35390 Gießen." });
    const made = await callProcedure("leadops.leadsFromApprovedCalls", undefined) as { leads: number }; expect(made.leads).toBeGreaterThanOrEqual(1);
    const lead = (store.tables.leads as unknown as Lead[]).find((row) => row.metadata?.callRecordId === call.id)!; expect(lead).toBeTruthy();
    expect(lead.metadata).toMatchObject({ hausart: "Mehrfamilienhaus", dachart: "Flachdach", callFieldsCallId: call.id }); expect(lead.metadata!.callFieldsAt).toBeTruthy();
    const detail = await callProcedure("leadops.getLeadDetail", { publicId: lead.publicId }) as { fields: Array<{ key: string; value: unknown }>; extra: Array<{ key: string }>; call: { id: number } | null; fieldsFromCallAt: string | null };
    expect(detail.fields.find((field) => field.key === "hausart")?.value).toBe("Mehrfamilienhaus"); expect(detail.call?.id).toBe(call.id); expect(detail.fieldsFromCallAt).toBeTruthy(); expect(detail.extra.map((field) => field.key)).not.toEqual(expect.arrayContaining(["callRecordId", "rawBatch", "source"]));
    // Platzhalter als Name: in der Tabelle steht „Name unbekannt“, nicht „<UNKNOWN> <UNKNOWN>“
    Object.assign(lead, { firstName: "<UNKNOWN>", lastName: "<UNKNOWN>" });
    const root = await open(`page=Leads&search=${lead.publicId}`, 2000); expect(leadNames(root)).toEqual(["Name unbekannt"]); expect(root.textContent).not.toContain("<UNKNOWN>");
  }, 40_000);

  it("Lead-Puls: zählt alle Leads des Zeitraums, zeigt sie in einem festen Fenster zum Rollen – ein Klick öffnet den Lead", async () => {
    const all = salesLeads(); const dayAgo = Date.now() - 24 * 3_600_000; const recent = all.filter((lead) => new Date(lead.createdAt).getTime() >= dayAgo).length; expect(all.length).toBeGreaterThan(10);
    const root = await open("page=Dashboard&period=all", 2500);
    const panel = root.querySelector<HTMLElement>("#dashboard-lead-puls")!; const rows = () => Array.from(panel.querySelectorAll<HTMLButtonElement>(".pulse-window .recent-row"));
    expect(rows()).toHaveLength(all.length); // alle – nicht nur fünf
    expect(panel.querySelector(".pulse-live")!.textContent).toBe(`${all.length} Leads · Gesamte Zeitspanne · davon ${recent} in den letzten 24 Stunden`);
    expect(panel.querySelector(".pulse-window")!.getAttribute("tabindex")).toBe("0"); // das Fenster rollt für sich (Höhe begrenzt per Stylesheet)
    const newest = [...all].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); expect(rows()[0].querySelector(".recent-name small")!.textContent).toContain(newest[0].publicId);
    expect(texts(panel, ".pulse-status").every((text) => ["Neu", "Freigegeben", "Zugewiesen", "Reklamiert", "Fehlerhaft", "Deaktiviert", "Hängend"].includes(text))).toBe(true);
    expect(texts(panel, ".recent-name strong")).toContain("Herr Lindner");
    const target = rows()[2]; const targetId = /^(\S+) ·/.exec(target.querySelector(".recent-name small")!.textContent!)![1]; const targetName = target.querySelector(".recent-name strong")!.textContent;
    await click(target, 1500);
    expect(new URLSearchParams(window.location.search).get("page")).toBe("Leads"); expect(new URLSearchParams(window.location.search).get("lead")).toBe(targetId); expect(root.querySelector("h1")!.textContent).toBe(targetName); expect(root.querySelector(".lead-page-grid")).toBeTruthy();
    // Zeitraum „Heute“: Zahl und Liste gehören zusammen
    const pulse = await callProcedure("leadops.dashboard", { from: new Date(new Date().setHours(0, 0, 0, 0)), until: new Date(new Date().setHours(23, 59, 59, 999)), categoryId: null }) as { leads: unknown[]; leadTotal: number; leadsLast24h: number };
    expect(pulse.leads).toHaveLength(pulse.leadTotal); expect(pulse.leadsLast24h).toBe(pulse.leadTotal); expect(pulse.leadTotal).toBe(all.filter((lead) => new Date(lead.createdAt).toDateString() === new Date().toDateString()).length);
  }, 40_000);

  it("Gespräche: Suche nach Name, Rufnummer, Agent, Alias oder einem Wort aus dem Gespräch – Liste und Zahlen darüber folgen", async () => {
    const calls = getStore().tables.callRecords; const total = calls.length;
    const root = await open(`page=${encodeURIComponent("Gespräche")}`, 2500);
    const input = () => root.querySelector<HTMLInputElement>("#gq-search")!; expect(input().placeholder).toContain("Wort aus dem Gespräch"); expect(root.querySelector(".gq-search-hits")).toBeNull();
    const names = () => texts(root, ".gq-who-line b"); const sum = () => root.querySelector(".gq-sum")!.textContent ?? "";
    expect(sum()).toContain(`${total} Gespräche`);
    // Kunde über den Lead
    await type(input(), "Martin Albrecht", 400); await until(() => names().length === 1); expect(names()).toEqual(["Martin Albrecht"]); expect(root.querySelector(".gq-search-hits")!.textContent).toBe("1 Gespräch gefunden"); expect(sum()).toContain("1 Gespräch");
    // Alias des Agenten und ein Wort aus dem Text – jedes Wort muss vorkommen
    await type(input(), "Sophie Lang Flachdach", 400); await until(() => names()[0] === "Lindner"); expect(names()).toEqual(["Lindner"]);
    // Rufnummer mit Leerzeichen und ohne Ländervorwahl
    await type(input(), "0151 1234 0072", 400); await until(() => names()[0] === "Petra Sommer"); expect(names()).toEqual(["Petra Sommer"]);
    // nichts gefunden: klare Meldung mit „Suche leeren“
    await type(input(), "gibtesnichtxyz", 400); await until(() => root.querySelectorAll(".gq-who-line").length === 0 && Boolean(root.querySelector(".gq-empty"))); expect(root.querySelectorAll(".gq-who-line")).toHaveLength(0); expect(root.querySelector(".gq-empty")!.textContent).toContain("Zur Suche „gibtesnichtxyz“ gibt es kein Gespräch");
    await click(Array.from(root.querySelectorAll(".gq-empty button")).find((button) => button.textContent === "Suche leeren"), 400); await until(() => root.querySelectorAll(".gq-who-line").length > 10); expect(input().value).toBe(""); expect(sum()).toContain(`${total} Gespräche`); expect(root.querySelectorAll(".gq-who-line").length).toBeGreaterThan(10);
    // dieselbe Regel an der Schnittstelle
    const found = await callProcedure("leadops.listCalls", { search: "Max Reuter", limit: 1000 }) as Array<{ id: number }>; const expected = calls.filter((row) => /max reuter/i.test(`${row.agentAlias ?? ""} ${row.agentName ?? ""} ${row.transcript ?? ""} ${row.summary ?? ""}`)).length; expect(found).toHaveLength(expected); expect(expected).toBeGreaterThan(0);
    expect((await callProcedure("leadops.callStatistics", { search: "Max Reuter" }) as { total: number }).total).toBe(expected);
  }, 80_000);

  it("Rohdaten: Liste ohne offene Kontakte erklärt, warum es nichts zu übernehmen gibt, und führt zu den Leads", async () => {
    const root = await open("page=Rohdaten", 2000);
    const cardOf = (name: string) => Array.from(root.querySelectorAll<HTMLElement>("section .cursor-pointer")).find((item) => item.querySelector("strong")?.textContent === name)!;
    const done = cardOf("Kontakte vom Dialer"); expect(done).toBeTruthy(); expect(done.textContent).toContain("3 Kontakte"); expect(done.textContent).toContain("3 Leads");
    expect(done.querySelector(".raw-batch-done p")!.textContent).toBe("Alle 3 Kontakte sind schon Leads – hier gibt es nichts mehr zu übernehmen.");
    expect(texts(done, ".raw-batch-done button")).toEqual(["Leads ansehen", "Löschen"]); expect(Array.from(done.querySelectorAll("button")).some((button) => button.disabled)).toBe(false); // keine toten Knöpfe
    // Liste mit offenen Kontakten: die gewohnten Knöpfe, alle anklickbar
    const openCard = cardOf("Messe Hannover 09-2026.xlsx"); expect(texts(openCard, "button")).toEqual(["Ins Callcenter (Wählliste)", "Alle als Leads übernehmen", "Löschen"]); expect(Array.from(openCard.querySelectorAll("button")).some((button) => button.disabled)).toBe(false); expect(openCard.querySelector(".raw-batch-done")).toBeNull();
    await click(Array.from(done.querySelectorAll("button")).find((button) => button.textContent === "Leads ansehen"), 1500);
    expect(new URLSearchParams(window.location.search).get("page")).toBe("Leads"); expect(root.querySelector(".lt")).toBeTruthy();
  }, 40_000);
});
