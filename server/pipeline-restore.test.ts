import { describe, expect, it } from "vitest";
import { describeRestore, reconstructStateAt, type RestoreEvent, type RestoreLead, type RestoreUndo } from "../shared/pipeline-restore";
import { buildStageSets } from "../shared/sales-pipeline";

const T = new Date("2026-10-26T19:00:00Z"); // gestern Abend, 20:00 Uhr deutscher Zeit
const stageSets = buildStageSets([]);
const stageKeys = new Set(Object.values(stageSets).flatMap((list) => (list ?? []).map((stage) => stage.key)));
const isStage = (key: string | null | undefined) => Boolean(key && stageKeys.has(key));
const [s0, s1, s2] = stageSets.alle.map((stage) => stage.key);
const lead = (id: number, now: Partial<RestoreLead> = {}): RestoreLead => ({ id, createdAt: new Date("2026-10-20T08:00:00Z"), inPipeline: true, adPlatform: "email", pipelineStage: s2, ownerUserId: 5, ...now });
let nextId = 1;
const event = (leadId: number, at: string, note: string | null, extra: Partial<RestoreEvent> = {}): RestoreEvent => ({ id: nextId++, leadId, at: new Date(at), fromStage: null, toStage: s2, note, actorUserId: 1, ...extra });
const custom = [{ key: "custom_solar", label: "Solar" }, { key: "custom_wp", label: "Wärmepumpe" }];
const platformFromLabel = (label: string) => label === "Kaltakquise" ? "kaltakquise" : label === "E-Mail-Kampagne" ? "email" : custom.find((item) => item.label === label)?.key;

describe("Früheren Stand wiederherstellen", () => {
  const leads: RestoreLead[] = [
    lead(1, {}),                                                         // übernommen (vorher nur E-Mail) + automatisch zugeteilt
    lead(2, { ownerUserId: 3 }),                                         // aus Kaltakquise verschoben
    lead(3, { adPlatform: "kaltakquise", pipelineStage: s1, ownerUserId: 3 }), // nur ein Stufenwechsel heute früh
    lead(4, { createdAt: new Date("2026-10-27T09:00:00Z") }),            // erst nach dem Zeitpunkt angelegt (heute hochgeladen), dann übernommen
    lead(5, { ownerUserId: 9 }),                                         // Zuteilung mit Rückgängig-Eintrag
    lead(6, { pipelineStage: s1 }),                                      // aus „eigene Pipeline“ (zwei vorhanden → unbekannt)
    lead(7, {}),                                                         // übernommen mit Rückgängig-Eintrag (genaue Werte)
    lead(8, {}),                                                         // nur Änderungen vor dem Zeitpunkt
  ];
  const events: RestoreEvent[] = [
    event(1, "2026-10-27T17:21:05Z", "Aus der E-Mail-Akquise in die Pipeline „E-Mail-Kampagne“ übernommen"),
    event(1, "2026-10-27T17:21:09Z", "Zugeteilt an Taner (Regel: reihum)", { toStage: "besitzer", actorUserId: null }),
    event(2, "2026-10-27T17:21:05Z", "Aus der Pipeline „Kaltakquise“ in die Pipeline „E-Mail-Kampagne“ verschoben", { fromStage: s1 }),
    event(3, "2026-10-26T15:00:00Z", null, { fromStage: s2, toStage: s0 }), // vor dem Zeitpunkt: zählt nicht
    event(3, "2026-10-27T08:30:00Z", null, { fromStage: s0, toStage: s1, actorUserId: 2 }),
    event(4, "2026-10-27T17:21:05Z", "Aus der E-Mail-Akquise in die Pipeline „E-Mail-Kampagne“ übernommen"),
    event(6, "2026-10-27T17:21:05Z", "Aus der Pipeline „eigene Pipeline“ in die Pipeline „E-Mail-Kampagne“ verschoben", { fromStage: s0 }),
    event(7, "2026-10-27T17:30:02Z", "Aus der E-Mail-Akquise in die Pipeline „E-Mail-Kampagne“ übernommen"),
    event(7, "2026-10-27T17:30:03Z", "Zugeteilt an Taner (Regel: reihum)", { toStage: "besitzer", actorUserId: null }),
    event(8, "2026-10-26T10:00:00Z", null, { fromStage: s0, toStage: s2 }),
    event(1, "2026-10-27T17:40:00Z", null, { fromStage: s0, toStage: s2 }), // später noch einmal umgestuft: die erste Änderung zählt
  ];
  const undo: RestoreUndo[] = [
    { id: 1, at: new Date("2026-10-27T11:00:00Z"), kind: "zuteilung", title: "5 Karten zugeteilt an Taner", actorUserId: 1, payload: { items: [{ leadId: 5, from: 7 }] } },
    // „In die Vertriebspipeline übernehmen“ mit Rückgängig-Eintrag: läuft ab 17:30:02.4, eingetragen 17:30:05 → gewinnt gegen die Verlaufseinträge derselben Aktion
    { id: 2, at: new Date("2026-10-27T17:30:05Z"), kind: "pipeline", title: "1 Kontakt in die Pipeline „E-Mail-Kampagne“ übernommen", actorUserId: 1, payload: { startedAt: "2026-10-27T17:30:02.400Z", items: [{ leadId: 7, adPlatform: "custom_solar", pipelineStage: s0, inPipeline: false, ownerUserId: 4 }] } },
    { id: 3, at: new Date("2026-10-25T11:00:00Z"), kind: "stufe", title: "alt", actorUserId: 1, payload: { items: [{ leadId: 8, from: s1 }] } }, // vor dem Zeitpunkt
  ];
  const items = reconstructStateAt({ at: T, leads, undo, events, isStage, platformFromLabel, takenPlatform: () => "kaltakquise", stageBefore: (leadId) => leadId === 1 ? s0 : null });
  const byId = new Map(items.map((item) => [item.leadId, item]));

  it("übernommen → wieder nur E-Mail-Akquise, Pipeline wie beim Upload, Stufe davor, automatische Zuteilung weg", () => {
    expect(byId.get(1)?.then).toEqual({ inPipeline: false, adPlatform: "kaltakquise", pipelineStage: s0, ownerUserId: null });
    expect(byId.get(1)?.changed.sort()).toEqual(["adPlatform", "inPipeline", "ownerUserId", "pipelineStage"].sort());
  });
  it("aus einer anderen Pipeline verschoben → zurück in die alte Pipeline und Stufe, Vertriebler bleibt", () => {
    expect(byId.get(2)?.then).toEqual({ inPipeline: true, adPlatform: "kaltakquise", pipelineStage: s1, ownerUserId: 3 });
    expect(byId.get(2)?.changed.sort()).toEqual(["adPlatform", "pipelineStage"]);
  });
  it("Stufenwechsel nach dem Zeitpunkt → Stufe davor; Änderungen vor dem Zeitpunkt zählen nicht", () => {
    expect(byId.get(3)?.then.pipelineStage).toBe(s0); expect(byId.get(3)?.changed).toEqual(["pipelineStage"]);
    expect(byId.has(8)).toBe(false);
  });
  it("erst danach angelegte Kontakte: zurück auf den Stand beim Anlegen (hier: nur E-Mail-Akquise)", () => {
    expect(byId.get(4)?.createdAfter).toBe(true); expect(byId.get(4)?.then).toMatchObject({ inPipeline: false, adPlatform: "kaltakquise", pipelineStage: "neu" });
    expect(byId.get(1)?.createdAfter).toBe(false);
  });
  it("Zuteilung aus dem Rückgängig-Eintrag (genauer Wert davor)", () => { expect(byId.get(5)?.then.ownerUserId).toBe(7); expect(byId.get(5)?.changed).toEqual(["ownerUserId"]); });
  it("nicht eindeutige eigene Pipeline → bleibt, wie sie ist (unbekannt), Stufe trotzdem zurück", () => {
    expect(byId.get(6)?.unknown).toEqual(["adPlatform"]); expect(byId.get(6)?.then.adPlatform).toBe("email"); expect(byId.get(6)?.then.pipelineStage).toBe(s0);
  });
  it("Rückgängig-Eintrag mit Startzeit gewinnt gegen die Verlaufseinträge derselben Aktion", () => {
    expect(byId.get(7)?.then).toEqual({ inPipeline: false, adPlatform: "custom_solar", pipelineStage: s0, ownerUserId: 4 });
  });
  it("Anzeige: Vorher/Nachher in Worten und Gruppen je Anlass", () => {
    const names = new Map([[1, "Tanesco"], [2, "Francesco"], [3, "Lea"], [4, "Max"], [5, "Taner"], [7, "Ina"], [9, "Ole"]]);
    const view = describeRestore(items, { at: T, stageSets, customPipelines: custom, userName: (id) => names.get(id) ?? null, info: (leadId) => ({ publicId: `K-${leadId}`, name: `Kontakt ${leadId}`, company: null, email: null }) });
    expect(view.total).toBe(7); expect(view.unknown).toBe(1);
    const one = view.items.find((item) => item.leadId === 1)!;
    expect(one.then).toEqual({ pipeline: "Nur E-Mail-Akquise", stage: stageSets.alle[0].label, owner: "–" }); expect(one.now.pipeline).toBe("E-Mail-Kampagne"); expect(one.now.owner).toBe("Taner");
    const taken = view.groups.find((group) => group.label.startsWith("In die Vertriebspipeline übernommen"))!;
    expect(taken.leadIds.sort()).toEqual([1, 4]); expect(taken.actor).toBe("Tanesco"); expect(view.groups[0].from.getTime()).toBeGreaterThanOrEqual(view.groups[view.groups.length - 1].from.getTime()); // neueste zuerst
    expect(view.groups.reduce((sum, group) => sum + group.count, 0)).toBe(7);
  });
});
