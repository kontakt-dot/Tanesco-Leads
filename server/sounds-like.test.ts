import { describe, expect, it } from "vitest";
import { soundsLike } from "../shared/sounds-like";
import { answerQuestionsHeuristically } from "../shared/call-qualification";

describe("Firmenname: zählt auch, wenn er nur ähnlich klingt (Spracherkennung verhört sich)", () => {
  it.each(["hier ist Maya Becker von HausKompass", "von Haus Kompass", "von Haus Campus", "von der Firma Hauskompas", "von Haus-Kompaß", "ich rufe an von Hauskampus", "von Haus Kom Pass", "von Hauskompast"])("erkennt „%s“", (text) => { expect(soundsLike(text, "HausKompass")).toBe(true); });
  it.each(["Sie wollen ein Haus kaufen", "Ihr Haus hat einen Kompost", "wir sind die Hausverwaltung", "Guten Tag, hier ist Maya Becker", "Photovoltaik Angebotsvergleich meldet sich"])("erkennt „%s“ nicht", (text) => { expect(soundsLike(text, "HausKompass")).toBe(false); });
  it("Prüffrage „HausKompass genannt?“ geht mit „Haus Campus“ durch", () => {
    const question = [{ key: "hauskompass_genannt", label: "Hat der Mitarbeiter HausKompass genannt?", rule: "required" as const }];
    expect(answerQuestionsHeuristically(question, "Agent: Guten Tag, Maya Becker von Haus Campus.").hauskompass_genannt.answer).toBe("ja");
    expect(answerQuestionsHeuristically(question, "Agent: Guten Tag, Maya Becker hier.").hauskompass_genannt.answer).toBe("nein");
  });
});

describe("Zeitrahmen: kein genaues Datum nötig", () => {
  const question = [{ key: "umsetzung_6_monate", label: "Ist die Umsetzung innerhalb von höchstens 6 Monaten geplant?", rule: "ko" as const }];
  it.each(["Kunde: Eigentlich so schnell wie möglich, ja.", "Kunde: Kommt auf das Angebot an, dann gehe ich davon aus.", "Kunde: Zeitnah wäre gut.", "Kunde: In drei Monaten."])("„%s“ = ja", (text) => { expect(answerQuestionsHeuristically(question, text).umsetzung_6_monate.answer).toBe("ja"); });
  it.each(["Kunde: Frühestens nächstes Jahr.", "Kunde: Irgendwann mal vielleicht."])("„%s“ = nein", (text) => { expect(answerQuestionsHeuristically(question, text).umsetzung_6_monate.answer).toBe("nein"); });
  it("gar nicht besprochen = unklar", () => { expect(answerQuestionsHeuristically(question, "Kunde: Ja, ich bin Eigentümer.").umsetzung_6_monate.answer).toBe("unklar"); });
});
