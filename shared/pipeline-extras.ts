/**
 * Vertriebspipeline – Erweiterungen (gemeinsam für Server, Chat-Demo und Oberfläche):
 * Wiedervorlagen/Aufgaben („Heute fällig“), eingeschlafene Karten, Termine (Kalender, ICS-Einladung),
 * Angebotswerte/Pipeline-Wert, Verteilregeln & Tagesziele, CSV-Export, SMS/WhatsApp-Vorlagen.
 */
import { lostStage, wonStage, type StageDef } from "./sales-pipeline";

/* ---------------------------------------------------------------- Aufgaben & Wiedervorlagen */
export type TaskKind = "anruf" | "email" | "termin" | "aufgabe" | "sms" | "whatsapp";
export const TASK_KINDS: Array<{ key: TaskKind; label: string; emoji: string }> = [
  { key: "anruf", label: "Anrufen", emoji: "📞" },
  { key: "email", label: "E-Mail schreiben", emoji: "✉️" },
  { key: "termin", label: "Termin", emoji: "📅" },
  { key: "aufgabe", label: "Aufgabe", emoji: "✅" },
  { key: "sms", label: "SMS senden", emoji: "💬" },
  { key: "whatsapp", label: "WhatsApp senden", emoji: "🟢" },
];
export const taskKindLabel = (kind: string | null | undefined) => TASK_KINDS.find((item) => item.key === kind)?.label ?? "Aufgabe";
export const taskKindEmoji = (kind: string | null | undefined) => TASK_KINDS.find((item) => item.key === kind)?.emoji ?? "✅";
export type TaskSource = "manuell" | "dialer" | "notiz" | "automatik" | "termin";
export type DueBucket = "ueberfaellig" | "heute" | "morgen" | "woche" | "spaeter";
export const DUE_BUCKETS: Array<{ key: DueBucket; label: string }> = [
  { key: "ueberfaellig", label: "Überfällig" },
  { key: "heute", label: "Heute" },
  { key: "morgen", label: "Morgen" },
  { key: "woche", label: "Diese Woche" },
  { key: "spaeter", label: "Später" },
];

export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
export const addDays = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
export const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** In welchen Topf eine Fälligkeit gehört (Tagesgrenzen in der lokalen Zeit des Servers/Browsers). */
export function dueBucket(dueAt: Date | string, now: Date): DueBucket {
  const due = new Date(dueAt); const today = startOfDay(now);
  if (startOfDay(due) < today) return "ueberfaellig"; // Fälligkeit an einem früheren Tag
  if (due < addDays(today, 1)) return "heute"; // heute – auch wenn die Uhrzeit schon vorbei ist
  if (due < addDays(today, 2)) return "morgen";
  if (due < addDays(today, 7)) return "woche";
  return "spaeter";
}
export function groupByDue<T extends { dueAt: Date | string }>(items: T[], now: Date): Record<DueBucket, T[]> {
  const groups: Record<DueBucket, T[]> = { ueberfaellig: [], heute: [], morgen: [], woche: [], spaeter: [] };
  for (const item of [...items].sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())) groups[dueBucket(item.dueAt, now)].push(item);
  return groups;
}
/** Standard-Fälligkeit für eine Wiedervorlage aus dem Dialer: nach X Minuten, aber frühestens am nächsten Werktag 9 Uhr, wenn es sonst nachts wäre. */
export function followUpDue(now: Date, minutes: number | null | undefined) {
  const due = new Date(now.getTime() + Math.max(15, minutes ?? 24 * 60) * 60_000);
  if (due.getHours() < 8 || due.getHours() >= 19) { const next = startOfDay(due.getHours() >= 19 ? addDays(due, 1) : due); next.setHours(9, 0, 0, 0); return skipWeekend(next); }
  return skipWeekend(due);
}
function skipWeekend(date: Date) { const copy = new Date(date); while (copy.getDay() === 0 || copy.getDay() === 6) copy.setDate(copy.getDate() + 1); return copy; }
export const formatDue = (value: Date | string, now = new Date()) => { const date = new Date(value); const bucket = dueBucket(date, now); const time = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }); if (bucket === "heute") return `heute ${time}`; if (bucket === "morgen") return `morgen ${time}`; return `${date.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })} ${time}`; };

/* ---------------------------------------------------------------- Eingeschlafene Karten */
export const DEFAULT_STALE_DAYS = 5;
export const daysBetween = (from: Date | string, to: Date) => Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / 86_400_000));
/** Letzte Aktivität an einer Karte (Stufenwechsel, Notiz, Nachricht, erledigte Aufgabe) → Tage ohne Bewegung; nur offene Stufen gelten als „eingeschlafen“. */
export function staleInfo(lead: { pipelineStage: string | null; pipelineUpdatedAt?: Date | string | null; createdAt: Date | string; lastActivityAt?: Date | string | null }, now: Date, staleDays: number, stages: StageDef[]) {
  const last = lead.lastActivityAt ?? lead.pipelineUpdatedAt ?? lead.createdAt;
  const days = daysBetween(last, now);
  const closed = lead.pipelineStage === wonStage(stages) || lead.pipelineStage === lostStage(stages);
  return { days, stale: !closed && staleDays > 0 && days >= staleDays, lastActivityAt: new Date(last) };
}

/* ---------------------------------------------------------------- Heiße Phasen (Lead-Temperatur) */
/**
 * Wie „heiß“ ist eine Karte? Aus dem, was wir über den Kontakt wissen, entsteht eine Punktzahl von 0 bis 100:
 * Kontaktdaten (Telefon, E-Mail, Firma), die Stufe in der Pipeline, wie frisch die letzte Bewegung ist, Angebotswert,
 * ein Termin, die Reaktion auf unsere E-Mails (geöffnet, geklickt, geantwortet – oder abgemeldet/unzustellbar) und das
 * letzte Anruf-Ergebnis. Ab 60 Punkten ist die Karte „Heiß“, ab 30 „Warm“, darunter „Kalt“. Kunde und Verloren
 * bekommen keine Temperatur mehr. Jede Regel steht als Satz in `reasons`, damit die Einschätzung nachvollziehbar bleibt.
 */
export type Temperature = "heiss" | "warm" | "kalt";
export const TEMPERATURE_LABEL: Record<Temperature, string> = { heiss: "Heiß", warm: "Warm", kalt: "Kalt" };
export const TEMPERATURE_HOT_FROM = 60;
export const TEMPERATURE_WARM_FROM = 30;
export type MailReaction = { opened?: boolean; clicked?: boolean; replied?: boolean; bounced?: boolean; unsubscribed?: boolean } | null | undefined;
export type ScoreInput = {
  phone?: string | null; email?: string | null; company?: string | null;
  pipelineStage: string | null; stages: StageDef[];
  dealValue?: number | string | null; appointmentAt?: Date | string | null;
  createdAt: Date | string; lastActivityAt?: Date | string | null; stale?: boolean; staleDays?: number;
  noteCount?: number; openTasks?: number;
  mail?: MailReaction; lastCallDisposition?: string | null;
};
export type LeadScore = { score: number; temperature: Temperature; label: string; reasons: string[]; closed: boolean };
const CALL_POINTS: Record<string, [number, string]> = {
  verkauft: [20, "Letzter Anruf: Verkauft / Termin"], interessiert: [15, "Letzter Anruf: Interessiert, Angebot gewünscht"], wiedervorlage: [6, "Letzter Anruf: Wiedervorlage vereinbart"],
  nicht_erreicht: [0, "Letzter Anruf: nicht erreicht"], kein_interesse: [-25, "Letzter Anruf: kein Interesse"], falsche_nummer: [-15, "Letzter Anruf: falsche Nummer"], nicht_anrufen: [-30, "Letzter Anruf: nicht mehr anrufen"],
};
export function temperatureOf(score: number): Temperature { return score >= TEMPERATURE_HOT_FROM ? "heiss" : score >= TEMPERATURE_WARM_FROM ? "warm" : "kalt"; }
export function leadScore(input: ScoreInput, now = new Date()): LeadScore {
  const stages = input.stages; const won = wonStage(stages); const lost = lostStage(stages);
  if (input.pipelineStage === won) return { score: 100, temperature: "heiss", label: "Kunde", reasons: ["Kunde geworden"], closed: true };
  if (input.pipelineStage === lost) return { score: 0, temperature: "kalt", label: "Verloren", reasons: ["Als verloren markiert"], closed: true };
  let score = 0; const reasons: string[] = [];
  const add = (points: number, reason: string) => { if (!points) { reasons.push(reason); return; } score += points; reasons.push(`${reason} (${points > 0 ? "+" : "−"}${Math.abs(points)})`); };
  // Kontaktdaten: Ohne Telefon kommt man selten weiter – deshalb zählt es am meisten.
  const kontakt = (input.phone ? 8 : 0) + (input.email ? 5 : 0) + (input.company ? 3 : 0);
  const vorhanden = [input.phone ? "Telefon" : "", input.email ? "E-Mail" : "", input.company ? "Firma" : ""].filter(Boolean);
  if (kontakt) add(kontakt, vorhanden.length === 3 ? "Telefon, E-Mail und Firma bekannt" : `${vorhanden.join(" und ")} bekannt`); else reasons.push("Weder Telefon noch E-Mail bekannt");
  // Stufe: je weiter rechts im Board, desto heißer (Eingang 0, letzte offene Stufe 30 Punkte).
  const open = stages.filter((stage) => stage.fixed !== "won" && stage.fixed !== "lost");
  const index = Math.max(0, open.findIndex((stage) => stage.key === input.pipelineStage));
  const stageDef = open[index] ?? open[0];
  const stagePoints = open.length <= 1 ? 0 : Math.round((index / (open.length - 1)) * 30);
  if (stageDef) add(stagePoints, `Stufe „${stageDef.label}“`);
  // Bewegung: frische Karten sind wärmer, eingeschlafene kühlen ab.
  const last = input.lastActivityAt ?? input.createdAt; const days = daysBetween(last, now);
  if (input.stale) add(-10, `Seit ${days} Tagen eingeschlafen`);
  else if (days <= 1) add(14, "Heute oder gestern bewegt");
  else if (days <= 3) add(8, `Vor ${days} Tagen bewegt`);
  else if (days <= 7) add(4, `Vor ${days} Tagen bewegt`);
  else reasons.push(`Seit ${days} Tagen keine Bewegung`);
  // Angebotswert und Termin
  const value = Number(input.dealValue ?? 0) || 0; if (value > 0) add(10, `Angebot über ${euro(value)}`);
  if (input.appointmentAt) { const at = new Date(input.appointmentAt); if (at >= startOfDay(now)) add(20, `Termin am ${at.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}`); else if (daysBetween(at, now) <= 30) add(8, `Termin war am ${at.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}`); }
  // E-Mail-Reaktion: die stärkste Reaktion zählt; Abmeldung oder Bounce ziehen ab.
  const mail = input.mail;
  if (mail?.unsubscribed) add(-15, "Von unseren E-Mails abgemeldet");
  else if (mail?.bounced) add(-10, "E-Mail unzustellbar");
  else if (mail?.replied) add(18, "Hat auf eine E-Mail geantwortet");
  else if (mail?.clicked) add(12, "Hat einen Link in unserer E-Mail geklickt");
  else if (mail?.opened) add(6, "Hat unsere E-Mail geöffnet");
  // Anruf-Ergebnis
  const call = input.lastCallDisposition ? CALL_POINTS[input.lastCallDisposition] : null; if (call) add(call[0], call[1]);
  // Fleiß: Notizen und geplante nächste Schritte
  if ((input.noteCount ?? 0) > 0) add(3, `${input.noteCount} ${input.noteCount === 1 ? "Notiz" : "Notizen"}`);
  if ((input.openTasks ?? 0) > 0) add(3, "Nächster Schritt ist geplant");
  score = Math.max(0, Math.min(100, score));
  const temperature = temperatureOf(score);
  return { score, temperature, label: TEMPERATURE_LABEL[temperature], reasons, closed: false };
}
/** E-Mail-Reaktion eines Kontakts aus seinen Serien-Einträgen (und Antworten im Posteingang) zusammenfassen. */
export function mailReactionOf(rows: Array<{ openedAt?: Date | string | null; clickedAt?: Date | string | null; repliedAt?: Date | string | null; bouncedAt?: Date | string | null; status?: string | null }>, replied = false): MailReaction {
  if (!rows.length && !replied) return null;
  return {
    opened: rows.some((row) => row.openedAt), clicked: rows.some((row) => row.clickedAt), replied: replied || rows.some((row) => row.repliedAt),
    bounced: rows.some((row) => row.bouncedAt || row.status === "bounce"), unsubscribed: rows.some((row) => row.status === "abgemeldet" || row.status === "beschwerde"),
  };
}

/* ---------------------------------------------------------------- Einstellungen (Automatik, Verteilung, Ziele) */
export type DistributionRule = { id: string; userId: number; postcodePrefixes: string[]; categoryIds: number[]; maxOpen: number | null };
export type DistributionRules = { mode: "aus" | "reihum" | "regeln"; rules: DistributionRule[]; fallback: "reihum" | "ohne" };
export type DailyTarget = { calls: number; appointments: number; deals: number };
export type PipelineSettings = {
  staleDays: number;
  staleCampaignId: number | null;
  stageCampaigns: Record<string, number>;
  dispositionCampaigns: Record<string, number>;
  dispositionTasks: boolean;
  replyStage: string | null;
  appointmentReminder: "aus" | "email" | "sms" | "whatsapp";
  appointmentReminderHours: number;
  distribution: DistributionRules;
  dailyTargets: Record<string, DailyTarget>;
};
export const DEFAULT_PIPELINE_SETTINGS: PipelineSettings = { staleDays: DEFAULT_STALE_DAYS, staleCampaignId: null, stageCampaigns: {}, dispositionCampaigns: {}, dispositionTasks: true, replyStage: "kontaktiert", appointmentReminder: "email", appointmentReminderHours: 24, distribution: { mode: "aus", rules: [], fallback: "reihum" }, dailyTargets: {} };
const numberOrNull = (value: unknown) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.round(number) : null; };
const numberMap = (value: unknown) => { const out: Record<string, number> = {}; if (value && typeof value === "object" && !Array.isArray(value)) for (const [key, item] of Object.entries(value as Record<string, unknown>)) { const id = numberOrNull(item); if (id) out[key] = id; } return out; };
export function normalizePipelineSettings(input: unknown): PipelineSettings {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const distributionRaw = raw.distribution && typeof raw.distribution === "object" ? (raw.distribution as Record<string, unknown>) : {};
  const rules = Array.isArray(distributionRaw.rules) ? (distributionRaw.rules as Array<Record<string, unknown>>).map((rule, index) => ({ id: String(rule.id ?? `r${index}`), userId: numberOrNull(rule.userId) ?? 0, postcodePrefixes: Array.isArray(rule.postcodePrefixes) ? (rule.postcodePrefixes as unknown[]).map((item) => String(item).replace(/\D/g, "")).filter(Boolean).slice(0, 60) : [], categoryIds: Array.isArray(rule.categoryIds) ? (rule.categoryIds as unknown[]).map(Number).filter((id) => Number.isInteger(id) && id > 0) : [], maxOpen: numberOrNull(rule.maxOpen) })).filter((rule) => rule.userId > 0).slice(0, 40) : [];
  const targetsRaw = raw.dailyTargets && typeof raw.dailyTargets === "object" ? (raw.dailyTargets as Record<string, unknown>) : {};
  const dailyTargets: Record<string, DailyTarget> = {};
  for (const [key, item] of Object.entries(targetsRaw)) { const target = item && typeof item === "object" ? (item as Record<string, unknown>) : {}; dailyTargets[key] = { calls: Math.max(0, Math.round(Number(target.calls) || 0)), appointments: Math.max(0, Math.round(Number(target.appointments) || 0)), deals: Math.max(0, Math.round(Number(target.deals) || 0)) }; }
  const reminder = raw.appointmentReminder; const mode = distributionRaw.mode;
  return {
    staleDays: Math.min(90, Math.max(0, Math.round(Number(raw.staleDays ?? DEFAULT_STALE_DAYS) || 0))),
    staleCampaignId: numberOrNull(raw.staleCampaignId),
    stageCampaigns: numberMap(raw.stageCampaigns),
    dispositionCampaigns: numberMap(raw.dispositionCampaigns),
    dispositionTasks: raw.dispositionTasks === undefined ? true : Boolean(raw.dispositionTasks),
    replyStage: raw.replyStage === null || raw.replyStage === "" ? null : String(raw.replyStage ?? "kontaktiert").slice(0, 40),
    appointmentReminder: reminder === "aus" || reminder === "sms" || reminder === "whatsapp" || reminder === "email" ? reminder : "email",
    appointmentReminderHours: Math.min(168, Math.max(1, Math.round(Number(raw.appointmentReminderHours ?? 24) || 24))),
    distribution: { mode: mode === "reihum" || mode === "regeln" ? mode : "aus", rules, fallback: distributionRaw.fallback === "ohne" ? "ohne" : "reihum" },
    dailyTargets,
  };
}

/** Verteilregel anwenden: Region (PLZ-Anfang) und Kategorie müssen passen, offene Karten unter dem Limit; sonst reihum (oder niemand). */
export function pickOwner(settings: DistributionRules, lead: { postcode?: string | null; categoryId?: number | null }, candidates: Array<{ userId: number; openCount: number }>, cursor: number): { userId: number | null; reason: string } {
  if (settings.mode === "aus" || !candidates.length) return { userId: null, reason: "Verteilung aus" };
  const roundRobin = () => { const target = candidates[cursor % candidates.length]; return { userId: target.userId, reason: "reihum" }; };
  if (settings.mode === "reihum") return roundRobin();
  const postcode = String(lead.postcode ?? "").replace(/\s/g, "");
  for (const rule of settings.rules) {
    const candidate = candidates.find((item) => item.userId === rule.userId); if (!candidate) continue;
    if (rule.postcodePrefixes.length && !rule.postcodePrefixes.some((prefix) => postcode.startsWith(prefix))) continue;
    if (rule.categoryIds.length && (!lead.categoryId || !rule.categoryIds.includes(lead.categoryId))) continue;
    if (rule.maxOpen && candidate.openCount >= rule.maxOpen) continue;
    return { userId: rule.userId, reason: [rule.postcodePrefixes.length ? `PLZ ${rule.postcodePrefixes.join("/")}` : "", rule.categoryIds.length ? "Kategorie" : "", rule.maxOpen ? `max. ${rule.maxOpen} offen` : ""].filter(Boolean).join(" · ") || "Regel" };
  }
  return settings.fallback === "ohne" ? { userId: null, reason: "keine Regel passt" } : roundRobin();
}

/* ---------------------------------------------------------------- Angebote & Umsatz */
/** Wahrscheinlichkeit je Stufe (gleichmäßig von 10 % bis 90 %; Kunde 100 %, Verloren 0 %). */
export function stageProbability(stageKey: string | null, stages: StageDef[]) {
  if (stageKey === wonStage(stages)) return 100; if (stageKey === lostStage(stages)) return 0;
  const open = stages.filter((stage) => stage.fixed !== "won" && stage.fixed !== "lost"); const index = Math.max(0, open.findIndex((stage) => stage.key === stageKey));
  return open.length <= 1 ? 50 : Math.round(10 + (index / (open.length - 1)) * 80);
}
export type ValueLead = { pipelineStage: string | null; dealValue?: number | string | null; ownerUserId?: number | null; ownerName?: string | null; pipelineUpdatedAt?: Date | string | null };
export function pipelineValueSummary(leads: ValueLead[], stages: StageDef[]) {
  const won = wonStage(stages); const lost = lostStage(stages); const value = (lead: ValueLead) => Number(lead.dealValue ?? 0) || 0;
  const open = leads.filter((lead) => lead.pipelineStage !== won && lead.pipelineStage !== lost);
  const openValue = open.reduce((sum, lead) => sum + value(lead), 0); const weighted = open.reduce((sum, lead) => sum + (value(lead) * stageProbability(lead.pipelineStage, stages)) / 100, 0);
  const wonLeads = leads.filter((lead) => lead.pipelineStage === won); const lostLeads = leads.filter((lead) => lead.pipelineStage === lost);
  const wonValue = wonLeads.reduce((sum, lead) => sum + value(lead), 0); const lostValue = lostLeads.reduce((sum, lead) => sum + value(lead), 0);
  const byStage = stages.map((stage) => { const rows = leads.filter((lead) => (lead.pipelineStage ?? stages[0]?.key) === stage.key); return { key: stage.key, label: stage.label, count: rows.length, withValue: rows.filter((lead) => value(lead) > 0).length, value: rows.reduce((sum, lead) => sum + value(lead), 0), probability: stageProbability(stage.key, stages) }; });
  const ownerMap = new Map<string, { ownerUserId: number | null; ownerName: string; open: number; openValue: number; won: number; wonValue: number; lost: number }>();
  for (const lead of leads) { const key = String(lead.ownerUserId ?? "ohne"); const entry = ownerMap.get(key) ?? { ownerUserId: lead.ownerUserId ?? null, ownerName: lead.ownerName?.split(" ")[0] ?? "Nicht zugeteilt", open: 0, openValue: 0, won: 0, wonValue: 0, lost: 0 }; if (lead.pipelineStage === won) { entry.won += 1; entry.wonValue += value(lead); } else if (lead.pipelineStage === lost) entry.lost += 1; else { entry.open += 1; entry.openValue += value(lead); } ownerMap.set(key, entry); }
  const closeRateEuro = wonValue + lostValue > 0 ? Math.round((wonValue / (wonValue + lostValue)) * 100) : null;
  const closeRate = wonLeads.length + lostLeads.length > 0 ? Math.round((wonLeads.length / (wonLeads.length + lostLeads.length)) * 100) : null;
  return { openCount: open.length, openValue, weighted: Math.round(weighted), wonCount: wonLeads.length, wonValue, lostCount: lostLeads.length, lostValue, closeRate, closeRateEuro, averageDeal: wonLeads.length ? Math.round(wonValue / wonLeads.length) : 0, byStage, byOwner: Array.from(ownerMap.values()).sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue) };
}
export const parseMoney = (value: string | number | null | undefined) => { if (value === null || value === undefined || value === "") return null; const text = String(value).replace(/[€\s.]/g, "").replace(",", "."); const number = Number(text); return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null; };
export const euro = (value: number | string | null | undefined) => { const number = Number(value ?? 0) || 0; return number.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }); };

/* ---------------------------------------------------------------- CSV-Export */
export type CsvLead = { publicId: string; name: string; company?: string | null; email?: string | null; phone?: string | null; postcode?: string | null; city?: string | null; categoryName?: string | null; pipelineStage: string | null; ownerName?: string | null; adCampaignName?: string | null; adPlatform?: string | null; createdAt: Date | string; pipelineUpdatedAt?: Date | string | null; dealValue?: number | string | null; followUpAt?: Date | string | null; appointmentAt?: Date | string | null; latestNote?: string | null; score?: number | null; scoreLabel?: string | null };
const csvCell = (value: unknown) => { const text = value === null || value === undefined ? "" : value instanceof Date ? value.toLocaleString("de-DE") : String(value); return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text; };
export function pipelineCsv(leads: CsvLead[], stages: StageDef[]) {
  const header = ["Lead-ID", "Name", "Firma", "E-Mail", "Telefon", "PLZ", "Ort", "Kategorie", "Stufe", "Einschätzung", "Punkte", "Vertriebler", "Quelle", "Kampagne/Liste", "Eingang", "Letzte Änderung", "Angebotswert (EUR)", "Wiedervorlage", "Termin", "Letzte Notiz"];
  const label = (key: string | null) => stages.find((stage) => stage.key === key)?.label ?? stages[0]?.label ?? "Neu";
  const date = (value: Date | string | null | undefined) => value ? new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const rows = leads.map((lead) => [lead.publicId, lead.name, lead.company ?? "", lead.email ?? "", lead.phone ?? "", lead.postcode ?? "", lead.city ?? "", lead.categoryName ?? "", label(lead.pipelineStage), lead.scoreLabel ?? "", lead.score === null || lead.score === undefined ? "" : String(lead.score), lead.ownerName ?? "", lead.adPlatform === "kaltakquise" ? "Kaltakquise" : lead.adPlatform === "email" ? "E-Mail" : lead.adPlatform === "posteingang" ? "Posteingang" : lead.adPlatform ? "Meta Ads" : "", lead.adCampaignName ?? "", date(lead.createdAt), date(lead.pipelineUpdatedAt), lead.dealValue ? String(Number(lead.dealValue)).replace(".", ",") : "", date(lead.followUpAt), date(lead.appointmentAt), (lead.latestNote ?? "").replace(/\s+/g, " ").slice(0, 200)].map(csvCell).join(";"));
  return `\uFEFF${header.join(";")}\n${rows.join("\n")}${rows.length ? "\n" : ""}`;
}

/* ---------------------------------------------------------------- Termine */
const icsDate = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const icsText = (value: string) => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (match) => `\\${match}`);
/** Kalendereintrag (iCalendar) für die Einladung per E-Mail. */
export function buildIcs(input: { uid: string; start: Date; durationMinutes?: number; title: string; description?: string | null; location?: string | null; organizerName?: string | null; organizerEmail?: string | null; attendeeEmail?: string | null; attendeeName?: string | null }) {
  const end = new Date(input.start.getTime() + (input.durationMinutes ?? 60) * 60_000);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tanesco Leads//Vertriebspipeline//DE", "METHOD:REQUEST", "BEGIN:VEVENT", `UID:${input.uid}`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(input.start)}`, `DTEND:${icsDate(end)}`, `SUMMARY:${icsText(input.title)}`];
  if (input.description) lines.push(`DESCRIPTION:${icsText(input.description)}`); if (input.location) lines.push(`LOCATION:${icsText(input.location)}`);
  if (input.organizerEmail) lines.push(`ORGANIZER;CN=${icsText(input.organizerName ?? input.organizerEmail)}:mailto:${input.organizerEmail}`);
  if (input.attendeeEmail) lines.push(`ATTENDEE;CN=${icsText(input.attendeeName ?? input.attendeeEmail)};RSVP=TRUE:mailto:${input.attendeeEmail}`);
  lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}
export const formatAppointment = (value: Date | string) => new Date(value).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
/** Wochenraster (Montag bis Sonntag) um ein Datum. */
export function weekDays(anchor: Date) { const start = startOfDay(anchor); const offset = (start.getDay() + 6) % 7; start.setDate(start.getDate() - offset); return Array.from({ length: 7 }, (_, index) => addDays(start, index)); }

/* ---------------------------------------------------------------- Nachrichten (SMS/WhatsApp/E-Mail) */
export type MessageChannel = "sms" | "whatsapp" | "email";
export const CHANNEL_LABELS: Record<MessageChannel, string> = { sms: "SMS", whatsapp: "WhatsApp", email: "E-Mail" };
export const MESSAGE_TEMPLATES: Array<{ key: string; label: string; channels: MessageChannel[]; subject?: string; text: string }> = [
  { key: "rueckruf", label: "Rückruf anbieten", channels: ["sms", "whatsapp"], text: "Guten Tag {{anrede}} {{nachname}}, hier ist {{absender}} von Tanesco Digital. Ich habe versucht, Sie zu erreichen – wann passt ein kurzer Rückruf? Viele Grüße, {{absender}}" },
  { key: "termin", label: "Termin bestätigen", channels: ["sms", "whatsapp", "email"], subject: "Ihr Termin am {{termin}}", text: "Guten Tag {{anrede}} {{nachname}}, hiermit bestätige ich unseren Termin am {{termin}}. Bei Fragen erreichen Sie mich jederzeit unter dieser Nummer. Viele Grüße, {{absender}} (Tanesco Digital)" },
  { key: "erinnerung", label: "Terminerinnerung", channels: ["sms", "whatsapp", "email"], subject: "Erinnerung: Termin am {{termin}}", text: "Guten Tag {{anrede}} {{nachname}}, kurze Erinnerung an unseren Termin am {{termin}}. Wir freuen uns auf das Gespräch! {{absender}}, Tanesco Digital" },
  { key: "unterlagen", label: "Unterlagen angekündigt", channels: ["sms", "whatsapp", "email"], subject: "Ihre Unterlagen von Tanesco Digital", text: "Guten Tag {{anrede}} {{nachname}}, wie besprochen schicke ich Ihnen die Unterlagen zu {{kategorie}}. Melden Sie sich gern bei Rückfragen. Viele Grüße, {{absender}}" },
  { key: "angebot", label: "Angebot nachfassen", channels: ["sms", "whatsapp", "email"], subject: "Kurze Frage zu unserem Angebot", text: "Guten Tag {{anrede}} {{nachname}}, konnten Sie sich unser Angebot schon ansehen? Gern besprechen wir offene Punkte – wann passt es Ihnen? Viele Grüße, {{absender}}" },
  { key: "frei", label: "Freier Text", channels: ["sms", "whatsapp", "email"], text: "" },
];
export function fillMessage(text: string, values: Record<string, string | null | undefined>) { return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => values[key] ?? "").replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim(); }
export function messageValues(lead: { firstName?: string | null; lastName?: string | null; company?: string | null; categoryName?: string | null; appointmentAt?: Date | string | null; metadata?: unknown }, sender: string | null | undefined) {
  const salutation = (lead.metadata && typeof lead.metadata === "object" ? (lead.metadata as { salutation?: string }).salutation : null) ?? null;
  const anrede = salutation === "frau" ? "Frau" : salutation === "herr" ? "Herr" : "";
  return { anrede, vorname: lead.firstName ?? "", nachname: lead.lastName ?? lead.company ?? "", firma: lead.company ?? "", kategorie: lead.categoryName ?? "unser Angebot", termin: lead.appointmentAt ? formatAppointment(lead.appointmentAt) : "(Termin)", absender: sender?.split(" ")[0] ?? "Ihr Tanesco-Team" };
}
/** Telefonnummer in E.164 (Standard Deutschland). */
export function normalizePhone(phone: string | null | undefined, defaultCountry = "49") {
  const raw = String(phone ?? "").trim().replace(/\(0\)/g, ""); if (!raw) return null; // „+49 (0)69 …“ → Null in Klammern fällt weg
  let digits = raw.replace(/[^\d+]/g, ""); if (digits.startsWith("00")) digits = `+${digits.slice(2)}`; if (digits.startsWith("0")) digits = `+${defaultCountry}${digits.slice(1)}`; if (!digits.startsWith("+")) digits = `+${digits}`;
  const clean = `+${digits.slice(1).replace(/\D/g, "")}`; return clean.length >= 8 ? clean : null;
}
export const whatsappLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
/** Telefonnummer aus freiem Text (Signatur einer E-Mail) erkennen – erste plausible deutsche/internationale Nummer. */
export function extractPhone(text: string | null | undefined): string | null {
  const source = String(text ?? ""); if (!source) return null;
  const labeled = /(?:tel(?:efon)?|phone|mobil|handy|fon|t)\.?\s*[:.]?\s*((?:\+|00)?[\d][\d\s\/().-]{6,24}\d)/i.exec(source);
  const candidates = labeled ? [labeled[1]] : Array.from(source.matchAll(/(?:(?:\+|00)\d{1,3}[\s\/().-]*)?(?:\(?0\d{1,5}\)?[\s\/().-]*)?\d[\d\s\/().-]{5,20}\d/g)).map((match) => match[0]);
  for (const candidate of candidates) { const trimmed = candidate.trim(); if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(trimmed)) continue; /* Datum */ const digits = trimmed.replace(/\D/g, ""); if (digits.length < 8 || digits.length > 15) continue; if (!/^(\+|00|0)/.test(trimmed) && digits.length < 9) continue; const normalized = normalizePhone(trimmed); if (normalized) return normalized; }
  return null;
}
export const SMS_LIMIT = 480;

/* ---------------------------------------------------------------- Anrufzähler */
/** Ergebnis eines Anrufversuchs – so wie der Vertriebler es nach dem Auflegen anklickt. */
export type CallResult = "erreicht" | "nicht_erreicht" | "besetzt" | "mailbox" | "rueckruf" | "falsche_nummer";
export const CALL_RESULTS: Array<{ key: CallResult; label: string; short: string; reached: boolean }> = [
  { key: "erreicht", label: "Erreicht – gesprochen", short: "erreicht", reached: true },
  { key: "nicht_erreicht", label: "Nicht erreicht", short: "nicht erreicht", reached: false },
  { key: "besetzt", label: "Besetzt", short: "besetzt", reached: false },
  { key: "mailbox", label: "Mailbox", short: "Mailbox", reached: false },
  { key: "rueckruf", label: "Rückruf vereinbart", short: "Rückruf", reached: true },
  { key: "falsche_nummer", label: "Falsche Nummer", short: "falsche Nummer", reached: false },
];
export const callResultLabel = (key: string | null | undefined) => CALL_RESULTS.find((item) => item.key === key)?.short ?? "–";
export const isCallResult = (value: unknown): value is CallResult => CALL_RESULTS.some((item) => item.key === value);
/** Dialer-Anruf → Ergebnis für den Zähler: beendet = erreicht, besetzt, Anrufbeantworter = Mailbox, sonst nicht erreicht. */
export const callResultOfDialer = (status: string, disposition?: string | null): CallResult => disposition === "falsche_nummer" ? "falsche_nummer" : disposition === "wiedervorlage" && status === "beendet" ? "rueckruf" : status === "beendet" ? "erreicht" : status === "besetzt" ? "besetzt" : status === "anrufbeantworter" ? "mailbox" : "nicht_erreicht";
/** Kurztext für die Karte: „3 Anrufe · zuletzt Do 14:10 · nicht erreicht“. */
export function callCounterText(calls: { count: number; lastAt: Date | string | null; lastResult: string | null } | null | undefined, now = new Date()): string | null {
  if (!calls || !calls.count) return null;
  const last = calls.lastAt ? new Date(calls.lastAt) : null;
  const when = last ? (last.toDateString() === now.toDateString() ? `heute ${last.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : last.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })) : null;
  return [`${calls.count} ${calls.count === 1 ? "Anruf" : "Anrufe"}`, when ? `zuletzt ${when}` : null, calls.lastResult ? callResultLabel(calls.lastResult) : null].filter(Boolean).join(" · ");
}

/* ---------------------------------------------------------------- Listen-Upload: Verteilung auf Vertriebler */
export type ShareMode = "gleich" | "prozent" | "anzahl";
export type OwnerShare = { userId: number; value: number };
/**
 * Verteilt `total` Kontakte auf Vertriebler: gleichmäßig, nach Prozent (Anteile müssen nicht genau 100 ergeben – sie werden gewichtet)
 * oder nach fester Anzahl (Rest bleibt ohne Zuteilung). Größte Reste bekommen die übrigen Kontakte, damit die Summe stimmt.
 */
export function splitShares(total: number, shares: OwnerShare[], mode: ShareMode): Array<{ userId: number; count: number }> {
  const clean = shares.filter((share) => share.userId > 0 && Number.isFinite(share.value) && share.value >= 0);
  if (!clean.length || total <= 0) return [];
  if (mode === "anzahl") { let left = total; return clean.map((share) => { const count = Math.min(left, Math.max(0, Math.round(share.value))); left -= count; return { userId: share.userId, count }; }); }
  const weights = mode === "gleich" ? clean.map(() => 1) : clean.map((share) => share.value);
  const sum = weights.reduce((acc, weight) => acc + weight, 0); if (!sum) return clean.map((share) => ({ userId: share.userId, count: 0 }));
  const exact = weights.map((weight) => (total * weight) / sum); const counts = exact.map((value) => Math.floor(value));
  let rest = total - counts.reduce((acc, value) => acc + value, 0);
  const order = exact.map((value, index) => ({ index, frac: value - Math.floor(value) })).sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const item of order) { if (rest <= 0) break; counts[item.index] += 1; rest -= 1; }
  return clean.map((share, index) => ({ userId: share.userId, count: counts[index] }));
}
/** Reihenfolge der Zuteilung: die Vertriebler wechseln sich gewichtet ab (wer noch den größten Anteil offen hat, ist dran) – nicht erst alle für A, dann alle für B. */
export function ownerSequence(total: number, shares: OwnerShare[], mode: ShareMode): Array<number | null> {
  const counts = splitShares(total, shares, mode); const left = counts.map((item) => ({ userId: item.userId, left: item.count, quota: item.count }));
  const out: Array<number | null> = [];
  for (let index = 0; index < total; index += 1) {
    const candidates = left.filter((item) => item.left > 0); if (!candidates.length) { out.push(null); continue; }
    const pick = candidates.sort((a, b) => b.left / b.quota - a.left / a.quota || b.left - a.left)[0]; pick.left -= 1; out.push(pick.userId);
  }
  return out;
}
