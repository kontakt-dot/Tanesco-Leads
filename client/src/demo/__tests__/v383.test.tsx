import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";
import { WATTFOX_TEMPLATE } from "../../../../shared/wattfox";
import type { ReportCard } from "../../../../shared/partner-report";

/**
 * Version 383 – Integration an einer Stelle: beim Käufer. Die Statistik zeigt jeden Käufer mit Schnittstelle von selbst (auch ohne Konto,
 * mit Kontingent); die Rückmeldung des Partners wird beim Käufer eingerichtet (Reiter „Integration“ → „Rückmeldung des Käufers“);
 * unter Einstellungen → Integrationen steht nur noch, was für alle gilt. Alle Namen sind die erfundenen der Vorschau.
 */
function providers(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}>{node}</QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
async function until(check: () => boolean, tries = 40) { for (let index = 0; index < tries && !check(); index += 1) await settle(150); }
const click = async (node: Element | null | undefined, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const type = async (node: Element | null | undefined, value: string, wait = 300) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.change(node!, { target: { value } }); }); await settle(wait); };
const submit = async (form: Element | null | undefined, wait = 1000) => { expect(form).toBeTruthy(); await act(async () => { fireEvent.submit(form!); }); await settle(wait); };
const open = async (query: string, wait = 2400) => { window.history.replaceState(null, "", `/?${query}`); const view = providers(<DemoApp />); await settle(wait); return view.container; };
const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim());
const button = (root: ParentNode, text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((node) => (node.textContent ?? "").trim() === text);
type Row = Record<string, any>;
const table = (name: string) => (getStore().tables as unknown as Record<string, Row[]>)[name];
const call = (path: string, input?: unknown) => callProcedure(path, input) as Promise<any>;
const said = (text: string) => (document.body.textContent ?? "").includes(text);
const confirmOk = async () => { await until(() => Boolean(document.querySelector(".app-confirm-ok"))); await click(document.querySelector(".app-confirm-ok"), 1200); };
const before = (first: Element, second: Element) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
const cardsNow = async () => (await call("leadops.partnerReport", {})).cards as ReportCard[];
/** Der Käufer der Vorschau mit eigener Schnittstelle (Nordlicht Energie): sein Benutzer-Eintrag und sein Benutzer. */
const buyer = () => { const endpoint = table("deliveryEndpoints")[0]; const membership = table("memberships").find((row) => row.id === endpoint.membershipId)!; return { membershipId: membership.id as number, userId: membership.userId as number, endpointId: endpoint.id as number }; };
const accountsOf = (userId: number) => table("partnerAccounts").filter((row) => row.buyerUserId === userId);
const card = (root: ParentNode, title: string) => Array.from(root.querySelectorAll<HTMLElement>(".pr-card")).find((node) => node.querySelector("h3")?.textContent === title)!;
const STATS = "page=Statistik&view=Integrationen";

describe("Version 383 – Statistik je Käufer von selbst", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { vi.restoreAllMocks(); document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); cleanup(); resetStore(); });

  it("ein Käufer mit Schnittstelle hat eine Karte, ohne dass ein Konto angelegt wurde – mit dem Weg zu ihm, ohne Bewertung und ohne Gesamtquote", async () => {
    expect(table("partnerAccounts")).toHaveLength(0); const who = buyer();
    const root = await open(STATS); await until(() => root.querySelectorAll(".pr-card").length === 5);
    const cards = await cardsNow(); const mine = cards.find((item) => item.account.buyerUserId === who.userId)!; expect(mine.account).toMatchObject({ id: -who.userId, provider: "api", mode: "none", hasAccess: false, virtual: true, membershipId: who.membershipId }); expect(mine.title).toBe("Nordlicht Energie");
    expect(mine.counts.delivered).toBeGreaterThan(3); expect(mine.counts.accepted + mine.counts.rejected).toBe(mine.counts.delivered); expect(mine.counts.rated).toBe(0);
    const node = card(root, "Nordlicht Energie"); expect(node.className).toContain("is-own"); expect(node.querySelector(".pr-card-head .pr-mark svg")).toBeTruthy(); expect(node.querySelector(".pr-card-head p")!.textContent).toBe("Käufer mit eigener Schnittstelle");
    expect(node.querySelector(".pr-sync")!.textContent).toContain("Dieser Käufer meldet nichts zurück."); expect(node.querySelector(".pr-sync a")!.textContent).toBe("Käufer öffnen"); expect(node.querySelector(".pr-sync a")!.getAttribute("href")).toBe(`/?page=Benutzer&member=${who.membershipId}&tab=tools`);
    // drei Kacheln, keine Gesamtquote, kein Block „Bewertung“; im Balken heißt der Rest „angenommen“
    const tiles = Array.from(node.querySelectorAll('section[aria-label="Zustellung"] .pr-tile')).map((tile) => [tile.querySelector("span")!.textContent, tile.querySelector("strong")!.textContent]);
    expect(tiles).toEqual([["Geliefert", String(mine.counts.delivered)], ["PrePing abgelehnt", String(mine.counts.rejected)], ["Angenommen", String(mine.counts.accepted)]]); expect(node.querySelector(".pr-tiles")!.className).toContain("is-three");
    expect(node.querySelector('section[aria-label="Bewertung durch den Partner"]')).toBeNull(); expect(texts(node, ".pr-flow li").join(" | ")).toContain(`${mine.counts.accepted} angenommen`); expect(texts(node, ".pr-flow li").join(" ")).not.toContain("ohne Rückmeldung");
    expect(node.querySelector(".pr-quota.is-empty")).toBeTruthy(); expect(Array.from(node.querySelectorAll(".pr-fold summary span")).map((item) => item.textContent)).toEqual(["Kontakte"]);
    // die übrigen Karten bleiben, wie sie waren: Partner mit Rückmeldung behalten Bewertung und Gesamtquote
    const first = card(root, "Aroundhome (Account 1)"); expect(first.className).not.toContain("is-own"); expect(first.querySelector('section[aria-label="Bewertung durch den Partner"]')).toBeTruthy(); expect(first.querySelectorAll('section[aria-label="Zustellung"] .pr-tile')).toHaveLength(4); expect(texts(first, ".pr-flow li").join(" ")).toContain("ohne Rückmeldung");
    expect(card(root, "WattFox").querySelector(".pr-card-head p")!.textContent).toBe("Käufer: Sonnenwerk Süd"); expect(card(root, "Leadnodes").querySelector(".pr-sync")!.textContent).toContain("Für Leadnodes gibt es noch keinen Rückkanal – die Anbindung folgt.");
    // Leiste: „Integrationen“ zählt alle Karten
    const rail = Array.from(root.querySelectorAll(".pr-rail .pr-stat")).map((stat) => [(stat.querySelector("span")!.textContent ?? "").trim(), stat.querySelector("strong")!.firstChild!.textContent]); expect(rail[0]).toEqual(["Integrationen", "5"]); expect(rail[1]).toEqual(["Geliefert", String(cards.reduce((sum, item) => sum + item.counts.delivered, 0))]);
    expect(root.querySelector(".pr-rail")!.getAttribute("aria-label")).toBe("Alle Integrationen zusammen");
    expect(table("partnerAccounts")).toHaveLength(0); // ansehen legt nichts an
  }, 40_000);

  it("Kontingent an der Karte ohne Konto: Es bekommt einen Platz beim Käufer, die Karte bleibt dieselbe – entfernt ist auch der Platz wieder weg", async () => {
    const who = buyer(); const root = await open(STATS); await until(() => root.querySelectorAll(".pr-card").length === 5);
    const node = () => card(root, "Nordlicht Energie");
    await click(button(node(), "Kontingent eintragen"), 400); await type(node().querySelector('input[aria-label="Bestellte Leads"]'), "10"); await submit(node().querySelector("form.pr-quota"), 1200); await until(() => accountsOf(who.userId).length === 1);
    expect(said("Kontingent gespeichert: 10 Leads je Woche.")).toBe(true); expect(accountsOf(who.userId)[0]).toMatchObject({ provider: "api", quotaAmount: 10, quotaPeriod: "week", trackingToken: null });
    await until(() => Boolean(node()?.querySelector(".pr-quota-head"))); expect(root.querySelectorAll(".pr-card")).toHaveLength(5); expect(node().querySelector(".pr-card-head p")!.textContent).toBe("Käufer mit eigener Schnittstelle"); // weiter eine Karte, weiter derselbe Kopf
    const mine = (await cardsNow()).find((item) => item.account.buyerUserId === who.userId)!; expect(mine.account.id).toBe(accountsOf(who.userId)[0].id); expect(mine.account.virtual).toBeUndefined(); expect(mine.quota).toMatchObject({ amount: 10, period: "week" });
    expect(node().querySelector(".pr-quota-main span")!.textContent).toBe(mine.quota!.open ? "noch nachschieben" : "Kontingent erfüllt"); expect(root.querySelector(".pr-rail")!.className).toContain("has-quota");
    // ändern → entfernen
    await click(node().querySelector(".pr-quota-edit"), 400); await click(button(node(), "Kontingent entfernen"), 1200); await until(() => accountsOf(who.userId).length === 0);
    expect(said("Kontingent entfernt.")).toBe(true); expect(accountsOf(who.userId)).toEqual([]); await until(() => Boolean(node()?.querySelector(".pr-quota.is-empty"))); expect((await cardsNow()).find((item) => item.account.buyerUserId === who.userId)!.account).toMatchObject({ id: -who.userId, virtual: true });
  }, 40_000);

  it("Kontakte der Karte ohne Konto klappen auf und führen zum Lead", async () => {
    const who = buyer(); const root = await open(STATS); await until(() => root.querySelectorAll(".pr-card").length === 5);
    const mine = (await cardsNow()).find((item) => item.account.buyerUserId === who.userId)!; const node = card(root, "Nordlicht Energie");
    const fold = node.querySelector<HTMLDetailsElement>(".pr-fold")!; expect(fold.querySelector("summary em")!.textContent).toBe(String(mine.counts.delivered));
    await act(async () => { fold.open = true; fireEvent(fold, new Event("toggle")); }); await until(() => node.querySelectorAll(".pr-contacts .pr-table tbody tr").length > 0);
    expect(node.querySelector(".pr-contacts-count")!.textContent).toBe(`${mine.counts.delivered} Kontakte`); expect(node.querySelectorAll(".pr-contacts .pr-table tbody tr")).toHaveLength(mine.counts.delivered);
    expect(node.querySelector(".pr-contacts .pr-table tbody a")!.getAttribute("href")).toMatch(/^\/\?page=Leads&lead=/); expect(new Set(texts(node, ".pr-contacts .pr-status"))).toEqual(new Set(["Ohne Rückmeldung", "PrePing abgelehnt"]));
  }, 40_000);

  it("ohne Konten und ohne Schnittstellen: Die Seite sagt, wo man einen Käufer einrichtet", async () => {
    for (const endpoint of table("deliveryEndpoints").slice()) await call("leadops.deleteDeliveryEndpoint", { id: endpoint.id, membershipId: endpoint.membershipId });
    const spy = vi.spyOn(await import("../partner-sample"), "samplePartnerData").mockReturnValue({ accounts: [], deliveries: [], transactions: [] }); expect(await cardsNow()).toEqual([]);
    const root = await open(STATS); await until(() => Boolean(root.querySelector(".pr-empty")));
    expect(root.querySelector(".pr-empty h3")!.textContent).toBe("Noch keine Integration"); expect(root.querySelector(".pr-empty p")!.textContent).toBe("Sobald ein Käufer eine Schnittstelle hat, steht hier von selbst, was aus den gelieferten Leads wurde. Du richtest sie beim Käufer ein: Benutzer → Käufer öffnen → Reiter „Integration“.");
    expect(root.querySelector(".pr-empty a")!.getAttribute("href")).toBe("/?page=Benutzer"); expect(root.querySelector(".pr-empty")!.textContent).not.toContain("Partnerkonto"); spy.mockRestore();
  }, 40_000);
});

const feedback = (root: ParentNode) => root.querySelector<HTMLElement>("section.bf")!;
const setup = (root: ParentNode) => feedback(root).querySelector<HTMLFormElement>("form.bf-setup")!;
const kinds = (root: ParentNode) => Array.from(setup(root).querySelectorAll<HTMLLabelElement>(".bf-kinds label"));
const account = (root: ParentNode) => feedback(root).querySelector<HTMLElement>(".bf-account")!;

describe("Version 383 – Rückmeldung beim Käufer", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { vi.restoreAllMocks(); document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); cleanup(); resetStore(); });

  it("der Reiter „Integration“ hat einen Abschnitt „Rückmeldung des Käufers“ – direkt nach der Schnittstelle; die Abschnitte tragen Überschriften in einfachen Worten", async () => {
    const who = buyer(); const root = await open(`page=Benutzer&member=${who.membershipId}&tab=tools`); await until(() => Boolean(setup(root)));
    expect(feedback(root).getAttribute("aria-label")).toBe("Rückmeldung des Käufers"); expect(feedback(root).querySelector("h3.fx-h")!.textContent).toBe("Rückmeldung des Käufers"); expect(feedback(root).querySelector(".bf-head a")!.getAttribute("href")).toBe("/?page=Statistik&view=Integrationen"); expect(feedback(root).querySelector(".bf-head a")!.textContent!.trim()).toBe("Im Dashboard ansehen"); // die Seite heißt seit v377 „Integrationen“ – das Wort „Statistik“ steht nur noch in der Adresse
    expect(texts(root, ".it-section h3.fx-h")).toEqual(["Schnittstelle zu diesem Käufer", "Ablehnungen des Käufers einordnen", "Rückgabe an den Lieferanten", "Einfache Benachrichtigung (Webhook)", "Benachrichtigung testen"]);
    const sections = Array.from(root.querySelectorAll(".it-section")); expect(before(sections[0], feedback(root))).toBe(true); expect(before(feedback(root), sections[1])).toBe(true);
    for (const section of sections) expect(section.querySelector(":scope > .eyebrow, :scope > div > div > .eyebrow"), section.getAttribute("aria-label") ?? "").toBeNull(); // keine Schilder mehr als Überschrift
    expect(root.textContent ?? "").not.toMatch(/AUSGEHENDE API-CALLS|PARTNER-RESPONSE-MAPPING|RÜCKGABE-WEBHOOKS/);
    // noch nichts eingerichtet: ruhiger Hinweis, drei Wege, WattFox vorgewählt (die Schnittstelle verrät hier keinen Partner)
    expect(setup(root).querySelector(".bf-state b")!.textContent).toBe("Noch keine Rückmeldung eingerichtet."); expect(setup(root).querySelector(".bf-state")!.textContent).toContain("Das Dashboard zeigt für diesen Käufer trotzdem, was geliefert, abgelehnt und angenommen wurde.");
    expect(setup(root).querySelector(".bf-kinds legend")!.textContent).toBe("Wie meldet dieser Käufer zurück?"); expect(kinds(root).map((item) => item.querySelector("b")!.textContent)).toEqual(["WattFox", "Aroundhome", "Leadnodes, Enpal oder GoHighLevel"]);
    expect(kinds(root).map((item) => item.className.includes("is-on"))).toEqual([true, false, false]); expect(setup(root).querySelector(".bf-kinds em")).toBeNull(); expect(button(setup(root), "Adresse für WattFox erzeugen")).toBeTruthy();
    expect(setup(root).querySelector(".bf-fields")).toBeNull(); expect(setup(root).querySelector(".bf-existing")).toBeNull(); expect(feedback(root).querySelector(".bf-more")).toBeNull();
    // der Weg wechselt die Felder und den Knopf
    await click(kinds(root)[1].querySelector("input"), 300); expect(texts(setup(root), ".bf-fields .rd-field > span")).toEqual(["Publisher-ID", "Zugangstoken", "Export-Link (so, wie Aroundhome ihn mit dir geteilt hat)"]); expect(button(setup(root), "Zugang speichern")).toBeTruthy();
    await click(kinds(root)[2].querySelector("input"), 300); expect(texts(setup(root), ".bf-fields .rd-field > span")).toEqual(["Plattform", "Zugangsschlüssel (Token)"]); expect(texts(setup(root), ".bf-fields option")).toEqual(["Leadnodes", "Enpal", "GoHighLevel"]);
  }, 40_000);

  it("WattFox: ein Klick erzeugt die Adresse – das Konto gehört gleich diesem Käufer; „bei Storno reklamieren“, pausieren und entfernen", async () => {
    const who = buyer(); const root = await open(`page=Benutzer&member=${who.membershipId}&tab=tools`); await until(() => Boolean(setup(root)));
    await submit(setup(root), 1200); await until(() => accountsOf(who.userId).length === 1 && Boolean(account(root)));
    const stored = () => accountsOf(who.userId)[0]; expect(stored()).toMatchObject({ provider: "wattfox", label: "WattFox", buyerUserId: who.userId, reclaimOnCancel: true, enabled: true }); expect(String(stored().trackingToken)).toHaveLength(32);
    expect(said("Adresse für WattFox erzeugt.")).toBe(true); expect(feedback(root).querySelector("form.bf-setup")).toBeNull(); expect(button(feedback(root), "Weitere Rückmeldung einrichten")).toBeTruthy();
    expect(account(root).querySelector("header b")!.textContent).toBe("WattFox"); expect(account(root).querySelector("header small")!.textContent).toBe("WattFox meldet jede Änderung selbst"); expect(account(root).querySelector(".fx-pill")!.textContent).toBe("Eingeschaltet");
    expect(account(root).querySelector(".bf-url code")!.textContent).toBe(`https://leads.tanesco.example/api/partner/wattfox/${stored().trackingToken}`); expect(account(root).querySelector(".bf-url small")!.textContent).toContain("als Tracking-URL");
    // die Statistik: aus der Karte des Käufers ist die Karte des Partners geworden – mit Rückmeldung
    const mine = (await cardsNow()).find((item) => item.account.buyerUserId === who.userId)!; expect(mine.account).toMatchObject({ id: stored().id, provider: "wattfox", mode: "push", hasAccess: true }); expect(mine.title).toBe("WattFox"); expect((await cardsNow()).filter((item) => item.account.buyerUserId === who.userId)).toHaveLength(1);
    // bei Storno reklamieren: an → Grund wählbar; aus → kein Grund
    const toggle = () => account(root).querySelector<HTMLButtonElement>(`#bf-claim-${stored().id}`)!; expect(toggle().getAttribute("aria-checked")).toBe("true"); expect(account(root).querySelector(".bf-reason select")).toBeTruthy();
    const reason = table("reclamationReasons").find((row) => row.active)!; await type(account(root).querySelector(".bf-reason select"), String(reason.id), 900); await until(() => stored().reclaimReasonId === reason.id); expect(stored().reclaimReasonId).toBe(reason.id);
    await click(toggle(), 900); await until(() => stored().reclaimOnCancel === false); expect(account(root).querySelector(".bf-reason")).toBeNull();
    // pausieren und wieder einschalten
    await click(button(account(root), "Pausieren"), 900); await until(() => stored().enabled === false); expect(said("Rückmeldung pausiert.")).toBe(true); expect(account(root).querySelector(".fx-pill")!.textContent).toBe("Pausiert"); expect(account(root).className).toContain("is-off");
    await click(button(account(root), "Wieder einschalten"), 900); await until(() => stored().enabled === true); expect(account(root).querySelector(".fx-pill")!.className).toContain("is-good");
    // eine weitere Rückmeldung: WattFox steht nicht noch einmal zur Wahl (je Käufer eine Adresse); „Abbrechen“ schließt wieder
    await click(button(feedback(root), "Weitere Rückmeldung einrichten"), 400); expect(setup(root).querySelector(".bf-kinds legend")!.textContent).toBe("Welche Rückmeldung kommt dazu?"); expect(kinds(root).map((item) => item.querySelector("b")!.textContent)).toEqual(["Aroundhome", "Leadnodes, Enpal oder GoHighLevel"]);
    expect(setup(root).querySelector(".bf-kinds")!.className).toContain("is-two"); expect(setup(root).querySelector(".bf-state")).toBeNull(); await click(button(setup(root), "Abbrechen"), 300); expect(feedback(root).querySelector("form.bf-setup")).toBeNull(); expect(accountsOf(who.userId)).toHaveLength(1);
    // entfernen fragt nach und sagt, was dann fehlt
    await click(button(account(root), "Entfernen"), 500); await until(() => Boolean(document.querySelector(".app-confirm-text")));
    expect(document.querySelector(".app-confirm-text")!.textContent).toBe("Rückmeldung von WattFox entfernen? Stornos und Provisionen dieses Käufers erscheinen dann nicht mehr im Dashboard. Die Adresse gilt danach nicht mehr – Aufrufe von WattFox schlagen fehl."); expect(document.querySelector(".app-confirm-ok")!.textContent).toBe("Ja, entfernen");
    await click(document.querySelector(".app-confirm-cancel"), 400); expect(accountsOf(who.userId)).toHaveLength(1);
    await click(button(account(root), "Entfernen"), 500); await confirmOk(); await until(() => accountsOf(who.userId).length === 0); expect(said("Rückmeldung entfernt.")).toBe(true); await until(() => Boolean(setup(root))); expect(setup(root).querySelector(".bf-state")).toBeTruthy();
  }, 60_000);

  it("ein Kontingent übersteht das Einrichten und das Entfernen der Rückmeldung", async () => {
    const who = buyer(); await call("leadops.setPartnerQuota", { accountId: -who.userId, amount: 25, period: "month" }); const holder = accountsOf(who.userId)[0]; expect(holder.provider).toBe("api");
    const root = await open(`page=Benutzer&member=${who.membershipId}&tab=tools`); await until(() => Boolean(setup(root)));
    expect(setup(root).querySelector(".bf-state")).toBeTruthy(); // die Zeile, die nur das Kontingent hält, ist keine Rückmeldung
    await submit(setup(root), 1200); await until(() => Boolean(account(root)));
    expect(accountsOf(who.userId)).toHaveLength(1); expect(accountsOf(who.userId)[0]).toMatchObject({ id: holder.id, provider: "wattfox", quotaAmount: 25, quotaPeriod: "month" }); // aus der Zeile wurde das Konto
    expect(account(root).querySelector("footer small")!.textContent).toBe("Kontingent: 25 Leads je Monat – im Dashboard ändern."); expect(account(root).querySelector("footer small a")!.getAttribute("href")).toBe("/?page=Statistik&view=Integrationen");
    await click(button(account(root), "Entfernen"), 500); await until(() => Boolean(document.querySelector(".app-confirm-text"))); expect(document.querySelector(".app-confirm-text")!.textContent).toContain("Das eingetragene Kontingent bleibt erhalten.");
    await confirmOk(); await until(() => accountsOf(who.userId)[0]?.provider === "api"); expect(said("Rückmeldung entfernt. Das Kontingent bleibt.")).toBe(true);
    expect(accountsOf(who.userId)).toHaveLength(1); expect(accountsOf(who.userId)[0]).toMatchObject({ id: holder.id, provider: "api", trackingToken: null, quotaAmount: 25, quotaPeriod: "month" });
    const mine = (await cardsNow()).find((item) => item.account.buyerUserId === who.userId)!; expect(mine.quota).toMatchObject({ amount: 25, period: "month" }); expect(mine.title).toBe("Nordlicht Energie");
  }, 60_000);

  it("Aroundhome: Zugang eintragen, später ändern und abgleichen – der Zugangstoken erscheint nur gekürzt", async () => {
    const who = buyer(); const root = await open(`page=Benutzer&member=${who.membershipId}&tab=tools`); await until(() => Boolean(setup(root)));
    await click(kinds(root)[1].querySelector("input"), 300); await submit(setup(root), 500); expect(said("Bitte den Export-Link eintragen – oder Publisher-ID und Zugangstoken.")).toBe(true); expect(accountsOf(who.userId)).toHaveLength(0);
    const inputs = () => Array.from(setup(root).querySelectorAll<HTMLInputElement>(".bf-fields input")); await type(inputs()[0], "pub-4711"); await type(inputs()[1], "geheimer-zugang-9876"); await type(inputs()[2], "https://export.aroundhome.example/abc");
    await submit(setup(root), 1200); await until(() => accountsOf(who.userId).length === 1 && Boolean(account(root)));
    expect(accountsOf(who.userId)[0]).toMatchObject({ provider: "aroundhome", label: "Aroundhome", buyerUserId: who.userId, publisherId: "pub-4711", accessToken: "geheimer-zugang-9876", exportUrl: "https://export.aroundhome.example/abc", enabled: true });
    const fields = () => Array.from(account(root).querySelectorAll<HTMLInputElement>(".bf-fields input")); expect(fields().map((node) => node.value)).toEqual(["pub-4711", "••••••••9876", "https://export.aroundhome.example/abc"]); expect(account(root).textContent).not.toContain("geheimer-zugang");
    expect(account(root).querySelector("header small")!.textContent).toContain("alle 15 Minuten"); expect(account(root).querySelector(".bf-sync small")!.textContent).toBe("Noch kein Abgleich."); expect(button(account(root), "Zugang speichern")!.disabled).toBe(true);
    // abgleichen (in der Vorschau nachgestellt)
    await click(button(account(root), "Jetzt abgleichen"), 1200); await until(() => Boolean(accountsOf(who.userId)[0].lastSyncAt)); expect(account(root).querySelector(".bf-sync small")!.textContent).toMatch(/^Zuletzt abgeglichen am \d{2}\.\d{2}\.\d{4}/);
    // Publisher-ID ändern: der gekürzte Token bleibt der gespeicherte
    await type(fields()[0], "pub-4712"); expect(button(account(root), "Zugang speichern")!.disabled).toBe(false); expect(button(account(root), "Jetzt abgleichen")!.disabled).toBe(true); // erst speichern
    await submit(account(root).querySelector("form.bf-fields"), 1200); await until(() => accountsOf(who.userId)[0].publisherId === "pub-4712"); expect(accountsOf(who.userId)[0]).toMatchObject({ publisherId: "pub-4712", accessToken: "geheimer-zugang-9876" });
    const mine = (await cardsNow()).find((item) => item.account.buyerUserId === who.userId)!; expect(mine.account).toMatchObject({ provider: "aroundhome", mode: "pull", hasAccess: true }); expect(mine.title).toBe("Aroundhome");
  }, 60_000);

  it("die Schnittstelle verrät den Partner – der Weg ist vorgewählt; ein Konto ohne Käufer lässt sich mit einem Klick zuordnen", async () => {
    const who = buyer(); const endpoint = table("deliveryEndpoints").find((row) => row.id === who.endpointId)!; endpoint.bodyTemplate = WATTFOX_TEMPLATE; // seine Schnittstelle nutzt jetzt die Vorlage von WattFox
    const free = await call("leadops.createWattfoxAccount", { label: "WattFox alt", reclaimOnCancel: false, reclaimReasonId: null }); await call("leadops.setPartnerQuota", { accountId: -who.userId, amount: 8, period: "week" });
    expect((await call("leadops.getBuyerFeedback", { membershipId: who.membershipId })).suggested).toBe("wattfox");
    const root = await open(`page=Benutzer&member=${who.membershipId}&tab=tools`); await until(() => Boolean(setup(root)));
    expect(kinds(root)[0].className).toContain("is-on"); expect(kinds(root)[0].querySelector("em")!.textContent).toBe("passt zur Schnittstelle"); expect(setup(root).querySelectorAll(".bf-kinds em")).toHaveLength(1);
    const existing = setup(root).querySelector(".bf-existing")!; expect(existing.querySelector("b")!.textContent).toBe("Schon vorhanden, aber noch keinem Käufer zugeordnet"); expect(texts(existing, "li > span:nth-child(2)")).toEqual(["WattFox (WattFox alt)"]);
    await click(button(existing, "Diesem Käufer zuordnen"), 1200); await until(() => table("partnerAccounts").find((row) => row.id === free.id)?.buyerUserId === who.userId);
    expect(said("Rückmeldung zugeordnet.")).toBe(true); expect(accountsOf(who.userId)).toHaveLength(1); expect(accountsOf(who.userId)[0]).toMatchObject({ id: free.id, provider: "wattfox", quotaAmount: 8, quotaPeriod: "week" }); // das Kontingent ging mit, die Zeile „api“ ist weg
    await until(() => Boolean(account(root))); expect(account(root).querySelector("header b")!.textContent).toBe("WattFox (WattFox alt)"); expect(account(root).querySelector("footer small")!.textContent).toContain("Kontingent: 8 Leads je Woche");
  }, 60_000);
});

describe("Version 383 – Einstellungen → Integrationen: nur noch, was für alle gilt", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { vi.restoreAllMocks(); document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); cleanup(); resetStore(); });

  it("der Kopf sagt, wo ein Käufer eingerichtet wird; Konten legt man hier nicht mehr an; die älteren Verbindungen stehen am Ende", async () => {
    const root = await open("page=Einstellungen&setting=Integrationen"); await until(() => root.querySelectorAll(".ie-card").length >= 5);
    const page = root.querySelector(".st.is-wide .ie")!; expect(root.querySelectorAll("h1")).toHaveLength(1); expect(page.querySelector(".page-intro h1")!.textContent).toBe("Integrationen"); expect(page.querySelector(".page-intro .eyebrow")!.textContent).toContain("EINSTELLUNGEN");
    expect(page.querySelector(".page-intro p")!.textContent).toContain("Einen Käufer richtest du bei ihm selbst ein: Benutzer → Käufer öffnen → Reiter „Integration“."); expect(page.querySelector(".page-intro a")!.getAttribute("href")).toBe("/?page=Benutzer");
    expect(Array.from(page.querySelectorAll(".ie-card")).map((node) => node.getAttribute("aria-label"))).toEqual(["Rückmeldungen der Käufer", "Stornogründe von Aroundhome zuordnen", "Stornogründe von WattFox zuordnen", "Telefonnummern prüfen", "Vorlagen für Schnittstellen"]);
    expect(texts(page, ".ie-card h2.fx-h, .ie-card h3.fx-h")).toEqual(["Rückmeldungen der Käufer", "Stornogründe von Aroundhome zuordnen", "Stornogründe von WattFox zuordnen", "Telefonnummern prüfen (hlrlookup.com)", "Vorlagen für Schnittstellen (Presets)"]); expect(page.querySelector(".ie-stack .eyebrow")).toBeNull();
    for (const gone of ["Konto hinzufügen", "Tracking-URL erzeugen", "Konto anlegen", "Weiteres Konto hinzufügen"]) expect(button(page, gone), gone).toBeUndefined();
    expect(page.textContent ?? "").not.toMatch(/PARTNER-STATUSRÜCKMELDUNG|AROUNDHOME-KONTEN|WATTFOX TRACKING-URL|PLATTFORMEN · STATISTIK/);
    expect(page.querySelector('[aria-label="Rückmeldungen der Käufer"] .ie-empty')!.textContent).toContain("Noch keine Rückmeldung eingerichtet."); expect(page.querySelector('[aria-label="Rückmeldungen der Käufer"] .ie-empty a')!.getAttribute("href")).toBe("/?page=Benutzer");
    // ältere Verbindungen: am Ende, mit eigener Überschrift und der Erklärung, wann sie greifen
    const older = page.querySelector('section[aria-label="Ältere Verbindungen"]')!; expect(before(page.querySelector(".ie-stack")!, older)).toBe(true); expect(older.querySelector("h2.fx-h")!.textContent).toBe("Ältere Verbindungen (Integrationsbuilder)");
    expect(older.querySelector(".ie-older p")!.textContent).toContain("greift nur, wenn beim Käufer keine eigene Schnittstelle eingerichtet ist"); expect(older.textContent).toContain("Vorlagenbibliothek"); expect(older.textContent).not.toContain("ORGANISATION · API-VERBINDUNGEN");
  }, 40_000);

  it("Rückmeldungen der Käufer: mit Käufer führt die Zeile zu ihm, ohne Käufer lässt sie sich zuordnen; entfernen fragt nach", async () => {
    const who = buyer(); const own = await call("leadops.createWattfoxAccount", { label: "", reclaimOnCancel: true, reclaimReasonId: null, buyerUserId: who.userId });
    const free = await call("leadops.saveAroundhomeAccount", { label: "Aroundhome PV", publisherId: "p-1", accessToken: "t-123456", exportUrl: "https://export.aroundhome.example/x", reclaimOnCancel: false, reclaimReasonId: null, enabled: true });
    const root = await open("page=Einstellungen&setting=Integrationen"); await until(() => root.querySelectorAll(".ie-rows li").length === 2);
    const rows = () => Array.from(root.querySelectorAll<HTMLElement>(".ie-rows li")); const row = (name: string) => rows().find((node) => node.querySelector("b")!.textContent === name)!;
    expect(rows().map((node) => node.querySelector("b")!.textContent)).toEqual(["Aroundhome (Aroundhome PV)", "WattFox"]); expect(row("WattFox").querySelector("small")!.textContent).toBe("WattFox meldet jede Änderung selbst"); expect(row("Aroundhome (Aroundhome PV)").querySelector("small")!.textContent).toBe("Noch kein Abgleich");
    await until(() => Boolean(row("WattFox").querySelector("a.fx-tool"))); expect(row("WattFox").querySelector("a.fx-tool")!.getAttribute("href")).toBe(`/?page=Benutzer&member=${who.membershipId}&tab=tools`); expect(row("WattFox").querySelector("select")).toBeNull(); expect(row("WattFox").className).not.toContain("is-open");
    // ohne Käufer: Hinweis und Auswahl
    const loose = row("Aroundhome (Aroundhome PV)"); expect(loose.className).toContain("is-open"); expect(root.querySelector(".ie-hint")!.textContent).toContain("Ordne sie dem Käufer zu, über den geliefert wird"); const select = loose.querySelector<HTMLSelectElement>("select.ie-assign")!; expect(select.options[0].textContent).toBe("Käufer zuordnen …");
    expect(Array.from(select.options).map((option) => Number(option.value))).toContain(who.userId); expect(Array.from(select.options).slice(1).every((option) => table("memberships").find((item) => item.userId === Number(option.value))?.partnerType !== "lieferant")).toBe(true);
    const other = Array.from(select.options).map((option) => Number(option.value)).find((value) => value && value !== who.userId)!; await type(select, String(other), 1200); await until(() => table("partnerAccounts").find((item) => item.id === free.id)?.buyerUserId === other);
    expect(said("Käufer zugeordnet.")).toBe(true); await until(() => !root.querySelector(".ie-hint")); expect(root.querySelector(".ie-rows select")).toBeNull(); expect(row("Aroundhome (Aroundhome PV)").querySelector("a.fx-tool")!.getAttribute("href")).toMatch(/^\/\?page=Benutzer&member=\d+&tab=tools$/);
    // entfernen
    await click(row("WattFox").querySelector(".ie-remove"), 500); await until(() => Boolean(document.querySelector(".app-confirm-text"))); expect(document.querySelector(".app-confirm-text")!.textContent).toBe("Rückmeldung „WattFox“ entfernen? Stornos und Provisionen dieses Partners erscheinen dann nicht mehr im Dashboard. Die Adresse für WattFox gilt danach nicht mehr.");
    await confirmOk(); await until(() => !table("partnerAccounts").some((item) => item.id === own.id)); expect(said("Rückmeldung entfernt.")).toBe(true); await until(() => rows().length === 1);
  }, 60_000);

  it("Stornogründe zuordnen und Telefonnummern prüfen arbeiten wie bisher – in einfachen Worten", async () => {
    const root = await open("page=Einstellungen&setting=Integrationen"); await until(() => root.querySelectorAll(".ie-card").length >= 5);
    const rules = root.querySelector<HTMLElement>('[aria-label="Stornogründe von WattFox zuordnen"]')!; expect(rules.querySelector(".ie-empty")!.textContent).toBe("Noch keine Zuordnung."); expect(rules.querySelector(".ie-head p")!.textContent).toBe("Welcher Code von WattFox wird zu welchem Reklamationsgrund? Die erste passende Regel gewinnt.");
    await click(button(rules, "Regel hinzufügen"), 300); const line = rules.querySelector<HTMLElement>(".ie-rules li")!; expect(texts(line, "select:first-child option")).toEqual(["enthält", "ist genau", "beginnt mit"]);
    const reason = table("reclamationReasons")[0]; await type(line.querySelector('input[aria-label="Text des Partners"]'), "duplicate"); await type(line.querySelector('select[aria-label="Reklamationsgrund"]'), String(reason.id)); await click(button(rules, "Zuordnung speichern"), 1200);
    await until(() => table("partnerCancelRules").length === 1); expect(said("Zuordnung gespeichert.")).toBe(true); expect(table("partnerCancelRules")[0]).toMatchObject({ provider: "wattfox", matchOp: "enthaelt", matchValue: "duplicate", reasonId: reason.id });
    expect(root.querySelector('[aria-label="Stornogründe von Aroundhome zuordnen"] .ie-empty')).toBeTruthy(); // die andere Zuordnung bleibt leer
    // Telefonnummern prüfen: testen geht erst, wenn Zugangsdaten gespeichert sind
    const phone = root.querySelector<HTMLElement>('[aria-label="Telefonnummern prüfen"]')!; expect(button(phone, "Verbindung testen")!.disabled).toBe(true); expect(phone.querySelector(".ie-foot small")!.textContent).toBe("Noch nicht getestet.");
    const inputs = Array.from(phone.querySelectorAll<HTMLInputElement>(".ie-fields input")); await type(inputs[0], "schluessel-1234"); await type(inputs[1], "passwort-5678"); await click(phone.querySelector("#ie-hlr"), 300); await click(button(phone, "Speichern"), 1200);
    await until(() => table("partnerAccounts").some((row) => row.provider === "hlrlookup")); expect(said("Telefonnummern-Prüfung gespeichert.")).toBe(true); expect(table("partnerAccounts").find((row) => row.provider === "hlrlookup")).toMatchObject({ enabled: true, apiKey: "schluessel-1234" });
    await until(() => button(phone, "Verbindung testen")!.disabled === false); expect(Array.from(root.querySelectorAll(".ie-rows li"))).toHaveLength(0); // die Telefonnummern-Prüfung ist keine Rückmeldung eines Käufers
  }, 60_000);
});
