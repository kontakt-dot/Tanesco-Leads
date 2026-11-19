import { describe, expect, it } from "vitest";
import { answerQuestionsHeuristically, decideByQuestions, DEFAULT_QUALIFICATION_QUESTIONS, mentionsGasHeatPump, normalizeQuestions, softenGasHeatPumpNo, summarizeAnswers } from "../shared/call-qualification";
import { WATTFOX_PRESET } from "../shared/call-qa-presets";

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

  it("Erdgas-Wärmepumpe: „Nein“ der KI zählt nur bei ausdrücklicher Nennung – sonst unklar, also zur Prüfung statt zurückgewiesen", () => {
    const questions = WATTFOX_PRESET.questions; const yes = { umsetzung_6_monate: { answer: "ja" as const }, interesse_produkt: { answer: "ja" as const }, eigentuemer_entscheider: { answer: "ja" as const } };
    const guess = { ...yes, wp_kein_erdgas: { answer: "nein" as const, note: "Der Kunde heizt mit Gas, was auf eine Gas-Wärmepumpe als Hauptinteresse hindeutet." } };
    // Der Kunde heizt heute nur mit Gas – das ist der Normalfall und kein Beleg für eine Gas-Wärmepumpe
    const today = "Agent: Womit heizen Sie aktuell? Kunde: Mit Erdgas. Die Wärmepumpe soll zentral über die Heizung laufen. Agent: Also eine Wärmepumpe als Ersatz? Kunde: Genau.";
    expect(mentionsGasHeatPump(today)).toBe(false);
    const softened = softenGasHeatPumpNo(questions, guess, today);
    expect(softened.wp_kein_erdgas.answer).toBe("unklar"); expect(softened.wp_kein_erdgas.note).toContain("Nicht eindeutig"); expect(softened.wp_kein_erdgas.note).toContain("hindeutet"); // die Einschätzung der KI bleibt lesbar
    expect(decideByQuestions(questions, guess)).toMatchObject({ decision: "zurueckgewiesen" }); expect(decideByQuestions(questions, softened)).toMatchObject({ decision: "pruefen" });
    expect(softened.umsetzung_6_monate).toEqual(yes.umsetzung_6_monate); // andere Fragen bleiben unberührt
    // Der Kunde nennt die Gas-Wärmepumpe ausdrücklich – dann bleibt es beim Nein
    for (const explicit of ["Kunde: Ich möchte eine Gas-Wärmepumpe.", "Kunde: Mich interessiert vor allem die Erdgaswärmepumpe.", "Kunde: Eigentlich nur eine Gas-Hybridheizung.", "Kunde: Eine Hybridheizung wäre mir am liebsten.", "Kunde: Eine Wärmepumpe mit Erdgas wäre mir lieber."]) {
      expect(mentionsGasHeatPump(explicit), explicit).toBe(true); expect(softenGasHeatPumpNo(questions, guess, explicit).wp_kein_erdgas.answer, explicit).toBe("nein");
    }
    // „Ja“ und „unklar“ der KI werden nie angefasst; ein Nein bei einer anderen Frage auch nicht
    expect(softenGasHeatPumpNo(questions, { ...yes, wp_kein_erdgas: { answer: "ja" } }, today).wp_kein_erdgas.answer).toBe("ja");
    expect(softenGasHeatPumpNo(questions, { ...yes, interesse_produkt: { answer: "nein" }, wp_kein_erdgas: { answer: "ja" } }, today).interesse_produkt.answer).toBe("nein");
    // gilt auch für eine selbst formulierte Frage zur Erdgas-Wärmepumpe
    const own = normalizeQuestions([{ label: "Will der Kunde keine Erdgas-Wärmepumpe?", rule: "ko" }]);
    expect(softenGasHeatPumpNo(own, { [own[0].key]: { answer: "nein" } }, today)[own[0].key].answer).toBe("unklar");
    // Stichwort-Regeln (ohne KI) verhalten sich gleich: Heizen mit Gas allein ist kein Nein
    expect(answerQuestionsHeuristically(questions, today).wp_kein_erdgas.answer).toBe("ja"); expect(answerQuestionsHeuristically(questions, "Kunde: Ich will eine Gas-Wärmepumpe.").wp_kein_erdgas.answer).toBe("nein");
    // Die Vorlage sagt der KI dasselbe
    const hint = questions.find((question) => question.key === "wp_kein_erdgas")!.hint!; expect(hint).toContain("ausdrücklich"); expect(hint).toContain("heute mit Gas"); expect(hint).toContain("unklar, nicht Nein"); expect(hint.length).toBeLessThanOrEqual(500);
    expect(WATTFOX_PRESET.instructions).toContain("KEIN Hinweis darauf"); expect(WATTFOX_PRESET.criteria.find((criterion) => criterion.key === "wp_kein_erdgas")!.description).toContain("ausdrücklich nennt");
  });
});
