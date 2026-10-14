import { describe, expect, it } from "vitest";
import { answerQuestionsHeuristically, decideByQuestions, DEFAULT_QUALIFICATION_QUESTIONS, normalizeQuestions, summarizeAnswers } from "../shared/call-qualification";

describe("Gesprächsbewertung: Qualifizierungsfragen je Kampagne", () => {
  it("beantwortet die Standardfragen aus dem Transkript (Stichwort-Regeln)", () => {
    const transcript = "Agent: Guten Tag, ich rufe wegen Ihrer Anfrage zur Photovoltaik-Anlage an. Haben Sie auch über eine Wärmepumpe nachgedacht? Kunde: Ja, das interessiert mich sehr. Agent: Dürfen wir einen Termin vor Ort machen, gerne nächste Woche? Kunde: Ja gerne, passt. Agent: Dürfen wir Sie vorher nochmal anrufen? Kunde: Ja, telefonisch bin ich erreichbar.";
    const answers = answerQuestionsHeuristically(DEFAULT_QUALIFICATION_QUESTIONS, transcript);
    expect(answers.frage_photovoltaik.answer).toBe("ja"); expect(answers.frage_waermepumpe.answer).toBe("ja"); expect(answers.frage_wintergarten.answer).toBe("nein");
    expect(answers.interesse.answer).toBe("ja"); expect(answers.vor_ort_termin.answer).toBe("ja"); expect(answers.telefonische_kontaktaufnahme.answer).toBe("ja"); expect(answers.alle_fragen_gestellt.answer).toBe("ja");
    const negative = answerQuestionsHeuristically(DEFAULT_QUALIFICATION_QUESTIONS, "Kunde: Ich habe kein Interesse, bitte nicht mehr anrufen.");
    expect(negative.interesse.answer).toBe("nein"); expect(negative.telefonische_kontaktaufnahme.answer).toBe("nein");
  });
  it("normalisiert eigene Fragen je Kampagne und fasst Antworten zusammen", () => {
    const questions = normalizeQuestions([{ label: "Wurde nach dem Alter der Heizung gefragt?" }, { label: "Ist der Kunde Eigentümer?" }, { label: "" }]);
    expect(questions.map((question) => question.key)).toEqual(["wurde_nach_dem_alter_der_heizung_gefragt", "ist_der_kunde_eigentuemer"]);
    const summary = summarizeAnswers([{ [questions[0].key]: { answer: "ja" }, [questions[1].key]: { answer: "nein" } }, { [questions[0].key]: { answer: "ja" } }, null], questions);
    expect(summary[0]).toMatchObject({ ja: 2, nein: 0, total: 2, jaShare: 100 }); expect(summary[1]).toMatchObject({ ja: 0, nein: 1, total: 1, jaShare: 0 });
  });

  it("entscheidet nach den Kampagnenfragen: K.-o. → zurückgewiesen, Unklar → prüfen, alles erfüllt → freigegeben", () => {
    const q = DEFAULT_QUALIFICATION_QUESTIONS;
    expect(decideByQuestions(q, { interesse: { answer: "nein" }, vor_ort_termin: { answer: "ja" }, telefonische_kontaktaufnahme: { answer: "ja" } })).toMatchObject({ decision: "zurueckgewiesen" });
    expect(decideByQuestions(q, { interesse: { answer: "ja" }, vor_ort_termin: { answer: "nein" }, telefonische_kontaktaufnahme: { answer: "ja" } })).toMatchObject({ decision: "zurueckgewiesen" });
    expect(decideByQuestions(q, { interesse: { answer: "ja" }, vor_ort_termin: { answer: "unklar" }, telefonische_kontaktaufnahme: { answer: "ja" } })).toMatchObject({ decision: "pruefen" });
    expect(decideByQuestions(q, { interesse: { answer: "ja" }, vor_ort_termin: { answer: "ja" }, telefonische_kontaktaufnahme: { answer: "ja" } })).toMatchObject({ decision: "freigegeben" });
    expect(decideByQuestions(normalizeQuestions([{ label: "Nur Info", rule: "info" }]), {})).toBeNull(); // keine entscheidende Frage → allgemeine Bewertung
  });
});
