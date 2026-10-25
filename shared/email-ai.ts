/**
 * KI-Vorlagen-Builder für E-Mails: aus einer Beschreibung („Welche E-Mail brauchst du?“) entsteht eine fertige E-Mail
 * (Betreff, Vorschautext, Bausteine) oder eine ganze Serie (Ablauf-Baum). Mit KI-Schlüssel schreibt die KI den Text,
 * ohne Schlüssel liefert der regelbasierte Entwurf eine brauchbare Vorlage. Gemeinsam für Server, Chat-Demo und Oberfläche.
 */
import { newNodeId, type EmailNode, type EmailTree } from "./email-campaigns";
import { newBlockId, type EmailBlock } from "./email-design";

export type EmailGoal = "termin" | "rueckruf" | "angebot" | "info" | "reaktivierung" | "willkommen" | "frei";
export type EmailTone = "freundlich" | "sachlich" | "locker" | "dringend";
export type EmailLength = "kurz" | "mittel" | "lang";
export type EmailBrief = { brief: string; goal?: EmailGoal; tone?: EmailTone; length?: EmailLength; audience?: string | null; category?: string | null; company?: string | null; sender?: string | null; ctaText?: string | null; ctaUrl?: string | null; abTest?: boolean };
export type EmailDraft = { label: string; subject: string; subjectB: string | null; preheader: string; blocks: EmailBlock[]; notes?: string | null };
export type SeriesBrief = EmailBrief & { count?: number; waitDays?: number; stopWhen?: "replied" | "clicked" | "opened" | "never" };
export type SeriesDraft = { name: string; mails: EmailDraft[]; waitDays: number; stopWhen: "replied" | "clicked" | "opened" | "never" };
export type DraftSource = "ki" | "vorlage";

export const GOALS: Array<{ key: EmailGoal; label: string; hint: string }> = [
  { key: "termin", label: "Termin bekommen", hint: "Erstgespräch oder Vor-Ort-Termin vorschlagen" },
  { key: "rueckruf", label: "Rückruf", hint: "Um einen Rückruf oder eine kurze Antwort bitten" },
  { key: "angebot", label: "Angebot nachfassen", hint: "Nach dem Angebot freundlich nachhaken" },
  { key: "info", label: "Infos schicken", hint: "Unterlagen, Vorteile, Ablauf erklären" },
  { key: "reaktivierung", label: "Aufwecken", hint: "Eingeschlafene Kontakte wieder ansprechen" },
  { key: "willkommen", label: "Willkommen", hint: "Nach Anfrage oder Kauf begrüßen" },
  { key: "frei", label: "Frei", hint: "Nur die Beschreibung zählt" },
];
export const TONES: Array<{ key: EmailTone; label: string }> = [{ key: "freundlich", label: "Freundlich" }, { key: "sachlich", label: "Sachlich" }, { key: "locker", label: "Locker" }, { key: "dringend", label: "Dringend" }];
export const LENGTHS: Array<{ key: EmailLength; label: string }> = [{ key: "kurz", label: "Kurz" }, { key: "mittel", label: "Mittel" }, { key: "lang", label: "Ausführlich" }];
export const DEFAULT_CTA_URL = "https://tanesco.digital/termin";

/* ---------------------------------------------------------------- Vorlagen-Vorschläge */
/** Fertige Vorschläge, die der Builder „vorschreibt“: ein Klick → E-Mail oder ganze Serie, optional auf eine Lead-Kategorie zugeschnitten. */
export type TemplateProposal = { key: string; name: string; hint: string; brief: string; goal: EmailGoal; tone: EmailTone; length: EmailLength; kind: "einzeln" | "serie"; count?: number; waitDays?: number; stopWhen?: "replied" | "clicked" | "opened" | "never"; stage?: string | null; abTest?: boolean };
export const TEMPLATE_PROPOSALS: TemplateProposal[] = [
  { key: "erstkontakt", name: "Erstkontakt Kaltakquise", hint: "3 E-Mails: Vorstellung, Nachfassen, letzte Nachricht", brief: "Erstkontakt für Fachbetriebe: wir liefern geprüfte Kundenanfragen aus der Region, ohne Risiko und ohne Vertragsbindung – kurzes Gespräch anbieten", goal: "termin", tone: "freundlich", length: "mittel", kind: "serie", count: 3, waitDays: 3, stopWhen: "replied", abTest: true },
  { key: "angebot", name: "Nachfassen nach Angebot", hint: "2 E-Mails nach dem Angebot, Ende sobald geantwortet", brief: "Nachfassen nach Angebot: freundlich an das Angebot erinnern, offene Fragen klären, kurzes Telefonat vorschlagen", goal: "angebot", tone: "freundlich", length: "kurz", kind: "serie", count: 2, waitDays: 4, stopWhen: "replied", stage: "angebot" },
  { key: "aufwecken", name: "Eingeschlafene Kontakte aufwecken", hint: "2 kurze E-Mails für Karten ohne Bewegung", brief: "Kontakte, die seit Wochen nicht reagieren, kurz und locker aufwecken, Interesse abfragen, Ausstieg anbieten", goal: "reaktivierung", tone: "locker", length: "kurz", kind: "serie", count: 2, waitDays: 5, stopWhen: "replied" },
  { key: "termin", name: "Termin vereinbaren", hint: "1 E-Mail: kurzes Erstgespräch vorschlagen", brief: "Kurzes Erstgespräch anbieten: 15 Minuten, online oder vor Ort, konkrete Einschätzung, keine Verpflichtung", goal: "termin", tone: "freundlich", length: "mittel", kind: "einzeln", abTest: true },
  { key: "willkommen", name: "Willkommen nach Anfrage", hint: "1 E-Mail: Danke, nächste Schritte, Ansprechpartner", brief: "Willkommensmail nach einer Anfrage: bedanken, erklären wie es weitergeht, festen Ansprechpartner nennen", goal: "willkommen", tone: "freundlich", length: "mittel", kind: "einzeln", stage: "neu" },
  { key: "rueckruf", name: "Rückruf-Bitte", hint: "1 E-Mail: nicht erreicht – wann passt ein Rückruf?", brief: "Wir haben versucht anzurufen und niemanden erreicht: um einen Rückruf oder eine Wunschzeit bitten", goal: "rueckruf", tone: "freundlich", length: "kurz", kind: "einzeln" },
  { key: "info", name: "Infos & Unterlagen", hint: "1 E-Mail: Ablauf, Qualität der Anfragen, nächste Schritte", brief: "Unterlagen zur Zusammenarbeit schicken: wie die Anfragen entstehen, Ablauf von Anfrage bis Termin, Qualitätsprüfung, nächste Schritte", goal: "info", tone: "sachlich", length: "lang", kind: "einzeln" },
  { key: "letzte", name: "Letzte Nachricht", hint: "1 E-Mail: freundlicher Abschluss, Tür bleibt offen", brief: "Freundliche letzte Nachricht vor dem Abschluss: kein Druck, Tür offen lassen, einfache Antwortmöglichkeit", goal: "reaktivierung", tone: "freundlich", length: "kurz", kind: "einzeln" },
];
/** Name der Vorlage, z. B. „Vorlage: Erstkontakt Kaltakquise – Photovoltaik“. */
export const templateName = (proposal: TemplateProposal, category?: string | null) => `Vorlage: ${proposal.name}${category?.trim() ? ` – ${category.trim()}` : ""}`.slice(0, 160);
/** Brief + Einstellungen eines Vorschlags als Auftrag für den Builder. */
export const proposalBrief = (proposal: TemplateProposal, category?: string | null): SeriesBrief => ({ brief: proposal.brief, goal: proposal.goal, tone: proposal.tone, length: proposal.length, category: category?.trim() || null, abTest: Boolean(proposal.abTest), count: proposal.count, waitDays: proposal.waitDays, stopWhen: proposal.stopWhen });
/** Einzelne E-Mail → kleiner Ablauf (senden → Ende). */
export function singleToTree(draft: EmailDraft): EmailTree { const end = newNodeId(); const send = draftToNode(draft); send.next = end; return { start: send.id, nodes: [send, { id: end, type: "end", label: "Ende" }] }; }
export const PLACEHOLDERS_HINT = "{{anrede}} {{nachname}} {{vorname}} {{firma}} {{stadt}} {{abmelden}}";

/** Ziel aus der Beschreibung erraten, wenn keins gewählt ist. */
export function guessGoal(brief: string): EmailGoal {
  const text = brief.toLowerCase();
  if (/angebot|offerte|nachfass|nachhaken|preis/.test(text)) return "angebot";
  if (/termin|besichtigung|vor-ort|vor ort|erstgespräch|beratung|erstkontakt|kaltakquise|vorstellen|neukunden|kennenlern|einlad|probe/.test(text)) return "termin";
  if (/rückruf|rueckruf|zurückruf|anrufen|telefon/.test(text)) return "rueckruf";
  if (/aufweck|eingeschlafen|lange nichts|reaktiv|wieder melden|kein kontakt/.test(text)) return "reaktivierung";
  if (/willkommen|begrüß|begruess|danke für|dank für ihre anfrage/.test(text)) return "willkommen";
  if (/info|unterlagen|vorteile|erklär|broschüre|förder|ablauf/.test(text)) return "info";
  return "frei";
}
/** Das Thema/die Zielgruppe aus der Beschreibung ziehen – nur hinter „für/an/zu/über/wegen/bei“ („Nachfass-Mail nach Angebot für Dachdecker“ → „Dachdecker“). */
function topicOf(brief: string) { const clause = brief.split(/[:;,–]|\s-\s/)[0] ?? ""; const marker = clause.match(/\b(?:für|an|zu|zum|zur|über|wegen|bei)\s+(.+)$/i); if (!marker) return ""; const cleaned = marker[1].replace(/(^|\s)[-/](?=\s|$)/g, " ").replace(/\b(bitte|eine|einen|ein|e ?mail|mail|schreib(e|en)?|erstell(e|en)?|brauche|ich|wir|möchte|will|soll|die|der|das|mit|an|zu|und|für|freundlich(e)?|sachlich(e)?|locker(e)?|kurz(e)?|lang(e)?|erstkontakt|erstansprache|nachfass\w*|nachhaken|aufweck\w*|willkommens?\w*|rückruf|termin\w*|angebot\w*|infos?|unterlagen|serie|kampagne|anbieten|schicken|senden|nach|dem|den|wegen|anfrage|kontakte?|leads?|kunden|empfänger|interessenten)\b/gi, " ").replace(/(^|\s)[-/–](?=\s|$)/g, " ").replace(/\s+/g, " ").trim(); if (cleaned.length <= 3) return ""; const words = cleaned.split(" "); if (words.length > 4 || /\b(nicht|kein|seit|die|der|das|dass|wenn)\b/i.test(cleaned) || /^[a-zäöü]\S*(en|ern|eln)$/.test(words[words.length - 1])) return ""; return cleaned.charAt(0).toUpperCase() + cleaned.slice(1); }
const sentence = (text: string) => (text && !/[.!?]$/.test(text) ? `${text}.` : text);
const greeting = (_tone: EmailTone) => "{{begruessung}},"; // immer förmlich: „Sehr geehrte Frau …“ / „Sehr geehrter Herr …“ / „Sehr geehrte Damen und Herren“ – nie „Hallo“
const closing = (_tone: EmailTone, _sender: string) => "Wenn das für Sie interessant ist, {{kontaktweg}}.\n\nVielen Dank"; // klarer Schluss: antworten oder anrufen (Nummer aus der Signatur) – Gruß und Name bringt die Signatur mit

/** Regelbasierter Entwurf (ohne KI): je Ziel ein Gerüst, Ton und Länge steuern Anrede, Textmenge und Aufzählung. */
export function heuristicEmailDraft(input: EmailBrief): EmailDraft {
  const goal = input.goal && input.goal !== "frei" ? input.goal : guessGoal(input.brief);
  const tone = input.tone ?? "freundlich"; const length = input.length ?? "mittel";
  const company = input.company?.trim() || "Tanesco Digital"; const sender = input.sender?.trim() || `Ihr Team von ${company}`;
  const topic = topicOf(input.brief); const own = !input.category?.trim(); const category = input.category?.trim() || "unser Angebot"; const categoryDative = own ? "unserem Angebot" : category; const audience = input.audience?.trim() || topic || ""; const about = own && topic ? topic : category;
  const cta = { text: input.ctaText?.trim() || (goal === "termin" ? "Termin vorschlagen" : goal === "rueckruf" ? "Rückruf vereinbaren" : goal === "angebot" ? "Angebot besprechen" : goal === "info" ? "Unterlagen ansehen" : goal === "reaktivierung" ? "Kurz Rückmeldung geben" : goal === "willkommen" ? "Nächsten Schritt wählen" : "Mehr erfahren"), url: input.ctaUrl?.trim() || DEFAULT_CTA_URL };
  const urgency = tone === "dringend" ? " Die nächsten Termine sind schnell vergeben – ein kurzer Hinweis genügt." : "";
  const scaffolds: Record<Exclude<EmailGoal, "frei">, { subject: string; subjectB: string; preheader: string; heading: string; intro: string; body: string; bullets: string[] }> = {
    termin: { subject: `Kurzer Termin zu ${categoryDative}, {{vorname}}?`, subjectB: `15 Minuten für ${category} – wann passt es Ihnen?`, preheader: "Unverbindliches Erstgespräch, 15 Minuten, online oder vor Ort.", heading: `Lassen Sie uns kurz über ${category} sprechen`, intro: `ich melde mich, weil wir ${audience ? `${audience} ` : "Betriebe in Ihrer Region "}gerade sehr gezielt bei ${own ? "neuen Kundenanfragen" : category} unterstützen.`, body: `In einem kurzen Gespräch zeige ich Ihnen, was für {{firma}} konkret möglich ist – ohne Verpflichtung.${urgency}`, bullets: ["15 Minuten, online oder vor Ort", "Konkrete Einschätzung für Ihre Situation", "Kein Risiko, keine Verpflichtung"] },
    rueckruf: { subject: `Kurze Rückfrage, {{vorname}}`, subjectB: `Wann erreiche ich Sie am besten, {{anrede}} {{nachname}}?`, preheader: "Ein kurzer Rückruf genügt – ich richte mich nach Ihnen.", heading: "Wann passt ein kurzes Telefonat?", intro: `ich habe versucht, Sie zu erreichen${!own ? ` – es geht um ${category}` : topic ? ` – es geht um ${topic}` : ""}.`, body: `Damit wir nicht aneinander vorbeitelefonieren: Nennen Sie mir einfach einen Zeitpunkt, dann rufe ich Sie an.${urgency}`, bullets: ["Rückruf zu Ihrer Wunschzeit", "Dauert höchstens 10 Minuten", "Alle Fragen direkt geklärt"] },
    angebot: { subject: `Noch Fragen zu unserem Angebot, {{vorname}}?`, subjectB: `Unser Angebot für {{firma}} – kurz nachgefragt`, preheader: "Gern passe ich das Angebot an Ihre Wünsche an.", heading: "Noch offene Punkte zu unserem Angebot?", intro: `vor ein paar Tagen haben Sie unser Angebot${own && topic ? ` zum Thema ${topic}` : !own ? ` zu ${category}` : ""} erhalten.`, body: `Falls etwas unklar ist oder Sie Anpassungen wünschen, besprechen wir das gern in fünf Minuten am Telefon.${urgency}`, bullets: ["Festpreis ohne versteckte Kosten", "Start innerhalb von 14 Tagen möglich", "Persönlicher Ansprechpartner"] },
    info: { subject: `Ihre Unterlagen ${own && topic ? `zum Thema ${topic}` : `zu ${categoryDative}`}`, subjectB: `${about}: die wichtigsten Infos auf einen Blick`, preheader: "Alles Wichtige kurz zusammengefasst.", heading: `${about === "unser Angebot" ? "Unser Angebot" : about} – das Wichtigste in Kürze`, intro: `wie versprochen schicke ich Ihnen die Informationen ${own && topic ? `zum Thema ${topic}` : `zu ${categoryDative}`}.`, body: "Die wichtigsten Punkte habe ich unten zusammengefasst. Bei Fragen melden Sie sich jederzeit.", bullets: ["Ablauf von der Anfrage bis zum Start", "Kosten und Förderung", "Was Sie von uns erwarten können"] },
    reaktivierung: { subject: `Passt es gerade nicht, {{vorname}}?`, subjectB: `Kurze Frage, bevor ich Sie nicht mehr störe`, preheader: "Ein Satz Rückmeldung reicht.", heading: "Ist das Thema noch aktuell?", intro: `wir hatten vor einiger Zeit Kontakt${!own ? ` wegen ${category}` : topic ? ` zum Thema ${topic}` : ""} – seitdem ist es ruhig geworden.`, body: "Falls das Thema noch aktuell ist, melde ich mich gern mit einem kurzen Update. Wenn nicht, sagen Sie einfach kurz Bescheid – dann schreibe ich nicht mehr.", bullets: ["Noch aktuell → kurzer Rückruf", "Später → ich melde mich zum Wunschtermin", "Erledigt → eine Zeile genügt"] },
    willkommen: { subject: `Willkommen bei ${company}, {{vorname}}!`, subjectB: `Danke für Ihre Anfrage – so geht es weiter`, preheader: "So geht es jetzt weiter.", heading: "Schön, dass Sie da sind", intro: `vielen Dank für Ihre Anfrage${!own ? ` zu ${category}` : topic ? ` zum Thema ${topic}` : ""}.`, body: "Hier kurz, was als Nächstes passiert – und wie Sie uns jederzeit erreichen.", bullets: ["Wir melden uns innerhalb von 24 Stunden", "Ein fester Ansprechpartner für Sie", "Alle Unterlagen kommen per E-Mail"] },
  };
  const scaffold = scaffolds[goal === "frei" ? "info" : goal];
  const blocks: EmailBlock[] = [{ id: newBlockId(), type: "heading", text: scaffold.heading }, { id: newBlockId(), type: "text", text: `${greeting(tone)}\n\n${sentence(scaffold.intro)} ${sentence(scaffold.body)}` }];
  if (length !== "kurz") blocks.push({ id: newBlockId(), type: "bullets", items: scaffold.bullets });
  if (length === "lang") blocks.push({ id: newBlockId(), type: "text", text: input.brief.trim() ? `Kurz zu uns: ${sentence(input.brief.trim().replace(/^[a-zäöü]/, (c) => c.toUpperCase()))}` : `Wir begleiten Sie von der ersten Frage bis zur Umsetzung – persönlich und ohne Umwege.` });
  void cta; blocks.push({ id: newBlockId(), type: "text", text: closing(tone, sender) }, { id: newBlockId(), type: "signature", name: sender, role: "Vertrieb", phone: "+49 69 000000" }); // kein Knopf – es gibt keine Terminbuchung
  return { label: GOALS.find((item) => item.key === goal)?.label ?? "E-Mail", subject: scaffold.subject, subjectB: input.abTest ? scaffold.subjectB : null, preheader: scaffold.preheader, blocks, notes: "Regelbasierter Entwurf – Texte im Builder anpassen." };
}

/** Serie ohne KI: Ziel-Mail, dann Nachfassen, zuletzt die „letzte Nachricht“. */
export function heuristicSeriesDraft(input: SeriesBrief): SeriesDraft {
  const count = Math.min(4, Math.max(2, input.count ?? 3)); const goal = input.goal && input.goal !== "frei" ? input.goal : guessGoal(input.brief);
  const first = heuristicEmailDraft({ ...input, goal }); first.label = "1. E-Mail";
  const follow = heuristicEmailDraft({ ...input, goal: "rueckruf", length: "kurz" }); follow.label = "Nachfassen"; follow.subject = `Kurz nachgefragt, {{vorname}}`; follow.subjectB = input.abTest ? "Haben Sie meine E-Mail gesehen, {{vorname}}?" : null; follow.preheader = "Nur ein kurzer Hinweis auf meine letzte E-Mail.";
  const last = heuristicEmailDraft({ ...input, goal: "reaktivierung", length: "kurz" }); last.label = "Letzte Nachricht"; last.subject = `Letzte Nachricht von mir, {{vorname}}`; last.subjectB = null;
  const mails = [first, follow, last].slice(0, count); if (count === 4) { const info = heuristicEmailDraft({ ...input, goal: "info", length: "mittel" }); info.label = "Infos"; mails.splice(1, 0, info); }
  const shortTopic = topicOf(input.brief).split(/[:,.;–]|\s-\s/)[0].trim().split(/\s+/).slice(0, 5).join(" ");
  const name = `${GOALS.find((item) => item.key === goal)?.label ?? "Serie"}${input.audience ? ` – ${input.audience}` : shortTopic ? ` – ${shortTopic}` : ""}`.slice(0, 80);
  return { name, mails, waitDays: Math.min(30, Math.max(1, input.waitDays ?? 3)), stopWhen: input.stopWhen ?? "replied" };
}

/** Entwurf → Send-Knoten (bestehende ID bleibt, damit der Ablauf nicht bricht). */
export function draftToNode(draft: EmailDraft, node: Partial<Extract<EmailNode, { type: "send" }>> & { id?: string } = {}): Extract<EmailNode, { type: "send" }> {
  return { id: node.id ?? newNodeId(), type: "send", label: node.label ?? draft.label, subject: draft.subject, subjectB: draft.subjectB ?? null, preheader: draft.preheader, blocks: draft.blocks.map((block) => ({ ...block, id: newBlockId() })), next: node.next ?? null };
}
/** Serie → Ablauf-Baum: senden → warten → wenn geantwortet/geklickt/geöffnet → Ende, sonst nächste Mail … */
export function seriesToTree(series: SeriesDraft): EmailTree {
  const nodes: EmailNode[] = []; const end = newNodeId(); const stopEnd = series.stopWhen === "never" ? null : newNodeId();
  const sends = series.mails.map((draft) => draftToNode(draft));
  sends.forEach((send, index) => {
    const isLast = index === sends.length - 1; nodes.push(send);
    if (isLast) { send.next = end; return; }
    const wait: EmailNode = { id: newNodeId(), type: "wait", hours: series.waitDays * 24, next: null }; send.next = wait.id; nodes.push(wait);
    if (stopEnd) { const condition: EmailNode = { id: newNodeId(), type: "condition", check: series.stopWhen === "never" ? "replied" : series.stopWhen, yes: stopEnd, no: sends[index + 1].id }; wait.next = condition.id; nodes.push(condition); }
    else wait.next = sends[index + 1].id;
  });
  if (stopEnd) nodes.push({ id: stopEnd, type: "end", label: series.stopWhen === "replied" ? "Hat geantwortet" : series.stopWhen === "clicked" ? "Hat geklickt" : "Hat geöffnet" });
  nodes.push({ id: end, type: "end", label: "Ende" });
  return { start: sends[0]?.id ?? null, nodes };
}
/** Bausteine aus einer KI-Antwort bereinigen (nur bekannte Typen, Pflichtfelder, Längen). */
export function sanitizeBlocks(raw: unknown): EmailBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: EmailBlock[] = [];
  for (const item of raw.slice(0, 14)) {
    const block = item && typeof item === "object" ? (item as Record<string, unknown>) : {}; const type = String(block.type ?? ""); const text = String(block.text ?? "").trim().slice(0, 2000);
    if (type === "heading" && text) out.push({ id: newBlockId(), type: "heading", text: text.slice(0, 140) });
    else if (type === "text" && text) out.push({ id: newBlockId(), type: "text", text });
    else if (type === "bullets" && Array.isArray(block.items)) { const items = (block.items as unknown[]).map((entry) => String(entry).trim()).filter(Boolean).slice(0, 8); if (items.length) out.push({ id: newBlockId(), type: "bullets", items }); }
    else if (type === "button") continue; // Knöpfe werden nicht übernommen – es gibt keine Terminbuchung
    else if (type === "divider") out.push({ id: newBlockId(), type: "divider" });
    else if (type === "spacer") out.push({ id: newBlockId(), type: "spacer", height: Math.min(80, Math.max(4, Number(block.height) || 16)) });
    else if (type === "signature") out.push({ id: newBlockId(), type: "signature", name: String(block.name ?? "Ihr Tanesco-Team").slice(0, 80), role: block.role ? String(block.role).slice(0, 80) : undefined, phone: block.phone ? String(block.phone).slice(0, 40) : undefined });
  }
  return out;
}
/** KI-Antworten kommen nicht immer in der gewünschten Form: Absätze als Strings, der ganze Text in „body“/„text“, Aufzählung/Knopf/Signatur als eigene Felder. Alles wird in Bausteine übersetzt. */
export function normalizeRawDraft(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") { const text = raw.trim(); if (!text) return {}; try { return normalizeRawDraft(JSON.parse(text)); } catch { return { blocks: text.split(/\n{2,}/).map((part) => ({ type: "text", text: part.trim() })) }; } }
  if (!raw || typeof raw !== "object") return {};
  const data = { ...(raw as Record<string, unknown>) };
  if (!data.subject && typeof data.betreff === "string") data.subject = data.betreff;
  if (!data.preheader && typeof data.vorschautext === "string") data.preheader = data.vorschautext;
  const blocks: unknown[] = Array.isArray(data.blocks) ? [...data.blocks] : Array.isArray(data.bausteine) ? [...(data.bausteine as unknown[])] : [];
  const paragraphs = (value: unknown) => { const parts = String(value ?? "").trim().split(/\n{2,}/).map((part) => part.trim()).filter(Boolean); if (parts.length > 1 && /^(guten|hallo|sehr geehrte|liebe|moin|servus|\{\{anrede|\{\{vorname)/i.test(parts[0]) && parts[0].length < 80) parts.splice(0, 2, `${parts[0]}\n\n${parts[1]}`); return parts.map((part) => ({ type: "text", text: part })); };
  if (!blocks.length) { const body = data.body ?? data.text ?? data.content ?? data.inhalt ?? data.html; if (typeof body === "string" && body.trim()) blocks.push(...paragraphs(body)); if (Array.isArray(data.paragraphs)) blocks.push(...(data.paragraphs as unknown[]).map((part) => ({ type: "text", text: String(part) }))); }
  const normalized = blocks.flatMap((block) => { if (typeof block === "string") return paragraphs(block); if (block && typeof block === "object") { const item = block as Record<string, unknown>; const type = String(item.type ?? item.typ ?? "").toLowerCase(); if ((type === "text" || type === "paragraph" || type === "absatz") && typeof item.text === "string") return item.text.includes("\n\n") && !/^\S+ \{\{/.test(item.text) ? paragraphs(item.text) : [{ ...item, type: "text" }]; if (type === "heading" || type === "überschrift" || type === "ueberschrift" || type === "title") return [{ ...item, type: "heading" }]; if (type === "bullets" || type === "list" || type === "aufzählung" || type === "aufzaehlung") return [{ type: "bullets", items: Array.isArray(item.items) ? item.items : Array.isArray(item.punkte) ? item.punkte : [] }]; if (type === "button" || type === "knopf" || type === "cta") return [{ type: "button", text: item.text ?? item.label, url: item.url ?? item.href }]; if (type === "signature" || type === "signatur") return [{ ...item, type: "signature" }]; if (type === "divider" || type === "spacer") return [item]; } return []; });
  if (!normalized.some((block) => (block as Record<string, unknown>).type === "bullets") && Array.isArray(data.bullets) && (data.bullets as unknown[]).length) normalized.push({ type: "bullets", items: data.bullets });
  if (!normalized.some((block) => (block as Record<string, unknown>).type === "button") && data.button && typeof data.button === "object") normalized.push({ type: "button", ...(data.button as Record<string, unknown>) });
  if (!normalized.some((block) => (block as Record<string, unknown>).type === "signature") && data.signature && typeof data.signature === "object") normalized.push({ type: "signature", ...(data.signature as Record<string, unknown>) });
  const greetingText = typeof data.greeting === "string" ? data.greeting.trim() : typeof data.anrede === "string" ? data.anrede.trim() : ""; const closingText = typeof data.closing === "string" ? data.closing.trim() : typeof data.gruss === "string" ? data.gruss.trim() : "";
  if (greetingText && !normalized.some((block) => (block as Record<string, unknown>).type === "text" && /^(guten|hallo|sehr geehrte|liebe|moin|servus|\{\{anrede)/i.test(String((block as Record<string, unknown>).text ?? "")))) { const first = normalized.findIndex((block) => (block as Record<string, unknown>).type === "text"); if (first >= 0) normalized[first] = { ...(normalized[first] as Record<string, unknown>), text: `${greetingText}\n\n${String((normalized[first] as Record<string, unknown>).text ?? "")}` }; }
  if (closingText && !normalized.some((block) => (block as Record<string, unknown>).type === "text" && /grüße|gruß/i.test(String((block as Record<string, unknown>).text ?? "")))) normalized.push({ type: "text", text: closingText });
  return { ...data, blocks: normalized };
}
/** Zählt die Wörter aller Textbausteine (Überschrift, Text, Aufzählung) – Maß für „ganze E-Mail“ statt einer Zeile. */
export function draftWordCount(blocks: EmailBlock[]) { return blocks.reduce((sum, block) => sum + (block.type === "heading" || block.type === "text" ? block.text.split(/\s+/).filter(Boolean).length : block.type === "bullets" ? block.items.join(" ").split(/\s+/).filter(Boolean).length : 0), 0); }
/** Vollständig = Betreff, mindestens drei Bausteine, Textbaustein, genug Text (kurz ≥ 30 Wörter, mittel ≥ 45, lang ≥ 60) und ein Knopf oder eine Grußformel – eine einzelne Zeile fällt durch. */
export function draftIsComplete(draft: EmailDraft, length: EmailLength = "mittel") {
  const texts = draft.blocks.filter((block): block is Extract<EmailBlock, { type: "text" }> => block.type === "text");
  return Boolean(draft.subject.trim()) && draft.blocks.length >= 3 && texts.length >= 1 && draftWordCount(draft.blocks) >= (length === "kurz" ? 30 : length === "lang" ? 60 : 45) && texts.some((block) => /grüße|gruß|vielen dank|kontaktweg/i.test(block.text));
}
/** Lückenhafte KI-Antwort zur ganzen E-Mail ergänzen: fehlende Überschrift, Anrede, Aufzählung, Knopf, Grußformel und Signatur kommen aus dem regelbasierten Entwurf – vorhandener KI-Text bleibt. */
export function completeDraft(draft: EmailDraft, fallback: EmailDraft, tone: EmailTone = "freundlich"): EmailDraft {
  const pick = <T extends EmailBlock["type"]>(blocks: EmailBlock[], type: T) => blocks.find((block): block is Extract<EmailBlock, { type: T }> => block.type === type);
  const texts = draft.blocks.filter((block): block is Extract<EmailBlock, { type: "text" }> => block.type === "text").map((block) => ({ ...block, id: newBlockId() }));
  const fallbackTexts = fallback.blocks.filter((block): block is Extract<EmailBlock, { type: "text" }> => block.type === "text");
  const isClosing = (text: string) => (/grüße|gruß|vielen dank|\{\{kontaktweg\}\}/i.test(text) && text.split(/\s+/).length <= 30);
  let bodyTexts = texts.filter((block) => !isClosing(block.text)); const closingBlock = texts.find((block) => isClosing(block.text));
  if (!bodyTexts.length) bodyTexts = fallbackTexts.filter((block) => !isClosing(block.text)).map((block) => ({ ...block, id: newBlockId() }));
  if (bodyTexts.length && !/^(guten|hallo|sehr geehrte|liebe|moin|servus|\{\{anrede|\{\{vorname|\{\{begruessung)/i.test(bodyTexts[0].text.trim())) bodyTexts[0] = { ...bodyTexts[0], text: `${greeting(tone)}\n\n${bodyTexts[0].text}` };
  else if (bodyTexts.length) bodyTexts[0] = { ...bodyTexts[0], text: bodyTexts[0].text.replace(/^(hallo|hi|hey|moin|servus|liebe[r]?|guten tag)\b\s*(\{\{\s*anrede\s*\}\}\s*)?(\{\{\s*(nachname|vorname|name)\s*\}\})?\s*,?/i, "{{begruessung}},") }; // nie „Hallo“ – immer die förmliche Begrüßung (der Rest der Zeile bleibt)
  if (draftWordCount(bodyTexts) < 35) { const own = bodyTexts.map((block) => block.text.toLowerCase()); const extra = fallbackTexts.filter((block) => !isClosing(block.text)).map((block) => ({ ...block, id: newBlockId(), text: block.text.replace(/^[^\n]*\n\n/, "") })).filter((block) => block.text.trim() && !own.some((text) => text.includes(block.text.toLowerCase().slice(0, 40)))); bodyTexts = [...bodyTexts, ...extra]; }
  const heading = pick(draft.blocks, "heading") ?? pick(fallback.blocks, "heading");
  const bullets = pick(draft.blocks, "bullets") ?? pick(fallback.blocks, "bullets");
  const signature = pick(draft.blocks, "signature") ?? pick(fallback.blocks, "signature");
  const closing = fallbackTexts.find((block) => isClosing(block.text)) ?? closingBlock; // Schluss immer aus dem Regelwerk: Kontaktweg + „Vielen Dank“ (keine doppelte Grußformel)
  const blocks: EmailBlock[] = [];
  if (heading) blocks.push({ ...heading, id: newBlockId() });
  blocks.push(...bodyTexts);
  if (bullets) blocks.push({ ...bullets, id: newBlockId() });
  if (closing) blocks.push({ ...closing, id: newBlockId() });
  if (signature) blocks.push({ ...signature, id: newBlockId() });
  return { ...draft, subject: draft.subject.trim() || fallback.subject, preheader: draft.preheader.trim() || fallback.preheader, blocks };
}
export function sanitizeDraft(raw: unknown, fallback: EmailDraft): EmailDraft {
  const data = normalizeRawDraft(raw);
  const blocks = sanitizeBlocks(data.blocks); const subject = String(data.subject ?? "").trim().slice(0, 200);
  if (!subject || !blocks.length) return fallback;
  return { label: String(data.label ?? fallback.label).trim().slice(0, 60) || fallback.label, subject, subjectB: data.subjectB ? String(data.subjectB).trim().slice(0, 200) : null, preheader: String(data.preheader ?? "").trim().slice(0, 200), blocks, notes: data.notes ? String(data.notes).slice(0, 300) : null };
}
/** Text-Entwurf (SMS/WhatsApp/E-Mail-Text) ohne KI: aus dem passenden E-Mail-Entwurf den Kern ziehen. */
export function heuristicMessageDraft(input: EmailBrief & { channel: "sms" | "whatsapp" | "email" }): { text: string; subject: string | null } {
  const draft = heuristicEmailDraft({ ...input, length: "kurz" }); const intro = draft.blocks.find((block) => block.type === "text"); const button = draft.blocks.find((block) => block.type === "button");
  const sender = input.sender?.trim() || "Ihr Tanesco-Team";
  if (input.channel === "email") return { subject: draft.subject, text: `${intro && intro.type === "text" ? intro.text : ""}\n\n${button && button.type === "button" ? `${button.text}: ${button.url}\n\n` : ""}Mit freundlichen Grüßen\n${sender}`.trim() };
  const core = (intro && intro.type === "text" ? intro.text : "").replace(/^[^\n]*\n+/, "").replace(/\s+/g, " ").trim();
  return { subject: null, text: `Guten Tag {{anrede}} {{nachname}}, ${core.charAt(0).toLowerCase()}${core.slice(1)} ${input.goal === "termin" || /termin/i.test(input.brief) ? "Wann passt Ihnen ein kurzer Termin?" : "Wann erreiche ich Sie am besten?"} Viele Grüße, ${sender.replace(/^Ihr Team von /, "")}`.replace(/\s{2,}/g, " ").slice(0, 460) };
}
