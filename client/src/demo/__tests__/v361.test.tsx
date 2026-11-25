import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IntegrationTab from "@/components/IntegrationTab";
import { Input } from "@/components/ui/input";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";

/**
 * Version 361 – Zugangsdaten sicher eintragen: In Felder für Zugangsdaten anderer Systeme setzt der Browser nichts ein
 * (vorher stand z. B. das gespeicherte Passwort für diese Software im Feld „user“ von Wattfox). Im Endpoint-Editor: Benutzername lesbar,
 * Passwort als Punkte, Auge je Zeile, Hinweis. Wo der Browser Punkte per CSS kann, ist es ein Textfeld mit Punkten, sonst ein Passwortfeld mit „new-password“.
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
const IGNORED = ["data-1p-ignore", "data-lpignore", "data-bwignore"];

describe("Version 361", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); resetStore(); });

  it("Endpoint-Editor: Benutzername lesbar, Passwort als Punkte, Auge je Zeile, Hinweis – der Browser setzt nichts ein", async () => {
    const members = await callProcedure("leadops.listMembers", undefined) as Member[];
    const buyer = members.find((member) => member.status === "aktiv" && member.userId !== (getStore().tables.users as unknown as Array<{ id: number }>)[0].id) ?? members[1];
    const view = mount(buyer.membershipId); await settle(1200);
    await click(byText(view.container, "button", /^Photovoltaik/));
    await click(byText(view.container, "button", "Endpoint hinzufügen"));
    const editor = document.body.querySelector(".fixed.inset-0")!;
    await click(editor.querySelector(".ig-wattfox-template"));
    expect(editor.querySelector(".ig-credentials-hint")?.textContent).toContain("selbst eintippen – der Browser setzt hier nichts ein");
    const rows = Array.from(editor.querySelectorAll<HTMLElement>(".ig-credential")); expect(rows).toHaveLength(2);
    const nameOf = (row: HTMLElement) => row.querySelector<HTMLInputElement>("input:not([data-secret])")!;
    const valueOf = (row: HTMLElement) => row.querySelector<HTMLInputElement>("input[data-secret]")!;
    expect(rows.map((row) => nameOf(row).value)).toEqual(["user", "pass"]);
    expect(rows.every((row) => nameOf(row).getAttribute("autocomplete") === "off")).toBe(true);
    // „user“: lesbar (kein Geheimnis), „pass“: Punkte – beide ohne Ausfüllen durch Browser oder Passwort-Manager, ohne Rechtschreibprüfung
    expect(valueOf(rows[0])).toMatchObject({ type: "text" }); expect(valueOf(rows[0]).dataset.secret).toBe("shown"); expect(valueOf(rows[0]).getAttribute("autocomplete")).toBe("off");
    expect(valueOf(rows[1]).dataset.secret).toBe("masked"); expect(valueOf(rows[1]).type).toBe("password"); expect(valueOf(rows[1]).getAttribute("autocomplete")).toBe("new-password"); // ohne Punkte per CSS (wie hier im Test): Passwortfeld mit „new-password“
    for (const row of rows) { for (const name of IGNORED) expect(valueOf(row).getAttribute(name)).toBe("true"); expect(valueOf(row).getAttribute("spellcheck")).toBe("false"); }
    expect(valueOf(rows[1]).getAttribute("aria-label")).toBe("Wert für „pass“");
    // Auge: zeigen und wieder verbergen
    const eye = rows[1].querySelector<HTMLButtonElement>(".ig-credential-eye")!; expect(eye.getAttribute("aria-label")).toBe("„pass“ zeigen");
    await click(eye, 100); expect(valueOf(rows[1])).toMatchObject({ type: "text" }); expect(valueOf(rows[1]).dataset.secret).toBe("shown"); expect(eye.getAttribute("aria-label")).toBe("„pass“ verbergen");
    await click(eye, 100); expect(valueOf(rows[1]).type).toBe("password"); expect(valueOf(rows[1]).dataset.secret).toBe("masked");
    await click(rows[0].querySelector(".ig-credential-eye"), 100); expect(valueOf(rows[0]).dataset.secret).toBe("masked"); // auch den Benutzernamen kann man verbergen
    // eintippen und speichern: die Werte kommen unverändert an
    await act(async () => { fireEvent.change(valueOf(rows[0]), { target: { value: "testfirma" } }); fireEvent.change(valueOf(rows[1]), { target: { value: "geheim" } }); });
    await click(byText(editor, "button", "Speichern"), 1000);
    const saved = (getStore().tables.deliveryEndpoints as unknown as Array<{ membershipId: number; auth: { credentials: Array<{ name: string; value: string }> } | null }>).filter((row) => row.membershipId === buyer.membershipId).at(-1)!;
    expect(saved.auth?.credentials).toEqual([{ name: "user", value: "testfirma" }, { name: "pass", value: "geheim" }]);
  });

  it("Feld für Zugangsdaten: wo der Browser Punkte per CSS kann, ein Textfeld mit Punkten – der Passwort-Manager kennt es nicht", async () => {
    vi.stubGlobal("CSS", { supports: (property: string, value: string) => property === "-webkit-text-security" && value === "disc" });
    const view = render(<div><Input type="password" aria-label="geheim" defaultValue="x" /><Input type="password" reveal aria-label="gezeigt" defaultValue="y" /><Input type="password" autoComplete="current-password" aria-label="eigene Anmeldung" /></div>);
    const field = (label: string) => view.container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    expect(field("geheim")).toMatchObject({ type: "text" }); expect(field("geheim").dataset.secret).toBe("masked"); expect(field("geheim").getAttribute("autocomplete")).toBe("off");
    expect(field("gezeigt")).toMatchObject({ type: "text" }); expect(field("gezeigt").dataset.secret).toBe("shown");
    // die eigene Anmeldung bleibt ein echtes Passwortfeld (dort darf der Browser einsetzen)
    expect(field("eigene Anmeldung")).toMatchObject({ type: "password" }); expect(field("eigene Anmeldung").getAttribute("autocomplete")).toBe("current-password"); expect(field("eigene Anmeldung").dataset.secret).toBeUndefined();
  });
});
