export const categoryWorkspaceTabs = ["settings", "fields", "mapping"] as const;
export type CategoryWorkspaceTab = (typeof categoryWorkspaceTabs)[number];
export const categoryWorkspaceTabLabels: Record<CategoryWorkspaceTab, string> = { settings: "Grundeinstellungen", fields: "Benutzerdefinierte Felder", mapping: "Datenharmonisierung" };
export const categoryOperationalTools = ["CSV-Vorlage", "Parameterblatt"] as const;

export function buildProtectedCategoryWorkspaceContract(input: { tenantId: number; categoryId: number }) {
  if (!Number.isInteger(input.tenantId) || input.tenantId < 1 || !Number.isInteger(input.categoryId) || input.categoryId < 1) throw new Error("Geschützter Kategorienarbeitsbereich benötigt Mandanten- und Kategorie-ID.");
  return { directLink: `/?page=Lead-Kategorien&categoryId=${input.categoryId}`, tabs: categoryWorkspaceTabs, tools: categoryOperationalTools, tenantId: input.tenantId, categoryId: input.categoryId };
}

type CategoryRouteEntry = { id?: number; shortcode: string; name: string };
type FieldEntry = { label: string; fieldKey: string; fieldType: string; options?: unknown };
type MappingEntry = { sourceField: string; targetFieldKey: string; mode: string };

export function resolveCategoryWorkspaceRoute<T extends CategoryRouteEntry>(search: string, categories: readonly T[]) {
  const params = new URLSearchParams(search);
  const requestedCategory = params.get("category")?.trim().toLowerCase();
  const requestedCategoryId = Number(params.get("categoryId")) || undefined;
  const requestedTab = params.get("tab");
  const tab: CategoryWorkspaceTab = categoryWorkspaceTabs.includes(requestedTab as CategoryWorkspaceTab) ? requestedTab as CategoryWorkspaceTab : "settings";
  const category = requestedCategoryId ? categories.find((item) => item.id === requestedCategoryId) : requestedCategory ? categories.find((item) => item.shortcode.toLowerCase() === requestedCategory || item.name.toLowerCase() === requestedCategory) : undefined;
  return { category, tab };
}

export function buildCategoryCsvHeaders(fields: readonly Pick<FieldEntry, "fieldKey">[]) {
  return ["vorname", "nachname", "email", "telefon", "plz", "ort", ...fields.map((field) => field.fieldKey)];
}

export function buildCategoryParameterSheet(input: { name: string; shortcode: string; fields: readonly FieldEntry[]; mappings: readonly MappingEntry[]; labelForFieldType: (fieldType: string) => string }) {
  const integration = getFluxoraMasterLeadIntegration(input.shortcode);
  return [
    `# Parameterblatt – ${input.name}`,
    "",
    `Shortcode: ${input.shortcode}`,
    ...(integration ? [
      `Fluxora-Stammintegration: ${integration.name}`,
      `Kategoriecode (lead_type_id): ${integration.leadTypeId}`,
      `Tokenvertrag: ${integration.tokenHeader}`,
      "",
      "## Standardfelder",
      ...fluxoraStandardLeadFields.map((field) => `- ${field.label} (${field.key})${field.required ? " · Pflicht" : " · optional"} · ${field.description}`),
    ] : []),
    "",
    "## custom_data-Felder",
    ...input.fields.map((field) => `- ${field.label} (${field.fieldKey}) · ${input.labelForFieldType(field.fieldType)}${Array.isArray(field.options) && field.options.length ? ` · Auswahl: ${field.options.join(" | ")}` : ""}`),
    "",
    "## Harmonisierung",
    ...(input.mappings.length ? input.mappings.map((mapping) => `- ${mapping.sourceField} → ${mapping.targetFieldKey} (${mapping.mode})`) : ["- Noch keine Regeln angelegt."]),
  ].join("\n");
}
import { fluxoraStandardLeadFields, getFluxoraMasterLeadIntegration } from "@shared/leadIntegrationContracts";
