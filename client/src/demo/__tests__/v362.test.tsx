import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IntegrationTab from "@/components/IntegrationTab";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";

/**
 * Version 362 – Wattfox: Stromverbrauch geht als Zahl raus (die Testumgebung lehnte „4.000 - 6.000 kWh“ ab). Gespeicherte Zugangsdaten:
 * Benutzername lesbar, ein gespeichertes Passwort steht als „gespeichert – zum Ändern neu eintippen“ (statt Punkten, die wie ein leeres Feld wirkten).
 */
type Member = { membershipId: number; userId: number; status: string };
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const byText = (root: ParentNode, selector: string, text: string | RegExp) => Array.from(root.querySelectorAll(selector)).find((node) => (typeof text === "string" ? node.textContent?.trim() === text : text.test(node.textContent ?? "")));
function mount(membershipId: number) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><IntegrationTab membershipId={membershipId} webhookUrl={null} /></QueryClientProvider></trpc.Provider>);
}
const type = async (input: Element | null | undefined, value: string) => { expect(input).toBeTruthy(); await act(async () => { fireEvent.change(input!, { target: { value } }); }); await settle(50); };

describe("Version 362", () => {
  beforeEach(() => { cleanup(); resetStore(); Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true }); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); });

  it("gespeichert: Benutzername lesbar, Passwort „gespeichert“ (Auge aus); neu eintippen ändert, leeren behält – Testleads: alle 3 kommen an", async () => {
    const members = await callProcedure("leadops.listMembers", undefined) as Member[];
    const buyer = members.find((member) => member.status === "aktiv" && member.userId !== (getStore().tables.users as unknown as Array<{ id: number }>)[0].id && !(getStore().tables.deliveryEndpoints as unknown as Array<{ membershipId: number }>).some((row) => row.membershipId === member.membershipId)) ?? members[1];
    const view = mount(buyer.membershipId); await settle(1200);
    await click(byText(view.container, "button", /^Photovoltaik/));
    await click(byText(view.container, "button", "Endpoint hinzufügen"));
    let editor = document.body.querySelector(".fixed.inset-0")!;
    await click(editor.querySelector(".ig-wattfox-template"));
    const values = () => Array.from(document.body.querySelectorAll<HTMLInputElement>(".fixed.inset-0 .ig-credential input[data-secret]"));
    await type(values()[0], "testfirma"); await type(values()[1], "geheim");
    await click(byText(editor, "button", "Speichern"), 1000);
    // wieder öffnen
    await click(byText(view.container, "button", "Bearbeiten"));
    editor = document.body.querySelector(".fixed.inset-0")!;
    const [user, pass] = values();
    expect(user.value).toBe("testfirma"); expect(user.dataset.secret).toBe("shown"); // Benutzername lesbar – man sieht, welcher Zugang drin ist
    expect(pass.value).toBe(""); expect(pass.placeholder).toBe("gespeichert – zum Ändern neu eintippen");
    const eye = () => editor.querySelectorAll<HTMLButtonElement>(".ig-credential-eye")[1];
    expect(eye().disabled).toBe(true); expect(eye().title).toContain("zum Prüfen neu eintippen");
    expect(editor.querySelector(".ig-credentials-hint")?.textContent).toContain("Ein gespeichertes Passwort zeigt die Software nicht mehr an („gespeichert“)");
    // neu eintippen → Auge geht; wieder leeren → bleibt „gespeichert“
    await type(values()[1], "x"); expect(eye().disabled).toBe(false); expect(values()[1].value).toBe("x");
    await type(values()[1], ""); expect(values()[1].value).toBe(""); expect(values()[1].placeholder).toBe("gespeichert – zum Ändern neu eintippen"); expect(eye().disabled).toBe(true);
    await click(byText(editor, "button", "Speichern"), 1000);
    const saved = (getStore().tables.deliveryEndpoints as unknown as Array<{ membershipId: number; auth: { credentials: Array<{ name: string; value: string }> } | null }>).filter((row) => row.membershipId === buyer.membershipId).at(-1)!;
    expect(saved.auth?.credentials).toEqual([{ name: "user", value: "testfirma" }, { name: "pass", value: "geheim" }]);
    // Testleads: Photovoltaik geht mit dem Stromverbrauch als Zahl raus – alle 3 kommen an
    await click(byText(view.container, "button", "Bearbeiten"));
    const again = document.body.querySelector(".fixed.inset-0")!;
    await click(again.querySelector(".ig-wattfox-send"), 1200);
    const panel = again.querySelector(".ig-wattfox-tests")!;
    expect(panel.textContent).toContain("Testleads an Wattfox: 3 von 3 angekommen");
    expect(panel.textContent).not.toContain("is not a valid digit");
  }, 30_000);
});
