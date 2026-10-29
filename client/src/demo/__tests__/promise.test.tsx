import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

describe("Versprechen halten (Chat-Build): Follow-ups nennen die Test-Leads der E-Mail davor, Posteingang zeigt unsere Mails, Interessent bekommt Kategorie und Stufe der Kampagne", () => {
  beforeAll(() => resetStore());

  it("Follow-up: 20 bleibt 20 (gespeicherter Text oder alte Mail ohne Text), neue Kontakte 10; Freigabe-Liste mit Schritt und E-Mail davor", async () => {
    const { starterBlocks } = await import("../../../../shared/email-design"); const { TEST_OFFER_CHANGED_AT } = await import("../../../../shared/email-campaigns");
    await call("leadops.importColdList", { listName: "Versprechen-Demo", rows: [{ firstName: "Vera", lastName: "Versprechen", company: "Versprechen Wärme", email: "vera@versprechen-demo.example" }, { firstName: "Nils", lastName: "Neu", company: "Neu Solar", email: "nils@versprechen-demo.example" }, { firstName: "Olga", lastName: "Alt", company: "Alt Heizung", email: "olga@versprechen-demo.example" }] });
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste an {{firma}}", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait", hours: 1, next: "m2" }, { id: "m2", type: "send", label: "Kurze Nachfrage", subject: "Nachfrage {{firma}}", blocks: starterBlocks("nachfassen"), next: null }] };
    const base = { id: null, fromName: "T", fromEmail: "t@t.de", replyTo: null, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 50 };
    const saved = await call("leadops.saveEmailCampaign", { ...base, name: "Versprechen-Demo", audience: { source: "liste", listName: "Versprechen-Demo" }, tree, kiModus: "freigabe", kiAnsatz: "frei" });
    await call("leadops.startEmailCampaign", { id: saved.id }); await call("leadops.runEmailCampaigns");
    const rows = () => getStore().tables.emailCampaignRecipients.filter((item) => item.campaignId === saved.id).sort((a, b) => a.id - b.id);
    const [vera, nils, olga] = rows(); expect(String(vera.draftText)).toContain("10 Test-Leads");
    const queue1 = await call("leadops.campaignReviewQueue", { campaignId: saved.id }); expect(queue1.counts).toMatchObject({ erste: 3, followUps: 0 }); expect(queue1.items.find((item: any) => item.id === vera.id)).toMatchObject({ step: 1, followUp: false, sentBefore: null, testLeads: 10 });
    await call("leadops.saveCampaignDraft", { recipientId: vera.id, subject: "Persönlich für Versprechen Wärme", text: "Sehr geehrte Frau Versprechen,\n\nzum Kennenlernen stellen wir Ihnen 20 Test-Leads kostenlos bereit.\n\nVielen Dank", approve: true });
    await call("leadops.saveCampaignDraft", { recipientId: nils.id, subject: String(nils.draftSubject), text: String(nils.draftText), approve: true });
    await call("leadops.runEmailCampaigns"); expect(rows()[0].sentCount).toBe(1); expect(rows()[1].sentCount).toBe(1);
    const sentOf = (recipientId: number) => getStore().tables.emailCampaignEvents.filter((event) => event.recipientId === recipientId && event.kind === "gesendet").sort((a, b) => a.id - b.id);
    expect(String(sentOf(vera.id)[0].body)).toContain("20 Test-Leads"); expect(String(sentOf(nils.id)[0].body)).toContain("10 Test-Leads");
    // Olga: alte Vorlagen-Mail von vor der Umstellung, ohne gespeicherten Text → zählt als 20
    const oldAt = new Date(TEST_OFFER_CHANGED_AT.getTime() - 3 * 86_400_000);
    getStore().tables.emailCampaignEvents.push({ id: 99901, tenantId: olga.tenantId, campaignId: saved.id, recipientId: olga.id, nodeId: "m1", kind: "gesendet", subject: "Erste an Alt Heizung", note: "E-Mail „Erste“ gesendet", body: null, bodySource: null, createdAt: oldAt } as never, { id: 99902, tenantId: olga.tenantId, campaignId: saved.id, recipientId: olga.id, nodeId: "w1", kind: "gewartet", subject: null, note: "Wartet 1 Stunden", body: null, bodySource: null, createdAt: new Date(oldAt.getTime() + 1000) } as never);
    Object.assign(olga, { sentCount: 1, nodeId: "w1", lastSentAt: oldAt, draftState: null, draftNodeId: null, draftSubject: null, draftText: null, draftOptions: null });
    for (const row of rows()) row.nextActionAt = new Date(Date.now() - 1000);
    await call("leadops.runEmailCampaigns");
    const [vera2, nils2, olga2] = rows();
    expect(vera2).toMatchObject({ sentCount: 1, nodeId: "m2", draftState: "entwurf", draftNodeId: "m2" });
    expect(String(vera2.draftText)).toContain("20 Test-Leads"); expect(String(vera2.draftText)).not.toMatch(/\b10 Test-Leads/); expect((vera2.draftOptions as Array<{ text: string }>).every((item) => !/\b10 Test-Leads/.test(item.text))).toBe(true);
    expect(String(olga2.draftText)).toContain("20 Test-Leads"); expect(String(nils2.draftText)).toContain("10 Test-Leads"); expect(String(nils2.draftText)).not.toContain("20 Test-Leads");
    const queue2 = await call("leadops.campaignReviewQueue", { campaignId: saved.id }); expect(queue2.counts).toMatchObject({ erste: 0, followUps: 3 });
    expect(queue2.items.find((item: any) => item.id === vera.id)).toMatchObject({ step: 2, followUp: true, nodeLabel: "Kurze Nachfrage", testLeads: 20, sentBefore: { subject: "Persönlich für Versprechen Wärme", count: 1 } });
    expect(queue2.items.find((item: any) => item.id === nils.id)).toMatchObject({ step: 2, testLeads: 10 }); expect(queue2.items.find((item: any) => item.id === olga.id)).toMatchObject({ step: 2, testLeads: 20 });
    // freigeben und senden: Veras Follow-up geht mit 20 raus, Nils' mit 10
    await call("leadops.saveCampaignDraft", { recipientId: vera.id, subject: String(vera2.draftSubject), text: String(vera2.draftText), approve: true });
    await call("leadops.saveCampaignDraft", { recipientId: nils.id, subject: String(nils2.draftSubject), text: String(nils2.draftText), approve: true });
    await call("leadops.runEmailCampaigns"); expect(rows()[0].sentCount).toBe(2);
    expect(String(sentOf(vera.id)[1].body)).toContain("20 Test-Leads"); expect(String(sentOf(nils.id)[1].body)).toContain("10 Test-Leads");
    // Vorlagen-Versand ohne Freigabe speichert den Text; das Follow-up aus der Vorlage nennt wieder die Zahl von davor
    await call("leadops.importColdList", { listName: "Vorlage-Demo", rows: [{ firstName: "Paul", lastName: "Pur", company: "Pur Dach", email: "paul@versprechen-demo.example" }] });
    const plain = await call("leadops.saveEmailCampaign", { ...base, name: "Vorlage-Demo", audience: { source: "liste", listName: "Vorlage-Demo" }, tree });
    await call("leadops.startEmailCampaign", { id: plain.id }); await call("leadops.runEmailCampaigns");
    const paul = () => getStore().tables.emailCampaignRecipients.find((item) => item.campaignId === plain.id)!; expect(paul().sentCount).toBe(1);
    const first = sentOf(paul().id)[0]; expect(first.bodySource).toBe("vorlage"); expect(String(first.body)).toContain("10 Test-Leads");
    expect((await call("leadops.sentMailPreview", { id: `k${first.id}` })).html).toContain("10 Test-Leads");
    Object.assign(first, { body: null, bodySource: null, createdAt: oldAt }); // so sehen die alten aus
    const oldPreview = await call("leadops.sentMailPreview", { id: `k${first.id}` }); expect(oldPreview.html).toContain("20 Test-Leads"); expect(oldPreview.html).not.toMatch(/\b10 Test-Leads/);
    paul().nextActionAt = new Date(Date.now() - 1000); await call("leadops.runEmailCampaigns"); expect(paul().sentCount).toBe(2);
    const second = sentOf(paul().id)[1]; expect(second.bodySource).toBe("vorlage"); expect(String(second.body)).toContain("20 Test-Leads"); expect(String(second.body)).not.toMatch(/\b10 Test-Leads/);
  });

  it("Posteingang: zu jeder Antwort unsere E-Mails davor (Schritt, Auszug, versprochene Test-Leads), Kategorie der Kampagne; Antwort-Vorschlag nennt dieselbe Zahl", async () => {
    const inbox = await call("leadops.listInbox", { filter: "alle" });
    const hansen = inbox.items.find((item: any) => item.fromEmail === "info@hansen-bedachungen.de");
    expect(hansen).toMatchObject({ campaignName: "Dachdecker Hessen – Erstkontakt", campaignCategoryName: "Photovoltaik" });
    expect(hansen.sentBefore.map((mail: any) => mail.step)).toEqual([2, 1]); // neueste zuerst
    expect(hansen.sentBefore[1]).toMatchObject({ subject: "Mehr Anfragen für Hansen Bedachungen – ohne Risiko", source: "vorlage", testLeads: 20 }); expect(hansen.sentBefore[1].excerpt).toContain("Sehr geehrter Herr Hansen"); expect(hansen.sentBefore[1].excerpt).toContain("20 Test-Leads");
    expect(hansen.sentBefore[0]).toMatchObject({ subject: "Kurze Frage zu Ihrem Bedarf, Peter", testLeads: 20 });
    expect((await call("leadops.sentMailPreview", { id: hansen.sentBefore[1].id })).html).toContain("Hansen Bedachungen");
    const suggestion = await call("leadops.suggestInboxReply", { messageId: hansen.id }); expect(suggestion.text).toContain("20 Test-Leads"); expect(suggestion.text).not.toMatch(/\b10 Test-Leads/);
    const unknown = inbox.items.find((item: any) => item.fromEmail === "m.mayer@solartechnik-mayer.de"); expect(unknown.sentBefore).toEqual([]); expect(unknown.campaignCategoryId).toBeNull();
  });

  it("Interessent aus dem Posteingang: eigene Stufe „Hat Interesse“ der E-Mail-Pipeline wird genommen, Kategorie = die der Kampagne (nicht die erste)", async () => {
    const wp = getStore().tables.leadCategories.find((row) => row.name === "Wärmepumpe")!; const pvCat = getStore().tables.leadCategories.find((row) => row.name === "Photovoltaik")!;
    getStore().tables.emailCampaigns.find((row) => row.name === "Dachdecker Hessen – Erstkontakt")!.leadCategoryIds = [wp.id]; // Kampagne mit Wärmepumpe – Photovoltaik wäre die erste Kategorie
    const stages = await call("leadops.pipelineStages", { source: "email" });
    await call("leadops.savePipelineStages", { source: "email", stages: [stages[0], { key: "hat_interesse", label: "Hat Interesse", hint: "" }, ...stages.slice(1)] });
    const koch = (await call("leadops.listInbox", { filter: "alle" })).items.find((item: any) => item.fromEmail === "kontakt@koch-dach.de"); expect(koch.campaignCategoryName).toBe("Wärmepumpe");
    const made = await call("leadops.createLeadFromInbox", { messageId: koch.id, pipeline: "email", stage: "hat_interesse" });
    expect(getStore().tables.leads.find((row) => row.publicId === made.publicId)).toMatchObject({ pipelineStage: "hat_interesse", categoryId: wp.id });
    expect((await call("leadops.pipelineOverview", { source: "email" })).stages.find((stage: any) => stage.key === "hat_interesse").leads.some((lead: any) => lead.publicId === made.publicId)).toBe(true);
    // unbekannte Stufe → die Interesse-Stufe; gewählte Kategorie hat Vorrang
    const hansen = (await call("leadops.listInbox", { filter: "alle" })).items.find((item: any) => item.fromEmail === "info@hansen-bedachungen.de");
    const other = await call("leadops.createLeadFromInbox", { messageId: hansen.id, pipeline: "email", stage: "gibt_es_nicht", categoryId: pvCat.id });
    expect(getStore().tables.leads.find((row) => row.publicId === other.publicId)).toMatchObject({ pipelineStage: "hat_interesse", categoryId: pvCat.id });
    await call("leadops.savePipelineStages", { source: "email", stages }); getStore().tables.emailCampaigns.find((row) => row.name === "Dachdecker Hessen – Erstkontakt")!.leadCategoryIds = [pvCat.id];
  });

  it("Gesendet: jede Kampagnen-Mail trägt Kategorie und Sparte der Kampagne – Photovoltaik und Wärmepumpe lassen sich trennen", async () => {
    const sent = await call("leadops.listSent", {});
    const dach = sent.items.filter((item: any) => item.campaignName === "Dachdecker Hessen – Erstkontakt"); const strom = sent.items.filter((item: any) => item.campaignName === "Elektriker NRW – Frühjahr");
    expect(dach.length).toBeGreaterThan(0); expect(strom.length).toBeGreaterThan(0);
    expect(dach.every((item: any) => item.sparte?.categoryName === "Photovoltaik" && item.sparte?.sparte === "Photovoltaik")).toBe(true);
    expect(strom.every((item: any) => item.sparte?.categoryName === "Wärmepumpe")).toBe(true);
    expect(sent.items.filter((item: any) => item.kind !== "kampagne").every((item: any) => item.sparte === null)).toBe(true);
  });
});

describe("Oberfläche (Chat-Build): Mails davor im Posteingang, Kategorie-Filter unter „Gesendet“, Erst-E-Mail/Follow-up in der Freigabe, Listen auf der Kampagnen-Karte", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });

  it("Posteingang: Kasten „Davor von uns“ mit Follow-up/Erst-E-Mail, Auszug und versprochenen Test-Leads", async () => {
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=posteingang");
    const view = mount(); await settle(300); await settle(300);
    const hansen = Array.from(view.container.querySelectorAll<HTMLButtonElement>("button.inbox-item")).find((node) => node.textContent?.includes("Hansen"))!; expect(hansen).toBeTruthy();
    await act(async () => { fireEvent.click(hansen); }); await settle(300);
    const prior = view.container.querySelector(".inbox-prior"); expect(prior).toBeTruthy();
    const kinds = () => Array.from(prior!.querySelectorAll(".rv-kind")).map((node) => node.textContent?.trim()); expect(kinds()).toEqual(["Follow-up 2"]); // zuerst nur die letzte E-Mail
    expect(prior!.textContent).toContain("2 E-Mails"); expect(prior!.textContent).toContain("20 Test-Leads versprochen"); expect(prior!.textContent).toContain("Kurze Frage zu Ihrem Bedarf, Peter"); expect(prior!.textContent).toContain("Sehr geehrter Herr Hansen");
    await act(async () => { fireEvent.click(Array.from(prior!.querySelectorAll("button")).find((node) => /alle zeigen/.test(node.textContent ?? ""))!); }); await settle(50);
    expect(kinds()).toEqual(["Follow-up 2", "Erst-E-Mail"]); expect(prior!.textContent).toContain("Mehr Anfragen für Hansen Bedachungen"); // neueste zuerst
    expect(Array.from(prior!.querySelectorAll("button")).filter((node) => /Ansehen/.test(node.textContent ?? "")).length).toBe(2);
    expect(prior!.compareDocumentPosition(view.container.querySelector(".inbox-body")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // der Kasten steht über der Antwort
  });

  it("Gesendet: Auswahl nach Lead-Kategorie mit Zähler, jede Zeile zeigt ihre Kategorie, Auswahl filtert", async () => {
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=posteingang");
    const view = mount(); await settle(300); await settle(300);
    const sentFolder = Array.from(view.container.querySelectorAll<HTMLButtonElement>(".inbox-folders button")).find((node) => node.textContent?.trim().startsWith("Gesendet"))!;
    await act(async () => { fireEvent.click(sentFolder); }); await settle(300); await settle(200);
    const select = view.container.querySelector<HTMLSelectElement>('select[aria-label="Lead-Kategorie"]'); expect(select).toBeTruthy();
    const options = Array.from(select!.options).map((option) => option.textContent ?? ""); expect(options[0]).toBe("Alle Kategorien"); expect(options.some((text) => /^☀️ Photovoltaik \(\d+\)$/.test(text))).toBe(true); expect(options.some((text) => /^♨️ Wärmepumpe \(\d+\)$/.test(text))).toBe(true);
    const tags = () => Array.from(view.container.querySelectorAll(".inbox-sent-sparte")).map((node) => node.textContent?.trim());
    expect(tags()).toContain("☀️ Photovoltaik"); expect(tags()).toContain("♨️ Wärmepumpe");
    await act(async () => { fireEvent.change(select!, { target: { value: "Wärmepumpe" } }); }); await settle(100);
    expect(tags().length).toBeGreaterThan(0); expect(tags().every((text) => text === "♨️ Wärmepumpe")).toBe(true);
  });

  it("Kampagnen-Karte: Emoji ganz links, Listen mit 📋 und „+N weitere“ ab der dritten Liste", async () => {
    const campaign = getStore().tables.emailCampaigns.find((row) => row.name === "Dachdecker Hessen – Erstkontakt")!;
    campaign.audience = { source: "liste", listNames: ["Dachdecker Hessen", "Solarteure Hessen", "Elektriker NRW", "Fensterbauer Süd"] } as never;
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const view = mount(); await settle(300); await settle(300);
    const card = Array.from(view.container.querySelectorAll<HTMLElement>(".cl-card")).find((item) => item.textContent?.includes("Dachdecker Hessen – Erstkontakt"))!;
    expect(card.querySelector(".cl-title > :first-child")?.classList.contains("sparte-emoji")).toBe(true); expect(card.querySelector(".cl-title .sparte-emoji")?.textContent).toBe("☀️");
    const lists = card.querySelector(".cl-lists"); expect(lists).toBeTruthy(); expect(lists!.getAttribute("aria-label")).toBe("4 Listen in dieser Kampagne");
    const chips = Array.from(lists!.querySelectorAll(".cl-list-chip:not(.is-more)")).map((node) => node.textContent?.trim() ?? ""); expect(chips.length).toBe(2); expect(chips[0]).toContain("📋"); expect(chips[0]).toContain("Dachdecker Hessen"); expect(chips[1]).toContain("Solarteure Hessen");
    const more = lists!.querySelector<HTMLButtonElement>(".cl-list-chip.is-more"); expect(more?.textContent).toContain("+2 weitere");
    // eine Kampagne mit genau einer Liste: ein Chip, kein Menü
    const other = Array.from(view.container.querySelectorAll<HTMLElement>(".cl-card")).find((item) => item.textContent?.includes("Solarteure Hessen – persönlich"))!;
    expect(other.querySelectorAll(".cl-list-chip:not(.is-more)").length).toBe(1); expect(other.querySelector(".cl-list-chip.is-more")).toBeNull();
  });

  it("Freigabe: Filter Erste/Follow-ups, Schild je Entwurf und Hinweis „davor von uns … 20 Test-Leads“ im Editor", async () => {
    const { starterBlocks } = await import("../../../../shared/email-design");
    await call("leadops.importColdList", { listName: "Freigabe-UI", rows: [{ firstName: "Vera", lastName: "Versprechen", company: "Versprechen Wärme", email: "vera@freigabe-ui.example" }, { firstName: "Nils", lastName: "Neu", company: "Neu Solar", email: "nils@freigabe-ui.example" }] });
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste an {{firma}}", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait", hours: 1, next: "m2" }, { id: "m2", type: "send", label: "Kurze Nachfrage", subject: "Nachfrage {{firma}}", blocks: starterBlocks("nachfassen"), next: null }] };
    const saved = await call("leadops.saveEmailCampaign", { id: null, name: "Freigabe-UI", fromName: "T", fromEmail: "t@t.de", replyTo: null, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 50, audience: { source: "liste", listName: "Freigabe-UI" }, tree, kiModus: "freigabe", kiAnsatz: "frei" });
    await call("leadops.startEmailCampaign", { id: saved.id }); await call("leadops.runEmailCampaigns");
    const rows = () => getStore().tables.emailCampaignRecipients.filter((item) => item.campaignId === saved.id).sort((a, b) => a.id - b.id);
    await call("leadops.saveCampaignDraft", { recipientId: rows()[0].id, subject: "Persönlich für Versprechen Wärme", text: "Sehr geehrte Frau Versprechen,\n\nzum Kennenlernen stellen wir Ihnen 20 Test-Leads kostenlos bereit.\n\nVielen Dank", approve: true });
    await call("leadops.runEmailCampaigns"); rows()[0].nextActionAt = new Date(Date.now() - 1000); await call("leadops.runEmailCampaigns");
    expect(rows()[0]).toMatchObject({ sentCount: 1, draftNodeId: "m2" }); expect(rows()[1]).toMatchObject({ sentCount: 0, draftNodeId: "m1" });
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const view = mount(); await settle(300); await settle(300);
    const open = Array.from(view.container.querySelectorAll<HTMLButtonElement>(".cl-card .cl-name")).find((node) => node.textContent?.includes("Freigabe-UI"))!;
    await act(async () => { fireEvent.click(open); }); await settle(300); await settle(200);
    const go = Array.from(view.container.querySelectorAll<HTMLButtonElement>(".rv-banner button")).find((node) => /Jetzt freigeben/.test(node.textContent ?? ""))!; expect(go).toBeTruthy();
    await act(async () => { fireEvent.click(go); }); await settle(300); await settle(300);
    const kinds = () => Array.from(view.container.querySelectorAll(".rv-list .rv-step .rv-kind")).map((node) => node.textContent?.trim());
    expect(kinds().sort()).toEqual(["Erst-E-Mail", "Follow-up 2"]);
    const kindBar = view.container.querySelector(".cd-filters.is-kind"); expect(kindBar).toBeTruthy();
    const kindButtons = Array.from(kindBar!.querySelectorAll<HTMLButtonElement>("button")).map((node) => node.textContent?.trim() ?? ""); expect(kindButtons.some((text) => text.startsWith("Erst-E-Mails"))).toBe(true); expect(kindButtons.some((text) => text.startsWith("Follow-ups"))).toBe(true);
    await act(async () => { fireEvent.click(Array.from(kindBar!.querySelectorAll<HTMLButtonElement>("button")).find((node) => /Follow-ups/.test(node.textContent ?? ""))!); }); await settle(100);
    expect(kinds()).toEqual(["Follow-up 2"]);
    await act(async () => { fireEvent.click(view.container.querySelector<HTMLButtonElement>(".rv-list .rv-item")!); }); await settle(300);
    const head = view.container.querySelector(".rv-editor-kind"); expect(head).toBeTruthy(); expect(head!.textContent).toContain("Follow-up"); expect(head!.textContent).toContain("davor von uns"); expect(head!.textContent).toContain("Persönlich für Versprechen Wärme"); expect(head!.textContent).toContain("20 Test-Leads");
    expect(view.container.querySelector<HTMLTextAreaElement>(".rv-editor textarea")?.value).toContain("20 Test-Leads"); // der Entwurf selbst nennt wieder 20
  });
});
