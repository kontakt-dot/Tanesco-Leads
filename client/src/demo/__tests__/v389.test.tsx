import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { getStore, resetStore } from "../backend";
import { shortMoney, summarizeBuyer } from "../../../../shared/buyer-stats";
import { orderStatusLabel } from "../../../../shared/order-status";

/** Version 389 – Käufer-Seite episch (Kopf mit Zahlen, Reiter, Karten, Zeitleiste) und „Freigegeben“ in Türkisblau. */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 500) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const until = async (check: () => boolean, max = 15_000) => { const start = Date.now(); while (!check() && Date.now() - start < max) await settle(250); };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const tables = () => getStore().tables as unknown as Record<string, Row[]>;
const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((node) => node.textContent);
const tab = (root: HTMLElement, label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('.md-tabs [role="tab"]')).find((node) => node.querySelector("span")?.textContent === label);

/** Was der Käufer bekommen hat – wie am Server: über seine Bestellung (nicht an eine andere Station), über Station mit seinem Konto, direkt ohne Bestellung. */
function expectedStats(userId: number, company: string) {
  const t = tables(); const configs = t.orderOperationalConfigs.filter((config) => config.buyerUserId === userId); const orderIds = new Set(configs.map((config) => config.orderId));
  const owner = (stopId: number | null | undefined) => (stopId ? t.deliveryStops.find((stop) => stop.id === stopId)?.buyerUserId ?? null : null);
  const rows = t.leadDeliveries.filter((row) => { const who = owner(row.stopId); return Boolean((row.orderId && orderIds.has(row.orderId) && (!who || who === userId)) || (row.stopId && who === userId) || (!row.orderId && !row.stopId && row.buyerName === company)); })
    .map((row) => ({ id: Number(row.id), leadId: Number(row.leadId), result: String(row.result), unitPrice: row.unitPrice ?? null, occurredAt: row.occurredAt }));
  return summarizeBuyer(rows, configs.map((config) => ({ status: String(t.orders.find((order) => order.id === config.orderId)?.status ?? "offen"), active: config.active })));
}

describe("Version 389", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); });

  it("Käufer: Kopf mit Firmenname, Schildern und den Zahlen aus seinen Lieferungen; „Schnittstelle“ öffnet den Reiter „Integration“; Leiste mit letzter Lieferung", async () => {
    window.history.replaceState(null, "", "/?page=Benutzer&member=2"); const root = mount().container;
    await until(() => root.querySelector(".md-kpis") !== null);
    const t = tables(); const membership = t.memberships.find((row) => row.id === 2)!; const user = t.users.find((row) => row.id === membership.userId)!; expect(membership.partnerType).toBe("käufer");
    const hero = root.querySelector<HTMLElement>(".md-hero")!; expect(hero.classList.contains("is-buyer")).toBe(true); expect(hero.getAttribute("aria-label")).toBe("Käufer");
    expect(hero.querySelector("h1")!.textContent).toBe(user.company); expect(hero.querySelector(".md-hero-who p")!.textContent).toBe(`${user.name} · ${user.email}`);
    expect(hero.querySelector(".md-hero-mark")!.textContent).toBe(String(user.company).split(/\s+/).map((part: string) => part[0]).join("").slice(0, 2).toUpperCase());
    const endpoints = t.deliveryEndpoints.filter((row) => row.membershipId === 2 && row.enabled).length; expect(endpoints).toBeGreaterThan(0);
    expect(texts(hero, ".md-chip")).toEqual(["Käufer", `${endpoints} ${endpoints === 1 ? "Schnittstelle" : "Schnittstellen"} an`]);
    // fünf Zahlen – genau die aus seinen Lieferungen und Bestellungen
    const stats = expectedStats(user.id, String(user.company)); expect(stats.delivered).toBeGreaterThan(0);
    const tiles = Array.from(root.querySelectorAll(".md-kpis > div"));
    expect(tiles.map((node) => node.querySelector("dt")!.textContent)).toEqual(["Leads bekommen", "Wert geliefert", "Bestellungen", "Reklamiert", "Abgelehnt"]);
    expect(tiles.map((node) => node.querySelector("b")!.textContent)).toEqual([String(stats.delivered), shortMoney(stats.value), String(stats.ordersActive), String(stats.claimed), String(stats.rejected)]);
    expect(tiles.map((node) => node.querySelector("em")!.textContent)).toEqual([`${stats.thisMonth} diesen Monat`, `Ø ${stats.averagePrice.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € je Lead`, `von ${stats.ordersTotal}`, `${stats.claimRate} % der Leads`, "von seiner Schnittstelle"]);
    expect(tiles[2].querySelector("small")!.textContent).toBe("aktiv");
    // Leiste unter dem Kopf
    expect(texts(root, ".md-rail dt")).toEqual(["Zahlungsart", "Guthaben", "Letzte Lieferung", "Reklamationsfrist", "Kunde seit"]);
    expect(root.querySelectorAll(".md-rail dd")[2].textContent).toMatch(/^(heute|gestern), \d{2}:\d{2}$|^\d{2}\.\d{2}\.\d{4}$/);
    // das Schild „Schnittstelle“ führt zum Reiter „Integration“
    await click(hero.querySelector(".md-chip-plug"), 800);
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("tools"); expect(root.querySelector('.md-tabs [aria-selected="true"]')!.textContent).toBe("Integration");
  }, 60_000);

  it("Reiter: Bestellungen als Karten mit Fortschritt (Klick öffnet die Bestellung), Aktivität als Zeitleiste mit Farbe je Ereignis, Stammdaten in drei Karten mit Schaltern", async () => {
    window.history.replaceState(null, "", "/?page=Benutzer&member=2&tab=bestellungen"); const root = mount().container;
    await until(() => root.querySelectorAll(".md-order").length > 0);
    const t = tables(); const user = t.users.find((row) => row.id === t.memberships.find((item) => item.id === 2)!.userId)!; const configs = t.orderOperationalConfigs.filter((config) => config.buyerUserId === user.id);
    const cards = Array.from(root.querySelectorAll<HTMLAnchorElement>(".md-order")); expect(cards).toHaveLength(configs.length);
    for (const card of cards) {
      const id = Number(new URLSearchParams(card.getAttribute("href")!.slice(1)).get("orderId")); expect(card.getAttribute("href")).toBe(`/?page=Bestellungen&orderId=${id}`);
      const order = t.orders.find((row) => row.id === id)!; const config = configs.find((row) => row.orderId === id)!; const label = orderStatusLabel(order.status, config.active);
      expect(card.querySelector(".md-order-name b")!.textContent).toBe(order.name || order.orderNumber); expect(card.querySelector(".md-order-name small")!.textContent).toBe(order.orderNumber);
      expect(card.querySelector(".md-order-state")!.textContent).toBe(label); expect(card.className).toBe(`md-order is-${label === "Aktiv" ? "aktiv" : label === "Erfüllt" ? "erfuellt" : label === "Storniert" ? "storniert" : "inaktiv"}`);
      if (order.quantity) { const share = Math.min(100, Math.round((Number(order.deliveredCount ?? 0) * 100) / Number(order.quantity))); expect(card.querySelector(".md-order-progress em")!.textContent).toBe(`${share} %`); expect(card.querySelector<HTMLElement>(".md-order-bar i")!.style.width).toBe(`${share}%`); }
      expect(texts(card, "dt")).toEqual(["Preis", "Wert", "Auslieferung", "Angelegt"]);
    }
    // Aktivität: Zeitleiste, jeder Punkt mit Farbe
    await click(tab(root, "Aktivität"), 400); await until(() => root.querySelectorAll(".md-timeline li").length > 0);
    const items = Array.from(root.querySelectorAll(".md-timeline li")); expect(items.length).toBeGreaterThan(0);
    for (const item of items) { expect(item.className).toMatch(/^is-(good|bad|warn|info)$/); const title = item.querySelector("b")!.textContent ?? ""; if (/reklamation/i.test(title)) expect(item.className).toBe("is-warn"); else if (/abgelehnt/i.test(title)) expect(item.className).toBe("is-bad"); }
    expect(items[0].querySelector("time")!.textContent).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/); // ohne Sekunden
    // Stammdaten: drei Karten mit Überschrift, Schalter als Zeilen; „Eingehendes PrePing“ nur bei Konten, die Leads liefern
    await click(tab(root, "Stammdaten"), 400); await until(() => root.querySelectorAll(".md-card").length > 0);
    expect(Array.from(root.querySelectorAll(".md-stack > section")).map((node) => node.getAttribute("aria-label"))).toEqual(["Person", "Rechnungsadresse", "Zugang und Schutz"]);
    expect(texts(root, ".md-sec h2")).toEqual(["Person", "Rechnungsadresse", "Zugang & Schutz"]); expect(root.querySelector(".md-stack .eyebrow")).toBeNull();
    const settings = t.memberOperationalSettings.find((row) => row.membershipId === 2);
    expect(texts(root, ".md-toggle b")).toEqual(settings?.supplierActive ? ["Aktiv", "Duplikat-Schutz", "Eingehendes PrePing"] : ["Aktiv", "Duplikat-Schutz"]);
    const guard = Array.from(root.querySelectorAll<HTMLLabelElement>(".md-toggle")).find((node) => node.querySelector("b")!.textContent === "Duplikat-Schutz")!.querySelector<HTMLInputElement>("input")!;
    expect(guard.getAttribute("role")).toBe("switch"); const before = guard.checked;
    await click(guard, 200); expect(guard.checked).toBe(!before);
    await click(Array.from(root.querySelectorAll(".md-savebar button")).find((node) => node.textContent === "Speichern"), 900);
    expect(tables().memberOperationalSettings.find((row) => row.membershipId === 2)!.duplicateProtection).toBe(!before);
  }, 60_000);

  it("Team-Mitglied: derselbe Kopf ohne Käufer-Zahlen – Name als Titel, Rolle als Schild, Leiste mit Webhook und „Registriert am“", async () => {
    const t = tables(); const repUser = t.users.find((row) => /^Taner/.test(String(row.name)))!; const rep = t.memberships.find((row) => row.userId === repUser.id)!;
    window.history.replaceState(null, "", `/?page=Benutzer&member=${rep.id}`); const root = mount().container;
    await until(() => root.querySelector(".md-hero h1") !== null);
    expect(root.querySelector(".md-hero")!.classList.contains("is-buyer")).toBe(false); expect(root.querySelector(".md-kpis")).toBeNull(); expect(root.querySelector(".md-chip-plug")).toBeNull();
    expect(root.querySelector(".md-hero h1")!.textContent).toBe(repUser.name); expect(texts(root, ".md-hero .md-chip")).toEqual(["Vertriebler"]);
    expect(texts(root, ".md-rail dt")).toEqual(["Zahlungsart", "Guthaben", "Webhook", "Reklamationsfrist", "Registriert am"]);
  }, 60_000);

  it("Leads: „Freigegeben“ in Türkisblau – jede Kapsel in der Tabelle", async () => {
    window.history.replaceState(null, "", "/?page=Leads"); const root = mount().container;
    await until(() => root.querySelectorAll(".lt-row").length > 0);
    await click(Array.from(root.querySelectorAll(".lt-tabs button")).find((node) => node.textContent?.trim().startsWith("Freigegeben")), 1200);
    await until(() => root.querySelectorAll(".lt-pill-status").length > 0);
    const pills = Array.from(root.querySelectorAll<HTMLElement>(".lt-pill-status")); expect(pills.length).toBeGreaterThan(0);
    for (const pill of pills) { expect(pill.textContent).toBe("Freigegeben"); expect(pill.style.getPropertyValue("--cat")).toBe("#06b6d4"); }
  }, 60_000);
});
