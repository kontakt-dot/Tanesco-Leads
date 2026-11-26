import { trpc } from "@/lib/trpc";
import { forgetLeaderboard } from "@/components/AgentLeaderboard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";
import { berlinDay, quotaSentence, quotaWindow, type ReportCard } from "../../../../shared/partner-report";
import { callPeriodSpan, shiftDay } from "../../../../shared/call-period";

/**
 * Version 378 – Integrationen: „PrePing abgelehnt“ und ein Kontingent je Partnerkonto (je Woche, Tag oder Monat) mit „noch nachschieben“.
 * Gespräche → Agenten: Agenten von Hand löschen und zurückholen (die Gespräche bleiben). Zeitraum in Bestenliste und Gesprächsliste:
 * derselbe Wähler mit „Weitere Zeiträume“ wie auf der Leads-Seite (diese Woche, letzte Woche, letzte 2 Wochen, dieser Monat, letzter Monat, zwischen, ab, vor).
 * Feste Uhr: Donnerstag, 19.11.2026, 15:20 Uhr deutscher Zeit.
 */
const NOW = new Date("2026-11-19T14:20:00Z"); const TODAY = "2026-11-19";
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
async function until(check: () => boolean, tries = 40) { for (let index = 0; index < tries && !check(); index += 1) await settle(150); }
const click = async (node: Element | null | undefined, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const change = async (node: Element | null | undefined, value: string, wait = 700) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.change(node!, { target: { value } }); }); await settle(wait); };
const open = async (query: string, wait = 2400) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((node) => (node.textContent ?? "").trim());
const button = (root: ParentNode, text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((node) => (node.textContent ?? "").includes(text));
type Row = Record<string, any>;
const table = (name: string) => (getStore().tables as unknown as Record<string, Row[]>)[name];
const cardsNow = async (input: Record<string, unknown> = {}) => (await callProcedure("leadops.partnerReport", input) as { cards: ReportCard[] }).cards;
type Agent = { name: string; rank: number | null; approved: number; calls: number };
type Board = { period: string; span: { kind: string; fromDay: string | null; toDay: string | null }; agents: Agent[]; totals: { agents: number; approved: number; calls: number; approvedBefore: number | null }; hiddenAgents: Array<{ name: string; calls: number; approved: number; by: string | null }>; recentWins: Array<{ name: string | null }> };
const boardOf = (input: Record<string, unknown>) => callProcedure("leadops.dialerAgentReport", input) as Promise<Board>;
const ranked = (board: Board) => board.agents.filter((agent) => agent.rank !== null);
const rowsOf = (panel: ParentNode) => Array.from(panel.querySelectorAll<HTMLElement>(".bl-rows > li"));
const nameOfRow = (row: HTMLElement) => row.querySelector(".bl-agent-lines b")?.textContent ?? "";
const confirmOk = async () => { await until(() => Boolean(document.querySelector(".app-confirm-ok"))); await click(document.querySelector(".app-confirm-ok"), 900); };
const realMatchMedia = window.matchMedia;
const calm = () => { window.matchMedia = ((query: string) => ({ matches: /reduce/.test(query), media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia; };

describe("Version 378", () => {
  beforeEach(() => { cleanup(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); resetStore(); forgetLeaderboard(); calm(); });
  afterEach(() => { document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); cleanup(); vi.useRealTimers(); window.matchMedia = realMatchMedia; resetStore(); });

  it("Integrationen: „PrePing abgelehnt“ statt „Abgelehnt“ – in Kachel, Balken, Käufer-Tabelle und im Filter der Kontakte", async () => {
    const root = await open("page=Statistik&view=Integrationen"); await until(() => root.querySelectorAll(".pr-card").length > 0);
    const card = root.querySelector<HTMLElement>(".pr-card")!; const counts = (await cardsNow())[0].counts; expect(counts.rejected).toBeGreaterThan(0);
    const tile = Array.from(card.querySelectorAll('section[aria-label="Zustellung"] .pr-tile')).map((node) => [node.querySelector("span")!.textContent, node.querySelector("strong")!.textContent, node.querySelector("small")?.textContent ?? ""])[1];
    expect(tile[0]).toBe("PrePing abgelehnt"); expect(tile[1]).toBe(String(counts.rejected)); expect(tile[2]).toContain("hatte der Partner schon");
    expect(texts(card, ":scope > .pr-table-wrap thead th").slice(0, 4)).toEqual(["Käufer", "Geliefert", "PrePing abgelehnt", "Angenommen"]);
    expect(card.textContent).not.toMatch(/(^|[^g ])Abgelehnt/); // das alte Wort steht nirgends mehr allein da
  }, 40_000);

  it("Kontingent: Die Karte rechnet „noch nachschieben“ aus dem laufenden Zeitraum – nur Angenommene zählen, die Leiste oben zählt alle Kontingente zusammen", async () => {
    const root = await open("page=Statistik&view=Integrationen"); await until(() => root.querySelectorAll(".pr-card").length > 0);
    const cards = await cardsNow(); const first = cards[0]; const quota = first.quota!; expect(quota).toMatchObject({ amount: 25, period: "week", ...quotaWindow("week", berlinDay(new Date())) });
    expect(quota.sent).toBe(quota.accepted + quota.rejected + quota.pending); expect(quota.open).toBe(Math.max(0, 25 - quota.accepted)); expect(quota.open).toBeGreaterThan(0);
    const box = root.querySelector<HTMLElement>(".pr-card .pr-quota")!; expect(box.className).toContain("is-open");
    expect(box.querySelector(".pr-quota-main strong")!.textContent).toBe(String(quota.open)); expect(box.querySelector(".pr-quota-main")!.textContent).toContain("noch nachschieben");
    expect(texts(box, ".pr-quota-steps dt")).toEqual(["Bestellt", "Gesendet", "PrePing abgelehnt", "Angenommen"]); expect(texts(box, ".pr-quota-steps dd")).toEqual([25, quota.sent, quota.rejected, quota.accepted].map(String));
    expect(box.querySelector(".pr-quota-text")!.textContent).toBe(quotaSentence(quota)); expect(quotaSentence(quota)).toContain(`Du musst diese Woche noch ${quota.open} Leads nachschieben.`);
    // unabhängig vom Zeitraum der Seite: Auch mit „Gestern“ zeigt die Karte das Kontingent der laufenden Woche
    expect((await cardsNow({ from: "2020-01-01", to: "2020-01-31" }))[0].quota).toEqual(quota);
    // Leiste über allen Konten: die Summe aller offenen Kontingente
    const pushLeft = cards.filter((item) => item.quota).reduce((sum, item) => sum + item.quota!.open, 0); const rail = root.querySelector<HTMLElement>(".pr-rail")!; expect(rail.className).toContain("has-quota");
    expect(rail.querySelector(".pr-stat.is-push strong")!.textContent).toBe(String(pushLeft)); expect(rail.querySelector(".pr-stat.is-push span")!.textContent).toContain("Noch nachschieben");
    // Konto ohne Kontingent: nur die Einladung, eines einzutragen
    const empty = Array.from(root.querySelectorAll<HTMLElement>(".pr-card")).find((node, index) => !cards[index].quota)!; expect(empty.querySelector(".pr-quota.is-empty")).toBeTruthy(); expect(button(empty, "Kontingent eintragen")).toBeTruthy();
  }, 40_000);

  it("Kontingent eintragen, ändern (je Tag, Woche, Monat) und entfernen – gespeichert am Partnerkonto", async () => {
    const root = await open("page=Statistik&view=Integrationen"); await until(() => root.querySelectorAll(".pr-card").length > 0);
    const cards = await cardsNow(); const index = cards.findIndex((item) => !item.quota); expect(index).toBeGreaterThanOrEqual(0); const accountId = cards[index].account.id;
    const card = () => root.querySelectorAll<HTMLElement>(".pr-card")[index];
    await click(button(card(), "Kontingent eintragen"), 400);
    const form = card().querySelector<HTMLElement>(".pr-quota.is-edit")!; expect(form).toBeTruthy(); expect(texts(form, 'select[aria-label="Zeitraum des Kontingents"] option')).toEqual(["je Woche", "je Tag", "je Monat"]);
    await change(form.querySelector('input[aria-label="Bestellte Leads"]'), "900", 200); await change(form.querySelector('select[aria-label="Zeitraum des Kontingents"]'), "month", 200);
    await click(button(form, "Speichern"), 1200);
    const saved = (await cardsNow()).find((item) => item.account.id === accountId)!.quota!; expect(saved).toMatchObject({ amount: 900, period: "month", ...quotaWindow("month", berlinDay(new Date())) }); expect(saved.open).toBe(900 - saved.accepted);
    expect(table("partnerQuotas").find((row) => row.accountId === accountId)).toMatchObject({ amount: 900, period: "month" });
    await until(() => Boolean(card().querySelector(".pr-quota.is-open, .pr-quota.is-done"))); expect(card().querySelector(".pr-quota-main strong")!.textContent).toBe(saved.open.toLocaleString("de-DE")); expect(card().querySelector(".pr-quota-text")!.textContent).toBe(quotaSentence(saved));
    // entfernen
    await click(card().querySelector(".pr-quota-edit"), 400); expect((card().querySelector('input[aria-label="Bestellte Leads"]') as HTMLInputElement).value).toBe("900"); await click(button(card(), "Kontingent entfernen"), 1200);
    expect((await cardsNow()).find((item) => item.account.id === accountId)!.quota).toBeNull(); await until(() => Boolean(card().querySelector(".pr-quota.is-empty"))); expect(card().querySelector(".pr-quota.is-empty")).toBeTruthy();
  }, 40_000);

  it("Agenten löschen: Der Papierkorb nimmt den Agenten aus der Bestenliste – Plätze und Summen rechnen ohne ihn, seine Gespräche bleiben; „Zurückholen“ bringt ihn wieder", async () => {
    const before = await boardOf({ period: "30" }); const victim = ranked(before)[1]; const callsBefore = table("callRecords").length;
    const root = await open("page=Gespräche&view=Agenten", 1200); const panel = root.querySelector<HTMLElement>(".gq-agents-panel")!; expect(panel).toBeTruthy();
    expect(panel.querySelector(".bl-gone")).toBeNull(); expect(panel.querySelector(".bl-list-count")!.textContent).toBe(`${ranked(before).length} Agenten`);
    const row = rowsOf(panel)[1]; expect(nameOfRow(row)).toBe(victim.name); const trash = row.querySelector<HTMLButtonElement>(".bl-remove")!; expect(trash.getAttribute("aria-label")).toBe(`${victim.name} aus der Bestenliste löschen`);
    // erst nachfragen – „Abbrechen“ ändert nichts
    await click(trash, 300); expect(document.querySelector(".app-confirm-text")!.textContent).toContain(`${victim.name} aus der Bestenliste löschen? Die Gespräche bleiben erhalten.`);
    await click(document.querySelector(".app-confirm-cancel"), 500); expect((await boardOf({ period: "30" })).hiddenAgents).toEqual([]);
    await click(trash, 300); await confirmOk();
    const after = await boardOf({ period: "30" }); expect(ranked(after).map((agent) => agent.name)).toEqual(ranked(before).filter((agent) => agent.name !== victim.name).map((agent) => agent.name));
    expect(after.totals).toMatchObject({ agents: before.totals.agents - 1, approved: before.totals.approved - victim.approved, calls: before.totals.calls - victim.calls }); expect(after.recentWins.some((win) => win.name === victim.name)).toBe(false);
    expect(after.hiddenAgents).toMatchObject([{ name: victim.name, calls: victim.calls, approved: victim.approved }]); expect(after.hiddenAgents[0].by).toBeTruthy();
    expect((await boardOf({ period: "alle" })).agents.some((agent) => agent.name === victim.name)).toBe(false); expect(table("callRecords").length).toBe(callsBefore); // gelöscht ist nur der Platz
    await until(() => Boolean(panel.querySelector(".bl-gone"))); expect(rowsOf(panel).map(nameOfRow)).not.toContain(victim.name); expect(panel.querySelector(".bl-list-count")!.textContent).toBe(`${ranked(after).length} Agenten`);
    expect(panel.querySelector(".bl-team-score .bl-count")!.textContent).toBe(String(after.totals.approved)); expect(panel.querySelector(".bl-cheer")).toBeNull(); // wer aufrückt, hat keinen neuen Lead – es wird nichts gefeiert
    const gone = panel.querySelector<HTMLDetailsElement>(".bl-gone")!; expect(gone.querySelector("summary b")!.textContent).toBe("1 gelöschter Agent"); expect(gone.querySelector("summary span")!.textContent).toBe(`${victim.calls} Gespräche in 30 Tagen – sie zählen in der Bestenliste nicht mit`);
    expect(gone.querySelector(".bl-gone-text b")!.textContent).toBe(victim.name); expect(gone.querySelector(".bl-gone-text small")!.textContent).toContain(`${victim.calls} Gespräche, ${victim.approved} Leads in 30 Tagen · gelöscht am 19.11.2026 von `);
    // die Gespräche stehen weiter in der Liste
    const listed = await callProcedure("leadops.callStatistics", { period: "30", agentName: victim.name }) as { total: number }; expect(listed.total).toBe(victim.calls);
    // zurückholen
    await click(gone.querySelector(".bl-restore"), 1200);
    const back = await boardOf({ period: "30" }); expect(back.hiddenAgents).toEqual([]); expect(ranked(back).map((agent) => [agent.name, agent.approved])).toEqual(ranked(before).map((agent) => [agent.name, agent.approved]));
    await until(() => !panel.querySelector(".bl-gone")); expect(panel.querySelector(".bl-gone")).toBeNull(); expect(rowsOf(panel).map(nameOfRow)).toEqual(ranked(before).slice(0, 10).map((agent) => agent.name)); expect(panel.querySelector(".bl-cheer")).toBeNull();
  }, 40_000);

  it("Sind alle Agenten gelöscht, bleibt die Liste der Gelöschten zum Zurückholen stehen; „Ohne Agent“ hat keinen Papierkorb", async () => {
    const before = await boardOf({ period: "heute" }); expect(ranked(before).length).toBeGreaterThan(0);
    for (const agent of ranked(before)) await callProcedure("leadops.hideAgent", { name: agent.name });
    await expect(callProcedure("leadops.hideAgent", { name: "Ohne Agent" })).rejects.toThrow("kein Agent"); expect(await callProcedure("leadops.hideAgent", { name: ranked(before)[0].name.toUpperCase() })).toMatchObject({ changed: false });
    const root = await open("page=Gespräche&view=Agenten", 1200); const panel = root.querySelector<HTMLElement>(".gq-agents-panel")!;
    await click(Array.from(panel.querySelectorAll<HTMLButtonElement>(".gq-periods button")).find((node) => node.textContent === "Heute"), 900);
    expect(panel.querySelector(".bl-stage.is-empty .bl-stage-empty")!.textContent).toBe("Alle Agenten mit Gesprächen heute sind gelöscht. Unten kannst du sie zurückholen."); expect(rowsOf(panel).length).toBe(0); expect(panel.querySelector(".bl-remove")).toBeNull();
    expect(panel.querySelector(".bl-gone summary b")!.textContent).toBe(`${ranked(before).length} gelöschte Agenten`); expect(panel.querySelectorAll(".bl-gone .bl-restore").length).toBe(ranked(before).length);
  }, 40_000);

  it("Zeitraum der Bestenliste: fünf schnelle Knöpfe und „Weitere Zeiträume“ wie auf der Leads-Seite – feste Zeiträume und zwischen, ab, vor", async () => {
    const root = await open("page=Gespräche&view=Agenten", 1200); const panel = root.querySelector<HTMLElement>(".gq-agents-panel")!;
    expect(texts(panel, ".bl-toolbar .gq-periods button")).toEqual(["Heute", "Gestern", "7 Tage", "30 Tage", "Gesamt"]);
    const more = panel.querySelector<HTMLSelectElement>('.bl-toolbar select[aria-label="Weitere Zeiträume"]')!; expect(Array.from(more.options).map((option) => option.textContent)).toEqual(["Weitere Zeiträume", "Diese Woche", "Letzte Woche", "Letzte 2 Wochen", "Dieser Monat", "Letzter Monat", "Zwischen …", "Ab …", "Vor …"]);
    expect(Array.from(more.querySelectorAll("optgroup")).map((group) => group.label)).toEqual(["Feste Zeiträume", "Eigener Zeitraum"]); expect(more.className).not.toContain("is-on"); expect(panel.querySelector(".gq-dates")).toBeNull();
    const head = () => panel.querySelector(".bl-stage-head > span")?.textContent; const team = () => panel.querySelector(".bl-team-label")?.textContent; const score = () => panel.querySelector(".bl-team-score .bl-count")?.textContent;
    // Letzte Woche: Montag bis Sonntag; kein schneller Knopf ist gedrückt, die Auswahl ist hervorgehoben; verglichen wird mit der Woche davor
    await change(more, "letzte_woche"); const lastWeek = await boardOf({ period: "letzte_woche" });
    expect(lastWeek.span).toEqual({ kind: "letzte_woche", fromDay: "2026-11-09", toDay: "2026-11-15" }); expect(head()).toBe("Letzte Woche"); expect(team()).toBe("Team letzte Woche"); expect(score()).toBe(String(lastWeek.totals.approved));
    expect(more.className).toContain("is-on"); expect(panel.querySelector(".bl-toolbar .gq-periods button.active")).toBeNull(); expect(lastWeek.totals.approvedBefore).not.toBeNull();
    if (lastWeek.totals.approvedBefore) expect(panel.querySelector(".bl-team-change")!.textContent).toMatch(/ % zur Woche davor$/);
    expect(texts(panel, ".bl-team-facts dt")).not.toContain("heute"); expect(panel.querySelector(".bl-leads-top em")).toBeNull(); expect(panel.querySelector(".bl-pod-facts .is-today")).toBeNull(); // ein abgeschlossener Zeitraum: kein „+2 heute“
    expect(rowsOf(panel).map(nameOfRow)).toEqual(ranked(lastWeek).slice(0, 10).map((agent) => agent.name));
    // dieselben Tage wie von/bis – und mindestens so viele Gespräche, wie an diesen Tagen in der Liste stehen (dazu kommen Anrufe des eigenen Dialers ohne Gespräch)
    const days = (from: string, to: string) => table("callRecords").filter((row) => { const day = row.startedAt ? berlinDay(new Date(row.startedAt)) : ""; return day >= from && day <= to; }).length; const sameDays = async (from: string | null, to: string | null) => (await boardOf({ from, to })).totals.calls;
    expect(lastWeek.totals.calls).toBe(await sameDays("2026-11-09", "2026-11-15")); expect(lastWeek.totals.calls).toBeGreaterThanOrEqual(days("2026-11-09", "2026-11-15")); expect(days("2026-11-09", "2026-11-15")).toBeGreaterThan(0);
    // Diese Woche, dieser Monat, letzter Monat, letzte 2 Wochen
    for (const [key, label, inText] of [["woche", "Diese Woche", "diese Woche"], ["letzte_2_wochen", "Letzte 2 Wochen", "in den letzten 2 Wochen"], ["monat", "Dieser Monat", "diesen Monat"], ["letzter_monat", "Letzter Monat", "letzten Monat"]] as const) {
      await change(more, key); const board = await boardOf({ period: key }); const span = callPeriodSpan({ period: key }, TODAY); expect(board.span, key).toEqual(span);
      expect(head(), key).toBe(label); expect(team(), key).toBe(`Team ${inText}`); expect(score(), key).toBe(String(board.totals.approved)); expect(board.totals.calls, key).toBe(await sameDays(span.fromDay, span.toDay)); expect(board.totals.calls, key).toBeGreaterThanOrEqual(days(span.fromDay!, span.toDay ?? TODAY));
    }
    // Zwischen: zwei Felder; die Überschrift nennt die Tage, verglichen wird mit genauso vielen Tagen davor
    await change(more, "zwischen", 400); expect(texts(panel, ".gq-dates label")).toEqual(["von", "bis"]); expect(head()).toBe("Gesamt"); // noch kein Tag gewählt: alles
    await change(panel.querySelector('input[aria-label="Datum von"]'), "2026-11-10"); await change(panel.querySelector('input[aria-label="Datum bis"]'), "2026-11-14");
    const between = await boardOf({ from: "2026-11-10", to: "2026-11-14" }); expect(between.period).toBe("zwischen"); expect(head()).toBe("10.11.–14.11.2026"); expect(team()).toBe("Team vom 10.11. bis 14.11.2026"); expect(score()).toBe(String(between.totals.approved)); expect(between.totals.calls).toBeGreaterThanOrEqual(days("2026-11-10", "2026-11-14")); expect(between.totals.calls).toBeLessThan((await boardOf({ period: "30" })).totals.calls);
    if (between.totals.approvedBefore) expect(panel.querySelector(".bl-team-change")!.textContent).toMatch(/ % zu den 5 Tagen davor$/);
    // Ab: ein Feld, läuft bis heute. Vor: der gewählte Tag zählt nicht mehr mit.
    await change(more, "ab", 400); expect(texts(panel, ".gq-dates label")).toEqual(["ab"]); expect((panel.querySelector('input[aria-label="Datum ab"]') as HTMLInputElement).value).toBe("2026-11-10"); await settle(500);
    expect(head()).toBe("ab 10.11.2026"); expect(team()).toBe("Team seit dem 10.11.2026"); expect((await boardOf({ from: "2026-11-10" })).totals.calls).toBeGreaterThanOrEqual(days("2026-11-10", TODAY)); expect(score()).toBe(String((await boardOf({ from: "2026-11-10" })).totals.approved));
    await change(more, "vor", 400); expect(texts(panel, ".gq-dates label")).toEqual(["vor"]); await change(panel.querySelector('input[aria-label="Datum vor"]'), "2026-11-10");
    const beforeDay = await boardOf({ to: "2026-11-09" }); expect(beforeDay.period).toBe("vor"); expect(head()).toBe("vor 10.11.2026"); expect(team()).toBe("Team vor dem 10.11.2026"); expect(score()).toBe(String(beforeDay.totals.approved)); expect(panel.querySelector(".bl-team-change")).toBeNull(); expect(beforeDay.totals.approvedBefore).toBeNull();
    // zurücksetzen führt zum Zeitraum beim Öffnen (30 Tage)
    await click(button(panel, "Datum zurücksetzen"), 800); expect(head()).toBe("30 Tage"); expect(panel.querySelector(".gq-dates")).toBeNull(); expect(panel.querySelector(".bl-toolbar .gq-periods button.active")!.textContent).toBe("30 Tage"); expect(more.value).toBe("");
  }, 60_000);

  it("„Gespräche“ in der Bestenliste öffnet die Liste mit demselben Zeitraum – auch mit einem festen oder eigenen", async () => {
    const root = await open("page=Gespräche&view=Agenten", 1200); const panel = () => root.querySelector<HTMLElement>(".gq-agents-panel")!;
    await change(panel().querySelector('select[aria-label="Weitere Zeiträume"]'), "letzte_woche"); const board = await boardOf({ period: "letzte_woche" }); const agent = ranked(board)[0];
    expect(nameOfRow(rowsOf(panel())[0])).toBe(agent.name); await click(rowsOf(panel())[0].querySelector(".bl-open"), 1000);
    expect(root.querySelector(".gq-agents-panel")).toBeNull(); const list = root.querySelector<HTMLElement>(".cq-list-panel")!; expect(root.querySelector(".gq-pick-button.has-value b")?.textContent).toBe(agent.name);
    expect((list.querySelector('select[aria-label="Weitere Zeiträume"]') as HTMLSelectElement).value).toBe("letzte_woche"); expect(list.querySelector(".gq-periods button.active")).toBeNull(); expect(root.querySelectorAll(".flux-table tbody tr.gq-call").length).toBe(agent.calls);
    // eigener Zeitraum: Die Liste zeigt dieselben Tage in ihren Datumsfeldern
    await click(button(root, "Agenten"), 1000); await change(panel().querySelector('select[aria-label="Weitere Zeiträume"]'), "zwischen", 400);
    await change(panel().querySelector('input[aria-label="Datum von"]'), "2026-11-10"); await change(panel().querySelector('input[aria-label="Datum bis"]'), "2026-11-14");
    const own = await boardOf({ from: "2026-11-10", to: "2026-11-14" }); const top = ranked(own)[0]; expect(nameOfRow(rowsOf(panel())[0])).toBe(top.name); await click(rowsOf(panel())[0].querySelector(".bl-open"), 1000);
    const again = root.querySelector<HTMLElement>(".cq-list-panel")!; expect((again.querySelector('select[aria-label="Weitere Zeiträume"]') as HTMLSelectElement).value).toBe("zwischen");
    expect((again.querySelector('input[aria-label="Datum von"]') as HTMLInputElement).value).toBe("2026-11-10"); expect((again.querySelector('input[aria-label="Datum bis"]') as HTMLInputElement).value).toBe("2026-11-14"); expect(root.querySelectorAll(".flux-table tbody tr.gq-call").length).toBe(top.calls);
  }, 60_000);

  it("Gesprächsliste: derselbe Zeitraum-Wähler – feste Zeiträume filtern die Liste, „Vor …“ lässt den gewählten Tag weg", async () => {
    const root = await open("page=Gespräche", 1400); const bar = root.querySelector<HTMLElement>(".cq-filterbar")!; expect(bar).toBeTruthy();
    expect(texts(bar, ".gq-periods button")).toEqual(["Heute", "Gestern", "7 Tage", "30 Tage", "Gesamt"]); const more = bar.querySelector<HTMLSelectElement>('select[aria-label="Weitere Zeiträume"]')!; expect(more.options.length).toBe(9); expect(bar.querySelector(".gq-dates")).toBeNull();
    const total = async (input: Record<string, unknown>) => (await callProcedure("leadops.callStatistics", input) as { total: number }).total; const all = await total({ period: "alle" });
    await change(more, "letzter_monat", 900); const october = await total({ period: "letzter_monat" }); expect(october).toBeGreaterThan(0); expect(october).toBeLessThan(all); expect(await total({ from: "2026-10-01", to: "2026-10-31" })).toBe(october);
    expect(more.className).toContain("is-on"); expect(bar.querySelector(".gq-periods button.active")).toBeNull(); expect(root.textContent).toContain(`${october.toLocaleString("de-DE")} ${october === 1 ? "Gespräch" : "Gespräche"}`);
    await change(more, "vor", 400); await change(bar.querySelector('input[aria-label="Datum vor"]'), "2026-11-10", 900);
    const before = await total({ to: "2026-11-09" }); expect(before).toBeLessThan(all); expect(root.textContent).toContain(`${before.toLocaleString("de-DE")} ${before === 1 ? "Gespräch" : "Gespräche"}`);
    expect(await total({ to: "2026-11-09" })).toBe(table("callRecords").filter((row) => row.startedAt && berlinDay(new Date(row.startedAt)) <= shiftDay("2026-11-10", -1)).length);
    await click(button(bar, "Datum zurücksetzen"), 800); expect(bar.querySelector(".gq-dates")).toBeNull(); expect(bar.querySelector(".gq-periods button.active")!.textContent).toBe("Gesamt"); expect(root.textContent).toContain(`${all.toLocaleString("de-DE")} Gespräche`);
  }, 60_000);
});
