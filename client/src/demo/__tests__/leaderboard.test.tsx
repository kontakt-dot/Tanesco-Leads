import { trpc } from "@/lib/trpc";
import { forgetLeaderboard } from "@/components/AgentLeaderboard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";
import { insert } from "../store";

/**
 * Bestenliste der Agenten (Gespräche → Agenten): Treppchen, Mannschaft, zuletzt erreichte Leads, Bestwerte, Rangliste mit
 * Auf- und Abstieg, Serie und Stufe – dazu Zeitraum, Kampagne, Suche, die Feier bei einem neuen Lead und die Großansicht.
 * Feste Uhr: Donnerstag, 19.11.2026, 15:20 Uhr deutscher Zeit – die Vorschau-Daten entstehen daraus immer gleich.
 */
const NOW = new Date("2026-11-19T14:20:00Z");
type Agent = { userId: number | null; name: string; rank: number | null; approved: number; evaluated: number; calls: number; greenRate: number | null; streak: number; approvedToday: number; rankChange: number | null; previousRank: number | null; isNew: boolean; approvedAllTime: number; level: { index: number; name: string; next: { name: string; missing: number } | null }; gap: { rank: number; missing: number } | null };
type Report = { period: string; campaign: string | null; today: string; agents: Agent[]; totals: { approved: number; calls: number; approvedToday: number; approvedBefore: number | null; evaluated: number }; awards: Array<{ key: string; name: string; value: number; extra: number | string | null }>; recentWins: Array<{ callId: number; name: string | null; campaign: string | null }> };
const reportOf = (input: Record<string, unknown>) => callProcedure("leadops.dialerAgentReport", input) as Promise<Report>;
const ranked = (report: Report) => report.agents.filter((agent) => agent.rank !== null);

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  const view = render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
  return { view, queryClient };
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 500) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
/** „Weniger Bewegung“ am Gerät ein- oder ausschalten – eingeschaltet stehen die Zahlen sofort da. */
const realMatchMedia = window.matchMedia;
const calm = (on: boolean) => { window.matchMedia = ((query: string) => ({ matches: on && /reduce/.test(query), media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia; };
async function openBoard() {
  window.history.replaceState(null, "", "/?page=Gespräche&view=Agenten"); const mounted = mount(); await settle(900);
  const panel = mounted.view.container.querySelector<HTMLElement>(".gq-agents-panel")!; expect(panel).toBeTruthy();
  return { ...mounted, root: mounted.view.container, panel };
}
const rowsOf = (panel: HTMLElement) => Array.from(panel.querySelectorAll<HTMLElement>(".bl-rows > li"));
const nameOfRow = (row: HTMLElement) => row.querySelector(".bl-agent-lines b")?.textContent ?? "";

describe("Gespräche – Bestenliste der Agenten", () => {
  beforeEach(() => { cleanup(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); resetStore(); forgetLeaderboard(); calm(true); });
  afterEach(() => { cleanup(); vi.useRealTimers(); window.matchMedia = realMatchMedia; document.documentElement.classList.remove("bl-wide-open"); resetStore(); });

  it("Bühne: die ersten drei auf dem Treppchen – der Erste mit Krone in der Mitte –, daneben die Mannschaft und die zuletzt erreichten Leads", async () => {
    const report = await reportOf({ period: "30" }); const top = ranked(report).slice(0, 3); expect(top.length).toBe(3);
    const { panel } = await openBoard();
    const stage = panel.querySelector<HTMLElement>(".bl-stage")!; expect(stage).toBeTruthy(); expect(stage.querySelector(".bl-stage-head h2")?.textContent).toBe("Bestenliste"); expect(stage.querySelector(".bl-stage-head > span")?.textContent).toBe("30 Tage");
    const pods = Array.from(stage.querySelectorAll<HTMLElement>(".bl-podium > li")); expect(pods.map((pod) => pod.className.match(/is-p\d/)?.[0])).toEqual(["is-p1", "is-p2", "is-p3"]);
    expect(pods.map((pod) => pod.querySelector(".bl-pod-name")?.textContent)).toEqual(top.map((agent) => agent.name));
    expect(pods.map((pod) => pod.querySelector(".bl-pod-score .bl-count")?.textContent)).toEqual(top.map((agent) => String(agent.approved))); // „weniger Bewegung“: Zahlen stehen sofort da
    expect(pods.map((pod) => pod.querySelector(".bl-step span")?.textContent)).toEqual(["1", "2", "3"]);
    expect(pods[0].querySelector(".bl-crown")).toBeTruthy(); expect(pods[1].querySelector(".bl-crown")).toBeNull();
    expect(pods[0].getAttribute("aria-label")).toBe(`Platz 1: ${top[0].name}, ${top[0].approved} Leads`);
    const lead = top[0].approved - top[1].approved; expect(pods[0].querySelector(".bl-step small")?.textContent).toBe(lead > 0 ? `${lead} ${lead === 1 ? "Lead" : "Leads"} Vorsprung` : "gleichauf mit Platz 2");
    expect(pods[1].querySelector(".bl-step small")?.textContent).toBe(top[1].gap!.missing === 0 ? "gleichauf mit Platz 1" : `noch ${top[1].gap!.missing} bis Platz 1`);
    top.forEach((agent, index) => {
      const facts = Array.from(pods[index].querySelectorAll(".bl-pod-facts li")).map((node) => node.textContent);
      expect(facts).toContain(`${agent.greenRate} % Quote`); if (agent.streak >= 2) expect(facts).toContain(`${agent.streak} Tage`); if (agent.approvedToday > 0) expect(facts).toContain(`+${agent.approvedToday} heute`);
      expect(pods[index].querySelector(".bl-pod-sub > span")?.textContent).toBe(agent.level.name);
    });
    // Mannschaft
    const team = stage.querySelector<HTMLElement>(".bl-team")!; expect(team.querySelector(".bl-team-label")?.textContent).toBe("Team in 30 Tagen"); expect(team.querySelector(".bl-team-score .bl-count")?.textContent).toBe(String(report.totals.approved));
    const change = Math.round(((report.totals.approved - report.totals.approvedBefore!) / report.totals.approvedBefore!) * 100); expect(report.totals.approvedBefore).toBeGreaterThan(0);
    expect(team.querySelector(".bl-team-change")?.textContent).toBe(`${change > 0 ? "+" : change < 0 ? "−" : "±"}${Math.abs(change)} % zu den 30 Tagen davor`);
    const facts = Object.fromEntries(Array.from(team.querySelectorAll(".bl-team-facts > div")).map((node) => [node.querySelector("dt")!.textContent, node.querySelector("dd")!.textContent]));
    expect(facts).toMatchObject({ heute: `+${report.totals.approvedToday}`, Gespräche: String(report.totals.calls), Quote: `${Math.round((report.totals.approved / report.totals.evaluated) * 100)} %` }); expect(facts["am Telefon"]).toMatch(/^\d+ h \d+ min$/);
    // zuletzt erreicht: der jüngste Lead oben
    const feed = Array.from(stage.querySelectorAll<HTMLElement>(".bl-feed li")); expect(feed.length).toBe(5);
    expect(feed.map((item) => item.querySelector("b")?.textContent)).toEqual(report.recentWins.slice(0, 5).map((win) => win.name)); expect(feed.map((item) => item.querySelector("small")?.textContent)).toEqual(report.recentWins.slice(0, 5).map((win) => win.campaign));
    for (const item of feed) expect(item.querySelector("time")?.textContent).toMatch(/^(gerade eben|vor \d+ (Min\.|Std\.))$/);
    expect(panel.querySelector(".bl-live")?.textContent).toBe("Stand 15:20 Uhr");
    expect(panel.querySelector(".gq-stats")).toBeNull(); expect(panel.querySelector(".gq-alist")).toBeNull(); // die Auswertung von früher ist weg
  });

  it("Bestwerte: je Bestwert eine Kachel – wer, wie viel und woran es liegt", async () => {
    const report = await reportOf({ period: "30" }); const { panel } = await openBoard();
    const tiles = Array.from(panel.querySelectorAll<HTMLElement>(".bl-awards > li")); expect(tiles.length).toBe(report.awards.length); expect(tiles.length).toBeGreaterThanOrEqual(5);
    const titles: Record<string, string> = { quote: "Beste Quote", serie: "Längste Serie", tag: "Bester Tag", aufsteiger: "Aufsteiger", gespraeche: "Meiste Gespräche", telefon: "Am Telefon", termine: "Meiste Termine" };
    expect(tiles.map((tile) => tile.querySelector(".bl-award-title")?.textContent)).toEqual(report.awards.map((award) => titles[award.key]));
    expect(tiles.map((tile) => tile.querySelector(".bl-award-who > span:last-child")?.textContent)).toEqual(report.awards.map((award) => award.name));
    const tile = (key: string) => tiles[report.awards.findIndex((award) => award.key === key)]; const award = (key: string) => report.awards.find((item) => item.key === key)!;
    expect(tile("quote").querySelector(".bl-award-value")?.textContent).toBe(`${award("quote").value} %`); expect(tile("quote").querySelector("small")?.textContent).toBe(`grün bei ${award("quote").extra} bewerteten Gesprächen`);
    expect(tile("serie").querySelector(".bl-award-value")?.textContent).toBe(`${award("serie").value} Tage`);
    expect(tile("tag").querySelector(".bl-award-value")?.textContent).toBe(`${award("tag").value} Leads`); expect(tile("tag").querySelector("small")?.textContent).toMatch(/^am (Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag), \d+\. (Oktober|November)$/);
    expect(tile("aufsteiger").querySelector(".bl-award-value")?.textContent).toBe(`+${award("aufsteiger").value} ${award("aufsteiger").value === 1 ? "Platz" : "Plätze"}`); expect(tile("aufsteiger").querySelector("small")?.textContent).toBe(`von Platz ${award("aufsteiger").extra} auf Platz ${Number(award("aufsteiger").extra) - award("aufsteiger").value}`);
    expect(tile("gespraeche").querySelector(".bl-award-value")?.textContent).toBe(String(award("gespraeche").value)); expect(tile("telefon").querySelector(".bl-award-value")?.textContent).toMatch(/^\d+ h \d+ min$/);
  });

  it("Rangliste: zehn Plätze mit Stufe, Abstand nach vorn, Auf- und Abstieg und Serie – „Alle anzeigen“ zeigt den Rest, die Suche findet jeden", async () => {
    const report = await reportOf({ period: "30" }); const all = ranked(report); expect(all.length).toBeGreaterThan(12);
    const { panel } = await openBoard();
    expect(panel.querySelector(".bl-list-head h3")?.textContent).toBe("Rangliste"); expect(panel.querySelector(".bl-list-count")?.textContent).toBe(`${all.length} Agenten`);
    expect(Array.from(panel.querySelectorAll(".bl-row.is-head > span")).map((node) => node.textContent)).toEqual(["Platz", "Agent", "Leads", "Quote", "Gespräche", "Serie", "Ergebnis der Gespräche", ""]);
    let rows = rowsOf(panel); expect(rows.length).toBe(10);
    expect(rows.map(nameOfRow)).toEqual(all.slice(0, 10).map((agent) => agent.name)); expect(rows.map((row) => row.querySelector(".bl-place b")?.textContent)).toEqual(all.slice(0, 10).map((agent) => String(agent.rank)));
    expect(rows.slice(0, 4).map((row) => ["is-p1", "is-p2", "is-p3"].find((name) => row.classList.contains(name)) ?? null)).toEqual(["is-p1", "is-p2", "is-p3", null]); // Gold, Silber, Bronze
    const most = all[0].approved;
    all.slice(0, 10).forEach((agent, index) => {
      const row = rows[index]; const level = row.querySelector<HTMLElement>(".bl-level")!;
      expect(level.textContent).toBe(agent.level.name); expect(level.classList.contains(`is-l${agent.level.index}`)).toBe(true); expect(level.title).toBe(`${agent.approvedAllTime} ${agent.approvedAllTime === 1 ? "Lead" : "Leads"} insgesamt${agent.level.next ? ` – noch ${agent.level.next.missing} bis „${agent.level.next.name}“` : " – höchste Stufe"}`);
      expect(row.querySelector(".bl-agent-lines small > span:last-child")?.textContent).toBe(agent.level.next ? `noch ${agent.level.next.missing} bis ${agent.level.next.name}` : "höchste Stufe");
      expect(row.querySelector(".bl-leads-top b")?.textContent).toBe(String(agent.approved)); expect(row.querySelector(".bl-leads-top em")?.textContent ?? null).toBe(agent.approvedToday > 0 ? `+${agent.approvedToday} heute` : null);
      expect(row.querySelector<HTMLElement>(".bl-bar i")!.style.width).toBe(`${Math.max(agent.approved > 0 ? 4 : 0, Math.round((agent.approved / most) * 100))}%`);
      if (agent.rank! > 1) expect(row.querySelector(".bl-leads > small")?.textContent).toBe(agent.gap!.missing === 0 ? `gleichauf mit Platz ${agent.gap!.rank}` : `noch ${agent.gap!.missing} bis Platz ${agent.gap!.rank}`);
      expect(row.querySelector('.bl-num[data-label="Quote"] b')?.textContent).toBe(`${agent.greenRate} %`); expect(row.querySelector('.bl-num[data-label="Quote"] small')?.textContent).toBe(`${agent.approved} von ${agent.evaluated}`);
      expect(row.querySelector('.bl-num[data-label="Gespräche"] b')?.textContent).toBe(String(agent.calls));
      const streak = row.querySelector<HTMLElement>(".bl-streak b"); if (agent.streak >= 1) { expect(streak?.textContent).toBe(`${agent.streak} ${agent.streak === 1 ? "Tag" : "Tage"}`); expect(streak?.classList.contains("is-on")).toBe(agent.streak >= 2); } else expect(streak).toBeNull();
      const move = row.querySelector<HTMLElement>(".bl-place .bl-move");
      if (agent.isNew) { expect(move?.classList.contains("is-new")).toBe(true); expect(move?.textContent).toBe("neu"); }
      else if (agent.rankChange) { expect(move?.classList.contains(agent.rankChange > 0 ? "is-up" : "is-down")).toBe(true); expect(move?.textContent).toContain(String(Math.abs(agent.rankChange))); expect(move?.title).toContain(`in den 30 Tagen davor auf Platz ${agent.previousRank}`); }
      else expect(move).toBeNull(); // unverändert bleibt leer – so fallen die Bewegungen auf
    });
    expect(all.some((agent) => agent.rankChange && agent.rankChange > 0)).toBe(true); expect(all.some((agent) => agent.rankChange && agent.rankChange < 0)).toBe(true); expect(all.some((agent) => agent.isNew)).toBe(true);
    // alle anzeigen und wieder einklappen
    const more = panel.querySelector<HTMLButtonElement>(".bl-more")!; expect(more.textContent).toBe(`Alle ${all.length} Agenten anzeigen`); expect(more.getAttribute("aria-expanded")).toBe("false");
    await click(more, 300); rows = rowsOf(panel); expect(rows.length).toBe(all.length); expect(rows.map(nameOfRow)).toEqual(all.map((agent) => agent.name)); expect(panel.querySelector(".bl-more")?.textContent).toBe("Nur die ersten 10 zeigen");
    await click(panel.querySelector(".bl-more"), 300); expect(rowsOf(panel).length).toBe(10);
    // Suche: auch Plätze weiter hinten – mit ihrem Platz
    const search = panel.querySelector<HTMLInputElement>(".bl-search input")!; const last = all[all.length - 1];
    await act(async () => { fireEvent.change(search, { target: { value: last.name.slice(0, 5).toUpperCase() } }); }); await settle(200);
    rows = rowsOf(panel); expect(rows.length).toBeGreaterThan(0); expect(rows.map(nameOfRow)).toEqual(all.filter((agent) => agent.name.toLowerCase().includes(last.name.slice(0, 5).toLowerCase())).map((agent) => agent.name)); expect(rows.map(nameOfRow)).toContain(last.name);
    expect(rows[rows.length - 1].querySelector(".bl-place b")?.textContent).toBe(String(last.rank)); expect(panel.querySelector(".bl-more")).toBeNull();
    await act(async () => { fireEvent.change(search, { target: { value: "gibt es nicht" } }); }); await settle(200);
    expect(rowsOf(panel).length).toBe(0); expect(panel.querySelector(".bl-none")?.textContent).toBe("Kein Agent mit „gibt es nicht“.");
    await click(panel.querySelector('.bl-search button[aria-label="Suche leeren"]'), 200); expect(rowsOf(panel).length).toBe(10);
    expect(panel.querySelector(".bl-note")?.textContent).toContain("Ein Lead ist ein freigegebenes (grünes) Gespräch"); expect(panel.querySelector(".bl-note")?.textContent).toContain("Neuling, Talent ab 10, Profi ab 25, Experte ab 50, Meister ab 100, Champion ab 250, Legende ab 500");
  });

  it("Zeitraum und Kampagne: die Bestenliste gilt für die Auswahl – die Kampagnen sind die der Gespräche", async () => {
    const { panel } = await openBoard();
    const periods = Array.from(panel.querySelectorAll<HTMLButtonElement>(".bl-toolbar .gq-periods button")); expect(periods.map((button) => button.textContent)).toEqual(["Heute", "7 Tage", "30 Tage", "Gesamt"]); expect(periods.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false"]);
    const select = panel.querySelector<HTMLSelectElement>(".bl-campaign select")!; const campaigns = (await callProcedure("leadops.listCallQaCampaigns", undefined)) as Array<{ name: string }>;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(["Alle Kampagnen", ...campaigns.map((item) => item.name)]); expect(campaigns.map((item) => item.name)).toEqual(expect.arrayContaining(["PV Q4", "Wärmepumpe Herbst"]));
    // Heute: der Vergleich nennt den letzten Tag mit Gesprächen als Zahl
    await click(periods[0], 700); const today = await reportOf({ period: "heute" });
    expect(panel.querySelector(".bl-stage-head > span")?.textContent).toBe("Heute"); expect(panel.querySelector(".bl-team-label")?.textContent).toBe("Team heute"); expect(panel.querySelector(".bl-team-score .bl-count")?.textContent).toBe(String(today.totals.approved));
    expect(panel.querySelector(".bl-team-change")?.textContent).toBe(`am letzten Tag mit Gesprächen: ${today.totals.approvedBefore} ${today.totals.approvedBefore === 1 ? "Lead" : "Leads"}`);
    expect(Array.from(panel.querySelectorAll(".bl-team-facts dt")).map((node) => node.textContent)).toEqual(["Gespräche", "Quote", "am Telefon"]); // „heute“ steht dort schon oben
    expect(rowsOf(panel).map(nameOfRow)).toEqual(ranked(today).slice(0, 10).map((agent) => agent.name));
    // Gesamt: kein Vergleich, niemand ist „neu“ oder steigt
    await click(periods[3], 700); const total = await reportOf({ period: "alle" });
    expect(panel.querySelector(".bl-team-label")?.textContent).toBe("Team insgesamt"); expect(panel.querySelector(".bl-team-change")).toBeNull(); expect(panel.querySelector(".bl-move")).toBeNull(); expect(total.awards.some((award) => award.key === "aufsteiger")).toBe(false);
    // Kampagne
    await click(periods[2], 500); await act(async () => { fireEvent.change(select, { target: { value: "Wärmepumpe Herbst" } }); }); await settle(700);
    const heat = await reportOf({ period: "30", campaign: "Wärmepumpe Herbst" }); const everything = await reportOf({ period: "30" });
    expect(heat.totals.calls).toBeGreaterThan(0); expect(heat.totals.calls).toBeLessThan(everything.totals.calls);
    expect(panel.querySelector(".bl-stage-head > span")?.textContent).toBe("30 Tage · Wärmepumpe Herbst"); expect(panel.querySelector(".bl-team-score .bl-count")?.textContent).toBe(String(heat.totals.approved));
    expect(Array.from(panel.querySelectorAll(".bl-podium .bl-pod-name")).map((node) => node.textContent)).toEqual(ranked(heat).slice(0, 3).map((agent) => agent.name));
    expect(Array.from(panel.querySelectorAll(".bl-feed li small")).every((node) => node.textContent === "Wärmepumpe Herbst")).toBe(true);
    const calls = getStore().tables.callRecords.filter((row) => row.campaign === "Wärmepumpe Herbst" && new Date(row.startedAt).getTime() >= new Date("2026-10-20T23:00:00Z").getTime()); expect(heat.totals.calls).toBe(calls.length); expect(heat.totals.approved).toBe(calls.filter((row) => row.decision === "freigegeben").length);
  });

  it("„Gespräche“ führt zur Liste dieses Agenten – mit Zeitraum und Kampagne der Bestenliste, die Zahl stimmt überein", async () => {
    const { root, panel } = await openBoard();
    await click(Array.from(panel.querySelectorAll<HTMLButtonElement>(".bl-toolbar .gq-periods button")).find((button) => button.textContent === "7 Tage"), 600);
    await act(async () => { fireEvent.change(panel.querySelector<HTMLSelectElement>(".bl-campaign select")!, { target: { value: "PV Q4" } }); }); await settle(700);
    const report = await reportOf({ period: "7", campaign: "PV Q4" }); const agent = ranked(report)[0]; expect(agent.userId).toBeNull(); expect(agent.calls).toBeGreaterThan(0);
    const row = rowsOf(panel)[0]; expect(nameOfRow(row)).toBe(agent.name);
    await click(row.querySelector(".bl-open"), 900);
    expect(root.querySelector(".gq-agents-panel")).toBeNull(); expect(root.querySelector(".cq-list-panel .gq-table")).toBeTruthy();
    expect(root.querySelector(".gq-pick-button.has-value b")?.textContent).toBe(agent.name);
    expect(root.querySelector(".gq-period .gq-periods button.active")?.textContent).toBe("7 Tage"); expect(root.querySelector(".cq-campaign-row .dashboard-segments button.active")?.textContent).toBe("PV Q4");
    expect(root.querySelectorAll(".flux-table tbody tr.gq-call").length).toBe(agent.calls); // dieselbe Zahl wie in der Bestenliste
  });

  it("ein neuer Lead wird gefeiert: Hinweis auf der Bühne, die Zeile leuchtet – Konfetti nur, wenn Bewegung erwünscht ist; eine neue Stufe wird angesagt", async () => {
    const before = await reportOf({ period: "30" }); const store = getStore();
    const pending = (name: string) => store.tables.callRecords.filter((row) => row.agentName === name && row.decision === "pruefen" && new Date(row.startedAt).getTime() > NOW.getTime() - 20 * 86_400_000); // im Zeitraum – ältere ändern die Bestenliste der 30 Tage nicht
    const lucky = ranked(before).find((agent) => agent.rank! <= 10 && pending(agent.name).length > 0)!; expect(lucky).toBeTruthy();
    const { panel, queryClient } = await openBoard(); expect(panel.querySelector(".bl-cheer")).toBeNull(); expect(panel.querySelector(".bl-rows > li.is-fresh")).toBeNull();
    await callProcedure("leadops.reviewCall", { callId: pending(lucky.name)[0].id, decision: "freigegeben" });
    await act(async () => { await queryClient.invalidateQueries(); }); await settle(600);
    expect(panel.querySelector(".bl-cheer")?.textContent).toBe(`Neuer Lead für ${lucky.name} – jetzt ${lucky.approved + 1}.`); expect(panel.querySelector(".bl-cheer")?.getAttribute("role")).toBe("status"); expect(panel.querySelector(".bl-stage")?.classList.contains("is-cheering")).toBe(true);
    const fresh = Array.from(panel.querySelectorAll<HTMLElement>(".bl-rows > li.is-fresh")); expect(fresh.map(nameOfRow)).toEqual([lucky.name]); expect(fresh[0].querySelector(".bl-leads-top b")?.textContent).toBe(String(lucky.approved + 1));
    expect(panel.querySelector(".bl-confetti")).toBeNull(); // „weniger Bewegung“
    // mit Bewegung: Konfetti – und wer eine Stufe aufsteigt, wird genannt
    calm(false);
    const climber = ranked(await reportOf({ period: "30" })).find((agent) => agent.name !== lucky.name && agent.level.next && agent.level.next.missing <= 6 && pending(agent.name).length >= agent.level.next.missing)!; expect(climber).toBeTruthy();
    const steps = climber.level.next!.missing; for (const row of pending(climber.name).slice(0, steps)) await callProcedure("leadops.reviewCall", { callId: row.id, decision: "freigegeben" });
    await act(async () => { await queryClient.invalidateQueries(); }); await settle(600);
    expect(panel.querySelector(".bl-cheer")?.textContent).toBe(`${steps === 1 ? "Neuer Lead" : `${steps} neue Leads`} für ${climber.name} – jetzt ${climber.approved + steps}. ${climber.name} ist jetzt ${climber.level.next!.name}.`);
    expect(panel.querySelectorAll(".bl-confetti i").length).toBe(26); expect(panel.querySelector(".bl-confetti")?.getAttribute("aria-hidden")).toBe("true");
    expect(Array.from(panel.querySelectorAll<HTMLElement>(".bl-rows > li.is-fresh, .bl-podium > li.is-fresh")).some((node) => (node.textContent ?? "").includes(climber.name))).toBe(true);
    // Zurück aus den Gesprächen: was dort freigegeben wurde, wird beim Wiederkommen gefeiert
    cleanup(); const other = ranked(await reportOf({ period: "30" })).find((agent) => agent.name !== lucky.name && agent.name !== climber.name && pending(agent.name).length > 0 && (!agent.level.next || agent.level.next.missing > 1))!;
    await callProcedure("leadops.reviewCall", { callId: pending(other.name)[0].id, decision: "freigegeben" });
    const again = await openBoard(); expect(again.panel.querySelector(".bl-cheer")?.textContent).toBe(`Neuer Lead für ${other.name} – jetzt ${other.approved + 1}.`);
  });

  it("ohne vorherigen Stand, in einem anderen Zeitraum oder am nächsten Tag wird nichts gefeiert", async () => {
    const first = await openBoard(); expect(first.panel.querySelector(".bl-cheer")).toBeNull();
    const store = getStore(); const recent = (item: { decision: string; agentName: string; startedAt: Date }) => item.decision === "pruefen" && item.agentName === "Deniz Kaya" && new Date(item.startedAt).getTime() > NOW.getTime() - 20 * 86_400_000;
    const row = store.tables.callRecords.find((item) => recent(item as never))!; expect(row).toBeTruthy();
    // anderer Zeitraum: dort gibt es noch keinen Stand
    await callProcedure("leadops.reviewCall", { callId: row.id, decision: "freigegeben" });
    await click(Array.from(first.panel.querySelectorAll<HTMLButtonElement>(".bl-toolbar .gq-periods button")).find((button) => button.textContent === "Gesamt"), 700); expect(first.panel.querySelector(".bl-cheer")).toBeNull();
    // nächster Tag: der Stand von gestern zählt nicht mehr
    cleanup(); vi.setSystemTime(new Date(NOW.getTime() + 86_400_000));
    const next = store.tables.callRecords.find((item) => recent(item as never))!; expect(next).toBeTruthy(); await callProcedure("leadops.reviewCall", { callId: next.id, decision: "freigegeben" });
    const later = await openBoard(); expect(later.panel.querySelector(".bl-cheer")).toBeNull();
  });

  it("Großansicht: füllt das Fenster mit Treppchen, Mannschaft, Uhr und den Plätzen dahinter – Esc oder „Schließen“ beendet sie", async () => {
    const report = await reportOf({ period: "30" }); const all = ranked(report); const { panel } = await openBoard();
    const button = panel.querySelector<HTMLButtonElement>(".bl-wide-button")!; expect(button.textContent).toBe("Großansicht"); expect(button.disabled).toBe(false); expect(document.body.querySelector(".bl-wide")).toBeNull();
    await click(button, 400);
    const wide = document.body.querySelector<HTMLElement>(".bl-wide")!; expect(wide).toBeTruthy(); expect(panel.contains(wide)).toBe(false); // liegt über der ganzen Seite, nicht im Bereich
    expect(wide.getAttribute("role")).toBe("dialog"); expect(wide.getAttribute("aria-label")).toBe("Bestenliste in der Großansicht"); expect(document.documentElement.classList.contains("bl-wide-open")).toBe(true);
    expect(wide.querySelector(".bl-wide-head h2")?.textContent).toBe("Bestenliste"); expect(wide.querySelector(".bl-wide-head .bl-stage-head > span")?.textContent).toBe("30 Tage"); expect(wide.querySelector(".bl-wide-head time")?.textContent).toBe("15:20 Uhr");
    expect(Array.from(wide.querySelectorAll(".bl-podium .bl-pod-name")).map((node) => node.textContent)).toEqual(all.slice(0, 3).map((agent) => agent.name)); expect(panel.querySelector(".bl-podium")).toBeNull(); // das Treppchen steht nur einmal da
    expect(wide.querySelector(".bl-team-score .bl-count")?.textContent).toBe(String(report.totals.approved)); expect(wide.querySelectorAll(".bl-feed li").length).toBe(4);
    const chase = Array.from(wide.querySelectorAll<HTMLElement>(".bl-chase > li")); expect(chase.length).toBe(8);
    expect(chase.map((item) => item.querySelector(".bl-chase-place")?.textContent)).toEqual(["4", "5", "6", "7", "8", "9", "10", "11"]); expect(chase.map((item) => item.querySelector(":scope > b")?.textContent)).toEqual(all.slice(3, 11).map((agent) => agent.name));
    expect(chase.map((item) => item.querySelector(".bl-chase-score")?.textContent)).toEqual(all.slice(3, 11).map((agent) => `${agent.approved}${agent.approved === 1 ? "Lead" : "Leads"}`));
    expect(wide.querySelector<HTMLElement>(".bl-wide-fit")!.style.getPropertyValue("zoom") || (wide.querySelector<HTMLElement>(".bl-wide-fit")!.style as unknown as { zoom?: string }).zoom || "gesetzt").toBeTruthy();
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); }); await settle(200);
    expect(document.body.querySelector(".bl-wide")).toBeNull(); expect(document.documentElement.classList.contains("bl-wide-open")).toBe(false); expect(panel.querySelector(".bl-podium")).toBeTruthy();
    await click(panel.querySelector(".bl-wide-button"), 300); await click(document.body.querySelector(".bl-wide-close"), 200); expect(document.body.querySelector(".bl-wide")).toBeNull();
  });

  it("Gespräche ohne Agent zählen für niemanden – sie stehen als Hinweis unter der Rangliste", async () => {
    const store = getStore(); const sample = store.tables.callRecords.find((row) => row.agentName === "Deniz Kaya" && row.decision === "freigegeben")!;
    insert(store, "callRecords", { ...sample, id: undefined, externalCallId: "OD-OHNE-1", agentName: null, startedAt: new Date(NOW.getTime() - 3_600_000), createdAt: new Date(NOW.getTime() - 3_600_000) });
    insert(store, "callRecords", { ...sample, id: undefined, externalCallId: "OD-OHNE-2", agentName: "  ", decision: "pruefen", startedAt: new Date(NOW.getTime() - 7_200_000), createdAt: new Date(NOW.getTime() - 7_200_000) });
    const report = await reportOf({ period: "30" }); const nobody = report.agents[report.agents.length - 1]; expect(nobody).toMatchObject({ name: "Ohne Agent", rank: null, calls: 2, approved: 1 });
    const { panel } = await openBoard(); await click(panel.querySelector(".bl-more"), 300);
    expect(rowsOf(panel).map(nameOfRow)).not.toContain("Ohne Agent"); expect(rowsOf(panel).length).toBe(ranked(report).length);
    expect(panel.querySelector(".bl-nobody")?.textContent).toBe("Ohne Agent: 2 Gespräche, davon 1 Lead – der Dialer hat keinen Agenten gemeldet, deshalb zählen sie für niemanden.");
    expect(panel.querySelector(".bl-team-score .bl-count")?.textContent).toBe(String(report.totals.approved)); // in der Summe der Mannschaft zählen sie mit
    expect(report.awards.every((award) => award.name !== "Ohne Agent")).toBe(true);
  });

  it("noch keine Gespräche: die Bühne sagt es – und mit zwei Agenten bleibt der dritte Platz frei", async () => {
    const store = getStore(); insert(store, "callQaCampaigns", { tenantId: store.tables.tenants[0].id, name: "Neue Kampagne", questions: [], createdAt: NOW, updatedAt: NOW });
    const { panel } = await openBoard(); const select = panel.querySelector<HTMLSelectElement>(".bl-campaign select")!;
    await act(async () => { fireEvent.change(select, { target: { value: "Neue Kampagne" } }); }); await settle(700);
    expect(panel.querySelector(".bl-stage.is-empty .bl-stage-empty")?.textContent).toBe("Noch keine Gespräche in 30 Tagen in der Kampagne „Neue Kampagne“. Sobald der Dialer Gespräche meldet, beginnt hier das Rennen.");
    expect(panel.querySelector(".bl-podium")).toBeNull(); expect(panel.querySelector(".bl-awards")).toBeNull(); expect(panel.querySelector(".bl-list")).toBeNull(); expect(panel.querySelector<HTMLButtonElement>(".bl-wide-button")!.disabled).toBe(true);
    // zwei Agenten in der neuen Kampagne
    const sample = store.tables.callRecords.find((row) => row.agentName === "Deniz Kaya" && row.decision === "freigegeben")!;
    ["Deniz Kaya", "Mira Schubert"].forEach((agentName, index) => insert(store, "callRecords", { ...sample, id: undefined, externalCallId: `OD-NEU-${index}`, agentName, campaign: "Neue Kampagne", startedAt: new Date(NOW.getTime() - (index + 1) * 600_000), createdAt: new Date(NOW.getTime() - (index + 1) * 600_000) }));
    await act(async () => { fireEvent.change(select, { target: { value: "" } }); }); await settle(500); await act(async () => { fireEvent.change(select, { target: { value: "Neue Kampagne" } }); }); await settle(700);
    const pods = Array.from(panel.querySelectorAll<HTMLElement>(".bl-podium > li")); expect(pods.length).toBe(3); expect(pods.map((pod) => pod.classList.contains("is-empty"))).toEqual([false, false, true]);
    expect(pods[2].querySelector(".bl-pod-free")?.textContent).toBe("Platz 3 ist noch frei"); expect(pods[0].querySelector(".bl-step small")?.textContent).toBe("gleichauf mit Platz 2"); expect(rowsOf(panel).length).toBe(2); expect(panel.querySelector(".bl-more")).toBeNull();
  });

  it("aufs Treppchen kommt nur, wer einen Lead hat: ohne Lead bleiben die Stufen frei – die Rangliste zählt trotzdem", async () => {
    const store = getStore(); insert(store, "callQaCampaigns", { tenantId: store.tables.tenants[0].id, name: "Frühschicht", questions: [], createdAt: NOW, updatedAt: NOW });
    const sample = store.tables.callRecords.find((row) => row.agentName === "Deniz Kaya" && row.decision === "pruefen")!;
    ["Deniz Kaya", "Mira Schubert", "Deniz Kaya"].forEach((agentName, index) => insert(store, "callRecords", { ...sample, id: undefined, externalCallId: `OD-FRUEH-${index}`, agentName, campaign: "Frühschicht", decision: "pruefen", startedAt: new Date(NOW.getTime() - (index + 1) * 600_000), createdAt: new Date(NOW.getTime() - (index + 1) * 600_000) }));
    const { panel } = await openBoard(); await act(async () => { fireEvent.change(panel.querySelector<HTMLSelectElement>(".bl-campaign select")!, { target: { value: "Frühschicht" } }); }); await settle(700);
    const pods = Array.from(panel.querySelectorAll<HTMLElement>(".bl-podium > li")); expect(pods.map((pod) => pod.classList.contains("is-empty"))).toEqual([true, true, true]);
    expect(pods.map((pod) => pod.querySelector(".bl-pod-free")?.textContent)).toEqual(["Wer holt den ersten Lead?", "Platz 2 ist noch frei", "Platz 3 ist noch frei"]); expect(panel.querySelector(".bl-crown")).toBeNull();
    const rows = rowsOf(panel); expect(rows.map(nameOfRow)).toEqual(["Deniz Kaya", "Mira Schubert"]); expect(rows.map((row) => row.querySelector(".bl-place b")?.textContent)).toEqual(["1", "2"]); // mehr Gespräche zuerst
    expect(rows.some((row) => row.classList.contains("is-p1") || row.classList.contains("is-top"))).toBe(false); expect(rows.map((row) => row.querySelector(".bl-leads-top b")?.textContent)).toEqual(["0", "0"]); expect(rows.every((row) => row.querySelector<HTMLElement>(".bl-bar i")!.style.width === "0%")).toBe(true);
    expect(panel.querySelector(".bl-team-score .bl-count")?.textContent).toBe("0"); expect(panel.querySelector(".bl-feed p")?.textContent).toBe("Noch kein Lead im Zeitraum."); expect(panel.querySelector(".bl-awards .is-quote")).toBeNull();
    // Großansicht: die Plätze dahinter beginnen dann beim ersten
    await click(panel.querySelector(".bl-wide-button"), 400); const wide = document.body.querySelector<HTMLElement>(".bl-wide")!;
    expect(Array.from(wide.querySelectorAll(".bl-chase-place")).map((node) => node.textContent)).toEqual(["1", "2"]); expect(wide.querySelectorAll(".bl-podium > li.is-empty").length).toBe(3);
    await click(wide.querySelector(".bl-wide-close"), 200);
  });

  it("Namen der Agenten kommen aus einer leichten Abfrage – für die Vorschläge beim Zuordnen und die Profilbilder", async () => {
    const names = (await callProcedure("leadops.callAgentNames", undefined)) as Array<{ name: string; userId: number | null }>;
    expect(names.map((item) => item.name)).toEqual([...names.map((item) => item.name)].sort((a, b) => a.localeCompare(b, "de"))); expect(names.some((item) => /^ohne agent$/i.test(item.name))).toBe(false);
    expect(names.find((item) => item.name === "Deniz Kaya")).toEqual({ name: "Deniz Kaya", userId: null }); expect(names.find((item) => item.name === "Taner Tanesco")?.userId).toBeGreaterThan(0); // eigener Dialer: mit Benutzer
    expect(new Set(names.map((item) => item.name)).size).toBe(names.length);
    window.history.replaceState(null, "", "/?page=Gespräche"); const { view } = mount(); await settle(900);
    await click(Array.from(view.container.querySelectorAll<HTMLButtonElement>("button")).find((button) => /Aufnahmen testen/.test(button.textContent ?? "")), 500);
    expect(Array.from(document.body.querySelectorAll("#gi-agents option")).map((node) => node.getAttribute("value"))).toEqual(names.map((item) => item.name));
  });
});
