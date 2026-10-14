/**
 * Automatische Gesprächsnotizen für alle Dialer (Telefonie, Kaltakquise-Anrufkampagnen):
 * Nach jedem Gespräch entsteht eine Notiz am Kontakt – aus dem Transkript (KI oder Kurzfassung) oder,
 * wenn es kein Transkript gibt, aus den Anrufdaten (Ergebnis, Dauer, Agent, Notiz des Agenten).
 * Die Funktion lässt sich global (Telefonie-Einstellungen), je Kampagne und direkt im Dialer ein-/ausschalten.
 */

export const AUTO_NOTE_TITLE = "Gesprächsnotiz (automatisch)";
export type CallSummarySource = "ki" | "kurzfassung" | "anrufdaten";

export type CallSummary = { summary: string; points: string[]; nextStep: string | null; source: CallSummarySource };

export type CallNoteFacts = {
  startedAt: Date | string | null;
  talkSeconds: number | null;
  agentName: string | null;
  campaignName: string | null;
  mode: string | null;
  statusLabel?: string | null;
  dispositionLabel: string | null;
  agentNotes: string | null;
};

/** Gilt die automatische Notiz? Kampagne (an/aus) schlägt die Einstellung; ohne Kampagnenwert gilt der Standard. */
export function effectiveAutoNotes(settingsEnabled: boolean | null | undefined, campaignFlag: boolean | null | undefined): boolean {
  if (campaignFlag === true || campaignFlag === false) return campaignFlag;
  return settingsEnabled !== false;
}

export const formatTalkTime = (seconds: number | null | undefined) => seconds === null || seconds === undefined ? null : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} Min.`;

const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const sentenceCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

type Turn = { speaker: "agent" | "kunde" | "unbekannt"; text: string };

/** Transkriptzeilen „Agent: …“ / „Kunde: …“ / „Sprecher 1: …“ in Gesprächsbeiträge zerlegen. */
export function parseTranscript(transcript: string): Turn[] {
  const turns: Turn[] = [];
  for (const raw of transcript.split(/\r?\n/)) {
    const line = clean(raw); if (!line) continue;
    const match = /^([^:]{1,40}):\s*(.+)$/.exec(line);
    if (!match) { turns.push({ speaker: "unbekannt", text: line }); continue; }
    const label = match[1].toLowerCase().trim();
    const speaker: Turn["speaker"] = /kunde|customer|interessent|anrufer|sprecher\s*2|speaker\s*2/.test(label) || label === "b" ? "kunde" : /agent|berater|mitarbeiter|callcenter|verkäufer|verkaeufer|sprecher\s*1|speaker\s*1/.test(label) || label === "a" ? "agent" : "unbekannt";
    turns.push({ speaker, text: match[2].trim() });
  }
  return turns;
}

const FACT_RULES: Array<{ test: RegExp; point: string; negative?: RegExp }> = [
  { test: /\btermin\b/i, point: "Termin besprochen", negative: /kein(en)? termin/i },
  { test: /rückruf|rueckruf|zurückrufen|zurueckrufen|später (noch ?mal|nochmal) anrufen|nächste woche|naechste woche/i, point: "Rückruf gewünscht" },
  { test: /angebot/i, point: "Angebot gewünscht", negative: /kein angebot/i },
  { test: /eigentümer|eigentuemer|gehört (mir|uns)|unser haus|eigenes haus/i, point: "Eigentümer bestätigt", negative: /kein(e)? eigentümer|miete|mieter|gemietet/i },
  { test: /miete|mieter|gemietet/i, point: "Mieter (kein Eigentum)" },
  { test: /zu teuer|kein budget|kein geld|preis.{0,20}(hoch|viel)/i, point: "Einwand: Preis" },
  { test: /keine zeit|gerade schlecht|ungünstig|unguenstig/i, point: "Einwand: keine Zeit" },
  { test: /kein interesse|nicht interessiert|nein danke|brauche(n)? (wir|ich) nicht/i, point: "Kein Interesse geäußert" },
  { test: /schon (einen|ein|eine) (anbieter|firma|fachbetrieb)|bereits (beauftragt|bestellt|versorgt)/i, point: "Bereits versorgt / anderer Anbieter" },
  { test: /per e-?mail|schicken sie|unterlagen|infos? zusenden|informationen zusenden/i, point: "Unterlagen per E-Mail gewünscht" },
  { test: /fachbetrieb darf|darf sich melden|dürfen sich melden|kontakt aufnehmen/i, point: "Kontakt durch Fachbetrieb erlaubt" },
  { test: /pflegegrad|rezept|krankenkasse/i, point: "Krankenkasse/Pflegegrad angesprochen" },
  { test: /(\d+)\s*(monat|wochen|jahr)/i, point: "Zeitrahmen genannt" },
  { test: /sofort|so schnell wie möglich|dringend/i, point: "Zeitrahmen: kurzfristig" },
  { test: /förder|foerder|zuschuss|kfw|bafa/i, point: "Förderung angesprochen" },
];

/** Kurzfassung ohne KI: Kernaussagen des Kunden plus erkannte Fakten aus dem Transkript. */
export function heuristicCallSummary(transcript: string): CallSummary {
  const turns = parseTranscript(transcript);
  const customer = turns.filter((turn) => turn.speaker === "kunde");
  const relevant = (customer.length ? customer : turns).map((turn) => turn.text);
  const text = turns.map((turn) => turn.text).join(" ");
  const points: string[] = [];
  for (const rule of FACT_RULES) if (rule.test.test(text) && !(rule.negative && rule.negative.test(text)) && !points.includes(rule.point)) points.push(rule.point);
  const core = relevant.filter((line) => line.length > 12).slice(0, 2).map((line) => clean(line));
  const summary = core.length ? `Kunde: ${core.map((line) => (line.length > 160 ? `${line.slice(0, 157).trim()}…` : line)).join(" ")}` : `Gespräch mit ${turns.length} Beiträgen – keine ausführliche Kundenaussage erkannt.`;
  const nextStep = points.includes("Kein Interesse geäußert") ? "Kein weiterer Kontakt, Ergebnis festhalten." : points.includes("Rückruf gewünscht") ? "Wiedervorlage anlegen und zurückrufen." : points.includes("Termin besprochen") ? "Termin bestätigen und Fachbetrieb informieren." : points.includes("Unterlagen per E-Mail gewünscht") ? "Unterlagen per E-Mail senden." : points.includes("Angebot gewünscht") || points.includes("Kontakt durch Fachbetrieb erlaubt") ? "Anfrage an Fachbetrieb weiterleiten." : null;
  return { summary, points: points.slice(0, 6), nextStep, source: "kurzfassung" };
}

/** Notiztext zusammenbauen – gleicher Aufbau für Server und Chat-Demo. */
export function formatCallNote(facts: CallNoteFacts, summary: CallSummary | null): string {
  const started = facts.startedAt ? new Date(facts.startedAt) : null;
  const when = started && !Number.isNaN(started.getTime()) ? started.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  const head = [when, formatTalkTime(facts.talkSeconds), facts.agentName ? `Agent ${facts.agentName.split(" ")[0]}` : null, facts.campaignName ?? (facts.mode ? `Dialer ${facts.mode}` : null)].filter(Boolean).join(" · ");
  const lines: string[] = [`📞 ${AUTO_NOTE_TITLE}${head ? ` – ${head}` : ""}`];
  if (summary) {
    lines.push(sentenceCase(summary.summary.trim()));
    for (const point of summary.points) lines.push(`• ${point}`);
    if (summary.nextStep) lines.push(`Nächster Schritt: ${summary.nextStep}`);
  } else if (facts.statusLabel && facts.statusLabel !== "Beendet") {
    lines.push(`Kein Gespräch zustande gekommen: ${facts.statusLabel}.`);
  } else {
    lines.push("Kein Transkript vorhanden – Notiz aus den Anrufdaten.");
  }
  if (facts.dispositionLabel) lines.push(`Ergebnis: ${facts.dispositionLabel}`);
  if (facts.agentNotes?.trim()) lines.push(`Notiz des Agenten: ${clean(facts.agentNotes)}`);
  if (summary) lines.push(summary.source === "ki" ? "Zusammenfassung von der KI erstellt." : summary.source === "kurzfassung" ? "Kurzfassung aus dem Transkript (ohne KI-Schlüssel)." : "Aus den Anrufdaten erstellt.");
  return lines.join("\n").slice(0, 4000);
}

export const AUTO_NOTE_HELP = "Nach jedem Gespräch entsteht automatisch eine Notiz am Kontakt: Zusammenfassung, wichtige Punkte und nächster Schritt – aus dem Transkript (mit KI-Schlüssel ausführlich, sonst als Kurzfassung), ohne Aufzeichnung aus Ergebnis, Dauer und Agenten-Notiz.";
