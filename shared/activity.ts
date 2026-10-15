/**
 * Verlauf der Plattform (Glocke oben rechts): Was ist passiert – als Tagesverlauf.
 *
 * Jede wichtige Aktion schreibt einen Eintrag (neue Kontakte, Anrufe, Lead verkauft, Gespräch abgehört,
 * E-Mails gesendet …). Damit die Glocke bei vielen Vorgängen nicht überläuft, werden die Einträge je Tag
 * und je Art zusammengefasst: „Heute · 120 neue Kontakte · 14 Anrufe · 2 Leads verkauft“ – und erst beim
 * Aufklappen sieht man die einzelnen Einträge. Server und Chat-Demo nutzen dieselbe Gruppierung.
 */
export type ActivityKind =
  | "kontakt_neu"          // Kontakte hochgeladen / angelegt (Kaltakquise, Kampagnen, Lead-Finder)
  | "lead_neu"             // Lead eingegangen (Meta Ads, API, Posteingang, Haustür)
  | "upload_rueckgaengig"  // Upload rückgängig gemacht
  | "anruf"                // Anruf aus dem Dialer (mit Ergebnis)
  | "gespraech_abgehoert"  // Callcenter-Aufzeichnung angehört
  | "gespraech_bewertet"   // Gesprächsbewertung entschieden
  | "lead_verkauft"        // Lead an Käufer ausgeliefert/verkauft
  | "bestellung"           // Bestellung angelegt
  | "reklamation"          // Reklamation eingegangen
  | "pipeline_stufe"       // Karte in der Pipeline verschoben
  | "pipeline_uebernommen" // Kontakte in die Pipeline übernommen
  | "email_gesendet"       // Kampagnen-E-Mails rausgegangen
  | "email_antwort"        // Antwort im Posteingang
  | "kampagne"             // Kampagne gestartet / pausiert
  | "sonstiges";

export const ACTIVITY_KINDS: ActivityKind[] = ["lead_neu", "kontakt_neu", "anruf", "gespraech_abgehoert", "gespraech_bewertet", "lead_verkauft", "bestellung", "reklamation", "pipeline_uebernommen", "pipeline_stufe", "email_gesendet", "email_antwort", "kampagne", "upload_rueckgaengig", "sonstiges"];

/** Bezeichnung in der Zusammenfassung – Einzahl und Mehrzahl, damit „1 Anruf“ und „14 Anrufe“ richtig stehen. */
export const ACTIVITY_LABEL: Record<ActivityKind, { one: string; many: string }> = {
  kontakt_neu: { one: "neuer Kontakt", many: "neue Kontakte" },
  lead_neu: { one: "neuer Lead", many: "neue Leads" },
  upload_rueckgaengig: { one: "Upload rückgängig", many: "Uploads rückgängig" },
  anruf: { one: "Anruf", many: "Anrufe" },
  gespraech_abgehoert: { one: "Gespräch abgehört", many: "Gespräche abgehört" },
  gespraech_bewertet: { one: "Gespräch bewertet", many: "Gespräche bewertet" },
  lead_verkauft: { one: "Lead verkauft", many: "Leads verkauft" },
  bestellung: { one: "Bestellung", many: "Bestellungen" },
  reklamation: { one: "Reklamation", many: "Reklamationen" },
  pipeline_stufe: { one: "Karte verschoben", many: "Karten verschoben" },
  pipeline_uebernommen: { one: "in die Pipeline übernommen", many: "in die Pipeline übernommen" },
  email_gesendet: { one: "E-Mail gesendet", many: "E-Mails gesendet" },
  email_antwort: { one: "Antwort", many: "Antworten" },
  kampagne: { one: "Kampagne", many: "Kampagnen" },
  sonstiges: { one: "Vorgang", many: "Vorgänge" },
};

export type ActivityEntry = {
  id: number;
  kind: ActivityKind;
  title: string;
  detail: string | null;
  count: number;              // wie viele Dinge dieser Eintrag abdeckt (z. B. 120 Kontakte in einem Upload)
  leadPublicId: string | null;
  actorName: string | null;
  createdAt: Date | string;
};

export type ActivityGroup = { kind: ActivityKind; label: string; count: number; entries: ActivityEntry[] };
export type ActivityDay = { day: string; label: string; total: number; summary: string; groups: ActivityGroup[] };

const dayKey = (value: Date | string) => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** „Heute“, „Gestern“, sonst „Mo, 13.10.“ */
export function dayLabel(day: string, now = new Date()): string {
  if (day === dayKey(now)) return "Heute";
  if (day === dayKey(new Date(now.getTime() - 86_400_000))) return "Gestern";
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
}

export function countLabel(kind: ActivityKind, count: number): string {
  const label = ACTIVITY_LABEL[kind] ?? ACTIVITY_LABEL.sonstiges;
  return `${count} ${count === 1 ? label.one : label.many}`;
}

/**
 * Einträge zu Tagen und Arten bündeln – neueste Tage zuerst, innerhalb eines Tages die häufigsten Arten zuerst.
 * `summary` ist der Satz für die zugeklappte Ansicht, höchstens vier Arten, der Rest als „+ n weitere“.
 */
export function groupActivity(entries: ActivityEntry[], now = new Date()): ActivityDay[] {
  const days = new Map<string, Map<ActivityKind, ActivityEntry[]>>();
  for (const entry of entries) {
    const key = dayKey(entry.createdAt);
    const kinds = days.get(key) ?? new Map<ActivityKind, ActivityEntry[]>();
    kinds.set(entry.kind, [...(kinds.get(entry.kind) ?? []), entry]);
    days.set(key, kinds);
  }
  return Array.from(days.entries()).sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0)).map(([day, kinds]) => {
    const groups: ActivityGroup[] = Array.from(kinds.entries()).map(([kind, list]) => {
      const count = list.reduce((sum, entry) => sum + Math.max(1, entry.count), 0);
      return { kind, label: countLabel(kind, count), count, entries: [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) };
    }).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
    const total = groups.reduce((sum, group) => sum + group.count, 0);
    const shown = groups.slice(0, 4).map((group) => group.label);
    const rest = groups.length - shown.length;
    return { day, label: dayLabel(day, now), total, summary: `${shown.join(" · ")}${rest > 0 ? ` · + ${rest} weitere` : ""}`, groups };
  });
}

/** Wie viele Einträge sind seit dem letzten Öffnen der Glocke dazugekommen? */
export function countSince(entries: Array<Pick<ActivityEntry, "createdAt">>, since: Date | string | null | undefined): number {
  if (!since) return entries.length;
  const mark = new Date(since).getTime();
  return entries.filter((entry) => new Date(entry.createdAt).getTime() > mark).length;
}
