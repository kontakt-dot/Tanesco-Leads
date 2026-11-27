/**
 * Reklamationen: Worte, Zahlen und Fristen an einer Stelle – damit Liste, Zahlenleiste, CSV und Vorschau dasselbe meinen.
 * „Wartet“ heißt: offen oder in Prüfung, also noch nicht entschieden. „Überfällig“: wartet und die Prüffrist ist vorbei.
 */
import { daysBetween } from "./call-period";

export type ClaimStatusKey = "offen" | "in_prüfung" | "genehmigt" | "abgelehnt";
export const CLAIM_STATUS: Array<[ClaimStatusKey, string]> = [["offen", "Offen"], ["in_prüfung", "In Prüfung"], ["genehmigt", "Genehmigt"], ["abgelehnt", "Abgelehnt"]];
export const claimStatusLabel = (status: string) => CLAIM_STATUS.find(([key]) => key === status)?.[1] ?? status;
/** Farbe trägt nur „hier ist etwas zu tun“: offen = bernstein, in Prüfung = blau. Entschiedenes bleibt ruhig (Haken bzw. Kreuz). */
export type ClaimTone = "open" | "check" | "yes" | "no";
export const claimTone = (status: string): ClaimTone => status === "genehmigt" ? "yes" : status === "abgelehnt" ? "no" : status === "in_prüfung" ? "check" : "open";
const EVENT_LABEL: Record<string, string> = { erstellt: "Erfasst", frist_gesetzt: "Frist gesetzt", status_geändert: "Status geändert", entschieden: "Entschieden", notiz: "Notiz" };
export const claimEventLabel = (eventType: string) => EVENT_LABEL[eventType] ?? eventType.replaceAll("_", " ");

type Stamp = Date | string | null | undefined;
const asDate = (value: Stamp) => value ? new Date(value) : null;
const berlinDay = (value: Date) => value.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
const dmy = (day: string) => { const [y, m, d] = day.split("-"); return `${d}.${m}.${y}`; };
/** Datum in deutscher Schreibweise (deutsche Zeit) – leer, wenn es keines gibt. */
export const claimDay = (value: Stamp) => { const date = asDate(value); return date ? dmy(berlinDay(date)) : ""; };

export type ClaimDeadline = {
  /** done = entschieden · none = keine Frist · ok = Zeit genug · soon = heute, morgen oder übermorgen · late = Frist vorbei */
  tone: "done" | "none" | "ok" | "soon" | "late";
  text: string;
};
/** Die Prüffrist in Worten: „noch 4 Tage“, „bis morgen“, „heute fällig“, „seit 2 Tagen überfällig“ – oder wann entschieden wurde. */
export function claimDeadline(claim: { dueAt?: Stamp; resolvedAt?: Stamp }, now = new Date()): ClaimDeadline {
  const resolved = asDate(claim.resolvedAt); if (resolved) return { tone: "done", text: `entschieden am ${dmy(berlinDay(resolved))}` };
  const due = asDate(claim.dueAt); if (!due) return { tone: "none", text: "ohne Frist" };
  const diff = daysBetween(berlinDay(now), berlinDay(due));
  if (due.getTime() < now.getTime()) return { tone: "late", text: diff === 0 ? "seit heute überfällig" : diff === -1 ? "seit gestern überfällig" : `seit ${-diff} Tagen überfällig` };
  if (diff <= 0) return { tone: "soon", text: "heute fällig" };
  if (diff === 1) return { tone: "soon", text: "bis morgen" };
  return { tone: diff === 2 ? "soon" : "ok", text: `noch ${diff} Tage` };
}

export type ClaimCounts = {
  alle: number; offen: number; in_prüfung: number; genehmigt: number; abgelehnt: number;
  /** offen + in Prüfung */ wartend: number;
  /** wartend und Frist vorbei */ überfällig: number;
  /** genehmigt + abgelehnt */ entschieden: number;
  /** Anteil genehmigt an allen entschiedenen, in Prozent – null, solange nichts entschieden ist */ genehmigtQuote: number | null;
};
export function claimCounts(claims: ReadonlyArray<{ status: string; dueAt?: Stamp; resolvedAt?: Stamp }>, now = new Date()): ClaimCounts {
  const of = (status: ClaimStatusKey) => claims.filter((claim) => claim.status === status).length;
  const offen = of("offen"); const pruefung = of("in_prüfung"); const genehmigt = of("genehmigt"); const abgelehnt = of("abgelehnt"); const entschieden = genehmigt + abgelehnt;
  return { alle: claims.length, offen, in_prüfung: pruefung, genehmigt, abgelehnt, wartend: offen + pruefung, überfällig: claims.filter((claim) => claimDeadline(claim, now).tone === "late").length, entschieden, genehmigtQuote: entschieden ? Math.round((genehmigt / entschieden) * 100) : null };
}

export type ClaimDeliveryRow = { leadId: number; claimId: number | null; buyerName: string; unitPrice: string | number | null; result: string; occurredAt: Date | string };
/**
 * Welche Lieferung wurde reklamiert? Die, an der die Reklamation hängt. Nach einer Ablehnung ist diese Verknüpfung gelöst (die Lieferung
 * gilt wieder als angenommen) – dann die letzte Lieferung des Leads vor der Reklamation, die nicht abgelehnt oder übersprungen wurde.
 * Liegt keine davor (Zeitstempel auf die Sekunde gerundet), die früheste geltende Lieferung des Leads.
 */
export function claimedDelivery<T extends ClaimDeliveryRow>(claim: { id: number; leadId: number; createdAt: Date | string }, deliveries: readonly T[]): T | null {
  const linked = deliveries.find((row) => row.claimId === claim.id); if (linked) return linked;
  const created = new Date(claim.createdAt).getTime(); const time = (row: T) => new Date(row.occurredAt).getTime();
  const valid = deliveries.filter((row) => row.leadId === claim.leadId && (row.result === "angenommen" || row.result === "angeboten" || row.result === "reklamiert")).sort((a, b) => time(a) - time(b));
  return valid.filter((row) => time(row) <= created).pop() ?? valid[0] ?? null;
}

const LEAD_STATUS = ["neu", "genehmigt", "zugewiesen", "fehlerhaft", "deaktiviert", "hängend"] as const;
export type RestoredLeadStatus = (typeof LEAD_STATUS)[number];
/**
 * Status eines Leads, nachdem seine Reklamation abgelehnt wurde: der von vor der Reklamation (aus dem Lead-Log) – sonst „zugewiesen“,
 * wenn eine Lieferung gilt. null = nichts ändern (kein früherer Status bekannt und nie ausgeliefert).
 */
export function restoredLeadStatus(previous: string | null | undefined, delivered: boolean): RestoredLeadStatus | null {
  const known = LEAD_STATUS.find((status) => status === previous); if (known) return known;
  return delivered ? "zugewiesen" : null;
}

export type ClaimExportRow = { id: number; leadId: number; leadPublicId?: string | null; firstName?: string | null; lastName?: string | null; reason: string; status: string; buyerName?: string | null; supplierName?: string | null; refundAmount?: string | number | null; dueAt?: Stamp; createdAt: Stamp; resolvedAt?: Stamp };
/** Name des Leads einer Reklamation – „Lead ohne Namen“, wenn keiner da ist. */
export const claimLeadName = (claim: { firstName?: string | null; lastName?: string | null }) => [claim.firstName, claim.lastName].filter(Boolean).join(" ") || "Lead ohne Namen";
/** Tabelle für den CSV-Export: dieselben Reklamationen wie in der Liste, mit Lead-Nummer und Namen statt der internen Zahl. */
export function claimsTable(claims: readonly ClaimExportRow[]): { columns: string[]; rows: Array<Array<string | number>> } {
  const money = (value: string | number | null | undefined) => value === null || value === undefined || value === "" ? "" : Number(value).toFixed(2).replace(".", ",");
  return {
    columns: ["Reklamation", "Lead", "Name", "Grund", "Status", "Käufer", "Lieferant", "Erstattung in €", "Prüfen bis", "Erstellt am", "Entschieden am"],
    rows: claims.map((claim) => [`REC-${claim.id}`, claim.leadPublicId ?? `#${claim.leadId}`, [claim.firstName, claim.lastName].filter(Boolean).join(" "), claim.reason, claimStatusLabel(claim.status), claim.buyerName ?? "", claim.supplierName ?? "", money(claim.refundAmount), claimDay(claim.dueAt), claimDay(claim.createdAt), claimDay(claim.resolvedAt)]),
  };
}
