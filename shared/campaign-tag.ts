/**
 * Lead-Kategorie einer E-Mail-Kampagne als kurzer Text für Auswahllisten und Filter: „☀️♨️ Photovoltaik & Wärmepumpe · Individueller Ansatz“.
 * In Listen, in denen nur Text geht (Auswahlfelder, Filter), steht die Kategorie immer mit – so lassen sich gleich benannte Kampagnen
 * verschiedener Kategorien („Individueller Ansatz“ für Alarmanlagen, für Hausnotruf …) auseinanderhalten. Das Emoji ist dasselbe wie am
 * Schild der Kampagne: das der gewählten Lead-Kategorien (höchstens zwei), sonst passend zum Namen der Sparte. Server, Chat-Demo und
 * Oberfläche nutzen dieselbe Funktion.
 */
import { categoryEmoji, suggestCategoryEmoji } from "./category-emoji";
import { audienceLists } from "./email-campaigns";
import { sparteOf } from "./lead-sparte";

export type TagCampaign = { name: string; leadSparte?: string | null; leadCategoryIds?: unknown; audience?: unknown };
const idsOf = (value: unknown): number[] => Array.isArray(value) ? Array.from(new Set(value.map(Number).filter((id) => Number.isFinite(id) && id > 0))) : [];
export type TagCategory = { id: number; name: string; emoji?: string | null };
export type CampaignTag = { label: string; emoji: string; source: "eingetragen" | "erkannt" | "standard" };

/** Kategorie-Schild einer Kampagne: Name der Leadsparte (= Lead-Kategorie) und Emoji. */
export function campaignTag(campaign: TagCampaign, categories: TagCategory[] = []): CampaignTag {
  const audience = (campaign.audience ?? null) as { source?: string; listName?: string | null; listNames?: string[] | null } | null;
  const sparte = sparteOf(campaign, audienceLists(audience));
  const chosen = idsOf(campaign.leadCategoryIds).map((id) => categories.find((row) => row.id === id)).filter((row): row is TagCategory => Boolean(row)).map((row) => categoryEmoji(row));
  const emoji = chosen.length ? Array.from(new Set(chosen)).slice(0, 2).join("") : /photovoltaik|solar|\bpv\b/i.test(sparte.label) && /wärmepumpe|waermepumpe/i.test(sparte.label) ? "☀️♨️" : suggestCategoryEmoji(sparte.label);
  return { label: sparte.label, emoji, source: sparte.source };
}
/** Eine Zeile für Auswahllisten: „☀️♨️ Photovoltaik & Wärmepumpe · Name der Kampagne“ (ohne Schild nur der Name). */
export const campaignOptionText = (tag: Pick<CampaignTag, "label" | "emoji"> | null | undefined, name: string): string => tag ? `${tag.emoji ? `${tag.emoji} ` : ""}${tag.label} · ${name}` : name;
/** Reihenfolge in Auswahllisten: erst Lead-Kategorie A–Z, dann Name der Kampagne. */
export function byCategoryThenName<T extends { name: string; tag?: Pick<CampaignTag, "label"> | null }>(a: T, b: T): number {
  return (a.tag?.label ?? "").localeCompare(b.tag?.label ?? "", "de") || a.name.localeCompare(b.name, "de");
}
