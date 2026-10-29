/**
 * KI-Versand: Die KI schreibt JEDE E-Mail einer Kampagne einzeln – für jeden Kontakt und jeden Schritt des Ablaufs
 * (Erst-E-Mail und Nachfass-Mails), im gewählten Ansatz (Drittanbieter oder freier Vorschlag). Zwei Betriebsarten:
 * „freigabe“ = du liest jeden Entwurf unter „Freigeben“ und schickst ihn los; „auto“ = die KI schreibt im Hintergrund
 * und der Versand läuft sofort weiter (ist die KI nicht erreichbar, wartet die E-Mail – nie still die Vorlage). „aus“ = Vorlagen wie früher.
 * Dazu das Tageslimit für alle Kampagnen zusammen (Standard 80 E-Mails am Tag).
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { categoryFields, emailCampaignEvents, emailCampaignRecipients, emailCampaigns, leads, mailSettings } from "../drizzle/schema";
import { audienceLists, kiModusOf } from "../shared/email-campaigns";
import { applyPayFit, DEFAULT_SPARTE, fitsSparte, fixQuestionCount, isEnergySparte, mentionsQuestions, numberWord, offerChain, offersForeignLeads, paysOnlyFitting, qualifyPhrase, questionCount, questionTopics, sparteOf, topicsExamples, topicsSentence, withQuestionTopics, withSparte, type Sparte } from "../shared/lead-sparte";
import { extractProfile } from "../shared/lead-finder";
import { cleanDraftText, dropAdPlatforms, shortParagraphs, PORTAL_RE, smoothQualifyPhrase, approachLabel, approachOf, LEGACY_APPROACH, DRAFT_APPROACHES, copiesTemplate, dropThirdPartyClaim, fixTreeQuestions, thirdPartyTemplate, contactWay, type DraftApproach, type DraftOption, type EmailNode, blocksToPlainText, dayStartIn, DEFAULT_CAMPAIGN_DAILY_LIMIT, fillPlaceholdersSafe, firstSendNode, kiAnsatzOf, recipientValues, type EmailTree } from "../shared/email-campaigns";
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
  const values = recipientValues({ firstName: lead?.firstName ?? recipient.name?.split(" ")[0], lastName: lead?.lastName ?? recipient.name?.split(" ").slice(1).join(" "), company: lead?.company ?? recipient.company, city: lead?.city, salutation: (lead?.metadata as { salutation?: string } | null)?.salutation ?? null, email: recipient.email, fields: Object.fromEntries(Object.entries(extraFieldsOf(lead?.metadata)).filter(([key, value]) => !PORTAL_RE.test(key) && !PORTAL_RE.test(String(value ?? "")))), phone }); // Aroundhome-Daten bekommt die KI gar nicht erst zu sehen
  return { campaign, lead, node, values, phone };
}

/** Leadsparte einer Kampagne: eingetragen, sonst erkannt aus Name, Listen der Zielgruppe und Liste des Kontakts. */
export function sparteOfCampaign(campaign: { leadSparte?: string | null; name?: string | null; audience?: unknown }, listName?: string | null): ReturnType<typeof sparteOf> {
  return sparteOf(campaign, [...audienceLists((campaign.audience ?? null) as never), listName ?? ""].filter(Boolean));
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

/** Anweisungen an die KI – auf die Leadsparte der Kampagne zugeschnitten (Hausnotruf-Firmen bekommen Hausnotruf-Texte, nie Wärmepumpen). */
function systemFor(sparte: Sparte): string {
  const energy = isEnergySparte(sparte);
  const qualify = qualifyPhrase(sparte); const count = questionCount(sparte); // Hausnotruf 6, Elektrorollstuhl 6, Alarmanlage 8, PV & WP 10 – sonst ohne Zahl
  const countRule = count ? `Bei ${sparte.label} qualifizieren wir mit ${numberWord(count)} Fragen – nenne nie eine andere Zahl, auch wenn Vorlage oder Beispiel eine andere nennen${count !== 10 ? " (z. B. zehn)" : ""}.` : `Für ${sparte.label} nennst du keine Zahl von Fragen – schreibe „anhand gezielter Fragen“.`;
  // Beispiele OHNE Klammern, worum es bei den Fragen geht (feste Punkte je Sparte – neue Sparten: die KI nennt drei passende), danach die Logik-Kette
  const examples = topicsExamples(sparte); const chain = offerChain(sparte);
  const hints = (sparte.hints ?? []).filter(Boolean).slice(0, 12); // Angaben, die wir in den gewählten Lead-Kategorien erfassen
  const hintRule = hints.length ? ` Nimm die drei Punkte aus den Angaben, die wir bei diesen Anfragen erfassen: ${hints.join(", ")} – als ganze, verständliche Wendungen (z. B. „die gewünschte …“, „der geplante …“), nicht als Stichwort.` : "";
  const topicRule = questionTopics(sparte) ? `Direkt nach diesem Satz folgt ein eigener Satz mit Beispielen, was wir abfragen – genau so, ohne Klammern: „${topicsSentence(sparte)}“` : `Direkt nach diesem Satz folgt ein eigener Satz mit drei typischen Punkten, die bei Anfragen zu ${sparte.topic} am Telefon abgefragt werden – ohne Klammern, kurz, konkret und passend zu ${sparte.topic}: „Abgefragt werden beispielsweise …, …, … usw.“${hintRule}`;
  const chainRule = `Danach kommt die Logik-Kette, wörtlich oder sehr nah daran: „${chain}“ – der Interessent wartet auf den Anruf des Betriebs, damit er das Angebot bekommt. Nie Klammern für die Beispiele, nie „(z. B. …)“.`;
  return `Du schreibst für Tanesco Digital (einer der größten Leadlieferanten Deutschlands) Akquise-E-Mails an ${sparte.recipients} – jede einzeln, wie von Hand geschrieben, nie wie ein Serienbrief. Je nach Auftrag schreibst du die Erst-E-Mail oder eine Nachfass-Mail, als die verlangten Vorschläge (Ansätze), alle persönlich auf genau diesen Empfänger zugeschnitten.

LEADSPARTE dieser Kampagne: ${sparte.label}. Jede E-Mail handelt ausschließlich von ${sparte.leads} – Interessenten für ${sparte.topic}, die Tanesco gewinnt und an den Empfänger übergibt. Keine andere Sparte erwähnen${energy ? "" : " – kein Wort zu Photovoltaik, Solar, PV oder Wärmepumpen"}. Vorlage und Beispiel unten können aus einer anderen Sparte stammen: übernimm daraus nur Aufbau und Ton, nie das Thema.

Was Tanesco anbietet (nur diese Fakten verwenden): ${sparte.leads}, die wir selbst online generieren (eigene Online-Leadgenerierung), ${qualify}${examples ? ` – abgefragt werden ${examples}` : ""}; der Interessent weiß danach, dass sich ein ${sparte.partner} bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet also auf den Anruf des Betriebs. Interne Qualitätskontrolle, exklusiv, Echtzeit per API/Schnittstelle, keine Vorkasse, keine lange Vertragsbindung, gut skalierbar, seit über vier Jahren im Leadmarkt.${paysOnlyFitting(sparte) ? " Abrechnung: Der Betrieb zahlt nur für Leads, die zu ihm passen." : " Behaupte NICHT, dass der Betrieb nur für passende Leads zahlt – das gilt in dieser Sparte nicht."} Test-Angebot: 20 Test-Leads kostenlos, individuell für den Betrieb und telefonisch qualifiziert – baue dieses Angebot in beide Ansätze ein, Drittanbieter und freien Vorschlag (in Erst-E-Mails immer, in Nachfass-Mails, wenn es passt).

1) "drittanbieter" – Drittanbieter-Ansatz. Kernbotschaft, die IMMER enthalten sein muss: Wir sind einer der größten Lead-Lieferanten Deutschlands, und über unsere Quellen haben wir mitbekommen, dass bei der Firma sehr wahrscheinlich Leads ankommen, die ohnehin von uns stammen – nur weitergereicht über Zwischenhändler. Dieser Umweg macht Qualität und Preis kaputt: Die Leads werden mehrfach weiterverkauft, jeder Zwischenschritt schlägt auf den Preis auf, und beim Betrieb kommen genervte Interessenten und falsche Kontaktdaten an. Genau deshalb streben wir die direkte Zusammenarbeit mit dieser Firma an (kürzere Lieferkette, besserer Preis ohne Zwischenstufen, mehr Transparenz, direkte Qualitätskontrolle). Formuliere es als begründete Vermutung („sehr wahrscheinlich“, „gehen wir davon aus“), nie als bewiesene Tatsache, und erfinde keinen konkreten Zwischenhändler-Namen. Seriös und förmlich, darf eine kurze Aufzählung der Vorteile haben, bittet um ein Telefonat mit dem Ansprechpartner aus dem Leadmanagement. Trotzdem IMMER persönlich und individuell, nie Serienbrief: mindestens zwei konkrete Bezüge auf genau diese Firma (etwas Wörtliches oder Konkretes von der Webseite, die Leistung/Spezialisierung, Region/Einzugsgebiet, Größe oder Geschäftsfeld) – einer davon im ersten Absatz, bevor die Kernbotschaft kommt, und die Vorteile auf die Situation der Firma bezogen. 120–200 Wörter.

2) "frei" – Freier Vorschlag: deine eigene, kreative Idee für genau diese Firma – ein Aufhänger, der nur zu ihr passt, z. B. eine kluge Frage zu ihrem Geschäft, eine Beobachtung zu ihrer Region oder Zielgruppe, ein kleines Rechenbeispiel oder ein Vergleich. Ganz anders aufgebaut als der Drittanbieter-Ansatz.
- Lies dafür Webseite und Impressum genau: Was bietet die Firma an (Produkte, Leistungen, Marken, Spezialisierung), für wen, wo (Standorte, Einzugsgebiet), seit wann, wie groß, wer führt sie? Greife mindestens zwei konkrete Punkte auf – gern mit den Worten der Webseite. Ohne Webseite: aus den Angaben (Firma, Ort, Liste, weitere Felder).
- Kein Satz darf so allgemein sein, dass er wortgleich in jeder E-Mail stehen könnte – ausgenommen Test-Angebot, Qualifizierung und Schluss. Übernimm KEINEN Satz aus der Vorlage der Kampagne – sie zeigt nur Thema und Ton. Keine Floskeln, keine Aufzählung. 80–140 Wörter.
- Ohne die Drittanbieter-Kernbotschaft (Leads, die bei der Firma ankommen, stammen in Wahrheit von uns). Normale Aussagen zu unserem Angebot sind erlaubt (exklusiv, nicht an Dritte weiterverkauft, ohne Umweg über Portale, eigene Generierung).${paysOnlyFitting(sparte) ? " In der Erst-E-Mail steht immer ein Satz, dass der Betrieb nur für Leads zahlt, die zu ihm passen (z. B. „Sie zahlen dabei nur für Leads, die wirklich zu Ihnen passen.“)." : ""}

Wie wir die Interessenten gewinnen: nur „online“ bzw. „eigene Online-Leadgenerierung“ – nenne NIE Meta, Facebook, Instagram, Google oder andere Plattformen.
Aroundhome erwähnst du NIE – weder den Namen noch Zahlen, Antworten, Bewertungen oder Anfragen von dort, auch nicht umschrieben. Auch keine anderen Portale oder Vermittler beim Namen. Bewertungen darfst du nur ansprechen, wenn in den Daten ausdrücklich Google-Bewertungen stehen – dann als „Google-Bewertungen“ und nur mit genau diesen Zahlen; sonst gar keine Bewertungen erwähnen.
Formulierung zur Qualifizierung immer so: „${qualify}“ – nie „qualifiziert über … Fragen“. ${countRule} ${topicRule} ${chainRule}
Pflichtinhalte in JEDER E-Mail, egal welcher Ansatz (in Erst-E-Mails ausführlich, in Nachfass-Mails in ein bis zwei Sätzen): das Test-Angebot (20 Test-Leads kostenlos, individuell für den Betrieb und telefonisch qualifiziert), wie wir qualifizieren (${qualify}, mit den Beispielen) und die Logik-Kette (der Interessent weiß, dass sich ein ${sparte.partner} mit einem Angebot bei ihm meldet – er wartet auf den Anruf des Betriebs). Den Firmennamen des Betriebs nennen wir dabei NICHT – das darf nirgends stehen. Fehlt von den Pflichtinhalten etwas, ist die E-Mail falsch.

Regeln für beide: Deutsch, Sie-Form. Kurze Absätze, damit die E-Mail leicht lesbar ist: je Absatz ein bis drei Sätze (etwa zwei bis drei Zeilen), dazwischen immer eine Leerzeile – nie ein langer Textblock. Für die Anrede gibt es genau zwei Formen: „Sehr geehrter Herr Nachname,“ / „Sehr geehrte Frau Nachname,“ – oder „Sehr geehrte Damen und Herren,“. Nie „Hallo“, „Hi“, „Moin“, nie „Guten Tag Vorname Nachname“, nie nur der Vorname. Herr oder Frau darfst du aus einem eindeutigen Vornamen ableiten (Stefan → Herr, Katrin → Frau); ist der Vorname nicht eindeutig oder fehlt der Nachname, schreibst du „Sehr geehrte Damen und Herren“. Steht in den Angaben kein Ansprechpartner, nimm den Geschäftsführer oder Inhaber aus dem Impressum (siehe „Geschäftsführung laut Impressum“ bzw. den Webseiten-Auszug) und sprich diese Person in BEIDEN Vorschlägen direkt mit Herr/Frau und Nachnamen an (ohne Vornamen und Titel) – aber nur, wenn der Name wörtlich im Auszug steht, nie geraten. Erst wenn es gar keinen Namen gibt: „Sehr geehrte Damen und Herren“ – nie „Hallo“ ohne Namen. Nichts erfinden: keine Zahlen, Standorte, Zitate, Namen oder Fakten, die nicht in den Angaben oder auf der Webseite stehen – Webseiten-Zitate nur wörtlich aus dem Auszug. Keine Floskeln, kein „ich habe Ihre Webseite besucht“, keine Links, kein Knopf, keine Terminbuchung, keine Ausrufezeichen. Der Schluss ist immer gleich aufgebaut: vorletzter Absatz = ein klarer Satz, was zu tun ist – „Wenn das für Sie interessant ist, antworten Sie einfach auf diese E-Mail oder rufen Sie mich gerne an unter <Telefon des Absenders>.“ (Telefon steht in den Angaben; fehlt es: nur „antworten Sie einfach auf diese E-Mail“; eine Variante wie „Lassen Sie uns gerne sprechen: …“ ist erlaubt, die Nummer muss dann trotzdem drinstehen) – und die letzte Zeile lautet genau „Vielen Dank“. KEINE Grußformel danach – kein „Mit freundlichen Grüßen“, kein „Viele Grüße“, kein Name: Die Signatur, die das System automatisch anhängt, enthält Gruß und Namen schon. Betreff je Vorschlag: konkret, persönlich, höchstens 70 Zeichen, kein Clickbait.
Die Vorlage der Kampagne zeigt nur Thema und Ton – übernimm daraus keine Sätze; jede E-Mail wird neu für genau diese Firma geschrieben (Thema immer die Leadsparte oben).
Nachfass-Mails (wenn der Auftrag sagt, dass schon E-Mails raus sind): kurz (50–110 Wörter), knüpfen in einem Halbsatz an die vorige E-Mail an, ohne sie zu wiederholen – danach ein NEUER Aufhänger oder konkreter Mehrwert (eine Frage zum Bedarf, ein passender Punkt von der Webseite, ein Angebot wie kostenlose Test-Leads, ein konkreter Terminvorschlag). Keine erneute lange Vorstellung von Tanesco, derselbe Ansatz wie verlangt, genauso individuell.`;
}

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
/** Fehlen Test-Angebot oder Qualifizierung, kommen sie als eigener Absatz vor den Schluss – damit kein Entwurf ohne die Kerninhalte rausgeht. Die Zahl der Fragen kommt aus der Sparte (Hausnotruf 6, Alarmanlage 8, PV & WP 10). */
export function ensureFacts(text: string, followUp: boolean, partner = "Fachbetrieb", sparte?: Pick<Sparte, "key"> & { questions?: number | null }): string { // Beispiele und Logik-Kette setzt danach withQuestionTopics dazu
  const hasOffer = /test-?leads?/i.test(text) && /\b20\b/.test(text); const hasQualify = mentionsQuestions(text);
  if (hasOffer && (hasQualify || followUp)) return text;
  const qualify = qualifyPhrase(sparte);
  void partner;
  const add = !hasOffer && !hasQualify && !followUp ? `Damit Sie das ohne Risiko prüfen können: 20 Test-Leads kostenlos, individuell für Ihren Betrieb und ${qualify}.`
    : !hasOffer ? "Zum Kennenlernen: 20 Test-Leads kostenlos, individuell für Ihren Betrieb und telefonisch qualifiziert."
    : `Jeder Interessent wird ${qualify}.`;
  // vor den Schluss: Handlungsaufforderung und „Vielen Dank“ bleiben am Ende (früher stand das Test-Angebot manchmal unter „Vielen Dank“)
  const parts = text.split(/\n{2,}/); let at = parts.length;
  for (let index = parts.length - 1; index > 0; index -= 1) { if (CTA_RE.test(parts[index]) || THANKS_RE.test(parts[index])) at = index; else break; }
  parts.splice(at, 0, add);
  return parts.join("\n\n");
}
const THANKS_RE = /^\s*(vielen\s+dank|danke|herzlichen\s+dank)\b[^\n]{0,40}$/i;
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
export function finishDraft(text: string, options: { greeting: string; phone: string; followUp: boolean; partner?: string; sparte?: Pick<Sparte, "key"> & { questions?: number | null; topics?: string[] | null; partner?: string }; approach?: string | null }): string {
  const withFacts = ensureFacts(fixGreeting(dropCompanyNameClaim(text.trim()), options.greeting), options.followUp, options.partner, options.sparte);
  const payFit = options.sparte ? applyPayFit(withFacts, { sparte: options.sparte, approach: options.approach, followUp: options.followUp }) : withFacts; // PV & WP: „nur passende Leads zahlen“ im freien Vorschlag – sonst nirgends erzwungen
  const done = cleanDraftText(ensureClosing(payFit, options.phone));
  // Zahl der Fragen passend zur Sparte (auch wenn die KI „zehn“ aus der Vorlage übernimmt) – dahinter Beispiele ohne Klammern und die Logik-Kette
  const sparte = options.sparte ? { ...options.sparte, partner: options.sparte.partner ?? options.partner } : null;
  return sparte ? shortParagraphs(withQuestionTopics(fixQuestionCount(done, sparte), sparte)) : done;
}
type FollowUpInfo = { index: number; sentSubjects: string[] } | null; // Nr. der E-Mail im Ablauf (0 = Erst-E-Mail) und was schon raus ist
/** Ein KI-Vorschlag samt Schwächen („bezuege“ = zu wenig Bezug auf die Firma, „vorlage“ = zu nah an der Vorlage) – Schwächen führen zu einem zweiten Versuch, nie zum Wegwerfen. */
export type AiOption = DraftOption & { issues: Array<"bezuege" | "vorlage"> };
export async function aiDrafts(base: { subject: string; text: string }, info: Record<string, string>, site: { url: string; text: string } | null = null, options: { approaches?: DraftApproach[]; followUp?: FollowUpInfo; stepLabel?: string | null; phone?: string | null; sparte?: Sparte; retryNote?: string | null } = {}): Promise<AiOption[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const wanted = options.approaches?.length ? DRAFT_APPROACHES.filter((approach) => options.approaches!.includes(approach.key)) : DRAFT_APPROACHES;
    const sparte = options.sparte ?? DEFAULT_SPARTE;
    const facts = Object.entries(info).filter(([, value]) => value && String(value).trim()).map(([key, value]) => `${key}: ${String(value).slice(0, 300)}`).join("\n") + `\nTelefon des Absenders (für den Schluss): ${options.phone?.trim() || "nicht hinterlegt – dann nur „antworten Sie einfach auf diese E-Mail“"}`;
    // „bezuege“: welche konkreten Punkte dieser Firma der Text aufgreift – so schreibt die KI wirklich auf die Firma zu, und man sieht es unter „Freigeben“
    const option = { type: "object", additionalProperties: false, required: ["subject", "text", "bezuege"], properties: { subject: { type: "string" }, text: { type: "string" }, bezuege: { type: "array", items: { type: "string" }, description: "Die konkreten Punkte genau dieser Firma, die der Text aufgreift (z. B. eine Leistung, ein Zitat oder eine Zahl von der Webseite, Region, Spezialisierung, Geschäftsführer aus dem Impressum)" } } };
    const followUp = options.followUp && options.followUp.index > 0 ? `\n\nDies ist eine NACHFASS-MAIL (E-Mail Nr. ${options.followUp.index + 1} der Serie${options.stepLabel ? `, Schritt „${options.stepLabel}“` : ""}). Schon gesendet: ${options.followUp.sentSubjects.length ? options.followUp.sentSubjects.map((subject) => `„${subject}“`).join(", ") : "die Erst-E-Mail"}. Halte dich an die Nachfass-Regeln.` : "";
    const task = (wanted.length === DRAFT_APPROACHES.length ? "Schreibe beide Vorschläge für diesen Empfänger – deutlich verschieden." : `Schreibe NUR diese${wanted.length === 1 ? "n" : ""} Vorschl${wanted.length === 1 ? "ag" : "äge"} für diesen Empfänger: ${wanted.map((approach) => `"${approach.key}"`).join(", ")}.`) + " Nenne bei jedem Vorschlag unter „bezuege“ die konkreten Punkte dieser Firma, die du aufgreifst." + (options.retryNote ? `\n\n${options.retryNote}` : "");
    const response = await invokeLLM({ maxTokens: wanted.length === 1 ? 1500 : 3800, temperature: 0.8, messages: [{ role: "system", content: systemFor(sparte) }, { role: "user", content: `Leadsparte: ${sparte.label}\nEmpfänger:\n${facts}${site ? `\n\nWebseite (${site.url}), Auszug:\n${site.text.slice(0, 9000)}` : "\n\n(Keine Webseite verfügbar – nur die Angaben oben nutzen.)"}\n\nVorlage dieses Schritts (nur Thema und Ton – keine Sätze übernehmen) – Betreff: ${base.subject}\n\n${base.text}${followUp}\n\n${task}` }], outputSchema: { name: "vorschlaege", schema: { type: "object", additionalProperties: false, required: wanted.map((approach) => approach.key), properties: Object.fromEntries(wanted.map((approach) => [approach.key, option])) } } });
    const parsed = JSON.parse(response.choices[0]?.message.content ?? "{}") as Record<string, { subject?: unknown; text?: unknown; bezuege?: unknown } | undefined>;
    const firstMail = !(options.followUp && options.followUp.index > 0);
    const list = wanted.map((approach): AiOption | null => {
      const raw = parsed[approach.key]; const subject = String(raw?.subject ?? "").trim().slice(0, 300); let text = stripClosing(String(raw?.text ?? "").trim());
      const refs = (Array.isArray(raw?.bezuege) ? raw!.bezuege as unknown[] : []).map((item) => String(item ?? "").trim()).filter((item) => item.length > 2 && !PORTAL_RE.test(item)).slice(0, 6);
      if (!subject || text.length <= 40) return null;
      if (offersForeignLeads(sparte, `${subject}\n${text}`)) return null; // falsches Thema (z. B. PV-Leads an eine Hausnotruf-Firma) – nur das ist ein harter Fehler
      if (approach.key !== "drittanbieter") { const cleaned = dropThirdPartyClaim(text); if (cleaned.length < Math.max(80, text.length * 0.5)) return null; text = cleaned; } // Drittanbieter-Kernbotschaft: nur diese Sätze raus, der Rest des KI-Textes bleibt
      const issues: AiOption["issues"] = [];
      if (approach.key === "frei" && firstMail && refs.length < (site ? 2 : 1)) issues.push("bezuege"); // der freie Vorschlag muss wirklich auf die Firma geschrieben sein
      if (approach.key !== "drittanbieter" && copiesTemplate(text, base.text)) issues.push("vorlage");
      return { key: approach.key, label: approach.label, subject, text, refs, issues };
    }).filter((item): item is AiOption => Boolean(item));
    return list.length ? list : null;
  } catch (error) { console.error("[KI-Entwurf]", error instanceof Error ? error.message.slice(0, 300) : error); return null; }
}
/** Zweiter Versuch: der KI genau sagen, was am ersten Text fehlte. */
export function retryNoteFor(approach: DraftApproach, issues: AiOption["issues"] | null): string {
  if (approach === "drittanbieter") return "Wichtig: Schreibe den Drittanbieter-Ansatz für genau diese Firma – mit zwei konkreten Bezügen auf ihre Webseite vor der Kernbotschaft.";
  const parts = ["Wichtig: Schreibe den freien Vorschlag ganz neu."];
  if (!issues) parts.push("Der vorige Text kam nicht brauchbar an.");
  if (issues?.includes("bezuege")) parts.push("Der vorige Text hatte zu wenig konkrete Bezüge auf genau diese Firma – greife mindestens zwei konkrete Punkte von Webseite und Impressum auf (Leistungen, Produkte, Spezialisierung, Zahlen, Region, Zitate, Geschäftsführer für die Anrede) und nenne sie unter „bezuege“.");
  if (issues?.includes("vorlage")) parts.push("Der vorige Text war zu nah an der Vorlage der Kampagne – schreibe in eigenen Worten, kein Satz aus der Vorlage.");
  return parts.join(" ");
}

/** Kontaktdaten und Formales gehören nicht zu den Punkten, die wir am Telefon abfragen (Name, Telefon, Adresse, Einwilligung …). */
const CONTACT_FIELD_RE = /^(?:anrede|titel|vor-?name|nach-?name|name|firma|unternehmen|telefon\w*|handy\w*|mobil\w*|e-?mail\w*|plz|postleitzahl|ort|stadt|wohnort|stra(?:ß|ss)e\w*|hausnummer|adresse|anschrift|land|bundesland|geburts\w*|alter|kommentar\w*|notiz\w*|bemerkung\w*|anmerkung\w*|nachricht|einwilligung\w*|datenschutz\w*|agb|erreichbar\w*|r(?:ü|ue)ckruf\w*|uhrzeit|datum)\b/i;
/**
 * Sparte ohne feste Punkte (z. B. „Hörgeräte“) und Lead-Kategorien gewählt: die Angaben, die wir in diesen Kategorien erfassen, gehen als
 * Hinweis an die KI – daraus nennt sie die drei Beispiele, was am Telefon abgefragt wird. Bekannte Sparten haben feste Punkte.
 */
export async function withCategoryHints<T extends Sparte>(db: Db, tenantId: number, campaign: { leadCategoryIds?: unknown }, sparte: T): Promise<T> {
  if (questionTopics(sparte)) return sparte;
  const ids = Array.isArray(campaign.leadCategoryIds) ? (campaign.leadCategoryIds as unknown[]).map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 20) : [];
  if (!ids.length) return sparte;
  const rows = await db.select({ label: categoryFields.label, sortOrder: categoryFields.sortOrder, id: categoryFields.id }).from(categoryFields).where(and(eq(categoryFields.tenantId, tenantId), inArray(categoryFields.categoryId, ids), eq(categoryFields.visible, true))).orderBy(asc(categoryFields.sortOrder), asc(categoryFields.id)).catch(() => []);
  const hints = Array.from(new Set(rows.map((row) => row.label.trim()).filter((label) => label && label.length <= 60 && !CONTACT_FIELD_RE.test(label)))).slice(0, 12);
  return hints.length ? { ...sparte, hints } : sparte;
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
  const context = await loadContext(db, tenantId, recipient, options.nodeId); const { campaign, lead, node, phone } = context;
  const sparte = await withCategoryHints(db, tenantId, campaign, sparteOfCampaign(campaign, lead?.listName)); const values = withSparte(context.values, sparte); // Leadsparte: Hausnotruf-Firmen bekommen Hausnotruf-Texte
  const sentEvents = await db.select({ nodeId: emailCampaignEvents.nodeId, subject: emailCampaignEvents.subject }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.recipientId, recipient.id), eq(emailCampaignEvents.kind, "gesendet"))).orderBy(asc(emailCampaignEvents.id));
  if (sentEvents.some((event) => event.nodeId === node.id)) throw new Error(`Die E-Mail „${node.label?.trim() || node.subject}“ ist an diesen Kontakt schon raus.`);
  const base = templateDraft(node, values);
  const meta = (lead?.metadata ?? {}) as Record<string, unknown>;
  const website = websiteOf(lead?.metadata, recipient.email);
  const info: Record<string, string> = { Firma: values.firma, Ansprechpartner: [values.anrede, values.vorname, values.nachname].filter(Boolean).join(" "), Ort: values.stadt, "PLZ": String(lead?.postcode ?? ""), Webseite: website ?? String(meta.website ?? meta.webseite ?? ""), Liste: String(lead?.listName ?? ""), ...Object.fromEntries(Object.entries(extraFieldsOf(lead?.metadata)).filter(([key, value]) => !PORTAL_RE.test(key) && !PORTAL_RE.test(String(value))).map(([key, value]) => [key, String(value)])) }; // Portal-Daten (Aroundhome) gehen nie an die KI
  // Webseite lesen (Startseite + Impressum + Leistungen/Über uns) – die KI greift daraus konkrete Punkte auf
  const rawSite = process.env.ANTHROPIC_API_KEY && website ? await readWebsiteText(website).catch(() => null) : null;
  const site = rawSite ? { ...rawSite, text: rawSite.text.split(/\n+/).filter((line) => !PORTAL_RE.test(line)).join("\n") } : null; // Portal-Hinweise der Webseite (z. B. Aroundhome-Siegel) nicht an die KI
  // Was auf Webseite und Impressum steht, ausdrücklich mitgeben: Geschäftsführung (für die Anrede), Leistungen, Gebiet, Gründung, Größe
  if (site) { const profile = extractProfile([{ url: site.url, text: site.text }]); const add = (key: string, value: string | null | undefined) => { if (value && value.trim() && !PORTAL_RE.test(value) && !info[key]) info[key] = value.trim(); }; if (!info.Ansprechpartner) add("Geschäftsführung laut Impressum", profile.management); add("Leistungen laut Webseite", profile.services.join(", ")); add("Einsatzgebiet laut Webseite", profile.serviceArea); add("Gegründet", profile.founded); add("Mitarbeiter", profile.employees); }
  const ansatz: DraftApproach = options.onlyApproach ?? kiAnsatzOf(campaign); // der gewählte Ansatz – IMMER der Haupt-Entwurf
  const followUp: FollowUpInfo = { index: sentEvents.length, sentSubjects: sentEvents.map((event) => event.subject ?? "").filter(Boolean).slice(-4) };
  const finish = (text: string, approach: DraftApproach) => finishDraft(text, { greeting: values.begruessung, phone, followUp: sentEvents.length > 0, partner: sparte.partner, sparte, approach });
  const polish = (items: AiOption[] | null): AiOption[] | null => items?.map((item) => ({ ...item, source: "ki" as const, subject: PORTAL_RE.test(item.subject) ? base.subject : dropAdPlatforms(item.subject), text: finish(item.text, item.key) })) ?? null; // nie Aroundhome – auch nicht im Betreff; nie Meta & Co.
  const aiOptions = { followUp, stepLabel: node.label ?? node.subject, phone, sparte };
  let ai = polish(await aiDrafts(base, info, site, { ...aiOptions, approaches: options.onlyApproach ? [options.onlyApproach] : undefined }));
  // Fehlt der gewählte Ansatz oder ist er schwach (zu wenig Bezug auf die Firma, zu nah an der Vorlage): noch einmal NUR diesen schreiben lassen, mit genauem Hinweis.
  // Danach gilt der bessere KI-Text – ein KI-Text wird nie durch die Vorlage ersetzt (nur wenn die KI gar nichts Brauchbares liefert).
  const main = ai?.find((item) => item.key === ansatz) ?? null;
  if ((!main || main.issues.length) && process.env.ANTHROPIC_API_KEY) {
    const again = polish(await aiDrafts(base, info, site, { ...aiOptions, approaches: [ansatz], retryNote: retryNoteFor(ansatz, main?.issues ?? null) }))?.find((item) => item.key === ansatz) ?? null;
    if (again && (!main || again.issues.length <= main.issues.length)) ai = [again, ...(ai ?? []).filter((item) => item.key !== ansatz)];
  }
  if (ai) ai = ai.filter((item) => item.key === ansatz || !item.issues.includes("vorlage")); // Alternativen, die nur die Vorlage wiederholen, bringen nichts
  // Ohne KI: Erst-E-Mail – frei = Vorlage des Schritts mit den Daten, Drittanbieter = feste Drittanbieter-Vorlage; Nachfass-Mail – die Vorlage des Schritts im Ansatz der Kampagne
  const third = thirdPartyTemplate(values, sparte);
  const fallback: DraftOption[] = sentEvents.length === 0
    ? [{ key: "frei", label: approachLabel("frei"), subject: base.subject, text: finish(base.text, "frei"), source: "vorlage" }, { key: "drittanbieter", label: approachLabel("drittanbieter"), subject: third.subject, text: finish(third.text, "drittanbieter"), source: "vorlage" }]
    : [{ key: ansatz, label: approachLabel(ansatz), subject: base.subject, text: finish(base.text, ansatz), source: "vorlage" }];
  // Der Ansatz der Kampagne ist der Haupt-Vorschlag – die anderen bleiben als Alternativen wählbar. Hat die KI ihn nicht geschrieben, steht die Vorlage dieses Ansatzes vorn (als „Ersatz aus Vorlage“ – geht im Auto-Modus nie raus).
  const candidates: DraftOption[] = ai?.length ? (ai.some((item) => item.key === ansatz) ? ai : [...fallback.filter((item) => item.key === ansatz), ...ai]) : fallback;
  const chosen = candidates.find((item) => item.key === ansatz) ?? fallback[0]; const source = chosen.source === "ki" && (ai as DraftOption[] | null)?.includes(chosen) ? (site ? "kiweb" : "ki") : "vorlage";
  const stored = (item: DraftOption): DraftOption => { const { issues: _issues, ...rest } = item as AiOption; void _issues; return rest; }; // Schwächen nur intern
  const first = stored(chosen); const list = (candidates.includes(chosen) ? candidates : [chosen, ...candidates]).map(stored); // der Haupt-Entwurf steht immer auch unter den Vorschlägen
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
  let changed = 0; let withoutDraft = 0; let templateOnly = 0;
  for (const row of rows) {
    const node = dueSendNode(tree, row); if (!node) continue;
    const fits = Boolean(row.draftState) && draftFitsNode(row, node.id) && Boolean(row.draftSubject?.trim()) && (row.draftText ?? "").trim().length >= 10;
    if (approve) {
      if (!fits) { withoutDraft += 1; continue; }
      if (row.draftState === "freigegeben") continue;
      if (row.draftSource === "vorlage") { templateOnly += 1; continue; } // Ersatz aus der Vorlage (KI hat nicht geschrieben) – nie per „Alle freigeben“, nur bewusst einzeln
      await db.update(emailCampaignRecipients).set({ draftState: "freigegeben", draftNodeId: node.id, draftAt: new Date(), ...(row.nodeId === node.id ? { nextActionAt: new Date(Date.now() - 2000) } : {}) }).where(eq(emailCampaignRecipients.id, row.id)); changed += 1;
    } else if (row.draftState === "freigegeben" && fits) {
      await db.update(emailCampaignRecipients).set({ draftState: "entwurf", draftAt: new Date() }).where(eq(emailCampaignRecipients.id, row.id)); changed += 1;
    }
  }
  return approve ? { approved: changed, withoutDraft, templateOnly } : { reverted: changed, withoutDraft: 0, templateOnly: 0 };
}
/** Je E-Mail-Schritt das jüngste echte Beispiel: so hat die KI die E-Mail für einen Kontakt tatsächlich geschrieben (für die Vorschau im Builder). */
export async function draftSamples(db: Db, tenantId: number, campaignId: number) {
  const rows = await db.select({ draftNodeId: emailCampaignRecipients.draftNodeId, draftSubject: emailCampaignRecipients.draftSubject, draftText: emailCampaignRecipients.draftText, draftApproach: emailCampaignRecipients.draftApproach, draftAt: emailCampaignRecipients.draftAt, name: emailCampaignRecipients.name, company: emailCampaignRecipients.company, email: emailCampaignRecipients.email }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaignId), isNotNull(emailCampaignRecipients.draftText))).orderBy(desc(emailCampaignRecipients.draftAt)).limit(400);
  const out = new Map<string, { nodeId: string; subject: string; text: string; name: string; approach: string | null; at: Date | null }>(); // je Schritt UND Ansatz das jüngste – der Builder zeigt nur Beispiele im gewählten Ansatz
  for (const row of rows) { const nodeId = row.draftNodeId ?? "__erste"; const key = `${nodeId}|${row.draftApproach ?? ""}`; if (out.has(key) || !row.draftText) continue; out.set(key, { nodeId, subject: row.draftSubject ?? "", text: row.draftText, name: row.name?.trim() || row.company?.trim() || row.email, approach: row.draftApproach ?? null, at: row.draftAt ?? null }); }
  return Array.from(out.values());
}
/** Alle noch nicht gesendeten Entwürfe einer Kampagne verwerfen (auch schon freigegebene) – die KI schreibt sie danach mit den aktuellen Regeln neu. */
export async function resetDrafts(db: Db, tenantId: number, campaignId: number) {
  const open = await db.select({ id: emailCampaignRecipients.id, draftState: emailCampaignRecipients.draftState }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaignId), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"])));
  const ids = open.filter((row) => row.draftState).map((row) => row.id);
  if (ids.length) await db.update(emailCampaignRecipients).set({ draftState: null, draftSubject: null, draftText: null, draftOptions: null, draftApproach: null, draftNodeId: null, draftSource: null, draftAt: null }).where(inArray(emailCampaignRecipients.id, ids));
  return { reset: ids.length };
}
/**
 * Ansatz der Kampagne geändert (z. B. Drittanbieter → frei): offene, noch nicht gesendete Entwürfe, die dem alten Ansatz (oder dem alten individuellen)
 * folgten, auf den neuen umstellen – mit dem gespeicherten KI-Vorschlag im neuen Ansatz, sonst verwerfen (die KI schreibt neu).
 * Selbst geschriebene Texte und bewusst anders gewählte Ansätze je Kontakt bleiben. Schon freigegebene Entwürfe im alten Ansatz
 * brauchen danach eine neue Freigabe (der Text ist ja ein anderer).
 */
export async function realignDrafts(db: Db, tenantId: number, campaignId: number, from: DraftApproach, to: DraftApproach) {
  if (from === to) return { switched: 0, cleared: 0 };
  const rows = await db.select({ id: emailCampaignRecipients.id, draftState: emailCampaignRecipients.draftState, draftApproach: emailCampaignRecipients.draftApproach, draftOptions: emailCampaignRecipients.draftOptions, draftSource: emailCampaignRecipients.draftSource }).from(emailCampaignRecipients)
    .where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaignId), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]), isNotNull(emailCampaignRecipients.draftState)));
  let switched = 0; let cleared = 0;
  for (const row of rows) {
    if (((row.draftApproach || from) !== from && row.draftApproach !== LEGACY_APPROACH) || row.draftSource === "hand") continue;
    const target = storedOptionFor(row, to);
    if (target) { await db.update(emailCampaignRecipients).set({ draftSubject: target.option.subject, draftText: target.option.text, draftApproach: to, draftSource: target.source, draftState: "entwurf", draftOptions: withoutLegacyOptions(row.draftOptions), draftAt: new Date() }).where(eq(emailCampaignRecipients.id, row.id)); switched += 1; }
    else { await db.update(emailCampaignRecipients).set({ draftState: null, draftSubject: null, draftText: null, draftOptions: null, draftApproach: null, draftNodeId: null, draftSource: null, draftAt: null }).where(eq(emailCampaignRecipients.id, row.id)); cleared += 1; }
  }
  return { switched, cleared };
}
/**
 * Gespeicherter Vorschlag im Ansatz `key`, der zum Haupt-Entwurf werden kann – samt der passenden Herkunft: Vorlage bleibt Vorlage
 * (geht nie per „Alle freigeben“ oder im Auto-Modus raus), ein KI-Text in einem KI-Entwurf bleibt KI. Ein KI-Vorschlag in einem
 * Entwurf, der selbst nur die Vorlage war, wird nicht übernommen – dann lieber neu schreiben lassen. `null` = neu schreiben lassen.
 */
function storedOptionFor(row: { draftOptions: unknown; draftSource: string | null }, key: DraftApproach): { option: DraftOption; source: string } | null {
  const option = Array.isArray(row.draftOptions) ? (row.draftOptions as DraftOption[]).find((item) => item?.key === key && item.subject?.trim() && (item.text ?? "").trim().length > 40) : null;
  if (!option) return null;
  const optionSource = option.source ?? (row.draftSource === "vorlage" ? "vorlage" : "ki");
  if (optionSource === "vorlage") return { option, source: "vorlage" };
  return row.draftSource === "ki" || row.draftSource === "kiweb" ? { option, source: row.draftSource } : null;
}
/** Gespeicherte Vorschläge ohne den alten individuellen Ansatz. */
function withoutLegacyOptions(options: unknown): DraftOption[] | null {
  return Array.isArray(options) ? (options as DraftOption[]).filter((item) => Boolean(approachOf(item?.key))) : null;
}
/**
 * Den individuellen Ansatz gibt es nicht mehr – nur noch Drittanbieter und den freien Vorschlag. Einmal nach dem Serverstart
 * (und vor dem Anzeigen unter „Freigeben“): Kampagnen mit „individuell“ stehen danach auf „frei“. Offene, noch nicht gesendete
 * Entwürfe im individuellen Ansatz – auch schon freigegebene – wechseln auf den gespeicherten KI-Vorschlag im Ansatz ihrer Kampagne
 * (dann wieder „zu prüfen“), sonst werden sie verworfen und die KI schreibt sie neu. Selbst geschriebene Texte bleiben, nur die
 * Angabe des Ansatzes wechselt. Alte individuelle Vorschläge verschwinden aus den Alternativen. Mehrfach ausführbar ohne Nebenwirkung.
 */
export async function retireIndividualApproach(db: Db, only?: { tenantId: number; campaignId: number }): Promise<{ campaigns: number; switched: number; cleared: number }> {
  const scope = only ? and(eq(emailCampaigns.id, only.campaignId), eq(emailCampaigns.tenantId, only.tenantId)) : undefined;
  // Reihenfolge der Kampagnen bleibt: „updatedAt“ ausdrücklich auf sich selbst setzen, sonst stellt MySQL die Zeit auf jetzt
  const moved = await db.update(emailCampaigns).set({ kiAnsatz: "frei", updatedAt: sql`${emailCampaigns.updatedAt}` }).where(scope ? and(scope, eq(emailCampaigns.kiAnsatz, LEGACY_APPROACH)) : eq(emailCampaigns.kiAnsatz, LEGACY_APPROACH));
  const legacy = or(eq(emailCampaignRecipients.draftApproach, LEGACY_APPROACH), sql`cast(${emailCampaignRecipients.draftOptions} as char) like ${`%"${LEGACY_APPROACH}"%`}`); // Vorauswahl – entschieden wird unten genau
  const rows = await db.select({ id: emailCampaignRecipients.id, campaignId: emailCampaignRecipients.campaignId, draftApproach: emailCampaignRecipients.draftApproach, draftOptions: emailCampaignRecipients.draftOptions, draftSource: emailCampaignRecipients.draftSource }).from(emailCampaignRecipients)
    .where(and(...(only ? [eq(emailCampaignRecipients.tenantId, only.tenantId), eq(emailCampaignRecipients.campaignId, only.campaignId)] : []), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]), isNotNull(emailCampaignRecipients.draftState), legacy));
  const campaignIds = Array.from(new Set(rows.map((row) => row.campaignId)));
  const approachOfCampaign = new Map(campaignIds.length ? (await db.select({ id: emailCampaigns.id, kiAnsatz: emailCampaigns.kiAnsatz }).from(emailCampaigns).where(inArray(emailCampaigns.id, campaignIds))).map((row) => [row.id, kiAnsatzOf(row)] as const) : []);
  let switched = 0; let cleared = 0;
  for (const row of rows) {
    const approach = approachOfCampaign.get(row.campaignId) ?? "frei";
    const kept = withoutLegacyOptions(row.draftOptions); const hadLegacyOption = Array.isArray(row.draftOptions) && kept!.length !== (row.draftOptions as unknown[]).length;
    if (row.draftApproach !== LEGACY_APPROACH) { if (hadLegacyOption) await db.update(emailCampaignRecipients).set({ draftOptions: kept }).where(eq(emailCampaignRecipients.id, row.id)); continue; } // nur die alte Alternative weg
    if (row.draftSource === "hand") { await db.update(emailCampaignRecipients).set({ draftApproach: approach, draftOptions: kept }).where(eq(emailCampaignRecipients.id, row.id)); continue; } // eigener Text bleibt
    const target = storedOptionFor(row, approach);
    if (target) { await db.update(emailCampaignRecipients).set({ draftSubject: target.option.subject, draftText: target.option.text, draftApproach: approach, draftSource: target.source, draftOptions: kept, draftState: "entwurf", draftAt: new Date() }).where(eq(emailCampaignRecipients.id, row.id)); switched += 1; }
    else { await db.update(emailCampaignRecipients).set({ draftState: null, draftSubject: null, draftText: null, draftOptions: null, draftApproach: null, draftNodeId: null, draftSource: null, draftAt: null }).where(eq(emailCampaignRecipients.id, row.id)); cleared += 1; }
  }
  return { campaigns: Number((moved as unknown as [{ affectedRows?: number }])?.[0]?.affectedRows ?? 0), switched, cleared };
}
/**
 * Einmal nach dem Serverstart: ältere Entwürfe (vor dieser Version geschrieben), die nicht im Ansatz ihrer Kampagne stehen –
 * weil die KI den gewählten Ansatz ausgelassen hatte oder der Ansatz später umgestellt wurde –, auf den gespeicherten Vorschlag
 * im richtigen Ansatz umstellen. Nur offene, noch nicht freigegebene, nicht selbst geschriebene Entwürfe; der bisherige Text
 * bleibt als Alternative wählbar. Mehrfach ausführbar ohne Nebenwirkung.
 */
const ALIGN_DRAFTS_BEFORE = new Date("2026-10-28T10:30:00Z");
export async function alignStoredDrafts(db: Db, before = ALIGN_DRAFTS_BEFORE): Promise<number> {
  const campaigns = (await db.select({ id: emailCampaigns.id, kiModus: emailCampaigns.kiModus, reviewFirst: emailCampaigns.reviewFirst, kiAnsatz: emailCampaigns.kiAnsatz, isTemplate: emailCampaigns.isTemplate }).from(emailCampaigns).where(isNull(emailCampaigns.archivedAt))).filter((row) => !row.isTemplate && kiModusOf(row) !== "aus");
  let switched = 0;
  for (const campaign of campaigns) {
    const approach = kiAnsatzOf(campaign);
    const rows = await db.select({ id: emailCampaignRecipients.id, draftApproach: emailCampaignRecipients.draftApproach, draftOptions: emailCampaignRecipients.draftOptions, draftSource: emailCampaignRecipients.draftSource }).from(emailCampaignRecipients)
      .where(and(eq(emailCampaignRecipients.campaignId, campaign.id), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]), eq(emailCampaignRecipients.draftState, "entwurf"), lt(emailCampaignRecipients.draftAt, before)));
    for (const row of rows) {
      if (row.draftSource === "hand" || (row.draftApproach || approach) === approach) continue;
      const option = Array.isArray(row.draftOptions) ? (row.draftOptions as DraftOption[]).find((item) => item?.key === approach && item.subject?.trim() && (item.text ?? "").trim().length > 40) : null;
      if (!option) continue; // nichts Passendes gespeichert – bleibt, „Alle neu schreiben“ schreibt im richtigen Ansatz
      await db.update(emailCampaignRecipients).set({ draftSubject: option.subject, draftText: option.text, draftApproach: approach }).where(eq(emailCampaignRecipients.id, row.id)); switched += 1;
    }
  }
  return switched;
}
/**
 * Einmal nach dem Serverstart: Entwürfe, die noch mit der alten Anweisung (immer PV & WP) geschrieben wurden, in Kampagnen einer
 * anderen Leadsparte verwerfen – z. B. Wärmepumpen-Texte an Hausnotruf-Firmen. Die KI schreibt sie im richtigen Thema neu (mit
 * Freigabe: neu freigeben). Selbst geschriebene Texte bleiben. Mehrfach ausführbar ohne Nebenwirkung.
 */
export async function clearWrongSparteDrafts(db: Db): Promise<number> {
  const campaigns = (await db.select({ id: emailCampaigns.id, name: emailCampaigns.name, leadSparte: emailCampaigns.leadSparte, audience: emailCampaigns.audience, isTemplate: emailCampaigns.isTemplate }).from(emailCampaigns).where(isNull(emailCampaigns.archivedAt))).filter((row) => !row.isTemplate);
  let cleared = 0;
  for (const campaign of campaigns) {
    const sparte = sparteOfCampaign(campaign); if (isEnergySparte(sparte)) continue;
    const rows = await db.select({ id: emailCampaignRecipients.id, draftSubject: emailCampaignRecipients.draftSubject, draftText: emailCampaignRecipients.draftText, draftSource: emailCampaignRecipients.draftSource }).from(emailCampaignRecipients)
      .where(and(eq(emailCampaignRecipients.campaignId, campaign.id), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]), isNotNull(emailCampaignRecipients.draftState)));
    for (const row of rows) {
      if (row.draftSource === "hand" || fitsSparte(sparte, `${row.draftSubject ?? ""}\n${row.draftText ?? ""}`)) continue;
      await db.update(emailCampaignRecipients).set({ draftState: null, draftSubject: null, draftText: null, draftOptions: null, draftApproach: null, draftNodeId: null, draftSource: null, draftAt: null }).where(eq(emailCampaignRecipients.id, row.id)); cleared += 1;
    }
  }
  return cleared;
}
/**
 * Einmal nach dem Serverstart: offene Erst-E-Mail-Entwürfe im freien Vorschlag in PV- & WP-Kampagnen bekommen den Satz
 * „Sie zahlen dabei nur für Leads, die wirklich zu Ihnen passen.“ (wie neue Entwürfe). Freigegebene und selbst geschriebene
 * Texte bleiben unverändert. Mehrfach ausführbar ohne Nebenwirkung.
 */
export async function addPayFitToDrafts(db: Db): Promise<number> {
  const campaigns = (await db.select({ id: emailCampaigns.id, name: emailCampaigns.name, leadSparte: emailCampaigns.leadSparte, audience: emailCampaigns.audience, isTemplate: emailCampaigns.isTemplate, kiAnsatz: emailCampaigns.kiAnsatz }).from(emailCampaigns).where(isNull(emailCampaigns.archivedAt))).filter((row) => !row.isTemplate);
  let changed = 0;
  for (const campaign of campaigns) {
    const sparte = sparteOfCampaign(campaign); if (!paysOnlyFitting(sparte)) continue;
    const rows = await db.select({ id: emailCampaignRecipients.id, draftText: emailCampaignRecipients.draftText, draftOptions: emailCampaignRecipients.draftOptions, draftApproach: emailCampaignRecipients.draftApproach, draftSource: emailCampaignRecipients.draftSource }).from(emailCampaignRecipients)
      .where(and(eq(emailCampaignRecipients.campaignId, campaign.id), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]), eq(emailCampaignRecipients.draftState, "entwurf"), eq(emailCampaignRecipients.sentCount, 0)));
    for (const row of rows) {
      if (row.draftSource === "hand" || (row.draftApproach || kiAnsatzOf(campaign)) !== "frei" || !row.draftText) continue;
      const text = applyPayFit(row.draftText, { sparte, approach: "frei" }); if (text === row.draftText) continue;
      const options = Array.isArray(row.draftOptions) ? (row.draftOptions as DraftOption[]).map((item) => item?.key === "frei" && item.text ? { ...item, text: applyPayFit(item.text, { sparte, approach: "frei" }) } : item) : row.draftOptions;
      await db.update(emailCampaignRecipients).set({ draftText: text, draftOptions: options as DraftOption[] | null }).where(eq(emailCampaignRecipients.id, row.id)); changed += 1;
    }
  }
  return changed;
}
/**
 * Einmal nach dem Serverstart: Zahl der Fragen passend zur Leadsparte, dahinter ohne Klammern „Abgefragt werden beispielsweise … usw.“
 * (Hausnotruf: die Krankenkasse, der Pflegegrad, die Wohnsituation …) und die Logik-Kette „Der Interessent weiß danach, dass sich ein Fachbetrieb
 * bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet also auf Ihren Anruf.“ – in den Vorlagen aller Kampagnen (die Zahl der Fragen
 * nur bei eingetragener oder erkannter Sparte) und in allen offenen, noch nicht gesendeten Entwürfen (auch freigegebenen). Dabei auch: nie Meta & Co. („online“), kurze Absätze. Hausnotruf und Elektrorollstuhl
 * sechs Fragen, Alarmanlage acht, PV & WP zehn, andere Sparten ohne feste Zahl („anhand gezielter Fragen“). Mehrfach ausführbar.
 */
export async function fixQuestionCounts(db: Db): Promise<{ campaigns: number; drafts: number }> {
  const campaigns = await db.select({ id: emailCampaigns.id, name: emailCampaigns.name, leadSparte: emailCampaigns.leadSparte, audience: emailCampaigns.audience, tree: emailCampaigns.tree, updatedAt: emailCampaigns.updatedAt }).from(emailCampaigns).where(isNull(emailCampaigns.archivedAt));
  let fixedCampaigns = 0; let fixedDrafts = 0;
  for (const campaign of campaigns) {
    const sparte = sparteOfCampaign(campaign); const known = sparte.source !== "standard"; // Vorlagen nur bei eingetragener/erkannter Sparte – KI-Entwürfe sind immer für die Sparte der Kampagne geschrieben
    const tree = campaign.tree ? fixTreeQuestions(campaign.tree as EmailTree, sparte, { counts: known }) : null; // Beispiele und Kette in allen Kampagnen – die Zahl der Fragen nur bei gewählter/erkannter Sparte
    if (tree) { await db.update(emailCampaigns).set({ tree, updatedAt: campaign.updatedAt }).where(eq(emailCampaigns.id, campaign.id)); fixedCampaigns += 1; } // Reihenfolge der Kampagnen bleibt
    const rows = await db.select({ id: emailCampaignRecipients.id, draftText: emailCampaignRecipients.draftText, draftOptions: emailCampaignRecipients.draftOptions }).from(emailCampaignRecipients)
      .where(and(eq(emailCampaignRecipients.campaignId, campaign.id), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]), isNotNull(emailCampaignRecipients.draftState)));
    // nie Meta & Co. („online“), kurze Absätze, Zahl der Fragen mit Beispielen ohne Klammern und der Logik-Kette
    const refresh = (text: string) => shortParagraphs(withQuestionTopics(fixQuestionCount(cleanDraftText(text), sparte), sparte));
    for (const row of rows) {
      const text = row.draftText ? refresh(row.draftText) : row.draftText;
      const options = Array.isArray(row.draftOptions) ? (row.draftOptions as DraftOption[]).map((item) => item?.text ? { ...item, ...(item.subject ? { subject: dropAdPlatforms(item.subject) } : {}), text: refresh(item.text) } : item) : row.draftOptions;
      if (text === row.draftText && JSON.stringify(options) === JSON.stringify(row.draftOptions)) continue;
      await db.update(emailCampaignRecipients).set({ draftText: text, draftOptions: options as DraftOption[] | null }).where(eq(emailCampaignRecipients.id, row.id)); fixedDrafts += 1;
    }
  }
  return { campaigns: fixedCampaigns, drafts: fixedDrafts };
}
/**
 * Einmal nach dem Serverstart: offene Entwürfe, die nur der „Ersatz aus der Vorlage“ sind (die KI-Prüfung hatte den KI-Text früher
 * fälschlich verworfen), verwerfen – die KI schreibt sie mit den neuen Regeln neu (Webseite, Impressum, Anrede). Nur Kampagnen mit
 * KI-Versand, nur nicht freigegebene Entwürfe, nur wenn die KI eingerichtet ist. Mehrfach ausführbar.
 */
export async function clearTemplateFallbackDrafts(db: Db): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) return 0;
  const campaigns = (await db.select({ id: emailCampaigns.id, kiModus: emailCampaigns.kiModus, reviewFirst: emailCampaigns.reviewFirst, isTemplate: emailCampaigns.isTemplate }).from(emailCampaigns).where(isNull(emailCampaigns.archivedAt))).filter((row) => !row.isTemplate && kiModusOf(row) !== "aus");
  let cleared = 0;
  for (const campaign of campaigns) {
    const result = await db.update(emailCampaignRecipients).set({ draftState: null, draftSubject: null, draftText: null, draftOptions: null, draftApproach: null, draftNodeId: null, draftSource: null, draftAt: null })
      .where(and(eq(emailCampaignRecipients.campaignId, campaign.id), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]), eq(emailCampaignRecipients.draftState, "entwurf"), eq(emailCampaignRecipients.draftSource, "vorlage")));
    cleared += Number((result as unknown as [{ affectedRows?: number }])?.[0]?.affectedRows ?? 0);
  }
  return cleared;
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
/**
 * Gespeicherte Entwürfe säubern: Aroundhome (auch „Around Home“) kommt nirgends vor – nicht im Text, nicht im Betreff,
 * nicht in den Alternativ-Vorschlägen. Steht es im Betreff, wird der Entwurf verworfen und neu geschrieben.
 * Dazu die geglättete Formulierung zur Vorqualifizierung. Gibt zurück, wie viele Entwürfe geändert/verworfen wurden.
 */
export async function cleanStoredDrafts(db: Db, tenantId: number, campaignId?: number | null): Promise<{ cleaned: number; reset: number }> {
  const hit = or(sql`${emailCampaignRecipients.draftText} like '%über%Fragen%'`, sql`lower(${emailCampaignRecipients.draftText}) like '%round%home%'`, sql`lower(${emailCampaignRecipients.draftSubject}) like '%round%home%'`, sql`lower(cast(${emailCampaignRecipients.draftOptions} as char)) like '%round%home%'`, sql`cast(${emailCampaignRecipients.draftOptions} as char) like '%über%Fragen%'`);
  const rows = await db.select({ id: emailCampaignRecipients.id, draftText: emailCampaignRecipients.draftText, draftSubject: emailCampaignRecipients.draftSubject, draftOptions: emailCampaignRecipients.draftOptions }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), ...(campaignId ? [eq(emailCampaignRecipients.campaignId, campaignId)] : []), hit));
  let cleaned = 0; let reset = 0;
  for (const row of rows) {
    if (PORTAL_RE.test(row.draftSubject ?? "")) { await db.update(emailCampaignRecipients).set({ draftState: null, draftSubject: null, draftText: null, draftOptions: null, draftNodeId: null }).where(eq(emailCampaignRecipients.id, row.id)); reset += 1; continue; } // Betreff mit Portal-Namen → neu schreiben lassen
    const text = row.draftText ? cleanDraftText(row.draftText) : row.draftText;
    const options = Array.isArray(row.draftOptions) ? (row.draftOptions as DraftOption[]).filter((option) => !PORTAL_RE.test(option.subject ?? "")).map((option) => ({ ...option, text: cleanDraftText(option.text ?? "") })) : row.draftOptions;
    if (text !== row.draftText || JSON.stringify(options) !== JSON.stringify(row.draftOptions)) { await db.update(emailCampaignRecipients).set({ draftText: text, draftOptions: options as DraftOption[] | null }).where(eq(emailCampaignRecipients.id, row.id)); cleaned += 1; }
  }
  return { cleaned, reset };
}
const mentionsPortal = (item: { draftSubject?: string | null; draftText?: string | null; draftOptions?: unknown }) => PORTAL_RE.test(item.draftSubject ?? "") || PORTAL_RE.test(item.draftText ?? "") || (Array.isArray(item.draftOptions) && (item.draftOptions as DraftOption[]).some((option) => PORTAL_RE.test(`${option.subject ?? ""} ${option.text ?? ""}`)));

export async function reviewQueue(db: Db, tenantId: number, campaignId: number) {
  const repaired = await cleanStoredDrafts(db, tenantId, campaignId).catch(() => ({ cleaned: 0, reset: 0 })); // vor dem Anzeigen: nichts mit Aroundhome
  await retireIndividualApproach(db, { tenantId, campaignId }).catch(() => null); // und nichts mehr im alten individuellen Ansatz
  const campaign = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0]; if (!campaign) throw new Error("Kampagne nicht gefunden.");
  const tree = (campaign.tree ?? { start: null, nodes: [] }) as EmailTree;
  const all = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, campaignId), inArray(emailCampaignRecipients.status, ["wartet", "laeuft"]))).orderBy(asc(emailCampaignRecipients.id));
  const rows = all.map((row) => { const node = dueSendNode(tree, row); return node && (row.nodeId === node.id || row.sentCount === 0) ? { row, node } : null; }).filter((item): item is { row: Recipient; node: Extract<EmailNode, { type: "send" }> } => Boolean(item));
  const leadIds = Array.from(new Set(rows.map(({ row }) => row.leadId).filter((id): id is number => typeof id === "number")));
  const leadRows = leadIds.length ? await db.select({ id: leads.id, publicId: leads.publicId, city: leads.city, listName: leads.listName, company: leads.company, firstName: leads.firstName, lastName: leads.lastName, metadata: leads.metadata }).from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, leadIds))) : [];
  const items = rows.map(({ row, node }) => { const lead = leadRows.find((item) => item.id === row.leadId) ?? null; const fits = draftFitsNode(row, node.id); return { id: row.id, email: row.email, name: row.name, company: row.company ?? lead?.company ?? null, city: lead?.city ?? null, listName: lead?.listName ?? null, publicId: lead?.publicId ?? null, website: websiteOf(lead?.metadata, row.email), nodeId: node.id, nodeLabel: node.label?.trim() || node.subject, followUp: row.sentCount > 0, draftSubject: fits ? row.draftSubject : null, draftText: fits ? row.draftText : null, draftOptions: (fits ? withoutLegacyOptions(row.draftOptions) ?? [] : []) as DraftOption[], draftApproach: fits ? approachOf(row.draftApproach) : null, draftState: (fits ? row.draftState || null : null) as "entwurf" | "freigegeben" | null, draftSource: fits ? row.draftSource : null, draftAt: fits ? row.draftAt : null }; });
  const withDraft = items.filter((item) => item.draftText);
  return { items, counts: { offen: items.filter((item) => !item.draftState).length, entwurf: items.filter((item) => item.draftState === "entwurf").length, freigegeben: items.filter((item) => item.draftState === "freigegeben").length }, portalCheck: { checked: withDraft.length, found: withDraft.filter(mentionsPortal).length, cleaned: repaired.cleaned, reset: repaired.reset } };
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
  await db.update(emailCampaignRecipients).set({ draftSubject: subject || null, draftText: text || null, draftNodeId: node.id, draftState: input.approve ? "freigegeben" : "entwurf", draftSource: subject !== (recipient.draftSubject ?? "").trim() || text !== (recipient.draftText ?? "").trim() ? "hand" : recipient.draftSource ?? "hand", ...(input.approach ? { draftApproach: input.approach } : {}), draftAt: new Date(), ...(input.approve && recipient.nodeId === node.id ? { nextActionAt: new Date(Date.now() - 2000) } : {}) }).where(eq(emailCampaignRecipients.id, recipient.id));
  return { id: recipient.id, draftState: input.approve ? "freigegeben" as const : "entwurf" as const };
}
