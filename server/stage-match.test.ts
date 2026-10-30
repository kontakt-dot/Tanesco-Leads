import { describe, expect, it } from "vitest";
import { matchStage, PIPELINE_STAGES, stageNameKey, type StageDef } from "../shared/sales-pipeline";

/** Eigene Stufen einer Pipeline: gleiche Namen wie der Standard, aber andere Schlüssel (gelöscht und neu angelegt) – plus eine ganz eigene Stufe. */
const OWN: StageDef[] = [
  { key: "neu", label: "Liste", hint: "", fixed: "entry" },
  { key: "stufe_a1b2c", label: "Kontaktiert", hint: "" },
  { key: "stufe_x9y8z", label: "Hat Interesse!", hint: "" },
  { key: "stufe_t7", label: "Termin", hint: "" },
  { key: "kunde", label: "Kunde", hint: "", fixed: "won" },
  { key: "verloren", label: "Raus", hint: "", fixed: "lost" },
];

describe("Stufen nach Umbenennen wiederfinden (matchStage)", () => {
  it("Namen werden ohne Groß/Klein, Leerzeichen, Umlaute und Satzzeichen verglichen", () => {
    expect(stageNameKey(" Hat Interesse! ")).toBe("hat interesse");
    expect(stageNameKey("Qualifiziert")).toBe(stageNameKey("qualifiziert"));
    expect(stageNameKey("Für später")).toBe("fuer spaeter");
  });
  it("gleicher Schlüssel gewinnt immer", () => {
    expect(matchStage("kunde", OWN)).toBe("kunde");
    expect(matchStage("stufe_t7", OWN, PIPELINE_STAGES)).toBe("stufe_t7");
  });
  it("Standard-Schlüssel wird über den Namen in den eigenen Stufen gefunden (Kontaktiert, Termin)", () => {
    expect(matchStage("kontaktiert", OWN, PIPELINE_STAGES)).toBe("stufe_a1b2c");
    expect(matchStage("termin", OWN, PIPELINE_STAGES)).toBe("stufe_t7");
    expect(matchStage("in_bearbeitung", OWN, PIPELINE_STAGES)).toBeNull(); // gibt es dort nicht – der Aufrufer nimmt den Eingang
  });
  it("Schlüssel aus einem anderen Satz: erst dessen Name, dann der Schlüssel selbst als Text", () => {
    const other: StageDef[] = [{ key: "stufe_q", label: "hat interesse", hint: "" }];
    expect(matchStage("stufe_q", OWN, other)).toBe("stufe_x9y8z"); // Name aus dem Herkunfts-Satz
    expect(matchStage("stufe_hat_interesse", OWN)).toBe("stufe_x9y8z"); // Schlüssel selbst als Text („stufe_“ weg, _ = Leerzeichen)
    expect(matchStage("Termin", OWN)).toBe("stufe_t7"); // ein Name statt Schlüssel (z. B. aus einer Auswahlliste)
  });
  it("Rolle (Eingang / Gewonnen / Verloren) zählt, wenn der Name anders ist", () => {
    expect(matchStage("verloren", [{ ...OWN[0] }, { key: "lost_x", label: "Kein Interesse", hint: "", fixed: "lost" }], PIPELINE_STAGES)).toBe("lost_x");
    expect(matchStage("neu", [{ key: "start", label: "Eingang", hint: "", fixed: "entry" }], PIPELINE_STAGES)).toBe("start");
  });
  it("nichts Passendes → null; leer → null", () => {
    expect(matchStage("angebot", OWN, PIPELINE_STAGES)).toBeNull();
    expect(matchStage(null, OWN)).toBeNull(); expect(matchStage("", OWN)).toBeNull();
  });
});
