import { describe, expect, it } from "vitest";
import { PIPELINE_STAGES, SENT_STAGE, sentCardMove, sentIsEntry, sentStage, stageLabel, withSentStage, type StageDef } from "../shared/sales-pipeline";
import { DEFAULT_PIPELINE_SETTINGS, normalizePipelineSettings } from "../shared/pipeline-extras";

const withSent = withSentStage(PIPELINE_STAGES);
const keys = (stages: StageDef[]) => stages.map((stage) => stage.key);

describe("Pipeline „E-Mail-Kampagne“: Spalte „Versendet“", () => {
  it("ist die erste Spalte (Eingang) – eine Spalte „Neu“ gibt es dort nicht; wird erkannt (Schlüssel oder Name) und nur einmal eingesetzt", () => {
    expect(sentStage(PIPELINE_STAGES)).toBeNull(); expect(sentIsEntry(PIPELINE_STAGES)).toBe(false);
    expect(keys(withSent).slice(0, 2)).toEqual(["versendet", "in_bearbeitung"]); expect(withSent[0].fixed).toBe("entry"); expect(keys(withSent)).not.toContain("neu");
    expect(withSentStage(withSent)).toBe(withSent); expect(sentStage(withSent)).toBe("versendet"); expect(sentIsEntry(withSent)).toBe(true);
    const own = [{ key: "neu", label: "Neu", hint: "", fixed: "entry" as const }, { key: "stufe_e_mail_versendet", label: "E-Mail versendet", hint: "" }, { key: "kunde", label: "Kunde", hint: "", fixed: "won" as const }, { key: "verloren", label: "Verloren", hint: "", fixed: "lost" as const }];
    expect(sentStage(own)).toBe("stufe_e_mail_versendet");
    expect(sentStage([{ key: "neu", label: "Neu", hint: "", fixed: "entry" as const }, { key: "stufe_gesendet", label: "Gesendet", hint: "" }])).toBe("stufe_gesendet");
    expect(sentStage([{ key: "neu", label: "Versendet", hint: "", fixed: "entry" as const }])).toBeNull(); // feste Stufe zählt nicht
    // alte Aufteilung „Neu“ + „Versendet“ → zusammengelegt: die eigene Stufe bleibt (Name, Schlüssel), wird Eingang; „Neu“ fällt weg
    const merged = withSentStage(own); expect(keys(merged)).toEqual(["stufe_e_mail_versendet", "kunde", "verloren"]); expect(merged[0]).toMatchObject({ label: "E-Mail versendet", fixed: "entry" });
    const old = [{ key: "neu", label: "Neu", hint: "", fixed: "entry" as const }, SENT_STAGE, { key: "kontaktiert", label: "Kontaktiert", hint: "" }, { key: "kunde", label: "Kunde", hint: "", fixed: "won" as const }, { key: "verloren", label: "Verloren", hint: "", fixed: "lost" as const }];
    expect(sentIsEntry(old)).toBe(false); expect(keys(withSentStage(old))).toEqual(["versendet", "kontaktiert", "kunde", "verloren"]);
    expect(stageLabel("neu", withSent)).toBe("Neu"); expect(stageLabel("versendet", withSent)).toBe("Versendet"); expect(stageLabel("gibt_es_nicht", withSent)).toBe("Versendet"); // „neu“ behält seinen Namen (z. B. im Verlauf), Unbekanntes zeigt die erste Stufe
  });
  it("nur neue kommen nach „Versendet“ – schon weitergeschobene Karten und andere Pipelines bleiben", () => {
    expect(sentCardMove({ inPipeline: false, adPlatform: "kaltakquise", pipelineStage: "neu" }, withSent)).toEqual({ intake: true, from: null, to: "versendet" });
    expect(sentCardMove({ inPipeline: true, adPlatform: "email", pipelineStage: "neu" }, withSent)).toEqual({ intake: false, from: "neu", to: "versendet" }); // „Neu“ gibt es nicht mehr → einsortiert (mit „neu“ im Verlauf)
    expect(sentCardMove({ inPipeline: true, adPlatform: "email", pipelineStage: null }, withSent)).toEqual({ intake: false, from: null, to: "versendet" });
    expect(sentCardMove({ inPipeline: true, adPlatform: "email", pipelineStage: "kontaktiert" }, withSent)).toBeNull();
    expect(sentCardMove({ inPipeline: true, adPlatform: "email", pipelineStage: "versendet" }, withSent)).toBeNull();
    expect(sentCardMove({ inPipeline: true, adPlatform: "kaltakquise", pipelineStage: "neu" }, withSent)).toBeNull();
    expect(sentCardMove({ inPipeline: true, adPlatform: "facebook", pipelineStage: "neu" }, withSent)).toBeNull();
    expect(sentCardMove({ inPipeline: false, adPlatform: null, pipelineStage: null }, PIPELINE_STAGES)).toBeNull(); // keine Spalte → nichts
    const old = [{ key: "neu", label: "Neu", hint: "", fixed: "entry" as const }, SENT_STAGE, { key: "kunde", label: "Kunde", hint: "", fixed: "won" as const }, { key: "verloren", label: "Verloren", hint: "", fixed: "lost" as const }];
    expect(sentCardMove({ inPipeline: true, adPlatform: "email", pipelineStage: "neu" }, old)).toEqual({ intake: false, from: "neu", to: "versendet" }); // alte Aufteilung: aus „Neu“ nach „Versendet“
  });
  it("Einstellung „einmal angelegt“ bleibt gespeichert", () => {
    expect(DEFAULT_PIPELINE_SETTINGS.sentStageAdded).toBe(false);
    expect(normalizePipelineSettings({ sentStageAdded: true }).sentStageAdded).toBe(true);
    expect(normalizePipelineSettings({}).sentStageAdded).toBe(false);
  });
});
