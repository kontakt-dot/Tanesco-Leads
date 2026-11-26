import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { getStore, resetStore } from "../backend";

/**
 * Version 368 – Fachfelder auf der Lead-Seite groß geschrieben: „Wp ist neubau“ → „WP Neubau“, „Wp gebaeudetyp“ → „WP Gebäudetyp“,
 * Werte beginnen groß („heizkörper“ → „Heizkörper“).
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
type Row = Record<string, any>;
const table = (name: string) => (getStore().tables as unknown as Record<string, Row[]>)[name];

describe("Version 368", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); resetStore(); });

  it("Lead-Seite: Felder aus dem Gespräch mit großen Anfangsbuchstaben, Umlauten und WP vorn – Werte beginnen groß", async () => {
    // so kamen die Wärmepumpen-Felder an (Bild vom 26.11.)
    const lead = table("leads").find((row) => (row.kind ?? "verkauf") === "verkauf")!;
    lead.metadata = { ...(lead.metadata ?? {}), wp_ist_neubau: "Nein", wp_gebaeudetyp: "Ein-/Zweifamilienhaus", wp_beheizte_flaeche: "bis 100 qm", wp_termin_erwuenscht: "Ja", wp_aktuelle_waermeverteilung: "heizkörper", wp_interesse_photovolatikanlage: "Ja", wp_erreichbarkeit: "nachmittags ab 15 Uhr" };
    window.history.replaceState(null, "", `/?page=Leads&lead=${lead.publicId}`); const view = mount(); await settle(2200);
    const tiles = Object.fromEntries(Array.from(view.container.querySelectorAll(".lp-tiles > div")).map((tile) => [tile.querySelector("dt")!.textContent, tile.querySelector("dd")!.textContent]));
    expect(tiles).toMatchObject({ "WP Neubau": "Nein", "WP Gebäudetyp": "Ein-/Zweifamilienhaus", "WP Beheizte Fläche": "Bis 100 qm", "WP Termin Erwünscht": "Ja", "WP Aktuelle Wärmeverteilung": "Heizkörper", "WP Interesse Photovoltaikanlage": "Ja", "WP Erreichbarkeit": "Nachmittags ab 15 Uhr" });
    // kein Feldname mehr klein oder mit „ae/oe/ue“
    for (const label of Object.keys(tiles)) { expect(label.charAt(0), label).toBe(label.charAt(0).toUpperCase()); expect(label, label).not.toMatch(/gebaeude|flaeche|waerme|erwuenscht|photovolatik|^Wp /); }
  }, 30_000);
});
