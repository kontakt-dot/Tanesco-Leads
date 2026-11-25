import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";

/**
 * Version 363 – PLZ mit führender Null: Unter „API-Fehler“ zeigt eine 4-stellige deutsche PLZ den Vorschlag mit Null („9633“ → „09633“),
 * im Formular „Korrigieren“ übernimmt ein Klick ihn.
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
const until = async (check: () => boolean, max = 20_000) => { const start = Date.now(); while (!check() && Date.now() - start < max) await settle(250); };
const button = (scope: ParentNode, label: string) => Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((node) => (node.textContent ?? "").trim() === label);
const rowOf = (root: ParentNode, name: string) => Array.from(root.querySelectorAll<HTMLElement>(".af-row")).find((row) => row.querySelector(".af-name")?.textContent === name);
type Row = Record<string, any>;
type Overview = { problems: Array<{ publicId: string; name: string; dataProblems: Array<{ field: string; suggestion?: string | null }> }> };

describe("Version 363", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); });

  it("API-Fehler: 4-stellige deutsche PLZ → Vorschlag mit führender Null, ein Klick übernimmt ihn", async () => {
    const overview = await callProcedure("leadops.apiErrorOverview", { days: 30 }) as Overview;
    const publicId = overview.problems.find((problem) => problem.name === "Peter Hansen")!.publicId;
    const lead = (getStore().tables as unknown as Record<string, Row[]>).leads.find((row) => row.publicId === publicId)!; lead.postcode = "4103"; lead.country = "DE"; // so kam es vom Dialer: ohne Null
    const after = await callProcedure("leadops.apiErrorOverview", { days: 30 }) as Overview;
    expect(after.problems.find((problem) => problem.publicId === publicId)!.dataProblems).toEqual(expect.arrayContaining([expect.objectContaining({ field: "postcode", suggestion: "04103" })]));
    const root = await open("page=API-Fehler", 2500); await until(() => Boolean(rowOf(root, "Peter Hansen")));
    await click(button(rowOf(root, "Peter Hansen")!, "Korrigieren"), 300);
    const form = () => root.querySelector<HTMLFormElement>("form.af-edit")!; const input = (key: string) => form().querySelector<HTMLInputElement>(`.af-field.is-${key} input`)!;
    const alertOf = (key: string) => form().querySelector(`.af-field.is-${key} [role="alert"]`)?.textContent ?? null;
    const plzSuggestion = () => form().querySelector<HTMLButtonElement>(".af-field.is-postcode .af-suggest");
    expect(input("postcode").value).toBe("4103"); expect(alertOf("postcode")).toBe("Eine deutsche PLZ hat 5 Ziffern.");
    expect(plzSuggestion()!.textContent).toBe("Die führende Null fehlt: 04103 übernehmen");
    await click(plzSuggestion(), 200); expect(input("postcode").value).toBe("04103"); expect(alertOf("postcode")).toBeNull(); expect(plzSuggestion()).toBeNull();
    // keine Null-Vorschläge, wo es nichts zu ergänzen gibt
    await type(input("postcode"), "241"); expect(alertOf("postcode")).toBe("Eine deutsche PLZ hat 5 Ziffern."); expect(plzSuggestion()).toBeNull();
  }, 60_000);
});
