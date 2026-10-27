/**
 * Kontakte auf einen früheren Stand zurücksetzen (z. B. „wie gestern Abend“).
 *
 * Aus dem Verlauf jedes Kontakts wird abgelesen, wie er zu einem Zeitpunkt stand: in welcher Pipeline (oder nur in der
 * E-Mail-Akquise), in welcher Stufe und bei welchem Vertriebler. Quellen – jeweils NACH dem gewählten Zeitpunkt:
 *  - Rückgängig-Einträge (Stufe, Zuteilung, Pipeline): sie enthalten den Wert davor genau
 *  - Verlaufseinträge der Karten: „In die Vertriebspipeline übernommen / aus Pipeline … verschoben“ (Knopf in den
 *    Kontakten der E-Mail-Kampagnen), Stufenwechsel von → nach, automatische Zuteilung (vorher: niemand)
 * Je Eigenschaft zählt die ERSTE Änderung nach dem Zeitpunkt – ihr „vorher“ ist der Stand zum Zeitpunkt.
 * Ist dieser Wert nicht bekannt, bleibt die Eigenschaft, wie sie ist, und wird als „unbekannt“ markiert.
 * Server und Chat-Demo rechnen mit derselben Funktion.
 */
import { pipelineLabel, pipelineSourceOf, stagesOf, type StageSets } from "./sales-pipeline";

export type PipelineState = { inPipeline: boolean; adPlatform: string | null; pipelineStage: string | null; ownerUserId: number | null };
export type StateKey = keyof PipelineState;
const KEYS: StateKey[] = ["inPipeline", "adPlatform", "pipelineStage", "ownerUserId"];
export type RestoreLead = { id: number; createdAt: Date | string; inPipeline: boolean | null; adPlatform: string | null; pipelineStage: string | null; ownerUserId: number | null };
export type RestoreUndo = { id: number; at: Date | string; kind: string; title: string; actorUserId: number | null; payload: unknown };
export type RestoreEvent = { id: number; leadId: number; at: Date | string; fromStage: string | null; toStage: string; note: string | null; actorUserId: number | null };
export type RestoreCause = { at: Date; label: string; actorUserId: number | null };
export type RestoreItem = { leadId: number; now: PipelineState; then: PipelineState; changed: StateKey[]; unknown: StateKey[]; cause: RestoreCause; createdAfter: boolean };

/** Verlaufstexte des Knopfs „In die Vertriebspipeline übernehmen“ (server/sales-outreach.ts → pushLeadsToPipeline). */
export const PUSH_TAKEN_RE = /^Aus der E-Mail-Akquise in die Pipeline „(.+)“ übernommen$/;
export const PUSH_MOVED_RE = /^Aus der Pipeline „(.+)“ in die Pipeline „(.+)“ verschoben$/;
export const PUSH_STAGED_NOTE = "Stufe über die Kontakte der E-Mail-Akquise gesetzt";
/** Automatische Zuteilung nach den Regeln (ohne handelnde Person) – vorher hatte die Karte keinen Vertriebler. */
const AUTO_ASSIGN_RE = /^Zugeteilt an .+\(Regel: /;

type Change = { at: number; order: number; cause: RestoreCause; values: Partial<PipelineState>; unknown: StateKey[] };
const time = (value: Date | string) => new Date(value).getTime();
const stateOf = (lead: RestoreLead): PipelineState => ({ inPipeline: lead.inPipeline !== false, adPlatform: lead.adPlatform ?? null, pipelineStage: lead.pipelineStage ?? null, ownerUserId: lead.ownerUserId ?? null });

export function reconstructStateAt(input: {
  at: Date; leads: RestoreLead[]; undo: RestoreUndo[]; events: RestoreEvent[];
  isStage: (key: string | null | undefined) => boolean;
  /** Pipeline-Name aus dem Verlaufstext → Wert im Kontakt („Kaltakquise“ → kaltakquise). undefined = nicht eindeutig. */
  platformFromLabel: (label: string, leadId: number) => string | null | undefined;
  /** Wo stand ein Kontakt, der nur in der E-Mail-Akquise war (vor „übernommen“)? */
  takenPlatform: (leadId: number) => string | null;
  /** Stufe vor „übernommen“ (letzter Stufen-Eintrag bis zum Zeitpunkt), sonst „neu“ wie beim Upload */
  stageBefore?: (leadId: number) => string | null | undefined;
}): RestoreItem[] {
  const limit = input.at.getTime(); let order = 0;
  const byLead = new Map<number, Change[]>();
  const add = (leadId: number, change: Omit<Change, "order">) => { const list = byLead.get(leadId) ?? []; list.push({ ...change, order: order++ }); byLead.set(leadId, list); };
  // 1) Rückgängig-Einträge: genaue Werte davor. Hat der Eintrag einen Startzeitpunkt (Aktion lief länger), zählt der –
  //    eine Sekunde früher, weil der Verlauf nur sekundengenau gespeichert ist. So gewinnt er vor den Verlaufseinträgen derselben Aktion.
  for (const entry of input.undo) {
    const payload = (entry.payload ?? {}) as { items?: Array<Record<string, unknown>>; startedAt?: string };
    const at = payload.startedAt ? Math.floor(time(payload.startedAt) / 1000) * 1000 - 1000 : time(entry.at);
    if (!(time(entry.at) > limit)) continue;
    const cause: RestoreCause = { at: new Date(entry.at), label: entry.title, actorUserId: entry.actorUserId };
    for (const item of payload.items ?? []) {
      const leadId = Number(item.leadId); if (!leadId) continue;
      const values: Partial<PipelineState> = {}; const unknown: StateKey[] = [];
      if (entry.kind === "stufe") { if (typeof item.from === "string" && item.from) values.pipelineStage = item.from; else unknown.push("pipelineStage"); }
      else if (entry.kind === "zuteilung") values.ownerUserId = item.from == null ? null : Number(item.from);
      else if (entry.kind === "pipeline") {
        if ("adPlatform" in item) values.adPlatform = (item.adPlatform as string | null) ?? null;
        if ("pipelineStage" in item) values.pipelineStage = (item.pipelineStage as string | null) ?? null;
        if (typeof item.inPipeline === "boolean") values.inPipeline = item.inPipeline;
        if ("ownerUserId" in item) values.ownerUserId = item.ownerUserId == null ? null : Number(item.ownerUserId);
      } else continue;
      add(leadId, { at, cause, values, unknown });
    }
  }
  // 2) Verlaufseinträge der Karten
  for (const event of input.events) {
    const at = time(event.at); if (!(at > limit)) continue;
    const note = (event.note ?? "").trim(); const values: Partial<PipelineState> = {}; const unknown: StateKey[] = []; let label: string;
    const taken = PUSH_TAKEN_RE.exec(note); const moved = PUSH_MOVED_RE.exec(note);
    if (taken) {
      label = `In die Vertriebspipeline übernommen („${taken[1]}“)`;
      values.inPipeline = false; values.adPlatform = input.takenPlatform(event.leadId);
      const before = input.stageBefore?.(event.leadId); values.pipelineStage = before && input.isStage(before) ? before : "neu";
    } else if (moved) {
      label = `Aus „${moved[1]}“ in „${moved[2]}“ verschoben`;
      values.inPipeline = true;
      const platform = input.platformFromLabel(moved[1], event.leadId); if (platform === undefined) unknown.push("adPlatform"); else values.adPlatform = platform;
      if (event.fromStage) values.pipelineStage = event.fromStage; else unknown.push("pipelineStage");
    } else if (note === PUSH_STAGED_NOTE) {
      label = "Stufe über die Kontakte gesetzt";
      if (event.fromStage) values.pipelineStage = event.fromStage; else unknown.push("pipelineStage");
    } else if (event.toStage === "besitzer" && event.actorUserId == null && AUTO_ASSIGN_RE.test(note)) {
      label = "Automatisch zugeteilt"; values.ownerUserId = null;
    } else if (event.fromStage && event.fromStage !== event.toStage && input.isStage(event.fromStage) && input.isStage(event.toStage)) {
      label = "Stufe geändert"; values.pipelineStage = event.fromStage;
    } else continue;
    add(event.leadId, { at, cause: { at: new Date(event.at), label, actorUserId: event.actorUserId }, values, unknown });
  }
  const result: RestoreItem[] = [];
  for (const lead of input.leads) {
    // Erst danach angelegt (z. B. heute hochgeladen): zurück auf den Stand beim Anlegen – das ist der früheste, den es gibt
    const createdAfter = time(lead.createdAt) > limit;
    const changes = (byLead.get(lead.id) ?? []).sort((a, b) => a.at - b.at || a.order - b.order);
    if (!changes.length) continue;
    const now = stateOf(lead); const then: PipelineState = { ...now }; const decided = new Set<StateKey>(); const unknown: StateKey[] = [];
    for (const change of changes) for (const key of KEYS) {
      if (decided.has(key)) continue;
      if (key in change.values) { (then as Record<StateKey, unknown>)[key] = change.values[key]; decided.add(key); }
      else if (change.unknown.includes(key)) { decided.add(key); unknown.push(key); }
    }
    // Nicht in einer Pipeline: welche Pipeline drinsteht, ändert die Ansicht nicht – nur zählen, wenn auch die Mitgliedschaft wechselt
    const changed = KEYS.filter((key) => !unknown.includes(key) && then[key] !== now[key]);
    if (!changed.length) continue;
    const cause = changes.find((change) => changed.some((key) => key in change.values))?.cause ?? changes[0].cause;
    result.push({ leadId: lead.id, now, then, changed, unknown, cause, createdAfter });
  }
  return result.sort((a, b) => a.cause.at.getTime() - b.cause.at.getTime() || a.leadId - b.leadId);
}

/* ---------- Anzeige: Vorher/Nachher in Worten, Gruppen nach Anlass ---------- */
export type RestoreView = { pipeline: string; stage: string; owner: string };
export type RestoreRow = { leadId: number; publicId: string; name: string; company: string | null; email: string | null; now: RestoreView; then: RestoreView; changed: StateKey[]; unknown: StateKey[]; cause: string; causeAt: Date; actor: string | null; group: string; createdAfter: boolean };
export type RestoreGroup = { key: string; label: string; actor: string | null; from: Date; to: Date; count: number; leadIds: number[] };

export function describeRestore(items: RestoreItem[], ctx: {
  at: Date; info: (leadId: number) => { publicId: string; name: string; company: string | null; email: string | null } | null;
  stageSets: StageSets; customPipelines: Array<{ key: string; label: string }>; userName: (userId: number) => string | null; limit?: number;
}) {
  const view = (state: PipelineState): RestoreView => {
    const source = pipelineSourceOf(state.adPlatform);
    const stage = state.pipelineStage ? stagesOf(ctx.stageSets, source).find((item) => item.key === state.pipelineStage)?.label ?? stagesOf(ctx.stageSets, "alle").find((item) => item.key === state.pipelineStage)?.label ?? state.pipelineStage : "–";
    return { pipeline: state.inPipeline ? pipelineLabel(source, ctx.customPipelines) : "Nur E-Mail-Akquise", stage, owner: state.ownerUserId ? (ctx.userName(state.ownerUserId) ?? "Vertriebler") : "–" };
  };
  // Gruppen: gleicher Anlass, gleiche Person, gleicher Tag – so wird aus einer Aktion mit 300 Kontakten eine Zeile
  // und aus vielen einzelnen Stufenwechseln eines Vertrieblers auch. Neueste zuerst: das Versehen steht meist oben.
  const day = (at: Date) => at.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
  const groups: RestoreGroup[] = []; const groupOf = new Map<number, string>(); const byKey = new Map<string, RestoreGroup>();
  const newest = [...items].sort((a, b) => b.cause.at.getTime() - a.cause.at.getTime() || a.leadId - b.leadId);
  for (const item of newest) {
    const actor = item.cause.actorUserId ? ctx.userName(item.cause.actorUserId) : null; const id = `${item.cause.label}|${actor ?? ""}|${day(item.cause.at)}`;
    const group = byKey.get(id);
    if (group) { if (item.cause.at < group.from) group.from = item.cause.at; group.count += 1; group.leadIds.push(item.leadId); groupOf.set(item.leadId, group.key); continue; }
    const created: RestoreGroup = { key: `g${groups.length + 1}`, label: item.cause.label, actor, from: item.cause.at, to: item.cause.at, count: 1, leadIds: [item.leadId] };
    groups.push(created); byKey.set(id, created); groupOf.set(item.leadId, created.key);
  }
  const rows: RestoreRow[] = [];
  for (const item of newest.slice(0, ctx.limit ?? 1000)) {
    const info = ctx.info(item.leadId); if (!info) continue;
    rows.push({ leadId: item.leadId, ...info, now: view(item.now), then: view(item.then), changed: item.changed, unknown: item.unknown, cause: item.cause.label, causeAt: item.cause.at, actor: item.cause.actorUserId ? ctx.userName(item.cause.actorUserId) : null, group: groupOf.get(item.leadId) ?? "", createdAfter: item.createdAfter });
  }
  return { at: ctx.at, total: items.length, unknown: items.filter((item) => item.unknown.length).length, items: rows, groups };
}

/** „27.10.2026, 20:00“ in deutscher Zeit – für Verlauf, Rückgängig-Eintrag und Meldungen. */
export const restoreStamp = (at: Date) => at.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
