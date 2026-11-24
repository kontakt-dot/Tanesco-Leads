import { describe, expect, it } from "vitest";
import { answerQuestionsHeuristically, decideByQuestions, isCallback, normalizeQuestions, questionFulfilment } from "../shared/call-qualification";
import { presetByKey } from "../shared/call-qa-presets";

const preset = presetByKey("wattfox-pv-wp")!;
const questions = normalizeQuestions(preset.questions);

describe("Wattfox PV und WP – Regeln der Kampagne", () => {
  it("hat genau die vier gewünschten K.-o.-Fragen – die Dachfläche ist raus", () => {
    expect(questions.filter((question) => question.rule === "ko").map((question) => question.key)).toEqual(["umsetzung_6_monate", "interesse_produkt", "eigentuemer_entscheider", "wp_kein_erdgas"]);
    // seit v355 dazu die Übergabe am Ende – nur zur Auswertung, sie entscheidet nicht
    expect(questions.filter((question) => question.rule !== "ko").map((question) => [question.key, question.rule])).toEqual([["uebergabe_angebotsvergleich", "info"], ["bis_zu_3_angebote", "info"]]);
    expect(questions.find((question) => question.key === "wp_kein_erdgas")?.onlyFor).toBe("waermepumpe");
    expect(questions.every((question) => (question.hint ?? "").length > 20)).toBe(true); // Hinweise werden nicht mehr abgeschnitten
    expect(preset.criteria.map((criterion) => criterion.key)).toEqual(["interesse", "entscheider", "zeitrahmen", "wp_kein_erdgas", "hauskompass"]);
    expect(preset.criteria.reduce((sum, criterion) => sum + criterion.weight, 0)).toBe(100);
    expect(preset.instructions).not.toMatch(/Dachfläche ist größer/); expect(preset.instructions).toContain("kostenlos und unverbindlich");
    expect(preset.retiredQuestionKeys).toEqual(["pv_dachflaeche_20qm"]);
  });

  it("nur Photovoltaik reicht als Interesse: alles erfüllt, Wärmepumpen-Frage entfällt → freigegeben (auch mit kleinem Dach)", () => {
    const transcript = "Agent: Es geht um Ihre Photovoltaikanlage. Kunde: Ja, ich habe Interesse, ich bin Eigentümer, das Dach hat nur 15 qm, eigentlich so schnell wie möglich.";
    const answers = answerQuestionsHeuristically(questions, transcript);
    expect(answers.interesse_produkt.answer).toBe("ja");
    expect(answers.wp_kein_erdgas).toMatchObject({ answer: "ja" }); expect(answers.wp_kein_erdgas.note).toContain("Entfällt");
    expect(decideByQuestions(questions, answers)?.decision).toBe("freigegeben");
    expect(questionFulfilment(questions, answers)).toMatchObject({ yes: 4, total: 4, percent: 100 });
  });

  it("nur Wärmepumpe reicht als Interesse; Erdgas-Wärmepumpe als Hauptinteresse → zurückgewiesen", () => {
    const ok = answerQuestionsHeuristically(questions, "Agent: Es geht um eine Wärmepumpe. Kunde: Ja, Interesse habe ich, ich bin Eigentümer, so schnell wie möglich.");
    expect(ok.interesse_produkt.answer).toBe("ja"); expect(ok.wp_kein_erdgas.answer).toBe("ja");
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

describe("Zahl unter dem Smiley: Anteil erfüllter Prüffragen", () => {
  it("zählt nur entscheidende Fragen (K.-o./Pflicht); alles Ja = 100 %", () => {
    const all = Object.fromEntries(questions.map((question) => [question.key, { answer: "ja" as const }]));
    expect(questionFulfilment(questions, all)).toMatchObject({ yes: 4, total: 4, percent: 100 });
    expect(questionFulfilment(questions, { ...all, umsetzung_6_monate: { answer: "unklar" }, eigentuemer_entscheider: { answer: "nein" } })).toMatchObject({ yes: 2, no: 1, unclear: 1, total: 4, percent: 50 });
    const mixed = [{ key: "a", label: "A?", rule: "ko" as const }, { key: "b", label: "B?", rule: "info" as const }];
    expect(questionFulfilment(mixed, { a: { answer: "ja" }, b: { answer: "nein" } })).toMatchObject({ yes: 1, total: 1, percent: 100 }); // Info-Fragen zählen nicht
    expect(questionFulfilment(questions, null)).toBeNull(); expect(questionFulfilment(questions, {})).toBeNull();
  });
  it("gleiche Prozentzahl, andere Ampel: 75 % mit einem „Nein“ ist rot (zurückgewiesen), 75 % mit einem „unklar“ ist orange (zur Prüfung) – der Hinweis nennt die Frage", () => {
    const all = Object.fromEntries(questions.map((question) => [question.key, { answer: "ja" as const }]));
    const labelOf = (key: string) => questions.find((question) => question.key === key)!.label;
    const withNo = { ...all, eigentuemer_entscheider: { answer: "nein" as const } }; const withUnclear = { ...all, umsetzung_6_monate: { answer: "unklar" as const } };
    expect(questionFulfilment(questions, withNo)).toMatchObject({ percent: 75, no: 1, unclear: 0, failed: [labelOf("eigentuemer_entscheider")], open: [] });
    expect(questionFulfilment(questions, withUnclear)).toMatchObject({ percent: 75, no: 0, unclear: 1, failed: [], open: [labelOf("umsetzung_6_monate")] });
    expect(decideByQuestions(questions, withNo)?.decision).toBe("zurueckgewiesen");
    expect(decideByQuestions(questions, withUnclear)?.decision).toBe("pruefen");
    expect(decideByQuestions(questions, all)?.decision).toBe("freigegeben");
  });
});
