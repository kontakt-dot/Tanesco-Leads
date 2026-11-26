import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";

/**
 * Version 348 – API-Fehler und feste Lieferketten:
 *  Menüpunkt „API-Fehler“ (Zahl der offenen Probleme, Kacheln, API-Gesundheit, Grund je Lead in einfachen Worten), Lead von Hand
 *  korrigieren und noch einmal ausliefern, erneut ausliefern und abhaken; Lieferkette ohne Round Robin: feste Regel
 *  „Kategorie · Lieferanten · Kunden“, feste Reihenfolge der Ketten.
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const click = async (node: Element | null | undefined, wait = 500) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const type = async (node: Element | null | undefined, value: string, wait = 200) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.change(node!, { target: { value } }); }); await settle(wait); };
const open = async (query: string, wait = 1500) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
const until = async (check: () => boolean, max = 20_000) => { const start = Date.now(); while (!check() && Date.now() - start < max) await settle(250); };
const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((node) => (node.textContent ?? "").trim());
const button = (scope: ParentNode, label: string) => Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((node) => (node.textContent ?? "").trim() === label);
const rowOf = (root: ParentNode, name: string) => Array.from(root.querySelectorAll<HTMLElement>(".af-row")).find((row) => row.querySelector(".af-name")?.textContent === name);
const names = (root: ParentNode) => texts(root, ".af-row .af-name");

type Problem = { publicId: string; name: string; kind: string; title: string; fix: string; field: string | null; attempts: number; target: string | null; parts: Array<{ who: string; why: string }> };
type Health = { key: string; name: string; state: string; stateText: string; sent: number; failed: number; refused: number };
type Overview = { counts: { open: number; daten: number; empfaenger: number; keinAbnehmer: number; schnittstellenGestoert: number }; problems: Problem[]; resolved: Array<{ publicId: string; name: string; title: string; buyerName: string | null }>; health: Health[] };
type Row = Record<string, any>;
const overviewNow = async () => await callProcedure("leadops.apiErrorOverview", { days: 30 }) as Overview;
const table = (name: string) => (getStore().tables as unknown as Record<string, Row[]>)[name];
const leadBy = (publicId: string) => table("leads").find((row) => row.publicId === publicId)!;
/** Vermerke im Lead-Log, die ältesten zuerst. */
const notesOf = (publicId: string) => table("leadStatusEvents").filter((row) => row.leadId === leadBy(publicId).id).sort((a, b) => a.id - b.id).map((row) => String(row.note ?? ""));

describe("Version 348", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetStore(); });

  it("API-Fehler: Menüpunkt mit Zahl, Kacheln, API-Gesundheit und je Lead der Grund in einfachen Worten; Kachel und Suche filtern; alle Arten zum Nachschlagen", async () => {
    const data = await overviewNow(); const byName = new Map(data.problems.map((problem) => [problem.name, problem]));
    // jede Art von Problem einmal – so, wie sie auf der Seite erklärt wird
    expect(byName.get("Peter Hansen")).toMatchObject({ kind: "daten", fix: "lead", field: "email", attempts: 2, target: "Nordlicht Energie", title: "Der Empfänger lehnt die Angabe „E-Mail-Adresse“ ab." });
    expect(byName.get("Monika Seidel")).toMatchObject({ kind: "zugang", fix: "schnittstelle", attempts: 3, title: "Der Empfänger lässt uns nicht hinein." });
    expect(byName.get("Rainer Vogt")).toMatchObject({ kind: "stoerung", fix: "warten", title: "Beim Empfänger gibt es gerade eine Störung." });
    expect(byName.get("Karin Wolff")).toMatchObject({ kind: "zeit", fix: "warten", title: "Der Empfänger hat nicht rechtzeitig geantwortet." });
    expect(byName.get("Ilse Brenner")).toMatchObject({ kind: "daten", fix: "lead", field: "phone", attempts: 0, title: "Die Rufnummer ist nicht brauchbar." }); // fällt schon vor dem Ausliefern auf
    expect(byName.get("Sophie Arndt")).toMatchObject({ kind: "kein_abnehmer", fix: "lieferkette", parts: [{ who: "Nordlicht Energie", why: "Die PLZ liegt nicht in seinem Gebiet" }, { who: "Aurora Home", why: "Seine Höchstzahl an Leads ist erreicht" }] });
    expect(byName.get("Dieter Kraus")).toMatchObject({ kind: "einrichtung", fix: "lieferkette", title: "Für diese Kategorie gibt es keine aktive Lieferkette." });
    expect(byName.has("Tim Lorenz")).toBe(false); expect(data.resolved.find((row) => row.name === "Tim Lorenz")).toMatchObject({ buyerName: "Nordlicht Energie", title: "Der Empfänger hat nicht rechtzeitig geantwortet." }); // erst keine Antwort, später angekommen
    expect(data.counts.open).toBe(data.problems.length); expect(data.counts.daten + data.counts.empfaenger + data.counts.keinAbnehmer).toBe(data.counts.open);
    // Zwei Leads wurden wegen ihrer Angaben abgelehnt – die Schnittstelle selbst läuft
    expect(data.health.find((row) => row.name === "Nordlicht Energie")).toMatchObject({ state: "gut", refused: 2, stateText: "Läuft – einzelne Übergaben fehlgeschlagen" });

    const root = await open("page=API-Fehler", 2500); await until(() => root.querySelectorAll(".af-row").length > 0);
    expect(root.querySelector("h1")!.textContent).toBe("API-Fehler");
    // Menü: unter ANALYSE direkt nach „Gebietskarte“ (seit v365, vorher unter LEAD-OPERATIONS), mit der Zahl der offenen Probleme
    const group = Array.from(root.querySelectorAll(".nav-group")).find((node) => node.querySelector(".nav-group-label")?.textContent === "ANALYSE")!; const items = texts(group, ".nav-item > span");
    expect(items.slice(0, 2)).toEqual(["Dashboard", "Gebietskarte"]); expect(items.indexOf("API-Fehler")).toBe(2);
    const operations = Array.from(root.querySelectorAll(".nav-group")).find((node) => node.querySelector(".nav-group-label")?.textContent === "LEAD-OPERATIONS")!; expect(texts(operations, ".nav-item > span")).not.toContain("API-Fehler");
    expect(root.querySelector(".page-intro .eyebrow")!.textContent).toBe("ANALYSE");
    const entry = Array.from(group.querySelectorAll<HTMLElement>(".nav-item")).find((node) => node.querySelector("span")?.textContent === "API-Fehler")!;
    expect(entry.className).toContain("active"); await until(() => Boolean(entry.querySelector(".nav-badge"))); expect(entry.querySelector(".nav-badge")!.textContent).toBe(String(data.counts.open)); expect(entry.querySelector(".nav-badge")!.getAttribute("aria-label")).toBe(`${data.counts.open} offene Probleme`);
    // Kacheln
    expect(texts(root, ".af-tile strong")).toEqual([data.counts.open, data.counts.daten, data.counts.empfaenger, data.counts.keinAbnehmer].map(String)); expect(texts(root, ".af-tile span")).toEqual(["Offene Probleme", "Angaben fehlen oder falsch", "Beim Empfänger gescheitert", "Kein Abnehmer"]);
    // API-Gesundheit: jede Schnittstelle mit Zustand; Absagen wegen der Angaben stehen getrennt von echten Fehlern
    const apis = Array.from(root.querySelectorAll<HTMLElement>(".af-api")); expect(apis.map((node) => node.querySelector("strong")!.textContent)).toEqual(data.health.map((row) => row.name));
    data.health.forEach((row, index) => expect(apis[index].className).toContain(`is-${row.state}`));
    const nordlicht = data.health.find((row) => row.name === "Nordlicht Energie")!; const card = apis[data.health.indexOf(nordlicht)];
    expect(card.querySelector(".af-api-state")!.textContent).toBe("Läuft"); expect(card.querySelector(".af-api-text")!.textContent).toBe(`Läuft – einzelne Übergaben fehlgeschlagen · ${nordlicht.sent} Übergaben: ${nordlicht.sent - nordlicht.failed} angekommen, 2 abgelehnt, ${nordlicht.failed - 2} fehlgeschlagen`);
    expect(card.querySelector("a.af-link")!.textContent).toContain("Schnittstelle des Käufers öffnen"); expect(button(root, "Jetzt prüfen")).toBeTruthy();
    // Liste: neuester Fehler oben; Grund, Empfänger, Antwort, die falsche Angabe und die Zahl der Versuche
    expect(names(root)).toEqual(data.problems.map((problem) => problem.name));
    const hansen = rowOf(root, "Peter Hansen")!;
    expect(hansen.querySelector(".af-kind")!.textContent).toBe("Angaben falsch"); expect(hansen.querySelector(".af-title")!.textContent).toBe("Der Empfänger lehnt die Angabe „E-Mail-Adresse“ ab. Empfänger: Nordlicht Energie · Antwort 422");
    expect(hansen.querySelector(".af-meta")!.textContent).toBe("Photovoltaik · Freigegeben · von Orbit Media"); expect(hansen.querySelector(".af-when")!.textContent).toContain("2 Versuche");
    expect(hansen.querySelector(".af-data code")!.textContent).toBe("peter.hansen@.de"); expect(hansen.querySelector(".af-data b")!.textContent).toBe("E-Mail-Adresse");
    expect(texts(rowOf(root, "Sophie Arndt")!, ".af-parts li")).toEqual(["Nordlicht EnergieDie PLZ liegt nicht in seinem Gebiet", "Aurora HomeSeine Höchstzahl an Leads ist erreicht"]);
    expect(rowOf(root, "Monika Seidel")!.querySelector("a.af-button")!.textContent).toContain("Schnittstelle prüfen"); expect(rowOf(root, "Dieter Kraus")!.querySelector("a.af-button")!.textContent).toContain("Lieferkette öffnen"); // der erste Knopf führt dorthin, wo sich das Problem lösen lässt
    // Antwort des Empfängers und Verlauf aufklappen
    await click(button(hansen, "Antwort und Verlauf"), 200); expect(hansen.querySelector(".af-detail pre")!.textContent).toBe('{"errors":{"email":["is invalid"]}}'); expect(hansen.querySelectorAll(".af-detail ol > li").length).toBe(3); // zwei Antworten, ein Vermerk „ohne Abnehmer“
    // Kachel filtert, noch ein Klick zeigt wieder alle; die Suche findet Name und Ort
    const tile = (label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>(".af-tile")).find((node) => node.querySelector("span")?.textContent === label)!;
    await click(tile("Angaben fehlen oder falsch"), 300); expect(names(root)).toEqual(data.problems.filter((problem) => problem.kind === "daten").map((problem) => problem.name)); expect(tile("Angaben fehlen oder falsch").getAttribute("aria-pressed")).toBe("true");
    await click(tile("Kein Abnehmer"), 300); expect(names(root)).toEqual(data.problems.filter((problem) => ["kein_abnehmer", "einrichtung"].includes(problem.kind)).map((problem) => problem.name));
    await click(tile("Kein Abnehmer"), 300); expect(names(root)).toHaveLength(data.problems.length);
    await type(root.querySelector('input[aria-label="Probleme durchsuchen"]'), "hansen kiel", 300); expect(names(root)).toEqual(["Peter Hansen"]);
    await type(root.querySelector('input[aria-label="Probleme durchsuchen"]'), "gibtesnichtxyz", 300); expect(names(root)).toEqual([]); expect(root.querySelector(".af-clear strong")!.textContent).toBe("Kein Problem passt zu dieser Auswahl.");
    await click(button(root.querySelector(".af-clear")!, "Alle anzeigen"), 300); expect(names(root)).toHaveLength(data.problems.length);
    // Nachschlagen: jede Art von Fehler mit Erklärung
    await click(button(root, "Welche Fehler gibt es?"), 300); const guide = root.querySelector('[role="dialog"][aria-label="Welche Fehler gibt es?"]')!;
    expect(texts(guide, ".af-kind")).toEqual(["Angaben falsch", "Abgelehnt", "Schon bekannt", "Zugang", "Adresse falsch", "Zu viele Anfragen", "Störung beim Empfänger", "Keine Antwort", "Keine Verbindung", "Nicht eingerichtet", "Kein Abnehmer"]);
    await click(guide.querySelector('button[aria-label="Schließen"]'), 200); expect(root.querySelector('[role="dialog"][aria-label="Welche Fehler gibt es?"]')).toBeNull();
  }, 60_000);

  it("Lead korrigieren und noch einmal ausliefern: Die falsche E-Mail-Adresse wird beim Tippen gemeldet, ein Tippfehler bekommt einen Vorschlag – danach nimmt der Empfänger den Lead", async () => {
    const before = await overviewNow(); const publicId = before.problems.find((problem) => problem.name === "Peter Hansen")!.publicId;
    const root = await open("page=API-Fehler", 2500); await until(() => Boolean(rowOf(root, "Peter Hansen")));
    await click(button(rowOf(root, "Peter Hansen")!, "Korrigieren"), 300);
    const form = () => root.querySelector<HTMLFormElement>("form.af-edit")!; const input = (key: string) => form().querySelector<HTMLInputElement>(`.af-field.is-${key} input`)!; const alertOf = (key: string) => form().querySelector(`.af-field.is-${key} [role="alert"]`)?.textContent ?? null;
    const save = () => button(form(), "Speichern und ausliefern")!;
    expect(form().getAttribute("aria-label")).toBe("Peter Hansen korrigieren"); expect(texts(form(), ".af-field > span")).toEqual(["Anrede", "Vorname", "Nachname", "Rufnummer", "E-Mail-Adresse", "Straße", "PLZ", "Ort"]); // seit v371 mit Anrede (Wattfox braucht sie bei PV)
    expect([input("firstName").value, input("email").value, input("street").value, input("postcode").value]).toEqual(["Peter", "peter.hansen@.de", "Hafenstraße 8", "24103"]);
    // die falsche Adresse ist markiert und erklärt; speichern geht erst, wenn sie stimmt
    expect(input("email").getAttribute("aria-invalid")).toBe("true"); expect(alertOf("email")).toBeTruthy(); expect(save().disabled).toBe(true); expect(button(form(), "Nur speichern")!.disabled).toBe(true);
    expect(form().querySelector(".af-edit-foot [role=\"alert\"]")!.textContent).toBe("Bitte zuerst die markierten Angaben berichtigen.");
    // auch andere Angaben werden beim Tippen geprüft
    await type(input("phone"), "0151 12"); expect(alertOf("phone")).toBeTruthy(); await type(input("phone"), "+4915112340081"); expect(alertOf("phone")).toBeNull();
    await type(input("postcode"), "2410"); expect(alertOf("postcode")).toBe("Eine deutsche PLZ hat 5 Ziffern."); await type(input("postcode"), "24103"); expect(alertOf("postcode")).toBeNull();
    // Tippfehler in der Endung → Vorschlag, ein Klick übernimmt ihn
    await type(input("email"), "peter.hansen@gmail,com"); expect(save().disabled).toBe(true);
    const suggestion = form().querySelector<HTMLButtonElement>(".af-suggest")!; expect(suggestion.textContent).toBe("Meintest du peter.hansen@gmail.com? Übernehmen");
    await click(suggestion, 200); expect(input("email").value).toBe("peter.hansen@gmail.com"); expect(input("email").getAttribute("aria-invalid")).toBe("false"); expect(alertOf("email")).toBeNull(); expect(save().disabled).toBe(false);
    await click(save(), 1200); await until(() => Boolean(root.querySelector(".af-results")));
    // Ergebnis steht über der Liste, der Lead ist raus und steht unter „Zuletzt gelöst“; die Zahl am Menüpunkt sinkt
    expect(texts(root, ".af-results li")).toEqual(["AusgeliefertPeter HansenAn Nordlicht Energie übergeben (Antwort 200)."]); expect(root.querySelector(".af-results li")!.className).toBe("is-ok");
    await until(() => !rowOf(root, "Peter Hansen")); expect(rowOf(root, "Peter Hansen")).toBeUndefined(); expect(root.querySelector("form.af-edit")).toBeNull();
    expect(leadBy(publicId)).toMatchObject({ email: "peter.hansen@gmail.com", status: "zugewiesen", firstName: "Peter" });
    const notes = notesOf(publicId); const corrected = notes.indexOf("Von Hand korrigiert: E-Mail-Adresse: „peter.hansen@.de“ → „peter.hansen@gmail.com“"); expect(corrected).toBeGreaterThan(0); expect(notes.slice(corrected).some((note) => note.startsWith("Auslieferung an Nordlicht Energie"))).toBe(true);
    const after = await overviewNow(); expect(after.counts.open).toBe(before.counts.open - 1); expect(after.counts.daten).toBe(before.counts.daten - 1);
    expect(after.resolved[0]).toMatchObject({ name: "Peter Hansen", buyerName: "Nordlicht Energie", title: "Der Empfänger lehnt die Angabe „E-Mail-Adresse“ ab." });
    await until(() => root.querySelector(".nav-badge")?.textContent === String(after.counts.open)); expect(root.querySelector(".nav-badge")!.textContent).toBe(String(after.counts.open));
    expect(texts(root, ".af-resolved li a")[0]).toBe("Peter Hansen"); expect(root.querySelector(".af-resolved summary span")!.textContent).toBe(String(after.resolved.length));
    // die Schnittstelle hat eine Übergabe mehr, die angekommen ist
    const was = before.health.find((row) => row.name === "Nordlicht Energie")!; expect(after.health.find((row) => row.name === "Nordlicht Energie")).toMatchObject({ sent: was.sent + 1, failed: was.failed, refused: 2, state: "gut" });
  }, 60_000);

  it("Felder der Kategorie korrigieren und nur speichern: Die Änderung steht mit altem und neuem Wert im Lead-Log; stimmt danach alles, ist der Eintrag weg", async () => {
    const before = await overviewNow(); const publicId = before.problems.find((problem) => problem.name === "Ilse Brenner")!.publicId; const sentBefore = table("integrationEvents").length;
    const root = await open("page=API-Fehler", 2500); await until(() => Boolean(rowOf(root, "Ilse Brenner")));
    const row = rowOf(root, "Ilse Brenner")!; expect(row.querySelector(".af-title")!.textContent).toBe("Die Rufnummer ist nicht brauchbar."); expect(row.querySelector(".af-data code")!.textContent).toBe("0151 12");
    await click(button(row, "Korrigieren"), 300); const form = () => root.querySelector<HTMLFormElement>("form.af-edit")!; const input = (key: string) => form().querySelector<HTMLInputElement>(`.af-field.is-${key} input`)!;
    expect(input("phone").getAttribute("aria-invalid")).toBe("true"); expect(form().querySelector(".af-field.is-phone")!.className).toContain("is-wrong");
    await click(button(form(), "Felder der Kategorie „Photovoltaik“ bearbeiten"), 600); await until(() => form().querySelectorAll(".af-more + .af-edit-grid select").length > 0);
    const select = form().querySelector<HTMLSelectElement>(".af-more + .af-edit-grid select")!; /* das erste Auswahlfeld oben ist seit v371 die Anrede */ const label = select.closest("label")!.querySelector("span")!.textContent!; const option = Array.from(select.options).map((item) => item.value).find((value) => value)!;
    await type(select, option); await type(input("phone"), "+49 151 23480055"); await type(input("city"), "Leipzig-Süd");
    expect(button(form(), "Nur speichern")!.disabled).toBe(false); await click(button(form(), "Nur speichern"), 1000);
    await until(() => !rowOf(root, "Ilse Brenner")); expect(rowOf(root, "Ilse Brenner")).toBeUndefined(); expect(root.querySelector(".af-results")).toBeNull(); // nur gespeichert – kein Versuch, kein Ergebnis
    const lead = leadBy(publicId); expect(lead).toMatchObject({ phone: "+49 151 23480055", city: "Leipzig-Süd", status: "neu" }); expect(Object.values(lead.metadata as Record<string, unknown>)).toContain(option);
    expect(notesOf(publicId)).toContain(`Von Hand korrigiert: Rufnummer: „0151 12“ → „+49 151 23480055“ · Ort: „Leipzig“ → „Leipzig-Süd“ · ${label}: leer → „${option}“`);
    expect(table("integrationEvents").length).toBe(sentBefore); // es ging nichts raus
    const after = await overviewNow(); expect(after.problems.some((problem) => problem.publicId === publicId)).toBe(false); expect(after.resolved.some((item) => item.publicId === publicId)).toBe(false); // nie gescheitert → auch nicht „gelöst“
  }, 60_000);

  it("Erneut ausliefern zeigt das Ergebnis über der Liste; Abhaken nimmt Einträge heraus – scheitert der Lead wieder, steht er wieder da", async () => {
    const before = await overviewNow(); const idOf = (name: string) => before.problems.find((problem) => problem.name === name)!.publicId;
    let root = await open("page=API-Fehler", 2500); await until(() => Boolean(rowOf(root, "Dieter Kraus")));
    // Für „Fenster“ gibt es keine aktive Lieferkette – ein neuer Versuch scheitert mit demselben Grund und steht als Ergebnis da
    await click(button(rowOf(root, "Dieter Kraus")!, "Erneut ausliefern"), 1000); await until(() => Boolean(root.querySelector(".af-results")));
    expect(root.querySelector(".af-results li")!.className).toBe("is-bad"); expect(texts(root, ".af-results li")).toEqual([expect.stringMatching(/^Nicht ausgeliefertDieter KrausKeine aktive Lieferkette/)]);
    await until(() => (rowOf(root, "Dieter Kraus")?.querySelector(".af-when")?.textContent ?? "").includes("2 Versuche")); expect(rowOf(root, "Dieter Kraus")!.querySelector(".af-when")!.textContent).toContain("2 Versuche");
    await click(root.querySelector('.af-results button[aria-label="Ergebnis schließen"]'), 200); expect(root.querySelector(".af-results")).toBeNull();
    // mehrere auswählen und zusammen abhaken
    for (const name of ["Karin Wolff", "Rainer Vogt"]) await click(rowOf(root, name)!.querySelector('input[type="checkbox"]'), 150);
    expect(root.querySelector(".af-bulk label")!.textContent).toContain("2 ausgewählt"); expect(rowOf(root, "Karin Wolff")!.className).toContain("is-selected");
    await click(button(root.querySelector(".af-bulk")!, "Als erledigt abhaken"), 1000); await until(() => !rowOf(root, "Karin Wolff") && !rowOf(root, "Rainer Vogt"));
    expect(names(root)).not.toEqual(expect.arrayContaining(["Karin Wolff", "Rainer Vogt"])); expect(names(root)).toHaveLength(before.problems.length - 2);
    for (const name of ["Karin Wolff", "Rainer Vogt"]) { expect(typeof (leadBy(idOf(name)).metadata as Row).apiErrorsDismissedAt).toBe("string"); expect(notesOf(idOf(name))).toContain("API-Fehler als erledigt abgehakt"); }
    // einzeln abhaken („Erledigt“) – der Lead selbst bleibt, wie er ist
    await click(button(rowOf(root, "Dieter Kraus")!, "Erledigt"), 1000); await until(() => !rowOf(root, "Dieter Kraus")); expect(rowOf(root, "Dieter Kraus")).toBeUndefined(); expect(leadBy(idOf("Dieter Kraus")).status).toBe("genehmigt");
    expect((await overviewNow()).counts.open).toBe(before.counts.open - 3);
    // scheitert derselbe Lead noch einmal, steht er wieder da – gezählt wird nur der neue Versuch
    await settle(20); const again = await callProcedure("leadops.retryLeadDeliveries", { publicIds: [idOf("Dieter Kraus")] }) as { delivered: number; failed: number }; expect(again).toMatchObject({ delivered: 0, failed: 1 });
    cleanup(); root = await open("page=API-Fehler", 2500); await until(() => root.querySelectorAll(".af-row").length > 0);
    const back = rowOf(root, "Dieter Kraus")!; expect(back).toBeTruthy(); expect(back.querySelector(".af-title")!.textContent).toBe("Für diese Kategorie gibt es keine aktive Lieferkette."); expect(back.querySelector(".af-when")!.textContent).not.toContain("Versuche");
    expect(rowOf(root, "Karin Wolff")).toBeUndefined();
    // „Jetzt prüfen“ fragt jede Schnittstelle, ob sie erreichbar ist (es geht kein Lead raus) – das Ergebnis steht als „Letzte Probe“ dabei
    const cardOf = (name: string) => Array.from(root.querySelectorAll<HTMLElement>(".af-api")).find((node) => node.querySelector("strong")!.textContent === name)!; const facts = (name: string) => texts(cardOf(name), ".af-api-facts dt");
    expect(facts("Nordlicht Energie")).toEqual(["Zuletzt angekommen", "Letzter Fehler"]); const eventsBefore = table("integrationEvents").filter((row) => row.leadId).length;
    await click(button(root, "Jetzt prüfen"), 1200); await until(() => facts("Nordlicht Energie").includes("Letzte Probe"));
    expect(facts("Nordlicht Energie")).toEqual(["Zuletzt angekommen", "Letzter Fehler", "Letzte Probe"]); expect(cardOf("Nordlicht Energie").querySelector(".af-api-facts div:last-child dd")!.textContent).toBe("gerade eben – erreichbar");
    expect(table("integrationEvents").filter((row) => row.leadId).length).toBe(eventsBefore); expect((await overviewNow()).health.find((row) => row.name === "Nordlicht Energie")!.sent).toBe(before.health.find((row) => row.name === "Nordlicht Energie")!.sent); // eine Probe ist keine Übergabe
  }, 90_000);

  it("Lieferkette: feste Regel statt Round Robin – je Kategorie stehen die Ketten mit „Von“ und „An“; eine neue Kette entsteht aus drei Angaben und verteilt sofort", async () => {
    const fenster = table("leadCategories").find((row) => row.name === "Fenster")!; const flux = table("suppliers").find((row) => row.name === "Flux Ads")!; const chainsBefore = table("deliveryChains").length;
    const dieter = (await overviewNow()).problems.find((problem) => problem.name === "Dieter Kraus")!.publicId;
    const root = await open("page=Lieferkette", 2500); await until(() => root.querySelectorAll(".lk-chain").length > 0);
    expect(root.querySelector("h1")!.textContent).toBe("Lieferkette"); expect(root.textContent).not.toMatch(/Round.?Robin|Verteilmodus/i); expect(root.querySelector(".page-intro p")!.textContent).toContain("es wird nicht abgewechselt");
    // Übersicht: je Kategorie ein Block; jede Kette zeigt, von wem die Leads kommen und an wen sie der Reihe nach gehen
    const overview = await callProcedure("leadops.chainOverview", { range: "maximal" }) as { chains: Array<{ id: number; name: string; categoryName: string; place: number; supplierText: string; buyers: Array<{ name: string }>; before: number[]; status: string }> };
    const groups = Array.from(root.querySelectorAll<HTMLElement>("section.lk-panel[aria-label^=\"Lieferketten für \"]")); expect(groups.map((node) => node.querySelector("h2")!.textContent)).toEqual(Array.from(new Set(overview.chains.map((chain) => chain.categoryName))).sort((a, b) => a.localeCompare(b, "de")));
    const pv = groups.find((node) => node.querySelector("h2")!.textContent === "Photovoltaik")!; const waterfall = Array.from(pv.querySelectorAll<HTMLElement>(".lk-chain")).find((node) => node.querySelector(".lk-name")!.textContent === "Ondialer PV: Nordlicht Energie → Aurora Home")!;
    expect(waterfall.querySelector(".lk-from b")!.textContent).toBe("Signal Ads, Orbit Media"); expect(texts(waterfall, ".lk-buyer")).toEqual(["1Nordlicht Energie", "2Aurora Home"]); expect(waterfall.querySelector(".lk-status")!.textContent).toBe("Aktiv");
    expect(texts(pv, ".lk-place strong")).toEqual(overview.chains.filter((chain) => chain.categoryName === "Photovoltaik").sort((a, b) => a.place - b.place).map((chain) => String(chain.place)));
    expect(groups.some((node) => node.querySelector("h2")!.textContent === "Fenster" && node.querySelector(".lk-status.is-on"))).toBe(false); // für „Fenster“ gibt es noch keine aktive Kette

    // Neue Lieferkette: 1 Kategorie · 2 Lieferanten · 3 Kunden in fester Reihenfolge – darunter steht die Regel als Satz
    await click(button(root, "Neue Lieferkette"), 400); const builder = () => root.querySelector<HTMLElement>(".lk-builder")!; const hint = () => builder().querySelector(".lk-builder-actions small")?.textContent ?? null; const create = () => Array.from(builder().querySelectorAll<HTMLButtonElement>(".lk-builder-actions button")).pop()!;
    expect(hint()).toBe("Wähle mindestens eine Kategorie."); expect(create().disabled).toBe(true);
    const chip = (label: string) => Array.from(builder().querySelectorAll<HTMLButtonElement>(".lk-chip")).find((node) => node.textContent === label);
    await click(chip("Fenster"), 150); expect(chip("Fenster")!.getAttribute("aria-pressed")).toBe("true"); expect(hint()).toBe("Trage mindestens einen Kunden ein – oder lege die Kette ausgeschaltet an.");
    await click(Array.from(builder().querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((node) => node.textContent === "Nur bestimmte"), 150); expect(hint()).toBe("Wähle mindestens einen Lieferanten – oder „Alle Lieferanten“.");
    await click(chip("Flux Ads"), 150);
    const pick = () => builder().querySelector<HTMLSelectElement>('select[aria-label="Kunde wählen"]')!; const nordlicht = Array.from(pick().options).find((item) => item.textContent!.startsWith("Nordlicht Energie"))!;
    await type(pick(), nordlicht.value); await type(builder().querySelector('input[aria-label="Preis je Lead"]'), "25"); await click(button(builder(), "Kunde hinzufügen"), 200);
    await type(pick(), "frei"); await type(builder().querySelector('input[aria-label="Name des Kunden"]'), "Fensterbau Probe"); await type(builder().querySelector('input[aria-label="Preis je Lead"]'), "19,5"); await click(button(builder(), "Kunde hinzufügen"), 200);
    expect(texts(builder(), ".lk-picked li strong")).toEqual(["Nordlicht Energie", "Fensterbau Probe"]); expect(Array.from(pick().options).some((item) => item.value === nordlicht.value)).toBe(false); // derselbe Kunde nicht zweimal
    expect(builder().querySelector(".lk-sentence")!.textContent).toBe("So wird verteiltLeads aus Fenster von Flux Ads gehen zuerst an Nordlicht Energie. Nimmt Nordlicht Energie einen Lead nicht, geht er an Fensterbau Probe.");
    // Reihenfolge der Kunden tauschen und zurück
    await click(builder().querySelector('button[aria-label="Fensterbau Probe nach oben"]'), 150); expect(texts(builder(), ".lk-picked li strong")).toEqual(["Fensterbau Probe", "Nordlicht Energie"]); expect(builder().querySelector(".lk-sentence")!.textContent).toContain("gehen zuerst an Fensterbau Probe.");
    await click(builder().querySelector('button[aria-label="Fensterbau Probe nach unten"]'), 150); expect(texts(builder(), ".lk-picked li strong")).toEqual(["Nordlicht Energie", "Fensterbau Probe"]);
    expect(hint()).toBeNull(); expect(create().textContent).toBe("Lieferkette anlegen"); expect(builder().querySelector<HTMLInputElement>(".lk-name-field input")!.placeholder).toBe("Fenster: Flux Ads → Nordlicht Energie → Fensterbau Probe");
    await click(create(), 1500);
    // angelegt, eingeschaltet – und die Seite der Kette zeigt dieselbe Regel
    expect(table("deliveryChains").length).toBe(chainsBefore + 1); const chain = table("deliveryChains")[table("deliveryChains").length - 1];
    expect(chain).toMatchObject({ name: "Fenster: Flux Ads → Nordlicht Energie → Fensterbau Probe", categoryId: fenster.id, status: "aktiv", supplierFilterMode: "include", supplierIds: [flux.id], sellTarget: 1 });
    expect(table("deliveryStops").filter((stop) => stop.chainId === chain.id).sort((a, b) => a.position - b.position).map((stop) => [stop.position, stop.buyerName, stop.unitPrice, Boolean(stop.buyerUserId)])).toEqual([[1, "Nordlicht Energie", "25.00", true], [2, "Fensterbau Probe", "19.50", false]]);
    await until(() => root.querySelector("h1")?.textContent === chain.name); expect(root.querySelector("h1")!.textContent).toBe("Fenster: Flux Ads → Nordlicht Energie → Fensterbau Probe");
    expect(root.querySelector(".lk-rule .lk-sentence")!.textContent).toBe("So wird verteiltLeads aus Fenster von Flux Ads gehen zuerst an Nordlicht Energie. Nimmt Nordlicht Energie einen Lead nicht, geht er an Fensterbau Probe."); expect(root.textContent).not.toMatch(/Round.?Robin|Verteilmodus/i);
    // Der Lead, der bisher an „keine aktive Lieferkette“ scheiterte (Fenster, von Flux Ads), geht jetzt an den ersten Kunden – und gilt als gelöst
    const retried = await callProcedure("leadops.retryLeadDeliveries", { publicIds: [dieter] }) as { delivered: number; results: Array<{ ok: boolean; buyerName: string | null; message: string }> };
    expect(retried.delivered).toBe(1); expect(retried.results[0]).toMatchObject({ ok: true, buyerName: "Nordlicht Energie", message: "An Nordlicht Energie zugewiesen." });
    const after = await overviewNow(); expect(after.problems.some((problem) => problem.publicId === dieter)).toBe(false); expect(after.resolved.find((item) => item.publicId === dieter)).toMatchObject({ title: "Für diese Kategorie gibt es keine aktive Lieferkette.", buyerName: "Nordlicht Energie" });
  }, 90_000);

  it("Feste Reihenfolge: Passen zwei Ketten zum selben Lead, bekommt ihn immer die obere – die Pfeile ändern die Reihenfolge; eine Regel für mehrere Kategorien legt je Kategorie eine Kette an", async () => {
    const category = (name: string) => table("leadCategories").find((row) => row.name === name)!; const fenster = category("Fenster"); const wp = category("Wärmepumpe");
    const rule = (input: Row) => callProcedure("leadops.createChainRule", input) as Promise<{ created: Array<{ chainId: number; name: string; categoryId: number; priority: number }> }>;
    // unvollständige Regeln werden abgewiesen
    await expect(rule({ categoryIds: [fenster.id], supplierMode: "include", supplierIds: [], buyers: [{ buyerName: "A", unitPrice: 1 }], active: true })).rejects.toThrow(/mindestens einen Lieferanten/);
    await expect(rule({ categoryIds: [fenster.id], supplierMode: "all", supplierIds: [], buyers: [], active: true })).rejects.toThrow(/mindestens einen Kunden/);
    const first = await rule({ categoryIds: [fenster.id], supplierMode: "all", supplierIds: [], buyers: [{ buyerName: "Fenster Kunde Eins", unitPrice: 20 }], name: "Fenster Erste", active: true });
    const second = await rule({ categoryIds: [fenster.id], supplierMode: "all", supplierIds: [], buyers: [{ buyerName: "Fenster Kunde Zwei", unitPrice: 18 }], name: "Fenster Zweite", active: true });
    const a = first.created[0].chainId; const b = second.created[0].chainId; expect(second.created[0].priority).toBe(first.created[0].priority + 1);
    const lead = async (index: number) => (await callProcedure("leadops.importLead", { categoryId: fenster.id, firstName: "Fenja", lastName: `Fest${index}`, email: `fenja.fest${index}@beispiel.de`, phone: `+49151234801${10 + index}`, postcode: "34117", city: "Kassel" }) as { publicId: string }).publicId;
    const buyerOf = async (index: number) => (await callProcedure("leadops.deliverLead", { publicId: await lead(index) }) as { buyerName: string }).buyerName;
    // dreimal hintereinander derselbe Kunde – es wird nicht abgewechselt
    expect([await buyerOf(1), await buyerOf(2), await buyerOf(3)]).toEqual(["Fenster Kunde Eins", "Fenster Kunde Eins", "Fenster Kunde Eins"]);

    const root = await open("page=Lieferkette", 2500); await until(() => root.querySelectorAll(".lk-chain").length > 0);
    const group = () => Array.from(root.querySelectorAll<HTMLElement>("section.lk-panel")).find((node) => node.querySelector("h2")?.textContent === "Fenster")!; const order = () => texts(group(), ".lk-chain .lk-name").filter((name) => name === "Fenster Erste" || name === "Fenster Zweite"); // die Vorschau bringt für „Fenster“ schon eine ausgeschaltete Kette mit
    expect(order()).toEqual(["Fenster Erste", "Fenster Zweite"]); expect(group().querySelector(".lk-order-note")!.textContent).toContain("gilt immer die Reihenfolge von oben nach unten");
    const chainNode = (name: string) => Array.from(group().querySelectorAll<HTMLElement>(".lk-chain")).find((node) => node.querySelector(".lk-name")!.textContent === name)!;
    expect(chainNode("Fenster Zweite").querySelector(".lk-after")!.textContent).toContain("Kommt erst nach: Fenster Erste"); expect(chainNode("Fenster Erste").querySelector(".lk-after")?.textContent ?? "").not.toContain("Fenster Zweite");
    // „nach oben“: Die zweite Kette kommt jetzt zuerst dran – ab sofort bekommt ihr Kunde die Leads
    await click(group().querySelector('button[aria-label="„Fenster Zweite“ nach oben"]'), 1000); await until(() => order()[0] === "Fenster Zweite"); expect(order()).toEqual(["Fenster Zweite", "Fenster Erste"]);
    const priority = (id: number) => table("deliveryChains").find((row) => row.id === id)!.priority as number; expect(priority(b)).toBeLessThan(priority(a));
    expect(chainNode("Fenster Erste").querySelector(".lk-after")!.textContent).toContain("Kommt erst nach: Fenster Zweite");
    expect([await buyerOf(4), await buyerOf(5)]).toEqual(["Fenster Kunde Zwei", "Fenster Kunde Zwei"]);
    // ausgeschaltet → die andere Kette übernimmt
    await click(button(chainNode("Fenster Zweite"), "Ausschalten"), 1000); await until(() => chainNode("Fenster Zweite").querySelector(".lk-status")!.textContent === "Aus"); expect(chainNode("Fenster Zweite").className).toContain("is-off");
    expect(await buyerOf(6)).toBe("Fenster Kunde Eins");
    // eine Regel für zwei Kategorien = je Kategorie eine Kette mit denselben Kunden
    const both = await rule({ categoryIds: [fenster.id, wp.id], supplierMode: "all", supplierIds: [], buyers: [{ buyerName: "Beide Kunde", unitPrice: 5 }], name: "Für beide", active: false });
    expect(both.created.map((row) => [row.name, row.categoryId])).toEqual([["Für beide – Fenster", fenster.id], ["Für beide – Wärmepumpe", wp.id]]);
    expect(both.created.map((row) => table("deliveryChains").find((chain) => chain.id === row.chainId)!.status)).toEqual(["inaktiv", "inaktiv"]);
  }, 90_000);

  it("Dashboard: Die Karte „Integrationsgesundheit“ führt zu den Fehlern", async () => {
    const root = await open("page=Dashboard", 2500); await until(() => Boolean(root.querySelector(".focus-more")));
    expect(root.querySelector(".focus-more")!.textContent).toBe("Details und Fehler ansehen");
    await click(root.querySelector(".focus-more"), 1500); await until(() => root.querySelector("h1")?.textContent === "API-Fehler"); expect(root.querySelector("h1")!.textContent).toBe("API-Fehler");
    expect(new URLSearchParams(window.location.search).get("page")).toBe("API-Fehler");
  }, 40_000);
});
