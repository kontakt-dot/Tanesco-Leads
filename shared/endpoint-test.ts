import { isTestAddress, isWattfoxTemplate } from "./wattfox";

/**
 * Leads → „Testlead senden“ (seit v377): die eingeschalteten Schnittstellen der Käufer als Ziele.
 * Die Auswahl kannte vorher nur die Verbindungen aus Einstellungen → Integrationen; eine Schnittstelle, die beim Käufer
 * eingerichtet ist (Benutzer → Käufer → Integration), fehlte dort.
 */

/** Wohin eine Schnittstelle zeigt – für die Auswahl nur der Rechnername, nie Pfad oder Parameter (dort können Schlüssel stehen). */
export function endpointHost(url: string | null | undefined): string {
  try { return new URL(String(url ?? "").trim()).host; } catch { return ""; }
}

export type EndpointTestKind = "wattfox-live" | "wattfox-test" | "standard";
/** Was „Test senden“ bei dieser Schnittstelle tut: Wattfox-Vorlage auf der Live-Adresse → nur die Anmeldung wird geprüft, kein Lead geht raus. */
export function endpointTestKind(endpoint: { url: string | null | undefined; bodyTemplate: string | null | undefined }): EndpointTestKind {
  if (!isWattfoxTemplate(endpoint.bodyTemplate)) return "standard";
  return isTestAddress(endpoint.url) ? "wattfox-test" : "wattfox-live";
}

export type EndpointTestRow = { id: number; membershipId: number; categoryId: number; url: string | null | undefined; bodyTemplate: string | null | undefined; position: number; buyerName: string | null | undefined; /** Firma des Käufers – steht vor dem Namen, damit man z. B. den Partner erkennt und nicht nur die Ansprechperson */ company?: string | null; memberStatus: string | null | undefined; categoryName: string | null | undefined };
export type EndpointTestTarget = { id: number; membershipId: number; buyerName: string; categoryId: number; categoryName: string; host: string; kind: EndpointTestKind };

/** „Firma (Ansprechperson)“, sonst der Name, sonst „Käufer #…“. */
function buyerLabel(row: Pick<EndpointTestRow, "buyerName" | "company" | "membershipId">): string {
  const name = row.buyerName?.trim() ?? ""; const company = row.company?.trim() ?? "";
  if (company && name && company.toLowerCase() !== name.toLowerCase()) return `${company} (${name})`;
  return company || name || `Käufer #${row.membershipId}`;
}

/** Aufbereitung für die Auswahl: nur Käufer, die nicht deaktiviert sind; sortiert nach Name, Kategorie, Reihenfolge. Ohne Zugangsdaten, ohne die ganze Adresse. */
export function endpointTestTargets(rows: EndpointTestRow[]): EndpointTestTarget[] {
  return rows.filter((row) => row.memberStatus !== "deaktiviert")
    .map((row) => ({ id: row.id, membershipId: row.membershipId, buyerName: buyerLabel(row), categoryId: row.categoryId, categoryName: row.categoryName?.trim() || "ohne Kategorie", host: endpointHost(row.url), kind: endpointTestKind(row), position: row.position }))
    .sort((a, b) => a.buyerName.localeCompare(b.buyerName, "de") || a.categoryName.localeCompare(b.categoryName, "de") || a.position - b.position || a.id - b.id)
    .map(({ position: _position, ...target }) => target);
}

/** Was in der Auswahl steht: „Käufer · Kategorie“ – bei mehreren Schnittstellen desselben Käufers in derselben Kategorie mit dem Ziel dahinter. */
export function endpointTestLabel(target: EndpointTestTarget, all: EndpointTestTarget[]): string {
  const twins = all.filter((item) => item.membershipId === target.membershipId && item.categoryId === target.categoryId).length > 1;
  const system = target.kind === "wattfox-live" ? " – Wattfox live" : target.kind === "wattfox-test" ? " – Wattfox Testumgebung" : "";
  return `${target.buyerName} · ${target.categoryName}${system}${twins && target.host ? ` (${target.host})` : ""}`;
}

/** Hinweis unter der Auswahl: was beim Senden passiert. */
export function endpointTestNote(kind: EndpointTestKind): string {
  if (kind === "wattfox-live") return "Diese Schnittstelle zeigt auf das Live-System von Wattfox. Dorthin geht kein erfundener Lead – geprüft wird nur die Anmeldung. Testleads gehen an die Testumgebung: beim Käufer unter „Integration“ umstellen.";
  if (kind === "wattfox-test") return "Testumgebung von Wattfox: Es geht ein erfundener Lead ohne Kundendaten raus. Die drei Testleads je Sparte sendest du beim Käufer unter „Integration“.";
  return "Es geht ein erfundener Lead ohne Kundendaten an diese Schnittstelle – mit den Feldern ihrer Kategorie.";
}
