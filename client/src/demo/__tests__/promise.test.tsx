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

  it("Posteingang: Schriftwechsel wie im Postfach – unsere E-Mails komplett (älteste zuerst), dann die Antwort; jede E-Mail zuklappbar", async () => {
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=posteingang");
    const view = mount(); await settle(300); await settle(300);
    const hansen = Array.from(view.container.querySelectorAll<HTMLButtonElement>("button.inbox-item")).find((node) => node.textContent?.includes("Hansen"))!; expect(hansen).toBeTruthy();
    await act(async () => { fireEvent.click(hansen); }); await settle(400); await settle(300);
    const thread = view.container.querySelector(".thread"); expect(thread).toBeTruthy(); expect(thread!.textContent).toContain("2 E-Mails an info@hansen-bedachungen.de");
    const mails = Array.from(thread!.querySelectorAll<HTMLElement>(".thread-mail")); expect(mails.length).toBe(2);
    expect(mails.map((mail) => mail.querySelector(".rv-kind")?.textContent?.trim())).toEqual(["Erst-E-Mail", "Follow-up 2"]); // älteste zuerst, wie ein Postfach
    // zugeklappt: Absender und Empfänger sauber übereinander (Von / An), darunter Betreff und Anfang des Textes – keine ganze E-Mail
    expect(mails.every((mail) => mail.classList.contains("is-closed") && !mail.querySelector("iframe"))).toBe(true);
    const lines = (mail: HTMLElement) => Array.from(mail.querySelectorAll(".thread-line")).map((line) => line.textContent?.replace(/\s+/g, " ").trim());
    expect(lines(mails[0])).toEqual(["VonTanesco Digitalvertrieb@tanesco.digital", "Aninfo@hansen-bedachungen.de20 Test-Leads versprochen"]);
    expect(mails[0].querySelector(".thread-collapsed strong")?.textContent).toBe("Mehr Anfragen für Hansen Bedachungen – ohne Risiko"); expect(mails[1].querySelector(".thread-collapsed strong")?.textContent).toBe("Kurze Frage zu Ihrem Bedarf, Peter");
    // aufklappen: die ganze E-Mail, wie sie rausging
    await act(async () => { fireEvent.click(mails[0].querySelector<HTMLButtonElement>(".thread-mail-head")!); }); await settle(400); await settle(300);
    expect(mails[0].classList.contains("is-open")).toBe(true); expect(mails[0].querySelector(".thread-subject")?.textContent).toBe("Mehr Anfragen für Hansen Bedachungen – ohne Risiko");
    const frame = mails[0].querySelector<HTMLIFrameElement>("iframe.thread-frame"); expect(frame).toBeTruthy(); expect(frame!.getAttribute("srcdoc")).toContain("Hansen"); expect(frame!.getAttribute("srcdoc")).toContain("20 Test-Leads");
    // danach die Antwort – mit demselben Kopf (Von / An)
    const reply = view.container.querySelector<HTMLElement>(".thread-mail.is-reply"); expect(reply).toBeTruthy(); expect(lines(reply!)).toEqual(["VonPeter Hanseninfo@hansen-bedachungen.de", "AnunsAntwort"]);
    expect(thread!.compareDocumentPosition(view.container.querySelector(".inbox-body")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // wieder zuklappen
    await act(async () => { fireEvent.click(mails[0].querySelector<HTMLButtonElement>(".thread-mail-head")!); }); await settle(50);
    expect(mails[0].classList.contains("is-closed")).toBe(true); expect(mails[0].querySelector("iframe")).toBeNull();
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

  it("Kampagnen-Karte: Kategorie-Schild ganz links; eine Liste direkt lesbar, ab zwei Listen ein Klapp-Menü mit allen Namen und Zahlen", async () => {
    const campaign = getStore().tables.emailCampaigns.find((row) => row.name === "Dachdecker Hessen – Erstkontakt")!;
    campaign.audience = { source: "liste", listNames: ["Dachdecker Hessen", "PV_WP_Aroundhome_Vielkaeufer_ab_100_Leads_Monat", "Elektriker NRW"] } as never;
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const view = mount(); await settle(300); await settle(300);
    const card = Array.from(view.container.querySelectorAll<HTMLElement>(".cl-card")).find((item) => item.textContent?.includes("Dachdecker Hessen – Erstkontakt"))!;
    expect(card.querySelector(".cl-title > :first-child")?.classList.contains("sparte-badge")).toBe(true); expect(card.querySelector(".cl-title .sparte-badge")?.textContent).toBe("☀️Photovoltaik"); // ganze Kategorie links vom Namen
    const lists = card.querySelector(".cl-lists"); expect(lists).toBeTruthy(); expect(lists!.getAttribute("aria-label")).toBe("3 Listen in dieser Kampagne");
    expect(lists!.querySelectorAll(".cl-list-chip").length).toBe(1); // nur der Knopf – keine abgeschnittenen Namen auf der Karte
    const trigger = lists!.querySelector<HTMLButtonElement>(".cl-list-chip.is-menu")!; expect(trigger.textContent).toContain("📋"); expect(trigger.textContent).toContain("3 Listen"); expect(trigger.querySelector("small")?.textContent).toMatch(/^\d+$/); // Summe mit E-Mail
    await act(async () => { fireEvent.keyDown(trigger, { key: "ArrowDown" }); }); await settle(200); // öffnet das Menü (wie ein Klick)
    const menu = document.querySelector(".cl-lists-menu"); expect(menu).toBeTruthy();
    const names = Array.from(menu!.querySelectorAll(".cl-lists-menu-item strong")).map((node) => node.textContent); expect(names).toEqual(["Dachdecker Hessen", "PV_WP_Aroundhome_Vielkaeufer_ab_100_Leads_Monat", "Elektriker NRW"]); // volle Namen
    expect(menu!.querySelector(".cl-lists-menu-item small")?.textContent).toMatch(/mit E-Mail · \d+ Kontakte/); expect(menu!.textContent).toContain("3 Listen in dieser Kampagne");
    // eine Liste: der Name steht direkt auf der Karte, kein Menü
    const other = Array.from(view.container.querySelectorAll<HTMLElement>(".cl-card")).find((item) => item.textContent?.includes("Solarteure Hessen – persönlich"))!;
    expect(other.querySelectorAll(".cl-list-chip").length).toBe(1); expect(other.querySelector(".cl-list-chip.is-single .cl-list-name")?.textContent).toBe("Solarteure Hessen"); expect(other.querySelector(".cl-list-chip.is-menu")).toBeNull();
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

describe("Kampagnen zusammenführen (Chat-Build)", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });
  const sendWindow = { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" };
  async function setup() {
    const { starterBlocks } = await import("../../../../shared/email-design");
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste an {{firma}}", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait", hours: 1, next: "m2" }, { id: "m2", type: "send", label: "Kurze Nachfrage", subject: "Nachfrage {{firma}}", blocks: starterBlocks("nachfassen"), next: null }] };
    await call("leadops.importColdList", { listName: "Ziel-Liste", rows: [{ firstName: "Zoe", lastName: "Ziel", company: "Ziel GmbH", email: "zoe@merge-demo.example" }] });
    await call("leadops.importColdList", { listName: "Quell-Liste", rows: [{ firstName: "Bert", lastName: "Bereit", company: "Bereit GmbH", email: "bert@merge-demo.example" }, { firstName: "Nils", lastName: "Neu", company: "Neu GmbH", email: "nils@merge-demo.example" }] });
    const base = { id: null, fromName: "Thomas Kurzbach", fromEmail: "kontakt@tanescodigital.de", replyTo: null, design: {}, sendWindow, abSplit: 50, tree, kiModus: "freigabe" };
    const target = await call("leadops.saveEmailCampaign", { ...base, name: "Oberste – Drittanbieter KI", audience: { source: "liste", listName: "Ziel-Liste" }, kiAnsatz: "drittanbieter" });
    const source = await call("leadops.saveEmailCampaign", { ...base, name: "Quelle – frei", audience: { source: "liste", listName: "Quell-Liste" }, kiAnsatz: "frei" });
    await call("leadops.startEmailCampaign", { id: target.id }); await call("leadops.startEmailCampaign", { id: source.id }); await call("leadops.runEmailCampaigns");
    const rows = (campaignId: number) => getStore().tables.emailCampaignRecipients.filter((row) => row.campaignId === campaignId).sort((a, b) => a.id - b.id);
    const { insert } = await import("../store"); insert(getStore(), "emailCampaignRecipients", { tenantId: rows(target.id)[0].tenantId, campaignId: source.id, leadId: null, email: "zoe@merge-demo.example", name: "Zoe Ziel", company: "Ziel GmbH", token: `t${Date.now()}`, nodeId: "m1", nextActionAt: new Date(), status: "wartet", sentCount: 0, lastSentAt: null, openedAt: null, clickedAt: null, repliedAt: null, variant: null, clickedUrls: [], bouncedAt: null, lastError: null, createdAt: new Date() }); // Zoe steckt in beiden
    const bert = rows(source.id).find((row) => row.email === "bert@merge-demo.example")!;
    await call("leadops.saveCampaignDraft", { recipientId: bert.id, subject: "Erste an Bereit GmbH", text: "Sehr geehrter Herr Bereit,\n\nzum Kennenlernen: 20 Test-Leads kostenlos.\n\nVielen Dank", approve: true }); await call("leadops.runEmailCampaigns");
    expect(bert.sentCount).toBe(1); expect(bert.nodeId).toBe("w1");
    return { target, source, rows, bert };
  }

  it("Kontakte kommen mit Stand und Verlauf ins Ziel, Doppelte nur einmal, Quelle ins Archiv – Wartende laufen im Ziel weiter (mit der versprochenen Zahl)", async () => {
    const { target, source, rows, bert } = await setup();
    await expect(call("leadops.mergeEmailCampaigns", { targetId: target.id, sourceIds: [target.id] })).rejects.toThrow(/mindestens eine andere/);
    const result = await call("leadops.mergeEmailCampaigns", { targetId: target.id, sourceIds: [source.id] });
    expect(result).toMatchObject({ targetId: target.id, moved: 2, duplicates: 1, replaced: 0, finished: 0, sources: [{ id: source.id, name: "Quelle – frei", moved: 2, duplicates: 1 }] }); // Zoe war schon im Ziel (beide ohne Versand → der Eintrag im Ziel bleibt)
    expect(rows(target.id).map((row) => row.email).sort()).toEqual(["bert@merge-demo.example", "nils@merge-demo.example", "zoe@merge-demo.example"]); expect(rows(source.id)).toEqual([]);
    expect(getStore().tables.emailCampaignRecipients.find((row) => row.id === bert.id)).toMatchObject({ campaignId: target.id, nodeId: "w1", sentCount: 1 });
    expect(getStore().tables.emailCampaignEvents.filter((event) => event.recipientId === bert.id).every((event) => event.campaignId === target.id)).toBe(true);
    const archived = getStore().tables.emailCampaigns.find((row) => row.id === source.id)!; expect(archived.status).toBe("beendet"); expect(archived.archivedAt).toBeTruthy();
    const { audienceLists } = await import("../../../../shared/email-campaigns"); expect(audienceLists(getStore().tables.emailCampaigns.find((row) => row.id === target.id)!.audience as never)).toEqual(["Ziel-Liste", "Quell-Liste"]);
    expect(getStore().tables.activityLog.some((row) => row.title === "Kampagne „Quelle – frei“ in „Oberste – Drittanbieter KI“ zusammengeführt")).toBe(true);
    const detail = await call("leadops.getEmailCampaign", { id: target.id }); expect(detail.stats).toMatchObject({ total: 3, sent: 1 });
    // Bert wartet im Ziel weiter: Wartezeit um → Follow-up-Entwurf im Ansatz des Ziels, wieder mit 20 Test-Leads
    getStore().tables.emailCampaignRecipients.find((row) => row.id === bert.id)!.nextActionAt = new Date(Date.now() - 1000); await call("leadops.runEmailCampaigns");
    const after = getStore().tables.emailCampaignRecipients.find((row) => row.id === bert.id)!; expect(after).toMatchObject({ campaignId: target.id, nodeId: "m2", draftNodeId: "m2", draftState: "entwurf", draftApproach: "drittanbieter" }); expect(String(after.draftText)).toContain("20 Test-Leads");
    const queue = await call("leadops.campaignReviewQueue", { campaignId: target.id }); expect(queue.items.find((item: any) => item.id === bert.id)).toMatchObject({ step: 2, followUp: true, testLeads: 20 });
  });

  it("Oberfläche: „Kampagnen zusammenführen …“ im Karten-Menü öffnet die Auswahl, Bestätigung führt zusammen, die Quelle verschwindet aus der Übersicht", async () => {
    const { target, source } = await setup();
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const view = mount(); await settle(300); await settle(300);
    const card = Array.from(view.container.querySelectorAll<HTMLElement>(".cl-card")).find((item) => item.querySelector(".cl-name")?.textContent?.includes("Oberste – Drittanbieter KI"))!; expect(card).toBeTruthy();
    const more = card.querySelector<HTMLButtonElement>('button[aria-label="Weitere Aktionen"]')!; await act(async () => { fireEvent.keyDown(more, { key: "ArrowDown" }); }); await settle(150);
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((node) => /Kampagnen zusammenführen/.test(node.textContent ?? ""))!; expect(item).toBeTruthy();
    await act(async () => { fireEvent.click(item); }); await settle(300);
    const dialog = document.querySelector('[role="dialog"]'); expect(dialog).toBeTruthy(); expect(dialog!.textContent).toContain("Kampagnen in „Oberste – Drittanbieter KI“ zusammenführen"); expect(dialog!.textContent).toContain("Jeder macht am gleichen Schritt weiter");
    const rowsIn = Array.from(dialog!.querySelectorAll<HTMLElement>(".merge-rows .list-picker-row")); expect(rowsIn.some((row) => row.textContent?.includes("Quelle – frei"))).toBe(true); expect(rowsIn.some((row) => row.textContent?.includes("Oberste – Drittanbieter KI"))).toBe(false); // das Ziel selbst steht nicht zur Wahl
    const sourceRow = rowsIn.find((row) => row.textContent?.includes("Quelle – frei"))!; expect(sourceRow.textContent).toContain("3 Kontakte · 1 angeschrieben");
    await act(async () => { fireEvent.click(sourceRow.querySelector<HTMLButtonElement>(".list-picker-main")!); }); await settle(50);
    expect(dialog!.textContent).toContain("1 Kampagne · 3 Kontakte");
    await act(async () => { fireEvent.click(Array.from(dialog!.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent?.trim() === "Zusammenführen")!); }); await settle(100);
    expect(document.querySelector(".app-confirm-text")?.textContent).toContain("3 Kontakte aus „Quelle – frei“ in „Oberste – Drittanbieter KI“ übernehmen?");
    await act(async () => { fireEvent.click(document.querySelector<HTMLButtonElement>(".app-confirm-ok")!); }); await settle(400); await settle(300);
    expect(getStore().tables.emailCampaigns.find((row) => row.id === source.id)?.archivedAt).toBeTruthy(); expect(getStore().tables.emailCampaignRecipients.filter((row) => row.campaignId === target.id).length).toBe(3);
    expect(Array.from(view.container.querySelectorAll(".cl-card .cl-name")).some((node) => node.textContent?.includes("Quelle – frei"))).toBe(false); // im Archiv, nicht mehr in der Übersicht
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("Vertriebspipeline: Lead-Kategorien (Chat-Build)", () => {
  beforeAll(() => resetStore());
  it("liefert alle Kategorien im Ausschnitt mit Anzahl und filtert auf dem Server – unabhängig von der Kartenzahl je Spalte", async () => {
    const board = await call("leadops.pipelineOverview", { source: "alle" });
    expect(board.categories.length).toBeGreaterThanOrEqual(2); const pv = board.categories.find((item: any) => item.name === "Photovoltaik"); expect(pv).toBeTruthy(); expect(pv.count).toBeGreaterThan(0);
    const other = board.categories.find((item: any) => item.name !== "Photovoltaik"); expect(other.count).toBeGreaterThan(0);
    const only = await call("leadops.pipelineOverview", { source: "alle", categoryId: other.id, limitPerStage: 1 });
    expect(only.totals.leads).toBe(other.count); expect(only.stages.flatMap((stage: any) => stage.leads).every((lead: any) => lead.categoryId === other.id)).toBe(true);
    expect(only.categories.find((item: any) => item.id === other.id).count).toBe(other.count); expect(only.categories.some((item: any) => item.id === pv.id)).toBe(true); // Auswahl bleibt vollständig
  });
  it("„Webseite geklickt“: Kontakte, die in einer Kampagnen-E-Mail einen Link geklickt haben", async () => {
    const board = await call("leadops.pipelineOverview", { source: "email" }); expect(board.smartLists.geklickt).toBeGreaterThan(0); expect(board.smartLists.geklickt).toBeLessThanOrEqual(board.smartLists.geoeffnet);
    const clicked = await call("leadops.pipelineOverview", { source: "email", campaignId: "__geklickt" }); expect(clicked.totals.leads).toBe(board.smartLists.geklickt);
    const clickedLeadIds = new Set(getStore().tables.emailCampaignRecipients.filter((row) => row.leadId && row.clickedAt).map((row) => row.leadId));
    expect(clicked.stages.flatMap((stage: any) => stage.leads).every((lead: any) => clickedLeadIds.has(lead.id))).toBe(true);
  });
});

describe("Pipeline-Karte: Kategorie wechseln (Chat-Build)", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });
  it("Klick auf das Kategorie-Schild öffnet die Auswahl, die Karte bekommt die neue Kategorie (mit Vermerk im Verlauf)", async () => {
    window.history.replaceState(null, "", "/?page=Vertriebspipeline&quelle=email");
    const view = mount(); await settle(400); await settle(400);
    const card = Array.from(view.container.querySelectorAll<HTMLElement>(".pipeline-card")).find((item) => item.querySelector(".cat-pick-trigger"))!; expect(card).toBeTruthy();
    const trigger = card.querySelector<HTMLButtonElement>(".cat-pick-trigger")!; const before = trigger.textContent?.trim() ?? ""; expect(before).toContain("Photovoltaik");
    await act(async () => { fireEvent.keyDown(trigger, { key: "ArrowDown" }); }); await settle(300);
    const menu = document.querySelector(".cat-pick-menu"); expect(menu).toBeTruthy(); expect(menu!.textContent).toContain("Kategorie wechseln");
    const items = Array.from(menu!.querySelectorAll<HTMLElement>(".cat-pick-item")); expect(items.length).toBeGreaterThan(2); expect(items.find((item) => item.classList.contains("is-current"))?.textContent).toContain("Photovoltaik");
    const target = items.find((item) => item.textContent?.includes("Alarmanlagen"))!; expect(target).toBeTruthy();
    await act(async () => { fireEvent.click(target); }); await settle(400); await settle(300);
    const publicId = (await call("leadops.pipelineOverview", { source: "email" })).stages.flatMap((stage: any) => stage.leads).find((lead: any) => lead.categoryName === "Alarmanlagen")?.publicId; expect(publicId).toBeTruthy();
    const history = await call("leadops.pipelineHistory", { publicId }); expect(history.some((event: any) => /Kategorie geändert: „Alarmanlagen“ \(vorher „Photovoltaik“\)/.test(event.note ?? ""))).toBe(true);
    expect(Array.from(view.container.querySelectorAll(".cat-pick-trigger")).some((node) => node.textContent?.includes("Alarmanlagen"))).toBe(true); // Karte zeigt die neue Kategorie
  });
});

describe("Reiter „Verlauf“ (Chat-Build)", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });
  it("heißt „Verlauf“ und hat darin „Upload“ und „Früheren Stand wiederherstellen“; im Kontakte-Reiter gibt es den Knopf nicht mehr", async () => {
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=verlauf");
    const view = mount(); await settle(300); await settle(300);
    const tabs = Array.from(view.container.querySelectorAll<HTMLButtonElement>(".email-tabs button")).map((node) => node.textContent?.trim() ?? "");
    expect(tabs.some((text) => text.startsWith("Verlauf"))).toBe(true); expect(tabs.some((text) => text.startsWith("Upload-Verlauf"))).toBe(false);
    const parts = view.container.querySelector(".history-parts"); expect(parts).toBeTruthy();
    const buttons = Array.from(parts!.querySelectorAll<HTMLButtonElement>("button")); expect(buttons.map((node) => node.textContent?.trim())).toEqual(["Upload", "Früheren Stand wiederherstellen"]); expect(buttons[0].getAttribute("aria-selected")).toBe("true");
    await act(async () => { fireEvent.click(buttons[1]); }); await settle(300);
    expect(view.container.querySelector(".restore-inline")).toBeTruthy(); expect(view.container.querySelector(".restore-when input")).toBeTruthy(); expect(view.container.textContent).toContain("Stand von");
    expect(document.querySelector('[role="dialog"]')).toBeNull(); // direkt auf der Seite, kein Fenster
    cleanup();
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kontakte");
    const contacts = mount(); await settle(300); await settle(300);
    expect(contacts.container.querySelector(".email-leads-restore")).toBeNull(); expect(contacts.container.textContent).not.toContain("Früheren Stand wiederherstellen");
  });
});
