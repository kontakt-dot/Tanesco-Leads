/**
 * Rohdaten (Callcenter): hochgeladene Listen sind noch keine Leads. Ein Kontakt wird erst zum Lead, wenn das Callcenter
 * ihn qualifiziert hat (Ergebnis „verkauft/interessiert“, Freigabe der Gesprächsbewertung) oder jemand ihn bewusst übernimmt.
 * Die Übernahme legt den Lead über denselben Weg wie ein Import an (leads + Verlauf + Automatisierung), sodass
 * Bestellungen, Lieferketten und Auslieferung ohne Sonderlogik greifen.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { dialerCalls, leadCategories, leadStatusEvents, leads, rawBatches, rawContacts, suppliers, users, type RawContact } from "../drizzle/schema";
import { triggerLeadAutomations, type Db } from "./lead-pipeline";

export type RawRowInput = { firstName?: string | null; lastName?: string | null; company?: string | null; phone?: string | null; email?: string | null; postcode?: string | null; city?: string | null; country?: string | null; category?: string | null; data?: Record<string, unknown> };
export const RAW_FIELDS = ["firstName", "lastName", "company", "phone", "email", "postcode", "city", "country"] as const;

export const normalizeRawPhone = (value: string | null | undefined) => { if (!value) return null; const digits = value.replace(/[^\d+]/g, ""); if (!digits) return null; if (digits.startsWith("+")) return digits; if (digits.startsWith("00")) return `+${digits.slice(2)}`; if (digits.startsWith("0")) return `+49${digits.slice(1)}`; return `+${digits}`; };
const phoneVariants = (phone: string) => { const digits = phone.replace(/\D/g, ""); return Array.from(new Set([phone, `+${digits}`, `00${digits}`, `0${digits.replace(/^49/, "")}`, digits])); };

/** Erlaubte Kategorien einer Liste (Standard-Kategorie zuerst). */
export const batchCategoryIds = (batch: { categoryId: number; categoryIds: unknown }) => { const ids = Array.isArray(batch.categoryIds) ? (batch.categoryIds as unknown[]).map(Number).filter((id) => Number.isInteger(id) && id > 0) : []; return Array.from(new Set([batch.categoryId, ...ids])); };

export async function listBatches(db: Db, tenantId: number) {
  const batches = await db.select({ batch: rawBatches, category: leadCategories.name, shortcode: leadCategories.shortcode, supplier: suppliers.name, creator: users.name }).from(rawBatches).leftJoin(leadCategories, eq(leadCategories.id, rawBatches.categoryId)).leftJoin(suppliers, eq(suppliers.id, rawBatches.supplierId)).leftJoin(users, eq(users.id, rawBatches.createdByUserId)).where(eq(rawBatches.tenantId, tenantId)).orderBy(desc(rawBatches.createdAt));
  const counts = await db.select({ batchId: rawContacts.batchId, status: rawContacts.status, count: sql<number>`COUNT(*)` }).from(rawContacts).where(eq(rawContacts.tenantId, tenantId)).groupBy(rawContacts.batchId, rawContacts.status);
  const categories = await db.select({ id: leadCategories.id, name: leadCategories.name, shortcode: leadCategories.shortcode }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId));
  return batches.map(({ batch, category, shortcode, supplier, creator }) => { const own = counts.filter((row) => row.batchId === batch.id); const of = (status: RawContact["status"]) => Number(own.find((row) => row.status === status)?.count ?? 0); const ids = batchCategoryIds(batch); return { ...batch, categoryIds: ids, categories: ids.map((id) => categories.find((item) => item.id === id)).filter((item): item is NonNullable<typeof item> => Boolean(item)), categoryName: category, categoryShortcode: shortcode, supplierName: supplier, createdBy: creator, counts: { total: own.reduce((sum, row) => sum + Number(row.count), 0), neu: of("neu"), in_liste: of("in_liste"), konvertiert: of("konvertiert"), verworfen: of("verworfen"), duplikat: of("duplikat") } }; });
}

/**
 * Was wurde aus den Rohdaten – je Kategorie (und wahlweise nur für eine Liste): wie viele Kontakte, wie viele davon
 * angerufen/erreicht, welche Anruf-Ergebnisse, wie viele wurden Lead – und was aus den Leads wurde (offen, verkauft,
 * reklamiert, aussortiert). Kontakte ohne eigene Kategorie zählen zur Standard-Kategorie ihrer Liste.
 */
export async function categoryReport(db: Db, tenantId: number, filter: { batchId?: number | null } = {}) {
  const where = [eq(rawContacts.tenantId, tenantId)];
  if (filter.batchId) where.push(eq(rawContacts.batchId, filter.batchId));
  const contacts = await db.select({ id: rawContacts.id, batchId: rawContacts.batchId, categoryId: rawContacts.categoryId, status: rawContacts.status, leadId: rawContacts.leadId, leadStatus: leads.status, leadCategoryId: leads.categoryId }).from(rawContacts).leftJoin(leads, eq(leads.id, rawContacts.leadId)).where(and(...where));
  const batches = await db.select({ id: rawBatches.id, categoryId: rawBatches.categoryId }).from(rawBatches).where(eq(rawBatches.tenantId, tenantId));
  const categories = await db.select({ id: leadCategories.id, name: leadCategories.name, shortcode: leadCategories.shortcode }).from(leadCategories).where(eq(leadCategories.tenantId, tenantId));
  const callRows = contacts.length ? await db.select({ rawContactId: dialerCalls.rawContactId, status: dialerCalls.status, disposition: dialerCalls.disposition }).from(dialerCalls).where(and(eq(dialerCalls.tenantId, tenantId), inArray(dialerCalls.rawContactId, contacts.map((contact) => contact.id)))) : [];
  const callsByContact = new Map<number, Array<{ status: string; disposition: string | null }>>();
  for (const row of callRows) { if (!row.rawContactId) continue; const list = callsByContact.get(row.rawContactId) ?? []; list.push({ status: row.status, disposition: row.disposition }); callsByContact.set(row.rawContactId, list); }
  const categoryOf = (contact: (typeof contacts)[number]) => contact.leadCategoryId ?? contact.categoryId ?? batches.find((batch) => batch.id === contact.batchId)?.categoryId ?? 0;
  type Row = { categoryId: number; name: string; shortcode: string | null; total: number; neu: number; inListe: number; verworfen: number; duplikat: number; angerufen: number; erreicht: number; anrufe: number; termine: number; interessiert: number; wiedervorlage: number; keinInteresse: number; nichtErreicht: number; leads: number; leadOffen: number; leadVerkauft: number; leadReklamiert: number; leadAussortiert: number };
  const rows = new Map<number, Row>();
  for (const contact of contacts) {
    const categoryId = categoryOf(contact);
    let row = rows.get(categoryId);
    if (!row) { const category = categories.find((item) => item.id === categoryId); row = { categoryId, name: category?.name ?? "Ohne Kategorie", shortcode: category?.shortcode ?? null, total: 0, neu: 0, inListe: 0, verworfen: 0, duplikat: 0, angerufen: 0, erreicht: 0, anrufe: 0, termine: 0, interessiert: 0, wiedervorlage: 0, keinInteresse: 0, nichtErreicht: 0, leads: 0, leadOffen: 0, leadVerkauft: 0, leadReklamiert: 0, leadAussortiert: 0 }; rows.set(categoryId, row); }
    row.total += 1;
    if (contact.status === "neu") row.neu += 1; else if (contact.status === "in_liste") row.inListe += 1; else if (contact.status === "verworfen") row.verworfen += 1; else if (contact.status === "duplikat") row.duplikat += 1;
    const calls = callsByContact.get(contact.id) ?? [];
    if (calls.length) { row.angerufen += 1; row.anrufe += calls.length; if (calls.some((call) => call.status === "beendet")) row.erreicht += 1; }
    for (const call of calls) { if (call.disposition === "verkauft") row.termine += 1; else if (call.disposition === "interessiert") row.interessiert += 1; else if (call.disposition === "wiedervorlage") row.wiedervorlage += 1; else if (call.disposition === "kein_interesse") row.keinInteresse += 1; else if (call.disposition === "nicht_erreicht") row.nichtErreicht += 1; }
    if (contact.status === "konvertiert" || contact.leadId) {
      row.leads += 1;
      const status = contact.leadStatus;
      if (status === "zugewiesen") row.leadVerkauft += 1; else if (status === "reklamiert") row.leadReklamiert += 1; else if (status === "fehlerhaft" || status === "deaktiviert") row.leadAussortiert += 1; else row.leadOffen += 1;
    }
  }
  const pct = (part: number, total: number) => total ? Math.round((part / total) * 100) : null;
  const list = Array.from(rows.values()).map((row) => ({ ...row, leadRate: pct(row.leads, row.total), reachRate: pct(row.erreicht, row.angerufen), saleRate: pct(row.leadVerkauft, row.leads) })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "de"));
  const sum = (key: keyof Row) => list.reduce((acc, row) => acc + (typeof row[key] === "number" ? (row[key] as number) : 0), 0);
  const totals = { total: sum("total"), neu: sum("neu"), inListe: sum("inListe"), verworfen: sum("verworfen"), duplikat: sum("duplikat"), angerufen: sum("angerufen"), erreicht: sum("erreicht"), anrufe: sum("anrufe"), termine: sum("termine"), interessiert: sum("interessiert"), wiedervorlage: sum("wiedervorlage"), keinInteresse: sum("keinInteresse"), nichtErreicht: sum("nichtErreicht"), leads: sum("leads"), leadOffen: sum("leadOffen"), leadVerkauft: sum("leadVerkauft"), leadReklamiert: sum("leadReklamiert"), leadAussortiert: sum("leadAussortiert"), leadRate: pct(sum("leads"), sum("total")), reachRate: pct(sum("erreicht"), sum("angerufen")), saleRate: pct(sum("leadVerkauft"), sum("leads")) };
  return { batchId: filter.batchId ?? null, categories: list, totals };
}

/** Legt eine Liste an und prüft jeden Kontakt auf Doppel (Telefon/E-Mail) gegen bestehende Leads und Rohdaten. */
export async function createBatch(db: Db, tenantId: number, userId: number, input: { name: string; categoryId: number; categoryIds?: number[]; supplierId?: number | null; sourceName?: string | null; mapping?: Record<string, string>; rows: RawRowInput[] }) {
  const wanted = Array.from(new Set([input.categoryId, ...(input.categoryIds ?? [])]));
  const allowed = await db.select({ id: leadCategories.id, name: leadCategories.name, shortcode: leadCategories.shortcode }).from(leadCategories).where(and(eq(leadCategories.tenantId, tenantId), inArray(leadCategories.id, wanted)));
  if (!allowed.some((item) => item.id === input.categoryId)) throw new Error("Die Ziel-Kategorie wurde nicht gefunden.");
  const categoryIds = wanted.filter((id) => allowed.some((item) => item.id === id));
  const resolveCategory = (value: string | null | undefined) => { const text = (value ?? "").trim().toLowerCase(); if (!text) return null; return allowed.find((item) => item.shortcode.toLowerCase() === text || item.name.toLowerCase() === text || String(item.id) === text)?.id ?? null; };
  const inserted = await db.insert(rawBatches).values({ tenantId, name: input.name.trim() || "Rohdaten", categoryId: input.categoryId, categoryIds, supplierId: input.supplierId ?? null, sourceName: input.sourceName?.trim() || null, mapping: input.mapping ?? null, rowCount: input.rows.length, createdByUserId: userId });
  const batchId = Number(inserted[0]?.insertId) || 0;
  const existingLeads = await db.select({ id: leads.id, phone: leads.phone, email: leads.email }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.kind, "verkauf")));
  const byPhone = new Map<string, number>(); const byEmail = new Map<string, number>();
  for (const lead of existingLeads) { const phone = normalizeRawPhone(lead.phone); if (phone) byPhone.set(phone, lead.id); if (lead.email) byEmail.set(lead.email.toLowerCase(), lead.id); }
  const existingRaw = await db.select({ phone: rawContacts.phone, email: rawContacts.email }).from(rawContacts).where(and(eq(rawContacts.tenantId, tenantId), inArray(rawContacts.status, ["neu", "in_liste", "konvertiert"])));
  const rawPhones = new Set(existingRaw.map((row) => row.phone).filter(Boolean) as string[]); const rawEmails = new Set(existingRaw.map((row) => row.email?.toLowerCase()).filter(Boolean) as string[]);
  const seenPhones = new Set<string>(); const seenEmails = new Set<string>();
  let duplicates = 0; let skipped = 0;
  const values = input.rows.map((row) => {
    const phone = normalizeRawPhone(row.phone); const email = row.email?.trim().toLowerCase() || null;
    const firstName = row.firstName?.trim() || null; const lastName = row.lastName?.trim() || null; const company = row.company?.trim() || null;
    if (!phone && !email) { skipped += 1; return null; }
    if (!firstName && !lastName && !company) { skipped += 1; return null; }
    const duplicateOfLeadId = (phone && byPhone.get(phone)) || (email && byEmail.get(email)) || null;
    const duplicateInRaw = (phone && (rawPhones.has(phone) || seenPhones.has(phone))) || (email && (rawEmails.has(email) || seenEmails.has(email)));
    if (phone) seenPhones.add(phone); if (email) seenEmails.add(email);
    const duplicate = Boolean(duplicateOfLeadId || duplicateInRaw); if (duplicate) duplicates += 1;
    const country = (row.country ?? "DE").trim().toUpperCase().slice(0, 2); const validCountry = ["DE", "AT", "CH"].includes(country) ? country : "DE";
    return { tenantId, batchId, categoryId: resolveCategory(row.category), firstName, lastName, company, phone, email, postcode: row.postcode?.trim() || null, city: row.city?.trim() || null, country: validCountry, data: row.data ?? null, status: duplicate ? ("duplikat" as const) : ("neu" as const), duplicateOfLeadId: duplicateOfLeadId || null, note: duplicate ? (duplicateOfLeadId ? "Bereits als Lead vorhanden" : "Doppelt in den Rohdaten") : null };
  }).filter((row): row is NonNullable<typeof row> => row !== null);
  for (let index = 0; index < values.length; index += 500) await db.insert(rawContacts).values(values.slice(index, index + 500));
  await db.update(rawBatches).set({ rowCount: values.length }).where(eq(rawBatches.id, batchId));
  return { batchId, imported: values.length, duplicates, skipped, usable: values.length - duplicates, categoryIds, unmatchedCategories: input.rows.filter((row) => row.category?.trim() && !resolveCategory(row.category)).length };
}

export async function listContacts(db: Db, tenantId: number, filter: { batchId?: number | null; status?: RawContact["status"] | null; search?: string | null; limit?: number } = {}) {
  const conditions = [eq(rawContacts.tenantId, tenantId)];
  if (filter.batchId) conditions.push(eq(rawContacts.batchId, filter.batchId));
  if (filter.status) conditions.push(eq(rawContacts.status, filter.status));
  if (filter.search?.trim()) { const term = `%${filter.search.trim()}%`; conditions.push(sql`(${rawContacts.firstName} LIKE ${term} OR ${rawContacts.lastName} LIKE ${term} OR ${rawContacts.company} LIKE ${term} OR ${rawContacts.phone} LIKE ${term} OR ${rawContacts.email} LIKE ${term} OR ${rawContacts.city} LIKE ${term})`); }
  const rows = await db.select({ contact: rawContacts, batchName: rawBatches.name, batchCategoryId: rawBatches.categoryId, batchCategoryIds: rawBatches.categoryIds, leadPublicId: leads.publicId, leadStatus: leads.status, categoryShortcode: leadCategories.shortcode }).from(rawContacts).innerJoin(rawBatches, eq(rawBatches.id, rawContacts.batchId)).leftJoin(leads, eq(leads.id, rawContacts.leadId)).leftJoin(leadCategories, eq(leadCategories.id, rawContacts.categoryId)).where(and(...conditions)).orderBy(asc(rawContacts.status), desc(rawContacts.createdAt)).limit(filter.limit ?? 300);
  return rows.map(({ contact, batchName, batchCategoryId, batchCategoryIds, leadPublicId, leadStatus, categoryShortcode }) => ({ ...contact, batchName, batchCategoryIds: batchCategoryIds && Array.isArray(batchCategoryIds) ? batchCategoryIds as number[] : [batchCategoryId], categoryShortcode, leadPublicId, leadStatus, name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.company || contact.phone || contact.email || "–" }));
}

/**
 * Übernahme eines Rohdaten-Kontakts als Lead – derselbe Weg wie beim Import: Lead anlegen, Verlaufseintrag,
 * Automatisierung „Lead erstellt“ (und bei Freigabe „Status geändert“), damit Bestellungen und Auslieferung greifen.
 */
export async function convertRawContact(db: Db, tenantId: number, rawContactId: number, options: { actorUserId: number | null; initialStatus?: "neu" | "genehmigt"; note?: string | null; categoryId?: number | null }) {
  const contact = (await db.select().from(rawContacts).where(and(eq(rawContacts.id, rawContactId), eq(rawContacts.tenantId, tenantId))).limit(1))[0];
  if (!contact) throw new Error("Rohdaten-Kontakt wurde nicht gefunden.");
  if (contact.leadId) { const existing = (await db.select({ id: leads.id, publicId: leads.publicId }).from(leads).where(eq(leads.id, contact.leadId)).limit(1))[0]; if (existing) return { leadId: existing.id, publicId: existing.publicId, alreadyConverted: true as const, automation: null }; }
  const batch = (await db.select().from(rawBatches).where(eq(rawBatches.id, contact.batchId)).limit(1))[0];
  if (!batch) throw new Error("Die Rohdaten-Liste wurde nicht gefunden.");
  const supplier = batch.supplierId ? (await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.id, batch.supplierId)).limit(1))[0] : undefined;
  const allowedCategories = batchCategoryIds(batch);
  const categoryId = options.categoryId ?? contact.categoryId ?? batch.categoryId;
  if (!allowedCategories.includes(categoryId)) throw new Error("Diese Kategorie ist für die Liste nicht freigegeben.");
  const initialStatus = options.initialStatus ?? "neu";
  const publicId = nanoid(8).toUpperCase();
  const data = contact.data && typeof contact.data === "object" && !Array.isArray(contact.data) ? (contact.data as Record<string, unknown>) : {};
  const inserted = await db.insert(leads).values({ tenantId, publicId, categoryId, firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone, postcode: contact.postcode, city: contact.city, country: (contact.country as "DE" | "AT" | "CH") ?? "DE", supplierId: supplier?.id ?? null, supplierName: supplier?.name ?? batch.sourceName ?? "Rohdaten (Callcenter)", cost: "0.00", metadata: { ...data, ...(contact.company ? { company: contact.company } : {}), rawContactId: contact.id, rawBatch: batch.name, source: batch.sourceName ?? batch.name }, status: initialStatus });
  const leadId = Number(inserted[0]?.insertId) || 0;
  await db.insert(leadStatusEvents).values({ tenantId, leadId, nextStatus: initialStatus, actorUserId: options.actorUserId, note: `Aus Rohdaten übernommen (${batch.name})${options.note ? ` – ${options.note}` : ""}` });
  await db.update(rawContacts).set({ status: "konvertiert", leadId, categoryId, note: options.note?.slice(0, 320) ?? contact.note }).where(eq(rawContacts.id, contact.id));
  const automation = await triggerLeadAutomations(db, { tenantId, actorUserId: options.actorUserId, leadId, triggerType: "lead_erstellt" });
  if (initialStatus === "genehmigt") await triggerLeadAutomations(db, { tenantId, actorUserId: options.actorUserId, leadId, triggerType: "status_geändert" });
  return { leadId, publicId, alreadyConverted: false as const, automation };
}

export async function discardRawContact(db: Db, tenantId: number, rawContactId: number, note?: string | null) {
  const contact = (await db.select({ id: rawContacts.id, status: rawContacts.status }).from(rawContacts).where(and(eq(rawContacts.id, rawContactId), eq(rawContacts.tenantId, tenantId))).limit(1))[0];
  if (!contact) throw new Error("Rohdaten-Kontakt wurde nicht gefunden.");
  if (contact.status === "konvertiert") throw new Error("Der Kontakt ist bereits ein Lead.");
  await db.update(rawContacts).set({ status: "verworfen", note: note?.slice(0, 320) ?? null }).where(eq(rawContacts.id, rawContactId));
  return { success: true as const };
}

export async function restoreRawContact(db: Db, tenantId: number, rawContactId: number) {
  await db.update(rawContacts).set({ status: "neu", note: null }).where(and(eq(rawContacts.id, rawContactId), eq(rawContacts.tenantId, tenantId), inArray(rawContacts.status, ["verworfen", "duplikat"])));
  return { success: true as const };
}

/** Alle offenen Kontakte einer Liste übernehmen (bewusste Entscheidung, z. B. bereits qualifizierte Liste). */
export async function convertBatch(db: Db, tenantId: number, batchId: number, actorUserId: number, initialStatus: "neu" | "genehmigt" = "neu", categoryId?: number | null) {
  const contacts = await db.select({ id: rawContacts.id }).from(rawContacts).where(and(eq(rawContacts.tenantId, tenantId), eq(rawContacts.batchId, batchId), inArray(rawContacts.status, ["neu", "in_liste"])));
  let converted = 0; let delivered = 0;
  for (const contact of contacts) { const result = await convertRawContact(db, tenantId, contact.id, { actorUserId, initialStatus, note: "Liste vollständig übernommen", categoryId: categoryId ?? null }); if (!result.alreadyConverted) { converted += 1; delivered += result.automation?.delivered ?? 0; } }
  return { converted, delivered };
}

export async function deleteBatch(db: Db, tenantId: number, batchId: number) {
  const batch = (await db.select({ id: rawBatches.id }).from(rawBatches).where(and(eq(rawBatches.id, batchId), eq(rawBatches.tenantId, tenantId))).limit(1))[0];
  if (!batch) throw new Error("Die Rohdaten-Liste wurde nicht gefunden.");
  const converted = (await db.select({ id: rawContacts.id }).from(rawContacts).where(and(eq(rawContacts.batchId, batchId), eq(rawContacts.status, "konvertiert")))).length;
  await db.delete(rawContacts).where(and(eq(rawContacts.batchId, batchId), inArray(rawContacts.status, ["neu", "in_liste", "verworfen", "duplikat"])));
  if (!converted) await db.delete(rawBatches).where(eq(rawBatches.id, batchId));
  return { success: true as const, keptConverted: converted };
}

/** Kontaktdaten für den Dialer (Name/Telefon), unabhängig davon, ob Lead oder Rohdaten. */
export async function rawContactSummary(db: Db, rawContactId: number) {
  const contact = (await db.select().from(rawContacts).where(eq(rawContacts.id, rawContactId)).limit(1))[0];
  if (!contact) return null;
  return { id: contact.id, name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.company || "Rohdaten-Kontakt", company: contact.company, phone: contact.phone, city: contact.city, status: contact.status, leadId: contact.leadId, categoryId: contact.categoryId };
}

export { phoneVariants };
