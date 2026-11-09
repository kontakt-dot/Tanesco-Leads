import { describe, expect, it } from "vitest";
import { PV_HAUSKOMPASS_PRESET, presetByKey } from "../shared/call-qa-presets";
import { answerQuestionsHeuristically, decideByQuestions } from "../shared/call-qualification";

const good = `Agent: Guten Tag, hier ist Yilmaz. Sie hatten sich bei HausKompass für eine Photovoltaikanlage eingetragen, richtig?
Kunde: Ja, genau.
Agent: Sind Sie der Eigentümer des Hauses und entscheiden Sie das selbst?
Kunde: Ja, das Haus gehört uns, ich entscheide das mit meiner Frau.
Agent: Wann möchten Sie umsetzen?
Kunde: Am liebsten zeitnah, in den nächsten drei Monaten, spätestens im Frühjahr.
Agent: Sehr gut. Dann wird sich Photovoltaik Angebotsvergleich bei Ihnen melden und Ihnen passende Angebote vorstellen. Telefonisch unter dieser Nummer erreichbar?
Kunde: Ja, gerne, am besten nachmittags anrufen.`;

const bad = `Agent: Guten Tag, hier ist Yilmaz vom Energieservice. Sie interessieren sich für Photovoltaik?
Kunde: Ja, aber ich bin nur Mieter, das Haus gehört meinem Vermieter. Und wenn, dann frühestens nächstes Jahr oder übernächstes.
Agent: Alles klar, dann melden wir uns.`;

describe("Vorlage Photovoltaik – HausKompass", () => {
  it("ist über den Schlüssel auffindbar und enthält die vier Vorgaben", () => {
    const preset = presetByKey("pv-hauskompass")!; expect(preset).toBe(PV_HAUSKOMPASS_PRESET);
    expect(preset.criteria.map((c) => c.key)).toEqual(expect.arrayContaining(["hauskompass", "entscheider", "zeitrahmen", "uebergabe"]));
    expect(preset.criteria.reduce((sum, c) => sum + c.weight, 0)).toBe(100);
    expect(preset.questions.find((q) => q.key === "umsetzung_6_monate")?.rule).toBe("ko");
    expect(preset.questions.find((q) => q.key === "uebergabe_angebotsvergleich")?.rule).toBe("required");
  });
  it("gutes Gespräch: alle Vorgaben erkannt → freigegeben", () => {
    const answers = answerQuestionsHeuristically(PV_HAUSKOMPASS_PRESET.questions, good);
    expect(answers.hauskompass_genannt.answer).toBe("ja");
    expect(answers.eigentuemer_entscheider.answer).toBe("ja");
    expect(answers.umsetzung_6_monate.answer).toBe("ja");
    expect(answers.uebergabe_angebotsvergleich.answer).toBe("ja");
    expect(decideByQuestions(PV_HAUSKOMPASS_PRESET.questions, answers).decision).toBe("freigegeben");
  });
  it("Mieter, Umsetzung nächstes Jahr, kein HausKompass, keine Übergabe → zurückgewiesen", () => {
    const answers = answerQuestionsHeuristically(PV_HAUSKOMPASS_PRESET.questions, bad);
    expect(answers.hauskompass_genannt.answer).toBe("nein");
    expect(answers.eigentuemer_entscheider.answer).toBe("nein");
    expect(answers.umsetzung_6_monate.answer).toBe("nein");
    expect(answers.uebergabe_angebotsvergleich.answer).toBe("nein");
    expect(decideByQuestions(PV_HAUSKOMPASS_PRESET.questions, answers).decision).toBe("zurueckgewiesen");
  });
});
