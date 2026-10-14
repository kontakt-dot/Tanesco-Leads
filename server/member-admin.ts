/**
 * Benutzerbereich (Vorbild: Leadfy „Benutzer“): Stammdaten, Passwort, Reklamation, Zahlung, Benachrichtigungen,
 * Ansicht, Lieferant (Provision, Token, eingehende Mappings), Guthaben und Aktivität je Mitglied.
 */
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { apiTokens, balanceTransactions, claims, impersonationSessions, integrationEvents, leadCategories, leadDeliveries, leadStatusEvents, leads, memberOperationalSettings, memberships, orderOperationalConfigs, orders, reclamationReasons, supplierInboundMappings, suppliers, users } from "../drizzle/schema";
import { hashPassword } from "./_core/auth";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./integration-secrets";
import type { Db } from "./lead-pipeline";
import { buildLeadExportPayload } from "./lead-integration-export";

export const BUYER_AREAS = ["Angebote", "Shop", "Marktplatz", "Guthaben", "Pipeline", "Bestellungen", "Käufe", "Reklamationen", "Lead-Import", "E-Mails", "Support", "Integrationen", "Team", "App-Download-Logos"] as const;

type Settings = typeof memberOperationalSettings.$inferSelect;

export async function requireMembership(db: Db, tenantId: number, membershipId: number) {
  const row = (await db.select({ membership: memberships, user: users }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, tenantId))).limit(1))[0];
  if (!row) throw new Error("Der Benutzer gehört nicht zu diesem Lead-Bereich.");
  return row;
}

/** Legt die Einstellungszeile bei Bedarf mit Standardwerten an und liefert sie zurück. */
export async function ensureMemberSettings(db: Db, tenantId: number, membershipId: number): Promise<Settings> {
  const existing = (await db.select().from(memberOperationalSettings).where(and(eq(memberOperationalSettings.tenantId, tenantId), eq(memberOperationalSettings.membershipId, membershipId))).limit(1))[0];
  if (existing) return existing;
  await db.insert(memberOperationalSettings).values({ tenantId, membershipId });
  return (await db.select().from(memberOperationalSettings).where(and(eq(memberOperationalSettings.tenantId, tenantId), eq(memberOperationalSettings.membershipId, membershipId))).limit(1))[0];
}

async function linkedSupplier(db: Db, tenantId: number, userId: number) {
  return (await db.select().from(suppliers).where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.userId, userId))).limit(1))[0];
}

export async function getMemberDetail(db: Db, tenantId: number, membershipId: number) {
  const { membership, user } = await requireMembership(db, tenantId, membershipId);
  const settings = await ensureMemberSettings(db, tenantId, membershipId);
  const [supplier, tokens, mappings, transactions, buyerOrders, categories, reasons] = await Promise.all([
    linkedSupplier(db, tenantId, user.id),
    db.select({ id: apiTokens.id, name: apiTokens.name, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt, revokedAt: apiTokens.revokedAt }).from(apiTokens).where(and(eq(apiTokens.tenantId, tenantId), eq(apiTokens.membershipId, membershipId))).orderBy(desc(apiTokens.createdAt)),
    db.select().from(supplierInboundMappings).where(and(eq(supplierInboundMappings.tenantId, tenantId), eq(supplierInboundMappings.membershipId, membershipId))),
    db.select().from(balanceTransactions).where(and(eq(balanceTransactions.tenantId, tenantId), eq(balanceTransactions.membershipId, membershipId))).orderBy(desc(balanceTransactions.createdAt), desc(balanceTransactions.id)).limit(50),
    db.select({ order: orders, config: orderOperationalConfigs }).from(orderOperationalConfigs).innerJoin(orders, eq(orders.id, orderOperationalConfigs.orderId)).where(and(eq(orderOperationalConfigs.tenantId, tenantId), eq(orderOperationalConfigs.buyerUserId, user.id))).orderBy(desc(orders.createdAt)),
    db.select({ id: leadCategories.id, name: leadCategories.name, shortcode: leadCategories.shortcode }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId)),
    db.select({ id: reclamationReasons.id, name: reclamationReasons.name, active: reclamationReasons.active }).from(reclamationReasons).where(eq(reclamationReasons.tenantId, tenantId)).orderBy(reclamationReasons.sortOrder),
  ]);
  const activeToken = tokens.find((token) => !token.revokedAt) ?? null;
  const { passwordHash: _hash, ...safeUser } = user;
  return {
    membership: { id: membership.id, role: membership.role, partnerType: membership.partnerType, status: membership.status, integrationId: membership.integrationId, teamId: membership.teamId, createdAt: membership.createdAt },
    user: safeUser,
    settings,
    supplier: supplier ? { id: supplier.id, name: supplier.name, email: supplier.email, status: supplier.status } : null,
    token: activeToken ? { id: activeToken.id, createdAt: activeToken.createdAt, lastUsedAt: activeToken.lastUsedAt } : null,
    mappings,
    transactions,
    orders: buyerOrders.map(({ order, config }) => ({ id: order.id, orderNumber: order.orderNumber, name: order.name, status: order.status, quantity: order.quantity, deliveredCount: order.deliveredCount, unitPrice: order.unitPrice, categoryId: order.categoryId, createdAt: order.createdAt, active: config.active, realtimeDelivery: config.realtimeDelivery })),
    categories,
    reasons,
    buyerAreas: BUYER_AREAS,
  };
}

export type CreateMemberInput = { firstName: string; lastName: string; company?: string; phone?: string; email: string; password: string; kind: "benutzer" | "admin" | "vertriebler"; status: "aktiv" | "inaktiv"; billingStreet?: string; billingPostalCode?: string; billingCity?: string; billingCountry?: string };

/** „Neuen Benutzer anlegen“: Konto mit Passwort + aktive Mitgliedschaft; Benutzer = Käufer/Lieferant, Admin = Verwaltung, Vertriebler = Vertrieb. */
export async function createMember(db: Db, tenantId: number, input: CreateMemberInput) {
  const email = input.email.trim().toLowerCase();
  const existingUser = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  let userId = existingUser?.id;
  if (!userId) {
    const openId = `local_${nanoid(24)}`;
    await db.insert(users).values({ openId, name: `${input.firstName} ${input.lastName}`.trim(), email, loginMethod: "password", passwordHash: await hashPassword(input.password), role: "user", lastSignedIn: new Date(), firstName: input.firstName, lastName: input.lastName, company: input.company, phone: input.phone, billingStreet: input.billingStreet, billingPostalCode: input.billingPostalCode, billingCity: input.billingCity, billingCountry: input.billingCountry });
    userId = (await db.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1))[0]?.id;
  } else {
    const alreadyMember = (await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId))).limit(1))[0];
    if (alreadyMember) throw new Error("Für diese E-Mail-Adresse gibt es bereits einen Benutzer in diesem Lead-Bereich.");
    await db.update(users).set({ passwordHash: await hashPassword(input.password), loginMethod: "password", firstName: input.firstName, lastName: input.lastName, company: input.company, phone: input.phone }).where(eq(users.id, userId));
  }
  if (!userId) throw new Error("Das Konto konnte nicht angelegt werden.");
  const role = input.kind === "admin" ? "admin" : input.kind === "vertriebler" ? "vertrieb" : "manager";
  const partnerType = input.kind === "benutzer" ? "käufer" : "intern";
  const inserted = await db.insert(memberships).values({ tenantId, userId, role, partnerType, status: input.status === "aktiv" ? "aktiv" : "deaktiviert" });
  const membershipId = Number(inserted[0]?.insertId) || 0;
  await ensureMemberSettings(db, tenantId, membershipId);
  return { membershipId, userId };
}

export async function updateMemberProfile(db: Db, tenantId: number, membershipId: number, input: { salutation?: string | null; firstName?: string; lastName?: string; company?: string | null; phone?: string | null; billingStreet?: string | null; billingPostalCode?: string | null; billingCity?: string | null; billingCountry?: string | null; kind?: "benutzer" | "admin" | "vertriebler"; active?: boolean; duplicateProtection?: boolean; inboundPrePing?: boolean }) {
  const { membership, user } = await requireMembership(db, tenantId, membershipId);
  const name = [input.firstName ?? user.firstName ?? "", input.lastName ?? user.lastName ?? ""].join(" ").trim() || user.name;
  await db.update(users).set({ salutation: input.salutation ?? user.salutation, firstName: input.firstName ?? user.firstName, lastName: input.lastName ?? user.lastName, name, company: input.company ?? user.company, phone: input.phone ?? user.phone, billingStreet: input.billingStreet ?? user.billingStreet, billingPostalCode: input.billingPostalCode ?? user.billingPostalCode, billingCity: input.billingCity ?? user.billingCity, billingCountry: input.billingCountry ?? user.billingCountry }).where(eq(users.id, user.id));
  if (input.kind && membership.role !== "inhaber") {
    await db.update(memberships).set({ role: input.kind === "admin" ? "admin" : input.kind === "vertriebler" ? "vertrieb" : membership.partnerType === "intern" ? "manager" : membership.role, partnerType: input.kind === "benutzer" ? (membership.partnerType === "intern" ? "käufer" : membership.partnerType) : "intern" }).where(eq(memberships.id, membershipId));
  }
  if (typeof input.active === "boolean" && membership.role !== "inhaber") await db.update(memberships).set({ status: input.active ? "aktiv" : "deaktiviert" }).where(eq(memberships.id, membershipId));
  if (typeof input.duplicateProtection === "boolean" || typeof input.inboundPrePing === "boolean") {
    await ensureMemberSettings(db, tenantId, membershipId);
    await db.update(memberOperationalSettings).set({ ...(typeof input.duplicateProtection === "boolean" ? { duplicateProtection: input.duplicateProtection } : {}), ...(typeof input.inboundPrePing === "boolean" ? { inboundPrePing: input.inboundPrePing } : {}) }).where(eq(memberOperationalSettings.membershipId, membershipId));
  }
  return { success: true as const };
}

export async function updateMemberSettings(db: Db, tenantId: number, membershipId: number, values: Partial<Omit<Settings, "id" | "tenantId" | "membershipId" | "updatedAt">>) {
  await requireMembership(db, tenantId, membershipId);
  await ensureMemberSettings(db, tenantId, membershipId);
  await db.update(memberOperationalSettings).set(values).where(and(eq(memberOperationalSettings.tenantId, tenantId), eq(memberOperationalSettings.membershipId, membershipId)));
  return { success: true as const };
}

export async function setMemberPassword(db: Db, tenantId: number, membershipId: number, password: string) {
  const { user } = await requireMembership(db, tenantId, membershipId);
  await db.update(users).set({ passwordHash: await hashPassword(password), loginMethod: "password" }).where(eq(users.id, user.id));
  return { success: true as const };
}

/** Guthaben aufladen/abbuchen (Käufer) bzw. Auszahlung verbuchen (Lieferant). */
export async function adjustMemberBalance(db: Db, tenantId: number, membershipId: number, actorUserId: number, input: { kind: "aufladung" | "abbuchung" | "auszahlung"; amount: number; description?: string }) {
  await requireMembership(db, tenantId, membershipId);
  const settings = await ensureMemberSettings(db, tenantId, membershipId);
  const amount = Math.round(input.amount * 100) / 100;
  if (!(amount > 0)) throw new Error("Der Betrag muss größer als 0 sein.");
  if (input.kind === "auszahlung") {
    const balance = Number(settings.supplierBalance);
    if (amount > balance + 0.001) throw new Error(`Das Lieferanten-Guthaben (${balance.toFixed(2)} €) reicht für diese Auszahlung nicht.`);
    await db.update(memberOperationalSettings).set({ supplierBalance: (balance - amount).toFixed(2) }).where(eq(memberOperationalSettings.membershipId, membershipId));
  } else {
    const balance = Number(settings.prepaidBalance);
    const next = input.kind === "aufladung" ? balance + amount : balance - amount;
    await db.update(memberOperationalSettings).set({ prepaidBalance: next.toFixed(2) }).where(eq(memberOperationalSettings.membershipId, membershipId));
  }
  await db.insert(balanceTransactions).values({ tenantId, membershipId, kind: input.kind, amount: amount.toFixed(2), description: input.description?.trim() || null, actorUserId });
  const updated = await ensureMemberSettings(db, tenantId, membershipId);
  return { prepaidBalance: updated.prepaidBalance, supplierBalance: updated.supplierBalance };
}

/** Reiter „Lieferant“: schaltet den Benutzer als Lieferant frei (legt den Lieferanten-Datensatz an) und speichert Provisionssätze. */
export async function updateSupplierSettings(db: Db, tenantId: number, membershipId: number, input: { supplierActive: boolean; commissionOnEverySale: boolean; commissionRates: Record<string, { type: "keine" | "fix" | "prozent"; value: number }> }) {
  const { user } = await requireMembership(db, tenantId, membershipId);
  await ensureMemberSettings(db, tenantId, membershipId);
  await db.update(memberOperationalSettings).set({ supplierActive: input.supplierActive, commissionOnEverySale: input.commissionOnEverySale, commissionRates: input.commissionRates }).where(eq(memberOperationalSettings.membershipId, membershipId));
  let supplier = await linkedSupplier(db, tenantId, user.id);
  if (input.supplierActive && !supplier) {
    const name = user.company?.trim() || user.name?.trim() || user.email || `Lieferant ${membershipId}`;
    const byEmail = user.email ? (await db.select().from(suppliers).where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.email, user.email))).limit(1))[0] : undefined;
    if (byEmail) { await db.update(suppliers).set({ userId: user.id, status: "aktiv" }).where(eq(suppliers.id, byEmail.id)); supplier = { ...byEmail, userId: user.id }; }
    else { const inserted = await db.insert(suppliers).values({ tenantId, name, email: user.email ?? null, userId: user.id, status: "aktiv" }); supplier = (await db.select().from(suppliers).where(eq(suppliers.id, Number(inserted[0]?.insertId))).limit(1))[0]; }
  } else if (supplier) {
    await db.update(suppliers).set({ status: input.supplierActive ? "aktiv" : "inaktiv" }).where(eq(suppliers.id, supplier.id));
  }
  return { supplierId: supplier?.id ?? null };
}

/** Persönlicher Import-Token des Lieferanten (max. 120 Importe/Minute, Rotieren macht den alten ungültig). */
export async function issueSupplierToken(db: Db, tenantId: number, membershipId: number) {
  await requireMembership(db, tenantId, membershipId);
  const token = `fx_${nanoid(40)}`;
  await db.update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.tenantId, tenantId), eq(apiTokens.membershipId, membershipId)));
  await db.insert(apiTokens).values({ tenantId, membershipId, name: `Lieferanten-Token #${membershipId}`, tokenHash: createHash("sha256").update(token).digest("hex"), tokenEncrypted: encryptIntegrationSecret(token), scopes: ["leads:write"] });
  return { token };
}

export async function revealSupplierToken(db: Db, tenantId: number, membershipId: number) {
  await requireMembership(db, tenantId, membershipId);
  const row = (await db.select().from(apiTokens).where(and(eq(apiTokens.tenantId, tenantId), eq(apiTokens.membershipId, membershipId))).orderBy(desc(apiTokens.createdAt)).limit(1))[0];
  if (!row || row.revokedAt) return { token: null };
  return { token: row.tokenEncrypted ? decryptIntegrationSecret(row.tokenEncrypted) : null };
}

export type InboundMappingInput = { kind: "kategorie" | "feld" | "wert"; categoryId?: number | null; fieldKey?: string | null; sourceValue: string; targetValue: string; strict?: boolean };

export async function saveSupplierInboundMappings(db: Db, tenantId: number, membershipId: number, kind: InboundMappingInput["kind"], rows: InboundMappingInput[], categoryId?: number | null) {
  await requireMembership(db, tenantId, membershipId);
  const conditions = [eq(supplierInboundMappings.tenantId, tenantId), eq(supplierInboundMappings.membershipId, membershipId), eq(supplierInboundMappings.kind, kind)];
  if (kind === "wert" && categoryId) conditions.push(eq(supplierInboundMappings.categoryId, categoryId));
  await db.delete(supplierInboundMappings).where(and(...conditions));
  const values = rows.filter((row) => row.sourceValue.trim() && row.targetValue.trim()).map((row) => ({ tenantId, membershipId, kind, categoryId: row.categoryId ?? (kind === "wert" ? categoryId ?? null : null), fieldKey: row.fieldKey?.trim() || null, sourceValue: row.sourceValue.trim().slice(0, 255), targetValue: row.targetValue.trim().slice(0, 255), strict: Boolean(row.strict) }));
  if (values.length) await db.insert(supplierInboundMappings).values(values);
  return { count: values.length };
}

/** „Provisionen pro Kontakt“: Verkäufe der Leads dieses Lieferanten im Zeitraum mit dem hinterlegten Satz. */
export async function listSupplierCommissions(db: Db, tenantId: number, membershipId: number, range: { from: Date; to: Date }) {
  const { user } = await requireMembership(db, tenantId, membershipId);
  const settings = await ensureMemberSettings(db, tenantId, membershipId);
  const supplier = await linkedSupplier(db, tenantId, user.id);
  if (!supplier) return { rows: [], total: 0 };
  const rates = (settings.commissionRates ?? {}) as Record<string, { type: string; value: number }>;
  const deliveries = await db.select({ delivery: leadDeliveries, lead: leads }).from(leadDeliveries).innerJoin(leads, eq(leads.id, leadDeliveries.leadId)).where(and(eq(leadDeliveries.tenantId, tenantId), eq(leads.supplierId, supplier.id), inArray(leadDeliveries.result, ["angeboten", "angenommen"]), gte(leadDeliveries.occurredAt, range.from), lte(leadDeliveries.occurredAt, range.to))).orderBy(desc(leadDeliveries.occurredAt));
  const seen = new Set<number>(); const rows: Array<{ leadId: number; publicId: string; categoryId: number; buyerName: string; unitPrice: string; occurredAt: Date; commission: number }> = [];
  for (const { delivery, lead } of deliveries) {
    if (!settings.commissionOnEverySale && seen.has(lead.id)) continue; seen.add(lead.id);
    const rate = rates[String(lead.categoryId)]; if (!rate || rate.type === "keine") continue;
    const commission = rate.type === "fix" ? Number(rate.value) : Number(delivery.unitPrice) * Number(rate.value) / 100;
    rows.push({ leadId: lead.id, publicId: lead.publicId, categoryId: lead.categoryId, buyerName: delivery.buyerName, unitPrice: delivery.unitPrice, occurredAt: delivery.occurredAt, commission: Math.round(commission * 100) / 100 });
  }
  return { rows, total: Math.round(rows.reduce((sum, row) => sum + row.commission, 0) * 100) / 100 };
}

/** Kennzeichnung „durch Admin X“, wenn die Aktion in eine Impersonation-Sitzung fällt. */
export function impersonationSuffix(sessions: Array<{ startedAt: Date; endedAt: Date | null; admin: string }>, at: Date) {
  const hit = sessions.find((session) => at >= session.startedAt && (!session.endedAt || at <= session.endedAt));
  return hit ? ` (durch Admin ${hit.admin})` : "";
}

/** Reiter „Aktivität“: Lead-Ereignisse (als Käufer beliefert / als Lieferant geliefert), API-Ereignisse, Guthaben-Bewegungen und Admin-Sitzungen. */
export async function listMemberActivity(db: Db, tenantId: number, membershipId: number, limit = 100) {
  const { user } = await requireMembership(db, tenantId, membershipId);
  const supplier = await linkedSupplier(db, tenantId, user.id);
  const buyerLeadIds = (await db.select({ leadId: leadDeliveries.leadId }).from(leadDeliveries).innerJoin(orderOperationalConfigs, eq(orderOperationalConfigs.orderId, leadDeliveries.orderId)).where(and(eq(leadDeliveries.tenantId, tenantId), eq(orderOperationalConfigs.buyerUserId, user.id)))).map((row) => row.leadId);
  const supplierLeadIds = supplier ? (await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "verkauf"), eq(leads.supplierId, supplier.id))).orderBy(desc(leads.createdAt)).limit(300)).map((row) => row.id) : [];
  const leadIds = Array.from(new Set([...buyerLeadIds, ...supplierLeadIds]));
  const events: Array<{ at: Date; kind: string; title: string; detail: string | null; leadId?: number; leadPublicId?: string }> = [];
  // „Als Benutzer einloggen“: Start/Ende je Admin-Sitzung; Aktionen des Benutzers in dieser Zeit werden mit „durch Admin X“ gekennzeichnet
  const sessionRows = await db.select({ session: impersonationSessions, adminName: users.name, adminEmail: users.email }).from(impersonationSessions).innerJoin(users, eq(users.id, impersonationSessions.adminUserId)).where(and(eq(impersonationSessions.tenantId, tenantId), eq(impersonationSessions.targetUserId, user.id))).orderBy(desc(impersonationSessions.startedAt)).limit(limit);
  const sessions = sessionRows.map((row) => ({ startedAt: row.session.startedAt, endedAt: row.session.endedAt, admin: row.adminName ?? row.adminEmail ?? `#${row.session.adminUserId}` }));
  for (const item of sessions) { events.push({ at: item.startedAt, kind: "admin", title: `Als Benutzer eingeloggt durch Admin ${item.admin}`, detail: item.endedAt ? `bis ${item.endedAt.toLocaleString("de-DE")}` : "Sitzung läuft" }); if (item.endedAt) events.push({ at: item.endedAt, kind: "admin", title: `Admin-Sitzung beendet (${item.admin})`, detail: "Zurück zum Admin" }); }
  if (leadIds.length) {
    const leadRows = await db.select({ id: leads.id, publicId: leads.publicId }).from(leads).where(inArray(leads.id, leadIds));
    const publicIds = new Map(leadRows.map((row) => [row.id, row.publicId]));
    const [statusRows, integrationRows, claimRows] = await Promise.all([
      db.select().from(leadStatusEvents).where(and(eq(leadStatusEvents.tenantId, tenantId), inArray(leadStatusEvents.leadId, leadIds))).orderBy(desc(leadStatusEvents.occurredAt)).limit(limit),
      db.select().from(integrationEvents).where(and(eq(integrationEvents.tenantId, tenantId), inArray(integrationEvents.leadId, leadIds))).orderBy(desc(integrationEvents.occurredAt)).limit(limit),
      db.select().from(claims).where(and(eq(claims.tenantId, tenantId), inArray(claims.leadId, leadIds))).orderBy(desc(claims.createdAt)).limit(limit),
    ]);
    for (const row of statusRows) events.push({ at: row.occurredAt, kind: "lead", title: `${row.note ?? `${row.previousStatus ?? "–"} → ${row.nextStatus}`}${row.actorUserId === user.id ? impersonationSuffix(sessions, row.occurredAt) : ""}`, detail: row.previousStatus !== row.nextStatus ? `${row.previousStatus ?? "neu"} → ${row.nextStatus}` : null, leadId: row.leadId, leadPublicId: publicIds.get(row.leadId) });
    for (const row of integrationRows) events.push({ at: row.occurredAt, kind: "api", title: `API ${row.eventType}${row.responseStatus ? ` (HTTP ${row.responseStatus})` : ""}`, detail: row.responseBody?.slice(0, 300) ?? null, leadId: row.leadId ?? undefined, leadPublicId: row.leadId ? publicIds.get(row.leadId) : undefined });
    for (const row of claimRows) events.push({ at: row.createdAt, kind: "reklamation", title: `Reklamation ${row.status}: ${row.reason}`, detail: row.details?.slice(0, 300) ?? null, leadId: row.leadId, leadPublicId: publicIds.get(row.leadId) });
  }
  const balanceRows = await db.select().from(balanceTransactions).where(and(eq(balanceTransactions.tenantId, tenantId), eq(balanceTransactions.membershipId, membershipId))).orderBy(desc(balanceTransactions.createdAt)).limit(limit);
  for (const row of balanceRows) events.push({ at: row.createdAt, kind: "guthaben", title: `${row.kind === "aufladung" ? "Aufladung" : row.kind === "abbuchung" ? "Abbuchung" : "Auszahlung"} ${Number(row.amount).toFixed(2)} €`, detail: row.description });
  return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/** „Webhook testen“: Test-Lead-POST (Payload wie ein echter Lead, mit test: true) an die hinterlegte URL. */
export async function sendMemberWebhookTest(db: Db, tenantId: number, membershipId: number, categoryId?: number | null) {
  await requireMembership(db, tenantId, membershipId);
  const settings = await ensureMemberSettings(db, tenantId, membershipId);
  if (!settings.webhookUrl) throw new Error("Für diesen Benutzer ist keine Webhook-URL hinterlegt.");
  const category = categoryId ? (await db.select({ id: leadCategories.id, name: leadCategories.name }).from(leadCategories).where(and(eq(leadCategories.tenantId, tenantId), eq(leadCategories.id, categoryId))).limit(1))[0] : undefined;
  const payload = { ...buildLeadExportPayload({ publicId: `TEST-${nanoid(6).toUpperCase()}`, categoryId: category?.id ?? 0, firstName: "Test", lastName: "Lead", email: "test@example.com", phone: "+49 30 0000000", postcode: "10115", city: "Berlin", country: "DE", metadata: { categoryName: category?.name ?? "Generischer Test-Lead", notice: "Synthetischer Testlead ohne Kundendaten" } }), test: true };
  try {
    const response = await fetch(settings.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.text().catch(() => "");
    return { ok: response.ok, status: response.status, body: body.slice(0, 500) };
  } catch (error) {
    return { ok: false, status: 0, body: error instanceof Error ? error.message : "Unbekannter Fehler" };
  }
}
