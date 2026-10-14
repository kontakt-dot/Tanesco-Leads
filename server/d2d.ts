/**
 * Haustür-Erfassung (Door-to-Door): Vertriebler erfassen Kontakte an der Haustür. Jede Erfassung wird sofort zum Lead
 * (derselbe Weg wie beim Import: Lead + Verlauf + Automatisierung) und geht mit der Sub-ID des Vertrieblers an Aroundhome.
 * Aroundhome liefert keine Kontaktdaten zurück – der Abgleich läuft je Sub-ID und Tag über den Transaktions-Export
 * des Aroundhome-Kontos (Einstellungen → Integrationen).
 */
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { customAlphabet, nanoid } from "nanoid";
const subIdSuffix = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
import { d2dAgencies, d2dCaptures, d2dDailyStats, d2dReps, d2dSettings, leadCategories, leadDeliveries, leadStatusEvents, leads, memberships, orders, partnerAccounts, suppliers, users, type D2dRep } from "../drizzle/schema";
import { createMember } from "./member-admin";
import { scheduleOnboardingEmails } from "./email-onboarding";
import { deliverLeadNow, triggerLeadAutomations, type Db } from "./lead-pipeline";
import { normalizeRawPhone } from "./raw-data";

export const DEFAULT_CONSENT = "Ich bin einverstanden, dass meine Angaben an einen Fachbetrieb bzw. an Aroundhome weitergegeben werden, damit ich ein Angebot erhalte. Diese Einwilligung kann ich jederzeit widerrufen.";
const dayKey = (date: Date) => date.toISOString().slice(0, 10);

/* ------------------------------------------------------------------ Einstellungen */

export async function ensureSettings(db: Db, tenantId: number) {
  const existing = (await db.select().from(d2dSettings).where(eq(d2dSettings.tenantId, tenantId)).limit(1))[0];
  if (existing) return existing;
  await db.insert(d2dSettings).values({ tenantId, consentText: DEFAULT_CONSENT });
  return (await db.select().from(d2dSettings).where(eq(d2dSettings.tenantId, tenantId)).limit(1))[0];
}

export async function getSettings(db: Db, tenantId: number) {
  const settings = await ensureSettings(db, tenantId);
  const accounts = await db.select({ id: partnerAccounts.id, label: partnerAccounts.label, publisherId: partnerAccounts.publisherId, lastSyncAt: partnerAccounts.lastSyncAt, lastSyncSummary: partnerAccounts.lastSyncSummary }).from(partnerAccounts).where(and(eq(partnerAccounts.tenantId, tenantId), eq(partnerAccounts.provider, "aroundhome")));
  const orderRows = await db.select({ id: orders.id, orderNumber: orders.orderNumber, buyerName: orders.buyerName, status: orders.status }).from(orders).where(and(eq(orders.tenantId, tenantId), inArray(orders.status, ["offen", "aktiv"])));
  const supplierRows = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.tenantId, tenantId));
  const categoryRows = await db.select({ id: leadCategories.id, name: leadCategories.name, shortcode: leadCategories.shortcode }).from(leadCategories).where(and(eq(leadCategories.tenantId, tenantId), eq(leadCategories.status, "aktiv")));
  const buyerRows = await db.select({ userId: users.id, name: users.name, company: users.company }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.tenantId, tenantId), eq(memberships.partnerType, "käufer")));
  return { ...settings, consentText: settings.consentText ?? DEFAULT_CONSENT, aroundhomeAccounts: accounts, orders: orderRows, suppliers: supplierRows, categories: categoryRows, buyers: buyerRows.map((row) => ({ userId: row.userId, label: row.company ? `${row.company} · ${row.name ?? ""}`.trim() : row.name ?? `Benutzer ${row.userId}` })) };
}

export async function saveSettings(db: Db, tenantId: number, input: { aroundhomeAccountId?: number | null; orderId?: number | null; supplierId?: number | null; consentText?: string; categoryId?: number | null; buyerUserId?: number | null }) {
  const settings = await ensureSettings(db, tenantId);
  const effectiveCategory = input.categoryId !== undefined ? input.categoryId : settings.categoryId; if (input.buyerUserId && !effectiveCategory) throw new Error("Für einen Käufer bitte auch eine Sparte wählen.");
  if (input.categoryId) { const category = (await db.select({ id: leadCategories.id }).from(leadCategories).where(and(eq(leadCategories.id, input.categoryId), eq(leadCategories.tenantId, tenantId))).limit(1))[0]; if (!category) throw new Error("Sparte oder Käufer gehört nicht zu diesem Mandanten."); }
  if (input.buyerUserId) { const buyer = (await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, input.buyerUserId), eq(memberships.tenantId, tenantId))).limit(1))[0]; if (!buyer) throw new Error("Sparte oder Käufer gehört nicht zu diesem Mandanten."); }
  await db.update(d2dSettings).set({ ...(input.aroundhomeAccountId !== undefined ? { aroundhomeAccountId: input.aroundhomeAccountId } : {}), ...(input.orderId !== undefined ? { orderId: input.orderId } : {}), ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}), ...(input.consentText !== undefined ? { consentText: input.consentText.trim() || DEFAULT_CONSENT } : {}), ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}), ...(input.buyerUserId !== undefined ? { buyerUserId: input.buyerUserId } : {}) }).where(eq(d2dSettings.id, settings.id));
  return { success: true as const };
}

/** Aroundhome-iFrame: Skript-URL oder komplettes <script>-Snippet; nur https-Adressen von aroundhome.de. */
export function parseEmbedScript(raw: string): string | null {
  const text = raw.trim(); if (!text) return null;
  const match = /https:\/\/[^\s"'<>]+/i.exec(text); const url = match?.[0] ?? text;
  try { const parsed = new URL(url); if (parsed.protocol !== "https:" || !(parsed.hostname === "aroundhome.de" || parsed.hostname.endsWith(".aroundhome.de"))) return null; return parsed.toString(); } catch { return null; }
}
export async function saveEmbed(db: Db, tenantId: number, raw: string) {
  const settings = await ensureSettings(db, tenantId);
  if (!raw.trim()) { await db.update(d2dSettings).set({ embedScriptUrl: null }).where(eq(d2dSettings.id, settings.id)); return { embedScriptUrl: null }; }
  const url = parseEmbedScript(raw); if (!url) throw new Error("Bitte eine https-Adresse von aroundhome.de oder das Aroundhome-Snippet einfügen.");
  await db.update(d2dSettings).set({ embedScriptUrl: url }).where(eq(d2dSettings.id, settings.id)); return { embedScriptUrl: url };
}

/** Agentur mit eigenem Zugang: Team + Agenturleiter-Login + Willkommensmail. */
export async function createAgency(db: Db, tenantId: number, input: { name: string; leaderFirstName?: string | null; leaderLastName?: string | null; leaderEmail?: string | null; password?: string | null }) {
  const name = input.name.trim(); if (!name) throw new Error("Bitte einen Namen angeben.");
  const existingCodes = new Set((await db.select({ code: d2dAgencies.code }).from(d2dAgencies).where(eq(d2dAgencies.tenantId, tenantId))).map((row) => row.code));
  const base = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase() || "AGT"; let code = base; for (let n = 2; existingCodes.has(code); n += 1) { code = `${base}${n}`; if (n > 999) throw new Error("Kein freies Kürzel gefunden – bitte selbst eins angeben."); }
  let leaderUserId: number | null = null; let warning: string | null = null;
  if (input.leaderEmail) {
    const email = input.leaderEmail.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Bitte eine gültige E-Mail-Adresse angeben.");
    if (!input.leaderFirstName?.trim() || !input.leaderLastName?.trim()) throw new Error("Bitte Vor- und Nachnamen angeben.");
    const taken = (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1))[0]; if (taken) throw new Error("Zu dieser E-Mail-Adresse gibt es schon ein Konto.");
    const password = input.password?.trim() || `Agentur-${subIdSuffix()}`;
    const created = await createMember(db, tenantId, { firstName: input.leaderFirstName.trim(), lastName: input.leaderLastName.trim(), email, password, kind: "vertriebler", company: name, status: "aktiv" } as Parameters<typeof createMember>[2]);
    leaderUserId = created.userId;
    try { await scheduleOnboardingEmails(db, tenantId, created.membershipId, password); } catch { warning = "Konto angelegt, aber die Willkommens-Mail konnte nicht verschickt werden."; }
  }
  const inserted = await db.insert(d2dAgencies).values({ tenantId, name, code, leaderUserId, contactName: [input.leaderFirstName, input.leaderLastName].filter(Boolean).join(" ") || null, email: input.leaderEmail?.trim().toLowerCase() || null });
  return { id: Number(inserted[0]?.insertId) || 0, code, leaderUserId, warning };
}

/* ------------------------------------------------------------------ Agenturen & Vertriebler */

export async function listAgencies(db: Db, tenantId: number) {
  const agencies = await db.select().from(d2dAgencies).where(eq(d2dAgencies.tenantId, tenantId)).orderBy(asc(d2dAgencies.name));
  const reps = await db.select({ agencyId: d2dReps.agencyId }).from(d2dReps).where(and(eq(d2dReps.tenantId, tenantId), eq(d2dReps.active, true)));
  return agencies.map((agency) => ({ ...agency, repCount: reps.filter((rep) => rep.agencyId === agency.id).length }));
}

export async function saveAgency(db: Db, tenantId: number, input: { id?: number; name: string; contactName?: string | null; email?: string | null; phone?: string | null; notes?: string | null; active?: boolean }) {
  const values = { tenantId, name: input.name.trim(), contactName: input.contactName?.trim() || null, email: input.email?.trim() || null, phone: input.phone?.trim() || null, notes: input.notes?.trim() || null, active: input.active ?? true };
  if (input.id) { await db.update(d2dAgencies).set(values).where(and(eq(d2dAgencies.id, input.id), eq(d2dAgencies.tenantId, tenantId))); return { id: input.id }; }
  const inserted = await db.insert(d2dAgencies).values(values); return { id: Number(inserted[0]?.insertId) || 0 };
}

export async function deleteAgency(db: Db, tenantId: number, id: number) {
  await db.update(d2dReps).set({ agencyId: null }).where(and(eq(d2dReps.tenantId, tenantId), eq(d2dReps.agencyId, id)));
  await db.delete(d2dAgencies).where(and(eq(d2dAgencies.id, id), eq(d2dAgencies.tenantId, tenantId)));
  return { success: true as const };
}

export async function listReps(db: Db, tenantId: number) {
  const rows = await db.select({ rep: d2dReps, agency: d2dAgencies.name, user: users.name }).from(d2dReps).leftJoin(d2dAgencies, eq(d2dAgencies.id, d2dReps.agencyId)).leftJoin(users, eq(users.id, d2dReps.userId)).where(eq(d2dReps.tenantId, tenantId)).orderBy(asc(d2dReps.name));
  return rows.map(({ rep, agency, user }) => ({ ...rep, agencyName: agency, userName: user }));
}

export const SUB_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export async function saveRep(db: Db, tenantId: number, input: { id?: number; name: string; agencyId?: number | null; userId?: number | null; email?: string | null; phone?: string | null; subId?: string | null; active?: boolean; createLogin?: boolean; password?: string | null }) {
  const subId = input.subId?.trim() ? input.subId.trim() : null;
  if (subId && !SUB_ID_PATTERN.test(subId)) throw new Error("Sub-ID: nur Buchstaben, Ziffern, - und _ (max. 64 Zeichen).");
  if (subId) { const clash = (await db.select({ id: d2dReps.id }).from(d2dReps).where(and(eq(d2dReps.tenantId, tenantId), eq(d2dReps.subId, subId))).limit(1))[0]; if (clash && clash.id !== input.id) throw new Error(`Diese Sub-ID ist schon einem anderen Vertriebler zugeordnet. (${subId} ist bereits vergeben.)`); }
  let userId = input.userId ?? null; let warning: string | null = null;
  if (input.createLogin && input.email?.trim()) {
    const email = input.email.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Bitte eine gültige E-Mail-Adresse angeben.");
    const [firstName, ...rest] = input.name.trim().split(/\s+/); if (!firstName || !rest.length) throw new Error("Bitte Vor- und Nachnamen angeben.");
    const taken = (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1))[0]; if (taken) throw new Error("Zu dieser E-Mail-Adresse gibt es schon ein Konto.");
    const password = input.password?.trim() || `Haustuer-${subIdSuffix()}`;
    const created = await createMember(db, tenantId, { firstName, lastName: rest.join(" "), email, password, kind: "vertriebler", status: "aktiv" } as Parameters<typeof createMember>[2]);
    userId = created.userId;
    try { await scheduleOnboardingEmails(db, tenantId, created.membershipId, password); } catch { warning = "Konto angelegt, aber die Willkommens-Mail konnte nicht verschickt werden."; }
  }
  const values = { tenantId, name: input.name.trim(), agencyId: input.agencyId ?? null, userId, email: input.email?.trim() || null, phone: input.phone?.trim() || null, subId, active: input.active ?? true };
  if (input.id) { await db.update(d2dReps).set(values).where(and(eq(d2dReps.id, input.id), eq(d2dReps.tenantId, tenantId))); return { id: input.id, subId, warning }; }
  const inserted = await db.insert(d2dReps).values(values); return { id: Number(inserted[0]?.insertId) || 0, subId, warning };
}

export async function setRepActive(db: Db, tenantId: number, id: number, active: boolean) {
  const rep = (await db.select().from(d2dReps).where(and(eq(d2dReps.id, id), eq(d2dReps.tenantId, tenantId))).limit(1))[0]; if (!rep) throw new Error("Vertriebler wurde nicht gefunden.");
  await db.update(d2dReps).set({ active }).where(eq(d2dReps.id, id));
  if (rep.userId) await db.update(memberships).set({ status: active ? "aktiv" : "deaktiviert" }).where(and(eq(memberships.userId, rep.userId), eq(memberships.tenantId, tenantId))); // gesperrt = kein Login
  return { success: true as const };
}

/** Rolle des angemeldeten Nutzers im Haustür-Modul. */
export async function contextFor(db: Db, tenantId: number, userId: number) {
  const rep = await repForUser(db, tenantId, userId);
  const agency = (await db.select().from(d2dAgencies).where(and(eq(d2dAgencies.tenantId, tenantId), eq(d2dAgencies.leaderUserId, userId))).limit(1))[0];
  const settings = await ensureSettings(db, tenantId);
  return { role: rep ? "rep" as const : agency ? "leader" as const : "admin" as const, rep: rep ?? null, agencyId: agency?.id ?? null, agencyName: agency?.name ?? null, enabled: Boolean(settings.embedScriptUrl || settings.orderId || settings.categoryId), captureEnabled: Boolean(settings.categoryId || settings.orderId), embedScriptUrl: settings.embedScriptUrl ?? null, categoryId: settings.categoryId ?? null, buyerUserId: settings.buyerUserId ?? null };
}

export async function deleteRep(db: Db, tenantId: number, id: number) {
  const used = (await db.select({ id: d2dCaptures.id }).from(d2dCaptures).where(and(eq(d2dCaptures.tenantId, tenantId), eq(d2dCaptures.repId, id))).limit(1))[0];
  if (used) { await db.update(d2dReps).set({ active: false }).where(and(eq(d2dReps.id, id), eq(d2dReps.tenantId, tenantId))); return { deactivated: true as const }; }
  await db.delete(d2dReps).where(and(eq(d2dReps.id, id), eq(d2dReps.tenantId, tenantId)));
  return { deactivated: false as const };
}

/* ------------------------------------------------------------------ Erfassung */

export type CaptureInput = { repId: number; categoryId?: number | null; firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null; street?: string | null; houseNumber?: string | null; postcode?: string | null; city?: string | null; country?: string | null; notes?: string | null; salutation?: "herr" | "frau" | null; answers?: Record<string, unknown> | null; consentGiven: boolean; capturedAt?: Date | null; extra?: Record<string, unknown> };

/**
 * Haustür-Kontakt erfassen: Erfassung speichern, Lead anlegen (Status genehmigt), Regeln auslösen und – falls eine
 * Bestellung hinterlegt ist – direkt zuordnen und ausliefern. Ergebnis der Übermittlung landet an der Erfassung.
 */
export async function createCapture(db: Db, tenantId: number, userId: number | null, input: CaptureInput) {
  const rep = (await db.select().from(d2dReps).where(and(eq(d2dReps.id, input.repId), eq(d2dReps.tenantId, tenantId))).limit(1))[0];
  if (!rep) throw new Error("Vertriebler wurde nicht gefunden.");
  if (!rep.active) throw new Error("Der Vertriebler ist deaktiviert.");
  const settings = await ensureSettings(db, tenantId);
  const categoryId = input.categoryId ?? settings.categoryId; if (!categoryId) throw new Error("Vorerfassung ist für dein Konto nicht eingerichtet.");
  const category = (await db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(and(eq(leadCategories.id, categoryId), eq(leadCategories.tenantId, tenantId))).limit(1))[0];
  if (!category) throw new Error("Lead-Kategorie wurde nicht gefunden.");
  if (!input.consentGiven) throw new Error("Ohne Einwilligung des Kunden darf der Kontakt nicht weitergegeben werden.");
  const phone = normalizeRawPhone(input.phone); const email = input.email?.trim().toLowerCase() || null;
  if (!phone && !email) throw new Error("Bitte Telefonnummer oder E-Mail-Adresse erfassen.");
  if (input.postcode && !/^\d{5}$/.test(input.postcode.trim())) throw new Error("Bitte eine fünfstellige PLZ angeben.");
  if (!input.lastName?.trim() && !input.firstName?.trim()) throw new Error("Bitte den Namen des Kunden erfassen.");
  const agency = rep.agencyId ? (await db.select().from(d2dAgencies).where(eq(d2dAgencies.id, rep.agencyId)).limit(1))[0] : undefined;
  const supplier = settings.supplierId ? (await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.id, settings.supplierId)).limit(1))[0] : undefined;
  const capturedAt = input.capturedAt ?? new Date();
  const country = ["DE", "AT", "CH"].includes((input.country ?? "DE").toUpperCase()) ? (input.country ?? "DE").toUpperCase() as "DE" | "AT" | "CH" : "DE";
  const inserted = await db.insert(d2dCaptures).values({ tenantId, repId: rep.id, agencyId: rep.agencyId, categoryId: category.id, capturedAt, firstName: input.firstName?.trim() || null, lastName: input.lastName?.trim() || null, phone, email, street: input.street?.trim() || null, houseNumber: input.houseNumber?.trim() || null, postcode: input.postcode?.trim() || null, city: input.city?.trim() || null, country, notes: input.notes?.trim() || null, salutation: input.salutation ?? null, answers: input.answers ?? null, consentGiven: true, consentText: settings.consentText ?? DEFAULT_CONSENT, createdByUserId: userId });
  const captureId = Number(inserted[0]?.insertId) || 0;
  // Lead anlegen – derselbe Weg wie beim Import
  const publicId = nanoid(8).toUpperCase();
  const metadata: Record<string, unknown> = { ...(input.extra ?? {}), ...(input.answers ?? {}), street: [input.street?.trim(), input.houseNumber?.trim()].filter(Boolean).join(" ") || undefined, salutation: input.salutation ?? undefined, d2d_capture_id: captureId, d2d_sub_id: rep.subId, d2d_rep: rep.name, d2d_agency: agency?.name ?? null, d2d_captured_at: capturedAt.toISOString(), consent: true, consent_text: settings.consentText ?? DEFAULT_CONSENT, source: "Haustür" };
  const leadInsert = await db.insert(leads).values({ tenantId, publicId, categoryId: category.id, firstName: input.firstName?.trim() || null, lastName: input.lastName?.trim() || null, email, phone, postcode: input.postcode?.trim() || null, city: input.city?.trim() || null, country, supplierId: supplier?.id ?? null, supplierName: supplier?.name ?? `Haustür: ${agency?.name ?? rep.name}`, cost: "0.00", metadata, status: "genehmigt" });
  const leadId = Number(leadInsert[0]?.insertId) || 0;
  await db.insert(leadStatusEvents).values({ tenantId, leadId, nextStatus: "genehmigt", actorUserId: userId, note: `Haustür-Erfassung durch ${rep.name} (Sub-ID ${rep.subId})${agency ? `, ${agency.name}` : ""}` });
  await db.update(d2dCaptures).set({ leadId }).where(eq(d2dCaptures.id, captureId));
  const automation = await triggerLeadAutomations(db, { tenantId, actorUserId: userId, leadId, triggerType: "lead_erstellt" });
  await triggerLeadAutomations(db, { tenantId, actorUserId: userId, leadId, triggerType: "status_geändert" });
  let lead = (await db.select().from(leads).where(eq(leads.id, leadId)).limit(1))[0];
  let deliveryNote: string | null = null;
  if (settings.buyerUserId && lead.status !== "zugewiesen") {
    const buyer = (await db.select({ id: users.id, name: users.name, company: users.company }).from(users).where(eq(users.id, settings.buyerUserId)).limit(1))[0];
    if (buyer) { await db.insert(leadDeliveries).values({ tenantId, leadId, buyerName: buyer.company || buyer.name || "Käufer", unitPrice: "0.00", result: "angenommen", acceptedAt: new Date(), skipReason: null }); await db.update(leads).set({ status: "zugewiesen", assignedUserId: buyer.id, assignedAt: new Date(), metadata: { ...metadata, assignedBuyerUserId: buyer.id, d2d_direct_sale: true } }).where(eq(leads.id, leadId)); await db.insert(leadStatusEvents).values({ tenantId, leadId, previousStatus: "genehmigt", nextStatus: "zugewiesen", actorUserId: userId, note: `Direkt verkauft an ${buyer.company || buyer.name} (Haustür-Zuweisung, ohne Bestellung/Abrechnung/API)` }); lead = (await db.select().from(leads).where(eq(leads.id, leadId)).limit(1))[0]; deliveryNote = `Direkt verkauft an ${buyer.company || buyer.name}`; }
  }
  if (settings.orderId && lead.status !== "zugewiesen") {
    // Direkte Zuordnung zur hinterlegten Aroundhome-Bestellung, wenn keine Regel gegriffen hat
    const order = (await db.select().from(orders).where(and(eq(orders.id, settings.orderId), eq(orders.tenantId, tenantId))).limit(1))[0];
    if (order) {
      await db.update(leads).set({ metadata: { ...metadata, assignedOrderId: order.id, assignedOrderNumber: order.orderNumber } }).where(eq(leads.id, leadId));
      lead = (await db.select().from(leads).where(eq(leads.id, leadId)).limit(1))[0];
      try { const result = await deliverLeadNow(db, { tenantId, actorUserId: userId, lead, preferOrderId: order.id }); deliveryNote = result.result === "abgelehnt" ? `Aroundhome hat abgelehnt: ${result.attempts.map((attempt) => attempt.reason).filter(Boolean).join("; ") || "ohne Angabe"}` : `Übermittelt an ${result.buyerName} (${result.result})`; }
      catch (error) { deliveryNote = error instanceof Error ? error.message : "Zustellung fehlgeschlagen"; }
      lead = (await db.select().from(leads).where(eq(leads.id, leadId)).limit(1))[0];
    }
  }
  const finalMeta = lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata) ? (lead.metadata as Record<string, unknown>) : {};
  const partnerReference = typeof finalMeta.partnerReference === "string" ? finalMeta.partnerReference : null;
  const status = lead.status === "zugewiesen" ? "uebermittelt" : deliveryNote?.startsWith("Aroundhome hat abgelehnt") || deliveryNote?.includes("fehlgeschlagen") ? "fehler" : "vorerfasst";
  if (status === "vorerfasst" && !deliveryNote) deliveryNote = automation.delivered ? "Über Regeln ausgeliefert" : settings.orderId ? "Noch nicht übermittelt – keine passende Bestellung/Regel" : "Vorerfasst (Genehmigt) – jetzt bei Aroundhome eintragen";
  await db.update(d2dCaptures).set({ status, partnerReference, deliveryNote: deliveryNote?.slice(0, 320) ?? null }).where(eq(d2dCaptures.id, captureId));
  return { captureId, leadId, publicId, status, partnerReference, deliveryNote, leadStatus: lead.status };
}

/** Erneuter Versuch für eine Erfassung ohne Übermittlung. */
export async function retryCapture(db: Db, tenantId: number, userId: number | null, captureId: number) {
  const capture = (await db.select().from(d2dCaptures).where(and(eq(d2dCaptures.id, captureId), eq(d2dCaptures.tenantId, tenantId))).limit(1))[0];
  if (!capture?.leadId) throw new Error("Erfassung wurde nicht gefunden.");
  const lead = (await db.select().from(leads).where(eq(leads.id, capture.leadId)).limit(1))[0];
  if (!lead) throw new Error("Lead wurde nicht gefunden.");
  if (lead.status === "zugewiesen") { await db.update(d2dCaptures).set({ status: "uebermittelt" }).where(eq(d2dCaptures.id, captureId)); return { status: "uebermittelt" as const, note: "Bereits übermittelt" }; }
  const settings = await ensureSettings(db, tenantId);
  try {
    const result = await deliverLeadNow(db, { tenantId, actorUserId: userId, lead: { ...lead, status: lead.status === "fehlerhaft" ? "genehmigt" : lead.status }, preferOrderId: settings.orderId ?? undefined, allowRepeat: true });
    const updated = (await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1))[0];
    const meta = updated.metadata && typeof updated.metadata === "object" && !Array.isArray(updated.metadata) ? (updated.metadata as Record<string, unknown>) : {};
    const status = result.result === "abgelehnt" ? "fehler" : "uebermittelt";
    const note = result.result === "abgelehnt" ? `Aroundhome hat abgelehnt: ${result.attempts.map((attempt) => attempt.reason).filter(Boolean).join("; ")}` : `Übermittelt an ${result.buyerName}`;
    await db.update(d2dCaptures).set({ status, partnerReference: typeof meta.partnerReference === "string" ? meta.partnerReference : capture.partnerReference, deliveryNote: note.slice(0, 320) }).where(eq(d2dCaptures.id, captureId));
    return { status, note };
  } catch (error) { const note = error instanceof Error ? error.message : "Zustellung fehlgeschlagen"; await db.update(d2dCaptures).set({ status: "fehler", deliveryNote: note.slice(0, 320) }).where(eq(d2dCaptures.id, captureId)); return { status: "fehler" as const, note }; }
}

export type RangeFilter = { repId?: number | null; agencyId?: number | null; from?: Date | null; until?: Date | null };

export async function listCaptures(db: Db, tenantId: number, filter: RangeFilter & { limit?: number } = {}) {
  const conditions = [eq(d2dCaptures.tenantId, tenantId)];
  if (filter.repId) conditions.push(eq(d2dCaptures.repId, filter.repId)); if (filter.agencyId) conditions.push(eq(d2dCaptures.agencyId, filter.agencyId));
  if (filter.from) conditions.push(gte(d2dCaptures.capturedAt, filter.from)); if (filter.until) conditions.push(lte(d2dCaptures.capturedAt, filter.until));
  const rows = await db.select({ capture: d2dCaptures, rep: d2dReps.name, subId: d2dReps.subId, agency: d2dAgencies.name, category: leadCategories.shortcode, leadPublicId: leads.publicId, leadStatus: leads.status }).from(d2dCaptures).innerJoin(d2dReps, eq(d2dReps.id, d2dCaptures.repId)).leftJoin(d2dAgencies, eq(d2dAgencies.id, d2dCaptures.agencyId)).leftJoin(leadCategories, eq(leadCategories.id, d2dCaptures.categoryId)).leftJoin(leads, eq(leads.id, d2dCaptures.leadId)).where(and(...conditions)).orderBy(desc(d2dCaptures.capturedAt)).limit(filter.limit ?? 500);
  return rows.map(({ capture, rep, subId, agency, category, leadPublicId, leadStatus }) => ({ ...capture, repName: rep, subId, agencyName: agency, categoryShortcode: category, leadPublicId, leadStatus, name: [capture.firstName, capture.lastName].filter(Boolean).join(" ") || "–" }));
}

/** Übersicht: Kennzahlen, Verlauf je Tag, Top-Agenturen und Top-3-Vertriebler – Aroundhome-Zahlen je Sub-ID und Tag. */
export async function overview(db: Db, tenantId: number, filter: RangeFilter = {}) {
  const until = filter.until ?? new Date(new Date().setHours(23, 59, 59, 999)); const from = filter.from ?? new Date(new Date(until.getTime() - 6 * 24 * 3_600_000).setHours(0, 0, 0, 0)); // Tagesgrenzen, damit sekundengenau gespeicherte Erfassungen nicht herausfallen
  const reps = await db.select({ rep: d2dReps, agency: d2dAgencies.name }).from(d2dReps).leftJoin(d2dAgencies, eq(d2dAgencies.id, d2dReps.agencyId)).where(eq(d2dReps.tenantId, tenantId));
  const scoped = reps.filter(({ rep }) => (!filter.repId || rep.id === filter.repId) && (!filter.agencyId || rep.agencyId === filter.agencyId));
  const subIds = scoped.map(({ rep }) => rep.subId).filter((value): value is string => Boolean(value));
  const captures = await listCaptures(db, tenantId, { ...filter, from, until, limit: 5000 });
  const stats = subIds.length ? await db.select().from(d2dDailyStats).where(and(eq(d2dDailyStats.tenantId, tenantId), inArray(d2dDailyStats.subId, subIds), gte(d2dDailyStats.day, dayKey(from)), lte(d2dDailyStats.day, dayKey(until)))) : [];
  const sum = (key: "total" | "qualified" | "open" | "cancelled") => stats.reduce((acc, row) => acc + row[key], 0);
  const days: Array<{ day: string; captured: number; submitted: number; qualified: number; open: number; cancelled: number }> = [];
  for (let cursor = new Date(from); cursor <= until; cursor = new Date(cursor.getTime() + 24 * 3_600_000)) { const day = dayKey(cursor); const own = captures.filter((capture) => dayKey(capture.capturedAt) === day); const partner = stats.filter((row) => row.day === day); days.push({ day, captured: own.length, submitted: own.filter((capture) => capture.status === "uebermittelt").length, qualified: partner.reduce((acc, row) => acc + row.qualified, 0), open: partner.reduce((acc, row) => acc + row.open, 0), cancelled: partner.reduce((acc, row) => acc + row.cancelled, 0) }); }
  const byAgency = new Map<string, { agency: string; agencyId: number | null; captured: number; submitted: number; qualified: number; ah: number; reps: number }>();
  for (const { rep, agency } of scoped) { const key = agency ?? "Ohne Agentur (direkt)"; const entry = byAgency.get(key) ?? { agency: key, agencyId: rep.agencyId ?? null, captured: 0, submitted: 0, qualified: 0, ah: 0, reps: 0 }; entry.reps += 1; const partner = stats.filter((row) => row.subId === rep.subId); entry.qualified += partner.reduce((acc, row) => acc + row.qualified, 0); entry.ah += partner.reduce((acc, row) => acc + row.total, 0); byAgency.set(key, entry); }
  for (const capture of captures) { const key = capture.agencyName ?? "Ohne Agentur (direkt)"; const entry = byAgency.get(key) ?? { agency: key, agencyId: capture.agencyId ?? null, captured: 0, submitted: 0, qualified: 0, ah: 0, reps: 0 }; entry.captured += 1; if (capture.status === "uebermittelt") entry.submitted += 1; byAgency.set(key, entry); }
  const byRep = scoped.map(({ rep, agency }) => { const own = captures.filter((capture) => capture.repId === rep.id); const partner = stats.filter((row) => row.subId === rep.subId); return { repId: rep.id, name: rep.name, subId: rep.subId, agency, active: rep.active, ah: partner.reduce((acc, row) => acc + row.total, 0), open: partner.reduce((acc, row) => acc + row.open, 0), cancelled: partner.reduce((acc, row) => acc + row.cancelled, 0), captured: own.length, submitted: own.filter((capture) => capture.status === "uebermittelt").length, qualified: partner.reduce((acc, row) => acc + row.qualified, 0) }; });
  const agenciesRanked = Array.from(byAgency.values()).sort((a, b) => b.captured - a.captured || b.qualified - a.qualified);
  const repsRanked = [...byRep].sort((a, b) => b.captured - a.captured || b.ah - a.ah || b.qualified - a.qualified);
  return { from, until, kpis: { captured: captures.length, submitted: captures.filter((capture) => capture.status === "uebermittelt").length, failed: captures.filter((capture) => capture.status === "fehler").length, aroundhomeTotal: sum("total"), qualified: sum("qualified"), open: sum("open"), cancelled: sum("cancelled") }, days, topAgencies: agenciesRanked, topReps: repsRanked.filter((rep) => rep.captured > 0 || rep.ah > 0).slice(0, 3), reps: repsRanked, lastSync: stats.reduce<Date | null>((latest, row) => (!latest || row.syncedAt > latest ? row.syncedAt : latest), null) };
}

export function capturesToCsv(rows: Awaited<ReturnType<typeof listCaptures>>) {
  const escape = (value: unknown) => { const text = value === null || value === undefined ? "" : String(value); return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const stamp = (date: Date) => date.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
  const header = ["Erfasst am", "Nr.", "Vertriebler", "Sub-ID", "Agentur", "Anrede", "Vorname", "Nachname", "Telefon", "E-Mail", "Straße", "PLZ", "Ort", "Notiz"];
  const lines = rows.map((row) => [stamp(row.capturedAt), row.leadPublicId ?? row.id, row.repName, row.subId, row.agencyName, row.salutation === "herr" ? "Herr" : row.salutation === "frau" ? "Frau" : "", row.firstName, row.lastName, row.phone, row.email, [row.street, row.houseNumber].filter(Boolean).join(" "), row.postcode, row.city, row.notes].map(escape).join(";"));
  return "\uFEFF" + [header.join(";"), ...lines].join("\r\n");
}

/** Kontakt korrigieren – gilt nur bei uns; was bei Aroundhome erfasst wurde, bleibt unverändert. */
export async function updateCapture(db: Db, tenantId: number, captureId: number, input: { salutation?: "herr" | "frau" | null; firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null; street?: string | null; houseNumber?: string | null; postcode?: string | null; city?: string | null; notes?: string | null; answers?: Record<string, unknown> | null }, options: { repId?: number | null } = {}) {
  const capture = (await db.select().from(d2dCaptures).where(and(eq(d2dCaptures.id, captureId), eq(d2dCaptures.tenantId, tenantId))).limit(1))[0];
  if (!capture) throw new Error("Kontakt nicht gefunden."); if (options.repId && capture.repId !== options.repId) throw new Error("Keine Berechtigung.");
  if (input.postcode && !/^\d{5}$/.test(input.postcode.trim())) throw new Error("Bitte eine fünfstellige PLZ angeben.");
  const phone = input.phone !== undefined ? normalizeRawPhone(input.phone) : capture.phone; const email = input.email !== undefined ? (input.email?.trim().toLowerCase() || null) : capture.email;
  const patch = { salutation: input.salutation !== undefined ? input.salutation : capture.salutation, firstName: input.firstName !== undefined ? input.firstName?.trim() || null : capture.firstName, lastName: input.lastName !== undefined ? input.lastName?.trim() || null : capture.lastName, phone, email, street: input.street !== undefined ? input.street?.trim() || null : capture.street, houseNumber: input.houseNumber !== undefined ? input.houseNumber?.trim() || null : capture.houseNumber, postcode: input.postcode !== undefined ? input.postcode?.trim() || null : capture.postcode, city: input.city !== undefined ? input.city?.trim() || null : capture.city, notes: input.notes !== undefined ? input.notes?.trim() || null : capture.notes, answers: input.answers !== undefined ? input.answers : capture.answers };
  if (!patch.firstName && !patch.lastName) throw new Error("Bitte Vor- und Nachnamen angeben.");
  await db.update(d2dCaptures).set(patch).where(eq(d2dCaptures.id, captureId));
  if (capture.leadId) { const lead = (await db.select().from(leads).where(eq(leads.id, capture.leadId)).limit(1))[0]; if (lead) { const meta = lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata) ? (lead.metadata as Record<string, unknown>) : {}; await db.update(leads).set({ firstName: patch.firstName, lastName: patch.lastName, phone: patch.phone, email: patch.email, postcode: patch.postcode, city: patch.city, metadata: { ...meta, ...(patch.answers ?? {}), street: [patch.street, patch.houseNumber].filter(Boolean).join(" ") || undefined, salutation: patch.salutation ?? undefined } }).where(eq(leads.id, lead.id)); } }
  return { success: true as const };
}

/** Tagesabgleich aus Aroundhome-Transaktionen (aufgerufen vom Aroundhome-Sync mit Zeilen, die eine Sub-ID tragen). */
export async function upsertDailyStats(db: Db, tenantId: number, accountId: number | null, rows: Array<{ subId: string; day: string; status: "qualified" | "open" | "cancelled" }>) {
  const grouped = new Map<string, { subId: string; day: string; total: number; qualified: number; open: number; cancelled: number }>();
  for (const row of rows) { const key = `${row.subId}|${row.day}`; const entry = grouped.get(key) ?? { subId: row.subId, day: row.day, total: 0, qualified: 0, open: 0, cancelled: 0 }; entry.total += 1; entry[row.status] += 1; grouped.set(key, entry); }
  for (const entry of Array.from(grouped.values())) {
    const existing = (await db.select({ id: d2dDailyStats.id }).from(d2dDailyStats).where(and(eq(d2dDailyStats.tenantId, tenantId), eq(d2dDailyStats.subId, entry.subId), eq(d2dDailyStats.day, entry.day))).limit(1))[0];
    if (existing) await db.update(d2dDailyStats).set({ accountId, total: entry.total, qualified: entry.qualified, open: entry.open, cancelled: entry.cancelled }).where(eq(d2dDailyStats.id, existing.id));
    else await db.insert(d2dDailyStats).values({ tenantId, accountId, ...entry });
  }
  return { days: grouped.size };
}

export const repForUser = async (db: Db, tenantId: number, userId: number): Promise<D2dRep | undefined> => (await db.select().from(d2dReps).where(and(eq(d2dReps.tenantId, tenantId), eq(d2dReps.userId, userId))).limit(1))[0];
