/**
 * v385: Lehnt ein Käufer einen Lead als Dublette ab (er kennt den Kontakt schon), wird der Lead als „Dublette bei <Käufer>“ markiert:
 * Reiter „Dubletten“, Hinweis an der Zeile, Eintrag im Lead-Log. Erkannt an HTTP 409 oder an Wörtern in der Antwort (Wattfox und andere).
 */
export const PARTNER_DUPLICATE_PATTERN = /dublett|duplikat|duplicate|doppelt|bereits (vorhanden|existiert|eingetragen|erfasst|im system|bekannt|gemeldet)|existiert bereits|schon (vorhanden|bekannt)|already (exists|registered|known|in)/i;
export function isPartnerDuplicate(status: number | null | undefined, body: string | null | undefined): boolean {
  return status === 409 || PARTNER_DUPLICATE_PATTERN.test(body ?? "");
}
export type PartnerDuplicateMark = { buyerName: string; at: string; status: number | null; message: string };
export function partnerDuplicateOf(metadata: unknown): PartnerDuplicateMark | null {
  const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  const mark = meta.partnerDuplicate; if (!mark || typeof mark !== "object" || Array.isArray(mark)) return null;
  const value = mark as Record<string, unknown>; return typeof value.buyerName === "string" ? { buyerName: value.buyerName, at: String(value.at ?? ""), status: typeof value.status === "number" ? value.status : null, message: String(value.message ?? "") } : null;
}
