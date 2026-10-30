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
const actionTexts = (root: HTMLElement) => Array.from(root.querySelectorAll(".inbox-read-actions button")).map((node) => node.textContent?.trim() ?? "");

describe("Posteingang: „In Vertriebspipeline anlegen“ mit Stufen-Vorschlag und KI-Schreibhilfe statt „KI-Antwort vorschlagen“ (Chat-Build)", () => {
  beforeEach(() => { resetStore(); try { localStorage.clear(); } catch { /* egal */ } window.history.replaceState(null, "", "/?page=E-Mail-Kampagnen&ansicht=posteingang"); });
  afterEach(() => { cleanup(); });

  it("Knopf heißt „In Vertriebspipeline anlegen“ (auch wenn der Kontakt schon in einer Pipeline steht), kein „KI-Antwort vorschlagen“ mehr; das Formular zeigt den Vorschlag der Stufe", async () => {
    const view = mount(); await settle(300); await settle(300);
    const item = (name: string) => Array.from(view.container.querySelectorAll<HTMLButtonElement>(".inbox-item")).find((node) => node.textContent?.includes(name))!;
    // Markus Mayer: noch kein Lead
    await act(async () => { fireEvent.click(item("Markus Mayer")); }); await settle(300);
    let actions = actionTexts(view.container);
    expect(actions.some((text) => text.includes("In Vertriebspipeline anlegen"))).toBe(true);
    expect(actions.some((text) => /KI-Antwort vorschlagen|Stufe setzen|Als Lead in Pipeline/.test(text))).toBe(false);
    await act(async () => { fireEvent.click(Array.from(view.container.querySelectorAll<HTMLButtonElement>(".inbox-read-actions button")).find((node) => node.textContent?.includes("In Vertriebspipeline anlegen"))!); }); await settle(300);
    expect(view.container.querySelector(".inbox-lead-form-head strong")?.textContent).toBe("In Vertriebspipeline anlegen");
    const suggest = view.container.querySelector(".inbox-lead-suggest"); expect(suggest?.textContent).toMatch(/^Vorschlag( der KI)?: /);
    const stageSelect = view.container.querySelector<HTMLSelectElement>(".inbox-lead-fields select")!; const chosen = stageSelect.selectedOptions[0]?.textContent ?? "";
    expect(suggest?.querySelector("strong")?.textContent).toBe(chosen); // der Vorschlag ist vorausgewählt
    expect(Array.from(view.container.querySelectorAll(".inbox-lead-form-actions button")).map((node) => node.textContent)).toEqual(["In Vertriebspipeline anlegen", "Abbrechen"]);
    // Peter Hansen: steht schon als Lead in der Pipeline → gleicher Knopf, Kopf sagt, wo er steht; Antwort zeigt Interesse → Vorschlag der KI
    await act(async () => { fireEvent.click(item("Peter Hansen")); }); await settle(300);
    actions = actionTexts(view.container); expect(actions.some((text) => text.includes("In Vertriebspipeline anlegen"))).toBe(true); expect(actions.some((text) => text.includes("Stufe setzen"))).toBe(false);
    await act(async () => { fireEvent.click(Array.from(view.container.querySelectorAll<HTMLButtonElement>(".inbox-read-actions button")).find((node) => node.textContent?.includes("In Vertriebspipeline anlegen"))!); }); await settle(300);
    expect(view.container.querySelector(".inbox-lead-form-head strong")?.textContent).toMatch(/^In der Vertriebspipeline einordnen – steht schon in „/);
    const hansen = view.container.querySelector(".inbox-lead-suggest")!; const items = await call("leadops.listInbox", { filter: "alle" }); const message = items.items.find((row: any) => row.fromName === "Peter Hansen");
    const stages = await call("leadops.pipelineStages", { source: "kaltakquise" }); const index = (key: string) => stages.findIndex((stage: any) => stage.key === key); const suggested = stages.find((stage: any) => /interess|qualifiz/i.test(stage.label));
    if (message?.ai?.kind === "interessiert") {
      expect(hansen.classList.contains("is-interest")).toBe(true);
      if (index(message.lead.stage) > index(suggested.key)) { expect(hansen.textContent).toMatch(/^Bleibt in .+ – schon weiter als der Vorschlag „.+“ \(die Antwort zeigt Interesse\)$/); expect(view.container.querySelector<HTMLSelectElement>(".inbox-lead-fields select")!.value).toBe(message.lead.stage); } // kein Schritt zurück
      else expect(hansen.textContent).toMatch(/Vorschlag der KI: .+ – die Antwort zeigt Interesse/);
    } else expect(hansen.textContent).toMatch(/^Vorschlag/);
    expect(Array.from(view.container.querySelectorAll(".inbox-lead-form-actions button")).map((node) => node.textContent)).toEqual(["Einordnen", "Abbrechen"]);
  });

  it("KI-Schreibhilfe unten im Antwortbereich: kurze Vorgabe → Text landet im Antwortfeld, nichts wird gesendet; mit Entwurf heißt der Knopf „Entwurf überarbeiten“", async () => {
    const view = mount(); await settle(300); await settle(300);
    await act(async () => { fireEvent.click(Array.from(view.container.querySelectorAll<HTMLButtonElement>(".inbox-item")).find((node) => node.textContent?.includes("Markus Mayer"))!); }); await settle(300);
    const sentBefore = getStore().tables.outboundMessages.length;
    const briefInput = view.container.querySelector<HTMLInputElement>(".inbox-ai-brief-input")!; expect(briefInput).toBeTruthy();
    expect(view.container.querySelector(".inbox-ai-mic")).toBeTruthy(); // Mikrofon zum Einsprechen
    const writeButton = () => view.container.querySelector<HTMLButtonElement>(".inbox-ai-write")!;
    expect(writeButton().disabled).toBe(true); expect(writeButton().textContent).toContain("E-Mail schreiben lassen");
    await act(async () => { fireEvent.change(briefInput, { target: { value: "Termin nächste Woche anbieten, Dienstag oder Donnerstag" } }); }); await settle(50);
    expect(writeButton().disabled).toBe(false);
    await act(async () => { fireEvent.click(writeButton()); }); await settle(400);
    const reply = view.container.querySelector<HTMLTextAreaElement>(".inbox-compose-text")!;
    expect(reply.value).toMatch(/^Guten Tag Markus Mayer,\n\nvielen Dank für Ihre Nachricht\.\n\nTermin nächste Woche anbieten, Dienstag oder Donnerstag\.$/);
    expect(getStore().tables.outboundMessages.length).toBe(sentBefore); // nur eingefügt, nicht gesendet
    expect(writeButton().textContent).toContain("Entwurf überarbeiten");
    // Enter in der Vorgabe-Zeile löst das Schreiben aus; mit Entwurf wird daran angehängt (überarbeitet)
    await act(async () => { fireEvent.change(briefInput, { target: { value: "bitte auch die Telefonnummer erwähnen" } }); }); await settle(50);
    await act(async () => { fireEvent.keyDown(briefInput, { key: "Enter" }); }); await settle(400);
    expect(reply.value).toMatch(/Termin nächste Woche anbieten, Dienstag oder Donnerstag\.\n\nBitte auch die Telefonnummer erwähnen\.$/);
    expect(getStore().tables.outboundMessages.length).toBe(sentBefore);
  });
});
