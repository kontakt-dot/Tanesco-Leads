import { describe, expect, it } from "vitest";
import { stageAfterDisposition } from "../client/src/components/PipelineDialer";
import { PIPELINE_STAGES } from "../shared/sales-pipeline";

describe("Dialer in der Pipeline – Stufe nach dem Anruf-Ergebnis", () => {
  it("bewegt Karten nur vorwärts und passend zum Ergebnis", () => {
    expect(stageAfterDisposition("verkauft", "neu", PIPELINE_STAGES)).toBe("termin");
    expect(stageAfterDisposition("interessiert", "neu", PIPELINE_STAGES)).toBe("qualifiziert");
    expect(stageAfterDisposition("wiedervorlage", "neu", PIPELINE_STAGES)).toBe("kontaktiert");
    expect(stageAfterDisposition("wiedervorlage", "termin", PIPELINE_STAGES)).toBeNull(); // nie zurück
    expect(stageAfterDisposition("interessiert", "angebot", PIPELINE_STAGES)).toBeNull();
    expect(stageAfterDisposition("kein_interesse", "qualifiziert", PIPELINE_STAGES)).toBe("verloren");
    expect(stageAfterDisposition("nicht_anrufen", "verloren", PIPELINE_STAGES)).toBeNull();
    expect(stageAfterDisposition("nicht_erreicht", "neu", PIPELINE_STAGES)).toBeNull();
    expect(stageAfterDisposition("falsche_nummer", "neu", PIPELINE_STAGES)).toBeNull();
  });
  it("lässt eigene Stufenlisten ohne die Zielstufe unverändert", () => {
    const custom = PIPELINE_STAGES.filter((stage) => stage.key !== "qualifiziert");
    expect(stageAfterDisposition("interessiert", "neu", custom)).toBeNull();
    expect(stageAfterDisposition("verkauft", "neu", custom)).toBe("termin");
  });
});
