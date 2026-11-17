import { describe, expect, it } from "vitest";
import { answerQuestionsHeuristically, decideByQuestions, isCallback, normalizeQuestions } from "../shared/call-qualification";
import { presetByKey } from "../shared/call-qa-presets";

const preset = presetByKey("wattfox-pv-wp")!;
const questions = normalizeQuestions(preset.questions);

describe("Wattfox PV und WP – Regeln der Kampagne", () => {
  it("hat genau die fünf gewünschten K.-o.-Fragen und behält „nur Photovoltaik / nur Wärmepumpe“", () => {
    expect(questions.map((question) => question.key)).toEqual(["umsetzung_6_monate", "interesse_produkt", "eigentuemer_entscheider", "pv_dachflaeche_20qm", "wp_kein_erdgas"]);
    expect(questions.every((question) => question.rule === "ko")).toBe(true);
    expect(questions.find((question) => question.key === "pv_dachflaeche_20qm")?.onlyFor).toBe("photovoltaik");
    expect(questions.find((question) => question.key === "wp_kein_erdgas")?.onlyFor).toBe("waermepumpe");
    expect(questions.every((question) => (question.hint ?? "").length > 20)).toBe(true); // Hinweise werden nicht mehr abgeschnitten
  });

  it("Photovoltaik-Gespräch mit großem Dach: alles erfüllt, Wärmepumpen-Frage entfällt → freigegeben", () => {
    const transcript = "Agent: Es geht um Ihre Photovoltaikanlage. Kunde: Ja, ich habe Interesse, ich bin Eigentümer, das Dach hat etwa 60 Quadratmeter, eigentlich so schnell wie möglich.";
    const answers = answerQuestionsHeuristically(questions, transcript);
    expect(answers.pv_dachflaeche_20qm).toMatchObject({ answer: "ja" });
    expect(answers.wp_kein_erdgas).toMatchObject({ answer: "ja" }); expect(answers.wp_kein_erdgas.note).toContain("Entfällt");
    expect(decideByQuestions(questions, answers)?.decision).toBe("freigegeben");
  });

  it("Photovoltaik mit zu kleinem Dach → zurückgewiesen", () => {
    const transcript = "Agent: Es geht um Photovoltaik. Kunde: Ja gerne, ich bin Eigentümer, zeitnah. Das Dach hat aber nur 15 qm.";
    const answers = answerQuestionsHeuristically(questions, transcript);
    expect(answers.pv_dachflaeche_20qm.answer).toBe("nein");
    expect(decideByQuestions(questions, answers)?.decision).toBe("zurueckgewiesen");
  });

  it("Wärmepumpen-Gespräch: Dachfläche entfällt; Erdgas-Wärmepumpe als Hauptinteresse → zurückgewiesen", () => {
    const ok = answerQuestionsHeuristically(questions, "Agent: Es geht um eine Wärmepumpe. Kunde: Ja, Interesse habe ich, ich bin Eigentümer, so schnell wie möglich.");
    expect(ok.pv_dachflaeche_20qm.note).toContain("Entfällt"); expect(ok.wp_kein_erdgas.answer).toBe("ja");
    expect(decideByQuestions(questions, ok)?.decision).toBe("freigegeben");
    const gas = answerQuestionsHeuristically(questions, "Agent: Es geht um eine Wärmepumpe. Kunde: Ja, ich bin Eigentümer, zeitnah, mich interessiert vor allem eine Erdgas-Wärmepumpe.");
    expect(gas.wp_kein_erdgas.answer).toBe("nein");
    expect(decideByQuestions(questions, gas)?.decision).toBe("zurueckgewiesen");
  });
});

describe("Rückruf erkennen – Firmenname muss nicht noch einmal fallen", () => {
  const question = [{ key: "hauskompass_genannt", label: "Hat der Mitarbeiter HausKompass genannt?", rule: "required" as const }];
  it.each(["Agent: Guten Tag, ich rufe Sie wie besprochen zurück.", "Agent: Hallo, das ist der vereinbarte Rückruf.", "Agent: Wir hatten ja gestern schon telefoniert.", "Agent: Sie hatten um einen Rückruf gebeten."])("„%s“ ist ein Rückruf", (text) => {
    expect(isCallback(text)).toBe(true);
    const answer = answerQuestionsHeuristically(question, text).hauskompass_genannt; expect(answer.answer).toBe("ja"); expect(answer.note).toContain("Rückruf");
  });
  it("normales Erstgespräch ohne Namen bleibt ein Nein", () => {
    const text = "Agent: Guten Tag, es geht um Ihre Photovoltaikanlage. Kunde: Ja?";
    expect(isCallback(text)).toBe(false); expect(answerQuestionsHeuristically(question, text).hauskompass_genannt.answer).toBe("nein");
  });
});
