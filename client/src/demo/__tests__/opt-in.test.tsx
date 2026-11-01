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

describe("Opt-in-Nachweis (Chat-Build, nur Callcenter): Skript, Sprachaufnahme, SMS-Bestätigung, Widerruf, Nachweis-PDF, Telefonie-Konsole, Einstellungen", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } });
  afterEach(() => { cleanup(); });

  it("Seed: Formular-Einwilligungen für neue Meta-Leads und ein gültiges Voice-Opt-in am freigegebenen Gespräch; Gesprächsliste trägt das Schild", async () => {
    const rows = getStore().tables.optIns; expect(rows.length).toBeGreaterThan(3);
    expect(rows.filter((row) => row.kind === "formular" && row.status === "gueltig" && row.grantedTo === "eigen").length).toBeGreaterThan(2);
    const voice = rows.find((row) => row.kind === "sprache")!; expect(voice).toMatchObject({ status: "gueltig", grantedTo: "kaeufer", buyerName: "Aroundhome GmbH, Berlin" }); expect(String(voice.quote)).toContain("Ja, einverstanden"); expect(String(voice.hash)).toMatch(/^[0-9a-f]{16}$/);
    const calls = await call("leadops.listCalls", {}); const withOptIn = calls.find((row: any) => row.id === voice.callRecordId); expect(withOptIn.optIn).toMatchObject({ status: "gueltig", kind: "sprache", buyerName: "Aroundhome GmbH, Berlin" });
    const list = await call("leadops.listOptIns", { publicId: getStore().tables.leads.find((row) => row.id === voice.leadId)!.publicId }); expect(list[0]).toMatchObject({ number: voice.number, status: "gueltig" }); expect(list[0].missing).toEqual([]);
  });

  it("Skript mit Käufer aus der Lieferkette, Voice-Opt-in ohne Anruf (Bestätigung des Agenten), SMS-Bestätigung per Klick, Verwendung, Widerruf → Sperrliste, Nachweis-PDF", async () => {
    const lead = getStore().tables.leads.find((row) => row.kind === "vertrieb" && row.adPlatform === "kaltakquise" && row.phone && row.email && !getStore().tables.optIns.some((item) => item.leadId === row.id))!;
    const settings = await call("leadops.optInSettings"); expect(settings.companyName).toBe("HausKompass (Tanesco Digital GbR)"); expect(settings.privacyUrl).toBe("https://hauskompass.org/datenschutz");
    const script = await call("leadops.optInScript", { publicId: lead.publicId, buyerName: "Müller Solartechnik, Frankfurt" });
    expect(script.script.steps.map((step: any) => step.key)).toEqual(["aufnahme", "einwilligung", "abschluss"]); expect(script.script.steps[1].text).toContain("HausKompass (Tanesco Digital GbR)"); expect(script.script.steps[1].text).toContain("Müller Solartechnik, Frankfurt"); expect(Array.isArray(script.choices)).toBe(true);
    // ohne Anruf: keine Aufnahme – Bestätigung des Agenten zählt, Hinweis auf SMS
    const started = await call("leadops.startVoiceOptIn", { publicId: lead.publicId, dialerCallId: null, buyerName: "Müller Solartechnik, Frankfurt" });
    expect(started.recording.active).toBe(false); expect(started.recording.note).toMatch(/Kein aktiver Anruf/);
    expect((await call("leadops.finishVoiceOptIn", { optInId: started.id, attest: { aufnahme: true, ja: true } })).status).toBe("gueltig");
    let list = await call("leadops.listOptIns", { publicId: lead.publicId }); expect(list[0]).toMatchObject({ id: started.id, kind: "sprache", status: "gueltig", buyerName: "Müller Solartechnik, Frankfurt" }); expect(list[0].warning).toMatch(/Ohne Aufnahme/); expect(list[0].checks.by).toBe("regeln");
    // mit simuliertem Dialer-Anruf: Aufnahme läuft, danach Abschrift und Zitat
    const { insert } = await import("../store"); const callRow = insert(getStore(), "dialerCalls", { tenantId: 1, leadId: lead.id, provider: "simulation", providerCallSid: "CAdemo-optin", mode: "manuell", status: "verbunden", startedAt: new Date(Date.now() - 60_000), answeredAt: new Date(Date.now() - 50_000), fromNumber: "+4969900000", toNumber: lead.phone, autoNotes: true, createdAt: new Date(), updatedAt: new Date() });
    const withCall = await call("leadops.startVoiceOptIn", { publicId: lead.publicId, dialerCallId: callRow.id, buyerName: "Müller Solartechnik, Frankfurt" }); expect(withCall.recording).toMatchObject({ active: true, own: true });
    expect((await call("leadops.finishVoiceOptIn", { optInId: withCall.id, attest: { aufnahme: true, ja: true } })).status).toBe("gueltig");
    const recorded = (await call("leadops.listOptIns", { publicId: lead.publicId })).find((row: any) => row.id === withCall.id); expect(recorded.quote).toContain("Ja, einverstanden"); expect(recorded.recordingUrl).toContain("optin-"); expect(recorded.warning).toBeNull(); expect(recorded.missing).toEqual([]);
    // SMS-Bestätigung: Text mit Firmenname und Link; Klick bestätigt
    const sms = await call("leadops.sendOptInSms", { publicId: lead.publicId, buyerName: "Schmidt Energie, Kassel" });
    expect(sms.text).toContain("Schmidt Energie, Kassel"); expect(sms.text).toContain(sms.link);
    expect(getStore().tables.outboundMessages.some((row) => row.channel === "sms" && row.templateKey === `optin:${sms.id}`)).toBe(true);
    list = await call("leadops.listOptIns", { publicId: lead.publicId }); const pending = list.find((row: any) => row.id === sms.id); expect(pending).toMatchObject({ kind: "sms", status: "offen" }); expect(pending.missing).toEqual(["Bestätigung per Klick"]);
    const token = sms.link.split("/").pop(); expect((await call("demo.confirmOptIn", { token })).already).toBe(false);
    const confirmed = (await call("leadops.listOptIns", { publicId: lead.publicId })).find((row: any) => row.id === sms.id); expect(confirmed.status).toBe("gueltig"); expect(confirmed.confirmedAt).toBeTruthy();
    // Nachweis-PDF
    const pdf = await call("leadops.optInPdf", { id: sms.id }); expect(pdf.base64.startsWith("JVBERi0")).toBe(true); expect(pdf.fileName).toContain(confirmed.number);
    // Widerruf → Sperrliste, nicht anrufen
    expect((await call("leadops.revokeOptIn", { optInId: sms.id, note: "Kunde möchte keinen Kontakt" })).status).toBe("widerrufen");
    expect(getStore().tables.emailSuppressions.some((row) => String(row.email).toLowerCase() === String(lead.email).toLowerCase() && row.source === "widerruf")).toBe(true);
    expect((getStore().tables.leads.find((row) => row.id === lead.id)!.metadata as { doNotCall?: boolean }).doNotCall).toBe(true);
    expect(getStore().tables.pipelineEvents.some((row) => row.leadId === lead.id && /widerrufen/.test(String(row.note)))).toBe(true);
  });

  it("Rohdaten-Kontakt im Callcenter: Skript ohne Lead (pending), beim Start wird der Kontakt zum Lead und am Anruf verknüpft", async () => {
    const raw = getStore().tables.rawContacts.find((row) => !row.leadId && row.phone && ["neu", "in_liste"].includes(String(row.status)))!; expect(raw).toBeTruthy();
    const { insert } = await import("../store"); const callRow = insert(getStore(), "dialerCalls", { tenantId: 1, leadId: null, rawContactId: raw.id, provider: "simulation", providerCallSid: "CAdemo-raw", mode: "power", status: "verbunden", startedAt: new Date(Date.now() - 30_000), answeredAt: new Date(Date.now() - 25_000), fromNumber: "+4969900000", toNumber: raw.phone, autoNotes: true, createdAt: new Date(), updatedAt: new Date() });
    const script = await call("leadops.optInScript", { dialerCallId: callRow.id, buyerName: "Müller Solartechnik, Frankfurt" });
    expect(script.lead.pending).toBe(true); expect(script.lead.publicId).toBeNull(); expect(script.lead.name).toContain(String(raw.firstName ?? raw.company ?? "")); expect(script.existing).toEqual([]); expect(script.script.steps[1].text).toContain("Müller Solartechnik, Frankfurt");
    const started = await call("leadops.startVoiceOptIn", { dialerCallId: callRow.id, buyerName: "Müller Solartechnik, Frankfurt" });
    expect(started.lead.created).toBe(true); expect(started.recording).toMatchObject({ active: true, own: true });
    const lead = getStore().tables.leads.find((row) => row.publicId === started.lead.publicId)!; expect(lead).toBeTruthy(); expect(lead.status).toBe("neu"); expect(lead.phone).toBe(raw.phone);
    expect(getStore().tables.rawContacts.find((row) => row.id === raw.id)!.leadId).toBe(lead.id); expect(getStore().tables.dialerCalls.find((row) => row.id === callRow.id)!.leadId).toBe(lead.id);
    expect((await call("leadops.finishVoiceOptIn", { optInId: started.id, attest: { aufnahme: true, ja: true } })).status).toBe("gueltig");
    const list = await call("leadops.listOptIns", { publicId: lead.publicId }); expect(list).toHaveLength(1); expect(list[0]).toMatchObject({ kind: "sprache", status: "gueltig", buyerName: "Müller Solartechnik, Frankfurt" });
    // zweiter Aufruf: Kontakt ist schon Lead → kein neuer Lead
    const again = await call("leadops.optInScript", { dialerCallId: callRow.id }); expect(again.lead.pending).toBe(false); expect(again.lead.publicId).toBe(lead.publicId); expect(again.existing).toHaveLength(1);
  });

  it("Telefonie → Wählen: „Opt-in aufnehmen“ am laufenden Anruf, Skript → Aufnahme → gespeichert, Stand am Anruf; Lead-Fenster der Pipeline hat keinen Reiter mehr; Telefonie → Einstellungen zeigt die Opt-in-Einstellungen", async () => {
    // Lead mit Nummer, die in der Simulation abgenommen wird (letzte Ziffer ≥ 4)
    const lead = getStore().tables.leads.find((row) => row.kind === "vertrieb" && row.phone && Number(String(row.phone).replace(/\D/g, "").slice(-1)) >= 4 && !getStore().tables.optIns.some((item) => item.leadId === row.id))!; expect(lead).toBeTruthy();
    await call("leadops.startDialerSession", { campaignId: null, mode: "manuell", connection: "browser", agentPhone: null, agentDeviceId: null });
    await call("leadops.placeManualCall", { publicId: lead.publicId });
    await new Promise((resolve) => setTimeout(resolve, 2200)); const session = await call("leadops.currentDialerSession"); expect(session.call.status).toBe("verbunden"); expect(session.call.optIn).toBeNull();
    window.history.replaceState(null, "", "/?page=Telefonie&view=waehlen");
    const view = mount(); await settle(400); await settle(300);
    const button = Array.from(view.container.querySelectorAll<HTMLButtonElement>(".dialer-optin")); expect(button).toHaveLength(1); expect(button[0].textContent).toContain("Opt-in aufnehmen");
    await act(async () => { fireEvent.click(button[0]); }); await settle(500);
    const dialog = document.querySelector(".opt-in-dialog")!; expect(dialog).toBeTruthy(); expect(dialog.textContent).toContain("1. Erlaubnis für die Aufnahme"); expect(dialog.textContent).toContain(String(lead.firstName));
    const input = dialog.querySelector<HTMLInputElement>(".opt-in-input")!; if (!input.value) { await act(async () => { fireEvent.change(input, { target: { value: "Müller Solartechnik, Frankfurt" } }); }); await settle(400); }
    await act(async () => { fireEvent.click(Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find((node) => /Aufnahme starten/.test(node.textContent ?? ""))!); }); await settle(500);
    expect(document.querySelector(".opt-in-dialog .opt-in-rec")?.textContent).toMatch(/Aufnahme/); expect(document.querySelector(".opt-in-dialog")!.textContent).toContain("2. Einwilligung (auf der Aufnahme)");
    await act(async () => { fireEvent.click(document.querySelector<HTMLInputElement>(".opt-in-dialog .opt-in-attest input")!); }); await settle(100);
    await act(async () => { fireEvent.click(Array.from(document.querySelectorAll<HTMLButtonElement>(".opt-in-dialog button")).find((node) => /Aufnahme beenden & speichern/.test(node.textContent ?? ""))!); }); await settle(500);
    expect(document.querySelector(".opt-in-dialog .opt-in-result")?.textContent).toMatch(/Opt-in gültig/);
    await act(async () => { fireEvent.click(Array.from(document.querySelectorAll<HTMLButtonElement>(".opt-in-dialog button")).find((node) => /^Fertig$/.test(node.textContent?.trim() ?? ""))!); }); await settle(600);
    const saved = (await call("leadops.listOptIns", { publicId: lead.publicId }))[0]; expect(saved).toMatchObject({ kind: "sprache", status: "gueltig", dialerCallId: session.call.id }); expect(saved.quote).toContain("Ja, einverstanden");
    const state = view.container.querySelector(".dialer-optin-state"); expect(state).toBeTruthy(); expect(state!.querySelector(".opt-in-badge")?.textContent).toBe("Opt-in gültig"); expect(state!.textContent).toContain("Müller Solartechnik, Frankfurt");
    cleanup();
    // Pipeline: Lead-Fenster ohne Reiter „Opt-in“, Pipeline-Dialer ohne Knopf
    window.history.replaceState(null, "", `/?page=Vertriebspipeline&quelle=kaltakquise&lead=${lead.publicId}`);
    const pipeline = mount(); await settle(400); await settle(300);
    const tabs = Array.from(pipeline.container.querySelectorAll<HTMLButtonElement>(".lead-window-tabs button")).map((node) => node.textContent ?? ""); expect(tabs.length).toBeGreaterThan(3); expect(tabs.some((text) => /Opt-in/.test(text))).toBe(false);
    expect(pipeline.container.querySelector(".dialer-optin")).toBeNull();
    cleanup();
    // Telefonie → Einstellungen: Opt-in-Einstellungen unter den Dialer-Einstellungen
    window.history.replaceState(null, "", "/?page=Telefonie&view=einstellungen");
    const settingsView = mount(); await settle(400); await settle(300);
    const company = settingsView.container.querySelector<HTMLInputElement>('.opt-in-settings input[placeholder="Tanesco Digital GbR"]')!; expect(company).toBeTruthy(); expect(company.value).toBe("HausKompass (Tanesco Digital GbR)");
    expect(settingsView.container.querySelector<HTMLInputElement>('.opt-in-settings input[placeholder="https://…/datenschutz"]')!.value).toBe("https://hauskompass.org/datenschutz");
    expect(settingsView.container.querySelectorAll(".opt-in-settings .opt-in-step").length).toBe(3);
    expect(settingsView.container.querySelector(".opt-in-settings .opt-in-read")?.textContent).toMatch(/Max Mustermann, damit der Fachbetrieb/);
    // Einstellungen ganz allgemein: kein Abschnitt „Opt-in“ mehr
    cleanup(); window.history.replaceState(null, "", "/?page=Einstellungen"); const general = mount(); await settle(400);
    expect(Array.from(general.container.querySelectorAll(".settings-list button")).some((node) => /^Opt-in/.test(node.textContent?.trim() ?? ""))).toBe(false);
  }, 20000);
});
