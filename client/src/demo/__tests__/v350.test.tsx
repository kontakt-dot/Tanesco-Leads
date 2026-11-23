import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, resetStore } from "../backend";
import { purposeInfo } from "../../../../shared/ai-usage";

/**
 * Version 350 – KI bei Gesprächen: Knopf „KI heute“ auf der Seite Gespräche, die Abschrift zählt beim Verbrauch mit,
 * und es gibt eine eigene Obergrenze je Tag (ist sie erreicht, warten neue Gespräche).
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const open = async (query: string, wait = 1500) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
const euro = (cents: number) => `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
type Today = { spentCents: number; transcriptCents: number; ratingCents: number; calls: number; perCallCents: number | null; capCents: number; reached: boolean; waiting: number };
const today = async () => await callProcedure("leadops.callAiToday", undefined) as Today;
const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((node) => (node.textContent ?? "").trim());

describe("Version 350", () => {
  beforeEach(async () => { cleanup(); resetStore(); await callProcedure("leadops.setCallAiCap", { euros: 0 }); document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); });
  afterEach(async () => { cleanup(); vi.restoreAllMocks(); await callProcedure("leadops.setCallAiCap", { euros: 0 }); resetStore(); });

  it("Die Abschrift zählt mit: eigener Zweck im Bereich „Gespräche“; Mitschreiben und Bewerten ergeben zusammen die Kosten der Gespräche", async () => {
    expect(purposeInfo("abschrift")).toEqual({ label: "Gespräche mitschreiben (Abschrift)", area: "gespraeche" });
    const now = await today(); const history = await callProcedure("leadops.aiUsageHistory", { days: 30 }) as { callCapCents: number; days: Array<{ areas: Record<string, number>; parts: Array<{ label: string; area: string; cents: number; calls: number }> }> };
    const day = history.days[history.days.length - 1]; expect(history.callCapCents).toBe(0);
    expect(now.spentCents).toBeGreaterThan(0); expect(Math.abs(now.transcriptCents + now.ratingCents - now.spentCents)).toBeLessThanOrEqual(1); expect(Math.abs(day.areas.gespraeche - now.spentCents)).toBeLessThanOrEqual(1);
    const transcript = day.parts.find((part) => part.label === "Gespräche mitschreiben (Abschrift)")!; expect(transcript).toMatchObject({ area: "gespraeche", cents: now.transcriptCents }); expect(transcript.calls).toBe(now.calls);
    expect(now.perCallCents).toBeCloseTo(now.spentCents / now.calls, 0); expect(now).toMatchObject({ capCents: 0, reached: false, waiting: 0 });
  });

  it("Seite Gespräche: Knopf „KI heute“ zeigt die Kosten der Gespräche und öffnet den KI-Verbrauch mit eigener Zeile – Mitschreiben, Bewerten, Preis je Gespräch, Obergrenze", async () => {
    const now = await today(); const root = await open("page=Gespräche");
    const chip = root.querySelector<HTMLButtonElement>(".cq-tool.cq-ai")!; expect(chip).toBeTruthy(); expect(chip.textContent).toBe(`KI heute ${euro(now.spentCents)}`); expect(chip.classList.contains("is-full")).toBe(false);
    expect(chip.getAttribute("title")).toContain(`Mitschreiben ${euro(now.transcriptCents)}, Bewerten ${euro(now.ratingCents)}`); expect(chip.getAttribute("title")).toContain("Keine Obergrenze eingestellt.");
    await click(chip, 900); const dialog = document.querySelector<HTMLElement>(".ai-usage")!; expect(dialog).toBeTruthy();
    const line = dialog.querySelector<HTMLElement>('.au-calls[aria-label="KI bei Gesprächen heute"]')!; expect(line).toBeTruthy();
    expect(line.querySelector(".au-calls-main strong")!.textContent).toBe(euro(now.spentCents)); expect(line.querySelector(".au-calls-main small")!.textContent).toBe(`Mitschreiben ${euro(now.transcriptCents)} · Bewerten ${euro(now.ratingCents)}`);
    expect(texts(line, ".au-calls-fact span")).toEqual(["Je Gespräch", "Obergrenze am Tag"]); expect(texts(line, ".au-calls-fact b")[0]).toMatch(/^etwa \d+(,\d)? Cent$/); expect(texts(line, ".au-calls-fact b")[1]).toBe("keine");
    expect(texts(line, ".au-calls-fact small")).toEqual([`${now.calls} Gespräche heute`, "Gespräche werden immer bewertet"]);
    expect(dialog.querySelector(".au-foot")!.textContent).toContain("warten neue Gespräche und werden später von selbst bewertet"); expect(texts(dialog, ".au-legend li").some((text) => text.startsWith("Gespräche"))).toBe(true);
    // Obergrenze eintragen – gleich im Fenster: unter dem Verbrauch von heute → sofort „erreicht“
    const type = async (value: string) => { const field = document.querySelector<HTMLInputElement>(".au-calls .au-amount input")!; await act(async () => { fireEvent.change(field, { target: { value } }); }); };
    await click(line.querySelector(".au-cap-btn"), 200); const form = () => document.querySelector<HTMLFormElement>(".au-calls .au-amount")!; expect(form().querySelector("label span")!.textContent).toBe("Obergrenze am Tag für Gespräche"); expect(form().querySelector("small")!.textContent).toContain("0 = keine Grenze");
    expect(form().querySelector<HTMLInputElement>("input")!.value).toBe("0"); expect(document.querySelector(".app-confirm")).toBeNull();
    // unsinnige Eingabe: Speichern ist gesperrt, es steht ein Hinweis da
    await type("abc"); expect(form().querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true); expect(form().querySelector("small")!.textContent).toBe("Bitte einen Betrag zwischen 0 und 1000 Euro eingeben."); expect((await today()).capCents).toBe(0);
    await type("1"); await click(form().querySelector('button[type="submit"]'), 900);
    expect(await today()).toMatchObject({ capCents: 100, reached: now.spentCents >= 100 }); expect(document.querySelector(".au-calls .au-amount")).toBeNull();
    const after = document.querySelector<HTMLElement>(".au-calls")!; expect(texts(after, ".au-calls-fact b")[1]).toBe(euro(100));
    if (now.spentCents >= 100) { expect(after.classList.contains("is-full")).toBe(true); expect(texts(after, ".au-calls-fact small")[1]).toContain("erreicht"); const button = root.querySelector(".cq-tool.cq-ai")!; expect(button.classList.contains("is-full")).toBe(true); expect(button.textContent).toContain(`/ ${euro(100)}`); expect(button.textContent).toContain("Grenze erreicht"); }
    // Abbrechen lässt alles, wie es ist
    await click(after.querySelector(".au-cap-btn"), 200); await type("7,5"); await click(Array.from(document.querySelectorAll(".au-calls .au-amount button")).find((button) => button.textContent === "Abbrechen"), 300); expect((await today()).capCents).toBe(100); expect(document.querySelector(".au-calls .au-amount")).toBeNull();
    // das Tagesbudget der E-Mail-Kampagnen lässt sich im selben Fenster ändern – Komma geht auch
    await click(Array.from(dialog.querySelectorAll(".au-foot button")).find((button) => button.textContent === "Tagesbudget ändern"), 200); const budget = dialog.querySelector<HTMLInputElement>(".au-foot .au-amount input")!; await act(async () => { fireEvent.change(budget, { target: { value: "12,5" } }); });
    await click(dialog.querySelector('.au-foot .au-amount button[type="submit"]'), 900); expect((await callProcedure("leadops.aiUsageToday", undefined) as { budgetCents: number }).budgetCents).toBe(1250); await callProcedure("leadops.setAiDailyBudget", { euros: 10 });
    // hohe Grenze: Platz frei
    await callProcedure("leadops.setCallAiCap", { euros: 500 }); cleanup(); const second = await open("page=Gespräche"); const wide = second.querySelector(".cq-tool.cq-ai")!; expect(wide.classList.contains("is-full")).toBe(false); expect(wide.textContent).toBe(`KI heute ${euro(now.spentCents)} / ${euro(50_000)}`);
  }, 60_000);

  it("Der Knopf bei den E-Mail-Kampagnen öffnet dasselbe Fenster – auch dort steht die Zeile der Gespräche", async () => {
    const root = await open("page=E-Mail-Kampagnen&ansicht=kampagnen", 1800); await click(root.querySelector("button.is-ai"), 900);
    expect(document.querySelector(".ai-usage .au-calls")).toBeTruthy(); expect(document.querySelectorAll(".ai-usage .au-tile")).toHaveLength(3);
  }, 40_000);
});
