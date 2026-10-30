import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { callProcedure, resetStore } from "../backend";
import { localDemoLink } from "../link";

const call = (path: string, input?: unknown) => callProcedure(path, input) as Promise<any>;
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }

describe("Absender-Adressen mit eigenem Postfach (Chat-Build)", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });
  it("Postfach speichern (Passwort bleibt verborgen, leer lassen behält es), Ampel nach Testmail, „keins“ entfernt es", async () => {
    const saved = await call("leadops.saveMailSender", { fromEmail: "taner@tanesco-leads.example", fromName: "Taner", dailyLimit: 40, mailbox: { kind: "google", user: "taner@tanesco-leads.example", password: "app-pass-1" } });
    const rowOf = async () => (await call("leadops.listMailSenders")).senders.find((item: any) => item.id === saved.id);
    let row = await rowOf(); expect(row.mailbox).toMatchObject({ kind: "google", host: "smtp.gmail.com", port: 465, secure: true, user: "taner@tanesco-leads.example", hasPassword: true, ready: true, missing: [], lastTestStatus: null }); expect(JSON.stringify(row)).not.toContain("app-pass-1");
    expect(await call("leadops.testMailSender", { id: saved.id })).toMatchObject({ ok: true, to: "vertrieb@tanesco.digital" }); row = await rowOf(); expect(row.mailbox.lastTestStatus).toBe("ok"); expect(row.mailbox.lastTestAt).toBeTruthy();
    await call("leadops.saveMailSender", { id: saved.id, fromEmail: "taner@tanesco-leads.example", fromName: "Taner T.", dailyLimit: 45, mailbox: { kind: "microsoft", user: "taner@tanesco-leads.example", password: "" } }); // Passwort leer = behalten
    row = await rowOf(); expect(row.mailbox).toMatchObject({ kind: "microsoft", host: "smtp.office365.com", port: 587, hasPassword: true, ready: true, lastTestStatus: null }); expect(row.dailyLimit).toBe(45); expect(row.fromName).toBe("Taner T.");
    await expect(call("leadops.saveMailSender", { id: saved.id, fromEmail: "taner@tanesco-leads.example", mailbox: { kind: "smtp", host: "", user: "x", password: "y" } })).rejects.toThrow(/Server/);
    await call("leadops.saveMailSender", { id: saved.id, fromEmail: "taner@tanesco-leads.example", mailbox: { kind: "keins" } });
    row = await rowOf(); expect(row.mailbox).toBeNull(); await expect(call("leadops.testMailSender", { id: saved.id })).rejects.toThrow(/kein eigenes Postfach/);
  });
  it("Oberfläche: Zeile zeigt den Postfach-Stand, „Eigenes Postfach“ klappt den Zugang auf, Speichern und Testmail", async () => {
    await call("leadops.saveMailSender", { fromEmail: "francesco@tanesco-leads.example", fromName: "Francesco", dailyLimit: 40 });
    window.history.replaceState(null, "", "/?page=Einstellungen&setting=E-Mail-Versand");
    const view = mount(); await settle(400); await settle(400);
    const row = Array.from(view.container.querySelectorAll<HTMLElement>(".mh-sender")).find((node) => node.textContent?.includes("francesco@tanesco-leads.example"))!; expect(row).toBeTruthy();
    expect(row.querySelector(".mh-sender-box")?.textContent).toBe("sendet über den Anbieter oben");
    await act(async () => { fireEvent.click(Array.from(row.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent === "Eigenes Postfach")!); }); await settle(100);
    const box = row.querySelector(".mh-mailbox")!; expect(box).toBeTruthy();
    const select = box.querySelector<HTMLSelectElement>("select")!; expect(Array.from(select.options).map((option) => option.textContent)).toEqual(["Kein eigenes Postfach – Anbieter oben", "Google Workspace / Gmail", "Microsoft 365 / Outlook", "Anderer Anbieter (SMTP)"]);
    await act(async () => { fireEvent.change(select, { target: { value: "google" } }); }); await settle(100);
    expect(box.querySelector(".mh-mailbox-hint")?.textContent).toContain("App-Passwort");
    const password = box.querySelector<HTMLInputElement>('input[type="password"]')!; await act(async () => { fireEvent.change(password, { target: { value: "app-pass-2" } }); });
    await act(async () => { fireEvent.click(Array.from(box.querySelectorAll<HTMLButtonElement>("button")).find((node) => /^Speichern/.test(node.textContent ?? ""))!); }); await settle(400); await settle(300);
    const after = () => Array.from(view.container.querySelectorAll<HTMLElement>(".mh-sender")).find((node) => node.textContent?.includes("francesco@tanesco-leads.example"))!;
    expect(after().querySelector(".mh-sender-box")?.textContent).toContain("noch nicht getestet");
    const test = Array.from(after().querySelectorAll<HTMLButtonElement>("button")).find((node) => /^Testmail an /.test(node.textContent?.trim() ?? ""))!; expect(test).toBeTruthy();
    await act(async () => { fireEvent.click(test); }); await settle(400); await settle(300);
    expect(after().querySelector(".mh-sender-box")?.textContent).toContain("versendet (zuletzt");
  });
});
