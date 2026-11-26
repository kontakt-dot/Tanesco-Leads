import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoApp from "../App.demo";
import { localDemoLink } from "../link";
import { callProcedure, getStore, resetStore } from "../backend";
import { WATTFOX_TEMPLATE } from "../../../../shared/wattfox";

/**
 * Version 371 – ein freigegebener Lead ohne E-Mail-Adresse steht unter „API-Fehler“, bevor er rausgeht („Angaben fehlen“). Hat die Kategorie
 * eine Wattfox-Schnittstelle, stehen alle Pflichtangaben da, die fehlen (auch die Anrede) – „Korrigieren“ trägt sie nach.
 */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  return render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
async function until(check: () => boolean, tries = 40) { for (let index = 0; index < tries && !check(); index += 1) await settle(150); }
const click = async (node: Element | null | undefined, wait = 400) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(wait); };
const type = async (node: HTMLInputElement | HTMLSelectElement, value: string) => { await act(async () => { fireEvent.change(node, { target: { value } }); }); await settle(120); };
const open = async (query: string, wait = 2500) => { window.history.replaceState(null, "", `/?${query}`); const view = mount(); await settle(wait); return view.container; };
type Row = Record<string, any>;
const table = (name: string) => (getStore().tables as unknown as Record<string, Row[]>)[name];
type Overview = { counts: { open: number; daten: number }; problems: Array<{ publicId: string; name: string; kind: string; title: string; field: string | null; dataProblems: Array<{ field: string; title: string; hint: string; missing?: boolean }> }> };
const overviewNow = async () => await callProcedure("leadops.apiErrorOverview", { days: 30 }) as Overview;
const rowOf = (root: Element, name: string) => Array.from(root.querySelectorAll<HTMLElement>(".af-row")).find((row) => row.querySelector(".af-name")?.textContent === name);
const button = (root: Element, text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent?.trim() === text);

/** Ein frischer, freigegebener Lead vom Dialer: Name, Rufnummer, Ort – aber keine E-Mail-Adresse. */
function leadWithoutEmail() {
  const leads = table("leads"); const pv = table("leadCategories").find((row) => row.name === "Photovoltaik")!; const sample = leads.find((row) => row.categoryId === pv.id && row.status === "genehmigt") ?? leads.find((row) => row.categoryId === pv.id)!;
  const lead = { ...sample, tenantId: pv.tenantId, categoryId: pv.id, id: Math.max(...leads.map((row) => Number(row.id))) + 1, publicId: "V371MAIL", firstName: "Bernd", lastName: "Mustermann", email: null, phone: "+4915112340999", postcode: "48249", city: "Dülmen", country: "DE", status: "genehmigt", supplierId: null, supplierName: "OnDialer", assignedUserId: null, metadata: { street: "Hauptstraße 12" }, createdAt: new Date(), updatedAt: new Date() };
  leads.push(lead); return { lead, pv };
}

describe("Version 371", () => {
  beforeEach(() => { cleanup(); resetStore(); });
  afterEach(() => { cleanup(); resetStore(); });

  it("API-Fehler: freigegebener Lead ohne E-Mail-Adresse steht als „Angaben fehlen“ da – nachtragen nimmt ihn heraus", async () => {
    const before = await overviewNow(); const { lead } = leadWithoutEmail();
    const after = await overviewNow(); expect(after.counts.open).toBe(before.counts.open + 1); expect(after.counts.daten).toBe(before.counts.daten + 1);
    expect(after.problems.find((problem) => problem.publicId === "V371MAIL")).toMatchObject({ kind: "daten", field: "email", title: "Die E-Mail-Adresse fehlt." });
    const root = await open("page=API-Fehler"); await until(() => Boolean(rowOf(root, "Bernd Mustermann")));
    const row = rowOf(root, "Bernd Mustermann")!; expect(row.querySelector(".af-kind")!.textContent).toBe("Angaben fehlen"); expect(row.querySelector(".af-title")!.textContent).toBe("Die E-Mail-Adresse fehlt.");
    expect(row.querySelector(".af-data b")!.textContent).toBe("E-Mail-Adresse"); expect(row.querySelector(".af-data code")!.textContent).toBe("leer"); expect(row.querySelector(".af-advice")!.textContent).toContain("nachtragen");
    expect(Array.from(root.querySelectorAll(".af-tile span")).map((node) => node.textContent)).toContain("Angaben fehlen oder falsch");
    await click(button(row, "Korrigieren"), 300); const form = root.querySelector<HTMLFormElement>("form.af-edit")!;
    const mail = form.querySelector<HTMLInputElement>(".af-field.is-email input")!; expect(form.querySelector(".af-field.is-email")!.className).toContain("is-marked"); expect(form.querySelector(".af-field.is-email small")!.textContent).toBe("Fehlt – bitte nachtragen.");
    await type(mail, "bernd.mustermann@example.de"); await click(button(form, "Nur speichern"), 900); await until(() => !rowOf(root, "Bernd Mustermann"));
    expect(rowOf(root, "Bernd Mustermann")).toBeUndefined(); expect(table("leads").find((row) => row.id === lead.id)!.email).toBe("bernd.mustermann@example.de");
    expect((await overviewNow()).counts.open).toBe(before.counts.open);
  }, 60_000);

  it("Mit Wattfox-Schnittstelle für die Kategorie: Anrede und E-Mail stehen als fehlend da – die Anrede lässt sich wählen", async () => {
    const { lead, pv } = leadWithoutEmail();
    const endpoint = table("deliveryEndpoints")[0]; const membership = table("memberships").find((row) => row.id === endpoint.membershipId)!; const buyer = table("users").find((row) => row.id === membership.userId)!; const buyerName = String(buyer.company ?? buyer.name);
    table("deliveryEndpoints").push({ ...endpoint, id: Math.max(...table("deliveryEndpoints").map((row) => Number(row.id))) + 1, categoryId: pv.id, enabled: true, bodyTemplate: WATTFOX_TEMPLATE, sourceFilterMode: "alle", sourceSupplierIds: null, fieldFilters: null, valueMappings: null });
    const problem = (await overviewNow()).problems.find((item) => item.publicId === "V371MAIL")!;
    expect(problem.dataProblems.map((item) => [item.field, item.title, item.hint])).toEqual([["salutation", "Die Anrede fehlt (Herr oder Frau).", `${buyerName} nimmt den Lead nur damit an.`], ["email", "Die E-Mail-Adresse fehlt.", `${buyerName} nimmt den Lead nur damit an.`]]);
    const root = await open("page=API-Fehler"); await until(() => Boolean(rowOf(root, "Bernd Mustermann")));
    const row = rowOf(root, "Bernd Mustermann")!; expect(Array.from(row.querySelectorAll(".af-data b")).map((node) => node.textContent)).toEqual(["Anrede", "E-Mail-Adresse"]);
    await click(button(row, "Korrigieren"), 300); const form = root.querySelector<HTMLFormElement>("form.af-edit")!;
    const salutation = form.querySelector<HTMLSelectElement>(".af-field.is-salutation select")!; expect(Array.from(salutation.options).map((option) => option.value)).toEqual(["", "Herr", "Frau"]);
    await type(salutation, "Herr"); await type(form.querySelector<HTMLInputElement>(".af-field.is-email input")!, "bernd.mustermann@example.de"); await click(button(form, "Nur speichern"), 900); await until(() => !rowOf(root, "Bernd Mustermann"));
    const saved = table("leads").find((row) => row.id === lead.id)!; expect(saved.metadata.anrede).toBe("Herr"); expect(saved.email).toBe("bernd.mustermann@example.de");
    expect(table("leadStatusEvents").filter((row) => row.leadId === lead.id).map((row) => String(row.note))).toContain("Von Hand korrigiert: Anrede: leer → „Herr“ · E-Mail-Adresse: leer → „bernd.mustermann@example.de“");
    expect((await overviewNow()).problems.some((item) => item.publicId === "V371MAIL")).toBe(false);
  }, 60_000);
});
