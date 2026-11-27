/**
 * Eingang vom Dialer – was kommt an, und wird daraus ein Lead?
 * Ohne Datenbank: Server, Vorschau und Tests nutzen dieselbe Rechnung.
 *  - Kontakt aus dem Gespräch: Schickt der Dialer keinen Kontakt mit, werden Name und Ort aus der Abschrift gelesen
 *    (auf dem Server fragt die KI; hier steht die einfache Ersatz-Erkennung über Wörter).
 *  - Felder der letzten Meldung: welche Namen der Dialer schickt und welche wir als Kontakt erkennen.
 *  - Urteil in einem Satz: wo es hängt.
 */
import { extractDialerContact, type DialerContact } from "./dialer-contact";
import { isPlaceholder, isSalutation, tidySalutation } from "./lead-fields";
import { dialerCampaignOf } from "./dialer-campaign";
import { normalizePostcode } from "./postcode";

export type SpokenContact = { firstName: string | null; lastName: string | null; street: string | null; postcode: string | null; city: string | null; email: string | null; /** „Herr“ oder „Frau“, wenn der Kunde so angesprochen wird */ salutation?: "Herr" | "Frau" | null };
export const EMPTY_SPOKEN: SpokenContact = { firstName: null, lastName: null, street: null, postcode: null, city: null, email: null };
const tidy = (value: unknown, max: number): string | null => { const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""; return text && !isPlaceholder(text) ? text.slice(0, max) : null; }; // „unbekannt“, „<UNKNOWN>“, „n/a“ … sind keine Angabe
/** Antwort der KI (oder beliebige Angaben) in saubere Felder bringen – leere und „unbekannt“ fallen weg, die PLZ muss fünf Ziffern haben. */
export function cleanSpokenContact(value: unknown): SpokenContact {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const postcode = tidy(typeof raw.postcode === "number" ? String(raw.postcode) : raw.postcode, 12)?.replace(/\D/g, "") ?? ""; const email = tidy(raw.email, 320)?.toLowerCase() ?? ""; // auch als Zahl (dann ohne führende Null – die kommt beim Zusammenführen zurück)
  // „Herr“/„Frau“ ist kein Vorname: Die Anrede wandert in ihr eigenes Feld – auch aus „Herr Bade“ im Nachnamen
  let firstName = tidy(raw.firstName, 120); let lastName = tidy(raw.lastName, 120); let salutation = tidySalutation(raw.salutation);
  if (firstName && isSalutation(firstName)) { salutation = salutation ?? tidySalutation(firstName); firstName = null; }
  const lead = lastName ? /^(herrn?|frau)\s+(.+)$/i.exec(lastName) : null; if (lead) { salutation = salutation ?? tidySalutation(lead[1]); lastName = lead[2].trim() || null; }
  return { firstName, lastName, street: tidy(raw.street, 200), postcode: /^\d{4,5}$/.test(postcode) ? postcode : null, city: tidy(raw.city, 120), email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null, ...(salutation ? { salutation } : {}) };
}
/** Ersatz ohne KI: „Herr Müller“ / „Frau Dr. Berg“ und „35390 Gießen“ aus der Abschrift. Bewusst vorsichtig – lieber nichts als Falsches. */
export function contactFromTranscript(transcript: string | null | undefined): SpokenContact {
  const text = String(transcript ?? ""); const out: SpokenContact = { ...EMPTY_SPOKEN };
  const names = new Map<string, number>();
  const said = new Map<string, "Herr" | "Frau">();
  for (const match of Array.from(text.matchAll(/\b(Herrn?|Frau)\s+(?:Dr\.\s+|Prof\.\s+)?([A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?)/g))) { names.set(match[2], (names.get(match[2]) ?? 0) + 1); if (!said.has(match[2])) said.set(match[2], /^frau$/i.test(match[1]) ? "Frau" : "Herr"); }
  const best = Array.from(names.entries()).sort((a, b) => b[1] - a[1])[0]; if (best) { out.lastName = best[0]; out.salutation = said.get(best[0]) ?? null; }
  const place = /\b(\d{5})\s+([A-ZÄÖÜ][a-zäöüß]+(?:[ -][A-ZÄÖÜ][a-zäöüß]+)?)/.exec(text); if (place) { out.postcode = place[1]; out.city = place[2]; }
  return out;
}
/**
 * Anrede des Kunden aus dem Gespräch: Wie oft fällt „Herr <Nachname>“ und wie oft „Frau <Nachname>“ – mit dem Nachnamen des Leads?
 * Die Spracherkennung schreibt Namen oft etwas anders („Meier“/„Meyer“, ein Buchstabe falsch), das gilt als derselbe Name. Bei Doppelnamen
 * reicht ein Teil. Fällt beides gleich oft oder der Name gar nicht, gibt es keine Antwort – lieber nichts als die falsche Anrede.
 */
export function salutationFromTranscript(transcript: string | null | undefined, lastName: string | null | undefined): "Herr" | "Frau" | null {
  const fold = (value: string) => value.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/ey|ay|ai/g, "ei").replace(/[^a-z]/g, "");
  const wanted = String(lastName ?? "").split(/[\s-]+/).map(fold).filter((part) => part.length >= 3); if (!wanted.length) return null;
  const near = (a: string, b: string) => { if (a === b) return true; if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false; let i = 0; let j = 0; let edits = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { i += 1; j += 1; continue; } edits += 1; if (edits > 1) return false; if (a.length > b.length) i += 1; else if (b.length > a.length) j += 1; else { i += 1; j += 1; } } return edits + (a.length - i) + (b.length - j) <= 1; };
  let herr = 0; let frau = 0;
  for (const match of Array.from(String(transcript ?? "").matchAll(/\b(Herrn?|Frau)\s+(?:Dr\.\s+|Prof\.\s+)?([A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?)/g))) {
    if (!match[2].split("-").map(fold).some((part) => wanted.some((name) => near(part, name)))) continue;
    if (/^frau$/i.test(match[1])) frau += 1; else herr += 1;
  }
  return herr > frau ? "Herr" : frau > herr ? "Frau" : null;
}
/**
 * v386: Anrede aus der Kurzfassung des Gesprächs (die KI schreibt sie: „… ruft Herrn Albers an“, „Die Kundin …“). Im Gesprächstext selbst
 * ist der Nachname oft anders geschrieben als im Lead – die Kurzfassung nennt den Kunden zuverlässiger. Gezählt werden „Herr/Herrn <Name>“,
 * „Frau <Name>“ und „Kundin“ bzw. „Kunde“; „seine Frau“, „Ehefrau“ und Ähnliches zählen nicht. Kommt beides vor, gibt es keine Antwort.
 */
export function salutationFromSummary(summary: string | null | undefined): "Herr" | "Frau" | null {
  const text = String(summary ?? ""); if (!text.trim()) return null;
  let herr = 0; let frau = 0;
  for (const match of Array.from(text.matchAll(/(\S+\s+)?\b(Herrn?|Frau)\s+(?:Dr\.\s+|Prof\.\s+)?[A-ZÄÖÜ][a-zäöüß]+/g))) {
    const before = (match[1] ?? "").trim().toLowerCase();
    if (/^frau$/i.test(match[2])) { if (/^(seine|seiner|seinen|ihre|ihrer|meine|meiner|die|der|mit|und|ehe|seinem)$/.test(before)) continue; frau += 1; } else herr += 1;
  }
  if (/\b(die|der|eine|einer)\s+Kundin\b|\bKundin\b/.test(text)) frau += 1;
  if (/\b(der|dem|den|ein|einem|einen)\s+Kunden?\b/.test(text) && !/\bKundin\b/.test(text)) herr += 1;
  return herr > 0 && frau === 0 ? "Herr" : frau > 0 && herr === 0 ? "Frau" : null;
}
/** Kontakt des Dialers mit dem aus dem Gespräch ergänzen – was der Dialer nennt, gilt. */
export function withSpokenContact(contact: DialerContact, spoken: SpokenContact): DialerContact {
  const named = Boolean(contact.firstName || contact.lastName);
  const fields = !named && spoken.salutation && !contact.fields.anrede ? { ...contact.fields, anrede: spoken.salutation } : contact.fields; // Anrede aus dem Gespräch als Zusatzfeld
  const merged = { ...contact, fields, firstName: named ? contact.firstName : spoken.firstName, lastName: named ? contact.lastName : spoken.lastName, street: contact.street ?? spoken.street, postcode: contact.postcode ?? normalizePostcode(spoken.postcode, contact.country), city: contact.city ?? spoken.city, email: contact.email ?? spoken.email };
  return { ...merged, hasIdentity: Boolean(merged.firstName || merged.lastName || merged.company), hasData: true };
}

/** Namen der Felder einer Meldung (ohne Werte) – verschachtelte mit Punkt. Höchstens 40. */
export function payloadFieldNames(payload: unknown): string[] {
  const out: string[] = []; const walk = (value: unknown, prefix: string, depth: number) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) { if (out.length >= 40) return; const name = `${prefix}${key}`.slice(0, 60); if (item && typeof item === "object" && !Array.isArray(item) && depth < 2) walk(item, `${name}.`, depth + 1); else out.push(name); }
  };
  walk(payload, "", 0); return out;
}
/** Was die letzte Meldung zum Kontakt enthält – in einfachen Wörtern. */
export function contactParts(payload: unknown, mapping: Partial<Record<string, string>> = {}): { name: boolean; address: boolean; email: boolean; category: boolean; result: boolean; /** Name der Kampagne im Dialer („campaign“) */ campaign: boolean; fields: number } {
  const contact = extractDialerContact(payload, mapping);
  return { name: contact.hasIdentity, address: Boolean(contact.postcode || contact.city || contact.street), email: Boolean(contact.email), category: Boolean(contact.category), result: Boolean(contact.result), campaign: Boolean(dialerCampaignOf(payload, mapping.campaign || undefined)), fields: Object.keys(contact.fields).length };
}

export type IntakeCounts = { received: number; withContact: number; noConsent: number; failed: number; approved: number; review: number; rejected: number; leads: number; approvedNoLead: number };
export const EMPTY_INTAKE: IntakeCounts = { received: 0, withContact: 0, noConsent: 0, failed: 0, approved: 0, review: 0, rejected: 0, leads: 0, approvedNoLead: 0 };
export type IntakeVerdict = { tone: "ok" | "warn" | "bad" | "idle"; title: string; text: string };
/** Ein Satz, der sagt, wie es steht – und was zu tun ist. */
export function intakeVerdict(input: { enabled: boolean; today: IntakeCounts; week: IntakeCounts; lastAt: string | Date | null }): IntakeVerdict {
  const { today, week } = input; const n = (count: number, one: string, many: string) => `${count.toLocaleString("de-DE")} ${count === 1 ? one : many}`;
  if (!input.enabled) return { tone: "bad", title: "Die Gesprächsbewertung ist ausgeschaltet", text: "Der Dialer wird abgewiesen – es kommt nichts an. Oben einschalten und speichern." };
  if (!input.lastAt) return { tone: "idle", title: "Vom Dialer ist noch nichts angekommen", text: "Entweder schickt der Dialer noch nichts, oder er schickt an eine andere Adresse. Probe-Meldungen mit „test“ werden nicht gespeichert." };
  if (!today.received) return { tone: week.received ? "idle" : "warn", title: "Heute ist noch nichts angekommen", text: week.received ? `In den letzten 7 Tagen: ${n(week.received, "Gespräch", "Gespräche")}, daraus ${n(week.leads, "Lead", "Leads")}.` : "Auch in den letzten 7 Tagen kam nichts an." };
  if (today.noConsent === today.received) return { tone: "bad", title: `${n(today.received, "Gespräch kam", "Gespräche kamen")} an – ohne Einwilligung`, text: "Der Dialer schickt das Feld für die Einwilligung nicht mit. Die Gespräche werden gespeichert, aber nicht bewertet – so entsteht kein Lead." };
  if (today.approvedNoLead) return { tone: "warn", title: `${n(today.approvedNoLead, "grünes Gespräch wartet", "grüne Gespräche warten")} auf den Lead`, text: "Der Lead wird gerade angelegt. Bleibt die Zahl stehen: „Leads jetzt anlegen“ klicken." };
  const parts = [`${n(today.leads, "Lead", "Leads")} entstanden`, today.review ? `${n(today.review, "Gespräch wartet", "Gespräche warten")} auf deine Prüfung` : null, today.rejected ? `${today.rejected.toLocaleString("de-DE")} zurückgewiesen` : null].filter(Boolean).join(", ");
  return { tone: today.review ? "warn" : "ok", title: `Heute ${n(today.received, "Gespräch", "Gespräche")} angekommen`, text: `${parts}.${today.withContact < today.received ? " Der Dialer schickt den Kontakt nicht bei jedem Gespräch mit – dann liest die KI Name und Ort aus dem Gespräch." : ""}` };
}
