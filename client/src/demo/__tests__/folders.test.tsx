import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { callProcedure, getStore, resetStore } from "../backend";
import { localDemoLink } from "../link";

const call = (path: string, input?: unknown) => callProcedure(path, input) as Promise<any>;
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const names = (root: HTMLElement) => Array.from(root.querySelectorAll(".cl-card .cl-name strong")).map((node) => node.textContent ?? "");
const chips = (root: HTMLElement) => Array.from(root.querySelectorAll(".cl-folder-pick")).map((node) => `${node.querySelector("span")?.textContent} ${node.querySelector("i")?.textContent}`);

describe("Kampagnen-Ordner (z. B. je Leadsparte)", () => {
  beforeEach(() => { resetStore(); try { localStorage.removeItem("kampagnen-ordner"); localStorage.removeItem("kampagnen-kpi"); } catch { /* egal */ } });
  afterEach(() => { cleanup(); document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); });

  it("Ordner je Leadsparte (über den Server-Spiegel, der Knopf dafür ist weg); ein Ordner filtert Liste und Kennzahlen und bleibt gemerkt", async () => {
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const first = mount(); await settle(300); await settle(300);
    const bar0 = first.container.querySelector<HTMLElement>(".cl-folders"); expect(bar0).not.toBeNull();
    expect(bar0!.querySelector(".cl-folder.is-all.is-active")?.textContent).toMatch(/^Alle\d+$/);
    const all = names(first.container); expect(all).toContain("Hausnotruf-Anbieter – Erstkontakt"); expect(all).toContain("Alarmanlagen-Errichter NRW");
    expect(Array.from(bar0!.querySelectorAll(".cl-folder-act")).map((node) => node.textContent?.trim())).toEqual(["Neuer Ordner"]); // kein „Nach Leadsparte einsortieren“ mehr
    cleanup();
    const sorted = await call("leadops.sortEmailCampaignsBySparte"); expect(sorted.created).toBeGreaterThanOrEqual(1);
    const view = mount(); await settle(300); await settle(300);
    expect(chips(view.container)).toEqual(["Alarmanlage 1", "Hausnotruf 1", "Photovoltaik 3", "Photovoltaik & Wärmepumpe 2", "Wärmepumpe 0"]); // Übersicht ohne Archiv (Wärmepumpe: nur die archivierte Frühjahrs-Kampagne)
    expect(Array.from(view.container.querySelectorAll(".cl-folder-act")).map((node) => node.textContent?.trim())).toEqual(["Neuer Ordner"]); // alles einsortiert
    expect(view.container.querySelector(".cl-folder.is-none")).toBeNull(); // keine Kampagne ohne Ordner
    expect(view.container.querySelector(".cl-card .cl-meta-folder")?.textContent?.trim()).toBeTruthy(); // in „Alle“ steht der Ordner auf der Karte
    // Ordner „Hausnotruf“ öffnen: nur diese Kampagne, Kennzahlen nur für den Ordner, Wahl gemerkt
    const hausnotruf = Array.from(view.container.querySelectorAll<HTMLButtonElement>(".cl-folder-pick")).find((node) => node.textContent?.startsWith("Hausnotruf"))!;
    await act(async () => { fireEvent.click(hausnotruf); }); await settle(100);
    expect(names(view.container)).toEqual(["Hausnotruf-Anbieter – Erstkontakt"]);
    expect(view.container.querySelector(".cd-kpi-pick select option")?.textContent).toBe("Alle Kampagnen in „Hausnotruf“ (1)");
    expect(view.container.querySelector(".cl-card .cl-meta-folder")).toBeNull(); // im Ordner selbst nicht nötig
    const folders = await call("leadops.listEmailCampaignFolders"); const id = folders.find((folder: any) => folder.name === "Hausnotruf").id;
    expect(localStorage.getItem("kampagnen-ordner")).toBe(String(id));
    expect(view.container.querySelector(".cl-folder.is-active .cl-folder-more")).not.toBeNull(); // „⋯“ zum Umbenennen/Löschen am offenen Ordner
  });

  it("Server-Spiegel: anlegen, umbenennen, doppelte Namen, verschieben ohne „zuletzt bearbeitet“, neue Kampagne und Kopie im Ordner, löschen gibt frei", async () => {
    const created = await call("leadops.saveEmailCampaignFolder", { name: "  Hausnotruf  " }); expect(created).toMatchObject({ name: "Hausnotruf", created: true });
    await expect(call("leadops.saveEmailCampaignFolder", { name: "hausnotruf" })).rejects.toThrow("Den Ordner „Hausnotruf“ gibt es schon.");
    const second = await call("leadops.saveEmailCampaignFolder", { name: "Alarm" });
    expect((await call("leadops.saveEmailCampaignFolder", { id: second.id, name: "Alarmanlage" })).name).toBe("Alarmanlage");
    const campaigns = (await call("leadops.listEmailCampaigns")) as any[]; const target = campaigns.find((row) => row.name === "PV-Betriebe Bayern");
    const before = new Date(target.updatedAt).getTime();
    expect(await call("leadops.moveEmailCampaignsToFolder", { ids: [target.id], folderId: created.id })).toEqual({ moved: 1, folderId: created.id });
    const moved = ((await call("leadops.listEmailCampaigns")) as any[]).find((row) => row.id === target.id);
    expect(moved.folderId).toBe(created.id); expect(new Date(moved.updatedAt).getTime()).toBe(before); // Ablage ist kein Bearbeiten
    const template = campaigns.find((row) => row.isTemplate);
    expect((await call("leadops.moveEmailCampaignsToFolder", { ids: [template.id], folderId: created.id })).moved).toBe(0); // Vorlagen liegen in keinem Ordner
    await expect(call("leadops.moveEmailCampaignsToFolder", { ids: [target.id], folderId: 9999 })).rejects.toThrow("Ordner nicht gefunden");
    // neue Kampagne im geöffneten Ordner, Kopie bleibt im Ordner des Originals, Vorlage nie im Ordner
    const fresh = await call("leadops.saveEmailCampaign", { name: "Hausnotruf Süd", audience: { source: "auswahl" }, tree: { start: null, nodes: [] }, design: {}, folderId: created.id });
    const copy = await call("leadops.duplicateEmailCampaign", { id: target.id }); const asTemplate = await call("leadops.duplicateEmailCampaign", { id: target.id, asTemplate: true });
    const rows = getStore().tables.emailCampaigns; const folderOf = (campaignId: number) => rows.find((row) => row.id === campaignId)?.folderId ?? null;
    expect([folderOf(fresh.id), folderOf(copy.id), folderOf(asTemplate.id)]).toEqual([created.id, created.id, null]);
    // Ordner löschen: Kampagnen bleiben, stehen danach ohne Ordner
    expect(await call("leadops.deleteEmailCampaignFolder", { id: created.id })).toEqual({ success: true, released: 3 });
    expect([folderOf(fresh.id), folderOf(copy.id), folderOf(target.id)]).toEqual([null, null, null]);
    expect(((await call("leadops.listEmailCampaignFolders")) as any[]).map((folder) => folder.name)).toEqual(["Alarmanlage"]);
  });
});
