/**
 * Kooperationen (Verzeichnis der Partner): Worte, Zahlen und Suche für die Seite – ohne Oberfläche, damit sie sich prüfen lassen.
 * Eine Kooperation hält fest, mit wem Leads ausgetauscht werden, in welche Richtung, und wie Kategorien und Felder beim Partner heißen.
 * Ausgeliefert wird über die Lieferkette und die Integrationen; die Angaben hier ändern daran nichts.
 */
export type CoopStatus = "angefragt" | "aktiv" | "inaktiv";
export type CoopDirection = "eingehend" | "ausgehend" | "beidseitig";
export type CoopCategoryMapping = { sourceCategoryId: number; partnerCategoryName: string };
export type CoopFieldMapping = { sourceField: string; partnerField?: string | null; transfer?: boolean | null };
export type CoopRow = { id: number; partnerTenantName: string; partnerTenantId?: number | null; direction: CoopDirection | string; status: CoopStatus | string; categories: CoopCategoryMapping[]; fields: CoopFieldMapping[] };

/** Reihenfolge der Reiter: erst, was läuft, dann, was noch offen ist, dann, was ruht. */
export const COOP_STATUS: Array<{ key: CoopStatus; label: string; hint: string }> = [
  { key: "aktiv", label: "Aktiv", hint: "Die Zusammenarbeit läuft." },
  { key: "angefragt", label: "Angefragt", hint: "Angelegt, aber noch nicht bestätigt." },
  { key: "inaktiv", label: "Pausiert", hint: "Ruht gerade – die Angaben bleiben erhalten." },
];
export const coopStatusLabel = (status: string) => COOP_STATUS.find((item) => item.key === status)?.label ?? status;
/** Farbe nur, wo etwas zu tun ist: „Angefragt“ wartet auf eine Entscheidung. */
export const coopStatusTone = (status: string): "good" | "warn" | "mute" => status === "aktiv" ? "good" : status === "angefragt" ? "warn" : "mute";
/** Was der Hauptknopf einer Kooperation macht: aktivieren, pausieren oder wieder aktivieren. */
export function coopNextStep(status: string): { status: CoopStatus; label: string; done: string } {
  if (status === "aktiv") return { status: "inaktiv", label: "Pausieren", done: "Kooperation pausiert." };
  if (status === "inaktiv") return { status: "aktiv", label: "Wieder aktivieren", done: "Kooperation ist wieder aktiv." };
  return { status: "aktiv", label: "Aktivieren", done: "Kooperation ist aktiv." };
}

export const COOP_DIRECTIONS: Array<{ key: CoopDirection; label: string; short: string }> = [
  { key: "ausgehend", label: "Wir liefern Leads an den Partner", short: "Wir liefern" },
  { key: "eingehend", label: "Der Partner liefert Leads an uns", short: "Partner liefert" },
  { key: "beidseitig", label: "Leads gehen in beide Richtungen", short: "Beide Richtungen" },
];
export const coopDirectionLabel = (direction: string) => COOP_DIRECTIONS.find((item) => item.key === direction)?.label ?? direction;
export const coopDirectionShort = (direction: string) => COOP_DIRECTIONS.find((item) => item.key === direction)?.short ?? direction;

/** Felder eines Leads, die sich zuordnen lassen – mit dem Namen, unter dem man sie kennt. Andere Feldnamen bleiben von Hand möglich. */
export const COOP_LEAD_FIELDS: Array<{ key: string; label: string }> = [
  { key: "salutation", label: "Anrede" }, { key: "firstName", label: "Vorname" }, { key: "lastName", label: "Nachname" }, { key: "company", label: "Firma" },
  { key: "email", label: "E-Mail" }, { key: "phone", label: "Telefon" }, { key: "street", label: "Straße" }, { key: "postcode", label: "PLZ" }, { key: "city", label: "Ort" }, { key: "country", label: "Land" },
];
/** „Vorname“ statt „firstName“; unbekannte Feldnamen stehen so da, wie sie eingetragen wurden. */
export const coopFieldLabel = (field: string) => COOP_LEAD_FIELDS.find((item) => item.key.toLowerCase() === field.trim().toLowerCase())?.label ?? field;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
/** „2 Kategorien · 6 Felder zugeordnet“ – oder der Hinweis, dass noch nichts zugeordnet ist. */
export function coopSummary(row: Pick<CoopRow, "categories" | "fields">): string {
  const categories = row.categories.length; const fields = row.fields.length;
  if (!categories && !fields) return "noch nichts zugeordnet";
  return [categories ? plural(categories, "Kategorie", "Kategorien") : "", fields ? plural(fields, "Feld", "Felder") : ""].filter(Boolean).join(" · ") + " zugeordnet";
}

export type CoopCounts = { alle: number; aktiv: number; angefragt: number; inaktiv: number; zuordnungen: number; ohneZuordnung: number };
export function coopCounts(rows: Array<Pick<CoopRow, "status" | "categories" | "fields">>): CoopCounts {
  const counts: CoopCounts = { alle: rows.length, aktiv: 0, angefragt: 0, inaktiv: 0, zuordnungen: 0, ohneZuordnung: 0 };
  for (const row of rows) {
    if (row.status === "aktiv") counts.aktiv += 1; else if (row.status === "angefragt") counts.angefragt += 1; else counts.inaktiv += 1;
    const own = row.categories.length + row.fields.length; counts.zuordnungen += own; if (!own) counts.ohneZuordnung += 1;
  }
  return counts;
}

const plain = (text: string) => text.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
/**
 * Suche: jedes Wort muss vorkommen – im Namen des Partners, in der Richtung, im Stand, in den Namen der Kategorien (bei uns und beim Partner)
 * oder in den Feldern. Groß-/Kleinschreibung und Umlaute spielen keine Rolle.
 */
export function coopMatches(row: CoopRow, query: string, categoryName: (id: number) => string | null = () => null): boolean {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = plain([
    row.partnerTenantName, coopDirectionLabel(String(row.direction)), coopDirectionShort(String(row.direction)), coopStatusLabel(String(row.status)),
    ...row.categories.flatMap((item) => [categoryName(item.sourceCategoryId) ?? "", item.partnerCategoryName]),
    ...row.fields.flatMap((item) => [item.sourceField, coopFieldLabel(item.sourceField), item.partnerField ?? ""]),
  ].join(" "));
  return words.every((word) => hay.includes(word));
}

/** Prüft die Angaben einer neuen oder geänderten Kooperation; liefert den Hinweis für das Formular oder null. */
export function coopNameIssue(name: string, others: Array<{ id: number; partnerTenantName: string }> = [], ownId: number | null = null): string | null {
  const clean = name.trim();
  if (clean.length < 2) return "Bitte den Namen des Partners eintragen (mindestens zwei Zeichen).";
  if (clean.length > 160) return "Der Name ist zu lang (höchstens 160 Zeichen).";
  if (others.some((item) => item.id !== ownId && plain(item.partnerTenantName.trim()) === plain(clean))) return "Einen Partner mit diesem Namen gibt es schon.";
  return null;
}
