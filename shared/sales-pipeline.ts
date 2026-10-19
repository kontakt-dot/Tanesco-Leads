/** Vertriebspipeline: Stufen (je Mandant anpassbar) vom Lead bis zum Kunden, Kampagnen-Auswertung (Kosten je Lead/Kunde). */
export type PipelineStage = string;
export type StageDef = { key: string; label: string; hint: string; fixed?: "entry" | "won" | "lost"; color?: string };
/** Standardfarben der Stufen (gleich wie im Board); eigene Stufen bekommen reihum eine Farbe. Eigene Farbe (color) gewinnt. */
export const STAGE_COLOR_DEFAULTS: Record<string, string> = { neu: "#8b7cff", in_bearbeitung: "#60a5fa", kontaktiert: "#22d3ee", qualifiziert: "#a3e635", termin: "#fbbf24", angebot: "#fb923c", kunde: "#34d399", verloren: "#fb7185" };
const STAGE_COLOR_CYCLE = ["#8b7cff", "#60a5fa", "#22d3ee", "#a3e635", "#fbbf24", "#fb923c", "#f472b6", "#c084fc", "#2dd4bf", "#facc15"];
export const isStageColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
/** Stufenfarbe: eigene Farbe (color) gewinnt, sonst die Standardfarbe der Stufe. trafficLightColor bleibt als Hilfsfunktion. */
const hslHex = (h: number, sat: number, light: number) => { const s = sat / 100; const l = light / 100; const k = (n: number) => (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`; };
export const LOST_STAGE_COLOR = "#94a3b8";
export function trafficLightColor(position: number, count: number): string { const t = count > 1 ? Math.min(1, Math.max(0, position / (count - 1))) : 1; const eased = Math.pow(t, 1.3); return hslHex(Math.round(4 + eased * 138), 76, Math.round(52 - eased * 10)); }
export function stageColor(stage: Pick<StageDef, "key" | "color" | "fixed">, index = 0, stages?: Array<Pick<StageDef, "key" | "fixed">>): string {
  if (isStageColor(stage.color)) return stage.color.toLowerCase();
  void stages; // Standardfarben wie zu Beginn (Ampel auf Wunsch wieder entfernt)
  if (stage.fixed === "won") return STAGE_COLOR_DEFAULTS.kunde; if (stage.fixed === "lost") return STAGE_COLOR_DEFAULTS.verloren; if (stage.fixed === "entry") return STAGE_COLOR_DEFAULTS.neu;
  return STAGE_COLOR_DEFAULTS[stage.key] ?? STAGE_COLOR_CYCLE[index % STAGE_COLOR_CYCLE.length];
}
export const PIPELINE_STAGES: StageDef[] = [
  { key: "neu", label: "Neu", hint: "Gerade eingegangen", fixed: "entry" },
  { key: "in_bearbeitung", label: "In Bearbeitung", hint: "Wird gerade angerufen – der Zähler zeigt die Versuche" },
  { key: "kontaktiert", label: "Kontaktiert", hint: "Erreicht – erstes Gespräch geführt" },
  { key: "qualifiziert", label: "Qualifiziert", hint: "Bedarf, Budget und Zeitrahmen passen" },
  { key: "termin", label: "Termin", hint: "Beratungs- oder Vor-Ort-Termin vereinbart" },
  { key: "angebot", label: "Angebot", hint: "Angebot verschickt" },
  { key: "kunde", label: "Kunde", hint: "Auftrag erteilt – gewonnen", fixed: "won" },
  { key: "verloren", label: "Verloren", hint: "Kein Abschluss", fixed: "lost" },
];
export const STAGE_ORDER: string[] = PIPELINE_STAGES.map((stage) => stage.key);
/** Die drei Pipelines – jede kann eigene Stufen haben; „alle“ ist der gemeinsame Standard, der gilt, solange eine Pipeline keine eigenen Stufen hat. */
export type BuiltinPipelineSource = "ads" | "kaltakquise" | "email";
/** Eigene Pipelines (angelegt in der Vertriebspipeline) heißen „p-…“ und funktionieren wie die Kaltakquise. */
export type CustomPipelineSource = `p-${string}`;
export type PipelineSource = BuiltinPipelineSource | CustomPipelineSource;
export const CUSTOM_PIPELINE_RE = /^p-[a-z0-9]{2,14}$/;
export const isCustomSource = (value: unknown): value is CustomPipelineSource => typeof value === "string" && CUSTOM_PIPELINE_RE.test(value);
export const isPipelineSource = (value: unknown): value is PipelineSource => value === "ads" || value === "kaltakquise" || value === "email" || isCustomSource(value);
/** Wie die Kaltakquise: Listen hochladen, anrufen, Kontakte von Hand – gilt für die Kaltakquise und alle eigenen Pipelines. */
export const isColdLike = (source: unknown) => source === "kaltakquise" || isCustomSource(source);
/** Welche Plattform-Kennung bekommt ein Kontakt in dieser Pipeline? (Eigene Pipelines: ihre Kennung selbst.) */
export const platformForSource = (source: PipelineSource) => source === "kaltakquise" ? "kaltakquise" : source === "email" ? "email" : isCustomSource(source) ? source : "facebook";
/** Neue Kennung aus dem Namen: „p-“ + bis zu 9 Buchstaben/Ziffern + 3 Zufallszeichen (passt in alle Spalten). */
export const newCustomSourceKey = (label: string) => `p-${(label.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "").slice(0, 9) || "pipe")}${Math.random().toString(36).replace(/[^a-z0-9]/g, "").slice(0, 3).padEnd(3, "x")}` as CustomPipelineSource;
export const PIPELINE_SOURCES: BuiltinPipelineSource[] = ["email", "ads", "kaltakquise"]; // Reihenfolge wie die Karten in der Vertriebspipeline
export const PIPELINE_SOURCE_LABEL: Record<BuiltinPipelineSource, string> = { ads: "Meta Ads", kaltakquise: "Kaltakquise", email: "E-Mail-Kampagne" };
/** Anzeigename einer Pipeline – eigene Pipelines aus der Liste in den Einstellungen. */
export const pipelineLabel = (source: PipelineSource | null | undefined, custom: Array<{ key: string; label: string }> = []): string => !source ? "Pipeline" : isCustomSource(source) ? custom.find((item) => item.key === source)?.label ?? "Eigene Pipeline" : PIPELINE_SOURCE_LABEL[source];
/** Zu welcher Pipeline gehört ein Kontakt? Dieselbe Regel wie im Board. */
export const pipelineSourceOf = (adPlatform: string | null | undefined): PipelineSource => adPlatform === "kaltakquise" ? "kaltakquise" : adPlatform === "email" ? "email" : isCustomSource(adPlatform) ? adPlatform : "ads";
export type StageSets = { alle: StageDef[]; ads: StageDef[]; kaltakquise: StageDef[]; email: StageDef[] } & Record<string, StageDef[]>;
/** Stufen einer Pipeline – eigene Pipelines ohne eigene Stufen nutzen den Standard. */
export const stagesOf = (sets: StageSets, source: PipelineSource | "alle" | null | undefined): StageDef[] => sets[source ?? "alle"] ?? sets.alle;
/** Stufen-Sätze aus gespeicherten Zeilen bauen: „alle“ ist der Standard, jede Pipeline ohne eigene Zeile nutzt ihn. */
export function buildStageSets(rows: Array<{ source?: string | null; stages: unknown }>, fallback: StageDef[] = PIPELINE_STAGES): StageSets {
  const parse = (row: { stages: unknown } | undefined) => { if (!row || !Array.isArray(row.stages)) return null; const stages = normalizeStages(row.stages as StageDef[]).stages; return stages.length ? stages : null; };
  const base = parse(rows.find((row) => (row.source ?? "alle") === "alle")) ?? fallback;
  const pick = (source: PipelineSource) => parse(rows.find((row) => row.source === source)) ?? base;
  const out: StageSets = { alle: base, ads: pick("ads"), kaltakquise: pick("kaltakquise"), email: pick("email") };
  for (const row of rows) if (isCustomSource(row.source)) { const own = parse(row); if (own) out[row.source] = own; }
  return out;
}
export const stagesForLead = (sets: StageSets, lead: { adPlatform?: string | null }) => stagesOf(sets, pipelineSourceOf(lead.adPlatform));
/** Alle Stufen aller Pipelines zusammen (für Einstellungen, die pipeline-übergreifend gelten) – gleiche Schlüssel nur einmal. */
export const unionStages = (sets: StageSets): StageDef[] => { const seen = new Map<string, StageDef>(); for (const list of Object.values(sets)) for (const stage of list) if (!seen.has(stage.key)) seen.set(stage.key, stage); return Array.from(seen.values()); };
export const isStage = (value: unknown, stages: StageDef[] = PIPELINE_STAGES): value is PipelineStage => typeof value === "string" && stages.some((stage) => stage.key === value);
export const stageLabel = (key: string | null | undefined, stages: StageDef[] = PIPELINE_STAGES) => stages.find((stage) => stage.key === key)?.label ?? stages[0]?.label ?? "Neu";
export const slugStage = (label: string) => `stufe_${label.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "neu"}`;
/** Prüft eine Stufenliste: Eintritt, Gewonnen und Verloren müssen vorhanden sein; Schlüssel eindeutig; Labels gesetzt. Gibt die bereinigte Liste zurück. */
export function normalizeStages(input: Array<Partial<StageDef>>): { stages: StageDef[]; issues: string[] } {
  const issues: string[] = []; const seen = new Set<string>(); const stages: StageDef[] = [];
  for (const item of input) { const label = String(item.label ?? "").trim(); if (!label) { issues.push("Eine Stufe hat keinen Namen."); continue; } let key = String(item.key ?? "").trim() || slugStage(label); if (seen.has(key)) { issues.push(`Die Stufe „${label}“ ist doppelt.`); continue; } seen.add(key); stages.push({ key, label: label.slice(0, 40), hint: String(item.hint ?? "").trim().slice(0, 120), ...(item.fixed ? { fixed: item.fixed } : {}), ...(isStageColor(item.color) ? { color: item.color.toLowerCase() } : {}) }); }
  if (!stages.some((stage) => stage.fixed === "entry")) issues.push("Die Eingangsstufe („Neu“) darf nicht fehlen."); if (!stages.some((stage) => stage.fixed === "won")) issues.push("Die Gewonnen-Stufe („Kunde“) darf nicht fehlen."); if (!stages.some((stage) => stage.fixed === "lost")) issues.push("Die Verloren-Stufe darf nicht fehlen.");
  if (stages.length > 12) issues.push("Höchstens 12 Stufen.");
  const entry = stages.find((stage) => stage.fixed === "entry"); const lost = stages.find((stage) => stage.fixed === "lost");
  const ordered = [...(entry ? [entry] : []), ...stages.filter((stage) => stage !== entry && stage !== lost), ...(lost ? [lost] : [])];
  return { stages: ordered, issues };
}
export const entryStage = (stages: StageDef[] = PIPELINE_STAGES) => stages.find((stage) => stage.fixed === "entry")?.key ?? stages[0]?.key ?? "neu";
export const wonStage = (stages: StageDef[] = PIPELINE_STAGES) => stages.find((stage) => stage.fixed === "won")?.key ?? "kunde";
export const lostStage = (stages: StageDef[] = PIPELINE_STAGES) => stages.find((stage) => stage.fixed === "lost")?.key ?? "verloren";
/** Stufe „In Bearbeitung“ (wird gerade angerufen) – per Schlüssel oder, bei eigenen Stufen, am Namen erkannt. */
export const workingStage = (stages: StageDef[] = PIPELINE_STAGES) => (stages.find((stage) => stage.key === "in_bearbeitung") ?? stages.find((stage) => /bearbeitung|wird angerufen|anrufen/i.test(stage.label) && !stage.fixed))?.key ?? null;
/** Stufe „Kontaktiert“ (erreicht) – per Schlüssel oder am Namen. */
export const contactedStage = (stages: StageDef[] = PIPELINE_STAGES) => (stages.find((stage) => stage.key === "kontaktiert") ?? stages.find((stage) => /kontaktiert|erreicht/i.test(stage.label) && !stage.fixed))?.key ?? null;
export const nextStageKey = (current: string, stages: StageDef[] = PIPELINE_STAGES) => { const index = stages.findIndex((stage) => stage.key === current); if (index < 0) return null; const next = stages[index + 1]; return next && next.fixed !== "lost" ? next.key : null; };
const stageOf = (value: string | null | undefined, stages: StageDef[]) => (isStage(value, stages) ? value : entryStage(stages));

export type PipelineLead = { id: number; publicId: string; name: string; createdAt: Date | string; pipelineStage: string | null; pipelineUpdatedAt?: Date | string | null; adCampaignId: string | null; adCampaignName: string | null; adsetName: string | null; adName: string | null; adFormName: string | null; adPlatform: string | null; categoryId: number | null; categoryName?: string | null; categoryColor?: string | null; city?: string | null; postcode?: string | null; phone?: string | null; email?: string | null; status?: string; ownerUserId?: number | null; ownerName?: string | null; company?: string | null; lastNote?: string | null };
export type InsightRow = { day: string; campaignId: string; campaignName: string | null; adsetId: string | null; adsetName: string | null; adId: string | null; adName: string | null; objective?: string | null; status?: string | null; dailyBudget?: string | number | null; spend: string | number; impressions: number; clicks: number; results: number };

/** Kampagnen-Übersicht: je Kampagne Ausgaben, Reichweite, Leads je Stufe, Kosten je Lead und je Kunde. */
export function summarizeCampaigns(leads: PipelineLead[], insights: InsightRow[], stages: StageDef[] = PIPELINE_STAGES) {
  const won = wonStage(stages); const lost = lostStage(stages); const emptyStages = () => Object.fromEntries(stages.map((stage) => [stage.key, 0])) as Record<string, number>;
  const map = new Map<string, { campaignId: string; campaignName: string; objective: string | null; status: string | null; dailyBudget: number | null; spend: number; impressions: number; clicks: number; results: number; adsets: Set<string>; ads: Set<string>; forms: Set<string>; leads: number; stages: Record<string, number>; lastLeadAt: Date | null }>();
  const ensure = (id: string, name: string | null) => { let entry = map.get(id); if (!entry) { entry = { campaignId: id, campaignName: name ?? id, objective: null, status: null, dailyBudget: null, spend: 0, impressions: 0, clicks: 0, results: 0, adsets: new Set(), ads: new Set(), forms: new Set(), leads: 0, stages: emptyStages(), lastLeadAt: null }; map.set(id, entry); } else if (name && entry.campaignName === id) entry.campaignName = name; return entry; };
  for (const row of insights) { const entry = ensure(row.campaignId, row.campaignName); entry.spend += Number(row.spend ?? 0); entry.impressions += row.impressions ?? 0; entry.clicks += row.clicks ?? 0; entry.results += row.results ?? 0; if (row.adsetName) entry.adsets.add(row.adsetName); if (row.adName) entry.ads.add(row.adName); if (row.objective) entry.objective = row.objective; if (row.status) entry.status = row.status; if (row.dailyBudget !== null && row.dailyBudget !== undefined) entry.dailyBudget = Number(row.dailyBudget); }
  for (const lead of leads) { const id = lead.adCampaignId ?? "ohne-kampagne"; const entry = ensure(id, lead.adCampaignName ?? (id === "ohne-kampagne" ? "Ohne Kampagne" : null)); entry.leads += 1; entry.stages[stageOf(lead.pipelineStage, stages)] += 1; if (lead.adFormName) entry.forms.add(lead.adFormName); const at = new Date(lead.createdAt); if (!entry.lastLeadAt || at > entry.lastLeadAt) entry.lastLeadAt = at; }
  return Array.from(map.values()).map((entry) => { const customers = entry.stages[won] ?? 0; const active = entry.leads - (entry.stages[lost] ?? 0); return { ...entry, adsets: Array.from(entry.adsets), ads: Array.from(entry.ads), forms: Array.from(entry.forms), customers, activeLeads: active, costPerLead: entry.leads && entry.spend ? entry.spend / entry.leads : null, costPerCustomer: customers && entry.spend ? entry.spend / customers : null, conversion: entry.leads ? Math.round((customers / entry.leads) * 100) : 0, ctr: entry.impressions ? Math.round((entry.clicks / entry.impressions) * 10000) / 100 : 0 }; }).sort((a, b) => b.leads - a.leads || b.spend - a.spend);
}

/** Funnel über alle (gefilterten) Leads: wie viele haben jede Stufe mindestens erreicht. */
export function funnel(leads: PipelineLead[], stages: StageDef[] = PIPELINE_STAGES) {
  const order = stages.filter((stage) => stage.fixed !== "lost").map((stage) => stage.key); const lost = lostStage(stages);
  const reached = (stage: string) => leads.filter((lead) => { const current = stageOf(lead.pipelineStage, stages); if (current === lost) return stage === order[0]; return order.indexOf(current) >= order.indexOf(stage); }).length;
  const steps = order.map((stage) => ({ stage, label: stageLabel(stage, stages), count: reached(stage) }));
  return { steps: steps.map((step, index) => ({ ...step, share: steps[0].count ? Math.round((step.count / steps[0].count) * 100) : 0, dropFromPrevious: index ? steps[index - 1].count - step.count : 0 })), lost: leads.filter((lead) => lead.pipelineStage === lost).length };
}

/** Felder eines Meta-Lead-Formulars → Lead-Felder (E-Mail, Telefon, Name, PLZ, Ort) + restliche Antworten. */
export function mapMetaFieldData(fieldData: Array<{ name: string; values?: unknown[] }>) {
  const out: { firstName?: string; lastName?: string; email?: string; phone?: string; postcode?: string; city?: string; street?: string; answers: Record<string, string> } = { answers: {} };
  for (const field of fieldData ?? []) { const key = String(field.name ?? "").toLowerCase(); const value = String(field.values?.[0] ?? "").trim(); if (!value) continue;
    if (/^(email|e-mail|e_mail)$/.test(key)) out.email = value.toLowerCase();
    else if (/^(phone|phone_number|telefon|telefonnummer|mobile)$/.test(key)) out.phone = value;
    else if (/^(first_name|vorname)$/.test(key)) out.firstName = value;
    else if (/^(last_name|nachname)$/.test(key)) out.lastName = value;
    else if (/^(full_name|name)$/.test(key)) { const [first, ...rest] = value.split(/\s+/); out.firstName = out.firstName ?? first; out.lastName = out.lastName ?? rest.join(" "); }
    else if (/^(zip_code|post_code|zip|plz|postleitzahl)$/.test(key)) out.postcode = value;
    else if (/^(city|stadt|ort)$/.test(key)) out.city = value;
    else if (/^(street_address|street|strasse|straße|adresse)$/.test(key)) out.street = value;
    else out.answers[key] = value; }
  return out;
}
/** Beschriftung der Schritte im Karten-Verlauf (Stufen + Ereignisse der Erweiterungen). */
export const historyLabel = (toStage: string, stageDefs: StageDef[]) => ({ besitzer: "Zuteilung", notiz: "Notiz", wiedervorlage: "Wiedervorlage", erledigt: "Erledigt", termin_gesetzt: "Termin", termin_entfernt: "Termin entfernt", angebotswert: "Angebotswert", sms: "SMS", whatsapp: "WhatsApp", email: "E-Mail", serie: "E-Mail-Serie", kontakt: "Kontaktdaten", anruf: "Anruf" } as Record<string, string>)[toStage] ?? stageLabel(toStage, stageDefs);
