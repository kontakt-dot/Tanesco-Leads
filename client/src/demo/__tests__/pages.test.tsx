import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { getStore, resetStore } from "../backend";

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
  it("sortiert A–Z als Standard, wechselt auf „Zuletzt bearbeitet“, Archiv zeigt nur archivierte Kampagnen mit „Wiederherstellen“", async () => {
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const { view } = mount(); await settle(300); await settle(300);
    const shown = names(view.container); expect(shown.length).toBeGreaterThan(2);
    expect(shown).toEqual([...shown].sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base", numeric: true }))); // A–Z
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
  it("Karte: Kennzahlen als eine Reihe – Empfänger, Gesendet, Zugestellt (mit Aufteilung), Geöffnet, Geklickt, Antwort; Einstellungen dezent", async () => {
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const { view } = mount(); await settle(300); await settle(300);
    const card = Array.from(view.container.querySelectorAll<HTMLElement>(".cl-card")).find((item) => item.textContent?.includes("Dachdecker Hessen – Erstkontakt"))!;
    expect(card).toBeTruthy();
    const cells = Array.from(card.querySelectorAll(".cl-funnel .cl-f span")).map((node) => node.textContent);
    expect(cells).toEqual(["Empfänger", "Gesendet", "Zugestellt", "Geöffnet", "Geklickt", "Antwort"]);
    const delivered = card.querySelector(".cl-f.is-delivered")!; expect(delivered.textContent).toContain("1 nicht angekommen"); expect(delivered.getAttribute("title")).toContain("laut Versanddienst angekommen");
    expect(card.querySelector(".cl-f.is-total small")?.textContent).toBe("alle erreicht");
    // Einstellungen als zwei ruhige Zeilen mit Angaben – ohne Liste, ohne „persönlich“-Zähler, Drip „pro Stunde“, Versand mit ausgeschriebenen Tagen
    const specs = Object.fromEntries(Array.from(card.querySelectorAll(".cl-spec")).map((node) => [node.querySelector("dt")?.textContent, node.querySelector("dd")?.textContent]));
    expect(specs).toEqual({ Leadsparte: "Photovoltaik & Wärmepumpe", KI: "ausVorlage für alle", "Bei Antwort": "Serie stoppt", Versand: "Montag bis Freitag, 09:00–11:30 und 14:00–16:30", Drip: "40 pro Stunde", "A/B-Betreff": "A vorn" });
    expect(card.textContent).not.toContain("Liste „Dachdecker Hessen“"); expect(card.textContent).not.toMatch(/persönlich|\/Std\./);
    const review = Array.from(view.container.querySelectorAll<HTMLElement>(".cl-card")).find((item) => item.textContent?.includes("Solarteure Hessen – persönlich"))!;
    expect(review.querySelector(".cl-f.is-total small")?.textContent).toBe("4 warten noch"); // wer noch keine E-Mail hat – und warum
    expect(review.querySelector(".cl-alerts .cl-approval")?.textContent).toBe("Zur Freigabe3 Erst-E-Mails warten"); // alles, was auf Freigabe wartet, in einem Hinweis
    const reviewSpecs = Object.fromEntries(Array.from(review.querySelectorAll(".cl-spec")).map((node) => [node.querySelector("dt")?.textContent, node.querySelector("dd")?.textContent])); expect(reviewSpecs.KI).toBe("schreibt einzelnmit Freigabe");
  });
  it("Versand: eine gespeicherte Tageszeit, die genau der normalen Zeit entspricht, steht nicht extra da – nur echte Abweichungen („freitags bis 13:00“)", async () => {
    const row = getStore().tables.emailCampaigns.find((item) => item.name === "Dachdecker Hessen – Erstkontakt")!;
    row.sendWindow = { enabled: true, weekdays: [1, 2, 3, 4, 5], from: "09:00", to: "16:30", pauseFrom: "11:30", pauseTo: "14:00", timezone: "Europe/Berlin", preset: "2fenster-0900-1130-1400-1630", days: { "1": { from: "09:00", to: "16:30" }, "5": { from: "09:00", to: "13:00" } } };
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
    expect(head.querySelector(".ch-side .cd-state")?.textContent).toBe("Aktiv"); expect(Array.from(head.querySelectorAll(".ch-side .campaign-act")).map((node) => node.textContent?.trim())).toEqual(["Pausieren", "Bearbeiten", "Karten verteilen", "Archivieren"]);
    const facts = Object.fromEntries(Array.from(head.querySelectorAll(".ch-fact")).map((node) => [node.querySelector("dt")?.textContent, Array.from(node.querySelectorAll("dd > span")).map((part) => part.textContent)]));
    expect(facts).toEqual({ Zielgruppe: ["Liste „Solarteure Hessen“"], Leadsparte: ["Photovoltaik", "aus Name oder Liste erkannt"], KI: ["schreibt einzeln", "mit Freigabe · freier Vorschlag"], Versand: ["09:00–11:30 und 14:00–16:30", "Montag bis Freitag"], Drip: ["40 pro Stunde"], "Bei Antwort": ["Serie stoppt"] });
    expect(head.querySelector(".ch-alerts .cl-approval")?.textContent).toBe("Zur Freigabe3 Erst-E-Mails warten"); // Freigabe in einem Hinweis, auch oben in der Kampagne
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
