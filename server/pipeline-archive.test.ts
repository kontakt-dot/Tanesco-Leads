import { describe, expect, it } from "vitest";
import { DEFAULT_PIPELINE_SETTINGS, normalizeArchivedPipelines, normalizePipelineSettings, visiblePipelines } from "../shared/pipeline-extras";

describe("Pipelines archivieren", () => {
  const custom = [{ key: "p-trojanerabc", label: "Trojaner" }];
  it("ohne Archiv: alles sichtbar, in der eingestellten Reihenfolge", () => {
    expect(DEFAULT_PIPELINE_SETTINGS.archivedPipelines).toEqual([]);
    expect(visiblePipelines(DEFAULT_PIPELINE_SETTINGS)).toEqual(["email", "ads", "kaltakquise"]);
    expect(visiblePipelines(null)).toEqual(["email", "ads", "kaltakquise"]); expect(visiblePipelines(undefined)).toEqual(["email", "ads", "kaltakquise"]);
    const settings = normalizePipelineSettings({ customPipelines: custom, sourceOrder: ["kaltakquise", "p-trojanerabc", "email", "ads"] });
    expect(settings.archivedPipelines).toEqual([]); expect(visiblePipelines(settings)).toEqual(["kaltakquise", "p-trojanerabc", "email", "ads"]);
  });
  it("archivierte Pipelines sind ausgeblendet – die Reihenfolge der übrigen bleibt, der Platz der archivierten auch", () => {
    const settings = normalizePipelineSettings({ customPipelines: custom, sourceOrder: ["kaltakquise", "p-trojanerabc", "email", "ads"], archivedPipelines: ["p-trojanerabc"] });
    expect(settings.archivedPipelines).toEqual(["p-trojanerabc"]);
    expect(settings.sourceOrder).toEqual(["kaltakquise", "p-trojanerabc", "email", "ads"]);
    expect(visiblePipelines(settings)).toEqual(["kaltakquise", "email", "ads"]);
    expect(visiblePipelines({ ...settings, archivedPipelines: ["p-trojanerabc", "email"] })).toEqual(["kaltakquise", "ads"]);
  });
  it("nur vorhandene Pipelines, jede einmal – Unbekanntes und Gelöschtes fällt weg", () => {
    const order = ["email", "ads", "kaltakquise"] as const;
    expect(normalizeArchivedPipelines(["ads", "ads", "p-gibtsnicht", 5, null], [...order])).toEqual(["ads"]);
    expect(normalizeArchivedPipelines("ads", [...order])).toEqual([]); expect(normalizeArchivedPipelines(undefined, [...order])).toEqual([]);
    expect(normalizePipelineSettings({ archivedPipelines: ["p-trojanerabc"] }).archivedPipelines).toEqual([]); // eigene Pipeline gibt es nicht (mehr)
  });
  it("nie alle: mindestens eine Pipeline bleibt sichtbar", () => {
    expect(normalizeArchivedPipelines(["email", "ads", "kaltakquise"], ["email", "ads", "kaltakquise"])).toEqual(["email", "ads"]);
    const settings = normalizePipelineSettings({ archivedPipelines: ["kaltakquise", "ads", "email"] });
    expect(settings.archivedPipelines).toHaveLength(2); expect(visiblePipelines(settings)).toHaveLength(1);
    expect(visiblePipelines({ sourceOrder: ["email", "ads"], archivedPipelines: ["email", "ads"] })).toEqual(["email"]); // selbst bei kaputten Daten nie leer
  });
});
