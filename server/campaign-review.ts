/**
 * Einzeln schreiben & freigeben: Bei Kampagnen mit „Erst-E-Mail einzeln freigeben“ bekommt jeder Lead eine eigene
 * Erst-E-Mail. Die KI schreibt einen Entwurf (Firma, Ort, Branche, Liste), du liest, änderst und gibst frei – erst dann
 * geht sie raus. Nachfass-Mails laufen danach automatisch aus der Vorlage.
 * Dazu das Tageslimit für alle Kampagnen zusammen (Standard 50 E-Mails am Tag).
 */
import { and, asc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { emailCampaignEvents, emailCampaignRecipients, emailCampaigns, leads, mailSettings } from "../drizzle/schema";
import { approachLabel, DRAFT_APPROACHES, thirdPartyTemplate, type DraftApproach, type DraftOption, blocksToPlainText, dayStartIn, DEFAULT_CAMPAIGN_DAILY_LIMIT, fillPlaceholdersSafe, firstSendNode, recipientValues, type EmailTree } from "../shared/email-campaigns";
import { extraFieldsOf } from "../shared/cold-list";
import { invokeLLM } from "./_core/llm";
import { readWebsiteText } from "./lead-finder";
import { domainOf, isFreemailDomain } from "./inbox";
import type { Db } from "./lead-pipeline";

type Recipient = typeof emailCampaignRecipients.$inferSelect;

export async function campaignDailyLimit(db: Db, tenantId: number): Promise<number> {
  const row = (await db.select({ limit: mailSettings.campaignDailyLimit }).from(mailSettings).where(eq(mailSettings.tenantId, tenantId)).limit(1))[0];
  return row?.limit && row.limit > 0 ? row.limit : DEFAULT_CAMPAIGN_DAILY_LIMIT;
}
export async function sentToday(db: Db, tenantId: number, now = new Date()): Promise<number> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.kind, "gesendet"), gte(emailCampaignEvents.createdAt, dayStartIn(now))));
  return Number(count) || 0;
}
export async function campaignDailyStatus(db: Db, tenantId: number) {
  const limit = await campaignDailyLimit(db, tenantId); const sent = await sentToday(db, tenantId);
  return { limit, sent, left: Math.max(0, limit - sent) };
}
export async function setCampaignDailyLimit(db: Db, tenantId: number, limit: number) {
  const value = Math.max(1, Math.min(2000, Math.round(limit)));
  const existing = (await db.select({ id: mailSettings.id }).from(mailSettings).where(eq(mailSettings.tenantId, tenantId)).limit(1))[0];
  if (existing) await db.update(mailSettings).set({ campaignDailyLimit: value }).where(eq(mailSettings.id, existing.id));
  else await db.insert(mailSettings).values({ tenantId, campaignDailyLimit: value });
  return { limit: value };
}

async function loadContext(db: Db, tenantId: number, recipient: Recipient) {
  const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, recipient.campaignId), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0];
  if (!campaign) throw new Error("Kampagne nicht gefunden.");
  const lead = recipient.leadId ? (await db.select().from(leads).where(and(eq(leads.id, recipient.leadId), eq(leads.tenantId, tenantId))).limit(1))[0] ?? null : null;
  const node = firstSendNode((campaign.tree ?? { start: null, nodes: [] }) as EmailTree);
  if (!node) throw new Error("Die Kampagne hat keine E-Mail im Ablauf.");
  const values = recipientValues({ firstName: lead?.firstName ?? recipient.name?.split(" ")[0], lastName: lead?.lastName ?? recipient.name?.split(" ").slice(1).join(" "), company: lead?.company ?? recipient.company, city: lead?.city, salutation: (lead?.metadata as { salutation?: string } | null)?.salutation ?? null, email: recipient.email, fields: extraFieldsOf(lead?.metadata) });
  return { campaign, lead, node, values };
}

/** Entwurf ohne KI: die Vorlage mit den Daten des Leads gefüllt. */
function templateDraft(node: NonNullable<ReturnType<typeof firstSendNode>>, values: Record<string, string>) {
  return { subject: fillPlaceholdersSafe(node.subject, values).slice(0, 300), text: blocksToPlainText(node.blocks, values) };
}

/** Webseite eines Kontakts: aus den Daten (Feld „Webseite“, „Homepage“, „URL“ …) – sonst aus der Firmen-Adresse (info@firma.de → firma.de; nicht Gmail, GMX usw.). */
export function websiteOf(metadata: unknown, email: string | null | undefined): string | null {
  const meta = (metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}) as Record<string, unknown>;
  const direct = [meta.website, meta.webseite, meta.homepage].find((value) => typeof value === "string" && value.trim()) as string | undefined;
  const fromFields = Object.entries(extraFieldsOf(metadata)).find(([key, value]) => /^(web ?(site|seite)?|homepage|internet(seite)?|url|domain)$/i.test(key.trim()) && value.trim())?.[1];
  const value = (direct ?? fromFields ?? "").trim(); if (value && /[a-z0-9-]+\.[a-z]{2,}/i.test(value)) return value.replace(/\s+/g, "");
  const domain = email ? domainOf(email) : null; return domain && !isFreemailDomain(domain) ? domain : null;
}

const SYSTEM = `Du schreibst für Tanesco Digital (einer der größten Leadlieferanten Deutschlands für Photovoltaik und Wärmepumpen) Erst-E-Mails an Fachbetriebe und Energieversorger – jede einzeln, wie von Hand geschrieben. Du schreibst immer DREI Vorschläge mit verschiedenen Ansätzen, alle persönlich auf genau diesen Empfänger zugeschnitten.

Was Tanesco anbietet (nur diese Fakten verwenden): PV- und Wärmepumpen-Leads, eigene Generierung über Meta-Kampagnen (Facebook/Instagram), telefonisch vorqualifiziert, interne Qualitätskontrolle, exklusiv, Echtzeit per API/Schnittstelle, keine Vorkasse, keine lange Vertragsbindung, gut skalierbar, seit über vier Jahren im Leadmarkt. Die ersten qualifizierten Leads zum Testen kostenlos – nur im individuellen Ansatz anbieten, wenn es passt.

1) "individuell" – Individueller Ansatz. So soll er klingen (Beispiel, nicht kopieren):
"Hallo Herr Wiebe,
auf Ihrer Website steht „Keine Anzahlung, 0 % Risiko“. Genau so arbeiten wir auch, nur auf der anderen Seite des Tisches.
Mit 12 Standorten von Oldenburg bis Konstanz brauchen Sie vermutlich in jeder Region einen stetigen Strom an Anfragen. Die übliche Erfahrung mit Lead-Anbietern ist eine andere: Leads, die an fünf Betriebe gleichzeitig gehen, falsche Nummern, Interessenten, die sich an nichts erinnern, und Vorkasse für all das.
Wir von Tanesco Digital gehören zu den größten Lead-Lieferanten in Deutschland. Unsere PV- und Wärmepumpen-Leads sind telefonisch qualifiziert und gehen exklusiv per Schnittstelle direkt an Sie. Wir arbeiten grundsätzlich ohne Vorkasse.
Damit Sie das ohne Risiko prüfen können, bekommen Sie die ersten qualifizierten Leads für Ihre Standorte kostenlos."
→ Einstieg mit etwas Konkretem von der Webseite oder aus den Daten (ein Zitat, ein Versprechen, Standorte, Spezialisierung), daraus eine Brücke zu uns, dann der typische Schmerz mit Lead-Anbietern, dann unser Angebot. Keine Aufzählung, 90–150 Wörter.

2) "drittanbieter" – Drittanbieter-Ansatz: Leads, die wir erzeugen, kommen bereits über Drittpartner bei der Firma an; wir sind die direkte Quelle und bieten die direkte Zusammenarbeit an (kürzere Lieferkette, mehr Transparenz, schnellere Abstimmung, direkte Qualitätskontrolle). Seriös und förmlich, darf eine kurze Aufzählung der Vorteile haben, bittet um ein Telefonat mit dem Ansprechpartner aus dem Leadmanagement. Trotzdem individuell: Firma, Region, Geschäftsfeld oder etwas von der Webseite sinnvoll einbauen. 120–200 Wörter.

3) "frei" – Freier Vorschlag: dein eigener, anderer Einstieg (z. B. eine konkrete Frage, eine Beobachtung zur Region oder zum Geschäftsmodell), genauso persönlich, 80–140 Wörter.

Regeln für alle drei: Deutsch, Sie-Form. Anrede mit Namen, wenn bekannt („Hallo Herr …“ / „Sehr geehrte Frau …“), sonst „Sehr geehrte Damen und Herren“. Nichts erfinden: keine Zahlen, Standorte, Zitate, Namen oder Fakten, die nicht in den Angaben oder auf der Webseite stehen – Webseiten-Zitate nur wörtlich aus dem Auszug. Keine Floskeln, kein „ich habe Ihre Webseite besucht“, keine Links, keine Ausrufezeichen. Grußformel ohne Namen am Ende – die Signatur hängt das System an. Betreff je Vorschlag: konkret, persönlich, höchstens 70 Zeichen, kein Clickbait.
Die Vorlage der Kampagne zeigt den gewünschten Inhalt/Ton – nutze sie als Grundlage, besonders für den freien Vorschlag.`;

async function aiDrafts(base: { subject: string; text: string }, info: Record<string, string>, site: { url: string; text: string } | null = null): Promise<DraftOption[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const facts = Object.entries(info).filter(([, value]) => value && String(value).trim()).map(([key, value]) => `${key}: ${String(value).slice(0, 300)}`).join("\n");
    const option = { type: "object", additionalProperties: false, required: ["subject", "text"], properties: { subject: { type: "string" }, text: { type: "string" } } };
    const response = await invokeLLM({ maxTokens: 3000, temperature: 0.7, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `Empfänger:\n${facts}${site ? `\n\nWebseite (${site.url}), Auszug:\n${site.text.slice(0, 6000)}` : "\n\n(Keine Webseite verfügbar – nur die Angaben oben nutzen.)"}\n\nVorlage der Kampagne – Betreff: ${base.subject}\n\n${base.text}\n\nSchreibe die drei Vorschläge für diesen Empfänger.` }], outputSchema: { name: "drei_vorschlaege", schema: { type: "object", additionalProperties: false, required: ["individuell", "drittanbieter", "frei"], properties: { individuell: option, drittanbieter: option, frei: option } } } });
    const parsed = JSON.parse(response.choices[0]?.message.content ?? "{}") as Record<string, { subject?: unknown; text?: unknown } | undefined>;
    const options = DRAFT_APPROACHES.map((approach) => { const raw = parsed[approach.key]; const subject = String(raw?.subject ?? "").trim().slice(0, 300); const text = String(raw?.text ?? "").trim(); return subject && text.length > 40 ? { key: approach.key, label: approach.label, subject, text } : null; }).filter((item): item is DraftOption => Boolean(item));
    return options.length ? options : null;
  } catch { return null; }
}

/** Entwurf für einen Empfänger schreiben (KI, sonst Vorlage) und speichern – Zustand „entwurf“. */
export async function draftForRecipient(db: Db, tenantId: number, recipientId: number) {
  const recipient = (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.id, recipientId), eq(emailCampaignRecipients.tenantId, tenantId))).limit(1))[0];
  if (!recipient) throw new Error("Empfänger nicht gefunden.");
  if (recipient.sentCount > 0) throw new Error("Die erste E-Mail an diesen Kontakt ist schon raus.");
  const { lead, node, values } = await loadContext(db, tenantId, recipient);
  const base = templateDraft(node, values);
  const meta = (lead?.metadata ?? {}) as Record<string, unknown>;
  const website = websiteOf(lead?.metadata, recipient.email);
  const info: Record<string, string> = { Firma: values.firma, Ansprechpartner: [values.anrede, values.vorname, values.nachname].filter(Boolean).join(" "), Ort: values.stadt, "PLZ": String(lead?.postcode ?? ""), Webseite: website ?? String(meta.website ?? meta.webseite ?? ""), Liste: String(lead?.listName ?? ""), ...Object.fromEntries(Object.entries(extraFieldsOf(lead?.metadata)).map(([key, value]) => [key, String(value)])) };
  // Webseite lesen (Startseite + Leistungen/Über uns) – die KI greift daraus konkrete Punkte auf
  const site = process.env.ANTHROPIC_API_KEY && website ? await readWebsiteText(website).catch(() => null) : null;
  const ai = await aiDrafts(base, info, site);
  // Ohne KI: Individuell = Vorlage mit den Daten, Drittanbieter = feste Vorlage, Frei = Vorlage
  const third = thirdPartyTemplate(values);
  const options: DraftOption[] = ai ?? [{ key: "individuell", label: approachLabel("individuell"), ...base }, { key: "drittanbieter", label: approachLabel("drittanbieter"), ...third }];
  const first = options[0]; const source = ai ? (site ? "kiweb" : "ki") : "vorlage";
  await db.update(emailCampaignRecipients).set({ draftSubject: first.subject, draftText: first.text, draftOptions: options, draftApproach: first.key, draftState: "entwurf", draftSource: source, draftAt: new Date() }).where(eq(emailCampaignRecipients.id, recipient.id));
  return { id: recipient.id, subject: first.subject, text: first.text, options, approach: first.key, source, website: site?.url ?? website };
}

/** Die nächsten Entwürfe schreiben (für Empfänger ohne Entwurf, ältester zuerst) – oder für bestimmte Empfänger neu. */
export async function generateDrafts(db: Db, tenantId: number, input: { campaignId: number; recipientIds?: number[] | null; limit?: number | null }) {
  const limit = Math.max(1, Math.min(10, input.limit ?? 5));
  const ids = input.recipientIds?.length ? input.recipientIds.slice(0, 10) : (await db.select({ id: emailCampaignRecipients.id }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, input.campaignId), eq(emailCampaignRecipients.sentCount, 0), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]), or(isNull(emailCampaignRecipients.draftState), eq(emailCampaignRecipients.draftState, "")))).orderBy(asc(emailCampaignRecipients.id)).limit(limit)).map((row) => row.id);
  const drafts = []; let failed = 0;
  for (const id of ids) { try { drafts.push(await draftForRecipient(db, tenantId, id)); } catch { failed += 1; } }
  return { drafts, failed, ai: drafts.some((draft) => draft.source === "ki") };
}

/** Freigabe-Liste einer Kampagne: alle offenen Empfänger, deren erste E-Mail noch nicht raus ist. */
export async function reviewQueue(db: Db, tenantId: number, campaignId: number) {
  const rows = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaignId), eq(emailCampaignRecipients.sentCount, 0), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]))).orderBy(asc(emailCampaignRecipients.id));
  const leadIds = Array.from(new Set(rows.map((row) => row.leadId).filter((id): id is number => typeof id === "number")));
  const leadRows = leadIds.length ? await db.select({ id: leads.id, publicId: leads.publicId, city: leads.city, listName: leads.listName, company: leads.company, firstName: leads.firstName, lastName: leads.lastName, metadata: leads.metadata }).from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, leadIds))) : [];
  const items = rows.map((row) => { const lead = leadRows.find((item) => item.id === row.leadId) ?? null; return { id: row.id, email: row.email, name: row.name, company: row.company ?? lead?.company ?? null, city: lead?.city ?? null, listName: lead?.listName ?? null, publicId: lead?.publicId ?? null, website: websiteOf(lead?.metadata, row.email), draftSubject: row.draftSubject, draftText: row.draftText, draftOptions: (Array.isArray(row.draftOptions) ? row.draftOptions : []) as DraftOption[], draftApproach: (row.draftApproach || null) as DraftApproach | null, draftState: (row.draftState || null) as "entwurf" | "freigegeben" | null, draftSource: row.draftSource, draftAt: row.draftAt }; });
  return { items, counts: { offen: items.filter((item) => !item.draftState).length, entwurf: items.filter((item) => item.draftState === "entwurf").length, freigegeben: items.filter((item) => item.draftState === "freigegeben").length } };
}

/** Entwurf speichern, freigeben oder Freigabe zurücknehmen. */
export async function saveDraft(db: Db, tenantId: number, input: { recipientId: number; subject: string; text: string; approve: boolean; approach?: DraftApproach | null }) {
  const recipient = (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.id, input.recipientId), eq(emailCampaignRecipients.tenantId, tenantId))).limit(1))[0];
  if (!recipient) throw new Error("Empfänger nicht gefunden.");
  if (recipient.sentCount > 0) throw new Error("Die erste E-Mail an diesen Kontakt ist schon raus.");
  const subject = input.subject.trim().slice(0, 300); const text = input.text.trim();
  if (input.approve && (!subject || text.length < 10)) throw new Error("Bitte Betreff und Text ausfüllen.");
  await db.update(emailCampaignRecipients).set({ draftSubject: subject || null, draftText: text || null, draftState: input.approve ? "freigegeben" : "entwurf", draftSource: recipient.draftSource ?? "hand", ...(input.approach ? { draftApproach: input.approach } : {}), draftAt: new Date() }).where(eq(emailCampaignRecipients.id, recipient.id));
  return { id: recipient.id, draftState: input.approve ? "freigegeben" as const : "entwurf" as const };
}
