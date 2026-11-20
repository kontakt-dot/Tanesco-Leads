/**
 * Alias-Namen der Agenten.
 * Am Telefon stellen sich Agenten mit einem Alias vor („David Pfeil“), der Dialer meldet den echten Namen („Emre Demir“).
 * Beide müssen eins werden – in der Gesprächsliste, in der Bestenliste und rückwirkend bei allen alten Gesprächen, die noch unter dem
 * Alias laufen.
 *
 * So entsteht die Zuordnung:
 *  - gelernt: aus Gesprächen, bei denen der Dialer den echten Namen meldet UND der Agent sich im Gespräch mit einem anderen Namen vorstellt;
 *  - von Hand: in den Einstellungen eingetragen – das gilt immer vor dem Gelernten. Ein Eintrag ohne echten Namen heißt: „kein Alias“.
 * Ohne Datenbank: Server, Vorschau und Tests nutzen dieselbe Rechnung.
 */
import { isJunkAgentName, sameAgentName } from "./agent-names";

export type AgentAlias = { alias: string; name: string; source: "gelernt" | "manuell"; calls?: number };
/** Ein Paar aus den Gesprächen: echter Name laut Dialer, Name der Vorstellung im Gespräch, Zahl der Gespräche. */
export type AliasPair = { name: string; alias: string; calls: number };

const tidy = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
/** Schlüssel zum Vergleichen: ohne Groß-/Kleinschreibung und Akzente. */
export const aliasKey = (name: string) => tidy(name).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fullName = (name: string) => tidy(name).split(" ").length >= 2;
const distance = (a: string, b: string) => { const row = Array.from({ length: b.length + 1 }, (_, index) => index); for (let i = 1; i <= a.length; i += 1) { let previous = row[0]; row[0] = i; for (let j = 1; j <= b.length; j += 1) { const keep = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = keep; } } return row[b.length]; };
/**
 * Dieselbe Person, nur anders geschrieben („Emre Demir“ / „Emre Demier“)? Bewusst streng: Ein Alias darf dem echten Namen ähneln
 * („Derya Bekar“ nennt sich „Maja Becker“) – deshalb müssen Vor- UND Nachname fast gleich sein.
 */
export function sameSpelling(a: string, b: string): boolean {
  const partsA = aliasKey(a).split(" ").filter(Boolean); const partsB = aliasKey(b).split(" ").filter(Boolean); if (!partsA.length || !partsB.length) return false;
  if (partsA.join(" ") === partsB.join(" ")) return true;
  if (partsA.length < 2 || partsB.length < 2) return false;
  return distance(partsA[0], partsB[0]) <= 1 && distance(partsA[partsA.length - 1], partsB[partsB.length - 1]) <= 1;
}

/** Gespeicherte Liste lesen (aus der Datenbank kommt beliebiges JSON). */
export function readAliases(value: unknown): AgentAlias[] {
  if (!Array.isArray(value)) return [];
  const out: AgentAlias[] = []; const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue; const raw = item as Record<string, unknown>;
    const alias = tidy(raw.alias); const key = aliasKey(alias); if (!alias || seen.has(key)) continue; seen.add(key);
    out.push({ alias, name: tidy(raw.name), source: raw.source === "manuell" ? "manuell" : "gelernt", ...(Number(raw.calls) > 0 ? { calls: Math.round(Number(raw.calls)) } : {}) });
  }
  return out;
}

/**
 * Aus den Paaren lernen. Ein Alias gilt, wenn
 *  - er ein ganzer Name ist (Vor- und Nachname) und kein Füllwort,
 *  - er nicht nur eine andere Schreibweise des echten Namens ist,
 *  - er klar zu EINEM echten Namen gehört (mindestens 60 % seiner Gespräche) und
 *  - er mindestens zweimal so fiel – oder einmal, wenn es unter diesem Namen schon ältere Gespräche gibt (`spoken`).
 * `real`: die echten Namen (laut Dialer) – ein echter Name ist nie der Alias eines anderen.
 */
export function learnAliases(pairs: AliasPair[], options: { spoken?: string[]; real?: string[] } = {}): AgentAlias[] {
  const spoken = (options.spoken ?? []).map(tidy).filter(Boolean); const real = (options.real ?? pairs.map((pair) => pair.name)).map(tidy).filter(Boolean);
  const byAlias = new Map<string, { alias: string; total: number; names: Map<string, { name: string; calls: number }> }>();
  for (const pair of pairs) {
    const name = tidy(pair.name); const alias = tidy(pair.alias); const calls = Math.max(0, Math.round(Number(pair.calls) || 0));
    if (!name || !alias || !calls || isJunkAgentName(alias) || !fullName(alias) || sameSpelling(name, alias)) continue;
    if (real.some((other) => sameSpelling(other, alias))) continue; // so heißt wirklich jemand (ein Kollege wurde im Gespräch genannt)
    const key = aliasKey(alias); const entry = byAlias.get(key) ?? { alias, total: 0, names: new Map() };
    const nameKeyOf = aliasKey(name); const known = entry.names.get(nameKeyOf) ?? { name, calls: 0 }; known.calls += calls; entry.names.set(nameKeyOf, known); entry.total += calls; byAlias.set(key, entry);
  }
  const out: AgentAlias[] = [];
  for (const entry of Array.from(byAlias.values())) {
    const best = Array.from(entry.names.values()).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name, "de"))[0]; if (!best) continue;
    const familiar = spoken.some((item) => aliasKey(item) === aliasKey(entry.alias) || sameAgentName(item, entry.alias));
    if (best.calls / entry.total < 0.6 || (best.calls < 2 && !familiar)) continue;
    out.push({ alias: entry.alias, name: best.name, source: "gelernt", calls: best.calls });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "de") || a.alias.localeCompare(b.alias, "de"));
}

/** Gespeichertes und Gelerntes zusammenführen: von Hand Eingetragenes gilt immer; Gelerntes wird durch den neuen Stand ersetzt. */
export function mergeAliases(stored: AgentAlias[], learned: AgentAlias[]): AgentAlias[] {
  const manual = stored.filter((item) => item.source === "manuell"); const taken = new Set(manual.map((item) => aliasKey(item.alias)));
  const kept = stored.filter((item) => item.source === "gelernt" && !taken.has(aliasKey(item.alias)) && !learned.some((fresh) => aliasKey(fresh.alias) === aliasKey(item.alias))); // einmal Gelerntes bleibt, auch wenn die Belege später fehlen (Gespräche gelöscht)
  return [...manual, ...learned.filter((item) => !taken.has(aliasKey(item.alias))), ...kept].sort((a, b) => (a.name || "￿").localeCompare(b.name || "￿", "de") || a.alias.localeCompare(b.alias, "de"));
}

/** Echter Name zu einem Namen aus dem Gespräch – oder null, wenn er kein (gültiger) Alias ist. */
export function resolveAlias(name: string | null | undefined, aliases: AgentAlias[]): string | null {
  const clean = tidy(name); if (!clean) return null; const key = aliasKey(clean);
  const exact = aliases.find((item) => aliasKey(item.alias) === key); if (exact) return exact.name || null; // „kein Alias“ (leerer Name) gilt auch für ähnliche Schreibweisen nicht weiter
  const similar = aliases.filter((item) => item.name && fullName(item.alias) && fullName(clean) && sameAgentName(item.alias, clean));
  const names = Array.from(new Set(similar.map((item) => aliasKey(item.name))));
  return names.length === 1 ? similar[0].name : null; // nur eindeutig
}

/** Alle Alias-Namen eines echten Namens – für die Anzeige („am Telefon: David Pfeil“). */
export function aliasesOf(name: string | null | undefined, aliases: AgentAlias[]): string[] {
  const key = aliasKey(tidy(name)); if (!key) return [];
  return aliases.filter((item) => item.name && aliasKey(item.name) === key).map((item) => item.alias);
}

/** Eintrag von Hand prüfen: Alias und echter Name müssen ganze, verschiedene Namen sein. Liefert die Fehlermeldung oder null. */
export function aliasProblem(alias: string, name: string): string | null {
  const a = tidy(alias); const n = tidy(name);
  if (a.length < 3) return "Bitte den Namen eintragen, den der Agent am Telefon nennt.";
  if (n.length < 3) return "Bitte den echten Namen des Agenten eintragen.";
  if (aliasKey(a) === aliasKey(n)) return "Alias und echter Name sind gleich.";
  return null;
}
export const tidyAgentName = tidy;
