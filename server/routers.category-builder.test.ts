import { describe, expect, it, vi } from "vitest";

const categoryDraft = {
  name: "Photovoltaik Premium", shortcode: "PV_PREMIUM", offerDescription: "Anfragen für Photovoltaik-Projekte.",
  fields: [
    { label: "Dachfläche", fieldKey: "dachflaeche", fieldType: "zahl", options: [], required: true, description: "Nutzbare Dachfläche in Quadratmetern." },
    { label: "Dachausrichtung", fieldKey: "dachausrichtung", fieldType: "auswahl", options: ["Süd", "Ost", "West"], required: false, description: "Himmelsrichtung der Dachfläche." },
  ],
  mappings: [{ sourceField: "roof_area", targetFieldKey: "dachflaeche", mode: "uebernehmen", searchValue: "", replaceValue: "", rationale: "Direkte technische Zuordnung." }],
  assumptions: ["Die Spezifikation beschreibt eine deutsche PV-Kategorie."], reviewNotes: ["Preis und Freigabestatus vor dem Produktivstart prüfen."],
};

const invoke = vi.hoisted(() => vi.fn(async () => ({ choices: [{ message: { content: JSON.stringify(categoryDraft) } }] })));
const storagePut = vi.hoisted(() => vi.fn(async () => ({ key: "tenant-8/spec-pv.pdf", url: "/manus-storage/tenant-8/spec-pv.pdf" })));
const storageGetSignedUrl = vi.hoisted(() => vi.fn(async () => "https://storage.example.test/spec-pv.pdf"));
const writes = vi.hoisted((): unknown[] => []);
const values = vi.hoisted(() => vi.fn(async (value: unknown) => { writes.push(value); return [{ insertId: writes.length === 1 ? 81 : 0 }]; }));
const db = vi.hoisted(() => ({
  select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })) })),
  insert: vi.fn(() => ({ values })),
  transaction: vi.fn(async (callback: (transaction: typeof db) => unknown) => callback(db)),
}));

vi.mock("./db", () => ({ ensureTenantForUser: vi.fn(async () => ({ tenant: { id: 8, slug: "tanesco", name: "Tanesco Leads" }, membership: { role: "inhaber", partnerType: "intern", status: "aktiv" } })), getDb: vi.fn(async () => db), getTenantForUser: vi.fn(), listRecentLeads: vi.fn() }));
vi.mock("./_core/llm", () => ({ invokeLLM: invoke }));
vi.mock("./storage", () => ({ storagePut, storageGetSignedUrl }));
import { appRouter } from "./routers";

describe("Lead-Kategorien-Builder", () => {
  it("analysiert eine PDF-Spezifikation als untrusted input und liefert einen strukturierten, prüfbaren Kategorieentwurf", async () => {
    const caller = appRouter.createCaller({ user: { id: 11 } } as never);
    const result = await caller.leadops.analyzeCategorySpecification({ fileName: "PV Parameterblatt.pdf", mimeType: "application/pdf", contentBase64: Buffer.from("PDF Beispielinhalt").toString("base64"), notes: "Bitte technische Felder erkennen." });
    expect(storagePut).toHaveBeenCalledWith(expect.stringContaining("tenants/8/category-specifications/PV_Parameterblatt.pdf"), expect.any(Buffer), "application/pdf");
    expect(storageGetSignedUrl).not.toHaveBeenCalled(); // PDF geht als Base64-Dokument direkt an die KI, nicht mehr per signierter URL
    expect(JSON.stringify(invoke.mock.calls[0]?.[0])).toContain(Buffer.from("PDF Beispielinhalt").toString("base64"));
    expect(result.draft.fields).toHaveLength(2);
    expect(result.draft.mappings[0]).toMatchObject({ sourceField: "roof_area", targetFieldKey: "dachflaeche" });
    const request = JSON.stringify(invoke.mock.calls[0]?.[0]);
    expect(request).toContain("nicht vertrauenswürdig");
    expect(request).toContain("Zugangsdaten");
  });

  it("übernimmt einen überprüften Builder-Entwurf als echte Kategorie samt Feldern und Harmonisierung", async () => {
    writes.splice(0); values.mockClear();
    const caller = appRouter.createCaller({ user: { id: 11 } } as never);
    const result = await caller.leadops.createCategoryFromBuilder({ draft: categoryDraft });
    expect(result).toMatchObject({ success: true, categoryId: 81, fieldCount: 2, mappingCount: 1, shortcode: "PV_PREMIUM", isTemplate: false });
    expect(writes[0]).toMatchObject({ tenantId: 8, shortcode: "PV_PREMIUM", name: "Photovoltaik Premium", status: "aktiv", isTemplate: false });
    expect(writes[1]).toEqual(expect.arrayContaining([expect.objectContaining({ categoryId: 81, fieldKey: "dachflaeche", fieldType: "zahl" })]));
    expect(writes[2]).toEqual(expect.arrayContaining([expect.objectContaining({ categoryId: 81, sourceField: "roof_area", targetFieldKey: "dachflaeche" })]));
  });

  it("speichert denselben überprüften Entwurf als wiederverwendbare Vorlage statt als operative Kategorie", async () => {
    writes.splice(0); values.mockClear();
    const caller = appRouter.createCaller({ user: { id: 11 } } as never);
    const result = await caller.leadops.createCategoryFromBuilder({ draft: categoryDraft, saveAsTemplate: true });
    expect(result).toMatchObject({ success: true, categoryId: 81, isTemplate: true, shortcode: "PV_PREMIUM" });
    expect(writes[0]).toMatchObject({ tenantId: 8, isTemplate: true, name: "Photovoltaik Premium" });
  });
});
