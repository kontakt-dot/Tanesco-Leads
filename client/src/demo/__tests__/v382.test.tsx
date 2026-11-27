import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { getStore, resetStore } from "../backend";
import { SETTING_GROUPS, SETTING_INFO, SYSTEM_SWITCHES } from "../../../../shared/settings-view";

/**
 * Version 382 – Kooperationen, Einstellungen und Gespräche im Stil der neu gestalteten Seiten.
 * Kooperationen: Zahlen als Leiste, Reiter nach Stand, Suche, eine Zeile je Partner, die an Ort und Stelle aufklappt; anlegen, zuordnen,
 * aktivieren/pausieren, löschen. Einstellungen: Menü in Gruppen ohne die leeren Platzhalter, Passwort ändert wirklich, System in einfachen
 * Worten, Reklamationsgründe mit Reihenfolge. Gespräche: Werkzeuge in der Zeile „Agent“.
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
const submit = async (form: Element | null | undefined, wait = 900) => { expect(form).toBeTruthy(); await act(async () => { fireEvent.submit(form!); }); await settle(wait); };
const open = async (query: string, wait = 2400) => { window.history.replaceState(null, "", `/?${query}`); const view = providers(<DemoApp />); await settle(wait); return view.container; };
const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim());
const button = (root: ParentNode, text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((node) => (node.textContent ?? "").trim() === text);
type Row = Record<string, any>;
const table = (name: string) => (getStore().tables as unknown as Record<string, Row[]>)[name];
const said = (text: string) => (document.body.textContent ?? "").includes(text);
const confirmOk = async () => { await until(() => Boolean(document.querySelector(".app-confirm-ok"))); await click(document.querySelector(".app-confirm-ok"), 1200); };
const before = (first: Element, second: Element) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

// Kooperationen
const rail = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLElement>(".ko .tg-stat")).map((node) => [(node.querySelector("span")?.textContent ?? "").trim(), (node.querySelector("strong")?.textContent ?? "").trim(), (node.querySelector("small")?.textContent ?? "").trim()]);
const partners = (root: ParentNode) => texts(root, ".ko-item .ko-who b");
const item = (root: ParentNode, name: string) => Array.from(root.querySelectorAll<HTMLElement>(".ko-item")).find((node) => node.querySelector(".ko-who b")?.textContent === name)!;
const tab = (root: ParentNode, label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>(".ko-list .fx-tabs button")).find((node) => (node.textContent ?? "").startsWith(label))!;
const coop = (name: string) => table("cooperations").find((row) => row.partnerTenantName === name)!;
const categoryMaps = (id: number) => table("cooperationCategoryMappings").filter((row) => row.cooperationId === id);
const fieldMaps = (id: number) => table("cooperationFieldMappings").filter((row) => row.cooperationId === id);
const block = (root: ParentNode, label: string) => root.querySelector<HTMLElement>(`.ko-detail section[aria-label="${label}"]`)!;

describe("Version 382 – Kooperationen", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { vi.restoreAllMocks(); document.querySelectorAll(".app-confirm-backdrop").forEach((node) => node.remove()); cleanup(); resetStore(); });

  it("Übersicht: Zahlen als Leiste, Reiter nach Stand, eine Zeile je Partner nach Namen sortiert – und der Hinweis, dass die Seite nichts ausliefert", async () => {
    const root = await open("page=Kooperationen"); await until(() => root.querySelectorAll(".ko-item").length === 2);
    const page = root.querySelector(".fx-scope.tg.ko")!; expect(page).toBeTruthy(); expect(page.querySelector(".page-intro h1")!.textContent).toBe("Kooperationen"); expect(page.querySelector(".page-intro .eyebrow")!.textContent).toContain("ORGANISATION");
    expect(rail(root)).toEqual([["Partner", "2", "8 Zuordnungen hinterlegt"], ["Aktiv", "1", "die Zusammenarbeit läuft"], ["Angefragt", "1", "noch nicht bestätigt"], ["Pausiert", "0", "keine pausiert"]]);
    expect(Array.from(root.querySelectorAll(".ko .tg-stat")).map((node) => node.classList.contains("is-wait"))).toEqual([false, false, true, false]); // Farbe nur, wo noch etwas zu klären ist
    expect(texts(root, ".ko-list .fx-tabs button")).toEqual(["Alle2", "Aktiv1", "Angefragt1", "Pausiert0"]); expect(tab(root, "Alle").className).toContain("active");
    expect(partners(root)).toEqual(["EnergieHaus Nord", "Solarnetz Bayern"]);
    expect(texts(root, ".ko-item .ko-who small")).toEqual(["Der Partner liefert Leads an uns", "Leads gehen in beide Richtungen"]);
    expect(texts(root, ".ko-item .ko-sum")).toEqual(["noch nichts zugeordnet", "2 Kategorien · 6 Felder zugeordnet"]); expect(item(root, "EnergieHaus Nord").querySelector(".ko-sum")!.className).toContain("is-none");
    expect(texts(root, ".ko-item .ko-status .fx-pill")).toEqual(["Angefragt", "Aktiv"]); expect(item(root, "EnergieHaus Nord").querySelector(".fx-pill")!.className).toContain("is-warn"); expect(item(root, "Solarnetz Bayern").querySelector(".fx-pill")!.className).toContain("is-good");
    expect(root.querySelector(".ko-detail")).toBeNull(); // zu, bis man eine Zeile antippt
    expect(root.querySelector(".ko-good")!.textContent).toBe("Gut zu wissen: Ausgeliefert wird über die Lieferkette und die Integrationen. Die Angaben hier sind dein Nachschlagewerk für die Zusammenarbeit – an der Auslieferung ändern sie nichts.");
    expect(page.textContent ?? "").not.toMatch(/Mapping|Detail-Editor|Mandant|Tenant|\bIhre?n?\b|\bSie\b/); // einfache Worte, Du-Form
    expect(page.querySelector("table")).toBeNull(); // die alte Tabelle gibt es nicht mehr
  });

  it("Reiter und Suche grenzen die Liste ein; die Suche findet über Kategorien und Felder – bei uns und beim Partner", async () => {
    const root = await open("page=Kooperationen"); await until(() => root.querySelectorAll(".ko-item").length === 2);
    await click(tab(root, "Aktiv"), 300); expect(partners(root)).toEqual(["Solarnetz Bayern"]); expect(tab(root, "Aktiv").getAttribute("aria-selected")).toBe("true");
    await click(tab(root, "Angefragt"), 300); expect(partners(root)).toEqual(["EnergieHaus Nord"]);
    await click(tab(root, "Pausiert"), 300); expect(partners(root)).toEqual([]); expect(root.querySelector(".ko-list .rd-none p")!.textContent).toBe("Zu dieser Auswahl gibt es keinen Partner.");
    await click(button(root.querySelector(".ko-list")!, "Alle Partner zeigen"), 300); expect(partners(root)).toHaveLength(2); expect(tab(root, "Alle").className).toContain("active");
    const search = root.querySelector<HTMLInputElement>('.ko-list .fx-search input')!;
    await type(search, "zip"); expect(partners(root)).toEqual(["Solarnetz Bayern"]); expect(texts(root, ".ko-list .fx-tabs button")).toEqual(["Alle1", "Aktiv1", "Angefragt0", "Pausiert0"]); // die Reiter zählen, was die Suche übrig lässt
    expect(rail(root).map((entry) => entry[1])).toEqual(["2", "1", "1", "0"]); // die Leiste zählt immer alles
    await type(search, "photovoltaik"); expect(partners(root)).toEqual(["Solarnetz Bayern"]); // unser Name der Kategorie
    await type(search, "heizung"); expect(partners(root)).toEqual(["Solarnetz Bayern"]); // der Name beim Partner
    await type(search, "PLZ"); expect(partners(root)).toEqual(["Solarnetz Bayern"]); // lesbarer Name des Feldes
    await type(search, "liefert uns"); expect(partners(root)).toEqual(["EnergieHaus Nord"]); // Richtung in Worten
    await type(search, "gibtsnicht"); expect(partners(root)).toEqual([]); expect(root.querySelector(".ko-list .rd-none")).toBeTruthy();
    await click(root.querySelector('.ko-list .fx-search button[aria-label="Suche leeren"]'), 300); expect(search.value).toBe(""); expect(partners(root)).toHaveLength(2);
  });

  it("anlegen: Name wird geprüft, der neue Partner steht auf „Angefragt“ und klappt gleich auf", async () => {
    const root = await open("page=Kooperationen"); await until(() => root.querySelectorAll(".ko-item").length === 2);
    expect(root.querySelector(".ko-create")).toBeNull();
    await click(button(root.querySelector(".page-intro")!, "Kooperation anlegen"), 400); const form = () => root.querySelector<HTMLFormElement>("form.ko-create")!; expect(form()).toBeTruthy();
    expect(form().querySelector("h2")!.textContent).toBe("Kooperation anlegen"); expect(texts(form(), "select option")).toEqual(["Wir liefern Leads an den Partner", "Der Partner liefert Leads an uns", "Leads gehen in beide Richtungen"]);
    await submit(form(), 400); expect(form().querySelector(".ko-issue")!.textContent).toBe("Bitte den Namen des Partners eintragen (mindestens zwei Zeichen)."); expect(table("cooperations")).toHaveLength(2);
    await type(form().querySelector("input"), "solarnetz bayern "); await submit(form(), 400); expect(form().querySelector(".ko-issue")!.textContent).toBe("Einen Partner mit diesem Namen gibt es schon."); expect(table("cooperations")).toHaveLength(2);
    await type(form().querySelector("input"), "Wärme Süd GmbH"); expect(form().querySelector(".ko-issue")).toBeNull(); await type(form().querySelector("select"), "eingehend");
    await submit(form(), 1200); await until(() => root.querySelectorAll(".ko-item").length === 3);
    expect(root.querySelector(".ko-create")).toBeNull(); expect(said("Kooperation angelegt – sie steht auf „Angefragt“, bis du sie aktivierst.")).toBe(true);
    const made = coop("Wärme Süd GmbH"); expect(made.status).toBe("angefragt"); expect(made.direction).toBe("eingehend");
    expect(partners(root)).toEqual(["EnergieHaus Nord", "Solarnetz Bayern", "Wärme Süd GmbH"]);
    const opened = root.querySelectorAll(".ko-item.is-open"); expect(opened).toHaveLength(1); expect(opened[0].id).toBe(`ko-${made.id}`); expect(opened[0].querySelector(".ko-detail")).toBeTruthy();
    expect(rail(root).map((entry) => entry[1])).toEqual(["3", "1", "2", "0"]);
    // „Abbrechen“ und das Kreuz schließen das Formular, ohne etwas anzulegen
    await click(button(root.querySelector(".page-intro")!, "Kooperation anlegen"), 400); await type(form().querySelector("input"), "Nur ein Versuch"); await click(button(form(), "Abbrechen"), 300); expect(root.querySelector(".ko-create")).toBeNull(); expect(table("cooperations")).toHaveLength(3);
  });

  it("aufgeklappt: Kategorien und Felder zuordnen, ändern und entfernen", async () => {
    const root = await open("page=Kooperationen"); await until(() => root.querySelectorAll(".ko-item").length === 2);
    const id = coop("Solarnetz Bayern").id; await click(item(root, "Solarnetz Bayern").querySelector(".ko-row"), 500);
    expect(item(root, "Solarnetz Bayern").querySelector(".ko-row")!.getAttribute("aria-expanded")).toBe("true"); expect(texts(root, ".ko-detail .ko-block h3")).toEqual(["Angaben", "Kategorien 2", "Felder 6"]);
    const categories = block(root, "Kategorien beim Partner"); const fields = block(root, "Felder beim Partner");
    expect(texts(categories, ".ko-maps li b")).toEqual(["Solar Privat", "Heizung Wärmepumpe"]); expect(texts(categories, ".ko-maps .ko-from").map((text) => text.replace(/^\S+\s/, ""))).toEqual(["Photovoltaik", "Wärmepumpe"]);
    expect(texts(fields, ".ko-maps .ko-from")).toEqual(["Vorname", "Nachname", "E-Mail", "Telefon", "PLZ", "Ort"]); expect(texts(fields, ".ko-maps li b")).toEqual(["firstName", "lastName", "email", "phone", "zip", "city"]);
    // ohne Auswahl: Hinweis statt leerer Zuordnung
    await submit(categories.querySelector("form.ko-add"), 400); expect(said("Bitte eine Lead-Kategorie wählen.")).toBe(true); expect(categoryMaps(id)).toHaveLength(2);
    // neue Kategorie zuordnen
    const mapped = new Set(categoryMaps(id).map((row) => row.sourceCategoryId)); const offered = Array.from(categories.querySelector<HTMLSelectElement>("select")!.options).map((option) => Number(option.value)).filter(Boolean); expect(offered.length).toBeGreaterThan(2);
    const free = table("leadCategories").find((row) => offered.includes(row.id) && !mapped.has(row.id))!; expect(free).toBeTruthy();
    await type(categories.querySelector("select"), String(free.id)); expect(button(categories, "Zuordnen")).toBeTruthy(); await type(categories.querySelector('input[aria-label="Name der Kategorie beim Partner"]'), "Dach und Fassade");
    await submit(categories.querySelector("form.ko-add"), 1000); await until(() => categoryMaps(id).length === 3);
    expect(categoryMaps(id).find((row) => row.sourceCategoryId === free.id)!.partnerCategoryName).toBe("Dach und Fassade"); expect(texts(block(root, "Kategorien beim Partner"), ".ko-maps li b")).toContain("Dach und Fassade");
    expect(item(root, "Solarnetz Bayern").querySelector(".ko-sum")!.textContent).toBe("3 Kategorien · 6 Felder zugeordnet"); expect(block(root, "Kategorien beim Partner").querySelector<HTMLSelectElement>("select")!.value).toBe(""); // Felder sind wieder leer
    // schon zugeordnete Kategorie wählen: der Knopf heißt „Ändern“ und der Name wird ersetzt – keine zweite Zeile
    const pv = table("leadCategories").find((row) => row.name === "Photovoltaik")!;
    await type(block(root, "Kategorien beim Partner").querySelector("select"), String(pv.id)); expect(button(block(root, "Kategorien beim Partner"), "Ändern")).toBeTruthy(); expect(block(root, "Kategorien beim Partner").querySelector(".ko-hint")!.textContent).toBe("Schon zugeordnet als „Solar Privat“ – „Ändern“ ersetzt den Namen.");
    await type(block(root, "Kategorien beim Partner").querySelector('input[aria-label="Name der Kategorie beim Partner"]'), "Solar Eigenheim"); await submit(block(root, "Kategorien beim Partner").querySelector("form.ko-add"), 1000);
    await until(() => categoryMaps(id).some((row) => row.partnerCategoryName === "Solar Eigenheim")); expect(categoryMaps(id)).toHaveLength(3); expect(categoryMaps(id).find((row) => row.sourceCategoryId === pv.id)!.partnerCategoryName).toBe("Solar Eigenheim");
    // Zuordnung entfernen
    await click(block(root, "Kategorien beim Partner").querySelector('.ko-drop[aria-label="Zuordnung Wärmepumpe entfernen"]'), 900); await until(() => categoryMaps(id).length === 2);
    expect(texts(block(root, "Kategorien beim Partner"), ".ko-maps li b").sort()).toEqual(["Dach und Fassade", "Solar Eigenheim"]);
    // Felder: bekanntes Feld ändern, eigenes Feld anlegen, eines entfernen
    const fieldForm = () => block(root, "Felder beim Partner").querySelector<HTMLFormElement>("form.ko-add")!;
    expect(texts(fieldForm(), "select option")).toEqual(["Feld wählen", "Anrede", "Vorname", "Nachname", "Firma", "E-Mail", "Telefon", "Straße", "PLZ", "Ort", "Land", "Anderes Feld …"]);
    await submit(fieldForm(), 400); expect(said("Bitte ein Feld wählen.")).toBe(true);
    await type(fieldForm().querySelector("select"), "phone"); expect(button(fieldForm(), "Ändern")).toBeTruthy(); await submit(fieldForm(), 400); expect(said("Bitte eintragen, wie das Feld beim Partner heißt.")).toBe(true);
    await type(fieldForm().querySelector('input[aria-label="Name des Feldes beim Partner"]'), "telefon_mobil"); await submit(fieldForm(), 1000); await until(() => fieldMaps(id).some((row) => row.partnerField === "telefon_mobil"));
    expect(fieldMaps(id)).toHaveLength(6); expect(fieldMaps(id).find((row) => row.sourceField === "phone")!.partnerField).toBe("telefon_mobil");
    expect(fieldForm().className).not.toContain("is-own"); expect(fieldForm().querySelector('input[aria-label="Eigener Feldname"]')).toBeNull();
    await type(fieldForm().querySelector("select"), "__anderes__"); expect(fieldForm().className).toContain("is-own"); await type(fieldForm().querySelector('input[aria-label="Eigener Feldname"]'), "dachflaeche_m2"); await type(fieldForm().querySelector('input[aria-label="Name des Feldes beim Partner"]'), "roof_area");
    await submit(fieldForm(), 1000); await until(() => fieldMaps(id).length === 7); expect(fieldMaps(id).find((row) => row.sourceField === "dachflaeche_m2")!.partnerField).toBe("roof_area");
    expect(texts(block(root, "Felder beim Partner"), ".ko-maps .ko-from")).toContain("dachflaeche_m2"); // unbekannte Feldnamen stehen so da, wie sie eingetragen wurden
    await click(block(root, "Felder beim Partner").querySelector('.ko-drop[aria-label="Zuordnung Telefon entfernen"]'), 900); await until(() => fieldMaps(id).length === 6);
    expect(fieldMaps(id).some((row) => row.sourceField === "phone")).toBe(false); expect(item(root, "Solarnetz Bayern").querySelector(".ko-sum")!.textContent).toBe("2 Kategorien · 6 Felder zugeordnet");
    expect(rail(root)[0]).toEqual(["Partner", "2", "8 Zuordnungen hinterlegt"]);
  });

  it("aufgeklappt: Angaben speichern (mit Prüfung), pausieren und wieder aktivieren – die Zeile bleibt an ihrem Platz", async () => {
    const root = await open("page=Kooperationen"); await until(() => root.querySelectorAll(".ko-item").length === 2);
    await click(item(root, "Solarnetz Bayern").querySelector(".ko-row"), 500);
    const base = () => root.querySelector<HTMLFormElement>(".ko-detail form.ko-base")!; const save = () => button(base(), "Angaben speichern")!;
    expect(save().disabled).toBe(true); // nichts geändert
    await type(base().querySelector("select"), "ausgehend"); expect(save().disabled).toBe(false); await submit(base(), 1000); await until(() => coop("Solarnetz Bayern").direction === "ausgehend");
    expect(said("Angaben gespeichert.")).toBe(true); expect(item(root, "Solarnetz Bayern").querySelector(".ko-who small")!.textContent).toBe("Wir liefern Leads an den Partner"); expect(save().disabled).toBe(true);
    // Name, den es schon gibt: Hinweis, nichts gespeichert
    await type(base().querySelector("input"), "energiehaus nord"); await submit(base(), 500); expect(said("Einen Partner mit diesem Namen gibt es schon.")).toBe(true); expect(table("cooperations").filter((row) => /energiehaus nord/i.test(row.partnerTenantName))).toHaveLength(1);
    await type(base().querySelector("input"), "Solarnetz Bayern");
    // Nummer der Organisation des Partners: nur eine ganze Zahl
    const more = base().querySelector<HTMLDetailsElement>("details.ko-more")!; expect(more.querySelector("summary")!.textContent).toBe("Der Partner arbeitet auch mit Tanesco Leads"); expect(more.open).toBe(false);
    await type(more.querySelector("input"), "zwölf"); await submit(base(), 500); expect(said("Die Nummer des Partners muss eine ganze Zahl sein.")).toBe(true); expect(coop("Solarnetz Bayern").partnerTenantId ?? null).toBeNull();
    await type(more.querySelector("input"), "12"); await submit(base(), 1000); await until(() => coop("Solarnetz Bayern").partnerTenantId === 12); expect(coop("Solarnetz Bayern").partnerTenantId).toBe(12);
    // pausieren / wieder aktivieren
    const foot = () => root.querySelector<HTMLElement>(".ko-detail .ko-foot")!;
    expect(foot().querySelector("p")!.textContent).toBe("Die Zusammenarbeit läuft."); expect(button(foot(), "Pausieren")!.className).not.toContain("flux-button"); // ruhig: Pausieren ist nicht die Hauptsache
    await click(button(foot(), "Pausieren"), 1000); await until(() => coop("Solarnetz Bayern").status === "inaktiv"); expect(said("Kooperation pausiert.")).toBe(true);
    expect(item(root, "Solarnetz Bayern").querySelector(".fx-pill")!.textContent).toBe("Pausiert"); expect(item(root, "Solarnetz Bayern").querySelector(".fx-pill")!.className).toContain("is-mute"); expect(foot().querySelector("p")!.textContent).toBe("Ruht gerade – die Angaben bleiben erhalten.");
    expect(rail(root).map((entry) => entry[1])).toEqual(["2", "0", "1", "1"]); expect(partners(root)).toEqual(["EnergieHaus Nord", "Solarnetz Bayern"]); expect(item(root, "Solarnetz Bayern").className).toContain("is-open"); // bleibt offen und an ihrem Platz
    expect(button(foot(), "Wieder aktivieren")!.className).toContain("flux-button"); await click(button(foot(), "Wieder aktivieren"), 1000); await until(() => coop("Solarnetz Bayern").status === "aktiv"); expect(said("Kooperation ist wieder aktiv.")).toBe(true);
    // ein angefragter Partner wird aktiviert
    await click(item(root, "EnergieHaus Nord").querySelector(".ko-row"), 500); expect(root.querySelectorAll(".ko-item.is-open")).toHaveLength(1); expect(foot().querySelector("p")!.textContent).toBe("Angelegt, aber noch nicht bestätigt.");
    await click(button(foot(), "Aktivieren"), 1000); await until(() => coop("EnergieHaus Nord").status === "aktiv"); expect(said("Kooperation ist aktiv.")).toBe(true); expect(rail(root).map((entry) => entry[1])).toEqual(["2", "2", "0", "0"]);
    // noch einmal antippen klappt zu
    await click(item(root, "EnergieHaus Nord").querySelector(".ko-row"), 400); expect(root.querySelector(".ko-detail")).toBeNull();
  });

  it("löschen fragt nach, nennt die Zuordnungen, die mit verloren gehen – und räumt sie mit weg", async () => {
    const root = await open("page=Kooperationen"); await until(() => root.querySelectorAll(".ko-item").length === 2);
    await click(item(root, "EnergieHaus Nord").querySelector(".ko-row"), 500);
    await click(button(root.querySelector(".ko-detail .ko-foot")!, "Löschen"), 500); await until(() => Boolean(document.querySelector(".app-confirm-text")));
    expect(document.querySelector(".app-confirm-text")!.textContent).toBe("Kooperation „EnergieHaus Nord“ löschen? Das lässt sich nicht rückgängig machen."); expect(document.querySelector(".app-confirm-ok")!.textContent).toBe("Ja, löschen");
    await click(document.querySelector(".app-confirm-cancel"), 500); expect(table("cooperations")).toHaveLength(2);
    await click(button(root.querySelector(".ko-detail .ko-foot")!, "Löschen"), 500); await confirmOk(); await until(() => table("cooperations").length === 1);
    expect(said("Kooperation gelöscht.")).toBe(true); expect(partners(root)).toEqual(["Solarnetz Bayern"]); expect(root.querySelector(".ko-detail")).toBeNull();
    const id = coop("Solarnetz Bayern").id; expect(categoryMaps(id)).toHaveLength(2); expect(fieldMaps(id)).toHaveLength(6);
    await click(item(root, "Solarnetz Bayern").querySelector(".ko-row"), 500); await click(button(root.querySelector(".ko-detail .ko-foot")!, "Löschen"), 500); await until(() => Boolean(document.querySelector(".app-confirm-text")));
    expect(document.querySelector(".app-confirm-text")!.textContent).toBe("Kooperation „Solarnetz Bayern“ löschen? Die 8 Zuordnungen gehen mit verloren. Das lässt sich nicht rückgängig machen.");
    await confirmOk(); await until(() => table("cooperations").length === 0);
    expect(categoryMaps(id)).toHaveLength(0); expect(fieldMaps(id)).toHaveLength(0);
    // leere Seite: Einladung statt leerer Liste
    await until(() => Boolean(root.querySelector(".ko-list .rd-empty"))); expect(root.querySelector(".ko-list .rd-empty b")!.textContent).toBe("Noch kein Partner"); expect(button(root.querySelector(".ko-list .rd-empty")!, "Kooperation anlegen")).toBeTruthy();
    expect(rail(root)).toEqual([["Partner", "0", "noch keiner angelegt"], ["Aktiv", "0", "noch keine aktiv"], ["Angefragt", "0", "nichts offen"], ["Pausiert", "0", "keine pausiert"]]); expect(root.querySelector(".ko .tg-stat.is-wait")).toBeNull();
    await click(button(root.querySelector(".ko-list .rd-empty")!, "Kooperation anlegen"), 400); expect(root.querySelector("form.ko-create")).toBeTruthy();
  });

  it("Adresse mit Partner (?coop=…) öffnet ihn gleich", async () => {
    resetStore(); const id = coop("Solarnetz Bayern").id;
    const root = await open(`page=Kooperationen&coop=${id}`); await until(() => root.querySelectorAll(".ko-item").length === 2 && Boolean(root.querySelector(".ko-detail")));
    const opened = root.querySelectorAll(".ko-item.is-open"); expect(opened).toHaveLength(1); expect(opened[0].querySelector(".ko-who b")!.textContent).toBe("Solarnetz Bayern");
  });
});

// Einstellungen
const menu = (root: ParentNode) => texts(root, ".st-menu .settings-tab > span");
const activeTab = (root: ParentNode) => texts(root, ".st-menu .settings-tab.active > span");
const reasons = () => [...table("reclamationReasons")].sort((a, b) => a.sortOrder - b.sortOrder);
const reasonNames = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLInputElement>(".st-reason-rows .st-reason-name input")).map((node) => node.value);
const reasonRow = (root: ParentNode, name: string) => Array.from(root.querySelectorAll<HTMLElement>(".st-reason-rows li")).find((node) => node.querySelector<HTMLInputElement>(".st-reason-name input")?.value === name)!;

describe("Version 382 – Einstellungen", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { vi.restoreAllMocks(); cleanup(); resetStore(); });

  it("Menü in vier Gruppen, ohne die leeren Platzhalter; rechts eine Überschrift, eine Zeile dazu und Kästen mit eigener Überschrift", async () => {
    const root = await open("page=Einstellungen"); await until(() => root.querySelectorAll(".st-menu .settings-tab").length > 0);
    expect(texts(root, ".st-menu .st-group-label")).toEqual(SETTING_GROUPS.map((group) => group.label)); expect(menu(root)).toEqual(SETTING_GROUPS.flatMap((group) => [...group.items]));
    expect(Array.from(root.querySelectorAll(".st-menu .st-group")).map((group) => group.querySelectorAll(".settings-tab").length)).toEqual([2, 3, 2, 3]);
    for (const gone of ["E-Mail", "Domain", "Zahlung", "Abonnement", "Affiliate", "Ansicht"]) expect(menu(root), gone).not.toContain(gone);
    for (const node of Array.from(root.querySelectorAll(".st-menu .settings-tab"))) expect(node.querySelector("svg.settings-tab-icon"), node.textContent ?? "").toBeTruthy();
    // Profil ist der erste Bereich
    expect(activeTab(root)).toEqual(["Profil"]); expect(root.querySelector('.st-menu .settings-tab[aria-current="page"]')!.textContent).toBe("Profil");
    const panel = root.querySelector(".st-panel")!; expect(panel.querySelector(".st-panel-head h2")!.textContent).toBe("Profil"); expect(panel.querySelector(".st-panel-head p")!.textContent).toBe(SETTING_INFO.Profil);
    expect(texts(panel, ".st-card > h3.fx-h.is-sub")).toEqual(["Profilbild", "Darstellung", "Name und E-Mail-Adresse"]); expect(panel.querySelector(".eyebrow")).toBeNull(); // keine Schilder als Überschrift
    expect(panel.querySelector(".settings-avatar")!.textContent).toContain("Profilbild hochladen");
    expect(texts(panel, ".st-facts small")).toEqual(["Name", "E-Mail-Adresse"]); expect(panel.querySelector(".st-card:last-child .st-hint")!.textContent).toBe("Beides steht bei deinem Eintrag unter „Benutzer“ – dort im Reiter „Stammdaten“.");
    expect(panel.textContent ?? "").not.toMatch(/Mandant|Tenant/);
    // jeder schmale Bereich: Überschrift und Zeile wechseln mit
    for (const name of ["Passwort", "Branding", "System", "E-Mail-Versand"] as const) { await click(Array.from(root.querySelectorAll(".st-menu .settings-tab")).find((node) => node.querySelector("span")?.textContent === name), 900); expect(activeTab(root)).toEqual([name]); expect(root.querySelector(".st-panel-head h2")!.textContent).toBe(name); expect(root.querySelector(".st-panel-head p")!.textContent).toBe(SETTING_INFO[name]); expect(new URLSearchParams(window.location.search).get("setting")).toBe(name); }
    expect(texts(root, ".st-panel h3.fx-h.is-sub").slice(0, 3)).toEqual(["Anbieter und Zugang", "Testmail", "Zustellbarkeit auf einen Blick"]); expect(root.querySelector(".st-panel .eyebrow")).toBeNull();
    // „Benutzer öffnen“ führt zur Benutzerliste
    await click(Array.from(root.querySelectorAll(".st-menu .settings-tab")).find((node) => node.querySelector("span")?.textContent === "Profil"), 900); await click(button(root.querySelector(".st-facts")!, "Benutzer öffnen"), 1200);
    expect(new URLSearchParams(window.location.search).get("page")).toBe("Benutzer");
  });

  it("frühere Adressen führen weiter: „E-Mail“ und „Domain“ zum E-Mail-Versand, „Ansicht“ zum Profil, die alten Platzhalter zur Übersicht", async () => {
    for (const [old, target] of [["E-Mail", "E-Mail-Versand"], ["Domain", "E-Mail-Versand"], ["Ansicht", "Profil"], ["Zahlung", "Profil"], ["Abonnement", "Profil"], ["Affiliate", "Profil"]] as const) {
      const root = await open(`page=Einstellungen&setting=${encodeURIComponent(old)}`, 1800); await until(() => root.querySelectorAll(".st-menu .settings-tab").length > 0);
      expect(activeTab(root), old).toEqual([target]); expect(root.querySelector(".st-panel-head h2")!.textContent, old).toBe(target); expect(root.querySelector(".st")!.textContent ?? "", old).not.toMatch(/Stripe|Lead-Kontingent|Tenants werben|Zahlungseinstellungen|Passwortänderung geprüft/);
      cleanup();
    }
  });

  it("breite Bereiche stehen über die ganze Breite – mit der Leiste zurück und dem Wechsel in einen anderen Bereich (nach Gruppen)", async () => {
    const root = await open("page=Einstellungen&setting=Reklamationen"); await until(() => root.querySelectorAll(".st-reason-rows li").length > 0);
    expect(root.querySelector(".fx-scope.st.is-wide")).toBeTruthy(); expect(root.querySelector(".st-menu")).toBeNull();
    const bar = root.querySelector(".settings-backbar")!; expect(bar.querySelector(".settings-crumb strong")!.textContent).toBe("Reklamationen");
    expect(Array.from(bar.querySelectorAll("optgroup")).map((node) => node.getAttribute("label"))).toEqual(SETTING_GROUPS.map((group) => group.label)); expect(texts(bar, "option")).toEqual(SETTING_GROUPS.flatMap((group) => [...group.items]));
    expect(bar.querySelector<HTMLSelectElement>("select")!.value).toBe("Reklamationen");
    await type(bar.querySelector("select"), "System", 900); expect(root.querySelector(".st-panel-head h2")!.textContent).toBe("System"); expect(root.querySelector(".st-menu")).toBeTruthy();
    cleanup();
    for (const [name, heading] of [["Rechnung & Rechtliches", "Rechnung & Rechtliches"], ["Nutzungsbedingungen", "Nutzungsbedingungen"], ["API-Dokumentation", null], ["Integrationen", null]] as const) {
      const wide = await open(`page=Einstellungen&setting=${encodeURIComponent(name)}`, 2000); expect(wide.querySelector(".fx-scope.st.is-wide"), name).toBeTruthy(); expect(wide.querySelector(".settings-backbar .settings-crumb strong")!.textContent, name).toBe(name);
      if (heading) expect(texts(wide, ".st.is-wide .page-intro h1"), name).toContain(heading);
      await click(wide.querySelector(".settings-back"), 900); expect(wide.querySelector(".st-menu"), name).toBeTruthy(); expect(activeTab(wide), name).toEqual(["Profil"]); expect(new URLSearchParams(window.location.search).get("setting"), name).toBeNull();
      cleanup();
    }
  });

  it("Passwort: prüft die Eingaben und ändert das Passwort wirklich – danach sind die Felder leer", async () => {
    const root = await open("page=Einstellungen&setting=Passwort"); await until(() => Boolean(root.querySelector("form.st-password")));
    const form = () => root.querySelector<HTMLFormElement>("form.st-password")!; const fields = () => Array.from(form().querySelectorAll<HTMLInputElement>('input[type="password"]'));
    expect(texts(form(), ".rd-field > span")).toEqual(["Aktuelles Passwort", "Neues Passwort", "Neues Passwort wiederholen"]); expect(fields().map((node) => node.autocomplete)).toEqual(["current-password", "new-password", "new-password"]);
    expect(form().querySelector(".st-hint")!.textContent).toBe("Mindestens 10 Zeichen, mit Buchstaben und mindestens einer Ziffer."); expect(form().querySelector(".st-issue")).toBeNull(); // kein Vorwurf vor dem ersten Versuch
    const issue = () => form().querySelector(".st-issue")?.textContent ?? null;
    await submit(form(), 400); expect(issue()).toBe("Bitte das aktuelle Passwort eintragen.");
    await type(fields()[0], "AltesPasswort1"); await type(fields()[1], "kurz1"); await type(fields()[2], "kurz1"); expect(issue()).toBe("Das neue Passwort braucht mindestens 10 Zeichen.");
    await type(fields()[1], "nurbuchstaben"); await type(fields()[2], "nurbuchstaben"); expect(issue()).toBe("Das neue Passwort braucht Buchstaben und mindestens eine Ziffer.");
    await type(fields()[1], "NeuesPasswort2"); await type(fields()[2], "NeuesPasswort3"); expect(issue()).toBe("Die Wiederholung stimmt nicht mit dem neuen Passwort überein.");
    await type(fields()[1], "AltesPasswort1"); await type(fields()[2], "AltesPasswort1"); expect(issue()).toBe("Das neue Passwort ist dasselbe wie das aktuelle.");
    await submit(form(), 400); expect(said("Passwort geändert.")).toBe(false); // mit Fehler wird nichts abgeschickt
    await type(fields()[1], "NeuesPasswort2"); await type(fields()[2], "NeuesPasswort2"); expect(issue()).toBeNull();
    await submit(form(), 1200); await until(() => said("Passwort geändert."));
    expect(said("Passwort geändert.")).toBe(true); expect(said("Passwortänderung geprüft.")).toBe(false); expect(fields().map((node) => node.value)).toEqual(["", "", ""]); expect(form().querySelector(".st-issue")).toBeNull();
  });

  it("System: fünf Schalter in drei Gruppen in einfachen Worten; gespeichert wird erst mit dem Knopf", async () => {
    const root = await open("page=Einstellungen&setting=System"); await until(() => root.querySelectorAll(".st-switches li").length === 5);
    const panel = root.querySelector(".st-panel")!; const stored = () => table("tenantSettings")[0];
    expect(texts(panel, ".st-card > h3.fx-h.is-sub")).toEqual(["Auslieferung", "Doppelte Kontakte", "Ablehnungen"]); expect(texts(panel, ".st-switches li b")).toEqual(SYSTEM_SWITCHES.map((item) => item.title)); expect(texts(panel, ".st-switches li small")).toEqual(SYSTEM_SWITCHES.map((item) => item.text));
    expect(panel.textContent ?? "").not.toMatch(/FIFO|LIFO|Zeitzone|Währung|Dublettenschutz/);
    const toggle = (key: string) => panel.querySelector<HTMLButtonElement>(`#st-switch-${key}`)!; const on = (key: string) => toggle(key).getAttribute("aria-checked") === "true";
    const first = { ...stored() };
    expect({ fifo: on("fifo"), skipEmpty: on("skipEmpty"), duplicate: on("duplicate"), uploadUpdate: on("uploadUpdate"), preping: on("preping") }).toEqual({ fifo: first.distributionOrder !== "lifo", skipEmpty: Boolean(first.skipEmptyApiFields ?? false), duplicate: Boolean(first.outgoingDuplicateProtection ?? true), uploadUpdate: first.uploadDuplicateMode !== "ueberspringen", preping: Boolean(first.incomingPrePing ?? false) });
    const foot = () => panel.querySelector<HTMLElement>(".st-foot")!; const save = () => button(foot(), "Änderungen speichern")!;
    expect(foot().querySelector("span")!.textContent).toBe("Alles gespeichert."); expect(save().disabled).toBe(true);
    const fifoBefore = on("fifo"); const prepingBefore = on("preping"); const uploadBefore = on("uploadUpdate");
    await click(toggle("fifo"), 300); await click(toggle("preping"), 300); await click(toggle("uploadUpdate"), 300);
    expect(on("fifo")).toBe(!fifoBefore); expect(foot().querySelector("span")!.textContent).toBe("Es gibt ungespeicherte Änderungen."); expect(save().disabled).toBe(false);
    expect(stored().distributionOrder ?? first.distributionOrder).toBe(first.distributionOrder); expect(Boolean(stored().incomingPrePing ?? false)).toBe(prepingBefore); // noch nichts gespeichert
    await click(save(), 1200); await until(() => said("System wurde gespeichert."));
    expect(stored().distributionOrder).toBe(fifoBefore ? "lifo" : "fifo"); expect(stored().incomingPrePing).toBe(!prepingBefore); expect(stored().uploadDuplicateMode).toBe(uploadBefore ? "ueberspringen" : "aktualisieren");
    expect(stored().skipEmptyApiFields).toBe(Boolean(first.skipEmptyApiFields ?? false)); expect(stored().outgoingDuplicateProtection).toBe(Boolean(first.outgoingDuplicateProtection ?? true)); // die anderen bleiben, wie sie waren
    await until(() => foot().querySelector("span")!.textContent === "Alles gespeichert."); expect(save().disabled).toBe(true); expect(on("fifo")).toBe(!fifoBefore); expect(on("preping")).toBe(!prepingBefore);
    // zurückgestellt = nichts mehr zu speichern
    await click(toggle("skipEmpty"), 300); expect(save().disabled).toBe(false); await click(toggle("skipEmpty"), 300); expect(save().disabled).toBe(true); expect(foot().querySelector("span")!.textContent).toBe("Alles gespeichert.");
  });

  it("Reklamationsgründe: Reihenfolge, Name, „geht weiter“ und „zur Auswahl“ – jede Änderung wird sofort gespeichert", async () => {
    const root = await open("page=Einstellungen&setting=Reklamationen"); await until(() => root.querySelectorAll(".st-reason-rows li").length > 0);
    const page = root.querySelector(".fx-scope.tg.st-reasons")!; expect(page.querySelector(".page-intro h1")!.textContent).toBe("Reklamationsgründe"); expect(page.querySelector(".page-intro .eyebrow")!.textContent).toContain("EINSTELLUNGEN");
    const start = reasons().map((row) => ({ ...row })); expect(start.length).toBeGreaterThanOrEqual(3); // Abzug vom Anfang – die Zeilen im Speicher ändern sich gleich expect(reasonNames(root)).toEqual(start.map((row) => row.name));
    expect(texts(page, ".st-reason-head span")).toEqual(["Reihenfolge", "Grund", "Lead geht an die nächste Station", "Zur Auswahl"]);
    const count = () => page.querySelector(".tg-list-head p")!.textContent; expect(count()).toBe(`${start.filter((row) => row.active).length} von ${start.length} stehen zur Auswahl.`);
    for (const node of Array.from(page.querySelectorAll(".st-reason-rows li"))) expect(node.querySelectorAll('[role="switch"]')).toHaveLength(2); // der Schalter ohne Wirkung („Lieferant“) ist nicht mehr da
    expect(page.textContent ?? "").not.toMatch(/Lieferant|RECLAMATION|KATALOG|\bSie\b|\bIhre?n?\b/);
    expect(texts(page, ".st-reason-name small")[0]).toMatch(/^(Standard-Grund|Eigener Grund)/);
    // Reihenfolge: erster hat kein „nach oben“, letzter kein „nach unten“
    const rows = () => Array.from(page.querySelectorAll<HTMLElement>(".st-reason-rows li")); const arrows = (row: HTMLElement) => Array.from(row.querySelectorAll<HTMLButtonElement>(".st-reason-move button"));
    expect(arrows(rows()[0])[0].disabled).toBe(true); expect(arrows(rows()[0])[1].disabled).toBe(false); expect(arrows(rows()[rows().length - 1])[1].disabled).toBe(true);
    const second = start[1].name; await click(page.querySelector(`button[aria-label="${second} nach oben"]`), 1000); await until(() => reasonNames(root)[0] === second);
    expect(reasonNames(root).slice(0, 2)).toEqual([second, start[0].name]); expect(reasons().map((row) => row.name)).toEqual(reasonNames(root)); expect(reasons().map((row) => row.sortOrder)).toEqual(reasons().map((_, index) => index)); // lückenlos durchgezählt
    await click(page.querySelector(`button[aria-label="${second} nach unten"]`), 1000); await until(() => reasonNames(root)[0] === start[0].name); expect(reasonNames(root)).toEqual(start.map((row) => row.name));
    // „Zur Auswahl“ aus: Zeile wird ruhig, die Zahl oben stimmt
    const name = start[0].name; const switches = (row: HTMLElement) => Array.from(row.querySelectorAll<HTMLButtonElement>('[role="switch"]')); const stored = () => table("reclamationReasons").find((row) => row.id === start[0].id)!;
    expect(texts(reasonRow(root, name), ".st-reason-switch small")).toEqual([(start[0].forwardToNextStop ?? true) ? "geht weiter" : "endet hier", start[0].active ? "wählbar" : "ausgeblendet"]);
    await click(switches(reasonRow(root, name))[1], 1000); await until(() => stored().active === false); expect(reasonRow(root, name).className).toContain("is-off"); expect(texts(reasonRow(root, name), ".st-reason-switch small")[1]).toBe("ausgeblendet");
    expect(count()).toBe(`${start.filter((row) => row.active).length - 1} von ${start.length} stehen zur Auswahl.`);
    await click(switches(reasonRow(root, name))[0], 1000); await until(() => stored().forwardToNextStop === false); expect(texts(reasonRow(root, name), ".st-reason-switch small")[0]).toBe("endet hier"); expect(stored().forwardToSupplier ?? false).toBe(start[0].forwardToSupplier ?? false); // der alte Wert bleibt unberührt
    // umbenennen: beim Verlassen des Feldes; zu kurz = alter Name bleibt
    const field = () => reasonRow(root, stored().name).querySelector<HTMLInputElement>(".st-reason-name input")!;
    await act(async () => { const node = field(); fireEvent.change(node, { target: { value: "x" } }); fireEvent.blur(node); }); await settle(500); expect(stored().name).toBe(name); expect(reasonNames(root)[0]).toBe(name);
    await act(async () => { const node = field(); fireEvent.change(node, { target: { value: "Kontaktdaten stimmen nicht" } }); fireEvent.blur(node); }); await until(() => stored().name === "Kontaktdaten stimmen nicht"); expect(stored().name).toBe("Kontaktdaten stimmen nicht"); await until(() => reasonNames(root)[0] === "Kontaktdaten stimmen nicht");
    // neuer Grund: geprüft, kommt ans Ende
    const add = () => page.querySelector<HTMLFormElement>("form.st-reason-add")!;
    await type(add().querySelector("input"), "x"); await submit(add(), 400); expect(said("Bitte einen Grund eintragen (mindestens zwei Zeichen).")).toBe(true);
    await type(add().querySelector("input"), start[1].name.toUpperCase()); await submit(add(), 400); expect(said("Diesen Grund gibt es schon.")).toBe(true); expect(table("reclamationReasons")).toHaveLength(start.length);
    await type(add().querySelector("input"), "Falsche Telefonnummer"); await submit(add(), 1200); await until(() => table("reclamationReasons").length === start.length + 1);
    expect(said("Reklamationsgrund angelegt.")).toBe(true); const made = table("reclamationReasons").find((row) => row.name === "Falsche Telefonnummer")!; expect(made.active).toBe(true); expect(made.systemReason).toBe(false); expect(made.sortOrder).toBe(Math.max(...start.map((row) => row.sortOrder)) + 1);
    await until(() => reasonNames(root).length === start.length + 1); expect(reasonNames(root)[start.length]).toBe("Falsche Telefonnummer"); expect(add().querySelector<HTMLInputElement>("input")!.value).toBe("");
    expect(reasonRow(root, "Falsche Telefonnummer").querySelector(".st-reason-name small")!.textContent).toBe("Eigener Grund");
    expect(page.querySelector(".ko-good")!.textContent).toContain("unter „Wenn der Kunde reklamiert“");
  });
});

describe("Version 382 – Gespräche", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { vi.restoreAllMocks(); cleanup(); resetStore(); });

  it("die Werkzeuge stehen in der Zeile „Agent“ vor der Lead-Kategorie – nicht mehr als eigene Zeile unter den Kampagnen", async () => {
    const root = await open("page=Gespräche"); await until(() => root.querySelectorAll(".gq-call").length > 0 && root.querySelectorAll(".cq-campaign-row .dashboard-segments button").length > 1);
    expect(root.querySelector(".cq-campaign-row .gq-tools")).toBeNull(); expect(root.querySelectorAll(".gq-toolbar .gq-tools")).toHaveLength(1);
    const row = root.querySelector(".gq-agent-row")!; const tools = row.querySelector(".gq-tools")!; expect(tools).toBeTruthy();
    const labels = texts(tools, ".cq-tool"); expect(labels).toHaveLength(3); expect(labels[0]).toMatch(/^KI heute/); expect(labels.slice(1)).toEqual(["Einstellen", "Aufnahmen testen"]);
    expect(before(row.querySelector(".gq-agents")!, tools)).toBe(true); expect(before(tools, row.querySelector(".gq-category")!)).toBe(true);
    const select = row.querySelector<HTMLSelectElement>(".gq-category select")!; expect(select.className).toBe("filter-select"); expect(select.options[0].textContent).toBe("Alle Kategorien"); // gleiche Größe wie die übrigen Felder (Stil-Block)
    // „Einstellen“ öffnet weiter das Fenster der Kampagne
    await click(Array.from(tools.querySelectorAll<HTMLButtonElement>(".cq-tool")).find((node) => /Einstellen/.test(node.textContent ?? "")), 900); expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });
});
