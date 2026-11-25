/**
 * Lead-Seite (seit Version 366/367): der Weg des Leads in vier Schritten und was er wirtschaftlich gebracht hat.
 *
 *   Eingegangen → Geprüft → Ausgeliefert → Nach dem Verkauf (Reklamationsfenster, Reklamation oder fest verkauft)
 *
 * Jeder Schritt hat einen Zustand: erledigt („done“), läuft gerade („current“), Achtung („warn“), gescheitert („fail“) oder noch offen („todo“).
 */
export type JourneyState = "done" | "current" | "warn" | "fail" | "todo";
/** progress: nur beim Reklamationsfenster – wie viel der Frist schon um ist (0 bis 1) */
export type JourneyStep = { key: "eingang" | "pruefung" | "auslieferung" | "nachher"; title: string; detail: string; state: JourneyState; at: Date | null; progress?: number };

type DeliveryLike = { buyerName: string; result: string; unitPrice: string | number | null; occurredAt: Date | string; inWindow?: boolean; windowEndsAt?: Date | string | null; skipReason?: string | null };
type ClaimLike = { reason: string; status: string; refundAmount: string | number | null; createdAt: Date | string; dueAt?: Date | string | null };
type CallLike = { decision: string | null; score: number | null; at: Date | string | null } | null;

const two = (value: number) => String(value).padStart(2, "0");
/** „21.11., 18:13“ */
export function shortStamp(value: Date | string | null | undefined): string {
  if (!value) return "–"; const date = new Date(value); if (Number.isNaN(date.getTime())) return "–";
  return `${two(date.getDate())}.${two(date.getMonth() + 1)}., ${two(date.getHours())}:${two(date.getMinutes())}`;
}
const euro = (value: number) => `${value.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const sold = (delivery: DeliveryLike) => delivery.result === "angenommen" || delivery.result === "angeboten";

/** Seit wann der Lead da ist: „vor 12 Min.“, „vor 5 Std.“, „vor 3 Tagen“, älter als 30 Tage das Datum */
export function sinceText(value: Date | string | null | undefined, now: Date = new Date()): string {
  if (!value) return "–"; const date = new Date(value); const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (Number.isNaN(minutes)) return "–";
  if (minutes < 1) return "gerade eben"; if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24); if (days <= 30) return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
  return `am ${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export function leadJourney(input: { status: string; createdAt: Date | string; supplierName?: string | null; call: CallLike; deliveries: DeliveryLike[]; claims: ClaimLike[] }, now: Date = new Date()): JourneyStep[] {
  const steps: JourneyStep[] = [];
  steps.push({ key: "eingang", title: "Eingegangen", detail: [shortStamp(input.createdAt), input.supplierName ? `von ${input.supplierName}` : ""].filter(Boolean).join(" · "), state: "done", at: new Date(input.createdAt) });

  const call = input.call; const status = input.status;
  // Auslieferungen (neueste zuerst): die neueste angenommene – sonst die neueste angebotene („wartet auf Übergabe“) – und die neueste abgelehnte
  const sales = input.deliveries.filter(sold); const accepted = sales.filter((sale) => sale.result === "angenommen");
  const delivered = accepted[0] ?? sales[0] ?? null; const offeredOnly = !accepted.length && delivered ? delivered : null;
  const refused = input.deliveries.find((delivery) => delivery.result === "abgelehnt") ?? null;

  // Prüfung: Gespräch (wenn es eins gibt), sonst der Status des Leads. Ein schon ausgelieferter Lead ist nicht mehr „in Prüfung“.
  const check: JourneyStep = { key: "pruefung", title: "Geprüft", detail: "freigegeben", state: "done", at: call?.at ? new Date(call.at) : null };
  if (status === "fehlerhaft") Object.assign(check, { title: "Fehlerhaft", detail: "Angaben ungültig – unter „API-Fehler“ korrigieren", state: "fail" });
  else if (status === "deaktiviert") Object.assign(check, { title: "Deaktiviert", detail: "geht nicht mehr raus", state: "fail" });
  else if (call && call.decision === "zurueckgewiesen") Object.assign(check, { title: "Zurückgewiesen", detail: typeof call.score === "number" ? `Gespräch ${call.score} Punkte` : "im Gespräch", state: "fail" });
  else if (call && call.decision === "pruefen") Object.assign(check, { title: "Zur Prüfung", detail: typeof call.score === "number" ? `Gespräch ${call.score} Punkte – bitte anhören` : "Gespräch bitte anhören", state: "warn" });
  else if (call && call.decision === "freigegeben") check.detail = typeof call.score === "number" ? `Gespräch ${call.score} von 100 Punkten` : "im Gespräch freigegeben";
  else if (status === "neu" && !delivered) Object.assign(check, { title: "Wird geprüft", detail: "noch nicht freigegeben", state: "current" });
  else if (status === "neu") check.detail = "direkt ausgeliefert";
  steps.push(check);

  // Auslieferung: angenommen/angeboten; sonst abgelehnt, hängend, bereit oder (ohne Auslieferung) einem Käufer zugeordnet
  const otherBuyers = new Set(sales.map((sale) => sale.buyerName).filter((name) => name !== delivered?.buyerName)).size;
  if (offeredOnly) steps.push({ key: "auslieferung", title: "Angeboten", detail: `an ${offeredOnly.buyerName}${otherBuyers ? ` +${otherBuyers}` : ""} · wartet auf Übergabe`, state: "current", at: new Date(offeredOnly.occurredAt) });
  else if (delivered) steps.push({ key: "auslieferung", title: "Ausgeliefert", detail: `an ${delivered.buyerName}${otherBuyers ? ` +${otherBuyers}` : ""} · ${shortStamp(delivered.occurredAt)}`, state: "done", at: new Date(delivered.occurredAt) });
  else if (refused) steps.push({ key: "auslieferung", title: "Abgelehnt", detail: `${refused.buyerName}${refused.skipReason ? `: ${refused.skipReason}` : ""}`, state: "fail", at: new Date(refused.occurredAt) });
  else if (status === "hängend") steps.push({ key: "auslieferung", title: "Hängend", detail: "wartet auf Liefertag oder Lieferkette", state: "warn", at: null });
  else if (status === "genehmigt") steps.push({ key: "auslieferung", title: "Bereit zum Ausliefern", detail: "wartet auf einen Käufer", state: "current", at: null });
  else if (status === "zugewiesen" || status === "reklamiert") steps.push({ key: "auslieferung", title: "Zugewiesen", detail: "einem Käufer zugeordnet", state: "done", at: null });
  else steps.push({ key: "auslieferung", title: "Ausliefern", detail: status === "deaktiviert" ? "entfällt" : status === "fehlerhaft" ? "erst nach der Korrektur" : "noch nicht ausgeliefert", state: "todo", at: null });

  // Nach dem Verkauf: Reklamation, Reklamationsfenster (das, das zuletzt endet) oder fest verkauft
  const claim = input.claims[0] ?? null;
  const open = accepted.filter((sale) => sale.inWindow && sale.windowEndsAt).sort((a, b) => new Date(b.windowEndsAt!).getTime() - new Date(a.windowEndsAt!).getTime())[0] ?? null;
  if (claim) {
    const refund = Number(claim.refundAmount ?? 0);
    if (claim.status === "genehmigt") steps.push({ key: "nachher", title: "Reklamiert", detail: `${claim.reason}${refund > 0 ? ` · ${euro(refund)} erstattet` : ""}`, state: "fail", at: new Date(claim.createdAt) });
    else if (claim.status === "abgelehnt") steps.push({ key: "nachher", title: "Reklamation abgelehnt", detail: claim.reason, state: "done", at: new Date(claim.createdAt) });
    else steps.push({ key: "nachher", title: "Reklamation offen", detail: `${claim.reason}${claim.dueAt ? ` · Frist ${shortStamp(claim.dueAt).split(",")[0]}` : ""}`, state: "warn", at: new Date(claim.createdAt) });
  } else if (status === "reklamiert") steps.push({ key: "nachher", title: "Reklamiert", detail: "Reklamation genehmigt", state: "fail", at: null });
  else if (open) {
    const ends = new Date(open.windowEndsAt!).getTime(); const start = new Date(open.occurredAt).getTime();
    const hours = Math.max(0, Math.ceil((ends - now.getTime()) / 3_600_000));
    const progress = ends > start ? Math.min(1, Math.max(0, (now.getTime() - start) / (ends - start))) : undefined;
    steps.push({ key: "nachher", title: "Reklamationsfenster", detail: `bis ${shortStamp(open.windowEndsAt)}${hours ? ` · noch ${hours < 48 ? `${hours} Std.` : `${Math.round(hours / 24)} Tage`}` : ""}`, state: "current", at: null, ...(progress === undefined ? {} : { progress }) });
  } else if (accepted.length) steps.push({ key: "nachher", title: "Fest verkauft", detail: "ohne Reklamation", state: "done", at: null });
  else steps.push({ key: "nachher", title: "Nach dem Verkauf", detail: "Reklamationsfenster nach der Auslieferung", state: "todo", at: null });
  return steps;
}

/** Was der Lead gebracht hat: Einkauf (Preis beim Lieferanten), Verkauf (angenommene/angebotene Auslieferungen), Erstattungen, Marge */
export function leadMoney(cost: string | number | null | undefined, deliveries: DeliveryLike[], claims: ClaimLike[]) {
  const bought = Number(cost ?? 0) || 0;
  const sales = deliveries.filter(sold);
  const soldFor = sales.reduce((sum, delivery) => sum + (Number(delivery.unitPrice ?? 0) || 0), 0);
  const refunded = claims.filter((claim) => claim.status === "genehmigt").reduce((sum, claim) => sum + (Number(claim.refundAmount ?? 0) || 0), 0);
  const margin = soldFor - refunded - bought;
  return { bought, sold: soldFor, refunded, margin, buyers: new Set(sales.map((delivery) => delivery.buyerName)).size, marginShare: soldFor > 0 ? Math.round((margin / soldFor) * 100) : null };
}
