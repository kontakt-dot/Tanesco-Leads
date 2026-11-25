/**
 * API-Fehler: alles, was beim Ausliefern hakt – an einem Ort.
 *  - Übersicht: offene Probleme je Lead (Antwort des Empfängers, kein Abnehmer, falsche Angaben), zuletzt Erledigtes, Zustand jeder Schnittstelle
 *  - Lead von Hand korrigieren (E-Mail, Rufnummer, Anschrift, Felder der Kategorie) und noch einmal ausliefern
 *  - Als erledigt abhaken
 * Die Rechnung selbst steht in shared/api-errors.ts (dieselbe für die Vorschau); hier werden nur die Zeilen geladen und Änderungen gespeichert.
 */
import { and, desc, eq, gte, inArray, like, or } from "drizzle-orm";
import { automationExecutionLogs, categoryFields, deliveryEndpoints, integrationEvents, leadCategories, leadDeliveries, leadStatusEvents, leads, memberships, partnerIntegrations, suppliers, users } from "../drizzle/schema";
import { normalizePostcode } from "../shared/postcode";
import { LEAD_FIELD_LABEL, NOT_POSSIBLE_PREFIX, PRECHECK_STATUS, buildApiErrorOverview, emailProblem, phoneProblem, plainReason, postcodeProblem, type ApiErrorOverview, type ApiNoteRow, type LeadContactField } from "../shared/api-errors";
import { fieldOptions, leadDisplayName } from "../shared/lead-fields";
import { deliverLeadNow, metadataOf, type Db, type LeadRow } from "./lead-pipeline";

const MAX_EVENTS = 6000; const MAX_NOTES = 3000; const MAX_PRECHECK = 3000;

/** Vermerke aus dem Protokoll der Regeln („Auslieferung offen: …“) in dieselbe Form bringen wie die Vermerke im Lead-Log. */
function noteFromAutomation(summary: string): string | null {
  const open = /Auslieferung offen:\s*([\s\S]+)$/.exec(summary)?.[1];
  if (open) return `${NOT_POSSIBLE_PREFIX}${open.trim()}`;
  if (/^(?:Keine aktive Lieferkette|Die zugeordnete (?:Lieferkette|Bestellung))/.test(summary)) return `${NOT_POSSIBLE_PREFIX}${summary.trim()}`;
  return null;
}

/** Derselbe Grund steht oft zweimal da (Lead-Log und Protokoll der Regeln) – innerhalb von zwei Minuten zählt er einmal. */
function dedupeNotes(notes: ApiNoteRow[]): ApiNoteRow[] {
  const sorted = notes.slice().sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  const out: ApiNoteRow[] = [];
  for (const note of sorted) {
    const twin = out.find((other) => other.leadId === note.leadId && other.note === note.note && Math.abs(new Date(other.occurredAt).getTime() - new Date(note.occurredAt).getTime()) < 120_000);
    if (!twin) out.push(note);
  }
  return out;
}

export async function apiErrorOverview(db: Db, tenantId: number, options: { days?: number; now?: Date } = {}): Promise<ApiErrorOverview> {
  const now = options.now ?? new Date(); const days = Math.min(90, Math.max(1, options.days ?? 30)); const since = new Date(now.getTime() - days * 86_400_000);
  const [events, statusNotes, automationNotes, precheck, endpointRows, integrations, categories, supplierRows] = await Promise.all([
    db.select({ id: integrationEvents.id, leadId: integrationEvents.leadId, integrationId: integrationEvents.integrationId, endpointId: integrationEvents.endpointId, eventType: integrationEvents.eventType, responseStatus: integrationEvents.responseStatus, responseBody: integrationEvents.responseBody, externalReference: integrationEvents.externalReference, occurredAt: integrationEvents.occurredAt })
      .from(integrationEvents).where(and(eq(integrationEvents.tenantId, tenantId), gte(integrationEvents.occurredAt, since))).orderBy(desc(integrationEvents.occurredAt)).limit(MAX_EVENTS),
    db.select({ leadId: leadStatusEvents.leadId, note: leadStatusEvents.note, occurredAt: leadStatusEvents.occurredAt })
      .from(leadStatusEvents).where(and(eq(leadStatusEvents.tenantId, tenantId), gte(leadStatusEvents.occurredAt, since), or(like(leadStatusEvents.note, "Auslieferung ohne Abnehmer:%"), like(leadStatusEvents.note, `${NOT_POSSIBLE_PREFIX}%`), like(leadStatusEvents.note, "Auslieferung an Bestellung % aufgegeben%")))).orderBy(desc(leadStatusEvents.occurredAt)).limit(MAX_NOTES),
    db.select({ leadId: automationExecutionLogs.sourceLeadId, summary: automationExecutionLogs.summary, occurredAt: automationExecutionLogs.occurredAt })
      .from(automationExecutionLogs).where(and(eq(automationExecutionLogs.tenantId, tenantId), gte(automationExecutionLogs.occurredAt, since), or(like(automationExecutionLogs.summary, "%Auslieferung offen:%"), like(automationExecutionLogs.summary, "Keine aktive Lieferkette%"), like(automationExecutionLogs.summary, "Die zugeordnete %")))).orderBy(desc(automationExecutionLogs.occurredAt)).limit(MAX_NOTES),
    // Noch nicht ausgeliefert: Angaben vorab prüfen (nur Leads für den Verkauf, die neuesten zuerst)
    db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "verkauf"), inArray(leads.status, Array.from(PRECHECK_STATUS) as Array<LeadRow["status"]>))).orderBy(desc(leads.id)).limit(MAX_PRECHECK),
    db.select({ id: deliveryEndpoints.id, url: deliveryEndpoints.url, enabled: deliveryEndpoints.enabled, membershipId: deliveryEndpoints.membershipId, categoryId: deliveryEndpoints.categoryId, name: users.name, company: users.company })
      .from(deliveryEndpoints).leftJoin(memberships, eq(memberships.id, deliveryEndpoints.membershipId)).leftJoin(users, eq(users.id, memberships.userId)).where(eq(deliveryEndpoints.tenantId, tenantId)),
    db.select({ id: partnerIntegrations.id, name: partnerIntegrations.name, status: partnerIntegrations.status, callbackUrl: partnerIntegrations.callbackUrl }).from(partnerIntegrations).where(eq(partnerIntegrations.tenantId, tenantId)),
    db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId)),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.tenantId, tenantId)),
  ]);
  const fromRules: ApiNoteRow[] = [];
  for (const row of automationNotes) { const note = noteFromAutomation(row.summary); if (note) fromRules.push({ leadId: row.leadId, note, occurredAt: row.occurredAt }); }
  const notes = dedupeNotes([...statusNotes.map((row): ApiNoteRow => ({ leadId: row.leadId, note: row.note ?? "", occurredAt: row.occurredAt })), ...fromRules]);
  const leadIds = Array.from(new Set([...events.map((event) => event.leadId).filter((id): id is number => typeof id === "number"), ...notes.map((note) => note.leadId), ...precheck.map((row) => row.id)]));
  const leadRows: LeadRow[] = []; const deliveries: Array<{ leadId: number; buyerName: string; result: string; occurredAt: Date }> = [];
  for (let index = 0; index < leadIds.length; index += 800) {
    const part = leadIds.slice(index, index + 800);
    leadRows.push(...await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, part))));
    deliveries.push(...await db.select({ leadId: leadDeliveries.leadId, buyerName: leadDeliveries.buyerName, result: leadDeliveries.result, occurredAt: leadDeliveries.occurredAt }).from(leadDeliveries).where(and(eq(leadDeliveries.tenantId, tenantId), inArray(leadDeliveries.leadId, part))));
  }
  const categoryName = new Map(categories.map((row) => [row.id, row.name]));
  const supplierName = new Map(supplierRows.map((row) => [row.id, row.name])); // am Lead steht der Name des Lieferanten nicht immer – dann über seine Nummer
  return buildApiErrorOverview({
    now, days, events, notes, deliveries, categories, integrations,
    leads: leadRows.filter((lead) => lead.kind === "verkauf").map((lead) => ({ id: lead.id, publicId: lead.publicId, firstName: lead.firstName, lastName: lead.lastName, email: lead.email, phone: lead.phone, postcode: lead.postcode, city: lead.city, country: lead.country, status: lead.status, categoryId: lead.categoryId, supplierName: lead.supplierName ?? (lead.supplierId ? supplierName.get(lead.supplierId) ?? null : null), metadata: lead.metadata, createdAt: lead.createdAt })),
    endpoints: endpointRows.map((row) => ({ id: row.id, url: row.url, enabled: row.enabled, membershipId: row.membershipId, buyerName: row.company ?? row.name ?? "Käufer", categoryName: categoryName.get(row.categoryId) ?? null })),
  });
}

/** Zahl für das Menü: offene Probleme und gestörte Schnittstellen. Kurz gemerkt, damit das Menü die Datenbank nicht bei jedem Blick fragt. */
const countCache = new Map<number, { at: number; value: { open: number; broken: number } }>();
export const forgetApiErrorCount = (tenantId?: number) => { if (tenantId === undefined) countCache.clear(); else countCache.delete(tenantId); };
export async function apiErrorCount(db: Db, tenantId: number): Promise<{ open: number; broken: number }> {
  const cached = countCache.get(tenantId);
  if (cached && Date.now() - cached.at < 45_000) return cached.value;
  const overview = await apiErrorOverview(db, tenantId, { days: 30 });
  const value = { open: overview.counts.open, broken: overview.counts.schnittstellenGestoert };
  countCache.set(tenantId, { at: Date.now(), value });
  return value;
}

export type LeadCorrection = { firstName?: string; lastName?: string; email?: string; phone?: string; street?: string; postcode?: string; city?: string; fields?: Record<string, string> };
const CONTACT_KEYS: LeadContactField[] = ["firstName", "lastName", "email", "phone", "street", "postcode", "city"];
const MAX_LENGTH: Record<LeadContactField, number> = { firstName: 120, lastName: 120, email: 320, phone: 48, street: 200, postcode: 24, city: 120 };
const tidy = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * Lead von Hand korrigieren. Geprüft wird vor dem Speichern (E-Mail-Adresse, Rufnummer, PLZ); Felder der Kategorie nur, wenn es sie gibt
 * (Auswahl-Felder nur mit einer ihrer Antworten). Jede Änderung steht mit altem und neuem Wert im Lead-Log.
 */
export async function correctLead(db: Db, tenantId: number, actorUserId: number | null, lead: LeadRow, input: LeadCorrection) {
  const meta = metadataOf(lead); const patch: Partial<typeof leads.$inferInsert> = {}; const nextMeta: Record<string, unknown> = { ...meta }; const changed: string[] = []; const log: string[] = [];
  const current: Record<LeadContactField, string> = { firstName: lead.firstName ?? "", lastName: lead.lastName ?? "", email: lead.email ?? "", phone: lead.phone ?? "", street: typeof meta.street === "string" ? meta.street : "", postcode: lead.postcode ?? "", city: lead.city ?? "" };
  for (const key of CONTACT_KEYS) {
    const raw = input[key]; if (raw === undefined) continue;
    let value = tidy(raw).slice(0, MAX_LENGTH[key]);
    if (key === "email") value = value.replace(/\s+/g, "").toLowerCase();
    if (key === "postcode") value = normalizePostcode(value, lead.country) ?? ""; // „9633“ → „09633“ (führende Null)
    if (value === tidy(current[key])) continue;
    if (key === "email" && value) { const problem = emailProblem(value); if (problem) throw new Error(`E-Mail-Adresse: ${problem}`); }
    if (key === "phone" && value) { const problem = phoneProblem(value); if (problem) throw new Error(`Rufnummer: ${problem}`); }
    if (key === "postcode" && value) { const problem = postcodeProblem(value, lead.country); if (problem) throw new Error(`PLZ: ${problem}`); }
    if (key === "street") { if (value) nextMeta.street = value; else delete nextMeta.street; }
    else patch[key] = value || null;
    changed.push(LEAD_FIELD_LABEL[key]); log.push(`${LEAD_FIELD_LABEL[key]}: ${current[key] ? `„${current[key]}“` : "leer"} → ${value ? `„${value}“` : "leer"}`);
  }
  const wanted = Object.entries(input.fields ?? {});
  if (wanted.length) {
    const defs = await db.select({ fieldKey: categoryFields.fieldKey, label: categoryFields.label, fieldType: categoryFields.fieldType, options: categoryFields.options }).from(categoryFields).where(and(eq(categoryFields.tenantId, tenantId), eq(categoryFields.categoryId, lead.categoryId)));
    for (const [key, raw] of wanted) {
      const def = defs.find((field) => field.fieldKey === key); if (!def) throw new Error(`Das Feld „${key}“ gehört nicht zur Kategorie dieses Leads.`);
      const value = tidy(String(raw ?? "")).slice(0, 600); const before = meta[key] === undefined || meta[key] === null ? "" : String(meta[key]);
      if (value === tidy(before)) continue;
      if (value && def.fieldType === "auswahl") { const options = fieldOptions(def); if (options.length && !options.includes(value)) throw new Error(`${def.label}: Bitte eine der Antworten wählen (${options.slice(0, 8).join(", ")}).`); }
      if (value) nextMeta[key] = value; else delete nextMeta[key];
      changed.push(def.label); log.push(`${def.label}: ${before ? `„${before}“` : "leer"} → ${value ? `„${value}“` : "leer"}`);
    }
  }
  if (!changed.length) return { changed, lead };
  const nextFirst = "firstName" in patch ? patch.firstName : lead.firstName; const nextLast = "lastName" in patch ? patch.lastName : lead.lastName;
  if (("firstName" in patch || "lastName" in patch) && !nextFirst && !nextLast) throw new Error("Vorname oder Nachname muss stehen bleiben.");
  await db.update(leads).set({ ...patch, metadata: nextMeta }).where(and(eq(leads.id, lead.id), eq(leads.tenantId, tenantId)));
  await db.insert(leadStatusEvents).values({ tenantId, leadId: lead.id, previousStatus: lead.status, nextStatus: lead.status, actorUserId, note: `Von Hand korrigiert: ${log.join(" · ")}`.slice(0, 900) });
  forgetApiErrorCount(tenantId);
  const updated = (await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1))[0] ?? lead;
  return { changed, lead: updated };
}

export type RetryResult = { publicId: string; name: string; ok: boolean; result: "angenommen" | "angeboten" | "abgelehnt" | "fehler"; buyerName: string | null; message: string };
/** Leads noch einmal ausliefern – einer nach dem anderen; ein Fehler bei einem Lead hält die anderen nicht auf. */
export async function retryDeliveries(db: Db, tenantId: number, actorUserId: number | null, leadRows: LeadRow[], options: { allowRepeat?: boolean } = {}): Promise<RetryResult[]> {
  const out: RetryResult[] = [];
  for (const row of leadRows) {
    const lead = (await db.select().from(leads).where(eq(leads.id, row.id)).limit(1))[0] ?? row; const name = leadDisplayName(lead) || lead.publicId;
    try {
      // Ein „fehlerhafter“ Lead wurde gerade von Hand geprüft – für die Auslieferung zählt er wie freigegeben
      const delivery = await deliverLeadNow(db, { tenantId, actorUserId, lead: { ...lead, status: lead.status === "fehlerhaft" ? "genehmigt" : lead.status }, allowRepeat: options.allowRepeat });
      if (delivery.result === "abgelehnt") out.push({ publicId: lead.publicId, name, ok: false, result: "abgelehnt", buyerName: null, message: delivery.attempts.map((attempt) => `${attempt.buyerName}: ${plainReason(attempt.reason ?? attempt.outcome)}`).join("; ").slice(0, 600) || "Kein Käufer hat den Lead genommen." });
      else out.push({ publicId: lead.publicId, name, ok: true, result: delivery.result === "angenommen" ? "angenommen" : "angeboten", buyerName: delivery.buyerName, message: delivery.export ? `An ${delivery.buyerName} übergeben (Antwort ${delivery.export.responseStatus ?? "–"}).` : `An ${delivery.buyerName} zugewiesen.` });
    } catch (error) { out.push({ publicId: lead.publicId, name, ok: false, result: "fehler", buyerName: null, message: error instanceof Error ? error.message.slice(0, 600) : "Auslieferung nicht möglich." }); }
  }
  forgetApiErrorCount(tenantId);
  return out;
}

/** Probleme als erledigt abhaken: Sie verschwinden aus der Liste, bis derselbe Lead wieder scheitert. Der Vermerk steht im Lead-Log. */
export async function dismissApiErrors(db: Db, tenantId: number, actorUserId: number | null, leadRows: LeadRow[]) {
  const at = new Date().toISOString();
  for (const lead of leadRows) {
    await db.update(leads).set({ metadata: { ...metadataOf(lead), apiErrorsDismissedAt: at } }).where(and(eq(leads.id, lead.id), eq(leads.tenantId, tenantId)));
    await db.insert(leadStatusEvents).values({ tenantId, leadId: lead.id, previousStatus: lead.status, nextStatus: lead.status, actorUserId, note: "API-Fehler als erledigt abgehakt" });
  }
  forgetApiErrorCount(tenantId);
  return { dismissed: leadRows.length };
}
