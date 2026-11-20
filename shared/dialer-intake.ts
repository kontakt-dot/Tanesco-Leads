/**
 * Eingang vom Dialer – was kommt an, und wird daraus ein Lead?
 * Ohne Datenbank: Server, Vorschau und Tests nutzen dieselbe Rechnung.
 *  - Kontakt aus dem Gespräch: Schickt der Dialer keinen Kontakt mit, werden Name und Ort aus der Abschrift gelesen
 *    (auf dem Server fragt die KI; hier steht die einfache Ersatz-Erkennung über Wörter).
 *  - Felder der letzten Meldung: welche Namen der Dialer schickt und welche wir als Kontakt erkennen.
 *  - Urteil in einem Satz: wo es hängt.
 */
import { extractDialerContact, type DialerContact } from "./dialer-contact";

export type SpokenContact = { firstName: string | null; lastName: string | null; street: string | null; postcode: string | null; city: string | null; email: string | null };
export const EMPTY_SPOKEN: SpokenContact = { firstName: null, lastName: null, street: null, postcode: null, city: null, email: null };
const tidy = (value: unknown, max: number): string | null => { const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""; return text && !/^(unbekannt|unklar|keine angabe|nicht genannt|n\/a|-+)$/i.test(text) ? text.slice(0, max) : null; };
/** Antwort der KI (oder beliebige Angaben) in saubere Felder bringen – leere und „unbekannt“ fallen weg, die PLZ muss fünf Ziffern haben. */
export function cleanSpokenContact(value: unknown): SpokenContact {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const postcode = tidy(raw.postcode, 12)?.replace(/\D/g, "") ?? ""; const email = tidy(raw.email, 320)?.toLowerCase() ?? "";
  return { firstName: tidy(raw.firstName, 120), lastName: tidy(raw.lastName, 120), street: tidy(raw.street, 200), postcode: /^\d{4,5}$/.test(postcode) ? postcode : null, city: tidy(raw.city, 120), email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null };
}
/** Ersatz ohne KI: „Herr Müller“ / „Frau Dr. Berg“ und „35390 Gießen“ aus der Abschrift. Bewusst vorsichtig – lieber nichts als Falsches. */
export function contactFromTranscript(transcript: string | null | undefined): SpokenContact {
  const text = String(transcript ?? ""); const out: SpokenContact = { ...EMPTY_SPOKEN };
  const names = new Map<string, number>();
  for (const match of Array.from(text.matchAll(/\b(?:Herrn?|Frau)\s+(?:Dr\.\s+|Prof\.\s+)?([A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?)/g))) names.set(match[1], (names.get(match[1]) ?? 0) + 1);
  const best = Array.from(names.entries()).sort((a, b) => b[1] - a[1])[0]; if (best) out.lastName = best[0];
  const place = /\b(\d{5})\s+([A-ZÄÖÜ][a-zäöüß]+(?:[ -][A-ZÄÖÜ][a-zäöüß]+)?)/.exec(text); if (place) { out.postcode = place[1]; out.city = place[2]; }
  return out;
}
/** Kontakt des Dialers mit dem aus dem Gespräch ergänzen – was der Dialer nennt, gilt. */
export function withSpokenContact(contact: DialerContact, spoken: SpokenContact): DialerContact {
  const named = Boolean(contact.firstName || contact.lastName);
  const merged = { ...contact, firstName: named ? contact.firstName : spoken.firstName, lastName: named ? contact.lastName : spoken.lastName, street: contact.street ?? spoken.street, postcode: contact.postcode ?? spoken.postcode, city: contact.city ?? spoken.city, email: contact.email ?? spoken.email };
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
export function contactParts(payload: unknown, mapping: Partial<Record<string, string>> = {}): { name: boolean; address: boolean; email: boolean; category: boolean; result: boolean; fields: number } {
  const contact = extractDialerContact(payload, mapping);
  return { name: contact.hasIdentity, address: Boolean(contact.postcode || contact.city || contact.street), email: Boolean(contact.email), category: Boolean(contact.category), result: Boolean(contact.result), fields: Object.keys(contact.fields).length };
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
