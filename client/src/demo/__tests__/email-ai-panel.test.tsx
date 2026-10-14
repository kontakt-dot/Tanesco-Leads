import { trpc } from "@/lib/trpc";
import { EmailAiPanel, SeriesAiPanel } from "@/components/EmailAiPanel";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDemoLink } from "../link";
import { resetStore } from "../backend";

/** KI-Vorlagen-Builder: Ein Vorschlag füllt nur die Beschreibung – gebaut wird erst mit dem Knopf (vorher hat ein Klick sofort gebaut, mitten im Beschreiben). */
function mount(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}>{ui}</QueryClientProvider></trpc.Provider>);
}
async function settle(ms = 150) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }

describe("KI-Vorlagen-Builder: Vorschläge bauen nicht von selbst", () => {
  beforeEach(() => { resetStore(); vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("Serie: Vorschlag füllt Beschreibung, Anzahl und Abstand – „Serie bauen“ baut erst auf Klick", async () => {
    const onSeries = vi.fn();
    mount(<SeriesAiPanel category={null} onSeries={onSeries} />);
    const textarea = screen.getByPlaceholderText(/Welche E-Mail brauchst du/) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
    const button = screen.getByRole("button", { name: /Serie bauen/ }) as HTMLButtonElement; expect(button.disabled).toBe(true); // ohne Beschreibung nichts zu bauen
    fireEvent.click(screen.getByRole("button", { name: /Kaltakquise/ }));
    await settle();
    expect(textarea.value.length).toBeGreaterThan(20);
    expect(onSeries).not.toHaveBeenCalled();
    expect(screen.getByText(/Vorschlag übernommen/)).toBeTruthy();
    expect(document.querySelector(".ai-proposal.is-picked")).toBeTruthy();
    // weiter beschreiben – immer noch nichts gebaut, Hinweis verschwindet beim eigenen Text
    fireEvent.change(textarea, { target: { value: `${textarea.value} Bitte den Raum Nürnberg erwähnen.` } });
    await settle();
    expect(onSeries).not.toHaveBeenCalled(); expect(screen.queryByText(/Vorschlag übernommen/)).toBeNull();
    // erst der Knopf baut
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await settle(400);
    expect(onSeries).toHaveBeenCalledTimes(1);
    const result = onSeries.mock.calls[0][0]; expect(result.tree.nodes.filter((node: { type: string }) => node.type === "send").length).toBeGreaterThanOrEqual(2); expect(result.name).toBeTruthy();
  });

  it("Einzel-E-Mail: Vorschlag füllt nur die Felder, „E-Mail bauen“ liefert den Entwurf", async () => {
    const onDraft = vi.fn();
    mount(<EmailAiPanel category="Photovoltaik" onDraft={onDraft} />);
    fireEvent.click(screen.getByRole("button", { name: /Nachfassen nach Angebot/ }));
    await settle();
    const textarea = screen.getByPlaceholderText(/Welche E-Mail brauchst du/) as HTMLTextAreaElement;
    expect(textarea.value.length).toBeGreaterThan(20); expect(onDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /E-Mail bauen/ }));
    await settle(400);
    expect(onDraft).toHaveBeenCalledTimes(1); expect(onDraft.mock.calls[0][0].subject).toBeTruthy(); expect(onDraft.mock.calls[0][0].blocks.length).toBeGreaterThan(0);
  });
});
