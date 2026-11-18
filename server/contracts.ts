/**
 * Verträge: anlegen aus Bausteinen, per E-Mail zur Unterschrift schicken, Kunde unterschreibt online (öffentliche Seite mit
 * Unterschriftsfeld), Nachweis mit Zeitstempel, IP-Adresse, Gerät und Prüfsummen (SHA-256), PDF der unterschriebenen Fassung.
 * Vorlagen liegen in contractTemplates, jeder Vorgang wird in contractEvents protokolliert.
 */
import crypto from "node:crypto";
import { and, asc, desc, eq, gte, inArray, like, or, sql } from "drizzle-orm";
import { contractEvents, contractTemplates, contracts, leads, memberships, tenantSettings, users } from "../drizzle/schema";
import { isNull } from "drizzle-orm";
import { type ContractStarterKind } from "../shared/contracts";
import { CONTRACT_STARTERS, contractFields, contractNeedsSignature, contractOutline, contractStarter, missingDetails, withoutProviderSignatures, providerValues, renderContractHtml, type ContractBlock, type ContractEventKind, type ContractEventView, type ContractStatus, type ContractValues } from "../shared/contracts";
import { buildContractPdf } from "../shared/contract-pdf";
import { READ_MAX_SECONDS, SOURCE_NOTE, summarizeContractEvents, type TrackEvent, type TrackSource } from "../shared/contract-tracking";
import { isMachineRequest, isTooSoonAfterSend } from "../shared/tracking-guard";
import { COMPANY_FOOTER, TANESCO_LOGO_PATH } from "../shared/email-design";
import { logActivity } from "./activity";
import { deliverMail } from "./email-onboarding";
import type { Db } from "./lead-pipeline";

export type ContractRow = typeof contracts.$inferSelect;
const sha256 = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
/** Prüfsumme des Dokuments: Titel, Bausteine und Werte in fester Reihenfolge – so lässt sich später nachweisen, dass nichts verändert wurde. */
export const documentHashOf = (contract: { title: string; blocks: unknown; values: unknown }) => sha256(JSON.stringify({ title: contract.title, blocks: contract.blocks, values: contract.values }));
const clean = (value: string | null | undefined, max = 300) => (value ?? "").trim().slice(0, max);
const SIGNATURE_LIMIT = 400_000; // Zeichen der eingebetteten Unterschrift (PNG als data:)

async function providerFor(db: Db, tenantId: number): Promise<ContractValues> {
  const row = (await db.select({ footer: tenantSettings.companyFooter, website: tenantSettings.websiteUrl }).from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)).limit(1))[0];
  return providerValues(row?.footer ?? COMPANY_FOOTER, row?.website ?? null);
}
/** Werte der Anbieterseite füllen fehlende Felder auf – eigene Angaben (z. B. „vertreten durch“) gewinnen. */
export async function mergedValues(db: Db, tenantId: number, values: ContractValues | null | undefined): Promise<ContractValues> {
  const provider = await providerFor(db, tenantId); const own = (values ?? {}) as ContractValues;
  return { ...provider, ...Object.fromEntries(Object.entries(own).filter(([, value]) => typeof value === "string")) };
}
async function nextNumber(db: Db, tenantId: number) {
  const year = new Date().getFullYear(); const prefix = `V-${year}-`;
  const rows = await db.select({ number: contracts.number }).from(contracts).where(and(eq(contracts.tenantId, tenantId), sql`${contracts.number} like ${`${prefix}%`}`));
  const max = rows.reduce((best, row) => Math.max(best, Number(row.number.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}
async function addEvent(db: Db, tenantId: number, contractId: number, kind: ContractEventKind, extra: { note?: string | null; ip?: string | null; userAgent?: string | null; actorUserId?: number | null; source?: TrackSource | null } = {}): Promise<number> {
  const inserted = await db.insert(contractEvents).values({ tenantId, contractId, kind, note: extra.note ? extra.note.slice(0, 400) : null, ip: extra.ip ? extra.ip.slice(0, 64) : null, userAgent: extra.userAgent ? extra.userAgent.slice(0, 400) : null, source: extra.source ?? null, actorUserId: extra.actorUserId ?? null });
  return Number(inserted[0]?.insertId) || 0;
}
const eventsOf = async (db: Db, tenantId: number, contractId: number): Promise<Array<ContractEventView & { id: number; userAgent?: string | null; actorUserId?: number | null }>> => (await db.select().from(contractEvents).where(and(eq(contractEvents.tenantId, tenantId), eq(contractEvents.contractId, contractId))).orderBy(asc(contractEvents.id))).map((row) => ({ id: row.id, kind: row.kind, note: row.note, ip: row.ip, userAgent: row.userAgent, actorUserId: row.actorUserId, createdAt: row.createdAt, source: row.source, seconds: row.seconds, depth: row.depth }));
const blocksOf = (row: Pick<ContractRow, "blocks">) => (Array.isArray(row.blocks) ? row.blocks : []) as ContractBlock[];
const valuesOf = (row: Pick<ContractRow, "values">) => ((row.values && typeof row.values === "object" && !Array.isArray(row.values) ? row.values : {}) as ContractValues);
const publicRow = (row: ContractRow) => ({ id: row.id, number: row.number, title: row.title, status: row.status as ContractStatus, leadId: row.leadId, templateId: row.templateId, recipientEmail: row.recipientEmail, recipientName: row.recipientName, message: row.message, ourSignerName: row.ourSignerName, sentAt: row.sentAt, viewedAt: row.viewedAt, signedAt: row.signedAt, declinedAt: row.declinedAt, declineReason: row.declineReason, signerName: row.signerName, signerEmail: row.signerEmail, signerIp: row.signerIp, signerUserAgent: row.signerUserAgent, documentHash: row.documentHash, signatureHash: row.signatureHash, createdAt: row.createdAt, updatedAt: row.updatedAt, token: row.token, outline: contractOutline(blocksOf(row)) });

export async function listContracts(db: Db, tenantId: number) {
  const rows = await db.select().from(contracts).where(eq(contracts.tenantId, tenantId)).orderBy(desc(contracts.updatedAt));
  // Verlauf je Vertrag (gesendet, geöffnet, gelesen …) – ein Abruf für alle
  const events = rows.length ? await db.select({ contractId: contractEvents.contractId, kind: contractEvents.kind, createdAt: contractEvents.createdAt, userAgent: contractEvents.userAgent, source: contractEvents.source, seconds: contractEvents.seconds, depth: contractEvents.depth }).from(contractEvents).where(eq(contractEvents.tenantId, tenantId)).orderBy(asc(contractEvents.id)) : [];
  const byContract = new Map<number, TrackEvent[]>(); for (const event of events) { const list = byContract.get(event.contractId) ?? []; list.push(event); byContract.set(event.contractId, list); }
  return rows.map((row) => ({ ...publicRow(row), values: valuesOf(row), tracking: summarizeContractEvents(byContract.get(row.id) ?? []) }));
}
export async function getContract(db: Db, tenantId: number, id: number) {
  const row = (await db.select().from(contracts).where(and(eq(contracts.id, id), eq(contracts.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Vertrag nicht gefunden.");
  const values = await mergedValues(db, tenantId, valuesOf(row));
  const events = await eventsOf(db, tenantId, row.id);
  return { ...publicRow(row), blocks: blocksOf(row), values, ownValues: valuesOf(row), signatureImage: row.signatureImage ?? null, events, tracking: summarizeContractEvents(events) };
}
const STARTER_KINDS = CONTRACT_STARTERS.map((item) => item.kind);
export const isStarterKind = (value: unknown): value is ContractStarterKind => typeof value === "string" && (STARTER_KINDS as string[]).includes(value);
/**
 * Mitgelieferte Vorlagen (Leadliefervertrag, Testphase, leerer Vertrag) – mit der eigenen Fassung, falls die Firma sie angepasst hat.
 * Die eigene Fassung liegt als Zeile in contractTemplates (starterKind gesetzt); „Zurücksetzen“ löscht sie wieder.
 */
export async function contractDefaults(db: Db, tenantId: number) {
  const provider = await providerFor(db, tenantId);
  const own = new Map<string, typeof contractTemplates.$inferSelect>(); for (const row of await db.select().from(contractTemplates).where(eq(contractTemplates.tenantId, tenantId)).orderBy(asc(contractTemplates.id))) if (row.starterKind && isStarterKind(row.starterKind)) own.set(row.starterKind, row);
  const starters = CONTRACT_STARTERS.map((item) => { const base = contractStarter(item.kind); const custom = own.get(item.kind); const blocks = custom && Array.isArray(custom.blocks) && custom.blocks.length ? (custom.blocks as ContractBlock[]) : base.blocks; return { ...item, title: custom?.title || base.title, blocks, custom: Boolean(custom), templateId: custom?.id ?? null, updatedAt: custom?.updatedAt ?? null, outline: contractOutline(blocks) }; });
  const pick = (kind: ContractStarterKind) => { const found = starters.find((item) => item.kind === kind)!; return { title: found.title, blocks: found.blocks }; };
  return { values: provider, starter: pick("leadliefervertrag"), empty: pick("leer"), starters, logoBase: (process.env.APP_URL ?? "").replace(/\/+$/, "") };
}
/** Kontakte aus dem System als Kunde auswählen: Suche nach Firma, Name, E-Mail oder Ort (max. 20 Treffer). */
export async function contractLeadOptions(db: Db, tenantId: number, query: string) {
  const needle = query.trim().slice(0, 80); const pattern = `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const where = needle ? and(eq(leads.tenantId, tenantId), or(like(leads.company, pattern), like(leads.firstName, pattern), like(leads.lastName, pattern), like(leads.email, pattern), like(leads.city, pattern), like(sql`concat_ws(' ', ${leads.firstName}, ${leads.lastName})`, pattern))) : eq(leads.tenantId, tenantId);
  const rows = await db.select({ id: leads.id, company: leads.company, firstName: leads.firstName, lastName: leads.lastName, email: leads.email, postcode: leads.postcode, city: leads.city }).from(leads).where(where).orderBy(desc(leads.id)).limit(20);
  return rows.map((row) => ({ id: row.id, company: row.company ?? "", name: [row.firstName, row.lastName].filter(Boolean).join(" "), email: row.email ?? "", place: [row.postcode, row.city].filter(Boolean).join(" ") }));
}
/** Lead aus der Pipeline als Kunde übernehmen (Firma, Name, E-Mail, Anschrift). */
export async function contractValuesFromLead(db: Db, tenantId: number, leadId: number): Promise<ContractValues> {
  const lead = (await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId))).limit(1))[0]; if (!lead) throw new Error("Kontakt nicht gefunden.");
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  const meta = (lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata) ? lead.metadata : {}) as Record<string, unknown>; const street = typeof meta.street === "string" ? meta.street : typeof meta.strasse === "string" ? meta.strasse : "";
  return { firma: lead.company ?? "", name, email: lead.email ?? "", strasse: street, plzOrt: [lead.postcode, lead.city].filter(Boolean).join(" ") };
}
const EDITABLE: ContractStatus[] = ["entwurf", "abgelehnt", "storniert"];
export async function saveContract(db: Db, tenantId: number, userId: number, input: { id?: number | null; title: string; blocks: ContractBlock[]; values?: ContractValues | null; recipientEmail?: string | null; recipientName?: string | null; leadId?: number | null; templateId?: number | null; ourSignerName?: string | null }) {
  const title = clean(input.title, 200) || "Vertrag"; if (!Array.isArray(input.blocks) || !input.blocks.length) throw new Error("Der Vertrag braucht mindestens einen Baustein.");
  if (JSON.stringify(input.blocks).length > 6_000_000) throw new Error("Der Vertrag ist zu groß (eingebettete Bilder bitte verkleinern).");
  const values = Object.fromEntries(Object.entries(input.values ?? {}).filter(([key, value]) => /^[a-zA-Z0-9_]+$/.test(key) && typeof value === "string").map(([key, value]) => [key, String(value).slice(0, 2000)])) as ContractValues;
  const recipientEmail = clean(input.recipientEmail, 320).toLowerCase() || null; const recipientName = clean(input.recipientName, 200) || null;
  if (input.id) {
    const row = (await db.select().from(contracts).where(and(eq(contracts.id, input.id), eq(contracts.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Vertrag nicht gefunden.");
    if (!EDITABLE.includes(row.status as ContractStatus)) throw new Error("Ein gesendeter oder unterschriebener Vertrag lässt sich nicht mehr ändern – bitte eine Kopie anlegen.");
    await db.update(contracts).set({ title, blocks: input.blocks, values, recipientEmail, recipientName, leadId: input.leadId ?? row.leadId ?? null, templateId: input.templateId ?? row.templateId ?? null, ourSignerName: clean(input.ourSignerName, 160) || row.ourSignerName || null, status: row.status === "entwurf" ? "entwurf" : "entwurf", token: row.status === "entwurf" ? row.token : null, declinedAt: null, declineReason: null }).where(eq(contracts.id, row.id));
    await addEvent(db, tenantId, row.id, "geaendert", { actorUserId: userId });
    return { id: row.id, number: row.number };
  }
  const number = await nextNumber(db, tenantId);
  const inserted = await db.insert(contracts).values({ tenantId, number, title, status: "entwurf", blocks: input.blocks, values, recipientEmail, recipientName, leadId: input.leadId ?? null, templateId: input.templateId ?? null, ourSignerName: clean(input.ourSignerName, 160) || null, createdByUserId: userId });
  const id = Number(inserted[0]?.insertId) || 0;
  await addEvent(db, tenantId, id, "erstellt", { actorUserId: userId });
  return { id, number };
}
export async function deleteContract(db: Db, tenantId: number, id: number) {
  const row = (await db.select({ status: contracts.status }).from(contracts).where(and(eq(contracts.id, id), eq(contracts.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Vertrag nicht gefunden.");
  if (row.status === "unterschrieben") throw new Error("Ein unterschriebener Vertrag lässt sich nicht löschen – er ist der Nachweis. Du kannst ihn stornieren.");
  await db.delete(contractEvents).where(and(eq(contractEvents.tenantId, tenantId), eq(contractEvents.contractId, id)));
  await db.delete(contracts).where(and(eq(contracts.id, id), eq(contracts.tenantId, tenantId)));
  return { success: true as const };
}
export async function duplicateContract(db: Db, tenantId: number, userId: number, id: number) {
  const row = (await db.select().from(contracts).where(and(eq(contracts.id, id), eq(contracts.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Vertrag nicht gefunden.");
  const number = await nextNumber(db, tenantId);
  const inserted = await db.insert(contracts).values({ tenantId, number, title: `${row.title} (Kopie)`.slice(0, 200), status: "entwurf", blocks: withoutProviderSignatures(blocksOf(row)), values: valuesOf(row), recipientEmail: row.recipientEmail, recipientName: row.recipientName, leadId: row.leadId, templateId: row.templateId, ourSignerName: row.ourSignerName, createdByUserId: userId });
  const newId = Number(inserted[0]?.insertId) || 0; await addEvent(db, tenantId, newId, "erstellt", { note: `Kopie von ${row.number}`, actorUserId: userId });
  return { id: newId, number };
}

/** E-Mail an den Kunden mit dem Unterschriftslink – schlicht, mit rotem Knopf, ohne Kampagnen-Fußzeile. */
function inviteMail(input: { title: string; number: string; recipientName: string | null; message: string | null; url: string; provider: ContractValues; reminder?: boolean; pixelUrl?: string | null }) {
  const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const greeting = input.recipientName ? `Guten Tag ${esc(input.recipientName)},` : "Guten Tag,";
  const intro = input.reminder ? `kurze Erinnerung: der Vertrag „${esc(input.title)}“ wartet noch auf Ihre Unterschrift.` : `anbei erhalten Sie den Vertrag „${esc(input.title)}“ zur Durchsicht und elektronischen Unterschrift.`;
  const message = input.message?.trim() ? `<p style="margin:0 0 14px;white-space:pre-wrap">${esc(input.message.trim())}</p>` : "";
  const html = `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#101828;max-width:620px"><p style="margin:0 0 14px">${greeting}</p><p style="margin:0 0 14px">${intro} Über den Knopf öffnen Sie den Vertrag, prüfen die Angaben und unterschreiben direkt online – mit Maus, Finger oder getippt. Das dauert etwa zwei Minuten.</p>${message}<p style="margin:22px 0"><a href="${esc(input.url)}" style="display:inline-block;padding:13px 22px;border-radius:12px;background:#bc001d;color:#ffffff;text-decoration:none;font-weight:700">Vertrag ansehen und unterschreiben</a></p><p style="margin:0 0 14px;font-size:13px;color:#667085">Falls der Knopf nicht funktioniert: ${esc(input.url)}</p><p style="margin:0 0 6px">Vielen Dank</p><p style="margin:18px 0 0;font-size:13px;color:#667085">${esc(input.provider.anbieterFirma ?? "")}${input.provider.anbieterAdresse ? ` · ${esc(input.provider.anbieterAdresse)}` : ""} · Vertragsnummer ${esc(input.number)}</p>${input.pixelUrl ? `<img src="${esc(input.pixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : ""}</div>`;
  const text = `${input.recipientName ? `Guten Tag ${input.recipientName},` : "Guten Tag,"}\n\n${input.reminder ? `kurze Erinnerung: der Vertrag „${input.title}“ wartet noch auf Ihre Unterschrift.` : `anbei erhalten Sie den Vertrag „${input.title}“ zur Durchsicht und elektronischen Unterschrift.`}\n\n${input.message?.trim() ? `${input.message.trim()}\n\n` : ""}Vertrag ansehen und unterschreiben: ${input.url}\n\nVielen Dank\n${input.provider.anbieterFirma ?? ""} · Vertragsnummer ${input.number}`;
  return { subject: `${input.reminder ? "Erinnerung: " : ""}Vertrag zur Unterschrift – ${input.title}`, html, text };
}
export async function sendContract(db: Db, tenantId: number, userId: number, input: { id: number; recipientEmail: string; recipientName?: string | null; message?: string | null; appUrl: string }) {
  const row = (await db.select().from(contracts).where(and(eq(contracts.id, input.id), eq(contracts.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Vertrag nicht gefunden.");
  if (row.status === "unterschrieben") throw new Error("Dieser Vertrag ist schon unterschrieben.");
  const email = clean(input.recipientEmail, 320).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Bitte eine gültige E-Mail-Adresse des Kunden angeben.");
  const blocks = blocksOf(row); if (!contractNeedsSignature(blocks)) throw new Error("Der Vertrag braucht einen Baustein „Unterschrift Kunde“ – sonst kann niemand unterschreiben.");
  const open = missingDetails(blocks); if (open.length) throw new Error(`Bitte vor dem Senden ausfüllen: ${open.join(", ")}`);
  const values = await mergedValues(db, tenantId, valuesOf(row)); const token = row.token && ["gesendet", "angesehen"].includes(row.status) ? row.token : crypto.randomBytes(24).toString("hex");
  const documentHash = documentHashOf({ title: row.title, blocks, values: valuesOf(row) });
  const recipientName = clean(input.recipientName, 200) || row.recipientName || values.name || null; const message = clean(input.message, 2000) || null;
  await db.update(contracts).set({ status: "gesendet", token, recipientEmail: email, recipientName, message, sentAt: new Date(), documentHash, declinedAt: null, declineReason: null }).where(eq(contracts.id, row.id));
  const base = input.appUrl.replace(/\/+$/, ""); const url = `${base}/vertrag/${token}`;
  // In der E-Mail trägt der Link eine Kennung (m=1) und es gibt ein Zählbild – so sieht man später, ob die E-Mail geöffnet und der Link angeklickt wurde
  const mail = inviteMail({ title: row.title, number: row.number, recipientName, message, url: `${url}?m=1`, provider: values, pixelUrl: `${base}/api/vertrag/${token}/o.gif?m=1` });
  const result = await deliverMail({ to: email, subject: mail.subject, html: mail.html, text: mail.text }, { db, tenantId });
  await addEvent(db, tenantId, row.id, "gesendet", { note: `an ${email}${result.status === "simuliert" ? " (Versand simuliert – kein Mail-Versand eingerichtet)" : ""}`, actorUserId: userId });
  await logActivity(db, tenantId, { kind: "sonstiges", title: `Vertrag „${row.title}“ zur Unterschrift gesendet`, detail: `an ${email}`, refType: "contract", refId: row.id, actorUserId: userId });
  return { id: row.id, token, url, mail: result.status, note: result.note ?? null };
}
export async function remindContract(db: Db, tenantId: number, userId: number, id: number, appUrl: string) {
  const row = (await db.select().from(contracts).where(and(eq(contracts.id, id), eq(contracts.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Vertrag nicht gefunden.");
  if (!row.token || !["gesendet", "angesehen"].includes(row.status) || !row.recipientEmail) throw new Error("Nur gesendete, noch nicht unterschriebene Verträge lassen sich erinnern.");
  const values = await mergedValues(db, tenantId, valuesOf(row)); const base = appUrl.replace(/\/+$/, "");
  const mail = inviteMail({ title: row.title, number: row.number, recipientName: row.recipientName, message: row.message, url: `${base}/vertrag/${row.token}?m=2`, provider: values, reminder: true, pixelUrl: `${base}/api/vertrag/${row.token}/o.gif?m=2` });
  const result = await deliverMail({ to: row.recipientEmail, subject: mail.subject, html: mail.html, text: mail.text }, { db, tenantId });
  await addEvent(db, tenantId, row.id, "erinnert", { note: `an ${row.recipientEmail}${result.status === "simuliert" ? " (simuliert)" : ""}`, actorUserId: userId });
  return { mail: result.status, note: result.note ?? null };
}
export async function cancelContract(db: Db, tenantId: number, userId: number, id: number) {
  const row = (await db.select({ status: contracts.status }).from(contracts).where(and(eq(contracts.id, id), eq(contracts.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Vertrag nicht gefunden.");
  await db.update(contracts).set({ status: "storniert" }).where(eq(contracts.id, id));
  await addEvent(db, tenantId, id, "storniert", { actorUserId: userId });
  return { success: true as const };
}

/* ---------- Öffentliche Seite: ansehen, unterschreiben, ablehnen, PDF ---------- */
export type PublicMeta = { ip?: string | null; userAgent?: string | null; method?: string | null; /** wie die Seite erreicht wurde: Link aus der E-Mail, aus der Erinnerung oder direkt */ source?: TrackSource | null; /** Aufruf aus der eigenen Firma (angemeldet) – zählt nicht als Aufruf des Kunden */ internal?: boolean };
const VIEW_REPEAT_MS = 30_000; const OPEN_REPEAT_MS = 60_000; const READ_WINDOW_MS = 12 * 3600_000;
/** Zeitpunkt des letzten Versands (Einladung oder Erinnerung) – Aufrufe in den Sekunden danach kommen von Scannern, nicht von Menschen. */
async function lastMailAt(db: Db, row: ContractRow): Promise<Date | null> {
  const last = (await db.select({ at: contractEvents.createdAt }).from(contractEvents).where(and(eq(contractEvents.tenantId, row.tenantId), eq(contractEvents.contractId, row.id), inArray(contractEvents.kind, ["gesendet", "erinnert"]))).orderBy(desc(contractEvents.id)).limit(1))[0];
  return last?.at ?? row.sentAt ?? null;
}
const countsAsHuman = async (db: Db, row: ContractRow, meta: PublicMeta) => !meta.internal && !isMachineRequest(meta) && !isTooSoonAfterSend(await lastMailAt(db, row));
/** Hat es dasselbe Ereignis gerade eben schon gegeben (Seite neu geladen, Bild doppelt abgerufen)? Dann dessen Nummer. */
async function recentEvent(db: Db, row: ContractRow, kind: ContractEventKind, withinMs: number, ip?: string | null): Promise<number | null> {
  const recent = await db.select({ id: contractEvents.id, ip: contractEvents.ip }).from(contractEvents).where(and(eq(contractEvents.tenantId, row.tenantId), eq(contractEvents.contractId, row.id), eq(contractEvents.kind, kind), gte(contractEvents.createdAt, new Date(Date.now() - withinMs)))).orderBy(desc(contractEvents.id)).limit(5);
  return recent.find((item) => (item.ip ?? null) === (ip ?? null))?.id ?? null;
}
/**
 * Aufruf der Vertragsseite durch den Kunden festhalten: jeder Aufruf ein Eintrag (mit Herkunft, IP und Gerät), der erste
 * setzt den Vertrag auf „angesehen“ und meldet es in der Glocke. Liefert die Nummer des Eintrags – an ihr hängen Lesedauer und Lesetiefe.
 */
async function noteView(db: Db, row: ContractRow, meta: PublicMeta): Promise<number | null> {
  if (!(await countsAsHuman(db, row, meta))) return null;
  const ip = clean(meta.ip, 64) || null; const again = await recentEvent(db, row, "angesehen", VIEW_REPEAT_MS, ip); if (again) return again;
  const source: TrackSource = meta.source ?? "link"; const stage = row.status === "unterschrieben" ? " – unterschriebene Fassung" : row.status === "abgelehnt" || row.status === "storniert" ? " – Vertrag nicht mehr offen" : "";
  const id = await addEvent(db, row.tenantId, row.id, "angesehen", { note: `${SOURCE_NOTE[source]}${stage}`, ip, userAgent: meta.userAgent, source });
  if (row.status === "gesendet") {
    await db.update(contracts).set({ status: "angesehen", viewedAt: new Date() }).where(eq(contracts.id, row.id)); row.status = "angesehen";
    await logActivity(db, row.tenantId, { kind: "sonstiges", title: `Vertrag „${row.title}“ wurde geöffnet`, detail: `${row.recipientName || row.recipientEmail || "Der Kunde"} hat den Vertrag ${row.number} zum ersten Mal geöffnet`, refType: "contract", refId: row.id, leadId: row.leadId ?? null }).catch(() => null);
  }
  return id;
}
async function byToken(db: Db, token: string) {
  if (!/^[a-f0-9]{24,64}$/i.test(token)) return null;
  return (await db.select().from(contracts).where(eq(contracts.token, token)).limit(1))[0] ?? null;
}
export async function publicContract(db: Db, token: string, meta: PublicMeta, appUrl: string) {
  const row = await byToken(db, token); if (!row || row.status === "entwurf") return null;
  const viewId = await noteView(db, row, meta).catch((error) => { console.error("[Verträge] Aufruf:", error instanceof Error ? error.message : error); return null; });
  return contractPageHtml(db, row, appUrl, viewId);
}
/** Zählbild in der E-Mail: „E-Mail geöffnet“ – ohne Scanner, Vorab-Laden und doppelte Abrufe. */
export async function trackContractMailOpen(db: Db, token: string, meta: PublicMeta) {
  const row = await byToken(db, token); if (!row || !["gesendet", "angesehen"].includes(row.status)) return false;
  if (!(await countsAsHuman(db, row, meta))) return false;
  const ip = clean(meta.ip, 64) || null; if (await recentEvent(db, row, "mail_geoeffnet", OPEN_REPEAT_MS, ip)) return true;
  await addEvent(db, row.tenantId, row.id, "mail_geoeffnet", { note: meta.source === "erinnerung" ? "die Erinnerung" : "die E-Mail mit dem Vertrag", ip, userAgent: meta.userAgent, source: meta.source ?? "mail" });
  return true;
}
/** Die Vertragsseite meldet, wie lange gelesen und wie weit gescrollt wurde – gehört zu genau einem Aufruf und wächst nur. */
export async function trackContractReading(db: Db, token: string, input: { viewId: number; seconds: number; depth: number }) {
  const row = await byToken(db, token); if (!row) return false;
  const viewId = Math.floor(Number(input.viewId)); const seconds = Math.max(0, Math.min(READ_MAX_SECONDS, Math.floor(Number(input.seconds) || 0))); const depth = Math.max(0, Math.min(100, Math.floor(Number(input.depth) || 0)));
  if (!Number.isFinite(viewId) || viewId <= 0) return false;
  const event = (await db.select({ id: contractEvents.id, seconds: contractEvents.seconds, depth: contractEvents.depth }).from(contractEvents).where(and(eq(contractEvents.id, viewId), eq(contractEvents.tenantId, row.tenantId), eq(contractEvents.contractId, row.id), eq(contractEvents.kind, "angesehen"), gte(contractEvents.createdAt, new Date(Date.now() - READ_WINDOW_MS)))).limit(1))[0];
  if (!event) return false;
  await db.update(contractEvents).set({ seconds: Math.max(event.seconds ?? 0, seconds), depth: Math.max(event.depth ?? 0, depth) }).where(eq(contractEvents.id, event.id));
  return true;
}
async function contractPageHtml(db: Db, row: ContractRow, appUrl: string, viewId: number | null = null) {
  const values = await mergedValues(db, row.tenantId, valuesOf(row)); const base = appUrl.replace(/\/+$/, "");
  const mode = row.status === "unterschrieben" ? "unterschrieben" : row.status === "abgelehnt" ? "abgelehnt" : row.status === "storniert" ? "storniert" : "unterschreiben";
  const signature = row.signedAt ? { name: row.signerName ?? "", image: row.signatureImage ?? null, signedAt: row.signedAt, ip: row.signerIp, userAgent: row.signerUserAgent, documentHash: row.documentHash, signedHash: row.signatureHash } : null;
  const events = mode === "unterschrieben" ? await eventsOf(db, row.tenantId, row.id) : null;
  return renderContractHtml({ title: row.title, blocks: blocksOf(row) }, { mode, values, fieldValues: values, signature, events, logoBase: base, token: row.token, apiBase: "", signerName: row.recipientName ?? values.name ?? "", pdfUrl: mode === "unterschrieben" ? `${base}/api/vertrag/${row.token}/pdf` : null, track: viewId ? { viewId, url: `${base}/api/vertrag/${row.token}/lesen` } : null });
}
export async function signContract(db: Db, token: string, input: { signerName: string; fields?: Record<string, string> | null; signatureImage: string; method?: string | null; consent?: boolean }, meta: PublicMeta, appUrl: string) {
  const row = await byToken(db, token); if (!row) throw new Error("Dieser Link ist ungültig.");
  if (row.status === "unterschrieben") throw new Error("Dieser Vertrag ist bereits unterschrieben.");
  if (!["gesendet", "angesehen"].includes(row.status)) throw new Error("Dieser Vertrag kann nicht mehr unterschrieben werden.");
  const signerName = clean(input.signerName, 200); if (signerName.length < 3) throw new Error("Bitte den vollständigen Namen eintragen.");
  if (!input.consent) throw new Error("Bitte die Zustimmung bestätigen.");
  const image = String(input.signatureImage ?? ""); if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length < 200 || image.length > SIGNATURE_LIMIT) throw new Error("Die Unterschrift fehlt oder ist zu groß.");
  const blocks = blocksOf(row); const fields: Record<string, string> = {};
  for (const field of contractFields(blocks)) { const value = clean(input.fields?.[field.key], 500); if (field.required && !value) throw new Error(`Bitte ausfüllen: ${field.label}`); fields[field.key] = value; }
  const signedAt = new Date(); const ip = clean(meta.ip, 64) || null; const userAgent = clean(meta.userAgent, 400) || null;
  const documentHash = row.documentHash ?? documentHashOf({ title: row.title, blocks, values: valuesOf(row) });
  const signatureHash = sha256(`${documentHash}|${signerName}|${signedAt.toISOString()}|${ip ?? ""}|${sha256(image)}|${JSON.stringify(fields)}`);
  const values = { ...valuesOf(row), ...fields };
  await db.update(contracts).set({ status: "unterschrieben", signedAt, signerName, signerEmail: row.recipientEmail, signerIp: ip, signerUserAgent: userAgent, signatureImage: image, documentHash, signatureHash, values }).where(eq(contracts.id, row.id));
  await addEvent(db, row.tenantId, row.id, "unterschrieben", { note: `${signerName}${input.method === "tippen" ? " (getippt)" : " (gezeichnet)"}`, ip, userAgent });
  await logActivity(db, row.tenantId, { kind: "sonstiges", title: `Vertrag „${row.title}“ unterschrieben`, detail: `von ${signerName}${row.recipientEmail ? ` (${row.recipientEmail})` : ""}`, refType: "contract", refId: row.id, leadId: row.leadId ?? null });
  // Bestätigung an den Kunden (mit PDF) und Hinweis an den Inhaber
  const fresh = (await db.select().from(contracts).where(eq(contracts.id, row.id)).limit(1))[0];
  const base = appUrl.replace(/\/+$/, ""); const url = `${base}/vertrag/${row.token}`;
  try {
    const pdf = fresh ? Buffer.from(await contractPdf(db, fresh)).toString("base64") : null; const provider = await mergedValues(db, row.tenantId, valuesOf(row));
    if (row.recipientEmail) await deliverMail({ to: row.recipientEmail, subject: `Ihre Kopie: ${row.title} – unterschrieben`, html: `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#101828;max-width:620px"><p>Guten Tag ${signerName},</p><p>vielen Dank – Sie haben den Vertrag „${row.title}“ am ${signedAt.toLocaleDateString("de-DE")} elektronisch unterschrieben. Die unterschriebene Fassung mit Nachweis hängt als PDF an und bleibt unter diesem Link abrufbar:</p><p><a href="${url}" style="color:#bc001d">${url}</a></p><p>Vielen Dank</p><p style="font-size:13px;color:#667085">${provider.anbieterFirma ?? ""}</p></div>`, text: `Vielen Dank – Sie haben den Vertrag „${row.title}“ elektronisch unterschrieben. Unterschriebene Fassung: ${url}`, attachments: pdf ? [{ filename: `${row.number}-${row.title.replace(/[^a-z0-9äöüß-]+/gi, "_").slice(0, 60)}.pdf`, content: pdf, contentType: "application/pdf", encoding: "base64" }] : [] }, { db, tenantId: row.tenantId });
    const owner = (await db.select({ email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.tenantId, row.tenantId), eq(memberships.role, "inhaber"))).orderBy(asc(memberships.id)).limit(1))[0];
    const creator = row.createdByUserId ? (await db.select({ email: users.email }).from(users).where(eq(users.id, row.createdByUserId)).limit(1))[0] : null;
    const notify = Array.from(new Set([owner?.email, creator?.email].filter((value): value is string => Boolean(value))));
    for (const to of notify) await deliverMail({ to, subject: `Unterschrieben: ${row.title} (${row.number})`, html: `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#101828"><p>${signerName}${row.recipientEmail ? ` (${row.recipientEmail})` : ""} hat den Vertrag „${row.title}“ gerade elektronisch unterschrieben.</p><p><a href="${base}/?page=Vertr%C3%A4ge&vertrag=${row.id}" style="color:#bc001d">In Tanesco Leads öffnen</a> · <a href="${url}" style="color:#bc001d">Unterschriebene Fassung</a></p></div>`, text: `${signerName} hat den Vertrag „${row.title}“ unterschrieben: ${url}`, attachments: pdf ? [{ filename: `${row.number}.pdf`, content: pdf, contentType: "application/pdf", encoding: "base64" }] : [] }, { db, tenantId: row.tenantId });
  } catch (error) { console.error("[Verträge] Bestätigung:", error instanceof Error ? error.message : error); }
  return { success: true as const, signedAt };
}
export async function declineContract(db: Db, token: string, reason: string | null | undefined, meta: PublicMeta) {
  const row = await byToken(db, token); if (!row) throw new Error("Dieser Link ist ungültig.");
  if (!["gesendet", "angesehen"].includes(row.status)) throw new Error("Dieser Vertrag kann nicht mehr abgelehnt werden.");
  const note = clean(reason, 400) || null;
  await db.update(contracts).set({ status: "abgelehnt", declinedAt: new Date(), declineReason: note }).where(eq(contracts.id, row.id));
  await addEvent(db, row.tenantId, row.id, "abgelehnt", { note, ip: meta.ip, userAgent: meta.userAgent });
  await logActivity(db, row.tenantId, { kind: "sonstiges", title: `Vertrag „${row.title}“ abgelehnt`, detail: note, refType: "contract", refId: row.id, leadId: row.leadId ?? null });
  return { success: true as const };
}
export async function publicPdf(db: Db, token: string, meta: PublicMeta = {}) {
  const row = await byToken(db, token); if (!row || row.status === "entwurf") return null;
  try { const ip = clean(meta.ip, 64) || null; if ((await countsAsHuman(db, row, meta)) && !(await recentEvent(db, row, "pdf_geladen", VIEW_REPEAT_MS, ip))) await addEvent(db, row.tenantId, row.id, "pdf_geladen", { ip, userAgent: meta.userAgent }); } catch (error) { console.error("[Verträge] PDF-Abruf:", error instanceof Error ? error.message : error); }
  return { buffer: await contractPdf(db, row), fileName: `${row.number}-${row.title.replace(/[^a-z0-9äöüß-]+/gi, "_").slice(0, 60)}.pdf` };
}
async function logoDataUrl(): Promise<string | null> {
  try { const { default: fs } = await import("node:fs/promises"); const { default: path } = await import("node:path"); const file = await fs.readFile(path.resolve(process.cwd(), "client", "public", TANESCO_LOGO_PATH.replace(/^\//, ""))); return `data:image/png;base64,${file.toString("base64")}`; } catch { try { const { default: fs } = await import("node:fs/promises"); const { default: path } = await import("node:path"); const file = await fs.readFile(path.resolve(process.cwd(), "dist", "public", TANESCO_LOGO_PATH.replace(/^\//, ""))); return `data:image/png;base64,${file.toString("base64")}`; } catch { return null; } }
}
export async function contractPdf(db: Db, row: ContractRow): Promise<ArrayBuffer> {
  const values = await mergedValues(db, row.tenantId, valuesOf(row));
  const signature = row.signedAt ? { name: row.signerName ?? "", image: row.signatureImage ?? null, signedAt: row.signedAt, ip: row.signerIp, userAgent: row.signerUserAgent, documentHash: row.documentHash, signedHash: row.signatureHash } : null;
  return buildContractPdf({ title: row.title, blocks: blocksOf(row), values, fieldValues: values, signature, events: signature ? await eventsOf(db, row.tenantId, row.id) : null, logoDataUrl: await logoDataUrl() });
}
export async function contractPdfForUser(db: Db, tenantId: number, id: number) {
  const row = (await db.select().from(contracts).where(and(eq(contracts.id, id), eq(contracts.tenantId, tenantId))).limit(1))[0]; if (!row) throw new Error("Vertrag nicht gefunden.");
  return { base64: Buffer.from(await contractPdf(db, row)).toString("base64"), fileName: `${row.number}-${row.title.replace(/[^a-z0-9äöüß-]+/gi, "_").slice(0, 60)}.pdf` };
}
/** Vorschau-HTML für die App (Builder/Detail) – mit Anbieterwerten, ohne öffentliche Aktionen. */
export async function contractPreviewHtml(db: Db, tenantId: number, input: { title: string; blocks: ContractBlock[]; values?: ContractValues | null; id?: number | null }, appUrl: string) {
  const row = input.id ? (await db.select().from(contracts).where(and(eq(contracts.id, input.id), eq(contracts.tenantId, tenantId))).limit(1))[0] ?? null : null;
  if (row && row.status !== "entwurf") return contractPageHtml(db, row, appUrl);
  const values = await mergedValues(db, tenantId, input.values ?? null);
  return renderContractHtml({ title: input.title, blocks: input.blocks }, { mode: "entwurf", values, logoBase: appUrl.replace(/\/+$/, "") });
}

/* ---------- Vorlagen ---------- */
export async function listContractTemplates(db: Db, tenantId: number) {
  const rows = await db.select().from(contractTemplates).where(and(eq(contractTemplates.tenantId, tenantId), isNull(contractTemplates.starterKind))).orderBy(asc(contractTemplates.name)); // angepasste mitgelieferte Vorlagen stehen bei den mitgelieferten
  return rows.map((row) => ({ id: row.id, name: row.name, title: row.title, blocks: (Array.isArray(row.blocks) ? row.blocks : []) as ContractBlock[], outline: contractOutline((Array.isArray(row.blocks) ? row.blocks : []) as ContractBlock[]), updatedAt: row.updatedAt }));
}
export async function saveContractTemplate(db: Db, tenantId: number, userId: number, input: { id?: number | null; name: string; title?: string | null; blocks: ContractBlock[]; starterKind?: ContractStarterKind | null }) {
  if (!input.blocks?.length) throw new Error("Die Vorlage braucht mindestens einen Baustein.");
  if (JSON.stringify(input.blocks).length > 6_000_000) throw new Error("Die Vorlage ist zu groß (eingebettete Bilder bitte verkleinern).");
  const blocks = withoutProviderSignatures(input.blocks); const title = clean(input.title, 200) || null; // eine Vorlage trägt nie eine fertige Unterschrift
  if (input.starterKind) {
    // Eigene Fassung einer mitgelieferten Vorlage: genau eine Zeile je Art
    if (!isStarterKind(input.starterKind)) throw new Error("Diese Vorlage gibt es nicht.");
    const label = CONTRACT_STARTERS.find((item) => item.kind === input.starterKind)?.label ?? "Vorlage";
    const existing = (await db.select({ id: contractTemplates.id }).from(contractTemplates).where(and(eq(contractTemplates.tenantId, tenantId), eq(contractTemplates.starterKind, input.starterKind))).orderBy(asc(contractTemplates.id)).limit(1))[0];
    if (existing) { await db.update(contractTemplates).set({ name: label, title, blocks }).where(eq(contractTemplates.id, existing.id)); return { id: existing.id }; }
    const inserted = await db.insert(contractTemplates).values({ tenantId, name: label, title, blocks, starterKind: input.starterKind, createdByUserId: userId }); return { id: Number(inserted[0]?.insertId) || 0 };
  }
  const name = clean(input.name, 160) || "Vorlage";
  if (input.id) { const row = (await db.select({ id: contractTemplates.id }).from(contractTemplates).where(and(eq(contractTemplates.id, input.id), eq(contractTemplates.tenantId, tenantId), isNull(contractTemplates.starterKind))).limit(1))[0]; if (!row) throw new Error("Vorlage nicht gefunden."); await db.update(contractTemplates).set({ name, title, blocks }).where(eq(contractTemplates.id, row.id)); return { id: row.id }; }
  const inserted = await db.insert(contractTemplates).values({ tenantId, name, title, blocks, createdByUserId: userId }); return { id: Number(inserted[0]?.insertId) || 0 };
}
/** Mitgelieferte Vorlage wieder auf den Auslieferungsstand setzen (die eigene Fassung wird gelöscht). */
export async function resetContractStarter(db: Db, tenantId: number, kind: ContractStarterKind) {
  if (!isStarterKind(kind)) throw new Error("Diese Vorlage gibt es nicht.");
  await db.delete(contractTemplates).where(and(eq(contractTemplates.tenantId, tenantId), eq(contractTemplates.starterKind, kind)));
  return { success: true as const };
}
export async function deleteContractTemplate(db: Db, tenantId: number, id: number) { await db.delete(contractTemplates).where(and(eq(contractTemplates.id, id), eq(contractTemplates.tenantId, tenantId))); return { success: true as const }; }
export const CONTRACT_STATUSES: ContractStatus[] = ["entwurf", "gesendet", "angesehen", "unterschrieben", "abgelehnt", "storniert"];
export { inArray };
