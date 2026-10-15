/** Vertriebspipeline: Stufen (je Mandant anpassbar) vom Lead bis zum Kunden, Kampagnen-Auswertung (Kosten je Lead/Kunde). */
export type PipelineStage = string;
export type StageDef = { key: string; label: string; hint: string; fixed?: "entry" | "won" | "lost" };
export const PIPELINE_STAGES: StageDef[] = [
  { key: "neu", label: "Neu", hint: "Gerade eingegangen", fixed: "entry" },
  { key: "kontaktiert", label: "Kontaktiert", hint: "Erster Anruf/Nachricht erfolgt" },
  { key: "qualifiziert", label: "Qualifiziert", hint: "Bedarf, Budget und Zeitrahmen passen" },
  { key: "termin", label: "Termin", hint: "Beratungs- oder Vor-Ort-Termin vereinbart" },
  { key: "angebot", label: "Angebot", hint: "Angebot verschickt" },
  { key: "kunde", label: "Kunde", hint: "Auftrag erteilt – gewonnen", fixed: "won" },
  { key: "verloren", label: "Verloren", hint: "Kein Abschluss", fixed: "lost" },
];
export const STAGE_ORDER: string[] = PIPELINE_STAGES.map((stage) => stage.key);
/** Die drei Pipelines – jede kann eigene Stufen haben; „alle“ ist der gemeinsame Standard, der gilt, solange eine Pipeline keine eigenen Stufen hat. */
export type PipelineSource = "ads" | "kaltakquise" | "email";
export const PIPELINE_SOURCES: PipelineSource[] = ["ads", "kaltakquise", "email"];
export const PIPELINE_SOURCE_LABEL: Record<PipelineSource, string> = { ads: "Meta Ads", kaltakquise: "Kaltakquise", email: "E-Mail-Kampagne" };
/** Zu welcher Pipeline gehört ein Kontakt? Dieselbe Regel wie im Board. */
export const pipelineSourceOf = (adPlatform: string | null | undefined): PipelineSource => adPlatform === "kaltakquise" ? "kaltakquise" : adPlatform === "email" ? "email" : "ads";
export type StageSets = Record<PipelineSource | "alle", StageDef[]>;
/** Stufen-Sätze aus gespeicherten Zeilen bauen: „alle“ ist der Standard, jede Pipeline ohne eigene Zeile nutzt ihn. */
export function buildStageSets(rows: Array<{ source?: string | null; stages: unknown }>, fallback: StageDef[] = PIPELINE_STAGES): StageSets {
  const parse = (row: { stages: unknown } | undefined) => { if (!row || !Array.isArray(row.stages)) return null; const stages = normalizeStages(row.stages as StageDef[]).stages; return stages.length ? stages : null; };
  const base = parse(rows.find((row) => (row.source ?? "alle") === "alle")) ?? fallback;
  const pick = (source: PipelineSource) => parse(rows.find((row) => row.source === source)) ?? base;
  return { alle: base, ads: pick("ads"), kaltakquise: pick("kaltakquise"), email: pick("email") };
}
export const stagesForLead = (sets: StageSets, lead: { adPlatform?: string | null }) => sets[pipelineSourceOf(lead.adPlatform)];
/** Alle Stufen aller Pipelines zusammen (für Einstellungen, die pipeline-übergreifend gelten) – gleiche Schlüssel nur einmal. */
export const unionStages = (sets: StageSets): StageDef[] => { const seen = new Map<string, StageDef>(); for (const list of [sets.alle, sets.ads, sets.kaltakquise, sets.email]) for (const stage of list) if (!seen.has(stage.key)) seen.set(stage.key, stage); return Array.from(seen.values()); };
export const isStage = (value: unknown, stages: StageDef[] = PIPELINE_STAGES): value is PipelineStage => typeof value === "string" && stages.some((stage) => stage.key === value);
export const stageLabel = (key: string | null | undefined, stages: StageDef[] = PIPELINE_STAGES) => stages.find((stage) => stage.key === key)?.label ?? stages[0]?.label ?? "Neu";
export const slugStage = (label: string) => `stufe_${label.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "neu"}`;
/** Prüft eine Stufenliste: Eintritt, Gewonnen und Verloren müssen vorhanden sein; Schlüssel eindeutig; Labels gesetzt. Gibt die bereinigte Liste zurück. */
export function normalizeStages(input: Array<Partial<StageDef>>): { stages: StageDef[]; issues: string[] } {
  const issues: string[] = []; const seen = new Set<string>(); const stages: StageDef[] = [];
  for (const item of input) { const label = String(item.label ?? "").trim(); if (!label) { issues.push("Eine Stufe hat keinen Namen."); continue; } let key = String(item.key ?? "").trim() || slugStage(label); if (seen.has(key)) { issues.push(`Die Stufe „${label}“ ist doppelt.`); continue; } seen.add(key); stages.push({ key, label: label.slice(0, 40), hint: String(item.hint ?? "").trim().slice(0, 120), ...(item.fixed ? { fixed: item.fixed } : {}) }); }
  if (!stages.some((stage) => stage.fixed === "entry")) issues.push("Die Eingangsstufe („Neu“) darf nicht fehlen."); if (!stages.some((stage) => stage.fixed === "won")) issues.push("Die Gewonnen-Stufe („Kunde“) darf nicht fehlen."); if (!stages.some((stage) => stage.fixed === "lost")) issues.push("Die Verloren-Stufe darf nicht fehlen.");
  if (stages.length > 12) issues.push("Höchstens 12 Stufen.");
  const entry = stages.find((stage) => stage.fixed === "entry"); const lost = stages.find((stage) => stage.fixed === "lost");
  const ordered = [...(entry ? [entry] : []), ...stages.filter((stage) => stage !== entry && stage !== lost), ...(lost ? [lost] : [])];
  return { stages: ordered, issues };
}
export const entryStage = (stages: StageDef[] = PIPELINE_STAGES) => stages.find((stage) => stage.fixed === "entry")?.key ?? stages[0]?.key ?? "neu";
export const wonStage = (stages: StageDef[] = PIPELINE_STAGES) => stages.find((stage) => stage.fixed === "won")?.key ?? "kunde";
export const lostStage = (stages: StageDef[] = PIPELINE_STAGES) => stages.find((stage) => stage.fixed === "lost")?.key ?? "verloren";
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
export const historyLabel = (toStage: string, stageDefs: StageDef[]) => ({ besitzer: "Zuteilung", notiz: "Notiz", wiedervorlage: "Wiedervorlage", erledigt: "Erledigt", termin_gesetzt: "Termin", termin_entfernt: "Termin entfernt", angebotswert: "Angebotswert", sms: "SMS", whatsapp: "WhatsApp", email: "E-Mail", serie: "E-Mail-Serie", kontakt: "Kontaktdaten" } as Record<string, string>)[toStage] ?? stageLabel(toStage, stageDefs);
