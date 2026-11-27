import LeadClaimForm from "@/components/LeadClaimForm";
import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";
import { claimCounts, claimDay, claimDeadline, claimLeadName, claimStatusLabel, claimedDelivery, claimsTable, type ClaimDeliveryRow } from "../../../../shared/claim-view";
import { rawOpen, rawSegments, rawShare, rawTotals, type RawCounts } from "../../../../shared/raw-view";

/**
 * Version 380 – Rohdaten und Reklamationen neu gestaltet: Zahlen als Leiste, ruhige Karten, klare Zustände. Rohdaten: je Liste eine Karte mit
 * Balken, Auswahl grenzt Auswertung und Kontakte ein, Reiter nach Status, Liste hochladen mit Datei-Feld. Reklamationen: Reiter nach Stand,
 * Suche und Filter, Zeile klappt an Ort und Stelle auf; einzeln und in der Sammelaktion wird auf demselben Weg entschieden.
 */
function providers(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}>{node}</QueryClientProvider></trpc.Provider>);
}
const mount = () => providers(<DemoApp />);
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
async function until(check: () => boolean, tries = 40) { for (let index = 0; index < tries && !check(); index += 1) await settle(150); }
const click = async (node: Element | null | undefined, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const type = async (node: Element | null | undefined, value: string, wait = 500) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.change(node!, { target: { value } }); }); await settle(wait); };
const open = async (query: string, wait = 2600) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((node) => (node.textContent ?? "").trim());
const button = (root: ParentNode, text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((node) => (node.textContent ?? "").trim() === text);
type Row = Record<string, any>;
type Claim = Row & { id: number; leadId: number; status: string; reason: string; createdAt: Date; dueAt: Date | null; resolvedAt: Date | null; firstName: string | null; lastName: string | null };
const table = (name: string) => (getStore().tables as unknown as Record<string, Row[]>)[name];
const call = (path: string, input?: unknown) => callProcedure(path, input) as Promise<any>;
const said = (text: string) => (document.body.textContent ?? "").includes(text);
const confirmOk = async () => { await until(() => Boolean(document.querySelector(".app-confirm-ok"))); await click(document.querySelector(".app-confirm-ok"), 1200); };
const csv = (name: string, text: string, kind = "text/csv") => { const file = new File([text], name, { type: kind }); Object.defineProperty(file, "text", { value: async () => text }); return file; };
type Batch = { id: number; name: string; counts: RawCounts };
const batchCard = (root: ParentNode, name: string) => Array.from(root.querySelectorAll<HTMLElement>(".rd-batch")).find((card) => card.querySelector(".rd-batch-title strong")?.textContent === name)!;
const contactRows = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLElement>(".rd-contacts .rd-row"));
const contactTab = (root: ParentNode, label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>(".rd-contacts .fx-tabs button")).find((node) => (node.textContent ?? "").startsWith(label))!;
const railValues = (root: ParentNode, scope: string) => Array.from(root.querySelectorAll<HTMLElement>(`${scope} .tg-stat strong`)).map((node) => node.firstChild?.textContent ?? "");
const claimItems = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLElement>(".rk-item"));
const claimTab = (root: ParentNode, label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>(".rk-list .fx-tabs button")).find((node) => (node.textContent ?? "").startsWith(label))!;
const statusOf = (leadId: number) => table("leads").find((row) => row.id === leadId)!.status as string;
const deliveriesOf = (leadId: number) => table("leadDeliveries").filter((row) => row.leadId === leadId).sort((a, b) => a.id - b.id);

describe("Version 380", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { vi.restoreAllMocks(); document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); cleanup(); resetStore(); });

  it("Rohdaten: Zahlen als Leiste, je Liste eine Karte mit Balken und Legende, darunter die drei Schritte", async () => {
    const root = await open("page=Rohdaten"); await until(() => root.querySelectorAll(".rd-batch").length > 0);
    const batches = await call("leadops.listRawBatches") as Batch[]; const totals = rawTotals(batches); expect(totals.total).toBe(29); expect(batches).toHaveLength(3);
    expect(root.querySelector(".page-intro h1")!.textContent).toBe("Rohdaten"); expect(button(root, "Liste hochladen")).toBeTruthy();
    // Leiste: fünf Zahlen, jede mit einer Zeile, die sie einordnet
    const stats = Array.from(root.querySelectorAll<HTMLElement>(".rd-rail .tg-stat"));
    expect(stats.map((node) => node.querySelector("span")!.textContent!.trim())).toEqual(["Kontakte", "Noch offen", "Zu Leads geworden", "Verworfen", "Doppelt"]);
    expect(railValues(root, ".rd-rail")).toEqual([totals.total, rawOpen(totals), totals.konvertiert, totals.verworfen, totals.duplikat].map(String));
    const share = rawShare(totals.konvertiert, totals.total); expect(stats[2].querySelector("strong em")!.textContent).toBe(`${share} %`); expect(stats[2].querySelector<HTMLElement>(".tg-meter i")!.style.width).toBe(`${share}%`);
    expect(stats.map((node) => node.querySelector("small")!.textContent)).toEqual([`in ${batches.length} Listen`, `${totals.in_liste} davon in einer Wählliste`, "von allen Kontakten", "lassen sich wieder aufnehmen", "gab es schon als Lead oder Kontakt"]);
    // je Liste eine Karte: Zahl, was noch offen ist, Balken (nur Teile mit Kontakten) und Legende mit allen fünf Zahlen
    const cards = Array.from(root.querySelectorAll<HTMLElement>(".rd-batch")); expect(cards.map((card) => card.querySelector(".rd-batch-title strong")!.textContent)).toEqual(batches.map((batch) => batch.name));
    expect(root.querySelector(".rd-lists .tg-count")!.textContent).toBe("3 Listen");
    batches.forEach((batch, index) => { const card = cards[index]; const segments = rawSegments(batch.counts); const open = rawOpen(batch.counts);
      expect(card.querySelector(".rd-batch-nums b")!.textContent).toBe(String(batch.counts.total)); expect(card.querySelector(".rd-batch-nums em")!.textContent).toBe(open ? `${open} noch offen` : "keiner mehr offen");
      expect(Array.from(card.querySelectorAll<HTMLElement>(".rd-bar i")).map((node) => [node.className, node.style.flexGrow])).toEqual(segments.filter((segment) => segment.count > 0).map((segment) => [`is-${segment.key}`, String(segment.count)]));
      expect(texts(card, ".rd-legend li")).toEqual(segments.map((segment) => `${segment.count} ${segment.label}`)); expect(card.querySelector(".rd-bar")!.getAttribute("aria-label")).toBe(segments.map((segment) => `${segment.count} ${segment.label}`).join(", "));
      expect(card.querySelector(".rd-pick")!.textContent!.trim()).toBe("Kontakte zeigen"); expect(card.querySelector(".rd-pick")!.getAttribute("aria-pressed")).toBe("false"); });
    // Auswertung: Spalten in vier Gruppen; Schritte am Ende der Seite
    expect(root.querySelector(".rd-report h2")!.textContent).toBe("Was wurde aus den Kontakten?"); expect(texts(root, ".rd-report .rd-groups th")).toEqual(["Kategorie", "Kontakte", "Am Telefon", "Ergebnis", "Leads daraus"]);
    await until(() => Boolean(root.querySelector(".rd-total"))); expect(root.querySelector(".rd-total td.num strong")!.textContent).toBe(String(totals.total));
    expect(root.querySelector(".rd-report table")!.classList.contains("no-stack")).toBe(true); // auf dem Handy rollt die Tabelle zur Seite, statt gestapelt zu werden
    expect(texts(root, ".rd .tg-how b")).toEqual(["Liste hochladen", "Abtelefonieren", "Aus dem Kontakt wird ein Lead"]);
  }, 60_000);

  it("Rohdaten: „Kontakte zeigen“ wählt eine Liste – Auswertung und Kontakte gelten dann nur für sie; das Kreuz an der Marke zeigt wieder alle", async () => {
    const root = await open("page=Rohdaten"); await until(() => contactRows(root).length > 0);
    const batches = await call("leadops.listRawBatches") as Batch[]; const totals = rawTotals(batches); const worked = batches.find((batch) => batch.name === "Handwerk Rhein-Main 10-2026.csv")!;
    const tabs = () => texts(root, ".rd-contacts .fx-tabs button"); const tabsFor = (counts: RawCounts) => [`Alle${counts.total}`, `Neu${counts.neu}`, `In Wählliste${counts.in_liste}`, `Lead${counts.konvertiert}`, `Verworfen${counts.verworfen}`, `Doppelt${counts.duplikat}`];
    expect(texts(root, ".rd-report .tg-count, .rd-contacts .tg-count")).toEqual(["Alle Listen", "Alle Listen"]); expect(root.querySelector(".rd-scope")).toBeNull();
    expect(tabs()).toEqual(tabsFor(totals)); expect(contactRows(root).length).toBe(totals.total);
    const card = () => batchCard(root, worked.name);
    await click(card().querySelector(".rd-pick"), 1200); await until(() => contactRows(root).length === worked.counts.total);
    expect(card().classList.contains("is-on")).toBe(true); expect(card().querySelector(".rd-pick")!.getAttribute("aria-pressed")).toBe("true"); expect(card().querySelector(".rd-pick")!.textContent!.trim()).toBe("Unten gezeigt – Auswahl aufheben");
    expect(root.querySelectorAll(".rd-batch.is-on").length).toBe(1);
    expect(texts(root, ".rd-scope b")).toEqual([worked.name, worked.name]); expect(root.querySelector(".rd-contacts .tg-list-head p")!.textContent).toContain("Die Kontakte dieser einen Liste.");
    expect(tabs()).toEqual(tabsFor(worked.counts)); expect(contactRows(root).length).toBe(worked.counts.total);
    expect(new Set(texts(root, ".rd-contacts .rd-row .rd-from small"))).toEqual(new Set([worked.name]));
    await until(() => root.querySelector(".rd-total td.num strong")?.textContent === String(worked.counts.total)); expect(root.querySelector(".rd-total td.num strong")!.textContent).toBe(String(worked.counts.total));
    expect(railValues(root, ".rd-rail")[0]).toBe(String(totals.total)); // die Leiste zählt weiter alle Listen
    // Kreuz an der Marke: wieder alle Listen
    await click(root.querySelector(".rd-contacts .rd-scope button"), 1200); await until(() => contactRows(root).length === totals.total);
    expect(root.querySelector(".rd-scope")).toBeNull(); expect(card().classList.contains("is-on")).toBe(false); expect(tabs()).toEqual(tabsFor(totals)); expect(contactRows(root).length).toBe(totals.total);
    // derselbe Knopf hebt die Auswahl auch wieder auf
    await click(card().querySelector(".rd-pick"), 900); expect(card().classList.contains("is-on")).toBe(true); await click(card().querySelector(".rd-pick"), 900); expect(card().classList.contains("is-on")).toBe(false); expect(root.querySelector(".rd-scope")).toBeNull();
  }, 60_000);

  it("Rohdaten – Kontakte: Reiter nach Status mit Zahl, Suche mit klarer Meldung, verwerfen, wieder aufnehmen und als Lead übernehmen", async () => {
    const root = await open("page=Rohdaten"); await until(() => contactRows(root).length > 0);
    const totals = rawTotals(await call("leadops.listRawBatches") as Batch[]);
    const nameOf = (row: HTMLElement) => row.querySelector(".rd-who b")!.textContent!; const stored = (name: string) => table("rawContacts").find((row) => [row.firstName, row.lastName].filter(Boolean).join(" ") === name)!;
    // Reiter „Neu“
    await click(contactTab(root, "Neu"), 900); await until(() => contactRows(root).length === totals.neu);
    expect(contactRows(root).length).toBe(totals.neu); expect(contactTab(root, "Neu").className).toBe("active"); expect(contactTab(root, "Neu").getAttribute("aria-selected")).toBe("true"); expect(contactTab(root, "Alle").getAttribute("aria-selected")).toBe("false");
    expect(new Set(texts(root, ".rd-contacts .rd-state .fx-pill"))).toEqual(new Set(["Neu"])); expect(texts(contactRows(root)[0], ".rd-acts button")).toEqual(["Als Lead übernehmen", "Verwerfen"]);
    expect(contactRows(root)[0].querySelector(".rd-acts select")).toBeTruthy(); // Liste mit zwei Kategorien: die Kategorie für den Lead ist wählbar
    // Suche ohne Treffer: klare Meldung, die Reiter stehen ohne Zahl da (die Zahlen gälten nicht für die Treffer)
    const search = root.querySelector<HTMLInputElement>(".rd-contacts .fx-search input")!; await type(search, "gibtesnichtxyz", 900); await until(() => Boolean(root.querySelector(".rd-contacts .rd-none")));
    expect(root.querySelector(".rd-contacts .rd-none p")!.textContent).toBe("Zur Suche „gibtesnichtxyz“ gibt es keinen Kontakt mit dem Status „Neu“."); expect(texts(root, ".rd-contacts .fx-tabs button span").every((text) => text === "")).toBe(true);
    await click(button(root.querySelector(".rd-contacts")!, "Alle Kontakte zeigen"), 1000); await until(() => contactRows(root).length === totals.total);
    expect(search.value).toBe(""); expect(contactTab(root, "Alle").className).toBe("active"); expect(contactRows(root).length).toBe(totals.total); expect(contactTab(root, "Alle").textContent).toBe(`Alle${totals.total}`);
    // Suche mit Treffern, das Kreuz leert sie
    await type(search, "Hannover", 900); await until(() => contactRows(root).length > 0 && contactRows(root).length < totals.total); expect(contactRows(root).every((row) => row.textContent!.includes("Hannover"))).toBe(true);
    await click(root.querySelector(".rd-contacts .fx-search button"), 900); await until(() => contactRows(root).length === totals.total); expect(search.value).toBe("");
    // verwerfen → Zahlen ziehen nach; wieder aufnehmen stellt sie zurück
    await click(contactTab(root, "Neu"), 900); await until(() => contactRows(root).length === totals.neu); const dropped = nameOf(contactRows(root)[0]);
    await click(button(contactRows(root)[0], "Verwerfen"), 1400); await until(() => contactRows(root).length === totals.neu - 1);
    expect(stored(dropped).status).toBe("verworfen"); expect(contactTab(root, "Neu").textContent).toBe(`Neu${totals.neu - 1}`); expect(contactTab(root, "Verworfen").textContent).toBe(`Verworfen${totals.verworfen + 1}`); expect(railValues(root, ".rd-rail")[3]).toBe(String(totals.verworfen + 1));
    await click(contactTab(root, "Verworfen"), 900); await until(() => contactRows(root).some((row) => nameOf(row) === dropped)); const back = contactRows(root).find((row) => nameOf(row) === dropped)!;
    expect(back.querySelector(".fx-pill")!.textContent).toBe("Verworfen"); expect(texts(back, ".rd-acts button")).toEqual(["Wieder aufnehmen"]);
    await click(button(back, "Wieder aufnehmen"), 1400); expect(stored(dropped).status).toBe("neu"); expect(contactTab(root, "Neu").textContent).toBe(`Neu${totals.neu}`); expect(railValues(root, ".rd-rail")[3]).toBe(String(totals.verworfen));
    // als Lead übernehmen: Marke „Lead“ mit der Lead-Nummer – ein Klick darauf öffnet den Lead
    await click(contactTab(root, "Neu"), 900); await until(() => contactRows(root).length === totals.neu); const target = nameOf(contactRows(root)[0]); const leadsBefore = table("leads").length;
    await click(button(contactRows(root)[0], "Als Lead übernehmen"), 1800);
    const made = stored(target); expect(made.status).toBe("konvertiert"); expect(table("leads").length).toBe(leadsBefore + 1); const lead = table("leads").find((row) => row.id === made.leadId)!; expect(said(`Lead ${lead.publicId} angelegt`)).toBe(true);
    expect(railValues(root, ".rd-rail")[2]).toBe(String(totals.konvertiert + 1)); expect(contactTab(root, "Lead").textContent).toBe(`Lead${totals.konvertiert + 1}`);
    await click(contactTab(root, "Lead"), 900); await until(() => contactRows(root).some((row) => nameOf(row) === target)); const leadRow = contactRows(root).find((row) => nameOf(row) === target)!;
    expect(leadRow.querySelector(".fx-pill")!.textContent).toBe("Lead"); expect(leadRow.querySelector(".fx-pill")!.classList.contains("is-good")).toBe(true); expect(leadRow.querySelector(".rd-lead button")!.textContent).toBe(lead.publicId); expect(leadRow.querySelector(".rd-acts button")).toBeNull();
    await click(leadRow.querySelector(".rd-lead button"), 1500); const params = new URLSearchParams(window.location.search); expect(params.get("page")).toBe("Leads"); expect(params.get("lead")).toBe(lead.publicId);
  }, 90_000);

  it("Rohdaten – Liste hochladen: Fenster in Schritten, Datei hineinziehen, Spalten werden erkannt; der Knopf sagt, wie viele Kontakte es werden", async () => {
    const root = await open("page=Rohdaten"); await until(() => root.querySelectorAll(".rd-batch").length > 0);
    await click(button(root, "Liste hochladen"), 700); const dialog = root.querySelector<HTMLElement>(".rd-upload")!; expect(dialog).toBeTruthy(); expect(dialog.getAttribute("role")).toBe("dialog"); expect(dialog.getAttribute("aria-label")).toBe("Liste hochladen");
    const steps = () => texts(dialog, ".rd-steps > li > div > b"); const foot = () => dialog.querySelector(".rd-upload-foot p")!.textContent; const send = () => Array.from(dialog.querySelectorAll<HTMLButtonElement>(".rd-upload-foot button")).pop()!;
    expect(steps()).toEqual(["Datei", "Lead-Kategorie", "Angaben zur Liste"]);
    const drop = dialog.querySelector<HTMLElement>(".ld-drop")!; expect(drop.textContent).toContain("CSV- oder Excel-Datei hierher ziehen"); expect(drop.textContent).toContain("oder klicken und Datei auswählen"); expect(drop.querySelector("input[type=file]")!.getAttribute("accept")).toBe(".csv,.txt,.xlsx,.xls");
    expect(foot()).toBe("Es fehlt noch: die Datei, eine Lead-Kategorie."); expect(send().textContent).toBe("Hochladen"); expect(send().disabled).toBe(true);
    // falsche Datei: Hinweis, nichts wird eingelesen
    await act(async () => { fireEvent.drop(drop, { dataTransfer: { files: [csv("angebot.pdf", "%PDF", "application/pdf")] } }); }); await settle(500);
    expect(said("Bitte eine CSV- oder Excel-Datei wählen")).toBe(true); expect(steps()).toHaveLength(3);
    // beim Ziehen über das Feld zeigt es, was passiert
    await act(async () => { fireEvent.dragEnter(drop, { dataTransfer: { files: [] } }); }); expect(drop.classList.contains("is-over")).toBe(true); expect(drop.textContent).toContain("Loslassen – die Datei wird eingelesen");
    await act(async () => { fireEvent.drop(drop, { dataTransfer: { files: [csv("Messe Köln 11-2026.csv", "Vorname;Nachname;Firma;Telefon;E-Mail;PLZ;Ort;Dachform\nRita;Roh;Roh Dach GmbH;+49 30 4455667;rita@rohdach.example;10115;Berlin;Sattel\nKarl;Kalt;;+49 40 998877;;20095;Hamburg;Flach\nMia;Leer;;;;80331;München;Pult\nJan;Berg;Berg Solar;+49 221 556677;jan@bergsolar.example;50667;Köln;Sattel")] } }); }); await until(() => steps().length === 4);
    expect(drop.classList.contains("is-over")).toBe(false); expect(steps()[3]).toBe("Spalten zuordnen"); expect(drop.querySelector(".ld-drop-text b")!.textContent).toBe("Messe Köln 11-2026.csv"); expect(drop.querySelector(".ld-drop-text small")!.textContent).toBe("4 Zeilen gelesen · andere Datei hierher ziehen oder klicken");
    expect(dialog.querySelector<HTMLInputElement>(".rd-fields:not(.is-map) input")!.value).toBe("Messe Köln 11-2026"); // der Name der Liste ist vorgeschlagen
    const mapping = Object.fromEntries(Array.from(dialog.querySelectorAll<HTMLElement>(".rd-fields.is-map .rd-field")).map((field) => [field.querySelector("span")!.textContent, field.querySelector<HTMLSelectElement>("select")!.value]));
    expect(mapping).toEqual({ Vorname: "Vorname", Nachname: "Nachname", "Name (Vor- und Nachname)": "", Firma: "Firma", Telefon: "Telefon", "E-Mail": "E-Mail", PLZ: "PLZ", Ort: "Ort", Land: "", "Lead-Kategorie (Kürzel oder Name)": "" });
    expect(texts(dialog, ".rd-preview tbody tr:first-child td")).toEqual(["Rita", "Roh", "Roh Dach GmbH", "+49 30 4455667", "rita@rohdach.example", "10115 Berlin", "Standard"]); expect(dialog.querySelector(".rd-preview caption")!.textContent).toBe("So werden die ersten Zeilen gelesen");
    expect(foot()).toBe("Es fehlt noch: eine Lead-Kategorie."); expect(send().disabled).toBe(true);
    // Kategorie wählen: jetzt steht da, wie viele Kontakte es werden – die Zeile ohne Telefon und E-Mail zählt nicht
    const chips = () => Array.from(dialog.querySelectorAll<HTMLButtonElement>(".rd-chips button")); expect(chips().length).toBe((await call("leadops.listCategories") as Row[]).length);
    await click(chips()[0], 300); expect(chips()[0].getAttribute("aria-pressed")).toBe("true"); expect(chips()[0].className).toBe("is-on");
    expect(foot()).toBe("1 Zeile ohne Telefon und E-Mail wird übersprungen."); expect(send().textContent).toBe("3 Kontakte hochladen"); expect(send().disabled).toBe(false);
    expect(dialog.querySelector(".rd-field-narrow")).toBeNull(); await click(chips()[1], 300); expect(dialog.querySelector(".rd-field-narrow span")!.textContent).toBe("Standard-Kategorie"); // zwei Kategorien: eine ist der Standard
    // ohne Telefon- und E-Mail-Spalte geht es nicht
    const phoneSelect = Array.from(dialog.querySelectorAll<HTMLElement>(".rd-fields.is-map .rd-field")).find((field) => field.querySelector("span")!.textContent === "Telefon")!.querySelector("select")!; const mailSelect = Array.from(dialog.querySelectorAll<HTMLElement>(".rd-fields.is-map .rd-field")).find((field) => field.querySelector("span")!.textContent === "E-Mail")!.querySelector("select")!;
    await type(phoneSelect, "", 200); await type(mailSelect, "", 200); expect(foot()).toBe("Es fehlt noch: die Spalte für Telefon oder E-Mail."); expect(send().textContent).toBe("Hochladen");
    await type(phoneSelect, "Telefon", 200); await type(mailSelect, "E-Mail", 200); expect(send().textContent).toBe("3 Kontakte hochladen");
    const listsBefore = table("rawBatches").length; await click(send(), 2200); await until(() => !root.querySelector(".rd-upload"));
    expect(root.querySelector(".rd-upload")).toBeNull(); expect(said("3 Kontakte übernommen (0 doppelt, 0 ohne Kontaktdaten übersprungen)")).toBe(true);
    expect(table("rawBatches").length).toBe(listsBefore + 1); const created = table("rawBatches").find((row) => row.name === "Messe Köln 11-2026")!; const contacts = table("rawContacts").filter((row) => row.batchId === created.id);
    expect(contacts.map((row) => [row.firstName, row.lastName, row.status]).sort()).toEqual([["Jan", "Berg", "neu"], ["Karl", "Kalt", "neu"], ["Rita", "Roh", "neu"]]); expect(contacts.find((row) => row.firstName === "Rita")!.data).toMatchObject({ Dachform: "Sattel" }); // weitere Spalten wandern mit
    // die neue Liste ist gleich ausgewählt
    await until(() => Boolean(batchCard(root, "Messe Köln 11-2026"))); expect(batchCard(root, "Messe Köln 11-2026").classList.contains("is-on")).toBe(true); expect(texts(root, ".rd-scope b")).toEqual(["Messe Köln 11-2026", "Messe Köln 11-2026"]); await until(() => contactRows(root).length === 3); expect(contactRows(root).length).toBe(3);
    // Schließen ohne Hochladen
    await click(button(root, "Liste hochladen"), 500); expect(root.querySelector(".rd-upload")).toBeTruthy(); await click(root.querySelector(".rd-upload .ld-close"), 400); expect(root.querySelector(".rd-upload")).toBeNull();
  }, 90_000);

  it("Reklamationen: Zahlen als Leiste, Reiter nach Stand, jede Zeile nennt Grund, Lead, Käufer, Stand und Prüffrist", async () => {
    const root = await open("page=Reklamationen"); await until(() => claimItems(root).length > 0);
    const claims = await call("leadops.listClaims", {}) as Claim[]; const counts = claimCounts(claims); expect(claims).toHaveLength(5);
    expect(root.querySelector(".page-intro h1")!.textContent).toBe("Reklamationen"); expect(button(root, "Reklamation erfassen")).toBeTruthy(); expect(button(root, "Neuen Vorgang")).toBeUndefined(); expect(button(root, "CSV exportieren")!.disabled).toBe(false);
    const stats = Array.from(root.querySelectorAll<HTMLElement>(".rk > .tg-rail .tg-stat")); expect(stats.map((node) => node.querySelector("span")!.textContent!.trim())).toEqual(["Warten auf Entscheidung", "Überfällig", "Genehmigt", "Abgelehnt"]);
    expect(railValues(root, ".rk > .tg-rail")).toEqual([counts.wartend, counts.überfällig, counts.genehmigt, counts.abgelehnt].map(String)); expect(counts.überfällig).toBeGreaterThan(0); expect(stats[1].classList.contains("is-late")).toBe(true);
    expect(stats[0].querySelector("small")!.textContent).toBe(`${counts.offen} offen · ${counts.in_prüfung} in Prüfung`); expect(stats[2].querySelector("strong em")!.textContent).toBe(`${counts.genehmigtQuote} %`); expect(stats[2].querySelector("small")!.textContent).toBe(`von ${counts.entschieden} entschiedenen`);
    expect(texts(root, ".rk-list .fx-tabs button")).toEqual([`Alle${counts.alle}`, `Offen${counts.offen}`, `In Prüfung${counts.in_prüfung}`, `Genehmigt${counts.genehmigt}`, `Abgelehnt${counts.abgelehnt}`]);
    // jede Zeile – in der Reihenfolge der Schnittstelle (neueste zuerst)
    const items = claimItems(root); expect(items.map((item) => item.id)).toEqual(claims.map((claim) => `rk-${claim.id}`));
    const deliveries = table("leadDeliveries") as unknown as ClaimDeliveryRow[]; const categoryName = (id: number) => table("leadCategories").find((row) => row.id === id)?.name;
    claims.forEach((claim, index) => { const item = items[index]; const due = claimDeadline(claim);
      expect(item.querySelector(".rk-what b")!.textContent).toBe(claim.reason); expect(item.querySelector(".rk-what small")!.textContent).toBe(`REC-${claim.id} · erfasst am ${claimDay(claim.createdAt)}`);
      expect(item.querySelector(".rk-lead b")!.textContent).toBe(claimLeadName(claim)); expect(item.querySelector(".rk-lead small")!.textContent).toBe([claim.leadPublicId, categoryName(claim.categoryId)].filter(Boolean).join(" · "));
      expect(claim.buyerName).toBe(claimedDelivery(claim as never, deliveries)?.buyerName ?? null); expect(item.querySelector(".rk-party b")!.textContent).toBe(claim.buyerName ?? "–"); // Käufer = der der reklamierten Lieferung
      expect(item.querySelector(".fx-pill")!.textContent).toBe(claimStatusLabel(claim.status)); expect(item.querySelector(".rk-due b")!.textContent).toBe(due.text); expect(item.querySelector(".rk-due")!.classList.contains(`is-${due.tone}`)).toBe(true); expect(item.classList.contains("is-late")).toBe(due.tone === "late");
      expect(item.querySelector(".rk-row")!.getAttribute("aria-expanded")).toBe("false"); });
    // Farbe nur, wo etwas zu tun ist: offen = bernstein, in Prüfung = blau; entschieden bleibt ruhig
    const pillOf = (status: string) => items[claims.findIndex((claim) => claim.status === status)].querySelector(".fx-pill")!.className;
    expect([pillOf("offen"), pillOf("in_prüfung"), pillOf("genehmigt"), pillOf("abgelehnt")]).toEqual(["fx-pill is-warn", "fx-pill is-calm", "fx-pill is-done", "fx-pill is-mute"]);
    // Reiter, Suche, Filter
    await click(claimTab(root, "Offen"), 600); expect(claimItems(root).length).toBe(counts.offen); expect(new Set(texts(root, ".rk-item .fx-pill"))).toEqual(new Set(["Offen"])); expect(claimTab(root, "Offen").className).toBe("active");
    await click(claimTab(root, "Alle"), 600); const search = root.querySelector<HTMLInputElement>(".rk-list .fx-search input")!;
    await type(search, "Dublette", 900); await until(() => claimItems(root).length === 1); expect(texts(root, ".rk-item .rk-what b")).toEqual(["Dublette"]); expect(claimTab(root, "Alle").textContent).toBe("Alle1"); expect(railValues(root, ".rk > .tg-rail")[0]).toBe(String(counts.wartend)); // die Leiste zählt weiter alles
    await click(root.querySelector(".rk-list .fx-search button"), 900); await until(() => claimItems(root).length === claims.length);
    const filterButton = () => root.querySelector<HTMLButtonElement>(".rk-list .fx-toolrow > .fx-tool")!; expect(root.querySelector(".rk-filters")).toBeNull(); await click(filterButton(), 400);
    expect(texts(root, ".rk-filters .rd-field > span")).toEqual(["Grund", "Kategorie", "Lieferant", "Prüffrist", "Erstellt ab", "Erstellt bis"]); expect(button(root, "Filter zurücksetzen")).toBeUndefined();
    const reasonSelect = root.querySelector<HTMLSelectElement>(".rk-filters select")!; expect(Array.from(reasonSelect.options).map((option) => option.textContent)).toEqual(["Alle Gründe", ...table("reclamationReasons").map((row) => String(row.name)).sort((a, b) => a.localeCompare(b, "de"))]);
    await type(reasonSelect, "Kein Interesse", 900); await until(() => claimItems(root).length === 1); expect(texts(root, ".rk-item .rk-what b")).toEqual(["Kein Interesse"]); expect(filterButton().querySelector("em")!.textContent).toBe("1"); expect(filterButton().classList.contains("is-on")).toBe(true);
    const dueSelect = Array.from(root.querySelectorAll<HTMLElement>(".rk-filters .rd-field")).find((field) => field.querySelector("span")!.textContent === "Prüffrist")!.querySelector("select")!; await type(dueSelect, "überfällig", 900); await until(() => Boolean(root.querySelector(".rk-list .rd-none")));
    expect(root.querySelector(".rk-list .rd-none p")!.textContent).toBe("Zu dieser Auswahl gibt es keine Reklamation."); expect(filterButton().querySelector("em")!.textContent).toBe("2");
    await click(button(root, "Alle Reklamationen zeigen"), 900); await until(() => claimItems(root).length === claims.length); expect(claimItems(root).length).toBe(claims.length); expect(filterButton().querySelector("em")).toBeNull();
    expect(texts(root, ".rk .tg-how b")).toEqual(["Die Reklamation kommt an", "Du entscheidest", "Was danach passiert"]);
  }, 90_000);

  it("Reklamationen: CSV enthält die Reklamationen der Ansicht – mit Lead-Nummer, Name und Käufer", async () => {
    const saved: Array<{ name: string; type: string }> = []; const realCreate = document.createElement.bind(document);
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => { saved.push({ name: "", type: (blob as Blob).type }); return "blob:probe"; }); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string, options?: ElementCreationOptions) => { const node = realCreate(tag, options); if (tag === "a") (node as HTMLAnchorElement).click = function clickLink(this: HTMLAnchorElement) { if (saved.length) saved[saved.length - 1].name = this.download; }; return node; }) as typeof document.createElement);
    const root = await open("page=Reklamationen"); await until(() => claimItems(root).length > 0);
    await click(button(root, "CSV exportieren"), 600); expect(saved).toEqual([{ name: "Reklamationen.csv", type: "text/csv;charset=utf-8" }]);
    const claims = await call("leadops.listClaims", {}) as Claim[]; const sheet = claimsTable(claims as never);
    expect(sheet.rows).toHaveLength(5); expect(sheet.rows[0][0]).toBe(`REC-${claims[0].id}`); expect(sheet.rows[0][1]).toBe(claims[0].leadPublicId); expect(sheet.rows[0][2]).toBe(claimLeadName(claims[0])); expect(sheet.rows[0][5]).toBe(claims[0].buyerName);
  }, 60_000);

  it("Reklamationen: Zeile klappt an Ort und Stelle auf – Angaben, Verlauf, Frist ändern und entscheiden", async () => {
    const root = await open("page=Reklamationen"); await until(() => claimItems(root).length > 0);
    const claims = await call("leadops.listClaims", {}) as Claim[]; const counts = claimCounts(claims); const target = claims.find((claim) => claim.status === "offen")!; const stored = () => table("claims").find((row) => row.id === target.id)!;
    const item = () => root.querySelector<HTMLElement>(`#rk-${target.id}`)!;
    await click(item().querySelector(".rk-row"), 900); expect(item().classList.contains("is-open")).toBe(true); expect(item().querySelector(".rk-row")!.getAttribute("aria-expanded")).toBe("true"); expect(root.querySelectorAll(".rk-item.is-open").length).toBe(1);
    expect(texts(item(), ".rk-facts dt")).toEqual(["Grund", "Käufer hat bezahlt", "Erstattung", "Prüfen bis", "Entscheidung"]); const facts = () => texts(item(), ".rk-facts dd");
    expect(facts()[0]).toBe(target.reason); expect(facts()[3]).toBe(claimDay(target.dueAt)); expect(facts()[4]).toBe("steht aus"); expect(item().querySelector(".rk-text")!.textContent).toBe(target.details);
    expect(item().querySelector(".rk-leadbox b")!.textContent).toBe(claimLeadName(target)); expect(button(item(), "Lead öffnen")).toBeTruthy();
    await until(() => item().querySelectorAll(".rk-events li").length > 0); expect(texts(item(), ".rk-events b")).toEqual(expect.arrayContaining(["Erfasst", "Frist gesetzt"]));
    expect(item().querySelector(".rk-decide p")!.textContent).toContain("Ablehnen: Die Lieferung gilt wieder als angenommen."); expect(texts(item(), ".rk-decide button")).toEqual(["Ablehnen", "Genehmigen"]);
    // eine andere Zeile öffnen schließt diese
    const other = claims.find((claim) => claim.id !== target.id)!; await click(root.querySelector(`#rk-${other.id} .rk-row`), 700); expect(item().classList.contains("is-open")).toBe(false); expect(root.querySelector(`#rk-${other.id}`)!.classList.contains("is-open")).toBe(true);
    await click(item().querySelector(".rk-row"), 900);
    // Frist ändern: gespeichert, die Reklamation ist damit „in Prüfung“
    const later = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10); const dateInput = item().querySelector<HTMLInputElement>(".rk-duechange input")!; await type(dateInput, later, 200);
    await click(button(item(), "Frist speichern"), 1400); expect(said("Prüffrist gespeichert.")).toBe(true); expect(stored().status).toBe("in_prüfung"); expect(new Date(stored().dueAt).toISOString().slice(0, 10)).toBe(later);
    await until(() => item().querySelector(".rk-row .fx-pill")?.textContent === "In Prüfung"); expect(item().querySelector(".rk-row .fx-pill")!.textContent).toBe("In Prüfung"); expect(item().querySelector(".rk-due b")!.textContent).toBe(claimDeadline(stored()).text); expect(claimDeadline(stored()).text).toMatch(/^noch 1[12] Tage$/); expect(claimTab(root, "In Prüfung").textContent).toBe(`In Prüfung${counts.in_prüfung + 1}`);
    // ablehnen: entschieden, die Knöpfe sind weg, die Zahlen ziehen nach
    await click(button(item(), "Ablehnen"), 1600); expect(said("Reklamation abgelehnt. Die Lieferung gilt wieder als angenommen.")).toBe(true);
    expect(stored().status).toBe("abgelehnt"); expect(stored().resolvedAt).toBeTruthy(); await until(() => item().querySelector(".rk-row .fx-pill")?.textContent === "Abgelehnt");
    expect(item().querySelector(".rk-row .fx-pill")!.textContent).toBe("Abgelehnt"); expect(item().querySelector(".rk-decide")).toBeNull(); expect(item().querySelector(".rk-duechange")).toBeNull(); expect(facts()[4]).toBe(`Abgelehnt am ${claimDay(new Date())}`); expect(item().querySelector(".rk-due b")!.textContent).toBe(`entschieden am ${claimDay(new Date())}`);
    expect(claimTab(root, "Abgelehnt").textContent).toBe(`Abgelehnt${counts.abgelehnt + 1}`); expect(claimTab(root, "Offen").textContent).toBe(`Offen${counts.offen - 1}`); expect(railValues(root, ".rk > .tg-rail")).toEqual([counts.wartend - 1, counts.überfällig, counts.genehmigt, counts.abgelehnt + 1].map(String));
    await until(() => texts(item(), ".rk-events b").includes("Entschieden")); expect(texts(item(), ".rk-events b")).toContain("Entschieden"); expect(texts(item(), ".rk-events small")).toContain("In Prüfung → Abgelehnt"); // der Verlauf nennt die Entscheidung mit dem Wechsel des Stands
    // genehmigen einer anderen
    const second = claims.find((claim) => claim.status === "in_prüfung")!; await click(root.querySelector(`#rk-${second.id} .rk-row`), 900); await click(button(root.querySelector(`#rk-${second.id}`)!, "Genehmigen"), 1600);
    expect(table("claims").find((row) => row.id === second.id)!.status).toBe("genehmigt"); expect(statusOf(second.leadId)).toBe("reklamiert"); expect(said("Reklamation genehmigt.")).toBe(true);
    await until(() => root.querySelector(`#rk-${second.id} .rk-row .fx-pill`)?.textContent === "Genehmigt"); expect(root.querySelector(`#rk-${second.id} .rk-row .fx-pill`)!.className).toBe("fx-pill is-done");
  }, 90_000);

  it("Reklamationen – Sammelaktion: alle wartenden der Ansicht (offen und in Prüfung) mit einer Rückfrage entscheiden", async () => {
    const root = await open("page=Reklamationen"); await until(() => claimItems(root).length > 0);
    const counts = claimCounts(await call("leadops.listClaims", {}) as Claim[]); expect(counts.wartend).toBeGreaterThan(1);
    const bar = () => root.querySelector<HTMLElement>(".rk-bulk"); expect(bar()!.querySelector("span")!.textContent).toBe(`${counts.wartend} Reklamationen dieser Ansicht warten auf deine Entscheidung`); expect(texts(bar()!, "button")).toEqual(["Alle ablehnen", "Alle genehmigen"]);
    // im Reiter „Genehmigt“ gibt es nichts zu entscheiden
    await click(claimTab(root, "Genehmigt"), 600); expect(bar()).toBeNull(); await click(claimTab(root, "Alle"), 600);
    // abbrechen ändert nichts
    await click(button(bar()!, "Alle ablehnen"), 500); await until(() => Boolean(document.querySelector(".app-confirm-text")));
    expect(document.querySelector(".app-confirm-text")!.textContent).toBe(`Alle ${counts.wartend} Reklamationen dieser Ansicht, die noch warten, ablehnen? Die Lieferungen gelten dann wieder als angenommen.`); expect(document.querySelector(".app-confirm-ok")!.textContent).toBe("Ja, ablehnen");
    await click(document.querySelector(".app-confirm-cancel"), 500); expect(table("claims").filter((row) => !row.resolvedAt).length).toBe(counts.wartend);
    await click(button(bar()!, "Alle ablehnen"), 500); await confirmOk();
    expect(table("claims").filter((row) => !row.resolvedAt).length).toBe(0); expect(table("claims").filter((row) => row.status === "abgelehnt").length).toBe(counts.abgelehnt + counts.wartend); expect(said(`${counts.wartend} Reklamationen abgelehnt.`)).toBe(true);
    await until(() => !bar()); expect(bar()).toBeNull(); expect(railValues(root, ".rk > .tg-rail")).toEqual([0, 0, counts.genehmigt, counts.abgelehnt + counts.wartend].map(String)); expect(root.querySelector(".rk > .tg-rail .tg-stat small")!.textContent).toBe("nichts zu entscheiden");
    expect(table("claimEvents").filter((row) => row.note === "Sammelaktion: Reklamation abgelehnt.").length).toBe(counts.wartend);
  }, 60_000);

  it("Einzeln oder Sammelaktion – derselbe Weg: abgelehnt gibt Lieferung und Lead-Status zurück, genehmigt gibt laut Regel weiter; die Liste nennt den Käufer", async () => {
    // die Lieferung, die eine Reklamation trifft: die letzte, die noch gilt (angeboten oder angenommen)
    const lastGood = (leadId: number) => deliveriesOf(leadId).filter((delivery) => ["angenommen", "angeboten"].includes(delivery.result)).sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())[0] as Row | undefined;
    const free = (lead: Row) => lead.kind !== "vertrieb" && lead.status !== "reklamiert" && !table("claims").some((claim) => claim.leadId === lead.id) && Boolean(lastGood(lead.id)) && lastGood(lead.id)!.claimId == null;
    const make = async (leadId: number, reason: string) => (await call("leadops.createClaim", { leadId, reason })).claimId as number;
    // Station, an der „Dublette“ weitergegeben wird (Kette mit zwei Stationen) – jeder andere Grund endet dort
    const passRule = table("deliveryStopReasons").find((rule) => rule.passOn)!; const passReason = table("reclamationReasons").find((row) => row.id === passRule.reasonId)!.name as string; const endReason = table("reclamationReasons").find((row) => row.id === table("deliveryStopReasons").find((rule) => rule.stopId === passRule.stopId && !rule.passOn)!.reasonId)!.name as string;
    const [one, two, five] = table("leads").filter(free); expect(five).toBeTruthy(); const was = { [one.id]: one.status as string, [two.id]: two.status as string, [five.id]: five.status as string };
    // erfasst: Lead und Lieferung sind reklamiert, die Lieferung hängt an der Reklamation; die Liste nennt Käufer und Preis
    const hit = lastGood(one.id)!; const hitTwo = lastGood(two.id)!; const c1 = await make(one.id, endReason); const c2 = await make(two.id, endReason); const delivery = (id: number) => table("leadDeliveries").find((row) => row.id === id)!;
    expect(statusOf(one.id)).toBe("reklamiert"); expect(delivery(hit.id)).toMatchObject({ result: "reklamiert", claimId: c1 });
    const row = async (claimId: number) => (await call("leadops.listClaims", {}) as Claim[]).find((claim) => claim.id === claimId)!; expect(await row(c1)).toMatchObject({ status: "offen", buyerName: hit.buyerName, unitPrice: hit.unitPrice });
    // abgelehnt – einmal einzeln, einmal in der Sammelaktion: Lieferung gilt wieder, der Lead hat seinen Status von vorher, beides steht im Lead-Log
    expect(await call("leadops.resolveClaim", { claimId: c1, status: "abgelehnt" })).toEqual({ success: true, reinjected: false }); expect(await call("leadops.bulkResolveClaims", { claimIds: [c2, c1], status: "abgelehnt" })).toEqual({ updated: 1, reinjected: 0 });
    for (const [lead, reclaimed] of [[one, hit], [two, hitTwo]] as const) { expect(statusOf(lead.id)).toBe(was[lead.id]); expect(delivery(reclaimed.id)).toMatchObject({ result: "angenommen", claimId: null });
      expect(table("leadStatusEvents").filter((event) => event.leadId === lead.id).slice(-2).map((event) => [event.previousStatus, event.nextStatus, event.note])).toEqual([[was[lead.id], "reklamiert", "Reklamation erfasst."], ["reklamiert", was[lead.id], "Reklamation abgelehnt – der Lead gilt wieder wie vor der Reklamation."]]); }
    expect(await row(c1)).toMatchObject({ status: "abgelehnt", buyerName: hit.buyerName, unitPrice: hit.unitPrice }); // die Verknüpfung ist gelöst – der Käufer steht trotzdem da
    expect(table("claimEvents").filter((event) => event.claimId === c2 && event.eventType === "entschieden").map((event) => event.note)).toEqual(["Sammelaktion: Reklamation abgelehnt."]);
    // zwei Reklamationen an einem Lead: erst wenn beide abgelehnt sind, ist er nicht mehr reklamiert
    const c5 = await make(five.id, endReason); const c6 = await make(five.id, endReason);
    await call("leadops.resolveClaim", { claimId: c5, status: "abgelehnt" }); expect(statusOf(five.id)).toBe("reklamiert"); await call("leadops.bulkResolveClaims", { claimIds: [c6], status: "abgelehnt" }); expect(statusOf(five.id)).toBe(was[five.id]);
    // genehmigt mit einem Grund, der weitergegeben wird: derselbe Lead einmal einzeln, einmal in der Sammelaktion (Vorschau dazwischen neu aufgebaut) – es kommt dasselbe heraus
    const atStop = (lead: Row) => free(lead) && lastGood(lead.id)!.stopId === passRule.stopId; const leadId = table("leads").find(atStop)!.id as number;
    const outcome = async (mode: "einzeln" | "sammel") => { resetStore(); expect(atStop(table("leads").find((lead) => lead.id === leadId)!)).toBe(true); const claimId = await make(leadId, passReason);
      const answer = mode === "einzeln" ? await call("leadops.resolveClaim", { claimId, status: "genehmigt" }) : await call("leadops.bulkResolveClaims", { claimIds: [claimId], status: "genehmigt" });
      return { reinjected: mode === "einzeln" ? Boolean(answer.reinjected) : answer.reinjected === 1, updated: mode === "einzeln" ? 1 : answer.updated, status: statusOf(leadId), deliveries: deliveriesOf(leadId).map((item) => [item.stopId, item.result, item.claimId === claimId]), note: table("claimEvents").filter((event) => event.claimId === claimId && event.eventType === "entschieden").map((event) => [event.previousStatus, event.nextStatus]) }; };
    const single = await outcome("einzeln"); const bulk = await outcome("sammel"); expect(bulk).toEqual(single);
    expect(single.reinjected).toBe(true); expect(single.deliveries.filter((item) => item[1] === "reklamiert" && item[2])).toEqual([[passRule.stopId, "reklamiert", true]]); expect(single.note).toEqual([["offen", "genehmigt"]]); // der Lead ging an die nächste Station
  }, 60_000);

  it("Reklamation erfassen: Lead suchen, Grund aus der Liste wählen – die neue Reklamation steht aufgeklappt in der Liste", async () => {
    const root = await open("page=Reklamationen"); await until(() => claimItems(root).length > 0);
    const counts = claimCounts(await call("leadops.listClaims", {}) as Claim[]); const lead = table("leads").find((row) => row.kind !== "vertrieb" && row.firstName && row.lastName && row.status === "zugewiesen" && !table("claims").some((claim) => claim.leadId === row.id))!;
    await click(button(root, "Reklamation erfassen"), 600); const panel = () => root.querySelector<HTMLElement>(".rk > .cf")!; expect(panel().querySelector("h2")!.textContent).toBe("Reklamation erfassen"); expect(panel().querySelector(".rk-quiet")!.textContent).toBe("Gib mindestens zwei Zeichen ein.");
    // erst der Lead
    await type(panel().querySelector(".fx-search input"), "zzqqxx", 900); await until(() => panel().querySelector(".rk-quiet")?.textContent?.startsWith("Kein Lead") ?? false); expect(panel().querySelector(".rk-quiet")!.textContent).toBe("Kein Lead zu „zzqqxx“ gefunden.");
    await type(panel().querySelector(".fx-search input"), lead.publicId, 900); await until(() => panel().querySelectorAll(".rk-hits button").length > 0);
    expect(texts(panel(), ".rk-hits button b")).toEqual([`${lead.firstName} ${lead.lastName}`]); expect(panel().querySelector(".rk-hits small")!.textContent).toContain(lead.publicId);
    await click(panel().querySelector(".rk-hits button"), 900);
    // dann Grund und Angaben
    expect(panel().querySelector(".ld-head p")!.textContent).toContain(`${lead.firstName} ${lead.lastName} (${lead.publicId})`); expect(texts(panel(), ".rd-field > span")).toEqual(["Grund", "Prüfen bis", "Erstattung in € (freiwillig)", "Was stimmt nicht? (freiwillig)"]);
    const names = table("reclamationReasons").filter((row) => row.active).map((row) => String(row.name)); const select = () => panel().querySelector<HTMLSelectElement>(".cf-reason select")!;
    expect(Array.from(select().options).map((option) => option.textContent)).toEqual(["Bitte wählen …", ...names, "Anderer Grund …"]); expect(panel().querySelector(".cf-reason input")).toBeNull();
    const claimsBefore = table("claims").length; await click(button(panel(), "Reklamation anlegen"), 500); expect(said("Bitte einen Reklamationsgrund wählen.")).toBe(true); expect(table("claims").length).toBe(claimsBefore); // ohne Grund geht es nicht
    await type(select(), "__anderer__", 300); expect(panel().querySelector<HTMLInputElement>(".cf-reason input")!.getAttribute("aria-label")).toBe("Anderer Reklamationsgrund"); // freier Text bleibt möglich
    await type(select(), names[0], 300); expect(panel().querySelector(".cf-reason input")).toBeNull();
    await type(panel().querySelector("textarea"), "Nummer nicht vergeben.", 200); await type(panel().querySelector('input[aria-label="Erstattungsbetrag"]'), "abc", 200);
    await click(button(panel(), "Reklamation anlegen"), 500); expect(said("Die Erstattung muss ein Betrag in Euro sein")).toBe(true); expect(table("claims").length).toBe(claimsBefore);
    await type(panel().querySelector('input[aria-label="Erstattungsbetrag"]'), "39,50", 200); await click(button(panel(), "Reklamation anlegen"), 1800);
    expect(table("claims").length).toBe(claimsBefore + 1); const made = table("claims")[table("claims").length - 1]; expect(made).toMatchObject({ leadId: lead.id, reason: names[0], details: "Nummer nicht vergeben.", status: "offen", refundAmount: "39.50" });
    const days = (new Date(made.dueAt).getTime() - Date.now()) / 86_400_000; expect(days).toBeGreaterThan(6.4); expect(days).toBeLessThan(7.6); // vorgeschlagen: in 7 Tagen (mittags)
    expect(statusOf(lead.id)).toBe("reklamiert"); expect(said("Reklamation erfasst.")).toBe(true);
    // Fenster zu, die neue Reklamation ist aufgeklappt, die Zahlen ziehen nach
    await until(() => Boolean(root.querySelector(`#rk-${made.id}.is-open`))); expect(root.querySelector(".rk > .cf")).toBeNull(); expect(root.querySelector(`#rk-${made.id}`)!.classList.contains("is-open")).toBe(true);
    expect(root.querySelector(`#rk-${made.id} .rk-what b`)!.textContent).toBe(names[0]); expect(railValues(root, ".rk > .tg-rail")[0]).toBe(String(counts.wartend + 1)); expect(claimTab(root, "Offen").textContent).toBe(`Offen${counts.offen + 1}`);
    // Schließen ohne Anlegen
    await click(button(root, "Reklamation erfassen"), 500); expect(panel()).toBeTruthy(); await click(panel().querySelector(".ld-close"), 400); expect(root.querySelector(".rk > .cf")).toBeNull();
  }, 90_000);

  it("Link zu einer Reklamation: Die Liste öffnet mit ihr aufgeklappt – auch von der Lead-Seite aus („Jetzt entscheiden“)", async () => {
    const claims = await call("leadops.listClaims", {}) as Claim[]; const decided = claims.find((claim) => claim.resolvedAt)!; const waiting = claims.find((claim) => !claim.resolvedAt)!;
    const direct = await open(`page=Reklamationen&claimId=${decided.id}`); await until(() => Boolean(direct.querySelector(`#rk-${decided.id}.is-open`)));
    expect(direct.querySelectorAll(".rk-item.is-open").length).toBe(1); expect(direct.querySelector(`#rk-${decided.id} .rk-detail`)).toBeTruthy(); expect(direct.querySelector(`#rk-${decided.id} .rk-decide`)).toBeNull(); // schon entschieden: nichts mehr zu entscheiden
    expect(claimItems(direct).length).toBe(claims.length); cleanup();
    // von der Lead-Seite
    const lead = table("leads").find((row) => row.id === waiting.leadId)!; const root = await open(`page=Leads&lead=${lead.publicId}`); await until(() => root.querySelectorAll(".lp-entry-side .lp-link").length > 0);
    const link = Array.from(root.querySelectorAll<HTMLButtonElement>(".lp-entry-side .lp-link")).find((node) => node.textContent === "Jetzt entscheiden")!; await click(link, 1800);
    const params = new URLSearchParams(window.location.search); expect(params.get("page")).toBe("Reklamationen"); expect(params.get("claimId")).toBe(String(waiting.id));
    await until(() => Boolean(root.querySelector(`#rk-${waiting.id}.is-open`))); expect(root.querySelector(`#rk-${waiting.id}`)!.classList.contains("is-open")).toBe(true); expect(texts(root.querySelector(`#rk-${waiting.id}`)!, ".rk-decide button")).toEqual(["Ablehnen", "Genehmigen"]);
  }, 90_000);

  it("Leere Zustände: ohne Listen bzw. ohne Reklamationen steht da, wie es losgeht – mit dem passenden Knopf", async () => {
    const tables = getStore().tables as unknown as Record<string, Row[]>; tables.rawContacts.length = 0; tables.rawBatches.length = 0; tables.claims.length = 0; tables.claimEvents.length = 0;
    const root = await open("page=Rohdaten"); await until(() => Boolean(root.querySelector(".rd-lists .rd-empty")));
    expect(root.querySelector(".rd-lists .rd-empty b")!.textContent).toBe("Noch keine Liste"); expect(root.querySelector(".rd-lists .tg-count")!.textContent).toBe("0 Listen"); expect(root.querySelector(".rd-batch")).toBeNull();
    expect(railValues(root, ".rd-rail")).toEqual(["0", "0", "0", "0", "0"]); expect(texts(root, ".rd-rail .tg-stat small")).toEqual(["in 0 Listen", "nichts mehr offen", "von allen Kontakten", "kein Kontakt verworfen", "kein Kontakt doppelt"]);
    await until(() => Boolean(root.querySelector(".rd-report .tg-note")) && Boolean(root.querySelector(".rd-contacts .rd-none")));
    expect(root.querySelector(".rd-report .tg-note")!.textContent).toBe("Noch keine Kontakte – also auch noch nichts auszuwerten."); expect(root.querySelector(".rd-contacts .rd-none p")!.textContent).toBe("Noch keine Kontakte – lade oben eine Liste hoch."); expect(root.querySelector(".rd-contacts .rd-none button")).toBeNull();
    await click(button(root.querySelector(".rd-lists .rd-empty")!, "Liste hochladen"), 500); expect(root.querySelector(".rd-upload")).toBeTruthy(); cleanup();
    const desk = await open("page=Reklamationen"); await until(() => Boolean(desk.querySelector(".rk-list .rd-empty")));
    expect(desk.querySelector(".rk-list .rd-empty b")!.textContent).toBe("Noch keine Reklamation"); expect(claimItems(desk)).toHaveLength(0); expect(desk.querySelector(".rk-bulk")).toBeNull(); expect(button(desk, "CSV exportieren")!.disabled).toBe(true);
    expect(railValues(desk, ".rk > .tg-rail")).toEqual(["0", "0", "0", "0"]); expect(texts(desk, ".rk > .tg-rail .tg-stat small")).toEqual(["nichts zu entscheiden", "keine Frist überschritten", "noch nichts entschieden", "noch keine abgelehnt"]); expect(desk.querySelector(".rk > .tg-rail .tg-stat.is-late")).toBeNull();
    expect(texts(desk, ".rk-list .fx-tabs button")).toEqual(["Alle0", "Offen0", "In Prüfung0", "Genehmigt0", "Abgelehnt0"]);
    await click(button(desk.querySelector(".rk-list .rd-empty")!, "Reklamation erfassen"), 500); expect(desk.querySelector(".rk > .cf")).toBeTruthy();
  }, 60_000);

  it("Reklamation im Bereich des Käufers: nur Grund und Beschreibung – Prüffrist und Erstattung legt der Verkäufer fest", async () => {
    const lead = table("leads").find((row) => row.kind !== "vertrieb" && !table("claims").some((claim) => claim.leadId === row.id))!; const createdIds: number[] = []; let closed = 0;
    const view = providers(<LeadClaimForm asBuyer leadId={lead.id} publicId={lead.publicId} onClose={() => { closed += 1; }} onCreated={(claimId) => createdIds.push(claimId)} />); await settle(900); const form = view.container;
    expect(form.querySelector(".cf h2")!.textContent).toBe("Reklamation erfassen"); expect(form.querySelector(".ld-head p")!.textContent).toBe(`Für den Lead ${lead.publicId}. Wir prüfen die Reklamation und entscheiden darüber.`);
    expect(texts(form, ".rd-field > span")).toEqual(["Grund", "Was stimmt nicht? (freiwillig)"]); expect(form.querySelector('input[type="date"]')).toBeNull(); expect(form.querySelector('input[aria-label="Erstattungsbetrag"]')).toBeNull();
    expect(button(form, "Reklamation einreichen")).toBeTruthy(); await click(form.querySelector(".ld-close"), 200); expect(closed).toBe(1);
    const names = table("reclamationReasons").filter((row) => row.active).map((row) => String(row.name)); await type(form.querySelector(".cf-reason select"), names[1], 200); await type(form.querySelector("textarea"), "Kunde ist Mieter.", 200);
    await click(button(form, "Reklamation einreichen"), 1500); expect(createdIds).toHaveLength(1); const made = table("claims").find((row) => row.id === createdIds[0])!;
    expect(made).toMatchObject({ leadId: lead.id, reason: names[1], details: "Kunde ist Mieter.", refundAmount: null, status: "offen" }); expect(Math.round((new Date(made.dueAt).getTime() - Date.now()) / 86_400_000)).toBe(7); // Frist setzt der Server: 7 Tage
  }, 60_000);
});
