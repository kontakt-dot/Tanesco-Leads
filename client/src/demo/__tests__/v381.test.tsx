import { trpc } from "@/lib/trpc";
import { categoryColor } from "@/lib/colors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, resetStore } from "../backend";
import { dueBucket, groupByDue } from "../../../../shared/pipeline-extras";

/**
 * Version 381 – Vertriebspipeline und E-Mail-Kampagnen im Stil der neu gestalteten Seiten: Zahlen als eine Leiste, echte Überschriften statt
 * Schildern (Schilder bleiben nur über einer Überschrift und in der Filterleiste), in den Aufgaben ist nur Überfälliges kräftig rot,
 * das Schild der Leadsparte trägt die Farbe der Lead-Kategorie.
 */
function providers(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}>{node}</QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
async function until(check: () => boolean, tries = 40) { for (let index = 0; index < tries && !check(); index += 1) await settle(150); }
const click = async (node: Element | null | undefined, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const open = async (query: string, wait = 2200) => { window.history.replaceState(null, "", `/?${query}`); const view = providers(<DemoApp />); await settle(wait); return view.container; };
const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((node) => (node.textContent ?? "").trim());
const call = (path: string, input?: unknown) => callProcedure(path, input) as Promise<any>;
const stats = (root: ParentNode, scope: string) => Array.from(root.querySelectorAll<HTMLElement>(`${scope} .fx-stat`)).map((node) => ({ node, label: (node.querySelector("span")?.textContent ?? "").trim(), value: (node.querySelector("strong")?.textContent ?? "").trim(), hint: (node.querySelector("small")?.textContent ?? "").trim() }));
const before = (first: Element, second: Element) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("Version 381", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { vi.restoreAllMocks(); cleanup(); resetStore(); });

  it("Vertriebspipeline → Statistik: zehn Zahlen als eine Leiste mit Zeichen, darunter echte Überschriften", async () => {
    const root = await open("page=Vertriebspipeline&quelle=email&ansicht=stats"); await until(() => root.querySelectorAll(".vp-rail .fx-stat").length === 10);
    expect(root.querySelector(".pipeline-page")!.className).toContain("vp fx-scope");
    const rail = stats(root, ".vp-rail"); expect(root.querySelectorAll(".vp-rail")).toHaveLength(1);
    expect(rail.map((item) => item.label)).toEqual(["Leads aus E-Mail-Serien", "Kampagnen", "Geantwortet", "Termine", "Kunden", "Pipeline-Wert (offen)", "Gewichtet nach Stufe", "Umsatz gewonnen", "Abschlussquote", "Verloren"]);
    for (const item of rail) { expect(item.node.querySelector("span svg"), item.label).toBeTruthy(); expect(item.value, item.label).not.toBe(""); expect(item.hint, item.label).not.toBe(""); }
    expect(root.querySelector<HTMLElement>(".vp-rail")!.style.getPropertyValue("--fx-rail-n")).toBe("5"); // zwei Reihen zu je fünf
    const board = await call("leadops.pipelineOverview", { source: "email" });
    expect(rail[1].value).toBe(String(board.campaigns.filter((item: any) => item.campaignId !== "ohne-kampagne").length));
    expect(rail[4].value).toBe(String(board.totals.customers)); expect(rail[5].hint).toBe(`${board.value.openCount} offene Karten`);
    expect(root.querySelector(".metric-card")).toBeNull(); expect(root.querySelector(".pipeline-kpis")).toBeNull(); // die Kacheln gibt es nicht mehr
    // Überschriften statt Schildern
    expect(texts(root, ".vp h2.fx-h")).toEqual(["Funnel E-Mail-Kampagne", "Umsatz je Vertriebler", "Aktuelle Verteilung"]); expect(texts(root, ".vp h3.fx-h.is-sub")).toEqual(["Je Kampagne"]);
    expect(root.querySelector(".vp .operations-panel .eyebrow")).toBeNull();
    // die Filterleiste behält ihre Beschriftungen
    expect(texts(root, ".vp .dashboard-filter-group > .eyebrow").map((text) => text.replace(/\s+/g, " "))).toEqual(["ZEITRAUM", "VERTRIEBLER", "E-MAIL-KAMPAGNE", "AUSWAHL"]);
  });

  it("Vertriebspipeline → Termine & Aufgaben: die vier Zahlen stehen über dem Kalender und stimmen mit der Liste überein", async () => {
    const root = await open("page=Vertriebspipeline&quelle=email&ansicht=termine"); await until(() => root.querySelectorAll(".vp-rail .fx-stat").length === 4 && root.querySelectorAll(".today-item").length > 0);
    const due = await call("leadops.pipelineDueList", { ownerUserId: null }); const now = new Date(); const groups = groupByDue(due.tasks as Array<{ dueAt: Date }>, now);
    const rail = stats(root, ".vp-rail"); expect(rail.map((item) => item.label)).toEqual(["Überfällig", "Heute fällig", "Termine heute", "Diese Woche"]);
    expect(rail.map((item) => item.value)).toEqual([groups.ueberfaellig.length, groups.heute.length, (due.appointments as Array<{ appointmentAt: Date }>).filter((item) => dueBucket(item.appointmentAt, now) === "heute").length, groups.morgen.length + groups.woche.length].map(String));
    expect(rail[2].hint).toBe(`${due.appointments.length} in den nächsten 7 Tagen`); expect(rail[3].hint).toBe(`+${due.laterCount ?? 0} später`);
    expect(groups.ueberfaellig.length).toBeGreaterThan(0); expect(rail[0].node.className).toContain("is-bad"); expect(rail[0].hint).toBe("noch nicht erledigt"); expect(rail[1].node.className).not.toContain("is-bad");
    expect(before(root.querySelector(".vp-rail")!, root.querySelector(".calendar-panel")!)).toBe(true); expect(before(root.querySelector(".calendar-panel")!, root.querySelector(".pipeline-today")!)).toBe(true);
    expect(root.querySelector(".pipeline-today .fx-rail")).toBeNull(); // nicht doppelt
    expect(texts(root, ".vp h2.fx-h")).toEqual(["Kalender", "Wiedervorlagen & Aufgaben", "Termine – nächste 7 Tage"]);
    // „Jetzt anrufen“: kräftig rot nur bei Überfälligem
    const callButton = (row: Element) => Array.from(row.querySelectorAll<HTMLButtonElement>(".today-item-actions button")).find((node) => (node.textContent ?? "").includes("Jetzt anrufen"));
    const late = Array.from(root.querySelectorAll(".pipeline-today .today-item.is-ueberfaellig")).map(callButton).filter(Boolean) as HTMLButtonElement[];
    const today = Array.from(root.querySelectorAll(".pipeline-today .today-item.is-heute")).map(callButton).filter(Boolean) as HTMLButtonElement[];
    expect(late.length).toBeGreaterThan(0); expect(today.length).toBeGreaterThan(0);
    for (const node of late) { expect(node.className).toContain("flux-button"); expect(node.className).not.toContain("today-call"); }
    for (const node of today) { expect(node.className).toContain("today-call"); expect(node.className).not.toContain("flux-button"); }
  });

  it("Vertriebspipeline → Einstellungen: Überschriften statt Schildern; über einer Überschrift bleibt das Schild", async () => {
    const root = await open("page=Vertriebspipeline&quelle=email&ansicht=einstellungen"); await until(() => root.querySelectorAll(".stage-editor-row").length > 0);
    expect(texts(root, ".vp h2.fx-h")).toEqual(["Einstellungen", "Reihenfolge der Pipelines", "Stufen der Pipeline „E-Mail-Kampagne“"]);
    expect(root.querySelector(".vp .pipeline-settings .eyebrow")).toBeNull();
    cleanup();
    const lists = await open("page=Vertriebspipeline&quelle=kaltakquise&ansicht=listen"); await until(() => lists.querySelectorAll(".pipeline-lists-grid .eyebrow").length > 0);
    expect(texts(lists, ".pipeline-lists-grid .eyebrow").map((text) => text.replace(/\s+/g, " "))).toEqual(["LISTE HOCHLADEN", "KONTAKT ANLEGEN", "ANRUFKAMPAGNE"]); // jeweils über einer Überschrift
    for (const label of Array.from(lists.querySelectorAll(".pipeline-lists-grid .eyebrow"))) expect(label.nextElementSibling?.tagName).toBe("H2");
    expect(texts(lists, ".pipeline-lists-grid h3.fx-h.is-sub")).toContain("Verteilen auf Vertriebler");
  });

  it("E-Mail-Kampagnen: eine Hülle mit den Farbwerten, Kennzahlen als Leiste, das Schild der Leadsparte in der Farbe der Lead-Kategorie", async () => {
    const root = await open("page=E-Mail-Kampagnen&ansicht=kampagnen"); await until(() => root.querySelectorAll(".cl-card").length > 0 && root.querySelectorAll(".cl-card .sparte-badge.cat-strong").length > 0);
    const shell = root.querySelector(".ek.fx-scope")!; expect(shell).toBeTruthy(); expect(shell.querySelector(".page-intro h1")!.textContent).toBe("E-Mail-Kampagnen"); expect(shell.querySelector(".page-intro .eyebrow")!.textContent).toContain("VERTRIEB");
    const labels = texts(shell, ".cd-kpibar .cd-kpis .cd-kpi > span"); expect(labels.slice(0, 3)).toEqual(["Kampagnen", "Empfänger", "Gesendet"]); expect(labels.slice(-4)).toEqual(["Geöffnet", "Geklickt", "Geantwortet", "Unzustellbar"]);
    expect(shell.querySelector(".cd-kpi.is-open")).toBeTruthy(); expect(shell.querySelector(".cd-kpi.is-click")).toBeTruthy(); expect(shell.querySelector(".cd-kpi.is-reply")).toBeTruthy();
    // Schild der Leadsparte
    const categories = await call("leadops.listCategories") as Array<{ id: number; name: string; color?: string | null }>; const campaigns = await call("leadops.listEmailCampaigns") as Array<{ id: number; name: string; sparte?: { label: string; source: string } | null; leadCategoryIds?: number[] | null }>;
    const badgeOf = (name: string) => Array.from(shell.querySelectorAll<HTMLElement>(".cl-card")).find((card) => (card.textContent ?? "").includes(name))!.querySelector<HTMLElement>(".sparte-badge")!;
    const pv = categories.find((row) => row.name === "Photovoltaik")!; const pvCampaign = campaigns.find((row) => row.sparte?.label === "Photovoltaik" && row.sparte.source !== "standard")!; expect(pvCampaign).toBeTruthy();
    const pvBadge = badgeOf(pvCampaign.name); expect(pvBadge.className).toContain("cat-strong"); expect(pvBadge.style.getPropertyValue("--cat")).toBe(categoryColor(pv));
    const standard = campaigns.find((row) => row.sparte?.source === "standard")!; expect(standard).toBeTruthy();
    const plain = badgeOf(standard.name); expect(plain.className).not.toContain("cat-strong"); expect(plain.style.getPropertyValue("--cat")).toBe(""); expect(plain.textContent).toContain("Standard");
    const unknown = campaigns.find((row) => row.sparte && row.sparte.source !== "standard" && !(row.leadCategoryIds ?? []).length && !categories.some((category) => category.name.toLowerCase().startsWith(row.sparte!.label.toLowerCase())));
    if (unknown) expect(badgeOf(unknown.name).className).not.toContain("cat-strong"); // Sparte ohne passende Lead-Kategorie: ruhig
  });

  it("E-Mail-Kampagnen → Bearbeiten und einzelne Kampagne: Überschriften statt Schildern, der Seitenkopf behält sein Schild", async () => {
    const root = await open("page=E-Mail-Kampagnen&ansicht=kampagnen"); await until(() => root.querySelectorAll(".cl-card").length > 0);
    await click(root.querySelector('.cl-card .campaign-act[aria-label="Bearbeiten"]'), 1500); await until(() => texts(root, ".ek h2.fx-h").includes("Ablauf"));
    expect(root.querySelector(".ek .page-intro .eyebrow")!.textContent).toContain("KAMPAGNE BEARBEITEN");
    const headings = texts(root, ".ek h2.fx-h"); for (const label of ["Grunddaten", "Zielgruppe", "Versandfenster", "A/B-Test & Vorlage", "Ablauf"]) expect(headings, label).toContain(label);
    expect(root.querySelectorAll(".ek .operations-panel .eyebrow")).toHaveLength(0);
    cleanup();
    const again = await open("page=E-Mail-Kampagnen&ansicht=kampagnen"); await until(() => again.querySelectorAll(".cl-card").length > 0);
    const campaigns = await call("leadops.listEmailCampaigns") as Array<{ id: number; name: string; status: string; stats: { sent: number } }>; const running = campaigns.find((row) => row.status === "aktiv" && row.stats.sent > 0)!;
    const card = Array.from(again.querySelectorAll<HTMLElement>(".cl-card")).find((node) => (node.textContent ?? "").includes(running.name))!;
    await click(card.querySelector(".cl-funnel"), 1500); await until(() => texts(again, ".ek h2.fx-h").includes("Listen in dieser Kampagne"));
    expect(again.querySelector(".ek .cd-kpibar")).toBeNull(); expect(again.querySelectorAll(".ek .cd-kpis .cd-kpi").length).toBeGreaterThanOrEqual(6); // die Zahlen der Kampagne – dieselbe Leiste
    expect(again.querySelectorAll(".ek .operations-panel .eyebrow")).toHaveLength(0);
  });
});
