import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { callProcedure, getStore, resetStore } from "../backend";
import { localDemoLink } from "../link";
import { campaignOptionText } from "../../../../shared/campaign-tag";

const call = (path: string, input?: unknown) => callProcedure(path, input) as Promise<any>;
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }

describe("Lead-Kategorie steht in jeder Kampagnen-Auswahl mit (Chat-Build)", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });

  it("Server-Spiegel: jede Kampagne hat ein Kategorie-Schild (Name + Emoji); Kontakte-, Posteingang- und Gesendet-Listen tragen es mit", async () => {
    const rows = await call("leadops.listEmailCampaigns"); expect(rows.length).toBeGreaterThan(2);
    for (const row of rows) { expect(row.tag).toMatchObject({ label: expect.any(String), emoji: expect.any(String) }); expect(row.tag.label.length).toBeGreaterThan(0); }
    const alarm = rows.find((row: any) => row.name === "Alarmanlagen-Errichter NRW"); expect(alarm.tag.label).toBe("Alarmanlage"); expect(alarm.tag.emoji).not.toBe("");
    const energy = rows.find((row: any) => /Photovoltaik & Wärmepumpe/.test(row.tag.label)); expect(energy?.tag.emoji).toBe("☀️♨️");
    expect(campaignOptionText(alarm.tag, alarm.name)).toBe(`${alarm.tag.emoji} Alarmanlage · Alarmanlagen-Errichter NRW`);
    const leads = await call("leadops.emailLeads", {}); expect(leads.campaigns.length).toBeGreaterThan(0); for (const campaign of leads.campaigns) expect(campaign.tag).toMatchObject({ label: expect.any(String) });
    const withCampaign = leads.items.find((item: any) => item.campaigns.length); expect(withCampaign.campaigns[0].tag).toMatchObject({ label: expect.any(String), emoji: expect.any(String) });
    const inbox = await call("leadops.listInbox", { filter: "alle" }); expect(inbox.campaigns.length).toBeGreaterThan(0); for (const campaign of inbox.campaigns) expect(campaign.tag).toMatchObject({ label: expect.any(String) });
    const sent = await call("leadops.listSent", {}); expect(sent.campaigns.length).toBeGreaterThan(0); for (const campaign of sent.campaigns) expect(campaign.tag).toMatchObject({ label: expect.any(String) });
  });

  it("Kontakte-Reiter: „E-Mail-Kampagne wählen“ und der Kampagnen-Filter zeigen „Emoji Kategorie · Name“, sortiert nach Kategorie; Posteingang-Filter ebenso", async () => {
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kontakte");
    const view = mount(); await settle(300); await settle(300);
    const pick = view.container.querySelector<HTMLSelectElement>('select[aria-label="E-Mail-Kampagne wählen"]');
    if (pick) { // die Auswahl erscheint, sobald Kontakte angekreuzt sind – sonst reicht der Filter
      const texts = Array.from(pick.options).slice(1).map((option) => option.textContent ?? ""); expect(texts.length).toBeGreaterThan(1);
      for (const text of texts) expect(text).toMatch(/ · /);
      const labels = texts.map((text) => text.split(" · ")[0].replace(/^\S+\s/, "")); expect([...labels].sort((a, b) => a.localeCompare(b, "de"))).toEqual(labels);
    }
    const filter = view.container.querySelector<HTMLSelectElement>('select[aria-label="Kampagne"]')!; expect(filter).toBeTruthy();
    const filterTexts = Array.from(filter.options).slice(1).map((option) => option.textContent ?? ""); expect(filterTexts.length).toBeGreaterThan(1);
    for (const text of filterTexts) expect(text).toMatch(/ · /);
    const served = await call("leadops.emailLeads", {}); expect(filterTexts).toEqual(served.campaigns.map((campaign: any) => `${campaignOptionText(campaign.tag, campaign.name)}${campaign.archived ? " · Archiv" : ""}`)); // gleiche Texte und Reihenfolge wie der Server (Kategorie, dann Name)
    // Kontakt ankreuzen → Auswahl „E-Mail-Kampagne wählen“ mit Kategorie
    const box = view.container.querySelector<HTMLInputElement>('.email-leads-table tbody input[type="checkbox"], table tbody input[type="checkbox"]');
    if (box) { await act(async () => { fireEvent.click(box); }); await settle(200); const select = view.container.querySelector<HTMLSelectElement>('select[aria-label="E-Mail-Kampagne wählen"]'); if (select) { const texts = Array.from(select.options).slice(1).map((option) => option.textContent ?? ""); for (const text of texts) expect(text).toMatch(/ · /); } }
    cleanup();
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=posteingang");
    const inboxView = mount(); await settle(300); await settle(300);
    const inboxFilter = inboxView.container.querySelector<HTMLSelectElement>('select[aria-label="Nach Kampagne filtern"]')!; expect(inboxFilter).toBeTruthy();
    for (const option of Array.from(inboxFilter.options).slice(1)) expect(option.textContent).toMatch(/ · .+ \(\d+\)$/);
    expect(getStore().tables.emailCampaigns.length).toBeGreaterThan(0);
  });
});
