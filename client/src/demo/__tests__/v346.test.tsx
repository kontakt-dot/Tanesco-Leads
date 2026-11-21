import { trpc } from "@/lib/trpc";
import { forgetLeaderboard } from "@/components/AgentLeaderboard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";

/**
 * Version 346 – was sich an der Oberfläche geändert hat:
 *  Tags (mehrere auswählen und löschen, keine Listen-Marker, Punkt beim meistgenutzten Tag), Teams (Farbpalette, löschen),
 *  E-Mail-Kampagnen (aktiv / inaktiv), KI-Verbrauch je Tag, Alias-Namen der Agenten, Leads-Tabelle (Kategorie ohne Emoji).
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 500) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const type = async (node: Element | null | undefined, value: string, wait = 200) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.change(node!, { target: { value } }); }); await settle(wait); };
const open = async (query: string, wait = 1200) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
/** Bestätigen-Dialog der App: den Knopf zum Bestätigen drücken. */
const confirm = async () => { const dialog = document.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]'); expect(dialog).toBeTruthy(); const buttons = Array.from(dialog!.querySelectorAll("button")); const yes = buttons.find((button) => /löschen|ja|bestätigen|ok|entfernen|zuordnen/i.test(button.textContent ?? "") && !/abbrechen/i.test(button.textContent ?? "")) ?? buttons[buttons.length - 1]; await click(yes, 700); };

describe("Version 346", () => {
  beforeEach(() => { cleanup(); resetStore(); forgetLeaderboard(); try { localStorage.removeItem("kampagnen-zustand"); } catch { /* egal */ } });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); });

  it("Tags: Listen-Marker stehen nicht in der Liste, der Punkt sitzt beim Namen, mehrere Tags lassen sich auswählen und zusammen löschen", async () => {
    const store = getStore(); expect(store.tables.tags.some((tag) => String(tag.name).startsWith("Liste: "))).toBe(true); // im Bestand gibt es Listen-Marker …
    await callProcedure("leadops.createTag", { name: "Probe Eins", color: "#22c55e" }); await callProcedure("leadops.createTag", { name: "Probe Zwei", color: "#3b82f6" });
    const root = await open("page=Tags");
    const rows = () => Array.from(root.querySelectorAll<HTMLElement>(".tag-row")); const names = () => rows().map((row) => row.querySelector("strong")!.textContent ?? "");
    expect(names()).toEqual(expect.arrayContaining(["Probe Eins", "Probe Zwei"])); expect(names().some((name) => name.startsWith("Liste: "))).toBe(false); // … aber nicht in der Verwaltung
    // Farbpalette beim Anlegen: zwölf Farben und „Eigene Farbe“
    expect(root.querySelectorAll(".color-palette .color-dot")).toHaveLength(12); expect(root.querySelector(".color-palette .color-own")).toBeTruthy();
    // meistgenutzter Tag: Punkt und Name in einer Zeile – oder ein Strich, wenn noch kein Tag an einem Lead hängt
    const top = root.querySelectorAll(".metric-card")[2]!; const used = (await callProcedure("leadops.tagOverview", undefined) as { tags: Array<{ usageCount: number }> }).tags.some((tag) => tag.usageCount > 0);
    if (used) { expect(top.querySelector(".tag-top i")).toBeTruthy(); expect(top.querySelector(".tag-top span")!.textContent!.length).toBeGreaterThan(0); } else expect(top.querySelector("strong")!.textContent).toBe("–");
    // einzeln anhaken → Leiste zeigt die Zahl, „Alle auswählen“ nimmt alle
    const total = rows().length; const boxOf = (name: string) => rows().find((row) => row.querySelector("strong")!.textContent === name)!.querySelector<HTMLInputElement>("input.tag-check")!;
    await click(boxOf("Probe Eins"), 200); await click(boxOf("Probe Zwei"), 200);
    expect(root.querySelector(".tag-bulk-count")!.textContent).toBe(`2 von ${total} ausgewählt`); expect(root.querySelectorAll(".tag-row.is-picked")).toHaveLength(2);
    const all = root.querySelector<HTMLInputElement>(".tag-bulk-all input")!; await click(all, 200); expect(root.querySelectorAll(".tag-row.is-picked")).toHaveLength(total); await click(all, 200); expect(root.querySelectorAll(".tag-row.is-picked")).toHaveLength(0);
    // zwei auswählen und zusammen löschen (mit Nachfrage)
    await click(boxOf("Probe Eins"), 200); await click(boxOf("Probe Zwei"), 200);
    const remove = root.querySelector<HTMLButtonElement>(".tag-bulk-delete")!; expect(remove.textContent).toContain("2 löschen"); await click(remove, 500); await confirm();
    expect(names()).not.toEqual(expect.arrayContaining(["Probe Eins"])); expect(rows()).toHaveLength(total - 2); expect(root.querySelector(".tag-bulk-count")).toBeNull();
    expect(getStore().tables.tags.some((tag) => String(tag.name).startsWith("Liste: "))).toBe(true); // Listen-Marker bleiben für die Anrufkampagnen
    // von Hand lässt sich kein Tag mit „Liste: “ anlegen
    await expect(callProcedure("leadops.createTag", { name: "Liste: selbst", color: "#22c55e" })).rejects.toThrow(/vergibt die Software selbst/);
  }, 30_000);

  it("Teams: Farbe über die Palette wählen und ein Team löschen", async () => {
    await callProcedure("leadops.createTeam", { name: "Probe-Team", description: "", color: "#5f53ff" });
    const root = await open("page=Teams");
    await click(Array.from(root.querySelectorAll("button")).find((button) => button.querySelector("strong")?.textContent === "Probe-Team"), 500);
    const dots = Array.from(root.querySelectorAll<HTMLButtonElement>(".team-color .color-dot")); expect(dots).toHaveLength(12); expect(root.querySelector(".team-color .color-own")).toBeTruthy(); expect(root.querySelector('input[placeholder="#5f53ff"]')).toBeNull(); // kein Feld mehr für den Farbcode
    await click(dots[1], 200); expect(dots[1].getAttribute("aria-checked")).toBe("true");
    await click(Array.from(root.querySelectorAll("button")).find((button) => button.textContent === "Stammdaten speichern"), 600);
    expect(getStore().tables.teams.find((team) => team.name === "Probe-Team")).toMatchObject({ color: "#22c55e" });
    await click(root.querySelector(".team-delete"), 500); await confirm();
    expect(getStore().tables.teams.some((team) => team.name === "Probe-Team")).toBe(false); expect(Array.from(root.querySelectorAll("strong")).some((node) => node.textContent === "Probe-Team")).toBe(false);
  }, 30_000);

  it("E-Mail-Kampagnen: Alle / Aktiv / Inaktiv filtert die Liste – die Zahlen stehen an den Knöpfen", async () => {
    const root = await open("page=E-Mail-Kampagnen&ansicht=kampagnen", 1800);
    const group = root.querySelector<HTMLElement>(".cl-state")!; expect(group).toBeTruthy();
    const buttons = Array.from(group.querySelectorAll("button")); expect(buttons.map((button) => button.childNodes[0].textContent)).toEqual(["Alle", "Aktiv", "Inaktiv"]);
    const counts = buttons.map((button) => Number(button.querySelector("span")!.textContent)); expect(counts[0]).toBe(counts[1] + counts[2]); expect(counts[0]).toBeGreaterThan(0);
    const cards = () => Array.from(root.querySelectorAll<HTMLElement>(".cl-list > .cl-card"));
    expect(cards()).toHaveLength(counts[0]);
    await click(buttons[1], 400); expect(cards()).toHaveLength(counts[1]); expect(cards().every((card) => card.classList.contains("is-aktiv"))).toBe(true);
    await click(buttons[2], 400); expect(cards()).toHaveLength(counts[2]); expect(cards().some((card) => card.classList.contains("is-aktiv"))).toBe(false);
    expect(localStorage.getItem("kampagnen-zustand")).toBe("inaktiv");
    await click(buttons[0], 400); expect(cards()).toHaveLength(counts[0]);
  }, 30_000);

  it("KI-Verbrauch: Klick auf „KI heute“ zeigt je Tag eine Säule nach Bereich – ein Klick auf einen Tag zeigt, wofür", async () => {
    type History = { today: string; days: Array<{ day: string; cents: number; calls: number; parts: Array<{ label: string; area: string; cents: number }>; areas: Record<string, number> }>; totalCents: number; weekCents: number; todayCents: number; budgetCents: number };
    const history = await callProcedure("leadops.aiUsageHistory", { days: 30 }) as History; const today = await callProcedure("leadops.aiUsageToday", undefined) as { spentCents: number; calls: number };
    expect(history.days).toHaveLength(30); expect(history.days[29].day).toBe(history.today); expect(history.todayCents).toBe(today.spentCents); expect(history.totalCents).toBeGreaterThan(history.weekCents - 1);
    const root = await open("page=E-Mail-Kampagnen&ansicht=kampagnen", 1800);
    const chip = root.querySelector<HTMLButtonElement>("button.is-ai")!; expect(chip.textContent).toContain("KI heute"); await click(chip, 900);
    const dialog = document.querySelector<HTMLElement>(".ai-usage")!; expect(dialog).toBeTruthy();
    expect(dialog.querySelectorAll(".au-tile")).toHaveLength(3); expect(dialog.querySelectorAll(".au-col")).toHaveLength(30);
    expect(Array.from(dialog.querySelectorAll(".au-legend li")).map((item) => item.childNodes[1].textContent)).toEqual(expect.arrayContaining(["Gespräche", "E-Mail-Kampagnen"]));
    // heute ist vorgewählt
    const head = () => dialog.querySelector(".au-day h3")!.textContent ?? ""; expect(head()).toContain("heute"); expect(dialog.querySelector(".au-col.is-on")!.getAttribute("aria-pressed")).toBe("true");
    // ein anderer Tag: Kopf, Summe und Zwecke wechseln
    const busy = history.days.slice(0, 29).reduce((best, day) => day.cents > best.cents ? day : best, history.days[0]); const index = history.days.indexOf(busy);
    await click(dialog.querySelectorAll(".au-col")[index], 300);
    expect(head()).not.toContain("heute"); const euro = (cents: number) => `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
    expect(dialog.querySelector(".au-day .au-block-head p b")!.textContent).toBe(euro(busy.cents));
    const labels = Array.from(dialog.querySelectorAll(".au-area li > span")).map((node) => node.textContent); expect(labels).toEqual(expect.arrayContaining(busy.parts.map((part) => part.label))); expect(labels).toHaveLength(busy.parts.length);
    // Säulen sind nach Bereich geteilt, die oberste hat die runde Kante; dieselben Zahlen stehen als Tabelle da
    const column = dialog.querySelectorAll(".au-col")[index]; const segments = column.querySelectorAll(".au-seg"); expect(segments.length).toBe(Object.values(busy.areas).filter((cents) => cents > 0).length); expect(segments[segments.length - 1].classList.contains("is-top")).toBe(true);
    expect(dialog.querySelectorAll(".au-table tbody tr")).toHaveLength(30); expect(dialog.querySelector(".au-foot")!.textContent).toContain("Gespräche werden weiter bewertet");
  }, 30_000);

  it("Alias-Namen: Zuordnung steht in den Einstellungen, die Bestenliste findet den Agenten über den Alias, von Hand zuordnen gilt rückwirkend, entfernen macht es rückgängig", async () => {
    type Overview = { aliases: Array<{ alias: string; name: string; source: string; realCalls: number; aliasCalls: number }>; real: string[]; open: Array<{ name: string; calls: number }> };
    const before = await callProcedure("leadops.agentAliasOverview", undefined) as Overview;
    expect(before.aliases.map((item) => `${item.alias}>${item.name}`)).toEqual(expect.arrayContaining(["Laura Stein>Deniz Kaya", "Max Reuter>Jonas Brandt", "Sophie Lang>Nele Winter"])); expect(before.real).toContain("Deniz Kaya");
    expect(before.aliases.find((item) => item.alias === "Laura Stein")!.aliasCalls).toBeGreaterThan(0);
    // Bestenliste: unter dem echten Namen steht der Alias; die Suche findet ihn auch über den Alias
    let root = await open("page=Gespräche&view=Agenten", 1500);
    await click(Array.from(root.querySelectorAll(".gq-periods button, .bl-periods button, button")).find((button) => button.textContent === "30 Tage"), 900);
    const aliasNote = Array.from(root.querySelectorAll(".bl-alias")).map((node) => node.textContent); expect(aliasNote).toEqual(expect.arrayContaining(["(Laura Stein)"])); expect(root.querySelector(".bl-alias")!.getAttribute("title")).toContain("am Telefon");
    await type(root.querySelector('input[aria-label="Agent suchen"]'), "laura stein", 500);
    expect(Array.from(root.querySelectorAll(".bl-rows > li .bl-agent-lines b")).map((node) => node.textContent)).toEqual(["Deniz Kaya"]);
    cleanup();
    // ein älteres Gespräch läuft noch unter einem Namen aus dem Gespräch – von Hand zuordnen
    const store = getStore(); const loose = store.tables.callRecords.find((row) => row.agentSource !== "dialer" && String(row.agentName ?? "").trim() && before.open.some((item) => item.name === row.agentName))!; expect(loose).toBeTruthy(); const looseName = String(loose.agentName);
    root = await open("page=Gespräche&view=Einstellungen", 1200);
    await click(Array.from(root.querySelectorAll(".gs-rail .gs-nav")).find((button) => button.textContent?.includes("Alias-Namen")), 800);
    expect(root.querySelector("#ga-h")!.textContent).toBe("Alias-Namen der Agenten"); expect(root.querySelectorAll(".ga-list li").length).toBe(before.aliases.filter((item) => item.name).length);
    const inputs = root.querySelectorAll<HTMLInputElement>(".ga-add input"); await type(inputs[0], looseName); await type(inputs[1], "Mira Schubert");
    await click(root.querySelector(".ga-add button[type=submit]"), 900);
    expect(getStore().tables.callRecords.find((row) => row.id === loose.id)).toMatchObject({ agentName: "Mira Schubert", agentAlias: looseName, agentSource: "alias" });
    expect(Array.from(root.querySelectorAll(".ga-list li")).some((item) => item.textContent?.includes(looseName) && item.textContent?.includes("Mira Schubert") && item.textContent?.includes("von Hand"))).toBe(true);
    // entfernen: das Gespräch läuft wieder unter seinem Namen, der Name steht unter „Kein Alias“
    const entry = Array.from(root.querySelectorAll(".ga-list li")).find((item) => item.textContent?.includes(looseName))!; await click(entry.querySelector(".ga-x"), 500); await confirm();
    expect(getStore().tables.callRecords.find((row) => row.id === loose.id)).toMatchObject({ agentName: looseName, agentAlias: null, agentSource: null });
    const after = await callProcedure("leadops.agentAliasOverview", undefined) as Overview; expect(after.aliases.find((item) => item.alias === looseName)).toMatchObject({ name: "", source: "manuell" });
    // „Jetzt abgleichen“ lernt ihn nicht wieder
    await callProcedure("leadops.syncAgentAliases", undefined); expect(getStore().tables.callRecords.find((row) => row.id === loose.id)!.agentName).toBe(looseName);
  }, 40_000);

  it("Leads-Tabelle: Spalte „Kategorie“ mit Kürzel und Name – ohne Emoji; kein Preisfilter mehr", async () => {
    const root = await open("page=Leads", 1800);
    const header = Array.from(root.querySelectorAll(".lead-panel .lt-head .lt-c")).map((cell) => cell.textContent?.trim()); expect(header).toContain("Kategorie"); expect(header).not.toContain("Typ");
    const cells = Array.from(root.querySelectorAll<HTMLElement>(".lt-row .lt-category")); expect(cells.length).toBeGreaterThan(3);
    for (const cell of cells.slice(0, 8)) { expect(cell.querySelector(".cat-emoji")).toBeNull(); const code = cell.querySelector(".lt-cat-code")!.textContent ?? ""; const name = cell.querySelector(".lt-cat-name")!.textContent ?? ""; expect(code).toMatch(/^[A-ZÄÖÜ0-9+]{2,6}$/); expect(name.length).toBeGreaterThan(code.length); expect(cell.querySelector(".lt-cat")!.getAttribute("title")).toBe(name); }
    await click(Array.from(root.querySelectorAll("button")).find((button) => button.textContent?.trim().startsWith("Filter")), 500);
    expect(root.querySelector('input[placeholder="Mindestpreis €"]')).toBeNull(); expect(root.querySelector('input[placeholder="Höchstpreis €"]')).toBeNull(); expect(root.querySelector('input[aria-label="Ausgeliefert bis"]')).toBeTruthy();
  }, 30_000);
});
