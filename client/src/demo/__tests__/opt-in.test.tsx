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

describe("Opt-in-Nachweis (Chat-Build): Skript, Sprachaufnahme, SMS-Bestätigung, Widerruf, Nachweis-PDF, Reiter am Lead, Einstellungen", () => {
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
    const settings = await call("leadops.optInSettings"); expect(settings.companyName).toBe("Tanesco Digital GbR");
    const script = await call("leadops.optInScript", { publicId: lead.publicId, buyerName: "Müller Solartechnik, Frankfurt" });
    expect(script.script.steps.map((step: any) => step.key)).toEqual(["aufnahme", "einwilligung", "abschluss"]); expect(script.script.steps[1].text).toContain("Tanesco Digital GbR"); expect(script.script.steps[1].text).toContain("Müller Solartechnik, Frankfurt"); expect(Array.isArray(script.choices)).toBe(true);
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

  it("Reiter „Opt-in“ im Lead-Fenster zeigt die Nachweise mit Status, Zitat und Knöpfen; Einstellungen → Opt-in zeigt Firma, Texte und die Vorschau", async () => {
    const voice = getStore().tables.optIns.find((row) => row.kind === "sprache")!; const lead = getStore().tables.leads.find((row) => row.id === voice.leadId)!;
    window.history.replaceState(null, "", `/?page=Vertriebspipeline&quelle=kaltakquise&lead=${lead.publicId}`);
    const view = mount(); await settle(400); await settle(300);
    const tab = Array.from(view.container.querySelectorAll<HTMLButtonElement>(".lead-window-tabs button")).find((node) => /^Opt-in/.test(node.textContent ?? ""))!; expect(tab).toBeTruthy(); expect(tab.textContent).toMatch(/Opt-in\s*1/);
    await act(async () => { fireEvent.click(tab); }); await settle(400);
    const row = view.container.querySelector(".opt-in-row")!; expect(row).toBeTruthy(); expect(row.classList.contains("is-ok")).toBe(true);
    expect(row.querySelector(".opt-in-badge")?.textContent).toBe("gültig"); expect(row.textContent).toContain("Aroundhome GmbH, Berlin"); expect(row.querySelector(".opt-in-quote")?.textContent).toContain("Ja, einverstanden");
    expect(Array.from(row.querySelectorAll(".opt-in-actions button")).map((node) => node.textContent?.trim())).toEqual(["Nachweis (PDF)", "Link für Käufer", "Widerruf erfassen"]);
    expect(Array.from(row.querySelectorAll(".opt-in-checks li.is-on")).length).toBe(6);
    // SMS-Bestätigung aus dem Reiter heraus
    await act(async () => { fireEvent.click(Array.from(view.container.querySelectorAll<HTMLButtonElement>(".opt-in-head button")).find((node) => /SMS-Bestätigung senden/.test(node.textContent ?? ""))!); }); await settle(200);
    const input = view.container.querySelector<HTMLInputElement>(".opt-in-sms input")!; expect(input).toBeTruthy();
    await act(async () => { fireEvent.change(input, { target: { value: "Neuer Betrieb GmbH, Kassel" } }); }); await settle(100);
    await act(async () => { fireEvent.click(Array.from(view.container.querySelectorAll<HTMLButtonElement>(".opt-in-sms button")).find((node) => /SMS jetzt senden/.test(node.textContent ?? ""))!); }); await settle(500);
    expect(Array.from(view.container.querySelectorAll(".opt-in-row")).some((node) => /SMS-Bestätigung/.test(node.textContent ?? "") && /Neuer Betrieb GmbH, Kassel/.test(node.textContent ?? ""))).toBe(true);
    cleanup();
    window.history.replaceState(null, "", "/?page=Einstellungen&setting=Opt-in");
    const settingsView = mount(); await settle(400); await settle(300);
    const company = settingsView.container.querySelector<HTMLInputElement>('.opt-in-settings input[placeholder="Tanesco Digital GbR"]')!; expect(company).toBeTruthy(); expect(company.value).toBe("Tanesco Digital GbR");
    expect(settingsView.container.querySelectorAll(".opt-in-settings .opt-in-step").length).toBe(3);
    expect(settingsView.container.querySelector(".opt-in-settings .opt-in-read")?.textContent).toMatch(/Max Mustermann, damit der Fachbetrieb/);
  });
});
