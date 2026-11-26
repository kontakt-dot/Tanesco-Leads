/**
 * Lead aus dem Gespräch füllen.
 *
 * Der Dialer schickt oft nur das Gespräch – ohne Kontakt und ohne die Felder der Lead-Kategorie. Was der Kunde am Telefon sagt, steht aber im Text.
 * Die KI liest daraus
 *  - die eigenen Felder der Lead-Kategorie (Hausart, Dachart, Stromverbrauch …) und
 *  - fehlende Angaben zum Kontakt (E-Mail, Straße, PLZ, Ort, Name).
 *
 * Regeln: Es wird nichts überschrieben (nur leere Felder werden gefüllt). Jede Antwort wird gegen das Feld geprüft – ein Auswahl-Feld nimmt nur
 * eine seiner vorgegebenen Antworten. Platzhalter wie „<UNKNOWN>“ werden entfernt. Läuft nach jeder Freigabe und holt ältere Leads im
 * Hintergrund nach (ein paar je Minute). Der Anruf selbst bleibt die Quelle: Im Lead steht, aus welchem Gespräch die Angaben stammen.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { callRecords, categoryFieldMappings, categoryFields, leadCategories, leadStatusEvents, leads, rawContacts } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { fieldNames } from "./llm-shape";
import type { Db } from "./lead-pipeline";
import { cleanSpokenContact, type SpokenContact } from "../shared/dialer-intake";
import { emailFromFields } from "../shared/dialer-contact";
import { callAnswerList, cleanFieldValues, dialerFieldMatches, fieldOptions, fieldsFromTranscript, fieldsToRead, isPlaceholder, isSalutation, realText, tidySalutation, type LeadFieldDef } from "../shared/lead-fields";

type ContactKey = Exclude<keyof SpokenContact, "salutation">;
const CONTACT_HINT: Record<ContactKey, string> = {
  firstName: "Vorname des Kunden",
  lastName: "Nachname des Kunden",
  street: "Straße mit Hausnummer des Kunden",
  postcode: "Postleitzahl des Kunden (5 Ziffern)",
  city: "Wohnort des Kunden",
  email: "E-Mail-Adresse des Kunden, zusammengesetzt geschrieben (z. B. max.muster@web.de – „at“ ist @, „punkt“ ist ein Punkt)",
};
const CONTACT_LABEL: Record<ContactKey, string> = { firstName: "Vorname", lastName: "Nachname", street: "Straße", postcode: "PLZ", city: "Ort", email: "E-Mail" };
const hintFor = (field: LeadFieldDef) => field.fieldType === "auswahl" ? "genau eine der vorgegebenen Antworten, sonst leer" : field.fieldType === "ja_nein" ? "Ja oder Nein, leer wenn nicht besprochen" : field.fieldType === "zahl" ? "nur die Zahl, leer wenn nicht genannt" : field.fieldType === "datum" ? "Datum als JJJJ-MM-TT, leer wenn nicht genannt" : field.fieldType === "notiz" ? "ein bis zwei Sätze, leer wenn nicht genannt" : "kurze Antwort in wenigen Wörtern, leer wenn nicht genannt";
const metaOf = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

export type ReadFromCall = { values: Record<string, string>; contact: Partial<Record<ContactKey, string>>; ai: boolean };
/**
 * Felder und fehlende Kontaktangaben aus dem Text eines Gesprächs lesen. Ohne KI-Zugang greift die einfache Erkennung
 * (nur Auswahl-Antworten, die wörtlich und eindeutig fallen). Ein Fehler der KI wird nach oben gereicht – der Aufrufer versucht es später noch einmal.
 */
export async function readLeadFromTranscript(input: { transcript: string; category: string | null; fields: LeadFieldDef[]; contactGaps: ContactKey[] }): Promise<ReadFromCall> {
  const transcript = input.transcript.trim();
  if (!transcript || (!input.fields.length && !input.contactGaps.length)) return { values: {}, contact: {}, ai: false };
  if (!process.env.ANTHROPIC_API_KEY) return { values: fieldsFromTranscript(input.fields, transcript), contact: {}, ai: false };
  const names = fieldNames(input.fields.map((field) => field.fieldKey), "feld");
  const properties: Record<string, unknown> = {};
  input.fields.forEach((field, index) => {
    const options = field.fieldType === "auswahl" ? fieldOptions(field) : field.fieldType === "ja_nein" ? ["Ja", "Nein"] : [];
    properties[names[index]] = { type: "string", ...(options.length ? { enum: [...options, ""] } : {}), description: `„${field.label}“ – ${hintFor(field)}` };
  });
  for (const key of input.contactGaps) properties[`kontakt_${key}`] = { type: "string", description: `${CONTACT_HINT[key]} – leer, wenn nicht genannt` };
  const schema = { name: "lead_aus_gespraech", schema: { type: "object", additionalProperties: false, required: Object.keys(properties), properties } };
  // Felder können an jeder Stelle fallen: der ganze Text – bei sehr langen Gesprächen Anfang und Ende (dort stehen Bedarf und Datenabgleich)
  const text = transcript.length > 30_000 ? `${transcript.slice(0, 14_000)}\n[…]\n${transcript.slice(-14_000)}` : transcript;
  const system = `Du liest ein Telefongespräch (automatisch transkribiert, ohne Kennzeichnung der Sprecher). Ein Callcenter-Mitarbeiter spricht mit einem Kunden${input.category ? ` über ${input.category}` : ""}. Trage zu jedem Feld ein, was der KUNDE dazu sagt oder ausdrücklich bestätigt – auch wenn der Mitarbeiter die Angabe vorliest und der Kunde zustimmt. Nimm nur, was im Gespräch wirklich fällt: nichts raten, nichts aus Allgemeinwissen ergänzen. Was nicht besprochen wird, bleibt leer (leerer Text) – schreibe nie „unbekannt“, „nicht genannt“ oder Ähnliches. Bei Feldern mit vorgegebenen Antworten nimm genau die Antwort, die zum Gesagten passt (z. B. „Einfamilienhaus“ → „Ein-/Zweifamilienhaus“), sonst leer. Zahlen, Namen und E-Mail-Adressen stammen aus Spracherkennung und können falsch geschrieben sein – übernimm sie so, wie sie gemeint sind. Angaben zum Mitarbeiter oder zum Callcenter gehören in kein Feld.`;
  const response = await invokeLLM({ model: "fast", maxTokens: Math.min(2600, 500 + input.fields.length * 45 + input.contactGaps.length * 30), messages: [{ role: "system", content: system }, { role: "user", content: `Gespräch:\n"""\n${text}\n"""` }], outputSchema: schema, purpose: "felder_aus_gespraech" });
  let parsed: unknown; try { parsed = JSON.parse(response.choices[0]?.message.content ?? "{}"); } catch { parsed = {}; }
  const raw = metaOf(parsed);
  const values: Record<string, unknown> = {}; input.fields.forEach((field, index) => { values[field.fieldKey] = raw[names[index]]; });
  const spoken = cleanSpokenContact(Object.fromEntries(input.contactGaps.map((key) => [key, raw[`kontakt_${key}`]])));
  const contact: Partial<Record<ContactKey, string>> = {}; for (const key of input.contactGaps) { const value = spoken[key]; if (value) contact[key] = value; }
  return { values: cleanFieldValues(input.fields, values), contact, ai: true };
}

export type FillResult = { leadId: number; fields: string[]; contact: string[]; cleaned: string[]; skipped?: string };
/**
 * Einen Lead aus seinem Gespräch füllen. Ohne Angabe wird das neueste bewertete Gespräch des Leads genommen.
 * Schreibt die gefundenen Angaben in den Lead (und in den Kontakt der Liste), vermerkt das Gespräch und trägt es ins Lead-Log ein.
 */
export async function fillLeadFromCall(db: Db, tenantId: number, leadId: number, options: { callId?: number | null; actorUserId?: number | null } = {}): Promise<FillResult> {
  const lead = (await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId))).limit(1))[0];
  if (!lead) return { leadId, fields: [], contact: [], cleaned: [], skipped: "Lead nicht gefunden" };
  const call = options.callId
    ? (await db.select({ id: callRecords.id, transcript: callRecords.transcript }).from(callRecords).where(and(eq(callRecords.id, options.callId), eq(callRecords.tenantId, tenantId))).limit(1))[0]
    : (await db.select({ id: callRecords.id, transcript: callRecords.transcript }).from(callRecords).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.leadId, leadId), eq(callRecords.status, "bewertet"))).orderBy(desc(callRecords.id)).limit(1))[0];
  const [defs, category, mappings] = await Promise.all([
    db.select({ fieldKey: categoryFields.fieldKey, label: categoryFields.label, fieldType: categoryFields.fieldType, options: categoryFields.options }).from(categoryFields).where(and(eq(categoryFields.tenantId, tenantId), eq(categoryFields.categoryId, lead.categoryId))).orderBy(asc(categoryFields.sortOrder), asc(categoryFields.id)),
    db.select({ name: leadCategories.name }).from(leadCategories).where(eq(leadCategories.id, lead.categoryId)).limit(1),
    db.select().from(categoryFieldMappings).where(and(eq(categoryFieldMappings.tenantId, tenantId), eq(categoryFieldMappings.categoryId, lead.categoryId))).orderBy(asc(categoryFieldMappings.sortOrder), asc(categoryFieldMappings.id)),
  ]);
  // Was der Dialer unter eigenen Namen geschickt hat („pv_dachart“), geht zuerst in die Felder der Kategorie – sicherer als aus dem Gespräch gelesen
  const matched = dialerFieldMatches(defs as LeadFieldDef[], lead.metadata, category[0]?.name ?? null, mappings); const fromDialer = matched.values;
  const withoutSources = (data: Record<string, unknown>) => { const next = { ...data }; for (const key of matched.sources) delete next[key]; return next; }; // nichts doppelt: die Angabe steht jetzt im Feld der Kategorie
  const meta = withoutSources({ ...metaOf(lead.metadata), ...fromDialer }); const now = new Date().toISOString();
  const patch: Partial<typeof leads.$inferInsert> = {}; const cleaned: string[] = [];
  // Platzhalter sind keine Angabe: „<UNKNOWN>“ als Name, Ort oder E-Mail fliegt raus (und wird unten, wenn möglich, richtig gefüllt)
  for (const key of ["firstName", "lastName", "city", "email", "postcode"] as const) if (lead[key] && isPlaceholder(lead[key])) { patch[key] = null; cleaned.push(CONTACT_LABEL[key]); }
  // „Herr“/„Frau“ ist kein Vorname – die Anrede bekommt ihr eigenes Feld, der Vorname wird (wenn er im Gespräch fällt) richtig gefüllt
  let salutation: "Herr" | "Frau" | null = null;
  if (lead.firstName && isSalutation(lead.firstName)) { salutation = tidySalutation(lead.firstName); patch.firstName = null; cleaned.push("Anrede"); }
  const current = { firstName: patch.firstName === null ? null : realText(lead.firstName, 120), lastName: patch.lastName === null ? null : realText(lead.lastName, 120), email: patch.email === null ? null : realText(lead.email, 320), postcode: patch.postcode === null ? null : realText(lead.postcode, 24), city: patch.city === null ? null : realText(lead.city, 120), street: realText(meta.street, 200) };
  // E-Mail, die der Dialer unter eigenem Namen geschickt hat („pv_email“): Sie steht dann bei den Angaben statt im Feld E-Mail – von dort übernehmen
  if (!current.email) { const moved = await takeEmailFromFields(db, lead); if (moved) { current.email = moved.email; delete meta[moved.key]; } }
  const transcript = call?.transcript?.trim() ?? "";
  if (!transcript) {
    // ohne Text gibt es nichts zu lesen (z. B. nach Ablauf der Aufbewahrung) – vermerken, damit der Lead nicht immer wieder geprüft wird
    await db.update(leads).set({ ...patch, metadata: { ...withoutSources(metaOf((await db.select({ metadata: leads.metadata }).from(leads).where(eq(leads.id, lead.id)).limit(1))[0]?.metadata ?? lead.metadata)), ...fromDialer, ...(salutation && !realText(meta.anrede, 20) ? { anrede: salutation } : {}), callFieldsAt: now, ...(call ? { callFieldsCallId: call.id } : {}) } }).where(eq(leads.id, lead.id));
    return { leadId, fields: [], contact: [], cleaned, skipped: "kein Gesprächstext" };
  }
  const toRead = fieldsToRead(defs as LeadFieldDef[], meta).slice(0, 45);
  const gaps: ContactKey[] = [];
  if (!current.firstName) gaps.push("firstName"); if (!current.lastName) gaps.push("lastName"); if (!current.email) gaps.push("email"); if (!current.street) gaps.push("street"); if (!current.postcode) gaps.push("postcode"); if (!current.city) gaps.push("city");
  const read = await readLeadFromTranscript({ transcript, category: category[0]?.name ?? null, fields: toRead, contactGaps: gaps });
  // Frisch lesen: Während die KI gelesen hat, kann sich der Lead geändert haben (Freigabe, Auslieferung, Eingabe von Hand) – es wird nur ergänzt, nie zurückgedreht
  const latest = (await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1))[0] ?? lead; const latestMeta = metaOf(latest.metadata);
  const has = (value: unknown, max: number) => Boolean(realText(typeof value === "string" || typeof value === "number" ? value : null, max));
  const values = Object.fromEntries(Object.entries({ ...read.values, ...fromDialer }).filter(([key]) => !has(latestMeta[key], 600)));
  const nextMeta: Record<string, unknown> = { ...withoutSources(latestMeta), ...values, ...(salutation && !realText(latestMeta.anrede, 20) ? { anrede: salutation } : {}), callFieldsAt: now, callFieldsCallId: call!.id };
  delete nextMeta.callFieldsTries;
  const contact: string[] = [];
  // Ein Name aus dem Gespräch gilt nur, wenn noch gar keiner da ist – ein einzelner Vorname zu einem vorhandenen Nachnamen stammt zu oft vom Mitarbeiter
  if (!has(latest.firstName, 120) && !has(latest.lastName, 120)) { if (read.contact.firstName) { patch.firstName = read.contact.firstName; contact.push(CONTACT_LABEL.firstName); } if (read.contact.lastName) { patch.lastName = read.contact.lastName; contact.push(CONTACT_LABEL.lastName); } }
  else if (salutation && read.contact.firstName && has(latest.lastName, 120)) { patch.firstName = read.contact.firstName; contact.push(CONTACT_LABEL.firstName); } // statt „Herr“ jetzt der echte Vorname
  if (!has(latest.email, 320) && read.contact.email) { patch.email = read.contact.email; contact.push(CONTACT_LABEL.email); }
  if (!has(latest.postcode, 24) && read.contact.postcode) { patch.postcode = read.contact.postcode; contact.push(CONTACT_LABEL.postcode); }
  if (!has(latest.city, 120) && read.contact.city) { patch.city = read.contact.city; contact.push(CONTACT_LABEL.city); }
  if (!has(latestMeta.street, 200) && read.contact.street) { nextMeta.street = read.contact.street; contact.push(CONTACT_LABEL.street); }
  await db.update(leads).set({ ...patch, metadata: nextMeta }).where(eq(leads.id, lead.id));
  // Kontakt der Liste (Rohdaten) genauso ergänzen – dort steht derselbe Mensch
  const rawContactId = Number(latestMeta.rawContactId ?? meta.rawContactId) || 0;
  if (rawContactId && (Object.keys(patch).length || nextMeta.street !== latestMeta.street)) {
    const raw = (await db.select().from(rawContacts).where(and(eq(rawContacts.id, rawContactId), eq(rawContacts.tenantId, tenantId))).limit(1))[0];
    if (raw) {
      const rawPatch: Partial<typeof rawContacts.$inferInsert> = {};
      for (const key of ["firstName", "lastName", "email", "postcode", "city"] as const) { const value = patch[key]; if (value === null) { if (raw[key] && isPlaceholder(raw[key])) rawPatch[key] = null; } else if (typeof value === "string" && (!raw[key] || isPlaceholder(raw[key]))) rawPatch[key] = value; }
      if (typeof nextMeta.street === "string" && !realText(metaOf(raw.data).street)) rawPatch.data = { ...metaOf(raw.data), street: nextMeta.street };
      if (Object.keys(rawPatch).length) await db.update(rawContacts).set(rawPatch).where(eq(rawContacts.id, raw.id));
    }
  }
  const fields = Object.keys(values); const label = (key: string) => defs.find((field) => field.fieldKey === key)?.label ?? key;
  const fromCall = fields.filter((key) => !(key in fromDialer)); const viaDialer = fields.filter((key) => key in fromDialer);
  const list = (keys: string[]) => `${keys.length} ${keys.length === 1 ? "Feld" : "Felder"} (${keys.slice(0, 8).map(label).join(", ")}${keys.length > 8 ? " …" : ""})`;
  if (viaDialer.length) await db.insert(leadStatusEvents).values({ tenantId, leadId: lead.id, previousStatus: lead.status, nextStatus: lead.status, actorUserId: options.actorUserId ?? null, note: `Vom Dialer übernommen: ${list(viaDialer)}`.slice(0, 500) });
  if (fromCall.length || contact.length) {
    const parts = [fromCall.length ? list(fromCall) : null, contact.length ? contact.join(", ") : null].filter(Boolean).join(" · ");
    await db.insert(leadStatusEvents).values({ tenantId, leadId: lead.id, previousStatus: lead.status, nextStatus: lead.status, actorUserId: options.actorUserId ?? null, note: `Aus dem Gespräch übernommen: ${parts}`.slice(0, 500) });
  }
  return { leadId, fields, contact, cleaned };
}

/** Steht die E-Mail-Adresse bei den Angaben des Leads (unter einem Namen des Dialers), kommt sie ins Feld E-Mail – mit Vermerk im Lead-Log. */
async function takeEmailFromFields(db: Db, lead: { id: number; tenantId: number; status: typeof leads.$inferSelect["status"] }): Promise<{ key: string; email: string } | null> {
  const fresh = (await db.select({ email: leads.email, metadata: leads.metadata }).from(leads).where(eq(leads.id, lead.id)).limit(1))[0];
  if (!fresh || realText(fresh.email, 320)) return null;
  const meta = metaOf(fresh.metadata); const hit = emailFromFields(meta); if (!hit) return null;
  const next = { ...meta }; delete next[hit.key];
  await db.update(leads).set({ email: hit.email, metadata: next }).where(eq(leads.id, lead.id));
  const rawContactId = Number(meta.rawContactId) || 0;
  if (rawContactId) { const raw = (await db.select({ id: rawContacts.id, email: rawContacts.email }).from(rawContacts).where(and(eq(rawContacts.id, rawContactId), eq(rawContacts.tenantId, lead.tenantId))).limit(1))[0]; if (raw && !realText(raw.email, 320)) await db.update(rawContacts).set({ email: hit.email }).where(eq(rawContacts.id, raw.id)); }
  await db.insert(leadStatusEvents).values({ tenantId: lead.tenantId, leadId: lead.id, previousStatus: lead.status, nextStatus: lead.status, actorUserId: null, note: `E-Mail-Adresse vom Dialer übernommen – sie stand bei den Angaben unter „${hit.key.slice(0, 60)}“` });
  return hit;
}
/** Vorhandene Leads ohne E-Mail-Adresse, bei denen sie bei den Angaben steht: einmal durchgehen und umtragen. */
export async function emailsFromLeadFields(db: Db, options: { tenantId?: number; max?: number } = {}): Promise<{ moved: number }> {
  const rows = await db.select({ id: leads.id, tenantId: leads.tenantId, status: leads.status }).from(leads)
    .where(and(eq(leads.kind, "verkauf"), sql`(${leads.email} IS NULL OR ${leads.email} = '')`, sql`JSON_SEARCH(${leads.metadata}, 'one', ${"%@%"}) IS NOT NULL`, ...(options.tenantId ? [eq(leads.tenantId, options.tenantId)] : [])))
    .orderBy(desc(leads.id)).limit(options.max ?? 2000);
  let moved = 0; for (const row of rows) if (await takeEmailFromFields(db, row)) moved += 1;
  return { moved };
}

/**
 * Nachholen: Leads aus freigegebenen Gesprächen, deren Felder noch nicht aus dem Gespräch gelesen wurden. Ein paar je Lauf – neueste zuerst.
 * Klappt es bei einem Lead nicht (KI nicht erreichbar), wird er bis zu dreimal wieder versucht.
 */
let filling = false; // ein Lauf zur Zeit – sonst läse der nächste Takt dieselben Leads noch einmal
export async function fillLeadsFromCalls(db: Db, options: { tenantId?: number; max?: number } = {}): Promise<{ checked: number; filled: number; fields: number }> {
  if (filling) return { checked: 0, filled: 0, fields: 0 };
  filling = true;
  try { return await fillLeadsFromCallsNow(db, options); } finally { filling = false; }
}
async function fillLeadsFromCallsNow(db: Db, options: { tenantId?: number; max?: number }): Promise<{ checked: number; filled: number; fields: number }> {
  const max = Math.max(1, Math.min(200, options.max ?? 12));
  const rows = await db.select({ leadId: leads.id, tenantId: leads.tenantId, callId: callRecords.id }).from(callRecords).innerJoin(leads, eq(leads.id, callRecords.leadId))
    .where(and(eq(callRecords.decision, "freigegeben"), eq(callRecords.status, "bewertet"), eq(leads.kind, "verkauf"), sql`JSON_EXTRACT(${leads.metadata}, '$.callFieldsAt') IS NULL`, sql`COALESCE(JSON_EXTRACT(${leads.metadata}, '$.callFieldsTries'), 0) < 3`, ...(options.tenantId ? [eq(callRecords.tenantId, options.tenantId)] : [])))
    .orderBy(desc(callRecords.id)).limit(max * 4);
  const seen = new Set<number>(); let filled = 0; let fields = 0; let checked = 0;
  for (const row of rows) {
    if (seen.has(row.leadId)) continue; seen.add(row.leadId); if (checked >= max) break; checked += 1;
    try { const result = await fillLeadFromCall(db, row.tenantId, row.leadId, { callId: row.callId }); if (result.fields.length || result.contact.length) filled += 1; fields += result.fields.length; }
    catch (error) {
      console.error("[Leads] Felder aus dem Gespräch nicht gelesen:", error instanceof Error ? error.message : error);
      const lead = (await db.select({ metadata: leads.metadata }).from(leads).where(eq(leads.id, row.leadId)).limit(1))[0]; const meta = metaOf(lead?.metadata);
      await db.update(leads).set({ metadata: { ...meta, callFieldsTries: (Number(meta.callFieldsTries) || 0) + 1 } }).where(eq(leads.id, row.leadId)).catch(() => undefined);
    }
  }
  return { checked, filled, fields };
}

/** Vermerk im Lead-Log, wenn ein grünes Gespräch seinen Lead erst nachträglich bekommen hat (siehe leadsFromApprovedCalls). */
export const CATCH_UP_NOTE = "Grünes Gespräch – Lead nachgeholt";
/**
 * Leads, die ein grünes Gespräch nachträglich bekommen haben, tragen das Datum des Anlegens – nicht das des Gesprächs.
 * Dann stimmt „Geliefert“ nicht, und alle diese Leads zählen als „heute neu“. Hier bekommt jeder nachgeholte Lead die Zeit seines Gesprächs.
 * Betroffen ist nur, wer im Lead-Log den Vermerk „Lead nachgeholt“ trägt und deutlich nach dem Gespräch angelegt wurde.
 */
export async function alignLeadDatesWithCalls(db: Db, options: { tenantId?: number; max?: number } = {}): Promise<{ moved: number }> {
  const callAt = sql<Date | null>`MIN(COALESCE(${callRecords.startedAt}, ${callRecords.createdAt}))`;
  const rows = await db.select({ leadId: leads.id, callAt }).from(leads).innerJoin(callRecords, eq(callRecords.leadId, leads.id))
    .where(and(eq(leads.kind, "verkauf"), sql`EXISTS (SELECT 1 FROM ${leadStatusEvents} WHERE ${leadStatusEvents.leadId} = ${leads.id} AND ${leadStatusEvents.note} LIKE ${"%Lead nachgeholt%"})`, ...(options.tenantId ? [eq(leads.tenantId, options.tenantId)] : [])))
    .groupBy(leads.id, leads.createdAt).having(sql`MIN(COALESCE(${callRecords.startedAt}, ${callRecords.createdAt})) < DATE_SUB(${leads.createdAt}, INTERVAL 30 MINUTE)`).limit(options.max ?? 3000);
  let moved = 0;
  for (const row of rows) {
    const at = row.callAt ? new Date(row.callAt) : null; if (!at || Number.isNaN(at.getTime())) continue;
    await db.update(leads).set({ createdAt: at }).where(eq(leads.id, row.leadId)); moved += 1;
  }
  return { moved };
}

/**
 * Das Gespräch zu einem Lead – für die Lead-Seite: das neueste bewertete Gespräch mit Agent, Note, Kurzfassung und den Antworten auf die Prüffragen der Kampagne.
 * Nur für interne Zugänge gedacht (der Aufrufer prüft das).
 */
export async function leadCallSummary(db: Db, tenantId: number, leadId: number) {
  const rows = await db.select({ id: callRecords.id, status: callRecords.status, startedAt: callRecords.startedAt, createdAt: callRecords.createdAt, durationSeconds: callRecords.durationSeconds, agentName: callRecords.agentName, agentAlias: callRecords.agentAlias, campaign: callRecords.campaign, score: callRecords.score, verdict: callRecords.verdict, decision: callRecords.decision, summary: callRecords.summary, answers: callRecords.qualificationAnswers })
    .from(callRecords).where(and(eq(callRecords.tenantId, tenantId), eq(callRecords.leadId, leadId))).orderBy(desc(callRecords.id)).limit(20);
  if (!rows.length) return null;
  const call = rows.find((row) => row.status === "bewertet") ?? rows[0];
  const { questionsForCampaign } = await import("./call-qa");
  const questions = await questionsForCampaign(db, tenantId, call.campaign);
  return { id: call.id, count: rows.length, at: call.startedAt ?? call.createdAt, durationSeconds: call.durationSeconds, agentName: call.agentName?.trim() || null, agentAlias: call.agentAlias?.trim() || null, campaign: call.campaign, score: call.score, verdict: call.verdict, decision: call.decision, summary: call.summary ?? "", answers: callAnswerList(questions, call.answers) };
}
