import { describe, expect, it } from "vitest";
import { fixTreeQuestions, recipientValues, smoothQualifyPhrase, starterTree, thirdPartyTemplate } from "../shared/email-campaigns";
import { starterBlocks } from "../shared/email-design";
import { categoriesForSparte, sparteFromCategories } from "../shared/lead-sparte";
import { detectSparte, dropPayFit, fitsSparte, fixQuestionCount, foreignSparteIn, mentionsPayFit, mentionsQuestions, offerChain, qualifyBy, qualifyPhrase, questionCount, resolveSparte, sparteOf, withSparte, questionTopics, SPARTEN, topicsSentence, withQuestionTopics } from "../shared/lead-sparte";
import { ensureFacts, finishDraft } from "./campaign-review";

describe("Leadsparte: die KI schreibt passend zur Sparte – nie Wärmepumpen an Hausnotruf-Firmen", () => {
  it("erkennt die Sparte aus Kampagnennamen und Listen (so wie sie heißen)", () => {
    expect(detectSparte("Hausnotruf• Indiviueller Ansatz KI • deutschlandweit")?.label).toBe("Hausnotruf");
    expect(detectSparte("Elektrorollstuhl • Individueller Ansatz KI • deutschlandweit")?.label).toBe("Elektrorollstuhl");
    expect(detectSparte("Alarmanlage • individueller Ansatz KI • deutschlandweit")?.label).toBe("Alarmanlage");
    expect(detectSparte("PV & WP • Drittanbieter KI Ansatz • mind. 1 Bundesland")?.label).toBe("Photovoltaik & Wärmepumpe");
    expect(detectSparte("Kampagne", "Leads_Notrufsystem")?.label).toBe("Hausnotruf");
    expect(detectSparte("Dachdecker Bad Homburg")).toBeNull(); // „Bad“ als Ortsname ist keine Sparte
    expect(detectSparte("Elektro • Mit Freigabe")).toBeNull(); // „Elektro“ allein ist noch kein Rollstuhl
  });
  it("Eintrag: bekannte Sparten auch in anderer Schreibweise, sonst genau der eingetragene Wortlaut", () => {
    expect(resolveSparte("Hausnotrufe")?.key).toBe("hausnotruf"); expect(resolveSparte("alarmanlagen")?.key).toBe("alarmanlage"); expect(resolveSparte("PV & WP")?.key).toBe("pv-wp");
    expect(resolveSparte("Treppenlifte und Sitzlifte für Senioren in Bayern")).toMatchObject({ key: "eigene", label: "Treppenlifte und Sitzlifte für Senioren in Bayern" });
    expect(resolveSparte("Pool-Bau")).toMatchObject({ key: "eigene", topic: "Pool-Bau", partner: "Anbieter" });
    expect(resolveSparte("  ")).toBeNull();
  });
  it("Kampagne: eingetragen vor erkannt vor Standard", () => {
    expect(sparteOf({ leadSparte: "Elektrorollstuhl", name: "Hausnotruf • Test" })).toMatchObject({ label: "Elektrorollstuhl", source: "eingetragen" });
    expect(sparteOf({ leadSparte: null, name: "Hausnotruf • Test" })).toMatchObject({ label: "Hausnotruf", source: "erkannt" });
    expect(sparteOf({ name: "Erstkontakt" }, ["Leads_Alarmanlagen"])).toMatchObject({ label: "Alarmanlage", source: "erkannt" });
    expect(sparteOf({ name: "Erstkontakt" })).toMatchObject({ key: "pv-wp", source: "standard" });
  });
  it("Prüfung der KI-Texte: in Hausnotruf-Mails nichts von Photovoltaik/Wärmepumpe; in PV-Mails erlaubt", () => {
    const hausnotruf = resolveSparte("Hausnotruf")!; const pv = resolveSparte("PV & WP")!;
    expect(fitsSparte(hausnotruf, "Unsere Hausnotruf-Leads sind telefonisch qualifiziert.")).toBe(true);
    expect(fitsSparte(hausnotruf, "Unsere PV- und Wärmepumpen-Leads sind telefonisch qualifiziert.")).toBe(false);
    expect(fitsSparte(pv, "Unsere PV- und Wärmepumpen-Leads")).toBe(true);
    expect(foreignSparteIn(hausnotruf, "Lead-Lieferanten in Deutschland für Photovoltaik und Wärmepumpen")).toBe("Photovoltaik/Wärmepumpe");
    expect(fitsSparte(resolveSparte("Batteriespeicher und Notstrom für bestehende PV-Anlagen")!, "Ihre PV-Kunden fragen nach Speichern.")).toBe(true); // eigene Sparte mit PV im Namen
  });
  it("Platzhalter {{sparte}}: Sparte der Kampagne, ein Wert aus der Liste des Kontakts hat Vorrang; Startvorlage ohne feste Sparte", () => {
    const hausnotruf = resolveSparte("Hausnotruf")!;
    expect(withSparte(recipientValues({ firstName: "Eva" }), hausnotruf).sparte).toBe("Hausnotruf");
    expect(withSparte(recipientValues({ firstName: "Eva", fields: { sparte: "Pflegebox" } }), hausnotruf).sparte).toBe("Pflegebox");
    expect(recipientValues({ firstName: "Eva" }).sparte).toBe("Ihre Branche"); // ohne Kampagne: neutral, nie eine falsche Sparte
    const text = JSON.stringify(starterBlocks("kaltakquise")); expect(text).toContain("{{sparte}}"); expect(text).not.toMatch(/Photovoltaik|Wärmepumpe/);
  });
  it("Ersatz-Vorlagen ohne KI: Drittanbieter-Vorlage und Pflichtsätze mit der Sparte", () => {
    const hausnotruf = resolveSparte("Hausnotruf")!;
    const third = thirdPartyTemplate({ firma: "Notruf Nord GmbH", begruessung: "Sehr geehrte Damen und Herren" }, hausnotruf);
    expect(third.text).toContain("im Bereich Hausnotruf"); expect(third.text).not.toMatch(/Photovoltaik|Wärmepumpe/); expect(third.text).toContain("• Der Interessent weiß, dass sich ein Anbieter bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet auf Ihren Anruf\n");
    expect(finishDraft("Sehr geehrte Damen und Herren,\n\nkurzer Text.", { greeting: "Sehr geehrte Damen und Herren", phone: "", followUp: false, partner: "Anbieter", sparte: hausnotruf })).toContain("Der Interessent weiß danach, dass sich ein Anbieter bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet also auf Ihren Anruf.");
    expect(thirdPartyTemplate({ firma: "Solar GmbH" }).text).toContain("im Bereich Photovoltaik und Wärmepumpen"); // Standard bleibt wie bisher
  });
  it("„Sie zahlen nur für Leads, die passen“ steht in keiner E-Mail mehr – in keiner Sparte, keinem Ansatz, keiner Vorlage (die Testphase ist kostenlos)", () => {
    const pv = resolveSparte("PV & WP")!; const hausnotruf = resolveSparte("Hausnotruf")!;
    for (const text of ["Bezahlt werden nur passende Leads.", "Abgerechnet werden ausschließlich Leads, die passen.", "Sie zahlen nur für Anfragen, die wirklich passen.", "Sie zahlen dabei nur für Leads, die wirklich zu Ihnen passen."]) expect(mentionsPayFit(text)).toBe(true);
    expect(mentionsPayFit("Keine Vorkasse, keine lange Vertragsbindung.")).toBe(false); expect(mentionsPayFit("Zum Testen bekommen Sie 20 Test-Leads kostenlos.")).toBe(false);
    // ganzer Satz weg, der Rest des Absatzes bleibt
    const wrong = "Sehr geehrte Damen und Herren,\n\nunsere Leads sind exklusiv. Sie zahlen dabei nur für Leads, die wirklich zu Ihnen passen. Keine Vorkasse.\n\nVielen Dank";
    expect(dropPayFit(wrong)).toBe("Sehr geehrte Damen und Herren,\n\nunsere Leads sind exklusiv. Keine Vorkasse.\n\nVielen Dank");
    // mit dem Test-Angebot in einem Satz: nur der Teil fliegt raus – das Test-Angebot bleibt
    expect(dropPayFit("Sie zahlen nur für Leads, die wirklich zu Ihnen passen, und zum Testen bekommen Sie 20 Test-Leads kostenlos.")).toBe("Zum Testen bekommen Sie 20 Test-Leads kostenlos.");
    expect(dropPayFit("Keine Vorkasse – Sie zahlen nur für passende Leads.")).toBe("Keine Vorkasse.");
    // eigener Absatz und Aufzählungspunkt: ganz weg, ohne Lücke
    expect(dropPayFit("Absatz eins.\n\nSie zahlen dabei nur für Leads, die wirklich zu Ihnen passen.\n\nVielen Dank")).toBe("Absatz eins.\n\nVielen Dank");
    expect(dropPayFit("• Keine Vorkasse\n• Sie zahlen nur für Leads, die zu Ihnen passen\n• Keine Bindung")).toBe("• Keine Vorkasse\n• Keine Bindung");
    // die alte Vorlage: „Kein Risiko: Sie zahlen nur für Anfragen, die Sie erreichen.“ – fliegt genauso raus
    expect(dropPayFit("wir liefern geprüfte Kundenanfragen aus Ihrer Region – exklusiv. Kein Risiko: Sie zahlen nur für Anfragen, die Sie erreichen.")).toBe("wir liefern geprüfte Kundenanfragen aus Ihrer Region – exklusiv.");
    expect(mentionsPayFit("Bezahlt wird nur für erreichbare Anfragen.")).toBe(true); expect(mentionsPayFit("Die Zahl der Anfragen steigt.")).toBe(false); expect(mentionsPayFit("Sie bekommen 20 Test-Leads kostenlos – ohne Vorkasse.")).toBe(false);
    const clean = "Sehr geehrter Herr Wiebe,\n\nkurzer Text.\n\nVielen Dank"; expect(dropPayFit(clean)).toBe(clean); expect(dropPayFit(dropPayFit(wrong))).toBe(dropPayFit(wrong));
    // ganze Entwürfe: nie mit dem Satz – auch wenn die KI ihn schreibt
    for (const sparte of [pv, hausnotruf]) for (const approach of ["frei", "drittanbieter"]) {
      const done = finishDraft("Sehr geehrte Damen und Herren,\n\nkurzer Text. Sie zahlen nur für Leads, die passen.", { greeting: "Sehr geehrte Damen und Herren", phone: "", followUp: false, sparte, approach, partner: sparte.partner });
      expect(mentionsPayFit(done)).toBe(false); expect(done).toContain("Test-Leads kostenlos");
    }
    expect(thirdPartyTemplate({ firma: "Solar GmbH" }, pv).text).not.toMatch(/zahlen nur|nur für Leads, die/); expect(thirdPartyTemplate({ firma: "Notruf GmbH" }, hausnotruf).text).not.toMatch(/zahlen nur|nur für Leads, die/);
    expect(thirdPartyTemplate({ firma: "Solar GmbH" }, pv).text).toContain("20 Test-Leads kostenlos");
  });
});

describe("Lead-Kategorien wählen: daraus kommt die Leadsparte, zu der die KI schreibt", () => {
  const categories = ["Photovoltaik", "Wärmepumpe", "Treppenlifte", "Barrierefreie Bäder", "Alarmanlagen", "Hörgeräte", "Hausnotruf", "Hausnotruf Premium", "Photovoltaik Gewerbe"].map((name, index) => ({ id: index + 1, name }));
  it("Photovoltaik + Wärmepumpe → PV & WP, eine Kategorie → ihre Sparte, unbekannte mit ihrem Namen, mehrere → „A & B“", () => {
    expect(sparteFromCategories(["Photovoltaik", "Wärmepumpe"])).toBe("Photovoltaik & Wärmepumpe");
    expect(sparteFromCategories(["Photovoltaik Gewerbe", "Photovoltaik"])).toBe("Photovoltaik");
    expect(sparteFromCategories(["Treppenlifte"])).toBe("Treppenlift"); expect(sparteFromCategories(["Alarmanlagen"])).toBe("Alarmanlage");
    expect(sparteFromCategories(["Hausnotruf", "Hausnotruf Premium"])).toBe("Hausnotruf"); // beides Hausnotruf
    expect(sparteFromCategories(["Hörgeräte"])).toBe("Hörgeräte"); expect(resolveSparte("Hörgeräte")?.key).toBe("eigene"); // eigene Sparte – die KI nennt passende Punkte
    expect(sparteFromCategories(["Treppenlifte", "Barrierefreie Bäder"])).toBe("Treppenlift & Barrierefreies Bad"); expect(resolveSparte("Treppenlift & Barrierefreies Bad")?.key).toBe("eigene"); // mehrere Sparten: keine feste Zahl von Fragen
    expect(sparteFromCategories([])).toBeNull(); expect(sparteFromCategories([" ", null])).toBeNull();
  });
  it("Vorauswahl für Kampagnen ohne gewählte Kategorien: passende Kategorien zur Sparte – genaue Namen zuerst", () => {
    const names = (label: string) => categoriesForSparte(categories, resolveSparte(label)!).map((row) => row.name);
    expect(names("Photovoltaik & Wärmepumpe")).toEqual(["Photovoltaik", "Wärmepumpe"]); expect(names("Hausnotruf")).toEqual(["Hausnotruf"]); expect(names("Treppenlift")).toEqual(["Treppenlifte"]);
    expect(names("Hörgeräte")).toEqual(["Hörgeräte"]); expect(names("Treppenlift & Barrierefreies Bad")).toEqual(["Treppenlifte", "Barrierefreie Bäder"]);
    expect(names("Batteriespeicher")).toEqual([]); expect(names("Elektrorollstuhl")).toEqual([]); // nichts Passendes → keine Vorauswahl
  });
});

describe("Zahl der Fragen je Sparte: Hausnotruf 6, Elektrorollstuhl 6, Alarmanlage 8, PV & WP 10", () => {
  const hausnotruf = resolveSparte("Hausnotruf")!; const alarm = resolveSparte("Alarmanlage")!; const rollstuhl = resolveSparte("Elektrorollstuhl")!; const pv = resolveSparte("PV & WP")!; const pflegebox = resolveSparte("Pflegebox")!;
  it("die Zahlen und die Formulierung: Zahl der Fragen, Beispiele ohne Klammern („beispielsweise … usw.“), Logik-Kette", () => {
    expect([hausnotruf, rollstuhl, alarm, pv, resolveSparte("Photovoltaik")!, resolveSparte("Wärmepumpe")!].map((sparte) => questionCount(sparte))).toEqual([6, 6, 8, 10, 10, 10]);
    expect(questionCount(pflegebox)).toBeNull(); expect(questionCount(resolveSparte("Pool-Bau"))).toBeNull(); expect(questionCount(null)).toBe(10); // ohne Sparte: Standard PV & WP
    expect(questionCount({ ...hausnotruf, source: "erkannt" } as never)).toBe(6); // Sparte einer Kampagne (mit Herkunft)
    expect(qualifyPhrase(hausnotruf)).toBe("in der Regel anhand von sechs Fragen telefonisch vorqualifiziert");
    expect(qualifyPhrase(alarm)).toBe("in der Regel anhand von acht Fragen telefonisch vorqualifiziert");
    expect(qualifyPhrase(pflegebox)).toBe("anhand gezielter Fragen telefonisch vorqualifiziert"); // ohne feste Zahl: keine Zahl behaupten
    // Beispiele als eigener Satz, ohne Klammern – Alarmanlage so, wie es der Kunde versteht
    expect(topicsSentence(alarm)).toBe("Abgefragt werden beispielsweise die Art und Größe des Objekts, die Eigentumsverhältnisse, der gewünschte Zeitpunkt der Installation usw.");
    expect(topicsSentence(hausnotruf)).toBe("Abgefragt werden beispielsweise die Krankenkasse, bei der der Interessent versichert ist, der Pflegegrad, die Wohnsituation usw.");
    expect(topicsSentence(pv)).toBe("Abgefragt werden beispielsweise die Eigentumsverhältnisse, der Zustand von Dach und Heizung, der aktuelle Stromverbrauch usw.");
    expect(topicsSentence(resolveSparte("Pool-Bau"))).toBe(""); // neue Sparte: keine festen Punkte – die KI nennt drei passende
    expect(qualifyBy(rollstuhl)).toBe("anhand von in der Regel sechs Fragen – beispielsweise die Krankenkasse, bei der der Interessent versichert ist, der Pflegegrad, ob bereits ein Rezept vom Arzt vorliegt usw.");
    expect(qualifyBy(pflegebox)).toBe("anhand gezielter Fragen – beispielsweise der Pflegegrad, die Pflegekasse, bei der der Interessent versichert ist, die Pflegesituation zu Hause usw.");
    expect(questionTopics(hausnotruf)).toEqual(["die Krankenkasse, bei der der Interessent versichert ist", "der Pflegegrad", "die Wohnsituation"]); expect(questionTopics(rollstuhl)).toEqual(["die Krankenkasse, bei der der Interessent versichert ist", "der Pflegegrad", "ob bereits ein Rezept vom Arzt vorliegt"]); expect(questionTopics(resolveSparte("Pool-Bau"))).toBeNull(); expect(questionTopics(null)).toEqual(questionTopics(pv));
    expect(SPARTEN.every((item) => item.topics?.length === 3)).toBe(true); // jede bekannte Sparte hat drei Punkte
    // Logik-Kette: wer sich meldet, warum – und dass der Interessent auf den Anruf wartet
    expect(offerChain(alarm)).toBe("Der Interessent weiß danach, dass sich ein Fachbetrieb bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet also auf Ihren Anruf.");
    expect(offerChain(hausnotruf)).toContain("dass sich ein Anbieter bei ihm meldet"); expect(offerChain(rollstuhl)).toContain("dass sich ein Fachhändler bei ihm meldet");
  });
  it("Texte werden auf die Zahl der Sparte gebracht – nur in Sätzen über die Qualifizierung", () => {
    const old = "Unsere Anfragen werden in der Regel anhand von zehn Fragen telefonisch vorqualifiziert, sodass der Interessent weiß, wer sich meldet.";
    expect(fixQuestionCount(old, hausnotruf)).toBe("Unsere Anfragen werden in der Regel anhand von sechs Fragen telefonisch vorqualifiziert, sodass der Interessent weiß, wer sich meldet.");
    expect(fixQuestionCount("Jeder Lead wird über 10 Qualifizierungsfragen geprüft.", alarm)).toBe("Jeder Lead wird über acht Qualifizierungsfragen geprüft.");
    expect(fixQuestionCount("Jeder Interessent wird anhand von sechs Fragen vorqualifiziert.", pv)).toBe("Jeder Interessent wird anhand von zehn Fragen vorqualifiziert.");
    expect(fixQuestionCount(old, pflegebox)).toBe("Unsere Anfragen werden anhand gezielter Fragen telefonisch vorqualifiziert, sodass der Interessent weiß, wer sich meldet.");
    expect(fixQuestionCount("• Telefonische Vorqualifizierung jedes Interessenten anhand von in der Regel zehn Fragen; danach meldet sich ein Anbieter", pflegebox)).toBe("• Telefonische Vorqualifizierung jedes Interessenten anhand gezielter Fragen; danach meldet sich ein Anbieter");
    expect(fixQuestionCount("Jeder Lead wird mit zehn Fragen qualifiziert.", pflegebox)).toBe("Jeder Lead wird mit gezielten Fragen qualifiziert.");
    expect(fixQuestionCount("Unsere Leads sind anhand gezielter Fragen telefonisch vorqualifiziert.", hausnotruf)).toBe("Unsere Leads sind in der Regel anhand von sechs Fragen telefonisch vorqualifiziert."); // wieder mit Zahl, wenn die Sparte eine hat
    expect(fixQuestionCount(old, hausnotruf)).toBe(fixQuestionCount(fixQuestionCount(old, hausnotruf), hausnotruf)); // mehrfach ohne Nebenwirkung
    for (const text of ["Ich hätte zwei Fragen an Sie.", "Haben Sie noch Fragen?", "Ich hätte fünf kurze Fragen zu Ihrem Betrieb.", "Zehn Jahre Erfahrung im Leadmarkt."]) expect(fixQuestionCount(text, hausnotruf)).toBe(text);
    expect(mentionsQuestions(old)).toBe(true); expect(mentionsQuestions("anhand gezielter Fragen")).toBe(true); expect(mentionsQuestions("Haben Sie Fragen?")).toBe(false);
    expect(smoothQualifyPhrase("Unsere Anfragen werden telefonisch qualifiziert – in der Regel über 6 Fragen, sodass")).toBe("Unsere Anfragen werden in der Regel anhand von sechs Fragen telefonisch vorqualifiziert, sodass"); // die Zahl bleibt, wie sie dasteht
  });
  it("Pflichtsätze, Drittanbieter-Vorlage und fertige KI-Entwürfe mit der richtigen Zahl, den Beispielen und der Kette", () => {
    expect(ensureFacts("Sehr geehrte Damen und Herren,\n\nkurzer Text.", false, "Anbieter", hausnotruf)).toContain("in der Regel anhand von sechs Fragen telefonisch vorqualifiziert.");
    expect(ensureFacts("Sehr geehrte Damen und Herren,\n\nkurzer Text.", false, "Fachbetrieb", alarm)).toContain("acht Fragen");
    const has = "Sehr geehrte Damen und Herren,\n\nUnsere Leads sind in der Regel anhand von sechs Fragen telefonisch vorqualifiziert. 20 Test-Leads kostenlos.";
    expect(ensureFacts(has, false, "Anbieter", hausnotruf)).toBe(has); // schon drin – kein zweiter Satz
    const alarmThird = thirdPartyTemplate({ firma: "Wachschutz Nord GmbH" }, alarm).text;
    expect(alarmThird).toContain("• Telefonische Vorqualifizierung jedes Interessenten anhand von in der Regel acht Fragen – beispielsweise die Art und Größe des Objekts, die Eigentumsverhältnisse, der gewünschte Zeitpunkt der Installation usw.\n• Der Interessent weiß, dass sich ein Fachbetrieb bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet auf Ihren Anruf\n");
    expect(alarmThird).not.toMatch(/\(z\. B\./); expect(withQuestionTopics(alarmThird, alarm)).toBe(alarmThird); // fertig – nichts doppelt
    expect(thirdPartyTemplate({ firma: "Box GmbH" }, pflegebox).text).toContain("anhand gezielter Fragen – beispielsweise der Pflegegrad");
    expect(thirdPartyTemplate({ firma: "Solar GmbH" }).text).toContain("anhand von in der Regel zehn Fragen"); // Standard bleibt
    // die KI übernimmt „zehn“ und die alte Klammer aus der Vorlage → im fertigen Entwurf steht die Zahl der Sparte, die Beispiele ohne Klammern und die Kette
    const ai = "Sehr geehrter Herr Wiebe,\n\nIhre Notrufzentrale ist rund um die Uhr besetzt. Unsere Hausnotruf-Leads sind in der Regel anhand von zehn Fragen (z. B. Eigentum, Dach und Heizung sowie Stromverbrauch) telefonisch vorqualifiziert, sodass der Interessent weiß, dass sich der Betrieb bei ihm meldet. Zum Kennenlernen: 20 Test-Leads kostenlos.";
    const done = finishDraft(ai, { greeting: "Sehr geehrter Herr Wiebe", phone: "", followUp: false, partner: "Anbieter", sparte: hausnotruf, approach: "frei" });
    expect(done).toContain("in der Regel anhand von sechs Fragen telefonisch vorqualifiziert. Abgefragt werden beispielsweise die Krankenkasse, bei der der Interessent versichert ist, der Pflegegrad, die Wohnsituation usw.");
    expect(done).toContain("Der Interessent weiß danach, dass sich ein Anbieter bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet also auf Ihren Anruf.");
    expect(done).not.toMatch(/zehn Fragen|\(z\. B\.|Stromverbrauch|sodass der Interessent/); expect(done.match(/Der Interessent weiß/g)).toHaveLength(1);
  });
  it("Beispiele ohne Klammern: nur bei der Qualifizierung, einmal je E-Mail, alte Klammern und fremde Beispiele werden ersetzt", () => {
    const text = "Unsere Anfragen werden in der Regel anhand von sechs Fragen telefonisch vorqualifiziert.";
    const once = withQuestionTopics(text, hausnotruf);
    expect(once).toBe("Unsere Anfragen werden in der Regel anhand von sechs Fragen telefonisch vorqualifiziert. Abgefragt werden beispielsweise die Krankenkasse, bei der der Interessent versichert ist, der Pflegegrad, die Wohnsituation usw. Der Interessent weiß danach, dass sich ein Anbieter bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet also auf Ihren Anruf.");
    expect(withQuestionTopics(once, hausnotruf)).toBe(once); // schon da – mehrfach ohne Nebenwirkung
    expect(withQuestionTopics("Jeder Lead wird anhand von sechs Fragen zu Krankenkasse und Pflegegrad geprüft.", hausnotruf)).toBe(`Jeder Lead wird anhand von sechs Fragen zu Krankenkasse und Pflegegrad geprüft. ${offerChain(hausnotruf)}`); // Punkte stehen schon im Satz – nur die Kette kommt dazu
    expect(withQuestionTopics("Ich hätte fünf kurze Fragen zu Ihrem Betrieb.", hausnotruf)).toBe("Ich hätte fünf kurze Fragen zu Ihrem Betrieb."); // keine Qualifizierung
    // alte Klammer (auch eine eigene der KI) → bei Alarmanlage die festen Beispiele, ohne Klammern
    expect(withQuestionTopics("Unsere Leads sind anhand von acht Fragen (z. B. Objekt, Fenster und Türen) vorqualifiziert.", alarm)).toBe(`Unsere Leads sind anhand von acht Fragen vorqualifiziert. ${topicsSentence(alarm)} ${offerChain(alarm)}`);
    // neue Sparte: eigene Punkte der KI bleiben – nur ohne Klammern; fremde Beispiele (andere Sparte) fallen weg
    expect(withQuestionTopics("Jede Anfrage wird anhand gezielter Fragen (z. B. Wassertiefe, Grundstücksgröße und Budget) telefonisch vorqualifiziert.", resolveSparte("Pool-Bau"))).toBe("Jede Anfrage wird anhand gezielter Fragen telefonisch vorqualifiziert. Abgefragt werden beispielsweise Wassertiefe, Grundstücksgröße, Budget usw. Der Interessent weiß danach, dass sich ein Anbieter bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet also auf Ihren Anruf.");
    const pvText = withQuestionTopics("Unsere Anfragen werden in der Regel anhand von zehn Fragen telefonisch vorqualifiziert.", pv);
    expect(withQuestionTopics(fixQuestionCount(pvText, resolveSparte("Pool-Bau")), resolveSparte("Pool-Bau"))).toBe(`Unsere Anfragen werden anhand gezielter Fragen telefonisch vorqualifiziert. ${offerChain(resolveSparte("Pool-Bau"))}`);
    // kopierte Vorlage: Zahl, Beispiele und wer sich meldet passen sich an die neue Sparte an
    expect(withQuestionTopics(fixQuestionCount(once, alarm), alarm)).toBe(`Unsere Anfragen werden in der Regel anhand von acht Fragen telefonisch vorqualifiziert. ${topicsSentence(alarm)} ${offerChain(alarm)}`);
    // alte Kette wird ausformuliert, nie doppelt
    expect(withQuestionTopics("Unsere Anfragen werden in der Regel anhand von zehn Fragen telefonisch vorqualifiziert, sodass der Interessent weiß, dass sich der Betrieb bei ihm meldet. Danach gehen sie exklusiv und in Echtzeit an Sie.", pv)).toBe(`Unsere Anfragen werden in der Regel anhand von zehn Fragen telefonisch vorqualifiziert. ${topicsSentence(pv)} ${offerChain(pv)} Die Anfragen gehen exklusiv und in Echtzeit an Sie.`);
    expect(withQuestionTopics("• Telefonische Vorqualifizierung anhand von in der Regel acht Fragen (z. B. Objekt und Fläche, Anzahl der Fenster sowie Art der Alarmanlage)\n• Der Interessent erwartet danach die Rückmeldung eines Fachbetriebs\n• Keine Vorkasse", alarm)).toBe("• Telefonische Vorqualifizierung anhand von in der Regel acht Fragen – beispielsweise die Art und Größe des Objekts, die Eigentumsverhältnisse, der gewünschte Zeitpunkt der Installation usw.\n• Der Interessent weiß, dass sich ein Fachbetrieb bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet auf Ihren Anruf\n• Keine Vorkasse");
  });
  it("Vorlagen im Ablauf: Hausnotruf bekommt sechs Fragen, PV & WP bleibt bei zehn – Beispiele und Kette einmal je E-Mail", () => {
    const tree = starterTree({ first: [{ id: "t", type: "text", text: "Unsere Anfragen werden in der Regel anhand von zehn Fragen telefonisch vorqualifiziert." }, { id: "b", type: "bullets", items: ["In der Regel anhand von zehn Fragen telefonisch vorqualifiziert", "Keine Vorkasse"] }], followUp: [{ id: "f", type: "text", text: "Kurz nachgefragt – unsere Leads sind über 10 Fragen qualifiziert." }] });
    const fixed = fixTreeQuestions(tree, hausnotruf)!; const text = JSON.stringify(fixed);
    expect(text).toContain(`anhand von sechs Fragen telefonisch vorqualifiziert. ${topicsSentence(hausnotruf)}\\n\\n${offerChain(hausnotruf)}`); // Kette als eigener kurzer Absatz
    expect(text).toContain("\"In der Regel anhand von sechs Fragen telefonisch vorqualifiziert\""); // in der Aufzählung derselben E-Mail nicht noch einmal
    expect(text).not.toContain("zehn Fragen"); expect(text).toContain(`über sechs Fragen qualifiziert. ${topicsSentence(hausnotruf)}`); // Nachfass-Mail: eigene E-Mail
    const pvTree = fixTreeQuestions(tree, pv)!; expect(JSON.stringify(pvTree)).toContain(`zehn Fragen telefonisch vorqualifiziert. ${topicsSentence(pv)}\\n\\n${offerChain(pv)}`);
    expect(fixTreeQuestions(pvTree, pv)).toBeNull(); expect(fixTreeQuestions(fixed, hausnotruf)).toBeNull(); // mehrfach ohne Nebenwirkung
    const toAlarm = JSON.stringify(fixTreeQuestions(fixed, alarm)); expect(toAlarm).toContain(`acht Fragen telefonisch vorqualifiziert. ${topicsSentence(alarm)}\\n\\n${offerChain(alarm)}`); expect(toAlarm).not.toContain("Krankenkasse"); // kopierte Vorlage
    // Aufzählung im Builder: Beispiele hinter dem Punkt, die Kette als eigener Punkt direkt dahinter
    const bullets = fixTreeQuestions(starterTree({ first: [{ id: "b", type: "bullets", items: ["Vorqualifizierung jedes Interessenten anhand von acht Fragen", "Keine Vorkasse"] }], followUp: [{ id: "f", type: "text", text: "Kurz nachgefragt." }] }), alarm)!;
    const items = (bullets.nodes.find((node) => node.type === "send") as { blocks: Array<{ type: string; items?: string[] }> }).blocks[0].items;
    expect(items).toEqual(["Vorqualifizierung jedes Interessenten anhand von acht Fragen – beispielsweise die Art und Größe des Objekts, die Eigentumsverhältnisse, der gewünschte Zeitpunkt der Installation usw.", "Der Interessent weiß, dass sich ein Fachbetrieb bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet auf Ihren Anruf", "Keine Vorkasse"]);
    // ohne gewählte Sparte (counts: false): Zahl bleibt, Beispiele und Kette kommen dazu
    expect(JSON.stringify(fixTreeQuestions(starterTree({ first: [{ id: "t", type: "text", text: "Unsere Anfragen werden anhand von acht Fragen telefonisch vorqualifiziert." }], followUp: [] }), pv, { counts: false }))).toContain(`anhand von acht Fragen telefonisch vorqualifiziert. ${topicsSentence(pv)}`);
  });
  it("Beispiele von gestern (nur „die Krankenkasse“, E-Rollstuhl „drinnen oder draußen“) werden umgestellt – auch leicht abgewandelt", () => {
    const yesterday = "Unsere Anfragen werden in der Regel anhand von sechs Fragen telefonisch vorqualifiziert. Abgefragt werden beispielsweise die Krankenkasse, der Pflegegrad, die geplante Nutzung drinnen oder draußen usw.";
    expect(withQuestionTopics(yesterday, rollstuhl, { done: false, chain: true })).toBe(`Unsere Anfragen werden in der Regel anhand von sechs Fragen telefonisch vorqualifiziert. ${topicsSentence(rollstuhl)}`);
    expect(topicsSentence(rollstuhl)).toBe("Abgefragt werden beispielsweise die Krankenkasse, bei der der Interessent versichert ist, der Pflegegrad, ob bereits ein Rezept vom Arzt vorliegt usw.");
    const hausnotrufYesterday = "Abgefragt werden beispielsweise die Krankenkasse, der Pflegegrad und die Wohnsituation des Interessenten usw."; // von der KI leicht abgewandelt
    expect(withQuestionTopics(`Jede Anfrage wird in der Regel anhand von sechs Fragen telefonisch vorqualifiziert. ${hausnotrufYesterday}`, hausnotruf, { done: false, chain: true })).toBe(`Jede Anfrage wird in der Regel anhand von sechs Fragen telefonisch vorqualifiziert. ${topicsSentence(hausnotruf)}`);
  });
  it("Bestand von vorher: alte Startvorlage („…, sodass der Interessent weiß, dass sich der Betrieb bei ihm meldet“) und ältere Ketten in Entwürfen werden beim ersten Mal sauber umgestellt", () => {
    // so steht die Startvorlage in gespeicherten Kampagnen (Teaser in Klammern, Kette als Nebensatz, „Danach gehen sie …“)
    const stored = starterTree({ first: [{ id: "t", type: "text", text: "{{begruessung}},\n\nwir von Tanesco Digital gehören zu den größten Lead-Lieferanten in Deutschland für {{sparte}}. Die Interessenten gewinnen wir selbst online.\n\nUnsere Anfragen werden in der Regel anhand von sechs Fragen (z. B. Krankenkasse, Pflegegrad und Wohnsituation) telefonisch vorqualifiziert, sodass der Interessent weiß, dass sich der Betrieb bei ihm meldet. Danach gehen sie exklusiv und in Echtzeit an Sie." }], followUp: [{ id: "f", type: "text", text: "Kurz nachgefragt." }] });
    const fresh = fixTreeQuestions(stored, hausnotruf)!; const first = (fresh.nodes.find((node) => node.type === "send") as { blocks: Array<{ text?: string }> }).blocks[0].text;
    expect(first).toContain(`Unsere Anfragen werden in der Regel anhand von sechs Fragen telefonisch vorqualifiziert. ${topicsSentence(hausnotruf)}\n\n${offerChain(hausnotruf)} Die Anfragen gehen exklusiv und in Echtzeit an Sie.`);
    expect(first).not.toMatch(/\(z\. ?B\.|sodass|Betrieb bei ihm meldet\.|Danach gehen sie/); expect(fixTreeQuestions(fresh, hausnotruf)).toBeNull(); // gleich im ersten Lauf fertig
    // ältere Ketten der KI mitten im Satz → eigener Satz mit dem Angebot; in einer Aufzählung als eigener Punkt
    const draft = (text: string) => withQuestionTopics(text, hausnotruf);
    expect(draft("Jede Anfrage wird in der Regel anhand von sechs Fragen telefonisch vorqualifiziert; der Interessent weiß danach, dass sich ein Anbieter bei ihm meldet.")).toBe(`Jede Anfrage wird in der Regel anhand von sechs Fragen telefonisch vorqualifiziert. ${topicsSentence(hausnotruf)} ${offerChain(hausnotruf)}`);
    expect(draft("Unsere Leads sind in der Regel anhand von sechs Fragen telefonisch vorqualifiziert – und der Interessent weiß also, dass sich ein Anbieter melden wird. Die Übergabe läuft in Echtzeit.")).toBe(`Unsere Leads sind in der Regel anhand von sechs Fragen telefonisch vorqualifiziert. ${topicsSentence(hausnotruf)} ${offerChain(hausnotruf)} Die Übergabe läuft in Echtzeit.`);
    expect(draft("• Vorqualifizierung anhand von in der Regel sechs Fragen, der Interessent weiß danach, dass sich ein Anbieter bei ihm meldet\n• Keine Vorkasse")).toBe(`• Vorqualifizierung anhand von in der Regel sechs Fragen – beispielsweise die Krankenkasse, bei der der Interessent versichert ist, der Pflegegrad, die Wohnsituation usw.\n• Der Interessent weiß, dass sich ein Anbieter bei ihm meldet, um ihm ein Angebot zu unterbreiten – er wartet auf Ihren Anruf\n• Keine Vorkasse`);
  });
});

describe("Pipeline „E-Mail-Kampagne“: jede Karte Photovoltaik ODER Wärmepumpe – nie „Photovoltaik & Wärmepumpe“", () => {
  it("erkennt die Firma an Name, Webseite, E-Mail-Adresse, Angaben der Liste und Betreff – nur bei klarem Ergebnis", async () => {
    const { energyKeyOfCompany } = await import("../shared/lead-sparte");
    expect(energyKeyOfCompany({ company: "Sonnenkraft Solartechnik GmbH" })).toBe("photovoltaik");
    expect(energyKeyOfCompany({ company: "clever-PV GmbH" })).toBe("photovoltaik");
    expect(energyKeyOfCompany({ company: "Müller GmbH", website: "https://www.solarmodule-gladbeck.de/kontakt" })).toBe("photovoltaik");
    expect(energyKeyOfCompany({ company: "Heizung & Sanitär Brandt" })).toBe("waermepumpe");
    expect(energyKeyOfCompany({ company: "Brandt GmbH", email: "info@waermepumpen-brandt.de" })).toBe("waermepumpe");
    expect(energyKeyOfCompany({ company: "Brandt GmbH", fields: ["Heizungsinstallateur", "4,8"] })).toBe("waermepumpe");
    expect(energyKeyOfCompany({ company: "Solarthermie Schulz" })).toBe("waermepumpe"); // Solarthermie ist Wärme, keine Photovoltaik
    expect(energyKeyOfCompany({ company: "1KOMMA5° Showroom Münster", subject: "Wärmepumpen-Anfragen für 1KOMMA5°" })).toBe("waermepumpe"); // nur der Betreff sagt etwas
    expect(energyKeyOfCompany({ company: "Solar & Heizung Weber" })).toBeNull(); // macht beides
    expect(energyKeyOfCompany({ company: "Stadtwerke Lindenau", website: "stadtwerke-lindenau.de" })).toBeNull(); // nichts dazu
    expect(energyKeyOfCompany({ company: "Sonnenkraft Solartechnik GmbH", fields: ["Photovoltaik & Wärmepumpe"] })).toBe("photovoltaik"); // Liste für beides ändert nichts am Namen
    expect(energyKeyOfCompany({ company: "Firma", website: "https://firma.de/wp-content/x" })).toBeNull(); // „wp-content“ der Webseite ist keine Wärmepumpe
  });
  it("Leadsparte der Kampagne: gewählte Kategorien vor der Sparte – Photovoltaik + Wärmepumpe (oder die gemeinsame, oder keine Sparte) = beides", async () => {
    const { campaignEnergyKey } = await import("../shared/lead-sparte");
    const categories = [{ id: 1, name: "Photovoltaik" }, { id: 2, name: "Wärmepumpe" }, { id: 3, name: "Photovoltaik & Wärmepumpe" }, { id: 4, name: "Alarmanlagen" }, { id: 5, name: "Photovoltaik Gewerbe" }];
    expect(campaignEnergyKey(categories, { leadCategoryIds: [2] })).toBe("waermepumpe");
    expect(campaignEnergyKey(categories, { leadCategoryIds: [5] })).toBe("photovoltaik");
    expect(campaignEnergyKey(categories, { leadCategoryIds: [1, 2] })).toBe("beides");
    expect(campaignEnergyKey(categories, { leadCategoryIds: [3, 1, 2] })).toBe("beides");
    expect(campaignEnergyKey(categories, { leadCategoryIds: [4] })).toBeNull();
    expect(campaignEnergyKey(categories, { leadSparte: "Wärmepumpe" })).toBe("waermepumpe");
    expect(campaignEnergyKey(categories, { leadSparte: "Photovoltaik & Wärmepumpe" })).toBe("beides");
    expect(campaignEnergyKey(categories, { name: "Über 100 Bewerungen" }, ["Photovoltaik & Wärmepumpe über 100 Bewertungen"])).toBe("beides");
    expect(campaignEnergyKey(categories, { name: "Leads WP bundesweit" })).toBe("waermepumpe");
    expect(campaignEnergyKey(categories, { name: "Neue Kampagne" })).toBe("beides"); // ohne Sparte gilt PV & WP
    expect(campaignEnergyKey(categories, { leadSparte: "Hausnotruf" })).toBeNull();
  });
});
