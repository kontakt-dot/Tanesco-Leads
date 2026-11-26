import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, resetStore } from "../backend";
import { berlinDay, euro, quickRange, share, type ReportCard } from "../../../../shared/partner-report";

/**
 * Version 373 – Statistik „Integrationen“: je Partnerkonto eine Karte mit zwei Blöcken Kennzahlen (Zustellung, Bewertung durch den Partner),
 * Käufer-Tabelle und Bereichen zum Aufklappen; Filter (Sparte, Zeitraum, Zeitbasis, Schnellwahl) stehen in der Adresse.
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
async function until(check: () => boolean, tries = 40) { for (let index = 0; index < tries && !check(); index += 1) await settle(150); }
const click = async (node: Element | null | undefined, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const open = async (query: string, wait = 2800) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
const reportNow = async (input: Record<string, unknown> = {}) => (await callProcedure("leadops.partnerReport", input) as { cards: ReportCard[]; from: string; to: string }).cards;
const tiles = (card: Element, block: string) => Array.from(card.querySelectorAll(`section[aria-label="${block}"] .pr-tile`)).map((node) => [node.querySelector("span")!.textContent, node.querySelector("strong")!.textContent, node.querySelector("small")?.textContent ?? ""]);

describe("Version 373", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); resetStore(); });

  it("Integrationen: je Konto acht Kennzahlen mit Quoten nach Formel, Balken, Käufer-Tabelle – Konto ohne Zugang und selbst meldender Partner haben ihren eigenen Kopf", async () => {
    const root = await open("page=Statistik&view=Integrationen"); await until(() => root.querySelectorAll(".pr-card").length > 0);
    const cards = await reportNow(); const dom = Array.from(root.querySelectorAll<HTMLElement>(".pr-card")); expect(dom.map((node) => node.querySelector("h3")!.textContent)).toEqual(["Aroundhome (Account 1)", "Aroundhome (D2D Account)", "WattFox", "Leadnodes"]);
    const c = cards[0].counts; expect(c.delivered).toBeGreaterThan(20); expect(c.rejected + c.accepted + c.pending).toBe(c.delivered); expect(c.rated).toBe(c.open + c.confirmed + c.cancelled); expect(c.silent).toBe(c.accepted - c.rated);
    expect(tiles(dom[0], "Zustellung")).toEqual([["Geliefert", String(c.delivered), ""], ["PrePing abgelehnt", String(c.rejected), `${share(c.rejected, c.delivered)} · hatte der Partner schon – sofort beim Senden abgelehnt (meist Dublette)`], ["Angenommen", String(c.accepted), `${share(c.accepted, c.delivered)} der gelieferten`], ["Gesamtquote", share(c.confirmed, c.delivered), `${c.confirmed} anerkannt von ${c.delivered} gelieferten${c.open ? ` · ${c.open} noch offen` : ""}`]]);
    expect(tiles(dom[0], "Bewertung durch den Partner")).toEqual([["Offen", String(c.open), `${share(c.open, c.accepted)} · noch nicht entschieden`], ["Anerkannt", String(c.confirmed), `${share(c.confirmed, c.rated)} der bewerteten · davon ${c.paid} ausgezahlt`], ["Storniert", String(c.cancelled), `${share(c.cancelled, c.rated)} der bewerteten`], ["Provision", euro(c.commission), `Ø ${euro(c.commission / c.confirmed)} je anerkanntem Lead`]]);
    expect(dom[0].querySelector('section[aria-label="Bewertung durch den Partner"] h4 span')!.textContent).toBe(`${c.rated} von ${c.accepted} angenommenen bewertet`);
    expect(dom[0].querySelectorAll(".pr-flow-bar i").length).toBeGreaterThanOrEqual(3); expect(dom[0].querySelector(".pr-sync button")!.textContent).toContain("Aktualisieren");
    // Käufer-Tabelle: die Zeilen ergeben zusammen die Kachel „Geliefert“
    const buyerRows = Array.from(dom[0].querySelectorAll(":scope > .pr-table-wrap tbody tr")); expect(buyerRows.length).toBe(cards[0].buyers.length); expect(buyerRows.reduce((sum, row) => sum + Number(row.querySelectorAll("td")[1].textContent), 0)).toBe(c.delivered);
    // D2D: keine Zustellungen, nur Transaktionen ohne Zustellung – Hinweiszeile nennt die Provision; keine Käufer-Tabelle
    expect(cards[1].counts.delivered).toBe(0); expect(cards[1].unmatched).toBeGreaterThan(10); expect(dom[1].querySelector(".pr-hints")!.textContent).toContain(`Ihre Provision (${euro(cards[1].unmatchedCommission)}) steckt in der Kachel „Provision“.`); expect(dom[1].querySelector(":scope > .pr-table-wrap")).toBeNull();
    expect(tiles(dom[1], "Zustellung")[3]).toEqual(["Gesamtquote", "—", "0 anerkannt von 0 gelieferten"]); // Nenner 0 → Gedankenstrich
    // WattFox meldet selbst: kein Knopf; Leadnodes ohne Rückkanal: Hinweis auf die Einstellungen, kein Bewertungsblock
    expect(dom[2].querySelector(".pr-sync button")).toBeNull(); expect(dom[2].querySelector(".pr-sync")!.textContent).toContain("meldet jede Änderung selbst");
    expect(dom[3].querySelector(".pr-sync a")!.getAttribute("href")).toBe("/?page=Einstellungen&setting=Integrationen"); expect(dom[3].querySelector('section[aria-label="Bewertung durch den Partner"]')).toBeNull();
    // Leiste über allen Konten
    const sum = cards.reduce((total, card) => total + card.counts.delivered, 0); expect(root.querySelectorAll(".pr-rail .pr-stat strong")[1].textContent).toBe(String(sum));
  }, 40_000);

  it("Filter stehen in der Adresse: Schnellwahl, Zeitbasis mit Erklärung, Sparte – „Anwenden“ erst nach einer Änderung", async () => {
    const root = await open("page=Statistik&view=Integrationen"); await until(() => root.querySelectorAll(".pr-card").length > 0);
    const today = berlinDay(new Date()); const quick = (label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>(".pr-quick button")).find((node) => node.textContent === label)!; const params = () => new URLSearchParams(window.location.search);
    expect(Array.from(root.querySelectorAll(".pr-quick button")).map((node) => node.textContent)).toEqual(["Heute", "Gestern", "Letzte 7 Tage", "Letzte 30 Tage", "Diese Woche", "Letzte Woche", "Dieser Monat", "Letzter Monat", "Maximal"]);
    expect(quick("Letzte 30 Tage").getAttribute("aria-pressed")).toBe("true"); expect(params().get("from")).toBeNull(); expect(root.querySelector(".pr-basis-note")).toBeNull();
    const applyButton = () => Array.from(root.querySelectorAll<HTMLButtonElement>(".pr-filter button")).find((node) => node.textContent === "Anwenden")!; expect(applyButton().disabled).toBe(true);
    await click(quick("Letzte 7 Tage")); const week = quickRange("last7", today); expect(params().get("from")).toBe(week.from); expect(params().get("to")).toBe(week.to); expect(quick("Letzte 7 Tage").className).toContain("is-on");
    const seven = await reportNow({ from: week.from, to: week.to }); await until(() => root.querySelector(".pr-card .pr-tile strong")!.textContent === String(seven[0].counts.delivered)); expect(root.querySelector(".pr-card .pr-tile strong")!.textContent).toBe(String(seven[0].counts.delivered));
    // Zeitbasis: Bearbeitungsdatum – Erklärung erscheint, Offen ist 0
    const basis = root.querySelector<HTMLSelectElement>(".pr-basis select")!; await act(async () => { fireEvent.change(basis, { target: { value: "processed" } }); }); await settle(700);
    expect(params().get("basis")).toBe("processed"); expect(root.querySelector(".pr-basis-note")!.textContent).toContain("Bearbeitungsdatum:"); expect(tiles(root.querySelector(".pr-card")!, "Bewertung durch den Partner")[0][1]).toBe("0");
    // Von ändern → „Anwenden“ wird frei und übernimmt
    const from = root.querySelector<HTMLInputElement>('.pr-filter input[type="date"]')!; await act(async () => { fireEvent.change(from, { target: { value: "2026-01-01" } }); }); await settle(100); expect(applyButton().disabled).toBe(false); await click(applyButton()); expect(params().get("from")).toBe("2026-01-01"); expect(applyButton().disabled).toBe(true);
    // Sparte
    const sparte = root.querySelector<HTMLSelectElement>(".pr-filter select")!; expect(sparte.options[0].textContent).toBe("Alle Sparten"); const names = Array.from(sparte.options).slice(1).map((option) => option.textContent!); expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "de")));
    await act(async () => { fireEvent.change(sparte, { target: { value: sparte.options[1].value } }); }); await settle(600); expect(params().get("leadType")).toBe(sparte.options[1].value);
  }, 40_000);

  it("Aufklappen: Kontakte laden erst dann – Statusfilter, Suche und Zähler; Stornogründe ergeben die Kachel „Storniert“; D2D nach Vertriebler und Tag", async () => {
    const root = await open("page=Statistik&view=Integrationen"); await until(() => root.querySelectorAll(".pr-card").length > 0); const cards = await reportNow();
    const card = root.querySelector<HTMLElement>(".pr-card")!; const fold = (scope: Element, title: string) => Array.from(scope.querySelectorAll<HTMLDetailsElement>(".pr-fold")).find((node) => node.querySelector("summary span")!.textContent === title)!;
    expect(Array.from(card.querySelectorAll(".pr-fold summary")).map((node) => `${node.querySelector("span")!.textContent} ${node.querySelector("em")!.textContent}`)).toEqual([`Sparten beim Partner ${cards[0].counts.rated}`, `Kampagnen (wie auf der Gutschrift) ${cards[0].counts.confirmed}`, `Kontakte ${cards[0].counts.delivered}`, `Stornogründe ${cards[0].counts.cancelled}`]);
    const contacts = fold(card, "Kontakte"); expect(contacts.querySelector(".pr-contacts")).toBeNull();
    await act(async () => { contacts.open = true; fireEvent(contacts, new Event("toggle")); }); await until(() => Boolean(contacts.querySelector(".pr-table tbody tr")));
    expect(contacts.querySelector(".pr-contacts-count")!.textContent).toBe(`${cards[0].counts.delivered} Kontakte`); expect(contacts.querySelectorAll(".pr-table tbody tr").length).toBe(Math.min(50, cards[0].counts.delivered));
    expect(Array.from(contacts.querySelectorAll<HTMLOptionElement>(".pr-contacts-tools select option")).map((option) => option.textContent)).toEqual(["Alle", "Nur bestätigt", "Nur ausgezahlt", "Nur storniert", "Nur offen", "Ohne Rückmeldung", "Nur PrePing abgelehnt"]);
    await act(async () => { fireEvent.change(contacts.querySelector(".pr-contacts-tools select")!, { target: { value: "cancelled" } }); }); await until(() => contacts.querySelector(".pr-contacts-count")!.textContent === `${cards[0].counts.cancelled} Kontakte`);
    expect(Array.from(contacts.querySelectorAll(".pr-status")).every((node) => node.textContent === "Storniert")).toBe(true); expect(contacts.querySelector(".pr-table tbody a")!.getAttribute("href")).toMatch(/^\/\?page=Leads&lead=/);
    const name = contacts.querySelector(".pr-table tbody a b")!.textContent!; const before = contacts.querySelector(".pr-contacts-count")!.textContent; await act(async () => { fireEvent.change(contacts.querySelector(".pr-search input")!, { target: { value: name } }); }); await until(() => contacts.querySelector(".pr-contacts-count")!.textContent !== before); await settle(300);
    expect(Number(contacts.querySelector(".pr-contacts-count")!.textContent!.split(" ")[0])).toBeGreaterThanOrEqual(1); expect(Array.from(contacts.querySelectorAll(".pr-table tbody tr")).every((row) => name.toLowerCase().split(/\s+/).every((word) => row.textContent!.toLowerCase().includes(word)))).toBe(true); // jedes Wort der Suche steht in der Zeile
    const reasons = fold(card, "Stornogründe"); expect(Array.from(reasons.querySelectorAll("tbody tr")).reduce((sum, row) => sum + Number(row.querySelectorAll("td")[1].textContent), 0)).toBe(cards[0].counts.cancelled);
    const direct = fold(root.querySelectorAll(".pr-card")[1], "Direkt beim Partner eingeliefert"); expect(Array.from(direct.querySelectorAll(".pr-tile span")).map((node) => node.textContent)).toEqual(["Eingeliefert", "Qualifiziert", "Storniert", "Offen"]);
    expect(Array.from(direct.querySelectorAll("caption")).map((node) => node.textContent)).toEqual(["Nach Vertriebler (Sub-ID)", "Nach Tag"]); expect(direct.querySelector(".pr-tile strong")!.textContent).toBe(String(cards[1].unmatched));
  }, 40_000);
});
