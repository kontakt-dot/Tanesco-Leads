/** Lead-Finder: Firmenprofil aus Webseiten-Text ziehen (E-Mail, Telefon, Geschäftsführung, Größe, Umsatz, Einsatzgebiet) – gemeinsam für Server und Demo. */
export type CompanyProfile = { emails: string[]; phones: string[]; management: string | null; employees: string | null; revenue: string | null; founded: string | null; serviceArea: string | null; services: string[]; summary: string | null; registry: string | null; vatId: string | null; sources: string[] };
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE = /(?:\+49|0049|0)\s?[1-9][0-9 \-/()]{6,}[0-9]/g;
export function stripHtml(html: string) { return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&uuml;/g, "ü").replace(/&ouml;/g, "ö").replace(/&auml;/g, "ä").replace(/&szlig;/g, "ß").replace(/&Uuml;/g, "Ü").replace(/&Ouml;/g, "Ö").replace(/&Auml;/g, "Ä").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim(); }
const pick = (text: string, pattern: RegExp) => { const match = text.match(pattern); return match ? match[1].trim().replace(/\s+/g, " ").slice(0, 160) : null; };
export function extractProfile(pages: Array<{ url: string; text: string }>): CompanyProfile {
  const text = pages.map((page) => page.text).join("\n"); const lower = text.toLowerCase();
  const emails = Array.from(new Set((text.match(EMAIL) ?? []).map((item) => item.toLowerCase()).filter((item) => !/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/.test(item) && !/(example|sentry|wixpress|cloudflare)/.test(item)))).slice(0, 5);
  const phones = Array.from(new Set((text.match(PHONE) ?? []).map((item) => item.replace(/\s+/g, " ").trim()).filter((item) => item.replace(/\D/g, "").length >= 8))).slice(0, 4);
  const managementRaw = pick(text, /(?:Geschäftsführer(?:in|ung)?|Inhaber(?:in)?|Vertretungsberechtigt(?:er)?(?: Geschäftsführer)?|Vorstand)\s*[:\-]?\s*([A-ZÄÖÜ][\wäöüß.\-]+(?:\s+[A-ZÄÖÜ][\wäöüß.\-]+){1,4})/);
  const management = managementRaw ? managementRaw.split(/\s+/).filter((word) => !/^(Telefon|Tel|Fax|E-Mail|Mail|Mobil|Handy|Adresse|Straße|Str|Amtsgericht|Registergericht|HRB|HRA|USt|Steuernummer|Sitz|Kontakt|Web|Internet)/i.test(word)).slice(0, 4).join(" ") : null;
  const employeesRaw = pick(text, /(\d{1,3}(?:\.\d{3})?\s*(?:\+\s*)?Mitarbeiter(?:innen|:innen)?|Mitarbeiter(?:innen)?\s*[:\-]?\s*(?:ca\.|über|rund|mehr als)?\s*\d{1,4}|Team von (?:ca\.|über|rund)?\s*\d{1,4}(?: Mitarbeitern| Personen| Leuten)?)/i);
  const revenueRaw = pick(text, /(Umsatz(?:erlöse)?(?:\s*(?:von|:|\(?\d{4}\)?|im Jahr|in))*\s*(?:ca\.|rund|über|etwa)?\s*[\d.,]+\s*(?:Mio\.?|Millionen|Mrd\.?|Milliarden|Tsd\.?|T|€|Euro)[^.\n]{0,40})/i);
  const founded = pick(text, /(?:gegründet|seit|Gründung(?:sjahr)?)\s*[:\-]?\s*(?:im Jahr\s*)?((?:18|19|20)\d{2})/i);
  const areaRaw = pick(text, /(?:Einsatzgebiet|Tätigkeitsgebiet|Liefergebiet|Wir sind tätig in|tätig in|Unser Gebiet|im Umkreis von|in der Region|in ganz)\s*[:\-]?\s*([^.\n]{3,120})/i);
  const registry = pick(text, /((?:HRA|HRB)\s*\d{2,7}(?:\s?[A-Z]{1,2}\b(?![a-zäöü]))?)/); const vatId = pick(text, /(DE\s?\d{9})/);
  const serviceKeywords = ["Photovoltaik", "Solar", "Wärmepumpe", "Dach", "Dachdecker", "Fenster", "Türen", "Treppenlift", "Hörgeräte", "Hörakustik", "Elektro", "Heizung", "Sanitär", "Klima", "Wintergarten", "Alarmanlage", "Sicherheitstechnik", "Bad", "Barrierefrei", "Rollstuhl", "Rollator", "Sanitätshaus", "Pflege", "Garten", "Zaun", "Fassade", "Maler", "Energieberatung", "Wallbox", "Speicher"];
  const services = serviceKeywords.filter((keyword) => lower.includes(keyword.toLowerCase())).slice(0, 8);
  const summaryCandidate = pages.flatMap((page) => page.text.split("\n")).map((line) => line.trim()).find((line) => line.length > 60 && line.length < 300 && !/cookie|datenschutz|impressum/i.test(line)) ?? null;
  return { emails, phones, management, employees: employeesRaw, revenue: revenueRaw, founded, serviceArea: areaRaw, services, summary: summaryCandidate, registry, vatId, sources: pages.map((page) => page.url) };
}
/** Größe grob aus Mitarbeiterangabe ableiten. */
export function sizeBucket(employees: string | null): string | null { if (!employees) return null; const digits = employees.match(/\d{1,4}/)?.[0]; if (!digits) return null; const count = Number(digits); if (count < 10) return "Kleinbetrieb (unter 10)"; if (count < 50) return "Klein (10–49)"; if (count < 250) return "Mittel (50–249)"; return "Groß (250+)"; }
