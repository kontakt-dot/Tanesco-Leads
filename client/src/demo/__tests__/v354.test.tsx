import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";

/**
 * Version 354 – eine neue Prüffrage gilt auch für ältere Gespräche: Die Antwort wird nachgeholt, die Entscheidung wird nur strenger,
 * der Lead folgt (ausgelieferte bleiben). Über der Liste steht, wie viele noch warten und was sich geändert hat.
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 800) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const open = async (query: string, wait = 2000) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
type Status = { waiting: number; questions: Array<{ label: string; calls: number }>; perMinute: number; paused: boolean; changed: { total: number; rejected: number; review: number; leadsHeld: number; delivered: number } };
type Row = Record<string, unknown>;
const status = async () => await callProcedure("leadops.callRecheckStatus", undefined) as Status;
const NEW_QUESTION = "Wurde am Ende gesagt, dass der Kunde bis zu 3 Angebote von Fachpartnern bekommt?";
const RANK: Record<string, number> = { offen: 0, freigegeben: 0, pruefen: 1, zurueckgewiesen: 2 };

describe("Version 354", () => {
  beforeEach(() => { cleanup(); resetStore(); try { localStorage.removeItem("tanesco-recheck-hidden"); } catch { /* egal */ } });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); try { localStorage.removeItem("tanesco-recheck-hidden"); } catch { /* egal */ } });

  it("Ältere Gespräche bekommen die neue Frage: Hinweis über der Liste, nachholen, nur strenger, Lead folgt, Filter, Merker und Ausblenden", async () => {
    // vorher: Zwei Beispiel-Gespräche fehlen nur Antworten auf Info-Fragen – die werden nachgeholt, ohne etwas zu ändern; danach kein Hinweis
    expect(await status()).toMatchObject({ waiting: 0, changed: { total: 0 } });
    const before = await open("page=Gespräche"); expect(before.querySelector(".gq-recheck")).toBeNull(); cleanup();
    // Vorlage HausKompass für alle Kampagnen: Den älteren Gesprächen fehlen jetzt Antworten – darunter die neue Frage
    await callProcedure("leadops.applyCallQaPreset", { preset: "pv-hauskompass", allCampaigns: true });
    const table = getStore().tables; const candidates = (table.callRecords as Row[]).filter((row) => row.status === "bewertet" && row.transcript); expect(candidates.length).toBeGreaterThan(6);
    const decisionBefore = new Map(candidates.map((row) => [row.id as number, String(row.decision)])); const leadBefore = new Map((table.leads as Row[]).map((row) => [row.id as number, String(row.status)]));
    const first = await status(); expect(first.waiting).toBe(candidates.length - 3); // die Vorschau holt je Abfrage 3 nach expect(first.questions.map((item) => item.label)).toContain(NEW_QUESTION); expect(first.perMinute).toBe(12);
    // über der Liste: wie viele noch warten, welche Frage, was die Regeln sind
    const root = await open("page=Gespräche"); const note = root.querySelector<HTMLElement>('.gq-recheck[aria-label="Prüffragen bei älteren Gesprächen"]')!;
    expect(note).toBeTruthy(); expect(note.classList.contains("is-running") || note.classList.contains("is-done")).toBe(true);
    if (note.classList.contains("is-running")) { expect(note.textContent).toMatch(/Prüffragen werden bei älteren Gesprächen nachgeholt\. Noch \d+ Gespräche?, etwa 12 pro Minute\./); expect(note.textContent).toContain("Die Entscheidung wird dabei nur strenger, nie lockerer."); }
    cleanup();
    // nach und nach: bis nichts mehr wartet
    for (let round = 0; round < 60 && (await status()).waiting > 0; round += 1) { /* jede Abfrage holt die nächsten nach */ }
    const done = await status(); expect(done.waiting).toBe(0);
    // die Regeln: nur strenger; von Hand entschiedene behalten ihre Entscheidung; die Markierung trägt die Entscheidung davor
    const after = (getStore().tables.callRecords as Row[]).filter((row) => decisionBefore.has(row.id as number));
    for (const row of after) {
      const was = decisionBefore.get(row.id as number)!;
      expect(RANK[String(row.decision)]).toBeGreaterThanOrEqual(RANK[was]);
      expect((row.qualificationAnswers as Record<string, unknown>).bis_zu_3_angebote).toBeTruthy();
      if (row.decidedBy === "manuell") expect(row.recheckFrom ?? null).toBeNull();
      if (row.recheckFrom) { expect(row.recheckFrom).toBe(was); expect(String(row.nextStep)).toMatch(/^Nachprüfung: /); }
      else expect(row.decision).toBe(was);
    }
    const changed = after.filter((row) => row.recheckFrom); expect(changed.length).toBe(done.changed.total); expect(done.changed.total).toBeGreaterThan(0);
    expect(done.changed.rejected + done.changed.review).toBe(done.changed.total);
    // der Lead folgt – ausgelieferte bleiben, wie sie waren
    for (const row of changed.filter((item) => item.leadId)) {
      const was = leadBefore.get(row.leadId as number)!; const now = String((getStore().tables.leads as Row[]).find((lead) => lead.id === row.leadId)!.status);
      if (["zugewiesen", "reklamiert", "deaktiviert"].includes(was)) expect(now).toBe(was); else if (row.decision === "zurueckgewiesen") expect(now).toBe("fehlerhaft");
    }
    // fertig: der Hinweis zeigt das Ergebnis – „Diese Gespräche zeigen“ filtert, jede Zeile trägt „nachgeprüft“
    const list = await open("page=Gespräche"); const result = list.querySelector<HTMLElement>(".gq-recheck.is-done")!;
    expect(result.querySelector(".gq-recheck-result")!.textContent).toMatch(new RegExp(`^${done.changed.total} Gespräche? durch die Nachprüfung geändert`));
    await click(result.querySelector(".gq-recheck-show"), 1200); expect(list.querySelector(".gq-recheck-show")!.getAttribute("aria-pressed")).toBe("true");
    const shown = Array.from(list.querySelectorAll(".gq-table tbody tr:not(.gq-day)")); expect(shown.length).toBe(Math.min(done.changed.total, 200));
    expect(list.querySelectorAll(".gq-table .gq-rechecked").length).toBe(shown.length); expect(list.querySelector(".gq-result-line")!.textContent).toContain("Die Liste zeigt nur Gespräche, deren Entscheidung die Nachprüfung geändert hat");
    expect(list.querySelector(".gq-rechecked")!.getAttribute("title")).toMatch(/^Durch die Nachprüfung geändert – vorher „(Freigegeben|Zur Prüfung|Offen)“\. Grund: Nachprüfung: /);
    await click(list.querySelector(".gq-result-line .gq-link"), 900); expect(list.querySelector(".gq-recheck-show")!.getAttribute("aria-pressed")).toBe("false");
    // ausblenden: weg – bis sich wieder etwas ändert
    await click(list.querySelector(".gq-recheck-close"), 300); expect(list.querySelector(".gq-recheck")).toBeNull(); expect(localStorage.getItem("tanesco-recheck-hidden")).toBe(String(done.changed.total));
  }, 120_000);
});
