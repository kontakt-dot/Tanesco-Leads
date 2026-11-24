import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";
import { berlinDay } from "../../../../shared/agent-ranking";
import { claimRate, hintText, statusSplit, todayComparison, waitingAge, weekComparison, type LeadsOverview } from "../../../../shared/lead-overview";

/**
 * Version 349 – die Leiste über der Leads-Tabelle: der Weg der Leads.
 *  Fünf Kacheln (alle Leads und wo sie stehen · heute neu, verglichen mit gestern bis zur selben Uhrzeit · bereit zum Ausliefern mit dem Alter
 *  des ältesten · ausgeliefert mit Betrag · reklamiert mit Anteil), 14 Tage als Säulen (die letzten 7 gegen die 7 davor) und Hinweise,
 *  warum freigegebene Leads nicht rausgehen. Jede Kachel, jede Säule und jeder Hinweis zeigt genau seine Leads.
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 700) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const type = async (node: Element | null | undefined, value: string, wait = 700) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.change(node!, { target: { value } }); }); await settle(wait); };
const open = async (query: string, wait = 2000) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((node) => (node.textContent ?? "").trim());
const de = (value: number) => value.toLocaleString("de-DE");
type Lead = { id: number; publicId: string; status: string; kind?: string; categoryId: number; createdAt: Date };
type Row = Record<string, unknown>;
const salesLeads = () => (getStore().tables.leads as unknown as Lead[]).filter((lead) => (lead.kind ?? "verkauf") === "verkauf");
const withStatus = (status: string) => salesLeads().filter((lead) => lead.status === status);
/** Tag, wie ihn die Tabelle filtert (Ortszeit des Browsers) – die Kacheln zählen Berliner Tage; in Deutschland ist das dasselbe. */
const localDay = (value: Date | string | number) => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const overview = async () => await callProcedure("leadops.leadsOverview", undefined) as LeadsOverview;
const tile = (root: ParentNode, key: string) => root.querySelector<HTMLButtonElement>(`.lo-tile.is-${key}`)!;
const found = (root: ParentNode) => root.querySelector(".lt-foot-count b")!.textContent;
const activeTab = (root: ParentNode) => root.querySelector(".lt-tabs button.active")!.firstChild!.textContent;
const bars = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLButtonElement>(".lo-bar"));
const hintItems = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLElement>(".lo-hint"));
const HIDDEN_KEY = "tanesco-lead-hints-hidden";

describe("Version 349", () => {
  beforeEach(() => { cleanup(); resetStore(); try { localStorage.removeItem(HIDDEN_KEY); localStorage.removeItem("tanesco-lead-hidden-columns"); localStorage.removeItem("tanesco-lead-saved-views"); } catch { /* egal */ } });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); try { localStorage.removeItem(HIDDEN_KEY); } catch { /* egal */ } });

  it("Kacheln: der Weg der Leads – Zahlen aus allen Leads, wo sie stehen, fairer Vergleich mit gestern, Alter des ältesten wartenden Leads, Betrag der Auslieferungen, Anteil der Reklamationen", async () => {
    const root = await open("page=Leads"); const all = salesLeads(); const now = await overview(); const store = getStore().tables;
    // die Rechnung stimmt mit dem Speicher überein
    const statusOf = (status: string) => withStatus(status).length;
    expect(now.total).toBe(all.length); expect(now.status).toEqual({ neu: statusOf("neu"), genehmigt: statusOf("genehmigt"), zugewiesen: statusOf("zugewiesen"), reklamiert: statusOf("reklamiert"), fehlerhaft: statusOf("fehlerhaft"), deaktiviert: statusOf("deaktiviert"), hängend: statusOf("hängend") });
    const today = berlinDay(new Date()); expect(now.today).toBe(all.filter((lead) => berlinDay(lead.createdAt) === today).length); expect(now.days).toHaveLength(14); expect(now.days[13].day).toBe(today);
    expect(now.week).toBe(now.days.slice(7).reduce((sum, day) => sum + day.count, 0)); expect(now.previousWeek).toBe(now.days.slice(0, 7).reduce((sum, day) => sum + day.count, 0)); expect(now.yesterdaySoFar).toBeLessThanOrEqual(now.yesterday);
    const oldest = withStatus("genehmigt").reduce((first, lead) => Math.min(first, new Date(lead.createdAt).getTime()), Infinity); expect(new Date(now.oldestReadyAt!).getTime()).toBe(oldest);
    const weekDays = new Set(now.days.slice(7).map((day) => day.day)); const handed = (store.leadDeliveries as Row[]).filter((row) => (row.result === "angeboten" || row.result === "angenommen") && weekDays.has(berlinDay(row.occurredAt as Date)));
    expect(now.deliveredWeek).toBe(new Set(handed.map((row) => row.leadId)).size); expect(now.deliveredToday).toBe(new Set(handed.filter((row) => berlinDay(row.occurredAt as Date) === today).map((row) => row.leadId)).size);
    expect(now.valueWeek).toBeCloseTo(handed.reduce((sum, row) => sum + Number(row.unitPrice ?? 0), 0), 2); expect(now.valueWeek).toBeGreaterThan(0);
    expect(now.claimsOpen).toBe((store.claims as Row[]).filter((row) => row.status === "offen" || row.status === "in_prüfung").length);

    // fünf Kacheln in der Reihenfolge des Wegs; „Leads gesamt“ ist gewählt, solange nichts gefiltert ist
    expect(texts(root, ".lo-tile .lo-label")).toEqual(["Leads gesamt", "Heute neu", "Bereit zum Ausliefern", "Ausgeliefert", "Reklamiert"]);
    expect(texts(root, ".lo-tile strong")).toEqual([de(now.total), de(now.today), de(now.ready), de(now.delivered), de(now.status.reklamiert)]);
    expect(tile(root, "all").classList.contains("is-active")).toBe(true); expect(root.querySelectorAll(".lo-tile.is-active")).toHaveLength(1); expect(tile(root, "all").getAttribute("aria-pressed")).toBe("true");
    // wo alle Leads stehen: seit Version 359 nur noch im Hinweis beim Überfahren (ruhigere Leiste: je Zahl eine Zeile)
    const split = statusSplit(now.status).filter((part) => part.count > 0); expect(split.reduce((sum, part) => sum + part.count, 0)).toBe(now.total);
    expect(root.querySelector(".lo-split")).toBeNull(); expect(root.querySelectorAll(".lo-tile small")).toHaveLength(0);
    expect(tile(root, "all").getAttribute("title")).toBe(split.map((part) => `${de(part.count)} ${part.label} (${part.share} %)`).join(" · ")); expect(tile(root, "all").querySelector(".lo-insight")!.textContent).toBe("alle anzeigen");
    // heute neu: verglichen mit gestern bis zur selben Uhrzeit – nicht mit dem ganzen gestrigen Tag
    const compare = todayComparison(now.today, now.yesterdaySoFar); const insight = (key: string) => tile(root, key).querySelector<HTMLElement>(".lo-insight")!;
    expect(insight("today").textContent).toBe(compare.text); expect(insight("today").classList.contains(`is-${compare.tone}`)).toBe(true);
    expect(tile(root, "today").getAttribute("title")).toContain(`gestern bis jetzt ${de(now.yesterdaySoFar)} · ganzer Tag ${de(now.yesterday)}`); expect(tile(root, "today").getAttribute("title")).toContain("Verglichen wird mit gestern bis zur selben Uhrzeit");
    // bereit: wie alt der älteste ist (ab zwei Tagen als Hinweis); darunter, was sonst noch nicht raus ist
    const age = waitingAge(now.oldestReadyAt)!; expect(insight("ready").textContent).toBe(age.text); expect(age.text).toMatch(/^ältester ist \d+ Tage alt$/); expect(insight("ready").classList.contains("is-achtung")).toBe(true);
    expect(tile(root, "ready").getAttribute("title")).toContain(`dazu ${[now.status.neu ? `${de(now.status.neu)} neu` : "", now.status.hängend ? `${de(now.status.hängend)} hängend` : ""].filter(Boolean).join(" · ")}`);
    // ausgeliefert: 7 Tage, heute – und was das wert ist
    expect(insight("delivered").textContent).toBe(`${de(now.deliveredWeek)} in 7 Tagen · heute ${de(now.deliveredToday)}`); expect(tile(root, "delivered").getAttribute("title")).toContain(`${now.valueWeek.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })} in 7 Tagen`);
    // reklamiert: Anteil an allem, was je ausgeliefert wurde; darunter die offenen Entscheidungen
    const rate = claimRate(now.status.zugewiesen, now.status.reklamiert)!; expect(rate).toBe(Math.round((now.status.reklamiert / (now.status.zugewiesen + now.status.reklamiert)) * 100)); expect(insight("claimed").textContent).toBe(`${rate} % der ausgelieferten`);
    expect(tile(root, "claimed").getAttribute("title")).toContain(`${now.claimsOpen} ${now.claimsOpen === 1 ? "wartet" : "warten"} auf Entscheidung`);
    // Farbpunkte nur an den drei Kacheln, die auch in der Verteilung vorkommen
    expect(Array.from(root.querySelectorAll(".lo-tile .lo-dot")).map((dot) => dot.className)).toEqual(["lo-dot is-bereit", "lo-dot is-ausgeliefert", "lo-dot is-reklamiert"]);
  }, 60_000);

  it("Jede Kachel zeigt genau ihre Leads: Suche und andere Filter werden geleert, die Kachel ist nur gewählt, wenn die Tabelle genau das zeigt", async () => {
    const root = await open("page=Leads"); const all = salesLeads(); const now = await overview();
    const search = () => root.querySelector<HTMLInputElement>('input[aria-label="Leads durchsuchen"]')!; const active = () => Array.from(root.querySelectorAll(".lo-tile.is-active, .lo-week.is-active")).map((node) => node.className.replace(/\s+/g, " ").trim());
    // gesucht – dann „Ausgeliefert“: Die Suche ist weg, die Tabelle zeigt alle ausgelieferten
    await type(search(), "Martin Albrecht", 900); expect(found(root)).toBe("1"); expect(active()).toEqual([]);
    await click(tile(root, "delivered")); expect(search().value).toBe(""); expect(activeTab(root)).toBe("Zugewiesen"); expect(found(root)).toBe(de(withStatus("zugewiesen").length)); expect(active()).toEqual(["lo-tile is-delivered is-active"]);
    expect(texts(root, ".lt-row .lt-pill-status").every((text) => text === "Zugewiesen")).toBe(true);
    await click(tile(root, "claimed")); expect(activeTab(root)).toBe("Reklamiert"); expect(found(root)).toBe(de(withStatus("reklamiert").length)); expect(active()).toEqual(["lo-tile is-claimed is-active"]);
    // ein Tag ist gewählt – „Bereit zum Ausliefern“ zeigt trotzdem alle wartenden, nicht nur die dieses Tages
    await click(bars(root)[12]); expect(bars(root)[12].getAttribute("aria-pressed")).toBe("true"); expect(found(root)).toBe(de(all.filter((lead) => localDay(lead.createdAt) === now.days[12].day).length)); expect(active()).toEqual([]);
    await click(tile(root, "ready")); expect(activeTab(root)).toBe("Freigegeben"); expect(found(root)).toBe(de(withStatus("genehmigt").length)); expect(active()).toEqual(["lo-tile is-ready is-active"]); expect(bars(root).some((bar) => bar.getAttribute("aria-pressed") === "true")).toBe(false);
    // heute neu
    await click(tile(root, "today")); expect(activeTab(root)).toBe("Alle"); expect(found(root)).toBe(de(all.filter((lead) => localDay(lead.createdAt) === localDay(new Date())).length)); expect(active()).toEqual(["lo-tile is-today is-active"]);
    // die letzten 7 Tage: Knopf über den Säulen
    const week = root.querySelector<HTMLButtonElement>(".lo-week")!; expect(week.querySelector("b")!.textContent).toBe(de(now.week)); expect(week.getAttribute("aria-pressed")).toBe("false");
    const weekStart = localDay(Date.now() - 6 * 86_400_000); const inWeek = all.filter((lead) => localDay(lead.createdAt) >= weekStart && localDay(lead.createdAt) <= localDay(new Date())).length;
    await click(week); expect(found(root)).toBe(de(inWeek)); expect(root.querySelector(".lo-week")!.getAttribute("aria-pressed")).toBe("true"); expect(active()).toEqual(["lo-week is-active"]);
    // wer danach selbst einen Reiter wählt, sieht eine Mischung – dann ist keine Kachel gewählt
    await click(Array.from(root.querySelectorAll<HTMLButtonElement>(".lt-tabs button")).find((button) => button.firstChild?.textContent === "Freigegeben")); expect(active()).toEqual([]);
    await click(tile(root, "all")); expect(found(root)).toBe(de(all.length)); expect(activeTab(root)).toBe("Alle"); expect(active()).toEqual(["lo-tile is-all is-active"]);
  }, 80_000);

  it("Säulen: 14 Tage – die letzten 7 gegen die 7 davor, Zahl an der Spitze und an heute, beim Überfahren Zahl und Tag", async () => {
    const root = await open("page=Leads"); const now = await overview(); const list = bars(root);
    expect(list).toHaveLength(14); expect(list.map((bar) => (bar.classList.contains("is-recent") ? "r" : bar.classList.contains("is-before") ? "b" : "?")).join("")).toBe("bbbbbbbrrrrrrr");
    expect(list.map((bar, index) => (bar.classList.contains("is-week-start") ? index : -1)).filter((index) => index >= 0)).toEqual([7]); expect(list[13].classList.contains("is-today")).toBe(true);
    const names = texts(root, ".lo-bar em"); expect(names[13]).toBe("heute"); expect(names.slice(0, 13).every((name) => ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].includes(name))).toBe(true); expect(names.slice(0, 6)).toEqual(names.slice(7, 13)); expect(new Set(names.slice(0, 7)).size).toBe(7); // eine Woche weiter steht derselbe Wochentag
    // Höhe = Anteil am stärksten Tag; leere Tage haben keine Säule
    const max = Math.max(...now.days.map((day) => day.count)); const peak = now.days.findIndex((day) => day.count === max); expect(max).toBeGreaterThan(0);
    expect(list[peak].style.getPropertyValue("--h")).toBe("100%"); now.days.forEach((day, index) => { expect(list[index].classList.contains("is-empty")).toBe(day.count === 0); expect(list[index].getAttribute("aria-label")).toContain(`${de(day.count)} ${day.count === 1 ? "Lead" : "Leads"}`); if (!day.count) expect(list[index].style.getPropertyValue("--h")).toBe("0%"); });
    // beschriftet sind nur der stärkste Tag und heute – nicht jede Säule
    const labelled = list.map((bar, index) => (bar.querySelector(".lo-col b") ? index : -1)).filter((index) => index >= 0); expect(labelled).toEqual(Array.from(new Set([peak, ...(now.days[13].count ? [13] : [])])).sort((a, b) => a - b)); expect(list[peak].querySelector(".lo-col b")!.textContent).toBe(de(max));
    // die Wochen im Kopf: letzte 7 Tage, davor, Unterschied
    const compare = weekComparison(now.week, now.previousWeek); expect(root.querySelector(".lo-week b")!.textContent).toBe(de(now.week)); expect(root.querySelector(".lo-prev")!.textContent).toBe(`davor ${de(now.previousWeek)}`);
    expect(texts(root, ".lo-weeks .lo-insight")).toEqual(compare ? [compare.text] : []); if (compare) expect(compare.text).toMatch(/^(\d+ %|unter 1 %) (mehr|weniger)$|^gleich viele$/);
    // überfahren: statt der Wochen stehen Zahl und Tag da; verlässt die Maus die Säulen, kommen die Wochen zurück
    await act(async () => { fireEvent.mouseEnter(list[5]); }); const long = new Date(`${now.days[5].day}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" });
    expect(root.querySelector(".lo-readout")!.textContent).toBe(`${de(now.days[5].count)} ${now.days[5].count === 1 ? "Lead" : "Leads"} · ${long}`); expect(root.querySelector(".lo-weeks")).toBeNull();
    await act(async () => { fireEvent.mouseLeave(root.querySelector(".lo-bars")!); }); expect(root.querySelector(".lo-readout")).toBeNull(); expect(root.querySelector(".lo-weeks")).toBeTruthy();
    // dieselben Zahlen als Tabelle für Vorleseprogramme
    expect(root.querySelectorAll(".lo-chart table.sr-only tbody tr")).toHaveLength(14); expect(texts(root, ".lo-chart table.sr-only tbody td:last-child")).toEqual(now.days.map((day) => String(day.count)));
    // ein zweiter Klick auf dieselbe Säule nimmt den Filter wieder weg
    await click(list[13]); expect(bars(root)[13].getAttribute("aria-pressed")).toBe("true"); await click(bars(root)[13]); expect(bars(root)[13].getAttribute("aria-pressed")).toBe("false"); expect(found(root)).toBe(de(salesLeads().length));
  }, 60_000);

  it("Hinweise: sagen, warum freigegebene Leads nicht rausgehen – zeigen genau diese Leads, führen zur richtigen Seite und lassen sich für drei Tage ausblenden", async () => {
    const store = getStore().tables; const now = await overview(); const categoryName = (id: number) => String((store.leadCategories as Row[]).find((row) => row.id === id)!.name);
    // was die Rechnung sagt, stimmt mit dem Speicher überein
    expect(now.hints.map((hint) => hint.kind).slice(0, 2)).toEqual(["keine_kette", "fehler"]);
    const blocked = now.hints[0]; expect(blocked.categoryIds.length).toBeGreaterThan(0); expect(blocked.categories).toEqual(blocked.categoryIds.map(categoryName));
    const withStop = new Set((store.deliveryStops as Row[]).filter((stop) => stop.active !== false).map((stop) => stop.chainId));
    for (const id of blocked.categoryIds) { expect((store.deliveryChains as Row[]).some((chain) => chain.categoryId === id && chain.status === "aktiv" && withStop.has(chain.id))).toBe(false); expect((store.orders as Row[]).some((order) => order.categoryId === id && (order.status === "offen" || order.status === "aktiv"))).toBe(false); }
    expect(blocked.leads).toBe(withStatus("genehmigt").filter((lead) => blocked.categoryIds.includes(lead.categoryId)).length); expect(blocked.leads).toBeLessThan(withStatus("genehmigt").length);
    expect(now.hints[1].leads).toBe((await callProcedure("leadops.apiErrorCount", undefined) as { open: number }).open);

    const root = await open("page=Leads"); const list = root.querySelector('.lo-hints[aria-label="Was jetzt zu tun ist"]')!; expect(list).toBeTruthy();
    expect(texts(root, ".lo-hint p")).toEqual(now.hints.slice(0, 2).map((hint) => hintText(hint).text)); // höchstens zwei auf einmal
    expect(texts(root, ".lo-hint p")[0]).toBe(`${blocked.leads} freigegebene Leads können nicht raus: Für „${blocked.categories[0]}“ ist keine Lieferkette eingeschaltet.`); expect(texts(root, ".lo-hint p")[1]).toBe(`Bei ${now.hints[1].leads} Leads hakt die Auslieferung.`);
    expect(hintItems(root).map((item) => texts(item, ".lo-hint-actions button, .lo-hint-actions a").filter(Boolean))).toEqual([["Diese Leads zeigen", "Lieferkette einrichten"], ["API-Fehler ansehen"]]);
    expect(hintItems(root).map((item) => item.querySelector(".lo-hint-go")!.getAttribute("href"))).toEqual(["/?page=Lieferkette", "/?page=API-Fehler"]);
    // „Diese Leads zeigen“: freigegeben und nur diese Kategorie
    await click(hintItems(root)[0].querySelector(".lo-hint-more"), 900); expect(activeTab(root)).toBe("Freigegeben"); expect(found(root)).toBe(de(blocked.leads));
    expect(Array.from(root.querySelectorAll(".lt-row .lt-cat")).map((cell) => cell.getAttribute("title"))).toEqual(Array.from({ length: blocked.leads }, () => blocked.categories[0])); expect(root.querySelectorAll(".lo-tile.is-active")).toHaveLength(0);
    // der Knopf führt ohne Neuladen auf die Seite, auf der es sich lösen lässt
    await click(hintItems(root)[0].querySelector(".lo-hint-go"), 1500); expect(new URLSearchParams(window.location.search).get("page")).toBe("Lieferkette"); expect(root.querySelector("h1")!.textContent).toBe("Lieferkette"); expect(root.querySelector(".lo-strip")).toBeNull();
    cleanup(); const again = await open("page=Leads");
    await click(hintItems(again)[1].querySelector(".lo-hint-go"), 1500); expect(new URLSearchParams(window.location.search).get("page")).toBe("API-Fehler"); expect(again.querySelector("h1")!.textContent).toBe("API-Fehler");
    // ausblenden: weg für drei Tage – auch nach dem Neuladen; der andere Hinweis bleibt
    cleanup(); const third = await open("page=Leads"); const before = Date.now();
    await click(hintItems(third)[0].querySelector(".lo-hint-close"), 300); expect(texts(third, ".lo-hint p")[0]).toBe(hintText(now.hints[1]).text); expect(texts(third, ".lo-hint p")).not.toContain(hintText(blocked).text);
    const saved = JSON.parse(localStorage.getItem(HIDDEN_KEY)!) as Record<string, number>; const key = `keine_kette:${blocked.categories.join("|")}`; expect(Object.keys(saved)).toEqual([key]);
    expect(saved[key]).toBeGreaterThanOrEqual(before + 3 * 86_400_000 - 5); expect(saved[key]).toBeLessThanOrEqual(Date.now() + 3 * 86_400_000);
    cleanup(); const fourth = await open("page=Leads"); expect(texts(fourth, ".lo-hint p")).not.toContain(hintText(blocked).text); expect(texts(fourth, ".lo-hint p")[0]).toBe(hintText(now.hints[1]).text);
    // nach drei Tagen – oder wenn sich der Hinweis ändert – ist er wieder da
    localStorage.setItem(HIDDEN_KEY, JSON.stringify({ [key]: Date.now() - 1000 })); cleanup(); const fifth = await open("page=Leads"); expect(texts(fifth, ".lo-hint p")[0]).toBe(hintText(blocked).text);
  }, 120_000);

  it("Hinweise folgen der Einrichtung: Lieferkette eingeschaltet → „liefert keine Automation von selbst aus“; Automation eingeschaltet → kein Hinweis; ist alles Freigegebene raus, bleibt die Zeile weg", async () => {
    const store = getStore().tables; const first = await overview(); const blocked = first.hints.find((hint) => hint.kind === "keine_kette")!; const categoryId = blocked.categoryIds[0]; const name = blocked.categories[0];
    const mine = (hint: { categoryIds: number[] } | undefined) => Boolean(hint?.categoryIds.includes(categoryId)); const hintOf = async (kind: string) => (await overview()).hints.find((hint) => hint.kind === kind);
    const waiting = withStatus("genehmigt").filter((lead) => lead.categoryId === categoryId).length; expect(waiting).toBeGreaterThan(0);
    // eine Kette ohne Kunde oder eine ausgeschaltete Kette bringt nichts raus
    const draft = await callProcedure("leadops.createChainRule", { categoryIds: [categoryId], supplierMode: "all", supplierIds: [], buyers: [], active: false }) as { created: Array<{ chainId: number }> };
    expect(mine(await hintOf("keine_kette"))).toBe(true); await callProcedure("leadops.deleteDeliveryChain", { chainId: draft.created[0].chainId });
    const made = await callProcedure("leadops.createChainRule", { categoryIds: [categoryId], supplierMode: "all", supplierIds: [], buyers: [{ buyerName: "Fensterbau Probe", unitPrice: 19.5 }], active: true }) as { created: Array<{ chainId: number }> };
    // Kette mit Kunde eingeschaltet: Die Leads können raus – aber keine Automation liefert sie von selbst aus
    expect(mine(await hintOf("keine_kette"))).toBe(false); const manual = (await hintOf("nicht_von_selbst"))!; expect(mine(manual)).toBe(true);
    const single = { ...manual, leads: waiting, categories: [name], categoryIds: [categoryId] }; expect(hintText(single)).toEqual({ text: `${waiting} freigegebene Leads warten: Für „${name}“ liefert keine Automation von selbst aus.`, action: "Automation einrichten", page: "Automatisierung", showLeads: true });
    await callProcedure("leadops.updateDeliveryChain", { id: made.created[0].chainId, status: "inaktiv" }); expect(mine(await hintOf("keine_kette"))).toBe(true); await callProcedure("leadops.updateDeliveryChain", { id: made.created[0].chainId, status: "aktiv" });
    // Automation: pausiert zählt nicht; eine, die erst nach einer Reklamation greift, auch nicht; eingeschaltet und „automatisch ausliefern“ → kein Hinweis für die Kategorie
    await callProcedure("leadops.createAutomationRule", { name: "Fenster automatisch ausliefern", triggerType: "lead_erstellt", sourceCategoryId: categoryId, targetCategoryId: categoryId, conditions: [], actionType: "lead_ausliefern", actionConfig: {}, status: "pausiert" });
    const rule = (store.automationRules as Row[]).find((row) => row.name === "Fenster automatisch ausliefern")!; expect(mine(await hintOf("nicht_von_selbst"))).toBe(true);
    await callProcedure("leadops.updateAutomationRule", { id: rule.id, status: "aktiv", triggerType: "reklamation_genehmigt" }); expect(mine(await hintOf("nicht_von_selbst"))).toBe(true);
    await callProcedure("leadops.updateAutomationRule", { id: rule.id, triggerType: "lead_erstellt", conditions: [{ field: "status", operator: "gleich", value: "reklamiert" }] }); expect(mine(await hintOf("nicht_von_selbst"))).toBe(true);
    await callProcedure("leadops.updateAutomationRule", { id: rule.id, conditions: [] }); expect((await overview()).hints.some(mine)).toBe(false);
    // in der Oberfläche: Der Hinweis zur Lieferkette ist weg
    const root = await open("page=Leads"); expect(texts(root, ".lo-hint p").some((text) => text.includes(`„${name}“`))).toBe(false);
    // wartet nichts mehr, steht das an der Kachel – und es gibt keine Hinweis-Zeile
    cleanup(); for (const lead of withStatus("genehmigt")) lead.status = "zugewiesen";
    const empty = await overview(); expect(empty).toMatchObject({ ready: 0, oldestReadyAt: null, hints: [] });
    const calm = await open("page=Leads"); expect(tile(calm, "ready").querySelector("strong")!.textContent).toBe("0"); expect(tile(calm, "ready").querySelector(".lo-insight")!.textContent).toBe("alles Freigegebene ist raus"); expect(tile(calm, "ready").querySelector(".lo-insight")!.classList.contains("is-gut")).toBe(true); expect(calm.querySelector(".lo-hints")).toBeNull();
  }, 80_000);
});
