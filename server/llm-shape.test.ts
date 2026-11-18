import { describe, expect, it } from "vitest";
import { describeShape, fieldNames, looseItems, looseStrings, readAnswers, readCriteriaScores, toScore } from "./llm-shape";

const criteria = [
  { key: "interesse", label: "Interesse am Produkt" },
  { key: "entscheider", label: "Entscheider bzw. Eigentümer" },
  { key: "wp_kein_erdgas", label: "Wärmepumpe: keine Erdgas-Wärmepumpe" },
];
const expected = [{ key: "interesse", score: 9, evidence: "Kunde: „Ja, das interessiert mich.“" }, { key: "entscheider", score: 10, evidence: "Kunde ist Eigentümer." }, { key: "wp_kein_erdgas", score: 7, evidence: "" }];

describe("Kriterien-Punkte der KI lesen – in jeder Form, in der sie kommen", () => {
  it("flache Felder (so fragt das Schema)", () => {
    expect(readCriteriaScores({ punkte_interesse: 9, beleg_interesse: "Kunde: „Ja, das interessiert mich.“", punkte_entscheider: 10, beleg_entscheider: "Kunde ist Eigentümer.", punkte_wp_kein_erdgas: 7, beleg_wp_kein_erdgas: "" }, criteria)).toEqual(expected);
  });
  it("Liste mit key/score/evidence (ältere Form)", () => {
    expect(readCriteriaScores({ criteria: [{ key: "interesse", score: 9, evidence: "Kunde: „Ja, das interessiert mich.“" }, { key: "entscheider", score: 10, evidence: "Kunde ist Eigentümer." }, { key: "wp_kein_erdgas", score: 7, evidence: "" }] }, criteria)).toEqual(expected);
  });
  it("Liste als Text (JSON in einem String) – das hat früher überall 0 % ergeben", () => {
    const text = JSON.stringify([{ key: "interesse", score: 9, evidence: "Kunde: „Ja, das interessiert mich.“" }, { key: "entscheider", score: 10, evidence: "Kunde ist Eigentümer." }, { key: "wp_kein_erdgas", score: 7, evidence: "" }]);
    expect(readCriteriaScores({ criteria: text, verdict: "verkaufbar" }, criteria)).toEqual(expected);
    expect(readCriteriaScores({ criteria: "```json\n" + text + "\n```" }, criteria)).toEqual(expected);
  });
  it("Objekt statt Liste, auch nur mit Zahlen", () => {
    expect(readCriteriaScores({ criteria: { interesse: { score: 9, evidence: "Kunde: „Ja, das interessiert mich.“" }, entscheider: { score: 10, evidence: "Kunde ist Eigentümer." }, wp_kein_erdgas: 7 } }, criteria)).toEqual(expected);
  });
  it("andere Feldnamen, Titel statt Schlüssel, Punkte als Text", () => {
    expect(readCriteriaScores({ criteria: [{ kriterium: "Interesse am Produkt", punkte: "9/10", beleg: "Kunde: „Ja, das interessiert mich.“" }, { name: "entscheider: Entscheider bzw. Eigentümer", points: "10", begruendung: "Kunde ist Eigentümer." }, { key: "WP_kein_Erdgas", score: "70 %" }] }, criteria)).toEqual(expected);
  });
  it("unbrauchbare Kennungen, aber vollständig und in Reihenfolge → nach Position", () => {
    expect(readCriteriaScores({ criteria: [{ key: "1", score: 9, evidence: "Kunde: „Ja, das interessiert mich.“" }, { key: "2", score: 10, evidence: "Kunde ist Eigentümer." }, { key: "3", score: 7, evidence: "" }] }, criteria)).toEqual(expected);
  });
  it("kaputter Text: einzelne Einträge werden gerettet", () => {
    const broken = '[{"key":"interesse","score":9,"evidence":"ok"}, {"key":"entscheider","score":10,"evidence":"ok"}, {"key":"wp_kein_erdgas","score":7,"evi';
    expect(readCriteriaScores({ criteria: broken }, criteria).map((item) => [item.key, item.score])).toEqual([["interesse", 9], ["entscheider", 10]]);
  });
  it("nichts Lesbares → leere Liste (der Aufrufer meldet dann „nicht bewertet“, nicht 0 %)", () => {
    expect(readCriteriaScores({ verdict: "verkaufbar", summary: "…" }, criteria)).toEqual([]);
    expect(readCriteriaScores({ criteria: "siehe oben" }, criteria)).toEqual([]);
    expect(readCriteriaScores({ criteria: [] }, criteria)).toEqual([]);
    expect(describeShape({ verdict: "verkaufbar", criteria: "siehe oben" })).toContain("criteria: Text");
    expect(describeShape({})).toBe("leere Antwort");
  });
  it("nur ein Teil bewertet → nur dieser Teil kommt zurück", () => {
    expect(readCriteriaScores({ punkte_interesse: 4, beleg_interesse: "zögerlich" }, criteria)).toEqual([{ key: "interesse", score: 4, evidence: "zögerlich" }]);
  });
  it("0 Punkte mit Beleg ist eine echte Bewertung", () => {
    expect(readCriteriaScores({ punkte_interesse: 0, beleg_interesse: "Kunde lehnt ab." }, criteria)).toEqual([{ key: "interesse", score: 0, evidence: "Kunde lehnt ab." }]);
  });
});

describe("Antworten der Prüffragen lesen", () => {
  const questions = [{ key: "umsetzung_6_monate", label: "Ist die Umsetzung innerhalb von höchstens 6 Monaten geplant?" }, { key: "eigentuemer_entscheider", label: "Ist der Kunde Eigentümer bzw. Entscheider?" }];
  const want = [{ key: "umsetzung_6_monate", answer: "ja", note: "So schnell wie möglich." }, { key: "eigentuemer_entscheider", answer: "nein", note: "Mieter." }];
  it("flache Felder", () => { expect(readAnswers({ antwort_umsetzung_6_monate: "ja", notiz_umsetzung_6_monate: "So schnell wie möglich.", antwort_eigentuemer_entscheider: "nein", notiz_eigentuemer_entscheider: "Mieter." }, questions)).toEqual(want); });
  it("Liste, Text oder Objekt", () => {
    const list = [{ key: "umsetzung_6_monate", answer: "ja", note: "So schnell wie möglich." }, { key: "eigentuemer_entscheider", answer: "nein", note: "Mieter." }];
    expect(readAnswers({ answers: list }, questions)).toEqual(want);
    expect(readAnswers({ answers: JSON.stringify(list) }, questions)).toEqual(want);
    expect(readAnswers({ answers: { umsetzung_6_monate: { answer: "Ja", note: "So schnell wie möglich." }, eigentuemer_entscheider: { antwort: "NEIN", beleg: "Mieter." } } }, questions)).toEqual(want);
  });
  it("unbekannte Antwort wird ausgelassen (dann greift die Stichwort-Regel)", () => { expect(readAnswers({ answers: [{ key: "umsetzung_6_monate", answer: "vielleicht" }] }, questions)).toEqual([]); });
});

describe("Hilfen", () => {
  it("Feldnamen sind gültig und eindeutig", () => {
    expect(fieldNames(["interesse", "Größe & Maß", "", "interesse"], "punkte")).toEqual(["punkte_interesse", "punkte_groesse_mass", "punkte_nr3", "punkte_interesse_4"]);
    for (const name of fieldNames(["a".repeat(80), "ä ö ü ß"], "beleg")) expect(name).toMatch(/^[a-z0-9_]{1,64}$/);
  });
  it("Punkte aus Zahl oder Text", () => { expect([toScore(8), toScore("8"), toScore("8/10"), toScore("80 %"), toScore("7,6"), toScore(12), toScore(-3), toScore(""), toScore("gut"), toScore(null)]).toEqual([8, 8, 8, 8, 8, 1, 0, undefined, undefined, undefined]); });
  it("Listen von Texten und Einträgen", () => {
    expect(looseStrings(["a", " ", "b"])).toEqual(["a", "b"]); expect(looseStrings('["Kunde widerruft"]')).toEqual(["Kunde widerruft"]); expect(looseStrings("keine")).toEqual([]); expect(looseStrings("- eins\n- zwei")).toEqual(["eins", "zwei"]); expect(looseStrings(undefined)).toEqual([]);
    expect(looseItems('{"key":"a","score":3}')).toEqual([{ key: "a", score: 3 }]); expect(looseItems(42)).toEqual([]);
  });
});
