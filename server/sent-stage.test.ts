import { describe, expect, it } from "vitest";
import { PIPELINE_STAGES, sentCardMove, sentStage, withSentStage } from "../shared/sales-pipeline";
import { DEFAULT_PIPELINE_SETTINGS, normalizePipelineSettings } from "../shared/pipeline-extras";

const withSent = withSentStage(PIPELINE_STAGES);

describe("Pipeline „E-Mail-Kampagne“: Spalte „Versendet“", () => {
  it("wird erkannt (Schlüssel oder Name) und sonst direkt nach „Neu“ eingefügt – nur einmal", () => {
    expect(sentStage(PIPELINE_STAGES)).toBeNull();
    expect(withSent.map((stage) => stage.key).slice(0, 3)).toEqual(["neu", "versendet", "in_bearbeitung"]);
    expect(withSentStage(withSent)).toBe(withSent); expect(sentStage(withSent)).toBe("versendet");
    const own = [{ key: "neu", label: "Neu", fixed: "entry" as const }, { key: "stufe_e_mail_versendet", label: "E-Mail versendet" }, { key: "kunde", label: "Kunde", fixed: "won" as const }, { key: "verloren", label: "Verloren", fixed: "lost" as const }];
    expect(sentStage(own)).toBe("stufe_e_mail_versendet");
    expect(sentStage([{ key: "neu", label: "Neu", fixed: "entry" as const }, { key: "stufe_gesendet", label: "Gesendet" }])).toBe("stufe_gesendet");
    expect(sentStage([{ key: "neu", label: "Versendet", fixed: "entry" as const }])).toBeNull(); // feste Stufe zählt nicht
  });
  it("nur neue kommen nach „Versendet“ – schon weitergeschobene Karten und andere Pipelines bleiben", () => {
    expect(sentCardMove({ inPipeline: false, adPlatform: "kaltakquise", pipelineStage: "neu" }, withSent)).toEqual({ intake: true, from: null, to: "versendet" });
    expect(sentCardMove({ inPipeline: true, adPlatform: "email", pipelineStage: "neu" }, withSent)).toEqual({ intake: false, from: "neu", to: "versendet" });
    expect(sentCardMove({ inPipeline: true, adPlatform: "email", pipelineStage: null }, withSent)).toEqual({ intake: false, from: "neu", to: "versendet" });
    expect(sentCardMove({ inPipeline: true, adPlatform: "email", pipelineStage: "kontaktiert" }, withSent)).toBeNull();
    expect(sentCardMove({ inPipeline: true, adPlatform: "email", pipelineStage: "versendet" }, withSent)).toBeNull();
    expect(sentCardMove({ inPipeline: true, adPlatform: "kaltakquise", pipelineStage: "neu" }, withSent)).toBeNull();
    expect(sentCardMove({ inPipeline: true, adPlatform: "facebook", pipelineStage: "neu" }, withSent)).toBeNull();
    expect(sentCardMove({ inPipeline: false, adPlatform: null, pipelineStage: null }, PIPELINE_STAGES)).toBeNull(); // keine Spalte → nichts
  });
  it("Einstellung „einmal angelegt“ bleibt gespeichert", () => {
    expect(DEFAULT_PIPELINE_SETTINGS.sentStageAdded).toBe(false);
    expect(normalizePipelineSettings({ sentStageAdded: true }).sentStageAdded).toBe(true);
    expect(normalizePipelineSettings({}).sentStageAdded).toBe(false);
  });
});
