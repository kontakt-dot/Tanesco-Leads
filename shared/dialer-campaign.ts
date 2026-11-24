/**
 * Kampagnen aus dem Dialer: OnDialer & Co. schicken je Gespräch den Namen ihrer Kampagne mit („campaign“).
 * Bei uns landet das Gespräch
 *   1. in der Kampagne, der dieser Name zugeordnet ist (Gespräche → Kampagnen → „Kampagnen vom Dialer“),
 *   2. sonst in der Kampagne mit gleichem Namen (Groß/klein egal),
 *   3. sonst in der Standard-Kampagne („Neue Gespräche vom Dialer landen in“),
 *   4. sonst unter dem Namen, den der Dialer schickt.
 * Hat eine Kampagne einen eigenen Käufer („Leads gehen an“), bekommen ihre Leads nur er – andere Käufer nicht, auch wenn deren
 * Bestellung oder Lieferkette passt.
 *
 * Ohne Datenbank: Server, Vorschau und Tests nutzen dieselbe Logik.
 */

/** Vergleichsform eines Kampagnennamens: Groß/klein, doppelte Leerzeichen und Schreibvarianten egal. */
export function campaignKey(name: unknown): string {
  return String(name ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Ein Kampagnenname aus einem Feld: Text oder Zahl (auch { name: … }), höchstens 160 Zeichen – sonst null. */
export function campaignName(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") { const text = value.replace(/\s+/g, " ").trim(); return text ? text.slice(0, 160) : null; }
  if (value && typeof value === "object" && !Array.isArray(value)) { const record = value as Record<string, unknown>; const inner = record.name ?? record.title ?? record.label; return inner === value ? null : campaignName(inner); }
  return null;
}

const CAMPAIGN_FIELDS = ["campaign", "campaign_name", "campaignName", "kampagne", "kampagnenname", "kampanya", "kampanya_adi"];
const readAt = (source: unknown, path: string): unknown => path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined), source);

/** Kampagnenname aus der Meldung des Dialers: unter dem eingestellten Feld, sonst unter den üblichen Namen – auch beim Kontakt. */
export function dialerCampaignOf(payload: unknown, path = "campaign"): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const paths = [path, ...CAMPAIGN_FIELDS, ...CAMPAIGN_FIELDS.map((key) => `contact.${key}`), ...CAMPAIGN_FIELDS.map((key) => `contact.fields.${key}`)];
  for (const candidate of Array.from(new Set(paths.filter(Boolean)))) { const name = campaignName(readAt(payload, candidate)); if (name) return name; }
  return null;
}

/** Die einer Kampagne zugeordneten Namen aus dem Dialer (gespeichert als Liste) – ohne Doppelte. */
export function dialerNamesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = []; const seen = new Set<string>();
  for (const item of value) { const name = campaignName(item); const key = campaignKey(name); if (name && !seen.has(key)) { seen.add(key); out.push(name); } }
  return out;
}

export type DialerCampaignVia = "zuordnung" | "name" | "standard" | "dialer" | "keine";
export type DialerCampaignTarget = { campaign: string | null; via: DialerCampaignVia };

/** Wohin gehört ein Gespräch mit diesem Kampagnennamen vom Dialer? (Reihenfolge siehe oben) */
export function resolveDialerCampaign(dialerName: string | null | undefined, campaigns: Array<{ name: string; dialerNames?: unknown }>, defaultCampaign: string | null | undefined): DialerCampaignTarget {
  const key = campaignKey(dialerName); const fallback = String(defaultCampaign ?? "").trim() || null;
  if (key) {
    const assigned = campaigns.find((item) => dialerNamesOf(item.dialerNames).some((name) => campaignKey(name) === key));
    if (assigned) return { campaign: assigned.name, via: "zuordnung" };
    const same = campaigns.find((item) => campaignKey(item.name) === key);
    if (same) return { campaign: same.name, via: "name" };
  }
  if (fallback) return { campaign: fallback, via: "standard" };
  const own = campaignName(dialerName);
  return own ? { campaign: own, via: "dialer" } : { campaign: null, via: "keine" };
}

/** Käufer einer Kampagne: Leads aus ihr gehen nur an ihn. */
export type CampaignBuyerRule = { campaign: string; buyerUserId: number; buyerName: string };

/** Grund, warum dieser Käufer den Lead nicht bekommt – oder null, wenn er ihn bekommen darf. */
export function campaignBuyerSkip(rule: CampaignBuyerRule | null | undefined, buyerUserId: number | null | undefined): string | null {
  if (!rule) return null;
  return buyerUserId === rule.buyerUserId ? null : `Kampagne „${rule.campaign}“ liefert nur an ${rule.buyerName}`;
}

/** Das Gespräch, das für die Kampagne eines Leads zählt: das neueste freigegebene, sonst das neueste mit Kampagne. */
export function leadCampaignCall<T extends { id: number; campaign: string | null; decision?: string | null }>(calls: T[]): T | null {
  const withCampaign = calls.filter((call) => Boolean(call.campaign)).sort((a, b) => b.id - a.id);
  return withCampaign.find((call) => call.decision === "freigegeben") ?? withCampaign[0] ?? null;
}
