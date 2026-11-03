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

  it("Hausnotruf (alle Sparten außer PV & WP): Follow-up 20 bleibt 20 (gespeicherter Text oder alte Mail ohne Text), neue Kontakte 10; Freigabe-Liste mit Schritt und E-Mail davor", async () => {
    const { starterBlocks } = await import("../../../../shared/email-design"); const { TEST_OFFER_CHANGED_AT } = await import("../../../../shared/email-campaigns");
    await call("leadops.importColdList", { listName: "Versprechen-Demo", rows: [{ firstName: "Vera", lastName: "Versprechen", company: "Versprechen Wärme", email: "vera@versprechen-demo.example" }, { firstName: "Nils", lastName: "Neu", company: "Neu Solar", email: "nils@versprechen-demo.example" }, { firstName: "Olga", lastName: "Alt", company: "Alt Heizung", email: "olga@versprechen-demo.example" }] });
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste an {{firma}}", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait", hours: 1, next: "m2" }, { id: "m2", type: "send", label: "Kurze Nachfrage", subject: "Nachfrage {{firma}}", blocks: starterBlocks("nachfassen"), next: null }] };
    const base = { id: null, fromName: "T", fromEmail: "t@t.de", replyTo: null, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 50 };
    const saved = await call("leadops.saveEmailCampaign", { ...base, name: "Versprechen-Demo", leadSparte: "Hausnotruf", audience: { source: "liste", listName: "Versprechen-Demo" }, tree, kiModus: "freigabe", kiAnsatz: "frei" });
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
    expect(String(nils2.draftText)).toContain("kostenlos und unverbindlich"); expect([vera2, nils2, olga2].every((row) => !/lange Bindung|Vertragsbindung/.test(String(row.draftText)))).toBe(true); // Follow-up: Test-Leads als Geschenk
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
    const plain = await call("leadops.saveEmailCampaign", { ...base, name: "Vorlage-Demo", leadSparte: "Hausnotruf", audience: { source: "liste", listName: "Vorlage-Demo" }, tree });
    await call("leadops.startEmailCampaign", { id: plain.id }); await call("leadops.runEmailCampaigns");
    const paul = () => getStore().tables.emailCampaignRecipients.find((item) => item.campaignId === plain.id)!; expect(paul().sentCount).toBe(1);
    const first = sentOf(paul().id)[0]; expect(first.bodySource).toBe("vorlage"); expect(String(first.body)).toContain("10 Test-Leads");
    expect((await call("leadops.sentMailPreview", { id: `k${first.id}` })).html).toContain("10 Test-Leads");
    Object.assign(first, { body: null, bodySource: null, createdAt: oldAt }); // so sehen die alten aus
    const oldPreview = await call("leadops.sentMailPreview", { id: `k${first.id}` }); expect(oldPreview.html).toContain("20 Test-Leads"); expect(oldPreview.html).not.toMatch(/\b10 Test-Leads/);
    paul().nextActionAt = new Date(Date.now() - 1000); await call("leadops.runEmailCampaigns"); expect(paul().sentCount).toBe(2);
    const second = sentOf(paul().id)[1]; expect(second.bodySource).toBe("vorlage"); expect(String(second.body)).toContain("20 Test-Leads"); expect(String(second.body)).not.toMatch(/\b10 Test-Leads/);
  });

  it("PV & WP: neue Kontakte bekommen 20 Test-Leads (KI-Entwurf, Vorlage); jedes Follow-up nennt dieselbe Zahl wie die E-Mail davor (20 bleibt 20, 10 aus der 10er-Zeit bleibt 10, 30 bleibt 30); ein eigener Text behält seine Zahl", async () => {
    const { starterBlocks } = await import("../../../../shared/email-design"); const { TEST_OFFER_CHANGED_AT } = await import("../../../../shared/email-campaigns");
    await call("leadops.importColdList", { listName: "Energie-Demo", rows: [{ firstName: "Erik", lastName: "Energie", company: "Energie Solar", email: "erik@energie-demo.example" }, { firstName: "Hanna", lastName: "Hand", company: "Hand Wärme", email: "hanna@energie-demo.example" }, { firstName: "Frida", lastName: "Früher", company: "Früher Solar", email: "frida@energie-demo.example" }] });
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste an {{firma}}", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait", hours: 1, next: "m2" }, { id: "m2", type: "send", label: "Kurze Nachfrage", subject: "Nachfrage {{firma}}", blocks: starterBlocks("nachfassen"), next: null }] };
    const base = { id: null, fromName: "T", fromEmail: "t@t.de", replyTo: null, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 50 };
    const saved = await call("leadops.saveEmailCampaign", { ...base, name: "Energie-Demo", leadSparte: "Photovoltaik & Wärmepumpe", audience: { source: "liste", listName: "Energie-Demo" }, tree, kiModus: "freigabe", kiAnsatz: "frei" });
    const stored = getStore().tables.emailCampaigns.find((row) => row.id === saved.id)!; const startText = JSON.stringify(stored.tree);
    expect(startText).toContain("20 Test-Leads"); expect(startText).not.toMatch(/\b10 Test-Leads/); // Vorlage der Kampagne: 20
    const rows = () => getStore().tables.emailCampaignRecipients.filter((item) => item.campaignId === saved.id).sort((a, b) => a.id - b.id);
    // Frida: Erst-E-Mail aus der 10er-Zeit (29.10.–01.11.) – mit gespeichertem Text „10 Test-Leads“
    await call("leadops.startEmailCampaign", { id: saved.id });
    const frida = rows()[2]; const tenAt = new Date(TEST_OFFER_CHANGED_AT.getTime() + 86_400_000);
    getStore().tables.emailCampaignEvents.push({ id: 99911, tenantId: frida.tenantId, campaignId: saved.id, recipientId: frida.id, nodeId: "m1", kind: "gesendet", subject: "Erste an Früher Solar", note: "E-Mail „Erste“ gesendet", body: "Sehr geehrte Frau Früher,\n\nzum Kennenlernen stellen wir Ihnen 10 Test-Leads kostenlos bereit.\n\nVielen Dank", bodySource: "ki", createdAt: tenAt } as never, { id: 99912, tenantId: frida.tenantId, campaignId: saved.id, recipientId: frida.id, nodeId: "w1", kind: "gewartet", subject: null, note: "Wartet 1 Stunden", body: null, bodySource: null, createdAt: new Date(tenAt.getTime() + 1000) } as never);
    Object.assign(frida, { sentCount: 1, nodeId: "w1", lastSentAt: tenAt, nextActionAt: new Date(Date.now() - 1000), draftState: null, draftNodeId: null, draftSubject: null, draftText: null, draftOptions: null });
    await call("leadops.runEmailCampaigns");
    const [erik, hanna, frida1] = rows();
    expect(String(erik.draftText)).toContain("20 Test-Leads"); expect(String(erik.draftText)).not.toMatch(/\b10 Test-Leads/); // KI-Entwurf: 20
    expect(frida1).toMatchObject({ draftNodeId: "m2", draftState: "entwurf" }); expect(String(frida1.draftText)).toContain("10 Test-Leads"); expect(String(frida1.draftText)).not.toMatch(/\b20 Test-Leads/); // ihr wurden 10 genannt → wieder 10
    const queue = await call("leadops.campaignReviewQueue", { campaignId: saved.id });
    expect(queue.items.find((item: any) => item.id === erik.id)).toMatchObject({ step: 1, followUp: false, testLeads: 20 });
    expect(queue.items.find((item: any) => item.id === frida1.id)).toMatchObject({ step: 2, followUp: true, testLeads: 10, promisedBefore: 10 });
    // Erik: KI-Entwurf freigeben → geht mit 20 raus; Hanna: eigener Text mit 30 → bleibt 30; Frida: Follow-up wieder mit 10
    await call("leadops.saveCampaignDraft", { recipientId: erik.id, subject: String(erik.draftSubject), text: String(erik.draftText), approve: true });
    await call("leadops.saveCampaignDraft", { recipientId: hanna.id, subject: "Persönlich für Hand Wärme", text: "Sehr geehrte Frau Hand,\n\nzum Kennenlernen stellen wir Ihnen 30 Test-Leads kostenlos bereit.\n\nVielen Dank", approve: true });
    await call("leadops.saveCampaignDraft", { recipientId: frida1.id, subject: String(frida1.draftSubject), text: String(frida1.draftText), approve: true });
    await call("leadops.runEmailCampaigns");
    const sentOf = (recipientId: number) => getStore().tables.emailCampaignEvents.filter((event) => event.recipientId === recipientId && event.kind === "gesendet").sort((a, b) => a.id - b.id);
    expect(String(sentOf(erik.id)[0].body)).toContain("20 Test-Leads"); expect(String(sentOf(hanna.id)[0].body)).toContain("30 Test-Leads"); const fridaFollow = sentOf(frida1.id).find((event) => event.nodeId === "m2"); expect(String(fridaFollow?.body)).toContain("10 Test-Leads"); expect(String(fridaFollow?.body)).not.toMatch(/\b20 Test-Leads/);
    // Follow-ups: Erik wieder 20, Hanna wieder ihre 30 – immer dieselbe Zahl wie davor
    for (const row of rows()) row.nextActionAt = new Date(Date.now() - 1000);
    await call("leadops.runEmailCampaigns");
    const [erik2, hanna2] = rows();
    expect(String(erik2.draftText)).toContain("20 Test-Leads"); expect(String(hanna2.draftText)).toContain("30 Test-Leads"); expect(String(hanna2.draftText)).not.toMatch(/\b(10|20) Test-Leads/);
    const queue2 = await call("leadops.campaignReviewQueue", { campaignId: saved.id });
    expect(queue2.items.find((item: any) => item.id === erik.id)).toMatchObject({ step: 2, testLeads: 20, promisedBefore: 20 }); expect(queue2.items.find((item: any) => item.id === hanna.id)).toMatchObject({ step: 2, testLeads: 30, promisedBefore: 30 });
    // Vorlagen-Versand ohne KI: 20
    await call("leadops.importColdList", { listName: "Energie-Vorlage", rows: [{ firstName: "Paula", lastName: "Plan", company: "Plan Solar", email: "paula@energie-demo.example" }] });
    const plain = await call("leadops.saveEmailCampaign", { ...base, name: "Energie-Vorlage", leadSparte: "Photovoltaik", audience: { source: "liste", listName: "Energie-Vorlage" }, tree });
    await call("leadops.startEmailCampaign", { id: plain.id }); await call("leadops.runEmailCampaigns");
    const paula = getStore().tables.emailCampaignRecipients.find((item) => item.campaignId === plain.id)!; expect(paula.sentCount).toBe(1);
    expect(String(sentOf(paula.id)[0].body)).toContain("20 Test-Leads"); expect(String(sentOf(paula.id)[0].body)).not.toMatch(/\b10 Test-Leads/);
  });

  it("Posteingang: zu jeder Antwort unsere E-Mails davor (Schritt, Auszug, versprochene Test-Leads), Kategorie der Kampagne; Antwort-Vorschlag nennt dieselbe Zahl", async () => {
    const inbox = await call("leadops.listInbox", { filter: "alle" });
    const hansen = inbox.items.find((item: any) => item.fromEmail === "info@hansen-bedachungen.de");
    expect(hansen).toMatchObject({ campaignName: "Dachdecker Hessen – Erstkontakt", campaignCategoryName: "Photovoltaik & Wärmepumpe" }); // Photovoltaik → in der Vertriebspipeline die gemeinsame Kategorie
    expect(hansen.sentBefore.map((mail: any) => mail.step)).toEqual([2, 1]); // neueste zuerst
    expect(hansen.sentBefore[1]).toMatchObject({ subject: "Mehr Anfragen für Hansen Bedachungen – ohne Risiko", source: "vorlage", testLeads: 20 }); expect(hansen.sentBefore[1].excerpt).toContain("Sehr geehrter Herr Hansen"); expect(hansen.sentBefore[1].excerpt).toContain("20 Test-Leads");
    expect(hansen.sentBefore[0]).toMatchObject({ subject: "Kurze Frage zu Ihrem Bedarf, Peter", testLeads: 20 });
    expect((await call("leadops.sentMailPreview", { id: hansen.sentBefore[1].id })).html).toContain("Hansen Bedachungen");
    const suggestion = await call("leadops.suggestInboxReply", { messageId: hansen.id }); expect(suggestion.text).toContain("20 Test-Leads"); expect(suggestion.text).not.toMatch(/\b10 Test-Leads/);
    const unknown = inbox.items.find((item: any) => item.fromEmail === "m.mayer@solartechnik-mayer.de"); expect(unknown.sentBefore).toEqual([]); expect(unknown.campaignCategoryId).toBeNull();
  });

  it("Interessent aus dem Posteingang: eigene Stufe „Hat Interesse“ der E-Mail-Pipeline wird genommen, Kategorie = die der Kampagne (nicht die erste)", async () => {
    const trl = getStore().tables.leadCategories.find((row) => row.name === "Treppenlifte")!; const pvCat = getStore().tables.leadCategories.find((row) => row.name === "Photovoltaik")!;
    getStore().tables.emailCampaigns.find((row) => row.name === "Dachdecker Hessen – Erstkontakt")!.leadCategoryIds = [trl.id]; // Kampagne mit Treppenliften – Photovoltaik wäre die erste Kategorie
    const stages = await call("leadops.pipelineStages", { source: "email" });
    await call("leadops.savePipelineStages", { source: "email", stages: [stages[0], { key: "hat_interesse", label: "Hat Interesse", hint: "" }, ...stages.slice(1)] });
    const koch = (await call("leadops.listInbox", { filter: "alle" })).items.find((item: any) => item.fromEmail === "kontakt@koch-dach.de"); expect(koch.campaignCategoryName).toBe("Treppenlifte");
    const made = await call("leadops.createLeadFromInbox", { messageId: koch.id, pipeline: "email", stage: "hat_interesse" });
    expect(getStore().tables.leads.find((row) => row.publicId === made.publicId)).toMatchObject({ pipelineStage: "hat_interesse", categoryId: trl.id });
    expect((await call("leadops.pipelineOverview", { source: "email" })).stages.find((stage: any) => stage.key === "hat_interesse").leads.some((lead: any) => lead.publicId === made.publicId)).toBe(true);
    // unbekannte Stufe → die Interesse-Stufe; eine ausdrücklich gewählte Kategorie hat Vorrang und bleibt (auch „Photovoltaik“ allein)
    const hansen = (await call("leadops.listInbox", { filter: "alle" })).items.find((item: any) => item.fromEmail === "info@hansen-bedachungen.de");
    const other = await call("leadops.createLeadFromInbox", { messageId: hansen.id, pipeline: "email", stage: "gibt_es_nicht", categoryId: pvCat.id });
    expect(getStore().tables.leads.find((row) => row.publicId === other.publicId)).toMatchObject({ pipelineStage: "hat_interesse", categoryId: pvCat.id });
    await call("leadops.savePipelineStages", { source: "email", stages }); getStore().tables.emailCampaigns.find((row) => row.name === "Dachdecker Hessen – Erstkontakt")!.leadCategoryIds = [pvCat.id];
  });

  it("Gesendet: jede Kampagnen-Mail trägt Kategorie und Sparte der Kampagne – Photovoltaik und Wärmepumpe lassen sich trennen", async () => {
    const sent = await call("leadops.listSent", {});
    const dach = sent.items.filter((item: any) => item.campaignName === "Dachdecker Hessen – Erstkontakt"); const strom = sent.items.filter((item: any) => item.campaignName === "Elektriker NRW – Frühjahr");
    expect(dach.length).toBeGreaterThan(0); expect(strom.length).toBeGreaterThan(0);
    expect(dach.every((item: any) => item.sparte?.categoryName === "Photovoltaik & Wärmepumpe" && item.sparte?.sparte === "Photovoltaik")).toBe(true); // Kategorie zusammengeführt, die Sparte bleibt genau
    expect(strom.every((item: any) => item.sparte?.categoryName === "Photovoltaik & Wärmepumpe" && item.sparte?.sparte === "Wärmepumpe")).toBe(true);
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
    const ala = getStore().tables.leadCategories.find((row) => row.name === "Alarmanlagen")!; getStore().tables.emailCampaigns.find((row) => row.name === "Elektriker NRW – Frühjahr")!.leadCategoryIds = [ala.id]; // zweite Kategorie neben „Photovoltaik & Wärmepumpe“
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=posteingang");
    const view = mount(); await settle(300); await settle(300);
    const sentFolder = Array.from(view.container.querySelectorAll<HTMLButtonElement>(".inbox-folders button")).find((node) => node.textContent?.trim().startsWith("Gesendet"))!;
    await act(async () => { fireEvent.click(sentFolder); }); await settle(300); await settle(200);
    const select = view.container.querySelector<HTMLSelectElement>('select[aria-label="Lead-Kategorie"]'); expect(select).toBeTruthy();
    const options = Array.from(select!.options).map((option) => option.textContent ?? ""); expect(options[0]).toBe("Alle Kategorien"); expect(options.some((text) => /^☀️♨️ Photovoltaik & Wärmepumpe \(\d+\)$/.test(text))).toBe(true); expect(options.some((text) => /^🚨 Alarmanlagen \(\d+\)$/.test(text))).toBe(true);
    const tags = () => Array.from(view.container.querySelectorAll(".inbox-sent-sparte")).map((node) => node.textContent?.trim());
    expect(tags()).toContain("☀️♨️ Photovoltaik & Wärmepumpe"); expect(tags()).toContain("🚨 Alarmanlagen");
    await act(async () => { fireEvent.change(select!, { target: { value: "Alarmanlagen" } }); }); await settle(100);
    expect(tags().length).toBeGreaterThan(0); expect(tags().every((text) => text === "🚨 Alarmanlagen")).toBe(true);
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

describe("Freigabe getrennt nach Erst-E-Mails und Follow-ups (Chat-Build)", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });
  async function setup() {
    const { starterBlocks } = await import("../../../../shared/email-design");
    await call("leadops.importColdList", { listName: "Freigabe-Art", rows: [{ firstName: "Vera", lastName: "Versprechen", company: "Versprechen Wärme", email: "vera@freigabe-art.example" }, { firstName: "Nils", lastName: "Neu", company: "Neu Solar", email: "nils@freigabe-art.example" }] });
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste an {{firma}}", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait", hours: 1, next: "m2" }, { id: "m2", type: "send", label: "Kurze Nachfrage", subject: "Nachfrage {{firma}}", blocks: starterBlocks("nachfassen"), next: null }] };
    const saved = await call("leadops.saveEmailCampaign", { id: null, name: "Freigabe-Art", fromName: "T", fromEmail: "t@t.de", replyTo: null, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 50, audience: { source: "liste", listName: "Freigabe-Art" }, tree, kiModus: "freigabe", kiAnsatz: "frei" });
    await call("leadops.startEmailCampaign", { id: saved.id }); await call("leadops.runEmailCampaigns");
    const rows = () => getStore().tables.emailCampaignRecipients.filter((item) => item.campaignId === saved.id).sort((a, b) => a.id - b.id);
    await call("leadops.saveCampaignDraft", { recipientId: rows()[0].id, subject: "Persönlich für Versprechen Wärme", text: "Sehr geehrte Frau Versprechen,\n\nzum Kennenlernen stellen wir Ihnen 20 Test-Leads kostenlos bereit.\n\nVielen Dank", approve: true });
    await call("leadops.runEmailCampaigns"); rows()[0].nextActionAt = new Date(Date.now() - 1000); await call("leadops.runEmailCampaigns");
    expect(rows()[0]).toMatchObject({ sentCount: 1, draftNodeId: "m2", draftState: "entwurf" }); expect(rows()[1]).toMatchObject({ sentCount: 0, draftNodeId: "m1", draftState: "entwurf" }); // Vera: Follow-up zur Prüfung, Nils: Erst-E-Mail zur Prüfung
    return { saved, rows };
  }
  it("Sammel-Freigabe, Zurücknehmen und Neu-schreiben gelten nur für die gewählte Art", async () => {
    const { saved, rows } = await setup();
    expect(await call("leadops.approveAllCampaignDrafts", { campaignId: saved.id, approve: true, kind: "followup" })).toMatchObject({ approved: 1 });
    expect(rows()[0].draftState).toBe("freigegeben"); expect(rows()[1].draftState).toBe("entwurf"); // nur das Follow-up
    expect(await call("leadops.approveAllCampaignDrafts", { campaignId: saved.id, approve: true, kind: "erste" })).toMatchObject({ approved: 1 }); expect(rows()[1].draftState).toBe("freigegeben");
    expect(await call("leadops.approveAllCampaignDrafts", { campaignId: saved.id, approve: false, kind: "erste" })).toMatchObject({ reverted: 1 }); expect(rows()[1].draftState).toBe("entwurf"); expect(rows()[0].draftState).toBe("freigegeben"); // nur die Erst-E-Mail zurück
    expect(await call("leadops.resetCampaignDrafts", { campaignId: saved.id, kind: "followup" })).toEqual({ reset: 1 }); expect(rows()[0].draftState).toBeNull(); expect(rows()[1].draftState).toBe("entwurf"); // nur das Follow-up verworfen
    expect((await call("leadops.generateCampaignDrafts", { campaignId: saved.id, limit: 5, kind: "erste" })).drafts).toHaveLength(0); // Erst-E-Mails haben schon Entwürfe
    expect((await call("leadops.generateCampaignDrafts", { campaignId: saved.id, limit: 5, kind: "followup" })).drafts).toHaveLength(1); expect(rows()[0]).toMatchObject({ draftNodeId: "m2", draftState: "entwurf" });
    expect(await call("leadops.approveAllCampaignDrafts", { campaignId: saved.id, approve: true })).toMatchObject({ approved: 2 }); // ohne Art: beides
  });
  it("Follow-ups in der Wartezeit stehen mit „fällig ab“ in der Liste und lassen sich vorab freigeben – sie gehen dann von selbst raus, sobald die Wartezeit um ist", async () => {
    const { starterBlocks } = await import("../../../../shared/email-design");
    await call("leadops.importColdList", { listName: "Freigabe-Vorab", rows: [{ firstName: "Vera", lastName: "Vorab", company: "Vorab Wärme", email: "vera@freigabe-vorab.example" }] });
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste an {{firma}}", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait", hours: 1, next: "m2" }, { id: "m2", type: "send", label: "Kurze Nachfrage", subject: "Nachfrage {{firma}}", blocks: starterBlocks("nachfassen"), next: null }] };
    const saved = await call("leadops.saveEmailCampaign", { id: null, name: "Freigabe-Vorab", fromName: "T", fromEmail: "t@t.de", replyTo: null, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 50, audience: { source: "liste", listName: "Freigabe-Vorab" }, tree, kiModus: "freigabe", kiAnsatz: "frei" });
    await call("leadops.startEmailCampaign", { id: saved.id }); await call("leadops.runEmailCampaigns");
    const vera = () => getStore().tables.emailCampaignRecipients.find((item) => item.campaignId === saved.id)!;
    await call("leadops.saveCampaignDraft", { recipientId: vera().id, subject: "Persönlich", text: "Sehr geehrte Frau Vorab,\n\nzum Kennenlernen stellen wir Ihnen 10 Test-Leads kostenlos bereit.\n\nVielen Dank", approve: true });
    await call("leadops.runEmailCampaigns"); expect(vera()).toMatchObject({ sentCount: 1, nodeId: "w1" }); // in der Wartezeit
    const queue = await call("leadops.campaignReviewQueue", { campaignId: saved.id }); expect(queue.counts).toMatchObject({ followUps: 1, spaeter: 1 });
    const item = queue.items.find((entry: any) => entry.id === vera().id); expect(item).toMatchObject({ followUp: true, step: 2, nodeId: "m2", nodeLabel: "Kurze Nachfrage" }); expect(item.dueAt).toBeTruthy();
    await call("leadops.saveCampaignDraft", { recipientId: vera().id, subject: "Kurze Nachfrage", text: "Sehr geehrte Frau Vorab,\n\nhatten Sie schon Gelegenheit, über unser Angebot nachzudenken?\n\nVielen Dank", approve: false });
    expect(vera()).toMatchObject({ draftNodeId: "m2", draftState: "entwurf", nodeId: "w1" }); // der Entwurf gilt dem Follow-up, nicht der schon gesendeten Erst-E-Mail
    expect(await call("leadops.approveAllCampaignDrafts", { campaignId: saved.id, approve: true, kind: "followup" })).toMatchObject({ approved: 1 }); expect(vera().draftState).toBe("freigegeben");
    await call("leadops.runEmailCampaigns"); expect(vera().sentCount).toBe(1); // noch nicht fällig
    vera().nextActionAt = new Date(Date.now() - 1000); await call("leadops.runEmailCampaigns"); expect(vera().sentCount).toBe(2);
    const sent = getStore().tables.emailCampaignEvents.filter((event) => event.recipientId === vera().id && event.kind === "gesendet"); expect(sent[1].nodeId).toBe("m2"); expect(String(sent[1].body ?? "")).toContain("Gelegenheit, über unser Angebot");
  });
  it("Oberfläche: wartende Follow-ups tragen „fällig ab …“ in der Liste und im Kopf", async () => {
    const { starterBlocks } = await import("../../../../shared/email-design");
    await call("leadops.importColdList", { listName: "Freigabe-Badge", rows: [{ firstName: "Vera", lastName: "Badge", company: "Badge Wärme", email: "vera@freigabe-badge.example" }] });
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste an {{firma}}", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait", hours: 30, next: "m2" }, { id: "m2", type: "send", label: "Kurze Nachfrage", subject: "Nachfrage {{firma}}", blocks: starterBlocks("nachfassen"), next: null }] };
    const saved = await call("leadops.saveEmailCampaign", { id: null, name: "Freigabe-Badge", fromName: "T", fromEmail: "t@t.de", replyTo: null, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 50, audience: { source: "liste", listName: "Freigabe-Badge" }, tree, kiModus: "freigabe", kiAnsatz: "frei" });
    await call("leadops.startEmailCampaign", { id: saved.id }); await call("leadops.runEmailCampaigns");
    const vera = () => getStore().tables.emailCampaignRecipients.find((item) => item.campaignId === saved.id)!;
    await call("leadops.saveCampaignDraft", { recipientId: vera().id, subject: "Persönlich", text: "Sehr geehrte Frau Badge,\n\nzum Kennenlernen stellen wir Ihnen 10 Test-Leads kostenlos bereit.\n\nVielen Dank", approve: true });
    await call("leadops.runEmailCampaigns"); expect(vera()).toMatchObject({ sentCount: 1, nodeId: "w1" });
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const view = mount(); await settle(300); await settle(300);
    const card = Array.from(view.container.querySelectorAll<HTMLElement>(".cl-card")).find((node) => node.querySelector(".cl-name")?.textContent?.includes("Freigabe-Badge"))!;
    const part = Array.from(card.querySelectorAll<HTMLButtonElement>(".cl-approval-part")).find((node) => /Follow-up/.test(node.textContent ?? ""))!; expect(part.textContent).toMatch(/^1 Follow-up ab /); // auf der Karte: ab wann zur Freigabe
    await act(async () => { fireEvent.click(part); }); await settle(500); await settle(300);
    const dialog = document.querySelector(".review-dialog")!; expect(dialog).toBeTruthy();
    expect(dialog.querySelector(".rv-head p")?.textContent).toContain("1 Follow-ups noch in der Wartezeit");
    const due = dialog.querySelector(".rv-list .rv-due"); expect(due?.textContent).toMatch(/^fällig ab /);
    expect(dialog.querySelector(".rv-editor-kind .rv-due")?.textContent).toMatch(/^fällig ab /);
    expect(Array.from(dialog.querySelectorAll<HTMLButtonElement>(".rv-head-actions button")).some((node) => /Follow-ups? freigeben$/.test(node.textContent?.trim() ?? "") || /Follow-ups? schreiben$/.test(node.textContent?.trim() ?? ""))).toBe(true);
    // „Zurück“ im Browser schließt nur das Fenster – die Übersicht bleibt
    const before = window.location.href; await act(async () => { window.history.back(); }); await settle(400);
    expect(document.querySelector(".review-dialog")).toBeNull(); expect(window.location.href).toBe(before); expect(view.container.querySelector(".cl-list")).toBeTruthy();
  });
  it("Übersicht: „Erst-E-Mails“ auf der Karte öffnet die Freigabe direkt nur für Erst-E-Mails – der Freigeben-Knopf nennt und nimmt nur diese", async () => {
    const { rows } = await setup();
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const view = mount(); await settle(300); await settle(300);
    const card = Array.from(view.container.querySelectorAll<HTMLElement>(".cl-card")).find((node) => node.querySelector(".cl-name")?.textContent?.includes("Freigabe-Art"))!; expect(card).toBeTruthy();
    const pill = card.querySelector(".cl-approval")!; expect(pill).toBeTruthy(); expect(pill.querySelector(".cl-approval-main")?.textContent).toBe("Zur Freigabe");
    const part = Array.from(pill.querySelectorAll<HTMLButtonElement>(".cl-approval-part")).find((node) => /Erst-E-Mail/.test(node.textContent ?? ""))!; expect(part.textContent).toBe("1 Erst-E-Mail wartet");
    await act(async () => { fireEvent.click(part); }); await settle(400); await settle(300);
    const dialog = document.querySelector(".review-dialog"); expect(dialog).toBeTruthy(); expect(view.container.querySelector(".ch-title")).toBeNull(); // Fenster über der Übersicht, nicht die geöffnete Kampagne
    const kindBar = dialog!.querySelector(".cd-filters.is-kind")!; expect(Array.from(kindBar.querySelectorAll("button")).find((node) => node.getAttribute("aria-selected") === "true")?.textContent).toMatch(/^Erst-E-Mails/);
    expect(Array.from(dialog!.querySelectorAll(".rv-list .rv-step .rv-kind")).map((node) => node.textContent?.trim())).toEqual(["Erst-E-Mail"]);
    // „Speichern“ und „Freigeben & weiter“ stehen oben rechts bei den Werkzeugen des Editors – unten nur noch die Wortzahl; dazu das X zum Schließen
    const tools = dialog!.querySelector(".rv-editor-tools .rv-editor-buttons")!; expect(tools).toBeTruthy();
    expect(Array.from(tools.querySelectorAll("button")).map((node) => node.textContent?.trim())).toEqual(["Speichern", "Freigeben & weiter"]);
    expect(dialog!.querySelector(".rv-editor-foot button")).toBeNull(); expect(dialog!.querySelector(".rv-editor-foot small")?.textContent).toMatch(/Wörter/);
    expect(dialog!.querySelector(".review-close")).toBeTruthy();
    const approveButton = Array.from(dialog!.querySelectorAll<HTMLButtonElement>(".rv-head-actions button")).find((node) => /freigeben$/.test(node.textContent?.trim() ?? ""))!; expect(approveButton.textContent?.trim()).toBe("Alle 1 Erst-E-Mail freigeben");
    await act(async () => { fireEvent.click(approveButton); }); await settle(200);
    expect(document.querySelector(".app-confirm-text")?.textContent).toContain("Erst-E-Mail"); expect(document.querySelector(".app-confirm-text")?.textContent).toContain("Follow-ups bleiben unberührt");
    await act(async () => { fireEvent.click(document.querySelector<HTMLButtonElement>(".app-confirm-ok")!); }); await settle(400); await settle(300);
    expect(rows()[1].draftState).toBe("freigegeben"); expect(rows()[0].draftState).toBe("entwurf"); // nur die Erst-E-Mail freigegeben, das Follow-up wartet weiter
    await act(async () => { fireEvent.click(Array.from(dialog!.querySelectorAll<HTMLButtonElement>(".rv-head-actions button")).find((node) => /Schließen/.test(node.textContent ?? ""))!); }); await settle(300);
    expect(document.querySelector(".review-dialog")).toBeNull();
  });
});

describe("Pipeline „E-Mail-Kampagne“ ohne Spalte „Neu“ (Chat-Build)", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  it("„Versendet“ ist die erste Spalte (Eingang); Kontakt von Hand landet dort; eine alte Aufteilung „Neu“ + „Versendet“ wird beim nächsten Blick aufs Board zusammengelegt – mit Vermerk", async () => {
    const board = await call("leadops.pipelineOverview", { source: "email" });
    expect(board.stages[0]).toMatchObject({ key: "versendet", label: "Versendet" }); expect(board.stages.some((stage: any) => stage.key === "neu")).toBe(false);
    const stages = await call("leadops.pipelineStages", { source: "email" }); expect(stages[0]).toMatchObject({ key: "versendet", fixed: "entry" });
    const manual = await call("leadops.createPipelineContact", { source: "email", firstName: "Eva", lastName: "Eingang", phone: "+49 69 5550777" });
    const leadOf = () => getStore().tables.leads.find((row) => row.publicId === manual.publicId)!; expect(leadOf().pipelineStage).toBe("versendet");
    // so sah es bisher aus: „Neu“ als Eingang, „Versendet“ dahinter – und eine Karte in „Neu“
    const config = getStore().tables.pipelineStageConfigs.find((row) => row.source === "email")!; config.stages = [{ key: "neu", label: "Neu", hint: "Gerade eingegangen", fixed: "entry" }, { ...stages[0], fixed: undefined }, ...stages.slice(1)];
    leadOf().pipelineStage = "neu";
    expect((await call("leadops.pipelineStages", { source: "email" })).map((stage: any) => stage.key).slice(0, 2)).toEqual(["neu", "versendet"]);
    const again = await call("leadops.pipelineOverview", { source: "email" }); expect(again.stages[0].key).toBe("versendet"); expect(again.stages.some((stage: any) => stage.key === "neu")).toBe(false);
    expect(leadOf().pipelineStage).toBe("versendet"); expect(again.stages[0].leads.some((lead: any) => lead.publicId === manual.publicId)).toBe(true);
    expect((await call("leadops.pipelineHistory", { publicId: manual.publicId })).some((event: any) => /Stufe „Neu“ gibt es nicht mehr – auf „Versendet“ gesetzt/.test(event.note ?? ""))).toBe(true);
    expect((await call("leadops.activityFeed", { days: 1 })).days.some((day: any) => day.groups.some((group: any) => group.entries.some((entry: any) => entry.title.includes("„Versendet“ ist jetzt die erste Spalte"))))).toBe(true);
    // „Versendet“ lässt sich als Eingang nicht löschen
    await expect(call("leadops.savePipelineStages", { source: "email", stages: again.stages.filter((stage: any) => stage.key !== "versendet") })).rejects.toThrow(/Eingangsstufe/);
  });
});

describe("Kampagnen-Übersicht: Zeitraum der Zahlen (Chat-Build)", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });
  it("Zeitraum-Knöpfe über den Kennzahlen: Gesamt ist Standard, „Heute“ zählt nur E-Mails von heute, „Eigener“ zeigt Von/Bis; kein Knopf „Fällige Schritte jetzt ausführen“ mehr", async () => {
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=kampagnen");
    const view = mount(); await settle(300); await settle(300);
    expect(Array.from(view.container.querySelectorAll("header button")).some((node) => /Fällige Schritte/.test(node.textContent ?? ""))).toBe(false);
    const chips = () => Array.from(view.container.querySelectorAll<HTMLButtonElement>(".cd-filters.is-period button")); expect(chips().map((node) => node.textContent)).toEqual(["Gesamt", "Heute", "7 Tage", "30 Tage", "Eigener"]);
    expect(chips().find((node) => node.getAttribute("aria-selected") === "true")?.textContent).toBe("Gesamt"); expect(view.container.querySelector(".cd-period-note")).toBeNull();
    const sentCard = () => Array.from(view.container.querySelectorAll<HTMLElement>(".cd-kpis .cd-kpi")).find((node) => node.querySelector("span")?.textContent === "Gesendet")!;
    const overall = Number(sentCard().querySelector("strong")?.textContent); expect(overall).toBeGreaterThan(0);
    const all = await call("leadops.listEmailCampaigns"); const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const today = await call("leadops.listEmailCampaigns", { from: todayStart, until: new Date() });
    const sumMails = (rows: any[]) => rows.filter((row: any) => !row.isTemplate && !row.archivedAt).reduce((acc: number, row: any) => acc + (row.stats.mails?.sent ?? 0), 0);
    expect(sumMails(today)).toBeLessThan(sumMails(all)); // der Seed hat E-Mails aus den letzten Tagen – heute nur ein Teil
    await act(async () => { fireEvent.click(chips().find((node) => node.textContent === "Heute")!); }); await settle(400); await settle(300);
    expect(view.container.querySelector(".cd-period-note")?.textContent).toBe("Zahlen für heute"); expect(localStorage.getItem("kampagnen-zeitraum")).toBe("today");
    expect(Number(sentCard().querySelector("strong")?.textContent)).toBe(sumMails(today)); expect(Array.from(view.container.querySelectorAll(".cd-kpis .cd-kpi span")).some((node) => node.textContent === "Neu aufgenommen")).toBe(true);
    await act(async () => { fireEvent.click(chips().find((node) => node.textContent === "Eigener")!); }); await settle(200);
    const inputs = view.container.querySelectorAll<HTMLInputElement>('.cd-period-range input[type="date"]'); expect(inputs).toHaveLength(2);
    await act(async () => { fireEvent.change(inputs[0], { target: { value: "2020-01-01" } }); fireEvent.change(inputs[1], { target: { value: "2020-01-31" } }); }); await settle(400); await settle(300);
    expect(view.container.querySelector(".cd-period-note")?.textContent).toBe("Zahlen für 01.01.2020 – 31.01.2020"); expect(Number(sentCard().querySelector("strong")?.textContent)).toBe(0);
    await act(async () => { fireEvent.click(chips().find((node) => node.textContent === "Gesamt")!); }); await settle(400); await settle(300);
    expect(Number(sentCard().querySelector("strong")?.textContent)).toBe(overall); expect(view.container.querySelector(".cd-period-note")).toBeNull();
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
    expect(board.categories.length).toBeGreaterThanOrEqual(2); const pv = board.categories.find((item: any) => item.name === "Photovoltaik & Wärmepumpe"); expect(pv).toBeTruthy(); expect(pv.count).toBeGreaterThan(0); // PV und WP zusammen
    const single = (item: any) => item.name === "Photovoltaik" || item.name === "Wärmepumpe";
    for (const source of ["kaltakquise", "ads"]) expect((await call("leadops.pipelineOverview", { source })).categories.filter((item: any) => item.count > 0).some(single)).toBe(false); // Kaltakquise und Meta Ads: PV und WP zusammen
    expect((await call("leadops.pipelineOverview", { source: "email" })).categories.some((item: any) => item.name === "Photovoltaik" && item.count > 0)).toBe(true); // E-Mail-Kampagne: getrennt wie die Kampagne („PV-Betriebe Bayern“)
    const other = board.categories.find((item: any) => item.name !== "Photovoltaik & Wärmepumpe"); expect(other.count).toBeGreaterThan(0);
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

describe("Vertriebspipeline „E-Mail-Kampagne“: nach E-Mail-Kampagne filtern (Chat-Build)", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });
  /** Zwei Karten des Boards kamen über eine zweite E-Mail-Kampagne („Dachdecker Hessen – Erstkontakt“). */
  async function twoCampaigns() {
    const store = getStore(); const dach = store.tables.emailCampaigns.find((row) => row.name === "Dachdecker Hessen – Erstkontakt")!;
    const before = await call("leadops.pipelineOverview", { source: "email" }); const moved = before.stages.flatMap((stage: any) => stage.leads).slice(0, 2).map((lead: any) => lead.id);
    for (const lead of store.tables.leads.filter((row) => moved.includes(row.id))) Object.assign(lead, { adCampaignId: `email-${dach.id}`, adCampaignName: dach.name });
    return { dachKey: `email-${dach.id}`, total: before.totals.leads };
  }
  it("Daten: nur Karten einer Kampagne; kombinierbar mit „Interesse“, „Geöffnet“, „Webseite geklickt“ – die Zähler gelten dann für diese Kampagne", async () => {
    const { dachKey, total } = await twoCampaigns();
    const board = await call("leadops.pipelineOverview", { source: "email" }); expect(board.totals.leads).toBe(total);
    expect(board.campaigns.length).toBeGreaterThanOrEqual(2); const dach = board.campaigns.find((item: any) => item.campaignId === dachKey); expect(dach).toMatchObject({ campaignName: "Dachdecker Hessen – Erstkontakt", leads: 2 });
    const only = await call("leadops.pipelineOverview", { source: "email", campaignId: dachKey });
    const cards = only.stages.flatMap((stage: any) => stage.leads); expect(cards).toHaveLength(2); expect(cards.every((lead: any) => lead.adCampaignId === dachKey)).toBe(true);
    expect(only.campaigns.length).toBe(board.campaigns.length); // die Auswahl bleibt vollständig
    for (const smartList of ["__interesse", "__geoeffnet", "__geklickt"] as const) {
      const both = await call("leadops.pipelineOverview", { source: "email", campaignId: dachKey, smartList });
      const key = smartList.slice(2) as "interesse" | "geoeffnet" | "geklickt"; expect(both.totals.leads).toBe(only.smartLists[key]); expect(only.smartLists[key]).toBeLessThanOrEqual(board.smartLists[key]);
      expect(both.stages.flatMap((stage: any) => stage.leads).every((lead: any) => lead.adCampaignId === dachKey)).toBe(true);
    }
    expect((await call("leadops.pipelineOverview", { source: "email", campaignId: "__geoeffnet" })).totals.leads).toBe(board.smartLists.geoeffnet); // smarte Liste wie bisher über campaignId
  });
  it("Oberfläche: Auswahl „E-Mail-Kampagne“ mit Anzahl – filtert das Board, die smarte Liste bleibt dazu wählbar", async () => {
    await twoCampaigns();
    window.history.replaceState(null, "", "/?page=Vertriebspipeline&quelle=email");
    const view = mount(); await settle(400); await settle(400);
    const select = view.container.querySelector<HTMLSelectElement>("select.pipeline-mail-campaign-filter")!; expect(select).toBeTruthy();
    const options = Array.from(select.options).map((option) => option.textContent ?? ""); expect(options[0]).toBe("Alle E-Mail-Kampagnen"); expect(options).toContain("Dachdecker Hessen – Erstkontakt (2)"); expect(options.length).toBeGreaterThanOrEqual(3);
    const total = view.container.querySelectorAll(".pipeline-card").length; expect(total).toBeGreaterThan(2); // Board im gewählten Zeitraum
    const value = Array.from(select.options).find((option) => option.textContent?.startsWith("Dachdecker Hessen – Erstkontakt"))!.value;
    await act(async () => { fireEvent.change(select, { target: { value } }); }); await settle(400); await settle(300);
    expect(view.container.querySelectorAll(".pipeline-card").length).toBe(2); expect(view.container.querySelector<HTMLSelectElement>("select.pipeline-mail-campaign-filter")!.value).toBe(value);
    const smart = Array.from(view.container.querySelectorAll<HTMLButtonElement>(".smart-list")).map((button) => button.textContent ?? ""); expect(smart.some((text) => text.startsWith("Geöffnet"))).toBe(true); // weiter wählbar
    await act(async () => { fireEvent.change(view.container.querySelector<HTMLSelectElement>("select.pipeline-mail-campaign-filter")!, { target: { value: "" } }); }); await settle(400); await settle(300);
    expect(view.container.querySelectorAll(".pipeline-card").length).toBe(total); // „Alle E-Mail-Kampagnen“: wieder alles
  });
});

describe("Vertriebspipeline: Zeitraum „Heute“ zählt Bewegung – Lead-Kategorie und E-Mail-Kampagne bleiben wählbar (Chat-Build)", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });
  const today = () => { const now = new Date(); return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), until: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999) }; };
  /** Alles „alt“ machen: Karten vor 40 Tagen angelegt und zuletzt bewegt, Mails/Antworten/Anrufe/Notizen ebenfalls – heute ist noch nichts passiert. (Erst einmal laden: die einmalige Spalten-Umstellung „Neu“ → „Versendet“ läuft beim ersten Aufruf.) */
  async function quietBoard() {
    await call("leadops.pipelineOverview", { source: "email" }); await call("leadops.pipelineOverview", { source: "ads" });
    const store = getStore(); const old = new Date(Date.now() - 40 * 86_400_000);
    for (const lead of store.tables.leads) Object.assign(lead, { createdAt: old, pipelineUpdatedAt: old });
    for (const name of ["pipelineEvents", "pipelineNotes", "outboundMessages", "emailCampaignEvents"] as const) for (const row of store.tables[name]) row.createdAt = old;
    for (const row of store.tables.leadCallAttempts) row.at = old; for (const row of store.tables.inboxMessages) row.receivedAt = old; for (const row of store.tables.pipelineTasks) if (row.doneAt) row.doneAt = old;
  }
  async function mailToday(leadId: number) {
    const { insert } = await import("../store"); const store = getStore(); const lead = store.tables.leads.find((row) => row.id === leadId)!;
    const campaignId = Number(String(lead.adCampaignId ?? "").replace("email-", "")) || store.tables.emailCampaigns[0].id;
    const recipient = store.tables.emailCampaignRecipients.find((row) => row.leadId === leadId) ?? insert(store, "emailCampaignRecipients", { tenantId: lead.tenantId, campaignId, leadId, email: lead.email ?? `karte-${leadId}@heute-demo.example`, status: "aktiv", sentCount: 0, createdAt: new Date() } as never);
    insert(store, "emailCampaignEvents", { tenantId: lead.tenantId, campaignId: recipient.campaignId, recipientId: recipient.id, nodeId: "m1", kind: "gesendet", subject: "Heute gesendet", note: "E-Mail gesendet", createdAt: new Date() } as never);
  }
  it("Daten: „Heute“ zeigt Karten mit heutiger Kampagnen-Mail, Antwort oder Anruf – auch wenn sie früher angelegt wurden; Kategorien und Kampagnen bleiben (mit 0) in der Auswahl", async () => {
    await quietBoard();
    const cards = (await call("leadops.pipelineOverview", { source: "email" })).stages.flatMap((stage: any) => stage.leads); expect(cards.length).toBeGreaterThan(3);
    const empty = await call("leadops.pipelineOverview", { source: "email", ...today() }); expect(empty.totals.leads).toBe(0);
    expect(empty.categories.length).toBeGreaterThan(0); expect(empty.categories.every((item: any) => item.count === 0)).toBe(true);
    expect(empty.campaignOptions.length).toBeGreaterThan(0); expect(empty.campaignOptions.every((item: any) => item.count === 0)).toBe(true);
    const [mailed, replied, called] = cards; const { insert } = await import("../store"); const store = getStore();
    await mailToday(mailed.id);
    insert(store, "inboxMessages", { tenantId: 1, messageId: "<heute-antwort@demo>", fromEmail: replied.email ?? "antwort@heute-demo.example", fromName: "Antwort", subject: "Re: Test-Leads", bodyText: "Gern mehr Infos.", receivedAt: new Date(), isRead: false, campaignRecipientId: null, leadId: replied.id, archived: false, blocked: false, optOut: false } as never);
    insert(store, "leadCallAttempts", { tenantId: 1, leadId: called.id, userId: null, dialerCallId: null, result: "nicht_erreicht", note: null, at: new Date() } as never);
    const board = await call("leadops.pipelineOverview", { source: "email", ...today() }); const ids = board.stages.flatMap((stage: any) => stage.leads).map((lead: any) => lead.id).sort();
    expect(ids).toEqual([mailed.id, replied.id, called.id].sort()); expect(board.totals.leads).toBe(3);
    expect(board.campaignOptions.reduce((sum: number, item: any) => sum + item.count, 0)).toBe(3); expect(board.campaignOptions.length).toBe(empty.campaignOptions.length); // alle Kampagnen weiter wählbar
    expect(board.categories.length).toBe(empty.categories.length); expect(board.categories.reduce((sum: number, item: any) => sum + item.count, 0)).toBe(board.stages.flatMap((stage: any) => stage.leads).filter((lead: any) => lead.categoryId != null).length);
    expect((await call("leadops.pipelineOverview", { source: "email", from: new Date(Date.now() - 45 * 86_400_000), until: new Date(Date.now() - 35 * 86_400_000) })).totals.leads).toBe(cards.length); // vor 40 Tagen: alle angelegt
  });
  it("Daten: Meta Ads zählt weiter nach Eingang des Leads (Kosten je Lead) – nur verschoben heute zählt dort nicht", async () => {
    await quietBoard(); const store = getStore();
    const ads = (await call("leadops.pipelineOverview", { source: "ads" })).stages.flatMap((stage: any) => stage.leads); expect(ads.length).toBeGreaterThan(1);
    Object.assign(store.tables.leads.find((row) => row.id === ads[0].id)!, { pipelineUpdatedAt: new Date() });
    expect((await call("leadops.pipelineOverview", { source: "ads", ...today() })).totals.leads).toBe(0);
    Object.assign(store.tables.leads.find((row) => row.id === ads[1].id)!, { createdAt: new Date() });
    const board = await call("leadops.pipelineOverview", { source: "ads", ...today() }); expect(board.stages.flatMap((stage: any) => stage.leads).map((lead: any) => lead.id)).toEqual([ads[1].id]);
  });
  it("Oberfläche: „Heute“ zeigt die Karte mit heutiger Mail; die Auswahl „Lead-Kategorie“ und „E-Mail-Kampagne“ bleibt da – auch wenn heute nichts los ist", async () => {
    await quietBoard();
    window.history.replaceState(null, "", "/?page=Vertriebspipeline&quelle=email");
    const view = mount(); await settle(400); await settle(400);
    const heute = () => Array.from(view.container.querySelectorAll<HTMLButtonElement>(".dashboard-segments button")).find((button) => button.textContent === "Heute")!;
    expect(heute().title).toContain("etwas passiert");
    await act(async () => { fireEvent.click(heute()); }); await settle(400); await settle(300);
    expect(view.container.querySelectorAll(".pipeline-card").length).toBe(0);
    const category = () => view.container.querySelector<HTMLSelectElement>("select[aria-label='Nach Lead-Kategorie filtern']");
    const campaign = () => view.container.querySelector<HTMLSelectElement>("select.pipeline-mail-campaign-filter");
    expect(category()).toBeTruthy(); expect(Array.from(category()!.options).slice(1).every((option) => / \(0\)$/.test(option.textContent ?? ""))).toBe(true); expect(category()!.options.length).toBeGreaterThan(1);
    expect(campaign()).toBeTruthy(); expect(campaign()!.options.length).toBeGreaterThan(1);
    const first = (await call("leadops.pipelineOverview", { source: "email" })).stages.flatMap((stage: any) => stage.leads)[0]; await mailToday(first.id);
    await act(async () => { fireEvent.click(Array.from(view.container.querySelectorAll<HTMLButtonElement>(".dashboard-segments button")).find((button) => button.textContent === "7 Tage")!); }); await settle(300);
    await act(async () => { fireEvent.click(heute()); }); await settle(400); await settle(300);
    expect(view.container.querySelectorAll(".pipeline-card").length).toBe(1); expect(category()).toBeTruthy(); expect(campaign()).toBeTruthy();
    expect(Array.from(campaign()!.options).some((option) => / \(1\)$/.test(option.textContent ?? ""))).toBe(true);
  });
});

describe("Pipeline-Karte: Webseite öffnen in einem neuen Fenster (Chat-Build)", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });
  /** Zwei Karten: eine mit Webseite aus der Liste, eine nur mit Freemail-Adresse (keine Webseite bekannt). */
  async function prepare() {
    const cards = (await call("leadops.pipelineOverview", { source: "email" })).stages.flatMap((stage: any) => stage.leads);
    const store = getStore(); const [withSite, without] = cards.slice(0, 2).map((card: any) => store.tables.leads.find((row) => row.id === card.id)!);
    withSite.metadata = { ...((withSite.metadata ?? {}) as Record<string, unknown>), felder: { ...(((withSite.metadata ?? {}) as { felder?: Record<string, string> }).felder ?? {}), Webseite: "www.beispiel-solar.de" } };
    Object.assign(without, { email: "frei-karte@gmx.de", metadata: { ...((without.metadata ?? {}) as Record<string, unknown>), felder: {} } });
    return { withSite, without };
  }
  it("Daten: Karte und Lead-Seite bringen die Webseite als Link mit (Liste vor Firmen-Adresse, Freemail = keine)", async () => {
    const { withSite, without } = await prepare();
    const cards = (await call("leadops.pipelineOverview", { source: "email" })).stages.flatMap((stage: any) => stage.leads);
    expect(cards.find((card: any) => card.id === withSite.id).website).toBe("https://www.beispiel-solar.de/"); expect(cards.find((card: any) => card.id === without.id).website).toBeNull();
    expect((await call("leadops.pipelineLeadDetail", { publicId: withSite.publicId })).website).toBe("https://www.beispiel-solar.de/");
    const store = getStore(); const third = store.tables.leads.find((row) => row.id === cards[2].id)!; Object.assign(third, { email: "info@dritte-firma.de", metadata: { felder: {} } });
    expect((await call("leadops.pipelineOverview", { source: "email" })).stages.flatMap((stage: any) => stage.leads).find((card: any) => card.id === third.id).website).toBe("https://dritte-firma.de/"); // aus der Firmen-Adresse
  });
  it("Oberfläche: Globus-Knopf neben dem Telefon öffnet die Webseite in einem neuen Fenster – die Karte klappt dabei nicht auf; ohne Webseite kein Knopf; auf der Lead-Seite „Webseite“", async () => {
    const { withSite, without } = await prepare();
    window.history.replaceState(null, "", "/?page=Vertriebspipeline&quelle=email");
    const view = mount(); await settle(400); await settle(400);
    const cardOf = (name: string) => Array.from(view.container.querySelectorAll<HTMLElement>(".pipeline-card")).find((card) => card.querySelector(".pipeline-card-name")?.textContent === name)!;
    const nameOf = (lead: any) => `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || lead.publicId;
    const card = cardOf(nameOf(withSite)); expect(card).toBeTruthy();
    const link = card.querySelector<HTMLAnchorElement>("a.pipeline-card-web")!; expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("https://www.beispiel-solar.de/"); expect(link.getAttribute("target")).toBe("_blank"); expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.title).toBe("Webseite öffnen: beispiel-solar.de (neues Fenster)");
    expect(link.parentElement?.className).toContain("pipeline-card-owner"); expect(link.nextElementSibling?.className ?? "").toContain("pipeline-card-phone"); // links neben dem Telefon
    await act(async () => { fireEvent.click(link); }); await settle(100); expect(card.className).not.toContain("is-open");
    expect(cardOf(nameOf(without)).querySelector("a.pipeline-card-web")).toBeNull();
    cleanup(); window.history.replaceState(null, "", `/?page=Vertriebspipeline&quelle=email&lead=${withSite.publicId}`);
    const page = mount(); await settle(400); await settle(400);
    const pageLink = page.container.querySelector<HTMLAnchorElement>("a.lead-page-website")!; expect(pageLink).toBeTruthy(); expect(pageLink.getAttribute("href")).toBe("https://www.beispiel-solar.de/"); expect(pageLink.getAttribute("target")).toBe("_blank"); expect(pageLink.textContent).toContain("Webseite");
  });
});

describe("Posteingang: Antwort mit Interesse → Karte nach „Hat Interesse“ (Chat-Build)", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });
  it("Daten und Oberfläche: interessierte Antwort schiebt die Karte nach „Hat Interesse“ (nicht „Kontaktiert“); der Posteingang zeigt Pipeline und Stufe mit Namen", async () => {
    const stages = await call("leadops.pipelineStages", { source: "email" });
    await call("leadops.savePipelineStages", { source: "email", stages: [stages[0], { key: "hat_interesse", label: "Hat Interesse", hint: "Positive Antwort" }, ...stages.slice(1)] });
    const store = getStore(); const recipients = store.tables.emailCampaignRecipients.filter((row) => row.sentCount > 0 && row.leadId && store.tables.leads.some((lead) => lead.id === row.leadId && lead.kind === "vertrieb"));
    expect(recipients.length).toBeGreaterThan(1); const [hot, cold] = recipients;
    for (const row of [hot, cold]) { Object.assign(row, { repliedAt: null, status: "laeuft" }); Object.assign(store.tables.leads.find((lead) => lead.id === row.leadId)!, { inPipeline: true, adPlatform: "email", pipelineStage: stages[0].key }); }
    const lead = (row: any) => store.tables.leads.find((item) => item.id === row.leadId)!;
    const hotReply = await call("leadops.storeInboxMessage", { fromEmail: hot.email, fromName: "Heiß", subject: "AW: Anfragen", bodyText: "Klingt gut, schicken Sie mir bitte ein Angebot." });
    expect(hotReply.ai).toMatchObject({ kind: "interessiert", action: "markiert" }); expect(lead(hot).pipelineStage).toBe("hat_interesse");
    await call("leadops.storeInboxMessage", { fromEmail: cold.email, fromName: "Kühl", subject: "AW: Anfragen", bodyText: "Danke für die Info, wir melden uns bei Bedarf." });
    expect(lead(cold).pipelineStage).toBe("kontaktiert"); // andere Antwort: wie bisher
    const item = (await call("leadops.listInbox", { filter: "alle" })).items.find((row: any) => row.id === hotReply.id);
    expect(item.lead).toMatchObject({ stage: "hat_interesse", stageName: "Hat Interesse", pipelineName: "E-Mail-Kampagne", inPipeline: true });
    window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=posteingang");
    const view = mount(); await settle(400); await settle(300);
    const entry = Array.from(view.container.querySelectorAll<HTMLButtonElement>("button.inbox-item")).find((button) => (button.textContent ?? "").includes("Heiß"))!; expect(entry).toBeTruthy();
    expect(entry.textContent).toContain("Hat Interesse");
    await act(async () => { fireEvent.click(entry); }); await settle(300);
    const chip = view.container.querySelector<HTMLElement>(".inbox-read-context .inbox-note.is-lead")!; expect(chip.textContent).toContain("In der Pipeline „E-Mail-Kampagne“: Hat Interesse");
    expect(Array.from(view.container.querySelectorAll(".inbox-read-actions button")).some((button) => (button.textContent ?? "").trim() === "In Vertriebspipeline anlegen")).toBe(true); // Knopf bleibt gleich (Formular sagt, wo er steht)
  });
});

describe("Liste aktualisieren: neue Fassung hochladen (Chat-Build)", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });
  const person = (first: string) => ({ firstName: first, lastName: "Demo", company: `${first} Wärme GmbH`, email: `${first.toLowerCase()}@liste-demo.example`, phone: null });
  it("Daten: Vorschau zählt neu / bleiben / werden gelöscht; Übernehmen löscht, wer fehlt (Kunden bleiben), und nimmt Neue auf", async () => {
    await call("leadops.importColdList", { listName: "Demo-Update", rows: [person("Anna"), person("Bert"), person("Cleo")] });
    const store = getStore(); Object.assign(store.tables.leads.find((row) => row.email === "cleo@liste-demo.example")!, { pipelineStage: "kunde" });
    const rows = [person("Anna"), person("Dirk")];
    expect(await call("leadops.previewListUpdate", { listName: "Demo-Update", rows })).toMatchObject({ before: 3, neu: 1, bleiben: 1, entfernen: 1, kundenBleiben: 1 });
    const result = await call("leadops.updateColdList", { listName: "Demo-Update", rows }); expect(result).toMatchObject({ created: 1, removed: 1, keptCustomers: 1 });
    const emails = getStore().tables.leads.filter((row) => row.listName === "Demo-Update").map((row) => row.email).sort();
    expect(emails).toEqual(["anna@liste-demo.example", "cleo@liste-demo.example", "dirk@liste-demo.example"]); // Bert gelöscht, Kundin Cleo bleibt, Dirk neu
  });
  it("Oberfläche (Pipeline Kaltakquise → Listen): „Aktualisieren“ → Datei wählen → Vorschau → „Liste aktualisieren“ mit Rückfrage", async () => {
    await call("leadops.importColdList", { listName: "Demo-Update", rows: [{ ...person("Anna"), phone: "0170 1111111" }, { ...person("Bert"), phone: "0170 2222222" }, { ...person("Cleo"), phone: "0170 3333333" }] });
    window.history.replaceState(null, "", "/?page=Vertriebspipeline&quelle=kaltakquise&ansicht=listen");
    const view = mount(); await settle(400); await settle(300);
    const row = Array.from(view.container.querySelectorAll<HTMLElement>("div")).find((node) => node.querySelector("strong")?.textContent === "Demo-Update" && Array.from(node.querySelectorAll("button")).some((button) => button.textContent?.includes("Aktualisieren")))!; expect(row).toBeTruthy();
    await act(async () => { fireEvent.click(Array.from(row.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Aktualisieren"))!); }); await settle(200);
    const box = view.container.querySelector<HTMLElement>(".list-update")!; expect(box).toBeTruthy(); expect(box.textContent).toContain("Liste „Demo-Update“ aktualisieren");
    const file = new File(["Vorname;Nachname;Firma;Telefon;E-Mail\nAnna;Demo;Anna Wärme GmbH;0170 1111111;anna@liste-demo.example\nDirk;Demo;Dirk Wärme GmbH;0170 4444444;dirk@liste-demo.example\n"], "Demo-Update neu.csv", { type: "text/csv" });
    await act(async () => { fireEvent.change(box.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [file] } }); }); await settle(500); await settle(400);
    const plan = Array.from(view.container.querySelectorAll(".list-update-plan span")).map((node) => node.textContent?.replace(/\s+/g, " ").trim());
    expect(plan).toEqual(["1 neu", "1 bleiben", "2 werden gelöscht"]);
    expect(view.container.querySelector(".list-update-gone summary")?.textContent).toBe("Diese 2 Firmen werden gelöscht");
    await act(async () => { fireEvent.click(Array.from(view.container.querySelectorAll<HTMLButtonElement>(".list-update-actions button")).find((button) => button.textContent?.includes("Liste aktualisieren"))!); }); await settle(200);
    expect(document.querySelector(".app-confirm-text")?.textContent).toContain("2 Kontakte aus „Demo-Update“ löschen");
    await act(async () => { fireEvent.click(document.querySelector<HTMLButtonElement>(".app-confirm-ok")!); }); await settle(400); await settle(300);
    expect(getStore().tables.leads.filter((lead) => lead.listName === "Demo-Update").map((lead) => lead.email).sort()).toEqual(["anna@liste-demo.example", "dirk@liste-demo.example"]);
    expect(view.container.querySelector(".list-update")).toBeNull(); // nach dem Übernehmen zu
  });
});

describe("Pipeline „E-Mail-Kampagne“: PV und WP getrennt, Filter nach Kampagnen (Chat-Build)", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });
  async function wpCampaign() {
    const { starterBlocks } = await import("../../../../shared/email-design");
    await call("leadops.importColdList", { listName: "Trenn-Demo", toPipeline: false, rows: [{ firstName: "Wanda", lastName: "Wärme", company: "Wärme Wanda GmbH", email: "wanda@trenn-demo.example" }] });
    const saved = await call("leadops.saveEmailCampaign", { id: null, name: "Heizungsbauer Nord", leadSparte: "Wärmepumpe", fromName: "T", fromEmail: "t@t.de", replyTo: null, audience: { source: "liste", listName: "Trenn-Demo" }, tree: { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Für {{firma}}", blocks: starterBlocks("kaltakquise"), next: null }] }, design: {}, sendWindow: { enabled: false, weekdays: [1, 2, 3, 4, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin" }, abSplit: 50 });
    await call("leadops.startEmailCampaign", { id: saved.id }); await call("leadops.runEmailCampaigns");
    return saved;
  }
  it("Daten: Karte aus einer Wärmepumpen-Kampagne trägt „Wärmepumpe“ (nicht die gemeinsame); „PV-Betriebe Bayern“ bleibt „Photovoltaik“; Filter zeigt Kampagnen, auch für Kontakte in mehreren", async () => {
    const saved = await wpCampaign(); const store = getStore();
    const wanda = store.tables.leads.find((row) => row.email === "wanda@trenn-demo.example")!; const categoryName = (id: unknown) => store.tables.leadCategories.find((row) => row.id === id)?.name;
    expect(wanda.adPlatform).toBe("email"); expect(categoryName(wanda.categoryId)).toBe("Wärmepumpe");
    const board = await call("leadops.pipelineOverview", { source: "email" }); const names = board.categories.map((item: any) => item.name);
    expect(names).toEqual(expect.arrayContaining(["Photovoltaik", "Wärmepumpe"])); expect(names).not.toContain("Photovoltaik & Wärmepumpe"); // getrennt
    const bayern = store.tables.emailCampaigns.find((row) => row.name === "PV-Betriebe Bayern")!;
    const { insert } = await import("../store"); insert(store, "emailCampaignRecipients", { tenantId: wanda.tenantId, campaignId: bayern.id, leadId: wanda.id, email: wanda.email, name: "Wanda Wärme", status: "fertig", sentCount: 1, createdAt: new Date() } as never);
    const options = (await call("leadops.pipelineOverview", { source: "email" })).campaignOptions; expect(options.map((item: any) => item.campaignName)).toEqual(expect.arrayContaining(["PV-Betriebe Bayern", "Heizungsbauer Nord"])); expect(options.some((item: any) => /^Liste/.test(item.campaignName))).toBe(false);
    const inBayern = (await call("leadops.pipelineOverview", { source: "email", campaignId: `email-${bayern.id}` })).stages.flatMap((stage: any) => stage.leads).map((lead: any) => lead.id); expect(inBayern).toContain(wanda.id); // steckt in beiden Kampagnen
    const inNord = (await call("leadops.pipelineOverview", { source: "email", campaignId: `email-${saved.id}` })).stages.flatMap((stage: any) => stage.leads).map((lead: any) => lead.id); expect(inNord).toEqual([wanda.id]);
  });
  it("Oberfläche: „E-Mail-Kampagne“ und „Lead-Kategorie“ stehen als Paar nebeneinander – erst die Kampagne", async () => {
    await wpCampaign();
    window.history.replaceState(null, "", "/?page=Vertriebspipeline&quelle=email");
    const view = mount(); await settle(400); await settle(400);
    const pair = view.container.querySelector<HTMLElement>(".pipeline-filter-pair")!; expect(pair).toBeTruthy();
    const labels = Array.from(pair.querySelectorAll(".eyebrow")).map((node) => node.textContent); expect(labels).toEqual(["E-MAIL-KAMPAGNE", "LEAD-KATEGORIE"]);
    expect(pair.querySelector("select.pipeline-mail-campaign-filter")).toBeTruthy(); expect(pair.querySelector("select[aria-label='Nach Lead-Kategorie filtern']")).toBeTruthy();
    const categoryTexts = Array.from(pair.querySelector<HTMLSelectElement>("select[aria-label='Nach Lead-Kategorie filtern']")!.options).map((option) => option.textContent ?? "");
    expect(categoryTexts.some((text) => text.includes("Wärmepumpe") && !text.includes("Photovoltaik"))).toBe(true);
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

describe("KI schreibt nach dem Start alle Entwürfe vor – auch außerhalb der Versandzeit (Chat-Build)", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });
  it("Starten mit „KI mit Freigabe“: alle Entwürfe sofort da, obwohl gerade keine Versandzeit ist; ohne Freigabe geht nichts raus; pausiert = kein Vorschreiben", async () => {
    const { starterBlocks } = await import("../../../../shared/email-design");
    await call("leadops.importColdList", { listName: "Nacht-Demo", rows: Array.from({ length: 6 }, (_, index) => ({ firstName: `Nora${index}`, lastName: "Nacht", company: `Nacht Solar ${index}`, email: `nora${index}@nacht-demo.example` })) });
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send", label: "Erste", subject: "Erste an {{firma}}", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait", hours: 24, next: "m2" }, { id: "m2", type: "send", label: "Kurze Nachfrage", subject: "Nachfrage {{firma}}", blocks: starterBlocks("nachfassen"), next: null }] };
    const day = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" })).getDay();
    const closed = { enabled: true, weekdays: [(day + 3) % 7], from: "07:30", to: "08:00", timezone: "Europe/Berlin" }; // heute keine Versandzeit
    const saved = await call("leadops.saveEmailCampaign", { id: null, name: "Nacht-Demo", fromName: "T", fromEmail: "t@t.de", replyTo: null, design: {}, sendWindow: closed, abSplit: 50, audience: { source: "liste", listName: "Nacht-Demo" }, tree, kiModus: "freigabe", kiAnsatz: "frei" });
    await call("leadops.startEmailCampaign", { id: saved.id });
    const rows = getStore().tables.emailCampaignRecipients.filter((item) => item.campaignId === saved.id);
    expect(rows).toHaveLength(6); expect(rows.every((row) => row.draftState === "entwurf" && row.draftNodeId === "m1" && String(row.draftText).length > 40)).toBe(true);
    expect(getStore().tables.emailCampaignEvents.filter((event) => event.campaignId === saved.id && event.kind === "gesendet")).toHaveLength(0); // ohne Freigabe geht nichts raus
    const listed = (await call("leadops.listEmailCampaigns")).find((row: any) => row.id === saved.id); expect(listed.review).toMatchObject({ zurFreigabe: 6, ohneEntwurf: 0, vorschreiben: true });
    const queue = await call("leadops.campaignReviewQueue", { campaignId: saved.id }); expect(queue.prewriting).toBe(true); expect(queue.counts).toMatchObject({ offen: 0, entwurf: 6 });
    // ein Entwurf verworfen → der nächste Lauf schreibt ihn wieder vor, auch außerhalb der Versandzeit
    Object.assign(rows[0], { draftState: null, draftText: null, draftSubject: null, draftOptions: null, draftNodeId: null });
    await call("leadops.runEmailCampaigns"); expect(getStore().tables.emailCampaignRecipients.find((item) => item.id === rows[0].id)).toMatchObject({ draftState: "entwurf", draftNodeId: "m1" });
    await call("leadops.setEmailCampaignStatus", { id: saved.id, status: "pausiert" }); expect((await call("leadops.campaignReviewQueue", { campaignId: saved.id })).prewriting).toBe(false); // pausiert: die KI schreibt nichts vor
  });
});
