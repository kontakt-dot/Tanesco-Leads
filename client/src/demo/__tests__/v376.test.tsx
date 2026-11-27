import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";

/**
 * Version 376 – Lieferkette aus der Bestellung, einfacher: Station 1 ist die Bestellung (mit allem, was von dort gilt), darunter weitere Stationen;
 * je Station steht, wann der Lead weitergeht; Reklamationsgründe als Liste, die sofort speichert. Dazu der neue Kopf mit Reitern beim Benutzer.
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
async function until(check: () => boolean, tries = 40) { for (let index = 0; index < tries && !check(); index += 1) await settle(150); }
const click = async (node: Element | null | undefined, wait = 600) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const open = async (query: string, wait = 2600) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
type Row = Record<string, any>;
const table = (name: string) => (getStore().tables as unknown as Record<string, Row[]>)[name];
const stopsOf = (chainId: number) => table("deliveryStops").filter((row) => row.chainId === chainId).sort((a, b) => Number(a.position) - Number(b.position));
const cards = (root: Element) => Array.from(root.querySelectorAll<HTMLElement>(".lk-track > .lk-stop"));
const chips = (card: Element) => Array.from(card.querySelectorAll(".lk-why li")).map((node) => node.textContent ?? "");
const button = (root: Element, text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((node) => (node.textContent ?? "").includes(text));
const aroundhome = () => { const chain = table("deliveryChains").find((row) => row.name === "Aroundhome Haustür")!; const order = table("orders").find((row) => row.id === chain.orderId)!; const sibling = table("deliveryChains").find((row) => row.orderId === order.id && row.id !== chain.id)!; return { chain, order, sibling }; };

describe("Version 376", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); cleanup(); resetStore(); });

  it("Kette einer Bestellung: Station 1 ist die Bestellung – mit Lieferant, Sparte, Preis, Menge, Start, Gebiet und Liefertagen; sie lässt sich hier nicht löschen oder verschieben", async () => {
    const root = await open("page=Lieferkette&chain=1"); await until(() => cards(root).length > 0);
    const stops = cards(root); expect(stops).toHaveLength(3);
    const first = stops[0]; expect(first.classList.contains("is-order")).toBe(true);
    expect(first.querySelector(".lk-stop-name small")!.textContent).toMatch(/^Aus der Bestellung ORD-/);
    const facts = Object.fromEntries(Array.from(first.querySelectorAll(".lk-facts > div")).map((node) => [node.querySelector("dt")!.textContent, node.querySelector("dd")!.textContent]));
    expect(facts).toMatchObject({ Leadsparte: "Photovoltaik", Preis: "44,00 € je Lead", Menge: "87 von 120 geliefert", Ende: "fortlaufend", Gebiet: "Landesweit", Liefertage: "Mo–Fr" });
    expect(facts.Lieferant).toBeTruthy(); expect(facts.Start).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
    expect(first.querySelector(".lk-order-hint")!.textContent).toContain("Vor dem Start, nach dem Ende und wenn die Menge erreicht ist");
    // Station 1: Preis fest, kein Löschen, kein Verschieben, kein Schalter – die nächste Station kann nicht vor sie
    expect(first.querySelector(".lk-stop-fixed")!.textContent).toBe("44,00 €"); expect(first.querySelector(".lk-stop-delete")).toBeNull(); expect(first.querySelector(".lk-grip")).toBeNull(); expect(first.querySelector('[role="switch"]')).toBeNull();
    expect(stops[1].querySelector(".lk-stop-delete")).toBeTruthy(); expect(stops[1].querySelector<HTMLButtonElement>('button[aria-label="Nach oben"]')!.disabled).toBe(true);
    // je Station: wann der Lead weitergeht
    expect(first.querySelector(".lk-why-lead")!.textContent).toBe("Der Lead geht zur nächsten Station, wenn");
    expect(chips(first).some((text) => text.startsWith("das Gebiet der Bestellung nicht passt"))).toBe(true);
    expect(chips(first).some((text) => text.includes("kein Liefertag ist oder eine Lieferpause läuft") && text.includes("Mo–Fr"))).toBe(true);
    expect(chips(first).some((text) => text.includes("seine Schnittstelle den Lead ablehnt"))).toBe(true);
    for (const text of ["das Gebiet nicht passt", "der Kunde den Kontakt schon hat", "er reklamiert"]) expect(chips(stops[1]).some((chip) => chip.includes(text))).toBe(true);
    expect(stops[2].querySelector(".lk-why-lead")!.textContent).toBe("Der Lead verlässt die Kette, wenn");
    // ruhiger: keine Tabelle mit Kopfzeile, keine eigenen Speichern-Knöpfe für die Gründe
    expect(root.querySelector(".lk-detail thead")).toBeNull(); expect(root.textContent).not.toContain("Gründe speichern"); expect(root.textContent).not.toContain("Geo speichern");
    expect(root.querySelector(".lk-add-btn")!.textContent).toContain("Nächste Station hinzufügen"); expect(root.querySelector(".lk-end")!.textContent).toContain("Nimmt keine Station den Lead");
  }, 40000);

  it("Reklamationsgründe einer Station: „weitergeben“ und „erlaubt“ speichern sofort; die Standard-Gründe lassen sich ergänzen", async () => {
    const root = await open("page=Lieferkette&chain=1"); await until(() => cards(root).length > 0);
    const stopId = Number(stopsOf(1)[1].id); const second = () => cards(root)[1];
    await click(second().querySelector(".lk-stop-name")); expect(second().classList.contains("is-open")).toBe(true);
    const rows = () => Array.from(second().querySelectorAll<HTMLElement>(".lk-reason-list li"));
    const reasonsBefore = table("reclamationReasons").length; expect(rows()).toHaveLength(reasonsBefore);
    const reasonId = (index: number) => Number(table("reclamationReasons").find((row) => row.name === rows()[index].querySelector(".lk-reason-name")!.textContent)!.id);
    const stored = (id: number) => table("deliveryStopReasons").find((row) => row.stopId === stopId && row.reasonId === id);
    // „weitergeben“
    const firstId = reasonId(0); expect(rows()[0].querySelectorAll(".lk-seg button")[1].getAttribute("aria-pressed")).toBe("true");
    await click(rows()[0].querySelectorAll(".lk-seg button")[0], 900);
    expect(stored(firstId)).toMatchObject({ allowed: true, passOn: true });
    expect(rows()[0].querySelectorAll(".lk-seg button")[0].getAttribute("aria-pressed")).toBe("true");
    expect(second().querySelector(".lk-saved")!.textContent).toBe("Gespeichert");
    expect(chips(second()).some((text) => text.includes(`bei 1 von ${reasonsBefore} Gründen`))).toBe(true);
    // „erlaubt“ aus
    const secondId = reasonId(1);
    await click(rows()[1].querySelector('[role="switch"]'), 900);
    expect(stored(secondId)).toMatchObject({ allowed: false }); expect(rows()[1].classList.contains("is-off")).toBe(true);
    // alle enden hier
    await click(button(second(), "alle enden hier"), 900);
    expect(table("deliveryStopReasons").filter((row) => row.stopId === stopId).every((row) => row.passOn === false)).toBe(true);
    expect(chips(second()).some((text) => text.includes("bei keinem Grund – der Lead endet hier"))).toBe(true);
    // Standard-Gründe ergänzen: die fehlenden kommen dazu, die Einstellungen der Station bleiben
    const add = button(second(), "Standard-Gründe ergänzen")!; const missing = Number(add.textContent!.match(/^(\d+) /)![1]); expect(missing).toBeGreaterThan(20);
    await click(add, 1200); await until(() => rows().length === reasonsBefore + missing);
    expect(table("reclamationReasons")).toHaveLength(reasonsBefore + missing); expect(rows()).toHaveLength(reasonsBefore + missing);
    expect(table("reclamationReasons").find((row) => row.name === "Zustellung fehlgeschlagen (API)")).toMatchObject({ forwardToNextStop: true, active: true });
    expect(button(second(), "Standard-Gründe ergänzen")).toBeUndefined(); expect(stored(secondId)).toMatchObject({ allowed: false });
  }, 60000);

  it("Nächste Station: einmal eintragen – sie steht auch in der Kette der anderen Sparte derselben Bestellung", async () => {
    const { chain, sibling } = aroundhome(); expect(stopsOf(chain.id)).toHaveLength(1); expect(stopsOf(sibling.id)).toHaveLength(1);
    expect(stopsOf(chain.id)[0]).toMatchObject({ orderStop: true, buyerName: "Aroundhome GmbH" }); expect(stopsOf(sibling.id)[0]).toMatchObject({ orderStop: true, buyerName: "Aroundhome GmbH" });
    const root = await open(`page=Lieferkette&chain=${chain.id}`); await until(() => cards(root).length > 0);
    // seit v379: Beide Sparten haben dieselbe Kette – beide sind angehakt, und was hier festgelegt wird, gilt für beide
    const sparten = () => Array.from(root.querySelectorAll<HTMLButtonElement>(".lk-sparten-chips .lk-sparte")); expect(sparten().map((node) => node.textContent)).toEqual(["Alle 2 Sparten", "Photovoltaik", "Wärmepumpe"]); expect(sparten().map((node) => node.getAttribute("aria-pressed"))).toEqual(["true", "true", "true"]);
    await click(root.querySelector(".lk-add-btn"));
    const form = root.querySelector<HTMLFormElement>(".lk-add-form")!; const select = form.querySelector("select")!; const buyerUserId = Number(select.value); expect(buyerUserId).toBeGreaterThan(0);
    expect(form.querySelector(".lk-add-all")!.textContent).toBe("Die Station kommt in die Ketten von Photovoltaik und Wärmepumpe – wie oben angehakt.");
    await act(async () => { fireEvent.change(form.querySelector<HTMLInputElement>(".lk-add-price input")!, { target: { value: "29,5" } }); });
    await click(button(form, "Station hinzufügen"), 900); await until(() => stopsOf(sibling.id).length === 2);
    expect(stopsOf(chain.id).map((row) => [row.position, row.buyerUserId, Number(row.unitPrice), Boolean(row.orderStop)])).toEqual([[1, stopsOf(chain.id)[0].buyerUserId, 35, true], [2, buyerUserId, 29.5, false]]);
    expect(stopsOf(sibling.id).map((row) => [row.position, row.buyerUserId, Number(row.unitPrice)])).toEqual([[1, stopsOf(sibling.id)[0].buyerUserId, 35], [2, buyerUserId, 29.5]]);
    await until(() => cards(root).length === 2); expect(root.querySelector(".lk-add-form")).toBeNull();
    // zur anderen Sparte wechseln: abwählen – dann steht sie unter den Sparten mit eigener Kette und lässt sich ansehen
    await click(sparten()[2], 400); await click(root.querySelector(".lk-sparten-apart button"), 900); await until(() => new URLSearchParams(window.location.search).get("chain") === String(sibling.id));
    expect(new URLSearchParams(window.location.search).get("chain")).toBe(String(sibling.id)); expect(cards(root)).toHaveLength(2);
  }, 50000);

  it("Bestellung, Schritt „Lieferkette“: die Kette der Bestellung steht schon da – bei einer neuen Bestellung entsteht sie mit dem Speichern", async () => {
    const { order } = aroundhome();
    const root = await open(`page=Bestellungen&orderId=${order.id}`); await until(() => root.querySelectorAll(".order-steps button").length === 2);
    const steps = root.querySelectorAll<HTMLButtonElement>(".order-steps button"); expect(steps[1].textContent).toContain("Lieferkette"); expect(steps[1].textContent).toContain("Station 1 ist die Bestellung");
    await click(steps[1], 900); await until(() => cards(root).length > 0);
    expect(root.querySelector(".lk-embed-head h2")!.textContent).toBe("Lieferkette der Bestellung");
    expect(cards(root)[0].classList.contains("is-order")).toBe(true); expect(root.querySelector(".lk-sparten")).toBeTruthy();
    expect(root.textContent).not.toContain("Optionale Lieferkette"); expect(root.textContent).not.toContain("Neue Lieferkette"); expect(cards(root)[0].textContent).not.toContain("Bestellung öffnen");
    // neue Bestellung: noch keine Kette – mit dem Speichern steht sie; ohne gewählten Käufer geht nichts raus
    cleanup(); const fresh = await open("page=Bestellungen&overview=1"); const ordersBefore = table("orders").length;
    await click(button(fresh, "Bestellung anlegen"), 1200); await until(() => table("orders").length === ordersBefore + 1);
    const created = table("orders").slice().sort((a, b) => Number(b.id) - Number(a.id))[0]; expect(table("deliveryChains").some((row) => row.orderId === created.id)).toBe(false);
    await until(() => fresh.querySelectorAll(".order-steps button").length === 2);
    await click(fresh.querySelectorAll<HTMLButtonElement>(".order-steps button")[1], 700);
    expect(fresh.querySelector(".lk-order-empty")!.textContent).toContain("Sie entsteht von selbst, sobald du die Bestellung speicherst");
    await click(button(fresh.querySelector(".lk-order-empty")!, "Bestellung speichern"), 1500); await until(() => cards(fresh).length > 0);
    const chain = table("deliveryChains").find((row) => row.orderId === created.id)!; expect(chain).toMatchObject({ status: "aktiv", categoryId: created.categoryId });
    expect(stopsOf(chain.id)).toMatchObject([{ orderStop: true, position: 1, buyerName: "Noch nicht gewählt" }]);
    expect(fresh.querySelector(".lk-adopt strong")!.textContent).toBe("In der Bestellung ist noch kein Käufer gewählt");
  }, 60000);

  it("Auslieferung: Passt ein Lead nicht ins Gebiet der Bestellung, überspringt er nur Station 1 – die nächste Station bekommt ihn, ohne dass er zur Bestellung zählt", async () => {
    const { chain, order } = aroundhome(); const config = table("orderOperationalConfigs").find((row) => row.orderId === order.id)!;
    config.advancedFilters = { minAgeDays: null, maxLeadPrice: null, postcodes: "Bayern" }; config.deliveryArea = "regional";
    const other = table("users").find((row) => row.company === "Aurora Home")!;
    await callProcedure("leadops.addChainStop", { chainId: chain.id, buyerUserId: other.id, unitPrice: 20, reclamationWindowHours: 0 });
    // zwei eigene Leads der Kategorie (Kopie eines Beispiel-Leads, damit alle Felder stimmen) – ohne Lieferungen, mit eigenen Kontaktdaten
    const base = table("leads").find((row) => row.categoryId === chain.categoryId)!; const firstId = Math.max(...table("leads").map((row) => Number(row.id))) + 1;
    const make = (offset: number, postcode: string, key: string) => { const lead: Row = { ...base, id: firstId + offset, publicId: `V376-${key.toUpperCase()}`, postcode, country: "DE", status: "genehmigt", email: `v376-${key}@example.de`, phone: `+49 30 55500${offset}${key.length}`, metadata: {}, supplierId: null, supplierName: null, assignedAt: null, createdAt: new Date() }; table("leads").push(lead); return lead; };
    const berlin = make(0, "10115", "berlin"); const deliveredBefore = Number(order.deliveredCount);
    const result = await callProcedure("leadops.deliverLead", { publicId: berlin.publicId, chainId: chain.id }) as { buyerName: string; orderId: number | null; attempts: Array<{ buyerName: string; outcome: string; orderId: number | null; reason?: string }> };
    expect(result.buyerName).toBe("Aurora Home"); expect(result.orderId).toBeNull();
    expect(result.attempts[0]).toMatchObject({ buyerName: "Aroundhome GmbH", outcome: "übersprungen", orderId: order.id, reason: "Bundesland außerhalb des Liefergebiets (Bayern)" });
    const rows = table("leadDeliveries").filter((row) => row.leadId === berlin.id).sort((a, b) => Number(a.id) - Number(b.id));
    expect(rows.map((row) => [row.buyerName, row.result === "übersprungen", row.orderId ?? null])).toEqual([["Aroundhome GmbH", true, order.id], ["Aurora Home", false, null]]);
    expect(Number(table("orders").find((row) => row.id === order.id)!.deliveredCount)).toBe(deliveredBefore);
    // München passt: Station 1 der Bestellung ist dran – diese Lieferung gehört zur Bestellung
    const munich = make(1, "80331", "muenchen");
    const second = await callProcedure("leadops.deliverLead", { publicId: munich.publicId, chainId: chain.id }) as { attempts: Array<{ buyerName: string; outcome: string; orderId: number | null }> };
    expect(second.attempts[0]).toMatchObject({ buyerName: "Aroundhome GmbH", orderId: order.id }); expect(second.attempts[0].outcome).not.toBe("übersprungen");
    // der Kunde der zweiten Station sieht in seinem Bereich nur seinen Lead
    expect(table("leadDeliveries").some((row) => row.leadId === munich.id && row.buyerName === "Aurora Home" && row.result !== "übersprungen")).toBe(false);
  }, 40000);

  it("Ältere Kette, die ihrer Bestellung noch nicht folgt: Hinweis – „Aus der Bestellung übernehmen“ setzt Station 1 davor (nach Rückfrage)", async () => {
    const chain = table("deliveryChains").find((row) => row.orderId && !stopsOf(row.id).some((stop) => stop.orderStop) && stopsOf(row.id).length > 0 && row.status === "aktiv")!; expect(chain).toBeTruthy();
    const order = table("orders").find((row) => row.id === chain.orderId)!; const before = stopsOf(chain.id).map((row) => row.id);
    const root = await open(`page=Lieferkette&chain=${chain.id}`); await until(() => cards(root).length > 0);
    expect(root.querySelector(".lk-adopt strong")!.textContent).toBe("Diese Kette folgt ihrer Bestellung noch nicht"); expect(root.querySelector(".lk-stop.is-order")).toBeNull();
    await click(button(root.querySelector(".lk-adopt")!, "Aus der Bestellung übernehmen"), 500);
    const dialog = document.querySelector(".app-confirm")!; expect(dialog.textContent).toContain(`${order.buyerName} wird Station 1 dieser Bestellung`);
    // abbrechen: nichts ändert sich
    await click(dialog.querySelector(".app-confirm-cancel"), 500); expect(stopsOf(chain.id).map((row) => row.id)).toEqual(before);
    await click(button(root.querySelector(".lk-adopt")!, "Aus der Bestellung übernehmen"), 500);
    await click(document.querySelector(".app-confirm-ok"), 1200); await until(() => root.querySelector(".lk-adopt") === null);
    const after = stopsOf(chain.id); expect(after).toHaveLength(before.length + 1);
    expect(after[0]).toMatchObject({ orderStop: true, position: 1, buyerName: order.buyerName, unitPrice: order.unitPrice }); expect(after.slice(1).map((row) => row.id)).toEqual(before);
    expect(root.querySelector(".lk-adopt")).toBeNull(); expect(cards(root)[0].classList.contains("is-order")).toBe(true);
  }, 50000);

  it("Benutzer: Kopf mit Name und Stand, Angaben als Leiste, Reiter mit Symbol – der gewählte Reiter steht auch in der Adresse", async () => {
    const root = await open("page=Benutzer&member=2"); await until(() => root.querySelector(".md-hero h1") !== null);
    expect(root.querySelector(".md-hero h1")!.textContent!.length).toBeGreaterThan(2); expect(root.querySelector(".md-state")!.textContent).toMatch(/Aktiv|Eingeladen|Inaktiv/);
    expect(Array.from(root.querySelectorAll(".md-rail dt")).map((node) => node.textContent)).toEqual(["Zahlungsart", "Guthaben", "Webhook", "Reklamationsfrist", "Registriert am"]);
    const tabs = () => Array.from(root.querySelectorAll<HTMLButtonElement>('.md-tabs [role="tab"]'));
    expect(tabs().map((node) => node.querySelector("span")!.textContent)).toEqual(["Stammdaten", "Passwort", "Bestellungen", "Lieferant", "Reklamation", "Zahlung", "Benachrichtigungen", "Aktivität", "Ansicht", "Integration"]);
    expect(tabs().every((node) => node.querySelector("svg") !== null)).toBe(true);
    expect(tabs().filter((node) => node.getAttribute("aria-selected") === "true").map((node) => node.textContent)).toEqual(["Stammdaten"]); expect(tabs()[0].classList.contains("is-on")).toBe(true);
    expect(root.querySelector(".md-tab-hint")!.textContent).toBe("Persönliche Daten, Adresse, Verhalten");
    await click(tabs()[9], 700);
    expect(tabs()[9].getAttribute("aria-selected")).toBe("true"); expect(tabs()[0].getAttribute("aria-selected")).toBe("false");
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("tools"); expect(root.querySelector(".md-tab-hint")!.textContent).toContain("Schnittstellen");
    // früherer Link „tab=integration“ (aus der Lieferkette) landet beim Reiter Integration
    cleanup(); const old = await open("page=Benutzer&member=2&tab=integration"); await until(() => old.querySelector(".md-tabs") !== null);
    expect(Array.from(old.querySelectorAll('.md-tabs [role="tab"]')).find((node) => node.getAttribute("aria-selected") === "true")!.textContent).toBe("Integration");
  }, 50000);
});
