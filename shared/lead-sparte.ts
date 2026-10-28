/**
 * Leadsparte einer E-Mail-Kampagne: Worum geht es thematisch (Photovoltaik & Wärmepumpe, Hausnotruf, Elektrorollstuhl,
 * Alarmanlage …)? Die KI schreibt Vorlagen und E-Mails passend zu genau dieser Sparte – nie Wärmepumpen-Texte an
 * Hausnotruf-Firmen. Ohne Angabe wird die Sparte aus dem Kampagnennamen bzw. den Listen erkannt, sonst gilt PV & WP.
 * Gemeinsam für Server, Chat-Demo und Oberfläche.
 */
export type Sparte = {
  /** fester Schlüssel bekannter Sparten, „eigene“ für frei eingetragene */
  key: string;
  /** so heißt sie in der Oberfläche */
  label: string;
  /** im Satz nach „für“: „Lead-Lieferant für Hausnotruf“, „… für Elektrorollstühle“ – auch der Platzhalter {{sparte}} */
  topic: string;
  /** „Hausnotruf-Leads“ */
  leads: string;
  /** wen wir anschreiben: „Anbieter von Hausnotruf“ */
  recipients: string;
  /** bei wem sich der Interessent meldet: „Fachbetrieb“, „Anbieter“, „Fachhändler“ */
  partner: string;
  /** woran man die Sparte in Namen und Listen erkennt */
  match: RegExp;
};

const PV_RE = /photovoltaik|solar|\bpv\b|pv[-\s]|pv-?anlage/i;
const WP_RE = /wärmepumpe|waermepumpe|\bwp\b/i;
export const SPARTEN: Sparte[] = [
  { key: "pv-wp", label: "Photovoltaik & Wärmepumpe", topic: "Photovoltaik und Wärmepumpen", leads: "PV- und Wärmepumpen-Leads", recipients: "PV- und Wärmepumpen-Fachbetriebe und Energieversorger", partner: "Fachbetrieb", match: /(?!)/ },
  { key: "photovoltaik", label: "Photovoltaik", topic: "Photovoltaik", leads: "Photovoltaik-Leads", recipients: "Photovoltaik-Fachbetriebe und Solarteure", partner: "Fachbetrieb", match: PV_RE },
  { key: "waermepumpe", label: "Wärmepumpe", topic: "Wärmepumpen", leads: "Wärmepumpen-Leads", recipients: "Wärmepumpen-Fachbetriebe und Heizungsbauer", partner: "Fachbetrieb", match: WP_RE },
  { key: "hausnotruf", label: "Hausnotruf", topic: "Hausnotruf", leads: "Hausnotruf-Leads", recipients: "Anbieter von Hausnotruf-Systemen", partner: "Anbieter", match: /hausnotruf|notrufsystem|notruf|haus-notruf/i },
  { key: "pflegebox", label: "Pflegebox", topic: "Pflegeboxen", leads: "Pflegebox-Leads", recipients: "Anbieter von Pflegeboxen und Pflegehilfsmitteln", partner: "Anbieter", match: /pflegebox|pflegehilfsmittel|pflege-box/i },
  { key: "elektrorollstuhl", label: "Elektrorollstuhl", topic: "Elektrorollstühle", leads: "Elektrorollstuhl-Leads", recipients: "Fachhändler und Sanitätshäuser für Elektrorollstühle", partner: "Fachhändler", match: /elektro-?\s?rollst|e-?rollst|rollstuhl|rollstühle/i },
  { key: "rollator", label: "Rollator", topic: "Rollatoren", leads: "Rollator-Leads", recipients: "Fachhändler und Sanitätshäuser für Rollatoren", partner: "Fachhändler", match: /rollator/i },
  { key: "treppenlift", label: "Treppenlift", topic: "Treppenlifte", leads: "Treppenlift-Leads", recipients: "Anbieter und Fachbetriebe für Treppenlifte", partner: "Fachbetrieb", match: /treppenlift|sitzlift|plattformlift/i },
  { key: "bad", label: "Barrierefreies Bad", topic: "barrierefreie Bäder", leads: "Leads für barrierefreie Bäder", recipients: "Fachbetriebe für barrierefreie Badumbauten", partner: "Fachbetrieb", match: /barrierefrei|badumbau|bäder|baeder|badsanierung/i },
  { key: "alarmanlage", label: "Alarmanlage", topic: "Alarmanlagen", leads: "Alarmanlagen-Leads", recipients: "Errichter und Fachbetriebe für Alarmanlagen und Sicherheitstechnik", partner: "Fachbetrieb", match: /alarm|einbruchschutz|einbruchmelde|sicherheitstechnik/i },
  { key: "fenster", label: "Fenster", topic: "Fenster", leads: "Fenster-Leads", recipients: "Fensterbauer und Fachbetriebe für Fenster", partner: "Fachbetrieb", match: /fenster/i },
  { key: "wintergarten", label: "Wintergarten", topic: "Wintergärten", leads: "Wintergarten-Leads", recipients: "Fachbetriebe für Wintergärten", partner: "Fachbetrieb", match: /wintergarten|wintergärten/i },
];
export const DEFAULT_SPARTE = SPARTEN[0];
/** Vorschläge für das Eingabefeld (frei eintragbar bleibt es trotzdem). */
export const SPARTE_SUGGESTIONS = SPARTEN.map((item) => item.label);

const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
/** Sparte aus Texten erkennen (Kampagnenname, Listen): „PV & WP …“ → Photovoltaik & Wärmepumpe, „Hausnotruf • …“ → Hausnotruf. */
export function detectSparte(...texts: Array<string | null | undefined>): Sparte | null {
  const text = texts.filter(Boolean).join(" · "); if (!text.trim()) return null;
  const pv = PV_RE.test(text); const wp = WP_RE.test(text);
  // eindeutige Sparten zuerst (ein „Elektro“ allein ist noch kein Rollstuhl; „Notruf“ vor allem anderen)
  const pick = (keys: string[]) => { for (const key of keys) { const sparte = SPARTEN.find((item) => item.key === key)!; if (sparte.match.test(text)) return sparte; } return null; };
  const specific = pick(["hausnotruf", "pflegebox", "elektrorollstuhl", "rollator", "treppenlift", "alarmanlage", "wintergarten"]); if (specific) return specific;
  if (pv && wp) return SPARTEN[0]; if (pv) return SPARTEN[1]; if (wp) return SPARTEN[2];
  return pick(["fenster", "bad"]);
}
/** Eingetragene Sparte auflösen: bekannte über Name/Stichwort, sonst als eigene Sparte mit genau diesem Wortlaut. */
export function resolveSparte(value: string | null | undefined): Sparte | null {
  const text = (value ?? "").trim().slice(0, 120); if (!text) return null;
  const exact = SPARTEN.find((item) => norm(item.label) === norm(text) || item.key === norm(text)); if (exact) return exact;
  const detected = detectSparte(text); if (detected && norm(detected.label).length >= norm(text).length - 6) return detected; // „Hausnotrufe“, „Alarmanlagen“ → bekannte Sparte
  return { key: "eigene", label: text, topic: text, leads: `Leads für ${text}`, recipients: `Anbieter und Fachbetriebe im Bereich ${text}`, partner: "Anbieter", match: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") };
}
/** Sparte einer Kampagne: eingetragen → erkannt aus Name und Listen → Photovoltaik & Wärmepumpe. `source` sagt, woher sie kommt. */
export function sparteOf(campaign: { leadSparte?: string | null; name?: string | null }, lists: string[] = []): Sparte & { source: "eingetragen" | "erkannt" | "standard" } {
  const set = resolveSparte(campaign.leadSparte); if (set) return { ...set, source: "eingetragen" };
  const found = detectSparte(campaign.name) ?? detectSparte(...lists); if (found) return { ...found, source: "erkannt" }; // der Name zählt vor den Listen
  return { ...DEFAULT_SPARTE, source: "standard" };
}
/** Photovoltaik und/oder Wärmepumpe? */
export const isEnergySparte = (sparte: Pick<Sparte, "key">) => sparte.key === "pv-wp" || sparte.key === "photovoltaik" || sparte.key === "waermepumpe";
const isEnergy = isEnergySparte;
/** Passt der Text zur Sparte? In jeder Sparte außer PV/WP darf nichts von Photovoltaik oder Wärmepumpen stehen. */
export function fitsSparte(sparte: Pick<Sparte, "key"> & { label?: string }, text: string): boolean { const energyLabel = sparte.key === "eigene" && (PV_RE.test(sparte.label ?? "") || WP_RE.test(sparte.label ?? "")); /* eigene Sparte wie „Batteriespeicher für PV“ */ return isEnergy(sparte) || energyLabel || !(PV_RE.test(text) || WP_RE.test(text)); }
/** Hinweis im Builder: Vorlage spricht von Photovoltaik/Wärmepumpe, die Kampagne hat aber eine andere Sparte. */
export function foreignSparteIn(sparte: Pick<Sparte, "key"> & { label?: string }, text: string): string | null { return fitsSparte(sparte, text) ? null : "Photovoltaik/Wärmepumpe"; }
/** Der Satzteil in alten Vorlagen, der fest auf PV & WP stand – wird durch den Platzhalter {{sparte}} ersetzt. */
export const OLD_ENERGY_PHRASE = "Lead-Lieferanten in Deutschland für Photovoltaik und Wärmepumpen";
export const SPARTE_PHRASE = "Lead-Lieferanten in Deutschland für {{sparte}}";
/** Platzhalter {{sparte}}: ohne Kampagne „Ihre Branche“ – mit Kampagne deren Sparte (ein Wert aus der Liste des Kontakts hat Vorrang). */
export const SPARTE_FALLBACK = "Ihre Branche";
export function withSparte<T extends Record<string, string>>(values: T, sparte: Pick<Sparte, "topic">): T { return { ...values, sparte: values.sparte && values.sparte !== SPARTE_FALLBACK ? values.sparte : sparte.topic }; }
