import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { getStore, resetStore } from "../backend";

// Profilbild: Das Klein-Rechnen im Browser braucht eine Zeichenfläche (gibt es in der Testumgebung nicht) – hier kommt stattdessen ein festes kleines Bild zurück
const { TEST_AVATAR } = vi.hoisted(() => ({ TEST_AVATAR: `data:image/jpeg;base64,${btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0) + "x".repeat(240))}` }));
vi.mock("@/lib/avatar-image", () => ({ fileToAvatarDataUrl: vi.fn(async (file: File) => { if (/kaputt/.test(file.name)) throw new Error("Dieses Bild kann der Browser nicht lesen. Bitte ein Foto als JPG oder PNG wählen."); return TEST_AVATAR; }) }));

const routes = [
  "page=Dashboard", "page=Statistik", "page=Statistik&view=Käufer", "page=Statistik&view=Lieferanten", "page=Statistik&view=Lieferketten", "page=Statistik&view=Integrationen",
  "page=Leads", "page=Lead-Kategorien", "page=Lead-Kategorien&library=1", "page=Lead-Kategorien&builder=1", "page=Tags",
  "page=Bestellungen", "page=Bestellungen&overview=1", "page=Bestellungen&orderId=1", "page=Lieferkette", "page=E-Mails", "page=Lieferkette&chain=1", "page=Lieferkette&chain=5", "page=Rohdaten", "page=Haustür-Erfassung", "page=Vertriebspipeline", "page=E-Mail-Kampagnen", "page=Verträge", "page=Verträge&vertrag=1", "page=Haustür-Erfassung&view=erfassen", "page=Haustür-Erfassung&view=vertriebler", "page=Haustür-Erfassung&view=einstellungen", "page=Telefonie", "page=Telefonie&view=kampagnen", "page=Telefonie&view=rufnummern", "page=Telefonie&view=einstellungen", "page=Telefonie&view=anrufe", "page=Gespräche", "page=Gespräche&callId=1", "page=Gespräche&view=Einstellungen", "page=Automatisierung", "page=Automatisierung&view=Protokoll",
  "page=Reklamationen", "page=Reklamationen&claimId=1", "page=Teams", "page=Benutzer", "page=Benutzer&member=2", "page=Benutzer&member=2&tab=lieferant", "page=Benutzer&member=2&tab=reklamation", "page=Benutzer&member=2&tab=tools", "page=Benutzer&view=Partnerprofile", "page=Benutzer&view=Einladungen", "page=Integrationen", "page=Kooperationen",
  "page=Support", "page=Rechnungen", "page=Rechnungen&invoiceId=1", "page=Einstellungen",
  "page=Einstellungen&setting=System", "page=Einstellungen&setting=Ansicht", "page=Einstellungen&setting=Rechnung+%26+Rechtliches", "page=Einstellungen&setting=API-Dokumentation", "page=Einstellungen&setting=Integrationen", "page=Einstellungen&setting=API-Dokumentation", "page=Einstellungen&setting=Branding", "page=Einstellungen&setting=E-Mail", "page=Einstellungen&setting=Reklamationen", "page=Einstellungen&setting=Zahlung", "page=Einstellungen&setting=Abonnement", "page=Einstellungen&setting=Affiliate", "page=Einstellungen&setting=Nutzungsbedingungen", "page=Einstellungen&setting=Passwort", "page=Einstellungen&setting=Domain", "page=Statistik&view=Bestellungen",
];

const ignorable = [/not wrapped in act/, /ReactDOMTestUtils/, /Warning: /, /validateDOMNesting/, /act\(/];

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  const view = render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
  return { view, queryClient };
}

async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }

describe("Seiten des Chat-Builds", () => {
  const errors: string[] = [];
  beforeEach(() => { errors.length = 0; resetStore(); vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { const text = args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : String(arg))).join(" "); if (!ignorable.some((pattern) => pattern.test(text))) errors.push(text); }); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  for (const route of routes) {
    it(`rendert ${route}`, async () => {
      window.history.replaceState(null, "", `/?${route}`);
      const { view, queryClient } = mount();
      await settle(300); await settle(300); await settle(300);
      const html = view.container.innerHTML;
      const queries = queryClient.getQueryCache().getAll();
      const failed = queries.filter((query) => query.state.status === "error").map((query) => `${JSON.stringify(query.queryKey)} → ${(query.state.error as Error)?.message}`);
      const pending = queries.filter((query) => query.state.status === "pending" && query.state.fetchStatus !== "idle").map((query) => JSON.stringify(query.queryKey));
      expect(failed, `fehlgeschlagene Abfragen bei ${route}`).toEqual([]);
      expect(pending, `noch ladende Abfragen bei ${route}`).toEqual([]);
      console.log(`${route}: ${queries.length} Abfragen, ${html.length} Zeichen`);
      expect(html, `ErrorBoundary ausgelöst bei ${route}`).not.toContain("An unexpected error occurred");
      expect(errors, `console.error bei ${route}`).toEqual([]);
      expect(html.length).toBeGreaterThan(500);
      // Jede Seite zeigt ihre eigene Überschrift (nicht die einer anderen Seite)
      const page = new URLSearchParams(route).get("page") ?? "Dashboard";
      const expectedHeading: Record<string, RegExp> = { Benutzer: /Benutzer|Personen/, Teams: /Teams/, Tags: /Tags/, Leads: /Leads|Lead/, Lieferkette: /Lieferkette/, Bestellungen: /Bestellungen/, Statistik: /Statistik/, Reklamationen: /Reklamationen/, Automatisierung: /Automatisierung/ };
      const heading = view.container.querySelector("h1")?.textContent ?? "";
      if (page === "Statistik") expect(view.container.querySelector("#dashboard-statistik"), `Statistik-Abschnitt im Dashboard bei ${route}`).not.toBeNull(); // Statistik ist ein Abschnitt des Dashboards
      else if (expectedHeading[page] && !route.includes("&")) expect(heading, `Überschrift bei ${route}`).toMatch(expectedHeading[page]); // Unterseiten (z. B. eine Kette) tragen eigene Titel
    });
  }
});

describe("Kampagnen-Übersicht: Sortierung und Archiv", () => {
  beforeEach(() => { resetStore(); try { localStorage.removeItem("kampagnen-sortierung"); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });
  const names = (root: HTMLElement) => Array.from(root.querySelectorAll(".cl-card .cl-name strong")).map((node) => node.textContent ?? "");
  it("sortiert A–Z als Standard (erst Lead-Kategorie, dann Name), wechselt auf „Zuletzt bearbeitet“, Archiv zeigt nur archivierte Kampagnen mit „Wiederherstellen“", async () => {
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const { view } = mount(); await settle(300); await settle(300);
    const shown = names(view.container); expect(shown.length).toBeGreaterThan(2);
    const cmp = (a: string, b: string) => a.localeCompare(b, "de", { sensitivity: "base", numeric: true });
    const keyed = Array.from(view.container.querySelectorAll<HTMLElement>(".cl-card")).map((card) => ({ category: Array.from(card.querySelector(".sparte-badge")?.childNodes ?? []).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? "").join("").trim(), name: card.querySelector(".cl-name strong")?.textContent ?? "" }));
    expect(keyed.map((row) => row.name)).toEqual([...keyed].sort((a, b) => cmp(a.category, b.category) || cmp(a.name, b.name)).map((row) => row.name)); // A–Z: erst die Lead-Kategorie, dann der Name
    expect(keyed.map((row) => row.category)).toEqual([...keyed.map((row) => row.category)].sort(cmp)); expect(new Set(keyed.map((row) => row.category)).size).toBeGreaterThan(1);
    expect(view.container.querySelector<HTMLSelectElement>(".cl-sort select")?.selectedOptions[0]?.textContent).toBe("Lead-Kategorie A–Z");
    expect(shown).not.toContain("Elektriker NRW – Frühjahr"); // archivierte Kampagne nicht in der Übersicht
    const sort = view.container.querySelector<HTMLSelectElement>(".cl-sort select"); expect(sort).not.toBeNull();
    await act(async () => { fireEvent.change(sort!, { target: { value: "bearbeitet" } }); }); await settle(100);
    expect(names(view.container)[0]).toBe("Solarteure Hessen – persönlich"); // zuletzt bearbeitet (heute) ganz oben
    expect(localStorage.getItem("kampagnen-sortierung")).toBe("bearbeitet");
    const toggle = view.container.querySelector<HTMLButtonElement>(".cl-archive-toggle"); expect(toggle?.textContent).toContain("Archiv (1)");
    await act(async () => { fireEvent.click(toggle!); }); await settle(100);
    expect(names(view.container)).toEqual(["Elektriker NRW – Frühjahr"]);
    expect(view.container.querySelector(".cl-card.is-archiviert .cd-state")?.textContent).toBe("Archiviert");
    expect(Array.from(view.container.querySelectorAll(".cl-card .campaign-act")).map((node) => node.textContent?.trim())).toContain("Wiederherstellen");
    expect(view.container.querySelector(".cl-archive-hint")?.textContent).toContain("Zahlen bleiben erhalten");
  });
  it("Übersicht: Gesendet je Lead-Kategorie; Klick auf „Geöffnet“ (alle Kampagnen) zeigt die Kontakte, die geöffnet haben – Klick öffnet ihre Kampagne", async () => {
    try { localStorage.removeItem("kampagnen-kpi"); localStorage.removeItem("kampagnen-zeitraum"); } catch { /* egal */ }
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const { view } = mount(); await settle(300); await settle(300);
    const cats = view.container.querySelector(".cd-cats"); expect(cats).toBeTruthy(); expect(cats!.querySelectorAll(".cd-cat").length).toBeGreaterThan(0);
    const opened = Array.from(view.container.querySelectorAll<HTMLButtonElement>(".cd-kpibar .cd-kpi.is-pick")).find((node) => node.querySelector("span")?.textContent === "Geöffnet")!; expect(opened).toBeTruthy();
    await act(async () => { fireEvent.click(opened); }); await settle(400); await settle(300);
    const dialog = document.querySelector(".kpi-people-dialog")!; expect(dialog).toBeTruthy(); expect(dialog.textContent).toContain("Haben geöffnet");
    const people = Array.from(document.querySelectorAll<HTMLButtonElement>(".kpi-people button")); expect(people.length).toBeGreaterThan(0);
    await act(async () => { fireEvent.click(people[0]); }); await settle(300); await settle(200);
    expect(document.querySelector(".kpi-people-dialog")).toBeNull(); expect(view.container.querySelector(".ch h1")).toBeTruthy(); // Kampagne ist offen
  });
  it("Karte: Kennzahlen als eine Reihe – Empfänger, Gesendet, Zugestellt (mit Aufteilung), Geöffnet, Geklickt, Antwort; Einstellungen dezent", async () => {
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const { view } = mount(); await settle(300); await settle(300);
    const card = Array.from(view.container.querySelectorAll<HTMLElement>(".cl-card")).find((item) => item.textContent?.includes("Dachdecker Hessen – Erstkontakt"))!;
    expect(card).toBeTruthy();
    const cells = Array.from(card.querySelectorAll(".cl-funnel .cl-f span")).map((node) => node.textContent);
    expect(cells).toEqual(["Empfänger", "Gesendet", "Zugestellt", "Geöffnet", "Geklickt", "Antwort"]);
    const delivered = card.querySelector(".cl-f.is-delivered")!; expect(delivered.textContent).toContain("1 nicht angekommen"); expect(delivered.getAttribute("title")).toContain("laut Versanddienst angekommen");
    // was hinter dem Balken steckt: direkt darunter, untereinander – jede Zeile in der Farbe ihres Balken-Stücks
    const whyLines = Array.from(delivered.querySelectorAll<HTMLElement>("small.cl-why")).map((node) => ({ tone: Array.from(node.classList).find((name) => name.startsWith("is-")), text: node.textContent }));
    expect(whyLines[0]).toEqual({ tone: "is-bad", text: "1 nicht angekommen" }); expect(whyLines.every((line) => /^\d+ (nicht angekommen|verzögert|ohne Meldung)$/.test(String(line.text)))).toBe(true);
    for (const line of whyLines) expect(delivered.querySelector(`.cl-seg em.${line.tone}`)).toBeTruthy(); // gleiche Farbe wie das Balken-Stück
    expect(card.querySelector(".cl-f.is-total small")?.textContent).toBe("alle angeschrieben");
    // Einstellungen als eigene Felder mit Zeichen – ohne Liste, ohne „persönlich“-Zähler, Drip „pro Stunde“, Versand mit ausgeschriebenen Tagen
    const label = (node: Element) => Array.from(node.querySelector("dt")?.childNodes ?? []).filter((child) => !(child instanceof HTMLElement && child.classList.contains("fact-icon"))).map((child) => child.textContent).join("");
    const specs = Object.fromEntries(Array.from(card.querySelectorAll(".cl-spec")).map((node) => [label(node), node.querySelector("dd")?.textContent]));
    expect(specs).toEqual({ KI: "Vorlage für alle", Versand: "Mo–Fr · 08:00–12:00 und 13:00–16:30", Drip: "40 pro Stunde", "A/B-Betreff": "A vorn" }); // kurz: „Bei Antwort: Serie stoppt“ ist der Normalfall und steht nur noch als Warnung da
    expect(Array.from(card.querySelectorAll(".cl-spec")).map(label)).toEqual(["KI", "Versand", "Drip", "A/B-Betreff"]); // feste Reihenfolge
    expect(Array.from(card.querySelectorAll(".cl-spec .fact-icon svg")).length).toBe(4); // jedes Feld mit eigenem Zeichen
    // Lead-Kategorie als Schild ganz links vor dem Namen – mit Emoji der Kategorie
    const badge = card.querySelector(".cl-title .sparte-badge")!; expect(card.querySelector(".cl-title > :first-child")?.classList.contains("sparte-badge")).toBe(true); expect(badge.querySelector(".sparte-badge-emoji")?.textContent).toBe("☀️"); expect(badge.textContent).toBe("☀️Photovoltaik"); expect(badge.classList.contains("is-standard")).toBe(false); expect(card.querySelector(".cl-title .sparte-badge + .cl-name")).toBeTruthy();
    // ohne gewählte Sparte: beide Emojis und dezent „Standard“
    const plain = Array.from(view.container.querySelectorAll<HTMLElement>(".cl-card")).find((item) => item.textContent?.includes("Nachfassen nach Angebot"))!; expect(plain.querySelector(".cl-title .sparte-badge .sparte-badge-emoji")?.textContent).toBe("☀️♨️"); expect(plain.querySelector(".cl-title .sparte-badge")?.textContent).toBe("☀️♨️Photovoltaik & WärmepumpeStandard"); expect(plain.querySelector(".cl-title .sparte-badge")?.classList.contains("is-standard")).toBe(true);
    expect(card.textContent).not.toContain("Liste „Dachdecker Hessen“"); expect(card.textContent).not.toMatch(/persönlich|\/Std\./);
    const review = Array.from(view.container.querySelectorAll<HTMLElement>(".cl-card")).find((item) => item.textContent?.includes("Solarteure Hessen – persönlich"))!;
    expect(Array.from(review.querySelectorAll(".cl-f.is-total small")).map((node) => node.textContent)).toContain("4 warten"); // wer noch keine E-Mail hat – kurz; das Warum steht im Hinweis (title)
    expect(review.querySelector(".cl-f.is-total")?.getAttribute("title")).toContain("warten auf die 1. E-Mail"); // Erklärung bleibt beim Draufzeigen
    expect(review.querySelector(".cl-f.is-total .cl-seg")).toBeTruthy(); // Balken zeigt die Anteile (angeschrieben / warten / übrige)
    expect(review.querySelector(".cl-alerts .cl-approval")?.textContent).toBe("Zur Freigabe11 Erst-E-Mail wartet auf dichFreigegeben1gehen von allein rausKI schreibt noch2fertig in ca. 1 Min."); // zusammen = „4 warten auf die 1. E-Mail“ // was wartet, was freigegeben ist (geht noch raus) und wie lange die KI noch schreibt // alles in einem Hinweis: fertig zur Freigabe – und was die KI noch vorschreibt
    const writingPart = review.querySelector<HTMLElement>(".cl-approval-part.is-writing")!; expect(writingPart.getAttribute("title")).toContain("auch nachts");
    const reviewSpecs = Object.fromEntries(Array.from(review.querySelectorAll(".cl-spec")).map((node) => [label(node), node.querySelector("dd")?.textContent])); expect(reviewSpecs.KI).toBe("mit Freigabeindividueller Vorschlag"); // Ansatz steht mit dabei – kurz, ohne „schreibt einzeln“
    expect(review.querySelector(".cl-title .sparte-badge")?.textContent).toBe("☀️Photovoltaik"); // aus dem Namen erkannt
  });
  it("Karte: beim KI-Feld steht, welcher Ansatz gewählt ist – Drittanbieter-Ansatz oder individueller Vorschlag (auch bei „automatisch“)", async () => {
    const row = getStore().tables.emailCampaigns.find((item) => item.name === "Solarteure Hessen – persönlich")!; Object.assign(row, { kiAnsatz: "drittanbieter", kiModus: "auto", reviewFirst: false });
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const { view } = mount(); await settle(300); await settle(300);
    const card = () => Array.from(view.container.querySelectorAll<HTMLElement>(".cl-card")).find((item) => item.textContent?.includes("Solarteure Hessen – persönlich"))!;
    const ki = () => Array.from(card().querySelectorAll(".cl-spec")).find((node) => node.querySelector("dt")?.textContent?.includes("KI"))!;
    expect(ki().querySelector("dd")?.textContent).toBe("automatischDrittanbieter-Ansatz");
  });
  it("Versand: eine gespeicherte Tageszeit, die genau der normalen Zeit entspricht, steht nicht extra da – nur echte Abweichungen („freitags bis 13:00“)", async () => {
    const row = getStore().tables.emailCampaigns.find((item) => item.name === "Dachdecker Hessen – Erstkontakt")!;
    row.sendWindow = { enabled: true, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "16:30", pauseFrom: "12:00", pauseTo: "13:00", timezone: "Europe/Berlin", preset: "2fenster-0800-1200-1300-1630", days: { "1": { from: "08:00", to: "16:30" }, "5": { from: "08:00", to: "13:00" } } };
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const { view } = mount(); await settle(300); await settle(300);
    const card = Array.from(view.container.querySelectorAll<HTMLElement>(".cl-card")).find((item) => item.textContent?.includes("Dachdecker Hessen – Erstkontakt"))!;
    const versand = Array.from(card.querySelectorAll<HTMLElement>(".cl-spec")).find((node) => node.querySelector("dt")?.textContent === "Versand")!;
    expect(versand.querySelector("dd small")?.textContent).toBe("freitags bis 13:00"); // echte Abweichung bleibt
    expect(versand.textContent).not.toContain("montags"); // Montag hat die normale Zeit – kein „montags bis 16:30“
  });
  it("Kampagne geöffnet: Kopf wie die Karten – Name, ruhige Zeile, Stand und Knöpfe; Einstellungen als Steckbrief statt vieler Schilder", async () => {
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const { view } = mount(); await settle(300); await settle(300);
    const open = Array.from(view.container.querySelectorAll<HTMLButtonElement>(".cl-card .cl-name")).find((node) => node.textContent?.includes("Solarteure Hessen – persönlich"))!;
    await act(async () => { fireEvent.click(open); }); await settle(300); await settle(200);
    const head = view.container.querySelector<HTMLElement>(".ch")!; expect(head).not.toBeNull();
    expect(head.querySelector("h1")?.textContent).toBe("Solarteure Hessen – persönlich");
    expect(Array.from(head.querySelectorAll(".ch-meta > span")).map((node) => node.textContent)).toEqual(["3 E-Mails im Ablauf", expect.stringMatching(/^gestartet am \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} Uhr$/)]);
    expect(head.querySelector(".ch-side .cd-state")?.textContent).toBe("Aktiv"); expect(Array.from(head.querySelectorAll(".ch-side .campaign-act")).map((node) => node.textContent?.trim())).toEqual(["Pausieren", "Bearbeiten", "Karten verteilen", "Zusammenführen", "Archivieren"]);
    const factLabel = (node: Element) => Array.from(node.querySelector("dt")?.childNodes ?? []).filter((child) => !(child instanceof HTMLElement && child.classList.contains("fact-icon"))).map((child) => child.textContent).join("");
    const facts = Object.fromEntries(Array.from(head.querySelectorAll(".ch-fact")).map((node) => [factLabel(node), Array.from(node.querySelectorAll("dd > span")).map((part) => part.textContent)]));
    expect(head.querySelector(".ch-title > :first-child")?.classList.contains("sparte-badge")).toBe(true); expect(head.querySelector(".ch-title .sparte-badge")?.textContent).toBe("☀️Photovoltaik"); expect(head.querySelector(".ch-title .sparte-badge + h1")).toBeTruthy(); expect(head.querySelectorAll(".ch-fact .fact-icon").length).toBe(5); // Kategorie-Schild zuerst, dann der Name, jede Angabe mit Zeichen
    expect(facts).toEqual({ Zielgruppe: ["Liste „Solarteure Hessen“"], KI: ["schreibt einzeln", "mit Freigabe · individueller Vorschlag"], Versand: ["08:00–12:00 und 13:00–16:30", "Montag bis Freitag"], Drip: ["40 pro Stunde"], "Bei Antwort": ["Serie stoppt"] });
    expect(head.querySelector(".ch-alerts .cl-approval")?.textContent).toBe("Zur Freigabe11 Erst-E-Mail wartet auf dichFreigegeben1gehen von allein rausKI schreibt noch2Entwürfe in Arbeit"); // Freigabe in einem Hinweis, auch oben in der Kampagne
    expect(head.querySelector(".cd-chips")).toBeNull(); // keine lange Schilder-Reihe mehr
  });
});

describe("Seitenleiste", () => {
  it("führt jede Navigationsseite in einer Gruppe, damit sie sichtbar ist", async () => {
    const source = (await import("fs")).readFileSync((await import("path")).resolve(process.cwd(), "client/src/components/FluxoraWorkspace.tsx"), "utf8");
    const pages = Array.from(source.matchAll(/\{ page: "([^"]+)", icon:/g)).map((match) => match[1]);
    const groups = source.match(/const navigationGroups[^\n]*/)?.[0] ?? "";
    for (const page of pages) expect(groups.includes(`"${page}"`), `Seite ${page} fehlt in navigationGroups`).toBe(true);
  });
});

describe("Gespräche – Transkriptionsstand sichtbar", () => {
  it("zeigt ohne Schlüssel eine Warnung statt nur „(Schlüssel fehlt)“ in der Liste", async () => {
    window.history.replaceState(null, "", "/?page=Gespräche");
    const { view } = mount();
    await settle(400);
    fireEvent.click(view.getByRole("button", { name: /^Dialer & Bewertung$/ }));
    await settle(300);
    const state = view.container.querySelector(".cq-transcription-state");
    expect(state?.textContent).toContain("Kein Transkriptionsdienst eingerichtet");
    expect(state?.className).toContain("is-missing");
  });
});

describe("Gespräche – Aufnahmen per Link testen (Prototyp)", () => {
  it("legt je Link ein Gespräch an, bewertet es und zeigt es in der Liste", async () => {
    window.history.replaceState(null, "", "/?page=Gespräche");
    const { view } = mount();
    await settle(400);
    await act(async () => { fireEvent.click(Array.from(view.container.querySelectorAll<HTMLButtonElement>(".cq-tool")).find((node) => /Aufnahmen testen/.test(node.textContent ?? ""))!); }); await settle(300); // Import ist zweitrangig: kleiner Knopf öffnet ein Fenster
    const box = document.querySelector<HTMLTextAreaElement>(".cq-links textarea")!; expect(box).toBeTruthy();
    fireEvent.change(box, { target: { value: "https://download.example.de/getSound.aspx?token=abc&a=1\nkein link\nhttps://download.example.de/getSound.aspx?token=def&a=2 | +49 170 1234567 | Termin" } });
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>(".cq-links button")).find((node) => /Aufnahmen holen/.test(node.textContent ?? ""))!;
    await act(async () => { fireEvent.click(button); }); await settle(600);
    const rows = Array.from(view.container.querySelectorAll(".flux-table tbody tr.gq-call")).map((row) => row.textContent ?? "");
    expect(rows.filter((text) => text.includes("Aufnahmen-Test")).length).toBe(2);
    // nochmal dieselben Links → nichts doppelt
    fireEvent.change(box, { target: { value: "https://download.example.de/getSound.aspx?token=abc&a=1" } });
    await act(async () => { fireEvent.click(button); }); await settle(400);
    expect(Array.from(view.container.querySelectorAll(".flux-table tbody tr.gq-call")).filter((row) => (row.textContent ?? "").includes("Aufnahmen-Test")).length).toBe(2);
  });

  it("löscht ausgewählte Gespräche aus der Liste", async () => {
    window.history.replaceState(null, "", "/?page=Gespräche");
    const { view } = mount();
    await settle(400);
    const before = view.container.querySelectorAll(".flux-table tbody tr.gq-call").length; expect(before).toBeGreaterThan(1);
    const box = view.container.querySelector<HTMLInputElement>(".flux-table tbody tr.gq-call input[type=checkbox]")!;
    fireEvent.click(box); await settle(100);
    const button = Array.from(view.container.querySelectorAll<HTMLButtonElement>(".cq-bulk button")).find((node) => /Ausgewählte löschen/.test(node.textContent ?? ""))!;
    await act(async () => { fireEvent.click(button); }); await settle(300);
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent?.trim() === "Löschen");
    if (confirm) { await act(async () => { fireEvent.click(confirm); }); }
    await settle(500);
    expect(view.container.querySelectorAll(".flux-table tbody tr.gq-call").length).toBe(before - 1);
  });
});

describe("Gespräche – Prozent neben dem Smiley, Datums- und Kategorie-Filter, eigene Kriterien je Kampagne", () => {
  afterEach(() => { cleanup(); }); // sonst bleibt das Einstellen-Fenster eines Tests für den nächsten im Dokument stehen
  it("zeigt die Prozentzahl bei bewerteten Gesprächen und filtert nach Zeitraum", async () => {
    window.history.replaceState(null, "", "/?page=Gespräche");
    const { view } = mount();
    await settle(400);
    const panels = Array.from(view.container.querySelectorAll<HTMLElement>("section.operations-panel")); expect(panels[0]?.className).toContain("cq-list-panel"); // Gesprächsliste zuerst
    const percents = Array.from(view.container.querySelectorAll(".flux-table tbody .cq-percent")).map((node) => node.textContent ?? "");
    expect(percents.length).toBeGreaterThan(0); expect(percents.some((text) => /\d+ %/.test(text))).toBe(true);
    const all = view.container.querySelectorAll(".flux-table tbody tr.gq-call").length;
    const filterbar = view.container.querySelector(".cq-filterbar")!; expect(filterbar).toBeTruthy();
    const heute = Array.from(filterbar.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent === "Heute")!;
    await act(async () => { fireEvent.click(heute); }); await settle(400);
    expect(view.container.querySelectorAll(".flux-table tbody tr.gq-call").length).toBeLessThanOrEqual(all);
    const from = filterbar.querySelector<HTMLInputElement>("input[aria-label='Datum von']")!;
    fireEvent.change(from, { target: { value: "2031-01-01" } }); await settle(400);
    expect(view.container.querySelectorAll(".flux-table tbody tr.gq-call").length).toBe(0);
    expect(view.container.textContent).toContain("im gewählten Zeitraum");
    const reset = Array.from(filterbar.querySelectorAll<HTMLButtonElement>("button")).find((node) => /Datum zurücksetzen/.test(node.textContent ?? ""))!;
    await act(async () => { fireEvent.click(reset); }); await settle(400);
    expect(view.container.querySelectorAll(".flux-table tbody tr.gq-call").length).toBe(all);
    expect(view.container.querySelector("select[aria-label='Nach Lead-Kategorie filtern']")).toBeTruthy();
  });

  it("legt eigene Kriterien für eine Kampagne an und zeigt sie als „eigene“", async () => {
    window.history.replaceState(null, "", "/?page=Gespräche");
    const { view } = mount();
    await settle(400);
    const segment = Array.from(view.container.querySelectorAll<HTMLButtonElement>(".dashboard-segments button")).find((node) => node.textContent && node.textContent !== "Alle" && !/Heute|Gestern|Tage|Gesamt/.test(node.textContent))!;
    expect(segment).toBeTruthy();
    await act(async () => { fireEvent.click(segment); }); await settle(400);
    expect(view.container.querySelector(".cq-criteria-box")).toBeNull(); // Einstellungen liegen im Fenster – die Liste steht im Fokus
    await act(async () => { fireEvent.click(Array.from(view.container.querySelectorAll<HTMLButtonElement>(".cq-tool")).find((node) => /Einstellen/.test(node.textContent ?? ""))!); }); await settle(400);
    const dialog = () => Array.from(document.querySelectorAll<HTMLElement>(".cq-dialog")).pop()!;
    const box = dialog().querySelector(".cq-criteria-box")!; expect(box).toBeTruthy();
    expect(box.textContent).toContain("Standard-Kriterien");
    // Die Kriterien stehen direkt als Felder da – kein „Bearbeiten“-Klick nötig; „Änderungen speichern“ wird erst mit einer Änderung aktiv
    const rows = box.querySelectorAll(".cq-criterion-row"); expect(rows.length).toBeGreaterThan(0);
    const save = () => dialog().querySelector<HTMLButtonElement>(".cq-save-criteria")!;
    expect(save().disabled).toBe(true);
    fireEvent.change(rows[0].querySelector<HTMLInputElement>("input[aria-label='Kriterium']")!, { target: { value: "Treppe vermessen" } }); await settle(100);
    expect(save().disabled).toBe(false); expect(dialog().querySelector(".cq-savebar")?.textContent).toContain("Ungespeicherte Änderungen");
    await act(async () => { fireEvent.click(save()); }); await settle(500);
    const after = dialog().querySelector(".cq-criteria-box")!;
    expect(after.textContent).toMatch(/[Ee]igene Kriterien/); expect(after.querySelector<HTMLInputElement>("input[aria-label='Kriterium']")?.value).toBe("Treppe vermessen"); expect(dialog().querySelector(".cq-facts")?.textContent).toContain("eigene dieser Kampagne");
    expect(after.querySelector(".cq-reset-criteria")).toBeTruthy(); expect(save().disabled).toBe(true); expect(dialog().querySelector(".cq-savebar")?.textContent).toContain("Alles gespeichert");
  });

  it("Kampagne im Einstellen-Fenster umbenennen und Prüffragen samt Regel, Hinweis und Produkt-Bezug ändern", async () => {
    window.history.replaceState(null, "", "/?page=Gespräche");
    const { view } = mount();
    await settle(400);
    const segment = Array.from(view.container.querySelectorAll<HTMLButtonElement>(".cq-campaign-row .dashboard-segments button")).find((node) => node.textContent && node.textContent !== "Alle")!;
    const oldName = segment.textContent!;
    await act(async () => { fireEvent.click(segment); }); await settle(300);
    await act(async () => { fireEvent.click(Array.from(view.container.querySelectorAll<HTMLButtonElement>(".cq-tool")).find((node) => /Einstellen/.test(node.textContent ?? ""))!); }); await settle(400);
    const dialog = () => Array.from(document.querySelectorAll<HTMLElement>(".cq-dialog")).pop()!; // das zuletzt geöffnete Fenster (frühere Tests lassen ihres im Dokument stehen)
    // Name: direkt als Feld, „Name speichern“ erst nach einer Änderung aktiv
    const nameInput = dialog().querySelector<HTMLInputElement>(".cq-name-input")!; expect(nameInput.value).toBe(oldName);
    const nameSave = () => dialog().querySelector<HTMLButtonElement>(".cq-name-save")!; expect(nameSave().disabled).toBe(true);
    fireEvent.change(nameInput, { target: { value: "Solar Frühjahr" } }); await settle(100); expect(nameSave().disabled).toBe(false);
    await act(async () => { fireEvent.click(nameSave()); }); await settle(600);
    expect(dialog().querySelector<HTMLInputElement>(".cq-name-input")?.value).toBe("Solar Frühjahr");
    const chipNames = () => Array.from(view.container.querySelectorAll<HTMLButtonElement>(".cq-campaign-row .dashboard-segments button")).map((node) => node.textContent);
    for (let i = 0; i < 15 && !chipNames().includes("Solar Frühjahr"); i += 1) await settle(200); // die Liste lädt nach dem Umbenennen neu
    expect(chipNames()).toContain("Solar Frühjahr"); expect(chipNames()).not.toContain(oldName);
    // Prüffragen: Felder direkt änderbar – Text, Regel, „gilt für“ und Hinweis bleiben nach dem Speichern erhalten
    await act(async () => { fireEvent.click(Array.from(dialog().querySelectorAll<HTMLButtonElement>(".cq-tabs button")).find((node) => /Prüffragen/.test(node.textContent ?? ""))!); }); await settle(300);
    const firstRow = () => dialog().querySelector(".cq-question-row")!;
    fireEvent.change(firstRow().querySelector<HTMLInputElement>("input[aria-label='Frage']")!, { target: { value: "Will der Kunde in 6 Monaten umsetzen?" } });
    fireEvent.change(firstRow().querySelector<HTMLSelectElement>("select[aria-label='Regel']")!, { target: { value: "ko" } });
    fireEvent.change(firstRow().querySelector<HTMLSelectElement>("select[aria-label='Gilt für']")!, { target: { value: "waermepumpe" } });
    fireEvent.change(firstRow().querySelector<HTMLTextAreaElement>("textarea[aria-label='Hinweis für die KI']")!, { target: { value: "„So schnell wie möglich“ zählt als Ja." } }); await settle(100);
    await act(async () => { fireEvent.click(dialog().querySelector<HTMLButtonElement>(".cq-save-questions")!); }); await settle(600);
    expect(firstRow().querySelector<HTMLInputElement>("input[aria-label='Frage']")?.value).toBe("Will der Kunde in 6 Monaten umsetzen?");
    expect(firstRow().querySelector<HTMLSelectElement>("select[aria-label='Regel']")?.value).toBe("ko");
    expect(firstRow().querySelector<HTMLSelectElement>("select[aria-label='Gilt für']")?.value).toBe("waermepumpe");
    expect(firstRow().querySelector<HTMLTextAreaElement>("textarea[aria-label='Hinweis für die KI']")?.value).toBe("„So schnell wie möglich“ zählt als Ja.");
    expect(dialog().querySelector<HTMLButtonElement>(".cq-save-questions")?.disabled).toBe(true);
  });
});

describe("Profilbild – hochladen, überall sehen, entfernen", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); resetStore(); });
  const photo = (name = "ich.jpg") => new File(["foto"], name, { type: "image/jpeg" });
  it("oben rechts über das Profil-Menü: Bild erscheint im Kreis und im Menü; „entfernen“ zeigt wieder die Initialen", async () => {
    window.history.replaceState(null, "", "/?page=Dashboard");
    const { view } = mount();
    await settle(500);
    const orb = () => view.container.querySelector<HTMLButtonElement>(".profile-orb")!;
    const initials = orb().querySelector("span")!.textContent!; expect(initials).toMatch(/^[A-ZÄÖÜ]{1,2}$/); expect(orb().querySelector(".avatar-img")).toBeNull();
    await act(async () => { fireEvent.click(orb()); }); await settle(200);
    const menu = () => view.container.querySelector<HTMLElement>(".profile-menu");
    expect(menu()!.textContent).toContain("Profilbild hochladen"); expect(menu()!.textContent).not.toContain("Profilbild entfernen");
    const input = () => view.container.querySelector<HTMLInputElement>(".profile-orb-wrap .avatar-file")!; expect(input().accept).toBe("image/*");
    // Unlesbare Datei: verständliche Meldung, nichts ändert sich
    await act(async () => { fireEvent.change(input(), { target: { files: [photo("kaputt.heic")] } }); }); await settle(300);
    expect(document.body.textContent).toContain("kann der Browser nicht lesen"); expect(orb().querySelector(".avatar-img")).toBeNull();
    // Foto wählen → Bild oben rechts und im Menü
    await act(async () => { fireEvent.change(input(), { target: { files: [photo()] } }); }); await settle(700);
    expect(orb().querySelector<HTMLImageElement>(".avatar-img")?.getAttribute("src")).toBe(TEST_AVATAR);
    expect((getStore().tables.users[0] as { avatarUrl?: string | null }).avatarUrl).toBe(TEST_AVATAR);
    if (!menu()) { await act(async () => { fireEvent.click(orb()); }); await settle(200); }
    expect(menu()!.querySelector<HTMLImageElement>(".profile-menu-pic .avatar-img")?.getAttribute("src")).toBe(TEST_AVATAR);
    expect(menu()!.textContent).toContain("Profilbild ändern"); expect(menu()!.textContent).toContain("Profilbild entfernen");
    // Entfernen → wieder die Initialen
    await act(async () => { fireEvent.click(menu()!.querySelector<HTMLButtonElement>(".profile-menu-avatar-remove")!); }); await settle(700);
    expect(orb().querySelector(".avatar-img")).toBeNull(); expect(orb().querySelector("span")!.textContent).toBe(initials);
    expect((getStore().tables.users[0] as { avatarUrl?: string | null }).avatarUrl ?? null).toBeNull();
  });
  it("Einstellungen → Profil und Benutzerseite: Bild eines Vertrieblers erscheint an seinen Karten in der Pipeline", async () => {
    // eigenes Bild in den Einstellungen
    window.history.replaceState(null, "", "/?page=Einstellungen&setting=Profil");
    const first = mount();
    await settle(500);
    const box = first.view.container.querySelector<HTMLElement>(".settings-avatar")!; expect(box).toBeTruthy(); expect(box.textContent).toContain("Profilbild hochladen");
    await act(async () => { fireEvent.change(box.querySelector<HTMLInputElement>(".avatar-file")!, { target: { files: [photo()] } }); }); await settle(700);
    expect(first.view.container.querySelector<HTMLImageElement>(".settings-avatar .avatar-upload-face .avatar-img")?.getAttribute("src")).toBe(TEST_AVATAR);
    expect(first.view.container.querySelector(".settings-avatar")!.textContent).toContain("Anderes Bild wählen"); expect(first.view.container.querySelector(".settings-avatar .avatar-upload-remove")).toBeTruthy();
    cleanup();
    // Administrator setzt das Bild eines Vertrieblers auf dessen Benutzerseite
    const repUser = getStore().tables.users.find((row) => /^Taner/.test(String(row.name)))!; const rep = getStore().tables.memberships.find((row) => row.userId === repUser.id)!; expect(rep.role).toBe("vertrieb");
    window.history.replaceState(null, "", `/?page=Benutzer&member=${rep.id}`);
    const second = mount();
    await settle(600);
    const upload = second.view.container.querySelector<HTMLElement>(".avatar-upload")!; expect(upload).toBeTruthy(); expect(upload.querySelector(".avatar-img")).toBeNull();
    await act(async () => { fireEvent.change(upload.querySelector<HTMLInputElement>(".avatar-file")!, { target: { files: [photo("vertriebler.png")] } }); }); await settle(700);
    expect(second.view.container.querySelector<HTMLImageElement>(".avatar-upload .avatar-img")?.getAttribute("src")).toBe(TEST_AVATAR);
    expect((getStore().tables.users.find((row) => row.id === rep.userId) as { avatarUrl?: string | null }).avatarUrl).toBe(TEST_AVATAR);
    cleanup();
    // In der Benutzerliste und in der Pipeline ist das Bild zu sehen
    window.history.replaceState(null, "", "/?page=Benutzer");
    const list = mount();
    await settle(600);
    expect(list.view.container.querySelectorAll(".member-pic .avatar-img").length).toBe(2); expect(list.view.container.querySelectorAll(".member-pic").length).toBeGreaterThan(2);
    cleanup();
    window.history.replaceState(null, "", "/?page=Vertriebspipeline&quelle=email");
    const board = mount();
    await settle(800);
    const chips = Array.from(board.view.container.querySelectorAll<HTMLElement>(".dashboard-filters .owner-dot"));
    const firstName = String(repUser.name).split(" ")[0];
    const repChip = chips.find((node) => node.parentElement?.textContent?.includes(firstName))!; expect(repChip).toBeTruthy(); expect(repChip.querySelector<HTMLImageElement>(".avatar-img")?.getAttribute("src")).toBe(TEST_AVATAR);
    expect(chips.filter((node) => !node.querySelector(".avatar-img")).length).toBeGreaterThan(0); // andere Vertriebler behalten ihr Kürzel
  });
});

describe("Vertriebspipeline – Pipeline archivieren und wiederherstellen", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); cleanup(); resetStore(); });
  it("legt die gewählte Pipeline ins Archiv (oben weg, Karten bleiben) und holt sie über „Archiv“ zurück", async () => {
    window.history.replaceState(null, "", "/?page=Vertriebspipeline&quelle=kaltakquise");
    const { view } = mount();
    await settle(500);
    const tabs = () => Array.from(view.container.querySelectorAll<HTMLButtonElement>(".source-cards .source-card")).map((node) => node.querySelector("strong")?.textContent);
    const active = () => view.container.querySelector(".source-card.is-active strong")?.textContent;
    expect(active()).toBe("Kaltakquise"); const count = tabs().length; expect(count).toBeGreaterThanOrEqual(3);
    const cards = getStore().tables.leads.filter((row) => row.adPlatform === "kaltakquise").length; expect(cards).toBeGreaterThan(0);
    expect(view.container.querySelector(".pipeline-archive-open")).toBeNull(); // noch nichts im Archiv
    const confirmBox = () => document.querySelector<HTMLElement>(".app-confirm");
    // Abbrechen: nichts passiert
    await act(async () => { fireEvent.click(view.container.querySelector<HTMLButtonElement>(".pipeline-archive-btn")!); }); await settle(200);
    expect(confirmBox()?.textContent).toContain("„Kaltakquise“ ins Archiv legen"); expect(confirmBox()?.textContent).toContain("Alle Karten bleiben");
    await act(async () => { fireEvent.click(confirmBox()!.querySelector<HTMLButtonElement>(".app-confirm-cancel")!); }); await settle(300);
    expect(tabs()).toContain("Kaltakquise");
    // Archivieren: Reiter weg, eine andere Pipeline ist gewählt, die Karten sind unverändert da
    await act(async () => { fireEvent.click(view.container.querySelector<HTMLButtonElement>(".pipeline-archive-btn")!); }); await settle(200);
    await act(async () => { fireEvent.click(confirmBox()!.querySelector<HTMLButtonElement>(".app-confirm-ok")!); }); await settle(700);
    expect(tabs()).not.toContain("Kaltakquise"); expect(tabs().length).toBe(count - 1); expect(active()).toBeTruthy(); expect(active()).not.toBe("Kaltakquise");
    expect(getStore().tables.leads.filter((row) => row.adPlatform === "kaltakquise").length).toBe(cards);
    expect(document.body.textContent).toContain("liegt im Archiv");
    // Archiv öffnen → Wiederherstellen: Reiter wieder da, Archiv-Knopf verschwindet
    const open = view.container.querySelector<HTMLButtonElement>(".pipeline-archive-open")!; expect(open.textContent).toContain("1");
    await act(async () => { fireEvent.click(open); }); await settle(400);
    const dialog = document.querySelector<HTMLElement>(".pipeline-archive-dialog")!; expect(dialog.textContent).toContain("Kaltakquise"); expect(dialog.textContent).toMatch(/\d+ Karten?/);
    await act(async () => { fireEvent.click(dialog.querySelector<HTMLButtonElement>(".pipeline-archive-restore")!); }); await settle(700);
    expect(tabs()).toContain("Kaltakquise"); expect(tabs().length).toBe(count); expect(view.container.querySelector(".pipeline-archive-open")).toBeNull();
    expect(getStore().tables.leads.filter((row) => row.adPlatform === "kaltakquise").length).toBe(cards);
  });
  it("Anruf-Fenster einer Karte liegt über der ganzen Seite – nicht in der Karte, wo Nachbarspalten es verdecken", async () => {
    window.history.replaceState(null, "", "/?page=Vertriebspipeline&quelle=email");
    const { view } = mount();
    await settle(600);
    const toggle = view.container.querySelector<HTMLButtonElement>(".pipeline-card .calllog-toggle")!; expect(toggle).toBeTruthy();
    await act(async () => { fireEvent.click(toggle); }); await settle(200);
    const overlay = document.querySelector<HTMLElement>(".calllog-overlay")!; expect(overlay).toBeTruthy();
    expect(overlay.parentElement).toBe(document.body); expect(overlay.closest(".pipeline-card")).toBeNull(); expect(overlay.closest(".pipeline-column")).toBeNull();
    expect(overlay.textContent).toContain("Ergebnis festhalten".toUpperCase());
    await act(async () => { fireEvent.click(overlay.querySelector<HTMLButtonElement>(".calllog-cancel")!); }); await settle(200);
    expect(document.querySelector(".calllog-overlay")).toBeNull();
  });
});

describe("Gespräche – Einstellen-Fenster verliert keine ungespeicherten Änderungen", () => {
  beforeEach(() => { cleanup(); }); // Reste früherer Tests (offene Fenster) entfernen
  afterEach(() => { document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); cleanup(); resetStore(); });
  it("fragt beim Schließen und beim Wechsel der Kampagne nach; ohne Änderungen schließt das Fenster sofort", async () => {
    resetStore();
    window.history.replaceState(null, "", "/?page=Gespräche");
    const { view } = mount();
    await settle(400);
    const chips = () => Array.from(view.container.querySelectorAll<HTMLButtonElement>(".cq-campaign-row .dashboard-segments button")).filter((node) => node.textContent && node.textContent !== "Alle");
    const first = chips()[0].textContent!; const second = chips()[1].textContent!;
    await act(async () => { fireEvent.click(chips()[0]); }); await settle(300);
    const openSettings = async () => { await act(async () => { fireEvent.click(Array.from(view.container.querySelectorAll<HTMLButtonElement>(".cq-tool")).find((node) => /Einstellen/.test(node.textContent ?? ""))!); }); await settle(400); };
    const dialog = () => Array.from(document.querySelectorAll<HTMLElement>(".cq-dialog")).pop();
    const confirmBox = () => document.querySelector<HTMLElement>(".app-confirm");
    const closeButton = () => dialog()!.querySelector<HTMLButtonElement>("[data-slot='dialog-close']")!;
    // Ohne Änderung: schließt sofort, keine Rückfrage
    await openSettings(); expect(dialog()).toBeTruthy();
    await act(async () => { fireEvent.click(closeButton()); }); await settle(300);
    expect(confirmBox()).toBeNull(); expect(dialog()).toBeUndefined();
    // Mit Änderung: Rückfrage – „Abbrechen“ lässt Fenster und Eingabe stehen
    await openSettings();
    const criterion = () => dialog()!.querySelector<HTMLInputElement>(".cq-criterion-row input[aria-label='Kriterium']")!;
    fireEvent.change(criterion(), { target: { value: "Mein eigenes Kriterium" } }); await settle(100);
    await act(async () => { fireEvent.click(closeButton()); }); await settle(300);
    expect(confirmBox()?.textContent).toContain("noch nicht gespeichert");
    await act(async () => { fireEvent.click(confirmBox()!.querySelector<HTMLButtonElement>(".app-confirm-cancel")!); }); await settle(300);
    expect(confirmBox()).toBeNull(); expect(criterion().value).toBe("Mein eigenes Kriterium");
    // Kampagne wechseln: ebenfalls Rückfrage – „Abbrechen“ bleibt bei der Kampagne
    const select = () => dialog()!.querySelector<HTMLSelectElement>(".cq-campaign-select")!;
    fireEvent.change(select(), { target: { value: second } }); await settle(300);
    expect(confirmBox()?.textContent).toContain("zur anderen Kampagne wechseln");
    await act(async () => { fireEvent.click(confirmBox()!.querySelector<HTMLButtonElement>(".app-confirm-cancel")!); }); await settle(300);
    expect(dialog()!.querySelector<HTMLInputElement>(".cq-name-input")?.value).toBe(first); expect(criterion().value).toBe("Mein eigenes Kriterium");
    // Namen ändern, solange Kriterien ungespeichert sind: Hinweis statt stillem Verlust
    fireEvent.change(dialog()!.querySelector<HTMLInputElement>(".cq-name-input")!, { target: { value: "Neuer Name" } }); await settle(100);
    await act(async () => { fireEvent.click(dialog()!.querySelector<HTMLButtonElement>(".cq-name-save")!); }); await settle(300);
    expect(document.body.textContent).toContain("Speichere zuerst deine Änderungen"); expect(criterion().value).toBe("Mein eigenes Kriterium");
    expect(chips().map((node) => node.textContent)).toContain(first);
    // Schließen bestätigen: Fenster zu, nichts gespeichert
    await act(async () => { fireEvent.click(closeButton()); }); await settle(300);
    await act(async () => { fireEvent.click(confirmBox()!.querySelector<HTMLButtonElement>(".app-confirm-ok")!); }); await settle(400);
    expect(dialog()).toBeUndefined();
    await openSettings(); expect(criterion().value).not.toBe("Mein eigenes Kriterium"); expect(dialog()!.querySelector<HTMLInputElement>(".cq-name-input")?.value).toBe(first);
  });
});

describe("Gespräche – Kriterien noch nicht bewertet", () => {
  afterEach(() => { cleanup(); resetStore(); });
  it("zeigt im Gespräch einen Hinweis statt lauter 0 %", async () => {
    resetStore();
    const call = getStore().tables.callRecords.find((item) => item.status === "bewertet")! as Record<string, unknown> & { id: number };
    Object.assign(call, { score: null, criteriaScores: [{ key: "_hinweis", score: 0, evidence: "Die KI hat für die Kriterien keine lesbaren Punkte geliefert (leere Antwort)." }] });
    window.history.replaceState(null, "", `/?page=Gespräche&callId=${call.id}`);
    const { view } = mount();
    await settle(500);
    const note = view.container.querySelector(".cq-unscored")!; expect(note).toBeTruthy();
    expect(note.textContent).toContain("noch nicht bewertet"); expect(note.textContent).toContain("automatisch nach"); expect(note.textContent).toContain("keine lesbaren Punkte");
    expect(view.container.querySelectorAll(".cq-percent-sm").length).toBe(0); // keine „0 %“ je Kriterium
    expect(view.container.textContent).not.toContain("Qualitätsnote");
  });
  it("ein bewertetes Gespräch zeigt die Punkte je Kriterium und keinen Hinweis", async () => {
    resetStore();
    const call = getStore().tables.callRecords.find((item) => item.status === "bewertet" && typeof item.score === "number" && Array.isArray(item.criteriaScores) && item.criteriaScores.length > 0)!; expect(call).toBeTruthy();
    window.history.replaceState(null, "", `/?page=Gespräche&callId=${call.id}`);
    const { view } = mount();
    await settle(500);
    expect(view.container.querySelector(".cq-unscored")).toBeNull();
    expect(view.container.querySelectorAll(".cq-percent-sm").length).toBeGreaterThan(0);
  });
});

describe("Gespräche – „Zurück“ bleibt in Gespräche", () => {
  afterEach(() => { cleanup(); });
  it("Gespräch öffnen legt einen eigenen Verlaufsschritt an; Zurück führt zur Gesprächsliste", async () => {
    window.history.replaceState(null, "", "/?page=Gespräche");
    const { view } = mount();
    await settle(400);
    const before = window.history.length;
    const row = view.container.querySelector<HTMLElement>(".cq-list-panel .flux-table tbody tr.gq-call td:nth-child(3)")!; expect(row).toBeTruthy();
    await act(async () => { fireEvent.click(row); }); await settle(400);
    expect(window.location.search).toContain("callId="); expect(decodeURIComponent(window.location.search)).toContain("page=Gespräche");
    expect(window.history.length).toBe(before + 1);
    expect(view.container.querySelector(".cq-list-panel")).toBeNull();
    await act(async () => { window.history.back(); await new Promise((resolve) => setTimeout(resolve, 120)); }); await settle(300);
    expect(window.location.search).not.toContain("callId="); expect(decodeURIComponent(window.location.search)).toContain("page=Gespräche");
    expect(view.container.querySelector(".cq-list-panel")).toBeTruthy();
  });
});

describe("Gespräche – Anzeigetafel: Verlauf, Zähler als Filter, Agenten", () => {
  const forgetWave = () => { try { window.localStorage.removeItem("tanesco-gespraeche-verlauf"); } catch { /* egal */ } };
  beforeEach(() => { cleanup(); resetStore(); forgetWave(); }); afterEach(() => { cleanup(); resetStore(); forgetWave(); });
  /** Der Verlauf ist dezent: erst der Knopf „Verlauf“ in der Leiste klappt ihn auf. */
  const openWave = async (root: HTMLElement) => { await act(async () => { fireEvent.click(root.querySelector<HTMLButtonElement>(".gq-wave-toggle")!); }); await settle(300); return root.querySelector<HTMLElement>(".gq-stage")!; };
  const callRows = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(".flux-table tbody tr.gq-call"));
  const tally = (root: HTMLElement, label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>(".gq-tally-item")).find((node) => node.querySelector("b")?.textContent === label)!;
  const open = async () => { window.history.replaceState(null, "", "/?page=Gespräche"); const { view } = mount(); await settle(500); return view; };

  it("zeigt Überschrift, Verlauf und Zähler; ein Klick auf einen Zähler filtert Liste und Verlauf", async () => {
    const view = await open(); const root = view.container;
    const total = callRows(root).length; expect(total).toBeGreaterThan(5);
    // oben dominiert nichts mehr: der Verlauf ist eingeklappt, die Leiste nennt nur die Summe in Worten
    expect(root.querySelector(".gq-stage")).toBeNull();
    const toggle = root.querySelector<HTMLButtonElement>(".gq-wave-toggle")!; expect(toggle.textContent).toBe("Verlauf"); expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector(".gq-sum > span")?.textContent).toMatch(new RegExp(`^${total} Gespräche, .+ am Telefon$`));
    expect(Array.from(root.querySelectorAll(".gq-toolbar .gq-label")).map((node) => node.textContent)).toEqual(["Zeitraum", "Ergebnis", "Kampagne", "Agent", "Lead-Kategorie"]);
    const stage = await openWave(root); expect(stage).toBeTruthy(); expect(stage.className).toContain("is-inset"); expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector(".cq-list-panel")?.contains(stage)).toBe(true); // der Verlauf sitzt in der Liste, nicht mehr als eigener Kopf darüber
    expect(stage.querySelector(".gq-count")?.textContent).toBe(`${total} Gespräche insgesamt`);
    expect(stage.querySelector(".gq-talk")?.textContent).toMatch(/^Zusammen .+ am Telefon, im Schnitt \d+:\d\d Minuten je Gespräch\. \d+ % der \d+ entschiedenen Gespräche sind freigegeben\.$/);
    expect(stage.querySelectorAll(".gq-slot").length).toBe(total); // ein Strich je Gespräch
    const counts = ["Freigegeben", "Zur Prüfung", "Zurückgewiesen", "Offen"].map((label) => Number(tally(root, label).querySelector("strong")?.textContent));
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(total); expect(counts[1]).toBeGreaterThan(0);
    expect(root.querySelectorAll(".gq-day").length).toBeGreaterThan(1); // die Liste ist nach Tagen gebündelt
    expect(root.querySelector(".cq-ampel-row")).toBeNull(); expect(root.textContent).not.toContain("Bewertet"); // die sechs Kacheln von früher sind weg
    // Zähler „Zur Prüfung“ → nur diese Gespräche; im Verlauf treten die anderen zurück, die Tafel zählt weiter alle
    await act(async () => { fireEvent.click(tally(root, "Zur Prüfung")); }); await settle(400);
    expect(tally(root, "Zur Prüfung").getAttribute("aria-pressed")).toBe("true");
    expect(callRows(root).length).toBe(counts[1]); expect(callRows(root).every((row) => /^Zur Prüfung/.test(row.querySelector(".gq-pill")?.textContent ?? ""))).toBe(true);
    expect(stage.querySelectorAll(".gq-slot").length).toBe(total); expect(stage.querySelectorAll(".gq-slot.is-dim").length).toBe(total - counts[1]);
    expect(stage.querySelector(".gq-count")?.textContent).toBe(`${total} Gespräche insgesamt`);
    expect(root.querySelector(".gq-result-line")?.textContent).toContain("„Zur Prüfung“");
    // derselbe Zähler noch einmal hebt den Filter auf
    await act(async () => { fireEvent.click(tally(root, "Zur Prüfung")); }); await settle(400);
    expect(callRows(root).length).toBe(total); expect(stage.querySelectorAll(".gq-slot.is-dim").length).toBe(0); expect(root.querySelector(".gq-result-line")).toBeNull();
    // einklappen – und die Wahl bleibt beim nächsten Öffnen der Seite gemerkt
    await act(async () => { fireEvent.click(toggle); }); await settle(200);
    expect(root.querySelector(".gq-stage")).toBeNull(); expect(window.localStorage.getItem("tanesco-gespraeche-verlauf")).toBe("0");
    await act(async () => { fireEvent.click(toggle); }); await settle(200); expect(window.localStorage.getItem("tanesco-gespraeche-verlauf")).toBe("1");
    cleanup(); const again = await open(); expect(again.container.querySelector(".gq-stage.is-inset")).toBeTruthy();
  });

  it("jedes Gespräch ist eine Karte: Ampel im Ring, Uhrzeit mit Dauer, worum es ging, Agent mit Kampagne, Ergebnis", async () => {
    const view = await open(); const root = view.container; const rows = callRows(root); expect(rows.length).toBeGreaterThan(5);
    expect(Array.from(root.querySelectorAll(".gq-table thead th")).map((node) => (node.textContent ?? "").replace("ⓘ", "").trim())).toEqual(["", "Ampel", "Uhrzeit", "Gespräch", "Agent, Kampagne", "Ergebnis", "Öffnen"]);
    for (const row of rows) {
      expect(row.querySelectorAll("td").length).toBe(7); expect(row.className).toMatch(/ is-(gruen|gelb|rot|offen)( |$)/);
      expect(row.querySelector(".gq-ampel .cq-ring")).toBeTruthy(); // Smiley im Ring
      expect(row.querySelector(".gq-time b")?.textContent).toMatch(/^(\d\d:\d\d|–)$/);
      expect((row.querySelector(".gq-who-line > b")?.textContent ?? "").length).toBeGreaterThan(0);
      expect((row.querySelector(".gq-agent-lines b")?.textContent ?? "").length).toBeGreaterThan(0); expect((row.querySelector(".gq-agent-lines small")?.textContent ?? "").length).toBeGreaterThan(0); // Agent, darunter die Kampagne
      expect(row.querySelector(".gq-result .gq-pill")).toBeTruthy();
    }
    expect(root.textContent).not.toContain("nicht zugeordnet"); // leere Angaben stehen nicht mehr in jeder Zeile
    const withSummary = rows.filter((row) => row.querySelector(".gq-summary")); expect(withSummary.length).toBeGreaterThan(3); // die Zeile sagt, worum es ging
    expect(withSummary.every((row) => (row.querySelector(".gq-summary")?.textContent ?? "").length > 8)).toBe(true);
    const timed = rows.filter((row) => row.querySelector(".gq-dur")); expect(timed.length).toBeGreaterThan(3);
    expect(timed.every((row) => /^\d+%$/.test(row.querySelector<HTMLElement>(".gq-dur")!.style.width))).toBe(true); // Balken: Dauer im Verhältnis zum längsten Gespräch
    expect(timed.some((row) => row.querySelector<HTMLElement>(".gq-dur")!.style.width === "100%")).toBe(true);
    // der Ring zeigt die erfüllten Prüffragen – steht eine Prozentzahl daneben, passt sie zur Ampel
    const scored = rows.filter((row) => row.querySelector(".cq-percent")); expect(scored.length).toBeGreaterThan(0);
    expect(scored.every((row) => /^\d+ %$/.test(row.querySelector(".cq-percent")!.textContent ?? ""))).toBe(true);
  });

  it("ein Strich im Verlauf öffnet das Gespräch – oben mit Ergebnis und Aufnahme, zurück geht es zur Liste", async () => {
    const view = await open(); const root = view.container; await openWave(root);
    const slot = root.querySelector<HTMLButtonElement>(".gq-slot")!; expect(slot.getAttribute("aria-label")).toMatch(/^Gespräch .+ – öffnen$/);
    await act(async () => { fireEvent.click(slot); }); await settle(500);
    expect(window.location.search).toContain("callId=");
    const stage = root.querySelector<HTMLElement>(".gq-call-stage")!; expect(stage).toBeTruthy();
    expect(root.querySelector(".gq-tally")).toBeNull(); // die Anzeigetafel gehört zur Liste, nicht zum einzelnen Gespräch
    expect(stage.querySelector(".gq-count")?.textContent).toMatch(/^(Passt|Reinhören|Passt nicht|Noch nicht bewertet)$/);
    expect(stage.querySelector(".gq-player")?.textContent).toContain("Aufnahme anhören");
    expect(Array.from(stage.querySelectorAll(".gq-call-facts dt")).map((node) => node.textContent)).toEqual(expect.arrayContaining(["Agent", "Kampagne", "Einwilligung zur Aufnahme"]));
    await act(async () => { fireEvent.click(root.querySelector<HTMLButtonElement>(".gq-back")!); await new Promise((resolve) => setTimeout(resolve, 150)); }); await settle(300);
    expect(root.querySelector(".cq-list-panel")).toBeTruthy(); expect(window.location.search).not.toContain("callId=");
  });

  it("ein Agent lässt sich auswählen: Liste und Zahlen gelten dann für ihn, die Auswahl bleibt vollständig", async () => {
    const view = await open(); const root = view.container; await openWave(root);
    const chips = () => Array.from(root.querySelectorAll<HTMLButtonElement>(".gq-agent-chip:not(.is-all)"));
    const before = chips().length; expect(before).toBeGreaterThan(1); const total = callRows(root).length;
    const name = chips()[0].querySelector("b")!.textContent!; const count = Number(chips()[0].querySelector("em")!.textContent); expect(count).toBeGreaterThan(0); expect(count).toBeLessThan(total);
    await act(async () => { fireEvent.click(chips()[0]); }); await settle(500);
    expect(callRows(root).length).toBe(count); expect(callRows(root).every((row) => row.querySelector(".gq-agent-cell b")?.textContent === name)).toBe(true);
    expect(root.querySelector(".gq-sum > span")?.textContent).toMatch(new RegExp(`^${count} ${count === 1 ? "Gespräch" : "Gespräche"}(,|$)`));
    expect(root.querySelector(".gq-count")?.textContent).toBe(`${count} ${count === 1 ? "Gespräch" : "Gespräche"} insgesamt`);
    expect(root.querySelector(".gq-talk")?.textContent).toContain(`${name} – zusammen`);
    expect(root.querySelectorAll(".gq-slot").length).toBe(count);
    expect(chips().length).toBe(before); expect(chips()[0].getAttribute("aria-pressed")).toBe("true"); // die anderen Agenten bleiben wählbar
    await act(async () => { fireEvent.click(root.querySelector<HTMLButtonElement>(".gq-agent-chip.is-all")!); }); await settle(400);
    expect(callRows(root).length).toBe(total);
  });

  it("ein einzelner Tag zeigt den Tagesverlauf auf einer Uhrzeit-Achse mit „jetzt“", async () => {
    const view = await open(); const root = view.container; await openWave(root);
    expect(root.querySelector(".gq-wave")?.className).toContain("is-days"); expect(root.querySelector(".gq-now")).toBeNull();
    const heute = Array.from(root.querySelectorAll<HTMLButtonElement>(".gq-periods button")).find((node) => node.textContent === "Heute")!;
    await act(async () => { fireEvent.click(heute); }); await settle(500);
    const wave = root.querySelector<HTMLElement>(".gq-wave")!; expect(wave.className).toContain("is-clock"); expect(heute.getAttribute("aria-pressed")).toBe("true");
    const labels = Array.from(wave.querySelectorAll(".gq-tick b")).map((node) => node.textContent ?? ""); expect(labels.length).toBeGreaterThan(3); expect(labels.every((label) => /^\d+ Uhr$/.test(label))).toBe(true);
    expect(wave.querySelector(".gq-now")?.textContent).toBe("jetzt");
    expect(root.querySelector(".gq-count")?.textContent).toMatch(/ heute$/);
    expect(wave.querySelectorAll(".gq-slot").length).toBe(callRows(root).length);
    expect(Array.from(root.querySelectorAll(".gq-day-name")).map((node) => node.textContent)).toEqual(callRows(root).length ? ["Heute"] : []);
  });
});

describe("Verträge – Stand, Spur, die fünf Schritte und Vorlagen", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); cleanup(); resetStore(); });
  const open = async () => { window.history.replaceState(null, "", "/?page=Verträge"); const { view } = mount(); await settle(600); return view.container; };
  const rowsOf = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(".vt-list .vt-row"));
  const click = async (node: Element | null | undefined, wait = 500) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
  const confirm = async () => { await click(document.querySelector(".app-confirm .app-confirm-ok"), 600); };
  const waitingRow = (root: HTMLElement) => rowsOf(root).find((row) => row.classList.contains("is-angesehen") || row.classList.contains("is-gesendet"))!;

  it("Übersicht: Stand der gesendeten Verträge, je Vertrag eine Spur aus fünf Punkten und eine Zeile in Worten", async () => {
    const root = await open();
    const stand = root.querySelector<HTMLElement>(".vt-stand")!; expect(stand).toBeTruthy();
    expect(stand.querySelector("h2")?.textContent).toMatch(/^(\d+ Verträge warten|1 Vertrag wartet) auf Unterschrift$/);
    expect(Array.from(stand.querySelectorAll(".vt-station > span")).map((node) => node.textContent)).toEqual(["Gesendet", "E-Mail geöffnet", "Vertrag geöffnet", "Gelesen", "Unterschrieben"]);
    const counts = Array.from(stand.querySelectorAll(".vt-station strong")).map((node) => Number(node.textContent)); expect(counts[0]).toBeGreaterThan(0);
    for (let index = 1; index < counts.length; index += 1) expect(counts[index]).toBeLessThanOrEqual(counts[index - 1]); // jede Station zählt alle, die mindestens so weit sind
    const rows = rowsOf(root); expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) expect(row.querySelectorAll(".vt-track i").length).toBe(5);
    const signed = rows.find((row) => row.classList.contains("is-unterschrieben"))!; expect(signed.querySelectorAll(".vt-track i.is-done").length).toBe(5); expect(signed.querySelector(".vt-row-line")?.textContent).toMatch(/^unterschrieben .+ von /);
    const draft = rows.find((row) => row.classList.contains("is-entwurf"))!; expect(draft.querySelectorAll(".vt-track i.is-done").length).toBe(0); expect(draft.querySelector(".vt-row-line")?.textContent).toBe("Entwurf – noch nicht gesendet");
    const waiting = waitingRow(root);
    expect(waiting.querySelector(".vt-row-line")?.textContent).toMatch(/geöffnet/); expect(waiting.querySelector(".vt-nudge")?.textContent).toBe("Nachfassen lohnt sich");
    expect(waiting.querySelector(".vt-track i.is-ergebnis")?.className).toContain("is-todo"); expect(waiting.querySelector(".vt-track")?.getAttribute("aria-label")).toContain("Gesendet: erledigt");
    // Filter „Beim Kunden“ zeigt nur die wartenden
    await click(Array.from(root.querySelectorAll<HTMLButtonElement>(".vt-toolbar .dashboard-segments button")).find((node) => /^Beim Kunden/.test(node.textContent ?? "")));
    expect(rowsOf(root).length).toBeGreaterThan(0); expect(rowsOf(root).every((row) => row.classList.contains("is-angesehen") || row.classList.contains("is-gesendet"))).toBe(true);
    // der Hinweis im Stand führt zu dem Vertrag, bei dem sich Nachfassen lohnt
    expect(stand.querySelector("p")?.textContent).toMatch(/Anruf|nach/); await click(stand.querySelector(".vt-stand-open"), 900);
    expect(root.querySelector(".vt-tracker")).toBeTruthy();
  });

  it("Ein Vertrag: fünf Schritte mit einem Satz je Schritt, Tipp zum Nachfassen und Verlauf mit Gerät und Lesezeit", async () => {
    const root = await open();
    await click(waitingRow(root).querySelector(".vt-row-main"), 900);
    const steps = Array.from(root.querySelectorAll<HTMLElement>(".vt-steps .vt-step")); expect(steps.map((step) => step.querySelector("strong")?.textContent)).toEqual(["Gesendet", "E-Mail geöffnet", "Link angeklickt, Vertrag geöffnet", "Gelesen", "Unterschrift"]);
    expect(steps.slice(0, 3).every((step) => step.classList.contains("is-done"))).toBe(true); expect(steps[4].classList.contains("is-todo")).toBe(true);
    expect(steps[2].querySelector("small")?.textContent).toMatch(/geöffnet/); expect(steps[4].querySelector("small")?.textContent).toBe("noch nicht unterschrieben");
    expect(root.querySelector(".vt-hint")?.textContent).toMatch(/noch nicht unterschrieben|nach/);
    expect(root.querySelector(".vt-tracker-note")?.textContent).toContain("Näherungswert");
    const entries = Array.from(root.querySelectorAll<HTMLElement>(".vt-timeline > li:not(.vt-tl-more)")); expect(entries.length).toBeGreaterThan(3);
    expect(entries.map((entry) => entry.querySelector("strong")?.textContent)).toEqual(expect.arrayContaining(["Vertrag geöffnet", "E-Mail geöffnet", "Zur Unterschrift gesendet"]));
    const viewed = entries.filter((entry) => entry.classList.contains("is-angesehen")); expect(viewed.length).toBeGreaterThan(0);
    expect(viewed.some((entry) => /gelesen/.test(entry.textContent ?? ""))).toBe(true); expect(viewed.every((entry) => (entry.querySelector(".vt-tl-meta")?.textContent ?? "").length > 3)).toBe(true); // Gerät und IP-Adresse
    await click(root.querySelector(".vt-back"), 600); expect(root.querySelector(".vt-list")).toBeTruthy();
    // unterschrieben: letzter Schritt erledigt, kein Tipp mehr
    await click(rowsOf(root).find((row) => row.classList.contains("is-unterschrieben"))?.querySelector(".vt-row-main"), 900);
    const done = Array.from(root.querySelectorAll<HTMLElement>(".vt-steps .vt-step")); expect(done[4].querySelector("strong")?.textContent).toBe("Unterschrieben"); expect(done[4].classList.contains("is-done")).toBe(true);
    expect(root.querySelector(".vt-hint")).toBeNull();
    // Entwurf: noch nichts gesendet – die Schritte erscheinen erst mit dem Versand
    await click(root.querySelector(".vt-back"), 600);
    await click(rowsOf(root).find((row) => row.classList.contains("is-entwurf"))?.querySelector(".vt-row-main"), 900);
    expect(root.querySelector(".vt-detail-head h1")).toBeTruthy(); expect(root.querySelector(".vt-tracker")).toBeNull();
  });

  it("Vorlagen: mitgelieferte ansehen, anpassen und zurücksetzen; eigene anlegen, bearbeiten und löschen", async () => {
    const root = await open();
    await click(Array.from(root.querySelectorAll<HTMLButtonElement>(".vt-head-actions .dashboard-segments button")).find((node) => /^Vorlagen/.test(node.textContent ?? "")));
    const starter = (kind: string) => root.querySelector<HTMLElement>(`.vt-tpl[data-kind="${kind}"]`)!;
    expect(["leadliefervertrag", "testphase", "leer"].every((kind) => Boolean(starter(kind)))).toBe(true);
    expect(starter("leadliefervertrag").querySelectorAll(".vt-paper li").length).toBeGreaterThan(4); expect(starter("leadliefervertrag").querySelector(".vt-paper")?.textContent).toContain("§ 1");
    expect(starter("testphase").querySelector(".vt-tag")?.textContent).toBe("mitgeliefert");
    const button = (card: HTMLElement, label: string) => Array.from(card.querySelectorAll<HTMLButtonElement>("button")).find((node) => (node.textContent ?? "").trim() === label);
    // mitgelieferte Vorlage anpassen
    await click(button(starter("testphase"), "Bearbeiten"), 900);
    expect(root.querySelector("h1")?.textContent).toBe("Vorlage „Testphase“ anpassen"); expect(root.textContent).not.toContain("Speichern & senden"); expect(root.querySelector(".vt-template-name")).toBeNull();
    const title = Array.from(root.querySelectorAll<HTMLLabelElement>(".ct-field")).find((node) => node.querySelector("span")?.textContent === "Titel des Vertrags")!.querySelector("input")!;
    await act(async () => { fireEvent.change(title, { target: { value: "Testphase für Wärmepumpen-Leads" } }); }); await settle(100);
    await click(root.querySelector(".vt-save-template"), 900);
    expect(starter("testphase").querySelector(".vt-tag")?.textContent).toBe("von dir angepasst"); expect(starter("testphase").querySelector(".vt-paper strong")?.textContent).toBe("Testphase für Wärmepumpen-Leads");
    expect(getStore().tables.contractTemplates.some((row: any) => row.starterKind === "testphase")).toBe(true);
    // zurücksetzen holt den Lieferzustand zurück
    await click(button(starter("testphase"), "Zurücksetzen"), 300); await confirm();
    expect(starter("testphase").querySelector(".vt-tag")?.textContent).toBe("mitgeliefert"); expect(button(starter("testphase"), "Zurücksetzen")).toBeUndefined();
    expect(getStore().tables.contractTemplates.some((row: any) => row.starterKind === "testphase")).toBe(false);
    // eigene Vorlage anlegen …
    const own = () => Array.from(root.querySelectorAll<HTMLElement>(".vt-tpl.is-own")); const before = own().length;
    await click(root.querySelector(".vt-tpl.is-new button"), 900); expect(root.querySelector("h1")?.textContent).toBe("Neue Vorlage");
    await click(root.querySelector(".vt-save-template"), 300); expect(root.querySelector("h1")?.textContent).toBe("Neue Vorlage"); // ohne Namen wird nicht gespeichert
    await act(async () => { fireEvent.change(root.querySelector<HTMLInputElement>(".vt-template-name")!, { target: { value: "Rahmenvertrag Hausnotruf" } }); }); await settle(100);
    await click(root.querySelector(".vt-save-template"), 900);
    expect(own().length).toBe(before + 1); const card = own().find((node) => node.querySelector(".vt-tpl-name")?.textContent?.includes("Rahmenvertrag Hausnotruf"))!; expect(card).toBeTruthy();
    // … bearbeiten (Name ändern) …
    await click(button(card, "Bearbeiten"), 900); expect(root.querySelector("h1")?.textContent).toBe("Vorlage bearbeiten");
    await act(async () => { fireEvent.change(root.querySelector<HTMLInputElement>(".vt-template-name")!, { target: { value: "Rahmenvertrag Hausnotruf 2027" } }); }); await settle(100);
    await click(root.querySelector(".vt-save-template"), 900);
    expect(own().length).toBe(before + 1); const renamed = own().find((node) => node.querySelector(".vt-tpl-name")?.textContent?.includes("Rahmenvertrag Hausnotruf 2027"))!; expect(renamed).toBeTruthy();
    // … und löschen
    await click(renamed.querySelector(".vt-btn.is-icon"), 300); await confirm();
    expect(own().length).toBe(before);
    // aus einer Vorlage entsteht ein neuer Vertrag
    await click(button(starter("leadliefervertrag"), "Vertrag daraus"), 900); expect(root.querySelector("h1")?.textContent).toBe("Neuer Vertrag");
  });
});

describe("Verträge – direkt im Dokument bearbeiten", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); cleanup(); resetStore(); });
  const click = async (node: Element | null | undefined, wait = 300) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
  const type = async (node: Element | null | undefined, value: string) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.change(node!, { target: { value } }); }); await settle(80); };
  const openNew = async () => {
    window.history.replaceState(null, "", "/?page=Verträge"); const { view } = mount(); await settle(600); const root = view.container;
    await click(root.querySelector(".vt-head-actions .flux-button")); await click(Array.from(root.querySelectorAll<HTMLButtonElement>(".starter-menu button")).find((node) => node.querySelector("strong")?.textContent === "Leadliefervertrag"), 700);
    return root;
  };
  const todo = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>(".vd-todo button"));
  const todoTexts = (root: HTMLElement) => todo(root).map((node) => node.textContent ?? "");
  const blocks = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(".vd-sheet > .vd-block"));
  const field = (scope: Element, label: string) => Array.from(scope.querySelectorAll<HTMLLabelElement>(".ct-field")).find((node) => node.querySelector("span")?.textContent === label)?.querySelector<HTMLInputElement>("input");

  it("ein Klick macht die Stelle im Blatt bearbeitbar; Kunde und Angaben werden dort ausgefüllt, rechts stehen die offenen Punkte", async () => {
    const root = await openNew();
    expect(root.querySelector("h1")?.textContent).toBe("Neuer Vertrag"); expect(root.querySelector(".vd-sheet")).toBeTruthy();
    expect(root.querySelector(".ct-blocks")).toBeNull(); expect(root.querySelector(".ct-editor-preview")).toBeNull(); // die lange Baustein-Liste und die getrennte Vorschau gibt es nicht mehr
    const count = blocks(root).length; expect(count).toBeGreaterThan(20);
    expect(todoTexts(root)).toEqual(expect.arrayContaining(["Kunde eintragen", "E-Mail des Kunden eintragen", "Liefergebiet ausfüllen", "Preis je Lead (netto) ausfüllen", "Selbst unterschreiben"]));
    expect(Array.from(root.querySelectorAll(".vd-outline button")).map((node) => node.textContent)).toEqual(expect.arrayContaining(["§ 1 Gegenstand des Vertrags", "§ 7 Reklamation"]));
    // Text: ein Klick macht aus dem Absatz ein Textfeld mit den Platzhaltern – geschrieben wird genau dort
    const text = root.querySelector<HTMLElement>(".vd-block.is-text")!; expect(text.querySelector("textarea")).toBeNull();
    await click(text); expect(text.classList.contains("is-active")).toBe(true);
    const area = text.querySelector<HTMLTextAreaElement>("textarea.vd-text")!; expect(area.value).toContain("{{leadart}}");
    await type(area, "Der Anbieter liefert {{firma}} Anfragen für {{leadart}}.");
    await click(root.querySelector(".vd-sheet")); expect(text.querySelector("textarea")).toBeNull();
    expect(text.querySelector(".c-p")?.textContent).toBe("Der Anbieter liefert {{firma}} Anfragen für {{leadart}}."); // noch nichts eingetragen: die Platzhalter bleiben sichtbar
    // Kunde: der offene Punkt führt zu den Vertragsparteien – ausgefüllt wird im Blatt, der Text übernimmt den Namen sofort
    await click(todo(root).find((node) => node.textContent === "Kunde eintragen"), 200);
    const parties = root.querySelector<HTMLElement>(".vd-block.is-parties")!; expect(parties.classList.contains("is-active")).toBe(true);
    await type(field(parties, "Firma"), "Dachbau Nord GmbH"); await type(field(parties, "E-Mail"), "einkauf@dachbau-nord.example");
    expect(parties.querySelector(".c-parties")?.textContent).toContain("Dachbau Nord GmbH");
    expect(text.querySelector(".c-p")?.textContent).toBe("Der Anbieter liefert Dachbau Nord GmbH Anfragen für {{leadart}}.");
    expect(todoTexts(root)).not.toContain("Kunde eintragen"); expect(todoTexts(root)).not.toContain("E-Mail des Kunden eintragen");
    // Angabe: Schnellauswahl direkt unter der Zeile
    const before = todo(root).length;
    await click(todo(root).find((node) => node.textContent === "Preis je Lead (netto) ausfüllen"), 200);
    const price = root.querySelector<HTMLElement>(".vd-block.is-detail.is-active")!; expect(price.querySelector(".c-kv span")?.textContent).toBe("Preis je Lead (netto)"); expect(price.querySelector(".c-kv")?.className).toContain("is-open");
    await click(Array.from(price.querySelectorAll<HTMLButtonElement>(".ct-presets button")).find((node) => node.textContent === "79 €"));
    expect(price.querySelector(".c-kv strong")?.textContent).toBe("79 €"); expect(price.querySelector(".c-kv")?.className).not.toContain("is-open"); expect(todo(root).length).toBe(before - 1);
    // die Angabe steht als Platzhalter {{preis}} im Text und wird dort eingesetzt
    expect(root.querySelector(".vd-sheet")?.textContent).toContain("beträgt 79 € zuzüglich gesetzlicher Umsatzsteuer");
    // Baustein einfügen: „+“ am Baustein → Auswahl → steht davor
    const heading = root.querySelectorAll<HTMLElement>(".vd-block.is-heading")[1]; const position = blocks(root).indexOf(heading);
    await click(heading.querySelector(".vd-plus")); const menu = heading.querySelector(".vd-menu")!; expect(menu.querySelectorAll("button").length).toBe(12);
    await click(Array.from(menu.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent === "Trennlinie"));
    expect(blocks(root).length).toBe(count + 1); expect(blocks(root)[position].classList.contains("is-divider")).toBe(true); expect(blocks(root)[position + 1]).toBe(heading);
    // verschieben und entfernen stehen am Baustein
    const divider = blocks(root)[position]; await click(divider.querySelector('.vd-tools button[aria-label="Nach unten"]'));
    expect(blocks(root)[position]).toBe(heading); expect(blocks(root)[position + 1].classList.contains("is-divider")).toBe(true);
    await click(blocks(root)[position + 1].querySelector(".vd-tools button.is-danger")); expect(blocks(root).length).toBe(count);
    // speichern: der Vertrag liegt mit Kunde, Text und Angabe im System
    await click(Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent === "Speichern"), 900);
    expect(root.querySelector(".vt-detail-head h1")?.textContent).toBe("Leadliefervertrag");
    const saved = getStore().tables.contracts.find((row: any) => row.recipientEmail === "einkauf@dachbau-nord.example") as any; expect(saved).toBeTruthy();
    expect(saved.values.firma).toBe("Dachbau Nord GmbH"); expect(saved.blocks.find((block: any) => block.type === "detail" && block.key === "preis").value).toBe("79 €");
    expect(saved.blocks.some((block: any) => block.type === "text" && block.text === "Der Anbieter liefert {{firma}} Anfragen für {{leadart}}.")).toBe(true);
  });

  it("Kundenansicht zeigt den Vertrag genau so, wie ihn der Kunde bekommt; ein Vertrag beim Kunden lässt sich nicht mehr ändern", async () => {
    const root = await openNew();
    await click(root.querySelector(".vd-preview-open"), 500);
    const frame = document.querySelector<HTMLIFrameElement>(".vd-preview iframe")!; expect(frame).toBeTruthy(); expect(frame.getAttribute("srcdoc") ?? frame.srcdoc).toContain("§ 1 Gegenstand des Vertrags");
    cleanup(); resetStore();
    // gesendeter Vertrag: im Editor gesperrt – kein „+“, keine Leiste am Baustein, kein Textfeld beim Klick
    window.history.replaceState(null, "", "/?page=Verträge"); const { view } = mount(); await settle(600); const list = view.container;
    const sent = getStore().tables.contracts.find((row: any) => row.status === "angesehen" || row.status === "gesendet") as any; expect(sent).toBeTruthy();
    await click(list.querySelector(`.vt-row[data-contract="${sent.id}"] .vt-row-main`), 900);
    expect(list.querySelector(".vt-tracker")).toBeTruthy(); expect(Array.from(list.querySelectorAll("button")).some((node) => (node.textContent ?? "").trim() === "Bearbeiten")).toBe(false);
  });
});

describe("Gespräche – Agenten und der untere Teil eines Gesprächs", () => {
  beforeEach(() => { cleanup(); resetStore(); }); afterEach(() => { cleanup(); resetStore(); });
  const click = async (node: Element | null | undefined, wait = 400) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };

  it("Agenten: Kennzahlen, Bestwerte und je Agent eine Karte – „Gespräche“ führt zur Liste dieses Agenten", async () => {
    window.history.replaceState(null, "", "/?page=Gespräche"); const { view } = mount(); await settle(500); const root = view.container;
    await click(Array.from(root.querySelectorAll<HTMLButtonElement>(".people-header-actions button")).find((node) => /Agenten/.test(node.textContent ?? "")), 800);
    const panel = root.querySelector<HTMLElement>(".gq-agents-panel")!; expect(panel).toBeTruthy();
    expect(Array.from(panel.querySelectorAll(".gq-stats dt")).map((node) => node.textContent)).toEqual(["Agenten", "Anrufe", "Am Telefon", "Termine", "Freigegeben"]);
    const rows = Array.from(panel.querySelectorAll<HTMLElement>(".gq-alist > li")); expect(rows.length).toBeGreaterThan(1);
    expect(rows.map((row) => row.querySelector(".gq-rank")?.textContent)).toEqual(rows.map((_, index) => String(index + 1)));
    for (const row of rows) { expect((row.querySelector(".gq-agent-lines b")?.textContent ?? "").length).toBeGreaterThan(0); expect(row.querySelectorAll(".gq-astats > span").length).toBe(6); }
    expect(panel.querySelectorAll(".gq-best li").length).toBeGreaterThan(0);
    expect(root.querySelector(".agent-table")).toBeNull(); expect(root.querySelector(".agent-total")).toBeNull(); // die breite Tabelle und die Kacheln von früher sind weg
    const name = rows[0].querySelector(".gq-agent-lines b")!.textContent!;
    await click(rows[0].querySelector(".gq-open-calls"), 800);
    expect(root.querySelector(".cq-list-panel .gq-table")).toBeTruthy();
    expect(root.querySelector(".gq-agent-chip.is-on b")?.textContent).toBe(name);
  });

  it("ein Gespräch: Entscheidung mit drei klaren Knöpfen, Prüffragen zum Umschalten, Kriterien mit Balken", async () => {
    const call = getStore().tables.callRecords.find((item: any) => item.status === "bewertet" && typeof item.score === "number" && Array.isArray(item.criteriaScores) && item.criteriaScores.length > 0)!; expect(call).toBeTruthy();
    window.history.replaceState(null, "", `/?page=Gespräche&callId=${call.id}`); const { view } = mount(); await settle(600); const root = view.container;
    const choices = () => Array.from(root.querySelectorAll<HTMLButtonElement>(".gq-choices .gq-choice")); expect(choices().map((node) => node.textContent)).toEqual(["Freigeben & verkaufen", "Zur Prüfung", "Zurückweisen"]);
    expect(Array.from(root.querySelectorAll(".gq-panel-head h2")).map((node) => (node.textContent ?? "").split(" ")[0])).toEqual(expect.arrayContaining(["Entscheidung", "Prüffragen", "Kriterien", "Transkript"]));
    const questions = () => Array.from(root.querySelectorAll<HTMLElement>(".gq-qlist .gq-q")); expect(questions().length).toBeGreaterThan(0);
    for (const question of questions()) { expect(question.querySelectorAll(".gq-answer").length).toBe(3); expect(question.querySelectorAll(".gq-answer.is-on").length).toBe(1); expect(question.querySelector(".gq-rule")).toBeTruthy(); }
    // Antwort umschalten → genau diese ist danach gewählt
    const target = questions()[0].querySelector<HTMLButtonElement>(".gq-answer:not(.is-on)")!; const label = target.textContent;
    await click(target, 700);
    expect(questions()[0].querySelector(".gq-answer.is-on")?.textContent).toBe(label);
    expect(root.querySelectorAll(".gq-clist .gq-c").length).toBeGreaterThan(0); expect(root.querySelectorAll(".gq-c-bar").length).toBe(root.querySelectorAll(".gq-clist .gq-c").length);
    // entscheiden: „Zur Prüfung“ → der Knopf ist danach der gewählte
    await click(choices()[1], 800);
    expect(root.querySelector(".gq-choices .gq-choice.is-on")?.textContent).toBe("Zur Prüfung");
  });
});
