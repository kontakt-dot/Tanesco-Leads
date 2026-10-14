import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { resetStore } from "../backend";

const routes = [
  "page=Dashboard", "page=Statistik", "page=Statistik&view=Käufer", "page=Statistik&view=Lieferanten", "page=Statistik&view=Lieferketten", "page=Statistik&view=Integrationen",
  "page=Leads", "page=Lead-Kategorien", "page=Lead-Kategorien&library=1", "page=Lead-Kategorien&builder=1", "page=Tags",
  "page=Bestellungen", "page=Bestellungen&overview=1", "page=Bestellungen&orderId=1", "page=Lieferkette", "page=E-Mails", "page=Lieferkette&chain=1", "page=Lieferkette&chain=5", "page=Rohdaten", "page=Haustür-Erfassung", "page=Vertriebspipeline", "page=E-Mail-Kampagnen", "page=Haustür-Erfassung&view=erfassen", "page=Haustür-Erfassung&view=vertriebler", "page=Haustür-Erfassung&view=einstellungen", "page=Telefonie", "page=Telefonie&view=kampagnen", "page=Telefonie&view=rufnummern", "page=Telefonie&view=einstellungen", "page=Telefonie&view=anrufe", "page=Gespräche", "page=Gespräche&callId=1", "page=Gespräche&view=Einstellungen", "page=Automatisierung", "page=Automatisierung&view=Protokoll",
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

describe("Seitenleiste", () => {
  it("führt jede Navigationsseite in einer Gruppe, damit sie sichtbar ist", async () => {
    const source = (await import("fs")).readFileSync((await import("path")).resolve(process.cwd(), "client/src/components/FluxoraWorkspace.tsx"), "utf8");
    const pages = Array.from(source.matchAll(/\{ page: "([^"]+)", icon:/g)).map((match) => match[1]);
    const groups = source.match(/const navigationGroups[^\n]*/)?.[0] ?? "";
    for (const page of pages) expect(groups.includes(`"${page}"`), `Seite ${page} fehlt in navigationGroups`).toBe(true);
  });
});
