/**
 * Ordner in der Kampagnen-Übersicht – z. B. je Leadsparte (Hausnotruf, Alarmanlage, PV & WP …). Ein Ordner ist nur eine Ablage:
 * an Versand, Zahlen und KI ändert er nichts. Hier steht, was Server und Chat-Demo gleich machen (Namen prüfen, nach Sparte einsortieren).
 */
import { detectSparte } from "./lead-sparte";

export const FOLDER_NAME_MAX = 120;
export const MAX_FOLDERS = 100;
export const cleanFolderName = (value: string | null | undefined) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, FOLDER_NAME_MAX);
/** Vergleichsschlüssel: Groß-/Kleinschreibung und doppelte Leerzeichen zählen nicht („hausnotruf“ = „Hausnotruf“). */
export const folderKey = (value: string | null | undefined) => cleanFolderName(value).toLocaleLowerCase("de");
export const sameFolderName = (a: string, b: string) => folderKey(a) === folderKey(b);

/** Warum der Name nicht geht (leer oder schon vergeben) – sonst null. */
export function folderNameIssue(name: string, folders: Array<{ id: number; name: string }>, ownId?: number | null): string | null {
  const clean = cleanFolderName(name); if (!clean) return "Bitte einen Namen für den Ordner angeben.";
  const clash = folders.find((folder) => folder.id !== ownId && sameFolderName(folder.name, clean));
  return clash ? `Den Ordner „${clash.name}“ gibt es schon.` : null;
}

/** Ordner sortiert wie in der Leiste: eigene Reihenfolge, sonst A–Z (Zahlen natürlich: „Region 2“ vor „Region 10“). */
export function sortFolders<T extends { name: string; sortOrder?: number | null }>(folders: T[]): T[] {
  return [...folders].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "de", { sensitivity: "base", numeric: true }));
}

/**
 * Passender Ordner für eine Leadsparte: gleicher Name – oder ein selbst angelegter Ordner, der erkennbar dieselbe Sparte meint
 * („PV & WP“ für Photovoltaik & Wärmepumpe, „Hausnotruf Bayern“ für Hausnotruf). Eigene Sparten nur über den gleichen Namen.
 */
export function folderForSparte<T extends { id: number; name: string }>(folders: T[], sparte: { key: string; label: string }): T | null {
  const exact = folders.find((folder) => sameFolderName(folder.name, sparte.label)); if (exact) return exact;
  if (sparte.key === "eigene") return null;
  return sortFolders(folders).find((folder) => detectSparte(folder.name)?.key === sparte.key) ?? null;
}

export type SparteFolderPlan = {
  /** neue Ordner (Namen = Leadsparte) */
  create: string[];
  /** je Kampagne der Zielordner: vorhandener Ordner (folderId) oder ein neuer aus `create` (folderId null, Name in folderName) */
  moves: Array<{ id: number; folderId: number | null; folderName: string }>;
};
/**
 * „Nach Leadsparte einsortieren“: jede Kampagne ohne Ordner kommt in den Ordner ihrer Leadsparte – so, wie die Sparte auf der Karte
 * steht (ohne eingetragene oder erkannte Sparte gilt Photovoltaik & Wärmepumpe). Fehlt der Ordner, wird er angelegt.
 * Kampagnen, die schon in einem Ordner liegen, bleiben, wo sie sind.
 */
export function planSparteFolders(campaigns: Array<{ id: number; folderId: number | null; sparte: { key: string; label: string } }>, folders: Array<{ id: number; name: string }>): SparteFolderPlan {
  const known = new Set(folders.map((folder) => folder.id)); const create: string[] = []; const moves: SparteFolderPlan["moves"] = [];
  for (const campaign of campaigns) {
    if (campaign.folderId && known.has(campaign.folderId)) continue;
    const existing = folderForSparte(folders, campaign.sparte);
    if (existing) { moves.push({ id: campaign.id, folderId: existing.id, folderName: existing.name }); continue; }
    const name = create.find((item) => sameFolderName(item, campaign.sparte.label)) ?? cleanFolderName(campaign.sparte.label);
    if (!create.includes(name)) create.push(name);
    moves.push({ id: campaign.id, folderId: null, folderName: name });
  }
  return { create, moves };
}

/** Kurz zusammengefasst für die Meldung: „Hausnotruf (2), Alarmanlage (1)“ – größte Ordner zuerst. */
export function sortSummary(moves: SparteFolderPlan["moves"]): Array<{ name: string; count: number }> {
  const counts = new Map<string, { name: string; count: number }>();
  for (const move of moves) { const entry = counts.get(folderKey(move.folderName)) ?? { name: move.folderName, count: 0 }; entry.count += 1; counts.set(folderKey(move.folderName), entry); }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"));
}
