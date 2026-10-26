/**
 * KI-Versand: Die KI schreibt JEDE E-Mail einer Kampagne einzeln – für jeden Kontakt und jeden Schritt des Ablaufs
 * (Erst-E-Mail und Nachfass-Mails), im gewählten Ansatz (individuell oder Drittanbieter). Zwei Betriebsarten:
 * „freigabe“ = du liest jeden Entwurf unter „Freigeben“ und schickst ihn los; „auto“ = die KI schreibt im Hintergrund
 * und der Versand läuft sofort weiter (Rückfall: Vorlage, wenn die KI nicht erreichbar ist). „aus“ = Vorlagen wie früher.
 * Dazu das Tageslimit für alle Kampagnen zusammen (Standard 80 E-Mails am Tag).
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { emailCampaignEvents, emailCampaignRecipients, emailCampaigns, leads, mailSettings } from "../drizzle/schema";
import { smoothQualifyPhrase, approachLabel, DRAFT_APPROACHES, thirdPartyTemplate, contactWay, type DraftApproach, type DraftOption, type EmailNode, blocksToPlainText, dayStartIn, DEFAULT_CAMPAIGN_DAILY_LIMIT, fillPlaceholdersSafe, firstSendNode, kiAnsatzOf, recipientValues, type EmailTree } from "../shared/email-campaigns";
import { extraFieldsOf } from "../shared/cold-list";
import { invokeLLM } from "./_core/llm";
import { readWebsiteText } from "./lead-finder";
import { domainOf, isFreemailDomain } from "./inbox";
import { signatureFor } from "./mail-settings";
import type { Db } from "./lead-pipeline";

type Recipient = typeof emailCampaignRecipients.$inferSelect;

export async function campaignDailyLimit(db: Db, tenantId: number): Promise<number> {
  const row = (await db.select({ limit: mailSettings.campaignDailyLimit, warmupEnabled: mailSettings.warmupEnabled, warmupStartedAt: mailSettings.warmupStartedAt }).from(mailSettings).where(eq(mailSettings.tenantId, tenantId)).limit(1))[0];
  const configured = row?.limit && row.limit > 0 ? row.limit : DEFAULT_CAMPAIGN_DAILY_LIMIT;
  if (row?.warmupEnabled) { const { warmupLimit } = await import("./mail-health"); return warmupLimit(row.warmupStartedAt, configured).limit; } // Warmlaufen: Limit steigt Woche für Woche
  return configured;
}
export async function sentToday(db: Db, tenantId: number, now = new Date()): Promise<number> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.kind, "gesendet"), gte(emailCampaignEvents.createdAt, dayStartIn(now))));
  return Number(count) || 0;
}
export async function campaignDailyStatus(db: Db, tenantId: number) {
  const row = (await db.select({ limit: mailSettings.campaignDailyLimit, warmupEnabled: mailSettings.warmupEnabled, warmupStartedAt: mailSettings.warmupStartedAt }).from(mailSettings).where(eq(mailSettings.tenantId, tenantId)).limit(1))[0];
  const configured = row?.limit && row.limit > 0 ? row.limit : DEFAULT_CAMPAIGN_DAILY_LIMIT;
  const { warmupLimit } = await import("./mail-health");
  const warmup = row?.warmupEnabled ? warmupLimit(row.warmupStartedAt, configured) : null;
  const limit = warmup ? warmup.limit : configured; const sent = await sentToday(db, tenantId);
  return { limit, sent, left: Math.max(0, limit - sent), configured, warmup: warmup ? { week: warmup.week, done: warmup.done } : null };
}
export async function setCampaignDailyLimit(db: Db, tenantId: number, limit: number) {
  const value = Math.max(1, Math.min(2000, Math.round(limit)));
  const existing = (await db.select({ id: mailSettings.id }).from(mailSettings).where(eq(mailSettings.tenantId, tenantId)).limit(1))[0];
  if (existing) await db.update(mailSettings).set({ campaignDailyLimit: value }).where(eq(mailSettings.id, existing.id));
  else await db.insert(mailSettings).values({ tenantId, campaignDailyLimit: value });
  return { limit: value };
}

/** Der Schritt, für den gerade ein Entwurf fällig ist: der aktuelle Schritt des Empfängers (wenn es eine E-Mail ist), sonst die erste E-Mail des Ablaufs. */
export function dueSendNode(tree: EmailTree, recipient: Pick<Recipient, "nodeId">): Extract<EmailNode, { type: "send" }> | null {
  const current = recipient.nodeId ? tree.nodes.find((node) => node.id === recipient.nodeId) : null;
  if (current && current.type === "send") return current;
  return firstSendNode(tree);
}
async function loadContext(db: Db, tenantId: number, recipient: Recipient, nodeId?: string | null) {
  const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, recipient.campaignId), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0];
  if (!campaign) throw new Error("Kampagne nicht gefunden.");
  const lead = recipient.leadId ? (await db.select().from(leads).where(and(eq(leads.id, recipient.leadId), eq(leads.tenantId, tenantId))).limit(1))[0] ?? null : null;
  const tree = (campaign.tree ?? { start: null, nodes: [] }) as EmailTree;
  const node = (nodeId ? tree.nodes.find((item): item is Extract<EmailNode, { type: "send" }> => item.id === nodeId && item.type === "send") : null) ?? dueSendNode(tree, recipient);
  if (!node) throw new Error("Die Kampagne hat keine E-Mail im Ablauf.");
  const phone = await senderPhone(db, tenantId);
  const values = recipientValues({ firstName: lead?.firstName ?? recipient.name?.split(" ")[0], lastName: lead?.lastName ?? recipient.name?.split(" ").slice(1).join(" "), company: lead?.company ?? recipient.company, city: lead?.city, salutation: (lead?.metadata as { salutation?: string } | null)?.salutation ?? null, email: recipient.email, fields: extraFieldsOf(lead?.metadata), phone });
  return { campaign, lead, node, values, phone };
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

const SYSTEM = `Du schreibst für Tanesco Digital (einer der größten Leadlieferanten Deutschlands für Photovoltaik und Wärmepumpen) Akquise-E-Mails an Fachbetriebe und Energieversorger – jede einzeln, wie von Hand geschrieben, nie wie ein Serienbrief. Je nach Auftrag schreibst du die Erst-E-Mail oder eine Nachfass-Mail, als die verlangten Vorschläge (Ansätze), alle persönlich auf genau diesen Empfänger zugeschnitten.

Was Tanesco anbietet (nur diese Fakten verwenden): PV- und Wärmepumpen-Leads, eigene Generierung über Meta-Kampagnen (Facebook/Instagram), in der Regel anhand von zehn Fragen telefonisch vorqualifiziert; der Interessent weiß danach, dass sich ein Fachbetrieb bei ihm meldet. Interne Qualitätskontrolle, exklusiv, Echtzeit per API/Schnittstelle, keine Vorkasse, keine lange Vertragsbindung, gut skalierbar, seit über vier Jahren im Leadmarkt. Test-Angebot: 20 Test-Leads kostenlos, individuell für den Betrieb und telefonisch qualifiziert – baue dieses Angebot in den individuellen UND in den Drittanbieter-Ansatz ein (in Erst-E-Mails immer, in Nachfass-Mails, wenn es passt).

1) "individuell" – Individueller Ansatz. So soll er klingen (Beispiel, nicht kopieren):
"Sehr geehrter Herr Wiebe,
auf Ihrer Website steht „Keine Anzahlung, 0 % Risiko“. Genau so arbeiten wir auch, nur auf der anderen Seite des Tisches.
Mit 12 Standorten von Oldenburg bis Konstanz brauchen Sie vermutlich in jeder Region einen stetigen Strom an Anfragen. Die übliche Erfahrung mit Lead-Anbietern ist eine andere: Leads, die an fünf Betriebe gleichzeitig gehen, falsche Nummern, Interessenten, die sich an nichts erinnern, und Vorkasse für all das.
Wir von Tanesco Digital gehören zu den größten Lead-Lieferanten in Deutschland. Unsere PV- und Wärmepumpen-Leads sind telefonisch qualifiziert und gehen exklusiv per Schnittstelle direkt an Sie. Wir arbeiten grundsätzlich ohne Vorkasse.
Damit Sie das ohne Risiko prüfen können, bekommen Sie 20 Test-Leads kostenlos – individuell für Ihre Standorte und in der Regel anhand von zehn Fragen telefonisch vorqualifiziert; der Interessent weiß danach, dass sich ein Fachbetrieb bei ihm meldet.
Wenn das für Sie interessant ist, antworten Sie einfach auf diese E-Mail oder rufen Sie mich gerne an unter 0611 000000.
Vielen Dank"
→ Einstieg mit etwas Konkretem von der Webseite oder aus den Daten (ein Zitat, ein Versprechen, Standorte, Spezialisierung), daraus eine Brücke zu uns, dann der typische Schmerz mit Lead-Anbietern, dann unser Angebot. Keine Aufzählung, 90–150 Wörter.

2) "drittanbieter" – Drittanbieter-Ansatz. Kernbotschaft, die IMMER enthalten sein muss: Wir sind einer der größten Lead-Lieferanten Deutschlands, und über unsere Quellen haben wir mitbekommen, dass bei der Firma sehr wahrscheinlich Leads ankommen, die ohnehin von uns stammen – nur weitergereicht über Zwischenhändler. Dieser Umweg macht Qualität und Preis kaputt: Die Leads werden mehrfach weiterverkauft, jeder Zwischenschritt schlägt auf den Preis auf, und beim Betrieb kommen genervte Interessenten und falsche Kontaktdaten an. Genau deshalb streben wir die direkte Zusammenarbeit mit dieser Firma an (kürzere Lieferkette, besserer Preis ohne Zwischenstufen, mehr Transparenz, direkte Qualitätskontrolle). Formuliere es als begründete Vermutung („sehr wahrscheinlich“, „gehen wir davon aus“), nie als bewiesene Tatsache, und erfinde keinen konkreten Zwischenhändler-Namen. Seriös und förmlich, darf eine kurze Aufzählung der Vorteile haben, bittet um ein Telefonat mit dem Ansprechpartner aus dem Leadmanagement. Trotzdem IMMER persönlich und individuell, nie Serienbrief: mindestens zwei konkrete Bezüge auf genau diese Firma (etwas Wörtliches oder Konkretes von der Webseite, die Leistung/Spezialisierung, Region/Einzugsgebiet, Größe oder Geschäftsfeld) – einer davon im ersten Absatz, bevor die Kernbotschaft kommt, und die Vorteile auf die Situation der Firma bezogen. 120–200 Wörter.

3) "frei" – Freier Vorschlag: dein eigener, anderer Einstieg (z. B. eine konkrete Frage, eine Beobachtung zur Region oder zum Geschäftsmodell), genauso persönlich, 80–140 Wörter.

Formulierung zur Qualifizierung immer so: „in der Regel anhand von zehn Fragen telefonisch vorqualifiziert“ – nie „qualifiziert über … Fragen“.
Pflichtinhalte in JEDER E-Mail, egal welcher Ansatz (in Erst-E-Mails ausführlich, in Nachfass-Mails in ein bis zwei Sätzen): das Test-Angebot (20 Test-Leads kostenlos, individuell für den Betrieb und telefonisch qualifiziert) und wie wir qualifizieren (in der Regel anhand von zehn Fragen telefonisch vorqualifiziert; der Interessent weiß danach, dass sich ein Fachbetrieb bei ihm meldet). Den Firmennamen des Betriebs nennen wir dabei NICHT – das darf nirgends stehen. Fehlt von den Pflichtinhalten etwas, ist die E-Mail falsch.

Regeln für alle drei: Deutsch, Sie-Form. Für die Anrede gibt es genau zwei Formen: „Sehr geehrter Herr Nachname,“ / „Sehr geehrte Frau Nachname,“ – oder „Sehr geehrte Damen und Herren,“. Nie „Hallo“, „Hi“, „Moin“, nie „Guten Tag Vorname Nachname“, nie nur der Vorname. Herr oder Frau darfst du aus einem eindeutigen Vornamen ableiten (Stefan → Herr, Katrin → Frau); ist der Vorname nicht eindeutig oder fehlt der Nachname, schreibst du „Sehr geehrte Damen und Herren“. Steht in den Angaben kein Ansprechpartner, suche im Webseiten-Auszug (besonders im Impressum) nach dem Geschäftsführer oder Inhaber und sprich diese Person in ALLEN drei Vorschlägen direkt mit Herr/Frau und Nachnamen an (ohne Vornamen und Titel) – aber nur, wenn der Name wörtlich im Auszug steht, nie geraten. Erst wenn es gar keinen Namen gibt: „Sehr geehrte Damen und Herren“ – nie „Hallo“ ohne Namen. Nichts erfinden: keine Zahlen, Standorte, Zitate, Namen oder Fakten, die nicht in den Angaben oder auf der Webseite stehen – Webseiten-Zitate nur wörtlich aus dem Auszug. Keine Floskeln, kein „ich habe Ihre Webseite besucht“, keine Links, kein Knopf, keine Terminbuchung, keine Ausrufezeichen. Der Schluss ist immer gleich aufgebaut: vorletzter Absatz = ein klarer Satz, was zu tun ist – „Wenn das für Sie interessant ist, antworten Sie einfach auf diese E-Mail oder rufen Sie mich gerne an unter <Telefon des Absenders>.“ (Telefon steht in den Angaben; fehlt es: nur „antworten Sie einfach auf diese E-Mail“; eine Variante wie „Lassen Sie uns gerne sprechen: …“ ist erlaubt, die Nummer muss dann trotzdem drinstehen) – und die letzte Zeile lautet genau „Vielen Dank“. KEINE Grußformel danach – kein „Mit freundlichen Grüßen“, kein „Viele Grüße“, kein Name: Die Signatur, die das System automatisch anhängt, enthält Gruß und Namen schon. Betreff je Vorschlag: konkret, persönlich, höchstens 70 Zeichen, kein Clickbait.
Die Vorlage der Kampagne zeigt den gewünschten Inhalt/Ton – nutze sie als Grundlage, besonders für den freien Vorschlag.
Nachfass-Mails (wenn der Auftrag sagt, dass schon E-Mails raus sind): kurz (50–110 Wörter), knüpfen in einem Halbsatz an die vorige E-Mail an, ohne sie zu wiederholen – danach ein NEUER Aufhänger oder konkreter Mehrwert (eine Frage zum Bedarf, ein passender Punkt von der Webseite, ein Angebot wie kostenlose Test-Leads, ein konkreter Terminvorschlag). Keine erneute lange Vorstellung von Tanesco, derselbe Ansatz wie verlangt, genauso individuell.`;

/** Grußformel am Textende entfernen – die Signatur aus den E-Mail-Einstellungen bringt „Mit freundlichen Grüßen“ und den Namen schon mit (sonst stünde es doppelt). */
export function stripClosing(text: string): string {
  const lines = text.replace(/\s+$/, "").split("\n");
  const closing = /^(mit\s+(besten|freundlichen|sonnigen|herzlichen)\s+grüßen|freundliche\s+grüße|viele\s+grüße|beste\s+grüße|herzliche\s+grüße|liebe\s+grüße|mfg|vg|sonnige\s+grüße|schöne\s+grüße|grüße)[,!.]?$/i;
  const short = (line: string) => line.split(/\s+/).length <= 5 && !/[.!?:]$/.test(line); // Name, Firma oder Rolle unter der Grußformel
  for (let round = 0; round < 4; round += 1) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) break;
    const last = lines[lines.length - 1].trim();
    if (closing.test(last)) { lines.pop(); continue; }
    // Grußformel mit bis zu drei kurzen Zeilen darunter (Name, Rolle, Firma): ab der Grußformel weg
    const filled = lines.map((line, index) => ({ line: line.trim(), index })).filter((item) => item.line);
    const tail = filled.slice(-4); const at = tail.findIndex((item) => closing.test(item.line));
    if (at >= 0 && tail.slice(at + 1).every((item) => short(item.line))) { lines.length = tail[at].index; continue; }
    break;
  }
  return lines.join("\n").replace(/\s+$/, "");
}
/** Telefonnummer aus der Signatur (Einstellungen → E-Mail-Versand) – steht im Schluss jeder Akquise-Mail. */
async function senderPhone(db: Db, tenantId: number): Promise<string> { try { const { signature } = await signatureFor(db, tenantId); return (signature.phone ?? "").trim(); } catch { return ""; } }
const digitsOf = (value: string) => value.replace(/\D+/g, "");
const CTA_RE = /antworten sie|rufen sie|melden sie sich|rückmeldung|lassen sie uns\b|hätten sie\b.*\b(minuten|zeit)\b|zeit für ein|für ein (kurzes )?(telefonat|gespräch)|kurzes telefonat|terminvorschlag|wann passt/i; // Handlungsaufforderung am Schluss (nicht jedes „telefonisch“ im Text)
/**
 * Anrede: nur zwei Formen – „Sehr geehrte/r Frau/Herr Nachname“ oder „Sehr geehrte Damen und Herren“. „Hallo Herr Wiebe,“ → „Sehr geehrter Herr Wiebe,“;
 * „Hallo Max Muster,“ / „Guten Tag Max Muster,“ / „Hallo,“ / keine Anrede → die Begrüßung aus den Daten (ohne bekannte Anrede: „Sehr geehrte Damen
 * und Herren“). Eine förmliche Anrede der KI mit Herr/Frau (z. B. der Geschäftsführer aus dem Impressum) bleibt unverändert.
 */
export function fixGreeting(text: string, greeting: string): string {
  const lines = text.replace(/^\s+/, "").split("\n"); const first = (lines[0] ?? "").trim();
  const formal = (rest: string) => /^frau\b/i.test(rest) ? `Sehr geehrte ${rest.replace(/^frau\s+/i, "Frau ")},` : `Sehr geehrter ${rest.replace(/^herr(n)?\s+/i, "Herr ")},`;
  const informal = first.match(/^(hallo|hi|hey|moin|servus|liebe[rs]?)\b[\s,]*(.*?)[,!.]?\s*$/i);
  const guten = first.match(/^guten\s+(?:tag|morgen|abend)\b[\s,]*(.*?)[,!.]?\s*$/i);
  const geehrte = /^sehr\s+geehrte/i.test(first);
  let head: string | null = null;
  if (informal) { const rest = informal[2].trim(); head = /^(herr|frau)\s+\S/i.test(rest) ? formal(rest) : `${greeting},`; }
  else if (guten) { const rest = guten[1].trim(); head = /^(herr|frau)\s+\S/i.test(rest) ? formal(rest) : `${greeting},`; }
  else if (geehrte) head = /^sehr\s+geehrte(r)?\s+(herr|frau|damen)\b/i.test(first) ? first.replace(/[,!.]?\s*$/, ",") : `${greeting},`; // „Sehr geehrter Max Muster“ gibt es nicht
  if (head === null) return `${greeting},\n\n${lines.join("\n").trim()}`;
  return [head, ...lines.slice(1)].join("\n").replace(/^([^\n]+,)\n(?!\n)/, "$1\n\n");
}
/** Fehlen Test-Angebot oder Qualifizierung, kommen sie als eigener Absatz vor den Schluss – damit kein Entwurf ohne die Kerninhalte rausgeht. */
export function ensureFacts(text: string, followUp: boolean): string {
  const hasOffer = /test-?leads?/i.test(text) && /\b20\b/.test(text); const hasQualify = /\b10\s+(qualifizierungs)?fragen/i.test(text) || /zehn\s+fragen/i.test(text);
  if (hasOffer && (hasQualify || followUp)) return text;
  const add = !hasOffer && !hasQualify && !followUp ? "Damit Sie das ohne Risiko prüfen können: 20 Test-Leads kostenlos, individuell für Ihren Betrieb und in der Regel anhand von zehn Fragen telefonisch vorqualifiziert, sodass der Interessent weiß, dass sich ein Fachbetrieb bei ihm meldet."
    : !hasOffer ? "Zum Kennenlernen: 20 Test-Leads kostenlos, individuell für Ihren Betrieb und telefonisch qualifiziert."
    : "Jeder Interessent wird in der Regel anhand von zehn Fragen telefonisch vorqualifiziert, sodass er weiß, dass sich ein Fachbetrieb bei ihm meldet.";
  const parts = text.split(/\n{2,}/); const last = parts.length - 1;
  const ctaAt = parts.length > 1 && CTA_RE.test(parts[last]) ? last : -1;
  if (ctaAt > 0) parts.splice(ctaAt, 0, add); else parts.push(add);
  return parts.join("\n\n");
}
/** Schluss immer gleich: klarer Hinweis (antworten oder anrufen – mit der Nummer aus der Signatur) und als letzte Zeile „Vielen Dank“. */
export function ensureClosing(text: string, phone: string): string {
  let body = stripClosing(text).replace(/\s+$/, "");
  body = body.replace(/(\n\s*)*(vielen\s+dank( im voraus)?|danke( schön| sehr)?|herzlichen\s+dank)[.!]?\s*$/i, "").replace(/\s+$/, ""); // „Vielen Dank“ kommt gleich sauber ans Ende
  const digits = digitsOf(phone); const hasPhone = digits.length >= 6 && digitsOf(body).includes(digits.slice(-6));
  const lastParagraph = body.split(/\n{2,}/).pop() ?? "";
  if (phone && !hasPhone) body += CTA_RE.test(lastParagraph) ? ` Telefonisch erreichen Sie mich unter ${phone}.` : `\n\nWenn das für Sie interessant ist, ${contactWay(phone)}.`;
  else if (!phone && !CTA_RE.test(lastParagraph)) body += `\n\nWenn das für Sie interessant ist, ${contactWay(null)}.`;
  return `${body}\n\nVielen Dank`;
}
/** Der Firmenname des Betriebs wird bei der Qualifizierung NICHT genannt – Sätze dazu fliegen raus (auch wenn die KI sie noch schreibt). */
export function dropCompanyNameClaim(text: string): string {
  if (!/firmenname/i.test(text)) return text;
  const trailing = /^(sodass|so dass|damit|dass|wodurch|womit|der|die|das|was)\b/i; // Nebensätze, die am Firmennamen-Satzteil hängen
  return text.split(/(\n+)/).map((part) => {
    if (!/firmenname/i.test(part)) return part;
    return part.split(/(?<=[.!?])\s+/).map((sentence) => {
      if (!/firmenname/i.test(sentence)) return sentence;
      const clauses = sentence.split(/\s*(?:,|;|–|—|\s+und\s+|\s+sowie\s+)\s*/).filter(Boolean);
      const hit = clauses.findIndex((clause) => /firmenname/i.test(clause));
      const before = clauses.slice(0, hit); let after = clauses.slice(hit + 1);
      while (after.length && trailing.test(after[0])) after = after.slice(1);
      const kept = [...before, ...after].map((clause) => clause.replace(/[.!?]\s*$/, "")).filter(Boolean);
      if (!kept.length) return "";
      return `${kept.join(", ").replace(/\s+/g, " ").trim()}.`;
    }).filter(Boolean).join(" ");
  }).join("").replace(/[ \t]{2,}/g, " ");
}
/** Alle Regeln auf einen Entwurf anwenden – gilt für KI-Texte wie für Vorlagen-Rückfälle. */
export function finishDraft(text: string, options: { greeting: string; phone: string; followUp: boolean }): string {
  return smoothQualifyPhrase(ensureClosing(ensureFacts(fixGreeting(dropCompanyNameClaim(text.trim()), options.greeting), options.followUp), options.phone));
}
type FollowUpInfo = { index: number; sentSubjects: string[] } | null; // Nr. der E-Mail im Ablauf (0 = Erst-E-Mail) und was schon raus ist
async function aiDrafts(base: { subject: string; text: string }, info: Record<string, string>, site: { url: string; text: string } | null = null, options: { approaches?: DraftApproach[]; followUp?: FollowUpInfo; stepLabel?: string | null; phone?: string | null } = {}): Promise<DraftOption[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const wanted = options.approaches?.length ? DRAFT_APPROACHES.filter((approach) => options.approaches!.includes(approach.key)) : DRAFT_APPROACHES;
    const facts = Object.entries(info).filter(([, value]) => value && String(value).trim()).map(([key, value]) => `${key}: ${String(value).slice(0, 300)}`).join("\n") + `\nTelefon des Absenders (für den Schluss): ${options.phone?.trim() || "nicht hinterlegt – dann nur „antworten Sie einfach auf diese E-Mail“"}`;
    const option = { type: "object", additionalProperties: false, required: ["subject", "text"], properties: { subject: { type: "string" }, text: { type: "string" } } };
    const followUp = options.followUp && options.followUp.index > 0 ? `\n\nDies ist eine NACHFASS-MAIL (E-Mail Nr. ${options.followUp.index + 1} der Serie${options.stepLabel ? `, Schritt „${options.stepLabel}“` : ""}). Schon gesendet: ${options.followUp.sentSubjects.length ? options.followUp.sentSubjects.map((subject) => `„${subject}“`).join(", ") : "die Erst-E-Mail"}. Halte dich an die Nachfass-Regeln.` : "";
    const task = wanted.length === DRAFT_APPROACHES.length ? "Schreibe die drei Vorschläge für diesen Empfänger." : `Schreibe NUR diese${wanted.length === 1 ? "n" : ""} Vorschl${wanted.length === 1 ? "ag" : "äge"} für diesen Empfänger: ${wanted.map((approach) => `"${approach.key}"`).join(", ")}.`;
    const response = await invokeLLM({ maxTokens: wanted.length === 1 ? 1200 : 3000, temperature: 0.7, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `Empfänger:\n${facts}${site ? `\n\nWebseite (${site.url}), Auszug:\n${site.text.slice(0, 9000)}` : "\n\n(Keine Webseite verfügbar – nur die Angaben oben nutzen.)"}\n\nVorlage dieses Schritts – Betreff: ${base.subject}\n\n${base.text}${followUp}\n\n${task}` }], outputSchema: { name: "vorschlaege", schema: { type: "object", additionalProperties: false, required: wanted.map((approach) => approach.key), properties: Object.fromEntries(wanted.map((approach) => [approach.key, option])) } } });
    const parsed = JSON.parse(response.choices[0]?.message.content ?? "{}") as Record<string, { subject?: unknown; text?: unknown } | undefined>;
    const list = wanted.map((approach) => { const raw = parsed[approach.key]; const subject = String(raw?.subject ?? "").trim().slice(0, 300); const text = stripClosing(String(raw?.text ?? "").trim()); return subject && text.length > 40 ? { key: approach.key, label: approach.label, subject, text } : null; }).filter((item): item is DraftOption => Boolean(item));
    return list.length ? list : null;
  } catch { return null; }
}

/** Gilt der gespeicherte Entwurf für diesen Schritt? (Alte Entwürfe ohne Schritt-Angabe zählen für die Erst-E-Mail.) */
export function draftFitsNode(recipient: Pick<Recipient, "draftNodeId" | "sentCount">, nodeId: string): boolean {
  return recipient.draftNodeId ? recipient.draftNodeId === nodeId : recipient.sentCount === 0;
}
/**
 * Entwurf für einen Empfänger schreiben (KI, sonst Vorlage) und speichern – Zustand „entwurf“.
 * `nodeId` = der Schritt (die E-Mail im Ablauf), für den geschrieben wird; ohne Angabe der aktuelle bzw. erste Schritt.
 * Nachfass-Mails bekommen den Kontext, was schon gesendet wurde. `onlyApproach` (Auto-Modus): nur der Ansatz der Kampagne.
 */
export async function draftForRecipient(db: Db, tenantId: number, recipientId: number, options: { nodeId?: string | null; onlyApproach?: DraftApproach | null } = {}) {
  const recipient = (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.id, recipientId), eq(emailCampaignRecipients.tenantId, tenantId))).limit(1))[0];
  if (!recipient) throw new Error("Empfänger nicht gefunden.");
  const { campaign, lead, node, values, phone } = await loadContext(db, tenantId, recipient, options.nodeId);
  const sentEvents = await db.select({ nodeId: emailCampaignEvents.nodeId, subject: emailCampaignEvents.subject }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.recipientId, recipient.id), eq(emailCampaignEvents.kind, "gesendet"))).orderBy(asc(emailCampaignEvents.id));
  if (sentEvents.some((event) => event.nodeId === node.id)) throw new Error(`Die E-Mail „${node.label?.trim() || node.subject}“ ist an diesen Kontakt schon raus.`);
  const base = templateDraft(node, values);
  const meta = (lead?.metadata ?? {}) as Record<string, unknown>;
  const website = websiteOf(lead?.metadata, recipient.email);
  const info: Record<string, string> = { Firma: values.firma, Ansprechpartner: [values.anrede, values.vorname, values.nachname].filter(Boolean).join(" "), Ort: values.stadt, "PLZ": String(lead?.postcode ?? ""), Webseite: website ?? String(meta.website ?? meta.webseite ?? ""), Liste: String(lead?.listName ?? ""), ...Object.fromEntries(Object.entries(extraFieldsOf(lead?.metadata)).map(([key, value]) => [key, String(value)])) };
  // Webseite lesen (Startseite + Impressum + Leistungen/Über uns) – die KI greift daraus konkrete Punkte auf
  const site = process.env.ANTHROPIC_API_KEY && website ? await readWebsiteText(website).catch(() => null) : null;
  const ansatz = kiAnsatzOf(campaign);
  const followUp: FollowUpInfo = { index: sentEvents.length, sentSubjects: sentEvents.map((event) => event.subject ?? "").filter(Boolean).slice(-4) };
  const finish = (text: string) => finishDraft(text, { greeting: values.begruessung, phone, followUp: sentEvents.length > 0 });
  const ai = (await aiDrafts(base, info, site, { approaches: options.onlyApproach ? [options.onlyApproach] : undefined, followUp, stepLabel: node.label ?? node.subject, phone }))?.map((item) => ({ ...item, text: finish(item.text) })) ?? null;
  // Ohne KI: Individuell = Vorlage mit den Daten, Drittanbieter = feste Vorlage (nur sinnvoll für die Erst-E-Mail)
  const third = thirdPartyTemplate(values);
  const fallback: DraftOption[] = [{ key: "individuell", label: approachLabel("individuell"), subject: base.subject, text: finish(base.text) }, ...(sentEvents.length === 0 ? [{ key: "drittanbieter" as const, label: approachLabel("drittanbieter"), subject: third.subject, text: finish(third.text) }] : [])];
  const list: DraftOption[] = ai ?? fallback;
  // Der Ansatz der Kampagne ist der Haupt-Vorschlag – die anderen bleiben als Alternativen wählbar
  const first = list.find((item) => item.key === (options.onlyApproach ?? ansatz)) ?? list[0]; const source = ai ? (site ? "kiweb" : "ki") : "vorlage";
  await db.update(emailCampaignRecipients).set({ draftSubject: first.subject, draftText: first.text, draftOptions: list, draftApproach: first.key, draftNodeId: node.id, draftState: "entwurf", draftSource: source, draftAt: new Date() }).where(eq(emailCampaignRecipients.id, recipient.id));
  return { id: recipient.id, subject: first.subject, text: first.text, options: list, approach: first.key, source, website: site?.url ?? website, nodeId: node.id, nodeLabel: node.label?.trim() || node.subject };
}

/**
 * Alle Entwürfe einer Kampagne auf einmal freigeben (approve = true) oder alle Freigaben zurücknehmen (approve = false),
 * damit man sie wieder einzeln durchliest. Nur Entwürfe, die zum aktuellen Schritt passen und deren E-Mail noch nicht raus ist.
 */
export async function approveAllDrafts(db: Db, tenantId: number, campaignId: number, approve: boolean) {
  const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!campaign) throw new Error("Kampagne nicht gefunden.");
  const tree = (campaign.tree ?? { start: null, nodes: [] }) as EmailTree;
  const rows = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaignId), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"])));
  let changed = 0; let withoutDraft = 0;
  for (const row of rows) {
    const node = dueSendNode(tree, row); if (!node) continue;
    const fits = Boolean(row.draftState) && draftFitsNode(row, node.id) && Boolean(row.draftSubject?.trim()) && (row.draftText ?? "").trim().length >= 10;
    if (approve) {
      if (!fits) { withoutDraft += 1; continue; }
      if (row.draftState === "freigegeben") continue;
      await db.update(emailCampaignRecipients).set({ draftState: "freigegeben", draftNodeId: node.id, draftAt: new Date(), ...(row.nodeId === node.id ? { nextActionAt: new Date(Date.now() - 2000) } : {}) }).where(eq(emailCampaignRecipients.id, row.id)); changed += 1;
    } else if (row.draftState === "freigegeben" && fits) {
      await db.update(emailCampaignRecipients).set({ draftState: "entwurf", draftAt: new Date() }).where(eq(emailCampaignRecipients.id, row.id)); changed += 1;
    }
  }
  return approve ? { approved: changed, withoutDraft } : { reverted: changed, withoutDraft: 0 };
}
/** Je E-Mail-Schritt das jüngste echte Beispiel: so hat die KI die E-Mail für einen Kontakt tatsächlich geschrieben (für die Vorschau im Builder). */
export async function draftSamples(db: Db, tenantId: number, campaignId: number) {
  const rows = await db.select({ draftNodeId: emailCampaignRecipients.draftNodeId, draftSubject: emailCampaignRecipients.draftSubject, draftText: emailCampaignRecipients.draftText, draftApproach: emailCampaignRecipients.draftApproach, draftAt: emailCampaignRecipients.draftAt, name: emailCampaignRecipients.name, company: emailCampaignRecipients.company, email: emailCampaignRecipients.email }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaignId), isNotNull(emailCampaignRecipients.draftText))).orderBy(desc(emailCampaignRecipients.draftAt)).limit(400);
  const out = new Map<string, { nodeId: string; subject: string; text: string; name: string; approach: string | null; at: Date | null }>();
  for (const row of rows) { const nodeId = row.draftNodeId ?? "__erste"; if (out.has(nodeId) || !row.draftText) continue; out.set(nodeId, { nodeId, subject: row.draftSubject ?? "", text: row.draftText, name: row.name?.trim() || row.company?.trim() || row.email, approach: row.draftApproach ?? null, at: row.draftAt ?? null }); }
  return Array.from(out.values());
}
/** Alle noch nicht gesendeten Entwürfe einer Kampagne verwerfen (auch schon freigegebene) – die KI schreibt sie danach mit den aktuellen Regeln neu. */
export async function resetDrafts(db: Db, tenantId: number, campaignId: number) {
  const open = await db.select({ id: emailCampaignRecipients.id, draftState: emailCampaignRecipients.draftState }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaignId), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"])));
  const ids = open.filter((row) => row.draftState).map((row) => row.id);
  if (ids.length) await db.update(emailCampaignRecipients).set({ draftState: null, draftSubject: null, draftText: null, draftOptions: null, draftApproach: null, draftNodeId: null, draftSource: null, draftAt: null }).where(inArray(emailCampaignRecipients.id, ids));
  return { reset: ids.length };
}
/** Die nächsten Entwürfe schreiben – für Empfänger, deren aktueller Schritt eine E-Mail ist und die noch keinen passenden Entwurf haben; oder für bestimmte Empfänger neu. */
export async function generateDrafts(db: Db, tenantId: number, input: { campaignId: number; recipientIds?: number[] | null; limit?: number | null }) {
  const limit = Math.max(1, Math.min(10, input.limit ?? 5));
  let ids = input.recipientIds?.slice(0, 10) ?? [];
  if (!ids.length) {
    const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, input.campaignId), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!campaign) throw new Error("Kampagne nicht gefunden.");
    const tree = (campaign.tree ?? { start: null, nodes: [] }) as EmailTree;
    const rows = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, input.campaignId), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]))).orderBy(asc(emailCampaignRecipients.id));
    ids = rows.filter((row) => { const node = dueSendNode(tree, row); return node && row.nodeId === node.id && (!row.draftState || !draftFitsNode(row, node.id)); }).slice(0, limit).map((row) => row.id);
    if (!ids.length) ids = rows.filter((row) => { const node = dueSendNode(tree, row); return node && row.sentCount === 0 && (!row.draftState || !draftFitsNode(row, node.id)); }).slice(0, limit).map((row) => row.id); // Rückfall: Erst-E-Mails (z. B. direkt nach dem Start)
  }
  const drafts = []; let failed = 0;
  for (const id of ids) { try { drafts.push(await draftForRecipient(db, tenantId, id)); } catch { failed += 1; } }
  return { drafts, failed, ai: drafts.some((draft) => draft.source === "ki" || draft.source === "kiweb") };
}

/** Freigabe-Liste einer Kampagne: alle offenen Empfänger, deren aktueller Schritt eine E-Mail ist, die noch nicht raus ist – mit dem Namen des Schritts. */
export async function reviewQueue(db: Db, tenantId: number, campaignId: number) {
  const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!campaign) throw new Error("Kampagne nicht gefunden.");
  const tree = (campaign.tree ?? { start: null, nodes: [] }) as EmailTree;
  const all = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaignId), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]))).orderBy(asc(emailCampaignRecipients.id));
  const rows = all.map((row) => { const node = dueSendNode(tree, row); return node && (row.nodeId === node.id || row.sentCount === 0) ? { row, node } : null; }).filter((item): item is { row: Recipient; node: Extract<EmailNode, { type: "send" }> } => Boolean(item));
  const leadIds = Array.from(new Set(rows.map(({ row }) => row.leadId).filter((id): id is number => typeof id === "number")));
  const leadRows = leadIds.length ? await db.select({ id: leads.id, publicId: leads.publicId, city: leads.city, listName: leads.listName, company: leads.company, firstName: leads.firstName, lastName: leads.lastName, metadata: leads.metadata }).from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, leadIds))) : [];
  const items = rows.map(({ row, node }) => { const lead = leadRows.find((item) => item.id === row.leadId) ?? null; const fits = draftFitsNode(row, node.id); return { id: row.id, email: row.email, name: row.name, company: row.company ?? lead?.company ?? null, city: lead?.city ?? null, listName: lead?.listName ?? null, publicId: lead?.publicId ?? null, website: websiteOf(lead?.metadata, row.email), nodeId: node.id, nodeLabel: node.label?.trim() || node.subject, followUp: row.sentCount > 0, draftSubject: fits ? row.draftSubject : null, draftText: fits ? row.draftText : null, draftOptions: (fits && Array.isArray(row.draftOptions) ? row.draftOptions : []) as DraftOption[], draftApproach: (fits ? row.draftApproach || null : null) as DraftApproach | null, draftState: (fits ? row.draftState || null : null) as "entwurf" | "freigegeben" | null, draftSource: fits ? row.draftSource : null, draftAt: fits ? row.draftAt : null }; });
  return { items, counts: { offen: items.filter((item) => !item.draftState).length, entwurf: items.filter((item) => item.draftState === "entwurf").length, freigegeben: items.filter((item) => item.draftState === "freigegeben").length } };
}

/** Entwurf speichern, freigeben oder Freigabe zurücknehmen – gilt für den aktuellen Schritt des Empfängers. Freigegeben = geht beim nächsten Lauf raus. */
export async function saveDraft(db: Db, tenantId: number, input: { recipientId: number; subject: string; text: string; approve: boolean; approach?: DraftApproach | null }) {
  const recipient = (await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.id, input.recipientId), eq(emailCampaignRecipients.tenantId, tenantId))).limit(1))[0];
  if (!recipient) throw new Error("Empfänger nicht gefunden.");
  if (!["wartet", "laeuft"].includes(recipient.status)) throw new Error("Dieser Kontakt steckt in keiner laufenden Serie mehr.");
  const { node } = await loadContext(db, tenantId, recipient, recipient.draftNodeId);
  const sent = await db.select({ id: emailCampaignEvents.id }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.recipientId, recipient.id), eq(emailCampaignEvents.kind, "gesendet"), eq(emailCampaignEvents.nodeId, node.id))).limit(1);
  if (sent.length) throw new Error(`Die E-Mail „${node.label?.trim() || node.subject}“ ist an diesen Kontakt schon raus.`);
  const subject = input.subject.trim().slice(0, 300); const text = input.text.trim();
  if (input.approve && (!subject || text.length < 10)) throw new Error("Bitte Betreff und Text ausfüllen.");
  await db.update(emailCampaignRecipients).set({ draftSubject: subject || null, draftText: text || null, draftNodeId: node.id, draftState: input.approve ? "freigegeben" : "entwurf", draftSource: recipient.draftSource ?? "hand", ...(input.approach ? { draftApproach: input.approach } : {}), draftAt: new Date(), ...(input.approve && recipient.nodeId === node.id ? { nextActionAt: new Date(Date.now() - 2000) } : {}) }).where(eq(emailCampaignRecipients.id, recipient.id));
  return { id: recipient.id, draftState: input.approve ? "freigegeben" as const : "entwurf" as const };
}
