/**
 * Statistik „Integrationen“ – was aus den gelieferten Leads beim Partner wurde.
 *
 * Zwei Mengen je Partnerkonto: unsere Zustellungen (ein Push eines Leads an das Konto) und die Transaktionen des Partners
 * (sein Datensatz zum Lead: Status, Provision, Zeitpunkte). Daraus entstehen je Konto acht Kennzahlen in zwei Blöcken
 * („Zustellung“ und „Bewertung durch den Partner“), eine Zeile je Käufer und bis zu fünf Bereiche zum Aufklappen.
 *
 * Die Zeitbasis legt fest, welches Datum im Zeitraum liegen muss – und damit, welche Zustellungen überhaupt zählen:
 *  - Zustelldatum: alle Zustellungen · Transaktionsdatum: nur die mit Transaktion · Bearbeitungsdatum: nur entschiedene · Auszahlungsdatum: nur ausgezahlte.
 * Maßgeblich ist immer der Stand der Transaktion von heute. Bewusst ohne Datenbank: Server, Vorschau und Tests rechnen gleich.
 */

export type ReportBasis = "delivery" | "transaction" | "processed" | "paid";
export const REPORT_BASES: Array<{ key: ReportBasis; label: string; note: string }> = [
  { key: "delivery", label: "Zustelldatum", note: "" },
  { key: "transaction", label: "Transaktionsdatum", note: "Gezählt werden nur Leads, zu denen der Partner im Zeitraum eine Transaktion angelegt hat. Abgelehnte und Leads ohne Rückmeldung fehlen deshalb." },
  { key: "processed", label: "Bearbeitungsdatum", note: "Gezählt werden nur Leads, die der Partner im Zeitraum entschieden hat (anerkannt oder storniert). Offene fehlen deshalb." },
  { key: "paid", label: "Auszahlungsdatum (Gutschrift)", note: "Gezählt werden nur Leads, die der Partner im Zeitraum ausgezahlt hat. Mit dem Tag einer Gutschrift als Zeitraum ergibt das deren Inhalt." },
];
/** Wie der Status zurückkommt: „pull“ = wir rufen ab · „push“ = der Partner ruft uns auf · „none“ = noch kein Rückkanal */
export type PartnerMode = "pull" | "push" | "none";
export type PartnerProvider = "aroundhome" | "wattfox" | "leadnodes" | "enpal" | "gohighlevel";
export const PARTNER_PROVIDERS: Array<{ key: PartnerProvider; name: string; mode: PartnerMode; about: string }> = [
  { key: "aroundhome", name: "Aroundhome", mode: "pull", about: "Wir rufen den Transaktions-Export aus dem Partnerprogramm ab (Publisher-ID und Access-Token oder der komplette Export-Link)." },
  { key: "wattfox", name: "WattFox", mode: "push", about: "WattFox ruft bei jeder Statusänderung unsere Tracking-URL auf. Es gibt nichts abzurufen." },
  { key: "leadnodes", name: "Leadnodes", mode: "none", about: "Abruf per API-Token des Leadnodes-Kontos – die Anbindung folgt, sobald die Beschreibung der Schnittstelle vorliegt." },
  { key: "enpal", name: "Enpal", mode: "none", about: "Die Anbindung folgt, sobald Enpal einen Zugang zum Partner-Portal bereitstellt." },
  { key: "gohighlevel", name: "GoHighLevel", mode: "none", about: "Status aus der Pipeline eines GoHighLevel-Kontos – die Anbindung folgt." },
];
export const providerName = (provider: string): string => PARTNER_PROVIDERS.find((item) => item.key === provider)?.name ?? provider;
export const providerMode = (provider: string): PartnerMode => PARTNER_PROVIDERS.find((item) => item.key === provider)?.mode ?? "none";

export type ReportAccount = { id: number; provider: string; label: string | null; buyerName: string | null; mode: PartnerMode; hasAccess: boolean; lastSyncAt: Date | string | null; lastSyncNote: string | null; /** Kontingent (seit v378): so viele angenommene Leads je Tag, Woche oder Monat – leer = keins */ quotaAmount?: number | null; quotaPeriod?: QuotaPeriod | null };
/** Eine Zustellung: ein Lead an ein Konto (je Lead und Konto zählt die letzte). `pending` = noch kein Ergebnis. */
export type ReportDelivery = { accountId: number; leadId: number; buyerName: string; categoryId: number | null; deliveredAt: Date | string; result: "accepted" | "rejected" | "pending" };
export type ReportTransaction = {
  id: number; accountId: number; leadId: number | null; status: "open" | "confirmed" | "cancelled";
  transactionAt: Date | string | null; processedAt: Date | string | null; paidAt: Date | string | null; commission: number;
  campaignId: string | null; campaignName: string | null; partnerCategory: string | null; subId: string | null; cancelReason: string | null;
};
export type ReportLead = { id: number; publicId: string; name: string; city: string | null; categoryId: number | null };
export type ReportFilter = { from: Date; until: Date; basis: ReportBasis; categoryId?: number | null };

export type ContactStatus = "rejected" | "none" | "open" | "confirmed" | "paid" | "cancelled" | "pending";
export const CONTACT_STATUS: Record<ContactStatus, { label: string; tone: "good" | "bad" | "calm" }> = {
  rejected: { label: "PrePing abgelehnt", tone: "bad" }, none: { label: "Ohne Rückmeldung", tone: "calm" }, open: { label: "Offen", tone: "calm" },
  confirmed: { label: "Bestätigt", tone: "good" }, paid: { label: "Ausgezahlt", tone: "good" }, cancelled: { label: "Storniert", tone: "bad" }, pending: { label: "Ausstehend", tone: "calm" },
};
export const CONTACT_FILTERS: Array<{ key: "all" | ContactStatus; label: string }> = [
  { key: "all", label: "Alle" }, { key: "confirmed", label: "Nur bestätigt" }, { key: "paid", label: "Nur ausgezahlt" }, { key: "cancelled", label: "Nur storniert" },
  { key: "open", label: "Nur offen" }, { key: "none", label: "Ohne Rückmeldung" }, { key: "rejected", label: "Nur PrePing abgelehnt" },
];

export type ReportCounts = {
  delivered: number; rejected: number; accepted: number; pending: number;
  open: number; confirmed: number; paid: number; cancelled: number;
  /** Bewertet = Offen + Anerkannt + Storniert · Ohne Rückmeldung = Angenommen − Bewertet */
  rated: number; silent: number; commission: number;
};
export type ReportBuyerRow = ReportCounts & { buyerName: string };
export type ReportDirect = {
  total: number; qualified: number; cancelled: number; open: number; commission: number;
  bySub: Array<{ subId: string; total: number; qualified: number; cancelled: number; open: number }>;
  byDay: Array<{ day: string; total: number; open: number; confirmed: number; cancelled: number; paid: number; commission: number }>;
};
export type ReportCard = {
  account: ReportAccount; title: string; counts: ReportCounts;
  /** Kontingent des laufenden Tages, der laufenden Woche oder des laufenden Monats – unabhängig vom Zeitraum und von der Sparte der Seite */
  quota: ReportQuota | null;
  /** Transaktionen ohne Zustellung im Zeitraum – sie zählen in keinem Zähler; ihre Provision steckt in `counts.commission` */
  unmatched: number; unmatchedCommission: number;
  buyers: ReportBuyerRow[]; direct: ReportDirect | null;
  categories: Array<{ name: string; accepted: number; confirmed: number; cancelled: number; open: number; commission: number }>;
  campaigns: Array<{ name: string; confirmed: number; paid: number; commission: number }>;
  cancelReasons: Array<{ reason: string; count: number }>;
};

const time = (value: Date | string | null | undefined): number => (value ? (value instanceof Date ? value : new Date(value)).getTime() : NaN);
const inRange = (value: Date | string | null | undefined, filter: ReportFilter): boolean => { const at = time(value); return Number.isFinite(at) && at >= filter.from.getTime() && at <= filter.until.getTime(); };
const blank = (): ReportCounts => ({ delivered: 0, rejected: 0, accepted: 0, pending: 0, open: 0, confirmed: 0, paid: 0, cancelled: 0, rated: 0, silent: 0, commission: 0 });
const cents = (value: number) => Math.round(value * 100) / 100;

/** Welches Datum der Transaktion gilt für die Zeitbasis? Für Transaktionen ohne Zustellung gilt bei „Zustelldatum“ ihr Transaktionsdatum (Annahme). */
const basisDate = (tx: ReportTransaction, basis: ReportBasis) => (basis === "processed" ? tx.processedAt : basis === "paid" ? tx.paidAt : tx.transactionAt);
/** Zählt die Zustellung in der gewählten Zeitbasis? */
function counts(delivery: ReportDelivery, tx: ReportTransaction | undefined, filter: ReportFilter): boolean {
  if (filter.categoryId && delivery.categoryId !== filter.categoryId) return false;
  if (filter.basis === "delivery") return inRange(delivery.deliveredAt, filter);
  if (!tx) return false;
  if (filter.basis === "transaction") return inRange(tx.transactionAt, filter);
  if (filter.basis === "processed") return tx.status !== "open" && inRange(tx.processedAt, filter);
  return tx.status === "confirmed" && inRange(tx.paidAt, filter);
}
/** Status eines Kontakts: Ergebnis der Zustellung, dann der Stand beim Partner. */
export function contactStatus(delivery: Pick<ReportDelivery, "result">, tx: Pick<ReportTransaction, "status" | "paidAt"> | undefined): ContactStatus {
  if (delivery.result === "rejected") return "rejected"; if (delivery.result === "pending") return "pending"; if (!tx) return "none";
  return tx.status === "open" ? "open" : tx.status === "cancelled" ? "cancelled" : tx.paidAt ? "paid" : "confirmed";
}
function add(target: ReportCounts, delivery: ReportDelivery, tx: ReportTransaction | undefined) {
  target.delivered += 1;
  if (delivery.result === "rejected") { target.rejected += 1; return; }
  if (delivery.result === "pending") { target.pending += 1; return; }
  target.accepted += 1; if (!tx) return;
  if (tx.status === "open") target.open += 1;
  else if (tx.status === "cancelled") target.cancelled += 1;
  else { target.confirmed += 1; if (tx.paidAt) target.paid += 1; target.commission += tx.commission; }
}
const finish = (target: ReportCounts): ReportCounts => ({ ...target, rated: target.open + target.confirmed + target.cancelled, silent: Math.max(0, target.accepted - (target.open + target.confirmed + target.cancelled)), commission: cents(target.commission) });

/** Die Zuordnung Transaktion ↔ Zustellung: über den Lead im selben Konto. Je Lead und Konto gilt die neueste Transaktion. */
function link(deliveries: ReportDelivery[], transactions: ReportTransaction[]) {
  const key = (accountId: number, leadId: number) => `${accountId}:${leadId}`;
  const deliveryKeys = new Set(deliveries.map((row) => key(row.accountId, row.leadId)));
  const byDelivery = new Map<string, ReportTransaction>(); const loose: ReportTransaction[] = [];
  for (const tx of transactions) {
    if (tx.leadId === null || !deliveryKeys.has(key(tx.accountId, tx.leadId))) { loose.push(tx); continue; }
    const at = key(tx.accountId, tx.leadId); const known = byDelivery.get(at);
    if (!known || (time(tx.transactionAt) || 0) >= (time(known.transactionAt) || 0)) byDelivery.set(at, tx);
  }
  return { txOf: (delivery: ReportDelivery) => byDelivery.get(key(delivery.accountId, delivery.leadId)), loose };
}

/* ------------------------------------------------------------------ Kontingent (seit v378) */

/**
 * Kontingent je Partnerkonto: „900 Leads je Woche“. Gezählt wird der laufende Zeitraum (heute · Montag bis Sonntag · Kalendermonat, deutsche Zeit).
 * Auf das Kontingent zählt nur, was der Partner ANGENOMMEN hat. Was er beim Senden ablehnt, weil er den Kontakt schon hat („PrePing abgelehnt“),
 * zählt nicht – genau so viele müssen nachgeschoben werden:  noch nachschieben = Kontingent − angenommen.
 */
export type QuotaPeriod = "day" | "week" | "month";
export const QUOTA_PERIODS: Array<{ key: QuotaPeriod; label: string; now: string; until: string; each: string }> = [
  { key: "week", label: "je Woche", now: "diese Woche", until: "bis Sonntag", each: "in jeder Woche" },
  { key: "day", label: "je Tag", now: "heute", until: "heute", each: "an jedem Tag" },
  { key: "month", label: "je Monat", now: "diesen Monat", until: "bis Monatsende", each: "in jedem Monat" },
];
export const quotaPeriod = (key: string | null | undefined) => QUOTA_PERIODS.find((item) => item.key === key) ?? QUOTA_PERIODS[0];
export type ReportQuota = {
  amount: number; period: QuotaPeriod;
  /** der laufende Zeitraum, beide Tage eingeschlossen (JJJJ-MM-TT) */
  from: string; to: string;
  /** an den Partner geschickt · davon beim Senden abgelehnt (hatte er schon) · angenommen · noch ohne Ergebnis */
  sent: number; rejected: number; accepted: number; pending: number;
  /** noch nachschieben = Kontingent − angenommen (nie unter 0) · darüber hinaus angenommen */
  open: number; over: number;
  /** Tage, die im Zeitraum noch bleiben (heute eingeschlossen) – und wie viele Leads je Tag dafür reichen (aufgerundet) */
  daysLeft: number; perDay: number;
};
/** Der laufende Zeitraum eines Kontingents: heute, die Woche von Montag bis Sonntag oder der Kalendermonat. */
export function quotaWindow(period: QuotaPeriod, today: string): { from: string; to: string } {
  return quickRange(period === "day" ? "today" : period === "month" ? "month" : "week", today);
}
export function buildQuota(input: { accountId: number; amount: number | null | undefined; period: QuotaPeriod | null | undefined; deliveries: ReportDelivery[]; today: string }): ReportQuota | null {
  const amount = Math.floor(Number(input.amount) || 0); if (amount <= 0) return null;
  const period = quotaPeriod(input.period).key; const window = quotaWindow(period, input.today);
  const from = berlinBound(window.from).getTime(); const until = berlinBound(window.to, true).getTime();
  let sent = 0; let rejected = 0; let accepted = 0; let pending = 0;
  for (const delivery of input.deliveries) {
    if (delivery.accountId !== input.accountId) continue; const at = time(delivery.deliveredAt); if (!(at >= from && at <= until)) continue;
    sent += 1; if (delivery.result === "rejected") rejected += 1; else if (delivery.result === "pending") pending += 1; else accepted += 1;
  }
  const open = Math.max(0, amount - accepted); const daysLeft = Math.max(1, Math.round((Date.UTC(...dayParts(window.to)) - Date.UTC(...dayParts(input.today))) / 86_400_000) + 1);
  return { amount, period, from: window.from, to: window.to, sent, rejected, accepted, pending, open, over: Math.max(0, accepted - amount), daysLeft, perDay: open ? Math.ceil(open / daysLeft) : 0 };
}
const dayParts = (day: string): [number, number, number] => { const [y, m, d] = day.split("-").map(Number); return [y, m - 1, d]; };
/** Der Satz zur Karte: was noch fehlt – in den Worten des Nutzers („noch nachschieben“). */
export function quotaSentence(quota: ReportQuota): string {
  const word = quotaPeriod(quota.period); const leads = (count: number) => `${count.toLocaleString("de-DE")} ${count === 1 ? "Lead" : "Leads"}`;
  if (!quota.open) return quota.over ? `Kontingent erfüllt – ${leads(quota.over)} mehr angenommen als bestellt.` : `Kontingent erfüllt: ${quota.accepted.toLocaleString("de-DE")} von ${quota.amount.toLocaleString("de-DE")} angenommen.`;
  const pace = quota.period === "day" || quota.daysLeft <= 1 ? "" : ` Das sind ${quota.perDay.toLocaleString("de-DE")} am Tag ${word.until} (noch ${quota.daysLeft} Tage).`;
  const why = quota.rejected ? ` ${leads(quota.rejected)} hatte der Partner schon – ${quota.rejected === 1 ? "er zählt" : "sie zählen"} nicht.` : "";
  return `Du musst ${word.now} noch ${leads(quota.open)} nachschieben.${why}${pace}`;
}

/** Eine Karte je Partnerkonto – jedes Konto erscheint, auch mit lauter Nullen. `today` (deutscher Tag) legt den laufenden Zeitraum der Kontingente fest. */
export function buildPartnerReport(input: { accounts: ReportAccount[]; deliveries: ReportDelivery[]; transactions: ReportTransaction[]; filter: ReportFilter; today?: string }): ReportCard[] {
  const { filter } = input; const { txOf, loose } = link(input.deliveries, input.transactions); const today = input.today ?? berlinDay(new Date());
  return input.accounts.map((account) => {
    const total = blank(); const buyers = new Map<string, ReportCounts>();
    const categories = new Map<string, { name: string; accepted: number; confirmed: number; cancelled: number; open: number; commission: number }>();
    const campaigns = new Map<string, { name: string; confirmed: number; paid: number; commission: number }>(); const reasons = new Map<string, number>();
    for (const delivery of input.deliveries) {
      if (delivery.accountId !== account.id) continue; const tx = txOf(delivery); if (!counts(delivery, tx, filter)) continue;
      add(total, delivery, tx); const buyer = buyers.get(delivery.buyerName) ?? blank(); add(buyer, delivery, tx); buyers.set(delivery.buyerName, buyer);
      if (!tx || delivery.result !== "accepted") continue;
      const name = tx.partnerCategory?.trim() || "ohne Angabe"; const category = categories.get(name) ?? { name, accepted: 0, confirmed: 0, cancelled: 0, open: 0, commission: 0 };
      category.accepted += 1; if (tx.status === "open") category.open += 1; else if (tx.status === "cancelled") category.cancelled += 1; else { category.confirmed += 1; category.commission += tx.commission; } categories.set(name, category);
      if (tx.status === "confirmed") { const label = [tx.campaignId, tx.campaignName].map((part) => (part ?? "").trim()).filter(Boolean).join(" · ") || "ohne Kampagne"; const campaign = campaigns.get(label) ?? { name: label, confirmed: 0, paid: 0, commission: 0 }; campaign.confirmed += 1; if (tx.paidAt) campaign.paid += 1; campaign.commission += tx.commission; campaigns.set(label, campaign); }
      if (tx.status === "cancelled") { const reason = tx.cancelReason?.trim() || "ohne Angabe"; reasons.set(reason, (reasons.get(reason) ?? 0) + 1); }
    }
    // Transaktionen ohne Zustellung: Sie zählen in keinem Zähler; ihre Provision steckt in der Kachel Provision (mit Hinweiszeile)
    const direct: ReportDirect = { total: 0, qualified: 0, cancelled: 0, open: 0, commission: 0, bySub: [], byDay: [] };
    const subs = new Map<string, ReportDirect["bySub"][number]>(); const days = new Map<string, ReportDirect["byDay"][number]>();
    if (!filter.categoryId) for (const tx of loose) {
      if (tx.accountId !== account.id) continue; const date = basisDate(tx, filter.basis); if (!inRange(date, filter)) continue;
      if (filter.basis === "processed" && tx.status === "open") continue; if (filter.basis === "paid" && tx.status !== "confirmed") continue;
      direct.total += 1; const paid = tx.status === "confirmed" && Boolean(tx.paidAt);
      if (tx.status === "confirmed") { direct.qualified += 1; direct.commission += tx.commission; } else if (tx.status === "cancelled") direct.cancelled += 1; else direct.open += 1;
      if (tx.subId?.trim()) { const sub = subs.get(tx.subId.trim()) ?? { subId: tx.subId.trim(), total: 0, qualified: 0, cancelled: 0, open: 0 }; sub.total += 1; if (tx.status === "confirmed") sub.qualified += 1; else if (tx.status === "cancelled") sub.cancelled += 1; else sub.open += 1; subs.set(sub.subId, sub); }
      const dayKey = berlinDay(date!); const day = days.get(dayKey) ?? { day: dayKey, total: 0, open: 0, confirmed: 0, cancelled: 0, paid: 0, commission: 0 };
      day.total += 1; if (tx.status === "open") day.open += 1; else if (tx.status === "cancelled") day.cancelled += 1; else { if (paid) day.paid += 1; else day.confirmed += 1; day.commission += tx.commission; } days.set(dayKey, day);
    }
    direct.commission = cents(direct.commission); direct.bySub = Array.from(subs.values()).sort((a, b) => b.total - a.total || a.subId.localeCompare(b.subId, "de")); direct.byDay = Array.from(days.values()).map((day) => ({ ...day, commission: cents(day.commission) })).sort((a, b) => b.day.localeCompare(a.day));
    const done = finish(total); done.commission = cents(done.commission + direct.commission);
    return {
      account, title: `${providerName(account.provider)}${account.label?.trim() && account.label.trim().toLowerCase() !== providerName(account.provider).toLowerCase() ? ` (${account.label.trim()})` : ""}`, counts: done, unmatched: direct.total, unmatchedCommission: direct.commission,
      quota: buildQuota({ accountId: account.id, amount: account.quotaAmount, period: account.quotaPeriod, deliveries: input.deliveries, today }),
      buyers: Array.from(buyers, ([buyerName, row]) => ({ buyerName, ...finish(row) })).sort((a, b) => b.delivered - a.delivered || a.buyerName.localeCompare(b.buyerName, "de")),
      direct: direct.total ? direct : null,
      categories: Array.from(categories.values()).map((row) => ({ ...row, commission: cents(row.commission) })).sort((a, b) => b.accepted - a.accepted || a.name.localeCompare(b.name, "de")),
      campaigns: Array.from(campaigns.values()).map((row) => ({ ...row, commission: cents(row.commission) })).sort((a, b) => b.confirmed - a.confirmed || a.name.localeCompare(b.name, "de")),
      cancelReasons: Array.from(reasons, ([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, "de")),
    };
  });
}

export type ContactRow = { leadId: number; publicId: string; name: string; city: string | null; categoryId: number | null; buyerName: string; deliveredAt: string; status: ContactStatus; cancelReason: string | null; commission: number | null };
/** Kontakte eines Kontos: folgen den Filtern der Seite; Statusfilter und Suche (Name, Ort, Lead-Nummer) laufen über alle Zeilen, geladen wird in Portionen. */
export function listPartnerContacts(input: { accountId: number; deliveries: ReportDelivery[]; transactions: ReportTransaction[]; leads: ReportLead[]; filter: ReportFilter; status?: "all" | ContactStatus; search?: string; offset?: number; limit?: number }): { total: number; rows: ContactRow[] } {
  const { txOf } = link(input.deliveries, input.transactions); const leadById = new Map(input.leads.map((lead) => [lead.id, lead]));
  const words = (input.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const rows: ContactRow[] = [];
  for (const delivery of input.deliveries) {
    if (delivery.accountId !== input.accountId) continue; const tx = txOf(delivery); if (!counts(delivery, tx, input.filter)) continue;
    const status = contactStatus(delivery, tx); if (input.status && input.status !== "all" && status !== input.status) continue;
    const lead = leadById.get(delivery.leadId); const name = lead?.name || "Name unbekannt"; const publicId = lead?.publicId ?? String(delivery.leadId);
    if (words.length && !words.every((word) => `${name} ${lead?.city ?? ""} ${publicId} ${delivery.leadId}`.toLowerCase().includes(word))) continue;
    rows.push({ leadId: delivery.leadId, publicId, name, city: lead?.city ?? null, categoryId: delivery.categoryId, buyerName: delivery.buyerName, deliveredAt: new Date(time(delivery.deliveredAt)).toISOString(), status, cancelReason: tx?.status === "cancelled" ? tx.cancelReason?.trim() || null : null, commission: tx?.status === "confirmed" ? tx.commission : null });
  }
  rows.sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt) || b.leadId - a.leadId);
  const offset = Math.max(0, input.offset ?? 0); const limit = Math.min(5000, Math.max(1, input.limit ?? 50));
  return { total: rows.length, rows: rows.slice(offset, offset + limit) };
}

/* ------------------------------------------------------------------ Darstellung: Quoten, Geld, Zeitraum */

/** Anteil mit einer Nachkommastelle und deutschem Komma („16,7 %“). Nenner 0 → Gedankenstrich. */
export const share = (part: number, whole: number): string => (whole > 0 ? `${((Math.round((part / whole) * 1000) / 10)).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %` : "—");
export const euro = (value: number): string => `${value.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Tag in deutscher Zeit als JJJJ-MM-TT. */
export function berlinDay(value: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value instanceof Date ? value : new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ""; return `${get("year")}-${get("month")}-${get("day")}`;
}
const addDays = (day: string, count: number): string => { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + count)).toISOString().slice(0, 10); };
/** Beginn (oder Ende) eines Tages in deutscher Zeit als Zeitpunkt – Sommer- und Winterzeit zählen mit. */
export function berlinBound(day: string, end = false): Date {
  const [y, m, d] = day.split("-").map(Number); const guess = Date.UTC(y, m - 1, d, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  const offset = (at: number) => { const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(at)); const get = (type: string) => Number(parts.find((part) => part.type === type)?.value); return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second")) - Math.floor(at / 1000) * 1000; };
  return new Date(guess - offset(guess - offset(guess)));
}
export const isDay = (value: string | null | undefined): value is string => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());

export type QuickRange = "today" | "yesterday" | "last7" | "last30" | "week" | "lastWeek" | "month" | "lastMonth" | "max";
export const QUICK_RANGES: Array<{ key: QuickRange; label: string }> = [
  { key: "today", label: "Heute" }, { key: "yesterday", label: "Gestern" }, { key: "last7", label: "Letzte 7 Tage" }, { key: "last30", label: "Letzte 30 Tage" },
  { key: "week", label: "Diese Woche" }, { key: "lastWeek", label: "Letzte Woche" }, { key: "month", label: "Dieser Monat" }, { key: "lastMonth", label: "Letzter Monat" }, { key: "max", label: "Maximal" },
];
/** Schnellwahl → Von und Bis (beide Tage eingeschlossen). Wochen laufen von Montag bis Sonntag, Monate über den ganzen Kalendermonat. */
export function quickRange(key: QuickRange, today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number); const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; const monday = addDays(today, -weekday);
  const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10); const monthStart = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  switch (key) {
    case "today": return { from: today, to: today };
    case "yesterday": return { from: addDays(today, -1), to: addDays(today, -1) };
    case "last7": return { from: addDays(today, -6), to: today };
    case "last30": return { from: addDays(today, -29), to: today };
    case "week": return { from: monday, to: addDays(monday, 6) };
    case "lastWeek": return { from: addDays(monday, -7), to: addDays(monday, -1) };
    case "month": return { from: monthStart(y, m), to: monthEnd(y, m) };
    case "lastMonth": return { from: monthStart(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1), to: monthEnd(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1) };
    default: return { from: "2020-01-01", to: today };
  }
}
export const activeQuickRange = (from: string, to: string, today: string): QuickRange | null => QUICK_RANGES.find((item) => { const range = quickRange(item.key, today); return range.from === from && range.to === to; })?.key ?? null;
