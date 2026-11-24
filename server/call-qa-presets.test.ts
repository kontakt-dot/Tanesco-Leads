import { describe, expect, it } from "vitest";
import { PV_HAUSKOMPASS_PRESET, presetByKey } from "../shared/call-qa-presets";
import { answerQuestionsHeuristically, decideByQuestions } from "../shared/call-qualification";
import { findMediaUrl } from "./call-qa";

const good = `Agent: Guten Tag, hier ist Yilmaz. hier ist Yilmaz von HausKompass. Es geht um eine Photovoltaikanlage für Ihr Haus, richtig?
Kunde: Ja, genau.
Agent: Sind Sie der Eigentümer des Hauses und entscheiden Sie das selbst?
Kunde: Ja, das Haus gehört uns, ich entscheide das mit meiner Frau.
Agent: Wann möchten Sie umsetzen?
Kunde: Am liebsten zeitnah, in den nächsten drei Monaten, spätestens im Frühjahr.
Agent: Sehr gut. Dann wird sich Photovoltaik Angebotsvergleich bei Ihnen melden, und Sie bekommen bis zu 3 Angebote von unseren Fachpartnern. Telefonisch unter dieser Nummer erreichbar?
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
    expect(answers.uebergabe_angebotsvergleich.answer).toBe("ja"); expect(answers.bis_zu_3_angebote.answer).toBe("ja");
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

describe("Am Ende: bis zu 3 Angebote von Fachpartnern", () => {
  it("ist Pflicht: fehlt der Satz, wird das Gespräch zurückgewiesen – auch wenn „Photovoltaik Angebotsvergleich“ angekündigt wurde", () => {
    expect(PV_HAUSKOMPASS_PRESET.questions.find((q) => q.key === "bis_zu_3_angebote")?.rule).toBe("required");
    const without = good.replace(", und Sie bekommen bis zu 3 Angebote von unseren Fachpartnern", "");
    const answers = answerQuestionsHeuristically(PV_HAUSKOMPASS_PRESET.questions, without);
    expect(answers.uebergabe_angebotsvergleich.answer).toBe("ja"); expect(answers.bis_zu_3_angebote).toMatchObject({ answer: "nein" });
    expect(decideByQuestions(PV_HAUSKOMPASS_PRESET.questions, answers)).toEqual({ decision: "zurueckgewiesen", reason: "Pflichtfrage „Wurde am Ende gesagt, dass der Kunde bis zu 3 Angebote von Fachpartnern bekommt?“ = Nein" });
  });
  it("versteht andere Worte mit demselben Sinn; „mehrere Angebote“ ohne Zahl ist unklar (zur Prüfung)", () => {
    const ask = (sentence: string) => answerQuestionsHeuristically(PV_HAUSKOMPASS_PRESET.questions, `Agent: ${sentence}`).bis_zu_3_angebote.answer;
    expect(ask("Sie erhalten bis zu drei Angebote von Fachbetrieben aus Ihrer Region.")).toBe("ja");
    expect(ask("Maximal 3 Fachpartner melden sich dann bei Ihnen.")).toBe("ja");
    expect(ask("Drei Angebote bekommen Sie per Post.")).toBe("ja");
    expect(ask("Sie bekommen dann mehrere Angebote.")).toBe("unklar");
    expect(ask("Dann meldet sich Photovoltaik Angebotsvergleich.")).toBe("nein");
    expect(PV_HAUSKOMPASS_PRESET.instructions).toContain("bis zu 3 Angebote von Fachpartnern");
  });
});

describe("Datei-Link aus einer Player-Seite", () => {
  it("findet <audio src>, Download-Links und mp3-Adressen – relativ zur Seite", () => {
    const page = "https://download.voicefile.de/getSound.aspx?token=abc&k=sistem&a=1";
    expect(findMediaUrl(`<html><body><audio controls src="/files/1.mp3?sig=x"></audio></body></html>`, page)).toBe("https://download.voicefile.de/files/1.mp3?sig=x");
    expect(findMediaUrl(`<a href="getSound.aspx?token=abc&amp;k=sistem&amp;a=1&amp;download=1" class="btn">Datei herunterladen</a>`, page)).toBe("https://download.voicefile.de/getSound.aspx?token=abc&k=sistem&a=1&download=1");
    expect(findMediaUrl(`<script>var src = "https://cdn.example.com/rec/87346796.wav";</script>`, page)).toBe("https://cdn.example.com/rec/87346796.wav");
    expect(findMediaUrl(`<html><body><p>Kein Ton hier</p></body></html>`, page)).toBeNull();
  });

  it("Wärmepumpe zählt wie Photovoltaik – Übergabe an „Photovoltaik Angebotsvergleich“ bleibt richtig", () => {
    const wp = `Agent: Guten Tag, hier ist Yilmaz von HausKompass, es geht um eine Wärmepumpe für Ihr Haus.\nKunde: Ja, unsere Gasheizung ist alt, wir wollen zeitnah eine Wärmepumpe, am liebsten in den nächsten Monaten.\nAgent: Sind Sie der Eigentümer?\nKunde: Ja, das Haus gehört uns.\nAgent: Bis zu drei Fachbetriebe aus Ihrer Region melden sich mit Angeboten. Dann meldet sich Photovoltaik Angebotsvergleich bei Ihnen – die machen auch Wärmepumpen. Telefonisch erreichbar?\nKunde: Ja, gerne anrufen.`;
    const answers = answerQuestionsHeuristically(PV_HAUSKOMPASS_PRESET.questions, wp);
    expect(answers.interesse.answer).toBe("ja"); expect(answers.uebergabe_angebotsvergleich.answer).toBe("ja");
    expect(decideByQuestions(PV_HAUSKOMPASS_PRESET.questions, answers).decision).toBe("freigegeben");
    expect(PV_HAUSKOMPASS_PRESET.instructions).toContain("Wärmepumpe");
  });
});

describe("Name des Mitarbeiters aus der Vorstellung", () => {
  it("erkennt gängige Vorstellungen und ignoriert Floskeln", async () => {
    const { detectAgentName } = await import("./call-qa");
    expect(detectAgentName("Agent: Guten Tag, hier ist Maya Becker von HausKompass. Spreche ich mit Herrn Schulz?")).toBe("Maya Becker");
    expect(detectAgentName("Sprecher 1: Schönen guten Tag, mein Name ist Yilmaz Kaya, ich rufe an wegen Ihrer Photovoltaik-Anfrage.")).toBe("Yilmaz Kaya");
    expect(detectAgentName("Agent: Hallo, Thomas Müller-Lüdenscheid von HausKompass hier.")).toBe("Thomas Müller-Lüdenscheid");
    expect(detectAgentName("Kunde: Ja hallo? Agent: Ja, guten Tag.")).toBeNull();
  });
});

describe("Vorlage Wattfox – Übergabe am Ende in EINER Frage, nur zur Auswertung (v357)", () => {
  it("fragt nach „Photovoltaik Angebotsvergleich“ und bis zu 3 Angeboten zusammen – Ja nur mit beidem; entscheidet aber nicht", async () => {
    const { WATTFOX_PRESET } = await import("../shared/call-qa-presets");
    expect(WATTFOX_PRESET.questions.filter((question) => question.rule !== "ko").map((question) => [question.key, question.rule])).toEqual([["uebergabe", "info"]]);
    expect(WATTFOX_PRESET.instructions).not.toContain("die Übergabe an „Photovoltaik Angebotsvergleich“, eine ausdrückliche Zustimmung");
    // Ein gutes Wattfox-Gespräch ohne den Satz am Ende bleibt freigegeben – die Frage steht nur auf „Nein“
    const withoutSentence = good.replace(/Dann wird sich Photovoltaik Angebotsvergleich[^?]*\?/, "Telefonisch unter dieser Nummer erreichbar?");
    const answers = answerQuestionsHeuristically(WATTFOX_PRESET.questions, withoutSentence);
    expect(answers.uebergabe?.answer).toBe("nein");
    for (const key of ["umsetzung_6_monate", "interesse_produkt", "eigentuemer_entscheider", "wp_kein_erdgas"]) answers[key] = { answer: "ja" };
    expect(decideByQuestions(WATTFOX_PRESET.questions, answers).decision).toBe("freigegeben");
    // Mit dem Satz: Ja
    expect(answerQuestionsHeuristically(WATTFOX_PRESET.questions, good).uebergabe?.answer).toBe("ja");
    // Nur eines von beiden: Nein – der Beleg nennt, was fehlt
    const onlyHandover = answerQuestionsHeuristically(WATTFOX_PRESET.questions, "Agent: Dann meldet sich Photovoltaik Angebotsvergleich bei Ihnen.").uebergabe;
    expect(onlyHandover.answer).toBe("nein"); expect(onlyHandover.note).toContain("bis zu 3 Angebote");
    const onlyOffers = answerQuestionsHeuristically(WATTFOX_PRESET.questions, "Agent: Sie bekommen bis zu drei Angebote von Fachbetrieben.").uebergabe;
    expect(onlyOffers.answer).toBe("nein"); expect(onlyOffers.note).toContain("Angebotsvergleich");
  });
});
